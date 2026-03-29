"""Shared FastAPI dependencies (database connection and query helpers)."""

from __future__ import annotations

import sqlite3
from typing import Any, List

from database import DEFAULT_DB_PATH, get_connection, init_db


def get_db() -> Any:
    """Return an initialized SQLite connection."""
    conn = get_connection(DEFAULT_DB_PATH)
    init_db(conn)
    return conn


def fetch_activities(conn: Any, proj_id: str) -> List[dict]:
    """Fetch all activities for a project with WBS join."""
    cur = conn.cursor()
    cur.execute(
        """SELECT a.proj_id, a.task_id, a.task_code, a.name, a.duration_hrs, a.wbs_id, a.calendar_id,
           a.early_start, a.early_finish, a.late_start, a.late_finish, a.total_float_hrs,
           a.free_float_hrs, a.is_critical, a.is_near_critical, a.is_milestone,
           a.constraint_type, a.constraint_date,
           a.actual_start, a.actual_finish, a.remaining_duration_hrs, a.percent_complete,
           w.wbs_name, w.wbs_short_name
           FROM activities a
           LEFT JOIN wbs w ON a.proj_id = w.proj_id AND a.wbs_id = w.wbs_id
           WHERE a.proj_id = ? ORDER BY a.task_id""",
        (proj_id,),
    )
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def fetch_relationships(conn: Any, proj_id: str) -> List[dict]:
    """Fetch all relationships for a project."""
    cur = conn.cursor()
    cur.execute(
        """SELECT id, pred_id, succ_id, rel_type, lag_hrs
           FROM relationships WHERE proj_id = ?""",
        (proj_id,),
    )
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]
