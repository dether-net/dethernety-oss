/**
 * Pure boundary-zone determination — the inheritance resolver, the 4-tier trust cascade, and the
 * conduit-independent coherence findings. No I/O, no Apollo, no Vue-Flow: a deterministic leaf module
 * over a *given* `ZoningContext` (building that context from a model is a separate concern).
 *
 * Implements the trust-zoning determination model — the cascade, coherence findings, and
 * default-then-promote (see oss/docs/architecture/dethereal/TRUST_ZONING.md). The
 * resolver mirrors dt-ui's `effectiveZone.ts`, made node-agnostic over the StructureBoundary tree.
 */
import type { StructureBoundary, ModelStructure } from '../schemas/structure.schema.js'
import { flattenStructure } from '../schemas/structure.schema.js'
import type { DataFlow } from '../schemas/dataflows.schema.js'
import type { DataItem } from '../schemas/data-items.schema.js'
import type { Zone } from '../interfaces/core-types-interface.js'

// ── Inheritance resolver ──────────────────────────────────────────────────────────────────────

/** Fallback when no ancestor declares a zone (mirrors the platform/dt-ui default). */
export const DEFAULT_ZONE: Zone = 'INTERNAL'

/** Mirrors the BELONGS_TO*1..50 traversal ceiling used server-side / in dt-ui. */
const MAX_DEPTH = 50

export interface EffectiveZone {
  zone: Zone
  source: 'declared' | 'inherited' | 'default'
  /** Ancestor boundary id when `source === 'inherited'`. */
  from?: string
}

/**
 * Resolve a boundary's effective zone by walking `parentBoundary` up to the nearest boundary with a
 * non-null `zone`. `undefined`/`''` parent ⇒ the default boundary (the root self-loop then terminates
 * via the cycle guard). Returns `INTERNAL`/`'default'` on exhaustion, cycle, or a missing ancestor.
 * Node-agnostic equivalent of dt-ui `resolveEffectiveZone`.
 */
export function resolveEffectiveZone(
  boundaryId: string,
  boundariesById: Map<string, StructureBoundary>,
  defaultBoundaryId: string,
): EffectiveZone {
  const seen = new Set<string>()
  let currentId = boundaryId

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (!currentId || seen.has(currentId)) break // empty id or cycle (incl. root self-loop)
    seen.add(currentId)

    const boundary = boundariesById.get(currentId)
    if (!boundary) break // missing ancestor → fall through to default

    const zone = boundary.zone
    if (zone != null) {
      return currentId === boundaryId
        ? { zone, source: 'declared' }
        : { zone, source: 'inherited', from: currentId }
    }

    const parent = boundary.parentBoundary?.id
    currentId = parent == null || parent === '' ? defaultBoundaryId : parent
  }

  return { zone: DEFAULT_ZONE, source: 'default' }
}

// ── Determination context (the contract; the builder lives elsewhere) ─────────────────────────

export interface ZoningContext {
  boundariesById: Map<string, StructureBoundary>
  defaultBoundaryId: string
  /** Boundary→boundary one-hop reachability (intra-boundary edges dropped, default root excluded). */
  adjacency: { in: Map<string, Set<string>>; out: Map<string, Set<string>> }
  /** Boundaries bearing a high-value asset descendant (rolled up to every ancestor). EMPTY at Step 4; populated close-of-Step-7. */
  assetIds: Set<string>
  /**
   * Boundaries that DIRECTLY hold a high-value asset (no ancestor rollup) — gates the RESTRICTED promotion
   * and the `under-protected` finding, so a purely structural ancestor above an asset is not falsely flagged.
   * EMPTY at Step 4; populated close-of-Step-7. Subset of `assetIds`.
   */
  directAssetIds: Set<string>
  /** Boundaries that ARE untrusted (open/unknown) external entities. */
  externalIds: Set<string>
  /** Boundaries that ARE vetted vendor external entities. */
  vendorIds: Set<string>
}

// ── Exposure classification (staged, non-circular; exposure is NOT transitive) ────────────────

const ingressOf = (id: string, ctx: ZoningContext): Set<string> =>
  ctx.adjacency.in.get(id) ?? new Set<string>()

