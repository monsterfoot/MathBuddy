"""Scan service — Gemini Vision extraction for answer keys and explanations."""

import asyncio
import json
import logging
from typing import Optional

from google import genai
from google.genai import types

from config import (
    CONCEPT_TAG_LIST,
    GCP_LOCATION,
    GCP_PROJECT,
    GEMINI_MODEL,
    PROBLEM_EXTRACT_MAX_TOKENS,
    PROBLEM_EXTRACT_TEMPERATURE,
    PROBLEM_TYPE_LIST,
    SCAN_MAX_OUTPUT_TOKENS,
    SCAN_MAX_RETRIES,
    SCAN_PER_CALL_TIMEOUT_S,
    SCAN_TEMPERATURE,
    SCAN_VERIFY_CHUNK_SIZE,
    SCAN_VERIFY_MAX_OUTPUT_TOKENS,
    SCAN_VERIFY_TEMPERATURE,
)
from services.locale_service import get_language_name, with_response_language

logger = logging.getLogger(__name__)

_client: Optional[genai.Client] = None


def _salvage_truncated_json(raw: str, array_key: str) -> list[dict] | None:
    """Try to recover valid items from truncated JSON output.

    If Gemini's response was cut off mid-JSON, we attempt to find
    complete array items before the truncation point.
    """
    import re
    try:
        # Find the array content after the key
        pattern = rf'"{array_key}"\s*:\s*\['
        match = re.search(pattern, raw)
        if not match:
            return None
        arr_start = match.end()

        # Try progressively shorter substrings to find valid JSON items
        # Look for the last complete "}" before the end
        items: list[dict] = []
        depth = 0
        item_start = None
        i = arr_start
        while i < len(raw):
            ch = raw[i]
            if ch == '{' and depth == 0:
                item_start = i
                depth = 1
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0 and item_start is not None:
                    try:
                        item = _json_loads_latex_safe(raw[item_start:i + 1])
                        items.append(item)
                    except json.JSONDecodeError:
                        pass
                    item_start = None
            i += 1

        return items if items else None
    except Exception:
        return None


from services.math_expression import json_loads_latex_safe as _json_loads_latex_safe


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(
            vertexai=True,
            project=GCP_PROJECT,
            location=GCP_LOCATION,
        )
    return _client


# --- Answer Extraction ---

ANSWER_EXTRACT_PROMPT = """\
You are a precise math answer-key OCR assistant.
This photo is an answer page from a math workbook.
Extract the final answer for every problem.

## Extraction rules
1. Match each problem number to its correct answer exactly.
2. Normalize answers:
   - Integer: "-12"
   - Fraction: reduced form "-7/6" (sign on numerator)
   - Decimal: "0.5"
   - Multiple choice (number): "choice:2" (for circled 2)
   - Multiple choice (Korean consonant): "choice:ㄷ" (ㄱ,ㄴ,ㄷ,ㄹ,ㅁ)
   - Multiple choice (Korean syllable): "choice:다" (가,나,다,라,마)
3. Set confidence low when the text is unreadable or uncertain.
4. Do NOT include problem numbers that are not on the photo.
5. If the top or bottom of the photo shows a textbook page range \
(e.g. "p.10~15", "10~15쪽"), extract it as source_page_start and \
source_page_end. Otherwise set them to null.

Respond ONLY in the JSON format below:
"""

ANSWER_EXTRACT_SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "source_page_start": types.Schema(
            type=types.Type.INTEGER,
            description="Textbook start page (e.g. 10). null if absent.",
            nullable=True,
        ),
        "source_page_end": types.Schema(
            type=types.Type.INTEGER,
            description="Textbook end page (e.g. 15). null if absent.",
            nullable=True,
        ),
        "answers": types.Schema(
            type=types.Type.ARRAY,
            items=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "number": types.Schema(
                        type=types.Type.INTEGER,
                        description="Problem number",
                    ),
                    "final_answer": types.Schema(
                        type=types.Type.STRING,
                        description="Normalized final answer",
                    ),
                    "answer_type": types.Schema(
                        type=types.Type.STRING,
                        description="Answer type",
                        enum=["integer", "fraction", "decimal", "choice"],
                    ),
                    "confidence": types.Schema(
                        type=types.Type.NUMBER,
                        description="Extraction confidence (0.0~1.0)",
                    ),
                },
                required=["number", "final_answer", "answer_type", "confidence"],
            ),
        ),
    },
    required=["answers"],
)


