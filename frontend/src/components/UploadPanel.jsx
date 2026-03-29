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
  onProjectDeleted,
}) {
  const [uploading, setUploading] = useState(false)
  const [lastImport, setLastImport] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [dropError, setDropError] = useState(null)

  const uploadFile = async (file) => {
    setUploading(true)
    setLastImport(null)
    setDropError(null)
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
    }
  }

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await uploadFile(file)
    } finally {
      e.target.value = ''
    }
  }

  const exportXlsx = () => {
    if (!selectedProjectId) return
    window.location.href = `${API}/projects/${encodeURIComponent(selectedProjectId)}/export/activities.xlsx`
  }

  const exportXer = () => {
    if (!selectedProjectId) return
    window.location.href = `${API}/projects/${encodeURIComponent(selectedProjectId)}/export/schedule.xer`
  }

  const exportCsv = () => {
    if (!selectedProjectId) return
    window.location.href = `${API}/projects/${encodeURIComponent(selectedProjectId)}/export/diagnostics.csv`
  }

  return (
    <div>
      <div
        className={`upload-zone${dragActive ? ' upload-zone-active' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
        onDragEnter={(e) => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={async (e) => {
          e.preventDefault()
          setDragActive(false)
          setDropError(null)
          const file = e.dataTransfer?.files?.[0]
          if (!file) return
          if (!file.name.toLowerCase().endsWith('.xer')) {
            setDropError('Only .xer files are supported')
            return
          }
          try {
            await uploadFile(file)
          } catch (err) {
            setDropError(err.message || 'Import failed')
          }
        }}
      >
        <div style={{ marginBottom: '6px' }}>Import Primavera .xer</div>
        <div style={{ fontSize: '10px', color: 'var(--text-3)', marginBottom: '4px' }}>
          {dragActive ? 'Drop .xer file here' : 'Drag & drop or use button below'}
        </div>
        {uploading ? <div className="upload-progress">Uploading…</div> : null}
        {dropError ? <div style={{ fontSize: '10px', color: 'var(--red)', marginBottom: '4px' }}>{dropError}</div> : null}
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
          ✓ {lastImport.activities_count} activities · {lastImport.relationships_count} rels
          {lastImport.calendars_count ? ` · ${lastImport.calendars_count} cals` : ''}
          {lastImport.resources_count ? ` · ${lastImport.resources_count} rsrc` : ''}
          {lastImport.task_resources_count ? ` · ${lastImport.task_resources_count} assigns` : ''}
        </p>
      ) : null}

      <div style={{ padding: '8px 0 6px' }}>
        <select
          className="project-select"
          value={selectedProjectId || ''}
          onChange={(e) => onSelectProject(e.target.value || null)}
        >
          <option value="">— Select project —</option>
          {projects.map((p) => (
            <option key={p.proj_id} value={p.proj_id}>
              {p.name} ({p.activity_count} act.)
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
        <button
          type="button"
          className="btn-primary"
          style={{ flex: 1 }}
          disabled={!selectedProjectId || cpmBusy}
          onClick={() => onRunCpm()}
        >
          {cpmBusy ? 'Running CPM…' : '▶ Run CPM'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          style={{ color: 'var(--red)', borderColor: 'var(--red)', padding: '4px 10px', fontSize: '11px' }}
          disabled={!selectedProjectId || deleting}
          onClick={async () => {
            const proj = projects.find((p) => p.proj_id === selectedProjectId)
            const name = proj?.name || selectedProjectId
            if (!window.confirm(`Are you sure you want to delete project "${name}"? This cannot be undone.`)) return
            setDeleting(true)
            try {
              const res = await fetch(`${API}/projects/${encodeURIComponent(selectedProjectId)}`, { method: 'DELETE' })
              if (!res.ok) throw new Error('Delete failed')
              onSelectProject(null)
              onProjectDeleted?.()
            } catch (err) {
              alert(err.message || 'Delete failed')
            } finally {
              setDeleting(false)
            }
          }}
        >
          {deleting ? '…' : 'Delete'}
        </button>
      </div>
      {cpmError ? <p className="error">{cpmError}</p> : null}

      <div className="upload-exports">
        <button type="button" className="btn-secondary" disabled={!selectedProjectId} onClick={exportXer}
          style={{ background: 'var(--emerald-dim)', borderColor: 'var(--emerald)', color: 'var(--emerald)' }}>
          ↓ Export XER (P6)
        </button>
        <button type="button" className="btn-secondary" disabled={!selectedProjectId} onClick={exportXlsx}>
          ↓ Export XLSX
        </button>
        <button type="button" className="btn-secondary" disabled={!selectedProjectId} onClick={exportCsv}>
          ↓ Export CSV
        </button>
      </div>
    </div>
  )
}
