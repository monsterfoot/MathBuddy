"""Wipe ALL Firestore data — users, workbooks, answer_keys, study records, etc."""

import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.firestore_service import get_db

# Top-level collections to delete
TOP_LEVEL_COLLECTIONS = [
    "users",
    "workbooks",
    "attempts",
    "mistake_cards",
    "variant_templates",
    "coaching_sessions",
    "scan_sessions",
    "study_records",
    "disputes",
    "regen_requests",
    "workbook_assignments",
    "teacher_student_links",
]

# Workbooks have subcollection "answer_keys"
WORKBOOK_SUBCOLLECTIONS = ["answer_keys"]


async def delete_collection(db, col_path: str) -> int:
    """Delete all documents in a collection. Returns count deleted."""
    count = 0
    docs = db.collection(col_path).stream()
    async for doc in docs:
        await doc.reference.delete()
        count += 1
    return count


async def wipe():
    db = get_db()

    # 1. Delete workbook subcollections first (answer_keys)
    print("Deleting workbook subcollections...")
    workbook_docs = db.collection("workbooks").stream()
    sub_count = 0
    async for wb_doc in workbook_docs:
        for sub in WORKBOOK_SUBCOLLECTIONS:
            sub_docs = wb_doc.reference.collection(sub).stream()
            async for sub_doc in sub_docs:
                await sub_doc.reference.delete()
                sub_count += 1
    print(f"  Deleted {sub_count} subcollection docs (answer_keys)")

    # 2. Delete all top-level collections
    for col_name in TOP_LEVEL_COLLECTIONS:
        count = await delete_collection(db, col_name)
        print(f"  {col_name}: {count} docs deleted")

    print("\nAll data wiped.")


if __name__ == "__main__":
    confirm = input("This will DELETE ALL data. Type 'yes' to confirm: ")
    if confirm.strip().lower() != "yes":
        print("Aborted.")
        sys.exit(0)
    asyncio.run(wipe())
