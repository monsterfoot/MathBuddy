"""Grading service — calls Gemini Vision to extract and grade student answers."""

import json
import logging
import re

from services.math_expression import json_loads_latex_safe
from typing import Optional

from google import genai
from google.genai import types

from config import (
    GCP_LOCATION,
    GCP_PROJECT,
    GEMINI_MODEL,
    GRADING_MAX_OUTPUT_TOKENS,
    GRADING_MAX_RETRIES,
    GRADING_TEMPERATURE,
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


GRADING_PROMPT_TEMPLATE = """\
You are a precise math grading assistant. {photo_context}

## Answer Key
- Problem: Page {page}, Number {number}
- Correct answer: {correct_answer}
- Answer type: {answer_type}

## Grading Rules
1. Find the student's **final answer** in the work photo.
   - It is usually on the last line, underlined, or next to a label like "Answer:".
   - If there are multiple calculations, choose the last answer written.
2. Normalize the final answer:
   - Integer: "-12"
   - Fraction: reduced form "-7/6" (sign on the numerator)
   - Decimal: "0.5"
   - Multiple choice: "choice:2" (for option ②), "choice:A" (for option A), etc.
3. Compare with the correct answer.
4. If incorrect, analyze the work process and classify the error type.
5. **Analyze the work process step by step** (work_analysis):
   - Read the student's work from top to bottom and summarize each step.
   - Analyze the work process whether the answer is correct or incorrect.
   - Describe where the mistake began, or confirm the work was done correctly.
   - Use LaTeX inline format ($...$) for all math expressions.
   - Example: "Step 1: Compute $(-5)+(-8)$. Step 2: Correctly calculated absolute values $5+8=13$. Step 3: Wrote the sign as $+$ incorrectly, giving $13$. Error occurred at the sign determination step."

## Error Type Classification
- "sign_error": Sign mistake (wrote +/- incorrectly)
- "order_of_ops": Order of operations mistake
- "fraction_reduce": Fraction reduction mistake
- "arithmetic": Simple arithmetic mistake
- "concept": Lack of conceptual understanding
- "reciprocal": Reciprocal conversion mistake
- "absolute_value": Absolute value related mistake
- "retake_needed": Photo is blurry or answer is unreadable
- "none": No error (correct answer)

6. **Transcribe the problem content exactly** (problem_description):
   - Do NOT summarize. Transcribe the problem exactly as-is, word for word.
   - Record all numbers, expressions, units, and conditions precisely. Even one wrong digit changes the answer.
   - Use LaTeX inline format ($...$) for all math expressions.
   - For multiple choice, include all options (①②③④⑤) without omission.
   - For geometry problems, specify the shape type, all dimensions (length, height, radius, etc.), and what is being asked.
   - If there are multiple sub-problems, include all of them.
   - If there is no problem photo, infer the problem from the work photo as accurately as possible.
   - **Preserve visual structure**: Use markers for special layout elements:
     - Boxed/bordered content: wrap with `[보기: content]` (e.g. `[보기: 2:5  10:12  18:21]`)
     - Blank answer squares/spaces: use `□` character
     - Separate sections with `\\n` (e.g. question text, then boxed data, then answer formula)
   - Example: "Calculate $(-5)+(-8)$", "Find the value of $\\frac{3}{4} - \\frac{1}{2}$"
   - Example: "$6:7$과 비율이 같은 비를 찾아 비례식을 세워 보세요.\\n[보기: $2:5$  $10:12$  $18:21$]\\n$6:7 = □ : □$"
   - Example: "Find the surface area of a cylinder with base radius $3\\text{cm}$ and height $5\\text{cm}$."

## Descriptive (서술형) Grading
When the answer_type is "descriptive" or the correct answer contains solution steps:
1. **Final answer match**: Extract the final conclusion/answer from the student's work and compare \
with the final conclusion in the correct answer. If the final answer does not match → is_correct=false.
2. **Solution process required**: If the student only wrote the final answer without showing work → is_correct=false \
(error_tag="concept", feedback should note that work process is required).
3. **Solution process validation**: If the student showed work AND the final answer matches, \
check the work process against the correct answer's solution steps for logical errors. \
If the process is valid (even if the approach differs from the reference solution) → is_correct=true.

## Important Notes
- If the photo is blurry or the answer is not visible, set error_tag to "retake_needed".
- Use LaTeX inline format ($...$) for all math expressions in feedback.
- NEVER include the correct answer directly in the feedback.
- If is_correct is true, error_tag MUST be "none".

Respond ONLY in the JSON format below:
"""

GRADING_RESPONSE_SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "student_answer": types.Schema(
            type=types.Type.STRING,
            description="Student's final answer (normalized form). 'unreadable' if illegible.",
        ),
        "is_correct": types.Schema(
            type=types.Type.BOOLEAN,
            description="Whether the answer is correct",
        ),
        "error_tag": types.Schema(
            type=types.Type.STRING,
            description="Error type classification",
            enum=[
                "sign_error",
                "order_of_ops",
                "fraction_reduce",
                "arithmetic",
                "concept",
                "reciprocal",
                "absolute_value",
                "retake_needed",
                "none",
            ],
        ),
        "feedback": types.Schema(
            type=types.Type.STRING,
            description="Brief feedback on the student's mistake (do NOT reveal the correct answer)",
        ),
        "work_analysis": types.Schema(
            type=types.Type.STRING,
            description="Step-by-step analysis of the student's work process. Describe what was done at each step and where the mistake began.",
        ),
        "problem_description": types.Schema(
            type=types.Type.STRING,
            description="Exact transcription of the problem content (math in LaTeX $...$). Example: 'Calculate $(-5)+(-8)$'",
        ),
    },
    required=["student_answer", "is_correct", "error_tag", "feedback", "work_analysis", "problem_description"],
)

