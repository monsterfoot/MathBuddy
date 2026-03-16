"""Diagram SVG generation — Gemini generates educational SVG from text descriptions."""

import asyncio
import logging
import re
import xml.etree.ElementTree as ET
from typing import Optional

from google import genai
from google.genai import types

from config import (
    GCP_LOCATION,
    GCP_PROJECT,
    GEMINI_MODEL,
    SCAN_PER_CALL_TIMEOUT_S,
    SVG_DIAGRAM_PATTERN,
    SVG_GENERATION_MAX_OUTPUT_TOKENS,
    SVG_GENERATION_MAX_RETRIES,
    SVG_GENERATION_TEMPERATURE,
    SVG_GENERATION_TIMEOUT_S,
    SVG_MAX_SIZE_BYTES,
)

logger = logging.getLogger(__name__)

_client: Optional[genai.Client] = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(
            vertexai=True, project=GCP_PROJECT, location=GCP_LOCATION,
        )
    return _client


# ---------------------------------------------------------------------------
#  Pattern detection helpers
# ---------------------------------------------------------------------------

def has_diagram_marker(text: str) -> bool:
    """Check if text contains a diagram marker pattern ([Diagram: ...] or [그림: ...])."""
    return bool(re.search(SVG_DIAGRAM_PATTERN, text))


def extract_diagram_description(text: str) -> str | None:
    """Extract the diagram description from a diagram marker."""
    match = re.search(SVG_DIAGRAM_PATTERN, text)
    return match.group(1).strip() if match else None




# ---------------------------------------------------------------------------
#  Image-interaction → text-choice conversion (LLM)
# ---------------------------------------------------------------------------

_CONVERT_TO_TEXT_CHOICE_PROMPT = """\
This math problem requires marking on a diagram image (circling, shading, etc.).
Convert it to a **text-only multiple choice problem** that can be solved without any image.

## Original Problem
{problem_text}

## Original Answer
{original_answer}

## Conversion Rules
1. Describe each answer choice's shape/diagram in detail using text.
2. Convert instructions like "circle it" or "shade it" to "choose the number" or "select".
3. Number choices using ①②③④ format.
4. Use LaTeX inline math ($...$) for mathematical expressions.
5. Remove [Diagram: ...] markers — the converted problem should not require any diagram image.
6. Ensure the original answer content remains correct after conversion by numbering choices accordingly.

## Output Format (respond ONLY with this JSON format)
{{"converted_text": "converted problem text", "correct_answer": "answer for converted problem (e.g., ②)"}}
"""


async def convert_to_text_choice(
    problem_text: str,
    original_answer: str = "",
    source_image_bytes: bytes | None = None,
    source_image_mime: str | None = None,
    locale: str = "ko",
) -> dict | None:
    """Convert an image-interaction problem to text-based multiple choice.

    Uses LLM to rewrite the problem so it can be answered without
    marking on a diagram.

    Returns dict with 'converted_text' and 'correct_answer', or None on failure.
    """
    import json

    from services.locale_service import with_response_language

    client = _get_client()
    raw_prompt = _CONVERT_TO_TEXT_CHOICE_PROMPT.format(
        problem_text=problem_text,
        original_answer=original_answer or "(unknown)",
    )
    prompt = with_response_language(raw_prompt, locale)

    contents: list = []
    if source_image_bytes and source_image_mime:
        contents.append(
            types.Part.from_bytes(data=source_image_bytes, mime_type=source_image_mime),
        )
    contents.append(prompt)

    config = types.GenerateContentConfig(
        temperature=SVG_GENERATION_TEMPERATURE,
        max_output_tokens=SVG_GENERATION_MAX_OUTPUT_TOKENS,
    )

    try:
        response = await asyncio.wait_for(
            client.aio.models.generate_content(
                model=GEMINI_MODEL,
                contents=contents,
                config=config,
            ),
            timeout=SCAN_PER_CALL_TIMEOUT_S,
        )
        result = (response.text or "").strip()
        if not result:
            logger.warning("Empty response from text-choice conversion")
            return None

        # Parse JSON response
        # Strip markdown code fences if present
        cleaned = result
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
            cleaned = re.sub(r"\s*```$", "", cleaned)
        parsed = json.loads(cleaned)
        converted_text = parsed.get("converted_text", "").strip()
        correct_answer = parsed.get("correct_answer", "").strip()

        if converted_text:
            logger.info("Converted to text choice (%d chars), answer=%s", len(converted_text), correct_answer)
            return {"converted_text": converted_text, "correct_answer": correct_answer}

        logger.warning("Empty converted_text in response")
        return None
    except json.JSONDecodeError:
        # Fallback: treat entire result as text (backward compat)
        if result:
            logger.warning("JSON parse failed, using raw text as converted_text")
            return {"converted_text": result, "correct_answer": ""}
        return None
    except Exception as e:
        logger.warning("Text-choice conversion failed: %s", e)
        return None


