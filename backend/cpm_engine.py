"""
Critical Path Method (CPM) / Precedence Diagram Method (PDM) engine.

Implements forward and backward passes with FS/SS/FF/SF links and lag in hours.
**No third-party scheduling libraries** — topological sort (Kahn) plus iterative
relaxation where PDM constraints interact.

Conventions (documented per product spec):
- Durations and schedule times are continuous **hours** from project time 0.
- **Total float:** ``TF = LS - ES`` (hours).
- **Critical:** ``abs(TF) < 0.001`` (epsilon for floating noise).

Forward pass (high level):
  For each link type, enforce lower bounds on ES/EF (see inline comments).
  Iterate in topological order until ES/EF stabilize.

Backward pass (high level):
  Terminal activities receive ``LF = project_end = max(EF)``.
  Propagate latest allowable LF/LS backward using mirror constraints.

Longest path (critical chain):
  After forward pass, ``driver_pred[t]`` stores one predecessor that dominated
  ``ES[t]``. Trace backward from critical terminal activities along
  ``driver_pred`` to build one critical path chain.

**Free float** (PDM): for each predecessor *i* and successor *j* with lag *L*,
the slack on *i* from that link alone is:

- **FS:** ``ES[j] - L - EF[i]``
- **SS:** ``ES[j] - L - ES[i]``
- **FF:** ``EF[j] - L - EF[i]``
- **SF:** ``EF[j] - L - ES[i]``

``FF[i]`` is the minimum of these values over outgoing links (non-negative).
Terminal activities (no successors) use ``FF = TF``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Set, Tuple

# Critical / total-float tolerance (hours), per spec
EPS = 1e-3
# Tighter epsilon for iterative PDM convergence
_RELAX_EPS = 1e-6
# Near-critical threshold: 5 working days * 8 hours
NEAR_CRIT_THRESHOLD = 40.0


@dataclass
class Rel:
    """Directed edge from pred to succ with PDM type and lag (hours)."""

    pred: str
    succ: str
    typ: str  # FS, SS, FF, SF
    lag: float


def topological_order(
    nodes: Set[str], outgoing: Dict[str, List[Tuple[str, Rel]]]
) -> Tuple[bool, List[str]]:
    """Kahn's algorithm. Returns ``(ok, order)``; ``ok`` is False if a cycle exists."""
    indeg: Dict[str, int] = {n: 0 for n in nodes}
    for u in nodes:
        for v, _ in outgoing.get(u, []):
            if v in indeg:
                indeg[v] += 1
    q = [n for n in nodes if indeg.get(n, 0) == 0]
    order: List[str] = []
    while q:
        u = q.pop(0)
        order.append(u)
        for v, _ in outgoing.get(u, []):
            indeg[v] -= 1
            if indeg[v] == 0:
                q.append(v)
    if len(order) != len(nodes):
        return False, order
    return True, order


def build_graph(
    task_ids: List[str],
    relationships: List[Tuple[str, str, str, float]],
) -> Tuple[Set[str], Dict[str, List[Tuple[str, Rel]]], Dict[str, List[Rel]]]:
    """Build forward and reverse adjacency with :class:`Rel` edges."""
    nodes: Set[str] = set(task_ids)
    outgoing: Dict[str, List[Tuple[str, Rel]]] = {}
    preds_by_succ: Dict[str, List[Rel]] = {}

    for pr, su, typ, lag in relationships:
        if pr not in nodes or su not in nodes:
            continue
        r = Rel(pred=pr, succ=su, typ=typ, lag=lag)
        outgoing.setdefault(pr, []).append((su, r))
        preds_by_succ.setdefault(su, []).append(r)
    return nodes, outgoing, preds_by_succ