async def extract_answers(
    image_bytes: bytes,
    mime_type: str,
) -> tuple[list[dict], tuple[int | None, int | None]]:
    """Extract answers from a photographed answer page.

    Returns:
        Tuple of (answers_list, (source_page_start, source_page_end)).
        answers_list: List of dicts with number, final_answer, answer_type, confidence.
        source_page_*: Textbook page range found on the image, or (None, None).
    """
    client = _get_client()

    parts = [
        types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
        ANSWER_EXTRACT_PROMPT,
    ]

    config = types.GenerateContentConfig(
        temperature=SCAN_TEMPERATURE,
        max_output_tokens=SCAN_MAX_OUTPUT_TOKENS,
        response_mime_type="application/json",
        response_schema=ANSWER_EXTRACT_SCHEMA,
    )

    last_error = None
    raw_text = ""
    for attempt in range(SCAN_MAX_RETRIES + 1):
        try:
            response = await asyncio.wait_for(
                client.aio.models.generate_content(
                    model=GEMINI_MODEL,
                    contents=parts,
                    config=config,
                ),
                timeout=SCAN_PER_CALL_TIMEOUT_S,
            )
            raw_text = response.text or ""
            logger.debug("Answer extraction raw (attempt %d, %d chars): %s",
                         attempt + 1, len(raw_text), raw_text[:500])
            result = _json_loads_latex_safe(raw_text)
            answers = result.get("answers", [])
            page_range = (
                result.get("source_page_start"),
                result.get("source_page_end"),
            )
            logger.info(
                "Answer extraction (attempt %d): found %d answers, page_range=%s",
                attempt + 1,
                len(answers),
                page_range,
            )
            return answers, page_range
        except asyncio.TimeoutError:
            last_error = TimeoutError(f"Gemini call timed out after {SCAN_PER_CALL_TIMEOUT_S}s")
            logger.warning("Answer extraction timeout (attempt %d): %ds exceeded",
                           attempt + 1, SCAN_PER_CALL_TIMEOUT_S)
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            last_error = e
            logger.warning("Answer extraction parse error (attempt %d): %s", attempt + 1, e)
            # Try to salvage truncated JSON
            salvaged = _salvage_truncated_json(raw_text, "answers")
            if salvaged:
                logger.info("Salvaged %d answers from truncated response", len(salvaged))
                return salvaged, (None, None)
        except Exception as e:
            last_error = e
            logger.exception("Answer extraction API error (attempt %d): %s", attempt + 1, e)

    logger.error(
        "Answer extraction failed after %d attempts: %s",
        SCAN_MAX_RETRIES + 1,
        last_error,
    )
    return [], (None, None)


# --- Explanation Extraction ---

EXPLANATION_EXTRACT_PROMPT_TEMPLATE = """\
You are a math explanation OCR assistant.
This photo is an explanation/solution page from a math workbook.
Extract the explanations for the following problem numbers: {problem_numbers}

## Extraction rules (IMPORTANT!)
1. Extract the explanation from the photo and translate into the target language specified at the end of this prompt.
2. Do NOT reinterpret or invent your own solution — stay faithful to the original content.
3. solution_steps: Extract and translate the solution steps into the target language.
   Keep math expressions ($...$) unchanged — only translate the natural language text.
   Example: "$(-5)+(-8) = -13$", "$\\frac{{3}}{{4}} \\times \\frac{{2}}{{3}} = \\frac{{1}}{{2}}$"
4. pitfalls: Extract and translate items labeled as "caution", "common mistake", or "wrong answer" in the photo. Leave as empty array if none found.
5. concept_tag: Math domain classification for the problem (choose 1 from list below)

## Concept tag list (math domains)
- CALC: Numbers & Operations — integers, rationals, reals, arithmetic, factors/multiples, prime factorization, etc.
- ALG: Algebra — variables, linear/quadratic equations, inequalities, factoring, etc.
- FUNC: Functions & Change — functions, coordinates, graphs, proportional/inverse relationships, ratios, etc.
- GEO: Geometry & Measurement — shapes, area, volume, angles, congruence, symmetry, trigonometric ratios, etc.
- STAT: Probability & Statistics — statistics, probability, tables, graph interpretation, representative values, etc.

Skip any problems not found in the photo.
Respond ONLY in the JSON format below:
"""

