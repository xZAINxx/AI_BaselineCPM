import { useCallback, useEffect, useState } from 'react'
import { HOURS_PER_DAY, REF_MS, hourToDateStr, fmtDays } from '../utils/constants.js'

function fmtVar(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const days = Number(v) / HOURS_PER_DAY
  const sign = days > 0.01 ? '+' : ''
  return `${sign}${days.toFixed(1)}d`
}

function varColor(v) {
  if (v == null) return undefined
  if (Number(v) > 0.01) return { color: 'var(--red)' }
  if (Number(v) < -0.01) return { color: 'var(--emerald)' }
  return { color: 'var(--text-3)' }
}

export default function BaselinePanel({ projId, apiBase = '/api' }) {
  const [baselines, setBaselines] = useState([])
  const [comparison, setComparison] = useState(null)
  const [selectedBl, setSelectedBl] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [blName, setBlName] = useState('')

  const loadBaselines = useCallback(async () => {
    if (!projId) return
    try {
      const res = await fetch(`${apiBase}/projects/${encodeURIComponent(projId)}/baselines`)
      if (res.ok) setBaselines(await res.json())
    } catch { /* ignore */ }
  }, [projId, apiBase])

  useEffect(() => {
    setBaselines([])
    setComparison(null)
    setSelectedBl(null)
    setError(null)
    loadBaselines()
  }, [projId, loadBaselines])

  const saveBaseline = async () => {
    if (!projId || saving) return
    setSaving(true)
    setError(null)
    try {
      const url = new URL(`${apiBase}/projects/${encodeURIComponent(projId)}/baselines`, window.location.origin)
      if (blName.trim()) url.searchParams.set('name', blName.trim())
      const res = await fetch(url, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.detail || `HTTP ${res.status}`)
      }
      setBlName('')
      await loadBaselines()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const compare = async (blNum) => {
    if (!projId) return
    setError(null)
    setSelectedBl(blNum)
    try {
      const res = await fetch(`${apiBase}/projects/${encodeURIComponent(projId)}/baselines/${blNum}/compare`)
      if (res.ok) setComparison(await res.json())
      else throw new Error(`HTTP ${res.status}`)
    } catch (e) {
      setError(e.message)
      setComparison(null)
    }
  }

  const exportComparison = () => {
    if (!comparison?.length) return
    const headers = ['Task ID', 'Name', 'BL Start', 'Cur Start', 'Start Variance', 'BL Finish', 'Cur Finish', 'Finish Variance', 'BL Duration', 'Cur Duration', 'Duration Variance']
    const rows = comparison.map(c => [
      c.task_id,
      `"${(c.name || '').replace(/"/g, '""')}"`,
      hourToDateStr(c.bl_early_start),
      hourToDateStr(c.cur_early_start),
      fmtVar(c.start_variance),
      hourToDateStr(c.bl_early_finish),
      hourToDateStr(c.cur_early_finish),
      fmtVar(c.finish_variance),
      c.bl_duration_hrs != null ? (c.bl_duration_hrs / HOURS_PER_DAY).toFixed(1) : '',
      c.cur_duration_hrs != null ? (c.cur_duration_hrs / HOURS_PER_DAY).toFixed(1) : '',
      c.duration_variance != null ? fmtVar(c.duration_variance) : '',
    ])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `baseline_${selectedBl}_comparison.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const deleteBaseline = async (blNum) => {
    if (!projId) return
    if (!window.confirm(`Delete baseline ${blNum}? This cannot be undone.`)) return
    try {
      await fetch(`${apiBase}/projects/${encodeURIComponent(projId)}/baselines/${blNum}`, { method: 'DELETE' })
      if (selectedBl === blNum) {
        setComparison(null)
        setSelectedBl(null)
      }
      await loadBaselines()
    } catch { /* ignore */ }
  }

  if (!projId) {
    return <p className="panel-placeholder">Select a project to manage baselines.</p>
  }

  return (
    <div className="schedule-health-root">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <input
          type="text"
          className="p6-detail-input"
          style={{ width: '180px', fontSize: '12px', padding: '4px 8px', border: '1px solid var(--border-1)', borderRadius: 'var(--r-md)', background: 'var(--surface-2)', color: 'var(--text-1)' }}
          placeholder="Baseline name (optional)"
          value={blName}
          onChange={(e) => setBlName(e.target.value)}
        />
        <button type="button" className="btn-primary" onClick={saveBaseline} disabled={saving}>
          {saving ? 'Saving…' : 'Save Baseline'}
        </button>
        <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>
          {baselines.length} baseline{baselines.length !== 1 ? 's' : ''} saved
        </span>
      </div>

      {error ? <div className="ai-banner danger" role="alert">{error}</div> : null}

      {baselines.length > 0 ? (
        <div className="health-summary-cards" style={{ marginBottom: '12px' }}>
          {baselines.map((bl) => (
            <div key={bl.baseline_number} className={`health-card${selectedBl === bl.baseline_number ? ' health-card-warn' : ''}`}>
              <label>BL {bl.baseline_number}</label>
              <strong style={{ fontSize: '12px', fontFamily: 'var(--font-sans)' }}>{bl.name || bl.created_at?.slice(0, 10) || '—'}</strong>
              <div style={{ marginTop: '6px', display: 'flex', gap: '4px' }}>
                <button type="button" className="btn-secondary" style={{ fontSize: '10px', padding: '2px 6px' }} onClick={() => compare(bl.baseline_number)}>
                  Compare
                </button>
                <button type="button" className="btn-secondary" style={{ fontSize: '10px', padding: '2px 6px', color: 'var(--red)' }} onClick={() => deleteBaseline(bl.baseline_number)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {comparison && comparison.length > 0 ? (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>
              Comparing BL {selectedBl} — {comparison.length} activities
            </span>
            <button type="button" className="btn-secondary" onClick={exportComparison}>
              ↓ Export Comparison CSV
            </button>
          </div>
        <div className="activity-table-wrap" style={{ maxHeight: '300px' }}>
          <table className="activity-table">
            <thead>
              <tr>
                <th>Task ID</th>
                <th>Name</th>
                <th>BL Start</th>
                <th>Cur Start</th>
                <th>Start Var</th>
                <th>BL Finish</th>
                <th>Cur Finish</th>
                <th>Finish Var</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((c) => (
                <tr key={c.task_id}>
                  <td>{c.task_id}</td>
                  <td>{c.name}</td>
                  <td>{hourToDateStr(c.bl_early_start)}</td>
                  <td>{hourToDateStr(c.cur_early_start)}</td>
                  <td style={varColor(c.start_variance)}>{fmtVar(c.start_variance)}</td>
                  <td>{hourToDateStr(c.bl_early_finish)}</td>
                  <td>{hourToDateStr(c.cur_early_finish)}</td>
                  <td style={varColor(c.finish_variance)}>{fmtVar(c.finish_variance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      ) : selectedBl != null ? (
        <p style={{ fontSize: '12px', color: 'var(--text-3)' }}>No comparison data available.</p>
      ) : null}
    </div>
  )
}
