// zoningPolicy.test.js — the declared-zone data-flow policy engine (evaluateDataFlowPolicy).
// Lib-only (suite convention — no component mount). This is the whole safety net: every cell of the
// same-domain and cross-domain matrices, the external/partner type axis (both directions), plane
// classification + the management lens, the egress gate + the restricted-egress advisory, conduit
// inheritance down the boundary tree, and the conduit static-error / two-findings case. The
// flow→verdict join (byFlow keyed by flowId) and rollup are tested here, in the lib, where the
// component can't be mounted.

import { describe, it, expect } from 'vitest'
import { evaluateDataFlowPolicy, zoningAdvisories, tierClass, VERDICT_RANK } from '../lib/zoningPolicy.js'

// ── fixture builders (plain-object modelGraph + zoning) ────────────────────────────────────────
const bnd = (id, extra = {}) => ({ id, name: id, parentBoundaryId: null, domains: [], planes: [], conduits: [], ...extra })
const cmp = (id, boundaryId) => ({ id, boundaryId })
const flow = (id, sourceId, targetId) => ({ id, sourceId, targetId })

// Evaluate a single s→t crossing and return its verdict. opts: srcDomains/tgtDomains,
// srcPlanes/tgtPlanes, conduit (declare an OUTBOUND s→t conduit), conduitDirection (override
// the declared direction — INBOUND mirrors must be ignored), noFlow (omit the live flow).
function evalCross(srcZone, tgtZone, opts = {}) {
  const s = bnd('s', {
    domains: opts.srcDomains ?? [],
    planes: opts.srcPlanes ?? [],
    conduits: opts.conduit
      ? [{ peerId: 't', direction: opts.conduitDirection ?? 'OUTBOUND', justification: opts.justification ?? 'ratified' }]
      : [],
  })
  const t = bnd('t', { domains: opts.tgtDomains ?? [], planes: opts.tgtPlanes ?? [] })
  const mg = {
    boundaries: [s, t],
    components: [cmp('sc', 's'), cmp('tc', 't')],
    flows: opts.noFlow ? [] : [flow('f', 'sc', 'tc')],
  }
  const z = { effectiveZones: { s: { zone: srcZone }, t: { zone: tgtZone } } }
  const res = evaluateDataFlowPolicy(mg, z)
  return { verdict: res.byFlow['f'], res }
}
const V = (srcZone, tgtZone, opts) => evalCross(srcZone, tgtZone, opts).verdict

describe('tierClass / VERDICT_RANK helpers', () => {
  it('maps a zone to its chip class, lowercased; empty for absent', () => {
    expect(tierClass('RESTRICTED')).toBe('trd-zone--restricted')
    expect(tierClass('VENDOR')).toBe('trd-zone--vendor')
    expect(tierClass(null)).toBe('')
  })
  it('orders verdict severity violation > warning > advisory > allowed', () => {
    expect(VERDICT_RANK.violation).toBeGreaterThan(VERDICT_RANK.warning)
    expect(VERDICT_RANK.warning).toBeGreaterThan(VERDICT_RANK.advisory)
    expect(VERDICT_RANK.advisory).toBeGreaterThan(VERDICT_RANK.allowed)
  })
})

describe('same-domain matrix (conduits NOT required within a domain)', () => {
  it('single-step-up and same-tier are allowed', () => {
    expect(V('PUBLIC', 'EXPOSED').verdict).toBe('allowed')
    expect(V('EXPOSED', 'INTERNAL').verdict).toBe('allowed')
    expect(V('INTERNAL', 'RESTRICTED').verdict).toBe('allowed')
    expect(V('INTERNAL', 'INTERNAL').verdict).toBe('allowed')
  })
  it('domainRel is "same" when either boundary is untagged (opts out of separation)', () => {
    expect(V('EXPOSED', 'INTERNAL').domainRel).toBe('same')
  })
  it('skip-level up-gradient is a violation', () => {
    expect(V('PUBLIC', 'INTERNAL').verdict).toBe('violation')
    expect(V('PUBLIC', 'RESTRICTED').verdict).toBe('violation')
    expect(V('EXPOSED', 'RESTRICTED').verdict).toBe('violation')
  })
  it('down-gradient (workload) is response-shaped — no verdict', () => {
    expect(V('INTERNAL', 'PUBLIC').verdict).toBeNull()
    expect(V('RESTRICTED', 'EXPOSED').verdict).toBe('advisory') // RESTRICTED-initiated egress (see below)
  })
})

