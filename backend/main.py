"""FastAPI application: XER import, CPM, diagnostics, exports."""

from __future__ import annotations

import csv

from dotenv import load_dotenv

load_dotenv()
import io
from typing import Any, List, Optional

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from openpyxl import Workbook

from ai_routes import router as ai_router
from cpm_engine import run_cpm_for_project_rows
from database import DEFAULT_DB_PATH, get_connection, init_db
from deps import get_db
from diagnostics import run_diagnostics
from models import (
    ActivitiesPage,
    ActivityRow,
    CpmResult,
    DiagnosticsResult,
    ImportResult,
    ProjectSummary,
    RelationshipRow,
)
from xer_parser import import_xer_to_sqlite

app = FastAPI(title="Primavera P6 XER Local Analyzer", version="1.0.0")

app.include_router(ai_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    """Ensure schema exists on process start."""
    conn = get_connection(DEFAULT_DB_PATH)
    init_db(conn)
    conn.close()


@app.post("/api/import", response_model=ImportResult)
async def import_xer(file: UploadFile = File(...)) -> ImportResult:
    if not file.filename or not file.filename.lower().endswith(".xer"):
        raise HTTPException(400, "Upload a .xer file")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    conn = get_db()
    try:
        summary = import_xer_to_sqlite(conn, data, filename=file.filename)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    finally:
        conn.close()
    return ImportResult(
        proj_id=summary["proj_id"],
        name=summary["name"],
        activities_count=summary["activities_count"],
        relationships_count=summary["relationships_count"],
        calendars_count=summary.get("calendars_count", 0),
    )


@app.get("/api/projects", response_model=List[ProjectSummary])
def list_projects() -> List[ProjectSummary]:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT p.proj_id, p.name, p.imported_at,
               (SELECT COUNT(*) FROM activities a WHERE a.proj_id = p.proj_id),
               (SELECT COUNT(*) FROM relationships r WHERE r.proj_id = p.proj_id)
               FROM projects p ORDER BY p.imported_at DESC"""
        )
        rows = cur.fetchall()
        return [
            ProjectSummary(
                proj_id=r[0],
                name=r[1],
                imported_at=r[2],
                activity_count=r[3],
                relationship_count=r[4],
            )
            for r in rows
        ]
    finally:
        conn.close()


def _fetch_activities(conn: Any, proj_id: str) -> List[dict]:
    cur = conn.cursor()
    cur.execute(
        """SELECT proj_id, task_id, name, duration_hrs, wbs_id, calendar_id,
           early_start, early_finish, late_start, late_finish, total_float_hrs,
           is_critical, is_milestone FROM activities WHERE proj_id = ? ORDER BY task_id""",
        (proj_id,),
    )
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def _fetch_relationships(conn: Any, proj_id: str) -> List[dict]:
    cur = conn.cursor()
    cur.execute(
        """SELECT id, pred_id, succ_id, rel_type, lag_hrs
           FROM relationships WHERE proj_id = ?""",
        (proj_id,),
    )
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def _sort_activities(
    items: List[ActivityRow],
    sort_by: Optional[str],
    sort_dir: str,
) -> List[ActivityRow]:
    if not sort_by:
        return items
    rev = sort_dir.lower() == "desc"
    key_map = {
        "task_id": lambda x: x.task_id,
        "name": lambda x: (x.name or "").lower(),
        "duration_hrs": lambda x: x.duration_hrs,
        "early_start": lambda x: x.early_start if x.early_start is not None else -1e30,
        "early_finish": lambda x: x.early_finish if x.early_finish is not None else -1e30,
        "late_start": lambda x: x.late_start if x.late_start is not None else -1e30,
        "late_finish": lambda x: x.late_finish if x.late_finish is not None else -1e30,
        "total_float_hrs": lambda x: x.total_float_hrs if x.total_float_hrs is not None else -1e30,
    }
    fn = key_map.get(sort_by, key_map["task_id"])
    return sorted(items, key=fn, reverse=rev)


@app.get("/api/projects/{proj_id}/activities", response_model=ActivitiesPage)
def get_activities(
    proj_id: str,
    search: Optional[str] = None,
    critical_only: bool = False,
    sort_by: Optional[str] = None,
    sort_dir: str = "asc",
) -> ActivitiesPage:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM projects WHERE proj_id = ?", (proj_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Project not found")
        rows = _fetch_activities(conn, proj_id)
    finally:
        conn.close()

    if sort_dir not in ("asc", "desc"):
        sort_dir = "asc"

    items: List[ActivityRow] = []
    for r in rows:
        if critical_only and not int(r.get("is_critical") or 0):
            continue
        if search:
            s = search.lower()
            if s not in (r.get("name") or "").lower() and s not in str(r.get("task_id")):
                continue
        items.append(
            ActivityRow(
                proj_id=r["proj_id"],
                task_id=str(r["task_id"]),
                name=r.get("name") or "",
                duration_hrs=float(r.get("duration_hrs") or 0),
                wbs_id=r.get("wbs_id"),
                calendar_id=r.get("calendar_id"),
                early_start=r.get("early_start"),
                early_finish=r.get("early_finish"),
                late_start=r.get("late_start"),
                late_finish=r.get("late_finish"),
                total_float_hrs=r.get("total_float_hrs"),
                is_critical=bool(int(r.get("is_critical") or 0)),
                is_milestone=bool(int(r.get("is_milestone") or 0)),
            )
        )
    items = _sort_activities(items, sort_by, sort_dir)
    return ActivitiesPage(items=items, total=len(items))


@app.get("/api/projects/{proj_id}/relationships", response_model=List[RelationshipRow])
def get_relationships(proj_id: str) -> List[RelationshipRow]:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM projects WHERE proj_id = ?", (proj_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Project not found")
        raw = _fetch_relationships(conn, proj_id)
    finally:
        conn.close()
    return [
        RelationshipRow(
            id=int(r["id"]),
            pred_id=str(r["pred_id"]),
            succ_id=str(r["succ_id"]),
            rel_type=str(r["rel_type"]),
            lag_hrs=float(r.get("lag_hrs") or 0),
        )
        for r in raw
    ]


@app.post("/api/projects/{proj_id}/cpm", response_model=CpmResult)
def run_cpm(proj_id: str) -> CpmResult:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM projects WHERE proj_id = ?", (proj_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Project not found")
        acts = _fetch_activities(conn, proj_id)
        rels = _fetch_relationships(conn, proj_id)
        err, results, proj_end, critical_path = run_cpm_for_project_rows(acts, rels)
        if err:
            return CpmResult(
                proj_id=proj_id,
                project_end_hrs=0.0,
                critical_count=0,
                total_count=0,
                critical_path=[],
                cycle_error=err,
            )
        crit_ct = sum(1 for v in results.values() if v.get("is_critical"))
        for tid, vals in results.items():
            conn.execute(
                """UPDATE activities SET
                   early_start = ?, early_finish = ?, late_start = ?, late_finish = ?,
                   total_float_hrs = ?, is_critical = ?
                   WHERE proj_id = ? AND task_id = ?""",
                (
                    vals["early_start"],
                    vals["early_finish"],
                    vals["late_start"],
                    vals["late_finish"],
                    vals["total_float_hrs"],
                    vals["is_critical"],
                    proj_id,
                    tid,
                ),
            )
        conn.commit()
        return CpmResult(
            proj_id=proj_id,
            project_end_hrs=proj_end,
            critical_count=crit_ct,
            total_count=len(results),
            critical_path=critical_path,
            cycle_error=None,
        )
    finally:
        conn.close()


@app.get("/api/projects/{proj_id}/diagnostics", response_model=DiagnosticsResult)
def get_diagnostics(
    proj_id: str,
    hours_per_day: float = Query(8.0, ge=0.1, le=24.0),
) -> DiagnosticsResult:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM projects WHERE proj_id = ?", (proj_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Project not found")
        acts = _fetch_activities(conn, proj_id)
        rels = _fetch_relationships(conn, proj_id)
    finally:
        conn.close()
    return run_diagnostics(proj_id, acts, rels, hours_per_day=hours_per_day)


@app.get("/api/projects/{proj_id}/export/activities.xlsx")
def export_activities_xlsx(proj_id: str) -> Response:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM projects WHERE proj_id = ?", (proj_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Project not found")
        acts = _fetch_activities(conn, proj_id)
    finally:
        conn.close()

    wb = Workbook()
    ws = wb.active
    ws.title = "Activities"
    headers = [
        "task_id",
        "name",
        "duration_hrs",
        "early_start",
        "early_finish",
        "late_start",
        "late_finish",
        "total_float_hrs",
        "is_critical",
        "is_milestone",
    ]
    ws.append(headers)
    for a in acts:
        ws.append(
            [
                a["task_id"],
                a.get("name"),
                a.get("duration_hrs"),
                a.get("early_start"),
                a.get("early_finish"),
                a.get("late_start"),
                a.get("late_finish"),
                a.get("total_float_hrs"),
                int(a.get("is_critical") or 0),
                int(a.get("is_milestone") or 0),
            ]
        )
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{proj_id}_activities.xlsx"'},
    )


@app.get("/api/projects/{proj_id}/export/diagnostics.csv")
def export_diagnostics_csv(
    proj_id: str,
    hours_per_day: float = Query(8.0, ge=0.1, le=24.0),
) -> Response:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM projects WHERE proj_id = ?", (proj_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Project not found")
        acts = _fetch_activities(conn, proj_id)
        rels = _fetch_relationships(conn, proj_id)
    finally:
        conn.close()

    rep = run_diagnostics(proj_id, acts, rels, hours_per_day=hours_per_day)

    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["check", "severity", "task_id", "message"])
    w.writerow(
        [
            "summary",
            "info",
            "",
            f"total={rep.summary.total_activities}, critical_pct={rep.summary.critical_pct}, "
            f"open_starts={rep.summary.open_starts}, open_ends={rep.summary.open_ends}",
        ]
    )
    for f in rep.findings:
        w.writerow([f.check, f.severity, f.task_id or "", f.message])
    return Response(
        content=out.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{proj_id}_diagnostics.csv"'},
    )


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
