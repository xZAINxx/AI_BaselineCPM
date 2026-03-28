"""
FastAPI routes: AI chat, rule-based suggestions, and schedule CRUD for AI actions.
"""

from __future__ import annotations

from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ai_engine import (
    analyze_schedule_network,
    apply_actions,
    build_schedule_context,
    chat_with_claude,
    extract_json_object,
    generate_auto_fixes,
    generate_fix_suggestions,
)
from cpm_engine import run_cpm_for_project_rows
from deps import fetch_activities, fetch_relationships, get_db
from diagnostics import run_diagnostics

router = APIRouter(prefix="/api/ai", tags=["ai"])


class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    proj_id: str
    messages: List[ChatMessage] = Field(default_factory=list)
    auto_apply: bool = False
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    reply: str
    actions_preview: Optional[List[dict]] = None
    actions_applied: Optional[List[str]] = None
    cpm_error: Optional[str] = None
    needs_api_key: bool = False
    error: Optional[str] = None


class ActivityCreate(BaseModel):
    task_id: str
    name: str = ""
    duration_hrs: float = 0
    wbs_id: Optional[str] = None
    calendar_id: Optional[str] = None
    is_milestone: int = 0


class ActivityUpdate(BaseModel):
    name: Optional[str] = None
    duration_hrs: Optional[float] = None
    wbs_id: Optional[str] = None
    calendar_id: Optional[str] = None
    is_milestone: Optional[int] = None
    actual_start: Optional[float] = None
    actual_finish: Optional[float] = None
    remaining_duration_hrs: Optional[float] = None
    percent_complete: Optional[float] = None


class RelationshipCreate(BaseModel):
    pred_id: str
    succ_id: str
    rel_type: str = "FS"
    lag_hrs: float = 0


def _persist_cpm(conn: Any, proj_id: str) -> Optional[str]:
    """Recompute CPM and write results. Returns cycle error string or None."""
    acts = fetch_activities(conn, proj_id)
    rels = fetch_relationships(conn, proj_id)
    err, results, _proj_end, _path = run_cpm_for_project_rows(acts, rels)
    if err:
        return err
    for tid, vals in results.items():
        conn.execute(
            """UPDATE activities SET
               early_start = ?, early_finish = ?, late_start = ?, late_finish = ?,
               total_float_hrs = ?, free_float_hrs = ?, is_critical = ?, is_near_critical = ?
               WHERE proj_id = ? AND task_id = ?""",
            (
                vals["early_start"],
                vals["early_finish"],
                vals["late_start"],
                vals["late_finish"],
                vals["total_float_hrs"],
                vals["free_float_hrs"],
                vals["is_critical"],
                vals["is_near_critical"],
                proj_id,
                tid,
            ),
        )
    conn.commit()
    return None


