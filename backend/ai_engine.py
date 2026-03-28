"""
Anthropic-powered schedule assistant and rule-based fix suggestions.

Builds CPM-aware context from SQLite, calls Claude when ``ANTHROPIC_API_KEY`` is set,
and parses structured JSON actions (add/modify/delete activities and relationships).
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List, Optional, Tuple

# Optional: only imported when calling the API
_anthropic = None


def _client():
    global _anthropic
    if _anthropic is None:
        import anthropic

        _anthropic = anthropic
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set in the environment.")
    return _anthropic.Anthropic(api_key=key)


SYSTEM_PROMPT = """You are an expert Primavera P6 / construction scheduling assistant working with a local SQLite schedule.

The user sees activities (task_id, name, duration_hrs, CPM early/late times in hours) and relationships (pred_id, succ_id, rel_type FS/SS/FF/SF, lag_hrs).

When the user asks to change the schedule, respond with a single JSON object ONLY (no markdown fences) in this exact shape:
{
  "reply": "short natural language summary for the user",
  "actions": [
    { "op": "add_activity", "task_id": "string", "name": "string", "duration_hrs": number, "is_milestone": 0 or 1, "wbs_id": null or string, "calendar_id": null or string },
    { "op": "modify_activity", "task_id": "string", "fields": { "name": "...", "duration_hrs": 8 } },
    { "op": "delete_activity", "task_id": "string" },
    { "op": "add_relationship", "pred_id": "string", "succ_id": "string", "rel_type": "FS", "lag_hrs": 0 },
    { "op": "delete_relationship", "id": number }
  ]
}

