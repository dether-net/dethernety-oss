/**
 * The scorer end to end, on a synthetic run that follows every rule: the key
 * model written through a clean guided walk. It passes every hard gate and
 * every scored item, and counts as final only with the release candidate's
 * hashes and a clean record.
 */
import { describe, it, expect, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scoreRun } from '../score/score.js'
import { withFacts } from '../answer-sheet.js'
import { buildRun, bundleHashOf, cleanScript, distHashOf, FIXTURE, MODEL, MODULE, PROJECT_PATH, sheet, VERIFIED_STATE, withoutCompaction, type Step } from './fixtures/clean-run.js'

// Every test here scores one whole run: slow under a full-suite load.
// The cleanup hook removes every run's directory: as slow as a test on a busy host.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

// Every run gets its own directory, removed at the end: a test that timed out and runs on cannot touch another's.
const dirs: string[] = []
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }) })
const newTmp = (): string => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-score-run-')))
  dirs.push(d)
  return d
}

describe('scoreRun on a clean run', () => {
  it('passes every hard gate and scored item, and counts as final', async () => {
    const { dir } = await buildRun(path.join(newTmp(), 'run'))
    const r = await scoreRun(dir, { moduleDataDir: MODULE, rcBundleHash: bundleHashOf(dir), rcDistHash: distHashOf(dir) })
    expect(r.problems).toEqual([])
    expect(r.gates?.filter((g) => g.verdict !== 'PASS')).toEqual([])
    expect(r.rubric?.filter((i) => !i.pass || i.marginal)).toEqual([])
    expect(r.verdict).toBe('PASS')
    expect(r.marginalReasons).toEqual([])
    expect(r.notFinal).toEqual([])
    expect(r.countsAsFinal).toBe(true)
    expect(r.disclosures).toEqual(['attack paths: structural fallback (no analysis results in the export)'])
    expect(r.rubric?.find((i) => i.id === 'data_items')?.tally).toEqual({ ok: 9, n: 9 })
    // What it used, read from its transcripts: the forced compaction is counted apart; no table, no price.
    expect(r.usage).toMatchObject({ compactions: { count: 1 }, costUsd: null, priceTableSha256: null })
    expect(r.usage?.time.modelActiveSeconds).toBeGreaterThan(0)
    for (const i of r.rubric!.filter((x) => x.kind === 'binary')) expect(i.tally && i.tally.n > 0 && i.tally.ok === i.tally.n, i.id).toBe(true)
  })

  it("fails H2, never INVALID, when the run's server had no review hash to export", async () => {
    const { dir } = await buildRun(path.join(newTmp(), 'run'), cleanScript(), {
      stateExport: { ...VERIFIED_STATE, content_hash: null, content_hash_unavailable: { code: 'state_files_refused', files: ['.dethereal/scope.json'], files_total: 1 } },
    })
    const r = await scoreRun(dir, { moduleDataDir: MODULE, rcBundleHash: bundleHashOf(dir), rcDistHash: distHashOf(dir) })
    expect(r.problems).toEqual([])
    expect(r.gates?.find((g) => g.gate === 'H2')?.findings.map((f) => `${f.verdict}:${f.code}`)).toEqual(['FAIL:state_export_hash_unavailable'])
    expect(r.verdict).toBe('FAIL')
  })
})

