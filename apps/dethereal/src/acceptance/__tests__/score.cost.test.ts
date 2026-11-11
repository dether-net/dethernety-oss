/**
 * What a run used, measured on small Claude Code transcripts whose times and usage are known: tokens once per
 * message, cost at a price table, model-active and net time with the operator's waits taken out, compactions apart.
 */
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { measureClaude, priceFor, readPriceTable } from '../score/cost.js'

const dirs: string[] = []
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }) })
const T0 = Date.parse('2026-01-01T00:00:00Z')
const at = (s: number) => new Date(T0 + s * 1000).toISOString()

/** A transcripts directory: the main session's records, and each subagent's. */
function transcripts(main: object[], subagents: object[][] = []): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-cost-'))
  dirs.push(dir)
  fs.writeFileSync(path.join(dir, 's1.jsonl'), main.map((r) => JSON.stringify(r)).join('\n') + '\n')
  subagents.forEach((recs, i) => {
    fs.mkdirSync(path.join(dir, 's1', 'subagents'), { recursive: true })
    fs.writeFileSync(path.join(dir, 's1', 'subagents', `agent-${i}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n')
  })
  return dir
}
const typed = (s: number, text = 'go') => ({ type: 'user', timestamp: at(s), origin: { kind: 'human' }, message: { role: 'user', content: text } })
const said = (s: number, id: string, usage: Record<string, unknown>, content: object[] = [{ type: 'text', text: 'ok' }], model = 'claude-sonnet-5-20260901') =>
  ({ type: 'assistant', timestamp: at(s), message: { id, model, role: 'assistant', content, usage } })
const asked = (s: number, id: string, call: string) => said(s, id, { output_tokens: 10 }, [{ type: 'tool_use', id: call, name: 'AskUserQuestion', input: { questions: [] } }])
const answered = (s: number, call: string) => ({ type: 'user', timestamp: at(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call, content: 'yes' }] } })

const PRICES = `# test prices
date: 2026-01-01
models:
  claude-sonnet-5:            # main
    input: 1.00
    cache_write_5m: 1.50
    cache_write_1h: 2.00
    cache_read: 0.10
    output: 5.00
  other-model:
    input: 1
  cheap-model:
    input: 0.1
    output: 0.5
`

describe('tokens and cost', () => {
  it('count each message once, at the largest of each field over its records, and price them per model', () => {
    const dir = transcripts([
      typed(0),
      said(10, 'm1', { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 0 } }),
      // The same message's next content block, its usage as far as it had got.
      said(11, 'm1', { input_tokens: 100, output_tokens: 80, cache_read_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 0 } }),
    ], [[said(12, 'm2', { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 40 })]])
    const pricesFile = path.join(dir, 'prices.yaml')
    fs.writeFileSync(pricesFile, PRICES)
    const table = readPriceTable(pricesFile)
    // A model id with a date takes the key it starts with; a key without an output price is not a price.
    expect(priceFor(table, 'claude-sonnet-5-20260901')?.output).toBe(5)
    expect(table.models['other-model']).toBeUndefined()
    const u = measureClaude(dir, { priceTable: table })
    expect(u.perModel['claude-sonnet-5-20260901']).toEqual({ input: 110, cacheWrite5m: 240, cacheWrite1h: 0, cacheRead: 1000, output: 100, messages: 2 })
    expect(u.outputTokens).toBe(100)
    expect(u.costUsd).toBeCloseTo((110 * 1 + 240 * 1.5 + 1000 * 0.1 + 100 * 5) / 1e6, 12)
    expect(u.priceTableSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('name a model the table does not price, and price nothing then', () => {
    const dir = transcripts([typed(0), said(5, 'm1', { output_tokens: 5 }, undefined, 'unknown-model')])
    const pricesFile = path.join(dir, 'prices.yaml')
    fs.writeFileSync(pricesFile, PRICES)
    const u = measureClaude(dir, { priceTable: readPriceTable(pricesFile) })
    expect(u.unpriced).toEqual(['unknown-model'])
    expect(u.costUsd).toBeNull()
    expect(measureClaude(dir).costUsd).toBeNull()
  })

  it('count compactions apart, with the context they read and the summary they left, at the main session\'s model', () => {
    // Subagents on a cheaper model send more messages; the compaction is still the main session's call.
    const sub = [1, 2, 3].map((i) => said(6 + i, `s${i}`, { output_tokens: 1 }, undefined, 'cheap-model'))
    const dir = transcripts([typed(0), said(5, 'm1', { output_tokens: 5 }), { type: 'system', subtype: 'compact_boundary', timestamp: at(6), compactMetadata: { preTokens: 1000, postTokens: 100 } }], [sub])
    const pricesFile = path.join(dir, 'prices.yaml')
    fs.writeFileSync(pricesFile, PRICES)
    const u = measureClaude(dir, { priceTable: readPriceTable(pricesFile) })
    expect(u.compactions).toEqual({ count: 1, preTokens: 1000, postTokens: 100, estimatedUsd: (1000 * 1 + 100 * 5) / 1e6 })
  })
})

describe('model-active and net time', () => {
  // The operator types at 0; the session works to 20 and asks; the operator answers at 60; the session works to 100.
  const main = [typed(0), said(20, 'a', { output_tokens: 1 }), asked(20, 'q', 'c1'), answered(60, 'c1'), said(70, 'b', { output_tokens: 1 }), said(100, 'c', { output_tokens: 1 })]

  it('sums the segments from each reply to the next question, the last to the last assistant record', () => {
    expect(measureClaude(transcripts(main)).time).toMatchObject({ modelActiveSeconds: 60, netSeconds: 60 })
    // A typed message after a quiet session asks its question at the session's last word.
    const typedAgain = [typed(0), said(30, 'a', { output_tokens: 1 }), typed(90), said(95, 'b', { output_tokens: 1 })]
    expect(measureClaude(transcripts(typedAgain)).time.modelActiveSeconds).toBe(35)
  })

  it('takes out an approval decided by hand, and an operator wait, but never while a subagent works', () => {
    // A subagent works from 75 to 85.
    const sub = [said(75, 's1', { output_tokens: 1 }), said(85, 's2', { output_tokens: 1 })]
    const u = measureClaude(transcripts(main, [sub]), {
      approvals: [{ ts: at(72), tool: 'Edit', decidedAt: at(80) }, { ts: at(10), tool: 'Read', autopilotRule: 'read-only' }],
      waits: [{ start: at(88), end: at(92), kind: 'hand-step', what: 'an autopilot stop the operator resolved' }],
    })
    // 72–80 less the subagent's 75–85 is 3 s; the wait 88–92 is 4 s; the autopilot's approval is no wait.
    expect(u.time).toMatchObject({ modelActiveSeconds: 60, measuredWaitSeconds: 7, estimatedWaitSeconds: 0, netSeconds: 53 })
  })

  it('estimates a hand approval with no decision time from the quiet gap after it, and says so', () => {
    const quiet = [typed(0), said(10, 'a', { output_tokens: 1 }), said(15, 'b', { output_tokens: 1 }), said(75, 'c', { output_tokens: 1 }), said(80, 'd', { output_tokens: 1 })]
    const u = measureClaude(transcripts(quiet), { approvals: [{ ts: at(15), tool: 'Bash' }] })
    expect(u.time).toMatchObject({ modelActiveSeconds: 80, estimatedWaitSeconds: 60, measuredWaitSeconds: 0, netSeconds: 20 })
    expect(u.time.estimatedShare).toBe(3)
    // A short gap is never a wait.
    const busy = [typed(0), said(10, 'a', { output_tokens: 1 }), said(20, 'b', { output_tokens: 1 }), said(40, 'c', { output_tokens: 1 })]
    expect(measureClaude(transcripts(busy), { approvals: [{ ts: at(10), tool: 'Bash' }] }).time.estimatedWaitSeconds).toBe(0)
  })

  it('counts nothing after the end it is given', () => {
    const u = measureClaude(transcripts(main), { to: T0 + 80_000 })
    expect(u.time.modelActiveSeconds).toBe(30)
    expect(u.perModel['claude-sonnet-5-20260901']!.messages).toBe(3)
  })
})

describe('the thinking share', () => {
  it('is the API\'s own count on the messages that report it, and only the blocks where none does', () => {
    const think = [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: 'ok' }]
    const dir = transcripts([
      typed(0),
      said(5, 'm1', { output_tokens: 100, output_tokens_details: { thinking_tokens: 40 } }, think),
      said(6, 'm1', { output_tokens: 120, output_tokens_details: { thinking_tokens: 60 } }, [{ type: 'text', text: 'more' }]),
      // A message that reports no count is left out of the share, never guessed.
      said(8, 'm2', { output_tokens: 500 }, think),
    ])
    expect(measureClaude(dir).thinking).toEqual({ share: 0.5, thinkingTokens: 60, coverage: { reported: 1, messages: 2 }, blocks: 2, redactedBlocks: 2 })
    expect(measureClaude(transcripts([typed(0), said(5, 'm1', { output_tokens: 10 }, [...think, { type: 'redacted_thinking', data: 'x' }])])).thinking).toMatchObject({ share: null, blocks: 2, redactedBlocks: 2 })
  })
})
