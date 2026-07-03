// frontend/lib/zoningPolicy.js — the declared-zone data-flow policy engine.
//
// Pure logic over the snapshot's zoning block (`doc.zoning = { findings,
// effectiveZones }`, produced backend-side by the dt-core engine) joined with
// `modelGraph` (boundary zones/domains/planes/conduits + component→boundary
// topology). No Vue, no network — pure functions, unit-tested with fixtures.
//
// DECLARED zones are authoritative and administrative: the operator sets a
// boundary's zone (dethereal only suggests). The report NEVER recomputes or
// overrides a declared zone. A link between two zones is a POLICY question, not
// a re-classification — `EXPOSED ↦ RESTRICTED` is a data-flow-policy VIOLATION to
// flag, never a signal to redefine a zone. The verdict means "the model as drawn
// encodes an illegal crossing," never "we verified the flow cannot occur."
//
// Evaluation order per crossing (deterministic, first match wins):
//   1. TYPE AXIS — external (UNTRUSTED) / partner (VENDOR) endpoints are judged by
//      the ingress/egress rules below, never by the numeric gradient. Governs ALL
//      external flows, so a legitimately internet-facing EXPOSED management
//      boundary (bastion / VPN concentrator) is judged here, not force-flagged.
//   2. PLANE GATE — management-plane (control-plane) flows get the management
//      lens: cross-cutting is expected, so the gradient does not apply.
//   3. DIRECTION GATE — a down-gradient internal flow is response-shaped (no
//      verdict), except a RESTRICTED-initiated workload egress (advisory).
//   4. DOMAIN SPLIT + ZONE-PAIR MATRIX — same-domain: single-step-up / same-tier
//      allowed with no conduit, tier-skips are violations. Cross-domain: valid
//      crossings additionally require a declared conduit (missing → warning), and
//      nothing crosses into RESTRICTED across domains.
//   5. CONDUIT RECONCILIATION — conduits are the declared exceptions and are
//      themselves validated: a conduit never legalizes an illegal crossing
//      (fail-closed); one that authorizes an illegal crossing is itself an ERROR.
// Severity: violation (deny) / warning (missing required conduit) / advisory
// (soft "review this") on flows; error on conduits. Any violation or conduit
// error fails the model's data-flow policy; warnings/advisories do not.

/** Zone → chip class (`trd-zone--restricted`, `trd-zone--vendor`, …). Empty for an absent zone. */
export function tierClass(zone) {
  return zone ? `trd-zone--${String(zone).toLowerCase()}` : ''
}

// Verdict severity → sort/partition rank. violation (deny) > warning (missing
// required conduit) > advisory (soft "review this") > allowed / no-verdict.
// `error` attaches to a conduit, not a flow; a flow in the two-findings case is
// itself a violation and carries conduitClause:'error'.
export const VERDICT_RANK = { violation: 3, warning: 2, advisory: 1, allowed: 0, none: 0 }

// Internal-tier gradient ranks. UNTRUSTED (external) and VENDOR (partner) are OFF
// the gradient — handled by the type axis, never by numeric comparison. No dt-core
// import (its barrel drags Apollo/Vue-Flow); a small local rank suffices.
const TIER_RANK = { PUBLIC: 1, EXPOSED: 2, INTERNAL: 3, RESTRICTED: 4 }
const tierRank = (zone) => TIER_RANK[zone] ?? 0
const isExternal = (zone) => zone === 'UNTRUSTED' || zone === 'VENDOR'

// Ancestor-walk ceiling — mirrors dt-core's MAX_DEPTH / the adapter's
// MAX_NEST_DEPTH / the platform's BELONGS_TO*0..50 traversal ceiling, so the
// policy's inheritance walk and the crossings engine's stack resolver
// (lib/boundaryCrossings.js makeStackResolver) truncate corrupt nesting at the
// same depth. Cycles are additionally flagged by the crossings engine's
// completeness flags; this walk just stays safe.
const MAX_ANCESTOR_DEPTH = 50

// Same-domain = share ≥1 domain tag, OR either boundary is untagged (an untagged
// boundary opts out of domain separation — "same domain as everything").
function sameDomain(sD, tD) {
  const a = sD ?? [], b = tD ?? []
  if (a.length === 0 || b.length === 0) return true
  return a.some((x) => b.includes(x))
}

const hasMgmt = (planes) => (planes ?? []).includes('MANAGEMENT')
const isMgmtOnly = (planes) => hasMgmt(planes) && !(planes ?? []).includes('WORKLOAD')

