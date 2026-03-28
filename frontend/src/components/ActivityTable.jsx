import { useCallback, useMemo, useRef } from 'react'

const HOURS_PER_DAY = 8
const REF_MS = Date.UTC(2025, 0, 6, 8, 0, 0)

function fmtHr(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return Number(v).toFixed(2)
}

function fmtDays(h) {
  if (h == null || Number.isNaN(Number(h))) return '—'
  return (Number(h) / HOURS_PER_DAY).toFixed(2)
}

function hourToDateStr(h) {
  if (h == null || Number.isNaN(Number(h))) return '—'
  const ms = REF_MS + Number(h) * 3600000
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * P6-style status (heuristic from CPM fields).
 */
function StatusIcon({ activity }) {
  const hasES = activity.early_start != null
  const dur = Number(activity.duration_hrs) || 0
  const isComplete = activity.is_milestone && dur <= 0
  const crit = !!activity.is_critical

  const classes = ['status-dot']
  if (isComplete) {
    classes.push('complete')
  } else if (crit && hasES) {
    classes.push('in-progress', 'crit')
  } else if (crit && !hasES) {
    classes.push('not-started', 'crit')
  } else if (!crit && hasES) {
    classes.push('in-progress')
  } else {
    classes.push('not-started')
  }

  return <span className={classes.join(' ')} title="Schedule status (heuristic)" aria-hidden />
}

function wbsLevelClass(level) {
  if (level <= 1) return 'wbs-l1'
  if (level === 2) return 'wbs-l2'
  return 'wbs-l3'
}

export default function ActivityTable({
  displayRows = [],
  activitiesCount = 0,
  setSort,
  selectedId,
  onSelectActivity,
  filterSearch,
  onFilterSearch,
  criticalOnly,
  onCriticalOnly,
  longestPathOnly,
  onLongestPathOnly,
  groupByWbs,
  onGroupByWbs,
  tableScrollRef,
  onTableScroll,
}) {
  const internalRef = useRef(null)
  const scrollRef = tableScrollRef || internalRef

  const toggleSort = useCallback(
    (key) => {
      setSort((prev) =>
        prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
      )
    },
    [setSort],
  )

  const activityCount = displayRows.filter((r) => r.kind === 'activity').length

  const handleScroll = (e) => {
    onTableScroll?.(e)
  }

  return (
    <div className="activity-stack">
      <div className="table-filters">
        <input
          type="search"
          placeholder="Filter by ID or name…"
          value={filterSearch}
          onChange={(e) => onFilterSearch(e.target.value)}
        />
        <label>
          <input type="checkbox" checked={criticalOnly} onChange={(e) => onCriticalOnly(e.target.checked)} />
          Critical only
        </label>
        <label>
          <input
            type="checkbox"
            checked={longestPathOnly}
            onChange={(e) => onLongestPathOnly(e.target.checked)}
          />
          Longest path only
        </label>
        <button
          type="button"
          className="btn-secondary"
          style={
            groupByWbs
              ? {
                  borderColor: 'var(--indigo)',
                  color: 'var(--indigo)',
                  background: 'var(--indigo-dim)',
                }
              : undefined
          }
          onClick={() => onGroupByWbs(!groupByWbs)}
        >
          Group by WBS
        </button>
        <span className="filter-count">
          {activityCount} of {activitiesCount} activities
        </span>
      </div>

      <div className="activity-table-wrap" ref={scrollRef} onScroll={handleScroll}>
        <table className="activity-table">
          <thead>
            <tr>
              <th title="Status" />
              <th onClick={() => toggleSort('task_id')}>Activity ID</th>
              <th onClick={() => toggleSort('name')}>Activity Name</th>
              <th onClick={() => toggleSort('duration_hrs')}>Orig Dur</th>
              <th>Rem Dur</th>
              <th onClick={() => toggleSort('early_start')}>Start</th>
              <th onClick={() => toggleSort('early_finish')}>Finish</th>
              <th onClick={() => toggleSort('late_start')}>Late Start</th>
              <th onClick={() => toggleSort('late_finish')}>Late Finish</th>
              <th onClick={() => toggleSort('total_float_hrs')}>Total Float</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row) => {
              if (row.kind === 'wbs') {
                const lvl = wbsLevelClass(row.level)
                return (
                  <tr key={row.id} className={`wbs-band ${lvl}`}>
                    <td />
                    <td colSpan={9}>{row.label}</td>
                  </tr>
                )
              }

              const a = row.activity
              const id = String(a.task_id)
              const isSel = selectedId === id
              const isCrit = !!a.is_critical
              const rowCls = [isCrit ? 'critical' : '', isSel ? 'selected' : ''].filter(Boolean).join(' ')

              return (
                <tr
                  key={id}
                  className={rowCls}
                  onClick={() => onSelectActivity?.(a)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelectActivity?.(a)
                    }
                  }}
                  tabIndex={0}
                  role="row"
                >
                  <td style={{ textAlign: 'center' }}>
                    <StatusIcon activity={a} />
                  </td>
                  <td>{id}</td>
                  <td>{a.name}</td>
                  <td>{fmtHr(a.duration_hrs)}</td>
                  <td>{fmtHr(a.duration_hrs)}</td>
                  <td>{hourToDateStr(a.early_start)}</td>
                  <td>{hourToDateStr(a.early_finish)}</td>
                  <td>{hourToDateStr(a.late_start)}</td>
                  <td>{hourToDateStr(a.late_finish)}</td>
                  <td>{fmtDays(a.total_float_hrs)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="table-footnote">
        Dates are linear projections from a reference start ({HOURS_PER_DAY} h/day). Status dots are heuristic.
      </p>
    </div>
  )
}
