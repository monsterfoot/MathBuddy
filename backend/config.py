"""Central configuration — all constants live here (no inline hardcoding)."""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

# --- GCP ---
GCP_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "")
GCP_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")

# --- Model ---
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_PRO_MODEL = os.getenv("GEMINI_PRO_MODEL", "gemini-2.5-pro")
GEMINI_LIVE_MODEL = os.getenv("GEMINI_LIVE_MODEL", "gemini-live-2.5-flash-native-audio")

# --- Audio ---
AUDIO_INPUT_SAMPLE_RATE = 16_000   # Hz, 16-bit PCM mono
AUDIO_OUTPUT_SAMPLE_RATE = 24_000  # Hz
AUDIO_CHUNK_DURATION_MS = 100      # ms per chunk sent over WebSocket

# --- GCS ---
GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME", "")
MAX_IMAGE_SIZE_MB = 5
ALLOWED_IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})

# --- Firestore collections ---
COL_USERS = "users"
COL_WORKBOOKS = "workbooks"
COL_ANSWER_KEYS = "answer_keys"
COL_ATTEMPTS = "attempts"
COL_MISTAKE_CARDS = "mistake_cards"
COL_VARIANT_TEMPLATES = "variant_templates"
COL_COACHING_SESSIONS = "coaching_sessions"
COL_SCAN_SESSIONS = "scan_sessions"
COL_STUDY_RECORDS = "study_records"
COL_DISPUTES = "disputes"
COL_REGEN_REQUESTS = "regen_requests"
COL_WORKBOOK_ASSIGNMENTS = "workbook_assignments"
COL_TEACHER_STUDENT_LINKS = "teacher_student_links"

# --- Concept Tags (math domain categories) ---
CONCEPT_TAGS = {
    "CALC": "Numbers & Operations",
    "ALG": "Algebra (Variables / Equations)",
    "FUNC": "Functions & Change",
    "GEO": "Geometry & Measurement",
    "STAT": "Probability & Statistics",
}
CONCEPT_TAG_LIST = list(CONCEPT_TAGS.keys())
CONCEPT_TAG_DEFAULT = "unknown"

# --- Problem Types ---
PROBLEM_TYPES = {
    "choice": "Multiple Choice",
    "short_answer": "Short Answer",
    "descriptive": "Descriptive / Essay",
}
PROBLEM_TYPE_LIST = list(PROBLEM_TYPES.keys())
PROBLEM_TYPE_DEFAULT = "unknown"

# --- Study status protection ---
PROTECTED_STUDY_STATUSES = frozenset({"correct", "mastered", "disputed"})

# --- SM-2 defaults ---
SM2_DEFAULT_EASE = 2.5
SM2_MIN_EASE = 1.3
SM2_FIRST_INTERVAL = 1   # days
SM2_SECOND_INTERVAL = 6  # days

# --- Quality score mapping ---
QUALITY_CORRECT_NO_HINT = 5
QUALITY_CORRECT_ONE_HINT = 4
QUALITY_CORRECT_AFTER_EXPLAIN = 3
QUALITY_WRONG_CLOSE = 2
QUALITY_WRONG_CONFUSED = 1
QUALITY_NO_ATTEMPT = 0

# --- Grading ---
GRADING_TEMPERATURE = 0.1
GRADING_MAX_OUTPUT_TOKENS = 2048
GRADING_MAX_RETRIES = 2
ERROR_TAGS = frozenset({
    "sign_error",
    "order_of_ops",
    "fraction_reduce",
    "arithmetic",
    "concept",
    "reciprocal",
    "absolute_value",
    "retake_needed",
    "none",
})

# --- Variant generation ---
VARIANT_TEMPERATURE = 0.7
VARIANT_MAX_OUTPUT_TOKENS = 4096
VARIANT_MAX_RETRIES = 2

