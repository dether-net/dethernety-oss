import type { Edge, Node } from '@vue-flow/core'

/** The settings window's tabs, by their own `v-tab` values. */
export const SETTINGS_TABS = ['general', 'zoning', 'attributes', 'data', 'controls', 'exposures'] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

const isNode = (item: Node | Edge | null | undefined): item is Node =>
  item !== null && typeof item === 'object' && 'type' in item && 'position' in item

/**
 * Whether the settings window shows `tab` for `item`. Only Zoning is conditional: it shows for a boundary that is not
 * the model's default (root) boundary.
 */
export function isSettingsTabShown(tab: SettingsTab, item: Node | Edge | null | undefined, defaultBoundaryId?: string): boolean {
  if (tab !== 'zoning') return true
  return isNode(item) && item.type === 'BOUNDARY' && item.id !== defaultBoundaryId
}

export interface EditorLinkTarget {
  item: Node | Edge
  /** A canvas node, a data flow (an edge), or the default boundary (not on the canvas). */
  kind: 'node' | 'edge' | 'default-boundary'
  /** The canvas nodes to frame: the node itself, or a flow's two endpoints; none for the default boundary. */
  focusNodeIds: string[]
  /** The settings tab to open on, when the link names one this element shows. */
  tab: SettingsTab | null
}

/** A query value that is one non-empty string; a repeated parameter (an array) or anything else is not. */
const single = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)

/**
 * What a `/dataflow?id=<model>&element=<id>&tab=<name>` link asks for, resolved against the loaded model only: an id
 * that is not one of its components, boundaries or data flows (another model's, a data item's, a deleted one) resolves
 * to nothing. Values are only compared, never used as keys or interpolated anywhere. A tab outside SETTINGS_TABS, or
 * one this element does not show, is dropped: the link then only selects.
 */
export function resolveEditorLink(
  query: { element?: unknown, tab?: unknown },
  model: { nodes: Node[], edges: Edge[], defaultBoundary: Node | null, defaultBoundaryId?: string },
): EditorLinkTarget | null {
  const element = single(query.element)
  if (!element) return null

  let target: Omit<EditorLinkTarget, 'tab'> | null = null
  const node = model.nodes.find(n => n.id === element)
  if (node) {
    target = { item: node, kind: 'node', focusNodeIds: [node.id] }
  } else {
    const edge = model.edges.find(e => e.id === element)
    if (edge) {
      target = { item: edge, kind: 'edge', focusNodeIds: [edge.source, edge.target] }
    } else if (
      model.defaultBoundaryId
      && model.defaultBoundaryId === element
      && model.defaultBoundary?.id === element
    ) {
      // Matched through the loaded model's own id: the store keeps the last root boundary object after a failed load.
      target = { item: model.defaultBoundary, kind: 'default-boundary', focusNodeIds: [] }
    }
  }
  if (!target) return null

  const requested = single(query.tab)
  const tab = requested && (SETTINGS_TABS as readonly string[]).includes(requested)
    && isSettingsTabShown(requested as SettingsTab, target.item, model.defaultBoundaryId)
    ? requested as SettingsTab
    : null
  return { ...target, tab }
}
