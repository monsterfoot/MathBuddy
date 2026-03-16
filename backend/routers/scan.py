"""Parent scan wizard endpoints."""

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import Response
from google.cloud import firestore as fs

from config import (
    CONCEPT_TAG_DEFAULT,
    PROBLEM_TYPE_DEFAULT,
    SCAN_CONFIDENCE_WARN_THRESHOLD,
    SCAN_DEFAULT_PAGE_TAGS,
    SCAN_EXTRA_TIMEOUT_S,
    SCAN_MS_PER_BATCH_S,
    SCAN_PARALLEL_CONCURRENCY,
    SCAN_VALID_PAGE_TAGS,
)
from models.schemas import AnswerKeyEdit, ScanStartRequest, ScanStatusResponse
from services import diagram_service
from services import firestore_service as db
from services import scan_service
from services import storage_service as storage
from services.auth_service import require_admin
from services.locale_service import get_locale

logger = logging.getLogger(__name__)

router = APIRouter()

# Track running background tasks for cancellation
_running_tasks: dict[str, asyncio.Task] = {}

# --- Scan progress message translations ---
_SCAN_MESSAGES: dict[str, dict[str, str]] = {
    "extracting_answers": {
        "ko": "정답 추출 중... ({count}페이지 병렬 처리)",
        "en": "Extracting answers... ({count} pages in parallel)",
        "ja": "解答抽出中... ({count}ページ並列処理)",
        "zh": "正在提取答案... ({count}页并行处理)",
        "es": "Extrayendo respuestas... ({count} páginas en paralelo)",
        "fr": "Extraction des réponses... ({count} pages en parallèle)",
        "de": "Antworten werden extrahiert... ({count} Seiten parallel)",
        "it": "Estrazione risposte... ({count} pagine in parallelo)",
        "hi": "उत्तर निकाल रहे हैं... ({count} पृष्ठ समानांतर)",
    },
    "answers_found": {
        "ko": "정답 {count}개 추출 완료",
        "en": "{count} answers extracted",
        "ja": "解答{count}件抽出完了",
        "zh": "已提取{count}个答案",
        "es": "{count} respuestas extraídas",
        "fr": "{count} réponses extraites",
        "de": "{count} Antworten extrahiert",
        "it": "{count} risposte estratte",
        "hi": "{count} उत्तर निकाले गए",
    },
    "analyzing_problems": {
        "ko": "문항 분석 중... ({count}페이지)",
        "en": "Analyzing problems... ({count} pages)",
        "ja": "問題分析中... ({count}ページ)",
        "zh": "分析题目中... ({count}页)",
    },
    "extracting_explanations": {
        "ko": "해설 추출 중... ({count}페이지 병렬 처리)",
        "en": "Extracting explanations... ({count} pages in parallel)",
        "ja": "解説抽出中... ({count}ページ並列処理)",
        "zh": "正在提取解析... ({count}页并行处理)",
    },
    "merging": {
        "ko": "병합 중...",
        "en": "Merging...",
        "ja": "統合中...",
        "zh": "合并中...",
    },
    "verifying": {
        "ko": "검증 및 분류 중...",
        "en": "Verifying and classifying...",
        "ja": "検証・分類中...",
        "zh": "验证和分类中...",
    },
    "diagrams": {
        "ko": "다이어그램 처리 중...",
        "en": "Processing diagrams...",
        "ja": "ダイアグラム処理中...",
        "zh": "处理图表中...",
    },
    "diagram_progress": {
        "ko": "다이어그램 생성 중... ({current}/{total})",
        "en": "Generating diagrams... ({current}/{total})",
        "ja": "ダイアグラム生成中... ({current}/{total})",
        "zh": "生成图表中... ({current}/{total})",
        "es": "Generando diagramas... ({current}/{total})",
        "fr": "Génération des diagrammes... ({current}/{total})",
        "de": "Diagramme generieren... ({current}/{total})",
        "it": "Generazione diagrammi... ({current}/{total})",
        "hi": "आरेख बना रहे हैं... ({current}/{total})",
    },
    "saving": {
        "ko": "저장 중...",
        "en": "Saving...",
        "ja": "保存中...",
        "zh": "保存中...",
    },
    "done": {
        "ko": "완료",
        "en": "Done",
        "ja": "完了",
        "zh": "完成",
    },
    "done_no_answers": {
        "ko": "완료 (정답 없음)",
        "en": "Done (no answers found)",
        "ja": "完了 (解答なし)",
        "zh": "完成 (未找到答案)",
    },
    "problems_registered": {
        "ko": "문항 {count}개 등록 완료",
        "en": "{count} problems registered",
        "ja": "問題{count}件登録完了",
        "zh": "{count}道题目已注册",
    },
    "starting": {
        "ko": "시작 중...",
        "en": "Starting...",
        "ja": "開始中...",
        "zh": "正在开始...",
    },
    "timeout": {
        "ko": "시간 초과 ({seconds}초). 부분 결과를 확인하세요.",
        "en": "Timeout ({seconds}s). Check partial results.",
        "ja": "タイムアウト ({seconds}秒)。部分的な結果を確認してください。",
        "zh": "超时 ({seconds}秒)。请检查部分结果。",
    },
    "cancelled": {
        "ko": "사용자가 취소했습니다.",
        "en": "Cancelled by user.",
        "ja": "ユーザーがキャンセルしました。",
        "zh": "用户已取消。",
    },
    "error_occurred": {
        "ko": "오류가 발생했습니다.",
        "en": "An error occurred.",
        "ja": "エラーが発生しました。",
        "zh": "发生错误。",
    },
}


