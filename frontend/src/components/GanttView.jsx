import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import gantt from 'dhtmlx-gantt'
import 'dhtmlx-gantt/codebase/dhtmlxgantt.css'
import { buildGanttPayload } from '../utils/ganttTasks.js'
import { applyZoomPreset } from '../utils/ganttZoomPresets.js'

const GanttView = forwardRef(function GanttView(
  { displayRows, relationships, zoom, onZoomChange, tableScrollRef, syncScrollRef },
  ref,
) {
  const hostRef = useRef(null)
  const [error, setError] = useState(null)
  const ganttReadyRef = useRef(false)
  const ignoreNextScrollRef = useRef(false)
  const scrollEvRef = useRef(null)

  useImperativeHandle(
    ref,
    () => ({
      scrollToY(y) {
        if (!ganttReadyRef.current) return
        try {
          ignoreNextScrollRef.current = true
          const cur = gantt.getScrollState()
          gantt.scrollTo(cur.x, y)
        } catch {
          /* ignore */
        }
      },
      getScrollY() {
        try {
          return gantt.getScrollState()?.y ?? 0
        } catch {
          return 0
        }
      },
    }),
    [],
  )

  useEffect(() => {
    if (!displayRows?.length) return undefined
    const el = hostRef.current
    if (!el) return undefined

    let cancelled = false
    let raf2 = 0

    gantt.config.date_format = '%Y-%m-%d %H:%i'
    gantt.config.duration_unit = 'day'
    gantt.config.duration_step = 1
    gantt.config.scale_height = 32
    gantt.config.row_height = 20
    gantt.config.bar_height = 10
    gantt.config.link_line_width = 2
    gantt.config.show_links = true
    gantt.templates.task_class = function (_start, _end, task) {
      return task.critical ? 'critical_task' : ''
    }

    gantt.config.dark = true
    if (gantt.skins?.setActiveSkin) {
      try {
        gantt.skins.setActiveSkin('dhtmlx_material')
      } catch {
        /* skin may be unavailable in this build */
      }
    }

    try {
      gantt.init(el)
    } catch (e) {
      console.error(e)
      queueMicrotask(() => setError(e.message || 'Gantt init failed'))
      return undefined
    }

    ganttReadyRef.current = true

    if (scrollEvRef.current) {
      gantt.detachEvent(scrollEvRef.current)
      scrollEvRef.current = null
    }
    scrollEvRef.current = gantt.attachEvent('onGanttScroll', (left, top) => {
      if (ignoreNextScrollRef.current) {
        ignoreNextScrollRef.current = false
        return
      }
      if (syncScrollRef) syncScrollRef.current = true
      if (tableScrollRef?.current) {
        tableScrollRef.current.scrollTop = top
      }
      requestAnimationFrame(() => {
        if (syncScrollRef) syncScrollRef.current = false
      })
    })

    const pushData = () => {
      if (cancelled) return
      if (!gantt.$data) return
      try {
        setError(null)
        applyZoomPreset(zoom)
        const payload = buildGanttPayload(displayRows, relationships)
        if (typeof gantt.clearAll === 'function') {
          gantt.clearAll()
        }
        gantt.parse(payload)
        if (typeof gantt.render === 'function') {
          gantt.render()
        }
      } catch (e) {
        console.error(e)
        setError(e.message || 'Gantt parse error')
      }
    }

    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(pushData)
    })

    return () => {
      cancelled = true
      ganttReadyRef.current = false
      if (scrollEvRef.current) {
        try {
          gantt.detachEvent(scrollEvRef.current)
        } catch {
          /* ignore */
        }
        scrollEvRef.current = null
      }
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      try {
        if (typeof gantt.destructor === 'function') {
          gantt.destructor()
        }
      } catch {
        /* ignore */
      }
    }
  }, [displayRows, relationships, zoom, tableScrollRef, syncScrollRef])

  if (!displayRows?.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <p className="panel-placeholder gantt-placeholder">Import a project and run CPM to show the Gantt chart.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="gantt-toolbar">
        <span
          style={{
            fontSize: '11px',
            color: 'var(--text-3)',
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          Zoom
        </span>
        {['day', 'week', 'month'].map((z) => (
          <button
            key={z}
            type="button"
            className="btn-secondary"
            style={
              zoom === z
                ? {
                    borderColor: 'var(--indigo)',
                    color: 'var(--indigo)',
                    background: 'var(--indigo-dim)',
                  }
                : undefined
            }
            onClick={() => onZoomChange(z)}
          >
            {z.charAt(0).toUpperCase() + z.slice(1)}
          </button>
        ))}
        {error ? <span style={{ color: 'var(--red)', fontSize: '11px' }}>{error}</span> : null}
      </div>
      <div className="gantt-host" ref={hostRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  )
})

export default GanttView
