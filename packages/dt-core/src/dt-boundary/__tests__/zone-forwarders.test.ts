/**
 * External ingress masked by forwarders: an external boundary that reaches a trusted tier only through
 * relaying hops (a load balancer, proxy, VPN gateway, firewall or router in an exposed tier) is the same
 * crossing as a direct one, and raises the same `external-ingress` finding, naming the hops.
 */
import { describe, it, expect } from 'vitest'
import { buildZoningContext, computeZoningFindings, isForwarder, type ZoningFinding } from '../zone-determination.js'
import type { ModelStructure, StructureBoundary, StructureComponent } from '../../schemas/structure.schema.js'
import type { DataFlow } from '../../schemas/dataflows.schema.js'
import type { Zone } from '../../interfaces/core-types-interface.js'

const LB = { id: 'cda026ac-62af-4222-8523-155bc669c77a', name: 'Load Balancer' }
const PROXY = { id: '4040841b-5db7-46b2-80c7-a2bca302816d', name: 'Reverse Proxy / WAF Appliance' }
const VPN = { id: '5ea503cc-b336-4f9d-8ae3-69ae06e76666', name: 'VPN Gateway' }
const FIREWALL = { id: 'd58e96ad-b094-47de-81c3-656e28ea94a5', name: 'Firewall' }
const ROUTER = { id: 'cb7e1f14-416a-4b9d-8abb-3d9e07c58559', name: 'Network Router' }
const API_GATEWAY = { id: '6d723569-dc75-47dd-8f77-aa679dba1d54', name: 'API Gateway' }
const SERVICE = { id: 'cls-service', name: 'Application Service' }

const comp = (id: string, extra: Partial<StructureComponent> = {}): StructureComponent => ({ id, name: id, type: 'PROCESS', positionX: 0, positionY: 0, ...extra })
const ext = (id: string) => comp(id, { type: 'EXTERNAL_ENTITY' })
const fwd = (id: string, cls = LB) => comp(id, { classData: cls })
const svc = (id: string) => comp(id, { classData: SERVICE })
const bnd = (id: string, zone: Zone | undefined, components: StructureComponent[], extra: Partial<StructureBoundary> = {}): StructureBoundary =>
  ({ id, name: id, ...(zone ? { zone } : {}), components, ...extra })
const flow = (src: string, tgt: string): DataFlow => ({ id: `${src}->${tgt}`, name: `${src}->${tgt}`, source: { id: src }, target: { id: tgt } })
const model = (boundaries: StructureBoundary[], rootComponents: StructureComponent[] = []): ModelStructure =>
  ({ defaultBoundary: { id: 'root', name: 'root', boundaries, components: rootComponents } })

const ingress = (s: ModelStructure, flows: DataFlow[]): string[] =>
  computeZoningFindings(buildZoningContext(s, flows, []))
    .filter((f) => f.kind === 'external-ingress')
    .map((f) => `${f.boundaryId}->${f.peerId}${f.via ? ` via ${f.via.join('>')}` : ''}`)
    .sort()
const findings = (s: ModelStructure, flows: DataFlow[]): ZoningFinding[] => computeZoningFindings(buildZoningContext(s, flows, []))

/** vendor → a forwarder in a PUBLIC tier → a service in a tier of `zone`. */
const masked = (forwarder: StructureComponent, zone: Zone = 'INTERNAL', source: Zone = 'VENDOR') => model([
  bnd('vendor', source, [ext('v')]),
  bnd('edge', 'PUBLIC', [forwarder]),
  bnd('app', zone, [svc('s')]),
])
const maskedFlows = (fid: string) => [flow('v', fid), flow(fid, 's')]

