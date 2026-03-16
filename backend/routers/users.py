"""User management router — registration, profile, student listing."""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from models.schemas import UserProfile, UserRegisterRequest
from services import firestore_service as db
from services.auth_service import get_current_user, get_token_info, require_admin

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/register", response_model=UserProfile, status_code=201)
async def register_user(body: UserRegisterRequest, token_info: dict = Depends(get_token_info)):
    """Complete onboarding: create user profile with chosen role.

    Students can register solo (no admin_email) or with a teacher.
    Uses get_token_info (not get_current_user) because the user
    doesn't exist in Firestore yet at registration time.
    """
    # Check if user already registered
    existing = await db.get_user(token_info["uid"])
    if existing:
        raise HTTPException(status_code=409, detail="User already registered")

    now = datetime.now(timezone.utc)
    admin_uid = None

    # If student with teacher email, resolve admin
    if body.role == "student" and body.admin_email:
        admin = await db.get_user_by_email(body.admin_email)
        if not admin:
            raise HTTPException(status_code=404, detail="Admin not found with that email")
        if admin.get("role") != "admin":
            raise HTTPException(status_code=400, detail="The specified email does not belong to an admin")

        admin_uid = admin["uid"]

    user_data = {
        "uid": token_info["uid"],
        "email": token_info.get("email", ""),
        "display_name": token_info.get("display_name", ""),
        "photo_url": token_info.get("photo_url"),
        "role": body.role.value,
        "tier": "free",
        "admin_email": body.admin_email if body.role == "student" else None,
        "admin_uid": admin_uid,
        "approved": True,  # Auto-approve for now
        "created_at": now,
        "updated_at": now,
    }

    await db.create_user(token_info["uid"], user_data)

    # If student joined with teacher, create link + auto-assign workbooks
    if body.role == "student" and admin_uid:
        try:
            admin_user = await db.get_user(admin_uid)
            link_data = {
                "teacher_uid": admin_uid,
                "student_uid": token_info["uid"],
                "teacher_email": admin_user.get("email", "") if admin_user else body.admin_email,
                "teacher_display_name": admin_user.get("display_name", "") if admin_user else "",
                "student_email": token_info.get("email", ""),
                "student_display_name": token_info.get("display_name", ""),
                "status": "active",
                "created_at": now,
                "updated_at": now,
            }
            await db.create_teacher_student_link(admin_uid, token_info["uid"], link_data)
        except Exception as e:
            logger.warning("Create teacher link on register failed: %s", e)

        try:
            workbooks = await db.list_workbooks_for_admin(admin_uid)
            for wb in workbooks:
                await db.assign_student_to_workbook(wb["workbook_id"], token_info["uid"])
            logger.info(
                "Auto-assigned %d workbooks from admin %s to student %s",
                len(workbooks), admin_uid, token_info["uid"],
            )
        except Exception as e:
            logger.warning("Auto-assign workbooks failed: %s", e)

    return user_data


@router.get("/me", response_model=UserProfile)
async def get_my_profile(user: dict = Depends(get_current_user)):
    """Get the current authenticated user's profile."""
    return user


@router.get("/students")
async def list_my_students(user: dict = Depends(require_admin)):
    """List all students linked to the current admin (via link collection)."""
    links = await db.list_students_for_teacher(user["uid"])

    students = []
    for link in links:
        student = await db.get_user(link["student_uid"])
        if student:
            students.append(student)

    return {"students": students, "count": len(students)}


async def _verify_teacher_student_link(teacher_uid: str, student_uid: str) -> None:
    """Verify that an active teacher-student link exists."""
    link = await db.get_teacher_student_link(teacher_uid, student_uid)
    if not link or link.get("status") != "active":
        # Fallback: check legacy admin_uid field
        student = await db.get_user(student_uid)
        if not student or student.get("admin_uid") != teacher_uid:
            raise HTTPException(status_code=404, detail="Student not found")


@router.get("/students/{student_uid}/workbook-progress")
async def get_student_workbook_progress(
    student_uid: str,
    user: dict = Depends(require_admin),
):
    """Get a student's workbook-level progress summary."""
    await _verify_teacher_student_link(user["uid"], student_uid)

    summary = await db.get_student_workbook_summary(student_uid)
    return {"student_uid": student_uid, "workbooks": summary}


@router.get("/students/{student_uid}/review-stats")
async def get_student_review_stats(
    student_uid: str,
    user: dict = Depends(require_admin),
):
    """Get a student's review card stats."""
    await _verify_teacher_student_link(user["uid"], student_uid)

    stats = await db.get_student_review_stats(student_uid)
    return {"student_uid": student_uid, **stats}


@router.get("/students/{student_uid}/recent-activity")
async def get_student_recent_activity(
    student_uid: str,
    limit: int = 20,
    user: dict = Depends(require_admin),
):
    """Get a student's recent attempts."""
    await _verify_teacher_student_link(user["uid"], student_uid)

    attempts = await db.list_recent_attempts(student_uid, limit=limit)
    return {"student_uid": student_uid, "attempts": attempts, "count": len(attempts)}
