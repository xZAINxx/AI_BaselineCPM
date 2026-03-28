"""Diagnostics engine unit tests."""

from diagnostics import run_diagnostics


def _act(tid, dur=8.0, is_crit=0, is_near=0, tf=0.0, is_ms=0, ctype=None, es=0.0, ef=None):
    return {
        "task_id": tid,
        "duration_hrs": dur,
        "is_critical": is_crit,
        "is_near_critical": is_near,
        "total_float_hrs": tf,
        "is_milestone": is_ms,
        "constraint_type": ctype,
        "early_start": es,
        "early_finish": ef if ef is not None else es + dur,
    }


def _rel(pred, succ, rtype="FS", lag=0.0):
    return {"pred_id": pred, "succ_id": succ, "rel_type": rtype, "lag_hrs": lag}


def test_open_starts_detection() -> None:
    acts = [_act("1"), _act("2"), _act("3")]
    rels = [_rel("1", "2"), _rel("2", "3")]
    result = run_diagnostics("P", acts, rels)
    assert result.summary.open_starts == 1  # task 1 has no predecessors


def test_open_ends_detection() -> None:
    acts = [_act("1"), _act("2"), _act("3")]
    rels = [_rel("1", "2"), _rel("1", "3")]
    result = run_diagnostics("P", acts, rels)
    assert result.summary.open_ends == 2  # tasks 2 and 3 have no successors


def test_milestones_excluded_from_open_ends() -> None:
    acts = [_act("1"), _act("2"), _act("3", dur=0.0, is_ms=1)]
    rels = [_rel("1", "2"), _rel("2", "3")]
    result = run_diagnostics("P", acts, rels)
    assert result.summary.open_ends == 0


def test_excessive_duration() -> None:
    acts = [_act("1", dur=3000.0), _act("2", dur=100.0)]
    rels = [_rel("1", "2")]
    result = run_diagnostics("P", acts, rels)
    excessive = [f for f in result.findings if f.check == "excessive_duration"]
    assert len(excessive) == 1
    assert excessive[0].task_id == "1"


def test_dcma_score_all_pass() -> None:
    acts = []
    for i in range(100):
        acts.append(_act(str(i), dur=40.0, is_crit=1 if i < 15 else 0, tf=0.0 if i < 15 else 80.0))
    rels = []
    for i in range(99):
        rels.append(_rel(str(i), str(i + 1)))
    result = run_diagnostics("P", acts, rels)
    assert result.dcma_checks is not None
    pass_count = sum(1 for v in result.dcma_checks.values() if v)
    assert pass_count >= 10


def test_dcma_score_failures() -> None:
    acts = [_act("1", dur=3000.0, tf=-10.0)]
    rels = []
    result = run_diagnostics("P", acts, rels)
    assert result.dcma_checks is not None
    assert result.dcma_checks["negative_float"] is False
    assert result.dcma_checks["high_duration"] is False


def test_near_critical_findings() -> None:
    acts = [_act("1", tf=20.0, is_near=1)]
    rels = [_rel("X", "1")]  # give it a pred so it's not open start
    result = run_diagnostics("P", acts, rels)
    near = [f for f in result.findings if f.check == "near_critical"]
    assert len(near) == 1


def test_negative_float_detection() -> None:
    acts = [_act("1", tf=-10.0)]
    rels = [_rel("X", "1")]
    result = run_diagnostics("P", acts, rels)
    neg = [f for f in result.findings if f.check == "negative_float"]
    assert len(neg) == 1


def test_relationship_ratio() -> None:
    acts = [_act("1"), _act("2")]
    rels = [_rel("1", "2")]
    result = run_diagnostics("P", acts, rels)
    ratio_findings = [f for f in result.findings if f.check == "relationship_ratio"]
    assert len(ratio_findings) == 1
    assert "under-linked" in ratio_findings[0].message.lower() or "Low" in ratio_findings[0].message


def test_truncation_at_500() -> None:
    acts = [_act(str(i)) for i in range(600)]
    rels = []
    result = run_diagnostics("P", acts, rels)
    assert result.truncated is True
    assert len(result.findings) == 500
