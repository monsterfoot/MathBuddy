"""Workbook CRUD endpoints — with ownership and student assignment."""

import io
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import Response

from config import CONCEPT_TAG_DEFAULT, PROBLEM_TYPE_DEFAULT
from models.schemas import (
    AnswerKeyCreate,
    AnswerKeyEdit,
    AssignStudentRequest,
    MathConvertRequest,
    WorkbookCreate,
    WorkbookResponse,
    WorkbookUpdate,
)
from services import diagram_service
from services import firestore_service as db
from services import grading_service
from services import scan_service
from services import storage_service as storage
from services.math_expression import convert_math_text, latex_to_plain
from services.auth_service import get_current_user, require_admin

logger = logging.getLogger(__name__)

router = APIRouter()


# --- Helpers ---

async def _get_workbook_or_404(workbook_id: str) -> dict:
    wb = await db.get_workbook(workbook_id)
    if not wb:
        raise HTTPException(404, "Workbook not found")
    return wb


async def _require_owner(workbook_id: str, user: dict) -> dict:
    """Get workbook and verify the caller is the owner."""
    wb = await _get_workbook_or_404(workbook_id)
    if wb.get("owner_uid") and wb["owner_uid"] != user["uid"]:
        raise HTTPException(403, "Not the workbook owner")
    return wb


async def _require_admin_access(workbook_id: str, user: dict) -> dict:
    """Get workbook and verify the caller is an admin (any teacher, not just owner)."""
    wb = await _get_workbook_or_404(workbook_id)
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin access required")
    return wb


# --- CRUD ---

@router.post("", response_model=WorkbookResponse, status_code=201)
async def create_workbook(body: WorkbookCreate, user: dict = Depends(get_current_user)):
    workbook_id = uuid.uuid4().hex
    data = {
        "workbook_id": workbook_id,
        "label": body.label,
        "status": "draft",
        "visibility": body.visibility.value,
        "owner_uid": user["uid"],
        "assigned_student_uids": [],
        "cover_photo_url": None,
        "problem_count": 0,
        "answer_coverage": 0,
        "explanation_coverage": 0,
        "locked_at": None,
    }
    await db.create_workbook(workbook_id, data)
    wb = await db.get_workbook(workbook_id)
    return wb


@router.get("", response_model=list[WorkbookResponse])
async def list_workbooks(
    teacher_uid: str | None = None,
    user: dict = Depends(get_current_user),
):
    """List workbooks based on role and optional teacher filter.

    For students:
      - teacher_uid=solo → public locked workbooks
      - teacher_uid=<uid> → teacher's workbooks assigned to this student
      - no param → all assigned workbooks (backward compat)
    For admins: own workbooks (teacher_uid ignored).
    """
    role = user.get("role", "student")
    if role == "admin":
        return await db.list_workbooks_for_admin(user["uid"])

    if teacher_uid == "solo":
        return await db.list_public_workbooks(student_uid=user["uid"])
    elif teacher_uid:
        return await db.list_workbooks_by_owner_for_student(teacher_uid, user["uid"])
    else:
        return await db.list_workbooks_for_student(user["uid"])


@router.get("/{workbook_id}", response_model=WorkbookResponse)
async def get_workbook(workbook_id: str, user: dict = Depends(get_current_user)):
    wb = await _get_workbook_or_404(workbook_id)
    return wb


@router.post("/{workbook_id}/fork", response_model=WorkbookResponse, status_code=201)
async def fork_workbook(workbook_id: str, user: dict = Depends(require_admin)):
    """Copy a public workbook into the caller's own collection, including all answer keys."""
    source = await _get_workbook_or_404(workbook_id)
    if source.get("owner_uid") == user["uid"]:
        raise HTTPException(400, "Cannot fork your own workbook")
    if source.get("visibility") != "public":
        raise HTTPException(403, "Only public workbooks can be forked")

    new_id = uuid.uuid4().hex
    new_data = {
        "workbook_id": new_id,
        "label": source["label"],
        "status": source.get("status", "locked"),
        "visibility": "copied",  # forked copy — visibility locked
        "owner_uid": user["uid"],
        "assigned_student_uids": [],
        "cover_photo_url": source.get("cover_photo_url"),
        "problem_count": source.get("problem_count", 0),
        "answer_coverage": source.get("answer_coverage", 0),
        "explanation_coverage": source.get("explanation_coverage", 0),
        "locked_at": source.get("locked_at"),
        "forked_from": workbook_id,
    }
    await db.create_workbook(new_id, new_data)

    # Copy all answer keys
    keys = await db.list_answer_keys(workbook_id)
    for key in keys:
        await db.set_answer_key(new_id, key["page"], key["number"], key)

    wb = await db.get_workbook(new_id)
    return wb


