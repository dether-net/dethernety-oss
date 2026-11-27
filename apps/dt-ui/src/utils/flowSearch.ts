import type { Edge, Node } from '@vue-flow/core'
import { normalise, rankName } from './nameMatch'

/** One element the canvas search found. `type` is the node type, or `FLOW` for a data flow. */
export interface CanvasSearchResult {
  id: string
  kind: 'component' | 'boundary' | 'flow'
  type: string
  name: string
  /** Where it is: the boundary that holds a component or boundary, or a flow's two ends ("web → db"). */
  context: string
}

const KIND_ORDER = { component: 0, boundary: 1, flow: 2 } as const

/**
 * The canvas's components, boundaries and data flows whose name contains `query`, best first: the whole name, then the
 * name's start, then a word's start, then anywhere; within a rank by name, then components before boundaries before
 * flows. Matching ignores case, accents and repeated whitespace. An empty query, and an element with no name, find
 * nothing. The default boundary is not a canvas node, so it is never a result; `rootLabel` is its name, the context of
 * what sits at the root.
 */
export function searchCanvas(
  query: string,
  nodes: Node[],
  edges: Edge[],
  rootLabel: string,
): CanvasSearchResult[] {
  const q = normalise(query)
  if (!q) return []

  const labelOf = new Map<string, string>(nodes.map(n => [n.id, String(n.data?.label ?? '')]))
  const nameOf = (id: string) => labelOf.get(id) || id

  const found: { result: CanvasSearchResult, rank: number, key: string }[] = []
  const consider = (result: CanvasSearchResult) => {
    const key = normalise(result.name)
    const r = key ? rankName(key, q) : null
    if (r !== null) found.push({ result, rank: r, key })
  }

  for (const node of nodes) {
    consider({
      id: node.id,
      kind: node.type === 'BOUNDARY' ? 'boundary' : 'component',
      type: node.type ?? '',
      name: labelOf.get(node.id) ?? '',
      context: node.parentNode ? nameOf(node.parentNode) : rootLabel,
    })
  }
  for (const edge of edges) {
    consider({
      id: edge.id,
      kind: 'flow',
      type: 'FLOW',
      name: typeof edge.label === 'string' ? edge.label : '',
      context: `${nameOf(edge.source)} → ${nameOf(edge.target)}`,
    })
  }

  return found
    .sort((a, b) =>
      a.rank - b.rank
      || a.key.localeCompare(b.key)
      || KIND_ORDER[a.result.kind] - KIND_ORDER[b.result.kind]
      || a.result.id.localeCompare(b.result.id))
    .map(f => f.result)
}
