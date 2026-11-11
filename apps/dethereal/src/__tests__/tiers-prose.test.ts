// Ties the tier definition the workflow teaches (workflow/shared/tiers.md) to the rule the server
// applies (classifyTiers). Each clause of the prose table is checked twice: its words are still in
// the prose, and a model built to satisfy exactly that clause gets the tier the prose promises.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyTiers } from '../utils/tiers.js'
import { gateModel, type GateModel } from '../utils/__tests__/fixtures/gate-model.js'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const prose = readFileSync(path.join(pkgRoot, 'workflow', 'shared', 'tiers.md'), 'utf-8')
const row = (tier: string) => prose.split('\n').find((l) => l.startsWith(`| **${tier}**`)) ?? ''

const tiersOf = (m: GateModel, crownJewelIds?: Set<string>) =>
  classifyTiers({ structure: m.structure as any, dataFlows: m.dataFlows as any, dataItems: m.dataItems as any, crownJewelIds })
const component = (id: string, type = 'PROCESS', extra: Record<string, unknown> = {}) =>
  ({ id, name: id, description: id, type, positionX: 0, positionY: 0, classData: { id: 'cls-service', name: 'Application Service' }, ...extra })
const flow = (id: string, source: string, target: string) => ({ id, name: id, description: id, source: { id: source }, target: { id: target } })
const root = (m: GateModel) => m.structure.defaultBoundary as any
const addBoundary = (m: GateModel, b: Record<string, unknown>) => { root(m).boundaries.push({ components: [], boundaries: [], ...b }); return b }

describe('workflow tiers.md matches classifyTiers', () => {
  it('keeps the three tiers, in order, with first-match precedence', () => {
    expect(prose).toMatch(/gets the \*\*first\*\* tier it qualifies for/)
    expect(prose).toMatch(/External entities are never tiered/)
    const order = ['Tier 1', 'Tier 2', 'Tier 3'].map((t) => prose.indexOf(`| **${t}**`))
    expect(order.every((i) => i > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('Tier 1: a cross-boundary endpoint in a PUBLIC or EXPOSED zone', () => {
    expect(row('Tier 1')).toMatch(/cross-boundary flow/)
    expect(row('Tier 1')).toMatch(/PUBLIC or EXPOSED/)
    for (const zone of ['PUBLIC', 'EXPOSED']) {
      const m = gateModel()
      addBoundary(m, { id: 'b-z', name: 'Zone', zone, components: [component('c-z')] })
      addBoundary(m, { id: 'b-in', name: 'In', zone: 'INTERNAL', components: [component('c-in')] })
      m.dataFlows.push(flow('f-z', 'c-z', 'c-in') as any)
      expect(tiersOf(m).tierOf.get('c-z'), zone).toBe(1)
    }
  })

  it('Tier 1: a flow with an external entity whose zone is not VENDOR; VENDOR does not raise', () => {
    expect(row('Tier 1')).toMatch(/external entity whose zone is not VENDOR/)
    const m = gateModel()
    addBoundary(m, { id: 'b-in', name: 'In', zone: 'INTERNAL', components: [component('c-a'), component('c-b')] })
    addBoundary(m, { id: 'b-x', name: 'Partner', zone: 'UNTRUSTED', components: [component('x-p', 'EXTERNAL_ENTITY')] })
    addBoundary(m, { id: 'b-v', name: 'Vendor', zone: 'VENDOR', components: [component('x-v', 'EXTERNAL_ENTITY')] })
    m.dataFlows.push(flow('f-p', 'x-p', 'c-a') as any, flow('f-v', 'c-b', 'x-v') as any)
    const t = tiersOf(m)
    expect(t.tierOf.get('c-a')).toBe(1)
    expect(t.tierOf.get('c-b')).toBe(3)
    expect(t.externals.has('x-p') && !t.tierOf.has('x-p')).toBe(true)
  })

  it('Tier 1 needs the cross-boundary flow: a PUBLIC component without one is not internet-facing', () => {
    const m = gateModel()
    addBoundary(m, { id: 'b-pub', name: 'Public', zone: 'PUBLIC', components: [component('c-idle')] })
    expect(tiersOf(m).tierOf.get('c-idle')).toBe(3)
  })

  it('Tier 2: crownJewel, RESTRICTED, a mapped crown-jewel data item, or inside a mapped crown-jewel boundary', () => {
    const r2 = row('Tier 2')
    for (const words of ['`crownJewel: true`', 'RESTRICTED', 'mapped crown-jewel data item', 'mapped crown-jewel boundary, at any depth']) expect(r2).toContain(words)
    const m = gateModel()
    addBoundary(m, { id: 'b-q', name: 'Quiet', zone: 'INTERNAL', components: [component('c-flag', 'PROCESS', { crownJewel: true }), component('c-item', 'PROCESS', { dataItemIds: ['d-cj'] }), component('c-plain')] })
    addBoundary(m, { id: 'b-r', name: 'Restricted', zone: 'RESTRICTED', components: [component('c-restricted')] })
    addBoundary(m, { id: 'b-cj', name: 'Vault', zone: 'INTERNAL', components: [], boundaries: [{ id: 'b-cj-inner', name: 'Inner', components: [component('c-deep')], boundaries: [] }] })
    m.dataItems.push({ id: 'd-cj', name: 'Card data', description: 'card data' } as any)
    const t = tiersOf(m, new Set(['d-cj', 'b-cj']))
    expect(t.tierOf.get('c-flag')).toBe(2)
    expect(t.tierOf.get('c-restricted')).toBe(2)
    expect(t.tierOf.get('c-item')).toBe(2)
    expect(t.tierOf.get('c-deep')).toBe(2)
    expect(t.tierOf.get('c-plain')).toBe(3)
  })

  it('Tier 1 wins over Tier 2 for an internet-facing crown jewel', () => {
    const m = gateModel()
    addBoundary(m, { id: 'b-pub', name: 'Public', zone: 'PUBLIC', components: [component('c-cj', 'PROCESS', { crownJewel: true })] })
    addBoundary(m, { id: 'b-in', name: 'In', zone: 'INTERNAL', components: [component('c-in')] })
    m.dataFlows.push(flow('f-cj', 'c-cj', 'c-in') as any)
    expect(tiersOf(m).tierOf.get('c-cj')).toBe(1)
  })

  it('Tier 3: every other non-external component, unzoned ones included and reported', () => {
    expect(row('Tier 3')).toMatch(/unzoned ones included/)
    const m = gateModel()
    addBoundary(m, { id: 'b-none', name: 'No zone', components: [component('c-unzoned')] })
    const t = tiersOf(m)
    expect(t.tierOf.get('c-unzoned')).toBe(3)
    expect(t.unzoned).toContain('c-unzoned')
  })

  it('an external entity reads as VENDOR only in a declared or inherited VENDOR zone', () => {
    expect(prose).toMatch(/VENDOR when its boundary's declared or inherited zone is VENDOR, otherwise UNTRUSTED/)
    const m = gateModel()
    addBoundary(m, { id: 'b-v', name: 'Vendor', zone: 'VENDOR', components: [], boundaries: [{ id: 'b-v-inner', name: 'Inner', components: [component('x-inh', 'EXTERNAL_ENTITY')], boundaries: [] }] })
    addBoundary(m, { id: 'b-u', name: 'Unzoned', components: [component('x-un', 'EXTERNAL_ENTITY')] })
    const t = tiersOf(m)
    expect(t.endpointZone('x-inh')).toBe('VENDOR')
    expect(t.endpointZone('x-un')).toBe('UNTRUSTED')
  })
})