_FALLBACK_RESULT = {
    "student_answer": None,
    "is_correct": False,
    "error_tag": "retake_needed",
    "feedback": "Unable to analyze the photo. Please retake the photo so the work is clearly visible.",
    "work_analysis": "",
    "problem_description": "",
}


def _try_repair_json(raw: str) -> Optional[dict]:
    """Attempt to extract grading fields from truncated/malformed JSON."""
    try:
        sa = re.search(r'"student_answer"\s*:\s*"([^"]*)"', raw)
        ic = re.search(r'"is_correct"\s*:\s*(true|false)', raw, re.IGNORECASE)
        et = re.search(r'"error_tag"\s*:\s*"([^"]*)"', raw)
        fb = re.search(r'"feedback"\s*:\s*"((?:[^"\\]|\\.)*)', raw)

        if not (sa and ic and et):
            return None

        wa = re.search(r'"work_analysis"\s*:\s*"((?:[^"\\]|\\.)*)', raw)
        pd = re.search(r'"problem_description"\s*:\s*"((?:[^"\\]|\\.)*)', raw)

        return {
            "student_answer": sa.group(1),
            "is_correct": ic.group(1).lower() == "true",
            "error_tag": et.group(1),
            "feedback": fb.group(1) if fb else "Please check the grading result.",
            "work_analysis": wa.group(1) if wa else "",
            "problem_description": pd.group(1) if pd else "",
        }
    except Exception:
        return None


PROBLEM_EXTRACTION_PROMPT_TEMPLATE = """\
Look at this math problem photo and transcribe the problem content exactly as text.

Do NOT summarize. Transcribe the problem exactly as-is, word for word.
- Record all numbers, expressions, units, and conditions precisely.
- Use LaTeX inline format ($...$) for all math expressions.
  Example: "Calculate $(-5)+(-8)$", "Find the value of $\\frac{{3}}{{4}} - \\frac{{1}}{{2}}$"
- For multiple choice, include all options (①②③④⑤) without omission.
- For geometry problems, specify the shape type, all dimensions (length, height, radius, etc.), and what is being asked.
- If there are multiple sub-problems, include all of them.
- **Preserve visual structure**:
  - Boxed/bordered content: wrap with `[보기: content]` (e.g. `[보기: 2:5  10:12  18:21]`)
  - Blank answer squares/spaces: use `□` character
  - Separate sections with `\\n` (question, boxed data, answer formula)
- Translate the extracted problem content into {language_name}.

Respond ONLY in JSON format.
"""

