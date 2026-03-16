"""Variant problem generation — creates same-type problems via Gemini."""

import json
import logging

from services.math_expression import json_loads_latex_safe
from services.diagram_service import extract_diagram_description, has_diagram_marker, generate_diagram_svg
from typing import Optional

from google import genai
from google.genai import types

from config import (
    GCP_LOCATION,
    GCP_PROJECT,
    GEMINI_PRO_MODEL,
    VARIANT_MAX_OUTPUT_TOKENS,
    VARIANT_MAX_RETRIES,
    VARIANT_TEMPERATURE,
)
from services.locale_service import get_language_name, with_response_language

logger = logging.getLogger(__name__)

_client: Optional[genai.Client] = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(
            vertexai=True,
            project=GCP_PROJECT,
            location=GCP_LOCATION,
        )
    return _client


VARIANT_PROMPT_TEMPLATE = """\
You are a math problem author for middle and high school students.
Generate 1 practice problem of the same type as the original problem.
IMPORTANT: You MUST write the problem text in **{language_name}** regardless of the original problem's language.
If the original problem is in a different language, translate the problem structure into {language_name}.

## Original Problem Info
- Original problem: Page {page}, Number {number}
{problem_description_block}
- Difficulty: {difficulty_band}

## Core Rules — MUST follow
1. The original problem content is the most important reference. Generate a problem of the exact same type as the original.
   - If the original is about surface area of 3D shapes (cylinder, cone, etc.) → generate a surface area problem for 3D shapes
   - If the original is addition of two numbers → generate an addition problem
   - If the original is an equation → generate an equation problem
2. Do NOT simplify to basic integer arithmetic. Maintain the context and type of the problem.
3. Use LaTeX inline format ($...$) for all math expressions.
   - Example: "Calculate $\\frac{{1}}{{2}} + \\frac{{3}}{{4}}$."
   - Example: "Solve the equation $2x + 3 = 7$."
   - Mix natural language text and LaTeX expressions naturally.
   - Do NOT use LaTeX in correct_answer. Use only normalized plain text.
4. Change only the numbers while keeping the problem format identical.
5. Write the problem at the appropriate grade level.
6. Provide the answer in normalized form (integer: "-12", fraction: "-7/6", decimal: "0.5").
7. For multiple choice (options ①②③④⑤), randomize the correct answer position.
   - Change the content (expressions/values) of options and randomize the answer placement.
8. If the original problem contains a [Diagram: ...] marker, include a [Diagram: ...] description in the variant with only the values changed.
   - Example: Original "[Diagram: circle with radius 5cm]" → "[Diagram: circle with radius 7cm]"
   - Keep the diagram description structure, only change values to match the new problem.

Respond ONLY in the JSON format below:
"""

VARIANT_RESPONSE_SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "display_text": types.Schema(
            type=types.Type.STRING,
            description="Problem text (natural language + LaTeX inline math $...$)",
        ),
        "correct_answer": types.Schema(
            type=types.Type.STRING,
            description="Normalized correct answer",
        ),
    },
    required=["display_text", "correct_answer"],
)

async def generate_variant(
    problem_description: str = "",
    difficulty_band: str = "medium",
    page: int = 0,
    number: int = 0,
    locale: str = "ko",
) -> dict:
    """Generate a variant problem based on the original problem description.

    Returns:
        Dict with display_text, correct_answer, difficulty_band.

    Raises:
        ValueError: If problem_description is empty (cannot generate variant without reference).
    """
    if not problem_description or not problem_description.strip():
        raise ValueError(
            f"problem_description is empty — cannot generate variant "
            f"(page={page}, number={number}). "
            f"Original problem description is required."
        )

    client = _get_client()
    language_name = get_language_name(locale)

    problem_description_block = (
        f"- Original problem content: {problem_description}\n"
        f"- WARNING: Generate a problem of the exact same type (change only the numbers)."
    )

    prompt = VARIANT_PROMPT_TEMPLATE.format(
        difficulty_band=difficulty_band,
        page=page,
        number=number,
        problem_description_block=problem_description_block,
        language_name=language_name,
    )
    prompt = with_response_language(prompt, locale)
    logger.info(
        "Variant request: page=%d number=%d problem_desc='%s'",
        page, number,
        (problem_description or "none")[:100],
    )

    config = types.GenerateContentConfig(
        temperature=VARIANT_TEMPERATURE,
        max_output_tokens=VARIANT_MAX_OUTPUT_TOKENS,
        response_mime_type="application/json",
        response_schema=VARIANT_RESPONSE_SCHEMA,
    )

    last_error = None
    for attempt in range(VARIANT_MAX_RETRIES + 1):
        try:
            response = await client.aio.models.generate_content(
                model=GEMINI_PRO_MODEL,
                contents=[prompt],
                config=config,
            )
            raw_text = response.text
            logger.info(
                "Variant raw response (attempt %d): %s",
                attempt + 1,
                repr(raw_text[:500]),
            )
            result = json_loads_latex_safe(raw_text)
            logger.info(
                "Variant generated (attempt %d, model=%s): answer=%s",
                attempt + 1,
                GEMINI_PRO_MODEL,
                result.get("correct_answer"),
            )
            display_text = result["display_text"]
            variant_result = {
                "display_text": display_text,
                "correct_answer": result["correct_answer"],
                "difficulty_band": difficulty_band,
                "diagram_svg": None,
            }

            # Generate SVG if the variant text contains a [diagram: ...] marker
            diagram_desc = extract_diagram_description(display_text)
            if diagram_desc:
                try:
                    variant_entry = {
                        "number": number,
                        "problem_description": display_text,
                        "final_answer": result.get("correct_answer", ""),
                        "answer_type": "unknown",
                    }
                    svg = await generate_diagram_svg(
                        entry=variant_entry,
                        diagram_description=diagram_desc,
                    )
                    variant_result["diagram_svg"] = svg
                except Exception as svg_err:
                    logger.warning("Variant SVG generation failed: %s", svg_err)

            return variant_result
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            last_error = e
            logger.warning("Variant parse error (attempt %d): %s", attempt + 1, e)
        except Exception as e:
            last_error = e
            logger.exception("Variant API error (attempt %d): %s", attempt + 1, e)

    logger.error(
        "Variant generation failed after %d attempts: %s",
        VARIANT_MAX_RETRIES + 1,
        last_error,
    )
    raise RuntimeError(
        f"Variant generation failed ({VARIANT_MAX_RETRIES + 1} attempts): {last_error}"
    )
