import { useState } from 'react'

const API = '/api'

export default function UploadPanel({
  onImported,
  selectedProjectId,
  onSelectProject,
  projects,
  onRunCpm,
  cpmBusy,
  cpmError,
}) {
  const [uploading, setUploading] = useState(false)
  const [lastImport, setLastImport] = useState(null)

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setLastImport(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${API}/import`, { method: 'POST', body: fd })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(t || res.statusText)
      }
      const data = await res.json()
      setLastImport(data)
      onImported(data)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const exportXlsx = () => {
    if (!selectedProjectId) return
    window.location.href = `${API}/projects/${encodeURIComponent(selectedProjectId)}/export/activities.xlsx`
  }

  const exportCsv = () => {
    if (!selectedProjectId) return
    window.location.href = `${API}/projects/${encodeURIComponent(selectedProjectId)}/export/diagnostics.csv`
  }

  return (
    <div>
      <div className="upload-zone">
        <div>Import Primavera .xer</div>
        {uploading ? <div className="upload-progress">Uploading…</div> : null}
        <input
          type="file"
          accept=".xer"
          disabled={uploading}
          onChange={async (e) => {
            try {
              await handleFile(e)
            } catch (err) {
              console.error(err)
              alert(err.message || 'Import failed')
            }
          }}
        />
      </div>

      {lastImport ? (
        <p className="import-summary">
          Last import: {lastImport.activities_count} activities, {lastImport.relationships_count} relationships
          {lastImport.calendars_count ? `, ${lastImport.calendars_count} calendars` : ''}.
        </p>
      ) : null}

      <label style={{ display: 'block', marginTop: '0.75rem', fontSize: '0.85rem' }}>
        Active project
        <select
          className="project-select"
          value={selectedProjectId || ''}
          onChange={(e) => onSelectProject(e.target.value || null)}
        >
          <option value="">— Select —</option>
          {projects.map((p) => (
            <option key={p.proj_id} value={p.proj_id}>
              {p.name} ({p.activity_count} act.)
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="btn-primary"
        style={{ width: '100%' }}
        disabled={!selectedProjectId || cpmBusy}
        onClick={() => onRunCpm()}
      >
        {cpmBusy ? 'Running CPM…' : 'Run CPM'}
      </button>
      {cpmError ? <p className="error">{cpmError}</p> : null}

      <div className="upload-exports" style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <button type="button" className="btn-secondary" disabled={!selectedProjectId} onClick={exportXlsx}>
          Export activities (.xlsx)
        </button>
        <button type="button" className="btn-secondary" disabled={!selectedProjectId} onClick={exportCsv}>
          Export diagnostics (.csv)
        </button>
      </div>
    </div>
  )
}