@router.patch("/{workbook_id}", response_model=WorkbookResponse)
async def update_workbook_info(
    workbook_id: str, body: WorkbookUpdate, user: dict = Depends(get_current_user),
):
    """Update workbook metadata (e.g. label, visibility). Owner only."""
    wb = await _require_owner(workbook_id, user)
    update_data = body.model_dump(exclude_unset=True)
    # Block visibility change on copied (forked) workbooks
    if "visibility" in update_data and wb.get("visibility") == "copied":
        del update_data["visibility"]
    # Convert enum values to strings for Firestore
    if "visibility" in update_data and hasattr(update_data["visibility"], "value"):
        update_data["visibility"] = update_data["visibility"].value
    if update_data:
        await db.update_workbook(workbook_id, update_data)
    wb = await db.get_workbook(workbook_id)
    return wb


@router.get("/{workbook_id}/answer-keys")
async def list_workbook_answer_keys(
    workbook_id: str, user: dict = Depends(get_current_user),
):
    """List all answer keys for a workbook."""
    await _get_workbook_or_404(workbook_id)
    keys = await db.list_answer_keys(workbook_id)
    keys.sort(key=lambda x: (x.get("page", 0), x.get("number", 0)))
    return {"answer_keys": keys}


@router.post("/{workbook_id}/answer-key")
async def create_workbook_answer_key(
    workbook_id: str, body: AnswerKeyCreate,
    user: dict = Depends(get_current_user),
):
    """Create a single answer key manually. Owner only."""
    await _require_owner(workbook_id, user)

    existing = await db.get_answer_key(workbook_id, body.page, body.number)
    if existing:
        raise HTTPException(409, f"Page {body.page}, number {body.number} already exists")

    # image_dependent=True → verify must be disabled
    verify_enabled = body.verify_enabled
    if body.image_dependent:
        verify_enabled = False

    data = {
        "page": body.page,
        "number": body.number,
        "final_answer": body.final_answer,
        "answer_type": "short_answer",
        "problem_description": body.problem_description,
        "solution_steps": body.solution_steps,
        "pitfalls": body.pitfalls,
        "concept_tag": CONCEPT_TAG_DEFAULT,
        "problem_type": PROBLEM_TYPE_DEFAULT,
        "extraction_confidence": 1.0,
        "manually_corrected": True,
        "source_page_start": None,
        "source_page_end": None,
        "image_dependent": body.image_dependent,
        "problem_image_url": body.problem_image_url,
        "review_enabled": body.review_enabled,
        "verify_enabled": verify_enabled,
    }
    await db.set_answer_key(workbook_id, body.page, body.number, data)
    return data


@router.post("/{workbook_id}/math-convert")
async def math_convert(
    workbook_id: str, body: MathConvertRequest,
    user: dict = Depends(get_current_user),
):
    """Convert plain text math to KaTeX-wrapped text via Gemini."""
    await _get_workbook_or_404(workbook_id)
    result = await convert_math_text(body.text)
    return {"converted": result}


@router.patch("/{workbook_id}/answer-key/{page}/{number}")
async def edit_workbook_answer_key(
    workbook_id: str, page: int, number: int, body: AnswerKeyEdit,
    user: dict = Depends(get_current_user),
):
    """Edit a single answer key directly on a workbook. Owner only."""
    await _require_owner(workbook_id, user)

    existing = await db.get_answer_key(workbook_id, page, number)
    if not existing:
        raise HTTPException(404, f"Answer key {page}_{number} not found")

    update_data = body.model_dump(exclude_unset=True)
    update_data["manually_corrected"] = True
    update_data["extraction_confidence"] = 1.0

    merged = {**existing, **update_data}

    # image_dependent=True → verify must be disabled
    if merged.get("image_dependent"):
        merged["verify_enabled"] = False

    await db.set_answer_key(workbook_id, page, number, merged)
    return merged


@router.delete("/{workbook_id}", status_code=204)
async def delete_workbook(workbook_id: str, user: dict = Depends(get_current_user)):
    """Delete a workbook. Owner only."""
    await _require_owner(workbook_id, user)
    await db.delete_workbook(workbook_id)


@router.put("/{workbook_id}/answer-key/{page}/{number}/problem-image")
async def upload_problem_image(
    workbook_id: str, page: int, number: int, file: UploadFile,
    user: dict = Depends(get_current_user),
):
    """Upload a problem image, extract description text via OCR."""
    await _require_owner(workbook_id, user)

    existing = await db.get_answer_key(workbook_id, page, number)
    if not existing:
        raise HTTPException(404, f"Answer key {page}_{number} not found")

    mime = file.content_type or "image/jpeg"
    contents = await file.read()

    description = await grading_service.extract_problem_description(
        image_bytes=contents,
        mime_type=mime,
    )
    if not description:
        raise HTTPException(422, "문항 이미지에서 문제를 추출할 수 없습니다. 더 선명한 이미지를 사용해 주세요.")

    existing["problem_description"] = description
    existing["manually_corrected"] = True
    await db.set_answer_key(workbook_id, page, number, existing)
    return existing


