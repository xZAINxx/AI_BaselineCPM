"""
SQLite persistence for the P6 XER analyzer.

Provides a single ``schedule.db`` file under ``backend/``, WAL mode for large imports,
schema creation, and bulk insert helpers for activities and relationships.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Iterable, List, Optional, Sequence, Tuple

DEFAULT_DB_PATH = Path(__file__).resolve().parent / "schedule.db"


def get_connection(db_path: Optional[Path] = None) -> sqlite3.Connection:
    """Open a SQLite connection with WAL and foreign keys enabled."""
    path = db_path or DEFAULT_DB_PATH
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    """
    Create tables and indexes if they do not exist (WAL already set in
    :func:`get_connection`). For a clean migration from older schemas, delete
    ``backend/schedule.db`` and re-import XER files.
    """
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS projects (
            proj_id TEXT PRIMARY KEY,
            name TEXT,
            imported_at TEXT DEFAULT (datetime('now')),
            raw_meta TEXT
        );

        CREATE TABLE IF NOT EXISTS activities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            proj_id TEXT NOT NULL,
            name TEXT,
            duration_hrs REAL DEFAULT 0,
            early_start REAL,
            early_finish REAL,
            late_start REAL,
            late_finish REAL,
            total_float_hrs REAL,
            free_float_hrs REAL,
            is_critical INTEGER DEFAULT 0,
            is_near_critical INTEGER DEFAULT 0,
            calendar_id TEXT,
            wbs_id TEXT,
            is_milestone INTEGER DEFAULT 0,
            constraint_type TEXT,
            constraint_date REAL,
            actual_start REAL,
            actual_finish REAL,
            remaining_duration_hrs REAL,
            percent_complete REAL DEFAULT 0,
            FOREIGN KEY (proj_id) REFERENCES projects(proj_id) ON DELETE CASCADE,
            UNIQUE (proj_id, task_id)
        );

        CREATE TABLE IF NOT EXISTS relationships (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            proj_id TEXT NOT NULL,
            pred_id TEXT NOT NULL,
            succ_id TEXT NOT NULL,
            rel_type TEXT DEFAULT 'FS',
            lag_hrs REAL DEFAULT 0,
            FOREIGN KEY (proj_id) REFERENCES projects(proj_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS calendars (
            calendar_id TEXT PRIMARY KEY,
            proj_id TEXT,
            name TEXT,
            data TEXT
        );

        CREATE TABLE IF NOT EXISTS wbs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wbs_id TEXT NOT NULL,
            proj_id TEXT NOT NULL,
            parent_wbs_id TEXT,
            wbs_short_name TEXT,
            wbs_name TEXT,
            seq_num INTEGER DEFAULT 0,
            FOREIGN KEY (proj_id) REFERENCES projects(proj_id) ON DELETE CASCADE,
            UNIQUE (proj_id, wbs_id)
        );
        CREATE INDEX IF NOT EXISTS idx_wbs_proj ON wbs(proj_id);
        CREATE INDEX IF NOT EXISTS idx_wbs_id ON wbs(wbs_id);

        CREATE INDEX IF NOT EXISTS idx_activities_proj ON activities(proj_id);
        CREATE INDEX IF NOT EXISTS idx_activities_task ON activities(task_id);
        CREATE INDEX IF NOT EXISTS idx_rel_pred ON relationships(pred_id);
        CREATE INDEX IF NOT EXISTS idx_rel_succ ON relationships(succ_id);
        CREATE INDEX IF NOT EXISTS idx_rel_proj ON relationships(proj_id);

        CREATE TABLE IF NOT EXISTS baselines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            proj_id TEXT NOT NULL,
            baseline_number INTEGER NOT NULL DEFAULT 1,
            name TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (proj_id) REFERENCES projects(proj_id) ON DELETE CASCADE,
            UNIQUE (proj_id, baseline_number)
        );

        CREATE TABLE IF NOT EXISTS baseline_activities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            baseline_id INTEGER NOT NULL,
            task_id TEXT NOT NULL,
            duration_hrs REAL,
            early_start REAL,
            early_finish REAL,
            late_start REAL,
            late_finish REAL,
            total_float_hrs REAL,
            is_critical INTEGER DEFAULT 0,
            FOREIGN KEY (baseline_id) REFERENCES baselines(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_baselines_proj ON baselines(proj_id);
        CREATE INDEX IF NOT EXISTS idx_baseline_activities_bl ON baseline_activities(baseline_id);
        """
    )
    migration_cols = [
        "free_float_hrs REAL",
        "constraint_type TEXT",
        "constraint_date REAL",
        "actual_start REAL",
        "actual_finish REAL",
        "remaining_duration_hrs REAL",
        "percent_complete REAL DEFAULT 0",
        "is_near_critical INTEGER DEFAULT 0",
    ]
    for col in migration_cols:
        try:
            conn.execute(f"ALTER TABLE activities ADD COLUMN {col}")
        except sqlite3.OperationalError:
            pass
    conn.commit()


def init_schema(conn: sqlite3.Connection) -> None:
    """Alias for :func:`init_db` (create tables if missing)."""
    init_db(conn)


def bulk_insert_activities(
    conn: sqlite3.Connection,
    rows: Sequence[Tuple[Any, ...]],
) -> None:
    """
    Insert many activity rows in one transaction via ``executemany``.

    Row tuple order:
    (task_id, proj_id, name, duration_hrs, calendar_id, wbs_id, is_milestone,
     constraint_type, constraint_date)
    """
    conn.executemany(
        """
        INSERT INTO activities (
            task_id, proj_id, name, duration_hrs, calendar_id, wbs_id, is_milestone,
            constraint_type, constraint_date,
            early_start, early_finish, late_start, late_finish, total_float_hrs,
            free_float_hrs, is_critical
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, 0)
        """,
        rows,
    )


def bulk_insert_relationships(
    conn: sqlite3.Connection,
    rows: Sequence[Tuple[Any, ...]],
) -> None:
    """
    Insert relationship rows: (proj_id, pred_id, succ_id, rel_type, lag_hrs).
    """
    conn.executemany(
        """
        INSERT INTO relationships (proj_id, pred_id, succ_id, rel_type, lag_hrs)
        VALUES (?, ?, ?, ?, ?)
        """,
        rows,
    )


def json_dumps(obj: dict) -> str:
    """Serialize ``obj`` to a JSON string for ``raw_meta``."""
    return json.dumps(obj, ensure_ascii=False)
