"""Student study endpoints — photo grading, variant generation, verification."""

import io
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from config import (
    PROBLEM_TYPE_DEFAULT,
    QUALITY_CORRECT_NO_HINT,
    QUALITY_NO_ATTEMPT,
    QUALITY_WRONG_CLOSE,
    SM2_DEFAULT_EASE,
    SM2_FIRST_INTERVAL,
)
from models.schemas import (
    DisputeCreateRequest,
    DisputeResolveRequest,
    DisputeResponse,
    GradeResponse,
    RegenRequestCreateRequest,
    RegenRequestResponse,
    RegenResolveRequest,
    StudyStatus,
    VariantGenerateResponse,
    VerifyGradeResponse,
)
from services import firestore_service as db
from services import grading_service, variant_service
from services import storage_service as storage
from services.answer_normalizer import (
    answers_match_with_type,
    choice_safety_check,
    normalize_answer,
    _strip_units,
)
from services.auth_service import get_current_user
from services.locale_service import get_locale

logger = logging.getLogger(__name__)


async def _compare_answers(
    student_answer: str,
    correct_answer: str,
    problem_desc: str | None,
    locale: str,
) -> bool:
    """Compare student answer vs correct answer with LLM fallback + choice safety net."""
    match, s_type, c_type = answers_match_with_type(student_answer, correct_answer)

    # Unit tolerance: if correct answer has no unit, strip units from student answer
    # e.g. correct="77.5", student="77.5cm^2" → compare "77.5" vs "77.5"
    if not match and s_type == "unknown":
        stripped = _strip_units(student_answer)
        if stripped != student_answer:
            m2, _, _ = answers_match_with_type(stripped, correct_answer)
            if m2:
                match = True

    # Direct choice match: student "3" (integer) vs correct "choice:3" (choice)
    # or student "choice:3" vs correct "3" (integer)
    if not match:
        s_norm, _ = normalize_answer(student_answer)
        c_norm, _ = normalize_answer(correct_answer)
        if s_type == "integer" and c_type == "choice" and c_norm == f"choice:{s_norm}":
            match = True
        elif s_type == "choice" and c_type == "integer" and s_norm == f"choice:{c_norm}":
            match = True

    # LLM fallback: always for non-choice mismatches (catches format differences)
    if not match and not (s_type == "choice" and c_type == "choice"):
        match = await grading_service.llm_answers_match(
            student_answer, correct_answer, problem_desc, locale=locale,
        )

    # Descriptive answer: both are long text (unknown type) — extract the last
    # number from each. If they match, retry LLM with a hint that the final
    # answer is correct so it only needs to verify the work process.
    if not match and s_type == "unknown" and c_type == "unknown":
        import re as _re
        s_nums = _re.findall(r"-?\d+(?:\.\d+)?", _strip_units(student_answer))
        c_nums = _re.findall(r"-?\d+(?:\.\d+)?", _strip_units(correct_answer))
        if s_nums and c_nums:
            s_last, _ = normalize_answer(s_nums[-1])
            c_last, _ = normalize_answer(c_nums[-1])
            if s_last == c_last:
                # Final number matches — ask LLM to verify work process only
                hint = (
                    f"\n\nHINT: The final numeric answer ({s_last}) matches the correct answer. "
                    "Focus on verifying whether the student's solution PROCESS is logically valid. "
                    "If the process is valid, mark as equivalent."
                )
                match = await grading_service.llm_answers_match(
                    student_answer, correct_answer + hint, problem_desc, locale=locale,
                )

    # Safety net: student submitted a choice number but answer key has the VALUE
    # (mis-extracted, e.g. "84" instead of "choice:5"). Look up the choice
    # value from the problem description.
    if not match and problem_desc:
        s_norm, _ = normalize_answer(student_answer)
        c_norm, _ = normalize_answer(correct_answer)
        digit: str | None = None
        if s_type == "choice" and s_norm.startswith("choice:"):
            digit = s_norm.split(":")[1]
        elif s_type == "integer" and s_norm in ("1", "2", "3", "4", "5"):
            # Only trigger if correct answer is NOT a choice or 1-5 integer
            if not c_norm.startswith("choice:") and c_norm not in ("1", "2", "3", "4", "5"):
                digit = s_norm
        if digit:
            match = choice_safety_check(
                digit, correct_answer, problem_desc,
            )
    return match

