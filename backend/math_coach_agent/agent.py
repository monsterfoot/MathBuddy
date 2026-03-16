"""Root agent definition — required by ADK (must export `root_agent`)."""

from google.adk.agents import LlmAgent

from config import GEMINI_MODEL
from math_coach_agent.sub_agents.coaching_agent import create_coaching_agent
from math_coach_agent.sub_agents.grading_agent import grading_agent
from math_coach_agent.sub_agents.scan_agent import scan_agent
from math_coach_agent.sub_agents.variant_agent import variant_agent

# Placeholder coaching agent for root_agent sub_agents list
# Actual coaching is done via per-session agents in ws_audio.py
coaching_agent = create_coaching_agent("Placeholder — real instruction is injected per session.")

ROOT_INSTRUCTION = """\
You are Math Coach, the coordinator agent for a math tutoring application.
Route tasks to the appropriate specialized sub-agent:

- For grading student work photos → delegate to grading_agent
- For real-time voice coaching → delegate to coaching_agent
- For generating variant problems → delegate to variant_agent
- For scanning/OCR workbook pages → delegate to scan_agent

RULES:
- NEVER reveal final answers to students.
- Always use the Answer DB as ground truth (no guessing).
- Speak Korean by default; switch to English if the user speaks English.
"""

root_agent = LlmAgent(
    name="math_coach",
    model=GEMINI_MODEL,
    description="Math Coach: coordinates grading, coaching, variant generation, and workbook scanning.",
    instruction=ROOT_INSTRUCTION,
    sub_agents=[coaching_agent, grading_agent, variant_agent, scan_agent],
)