# ---------------------------------------------------------------------------
#  SVG generation prompt
# ---------------------------------------------------------------------------

SVG_GENERATION_PROMPT = """\
Generate an educational SVG diagram for a {language_name} math problem.

## Problem Context
- Problem #{number}
- Question: {problem_text}
- Diagram description: {diagram_description}
{choices_section}{solution_section}
{image_reference_section}
## CRITICAL RULES
- **NEVER reveal, hint at, or highlight the correct answer.** This diagram is for the QUESTION, not the solution.
- Do NOT mark any option as correct/incorrect. Do NOT use circles, checkmarks, or colors to distinguish answers.
- **Do NOT include multiple choice options (①②③④⑤) in the SVG.** The choices are already displayed as text outside the diagram.
- **DO include visual elements** like bordered boxes, tables, number lines, equations inside frames, geometric shapes, etc. These are the core purpose of the diagram.
- Example: if the problem has a boxed equation "㉠ : 7 = 12 : ㉡" and choices ①36 ②48 ③60, the SVG should show ONLY the boxed equation, NOT the choices.
- Your ENTIRE response must be a single SVG element.
- Start with <svg and end with </svg>. Nothing else before or after.
- NO markdown, NO ```, NO explanation text.

## SVG Rules
1. Use viewBox (e.g. viewBox="0 0 400 300"). No fixed width/height attributes.
2. Labels in {language_name} with font-family="sans-serif", font-size 12-14px.
3. Show exact dimensions/values from the problem.
4. Colors:
   - Shape strokes: stroke="#333333" stroke-width="2"
   - Shape fills: fill="#E8F4FD" (light blue) or fill="none". NEVER use dark fills.
   - Label text: fill="#1A1A1A"
5. Dimension lines: dashed lines (stroke-dasharray) with arrow markers.
6. Vertices: small circles (r=3 fill="#333") with labels (ㄱ, ㄴ, ㄷ, A, B, C, etc.).
7. NO <script>, <style>, <foreignObject>, or on* event attributes.
8. Keep SVG under 50KB — essential shapes only.

## Shape Guide
- Circle: <circle> with center dot, dashed radius line
- Triangle: <polygon> with vertex labels, base/height dimension lines
- Rectangle: <rect> or <polygon> with side length labels
- Cylinder/Cone: ellipses + lines for 3D effect
- Net (unfolded shape): flat unfolded shapes, fill="none"
- Angles: <path> arcs with degree labels

Output ONLY the SVG element:
"""

_IMAGE_REFERENCE_NOTE = (
    "## Reference Image\n"
    "An original problem page image is attached. "
    "Closely replicate the diagram's shape, proportions, labels, and layout from this image. "
    "Use the image as the primary reference for structure; use the text description only to fill in details the image doesn't cover.\n"
)


# ---------------------------------------------------------------------------
#  SVG sanitization (security)
# ---------------------------------------------------------------------------

_FORBIDDEN_ELEMENTS = frozenset({
    "script", "style", "foreignObject", "iframe", "object", "embed",
    "applet", "form", "input", "button",
})

_FORBIDDEN_ATTR_PREFIXES = ("on",)  # onclick, onload, etc.


