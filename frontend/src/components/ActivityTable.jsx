import { useCallback, useRef, useState } from 'react'

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
  const hasActualFinish = activity.actual_finish != null
  const hasActualStart = activity.actual_start != null
  const isMilestoneComplete = activity.is_milestone && dur <= 0
  const crit = !!activity.is_critical

  const classes = ['status-dot']
  if (hasActualFinish || isMilestoneComplete) {
    classes.push('complete')
  } else if (hasActualStart || (crit && hasES)) {
    classes.push('in-progress')
    if (crit) classes.push('crit')
  } else if (crit && !hasES) {
    classes.push('not-started', 'crit')
  } else if (!crit && hasES) {
    classes.push('in-progress')
  } else {
    classes.push('not-started')
  }

  return (
    <span
      className={classes.join(' ')}
      title={activity.is_near_critical ? 'Near-critical' : crit ? 'Critical' : 'Not started'}
      aria-hidden
    />
  )
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
  const [colWidths, setColWidths] = useState({
    id: 80,
    name: 260,
    orig: 55,
    rem: 55,
    start: 88,
    finish: 88,
    lstart: 88,
    lfinish: 88,
    float: 65,
  })
  const resizingRef = useRef(null)

  const onResizeMouseDown = useCallback((e, col) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = colWidths[col]
    resizingRef.current = { col, startX, startW }

    const onMove = (ev) => {
      if (!resizingRef.current) return
      const { col: c, startX: sx, startW: sw } = resizingRef.current
      const newW = Math.max(40, sw + (ev.clientX - sx))
      setColWidths((prev) => ({ ...prev, [c]: newW }))
    }
    const onUp = () => {
      resizingRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [colWidths])

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
        <table className="activity-table" style={{ tableLayout: 'fixed', width: '100%' }}>
          <thead>
            <tr>
              <th title="Status" />
              <th
                onClick={() => toggleSort('task_id')}
                style={{ width: colWidths.id, position: 'relative' }}
              >
                Activity ID
                <div
                  className="col-resize-handle"
                  onMouseDown={(e) => onResizeMouseDown(e, 'id')}
                />
              </th>
              <th
                onClick={() => toggleSort('name')}
                style={{ width: colWidths.name, position: 'relative' }}
              >
                Activity Name
                <div
                  className="col-resize-handle"
                  onMouseDown={(e) => onResizeMouseDown(e, 'name')}
                />
              </th>
              <th
                onClick={() => toggleSort('duration_hrs')}
                style={{ width: colWidths.orig, position: 'relative' }}
              >
                Orig Dur
                <div
                  className="col-resize-handle"
                  onMouseDown={(e) => onResizeMouseDown(e, 'orig')}
                />
              </th>
              <th style={{ width: colWidths.rem, position: 'relative' }}>
                Rem Dur
                <div
                  className="col-resize-handle"
                  onMouseDown={(e) => onResizeMouseDown(e, 'rem')}
                />
              </th>
              <th
                onClick={() => toggleSort('early_start')}
                style={{ width: colWidths.start, position: 'relative' }}
              >
                Start
                <div
                  className="col-resize-handle"
                  onMouseDown={(e) => onResizeMouseDown(e, 'start')}
                />
              </th>
              <th
                onClick={() => toggleSort('early_finish')}
                style={{ width: colWidths.finish, position: 'relative' }}
              >
                Finish
                <div
                  className="col-resize-handle"
                  onMouseDown={(e) => onResizeMouseDown(e, 'finish')}
                />
              </th>
              <th
                onClick={() => toggleSort('late_start')}
                style={{ width: colWidths.lstart, position: 'relative' }}
              >
                Late Start
                <div
                  className="col-resize-handle"
                  onMouseDown={(e) => onResizeMouseDown(e, 'lstart')}
                />
              </th>
              <th
                onClick={() => toggleSort('late_finish')}
                style={{ width: colWidths.lfinish, position: 'relative' }}
              >
                Late Finish
                <div
                  className="col-resize-handle"
                  onMouseDown={(e) => onResizeMouseDown(e, 'lfinish')}
                />
              </th>
              <th
                onClick={() => toggleSort('total_float_hrs')}
                style={{ width: colWidths.float, position: 'relative' }}
              >
                Total Float
                <div
                  className="col-resize-handle"
                  onMouseDown={(e) => onResizeMouseDown(e, 'float')}
                />
              </th>
              <th onClick={() => toggleSort('free_float_hrs')}>Free Float</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.length === 0 && (
              <tr>
                <td
                  colSpan={11}
                  style={{
                    textAlign: 'center',
                    padding: '48px 16px',
                    color: 'var(--text-3)',
                    fontSize: '12px',
                    fontStyle: 'italic',
                  }}
                >
                  {activitiesCount === 0
                    ? 'Import a .xer file and select a project to view activities'
                    : 'No activities match the current filters'}
                </td>
              </tr>
            )}
            {displayRows.map((row) => {
              if (row.kind === 'wbs') {
                const lvl = wbsLevelClass(row.level)
                return (
                  <tr key={row.id} className={`wbs-band ${lvl}`}>
                    <td />
                    <td colSpan={10}>{row.label}</td>
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
                  <td title={a.wbs_name || a.wbs_id || ''}>{a.name}</td>
                  <td>{fmtHr(a.duration_hrs)}</td>
                  <td>{fmtHr(a.remaining_duration_hrs != null ? a.remaining_duration_hrs : a.duration_hrs)}</td>
                  <td>{hourToDateStr(a.early_start)}</td>
                  <td>{hourToDateStr(a.early_finish)}</td>
                  <td>{hourToDateStr(a.late_start)}</td>
                  <td>{hourToDateStr(a.late_finish)}</td>
                  <td>{fmtDays(a.total_float_hrs)}</td>
                  <td>{fmtDays(a.free_float_hrs)}</td>
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
