/**
 * validate_model_json `zoning` reports an external crossing masked by forwarding hops as `external-ingress`
 * onto the trusted tier behind them, naming the hops, in both phases: it needs no asset.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { validateModelTool } from '../validate-model.tool.js'

const context = { debug: false }
const LB = { id: 'cda026ac-62af-4222-8523-155bc669c77a', name: 'Load Balancer' }
const VPN = { id: '5ea503cc-b336-4f9d-8ae3-69ae06e76666', name: 'VPN Gateway' }
const GATEWAY = { id: '6d723569-dc75-47dd-8f77-aa679dba1d54', name: 'API Gateway' }
const SERVICE = { id: 'cls-service', name: 'Application Service' }

const comp = (id: string, name: string, type: string, classData?: { id: string; name: string }, extra: Record<string, unknown> = {}) =>
  ({ id, name, type, positionX: 0, positionY: 0, ...(classData ? { classData } : {}), ...extra })
const bnd = (id: string, name: string, zone: string, components: unknown[]) => ({ id, name, zone, components, boundaries: [] })
const flow = (id: string, source: string, target: string) => ({ id, name: id, source: { id: source }, target: { id: target } })

/** An order desk: a public load-balancer tier, an exposed gateway, an internal orders tier and database tier. */
const structure = {
  defaultBoundary: {
    id: 'root', name: 'Order desk', components: [],
    boundaries: [
      bnd('internet', 'Internet', 'UNTRUSTED', [comp('customer', 'Customer', 'EXTERNAL_ENTITY'), comp('engineer', 'On-call Engineer', 'EXTERNAL_ENTITY')]),
      bnd('payments', 'Payment Vendor', 'VENDOR', [comp('vendor', 'Payment Vendor', 'EXTERNAL_ENTITY')]),
      bnd('lb-tier', 'Public Load Balancer Tier', 'PUBLIC', [comp('edge-lb', 'Edge Load Balancer', 'PROCESS', LB), comp('webhook-lb', 'Webhook Load Balancer', 'PROCESS', LB)]),
      bnd('ops', 'Operations Subnet', 'PUBLIC', [comp('bastion', 'Ops Bastion', 'PROCESS', VPN)]),
      bnd('edge-ns', 'edge namespace', 'EXPOSED', [comp('gateway', 'Edge Gateway', 'PROCESS', GATEWAY)]),
      bnd('orders-ns', 'orders namespace', 'INTERNAL', [comp('orders-api', 'Orders API', 'PROCESS', SERVICE), comp('receiver', 'Webhook Receiver', 'PROCESS', SERVICE)]),
      bnd('db-tier', 'Private DB Subnets', 'INTERNAL', [comp('db', 'Orders Database', 'STORE', { id: 'cls-db', name: 'Relational Database' }, { crownJewel: true })]),
    ],
  },
}
const flows = [
  flow('f1', 'customer', 'edge-lb'), flow('f2', 'edge-lb', 'gateway'), flow('f3', 'gateway', 'orders-api'), flow('f4', 'orders-api', 'db'),
  flow('f5', 'vendor', 'webhook-lb'), flow('f6', 'webhook-lb', 'receiver'), flow('f7', 'receiver', 'db'),
  flow('f8', 'engineer', 'bastion'), flow('f9', 'bastion', 'db'),
]

describe('validate_model_json zoning: ingress masked by forwarders', () => {
  const dir = path.resolve('./__zoning_forwarders_model__')
  beforeAll(async () => {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: '2.0.0', format: 'split', model: { id: null, name: 'z', defaultBoundaryId: 'root' }, modules: [] }))
    await fs.writeFile(path.join(dir, 'structure.json'), JSON.stringify(structure))
    await fs.writeFile(path.join(dir, 'dataflows.json'), JSON.stringify(flows))
    await fs.writeFile(path.join(dir, 'data-items.json'), JSON.stringify({ dataItems: [] }))
  })
  afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }) })

  for (const assets of ['skeleton', 'full'] as const) {
    it(`reports both masked crossings, with the hops, in the ${assets} phase`, async () => {
      const result = await validateModelTool.run({ action: 'zoning', directory_path: dir, assets } as never, context)
      expect(result.success, result.error).toBe(true)
      const ingress = (result.data as any).findings.filter((f: any) => f.kind === 'external-ingress')
        .map((f: any) => ({ from: f.boundaryId, to: f.peerId, via: f.via }))
        .sort((a: any, b: any) => (a.from < b.from ? -1 : 1))
      expect(ingress).toEqual([
        { from: 'internet', to: 'db-tier', via: ['Ops Bastion'] },
        { from: 'payments', to: 'orders-ns', via: ['Webhook Load Balancer'] },
      ])
    })
  }
})
