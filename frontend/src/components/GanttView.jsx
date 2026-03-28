import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import gantt from 'dhtmlx-gantt'
import { buildGanttPayload } from '../utils/ganttTasks.js'
import { applyZoomPreset } from '../utils/ganttZoomPresets.js'
import { REF_MS } from '../utils/constants.js'

const GanttView = forwardRef(function GanttView(
  { displayRows, relationships, zoom, onZoomChange, tableScrollRef, syncScrollRef, onTaskClick },
  ref,
) {
  const hostRef = useRef(null)
  const [error, setError] = useState(null)
  const readyRef = useRef(false)
  const scrollEvRef = useRef(null)
  const ignoreNextScrollRef = useRef(false)
  const onTaskClickRef = useRef(onTaskClick)
  onTaskClickRef.current = onTaskClick
  const todayMarkerRef = useRef(null)

  /* ── expose scroll helpers ── */
  useImperativeHandle(ref, () => ({
    scrollToY(y) {
      if (!readyRef.current) return
      try {
        ignoreNextScrollRef.current = true
        const cur = gantt.getScrollState()
        gantt.scrollTo(cur?.x ?? 0, y)
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
  }), [])

  /* ── EFFECT 1: init once on mount, destroy on unmount ── */
  useEffect(() => {
    const el = hostRef.current
    if (!el) return

    gantt.config.fit_tasks = false
    gantt.config.show_task_cells = true
    gantt.config.smart_rendering = false
    gantt.config.date_format = '%Y-%m-%d %H:%i'
    gantt.config.xml_date = '%Y-%m-%d %H:%i'
    gantt.config.start_date = new Date(2025, 0, 1)
    gantt.config.end_date = new Date(2026, 2, 1)
    gantt.config.duration_unit = 'day'
    gantt.config.duration_step = 1
    gantt.config.scale_height = 32
    gantt.config.row_height = 24
    gantt.config.bar_height = 16
    gantt.config.link_line_width = 2
    gantt.config.show_links = true
    gantt.config.dark = true
    gantt.config.drag_move = false
    gantt.config.drag_resize = false
    gantt.config.drag_links = false
    gantt.config.drag_progress = false
    gantt.config.show_progress = true
    gantt.templates.task_text = (_start, _end, task) => {
      if (!task) return ''
      const raw = String(task.text ?? task.id ?? '').trim()
      if (!raw) return ''
      return raw.length > 48 ? `${raw.slice(0, 45)}…` : raw
    }

    gantt.templates.task_class = (_s, _e, task) => (task.critical ? 'critical_task' : '')

    if (gantt.skins?.setActiveSkin) {
      try {
        gantt.skins.setActiveSkin('dhtmlx_material')
      } catch {
        /* ignore */
      }
    }

    try {
      gantt.init(el)
    } catch (e) {
      console.error(e)
      queueMicrotask(() => setError(e?.message || 'Gantt init failed'))
      return undefined
    }

    readyRef.current = true

    scrollEvRef.current = gantt.attachEvent('onGanttScroll', (_left, top) => {
      if (ignoreNextScrollRef.current) {
        ignoreNextScrollRef.current = false
        return
      }
      if (syncScrollRef) syncScrollRef.current = true
      if (tableScrollRef?.current) tableScrollRef.current.scrollTop = top
      requestAnimationFrame(() => {
        if (syncScrollRef) syncScrollRef.current = false
      })
    })

    gantt.attachEvent('onTaskClick', (id) => {
      onTaskClickRef.current?.(id)
      return true
    })

    return () => {
      readyRef.current = false
      if (scrollEvRef.current) {
        try {
          gantt.detachEvent(scrollEvRef.current)
        } catch {
          /* ignore */
        }
        scrollEvRef.current = null
      }
      /* Do not call gantt.destructor(): it deletes $data (tasksStore). The replaced
       * gantt.init shim then calls _reinit on remount (e.g. React Strict Mode) and
       * crashes in _update_flags. clearAll + detach is enough for teardown. */
      try {
        gantt.clearAll()
      } catch {
        /* ignore */
      }
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- init/destroy once */
  }, [])

  /* ── EFFECT 2: parse data whenever inputs change ── */
  useEffect(() => {
    if (!readyRef.current) return
    if (!displayRows?.length) {
      try {
        gantt.clearAll()
      } catch {
        /* ignore */
      }
      return
    }

    const id = requestAnimationFrame(() => {
      if (!readyRef.current) return
      try {
        setError(null)

        let minH = Infinity, maxH = -Infinity
        for (const row of displayRows) {
          if (row.kind !== 'activity') continue
          const a = row.activity
          if (a.early_start != null && Number.isFinite(Number(a.early_start))) minH = Math.min(minH, Number(a.early_start))
          if (a.early_finish != null && Number.isFinite(Number(a.early_finish))) maxH = Math.max(maxH, Number(a.early_finish))
        }
        if (Number.isFinite(minH) && Number.isFinite(maxH)) {
          const PAD_BEFORE = 14 * 24
          const PAD_AFTER = 28 * 24
          gantt.config.start_date = new Date(REF_MS + (minH - PAD_BEFORE) * 3600000)
          gantt.config.end_date = new Date(REF_MS + (maxH + PAD_AFTER) * 3600000)
        } else {
          gantt.config.start_date = new Date(2025, 0, 1)
          gantt.config.end_date = new Date(2026, 2, 1)
        }

        applyZoomPreset(zoom)
        const payload = buildGanttPayload(displayRows, relationships)
        if (todayMarkerRef.current != null) {
          try { gantt.deleteMarker(todayMarkerRef.current) } catch { /* ignore */ }
          todayMarkerRef.current = null
        }
        gantt.clearAll()
        gantt.parse(payload)
        try {
          todayMarkerRef.current = gantt.addMarker({
            start_date: new Date(),
            css: 'today',
            text: 'Today',
          })
        } catch { /* ignore */ }
        try {
          gantt.sort('start_date', false)
        } catch {
          /* ignore */
        }
        gantt.render()
      } catch (e) {
        console.error('Gantt parse error:', e)
        setError(e?.message || 'Gantt error')
      }
    })

    return () => cancelAnimationFrame(id)
  }, [displayRows, relationships, zoom])

  const hasData = !!displayRows?.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {hasData ? (
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
          {error ? (
            <span style={{ color: 'var(--red)', fontSize: '11px', marginLeft: '8px' }}>{error}</span>
          ) : null}
        </div>
      ) : null}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {!hasData ? (
          <p
            className="panel-placeholder gantt-placeholder"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: 0,
              zIndex: 1,
              pointerEvents: 'none',
            }}
          >
            Import a project and run CPM to show the Gantt chart.
          </p>
        ) : null}
        <div
          className="gantt-host"
          ref={hostRef}
          style={{
            flex: 1,
            minHeight: 0,
            opacity: hasData ? 1 : 0,
            pointerEvents: hasData ? 'auto' : 'none',
          }}
        />
      </div>
    </div>
  )
})

export default GanttView
