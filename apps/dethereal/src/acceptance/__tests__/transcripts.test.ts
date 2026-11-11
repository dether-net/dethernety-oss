/**
 * The transcript parsers on real (scrubbed) excerpts of one run per harness:
 * each parse, projected without bodies, is held against a reviewed golden file,
 * plus the behaviours each excerpt was cut to show. Goldens change only through
 * an explicit update run (`vitest -u`), reviewed like code.
 */
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseRun, type Harness, type ParsedRun } from '../transcripts/index.js'
import { shownPrompts } from '../score/prompts.js'

const FIXTURES = path.resolve(import.meta.dirname, '..', 'fixtures', 'transcripts')
const input = (h: Harness) => (h === 'claude' ? path.join(FIXTURES, 'claude', 'project-dir') : path.join(FIXTURES, h))

/** The parse without texts, tool inputs and file contents: what the scorer relies on. */
function projection(run: ParsedRun) {
  return {
    schemaVersion: run.schemaVersion,
    harness: run.harness,
    projectRoot: run.projectRoot,
    events: run.events.map((e) => ({
      seq: e.seq, ts: e.ts, kind: e.kind, actor: e.actor, ...(e.turn ? { turn: e.turn } : {}), ...(e.tool ? { tool: e.tool } : {}),
      ...(e.path !== undefined ? { path: e.path } : {}), ...(e.outside ? { outside: true } : {}), ...(e.modelFile ? { modelFile: true } : {}),
      ...(e.fileOp ? { op: e.fileOp.op } : {}), ...(e.isError ? { isError: true } : {}), ...(e.writesModel ? { writesModel: true } : {}),
      ...(e.touches ? { touches: e.touches } : {}), ...(e.replayMismatch ? { replayMismatch: e.replayMismatch } : {}),
      ...(e.expectedMismatch ? { expectedMismatch: true } : {}), ...(e.source ? { source: e.source } : {}), ...(e.trigger ? { trigger: e.trigger } : {}),
    })),
    attributions: run.attributions,
    opaque: run.opaque,
    checkpoints: run.checkpoints,
    reconciliation: run.reconciliation,
    replayNotes: run.replayNotes,
  }
}

describe.each(['claude', 'codex', 'opencode'] as const)('%s transcript', (harness) => {
  const run = parseRun(harness, input(harness))

  it('matches its reviewed golden', async () => {
    await expect(`${JSON.stringify(projection(run), null, 1)}\n`).toMatchFileSnapshot(path.join(FIXTURES, `${harness}.expected.json`))
  })

  it('names the project root and keeps every model path project-relative', () => {
    expect(run.projectRoot).toBe('/work/project')
    for (const e of run.events.filter((x) => x.modelFile)) expect(e.path!.startsWith('/'), e.path).toBe(false)
  })

  it('orders events by time and numbers them in that order', () => {
    run.events.forEach((e, i) => {
      expect(e.seq).toBe(i)
      if (i) expect(e.ts >= run.events[i - 1]!.ts).toBe(true)
    })
  })

  it('attributes every value it follows to an event that wrote that file', () => {
    for (const a of run.attributions) {
      const e = run.events[a.event]!
      expect(e.kind).toBe('file_write')
      expect(e.path === a.path || (e.fileOp?.op === 'move' && e.fileOp.to === a.path)).toBe(true)
    }
  })

  it('takes checkpoints after questions, replies, compactions and turn ends', () => {
    const reasons = new Set(run.checkpoints.map((c) => c.reason))
    expect(reasons.has('compaction')).toBe(true)
    expect(reasons.has('user') || reasons.has('answer')).toBe(true)
    for (const c of run.checkpoints) expect(run.events[c.after]).toBeDefined()
  })
})

