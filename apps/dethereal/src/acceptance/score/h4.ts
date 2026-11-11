/**
 * H4: every trust decision in the final model was put to the operator first.
 *
 * The decisions: a boundary's `zone`, `planes` and `conduits`, a component's
 * `crownJewel: true`, and each element `scope.json` maps as a crown jewel.
 * For each final value, the change that last set it must be an observed write;
 * before that write, the run must have shown the gate question for it and the
 * operator must have answered it:
 *
 * | Value | Gate question |
 * |---|---|
 * | zone `RESTRICTED` | `restricted-promotion` |
 * | any other zone, planes | `boundary-trust` |
 * | conduits | `approved-channels` |
 * | crown jewels | `crown-jewel-confirm` |
 *
 * The value must be what the reply ratified. The answer sheet says, per gate,
 * whether its reply ratifies `all` or `none` of the proposal, and which values
 * it sets instead (by key element: a boundary is named by the key components it
 * holds). Under `all`, the value must equal the proposal in the gate message's
 * table: the row (a line starting with `|`) that names the element. Under
 * `none`, only the named exceptions may be written.
 *
 * A value set by a server call counts as that call's write when the call's
 * input holds the value; otherwise, or when a command set it, it needs review.
 * A value with no observed write at all fails.
 */
import fs from 'node:fs'
import path from 'node:path'
import { REPLY_MODES, replyForms, type AnswerSheet } from '../answer-sheet.js'
import { mentions, type ExpectedKey } from '../key.js'
import { modelDirOf } from '../transcripts/replay.js'
import type { TranscriptEvent } from '../transcripts/types.js'
import { CROWN_JEWEL_MAPPING, type ElementChange } from './element-changes.js'
import type { Push } from './id-remap.js'
import type { Matching, RunModel } from './match.js'
import { outcome, type Finding, type GateOutcome } from './outcome.js'
import { segmentOf, shownText, stringsOf, type ShownPrompt } from './prompts.js'
import { normaliseOperatorText, normaliseReply } from './replies.js'
import { lastWriter } from './last-writer.js'

export const ZONES = ['UNTRUSTED', 'PUBLIC', 'EXPOSED', 'INTERNAL', 'RESTRICTED', 'VENDOR'] as const

export interface GateValue {
  element: string
  field: 'zone' | 'planes' | 'conduits' | 'crownJewel' | typeof CROWN_JEWEL_MAPPING
  value: unknown
}

/** The trust decisions the final model holds. */
export function gateValues(run: RunModel, modelDir: string): GateValue[] {
  const out: GateValue[] = []
  for (const b of run.boundaries) {
    if (typeof b.zone === 'string') out.push({ element: b.id, field: 'zone', value: b.zone })
    if (Array.isArray(b.planes) && b.planes.length) out.push({ element: b.id, field: 'planes', value: b.planes })
    if (Array.isArray(b.conduits) && b.conduits.length) out.push({ element: b.id, field: 'conduits', value: b.conduits })
  }
  for (const c of run.components) if (c.crownJewel === true) out.push({ element: c.id, field: 'crownJewel', value: true })
  try {
    const scope = JSON.parse(fs.readFileSync(path.join(modelDir, '.dethereal', 'scope.json'), 'utf8'))
    const mapping = scope?.[CROWN_JEWEL_MAPPING]
    const byId = new Map<string, string[]>()
    if (mapping && typeof mapping === 'object') {
      for (const [name, ids] of Object.entries(mapping as Record<string, unknown>)) {
        for (const id of Array.isArray(ids) ? ids : []) if (typeof id === 'string') byId.set(id, [...(byId.get(id) ?? []), name])
      }
    }
    for (const [id, names] of byId) out.push({ element: id, field: CROWN_JEWEL_MAPPING, value: names.sort() })
  } catch {
    // no scope file: nothing mapped
  }
  return out
}

export function gatePromptFor(v: GateValue): string {
  if (v.field === 'zone') return v.value === 'RESTRICTED' ? 'restricted-promotion' : 'boundary-trust'
  if (v.field === 'planes') return 'boundary-trust'
  if (v.field === 'conduits') return 'approved-channels'
  return 'crown-jewel-confirm'
}

/** A markdown table: its header cells and its data rows' cells. */
export interface Table { header: string[]; rows: string[][] }

const cellsOf = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

