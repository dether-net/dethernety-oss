import { describe, it, expect } from 'vitest'
import type { Edge, Node } from '@vue-flow/core'
import { normalise, searchCanvas } from '../flowSearch'

const node = (id: string, type: string, label: string, parentNode = ''): Node =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label }, parentNode })
const edge = (id: string, source: string, target: string, label: string): Edge => ({ id, source, target, label })

const nodes = [
  node('dmz', 'BOUNDARY', 'DMZ'),
  node('api', 'PROCESS', 'API', 'dmz'),
  node('api-gw', 'PROCESS', 'API Gateway', 'dmz'),
  node('pay', 'PROCESS', 'Payment API'),
  node('rapid', 'PROCESS', 'Rapid ingest'),
  node('cafe', 'STORE', 'Café orders'),
  node('user', 'EXTERNAL_ENTITY', 'User'),
]
const edges = [
  edge('f1', 'user', 'api-gw', 'HTTPS request'),
  edge('f2', 'api-gw', 'pay', 'API call'),
]
const ids = (q: string) => searchCanvas(q, nodes, edges, 'Default boundary').map(r => r.id)

describe('normalise', () => {
  it('drops accents, folds case and collapses whitespace', () => {
    expect(normalise('  Café   ORDERS ')).toBe('cafe orders')
    expect(normalise('Ångström')).toBe('angstrom')
  })
})

describe('searchCanvas', () => {
  it('finds nothing for an empty or blank query', () => {
    expect(searchCanvas('', nodes, edges, 'Default boundary')).toEqual([])
    expect(searchCanvas('   ', nodes, edges, 'Default boundary')).toEqual([])
  })

  it('ranks the whole name, then its start, then a word\'s start, then anywhere', () => {
    // "API": API (whole), API Gateway, API call (start), Payment API (word), Rapid ingest (inside a word)
    expect(ids('api')).toEqual(['api', 'f2', 'api-gw', 'pay', 'rapid'])
  })

  it('orders within a rank by name, then components before boundaries before flows', () => {
    const tie = [node('b', 'BOUNDARY', 'Edge'), node('c', 'PROCESS', 'Edge')]
    expect(searchCanvas('edge', tie, [edge('e', 'b', 'c', 'Edge')], 'Root').map(r => r.id)).toEqual(['c', 'b', 'e'])
  })

  it('ignores case and accents on both sides', () => {
    expect(ids('CAFE')).toEqual(['cafe'])
    expect(ids('café')).toEqual(['cafe'])
  })

  it('collapses whitespace in the query', () => {
    expect(ids('api    gateway')).toEqual(['api-gw'])
  })

  it('reports each result\'s kind, type and where it is', () => {
    const [gw] = searchCanvas('gateway', nodes, edges, 'Root')
    expect(gw).toEqual({ id: 'api-gw', kind: 'component', type: 'PROCESS', name: 'API Gateway', context: 'DMZ' })
    const [dmz] = searchCanvas('dmz', nodes, edges, 'Root')
    expect(dmz).toMatchObject({ kind: 'boundary', type: 'BOUNDARY', context: 'Root' })
    const [flow] = searchCanvas('https', nodes, edges, 'Root')
    expect(flow).toEqual({ id: 'f1', kind: 'flow', type: 'FLOW', name: 'HTTPS request', context: 'User → API Gateway' })
  })

  it('names what sits at the root by the root label it is given', () => {
    expect(searchCanvas('user', nodes, edges, 'The model')[0].context).toBe('The model')
  })

  it('falls back to the id for a flow end it cannot name', () => {
    const [flow] = searchCanvas('orphan', nodes, [edge('f9', 'gone', 'api', 'Orphan flow')], 'Root')
    expect(flow.context).toBe('gone → API')
  })

  it('skips an element with no name', () => {
    const unnamed = [node('x', 'PROCESS', ''), { id: 'y', type: 'STORE', position: { x: 0, y: 0 }, data: {} } as Node]
    expect(searchCanvas('x', unnamed, [{ id: 'z', source: 'x', target: 'y' }], 'Root')).toEqual([])
  })

  it('returns every match, not only the first page', () => {
    const many = Array.from({ length: 80 }, (_, i) => node(`n${i}`, 'PROCESS', `Worker ${i}`))
    expect(searchCanvas('worker', many, [], 'Root')).toHaveLength(80)
  })
})
