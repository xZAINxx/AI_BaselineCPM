/**
 * Build ordered display rows for the activity grid / Gantt (optional WBS bands).
 */

export function wbsLevel(wbsId) {
  if (wbsId == null || wbsId === '') return 1
  const s = String(wbsId)
  const parts = s.split('.').filter(Boolean)
  return Math.min(Math.max(parts.length, 1), 3)
}

export function wbsBandColor(level) {
  const map = { 1: '#8B1A1A', 2: '#1F3864', 3: '#2F5597' }
  return map[level] || map[3]
}

/**
 * @param {Array} activities
 * @param {{ groupByWbs: boolean, search: string, criticalOnly: boolean, longestPathOnly: boolean, sort: { key: string, dir: string } }} opts
 */
export function buildDisplayRows(activities, opts) {
  const { groupByWbs, search, criticalOnly, longestPathOnly, sort } = opts
  let rows = [...(activities || [])]

  const s = (search || '').trim().toLowerCase()
  if (s) {
    rows = rows.filter(
      (a) => String(a.task_id).toLowerCase().includes(s) || (a.name && String(a.name).toLowerCase().includes(s)),
    )
  }
  if (criticalOnly) rows = rows.filter((a) => a.is_critical)
  if (longestPathOnly) rows = rows.filter((a) => a.is_critical)

  const { key, dir } = sort
  const mul = dir === 'asc' ? 1 : -1
  rows.sort((a, b) => {
    if (groupByWbs) {
      const wa = String(a.wbs_id ?? '')
      const wb = String(b.wbs_id ?? '')
      if (wa !== wb) return wa.localeCompare(wb) * mul
    }
    const va = a[key]
    const vb = b[key]
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul
    return String(va).localeCompare(String(vb)) * mul
  })

  if (!groupByWbs) {
    return rows.map((activity) => ({ kind: 'activity', activity }))
  }

  const out = []
  let lastWbs = Symbol('sentinel')
  for (const activity of rows) {
    const w = activity.wbs_id != null ? String(activity.wbs_id) : ''
    if (w !== lastWbs) {
      const level = wbsLevel(w)
      out.push({
        kind: 'wbs',
        id: `wbs-band-${w || 'none'}`,
        wbsId: w,
        label: w || '(No WBS)',
        level,
      })
      lastWbs = w
    }
    out.push({ kind: 'activity', activity })
  }
  return out
}
