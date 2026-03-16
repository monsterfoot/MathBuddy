"""Google Cloud Storage operations for image uploads."""

import uuid
from typing import BinaryIO

from google.cloud import storage

from config import ALLOWED_IMAGE_TYPES, GCS_BUCKET_NAME, MAX_IMAGE_SIZE_MB

_client: storage.Client | None = None


def _get_client() -> storage.Client:
    global _client
    if _client is None:
        _client = storage.Client()
    return _client


def _get_bucket() -> storage.Bucket:
    return _get_client().bucket(GCS_BUCKET_NAME)


def upload_image(
    file: BinaryIO,
    content_type: str,
    folder: str = "uploads",
) -> str:
    """Upload an image to GCS and return the public URL path.

    Args:
        file: File-like object with image data.
        content_type: MIME type of the image.
        folder: GCS folder prefix.

    Returns:
        GCS object path (gs://bucket/folder/filename).

    Raises:
        ValueError: If content type is not allowed or file too large.
    """
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise ValueError(f"Unsupported image type: {content_type}")

    data = file.read()
    size_mb = len(data) / (1024 * 1024)
    if size_mb > MAX_IMAGE_SIZE_MB:
        raise ValueError(f"Image too large: {size_mb:.1f}MB (max {MAX_IMAGE_SIZE_MB}MB)")

    ext = content_type.split("/")[-1]
    if ext == "jpeg":
        ext = "jpg"
    filename = f"{folder}/{uuid.uuid4().hex}.{ext}"

    bucket = _get_bucket()
    blob = bucket.blob(filename)
    blob.upload_from_string(data, content_type=content_type)

    return f"gs://{GCS_BUCKET_NAME}/{filename}"


def download_image(gcs_path: str) -> tuple[bytes, str]:
    """Download an image from GCS and return (bytes, mime_type).

    Args:
        gcs_path: GCS path (gs://bucket/path).

    Returns:
        Tuple of (image_bytes, content_type).

    Raises:
        FileNotFoundError: If blob does not exist.
    """
    parts = gcs_path.replace("gs://", "").split("/", 1)
    if len(parts) < 2 or not parts[1]:
        raise FileNotFoundError(f"Invalid GCS path format: {gcs_path}")
    bucket_name, blob_name = parts[0], parts[1]

    bucket = _get_client().bucket(bucket_name)
    blob = bucket.blob(blob_name)

    if not blob.exists():
        raise FileNotFoundError(f"GCS object not found: {gcs_path}")

    data = blob.download_as_bytes()
    content_type = blob.content_type or "image/jpeg"
    return data, content_type


def get_signed_url(gcs_path: str, expiration_minutes: int = 60) -> str:
    """Generate a signed URL for a GCS object.

    On Cloud Run, compute engine credentials lack a private key,
    so we use the IAM signBlob API via google.auth.

    Args:
        gcs_path: GCS path (gs://bucket/path).
        expiration_minutes: URL expiration in minutes.

    Returns:
        Signed URL string.
    """
    import datetime
    import google.auth
    from google.auth.transport import requests as auth_requests

    parts = gcs_path.replace("gs://", "").split("/", 1)
    if len(parts) < 2 or not parts[1]:
        raise FileNotFoundError(f"Invalid GCS path format: {gcs_path}")
    bucket_name, blob_name = parts[0], parts[1]

    credentials, _project = google.auth.default()

    # Refresh credentials to ensure we have a valid token
    if not credentials.valid:
        credentials.refresh(auth_requests.Request())

    bucket = _get_client().bucket(bucket_name)
    blob = bucket.blob(blob_name)

    return blob.generate_signed_url(
        expiration=datetime.timedelta(minutes=expiration_minutes),
        method="GET",
        version="v4",
        service_account_email=credentials.service_account_email,
        access_token=credentials.token,
    )