router = APIRouter()

# Keywords indicating "incorrect" feedback across languages
_INCORRECT_KEYWORDS = ("incorrect", "오답", "틀", "wrong", "error", "mistake")


def _feedback_says_incorrect(feedback: str) -> bool:
    """Check if feedback text contains 'incorrect' indicators in any language."""
    low = feedback.lower()
    return any(kw in low for kw in _INCORRECT_KEYWORDS)


async def _verify_teacher_owns_student(teacher_uid: str, student_uid: str) -> bool:
    """Check if teacher has an active link to this student."""
    link = await db.get_teacher_student_link(teacher_uid, student_uid)
    if link and link.get("status") == "active":
        return True
    # Legacy fallback
    student = await db.get_user(student_uid)
    return student is not None and student.get("admin_uid") == teacher_uid


@router.post("/grade", response_model=GradeResponse)
async def grade_submission(
    request: Request,
    workbook_id: str,
    page: int,
    number: int,
    student_answer_text: Optional[str] = None,
    work_photo: Optional[UploadFile] = File(None),
    problem_photo: Optional[UploadFile] = File(None),
    user: dict = Depends(get_current_user),
):
    student_id = user["uid"]
    locale = get_locale(request)

    # At least one of work_photo or student_answer_text must be provided
    if not work_photo and not student_answer_text:
        raise HTTPException(
            400,
            "Either a work photo or a typed answer is required.",
        )

    # Read work photo if provided
    work_bytes = None
    work_mime = None
    work_gcs_path = None
    if work_photo:
        work_mime = work_photo.content_type or "image/jpeg"
        work_bytes = await work_photo.read()
        work_gcs_path = storage.upload_image(
            io.BytesIO(work_bytes), work_mime, folder=f"work/{student_id}",
        )

    # Upload problem photo to GCS (optional)
    problem_bytes = None
    problem_mime = None
    problem_gcs_path = None
    if problem_photo:
        problem_mime = problem_photo.content_type or "image/jpeg"
        problem_bytes = await problem_photo.read()
        problem_gcs_path = storage.upload_image(
            io.BytesIO(problem_bytes), problem_mime, folder=f"problem/{student_id}",
        )

    # Look up correct answer
    answer_key = await db.get_answer_key(workbook_id, page, number)
    if not answer_key:
        raise HTTPException(
            404,
            f"No answer key registered for page {page}, problem {number}. "
            "Please verify the workbook, page, and problem number.",
        )

    # Use stored problem description text if student didn't provide a problem photo
    stored_problem_desc = answer_key.get("problem_description") or ""

    correct_answer = answer_key["final_answer"]
    concept_tag = answer_key["concept_tag"]
    problem_type = answer_key.get("problem_type", PROBLEM_TYPE_DEFAULT)

    # Grading logic: text answer takes priority when provided
    if student_answer_text:
        student_answer = student_answer_text.strip()
        is_correct = await _compare_answers(
            student_answer, correct_answer, stored_problem_desc, locale,
        )

        if work_bytes:
            # Both text + photo: use Vision for error analysis, text for correctness
            grading_result = await grading_service.grade_photo(
                image_bytes=work_bytes,
                mime_type=work_mime,
                answer_key={**answer_key, "page": page, "number": number},
                problem_image_bytes=problem_bytes,
                problem_mime_type=problem_mime,
                problem_description_text=stored_problem_desc if not problem_bytes else None,
                locale=locale,
            )
            error_tag = grading_result.get("error_tag", "concept") if not is_correct else "none"
            feedback = grading_result.get("feedback", "")
        else:
            # Text only: basic comparison, no Vision
            error_tag = "none" if is_correct else "concept"
            feedback = (
                "Correct! Well done."
                if is_correct
                else "Incorrect. Please review your work."
            )

        if is_correct:
            error_tag = "none"
            if not feedback or _feedback_says_incorrect(feedback):
                feedback = "Correct! Well done."
    else:
        # Photo only: existing Vision flow
        grading_result = await grading_service.grade_photo(
            image_bytes=work_bytes,
            mime_type=work_mime,
            answer_key={**answer_key, "page": page, "number": number},
            problem_image_bytes=problem_bytes,
            problem_mime_type=problem_mime,
            problem_description_text=stored_problem_desc if not problem_bytes else None,
            locale=locale,
        )

        student_answer = grading_result.get("student_answer")
        error_tag = grading_result.get("error_tag")
        feedback = grading_result.get("feedback", "")

        # Deterministic normalizer with LLM fallback + choice safety net
        if student_answer and student_answer != "unreadable":
            is_correct = await _compare_answers(
                student_answer, correct_answer, stored_problem_desc, locale,
            )
        else:
            is_correct = grading_result.get("is_correct", False)

        if is_correct:
            error_tag = "none"
            if not feedback or _feedback_says_incorrect(feedback):
                feedback = "Correct! Well done."

    # Quality score for SM-2
    if is_correct:
        quality_score = QUALITY_CORRECT_NO_HINT
    elif error_tag == "retake_needed":
        quality_score = QUALITY_NO_ATTEMPT
    else:
        quality_score = QUALITY_WRONG_CLOSE

    # Extract analysis from grading result (if Vision was used)
    work_analysis = ""
    problem_description = ""
    if work_bytes and "grading_result" in locals():
        work_analysis = grading_result.get("work_analysis", "")
        problem_description = grading_result.get("problem_description", "")

    # Use stored problem description when Vision didn't produce one
    if not problem_description and stored_problem_desc:
        problem_description = stored_problem_desc

    # Fallback: extract problem_description from problem photo when Vision grading wasn't used
    if not problem_description and problem_bytes:
        logger.info("No problem_description from grading — extracting from problem photo")
        problem_description = await grading_service.extract_problem_description(
            image_bytes=problem_bytes,
            mime_type=problem_mime or "image/jpeg",
            locale=locale,
        )

    # Create attempt record
    attempt_id = uuid.uuid4().hex
    attempt_data = {
        "attempt_id": attempt_id,
        "student_id": student_id,
        "workbook_id": workbook_id,
        "page": page,
        "number": number,
        "problem_photo_url": problem_gcs_path,
        "work_photo_url": work_gcs_path,
        "student_answer": student_answer,
        "correct_answer": correct_answer,
        "is_correct": is_correct,
        "error_tag": error_tag,
        "concept_tag": concept_tag,
        "problem_type": problem_type,
        "feedback": feedback,
        "work_analysis": work_analysis,
        "problem_description": problem_description,
        "coaching_session_id": None,
        "quality_score": quality_score,
    }
    await db.create_attempt(attempt_id, attempt_data)

    # Save study record (skip retake_needed — not a real attempt)
    if error_tag != "retake_needed":
        status = StudyStatus.CORRECT if is_correct else StudyStatus.WRONG
        record_data: dict = {
            "status": status.value,
            "concept_tag": concept_tag,
            "problem_type": problem_type,
            "error_tag": error_tag,
            "attempt_ids": [attempt_id],
        }

        # Create mistake card for wrong answers (for future review/notifications)
        review_enabled = answer_key.get("review_enabled", True)
        if not is_correct and review_enabled:
            now = datetime.now(timezone.utc)
            card_id = f"{student_id}_{concept_tag}_{workbook_id}_{page}_{number}"
            await db.upsert_mistake_card(card_id, {
                "card_id": card_id,
                "student_id": student_id,
                "concept_tag": concept_tag,
                "problem_type": problem_type,
                "difficulty_band": "medium",
                "source_attempt_ids": [attempt_id],
                "ease_factor": SM2_DEFAULT_EASE,
                "interval": SM2_FIRST_INTERVAL,
                "repetitions": 0,
                "due_at": now + timedelta(days=SM2_FIRST_INTERVAL),
                "last_reviewed_at": None,
                "last_quality": 0,
                "created_at": now,
                "workbook_id": workbook_id,
                "page": page,
                "number": number,
                "problem_description": problem_description,
                "image_dependent": answer_key.get("image_dependent", False),
                "problem_image_url": answer_key.get("problem_image_url"),
                "correct_answer": correct_answer,
            })
            record_data["mistake_card_id"] = card_id

        await db.upsert_study_record(
            student_id, workbook_id, page, number, record_data,
        )

    return GradeResponse(
        attempt_id=attempt_id,
        is_correct=is_correct,
        student_answer=student_answer,
        correct_answer=correct_answer,
        concept_tag=concept_tag,
        problem_type=problem_type,
        error_tag=error_tag,
        feedback=feedback,
        problem_photo_url=problem_gcs_path,
        work_photo_url=work_gcs_path,
        problem_description=problem_description,
    )