const isExternal = (id: string, ctx: ZoningContext): boolean =>
  ctx.externalIds.has(id) || ctx.vendorIds.has(id)

/** Directly reached by an external/vendor source — the front door itself (no front door in front). */
const isPublic = (id: string, ctx: ZoningContext): boolean => {
  if (isExternal(id, ctx)) return false
  for (const src of ingressOf(id, ctx)) if (isExternal(src, ctx)) return true
  return false
}

/** One hop behind a PUBLIC edge — the DMZ. Deeper than one hop is NOT exposed (one-hop rule). */
const isExposed = (id: string, ctx: ZoningContext): boolean => {
  if (isExternal(id, ctx) || isPublic(id, ctx)) return false
  for (const src of ingressOf(id, ctx)) if (isPublic(src, ctx)) return true
  return false
}

/** True when a source boundary is external/vendor/public/exposed — i.e. it disqualifies RESTRICTED. */
const isExposingSource = (id: string, ctx: ZoningContext): boolean =>
  isExternal(id, ctx) || isPublic(id, ctx) || isExposed(id, ctx)

// ── The cascade ───────────────────────────────────────────────────────────────────────────────

export interface ZoneTierResult {
  tier: Zone
  /** Which cascade rule fired (deterministic — "why this tier"). */
  reason: string
  /** When asset-bearing but not RESTRICTED, why it was blocked (drives the under-protected finding). */
  blockedBy?: 'exposure' | 'vendor' | 'no-ingress' | 'no-asset'
}

/**
 * Compute a boundary's intrinsic trust tier. First match wins — the order
 * IS the dependency order (exposure is resolved before the RESTRICTED ingress test reads it).
 *
 * Default-then-promote is implicit: an empty `ctx.assetIds` (Step 4) can never reach rule 3, so the
 * skeleton is external + exposure + INTERNAL; a populated `ctx.assetIds` (close of Step 7) lets rule 3
 * promote. v1 (`dedicated` cut): vendor ingress is exposing, so rule 2 catches it before rule 3.
 */
export function determineZoneTier(boundary: StructureBoundary, ctx: ZoningContext): ZoneTierResult {
  const id = boundary.id

  // Rule 1 — the external entity itself.
  if (ctx.vendorIds.has(id)) return { tier: 'VENDOR', reason: 'external entity (vetted partner)' }
  if (ctx.externalIds.has(id)) return { tier: 'UNTRUSTED', reason: 'external entity (open/unknown)' }

  // Rule 2 — reachable from an external source (exposure outranks asset pull).
  if (isPublic(id, ctx)) return { tier: 'PUBLIC', reason: 'directly reachable from an external source' }
  if (isExposed(id, ctx)) return { tier: 'EXPOSED', reason: 'reachable one hop behind a public front door (DMZ)' }

  // Rule 3 — high-value asset, isolated by POSITIVE ingress evidence. Gated on DIRECT holding
  // (directAssetIds): a purely structural ancestor above an asset does not promote — it abstains.
  if (ctx.directAssetIds.has(id)) {
    const ingress = ingressOf(id, ctx)
    if (ingress.size === 0) {
      return {
        tier: 'INTERNAL',
        reason: 'asset-bearing but no modelled ingress — cannot verify isolation',
        blockedBy: 'no-ingress',
      }
    }
    const exposingSource = [...ingress].find((src) => isExposingSource(src, ctx))
    if (exposingSource !== undefined) {
      const fromVendor = ctx.vendorIds.has(exposingSource)
      return {
        tier: 'INTERNAL',
        reason: `asset-bearing but ingress from an exposed source (${exposingSource})`,
        blockedBy: fromVendor ? 'vendor' : 'exposure',
      }
    }
    return { tier: 'RESTRICTED', reason: 'high-value asset, ingress only from internal/restricted peers' }
  }

  // Rule 4 — the residual.
  return { tier: 'INTERNAL', reason: 'internal connectivity, no qualifying asset', blockedBy: 'no-asset' }
}

// ── Coherence findings ─────────────────────────────────────────────────────────────────

