"""
Anthropic-powered schedule assistant and rule-based fix suggestions.

Builds CPM-aware context from SQLite, calls Claude when ``ANTHROPIC_API_KEY`` is set,
and parses structured JSON actions (add/modify/delete activities and relationships).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple

from constants import NEAR_CRIT_THRESHOLD

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


# ---------------------------------------------------------------------------
# In-memory conversation session cache
# ---------------------------------------------------------------------------
_sessions: Dict[str, dict] = {}
_sessions_lock = Lock()
_SESSION_TTL = 1800  # 30 minutes


def _cleanup_sessions() -> None:
    """Remove expired sessions."""
    now = time.time()
    with _sessions_lock:
        expired = [k for k, v in _sessions.items() if now - v.get("last_access", 0) > _SESSION_TTL]
        for k in expired:
            del _sessions[k]


def _context_hash(context: str) -> str:
    """Quick hash to detect if schedule data changed."""
    return hashlib.md5(context.encode()).hexdigest()[:12]


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
    compact: bool = False,
) -> str:
    """Compact text block for the model. If *compact*, only send summary stats."""
    lines = [f"project_id: {proj_id}", f"activity_count: {len(activities)}", f"relationship_count: {len(relationships)}"]
    if diagnostics_summary:
        lines.append("diagnostics_summary: " + json.dumps(diagnostics_summary, ensure_ascii=False))

    if compact:
        critical = sum(1 for a in activities if int(a.get("is_critical") or 0))
        lines.append(f"critical_count: {critical}")
        lines.append(
            f"critical_pct: {critical / len(activities) * 100:.1f}%" if activities else "critical_pct: 0%"
        )
        lines.append("(Full activity and relationship data was provided in the initial message of this session.)")
        return "\n".join(lines)

    critical_activities = sorted(
        [a for a in activities if a.get("is_critical")],
        key=lambda x: float(x.get("duration_hrs") or 0),
        reverse=True,
    )
    if critical_activities:
        lines.append("\ncritical_path_drivers (top 5 by duration):")
        for a in critical_activities[:5]:
            lines.append(f"  - {a.get('task_id')}: {a.get('name')} ({a.get('duration_hrs')}h)")

    near_critical = [
        a for a in activities
        if not a.get("is_critical")
        and (a.get("total_float_hrs") or 0) > 0
        and (a.get("total_float_hrs") or 0) < NEAR_CRIT_THRESHOLD
    ]
    if near_critical:
        lines.append(f"\nnear_critical_count: {len(near_critical)} (TF < {NEAR_CRIT_THRESHOLD}h)")
        for a in near_critical[:5]:
            tf = a.get("total_float_hrs", 0)
            lines.append(f"  - {a.get('task_id')}: {a.get('name')} (TF={tf:.1f}h)")

    total = len(activities)
    rel_count = len(relationships)
    density = rel_count / total if total > 0 else 0.0
    lines.append(f"\nrelationship_density: {density:.2f} (relationships per activity)")

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
    session_id: Optional[str] = None,
) -> Tuple[str, Optional[dict]]:
    """
    Send conversation to Claude using proper message threading.

    If *session_id* is provided, uses cached conversation history and only sends
    schedule context when it changes.  This saves ~15K tokens per follow-up.

    Falls back to single-message mode if no session_id (backward compatible).
    """
    model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")
    client = _client()

    _cleanup_sessions()
    ctx_hash = _context_hash(schedule_context)

    if session_id:
        with _sessions_lock:
            session = _sessions.get(session_id)

        if session and session.get("context_hash") == ctx_hash:
            # Context unchanged — reuse cached messages, append new user turn
            api_messages = list(session.get("api_messages", []))
            if user_messages:
                last_user = user_messages[-1]
                if last_user.get("role") == "user":
                    api_messages.append({"role": "user", "content": last_user["content"]})
        else:
            # First message in session or context changed — send full context
            api_messages = []
            first_content = (
                "Current schedule context (read-only, use for reasoning):\n"
                + schedule_context
                + "\n\n"
                + (user_messages[0]["content"] if user_messages else "Summarize this schedule.")
            )
            api_messages.append({"role": "user", "content": first_content})

            for m in user_messages[1:]:
                role = m.get("role", "user")
                content = m.get("content", "")
                if role in ("user", "assistant") and content:
                    if api_messages and api_messages[-1]["role"] == role:
                        api_messages[-1]["content"] += "\n" + content
                    else:
                        api_messages.append({"role": role, "content": content})

            if api_messages and api_messages[-1]["role"] != "user":
                api_messages.append({"role": "user", "content": "Continue."})
    else:
        # Legacy single-message mode (backward compatible)
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
        api_messages = [{"role": "user", "content": user_block}]

    # Keep conversation within context window: first message (has context) + last 38
    if len(api_messages) > 40:
        api_messages = [api_messages[0]] + api_messages[-38:]

    msg = client.messages.create(
        model=model,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=api_messages,
    )
    text = ""
    for block in msg.content:
        if hasattr(block, "text"):
            text += block.text
    parsed = extract_json_object(text)

    reply = text
    if parsed and "reply" in parsed:
        reply = str(parsed.get("reply", ""))

    if session_id:
        api_messages.append({"role": "assistant", "content": text})
        with _sessions_lock:
            _sessions[session_id] = {
                "context_hash": ctx_hash,
                "api_messages": api_messages,
                "last_access": time.time(),
            }

    return reply, parsed


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
                    constraint_type, constraint_date,
                    early_start, early_finish, late_start, late_finish, total_float_hrs,
                    free_float_hrs, is_critical
                ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0)""",
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




