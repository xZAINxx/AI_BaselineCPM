"""Edge case tests for robustness."""

import io
from fastapi.testclient import TestClient
from main import app
from cpm_engine import compute_cpm
from diagnostics import run_diagnostics

client = TestClient(app)


def test_cpm_single_activity():
    err, ES, EF, LS, LF, TF, FF, crit, nc, end, path = compute_cpm(
        ["A"], {"A": 8.0}, []
    )
    assert err is None
    assert abs(end - 8.0) < 0.01
    assert crit["A"]


def test_cpm_all_milestones():
    err, ES, EF, LS, LF, TF, FF, crit, nc, end, path = compute_cpm(
        ["M1", "M2", "M3"],
        {"M1": 0, "M2": 0, "M3": 0},
        [("M1", "M2", "FS", 0), ("M2", "M3", "FS", 0)],
    )
    assert err is None
    assert abs(end - 0.0) < 0.01


def test_cpm_empty_schedule():
    err, ES, EF, LS, LF, TF, FF, crit, nc, end, path = compute_cpm([], {}, [])
    assert err is None
    assert end == 0.0


def test_cpm_disconnected_graph():
    err, ES, EF, LS, LF, TF, FF, crit, nc, end, path = compute_cpm(
        ["A", "B", "C", "D"],
        {"A": 8, "B": 16, "C": 8, "D": 8},
        [("A", "B", "FS", 0), ("C", "D", "FS", 0)],
    )
    assert err is None
    assert abs(end - 24.0) < 0.01


def test_cpm_ff_relationship():
    err, ES, EF, LS, LF, TF, FF, crit, nc, end, path = compute_cpm(
        ["A", "B"],
        {"A": 16, "B": 8},
        [("A", "B", "FF", 0)],
    )
    assert err is None
    assert EF["B"] >= EF["A"] - 0.01


def test_cpm_combined_ss_fs():
    err, ES, EF, LS, LF, TF, FF, crit, nc, end, path = compute_cpm(
        ["A", "B", "C"],
        {"A": 16, "B": 8, "C": 8},
        [("A", "C", "SS", 4), ("B", "C", "FS", 0)],
    )
    assert err is None
    assert ES["C"] >= 4.0 - 0.01
    assert ES["C"] >= 8.0 - 0.01


def test_cpm_negative_lag():
    err, ES, EF, LS, LF, TF, FF, crit, nc, end, path = compute_cpm(
        ["A", "B"],
        {"A": 16, "B": 8},
        [("A", "B", "FS", -4)],
    )
    assert err is None
    assert abs(ES["B"] - 12.0) < 0.01


def test_diagnostics_empty():
    r = run_diagnostics("P1", [], [])
    assert r.summary.total_activities == 0
    assert len(r.findings) == 0


def test_diagnostics_single_milestone():
    acts = [{"task_id": "M", "duration_hrs": 0, "is_milestone": 1, "is_critical": 0,
             "total_float_hrs": 0, "early_start": 0, "early_finish": 0,
             "is_near_critical": 0, "constraint_type": None}]
    r = run_diagnostics("P1", acts, [])
    assert r.summary.open_starts == 0
    assert r.summary.open_ends == 0


def test_import_non_xer():
    files = {"file": ("test.txt", io.BytesIO(b"hello"), "text/plain")}
    r = client.post("/api/import", files=files)
    assert r.status_code == 400


def test_import_empty_file():
    files = {"file": ("empty.xer", io.BytesIO(b""), "application/octet-stream")}
    r = client.post("/api/import", files=files)
    assert r.status_code == 400


def test_cpm_nonexistent_project():
    r = client.post("/api/projects/DOESNOTEXIST/cpm")
    assert r.status_code == 404


def test_activities_nonexistent_project():
    r = client.get("/api/projects/DOESNOTEXIST/activities")
    assert r.status_code == 404
