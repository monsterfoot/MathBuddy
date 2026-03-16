"""Tests for answer normalization and comparison."""

from services.answer_normalizer import answers_match, normalize_answer


def test_integer():
    assert normalize_answer("  -12 ") == ("-12", "integer")
    assert normalize_answer("0") == ("0", "integer")
    assert normalize_answer("42") == ("42", "integer")


def test_fraction():
    assert normalize_answer("-7/6") == ("-7/6", "fraction")
    assert normalize_answer("14/4") == ("7/2", "fraction")  # reduced
    assert normalize_answer("-6/3") == ("-2", "integer")  # simplifies to int


def test_decimal():
    assert normalize_answer("0.5") == ("1/2", "fraction")
    assert normalize_answer("-2.0") == ("-2", "integer")


def test_choice():
    assert normalize_answer("②") == ("choice:2", "choice")
    assert normalize_answer("choice:3") == ("choice:3", "choice")


def test_answers_match():
    assert answers_match("-12", "-12")
    assert answers_match("  -12  ", "-12")
    assert answers_match("14/4", "7/2")
    assert answers_match("0.5", "1/2")
    assert not answers_match("-12", "12")
    assert not answers_match("choice:1", "choice:2")


def test_sm2():
    from services.scheduler_service import calculate_next_review, initial_card_schedule

    schedule = initial_card_schedule()
    assert schedule["ease_factor"] == 2.5
    assert schedule["interval"] == 1
    assert schedule["repetitions"] == 0

    # Correct answer (quality=5)
    result = calculate_next_review(5, 0, 2.5, 1)
    assert result["repetitions"] == 1
    assert result["interval"] == 1

    # Second correct
    result = calculate_next_review(5, 1, 2.5, 1)
    assert result["repetitions"] == 2
    assert result["interval"] == 6

    # Failed (quality=1)
    result = calculate_next_review(1, 3, 2.5, 15)
    assert result["repetitions"] == 0
    assert result["interval"] == 1