describe('cross-domain matrix (valid crossings require a conduit)', () => {
  const cross = { srcDomains: ['a'], tgtDomains: ['b'] } // disjoint tags → cross-domain
  it('same-tier / single-step-up without a conduit → warning', () => {
    expect(V('EXPOSED', 'EXPOSED', cross).verdict).toBe('warning')
    expect(V('PUBLIC', 'EXPOSED', cross).verdict).toBe('warning')
    expect(V('EXPOSED', 'INTERNAL', cross).verdict).toBe('warning')
  })
  it('the same crossing WITH a conduit → allowed', () => {
    const v = V('EXPOSED', 'INTERNAL', { ...cross, conduit: true })
    expect(v.verdict).toBe('allowed')
    expect(v.conduitClause).toBe('required-present')
    expect(v.domainRel).toBe('cross')
  })
  it('nothing crosses into RESTRICTED across domains — violation even with a conduit', () => {
    expect(V('INTERNAL', 'RESTRICTED', cross).verdict).toBe('violation')
    const withConduit = V('INTERNAL', 'RESTRICTED', { ...cross, conduit: true })
    expect(withConduit.verdict).toBe('violation')
    expect(withConduit.conduitClause).toBe('error') // the conduit is itself an error
  })
  it('skip-level cross-domain → violation', () => {
    expect(V('PUBLIC', 'INTERNAL', cross).verdict).toBe('violation')
  })
})

describe('type axis — external (UNTRUSTED) & partner (VENDOR) ingress', () => {
  it('UNTRUSTED → PUBLIC front door is allowed (info, no conduit nag)', () => {
    expect(V('UNTRUSTED', 'PUBLIC').verdict).toBe('allowed')
  })
  it('UNTRUSTED → EXPOSED requires a conduit (missing → warning, present → allowed)', () => {
    expect(V('UNTRUSTED', 'EXPOSED').verdict).toBe('warning')
    expect(V('UNTRUSTED', 'EXPOSED', { conduit: true }).verdict).toBe('allowed')
  })
  it('UNTRUSTED → INTERNAL / RESTRICTED is a violation', () => {
    expect(V('UNTRUSTED', 'INTERNAL').verdict).toBe('violation')
    expect(V('UNTRUSTED', 'RESTRICTED').verdict).toBe('violation')
  })
  it('VENDOR → PUBLIC allowed; → EXPOSED/INTERNAL need a conduit; → RESTRICTED violation', () => {
    expect(V('VENDOR', 'PUBLIC').verdict).toBe('allowed')
    expect(V('VENDOR', 'EXPOSED').verdict).toBe('warning')
    expect(V('VENDOR', 'INTERNAL').verdict).toBe('warning')
    expect(V('VENDOR', 'INTERNAL', { conduit: true }).verdict).toBe('allowed')
    expect(V('VENDOR', 'RESTRICTED').verdict).toBe('violation')
  })
  it('type-axis verdicts carry domainRel "n/a" (external has no domain)', () => {
    expect(V('UNTRUSTED', 'INTERNAL').domainRel).toBe('n/a')
  })
})

