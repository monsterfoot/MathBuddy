"""Math expression utilities — LaTeX to speech conversion and KaTeX formatting.

Handles conversion between LaTeX math notation and locale-aware natural language
for voice coaching (Gemini Live API), plus helper functions for detecting
LaTeX content and repairing JSON-mangled LaTeX.
"""

import json
import logging
import re
from typing import Optional

from google import genai
from google.genai import types

from config import (
    GCP_LOCATION,
    GCP_PROJECT,
    GEMINI_MODEL,
    get_latex_speech_patterns,
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


MATH_CONVERT_PROMPT = """\
You are a math text conversion assistant.
Find math expressions in the user's plain text input and convert them to KaTeX inline math ($...$).

Rules:
1. Only wrap math formulas/symbols with $...$. Leave regular text as-is.
2. Fractions: "2/3" → $\\frac{2}{3}$
3. Exponents: "x^2" → $x^2$, "x^3" → $x^3$
4. Roots: "√2" → $\\sqrt{2}$
5. Multiplication: "×" → $\\times$
6. Division: "÷" → $\\div$
7. Inequalities: "≤" → $\\leq$, "≥" → $\\geq$, "≠" → $\\neq$
8. Pi: "π" → $\\pi$
9. Do not modify parts already wrapped in $...$.
10. If multiple expressions appear in one sentence, wrap each separately with $...$.

Examples:
- Input: "Solve x^2 + 3x - 5 = 0"
  Output: "Solve $x^2 + 3x - 5 = 0$"

- Input: "a × b ÷ c"
  Output: "$a \\times b \\div c$"

Return ONLY the converted text. No explanation.
"""


async def convert_math_text(text: str, locale: str = "ko") -> str:
    """Convert plain math text to KaTeX-wrapped text using Gemini."""
    client = _get_client()
    prompt = with_response_language(MATH_CONVERT_PROMPT, locale)
    response = await client.aio.models.generate_content(
        model=GEMINI_MODEL,
        contents=[f"Input: {text}"],
        config=types.GenerateContentConfig(
            system_instruction=prompt,
            temperature=0.1,
            max_output_tokens=1024,
        ),
    )
    result = response.text.strip()
    # Remove "Output: " prefix if Gemini adds it
    for prefix in ("Output:", "output:"):
        if result.startswith(prefix):
            result = result[len(prefix):].strip()
            break
    return result

# ── JSON ↔ LaTeX repair ──────────────────────────────────────────────
# When Gemini outputs LaTeX (e.g. \frac) inside a JSON string without
# double-escaping, json.loads interprets \f as form-feed (U+000C), etc.
# We detect these control chars and restore the original backslash.
_LATEX_CONTROL_CHARS = re.compile(
    r"[\x07\x08\x09\x0a\x0c\x0d]"  # \a \b \t \n \f \r as control chars
)
_CONTROL_TO_BACKSLASH = {
    "\x07": "\\a",   # bell       → \alpha, \angle, ...
    "\x08": "\\b",   # backspace  → \bar, \beta, \binom, ...
    "\x09": "\\t",   # tab        → \theta, \tan, \text, \times, \to, ...
    "\x0a": "\\n",   # newline    → \neq, \not, \nu, \nabla, ...
    "\x0c": "\\f",   # form feed  → \frac, \forall, \flat, ...
    "\x0d": "\\r",   # carriage   → \rho, \right, \rightarrow, ...
}


def _repair_latex_escapes(text: str) -> str:
    """Restore LaTeX backslash commands mangled by JSON parsing."""
    return _LATEX_CONTROL_CHARS.sub(
        lambda m: _CONTROL_TO_BACKSLASH.get(m.group(), m.group()), text
    )


def _walk_and_repair(obj: object) -> None:
    """Recursively repair strings in a parsed JSON structure."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, str):
                obj[k] = _repair_latex_escapes(v)
            elif isinstance(v, (dict, list)):
                _walk_and_repair(v)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            if isinstance(v, str):
                obj[i] = _repair_latex_escapes(v)
            elif isinstance(v, (dict, list)):
                _walk_and_repair(v)


def json_loads_latex_safe(raw: str) -> dict:
    """Parse JSON, then repair any LaTeX backslash damage in string values.

    Gemini structured output sometimes returns broken JSON when LaTeX
    backslash commands are involved. This function tries multiple
    repair strategies before giving up.
    """
    # Strategy 1: direct parse
    try:
        result = json.loads(raw)
        _walk_and_repair(result)
        return result
    except json.JSONDecodeError:
        pass

    # Strategy 2: replace real newlines inside JSON string values with \\n
    # Gemini often puts actual newlines inside "display_text" which breaks JSON.
    # Replace newlines that appear inside quoted strings.
    newline_fixed = _fix_newlines_in_json_strings(raw)
    try:
        result = json.loads(newline_fixed)
        _walk_and_repair(result)
        return result
    except json.JSONDecodeError:
        pass

    # Strategy 3: escape lone backslashes that aren't valid JSON escapes
    fixed = re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', newline_fixed)
    try:
        result = json.loads(fixed)
        _walk_and_repair(result)
        return result
    except json.JSONDecodeError:
        pass

    # Strategy 4: strip control characters and retry
    cleaned = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', newline_fixed)
    try:
        result = json.loads(cleaned)
        _walk_and_repair(result)
        return result
    except json.JSONDecodeError:
        pass

    # Strategy 5: both fixes combined
    cleaned_fixed = re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', cleaned)
    try:
        result = json.loads(cleaned_fixed)
        _walk_and_repair(result)
        return result
    except json.JSONDecodeError:
        pass

    # Strategy 6: try with strict=False (allows control chars in strings)
    try:
        decoder = json.JSONDecoder(strict=False)
        result = decoder.decode(newline_fixed)
        if isinstance(result, dict):
            _walk_and_repair(result)
            return result
    except (json.JSONDecodeError, ValueError):
        pass

    # All strategies failed — raise with original error
    return json.loads(raw)  # will raise JSONDecodeError


def _fix_newlines_in_json_strings(raw: str) -> str:
    """Replace actual newlines inside JSON string values with escaped \\n.

    Gemini structured output sometimes inserts real newlines inside JSON
    string values (e.g., multi-line display_text). This walks through
    the raw string character by character, detecting when we're inside
    a JSON string, and replacing real newlines with \\n.
    """
    result = []
    in_string = False
    i = 0
    while i < len(raw):
        ch = raw[i]
        if ch == '"' and (i == 0 or raw[i - 1] != '\\'):
            in_string = not in_string
            result.append(ch)
        elif ch == '\n' and in_string:
            result.append('\\n')
        elif ch == '\r' and in_string:
            result.append('\\r')
        else:
            result.append(ch)
        i += 1
    return ''.join(result)


def latex_to_plain(text: str) -> str:
    """Convert LaTeX-wrapped text to plain editable text (pure regex, no LLM).

    Strips $...$ delimiters and converts common LaTeX commands to Unicode/plain
    equivalents suitable for human editing.

    Examples:
        "$\\frac{2}{3}$ calculate" → "2/3 calculate"
        "$x^{2} + 3$" → "x² + 3"
    """
    # Remove display math delimiters ($$...$$), then inline ($...$)
    text = re.sub(r"\$\$(.+?)\$\$", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"\$(.+?)\$", r"\1", text)

    # Mixed numbers: 3\frac{1}{5} → 3 1/5
    text = re.sub(r"(\d+)\s*\\frac\{([^}]+)\}\{([^}]+)\}", r"\1 \2/\3", text)
    # Fractions: \frac{a}{b} → a/b
    text = re.sub(r"\\frac\{([^}]+)\}\{([^}]+)\}", r"\1/\2", text)
    # Square root: \sqrt{x} → √x
    text = re.sub(r"\\sqrt\{([^}]+)\}", r"√\1", text)
    # Nth root: \sqrt[n]{x} → ⁿ√x
    text = re.sub(r"\\sqrt\[([^\]]+)\]\{([^}]+)\}", r"\1√\2", text)
    # Exponents with braces: x^{2} → x²  x^{3} → x³
    text = re.sub(r"\^{2}", "²", text)
    text = re.sub(r"\^{3}", "³", text)
    text = re.sub(r"\^{([^}]+)}", r"^\1", text)
    text = re.sub(r"\^2", "²", text)
    text = re.sub(r"\^3", "³", text)
    # Subscripts: a_{n} → a_n
    text = re.sub(r"_\{([^}]+)\}", r"_\1", text)
    # Operators
    text = text.replace("\\times", "×")
    text = text.replace("\\div", "÷")
    text = text.replace("\\cdot", "·")
    text = text.replace("\\pm", "±")
    text = text.replace("\\mp", "∓")
    # Comparison
    text = text.replace("\\leq", "≤")
    text = text.replace("\\geq", "≥")
    text = text.replace("\\neq", "≠")
    text = text.replace("\\le", "≤")
    text = text.replace("\\ge", "≥")
    text = text.replace("\\lt", "<")
    text = text.replace("\\gt", ">")
    # Greek
    text = text.replace("\\pi", "π")
    text = text.replace("\\alpha", "α")
    text = text.replace("\\beta", "β")
    text = text.replace("\\gamma", "γ")
    text = text.replace("\\theta", "θ")
    text = text.replace("\\sigma", "σ")
    text = text.replace("\\delta", "δ")
    text = text.replace("\\epsilon", "ε")
    text = text.replace("\\omega", "ω")
    # Functions (keep name, just remove backslash)
    for fn in ("log", "ln", "sin", "cos", "tan", "lim"):
        text = text.replace(f"\\{fn}", fn)
    # Special
    text = text.replace("\\infty", "∞")
    text = text.replace("\\int", "∫")
    text = text.replace("\\sum", "Σ")
    text = text.replace("\\prod", "Π")
    text = text.replace("\\to", "→")
    text = text.replace("\\rightarrow", "→")
    text = text.replace("\\leftarrow", "←")
    # Parentheses
    text = re.sub(r"\\left\s*([(\[{|])", r"\1", text)
    text = re.sub(r"\\right\s*([)\]}|])", r"\1", text)
    # \text{...} → contents
    text = re.sub(r"\\text\{([^}]*)\}", r"\1", text)
    # Remove remaining LaTeX spacing commands
    text = re.sub(r"\\(?:,|;|quad|qquad|!)\s*", " ", text)
    # Remove remaining backslash commands
    text = re.sub(r"\\[a-zA-Z]+", "", text)
    # Clean up braces and extra whitespace
    text = text.replace("{", "").replace("}", "")
    text = re.sub(r"\s+", " ", text).strip()

    return text


def contains_latex(text: str) -> bool:
    """Check whether text contains LaTeX math delimiters ($...$ or $$...$$)."""
    return bool(re.search(r"\$\$?.+?\$\$?", text, re.DOTALL))


def latex_to_speech(text: str, locale: str = "ko") -> str:
    """Convert LaTeX math expressions to locale-aware natural language for voice.

    Processes a mixed text (text + LaTeX) and replaces all math expressions
    with speakable equivalents in the given locale.

    Examples (locale="ko"):
        "$\\frac{1}{2}$" → "2bun-ui 1"
    Examples (locale="en"):
        "$\\frac{1}{2}$" → "1 over 2"
    """
    # Remove display math delimiters first ($$...$$), then inline ($...$)
    text = re.sub(r"\$\$(.+?)\$\$", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"\$(.+?)\$", r"\1", text)

    # Apply regex-based conversion patterns (order matters)
    patterns = get_latex_speech_patterns(locale)
    for pattern, replacement in patterns:
        text = re.sub(pattern, replacement, text)

    # Clean up remaining LaTeX commands (e.g. \, \; \quad \text{})
    text = re.sub(r"\\text\{([^}]*)\}", r"\1", text)
    text = re.sub(r"\\(?:,|;|quad|qquad|!)\s*", " ", text)
    text = re.sub(r"\\[a-zA-Z]+", "", text)

    # Clean up braces and extra whitespace
    text = text.replace("{", "").replace("}", "")
    text = re.sub(r"\s+", " ", text).strip()

    return text