@router.post("/coached")
async def mark_coached(
    workbook_id: str,
    page: int,
    number: int,
    user: dict = Depends(get_current_user),
):
    """Mark a study record as coached (coaching complete, verify skipped)."""
    student_id = user["uid"]
    await db.upsert_study_record(
        student_id, workbook_id, page, number,
        {"status": StudyStatus.COACHED.value},
    )
    return {"status": "coached"}


@router.post("/mark-mastered")
async def mark_mastered(
    workbook_id: str,
    page: int,
    number: int,
    user: dict = Depends(get_current_user),
):
    """Mark a study record as mastered (C=False coaching complete, or verify correct)."""
    student_id = user["uid"]
    await db.upsert_study_record(
        student_id, workbook_id, page, number,
        {"status": StudyStatus.MASTERED.value},
    )
    return {"status": "mastered"}


@router.get("/next-problem")
async def next_problem(
    workbook_id: str,
    current_page: int,
    current_number: int,
    user: dict = Depends(get_current_user),
):
    """Find the next available problem after (current_page, current_number)."""
    result = await db.get_next_answer_key(workbook_id, current_page, current_number)
    if result:
        return {"page": result["page"], "number": result["number"]}
    return {"page": None, "number": None}


class VariantRequest(BaseModel):
    difficulty_band: str = "medium"
    page: int = 0
    number: int = 0
    problem_description: str = ""
    image_dependent: bool = False
    correct_answer: str = ""
    workbook_id: str = ""
    attempt_id: str = ""