describe('type axis — egress to an external/partner sink (exfil direction)', () => {
  it('INTERNAL/RESTRICTED → UNTRUSTED: violation w/o conduit, warning with', () => {
    expect(V('INTERNAL', 'UNTRUSTED').verdict).toBe('violation')
    expect(V('INTERNAL', 'UNTRUSTED', { conduit: true }).verdict).toBe('warning')
    expect(V('RESTRICTED', 'UNTRUSTED').verdict).toBe('violation')
  })
  it('already-exposed tier → UNTRUSTED is out of scope (no verdict)', () => {
    expect(V('PUBLIC', 'UNTRUSTED').verdict).toBeNull()
    expect(V('EXPOSED', 'UNTRUSTED').verdict).toBeNull()
  })
  it('→ VENDOR requires a conduit from every internal tier: missing → violation, present → allowed', () => {
    expect(V('INTERNAL', 'VENDOR').verdict).toBe('violation')
    expect(V('INTERNAL', 'VENDOR', { conduit: true }).verdict).toBe('allowed')
    expect(V('PUBLIC', 'VENDOR').verdict).toBe('violation')
    expect(V('EXPOSED', 'VENDOR').verdict).toBe('violation')
    expect(V('EXPOSED', 'VENDOR', { conduit: true }).verdict).toBe('allowed')
  })
  it('dual-external (both external/partner) is out of scope — all pairs', () => {
    expect(V('UNTRUSTED', 'VENDOR').verdict).toBeNull()
    expect(V('VENDOR', 'UNTRUSTED').verdict).toBeNull()
    expect(V('UNTRUSTED', 'UNTRUSTED').verdict).toBeNull()
    expect(V('VENDOR', 'VENDOR').verdict).toBeNull()
  })
})

describe('plane classification + the management lens', () => {
  const M = ['MANAGEMENT']
  const W = ['WORKLOAD']
  const WM = ['WORKLOAD', 'MANAGEMENT']

  it('a flow where both endpoints share MANAGEMENT is a management flow (planeClass)', () => {
    expect(V('INTERNAL', 'INTERNAL', { srcPlanes: M, tgtPlanes: M }).planeClass).toBe('management')
  })
  it('management is not gradient-blocked, but a conduit is RECOMMENDED — missing → low warning', () => {
    // Cross-domain INTERNAL↔INTERNAL: as a workload flow this would warn for the missing
    // REQUIRED conduit; as a management flow the gradient/domain rules do not apply, yet the
    // recommended-conduit clause still yields a (soft) warning when absent…
    const missing = V('INTERNAL', 'INTERNAL', { srcPlanes: M, tgtPlanes: M, srcDomains: ['a'], tgtDomains: ['b'] })
    expect(missing.verdict).toBe('warning')
    expect(missing.conduitClause).toBe('required-missing')
    expect(missing.planeClass).toBe('management')
    // …and allowed once declared.
    const declared = V('INTERNAL', 'INTERNAL', { srcPlanes: M, tgtPlanes: M, srcDomains: ['a'], tgtDomains: ['b'], conduit: true })
    expect(declared.verdict).toBe('allowed')
    expect(declared.conduitClause).toBe('required-present')
  })
  it('lower-tier CONTROL-PLANE → RESTRICTED is an advisory (the SolarWinds shape)', () => {
    expect(V('INTERNAL', 'RESTRICTED', { srcPlanes: M, tgtPlanes: M }).verdict).toBe('advisory')
  })
  it('a lower-tier WORKLOAD calling a RESTRICTED management service is NOT the advisory (hub-and-spoke)', () => {
    // A plain INTERNAL app → a RESTRICTED+MANAGEMENT-only secrets manager / SIEM: the flow is
    // management-classified (target is MGMT-only), but the control-plane side is the TARGET —
    // the privilege advisory must not fire with inverted roles. It is the expected
    // hub-and-spoke shape: allowed with a conduit, soft warning without.
    const noConduit = V('INTERNAL', 'RESTRICTED', { tgtPlanes: M })
    expect(noConduit.planeClass).toBe('management')
    expect(noConduit.verdict).toBe('warning')
    expect(noConduit.conduitClause).toBe('required-missing')
    expect(V('INTERNAL', 'RESTRICTED', { tgtPlanes: M, conduit: true }).verdict).toBe('allowed')
  })
  it('RESTRICTED control-plane peer of a RESTRICTED workload is a legitimate same-tier pair', () => {
    // Same-tier control/workload pair (e.g. RESTRICTED+MANAGEMENT CI/CD ↔ RESTRICTED prod
    // store): never the advisory; allowed with the recommended conduit declared.
    const v = V('RESTRICTED', 'RESTRICTED', { srcPlanes: M, tgtPlanes: WM, conduit: true })
    expect(v.verdict).toBe('allowed')
    expect(V('RESTRICTED', 'RESTRICTED', { srcPlanes: M, tgtPlanes: WM }).verdict).toBe('warning') // recommended conduit missing
  })
  it('dual-tag [WORKLOAD, MANAGEMENT] resolves per counterpart', () => {
    // → a WORKLOAD-only peer: workload flow (gradient applies — cross-domain needs a conduit)
    const toWorkload = V('EXPOSED', 'INTERNAL', { srcPlanes: WM, tgtPlanes: W, srcDomains: ['a'], tgtDomains: ['b'] })
    expect(toWorkload.planeClass).toBe('workload')
    expect(toWorkload.verdict).toBe('warning')
    // → a MANAGEMENT peer: management flow; the dual-tagged source carries MANAGEMENT, so
    // reaching into RESTRICTED from a lower tier fires the privilege advisory.
    const toMgmt = V('INTERNAL', 'RESTRICTED', { srcPlanes: WM, tgtPlanes: M })
    expect(toMgmt.planeClass).toBe('management')
    expect(toMgmt.verdict).toBe('advisory')
  })
  it('external → management is still governed by the type axis (not force-flagged / not exempted)', () => {
    // UNTRUSTED → an INTERNAL management boundary stays a violation (type axis precedes the plane gate).
    expect(V('UNTRUSTED', 'INTERNAL', { tgtPlanes: M }).verdict).toBe('violation')
  })
})

