"""
Schedule health checks: open ends, duration, finish-type predecessors, critical percent.

Pure functions over activity/relationship row dicts (SQLite column names).
"""

from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Set

from models import DiagnosticsResult, DiagnosticsSummary, Finding

MAX_FINDINGS = 500
EXCESSIVE_DURATION_HRS = 2000.0


def _tid(a: dict) -> str:
    return str(a["task_id"])


def run_diagnostics(
    proj_id: str,
    activities: List[dict],
    relationships: List[dict],
    hours_per_day: float = 8.0,
) -> DiagnosticsResult:
    """
    Run all diagnostic rules and return :class:`DiagnosticsResult`.

    ``hours_per_day`` is reserved for display helpers; rules use raw hours.
    """
    del proj_id, hours_per_day  # API symmetry; unused in rules

    ids: Set[str] = {_tid(a) for a in activities}

    pred_count: Dict[str, int] = defaultdict(int)
    succ_count: Dict[str, int] = defaultdict(int)
    preds_of: Dict[str, List[dict]] = defaultdict(list)

    for r in relationships:
        p = str(r.get("pred_id", r.get("pred_task_id", "")))
        s = str(r.get("succ_id", r.get("succ_task_id", "")))
        if p in ids and s in ids:
            pred_count[s] += 1
            succ_count[p] += 1
            preds_of[s].append(r)

    total = len(activities)
    critical_ct = sum(1 for a in activities if int(a.get("is_critical") or 0))
    pct_crit = (critical_ct / total * 100.0) if total else 0.0

    findings: List[Finding] = []

    def add(check: str, severity: str, msg: str, tid: str | None = None) -> None:
        if len(findings) >= MAX_FINDINGS:
            return
        findings.append(Finding(check=check, severity=severity, task_id=tid, message=msg))

    open_no_pred = 0
    open_no_succ = 0
    excessive = 0
    missing_ff = 0

    milestone_ids = {_tid(a) for a in activities if int(a.get("is_milestone") or 0)}

    for a in activities:
        tid = _tid(a)
        is_ms = tid in milestone_ids
        dur = float(a.get("duration_hrs") or 0)

        if pred_count.get(tid, 0) == 0 and not is_ms:
            open_no_pred += 1
            add(
                "no_predecessors",
                "warning",
                "Activity has no predecessors (possible open start).",
                tid,
            )
        if succ_count.get(tid, 0) == 0 and not is_ms:
            open_no_succ += 1
            add(
                "no_successors",
                "warning",
                "Activity has no successors (possible open finish).",
                tid,
            )
        if dur > EXCESSIVE_DURATION_HRS:
            excessive += 1
            add(
                "excessive_duration",
                "warning",
                f"Duration exceeds {EXCESSIVE_DURATION_HRS}h threshold.",
                tid,
            )

        if not is_ms:
            plist = preds_of.get(tid, [])
            rt = lambda x: str(x.get("rel_type", x.get("pred_type", "FS")))
            has_finish_driver = any(rt(x) in ("FS", "FF") for x in plist)
            if not has_finish_driver:
                missing_ff += 1
                add(
                    "missing_finish_logic",
                    "info",
                    "No FS or FF predecessor (heuristic; SS/SF-only may be valid).",
                    tid,
                )

    # %% critical band checks (info)
    if total > 0:
        if pct_crit > 30.0:
            add("pct_critical", "info", f"High share of critical work ({pct_crit:.1f}% > 30%).", None)
        if pct_crit < 2.0 and critical_ct > 0:
            add("pct_critical", "info", f"Low share of critical activities ({pct_crit:.1f}% < 2%).", None)

    truncated = len(findings) >= MAX_FINDINGS

    summary = DiagnosticsSummary(
        total_activities=total,
        critical_count=critical_ct,
        critical_pct=round(pct_crit, 2),
        open_starts=open_no_pred,
        open_ends=open_no_succ,
    )

    return DiagnosticsResult(findings=findings, summary=summary, truncated=truncated)
