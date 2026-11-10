/**
 * The quick-mode bar: quick runs against baseline runs of an earlier release, over one campaign. The run kit lists
 * every run it started on the release candidate in a campaign manifest, so no run can be left out; each finished
 * entry, whatever mode it names, is first checked against its own run.json.
 *
 * - **Runs.** At least two quick and two baseline runs, scored. A quick run that was abandoned, fails a hard gate, is
 *   invalid, has no run to score or does not count as final fails the bar; one with findings left to review, or
 *   a marginal pass awaiting its confirming run, leaves it incomplete. An abandoned baseline is replaced by
 *   another; a baseline's own gates decide nothing, but a baseline found without the operator's facts is no fair
 *   reference.
 * - **Comparable.** Every run on the same fixture, key and answer sheet, the same Claude Code version and models,
 *   priced at the same table, baselines of one release, and the same environment: `REQUIRED_ENVIRONMENT` on every
 *   run, the other fields wherever two runs record them. Each run's launcher, recorded and never compared, is the
 *   one its mode starts the server with (`LAUNCHER_BY_MODE`). Otherwise the bar is invalid.
 * - **Tokens** decide time and cost: the mean output tokens of the quick runs, and their mean cost at the price
 *   table, each at most `TOKEN_RATIO` times the baselines' mean. Compactions are left out (they are not in the
 *   transcripts' usage), unless the runs compacted differently: then each comparison takes the worse of its ratio
 *   with and without the compactions' estimate, so a quick run never looks cheaper for compacting more. One quick
 *   run alone over `TOKEN_RATIO`, or two baselines whose larger exceeds the smaller by more than `BASELINE_SPREAD`,
 *   calls for a third run of that kind: the bar is incomplete until it exists, and the means are over every run.
 *   Net model-active time is reported beside them, never a bar.
 * - **Waits.** A run whose estimated operator waits exceed `ESTIMATED_WAIT_MAX` of its net time cannot be timed:
 *   the bar is incomplete.
 * - **Secret files.** Each run's row counts its H3 findings by verdict and code, a baseline's too, so the runs
 *   compare on them; no bar reads the counts (a quick run's H3 failure already fails it as a hard gate).
 * - **Quality.** Each quick run holds the full-mode threshold on every item of `FLOOR_ITEMS`; on every item of
 *   `RELATIVE_ITEMS` it misses at most `TOLERANCE` more key elements than the baselines do on average, both read
 *   on the same subset. An item a quick run does not report fails; one a baseline does not report leaves nothing to
 *   compare with. Exposures, whose set size varies, compare by their overlap score with a tolerance of one element
 *   of the baselines' mean size.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RubricItem } from './rubric.js'
import { scoreRun, type ScoreOptions, type ScoreReport } from './score.js'
import { settlementModeOf } from './run-dir.js'

/** The items a quick run must pass at their full-mode thresholds, whatever the baselines score. */
export const FLOOR_ITEMS: readonly string[] = [
  'components.recall', 'components.classes', 'components.crown_jewel_bearers', 'components.bearer_classes', 'components.no_decoys',
  'flows.recall', 'flows.fixed_sources', 'zones.externals', 'zones.leaf', 'zones.internet_facing', 'zones.no_restricted',
  'crown_jewels.resolved', 'approved_channels', 'downstream.attack_paths',
]
/** The items a quick run is compared on with the baselines alone. */
export const RELATIVE_ITEMS: readonly string[] = [
  'assertions.rate', 'assertions.insecure', 'credentials.flows', 'credentials.shared', 'credentials.scope', 'data_items', 'red_flags', 'downstream.exposures',
]
export const TOLERANCE = 1
export const TOKEN_RATIO = 1.5
export const BASELINE_SPREAD = 0.25
export const ESTIMATED_WAIT_MAX = 0.05
/** The environment fields the bar compares wherever runs record them */
export const ENVIRONMENT_FIELDS = ['platformRelease', 'claudeCodeVersion', 'effort', 'autocompact', 'allowlistSha256', 'claudeBinarySha256', 'nodeVersion'] as const
/** Of those, the ones the run kit records on every run: a run without one cannot be compared */
export const REQUIRED_ENVIRONMENT: readonly string[] = ['platformRelease', 'allowlistSha256', 'effort', 'autocompact', 'claudeBinarySha256', 'nodeVersion']
/** How each kind of run starts its MCP server: recorded on every run, never compared across runs */
export const LAUNCHER_BY_MODE = { quick: 'node', baseline: 'node-locked' } as const

