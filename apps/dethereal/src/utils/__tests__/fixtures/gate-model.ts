/**
 * A small model that passes Gates 1–3, for tests to break one rule at a time.
 *
 * Shape: an untrusted Internet zone with two external actors, a PUBLIC edge
 * (Tier 1), two INTERNAL application zones (Tier 3) and a RESTRICTED data zone
 * holding the crown jewel (Tier 2). Every boundary has two children, every flow
 * is named and described, and every value is an honest answer.
 */
import { promises as fs } from 'fs'
import path from 'path'

export interface GateModel {
  manifest: Record<string, any>
  structure: { defaultBoundary: Record<string, any> }
  dataFlows: Array<Record<string, any>>
  dataItems: Array<Record<string, any>>
  /** Attribute files by group, then element id; the value is the file content. */
  attributes: Record<'boundaries' | 'components' | 'dataFlows' | 'dataItems', Record<string, Record<string, any>>>
  /** Class-cache entries by file name (without `.json`). */
  classCache: Record<string, Record<string, any>>
  /** `.dethereal/scope.json`; `null` writes no file. */
  scope: Record<string, any> | null
}

/** Class ids of the stock data classes, as shipped by the general module. */
export const DATA_CLASS = {
  authTokens: { id: '2bc04479-7e0c-43f2-88b5-9fe788860642', name: 'Authentication Tokens' },
  userCredentials: { id: 'a6406f69-a0ec-48c9-a9dd-27b3c03bbda8', name: 'User Credentials' },
  customerData: { id: '7d6f45d4-3b84-49f3-8085-7105b0448706', name: 'Customer & Personal Data' },
  securityLogs: { id: '5e0eb7c5-6a23-496f-82be-e98e12f252af', name: 'Security Logs' },
} as const

const FLOOR = {
  authentication_type: { type: 'string' },
  encryption_in_transit: { type: 'string' },
  encryption_at_rest: { type: 'string' },
  implicit_deny_enabled: { type: 'boolean', default: false },
  monitoring_tools: { type: 'array', items: { type: 'string' } },
}

/** The module every fixture class comes from, as the platform names it in a class-cache entry. */
export const FIXTURE_MODULE = { id: 'mod-general', name: 'dethernety-general' }

function cacheEntry(classId: string, className: string, classType: string, properties: Record<string, any>) {
  return { classId, className, classType, module: FIXTURE_MODULE, template: { schema: { type: 'object', properties } } }
}

let placed = 0
/** Distinct, laid-out positions (parent-relative), so no two siblings overlap. */
const nextPosition = () => ({ positionX: 40 + (placed % 2) * 200, positionY: 40 + Math.floor(placed++ / 2) * 200 })

const component = (id: string, name: string, type: string, classId: string, className: string, extra: Record<string, any> = {}) => ({
  id, name, description: `${name}.`, type, ...nextPosition(),
  classData: { id: classId, name: className }, ...extra,
})

const external = (id: string, name: string) => ({ id, name, description: `${name}.`, type: 'EXTERNAL_ENTITY', ...nextPosition() })

const flow = (id: string, name: string, source: string, target: string, classId: string, className: string, dataItemIds: string[]) => ({
  id, name, description: `${name}.`, source: { id: source }, target: { id: target },
  classData: { id: classId, name: className }, dataItemIds,
})

function attrFile(elementType: string, elementId: string, elementName: string, classData: { id: string; name: string }, attributes: Record<string, any>) {
  return { elementId, elementType, elementName, classData, attributes }
}

const HARDENED = {
  authentication_type: 'oidc',
  encryption_in_transit: 'TLS 1.3',
  encryption_at_rest: 'AES-256',
  implicit_deny_enabled: true,
  monitoring_tools: ['cloud audit log'],
}

