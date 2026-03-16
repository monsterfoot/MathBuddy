"""Firestore CRUD operations."""

import logging
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

from google.cloud import firestore

from config import (
    COL_ANSWER_KEYS,
    COL_ATTEMPTS,
    COL_COACHING_SESSIONS,
    COL_DISPUTES,
    COL_MISTAKE_CARDS,
    COL_SCAN_SESSIONS,
    COL_STUDY_RECORDS,
    COL_TEACHER_STUDENT_LINKS,
    COL_USERS,
    COL_VARIANT_TEMPLATES,
    COL_WORKBOOKS,
    PROTECTED_STUDY_STATUSES,
)

_db: Optional[firestore.AsyncClient] = None


def get_db() -> firestore.AsyncClient:
    global _db
    if _db is None:
        _db = firestore.AsyncClient()
    return _db


# --- Users ---

async def create_user(uid: str, data: dict[str, Any]) -> None:
    db = get_db()
    await db.collection(COL_USERS).document(uid).set(data)


async def get_user(uid: str) -> Optional[dict]:
    db = get_db()
    doc = await db.collection(COL_USERS).document(uid).get()
    return doc.to_dict() if doc.exists else None


async def get_user_by_email(email: str) -> Optional[dict]:
    db = get_db()
    docs = (
        db.collection(COL_USERS)
        .where("email", "==", email)
        .limit(1)
        .stream()
    )
    async for doc in docs:
        return doc.to_dict()
    return None


async def list_students_for_admin(admin_uid: str) -> list[dict]:
    db = get_db()
    from google.cloud.firestore_v1.base_query import FieldFilter

    docs = (
        db.collection(COL_USERS)
        .where(filter=FieldFilter("admin_uid", "==", admin_uid))
        .where(filter=FieldFilter("role", "==", "student"))
        .stream()
    )
    return [doc.to_dict() async for doc in docs]


async def update_user(uid: str, data: dict[str, Any]) -> None:
    db = get_db()
    await db.collection(COL_USERS).document(uid).update(data)


# --- Workbooks ---

async def create_workbook(workbook_id: str, data: dict[str, Any]) -> None:
    db = get_db()
    data["created_at"] = datetime.now(timezone.utc)
    await db.collection(COL_WORKBOOKS).document(workbook_id).set(data)


async def get_workbook(workbook_id: str) -> Optional[dict]:
    db = get_db()
    doc = await db.collection(COL_WORKBOOKS).document(workbook_id).get()
    return doc.to_dict() if doc.exists else None


async def list_workbooks() -> list[dict]:
    """List all workbooks (legacy — use filtered versions below)."""
    db = get_db()
    docs = db.collection(COL_WORKBOOKS).order_by("created_at", direction=firestore.Query.DESCENDING).stream()
    return [doc.to_dict() async for doc in docs]


async def list_workbooks_for_admin(admin_uid: str) -> list[dict]:
    """List workbooks: own workbooks + all public locked workbooks from other teachers."""
    db = get_db()
    from google.cloud.firestore_v1.base_query import FieldFilter

    # 1. Own workbooks (all statuses)
    own_ids = set()
    try:
        own_docs = (
            db.collection(COL_WORKBOOKS)
            .where(filter=FieldFilter("owner_uid", "==", admin_uid))
            .stream()
        )
        own_list = [doc.to_dict() async for doc in own_docs]
        for w in own_list:
            own_ids.add(w.get("workbook_id"))
    except Exception:
        own_list = []

    # 2. Public locked workbooks (from any teacher)
    try:
        pub_docs = (
            db.collection(COL_WORKBOOKS)
            .where(filter=FieldFilter("visibility", "==", "public"))
            .where(filter=FieldFilter("status", "==", "locked"))
            .stream()
        )
        pub_list = [doc.to_dict() async for doc in pub_docs if doc.to_dict().get("workbook_id") not in own_ids]
    except Exception:
        pub_list = []

    combined = own_list + pub_list
    combined.sort(key=lambda d: d.get("created_at", datetime.min), reverse=True)
    return combined


