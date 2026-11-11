import { describe, it, expect } from 'vitest'
import { buildZoningContext, isStructuralContainer } from '@dethernety/dt-core'
import { classifyTiers, proposedZoneTier } from '../tiers.js'
import { gateModel, type GateModel } from './fixtures/gate-model.js'

const tiersOf = (m: GateModel, crownJewelIds?: Set<string>) =>
  classifyTiers({ structure: m.structure as any, dataFlows: m.dataFlows as any, dataItems: m.dataItems as any, crownJewelIds })

const boundary = (m: GateModel, id: string) => {
  const walk = (b: any): any => (b.id === id ? b : (b.boundaries ?? []).map(walk).find(Boolean))
  return walk(m.structure.defaultBoundary)
}
const component = (id: string, type = 'PROCESS', extra: Record<string, unknown> = {}) =>
  ({ id, name: id, description: id, type, positionX: 0, positionY: 0, classData: { id: 'cls-service', name: 'Application Service' }, ...extra })
const flow = (id: string, source: string, target: string) => ({ id, name: id, description: id, source: { id: source }, target: { id: target } })

describe('classifyTiers', () => {
  it('tiers the reference model: internet-facing, then crown-jewel or restricted, then the rest', () => {
    const t = tiersOf(gateModel())
    expect(Object.fromEntries(t.tierOf)).toEqual({
      'c-gateway': 1, 'c-web': 1, 'c-db': 2, 'c-audit': 2, 'c-orders': 3, 'c-notify': 3, 'c-jobs': 3, 'c-report': 3,
    })
    expect([...t.externals].sort()).toEqual(['x-customer', 'x-operator'])
    expect(t.unzoned).toEqual([])
  })

  it('needs a cross-boundary flow for Tier 1, even in a PUBLIC zone', () => {
    const m = gateModel()
    boundary(m, 'b-edge').components.push(component('c-idle'))
    expect(tiersOf(m).tierOf.get('c-idle')).toBe(3)
  })

  it('puts Tier 1 before Tier 2 for an internet-facing crown jewel', () => {
    const m = gateModel()
    boundary(m, 'b-edge').components[1].crownJewel = true
    expect(tiersOf(m).tierOf.get('c-web')).toBe(1)
  })

  it('raises a component that talks to an external entity outside a VENDOR zone, whatever zones are declared', () => {
    const m = gateModel()
    // Declare everything INTERNAL, the Internet included.
    const walk = (b: any) => { if (b.zone) b.zone = 'INTERNAL'; (b.boundaries ?? []).forEach(walk) }
    walk(m.structure.defaultBoundary)
    const t = tiersOf(m)
    expect(t.tierOf.get('c-gateway')).toBe(1)
    expect(t.tierOf.get('c-web')).toBe(3)
  })

  it('does not raise a component that only talks to a vetted vendor', () => {
    const m = gateModel()
    m.structure.defaultBoundary.boundaries.push({ id: 'b-vendor', name: 'Payment provider', zone: 'VENDOR', components: [component('x-psp', 'EXTERNAL_ENTITY')] })
    m.dataFlows.push(flow('f-psp', 'c-orders', 'x-psp'))
    expect(tiersOf(m).tierOf.get('c-orders')).toBe(3)
  })

  it('treats an external entity in an unzoned boundary as untrusted', () => {
    const m = gateModel()
    m.structure.defaultBoundary.boundaries.push({ id: 'b-partner', name: 'Partner', components: [component('x-partner', 'EXTERNAL_ENTITY')] })
    m.dataFlows.push(flow('f-partner', 'x-partner', 'c-jobs'))
    expect(tiersOf(m).tierOf.get('c-jobs')).toBe(1)
  })

  it('counts an external entity drawn inside a component\'s own boundary as a crossing', () => {
    const m = gateModel()
    boundary(m, 'b-batch').components.push(component('x-cron', 'EXTERNAL_ENTITY'))
    m.dataFlows.push(flow('f-cron', 'x-cron', 'c-jobs'))
    const t = tiersOf(m)
    expect(t.crossBoundaryFlowIds.has('f-cron')).toBe(true)
    expect(t.tierOf.get('c-jobs')).toBe(1)
  })

  it('keeps an unzoned crown jewel in Tier 2 and lists it as unzoned', () => {
    const m = gateModel()
    delete boundary(m, 'b-data').zone
    const t = tiersOf(m)
    expect(t.tierOf.get('c-db')).toBe(2)
    expect(t.tierOf.get('c-audit')).toBe(3)
    expect(t.unzoned.sort()).toEqual(['c-audit', 'c-db'])
  })

  it('never reads an unzoned boundary as EXPOSED', () => {
    const m = gateModel()
    delete boundary(m, 'b-edge').zone
    const t = tiersOf(m)
    expect(t.tierOf.get('c-web')).toBe(3)
    expect(t.tierOf.get('c-gateway')).toBe(1) // still faces the Internet
  })

  it('inherits a zone through a structural container', () => {
    const m = gateModel()
    const edge = boundary(m, 'b-edge')
    const inner = { id: 'b-edge-inner', name: 'Edge pods', components: edge.components.splice(1, 1) }
    edge.boundaries = [inner]
    expect(tiersOf(m).tierOf.get('c-web')).toBe(1)
    expect(tiersOf(m).boundaryZone('b-edge-inner')).toBe('PUBLIC')
  })

  it('places a component in the root boundary in no zone', () => {
    const m = gateModel()
    m.structure.defaultBoundary.components = [component('c-root')]
    m.dataFlows.push(flow('f-root', 'c-root', 'c-orders'))
    const t = tiersOf(m)
    expect(t.tierOf.get('c-root')).toBe(3)
    expect(t.unzoned).toContain('c-root')
    expect(t.crossBoundaryFlowIds.has('f-root')).toBe(true)
  })

  it('locates a boundary endpoint in that boundary', () => {
    const m = gateModel()
    m.dataFlows.push(flow('f-to-data', 'c-jobs', 'b-data'), flow('f-to-own', 'c-jobs', 'b-batch'))
    const t = tiersOf(m)
    expect(t.crossBoundaryFlowIds.has('f-to-data')).toBe(true)
    expect(t.crossBoundaryFlowIds.has('f-to-own')).toBe(false)
    expect(t.endpointZone('b-data')).toBe('RESTRICTED')
  })

  it('reads an external endpoint as VENDOR only when declared so', () => {
    const m = gateModel()
    m.structure.defaultBoundary.boundaries.push({ id: 'b-vendor', name: 'Vendor', zone: 'VENDOR', components: [component('x-psp', 'EXTERNAL_ENTITY')] })
    boundary(m, 'b-internet').zone = 'INTERNAL'
    const t = tiersOf(m)
    expect(t.endpointZone('x-psp')).toBe('VENDOR')
    expect(t.endpointZone('x-customer')).toBe('UNTRUSTED')
  })

  it('raises a component that holds a mapped data item, or sits inside a mapped boundary', () => {
    const m = gateModel()
    expect(tiersOf(m, new Set(['d-order'])).tierOf.get('c-orders')).toBe(2)
    const t = tiersOf(m, new Set(['b-batch']))
    expect(t.tierOf.get('c-jobs')).toBe(2)
    expect(t.tierOf.get('c-report')).toBe(2)
    expect(t.tierOf.get('c-notify')).toBe(3)
  })

  it('excludes external entities from every tier', () => {
    const t = tiersOf(gateModel(), new Set(['x-customer']))
    expect(t.tierOf.has('x-customer')).toBe(false)
  })
})

describe('the proposed zone of a boundary that allows any inbound traffic', () => {
  it('leaves a structural container to the engine, and an external entity its tier', () => {
    const m = gateModel()
    // A container that holds only boundaries: b-group around the application tier.
    const root = m.structure.defaultBoundary
    const app = root.boundaries.find((b: any) => b.id === 'b-app')
    root.boundaries = root.boundaries.filter((b: any) => b.id !== 'b-app')
    root.boundaries.push({ id: 'b-group', name: 'Group', description: 'g', boundaries: [app], components: [] })
    const ctx = buildZoningContext(m.structure as never, m.dataFlows as never, m.dataItems as never)
    const group = ctx.boundariesById.get('b-group')!
    expect(isStructuralContainer(group)).toBe(true)
    expect(proposedZoneTier(group, ctx, true).reason).not.toMatch(/allow_any_inbound/)
    const internet = ctx.boundariesById.get('b-internet')!
    expect(proposedZoneTier(internet, ctx, true).tier).toBe('UNTRUSTED')
    expect(proposedZoneTier(ctx.boundariesById.get('b-app')!, ctx, true)).toEqual({ tier: 'PUBLIC', reason: 'allows any inbound traffic (allow_any_inbound: true)' })
  })
})

