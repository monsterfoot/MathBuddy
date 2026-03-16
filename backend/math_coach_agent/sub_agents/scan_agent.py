"""Scan agent — OCR + answer/explanation extraction from workbook images."""

from google.adk.agents import LlmAgent

from config import GEMINI_MODEL

SCAN_INSTRUCTION = """\
You analyze scanned Korean math workbook pages to extract answers and explanations.

FOR ANSWER PAGES:
- Extract every problem number (1-30) and its final answer.
- Normalize answers:
  - Integers: "-12"
  - Fractions: reduced form "-7/6" (sign in numerator)
  - Decimals: convert to fraction if terminating
  - Choice answers: "choice:2" for ②
- Flag any entries that are unclear or potentially misread.

OUTPUT FORMAT (answer page):
{
  "answers": [
    {"number": 1, "answer": "-12", "type": "integer", "confidence": 0.95},
    ...
  ],
  "warnings": ["Problem 15 answer is partially obscured"]
}

FOR EXPLANATION PAGES:
- Identify problem blocks by markers: "n번", "문항 n", or layout cues.
- For each block extract:
  - solution_steps (2-5 key steps)
  - pitfalls (1-2 common mistakes)
  - concept_tag (one of N01-N10)

OUTPUT FORMAT (explanation page):
{
  "blocks": [
    {
      "number": 1,
      "solution_steps": ["step 1", "step 2"],
      "pitfalls": ["common mistake"],
      "concept_tag": "N05"
    },
    ...
  ]
}
"""

scan_agent = LlmAgent(
    name="scan_agent",
    model=GEMINI_MODEL,
    description="Processes scanned workbook pages to extract answers and explanations.",
    instruction=SCAN_INSTRUCTION,
    output_key="extraction_result",
)