describe('per-harness behaviour in the excerpts', () => {
  it('Claude: file tools carry the file before the change, so the replay stays exact', () => {
    const run = parseRun('claude', input('claude'))
    expect(run.replayNotes).toEqual([])
    expect(run.events.filter((e) => e.kind === 'file_write').every((e) => !e.replayMismatch && !e.expectedMismatch)).toBe(true)
    // The attribute stubs the server wrote show up when the next write reveals the file as it was.
    expect(run.opaque.some((o) => run.events[o.since]?.kind === 'server_write' && run.events[o.since]!.tool === 'dethereal.generate_attribute_stubs')).toBe(true)
    // The subagent acts under its own name.
    expect(run.events.some((e) => e.kind === 'file_write' && e.actor === 'dethereal:security-enricher')).toBe(true)
    expect(run.reconciliation.crossCheck).toBe('partial')
    expect(run.reconciliation.unobserved).toEqual([])
  })

  it('Codex: an update whose earlier change is missing does not apply, and a later whole-file read resyncs', () => {
    const run = parseRun('codex', input('codex'))
    const bad = run.events.find((e) => e.replayMismatch)!
    expect(bad.path).toBe('threat-models/online-boutique/.dethereal/state.json')
    const resync = run.opaque.find((o) => o.since === bad.seq)
    expect(resync).toBeDefined()
    expect(run.events[resync!.resyncedAt]!.kind).toBe('file_read')
    expect(run.reconciliation.crossCheck).toBe('unavailable')
    expect(run.reconciliation.unobserved).toEqual([])
  })

  it("OpenCode: every tracked change is explained, including a shell edit of the model, and the display diffs agree", () => {
    const run = parseRun('opencode', input('opencode'))
    const sed = run.events.find((e) => e.kind === 'shell' && e.writesModel)!
    expect(sed.touches).toEqual(expect.arrayContaining(['threat-models/online-boutique/structure.json']))
    expect(run.events.filter((e) => e.kind === 'file_write').some((e) => e.expectedMismatch)).toBe(false)
    expect(run.reconciliation.crossCheck).toBe('available')
    expect(run.reconciliation.unobserved).toEqual([])
    expect(run.events.filter((e) => e.kind === 'harness_change').length).toBeGreaterThan(0)
  })
})

describe('an item the parser does not know', () => {
  const tmps: string[] = []
  afterAll(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }) })
  /** A copy of a harness's fixture, for one edit. */
  const copy = (h: Harness): string => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), `dethereal-unknown-${h}-`))
    tmps.push(d)
    fs.cpSync(input(h), d, { recursive: true })
    return d
  }
  const append = (file: string, rows: Array<Record<string, unknown>>) => fs.writeFileSync(file, JSON.stringify([...JSON.parse(fs.readFileSync(file, 'utf8')), ...rows]))

  it('is never in the fixtures, so their parses report none', () => {
    for (const h of ['claude', 'codex', 'opencode'] as const) expect(parseRun(h, input(h)).unknownTypes, h).toBeUndefined()
  })

  it('is counted by type in a Codex thread, and reasoning is not', () => {
    const d = copy('codex')
    const items = JSON.parse(fs.readFileSync(path.join(d, 'codex-thread-items.json'), 'utf8'))
    const last = items.at(-1)
    const item = (n: number, type: string) => ({ ...last, item_id: `u${n}`, rollout_ordinal: last.rollout_ordinal + n, item_type: type, item_json: JSON.stringify({ type, id: `u${n}` }) })
    append(path.join(d, 'codex-thread-items.json'), [item(1, 'codeExecution'), item(2, 'codeExecution'), item(3, 'reasoning')])
    expect(parseRun('codex', d).unknownTypes).toEqual({ codeExecution: 2 })
  })

  it('is counted by type in OpenCode parts, and a step\'s end and reasoning are not', () => {
    const d = copy('opencode')
    const parts = JSON.parse(fs.readFileSync(path.join(d, 'opencode-parts.json'), 'utf8'))
    const last = parts.at(-1)
    const part = (n: number, type: string) => ({ ...last, id: `zz-${n}`, data: JSON.stringify({ type }) })
    append(path.join(d, 'opencode-parts.json'), [part(1, 'subtask'), part(2, 'step-finish'), part(3, 'reasoning')])
    expect(parseRun('opencode', d).unknownTypes).toEqual({ subtask: 1 })
  })

  it('is counted in a Claude message\'s blocks; thinking and other records are not', () => {
    const d = copy('claude')
    const file = fs.readdirSync(d).find((f) => f.endsWith('.jsonl'))!
    const lines = fs.readFileSync(path.join(d, file), 'utf8').trim().split('\n')
    const assistant = JSON.parse(lines.findLast((l) => JSON.parse(l).type === 'assistant')!)
    const add = (content: unknown[], uuid: string) => JSON.stringify({ ...assistant, uuid, message: { ...assistant.message, content } })
    fs.writeFileSync(path.join(d, file), [...lines,
      add([{ type: 'server_tool_use', id: 'srv1', name: 'web_search', input: {} }], '00000000-0000-4000-8000-0000000fff01'),
      add([{ type: 'thinking', thinking: 'x' }, { type: 'redacted_thinking', data: 'y' }], '00000000-0000-4000-8000-0000000fff02'),
      JSON.stringify({ type: 'cost-state', uuid: '00000000-0000-4000-8000-0000000fff03' }),
    ].join('\n') + '\n')
    expect(parseRun('claude', d).unknownTypes).toEqual({ server_tool_use: 1 })
  })
})


