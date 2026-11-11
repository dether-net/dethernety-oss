/** A short text summary of a score report: verdicts and counts only. */
import type { ScoreReport } from './score.js'

export function summarise(r: ScoreReport): string {
  const lines = [`run ${r.runId ?? '?'} (${r.harness ?? '?'}, ${r.fixture ?? '?'}): ${r.verdict}${r.marginal ? ' (marginal)' : ''}`]
  if (r.verdict === 'INVALID') {
    for (const p of r.problems) lines.push(`  invalid: ${p.code}: ${p.detail}`)
    return lines.join('\n')
  }
  for (const g of r.gates ?? []) {
    const counts = { FAIL: 0, 'needs-review': 0 }
    for (const f of g.findings) counts[f.verdict]++
    lines.push(`  ${g.gate.padEnd(16)} ${g.verdict}${g.findings.length ? ` (${counts.FAIL} fail, ${counts['needs-review']} review)` : ''}`)
  }
  for (const i of r.rubric ?? []) {
    const score = i.kind === 'graded' ? ` ${i.hits}/${i.n} (need ${Math.ceil((i.threshold ?? 0) * (i.n ?? 0) - 1e-9)})` : i.tally ? ` ${i.tally.ok}/${i.tally.n}` : ''
    lines.push(`  ${i.id.padEnd(32)} ${i.kind === 'n/a' ? 'n/a (not on this fixture)' : i.pass ? 'pass' : 'FAIL'}${i.marginal ? ' marginal' : ''}${score}${i.informational ? ' (informational)' : ''}`)
  }
  for (const m of r.marginalReasons ?? []) lines.push(`  marginal: ${m}`)
  for (const d of r.disclosures ?? []) lines.push(`  note: ${d}`)
  for (const n of r.notOnFixture ?? []) lines.push(`  n/a (not on this fixture): ${n}`)
  for (const n of r.notRun ?? []) lines.push(`  not run: ${n}`)
  lines.push(`  counts as final: ${r.countsAsFinal ? 'yes' : `no (${(r.notFinal ?? []).join('; ')})`}`)
  return lines.join('\n')
}
