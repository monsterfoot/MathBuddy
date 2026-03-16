"""Review / spaced repetition endpoints."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from models.schemas import ReviewResponse, ReviewSubmit
from services import firestore_service as db
from services.auth_service import get_current_user
from services.scheduler_service import calculate_next_review

router = APIRouter()


async def _resolve_student_id(
    user: dict,
    student_uid: Optional[str] = None,
) -> str:
    """If admin provides student_uid, verify ownership via teacher_student_links.
    Otherwise return user's own uid."""
    if student_uid and user.get("role") == "admin":
        # Check new link model first
        link = await db.get_teacher_student_link(user["uid"], student_uid)
        if link and link.get("status") == "active":
            return student_uid
        # Legacy fallback
        student = await db.get_user(student_uid)
        if student and student.get("admin_uid") == user["uid"]:
            return student_uid
        raise HTTPException(403, "You do not have permission for this student.")
    return user["uid"]


@router.get("/cards")
async def list_all_cards(
    limit: int = 100,
    student_uid: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    """List all mistake cards. Admin can pass student_uid to view a student's cards."""
    student_id = await _resolve_student_id(user, student_uid)
    cards = await db.list_all_mistake_cards(student_id, limit=limit)
    return {"cards": cards, "count": len(cards)}


@router.delete("/cards/{card_id}")
async def delete_card(
    card_id: str,
    user: dict = Depends(get_current_user),
):
    """Delete a single mistake card."""
    card = await db.get_mistake_card(card_id)
    if not card:
        raise HTTPException(404, "Review card not found.")
    # Admin: verify the card belongs to one of their students
    if user.get("role") == "admin":
        card_student_id = card.get("student_id")
        if card_student_id:
            # Check new link model first, then legacy
            link = await db.get_teacher_student_link(user["uid"], card_student_id)
            has_access = link and link.get("status") == "active"
            if not has_access:
                student = await db.get_user(card_student_id)
                has_access = student is not None and student.get("admin_uid") == user["uid"]
            if not has_access:
                raise HTTPException(403, "You do not have permission for this student.")
    deleted = await db.delete_mistake_card(card_id)
    if not deleted:
        raise HTTPException(404, "Review card not found.")
    return {"deleted": True, "card_id": card_id}


@router.delete("/cards")
async def delete_all_cards(
    student_uid: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    """Delete all mistake cards. Admin can pass student_uid to target a student."""
    student_id = await _resolve_student_id(user, student_uid)
    count = await db.delete_all_mistake_cards(student_id)
    return {"deleted_count": count}


@router.get("/due")
async def get_due_cards(
    limit: int = 10,
    user: dict = Depends(get_current_user),
):
    student_id = user["uid"]
    cards = await db.get_due_cards(student_id, limit=limit)
    return {"cards": cards, "count": len(cards)}


@router.post("/submit", response_model=ReviewResponse)
async def submit_review(
    body: ReviewSubmit,
    user: dict = Depends(get_current_user),
):
    card = await db.get_mistake_card(body.card_id)
    if not card:
        raise HTTPException(404, "Review card not found.")

    updated = calculate_next_review(
        quality=body.quality_score,
        repetitions=card.get("repetitions", 0),
        ease_factor=card.get("ease_factor", 2.5),
        interval=card.get("interval", 1),
    )

    await db.upsert_mistake_card(body.card_id, updated)

    return ReviewResponse(
        card_id=body.card_id,
        is_correct=body.is_correct,
        next_due_at=updated["due_at"],
        quality_score=body.quality_score,
    )


@router.get("/stats")
async def get_review_stats(
    student_uid: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    student_id = await _resolve_student_id(user, student_uid)
    cards = await db.get_due_cards(student_id, limit=100)
    return {
        "student_id": student_id,
        "due_count": len(cards),
    }
