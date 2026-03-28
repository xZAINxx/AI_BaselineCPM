"""Shared FastAPI dependencies (database connection)."""

from __future__ import annotations

import sqlite3
from typing import Any

from database import DEFAULT_DB_PATH, get_connection, init_db


def get_db() -> Any:
    """Return an initialized SQLite connection."""
    conn = get_connection(DEFAULT_DB_PATH)
    init_db(conn)
    return conn