EXPLANATION_EXTRACT_SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "blocks": types.Schema(
            type=types.Type.ARRAY,
            items=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "number": types.Schema(
                        type=types.Type.INTEGER,
                        description="Problem number",
                    ),
                    "solution_steps": types.Schema(
                        type=types.Type.ARRAY,
                        items=types.Schema(type=types.Type.STRING),
                        description="Key solution steps (2-5 items)",
                    ),
                    "pitfalls": types.Schema(
                        type=types.Type.ARRAY,
                        items=types.Schema(type=types.Type.STRING),
                        description="Common mistakes (1-2 items)",
                    ),
                    "concept_tag": types.Schema(
                        type=types.Type.STRING,
                        description="Math domain tag",
                        enum=["CALC", "ALG", "FUNC", "GEO", "STAT"],
                    ),
                },
                required=["number", "solution_steps", "pitfalls", "concept_tag"],
            ),
        ),
    },
    required=["blocks"],
)


async def extract_explanations(
    image_bytes: bytes,
    mime_type: str,
    problem_numbers: list[int],
    locale: str = "ko",
) -> list[dict]:
    """Extract solution steps, pitfalls, and concept tags from explanation page.

    Args:
        image_bytes: Raw image data.
        mime_type: MIME type.
        problem_numbers: Which problem numbers to look for on this page.
        locale: Target language locale for extracted text.

    Returns:
        List of dicts with number, solution_steps, pitfalls, concept_tag.
    """
    client = _get_client()

    prompt = EXPLANATION_EXTRACT_PROMPT_TEMPLATE.format(
        problem_numbers=", ".join(str(n) for n in problem_numbers),
    )
    prompt = with_response_language(prompt, locale)

    parts = [
        types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
        prompt,
    ]

    config = types.GenerateContentConfig(
        temperature=SCAN_TEMPERATURE,
        max_output_tokens=SCAN_MAX_OUTPUT_TOKENS,
        response_mime_type="application/json",
        response_schema=EXPLANATION_EXTRACT_SCHEMA,
    )

    last_error = None
    raw_text = ""
    for attempt in range(SCAN_MAX_RETRIES + 1):
        try:
            response = await asyncio.wait_for(
                client.aio.models.generate_content(
                    model=GEMINI_MODEL,
                    contents=parts,
                    config=config,
                ),
                timeout=SCAN_PER_CALL_TIMEOUT_S,
            )
            raw_text = response.text or ""
            logger.debug("Explanation extraction raw (attempt %d, %d chars): %s",
                         attempt + 1, len(raw_text), raw_text[:500])
            result = _json_loads_latex_safe(raw_text)
            blocks = result.get("blocks", [])
            logger.info(
                "Explanation extraction (attempt %d): found %d entries",
                attempt + 1,
                len(blocks),
            )
            return blocks
        except asyncio.TimeoutError:
            last_error = TimeoutError(f"Gemini call timed out after {SCAN_PER_CALL_TIMEOUT_S}s")
            logger.warning("Explanation extraction timeout (attempt %d): %ds exceeded",
                           attempt + 1, SCAN_PER_CALL_TIMEOUT_S)
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            last_error = e
            logger.warning("Explanation parse error (attempt %d): %s", attempt + 1, e)
            salvaged = _salvage_truncated_json(raw_text, "blocks")
            if salvaged:
                logger.info("Salvaged %d explanation blocks from truncated response", len(salvaged))
                return salvaged
        except Exception as e:
            last_error = e
            logger.exception("Explanation API error (attempt %d): %s", attempt + 1, e)

    logger.error(
        "Explanation extraction failed after %d attempts: %s",
        SCAN_MAX_RETRIES + 1,
        last_error,
    )
    return []


