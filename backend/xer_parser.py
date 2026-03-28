"""
Primavera P6 XER parser: line-oriented %T / %F / %R sections.

Reads upload bytes using :class:`io.TextIOWrapper` and **readline** iteration so the
full file is not decoded into a single Python string (large-file friendly).
"""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, List, Optional, Tuple

from database import bulk_insert_activities, bulk_insert_relationships, init_db, json_dumps


def iter_decoded_lines(data: bytes) -> Iterator[str]:
    """
    Yield text lines from *data* using UTF-8 (with BOM) first, then cp1252.

    Uses incremental decoding via :class:`io.TextIOWrapper` iteration, not
    ``bytes.decode()`` of the entire blob followed by ``splitlines``.
    """
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            buf = io.BytesIO(data)
            text = io.TextIOWrapper(buf, encoding=encoding, newline="", errors="strict")
            for line in text:
                yield line
            return
        except UnicodeDecodeError:
            continue
    buf = io.BytesIO(data)
    text = io.TextIOWrapper(buf, encoding="latin-1", newline="", errors="replace")
    yield from text


def split_tab_row(line: str) -> List[str]:
    """Split a tab-delimited row; respect quoted fields (tabs inside quotes)."""
    line = line.rstrip("\r\n")
    if not line:
        return []
    try:
        return next(csv.reader(io.StringIO(line), delimiter="\t", quotechar='"'))
    except StopIteration:
        return []

def parse_xer_stream(lines: Iterator[str]) -> Dict[str, Tuple[List[str], List[List[str]]]]:
    """
    Parse XER lines into ``{ table_name: (field_names, rows) }``.
    Stops on ``%E`` (end). Skips unknown directives.
    """
    tables: Dict[str, Tuple[List[str], List[List[str]]]] = {}
    current: Optional[str] = None

    for raw_line in lines:
        if not raw_line.strip():
            continue
        if raw_line.startswith("%E"):
            break
        if raw_line.startswith("%T"):
            current = raw_line[2:].strip()
            if current not in tables:
                tables[current] = ([], [])
            continue
        if raw_line.startswith("%F"):
            if current is None:
                continue
            rest = raw_line[2:].lstrip()
            fields = split_tab_row(rest)
            tables[current] = (fields, tables[current][1])
            continue
        if raw_line.startswith("%R"):
            if current is None:
                continue
            rest = raw_line[2:].lstrip()
            row = split_tab_row(rest)
            fns, rows = tables[current]
            rows.append(row)
            tables[current] = (fns, rows)
            continue
    return tables


def parse_xer_text(text: str) -> Dict[str, Tuple[List[str], List[List[str]]]]:
    """Parse from an in-memory string (tests only)."""
    return parse_xer_stream(iter(text.splitlines()))


def row_to_dict(field_names: List[str], row: List[str]) -> Dict[str, str]:
    """Map column names to cell values positionally."""
    out: Dict[str, str] = {}
    for i, name in enumerate(field_names):
        out[name] = row[i] if i < len(row) else ""
    return out


def _safe_float(s: str, default: float = 0.0) -> float:
    if s is None or s == "":
        return default
    try:
        return float(s)
    except ValueError:
        return default


def _safe_int(s: str, default: Optional[int] = None) -> Optional[int]:
    if s is None or s == "":
        return default
    try:
        return int(float(s))
    except ValueError:
        return default


def normalize_pred_type(raw: str) -> str:
    """Map P6 ``PR_FS`` / codes to FS, SS, FF, SF."""
    r = (raw or "").strip().upper()
    if "FS" in r or r == "PR_FS" or r.endswith("FINISHTOSTART"):
        return "FS"
    if "SS" in r or r == "PR_SS" or "STARTTOSTART" in r:
        return "SS"
    if "FF" in r or r == "PR_FF" or "FINISHTOFINISH" in r:
        return "FF"
    if "SF" in r or r == "PR_SF" or "STARTTOFINISH" in r:
        return "SF"
    if r in ("0", "PT_FinishToStart"):
        return "FS"
    if r in ("1", "PT_StartToStart"):
        return "SS"
    if r in ("2", "PT_FinishToFinish"):
        return "FF"
    if r in ("3", "PT_StartToFinish"):
        return "SF"
    return "FS"


