import { useEffect, useRef, useState } from 'react'
import gantt from 'dhtmlx-gantt'
import 'dhtmlx-gantt/codebase/dhtmlxgantt.css'

const HOURS_PER_DAY = 8
const BASE_MS = Date.UTC(2025, 0, 6, 8, 0, 0)

function hourToStr(h) {
  if (h == null || Number.isNaN(Number(h))) return '2025-01-06 08:00'
  const ms = BASE_MS + Number(h) * 3600000
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}`
}

function predTypeToLinkType(predType) {
  const t = (predType || 'FS').toUpperCase()
  if (t === 'SS') return 1
  if (t === 'FF') return 2
  if (t === 'SF') return 3
  return 0
}

function applyZoomPreset(level) {
  if (level === 'day') {
    gantt.config.scale_unit = 'day'
    gantt.config.step = 1
    gantt.config.date_scale = '%d %M'
    gantt.config.subscales = [{ unit: 'hour', step: 8, date: '%H' }]
  } else if (level === 'week') {
    gantt.config.scale_unit = 'week'
    gantt.config.step = 1
    gantt.config.date_scale = 'Week %W'
    gantt.config.subscales = [{ unit: 'day', step: 1, date: '%d %M' }]
  } else {
    gantt.config.scale_unit = 'month'
    gantt.config.step = 1
    gantt.config.date_scale = '%M %Y'
    gantt.config.subscales = [{ unit: 'week', step: 1, date: 'W%W' }]
  }
  if (gantt.ext && gantt.ext.zoom && typeof gantt.ext.zoom.setLevel === 'function') {
    try {
      gantt.ext.zoom.setLevel(level)
    } catch {
      /* fall back to manual scales */
    }
  }
}

export default function GanttView({ activities, relationships, zoom, onZoomChange }) {
  const hostRef = useRef(null)
  const inited = useRef(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!hostRef.current || inited.current) return
    gantt.config.date_format = '%Y-%m-%d %H:%i'
    gantt.config.duration_unit = 'day'
    gantt.config.duration_step = 1
    gantt.config.scale_height = 36
    gantt.config.row_height = 28
    gantt.config.link_line_width = 2
    gantt.config.show_links = true
    gantt.templates.task_class = function (_start, _end, task) {
      return task.critical ? 'critical_task' : ''
    }
    gantt.init(hostRef.current)
    inited.current = true
    return () => {
      try {
        gantt.clearAll()
        if (typeof gantt.destructor === 'function') gantt.destructor()
      } catch {
        /* ignore */
      }
      inited.current = false
    }
  }, [])

  useEffect(() => {
    if (!inited.current) return
    setError(null)
    try {
      applyZoomPreset(zoom)

      const tasks = (activities || []).map((a) => {
        const es = a.early_start
        const dur = Number(a.duration_hrs) || 0
        const start = es != null ? hourToStr(es) : hourToStr(0)
        const isMile = a.is_milestone || dur <= 0
        const durDays = dur / HOURS_PER_DAY
        return {
          id: String(a.task_id),
          text: a.name || `Task ${a.task_id}`,
          start_date: start,
          duration: isMile ? 0 : Math.max(durDays, 0.01),
          type: isMile ? 'milestone' : 'task',
          critical: !!a.is_critical,
        }
      })

      const links = (relationships || []).map((r, idx) => ({
        id: String(r.id ?? idx),
        source: String(r.pred_id ?? r.pred_task_id),
        target: String(r.succ_id ?? r.succ_task_id),
        type: predTypeToLinkType(r.rel_type ?? r.pred_type),
      }))

      gantt.clearAll()
      gantt.parse({ data: tasks, links })
    } catch (e) {
      console.error(e)
      setError(e.message || 'Gantt error')
    }
  }, [activities, relationships, zoom])

  if (!activities?.length) {
    return <p className="panel-placeholder">Import a project and run CPM to populate the Gantt chart.</p>
  }

  return (
    <div>
      <div className="gantt-toolbar">
        <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Zoom:</span>
        {['day', 'week', 'month'].map((z) => (
          <button
            key={z}
            type="button"
            className="btn-secondary"
            style={zoom === z ? { borderColor: 'var(--accent)', fontWeight: 600 } : undefined}
            onClick={() => onZoomChange(z)}
          >
            {z.charAt(0).toUpperCase() + z.slice(1)}
          </button>
        ))}
      </div>
      {error ? <p className="error">{error}</p> : null}
      <div className="gantt-host" ref={hostRef} />
    </div>
  )
}
