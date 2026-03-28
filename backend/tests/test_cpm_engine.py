"""CPM engine unit tests: chains, parallel paths, lag, SS, SF, cycles, milestones."""

from cpm_engine import compute_cpm


def test_simple_chain_fs() -> None:
    task_ids = ["1", "2", "3"]
    duration = {"1": 8.0, "2": 8.0, "3": 0.0}
    rels = [
        ("1", "2", "FS", 0.0),
        ("2", "3", "FS", 0.0),
    ]
    err, ES, EF, LS, LF, TF, FF, crit, near_crit, end, path = compute_cpm(task_ids, duration, rels)
    assert err is None
    assert abs(end - 16.0) < 1e-2
    assert crit["1"] and crit["2"] and crit["3"]
    assert path


def test_parallel_paths_float() -> None:
    task_ids = ["1", "2", "3", "4"]
    duration = {"1": 8.0, "2": 4.0, "3": 8.0, "4": 0.0}
    rels = [
        ("1", "2", "FS", 0.0),
        ("1", "3", "FS", 0.0),
        ("2", "4", "FS", 0.0),
        ("3", "4", "FS", 0.0),
    ]
    err, ES, EF, LS, LF, TF, FF, crit, near_crit, end, _ = compute_cpm(task_ids, duration, rels)
    assert err is None
    assert abs(EF["4"] - end) < 1e-2
    assert TF["2"] > 1e-3 or TF["3"] > 1e-3


def test_fs_with_lag() -> None:
    task_ids = ["1", "2"]
    duration = {"1": 8.0, "2": 8.0}
    rels = [("1", "2", "FS", 4.0)]
    err, ES, EF, _, _, _, _, _, _, end, _ = compute_cpm(task_ids, duration, rels)
    assert err is None
    assert abs(ES["2"] - (EF["1"] + 4.0)) < 1e-2


def test_ss_relationship() -> None:
    task_ids = ["1", "2"]
    duration = {"1": 8.0, "2": 8.0}
    rels = [("1", "2", "SS", 2.0)]
    err, ES, _, _, _, _, _, _, _, _, _ = compute_cpm(task_ids, duration, rels)
    assert err is None
    assert ES["2"] >= ES["1"] + 2.0 - 1e-2


def test_sf_relationship() -> None:
    """SF: successor finish >= predecessor start + lag."""
    task_ids = ["1", "2"]
    duration = {"1": 0.0, "2": 8.0}
    rels = [("1", "2", "SF", 0.0)]
    err, ES, EF, _, _, _, _, _, _, _, _ = compute_cpm(task_ids, duration, rels)
    assert err is None
    assert EF["2"] >= ES["1"] - 1e-2


def test_cycle_detection() -> None:
    task_ids = ["1", "2"]
    duration = {"1": 1.0, "2": 1.0}
    rels = [("1", "2", "FS", 0.0), ("2", "1", "FS", 0.0)]
    err, *_ = compute_cpm(task_ids, duration, rels)
    assert err is not None
    assert "cycle" in err.lower()


def test_milestones_zero_duration() -> None:
    task_ids = ["1", "2"]
    duration = {"1": 0.0, "2": 0.0}
    rels = [("1", "2", "FS", 0.0)]
    err, ES, EF, _, _, TF, FF, _, _, _, _ = compute_cpm(task_ids, duration, rels)
    assert err is None
    assert abs(EF["2"] - ES["2"]) < 1e-6


def test_free_float_parallel_paths() -> None:
    """A(8) -> C(8) -> D(0), A(8) -> B(4) -> D(0): shorter branch B has FF = 4h."""
    task_ids = ["A", "B", "C", "D"]
    duration = {"A": 8.0, "B": 4.0, "C": 8.0, "D": 0.0}
    rels = [
        ("A", "B", "FS", 0.0),
        ("A", "C", "FS", 0.0),
        ("B", "D", "FS", 0.0),
        ("C", "D", "FS", 0.0),
    ]
    err, ES, EF, _, _, TF, FF, crit, _, end, _ = compute_cpm(task_ids, duration, rels)
    assert err is None
    assert abs(end - 16.0) < 1e-2
    assert abs(FF["B"] - 4.0) < 1e-2
    assert abs(FF["C"]) < 1e-2
    assert crit["C"] or crit["D"]
    assert abs(FF["D"] - TF["D"]) < 1e-2


def test_snet_constraint() -> None:
    """SNET: Activity B has SNET=20h; even though A finishes at 8h, B starts at 20h."""
    task_ids = ["A", "B"]
    duration = {"A": 8.0, "B": 8.0}
    rels = [("A", "B", "FS", 0.0)]
    constraints = {"B": ("SNET", 20.0)}
    err, ES, EF, _, _, _, _, _, _, end, _ = compute_cpm(task_ids, duration, rels, constraints)
    assert err is None
    assert abs(ES["B"] - 20.0) < 1e-2
    assert abs(EF["B"] - 28.0) < 1e-2
    assert abs(end - 28.0) < 1e-2


def test_fnlt_constraint() -> None:
    """FNLT: Activity C has FNLT=12h; its LF should be clamped to 12h, creating negative float."""
    task_ids = ["A", "B", "C"]
    duration = {"A": 8.0, "B": 8.0, "C": 8.0}
    rels = [("A", "B", "FS", 0.0), ("B", "C", "FS", 0.0)]
    constraints = {"C": ("FNLT", 12.0)}
    err, ES, EF, LS, LF, TF, _, _, _, _, _ = compute_cpm(task_ids, duration, rels, constraints)
    assert err is None
    assert abs(LF["C"] - 12.0) < 1e-2
    assert TF["C"] < 0


def test_mso_constraint() -> None:
    """MSO: Activity B must start on 40h regardless of predecessor."""
    task_ids = ["A", "B"]
    duration = {"A": 8.0, "B": 8.0}
    rels = [("A", "B", "FS", 0.0)]
    constraints = {"B": ("MSO", 40.0)}
    err, ES, EF, _, _, _, _, _, _, end, _ = compute_cpm(task_ids, duration, rels, constraints)
    assert err is None
    assert abs(ES["B"] - 40.0) < 1e-2
    assert abs(EF["B"] - 48.0) < 1e-2


def test_negative_float() -> None:
    """FNLT constraint that conflicts with network should produce negative float."""
    task_ids = ["A", "B"]
    duration = {"A": 16.0, "B": 8.0}
    rels = [("A", "B", "FS", 0.0)]
    constraints = {"B": ("FNLT", 20.0)}
    err, ES, EF, LS, LF, TF, _, crit, _, _, _ = compute_cpm(task_ids, duration, rels, constraints)
    assert err is None
    assert abs(EF["B"] - 24.0) < 1e-2
    assert abs(LF["B"] - 20.0) < 1e-2
    assert TF["B"] < 0
    assert crit["B"]


def test_near_critical_detection() -> None:
    """Activities with 0 < TF < 40h should be flagged as near-critical."""
    task_ids = ["A", "B", "C", "D"]
    duration = {"A": 8.0, "B": 8.0, "C": 40.0, "D": 0.0}
    rels = [
        ("A", "B", "FS", 0.0),
        ("A", "C", "FS", 0.0),
        ("B", "D", "FS", 0.0),
        ("C", "D", "FS", 0.0),
    ]
    err, ES, EF, LS, LF, TF, FF, crit, near_crit, end, _ = compute_cpm(task_ids, duration, rels)
    assert err is None
    assert abs(TF["B"] - 32.0) < 1e-2
    assert near_crit["B"]
    assert not crit["B"]
    assert crit["C"]
    assert not near_crit["C"]