# --- Problem Description Extraction ---

PROBLEM_DESCRIPTION_EXTRACT_PROMPT = """\
You are a math workbook OCR assistant.
This photo is a problem (question) page from a math workbook.
Extract the number and content of every problem on the photo.

## Extraction rules
1. Find all main problem numbers visible in the photo.
2. Ignore sub-items (circled numbers, (1), (a), etc.) — extract main problem numbers only.
3. Extract and translate each problem's content into the target language:
   - Do NOT summarize. Extract the problem in full without omissions.
   - Translate all natural language text into the target language specified at the end of this prompt.
   - Keep math expressions ($...$), numbers, formulas, and units unchanged — only translate the surrounding text.
   - For multiple-choice problems, translate option text but keep option markers (①②③④⑤).

4. **Problems with diagrams/figures MUST include a text description of the figure:**
   - **Always use the exact marker format `[Diagram: description]` — do NOT translate the word "Diagram" into any other language.**
   - Specify the type of shape (circle, triangle, cylinder, cone, net, etc.).
   - Record all dimensions (lengths, angles, radii, etc.) with units precisely.
   - If there are multiple figures, describe each one separately.
   - For multiple-choice, describe each option's figure as "[Option 1] ..., [Option 2] ..." etc.
   - Example: "Find the net of a cylinder and mark it with a circle. [Option 1] top: trapezoid, sides: 2 circles, [Option 2] top: rectangle, sides: 2 circles"
   - Example: "Explain why the given shape is not a cylinder. [Diagram: cone-shaped solid]"
   - Example: "Find the area of triangle ABC. [Diagram: triangle with base 10cm, height 12cm]"

   - Example: "Calculate $(-5)+(-8)$"
   - Example: "Find the value of $\\frac{{3}}{{4}} - \\frac{{1}}{{2}}$"

5. **Exclude solution/answer sections:**
   - Labels such as "Solution", "Answer", "Work" are NOT part of the problem content.
   - Extract only the problem description; do not include solution or answer labels below the problem.

6. **Image-interaction problem detection (`is_image_interaction`):**
   - Set `is_image_interaction: true` for problems that require **marking directly on the image** (circling, coloring, drawing lines, etc.).
   - Example: "Find the net of the cylinder and circle it" → true (requires circling on image)
   - Example: "Color the correct one" → true (requires coloring on image)
   - Example: "Find the area of the triangle" → false (calculation problem, no image interaction needed)
   - Example: "Explain why it is not a cylinder" → false (descriptive problem)

Respond ONLY in the JSON format below:
"""

PROBLEM_DESCRIPTION_EXTRACT_SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "problems": types.Schema(
            type=types.Type.ARRAY,
            items=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "number": types.Schema(
                        type=types.Type.INTEGER,
                        description="Main problem number",
                    ),
                    "description": types.Schema(
                        type=types.Type.STRING,
                        description="Problem content transcription (math in LaTeX $...$)",
                    ),
                    "is_image_interaction": types.Schema(
                        type=types.Type.BOOLEAN,
                        description="Whether the problem requires marking directly on the image (circling, coloring, etc.)",
                    ),
                },
                required=["number", "description", "is_image_interaction"],
            ),
            description="List of problems found in the photo",
        ),
    },
    required=["problems"],
)