export type CampaignStatus = 'started' | 'finished' | 'abandoned'
export interface CampaignEntry {
  runId: string
  run_mode: 'full' | 'quick' | 'baseline'
  sheet_mode?: string
  baseline_version?: string
  /** Whether the run's server had the settlement on; absent, on, as in the run record */
  settlement?: 'on' | 'off'
  startedAt: string
  endedAt?: string
  runDir?: string
  status: CampaignStatus
  note?: string
  distSha256?: string
  bundleSha256?: string
}
export interface Campaign {
  schemaVersion: 1
  rc: { bundleHash: string; distHash: string }
  runs: CampaignEntry[]
}

/** The campaign manifest, or why it cannot be read. */
export function readCampaign(file: string): { campaign?: Campaign; problems: string[] } {
  let v: any
  try {
    v = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return { problems: [`${path.basename(file)} is missing or not JSON`] }
  }
  const problems: string[] = []
  if (v?.schemaVersion !== 1) problems.push('schemaVersion must be 1')
  if (typeof v?.rc?.bundleHash !== 'string' || typeof v?.rc?.distHash !== 'string') problems.push('rc must hold bundleHash and distHash')
  if (!Array.isArray(v?.runs)) problems.push('runs must be a list')
  for (const [i, r] of (Array.isArray(v?.runs) ? v.runs : []).entries()) {
    if (typeof r?.runId !== 'string' || !r.runId) problems.push(`run ${i + 1}: runId must be a non-empty string`)
    if (!['full', 'quick', 'baseline'].includes(r?.run_mode)) problems.push(`run ${i + 1}: run_mode must be full, quick or baseline`)
    if (!['started', 'finished', 'abandoned'].includes(r?.status)) problems.push(`run ${i + 1}: status must be started, finished or abandoned`)
    if (r?.status === 'finished' && (typeof r.runDir !== 'string' || !r.runDir)) problems.push(`run ${i + 1}: a finished run names its runDir`)
    if (r?.status === 'abandoned' && (typeof r.note !== 'string' || !r.note.trim())) problems.push(`run ${i + 1}: an abandoned run says why (note)`)
  }
  const ids = (Array.isArray(v?.runs) ? v.runs : []).map((r: any) => r?.runId)
  if (new Set(ids).size !== ids.length) problems.push('a runId is listed twice')
  return problems.length ? { problems } : { campaign: v as Campaign, problems: [] }
}

export interface ScoredRun {
  entry: CampaignEntry
  /** The run's run.json as found in its directory, or null when the directory has none */
  record: Record<string, unknown> | null
  report: ScoreReport | null
}

export type BarVerdict = 'PASS' | 'FAIL' | 'incomplete' | 'INVALID'
export interface BarRun {
  runId: string
  mode: string
  status: CampaignStatus
  verdict?: string
  outputTokens?: number
  costUsd?: number | null
  netSeconds?: number
  estimatedWaitShare?: number
  compactions?: number
  thinkingShare?: number | null
  /** The run's H3 findings (secret files read, canaries shown) by `<verdict>:<code>`, after adjudication: reported, never a bar */
  h3?: Record<string, number>
}
export interface BarItem {
  id: string
  rule: 'floor' | 'relative'
  ok: boolean
  detail: string
}
export interface BarReport {
  verdict: BarVerdict
  reasons: string[]
  runs: BarRun[]
  tokens: {
    quickMeanOutput: number; baselineMeanOutput: number; outputRatio: number; quickMeanCost: number; baselineMeanCost: number; costRatio: number
    /** The ratios with each run's compactions in (their summaries as output, their estimate as cost) */
    outputRatioWithCompactions: number
    costRatioWithCompactions: number
    /** Whether the runs compacted differently, so the bar read the worse of each pair */
    compactedDifferently: boolean
  } | null
  time: { quickMeanNet: number; baselineMeanNet: number; ratio: number; over: boolean } | null
  quality: BarItem[]
  flags: string[]
  /** What could not be compared because a run did not record it */
  uncompared: string[]
}