describe('a masked crossing raises external-ingress onto the trusted tier, naming the forwarders', () => {
  it('vendor → load balancer (PUBLIC) → service (INTERNAL, or RESTRICTED); an untrusted source too', () => {
    expect(ingress(masked(fwd('lb')), maskedFlows('lb'))).toEqual(['vendor->app via lb'])
    expect(ingress(masked(fwd('lb'), 'RESTRICTED'), maskedFlows('lb'))).toEqual(['vendor->app via lb'])
    expect(ingress(masked(fwd('lb'), 'INTERNAL', 'UNTRUSTED'), maskedFlows('lb'))).toEqual(['vendor->app via lb'])
  })

  it('every forwarding class, by id or by its exact name under another id', () => {
    for (const cls of [LB, PROXY, VPN, FIREWALL, ROUTER]) {
      expect(ingress(masked(fwd('f', cls)), maskedFlows('f')), cls.name).toEqual(['vendor->app via f'])
      expect(ingress(masked(fwd('f', { id: 'other-module-id', name: cls.name })), maskedFlows('f')), cls.name).toEqual(['vendor->app via f'])
    }
  })

  it('the finding carries the forwarder ids, the peer, and a detail naming the hop and the remedies', () => {
    const [f] = findings(masked(fwd('lb', LB)), maskedFlows('lb')).filter((x) => x.kind === 'external-ingress')
    expect(f).toMatchObject({ boundaryId: 'vendor', peerId: 'app', via: ['lb'], viaIds: ['lb'], severity: 'warning' })
    expect(f!.detail).toMatch(/reaches app \(a trusted tier\) through lb .*ratify a conduit to app.*declare app Exposed/)
  })

  it('a chain of forwarders, in order; no hop bound', () => {
    const s = model([
      bnd('vendor', 'VENDOR', [ext('v')]),
      bnd('edge', 'PUBLIC', [fwd('waf', PROXY), fwd('lb', LB), fwd('fw', FIREWALL), fwd('rt', ROUTER)]),
      bnd('app', 'INTERNAL', [svc('s')]),
    ])
    expect(ingress(s, [flow('v', 'waf'), flow('waf', 'lb'), flow('lb', 's')])).toEqual(['vendor->app via waf>lb'])
    expect(ingress(s, [flow('v', 'waf'), flow('waf', 'lb'), flow('lb', 'fw'), flow('fw', 'rt'), flow('rt', 's')])).toEqual(['vendor->app via waf>lb>fw>rt'])
  })

  it('the unclassified name alias: load balancers and proxies only, as whole words, processes only', () => {
    for (const name of ['Webhook LB', 'webhook_lb', 'LoadBalancer', 'Load-Balancer', 'edge ALB', 'Reverse proxy', 'WAF', 'Ingress Controller']) {
      expect(isForwarder({ name, type: 'PROCESS' }), name).toBe(true)
    }
    for (const name of ['Blob store', 'Albany office', 'Wafer scanner', 'nginx', 'API gateway', 'core router', 'Ops bastion', 'firewall']) {
      expect(isForwarder({ name, type: 'PROCESS' }), name).toBe(false)
    }
    expect(isForwarder({ name: 'Webhook LB', type: 'STORE' })).toBe(false)
    // A classified element is judged by its class, never by its name.
    expect(isForwarder({ name: 'Webhook LB', type: 'PROCESS', classData: API_GATEWAY })).toBe(false)
    expect(isForwarder({ name: 'Webhook LB', type: 'PROCESS', classData: SERVICE })).toBe(false)
    expect(isForwarder({ name: 'Webhook LB', type: 'PROCESS', classData: { id: '', name: 'API Gateway' } })).toBe(false)
    expect(isForwarder({ name: 'edge', type: 'PROCESS', classData: { id: '', name: 'Load Balancer' } })).toBe(true)
  })
})