def _scan_msg(key: str, locale: str = "ko", **kwargs) -> str:
    """Get a translated scan progress message."""
    msgs = _SCAN_MESSAGES.get(key, {})
    template = msgs.get(locale) or msgs.get("en") or msgs.get("ko", key)
    try:
        return template.format(**kwargs)
    except (KeyError, IndexError):
        return template


@router.post("/start", response_model=ScanStatusResponse, status_code=201)
async def start_scan(body: ScanStartRequest, _user: dict = Depends(require_admin)):
    wb = await db.get_workbook(body.workbook_id)
    if not wb:
        raise HTTPException(404, "Workbook not found")

    session_id = uuid.uuid4().hex
    data = {
        "session_id": session_id,
        "workbook_id": body.workbook_id,
        "status": "uploading",
        "page_urls": [],
        "start_page_index": body.start_page_index,
        "extraction_results": {
            "answers_found": 0,
            "explanations_found": 0,
            "warnings": [],
            "progress_message": "",
            "progress_pct": 0,
        },
    }
    await db.create_scan_session(session_id, data)
    return ScanStatusResponse(session_id=session_id, status="uploading")


@router.post("/{session_id}/page")
async def upload_page(session_id: str, file: UploadFile, page_tags: str = "", _user: dict = Depends(require_admin)):
    """Upload a page image with tag hints (comma-separated: answer,explanation,question)."""
    if page_tags:
        tags = [t.strip() for t in page_tags.split(",") if t.strip() in SCAN_VALID_PAGE_TAGS]
    else:
        tags = list(SCAN_DEFAULT_PAGE_TAGS)
    if not tags:
        tags = list(SCAN_DEFAULT_PAGE_TAGS)

    session = await db.get_scan_session(session_id)
    if not session:
        raise HTTPException(404, "Scan session not found")

    gcs_path = storage.upload_image(
        file.file,
        file.content_type or "image/jpeg",
        folder=f"scans/{session_id}/pages",
    )

    page_entry = {"url": gcs_path, "tags": tags}
    await db.update_scan_session(
        session_id,
        {"pages": fs.ArrayUnion([page_entry])},
    )
    return {"url": gcs_path, "tags": tags}


@router.delete("/{session_id}/page/{page_index}", status_code=200)
async def delete_page(session_id: str, page_index: int, _user: dict = Depends(require_admin)):
    """Remove an uploaded page by its index."""
    session = await db.get_scan_session(session_id)
    if not session:
        raise HTTPException(404, "Scan session not found")

    pages = list(session.get("pages", []))
    if page_index < 0 or page_index >= len(pages):
        raise HTTPException(404, "Page index out of range")

    pages.pop(page_index)
    await db.update_scan_session(session_id, {"pages": pages})
    return {"pages": pages}


# Keep legacy endpoints for backward compatibility
@router.post("/{session_id}/answer-page")
async def upload_answer_page(session_id: str, file: UploadFile, _user: dict = Depends(require_admin)):
    return await upload_page(session_id, file, _user=_user)


@router.post("/{session_id}/explanation-page")
async def upload_explanation_page(session_id: str, file: UploadFile, _user: dict = Depends(require_admin)):
    return await upload_page(session_id, file, _user=_user)


async def _update_progress(session_id: str, message: str, pct: int, **extra):
    """Update progress in Firestore for polling."""
    update = {
        "extraction_results.progress_message": message,
        "extraction_results.progress_pct": pct,
    }
    for k, v in extra.items():
        update[f"extraction_results.{k}"] = v
    await db.update_scan_session(session_id, update)


