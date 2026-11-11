/**
 * The run's verdict.
 *
 * - INVALID: the run broke the protocol; nothing is scored.
 * - PASS: every hard gate and the post-compaction check (when the session was
 *   compacted) pass, and every scored item passes. A finding that needs review is not a pass until an
 *   adjudication (`adjudications.json`) settles it; an adjudicated pass makes
 *   the run marginal.
 * - Marginal: a graded item that would fail with one fewer hit, any H4
 *   finding that needed review, an off-sheet reply at a mandatory question, an
 *   agent run that failed or never returned, or a waiver question shown. A
 *   reply logged under a sheet prompt is off-sheet too when it is not the
 *   sheet's reply, a variant's that applies, or a listed pick.
 * - Counts as final: a pass that is not marginal (or is itself the confirming
 *   run of a marginal one), from a clean run (not resumed from a snapshot),
 *   whose bundle and dist hashes, recomputed from `installed/`, equal the
 *   release candidate's.
 */
import { replyForms, type AnswerSheet, type ReplyMode } from '../answer-sheet.js'
import type { Finding, GateOutcome } from './outcome.js'
import type { Registry, ShownPrompt } from './prompts.js'
import { normaliseReply, type ReplyMatch } from './replies.js'
import type { RubricItem } from './rubric.js'
import type { Adjudication, ReplyLine } from './run-dir.js'

/**
 * The adjudication item a finding is settled by: `<gate>/<code>/<refs and events as JSON>`, so two findings with
 * the same refs at different events (or refs holding `/` or `,`) are never settled by one adjudication.
 */
export const findingItem = (gate: string, f: Finding) => `${gate}/${f.code}/${JSON.stringify({ refs: f.refs ?? [], events: f.events ?? [] })}`

export interface Adjudicated {
  gates: GateOutcome[]
  /** Findings an adjudication settled, with its verdict */
  settled: Array<{ item: string; verdict: 'pass' | 'fail' }>
}

/** Apply adjudications to needs-review findings: a pass drops the finding, a fail makes it fail. */
export function adjudicate(gates: GateOutcome[], adjudications: Adjudication[]): Adjudicated {
  const settled: Adjudicated['settled'] = []
  const out = gates.map((g) => {
    const findings: Finding[] = []
    for (const f of g.findings) {
      const a = f.verdict === 'needs-review' ? adjudications.find((x) => x.item === findingItem(g.gate, f)) : undefined
      if (!a) findings.push(f)
      else {
        settled.push({ item: a.item, verdict: a.verdict })
        if (a.verdict === 'fail') findings.push({ ...f, verdict: 'FAIL' })
      }
    }
    const verdict = findings.some((f) => f.verdict === 'FAIL') ? 'FAIL' : findings.length ? 'needs-review' : 'PASS'
    return { ...g, verdict, findings } as GateOutcome
  })
  return { gates: out, settled }
}

/**
 * Whether a reply logged under a sheet prompt says something the sheet does not. The sheet's answer is
 * the first variant whose condition holds, else its reply, each with its picks. A `from_showing`
 * variant holds from the prompt's Nth showing, counting the showings the operator answered,
 * dismissed or compacted, and an `if_mode` variant in the run's reply mode; a table variant cannot be
 * checked here and is accepted beside them. A reply with a facts line is on the sheet with any of the
 * mode's facts filled in, in sheet order (which ones the question asked for is the validity check's).
 */
export function departsFromSheet(sheet: AnswerSheet, r: Pick<ReplyLine, 'prompt' | 'text'>, asked: ShownPrompt | undefined, shown: ShownPrompt[], mode: ReplyMode): boolean {
  const p = sheet.prompts.find((x) => x.id === r.prompt)
  if (!p) return false
  // A message judged through its dialog (`via`) is not a showing of its own.
  const index = asked ? shown.filter((s) => s.id === p.id && s.via === undefined && s.event <= asked.event && (s.answeredBy !== undefined || s.dismissed || s.compacted)).length : undefined
  const holds = p.variants.find((v) => (v.fromShowing !== undefined && index !== undefined && index >= v.fromShowing) || v.ifMode === mode)
  const accepted = holds ? [holds.reply, ...(holds.picks ?? [])] : [p.reply, ...(p.picks ?? [])]
  for (const v of p.variants) if (v.ifTableContainsAny) accepted.push(v.reply)
  return !accepted.flatMap((a) => replyForms(p, a, mode)).map(normaliseReply).includes(normaliseReply(r.text))
}

