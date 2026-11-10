/**
 * Reader for acceptance answer sheets.
 *
 * An answer sheet is YAML in one fixed shape, and this reader accepts only
 * that shape: every line must be understood or the read fails, so a typo in a
 * sheet can never silently drop a reply.
 */

/**
 * How a run is answered: `bar` (the acceptance runs: the relay gives the operator's facts when its tables ask),
 * `loopback` (the loop-back regression run: the facts come at the first Gate 3 loop-back) or `quick` (a quick
 * run). Every mode condition on the sheet names these and nothing else.
 */
export type ReplyMode = 'bar' | 'loopback' | 'quick'
export const REPLY_MODES: readonly ReplyMode[] = ['bar', 'loopback', 'quick']

/** A variant has exactly one condition. */
export interface AnswerVariant {
  /** Case-insensitive substrings; any one in a table row of the turn's assistant messages selects the variant. */
  ifTableContainsAny?: string[]
  /** The prompt's Nth showing (N ≥ 2) and every later one select the variant. */
  fromShowing?: number
  /** The run's reply mode selects the variant. */
  ifMode?: ReplyMode
  reply: string
  /** Menu labels that carry this variant's reply (a `from_showing` variant only: a table variant's reply carries content) */
  picks?: string[]
}

/**
 * When a mandatory prompt must have been shown for a run to pass: `always`; `fixture` (its condition
 * holds on this fixture, so a correct run reaches it); `if_external_ingress` (only when the run's final
 * model, its channels removed, has an external-ingress crossing to ratify, or that cannot be told); `if_reviewable` (only when
 * the run's final Gate 3 passes or it asked for the move to REVIEWED, or that cannot be told); `if_shown` (its condition does
 * not hold here, so it is scored only when a run shows it).
 */
export type PromptRequired = 'always' | 'fixture' | 'if_external_ingress' | 'if_reviewable' | 'if_shown'
export const PROMPT_REQUIRED: readonly PromptRequired[] = ['always', 'fixture', 'if_external_ingress', 'if_reviewable', 'if_shown']

/**
 * What a reply to a ratification prompt ratifies: `all` of the proposal, `none` of it, with
 * `ratifiesExcept` naming, by key element id, the values the reply sets instead.
 */
export type Ratifies = 'all' | 'none'

/**
 * An operator fact a reply gives only when the question asks for it: when a table row before the question names
 * one of its triggers. The reply's `{facts}` line holds every such fact, as a `- ` bullet, in sheet order.
 */
export interface AnswerFact {
  id: string
  /** Case-insensitive substrings; any one in a table row before the question asks for the fact. */
  ifTableContainsAny: string[]
  text: string
  /** The reply modes that give it; absent, every mode does. */
  onlyModes?: ReplyMode[]
}

/** The line of a reply that holds its facts. */
export const FACTS_LINE = '{facts}'

export interface AnswerPrompt {
  id: string
  trigger: string
  mandatory: boolean
  required: PromptRequired
  /** `required` for the reply modes named here instead */
  requiredByMode?: Partial<Record<ReplyMode, PromptRequired>>
  /** The reply modes whose runs may ask it; absent, every mode's. A run of another mode never shows it. */
  onlyModes?: ReplyMode[]
  how: 'typed' | 'option-or-typed'
  reply: string
  note?: string
  ratifies?: Ratifies
  ratifiesExcept?: Record<string, Record<string, unknown>>
  /** Menu labels that carry the sheet reply (option-or-typed prompts that ratify nothing) */
  picks?: string[]
  variants: AnswerVariant[]
  facts: AnswerFact[]
}

/** The run modes a sheet may give their own invocation: a full run's is the top-level one. */
export type SheetRunMode = 'quick' | 'baseline'
export const SHEET_RUN_MODES: readonly SheetRunMode[] = ['quick', 'baseline']

export interface AnswerSheet {
  version: number
  invocation: Record<string, string>
  /** Per run mode, the invocation per harness that starts such a run */
  modes: Partial<Record<SheetRunMode, { invocation: Record<string, string> }>>
  fixed: Record<string, string>
  compaction: { trigger: string; steps: string[] }
  prompts: AnswerPrompt[]
  /** Registry prompts the guided flow cannot reach on this fixture, each with the reason */
  notOnFixture: Record<string, string>
  /** The skills tail, in order: each command as sent per harness (empty until that harness has one), and a note */
  tail: Array<{ id: string; commands: Record<string, string>; note?: string }>
}