/** The tables a gate message shows: its own, and for a dialog those of the assistant message before it. */
export function gateTables(events: TranscriptEvent[], messageSeq: number): Table[] {
  const msg = events[messageSeq]!
  const texts = [shownText(msg)]
  if (msg.kind === 'ask') {
    for (let i = messageSeq - 1; i >= 0; i--) {
      const e = events[i]!
      if (e.actor !== 'main') continue
      if (e.kind === 'assistant') {
        texts.push(e.text ?? '')
        break
      }
      if (e.kind === 'user' || e.kind === 'answer') break
    }
  }
  const tables: Table[] = []
  for (const t of texts) {
    let current: string[][] | null = null
    for (const line of t.split('\n')) {
      if (!line.trimStart().startsWith('|')) {
        current = null
        continue
      }
      const cells = cellsOf(line)
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue
      if (!current) {
        current = []
        tables.push({ header: cells, rows: current })
      } else current.push(cells)
    }
  }
  return tables.map(withoutRowIds)
}

const ROW_ID_HEADER = /^(?:#|id|no\.?)$/i
const ROW_ID = /^[A-Za-z]{0,2}\d+$/

/** A leading row-number column (headed `#`, `ID` or `No.`, every cell a row id such as `3` or `T3`) is layout: drop it. */
export function withoutRowIds(t: Table): Table {
  const strip = (c: string) => c.replace(/[*_`]/g, '').trim()
  if (!ROW_ID_HEADER.test(strip(t.header[0] ?? '')) || !t.rows.length || !t.rows.every((r) => ROW_ID.test(strip(r[0] ?? '')))) return t
  return { header: t.header.slice(1), rows: t.rows.map((r) => r.slice(1)) }
}

const JSON_EQ = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export interface H4Input {
  events: TranscriptEvent[]
  /** Changes to the final model's files, keyed by element */
  changes: ElementChange[]
  /** The final model directory's project-relative path ('.' for the root) */
  modelRel: string
  modelDir: string
  run: RunModel
  matching: Matching
  key: ExpectedKey
  sheet: AnswerSheet
  shown: ShownPrompt[]
  /** Zone and plane display names (see `displayNames`) */
  displayNames: DisplayNames
  /** The run's pushes, to carry a settle's ids into the final model's */
  pushes?: Push[]
}

export function h4(input: H4Input): GateOutcome {
  const { events, run, matching, key, sheet, shown } = input
  const dir = input.modelRel === '.' ? '' : input.modelRel
  const changes = input.changes.filter((c) => modelDirOf(c.path) === dir)
  const findings: Finding[] = []
  const nameOf = (id: string) =>
    run.boundaries.find((b) => b.id === id)?.name ?? run.components.find((c) => c.id === id)?.name ?? run.dataItems.find((d) => d.id === id)?.name ?? run.flows.find((f) => f.id === id)?.name ?? id

  for (const v of gateValues(run, input.modelDir)) {
    // The element and the field, so a finding (and its adjudication) names the exact decision.
    const ref = [v.element, v.field]
    const last = [...changes].reverse().find((c) => c.element === v.element && c.field === v.field && JSON_EQ(c.after, v.value))
    if (!last) {
      findings.push({ verdict: 'FAIL', code: 'no_observed_write', detail: `${v.field} of ${v.element}: no write in the transcript sets the final value`, refs: ref })
      continue
    }
    let writeSeq: number
    if (last.event !== undefined) writeSeq = last.event
    else if (last.opaque!.since < 0) {
      findings.push({ verdict: 'FAIL', code: 'unobserved_write', detail: `${v.field} of ${v.element}: changed with no observed write`, events: [last.opaque!.resyncedAt], refs: ref })
      continue
    } else {
      // Read back from the window's end: the settle or file write that set the final value, with nothing after it
      // that may have changed it, dates the write at its call.
      const found = lastWriter(last, events, input.pushes ?? [])
      const since = events[last.opaque!.since]!
      const call = since.kind === 'server_write' ? events.find((e) => e.kind === 'tool_call' && e.callId === since.callId) : undefined
      // With none, the server call that opened the window dates it, when its input shows the value and nothing else
      // wrote in the window.
      const alone = !last.opaque!.alsoWritten?.length && !last.opaque!.alsoCovered?.length
      if (found !== undefined) writeSeq = found
      else if (call && alone && valueInInput(v, call.input)) writeSeq = call.seq
      else {
        findings.push({ verdict: 'needs-review', code: 'opaque_write', detail: `${v.field} of ${v.element}: set out of the replay's sight (window opened by a ${since.kind}), and no write in the window shows it set the value with nothing after it`, events: [since.seq], refs: ref })
        continue
      }
    }
    const promptId = gatePromptFor(v)
    const gate = [...shown].reverse().find((s) => s.id === promptId && s.event < writeSeq)
    const segment = segmentOf(events, writeSeq)
    if (!gate) {
      findings.push({ verdict: 'FAIL', code: 'no_gate', detail: `${v.field} of ${v.element}: written (segment ${segment}) with no ${promptId} question before it`, events: [writeSeq], refs: ref })
      continue
    }
    if (gate.answeredBy === undefined || gate.answeredBy > writeSeq) {
      findings.push({ verdict: 'FAIL', code: 'no_reply', detail: `${v.field} of ${v.element}: written (segment ${segment}) before the operator answered ${promptId}`, events: [gate.event, writeSeq], refs: ref })
      continue
    }
    const ev = [gate.event, gate.answeredBy, writeSeq]
    const prompt = sheet.prompts.find((p) => p.id === promptId)
    if (!prompt?.ratifies) {
      findings.push({ verdict: 'needs-review', code: 'no_ratification_rule', detail: `the answer sheet has no ratification rule for ${promptId}`, events: ev, refs: ref })
      continue
    }
    const readings = replyFor(events, gate.answeredBy, gate.event)
    const sheetReplies = [prompt.reply, ...prompt.variants.map((x) => x.reply)].flatMap((t) => REPLY_MODES.flatMap((m) => replyForms(prompt, t, m))).map(normaliseReply)
    if (!readings.some((r) => sheetReplies.includes(normaliseReply(r)))) {
      findings.push({ verdict: 'needs-review', code: 'reply_not_on_sheet', detail: `${v.field} of ${v.element}: the reply to ${promptId} is not the answer sheet's, so what it ratified is unknown`, events: ev, refs: ref })
      continue
    }
    const exception = exceptionFor(v, prompt.ratifiesExcept ?? {}, run, matching)
    if (exception !== undefined) {
      if (!ratifiedByException(v, exception, run, matching)) {
        findings.push({ verdict: 'FAIL', code: 'value_differs', detail: `${v.field} of ${v.element}: not the value the reply set`, events: ev, refs: ref })
      }
      continue
    }
    if (prompt.ratifies === 'none') {
      findings.push({ verdict: 'FAIL', code: 'unratified', detail: `${v.field} of ${v.element}: the reply to ${promptId} ratified none of it`, events: ev, refs: ref })
      continue
    }
    const rows = rowsNaming(gateTables(events, gate.event), [nameOf(v.element), v.element], proposalColumn(v.field))
    const verdict = againstProposal(v, rows, input.displayNames)
    if (verdict !== 'PASS') {
      findings.push({
        verdict, code: verdict === 'FAIL' ? 'value_differs' : 'unparseable_table',
        detail: verdict === 'FAIL' ? `${v.field} of ${v.element}: differs from the proposal the reply accepted` : `${v.field} of ${v.element}: no single proposal row names it`,
        events: ev, refs: ref,
      })
    }
  }
  return outcome('H4', findings)
}

