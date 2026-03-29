import { useCallback, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { HOURS_PER_DAY, REF_MS, hourToDateStr, fmtDays } from '../utils/constants.js'

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

function SortArrow({ sortState, column }) {
  if (sortState?.key !== column) return null
  return (
    <span style={{ fontSize: '8px', color: 'var(--text-2)', marginLeft: '4px' }}>
      {sortState.dir === 'asc' ? '▲' : '▼'}
    </span>
  )
}

function getDateStr(activity, field, calendarDates) {
  if (calendarDates) {
    const cal = calendarDates[String(activity.task_id)]
    if (cal && cal[field]) return cal[field]
  }
  return hourToDateStr(activity[field])
}

export default function ActivityTable({
  displayRows = [],
  activitiesCount = 0,
  sort: sortState,
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
  useCalendarDates,
  onUseCalendarDates,
  calendarDates,
  tableScrollRef,
  onTableScroll,
}) {
  const [colWidths, setColWidths] = useState({
    id: 100,
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

  const virtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 30,
    overscan: 10,
  })

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
        {onUseCalendarDates ? (
          <button
            type="button"
            className="btn-secondary"
            style={useCalendarDates ? {
              borderColor: 'var(--indigo)',
              color: 'var(--indigo)',
              background: 'var(--indigo-dim)',
            } : undefined}
            onClick={() => onUseCalendarDates(!useCalendarDates)}
          >
            Calendar Dates
          </button>
        ) : null}
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
                style={{ width: colWidths.id, position: 'relative', cursor: 'pointer' }}
              >
                Activity ID<SortArrow sortState={sortState} column="task_id" />
                <div className="col-resize-handle" onMouseDown={(e) => onResizeMouseDown(e, 'id')} />
              </th>
              <th
                onClick={() => toggleSort('name')}
                style={{ width: colWidths.name, position: 'relative', cursor: 'pointer' }}
              >
                Activity Name<SortArrow sortState={sortState} column="name" />
                <div className="col-resize-handle" onMouseDown={(e) => onResizeMouseDown(e, 'name')} />
              </th>
              <th
                onClick={() => toggleSort('duration_hrs')}
                style={{ width: colWidths.orig, position: 'relative', cursor: 'pointer' }}
              >
                Orig Dur (d)<SortArrow sortState={sortState} column="duration_hrs" />
                <div className="col-resize-handle" onMouseDown={(e) => onResizeMouseDown(e, 'orig')} />
              </th>
              <th style={{ width: colWidths.rem, position: 'relative' }}>
                Rem Dur (d)
                <div className="col-resize-handle" onMouseDown={(e) => onResizeMouseDown(e, 'rem')} />
              </th>
              <th
                onClick={() => toggleSort('early_start')}
                style={{ width: colWidths.start, position: 'relative', cursor: 'pointer' }}
              >
                Start<SortArrow sortState={sortState} column="early_start" />
                <div className="col-resize-handle" onMouseDown={(e) => onResizeMouseDown(e, 'start')} />
              </th>
              <th
                onClick={() => toggleSort('early_finish')}
                style={{ width: colWidths.finish, position: 'relative', cursor: 'pointer' }}
              >
                Finish<SortArrow sortState={sortState} column="early_finish" />
                <div className="col-resize-handle" onMouseDown={(e) => onResizeMouseDown(e, 'finish')} />
              </th>
              <th
                onClick={() => toggleSort('late_start')}
                style={{ width: colWidths.lstart, position: 'relative', cursor: 'pointer' }}
              >
                Late Start<SortArrow sortState={sortState} column="late_start" />
                <div className="col-resize-handle" onMouseDown={(e) => onResizeMouseDown(e, 'lstart')} />
              </th>
              <th
                onClick={() => toggleSort('late_finish')}
                style={{ width: colWidths.lfinish, position: 'relative', cursor: 'pointer' }}
              >
                Late Finish<SortArrow sortState={sortState} column="late_finish" />
                <div className="col-resize-handle" onMouseDown={(e) => onResizeMouseDown(e, 'lfinish')} />
              </th>
              <th
                onClick={() => toggleSort('total_float_hrs')}
                style={{ width: colWidths.float, position: 'relative', cursor: 'pointer' }}
              >
                TF (d)<SortArrow sortState={sortState} column="total_float_hrs" />
                <div className="col-resize-handle" onMouseDown={(e) => onResizeMouseDown(e, 'float')} />
              </th>
              <th onClick={() => toggleSort('free_float_hrs')} style={{ cursor: 'pointer' }}>
                FF (d)<SortArrow sortState={sortState} column="free_float_hrs" />
              </th>
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
            {displayRows.length > 0 && (
              <tr>
                <td colSpan={11} style={{ padding: 0, border: 'none' }}>
                  <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                    {virtualizer.getVirtualItems().map((vRow) => {
                      const row = displayRows[vRow.index]
                      if (row.kind === 'wbs') {
                        const lvl = wbsLevelClass(row.level)
                        return (
                          <div
                            key={row.id}
                            className={`vrow wbs-band-v ${lvl}`}
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              height: 30,
                              transform: `translateY(${vRow.start}px)`,
                            }}
                          >
                            {row.label}
                          </div>
                        )
                      }
                      const a = row.activity
                      const id = String(a.task_id)
                      const isSel = selectedId === id
                      const isCrit = !!a.is_critical
                      const cls = ['vrow', isCrit ? 'critical' : '', isSel ? 'selected' : ''].filter(Boolean).join(' ')
                      return (
                        <div
                          key={id}
                          className={cls}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: 30,
                            transform: `translateY(${vRow.start}px)`,
                            display: 'flex',
                            alignItems: 'center',
                            cursor: 'pointer',
                          }}
                          onClick={() => onSelectActivity?.(a)}
                          role="row"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              onSelectActivity?.(a)
                            }
                          }}
                        >
                          <span style={{ width: 28, textAlign: 'center', flexShrink: 0 }}><StatusIcon activity={a} /></span>
                          <span style={{ width: colWidths.id, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.task_code || id}</span>
                          <span style={{ width: colWidths.name, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis' }} title={a.wbs_name || a.wbs_id || ''}>{a.name}</span>
                          <span style={{ width: colWidths.orig, flexShrink: 0, textAlign: 'center' }}>{fmtDays(a.duration_hrs)}</span>
                          <span style={{ width: colWidths.rem, flexShrink: 0, textAlign: 'center' }}>{fmtDays(a.remaining_duration_hrs != null ? a.remaining_duration_hrs : a.duration_hrs)}</span>
                          <span style={{ width: colWidths.start, flexShrink: 0, textAlign: 'center' }}>{getDateStr(a, 'early_start', calendarDates)}</span>
                          <span style={{ width: colWidths.finish, flexShrink: 0, textAlign: 'center' }}>{getDateStr(a, 'early_finish', calendarDates)}</span>
                          <span style={{ width: colWidths.lstart, flexShrink: 0, textAlign: 'center' }}>{getDateStr(a, 'late_start', calendarDates)}</span>
                          <span style={{ width: colWidths.lfinish, flexShrink: 0, textAlign: 'center' }}>{getDateStr(a, 'late_finish', calendarDates)}</span>
                          <span style={{ width: colWidths.float, flexShrink: 0, textAlign: 'center' }}>{fmtDays(a.total_float_hrs)}</span>
                          <span style={{ width: 65, flexShrink: 0, textAlign: 'center' }}>{fmtDays(a.free_float_hrs)}</span>
                        </div>
                      )
                    })}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="table-footnote">
        Dates projected from reference start (8h/day). Durations and float in working days.
      </p>
    </div>
  )
}