async def list_workbooks_for_student(student_uid: str) -> list[dict]:
    """List workbooks that a student is assigned to."""
    db = get_db()
    from google.cloud.firestore_v1.base_query import FieldFilter

    try:
        docs = (
            db.collection(COL_WORKBOOKS)
            .where(filter=FieldFilter("assigned_student_uids", "array_contains", student_uid))
            .order_by("created_at", direction=firestore.Query.DESCENDING)
            .stream()
        )
        return [doc.to_dict() async for doc in docs]
    except Exception:
        # Fallback: query without ordering if composite index not ready
        docs = (
            db.collection(COL_WORKBOOKS)
            .where(filter=FieldFilter("assigned_student_uids", "array_contains", student_uid))
            .stream()
        )
        return [doc.to_dict() async for doc in docs]


async def assign_student_to_workbook(workbook_id: str, student_uid: str) -> None:
    """Add a student UID to the workbook's assigned_student_uids array."""
    db = get_db()
    await db.collection(COL_WORKBOOKS).document(workbook_id).update({
        "assigned_student_uids": firestore.ArrayUnion([student_uid]),
    })


async def unassign_student_from_workbook(workbook_id: str, student_uid: str) -> None:
    """Remove a student UID from the workbook's assigned_student_uids array."""
    db = get_db()
    await db.collection(COL_WORKBOOKS).document(workbook_id).update({
        "assigned_student_uids": firestore.ArrayRemove([student_uid]),
    })


async def get_aggregated_problem_stats(workbook_id: str, assigned_student_uids: list[str] | None = None) -> dict:
    """Aggregate study_records by problem for a workbook across assigned students only.

    Returns dict like: {"1_3": {"correct": 2, "wrong": 1, "mastered": 0}}
    """
    db = get_db()
    from google.cloud.firestore_v1.base_query import FieldFilter

    try:
        docs = (
            db.collection(COL_STUDY_RECORDS)
            .where(filter=FieldFilter("workbook_id", "==", workbook_id))
            .stream()
        )
        assigned_set = set(assigned_student_uids) if assigned_student_uids is not None else None
        stats: dict[str, dict[str, int]] = {}
        async for doc in docs:
            data = doc.to_dict()
            if not data:
                continue
            # Filter to assigned students only
            if assigned_set is not None and data.get("student_id") not in assigned_set:
                continue
            key = f"{data.get('page', 0)}_{data.get('number', 0)}"
            status = data.get("status", "wrong")
            if key not in stats:
                stats[key] = {"correct": 0, "wrong": 0, "coached": 0, "mastered": 0}
            if status in stats[key]:
                stats[key][status] += 1
        return stats
    except Exception:
        return {}


async def update_workbook(workbook_id: str, data: dict[str, Any]) -> None:
    db = get_db()
    await db.collection(COL_WORKBOOKS).document(workbook_id).update(data)


async def delete_workbook(workbook_id: str) -> None:
    db = get_db()
    # Delete answer_keys subcollection first
    ak_docs = db.collection(COL_WORKBOOKS).document(workbook_id).collection(COL_ANSWER_KEYS).stream()
    async for doc in ak_docs:
        await doc.reference.delete()
    await db.collection(COL_WORKBOOKS).document(workbook_id).delete()


# --- Answer Keys ---

async def set_answer_key(workbook_id: str, page: int, number: int, data: dict[str, Any]) -> None:
    db = get_db()
    doc_id = f"{page}_{number}"
    await (
        db.collection(COL_WORKBOOKS)
        .document(workbook_id)
        .collection(COL_ANSWER_KEYS)
        .document(doc_id)
        .set(data)
    )


async def delete_answer_key(workbook_id: str, page: int, number: int) -> None:
    db = get_db()
    doc_id = f"{page}_{number}"
    await (
        db.collection(COL_WORKBOOKS)
        .document(workbook_id)
        .collection(COL_ANSWER_KEYS)
        .document(doc_id)
        .delete()
    )


def _ensure_answer_key_defaults(data: dict) -> dict:
    """Ensure answer key has review_enabled/verify_enabled defaults."""
    data.setdefault("review_enabled", True)
    data.setdefault("verify_enabled", True)
    return data


async def get_answer_key(workbook_id: str, page: int, number: int) -> Optional[dict]:
    db = get_db()
    doc_id = f"{page}_{number}"
    doc = await (
        db.collection(COL_WORKBOOKS)
        .document(workbook_id)
        .collection(COL_ANSWER_KEYS)
        .document(doc_id)
        .get()
    )
    if not doc.exists:
        return None
    return _ensure_answer_key_defaults(doc.to_dict())