# --- Scan (Phase 3) ---
SCAN_VALID_PAGE_TAGS = {"answer", "explanation", "question"}
SCAN_DEFAULT_PAGE_TAGS = ["answer"]
SCAN_TEMPERATURE = 0.1
SCAN_MAX_OUTPUT_TOKENS = 16384
SCAN_MAX_RETRIES = 2
SCAN_MAX_PROBLEMS_PER_PAGE = 30
SCAN_CONFIDENCE_WARN_THRESHOLD = 0.7
SCAN_PARALLEL_CONCURRENCY = int(os.getenv("SCAN_PARALLEL_CONCURRENCY", "4"))
SCAN_PER_CALL_TIMEOUT_S = int(os.getenv("SCAN_PER_CALL_TIMEOUT_S", "60"))
SCAN_OVERALL_TIMEOUT_S = int(os.getenv("SCAN_OVERALL_TIMEOUT_S", "600"))
# Dynamic timeout params: extraction deadline = ceil(pages/concurrency) * MS_PER_BATCH_S
SCAN_MS_PER_BATCH_S = int(os.getenv("SCAN_MS_PER_BATCH_S", "60"))
# Post-extraction deadline (merge + verify + diagrams + save)
SCAN_EXTRA_TIMEOUT_S = int(os.getenv("SCAN_EXTRA_TIMEOUT_S", "100"))
SCAN_VERIFY_TEMPERATURE = 0.1
SCAN_VERIFY_MAX_OUTPUT_TOKENS = 8192
SCAN_VERIFY_CHUNK_SIZE = 15  # max entries per LLM verification call

# --- Problem image extraction ---
PROBLEM_EXTRACT_TEMPERATURE = 0.1
PROBLEM_EXTRACT_MAX_TOKENS = 2048

# --- SVG Diagram Generation ---
SVG_GENERATION_TEMPERATURE = 0.3
SVG_GENERATION_MAX_OUTPUT_TOKENS = 16384
SVG_GENERATION_MAX_RETRIES = 2
SVG_GENERATION_TIMEOUT_S = 90
SVG_MAX_SIZE_BYTES = 50_000  # 50KB limit per SVG
SVG_DIAGRAM_PATTERN = r"\[(?:그림|[Dd]iagram):\s*([^\]]+)\]"

# --- Coaching limits ---
COACHING_MAX_TURNS = 20
COACHING_INACTIVITY_TIMEOUT_S = 120
COACHING_MAX_SESSION_S = 600
COACHING_MIN_TURNS_FOR_WRONG = 3
COACHING_FAREWELL_KEYWORDS: dict[str, str] = {
    "ko": "코칭을 마칠게요",
    "en": "Let's end the coaching",
    "fr": "Terminons le coaching",
    "es": "Terminemos el coaching",
    "de": "Lass uns das Coaching beenden",
    "it": "Finiamo il coaching",
    "hi": "कोचिंग समाप्त करते हैं",
    "zh": "结束辅导吧",
    "ja": "コーチングを終わりましょう",
}
COACHING_FAREWELL_KEYWORD_DEFAULT = "코칭을 마칠게요"

# --- Input length limits (Pydantic) ---
MAX_LEN_SHORT = 200          # labels, tags, short answers
MAX_LEN_MEDIUM = 2_000       # feedback, notes, variant_text
MAX_LEN_LONG = 10_000        # problem descriptions, solution steps
MAX_LEN_SVG = 60_000         # SVG diagram strings
MAX_LEN_URL = 500            # GCS paths, URLs
MAX_LIST_ITEMS = 50          # solution_steps, pitfalls, etc.

# --- API ---
API_PREFIX = "/api"
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
# CORS_ALLOW_ALL removed for security — use CORS_ORIGINS to whitelist origins