@router.post("/variant", response_model=VariantGenerateResponse)
async def generate_variant(request: Request, req: VariantRequest, user: dict = Depends(get_current_user)):
    locale = get_locale(request)

    problem_desc = req.problem_description

    # Fallback 1: look up from answer_key via workbook_id
    if not problem_desc.strip() and req.workbook_id and req.page and req.number:
        answer_key = await db.get_answer_key(req.workbook_id, req.page, req.number)
        if answer_key:
            problem_desc = answer_key.get("problem_description", "")
            logger.info(
                "Variant fallback (answer_key): workbook=%s page=%d number=%d",
                req.workbook_id, req.page, req.number,
            )

    # Fallback 2: look up from attempt record
    if not problem_desc.strip() and req.attempt_id:
        attempt = await db.get_attempt(req.attempt_id)
        if attempt:
            problem_desc = attempt.get("problem_description", "")
            # Also try answer_key if attempt didn't have it
            if not problem_desc.strip():
                wb_id = attempt.get("workbook_id", "")
                pg = attempt.get("page", 0)
                num = attempt.get("number", 0)
                if wb_id and pg and num:
                    ak = await db.get_answer_key(wb_id, pg, num)
                    if ak:
                        problem_desc = ak.get("problem_description", "")
            logger.info(
                "Variant fallback (attempt): attempt_id=%s desc=%s",
                req.attempt_id, bool(problem_desc),
            )

    # image_dependent → skip variant generation, return original problem as-is
    if req.image_dependent and problem_desc:
        return VariantGenerateResponse(
            display_text=problem_desc,
            correct_answer=req.correct_answer,
            difficulty_band=req.difficulty_band,
        )

    try:
        result = await variant_service.generate_variant(
            problem_description=problem_desc,
            difficulty_band=req.difficulty_band,
            page=req.page,
            number=req.number,
            locale=locale,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return VariantGenerateResponse(**result)


@router.post("/verify", response_model=VerifyGradeResponse)
async def verify_submission(
    request: Request,
    correct_answer: str,
    concept_tag: str,
    student_answer_text: Optional[str] = None,
    original_attempt_id: str = "",
    workbook_id: str = "",
    original_page: int = 0,
    original_number: int = 0,
    work_photo: Optional[UploadFile] = File(None),
    user: dict = Depends(get_current_user),
):
    """Grade a verification problem (variant). Work photo or text answer needed."""
    student_id = user["uid"]
    locale = get_locale(request)

    if not work_photo and not student_answer_text:
        raise HTTPException(
            400,
            "Either a work photo or a typed answer is required.",
        )

    work_bytes = None
    work_mime = None
    if work_photo:
        work_mime = work_photo.content_type or "image/jpeg"
        work_bytes = await work_photo.read()

    # Variant problems have no stored problem description
    stored_problem_desc = ""

    # Build a synthetic answer key for the variant problem
    synthetic_key = {
        "final_answer": correct_answer,
        "answer_type": "integer",
        "concept_tag": concept_tag,
        "page": 0,
        "number": 0,
    }

    verify_work_analysis = ""
    verify_problem_desc = ""

    if student_answer_text:
        student_answer = student_answer_text.strip()
        is_correct = await _compare_answers(
            student_answer, correct_answer, stored_problem_desc, locale,
        )

        if work_bytes:
            grading_result = await grading_service.grade_photo(
                image_bytes=work_bytes,
                mime_type=work_mime,
                answer_key=synthetic_key,
                locale=locale,
            )
            error_tag = grading_result.get("error_tag", "concept") if not is_correct else "none"
            feedback = grading_result.get("feedback", "")
            verify_work_analysis = grading_result.get("work_analysis", "")
            verify_problem_desc = grading_result.get("problem_description", "")
        else:
            error_tag = "none" if is_correct else "concept"
            feedback = (
                "Correct! Well done."
                if is_correct
                else "Incorrect. Please review your work."
            )

        if is_correct:
            error_tag = "none"
            if not feedback or _feedback_says_incorrect(feedback):
                feedback = "Correct! Well done."
    else:
        grading_result = await grading_service.grade_photo(
            image_bytes=work_bytes,
            mime_type=work_mime,
            answer_key=synthetic_key,
            locale=locale,
        )

        student_answer = grading_result.get("student_answer")
        error_tag = grading_result.get("error_tag")
        feedback = grading_result.get("feedback", "")
        verify_work_analysis = grading_result.get("work_analysis", "")
        verify_problem_desc = grading_result.get("problem_description", "")

        # Deterministic normalizer with LLM fallback + choice safety net
        if student_answer and student_answer != "unreadable":
            is_correct = await _compare_answers(
                student_answer, correct_answer, stored_problem_desc, locale,
            )
        else:
            is_correct = grading_result.get("is_correct", False)

        if is_correct:
            error_tag = "none"
            if not feedback or _feedback_says_incorrect(feedback):
                feedback = "Correct! Well done."

    # Create attempt record for verification
    attempt_id = uuid.uuid4().hex
    attempt_data = {
        "attempt_id": attempt_id,
        "student_id": student_id,
        "workbook_id": workbook_id or "variant",
        "page": original_page,
        "number": original_number,
        "work_photo_url": None,
        "student_answer": student_answer,
        "correct_answer": correct_answer,
        "is_correct": is_correct,
        "error_tag": error_tag,
        "concept_tag": concept_tag,
        "problem_type": PROBLEM_TYPE_DEFAULT,
        "feedback": feedback,
        "work_analysis": verify_work_analysis,
        "problem_description": verify_problem_desc,
        "coaching_session_id": None,
        "quality_score": QUALITY_CORRECT_NO_HINT if is_correct else QUALITY_WRONG_CLOSE,
    }
    await db.create_attempt(attempt_id, attempt_data)

    # Update study record: mastered if correct, stays wrong if not
    if workbook_id and original_page and original_number:
        if is_correct:
            await db.upsert_study_record(
                student_id, workbook_id, original_page, original_number,
                {
                    "status": StudyStatus.MASTERED.value,
                    "attempt_ids": [attempt_id],
                },
            )
        else:
            # Still wrong — append verify attempt to record
            await db.upsert_study_record(
                student_id, workbook_id, original_page, original_number,
                {
                    "attempt_ids": [attempt_id],
                },
            )

    return VerifyGradeResponse(
        attempt_id=attempt_id,
        is_correct=is_correct,
        student_answer=student_answer,
        correct_answer=correct_answer,
        error_tag=error_tag,
        feedback=feedback,
    )


@router.get("/records")
async def get_study_records(
    workbook_id: str,
    user: dict = Depends(get_current_user),
):
    """Get all study records for the current student + workbook.

    Returns a map of 'page_number' -> status for the problem grid UI.
    Replaces localStorage-based problem status tracking.
    """
    student_id = user["uid"]
    records = await db.list_study_records_for_workbook(student_id, workbook_id)
    statuses: dict[str, str] = {}
    last_attempt_ids: dict[str, str] = {}
    saved_variants: dict[str, dict] = {}
    for r in records:
        key = f"{r.get('page', 0)}_{r.get('number', 0)}"
        statuses[key] = r.get("status", "wrong")
        attempt_ids = r.get("attempt_ids", [])
        if attempt_ids:
            last_attempt_ids[key] = attempt_ids[-1]
        sv = r.get("saved_variant")
        if sv:
            saved_variants[key] = sv
    return {"statuses": statuses, "last_attempt_ids": last_attempt_ids, "saved_variants": saved_variants}


# --- Disputes ---

@router.post("/dispute", response_model=DisputeResponse)
async def create_dispute(
    req: DisputeCreateRequest,
    user: dict = Depends(get_current_user),
):
    """Student disputes a grading result."""
    student_id = user["uid"]
    dispute_id = uuid.uuid4().hex

    # Solo students (no teacher) → auto-accept dispute immediately
    has_teachers = await db.has_active_teacher_links(student_id)

    dispute_data = {
        "dispute_id": dispute_id,
        "student_id": student_id,
        "attempt_id": req.attempt_id,
        "workbook_id": req.workbook_id,
        "page": req.page,
        "number": req.number,
        "student_answer": req.student_answer,
        "correct_answer": req.correct_answer,
        "problem_description": req.problem_description,
        "source": req.source.value,
        "status": "accepted" if not has_teachers else "pending",
    }
    await db.create_dispute(dispute_id, dispute_data)

    if not has_teachers:
        # Auto-accept: mark study record as correct
        firestore_db = db.get_db()
        record_id = db._study_record_id(student_id, req.workbook_id, req.page, req.number)
        doc_ref = firestore_db.collection("study_records").document(record_id)
        try:
            await doc_ref.update({"status": StudyStatus.CORRECT.value})
        except Exception:
            pass
    else:
        # Normal flow: mark as disputed (blocks further progression)
        await db.upsert_study_record(
            student_id, req.workbook_id, req.page, req.number,
            {"status": StudyStatus.DISPUTED.value},
        )

    return DisputeResponse(**dispute_data)


@router.post("/dispute/{dispute_id}/resolve", response_model=DisputeResponse)
async def resolve_dispute(
    dispute_id: str,
    req: DisputeResolveRequest,
    user: dict = Depends(get_current_user),
):
    """Admin resolves a dispute — accept (mark correct) or reject (keep wrong)."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Only admins can resolve disputes.")

    dispute = await db.get_dispute(dispute_id)
    if not dispute:
        raise HTTPException(404, "Dispute not found.")

    # Verify teacher owns this student
    if not await _verify_teacher_owns_student(user["uid"], dispute.get("student_id", "")):
        raise HTTPException(403, "This student is not linked to you.")

    if dispute["status"] != "pending":
        raise HTTPException(400, "This dispute has already been resolved.")

    new_status = "accepted" if req.accepted else "rejected"
    await db.update_dispute(dispute_id, {
        "status": new_status,
        "admin_note": req.admin_note,
    })

    # Update study record based on resolution
    student_id = dispute["student_id"]
    workbook_id = dispute["workbook_id"]
    page = dispute["page"]
    number = dispute["number"]

    # Force-update study record (bypasses PROTECTED_STUDY_STATUSES for disputed → correct/wrong)
    firestore_db = db.get_db()
    record_id = db._study_record_id(student_id, workbook_id, page, number)
    doc_ref = firestore_db.collection("study_records").document(record_id)

    if req.accepted:
        # Accepted → mark as correct, delete mistake card
        await doc_ref.update({"status": StudyStatus.CORRECT.value})
        # Delete associated mistake card if exists
        card_id = f"{student_id}_{dispute.get('concept_tag', 'unknown')}_{workbook_id}_{page}_{number}"
        await db.delete_mistake_card(card_id)
    else:
        # Rejected → revert to wrong
        await doc_ref.update({"status": StudyStatus.WRONG.value})

    dispute["status"] = new_status
    dispute["admin_note"] = req.admin_note
    return DisputeResponse(**dispute)


@router.delete("/dispute/{dispute_id}")
async def delete_dispute(
    dispute_id: str,
    user: dict = Depends(get_current_user),
):
    """Admin deletes a resolved dispute record."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Only admins can delete disputes.")

    dispute = await db.get_dispute(dispute_id)
    if not dispute:
        raise HTTPException(404, "Dispute not found.")

    await db.delete_dispute(dispute_id)
    return {"ok": True}


