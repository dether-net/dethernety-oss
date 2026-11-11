/**
 * A key component none of whose matches carries a class the key allows keeps
 * its identity through one of them: the right kind of element, taking part in
 * the most of its key flows, with the fewest name words no alias covers, then
 * the longest alias. A tie keeps none. The class is scored apart.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { holds, type ExpectedKey } from '../key.js'
import { matchModel, modelFromDocs, type RunModel } from '../score/match.js'
import { attackPaths } from '../score/rubric.js'
import type { PlatformExport } from '../platform-export.js'
import { FIXTURE, key } from './fixtures/clean-run.js'

const RDS = 'a79a87ff-fc03-4c15-809e-1367b597d5a3'
const KMS = 'abcfb9b1-6157-4f19-99c3-82d3cd4b1129'
const API = '0a9df6cc-1216-49d2-ae5d-f6f850246f6f'
type C = RunModel['components'][number]
const comp = (id: string, name: string, extra: Partial<C> = {}): C => ({ id, name, type: 'STORE', boundaryId: 'b1', ...extra })
const api = comp('api', 'Orders API', { type: 'PROCESS', classId: API })
const flow = (id: string, source: string, target: string) => ({ id, name: id, source, target, dataItemIds: [] })
const model = (components: C[], flows: RunModel['flows'] = []): RunModel => ({
  components: [api, ...components], boundaries: [{ id: 'b1', name: 'all', parentId: 'root', componentIds: [api, ...components].map((c) => c.id) }], flows, dataItems: [],
})
const kept = (r: ReturnType<typeof matchModel>) => [...r.components].filter(([, k]) => k === 'c-orders-db').map(([id]) => id)

describe('the class contest', () => {
  it('keeps the database a run gave another module\'s class, by the key flows it takes part in', () => {
    // "Orders DB" and "Orders DB KMS Key" hit the same alias; the database carries the orders API's queries.
    const r = matchModel(model([comp('db', 'Orders DB', { classId: RDS }), comp('kms', 'Orders DB KMS Key', { classId: KMS })], [flow('q', 'api', 'db')]), key)
    expect(kept(r)).toEqual(['db'])
    expect(r.classKept).toEqual([{ runId: 'db', name: 'Orders DB', keyId: 'c-orders-db', classId: RDS, evidence: { role: 1, uncovered: 0, alias: 9 }, rejected: ['kms'] }])
    expect(r.classFiltered).toEqual([{ runId: 'kms', name: 'Orders DB KMS Key', keyId: 'c-orders-db', classId: KMS, sole: false }])
    expect(r.flows.get('q')).toEqual({ keyId: 'f-orders-db', reversed: false })
  })

  it('never crowns a sibling for a longer alias: taking part in the flows comes first', () => {
    // "Postgres" (alias 8) against "Orders DB KMS Key" (alias 9): the database carries the flows.
    const r = matchModel(model([comp('db', 'Postgres', { classId: RDS }), comp('kms', 'Orders DB KMS Key', { classId: KMS })], [flow('q', 'api', 'db')]), key)
    expect(kept(r)).toEqual(['db'])
  })

  it('ranks by the flows first, then the name words no alias covers, then the alias', () => {
    const wh = comp('wh', 'Webhook receiver', { type: 'PROCESS', classId: API })
    // Both take part; the database in two key flows, the key store in one: flows decide over the key store's closer name.
    const byRole = matchModel(model([wh, comp('db', 'Postgres primary', { classId: RDS }), comp('kms', 'Orders DB', { classId: KMS })],
      [flow('q', 'api', 'db'), flow('w', 'wh', 'db'), flow('k', 'api', 'kms')]), key)
    expect(kept(byRole)).toEqual(['db'])
    // One flow each: the fewer uncovered words decide over the key store's longer alias.
    const byWords = matchModel(model([comp('db', 'Postgres', { classId: RDS }), comp('kms', 'Orders DB KMS Key', { classId: KMS })],
      [flow('q', 'api', 'db'), flow('k', 'api', 'kms')]), key)
    expect(kept(byWords)).toEqual(['db'])
    expect(byWords.classKept[0]!.evidence).toEqual({ role: 1, uncovered: 0, alias: 8 })
  })

  it('keeps none that takes part in none of the component\'s key flows', () => {
    // "rds" matches an RDS Proxy; it carries none of the database's flows.
    const r = matchModel(model([comp('proxy', 'RDS Proxy', { classId: KMS })]), key)
    expect(kept(r)).toEqual([])
    expect(r.classFiltered).toEqual([expect.objectContaining({ runId: 'proxy', sole: true })])
  })

  it('weighs an unclassified match with the wrongly classed ones, and two unclassified against each other', () => {
    const mixed = matchModel(model([comp('db', 'Orders database', { classId: RDS }), comp('kms', 'Orders DB KMS key')], [flow('q', 'api', 'db')]), key)
    expect(kept(mixed)).toEqual(['db'])
    const both = matchModel(model([comp('db', 'Orders database'), comp('kms', 'Orders DB KMS key')], [flow('q', 'api', 'db')]), key)
    expect(kept(both)).toEqual(['db'])
    expect(both.classKept.map((k) => [k.runId, k.classId])).toEqual([['db', undefined]])
    // A lone unclassified match stays, as it always did.
    expect(kept(matchModel(model([comp('db', 'Orders database')]), key))).toEqual(['db'])
  })

  it('keeps no element of the wrong kind, and none on a tie', () => {
    const process = matchModel(model([comp('db', 'Orders database', { type: 'PROCESS', classId: RDS })], [flow('q', 'api', 'db')]), key)
    expect(kept(process)).toEqual([])
    // Two replicas alike in every way: the component is left without a match.
    const tie = matchModel(model([comp('db1', 'Orders DB', { classId: RDS }), comp('db2', 'Orders DB', { classId: KMS })], [flow('q1', 'api', 'db1'), flow('q2', 'api', 'db2')]), key)
    expect(kept(tie)).toEqual([])
    expect(tie.classFiltered.map((f) => [f.runId, f.sole])).toEqual([['db1', true], ['db2', true]])
    expect(tie.classKept).toEqual([])
  })

  it('decides on the longest alias when the flows and the uncovered words tie', () => {
    const r = matchModel(model([comp('kms', 'Orders DB', { classId: KMS }), comp('db', 'Orders database', { classId: RDS })],
      [flow('q', 'api', 'db'), flow('k', 'api', 'kms')]), key)
    expect(kept(r)).toEqual(['db'])
    expect(r.classKept[0]!.evidence).toEqual({ role: 1, uncovered: 0, alias: 15 })
  })

  it('counts no flow drawn against the key direction', () => {
    const r = matchModel(model([comp('db', 'Orders DB', { classId: RDS })], [flow('q', 'db', 'api')]), key)
    expect(kept(r)).toEqual([])
    expect(r.classFiltered).toEqual([expect.objectContaining({ runId: 'db', sole: true })])
  })

  it('counts no flow whose other end is a duplicate dropped beside a match of an allowed class', () => {
    // "Orders service" is dropped beside the orders API; the flow it draws to one of two like databases proves nothing.
    const r = matchModel(model([comp('api2', 'Orders service', { type: 'PROCESS', classId: RDS }), comp('db1', 'Orders DB', { classId: KMS }), comp('db2', 'Orders DB', { classId: KMS })],
      [flow('q', 'api2', 'db1')]), key)
    expect(kept(r)).toEqual([])
    expect(r.classKept).toEqual([])
  })

  it('never keeps an external entity for an internal component, even when the key gives no type', () => {
    const untyped = { ...key, components: key.components.map((c) => (c.id === 'c-orders-db' ? { ...c, type: undefined } : c)) } as ExpectedKey
    const as = (type: string) => matchModel(model([comp('db', 'Orders DB', { type, classId: RDS })], [flow('q', 'api', 'db')]), untyped)
    expect(kept(as('EXTERNAL_ENTITY'))).toEqual([])
    expect(kept(as('STORE'))).toEqual(['db'])
  })

  it('keeps every key component\'s type equal to its type in the key model', () => {
    const structure = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'key', 'model', 'structure.json'), 'utf8'))
    const types = new Map<string, string>()
    const walk = (b: any) => { for (const c of b.components ?? []) types.set(c.id, c.type); for (const n of b.boundaries ?? []) walk(n) }
    walk(structure.defaultBoundary)
    for (const c of key.components) expect([c.id, c.type]).toEqual([c.id, types.get(c.id)])
  })

  it('keeps the attack paths through a kept element', () => {
    const read = (f: string) => JSON.parse(fs.readFileSync(path.join(FIXTURE, 'key', 'model', f), 'utf8'))
    const structure = read('structure.json')
    const walk = (b: any) => { for (const c of b.components ?? []) if (c.id === 'c-orders-db') c.classData = { id: RDS, name: 'RDS Instance' }; for (const n of b.boundaries ?? []) walk(n) }
    walk(structure.defaultBoundary)
    const exp = { files: { 'structure.json': structure, 'dataflows.json': read('dataflows.json'), 'data-items.json': read('data-items.json') }, exposures: {} } as unknown as PlatformExport
    expect([...attackPaths(exp, key)].sort()).toEqual(['x-customer->c-orders-db', 'x-engineer->c-orders-db', 'x-payvendor->c-orders-db'])
    expect(matchModel(modelFromDocs(structure, read('dataflows.json'), read('data-items.json')), key).classKept.map((k) => k.keyId)).toEqual(['c-orders-db'])
  })

  it('never reads an absent field as a recorded absence on an element the run gave a class the key does not allow', () => {
    const c = { key: 'credential_type', in_or_absent: ['none'] }
    const bags = new Map([['c-orders-db', {}]])
    expect(holds(c, 'c-orders-db', bags, key as ExpectedKey)).toBe(true)
    expect(holds(c, 'c-orders-db', bags, key as ExpectedKey, new Set(['c-orders-db']))).toBe(false)
    expect(holds(c, 'c-orders-db', new Map([['c-orders-db', { credential_type: 'none' }]]), key as ExpectedKey, new Set(['c-orders-db']))).toBe(true)
  })
})
