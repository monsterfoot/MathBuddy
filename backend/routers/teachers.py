"""Teacher-student link management — join, leave, remove."""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from models.schemas import JoinTeacherRequest, RemoveStudentRequest
from services import firestore_service as db
from services.auth_service import get_current_user, require_admin, require_student

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/join")
async def join_teacher(body: JoinTeacherRequest, user: dict = Depends(require_student)):
    """Student joins a teacher by email. Auto-assigns teacher's workbooks."""
    teacher = await db.get_user_by_email(body.teacher_email)
    if not teacher:
        raise HTTPException(404, "Teacher not found with that email")
    if teacher.get("role") != "admin":
        raise HTTPException(400, "The specified email does not belong to a teacher")

    teacher_uid = teacher["uid"]
    student_uid = user["uid"]

    # Check if link already exists
    existing = await db.get_teacher_student_link(teacher_uid, student_uid)
    if existing and existing.get("status") == "active":
        raise HTTPException(409, "Already linked to this teacher")

    now = datetime.now(timezone.utc)
    link_data = {
        "teacher_uid": teacher_uid,
        "student_uid": student_uid,
        "teacher_email": teacher.get("email", ""),
        "teacher_display_name": teacher.get("display_name", ""),
        "student_email": user.get("email", ""),
        "student_display_name": user.get("display_name", ""),
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    await db.create_teacher_student_link(teacher_uid, student_uid, link_data)

    # Auto-assign all teacher's workbooks to student
    try:
        workbooks = await db.list_workbooks_for_admin(teacher_uid)
        for wb in workbooks:
            await db.assign_student_to_workbook(wb["workbook_id"], student_uid)
        logger.info(
            "Auto-assigned %d workbooks from teacher %s to student %s",
            len(workbooks), teacher_uid, student_uid,
        )
    except Exception as e:
        logger.warning("Auto-assign workbooks on join failed: %s", e)

    return link_data


@router.delete("/{teacher_uid}")
async def leave_teacher(teacher_uid: str, user: dict = Depends(require_student)):
    """Student leaves a teacher. Unassigns teacher's workbooks."""
    student_uid = user["uid"]

    link = await db.get_teacher_student_link(teacher_uid, student_uid)
    if not link or link.get("status") != "active":
        raise HTTPException(404, "Not linked to this teacher")

    await db.deactivate_teacher_student_link(teacher_uid, student_uid)

    # Unassign all workbooks owned by this teacher (only their own, not public from others)
    try:
        workbooks = await db.list_workbooks_for_admin(teacher_uid)
        own_workbooks = [wb for wb in workbooks if wb.get("owner_uid") == teacher_uid]
        for wb in own_workbooks:
            try:
                await db.unassign_student_from_workbook(wb["workbook_id"], student_uid)
            except Exception:
                pass
        logger.info(
            "Unassigned student %s from %d workbooks of teacher %s",
            student_uid, len(own_workbooks), teacher_uid,
        )
    except Exception as e:
        logger.warning("Unassign workbooks on leave failed: %s", e)

    return {"left": True, "teacher_uid": teacher_uid}


@router.get("/my-teachers")
async def list_my_teachers(user: dict = Depends(require_student)):
    """List all active teachers for the current student."""
    links = await db.list_teachers_for_student(user["uid"])
    return {
        "teachers": [
            {
                "teacher_uid": l["teacher_uid"],
                "teacher_email": l["teacher_email"],
                "teacher_display_name": l["teacher_display_name"],
            }
            for l in links
        ],
        "count": len(links),
    }


@router.post("/remove-student")
async def remove_student(body: RemoveStudentRequest, user: dict = Depends(require_admin)):
    """Teacher removes a student. Deactivates link + unassigns workbooks."""
    teacher_uid = user["uid"]
    student_uid = body.student_uid

    link = await db.get_teacher_student_link(teacher_uid, student_uid)
    if not link or link.get("status") != "active":
        raise HTTPException(404, "Student is not linked to you")

    await db.deactivate_teacher_student_link(teacher_uid, student_uid)

    # Unassign from teacher's own workbooks (not public from others)
    try:
        workbooks = await db.list_workbooks_for_admin(teacher_uid)
        own_workbooks = [wb for wb in workbooks if wb.get("owner_uid") == teacher_uid]
        for wb in own_workbooks:
            try:
                await db.unassign_student_from_workbook(wb["workbook_id"], student_uid)
            except Exception:
                pass
        logger.info(
            "Removed student %s from %d workbooks of teacher %s",
            student_uid, len(own_workbooks), teacher_uid,
        )
    except Exception as e:
        logger.warning("Unassign workbooks on remove failed: %s", e)

    return {"removed": True, "student_uid": student_uid}


@router.get("/my-students")
async def list_my_students(user: dict = Depends(require_admin)):
    """List all active students for the current teacher."""
    links = await db.list_students_for_teacher(user["uid"])
    return {
        "students": [
            {
                "student_uid": l["student_uid"],
                "student_email": l["student_email"],
                "student_display_name": l["student_display_name"],
                "photo_url": None,  # Could enrich from user doc if needed
            }
            for l in links
        ],
        "count": len(links),
    }
