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
  onScheduleChanged,
}) {
  const [suggestions, setSuggestions] = useState([])
  const [sugError, setSugError] = useState(null)
  const [autoFixes, setAutoFixes] = useState(null)
  const [fixSelected, setFixSelected] = useState({})
  const [fixLoading, setFixLoading] = useState(false)
  const [fixApplying, setFixApplying] = useState(false)
  const [fixResult, setFixResult] = useState(null)
  const [sugAiResults, setSugAiResults] = useState({})

  const fetchSugFix = async (sug) => {
    const key = sug.id || sug.title
    setSugAiResults(prev => ({ ...prev, [key]: { loading: true } }))
    try {
      const res = await fetch(`${apiBase}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proj_id: projId,
          messages: [{ role: 'user', content: sug.prompt }],
          auto_apply: false,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.needs_api_key) {
        setSugAiResults(prev => ({ ...prev, [key]: { error: 'Set ANTHROPIC_API_KEY in backend/.env' } }))
        return
      }
      const actions = data.actions_preview || []
      setSugAiResults(prev => ({ ...prev, [key]: { actions, reply: data.reply } }))
    } catch (e) {
      setSugAiResults(prev => ({ ...prev, [key]: { error: e.message } }))
    }
  }

  const applySugFix = async (sug, actions) => {
    const key = sug.id || sug.title
    setSugAiResults(prev => ({ ...prev, [key]: { ...prev[key], applying: true } }))
    try {
      const res = await fetch(`${apiBase}/ai/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proj_id: projId, actions }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Apply failed')
      setSugAiResults(prev => ({ ...prev, [key]: { applied: data.applied?.length || 0 } }))
      onScheduleChanged?.()
    } catch (e) {
      setSugAiResults(prev => ({ ...prev, [key]: { ...prev[key], applyError: e.message, applying: false } }))
    }
  }

  useEffect(() => {
    if (!projId) return
    let cancelled = false
    setSuggestions([])
    setSugError(null)

    ;(async () => {
      try {
        const r = await fetch(`${apiBase}/ai/suggestions?proj_id=${encodeURIComponent(projId)}`)
        if (r.status === 404 || r.status === 501) {
          if (!cancelled) {
            setSuggestions([])
            setSugError(null)
          }
          return
        }
        if (!r.ok) {
          if (!cancelled) {
            if (r.status >= 500) {
              setSugError(`HTTP ${r.status}`)
            } else {
              setSuggestions([])
              setSugError(null)
            }
          }
          return
        }
        const data = await r.json()
        if (!cancelled) {
          setSugError(null)
          setSuggestions(data.suggestions || [])
        }
      } catch (e) {
        if (!cancelled) setSugError(e.message || 'Network error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [projId, apiBase, suggestionsRefreshKey])

  const loadAutoFixes = async () => {
    if (!projId) return
    setFixLoading(true)
    setAutoFixes(null)
    setFixResult(null)
    try {
      const res = await fetch(`${apiBase}/ai/auto-fixes?proj_id=${encodeURIComponent(projId)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setAutoFixes(data.fixes || [])
      const sel = {}
      ;(data.fixes || []).forEach((_, i) => { sel[i] = true })
      setFixSelected(sel)
    } catch (e) {
      setAutoFixes([])
      setFixResult({ ok: false, error: e.message })
    } finally {
      setFixLoading(false)
    }
  }

  const applyFixes = async () => {
    if (!projId || !autoFixes?.length || fixApplying) return
    const toApply = autoFixes.filter((_, i) => fixSelected[i])
    if (toApply.length === 0) return
    if (!window.confirm(`Apply ${toApply.length} fix(es) and re-run CPM? This will modify the schedule.`)) return
    setFixApplying(true)
    setFixResult(null)
    try {
      const res = await fetch(`${apiBase}/ai/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proj_id: projId, actions: toApply }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      setFixResult({ ok: true, count: data.applied?.length || 0, cpm_error: data.cpm_error })
      setAutoFixes(null)
      onScheduleChanged?.()
    } catch (e) {
      setFixResult({ ok: false, error: e.message })
    } finally {
      setFixApplying(false)
    }
  }

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

      {/* Auto-Fix Generator — always visible at top */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
        <button type="button" className="btn-primary" style={{ fontSize: '11px', padding: '5px 12px' }}
          onClick={loadAutoFixes} disabled={fixLoading || !projId}>
          {fixLoading ? 'Analyzing…' : 'Generate Auto-Fixes'}
        </button>
        <span style={{ fontSize: '10px', color: 'var(--text-3)' }}>
          Rule-based fixes for open ends &amp; missing logic (no AI key needed)
        </span>
      </div>

      {fixResult?.ok ? (
        <div className="ai-suggestion-banner sev-info" style={{ marginBottom: '12px' }}>
          <div className="ai-suggestion-text">
            <strong style={{ color: 'var(--emerald)' }}>✓ Applied {fixResult.count} fix(es)</strong>
            <p>CPM recalculated.{fixResult.cpm_error ? ` Warning: ${fixResult.cpm_error}` : ' Schedule updated successfully.'}</p>
          </div>
        </div>
      ) : null}
      {fixResult && !fixResult.ok ? (
        <div className="ai-banner danger" style={{ marginBottom: '12px' }}>Error: {fixResult.error}</div>
      ) : null}

      {autoFixes?.length > 0 ? (
        <div style={{ marginBottom: '16px', border: '1px solid var(--border-1)', borderRadius: 'var(--r-lg)', padding: '12px', background: 'var(--glass)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <strong style={{ fontSize: '12px', color: 'var(--text-1)' }}>
              {Object.values(fixSelected).filter(Boolean).length} of {autoFixes.length} fixes selected
            </strong>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button type="button" className="btn-secondary" style={{ fontSize: '10px', padding: '2px 6px' }}
                onClick={() => { const s = {}; autoFixes.forEach((_, i) => { s[i] = true }); setFixSelected(s) }}>All</button>
              <button type="button" className="btn-secondary" style={{ fontSize: '10px', padding: '2px 6px' }}
                onClick={() => setFixSelected({})}>None</button>
            </div>
          </div>
          <div style={{ maxHeight: '250px', overflow: 'auto' }}>
            {autoFixes.map((fix, i) => (
              <label key={i} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', fontSize: '10px', color: 'var(--text-2)', padding: '4px 0', cursor: 'pointer', borderBottom: '1px solid var(--border-1)' }}>
                <input type="checkbox" checked={!!fixSelected[i]}
                  onChange={e => setFixSelected(prev => ({...prev, [i]: e.target.checked}))}
                  style={{ marginTop: '2px', accentColor: 'var(--indigo)' }} />
                <span style={{ fontFamily: 'var(--font-mono)', lineHeight: '1.4' }}>
                  <strong style={{ color: 'var(--text-1)' }}>{fix.op}</strong>
                  {fix.op === 'add_relationship' ? ` ${fix.pred_id} → ${fix.succ_id} (${fix.rel_type})` : ` ${fix.task_id || ''}`}
                  {fix._reason ? <span style={{ display: 'block', color: 'var(--text-3)', fontSize: '9px' }}>{fix._reason}</span> : null}
                </span>
              </label>
            ))}
          </div>
          <div style={{ marginTop: '10px', display: 'flex', gap: '6px' }}>
            <button type="button" className="btn-primary" style={{ fontSize: '11px', padding: '5px 12px' }}
              onClick={applyFixes} disabled={fixApplying || Object.values(fixSelected).filter(Boolean).length === 0}>
              {fixApplying ? 'Applying…' : `Apply ${Object.values(fixSelected).filter(Boolean).length} Fix(es) & Re-run CPM`}
            </button>
            <button type="button" className="btn-secondary" style={{ fontSize: '10px', padding: '4px 8px' }}
              onClick={() => setAutoFixes(null)}>Dismiss</button>
          </div>
        </div>
      ) : autoFixes !== null && autoFixes.length === 0 ? (
        <div style={{ marginBottom: '12px', fontSize: '11px', color: 'var(--emerald)' }}>
          ✓ No auto-fixable issues found. Schedule logic looks clean.
        </div>
      ) : null}

      {sugError ? (
        <div className="health-banner health-banner-soft" role="status">
          AI suggestions unavailable: {sugError}
        </div>
      ) : null}

      {suggestions.length > 0 ? (
        <div className="ai-suggestion-banners">
          {suggestions.slice(0, 8).map((s, i) => {
            const key = s.id || s.title
            const result = sugAiResults[key]
            return (
              <div key={key ?? `sug-${i}`} className={`ai-suggestion-banner sev-${s.severity || 'info'}`} role="region" aria-label={s.title}>
                <div className="ai-suggestion-text" style={{ flex: 1 }}>
                  <strong>{s.title}</strong>
                  <p>{s.detail}</p>

                  {result?.loading ? (
                    <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--indigo)' }}>Asking AI…</div>
                  ) : null}

                  {result?.error ? (
                    <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--red)' }}>{result.error}</div>
                  ) : null}

                  {result?.reply && result?.applied == null ? (
                    <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--text-2)', fontStyle: 'italic' }}>{result.reply}</div>
                  ) : null}

                  {result?.actions?.length > 0 && result?.applied == null ? (
                    <div style={{ marginTop: '8px', fontSize: '10px' }}>
                      {result.actions.map((a, j) => (
                        <div key={j} style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-2)', padding: '2px 0' }}>
                          <strong>{a.op}</strong>
                          {a.op === 'add_relationship' ? ` ${a.pred_id} → ${a.succ_id} (${a.rel_type || 'FS'})` : ''}
                          {a.task_id ? ` ${a.task_id}` : ''}
                        </div>
                      ))}
                      <div style={{ marginTop: '6px', display: 'flex', gap: '4px' }}>
                        <button type="button" className="btn-primary" style={{ fontSize: '10px', padding: '3px 8px' }}
                          onClick={() => applySugFix(s, result.actions)} disabled={result.applying}>
                          {result.applying ? 'Applying…' : `Apply ${result.actions.length} action(s)`}
                        </button>
                        <button type="button" className="btn-secondary" style={{ fontSize: '10px', padding: '3px 8px' }}
                          onClick={() => setSugAiResults(prev => { const n = { ...prev }; delete n[key]; return n })}>
                          Dismiss
                        </button>
                      </div>
                      {result?.applyError ? <div style={{ marginTop: '4px', fontSize: '10px', color: 'var(--red)' }}>{result.applyError}</div> : null}
                    </div>
                  ) : null}

                  {result?.applied != null ? (
                    <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--emerald)' }}>
                      ✓ Applied {result.applied} action(s). CPM recalculated.
                    </div>
                  ) : null}
                </div>

                {s.prompt && !result ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
                    <button type="button" className="btn-secondary ai-ask-btn" onClick={() => fetchSugFix(s)}>
                      Ask AI
                    </button>
                    <button type="button" className="btn-secondary ai-ask-btn" style={{ fontSize: '9px' }} onClick={() => askAi(s.prompt)}>
                      Open in Chat
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {!summary ? null : (
        <>
          {summary.dcma_total_checks > 0 ? (
            <div style={{ marginBottom: '12px' }}>
              <div className="health-summary-cards">
                <div className={`health-card${summary.dcma_pass_count < 10 ? ' health-card-danger' : summary.dcma_pass_count < summary.dcma_total_checks ? ' health-card-warn' : ''}`}>
                  <label>DCMA 14-Point</label>
                  <strong>{summary.dcma_pass_count}/{summary.dcma_total_checks}</strong>
                </div>
                <div className={`health-card${summary.negative_float_count > 0 ? ' health-card-danger' : ''}`}>
                  <label>Neg. Float</label>
                  <strong>{summary.negative_float_count ?? 0}</strong>
                </div>
                <div className={`health-card${(summary.near_critical_count || 0) > 0 ? ' health-card-warn' : ''}`}>
                  <label>Near-Critical</label>
                  <strong>{summary.near_critical_count ?? 0}</strong>
                </div>
                <div className="health-card">
                  <label>Rel. Ratio</label>
                  <strong>{summary.relationship_ratio?.toFixed(2) ?? '—'}</strong>
                </div>
              </div>
            </div>
          ) : null}

          {report?.dcma_checks ? (
            <div style={{ marginBottom: '16px' }}>
              <h3 style={{ fontSize: '12px', color: 'var(--text-2)', marginBottom: '8px', fontWeight: 600 }}>DCMA 14-Point Breakdown</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '6px' }}>
                {[
                  ['missing_predecessors', 'Missing Predecessors'],
                  ['missing_successors', 'Missing Successors'],
                  ['high_float', 'High Float'],
                  ['negative_float', 'Negative Float'],
                  ['high_duration', 'High Duration'],
                  ['hard_constraints', 'Hard Constraints'],
                  ['relationship_ratio', 'Relationship Ratio'],
                  ['lags', 'Lags'],
                  ['leads', 'Leads'],
                  ['sf_relationships', 'SF Relationships'],
                  ['critical_path_ratio', 'Critical Path Ratio'],
                  ['invalid_dates', 'Invalid Dates'],
                  ['open_starts', 'Open Starts'],
                  ['open_ends', 'Open Ends'],
                ].map(([key, label]) => {
                  const pass = report.dcma_checks[key]
                  return (
                    <div
                      key={key}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 'var(--r-md)',
                        border: `1.5px solid ${pass ? 'var(--emerald)' : 'var(--red)'}`,
                        background: 'var(--surface-2)',
                        fontSize: '10px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                        <span style={{ fontSize: '13px' }}>{pass ? '✓' : '✗'}</span>
                        <span style={{ color: pass ? 'var(--emerald)' : 'var(--red)', fontWeight: 600 }}>
                          {pass ? 'PASS' : 'FAIL'}
                        </span>
                      </div>
                      <div style={{ color: 'var(--text-2)', lineHeight: '1.3' }}>{label}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}

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
