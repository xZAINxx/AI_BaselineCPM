"""Calendar engine tests."""

from datetime import date, time
from calendar_engine import (
    WorkCalendar,
    get_default_calendar,
    hours_to_calendar_date,
    parse_p6_calendar_data,
    _p6_day_to_python,
)


def test_p6_day_to_python():
    assert _p6_day_to_python(0) == 6  # P6 Sunday -> Python Sunday
    assert _p6_day_to_python(1) == 0  # P6 Monday -> Python Monday
    assert _p6_day_to_python(6) == 5  # P6 Saturday -> Python Saturday


def test_default_calendar():
    cal = get_default_calendar()
    assert cal.hours_per_day == 8.0
    assert cal.is_work_day(date(2025, 1, 6))   # Monday
    assert not cal.is_work_day(date(2025, 1, 5))  # Sunday
    assert not cal.is_work_day(date(2025, 1, 4))  # Saturday
    assert cal.work_hours_on_day(date(2025, 1, 6)) == 8.0
    assert cal.work_hours_on_day(date(2025, 1, 5)) == 0.0


def test_parse_p6_calendar_basic():
    raw = "(0||0())(1||1(08:00|12:00)(13:00|17:00))(2||1(08:00|12:00)(13:00|17:00))(3||1(08:00|12:00)(13:00|17:00))(4||1(08:00|12:00)(13:00|17:00))(5||1(08:00|12:00)(13:00|17:00))(6||0())"
    periods = parse_p6_calendar_data(raw)
    assert 0 in periods  # Monday
    assert 4 in periods  # Friday
    assert 5 not in periods  # Saturday
    assert 6 not in periods  # Sunday
    assert len(periods[0]) == 2


def test_parse_empty_returns_empty():
    assert parse_p6_calendar_data("") == {}
    assert parse_p6_calendar_data(None) == {}


def test_hours_to_calendar_date_simple():
    cal = get_default_calendar()
    ref = date(2025, 1, 6)  # Monday
    assert hours_to_calendar_date(8, cal, ref) == date(2025, 1, 6)
    assert hours_to_calendar_date(16, cal, ref) == date(2025, 1, 7)
    assert hours_to_calendar_date(40, cal, ref) == date(2025, 1, 10)


def test_hours_to_calendar_date_skips_weekend():
    cal = get_default_calendar()
    ref = date(2025, 1, 6)  # Monday
    result = hours_to_calendar_date(48, cal, ref)
    assert result == date(2025, 1, 13)  # Next Monday


def test_hours_to_calendar_date_zero():
    cal = get_default_calendar()
    ref = date(2025, 1, 6)
    assert hours_to_calendar_date(0, cal, ref) == ref
