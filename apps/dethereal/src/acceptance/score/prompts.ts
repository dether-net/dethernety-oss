/**
 * Which registry prompts a run showed, and where.
 *
 * A question carries its prompt id as `[prompt: <id>]`, or, in a question dialog,
 * as the exact header of one of its questions. It counts as shown in a
 * main-session question dialog or assistant message that carries the id and
 * every phrase the registry `requires` (whitespace collapsed, case
 * ignored), and that ends the turn: the next thing the session does, past
 * further assistant text, is to take operator input. A tagged message that
 * lacks a phrase is shown, but `complete` is false. A phrase written as a
 * choice list, `(a / b)`, is also met when the question offers each choice
 * (a dialog option, or a numbered or bulleted item). A phrase of alternatives,
 * `a | b`, is met by any one of them. A dialog the operator
 * dismissed ended the turn too, unanswered (`dismissed`), and so did the
 * operator's `/compact` or a compaction not recorded as automatic
 * (`compacted`): a compaction is never an answer. A message whose next action
 * is a dialog asking the same question waited with it: it takes the dialog's
 * outcome and names it (`via`), and the dialog is judged for both. A dialog the
 * harness rejected on its input showed nothing: a message's wait passes over it.
 */
import fs from 'node:fs'
import { parseRegistry } from '../../generator/registry.js'
import { claudeRenderer } from '../../generator/targets/claude/renderer.js'
import { codexRenderer } from '../../generator/targets/codex/renderer.js'
import { openCodeRenderer } from '../../generator/targets/opencode/renderer.js'
import type { TokenRenderer } from '../../generator/tokens.js'
import type { Harness } from '../../generator/types.js'
import type { TranscriptEvent } from '../transcripts/types.js'
import { normaliseOperatorText } from './replies.js'

export interface ShownPrompt {
  id: string
  /** The message or dialog that showed it */
  event: number
  /** Every `requires` phrase is in it */
  complete: boolean
  /** The `requires` phrases it lacks */
  missing: string[]
  /** The operator input that answered it, when the turn ended on it */
  answeredBy?: number
  /** The operator dismissed its dialog without answering */
  dismissed?: boolean
  /** The operator compacted the session while it waited: `/compact` is never an answer */
  compacted?: boolean
  /** Compactions before it */
  segment: number
  /** A message's showing that a dialog asking the same question followed at once: that dialog's event, whose outcome it took */
  via?: number
}

export type Registry = Map<string, { mandatory: boolean; requires: readonly string[] }>

const RENDERERS: Record<Harness, TokenRenderer> = { claude: claudeRenderer, codex: codexRenderer, opencode: openCodeRenderer }
const INLINE = /\{\{(cmd|tool|skill|agent):([^\s}]+)\}\}/g

/** A `requires` phrase as the harness shows it: its `{{cmd:x}}` and like tokens rendered as the bundle renders them in code. */
export function renderPhrase(phrase: string, harness: Harness): string {
  const renderer = RENDERERS[harness]
  return phrase.replace(INLINE, (_m, kind: 'cmd' | 'tool' | 'skill' | 'agent', name: string) => renderer.inline(kind, name, true))
}

/** The registry; with the run's harness, its `requires` phrases as that harness shows them. */
export function readRegistry(file: string, harness?: Harness): Registry {
  const { entries, findings } = parseRegistry(fs.readFileSync(file, 'utf8'))
  if (findings.length) throw new Error(`the prompt registry does not read: ${findings.map((f) => f.message).join('; ')}`)
  const shown = (p: string) => (harness ? renderPhrase(p, harness) : p)
  return new Map(entries.map((e) => [e.id, { mandatory: e.mandatory, requires: e.requires.map(shown) }]))
}

/** Every string inside a value, in order. */
export function stringsOf(v: unknown): string[] {
  if (typeof v === 'string') return [v]
  if (Array.isArray(v)) return v.flatMap(stringsOf)
  if (v && typeof v === 'object') return Object.values(v).flatMap(stringsOf)
  return []
}