export interface ZoningFinding {
  kind: 'unclassified' | 'under-protected' | 'mgmt-plane' | 'external-ingress' | 'flow-channel' | 'cross-tier-domain'
  boundaryId: string
  detail: string
  severity: 'info' | 'warning'
  /**
   * For the conduit-dependent kinds (`external-ingress`, `flow-channel`), the PEER boundary id of the
   * crossing/channel — the target of a risk-bearing crossing, or the declared peer of a dead/unreviewable
   * channel. Lets a caller author a conduit `{ peerId, direction:'OUTBOUND' }` on `boundaryId` without
   * re-deriving the boundary graph. Undefined for the conduit-independent kinds.
   */
  peerId?: string
}

/** True when `ancestorId` is a strict ancestor of `descendantId` (walk `parentBoundary` up, cycle-guarded). */
const isAncestorOf = (
  ancestorId: string,
  descendantId: string,
  boundariesById: Map<string, StructureBoundary>,
  defaultBoundaryId: string,
): boolean => {
  const seen = new Set<string>()
  let cur = descendantId
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const parent = boundariesById.get(cur)?.parentBoundary?.id
    const next = parent == null || parent === '' ? defaultBoundaryId : parent
    if (!next || seen.has(next)) break // exhausted / cycle (incl. root self-loop)
    if (next === ancestorId) return true
    seen.add(next)
    cur = next
  }
  return false
}

const conduitEdgeKey = (src: string, tgt: string): string => `${src}\0${tgt}`

/**
 * A boundary that nests child boundaries is a STRUCTURAL container (a k8s cluster, a VPC, an AWS account,
 * a subnet holding a cluster). Its subtree can span multiple trust tiers, so it has no well-defined single
 * zone — it ABSTAINS: it is left unclassified (transparent to inheritance — `resolveEffectiveZone` keeps
 * walking a null zone) and suppresses the false `unclassified` finding, while trust classification lives at
 * its leaves. Asset findings still run at the DIRECT holder (`directAssetIds`), so a crown jewel held
 * directly by a container is not exempted.
 */
export const isStructuralContainer = (b: StructureBoundary): boolean => (b.boundaries?.length ?? 0) > 0

// ── Structural-container display roll-up (S15b) ───────────────────────────────────────────────

/**
 * Exposure gradient (lower = more exposed) for the display roll-up. `VENDOR` is deliberately OFF the
 * gradient — a vetted-partner enclave is orthogonal to the internet-exposure axis, so it is surfaced as
 * a separate `containsVendor` flag rather than carried as a range endpoint (rendering "Vendor…Internal"
 * as a contiguous span would be a truth error). Cannot be derived from the `Zone` union order (VENDOR is
 * declared last), hence an explicit table.
 */
export const EXPOSURE_RANK: Record<Exclude<Zone, 'VENDOR'>, number> = {
  UNTRUSTED: 0,
  PUBLIC: 1,
  EXPOSED: 2,
  INTERNAL: 3,
  RESTRICTED: 4,
}

/**
 * A DISPLAY-ONLY roll-up of the trust tiers that live inside a structural container. A view-model:
 * never written to `zone`, never read by the cascade/resolver/finding emission. Self-correcting against
 * *trust-level* mislabels (built from *computed* tiers via `determineZoneTier`, so a child mislabelled
 * INTERNAL/RESTRICTED/PUBLIC/EXPOSED can't inflate it) — but NOT against *externality* mislabels
 * (UNTRUSTED/VENDOR are declaration-driven externality inputs the engine treats as authoritative).
 */
export interface ContainerSummary {
  /** Exposure span across the container's segments (VENDOR excluded). Omitted when no gradient member. */
  range?: { min: Zone; max: Zone }
  /** The most-exposed gradient member (== `range.min`). Present whenever `range` is (omitted together). */
  maxExposure?: Zone
  /** A high-value asset lives somewhere inside (rolled-up `assetIds`). */
  containsAssets: boolean
  /** A vetted-vendor enclave lives inside (off the exposure gradient). */
  containsVendor: boolean
  /** An internet-adjacent or vendor segment exists inside. */
  reachesExternal: boolean
  /** Leaf descendants still resolving to the default zone (the coverage prompt). */
  unclassifiedDescendants: number
}

