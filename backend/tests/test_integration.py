"""Integration smoke test: full import -> CPM -> diagnostics -> export workflow."""

import io
import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

SMOKE_XER = """%T\tPROJECT
%F\tproj_id\tproj_short_name
%R\tSMOKE\tSmokeTest
%T\tPROJWBS
%F\twbs_id\tproj_id\tparent_wbs_id\twbs_short_name\twbs_name\tseq_num
%R\tW1\tSMOKE\t\tPH1\tPhase 1\t1
%R\tW2\tSMOKE\t\tPH2\tPhase 2\t2
%T\tTASK
%F\ttask_id\tproj_id\ttask_name\ttarget_drtn_hr_cnt\twbs_id\tclndr_id\ttask_type
%R\t1\tSMOKE\tNotice to Proceed\t0.0\tW1\t\tTT_Mile
%R\t2\tSMOKE\tSite Prep\t40.0\tW1\t\t
%R\t3\tSMOKE\tFoundation\t80.0\tW1\t\t
%R\t4\tSMOKE\tFraming\t120.0\tW2\t\t
%R\t5\tSMOKE\tRoofing\t60.0\tW2\t\t
%R\t6\tSMOKE\tSubstantial Completion\t0.0\tW2\t\tTT_Mile
%T\tTASKPRED
%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt\tproj_id
%R\t1\t2\t1\tPR_FS\t0.0\tSMOKE
%R\t2\t3\t2\tPR_FS\t0.0\tSMOKE
%R\t3\t4\t3\tPR_FS\t0.0\tSMOKE
%R\t4\t5\t4\tPR_FS\t0.0\tSMOKE
%R\t5\t6\t5\tPR_FS\t0.0\tSMOKE
%E
"""


