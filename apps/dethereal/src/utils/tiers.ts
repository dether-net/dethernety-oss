/**
 * Component tiers: the one definition every gate, report and prompt uses.
 *
 * - **Tier 1** — internet-facing: an endpoint of a cross-boundary flow that sits
 *   in a declared or inherited PUBLIC or EXPOSED zone, or that exchanges a flow
 *   with an external entity outside a VENDOR zone.
 * - **Tier 2** — crown-jewel-bearing or RESTRICTED: `crownJewel: true`, a
 *   RESTRICTED zone, a mapped crown-jewel data item in `dataItemIds`, or a place
 *   inside a mapped boundary.
 * - **Tier 3** — every other non-external component, including unzoned ones.
 *
 * External entities are never tiered. Only declared or inherited zones count:
 * the zoning engine's proposed zones are advice for the operator, and a gate
 * that tiered on them would override what the operator declared. The
 * external-entity rule is what keeps "declare every boundary INTERNAL" from
 * emptying Tier 1 — an external entity is outside the trust boundary whatever
 * zone it is drawn in, unless it is declared a vetted vendor.
 */
import { buildZoningContext, determineZoneTier, flattenStructure, isStructuralContainer, resolveEffectiveZone } from '@dethernety/dt-core'
import type { DataFlow, SchemaDataItem as DataItem, ModelStructure, StructureComponent, Zone } from '@dethernety/dt-core'

export type Tier = 1 | 2 | 3

export interface TierInput {
  structure: ModelStructure
  dataFlows: DataFlow[]
  dataItems: DataItem[]
  /** Element ids named by the crown-jewel map (`scope.json` `crown_jewel_elements`). */
  crownJewelIds?: ReadonlySet<string>
}

export interface Tiering {
  /** Tier of every non-external component. */
  tierOf: Map<string, Tier>
  /** External-entity component ids. */
  externals: Set<string>
  /** Components by id (all, externals included). */
  components: Map<string, StructureComponent>
  /** Ids of the flows that cross a boundary. */
  crossBoundaryFlowIds: Set<string>
  /** Non-external components whose zone is neither declared nor inherited. */
  unzoned: string[]
  /** Where an endpoint sits: a component's parent boundary, or a boundary itself. */
  locationOf(id: string | undefined): string | undefined
  /** Declared or inherited zone of a boundary; `null` when unzoned. */
  boundaryZone(boundaryId: string | undefined): Zone | null
  /**
   * Zone of a flow endpoint. An external entity reads as VENDOR when declared
   * so, and UNTRUSTED otherwise.
   */
  endpointZone(id: string | undefined): Zone | null
}

const isExternal = (c: StructureComponent | undefined): boolean => c?.type === 'EXTERNAL_ENTITY'