/**
 * The numbered choices a question offers (`1. Accept all`, `2) Change`), from
 * the question and, for a dialog, the assistant message before it.
 */
export function numberedChoices(events: TranscriptEvent[], messageSeq: number): Map<string, string> {
  const msg = events[messageSeq]!
  const texts = [shownText(msg)]
  if (msg.kind === 'ask') {
    for (let i = messageSeq - 1; i >= 0; i--) {
      const e = events[i]!
      if (e.actor !== 'main') continue
      if (e.kind === 'assistant') {
        texts.push(e.text ?? '')
        break
      }
      if (e.kind === 'user' || e.kind === 'answer') break
    }
  }
  const out = new Map<string, string>()
  for (const line of texts.join('\n').split('\n')) {
    const m = /^\s*(?:[-*]\s*)?\**\(?(\d{1,2})[.)]\**\s+(.+)$/.exec(line)
    if (m && !out.has(m[1]!)) out.set(m[1]!, m[2]!.trim())
  }
  return out
}

/**
 * The operator's reply to a question, as they meant it: a typed text or a
 * dialog's picked label. A bare number resolves to the numbered choice it
 * picks, read both whole and as its label.
 */
export function replyFor(events: TranscriptEvent[], replySeq: number, messageSeq: number): string[] {
  const e = events[replySeq]
  if (!e) return []
  const raw = e.kind === 'answer' ? (e.answers ?? []).join('\n') : normaliseOperatorText(e.text ?? '')
  const picked = /^\s*(\d{1,2})[.)]?\s*$/.exec(raw)
  const choice = picked ? numberedChoices(events, messageSeq).get(picked[1]!) : undefined
  return choice ? [choice, choiceLabel(choice)] : [raw]
}

