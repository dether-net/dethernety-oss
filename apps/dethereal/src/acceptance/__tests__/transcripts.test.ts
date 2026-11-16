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
import { MENTION, refusalKind } from '../transcripts/opencode.js'

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

  it('is counted by the type a Codex item is filed under, whatever its body says', () => {
    const d = copy('codex')
    const items = JSON.parse(fs.readFileSync(path.join(d, 'codex-thread-items.json'), 'utf8'))
    const last = items.at(-1)
    append(path.join(d, 'codex-thread-items.json'), [{ ...last, item_id: 'u9', rollout_ordinal: last.rollout_ordinal + 9, item_type: 'codeExecution', item_json: JSON.stringify({ type: 'reasoning', id: 'u9' }) }])
    expect(parseRun('codex', d).unknownTypes).toEqual({ codeExecution: 1 })
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

describe('an OpenCode call refused before it ran', () => {
  const tmps: string[] = []
  afterAll(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }) })

  it('is marked as Claude marks one: a rule or hook, or the operator; any other error ran', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-oc-refused-'))
    tmps.push(d)
    fs.cpSync(input('opencode'), d, { recursive: true })
    const file = path.join(d, 'opencode-parts.json')
    const parts = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<Record<string, any>>
    const sessions = JSON.parse(fs.readFileSync(path.join(d, 'opencode-sessions.json'), 'utf8')) as Array<Record<string, any>>
    const main = sessions.find((s) => !s.parent_id)!.id
    const last = parts.filter((p) => p.session_id === main).at(-1)!
    const call = (n: number, tool: string, input: Record<string, unknown>, state: Record<string, unknown>) => ({
      ...last, id: `zz-r${n}`, time_created: last.time_created + n,
      data: JSON.stringify({ type: 'tool', tool, callID: `r${n}`, state: { input, time: { start: last.time_created + n, end: last.time_created + n }, ...state } }),
    })
    const err = (error: string) => ({ status: 'error', error })
    const write = "python3 -c \"import json; json.dump({}, open('threat-models/x/structure.json','w'))\""
    fs.writeFileSync(file, JSON.stringify([...parts,
      call(1, 'bash', { command: write }, err('dethereal-secret-guard: this call is not run: it could not be checked for secret files (why).')),
      call(2, 'read', { filePath: '/p/deploy/secrets.yaml' }, err('dethereal-secret-guard: deploy/secrets.yaml is a secret file (secret-manifest): it is never opened.')),
      call(3, 'glob', { pattern: '**/*' }, err('The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules [...]')),
      call(4, 'write', { filePath: '/p/.codex/config.toml', content: '' }, err('Dethereal: this edit would change a harness setting.')),
      call(5, 'bash', { command: 'ls' }, err('Dethereal: not a refusal on a tool the config guard never checks')),
      call(6, 'bash', { command: write }, err('The user rejected permission to use this specific tool call.')),
      call(7, 'bash', { command: 'ls' }, err('The user rejected permission to use this specific tool call with the following feedback: not now')),
      call(8, 'read', { filePath: '/p/missing.json' }, err('File not found: /p/missing.json')),
      call(9, 'glob', { pattern: '**/*.tf' }, err('ripgrep execution failed')),
      call(10, 'bash', { command: 'ls' }, { status: 'completed', output: 'a\nb' }),
      call(11, 'read', { filePath: '/p/a.txt' }, err('ripgrep: dethereal-secret-guard: not at the start')),
      call(12, 'edit', { filePath: '/p/.codex/config.toml' }, err('Dethereal: this edit would change a harness setting.')),
      call(13, 'apply_patch', { patchText: '' }, err('Dethereal: this patch would change a harness setting.')),
      call(14, 'dethereal_update_model', { directory_path: '/p/tm' }, err('Dethereal: a server error, not a guard')),
    ]))
    const events = parseRun('opencode', d).events.filter((e) => (e.kind === 'shell' || e.kind === 'tool_call') && e.callId?.startsWith('r'))
    expect(events.map((e) => [e.callId, e.kind, e.denied ?? null])).toEqual([
      ['r1', 'shell', 'permission-rule'], ['r2', 'tool_call', 'permission-rule'], ['r3', 'tool_call', 'permission-rule'], ['r4', 'tool_call', 'permission-rule'],
      ['r5', 'shell', null], ['r6', 'shell', 'user-rejected'], ['r7', 'shell', 'user-rejected'], ['r8', 'tool_call', null], ['r9', 'tool_call', null], ['r10', 'shell', null],
      ['r11', 'tool_call', null], ['r12', 'tool_call', 'permission-rule'], ['r13', 'tool_call', 'permission-rule'], ['r14', 'tool_call', null],
    ])
    // The result keeps its error either way.
    const results = parseRun('opencode', d).events.filter((e) => e.kind === 'tool_result' && e.callId?.startsWith('r'))
    expect(results.filter((e) => e.isError).length).toBe(13)
  })

  it('carries a refused server call to its server write', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-oc-refused-server-'))
    tmps.push(d)
    fs.cpSync(input('opencode'), d, { recursive: true })
    const file = path.join(d, 'opencode-parts.json')
    const parts = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<Record<string, any>>
    const sessions = JSON.parse(fs.readFileSync(path.join(d, 'opencode-sessions.json'), 'utf8')) as Array<Record<string, any>>
    const main = sessions.find((s) => !s.parent_id)!
    const last = parts.filter((p) => p.session_id === main.id).at(-1)!
    const dir = `${main.directory}/threat-models/x`
    const call = (n: number, error?: string) => ({
      ...last, id: `zz-s${n}`, time_created: last.time_created + n,
      data: JSON.stringify({ type: 'tool', tool: 'dethereal_update_model', callID: `s${n}`, state: { input: { directory_path: dir }, time: { start: last.time_created + n, end: last.time_created + n }, ...(error ? { status: 'error', error } : { status: 'completed', output: '{}' }) } }),
    })
    fs.writeFileSync(file, JSON.stringify([...parts, call(1, 'The user rejected permission to use this specific tool call.'), call(2)]))
    const writes = parseRun('opencode', d).events.filter((e) => e.kind === 'server_write' && e.callId?.startsWith('s'))
    expect(writes.map((e) => [e.callId, e.denied ?? null])).toEqual([['s1', 'user-rejected'], ['s2', null]])
  })

  it('reads a config-guard refusal on every tool the plugin checks with that guard', () => {
    // The plugin's own list, as its source holds it: a tool added there and not here would go unmarked.
    const plugin = fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', 'generator', 'targets', 'opencode', 'plugin.ts'), 'utf8')
    const writes = JSON.parse(/const WRITES = new Set\((\[[^\]]*\])\)/.exec(plugin)![1]!.replace(/'/g, '"')) as string[]
    expect(writes.length).toBeGreaterThan(0)
    for (const tool of writes) expect(refusalKind(tool, 'Dethereal: refused'), tool).toBe('permission-rule')
    expect(refusalKind('read', 'Dethereal: refused')).toBeUndefined()
  })
})

