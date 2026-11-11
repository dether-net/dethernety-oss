/**
 * What a run used, by the method the acceptance bar is measured with: tokens and their cost, model-active time, and
 * the thinking share. It reads a Claude Code run's own transcripts (the main session's and every
 * subagent's) and, for the operator's waits, the run directory's `approvals.jsonl` and `operator-waits.jsonl`.
 *
 * - **Tokens** are counted once per API message: Claude Code writes one record per content block, each with the
 *   message's usage, so each field is taken at its largest over the records of one message id. Per model:
 *   uncached input, 5-minute and 1-hour cache writes, cache reads and output.
 * - **Cost** is those tokens at a price table (USD per million tokens, per model id; a dated model id takes the
 *   longest table key it starts with). A model the table does not list is named, never guessed.
 * - **Compactions** are not in the transcripts' usage: each is counted, with the context it read (`preTokens`) and
 *   the summary it left (`postTokens`), and priced apart as an estimate.
 * - **Model-active time** is the sum of the segments from each operator reply to the next question; overlapping
 *   segments are merged, and the last one runs to the last assistant record of the main session. A question is a
 *   question dialog, or the last assistant record before a message the operator typed (or a `/compact`).
 * - **Net time** also removes the operator's waits inside those segments: each `operator-waits.jsonl` window and
 *   each approval decided by hand (from its `ts` to its `decidedAt`), wholly; and after an approval decided by hand
 *   with no `decidedAt`, the first gap of 30 s or more in which no transcript has a record, looked for up to an hour
 *   after it (an estimate, reported as such). Time a subagent is working is never removed.
 * - **Thinking share** is the API's own count: each message's `output_tokens_details.thinking_tokens` over its output
 *   tokens, on the messages that carry it (`coverage` says how many do). Claude Code keeps most thinking text
 *   redacted, so where the count is missing only the thinking blocks are counted, never estimated.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

type Rec = Record<string, any>

/** Prices in USD per million tokens, for one model. */
export interface ModelPrice {
  input: number
  cache_write_5m?: number
  cache_write_1h?: number
  cache_read?: number
  output: number
}

export interface PriceTable {
  models: Record<string, ModelPrice>
  /** sha256 of the table file as read: two runs are priced alike only when it is the same */
  sha256: string
}

/**
 * A price table in its YAML shape: `models:`, then each model id at two spaces, then its prices at four
 * (`input`, `cache_write_5m`, `cache_write_1h`, `cache_read`, `output`); comments and other keys are skipped.
 */
export function readPriceTable(file: string): PriceTable {
  const text = fs.readFileSync(file, 'utf8')
  const models: Record<string, ModelPrice> = {}
  let inModels = false
  let current: string | null = null
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').replace(/^#.*$/, '')
    if (!line.trim()) continue
    if (/^\S/.test(line)) {
      inModels = /^models:\s*$/.test(line)
      current = null
      continue
    }
    if (!inModels) continue
    let m = /^ {2}([A-Za-z0-9._-]+):\s*$/.exec(line)
    if (m) {
      current = m[1]!
      models[current] = { input: NaN, output: NaN }
      continue
    }
    m = /^ {4}(input|cache_write_5m|cache_write_1h|cache_read|output):\s*([0-9.]+)\s*$/.exec(line)
    if (m && current) (models[current] as unknown as Record<string, number>)[m[1]!] = Number(m[2])
  }
  for (const [id, p] of Object.entries(models)) if (!Number.isFinite(p.input) || !Number.isFinite(p.output)) delete models[id]
  return { models, sha256: createHash('sha256').update(text).digest('hex') }
}

/** The table's prices for a model id: an exact key, else the longest key the id starts with. */
export function priceFor(table: PriceTable, model: string): ModelPrice | undefined {
  if (table.models[model]) return table.models[model]
  const key = Object.keys(table.models).filter((k) => model.startsWith(k)).sort((a, b) => b.length - a.length)[0]
  return key ? table.models[key] : undefined
}

export interface Tokens {
  input: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
  output: number
  /** API messages counted */
  messages: number
}

