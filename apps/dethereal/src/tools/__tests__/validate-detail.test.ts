/**
 * validate_model_json's `detail` for `gates` and `quality`: 'full' (the default) keeps every failing element with its
 * fields, the loop-back worklist and the enrichment worklist; 'summary' keeps verdicts, totals and ids. Either way a
 * passing check keeps only its verdict and value, and a field-gap failure drops the `detail` that restates its fields.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import { validateModelTool, trimGates, summariseGates } from '../validate-model.tool.js'
import { computeGates, loadGateInput } from '../../utils/gates.js'
import { gateModel, writeGateModel } from '../../utils/__tests__/fixtures/gate-model.js'

const context = { debug: false }
let root: string
let seq = 0
beforeAll(async () => { root = await fs.mkdtemp(path.join(process.cwd(), '.test-validate-detail-')) })
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }) })

/** The fixture with flows that leave their transit and failure fields unanswered: Gate 3 fails on field gaps. */
async function failingModel(): Promise<string> {
  const dir = path.join(root, `m${seq++}`)
  const m = gateModel()
  for (const id of ['f-render', 'f-submit']) {
    delete m.attributes.dataFlows[id]!.attributes.auth_failure_mode
    delete m.attributes.dataFlows[id]!.attributes.encryption_in_transit
  }
  await writeGateModel(dir, m)
  return dir
}
const run = async (input: Record<string, unknown>) => {
  const r = await validateModelTool.run(input as never, context)
  expect(r.success, r.error).toBe(true)
  return r.data as any
}

describe('gates', () => {
  it('full by default: every failing element with its fields and the loop-back worklist, nothing repeated', async () => {
    const dir = await failingModel()
    const raw = computeGates(await loadGateInput(dir))
    const full = await run({ action: 'gates', directory_path: dir })
    expect(full.gate3.verdict).toBe('FAIL')
    const failingRaw = Object.entries(raw.gate3.criteria).filter(([, c]) => c.verdict !== 'PASS')
    expect(failingRaw.length).toBeGreaterThan(0)
    for (const [k, c] of failingRaw) {
      expect(full.gate3.criteria[k].failing.map((f: any) => f.id)).toEqual(c.failing.map((f) => f.id))
      for (const f of full.gate3.criteria[k].failing) if (f.missing || f.placeholder) expect(f).not.toHaveProperty('detail')
    }
    // A passing check keeps its verdict and value.
    const passed = Object.entries(raw.gate3.criteria).find(([, c]) => c.verdict === 'PASS')!
    expect(full.gate3.criteria[passed[0]]).toEqual({ verdict: 'PASS', value: passed[1].value })
    // The worklist a loop back reads is whole.
    expect(full.gate3.loopback).toEqual(raw.gate3.loopback)
    expect(full.gate3.report).toEqual(raw.gate3.report)
  })

  it('keeps the detail of a failure that has no field list', () => {
    const check = { verdict: 'FAIL' as const, value: '0/1', failing_total: 1, failing: [{ id: 'c-1', detail: 'no crown jewel is named' }] }
    const r = trimGates({ lints: [], gate1: { verdict: 'PASS', checks: {} }, gate2: { verdict: 'PASS', checks: {} }, gate3: { criteria: { C6: check } } } as never)
    expect((r.gate3 as any).criteria.C6.failing[0].detail).toBe('no crown jewel is named')
  })

  it('summary: verdicts, totals and failing ids, the report, no field lists', async () => {
    const dir = await failingModel()
    const full = await run({ action: 'gates', directory_path: dir })
    const brief = await run({ action: 'gates', directory_path: dir, detail: 'summary' })
    expect(brief.detail).toBe('summary')
    expect(brief.gate3.verdict).toBe(full.gate3.verdict)
    for (const [k, c] of Object.entries<any>(full.gate3.criteria)) {
      if (c.verdict === 'PASS') expect(brief.gate3.criteria[k]).toBe('PASS')
      else expect(brief.gate3.criteria[k]).toEqual({ verdict: c.verdict, failing_total: c.failing_total, failing: c.failing.map((f: any) => f.id) })
    }
    expect(brief.gate3.report).toEqual(full.gate3.report)
    expect(brief.gate3.loopback).toEqual({ elements_total: full.gate3.loopback.elements.length })
    expect(JSON.stringify(brief)).not.toContain('"missing"')
    expect(JSON.stringify(brief).length).toBeLessThan(JSON.stringify(full).length)
  })

  it('summary lists a Gate 1 warning\'s first 3 ids with its total, and every id of a failing check and of Gates 2 and 3', () => {
    const failing = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `e${i + 1}`, detail: 'd' }))
    const check = (n: number, verdict = 'WARN') => ({ verdict, value: `${n}`, failing_total: n, failing: failing(n) })
    const r = summariseGates({
      lints: [], gate1: { verdict: 'FAIL', checks: { flows: check(18), boundaries: check(2), unzoned: check(6, 'FAIL') } },
      gate2: { verdict: 'FAIL', checks: { endpoints: check(5, 'FAIL') } },
      gate3: { verdict: 'FAIL', verdict_without_waivers: 'FAIL', criteria: { C3: check(18, 'FAIL') }, waived_total: 0, report: {}, loopback: { elements: [] } },
    } as never) as any
    expect(r.gate1.checks.flows).toEqual({ verdict: 'WARN', failing_total: 18, failing: ['e1', 'e2', 'e3'] })
    expect(r.gate1.checks.boundaries.failing).toEqual(['e1', 'e2'])
    expect(r.gate1.checks.unzoned.failing).toHaveLength(6)
    expect(r.gate2.checks.endpoints.failing).toHaveLength(5)
    expect(r.gate3.criteria.C3.failing).toHaveLength(18)
  })

  it('summary passes a Gate 3 held back by an open loop back through as it is', () => {
    const held = { verdict: 'NOT_COMPUTED', code: 'loopback_untouched', message: 'm', loop_back: { untouched_total: 2 } }
    const r = summariseGates({ lints: [], gate1: { verdict: 'PASS', checks: {} }, gate2: { verdict: 'PASS', checks: {} }, gate3: held } as never)
    expect(r.gate3).toEqual(held)
  })
})

describe('quality', () => {
  it('summary: the score, factors and the five elements with the most unresolved fields; the record keeps it whole', async () => {
    const dir = await failingModel()
    const full = await run({ action: 'quality', directory_path: dir })
    const brief = await run({ action: 'quality', directory_path: dir, detail: 'summary' })
    expect(brief.quality_score).toBe(full.quality_score)
    expect(brief.factors).toEqual(full.factors)
    expect(brief.attribute_residual.unresolved).toBe(full.attribute_residual.unresolved)
    expect(brief.attribute_residual.top_unresolved.length).toBeLessThanOrEqual(5)
    for (const e of brief.attribute_residual.top_unresolved) expect(e).not.toHaveProperty('fields')
    expect(brief.attribute_residual.top_unresolved.map((e: any) => e.element)).toEqual(full.attribute_residual.top_unresolved.slice(0, 5).map((e: any) => e.element))
    const recorded = JSON.parse(readFileSync(path.join(dir, '.dethereal', 'quality.json'), 'utf8'))
    expect(recorded.attribute_residual.top_unresolved).toEqual(full.attribute_residual.top_unresolved)
  })
})