PROBLEM_EXTRACTION_SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "problem_description": types.Schema(
            type=types.Type.STRING,
            description="Exact transcription of the problem content (including expressions, options, and conditions)",
        ),
    },
    required=["problem_description"],
)


async def extract_problem_description(
    image_bytes: bytes,
    mime_type: str = "image/jpeg",
    locale: str = "ko",
) -> str:
    """Extract problem text from a problem photo using Gemini Vision.

    Lightweight call — only extracts problem_description, no grading.
    Used when student submits a text answer without work photo.
    """
    client = _get_client()
    language_name = get_language_name(locale)

    extraction_prompt = PROBLEM_EXTRACTION_PROMPT_TEMPLATE.format(
        language_name=language_name,
    )

    parts = [
        types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
        extraction_prompt,
    ]

    config = types.GenerateContentConfig(
        temperature=0.1,
        max_output_tokens=GRADING_MAX_OUTPUT_TOKENS,
        response_mime_type="application/json",
        response_schema=PROBLEM_EXTRACTION_SCHEMA,
    )

    try:
        response = await client.aio.models.generate_content(
            model=GEMINI_MODEL,
            contents=parts,
            config=config,
        )
        result = json_loads_latex_safe(response.text)
        desc = result.get("problem_description", "")
        logger.info("Extracted problem_description (%d chars): %s", len(desc), desc[:100])
        return desc
    except Exception as e:
        logger.warning("Failed to extract problem_description: %s", e)
        return ""


