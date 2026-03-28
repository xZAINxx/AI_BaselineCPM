/**
 * Schedule Health tab: diagnostics summary, grouped findings, CSV export,
 * rule-based AI suggestions, and Ask AI shortcuts.
 */

import { useEffect, useState } from 'react'

function groupByCheck(findings) {
  const m = new Map()
  for (const f of findings || []) {
    const k = f.check || 'other'
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(f)
  }
  return m
}

function askAi(prompt) {
  window.dispatchEvent(new CustomEvent('ai-chat-prompt', { detail: { prompt } }))
}

export default function ScheduleHealth({
  report,
  onExportCsv,
  projId,
  apiBase = '/api',
  suggestionsRefreshKey = 0,
}) {
  const [suggestions, setSuggestions] = useState([])
  const [sugError, setSugError] = useState(null)

  useEffect(() => {
    if (!projId) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setSuggestions([])
      setSugError(null)
    })
    fetch(`${apiBase}/ai/suggestions?proj_id=${encodeURIComponent(projId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (!cancelled) {
          setSugError(null)
          setSuggestions(data.suggestions || [])
        }
      })
      .catch((e) => {
        if (!cancelled) setSugError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [projId, apiBase, suggestionsRefreshKey])

  if (!projId) {
    return <p className="panel-placeholder">Select a project to view schedule health.</p>
  }

  const summary = report?.summary
  const findings = report?.findings ?? []
  const truncated = report?.truncated
  const grouped = groupByCheck(findings)
  const warnCards =
    summary &&
    (summary.open_starts > 0 ||
      summary.open_ends > 0 ||
      (summary.critical_pct != null && summary.critical_pct > 30))

  return (
    <div className="schedule-health-root">
      {!report ? (
        <p className="panel-placeholder" role="status">
          Loading diagnostics…
        </p>
      ) : null}

      {sugError ? (
        <div className="health-banner health-banner-soft" role="status">
          AI suggestions unavailable: {sugError}
        </div>
      ) : null}

      {suggestions.length > 0 ? (
        <div className="ai-suggestion-banners">
          {suggestions.slice(0, 5).map((s, i) => (
            <div
              key={s.id != null ? String(s.id) : `sug-${i}`}
              className={`ai-suggestion-banner sev-${s.severity || 'info'}`}
              role="region"
              aria-label={s.title}
            >
              <div className="ai-suggestion-text">
                <strong>{s.title}</strong>
                <p>{s.detail}</p>
              </div>
              {s.prompt ? (
                <button type="button" className="btn-secondary ai-ask-btn" onClick={() => askAi(s.prompt)}>
                  Ask AI
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {!summary ? null : (
        <>
          <div className={`health-summary-cards${warnCards ? ' has-warnings' : ''}`}>
            <div className={`health-card${summary.open_starts > 0 ? ' health-card-warn' : ''}`}>
              <label>Total activities</label>
              <strong>{summary.total_activities}</strong>
            </div>
            <div
              className={`health-card${
                summary.critical_pct != null && summary.critical_pct > 30 ? ' health-card-danger' : ''
              }`}
            >
              <label>Critical %</label>
              <strong>{summary.critical_pct?.toFixed(1) ?? '—'}%</strong>
            </div>
            <div className={`health-card${summary.open_starts > 0 ? ' health-card-warn' : ''}`}>
              <label>Open starts</label>
              <strong>{summary.open_starts}</strong>
            </div>
            <div className={`health-card${summary.open_ends > 0 ? ' health-card-warn' : ''}`}>
              <label>Open ends</label>
              <strong>{summary.open_ends}</strong>
            </div>
          </div>

          {truncated ? (
            <div className="health-banner" role="status">
              Showing first 500 findings. Export CSV for the full list from the backend.
            </div>
          ) : null}

          <p style={{ margin: '0.75rem 0' }}>
            <button type="button" className="btn-secondary" onClick={onExportCsv}>
              Export diagnostics (.csv)
            </button>
          </p>

          {Array.from(grouped.entries()).map(([check, items]) => (
            <section key={check} className="health-group">
              <h3 className="health-group-title">{check}</h3>
              <ul className="diagnostics-list">
                {items.map((f, i) => (
                  <li
                    key={`${check}-${f.task_id}-${i}`}
                    className={f.severity === 'warning' ? 'sev-warning' : 'sev-info'}
                  >
                    <span className="health-badge">{f.severity}</span>
                    {f.task_id != null ? <strong> Task {f.task_id}</strong> : null}
                    <br />
                    {f.message}
                    {(f.check === 'no_predecessors' || f.check === 'no_successors') && f.task_id != null && projId ? (
                      <div className="health-inline-ai">
                        <button
                          type="button"
                          className="btn-secondary ai-ask-btn-sm"
                          onClick={() =>
                            askAi(
                              f.check === 'no_predecessors'
                                ? `Suggest one predecessor relationship for task_id ${f.task_id} in project ${projId} that fits typical logic. Respond with JSON actions only.`
                                : `Suggest one successor relationship for task_id ${f.task_id} in project ${projId}. Respond with JSON actions only.`
                            )
                          }
                        >
                          Ask AI
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