def forward_pass(
    topo: List[str],
    duration: Dict[str, float],
    preds_by_succ: Dict[str, List[Rel]],
    constraints: Optional[Dict[str, Tuple[str, float]]] = None,
) -> Tuple[Dict[str, float], Dict[str, float], Dict[str, Optional[str]]]:
    """
    Forward pass: compute ES, EF and ``driver_pred[t]`` = predecessor that last
    increased ``ES[t]`` (used for critical path tracing).

    Relationship constraints (lag in hours, D = duration of current activity):

    - **FS:** ``ES_succ >= EF_pred + lag``
    - **SS:** ``ES_succ >= ES_pred + lag``
    - **FF:** ``EF_succ >= EF_pred + lag`` → ``ES_succ >= EF_pred + lag - D_succ``
    - **SF:** ``EF_succ >= ES_pred + lag`` → ``ES_succ >= ES_pred + lag - D_succ``

    Activity constraints (applied after predecessor logic):

    - **SNET:** ``ES >= constraint_date``
    - **MSO:** ``ES = constraint_date`` (forced)
    - **MFO:** ``ES = constraint_date - duration`` (forced finish)

    After SS/FS constraints, set ``EF = ES + D``, then raise ``EF`` to satisfy
    any **FF** / **SF** lower bounds on finish, then adjust ``ES`` if needed.
    """
    if constraints is None:
        constraints = {}

    ES: Dict[str, float] = {t: 0.0 for t in topo}
    EF: Dict[str, float] = {t: 0.0 for t in topo}
    driver_pred: Dict[str, Optional[str]] = {t: None for t in topo}

    def relax_round() -> bool:
        changed = False
        for t in topo:
            d = duration.get(t, 0.0)
            preds = preds_by_succ.get(t, [])
            new_es = 0.0
            best_pred: Optional[str] = None
            if preds:
                new_es = -1e30
                for r in preds:
                    p = r.pred
                    lag = r.lag
                    if r.typ == "FS":
                        cand = EF[p] + lag
                        if cand > new_es:
                            new_es = cand
                            best_pred = p
                    elif r.typ == "SS":
                        cand = ES[p] + lag
                        if cand > new_es:
                            new_es = cand
                            best_pred = p
                    elif r.typ == "FF":
                        cand = EF[p] + lag - d
                        if cand > new_es:
                            new_es = cand
                            best_pred = p
                    elif r.typ == "SF":
                        cand = ES[p] + lag - d
                        if cand > new_es:
                            new_es = cand
                            best_pred = p
                if new_es < 0:
                    new_es = 0.0

            cstr = constraints.get(t)
            if cstr:
                ctype, cdate = cstr
                if ctype == "SNET":
                    new_es = max(new_es, cdate)
                elif ctype == "MSO":
                    new_es = cdate
                elif ctype == "MFO":
                    new_es = cdate - d

            if abs(new_es - ES[t]) > _RELAX_EPS:
                ES[t] = new_es
                driver_pred[t] = best_pred if preds else None
                changed = True
            else:
                ES[t] = new_es
                if preds and best_pred is not None:
                    driver_pred[t] = best_pred

            ef_new = ES[t] + d
            for r in preds:
                if r.typ == "FF":
                    need = EF[r.pred] + r.lag
                    if need > ef_new:
                        ef_new = need
                elif r.typ == "SF":
                    need = ES[r.pred] + r.lag
                    if need > ef_new:
                        ef_new = need
            if ef_new < ES[t]:
                ef_new = ES[t]
            if abs(ef_new - EF[t]) > _RELAX_EPS:
                EF[t] = ef_new
                changed = True
            else:
                EF[t] = ef_new
            if d > _RELAX_EPS and EF[t] > ES[t] + d + _RELAX_EPS:
                ES[t] = EF[t] - d
        return changed

    for _ in range(max(30, len(topo) * 5)):
        if not relax_round():
            break

    for t in topo:
        d = duration.get(t, 0.0)
        EF[t] = max(EF[t], ES[t] + d)

    return ES, EF, driver_pred