describe('egress gate — RESTRICTED-initiated workload egress', () => {
  it('a RESTRICTED workload initiating a down-gradient flow is an advisory', () => {
    const v = V('RESTRICTED', 'INTERNAL')
    expect(v.verdict).toBe('advisory')
    expect(v.planeClass).toBe('workload')
  })
  it('but a RESTRICTED→(mgmt) flow takes the management lens, never the egress advisory', () => {
    // RESTRICTED workload → RESTRICTED SIEM (management-only target): a management flow —
    // same-tier peer, so no privilege advisory; the recommended-conduit clause applies instead.
    const v = V('RESTRICTED', 'RESTRICTED', { tgtPlanes: ['MANAGEMENT'] })
    expect(v.planeClass).toBe('management')
    expect(v.verdict).toBe('warning') // recommended conduit missing — never 'advisory'
    expect(V('RESTRICTED', 'RESTRICTED', { tgtPlanes: ['MANAGEMENT'], conduit: true }).verdict).toBe('allowed')
  })
})

describe('conduits — static error + the two-findings case', () => {
  it('a dead conduit encoding an illegal crossing is an error (no live flow needed)', () => {
    // EXPOSED → RESTRICTED same-domain skip is a violation; a conduit blessing it is an error.
    const { res } = evalCross('EXPOSED', 'RESTRICTED', { conduit: true, noFlow: true })
    expect(res.byFlow).toEqual({}) // no live flow
    expect(res.conduitErrors).toHaveLength(1)
    expect(res.conduitErrors[0]).toMatchObject({ sourceId: 's', peerId: 't', dead: true })
    expect(res.deadConduits).toHaveLength(0) // illegal-dead goes to errors, never the muted list
    expect(res.rollup.fails).toBe(true)
  })
  it('a live illegal crossing WITH a blessing conduit yields two findings (flow violation + conduit error)', () => {
    const { verdict, res } = evalCross('EXPOSED', 'RESTRICTED', { conduit: true })
    expect(verdict.verdict).toBe('violation')
    expect(verdict.conduitClause).toBe('error') // inline two-findings read
    expect(res.conduitErrors).toHaveLength(1)
    expect(res.conduitErrors[0].dead).toBe(false)
    expect(res.rollup.fails).toBe(true)
  })
  it('a conduit on a LEGAL crossing is not an error', () => {
    // cross-domain EXPOSED→INTERNAL with a conduit → allowed, no conduit error.
    const { res } = evalCross('EXPOSED', 'INTERNAL', { conduit: true, srcDomains: ['a'], tgtDomains: ['b'] })
    expect(res.conduitErrors).toHaveLength(0)
    expect(res.rollup.fails).toBe(false)
  })
  it('an INBOUND conduit mirror is ignored (OUTBOUND-canonical)', () => {
    // The same cross-domain crossing that a declared OUTBOUND conduit would allow stays a
    // warning when the declaration is an INBOUND mirror — direction is part of the approval.
    const v = V('EXPOSED', 'INTERNAL', { srcDomains: ['a'], tgtDomains: ['b'], conduit: true, conduitDirection: 'INBOUND' })
    expect(v.verdict).toBe('warning')
    expect(v.conduitClause).toBe('required-missing')
  })
  it('the flow token and the conduit-errors panel agree: a statically-LEGAL covering conduit is never blamed', () => {
    // Parent zone srcZ (INTERNAL) declares a conduit to peerZ (RESTRICTED) — statically legal
    // (same-domain single-step-up needs no conduit; the declaration is harmless intent). A child
    // pod inside srcZ declares itself EXPOSED and flows to a pod in peerZ: that flow is a
    // violation (EXPOSED ↦ RESTRICTED skip), but the covering conduit is NOT the culprit — the
    // flow must not read `conduit: error` and the panel must stay empty.
    const srcZ = bnd('srcZ', { conduits: [{ peerId: 'peerZ', direction: 'OUTBOUND', justification: 'zone channel' }] })
    const srcPod = bnd('srcPod', { parentBoundaryId: 'srcZ' })
    const peerZ = bnd('peerZ')
    const peerPod = bnd('peerPod', { parentBoundaryId: 'peerZ' })
    const mg = {
      boundaries: [srcZ, srcPod, peerZ, peerPod],
      components: [cmp('sc', 'srcPod'), cmp('tc', 'peerPod')],
      flows: [flow('f', 'sc', 'tc')],
    }
    const z = {
      effectiveZones: {
        srcZ: { zone: 'INTERNAL' }, srcPod: { zone: 'EXPOSED' },
        peerZ: { zone: 'RESTRICTED' }, peerPod: { zone: 'RESTRICTED' },
      },
    }
    const res = evaluateDataFlowPolicy(mg, z)
    expect(res.byFlow.f.verdict).toBe('violation')
    expect(res.byFlow.f.conduitClause).toBe('none') // the violation stands on its own
    expect(res.conduitErrors).toHaveLength(0)
    expect(res.rollup.fails).toBe(true) // the flow violation still fails the model
  })
})

