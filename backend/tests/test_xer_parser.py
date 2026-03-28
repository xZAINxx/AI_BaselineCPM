"""Synthetic XER fixtures for parser smoke tests."""

import sqlite3
import tempfile
from pathlib import Path

from database import init_db
from xer_parser import import_xer_to_sqlite, parse_constraint_date, parse_xer_text, row_to_dict


MINIMAL_XER = """%T\tPROJECT
%F\tproj_id\tproj_short_name
%R\t100\tDemoProj
%T\tTASK
%F\ttask_id\tproj_id\ttask_name\ttarget_drtn_hr_cnt\twbs_id\tclndr_id\ttask_type
%R\t1\t100\tA\t8.0\t\t\t
%R\t2\t100\tB\t8.0\t\t\t
%R\t3\t100\tC\t0.0\t\t\tTT_Mile
%T\tTASKPRED
%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt\tproj_id
%R\t1\t2\t1\tPR_FS\t0.0\t100
%R\t2\t3\t2\tPR_FS\t0.0\t100
"""


def test_parse_xer_text_tables() -> None:
    tables = parse_xer_text(MINIMAL_XER)
    assert "PROJECT" in tables
    assert "TASK" in tables
    assert "TASKPRED" in tables
    fields, rows = tables["TASK"]
    assert "task_id" in fields
    assert len(rows) == 3


def test_import_xer_to_sqlite() -> None:
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        path = Path(tmp.name)
    try:
        conn = sqlite3.connect(str(path))
        conn.row_factory = sqlite3.Row
        init_db(conn)
        summary = import_xer_to_sqlite(conn, MINIMAL_XER.encode("utf-8"), "t.xer")
        assert summary["proj_id"] == "100"
        assert summary["activities_count"] == 3
        assert summary["relationships_count"] == 2
        assert summary["wbs_count"] == 0
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM activities WHERE proj_id = ?", ("100",))
        assert cur.fetchone()[0] == 3
        cur.execute("SELECT COUNT(*) FROM relationships WHERE proj_id = ?", ("100",))
        assert cur.fetchone()[0] == 2
    finally:
        conn.close()
        path.unlink(missing_ok=True)


def test_row_to_dict() -> None:
    d = row_to_dict(["a", "b"], ["1", "2"])
    assert d == {"a": "1", "b": "2"}


def test_parse_constraint_date_float() -> None:
    assert parse_constraint_date("100.0") == 100.0


def test_parse_constraint_date_iso() -> None:
    result = parse_constraint_date("2025-03-15T08:00:00")
    assert result is not None
    expected = (68 * 24)  # 68 days from Jan 6 to Mar 15
    assert abs(result - expected) < 1.0


def test_parse_constraint_date_iso_short() -> None:
    result = parse_constraint_date("2025-01-06 08:00")
    assert result is not None
    assert abs(result) < 1e-2


def test_parse_constraint_date_date_only() -> None:
    result = parse_constraint_date("2025-01-06")
    assert result is not None
    assert abs(result - (-8.0)) < 1e-2  # midnight vs 08:00 = -8h


def test_parse_constraint_date_p6_short() -> None:
    result = parse_constraint_date("06-Jan-25")
    assert result is not None


def test_parse_constraint_date_empty() -> None:
    assert parse_constraint_date("") is None
    assert parse_constraint_date(None) is None