def backward_pass(
    topo_rev: List[str],
    topo: List[str],
    duration: Dict[str, float],
    outgoing: Dict[str, List[Tuple[str, Rel]]],
    EF: Dict[str, float],
    constraints: Optional[Dict[str, Tuple[str, float]]] = None,
) -> Tuple[Dict[str, float], Dict[str, float]]:
    """
    Backward pass (reverse topological order, iterated):

    Terminal nodes: ``LF = project_end = max(EF)``.

    For predecessor *i* and successor *j* (lag in hours, D = duration):

    - **FS:** ``LF_i <= LF_j - D_j - lag``
    - **SS:** ``LF_i <= LF_j - D_j - lag + D_i``
    - **FF:** ``LF_i <= LF_j - lag``
    - **SF:** ``LF_i <= LF_j + D_i - lag``  (mirror of ``EF_j >= ES_i + lag``)

    Activity constraints:

    - **FNLT:** ``LF <= constraint_date``
    """
    if constraints is None:
        constraints = {}

    proj_end = max(EF.values()) if EF else 0.0

    LF: Dict[str, float] = {t: proj_end for t in topo}
    LS: Dict[str, float] = {t: proj_end - duration.get(t, 0.0) for t in topo}

    def relax_back() -> bool:
        changed = False
        for t in topo_rev:
            d = duration.get(t, 0.0)
            succs = outgoing.get(t, [])
            candidates = [LF[t]]
            if not succs:
                candidates.append(proj_end)
            for v, r in succs:
                lag = r.lag
                dj = duration.get(v, 0.0)
                if r.typ == "FS":
                    candidates.append(LF[v] - dj - lag)
                elif r.typ == "SS":
                    candidates.append(LF[v] - dj - lag + d)
                elif r.typ == "FF":
                    candidates.append(LF[v] - lag)
                elif r.typ == "SF":
                    candidates.append(LF[v] + d - lag)

            cstr = constraints.get(t)
            if cstr:
                ctype, cdate = cstr
                if ctype == "FNLT":
                    candidates.append(cdate)

            new_lf = min(candidates)
            if abs(new_lf - LF[t]) > _RELAX_EPS:
                LF[t] = new_lf
                LS[t] = LF[t] - d
                changed = True
            else:
                LF[t] = new_lf
                LS[t] = LF[t] - d
        return changed

    for _ in range(max(30, len(topo_rev) * 5)):
        if not relax_back():
            break

    for t in topo:
        d = duration.get(t, 0.0)
        LS[t] = LF[t] - d

    return LS, LF


def compute_free_float(
    task_ids: List[str],
    outgoing: Dict[str, List[Tuple[str, Rel]]],
    ES: Dict[str, float],
    EF: Dict[str, float],
    TF: Dict[str, float],
) -> Dict[str, float]:
    """
    Free float per activity: min slack to successors; terminals use total float.

    Uses early times from the forward pass and ``TF`` from ``LS - ES``.
    """
    FF: Dict[str, float] = {}
    for t in task_ids:
        succs = outgoing.get(t, [])
        if not succs:
            FF[t] = TF.get(t, 0.0)
            continue
        best = float("inf")
        for j, r in succs:
            lag = r.lag
            if r.typ == "FS":
                slack = ES[j] - lag - EF[t]
            elif r.typ == "SS":
                slack = ES[j] - lag - ES[t]
            elif r.typ == "FF":
                slack = EF[j] - lag - EF[t]
            elif r.typ == "SF":
                slack = EF[j] - lag - ES[t]
            else:
                slack = float("inf")
            if slack < best:
                best = slack
        if best == float("inf"):
            FF[t] = max(0.0, TF.get(t, 0.0))
        else:
            FF[t] = max(0.0, best)
    return FF


def trace_critical_path(
    nodes: Set[str],
    outgoing: Dict[str, List[Tuple[str, Rel]]],
    EF: Dict[str, float],
    driver_pred: Dict[str, Optional[str]],
    crit: Dict[str, bool],
) -> List[str]:
    """
    Build one critical path chain: start from a critical terminal activity
    (no successors), walk backward via ``driver_pred``.
    """
    terminals = [t for t in nodes if not outgoing.get(t)]
    if not terminals:
        return []
    critical_terms = [t for t in terminals if crit.get(t)]
    if not critical_terms:
        critical_terms = terminals
    start = max(critical_terms, key=lambda t: EF.get(t, 0.0))
    path: List[str] = []
    cur: Optional[str] = start
    seen: Set[str] = set()
    while cur is not None and cur not in seen:
        path.append(cur)
        seen.add(cur)
        cur = driver_pred.get(cur)
    path.reverse()
    return path


