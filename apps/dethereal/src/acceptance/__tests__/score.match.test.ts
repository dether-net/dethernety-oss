/**
 * Matching run elements to the key: the key model matches itself exactly; aliases,
 * the admin listener, decoys, reversed flows and data items behave as the key's rules say.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ADMIN_LISTENER_ID, matchModel, readRunModel, type RunModel } from '../score/match.js'
import type { ExpectedKey } from '../key.js'

const KEY_DIR = path.resolve(import.meta.dirname, '..', 'fixtures', 'synthetic', 'key')
const key = JSON.parse(fs.readFileSync(path.join(KEY_DIR, 'expected.json'), 'utf8')) as ExpectedKey
const keyModel = readRunModel(path.join(KEY_DIR, 'model'))

describe('matchModel', () => {
  it('matches the key model to itself, element by element, with nothing left over', () => {
    const m = matchModel(keyModel, key)
    for (const c of keyModel.components) expect(m.components.get(c.id), c.id).toBe(c.id)
    for (const b of keyModel.boundaries.filter((x) => x.parentId !== null)) expect(m.boundaries.get(b.id), b.id).toBe(b.id)
    for (const f of keyModel.flows) expect(m.flows.get(f.id), f.id).toEqual({ keyId: f.id, reversed: false })
    for (const d of keyModel.dataItems) expect(m.dataItems.get(d.id), d.id).toBe(d.id)
    expect(m.unmatched).toEqual([])
    expect(m.decoys).toEqual([])
  })

  const run = (): RunModel => ({
    components: [
      { id: 'n1', name: 'SSH gateway', boundaryId: 'b1' },
      { id: 'n2', name: 'Kong API gateway', boundaryId: 'b1' },
      { id: 'n3', name: 'orders-api admin listener', boundaryId: 'b1' },
      { id: 'n4', name: 'Orders API', boundaryId: 'b1' },
      { id: 'n5', name: 'Legacy reporting job', boundaryId: 'b1' },
      { id: 'n6', name: 'Records cache', boundaryId: 'b1' },
      { id: 'n7', name: 'Postgres', boundaryId: 'b1' },
    ],
    boundaries: [{ id: 'b1', name: 'everything', parentId: 'root', componentIds: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7'] }],
    flows: [
      { id: 'r1', name: 'bastion to admin', source: 'n1', target: 'n3', dataItemIds: [] },
      { id: 'r2', name: 'db to api (reversed)', source: 'n7', target: 'n4', dataItemIds: [] },
    ],
    dataItems: [],
  })

  it('matches the customer actor by its plural name too', () => {
    const m = matchModel({ components: [{ id: 'n1', name: 'Customers', type: 'EXTERNAL_ENTITY', boundaryId: 'b1' }], boundaries: [{ id: 'b1', name: 'Internet', parentId: 'root', componentIds: ['n1'] }], flows: [], dataItems: [] }, key)
    expect(m.components.get('n1')).toBe('x-customer')
  })

  it('takes the longest alias, keeps the admin listener apart, and whole words only', () => {
    const m = matchModel(run(), key)
    expect(m.components.get('n1')).toBe('c-bastion')
    expect(m.components.get('n2')).toBe('c-edge-gateway')
    expect(m.components.get('n3')).toBe(ADMIN_LISTENER_ID)
    expect(m.components.get('n4')).toBe('c-orders-api')
    // "rds" is an alias of the database; "Records" must not hit it.
    expect(m.components.has('n6')).toBe(false)
    expect(m.components.get('n7')).toBe('c-orders-db')
  })

  it('reports decoys, and reads a reversed flow as a miss, with the admin listener as part of the orders API', () => {
    const m = matchModel(run(), key)
    expect(m.decoys).toEqual([{ kind: 'component', runId: 'n5', name: 'Legacy reporting job' }])
    expect(m.flows.get('r1')).toEqual({ keyId: 'f-bastion-admin', reversed: false })
    expect(m.flows.get('r2')?.reversed).toBe(true)
  })

  it('drops an alias match of a class the key does not allow, and keeps a lone unclassified one', () => {
    const DB = '1a92b7a3-eaf7-4f25-8702-77c3044cf735'
    const API = '0a9df6cc-1216-49d2-ae5d-f6f850246f6f'
    const model = (components: RunModel['components'], flows: RunModel['flows'] = []): RunModel => ({
      components, boundaries: [{ id: 'b1', name: 'all', parentId: 'root', componentIds: components.map((c) => c.id) }], flows, dataItems: [],
    })
    // The database, and two siblings whose names carry its aliases: the siblings give way, and so does a flow to one.
    const siblings = matchModel(model([
      { id: 'db', name: 'Orders DB (RDS PostgreSQL 16)', type: 'STORE', classId: DB, boundaryId: 'b1' },
      { id: 'kms', name: 'Orders DB KMS key', type: 'STORE', boundaryId: 'b1' },
      { id: 'logs', name: 'RDS PostgreSQL log group', type: 'STORE', boundaryId: 'b1' },
      { id: 'api', name: 'Orders API', classId: API, boundaryId: 'b1' },
    ], [
      { id: 'q', name: 'queries', source: 'api', target: 'db', dataItemIds: [] },
      { id: 'k', name: 'key use', source: 'api', target: 'kms', dataItemIds: [] },
    ]), key)
    expect([...siblings.components].filter(([, k]) => k === 'c-orders-db').map(([id]) => id)).toEqual(['db'])
    expect(siblings.classFiltered.map((f) => [f.runId, f.keyId, f.sole])).toEqual([['kms', 'c-orders-db', false], ['logs', 'c-orders-db', false]])
    expect(siblings.flows.get('q')).toEqual({ keyId: 'f-orders-db', reversed: false })
    expect(siblings.flows.has('k')).toBe(false)
    // A lone match of a class the key does not allow, of no kind and in none of the component's key flows, is dropped,
    // and says so; a lone unclassified one stays.
    const wrong = matchModel(model([{ id: 'db', name: 'Orders database', classId: API, boundaryId: 'b1' }]), key)
    expect(wrong.components.has('db')).toBe(false)
    expect(wrong.classFiltered).toEqual([{ runId: 'db', name: 'Orders database', keyId: 'c-orders-db', classId: API, sole: true }])
    expect(matchModel(model([{ id: 'db', name: 'Orders database', boundaryId: 'b1' }]), key).components.get('db')).toBe('c-orders-db')
    // A class the key lists as an alternate counts as allowed.
    const alternate = matchModel(model([
      { id: 'api', name: 'Orders API', classId: 'a4297611-55b0-41c6-9c56-3a3b707707ed', boundaryId: 'b1' },
      { id: 'api-cfg', name: 'Orders API config', boundaryId: 'b1' },
    ]), key)
    expect(alternate.components.get('api')).toBe('c-orders-api')
    expect(alternate.classFiltered.map((f) => f.runId)).toEqual(['api-cfg'])
    // The admin listener's reserved id constrains no class.
    expect(matchModel(model([{ id: 'adm', name: 'Orders API admin listener', classId: DB, boundaryId: 'b1' }]), key).components.get('adm')).toBe(ADMIN_LISTENER_ID)
  })
})

describe('a load balancer named after what it fronts', () => {
  it('stays unmatched when a pass-through alias names it better than any key alias, so it can stand as the bridge', () => {
    const k = {
      ...key, decoys: [],
      components: [{ id: 'c-frontend', aliases: ['frontend'], class_ids: [], discovery: 'normal', zone_allowed: [] }],
      pass_through: { rule: '', flows: [], classes: [], aliases: ['frontend-external', 'network load balancer'] },
    } as unknown as ExpectedKey
    const r: RunModel = {
      components: [
        { id: 'n1', name: 'frontend', boundaryId: 'b1' },
        { id: 'n2', name: 'frontend-external', boundaryId: 'b1' },
        { id: 'n3', name: 'Frontend network load balancer', boundaryId: 'b1' },
      ],
      boundaries: [{ id: 'b1', name: 'all', parentId: 'root', componentIds: ['n1', 'n2', 'n3'] }], flows: [], dataItems: [],
    } as unknown as RunModel
    const m = matchModel(r, k)
    expect(m.components.get('n1')).toBe('c-frontend')
    expect(m.components.has('n2')).toBe(false)
    expect(m.components.has('n3')).toBe(false)
    // Without a pass-through, the name still matches the key component.
    expect(matchModel(r, { ...k, pass_through: undefined } as ExpectedKey).components.get('n2')).toBe('c-frontend')
  })

  it('keeps a component the key component allows, however it is named', () => {
    const CWP = 'cwp-class', WEB = 'web-class', LB = 'lb-class', DB = 'db-class'
    const k = {
      ...key, decoys: [],
      components: [{ id: 'c-frontend', aliases: ['frontend'], type: 'PROCESS', class_ids: [CWP], class_alternates: [WEB], discovery: 'normal', zone_allowed: [] }],
      pass_through: { rule: '', flows: [], classes: [{ id: LB, name: 'Load Balancer' }], aliases: ['frontend (LoadBalancer Service)', 'frontend-external'] },
    } as unknown as ExpectedKey
    const name = 'frontend (LoadBalancer Service)'
    const one = (c: Partial<RunModel['components'][number]>) => matchModel({
      components: [{ id: 'n1', name, boundaryId: 'b1', ...c }],
      boundaries: [{ id: 'b1', name: 'all', parentId: 'root', componentIds: ['n1'] }], flows: [], dataItems: [],
    } as unknown as RunModel, k, { byClass: false }).components.get('n1')
    expect(one({ classId: CWP })).toBe('c-frontend')
    expect(one({ classId: WEB })).toBe('c-frontend')
    expect(one({ type: 'PROCESS' })).toBe('c-frontend')
    expect(one({ classId: LB })).toBeUndefined()
    expect(one({ classId: DB })).toBeUndefined()
    expect(one({ type: 'EXTERNAL_ENTITY' })).toBeUndefined()
    expect(one({})).toBeUndefined()
    // A key component with no class constrains none, but a pass-through class is never its kind.
    const open = { ...k, components: [{ ...k.components[0]!, class_ids: [], class_alternates: [] }] } as unknown as ExpectedKey
    const m = matchModel({
      components: [{ id: 'n1', name, classId: LB, boundaryId: 'b1' }, { id: 'n2', name, classId: DB, boundaryId: 'b1' }],
      boundaries: [{ id: 'b1', name: 'all', parentId: 'root', componentIds: ['n1', 'n2'] }], flows: [], dataItems: [],
    } as unknown as RunModel, open, { byClass: false })
    expect(m.components.has('n1')).toBe(false)
    expect(m.components.get('n2')).toBe('c-frontend')
  })
})