@router.get("/disputes")
async def list_all_disputes(
    status: str = "pending",
    user: dict = Depends(get_current_user),
):
    """Admin lists all disputes across all workbooks."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Only admins can access this resource.")

    disputes = await db.list_all_disputes(user["uid"], status)

    # Enrich with workbook labels
    wb_cache: dict[str, str] = {}
    for d in disputes:
        wid = d.get("workbook_id", "")
        if wid and wid not in wb_cache:
            wb_doc = await db.get_workbook(wid)
            wb_cache[wid] = wb_doc.get("label", wid) if wb_doc else wid
        d["workbook_label"] = wb_cache.get(wid, wid)

    return {"disputes": [DisputeResponse(**d) for d in disputes]}


# --- Regen Requests ---

@router.post("/regen-request", response_model=RegenRequestResponse)
async def create_regen_request(
    req: RegenRequestCreateRequest,
    user: dict = Depends(get_current_user),
):
    """Student requests variant regeneration when generated problem is bad."""
    request_id = str(uuid.uuid4())
    student_id = user["uid"]

    # Solo students → auto-accept regen request
    has_teachers = await db.has_active_teacher_links(student_id)

    request_data = {
        "request_id": request_id,
        "status": "accepted" if not has_teachers else "pending",
        "student_id": student_id,
        "card_id": req.card_id,
        "workbook_id": req.workbook_id,
        "page": req.page,
        "number": req.number,
        "variant_text": req.variant_text,
        "correct_answer": req.correct_answer,
        "problem_description": req.problem_description,
    }
    await db.create_regen_request(request_id, request_data)

    # Lock the problem if teacher-linked (pending review)
    if has_teachers and req.workbook_id:
        firestore_db = db.get_db()
        record_id = db._study_record_id(student_id, req.workbook_id, req.page, req.number)
        doc_ref = firestore_db.collection("study_records").document(record_id)
        doc = await doc_ref.get()
        if doc.exists:
            await doc_ref.update({"status": "regen_pending"})

    return RegenRequestResponse(**request_data)


@router.get("/regen-requests")
async def list_regen_requests(
    status: str = "pending",
    user: dict = Depends(get_current_user),
):
    """Admin lists all regen requests."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Only admins can access this resource.")

    requests = await db.list_all_regen_requests(user["uid"], status)

    # Enrich with workbook labels
    wb_cache: dict[str, str] = {}
    for r in requests:
        wid = r.get("workbook_id", "")
        if wid and wid not in wb_cache:
            wb_doc = await db.get_workbook(wid)
            wb_cache[wid] = wb_doc.get("label", wid) if wb_doc else wid
        r["workbook_label"] = wb_cache.get(wid, wid)

    return {"requests": [RegenRequestResponse(**r) for r in requests]}