async def _process_scan_background(
    session_id: str, session: dict, locale: str = "ko",
    extraction_deadline: float = 0, post_deadline: float = 0,
):
    """Background task: extract answers and explanations from all pages.

    Uses asyncio.gather for parallel Gemini calls within each phase,
    bounded by SCAN_PARALLEL_CONCURRENCY semaphore.

    Two-stage deadline:
      - extraction_deadline: Phase 1~3 (Gemini extraction). If exceeded, skip to Phase 4.
      - post_deadline: Phase 4~6 (merge/verify/diagram/save). If exceeded, skip to save.
    """
    import time as _time
    workbook_id = session["workbook_id"]
    sem = asyncio.Semaphore(SCAN_PARALLEL_CONCURRENCY)

    def _extraction_timed_out() -> bool:
        return extraction_deadline > 0 and _time.monotonic() > extraction_deadline

    _post_deadline = [post_deadline]  # mutable container for dynamic extension

    def _post_timed_out() -> bool:
        return _post_deadline[0] > 0 and _time.monotonic() > _post_deadline[0]

    # Build page list — support both new `pages` and legacy `page_urls` format
    pages: list[dict] = list(session.get("pages", []))
    if not pages:
        for url in session.get("page_urls", []):
            pages.append({"url": url, "tags": list(SCAN_DEFAULT_PAGE_TAGS)})
        legacy_answer = session.get("answer_page_url")
        if legacy_answer:
            pages.append({"url": legacy_answer, "tags": list(SCAN_DEFAULT_PAGE_TAGS)})
        for url in session.get("explanation_page_urls", []):
            pages.append({"url": url, "tags": list(SCAN_DEFAULT_PAGE_TAGS)})

    # Migrate legacy `type` field → `tags`
    for p in pages:
        if "tags" not in p and "type" in p:
            t = p["type"]
            if t == "both":
                p["tags"] = ["answer", "explanation"]
            elif t in SCAN_VALID_PAGE_TAGS:
                p["tags"] = [t]
            else:
                p["tags"] = list(SCAN_DEFAULT_PAGE_TAGS)

    warnings: list[str] = []
    start_page = session.get("start_page_index", 1)

    # Filter pages by tag for each extraction type
    answer_pages = [p for p in pages if "answer" in p.get("tags", [])]
    explanation_pages = [p for p in pages if "explanation" in p.get("tags", [])]
    question_pages = [p for p in pages if "question" in p.get("tags", [])]

    # --- Phase 1: Extract answers FIRST ---
    await _update_progress(
        session_id,
        _scan_msg("extracting_answers", locale, count=len(answer_pages)),
        5,
    )

    async def _extract_one_answer(idx: int, page: dict):
        async with sem:
            try:
                img_bytes, mime = storage.download_image(page["url"])
                entries, img_page_range = await scan_service.extract_answers(
                    img_bytes, mime,
                )
                return {"entries": entries, "page_range": img_page_range, "idx": idx}
            except Exception as e:
                logger.warning("Answer extraction error for %s: %s", page["url"], e)
                return {"entries": [], "page_range": (None, None), "idx": idx, "error": str(e)}

    answer_results = await asyncio.gather(
        *[_extract_one_answer(i, p) for i, p in enumerate(answer_pages)]
    )

    all_answers: dict[int, dict] = {}
    page_range: tuple[int | None, int | None] = (None, None)

    for result in answer_results:
        if "error" in result:
            warnings.append(f"Answer extraction error (page {result['idx'] + 1})")
            continue
        img_page_range = result["page_range"]
        if page_range == (None, None) and img_page_range != (None, None):
            page_range = img_page_range
        for entry in result["entries"]:
            num = entry["number"]
            existing = all_answers.get(num)
            if not existing or entry.get("confidence", 0) > existing.get("confidence", 0):
                all_answers[num] = entry

    found_numbers = sorted(all_answers.keys())

    await _update_progress(
        session_id,
        _scan_msg("answers_found", locale, count=len(all_answers)),
        40,
        answers_found=len(all_answers),
    )

    # --- Phase 2: Process question (problem) pages → extract descriptions ---
    # Runs AFTER answer extraction so found_numbers can guide accuracy.
    # Maps problem number → {"description": str, "question_page_url": str}
    problem_desc_map: dict[int, dict] = {}
    if question_pages and not _extraction_timed_out():
        await _update_progress(
            session_id,
            _scan_msg("analyzing_problems", locale, count=len(question_pages)),
            45,
        )

        async def _extract_one_question(idx: int, page: dict):
            async with sem:
                try:
                    img_bytes, mime = storage.download_image(page["url"])
                    problems = await scan_service.extract_problem_descriptions(
                        img_bytes, mime,
                        known_numbers=found_numbers or None,
                        locale=locale,
                    )
                    return {"problems": problems, "idx": idx, "page_url": page["url"]}
                except Exception as e:
                    logger.warning("Question page error for %s: %s", page["url"], e)
                    return {"problems": [], "idx": idx, "page_url": page["url"], "error": str(e)}

        question_results = await asyncio.gather(
            *[_extract_one_question(i, p) for i, p in enumerate(question_pages)]
        )

        for result in question_results:
            if "error" in result:
                warnings.append(f"Problem analysis error (page {result['idx'] + 1})")
                continue
            page_url = result["page_url"]
            for prob in result["problems"]:
                num = prob.get("number")
                desc = prob.get("description", "")
                if num and desc and num not in problem_desc_map:
                    problem_desc_map[num] = {
                        "description": desc,
                        "question_page_url": page_url,
                        "is_image_interaction": bool(prob.get("is_image_interaction", False)),
                    }

        logger.info("Problem description map: %d problems extracted", len(problem_desc_map))

    if not all_answers:
        # Even without new answers, save problem descriptions to existing answer keys
        if problem_desc_map:
            existing_keys = await db.list_answer_keys(workbook_id)
            updated_count = 0
            for key in existing_keys:
                num = key.get("number")
                if num in problem_desc_map and not key.get("problem_description"):
                    key["problem_description"] = problem_desc_map[num]["description"]
                    key["source_question_page_url"] = problem_desc_map[num].get("question_page_url")
                    await db.set_answer_key(
                        workbook_id, key["page"], num, key,
                    )
                    updated_count += 1
            logger.info("Updated %d existing answer keys with problem descriptions", updated_count)
            # Auto-lock workbook on successful completion
            await db.update_workbook(workbook_id, {
                "status": "locked",
                "locked_at": datetime.now(timezone.utc),
            })
            await db.update_scan_session(session_id, {
                "status": "done",
                "extraction_results": {
                    "answers_found": 0,
                    "explanations_found": 0,
                    "problem_descriptions_found": len(problem_desc_map),
                    "warnings": warnings,
                    "progress_message": _scan_msg("problems_registered", locale, count=updated_count),
                    "progress_pct": 100,
                },
            })
            return

        warnings.append("Answer extraction failed. Please check the photos.")
        await db.update_scan_session(session_id, {
            "status": "done",
            "extraction_results": {
                "answers_found": 0,
                "explanations_found": 0,
                "problem_descriptions_found": 0,
                "warnings": warnings,
                "progress_message": _scan_msg("done_no_answers", locale),
                "progress_pct": 100,
            },
        })
        return

    # Check low-confidence answers
    for num, entry in all_answers.items():
        if entry.get("confidence", 1.0) < SCAN_CONFIDENCE_WARN_THRESHOLD:
            warnings.append(
                f"#{num}: Low extraction confidence ({entry.get('confidence', 0):.0%})"
            )

    # --- Phase 3: Extract explanations in parallel ---
    all_explanations: dict[int, dict] = {}
    if _extraction_timed_out():
        warnings.append("Timeout — skipped explanation extraction")
    else:
        await _update_progress(
            session_id,
            _scan_msg("extracting_explanations", locale, count=len(explanation_pages)),
            55,
        )

        async def _extract_one_explanation(idx: int, page: dict):
            async with sem:
                try:
                    img_bytes, mime = storage.download_image(page["url"])
                    exp_entries = await scan_service.extract_explanations(
                        img_bytes, mime, found_numbers, locale=locale,
                    )
                    return {"entries": exp_entries, "idx": idx}
                except Exception as e:
                    logger.warning("Explanation extraction error for %s: %s", page["url"], e)
                    return {"entries": [], "idx": idx, "error": str(e)}

        explanation_results = await asyncio.gather(
            *[_extract_one_explanation(i, p) for i, p in enumerate(explanation_pages)]
        )

        for result in explanation_results:
            if "error" in result:
                warnings.append(f"Explanation extraction error (page {result['idx'] + 1})")
                continue
            for exp in result["entries"]:
                num = exp["number"]
                if num not in all_explanations:
                    all_explanations[num] = exp

    # --- Phase 4: Merge ---
    await _update_progress(session_id, _scan_msg("merging", locale), 75)

    merged_entries = []
    for num in sorted(all_answers.keys()):
        ans = all_answers[num]
        exp = all_explanations.get(num, {})
        entry = {
            "page": start_page,
            "number": num,
            "final_answer": ans["final_answer"],
            "answer_type": ans["answer_type"],
            "solution_steps": exp.get("solution_steps", []),
            "pitfalls": exp.get("pitfalls", []),
            "concept_tag": exp.get("concept_tag", CONCEPT_TAG_DEFAULT),
            "problem_type": PROBLEM_TYPE_DEFAULT,
            "extraction_confidence": ans.get("confidence", 1.0),
            "manually_corrected": False,
            "source_page_start": page_range[0],
            "source_page_end": page_range[1],
            "problem_description": problem_desc_map[num]["description"] if num in problem_desc_map else None,
            "source_question_page_url": problem_desc_map[num].get("question_page_url") if num in problem_desc_map else None,
            "is_image_interaction": problem_desc_map[num].get("is_image_interaction", False) if num in problem_desc_map else False,
            "image_dependent": False,
            "review_enabled": True,
            "verify_enabled": True,
        }
        merged_entries.append(entry)

    # --- Recalculate post_deadline based on diagram count ---
    diagram_count = sum(
        1 for e in merged_entries
        if (e.get("problem_description") or "")
        and (diagram_service.has_diagram_marker(e["problem_description"]) or e.get("is_image_interaction"))
    )
    _post_deadline[0] = _time.monotonic() + SCAN_EXTRA_TIMEOUT_S + (diagram_count * SCAN_EXTRA_TIMEOUT_S)
    logger.info(
        "Scan %s: Phase 4 done, %d entries, %d diagrams → post_deadline=%ds from now",
        session_id, len(merged_entries), diagram_count,
        SCAN_EXTRA_TIMEOUT_S + (diagram_count * SCAN_EXTRA_TIMEOUT_S),
    )

    # --- Phase 5: LLM Verification & Refinement ---
    if _post_timed_out():
        warnings.append("Timeout — skipped verification")
    else:
        await _update_progress(session_id, _scan_msg("verifying", locale), 85)
        try:
            merged_entries = await scan_service.verify_and_refine_entries(merged_entries, locale=locale)
        except Exception as e:
            logger.warning("Phase 5 verification failed: %s — using unverified entries", e)
            warnings.append("LLM verification failed — manual review recommended")

    # --- Phase 5.5: Handle diagrams + image interaction conversion ---
    if _post_timed_out():
        warnings.append("Timeout — skipped diagram generation")
    elif not merged_entries:
        pass  # nothing to process
    else:
        await _update_progress(session_id, _scan_msg("diagrams", locale), 90)
        try:
            # Collect unique question page URLs needed for diagram/conversion
            urls_needed: set[str] = set()
            for entry in merged_entries:
                desc = entry.get("problem_description", "") or ""
                if diagram_service.has_diagram_marker(desc) or entry.get("is_image_interaction"):
                    url = entry.get("source_question_page_url")
                    if url:
                        urls_needed.add(url)

            # Download only the needed question page images (deduplicated by URL)
            question_page_images: dict[str, tuple[bytes, str]] = {}
            for url in urls_needed:
                try:
                    img_bytes, mime = storage.download_image(url)
                    question_page_images[url] = (img_bytes, mime)
                except Exception as e:
                    logger.warning("Failed to download question page: %s", e)

            # Convert image-interaction problems to text-only
            for entry in merged_entries:
                if not entry.get("is_image_interaction"):
                    continue
                desc = entry.get("problem_description", "") or ""
                num = entry["number"]
                src_url = entry.get("source_question_page_url")
                img_bytes, img_mime = question_page_images.get(src_url, (None, None)) if src_url else (None, None)
                try:
                    result = await diagram_service.convert_to_text_choice(
                        desc,
                        original_answer=entry.get("final_answer", ""),
                        source_image_bytes=img_bytes,
                        source_image_mime=img_mime,
                    )
                    if result:
                        entry["problem_description"] = result["converted_text"]
                        if result.get("correct_answer"):
                            entry["final_answer"] = result["correct_answer"]
                        entry["is_image_interaction"] = False
                        entry["diagram_svg"] = None
                        logger.info("Converted image-interaction problem %d to text, answer=%s", num, result.get("correct_answer"))
                    else:
                        entry["image_dependent"] = True
                        entry["verify_enabled"] = False
                        logger.warning("Text conversion failed for problem %d → image_dependent", num)
                except Exception as e:
                    entry["image_dependent"] = True
                    entry["verify_enabled"] = False
                    logger.warning("Text conversion error for problem %d: %s", num, e)

            # Generate SVG diagrams one by one with progress updates
            diagram_tasks: list[tuple[dict, str]] = []
            for entry in merged_entries:
                desc = entry.get("problem_description", "") or ""
                diagram_desc = diagram_service.extract_diagram_description(desc)
                if diagram_desc:
                    diagram_tasks.append((entry, diagram_desc))

            total_diagrams = len(diagram_tasks)
            generated_count = 0
            for idx, (entry, diagram_desc) in enumerate(diagram_tasks):
                if _post_timed_out():
                    warnings.append(f"Timeout — skipped {total_diagrams - idx} remaining diagrams")
                    break
                await _update_progress(
                    session_id,
                    _scan_msg("diagram_progress", locale, current=idx + 1, total=total_diagrams),
                    90 + int(5 * (idx + 1) / max(total_diagrams, 1)),
                )
                src_url = entry.get("source_question_page_url")
                img_bytes, img_mime = question_page_images.get(src_url, (None, None)) if src_url else (None, None)
                try:
                    svg = await diagram_service.generate_diagram_svg(
                        entry=entry,
                        diagram_description=diagram_desc,
                        source_image_bytes=img_bytes,
                        source_image_mime=img_mime,
                        locale=locale,
                    )
                    if svg:
                        entry["diagram_svg"] = svg
                        generated_count += 1
                except Exception as e:
                    logger.warning("Diagram generation failed for problem %d: %s", entry["number"], e)
            if total_diagrams > 0:
                logger.info("Generated %d/%d diagrams", generated_count, total_diagrams)
        except Exception as e:
            logger.warning("Diagram generation failed: %s — continuing without diagrams", e)
            warnings.append("Diagram generation failed — manual regeneration recommended")

    # --- Phase 6: Save ---
    await _update_progress(session_id, _scan_msg("saving", locale), 95)
    # batch_set uses Firestore .set which is upsert per doc
    await db.batch_set_answer_keys(workbook_id, merged_entries)

    # Recount ALL answer keys in workbook (not just new ones)
    all_keys = await db.list_answer_keys(workbook_id)
    total_answers = len(all_keys)
    total_explanations = sum(
        1 for k in all_keys if k.get("solution_steps") and len(k["solution_steps"]) > 0
    )
    await db.update_workbook(workbook_id, {
        "problem_count": total_answers,
        "answer_coverage": total_answers,
        "explanation_coverage": total_explanations,
        "status": "locked",
        "locked_at": datetime.now(timezone.utc),
    })

    await db.update_scan_session(session_id, {
        "status": "done",
        "extraction_results": {
            "answers_found": len(merged_entries),
            "explanations_found": len(all_explanations),
            "problem_descriptions_found": len(problem_desc_map),
            "warnings": warnings,
            "progress_message": _scan_msg("done", locale),
            "progress_pct": 100,
        },
    })


