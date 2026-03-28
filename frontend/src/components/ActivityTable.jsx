import { useMemo, useState } from 'react'

const HOURS_PER_DAY = 8
/** Reference instant for hour-offset → calendar (linear, not P6 calendar logic). */
const REF_MS = Date.UTC(2025, 0, 6, 8, 0, 0)

function fmtHr(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return Number(v).toFixed(2)
}

function fmtDays(h) {
  if (h == null || Number.isNaN(Number(h))) return '—'
  return (Number(h) / HOURS_PER_DAY).toFixed(2)
}

/** Convert CPM hour offset to calendar date YYYY-MM-DD (UTC). */
function hourToDateStr(h) {
  if (h == null || Number.isNaN(Number(h))) return '—'
  const ms = REF_MS + Number(h) * 3600000
  return new Date(ms).toISOString().slice(0, 10)
}

export default function ActivityTable({ activities }) {
  const [search, setSearch] = useState('')
  const [criticalOnly, setCriticalOnly] = useState(false)
  const [sort, setSort] = useState({ key: 'task_id', dir: 'asc' })

  const filtered = useMemo(() => {
    let rows = activities || []
    if (search.trim()) {
      const s = search.toLowerCase()
      rows = rows.filter(
        (a) =>
          String(a.task_id).includes(s) ||
          (a.name && a.name.toLowerCase().includes(s)),
      )
    }
    if (criticalOnly) rows = rows.filter((a) => a.is_critical)
    return rows
  }, [activities, search, criticalOnly])

  const sorted = useMemo(() => {
    const { key, dir } = sort
    const mul = dir === 'asc' ? 1 : -1
    const copy = [...filtered]
    copy.sort((a, b) => {
      const va = a[key]
      const vb = b[key]
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul
      return String(va).localeCompare(String(vb)) * mul
    })
    return copy
  }, [filtered, sort])

  const toggleSort = (key) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    )
  }

  return (
    <div>
      <div className="table-filters">
        <input
          type="search"
          placeholder="Filter by ID or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={criticalOnly}
            onChange={(e) => setCriticalOnly(e.target.checked)}
          />{' '}
          Critical only
        </label>
      </div>
      <div className="activity-table-wrap">
        <table className="activity-table">
          <thead>
            <tr>
              <th onClick={() => toggleSort('task_id')}>ID</th>
              <th onClick={() => toggleSort('name')}>Name</th>
              <th onClick={() => toggleSort('duration_hrs')}>Dur (h)</th>
              <th>Dur (d)</th>
              <th onClick={() => toggleSort('early_start')}>ES (date)</th>
              <th onClick={() => toggleSort('early_finish')}>EF (date)</th>
              <th onClick={() => toggleSort('late_start')}>LS (date)</th>
              <th onClick={() => toggleSort('late_finish')}>LF (date)</th>
              <th onClick={() => toggleSort('total_float_hrs')}>TF (d)</th>
              <th>Critical</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => (
              <tr key={a.task_id} className={a.is_critical ? 'critical' : ''}>
                <td>{a.task_id}</td>
                <td>{a.name}</td>
                <td>{fmtHr(a.duration_hrs)}</td>
                <td>{fmtDays(a.duration_hrs)}</td>
                <td>{hourToDateStr(a.early_start)}</td>
                <td>{hourToDateStr(a.early_finish)}</td>
                <td>{hourToDateStr(a.late_start)}</td>
                <td>{hourToDateStr(a.late_finish)}</td>
                <td>{fmtDays(a.total_float_hrs)}</td>
                <td>{a.is_critical ? 'Yes' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: '0.5rem' }}>
        Showing {sorted.length} of {activities?.length ?? 0} activities. Dates are linear projections from a
        reference start ({HOURS_PER_DAY} h/day).
      </p>
    </div>
  )
}
