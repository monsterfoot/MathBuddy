"""One-time migration: create teacher_student_links from existing admin_uid."""

import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

# Load env before any google imports
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Add backend to path so imports work
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.firestore_service import get_db, create_teacher_student_link
from config import COL_USERS


async def migrate():
    db = get_db()

    from google.cloud.firestore_v1.base_query import FieldFilter
    docs = db.collection(COL_USERS).where(
        filter=FieldFilter("role", "==", "student")
    ).stream()

    count = 0
    async for doc in docs:
        student = doc.to_dict()
        admin_uid = student.get("admin_uid")
        if not admin_uid:
            continue

        student_uid = student["uid"]

        # Fetch teacher info
        teacher_doc = await db.collection(COL_USERS).document(admin_uid).get()
        teacher = teacher_doc.to_dict() if teacher_doc.exists else {}

        now = datetime.now(timezone.utc)
        link_data = {
            "teacher_uid": admin_uid,
            "student_uid": student_uid,
            "teacher_email": teacher.get("email", student.get("admin_email", "")),
            "teacher_display_name": teacher.get("display_name", ""),
            "student_email": student.get("email", ""),
            "student_display_name": student.get("display_name", ""),
            "status": "active",
            "created_at": now,
            "updated_at": now,
        }

        await create_teacher_student_link(admin_uid, student_uid, link_data)
        count += 1
        print(f"  Linked: {student.get('email')} -> {teacher.get('email')}")

    print(f"\nDone. Created {count} teacher-student links.")


if __name__ == "__main__":
    asyncio.run(migrate())
