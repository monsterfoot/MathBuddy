"""Variant problem generation agent."""

from google.adk.agents import LlmAgent

from config import GEMINI_MODEL

VARIANT_INSTRUCTION = """\
You generate variant math problems that test the same concept with different numbers.

STEPS:
1. Receive the concept_tag and difficulty_band.
2. Look up the variant template for this concept.
3. Generate random parameters within allowed ranges, respecting constraints.
4. Compute the correct answer deterministically.
5. Return the problem display text and verified answer.

RULES:
- The variant MUST be solvable with a single correct answer.
- Difficulty must match the requested band.
- Numbers should be different from the original problem.

OUTPUT FORMAT:
{
  "display_text": "<problem text with numbers filled in>",
  "correct_answer": "<normalized answer>",
  "template_id": "<template used>",
  "params": {"a": ..., "b": ...}
}
"""

variant_agent = LlmAgent(
    name="variant_agent",
    model=GEMINI_MODEL,
    description="Generates same-type practice problems with different numbers.",
    instruction=VARIANT_INSTRUCTION,
    output_key="variant_problem",
)