@router.patch("/{session_id}/page-tags")
async def update_page_tags(session_id: str, page_tags: list[dict], _user: dict = Depends(require_admin)):
    """Update page tags (answer/explanation/question checkboxes) for uploaded pages."""
    session = await db.get_scan_session(session_id)
    if not session:
        raise HTTPException(404, "Scan session not found")

    pages = list(session.get("pages", []))
    for update in page_tags:
        idx = update.get("index")
        raw_tags = update.get("tags", [])
        tags = [t for t in raw_tags if t in SCAN_VALID_PAGE_TAGS]
        if not tags:
            tags = list(SCAN_DEFAULT_PAGE_TAGS)
        if isinstance(idx, int) and 0 <= idx < len(pages):
            pages[idx]["tags"] = tags

    await db.update_scan_session(session_id, {"pages": pages})
    return {"pages": pages}


async def _process_with_timeout(session_id: str, session: dict, locale: str = "ko"):
    """Wrapper that computes dynamic deadlines based on page count.

    - extraction_deadline: ceil(pages / concurrency) * MS_PER_BATCH_S for Phase 1~3
    - post_deadline: extraction_deadline + EXTRA_TIMEOUT_S for Phase 4~6
    """
    import math
    import time as _time

    pages = list(session.get("pages", []))
    page_count = max(len(pages), 1)
    batches = math.ceil(page_count / SCAN_PARALLEL_CONCURRENCY)
    extraction_timeout = batches * SCAN_MS_PER_BATCH_S
    now = _time.monotonic()
    extraction_deadline = now + extraction_timeout
    post_deadline = extraction_deadline + SCAN_EXTRA_TIMEOUT_S

    logger.info(
        "Scan %s: %d pages, %d batches → extraction %ds, post %ds",
        session_id, page_count, batches, extraction_timeout, SCAN_EXTRA_TIMEOUT_S,
    )

    try:
        await _process_scan_background(
            session_id, session, locale=locale,
            extraction_deadline=extraction_deadline,
            post_deadline=post_deadline,
        )
    except asyncio.CancelledError:
        logger.info("Scan %s cancelled by user", session_id)
        await db.update_scan_session(session_id, {
            "status": "done",
            "extraction_results.progress_message": _scan_msg("cancelled", locale),
            "extraction_results.progress_pct": 100,
        })
    except Exception:
        logger.exception("Scan %s unexpected error", session_id)
        await db.update_scan_session(session_id, {
            "status": "done",
            "extraction_results.progress_message": _scan_msg("error_occurred", locale),
            "extraction_results.progress_pct": 100,
        })
    finally:
        _running_tasks.pop(session_id, None)