def compute_cpm(
    task_ids: List[str],
    duration: Dict[str, float],
    relationships: List[Tuple[str, str, str, float]],
    constraints: Optional[Dict[str, Tuple[str, float]]] = None,
) -> Tuple[
    Optional[str],
    Dict[str, float],
    Dict[str, float],
    Dict[str, float],
    Dict[str, float],
    Dict[str, float],
    Dict[str, float],
    Dict[str, bool],
    Dict[str, bool],
    float,
    List[str],
]:
    """
    Args:
      task_ids: List of activity IDs.
      duration: Mapping of task_id to duration in hours.
      relationships: List of (pred, succ, type, lag) tuples.
      constraints: Optional mapping of task_id to (constraint_type, constraint_date).
        Supported types: SNET, FNLT, MSO, MFO, ASAP, ALAP.

    Returns:
      cycle_error or None, ES, EF, LS, LF, TF, FF, is_critical, is_near_critical,
      project_end_hrs, critical_path (ordered task ids).
    """
    if constraints is None:
        constraints = {}

    nodes, outgoing, preds_by_succ = build_graph(task_ids, relationships)
    ok, topo = topological_order(nodes, outgoing)
    if not ok:
        return (
            "Schedule contains a circular dependency (cycle).",
            {},
            {},
            {},
            {},
            {},
            {},
            {},
            {},
            0.0,
            [],
        )

    ES, EF, driver_pred = forward_pass(topo, duration, preds_by_succ, constraints)
    topo_rev = list(reversed(topo))
    LS, LF = backward_pass(topo_rev, topo, duration, outgoing, EF, constraints)

    TF: Dict[str, float] = {}
    crit: Dict[str, bool] = {}
    near_crit: Dict[str, bool] = {}
    for t in task_ids:
        tf = LS.get(t, 0.0) - ES.get(t, 0.0)
        TF[t] = tf
        crit[t] = tf <= EPS
        near_crit[t] = not crit[t] and 0 < tf < NEAR_CRIT_THRESHOLD

    FF = compute_free_float(task_ids, outgoing, ES, EF, TF)

    proj_end = max(EF.values()) if EF else 0.0
    path = trace_critical_path(nodes, outgoing, EF, driver_pred, crit)
    return None, ES, EF, LS, LF, TF, FF, crit, near_crit, proj_end, path


def run_cpm_for_project_rows(
    activities: List[dict],
    relationships: List[dict],
) -> Tuple[Optional[str], Dict[str, dict], float, List[str]]:
    """
    Run CPM from SQLite-shaped row dicts.

    Activities need ``task_id``, ``duration_hrs``. Relationships need
    ``pred_id``/``succ_id`` or legacy ``pred_task_id``/``succ_task_id``,
    ``rel_type``/``pred_type``, ``lag_hrs``.

    Activities may optionally have ``constraint_type`` and ``constraint_date``
    for schedule constraints (SNET, FNLT, MSO, MFO, ASAP, ALAP).

    Progress tracking (retained logic scheduling):
    - If ``actual_finish`` is set, duration is 0 (activity is complete).
    - If ``actual_start`` is set but not ``actual_finish``, use ``remaining_duration_hrs``
      (if set) instead of ``duration_hrs``.
    """
    task_ids = [str(a["task_id"]) for a in activities]

    duration: Dict[str, float] = {}
    for a in activities:
        tid = str(a["task_id"])
        base_dur = float(a.get("duration_hrs") or 0)
        actual_finish = a.get("actual_finish")
        actual_start = a.get("actual_start")
        remaining = a.get("remaining_duration_hrs")

        if actual_finish is not None:
            duration[tid] = 0.0
        elif actual_start is not None and remaining is not None:
            duration[tid] = float(remaining)
        else:
            duration[tid] = base_dur

    constraints: Dict[str, Tuple[str, float]] = {}
    for a in activities:
        ctype = a.get("constraint_type")
        cdate = a.get("constraint_date")
        if ctype and cdate is not None:
            constraints[str(a["task_id"])] = (str(ctype).upper(), float(cdate))

    rels: List[Tuple[str, str, str, float]] = []
    for r in relationships:
        pr = r.get("pred_id", r.get("pred_task_id"))
        su = r.get("succ_id", r.get("succ_task_id"))
        typ = str(r.get("rel_type", r.get("pred_type", "FS")))
        rels.append((str(pr), str(su), typ, float(r.get("lag_hrs") or 0)))

    err, ES, EF, LS, LF, TF, FF, crit, near_crit, proj_end, path = compute_cpm(
        task_ids, duration, rels, constraints
    )
    if err:
        return err, {}, 0.0, []

    out: Dict[str, dict] = {}
    for t in task_ids:
        out[t] = {
            "early_start": ES[t],
            "early_finish": EF[t],
            "late_start": LS[t],
            "late_finish": LF[t],
            "total_float_hrs": TF[t],
            "free_float_hrs": FF[t],
            "is_critical": 1 if crit[t] else 0,
            "is_near_critical": 1 if near_crit[t] else 0,
        }
    return None, out, proj_end, path