async def grade_photo(
    image_bytes: bytes,
    mime_type: str,
    answer_key: dict,
    problem_image_bytes: Optional[bytes] = None,
    problem_mime_type: Optional[str] = None,
    problem_description_text: Optional[str] = None,
    locale: str = "ko",
) -> dict:
    """Grade a student work photo using Gemini Vision.

    Args:
        image_bytes: Raw work/solution image data.
        mime_type: MIME type of the work image.
        answer_key: Dict with final_answer, answer_type, concept_tag, page, number.
        problem_image_bytes: Optional raw image data for the original problem.
        problem_mime_type: Optional MIME type of the problem image.
        problem_description_text: Optional pre-extracted problem text (from DB).
            When provided, used as text context instead of a problem image.

    Returns:
        Dict with student_answer, is_correct, error_tag, feedback.
    """
    client = _get_client()

    # Build photo context description and parts list based on available context
    has_problem_photo = problem_image_bytes is not None
    has_problem_text = bool(problem_description_text)

    if has_problem_photo:
        photo_context = (
            "The first image is the original problem and the second image is the student's work. "
            "Refer to the original problem to extract and grade the final answer from the work photo."
        )
    elif has_problem_text:
        photo_context = (
            f"Original problem: {problem_description_text}\n\n"
            "Refer to the problem above to extract and grade the final answer from the student's work photo."
        )
    else:
        photo_context = "Extract and grade the final answer from the student's submitted work photo."

    final_answer = answer_key["final_answer"]
    answer_type = answer_key.get("answer_type", "unknown")

    # Handle descriptive problems where answer is "see solution" or similar
    _DESCRIPTIVE_MARKERS = (
        "풀이참조", "풀이 참조", "풀이과정참조",           # Korean
        "see solution", "see explanation", "see work",  # English
        "解説参照", "解き方参照",                          # Japanese
        "见解答", "参见解答",                              # Chinese
    )
    is_descriptive = final_answer.strip().lower() in (m.lower() for m in _DESCRIPTIVE_MARKERS)
    if is_descriptive:
        steps = answer_key.get("solution_steps", [])
        if steps:
            steps_text = "\n".join(f"  {i+1}. {s}" for i, s in enumerate(steps))
            final_answer = f"See solution — grade based on the explanation below:\n{steps_text}"
        photo_context += (
            "\nWARNING: This is a descriptive/proof problem (no single numeric answer). "
            "Judge whether the student's work follows the same logic as the explanation correctly. "
            "Evaluate the entire work process, not just the final numeric value."
        )

    prompt = GRADING_PROMPT_TEMPLATE.format(
        photo_context=photo_context,
        page=answer_key.get("page", "?"),
        number=answer_key.get("number", "?"),
        correct_answer=final_answer,
        answer_type="descriptive" if is_descriptive else answer_type,
    )
    prompt = with_response_language(prompt, locale)

    # Build parts: [problem_photo?, work_photo, prompt]
    parts: list = []
    if has_problem_photo:
        parts.append(types.Part.from_bytes(
            data=problem_image_bytes, mime_type=problem_mime_type or "image/jpeg",
        ))
    parts.append(types.Part.from_bytes(data=image_bytes, mime_type=mime_type))
    parts.append(prompt)

    config = types.GenerateContentConfig(
        temperature=GRADING_TEMPERATURE,
        max_output_tokens=GRADING_MAX_OUTPUT_TOKENS,
        response_mime_type="application/json",
        response_schema=GRADING_RESPONSE_SCHEMA,
    )

    last_error = None
    for attempt in range(GRADING_MAX_RETRIES + 1):
        try:
            response = await client.aio.models.generate_content(
                model=GEMINI_MODEL,
                contents=parts,
                config=config,
            )
            raw_text = response.text
            result = json_loads_latex_safe(raw_text)
            logger.info(
                "Grading result (attempt %d): answer=%s correct=%s tag=%s",
                attempt + 1,
                result.get("student_answer"),
                result.get("is_correct"),
                result.get("error_tag"),
            )
            return result
        except json.JSONDecodeError as e:
            last_error = e
            logger.warning(
                "Grading parse error (attempt %d): %s — raw(%d chars): %s",
                attempt + 1, e, len(raw_text), raw_text[:300],
            )
            # Try to repair truncated JSON
            repaired = _try_repair_json(raw_text)
            if repaired:
                logger.info("Repaired truncated JSON on attempt %d", attempt + 1)
                return repaired
        except (KeyError, TypeError) as e:
            last_error = e
            logger.warning("Grading parse error (attempt %d): %s", attempt + 1, e)
        except Exception as e:
            last_error = e
            logger.exception("Grading API error (attempt %d): %s", attempt + 1, e)

    logger.error(
        "Grading failed after %d attempts: %s",
        GRADING_MAX_RETRIES + 1,
        last_error,
    )
    return dict(_FALLBACK_RESULT)


# --- LLM Answer Equivalence Check ---