describe('not a masked crossing', () => {
  it('an API gateway terminates the request (EXPOSED or PUBLIC tier)', () => {
    for (const zone of ['EXPOSED', 'PUBLIC'] as Zone[]) {
      const s = model([bnd('vendor', 'VENDOR', [ext('v')]), bnd('edge', zone, [fwd('gw', API_GATEWAY)]), bnd('app', 'INTERNAL', [svc('s')])])
      expect(ingress(s, [flow('v', 'gw'), flow('gw', 's')]), zone).toEqual([])
    }
  })

  it('no external source: an internal source behind a load balancer, or a firewall between two internal tiers', () => {
    const lb = model([bnd('ops', 'INTERNAL', [svc('o')]), bnd('edge', 'PUBLIC', [fwd('lb')]), bnd('app', 'INTERNAL', [svc('s')])])
    expect(ingress(lb, [flow('o', 'lb'), flow('lb', 's')])).toEqual([])
    const fw = model([bnd('a', 'INTERNAL', [svc('x')]), bnd('b', 'INTERNAL', [fwd('fw', FIREWALL)]), bnd('c', 'INTERNAL', [svc('y')])])
    expect(ingress(fw, [flow('x', 'fw'), flow('fw', 'y')])).toEqual([])
  })

  it('the tier reached is not trusted: a load balancer or a VPN gateway in front of a PUBLIC or EXPOSED tier', () => {
    for (const zone of ['PUBLIC', 'EXPOSED'] as Zone[]) {
      expect(ingress(masked(fwd('lb'), zone), maskedFlows('lb')), zone).toEqual([])
      expect(ingress(masked(fwd('vpn', VPN), zone), maskedFlows('vpn')), zone).toEqual([])
    }
  })

  it('a decoy: a gateway between the forwarders breaks the chain', () => {
    const s = model([
      bnd('vendor', 'VENDOR', [ext('v')]),
      bnd('edge', 'PUBLIC', [fwd('lb'), fwd('gw', API_GATEWAY)]),
      bnd('app', 'INTERNAL', [svc('s')]),
    ])
    expect(ingress(s, [flow('v', 'lb'), flow('lb', 'gw'), flow('gw', 's')])).toEqual([])
  })

  it('against the flow direction', () => {
    expect(ingress(masked(fwd('lb')), [flow('s', 'lb'), flow('lb', 'v')])).toEqual([])
  })

  it('E and T nested in one another', () => {
    const s = model([bnd('vendor', 'VENDOR', [ext('v')], { boundaries: [bnd('inner', 'INTERNAL', [svc('s')])] }), bnd('edge', 'PUBLIC', [fwd('lb')])])
    expect(ingress(s, [flow('v', 'lb'), flow('lb', 's')])).toEqual([])
  })

  it('a forwarder in a trusted or unzoned tier: the direct rule reports the crossing onto that tier', () => {
    const unzoned = model([bnd('vendor', 'VENDOR', [ext('v')]), bnd('mid', undefined, [fwd('lb')]), bnd('app', 'INTERNAL', [svc('s')])])
    expect(ingress(unzoned, [flow('v', 'lb'), flow('lb', 's')])).toEqual(['vendor->mid'])
  })

  it("a forwarder in the external boundary itself: only the direct crossing", () => {
    const s = model([bnd('vendor', 'VENDOR', [ext('v'), fwd('lb')]), bnd('app', 'INTERNAL', [svc('s')])])
    expect(ingress(s, [flow('v', 'lb'), flow('lb', 's')])).toEqual(['vendor->app'])
  })

  it('a forwarder at the root, and a structural container as the tier reached', () => {
    const root = model([bnd('vendor', 'VENDOR', [ext('v')]), bnd('app', 'INTERNAL', [svc('s')])], [fwd('lb')])
    expect(ingress(root, [flow('v', 'lb'), flow('lb', 's')])).toEqual([])
    const container = model([
      bnd('vendor', 'VENDOR', [ext('v')]),
      bnd('edge', 'PUBLIC', [fwd('lb')]),
      bnd('vpc', 'INTERNAL', [svc('s')], { boundaries: [bnd('sub', 'INTERNAL', [svc('t')])] }),
    ])
    expect(ingress(container, [flow('v', 'lb'), flow('lb', 's')])).toEqual([])
    expect(ingress(container, [flow('v', 'lb'), flow('lb', 't')])).toEqual(['vendor->sub via lb'])
  })
})

