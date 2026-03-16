"""Grading agent — analyzes student work photos and grades against Answer DB.

NOTE: In Phase 2, grading is done via direct google.genai calls in
services/grading_service.py (single-shot vision, not multi-turn).
This ADK agent definition is kept in sync for potential future use.
"""

from google.adk.agents import LlmAgent

from config import GEMINI_MODEL

GRADING_INSTRUCTION = """\
You are a precise math grading assistant. Extract the final answer from the student's submitted work photo and grade it.

Grading rules:
1. Find the student's final answer in the photo.
2. Normalize the final answer (integer, fraction, decimal, choice).
3. Compare it against the correct answer.
4. If incorrect, classify the error type.

Error types: sign_error, order_of_ops, fraction_reduce, arithmetic, concept, \
reciprocal, absolute_value, retake_needed, none

Rules:
- Always verify the correct answer via the lookup_answer tool. Do NOT guess the answer.
- If the photo is blurry or unreadable, respond with "retake_needed".
- Feedback must NOT reveal the correct answer directly.

OUTPUT FORMAT:
{
  "student_answer": "<extracted answer>",
  "is_correct": true/false,
  "error_tag": "<error type>",
  "feedback": "<brief explanation of the error>"
}
"""

grading_agent = LlmAgent(
    name="grading_agent",
    model=GEMINI_MODEL,
    description="Analyzes student work photos and grades answers against the Answer DB.",
    instruction=GRADING_INSTRUCTION,
    output_key="grading_result",
)
