"""Delete ALL data from Firestore collections.

Usage:
    cd backend
    python -m scripts.reset_firestore --confirm
"""

import asyncio
import sys

from google.cloud.firestore import AsyncClient  # type: ignore[import]

from config import (
    COL_ANSWER_KEYS,
    COL_ATTEMPTS,
    COL_COACHING_SESSIONS,
    COL_MISTAKE_CARDS,
    COL_SCAN_SESSIONS,
    COL_STUDY_RECORDS,
    COL_USERS,
    COL_VARIANT_TEMPLATES,
    COL_WORKBOOK_ASSIGNMENTS,
    COL_WORKBOOKS,
)

BATCH_SIZE = 200

TOP_LEVEL_COLLECTIONS = [
    COL_ATTEMPTS,
    COL_MISTAKE_CARDS,
    COL_STUDY_RECORDS,
    COL_COACHING_SESSIONS,
    COL_SCAN_SESSIONS,
    COL_VARIANT_TEMPLATES,
    COL_USERS,
    COL_WORKBOOK_ASSIGNMENTS,
]


async def _delete_collection(db: AsyncClient, name: str) -> int:
    """Delete all documents in a top-level collection."""
    coll = db.collection(name)
    count = 0
    while True:
        docs = [doc async for doc in coll.limit(BATCH_SIZE).stream()]
        if not docs:
            break
        batch = db.batch()
        for doc in docs:
            batch.delete(doc.reference)
        await batch.commit()
        count += len(docs)
    return count


async def _delete_workbooks(db: AsyncClient) -> tuple[int, int]:
    """Delete workbooks and their answer_keys subcollections."""
    coll = db.collection(COL_WORKBOOKS)
    wb_count = 0
    ak_count = 0
    while True:
        docs = [doc async for doc in coll.limit(BATCH_SIZE).stream()]
        if not docs:
            break
        for doc in docs:
            sub = doc.reference.collection(COL_ANSWER_KEYS)
            while True:
                sub_docs = [d async for d in sub.limit(BATCH_SIZE).stream()]
                if not sub_docs:
                    break
                batch = db.batch()
                for sd in sub_docs:
                    batch.delete(sd.reference)
                await batch.commit()
                ak_count += len(sub_docs)
            await doc.reference.delete()
            wb_count += 1
    return wb_count, ak_count


async def main() -> None:
    if "--confirm" not in sys.argv:
        print("WARNING: This will delete ALL data from ALL Firestore collections.")
        print("Run with --confirm to proceed.")
        sys.exit(1)

    db = AsyncClient()
    total = 0

    print("Deleting all Firestore data...")

    wb_count, ak_count = await _delete_workbooks(db)
    print(f"  {COL_WORKBOOKS}: {wb_count} (answer_keys: {ak_count})")
    total += wb_count + ak_count

    for col_name in TOP_LEVEL_COLLECTIONS:
        count = await _delete_collection(db, col_name)
        print(f"  {col_name}: {count}")
        total += count

    print(f"\nTotal documents deleted: {total}")


if __name__ == "__main__":
    asyncio.run(main())
