"""Tests for grading service — mocks Gemini API calls."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.grading_service import grade_photo


@pytest.fixture
def sample_answer_key():
    return {
        "final_answer": "-13",
        "answer_type": "integer",
        "concept_tag": "N04",
        "page": 6,
        "number": 1,
    }


def _make_response(result_dict: dict) -> MagicMock:
    response = MagicMock()
    response.text = json.dumps(result_dict)
    return response


@pytest.mark.asyncio
async def test_grade_photo_correct(sample_answer_key):
    result_data = {
        "student_answer": "-13",
        "is_correct": True,
        "error_tag": "none",
        "feedback": "정답입니다!",
    }

    with patch("services.grading_service._get_client") as mock_get:
        mock_client = MagicMock()
        mock_client.aio.models.generate_content = AsyncMock(
            return_value=_make_response(result_data)
        )
        mock_get.return_value = mock_client

        result = await grade_photo(
            b"fake-image-bytes", "image/jpeg", sample_answer_key
        )
        assert result["student_answer"] == "-13"
        assert result["is_correct"] is True
        assert result["error_tag"] == "none"


@pytest.mark.asyncio
async def test_grade_photo_wrong_answer(sample_answer_key):
    result_data = {
        "student_answer": "-3",
        "is_correct": False,
        "error_tag": "sign_error",
        "feedback": "같은 부호 덧셈에서 절댓값을 빼지 않고 더해야 합니다.",
    }

    with patch("services.grading_service._get_client") as mock_get:
        mock_client = MagicMock()
        mock_client.aio.models.generate_content = AsyncMock(
            return_value=_make_response(result_data)
        )
        mock_get.return_value = mock_client

        result = await grade_photo(
            b"fake-image-bytes", "image/jpeg", sample_answer_key
        )
        assert result["student_answer"] == "-3"
        assert result["is_correct"] is False
        assert result["error_tag"] == "sign_error"


@pytest.mark.asyncio
async def test_grade_photo_api_failure_returns_fallback(sample_answer_key):
    with patch("services.grading_service._get_client") as mock_get:
        mock_client = MagicMock()
        mock_client.aio.models.generate_content = AsyncMock(
            side_effect=Exception("API error")
        )
        mock_get.return_value = mock_client

        result = await grade_photo(
            b"fake-image-bytes", "image/jpeg", sample_answer_key
        )
        assert result["error_tag"] == "retake_needed"
        assert result["student_answer"] is None


@pytest.mark.asyncio
async def test_grade_photo_invalid_json_retries(sample_answer_key):
    bad_response = MagicMock()
    bad_response.text = "not json"

    good_result = {
        "student_answer": "-13",
        "is_correct": True,
        "error_tag": "none",
        "feedback": "정답!",
    }

    with patch("services.grading_service._get_client") as mock_get:
        mock_client = MagicMock()
        mock_client.aio.models.generate_content = AsyncMock(
            side_effect=[bad_response, _make_response(good_result)]
        )
        mock_get.return_value = mock_client

        result = await grade_photo(
            b"fake-image-bytes", "image/jpeg", sample_answer_key
        )
        assert result["is_correct"] is True
        assert mock_client.aio.models.generate_content.call_count == 2
