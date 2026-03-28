"""Shared constants for CPM backend — single source of truth."""

from datetime import datetime, timezone

REF_DATETIME = datetime(2025, 1, 6, 8, 0, 0, tzinfo=timezone.utc)
REF_MS = 1736150400000
HOURS_PER_DAY = 8.0
NEAR_CRIT_THRESHOLD = 40.0  # 5 working days * 8 hours