/** The text a question or message shows: its text, or a dialog's questions, headers and options. */
export const shownText = (e: TranscriptEvent): string => [e.text ?? '', ...(e.kind === 'ask' ? stringsOf(e.input) : [])].join('\n')

const TAG = /\[prompt:\s*([a-z0-9][a-z0-9-]*)\s*\]/g
const collapse = (s: string) => s.replace(/\s+/g, ' ').toLowerCase()
/**
 * A phrase as the matcher also reads it: sentence punctuation, quotes and emphasis markup ignored as well as case and
 * spacing ("a, b, or c" is "a, b or c"). Brackets stay: "(not read)" is not "not read".
 */
const wordsOf = (s: string) => collapse(s.replace(/[.,;:!?"'`*_\u2018\u2019\u201c\u201d]/g, ' ')).replace(/ +/g, ' ').trim()

/** A registry phrase that lists the choices a question offers, `(a / b / …)`: met by the notation itself, or by offering every choice. */
const CHOICES = /^\((.+ \/ .+)\)$/

/** The choices a question offers: its dialog's option labels, and the numbered or bulleted items of its text. */
function offeredChoices(e: TranscriptEvent): string[] {
  const out: string[] = []
  if (e.kind === 'ask') {
    const questions = (e.input as { questions?: Array<{ options?: Array<{ label?: unknown }> }> } | undefined)?.questions
    for (const q of Array.isArray(questions) ? questions : []) for (const o of Array.isArray(q.options) ? q.options : []) if (typeof o.label === 'string') out.push(o.label)
  }
  for (const line of shownText(e).split('\n')) {
    const m = /^\s*(?:\d+[.)]|[-*•])\s+(.+)$/.exec(line)
    if (m) out.push(m[1]!)
  }
  return out.map((c) => collapse(c).trim())
}

/** A choice is offered when an offered item is it, or starts with it and goes on past a word boundary. */
const offers = (offered: string[], choice: string) => offered.some((o) => o === choice || (o.startsWith(choice) && !/[\p{L}\p{N}]/u.test(o[choice.length]!)))

/** Whether a question's text meets a registry phrase. */
function meets(e: TranscriptEvent, text: string, phrase: string): boolean {
  // Alternatives, `a | b`, are met by any one of them.
  if (phrase.includes(' | ')) return phrase.split(' | ').some((p) => meets(e, text, p.trim()))
  if (collapse(text).includes(collapse(phrase))) return true
  const m = CHOICES.exec(phrase.trim())
  // A choice list is met only by the choices offered; any other phrase also with its punctuation ignored.
  if (!m) return wordsOf(text).includes(wordsOf(phrase))
  const offered = offeredChoices(e)
  return m[1]!.split(' / ').every((c) => offers(offered, collapse(c).trim()))
}

/** The ids a dialog names as the header of one of its questions: registry ids only, exactly as written. */
function headedIds(e: TranscriptEvent, registry: Registry | undefined): string[] {
  if (e.kind !== 'ask' || !registry) return []
  const questions = (e.input as { questions?: unknown } | undefined)?.questions
  return (Array.isArray(questions) ? questions : [])
    .map((q) => (q && typeof q === 'object' ? (q as { header?: unknown }).header : undefined))
    .filter((h): h is string => typeof h === 'string' && registry.has(h))
}

/** The prompt ids an event carries: its tags, and a dialog's question headers that are registry ids. */
const idsOf = (e: TranscriptEvent, registry: Registry | undefined) =>
  [...new Set([...[...shownText(e).matchAll(TAG)].map((m) => m[1]!), ...headedIds(e, registry)])]

/** Kinds that end a wait for input: the session did something else instead. */
const ACTIVE = new Set(['ask', 'tool_call', 'shell', 'subagent_start', 'file_write', 'file_read', 'server_write', 'compaction'])

export function segmentOf(events: TranscriptEvent[], seq: number): number {
  let n = 0
  for (const e of events) {
    if (e.seq >= seq) break
    if (e.kind === 'compaction' && e.actor === 'main') n++
  }
  return n
}

/** A question call the harness rejected on its input: it showed nothing. */
const inputRejected = (events: TranscriptEvent[], ask: TranscriptEvent) =>
  events.some((n) => n.kind === 'answer' && n.callId === ask.callId && n.inputRejected === true)

/** The prompts a main-session question call carried that the harness rejected on its input before showing them. */
export function rejectedPromptCalls(events: TranscriptEvent[], registry?: Registry): Array<{ id: string; event: number }> {
  return events.filter((e) => e.kind === 'ask' && e.actor === 'main' && inputRejected(events, e))
    .flatMap((e) => idsOf(e, registry).map((id) => ({ id, event: e.seq })))
}

/** How a showing's wait ended: answered, dismissed or compacted, or neither; and the dialog, when one ended it. */
interface Wait { answeredBy?: number; dismissed: boolean; compacted: boolean; dialog?: number }

/** The wait after the question at `i`, until the operator's input or the session's next action. */
function waitAfter(events: TranscriptEvent[], i: number): Wait {
  const e = events[i]!
  const rejected = new Set<string>()
  for (let j = i + 1; j < events.length; j++) {
    const n = events[j]!
    if (n.actor !== 'main') continue
    // A dialog the harness rejected showed nothing: a message waits on past it and its error, to the retry.
    if (e.kind === 'assistant' && n.kind === 'ask' && n.callId !== undefined && inputRejected(events, n)) {
      rejected.add(n.callId)
      continue
    }
    if (n.kind === 'answer' && n.callId !== undefined && rejected.has(n.callId)) continue
    // The operator's `/compact`, or a compaction not recorded as automatic, ends the wait unanswered; an automatic
    // one does not: the operator's reply may still come.
    if ((n.kind === 'user' && /^\/compact(\s|$)/.test(normaliseOperatorText(n.text ?? ''))) || (n.kind === 'compaction' && n.trigger !== 'auto')) {
      return { dismissed: false, compacted: true }
    }
    if (n.kind === 'compaction') continue
    if (n.kind === 'user' || (n.kind === 'answer' && !n.isError && (n.answers?.length ?? 0) > 0)) return { answeredBy: n.seq, dismissed: false, compacted: false }
    // A dialog that failed or came back empty was not answered: the operator saw nothing to answer.
    // One the operator dismissed was waited for, and not answered.
    if (n.kind === 'answer') return { dismissed: e.kind === 'ask' && n.callId === e.callId && n.dismissed === true, compacted: false }
    if (ACTIVE.has(n.kind)) return { dismissed: false, compacted: false, ...(n.kind === 'ask' ? { dialog: j } : {}) }
  }
  return { dismissed: false, compacted: false }
}

export function shownPrompts(events: TranscriptEvent[], registry: Registry): ShownPrompt[] {
  const out: ShownPrompt[] = []
  let segment = 0
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    if (e.kind === 'compaction' && e.actor === 'main') segment++
    if (e.actor !== 'main' || (e.kind !== 'ask' && e.kind !== 'assistant')) continue
    if (e.kind === 'ask' && inputRejected(events, e)) continue
    const text = shownText(e)
    const ids = idsOf(e, registry)
    if (!ids.length) continue
    const wait = waitAfter(events, i)
    // A message followed at once by a dialog (one the harness rejected is passed over in the wait): the questions the
    // dialog asks again wait with it.
    const dialog = e.kind === 'assistant' ? wait.dialog : undefined
    const again = dialog !== undefined ? idsOf(events[dialog]!, registry) : []
    const viaWait = dialog !== undefined ? waitAfter(events, dialog) : undefined
    for (const id of ids) {
      const via = viaWait && again.includes(id) ? events[dialog!]!.seq : undefined
      const { answeredBy, dismissed, compacted } = via !== undefined ? viaWait! : wait
      const requires = registry.get(id)?.requires ?? []
      const missing = requires.filter((p) => !meets(e, text, p))
      out.push({
        id, event: e.seq, complete: missing.length === 0, missing, ...(answeredBy !== undefined ? { answeredBy } : {}), ...(dismissed ? { dismissed } : {}),
        ...(compacted ? { compacted } : {}), segment, ...(via !== undefined ? { via } : {}),
      })
    }
  }
  return out
}