/**
 * Compute the display roll-up for a structural container (§S15b). Returns `null` for a non-structural
 * boundary or an empty signature (a container of empty sub-containers — nothing to summarize).
 *
 * The **signature** is the set of *computed* tiers of the container's LEAF segments, plus the container's
 * own computed tier only where it DIRECTLY holds a high-value asset (`directAssetIds` — a crown jewel held
 * directly in a container; C4/C7). A plain container's residual INTERNAL is deliberately NOT injected — it
 * would fabricate coverage and widen the range. Cycle-guarded (`seen` + `MAX_DEPTH`) because
 * `flattenStructure` — the only other downward recursion — carries no guard.
 */
export function computeContainerSummary(
  boundary: StructureBoundary,
  ctx: ZoningContext,
): ContainerSummary | null {
  if (!isStructuralContainer(boundary)) return null

  const signature = new Set<Zone>()
  let unclassifiedDescendants = 0
  const seen = new Set<string>()

  // Own-tier contribution: only when the container itself is a DIRECT asset holder (C4/C7).
  if (ctx.directAssetIds.has(boundary.id)) signature.add(determineZoneTier(boundary, ctx).tier)

  const walk = (b: StructureBoundary, depth: number): void => {
    if (depth >= MAX_DEPTH || seen.has(b.id)) return
    seen.add(b.id)
    for (const child of b.boundaries ?? []) {
      if (!isStructuralContainer(child)) {
        // Leaf segment — contributes its computed tier and its default-resolution to the coverage count.
        signature.add(determineZoneTier(child, ctx).tier)
        if (resolveEffectiveZone(child.id, ctx.boundariesById, ctx.defaultBoundaryId).source === 'default') {
          unclassifiedDescendants++
        }
      } else {
        if (ctx.directAssetIds.has(child.id)) signature.add(determineZoneTier(child, ctx).tier)
        walk(child, depth + 1)
      }
    }
  }
  walk(boundary, 0)

  if (signature.size === 0) return null

  const containsVendor = signature.has('VENDOR')
  const containsAssets = ctx.assetIds.has(boundary.id)
  const gradient = [...signature].filter((z): z is Exclude<Zone, 'VENDOR'> => z !== 'VENDOR')
  const reachesExternal =
    containsVendor || gradient.some((z) => z === 'UNTRUSTED' || z === 'PUBLIC' || z === 'EXPOSED')

  if (gradient.length === 0) {
    // Vendor-only container: no gradient span to render, but the enclave/external flags still surface.
    return { containsAssets, containsVendor, reachesExternal, unclassifiedDescendants }
  }

  // Ranks are unique across the 5 gradient zones ⇒ argmin/argmax are deterministic (no Set-order dependence).
  const sorted = [...gradient].sort((a, b) => EXPOSURE_RANK[a] - EXPOSURE_RANK[b])
  const mostExposed = sorted[0]
  const leastExposed = sorted[sorted.length - 1]
  return {
    range: { min: mostExposed, max: leastExposed },
    maxExposure: mostExposed,
    containsAssets,
    containsVendor,
    reachesExternal,
    unclassifiedDescendants,
  }
}

/**
 * Deterministic coherence findings about intent completeness/coherence (never correctness). Emits
 * all five kinds: the three conduit-independent ones (`unclassified`/`under-protected`/`mgmt-plane`) plus,
 * from the conduit data on `boundariesById` and the flow `adjacency`, `external-ingress` (#3 — an
 * external-tier boundary reaching a declared-trusted tier with no approved channel) and `flow-channel`
 * (#5 — undeclared risk-bearing path, dead intent, or unreviewable declaration).
 */
