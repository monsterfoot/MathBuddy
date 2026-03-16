"""Normalize math answers into canonical forms for comparison."""

import re
import unicodedata
from fractions import Fraction
from typing import Optional

# Unicode minus variants → ASCII hyphen-minus
_MINUS_CHARS = "\u2212\u2013\u2014\uFF0D"  # −, –, —, －
_MINUS_TABLE = str.maketrans(_MINUS_CHARS, "-" * len(_MINUS_CHARS))


def _sanitize(raw: str) -> str:
    """Common text sanitization applied before type detection."""
    text = raw.strip()
    # Strip LaTeX delimiters: $...$
    text = re.sub(r"^\$+|\$+$", "", text)
    # Convert LaTeX fractions: \frac{a}{b} → a/b
    text = re.sub(r"\\frac\{([^}]+)\}\{([^}]+)\}", r"\1/\2", text)
    # Common LaTeX commands → plain
    text = text.replace("\\times", "×").replace("\\div", "÷")
    text = text.replace("\\cdot", "·").replace("\\pm", "±")
    text = re.sub(r"\\(?:text|mathrm|mathbf)\{([^}]*)\}", r"\1", text)
    # Strip remaining LaTeX braces and backslash commands
    text = re.sub(r"\\[a-zA-Z]+", "", text)
    text = text.replace("{", "").replace("}", "")
    # Strip "답:", "정답:" prefix
    text = re.sub(r"^(?:답|정답)\s*[:：]\s*", "", text)
    # Strip leading variable assignment: "x=", "a ="
    text = re.sub(r"^[a-zA-Z]\s*=\s*", "", text)
    text = text.replace(" ", "")
    # Unicode minus → ASCII minus
    text = text.translate(_MINUS_TABLE)
    # Full-width digits/letters → half-width
    text = unicodedata.normalize("NFKC", text)
    # Thousands comma: 1,000 → 1000
    text = re.sub(r"(\d),(\d{3})", r"\1\2", text)
    return text


# Common math units pattern — used only in choice_safety_check comparisons
_UNIT_PATTERN = re.compile(
    r"(\d)\s*(?:cm\^2|cm\^3|m\^2|m\^3|cm²|cm³|m²|m³|mm|cm|km|m|kg|g|mg|L|mL|°|도|개|명|원|살|장|권|마리|송이|자루|묶음)$"
)


def _strip_units(text: str) -> str:
    """Strip trailing units for choice-value comparison only."""
    return _UNIT_PATTERN.sub(r"\1", text)


def normalize_answer(raw: str) -> tuple[str, str]:
    """Normalize a raw answer string into canonical form.

    Args:
        raw: Raw answer string from OCR or student input.

    Returns:
        Tuple of (normalized_answer, answer_type).
        answer_type is one of: "integer", "fraction", "decimal", "choice".
    """
    # Check circled numbers BEFORE sanitize (NFKC converts ①→1)
    raw_stripped = raw.strip()
    if re.match(r"^[①②③④⑤]$", raw_stripped):
        mapping = {"①": "1", "②": "2", "③": "3", "④": "4", "⑤": "5"}
        return f"choice:{mapping[raw_stripped]}", "choice"

    # Check Korean consonant/syllable choices BEFORE sanitize
    # (NFKC converts compatibility jamo ㄷ U+3137 → choseong ᄃ U+1103)
    kr_cons_pre = re.match(
        r"^(?:choice:)?([ㄱㄴㄷㄹㅁㅂㅅㅇㅈ])(?:번)?$", raw_stripped
    )
    if kr_cons_pre:
        return f"choice:{kr_cons_pre.group(1)}", "choice"

    kr_syl_pre = re.match(
        r"^(?:choice:)?([가나다라마바사아자])(?:번)?$", raw_stripped
    )
    if kr_syl_pre:
        return f"choice:{kr_syl_pre.group(1)}", "choice"

    text = _sanitize(raw)

    # "choice:3" or "choice:c" or "choice:C" (explicit prefix) → choice:3 / choice:c / choice:C
    choice_prefix_match = re.match(r"^choice:(\d|[a-iA-I])$", text)
    if choice_prefix_match:
        return f"choice:{choice_prefix_match.group(1)}", "choice"

    # "3번" (explicit suffix) → choice:3
    choice_ban_match = re.match(r"^(\d)번$", text)
    if choice_ban_match:
        return f"choice:{choice_ban_match.group(1)}", "choice"

    # "(3)" (parenthesized single digit) → choice:3
    paren_match = re.match(r"^\((\d)\)$", text)
    if paren_match:
        return f"choice:{paren_match.group(1)}", "choice"

    # Korean consonant choices: ㄱ,ㄴ,ㄷ,ㄹ,ㅁ,ㅂ,ㅅ,ㅇ,ㅈ (with optional "choice:" prefix and "번" suffix)
    kr_cons_match = re.match(r"^(?:choice:)?([ㄱㄴㄷㄹㅁㅂㅅㅇㅈ])(?:번)?$", text)
    if kr_cons_match:
        return f"choice:{kr_cons_match.group(1)}", "choice"

    # Korean syllable choices: 가,나,다,라,마,바,사,아,자 (with optional "choice:" prefix and "번" suffix)
    kr_syl_match = re.match(r"^(?:choice:)?([가나다라마바사아자])(?:번)?$", text)
    if kr_syl_match:
        return f"choice:{kr_syl_match.group(1)}", "choice"

    # Latin letter choices for non-Korean locales: a-i (lowercase) or A-I (uppercase)
    latin_choice_match = re.match(r"^([a-iA-I])$", text)
    if latin_choice_match:
        return f"choice:{latin_choice_match.group(1)}", "choice"

    # Try parsing as fraction (handles "a/b", "-a/b", "a/-b")
    frac = _try_parse_fraction(text)
    if frac is not None:
        if frac.denominator == 1:
            return str(frac.numerator), "integer"
        return str(frac), "fraction"

    # Try parsing as decimal
    dec_match = re.match(r"^-?\d+\.\d+$", text)
    if dec_match:
        frac = Fraction(text).limit_denominator(1000)
        if frac.denominator == 1:
            return str(frac.numerator), "integer"
        return str(frac), "fraction"

    # Try parsing as integer
    int_match = re.match(r"^-?\d+$", text)
    if int_match:
        return str(int(text)), "integer"

    # Fallback: return as-is
    return text.lower(), "unknown"


