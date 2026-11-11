/**
 * The operator's reply a settle stores: how long it may be, what it may hold, and that the log of the last
 * settlements stays readable at that length. And the one wording, shared with the workflow, for why a
 * registration's element no longer has it.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { modelStateTool } from '../model-state.tool.js'
import { gateModel, writeGateModel } from '../../utils/__tests__/fixtures/gate-model.js'
import { ORPHAN_CAUSE, SETTLE_LIMITS, contentOf, nextLog, parseLog, replyProblem, sha256, type BaselineRead } from '../../utils/settlement.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE = path.resolve(__dirname, '../../..')
const LIMIT = SETTLE_LIMITS.replyChars
// The settle tests write and settle a whole model: seconds under a loaded full run.
vi.setConfig({ testTimeout: 30_000 })
const realHome = process.env.HOME
let root: string
let home: string

beforeAll(async () => {
  // Models in the project, the home elsewhere, as the settle tool's own tests keep them.
  root = await fs.mkdtemp(path.join(process.cwd(), '.test-reply-limit-'))
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-reply-limit-home-')))
  process.env.HOME = home
})
afterAll(async () => {
  process.env.HOME = realHome
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(home, { recursive: true, force: true })
})

describe('the operator\'s reply', () => {
  it('is taken up to 8000 characters, surrounding whitespace not counted', () => {
    expect(LIMIT).toBe(8000)
    expect(replyProblem('y'.repeat(LIMIT))).toBeNull()
    expect(replyProblem(`\n  ${'y'.repeat(LIMIT)}  \n`)).toBeNull()
    expect(replyProblem('y'.repeat(LIMIT + 1))).toBe('reply_invalid')
    // A line break is one character, kept.
    expect(replyProblem(`${'y'.repeat(LIMIT - 2)}\ny`)).toBeNull()
    expect(replyProblem('   ')).toBe('reply_invalid')
  })

  it('holds only visible words and line breaks: no control character, no lone surrogate', () => {
    const f = String.fromCharCode
    expect(replyProblem(`yes ${f(0xd83d, 0xde00)}`)).toBeNull()
    for (const bad of [f(0xd800), f(0xdc00), `a${f(0xdc00, 0xd800)}b`, `yes${f(7)}`, `tab${f(9)}here`, `bidi${f(0x202e)}`]) {
      expect(replyProblem(bad), JSON.stringify(bad)).toBe('reply_invalid')
    }
  })
})

describe('the log of settlements at the longest reply', () => {
  const read = (baseline: Record<string, unknown> | null): BaselineRead => ({ status: 'verified', baseline, bytes: null } as unknown as BaselineRead)
  const signedBy = (digest: string | null): BaselineRead => read({ ...contentOf(null), log_digest: digest, key_id: '0'.repeat(16), model_hash: '0'.repeat(64), v: 3 })

  /**
   * Fifty settlements, each with the costliest reply the limit lets through: every character three bytes in the file
   * (a quote or a backslash takes two; a lone surrogate, which would take six, is refused).
   */
  function fullLog(): Buffer {
    let log: Buffer | null = null
    const reply = `${'€'.repeat(LIMIT - 2)}"\\`
    expect(replyProblem(reply)).toBeNull()
    for (let i = 0; i < SETTLE_LIMITS.log + 5; i++) {
      const entry = { at: new Date(2026, 0, 1, 0, 0, i).toISOString(), action: 'settle' as const, items: SETTLE_LIMITS.items, decisions: { accept: 25, set: 25 }, reply }
      log = Buffer.from(nextLog(signedBy(log ? sha256(log) : null), log, entry).content)
    }
    return log!
  }

  it('stays under the 4 MiB the state reader takes, and keeps all of its last entries', () => {
    const log = fullLog()
    expect(log.length).toBeLessThan(4 * 1024 * 1024)
    const parsed = parseLog(log)
    expect(parsed.total).toBe(SETTLE_LIMITS.log + 5)
    expect(parsed.entries).toHaveLength(SETTLE_LIMITS.log)
    expect(parsed.entries.every((e) => e.action === 'settle' && e.reply.length === LIMIT)).toBe(true)
  })

  it('is read by get, which counts it and shows no reply', async () => {
    const dir = path.join(root, 'model')
    await writeGateModel(dir, gateModel())
    await fs.writeFile(path.join(dir, '.dethereal', 'state.json'), JSON.stringify({ currentState: 'ENRICHING', completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE'], staleElements: [] }))
    await fs.writeFile(path.join(dir, '.dethereal', 'settlements.json'), fullLog())
    const r = (await modelStateTool.run({ action: 'get', directory_path: dir }, { debug: false })) as any
    expect(r.success, r.error).toBe(true)
    const g = r.data
    expect(g.settlements_total).toBe(SETTLE_LIMITS.log + 5)
    expect(g.settlements_recent).toHaveLength(SETTLE_LIMITS.logShown)
    expect(JSON.stringify(g)).not.toContain('€€€')
  })
})

describe('why a registration\'s element no longer has it', () => {
  it('is worded once', () => {
    expect(ORPHAN_CAUSE).toBe('removed, moved, reclassified, re-pointed or changed')
  })

  it('is what the settle tool says, in its input and its refusals', () => {
    const src = readFileSync(path.join(PACKAGE, 'src/tools/model-state-settle.tool.ts'), 'utf8')
    // No other wording of the cause is left in the tool.
    expect(src).not.toMatch(/renamed or removed/)
    expect(src.match(/\$\{ORPHAN_CAUSE\}/g)).toHaveLength(3)
  })
})