export function gateModel(): GateModel {
  placed = 0
  const gw = { id: 'cls-gateway', name: 'API Gateway' }
  const svc = { id: 'cls-service', name: 'Application Service' }
  const db = { id: 'cls-database', name: 'Database' }
  const https = { id: 'cls-https', name: 'HTTP/S Request' }
  const query = { id: 'cls-query', name: 'Database Query' }

  const structure = {
    defaultBoundary: {
      id: 'b-root', name: 'Shop', description: 'Shop deployment.',
      boundaries: [
        { id: 'b-internet', name: 'Internet', zone: 'UNTRUSTED', components: [external('x-customer', 'Customer browser'), external('x-operator', 'Operator workstation')] },
        {
          id: 'b-edge', name: 'Edge', zone: 'PUBLIC',
          components: [
            component('c-gateway', 'API gateway', 'PROCESS', gw.id, gw.name, { dataItemIds: ['d-session'] }),
            component('c-web', 'Web frontend', 'PROCESS', svc.id, svc.name, { dataItemIds: ['d-session'] }),
          ],
        },
        {
          id: 'b-app', name: 'Application', zone: 'INTERNAL',
          components: [
            component('c-orders', 'Order service', 'PROCESS', svc.id, svc.name, { dataItemIds: ['d-order'] }),
            component('c-notify', 'Notifier', 'PROCESS', svc.id, svc.name),
          ],
        },
        {
          id: 'b-batch', name: 'Batch', zone: 'INTERNAL',
          components: [
            component('c-jobs', 'Job runner', 'PROCESS', svc.id, svc.name),
            component('c-report', 'Report builder', 'PROCESS', svc.id, svc.name),
          ],
        },
        {
          id: 'b-data', name: 'Data', zone: 'RESTRICTED',
          components: [
            component('c-db', 'Orders database', 'STORE', db.id, db.name, { crownJewel: true, dataItemIds: ['d-order', 'd-card'] }),
            component('c-audit', 'Audit log store', 'STORE', db.id, db.name, { dataItemIds: ['d-audit'] }),
          ],
        },
      ],
    },
  }

  const dataFlows = [
    flow('f-checkout', 'Checkout request', 'x-customer', 'c-gateway', https.id, https.name, ['d-card', 'd-session']),
    flow('f-admin', 'Admin console', 'x-operator', 'c-gateway', https.id, https.name, ['d-session']),
    flow('f-render', 'Page render', 'c-gateway', 'c-web', https.id, https.name, ['d-session']),
    flow('f-submit', 'Order submit', 'c-web', 'c-orders', https.id, https.name, ['d-order']),
    flow('f-write', 'Order write', 'c-orders', 'c-db', query.id, query.name, ['d-order', 'd-card']),
    flow('f-notify', 'Order notification', 'c-orders', 'c-notify', https.id, https.name, ['d-order']),
    flow('f-report', 'Report feed', 'c-orders', 'c-report', query.id, query.name, ['d-order']),
    flow('f-audit', 'Audit append', 'c-jobs', 'c-audit', query.id, query.name, ['d-audit']),
  ]

  const dataItems = [
    { id: 'd-card', name: 'Card data', description: 'Card data.', classData: DATA_CLASS.customerData, sensitivity: 'restricted', regulatory_flags: ['PCI cardholder'] },
    { id: 'd-session', name: 'Session token', description: 'Session token.', classData: DATA_CLASS.authTokens, sensitivity: 'restricted', regulatory_flags: [] },
    { id: 'd-order', name: 'Order record', description: 'Order record.', classData: DATA_CLASS.customerData, sensitivity: 'confidential', regulatory_flags: ['PII'] },
    { id: 'd-audit', name: 'Audit event', description: 'Audit event.', classData: DATA_CLASS.securityLogs, sensitivity: 'internal', regulatory_flags: [] },
  ]

  const componentAttrs: Record<string, Record<string, any>> = {}
  const addComponent = (id: string, name: string, cls: { id: string; name: string }, extra: Record<string, any>) => {
    componentAttrs[id] = attrFile('component', id, name, cls, { ...HARDENED, ...extra })
  }
  addComponent('c-gateway', 'API gateway', gw, { rate_limiting_enabled: true, waf_mode: 'block' })
  addComponent('c-web', 'Web frontend', svc, { input_validation: 'schema', runs_as_root: false })
  addComponent('c-orders', 'Order service', svc, { input_validation: 'schema', runs_as_root: false })
  addComponent('c-notify', 'Notifier', svc, { input_validation: 'none', runs_as_root: false })
  addComponent('c-jobs', 'Job runner', svc, { input_validation: 'none', runs_as_root: false })
  addComponent('c-report', 'Report builder', svc, { input_validation: 'schema', runs_as_root: true })
  addComponent('c-db', 'Orders database', db, { backups_encrypted: true, credential_scope: ['db-app-cred'] })
  addComponent('c-audit', 'Audit log store', db, { backups_encrypted: false, credential_scope: [] })

  const flowAttrs: Record<string, Record<string, any>> = {}
  const httpsAttrs = { auth_failure_mode: 'deny', encryption_in_transit: 'TLS 1.3', credential_type: 'oauth_token' }
  for (const f of dataFlows) {
    const cls = f.classData
    flowAttrs[f.id] = attrFile('dataFlow', f.id, f.name, cls, cls.id === https.id
      ? { ...httpsAttrs, required_credentials: [`${f.id.slice(2)}-token`] }
      : { auth_failure_mode: 'fail_open', encryption_in_transit: 'TLS 1.2', flow_tls_encrypted: true, required_credentials: [] })
  }
  flowAttrs['f-write']!.attributes.required_credentials = ['db-app-cred']
  // Answered only through the class-template transit key.
  delete flowAttrs['f-report']!.attributes.encryption_in_transit

  const classCache = {
    [gw.id]: cacheEntry(gw.id, gw.name, 'component', {
      ...FLOOR, rate_limiting_enabled: { type: 'boolean', default: false }, waf_mode: { type: 'string', enum: ['off', 'detect', 'block'] },
    }),
    [svc.id]: cacheEntry(svc.id, svc.name, 'component', {
      ...FLOOR, input_validation: { type: 'string', enum: ['none', 'allow_list', 'schema'] }, runs_as_root: { type: 'boolean', default: true },
    }),
    [db.id]: cacheEntry(db.id, db.name, 'component', {
      ...FLOOR, backups_encrypted: { type: 'boolean', default: false }, credential_scope: { type: 'array', items: { type: 'string' } },
    }),
    [https.id]: cacheEntry(https.id, https.name, 'dataflow', {
      auth_failure_mode: { type: 'string', enum: ['deny', 'fallback', 'fail_open', 'unknown'] },
      encryption_in_transit: { type: 'string' },
      required_credentials: { type: 'array', items: { type: 'string' } },
      credential_type: { type: 'string' },
    }),
    [query.id]: cacheEntry(query.id, query.name, 'dataflow', {
      auth_failure_mode: { type: 'string', enum: ['deny', 'fallback', 'fail_open', 'unknown'] },
      flow_tls_encrypted: { type: 'boolean', default: false },
      required_credentials: { type: 'array', items: { type: 'string' } },
    }),
    // The data classes the items use: cached with their module; no attribute fields.
    ...Object.fromEntries(Object.values(DATA_CLASS).map((c) => [c.id, cacheEntry(c.id, c.name, 'data', {})])),
  }

  return {
    manifest: {
      schemaVersion: '2.0.0',
      format: 'split',
      model: { id: null, name: 'Gate reference shop', description: 'A small shop used to exercise the gates.', defaultBoundaryId: 'b-root' },
      files: { structure: 'structure.json', dataFlows: 'dataflows.json', dataItems: 'data-items.json', attributes: 'attributes' },
      modules: [{ id: 'mod-general', name: 'dethernety-general' }],
    },
    structure,
    dataFlows,
    dataItems,
    attributes: { boundaries: {}, components: componentAttrs, dataFlows: flowAttrs, dataItems: {} },
    classCache,
    scope: {
      system_name: 'Gate reference shop',
      crown_jewels: ['Customer orders', 'Payment card data'],
      crown_jewel_elements: { 'Customer orders': ['c-db'], 'Payment card data': ['d-card', 'c-db'] },
    },
  }
}

/** Write `model` as a split-format model directory at `dir` (created if needed). */
export async function writeGateModel(dir: string, model: GateModel): Promise<void> {
  const json = (v: unknown) => JSON.stringify(v, null, 2)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'manifest.json'), json(model.manifest))
  await fs.writeFile(path.join(dir, 'structure.json'), json(model.structure))
  await fs.writeFile(path.join(dir, 'dataflows.json'), json(model.dataFlows))
  await fs.writeFile(path.join(dir, 'data-items.json'), json(model.dataItems))
  for (const [group, files] of Object.entries(model.attributes)) {
    await fs.mkdir(path.join(dir, 'attributes', group), { recursive: true })
    for (const [id, content] of Object.entries(files)) {
      await fs.writeFile(path.join(dir, 'attributes', group, `${id}.json`), json(content))
    }
  }
  await fs.mkdir(path.join(dir, '.dethereal', 'class-cache'), { recursive: true })
  for (const [name, entry] of Object.entries(model.classCache)) {
    await fs.writeFile(path.join(dir, '.dethereal', 'class-cache', `${name}.json`), json(entry))
  }
  if (model.scope) await fs.writeFile(path.join(dir, '.dethereal', 'scope.json'), json(model.scope))
}
