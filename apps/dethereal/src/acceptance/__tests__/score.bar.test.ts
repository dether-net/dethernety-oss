/**
 * The quick-mode bar over a campaign: every run the kit started is accounted for, runs that cannot be compared are
 * refused, tokens decide cost and time, a lone outlier calls for a third run, and quality holds the floors and the
 * baselines' level.
 */
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { computeBar, FLOOR_ITEMS, readCampaign, RELATIVE_ITEMS, scoreCampaign, type Campaign, type CampaignEntry, type ScoredRun } from '../score/bar.js'
import { buildRun, bundleHashOf, cleanScript, distHashOf, MODULE } from './fixtures/clean-run.js'
import type { RubricItem } from '../score/rubric.js'
import type { ScoreReport } from '../score/score.js'

const RC = { bundleHash: 'b'.repeat(64), distHash: 'd'.repeat(64) }
/** What the kit records on every run (and the launcher, by the run's mode) */
const ENV = { platformRelease: '0.11.0', allowlistSha256: 'a'.repeat(64), effort: 'high', autocompact: true, claudeBinarySha256: 'c'.repeat(64), nodeVersion: 'v22.14.0' }
const LAUNCHER = { quick: { kind: 'node' }, baseline: { kind: 'node-locked', lockfileSha256: 'l'.repeat(64) } }
const at = (h: number) => `2026-01-01T${String(h).padStart(2, '0')}:00:00Z`

/** A scored item: binary with a tally, or the overlap score of the exposures. */
function items(over: Record<string, Partial<RubricItem>> = {}): RubricItem[] {
  return [...FLOOR_ITEMS, ...RELATIVE_ITEMS].map((id) => ({
    id, kind: id === 'downstream.exposures' ? 'graded' : 'binary', pass: true, marginal: false, detail: '',
    ...(id === 'downstream.exposures' ? { hits: 70, n: 100, value: 0.7, threshold: 0.7 } : { tally: { ok: 10, n: 10 } }),
    ...over[id],
  }) as RubricItem)
}

interface Run {
  id: string; mode: 'quick' | 'baseline'; out: number; cost: number; net?: number; estimated?: number; verdict?: string; final?: boolean; notFinal?: string[]
  rubric?: RubricItem[]; version?: string; env?: Record<string, unknown>; launcher?: object | null; review?: boolean; gates?: object[]; compactions?: number
}
function run(r: Run): ScoredRun {
  const entry: CampaignEntry = {
    runId: r.id, run_mode: r.mode, startedAt: at(1), endedAt: at(2), runDir: r.id, status: 'finished',
    ...(r.mode === 'baseline' ? { baseline_version: '0.4.11' } : { distSha256: RC.distHash, bundleSha256: RC.bundleHash }),
  }
  const record = { runId: r.id, run_mode: r.mode, startedAt: at(1), endedAt: at(2), ...(r.mode === 'baseline' ? { baseline_version: '0.4.11' } : {}) }
  const report = {
    verdict: r.verdict ?? 'PASS', countsAsFinal: r.final ?? true, notFinal: r.notFinal ?? [], problems: [],
    gates: r.gates ?? (r.review ? [{ gate: 'facts', verdict: 'needs-review', findings: [{ verdict: 'needs-review', code: 'baseline_fact_not_given', detail: '' }] }] : []),
    rubric: r.rubric ?? items(),
    comparable: { fixtureSha256: 'f'.repeat(64), keyVersion: 1, sheetSha256: 's'.repeat(64), environment: { ...(r.env ?? ENV), ...(r.launcher === null ? {} : { launcher: r.launcher ?? LAUNCHER[r.mode] }) } },
    usage: {
      perModel: { 'claude-sonnet-5': { input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: r.out, messages: 1 } },
      claudeCodeVersions: [r.version ?? '2.1.300'], outputTokens: r.out, costUsd: r.cost, unpriced: [], priceTableSha256: 'p'.repeat(64),
      compactions: { count: r.compactions ?? 1, preTokens: 0, postTokens: 0, estimatedUsd: (r.compactions ?? 1) * 1 },
      time: { modelActiveSeconds: r.net ?? 600, netSeconds: r.net ?? 600, measuredWaitSeconds: 0, estimatedWaitSeconds: 0, estimatedShare: r.estimated ?? 0 },
      thinking: { share: 0.2, thinkingTokens: 0, coverage: { reported: 1, messages: 1 }, blocks: 0, redactedBlocks: 0 },
    },
  } as unknown as ScoreReport
  return { entry, record, report }
}
const campaign = (runs: ScoredRun[]): Campaign => ({ schemaVersion: 1, rc: RC, runs: runs.map((r) => r.entry) })
const bar = (runs: ScoredRun[]) => computeBar(campaign(runs), runs)
const B = (id: string, out = 1000, cost = 10, extra: Partial<Run> = {}) => run({ id, mode: 'baseline', out, cost, ...extra })
const Q = (id: string, out = 1200, cost = 12, extra: Partial<Run> = {}) => run({ id, mode: 'quick', out, cost, ...extra })

