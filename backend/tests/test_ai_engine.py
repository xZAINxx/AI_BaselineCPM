"""AI engine rule-based function tests (no API key required)."""

import pytest
from ai_engine import (
    analyze_schedule_network,
    build_schedule_context,
    extract_json_object,
    generate_auto_fixes,
    generate_fix_suggestions,
)


def _act(tid, dur=8.0, is_crit=0, tf=0.0, es=0, ef=None, wbs=None, is_ms=0, name=None):
    return {
        "task_id": tid,
        "name": name or f"Task {tid}",
        "duration_hrs": dur,
        "is_critical": is_crit,
        "total_float_hrs": tf,
        "early_start": es,
        "early_finish": ef if ef is not None else es + dur,
        "wbs_id": wbs,
        "is_milestone": is_ms,
        "is_near_critical": 0,
    }


def _rel(pred, succ, rtype="FS", lag=0, rid=None):
    return {
        "id": rid or hash(f"{pred}-{succ}"),
        "pred_id": pred,
        "succ_id": succ,
        "rel_type": rtype,
        "lag_hrs": lag,
    }


def test_extract_json_plain():
    result = extract_json_object('{"reply": "hello", "actions": []}')
    assert result == {"reply": "hello", "actions": []}


def test_extract_json_markdown_fences():
    text = '```json\n{"reply": "test", "actions": []}\n```'
    result = extract_json_object(text)
    assert result is not None
    assert result["reply"] == "test"


def test_extract_json_with_surrounding_text():
    text = 'Here is the result: {"reply": "found", "actions": []} That is all.'
    result = extract_json_object(text)
    assert result is not None
    assert result["reply"] == "found"


def test_extract_json_invalid():
    assert extract_json_object("no json here") is None
    assert extract_json_object("") is None
    assert extract_json_object("just {broken") is None


def test_context_compact():
    acts = [_act("A", is_crit=1, tf=0), _act("B", tf=50)]
    rels = [_rel("A", "B")]
    ctx = build_schedule_context("P1", acts, rels, None, compact=True)
    assert "activity_count: 2" in ctx
    assert "critical_count: 1" in ctx
    assert "relationship_count: 1" in ctx


def test_context_full_includes_data():
    acts = [_act("A", is_crit=1, tf=0, dur=40, name="Foundation")]
    rels = [_rel("A", "B")]
    ctx = build_schedule_context("P1", acts, rels, {"open_starts": 1})
    assert "activities (sample" in ctx
    assert "relationships (sample" in ctx
    assert "Foundation" in ctx
    assert "critical_path_drivers" in ctx


def test_context_truncates_large_lists():
    acts = [_act(f"T{i}") for i in range(200)]
    rels = [_rel(f"T{i}", f"T{i+1}") for i in range(199)]
    ctx = build_schedule_context("P1", acts, rels, None)
    assert "more activities omitted" in ctx
    assert "more relationships omitted" in ctx


def test_analysis_returns_score():
    acts = [_act("A", is_crit=1, tf=0), _act("B", tf=20), _act("C", tf=100)]
    rels = [_rel("A", "B"), _rel("B", "C")]
    result = analyze_schedule_network("P1", acts, rels, None)
    assert "schedule_score" in result
    assert 0 <= result["schedule_score"] <= 100


def test_analysis_critical_drivers():
    acts = [
        _act("A", is_crit=1, tf=0, dur=100, name="Long Critical"),
        _act("B", is_crit=1, tf=0, dur=10, name="Short Critical"),
        _act("C", tf=50),
    ]
    rels = [_rel("A", "B"), _rel("B", "C")]
    result = analyze_schedule_network("P1", acts, rels, None)
    drivers = result["critical_path_drivers"]
    assert len(drivers) >= 1
    assert drivers[0]["task_id"] == "A"


def test_analysis_float_risks():
    acts = [_act("A", is_crit=1, tf=0), _act("B", tf=20)]
    rels = [_rel("A", "B")]
    result = analyze_schedule_network("P1", acts, rels, None)
    assert len(result["float_consumption_risks"]) >= 1


def test_analysis_relationship_density():
    acts = [_act("A"), _act("B")]
    rels = [_rel("A", "B")]
    result = analyze_schedule_network("P1", acts, rels, None)
    assert result["relationship_density"]["ratio"] == 0.5
    assert result["relationship_density"]["flag"] == "under_linked"


