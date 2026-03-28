import { useCallback, useEffect, useState } from 'react'
import './App.css'
import ActivityTable from './components/ActivityTable.jsx'
import GanttView from './components/GanttView.jsx'
import ScheduleHealth from './components/ScheduleHealth.jsx'
import UploadPanel from './components/UploadPanel.jsx'

const API = '/api'

function getInitialTheme() {
  const saved = localStorage.getItem('theme')
  if (saved === 'dark' || saved === 'light') return saved
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

export default function App() {
  const [theme, setTheme] = useState(getInitialTheme)
  const [tab, setTab] = useState('activities')
  const [projects, setProjects] = useState([])
  const [selectedProjectId, setSelectedProjectId] = useState(null)
  const [activities, setActivities] = useState([])
  const [relationships, setRelationships] = useState([])
  const [diagnostics, setDiagnostics] = useState(null)
  const [cpmBusy, setCpmBusy] = useState(false)
  const [cpmError, setCpmError] = useState(null)
  const [ganttZoom, setGanttZoom] = useState('day')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
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
      return
    }
    const [aRes, rRes, dRes] = await Promise.all([
      fetch(`${API}/projects/${encodeURIComponent(projId)}/activities`),
      fetch(`${API}/projects/${encodeURIComponent(projId)}/relationships`),
      fetch(`${API}/projects/${encodeURIComponent(projId)}/diagnostics`),
    ])
    if (aRes.ok) {
      const a = await aRes.json()
      setActivities(a.items || [])
    }
    if (rRes.ok) setRelationships(await rRes.json())
    if (dRes.ok) setDiagnostics(await dRes.json())
  }, [])

  useEffect(() => {
    loadProjectData(selectedProjectId)
  }, [selectedProjectId, loadProjectData])

  const onImported = async (data) => {
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
        <UploadPanel
          onImported={onImported}
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
          projects={projects}
          onRunCpm={runCpm}
          cpmBusy={cpmBusy}
          cpmError={cpmError}
        />
        <div className="kpi-grid">
          <div className="kpi">
            <label>Activities</label>
            <strong>{selected?.activity_count ?? '—'}</strong>
          </div>
          <div className="kpi">
            <label>Relationships</label>
            <strong>{selected?.relationship_count ?? '—'}</strong>
          </div>
          <div className="kpi">
            <label>% Critical</label>
            <strong>{pctCrit}</strong>
          </div>
          <div className="kpi">
            <label>Open ends</label>
            <strong>{openEnds != null ? openEnds : '—'}</strong>
          </div>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: 0 }}>
          Offline · SQLite · CPM in hours; 8 h/day for day/date display
        </p>
      </aside>

      <main className="main">
        <nav className="tabs">
          <button type="button" className={tab === 'activities' ? 'active' : ''} onClick={() => setTab('activities')}>
            Activities
          </button>
          <button type="button" className={tab === 'gantt' ? 'active' : ''} onClick={() => setTab('gantt')}>
            Gantt
          </button>
          <button type="button" className={tab === 'health' ? 'active' : ''} onClick={() => setTab('health')}>
            Schedule Health
          </button>
        </nav>
        <div className="tab-panel">
          {tab === 'activities' && <ActivityTable activities={activities} />}
          {tab === 'gantt' && (
            <GanttView
              activities={activities}
              relationships={relationships}
              zoom={ganttZoom}
              onZoomChange={setGanttZoom}
            />
          )}
          {tab === 'health' && <ScheduleHealth report={diagnostics} onExportCsv={exportCsv} />}
        </div>
      </main>
    </div>
  )
}