def import_xer_to_sqlite(conn: Any, data: bytes, filename: str = "upload.xer") -> Dict[str, Any]:
    """
    Parse XER bytes (streaming line read) and insert into SQLite.

    Replaces data for the same ``proj_id`` via DELETE + re-insert.
    Returns summary counts for the API.
    """
    init_db(conn)
    tables = parse_xer_stream(iter_decoded_lines(data))

    proj_rows = tables.get("PROJECT", ([], []))[1]
    proj_fields = tables.get("PROJECT", ([], []))[0]
    if not proj_fields or not proj_rows:
        raise ValueError("XER file has no PROJECT table or is empty")

    proj_dict = row_to_dict(proj_fields, proj_rows[0])
    proj_id = proj_dict.get("proj_id")
    if not proj_id:
        raise ValueError("PROJECT row missing proj_id")

    proj_short = proj_dict.get("proj_short_name") or proj_dict.get("proj_name") or proj_id
    imported_at = datetime.now(timezone.utc).isoformat()
    meta = {"filename": filename, "tables": list(tables.keys())}

    cur = conn.cursor()
    cur.execute("DELETE FROM calendars WHERE proj_id = ?", (proj_id,))
    cur.execute("DELETE FROM projects WHERE proj_id = ?", (proj_id,))

    cur.execute(
        "INSERT INTO projects (proj_id, name, imported_at, raw_meta) VALUES (?, ?, ?, ?)",
        (proj_id, proj_short, imported_at, json_dumps(meta)),
    )

    act_rows: List[Tuple[Any, ...]] = []
    task_fields, task_rows = tables.get("TASK", ([], []))
    if task_fields:
        for row in task_rows:
            d = row_to_dict(task_fields, row)
            tid = d.get("task_id")
            if not tid:
                continue
            p = d.get("proj_id")
            if p and str(p) != str(proj_id):
                continue
            name = d.get("task_name") or d.get("task_code") or f"Task {tid}"
            dur = _safe_float(d.get("target_drtn_hr_cnt"), 0.0)
            if dur < 0:
                dur = 0.0
            wbs = d.get("wbs_id") or ""
            cal = d.get("clndr_id") or ""
            ttype = (d.get("task_type") or "").upper()
            is_ms = 1 if dur <= 0.0 or "MILESTONE" in ttype or ttype == "TT_MILE" else 0
            act_rows.append((str(tid), proj_id, name, dur, str(cal) if cal else None, str(wbs) if wbs else None, is_ms))

    bulk_insert_activities(conn, act_rows)

    rel_rows: List[Tuple[Any, ...]] = []
    pred_fields, pred_rows = tables.get("TASKPRED", ([], []))
    if pred_fields:
        for row in pred_rows:
            d = row_to_dict(pred_fields, row)
            succ = d.get("task_id")
            pr = d.get("pred_task_id")
            if not succ or not pr:
                continue
            p = d.get("proj_id")
            if p and str(p) != str(proj_id):
                continue
            lag = _safe_float(d.get("lag_hr_cnt"), 0.0)
            pt = normalize_pred_type(d.get("pred_type") or "FS")
            rel_rows.append((proj_id, str(pr), str(succ), pt, lag))

    bulk_insert_relationships(conn, rel_rows)

    cal_count = 0
    cal_fields, cal_rows = tables.get("CALENDAR", ([], []))
    if cal_fields:
        for row in cal_rows:
            d = row_to_dict(cal_fields, row)
            cid = d.get("clndr_id")
            if not cid:
                continue
            name = d.get("clndr_name") or ""
            raw_data = d.get("clndr_data") or ""
            # Composite PK safety: scope by project for uniqueness
            pk = f"{proj_id}:{cid}"
            cur.execute(
                """INSERT OR REPLACE INTO calendars (calendar_id, proj_id, name, data)
                   VALUES (?, ?, ?, ?)""",
                (pk, proj_id, name, raw_data or None),
            )
            cal_count += 1

    conn.commit()

    return {
        "proj_id": proj_id,
        "name": proj_short,
        "activities_count": len(act_rows),
        "relationships_count": len(rel_rows),
        "calendars_count": cal_count,
    }
