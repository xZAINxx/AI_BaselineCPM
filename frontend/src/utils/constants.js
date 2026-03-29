export const REF_MS = Date.UTC(2025, 0, 6, 8, 0, 0)
export const HOURS_PER_DAY = 8
export const NEAR_CRIT_THRESHOLD = 40

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export function hourToDateStr(h) {
  if (h == null || Number.isNaN(Number(h))) return '—'
  const ms = REF_MS + Number(h) * 3600000
  const d = new Date(ms)
  const day = String(d.getUTCDate()).padStart(2, '0')
  const mon = MONTHS[d.getUTCMonth()]
  const yr = String(d.getUTCFullYear()).slice(-2)
  return `${day}-${mon}-${yr}`
}

export function fmtDays(h) {
  if (h == null || Number.isNaN(Number(h))) return '—'
  return (Number(h) / HOURS_PER_DAY).toFixed(1)
}