export function computeZoningFindings(ctx: ZoningContext): ZoningFinding[] {
  const findings: ZoningFinding[] = []

  for (const [id, boundary] of ctx.boundariesById) {
    if (id === ctx.defaultBoundaryId) continue // the root container is not itself a classified segment

    const tier = determineZoneTier(boundary, ctx)

    // 1. Unclassified rollup — nothing in the inheritance chain declared a zone. Structural containers
    //    abstain (their subtree spans tiers), so this fires only on a leaf/segment that stayed default.
    const eff = resolveEffectiveZone(id, ctx.boundariesById, ctx.defaultBoundaryId)
    if (eff.source === 'default' && !isStructuralContainer(boundary)) {
      findings.push({
        kind: 'unclassified',
        boundaryId: id,
        detail: 'no zone declared in its inheritance chain — falls back to Internal',
        severity: 'info',
      })
    }

    // 2. Under-protected / misplaced asset boundary — DIRECT asset holder but looser than Restricted.
    //    Gated on directAssetIds so a purely structural ancestor above the asset is not falsely flagged.
    if (ctx.directAssetIds.has(id) && tier.tier !== 'RESTRICTED') {
      const detail =
        tier.tier === 'PUBLIC' || tier.tier === 'EXPOSED'
          ? 'holds a high-value asset but sits in an externally-reachable segment — relocate the asset to a restricted segment (misplaced)'
          : tier.blockedBy === 'exposure'
            ? 'holds a high-value asset reached from an exposed tier — add an internal hop so it can be Restricted (under-segmented)'
            : tier.blockedBy === 'no-ingress'
              ? 'holds a high-value asset but has no modelled ingress — cannot verify isolation to promote to Restricted'
              : 'holds a high-value asset but does not qualify for Restricted'
      findings.push({ kind: 'under-protected', boundaryId: id, detail, severity: 'warning' })
    }

    // 4. Management-plane exposure — a MANAGEMENT plane resolving to an externally-reachable tier.
    if (boundary.planes?.includes('MANAGEMENT') && (tier.tier === 'EXPOSED' || tier.tier === 'PUBLIC')) {
      findings.push({
        kind: 'mgmt-plane',
        boundaryId: id,
        detail: `management-plane boundary resolves to ${tier.tier} — management surfaces should not be externally reachable`,
        severity: 'warning',
      })
    }
  }

  // ── Conduit-dependent findings (#3 external-ingress, #5 flow⇄channel) ──
  // Declared directional conduit edges: OUTBOUND on H → (H,peer); INBOUND on H → (peer,H). On-disk data
  // is OUTBOUND-canonical (S12), but accepting the INBOUND mirror too costs nothing and future-proofs.
  const declaredEdges = new Set<string>()
  for (const [id, boundary] of ctx.boundariesById) {
    for (const c of boundary.conduits ?? []) {
      if (!c?.peerId) continue
      if (c.direction === 'OUTBOUND') declaredEdges.add(conduitEdgeKey(id, c.peerId))
      else if (c.direction === 'INBOUND') declaredEdges.add(conduitEdgeKey(c.peerId, id))
    }
  }

  const name = (id: string) => ctx.boundariesById.get(id)?.name ?? id

  // #3 external-ingress + #5 undeclared-path — a risk-bearing crossing with no declared conduit.
  // Risk-bearing triggers: (1) external source → target whose DECLARED/resolved zone is trusted
  // (INTERNAL/RESTRICTED — never the computed tier, which the ingress itself would demote); (2) an
  // exposing source → an asset-bearing target. external-ingress is the external specialisation of the
  // undeclared-path case, reported once (trigger1 wins). Inheritance-implied (ancestry) crossings excluded.
  for (const [src, targets] of ctx.adjacency.out) {
    for (const tgt of targets) {
      if (declaredEdges.has(conduitEdgeKey(src, tgt))) continue // declared → not undeclared
      if (
        isAncestorOf(src, tgt, ctx.boundariesById, ctx.defaultBoundaryId) ||
        isAncestorOf(tgt, src, ctx.boundariesById, ctx.defaultBoundaryId)
      ) {
        continue // ordinary parent↔child nesting is inheritance-implied, not a declared channel
      }
      const tgtZone = resolveEffectiveZone(tgt, ctx.boundariesById, ctx.defaultBoundaryId).zone
      const trigger1 = isExternal(src, ctx) && (tgtZone === 'INTERNAL' || tgtZone === 'RESTRICTED')
      const trigger2 = isExposingSource(src, ctx) && ctx.assetIds.has(tgt)
      if (trigger1) {
        findings.push({
          kind: 'external-ingress',
          boundaryId: src,
          peerId: tgt,
          detail: `external-tier boundary has a modelled flow into ${name(tgt)} (a trusted tier) with no approved channel — ratify a conduit or route it through an approved path`,
          severity: 'warning',
        })
      } else if (trigger2) {
        findings.push({
          kind: 'flow-channel',
          boundaryId: src,
          peerId: tgt,
          detail: `risk-bearing crossing into ${name(tgt)} (asset-bearing) has no declared channel — undeclared path`,
          severity: 'warning',
        })
      }
    }
  }

  // #5 flow⇄channel authoring sub-cases (iterate declared conduits, OUTBOUND-canonical holder):
  //   dead intent = a declared channel with no matching flow; unreviewable = a channel with no justification.
  // Orthogonal — a dead channel with a blank justification legitimately emits both.
  for (const [id, boundary] of ctx.boundariesById) {
    const out = ctx.adjacency.out.get(id)
    for (const c of boundary.conduits ?? []) {
      if (!c?.peerId || c.direction !== 'OUTBOUND') continue
      if (!out?.has(c.peerId)) {
        findings.push({
          kind: 'flow-channel',
          boundaryId: id,
          peerId: c.peerId,
          detail: `declared channel to ${name(c.peerId)} has no matching flow — dead intent (declared but dormant)`,
          severity: 'info',
        })
      }
      if (!c.justification || c.justification.trim() === '') {
        findings.push({
          kind: 'flow-channel',
          boundaryId: id,
          peerId: c.peerId,
          detail: `declared channel to ${name(c.peerId)} has no justification — unreviewable declaration`,
          severity: 'info',
        })
      }
    }
  }

  // #6 cross-tier-domain (S16) — a hand-authored `domains` tag that couples an externally-reachable segment
  // with a protected (direct asset / declared Restricted) one: the blast-radius / co-tenancy shape (own the
  // exposed member → reach the protected one). This makes the otherwise-inert `domains` field load-bearing —
  // it is the grounded realisation of the identity-blast-radius + node-co-tenancy signals when they are
  // expressed as a shared tag. Advisory `info`: it can't tell an identity/compute tag from a business domain,
  // and it is dormant until an operator authors matching tags. Structural containers are excluded (trust lives
  // in the leaves — a container tagged over a DMZ+vault subtree would else fire on itself). The external↔protected
  // coupling (not merely ≥2 distinct tiers) is what keeps a benign business domain from generating noise; the
  // `resolveEffectiveZone` term catches an operator-declared Restricted that the topology can't verify to compute.
  const byDomain = new Map<string, { display: string; ids: Set<string> }>()
  for (const [id, boundary] of ctx.boundariesById) {
    if (id === ctx.defaultBoundaryId || isStructuralContainer(boundary)) continue
    for (const raw of boundary.domains ?? []) {
      const key = raw.trim().toLowerCase()
      if (key === '') continue
      const entry = byDomain.get(key) ?? { display: raw.trim(), ids: new Set<string>() }
      entry.ids.add(id)
      byDomain.set(key, entry)
    }
  }
  for (const { display, ids } of byDomain.values()) {
    if (ids.size < 2) continue
    const members = [...ids].sort() // id-sorted → deterministic anchor/peer selection
    const isExternalTier = (b: string): boolean => {
      const t = determineZoneTier(ctx.boundariesById.get(b)!, ctx).tier
      return t === 'UNTRUSTED' || t === 'PUBLIC' || t === 'EXPOSED' || t === 'VENDOR'
    }
    const isProtected = (b: string): boolean =>
      ctx.directAssetIds.has(b) ||
      resolveEffectiveZone(b, ctx.boundariesById, ctx.defaultBoundaryId).zone === 'RESTRICTED'
    const external = members.filter(isExternalTier)
    // Anchor on the at-risk (protected) member for which a DISTINCT external member exists; peer = that external.
    const anchor = members.filter(isProtected).find((p) => external.some((e) => e !== p))
    if (anchor === undefined) continue
    const peer = external.find((e) => e !== anchor)!
    const peerTier = determineZoneTier(ctx.boundariesById.get(peer)!, ctx).tier
    findings.push({
      kind: 'cross-tier-domain',
      boundaryId: anchor,
      peerId: peer,
      detail: `domain "${display}" couples externally-reachable ${name(peer)} (${peerTier}) with a protected boundary ${name(anchor)} (holds an asset or is declared Restricted)${ids.size > 2 ? `, among ${ids.size} tagged boundaries` : ''} — if this tag denotes a shared identity/principal or compute co-tenancy, owning the exposed member may reach the protected one; a business-domain tag may be benign`,
      severity: 'info',
    })
  }

  return findings
}