/** A choice's label: its text before a dash or colon that starts its explanation. */
const choiceLabel = (choice: string) => choice.split(/\s+[—–-]\s+|:\s+/)[0]!.trim()

/**
 * The text of a server call's input: its strings, and the keys of a settle call's `confirm` and `accept` maps, which
 * name the element and field there (`<group>/<element_id>/<field>`).
 */
export function inputStrings(input: unknown): string {
  const maps = input && typeof input === 'object' ? (['confirm', 'accept'] as const).map((k) => (input as Record<string, unknown>)[k]) : []
  const keys = maps.flatMap((m) => (m && typeof m === 'object' && !Array.isArray(m) ? Object.keys(m) : []))
  return [...stringsOf(input), ...keys].join('\n')
}

/** A server call's input holds the value: the zone or plane names, a conduit's peer, a crown-jewel flag. */
function valueInInput(v: GateValue, input: unknown): boolean {
  const strings = inputStrings(input)
  if (v.field === 'zone') return new RegExp(`\\b${String(v.value)}\\b`).test(strings) && strings.includes(v.element)
  if (v.field === 'planes') return (v.value as unknown[]).every((p) => strings.includes(String(p)))
  if (v.field === 'conduits') return (v.value as Array<{ peerId?: unknown }>).every((c) => strings.includes(String(c.peerId)))
  if (v.field === 'crownJewel') return /crownJewel/.test(JSON.stringify(input ?? null)) && strings.includes(v.element)
  return strings.includes(v.element)
}

/** The exception the sheet names for this element's field, if any. */
function exceptionFor(v: GateValue, except: Record<string, Record<string, unknown>>, run: RunModel, matching: Matching): unknown {
  const boundary = run.boundaries.find((b) => b.id === v.element)
  for (const [keyId, fields] of Object.entries(except)) {
    const field = v.field === CROWN_JEWEL_MAPPING ? 'crownJewel' : v.field
    if (!(field in fields)) continue
    if (boundary) {
      if (boundary.componentIds.some((id) => matching.components.get(id) === keyId)) return fields[field]
    } else if (matching.components.get(v.element) === keyId || matching.dataItems.get(v.element) === keyId) return fields[field]
  }
  return undefined
}

function ratifiedByException(v: GateValue, expected: unknown, run: RunModel, matching: Matching): boolean {
  if (v.field === 'conduits') {
    const want = (Array.isArray(expected) ? expected : []) as Array<{ to_boundary_of?: string; direction?: string }>
    const got = v.value as Array<{ peerId?: unknown; direction?: unknown }>
    const holds = (boundaryId: unknown, keyId: string | undefined) =>
      run.boundaries.find((b) => b.id === boundaryId)?.componentIds.some((id) => matching.components.get(id) === keyId) ?? false
    return got.length === want.length && got.every((c) => want.some((w) => holds(c.peerId, w.to_boundary_of) && c.direction === w.direction))
  }
  if (v.field === CROWN_JEWEL_MAPPING) return expected === true
  return JSON_EQ(v.value, expected)
}

/** Display names of zones and planes, as the workflow shows them, by on-disk value. */
export type DisplayNames = Map<string, string[]>

/** The zone and plane display names from the workflow's guidelines table (`| `ENUM` | Display |`), with the enums themselves. */
export function displayNames(guidelines: string): DisplayNames {
  const out: DisplayNames = new Map()
  for (const m of guidelines.matchAll(/^\|\s*`([A-Z_]+)`\s*\|\s*([^|]+?)\s*\|\s*$/gm)) out.set(m[1]!, [m[1]!, m[2]!])
  for (const z of ZONES) if (!out.has(z)) out.set(z, [z])
  for (const p of ['WORKLOAD', 'MANAGEMENT']) if (!out.has(p)) out.set(p, [p, p[0] + p.slice(1).toLowerCase()])
  return out
}

