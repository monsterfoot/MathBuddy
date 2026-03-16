"""Delete a specific user by email from Firestore."""

import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.firestore_service import get_db


async def delete_user_by_email(email: str):
    db = get_db()
    from google.cloud.firestore_v1.base_query import FieldFilter

    docs = db.collection("users").where(
        filter=FieldFilter("email", "==", email)
    ).stream()

    count = 0
    async for doc in docs:
        data = doc.to_dict()
        print(f"  Deleting: {data.get('email')} (uid={data.get('uid')}, role={data.get('role')})")
        await doc.reference.delete()
        count += 1

    if count == 0:
        print(f"  No user found with email: {email}")
    else:
        print(f"  Deleted {count} user(s).")


if __name__ == "__main__":
    email = sys.argv[1] if len(sys.argv) > 1 else input("Email to delete: ").strip()
    asyncio.run(delete_user_by_email(email))