class TestFullWorkflow:
    def test_01_health(self):
        r = client.get("/api/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_02_import_xer(self):
        files = {"file": ("smoke.xer", io.BytesIO(SMOKE_XER.encode("utf-8")), "application/octet-stream")}
        r = client.post("/api/import", files=files)
        assert r.status_code == 200
        data = r.json()
        assert data["proj_id"] == "SMOKE"
        assert data["activities_count"] == 6
        assert data["relationships_count"] == 5
        assert data["wbs_count"] == 2

    def test_03_list_projects(self):
        r = client.get("/api/projects")
        assert r.status_code == 200
        projects = r.json()
        smoke = [p for p in projects if p["proj_id"] == "SMOKE"]
        assert len(smoke) == 1
        assert smoke[0]["activity_count"] == 6

    def test_04_run_cpm(self):
        r = client.post("/api/projects/SMOKE/cpm")
        assert r.status_code == 200
        cpm = r.json()
        assert cpm["cycle_error"] is None
        assert cpm["project_end_hrs"] > 0
        assert cpm["critical_count"] >= 4
        assert len(cpm["critical_path"]) >= 2

    def test_05_get_activities(self):
        r = client.get("/api/projects/SMOKE/activities")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] == 6
        items = data["items"]
        has_es = [a for a in items if a.get("early_start") is not None]
        assert len(has_es) == 6

    def test_06_get_activities_critical_only(self):
        r = client.get("/api/projects/SMOKE/activities?critical_only=true")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] >= 4

    def test_07_get_activities_search(self):
        r = client.get("/api/projects/SMOKE/activities?search=Foundation")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] >= 1
        assert any("Foundation" in a["name"] for a in data["items"])

    def test_08_get_relationships(self):
        r = client.get("/api/projects/SMOKE/relationships")
        assert r.status_code == 200
        rels = r.json()
        assert len(rels) == 5

    def test_09_get_wbs(self):
        r = client.get("/api/projects/SMOKE/wbs")
        assert r.status_code == 200
        wbs = r.json()
        assert len(wbs) == 2

    def test_10_diagnostics(self):
        r = client.get("/api/projects/SMOKE/diagnostics")
        assert r.status_code == 200
        diag = r.json()
        assert diag["summary"]["total_activities"] == 6
        assert "findings" in diag
        assert "dcma_checks" in diag

    def test_11_ai_suggestions(self):
        r = client.get("/api/ai/suggestions?proj_id=SMOKE")
        assert r.status_code == 200
        data = r.json()
        assert "suggestions" in data

    def test_12_ai_analysis(self):
        r = client.get("/api/ai/analysis?proj_id=SMOKE")
        assert r.status_code == 200
        analysis = r.json()
        assert "schedule_score" in analysis
        assert "critical_path_drivers" in analysis
        assert "relationship_density" in analysis

    def test_13_ai_auto_fixes(self):
        r = client.get("/api/ai/auto-fixes?proj_id=SMOKE")
        assert r.status_code == 200
        data = r.json()
        assert "fixes" in data
        assert "count" in data

    def test_14_save_baseline(self):
        r = client.post("/api/projects/SMOKE/baselines?name=Initial")
        assert r.status_code == 200
        bl = r.json()
        assert bl["baseline_number"] == 1
        assert bl["name"] == "Initial"

    def test_15_list_baselines(self):
        r = client.get("/api/projects/SMOKE/baselines")
        assert r.status_code == 200
        bls = r.json()
        assert len(bls) >= 1

    def test_16_compare_baseline(self):
        r = client.get("/api/projects/SMOKE/baselines/1/compare")
        assert r.status_code == 200
        comp = r.json()
        assert len(comp) == 6
        for c in comp:
            if c["start_variance"] is not None:
                assert abs(c["start_variance"]) < 0.01

    def test_17_export_xlsx(self):
        r = client.get("/api/projects/SMOKE/export/activities.xlsx")
        assert r.status_code == 200
        assert "spreadsheet" in r.headers.get("content-type", "")
        assert len(r.content) > 1000

    def test_18_export_csv(self):
        r = client.get("/api/projects/SMOKE/export/diagnostics.csv")
        assert r.status_code == 200
        assert "csv" in r.headers.get("content-type", "")
        lines = r.text.strip().split("\n")
        assert len(lines) >= 2

    def test_19_calendar_dates(self):
        r = client.get("/api/projects/SMOKE/calendar-dates")
        assert r.status_code == 200
        data = r.json()
        assert "dates" in data
        assert "using_default" in data

    def test_20_resources(self):
        r = client.get("/api/projects/SMOKE/resources")
        assert r.status_code == 200
        data = r.json()
        assert "resources" in data
        assert "assignments" in data

    def test_21_activity_codes(self):
        r = client.get("/api/projects/SMOKE/activity-codes")
        assert r.status_code == 200
        data = r.json()
        assert "types" in data
        assert "values" in data

    def test_22_create_activity(self):
        r = client.post("/api/ai/projects/SMOKE/activities", json={
            "task_id": "NEW1",
            "name": "Test Activity",
            "duration_hrs": 16,
        })
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_23_update_activity(self):
        r = client.put("/api/ai/projects/SMOKE/activities/NEW1", json={
            "name": "Updated Test Activity",
            "duration_hrs": 24,
        })
        assert r.status_code == 200

    def test_24_create_relationship(self):
        r = client.post("/api/ai/projects/SMOKE/relationships", json={
            "pred_id": "5",
            "succ_id": "NEW1",
            "rel_type": "FS",
            "lag_hrs": 0,
        })
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_25_rerun_cpm_after_changes(self):
        r = client.post("/api/projects/SMOKE/cpm")
        assert r.status_code == 200
        cpm = r.json()
        assert cpm["cycle_error"] is None
        assert cpm["total_count"] == 7

    def test_26_delete_activity(self):
        r = client.delete("/api/ai/projects/SMOKE/activities/NEW1")
        assert r.status_code == 200

    def test_27_delete_baseline(self):
        r = client.delete("/api/projects/SMOKE/baselines/1")
        assert r.status_code == 200

    def test_28_delete_project(self):
        r = client.delete("/api/projects/SMOKE")
        assert r.status_code == 200

    def test_29_verify_deleted(self):
        r = client.get("/api/projects/SMOKE/activities")
        assert r.status_code == 404

    def test_30_404_on_missing_project(self):
        r = client.get("/api/projects/NONEXISTENT/activities")
        assert r.status_code == 404
        r = client.post("/api/projects/NONEXISTENT/cpm")
        assert r.status_code == 404