def _extract_and_sanitize_svg(raw: str) -> str | None:
    """Extract <svg>...</svg> from raw LLM output and sanitize it."""
    # Strip markdown code fences that Gemini sometimes wraps around SVG
    cleaned = re.sub(r"```(?:xml|svg|html)?\s*\n?", "", raw)
    cleaned = cleaned.replace("```", "")

    svg_match = re.search(r"<svg[\s\S]*</svg>", cleaned, re.IGNORECASE)
    if not svg_match:
        return None

    svg_str = svg_match.group(0)

    try:
        root = ET.fromstring(svg_str)
        _sanitize_element(root)

        # Ensure viewBox is present
        if "viewBox" not in root.attrib:
            root.set("viewBox", "0 0 300 200")

        # Remove fixed width/height for responsiveness
        root.attrib.pop("width", None)
        root.attrib.pop("height", None)

        ET.register_namespace("", "http://www.w3.org/2000/svg")
        svg_output = ET.tostring(root, encoding="unicode")

        # Ensure xmlns is present — DOMParser("image/svg+xml") requires it
        if "xmlns" not in svg_output:
            svg_output = svg_output.replace(
                "<svg", '<svg xmlns="http://www.w3.org/2000/svg"', 1,
            )

        return svg_output
    except ET.ParseError as e:
        logger.warning("SVG parse error: %s — svg_str[:200]=%s", e, svg_str[:200])
        return None


def _sanitize_element(elem: ET.Element) -> None:
    """Recursively sanitize an SVG element tree."""
    tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag

    if tag in _FORBIDDEN_ELEMENTS:
        elem.clear()
        return

    to_remove = []
    for attr in elem.attrib:
        attr_name = attr.split("}")[-1] if "}" in attr else attr
        if any(attr_name.lower().startswith(p) for p in _FORBIDDEN_ATTR_PREFIXES):
            to_remove.append(attr)
        if attr_name.lower() in ("href", "xlink:href"):
            val = elem.attrib[attr]
            if val.startswith("javascript:") or val.startswith("data:"):
                to_remove.append(attr)
    for attr in to_remove:
        del elem.attrib[attr]

    for child in list(elem):
        child_tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
        if child_tag in _FORBIDDEN_ELEMENTS:
            elem.remove(child)
        else:
            _sanitize_element(child)


# ---------------------------------------------------------------------------
#  Build prompt with full answer key context
# ---------------------------------------------------------------------------

def _build_prompt(
    entry: dict,
    diagram_description: str,
    *,
    has_source_image: bool = False,
    locale: str = "ko",
) -> str:
    """Build generation prompt from full answer key entry."""
    from services.locale_service import get_language_name

    # Choices section
    choices = entry.get("choices")
    if choices and isinstance(choices, list) and len(choices) > 0:
        choices_text = "\n".join(
            f"  {i+1}. {c}" for i, c in enumerate(choices)
        )
        choices_section = f"- Choices:\n{choices_text}\n"
    else:
        choices_section = ""

    # Solution steps section
    steps = entry.get("solution_steps")
    if steps and isinstance(steps, list) and len(steps) > 0:
        steps_text = "\n".join(f"  {i+1}. {s}" for i, s in enumerate(steps))
        solution_section = f"- Solution steps:\n{steps_text}\n"
    else:
        solution_section = ""

    image_reference_section = _IMAGE_REFERENCE_NOTE if has_source_image else ""

    return SVG_GENERATION_PROMPT.format(
        number=entry.get("number", 0),
        problem_text=entry.get("problem_description", "") or "",
        diagram_description=diagram_description,
        choices_section=choices_section,
        solution_section=solution_section,
        image_reference_section=image_reference_section,
        language_name=get_language_name(locale),
    )


# ---------------------------------------------------------------------------
#  Single diagram generation
# ---------------------------------------------------------------------------