# --- LaTeX → speech conversion rules (per-locale) ---
# Each tuple: (regex_pattern, replacement_string)
# Order matters — more specific patterns must come first.
# Shared patterns that are the same across all languages.
_LATEX_SPEECH_SHARED: list[tuple[str, str]] = [
    # Subscripts: a_{n} → "a n"
    (r"(\w)_\{([^}]+)\}", r"\1 \2"),
    (r"(\w)_(\w)", r"\1 \2"),
    # Parentheses
    (r"\\left\(", "("),
    (r"\\right\)", ")"),
    (r"\\left\[", "["),
    (r"\\right\]", "]"),
    (r"\\left\\{", "{"),
    (r"\\right\\}", "}"),
    (r"\\left\|", "|"),
    (r"\\right\|", "|"),
    (r"\\to", "→"),
    (r"\\rightarrow", "→"),
    (r"\\leftarrow", "←"),
]

_LATEX_SPEECH_KO: list[tuple[str, str]] = [
    (r"(\d+)\s*\\frac\{([^}]+)\}\{([^}]+)\}", r"\1과 \3분의 \2"),
    (r"\\frac\{([^}]+)\}\{([^}]+)\}", r"\2분의 \1"),
    (r"\\sqrt\[([^\]]+)\]\{([^}]+)\}", r"\1제곱근 \2"),
    (r"\\sqrt\{([^}]+)\}", r"루트 \1"),
    (r"(\w)\^\{2\}", r"\1의 제곱"),
    (r"(\w)\^\{3\}", r"\1의 세제곱"),
    (r"(\w)\^\{([^}]+)\}", r"\1의 \2제곱"),
    (r"(\w)\^2", r"\1의 제곱"),
    (r"(\w)\^3", r"\1의 세제곱"),
    (r"(\w)\^(\d)", r"\1의 \2제곱"),
    (r"\\times", "곱하기"),
    (r"\\div", "나누기"),
    (r"\\pm", "플러스 마이너스"),
    (r"\\mp", "마이너스 플러스"),
    (r"\\cdot", "곱하기"),
    (r"\\leq", "이하"), (r"\\geq", "이상"), (r"\\neq", "같지 않은"),
    (r"\\lt", "미만"), (r"\\gt", "초과"), (r"\\le\b", "이하"), (r"\\ge\b", "이상"),
    (r"\\pi", "파이"), (r"\\alpha", "알파"), (r"\\beta", "베타"),
    (r"\\gamma", "감마"), (r"\\theta", "세타"), (r"\\sigma", "시그마"),
    (r"\\delta", "델타"), (r"\\epsilon", "엡실론"), (r"\\omega", "오메가"),
    (r"\\log", "로그"), (r"\\ln", "자연로그"),
    (r"\\sin", "사인"), (r"\\cos", "코사인"), (r"\\tan", "탄젠트"),
    (r"\\lim", "극한"), (r"\\int", "적분"), (r"\\sum", "시그마"),
    (r"\\prod", "곱"), (r"\\infty", "무한대"),
]

