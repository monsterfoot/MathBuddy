"""SM-2 spaced repetition scheduler."""

from datetime import datetime, timedelta, timezone

from config import SM2_DEFAULT_EASE, SM2_FIRST_INTERVAL, SM2_MIN_EASE, SM2_SECOND_INTERVAL


def calculate_next_review(
    quality: int,
    repetitions: int,
    ease_factor: float,
    interval: int,
) -> dict:
    """Calculate next review schedule using SM-2 algorithm.

    Args:
        quality: Review quality score (0-5).
        repetitions: Current consecutive correct count.
        ease_factor: Current ease factor.
        interval: Current interval in days.

    Returns:
        Dict with updated repetitions, ease_factor, interval, due_at.
    """
    if quality < 3:
        # Failed: reset repetitions
        new_repetitions = 0
        new_interval = SM2_FIRST_INTERVAL
    else:
        new_repetitions = repetitions + 1
        if new_repetitions == 1:
            new_interval = SM2_FIRST_INTERVAL
        elif new_repetitions == 2:
            new_interval = SM2_SECOND_INTERVAL
        else:
            new_interval = round(interval * ease_factor)

    # Update ease factor
    new_ease = ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    new_ease = max(SM2_MIN_EASE, new_ease)

    due_at = datetime.now(timezone.utc) + timedelta(days=new_interval)

    return {
        "repetitions": new_repetitions,
        "ease_factor": round(new_ease, 2),
        "interval": new_interval,
        "due_at": due_at,
        "last_reviewed_at": datetime.now(timezone.utc),
        "last_quality": quality,
    }


def initial_card_schedule() -> dict:
    """Return default schedule values for a new mistake card."""
    return {
        "ease_factor": SM2_DEFAULT_EASE,
        "interval": SM2_FIRST_INTERVAL,
        "repetitions": 0,
        "due_at": datetime.now(timezone.utc) + timedelta(days=SM2_FIRST_INTERVAL),
        "last_reviewed_at": None,
        "last_quality": 0,
    }