describe('dead conduits — legally declared, no matching modeled flow', () => {
  it('a legal dormant conduit is listed with its justification', () => {
    const { res } = evalCross('EXPOSED', 'INTERNAL', {
      conduit: true, srcDomains: ['a'], tgtDomains: ['b'], noFlow: true, justification: 'approved channel',
    })
    expect(res.deadConduits).toHaveLength(1)
    expect(res.deadConduits[0]).toMatchObject({
      sourceId: 's', peerId: 't', justification: 'approved channel', unreviewable: false,
    })
    expect(res.conduitErrors).toHaveLength(0)
    expect(res.rollup.fails).toBe(false) // dead intent is a review surface, not a failure
  })
  it('a blank justification marks the dead conduit unreviewable', () => {
    const { res } = evalCross('EXPOSED', 'INTERNAL', {
      conduit: true, srcDomains: ['a'], tgtDomains: ['b'], noFlow: true, justification: '  ',
    })
    expect(res.deadConduits[0].unreviewable).toBe(true)
  })
  it('a conduit covered by a live descendant crossing is not dead (inheritance-aware liveness)', () => {
    const { res } = evalCross('EXPOSED', 'INTERNAL', { conduit: true, srcDomains: ['a'], tgtDomains: ['b'] })
    expect(res.deadConduits).toHaveLength(0)
  })
})