export interface Usage {
  perModel: Record<string, Tokens>
  /** The Claude Code versions the transcripts' records name */
  claudeCodeVersions: string[]
  /** Output tokens over every model */
  outputTokens: number
  /** Cost at the price table, USD; null without a table or when a model is unpriced */
  costUsd: number | null
  /** Models the table does not price */
  unpriced: string[]
  priceTableSha256: string | null
  compactions: { count: number; preTokens: number; postTokens: number; estimatedUsd: number | null }
  time: {
    modelActiveSeconds: number
    netSeconds: number
    /** Removed from operator-waits windows and approvals with a decision time */
    measuredWaitSeconds: number
    /** Removed by the 30 s rule inside approvals decided by hand with no decision time */
    estimatedWaitSeconds: number
    /** estimatedWaitSeconds over netSeconds (0 when net is 0) */
    estimatedShare: number
  }
  thinking: {
    /** Thinking tokens over output tokens, on the messages that report them; null when none does */
    share: number | null
    thinkingTokens: number
    /** The messages that report their thinking tokens, of all messages */
    coverage: { reported: number; messages: number }
    blocks: number
    redactedBlocks: number
  }
}

export interface Approval { ts: string; tool: string; autopilotRule?: string; decidedAt?: string }
export interface OperatorWait { start: string; end: string; kind: string; what: string }

const GAP_SECONDS = 30

function jsonl(file: string): Rec[] {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l) as Rec]
    } catch {
      return []
    }
  })
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (e.name.endsWith('.jsonl')) out.push(p)
  }
  return out.sort()
}

const ms = (ts: unknown) => (typeof ts === 'string' ? Date.parse(ts) : NaN)
const isSubagent = (dir: string, file: string) => path.relative(dir, file).split(path.sep).slice(0, -1).includes('subagents')

