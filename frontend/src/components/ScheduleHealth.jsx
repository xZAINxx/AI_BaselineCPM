/**
 * Schedule Health tab: diagnostics summary, grouped findings, CSV export.
 */

function groupByCheck(findings) {
  const m = new Map()
  for (const f of findings || []) {
    const k = f.check || 'other'
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(f)
  }
  return m
}

export default function ScheduleHealth({ report, onExportCsv }) {
  if (!report?.summary) {
    return <p className="panel-placeholder">Select a project and run CPM to refresh diagnostics.</p>
  }

  const { summary, findings = [], truncated } = report
  const grouped = groupByCheck(findings)

  return (
    <div>
      <div className="health-summary-cards">
        <div className="health-card">
          <label>Total activities</label>
          <strong>{summary.total_activities}</strong>
        </div>
        <div className="health-card">
          <label>Critical %</label>
          <strong>{summary.critical_pct?.toFixed(1) ?? '—'}%</strong>
        </div>
        <div className="health-card">
          <label>Open starts</label>
          <strong>{summary.open_starts}</strong>
        </div>
        <div className="health-card">
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
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
