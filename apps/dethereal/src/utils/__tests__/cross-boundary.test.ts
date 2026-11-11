import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { validateModelTool } from '../../tools/validate-model.tool.js'
import { gateModel, writeGateModel } from './fixtures/gate-model.js'

const context = { debug: false }
let dir: string

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(process.cwd(), '.test-cross-boundary-'))
  await writeGateModel(dir, gateModel())
})
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

// The reference model: an Edge zone (Tier 1: gateway, web), two internal zones (orders, notifier; jobs, report)
// and a restricted data zone (orders database, the crown jewel; audit store).
const EAST_WEST = ['c-orders', 'c-jobs', 'c-report', 'c-db', 'c-audit']

describe('the cross_boundary label', () => {
  it('lists the components outside Tier 1 at an end of a flow that crosses into another component\'s boundary', async () => {
    const gates = ((await validateModelTool.run({ action: 'gates', directory_path: dir } as never, context)) as any).data
    const labels = gates.gate3.report.tier_members.labels
    expect(labels.cross_boundary.map((c: { id: string }) => c.id)).toEqual(EAST_WEST)
    expect(labels.cross_boundary_total).toBe(EAST_WEST.length)
    // A label, not a tier: the tiers still add up to the components they had.
    const t = gates.gate3.report.tiers
    expect(t.tier1 + t.tier2 + t.tier3).toBe(8)
  })

  it('reports the same members in the coverage, and every cross-boundary flow with its declared authentication', async () => {
    const cov = ((await validateModelTool.run({ action: 'coverage', directory_path: dir } as never, context)) as any).data
    const formal = cov.formal_coverage
    expect(formal.labels.cross_boundary.total).toBe(EAST_WEST.length)
    expect(formal.cross_boundary_flows_total).toBe(6)
    expect(Object.fromEntries(formal.cross_boundary_flows.map((f: { id: string; authentication: string }) => [f.id, f.authentication]))).toEqual({
      'f-checkout': 'declared', 'f-admin': 'declared', 'f-submit': 'declared', 'f-write': 'declared', 'f-report': 'declared_none', 'f-audit': 'declared_none',
    })
  })
})

describe('what a flow declares about its authentication', () => {
  it('reads a credential or a real credential type as declared, an explicit empty set as declared none, anything else as undeclared', async () => {
    const { flowAuthentication } = await import('../lints.js')
    expect(flowAuthentication({ required_credentials: ['db-app-cred'] })).toBe('declared')
    expect(flowAuthentication({ credential_type: 'mtls' })).toBe('declared')
    expect(flowAuthentication({ required_credentials: [] })).toBe('declared_none')
    expect(flowAuthentication({ required_credentials: [], credential_type: 'none' })).toBe('declared_none')
    expect(flowAuthentication({})).toBe('undeclared')
    expect(flowAuthentication({ required_credentials: ['TBD'] })).toBe('undeclared')
    expect(flowAuthentication({ credential_type: 'unknown' })).toBe('undeclared')
  })
})