@router.post("/{session_id}/process", response_model=ScanStatusResponse)
async def process_scan(session_id: str, request: Request, _user: dict = Depends(require_admin)):
    """Trigger OCR + extraction pipeline (runs in background)."""
    locale = get_locale(request)
    session = await db.get_scan_session(session_id)
    if not session:
        raise HTTPException(404, "Scan session not found")

    pages: list[dict] = list(session.get("pages", []))
    page_urls: list[str] = list(session.get("page_urls", []))
    if not pages and not page_urls:
        raise HTTPException(400, "No pages uploaded yet")

    starting_msg = _scan_msg("starting", locale)
    await db.update_scan_session(session_id, {
        "status": "processing",
        "extraction_results.progress_message": starting_msg,
        "extraction_results.progress_pct": 0,
    })

    # Cancel any existing task for this session
    old_task = _running_tasks.pop(session_id, None)
    if old_task and not old_task.done():
        old_task.cancel()

    task = asyncio.create_task(_process_with_timeout(session_id, session, locale=locale))
    _running_tasks[session_id] = task

    return ScanStatusResponse(
        session_id=session_id,
        status="processing",
        progress_message=starting_msg,
        progress_pct=0,
    )


@router.post("/{session_id}/cancel")
async def cancel_scan(session_id: str, _user: dict = Depends(require_admin)):
    """Cancel a running scan process."""
    task = _running_tasks.get(session_id)
    if not task or task.done():
        raise HTTPException(400, "No running scan to cancel")

    task.cancel()
    return {"status": "cancelled"}