async def extract_problem_descriptions(
    image_bytes: bytes,
    mime_type: str,
    known_numbers: list[int] | None = None,
    locale: str = "ko",
) -> list[dict]:
    """Extract problem numbers and descriptions from a question page image.

    Args:
        known_numbers: Optional list of problem numbers already extracted from
            answer pages. When provided, appended as a hint to improve accuracy.
        locale: Target language locale for extracted text.

    Returns:
        List of dicts with 'number' (int) and 'description' (str).
    """
    client = _get_client()

    prompt = PROBLEM_DESCRIPTION_EXTRACT_PROMPT
    if known_numbers:
        nums_str = ", ".join(str(n) for n in sorted(known_numbers))
        prompt += (
            f"\n\nNote: Problem numbers extracted from the answer key are [{nums_str}]. "
            "Prioritize finding these numbers."
        )
    prompt = with_response_language(prompt, locale)

    parts = [
        types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
        prompt,
    ]

    config = types.GenerateContentConfig(
        temperature=PROBLEM_EXTRACT_TEMPERATURE,
        max_output_tokens=SCAN_MAX_OUTPUT_TOKENS,
        response_mime_type="application/json",
        response_schema=PROBLEM_DESCRIPTION_EXTRACT_SCHEMA,
    )

    last_error = None
    raw_text = ""
    for attempt in range(SCAN_MAX_RETRIES + 1):
        try:
            response = await asyncio.wait_for(
                client.aio.models.generate_content(
                    model=GEMINI_MODEL,
                    contents=parts,
                    config=config,
                ),
                timeout=SCAN_PER_CALL_TIMEOUT_S,
            )
            raw_text = response.text or ""
            logger.debug(
                "Problem description extraction raw (attempt %d): %s",
                attempt + 1, raw_text[:500],
            )
            result = _json_loads_latex_safe(raw_text)
            problems = result.get("problems", [])
            logger.info(
                "Problem description extraction (attempt %d): found %d problems",
                attempt + 1, len(problems),
            )
            return problems
        except asyncio.TimeoutError:
            last_error = TimeoutError(
                f"Gemini call timed out after {SCAN_PER_CALL_TIMEOUT_S}s"
            )
            logger.warning(
                "Problem description extraction timeout (attempt %d)", attempt + 1,
            )
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            last_error = e
            logger.warning(
                "Problem description extraction parse error (attempt %d): %s",
                attempt + 1, e,
            )
            salvaged = _salvage_truncated_json(raw_text, "problems")
            if salvaged:
                logger.info("Salvaged %d problem descriptions from truncated response", len(salvaged))
                return salvaged
        except Exception as e:
            last_error = e
            logger.exception(
                "Problem description extraction API error (attempt %d): %s",
                attempt + 1, e,
            )

    logger.error(
        "Problem description extraction failed after %d attempts: %s",
        SCAN_MAX_RETRIES + 1, last_error,
    )
    return []


# ---------------------------------------------------------------------------
# Diagram bounding-box detection (test-diagram endpoint only)
# ---------------------------------------------------------------------------

DIAGRAM_BOUNDS_PROMPT = """\
Detect the **diagram/figure regions** in each problem on this math workbook image.

## Rules
1. Return each diagram/figure's bounding box as **percentages (0~100)** relative to the full image size.
2. Exclude problems that have no diagrams.
3. Text-only regions are NOT diagrams. Only detect actual **shapes, graphs, and figures**.
4. Include a small margin (~5%) so the diagram is not clipped.

Respond ONLY in the JSON format below:
"""

DIAGRAM_BOUNDS_SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "diagrams": types.Schema(
            type=types.Type.ARRAY,
            items=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "number": types.Schema(
                        type=types.Type.INTEGER,
                        description="Problem number",
                    ),
                    "x_pct": types.Schema(
                        type=types.Type.NUMBER,
                        description="Left start position (0~100%)",
                    ),
                    "y_pct": types.Schema(
                        type=types.Type.NUMBER,
                        description="Top start position (0~100%)",
                    ),
                    "w_pct": types.Schema(
                        type=types.Type.NUMBER,
                        description="Width (0~100%)",
                    ),
                    "h_pct": types.Schema(
                        type=types.Type.NUMBER,
                        description="Height (0~100%)",
                    ),
                },
                required=["number", "x_pct", "y_pct", "w_pct", "h_pct"],
            ),
            description="Bounding box list for problems containing diagrams/figures",
        ),
    },
    required=["diagrams"],
)