async def list_answer_keys(workbook_id: str) -> list[dict]:
    db = get_db()
    docs = (
        db.collection(COL_WORKBOOKS)
        .document(workbook_id)
        .collection(COL_ANSWER_KEYS)
        .stream()
    )
    return [_ensure_answer_key_defaults(doc.to_dict()) async for doc in docs]


async def batch_set_answer_keys(workbook_id: str, entries: list[dict]) -> int:
    """Write multiple answer key entries in a batch.

    Args:
        workbook_id: The workbook to write into.
        entries: List of answer key dicts, each with 'page' and 'number'.

    Returns:
        Number of entries written.
    """
    db = get_db()
    batch = db.batch()
    count = 0

    for entry in entries:
        page = entry["page"]
        number = entry["number"]
        doc_id = f"{page}_{number}"
        doc_ref = (
            db.collection(COL_WORKBOOKS)
            .document(workbook_id)
            .collection(COL_ANSWER_KEYS)
            .document(doc_id)
        )
        batch.set(doc_ref, entry)
        count += 1

    await batch.commit()
    return count


async def get_next_answer_key(
    workbook_id: str, current_page: int, current_number: int,
) -> Optional[dict]:
    """Find the next available answer key after (current_page, current_number).

    Returns dict with page/number or None if no more problems.
    """
    db = get_db()
    docs = (
        db.collection(COL_WORKBOOKS)
        .document(workbook_id)
        .collection(COL_ANSWER_KEYS)
        .stream()
    )
    all_keys = [doc.to_dict() async for doc in docs]

    # Sort by (page, number)
    all_keys.sort(key=lambda x: (x.get("page", 0), x.get("number", 0)))

    for key in all_keys:
        p, n = key.get("page", 0), key.get("number", 0)
        if (p, n) > (current_page, current_number):
            return {"page": p, "number": n}

    return None


# --- Attempts ---

async def create_attempt(attempt_id: str, data: dict[str, Any]) -> None:
    db = get_db()
    data["created_at"] = datetime.now(timezone.utc)
    await db.collection(COL_ATTEMPTS).document(attempt_id).set(data)


async def get_attempt(attempt_id: str) -> Optional[dict]:
    db = get_db()
    doc = await db.collection(COL_ATTEMPTS).document(attempt_id).get()
    return doc.to_dict() if doc.exists else None


# --- Mistake Cards ---

async def get_mistake_card(card_id: str) -> Optional[dict]:
    db = get_db()
    doc = await db.collection(COL_MISTAKE_CARDS).document(card_id).get()
    return doc.to_dict() if doc.exists else None


async def upsert_mistake_card(card_id: str, data: dict[str, Any]) -> None:
    db = get_db()
    await db.collection(COL_MISTAKE_CARDS).document(card_id).set(data, merge=True)


async def list_all_mistake_cards(student_id: str, limit: int = 100) -> list[dict]:
    """List all mistake cards for a student (regardless of due date)."""
    db = get_db()
    try:
        from google.cloud.firestore_v1.base_query import FieldFilter
        docs = (
            db.collection(COL_MISTAKE_CARDS)
            .where(filter=FieldFilter("student_id", "==", student_id))
            .order_by("due_at")
            .limit(limit)
            .stream()
        )
        return [doc.to_dict() async for doc in docs]
    except Exception:
        return []


async def delete_mistake_card(card_id: str) -> bool:
    """Delete a single mistake card. Returns True if it existed."""
    db = get_db()
    doc_ref = db.collection(COL_MISTAKE_CARDS).document(card_id)
    doc = await doc_ref.get()
    if not doc.exists:
        return False
    await doc_ref.delete()
    return True


async def delete_all_mistake_cards(student_id: str) -> int:
    """Delete all mistake cards for a student. Returns count deleted."""
    db = get_db()
    try:
        from google.cloud.firestore_v1.base_query import FieldFilter
        docs = (
            db.collection(COL_MISTAKE_CARDS)
            .where(filter=FieldFilter("student_id", "==", student_id))
            .stream()
        )
        count = 0
        async for doc in docs:
            await doc.reference.delete()
            count += 1
        return count
    except Exception:
        return 0


