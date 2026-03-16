"""FastAPI application entry point."""

# Load .env BEFORE any other imports so ADK/genai picks up credentials
import logging
import os
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

# Configure logging — ensure our app logs show at INFO level
logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s: %(message)s")
logger = logging.getLogger(__name__)

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from config import API_PREFIX, CORS_ORIGINS
from routers import workbooks, scan, study, review, ws_audio, users, teachers
from services.auth_service import get_current_user


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    yield
    # Shutdown


app = FastAPI(
    title="Math Coach Agent API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(workbooks.router, prefix=f"{API_PREFIX}/workbooks", tags=["workbooks"])
app.include_router(scan.router, prefix=f"{API_PREFIX}/scan", tags=["scan"])
app.include_router(study.router, prefix=f"{API_PREFIX}/study", tags=["study"])
app.include_router(review.router, prefix=f"{API_PREFIX}/review", tags=["review"])
app.include_router(users.router, prefix=f"{API_PREFIX}/users", tags=["users"])
app.include_router(teachers.router, prefix=f"{API_PREFIX}/teachers", tags=["teachers"])
app.include_router(ws_audio.router, tags=["voice"])


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get(f"{API_PREFIX}/signed-image-url")
async def signed_image_url(
    path: str = Query(...),
    user: dict = Depends(get_current_user),
):
    """Return a short-lived signed GCS URL for browser <img> tags."""
    from services import storage_service as storage

    if not path.startswith("gs://"):
        raise HTTPException(400, "Invalid path")

    try:
        url = storage.get_signed_url(path, expiration_minutes=60)
    except FileNotFoundError:
        raise HTTPException(404, "Image not found")
    except Exception as e:
        logger.exception("Failed to generate signed URL for %s: %s", path, e)
        raise HTTPException(500, "Failed to generate signed URL")

    return {"url": url}
