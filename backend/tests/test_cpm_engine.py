"""CPM engine unit tests: chains, parallel paths, lag, SS, SF, cycles, milestones."""

from cpm_engine import compute_cpm


def test_simple_chain_fs() -> None:
    task_ids = ["1", "2", "3"]
    duration = {"1": 8.0, "2": 8.0, "3": 0.0}
    rels = [
        ("1", "2", "FS", 0.0),
        ("2", "3", "FS", 0.0),
    ]
    err, ES, EF, LS, LF, TF, crit, end, path = compute_cpm(task_ids, duration, rels)
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
    err, ES, EF, LS, LF, TF, crit, end, _ = compute_cpm(task_ids, duration, rels)
    assert err is None
    assert abs(EF["4"] - end) < 1e-2
    assert TF["2"] > 1e-3 or TF["3"] > 1e-3


def test_fs_with_lag() -> None:
    task_ids = ["1", "2"]
    duration = {"1": 8.0, "2": 8.0}
    rels = [("1", "2", "FS", 4.0)]
    err, ES, EF, _, _, _, _, end, _ = compute_cpm(task_ids, duration, rels)
    assert err is None
    assert abs(ES["2"] - (EF["1"] + 4.0)) < 1e-2


def test_ss_relationship() -> None:
    task_ids = ["1", "2"]
    duration = {"1": 8.0, "2": 8.0}
    rels = [("1", "2", "SS", 2.0)]
    err, ES, _, _, _, _, _, _, _ = compute_cpm(task_ids, duration, rels)
    assert err is None
    assert ES["2"] >= ES["1"] + 2.0 - 1e-2


def test_sf_relationship() -> None:
    """SF: successor finish >= predecessor start + lag."""
    task_ids = ["1", "2"]
    duration = {"1": 0.0, "2": 8.0}
    rels = [("1", "2", "SF", 0.0)]
    err, ES, EF, _, _, _, _, _, _ = compute_cpm(task_ids, duration, rels)
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
    err, ES, EF, _, _, TF, _, _, _ = compute_cpm(task_ids, duration, rels)
    assert err is None
    assert abs(EF["2"] - ES["2"]) < 1e-6