async def get_due_cards(student_id: str, limit: int = 10) -> list[dict]:
    db = get_db()
    now = datetime.now(timezone.utc)
    try:
        from google.cloud.firestore_v1.base_query import FieldFilter
        docs = (
            db.collection(COL_MISTAKE_CARDS)
            .where(filter=FieldFilter("student_id", "==", student_id))
            .where(filter=FieldFilter("due_at", "<=", now))
            .order_by("due_at")
            .limit(limit)
            .stream()
        )
        return [doc.to_dict() async for doc in docs]
    except Exception:
        # Composite index may not exist yet — return empty list gracefully
        return []


# --- Coaching Sessions ---

async def create_coaching_session(session_id: str, data: dict[str, Any]) -> None:
    db = get_db()
    data["started_at"] = datetime.now(timezone.utc)
    await db.collection(COL_COACHING_SESSIONS).document(session_id).set(data)


async def update_coaching_session(session_id: str, data: dict[str, Any]) -> None:
    db = get_db()
    await db.collection(COL_COACHING_SESSIONS).document(session_id).update(data)


# --- Scan Sessions ---

async def create_scan_session(session_id: str, data: dict[str, Any]) -> None:
    db = get_db()
    data["created_at"] = datetime.now(timezone.utc)
    await db.collection(COL_SCAN_SESSIONS).document(session_id).set(data)


async def get_scan_session(session_id: str) -> Optional[dict]:
    db = get_db()
    doc = await db.collection(COL_SCAN_SESSIONS).document(session_id).get()
    return doc.to_dict() if doc.exists else None


async def update_scan_session(session_id: str, data: dict[str, Any]) -> None:
    db = get_db()
    await db.collection(COL_SCAN_SESSIONS).document(session_id).update(data)


# --- Variant Templates ---

async def get_variant_template(template_id: str) -> Optional[dict]:
    db = get_db()
    doc = await db.collection(COL_VARIANT_TEMPLATES).document(template_id).get()
    return doc.to_dict() if doc.exists else None


async def list_variant_templates_by_tag(concept_tag: str) -> list[dict]:
    db = get_db()
    docs = (
        db.collection(COL_VARIANT_TEMPLATES)
        .where("concept_tag", "==", concept_tag)
        .stream()
    )
    return [doc.to_dict() async for doc in docs]


# --- Study Records ---

def _study_record_id(student_id: str, workbook_id: str, page: int, number: int) -> str:
    """Deterministic doc ID so one record per student+problem."""
    return f"{student_id}_{workbook_id}_{page}_{number}"


async def upsert_study_record(
    student_id: str,
    workbook_id: str,
    page: int,
    number: int,
    data: dict[str, Any],
) -> str:
    """Create or update a study record. Returns the record_id."""
    db = get_db()
    record_id = _study_record_id(student_id, workbook_id, page, number)
    now = datetime.now(timezone.utc)

    doc_ref = db.collection(COL_STUDY_RECORDS).document(record_id)
    doc = await doc_ref.get()

    if doc.exists:
        # Merge: append attempt_ids, update status/timestamps
        existing = doc.to_dict() or {}

        # Protect terminal statuses — never downgrade correct/mastered
        existing_status = existing.get("status")
        if existing_status in PROTECTED_STUDY_STATUSES and "status" in data:
            data.pop("status")

        existing_attempts = existing.get("attempt_ids", [])
        new_attempts = data.get("attempt_ids", [])
        merged_attempts = list(dict.fromkeys(existing_attempts + new_attempts))
        data["attempt_ids"] = merged_attempts
        data["updated_at"] = now
        await doc_ref.update(data)
    else:
        data["record_id"] = record_id
        data["student_id"] = student_id
        data["workbook_id"] = workbook_id
        data["page"] = page
        data["number"] = number
        data["created_at"] = now
        data["updated_at"] = now
        await doc_ref.set(data)

    return record_id


async def get_study_record(
    student_id: str, workbook_id: str, page: int, number: int,
) -> Optional[dict]:
    db = get_db()
    record_id = _study_record_id(student_id, workbook_id, page, number)
    doc = await db.collection(COL_STUDY_RECORDS).document(record_id).get()
    return doc.to_dict() if doc.exists else None


