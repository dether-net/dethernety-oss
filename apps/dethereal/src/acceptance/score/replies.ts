/**
 * Matching the operator's log (`replies.jsonl`) with the operator input the
 * transcript records. The scorer and the run kit share this rule, so a run the
 * kit accepts is one the scorer accepts.
 *
 * The operator inputs of a transcript, in order: every operator message
 * (`user` events of the main session; never `notice` or `subagent_prompt`),
 * and every answer value of a question dialog (`answer` events, one entry per
 * answered question). Each is compared after normalisation:
 * - a slash-command record (`<command-name>/x</command-name>` with optional
 *   `<command-args>…</command-args>`) is the command as typed: `/x` or `/x args`;
 * - a pasted block (`<pasted_content id=…>…</pasted_content id=…>`) is its content;
 * - leading and trailing whitespace is ignored;
 * - an answer value of a question dialog is also compared without case and
 *   without one trailing " (Recommended)", the mark a harness adds to an
 *   option's label: the pick "continue" answers "Continue (Recommended)".
 *   Typed operator messages (not dialog answers) keep the exact rule.
 * A `fixed:compact` reply matches a `/compact` operator message when the
 * transcript records one, else the next compaction the transcript records.
 * The two sequences must match one to one, in order.
 */
import type { TranscriptEvent } from '../transcripts/types.js'
import type { ReplyLine } from './run-dir.js'
import { sha256Hex } from '../../utils/hash.js'

const sha256 = sha256Hex

/** The operator's input as typed, from how the harness recorded it. */
export function normaliseOperatorText(text: string): string {
  let t = text
  const name = /<command-name>([^<]*)<\/command-name>/.exec(t)
  if (name) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(t)?.[1]?.trim()
    return args ? `${name[1]!.trim()} ${args}` : name[1]!.trim()
  }
  t = t.replace(/<pasted_content id="[^"]*">\n?([\s\S]*?)\n?<\/pasted_content id="[^"]*">/g, '$1')
  return t.trim()
}

const RECOMMENDED = / \(recommended\)$/i

/** A dialog answer or a logged pick as compared: trimmed, one trailing " (Recommended)" dropped, lower case. */
export function normaliseAnswer(text: string): string {
  return text.trim().replace(RECOMMENDED, '').toLowerCase()
}

export interface OperatorInput {
  /** The event it came from */
  event: number
  kind: 'message' | 'answer' | 'compaction'
  text: string
  sha256: string
}

/** The operator inputs a transcript records, in order. */
export function operatorInputs(events: TranscriptEvent[]): OperatorInput[] {
  const out: OperatorInput[] = []
  for (const e of events) {
    if (e.actor !== 'main') continue
    if (e.kind === 'user' && typeof e.text === 'string') {
      const text = normaliseOperatorText(e.text)
      out.push({ event: e.seq, kind: 'message', text, sha256: sha256(text) })
    } else if (e.kind === 'answer' && e.answers) {
      for (const a of e.answers) {
        const text = a.trim()
        out.push({ event: e.seq, kind: 'answer', text, sha256: sha256(text) })
      }
    } else if (e.kind === 'compaction') out.push({ event: e.seq, kind: 'compaction', text: '', sha256: '' })
  }
  return out
}

export interface ReplyMismatch {
  /** 1-based line of replies.jsonl, when the mismatch concerns a logged reply */
  line?: number
  /** The transcript event, when the mismatch concerns a recorded input */
  event?: number
  reason: string
}

export interface ReplyMatch {
  ok: boolean
  /** Each logged reply with the transcript event it matched */
  pairs: Array<{ line: number; event: number }>
  mismatches: ReplyMismatch[]
}

/** Match the log with the transcript, one to one and in order. */
export function matchReplies(events: TranscriptEvent[], replies: ReplyLine[]): ReplyMatch {
  const inputs = operatorInputs(events)
  const hasCompactMessage = inputs.some((i) => i.kind === 'message' && i.text === '/compact')
  // A compaction counts as an input only for a `fixed:compact` reply, and only where no `/compact` message exists.
  const expected = inputs.filter((i) => i.kind !== 'compaction' || !hasCompactMessage)
  const pairs: ReplyMatch['pairs'] = []
  const mismatches: ReplyMismatch[] = []
  let j = 0
  replies.forEach((r, idx) => {
    const line = idx + 1
    const compact = r.prompt === 'fixed:compact'
    const want = sha256(r.text.trim())
    // Skip recorded compactions that no compact reply claims (an automatic compaction is not an input).
    while (j < expected.length && expected[j]!.kind === 'compaction' && !compact) j++
    const next = expected[j]
    if (!next) {
      mismatches.push({ line, reason: 'no operator input left in the transcript for this reply' })
      return
    }
    const ok = compact && next.kind === 'compaction' ? true
      : next.kind === 'answer' ? normaliseAnswer(next.text) === normaliseAnswer(r.text)
      : next.sha256 === want
    if (!ok) {
      mismatches.push({ line, event: next.event, reason: 'the reply does not match the next operator input in the transcript' })
      j++
      return
    }
    pairs.push({ line, event: next.event })
    j++
  })
  for (; j < expected.length; j++) {
    if (expected[j]!.kind === 'compaction') continue
    mismatches.push({ event: expected[j]!.event, reason: 'an operator input in the transcript has no reply in the log' })
  }
  return { ok: mismatches.length === 0, pairs, mismatches }
}

/** A reply compared as the operator meant it: case, markdown and closing punctuation ignored. */
export const normaliseReply = (s: string) => s.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '').toLowerCase()