async def detect_diagram_bounds(
    image_bytes: bytes,
    mime_type: str,
) -> dict[int, dict]:
    """Detect bounding boxes of diagram regions in a question page image.

    Returns dict mapping problem number -> {"x_pct", "y_pct", "w_pct", "h_pct"}.
    """
    client = _get_client()

    parts = [
        types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
        DIAGRAM_BOUNDS_PROMPT,
    ]

    config = types.GenerateContentConfig(
        temperature=PROBLEM_EXTRACT_TEMPERATURE,
        max_output_tokens=PROBLEM_EXTRACT_MAX_TOKENS,
        response_mime_type="application/json",
        response_schema=DIAGRAM_BOUNDS_SCHEMA,
    )

    try:
        response = await asyncio.wait_for(
            client.aio.models.generate_content(
                model=GEMINI_MODEL,
                contents=parts,
                config=config,
            ),
            timeout=SCAN_PER_CALL_TIMEOUT_S,
        )
        raw = response.text or ""
        result = json.loads(raw)
        bounds_map: dict[int, dict] = {}
        for d in result.get("diagrams", []):
            num = d.get("number")
            if num is not None:
                bounds_map[num] = {
                    "x_pct": d.get("x_pct", 0),
                    "y_pct": d.get("y_pct", 0),
                    "w_pct": d.get("w_pct", 100),
                    "h_pct": d.get("h_pct", 100),
                }
        logger.info("Detected diagram bounds for %d problems", len(bounds_map))
        return bounds_map
    except Exception as e:
        logger.warning("Diagram bounds detection failed: %s", e)
        return {}


# ---------------------------------------------------------------------------
# Phase 5: Post-scan LLM verification & refinement
# ---------------------------------------------------------------------------

VERIFY_REFINE_PROMPT = """\
You are a math education expert.
Review the problem list below and determine each problem's **math domain (concept_tag)** and **problem type (problem_type)**.

## Math domains (concept_tag)
- CALC: Numbers & Operations — integers, rationals, reals, arithmetic, factors/multiples, prime factorization, etc.
- ALG: Algebra — variables, linear/quadratic equations, inequalities, factoring, etc.
- FUNC: Functions & Change — functions, coordinates, graphs, proportional/inverse relationships, ratios, etc.
- GEO: Geometry & Measurement — shapes, area, volume, angles, congruence, symmetry, trigonometric ratios, etc.
- STAT: Probability & Statistics — statistics, probability, tables, graph interpretation, representative values, etc.

## Problem types (problem_type)
- choice: Multiple choice (select from options)
- short_answer: Short answer (write only the answer)
- descriptive: Descriptive/essay (show solution process)

## Conversion rules
1. **Choice to short_answer conversion**: If a problem is multiple choice but essentially a \
calculation/numeric problem (e.g. "$3+4=$?  (1)5 (2)6 (3)7" -> short_answer, answer "7"), \
change problem_type to "short_answer", remove the "choice:" prefix from final_answer and keep \
only the actual answer value. **Strip units** (e.g. "400 m" → "400", "3 cm" → "3"). \
Also change answer_type accordingly (integer, fraction, decimal).
2. **Descriptive detection and answer reconstruction**: If the problem asks to "show your work", \
"explain", "find and show steps", etc., set problem_type to "descriptive". \
The corrected_answer for descriptive problems MUST include **solution steps + final answer**:
   - If explanation steps exist -> use them to compose a complete answer.
   - If no explanation steps -> **write the solution process yourself** based on the problem \
description and answer. Generate a mathematically accurate, step-by-step solution that students can understand.
   - If the existing final_answer is just a simple symbol or number, it MUST be rewritten.
3. **Descriptive answer correction**: If descriptive but final_answer is garbled or inappropriate, \
write the correct answer text in corrected_answer.
4. If no conversion is needed, leave as-is.
5. **Translation**: All corrected_answer text must be in the target language specified at the end of this prompt. \
Keep math expressions unchanged — only translate natural language.
6. **Non-Korean locale choice labels**: When the target language is NOT Korean, convert Korean \
choice labels to Latin letters so users without a Korean keyboard can type them: \
  - Korean consonants → lowercase: ㄱ→a, ㄴ→b, ㄷ→c, ㄹ→d, ㅁ→e, ㅂ→f, ㅅ→g, ㅇ→h, ㅈ→i \
  - Korean syllables → uppercase: 가→A, 나→B, 다→C, 라→D, 마→E, 바→F, 사→G, 아→H, 자→I \
  - Example: "choice:ㄷ" → "choice:c", "choice:다" → "choice:C" \
  - Also convert these labels in problem_description text and solution steps.

## Input problem list
{entries_text}

Respond with the determination result for each problem in JSON.
"""