describe('scoreRun on a clean bar run', () => {
  const relay = sheet.prompts.find((p) => p.id === 'enrichment-relay')!
  const facts = (ids: string[]) => relay.facts.filter((f) => ids.includes(f.id))
  /** A bar run whose relay reply gives the facts named. */
  const bar = async (ids?: string[], extra: Parameters<typeof buildRun>[2] = {}) => {
    const script = cleanScript('bar')
    if (ids) (script.find((x) => x.kind === 'prompt' && x.id === 'enrichment-relay') as Extract<Step, { kind: 'prompt' }>).reply = withFacts(relay.reply, facts(ids))
    const { dir } = await buildRun(path.join(newTmp(), 'bar'), script, { sheetMode: 'bar', ...extra })
    return { dir, r: await scoreRun(dir, { moduleDataDir: MODULE, rcBundleHash: bundleHashOf(dir), rcDistHash: distHashOf(dir) }) }
  }

  it('gives the facts the relay asks for, passes Gate 3 the first time, and counts as final', async () => {
    const { dir, r } = await bar()
    expect(r.problems).toEqual([])
    expect(r.gates?.filter((g) => g.verdict !== 'PASS')).toEqual([])
    expect(r.verdict).toBe('PASS')
    expect(r.marginalReasons).toEqual([])
    expect(r.countsAsFinal).toBe(true)
    const logged = fs.readFileSync(path.join(dir, 'replies.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { prompt: string; text: string })
    expect(logged.some((l) => l.prompt === 'gate3-loopback')).toBe(false)
    // The relay's tables ask for every platform fact but the secret store, which the run never modelled.
    const text = logged.find((l) => l.prompt === 'enrichment-relay')!.text
    expect(relay.facts.filter((f) => text.includes(f.text)).map((f) => f.id)).toEqual(['F1', 'F2', 'F3', 'F4'])
    expect(text).not.toContain('{facts}')
  })

  it('is invalid when the reply gives a fact nothing asked for', async () => {
    const { r } = await bar(['F1', 'F2', 'F3', 'F4', 'F5'])
    expect(r.verdict).toBe('INVALID')
    expect(r.problems?.map((p) => p.code)).toEqual(['fact_unasked'])
  })

  it('stays valid and doubts the pass when the reply withholds a fact it was asked for', async () => {
    const { r } = await bar(['F1', 'F2', 'F4'])
    expect(r.problems).toEqual([])
    expect(r.marginalReasons).toEqual([expect.stringMatching(/^an operator fact was withheld: replies\.jsonl line \d+ \(enrichment-relay\) was asked for fact F3 and did not give it$/)])
    expect(r.countsAsFinal).toBe(false)
  })

  it('is invalid when a loopback run\'s relay gives a platform fact', async () => {
    const script = cleanScript()
    ;(script.find((x) => x.kind === 'prompt' && x.id === 'enrichment-relay') as Extract<Step, { kind: 'prompt' }>).reply = withFacts(relay.reply, facts(['F1']))
    const { dir } = await buildRun(path.join(newTmp(), 'loopback'), script, { sheetMode: 'loopback' })
    const r = await scoreRun(dir, { moduleDataDir: MODULE, rcBundleHash: bundleHashOf(dir), rcDistHash: distHashOf(dir) })
    expect(r.problems?.map((p) => p.detail)).toEqual([expect.stringMatching(/gives fact F1, which a loopback run never gives$/)])
  })
})

describe('scoreRun on a full run without the forced compaction', () => {
  it('is invalid: only a campaign run goes uncompacted', async () => {
    const script = cleanScript()
    withoutCompaction(script)
    const { dir } = await buildRun(path.join(newTmp(), 'uncompacted'), script)
    const r = await scoreRun(dir, { moduleDataDir: MODULE, rcBundleHash: bundleHashOf(dir), rcDistHash: distHashOf(dir) })
    expect(r.verdict).toBe('INVALID')
    expect(r.problems.map((p) => p.code)).toEqual(['no_compaction'])
  })
})

describe('scoreRun on a baseline run', () => {
  const baseline = async (edit: (s: Step[]) => void = () => {}) => {
    const script = cleanScript('bar')
    edit(script)
    const { dir } = await buildRun(path.join(newTmp(), 'baseline'), script, { baseline: true })
    return scoreRun(dir, { moduleDataDir: MODULE })
  }

  it('scores it as a reference: its gates reported and deciding nothing, its items read as a quick run\'s are', async () => {
    const r = await baseline()
    expect(r.problems).toEqual([])
    expect(r.verdict).toBe('PASS')
    expect(r.gates?.map((g) => g.gate)).toEqual(['H1', 'H3', 'H5', 'facts'])
    expect(r.hashes?.bundle).toBeNull()
    expect(r.notFinal).toEqual([])
    expect(r.disclosures).toContainEqual(expect.stringMatching(/^baseline run: a reference/))
    // Read from the operator's log: the Step 9 review and its red flags are found without prompt tags.
    expect(r.rubric?.find((i) => i.id === 'red_flags')).toMatchObject({ pass: true, quick: { role: 'covered', scoped: true } })
    expect(r.rubric?.find((i) => i.id === 'components.recall')?.quick?.role).toBe('covered')
  })

  it('scores one the kit did not compact, the same gates reported', async () => {
    const r = await baseline(withoutCompaction)
    expect(r.problems).toEqual([])
    expect(r.verdict).toBe('PASS')
    expect(r.gates?.map((g) => g.gate)).toEqual(['H1', 'H3', 'H5', 'facts'])
    expect(r.notRun).toBeUndefined()
  })

  it('needs review when an expected fact never reached it, and still scores it', async () => {
    const relay = sheet.prompts.find((p) => p.id === 'enrichment-relay')!
    const r = await baseline((s) => {
      ;(s.find((x) => x.kind === 'prompt' && x.id === 'enrichment-relay') as Extract<Step, { kind: 'prompt' }>).reply = withFacts(relay.reply, relay.facts.filter((f) => ['F1', 'F3', 'F4'].includes(f.id)))
    })
    expect(r.verdict).toBe('PASS')
    expect(r.gates?.find((g) => g.gate === 'facts')?.findings.map((f) => `${f.verdict}:${f.code}:${f.refs?.[0]}`)).toEqual(['needs-review:baseline_fact_not_given:F2'])
  })
})

describe('scoreRun across a push', () => {
  it('follows every element through the platform ids a push writes back, and ignores the push backup', async () => {
    const script = cleanScript()
    script.push({ kind: 'tool', name: 'import_model', input: { directory_path: `${PROJECT_PATH}/${MODEL}` } })
    const { dir } = await buildRun(path.join(newTmp(), 'pushed'), script, { push: true })
    const r = await scoreRun(dir, { moduleDataDir: MODULE, rcBundleHash: bundleHashOf(dir), rcDistHash: distHashOf(dir) })
    expect(r.problems).toEqual([])
    expect(r.gates?.filter((g) => g.verdict !== 'PASS')).toEqual([])
    expect(r.rubric?.filter((i) => !i.pass || i.marginal)).toEqual([])
    expect(r.matching?.components.map(([id]) => id).every((id) => id.startsWith('srv-'))).toBe(true)
  })

  it('keeps the other elements paired when an element appears unseen at the push', async () => {
    const script = cleanScript()
    script.push({ kind: 'tool', name: 'import_model', input: { directory_path: `${PROJECT_PATH}/${MODEL}` } })
    const { dir } = await buildRun(path.join(newTmp(), 'pushed-extra'), script, {
      push: true,
      afterPush: (m) => {
        const file = path.join(m, 'dataflows.json')
        const flows = JSON.parse(fs.readFileSync(file, 'utf8'))
        flows.push({ ...flows[0], id: 'srv-extra', name: 'An extra flow' })
        fs.writeFileSync(file, JSON.stringify(flows, null, 2))
      },
    })
    const r = await scoreRun(dir, { moduleDataDir: MODULE, rcBundleHash: bundleHashOf(dir), rcDistHash: distHashOf(dir) })
    expect(r.rubric?.find((i) => i.id === 'flows.recall')).toMatchObject({ hits: 15, n: 15 })
  })

  it('dates a value in a file the push named no earlier than the push, after an early stub call on the directory', async () => {
    const script = cleanScript()
    // The stubs are written before any attribute value, so the attributes directory is covered from then on.
    script.splice(script.findIndex((x) => x.kind === 'write' && x.files.includes('manifest.json')) + 1, 0,
      { kind: 'tool', name: 'generate_attribute_stubs', input: { directory_path: `${PROJECT_PATH}/${MODEL}` } })
    script.push({ kind: 'tool', name: 'import_model', input: { directory_path: `${PROJECT_PATH}/${MODEL}` } })
    const { dir } = await buildRun(path.join(newTmp(), 'pushed-stubbed'), script, { push: true })
    const r = await scoreRun(dir, { moduleDataDir: MODULE, rcBundleHash: bundleHashOf(dir), rcDistHash: distHashOf(dir) })
    expect(r.gates?.find((g) => g.gate === 'H5')?.findings.map((f) => f.code) ?? []).toEqual([])
  })

  it('passes a sheet value that showed before the push and before the reply, the operator giving it later', async () => {
    // The file shows, already holding the sheet's values, before the reply; the push only renames it later.
    const script = cleanScript()
    const file = 'attributes/components/c-orders-db.json'
    const content = fs.readFileSync(path.join(FIXTURE, 'key', 'model', file), 'utf8')
    script.splice(script.findIndex((x) => x.kind === 'prompt' && (x.id === 'enrich-questions' || x.id === 'enrichment-relay')), 0, { kind: 'write-content', file, content, before: content })
    script.push({ kind: 'tool', name: 'import_model', input: { directory_path: `${PROJECT_PATH}/${MODEL}` } })
    const { dir } = await buildRun(path.join(newTmp(), 'pushed-seen-early'), script, { push: true })
    const r = await scoreRun(dir, { moduleDataDir: MODULE, rcBundleHash: bundleHashOf(dir), rcDistHash: distHashOf(dir) })
    expect(r.gates?.find((g) => g.gate === 'H5')?.findings.map((f) => f.code) ?? []).toEqual([])
  })

  it('passes a value written before the reply and the push, the operator giving it later', async () => {
    const script = cleanScript()
    const w = script.findIndex((x) => x.kind === 'write' && x.files.some((f) => f.startsWith('attributes/')))
    const [step] = script.splice(w, 1)
    script.splice(script.findIndex((x) => x.kind === 'prompt' && (x.id === 'enrich-questions' || x.id === 'enrichment-relay')), 0, step!)
    script.push({ kind: 'tool', name: 'import_model', input: { directory_path: `${PROJECT_PATH}/${MODEL}` } })
    const { dir } = await buildRun(path.join(newTmp(), 'pushed-guess'), script, { push: true })
    const r = await scoreRun(dir, { moduleDataDir: MODULE, rcBundleHash: bundleHashOf(dir), rcDistHash: distHashOf(dir) })
    expect(r.gates?.find((g) => g.gate === 'H5')?.findings.map((f) => f.code) ?? []).toEqual([])
  })
})
