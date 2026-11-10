/**
 * Tier membership as the gates report it, and control coverage by the same
 * tiers: one reading of the model, so the two never disagree.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { validateModelTool } from '../validate-model.tool.js'
import { gateModel, writeGateModel, type GateModel } from '../../utils/__tests__/fixtures/gate-model.js'
import { MAX_FAILING } from '../../utils/gates.js'

const context = { debug: false } as never
let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(process.cwd(), '.test-tier-report-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function run(action: 'gates' | 'coverage', m: GateModel = gateModel()): Promise<any> {
  await writeGateModel(dir, m)
  const r = await validateModelTool.run({ action, directory_path: dir } as never, context)
  expect(r.success, r.error).toBe(true)
  return r.data
}
const componentsOf = (m: GateModel, boundary: string) =>
  (m.structure.defaultBoundary.boundaries as any[]).find((b) => b.id === boundary).components as any[]

describe('gates report: tier members', () => {
  it('lists Tier 1 and 2 by id and name, counts Tier 3, and labels crown jewels without making them a tier', async () => {
    const tm = (await run('gates')).gate3.report.tier_members
    expect(tm.tier1).toEqual([{ id: 'c-gateway', name: 'API gateway' }, { id: 'c-web', name: 'Web frontend' }])
    expect(tm.tier2).toEqual([{ id: 'c-db', name: 'Orders database' }, { id: 'c-audit', name: 'Audit log store' }])
    expect(tm).toMatchObject({ tier1_total: 2, tier2_total: 2, tier3_total: 4, tier3_unzoned: 0 })
    expect(tm.labels).toEqual({
      crown_jewels: [{ id: 'c-db', name: 'Orders database' }], crown_jewels_total: 1, crown_jewel_externals: 0,
      cross_boundary: [
        { id: 'c-orders', name: 'Order service' }, { id: 'c-jobs', name: 'Job runner' }, { id: 'c-report', name: 'Report builder' },
        { id: 'c-db', name: 'Orders database' }, { id: 'c-audit', name: 'Audit log store' },
      ],
      cross_boundary_total: 5,
    })
  })

  it('caps each list and keeps the totals', async () => {
    const m = gateModel()
    const edge = componentsOf(m, 'b-edge')
    for (let i = 0; i < MAX_FAILING + 3; i++) {
      edge.push({ ...edge[0], id: `c-extra-${i}`, name: `Extra ${i}`, positionX: 1000 + i * 10, positionY: 1000 })
      m.dataFlows.push({ ...m.dataFlows[0], id: `f-extra-${i}`, target: { id: `c-extra-${i}` } })
    }
    const tm = (await run('gates', m)).gate3.report.tier_members
    expect(tm.tier1).toHaveLength(MAX_FAILING)
    expect(tm.tier1_total).toBe(MAX_FAILING + 5)
  })

  it('leaves a flagged external and a mapped but unflagged component out of the crown-jewel label', async () => {
    const m = gateModel()
    componentsOf(m, 'b-internet')[0].crownJewel = true
    m.scope!.crown_jewel_elements = { ...m.scope!.crown_jewel_elements, 'Customer orders': ['c-db', 'c-report'] }
    const tm = (await run('gates', m)).gate3.report.tier_members
    expect(tm.labels.crown_jewels.map((c: any) => c.id)).toEqual(['c-db'])
    expect(tm.labels.crown_jewel_externals).toBe(1)
  })

  it('counts unzoned Tier 3 components', async () => {
    const m = gateModel()
    delete (m.structure.defaultBoundary.boundaries as any[]).find((b) => b.id === 'b-batch').zone
    expect((await run('gates', m)).gate3.report.tier_members.tier3_unzoned).toBe(2)
  })
})

describe('coverage by the gates\' tiers', () => {
  it('uses the same tiers as the gates, over classified non-external components', async () => {
    const m = gateModel()
    delete componentsOf(m, 'b-batch')[0].classData
    const gates = (await run('gates', m)).gate3.report.tier_members
    const fc = (await run('coverage', m)).formal_coverage
    expect(Object.keys(fc).sort()).toEqual([
      'cross_boundary_flows', 'cross_boundary_flows_total', 'externals_excluded', 'labels',
      'tier_1_internet_facing', 'tier_2_crown_jewel_or_restricted', 'tier_3_internal', 'tier_3_unzoned',
    ])
    expect(fc.tier_1_internet_facing.total + fc.tier_1_internet_facing.unclassified).toBe(gates.tier1_total)
    expect(fc.tier_2_crown_jewel_or_restricted.total + fc.tier_2_crown_jewel_or_restricted.unclassified).toBe(gates.tier2_total)
    expect(fc.tier_3_internal.total + fc.tier_3_internal.unclassified).toBe(gates.tier3_total)
    expect(fc.tier_3_internal.unclassified).toBe(1)
    expect(fc.externals_excluded).toBe(2)
    expect(fc.labels.crown_jewels).toMatchObject({ total: 1 })
    // The label counts the unclassified member apart, as the tiers do.
    expect(fc.labels.cross_boundary.total + fc.labels.cross_boundary.unclassified).toBe(gates.labels.cross_boundary_total)
  })

  it('lists gaps as capped {id, name} with a total', async () => {
    const fc = (await run('coverage')).formal_coverage
    expect(fc.tier_1_internet_facing.gaps).toEqual([{ id: 'c-gateway', name: 'API gateway' }, { id: 'c-web', name: 'Web frontend' }])
    expect(fc.tier_1_internet_facing).toMatchObject({ total: 2, with_controls: 0, gaps_total: 2 })
  })

  it('puts an internet-facing crown jewel in Tier 1 and still labels it', async () => {
    const m = gateModel()
    componentsOf(m, 'b-edge')[0].crownJewel = true
    const fc = (await run('coverage', m)).formal_coverage
    expect(fc.tier_1_internet_facing.total).toBe(2)
    expect(fc.labels.crown_jewels.total).toBe(2)
  })

  it('counts the summary over the same population', async () => {
    const m = gateModel()
    delete componentsOf(m, 'b-batch')[0].classData
    const cov = await run('coverage', m)
    const fc = cov.formal_coverage
    expect(cov.coverage_summary.total_exposures).toBe(fc.tier_1_internet_facing.total + fc.tier_2_crown_jewel_or_restricted.total + fc.tier_3_internal.total)
    expect(cov.inferred_coverage.authentication.total).toBe(cov.coverage_summary.total_exposures)
  })

  it('fails with a code when the model cannot be read, and names no path', async () => {
    await writeGateModel(dir, gateModel())
    await fs.writeFile(path.join(dir, 'structure.json'), 'not json')
    const r = await validateModelTool.run({ action: 'coverage', directory_path: dir } as never, context)
    expect(r.success).toBe(false)
    expect(r.error).toBe('Coverage needs a readable model (structure.json: invalid json).')
  })
})

describe('coverage and "not_applicable" at rest', () => {
  it('leaves a process that stores nothing out of the at-rest count, and lists a store that says so as missing', async () => {
    const base = await run('coverage')
    const m = gateModel()
    m.attributes.components['c-gateway']!.attributes.encryption_at_rest = 'not_applicable'
    const onProcess = await run('coverage', m)
    expect(onProcess.inferred_coverage.encryption_at_rest.total).toBe(base.inferred_coverage.encryption_at_rest.total - 1)
    expect(onProcess.inferred_coverage.encryption_at_rest.covered).toBe(base.inferred_coverage.encryption_at_rest.covered - 1)
    const s = gateModel()
    s.attributes.components['c-db']!.attributes.encryption_at_rest = 'N/A'
    const onStore = await run('coverage', s)
    expect(onStore.inferred_coverage.encryption_at_rest.total).toBe(base.inferred_coverage.encryption_at_rest.total)
    expect(onStore.inferred_coverage.encryption_at_rest.missing).toContain('Orders database')
  })
})

describe('coverage counts only answers that name encryption', () => {
  it('measures transit over the gates\' cross-boundary flows, and never counts "not encrypted" or a placeholder', async () => {
    const base = await run('coverage')
    const gates = (await run('gates')).gate3.criteria.C3.value as string
    expect(base.inferred_coverage.encryption_transit.total).toBe(Number(/\/(\d+) cross-boundary/.exec(gates)![1]))
    const m = gateModel()
    for (const f of m.dataFlows) {
      const a = m.attributes.dataFlows[f.id]!.attributes as Record<string, unknown>
      a.encryption_in_transit = 'not encrypted'
      delete a.flow_tls_encrypted
    }
    const off = await run('coverage', m)
    expect(off.inferred_coverage.encryption_transit.covered).toBe(0)
    const s = gateModel()
    s.attributes.components['c-db']!.attributes.encryption_at_rest = 'TBD'
    const tbd = await run('coverage', s)
    expect(tbd.inferred_coverage.encryption_at_rest.covered).toBe(base.inferred_coverage.encryption_at_rest.covered - 1)
  })
})