describe('conduit inheritance down the boundary tree (zone-level, not pod-by-pod)', () => {
  // srcZ (parent) ⊃ srcPod ; peerZ (parent) ⊃ peerPod. A cross-domain EXPOSED→INTERNAL crossing
  // requires a conduit; the pod→pod flow should be covered by a conduit declared at the ZONE level.
  const build = ({ conduitFrom, conduitPeer, flowSrc = 'srcPod', flowTgt = 'peerPod' } = {}) => {
    const srcZ = bnd('srcZ', { domains: ['a'] })
    const srcPod = bnd('srcPod', { parentBoundaryId: 'srcZ', domains: ['a'] })
    const peerZ = bnd('peerZ', { domains: ['b'] })
    const peerPod = bnd('peerPod', { parentBoundaryId: 'peerZ', domains: ['b'] })
    if (conduitFrom) {
      const decl = { srcZ, srcPod, peerZ, peerPod }[conduitFrom]
      decl.conduits = [{ peerId: conduitPeer, direction: 'OUTBOUND', justification: 'ratified' }]
    }
    const mg = {
      boundaries: [srcZ, srcPod, peerZ, peerPod],
      components: [cmp('sc', flowSrc), cmp('tc', flowTgt)],
      flows: [flow('f', 'sc', 'tc')],
    }
    const z = {
      effectiveZones: {
        srcZ: { zone: 'EXPOSED' }, srcPod: { zone: 'EXPOSED' },
        peerZ: { zone: 'INTERNAL' }, peerPod: { zone: 'INTERNAL' },
      },
    }
    return evaluateDataFlowPolicy(mg, z)
  }

  it('a zone-level conduit (parent → parent) covers the descendant pod → pod crossing', () => {
    const res = build({ conduitFrom: 'srcZ', conduitPeer: 'peerZ' })
    expect(res.byFlow.f.verdict).toBe('allowed')
    expect(res.byFlow.f.conduitClause).toBe('required-present')
  })
  it('inherits on the SOURCE side alone (parent-zone conduit → exact peer pod)', () => {
    expect(build({ conduitFrom: 'srcZ', conduitPeer: 'peerPod' }).byFlow.f.verdict).toBe('allowed')
  })
  it('inherits on the PEER side alone (exact source pod → parent-zone peer)', () => {
    expect(build({ conduitFrom: 'srcPod', conduitPeer: 'peerZ' }).byFlow.f.verdict).toBe('allowed')
  })
  it('without any conduit the same pod → pod crossing is a warning (missing required conduit)', () => {
    expect(build().byFlow.f.verdict).toBe('warning')
  })
  it('does NOT inherit upward — a conduit on a child never covers the parent\'s crossing', () => {
    // conduit declared on srcPod (child), but the flow is initiated from srcZ (parent) → not covered.
    const res = build({ conduitFrom: 'srcPod', conduitPeer: 'peerZ', flowSrc: 'srcZ' })
    expect(res.byFlow.f.verdict).toBe('warning')
  })
  it('a zone-level ILLEGAL conduit that covers a live descendant crossing reads live, not dead', () => {
    // srcZ(EXPOSED) → peerZ(RESTRICTED) same-domain skip: the conduit is statically illegal; a
    // live pod→pod flow under it makes it a live error (not a dead one).
    const srcZ = bnd('srcZ', { conduits: [{ peerId: 'peerZ', direction: 'OUTBOUND', justification: 'x' }] })
    const srcPod = bnd('srcPod', { parentBoundaryId: 'srcZ' })
    const peerZ = bnd('peerZ')
    const peerPod = bnd('peerPod', { parentBoundaryId: 'peerZ' })
    const mg = {
      boundaries: [srcZ, srcPod, peerZ, peerPod],
      components: [cmp('sc', 'srcPod'), cmp('tc', 'peerPod')],
      flows: [flow('f', 'sc', 'tc')], // pod → pod live flow (descendants of the conduit's endpoints)
    }
    const z = { effectiveZones: { srcZ: { zone: 'EXPOSED' }, srcPod: { zone: 'EXPOSED' }, peerZ: { zone: 'RESTRICTED' }, peerPod: { zone: 'RESTRICTED' } } }
    const res = evaluateDataFlowPolicy(mg, z)
    expect(res.conduitErrors).toHaveLength(1)
    expect(res.conduitErrors[0]).toMatchObject({ sourceId: 'srcZ', peerId: 'peerZ', dead: false }) // live via the descendant flow
    expect(res.byFlow.f.conduitClause).toBe('error') // the covering conduit IS the statically-illegal one
  })
})