@router.get("/{session_id}/answer-keys")
async def list_session_answer_keys(session_id: str, _user: dict = Depends(require_admin)):
    """List all extracted answer keys for this scan session's workbook."""
    session = await db.get_scan_session(session_id)
    if not session:
        raise HTTPException(404, "Scan session not found")

    workbook_id = session["workbook_id"]
    keys = await db.list_answer_keys(workbook_id)
    keys.sort(key=lambda x: (x.get("page", 0), x.get("number", 0)))
    return {"answer_keys": keys}


@router.patch("/{session_id}/answer-key/{page}/{number}")
async def edit_answer_key(session_id: str, page: int, number: int, body: AnswerKeyEdit, _user: dict = Depends(require_admin)):
    """Edit/correct a single extracted answer."""
    session = await db.get_scan_session(session_id)
    if not session:
        raise HTTPException(404, "Scan session not found")

    workbook_id = session["workbook_id"]

    existing = await db.get_answer_key(workbook_id, page, number)
    if not existing:
        raise HTTPException(404, f"Answer key for problem {page}_{number} not found")

    update_data = body.model_dump(exclude_unset=True)
    update_data["manually_corrected"] = True
    update_data["extraction_confidence"] = 1.0

    merged = {**existing, **update_data}
    await db.set_answer_key(workbook_id, page, number, merged)

    return merged


