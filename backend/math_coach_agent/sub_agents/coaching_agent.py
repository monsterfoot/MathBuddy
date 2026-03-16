"""Voice coaching agent — runs via Gemini Live API for real-time audio.

This agent is used DIRECTLY with Runner (not as a sub-agent of root_agent)
for live voice coaching sessions. The problem context is injected via
session state at runtime.
"""

from google.adk.agents import LlmAgent

import config
from config import GEMINI_LIVE_MODEL
from services.locale_service import get_language_name
from services.math_expression import latex_to_speech

# NOTE: Do NOT use {curly braces} for state variables here.
# ADK state injection fails with non-string types (int, list).
# Instead, the instruction is formatted manually in ws_audio.py
# using format_coaching_instruction() before creating the session.
COACHING_INSTRUCTION_TEMPLATE = """\
You are Math Coach, a warm and patient math tutor for a student.
You speak in {language_name}.

PROBLEM CONTEXT:
- Page {page}, Problem #{number}
- THE ACTUAL PROBLEM (you MUST base your coaching on this, do NOT guess or invent a different problem):
  {problem_description}
- Student's answer: {student_answer}
- The correct answer is: {correct_answer}
  NEVER tell the student this answer! Not even indirectly!
- Solution approach: {solution_steps}
- Common mistakes to watch for: {pitfalls}

CRITICAL: When you start coaching, refer to the ACTUAL PROBLEM above.
Do NOT assume or guess what the problem is based on the page number or concept tag.
Use the exact problem description provided. If the description says it's about
surface area of a rectangular prism, coach about that — NOT about integer arithmetic.

{error_analysis_block}
{work_analysis_block}
{correct_flow_instruction}

CONVERSATION FORMAT — THIS IS CRITICAL:
This is a REAL-TIME VOICE conversation. You MUST follow a strict turn-taking pattern.

Each of YOUR turns:
1. Say ONE short sentence (a hint, encouragement, or guidance).
2. Ask ONE question to the student.
3. STOP TALKING and WAIT for the student to respond.

DO NOT continue speaking after asking a question. STOP and LISTEN.

COACHING FLOW:
- Turn 1: Greet briefly + mention the specific problem from PROBLEM CONTEXT above + ask what they tried.
  Do NOT say a generic greeting without referencing the actual problem.
- Turn 2+: Give ONE hint about the next step + ask ONE check question. Then STOP.
- If they get it right: praise + move to next step + ask again. Then STOP.
- If stuck after 2-3 hints: guide more directly (but still no answer) + ask. Then STOP.
- Final turn: When they fully understand, congratulate warmly and say goodbye.

ENDING THE SESSION:
When the coaching is complete (the student understands the concept), you MUST:
1. Congratulate the student warmly.
2. Include the exact phrase "{farewell_keyword}" in your final message.
3. This keyword signals the system to end the session properly.

STRICT RULES:
- NEVER say the final numeric answer out loud.
- NEVER say "the answer is..." in any form.
- NEVER speak more than 2-3 sentences per turn. This is voice, not a lecture.
- NEVER give multiple hints at once. ONE hint, ONE question, then STOP.
- If interrupted, stop immediately, address the student's question, then resume.
- Be encouraging and supportive throughout the session.
- Read fractions following {language_name} conventions.
"""

# Dynamic instruction blocks based on whether student got it right
_CORRECT_ENTRY_INSTRUCTION = """\
SESSION MODE: CORRECT ANSWER REVIEW
The student answered this problem CORRECTLY. This is a quick review session.
- Keep it brief (1-2 turns maximum).
- Praise them for getting it right.
- Optionally ask if they want to review the concept briefly.
- End the session quickly with the farewell keyword.
"""

_WRONG_ENTRY_INSTRUCTION = """\
SESSION MODE: ERROR COACHING (MANDATORY)
The student answered this problem INCORRECTLY. This is a full coaching session.
- Guide them step by step to understand their mistake.
- Do NOT end the session until the student demonstrates understanding.
- Minimum 3 coaching turns before you can end.
- Only say the farewell keyword when the student truly understands.
"""

_RETRY_COACHING_INSTRUCTION = """\
SESSION MODE: RE-COACHING (retry after verification failure)
This student already received coaching once but answered the verification problem incorrectly again.
- The problem in PROBLEM CONTEXT above is the one you must coach on. Do NOT mention other problems.
- Do NOT repeat the same explanation as before. Try a different approach.
- Start with "Let's take another look!" Do NOT say "Let's look at this problem."
- First, ask the student where they got confused.
- Use concrete examples or analogies to re-explain the concept.
- Coach for at least 3 turns, and only end when the student clearly understands.
"""


