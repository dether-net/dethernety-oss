/**
 * The shape every hard gate reports: a verdict and the findings behind it.
 * A gate fails on any failing finding, needs review on any finding that needs
 * review, and passes otherwise. Evidence is event seqs and project-relative
 * paths, never transcript text.
 */
export type Verdict = 'PASS' | 'FAIL' | 'needs-review'

export interface Finding {
  verdict: Exclude<Verdict, 'PASS'>
  code: string
  detail: string
  /** Transcript event seqs */
  events?: number[]
  /** Project-relative paths, or key ids */
  refs?: string[]
}

export interface GateOutcome {
  gate: string
  verdict: Verdict
  findings: Finding[]
}

export function outcome(gate: string, findings: Finding[]): GateOutcome {
  const verdict: Verdict = findings.some((f) => f.verdict === 'FAIL') ? 'FAIL' : findings.length ? 'needs-review' : 'PASS'
  return { gate, verdict, findings }
}

/** A gate's outcome with more findings of the same gate, its verdict taken again. */
export function withFindings(g: GateOutcome, more: Finding[]): GateOutcome {
  return more.length ? outcome(g.gate, [...g.findings, ...more]) : g
}

/** How a finding reads when its event is a call the harness refused before it ran; empty otherwise. */
export function refusal(e: { denied?: string }): string {
  if (!e.denied) return ''
  const how = e.denied === 'user-rejected' || e.denied === 'declined' ? 'declined by the operator' : e.denied === 'permission-rule' ? 'refused by a rule or hook' : `refused (${e.denied})`
  return ` (${how}; it never ran)`
}