describe('zoningAdvisories — per-boundary advisory routing to the findings ledger', () => {
  const mg = { boundaries: [bnd('b1', { name: 'Beta' }), bnd('b2', { name: 'Alpha' })] }
  it('groups the four advisory kinds, non-empty only, boundary-name sorted', () => {
    const zoning = {
      findings: [
        { kind: 'under-protected', boundaryId: 'b1', detail: 'asset exposed' },
        { kind: 'unclassified', boundaryId: 'b2', detail: '' },
        { kind: 'unclassified', boundaryId: 'b1', detail: '' },
        { kind: 'external-ingress', boundaryId: 'b1', peerId: 'b2' }, // excluded (per-flow policy covers it)
      ],
    }
    const adv = zoningAdvisories(zoning, mg)
    expect(adv.map((a) => a.kind)).toEqual(['unclassified', 'under-protected']) // fixed order, mgmt/cross-tier empty → omitted
    expect(adv[0].items.map((i) => i.name)).toEqual(['Alpha', 'Beta']) // name-sorted
    expect(adv.find((a) => a.kind === 'external-ingress')).toBeUndefined()
  })
  it('empty when no advisory findings', () => {
    expect(zoningAdvisories({ findings: [] }, mg)).toEqual([])
    expect(zoningAdvisories({}, {})).toEqual([])
  })
})

describe('byFlow keying, intra-boundary skip, and rollup', () => {
  it('keys verdicts by flowId and skips intra-boundary / dangling flows', () => {
    const a = bnd('a')
    const b = bnd('b')
    const mg = {
      boundaries: [a, b],
      components: [cmp('a1', 'a'), cmp('a2', 'a'), cmp('b1', 'b')],
      flows: [
        flow('cross', 'a1', 'b1'), // a → b crossing
        flow('intra', 'a1', 'a2'), // same boundary → skipped
        flow('dangle', 'a1', 'zzz'), // missing endpoint → skipped
      ],
    }
    const z = { effectiveZones: { a: { zone: 'INTERNAL' }, b: { zone: 'RESTRICTED' } } }
    const res = evaluateDataFlowPolicy(mg, z)
    expect(Object.keys(res.byFlow)).toEqual(['cross'])
    expect(res.byFlow.cross.verdict).toBe('allowed') // INTERNAL→RESTRICTED same-domain +1
  })
  it('empty inputs → empty buckets, does not throw, does not fail', () => {
    const res = evaluateDataFlowPolicy({}, {})
    expect(res.byFlow).toEqual({})
    expect(res.conduitErrors).toEqual([])
    expect(res.deadConduits).toEqual([])
    expect(res.rollup.fails).toBe(false)
  })
  it('an undeclared boundary (no effectiveZones entry) defaults to INTERNAL', () => {
    const mg = { boundaries: [bnd('s'), bnd('t')], components: [cmp('sc', 's'), cmp('tc', 't')], flows: [flow('f', 'sc', 'tc')] }
    const res = evaluateDataFlowPolicy(mg, { effectiveZones: {} })
    expect(res.byFlow.f.srcZone).toBe('INTERNAL')
    expect(res.byFlow.f.tgtZone).toBe('INTERNAL')
    expect(res.byFlow.f.verdict).toBe('allowed') // INTERNAL→INTERNAL same tier
  })
})