// A flow is a MANAGEMENT-plane flow iff either endpoint is MANAGEMENT-only, OR both
// endpoints share the MANAGEMENT plane; otherwise it is a WORKLOAD flow (the default:
// no MANAGEMENT tag ⇒ workload). The dual-tag [WORKLOAD, MANAGEMENT] resolves
// per-counterpart — a dual-tagged service → a WORKLOAD-only peer is a workload flow
// (gradient still applies), → a MANAGEMENT peer is a management flow.
const isMgmtFlow = (S, T) =>
  isMgmtOnly(S.planes) || isMgmtOnly(T.planes) || (hasMgmt(S.planes) && hasMgmt(T.planes))

// The per-boundary zoning finding kinds that are NOT reproduced by the per-edge
// policy (they need the engine's computed exposure cascade). They are advisory /
// informational and per-BOUNDARY (a granularity mismatch for the per-flow crossings
// view), so they are routed to the findings ledger as a compact un-scored block.
// external-ingress / flow-channel are deliberately excluded — the per-flow policy
// already covers those crossings.
const ADVISORY_KINDS = [
  ['unclassified', 'Unclassified boundaries'],
  ['under-protected', 'Under-protected asset holders'],
  ['mgmt-plane', 'Management plane on an exposed tier'],
  ['cross-tier-domain', 'Shared-domain cross-tier coupling'],
]

/**
 * Group the per-boundary zoning advisory findings (the four ADVISORY_KINDS) for
 * the findings-ledger advisory block. Non-empty kinds only, boundary-name sorted.
 *
 * @param {{findings?:any[]}} zoning
 * @param {{boundaries?:any[]}} modelGraph
 * @returns {Array<{kind:string,label:string,items:Array<{boundaryId:string,name:string,detail:string}>}>}
 */