async def list_study_records_by_status(
    student_id: str, status: str, limit: int = 50,
) -> list[dict]:
    """List study records filtered by status (correct/wrong/mastered)."""
    db = get_db()
    try:
        from google.cloud.firestore_v1.base_query import FieldFilter
        docs = (
            db.collection(COL_STUDY_RECORDS)
            .where(filter=FieldFilter("student_id", "==", student_id))
            .where(filter=FieldFilter("status", "==", status))
            .order_by("updated_at", direction=firestore.Query.DESCENDING)
            .limit(limit)
            .stream()
        )
        return [doc.to_dict() async for doc in docs]
    except Exception:
        return []


async def list_study_records_for_workbook(
    student_id: str, workbook_id: str,
) -> list[dict]:
    """List all study records for a student + workbook (for problem status grid)."""
    db = get_db()
    try:
        from google.cloud.firestore_v1.base_query import FieldFilter
        docs = (
            db.collection(COL_STUDY_RECORDS)
            .where(filter=FieldFilter("student_id", "==", student_id))
            .where(filter=FieldFilter("workbook_id", "==", workbook_id))
            .stream()
        )
        return [doc.to_dict() async for doc in docs]
    except Exception:
        return []


# --- Student Dashboard (Admin) ---

async def get_student_workbook_summary(student_uid: str) -> list[dict]:
    """Per-workbook progress summary for a student.

    Returns list of {workbook_id, label, total, correct, wrong, mastered}.
    """
    db = get_db()
    try:
        from google.cloud.firestore_v1.base_query import FieldFilter

        # Get all study records for this student
        docs = (
            db.collection(COL_STUDY_RECORDS)
            .where(filter=FieldFilter("student_id", "==", student_uid))
            .stream()
        )

        # Aggregate by workbook_id
        wb_stats: dict[str, dict] = {}
        async for doc in docs:
            data = doc.to_dict()
            if not data:
                continue
            wid = data.get("workbook_id", "")
            if wid not in wb_stats:
                wb_stats[wid] = {"workbook_id": wid, "correct": 0, "wrong": 0, "coached": 0, "mastered": 0}
            status = data.get("status", "wrong")
            if status in ("correct", "wrong", "coached", "mastered"):
                wb_stats[wid][status] += 1

        # Enrich with workbook labels and total problem count
        result = []
        for wid, stats in wb_stats.items():
            wb = await get_workbook(wid)
            stats["label"] = wb.get("label", wid) if wb else wid
            # total = workbook's actual problem count (not just attempted)
            stats["total"] = wb.get("problem_count", 0) if wb else 0
            result.append(stats)

        return result
    except Exception:
        return []


async def get_student_review_stats(student_uid: str) -> dict:
    """Review card statistics for a student."""
    db = get_db()
    now = datetime.now(timezone.utc)
    try:
        from google.cloud.firestore_v1.base_query import FieldFilter

        all_cards = (
            db.collection(COL_MISTAKE_CARDS)
            .where(filter=FieldFilter("student_id", "==", student_uid))
            .stream()
        )

        total = 0
        due = 0
        async for doc in all_cards:
            total += 1
            data = doc.to_dict()
            if data and data.get("due_at") and data["due_at"] <= now:
                due += 1

        return {"total_cards": total, "due_cards": due}
    except Exception:
        return {"total_cards": 0, "due_cards": 0}


async def list_recent_attempts(student_uid: str, limit: int = 20) -> list[dict]:
    """List recent attempts for a student, newest first."""
    db = get_db()
    try:
        from google.cloud.firestore_v1.base_query import FieldFilter

        docs = (
            db.collection(COL_ATTEMPTS)
            .where(filter=FieldFilter("student_id", "==", student_uid))
            .order_by("created_at", direction=firestore.Query.DESCENDING)
            .limit(limit)
            .stream()
        )
        return [doc.to_dict() async for doc in docs]
    except Exception:
        return []


# --- Disputes (오채점) ---

async def create_dispute(dispute_id: str, data: dict[str, Any]) -> None:
    db = get_db()
    data["created_at"] = datetime.now(timezone.utc)
    await db.collection(COL_DISPUTES).document(dispute_id).set(data)


async def get_dispute(dispute_id: str) -> Optional[dict]:
    db = get_db()
    doc = await db.collection(COL_DISPUTES).document(dispute_id).get()
    return doc.to_dict() if doc.exists else None


