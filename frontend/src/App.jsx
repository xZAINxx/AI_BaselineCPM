import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import ActivityDetailsPanel from './components/ActivityDetailsPanel.jsx'
import ActivityTable from './components/ActivityTable.jsx'
import AiChatPanel from './components/AiChatPanel.jsx'
import BaselinePanel from './components/BaselinePanel.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import GanttView from './components/GanttView.jsx'
import ScheduleHealth from './components/ScheduleHealth.jsx'
import UploadPanel from './components/UploadPanel.jsx'
import { buildDisplayRows } from './utils/displayRows.js'

const API = '/api'

function getInitialTheme() {
  const saved = localStorage.getItem('theme')
  if (saved === 'dark' || saved === 'light') return saved
  return 'dark'
}

export default function App() {
  const [theme, setTheme] = useState(getInitialTheme)
  const [projects, setProjects] = useState([])
  const [selectedProjectId, setSelectedProjectId] = useState(null)
  const [activities, setActivities] = useState([])
  const [relationships, setRelationships] = useState([])
  const [diagnostics, setDiagnostics] = useState(null)
  const [cpmBusy, setCpmBusy] = useState(false)
  const [cpmError, setCpmError] = useState(null)
  const [ganttZoom, setGanttZoom] = useState('month')
  const [aiOpen, setAiOpen] = useState(false)
  const [aiPendingPrompt, setAiPendingPrompt] = useState(null)
  const [healthSuggestionsKey, setHealthSuggestionsKey] = useState(0)

  const [sort, setSort] = useState({ key: 'task_id', dir: 'asc' })
  const [filterSearch, setFilterSearch] = useState('')
  const [criticalOnly, setCriticalOnly] = useState(false)
  const [longestPathOnly, setLongestPathOnly] = useState(false)
  const [groupByWbs, setGroupByWbs] = useState(false)
  const [wbsList, setWbsList] = useState([])
  const [criticalPath, setCriticalPath] = useState([])

  const [selectedActivity, setSelectedActivity] = useState(null)
  const [splitPct, setSplitPct] = useState(58)
  const [bottomTab, setBottomTab] = useState('details')
  const [bottomOpen, setBottomOpen] = useState(true)

  const tableScrollRef = useRef(null)
  const ganttRef = useRef(null)
  const syncScrollRef = useRef(false)
  const dragSplitRef = useRef({ active: false, root: null })
  const splitRootRef = useRef(null)

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
    localStorage.setItem('theme', theme)
  }, [theme])

  const refreshProjects = useCallback(async () => {
    const res = await fetch(`${API}/projects`)
    if (!res.ok) return
    const data = await res.json()
    setProjects(data)
    return data
  }, [])

  useEffect(() => {
    refreshProjects()
  }, [refreshProjects])

  const loadProjectData = useCallback(async (projId) => {
    if (!projId) {
      setActivities([])
      setRelationships([])
      setDiagnostics(null)
      setWbsList([])
      return
    }
    const [aRes, rRes, dRes, wRes] = await Promise.all([
      fetch(`${API}/projects/${encodeURIComponent(projId)}/activities`),
      fetch(`${API}/projects/${encodeURIComponent(projId)}/relationships`),
      fetch(`${API}/projects/${encodeURIComponent(projId)}/diagnostics`),
      fetch(`${API}/projects/${encodeURIComponent(projId)}/wbs`),
    ])
    if (aRes.ok) {
      const a = await aRes.json()
      setActivities(a.items || [])
    }
    if (rRes.ok) setRelationships(await rRes.json())
    if (dRes.ok) setDiagnostics(await dRes.json())
    if (wRes.ok) setWbsList(await wRes.json())
  }, [])

  const onScheduleChanged = useCallback(async () => {
    await loadProjectData(selectedProjectId)
    await refreshProjects()
    setHealthSuggestionsKey((k) => k + 1)
  }, [selectedProjectId, loadProjectData, refreshProjects])

  useEffect(() => {
    loadProjectData(selectedProjectId)
  }, [selectedProjectId, loadProjectData])

  useEffect(() => {
    const onPrompt = (e) => {
      const p = e.detail?.prompt
      if (p) setAiPendingPrompt(p)
      setAiOpen(true)
    }
    window.addEventListener('ai-chat-prompt', onPrompt)
    return () => window.removeEventListener('ai-chat-prompt', onPrompt)
  }, [])

  const displayRows = useMemo(
    () =>
      buildDisplayRows(activities, {
        groupByWbs,
        search: filterSearch,
        criticalOnly,
        longestPathOnly,
        sort,
        criticalPath,
      }),
    [activities, groupByWbs, filterSearch, criticalOnly, longestPathOnly, sort, criticalPath],
  )

  const onTableScroll = useCallback((e) => {
    if (syncScrollRef.current) return
    syncScrollRef.current = true
    ganttRef.current?.scrollToY(e.target.scrollTop)
    requestAnimationFrame(() => {
      syncScrollRef.current = false
    })
  }, [])

  const handleImported = async (data) => {
    await refreshProjects()
    if (data?.proj_id) setSelectedProjectId(data.proj_id)
  }

  const runCpm = async () => {
    if (!selectedProjectId) return
    setCpmBusy(true)
    setCpmError(null)
    try {
      const res = await fetch(`${API}/projects/${encodeURIComponent(selectedProjectId)}/cpm`, {
        method: 'POST',
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const d = body.detail
        const msg = typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => x.msg).join(', ') : JSON.stringify(d)
        throw new Error(msg || 'CPM failed')
      }
      if (body.cycle_error) {
        setCpmError(body.cycle_error)
      }
      setCriticalPath(body.critical_path || [])
      await loadProjectData(selectedProjectId)
    } catch (e) {
      setCpmError(e.message || 'CPM failed')
    } finally {
      setCpmBusy(false)
    }
  }

  const exportCsv = () => {
    if (!selectedProjectId) return
    window.location.href = `${API}/projects/${encodeURIComponent(selectedProjectId)}/export/diagnostics.csv`
  }

  const selected = projects.find((p) => p.proj_id === selectedProjectId)
  const sum = diagnostics?.summary
  const pctCrit = sum?.critical_pct != null ? `${sum.critical_pct.toFixed(1)}%` : '—'
  const openEnds = sum ? sum.open_starts + sum.open_ends : null

  useEffect(() => {
    const onMove = (e) => {
      if (!dragSplitRef.current.active) return
      const root = dragSplitRef.current.root
      if (!root) return
      const rect = root.getBoundingClientRect()
      const x = e.clientX - rect.left
      const pct = (x / rect.width) * 100
      setSplitPct(Math.min(85, Math.max(22, pct)))
    }
    const onUp = () => {
      dragSplitRef.current.active = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const onSplitterDown = (e) => {
    e.preventDefault()
    dragSplitRef.current = { active: true, root: splitRootRef.current }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>P6 XER Analyzer</h1>
          <button
            type="button"
            className="theme-toggle"
            title="Toggle theme"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>

        <div className="sidebar-scroll">
          <div className="sidebar-section" style={{ paddingTop: '8px' }}>
            <div className="sidebar-section-label">Import</div>
            <UploadPanel
              onImported={handleImported}
              selectedProjectId={selectedProjectId}
              onSelectProject={setSelectedProjectId}
              projects={projects}
              onRunCpm={runCpm}
              cpmBusy={cpmBusy}
              cpmError={cpmError}
              onProjectDeleted={refreshProjects}
            />
          </div>

          <div className="kpi-grid">
            <div className="kpi" data-kpi="activities">
              <label>Activities</label>
              <strong>{selected?.activity_count ?? '—'}</strong>
            </div>
            <div className="kpi" data-kpi="relationships">
              <label>Relationships</label>
              <strong>{selected?.relationship_count ?? '—'}</strong>
            </div>
            <div className="kpi" data-kpi="critical">
              <label>% Critical</label>
              <strong>{pctCrit}</strong>
            </div>
            <div className="kpi" data-kpi="openends">
              <label>Open Ends</label>
              <strong>{openEnds != null ? openEnds : '—'}</strong>
            </div>
            <div className="kpi" data-kpi="critical">
              <label>DCMA Score</label>
              <strong>{sum?.dcma_total_checks > 0 ? `${sum.dcma_pass_count}/${sum.dcma_total_checks}` : '—'}</strong>
            </div>
            <div className="kpi" data-kpi="openends">
              <label>Near-Critical</label>
              <strong>{sum?.near_critical_count != null ? sum.near_critical_count : '—'}</strong>
            </div>
          </div>
        </div>

        <div className="sidebar-footer">
          Offline · SQLite · CPM in hours
          <br />
          8 h/day for date display
        </div>
      </aside>

      <ErrorBoundary>
      <main className="main">
        <div className="topbar">
          <span className="topbar-title">{selected ? selected.name : 'P6 XER Analyzer'}</span>
          {selected ? (
            <span
              style={{
                fontSize: '10px',
                color: 'var(--text-3)',
                fontFamily: 'var(--font-mono)',
                background: 'var(--surface-3)',
                padding: '2px 8px',
                borderRadius: 'var(--r-sm)',
                border: '1px solid var(--border-1)',
              }}
            >
              {selected.activity_count} act · {selected.relationship_count} rel
            </span>
          ) : null}
          <div style={{ flex: 1 }} />
          <button type="button" className="btn-secondary" onClick={() => setBottomOpen((o) => !o)}>
            {bottomOpen ? 'Hide panel' : 'Show panel'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            style={
              bottomTab === 'health'
                ? {
                    borderColor: 'var(--indigo)',
                    color: 'var(--indigo)',
                    background: 'var(--indigo-dim)',
                  }
                : undefined
            }
            onClick={() => {
              setBottomTab('health')
              setBottomOpen(true)
            }}
          >
            Schedule Health
          </button>
          {cpmError ? <span className="topbar-err">{cpmError}</span> : null}
        </div>

        <div className="work-area">
          <div
            ref={splitRootRef}
            className="split-grid"
            style={{ gridTemplateColumns: `${splitPct}% 6px minmax(0, 1fr)` }}
          >
            <section className="split-pane" aria-label="Activity table">
              <ActivityTable
                displayRows={displayRows}
                activitiesCount={activities.length}
                sort={sort}
                setSort={setSort}
                selectedId={selectedActivity ? String(selectedActivity.task_id) : null}
                onSelectActivity={(a) => setSelectedActivity(a)}
                filterSearch={filterSearch}
                onFilterSearch={setFilterSearch}
                criticalOnly={criticalOnly}
                onCriticalOnly={setCriticalOnly}
                longestPathOnly={longestPathOnly}
                onLongestPathOnly={setLongestPathOnly}
                groupByWbs={groupByWbs}
                onGroupByWbs={setGroupByWbs}
                tableScrollRef={tableScrollRef}
                onTableScroll={onTableScroll}
              />
            </section>
            <div
              className="splitter"
              role="separator"
              aria-orientation="vertical"
              tabIndex={0}
              onMouseDown={onSplitterDown}
            />
            <section className="split-pane" aria-label="Gantt chart">
              <GanttView
                ref={ganttRef}
                displayRows={displayRows}
                relationships={relationships}
                zoom={ganttZoom}
                onZoomChange={setGanttZoom}
                tableScrollRef={tableScrollRef}
                syncScrollRef={syncScrollRef}
                onTaskClick={(id) => {
                  const act = activities.find((a) => String(a.task_id) === String(id))
                  if (act) {
                    setSelectedActivity(act)
                    setBottomTab('details')
                    setBottomOpen(true)
                  }
                }}
              />
            </section>
          </div>

          <div className={`bottom-panel ${bottomOpen ? 'open' : 'collapsed'}`}>
            <div className="bottom-panel-tabs">
              <button
                type="button"
                className={bottomTab === 'details' ? 'active' : ''}
                onClick={() => {
                  setBottomTab('details')
                  setBottomOpen(true)
                }}
              >
                Activity Details
              </button>
              <button
                type="button"
                className={bottomTab === 'health' ? 'active' : ''}
                onClick={() => {
                  setBottomTab('health')
                  setBottomOpen(true)
                }}
              >
                Schedule Health
              </button>
              <button
                type="button"
                className={bottomTab === 'baseline' ? 'active' : ''}
                onClick={() => {
                  setBottomTab('baseline')
                  setBottomOpen(true)
                }}
              >
                Baselines
              </button>
            </div>
            <div className="bottom-panel-content">
              {bottomTab === 'details' ? (
                <ActivityDetailsPanel
                  activity={selectedActivity}
                  projId={selectedProjectId}
                  apiBase={API}
                  onActivityUpdated={onScheduleChanged}
                  wbsList={wbsList}
                  relationships={relationships}
                  activities={activities}
                />
              ) : null}
              {bottomTab === 'health' ? (
                <ScheduleHealth
                  report={diagnostics}
                  onExportCsv={exportCsv}
                  projId={selectedProjectId}
                  apiBase={API}
                  suggestionsRefreshKey={healthSuggestionsKey}
                  onScheduleChanged={onScheduleChanged}
                />
              ) : null}
              {bottomTab === 'baseline' ? (
                <BaselinePanel projId={selectedProjectId} apiBase={API} />
              ) : null}
            </div>
          </div>
        </div>

        <div className="statusbar">
          <div className="statusbar-item">
            <div className="statusbar-dot" />
            Online
          </div>
          <div className="statusbar-item">
            Activities:{' '}
            <strong style={{ color: 'var(--indigo)' }}>{selected?.activity_count ?? '—'}</strong>
          </div>
          <div className="statusbar-item">
            Relationships:{' '}
            <strong style={{ color: 'var(--purple)' }}>{selected?.relationship_count ?? '—'}</strong>
          </div>
          <div className="statusbar-item">
            % Critical: <strong style={{ color: 'var(--amber)' }}>{pctCrit}</strong>
          </div>
          <div className="statusbar-item">
            Open Ends:{' '}
            <strong style={{ color: 'var(--emerald)' }}>{openEnds != null ? openEnds : '—'}</strong>
          </div>
          <div className="statusbar-item">
            DCMA:{' '}
            <strong style={{ color: 'var(--amber)' }}>{sum?.dcma_total_checks > 0 ? `${sum.dcma_pass_count}/${sum.dcma_total_checks}` : '—'}</strong>
          </div>
          <div className="statusbar-item">Offline · SQLite · CPM hours · 8 h/day</div>
        </div>
      </main>
      </ErrorBoundary>

      <AiChatPanel
        open={aiOpen}
        onOpenChange={setAiOpen}
        projId={selectedProjectId}
        apiBase={API}
        onScheduleChanged={onScheduleChanged}
        pendingPrompt={aiPendingPrompt}
        onPendingPromptConsumed={() => setAiPendingPrompt(null)}
      />
    </div>
  )
}
