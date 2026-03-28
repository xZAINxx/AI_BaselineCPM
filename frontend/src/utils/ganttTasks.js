/**
 * Build dhtmlx-gantt payload from display rows + relationships.
 */

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

/**
 * @param {Array} displayRows from buildDisplayRows
 * @param {Array} relationships
 * @param {string} zoom 'day'|'week'|'month'
 */
export function buildGanttPayload(displayRows, relationships) {
  const tasks = []
  let currentParent = 0
  const idSet = new Set()

  for (const row of displayRows || []) {
    if (row.kind === 'wbs') {
      currentParent = row.id
      tasks.push({
        id: row.id,
        text: row.label,
        type: 'project',
        open: true,
        parent: 0,
        start_date: hourToStr(0),
        duration: 0.01,
      })
      idSet.add(row.id)
    } else {
      const a = row.activity
      const es = a.early_start
      const dur = Number(a.duration_hrs) || 0
      const start = es != null ? hourToStr(es) : hourToStr(0)
      const isMile = a.is_milestone || dur <= 0
      const durDays = dur / HOURS_PER_DAY
      const tid = String(a.task_id)
      const task = {
        id: tid,
        text: a.name || `Task ${tid}`,
        start_date: start,
        duration: isMile ? 0 : Math.max(durDays, 0.01),
        type: isMile ? 'milestone' : 'task',
        critical: !!a.is_critical,
        parent: currentParent || 0,
      }
      tasks.push(task)
      idSet.add(tid)
    }
  }

  const links = (relationships || [])
    .map((r, idx) => ({
      id: String(r.id ?? idx),
      source: String(r.pred_id ?? r.pred_task_id),
      target: String(r.succ_id ?? r.succ_task_id),
      type: predTypeToLinkType(r.rel_type ?? r.pred_type),
    }))
    .filter((l) => idSet.has(l.source) && idSet.has(l.target))

  return { data: tasks, links }
}