def format_coaching_instruction(context: dict, locale: str = "ko") -> str:
    """Format the coaching instruction with problem context values."""
    # Convert lists to readable strings for the instruction
    solution_steps = context.get("solution_steps", [])
    if isinstance(solution_steps, list):
        solution_steps = "\n    ".join(f"{i+1}. {s}" for i, s in enumerate(solution_steps))

    pitfalls = context.get("pitfalls", [])
    if isinstance(pitfalls, list):
        pitfalls = ", ".join(pitfalls)

    # Choose flow instruction based on correctness and retry status
    is_correct = context.get("is_correct", False)
    is_retry = context.get("is_retry", False)

    # For retry coaching, swap variant into main context
    variant_text = context.get("variant_text", "")
    variant_answer = context.get("variant_answer", "")
    variant_student_answer = context.get("variant_student_answer", "")

    if is_retry and variant_text:
        # Variant IS the problem — only variant info matters
        main_problem_description = variant_text
        main_student_answer = variant_student_answer or "?"
        main_correct_answer = variant_answer
        # Clear original problem's solution_steps/pitfalls — they belong
        # to a different problem and would confuse the coaching AI.
        solution_steps = ""
        pitfalls = ""
        correct_flow_instruction = _RETRY_COACHING_INSTRUCTION
    elif is_retry:
        # Retry but no variant context — use original problem
        main_problem_description = context.get("problem_description", "N/A")
        main_student_answer = context.get("student_answer", "?")
        main_correct_answer = context.get("correct_answer", "?")
        correct_flow_instruction = _RETRY_COACHING_INSTRUCTION
    else:
        main_problem_description = context.get("problem_description", "N/A")
        main_student_answer = context.get("student_answer", "?")
        main_correct_answer = context.get("correct_answer", "?")
        if is_correct:
            correct_flow_instruction = _CORRECT_ENTRY_INSTRUCTION
        else:
            correct_flow_instruction = _WRONG_ENTRY_INSTRUCTION

    # Build error analysis block only for wrong/retry entries
    if is_correct:
        error_analysis_block = ""
    else:
        error_tag = context.get("error_tag", "unknown")
        error_analysis_block = (
            f'WHAT THE STUDENT DID WRONG:\n'
            f'The grading system detected a "{error_tag}" error. '
            f'Use this to guide your coaching:\n'
            f'- sign_error: Incorrect sign handling. Start by reviewing sign rules.\n'
            f'- arithmetic: Calculation mistake. Guide the student to find where the computation went wrong.\n'
            f'- order_of_ops: Incorrect order of operations. Remind them of multiplication/division priority.\n'
            f'- fraction_reduce: Simplification mistake. Guide them to re-check the reduction process.\n'
            f'- concept: Insufficient concept understanding. Start explaining from the basic concept.\n'
            f'- reciprocal: Reciprocal conversion mistake. Check the process of converting division to multiplication by reciprocal.\n'
            f'- absolute_value: Absolute value handling mistake. Remind them of the definition of absolute value.\n'
            f'Focus your coaching on the specific error type above.\n'
        )

    # Build work analysis block (from grading Vision analysis)
    work_analysis = context.get("work_analysis", "")
    if work_analysis:
        work_analysis_block = (
            "STUDENT'S WORK PROCESS ANALYSIS (from grading):\n"
            f"{work_analysis}\n"
            "Use this analysis to coach the student specifically on where they made mistakes.\n"
            "Reference their work process directly (e.g., \"In your second step...\")."
        )
    else:
        work_analysis_block = ""

    # Convert LaTeX to spoken form for voice coaching
    main_problem_description = latex_to_speech(main_problem_description, locale)
    if isinstance(solution_steps, str) and solution_steps:
        solution_steps = latex_to_speech(solution_steps, locale)
    if isinstance(pitfalls, str) and pitfalls:
        pitfalls = latex_to_speech(pitfalls, locale)
    if work_analysis:
        work_analysis_block = latex_to_speech(work_analysis_block, locale)

    farewell_keyword = config.COACHING_FAREWELL_KEYWORDS.get(
        locale, config.COACHING_FAREWELL_KEYWORD_DEFAULT
    )
    language_name = get_language_name(locale)

    return COACHING_INSTRUCTION_TEMPLATE.format(
        page=context.get("page", "?"),
        number=context.get("number", "?"),
        problem_description=main_problem_description,
        student_answer=main_student_answer,
        correct_answer=main_correct_answer,
        solution_steps=solution_steps,
        pitfalls=pitfalls,
        error_analysis_block=error_analysis_block,
        work_analysis_block=work_analysis_block,
        correct_flow_instruction=correct_flow_instruction,
        farewell_keyword=farewell_keyword,
        language_name=language_name,
    )


def create_coaching_agent(instruction: str, locale: str = "ko") -> LlmAgent:
    """Create a new coaching agent with a pre-formatted instruction."""
    return LlmAgent(
        name="coaching_agent",
        model=GEMINI_LIVE_MODEL,
        description="Provides real-time voice coaching for incorrect math problems.",
        instruction=instruction,
        output_key="coaching_response",
    )
