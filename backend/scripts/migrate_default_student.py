"""Migrate 'default_student' data to a real user UID.

This script reassigns all Firestore documents that reference the
legacy 'default_student' placeholder to an actual Firebase Auth user.

Target collections:
  - attempts        (field: student_id)
  - study_records   (field: student_id, also embedded in doc ID)
  - mistake_cards   (field: student_id, also embedded in doc ID)
  - coaching_sessions (field: student_id)
  - workbooks       (sets owner_uid + assigned_student_uids)

For study_records and mistake_cards, document IDs contain the student_id,
so we create new documents with the correct ID and delete the old ones.

Usage:
    cd backend
    python -m scripts.migrate_default_student --target-uid <REAL_UID> [--dry-run]
"""

import argparse
import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import config  # noqa: E402 — triggers load_dotenv
from google.cloud import firestore  # noqa: E402
from services.firestore_service import get_db  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

OLD_STUDENT_ID = "default_student"


async def migrate_simple_collection(
    collection_name: str,
    field_name: str,
    target_uid: str,
    dry_run: bool,
) -> int:
    """Migrate docs where field_name == OLD_STUDENT_ID by updating the field in-place."""
    db = get_db()
    from google.cloud.firestore_v1.base_query import FieldFilter

    docs = (
        db.collection(collection_name)
        .where(filter=FieldFilter(field_name, "==", OLD_STUDENT_ID))
        .stream()
    )
    count = 0
    async for doc in docs:
        count += 1
        doc_id = doc.id
        if dry_run:
            logger.info("  [DRY RUN] Would update %s/%s", collection_name, doc_id)
        else:
            await doc.reference.update({field_name: target_uid})
            logger.info("  Updated %s/%s", collection_name, doc_id)
    return count


async def migrate_id_embedded_collection(
    collection_name: str,
    target_uid: str,
    dry_run: bool,
) -> int:
    """Migrate docs where the document ID contains OLD_STUDENT_ID.

    Creates new doc with corrected ID, copies data, deletes old doc.
    """
    db = get_db()
    from google.cloud.firestore_v1.base_query import FieldFilter

    docs = (
        db.collection(collection_name)
        .where(filter=FieldFilter("student_id", "==", OLD_STUDENT_ID))
        .stream()
    )
    count = 0
    async for doc in docs:
        count += 1
        old_id = doc.id
        data = doc.to_dict()
        if not data:
            continue

        # Build new document ID by replacing the student_id prefix
        new_id = old_id.replace(OLD_STUDENT_ID, target_uid, 1)
        data["student_id"] = target_uid

        # Also fix record_id / card_id if present
        if "record_id" in data:
            data["record_id"] = data["record_id"].replace(OLD_STUDENT_ID, target_uid, 1)
        if "card_id" in data:
            data["card_id"] = data["card_id"].replace(OLD_STUDENT_ID, target_uid, 1)

        if dry_run:
            logger.info("  [DRY RUN] Would move %s/%s → %s", collection_name, old_id, new_id)
        else:
            # Create new document, then delete old
            await db.collection(collection_name).document(new_id).set(data)
            await doc.reference.delete()
            logger.info("  Moved %s/%s → %s", collection_name, old_id, new_id)
    return count


async def migrate_workbooks(
    target_uid: str,
    dry_run: bool,
) -> int:
    """Set owner_uid and assigned_student_uids on workbooks missing owner_uid."""
    db = get_db()
    docs = db.collection(config.COL_WORKBOOKS).stream()
    count = 0
    async for doc in docs:
        data = doc.to_dict()
        if not data:
            continue
        # Only migrate workbooks without an owner
        if data.get("owner_uid"):
            continue
        count += 1
        if dry_run:
            logger.info("  [DRY RUN] Would set owner_uid on workbook %s", doc.id)
        else:
            await doc.reference.update({
                "owner_uid": target_uid,
                "assigned_student_uids": firestore.ArrayUnion([target_uid]),
            })
            logger.info("  Set owner_uid on workbook %s", doc.id)
    return count


async def run_migration(target_uid: str, dry_run: bool) -> None:
    mode = "DRY RUN" if dry_run else "LIVE"
    logger.info("=== Migration %s: %s → %s ===\n", mode, OLD_STUDENT_ID, target_uid)

    # 1. Attempts (simple field update)
    logger.info("[1/5] Migrating attempts...")
    n = await migrate_simple_collection(config.COL_ATTEMPTS, "student_id", target_uid, dry_run)
    logger.info("  → %d attempt(s)\n", n)

    # 2. Coaching sessions (simple field update)
    logger.info("[2/5] Migrating coaching_sessions...")
    n = await migrate_simple_collection(config.COL_COACHING_SESSIONS, "student_id", target_uid, dry_run)
    logger.info("  → %d session(s)\n", n)

    # 3. Study records (ID contains student_id)
    logger.info("[3/5] Migrating study_records...")
    n = await migrate_id_embedded_collection(config.COL_STUDY_RECORDS, target_uid, dry_run)
    logger.info("  → %d record(s)\n", n)

    # 4. Mistake cards (ID contains student_id)
    logger.info("[4/5] Migrating mistake_cards...")
    n = await migrate_id_embedded_collection(config.COL_MISTAKE_CARDS, target_uid, dry_run)
    logger.info("  → %d card(s)\n", n)

    # 5. Workbooks (set owner_uid)
    logger.info("[5/5] Migrating workbooks (owner_uid)...")
    n = await migrate_workbooks(target_uid, dry_run)
    logger.info("  → %d workbook(s)\n", n)

    logger.info("=== Migration %s complete ===", mode)
    if dry_run:
        logger.info("Re-run without --dry-run to apply changes.")


def main():
    parser = argparse.ArgumentParser(description="Migrate default_student data to a real user UID")
    parser.add_argument("--target-uid", required=True, help="The real Firebase Auth UID to migrate data to")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without applying them")
    args = parser.parse_args()

    asyncio.run(run_migration(args.target_uid, args.dry_run))


if __name__ == "__main__":
    main()