@router.post("/{session_id}/answer-key/{page}/{number}/regenerate-diagram")
async def regenerate_scan_diagram(session_id: str, page: int, number: int, _user: dict = Depends(require_admin)):
    """Regenerate SVG diagram for a scan answer key entry."""
    session = await db.get_scan_session(session_id)
    if not session:
        raise HTTPException(404, "Scan session not found")

    workbook_id = session["workbook_id"]
    existing = await db.get_answer_key(workbook_id, page, number)
    if not existing:
        raise HTTPException(404, f"Answer key {page}_{number} not found")

    desc = existing.get("problem_description") or ""
    diagram_desc = diagram_service.extract_diagram_description(desc)
    if not diagram_desc:
        raise HTTPException(400, "This problem has no [Diagram: ...] marker.")

    source_img_bytes = None
    source_img_mime = None
    src_url = existing.get("source_question_page_url")
    if src_url:
        try:
            source_img_bytes, source_img_mime = storage.download_image(src_url)
        except Exception as e:
            logger.warning("Could not load source image for diagram regen: %s", e)

    svg = await diagram_service.generate_diagram_svg(
        entry=existing,
        diagram_description=diagram_desc,
        source_image_bytes=source_img_bytes,
        source_image_mime=source_img_mime,
    )
    if not svg:
        raise HTTPException(
            422, "Diagram generation failed. Check server logs for details.",
        )

    existing["diagram_svg"] = svg
    await db.set_answer_key(workbook_id, page, number, existing)
    return existing


@router.post("/{session_id}/upload-problem-image")
async def upload_scan_problem_image(session_id: str, file: UploadFile, _user: dict = Depends(require_admin)):
    """Upload a cropped problem image to GCS. Returns URL for use as problem_image_url."""
    session = await db.get_scan_session(session_id)
    if not session:
        raise HTTPException(404, "Scan session not found")

    workbook_id = session["workbook_id"]
    mime = file.content_type or "image/jpeg"
    contents = await file.read()
    import io
    gcs_url = storage.upload_image(
        io.BytesIO(contents), mime,
        folder=f"problem_images/{workbook_id}",
    )
    return {"url": gcs_url}


@router.get("/{session_id}/answer-key/{page}/{number}/source-image")
async def get_source_image(session_id: str, page: int, number: int, _user: dict = Depends(require_admin)):
    """Proxy the source question page image for browser display (e.g. cropper)."""
    session = await db.get_scan_session(session_id)
    if not session:
        raise HTTPException(404, "Scan session not found")

    workbook_id = session["workbook_id"]
    existing = await db.get_answer_key(workbook_id, page, number)
    if not existing:
        raise HTTPException(404, f"Answer key {page}_{number} not found")

    gcs_path = existing.get("source_question_page_url")
    if not gcs_path:
        raise HTTPException(404, "No source image for this entry")

    try:
        img_bytes, mime = storage.download_image(gcs_path)
    except Exception:
        raise HTTPException(404, "Source image not found in storage")

    return Response(content=img_bytes, media_type=mime)


@router.delete("/{session_id}/answer-key/{page}/{number}")
async def delete_answer_key(session_id: str, page: int, number: int, _user: dict = Depends(require_admin)):
    """Delete a single answer key entry."""
    session = await db.get_scan_session(session_id)
    if not session:
        raise HTTPException(404, "Scan session not found")

    workbook_id = session["workbook_id"]
    existing = await db.get_answer_key(workbook_id, page, number)
    if not existing:
        raise HTTPException(404, f"Answer key {page}_{number} not found")

    await db.delete_answer_key(workbook_id, page, number)
    return {"deleted": f"{page}_{number}"}


