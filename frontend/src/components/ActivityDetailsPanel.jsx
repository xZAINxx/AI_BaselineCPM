const HOURS_PER_DAY = 8

const REF_MS = Date.UTC(2025, 0, 6, 8, 0, 0)

function hourToDateStr(h) {
  if (h == null || Number.isNaN(Number(h))) return '—'
  const ms = REF_MS + Number(h) * 3600000
  return new Date(ms).toISOString().slice(0, 10)
}

function fmtHr(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return Number(v).toFixed(2)
}

export default function ActivityDetailsPanel({ activity }) {
  if (!activity) {
    return <p className="p6-detail-empty">Select an activity row to view details.</p>
  }

  return (
    <div className="p6-detail-grid">
      <div className="p6-detail-field">
        <span className="p6-detail-label">Activity ID</span>
        <span className="p6-detail-value">{activity.task_id}</span>
      </div>
      <div className="p6-detail-field p6-detail-span-2">
        <span className="p6-detail-label">Activity Name</span>
        <span className="p6-detail-value">{activity.name || '—'}</span>
      </div>
      <div className="p6-detail-field">
        <span className="p6-detail-label">WBS</span>
        <span className="p6-detail-value">{activity.wbs_id ?? '—'}</span>
      </div>
      <div className="p6-detail-field">
        <span className="p6-detail-label">Original Duration (h)</span>
        <span className="p6-detail-value">{fmtHr(activity.duration_hrs)}</span>
      </div>
      <div className="p6-detail-field">
        <span className="p6-detail-label">Remaining Duration (h)</span>
        <span className="p6-detail-value">{fmtHr(activity.duration_hrs)}</span>
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
        <span className="p6-detail-value">{activity.is_critical ? 'Yes' : 'No'}</span>
      </div>
      <div className="p6-detail-field">
        <span className="p6-detail-label">Milestone</span>
        <span className="p6-detail-value">{activity.is_milestone ? 'Yes' : 'No'}</span>
      </div>
    </div>
  )
}
