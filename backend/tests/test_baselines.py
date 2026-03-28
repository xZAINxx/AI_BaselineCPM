"""Baseline storage and comparison tests."""

import sqlite3

from database import init_db


def _setup_test_db() -> sqlite3.Connection:
    """Create an in-memory SQLite DB with schema and test data."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    init_db(conn)
    conn.execute(
        "INSERT INTO projects (proj_id, name) VALUES (?, ?)",
        ("P1", "Test Project"),
    )
    conn.executemany(
        """INSERT INTO activities
           (task_id, proj_id, name, duration_hrs, early_start, early_finish,
            late_start, late_finish, total_float_hrs, is_critical)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            ("A", "P1", "Task A", 8.0, 0.0, 8.0, 0.0, 8.0, 0.0, 1),
            ("B", "P1", "Task B", 4.0, 8.0, 12.0, 12.0, 16.0, 4.0, 0),
            ("C", "P1", "Task C", 8.0, 8.0, 16.0, 8.0, 16.0, 0.0, 1),
        ],
    )
    conn.commit()
    return conn


def _save_baseline(conn: sqlite3.Connection, proj_id: str, name: str = None) -> int:
    """Helper: save current schedule as a baseline and return baseline_id."""
    cur = conn.cursor()
    cur.execute(
        "SELECT COALESCE(MAX(baseline_number), 0) + 1 FROM baselines WHERE proj_id = ?",
        (proj_id,),
    )
    next_num = cur.fetchone()[0]
    cur.execute(
        "INSERT INTO baselines (proj_id, baseline_number, name) VALUES (?, ?, ?)",
        (proj_id, next_num, name),
    )
    baseline_id = cur.lastrowid
    cur.execute(
        """INSERT INTO baseline_activities
           (baseline_id, task_id, duration_hrs, early_start, early_finish,
            late_start, late_finish, total_float_hrs, is_critical)
           SELECT ?, task_id, duration_hrs, early_start, early_finish,
                  late_start, late_finish, total_float_hrs, is_critical
           FROM activities WHERE proj_id = ?""",
        (baseline_id, proj_id),
    )
    conn.commit()
    return baseline_id


def test_baseline_save_copies_activity_values() -> None:
    """Saving a baseline should copy all activity CPM values."""
    conn = _setup_test_db()
    baseline_id = _save_baseline(conn, "P1", "BL1")

    cur = conn.cursor()
    cur.execute(
        "SELECT task_id, duration_hrs, early_start, early_finish FROM baseline_activities WHERE baseline_id = ? ORDER BY task_id",
        (baseline_id,),
    )
    rows = cur.fetchall()
    assert len(rows) == 3
    assert rows[0]["task_id"] == "A"
    assert rows[0]["duration_hrs"] == 8.0
    assert rows[0]["early_start"] == 0.0
    assert rows[0]["early_finish"] == 8.0
    conn.close()


def test_baseline_comparison_shows_variance() -> None:
    """After modifying an activity, comparison should show the variance."""
    conn = _setup_test_db()
    baseline_id = _save_baseline(conn, "P1", "BL1")

    conn.execute(
        "UPDATE activities SET duration_hrs = 12.0, early_finish = 12.0 WHERE proj_id = ? AND task_id = ?",
        ("P1", "A"),
    )
    conn.commit()

    cur = conn.cursor()
    cur.execute(
        """SELECT ba.task_id,
                  ba.early_finish AS bl_ef, a.early_finish AS cur_ef
           FROM baseline_activities ba
           LEFT JOIN activities a ON a.proj_id = ? AND a.task_id = ba.task_id
           WHERE ba.baseline_id = ? AND ba.task_id = ?""",
        ("P1", baseline_id, "A"),
    )
    row = cur.fetchone()
    assert row is not None
    bl_ef = row["bl_ef"]
    cur_ef = row["cur_ef"]
    finish_variance = cur_ef - bl_ef
    assert abs(finish_variance - 4.0) < 1e-6
    conn.close()


def test_multiple_baselines_increment_number() -> None:
    """Multiple baselines should auto-increment baseline_number."""
    conn = _setup_test_db()
    _save_baseline(conn, "P1", "BL1")
    _save_baseline(conn, "P1", "BL2")

    cur = conn.cursor()
    cur.execute(
        "SELECT baseline_number FROM baselines WHERE proj_id = ? ORDER BY baseline_number",
        ("P1",),
    )
    rows = cur.fetchall()
    assert len(rows) == 2
    assert rows[0]["baseline_number"] == 1
    assert rows[1]["baseline_number"] == 2
    conn.close()