describe('an OpenCode question the operator dismissed', () => {
  const tmps: string[] = []
  afterAll(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }) })

  it('is dismissed, not a failed dialog, and its prompt was waited on', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-oc-dismissed-'))
    tmps.push(d)
    fs.cpSync(input('opencode'), d, { recursive: true })
    const file = path.join(d, 'opencode-parts.json')
    const parts = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<Record<string, any>>
    const sessions = JSON.parse(fs.readFileSync(path.join(d, 'opencode-sessions.json'), 'utf8')) as Array<Record<string, any>>
    const main = sessions.find((s) => !s.parent_id)!.id
    const last = parts.filter((p) => p.session_id === main).at(-1)!
    const question = (n: number, state: Record<string, unknown>) => ({
      ...last, id: `zz-q${n}`, time_created: last.time_created + n,
      data: JSON.stringify({ type: 'tool', tool: 'question', callID: `q${n}`, state: { input: { questions: [{ header: 'session-break', question: '[prompt: session-break] Continue now?', options: [{ label: 'yes' }] }] }, time: { start: last.time_created + n, end: last.time_created + n }, ...state } }),
    })
    fs.writeFileSync(file, JSON.stringify([...parts,
      question(1, { status: 'error', error: 'The user dismissed this question' }),
      question(2, { status: 'error', error: 'the dialog could not be shown' }),
      question(3, { status: 'completed', output: 'User has answered your questions', metadata: { answers: [['yes']] } }),
    ]))
    const answers = parseRun('opencode', d).events.filter((e) => e.kind === 'answer' && e.callId?.startsWith('q'))
    expect(answers.map((e) => [e.callId, !!e.isError, e.dismissed ?? false, e.answers ?? null])).toEqual([
      ['q1', true, true, null], ['q2', true, false, null], ['q3', false, false, ['yes']],
    ])
    // The dismissed showing was waited on; a failed dialog was not; the answered one was answered.
    const events = parseRun('opencode', d).events
    const shown = shownPrompts(events, new Map([['session-break', { mandatory: true, requires: [] }]]))
    const callOf = (seq: number) => events.find((e) => e.seq === seq)!.callId
    expect(shown.filter((s) => callOf(s.event)?.startsWith('q')).map((s) => [callOf(s.event), s.dismissed ?? false, s.answeredBy !== undefined])).toEqual([['q1', true, false], ['q2', false, false], ['q3', false, true]])
  })
})