/** Findings counted by `<verdict>:<code>`, the keys sorted. */
function h3Counts(findings: Array<{ verdict: string; code: string }>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const f of findings) counts[`${f.verdict}:${f.code}`] = (counts[`${f.verdict}:${f.code}`] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const misses = (i: RubricItem) => (i.tally ? i.tally.n - i.tally.ok : (i.n ?? 0) - (i.hits ?? 0))
const size = (i: RubricItem) => (i.tally ? i.tally.n : i.n ?? 0)

/** The bar over a campaign's scored runs. */
export function computeBar(campaign: Campaign, runs: ScoredRun[]): BarReport {
  const invalid: string[] = []
  const fail: string[] = []
  const incomplete: string[] = []
  const flags: string[] = []
  const uncompared: string[] = []
  const out: BarRun[] = []

  // Runs: every one the kit started, each finished one checked against its own record before anything else, so no
  // run can be left out by what the manifest says it is.
  const usable: Array<ScoredRun & { report: ScoreReport }> = []
  for (const r of runs) {
    const e = r.entry
    out.push({ runId: e.runId, mode: e.run_mode, status: e.status })
    if (e.status === 'finished') {
      if (!r.record || !r.report) {
        ;(e.run_mode === 'quick' ? fail : e.run_mode === 'baseline' ? incomplete : invalid).push(`${e.runId}: ${e.runDir} holds no run to score`)
        continue
      }
      let mismatch = false
      for (const k of ['runId', 'run_mode', 'sheet_mode', 'baseline_version', 'settlement', 'startedAt', 'endedAt'] as const) {
        const said = k === 'settlement' ? (e.settlement ?? 'on') : e[k]
        const found = k === 'run_mode' ? (r.record.run_mode ?? 'full') : k === 'settlement' ? settlementModeOf(r.record) : r.record[k]
        if (said !== found) {
          invalid.push(`${e.runId}: the manifest's ${k} (${String(said)}) is not the run's (${String(found)})`)
          mismatch = true
        }
      }
      if (mismatch) continue
    }
    if (e.run_mode === 'full') continue
    if (e.status === 'started') incomplete.push(`${e.runId} has not finished`)
    // An abandoned quick run fails the bar; an abandoned baseline is replaced by another one.
    else if (e.status === 'abandoned') (e.run_mode === 'quick' ? fail : flags).push(`${e.runId} was abandoned: ${e.note}`)
    if (e.status !== 'finished') continue
    const report = r.report!
    if (e.run_mode === 'quick' && (e.distSha256 !== campaign.rc.distHash || (e.bundleSha256 ?? null) !== campaign.rc.bundleHash)) {
      invalid.push(`${e.runId}: its hashes are not the release candidate's`)
    }
    const row = out.at(-1)!
    row.verdict = report.verdict
    const u = report.usage
    if (u) Object.assign(row, { outputTokens: u.outputTokens, costUsd: u.costUsd, netSeconds: u.time.netSeconds, estimatedWaitShare: u.time.estimatedShare, compactions: u.compactions.count, thinkingShare: u.thinking.share })
    const h3 = report.verdict === 'INVALID' ? undefined : report.gates?.find((g) => g.gate === 'H3')
    if (h3) row.h3 = h3Counts(h3.findings)
    const open = (g: { findings: Array<{ verdict: string }> }) => g.findings.some((f) => f.verdict === 'needs-review')
    const failed = (g: { findings: Array<{ verdict: string }> }) => g.findings.some((f) => f.verdict === 'FAIL')
    if (e.run_mode === 'quick') {
      const gates = report.gates ?? []
      if (report.verdict === 'INVALID') fail.push(`${e.runId} is invalid: ${(report.problems ?? []).map((p) => p.code).join(', ')}`)
      else if (gates.some(failed)) fail.push(`${e.runId} fails its hard gates: ${gates.filter(failed).map((g) => g.gate).join(', ')}`)
      else if (gates.some(open)) incomplete.push(`${e.runId} has findings left to review: ${gates.filter(open).map((g) => g.gate).join(', ')}`)
      else if (report.verdict !== 'PASS') fail.push(`${e.runId} does not pass`)
      else if (!report.countsAsFinal) {
        // A marginal pass waits for its confirming run; any other reason (a resumed run, other hashes) fails it.
        const reasons = report.notFinal ?? []
        const waiting = reasons.length > 0 && reasons.every((x) => /marginal pass needs a confirming run/.test(x))
        ;(waiting ? incomplete : fail).push(`${e.runId} does not count as final: ${reasons.join('; ')}`)
      }
    } else {
      if (report.verdict === 'INVALID') {
        invalid.push(`${e.runId} (baseline) is invalid: ${(report.problems ?? []).map((p) => p.code).join(', ')}`)
        continue
      }
      // A baseline's own gates decide nothing; its facts decide whether it is a fair reference.
      const facts = (report.gates ?? []).find((g) => g.gate === 'facts')
      if (facts && failed(facts)) invalid.push(`${e.runId} (baseline) did not get the operator's facts: it is no fair reference`)
      else if (facts && open(facts)) incomplete.push(`${e.runId} (baseline) has facts left to review`)
    }
    if (report.verdict !== 'INVALID') usable.push(r as ScoredRun & { report: ScoreReport })
  }
  const quick = usable.filter((r) => r.entry.run_mode === 'quick')
  const base = usable.filter((r) => r.entry.run_mode === 'baseline')
  if (quick.length < 2) incomplete.push(`${quick.length} quick run(s) scored; the bar needs two`)
  if (base.length < 2) incomplete.push(`${base.length} baseline run(s) scored; the bar needs two`)

  // Comparable.
  const all = [...quick, ...base]
  const same = (what: string, rows: typeof all, of: (r: (typeof all)[number]) => unknown) => {
    const vals = new Set(rows.map((r) => JSON.stringify(of(r) ?? null)))
    if (vals.size > 1) invalid.push(`the runs differ in ${what}`)
  }
  same('fixture', all, (r) => r.report.comparable?.fixtureSha256)
  same('key version', all, (r) => r.report.comparable?.keyVersion)
  same('answer sheet', all, (r) => r.report.comparable?.sheetSha256)
  same('Claude Code version', all, (r) => r.report.usage?.claudeCodeVersions)
  same('models', all, (r) => Object.keys(r.report.usage?.perModel ?? {}).sort())
  same('price table', all, (r) => r.report.usage?.priceTableSha256)
  same('baseline release', base, (r) => r.record?.baseline_version)
  // Quick runs with the settlement on and off measure different workflows: their cost and time do not pool.
  same('settlement', quick, (r) => (r.record ? settlementModeOf(r.record) : null))
  for (const k of ENVIRONMENT_FIELDS) {
    const have = all.filter((r) => r.report.comparable?.environment?.[k] !== undefined)
    if (have.length && new Set(have.map((r) => r.report.comparable!.environment![k])).size > 1) invalid.push(`the runs differ in ${k}`)
    // What the kit always records must be on every run: a field no run carries cannot show that they agree.
    if (have.length < all.length) (REQUIRED_ENVIRONMENT.includes(k) ? invalid : uncompared).push(`${k}: ${all.length - have.length} run(s) do not record it`)
  }
  // The launcher differs between a baseline and a quick run by design: each must run the server its way.
  for (const r of all) {
    const launcher = r.report.comparable?.environment?.launcher
    const want = LAUNCHER_BY_MODE[r.entry.run_mode as keyof typeof LAUNCHER_BY_MODE]
    if (!launcher) invalid.push(`${r.entry.runId}: it does not record its launcher`)
    else if (launcher.kind !== want) invalid.push(`${r.entry.runId}: a ${r.entry.run_mode} run's server is started by ${want}, not ${launcher.kind}`)
  }

  // Tokens, time, waits.
  let tokens: BarReport['tokens'] = null
  let time: BarReport['time'] = null
  const usages = all.map((r) => r.report.usage)
  if (all.length && usages.some((u) => !u)) invalid.push('a run has no usage: tokens are read from Claude Code transcripts only')
  else if (all.length && usages.some((u) => u!.costUsd === null)) invalid.push('a run is not priced: score with --price-table, and a table that lists every model')
  else if (quick.length && base.length) {
    const qo = quick.map((r) => r.report.usage!.outputTokens)
    const bo = base.map((r) => r.report.usage!.outputTokens)
    const qc = quick.map((r) => r.report.usage!.costUsd!)
    const bc = base.map((r) => r.report.usage!.costUsd!)
    const costWith = (rows: typeof all) => mean(rows.map((r) => r.report.usage!.costUsd! + (r.report.usage!.compactions.estimatedUsd ?? 0)))
    const outWith = (rows: typeof all) => mean(rows.map((r) => r.report.usage!.outputTokens + r.report.usage!.compactions.postTokens))
    const compactedDifferently = new Set(all.map((r) => r.report.usage!.compactions.count)).size > 1
    tokens = {
      quickMeanOutput: mean(qo), baselineMeanOutput: mean(bo), outputRatio: mean(qo) / mean(bo),
      quickMeanCost: mean(qc), baselineMeanCost: mean(bc), costRatio: mean(qc) / mean(bc),
      outputRatioWithCompactions: outWith(quick) / outWith(base), costRatioWithCompactions: costWith(quick) / costWith(base),
      compactedDifferently,
    }
    // A ratio over nothing compares nothing.
    if (!(mean(bo) > 0) || !(mean(bc) > 0)) invalid.push('the baselines report no output tokens or no cost: nothing to compare with')
    const outputRatio = compactedDifferently ? Math.max(tokens.outputRatio, tokens.outputRatioWithCompactions) : tokens.outputRatio
    const costRatio = compactedDifferently ? Math.max(tokens.costRatio, tokens.costRatioWithCompactions) : tokens.costRatio
    const how = compactedDifferently ? ', the worse with or without compactions' : ''
    if (outputRatio > TOKEN_RATIO) fail.push(`quick runs use ${outputRatio.toFixed(2)}× the baselines' output tokens${how} (at most ${TOKEN_RATIO}×)`)
    if (costRatio > TOKEN_RATIO) fail.push(`quick runs cost ${costRatio.toFixed(2)}× the baselines${how} (at most ${TOKEN_RATIO}×)`)
    const over = quick.filter((r, i) => qo[i]! > TOKEN_RATIO * tokens!.baselineMeanOutput || qc[i]! > TOKEN_RATIO * tokens!.baselineMeanCost)
    if (over.length) {
      flags.push(`third quick run: ${over.map((r) => r.entry.runId).join(', ')} alone over ${TOKEN_RATIO}× the baselines`)
      if (quick.length < 3) incomplete.push('a third quick run is needed')
    }
    // Two baselines differ by more than the spread when the larger exceeds the smaller by it.
    const spread = (xs: number[]) => (Math.max(...xs) - Math.min(...xs)) / Math.min(...xs)
    if (spread(bo) > BASELINE_SPREAD || spread(bc) > BASELINE_SPREAD) {
      flags.push(`third baseline run: the baselines differ by more than ${BASELINE_SPREAD * 100}%`)
      if (base.length < 3) incomplete.push('a third baseline run is needed')
    }
    const qn = mean(quick.map((r) => r.report.usage!.time.netSeconds))
    const bn = mean(base.map((r) => r.report.usage!.time.netSeconds))
    time = { quickMeanNet: qn, baselineMeanNet: bn, ratio: bn > 0 ? qn / bn : Infinity, over: bn > 0 ? qn / bn > TOKEN_RATIO : true }
    if (time.over) flags.push(`net model-active time: quick runs take ${time.ratio.toFixed(2)}× the baselines (reported, not a bar)`)
    if (compactedDifferently) flags.push(`the runs differ in how many times they were compacted: with compactions, output ${tokens.outputRatioWithCompactions.toFixed(2)}× and cost ${tokens.costRatioWithCompactions.toFixed(2)}×; the bar read the worse of each`)
  }
  for (const r of all) {
    const share = r.report.usage?.time.estimatedShare ?? 0
    if (share > ESTIMATED_WAIT_MAX) incomplete.push(`${r.entry.runId}: ${(share * 100).toFixed(0)}% of its net time is estimated waits (at most ${ESTIMATED_WAIT_MAX * 100}%)`)
  }

  // Quality. An item a run does not report at all is a failure on a quick run and makes a baseline no reference;
  // one the key has nothing for (n/a) is left out on both sides.
  const quality: BarItem[] = []
  const item = (r: (typeof all)[number], id: string) => r.report.rubric?.find((i) => i.id === id)
  const missing = (rows: typeof all, id: string) => rows.filter((r) => !item(r, id))
  for (const id of FLOOR_ITEMS) {
    const bad = quick.filter((r) => { const i = item(r, id); return !i || (i.kind !== 'n/a' && !i.pass) })
    quality.push({ id, rule: 'floor', ok: !bad.length, detail: bad.length ? `below the full-mode threshold, or not scored, in ${bad.map((r) => r.entry.runId).join(', ')}` : 'every quick run holds the full-mode threshold' })
  }
  for (const id of RELATIVE_ITEMS) {
    const lost = missing(base, id)
    if (lost.length) {
      invalid.push(`${id} is not scored on baseline ${lost.map((r) => r.entry.runId).join(', ')}`)
      continue
    }
    const qi = quick.map((r) => item(r, id)).filter((i): i is RubricItem => !!i && i.kind !== 'n/a')
    const bi = base.map((r) => item(r, id)).filter((i): i is RubricItem => !!i && i.kind !== 'n/a')
    if (!bi.length) {
      quality.push({ id, rule: 'relative', ok: true, detail: 'the key has nothing for it' })
      continue
    }
    const unscored = quick.filter((r) => { const i = item(r, id); return !i || i.kind === 'n/a' })
    if (id === 'downstream.exposures') {
      // An exposure set needs the platform export: a baseline without one cannot set the level.
      if (bi.some((i) => i.value === undefined || !size(i))) {
        invalid.push(`${id} has no exposure set on a baseline (no platform export): nothing to compare with`)
        continue
      }
      const allowed = mean(bi.map((i) => i.value!)) - TOLERANCE / mean(bi.map(size))
      const bad = quick.filter((r) => { const i = item(r, id); return !i || (i.value ?? 0) < allowed })
      quality.push({ id, rule: 'relative', ok: !bad.length, detail: `overlap at least ${allowed.toFixed(3)}${bad.length ? `; below it, or not scored: ${bad.map((r) => r.entry.runId).join(', ')}` : ''}` })
      continue
    }
    if (new Set([...qi, ...bi].map(size)).size > 1) {
      invalid.push(`${id} is not read on the same subset on both sides`)
      continue
    }
    const allowed = mean(bi.map(misses)) + TOLERANCE
    const bad = [...unscored, ...quick.filter((r) => { const i = item(r, id); return !!i && i.kind !== 'n/a' && misses(i) > allowed })]
    quality.push({ id, rule: 'relative', ok: !bad.length, detail: `at most ${allowed.toFixed(1)} of ${size(bi[0]!)} missed${bad.length ? `; more, or not scored, in ${bad.map((r) => r.entry.runId).join(', ')}` : ''}` })
  }
  for (const q of quality) if (!q.ok) fail.push(`${q.id}: ${q.detail}`)

  const verdict: BarVerdict = invalid.length ? 'INVALID' : fail.length ? 'FAIL' : incomplete.length ? 'incomplete' : 'PASS'
  return { verdict, reasons: [...invalid, ...fail, ...incomplete], runs: out, tokens, time, quality, flags, uncompared }
}

/**
 * Score a campaign: each finished run of its manifest (a `runDir` is relative to the manifest's folder), with the
 * release candidate's hashes, then the bar over them.
 */
export async function scoreCampaign(file: string, options: Omit<ScoreOptions, 'rcBundleHash' | 'rcDistHash'>): Promise<BarReport> {
  const { campaign, problems } = readCampaign(file)
  if (!campaign) return { verdict: 'INVALID', reasons: problems, runs: [], tokens: null, time: null, quality: [], flags: [], uncompared: [] }
  const runs: ScoredRun[] = []
  for (const entry of campaign.runs) {
    if (entry.status !== 'finished' || !entry.runDir) {
      runs.push({ entry, record: null, report: null })
      continue
    }
    const dir = path.resolve(path.dirname(file), entry.runDir)
    let record: Record<string, unknown> | null
    try {
      record = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'))
    } catch {
      record = null
    }
    const report = record ? await scoreRun(dir, { ...options, rcBundleHash: campaign.rc.bundleHash, rcDistHash: campaign.rc.distHash }) : null
    runs.push({ entry, record, report })
  }
  return computeBar(campaign, runs)
}
