import { useCallback, useEffect, useState } from 'react'
import { HOURS_PER_DAY, REF_MS } from '../utils/constants.js'

function hourToDateStr(h) {
  if (h == null || Number.isNaN(Number(h))) return '—'
  const ms = REF_MS + Number(h) * 3600000
  return new Date(ms).toISOString().slice(0, 10)
}

function fmtHr(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return Number(v).toFixed(2)
}

export default function ActivityDetailsPanel({ activity, projId, apiBase = '/api', onActivityUpdated, wbsList = [], relationships = [], activities = [] }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [addPred, setAddPred] = useState({ id: '', type: 'FS', lag: 0 })
  const [addSucc, setAddSucc] = useState({ id: '', type: 'FS', lag: 0 })

  useEffect(() => {
    setEditing(false)
    setError(null)
    if (activity) {
      setDraft({
        name: activity.name || '',
        duration_hrs: activity.duration_hrs ?? 0,
        wbs_id: activity.wbs_id || '',
        is_milestone: activity.is_milestone ? 1 : 0,
      })
    }
  }, [activity])

  const save = async () => {
    if (!activity || !projId) return
    setSaving(true)
    setError(null)
    try {
      const fields = {}
      if (draft.name !== (activity.name || '')) fields.name = draft.name
      if (Number(draft.duration_hrs) !== Number(activity.duration_hrs || 0)) fields.duration_hrs = Number(draft.duration_hrs)
      if (draft.wbs_id !== (activity.wbs_id || '')) fields.wbs_id = draft.wbs_id || null
      if (draft.is_milestone !== (activity.is_milestone ? 1 : 0)) fields.is_milestone = draft.is_milestone
      if (Object.keys(fields).length === 0) {
        setEditing(false)
        return
      }
      const res = await fetch(`${apiBase}/ai/projects/${encodeURIComponent(projId)}/activities/${encodeURIComponent(activity.task_id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Save failed')
      setEditing(false)
      onActivityUpdated?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const cancel = useCallback(() => {
    if (activity) {
      setDraft({
        name: activity.name || '',
        duration_hrs: activity.duration_hrs ?? 0,
        wbs_id: activity.wbs_id || '',
        is_milestone: activity.is_milestone ? 1 : 0,
      })
    }
    setEditing(false)
    setError(null)
  }, [activity])

  if (!activity) {
    return <p className="p6-detail-empty">Select an activity row to view details.</p>
  }

  const selectedWbs = editing && draft.wbs_id ? wbsList.find((w) => w.wbs_id === draft.wbs_id) : null
  const wbsDisplayName =
    selectedWbs?.wbs_name || selectedWbs?.wbs_short_name || activity.wbs_name || activity.wbs_short_name || '—'

  return (
    <div className="p6-detail-panel">
      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
        {!editing ? (
          <button type="button" className="btn-secondary" onClick={() => setEditing(true)} disabled={!projId}>
            Edit
          </button>
        ) : (
          <>
            <button type="button" className="btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn-secondary" onClick={cancel} disabled={saving}>
              Cancel
            </button>
          </>
        )}
        {error ? <span style={{ color: 'var(--red)', fontSize: '11px', alignSelf: 'center' }}>{error}</span> : null}
      </div>
      <div className="p6-detail-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
        <span className="p6-detail-label">WBS Name</span>
        <span className="p6-detail-value">{wbsDisplayName}</span>
      </div>
      <div className="p6-detail-grid">
        <div className="p6-detail-field">
          <span className="p6-detail-label">Activity ID</span>
          <span className="p6-detail-value">{activity.task_id}</span>
        </div>
        <div className="p6-detail-field p6-detail-span-2">
          <span className="p6-detail-label">Activity Name</span>
          {editing ? (
            <input
              type="text"
              className="p6-detail-value"
              style={{ width: '100%' }}
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          ) : (
            <span className="p6-detail-value">{activity.name || '—'}</span>
          )}
        </div>
        <div className="p6-detail-field">
          <span className="p6-detail-label">WBS ID</span>
          {editing ? (
            <select
              className="p6-detail-value"
              style={{ width: '100%' }}
              value={draft.wbs_id}
              onChange={(e) => setDraft((d) => ({ ...d, wbs_id: e.target.value }))}
            >
              <option value="">— None —</option>
              {wbsList.map((w) => (
                <option key={w.wbs_id} value={w.wbs_id}>
                  {w.wbs_name || w.wbs_short_name || w.wbs_id}
                </option>
              ))}
            </select>
          ) : (
            <span className="p6-detail-value">{activity.wbs_id ?? '—'}</span>
          )}
        </div>
        <div className="p6-detail-field">
          <span className="p6-detail-label">Original Duration (h)</span>
          {editing ? (
            <input
              type="number"
              step="1"
              min="0"
              className="p6-detail-value"
              style={{ width: '100%' }}
              value={draft.duration_hrs}
              onChange={(e) => setDraft((d) => ({ ...d, duration_hrs: e.target.value }))}
            />
          ) : (
            <span className="p6-detail-value">{fmtHr(activity.duration_hrs)}</span>
          )}
        </div>
        <div className="p6-detail-field">
          <span className="p6-detail-label">Remaining Duration (h)</span>
          <span className="p6-detail-value">{fmtHr(activity.remaining_duration_hrs ?? activity.duration_hrs)}</span>
        </div>
        <div className="p6-detail-field">
          <span className="p6-detail-label">Start</span>
          <span className="p6-detail-value">{hourToDateStr(activity.early_start)}</span>
        </div>
        <div className="p6-detail-field">
          <span className="p6-detail-label">Finish</span>
          <span className="p6-detail-value">{hourToDateStr(activity.early_finish)}</span>
        </div>
        <div className="p6-detail-field">
          <span className="p6-detail-label">Late Start</span>
          <span className="p6-detail-value">{hourToDateStr(activity.late_start)}</span>
        </div>
        <div className="p6-detail-field">
          <span className="p6-detail-label">Late Finish</span>
          <span className="p6-detail-value">{hourToDateStr(activity.late_finish)}</span>
        </div>
        <div className="p6-detail-field">
          <span className="p6-detail-label">Total Float (h)</span>
          <span className="p6-detail-value">{fmtHr(activity.total_float_hrs)}</span>
        </div>
        <div className="p6-detail-field">
          <span className="p6-detail-label">Total Float (d)</span>
          <span className="p6-detail-value">
            {activity.total_float_hrs != null && !Number.isNaN(Number(activity.total_float_hrs))
              ? (Number(activity.total_float_hrs) / HOURS_PER_DAY).toFixed(2)
              : '—'}
          </span>
        </div>
        <div className="p6-detail-field">
          <span className="p6-detail-label">Critical</span>
          <span className="p6-detail-value" style={activity.is_critical ? { color: 'var(--red)' } : undefined}>
            {activity.is_critical ? 'Yes' : 'No'}
          </span>
        </div>
        <div className="p6-detail-field">
          <span className="p6-detail-label">Milestone</span>
          {editing ? (
            <select
              className="p6-detail-value"
              style={{ width: '100%' }}
              value={draft.is_milestone}
              onChange={(e) => setDraft((d) => ({ ...d, is_milestone: Number(e.target.value) }))}
            >
              <option value={0}>No</option>
              <option value={1}>Yes</option>
            </select>
          ) : (
            <span className="p6-detail-value">{activity.is_milestone ? 'Yes' : 'No'}</span>
          )}
        </div>
        {/* Free Float */}
        <div className="p6-detail-field">
          <span className="p6-detail-label">Free Float (h)</span>
          <span className="p6-detail-value">{fmtHr(activity.free_float_hrs)}</span>
        </div>
        <div className="p6-detail-field">
          <span className="p6-detail-label">Free Float (d)</span>
          <span className="p6-detail-value">
            {activity.free_float_hrs != null && !Number.isNaN(Number(activity.free_float_hrs))
              ? (Number(activity.free_float_hrs) / HOURS_PER_DAY).toFixed(2)
              : '—'}
          </span>
        </div>
        {/* Progress */}
        <div className="p6-detail-field">
          <span className="p6-detail-label">% Complete</span>
          <span className="p6-detail-value">{activity.percent_complete != null ? `${Number(activity.percent_complete).toFixed(1)}%` : '0.0%'}</span>
        </div>
        <div className="p6-detail-field">
          <span className="p6-detail-label">Actual Start</span>
          <span className="p6-detail-value">{hourToDateStr(activity.actual_start)}</span>
        </div>
        <div className="p6-detail-field">
          <span className="p6-detail-label">Actual Finish</span>
          <span className="p6-detail-value">{hourToDateStr(activity.actual_finish)}</span>
        </div>
        {/* Constraint */}
        {activity.constraint_type ? (
          <div className="p6-detail-field">
            <span className="p6-detail-label">Constraint</span>
            <span className="p6-detail-value">
              {activity.constraint_type}
              {activity.constraint_date != null ? ` @ ${hourToDateStr(activity.constraint_date)}` : ''}
            </span>
          </div>
        ) : null}
        {/* Near-Critical indicator */}
        {activity.is_near_critical ? (
          <div className="p6-detail-field">
            <span className="p6-detail-label">Status</span>
            <span className="p6-detail-value" style={{ color: 'var(--amber)' }}>
              Near-Critical
            </span>
          </div>
        ) : null}
      </div>

      {/* Relationships */}
      {activity && projId && (() => {
        const tid = String(activity.task_id)
        const preds = relationships.filter((r) => String(r.succ_id) === tid)
        const succs = relationships.filter((r) => String(r.pred_id) === tid)
        const actMap = new Map(activities.map((a) => [String(a.task_id), a.name || '']))

        const deleteRel = async (relId) => {
          try {
            await fetch(`${apiBase}/ai/projects/${encodeURIComponent(projId)}/relationships/${relId}`, { method: 'DELETE' })
            onActivityUpdated?.()
          } catch { /* ignore */ }
        }

        const addRel = async (predId, succId, relType, lag) => {
          try {
            await fetch(`${apiBase}/ai/projects/${encodeURIComponent(projId)}/relationships`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pred_id: predId, succ_id: succId, rel_type: relType, lag_hrs: Number(lag) || 0 }),
            })
            onActivityUpdated?.()
          } catch { /* ignore */ }
        }

        return (
          <div style={{ marginTop: '16px' }}>
            <h4 style={{ fontSize: '11px', color: 'var(--text-2)', margin: '0 0 6px', fontWeight: 700 }}>Predecessors ({preds.length})</h4>
            {preds.length > 0 ? (
              <table className="activity-table" style={{ fontSize: '10px', marginBottom: '6px' }}>
                <thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Lag</th><th /></tr></thead>
                <tbody>
                  {preds.map((r) => (
                    <tr key={r.id}>
                      <td>{r.pred_id}</td>
                      <td>{actMap.get(String(r.pred_id)) || ''}</td>
                      <td>{r.rel_type}</td>
                      <td>{r.lag_hrs}</td>
                      <td><button type="button" className="btn-secondary" style={{ fontSize: '9px', padding: '1px 5px', color: 'var(--red)' }} onClick={() => deleteRel(r.id)}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p style={{ fontSize: '10px', color: 'var(--text-3)', margin: '0 0 6px' }}>None</p>}
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', fontSize: '10px', marginBottom: '12px' }}>
              <select value={addPred.id} onChange={(e) => setAddPred((p) => ({ ...p, id: e.target.value }))} style={{ fontSize: '10px', maxWidth: '120px' }}>
                <option value="">Pred ID…</option>
                {activities.filter((a) => String(a.task_id) !== tid).map((a) => (
                  <option key={a.task_id} value={a.task_id}>{a.task_id}</option>
                ))}
              </select>
              <select value={addPred.type} onChange={(e) => setAddPred((p) => ({ ...p, type: e.target.value }))} style={{ fontSize: '10px', width: '50px' }}>
                {['FS', 'SS', 'FF', 'SF'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="number" value={addPred.lag} onChange={(e) => setAddPred((p) => ({ ...p, lag: e.target.value }))} style={{ fontSize: '10px', width: '45px' }} placeholder="Lag" />
              <button type="button" className="btn-secondary" style={{ fontSize: '9px', padding: '2px 6px' }} disabled={!addPred.id}
                onClick={() => { addRel(addPred.id, tid, addPred.type, addPred.lag); setAddPred({ id: '', type: 'FS', lag: 0 }) }}>Add</button>
            </div>

            <h4 style={{ fontSize: '11px', color: 'var(--text-2)', margin: '0 0 6px', fontWeight: 700 }}>Successors ({succs.length})</h4>
            {succs.length > 0 ? (
              <table className="activity-table" style={{ fontSize: '10px', marginBottom: '6px' }}>
                <thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Lag</th><th /></tr></thead>
                <tbody>
                  {succs.map((r) => (
                    <tr key={r.id}>
                      <td>{r.succ_id}</td>
                      <td>{actMap.get(String(r.succ_id)) || ''}</td>
                      <td>{r.rel_type}</td>
                      <td>{r.lag_hrs}</td>
                      <td><button type="button" className="btn-secondary" style={{ fontSize: '9px', padding: '1px 5px', color: 'var(--red)' }} onClick={() => deleteRel(r.id)}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p style={{ fontSize: '10px', color: 'var(--text-3)', margin: '0 0 6px' }}>None</p>}
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', fontSize: '10px' }}>
              <select value={addSucc.id} onChange={(e) => setAddSucc((p) => ({ ...p, id: e.target.value }))} style={{ fontSize: '10px', maxWidth: '120px' }}>
                <option value="">Succ ID…</option>
                {activities.filter((a) => String(a.task_id) !== tid).map((a) => (
                  <option key={a.task_id} value={a.task_id}>{a.task_id}</option>
                ))}
              </select>
              <select value={addSucc.type} onChange={(e) => setAddSucc((p) => ({ ...p, type: e.target.value }))} style={{ fontSize: '10px', width: '50px' }}>
                {['FS', 'SS', 'FF', 'SF'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="number" value={addSucc.lag} onChange={(e) => setAddSucc((p) => ({ ...p, lag: e.target.value }))} style={{ fontSize: '10px', width: '45px' }} placeholder="Lag" />
              <button type="button" className="btn-secondary" style={{ fontSize: '9px', padding: '2px 6px' }} disabled={!addSucc.id}
                onClick={() => { addRel(tid, addSucc.id, addSucc.type, addSucc.lag); setAddSucc({ id: '', type: 'FS', lag: 0 }) }}>Add</button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
