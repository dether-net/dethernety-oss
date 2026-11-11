/**
 * H7: every question the run must ask was asked, and waited for; and after a
 * compaction the run found its place before touching the model.
 *
 * A sheet prompt marked `always` or `fixture` (its `required` in the run's reply
 * mode) must be shown (see `prompts.ts`) and answered; one whose `only_modes`
 * leaves the run's mode out must not be shown at all (`prompt_out_of_mode`); a prompt that is shown but not waited for fails wherever it
 * is required. A dialog the operator dismissed was waited for: it needs review
 * only when no later showing of the prompt is answered. A question pending when
 * the operator compacted the session was waited for too; never asked and
 * answered again, it fails where it is required and needs review elsewhere
 * (`prompt_compacted`). Shown and answered
 * without every registry phrase needs review. A message followed at once by a
 * dialog asking the same question is judged through the dialog (`via`): its
 * wait, and its wording.
 * Each logged reply for a sheet prompt must answer a showing of that prompt,
 * or it needs review (the question went untagged, or the log is wrong).
 *
 * After each compaction, the main session reads the workflow state
 * (`model_state get`, `workspace_status`, or `.dethereal/state.json`) before
 * its first model-writing action, and the first question it shows ends the
 * turn.
 */
import { promptInMode, requiredIn, type AnswerSheet, type ReplyMode } from '../answer-sheet.js'
import { serverWriteScope } from '../transcripts/replay.js'
import type { TranscriptEvent } from '../transcripts/types.js'
import { readOnlyCall } from './h6.js'
import { outcome, refusal, type Finding, type GateOutcome } from './outcome.js'
import type { ShownPrompt } from './prompts.js'
import type { ReplyMatch } from './replies.js'
import type { ReplyLine } from './run-dir.js'

export interface H7Input {
  sheet: AnswerSheet
  shown: ShownPrompt[]
  replies: ReplyLine[]
  pairs: ReplyMatch['pairs']
  /** Whether the final model, its channels removed, has an external-ingress crossing; unset when unknown */
  externalIngress?: boolean
  /** Whether the run could record a review: its final Gate 3 passes, or it asked to move to REVIEWED; unset when unknown */
  reviewable?: boolean
  /** The run's reply mode: a prompt's `required` may depend on it */
  mode: ReplyMode
}