export function zoningAdvisories(zoning, modelGraph) {
  const findings = zoning?.findings ?? []
  const boundaryById = new Map((modelGraph?.boundaries ?? []).map((b) => [b.id, b]))
  const nameOf = (id) => boundaryById.get(id)?.name || '(unknown)'
  const out = []
  for (const [kind, label] of ADVISORY_KINDS) {
    const items = findings
      .filter((f) => f.kind === kind && f.boundaryId)
      .map((f) => ({ boundaryId: f.boundaryId, name: nameOf(f.boundaryId), detail: f.detail || '' }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    if (items.length) out.push({ kind, label, items })
  }
  return out
}

/**
 * Evaluate the declared-zone data-flow policy over the model.
 *
 * @param {{boundaries?:any[],components?:any[],flows?:any[]}} modelGraph
 * @param {{effectiveZones?:Record<string,{zone:string,source?:string}>}} zoning
 * @returns {{
 *   byFlow: Record<string, Verdict>,      // per-flow verdict keyed by flowId (crossing flows only)
 *   conduitErrors: any[],                  // declared conduits authorizing an illegal crossing
 *   deadConduits: any[],                   // legally-declared conduits with no matching modeled flow
 *   rollup: { fails: boolean }             // any violation or conduit error ⇒ the model fails
 * }}
 *
 * Verdict = { verdict:'violation'|'warning'|'advisory'|'allowed'|null, verdictRank:number,
 *   srcZone, tgtZone, domainRel:'same'|'cross'|'n/a', planeClass:'workload'|'management',
 *   conduitClause:'required-present'|'required-missing'|'error'|'none', detail }
 */
export function evaluateDataFlowPolicy(modelGraph, zoning) {
  const boundaries = modelGraph?.boundaries ?? []
  const components = modelGraph?.components ?? []
  const flows = modelGraph?.flows ?? []
  const effectiveZones = zoning?.effectiveZones ?? {}

  const boundaryById = new Map(boundaries.map((b) => [b.id, b]))
  const componentBoundary = new Map(components.map((c) => [c.id, c.boundaryId ?? null]))
  const nameOf = (id) => boundaryById.get(id)?.name || '(unknown)'

  // Endpoint descriptor from the DECLARED effective zone (default INTERNAL if the
  // engine produced no entry — matches the resolver's default) + declared tags.
  const endpointOf = (id) => ({
    id,
    zone: effectiveZones[id]?.zone ?? 'INTERNAL',
    domains: boundaryById.get(id)?.domains ?? [],
    planes: boundaryById.get(id)?.planes ?? [],
  })

  // Boundary parent map + ancestor-or-self walk. Conduits INHERIT down the tree (like effective
  // zones): a conduit is a zone-level approved channel, not a pod-by-pod declaration. Cycle/depth
  // guarded so a malformed nesting loop can't hang the walk (ceiling shared with the crossings
  // engine's stack resolver — see MAX_ANCESTOR_DEPTH above).
  const parentOf = new Map(boundaries.map((b) => [b.id, b.parentBoundaryId ?? null]))
  const ancestorCache = new Map()
  const ancestorsOf = (id) => {
    const cached = ancestorCache.get(id)
    if (cached) return cached
    const set = new Set()
    let cur = id
    let depth = 0
    while (cur != null && !set.has(cur) && depth < MAX_ANCESTOR_DEPTH) {
      set.add(cur)
      cur = parentOf.get(cur) ?? null
      depth++
    }
    ancestorCache.set(id, set)
    return set
  }

  // Declared OUTBOUND conduits as deduped (declaringBoundary → peer) pairs (the report gathers
  // conduits OUTBOUND-canonical; an INBOUND mirror is ignored). A crossing sB→tB is conduit-covered
  // when some declared conduit's `from` is an ancestor-or-self of sB AND its `peer` is an
  // ancestor-or-self of tB — so a conduit declared at the zone (parent) level covers every
  // descendant pod→pod crossing, on BOTH the source and the peer side. Declaring it on the exact
  // leaf boundary still matches (self is in its own ancestor set), so this is a strict superset of
  // exact-match. Inheritance is downward only: a conduit on a child never covers a parent's (or
  // sibling's) crossing.
  const conduitList = []
  const seenConduit = new Set()
  for (const b of boundaries) {
    for (const c of b.conduits ?? []) {
      if (!c?.peerId || c.direction !== 'OUTBOUND') continue
      const key = `${b.id}>${c.peerId}`
      if (seenConduit.has(key)) continue
      seenConduit.add(key)
      conduitList.push({ from: b.id, peer: c.peerId, key, justification: c.justification ?? null })
    }
  }
  const coveringConduits = (sB, tB) =>
    conduitList.filter((c) => ancestorsOf(sB).has(c.from) && ancestorsOf(tB).has(c.peer))
  const hasConduit = (sB, tB) => coveringConduits(sB, tB).length > 0

  // Directional boundary→boundary adjacency (for dead-vs-live conduit classification). A conduit is
  // LIVE if any modeled crossing it covers (by the same inheritance rule) exists.
  const adjacencyPairs = []
  for (const f of flows) {
    const sB = componentBoundary.get(f.sourceId)
    const tB = componentBoundary.get(f.targetId)
    if (sB && tB && sB !== tB) adjacencyPairs.push({ s: sB, t: tB })
  }
  const conduitIsLive = (from, peer) =>
    adjacencyPairs.some((e) => ancestorsOf(e.s).has(from) && ancestorsOf(e.t).has(peer))

  // Conduit legality is STATIC — judged on the conduit's OWN declared endpoints, populated by the
  // static pass below before any flow is classified. A violating flow shows `conduit: error` only
  // when a covering conduit is itself statically illegal, so the flow token and the conduit-errors
  // panel always agree (a zone-level conduit that is legal as declared is not blamed for one
  // misdeclared child crossing — that flow's violation stands on its own).
  const illegalConduitKeys = new Set()
  const violationConduitClause = (sB, tB) =>
    coveringConduits(sB, tB).some((c) => illegalConduitKeys.has(c.key)) ? 'error' : 'none'

  // ── the classifier — the evaluation order from the header, deterministic ────
  function classify(S, T) {
    const base = { srcZone: S.zone, tgtZone: T.zone, domainRel: 'n/a', planeClass: 'workload', conduitClause: 'none' }
    const mk = (verdict, extra = {}) => ({
      verdict,
      verdictRank: VERDICT_RANK[verdict ?? 'none'],
      ...base,
      ...extra,
    })

    // 1. Type axis — external/partner precede the domain split. Governs ALL external
    //    flows: the management lens applies only to internal flows, so a legitimately
    //    internet-facing EXPOSED management boundary (bastion / VPN concentrator) is
    //    judged here, not force-flagged as a violation.
    if (isExternal(S.zone) || isExternal(T.zone)) {
      if (isExternal(S.zone) && isExternal(T.zone))
        return mk(null, { detail: 'Flow between two external/partner entities — not an ingress into the modeled system; out of scope.' })
      return isExternal(S.zone) ? typeAxisIngress(S, T, mk) : typeAxisEgress(S, T, mk)
    }

    // 2. Plane gate — management-plane flows are cross-cutting; the gradient does not apply.
    if (isMgmtFlow(S, T)) return managementLens(S, T, mk)

    // 3. Direction gate (workload, both internal) — down-gradient is response-shaped.
    const rS = tierRank(S.zone), rT = tierRank(T.zone)
    if (rT < rS) {
      // Workload-scoped restricted-egress advisory: a RESTRICTED workload initiating an
      // outbound flow is unusual (control-plane flows were carved out by the plane gate).
      if (S.zone === 'RESTRICTED')
        return mk('advisory', { detail: 'A RESTRICTED workload initiates an outbound flow (down-gradient). Unusual under initiation semantics — confirm this is a legitimate call-out, not an exfiltration path.' })
      return mk(null, { detail: 'Down-gradient (response-shaped) flow — no policy verdict.' })
    }

    // 4. Domain split + zone-pair matrix (up-gradient or same tier).
    const same = sameDomain(S.domains, T.domains)
    const up = rT - rS
    base.domainRel = same ? 'same' : 'cross'

    if (same) {
      // Same-domain — conduits NOT required within a domain. Single-step-up / same-tier
      // allowed; a tier-skip is a violation (a blessing conduit on the skip is itself an error).
      if (up >= 2)
        return mk('violation', { conduitClause: violationConduitClause(S.id, T.id), detail: `Skips ${up - 1} trust tier(s) (${S.zone} ↦ ${T.zone}) — model the intermediate hop or ratify the jump; a direct skip bypasses the intervening tier's controls.` })
      return mk('allowed')
    }
    // Cross-domain — valid crossings require a conduit; nothing crosses into RESTRICTED
    // across domains (violation even with a conduit — that conduit is also an error).
    if (T.zone === 'RESTRICTED')
      return mk('violation', { conduitClause: violationConduitClause(S.id, T.id), detail: `Cross-domain ingress into a RESTRICTED zone (${S.zone} ↦ ${T.zone}) — not permitted across domains, even with a conduit.` })
    if (up >= 2)
      return mk('violation', { conduitClause: violationConduitClause(S.id, T.id), detail: `Cross-domain and skips ${up - 1} trust tier(s) (${S.zone} ↦ ${T.zone}).` })
    if (hasConduit(S.id, T.id)) return mk('allowed', { conduitClause: 'required-present' })
    return mk('warning', { conduitClause: 'required-missing', detail: `Cross-domain crossing (${S.zone} ↦ ${T.zone}) without a declared conduit — approve the channel or remove the coupling.` })
  }

  // Type axis — external/partner ingress into the modeled system.
  function typeAxisIngress(S, T, mk) {
    const t = T.zone
    const conduit = hasConduit(S.id, T.id)
    if (S.zone === 'UNTRUSTED') {
      if (t === 'PUBLIC') return mk('allowed', { detail: 'External ingress to a PUBLIC front door — expected (a public boundary is defined as externally reachable).' })
      if (t === 'EXPOSED')
        return conduit
          ? mk('allowed', { conduitClause: 'required-present' })
          : mk('warning', { conduitClause: 'required-missing', detail: 'External ingress to an EXPOSED boundary without a declared conduit — approve the channel.' })
      // INTERNAL, RESTRICTED (external→external pairs never reach here)
      return mk('violation', { conduitClause: violationConduitClause(S.id, T.id), detail: `External ingress reaches a ${t} boundary directly — the internet must not reach ${t === 'RESTRICTED' ? 'the crown-jewel tier' : 'internal services'}.` })
    }
    // VENDOR source (VENDOR→VENDOR / VENDOR→UNTRUSTED handled as dual-external upstream)
    if (t === 'PUBLIC') return mk('allowed', { detail: 'Partner ingress to a PUBLIC boundary.' })
    if (t === 'EXPOSED' || t === 'INTERNAL')
      return conduit
        ? mk('allowed', { conduitClause: 'required-present' })
        : mk('warning', { conduitClause: 'required-missing', detail: `Partner ingress to a ${t} boundary without a declared conduit — approve the channel.` })
    return mk('violation', { conduitClause: violationConduitClause(S.id, T.id), detail: 'Partner ingress reaches a RESTRICTED boundary directly.' })
  }

  // Type axis — egress to an external/partner sink (the exfil direction).
  function typeAxisEgress(S, T, mk) {
    const s = S.zone
    const conduit = hasConduit(S.id, T.id)
    if (T.zone === 'UNTRUSTED') {
      if (s === 'INTERNAL' || s === 'RESTRICTED')
        return conduit
          ? mk('warning', { conduitClause: 'required-present', detail: `Egress from ${s} to the internet via a declared conduit — confirm this is intended data-out.` })
          : mk('violation', { detail: `Egress from ${s} directly to the internet (data-out) with no approved channel.` })
      return mk(null, { detail: 'Egress from an already-exposed tier to the internet — out of scope.' })
    }
    // T VENDOR — a third-party egress requires an approved channel (a flow-level
    // condition, so missing → violation; error stays reserved for conduit objects).
    return conduit
      ? mk('allowed', { conduitClause: 'required-present' })
      : mk('violation', { detail: 'Data sent to a partner (VENDOR) with no approved channel — a third-party egress requires a declared conduit.' })
  }

  // Management lens — control-plane flows (SIEM/logging, auth/IdP, secrets/KMS,
  // monitoring, CI/CD) are hub-and-spoke: every tier talks to them, so they are not
  // gradient-blocked. A conduit is still RECOMMENDED on the approved channel —
  // missing one is a low warning, never a violation. The privilege advisory fires
  // only when the CONTROL-PLANE side sits below the RESTRICTED workload it reaches
  // into (a workload app calling a RESTRICTED+MANAGEMENT secrets manager / SIEM is
  // the expected hub-and-spoke shape, not an escalation path).
  function managementLens(S, T, mk) {
    const mgmt = (verdict, detail, extra = {}) => mk(verdict, { planeClass: 'management', detail, ...extra })
    if (T.zone === 'RESTRICTED' && S.zone !== 'RESTRICTED' && hasMgmt(S.planes))
      return mgmt('advisory', `A control-plane service below RESTRICTED (${S.zone}) writes into a RESTRICTED workload. If it can deploy/write to the crown-jewel tier it IS crown-jewel-privileged — zone it RESTRICTED+MANAGEMENT, else this is a privilege-escalation / supply-chain path (the SolarWinds shape).`)
    if (hasConduit(S.id, T.id))
      return mgmt('allowed', 'Management-plane (cross-cutting) flow via a declared conduit.', { conduitClause: 'required-present' })
    return mgmt('warning', 'Management-plane (cross-cutting) flow — not gradient-blocked, but a declared conduit is recommended for the control-plane channel; approve it.', { conduitClause: 'required-missing' })
  }

  // ── static conduit passes — legality is judged on each conduit's OWN declared
  //    endpoints (dead or live), BEFORE flows are classified, so the per-flow
  //    `conduit: error` token reads from the same truth as the panel. ──────────
  const conduitErrors = []
  const deadConduits = []
  for (const c of conduitList) {
    const v = classify(endpointOf(c.from), endpointOf(c.peer))
    const dead = !conduitIsLive(c.from, c.peer)
    if (v.verdict === 'violation') {
      illegalConduitKeys.add(c.key)
      conduitErrors.push({
        sourceId: c.from,
        peerId: c.peer,
        sourceName: nameOf(c.from),
        peerName: nameOf(c.peer),
        srcZone: v.srcZone,
        tgtZone: v.tgtZone,
        dead,
        detail: `A declared conduit authorizes an illegal crossing (${v.srcZone} ↦ ${v.tgtZone}${v.domainRel === 'cross' ? ', cross-domain' : ''}) — conduits do not legalize a policy violation.`,
      })
    } else if (dead) {
      // Legally declared but dormant — declared intent with no matching modeled flow.
      // Surfaced muted (dead intent is worth reviewing, not alarming).
      deadConduits.push({
        sourceId: c.from,
        peerId: c.peer,
        sourceName: nameOf(c.from),
        peerName: nameOf(c.peer),
        justification: c.justification,
        unreviewable: !c.justification || !String(c.justification).trim(),
      })
    }
  }
  const nameSort = (a, b) =>
    String(a.sourceName).localeCompare(String(b.sourceName)) ||
    String(a.peerName).localeCompare(String(b.peerName))
  conduitErrors.sort(nameSort)
  deadConduits.sort(nameSort)

  // ── per-flow verdicts (crossing flows only; null-prototype record keyed by
  //    flowId so a model-controlled id can never collide with Object.prototype) ─
  const byFlow = Object.create(null)
  for (const f of flows) {
    if (!f?.id) continue
    const sB = componentBoundary.get(f.sourceId)
    const tB = componentBoundary.get(f.targetId)
    if (!sB || !tB || sB === tB) continue // intra-boundary / missing endpoint → no crossing
    byFlow[f.id] = classify(endpointOf(sB), endpointOf(tB))
  }

  const fails =
    Object.values(byFlow).some((v) => v.verdict === 'violation') || conduitErrors.length > 0

  return { byFlow, conduitErrors, deadConduits, rollup: { fails } }
}
