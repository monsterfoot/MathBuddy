"""Seed Firestore with demo workbook and answer keys for testing.

Usage:
    cd backend && python -m scripts.seed_demo
"""

import asyncio
import sys
from pathlib import Path

# Ensure backend root is on path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

import config  # noqa: E402 — triggers load_dotenv
from services import firestore_service as db  # noqa: E402

DEMO_WORKBOOK_ID = "demo"

DEMO_WORKBOOK = {
    "workbook_id": DEMO_WORKBOOK_ID,
    "label": "데모 문제집 (중1 정수와 유리수)",
    "status": "locked",
    "cover_photo_url": None,
    "problem_count": 10,
    "answer_coverage": 10,
    "explanation_coverage": 0,
    "locked_at": None,
}

DEMO_ANSWER_KEYS = [
    {
        "page": 5,
        "number": 1,
        "final_answer": "-3",
        "answer_type": "integer",
        "solution_steps": [
            "-7과 4를 분류합니다",
            "-7은 음의 정수, 4는 양의 정수입니다",
            "정수가 아닌 유리수의 예: 1/2, -0.3",
        ],
        "pitfalls": ["0을 양의 정수로 잘못 분류", "소수를 정수로 혼동"],
        "concept_tag": "N01",
    },
    {
        "page": 5,
        "number": 2,
        "final_answer": "-5",
        "answer_type": "integer",
        "solution_steps": [
            "수직선 위에 -5, -2, 3을 표시합니다",
            "왼쪽에 있을수록 작은 수입니다",
            "-5 < -2 < 3 순서로 정렬합니다",
        ],
        "pitfalls": ["음수의 크기 비교에서 절댓값이 클수록 작다는 점을 잊음"],
        "concept_tag": "N02",
    },
    {
        "page": 5,
        "number": 3,
        "final_answer": "7",
        "answer_type": "integer",
        "solution_steps": [
            "|-7|을 구합니다",
            "절댓값은 수직선 위에서 0까지의 거리입니다",
            "|-7| = 7",
        ],
        "pitfalls": ["절댓값 결과에 음수 부호를 붙이는 실수"],
        "concept_tag": "N03",
    },
    {
        "page": 6,
        "number": 1,
        "final_answer": "-13",
        "answer_type": "integer",
        "solution_steps": [
            "(-5) + (-8)을 계산합니다",
            "같은 부호(음수)끼리의 덧셈: 절댓값을 더합니다 5+8=13",
            "공통 부호(-)를 붙입니다: -13",
        ],
        "pitfalls": [
            "같은 부호 덧셈에서 절댓값을 빼는 실수",
            "부호를 양수로 잘못 적는 실수",
        ],
        "concept_tag": "N04",
    },
    {
        "page": 6,
        "number": 2,
        "final_answer": "-2",
        "answer_type": "integer",
        "solution_steps": [
            "(-9) + 7을 계산합니다",
            "다른 부호의 덧셈: 절댓값의 차 9-7=2",
            "절댓값이 큰 쪽(-9)의 부호를 따릅니다: -2",
        ],
        "pitfalls": [
            "결과에 부호를 빠뜨리는 실수",
            "절댓값이 작은 쪽의 부호를 따르는 실수",
        ],
        "concept_tag": "N05",
    },
    {
        "page": 7,
        "number": 1,
        "final_answer": "11",
        "answer_type": "integer",
        "solution_steps": [
            "3 - (-8)을 계산합니다",
            "뺄셈을 덧셈으로 바꿉니다: 3 + (+8)",
            "같은 부호(양수) 덧셈: 3+8 = 11",
        ],
        "pitfalls": ["빼기를 더하기로 바꿀 때 부호 변환 누락"],
        "concept_tag": "N06",
    },
    {
        "page": 7,
        "number": 2,
        "final_answer": "-24",
        "answer_type": "integer",
        "solution_steps": [
            "(-6) × 4를 계산합니다",
            "음수 × 양수 = 음수",
            "6 × 4 = 24이므로 답은 -24",
        ],
        "pitfalls": ["부호 규칙 혼동 (음×양=양으로 착각)"],
        "concept_tag": "N07",
    },
    {
        "page": 8,
        "number": 1,
        "final_answer": "-5",
        "answer_type": "integer",
        "solution_steps": [
            "30 ÷ (-6)을 계산합니다",
            "양수 ÷ 음수 = 음수",
            "30 ÷ 6 = 5이므로 답은 -5",
        ],
        "pitfalls": [
            "나눗셈 부호 규칙 혼동",
            "0으로 나누는 것이 불가능하다는 것을 잊음",
        ],
        "concept_tag": "N08",
    },
    {
        "page": 8,
        "number": 2,
        "final_answer": "-3/4",
        "answer_type": "fraction",
        "solution_steps": [
            "(-3/8) ÷ (1/2)를 계산합니다",
            "나눗셈을 역수의 곱셈으로 바꿉니다: (-3/8) × (2/1)",
            "분자끼리 곱: -3×2 = -6, 분모끼리 곱: 8×1 = 8",
            "-6/8을 약분: -3/4",
        ],
        "pitfalls": [
            "역수를 취하지 않고 바로 나누는 실수",
            "음수 부호를 빠뜨리는 실수",
        ],
        "concept_tag": "N09",
    },
    {
        "page": 9,
        "number": 1,
        "final_answer": "-7",
        "answer_type": "integer",
        "solution_steps": [
            "(-2) + 3 × (-1) + 4 ÷ (-2)를 계산합니다",
            "곱셈/나눗셈 먼저: 3×(-1) = -3, 4÷(-2) = -2",
            "덧셈: (-2) + (-3) + (-2) = -7",
        ],
        "pitfalls": [
            "연산 순서(곱셈/나눗셈 우선) 무시",
            "부호 처리 실수",
        ],
        "concept_tag": "N10",
    },
]


async def seed():
    """Create demo workbook and answer keys in Firestore."""
    print(f"Creating demo workbook: {DEMO_WORKBOOK_ID}")
    await db.create_workbook(DEMO_WORKBOOK_ID, DEMO_WORKBOOK)

    for ak in DEMO_ANSWER_KEYS:
        page, number = ak["page"], ak["number"]
        print(
            f"  Setting answer key: page={page}, number={number}, "
            f"answer={ak['final_answer']}, tag={ak['concept_tag']}"
        )
        await db.set_answer_key(DEMO_WORKBOOK_ID, page, number, ak)

    print(f"\nDone! Seeded {len(DEMO_ANSWER_KEYS)} answer keys for workbook '{DEMO_WORKBOOK_ID}'.")


if __name__ == "__main__":
    asyncio.run(seed())
