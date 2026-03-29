"""
P6 work calendar parser and work-day computation.

P6 clndr_data format (varies by version):
  (day_num||work_flag(start1|end1)(start2|end2)...)
  day_num: 0=Sunday through 6=Saturday
  work_flag: 0=non-work, 1=work
  start/end: HH:MM format

Example: (0||0())(1||1(08:00|12:00)(13:00|17:00))... means Sunday=off, Monday=8h work
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, time, timedelta
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class WorkCalendar:
    """Parsed P6 work calendar."""
    calendar_id: str
    name: str
    work_periods: Dict[int, List[Tuple[time, time]]] = field(default_factory=dict)
    exceptions: Dict[date, bool] = field(default_factory=dict)
    hours_per_day: float = 8.0

    def is_work_day(self, d: date) -> bool:
        if d in self.exceptions:
            return self.exceptions[d]
        wd = d.weekday()
        return wd in self.work_periods and len(self.work_periods[wd]) > 0

    def work_hours_on_day(self, d: date) -> float:
        if not self.is_work_day(d):
            return 0.0
        periods = self.work_periods.get(d.weekday(), [])
        total = 0.0
        for s, e in periods:
            mins = (e.hour * 60 + e.minute) - (s.hour * 60 + s.minute)
            total += max(0, mins) / 60.0
        return total

    def compute_hours_per_day(self) -> float:
        """Average work hours across work days."""
        day_hours = []
        for wd, periods in self.work_periods.items():
            hrs = sum((e.hour * 60 + e.minute - s.hour * 60 - s.minute) / 60 for s, e in periods)
            if hrs > 0:
                day_hours.append(hrs)
        return sum(day_hours) / len(day_hours) if day_hours else 8.0


def _p6_day_to_python(p6_day: int) -> int:
    """Convert P6 day (0=Sunday) to Python weekday (0=Monday)."""
    return (p6_day - 1) % 7


def parse_p6_calendar_data(raw: Optional[str]) -> Dict[int, List[Tuple[time, time]]]:
    """
    Parse P6 clndr_data string into work periods per Python weekday.

    Handles the common P6 format: (day||flag(HH:MM|HH:MM)(HH:MM|HH:MM)...)
    Returns empty dict if parsing fails (caller should fall back to default).
    """
    if not raw or not raw.strip():
        return {}

    work_periods: Dict[int, List[Tuple[time, time]]] = {}

    day_pattern = re.compile(
        r'\((\d)\|\|(\d)'
        r'((?:\([^)]*\))*)'
        r'\)'
    )
    time_pattern = re.compile(r'\((\d{1,2}:\d{2})\|(\d{1,2}:\d{2})\)')

    for match in day_pattern.finditer(raw):
        p6_day = int(match.group(1))
        work_flag = int(match.group(2))
        time_block = match.group(3)

        py_day = _p6_day_to_python(p6_day)

        if work_flag == 0 or not time_block:
            continue

        periods: List[Tuple[time, time]] = []
        for tmatch in time_pattern.finditer(time_block):
            try:
                start_parts = tmatch.group(1).split(':')
                end_parts = tmatch.group(2).split(':')
                start = time(int(start_parts[0]), int(start_parts[1]))
                end = time(int(end_parts[0]), int(end_parts[1]))
                if end > start:
                    periods.append((start, end))
            except (ValueError, IndexError):
                continue

        if periods:
            work_periods[py_day] = periods

    return work_periods


def get_default_calendar() -> WorkCalendar:
    """Standard 5-day, 8h/day calendar (Mon-Fri, 8:00-12:00 + 13:00-17:00)."""
    periods: Dict[int, List[Tuple[time, time]]] = {}
    for weekday in range(5):
        periods[weekday] = [(time(8, 0), time(12, 0)), (time(13, 0), time(17, 0))]
    cal = WorkCalendar(
        calendar_id="DEFAULT",
        name="Standard 5-Day",
        work_periods=periods,
    )
    cal.hours_per_day = cal.compute_hours_per_day()
    return cal


def load_calendars(conn: Any, proj_id: str) -> Dict[str, WorkCalendar]:
    """Load and parse all calendars for a project from SQLite."""
    cur = conn.cursor()
    cur.execute(
        "SELECT calendar_id, name, data FROM calendars WHERE proj_id = ?",
        (proj_id,),
    )
    calendars: Dict[str, WorkCalendar] = {}
    for row in cur.fetchall():
        cal_id = str(row[0] if isinstance(row, (list, tuple)) else row["calendar_id"])
        name = str(row[1] if isinstance(row, (list, tuple)) else row["name"] or "")
        raw_data = str(row[2] if isinstance(row, (list, tuple)) else row["data"] or "")

        try:
            periods = parse_p6_calendar_data(raw_data)
            if not periods:
                cal = get_default_calendar()
                cal.calendar_id = cal_id
                cal.name = name
            else:
                cal = WorkCalendar(
                    calendar_id=cal_id,
                    name=name,
                    work_periods=periods,
                )
                cal.hours_per_day = cal.compute_hours_per_day()
            calendars[cal_id] = cal
        except Exception:
            cal = get_default_calendar()
            cal.calendar_id = cal_id
            cal.name = name
            calendars[cal_id] = cal

    return calendars


def hours_to_calendar_date(
    hours: float,
    calendar: WorkCalendar,
    ref_date: date,
) -> date:
    """
    Convert CPM hours to a calendar date accounting for non-work days.

    Walks forward from ref_date, subtracting available work hours each day
    until the hour budget is consumed.
    """
    if hours <= 0:
        return ref_date

    remaining = hours
    current = ref_date
    max_iterations = int(hours / 2) + 365 * 3

    for _ in range(max_iterations):
        day_hrs = calendar.work_hours_on_day(current)
        if day_hrs > 0:
            if remaining <= day_hrs:
                return current
            remaining -= day_hrs
        current += timedelta(days=1)

    return current


def calendar_date_to_str(d: date) -> str:
    """Format date as DD-MMM-YY uppercase (P6 style)."""
    return d.strftime("%d-%b-%y").upper()