_LATEX_SPEECH_EN: list[tuple[str, str]] = [
    (r"(\d+)\s*\\frac\{([^}]+)\}\{([^}]+)\}", r"\1 and \2 over \3"),
    (r"\\frac\{([^}]+)\}\{([^}]+)\}", r"\1 over \2"),
    (r"\\sqrt\[([^\]]+)\]\{([^}]+)\}", r"\1th root of \2"),
    (r"\\sqrt\{([^}]+)\}", r"square root of \1"),
    (r"(\w)\^\{2\}", r"\1 squared"),
    (r"(\w)\^\{3\}", r"\1 cubed"),
    (r"(\w)\^\{([^}]+)\}", r"\1 to the \2"),
    (r"(\w)\^2", r"\1 squared"),
    (r"(\w)\^3", r"\1 cubed"),
    (r"(\w)\^(\d)", r"\1 to the \2"),
    (r"\\times", "times"),
    (r"\\div", "divided by"),
    (r"\\pm", "plus or minus"),
    (r"\\mp", "minus or plus"),
    (r"\\cdot", "times"),
    (r"\\leq", "less than or equal to"), (r"\\geq", "greater than or equal to"),
    (r"\\neq", "not equal to"),
    (r"\\lt", "less than"), (r"\\gt", "greater than"),
    (r"\\le\b", "less than or equal to"), (r"\\ge\b", "greater than or equal to"),
    (r"\\pi", "pi"), (r"\\alpha", "alpha"), (r"\\beta", "beta"),
    (r"\\gamma", "gamma"), (r"\\theta", "theta"), (r"\\sigma", "sigma"),
    (r"\\delta", "delta"), (r"\\epsilon", "epsilon"), (r"\\omega", "omega"),
    (r"\\log", "log"), (r"\\ln", "natural log"),
    (r"\\sin", "sine"), (r"\\cos", "cosine"), (r"\\tan", "tangent"),
    (r"\\lim", "limit"), (r"\\int", "integral"), (r"\\sum", "sum"),
    (r"\\prod", "product"), (r"\\infty", "infinity"),
]

_LATEX_SPEECH_JA: list[tuple[str, str]] = [
    (r"(\d+)\s*\\frac\{([^}]+)\}\{([^}]+)\}", r"\1と\3分の\2"),
    (r"\\frac\{([^}]+)\}\{([^}]+)\}", r"\2分の\1"),
    (r"\\sqrt\[([^\]]+)\]\{([^}]+)\}", r"\1乗根\2"),
    (r"\\sqrt\{([^}]+)\}", r"ルート\1"),
    (r"(\w)\^\{2\}", r"\1の二乗"),
    (r"(\w)\^\{3\}", r"\1の三乗"),
    (r"(\w)\^\{([^}]+)\}", r"\1の\2乗"),
    (r"(\w)\^2", r"\1の二乗"),
    (r"(\w)\^3", r"\1の三乗"),
    (r"(\w)\^(\d)", r"\1の\2乗"),
    (r"\\times", "かける"),
    (r"\\div", "割る"),
    (r"\\pm", "プラスマイナス"),
    (r"\\mp", "マイナスプラス"),
    (r"\\cdot", "かける"),
    (r"\\leq", "以下"), (r"\\geq", "以上"), (r"\\neq", "等しくない"),
    (r"\\lt", "未満"), (r"\\gt", "超過"), (r"\\le\b", "以下"), (r"\\ge\b", "以上"),
    (r"\\pi", "パイ"), (r"\\alpha", "アルファ"), (r"\\beta", "ベータ"),
    (r"\\gamma", "ガンマ"), (r"\\theta", "シータ"), (r"\\sigma", "シグマ"),
    (r"\\delta", "デルタ"), (r"\\epsilon", "イプシロン"), (r"\\omega", "オメガ"),
    (r"\\log", "ログ"), (r"\\ln", "自然対数"),
    (r"\\sin", "サイン"), (r"\\cos", "コサイン"), (r"\\tan", "タンジェント"),
    (r"\\lim", "極限"), (r"\\int", "積分"), (r"\\sum", "シグマ"),
    (r"\\prod", "積"), (r"\\infty", "無限大"),
]

LATEX_SPEECH_PATTERNS: dict[str, list[tuple[str, str]]] = {
    "ko": _LATEX_SPEECH_KO + _LATEX_SPEECH_SHARED,
    "en": _LATEX_SPEECH_EN + _LATEX_SPEECH_SHARED,
    "ja": _LATEX_SPEECH_JA + _LATEX_SPEECH_SHARED,
    # Other languages fall back to English patterns
}


def get_latex_speech_patterns(locale: str) -> list[tuple[str, str]]:
    """Get LaTeX speech conversion patterns for a locale, falling back to English."""
    return LATEX_SPEECH_PATTERNS.get(locale, LATEX_SPEECH_PATTERNS["en"])