VERIFY_REFINE_SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "entries": types.Schema(
            type=types.Type.ARRAY,
            items=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "number": types.Schema(
                        type=types.Type.INTEGER,
                        description="Problem number",
                    ),
                    "concept_tag": types.Schema(
                        type=types.Type.STRING,
                        description="Math domain",
                        enum=CONCEPT_TAG_LIST,
                    ),
                    "problem_type": types.Schema(
                        type=types.Type.STRING,
                        description="Problem type",
                        enum=PROBLEM_TYPE_LIST,
                    ),
                    "corrected_answer": types.Schema(
                        type=types.Type.STRING,
                        description="Corrected answer (only when conversion needed, empty string otherwise)",
                    ),
                    "corrected_answer_type": types.Schema(
                        type=types.Type.STRING,
                        description="Corrected answer type (only when conversion needed, empty string otherwise)",
                        enum=["", "integer", "fraction", "decimal", "choice"],
                    ),
                },
                required=["number", "concept_tag", "problem_type"],
            ),
        ),
    },
    required=["entries"],
)


def _build_entries_text(entries: list[dict]) -> str:
    """Format entries for the verification prompt."""
    lines: list[str] = []
    for e in entries:
        desc = e.get("problem_description") or "(no problem description)"
        answer = e.get("final_answer", "")
        atype = e.get("answer_type", "")
        steps = e.get("solution_steps", [])
        if steps:
            steps_str = "\n    ".join(f"{i+1}. {s}" for i, s in enumerate(steps))
        else:
            steps_str = "(none)"
        lines.append(
            f"- #{e['number']}: {desc}\n"
            f"  Answer: {answer} (type: {atype})\n"
            f"  Explanation steps:\n    {steps_str}"
        )
    return "\n".join(lines)


async def verify_and_refine_entries(entries: list[dict], locale: str = "ko") -> list[dict]:
    """Post-scan LLM verification: correct concept_tag, assign problem_type,
    convert choice→short_answer when appropriate, fix garbled descriptive answers.

    Returns the entries list with updated fields.
    """
    if not entries:
        return entries

    client = _get_client()
    config = types.GenerateContentConfig(
        temperature=SCAN_VERIFY_TEMPERATURE,
        max_output_tokens=SCAN_VERIFY_MAX_OUTPUT_TOKENS,
        response_mime_type="application/json",
        response_schema=VERIFY_REFINE_SCHEMA,
    )

    # Process in chunks
    refinement_map: dict[int, dict] = {}
    for i in range(0, len(entries), SCAN_VERIFY_CHUNK_SIZE):
        chunk = entries[i:i + SCAN_VERIFY_CHUNK_SIZE]
        entries_text = _build_entries_text(chunk)
        prompt = with_response_language(
            VERIFY_REFINE_PROMPT.format(entries_text=entries_text),
            locale,
        )

        try:
            response = await asyncio.wait_for(
                client.aio.models.generate_content(
                    model=GEMINI_MODEL,
                    contents=prompt,
                    config=config,
                ),
                timeout=SCAN_PER_CALL_TIMEOUT_S,
            )
            raw_text = response.text or ""
            result = _json_loads_latex_safe(raw_text)
            for item in result.get("entries", []):
                refinement_map[item["number"]] = item
            logger.info(
                "Phase 5 verification chunk %d-%d: refined %d entries",
                i, i + len(chunk), len(result.get("entries", [])),
            )
        except Exception as e:
            logger.warning(
                "Phase 5 verification chunk %d-%d failed: %s", i, i + len(chunk), e,
            )

    # Apply refinements
    for entry in entries:
        ref = refinement_map.get(entry["number"])
        if not ref:
            continue

        entry["concept_tag"] = ref.get("concept_tag", entry["concept_tag"])
        entry["problem_type"] = ref.get("problem_type", entry.get("problem_type", "short_answer"))

        # Choice → short_answer conversion
        corrected = ref.get("corrected_answer", "")
        if corrected:
            entry["final_answer"] = corrected
            corrected_type = ref.get("corrected_answer_type", "")
            if corrected_type:
                entry["answer_type"] = corrected_type

    return entries
