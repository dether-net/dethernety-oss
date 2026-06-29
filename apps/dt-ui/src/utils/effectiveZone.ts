import type { Node } from '@vue-flow/core'
import type { Zone } from '@dethernety/dt-core'

/**
 * The zone a boundary effectively has, after inheritance:
 * a boundary with `zone === null` inherits the nearest ancestor's declared zone.
 * This is pure tree-walking over the Vue-Flow graph — no backend, no analysis.
 */
export type EffectiveZone = {
  zone: Zone
  source: 'declared' | 'inherited' | 'default'
  from?: string // ancestor boundary id when source === 'inherited'
}

// Fallback when no ancestor declares a zone.
export const DEFAULT_ZONE: Zone = 'INTERNAL'

// Mirrors the BELONGS_TO*1..50 traversal ceiling used server-side.
const MAX_DEPTH = 50

/**
 * Resolve the effective zone of a boundary by walking `node.parentNode`
 * (`'' | null` → the default boundary) up to the nearest node with a non-null
 * `data.zone`. Returns `INTERNAL`/`'default'` when none is found or the walk
 * hits an unhydrated ancestor (a known lazy-canvas display inaccuracy this round).
 *
 * `getBoundary` resolves a boundary id to its node (the store's `boundaryById`,
 * which also returns the default boundary). Cycles and runaway depth are guarded.
 */
export function resolveEffectiveZone(
  boundaryId: string,
  getBoundary: (id: string) => Node | null | undefined,
  defaultBoundaryId: string,
): EffectiveZone {
  const seen = new Set<string>()
  let currentId = boundaryId

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (!currentId || seen.has(currentId)) break // empty id or cycle (incl. root self-loop)
    seen.add(currentId)

    const node = getBoundary(currentId)
    if (!node) break // unhydrated ancestor → fall through to default

    const zone = node.data?.zone as Zone | null | undefined
    if (zone != null) {
      return currentId === boundaryId
        ? { zone, source: 'declared' }
        : { zone, source: 'inherited', from: currentId }
    }

    const parent = node.parentNode
    currentId = parent == null || parent === '' ? defaultBoundaryId : parent
  }

  return { zone: DEFAULT_ZONE, source: 'default' }
}