Rules:
- Use only task_ids that exist for modify/delete, or new unique task_ids for add.
- For relationships, pred_id and succ_id must be existing task_ids after adds (order: add activities first if needed).
- Keep actions minimal and safe; if unsure, return empty actions and explain in "reply".
- Durations are in work hours (same as P6 target_drtn_hr_cnt style).
"""


def build_schedule_context(
    proj_id: str,
    activities: List[dict],
    relationships: List[dict],
    diagnostics_summary: Optional[dict],
) -> str:
    """Compact text block for the model."""
    lines = [f"project_id: {proj_id}", f"activity_count: {len(activities)}", f"relationship_count: {len(relationships)}"]
    if diagnostics_summary:
        lines.append("diagnostics_summary: " + json.dumps(diagnostics_summary, ensure_ascii=False))
    lines.append("\nactivities (sample up to 80):")
    for a in activities[:80]:
        lines.append(
            json.dumps(
                {
                    "task_id": a.get("task_id"),
                    "name": a.get("name"),
                    "duration_hrs": a.get("duration_hrs"),
                    "is_milestone": a.get("is_milestone"),
                    "early_start": a.get("early_start"),
                    "early_finish": a.get("early_finish"),
                    "total_float_hrs": a.get("total_float_hrs"),
                    "is_critical": a.get("is_critical"),
                },
                ensure_ascii=False,
            )
        )
    if len(activities) > 80:
        lines.append(f"... ({len(activities) - 80} more activities omitted)")
    lines.append("\nrelationships (sample up to 120):")
    for r in relationships[:120]:
        lines.append(
            json.dumps(
                {
                    "id": r.get("id"),
                    "pred_id": r.get("pred_id"),
                    "succ_id": r.get("succ_id"),
                    "rel_type": r.get("rel_type"),
                    "lag_hrs": r.get("lag_hrs"),
                },
                ensure_ascii=False,
            )
        )
    if len(relationships) > 120:
        lines.append(f"... ({len(relationships) - 120} more relationships omitted)")
    return "\n".join(lines)


def extract_json_object(text: str) -> Optional[dict]:
    """Parse first JSON object from model output (strip markdown fences if present)."""
    t = text.strip()
    if "```" in t:
        m = re.search(r"```(?:json)?\s*([\s\S]*?)```", t)
        if m:
            t = m.group(1).strip()
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        pass
    i = t.find("{")
    j = t.rfind("}")
    if i >= 0 and j > i:
        try:
            return json.loads(t[i : j + 1])
        except json.JSONDecodeError:
            return None
    return None


def chat_with_claude(
    user_messages: List[dict],
    schedule_context: str,
) -> Tuple[str, Optional[dict]]:
    """
    Send conversation + schedule context to Claude Sonnet.

    Returns (assistant_text, parsed_actions_dict or None).
    ``user_messages`` items: ``{"role": "user"|"assistant", "content": str}``.
    """
    model = os.environ.get("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
    client = _client()
    content_parts = [
        "Current schedule context (read-only for reasoning):\n" + schedule_context + "\n\n",
    ]
    for m in user_messages[-24:]:
        role = m.get("role", "user")
        c = m.get("content", "")
        if role == "user":
            content_parts.append(f"User: {c}\n")
        else:
            content_parts.append(f"Assistant: {c}\n")
    user_block = "".join(content_parts) + "\nRespond with the JSON schema described in your instructions."

    msg = client.messages.create(
        model=model,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_block}],
    )
    text = ""
    for block in msg.content:
        if hasattr(block, "text"):
            text += block.text
    parsed = extract_json_object(text)
    if parsed and "reply" in parsed:
        reply = str(parsed.get("reply", ""))
        return reply, parsed
    return text, parsed


def apply_actions(conn: Any, proj_id: str, actions: List[dict]) -> List[str]:
    """
    Apply structured actions in order. Returns log lines for each step.

    Raises ValueError on invalid data.
    """
    cur = conn.cursor()
    log: List[str] = []
    cur.execute("SELECT 1 FROM projects WHERE proj_id = ?", (proj_id,))
    if not cur.fetchone():
        raise ValueError("Project not found")

    for raw in actions:
        op = (raw.get("op") or "").lower()
        if op == "add_activity":
            tid = str(raw.get("task_id", "")).strip()
            if not tid:
                raise ValueError("add_activity missing task_id")
            name = str(raw.get("name") or f"Task {tid}")
            dur = float(raw.get("duration_hrs") or 0)
            is_ms = int(raw.get("is_milestone") or (1 if dur <= 0 else 0))
            wbs = raw.get("wbs_id")
            cal = raw.get("calendar_id")
            cur.execute(
                """INSERT INTO activities (
                    task_id, proj_id, name, duration_hrs, wbs_id, calendar_id, is_milestone,
                    early_start, early_finish, late_start, late_finish, total_float_hrs, is_critical
                ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, 0)""",
                (tid, proj_id, name, dur, wbs, cal, is_ms),
            )
            log.append(f"add_activity {tid}")
        elif op == "modify_activity":
            tid = str(raw.get("task_id", "")).strip()
            fields = raw.get("fields") or {}
            if not tid:
                raise ValueError("modify_activity missing task_id")
            allowed = {"name", "duration_hrs", "wbs_id", "calendar_id", "is_milestone"}
            sets = []
            vals: List[Any] = []
            for k, v in fields.items():
                if k not in allowed:
                    continue
                if k == "duration_hrs":
                    sets.append("duration_hrs = ?")
                    vals.append(float(v))
                elif k == "is_milestone":
                    sets.append("is_milestone = ?")
                    vals.append(int(v))
                else:
                    sets.append(f"{k} = ?")
                    vals.append(v)
            if not sets:
                continue
            vals.extend([proj_id, tid])
            cur.execute(
                f"UPDATE activities SET {', '.join(sets)} WHERE proj_id = ? AND task_id = ?",
                vals,
            )
            log.append(f"modify_activity {tid}")
        elif op == "delete_activity":
            tid = str(raw.get("task_id", "")).strip()
            if not tid:
                raise ValueError("delete_activity missing task_id")
            cur.execute("DELETE FROM relationships WHERE proj_id = ? AND (pred_id = ? OR succ_id = ?)", (proj_id, tid, tid))
            cur.execute("DELETE FROM activities WHERE proj_id = ? AND task_id = ?", (proj_id, tid))
            log.append(f"delete_activity {tid}")
        elif op == "add_relationship":
            pred = str(raw.get("pred_id", "")).strip()
            succ = str(raw.get("succ_id", "")).strip()
            rt = str(raw.get("rel_type") or "FS").upper()[:2]
            if rt not in ("FS", "SS", "FF", "SF"):
                rt = "FS"
            lag = float(raw.get("lag_hrs") or 0)
            if not pred or not succ:
                raise ValueError("add_relationship missing pred_id or succ_id")
            cur.execute(
                """INSERT INTO relationships (proj_id, pred_id, succ_id, rel_type, lag_hrs)
                   VALUES (?, ?, ?, ?, ?)""",
                (proj_id, pred, succ, rt, lag),
            )
            log.append(f"add_relationship {pred}->{succ}")
        elif op == "delete_relationship":
            rid = raw.get("id")
            if rid is None:
                raise ValueError("delete_relationship missing id")
            cur.execute("DELETE FROM relationships WHERE proj_id = ? AND id = ?", (proj_id, int(rid)))
            log.append(f"delete_relationship id={rid}")
        else:
            log.append(f"skip unknown op: {op}")

    conn.commit()
    return log


def generate_fix_suggestions(
    proj_id: str,
    activities: List[dict],
    relationships: List[dict],
    diagnostics: Any,
) -> List[dict]:
    """
    Rule-based suggestions without API calls.

    Returns list of dicts: title, detail, prompt (for chat), severity, task_id (optional).
    """
    suggestions: List[dict] = []
    if not diagnostics:
        return suggestions

    summary = getattr(diagnostics, "summary", None)
    findings = getattr(diagnostics, "findings", []) or []

    if summary:
        if summary.open_starts > 0:
            suggestions.append(
                {
                    "id": "open-starts",
                    "title": "Tie down open starts",
                    "detail": f"{summary.open_starts} activities have no predecessors. Add a project start milestone or predecessor links.",
                    "prompt": f"In project {proj_id}, suggest minimal predecessor relationships to reduce open-start activities. Prefer linking to a single project start task if appropriate. Output JSON actions only.",
                    "severity": "warning",
                }
            )
        if summary.open_ends > 0:
            suggestions.append(
                {
                    "id": "open-ends",
                    "title": "Close open ends",
                    "detail": f"{summary.open_ends} activities have no successors. Link to a project completion milestone or endpoint.",
                    "prompt": f"In project {proj_id}, suggest successors or a finish milestone for activities with no successors. Output JSON actions only.",
                    "severity": "warning",
                }
            )
        if summary.critical_pct > 30:
            suggestions.append(
                {
                    "id": "high-critical",
                    "title": "High critical density",
                    "detail": f"{summary.critical_pct:.1f}% of activities are critical. Review parallel paths and durations.",
                    "prompt": f"Review project {proj_id} for ways to reduce critical path density (conceptual — suggest actions only if clearly justified). Output JSON actions only.",
                    "severity": "info",
                }
            )

    for f in findings[:20]:
        chk = getattr(f, "check", "") or ""
        tid = getattr(f, "task_id", None)
        msg = getattr(f, "message", "")
        if chk == "no_predecessors" and tid:
            suggestions.append(
                {
                    "id": f"fix-pred-{tid}",
                    "title": f"Add predecessor for task {tid}",
                    "detail": msg,
                    "prompt": f"Suggest one predecessor relationship for task_id {tid} in project {proj_id} that fits typical construction logic. Output JSON actions only.",
                    "severity": "warning",
                    "task_id": str(tid),
                }
            )
        elif chk == "no_successors" and tid:
            suggestions.append(
                {
                    "id": f"fix-succ-{tid}",
                    "title": f"Add successor for task {tid}",
                    "detail": msg,
                    "prompt": f"Suggest one successor relationship for task_id {tid} in project {proj_id}. Output JSON actions only.",
                    "severity": "warning",
                    "task_id": str(tid),
                }
            )

    return suggestions[:50]