@router.delete("/{workbook_id}/answer-key/{page}/{number}")
async def delete_workbook_answer_key(
    workbook_id: str, page: int, number: int,
    user: dict = Depends(get_current_user),
):
    """Delete a single answer key from a workbook. Owner only."""
    await _require_owner(workbook_id, user)

    existing = await db.get_answer_key(workbook_id, page, number)
    if not existing:
        raise HTTPException(404, f"Answer key {page}_{number} not found")

    await db.delete_answer_key(workbook_id, page, number)
    return {"deleted": f"{page}_{number}"}


@router.put("/{workbook_id}/answer-key/{page}/{number}/explanation-image")
async def upload_explanation_image(
    workbook_id: str, page: int, number: int, file: UploadFile,
    user: dict = Depends(get_current_user),
):
    """Upload an explanation image, extract solution_steps and pitfalls via OCR. Owner only."""
    await _require_owner(workbook_id, user)

    existing = await db.get_answer_key(workbook_id, page, number)
    if not existing:
        raise HTTPException(404, f"Answer key {page}_{number} not found")

    image_bytes = await file.read()
    mime_type = file.content_type or "image/jpeg"
    blocks = await scan_service.extract_explanations(image_bytes, mime_type, [])
    if blocks:
        existing["solution_steps"] = blocks[0].get("solution_steps", [])
        existing["pitfalls"] = blocks[0].get("pitfalls", [])
    else:
        raise HTTPException(422, "해설 이미지에서 풀이를 추출할 수 없습니다.")

    existing["manually_corrected"] = True
    await db.set_answer_key(workbook_id, page, number, existing)
    return existing


@router.delete("/{workbook_id}/answer-key/{page}/{number}/problem-description")
async def delete_problem_description(
    workbook_id: str, page: int, number: int,
    user: dict = Depends(get_current_user),
):
    """Remove the problem description from an answer key. Owner only."""
    await _require_owner(workbook_id, user)

    existing = await db.get_answer_key(workbook_id, page, number)
    if not existing:
        raise HTTPException(404, f"Answer key {page}_{number} not found")

    existing["problem_description"] = None
    await db.set_answer_key(workbook_id, page, number, existing)
    return existing


@router.post("/{workbook_id}/answer-key/{page}/{number}/regenerate-diagram")
async def regenerate_diagram(
    workbook_id: str, page: int, number: int,
    user: dict = Depends(get_current_user),
):
    """Regenerate SVG diagram from existing problem_description [그림: ...] marker."""
    await _require_owner(workbook_id, user)

    existing = await db.get_answer_key(workbook_id, page, number)
    if not existing:
        raise HTTPException(404, f"Answer key {page}_{number} not found")

    desc = existing.get("problem_description") or ""
    diagram_desc = diagram_service.extract_diagram_description(desc)
    if not diagram_desc:
        raise HTTPException(400, "이 문제에는 [그림: ...] 마커가 없습니다.")

    # Try to load original question page image for visual reference
    source_img_bytes = None
    source_img_mime = None
    src_url = existing.get("source_question_page_url")
    if src_url:
        try:
            source_img_bytes, source_img_mime = storage.download_image(src_url)
        except Exception as e:
            logger.warning("Could not load source image for diagram regen: %s", e)

    svg = await diagram_service.generate_diagram_svg(
        entry=existing,
        diagram_description=diagram_desc,
        source_image_bytes=source_img_bytes,
        source_image_mime=source_img_mime,
    )
    if not svg:
        raise HTTPException(
            422, "다이어그램 생성에 실패했습니다. 서버 로그를 확인해 주세요.",
        )

    existing["diagram_svg"] = svg

    await db.set_answer_key(workbook_id, page, number, existing)
    return existing


@router.post("/{workbook_id}/answer-key/{page}/{number}/convert-to-text")
async def convert_to_text(
    workbook_id: str, page: int, number: int,
    user: dict = Depends(get_current_user),
):
    """Convert an image-interaction problem to text-only via LLM."""
    await _require_owner(workbook_id, user)

    existing = await db.get_answer_key(workbook_id, page, number)
    if not existing:
        raise HTTPException(404, f"Answer key {page}_{number} not found")

    desc = existing.get("problem_description") or ""
    if not desc:
        raise HTTPException(400, "문제 설명이 없습니다.")

    result = await diagram_service.convert_to_text_choice(
        desc, original_answer=existing.get("final_answer", ""),
    )
    if not result:
        raise HTTPException(422, "텍스트 변환에 실패했습니다.")

    existing["problem_description"] = result["converted_text"]
    if result.get("correct_answer"):
        existing["final_answer"] = result["correct_answer"]
    existing["image_dependent"] = False
    existing["diagram_svg"] = None
    existing["manually_corrected"] = True
    await db.set_answer_key(workbook_id, page, number, existing)
    return existing