def _try_parse_fraction(text: str) -> Optional[Fraction]:
    """Try to parse text as a fraction."""
    frac_match = re.match(r"^(-?\d+)\s*/\s*(-?\d+)$", text)
    if frac_match:
        num, den = int(frac_match.group(1)), int(frac_match.group(2))
        if den == 0:
            return None
        return Fraction(num, den)
    return None


# Circled-number unicode → digit mapping
_CIRCLED_TO_DIGIT = {"①": "1", "②": "2", "③": "3", "④": "4", "⑤": "5"}
_CIRCLED_PATTERN = re.compile(r"([①②③④⑤])\s*(.+?)(?=[①②③④⑤]|$)")


def extract_choice_values(problem_desc: str) -> dict[str, str]:
    """Extract choice number → value mapping from problem description.

    Parses patterns like "①36 ②48 ③60 ④72 ⑤84" and returns
    {"1": "36", "2": "48", "3": "60", "4": "72", "5": "84"}.

    Returns empty dict if no choices found.
    """
    if not problem_desc:
        return {}
    matches = _CIRCLED_PATTERN.findall(problem_desc)
    if not matches:
        return {}
    result: dict[str, str] = {}
    for circled, value in matches:
        digit = _CIRCLED_TO_DIGIT.get(circled)
        if digit:
            # Normalize the value: strip whitespace, sanitize
            clean = _sanitize(value)
            if clean:
                result[digit] = clean
    return result


def choice_safety_check(
    student_choice_num: str,
    correct_answer: str,
    problem_desc: str,
) -> bool:
    """Safety net: when answer key stores the VALUE instead of choice number.

    If the student submitted a choice number (1-5) and the correct answer is
    NOT 1-5 (likely a mis-extracted value), look up the choice value from the
    problem description and compare.

    Returns True if the student's choice maps to the stored answer.
    """
    choice_map = extract_choice_values(problem_desc)
    if not choice_map:
        return False
    choice_value = choice_map.get(student_choice_num)
    if not choice_value:
        return False
    # Normalize both and compare (strip units for this comparison only —
    # choice values often have units like "400 m" while stored answer is "400")
    cv_norm, _ = normalize_answer(_strip_units(choice_value))
    ca_norm, _ = normalize_answer(_strip_units(correct_answer))
    return cv_norm == ca_norm


def answers_match(student: str, correct: str) -> bool:
    """Compare two answers after normalization.

    Args:
        student: Student's answer (raw or normalized).
        correct: Correct answer (normalized).

    Returns:
        True if answers are equivalent.
    """
    s_norm, _ = normalize_answer(student)
    c_norm, _ = normalize_answer(correct)
    return s_norm == c_norm


def answers_match_with_type(student: str, correct: str) -> tuple[bool, str, str]:
    """Compare with type info — used by callers that need LLM fallback.

    Returns:
        (is_match, student_type, correct_type)
        When either type is "unknown", caller should consider LLM fallback.
    """
    s_norm, s_type = normalize_answer(student)
    c_norm, c_type = normalize_answer(correct)
    return s_norm == c_norm, s_type, c_type