export function classifyTiers(input: TierInput): Tiering {
  const { structure, dataFlows } = input
  const mapped = input.crownJewelIds ?? new Set<string>()
  const { components: flat, parentMap } = flattenStructure(structure)
  const ctx = buildZoningContext(structure, dataFlows, input.dataItems)

  const components = new Map(flat.map((c) => [c.id, c]))
  const externals = new Set(flat.filter(isExternal).map((c) => c.id))

  const zoneCache = new Map<string, Zone | null>()
  const boundaryZone = (boundaryId: string | undefined): Zone | null => {
    if (!boundaryId || !ctx.boundariesById.has(boundaryId)) return null
    let zone = zoneCache.get(boundaryId)
    if (zone === undefined) {
      const resolved = resolveEffectiveZone(boundaryId, ctx.boundariesById, ctx.defaultBoundaryId)
      zone = resolved.source === 'default' ? null : resolved.zone
      zoneCache.set(boundaryId, zone)
    }
    return zone
  }
  const locationOf = (id: string | undefined): string | undefined => {
    if (!id) return undefined
    if (components.has(id)) return parentMap.get(id) ?? undefined
    return ctx.boundariesById.has(id) ? id : undefined
  }
  const endpointZone = (id: string | undefined): Zone | null => {
    const c = id ? components.get(id) : undefined
    if (c && isExternal(c)) return boundaryZone(parentMap.get(c.id) ?? undefined) === 'VENDOR' ? 'VENDOR' : 'UNTRUSTED'
    return boundaryZone(locationOf(id))
  }

  const crossBoundaryFlowIds = new Set<string>()
  const crossEndpoints = new Set<string>()
  const externalFacing = new Set<string>()
  for (const flow of dataFlows) {
    const s = flow.source?.id
    const t = flow.target?.id
    const ls = locationOf(s)
    const lt = locationOf(t)
    if (ls === undefined || lt === undefined) continue
    const sc = components.get(s!)
    const tc = components.get(t!)
    if (ls !== lt || isExternal(sc) !== isExternal(tc)) {
      crossBoundaryFlowIds.add(flow.id)
      crossEndpoints.add(s!)
      crossEndpoints.add(t!)
    }
    for (const [self, other] of [[sc, tc], [tc, sc]] as const) {
      if (self && other && !isExternal(self) && isExternal(other) && endpointZone(other.id) !== 'VENDOR') {
        externalFacing.add(self.id)
      }
    }
  }

  const insideMapped = (componentId: string): boolean => {
    const seen = new Set<string>()
    let cur = parentMap.get(componentId) ?? null
    while (cur && !seen.has(cur)) {
      if (mapped.has(cur)) return true
      seen.add(cur)
      cur = parentMap.get(cur) ?? null
    }
    return false
  }

  const tierOf = new Map<string, Tier>()
  const unzoned: string[] = []
  for (const c of flat) {
    if (isExternal(c)) continue
    const zone = boundaryZone(parentMap.get(c.id) ?? undefined)
    if (zone === null) unzoned.push(c.id)
    if (crossEndpoints.has(c.id) && (zone === 'PUBLIC' || zone === 'EXPOSED' || externalFacing.has(c.id))) {
      tierOf.set(c.id, 1)
    } else if (
      c.crownJewel === true ||
      zone === 'RESTRICTED' ||
      (c.dataItemIds ?? []).some((id) => mapped.has(id)) ||
      insideMapped(c.id)
    ) {
      tierOf.set(c.id, 2)
    } else {
      tierOf.set(c.id, 3)
    }
  }

  return { tierOf, externals, components, crossBoundaryFlowIds, unzoned, locationOf, boundaryZone, endpointZone }
}

/**
 * The `cross_boundary` label: non-external components outside Tier 1 at one end
 * of a cross-boundary flow whose other end is a non-external component (the
 * east-west pivots). A label, never a tier: it overlaps the tiers.
 */
export function crossBoundaryComponentIds(tiering: Tiering, dataFlows: ReadonlyArray<{ id: string; source?: { id?: string }; target?: { id?: string } }>): Set<string> {
  const out = new Set<string>()
  const internal = (id: string | undefined): id is string => !!id && tiering.components.has(id) && !tiering.externals.has(id)
  for (const f of dataFlows) {
    if (!tiering.crossBoundaryFlowIds.has(f.id)) continue
    const [s, t] = [f.source?.id, f.target?.id]
    if (!internal(s) || !internal(t)) continue
    for (const id of [s, t]) if ((tiering.tierOf.get(id) ?? 3) !== 1) out.add(id)
  }
  return out
}

/**
 * The zone tier the engine proposes for a boundary, with one rule of the server's own: a boundary whose own
 * attributes say it allows any inbound traffic (`allow_any_inbound: true`) is PUBLIC, whatever the engine read
 * from its flows, since exposure outranks what it holds. External entities keep their tier, and a structural
 * container abstains. The engine's findings and its one-hop EXPOSED of neighbours do not see this rule.
 */
export function proposedZoneTier(
  boundary: Parameters<typeof determineZoneTier>[0],
  ctx: Parameters<typeof determineZoneTier>[1],
  allowAnyInbound: unknown,
): ReturnType<typeof determineZoneTier> {
  const tier = determineZoneTier(boundary, ctx)
  if (allowAnyInbound !== true || isStructuralContainer(boundary) || ['VENDOR', 'UNTRUSTED', 'PUBLIC'].includes(tier.tier)) return tier
  return { tier: 'PUBLIC', reason: 'allows any inbound traffic (allow_any_inbound: true)' }
}