export function h7({ sheet, shown, replies, pairs, externalIngress, reviewable, mode }: H7Input): GateOutcome {
  const findings: Finding[] = []
  for (const p of sheet.prompts) {
    const hits = shown.filter((s) => s.id === p.id)
    // A question its mode never asks (a quick run's loop-back or control pass) is work the run was not to do.
    if (!promptInMode(p, mode)) {
      if (hits.length) findings.push({ verdict: 'FAIL', code: 'prompt_out_of_mode', detail: `${p.id} was shown in a ${mode} run, which never asks it`, events: hits.map((s) => s.event), refs: [p.id] })
      continue
    }
    // A crossing to ratify is read from the product's own zoning, and a review to record from its Gate 3; unknown,
    // the prompt stays required.
    const when = requiredIn(p, mode)
    const required = when === 'always' || when === 'fixture' || (when === 'if_external_ingress' && externalIngress !== false) ||
      (when === 'if_reviewable' && reviewable !== false)
    if (!hits.length) {
      if (required) findings.push({ verdict: 'FAIL', code: 'prompt_not_shown', detail: `${p.id} was never shown`, refs: [p.id] })
      continue
    }
    // A message a dialog asking the same question followed at once is judged through that dialog's own showing.
    const own = hits.filter((s) => s.via === undefined)
    const unawaited = own.filter((s) => s.answeredBy === undefined && !s.dismissed && !s.compacted)
    for (const s of unawaited) findings.push({ verdict: 'FAIL', code: 'prompt_not_awaited', detail: `${p.id} was shown (segment ${s.segment}) without waiting for the operator`, events: [s.event], refs: [p.id] })
    // The operator compacted while it waited: finding its place again means asking again. A mandatory question never
    // asked again fails; another needs review.
    for (const s of own.filter((x) => x.compacted && !hits.some((y) => y.event > x.event && y.answeredBy !== undefined))) {
      findings.push({
        verdict: required ? 'FAIL' : 'needs-review', code: 'prompt_compacted',
        detail: `${p.id} was pending when the session was compacted (segment ${s.segment}) and never answered after`, events: [s.event], refs: [p.id],
      })
    }
    // A dialog the operator dismissed was waited for; asked again and answered, it needs nothing more.
    for (const s of own.filter((x) => x.dismissed && !hits.some((y) => y.event > x.event && y.answeredBy !== undefined))) {
      findings.push({ verdict: 'needs-review', code: 'prompt_dismissed', detail: `${p.id} was dismissed (segment ${s.segment}) and never answered after`, events: [s.event], refs: [p.id] })
    }
    const answered = own.filter((s) => s.answeredBy !== undefined)
    if (answered.length && !answered.some((s) => s.complete)) {
      const missing = [...new Set(answered.flatMap((s) => s.missing))]
      findings.push({
        verdict: 'needs-review', code: 'prompt_wording',
        detail: `${p.id} was shown without the phrase(s) the registry requires: ${missing.map((m) => JSON.stringify(m)).join(', ')}; an adjudication names the phrase and why the wording shown carries its meaning`,
        events: answered.map((s) => s.event), refs: [p.id],
      })
    }
  }
  const sheetIds = new Set(sheet.prompts.map((p) => p.id))
  for (const pair of pairs) {
    const r = replies[pair.line - 1]
    if (!r || !sheetIds.has(r.prompt)) continue
    if (!shown.some((s) => s.id === r.prompt && s.answeredBy === pair.event)) {
      findings.push({ verdict: 'needs-review', code: 'reply_without_prompt', detail: `the reply logged for ${r.prompt} answers no showing of it`, events: [pair.event], refs: [r.prompt] })
    }
  }
  return outcome('H7', findings)
}

const isStateRead = (e: TranscriptEvent) =>
  (e.kind === 'tool_call' && ((e.tool === 'dethereal.model_state' && readOnlyCall(e)) || e.tool === 'dethereal.workspace_status')) ||
  (e.kind === 'file_read' && /(^|\/)\.dethereal\/state\.json$/.test(e.path ?? '')) ||
  (e.kind === 'shell' && !e.writesModel && !e.denied && /\.dethereal\/state\.json/.test(e.text ?? ''))

const isModelWrite = (e: TranscriptEvent) =>
  (e.kind === 'file_write' && e.modelFile === true) || (e.kind === 'shell' && e.writesModel === true) ||
  (e.kind === 'tool_call' && !readOnlyCall(e) && serverWriteScope(e.tool ?? '', e.input, (p) => p) !== null)

export function postCompaction(events: TranscriptEvent[], shown: ShownPrompt[]): GateOutcome {
  const findings: Finding[] = []
  // A subagent's own compaction is not the session's.
  const compactions = events.filter((e) => e.kind === 'compaction' && e.actor === 'main').map((e) => e.seq)
  compactions.forEach((c, i) => {
    const end = compactions[i + 1] ?? Infinity
    const main = events.filter((e) => e.actor === 'main' && e.seq > c && e.seq < end)
    const write = main.find(isModelWrite)
    const read = main.find(isStateRead)
    if (write && (!read || read.seq > write.seq)) {
      findings.push({ verdict: 'FAIL', code: 'no_state_reread', detail: `segment ${i + 1}: the model was written before the workflow state was read again${refusal(write)}`, events: [c, write.seq] })
    }
    const next = shown.find((s) => s.event > c && s.event < end)
    if (next && next.answeredBy === undefined && !next.dismissed && !next.compacted) {
      findings.push({ verdict: 'FAIL', code: 'question_not_awaited', detail: `segment ${i + 1}: the first question after the compaction (${next.id}) did not end the turn`, events: [c, next.event] })
    }
  })
  return outcome('post-compaction', findings)
}
