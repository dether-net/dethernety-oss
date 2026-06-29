import type { Node } from '@vue-flow/core'

// Pure flat→tree builder for the boundary peer picker. Kept out of the component so the nesting logic
// is unit-testable without mounting the drawer. No store/gql import — operates on a plain Vue-Flow Node[].

export interface BoundaryTreeNode {
  id: string
  title: string
  node: Node
  children: BoundaryTreeNode[]
}

// Pre-order flattened row with its nesting depth — the drawer renders these as an indented v-list. A flat
// indented list (not a collapsible v-treeview) is deliberate: when picking a conduit peer every candidate
// should stay visible and searchable at once — collapsed branches would hide pickable peers. (v-treeview
// is available via vite-plugin-vuetify autoImport, as the folder dialogs use it; it's just not the right
// control for this surface.)
export interface FlatBoundaryRow {
  id: string
  title: string
  node: Node
  depth: number
}

const labelOf = (n: Node): string => ((n.data?.label as string) || n.id)

/**
 * Build the boundary nesting forest from a flat Node[] over `node.parentNode`.
 * - A `parentNode` of `''`, the default root id, a missing id, or a self-reference makes the node a **root**.
 * - Cycle-safe: a back-edge that would re-parent an ancestor under its own descendant is treated as a root
 *   (depth-capped walk), so the result is always a finite forest.
 */
export function buildBoundaryTree(boundaries: Node[], defaultRootId: string): BoundaryTreeNode[] {
  const byId = new Map<string, BoundaryTreeNode>()
  for (const n of boundaries) {
    byId.set(n.id, { id: n.id, title: labelOf(n), node: n, children: [] })
  }

  // Resolve the in-set parent id: '' / default-root / not-a-boundary → no parent (root).
  const parentIdOf = (id: string): string => {
    const n = byId.get(id)?.node
    const p = (n?.parentNode as string | undefined) ?? ''
    return p === '' || p === defaultRootId || !byId.has(p) ? '' : p
  }

  // a is an ancestor of b iff walking b's parent chain reaches a (bounded so a cycle can't loop forever).
  const isAncestor = (a: string, b: string): boolean => {
    let cur = parentIdOf(b)
    for (let i = 0; cur && i <= boundaries.length; i++) {
      if (cur === a) return true
      cur = parentIdOf(cur)
    }
    return false
  }

  const roots: BoundaryTreeNode[] = []
  for (const n of boundaries) {
    const pid = parentIdOf(n.id)
    const parent = pid ? byId.get(pid) : undefined
    if (!parent || pid === n.id || isAncestor(n.id, pid)) {
      roots.push(byId.get(n.id)!)
    } else {
      parent.children.push(byId.get(n.id)!)
    }
  }
  return roots
}

// Mirrors the server-side BELONGS_TO*1..50 ceiling and effectiveZone's bounded walk — guards against an
// unhydrated parent chain or a cycle looping forever.
const MAX_ANCESTOR_DEPTH = 50

/**
 * True iff `ancestorId` is a **containment ancestor** of `descendantId` — i.e. walking `descendantId`'s
 * `node.parentNode` chain reaches `ancestorId`. A boundary is **not** its own ancestor (returns false when
 * the ids are equal). Pure: takes a `getBoundary` lookup (wire it to `flowStore.boundaryById` at the call
 * site) so it stays store-free and unit-testable. Cycle-safe (seen-set + depth cap); a `parentNode` of `''`
 * or null ends the walk (a root). Used by the picker's nested-conduit warning (warn-not-block).
 */
export function isAncestorBoundary(
  ancestorId: string,
  descendantId: string,
  getBoundary: (id: string) => Node | null | undefined,
): boolean {
  if (!ancestorId || !descendantId || ancestorId === descendantId) return false
  const seen = new Set<string>()
  // Start one hop up from the descendant — a node is never its own ancestor.
  let cur = ((getBoundary(descendantId)?.parentNode as string | undefined) ?? '') || ''
  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth++) {
    if (!cur || seen.has(cur)) break
    if (cur === ancestorId) return true
    seen.add(cur)
    cur = ((getBoundary(cur)?.parentNode as string | undefined) ?? '') || ''
  }
  return false
}

/** Pre-order flatten with depth, so children render directly under their parent, indented. */
export function flattenBoundaryTree(roots: BoundaryTreeNode[]): FlatBoundaryRow[] {
  const out: FlatBoundaryRow[] = []
  const walk = (nodes: BoundaryTreeNode[], depth: number) => {
    for (const t of nodes) {
      out.push({ id: t.id, title: t.title, node: t.node, depth })
      if (t.children.length) walk(t.children, depth + 1)
    }
  }
  walk(roots, 0)
  return out
}