async def generate_diagram_svg(
    entry: dict,
    diagram_description: str,
    source_image_bytes: bytes | None = None,
    source_image_mime: str | None = None,
    locale: str = "ko",
) -> str | None:
    """Generate SVG diagram from answer key entry.

    Args:
        entry: Full answer key dict (problem_description, final_answer,
               choices, solution_steps, etc.)
        diagram_description: Extracted text from diagram marker.
        source_image_bytes: Original question page image for visual reference.
        source_image_mime: MIME type of the source image.

    Returns SVG string on success, None on failure (graceful degradation).
    """
    client = _get_client()
    number = entry.get("number", 0)

    has_image = bool(source_image_bytes and source_image_mime)
    prompt = _build_prompt(entry, diagram_description, has_source_image=has_image, locale=locale)

    # Build content parts: image first (if available), then text prompt
    contents: list = []
    if has_image:
        contents.append(
            types.Part.from_bytes(data=source_image_bytes, mime_type=source_image_mime),
        )
    contents.append(prompt)

    config = types.GenerateContentConfig(
        temperature=SVG_GENERATION_TEMPERATURE,
        max_output_tokens=SVG_GENERATION_MAX_OUTPUT_TOKENS,
    )

    for attempt in range(SVG_GENERATION_MAX_RETRIES + 1):
        try:
            response = await asyncio.wait_for(
                client.aio.models.generate_content(
                    model=GEMINI_MODEL,
                    contents=contents,
                    config=config,
                ),
                timeout=SVG_GENERATION_TIMEOUT_S,
            )
            # Gemini may return None text on blocked/empty responses
            try:
                raw = response.text or ""
            except (ValueError, AttributeError):
                raw = ""
                logger.warning(
                    "Empty/blocked response (attempt %d) for problem %d. "
                    "Candidates: %s",
                    attempt + 1, number,
                    getattr(response, "candidates", "N/A"),
                )
            svg = _extract_and_sanitize_svg(raw)
            if svg:
                if len(svg.encode("utf-8")) > SVG_MAX_SIZE_BYTES:
                    logger.warning(
                        "SVG too large (%d bytes) for problem %d, skipping",
                        len(svg.encode("utf-8")), number,
                    )
                    return None
                ref_tag = "with-image" if has_image else "text-only"
                logger.info(
                    "SVG generated [%s] (attempt %d): %d bytes for problem %d",
                    ref_tag, attempt + 1, len(svg.encode("utf-8")), number,
                )
                return svg
            logger.warning(
                "SVG extraction failed (attempt %d, len=%d). Raw response:\n%s",
                attempt + 1, len(raw), raw[:500],
            )
        except asyncio.TimeoutError:
            logger.warning("SVG generation timeout (attempt %d)", attempt + 1)
        except Exception as e:
            logger.warning("SVG generation error (attempt %d): %s", attempt + 1, e)

    logger.error(
        "SVG generation failed after %d attempts for problem %d",
        SVG_GENERATION_MAX_RETRIES + 1, number,
    )
    return None


# ---------------------------------------------------------------------------
#  Batch generation for scan pipeline
# ---------------------------------------------------------------------------

async def generate_diagrams_for_entries(
    entries: list[dict],
    question_page_images: dict[str, tuple[bytes, str]] | None = None,
    locale: str = "ko",
) -> dict[int, str]:
    """Generate SVG diagrams for all entries that have diagram markers.

    Args:
        entries: List of answer key entry dicts.
        question_page_images: Optional mapping of GCS URL -> (image_bytes, mime_type)
            for original question page images. Used as visual reference for SVG generation.
        locale: Target language locale for SVG labels.

    Returns dict mapping problem number -> SVG string.
    """
    img_cache = question_page_images or {}
    tasks: dict[int, asyncio.Task] = {}
    for entry in entries:
        desc = entry.get("problem_description", "") or ""
        diagram_desc = extract_diagram_description(desc)
        if diagram_desc:
            # Look up original question page image
            src_url = entry.get("source_question_page_url")
            img_bytes, img_mime = img_cache.get(src_url, (None, None)) if src_url else (None, None)
            tasks[entry["number"]] = generate_diagram_svg(
                entry=entry,
                diagram_description=diagram_desc,
                source_image_bytes=img_bytes,
                source_image_mime=img_mime,
                locale=locale,
            )

    if not tasks:
        return {}

    results = await asyncio.gather(*tasks.values(), return_exceptions=True)
    diagram_map: dict[int, str] = {}
    for num, result in zip(tasks.keys(), results):
        if isinstance(result, str):
            diagram_map[num] = result
        else:
            logger.warning("Diagram generation failed for problem %d: %s", num, result)

    logger.info("Generated %d/%d diagrams", len(diagram_map), len(tasks))
    return diagram_map