describe('an OpenCode delegation\'s mentions', () => {
  const tmps: string[] = []
  afterAll(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }) })

  it('are found as OpenCode finds them, the pattern being the one the product\'s plugin judges', () => {
    const plugin = fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', 'generator', 'targets', 'opencode', 'plugin.ts'), 'utf8')
    const m = /const MENTION = (\/.*\/g)\r?\n/.exec(plugin)
    expect(m).not.toBeNull()
    expect(m![1]).toBe(String(MENTION))
  })

  it('are put on the task\'s start, each once, as written', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-oc-mentions-'))
    tmps.push(d)
    fs.cpSync(input('opencode'), d, { recursive: true })
    const file = path.join(d, 'opencode-parts.json')
    const parts = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<Record<string, any>>
    const sessions = JSON.parse(fs.readFileSync(path.join(d, 'opencode-sessions.json'), 'utf8')) as Array<Record<string, any>>
    const main = sessions.find((s) => !s.parent_id)!.id
    const last = parts.filter((p) => p.session_id === main).at(-1)!
    const task = (n: number, prompt: string, error?: string) => ({
      ...last, id: `zz-t${n}`, time_created: last.time_created + n,
      data: JSON.stringify({ type: 'tool', tool: 'task', callID: `t${n}`, state: { input: { subagent_type: 'dethereal-security-enricher', prompt }, time: { start: last.time_created + n, end: last.time_created + n }, ...(error ? { status: 'error', error } : { status: 'completed', output: 'done' }) } }),
    })
    fs.writeFileSync(file, JSON.stringify([...parts,
      task(1, 'Read @deploy/orders/secrets.yaml and @~/.dethernety/tokens.json, then @deploy/orders/secrets.yaml again; mail ops@example.com.'),
      task(2, 'No mention here, only `@code` in backticks.'),
      task(3, 'Read @infra/production.tfvars.', 'The user rejected permission to use this specific tool call.'),
    ]))
    const starts = parseRun('opencode', d).events.filter((e) => e.kind === 'subagent_start' && /^t\d+$/.test(e.callId ?? ''))
    expect(starts.map((e) => [e.callId, e.mentions ?? null, e.denied ?? null])).toEqual([
      ['t1', ['deploy/orders/secrets.yaml', '~/.dethernety/tokens.json'], null], ['t2', null, null], ['t3', ['infra/production.tfvars'], 'user-rejected'],
    ])
  })
})

describe('an OpenCode delegation that failed', () => {
  const tmps: string[] = []
  afterAll(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }) })

  it('is marked started once its subagent\'s session began: named in its result, or holding a part within the call', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-oc-started-'))
    tmps.push(d)
    fs.cpSync(input('opencode'), d, { recursive: true })
    const file = path.join(d, 'opencode-parts.json')
    const sessionsFile = path.join(d, 'opencode-sessions.json')
    const parts = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<Record<string, any>>
    const sessions = JSON.parse(fs.readFileSync(sessionsFile, 'utf8')) as Array<Record<string, any>>
    const main = sessions.find((s) => !s.parent_id)!
    const last = parts.filter((p) => p.session_id === main.id).at(-1)!
    const at = last.time_created + 1000
    const task = (n: number, state: Record<string, unknown>, span = 0) => ({
      ...last, id: `zz-f${n}`, time_created: at + n * 100,
      data: JSON.stringify({ type: 'tool', tool: 'task', callID: `f${n}`, state: { status: 'error', error: 'Tool execution aborted', input: { subagent_type: 'dethereal-security-enricher', prompt: 'go' }, time: { start: at + n * 100, end: at + n * 100 + span }, ...state } }),
    })
    const child = { ...main, id: 'ses_zz_child', parent_id: main.id }
    fs.writeFileSync(sessionsFile, JSON.stringify([...sessions, child]))
    fs.writeFileSync(file, JSON.stringify([...parts,
      task(1, { metadata: { sessionId: 'ses_named' } }),
      task(2, {}, 50),
      { ...last, id: 'zz-c1', session_id: child.id, message_id: 'zz-msg', time_created: at + 220, data: JSON.stringify({ type: 'step-start' }) },
      task(3, {}),
    ]))
    const ends = parseRun('opencode', d).events.filter((e) => e.kind === 'subagent_end' && /^f\d+$/.test(e.callId ?? ''))
    expect(ends.map((e) => [e.callId, e.started ?? false])).toEqual([['f1', true], ['f2', true], ['f3', false]])
  })
})
