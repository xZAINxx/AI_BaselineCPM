"""
Reconstruct a Primavera P6 .xer file from stored raw tables + current schedule data.

Merges original XER tables with modified TASK/TASKPRED data from SQLite.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple


def _format_xer_value(val: str) -> str:
    """Escape tabs and newlines in a cell value for XER format."""
    if not val:
        return ""
    return val.replace("\t", " ").replace("\n", " ").replace("\r", "")


def _write_table(lines: List[str], table_name: str, fields: List[str], rows: List[List[str]]) -> None:
    """Append one XER table (%T, %F, %R lines) to output."""
    lines.append(f"%T\t{table_name}")
    lines.append("%F\t" + "\t".join(fields))
    for row in rows:
        padded = list(row) + [""] * max(0, len(fields) - len(row))
        lines.append("%R\t" + "\t".join(_format_xer_value(str(c)) for c in padded[:len(fields)]))


def build_xer_export(
    proj_id: str,
    raw_tables: Dict[str, Tuple[List[str], List[List[str]]]],
    current_activities: List[dict],
    current_relationships: List[dict],
) -> str:
    """
    Build XER file content as a string.

    Uses raw_tables for all tables EXCEPT TASK and TASKPRED, which are
    rebuilt from current_activities and current_relationships to reflect
    any modifications made in the app.
    """
    lines: List[str] = []
    lines.append("ERMHDR\t12.0\t2025-01-01")

    table_order = list(raw_tables.keys())
    if "TASK" not in table_order:
        table_order.append("TASK")
    if "TASKPRED" not in table_order:
        table_order.append("TASKPRED")

    for tbl_name in table_order:
        if tbl_name == "TASK":
            _write_task_table(lines, proj_id, raw_tables.get("TASK"), current_activities)
        elif tbl_name == "TASKPRED":
            _write_taskpred_table(lines, proj_id, raw_tables.get("TASKPRED"), current_relationships)
        else:
            raw = raw_tables.get(tbl_name)
            if raw:
                fields, rows = raw
                _write_table(lines, tbl_name, fields, rows)

    lines.append("%E")
    return "\r\n".join(lines) + "\r\n"


def _write_task_table(
    lines: List[str],
    proj_id: str,
    raw_task: Optional[Tuple[List[str], List[List[str]]]],
    current_activities: List[dict],
) -> None:
    """Write TASK table using original fields structure but current activity data."""
    if not raw_task:
        fields = ["task_id", "proj_id", "task_code", "task_name", "target_drtn_hr_cnt",
                  "wbs_id", "clndr_id", "task_type"]
        rows = []
        for a in current_activities:
            rows.append([
                str(a.get("task_id", "")),
                str(proj_id),
                str(a.get("task_code", a.get("task_id", ""))),
                str(a.get("name", "")),
                str(a.get("duration_hrs", 0)),
                str(a.get("wbs_id", "")),
                str(a.get("calendar_id", "")),
                "TT_Mile" if a.get("is_milestone") else "TT_Task",
            ])
        _write_table(lines, "TASK", fields, rows)
        return

    fields, original_rows = raw_task
    act_map = {str(a["task_id"]): a for a in current_activities}

    def idx(name):
        try:
            return fields.index(name)
        except ValueError:
            return -1

    i_tid = idx("task_id")
    i_name = idx("task_name")
    i_code = idx("task_code")
    i_dur = idx("target_drtn_hr_cnt")
    i_wbs = idx("wbs_id")
    i_cal = idx("clndr_id")
    i_type = idx("task_type")
    i_proj = idx("proj_id")

    updated_rows = []
    seen_ids = set()

    for orig_row in original_rows:
        row = list(orig_row)
        tid = row[i_tid] if i_tid >= 0 and i_tid < len(row) else None
        if not tid:
            updated_rows.append(row)
            continue

        if i_proj >= 0 and i_proj < len(row) and row[i_proj] and str(row[i_proj]) != str(proj_id):
            updated_rows.append(row)
            continue

        seen_ids.add(str(tid))
        act = act_map.get(str(tid))
        if not act:
            continue

        if i_name >= 0:
            row[i_name] = str(act.get("name", row[i_name] if i_name < len(row) else ""))
        if i_code >= 0:
            row[i_code] = str(act.get("task_code", row[i_code] if i_code < len(row) else tid))
        if i_dur >= 0:
            row[i_dur] = str(act.get("duration_hrs", row[i_dur] if i_dur < len(row) else 0))
        if i_wbs >= 0:
            row[i_wbs] = str(act.get("wbs_id", "") or "")
        if i_cal >= 0:
            row[i_cal] = str(act.get("calendar_id", "") or "")
        if i_type >= 0 and act.get("is_milestone"):
            row[i_type] = "TT_Mile"

        updated_rows.append(row)

    for tid_str, act in act_map.items():
        if tid_str not in seen_ids:
            new_row = [""] * len(fields)
            if i_tid >= 0: new_row[i_tid] = tid_str
            if i_proj >= 0: new_row[i_proj] = str(proj_id)
            if i_name >= 0: new_row[i_name] = str(act.get("name", ""))
            if i_code >= 0: new_row[i_code] = str(act.get("task_code", tid_str))
            if i_dur >= 0: new_row[i_dur] = str(act.get("duration_hrs", 0))
            if i_wbs >= 0: new_row[i_wbs] = str(act.get("wbs_id", "") or "")
            if i_cal >= 0: new_row[i_cal] = str(act.get("calendar_id", "") or "")
            if i_type >= 0: new_row[i_type] = "TT_Mile" if act.get("is_milestone") else "TT_Task"
            updated_rows.append(new_row)

    _write_table(lines, "TASK", fields, updated_rows)


def _write_taskpred_table(
    lines: List[str],
    proj_id: str,
    raw_pred: Optional[Tuple[List[str], List[List[str]]]],
    current_relationships: List[dict],
) -> None:
    """Write TASKPRED table from current relationships."""
    if raw_pred:
        fields = raw_pred[0]
    else:
        fields = ["task_pred_id", "task_id", "pred_task_id", "pred_type", "lag_hr_cnt", "proj_id"]

    def idx(name):
        try:
            return fields.index(name)
        except ValueError:
            return -1

    i_pred_id = idx("task_pred_id")
    i_succ = idx("task_id")
    i_pred = idx("pred_task_id")
    i_type = idx("pred_type")
    i_lag = idx("lag_hr_cnt")
    i_proj = idx("proj_id")

    pred_type_map = {"FS": "PR_FS", "SS": "PR_SS", "FF": "PR_FF", "SF": "PR_SF"}

    rows = []
    for i, r in enumerate(current_relationships):
        row = [""] * len(fields)
        if i_pred_id >= 0: row[i_pred_id] = str(r.get("id", i + 1))
        if i_succ >= 0: row[i_succ] = str(r.get("succ_id", ""))
        if i_pred >= 0: row[i_pred] = str(r.get("pred_id", ""))
        if i_type >= 0: row[i_type] = pred_type_map.get(str(r.get("rel_type", "FS")).upper(), "PR_FS")
        if i_lag >= 0: row[i_lag] = str(r.get("lag_hrs", 0))
        if i_proj >= 0: row[i_proj] = str(proj_id)
        rows.append(row)

    _write_table(lines, "TASKPRED", fields, rows)