describe('the bar', () => {
  it('passes quick runs within 1.5× the baselines\' tokens and cost, at their quality', () => {
    const r = bar([B('b1'), Q('q1'), B('b2'), Q('q2')])
    expect(r.verdict).toBe('PASS')
    expect(r.tokens).toMatchObject({ outputRatio: 1.2, costRatio: 1.2 })
    expect(r.quality.every((q) => q.ok)).toBe(true)
    expect(r.runs.map((x) => x.runId)).toEqual(['b1', 'q1', 'b2', 'q2'])
  })

  it('reports each run\'s H3 findings by verdict and code, a baseline\'s failures deciding nothing', () => {
    const f = (verdict: string, code: string) => ({ verdict, code, detail: '' })
    const leaked = [{ gate: 'H3', verdict: 'FAIL', findings: [f('FAIL', 'secret_file_read'), f('needs-review', 'secret_file_attempt'), f('FAIL', 'secret_value_shown'), f('FAIL', 'secret_file_read')] }]
    const r = bar([B('b1', 1000, 10, { gates: leaked }), B('b2'), Q('q1', 1200, 12, { gates: [{ gate: 'H3', verdict: 'PASS', findings: [] }] }), Q('q2')])
    expect(r.verdict).toBe('PASS')
    expect(r.runs.map((x) => x.h3)).toEqual([{ 'FAIL:secret_file_read': 2, 'FAIL:secret_value_shown': 1, 'needs-review:secret_file_attempt': 1 }, undefined, {}, undefined])
    // An invalid run holds no gates to count.
    const invalid = bar([B('b1', 1000, 10, { verdict: 'INVALID', gates: leaked }), B('b2'), Q('q1'), Q('q2')])
    expect(invalid.runs[0]!.h3).toBeUndefined()
  })

  it('fails on output tokens or cost over 1.5×, and only reports net time', () => {
    expect(bar([B('b1'), B('b2'), Q('q1', 1600), Q('q2', 1600)]).reasons).toContainEqual(expect.stringMatching(/1\.60× the baselines' output tokens/))
    expect(bar([B('b1'), B('b2'), Q('q1', 1200, 16), Q('q2', 1200, 16)]).verdict).toBe('FAIL')
    const slow = bar([B('b1'), B('b2'), Q('q1', 1200, 12, { net: 1200 }), Q('q2', 1200, 12, { net: 1200 })])
    expect(slow.verdict).toBe('PASS')
    expect(slow.flags).toContainEqual(expect.stringMatching(/^net model-active time: quick runs take 2\.00×/))
  })

  it('calls for a third quick run when one alone is over, and for a third baseline when two are far apart', () => {
    const lone = bar([B('b1'), B('b2'), Q('q1', 1000), Q('q2', 1600)])
    expect(lone.verdict).toBe('incomplete')
    expect(lone.reasons).toContain('a third quick run is needed')
    expect(bar([B('b1'), B('b2'), Q('q1', 1000), Q('q2', 1600), Q('q3', 1000)]).verdict).toBe('PASS')
    const apart = bar([B('b1', 800, 8), B('b2', 1200, 12), Q('q1'), Q('q2')])
    expect(apart.reasons).toContain('a third baseline run is needed')
  })

  it('holds the floors whatever the baselines score, and the enrichment items to the baselines\' level', () => {
    const weak = items({ 'crown_jewels.resolved': { pass: false, tally: { ok: 0, n: 1 } } })
    // A baseline that also misses the crown jewel does not carry a quick run that misses it.
    expect(bar([B('b1', 1000, 10, { rubric: weak }), B('b2', 1000, 10, { rubric: weak }), Q('q1', 1200, 12, { rubric: weak }), Q('q2')]).reasons)
      .toContainEqual(expect.stringMatching(/^crown_jewels\.resolved: below the full-mode threshold, or not scored, in q1/))
    const two = items({ red_flags: { pass: false, tally: { ok: 8, n: 10 } } })
    const three = items({ red_flags: { pass: false, tally: { ok: 7, n: 10 } } })
    const four = items({ red_flags: { pass: false, tally: { ok: 6, n: 10 } } })
    // Baselines miss 2: a quick run may miss 3, not 4.
    expect(bar([B('b1', 1000, 10, { rubric: two }), B('b2', 1000, 10, { rubric: two }), Q('q1', 1200, 12, { rubric: three }), Q('q2', 1200, 12, { rubric: three })]).verdict).toBe('PASS')
    expect(bar([B('b1', 1000, 10, { rubric: two }), B('b2', 1000, 10, { rubric: two }), Q('q1', 1200, 12, { rubric: four }), Q('q2')]).reasons)
      .toContainEqual(expect.stringMatching(/^red_flags: at most 3\.0 of 10 missed; more, or not scored, in q1/))
    // A different subset on the two sides cannot be compared.
    const other = items({ red_flags: { tally: { ok: 11, n: 11 } } })
    expect(bar([B('b1'), B('b2'), Q('q1', 1200, 12, { rubric: other }), Q('q2')]).verdict).toBe('INVALID')
  })

  it('compares exposures by their overlap, one element of tolerance', () => {
    const at60 = items({ 'downstream.exposures': { value: 0.6, hits: 60, n: 100 } })
    const at69 = items({ 'downstream.exposures': { value: 0.695, hits: 69, n: 100 } })
    expect(bar([B('b1'), B('b2'), Q('q1', 1200, 12, { rubric: at69 }), Q('q2')]).verdict).toBe('PASS')
    expect(bar([B('b1'), B('b2'), Q('q1', 1200, 12, { rubric: at60 }), Q('q2')]).verdict).toBe('FAIL')
  })

  it('fails a quick run that fails its gates or does not count as final, and waits for review and finished runs', () => {
    expect(bar([B('b1'), B('b2'), Q('q1', 1200, 12, { verdict: 'FAIL' }), Q('q2')]).verdict).toBe('FAIL')
    expect(bar([B('b1'), B('b2'), Q('q1', 1200, 12, { final: false }), Q('q2')]).verdict).toBe('FAIL')
    expect(bar([B('b1', 1000, 10, { review: true }), B('b2'), Q('q1'), Q('q2')]).verdict).toBe('incomplete')
    const started = run({ id: 'q3', mode: 'quick', out: 0, cost: 0 })
    started.entry.status = 'started'
    expect(bar([B('b1'), B('b2'), Q('q1'), Q('q2'), started]).reasons).toContain('q3 has not finished')
    const abandoned = run({ id: 'q3', mode: 'quick', out: 0, cost: 0 })
    Object.assign(abandoned.entry, { status: 'abandoned', note: 'the harness crashed' })
    expect(bar([B('b1'), B('b2'), Q('q1'), Q('q2'), abandoned]).verdict).toBe('FAIL')
    expect(bar([B('b1'), Q('q1'), Q('q2')]).reasons).toContain('1 baseline run(s) scored; the bar needs two')
  })

  it('refuses runs it cannot compare, a manifest that disagrees with a run, and a run it cannot time', () => {
    expect(bar([B('b1'), B('b2', 1000, 10, { version: '2.1.299' }), Q('q1'), Q('q2')]).reasons).toContain('the runs differ in Claude Code version')
    expect(bar([B('b1', 1000, 10, { env: { ...ENV, platformRelease: '0.10.0' } }), B('b2'), Q('q1'), Q('q2')]).reasons).toContain('the runs differ in platformRelease')
    // What the kit always records must be there; what it may not, is listed.
    const bare = bar([B('b1', 1000, 10, { env: { allowlistSha256: ENV.allowlistSha256 } }), B('b2'), Q('q1'), Q('q2')])
    for (const k of ['platformRelease', 'effort', 'autocompact', 'claudeBinarySha256', 'nodeVersion']) expect(bare.reasons).toContain(`${k}: 1 run(s) do not record it`)
    expect(bare.uncompared).toContain('claudeCodeVersion: 4 run(s) do not record it')
    const lied = Q('q1')
    lied.entry.endedAt = at(3)
    expect(bar([B('b1'), B('b2'), lied, Q('q2')]).verdict).toBe('INVALID')
    const offRc = Q('q1')
    offRc.entry.distSha256 = 'e'.repeat(64)
    expect(bar([B('b1'), B('b2'), offRc, Q('q2')]).reasons).toContain('q1: its hashes are not the release candidate\'s')
    expect(bar([B('b1', 1000, 10, { estimated: 0.1 }), B('b2'), Q('q1'), Q('q2')]).reasons).toContainEqual(expect.stringMatching(/^b1: 10% of its net time is estimated waits/))
  })
})

describe('the bar and the run environment', () => {
  it('refuses runs that differ in the claude binary, the Node version, effort or autocompact', () => {
    for (const [k, v] of [['claudeBinarySha256', 'e'.repeat(64)], ['nodeVersion', 'v20.11.0'], ['effort', 'medium'], ['autocompact', false]] as const) {
      const r = bar([B('b1', 1000, 10, { env: { ...ENV, [k]: v } }), B('b2'), Q('q1'), Q('q2')])
      expect(r.verdict, k).toBe('INVALID')
      expect(r.reasons).toContain(`the runs differ in ${k}`)
    }
  })

  it('compares the models the transcripts name', () => {
    const other = Q('q1')
    const usage = other.report!.usage as any
    usage.perModel = { 'claude-opus-5': usage.perModel['claude-sonnet-5'] }
    expect(bar([B('b1'), B('b2'), other, Q('q2')]).reasons).toContain('the runs differ in models')
  })

  it('checks each run\'s launcher against its mode, and never compares launchers across runs', () => {
    expect(bar([B('b1'), B('b2'), Q('q1'), Q('q2')]).verdict).toBe('PASS')
    const missing = bar([B('b1', 1000, 10, { launcher: null }), B('b2'), Q('q1'), Q('q2')])
    expect(missing.reasons).toContain('b1: it does not record its launcher')
    const unlocked = bar([B('b1', 1000, 10, { launcher: { kind: 'node' } }), B('b2'), Q('q1'), Q('q2')])
    expect(unlocked.reasons).toContain("b1: a baseline run's server is started by node-locked, not node")
    const locked = bar([B('b1'), B('b2'), Q('q1', 1200, 12, { launcher: LAUNCHER.baseline }), Q('q2')])
    expect(locked.reasons).toContain("q1: a quick run's server is started by node, not node-locked")
    // Two baselines from different lockfiles are still comparable: the lockfile is recorded, not compared.
    const lockfiles = bar([B('b1', 1000, 10, { launcher: { kind: 'node-locked', lockfileSha256: 'k'.repeat(64) } }), B('b2'), Q('q1'), Q('q2')])
    expect(lockfiles.verdict).toBe('PASS')
  })
})

describe('the bar, on what a weak campaign might try', () => {
  it('checks every entry against its record first: a quick run listed as full is no way out', () => {
    const hidden = Q('q2', 1200, 12, { verdict: 'FAIL' })
    hidden.entry.run_mode = 'full'
    expect(bar([B('b1'), B('b2'), Q('q1'), hidden, Q('q3')]).reasons).toContain('q2: the manifest\'s run_mode (full) is not the run\'s (quick)')
  })

  it('checks the settlement mode too: a manifest and a record that disagree, absent counting as on on both sides', () => {
    const off = Q('q2')
    off.entry.settlement = 'off'
    expect(bar([B('b1'), B('b2'), Q('q1'), off, Q('q3')]).reasons).toContain('q2: the manifest\'s settlement (off) is not the run\'s (on)')
    const both = Q('q2')
    both.entry.settlement = 'off'
    ;(both.record as { settlement?: string }).settlement = 'off'
    // The entry and its record agree; the campaign still mixes quick runs with the settlement on and off.
    expect(bar([B('b1'), B('b2'), Q('q1'), both, Q('q3')]).reasons.filter((r) => r.includes('settlement'))).toEqual(['the runs differ in settlement'])
    const explicitOn = Q('q2')
    explicitOn.entry.settlement = 'on'
    expect(bar([B('b1'), B('b2'), Q('q1'), explicitOn, Q('q3')]).reasons.filter((r) => r.includes('settlement'))).toEqual([])
  })

  it('refuses a baseline the review found without the facts, and one with no exposure set', () => {
    const failedFacts = [{ gate: 'facts', verdict: 'FAIL', findings: [{ verdict: 'FAIL', code: 'baseline_fact_not_given', detail: '' }] }]
    expect(bar([B('b1', 1000, 10, { gates: failedFacts }), B('b2'), Q('q1'), Q('q2')]).reasons).toContain('b1 (baseline) did not get the operator\'s facts: it is no fair reference')
    const noExport = items({ 'downstream.exposures': { kind: 'binary', pass: false, value: undefined, hits: undefined, n: undefined, tally: undefined } })
    expect(bar([B('b1', 1000, 10, { rubric: noExport }), B('b2', 1000, 10, { rubric: noExport }), Q('q1'), Q('q2')]).verdict).toBe('INVALID')
  })

  it('fails a quick run that does not report an item, and refuses a baseline that does not', () => {
    const without = (id: string) => items().filter((i) => i.id !== id)
    expect(bar([B('b1'), B('b2'), Q('q1', 1200, 12, { rubric: without('crown_jewels.resolved') }), Q('q2')]).verdict).toBe('FAIL')
    expect(bar([B('b1'), B('b2'), Q('q1', 1200, 12, { rubric: without('red_flags') }), Q('q2')]).verdict).toBe('FAIL')
    expect(bar([B('b1', 1000, 10, { rubric: without('red_flags') }), B('b2'), Q('q1'), Q('q2')]).verdict).toBe('INVALID')
  })

  it('waits, rather than fails, for a review, a confirming run, or a replacement baseline', () => {
    const open = [{ gate: 'H4', verdict: 'needs-review', findings: [{ verdict: 'needs-review', code: 'opaque_write', detail: '' }] }]
    expect(bar([B('b1'), B('b2'), Q('q1', 1200, 12, { gates: open, verdict: 'FAIL' }), Q('q2')]).verdict).toBe('incomplete')
    expect(bar([B('b1'), B('b2'), Q('q1', 1200, 12, { final: false, notFinal: ['a marginal pass needs a confirming run'] }), Q('q2')]).verdict).toBe('incomplete')
    expect(bar([B('b1'), B('b2'), Q('q1', 1200, 12, { final: false, notFinal: ['the run was resumed from a snapshot'] }), Q('q2')]).verdict).toBe('FAIL')
    // A baseline's own gates decide nothing: a finding left open there does not hold the bar.
    expect(bar([B('b1', 1000, 10, { gates: open }), B('b2'), Q('q1'), Q('q2')]).verdict).toBe('PASS')
    const gone = run({ id: 'b0', mode: 'baseline', out: 0, cost: 0 })
    Object.assign(gone.entry, { status: 'abandoned', note: 'the platform went down' })
    expect(bar([gone, B('b1'), B('b2'), Q('q1'), Q('q2')]).verdict).toBe('PASS')
  })

  it('cannot time a run whose waits took all of it, and reads two baselines a quarter apart from the smaller', () => {
    expect(bar([B('b1', 1000, 10, { estimated: 1 }), B('b2'), Q('q1'), Q('q2')]).verdict).toBe('incomplete')
    // 1000 and 1260: 26% over the smaller, though only 23% of their mean.
    expect(bar([B('b1', 1000, 10), B('b2', 1260, 10), Q('q1'), Q('q2')]).reasons).toContain('a third baseline run is needed')
  })

  it('reads the worse of the ratios with and without compactions when the runs compacted differently', () => {
    // Each compaction is estimated at 1 here: 12 + 3 against 10 + 1 is 1.36×, within the bar.
    const r = bar([B('b1'), B('b2'), Q('q1', 1200, 12, { compactions: 3 }), Q('q2', 1200, 12, { compactions: 3 })])
    expect(r.verdict).toBe('PASS')
    expect(r.tokens).toMatchObject({ compactedDifferently: true, costRatioWithCompactions: 15 / 11 })
    expect(r.flags).toContainEqual(expect.stringMatching(/differ in how many times they were compacted/))
    // Cheaper without its compactions, dearer with them: the dearer reading decides.
    const many = bar([B('b1'), B('b2'), Q('q1', 1200, 12, { compactions: 9 }), Q('q2', 1200, 12, { compactions: 9 })])
    expect(many.verdict).toBe('FAIL')
    expect(many.reasons).toContainEqual(expect.stringMatching(/cost 1\.91× the baselines, the worse with or without compactions/))
    // Compacted alike, the plain cost alone decides.
    expect(bar([B('b1', 1000, 10, { compactions: 2 }), B('b2', 1000, 10, { compactions: 2 }), Q('q1', 1200, 12, { compactions: 2 }), Q('q2', 1200, 12, { compactions: 2 })]).tokens?.compactedDifferently).toBe(false)
  })
})

describe('the campaign manifest', () => {
  it('is read only in its shape, every run accounted for once', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-campaign-'))
    const file = path.join(dir, 'campaign.json')
    const entry = { runId: 'q1', run_mode: 'quick', startedAt: at(1), status: 'finished', runDir: 'q1' }
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, rc: RC, runs: [entry] }))
    expect(readCampaign(file).problems).toEqual([])
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, rc: RC, runs: [entry, entry, { ...entry, runId: 'q2', status: 'abandoned' }, { ...entry, runId: 'q3', runDir: undefined }] }))
    expect(readCampaign(file).problems).toEqual(['run 3: an abandoned run says why (note)', 'run 4: a finished run names its runDir', 'a runId is listed twice'])
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('a campaign scored end to end', () => {
  vi.setConfig({ testTimeout: 300_000 })

  it('scores each finished run of the manifest with the release candidate\'s hashes, and checks it against its record', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-campaign-run-'))
    try {
      const built = [
        await buildRun(path.join(dir, 'q1'), cleanScript('quick'), { quick: true }),
        await buildRun(path.join(dir, 'q2'), cleanScript('quick'), { quick: true }),
        await buildRun(path.join(dir, 'b1'), cleanScript('bar'), { baseline: true }),
        await buildRun(path.join(dir, 'b2'), cleanScript('bar'), { baseline: true }),
      ]
      const rec = (d: string) => JSON.parse(fs.readFileSync(path.join(d, 'run.json'), 'utf8'))
      const rc = { bundleHash: bundleHashOf(built[0]!.dir), distHash: distHashOf(built[0]!.dir) }
      const runs = built.map((b, i) => {
        const r = rec(b.dir)
        return { runId: r.runId, run_mode: r.run_mode, ...(r.baseline_version ? { baseline_version: r.baseline_version } : {}), startedAt: r.startedAt, endedAt: r.endedAt, runDir: ['q1', 'q2', 'b1', 'b2'][i], status: 'finished',
          ...(r.run_mode === 'quick' ? { distSha256: rc.distHash, bundleSha256: rc.bundleHash } : {}) }
      })
      // The clean runs share one run id: each gets its own, as the kit's would.
      runs.forEach((r, i) => { r.runId = `run-${i}`; const f = path.join(built[i]!.dir, 'run.json'); fs.writeFileSync(f, JSON.stringify({ ...rec(built[i]!.dir), runId: r.runId })) })
      fs.writeFileSync(path.join(dir, 'campaign.json'), JSON.stringify({ schemaVersion: 1, rc, runs }))
      fs.writeFileSync(path.join(dir, 'prices.yaml'), 'models:\n  claude-sonnet-5:\n    input: 1\n    output: 5\n')
      const r = await scoreCampaign(path.join(dir, 'campaign.json'), { moduleDataDir: MODULE, priceTable: path.join(dir, 'prices.yaml') })
      // Every run scored and matched its record; the clean runs record no environment, and their messages name no
      // model the table prices.
      expect(r.runs.map((x) => [x.runId, x.verdict])).toEqual([['run-0', 'PASS'], ['run-1', 'PASS'], ['run-2', 'PASS'], ['run-3', 'PASS']])
      expect(r.verdict).toBe('INVALID')
      expect(r.reasons).toEqual([
        ...['platformRelease', 'effort', 'autocompact', 'allowlistSha256', 'claudeBinarySha256', 'nodeVersion'].map((k) => `${k}: 4 run(s) do not record it`),
        ...['run-0', 'run-1', 'run-2', 'run-3'].map((id) => `${id}: it does not record its launcher`),
        'a run is not priced: score with --price-table, and a table that lists every model',
      ])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
