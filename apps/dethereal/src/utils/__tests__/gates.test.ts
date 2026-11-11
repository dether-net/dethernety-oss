import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import {
  computeGates,
  GateInputError,
  isStandIn,
  isTypeDefault,
  isValidForSchema,
  loadGateInput,
  MAX_FAILING,
  safeErrorMessage,
  sensitivityRank,
  type GateCheck,
  type GatesResult,
} from '../gates.js'
import { gateModel, writeGateModel, type GateModel } from './fixtures/gate-model.js'

// Each test writes and gates whole models: slow under a full-suite load.
vi.setConfig({ testTimeout: 30_000 })

let root: string
let seq = 0

beforeAll(async () => {
  // Inside the working directory, so the store's confinement admits it.
  root = await fs.mkdtemp(path.join(process.cwd(), '.test-gates-'))
})
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function gatesOf(
  mutate?: (m: GateModel) => void,
  after?: (dir: string) => Promise<void>,
  settlement?: 'on' | 'off',
): Promise<GatesResult> {
  const m = gateModel()
  mutate?.(m)
  const dir = path.join(root, `m${seq++}`)
  await writeGateModel(dir, m)
  await after?.(dir)
  return computeGates(await loadGateInput(dir, { settlement }))
}

const ids = (c: GateCheck): string[] => c.failing.map((f) => f.id).sort()
const verdicts = (r: GatesResult) => Object.fromEntries(Object.entries(r.gate3.criteria).map(([k, v]) => [k, v.verdict]))
const allPassBut = (...failing: string[]) =>
  Object.fromEntries(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9'].map((c) => [c, failing.includes(c) ? 'FAIL' : 'PASS']))

const walk = (m: GateModel) => {
  const out: any[] = []
  const w = (b: any) => { out.push(b); (b.boundaries ?? []).forEach(w) }
  w(m.structure.defaultBoundary)
  return out
}
const boundary = (m: GateModel, id: string) => walk(m).find((b) => b.id === id)
const component = (m: GateModel, id: string) => walk(m).flatMap((b) => b.components ?? []).find((c: any) => c.id === id)
const flow = (m: GateModel, id: string) => m.dataFlows.find((f) => f.id === id)!
const item = (m: GateModel, id: string) => m.dataItems.find((i) => i.id === id)!
const cAttrs = (m: GateModel, id: string) => m.attributes.components[id]!.attributes
const fAttrs = (m: GateModel, id: string) => m.attributes.dataFlows[id]!.attributes
const newComponent = (id: string, type = 'PROCESS', extra: Record<string, unknown> = {}) =>
  ({ id, name: id, description: id, type, positionX: 0, positionY: 0, classData: { id: 'cls-service', name: 'Application Service' }, ...extra })

describe('value predicates', () => {
  it('treats "unknown" and blank strings as stand-ins, in any case or padding, and arrays of only those', () => {
    for (const v of ['unknown', ' Unknown ', 'UNKNOWN', '', '   ', ['unknown'], ['', 'unknown']]) expect(isStandIn(v), JSON.stringify(v)).toBe(true)
    for (const v of ['none', false, [], 0, null, 'TLS 1.3', ['unknown', 'splunk'], 'unspecified']) expect(isStandIn(v), JSON.stringify(v)).toBe(false)
  })

  it('names the type defaults', () => {
    for (const v of [false, 0, [], 'none', ' None ']) expect(isTypeDefault(v)).toBe(true)
    for (const v of [true, 1, ['x'], 'oidc', 'unknown']) expect(isTypeDefault(v)).toBe(false)
  })

  it('checks type and enum, including array items, and passes schemas it does not interpret', () => {
    expect(isValidForSchema('block', { type: 'string', enum: ['off', 'block'] })).toBe(true)
    expect(isValidForSchema('maybe', { type: 'string', enum: ['off', 'block'] })).toBe(false)
    expect(isValidForSchema('n/a', { type: 'boolean' })).toBe(false)
    expect(isValidForSchema(3, { type: 'integer' })).toBe(true)
    expect(isValidForSchema(3.5, { type: 'integer' })).toBe(false)
    expect(isValidForSchema(['a', 2], { type: 'array', items: { type: 'string' } })).toBe(false)
    expect(isValidForSchema(['x'], { type: 'array', items: { enum: ['a'] } })).toBe(false)
    expect(isValidForSchema(null, { type: ['string', 'null'] })).toBe(true)
    expect(isValidForSchema({ any: 1 }, { oneOf: [{ type: 'string' }] })).toBe(true)
    expect(isValidForSchema('x', {})).toBe(true)
  })

  it('ranks sensitivity on the four-value scale only', () => {
    expect(['public', 'internal', 'confidential', 'restricted', ' RESTRICTED '].map(sensitivityRank)).toEqual([0, 1, 2, 3, 3])
    for (const v of ['high', 'secret', 'unknown', '', undefined, 3]) expect(sensitivityRank(v)).toBe(-1)
  })
})

describe('reference model', () => {
  it('passes Gates 1–3 and reports its tiers', async () => {
    const r = await gatesOf()
    expect(r.gate1.verdict).toBe('PASS')
    expect(r.gate2.verdict).toBe('PASS')
    expect(verdicts(r)).toEqual(allPassBut())
    expect(r.gate3.verdict).toBe('PASS')
    expect(r.gate3.report.tiers).toEqual({ tier1: 2, tier2: 2, tier3: 4, externals: 2, unzoned: 0 })
    expect(r.gate3.limit).toMatch(/complete and consistent, not that they are true/)
  })

  it('ignores a legacy blanket waiver in state.json', async () => {
    const r = await gatesOf((m) => { m.scope!.crown_jewel_elements = {} }, async (dir) => {
      await fs.writeFile(path.join(dir, '.dethereal', 'state.json'), JSON.stringify({ currentState: 'REVIEWED', gate3Waiver: { reason: 'accepted' } }))
    })
    expect(r.gate3.criteria.C6.verdict).toBe('FAIL')
    expect(r.gate3.verdict).toBe('FAIL')
  })
})

describe('C1 — classification', () => {
  it('fails on an unclassified non-external component, and ignores external entities', async () => {
    const r = await gatesOf((m) => { delete component(m, 'c-notify').classData })
    expect(verdicts(r)).toEqual(allPassBut('C1'))
    expect(ids(r.gate3.criteria.C1)).toEqual(['c-notify'])
    expect(r.gate1.checks.unclassified_components!.verdict).toBe('WARN')
  })
})

describe('C2 — template completion on Tier 1–2', () => {
  it('fails a stubs-only model', async () => {
    const r = await gatesOf((m) => {
      for (const f of Object.values(m.attributes.components)) for (const k of Object.keys(f.attributes)) f.attributes[k] = null
    })
    expect(r.gate3.criteria.C2.verdict).toBe('FAIL')
    expect(ids(r.gate3.criteria.C2)).toEqual(['c-audit', 'c-db', 'c-gateway', 'c-web'])
    expect(r.gate3.criteria.C2.value).toMatch(/^0%/)
  })

  it('passes at 80 % and fails below', async () => {
    const blank = (m: GateModel, n: number) => {
      let left = n
      for (const id of ['c-gateway', 'c-web', 'c-db']) for (const k of ['waf_mode', 'rate_limiting_enabled', 'input_validation', 'runs_as_root', 'backups_encrypted', 'credential_scope']) {
        if (left > 0 && Object.prototype.hasOwnProperty.call(cAttrs(m, id), k)) { cAttrs(m, id)[k] = null; left-- }
      }
    }
    const pass = await gatesOf((m) => blank(m, 5))
    expect(pass.gate3.criteria.C2.verdict).toBe('PASS')
    expect(pass.gate3.criteria.C2.value).toContain('(23/28 template fields)')
    expect(pass.gate3.criteria.C2.failing).toEqual([])
    const fail = await gatesOf((m) => blank(m, 6))
    expect(fail.gate3.criteria.C2.verdict).toBe('FAIL')
    expect(fail.gate3.report.c2_min_element_rate).toBeLessThan(1)
  })

  it('counts stand-ins and schema-invalid values as unanswered, and honest defaults as answers', async () => {
    const r = await gatesOf((m) => {
      Object.assign(cAttrs(m, 'c-gateway'), { waf_mode: 'maybe', rate_limiting_enabled: 'n/a' })
      Object.assign(cAttrs(m, 'c-web'), { input_validation: ' Unknown ', runs_as_root: '' })
      Object.assign(cAttrs(m, 'c-db'), { credential_scope: ['unknown'], backups_encrypted: 'unknown' })
    })
    expect(r.gate3.criteria.C2.value).toContain('(22/28 template fields)')
    expect(r.gate3.criteria.C2.verdict).toBe('FAIL')

    const honest = await gatesOf((m) => {
      Object.assign(cAttrs(m, 'c-web'), { input_validation: 'none', runs_as_root: false })
      Object.assign(cAttrs(m, 'c-audit'), { credential_scope: [], backups_encrypted: false })
    })
    expect(honest.gate3.criteria.C2.value).toContain('(28/28 template fields)')
  })

  it('fails when a Tier 1–2 component is unclassified or has no usable template', async () => {
    const unclassified = await gatesOf((m) => { delete component(m, 'c-web').classData })
    expect(unclassified.gate3.criteria.C2.verdict).toBe('FAIL')
    expect(unclassified.gate3.criteria.C2.failing).toContainEqual(expect.objectContaining({ id: 'c-web', detail: 'unclassified' }))

    const noTemplate = await gatesOf((m) => { delete m.classCache['cls-database'] })
    expect(noTemplate.gate3.criteria.C2.verdict).toBe('FAIL')
    expect(ids(noTemplate.gate3.criteria.C2)).toEqual(['c-audit', 'c-db'])
  })

  it('refuses cache entries that are symlinks, claim another class id, or declare no fields', async () => {
    const mismatch = await gatesOf((m) => { m.classCache['cls-database']!.classId = 'cls-other' })
    expect(mismatch.gate3.criteria.C2.verdict).toBe('FAIL')
    expect(mismatch.gate3.report.templates.refused).toContainEqual({ file: '.dethereal/class-cache/cls-database.json', reason: 'class_id_mismatch' })

    const empty = await gatesOf((m) => { m.classCache['cls-database']!.template.schema.properties = {} })
    expect(empty.gate3.criteria.C2.verdict).toBe('FAIL')
    expect(empty.gate3.report.templates.refused).toContainEqual({ file: '.dethereal/class-cache/cls-database.json', reason: 'no_fields' })

    const linked = await gatesOf(undefined, async (dir) => {
      const cache = path.join(dir, '.dethereal', 'class-cache')
      await fs.rename(path.join(cache, 'cls-database.json'), path.join(dir, 'elsewhere.json'))
      await fs.symlink(path.join(dir, 'elsewhere.json'), path.join(cache, 'cls-database.json'))
    })
    expect(linked.gate3.criteria.C2.verdict).toBe('FAIL')
    expect(linked.gate3.report.templates.refused).toContainEqual({ file: '.dethereal/class-cache/cls-database.json', reason: 'symlink' })
  })
})

describe('the remedies follow the settlement switch', () => {
  const unanswered = (m: GateModel) => {
    for (const g of [m.attributes.components, m.attributes.dataFlows]) {
      for (const f of Object.values(g)) for (const k of Object.keys(f.attributes)) f.attributes[k] = null
    }
  }
  /** Every remedy a result carries, by gate and check. */
  const remedies = (r: GatesResult): Record<string, string> => Object.fromEntries(
    [['gate1', r.gate1.checks], ['gate2', r.gate2.checks], ['gate3', r.gate3.criteria]].flatMap(([gate, checks]) =>
      Object.entries(checks as Record<string, GateCheck | undefined>).flatMap(([k, c]) => (c?.remedy ? [[`${gate}.${k}`, c.remedy]] : []))))

  it('asks for a pending-enrichment entry the operator confirms with the settlement on', async () => {
    const r = await gatesOf(unanswered, undefined, 'on')
    for (const c of ['C2', 'C3', 'C8'] as const) {
      expect([c, r.gate3.criteria[c].remedy]).toEqual([c, expect.stringContaining('from what a source shows, with a pending-enrichment entry the operator confirms')])
    }
    // A flow's failure mode and credentials wait for the operator.
    expect(r.gate3.criteria.C3.remedy).toBe('For each listed flow, record encryption_in_transit (or the flow class\'s own transit field) from what ' +
      'a source shows, with a pending-enrichment entry the operator confirms. auth_failure_mode (deny, fallback or fail_open, only for a flow ' +
      'that authenticates) and required_credentials are the operator\'s: propose them from a source and write them only after ' +
      'the operator confirms. Propose [] for required_credentials when a cited source shows the flow is unauthenticated; write ' +
      'it only after the operator confirms. Insecure values are fine. When nothing settles a value, leave it null and ask; ' +
      'never write a placeholder in any spelling.')
  })

  it('records what a source shows and leaves the rest an Open fields question with the settlement off: no remedy names a settlement-only entry', async () => {
    const r = await gatesOf(unanswered, undefined, 'off')
    for (const c of ['C2', 'C3', 'C8'] as const) {
      expect([c, r.gate3.criteria[c].remedy]).toEqual([c, expect.stringContaining('leave it null as an Open fields question for the operator')])
    }
    // A flow's failure mode and credentials are written from the source, as the enricher writes them; an empty list is
    // still the operator's.
    expect(r.gate3.criteria.C3.remedy).toContain('Write auth_failure_mode (deny, fallback or fail_open, only for a flow that authenticates) and required_credentials from what a source shows, with its citation.')
    expect(r.gate3.criteria.C3.remedy).not.toContain('are the operator\'s')
    expect(r.gate3.criteria.C3.remedy).toContain('Propose [] for required_credentials')
    const all = remedies(r)
    expect(Object.keys(all)).toEqual(expect.arrayContaining(['gate3.C2', 'gate3.C3', 'gate3.C8']))
    for (const [k, text] of Object.entries(all)) expect([k, text]).toEqual([k, expect.not.stringMatching(/pending[- ]enrichment|model_state_settle|settle(?:ment)?\b/i)])
  })
})

describe('C3 — cross-boundary flows reviewed', () => {
  it.each([
    ['auth_failure_mode placeholder', (m: GateModel) => { fAttrs(m, 'f-submit').auth_failure_mode = 'unknown' }],
    ['auth_failure_mode missing', (m: GateModel) => { delete fAttrs(m, 'f-submit').auth_failure_mode }],
    ['encryption_in_transit blank', (m: GateModel) => { fAttrs(m, 'f-submit').encryption_in_transit = '' }],
    ['required_credentials missing', (m: GateModel) => { delete fAttrs(m, 'f-submit').required_credentials }],
    ['required_credentials null', (m: GateModel) => { fAttrs(m, 'f-submit').required_credentials = null }],
    ['required_credentials a string', (m: GateModel) => { fAttrs(m, 'f-submit').required_credentials = 'unknown' }],
    ['required_credentials placeholders', (m: GateModel) => { fAttrs(m, 'f-submit').required_credentials = ['unknown'] }],
  ])('fails on %s', async (_label, mutate) => {
    const r = await gatesOf(mutate)
    expect(r.gate3.criteria.C3.verdict).toBe('FAIL')
    expect(ids(r.gate3.criteria.C3)).toEqual(['f-submit'])
  })

  it('accepts insecure answers and an empty credential list', async () => {
    const r = await gatesOf((m) => Object.assign(fAttrs(m, 'f-report'), { auth_failure_mode: 'fail_open', flow_tls_encrypted: false, required_credentials: [] }))
    expect(r.gate3.criteria.C3.verdict).toBe('PASS')
  })

  it('accepts a transit alias only when the flow class declares it and the value is valid', async () => {
    // The reference answers f-report through its class's flow_tls_encrypted.
    expect((await gatesOf()).gate3.criteria.C3.verdict).toBe('PASS')
    const invalid = await gatesOf((m) => { fAttrs(m, 'f-report').flow_tls_encrypted = 'yes' })
    expect(ids(invalid.gate3.criteria.C3)).toEqual(['f-report'])
    const foreign = await gatesOf((m) => {
      delete fAttrs(m, 'f-submit').encryption_in_transit
      fAttrs(m, 'f-submit').flow_tls_encrypted = true
    })
    expect(ids(foreign.gate3.criteria.C3)).toEqual(['f-submit'])
    const version = await gatesOf((m) => {
      delete fAttrs(m, 'f-report').flow_tls_encrypted
      fAttrs(m, 'f-report').min_tls_version = 'tls1_2_or_higher'
    })
    expect(ids(version.gate3.criteria.C3)).toEqual(['f-report'])
  })

  it('never lets an alias stand in for the literal floor key', async () => {
    const r = await gatesOf((m) => { delete fAttrs(m, 'f-write').encryption_in_transit })
    expect(r.gate3.criteria.C3.verdict).toBe('PASS')
    expect(ids(r.gate3.criteria.C8)).toEqual(['f-write'])
  })
})

describe('C4 — sensitive flows carry classified data', () => {
  const vault = (m: GateModel) => {
    boundary(m, 'b-data').components.push(newComponent('c-vault'))
    m.dataFlows.push({ id: 'f-vault', name: 'Vault read', description: 'Vault read.', source: { id: 'c-jobs' }, target: { id: 'c-vault' }, dataItemIds: [] })
  }
  it.each([
    ['a STORE endpoint', (m: GateModel) => { flow(m, 'f-audit').dataItemIds = [] }, 'f-audit'],
    ['a crown-jewel endpoint', (m: GateModel) => { component(m, 'c-web').crownJewel = true; flow(m, 'f-render').dataItemIds = [] }, 'f-render'],
    ['leaving UNTRUSTED', (m: GateModel) => { flow(m, 'f-admin').dataItemIds = [] }, 'f-admin'],
    ['leaving PUBLIC', (m: GateModel) => { flow(m, 'f-submit').dataItemIds = [] }, 'f-submit'],
    ['entering RESTRICTED', vault, 'f-vault'],
    ['leaving VENDOR', (m: GateModel) => {
      m.structure.defaultBoundary.boundaries.push({ id: 'b-vendor', name: 'Vendor', zone: 'VENDOR', components: [newComponent('x-psp', 'EXTERNAL_ENTITY'), newComponent('x-psp2', 'EXTERNAL_ENTITY')] })
      m.dataFlows.push({ id: 'f-psp', name: 'Refund', description: 'Refund.', source: { id: 'x-psp' }, target: { id: 'c-orders' }, dataItemIds: [] })
    }, 'f-psp'],
    ['leaving an external entity in an unzoned boundary', (m: GateModel) => { delete boundary(m, 'b-internet').zone; flow(m, 'f-admin').dataItemIds = [] }, 'f-admin'],
    ['entering UNTRUSTED from INTERNAL', (m: GateModel) => {
      m.dataFlows.push({ id: 'f-callback', name: 'Callback', description: 'Callback.', source: { id: 'c-notify' }, target: { id: 'x-customer' }, dataItemIds: [] })
    }, 'f-callback'],
    ['entering VENDOR', (m: GateModel) => {
      m.structure.defaultBoundary.boundaries.push({ id: 'b-vendor', name: 'Vendor', zone: 'VENDOR', components: [newComponent('x-psp', 'EXTERNAL_ENTITY'), newComponent('x-psp2', 'EXTERNAL_ENTITY')] })
      m.dataFlows.push({ id: 'f-charge', name: 'Charge', description: 'Charge.', source: { id: 'c-orders' }, target: { id: 'x-psp' }, dataItemIds: [] })
    }, 'f-charge'],
    ['entering PUBLIC from EXPOSED', (m: GateModel) => {
      m.structure.defaultBoundary.boundaries.push({ id: 'b-dmz', name: 'DMZ', zone: 'EXPOSED', components: [newComponent('c-cdn'), newComponent('c-cdn2')] })
      m.dataFlows.push({ id: 'f-edge', name: 'Edge sync', description: 'Edge sync.', source: { id: 'c-cdn' }, target: { id: 'c-web' }, dataItemIds: [] })
    }, 'f-edge'],
    ['leaving EXPOSED for INTERNAL', (m: GateModel) => {
      m.structure.defaultBoundary.boundaries.push({ id: 'b-dmz', name: 'DMZ', zone: 'EXPOSED', components: [newComponent('c-cdn'), newComponent('c-cdn2')] })
      m.dataFlows.push({ id: 'f-dmz-in', name: 'Admin call', description: 'Admin call.', source: { id: 'c-cdn' }, target: { id: 'c-notify' }, dataItemIds: [] })
    }, 'f-dmz-in'],
    ['carrying a mapped crown-jewel data item', (m: GateModel) => {
      m.dataItems.push({ id: 'd-loose', name: 'Loose card number', description: 'x' })
      m.scope!.crown_jewel_elements['Payment card data'].push('d-loose')
      flow(m, 'f-notify').dataItemIds = ['d-loose']
    }, 'f-notify'],
  ])('fails a flow that is sensitive by %s and carries nothing classified', async (_label, mutate, id) => {
    const r = await gatesOf(mutate as (m: GateModel) => void)
    expect(r.gate3.criteria.C4.verdict).toBe('FAIL')
    expect(ids(r.gate3.criteria.C4)).toEqual([id])
  })

  it('passes a flow from EXPOSED into INTERNAL that carries a classified item, and leaves one inside EXPOSED alone', async () => {
    const r = await gatesOf((m) => {
      m.structure.defaultBoundary.boundaries.push({ id: 'b-dmz', name: 'DMZ', zone: 'EXPOSED', components: [newComponent('c-cdn'), newComponent('c-cdn2')] })
      m.dataFlows.push({ id: 'f-dmz-in', name: 'Admin call', description: 'Admin call.', source: { id: 'c-cdn' }, target: { id: 'c-notify' }, dataItemIds: ['d-order'] })
      m.dataFlows.push({ id: 'f-dmz-sync', name: 'Edge peer sync', description: 'Edge peer sync.', source: { id: 'c-cdn' }, target: { id: 'c-cdn2' }, dataItemIds: [] })
    })
    expect(r.gate3.criteria.C4.verdict).toBe('PASS')
  })

  it('leaves a flow inside one zone alone, a PUBLIC one included', async () => {
    const r = await gatesOf((m) => { flow(m, 'f-notify').dataItemIds = []; flow(m, 'f-render').dataItemIds = [] })
    expect(r.gate3.criteria.C4.verdict).toBe('PASS')
  })

  it('does not count a sensitivity off the scale, or a placeholder', async () => {
    for (const s of ['high', 'unknown']) {
      const r = await gatesOf((m) => { item(m, 'd-audit').sensitivity = s })
      expect(ids(r.gate3.criteria.C4), s).toEqual(['f-audit'])
    }
  })

  it('fails a model with no data items at all', async () => {
    const r = await gatesOf((m) => { m.dataItems = []; for (const f of m.dataFlows) f.dataItemIds = [] })
    expect(r.gate3.criteria.C4.verdict).toBe('FAIL')
    expect(r.gate3.criteria.C4.value).toContain('no data items')
  })
})

describe('C5 — a boundary is crossed', () => {
  it('fails when every flow stays inside one boundary', async () => {
    const r = await gatesOf((m) => {
      const all = walk(m).flatMap((b) => b.components ?? []).filter((c: any) => c.type !== 'EXTERNAL_ENTITY')
      m.structure.defaultBoundary.boundaries = [{ id: 'b-all', name: 'All', zone: 'INTERNAL', components: all }]
      m.dataFlows = m.dataFlows.filter((f) => !f.source.id.startsWith('x-'))
    })
    expect(r.gate3.criteria.C5.verdict).toBe('FAIL')
  })
})

describe('C6 — crown jewels resolve', () => {
  it.each([
    ['no crown jewel', (m: GateModel) => { m.scope!.crown_jewels = [] }, []],
    ['crown_jewels missing', (m: GateModel) => { delete m.scope!.crown_jewels }, []],
    ['no map', (m: GateModel) => { delete m.scope!.crown_jewel_elements }, ['Customer orders', 'Payment card data']],
    ['a map that is a list', (m: GateModel) => { m.scope!.crown_jewel_elements = [] }, ['Customer orders', 'Payment card data']],
    ['a jewel missing from the map', (m: GateModel) => { delete m.scope!.crown_jewel_elements['Customer orders'] }, ['Customer orders']],
    ['a jewel mapped to nothing that exists', (m: GateModel) => { m.scope!.crown_jewel_elements['Customer orders'] = ['gone'] }, ['Customer orders']],
    ['a mapped component without the flag', (m: GateModel) => { m.scope!.crown_jewel_elements['Customer orders'].push('c-orders') }, ['c-orders']],
    ['only external or non-component elements mapped', (m: GateModel) => {
      m.scope!.crown_jewel_elements = { 'Customer orders': ['x-customer'], 'Payment card data': ['d-card'] }
    }, ['x-customer']],
    ['no scope file', (m: GateModel) => { m.scope = null }, []],
  ])('fails on %s', async (_label, mutate, failing) => {
    const r = await gatesOf(mutate as (m: GateModel) => void)
    expect(r.gate3.criteria.C6.verdict).toBe('FAIL')
    expect(ids(r.gate3.criteria.C6)).toEqual([...(failing as string[])].sort())
  })

  it('passes an entry with a dangling id beside a resolving one, and reports the dangling id', async () => {
    const r = await gatesOf((m) => {
      m.scope!.crown_jewel_elements['Customer orders'].push('gone')
      m.scope!.crown_jewel_elements.Extra = ['c-db']
    })
    expect(r.gate3.criteria.C6.verdict).toBe('PASS')
    expect(r.gate3.report.crown_jewel_map).toEqual({ unmapped_keys: ['Extra'], dangling_ids: ['gone'] })
  })

  it.each([
    ['invalid JSON', async (dir: string) => fs.writeFile(path.join(dir, '.dethereal', 'scope.json'), '{"crown_jewels": ['), 'invalid_json'],
    ['a list', async (dir: string) => fs.writeFile(path.join(dir, '.dethereal', 'scope.json'), '[]'), 'not_object'],
    ['a symlink', async (dir: string) => {
      const scope = path.join(dir, '.dethereal', 'scope.json')
      await fs.rename(scope, path.join(dir, 'scope-elsewhere.json'))
      await fs.symlink(path.join(dir, 'scope-elsewhere.json'), scope)
    }, 'symlink'],
  ])('fails, never throws, when scope.json is %s', async (_label, after, code) => {
    const r = await gatesOf(undefined, after as (dir: string) => Promise<void>)
    expect(r.gate3.criteria.C6.verdict).toBe('FAIL')
    expect(r.gate3.criteria.C6.value).toContain(code as string)
  })
})

describe('C7 — sensitivity floors', () => {
  it.each([
    ['a flag floor', (m: GateModel) => { item(m, 'd-order').sensitivity = 'internal' }, 'd-order'],
    ['a fixed class floor', (m: GateModel) => { item(m, 'd-session').sensitivity = 'confidential' }, 'd-session'],
    ['a class-name floor', (m: GateModel) => { Object.assign(item(m, 'd-audit'), { classData: { id: 'cls-sa', name: 'Service Account Token' } }) }, 'd-audit'],
    ['the higher of several flags', (m: GateModel) => { item(m, 'd-order').regulatory_flags = ['PII', 'PHI'] }, 'd-order'],
    ['a sensitivity off the scale', (m: GateModel) => { item(m, 'd-card').sensitivity = 'secret' }, 'd-card'],
    ['a placeholder sensitivity', (m: GateModel) => { item(m, 'd-card').sensitivity = 'unknown' }, 'd-card'],
    ['a missing sensitivity', (m: GateModel) => { delete item(m, 'd-card').sensitivity }, 'd-card'],
  ])('fails below %s', async (_label, mutate, id) => {
    const r = await gatesOf(mutate)
    expect(r.gate3.criteria.C7.verdict).toBe('FAIL')
    expect(ids(r.gate3.criteria.C7)).toEqual([id])
  })

  it('takes the class name from the class cache before the model\'s copy', async () => {
    const r = await gatesOf((m) => {
      m.classCache['cls-keys'] = { classId: 'cls-keys', className: 'Signing Key', classType: 'data', template: { schema: { properties: { rotated: { type: 'boolean' } } } } }
      Object.assign(item(m, 'd-audit'), { classData: { id: 'cls-keys', name: 'Blob' } })
    })
    expect(ids(r.gate3.criteria.C7)).toEqual(['d-audit'])
  })

  it('matches class words whole, and compares sensitivity case-insensitively', async () => {
    const r = await gatesOf((m) => {
      Object.assign(item(m, 'd-audit'), { classData: { id: 'cls-w', name: 'Wildcard Discard Pile' } })
      item(m, 'd-card').sensitivity = 'RESTRICTED'
    })
    expect(r.gate3.criteria.C7.verdict).toBe('PASS')
  })
})

describe('C8 — the literal six-attribute floor', () => {
  it.each([
    ['a placeholder authentication_type', (m: GateModel) => { cAttrs(m, 'c-db').authentication_type = 'unknown' }],
    ['a boolean encryption_at_rest', (m: GateModel) => { cAttrs(m, 'c-db').encryption_at_rest = true }],
    ['a string implicit_deny_enabled', (m: GateModel) => { cAttrs(m, 'c-db').implicit_deny_enabled = 'true' }],
    ['placeholder monitoring_tools', (m: GateModel) => { cAttrs(m, 'c-db').monitoring_tools = ['unknown'] }],
    ['a missing key', (m: GateModel) => { delete cAttrs(m, 'c-db').encryption_in_transit }],
  ])('fails on %s', async (_label, mutate) => {
    const r = await gatesOf(mutate)
    expect(ids(r.gate3.criteria.C8)).toEqual(['c-db'])
  })

  it('accepts honest "none", false and []', async () => {
    const r = await gatesOf((m) => Object.assign(cAttrs(m, 'c-db'), { authentication_type: 'none', implicit_deny_enabled: false, monitoring_tools: [] }))
    expect(r.gate3.criteria.C8.verdict).toBe('PASS')
  })

  it('checks encryption_in_transit on every flow touching Tier 1–2, and on no other', async () => {
    const r = await gatesOf((m) => { fAttrs(m, 'f-audit').encryption_in_transit = 'unknown' })
    expect(ids(r.gate3.criteria.C8)).toEqual(['f-audit'])
    const t3 = await gatesOf((m) => { delete fAttrs(m, 'f-notify').encryption_in_transit })
    expect(t3.gate3.criteria.C8.verdict).toBe('PASS')
  })
})

describe('C9 — credential scopes resolve', () => {
  it('fails on an id no flow requires, or a scope that is not a list', async () => {
    const r = await gatesOf((m) => { cAttrs(m, 'c-db').credential_scope = ['db-app-cred', 'backup-cred'] })
    expect(ids(r.gate3.criteria.C9)).toEqual(['c-db'])
    expect(r.gate3.criteria.C9.failing[0]!.detail).toContain('backup-cred')
    expect(r.gate3.criteria.C9.remedy).toMatch(/flow that presents that credential.*only after the operator confirms/s)
    const notList = await gatesOf((m) => { cAttrs(m, 'c-audit').credential_scope = 'db-app-cred' })
    expect(ids(notList.gate3.criteria.C9)).toEqual(['c-audit'])
  })

  it('ignores placeholders on either side', async () => {
    const r = await gatesOf((m) => {
      cAttrs(m, 'c-audit').credential_scope = ['unknown']
      fAttrs(m, 'f-audit').required_credentials = ['unknown']
    })
    expect(r.gate3.criteria.C9.verdict).toBe('PASS')
  })
})

describe('Gate 1 — advisory', () => {
  it.each([
    ['unnamed_flows', (m: GateModel) => { flow(m, 'f-notify').description = ' ' }, ['f-notify']],
    ['single_child_boundaries', (m: GateModel) => { boundary(m, 'b-batch').components.pop() }, ['b-batch']],
    ['mixed_external_boundaries', (m: GateModel) => { boundary(m, 'b-app').components.push(newComponent('x-partner', 'EXTERNAL_ENTITY')) }, ['b-app']],
    ['unprotected_cross_boundary_flows', (m: GateModel) => {
      Object.assign(fAttrs(m, 'f-submit'), { auth_failure_mode: 'none', encryption_in_transit: 'none', required_credentials: [] })
    }, ['f-submit']],
    ['unzoned_components', (m: GateModel) => { delete boundary(m, 'b-app').zone }, ['c-notify', 'c-orders']],
  ])('warns on %s', async (name, mutate, failing) => {
    const r = await gatesOf(mutate as (m: GateModel) => void)
    expect(r.gate1.verdict).toBe('WARN')
    expect(r.gate1.checks[name as string]!.verdict).toBe('WARN')
    expect(ids(r.gate1.checks[name as string]!)).toEqual(failing)
  })

  it('counts a formal control as protection', async () => {
    const r = await gatesOf((m) => {
      Object.assign(fAttrs(m, 'f-submit'), { auth_failure_mode: 'none', encryption_in_transit: 'none', required_credentials: [] })
      flow(m, 'f-submit').controls = [{ id: 'ctl-mtls', name: 'mTLS' }]
    })
    expect(r.gate1.checks.unprotected_cross_boundary_flows!.verdict).toBe('PASS')
  })
})

describe('Gate 2 — blocking', () => {
  it.each([
    // An empty module list is derived from the cached classes' module, so only the description is missing.
    ['manifest_complete', (m: GateModel) => { delete m.manifest.model.description; m.manifest.modules = [] }, undefined, ['description']],
    ['minimum_structure', (m: GateModel) => { m.dataFlows = []; m.attributes.dataFlows = {} }, undefined, ['flow']],
    ['flow_endpoints_exist', (m: GateModel) => { flow(m, 'f-notify').target = { id: 'gone' } }, undefined, ['f-notify']],
    ['no_orphan_attribute_files', (m: GateModel) => {
      m.attributes.components['c-gone'] = { elementId: 'c-gone', elementType: 'component', attributes: {} }
    }, undefined, ['c-gone']],
    ['attribute_files_readable', undefined, async (dir: string) => {
      await fs.writeFile(path.join(dir, 'attributes', 'components', 'broken.json'), '{"elementId": ')
    }, ['attributes/components/broken.json']],
    ['no_controls_in_attribute_files', (m: GateModel) => {
      cAttrs(m, 'c-web').controls = []
      m.attributes.dataFlows['f-notify']!.controls = [{ id: 'ctl' }]
    }, undefined, ['c-web', 'f-notify']],
  ])('fails %s', async (name, mutate, after, failing) => {
    const r = await gatesOf(mutate as ((m: GateModel) => void) | undefined, after as ((dir: string) => Promise<void>) | undefined)
    expect(r.gate2.verdict).toBe('FAIL')
    expect(r.gate2.checks[name as string]!.verdict).toBe('FAIL')
    expect(ids(r.gate2.checks[name as string]!)).toEqual(failing)
  })

  it('takes further blocking errors from the caller', async () => {
    const m = gateModel()
    const dir = path.join(root, `m${seq++}`)
    await writeGateModel(dir, m)
    const r = computeGates(await loadGateInput(dir), { gate2Errors: [{ id: 'c-web', detail: 'lint' }] })
    expect(r.gate2.verdict).toBe('FAIL')
    expect(ids(r.gate2.checks.lint_errors!)).toEqual(['c-web'])
  })
})

describe('Gate 3 report', () => {
  it('counts stand-ins, type defaults, template defaults and invalid values per population', async () => {
    const r = await gatesOf((m) => {
      Object.assign(cAttrs(m, 'c-gateway'), { waf_mode: 'unknown', rate_limiting_enabled: false })
      Object.assign(cAttrs(m, 'c-web'), { input_validation: 'maybe' })
    })
    const v = r.gate3.report.values.tier12_components
    // 4 components × 7 keys, all present.
    expect(v.counted).toBe(28)
    expect(v.stand_ins).toBe(1)
    expect(v.invalid).toBe(2) // "unknown" and "maybe" are not waf_mode / input_validation options
    // rate_limiting_enabled false; c-web runs_as_root false; c-audit backups_encrypted false and credential_scope []
    expect(v.type_defaults).toBe(4)
    // rate_limiting_enabled and backups_encrypted default to false; runs_as_root defaults to true, c-web answers false
    expect(v.template_defaults).toBe(2)
    expect(r.gate3.report.values.cross_boundary_flows.counted).toBeGreaterThan(0)
    expect(r.gate3.report.values.data_items).toMatchObject({ counted: 4, stand_ins: 0 })
  })

  it('reports floors met exactly, floored data outside Tier 1–2 and zone disagreements', async () => {
    const r = await gatesOf()
    expect(r.gate3.report.data_items_at_floor_or_public).toEqual({ count: 3, of: 4 })
    expect(r.gate3.report.floored_data_outside_tier12).toEqual([{ id: 'c-orders', name: 'Order service' }])
    expect(r.gate3.report.zone_disagreements.map((z) => z.boundary)).toContain('b-app')
    expect(r.gate3.report.templates.fields_per_class['cls-gateway']).toBe(7)
  })

  it('reports a template-fields manifest that counts differently from the cache', async () => {
    const r = await gatesOf(undefined, async (dir) => {
      await fs.mkdir(path.join(dir, '.dethereal', 'template-fields'), { recursive: true })
      await fs.writeFile(path.join(dir, '.dethereal', 'template-fields', 'c-db.json'),
        JSON.stringify({ classId: 'cls-database', templateFields: ['authentication_type', 'encryption_at_rest', 'monitoring_tools'] }))
    })
    expect(r.gate3.report.templates.manifest_mismatches).toEqual([{ id: 'c-db', name: 'Orders database', cache: 7, manifest: 3 }])
  })

  it('caps failing lists and keeps the full count', async () => {
    const r = await gatesOf((m) => {
      for (let i = 0; i < MAX_FAILING + 20; i++) boundary(m, 'b-app').components.push(newComponent(`c-bulk-${i}`, 'PROCESS', { classData: undefined }))
    })
    expect(r.gate3.criteria.C1.failing).toHaveLength(MAX_FAILING)
    expect(r.gate3.criteria.C1.failing_total).toBe(MAX_FAILING + 20)
  })
})

describe('reading the model safely', () => {
  const needle = 'needle-must-not-leak-7c1d'

  it.each(['structure.json', 'manifest.json'])('refuses a symlinked %s with a code, never its content or a path', async (file) => {
    const m = gateModel()
    const dir = path.join(root, `m${seq++}`)
    await writeGateModel(dir, m)
    const secret = path.join(root, `secret-${seq++}.txt`)
    await fs.writeFile(secret, needle)
    await fs.rm(path.join(dir, file))
    await fs.symlink(secret, path.join(dir, file))
    const err = await loadGateInput(dir).then(() => null, (e) => e)
    expect(err).toBeInstanceOf(GateInputError)
    expect(err.message).toBe(`${file}: symlink`)
  })

  it('reports a garbage model file as invalid JSON without quoting it', async () => {
    const dir = path.join(root, `m${seq++}`)
    await writeGateModel(dir, gateModel())
    await fs.writeFile(path.join(dir, 'dataflows.json'), needle)
    const err = await loadGateInput(dir).then(() => null, (e) => e)
    expect(err.message).toBe('dataflows.json: invalid json')
    expect(safeErrorMessage(err)).not.toContain(needle)
  })

  it('reads no attribute at all when an attribute file is a symlink, and fails closed', async () => {
    const r = await gatesOf(undefined, async (dir) => {
      const secret = path.join(root, `secret-${seq++}.json`)
      await fs.writeFile(secret, JSON.stringify({ elementId: 'c-web', elementType: 'component', attributes: { note: needle } }))
      await fs.symlink(secret, path.join(dir, 'attributes', 'components', 'linked.json'))
    })
    expect(r.gate2.checks.attribute_files_readable!.verdict).toBe('FAIL')
    expect(ids(r.gate2.checks.attribute_files_readable!)).toEqual(['attributes/components/linked.json'])
    expect(r.gate3.criteria.C2.verdict).toBe('FAIL')
    expect(JSON.stringify(r)).not.toContain(needle)
  })

  it('never passes parser text on for an unreadable attribute file', async () => {
    const r = await gatesOf(undefined, async (dir) => {
      await fs.writeFile(path.join(dir, 'attributes', 'components', 'broken.json'), `{"elementId": "${needle}`)
    })
    expect(JSON.stringify(r.gate2)).not.toContain(needle)
  })

  it('maps reader errors to a file and a code', () => {
    expect(safeErrorMessage(new Error(`Invalid JSON in structure at /home/u/m/structure.json: Unexpected token 's', "${needle}" is not valid JSON`)))
      .toBe('structure.json: invalid json')
    expect(safeErrorMessage(Object.assign(new Error(`ENOENT: no such file or directory, open '/home/u/m/manifest.json'`), { code: 'ENOENT', path: '/home/u/m/manifest.json' })))
      .toBe('manifest.json: ENOENT')
    expect(safeErrorMessage(new Error('Directory not found'))).toBe('Directory not found')
    expect(safeErrorMessage(new Error(`bad "${needle}"`), 'fallback')).toBe('fallback')
  })
})

describe('credential placeholders, flag aliases and unauthenticated flows', () => {
  it('treats a list of placeholder credential ids as unanswered in C3', async () => {
    const r = await gatesOf((m) => { fAttrs(m, 'f-submit').required_credentials = ['none'] })
    expect(ids(r.gate3.criteria.C3)).toEqual(['f-submit'])
  })

  it('ignores placeholder ids on both sides of C9', async () => {
    const r = await gatesOf((m) => {
      cAttrs(m, 'c-audit').credential_scope = ['N/A']
      fAttrs(m, 'f-audit').required_credentials = ['N/A']
    })
    expect(r.gate3.criteria.C9.verdict).toBe('PASS')
    const dangling = await gatesOf((m) => { cAttrs(m, 'c-audit').credential_scope = ['none', 'audit-writer'] })
    expect(dangling.gate3.criteria.C9.failing[0]!.detail).toBe('not required by any flow: audit-writer')
  })

  it('floors a data item through a misspelled or aliased flag', async () => {
    for (const flag of ['pii', 'HIPAA', 'pci-dss']) {
      const r = await gatesOf((m) => {
        Object.assign(item(m, 'd-audit'), { regulatory_flags: [flag], sensitivity: 'internal' })
      })
      expect(ids(r.gate3.criteria.C7), flag).toEqual(['d-audit'])
    }
  })

  it('does not ask a flow that declares no authentication for its failure mode', async () => {
    const quiet = await gatesOf((m) => {
      const a = fAttrs(m, 'f-submit')
      delete a.auth_failure_mode
      Object.assign(a, { credential_type: 'none', required_credentials: [] })
    })
    expect(quiet.gate3.criteria.C3.verdict).toBe('PASS')
    const typed = await gatesOf((m) => {
      const a = fAttrs(m, 'f-submit')
      delete a.auth_failure_mode
      a.required_credentials = []
    })
    expect(typed.gate3.criteria.C3.failing[0]!.detail).toContain('auth_failure_mode')
    const listed = await gatesOf((m) => { delete fAttrs(m, 'f-submit').auth_failure_mode })
    expect(ids(listed.gate3.criteria.C3)).toEqual(['f-submit'])
  })
})

describe('C8: encryption_at_rest "not_applicable"', () => {
  const c8With = async (id: string, value: unknown, type?: string) => {
    const m = gateModel()
    m.attributes.components[id]!.attributes.encryption_at_rest = value
    if (type !== undefined) {
      const walk = (b: any) => { for (const c of b.components ?? []) if (c.id === id) c.type = type; (b.boundaries ?? []).forEach(walk) }
      walk(m.structure.defaultBoundary)
    }
    const dir = await fs.mkdtemp(path.join(process.cwd(), '.test-c8-na-'))
    try {
      await writeGateModel(dir, m)
      return computeGates(await loadGateInput(dir)).gate3.criteria.C8
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  }

  it('is an honest answer on a process, in any case and spacing', async () => {
    expect((await c8With('c-gateway', 'not_applicable')).verdict).toBe('PASS')
    expect((await c8With('c-gateway', '  Not_Applicable ')).verdict).toBe('PASS')
  })

  it('is a placeholder on a store, or on a component of no or unknown type, and the value is never echoed', async () => {
    const onStore = await c8With('c-db', 'not_applicable')
    expect(onStore.verdict).toBe('FAIL')
    expect(onStore.failing).toEqual([expect.objectContaining({ id: 'c-db', detail: expect.stringContaining('encryption_at_rest') })])
    expect(JSON.stringify(onStore.failing)).not.toContain('not_applicable')
    expect((await c8With('c-gateway', 'not_applicable', '')).verdict).toBe('FAIL')
    expect((await c8With('c-gateway', 'not_applicable', 'queue')).verdict).toBe('FAIL')
    expect((await c8With('c-gateway', 'not_applicable', 'process')).verdict).toBe('PASS')
    // Case and spacing are folded, so no spelling slips past the store rule as an ordinary string.
    expect((await c8With('c-db', ' NOT_APPLICABLE ')).verdict).toBe('FAIL')
  })

  it('counts every not-applicable spelling the same, and never "none"', async () => {
    for (const v of ['n/a', 'N/A', 'Not Applicable', 'not-applicable (nothing stored)']) expect((await c8With('c-db', v)).verdict, v).toBe('FAIL')
    expect((await c8With('c-gateway', 'N/A')).verdict).toBe('PASS')
  })

  it('refuses it on a process whose class is a store class, and counts it as a stand-in on a store', async () => {
    const m = gateModel()
    m.classCache['cls-database']!.componentType = 'STORE'
    m.attributes.components['c-db']!.attributes.encryption_at_rest = 'not_applicable'
    const walk = (b: any) => { for (const c of b.components ?? []) if (c.id === 'c-db') c.type = 'PROCESS'; (b.boundaries ?? []).forEach(walk) }
    walk(m.structure.defaultBoundary)
    const dir = await fs.mkdtemp(path.join(process.cwd(), '.test-c8-class-'))
    try {
      await writeGateModel(dir, m)
      const g = computeGates(await loadGateInput(dir))
      expect(g.gate3.criteria.C8.failing.map((f) => f.id)).toContain('c-db')
      const base = gateModel()
      await writeGateModel(dir, base)
      const before = computeGates(await loadGateInput(dir)).gate3.report.values.tier12_components.stand_ins
      base.attributes.components['c-db']!.attributes.encryption_at_rest = 'not_applicable'
      await writeGateModel(dir, base)
      expect(computeGates(await loadGateInput(dir)).gate3.report.values.tier12_components.stand_ins).toBe(before + 1)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('leaves every other string answer as it was', async () => {
    expect((await c8With('c-db', 'none')).verdict).toBe('PASS')
    expect((await c8With('c-db', 'unknown')).verdict).toBe('FAIL')
  })
})

describe('placeholders at the gate', () => {
  it('fails C3 on a placeholder, names it apart from a missing key, and refuses to waive it', async () => {
    const r = await gatesOf((m) => {
      fAttrs(m, 'f-submit').encryption_in_transit = 'TBD - ask ops'
      fAttrs(m, 'f-submit').auth_failure_mode = 'unknown'
    })
    const f = r.gate3.criteria.C3.failing.find((x) => x.id === 'f-submit')!
    expect(f.detail).toBe('placeholder: auth_failure_mode, encryption_in_transit')
    expect(f).toMatchObject({ waivable: false, unwaivable_reason: expect.stringContaining('replace the placeholder with null') })
    const missing = await gatesOf((m) => { delete fAttrs(m, 'f-submit').encryption_in_transit })
    const g = missing.gate3.criteria.C3.failing.find((x) => x.id === 'f-submit')!
    expect(g.detail).toBe('missing: encryption_in_transit')
    expect(g.waivable).toBe(true)
  })

  it('passes honest negatives in C3 and C8', async () => {
    const r = await gatesOf((m) => {
      Object.assign(fAttrs(m, 'f-submit'), { encryption_in_transit: 'not encrypted', auth_failure_mode: 'fail_open' })
      Object.assign(cAttrs(m, 'c-web'), { authentication_type: 'none', monitoring_tools: [], implicit_deny_enabled: false })
    })
    expect(r.gate3.criteria.C3.verdict).toBe('PASS')
    expect(r.gate3.criteria.C8.verdict).toBe('PASS')
  })

  it.each([
    ['monitoring_tools', ['None']], ['monitoring_tools', ['TBC']], ['authentication_type', 'Not specified'],
    ['authentication_type', 'n/a'], ['encryption_in_transit', '?'],
  ])('fails C8 on %s = %j as a placeholder', async (key, value) => {
    const r = await gatesOf((m) => { cAttrs(m, 'c-web')[key] = value })
    const f = r.gate3.criteria.C8.failing.find((x) => x.id === 'c-web')!
    expect(f.detail).toBe(`placeholder: ${key}`)
    expect(f.waivable).toBe(false)
  })

  it('counts placeholders in the stand-in share', async () => {
    const base = (await gatesOf()).gate3.report.values.tier12_components.stand_ins
    const r = await gatesOf((m) => { cAttrs(m, 'c-web').authentication_type = 'TBC'; cAttrs(m, 'c-db').monitoring_tools = ['n/a'] })
    expect(r.gate3.report.values.tier12_components.stand_ins).toBe(base + 2)
  })

  it('reports the cross-boundary flows that declare no authentication', async () => {
    const r = await gatesOf((m) => Object.assign(fAttrs(m, 'f-submit'), { credential_type: 'none', required_credentials: [], auth_failure_mode: 'fail_open' }))
    const base = (await gatesOf()).gate3.report.declared_unauthenticated
    expect(r.gate3.report.declared_unauthenticated).toEqual({ n: base.n + 1, of: base.of })
  })
})

describe('the loop-back list', () => {
  const element = (r: GatesResult, id: string) => r.gate3.loopback.elements.find((e) => e.element_id === id)
  const other = (r: GatesResult, id: string) => r.gate3.loopback.not_enrichable.find((e) => e.element_id === id)

  it('is empty when Gate 3 passes', async () => {
    const r = await gatesOf()
    expect(r.gate3.loopback).toEqual({ phase: 'enrich', elements: [], elements_total: 0, not_enrichable: [], not_enrichable_total: 0 })
  })

  it('lists each element once, with every criterion it fails and the fields to settle', async () => {
    const r = await gatesOf((m) => {
      for (const k of Object.keys(cAttrs(m, 'c-web'))) cAttrs(m, 'c-web')[k] = null
      cAttrs(m, 'c-web').authentication_type = 'TBC'
      fAttrs(m, 'f-submit').auth_failure_mode = 'unknown'
      delete fAttrs(m, 'f-submit').encryption_in_transit
      item(m, 'd-card').sensitivity = 'internal'
      cAttrs(m, 'c-db').credential_scope = ['db-app-cred', 'backup-cred']
    })
    const web = element(r, 'c-web')!
    expect(web).toMatchObject({ name: expect.any(String), kind: 'component', criteria: ['C2', 'C8'] })
    expect(web.fields).toEqual([...new Set(web.fields)].sort())
    expect(web.fields).toEqual(expect.arrayContaining(['authentication_type', 'input_validation', 'runs_as_root', 'monitoring_tools']))
    expect(element(r, 'f-submit')).toMatchObject({ kind: 'flow', criteria: ['C3', 'C8'], fields: ['auth_failure_mode', 'encryption_in_transit'] })
    expect(element(r, 'd-card')).toMatchObject({ kind: 'data_item', criteria: ['C7'], fields: ['sensitivity'] })
    expect(element(r, 'c-db')).toMatchObject({ kind: 'component', criteria: ['C9'], fields: ['credential_scope'] })
    expect(r.gate3.loopback.elements_total).toBe(r.gate3.loopback.elements.length)
    expect(r.gate3.loopback.not_enrichable).toEqual([])

    const c8 = r.gate3.criteria.C8.failing.find((f) => f.id === 'c-web')!
    expect(c8.placeholder).toEqual(['authentication_type'])
    expect(c8.missing).toEqual(expect.arrayContaining(['monitoring_tools']))
    const c3 = r.gate3.criteria.C3.failing.find((f) => f.id === 'f-submit')!
    expect(c3).toMatchObject({ missing: ['encryption_in_transit'], placeholder: ['auth_failure_mode'], detail: 'placeholder: auth_failure_mode; missing: encryption_in_transit' })
  })

  it('names a flow that needs a data item, with no fields', async () => {
    const r = await gatesOf((m) => { flow(m, 'f-audit').dataItemIds = [] })
    expect(ids(r.gate3.criteria.C4)).toEqual(['f-audit'])
    expect(element(r, 'f-audit')).toMatchObject({ kind: 'flow', criteria: ['C4'], fields: [] })
  })

  it('splits off what enrichment cannot answer, and says why', async () => {
    const unclassified = await gatesOf((m) => { delete component(m, 'c-web').classData })
    expect(other(unclassified, 'c-web')).toMatchObject({ kind: 'component', criteria: ['C1', 'C2'], reason: 'unclassified' })
    expect(element(unclassified, 'c-web')).toBeUndefined()

    const noTemplate = await gatesOf((m) => { delete m.classCache['cls-database'] })
    expect(other(noTemplate, 'c-db')).toMatchObject({ criteria: ['C2'], reason: 'no usable class template' })

    const flag = await gatesOf((m) => { m.scope!.crown_jewel_elements['Customer orders'].push('c-orders') })
    expect(other(flag, 'c-orders')).toMatchObject({ kind: 'component', criteria: ['C6'], reason: expect.stringContaining('crownJewel is not true') })

    const none = await gatesOf((m) => { m.scope!.crown_jewels = [] })
    expect(other(none, '')).toMatchObject({ kind: 'model', criteria: ['C6'], reason: expect.stringContaining('no crown jewels') })
  })

  it('counts past the listing limit', async () => {
    const r = await gatesOf((m) => {
      for (let i = 0; i < MAX_FAILING + 20; i++) boundary(m, 'b-app').components.push(newComponent(`c-bulk-${i}`, 'PROCESS', { classData: undefined }))
    })
    expect(r.gate3.loopback.not_enrichable).toHaveLength(MAX_FAILING)
    expect(r.gate3.loopback.not_enrichable_total).toBe(MAX_FAILING + 20)
  })
})

describe('waiver room', () => {
  it('says why a criterion cannot be waived, and marks each of its failures', async () => {
    const r = await gatesOf((m) => { m.dataItems.length = 0 })
    expect(r.gate3.criteria.C4.waiver_headroom).toMatchObject({ waivable: false, remaining: 0, reason: expect.stringContaining('no data items') })
    for (const f of r.gate3.criteria.C4.failing) expect(f).toMatchObject({ waivable: false, unwaivable_reason: expect.stringContaining('no data items') })
    expect(r.gate3.criteria.C5.waiver_headroom).toMatchObject({ waivable: false, reason: 'C5 is never waived' })
  })

  it('gives each waivable criterion a cap and what remains', async () => {
    const r = await gatesOf((m) => { delete fAttrs(m, 'f-submit').encryption_in_transit })
    const h = r.gate3.criteria.C3.waiver_headroom!
    expect(h.in_use).toBe(0)
    expect(h.remaining).toBe(h.cap)
    if (h.cap === 0) expect(h).toMatchObject({ waivable: false, reason: expect.stringContaining('too few') })
  })
})

describe('model files through the checked reader', () => {
  it('refuses a hard-linked model file with its own code', async () => {
    let caught: unknown
    try {
      await gatesOf(undefined, async (dir) => {
        await fs.link(path.join(dir, 'dataflows.json'), path.join(root, `extra-link-${seq++}`))
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(GateInputError)
    expect((caught as GateInputError).code).toBe('hardlinked')
  })
})