type Interval = [number, number]
/** The union of intervals, merged and sorted. */
function union(xs: Interval[]): Interval[] {
  const s = xs.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  const out: Interval[] = []
  for (const [a, b] of s) {
    const last = out.at(-1)
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}
const length = (xs: Interval[]) => xs.reduce((t, [a, b]) => t + (b - a), 0)
/** The part of `xs` inside `ys` (both unions). */
function intersect(xs: Interval[], ys: Interval[]): Interval[] {
  const out: Interval[] = []
  for (const [a, b] of xs) for (const [c, d] of ys) if (Math.min(b, d) > Math.max(a, c)) out.push([Math.max(a, c), Math.min(b, d)])
  return union(out)
}
/** The part of `xs` outside `ys`. */
function minus(xs: Interval[], ys: Interval[]): Interval[] {
  let cur = union(xs)
  for (const [c, d] of union(ys)) cur = cur.flatMap(([a, b]): Interval[] => (d <= a || c >= b ? [[a, b]] : [...(c > a ? [[a, c] as Interval] : []), ...(d < b ? [[d, b] as Interval] : [])]))
  return cur
}

const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((c: Rec) => (c?.type === 'text' && typeof c.text === 'string' ? c.text : '')).join('\n') : ''

export interface MeasureOptions {
  priceTable?: PriceTable
  approvals?: Approval[]
  waits?: OperatorWait[]
  /** Records after this time (ms since the epoch) are not counted: the end of the walk */
  to?: number
}

/** What a Claude Code run used, read from its transcripts directory. */
export function measureClaude(transcriptsDir: string, options: MeasureOptions = {}): Usage {
  const to = options.to ?? Infinity
  const files = walk(transcriptsDir)
  const perMessage = new Map<string, { model: string; t: Tokens; thinking: number | null; blocks: number; redacted: number }>()
  /** The main session's messages per model: a compaction is the main session's call */
  const mainModels = new Map<string, number>()
  const all: number[] = []
  const versions = new Set<string>()
  const subagentRuns: Interval[] = []
  const compactions = { count: 0, preTokens: 0, postTokens: 0 }
  // The main session's questions and replies, in order.
  const events: Array<{ t: number; kind: 'ask' | 'reply' }> = []
  let lastMainAssistant = -Infinity
  for (const file of files) {
    const sub = isSubagent(transcriptsDir, file)
    const recs = jsonl(file).filter((r) => ms(r.timestamp) <= to)
    const times = recs.map((r) => ms(r.timestamp)).filter(Number.isFinite)
    all.push(...times)
    if (sub && times.length) subagentRuns.push([Math.min(...times), Math.max(...times)])
    const pending = new Set<string>()
    let lastAssistant: number | null = null
    for (const r of recs) {
      const t = ms(r.timestamp)
      if (typeof r.version === 'string' && r.version) versions.add(r.version)
      if (r.type === 'system' && r.subtype === 'compact_boundary') {
        if (!sub) {
          compactions.count++
          compactions.preTokens += Number(r.compactMetadata?.preTokens ?? 0)
          compactions.postTokens += Number(r.compactMetadata?.postTokens ?? 0)
        }
        continue
      }
      // Claude Code's own placeholder after an API error: no model, no usage.
      if (r.type === 'assistant' && r.message?.model === '<synthetic>') continue
      if (r.type === 'assistant' && r.message) {
        const m = r.message as Rec
        const id = String(m.id ?? r.uuid ?? `${file}:${t}`)
        const u = (m.usage ?? {}) as Rec
        const cc = (u.cache_creation ?? {}) as Rec
        const w5 = Number(cc.ephemeral_5m_input_tokens ?? 0)
        const w1h = Number(cc.ephemeral_1h_input_tokens ?? 0)
        // An older record gives only the total write: it is read as 5-minute writes.
        const writes = !u.cache_creation && u.cache_creation_input_tokens ? { w5: Number(u.cache_creation_input_tokens), w1h: 0 } : { w5, w1h }
        const prev = perMessage.get(id)
        const row = prev ?? { model: String(m.model ?? 'unknown'), t: { input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, messages: 1 }, thinking: null, blocks: 0, redacted: 0 }
        const thinking = (u.output_tokens_details as Rec | undefined)?.thinking_tokens
        if (typeof thinking === 'number') row.thinking = Math.max(row.thinking ?? 0, thinking)
        row.t.input = Math.max(row.t.input, Number(u.input_tokens ?? 0))
        row.t.cacheWrite5m = Math.max(row.t.cacheWrite5m, writes.w5)
        row.t.cacheWrite1h = Math.max(row.t.cacheWrite1h, writes.w1h)
        row.t.cacheRead = Math.max(row.t.cacheRead, Number(u.cache_read_input_tokens ?? 0))
        row.t.output = Math.max(row.t.output, Number(u.output_tokens ?? 0))
        for (const b of Array.isArray(m.content) ? (m.content as Rec[]) : []) {
          if (b.type === 'thinking' || b.type === 'redacted_thinking') {
            row.blocks++
            if (b.type === 'redacted_thinking' || !b.thinking) row.redacted++
          }
          if (!sub && b.type === 'tool_use' && b.name === 'AskUserQuestion') {
            pending.add(String(b.id))
            events.push({ t, kind: 'ask' })
          }
        }
        perMessage.set(id, row)
        if (!sub && !prev) mainModels.set(row.model, (mainModels.get(row.model) ?? 0) + 1)
        if (!sub) {
          lastAssistant = t
          lastMainAssistant = Math.max(lastMainAssistant, t)
        }
        continue
      }
      if (!sub && r.type === 'user' && r.message) {
        const content = r.message.content
        if (Array.isArray(content)) {
          for (const b of content as Rec[]) {
            if (b?.type === 'tool_result' && pending.has(String(b.tool_use_id))) {
              pending.delete(String(b.tool_use_id))
              events.push({ t, kind: 'reply' })
            }
          }
        }
        const text = textOf(content).trim()
        const typed = (r.origin as Rec | undefined)?.kind === 'human' || text.startsWith('<command-name>/compact')
        if (typed) {
          // The question it answers is the last thing the session said before it.
          if (lastAssistant !== null && (!events.length || events.at(-1)!.t < lastAssistant)) events.push({ t: lastAssistant, kind: 'ask' })
          events.push({ t, kind: 'reply' })
        }
      }
    }
  }
  events.sort((a, b) => a.t - b.t)

  // Model-active segments: from each reply to the next question, merged; the last to the last assistant record.
  const segments: Interval[] = []
  let covered = -Infinity
  events.forEach((e, i) => {
    if (e.kind !== 'reply') return
    const end = events.slice(i + 1).find((x) => x.kind === 'ask')?.t ?? lastMainAssistant
    const start = Math.max(e.t, covered)
    if (end > start) {
      segments.push([start, end])
      covered = end
    }
  })
  const active = union(segments)

  // Operator waits.
  all.sort((a, b) => a - b)
  const working = union(subagentRuns)
  const measured: Interval[] = (options.waits ?? []).map((w) => [ms(w.start), ms(w.end)] as Interval).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
  const estimated: Interval[] = []
  for (const a of options.approvals ?? []) {
    const start = ms(a.ts)
    // An approval the autopilot gave by its rule had no operator in it.
    if (!Number.isFinite(start) || (a.autopilotRule && a.autopilotRule !== 'operator-after-stop')) continue
    if (a.decidedAt && Number.isFinite(ms(a.decidedAt))) {
      measured.push([start, ms(a.decidedAt)])
      continue
    }
    // Decided by hand with no time: the gaps of 30 s or more until the next record after a gap closes it.
    const after = all.filter((t) => t > start)
    let prev = start
    for (const t of after) {
      if (t - prev >= GAP_SECONDS * 1000) {
        estimated.push([prev, t])
        break
      }
      prev = t
      if (t - start > 3_600_000) break
    }
  }
  const measuredOff = minus(intersect(active, union(measured)), working)
  const estimatedOff = minus(minus(intersect(active, union(estimated)), working), measuredOff)
  const modelActive = length(active) / 1000
  const net = modelActive - length(measuredOff) / 1000 - length(estimatedOff) / 1000

  // Tokens and cost.
  const perModel: Record<string, Tokens> = {}
  let thinkingTokens = 0
  let reportedOutput = 0
  let reported = 0
  let blocks = 0
  let redacted = 0
  for (const row of perMessage.values()) {
    const t = (perModel[row.model] ??= { input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, messages: 0 })
    t.input += row.t.input
    t.cacheWrite5m += row.t.cacheWrite5m
    t.cacheWrite1h += row.t.cacheWrite1h
    t.cacheRead += row.t.cacheRead
    t.output += row.t.output
    t.messages++
    if (row.thinking !== null) {
      thinkingTokens += row.thinking
      reportedOutput += row.t.output
      reported++
    }
    blocks += row.blocks
    redacted += row.redacted
  }
  const outputTokens = Object.values(perModel).reduce((s, t) => s + t.output, 0)
  const table = options.priceTable
  const unpriced = table ? Object.keys(perModel).filter((m) => !priceFor(table, m)) : []
  const costOf = (t: Tokens, p: ModelPrice) => (t.input * p.input + t.cacheWrite5m * (p.cache_write_5m ?? p.input) + t.cacheWrite1h * (p.cache_write_1h ?? p.input) + t.cacheRead * (p.cache_read ?? p.input) + t.output * p.output) / 1e6
  const costUsd = table && !unpriced.length ? Object.entries(perModel).reduce((s, [m, t]) => s + costOf(t, priceFor(table, m)!), 0) : null
  // A compaction is priced at the main session's model: the context read as input, the summary as output.
  const mainModel = [...mainModels].sort((a, b) => b[1] - a[1])[0]?.[0]
  const mainPrice = table && mainModel ? priceFor(table, mainModel) : undefined
  const estimatedUsd = compactions.count && mainPrice ? (compactions.preTokens * mainPrice.input + compactions.postTokens * mainPrice.output) / 1e6 : compactions.count ? null : 0
  return {
    perModel,
    claudeCodeVersions: [...versions].sort(),
    outputTokens,
    costUsd,
    unpriced,
    priceTableSha256: table?.sha256 ?? null,
    compactions: { ...compactions, estimatedUsd },
    time: {
      modelActiveSeconds: Math.round(modelActive),
      netSeconds: Math.round(net),
      measuredWaitSeconds: Math.round(length(measuredOff) / 1000),
      estimatedWaitSeconds: Math.round(length(estimatedOff) / 1000),
      // Waits that took all of the active time leave nothing timed: the whole of it is an estimate.
      estimatedShare: net > 0 ? length(estimatedOff) / 1000 / net : length(estimatedOff) > 0 ? 1 : 0,
    },
    thinking: {
      share: reported && reportedOutput > 0 ? thinkingTokens / reportedOutput : null,
      thinkingTokens,
      coverage: { reported, messages: perMessage.size },
      blocks,
      redactedBlocks: redacted,
    },
  }
}
