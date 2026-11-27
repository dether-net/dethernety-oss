import { describe, it, expect } from 'vitest'
import type { Edge, Node } from '@vue-flow/core'
import { FLOW_ARROW_IN, FLOW_ARROW_OUT, neighbourhood, neighbourhoodCss } from '../flowNeighbourhood'

const node = (id: string, type: string): Node => ({ id, type, position: { x: 0, y: 0 }, data: { label: id } })
const edge = (id: string, source: string, target: string): Edge => ({ id, source, target })

// web → api → db, client → web, api ↔ cache (a flow each way), web inside the dmz boundary
const nodes = [
  node('client', 'EXTERNAL_ENTITY'),
  node('web', 'PROCESS'),
  node('api', 'PROCESS'),
  node('db', 'STORE'),
  node('cache', 'STORE'),
  node('dmz', 'BOUNDARY'),
]
const edges = [
  edge('f-client-web', 'client', 'web'),
  edge('f-web-api', 'web', 'api'),
  edge('f-api-db', 'api', 'db'),
  edge('f-api-cache', 'api', 'cache'),
  edge('f-cache-api', 'cache', 'api'),
]

describe('neighbourhood', () => {
  it('splits a component\'s flows into inbound and outbound, and lists the components at their other ends', () => {
    expect(neighbourhood({ id: 'api' }, nodes, edges)).toEqual({
      focusId: 'api',
      focusKind: 'component',
      inEdgeIds: ['f-web-api', 'f-cache-api'],
      outEdgeIds: ['f-api-db', 'f-api-cache'],
      nodeIds: ['web', 'db', 'cache'],
    })
  })

  it('lists a component on both sides of the focus once', () => {
    const n = neighbourhood({ id: 'api' }, nodes, edges)
    expect(n?.nodeIds.filter(id => id === 'cache')).toEqual(['cache'])
  })

  it('reads every component type a flow can join', () => {
    expect(neighbourhood({ id: 'client' }, nodes, edges)?.outEdgeIds).toEqual(['f-client-web'])
    expect(neighbourhood({ id: 'db' }, nodes, edges)?.inEdgeIds).toEqual(['f-api-db'])
  })

  it('gives a component with no flows a neighbourhood of itself alone', () => {
    const lone = [...nodes, node('lone', 'PROCESS')]
    expect(neighbourhood({ id: 'lone' }, lone, edges)).toEqual({
      focusId: 'lone', focusKind: 'component', inEdgeIds: [], outEdgeIds: [], nodeIds: [],
    })
  })

  it('counts a flow from a component to itself as outbound, without listing the component as its own neighbour', () => {
    const loop = [...edges, edge('f-web-web', 'web', 'web')]
    const n = neighbourhood({ id: 'web' }, nodes, loop)
    expect(n?.outEdgeIds).toContain('f-web-web')
    expect(n?.inEdgeIds).not.toContain('f-web-web')
    expect(n?.nodeIds).not.toContain('web')
  })

  it('gives a data flow its two ends', () => {
    expect(neighbourhood({ id: 'f-web-api' }, nodes, edges)).toEqual({
      focusId: 'f-web-api', focusKind: 'flow', inEdgeIds: [], outEdgeIds: [], nodeIds: ['web', 'api'],
    })
  })

  it('gives a data flow from a component to itself one end', () => {
    const loop = [edge('f-web-web', 'web', 'web')]
    expect(neighbourhood({ id: 'f-web-web' }, nodes, loop)?.nodeIds).toEqual(['web'])
  })

  it('has none for a boundary, for nothing selected, or for an id no longer on the canvas', () => {
    expect(neighbourhood({ id: 'dmz' }, nodes, edges)).toBeNull()
    expect(neighbourhood(null, nodes, edges)).toBeNull()
    expect(neighbourhood(undefined, nodes, edges)).toBeNull()
    expect(neighbourhood({}, nodes, edges)).toBeNull()
    // the default boundary, deleted elements and stale references are not on the canvas
    expect(neighbourhood({ id: 'root' }, nodes, edges)).toBeNull()
  })

  it('reads the canvas as it is now, not the selected object', () => {
    // a stale selected object (an older snapshot of the flow) still resolves through the live edge's ends
    const rerouted = edges.map(e => (e.id === 'f-web-api' ? edge('f-web-api', 'web', 'db') : e))
    expect(neighbourhood({ id: 'f-web-api' }, nodes, rerouted)?.nodeIds).toEqual(['web', 'db'])
  })
})

describe('neighbourhoodCss', () => {
  it('is empty without a neighbourhood', () => {
    expect(neighbourhoodCss(null)).toBe('')
  })

  it('lights a component, its neighbours and its flows, and colours the flows by direction', () => {
    const css = neighbourhoodCss(neighbourhood({ id: 'web' }, nodes, edges))
    for (const id of ['web', 'client', 'api']) expect(css).toContain(`.vue-flow__node[data-id="${id}"]`)
    expect(css).not.toContain('[data-id="db"]')

    const rule = (selectorPart: string) => css.split('\n').find(line => line.includes(selectorPart) && line.includes('{'))
    expect(rule('[data-id="f-client-web"] .vue-flow__edge-path')).toContain(`marker-end: url(#${FLOW_ARROW_IN})`)
    expect(rule('[data-id="f-client-web"] .vue-flow__edge-path')).toContain('--v-theme-flow-in')
    expect(rule('[data-id="f-web-api"] .vue-flow__edge-path')).toContain(`marker-end: url(#${FLOW_ARROW_OUT})`)
    expect(rule('[data-id="f-web-api"] .vue-flow__edge-path')).toContain('--v-theme-flow-out')
  })

  it('outlines the neighbours, not the focus', () => {
    const css = neighbourhoodCss(neighbourhood({ id: 'web' }, nodes, edges))
    const outline = css.split('\n\n').join('\n').split('}').find(rule => rule.includes('outline:')) ?? ''
    expect(outline).toContain('[data-id="client"]')
    expect(outline).toContain('[data-id="api"]')
    expect(outline).not.toContain('[data-id="web"]')
  })

  it('lights a selected flow and its ends, with no direction colours', () => {
    const css = neighbourhoodCss(neighbourhood({ id: 'f-web-api' }, nodes, edges))
    expect(css).toContain('.vue-flow__edge[data-id="f-web-api"]')
    expect(css).toContain('.vue-flow__node[data-id="web"]')
    expect(css).toContain('.vue-flow__node[data-id="api"]')
    expect(css).not.toContain('flow-in')
    expect(css).not.toContain('flow-out')
  })

  it('escapes an id so it cannot end the attribute string or the rule', () => {
    const hostile = 'x"] {} body { display: none } [data-id="\\\n'
    const css = neighbourhoodCss({ focusId: hostile, focusKind: 'component', inEdgeIds: [], outEdgeIds: [], nodeIds: [] })
    expect(css).toBe('.dt-flow-focus .vue-flow__node[data-id="x\\"] {} body { display: none } [data-id=\\"\\\\\\a "] { opacity: 1; }')
  })
})