export class AnswerSheetError extends Error {
  constructor(line: number, message: string) {
    super(`answer sheet line ${line}: ${message}`)
    this.name = 'AnswerSheetError'
  }
}

/** A scalar: a double-quoted JSON string, a one-line JSON list or object, a number or a boolean. */
function scalar(raw: string, line: number): unknown {
  const v = raw.trim()
  if (v.startsWith('"') || v.startsWith('[') || v.startsWith('{')) {
    try {
      return JSON.parse(v)
    } catch {
      throw new AnswerSheetError(line, 'not a valid quoted string or list')
    }
  }
  if (v === 'true' || v === 'false') return v === 'true'
  if (/^\d+$/.test(v)) return Number(v)
  if (/^[A-Za-z0-9 ,.'()_-]+$/.test(v)) return v
  throw new AnswerSheetError(line, `unquoted value "${v}"`)
}

/** Strip a trailing ` # comment` that sits outside quotes. */
function stripComment(s: string): string {
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"' && s[i - 1] !== '\\') quoted = !quoted
    if (!quoted && s[i] === '#' && (i === 0 || s[i - 1] === ' ')) return s.slice(0, i).trimEnd()
  }
  return s
}

export function parseAnswerSheet(text: string): AnswerSheet {
  const lines = text.split('\n')
  const sheet: AnswerSheet = { version: 0, invocation: {}, modes: {}, fixed: {}, compaction: { trigger: '', steps: [] }, prompts: [], notOnFixture: {}, tail: [] }
  let runMode: SheetRunMode | null = null
  let section: string | null = null
  let prompt: Record<string, unknown> | null = null
  let variant: Record<string, unknown> | null = null
  let fact: Record<string, unknown> | null = null
  /** The prompt's list the indented items belong to */
  let list: 'variants' | 'facts' | null = null
  let block: { target: Record<string, unknown>; key: string; indent: number; lines: string[] } | null = null

  const closeBlock = () => {
    if (block) block.target[block.key] = block.lines.join('\n').replace(/\n+$/, '') + '\n'
    block = null
  }
  const closePrompt = () => {
    closeBlock()
    if (!prompt) return
    const p = prompt
    for (const k of ['id', 'trigger', 'mandatory', 'required', 'how', 'reply']) {
      if (p[k] === undefined) throw new AnswerSheetError(0, `prompt ${String(p.id)} has no ${k}`)
    }
    if (p.how !== 'typed' && p.how !== 'option-or-typed') throw new AnswerSheetError(0, `prompt ${String(p.id)}: unknown how`)
    if (!(PROMPT_REQUIRED as readonly string[]).includes(p.required as string)) throw new AnswerSheetError(0, `prompt ${String(p.id)}: required must be ${PROMPT_REQUIRED.join(', ')}`)
    if (p.ratifies !== undefined && p.ratifies !== 'all' && p.ratifies !== 'none') throw new AnswerSheetError(0, `prompt ${String(p.id)}: ratifies must be all or none`)
    const except = p.ratifies_except
    if (except !== undefined && (typeof except !== 'object' || except === null || Array.isArray(except) || Object.values(except).some((v) => typeof v !== 'object' || v === null || Array.isArray(v)))) {
      throw new AnswerSheetError(0, `prompt ${String(p.id)}: ratifies_except must map element ids to field values`)
    }
    if (except !== undefined && p.ratifies === undefined) throw new AnswerSheetError(0, `prompt ${String(p.id)}: ratifies_except needs ratifies`)
    const labels = (v: unknown, what: string): string[] | undefined => {
      if (v === undefined) return undefined
      if (!Array.isArray(v) || !v.length || v.some((x) => typeof x !== 'string' || !x.trim())) throw new AnswerSheetError(0, `prompt ${String(p.id)}: ${what} must list menu labels`)
      return v as string[]
    }
    const modes = (v: unknown, what: string): ReplyMode[] => {
      if (!Array.isArray(v) || !v.length || v.some((x) => !(REPLY_MODES as readonly unknown[]).includes(x))) throw new AnswerSheetError(0, `prompt ${String(p.id)}: ${what} must list reply modes (${REPLY_MODES.join(', ')})`)
      return v as ReplyMode[]
    }
    const byMode = p.required_by_mode
    if (byMode !== undefined && (typeof byMode !== 'object' || byMode === null || Array.isArray(byMode) || !Object.keys(byMode).length ||
      Object.entries(byMode).some(([m, r]) => !(REPLY_MODES as readonly string[]).includes(m) || !(PROMPT_REQUIRED as readonly unknown[]).includes(r)))) {
      throw new AnswerSheetError(0, `prompt ${String(p.id)}: required_by_mode must map reply modes (${REPLY_MODES.join(', ')}) to ${PROMPT_REQUIRED.join(', ')}`)
    }
    const facts = ((p.facts as Array<Record<string, unknown>> | undefined) ?? []).map((f): AnswerFact => {
      if (typeof f.id !== 'string' || !/^[A-Za-z0-9-]+$/.test(f.id)) throw new AnswerSheetError(0, `prompt ${String(p.id)}: a fact needs an id`)
      const triggers = f.if_table_contains_any
      if (!Array.isArray(triggers) || !triggers.length || triggers.some((x) => typeof x !== 'string' || !x.trim())) throw new AnswerSheetError(0, `prompt ${String(p.id)}: fact ${f.id} needs if_table_contains_any, a list of substrings`)
      if (typeof f.text !== 'string' || !f.text.trim() || f.text.includes('\n')) throw new AnswerSheetError(0, `prompt ${String(p.id)}: fact ${f.id} needs a one-line text`)
      return { id: f.id, ifTableContainsAny: triggers as string[], text: f.text, ...(f.only_modes !== undefined ? { onlyModes: modes(f.only_modes, `fact ${f.id}'s only_modes`) } : {}) }
    })
    if (new Set(facts.map((f) => f.id)).size !== facts.length) throw new AnswerSheetError(0, `prompt ${String(p.id)}: a fact id is listed twice`)
    const factLines = (reply: string) => reply.split('\n').filter((l) => l.trim() === FACTS_LINE).length
    const variantReplies = ((p.variants as Array<Record<string, unknown>> | undefined) ?? []).map((v) => v.reply).filter((r): r is string => typeof r === 'string')
    for (const r of [String(p.reply), ...variantReplies]) {
      if (factLines(r) > 1) throw new AnswerSheetError(0, `prompt ${String(p.id)}: a reply holds ${FACTS_LINE} more than once`)
      if (factLines(r) && !facts.length) throw new AnswerSheetError(0, `prompt ${String(p.id)}: a reply holds ${FACTS_LINE}, and the prompt lists no facts`)
      if (r.includes(FACTS_LINE) && !factLines(r)) throw new AnswerSheetError(0, `prompt ${String(p.id)}: ${FACTS_LINE} must be a line of its own`)
      // With no fact asked for, the line is dropped: the reply must still say something.
      if (factLines(r) && !r.split('\n').some((l) => l.trim() && l.trim() !== FACTS_LINE)) throw new AnswerSheetError(0, `prompt ${String(p.id)}: a reply holds nothing but ${FACTS_LINE}`)
    }
    if (facts.length && ![String(p.reply), ...variantReplies].some((r) => factLines(r))) throw new AnswerSheetError(0, `prompt ${String(p.id)}: the prompt lists facts, and no reply holds ${FACTS_LINE}`)
    const picks = labels(p.picks, 'picks')
    if (picks && (p.how !== 'option-or-typed' || p.ratifies !== undefined)) throw new AnswerSheetError(0, `prompt ${String(p.id)}: picks only on an option-or-typed prompt that ratifies nothing`)
    sheet.prompts.push({
      id: String(p.id), trigger: String(p.trigger), mandatory: p.mandatory === true, required: p.required as PromptRequired,
      ...(byMode !== undefined ? { requiredByMode: byMode as Partial<Record<ReplyMode, PromptRequired>> } : {}),
      ...(p.only_modes !== undefined ? { onlyModes: modes(p.only_modes, 'only_modes') } : {}), how: p.how,
      reply: String(p.reply), ...(p.note !== undefined ? { note: String(p.note) } : {}),
      ...(p.ratifies !== undefined ? { ratifies: p.ratifies as Ratifies } : {}),
      ...(except !== undefined ? { ratifiesExcept: except as Record<string, Record<string, unknown>> } : {}),
      ...(picks ? { picks } : {}),
      facts,
      variants: ((p.variants as Array<Record<string, unknown>> | undefined) ?? []).map((v): AnswerVariant => {
        const table = v.if_table_contains_any !== undefined
        const showing = v.from_showing !== undefined
        const mode = v.if_mode !== undefined
        if ([table, showing, mode].filter(Boolean).length !== 1 || typeof v.reply !== 'string') {
          throw new AnswerSheetError(0, `prompt ${String(p.id)}: a variant needs one condition (if_table_contains_any, from_showing or if_mode) and a reply`)
        }
        if (mode && !(REPLY_MODES as readonly unknown[]).includes(v.if_mode)) throw new AnswerSheetError(0, `prompt ${String(p.id)}: if_mode must be a reply mode (${REPLY_MODES.join(', ')})`)
        if (table && !Array.isArray(v.if_table_contains_any)) throw new AnswerSheetError(0, `prompt ${String(p.id)}: if_table_contains_any must be a list`)
        if (showing && (!Number.isInteger(v.from_showing) || (v.from_showing as number) < 2)) throw new AnswerSheetError(0, `prompt ${String(p.id)}: from_showing must be a whole number from 2`)
        const variantPicks = labels(v.picks, 'a variant\'s picks')
        if (variantPicks && (!showing || p.how !== 'option-or-typed' || p.ratifies !== undefined)) {
          throw new AnswerSheetError(0, `prompt ${String(p.id)}: picks only on a from_showing variant of an option-or-typed prompt that ratifies nothing`)
        }
        return {
          ...(table ? { ifTableContainsAny: v.if_table_contains_any as string[] } : showing ? { fromShowing: v.from_showing as number } : { ifMode: v.if_mode as ReplyMode }),
          reply: v.reply, ...(variantPicks ? { picks: variantPicks } : {}),
        }
      }),
    })
    prompt = null
    variant = null
    fact = null
    list = null
  }

  for (let i = 0; i < lines.length; i++) {
    const n = i + 1
    const raw = lines[i]!
    if (block) {
      const indent = raw.length - raw.trimStart().length
      if (raw.trim() === '' || indent >= block.indent) {
        block.lines.push(raw.slice(block.indent))
        continue
      }
      closeBlock()
    }
    const line = stripComment(raw)
    if (line.trim() === '') continue
    const indent = line.length - line.trimStart().length

    if (indent === 0) {
      closePrompt()
      const m = /^([a-z_]+):\s*(.*)$/.exec(line)
      if (!m) throw new AnswerSheetError(n, 'expected a top-level key')
      section = m[1]!
      if (section === 'version') sheet.version = scalar(m[2]!, n) as number
      else if (!['invocation', 'modes', 'fixed', 'compaction', 'prompts', 'not_on_fixture', 'tail'].includes(section) || m[2] !== '') {
        throw new AnswerSheetError(n, `unknown top-level key ${section}`)
      }
      continue
    }

    if (section === 'invocation' || section === 'fixed' || section === 'not_on_fixture') {
      const m = /^ {2}([a-z0-9-]+):\s+(.+)$/.exec(line)
      if (!m) throw new AnswerSheetError(n, `expected a ${section} entry`)
      const target = section === 'not_on_fixture' ? sheet.notOnFixture : sheet[section]
      if (section === 'not_on_fixture' && m[1]! in target) throw new AnswerSheetError(n, `${m[1]} is listed twice`)
      target[m[1]!] = String(scalar(m[2]!, n))
      continue
    }

    if (section === 'modes') {
      let m = /^ {2}([a-z]+):$/.exec(line)
      if (m) {
        if (!(SHEET_RUN_MODES as readonly string[]).includes(m[1]!)) throw new AnswerSheetError(n, `a mode must be one of ${SHEET_RUN_MODES.join(', ')}`)
        if (m[1]! in sheet.modes) throw new AnswerSheetError(n, `mode ${m[1]} is listed twice`)
        runMode = m[1] as SheetRunMode
        sheet.modes[runMode] = { invocation: {} }
        continue
      }
      if (runMode && /^ {4}invocation:$/.test(line)) continue
      m = /^ {6}(claude|codex|opencode):\s+(.+)$/.exec(line)
      if (m && runMode) { sheet.modes[runMode]!.invocation[m[1]!] = String(scalar(m[2]!, n)); continue }
      throw new AnswerSheetError(n, 'expected a mode, its invocation, or a harness line under it')
    }

    if (section === 'tail') {
      let m = /^ {2}- id: ([a-z0-9-]+)$/.exec(line)
      if (m) { sheet.tail.push({ id: m[1]!, commands: {} }); continue }
      const entry = sheet.tail[sheet.tail.length - 1]
      m = /^ {4}(claude|codex|opencode|note):\s+(.+)$/.exec(line)
      if (!entry || !m) throw new AnswerSheetError(n, 'expected a tail entry')
      if (m[1] === 'note') entry.note = String(scalar(m[2]!, n))
      else entry.commands[m[1]!] = String(scalar(m[2]!, n))
      continue
    }

    if (section === 'compaction') {
      let m = /^ {2}trigger:\s+(.+)$/.exec(line)
      if (m) { sheet.compaction.trigger = String(scalar(m[1]!, n)); continue }
      if (/^ {2}steps:$/.test(line)) continue
      m = /^ {4}- (.+)$/.exec(line)
      if (m) { sheet.compaction.steps.push(String(scalar(m[1]!, n))); continue }
      throw new AnswerSheetError(n, 'expected a compaction entry')
    }

    if (section === 'prompts') {
      let m = /^ {2}- id: ([a-z0-9-]+)$/.exec(line)
      if (m) {
        closePrompt()
        prompt = { id: m[1] }
        continue
      }
      if (!prompt) throw new AnswerSheetError(n, 'prompt field outside a prompt')
      m = /^ {4}(variants|facts):$/.exec(line)
      if (m) {
        if (prompt[m[1]!] !== undefined) throw new AnswerSheetError(n, `${m[1]} is listed twice`)
        prompt[m[1]!] = []
        list = m[1] as 'variants' | 'facts'
        variant = null
        fact = null
        continue
      }
      m = /^ {6}- (if_table_contains_any|from_showing|if_mode): (.+)$/.exec(line)
      if (m && list === 'variants') {
        variant = { [m[1]!]: scalar(m[2]!, n) }
        ;(prompt.variants as unknown[]).push(variant)
        continue
      }
      m = /^ {8}(reply|picks): (.+)$/.exec(line)
      if (m && list === 'variants' && variant) {
        if (m[1]! in variant) throw new AnswerSheetError(n, `a variant's ${m[1]} is given twice`)
        variant[m[1]!] = m[1] === 'reply' ? String(scalar(m[2]!, n)) : scalar(m[2]!, n)
        continue
      }
      m = /^ {6}- id: ([A-Za-z0-9-]+)$/.exec(line)
      if (m && list === 'facts') {
        fact = { id: m[1] }
        ;(prompt.facts as unknown[]).push(fact)
        continue
      }
      m = /^ {8}(if_table_contains_any|text|only_modes): (.+)$/.exec(line)
      if (m && list === 'facts' && fact) {
        if (m[1]! in fact) throw new AnswerSheetError(n, `a fact's ${m[1]} is given twice`)
        fact[m[1]!] = scalar(m[2]!, n)
        continue
      }
      m = /^ {4}(trigger|mandatory|required|required_by_mode|only_modes|how|reply|note|ratifies|ratifies_except|picks):\s*(.*)$/.exec(line)
      if (m) {
        variant = null
        fact = null
        list = null
        if (m[1] === 'reply' && m[2] === '|') {
          block = { target: prompt, key: 'reply', indent: 6, lines: [] }
          continue
        }
        prompt[m[1]!] = scalar(m[2]!, n)
        continue
      }
      throw new AnswerSheetError(n, 'unknown prompt field')
    }
    throw new AnswerSheetError(n, 'line outside any section')
  }
  closePrompt()
  for (const id of Object.keys(sheet.notOnFixture)) {
    if (sheet.prompts.some((p) => p.id === id)) throw new AnswerSheetError(0, `${id} is both on the sheet and not on the fixture`)
  }
  return sheet
}

/**
 * Every reply text in the sheet, picks and facts included, with the prompt it belongs to (variant index when it is
 * a variant, fact id when it is a fact).
 */
export function allReplies(sheet: AnswerSheet): Array<{ prompt: string; variant?: number; fact?: string; text: string }> {
  return sheet.prompts.flatMap((p) => [
    { prompt: p.id, text: p.reply },
    ...(p.picks ?? []).map((text) => ({ prompt: p.id, text })),
    ...p.variants.flatMap((v, i) => [{ prompt: p.id, variant: i, text: v.reply }, ...(v.picks ?? []).map((text) => ({ prompt: p.id, variant: i, text }))]),
    ...p.facts.map((f) => ({ prompt: p.id, fact: f.id, text: f.text })),
  ])
}

/** A prompt's `required` in a reply mode: its `required_by_mode` entry for the mode, else its `required`. */
export function requiredIn(p: Pick<AnswerPrompt, 'required' | 'requiredByMode'>, mode: ReplyMode): PromptRequired {
  return p.requiredByMode?.[mode] ?? p.required
}

/** A prompt is asked in a reply mode its `only_modes` names, or in every mode when it names none. */
export const promptInMode = (p: Pick<AnswerPrompt, 'onlyModes'>, mode: ReplyMode) => !p.onlyModes || p.onlyModes.includes(mode)

/** The invocation that starts a run of this mode on this harness: the mode's own, else (a full run) the top-level one. */
export function invocationFor(sheet: AnswerSheet, runMode: 'full' | SheetRunMode, harness: string): string | undefined {
  return runMode === 'full' ? sheet.invocation[harness] : sheet.modes[runMode]?.invocation[harness]
}

/** A fact is given in a reply mode its `only_modes` names, or in every mode when it names none. */
export const factInMode = (f: AnswerFact, mode: ReplyMode) => !f.onlyModes || f.onlyModes.includes(mode)

/** Whether a reply holds the facts line. */
export const holdsFacts = (reply: string) => reply.split('\n').some((l) => l.trim() === FACTS_LINE)

/** The table rows of the given texts: every line that starts with `|`, lower case, one per line. */
export function tableRows(texts: string[]): string {
  return texts.join('\n').split('\n').filter((l) => l.trim().startsWith('|')).join('\n').toLowerCase()
}

/** Whether a row names one of the substrings, case-insensitive. */
export const rowsName = (rows: string, any: string[]) => any.some((x) => rows.includes(x.toLowerCase()))

/** A reply with its `{facts}` line filled by these facts, as `- ` bullets; with none, the line is dropped. */
export function withFacts(reply: string, facts: AnswerFact[]): string {
  return reply.split('\n').flatMap((l) => (l.trim() === FACTS_LINE ? facts.map((f) => `${l.slice(0, l.indexOf(FACTS_LINE))}- ${f.text}`) : [l])).join('\n')
}

/**
 * Every form a reply can be pasted in: its `{facts}` line filled with any of the prompt's facts of the mode, kept
 * in sheet order (none included). A reply without the line has one form.
 */
export function replyForms(prompt: Pick<AnswerPrompt, 'facts'>, reply: string, mode: ReplyMode): string[] {
  if (!holdsFacts(reply)) return [reply]
  const facts = prompt.facts.filter((f) => factInMode(f, mode))
  return Array.from({ length: 2 ** facts.length }, (_, bits) => withFacts(reply, facts.filter((_, i) => bits & (1 << i))))
}

export interface ChosenReply {
  /** The reply as pasted: the chosen text with its facts line filled */
  text: string
  /** The variant chosen (1-based), when one holds */
  variant?: number
  /** The facts filled in, by id, in sheet order */
  facts: string[]
}

/**
 * The sheet's reply to a prompt at this showing: the first variant, in sheet order, whose condition holds (a
 * table variant when a row names one of its substrings, a `from_showing` variant from that showing on, an
 * `if_mode` variant in that mode), else the reply; then its `{facts}` line filled with every fact of the mode
 * whose substrings a row names, in sheet order. A reply without the line gives no fact.
 */
export function chooseReply(prompt: AnswerPrompt, at: { showing: number; rows: string; mode: ReplyMode }): ChosenReply {
  const i = prompt.variants.findIndex((v) =>
    v.ifTableContainsAny ? rowsName(at.rows, v.ifTableContainsAny) : v.fromShowing !== undefined ? at.showing >= v.fromShowing : v.ifMode === at.mode)
  const reply = i >= 0 ? prompt.variants[i]!.reply : prompt.reply
  const facts = holdsFacts(reply) ? prompt.facts.filter((f) => factInMode(f, at.mode) && rowsName(at.rows, f.ifTableContainsAny)) : []
  return { text: withFacts(reply, facts), ...(i >= 0 ? { variant: i + 1 } : {}), facts: facts.map((f) => f.id) }
}