// ── Context builder (model → ZoningContext) ─────────────────────────────────────
//
// The cascade reasons about boundary→boundary ingress, but the modelled flows are component→component
// (`DataFlow.source/target` are component ids). The builder bridges that gap (the projection) and runs the
// asset join — the genuinely higher-risk work, kept separate from the proven cascade above. It reuses the
// existing `flattenStructure` projection (nesting-authoritative `parentMap`), never a second component→boundary
// walk. The asset signals are first-class fields (`component.crownJewel`, `dataItem.sensitivity`/
// `regulatory_flags`), NOT attribute-bag entries — so the builder reads structure + data items, not attributes.

/**
 * Project the model's component→component flows up to the one-hop boundary→boundary graph the cascade reads.
 * Each flow endpoint is mapped to its containing boundary via `parentMap`; an edge is **kept** only when both
 * endpoints resolve, the two boundaries differ (intra-boundary edges dropped), and neither is the default root
 * (the root contributes **no phantom ingress** — a root-level peer must not satisfy rule 3's positive-ingress
 * evidence). `in`/`out` entries are created **per kept edge only**, so an edge-less boundary appears in neither
 * map (mirroring the determination fixture's `buildAdjacency`). Directional: rule 3 reads the `in` map; egress
 * is not a classifier.
 */