@router.post("/regen-request/{request_id}/resolve", response_model=RegenRequestResponse)
async def resolve_regen_request(
    request_id: str,
    req: RegenResolveRequest,
    user: dict = Depends(get_current_user),
):
    """Admin resolves a regen request — accept (regenerate variant) or reject."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Only admins can resolve regen requests.")

    regen = await db.get_regen_request(request_id)
    if not regen:
        raise HTTPException(404, "Regen request not found.")

    # Verify teacher owns this student
    if not await _verify_teacher_owns_student(user["uid"], regen.get("student_id", "")):
        raise HTTPException(403, "This student is not linked to you.")

    if regen["status"] != "pending":
        raise HTTPException(400, "This request has already been resolved.")

    new_status = "accepted" if req.accepted else "rejected"
    await db.update_regen_request(request_id, {
        "status": new_status,
        "admin_note": req.admin_note,
    })

    # Unlock problem: revert from regen_pending → coached (so student can retry verify)
    student_id = regen.get("student_id")
    workbook_id = regen.get("workbook_id")
    page = regen.get("page")
    number = regen.get("number")
    if student_id and workbook_id and page is not None and number is not None:
        firestore_db = db.get_db()
        record_id = db._study_record_id(student_id, workbook_id, page, number)
        doc_ref = firestore_db.collection("study_records").document(record_id)
        doc = await doc_ref.get()
        if doc.exists and doc.to_dict().get("status") == "regen_pending":
            update_data: dict[str, Any] = {"status": StudyStatus.COACHED.value}
            # Rejected → save the original variant so student sees it again
            if not req.accepted:
                update_data["saved_variant"] = {
                    "display_text": regen.get("variant_text", ""),
                    "correct_answer": regen.get("correct_answer", ""),
                }
            await doc_ref.update(update_data)

    regen["status"] = new_status
    regen["admin_note"] = req.admin_note
    return RegenRequestResponse(**regen)


@router.delete("/regen-request/{request_id}")
async def delete_regen_request(
    request_id: str,
    user: dict = Depends(get_current_user),
):
    """Admin deletes a resolved regen request record."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Only admins can delete regen requests.")

    regen = await db.get_regen_request(request_id)
    if not regen:
        raise HTTPException(404, "Regen request not found.")

    await db.delete_regen_request(request_id)
    return {"ok": True}