describe('the direct rule and approved channels', () => {
  it('the direct rule wins: a direct edge E→T reports once, with no via, conduit or not', () => {
    const s = masked(fwd('lb'))
    expect(ingress(s, [...maskedFlows('lb'), flow('v', 's')])).toEqual(['vendor->app'])
    // The direct edge reaches one component of the tier, the forwarder another: still the one direct finding.
    const two = model([bnd('vendor', 'VENDOR', [ext('v')]), bnd('edge', 'PUBLIC', [fwd('lb')]), bnd('app', 'INTERNAL', [svc('s1'), svc('s2')])])
    expect(ingress(two, [flow('v', 's1'), flow('v', 'lb'), flow('lb', 's2')])).toEqual(['vendor->app'])
    const ratified = model([
      bnd('vendor', 'VENDOR', [ext('v')], { conduits: [{ peerId: 'app', direction: 'OUTBOUND', justification: 'webhooks' }] }),
      bnd('edge', 'PUBLIC', [fwd('lb')]),
      bnd('app', 'INTERNAL', [svc('s')]),
    ])
    expect(ingress(ratified, [...maskedFlows('lb'), flow('v', 's')])).toEqual([])
  })

  it('a conduit E→T ratifies the masked crossing and is not dead intent; the INBOUND mirror on T too', () => {
    const outbound = model([
      bnd('vendor', 'VENDOR', [ext('v')], { conduits: [{ peerId: 'app', direction: 'OUTBOUND', justification: 'webhooks' }] }),
      bnd('edge', 'PUBLIC', [fwd('lb')]),
      bnd('app', 'INTERNAL', [svc('s')]),
    ])
    const f = findings(outbound, maskedFlows('lb'))
    expect(f.filter((x) => x.kind === 'external-ingress')).toEqual([])
    expect(f.filter((x) => x.kind === 'flow-channel' && /dead intent/.test(x.detail))).toEqual([])
    const inbound = model([
      bnd('vendor', 'VENDOR', [ext('v')]),
      bnd('edge', 'PUBLIC', [fwd('lb')]),
      bnd('app', 'INTERNAL', [svc('s')], { conduits: [{ peerId: 'vendor', direction: 'INBOUND', justification: 'webhooks' }] }),
    ])
    expect(ingress(inbound, maskedFlows('lb'))).toEqual([])
  })

  it("a conduit to the forwarder's tier does not ratify the crossing behind it", () => {
    const s = model([
      bnd('vendor', 'VENDOR', [ext('v')], { conduits: [{ peerId: 'edge', direction: 'OUTBOUND', justification: 'to the balancer' }] }),
      bnd('edge', 'PUBLIC', [fwd('lb')]),
      bnd('app', 'INTERNAL', [svc('s')]),
    ])
    expect(ingress(s, maskedFlows('lb'))).toEqual(['vendor->app via lb'])
  })

  it('a conduit with no path at all is still dead intent; one whose path now runs through a trusted tier is not', () => {
    const none = model([
      bnd('vendor', 'VENDOR', [ext('v')], { conduits: [{ peerId: 'app', direction: 'OUTBOUND', justification: 'x' }] }),
      bnd('app', 'INTERNAL', [svc('s')]),
    ])
    expect(findings(none, []).some((x) => x.kind === 'flow-channel' && /dead intent/.test(x.detail))).toBe(true)
    // Nor does a forwarder at the root connect anything.
    const viaRoot = model([
      bnd('vendor', 'VENDOR', [ext('v')], { conduits: [{ peerId: 'app', direction: 'OUTBOUND', justification: 'x' }] }),
      bnd('app', 'INTERNAL', [svc('s')]),
    ], [fwd('lb')])
    expect(findings(viaRoot, [flow('v', 'lb'), flow('lb', 's')]).some((x) => x.kind === 'flow-channel' && /dead intent/.test(x.detail))).toBe(true)
    // The forwarder's tier is declared Internal later: no longer masked, but the flow still runs.
    const rezoned = model([
      bnd('vendor', 'VENDOR', [ext('v')], { conduits: [{ peerId: 'app', direction: 'OUTBOUND', justification: 'webhooks' }] }),
      bnd('edge', 'INTERNAL', [fwd('lb')]),
      bnd('app', 'INTERNAL', [svc('s')]),
    ])
    expect(findings(rezoned, maskedFlows('lb')).some((x) => x.kind === 'flow-channel' && /dead intent/.test(x.detail))).toBe(false)
  })
})

