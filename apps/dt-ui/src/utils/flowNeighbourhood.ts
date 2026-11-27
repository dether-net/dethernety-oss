import type { Edge, Node } from '@vue-flow/core'

/** The node types a data flow can start or end at. Boundaries hold components; they are not one end of a flow. */
const COMPONENT_TYPES = new Set(['PROCESS', 'STORE', 'EXTERNAL_ENTITY'])

/**
 * What the canvas brings forward for the current selection; everything else is dimmed.
 * - A component: the flows into it (`inEdgeIds`), the flows out of it (`outEdgeIds`) and the components at their
 *   other ends (`nodeIds`).
 * - A data flow: the flow itself and the two components it joins (`nodeIds`).
 */
export interface FlowNeighbourhood {
  focusId: string
  focusKind: 'component' | 'flow'
  inEdgeIds: string[]
  outEdgeIds: string[]
  /** The neighbouring components, without the focus itself. */
  nodeIds: string[]
}

/**
 * The neighbourhood of `selected`, read from the canvas as it is now: a selection that is a boundary, nothing, or an
 * id no longer on the canvas (deleted, or a stale reference) has none. A flow from a component to itself counts as
 * outbound.
 */
export function neighbourhood(
  selected: { id?: string } | null | undefined,
  nodes: Node[],
  edges: Edge[],
): FlowNeighbourhood | null {
  const id = selected?.id
  if (!id) return null

  const node = nodes.find(n => n.id === id)
  if (node) {
    if (!COMPONENT_TYPES.has(node.type ?? '')) return null
    const inEdgeIds: string[] = []
    const outEdgeIds: string[] = []
    const neighbours = new Set<string>()
    for (const edge of edges) {
      if (edge.source === id) {
        outEdgeIds.push(edge.id)
        if (edge.target !== id) neighbours.add(edge.target)
      } else if (edge.target === id) {
        inEdgeIds.push(edge.id)
        neighbours.add(edge.source)
      }
    }
    return { focusId: id, focusKind: 'component', inEdgeIds, outEdgeIds, nodeIds: [...neighbours] }
  }

  const edge = edges.find(e => e.id === id)
  if (edge) {
    const nodeIds = edge.source === edge.target ? [edge.source] : [edge.source, edge.target]
    return { focusId: id, focusKind: 'flow', inEdgeIds: [], outEdgeIds: [], nodeIds }
  }

  return null
}

/** The marker ids the direction styles point `marker-end` at; DataFlow.vue defines both markers. */
export const FLOW_ARROW_IN = 'dt-flow-arrow-in'
export const FLOW_ARROW_OUT = 'dt-flow-arrow-out'

/**
 * A CSS string value: the id is compared as a quoted attribute value, so only what could end the string or the rule
 * is escaped. Ids are server-issued; this keeps an unexpected one from changing the stylesheet.
 */
const cssString = (value: string): string =>
  `"${value.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\a ').replace(/\r/g, '\\d ').replace(/\f/g, '\\c ')}"`

const nodeSel = (id: string) => `.dt-flow-focus .vue-flow__node[data-id=${cssString(id)}]`
const edgeSel = (id: string) => `.dt-flow-focus .vue-flow__edge[data-id=${cssString(id)}]`

/**
 * The rules that bring a neighbourhood forward. The dimming itself is static (main.css, under `.dt-flow-focus`, at
 * `:where()` specificity), so these only need to name the elements that stay lit.
 */
export function neighbourhoodCss(n: FlowNeighbourhood | null): string {
  if (!n) return ''
  const rules: string[] = []
  const lit = (selectors: string[], body: string) => {
    if (selectors.length) rules.push(`${selectors.join(',\n')} { ${body} }`)
  }

  const focusNode = n.focusKind === 'component' ? [nodeSel(n.focusId)] : []
  const focusEdge = n.focusKind === 'flow' ? [edgeSel(n.focusId)] : []
  lit([...focusNode, ...n.nodeIds.map(nodeSel), ...focusEdge, ...[...n.inEdgeIds, ...n.outEdgeIds].map(edgeSel)], 'opacity: 1;')
  lit(n.nodeIds.map(nodeSel), 'outline: 2px solid rgba(var(--v-theme-on-background), 0.7); outline-offset: 3px;')
  lit(focusEdge.map(s => `${s} .vue-flow__edge-path`), 'stroke: rgb(var(--v-theme-on-background)); stroke-width: 3;')
  lit(
    n.inEdgeIds.map(id => `${edgeSel(id)} .vue-flow__edge-path`),
    `stroke: rgb(var(--v-theme-flow-in)); stroke-width: 3; marker-end: url(#${FLOW_ARROW_IN});`,
  )
  lit(
    n.outEdgeIds.map(id => `${edgeSel(id)} .vue-flow__edge-path`),
    `stroke: rgb(var(--v-theme-flow-out)); stroke-width: 3; marker-end: url(#${FLOW_ARROW_OUT});`,
  )
  return rules.join('\n')
}
