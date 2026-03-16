"""Firebase Auth token verification + FastAPI dependencies."""

import logging

import firebase_admin
from firebase_admin import auth as firebase_auth
from fastapi import Depends, HTTPException, Request

logger = logging.getLogger(__name__)

# Initialize Firebase Admin SDK (uses Application Default Credentials on GCP)
if not firebase_admin._apps:
    firebase_admin.initialize_app()


def _verify_token_string(token: str) -> dict | None:
    """Verify a raw token string (for WebSocket auth). Returns decoded dict or None."""
    try:
        return firebase_auth.verify_id_token(token)
    except Exception as e:
        logger.warning("WebSocket token verification failed: %s", e)
        return None


async def _verify_token(request: Request) -> dict:
    """Extract and verify Firebase ID token from Authorization header.

    Returns the decoded token dict (uid, email, name, picture, etc.).
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = auth_header[7:]
    try:
        return firebase_auth.verify_id_token(token)
    except Exception as e:
        logger.warning("Token verification failed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid or expired token")


async def get_current_user(request: Request) -> dict:
    """FastAPI dependency: verify token + look up registered user profile."""
    decoded = await _verify_token(request)
    uid = decoded["uid"]

    from services import firestore_service as db

    user = await db.get_user(uid)
    if not user:
        raise HTTPException(
            status_code=403,
            detail="User not registered. Complete onboarding first.",
        )

    return user


async def get_token_info(request: Request) -> dict:
    """FastAPI dependency for registration: verify token WITHOUT requiring Firestore user.

    Returns basic info from the Firebase token itself.
    """
    decoded = await _verify_token(request)
    return {
        "uid": decoded["uid"],
        "email": decoded.get("email", ""),
        "display_name": decoded.get("name", ""),
        "photo_url": decoded.get("picture"),
    }


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """FastAPI dependency: require admin role."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def require_student(user: dict = Depends(get_current_user)) -> dict:
    """FastAPI dependency: require student role."""
    if user.get("role") != "student":
        raise HTTPException(status_code=403, detail="Student access required")
    return user