describe('the search', () => {
  it('ends on a forwarder cycle, with one finding', () => {
    const s = model([bnd('vendor', 'VENDOR', [ext('v')]), bnd('edge', 'PUBLIC', [fwd('lb1'), fwd('lb2')]), bnd('app', 'INTERNAL', [svc('s')])])
    expect(ingress(s, [flow('v', 'lb1'), flow('lb1', 'lb2'), flow('lb2', 'lb1'), flow('lb2', 's')])).toEqual(['vendor->app via lb1>lb2'])
  })

  it('gives the same findings whatever the order of the flows, and one per (E, T)', () => {
    const s = model([
      bnd('vendor', 'VENDOR', [ext('v1'), ext('v2')]),
      bnd('edge', 'PUBLIC', [fwd('lb-a'), fwd('lb-b')]),
      bnd('app', 'INTERNAL', [svc('s1'), svc('s2')]),
    ])
    const flows = [flow('v1', 'lb-b'), flow('v2', 'lb-a'), flow('lb-a', 's2'), flow('lb-b', 's1'), flow('lb-a', 's1')]
    const a = findings(s, flows)
    const b = findings(s, [...flows].reverse())
    expect(b).toEqual(a)
    expect(a.filter((x) => x.kind === 'external-ingress')).toEqual([expect.objectContaining({ boundaryId: 'vendor', peerId: 'app', via: ['lb-b'] })])
  })

  it('takes the forwarders in name order, not in the order the flows are listed', () => {
    const s = model([bnd('vendor', 'VENDOR', [ext('v')]), bnd('edge', 'PUBLIC', [fwd('lb-a'), fwd('lb-b')]), bnd('app', 'INTERNAL', [svc('s')])])
    const flows = [flow('v', 'lb-b'), flow('v', 'lb-a'), flow('lb-b', 's'), flow('lb-a', 's')]
    expect(ingress(s, flows)).toEqual(['vendor->app via lb-a'])
    expect(ingress(s, [...flows].reverse())).toEqual(['vendor->app via lb-a'])
  })

  it('fans out: 3 external boundaries × 8 backend tiers behind one balancer give 24 findings', () => {
    const externals = [1, 2, 3].map((i) => bnd(`ext${i}`, 'UNTRUSTED', [ext(`x${i}`)]))
    const backends = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => bnd(`app${i}`, 'INTERNAL', [svc(`s${i}`)]))
    const s = model([...externals, bnd('edge', 'PUBLIC', [fwd('lb')]), ...backends])
    const flows = [...[1, 2, 3].map((i) => flow(`x${i}`, 'lb')), ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => flow('lb', `s${i}`))]
    expect(ingress(s, flows)).toHaveLength(24)
  })
})

describe('an order-desk shape: two masked crossings', () => {
  it('the vendor reaches the orders tier through the webhook balancer, the internet reaches the database tier through the bastion', () => {
    const s = model([
      bnd('internet', 'UNTRUSTED', [ext('customer'), ext('engineer')]),
      bnd('payments', 'VENDOR', [ext('vendor')]),
      bnd('lb-tier', 'PUBLIC', [comp('edge-lb', { name: 'Edge Load Balancer', classData: LB }), comp('webhook-lb', { name: 'Webhook Load Balancer', classData: LB })]),
      bnd('ops', 'PUBLIC', [comp('bastion', { name: 'Ops Bastion', classData: VPN })]),
      bnd('edge-ns', 'EXPOSED', [comp('gateway', { name: 'Edge Gateway', classData: API_GATEWAY })]),
      bnd('orders-ns', 'INTERNAL', [svc('orders-api'), svc('receiver')]),
      bnd('db-tier', 'INTERNAL', [comp('db', { type: 'STORE', classData: { id: 'cls-db', name: 'Relational Database' } })]),
    ])
    const flows = [
      flow('customer', 'edge-lb'), flow('edge-lb', 'gateway'), flow('gateway', 'orders-api'), flow('orders-api', 'db'),
      flow('vendor', 'webhook-lb'), flow('webhook-lb', 'receiver'), flow('receiver', 'db'),
      flow('engineer', 'bastion'), flow('bastion', 'db'),
    ]
    expect(ingress(s, flows)).toEqual(['internet->db-tier via Ops Bastion', 'payments->orders-ns via Webhook Load Balancer'])
  })
})