@router.post("/{workbook_id}/upload-problem-image")
async def upload_problem_image_for_add(
    workbook_id: str, file: UploadFile,
    user: dict = Depends(get_current_user),
):
    """Upload a problem image for manual problem creation. Returns GCS URL."""
    await _require_owner(workbook_id, user)

    mime = file.content_type or "image/jpeg"
    contents = await file.read()
    gcs_url = storage.upload_image(
        io.BytesIO(contents), mime,
        folder=f"problem_images/{workbook_id}",
    )
    return {"url": gcs_url}


@router.post("/{workbook_id}/latex-to-plain")
async def latex_to_plain_endpoint(
    workbook_id: str, body: MathConvertRequest,
    user: dict = Depends(get_current_user),
):
    """Convert LaTeX-wrapped text to plain editable text (regex, no LLM)."""
    await _get_workbook_or_404(workbook_id)
    return {"plain": latex_to_plain(body.text)}


@router.get("/{workbook_id}/answer-key/{page}/{number}/source-image")
async def get_source_image(
    workbook_id: str, page: int, number: int,
    user: dict = Depends(get_current_user),
):
    """Proxy the source question page image for browser display (e.g. cropper)."""
    await _require_owner(workbook_id, user)

    existing = await db.get_answer_key(workbook_id, page, number)
    if not existing:
        raise HTTPException(404, f"Answer key {page}_{number} not found")

    gcs_path = existing.get("source_question_page_url")
    if not gcs_path:
        raise HTTPException(404, "No source image for this entry")

    try:
        img_bytes, mime = storage.download_image(gcs_path)
    except Exception:
        raise HTTPException(404, "Source image not found in storage")

    return Response(content=img_bytes, media_type=mime)


# --- Student assignment ---

@router.post("/{workbook_id}/assign")
async def assign_student(
    workbook_id: str, body: AssignStudentRequest,
    user: dict = Depends(require_admin),
):
    """Assign a student to this workbook. Owner only."""
    await _require_owner(workbook_id, user)

    # Verify student exists
    student = await db.get_user(body.student_uid)
    if not student:
        raise HTTPException(404, "Student not found")
    if student.get("role") != "student":
        raise HTTPException(400, "User is not a student")

    await db.assign_student_to_workbook(workbook_id, body.student_uid)
    return {"assigned": True, "student_uid": body.student_uid}


@router.delete("/{workbook_id}/assign/{student_uid}")
async def unassign_student(
    workbook_id: str, student_uid: str,
    user: dict = Depends(require_admin),
):
    """Remove a student's access to this workbook. Owner only."""
    await _require_owner(workbook_id, user)
    await db.unassign_student_from_workbook(workbook_id, student_uid)
    return {"unassigned": True, "student_uid": student_uid}


@router.get("/{workbook_id}/assignments")
async def list_assignments(
    workbook_id: str,
    user: dict = Depends(require_admin),
):
    """List all students assigned to this workbook."""
    wb = await _require_owner(workbook_id, user)
    student_uids = wb.get("assigned_student_uids", [])

    students = []
    for uid in student_uids:
        student = await db.get_user(uid)
        if student:
            students.append({
                "uid": student["uid"],
                "email": student.get("email", ""),
                "display_name": student.get("display_name", ""),
                "photo_url": student.get("photo_url"),
            })

    return {"students": students, "count": len(students)}


@router.get("/{workbook_id}/stats")
async def get_workbook_stats(
    workbook_id: str,
    user: dict = Depends(require_admin),
):
    """Get aggregated stats: per-problem count of correct/wrong/mastered across assigned students."""
    wb = await _require_owner(workbook_id, user)
    assigned = wb.get("assigned_student_uids", [])
    stats = await db.get_aggregated_problem_stats(workbook_id, assigned_student_uids=assigned)
    total_assigned = len(assigned)
    return {
        "workbook_id": workbook_id,
        "problem_stats": stats,
        "total_assigned": total_assigned,
    }


@router.get("/{workbook_id}/disputes")
async def list_disputes(
    workbook_id: str,
    status: str = "pending",
    user: dict = Depends(require_admin),
):
    """List disputes (오채점 이의제기) for a workbook."""
    await _require_owner(workbook_id, user)
    disputes = await db.list_disputes_for_workbook(workbook_id, status)
    return {"disputes": disputes}