export interface VerdictInput {
  gates: GateOutcome[]
  rubric: RubricItem[]
  adjudications: Adjudication[]
  shown: ShownPrompt[]
  registry: Registry
  sheet?: AnswerSheet
  /** The run's reply mode, for the sheet replies */
  mode: ReplyMode
  /** Operator facts the questions asked for and the replies did not give (the facts check) */
  withheld?: string[]
  /** A quick run: its scored items are judged against the baseline across runs, so its own verdict is the hard gates' */
  qualityByBar?: boolean
  /** A baseline run: a reference for the comparison, which its gates and items do not decide */
  reference?: boolean
  replies: ReplyLine[]
  pairs: ReplyMatch['pairs']
  clean: boolean
  confirms?: string
  hashes: { bundle: string; dist: string; rcBundle?: string; rcDist?: string }
}

export interface Verdict {
  verdict: 'PASS' | 'FAIL'
  marginal: boolean
  marginalReasons: string[]
  countsAsFinal: boolean
  /** Why the run does not count as final, when it does not */
  notFinal: string[]
  gates: GateOutcome[]
  settled: Adjudicated['settled']
}

export function verdict(input: VerdictInput): Verdict {
  const { gates, settled } = adjudicate(input.gates, input.adjudications)
  // An item the fixture has nothing for is left out, and so is an informational one: neither passes nor fails a run.
  const judged = input.qualityByBar || input.reference ? [] : input.rubric.filter((i) => i.kind !== 'n/a' && !i.informational)
  const pass = input.reference || (gates.every((g) => g.verdict === 'PASS') && judged.every((i) => i.pass))
  const marginalReasons: string[] = []
  for (const i of input.qualityByBar || input.reference ? [] : input.rubric) if (i.marginal) marginalReasons.push(`${i.id} would fail with one fewer hit`)
  const h4Reviewed = input.gates.find((g) => g.gate === 'H4')?.findings.some((f) => f.verdict === 'needs-review')
  if (h4Reviewed) marginalReasons.push('an H4 finding needed review')
  if (settled.some((s) => s.verdict === 'pass')) marginalReasons.push('a finding passed by adjudication')
  for (const p of input.pairs) {
    const r = input.replies[p.line - 1]
    if (!r) continue
    const asked = input.shown.find((s) => s.answeredBy === p.event && s.via === undefined)
    // An off-sheet line is judged at the question it answered; a sheet line at its own prompt.
    const id = r.prompt === 'off-sheet' ? asked?.id : r.prompt
    const offSheet = r.prompt === 'off-sheet' || (!!input.sheet && departsFromSheet(input.sheet, r, asked, input.shown, input.mode))
    if (offSheet && id && input.registry.get(id)?.mandatory) marginalReasons.push(`an off-sheet reply at the mandatory question ${id}`)
  }
  const h6 = input.gates.find((g) => g.gate === 'H6')
  if (h6?.findings.some((f) => f.code === 'no_return' || f.code === 'returned_error')) marginalReasons.push('an agent run failed or never returned')
  const waiver = [...new Set(input.shown.filter((s) => s.id.startsWith('waiver-')).map((s) => s.id))]
  if (waiver.length) marginalReasons.push(`a waiver question was shown (${waiver.join(', ')})`)
  for (const w of input.withheld ?? []) marginalReasons.push(`an operator fact was withheld: ${w}`)
  // A baseline is a reference: nothing about it is marginal, and no run confirms it.
  if (input.reference) marginalReasons.length = 0
  const marginal = marginalReasons.length > 0

  const notFinal: string[] = []
  if (!pass) notFinal.push('the run did not pass')
  if (pass && marginal && !input.confirms) notFinal.push('a marginal pass needs a confirming run')
  if (!input.clean) notFinal.push('the run was resumed from a snapshot')
  // A baseline runs an earlier release: no release candidate's hashes apply to it.
  if (!input.reference) {
    if (!input.hashes.rcBundle || input.hashes.bundle !== input.hashes.rcBundle) notFinal.push('the bundle hash is not the release candidate\'s')
    if (!input.hashes.rcDist || input.hashes.dist !== input.hashes.rcDist) notFinal.push('the dist hash is not the release candidate\'s')
  }
  return { verdict: pass ? 'PASS' : 'FAIL', marginal, marginalReasons: [...new Set(marginalReasons)], countsAsFinal: notFinal.length === 0, notFinal, gates, settled }
}