export function buildBoundaryAdjacency(
  structure: ModelStructure,
  flows: DataFlow[],
): { in: Map<string, Set<string>>; out: Map<string, Set<string>> } {
  const { parentMap } = flattenStructure(structure)
  const rootId = structure.defaultBoundary.id
  const inMap = new Map<string, Set<string>>()
  const outMap = new Map<string, Set<string>>()

  for (const flow of flows) {
    const srcB = parentMap.get(flow.source.id)
    const tgtB = parentMap.get(flow.target.id)
    if (srcB == null || tgtB == null) continue // dangling endpoint
    if (srcB === tgtB) continue // intra-boundary edge — not a boundary crossing
    if (srcB === rootId || tgtB === rootId) continue // default-root: no phantom ingress

    if (!outMap.has(srcB)) outMap.set(srcB, new Set())
    if (!inMap.has(tgtB)) inMap.set(tgtB, new Set())
    outMap.get(srcB)!.add(tgtB)
    inMap.get(tgtB)!.add(srcB)
  }

  return { in: inMap, out: outMap }
}

/**
 * Boundaries bearing a high-value asset descendant. A boundary is asset-bearing iff a descendant is an
 * asset: a `crownJewel === true` component, or a data item with `sensitivity === 'restricted'` (lowercase) or a
 * non-empty `regulatory_flags`. Each asset element marks its containing boundary **and every ancestor boundary,
 * excluding the default root** (root contains everything — marking it is meaningless). Data items are counted at
 * **both** reference levels (`component.dataItemIds` and `boundary.dataItemIds`).
 *
 * Returns two sets: `assetIds` (the rollup — holder + every ancestor, for the display `containsAssets` flag) and
 * `directAssetIds` (the holder ONLY, no ancestor walk). The cascade's RESTRICTED promotion and the `under-protected`
 * finding gate on `directAssetIds` so a purely structural ancestor above an asset abstains instead of being flagged.
 */
