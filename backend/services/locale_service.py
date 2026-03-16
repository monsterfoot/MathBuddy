"""Locale service — extracts user locale from request headers and provides language helpers."""

from fastapi import Request

SUPPORTED_LOCALES = ("ko", "en", "fr", "es", "de", "it", "hi", "zh", "ja")
DEFAULT_LOCALE = "en"

LOCALE_NAMES = {
    "ko": "Korean",
    "en": "English",
    "fr": "French",
    "es": "Spanish",
    "de": "German",
    "it": "Italian",
    "hi": "Hindi",
    "zh": "Chinese",
    "ja": "Japanese",
}


def get_locale(request: Request) -> str:
    """Extract locale from X-Locale header, falling back to default."""
    locale = request.headers.get("X-Locale", DEFAULT_LOCALE)
    return locale if locale in SUPPORTED_LOCALES else DEFAULT_LOCALE


def get_language_name(locale: str) -> str:
    """Get the English name of a locale (e.g. 'ko' → 'Korean')."""
    return LOCALE_NAMES.get(locale, "English")


def with_response_language(prompt: str, locale: str) -> str:
    """Append a language directive to an LLM prompt.

    Instructs the model to produce all user-facing text in the given language,
    translating from the source material if needed.
    """
    lang = get_language_name(locale)
    return (
        f"{prompt}\n\n"
        f"CRITICAL LANGUAGE RULE: The source material may be in ANY language. "
        f"You MUST translate ALL user-facing text (problem descriptions, solution steps, "
        f"pitfalls, feedback, explanations) into **{lang}**. "
        f"Keep math expressions ($...$), numbers, and formulas unchanged — only translate "
        f"the natural language parts. Do NOT keep the original language."
    )
