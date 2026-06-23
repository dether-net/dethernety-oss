export type Severity = 'critical' | 'high' | 'medium' | 'low'

// Triage order, high→low.
export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low']

// Ordinal heat ramp (monotonic by hue + luminance: red→deep-orange→amber→grey).
// The severity chip ALWAYS shows the severity word, so colour is reinforcement
// (colourblind-safe by construction). `low` is cool blue-grey, NOT green — green
// would read as "done" and collide with the issueStatus open→success convention.
export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: 'red-darken-2',
  high: 'deep-orange',
  medium: 'amber-darken-2',
  low: 'blue-grey',
}

/**
 * Read severity from the known path (the list summary synthesizes, and the
 * detail resolver returns, `syncedAttributes.attributes.severity`). Returns null
 * when absent or not a known severity — the row then renders no chip rather than
 * an "Unknown" placeholder. Never deep-walks (a coincidental nested "severity"
 * would be wrong for a triage chip).
 */
export function severityOf (issue: { syncedAttributes?: any } | null | undefined): Severity | null {
  const raw = issue?.syncedAttributes?.attributes?.severity
  if (typeof raw !== 'string') return null
  const sev = raw.toLowerCase()
  return (SEVERITY_ORDER as string[]).includes(sev) ? (sev as Severity) : null
}
