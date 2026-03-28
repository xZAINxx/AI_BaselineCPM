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
NEAR_CRIT_THRESHOLD = 40.0  # 5 days * 8 hours
DCMA_HIGH_FLOAT_HRS = 352.0  # 44 days * 8 hours
DCMA_HIGH_DURATION_HRS = 352.0  # 44 days * 8 hours


def _tid(a: dict) -> str:
    return str(a["task_id"])


def compute_dcma_score(
    total: int,
    critical_ct: int,
    pct_crit: float,
    open_starts: int,
    open_ends: int,
    high_float_ct: int,
    negative_float_ct: int,
    high_duration_ct: int,
    hard_constraint_ct: int,
    invalid_dates_ct: int,
    rel_ratio: float,
    lag_ct: int,
    lead_ct: int,
    sf_ct: int,
    rel_total: int,
) -> dict:
    """
    Compute DCMA 14-Point Assessment pass/fail for each check.

    Thresholds:
    - Open starts: < 5% of activities
    - Open ends: < 5% of activities
    - High float: < 5% of activities
    - Negative float: 0 activities
    - High duration: < 5% of activities
    - Hard constraints: < 5% of activities
    - Relationship ratio: 1.5 to 2.5
    - Lags: < 5% of relationships
    - Leads: 0 relationships
    - SF relationships: < 1% of relationships
    - Critical path length ratio: 10-25% of total activities
    - Missing predecessors: < 5%
    - Missing successors: < 5%
    - Invalid dates: 0
    """
    results: Dict[str, bool] = {}

    pct = lambda count: (count / total * 100) if total > 0 else 0
    rel_pct = lambda count: (count / rel_total * 100) if rel_total > 0 else 0

    results["missing_predecessors"] = pct(open_starts) < 5
    results["missing_successors"] = pct(open_ends) < 5
    results["high_float"] = pct(high_float_ct) < 5
    results["negative_float"] = negative_float_ct == 0
    results["high_duration"] = pct(high_duration_ct) < 5
    results["hard_constraints"] = pct(hard_constraint_ct) < 5
    results["relationship_ratio"] = 1.5 <= rel_ratio <= 2.5
    results["lags"] = rel_pct(lag_ct) < 5
    results["leads"] = lead_ct == 0
    results["sf_relationships"] = rel_pct(sf_ct) < 1
    results["critical_path_ratio"] = 10 <= pct_crit <= 25
    results["invalid_dates"] = invalid_dates_ct == 0
    results["open_starts"] = pct(open_starts) < 5
    results["open_ends"] = pct(open_ends) < 5

    pass_count = sum(1 for v in results.values() if v)

    return {
        "checks": results,
        "pass_count": pass_count,
        "total_checks": 14,
    }


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
    near_crit_ct = sum(1 for a in activities if int(a.get("is_near_critical") or 0))

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

    high_float_ct = 0
    negative_float_ct = 0
    high_duration_ct = 0
    hard_constraint_ct = 0
    invalid_dates_ct = 0

    for a in activities:
        tid = _tid(a)
        is_ms = tid in milestone_ids
        dur = float(a.get("duration_hrs") or 0)
        tf = a.get("total_float_hrs")
        es = a.get("early_start")
        ef = a.get("early_finish")
        ctype = a.get("constraint_type")

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

        if dur > DCMA_HIGH_DURATION_HRS:
            high_duration_ct += 1
            days = dur / 8.0
            add(
                "high_duration",
                "info",
                f"Duration exceeds DCMA threshold ({days:.1f} days > 44 days).",
                tid,
            )

        if tf is not None and tf > DCMA_HIGH_FLOAT_HRS:
            high_float_ct += 1
            days = tf / 8.0
            add(
                "high_float",
                "info",
                f"Total float exceeds DCMA threshold ({days:.1f} days > 44 days).",
                tid,
            )

        if tf is not None and tf < 0:
            negative_float_ct += 1
            add(
                "negative_float",
                "warning",
                f"Activity has negative float ({tf:.1f}h) — cannot meet constraint.",
                tid,
            )

        if es is not None and ef is not None and ef < es:
            invalid_dates_ct += 1
            add(
                "invalid_dates",
                "error",
                "Early finish is before early start — invalid CPM output.",
                tid,
            )

        if ctype and ctype.upper() not in (None, "", "ASAP"):
            hard_constraint_ct += 1
            add(
                "hard_constraints",
                "info",
                f"Activity has hard constraint ({ctype}).",
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

        if int(a.get("is_near_critical") or 0):
            tf_val = float(a.get("total_float_hrs") or 0)
            days = tf_val / 8.0
            add(
                "near_critical",
                "info",
                f"Activity has less than 5 days of float ({days:.1f} days) — near-critical.",
                tid,
            )

    lag_ct = 0
    lead_ct = 0
    sf_ct = 0
    rel_total = len(relationships)

    for r in relationships:
        lag = float(r.get("lag_hrs") or 0)
        rtype = str(r.get("rel_type", r.get("pred_type", "FS"))).upper()

        if lag > 0:
            lag_ct += 1
        if lag < 0:
            lead_ct += 1
            add(
                "leads",
                "warning",
                f"Relationship has negative lag (lead of {abs(lag):.1f}h) — DCMA discourages leads.",
                None,
            )
        if rtype == "SF":
            sf_ct += 1

    if rel_total > 0:
        lag_pct = (lag_ct / rel_total) * 100
        if lag_pct > 5:
            add(
                "lags",
                "info",
                f"Excessive use of lags ({lag_pct:.1f}% of relationships > 5%).",
                None,
            )
        sf_pct = (sf_ct / rel_total) * 100
        if sf_pct > 1:
            add(
                "sf_relationships",
                "info",
                f"High SF relationship usage ({sf_pct:.1f}% > 1%) — review for appropriateness.",
                None,
            )

    rel_ratio = (rel_total / total) if total > 0 else 0.0
    if total > 0:
        if rel_ratio < 1.5:
            add(
                "relationship_ratio",
                "warning",
                f"Low relationship density ({rel_ratio:.2f} < 1.5) — schedule may be under-linked.",
                None,
            )
        elif rel_ratio > 2.5:
            add(
                "relationship_ratio",
                "info",
                f"High relationship density ({rel_ratio:.2f} > 2.5) — may indicate over-linking.",
                None,
            )

    # %% critical band checks (info)
    if total > 0:
        if pct_crit > 30.0:
            add("pct_critical", "info", f"High share of critical work ({pct_crit:.1f}% > 30%).", None)
        if pct_crit < 2.0 and critical_ct > 0:
            add("pct_critical", "info", f"Low share of critical activities ({pct_crit:.1f}% < 2%).", None)

    dcma_results = compute_dcma_score(
        total, critical_ct, pct_crit, open_no_pred, open_no_succ,
        high_float_ct, negative_float_ct, high_duration_ct, hard_constraint_ct,
        invalid_dates_ct, rel_ratio, lag_ct, lead_ct, sf_ct, rel_total,
    )

    truncated = len(findings) >= MAX_FINDINGS

    summary = DiagnosticsSummary(
        total_activities=total,
        critical_count=critical_ct,
        critical_pct=round(pct_crit, 2),
        near_critical_count=near_crit_ct,
        open_starts=open_no_pred,
        open_ends=open_no_succ,
        high_float_count=high_float_ct,
        negative_float_count=negative_float_ct,
        high_duration_count=high_duration_ct,
        relationship_ratio=round(rel_ratio, 2),
        lag_count=lag_ct,
        lead_count=lead_ct,
        sf_count=sf_ct,
        hard_constraint_count=hard_constraint_ct,
        dcma_pass_count=dcma_results["pass_count"],
        dcma_total_checks=14,
    )

    return DiagnosticsResult(findings=findings, summary=summary, truncated=truncated)
