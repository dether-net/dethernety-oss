/**
 * A baseline run: an earlier release on the same fixture, the reference a quick run is held against. Its questions
 * carry no prompt tags, so what it showed is read from the operator's log: each line the operator logged under a
 * sheet prompt answered a showing of that prompt, made by the session's last words before it. Its gates are reported
 * and decide nothing; its scored items are the comparison's reference.
 *
 * The operator's facts are given by the bar rule, matched by hand to the earlier release's tables; a fact given
 * unasked, or one the key expects that the run never received, needs review rather than voiding the run.
 */
import type { AnswerSheet } from '../answer-sheet.js'
import type { ExpectedKey } from '../key.js'
import type { TranscriptEvent } from '../transcripts/types.js'
import { checkFacts } from './facts.js'
import { outcome, type Finding, type GateOutcome } from './outcome.js'
import type { ShownPrompt } from './prompts.js'
import { normaliseReply, type ReplyMatch } from './replies.js'
import type { ReplyLine } from './run-dir.js'

export const BASELINE_DISCLOSURE = 'baseline run: a reference for the comparison with quick runs; its gates are reported and decide nothing, and its questions are read from the operator\'s log'

/**
 * The showings of a run without prompt tags: one per logged reply under a sheet prompt, shown by the main session's
 * last assistant or question event before the reply, and answered by it (the push consent: shown at the reply).
 */
export function shownFromLog(events: TranscriptEvent[], replies: ReplyLine[], pairs: ReplyMatch['pairs'], sheet: AnswerSheet): ShownPrompt[] {
  const ids = new Set(sheet.prompts.map((p) => p.id))
  const out: ShownPrompt[] = []
  for (const pair of pairs) {
    const r = replies[pair.line - 1]
    if (!r || !ids.has(r.prompt)) continue
    const asked = [...events].reverse().find((e) => e.seq < pair.event && e.actor === 'main' && (e.kind === 'assistant' || e.kind === 'ask'))
    if (!asked) continue
    const segment = events.filter((e) => e.kind === 'compaction' && e.actor === 'main' && e.seq < asked.seq).length
    // The push consent closes the Step 9 window: an earlier release may name its review's findings in the very message
    // that asks for consent, so the window runs to the operator's reply.
    const event = r.prompt === 'push-consent' ? pair.event : asked.seq
    out.push({ id: r.prompt, event, complete: true, missing: [], answeredBy: pair.event, segment })
  }
  return out
}

/**
 * The operator's facts on a baseline, for review: a fact given while no table row asked for it (the earlier release
 * words its tables differently), and each fact the key expects that no reply gave.
 */
export function baselineFacts(sheet: AnswerSheet, key: ExpectedKey, events: TranscriptEvent[], replies: ReplyLine[], pairs: ReplyMatch['pairs']): GateOutcome {
  const findings: Finding[] = checkFacts(sheet, events, replies, pairs, 'bar').unasked
    .map((p) => ({ verdict: 'needs-review' as const, code: 'baseline_fact_unasked', detail: p.detail }))
  const relay = sheet.prompts.find((p) => p.facts.length)
  const said = replies.map((r) => normaliseReply(r.text))
  for (const id of key.quick?.facts_expected ?? []) {
    const fact = relay?.facts.find((f) => f.id === id)
    if (fact && !said.some((s) => s.includes(normaliseReply(fact.text)))) {
      findings.push({ verdict: 'needs-review', code: 'baseline_fact_not_given', detail: `the run never received fact ${id}: check whether the earlier release's tables asked for it in other words`, refs: [id] })
    }
  }
  return outcome('facts', findings)
}