function collectAssetBoundaries(
  structure: ModelStructure,
  dataItems: DataItem[],
): { assetIds: Set<string>; directAssetIds: Set<string> } {
  const { boundaries, components, parentMap } = flattenStructure(structure)
  const rootId = structure.defaultBoundary.id
  const assetIds = new Set<string>()
  const directAssetIds = new Set<string>()

  const markWithAncestors = (boundaryId: string | null | undefined): void => {
    const seen = new Set<string>()
    let cur = boundaryId
    while (cur != null && cur !== rootId && !seen.has(cur)) {
      seen.add(cur)
      assetIds.add(cur)
      cur = parentMap.get(cur) ?? undefined
    }
  }

  // The DIRECT holder only — no ancestor walk (single add, inherently cycle-free). Excludes root.
  const markDirect = (boundaryId: string | null | undefined): void => {
    if (boundaryId != null && boundaryId !== rootId) directAssetIds.add(boundaryId)
  }

  // 1. Crown-jewel components → their containing boundary + ancestors (rollup); the containing boundary (direct).
  for (const c of components) {
    if (c.crownJewel === true) {
      markWithAncestors(parentMap.get(c.id))
      markDirect(parentMap.get(c.id))
    }
  }

  // 2. High-value data items (restricted sensitivity OR any regulatory flag).
  const assetItemIds = new Set(
    dataItems
      .filter(
        (d) =>
          d.sensitivity === 'restricted' ||
          (Array.isArray(d.regulatory_flags) && d.regulatory_flags.length > 0),
      )
      .map((d) => d.id),
  )
  if (assetItemIds.size > 0) {
    const refsAsset = (ids: string[] | undefined): boolean =>
      ids != null && ids.some((id) => assetItemIds.has(id))
    // Component-level references → the component's boundary + ancestors (rollup) + that boundary (direct).
    for (const c of components) {
      if (refsAsset(c.dataItemIds)) {
        markWithAncestors(parentMap.get(c.id))
        markDirect(parentMap.get(c.id))
      }
    }
    // Boundary-level references → that boundary + ancestors (rollup) + that boundary (direct).
    for (const b of boundaries) {
      if (refsAsset(b.dataItemIds)) {
        markWithAncestors(b.id)
        markDirect(b.id)
      }
    }
  }

  return { assetIds, directAssetIds }
}

/**
 * Build the full `ZoningContext` the cascade consumes. `externalIds`/`vendorIds` come from each
 * boundary's **own declared** `zone` (`UNTRUSTED`/`VENDOR`) — externality is an explicit declaration, never
 * inherited; v1 carries no `dedicated` signal. `assetIds` is empty when no asset is tagged (Step-4
 * skeleton) and populated once crown jewels / classified data items exist (close of Step 7) — default-then-promote
 * falls out of the cascade reading a fuller context, not a second code path.
 *
 * `boundariesById` is normalized so every non-root boundary carries a `parentBoundary` derived from **nesting**
 * (`flattenStructure`'s `parentMap`, the authoritative containment). On-disk `structure.json` is nesting-only and
 * commonly omits `parentBoundary` back-refs; without this, `resolveEffectiveZone` (the sole reader of
 * `parentBoundary`) would skip every nesting ancestor and break zone inheritance on nested models. The spread
 * preserves `zone`/`planes`/`dataItemIds`; the adjacency/asset joins are unaffected (they read nesting directly).
 */
export function buildZoningContext(
  structure: ModelStructure,
  flows: DataFlow[],
  dataItems: DataItem[],
): ZoningContext {
  const { boundaries, parentMap } = flattenStructure(structure)
  const defaultBoundaryId = structure.defaultBoundary.id
  const boundariesById = new Map<string, StructureBoundary>(
    boundaries.map((b) => {
      const parentId = parentMap.get(b.id)
      return parentId == null ? [b.id, b] : [b.id, { ...b, parentBoundary: { id: parentId } }]
    }),
  )

  const externalIds = new Set<string>()
  const vendorIds = new Set<string>()
  for (const b of boundaries) {
    if (b.id === defaultBoundaryId) continue
    if (b.zone === 'UNTRUSTED') externalIds.add(b.id)
    else if (b.zone === 'VENDOR') vendorIds.add(b.id)
  }

  const { assetIds, directAssetIds } = collectAssetBoundaries(structure, dataItems)

  return {
    boundariesById,
    defaultBoundaryId,
    adjacency: buildBoundaryAdjacency(structure, flows),
    assetIds,
    directAssetIds,
    externalIds,
    vendorIds,
  }
}
