"""Migrate existing Firestore answer key data to LaTeX format.

Converts plain-text solution_steps and pitfalls to LaTeX inline notation
using Gemini API. Backs up original data before modification.

Usage:
    # Dry run (no writes):
    python -m scripts.migrate_to_latex --workbook-id WORKBOOK_ID

    # Actual migration:
    python -m scripts.migrate_to_latex --workbook-id WORKBOOK_ID --apply

    # Migrate all workbooks:
    python -m scripts.migrate_to_latex --all --apply
"""

import argparse
import asyncio
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# Ensure dotenv loads before google imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from google import genai
from google.genai import types

from config import (
    GCP_LOCATION,
    GCP_PROJECT,
    GEMINI_MODEL,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

MIGRATION_PROMPT = """\
당신은 수학 텍스트를 LaTeX로 변환하는 도우미입니다.

아래 텍스트 목록의 각 항목에 포함된 수학 표현을 LaTeX 인라인 형식($...$)으로 변환하세요.

## 규칙
1. 수식 부분만 $...$로 감싸세요. 한국어 텍스트는 그대로 유지하세요.
2. 이미 LaTeX 형식인 항목은 그대로 두세요.
3. 수학 표현이 없는 순수 한국어 텍스트는 그대로 두세요.
4. 각 항목의 의미를 변경하지 마세요.

## 예시
입력: ["(-5)+(-8) = -13", "부호가 같은 두 수의 덧셈은 절댓값을 더하고 공통 부호를 붙인다"]
출력: ["$(-5)+(-8) = -13$", "부호가 같은 두 수의 덧셈은 절댓값을 더하고 공통 부호를 붙인다"]

입력: ["3/4 × 2/3 = 1/2", "약분 시 분자와 분모를 최대공약수로 나눈다"]
출력: ["$\\frac{{3}}{{4}} \\times \\frac{{2}}{{3}} = \\frac{{1}}{{2}}$", "약분 시 분자와 분모를 최대공약수로 나눈다"]

## 변환할 텍스트
{text_list}

반드시 JSON 배열로만 응답하세요 (같은 순서, 같은 개수).
"""

MIGRATION_SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "items": types.Schema(
            type=types.Type.ARRAY,
            items=types.Schema(type=types.Type.STRING),
            description="LaTeX 변환된 텍스트 목록 (입력과 같은 순서, 같은 개수)",
        ),
    },
    required=["items"],
)


async def convert_texts_to_latex(
    client: genai.Client,
    texts: list[str],
) -> list[str]:
    """Convert a list of plain-text strings to LaTeX using Gemini."""
    if not texts:
        return []

    prompt = MIGRATION_PROMPT.format(text_list=json.dumps(texts, ensure_ascii=False))

    config = types.GenerateContentConfig(
        temperature=0.1,
        max_output_tokens=4096,
        response_mime_type="application/json",
        response_schema=MIGRATION_SCHEMA,
    )

    try:
        response = await client.aio.models.generate_content(
            model=GEMINI_MODEL,
            contents=[prompt],
            config=config,
        )
        result = json.loads(response.text)
        items = result.get("items", [])

        # Validate same count
        if len(items) != len(texts):
            logger.warning(
                "Gemini returned %d items (expected %d), using originals",
                len(items), len(texts),
            )
            return texts

        return items
    except Exception as e:
        logger.error("Gemini conversion failed: %s", e)
        return texts


async def migrate_workbook(
    workbook_id: str,
    apply: bool = False,
    backup_dir: Optional[Path] = None,
) -> dict:
    """Migrate a single workbook's answer keys to LaTeX.

    Returns stats dict with counts of processed/converted/skipped items.
    """
    from services import firestore_service as db

    client = genai.Client(
        vertexai=True,
        project=GCP_PROJECT,
        location=GCP_LOCATION,
    )

    keys = await db.list_answer_keys(workbook_id)
    if not keys:
        logger.info("No answer keys found for workbook %s", workbook_id)
        return {"processed": 0, "converted": 0, "skipped": 0}

    stats = {"processed": 0, "converted": 0, "skipped": 0}

    # Backup before migration
    if backup_dir and apply:
        backup_file = backup_dir / f"{workbook_id}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.json"
        backup_file.parent.mkdir(parents=True, exist_ok=True)
        backup_file.write_text(json.dumps(keys, ensure_ascii=False, indent=2, default=str))
        logger.info("Backup saved to %s", backup_file)

    for key in keys:
        page = key.get("page", 0)
        number = key.get("number", 0)
        solution_steps = key.get("solution_steps", [])
        pitfalls = key.get("pitfalls", [])
        stats["processed"] += 1

        # Skip if no text fields to convert
        if not solution_steps and not pitfalls:
            stats["skipped"] += 1
            continue

        # Check if already converted (contains $)
        all_texts = solution_steps + pitfalls
        if any("$" in t for t in all_texts):
            logger.info("  %d_%d: already contains LaTeX, skipping", page, number)
            stats["skipped"] += 1
            continue

        # Convert
        converted = await convert_texts_to_latex(client, all_texts)
        new_steps = converted[:len(solution_steps)]
        new_pitfalls = converted[len(solution_steps):]

        # Log changes
        changed = False
        for orig, conv in zip(solution_steps, new_steps):
            if orig != conv:
                changed = True
                logger.info("  %d_%d step: %s → %s", page, number, orig[:50], conv[:50])
        for orig, conv in zip(pitfalls, new_pitfalls):
            if orig != conv:
                changed = True
                logger.info("  %d_%d pitfall: %s → %s", page, number, orig[:50], conv[:50])

        if not changed:
            stats["skipped"] += 1
            continue

        stats["converted"] += 1

        if apply:
            await db.set_answer_key(workbook_id, page, number, {
                **key,
                "solution_steps": new_steps,
                "pitfalls": new_pitfalls,
            })
            logger.info("  %d_%d: updated in Firestore", page, number)
        else:
            logger.info("  %d_%d: would update (dry run)", page, number)

    return stats


async def main():
    parser = argparse.ArgumentParser(description="Migrate answer keys to LaTeX format")
    parser.add_argument("--workbook-id", help="Specific workbook ID to migrate")
    parser.add_argument("--all", action="store_true", help="Migrate all workbooks")
    parser.add_argument("--apply", action="store_true", help="Actually write changes (default: dry run)")
    args = parser.parse_args()

    if not args.workbook_id and not args.all:
        parser.error("Must specify --workbook-id or --all")

    backup_dir = Path(__file__).parent.parent / "backups" / "latex_migration"

    if not args.apply:
        logger.info("DRY RUN — no changes will be written. Use --apply to write.")

    if args.all:
        from services import firestore_service as db
        workbooks = await db.list_workbooks()
        total_stats = {"processed": 0, "converted": 0, "skipped": 0}
        for wb in workbooks:
            wid = wb.get("workbook_id", "")
            logger.info("=== Migrating workbook: %s (%s) ===", wid, wb.get("label", ""))
            stats = await migrate_workbook(wid, apply=args.apply, backup_dir=backup_dir)
            for k in total_stats:
                total_stats[k] += stats[k]
        logger.info("=== TOTAL: %s ===", total_stats)
    else:
        stats = await migrate_workbook(
            args.workbook_id, apply=args.apply, backup_dir=backup_dir,
        )
        logger.info("Stats: %s", stats)


if __name__ == "__main__":
    asyncio.run(main())
