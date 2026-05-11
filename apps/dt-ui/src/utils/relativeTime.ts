const MS = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000
}

/**
 * Format an ISO timestamp as a short relative-time string ("2m ago", "3d ago").
 * Returns 'Never' if input is null/undefined/empty, 'unknown' on parse failure.
 */
export function formatRelative(iso?: string | null): string {
  if (!iso) return 'Never'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 'unknown'
  const diff = Date.now() - t
  if (diff < 0) return 'just now'
  if (diff < MS.minute) return `${Math.floor(diff / MS.second)}s ago`
  if (diff < MS.hour) return `${Math.floor(diff / MS.minute)}m ago`
  if (diff < MS.day) return `${Math.floor(diff / MS.hour)}h ago`
  if (diff < MS.week) return `${Math.floor(diff / MS.day)}d ago`
  return `${Math.floor(diff / MS.week)}w ago`
}