/**
 * A table's rows whose first cell names the element (exactly first, a tree marker before it read as layout, then as
 * a whole word); else rows naming it anywhere. With a column, only the tables that hold it, and one row or none: a
 * name only contained in several rows is not a proposal for it.
 */
export function rowsNaming(tables: Table[], names: string[], column?: RegExp): Array<{ header: string[]; row: string[] }> {
  const wanted = names.filter(Boolean)
  // With a column, only the tables that hold it: another table naming the same element never shadows them.
  const all = tables.filter((t) => !column || t.header.some((h) => column.test(h))).flatMap((t) => t.rows.map((row) => ({ header: t.header, row })))
  // A tree marker before a nested row's name (`↳`, `└─`, `├`) is layout, not part of the name.
  const norm = (s: string) => s.replace(/[*_`]/g, '').replace(/^[\s↳└├│─>-]+/u, '').trim().toLowerCase()
  const exact = all.filter((r) => wanted.some((n) => norm(r.row[0] ?? '') === norm(n)))
  if (exact.length) return exact
  const first = all.filter((r) => wanted.some((n) => mentions(r.row[0] ?? '', n)))
  const found = first.length ? first : all.filter((r) => wanted.some((n) => r.row.some((c) => mentions(c, n))))
  // A proposal read by column must name one row: a name only contained in several is not a proposal for it.
  return column && found.length > 1 ? [] : found
}

const NEGATION = /\b(?:no|not|none|false|excluded?|never)\b|[✗❌]/i

/** A cell's lead: its text before a confidence tag (`[hi]`), a dash that starts the evidence, or a parenthesis. */
const leadOf = (cell: string) => cell.split(/`?\[|\s[—–]\s|\s-\s|\(/)[0] ?? cell

/** The values a cell shows among the given ones (by display name, or by the on-disk value in capitals). */
function valuesIn(cell: string, candidates: string[], names: DisplayNames): string[] {
  return candidates.filter((v) => (names.get(v) ?? [v]).some((n) => (n === v ? new RegExp(`\\b${v}\\b`).test(cell) : mentions(cell, n))))
}

/** The column that proposes a gate value's field, for the fields a table proposes by column. */
export const proposalColumn = (field: string): RegExp | undefined => (field === 'zone' ? /\bzone\b/i : field === 'planes' ? /\b(?:plane|role)\b/i : undefined)

/**
 * The value against the proposal: the cell under a "zone" (or "plane"/"role")
 * header of the rows naming the element must show exactly one value, equal to
 * the written one. A crown-jewel or channel row must not negate the element.
 */

export function againstProposal(v: GateValue, rows: Array<{ header: string[]; row: string[] }>, names: DisplayNames): 'PASS' | 'FAIL' | 'needs-review' {
  if (!rows.length) return 'needs-review'
  if (v.field === 'zone' || v.field === 'planes') {
    const col = proposalColumn(v.field)!
    const candidates = v.field === 'zone' ? [...ZONES] : ['WORKLOAD', 'MANAGEMENT']
    // Only a table with the proposal's column proposes it (the enforcement table names the same boundaries).
    const proposing = rows.filter(({ header }) => header.some((h) => col.test(h)))
    if (!proposing.length) return 'needs-review'
    const shown = new Set<string>()
    for (const { header, row } of proposing) {
      const i = header.findIndex((h) => col.test(h))
      const cell = row[i] ?? ''
      const all = valuesIn(cell, candidates, names)
      // A cell proposes its value first, then its evidence: "Internal [hi] — SG restricted to internal CIDRs" proposes
      // INTERNAL, whatever zone name the evidence happens to use.
      const lead = all.length > 1 ? valuesIn(leadOf(cell), candidates, names) : all
      for (const x of lead.length === 1 ? lead : all) shown.add(x)
    }
    if (v.field === 'zone') {
      if (shown.size !== 1) return 'needs-review'
      return shown.has(String(v.value)) ? 'PASS' : 'FAIL'
    }
    const written = new Set((v.value as unknown[]).map(String))
    if (!shown.size) return 'needs-review'
    return shown.size === written.size && [...written].every((x) => shown.has(x)) ? 'PASS' : 'FAIL'
  }
  return rows.some(({ row }) => row.slice(1).some((c) => NEGATION.test(c))) ? 'FAIL' : 'PASS'
}
