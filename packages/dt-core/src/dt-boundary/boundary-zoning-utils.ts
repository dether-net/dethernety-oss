import {
  Zone,
  Plane,
  Conduit,
  ConduitDirection,
  ConduitEdge,
  BoundaryData,
} from '../interfaces/core-types-interface.js'

// Canonical enum members + caps.
const ZONES: readonly Zone[] = ['UNTRUSTED', 'PUBLIC', 'EXPOSED', 'INTERNAL', 'RESTRICTED', 'VENDOR']
// Fixed plane order so a set is canonical: { MANAGEMENT, WORKLOAD } ≡ { WORKLOAD, MANAGEMENT }.
const PLANE_ORDER: readonly Plane[] = ['WORKLOAD', 'MANAGEMENT']
const DOMAIN_MAX_LEN = 64
const DOMAIN_MAX_COUNT = 16
const JUSTIFICATION_MAX_LEN = 500

/** Valid Zone value, or null (= inherit/undecided). Guards against stale/garbage input. */
export const sanitizeZone = (z: Zone | null | undefined): Zone | null =>
  z != null && (ZONES as readonly string[]).includes(z) ? z : null

/** Trim, drop empties, case-insensitive de-dupe (keep first casing), cap length and count. */
export const sanitizeDomains = (domains: string[] | undefined): string[] => {
  if (!Array.isArray(domains)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of domains) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim().slice(0, DOMAIN_MAX_LEN)
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
    if (out.length >= DOMAIN_MAX_COUNT) break
  }
  return out
}

/** Keep valid members, de-dupe, return in canonical order so equal sets are equal arrays. */
export const normalizePlanes = (planes: Plane[] | undefined): Plane[] => {
  if (!Array.isArray(planes)) return []
  const present = new Set(planes)
  return PLANE_ORDER.filter(p => present.has(p))
}

/** Trim and cap; empty → undefined (so it is not sent as an empty string). */
export const sanitizeJustification = (s: string | null | undefined): string | undefined => {
  if (typeof s !== 'string') return undefined
  const trimmed = s.trim().slice(0, JUSTIFICATION_MAX_LEN)
  return trimmed.length ? trimmed : undefined
}

/**
 * Flatten the two raw connection reads into the UI-facing `Conduit[]`.
 * `direction` is derived from *which connection* the edge came from — never a stored field.
 */
export const flattenConduits = (
  raw: Pick<BoundaryData, 'outboundConduitsConnection' | 'inboundConduitsConnection'> | null | undefined,
): Conduit[] => {
  if (!raw) return []
  const fromEdges = (edges: ConduitEdge[] | undefined, direction: ConduitDirection): Conduit[] =>
    (edges ?? [])
      .filter(e => e?.node?.id)
      .map(e => ({
        peerId: e.node.id,
        peerName: e.node.name,
        direction,
        justification: e.properties?.justification ?? undefined,
        controlRefs: e.properties?.controlRefs ?? undefined,
      }))
  return [
    ...fromEdges(raw.outboundConduitsConnection?.edges, 'OUTBOUND'),
    ...fromEdges(raw.inboundConduitsConnection?.edges, 'INBOUND'),
  ]
}

// ── conduit write reconcile (baseline-driven delta) ──
// `connect` is NOT idempotent for CONDUIT (verified live: re-connecting an existing peer creates a
// duplicate parallel edge), so membership must be a delta vs the last server state, never connect-all.

type ConduitOps = {
  connect?: { where: { node: { id: { eq: string } } }; edge: { justification?: string } }[]
  disconnect?: { where: { node: { id: { eq: string } } } }[]
}
type ConduitUpdateOp = {
  update: { where: { node: { id: { eq: string } } }; edge: { justification: { set: string | null } } }
}

const dedupeByPeer = (conduits: Conduit[], selfId: string): Map<string, Conduit> => {
  const byPeer = new Map<string, Conduit>()
  for (const c of conduits) {
    if (!c?.peerId || c.peerId === selfId) continue // drop self-conduit + junk
    if (!byPeer.has(c.peerId)) byPeer.set(c.peerId, c) // per-direction de-dupe (first wins)
  }
  return byPeer
}

/**
 * Build the `outboundConduits` / `inboundConduits` update value for one direction as a list of op-objects:
 *   - one membership op-object `{ connect:[added], disconnect:[removed] }` (only if either is non-empty)
 *   - one `{ update: … }` op-object per peer whose justification changed (update is singular per op-object)
 * Returns `undefined` when there is nothing to do (caller omits the key entirely).
 */
export const buildConduitOps = (
  direction: ConduitDirection,
  current: Conduit[] | undefined,
  baseline: Conduit[] | undefined,
  selfId: string,
): (ConduitOps | ConduitUpdateOp)[] | undefined => {
  const cur = dedupeByPeer((current ?? []).filter(c => c.direction === direction), selfId)
  const base = dedupeByPeer((baseline ?? []).filter(c => c.direction === direction), selfId)

  const connect: ConduitOps['connect'] = []
  const updates: ConduitUpdateOp[] = []
  for (const [peerId, c] of cur) {
    const baseConduit = base.get(peerId)
    const justification = sanitizeJustification(c.justification)
    if (!baseConduit) {
      connect.push({ where: { node: { id: { eq: peerId } } }, edge: { justification } })
    } else if (justification !== sanitizeJustification(baseConduit.justification)) {
      updates.push({
        update: { where: { node: { id: { eq: peerId } } }, edge: { justification: { set: justification ?? null } } },
      })
    }
  }
  const disconnect: ConduitOps['disconnect'] = []
  for (const peerId of base.keys()) {
    if (!cur.has(peerId)) disconnect.push({ where: { node: { id: { eq: peerId } } } })
  }

  const ops: (ConduitOps | ConduitUpdateOp)[] = []
  if (connect.length || disconnect.length) {
    const membership: ConduitOps = {}
    if (connect.length) membership.connect = connect
    if (disconnect.length) membership.disconnect = disconnect
    ops.push(membership)
  }
  ops.push(...updates)
  return ops.length ? ops : undefined
}