@router.post("/chat", response_model=ChatResponse)
def ai_chat(body: ChatRequest) -> ChatResponse:
    """Chat with Claude; optionally apply returned actions and re-run CPM."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM projects WHERE proj_id = ?", (body.proj_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Project not found")

        acts = fetch_activities(conn, body.proj_id)
        rels = fetch_relationships(conn, body.proj_id)
        diag = run_diagnostics(body.proj_id, acts, rels)
        summary = diag.summary.model_dump() if diag.summary else {}

        ctx = build_schedule_context(body.proj_id, acts, rels, summary)
        msgs = [m.model_dump() for m in body.messages]

        try:
            reply_text, parsed = chat_with_claude(msgs, ctx, session_id=body.session_id)
        except RuntimeError:
            return ChatResponse(
                reply="Set ANTHROPIC_API_KEY in backend/.env and restart the server.",
                needs_api_key=True,
            )
        except Exception as e:
            return ChatResponse(reply="", error=str(e))

        actions: List[dict] = []
        if isinstance(parsed, dict) and isinstance(parsed.get("actions"), list):
            actions = parsed["actions"]
        reply = reply_text
        if isinstance(parsed, dict) and parsed.get("reply"):
            reply = str(parsed["reply"])

        applied: Optional[List[str]] = None
        cpm_err: Optional[str] = None
        if body.auto_apply and actions:
            try:
                applied = apply_actions(conn, body.proj_id, actions)
                cpm_err = _persist_cpm(conn, body.proj_id)
            except ValueError as e:
                raise HTTPException(400, str(e)) from e

        return ChatResponse(
            reply=reply,
            actions_preview=actions or None,
            actions_applied=applied,
            cpm_error=cpm_err,
        )
    finally:
        conn.close()


@router.get("/suggestions")
def ai_suggestions(proj_id: str) -> dict:
    """Rule-based fix suggestions (no API key required)."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM projects WHERE proj_id = ?", (proj_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Project not found")
        acts = fetch_activities(conn, proj_id)
        rels = fetch_relationships(conn, proj_id)
        diag = run_diagnostics(proj_id, acts, rels)
        sug = generate_fix_suggestions(proj_id, acts, rels, diag)
        return {"suggestions": sug}
    finally:
        conn.close()


@router.get("/analysis")
def ai_analysis(proj_id: str) -> dict:
    """
    Structured schedule network analysis (no API key required).

    Returns critical path drivers, float consumption risks, logic gaps,
    relationship density, and overall schedule score.
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM projects WHERE proj_id = ?", (proj_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Project not found")
        acts = fetch_activities(conn, proj_id)
        rels = fetch_relationships(conn, proj_id)
        diag = run_diagnostics(proj_id, acts, rels)
        analysis = analyze_schedule_network(proj_id, acts, rels, diag)
        return analysis
    finally:
        conn.close()


class ApplyActionsRequest(BaseModel):
    proj_id: str
    actions: List[dict]


class ApplyActionsResponse(BaseModel):
    applied: List[str] = Field(default_factory=list)
    cpm_error: Optional[str] = None
    error: Optional[str] = None


@router.post("/apply", response_model=ApplyActionsResponse)
def apply_actions_endpoint(body: ApplyActionsRequest) -> ApplyActionsResponse:
    """Apply a list of schedule actions and re-run CPM."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM projects WHERE proj_id = ?", (body.proj_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Project not found")
        try:
            log = apply_actions(conn, body.proj_id, body.actions)
            cpm_err = _persist_cpm(conn, body.proj_id)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        return ApplyActionsResponse(applied=log, cpm_error=cpm_err)
    finally:
        conn.close()


@router.get("/auto-fixes")
def get_auto_fixes(proj_id: str) -> dict:
    """Rule-based concrete fix actions (no API key required)."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM projects WHERE proj_id = ?", (proj_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Project not found")
        acts = fetch_activities(conn, proj_id)
        rels = fetch_relationships(conn, proj_id)
        fixes = generate_auto_fixes(proj_id, acts, rels)
        return {"fixes": fixes, "count": len(fixes)}
    finally:
        conn.close()


# --- CRUD used by AI actions and manual API ---


@router.post("/projects/{proj_id}/activities")
def create_activity(proj_id: str, body: ActivityCreate) -> dict:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM projects WHERE proj_id = ?", (proj_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Project not found")
        cur.execute(
            """INSERT INTO activities (
                task_id, proj_id, name, duration_hrs, wbs_id, calendar_id, is_milestone,
                constraint_type, constraint_date,
                early_start, early_finish, late_start, late_finish, total_float_hrs,
                free_float_hrs, is_critical
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0)""",
            (
                body.task_id,
                proj_id,
                body.name,
                body.duration_hrs,
                body.wbs_id,
                body.calendar_id,
                body.is_milestone,
            ),
        )
        conn.commit()
        return {"ok": True, "task_id": body.task_id}
    except Exception as e:
        if "UNIQUE" in str(e).upper():
            raise HTTPException(409, "task_id already exists") from e
        raise HTTPException(400, str(e)) from e
    finally:
        conn.close()


@router.put("/projects/{proj_id}/activities/{task_id}")
def update_activity(proj_id: str, task_id: str, body: ActivityUpdate) -> dict:
    conn = get_db()
    try:
        cur = conn.cursor()
        fields = body.model_dump(exclude_unset=True)
        if not fields:
            raise HTTPException(400, "No fields to update")
        sets = []
        vals: List[Any] = []
        for k, v in fields.items():
            sets.append(f"{k} = ?")
            vals.append(v)
        vals.extend([proj_id, task_id])
        cur.execute(
            f"UPDATE activities SET {', '.join(sets)} WHERE proj_id = ? AND task_id = ?",
            vals,
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Activity not found")
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@router.delete("/projects/{proj_id}/activities/{task_id}")
def delete_activity(proj_id: str, task_id: str) -> dict:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM relationships WHERE proj_id = ? AND (pred_id = ? OR succ_id = ?)",
            (proj_id, task_id, task_id),
        )
        cur.execute("DELETE FROM activities WHERE proj_id = ? AND task_id = ?", (proj_id, task_id))
        if cur.rowcount == 0:
            raise HTTPException(404, "Activity not found")
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@router.post("/projects/{proj_id}/relationships")
def create_relationship(proj_id: str, body: RelationshipCreate) -> dict:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM projects WHERE proj_id = ?", (proj_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Project not found")
        rt = body.rel_type.upper()[:2]
        if rt not in ("FS", "SS", "FF", "SF"):
            rt = "FS"
        cur.execute(
            """INSERT INTO relationships (proj_id, pred_id, succ_id, rel_type, lag_hrs)
               VALUES (?, ?, ?, ?, ?)""",
            (proj_id, body.pred_id, body.succ_id, rt, body.lag_hrs),
        )
        conn.commit()
        return {"ok": True, "id": cur.lastrowid}
    finally:
        conn.close()


@router.delete("/projects/{proj_id}/relationships/{rel_id}")
def delete_relationship(proj_id: str, rel_id: int) -> dict:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM relationships WHERE proj_id = ? AND id = ?", (proj_id, rel_id))
        if cur.rowcount == 0:
            raise HTTPException(404, "Relationship not found")
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()