_ANSWER_EQUIV_PROMPT = """\
You are a math grading expert.
Determine whether the student's answer and the correct answer are mathematically equivalent, **considering the problem context**.
{problem_section}
## Correct Answer
{correct_answer}

## Student Answer
{student_answer}

## Equivalence Rules (judge leniently)
- If the values are mathematically the same despite different notation, "equivalent": true
  - Example: "3:4" and "3 : 4" → true
  - Example: "x=2, x=-3" and "x=-3 or x=2" → true
  - Example: "2√3" and "2root3" → true
  - Example: "1/2" and "0.5" → true
  - Example: "7" and "7.0" → true
  - Example: "-3/4" and "-0.75" → true
  - Example: "$\\frac{{3}}{{4}}$" and "3/4" → true
  - Example: "x = 5" and "5" → true (variable name inclusion does not matter)
  - Example: "3cm" and "3" → true (presence of units does not matter)
  - Example: "Answer: 7" and "7" → true
- **If the student submitted their entire work process as the answer**: Extract the final result from the work text and compare with the correct answer.
  - Example: "Since the base is 10cm and height is 12cm, area = 10×12÷2=60 (cm²)." and "60" → true (final result is 60)
  - Example: "$(-5)+(-8)=-13$, so the answer is $-13$." and "-13" → true
- **For proportion/ratio problems, answers that reduce to the same ratio are equivalent**
  - Example: For a 6:7 ratio problem, "18, 21" and "12, 14" → true (both are 6:7)
- **Ignore differences in mathematical notation**: LaTeX, text, symbols — if only notation differs, they are equivalent
  - `^2` means squared (e.g. "cm^2" = "cm²"), `^3` means cubed (e.g. "m^3" = "m³")
  - `*` means multiplication (same as × or \\times)
- **Reducible fractions** should be compared after reduction
  - Example: "2/4" and "1/2" → true
- **Descriptive/서술형 answers**: When the correct answer contains solution steps (not just a number), \
extract the **final conclusion** from both answers and compare those. \
If the final conclusions match, "equivalent": true — even if the work process text differs.
  - Example: correct="1. 외항의 곱=내항의 곱... 정답:ㄷ" and student="ㄱ.5 ㄴ.3 ㄷ.6 정답:ㄷ" → true (both conclude ㄷ)
- If the values are mathematically different, "equivalent": false
- Partial answers are false (e.g., if there should be 2 answers but only 1 is correct)

Respond ONLY in JSON:
"""

_ANSWER_EQUIV_SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "equivalent": types.Schema(
            type=types.Type.BOOLEAN,
            description="true if the student answer and correct answer are mathematically equivalent",
        ),
        "reasoning": types.Schema(
            type=types.Type.STRING,
            description="Brief reasoning for the equivalence decision (one line)",
        ),
    },
    required=["equivalent"],
)


def _normalize_math_text(text: str) -> str:
    """Normalize both LaTeX and keyboard math to readable Unicode math symbols."""
    from services.math_expression import latex_to_plain
    import re as _re
    # First: LaTeX → plain (handles \times, \div, \frac, $...$, etc.)
    t = latex_to_plain(text)
    # Then: keyboard symbols → Unicode math
    t = t.replace("*", "×")
    t = _re.sub(r"\^2(?=\s|$|[^0-9])", "²", t)
    t = _re.sub(r"\^3(?=\s|$|[^0-9])", "³", t)
    return t


async def llm_answers_match(
    student_answer: str,
    correct_answer: str,
    problem_description: str = "",
    locale: str = "ko",
) -> bool:
    """Use LLM to check if two answers are mathematically equivalent.

    Called as a fallback when the deterministic normalizer cannot handle
    the answer format (e.g., ratios, multiple roots, text-based answers).
    """
    client = _get_client()

    # Normalize both answers to readable Unicode math (same format for fair comparison)
    clean_student = _normalize_math_text(student_answer)
    clean_correct = _normalize_math_text(correct_answer)

    problem_section = (
        f"\n## Problem\n{problem_description}\n"
        if problem_description
        else ""
    )
    prompt = _ANSWER_EQUIV_PROMPT.format(
        correct_answer=clean_correct,
        student_answer=clean_student,
        problem_section=problem_section,
    )

    config = types.GenerateContentConfig(
        temperature=GRADING_TEMPERATURE,
        max_output_tokens=256,
        response_mime_type="application/json",
        response_schema=_ANSWER_EQUIV_SCHEMA,
    )

    try:
        response = await client.aio.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=config,
        )
        raw = response.text or ""
        result = json.loads(raw)
        equiv = result.get("equivalent", False)
        reasoning = result.get("reasoning", "")
        logger.info(
            "LLM answer equiv: student=%r correct=%r → %s (%s)",
            student_answer, correct_answer, equiv, reasoning,
        )
        return bool(equiv)
    except Exception as e:
        logger.warning("LLM answer equiv failed: %s — defaulting to False", e)
        return False