def analyze_schedule_network(
    proj_id: str,
    activities: List[dict],
    relationships: List[dict],
    diagnostics: Any,
) -> dict:
    """
    Compute structured network analysis without API calls.

    Returns a dict with sections:
    - critical_path_drivers: top critical activities by duration
    - float_consumption_risks: near-critical activities (0 < TF < 40h)
    - logic_gaps: activities with only SS predecessors, or only milestone predecessors
    - relationship_density: relationships per activity, flagging < 1.5 or > 4.0
    - schedule_score: 0-100 composite score
    """
    total = len(activities)
    rel_count = len(relationships)

    critical_activities = [
        a for a in activities if a.get("is_critical")
    ]
    critical_activities_sorted = sorted(
        critical_activities, key=lambda x: float(x.get("duration_hrs") or 0), reverse=True
    )

    near_critical = [
        a for a in activities
        if not a.get("is_critical")
        and (a.get("total_float_hrs") or 0) > 0
        and (a.get("total_float_hrs") or 0) < NEAR_CRIT_THRESHOLD
    ]

    pred_map: Dict[str, List[dict]] = {}
    for r in relationships:
        succ = str(r.get("succ_id"))
        pred_map.setdefault(succ, []).append(r)

    milestone_ids = {str(a["task_id"]) for a in activities if a.get("is_milestone")}

    logic_gaps: List[dict] = []
    for a in activities:
        tid = str(a["task_id"])
        preds = pred_map.get(tid, [])
        if preds:
            types = {r.get("rel_type", "FS") for r in preds}
            if types == {"SS"}:
                logic_gaps.append({
                    "task_id": tid,
                    "name": a.get("name"),
                    "issue": "only_ss_predecessors",
                })
            pred_ids = {str(r.get("pred_id")) for r in preds}
            if pred_ids and pred_ids.issubset(milestone_ids):
                logic_gaps.append({
                    "task_id": tid,
                    "name": a.get("name"),
                    "issue": "only_milestone_predecessors",
                })

    density = rel_count / total if total > 0 else 0.0
    density_flag = None
    if density < 1.5:
        density_flag = "under_linked"
    elif density > 4.0:
        density_flag = "over_linked"

    summary = getattr(diagnostics, "summary", None) if diagnostics else None
    open_starts = summary.open_starts if summary else 0
    open_ends = summary.open_ends if summary else 0
    critical_pct = summary.critical_pct if summary else 0.0

    score = 100.0
    if total > 0:
        score -= (open_starts / total) * 20
        score -= (open_ends / total) * 20
    if critical_pct > 25:
        score -= min(20, (critical_pct - 25) * 0.5)
    if density < 1.5:
        score -= 10
    elif density > 4.0:
        score -= 5
    score -= len(logic_gaps) * 2
    score = max(0, min(100, score))

    return {
        "critical_path_drivers": [
            {"task_id": a["task_id"], "name": a.get("name"), "duration_hrs": a.get("duration_hrs")}
            for a in critical_activities_sorted[:5]
        ],
        "float_consumption_risks": [
            {"task_id": a["task_id"], "name": a.get("name"), "total_float_hrs": a.get("total_float_hrs")}
            for a in near_critical[:10]
        ],
        "logic_gaps": logic_gaps[:20],
        "relationship_density": {
            "ratio": round(density, 2),
            "flag": density_flag,
            "total_relationships": rel_count,
            "total_activities": total,
        },
        "schedule_score": round(score, 1),
        "score_components": {
            "open_starts_penalty": round((open_starts / total) * 20, 1) if total > 0 else 0,
            "open_ends_penalty": round((open_ends / total) * 20, 1) if total > 0 else 0,
            "critical_pct_penalty": round(min(20, max(0, critical_pct - 25) * 0.5), 1),
            "density_penalty": 10 if density < 1.5 else (5 if density > 4.0 else 0),
            "logic_gaps_penalty": len(logic_gaps) * 2,
        },
    }


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

    pred_map: Dict[str, List[dict]] = {}
    for r in relationships:
        succ = str(r.get("succ_id"))
        pred_map.setdefault(succ, []).append(r)

    milestone_ids = {str(a["task_id"]) for a in activities if a.get("is_milestone")}

    for a in activities:
        tid = str(a["task_id"])
        tf = a.get("total_float_hrs")
        is_crit = a.get("is_critical")

        if not is_crit and tf is not None and 0 < tf < NEAR_CRIT_THRESHOLD:
            days = tf / 8.0
            suggestions.append(
                {
                    "id": f"near-critical-{tid}",
                    "title": f"Near-critical: {a.get('name', tid)}",
                    "detail": f"Activity has only {days:.1f} days of float — it's near-critical. Consider reviewing its duration or adding parallel work paths.",
                    "prompt": f"Activity {tid} in project {proj_id} has limited float ({days:.1f} days). Suggest ways to add scheduling buffer or parallel paths. Output JSON actions only.",
                    "severity": "info",
                    "task_id": tid,
                }
            )

        preds = pred_map.get(tid, [])
        if preds:
            pred_ids = {str(r.get("pred_id")) for r in preds}
            if pred_ids and pred_ids.issubset(milestone_ids):
                suggestions.append(
                    {
                        "id": f"weak-logic-{tid}",
                        "title": f"Weak logic: {a.get('name', tid)}",
                        "detail": f"Activity is driven only by milestones — consider adding non-milestone predecessors for stronger logic.",
                        "prompt": f"Activity {tid} in project {proj_id} only has milestone predecessors. Suggest a non-milestone predecessor to strengthen the logic. Output JSON actions only.",
                        "severity": "info",
                        "task_id": tid,
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


def generate_auto_fixes(
    proj_id: str,
    activities: List[dict],
    relationships: List[dict],
) -> List[dict]:
    """
    Generate concrete fix actions for common schedule deficiencies WITHOUT AI.

    Returns list of action dicts in the same format as AI actions:
    { "op": "add_relationship", "pred_id": "...", "succ_id": "...", "rel_type": "FS", "lag_hrs": 0 }

    Rule-based logic:
    1. Open ends (no successors): find the next activity in the same WBS by
       early_start order and add FS.  Fall back to a completion milestone.
    2. Open starts (no predecessors): link from the previous WBS activity or a
       project-start milestone.
    """
    ids = {str(a["task_id"]) for a in activities}

    succ_count: Dict[str, int] = {}
    pred_count: Dict[str, int] = {}

    for r in relationships:
        p = str(r.get("pred_id", r.get("pred_task_id", "")))
        s = str(r.get("succ_id", r.get("succ_task_id", "")))
        if p in ids and s in ids:
            succ_count[p] = succ_count.get(p, 0) + 1
            pred_count[s] = pred_count.get(s, 0) + 1

    milestone_ids = {
        str(a["task_id"]) for a in activities if int(a.get("is_milestone") or 0)
    }

    by_wbs: Dict[str, List[dict]] = {}
    for a in activities:
        w = str(a.get("wbs_id") or "")
        by_wbs.setdefault(w, []).append(a)
    for w in by_wbs:
        by_wbs[w].sort(key=lambda x: float(x.get("early_start") or 0))

    start_ms: Optional[str] = None
    end_ms: Optional[str] = None
    for a in activities:
        tid = str(a["task_id"])
        if tid in milestone_ids:
            name = (a.get("name") or "").upper()
            if "NOTICE TO PROCEED" in name or "NTP" in name:
                start_ms = tid
            elif "SUBSTANTIAL COMPLETION" in name or "FINAL COMPLETION" in name:
                if end_ms is None:
                    end_ms = tid

    fixes: List[dict] = []
    fixed_pairs: set = set()

    # Fix 1: activities with no successors
    for a in activities:
        tid = str(a["task_id"])
        if tid in milestone_ids:
            continue
        if succ_count.get(tid, 0) > 0:
            continue

        wbs = str(a.get("wbs_id") or "")
        wbs_acts = by_wbs.get(wbs, [])
        my_ef = float(a.get("early_finish") or a.get("early_start") or 0)

        best_succ: Optional[str] = None
        best_es = float("inf")
        for candidate in wbs_acts:
            c_tid = str(candidate["task_id"])
            if c_tid == tid or c_tid in milestone_ids:
                continue
            c_es = float(candidate.get("early_start") or 0)
            if c_es >= my_ef and c_es < best_es:
                best_es = c_es
                best_succ = c_tid

        if best_succ and (tid, best_succ) not in fixed_pairs:
            fixes.append({
                "op": "add_relationship",
                "pred_id": tid,
                "succ_id": best_succ,
                "rel_type": "FS",
                "lag_hrs": 0,
                "_reason": f"Open end: {tid} has no successors, linking to next WBS activity {best_succ}",
            })
            fixed_pairs.add((tid, best_succ))
        elif end_ms and (tid, end_ms) not in fixed_pairs:
            fixes.append({
                "op": "add_relationship",
                "pred_id": tid,
                "succ_id": end_ms,
                "rel_type": "FS",
                "lag_hrs": 0,
                "_reason": f"Open end: {tid} linked to completion milestone {end_ms}",
            })
            fixed_pairs.add((tid, end_ms))

    # Fix 2: activities with no predecessors
    for a in activities:
        tid = str(a["task_id"])
        if tid in milestone_ids:
            continue
        if pred_count.get(tid, 0) > 0:
            continue

        wbs = str(a.get("wbs_id") or "")
        wbs_acts = by_wbs.get(wbs, [])
        my_es = float(a.get("early_start") or 0)

        best_pred: Optional[str] = None
        best_ef = -1.0
        for candidate in wbs_acts:
            c_tid = str(candidate["task_id"])
            if c_tid == tid or c_tid in milestone_ids:
                continue
            c_ef = float(
                candidate.get("early_finish") or candidate.get("early_start") or 0
            )
            if c_ef <= my_es and c_ef > best_ef:
                best_ef = c_ef
                best_pred = c_tid

        if best_pred and (best_pred, tid) not in fixed_pairs:
            fixes.append({
                "op": "add_relationship",
                "pred_id": best_pred,
                "succ_id": tid,
                "rel_type": "FS",
                "lag_hrs": 0,
                "_reason": f"Open start: {tid} has no predecessors, linking from WBS activity {best_pred}",
            })
            fixed_pairs.add((best_pred, tid))
        elif start_ms and (start_ms, tid) not in fixed_pairs:
            fixes.append({
                "op": "add_relationship",
                "pred_id": start_ms,
                "succ_id": tid,
                "rel_type": "FS",
                "lag_hrs": 0,
                "_reason": f"Open start: {tid} linked from NTP milestone {start_ms}",
            })
            fixed_pairs.add((start_ms, tid))

    return fixes