@router.post("/{session_id}/ocr-problem")
async def ocr_problem_description(session_id: str, file: UploadFile, _user: dict = Depends(require_admin)):
    """OCR a single problem image → extract problem description text."""
    session = await db.get_scan_session(session_id)
    if not session:
        raise HTTPException(404, "Scan session not found")

    image_bytes = await file.read()
    mime_type = file.content_type or "image/jpeg"
    problems = await scan_service.extract_problem_descriptions(image_bytes, mime_type)
    # Return the first extracted problem, or empty
    text = problems[0]["description"] if problems else ""
    return {"text": text}


@router.post("/{session_id}/ocr-explanation")
async def ocr_explanation(session_id: str, file: UploadFile, _user: dict = Depends(require_admin)):
    """OCR a single explanation image → extract solution steps and pitfalls."""
    session = await db.get_scan_session(session_id)
    if not session:
        raise HTTPException(404, "Scan session not found")

    image_bytes = await file.read()
    mime_type = file.content_type or "image/jpeg"
    # Extract explanations — pass empty problem_numbers to get all
    blocks = await scan_service.extract_explanations(image_bytes, mime_type, [])
    # Return the first block, or empty
    if blocks:
        return {
            "solution_steps": blocks[0].get("solution_steps", []),
            "pitfalls": blocks[0].get("pitfalls", []),
        }
    return {"solution_steps": [], "pitfalls": []}


@router.post("/{session_id}/lock")
async def lock_workbook(session_id: str, _user: dict = Depends(require_admin)):
    session = await db.get_scan_session(session_id)
    if not session:
        raise HTTPException(404, "Scan session not found")

    workbook_id = session["workbook_id"]
    await db.update_workbook(workbook_id, {
        "status": "locked",
        "locked_at": datetime.now(timezone.utc),
    })
    await db.update_scan_session(session_id, {"status": "complete"})
    return {"status": "locked", "workbook_id": workbook_id}


@router.get("/{session_id}/status", response_model=ScanStatusResponse)
async def get_scan_status(session_id: str, _user: dict = Depends(require_admin)):
    session = await db.get_scan_session(session_id)
    if not session:
        raise HTTPException(404, "Scan session not found")

    results = session.get("extraction_results", {})
    return ScanStatusResponse(
        session_id=session_id,
        status=session.get("status", "unknown"),
        answers_found=results.get("answers_found", 0),
        explanations_found=results.get("explanations_found", 0),
        problem_descriptions_found=results.get("problem_descriptions_found", 0),
        warnings=results.get("warnings", []),
        progress_message=results.get("progress_message", ""),
        progress_pct=results.get("progress_pct", 0),
    )


# ---------------------------------------------------------------------------
#  Test endpoint: single image → extract problems → generate diagrams
# ---------------------------------------------------------------------------

@router.post("/test-diagram")
async def test_diagram(file: UploadFile, _user: dict = Depends(require_admin)):
    """Upload a single question page image, extract problems, and generate
    SVG diagrams with the original image as visual reference.

    Returns list of extracted problems with their diagram SVGs (if any).
    """
    img_bytes = await file.read()
    mime = file.content_type or "image/jpeg"

    # Step 1: Extract problem descriptions from the image
    try:
        problems = await scan_service.extract_problem_descriptions(img_bytes, mime)
    except Exception as e:
        logger.exception("test-diagram: problem extraction failed")
        raise HTTPException(422, f"Problem extraction failed: {e}")

    if not problems:
        return {"problems": []}

    # Step 2: Detect diagram bounding boxes (parallel with SVG generation)
    bounds_map = await scan_service.detect_diagram_bounds(img_bytes, mime)

    # Step 3: For each problem, handle diagram generation or text conversion
    results = []
    for prob in problems:
        num = prob.get("number", 0)
        desc = prob.get("description", "")
        diagram_desc = diagram_service.extract_diagram_description(desc)
        is_interaction = bool(prob.get("is_image_interaction", False))
        logger.info(
            "test-diagram #%d: is_interaction=%s, has_diagram=%s, desc=%s",
            num, is_interaction, bool(diagram_desc), desc[:120],
        )

        svg = None
        converted_text = None

        if is_interaction:
            # Image-interaction problem → convert to text-based choice
            converted_text = await diagram_service.convert_to_text_choice(
                desc,
                source_image_bytes=img_bytes,
                source_image_mime=mime,
            )
        elif diagram_desc:
            # Normal diagram → generate SVG
            entry = {
                "number": num,
                "problem_description": desc,
            }
            svg = await diagram_service.generate_diagram_svg(
                entry=entry,
                diagram_description=diagram_desc,
                source_image_bytes=img_bytes,
                source_image_mime=mime,
            )

        results.append({
            "number": num,
            "description": desc,
            "diagram_description": diagram_desc,
            "diagram_svg": svg,
            "diagram_bounds": bounds_map.get(num),
            "is_image_interaction": is_interaction,
            "converted_text": converted_text,
        })

    return {"problems": results}
