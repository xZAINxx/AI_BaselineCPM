"""Pydantic models for FastAPI request/response bodies."""

from __future__ import annotations

from typing import Any, List, Optional

from pydantic import BaseModel, Field


class ProjectSummary(BaseModel):
    """One row in the project list."""

    proj_id: str
    name: str
    imported_at: str
    activity_count: int = 0
    relationship_count: int = 0


class ImportResult(BaseModel):
    """Response after a successful XER import."""

    proj_id: str
    name: str
    activities_count: int
    relationships_count: int
    calendars_count: int = 0


class ActivityRow(BaseModel):
    """Activity with optional CPM fields."""

    proj_id: str
    task_id: str
    name: str
    duration_hrs: float
    wbs_id: Optional[str] = None
    calendar_id: Optional[str] = None
    early_start: Optional[float] = None
    early_finish: Optional[float] = None
    late_start: Optional[float] = None
    late_finish: Optional[float] = None
    total_float_hrs: Optional[float] = None
    is_critical: bool = False
    is_milestone: bool = False


class RelationshipRow(BaseModel):
    """Directed relationship (predecessor → successor)."""

    id: int
    pred_id: str
    succ_id: str
    rel_type: str
    lag_hrs: float


class Finding(BaseModel):
    """Single diagnostic finding."""

    check: str
    severity: str
    task_id: Optional[str] = None
    message: str


class DiagnosticsSummary(BaseModel):
    """Aggregated counts for Schedule Health."""

    total_activities: int = 0
    critical_count: int = 0
    critical_pct: float = 0.0
    open_starts: int = 0
    open_ends: int = 0


class DiagnosticsResult(BaseModel):
    """Full diagnostics payload."""

    findings: List[Finding] = Field(default_factory=list)
    summary: DiagnosticsSummary = Field(default_factory=DiagnosticsSummary)
    truncated: bool = False


class CpmResult(BaseModel):
    """Result of running CPM for a project."""

    proj_id: str
    project_end_hrs: float
    critical_count: int
    total_count: int
    critical_path: List[str] = Field(default_factory=list)
    cycle_error: Optional[str] = None


class ActivitiesPage(BaseModel):
    """Paginated/filtered activity list (client may sort)."""

    items: List[ActivityRow]
    total: int