async def list_disputes_for_workbook(workbook_id: str, status: str = "pending") -> list[dict]:
    """List disputes for a workbook filtered by status."""
    db = get_db()
    try:
        from google.cloud.firestore_v1.base_query import FieldFilter

        docs = (
            db.collection(COL_DISPUTES)
            .where(filter=FieldFilter("workbook_id", "==", workbook_id))
            .where(filter=FieldFilter("status", "==", status))
            .stream()
        )
        return [doc.to_dict() async for doc in docs]
    except Exception as e:
        logger.exception("list_disputes_for_workbook failed: %s", e)
        return []


async def list_all_disputes(admin_uid: str, status: str = "pending") -> list[dict]:
    """List disputes from the teacher's linked students only."""
    db = get_db()
    try:
        from google.cloud.firestore_v1.base_query import FieldFilter

        # Get teacher's linked student UIDs
        links = await list_students_for_teacher(admin_uid)
        student_uids = {l.get("student_uid") for l in links}
        # Also include students with legacy admin_uid
        legacy_docs = (
            db.collection(COL_USERS)
            .where(filter=FieldFilter("admin_uid", "==", admin_uid))
            .stream()
        )
        async for doc in legacy_docs:
            student_uids.add(doc.to_dict().get("uid"))

        if not student_uids:
            return []

        docs = (
            db.collection(COL_DISPUTES)
            .where(filter=FieldFilter("status", "==", status))
            .stream()
        )
        results = [
            doc.to_dict() async for doc in docs
            if doc.to_dict().get("student_id") in student_uids
        ]
        results.sort(key=lambda d: d.get("created_at", datetime.min), reverse=True)
        return results
    except Exception as e:
        logger.exception("list_all_disputes failed: %s", e)
        return []


async def update_dispute(dispute_id: str, data: dict[str, Any]) -> None:
    db = get_db()
    data["resolved_at"] = datetime.now(timezone.utc)
    await db.collection(COL_DISPUTES).document(dispute_id).update(data)


async def delete_dispute(dispute_id: str) -> None:
    db = get_db()
    await db.collection(COL_DISPUTES).document(dispute_id).delete()


# --- Regen Requests (재출제 요청) ---

async def create_regen_request(request_id: str, data: dict[str, Any]) -> None:
    from config import COL_REGEN_REQUESTS
    db = get_db()
    data["created_at"] = datetime.now(timezone.utc)
    await db.collection(COL_REGEN_REQUESTS).document(request_id).set(data)


async def get_regen_request(request_id: str) -> Optional[dict]:
    from config import COL_REGEN_REQUESTS
    db = get_db()
    doc = await db.collection(COL_REGEN_REQUESTS).document(request_id).get()
    return doc.to_dict() if doc.exists else None


async def list_all_regen_requests(admin_uid: str, status: str = "pending") -> list[dict]:
    """List regen requests from the teacher's linked students only."""
    from config import COL_REGEN_REQUESTS
    db = get_db()
    try:
        from google.cloud.firestore_v1.base_query import FieldFilter

        # Get teacher's linked student UIDs
        links = await list_students_for_teacher(admin_uid)
        student_uids = {l.get("student_uid") for l in links}
        legacy_docs = (
            db.collection(COL_USERS)
            .where(filter=FieldFilter("admin_uid", "==", admin_uid))
            .stream()
        )
        async for doc in legacy_docs:
            student_uids.add(doc.to_dict().get("uid"))

        if not student_uids:
            return []

        docs = (
            db.collection(COL_REGEN_REQUESTS)
            .where(filter=FieldFilter("status", "==", status))
            .stream()
        )
        results = [
            doc.to_dict() async for doc in docs
            if doc.to_dict().get("student_id") in student_uids
        ]
        results.sort(key=lambda d: d.get("created_at", datetime.min), reverse=True)
        return results
    except Exception as e:
        logger.exception("list_all_regen_requests failed: %s", e)
        return []


async def update_regen_request(request_id: str, data: dict[str, Any]) -> None:
    from config import COL_REGEN_REQUESTS
    db = get_db()
    data["resolved_at"] = datetime.now(timezone.utc)
    await db.collection(COL_REGEN_REQUESTS).document(request_id).update(data)


