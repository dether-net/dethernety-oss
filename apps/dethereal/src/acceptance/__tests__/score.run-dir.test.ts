/**
 * The run-directory contract: a complete run directory is valid, and each part
 * that is missing or malformed makes it invalid with its own named reason.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { bundleJson } from '../../generator/bundle-json.js'
import { parseClaude } from '../transcripts/claude.js'
import { AUTOPILOT_RULES, replyModeOf, settlementModeOf, TAIL_IDS, validateRunDir, type RunDirCheck } from '../score/run-dir.js'
import { offExport } from './fixtures/clean-run.js'

let dir: string
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const put = (rel: string, content: string) => {
  const p = path.join(dir, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
}
const reply = (prompt: string, text: string, extra: Record<string, unknown> = {}) => JSON.stringify({ ts: '2026-01-01T00:00:00Z', prompt, text, sha256: sha(text), ...extra })
const record = (extra: Record<string, unknown> = {}) => JSON.stringify({
  schemaVersion: 1, runId: 'r1', harness: 'opencode', fixture: 'synthetic', projectPath: '/work/project', model: 'model-a',
  startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T01:00:00Z', ...extra,
})
const codes = (c: RunDirCheck) => (c.valid ? [] : c.problems.map((p) => p.code))

const STATE = { state: 'REVIEWED', claimed_state: 'REVIEWED', baseline: 'verified', unregistered_changes: { rows: [], rows_total: 0 }, content_hash: 'a'.repeat(64) }

/** An installed bundle as the generator writes it, version 1.2.3. */
const BUNDLE_FILES = new Map([
  ['bundles/opencode/agents/dethereal-scout.md', 'scout, version 1.2.3\n'],
  ['bundles/opencode/skills/dethereal-threat-model/SKILL.md', 'the skill\n'],
])
const putBundle = (files: Map<string, string>) => {
  put('installed/bundle.json', JSON.stringify(bundleJson('opencode', '1.2.3', 'w'.repeat(64), files)))
  for (const [rel, text] of files) put(`installed/bundle/${rel}`, text)
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-rundir-'))
  put('run.json', record())
  put('start/README.md', 'x')
  put('project/README.md', 'x')
  put('project/.git/HEAD', 'ref: refs/heads/main\n')
  for (const f of ['opencode-sessions.json', 'opencode-messages.json', 'opencode-parts.json']) put(`transcripts/${f}`, '[]')
  put('replies.jsonl', [reply('invocation', 'Use the skill.'), reply('scope', 'Scope reply.'), reply('fixed:after-compact', 'Continue.')].join('\n') + '\n')
  put('approvals.jsonl', JSON.stringify({ ts: '2026-01-01T00:10:00Z', tool: 'dethereal_import_model', decision: 'approve' }) + '\n')
  put('export/run-model.json', '{"model":{}}')
  put('export/key-model.json', '{"model":{}}')
  put('export/model-state.json', JSON.stringify(STATE))
  putBundle(BUNDLE_FILES)
  put('installed/dist/index.js', '')
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('validateRunDir', () => {
  it('accepts a complete run directory and returns its parts', () => {
    const c = validateRunDir(dir)
    expect(codes(c)).toEqual([])
    if (!c.valid) return
    expect(c.run.record).toMatchObject({ runId: 'r1', harness: 'opencode' })
    expect(c.run.replies.map((r) => r.prompt)).toEqual(['invocation', 'scope', 'fixed:after-compact'])
    expect(c.run.approvals).toHaveLength(1)
    expect(c.run.adjudications).toEqual([])
  })

  it.each([
    ['run.json', 'missing_run_json'],
    ['start', 'missing_start'],
    ['project', 'missing_project'],
    ['project/.git', 'project_not_git'],
    ['transcripts/opencode-parts.json', 'missing_transcripts'],
    ['replies.jsonl', 'missing_replies'],
    ['approvals.jsonl', 'missing_approvals'],
    ['export/run-model.json', 'missing_run_export'],
    ['export/key-model.json', 'missing_key_export'],
    ['installed/bundle.json', 'missing_bundle_json'],
    ['installed/dist/index.js', 'missing_dist'],
  ])('is invalid without %s', (rel, code) => {
    fs.rmSync(path.join(dir, rel), { recursive: true, force: true })
    expect(codes(validateRunDir(dir))).toContain(code)
  })

  it.each([
    [{ schemaVersion: 2 }],
    [{ harness: 'cursor' }],
    [{ projectPath: 'relative/path' }],
    [{ startedAt: 'yesterday' }],
    [{ runId: '' }],
    [{ resumed_from: { snapshot: 's' } }],
    [{ sheet_mode: 'Bar' }],
    [{ sheet_mode: 'quick' }],
    [{ run_mode: 'fast' }],
    [{ run_mode: 'quick', sheet_mode: 'bar' }],
    [{ run_mode: 'baseline', sheet_mode: 'loopback', baseline_version: '0.4.11' }],
    [{ run_mode: 'baseline' }],
    [{ run_mode: 'baseline', baseline_version: 'latest' }],
    [{ baseline_version: '0.4.11' }],
    [{ run_mode: 'full', baseline_version: '0.4.11' }],
    [{ run_mode: 'quick', tail_start: { transcript: 't.jsonl' }, walk_snapshot: 'walk/project' }],
  ])('is invalid with a malformed run record %j', (extra) => {
    put('run.json', record(extra))
    expect(codes(validateRunDir(dir))).toEqual(['bad_run_json'])
  })

  it('reads the operator waits when the file is there, and checks every line', () => {
    const wait = (extra: Record<string, unknown> = {}) => JSON.stringify({ start: '2026-01-01T00:10:00Z', end: '2026-01-01T00:12:00Z', kind: 'hand-step', what: 'an autopilot stop the operator resolved', ...extra })
    const c = validateRunDir(dir)
    expect(c.valid && c.run.operatorWaits).toEqual([])
    put('operator-waits.jsonl', `${wait()}\n${wait({ start: '2026-01-01T00:20:00Z', end: '2026-01-01T00:21:00Z', kind: 'dialog' })}\n`)
    const ok = validateRunDir(dir)
    expect(ok.valid && ok.run.operatorWaits.map((w) => w.kind)).toEqual(['hand-step', 'dialog'])
    for (const bad of [wait({ end: '2026-01-01T00:09:00Z' }), wait({ kind: 'coffee' }), wait({ what: 'two\nlines' }), wait({ what: '' }), wait({ end: '2026-01-01T02:00:00Z' })]) {
      put('operator-waits.jsonl', `${bad}\n`)
      expect(codes(validateRunDir(dir)), bad).toEqual(['bad_operator_waits'])
    }
    put('operator-waits.jsonl', `${wait({ start: '2026-01-01T00:20:00Z', end: '2026-01-01T00:21:00Z' })}\n${wait()}\n`)
    expect(codes(validateRunDir(dir))).toEqual(['bad_operator_waits'])
  })

  it('takes the run mode and the sheet mode, and reads the reply mode from them', () => {
    for (const extra of [{ sheet_mode: 'bar' }, { sheet_mode: 'loopback' }, { run_mode: 'full', sheet_mode: 'bar' }, { run_mode: 'quick' }, { run_mode: 'baseline', baseline_version: '0.4.11' }]) {
      put('run.json', record(extra))
      expect(codes(validateRunDir(dir)), JSON.stringify(extra)).toEqual([])
    }
    expect(replyModeOf({ sheet_mode: 'bar' })).toBe('bar')
    expect(replyModeOf({ run_mode: 'full', sheet_mode: 'bar' })).toBe('bar')
    // A run from before the sheet modes gave its facts at the loop-back.
    expect(replyModeOf({})).toBe('loopback')
    expect(replyModeOf({ run_mode: 'quick' })).toBe('quick')
    // A baseline's questions are matched to the sheet's by trigger, and given the facts as an acceptance run is.
    expect(replyModeOf({ run_mode: 'baseline' })).toBe('bar')
  })

  it('checks every reply line: JSON, fields, and the text hash; and needs the invocation', () => {
    put('replies.jsonl', `${reply('invocation', 'go')}\n{nope\n`)
    expect(codes(validateRunDir(dir))).toEqual(['bad_replies'])
    put('replies.jsonl', `${reply('invocation', 'go')}\n${JSON.stringify({ ts: '2026-01-01T00:00:00Z', prompt: 'scope', text: 'x', sha256: 'f'.repeat(64) })}\n`)
    expect(validateRunDir(dir).valid).toBe(false)
    put('replies.jsonl', `${reply('Scope!', 'x')}\n`)
    expect(codes(validateRunDir(dir))).toContain('bad_replies')
    put('replies.jsonl', `${reply('scope', 'x')}\n`)
    expect(codes(validateRunDir(dir))).toEqual(['bad_replies'])
  })

  it('accepts an absent run export only with a reason, and checks the bundle hash field', () => {
    put('export/run-model.json', '{"absent":"the run ended before its push"}')
    expect(validateRunDir(dir).valid).toBe(true)
    put('export/run-model.json', '{"absent":""}')
    expect(codes(validateRunDir(dir))).toEqual(['bad_run_export'])
    put('export/run-model.json', '{"model":{}}')
    put('installed/bundle.json', '{"files":[]}')
    expect(codes(validateRunDir(dir))).toEqual(['bad_bundle_json'])
  })

  it('checks the installed bundle against bundle.json, file by file and by its content hash', () => {
    expect(validateRunDir(dir).valid).toBe(true)
    put('installed/bundle/bundles/opencode/skills/dethereal-threat-model/SKILL.md', 'the skill, edited\n')
    expect(codes(validateRunDir(dir))).toEqual(['bundle_file_changed'])
    putBundle(BUNDLE_FILES)
    put('installed/bundle/bundles/opencode/agents/extra.md', 'x')
    expect(codes(validateRunDir(dir))).toEqual(['bundle_file_extra'])
    fs.rmSync(path.join(dir, 'installed/bundle'), { recursive: true })
    expect(codes(validateRunDir(dir))).toEqual(['bundle_file_missing', 'bundle_file_missing'])
    putBundle(BUNDLE_FILES)
    const b = JSON.parse(fs.readFileSync(path.join(dir, 'installed/bundle.json'), 'utf8'))
    put('installed/bundle.json', JSON.stringify({ ...b, contentHash: '0'.repeat(64) }))
    expect(codes(validateRunDir(dir))).toEqual(['bundle_hash_mismatch'])
    put('installed/bundle.json', JSON.stringify({ ...b, files: [{ path: '../escape.md', sha256: '0'.repeat(64) }] }))
    expect(codes(validateRunDir(dir))).toEqual(['bad_bundle_json'])
  })

  it('requires the run\'s own model_state export, in its shape', () => {
    expect(validateRunDir(dir).valid).toBe(true)
    for (const bad of [{ ...STATE, content_hash: 'x' }, { ...STATE, baseline: 'trusted' }, { ...STATE, unregistered_changes: { rows_total: -1 } }, { ...STATE, pending_enrichment: { blocks: 'no' } }, []]) {
      put('export/model-state.json', JSON.stringify(bad))
      expect(codes(validateRunDir(dir)), JSON.stringify(bad)).toEqual(['bad_state_export'])
    }
    // A null content hash is the server saying why it had none: valid with the reason, not without.
    put('export/model-state.json', JSON.stringify({ ...STATE, content_hash: null, content_hash_unavailable: { code: 'state_files_refused', files: ['.dethereal/scope.json'], files_total: 1 } }))
    expect(validateRunDir(dir).valid).toBe(true)
    for (const bad of [{ ...STATE, content_hash: null }, { ...STATE, content_hash: null, content_hash_unavailable: { code: 7 } }]) {
      put('export/model-state.json', JSON.stringify(bad))
      expect(codes(validateRunDir(dir)), JSON.stringify(bad)).toEqual(['bad_state_export'])
    }
    fs.rmSync(path.join(dir, 'export/model-state.json'))
    expect(codes(validateRunDir(dir))).toEqual(['missing_state_export'])
  })

  it('takes a model_state export from a server with settlement off: the mark, and no settlement or pending field', () => {
    const { baseline: _b, unregistered_changes: _u, ...rest } = STATE
    put('export/model-state.json', JSON.stringify(offExport(STATE)))
    expect(validateRunDir(dir).valid).toBe(true)
    for (const bad of [
      { ...STATE, settlement: 'off' },
      { ...rest, settlement: 'off', baseline: 'verified' },
      { ...rest, settlement: 'off', unregistered_changes: { rows_total: 0 } },
      { ...rest, settlement: 'off', pending_enrichment: { blocks: false } },
      { ...rest, settlement: 'on' },
      { ...STATE, settlement: 'on' },
      rest,
    ]) {
      put('export/model-state.json', JSON.stringify(bad))
      expect(codes(validateRunDir(dir)), JSON.stringify(bad)).toEqual(['bad_state_export'])
    }
  })

  it('reads the settlement mode a run record states: on or off, on when absent', () => {
    for (const settlement of ['on', 'off']) {
      put('run.json', record({ settlement }))
      expect(codes(validateRunDir(dir)), settlement).not.toContain('bad_run_json')
    }
    for (const settlement of ['On', 'yes', true, null, '']) {
      put('run.json', record({ settlement }))
      expect(codes(validateRunDir(dir)), JSON.stringify(settlement)).toEqual(['bad_run_json'])
    }
    put('run.json', record({ run_mode: 'baseline', baseline_version: '0.4.11', settlement: 'off' }))
    expect(codes(validateRunDir(dir))).toContain('bad_run_json')
    expect(settlementModeOf({})).toBe('on')
    expect(settlementModeOf({ settlement: 'off' })).toBe('off')
  })

  it('takes the environment the kit records, and refuses each field malformed or on the wrong harness', () => {
    const env = (e: Record<string, unknown>, harness = 'opencode') => { put('run.json', record({ harness, environment: e })); return codes(validateRunDir(dir)) }
    const base = { platformRelease: '0.11.0', effort: 'high', autocompact: true, allowlistSha256: 'a'.repeat(64), nodeVersion: 'v22.14.0' }
    expect(env({ ...base, launcher: { kind: 'node' } })).toEqual([])
    expect(env({ ...base, launcher: { kind: 'node-locked', lockfileSha256: 'b'.repeat(64) } })).toEqual([])
    // autocompact off is an answer; a pre-release Node reports its suffix.
    expect(env({ ...base, autocompact: false, nodeVersion: 'v23.0.0-pre', launcher: { kind: 'node' } })).toEqual([])
    for (const bad of [
      { ...base, claudeBinarySha256: 'c'.repeat(64) },
      { ...base, nodeVersion: '22.14.0' },
      { ...base, nodeVersion: 'v22' },
      { ...base, launcher: 'node' },
      { ...base, launcher: { kind: 'npx' } },
      { ...base, launcher: { kind: 'node-locked' } },
      { ...base, launcher: { kind: 'node-locked', lockfileSha256: 'short' } },
      { ...base, launcher: { kind: 'node', lockfileSha256: 'b'.repeat(64) } },
      { ...base, launcher: { kind: 'node', path: '/usr/bin/node' } },
      { ...base, models: ['claude-sonnet-5'] },
    ]) expect(env(bad), JSON.stringify(bad)).toEqual(['bad_run_json'])

    // A Claude run records the binary that ran.
    put('transcripts/project-dir/s.jsonl', '{}\n')
    expect(env({ ...base, claudeBinarySha256: 'c'.repeat(64), launcher: { kind: 'node' } }, 'claude')).toEqual([])
    expect(env({ ...base, claudeBinarySha256: 'C'.repeat(64) }, 'claude')).toEqual(['bad_run_json'])
  })

  it('knows each harness\'s transcript layout', () => {
    put('run.json', record({ harness: 'codex' }))
    expect(codes(validateRunDir(dir))).toEqual(['missing_transcripts'])
    put('transcripts/codex-threads.json', '[]')
    put('transcripts/codex-thread-items.json', '[]')
    expect(validateRunDir(dir).valid).toBe(true)
    put('run.json', record({ harness: 'claude' }))
    expect(codes(validateRunDir(dir))).toEqual(['missing_transcripts'])
    // A subagent's session alone is not the run's session.
    put('transcripts/project-dir/s/subagents/agent-a1.jsonl', '{}\n')
    expect(codes(validateRunDir(dir))).toEqual(['missing_transcripts'])
    put('transcripts/project-dir/s.jsonl', '{}\n')
    expect(validateRunDir(dir).valid).toBe(true)
  })

  it('tells the main session from a subagent\'s by the path inside transcripts/, wherever the run directory lies', () => {
    const nested = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-rundir-parent-')), 'subagents', 'run')
    fs.mkdirSync(path.dirname(nested), { recursive: true })
    fs.renameSync(dir, nested)
    dir = nested
    put('run.json', record({ harness: 'claude' }))
    const line = JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z', uuid: 'u1', message: { role: 'user', content: [{ type: 'text', text: 'Use the skill.' }] } })
    put('transcripts/project-dir/s.jsonl', `${line}\n`)
    try {
      expect(validateRunDir(dir).valid).toBe(true)
      expect(parseClaude(path.join(dir, 'transcripts')).events.map((e) => e.actor)).toEqual(['main'])
    } finally {
      fs.rmSync(path.dirname(path.dirname(nested)), { recursive: true, force: true })
    }
  })

  it('checks adjudications when present', () => {
    put('adjudications.json', JSON.stringify([{ item: 'H4 b-data zone', adjudicator: 'operator', verdict: 'pass', reason: 'ratified in the reply' }]))
    const c = validateRunDir(dir)
    expect(c.valid && c.run.adjudications).toHaveLength(1)
    put('adjudications.json', JSON.stringify([{ item: 'H4', verdict: 'maybe' }]))
    expect(codes(validateRunDir(dir))).toEqual(['bad_adjudications'])
  })

  it('takes a skills tail only whole: run.json fields, the walk snapshot, and every tail command in order', () => {
    const tailLines = TAIL_IDS.map((id) => reply(`tail:${id}`, `/dethereal:${id}`))
    const withTail = (lines: string[], fields: Record<string, unknown> | null = { tail_start: { transcript: 'opencode-messages.json' }, walk_snapshot: 'walk/project' }) => {
      put('run.json', record(fields ?? {}))
      put('replies.jsonl', [reply('invocation', 'Use the skill.'), reply('scope', 'Scope reply.'), ...lines].join('\n') + '\n')
    }
    put('walk/project/.git/HEAD', 'ref: refs/heads/main\n')
    withTail(tailLines)
    expect(codes(validateRunDir(dir))).toEqual([])
    // A reply to a question the tail raised sits among the tail's lines.
    withTail([...tailLines.slice(0, 5), reply('pull-overwrite', 'backup'), ...tailLines.slice(5)])
    expect(codes(validateRunDir(dir))).toEqual([])
    // The walk's opening never comes after the tail starts.
    withTail([...tailLines.slice(0, 3), reply('invocation', 'Use the skill.'), ...tailLines.slice(3)])
    expect(codes(validateRunDir(dir))).toEqual(['bad_tail'])
    withTail([...tailLines].reverse())
    expect(codes(validateRunDir(dir))).toEqual(['bad_tail'])
    withTail(tailLines.slice(1))
    expect(codes(validateRunDir(dir))).toEqual(['bad_tail'])
    withTail(tailLines, null)
    expect(codes(validateRunDir(dir))).toEqual(['bad_tail'])
    withTail([])
    expect(codes(validateRunDir(dir))).toEqual(['bad_tail'])
    withTail(tailLines, { tail_start: { transcript: 'opencode-messages.json' } })
    expect(codes(validateRunDir(dir))).toEqual(['bad_run_json'])
    withTail([], { walk_snapshot: 'walk/project' })
    expect(codes(validateRunDir(dir))).toEqual(['bad_run_json'])
    withTail(tailLines, { tail_start: { transcript: '../x.jsonl' }, walk_snapshot: 'walk/project' })
    expect(codes(validateRunDir(dir))).toEqual(['bad_run_json'])
    withTail(tailLines, { tail_start: { transcript: 'missing.json' }, walk_snapshot: 'walk/project' })
    expect(codes(validateRunDir(dir))).toEqual(['bad_tail'])
    fs.rmSync(path.join(dir, 'walk'), { recursive: true })
    withTail(tailLines)
    expect(codes(validateRunDir(dir))).toEqual(['missing_walk_snapshot'])
  })

  it('takes the rule an autopilot answered an approval under, from the closed list, and the decision it goes with', () => {
    const approval = (extra: Record<string, unknown>) => put('approvals.jsonl', JSON.stringify({ ts: '2026-01-01T00:10:00Z', tool: 'Read', decision: 'approve', ...extra }) + '\n')
    for (const rule of AUTOPILOT_RULES.filter((r) => r !== 'waiver-decline')) {
      approval({ autopilotRule: rule })
      expect(codes(validateRunDir(dir)), rule).toEqual([])
    }
    approval({ autopilotRule: 'waiver-decline', decision: 'decline' })
    expect(codes(validateRunDir(dir))).toEqual([])
    approval({ autopilotRule: 'waiver-decline' })
    expect(codes(validateRunDir(dir))).toEqual(['bad_approvals'])
    approval({ autopilotRule: 'read-in-project', decision: 'decline' })
    expect(codes(validateRunDir(dir))).toEqual(['bad_approvals'])
    approval({ autopilotRule: 'anything-goes' })
    expect(codes(validateRunDir(dir))).toEqual(['bad_approvals'])
  })

  it('takes the time the operator decided a hand approval, never before it was asked, and never on the autopilot\'s', () => {
    const approval = (extra: Record<string, unknown>) => put('approvals.jsonl', JSON.stringify({ ts: '2026-01-01T00:10:00Z', tool: 'mcp__plugin_dethereal_dethereal__login', decision: 'approve', ...extra }) + '\n')
    approval({ decidedAt: '2026-01-01T01:08:00Z' })
    expect(codes(validateRunDir(dir))).toEqual([])
    // Approved by hand after the autopilot stopped: a hand decision too.
    approval({ autopilotRule: 'operator-after-stop', decidedAt: '2026-01-01T00:10:00Z' })
    expect(codes(validateRunDir(dir))).toEqual([])
    for (const bad of [{ decidedAt: '2026-01-01T00:09:59Z' }, { decidedAt: 'soon' }, { autopilotRule: 'mcp-plugin-prompt-tier', decidedAt: '2026-01-01T00:11:00Z' }]) {
      approval(bad)
      expect(codes(validateRunDir(dir)), JSON.stringify(bad)).toEqual(['bad_approvals'])
    }
  })

  it('names every problem at once', () => {
    fs.rmSync(path.join(dir, 'replies.jsonl'))
    fs.rmSync(path.join(dir, 'installed'), { recursive: true })
    expect(codes(validateRunDir(dir)).sort()).toEqual(['missing_bundle_json', 'missing_dist', 'missing_replies'])
  })
})