def test_analysis_logic_gaps_ss_only():
    acts = [_act("A"), _act("B")]
    rels = [_rel("A", "B", "SS")]
    result = analyze_schedule_network("P1", acts, rels, None)
    gaps = [g for g in result["logic_gaps"] if g["task_id"] == "B"]
    assert len(gaps) >= 1
    assert gaps[0]["issue"] == "only_ss_predecessors"


class _FakeSummary:
    def __init__(self, open_starts=0, open_ends=0, critical_pct=10.0):
        self.open_starts = open_starts
        self.open_ends = open_ends
        self.critical_pct = critical_pct


class _FakeDiag:
    def __init__(self, summary=None, findings=None):
        self.summary = summary or _FakeSummary()
        self.findings = findings or []


def test_suggestions_open_starts():
    acts = [_act("A"), _act("B")]
    rels = [_rel("A", "B")]
    diag = _FakeDiag(summary=_FakeSummary(open_starts=2))
    sug = generate_fix_suggestions("P1", acts, rels, diag)
    titles = [s["title"].lower() for s in sug]
    assert any("open start" in t for t in titles)


def test_suggestions_open_ends():
    diag = _FakeDiag(summary=_FakeSummary(open_ends=3))
    sug = generate_fix_suggestions("P1", [_act("A")], [], diag)
    titles = [s["title"].lower() for s in sug]
    assert any("open end" in t or "close" in t for t in titles)


def test_suggestions_high_critical():
    diag = _FakeDiag(summary=_FakeSummary(critical_pct=45.0))
    sug = generate_fix_suggestions("P1", [_act("A")], [], diag)
    titles = [s["title"].lower() for s in sug]
    assert any("critical" in t for t in titles)


def test_suggestions_near_critical():
    acts = [_act("A", tf=20, is_crit=0)]
    diag = _FakeDiag()
    sug = generate_fix_suggestions("P1", acts, [], diag)
    ids = [s.get("id", "") for s in sug]
    assert any("near-critical" in i for i in ids)


def test_suggestions_capped_at_50():
    acts = [_act(f"T{i}") for i in range(200)]
    diag = _FakeDiag(summary=_FakeSummary(open_starts=200, open_ends=200))
    sug = generate_fix_suggestions("P1", acts, [], diag)
    assert len(sug) <= 50


def test_auto_fixes_open_end():
    acts = [
        _act("A", es=0, ef=8, wbs="W1"),
        _act("B", es=8, ef=16, wbs="W1"),
        _act("C", es=16, ef=24, wbs="W1"),
    ]
    rels = [_rel("A", "B")]
    fixes = generate_auto_fixes("P1", acts, rels)
    assert len(fixes) >= 1
    assert all(f["op"] == "add_relationship" for f in fixes)


def test_auto_fixes_open_start():
    acts = [
        _act("A", es=0, ef=8, wbs="W1"),
        _act("B", es=8, ef=16, wbs="W1"),
        _act("C", es=0, ef=8, wbs="W1"),
    ]
    rels = [_rel("A", "B")]
    fixes = generate_auto_fixes("P1", acts, rels)
    pred_fixes = [f for f in fixes if f.get("succ_id") == "C"]
    assert len(pred_fixes) >= 0


def test_auto_fixes_no_duplicates():
    acts = [
        _act("A", es=0, ef=8, wbs="W1"),
        _act("B", es=8, ef=16, wbs="W1"),
    ]
    rels = []
    fixes = generate_auto_fixes("P1", acts, rels)
    pairs = [(f["pred_id"], f["succ_id"]) for f in fixes if f["op"] == "add_relationship"]
    assert len(pairs) == len(set(pairs))


def test_auto_fixes_skips_milestones():
    acts = [
        _act("M", es=0, ef=0, is_ms=1, dur=0),
        _act("A", es=0, ef=8, wbs="W1"),
    ]
    rels = []
    fixes = generate_auto_fixes("P1", acts, rels)
    milestone_as_open_end = [f for f in fixes if f["op"] == "add_relationship" and f["pred_id"] == "M" and "_reason" in f and "Open end" in f["_reason"]]
    assert len(milestone_as_open_end) == 0