async def delete_regen_request(request_id: str) -> None:
    from config import COL_REGEN_REQUESTS
    db = get_db()
    await db.collection(COL_REGEN_REQUESTS).document(request_id).delete()


# --- Teacher-Student Links ---

def _link_id(teacher_uid: str, student_uid: str) -> str:
    return f"{teacher_uid}_{student_uid}"


async def create_teacher_student_link(teacher_uid: str, student_uid: str, data: dict[str, Any]) -> None:
    db = get_db()
    doc_id = _link_id(teacher_uid, student_uid)
    await db.collection(COL_TEACHER_STUDENT_LINKS).document(doc_id).set(data)


async def get_teacher_student_link(teacher_uid: str, student_uid: str) -> Optional[dict]:
    db = get_db()
    doc = await db.collection(COL_TEACHER_STUDENT_LINKS).document(_link_id(teacher_uid, student_uid)).get()
    return doc.to_dict() if doc.exists else None


async def deactivate_teacher_student_link(teacher_uid: str, student_uid: str) -> None:
    db = get_db()
    await db.collection(COL_TEACHER_STUDENT_LINKS).document(_link_id(teacher_uid, student_uid)).update({
        "status": "removed",
        "updated_at": datetime.now(timezone.utc),
    })


async def list_teachers_for_student(student_uid: str) -> list[dict]:
    """List active teacher links for a student."""
    db = get_db()
    from google.cloud.firestore_v1.base_query import FieldFilter
    try:
        docs = (
            db.collection(COL_TEACHER_STUDENT_LINKS)
            .where(filter=FieldFilter("student_uid", "==", student_uid))
            .where(filter=FieldFilter("status", "==", "active"))
            .stream()
        )
        return [doc.to_dict() async for doc in docs]
    except Exception as e:
        logger.exception("list_teachers_for_student failed: %s", e)
        return []


async def list_students_for_teacher(teacher_uid: str) -> list[dict]:
    """List active student links for a teacher."""
    db = get_db()
    from google.cloud.firestore_v1.base_query import FieldFilter
    try:
        docs = (
            db.collection(COL_TEACHER_STUDENT_LINKS)
            .where(filter=FieldFilter("teacher_uid", "==", teacher_uid))
            .where(filter=FieldFilter("status", "==", "active"))
            .stream()
        )
        return [doc.to_dict() async for doc in docs]
    except Exception as e:
        logger.exception("list_students_for_teacher failed: %s", e)
        return []


async def list_public_workbooks(student_uid: str | None = None) -> list[dict]:
    """List all public, locked workbooks, excluding those where student is already assigned."""
    db = get_db()
    from google.cloud.firestore_v1.base_query import FieldFilter
    try:
        docs = (
            db.collection(COL_WORKBOOKS)
            .where(filter=FieldFilter("visibility", "==", "public"))
            .where(filter=FieldFilter("status", "==", "locked"))
            .stream()
        )
        results = [doc.to_dict() async for doc in docs]
        # Exclude workbooks where this student is already assigned (they appear under teacher instead)
        if student_uid:
            results = [
                wb for wb in results
                if student_uid not in (wb.get("assigned_student_uids") or [])
            ]
        results.sort(key=lambda d: d.get("created_at", datetime.min), reverse=True)
        return results
    except Exception as e:
        logger.exception("list_public_workbooks failed: %s", e)
        return []


async def list_workbooks_by_owner_for_student(teacher_uid: str, student_uid: str) -> list[dict]:
    """List workbooks owned by a teacher that a student is assigned to."""
    db = get_db()
    from google.cloud.firestore_v1.base_query import FieldFilter
    try:
        docs = (
            db.collection(COL_WORKBOOKS)
            .where(filter=FieldFilter("owner_uid", "==", teacher_uid))
            .where(filter=FieldFilter("assigned_student_uids", "array_contains", student_uid))
            .stream()
        )
        results = [doc.to_dict() async for doc in docs]
        results.sort(key=lambda d: d.get("created_at", datetime.min), reverse=True)
        return results
    except Exception as e:
        logger.exception("list_workbooks_by_owner_for_student failed: %s", e)
        return []


async def has_active_teacher_links(student_uid: str) -> bool:
    """Check if a student has any active teacher links."""
    links = await list_teachers_for_student(student_uid)
    return len(links) > 0
