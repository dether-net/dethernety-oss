import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { computeGates, loadGateInput } from '../gates.js'
import { canonicalFlag, isPlaceholderToken, regulatoryFlagFloor, type LintFinding } from '../lints.js'
import { validateModelTool } from '../../tools/validate-model.tool.js'
import { modelStateTool } from '../../tools/model-state.tool.js'
import { gateModel, writeGateModel, type GateModel } from './fixtures/gate-model.js'

let root: string
let seq = 0

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(process.cwd(), '.test-lints-'))
})
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function dirOf(mutate?: (m: GateModel) => void, after?: (dir: string) => Promise<void>): Promise<string> {
  const m = gateModel()
  mutate?.(m)
  const dir = path.join(root, `m${seq++}`)
  await writeGateModel(dir, m)
  await after?.(dir)
  return dir
}
async function lintsOf(mutate?: (m: GateModel) => void, after?: (dir: string) => Promise<void>): Promise<LintFinding[]> {
  return computeGates(await loadGateInput(await dirOf(mutate, after))).lints
}
const rules = (fs_: LintFinding[], severity?: string) => fs_.filter((f) => !severity || f.severity === severity).map((f) => f.rule)
const of = (fs_: LintFinding[], rule: string) => fs_.filter((f) => f.rule === rule).map((f) => f.element?.id ?? f.file).sort()
const walk = (m: GateModel) => {
  const out: any[] = []
  const w = (b: any) => { out.push(b); (b.boundaries ?? []).forEach(w) }
  w(m.structure.defaultBoundary)
  return out
}
const component = (m: GateModel, id: string) => walk(m).flatMap((b) => b.components ?? []).find((c: any) => c.id === id)
const cAttrs = (m: GateModel, id: string) => m.attributes.components[id]!.attributes
const fAttrs = (m: GateModel, id: string) => m.attributes.dataFlows[id]!.attributes

describe('placeholders and flags', () => {
  it('recognises placeholder tokens and not real names', () => {
    for (const v of ['None', ' n/a ', 'N/A', 'na', 'TBD', '-', '?', '', 'unknown', 'None configured', 'no monitoring', 'not configured', '(none)'])
      expect(isPlaceholderToken(v), v).toBe(true)
    for (const v of ['splunk', 'nomad', 'Datadog', 'notary', 'db-app-cred', 'nonesuch'])
      expect(isPlaceholderToken(v), v).toBe(false)
  })

  it('resolves flag spellings and aliases to the canonical flag and its floor', () => {
    expect(canonicalFlag('PII')).toBe('PII')
    expect(canonicalFlag('pii')).toBe('PII')
    expect(canonicalFlag('HIPAA')).toBe('PHI')
    expect(canonicalFlag('PCI-DSS')).toBe('PCI cardholder')
    expect(canonicalFlag('export controlled')).toBeNull()
    expect(regulatoryFlagFloor('hipaa')).toBe(3)
    expect(regulatoryFlagFloor('gdpr')).toBe(2)
  })
})

describe('clean models', () => {
  it('finds no error or warning on the reference model', async () => {
    const lints = await lintsOf()
    expect(rules(lints, 'error')).toEqual([])
    expect(rules(lints, 'warning')).toEqual([])
  })

  it('finds nothing to complain about in honest insecure answers', async () => {
    const lints = await lintsOf((m) => {
      Object.assign(cAttrs(m, 'c-web'), { authentication_type: 'none', encryption_in_transit: 'none', monitoring_tools: [] })
      Object.assign(fAttrs(m, 'f-submit'), { credential_type: 'none', required_credentials: [], encryption_in_transit: 'none', auth_failure_mode: 'fail_open' })
    })
    expect(rules(lints, 'error')).toEqual([])
    expect(rules(lints, 'warning')).toEqual([])
  })
})

describe('MITRE technique annotations', () => {
  it.each([
    ['a mitre key', (m: GateModel) => { cAttrs(m, 'c-web').mitre_attack_techniques = ['T1190'] }],
    ['a ttps key', (m: GateModel) => { cAttrs(m, 'c-web').ttps = 'initial access' }],
    ['an id in a sentence', (m: GateModel) => { cAttrs(m, 'c-web').notes = 'Exposed to T1190 - Exploit Public-Facing Application' }],
    ['a nested id', (m: GateModel) => { cAttrs(m, 'c-web').threats = [{ tactic: 'TA0001' }] }],
    ['a sub-technique', (m: GateModel) => { cAttrs(m, 'c-web').refs = ['T1078.004'] }],
  ])('blocks Gate 2 on %s', async (_label, mutate) => {
    const dir = await dirOf(mutate)
    const g = computeGates(await loadGateInput(dir))
    expect(of(g.lints, 'mitre_technique_field')).toEqual(['c-web'])
    expect(g.gate2.checks.lint_errors!.verdict).toBe('FAIL')
  })

  it('exempts a field the class template declares', async () => {
    const lints = await lintsOf((m) => {
      m.classCache['cls-service']!.template.schema.properties.attack_technique_ids = { type: 'array' }
      cAttrs(m, 'c-web').attack_technique_ids = ['T1190']
    })
    expect(of(lints, 'mitre_technique_field')).toEqual([])
  })

  it('only warns on a key that merely mentions a technique', async () => {
    const lints = await lintsOf((m) => { cAttrs(m, 'c-db').hashing_technique = 'bcrypt' })
    expect(of(lints, 'mitre_technique_field')).toEqual([])
    expect(of(lints, 'technique_key')).toEqual(['c-db'])
  })

  it('catches a MITRE key moved into the structure', async () => {
    const lints = await lintsOf((m) => { component(m, 'c-web').mitre_techniques = ['T1190'] })
    expect(of(lints, 'mitre_technique_field')).toEqual(['c-web'])
  })
})

describe('geometry', () => {
  it('blocks Gate 2 on a component without a position', async () => {
    const dir = await dirOf((m) => { delete component(m, 'c-web').positionX })
    const g = computeGates(await loadGateInput(dir))
    expect(of(g.lints, 'component_position_missing')).toEqual(['c-web'])
    expect(g.gate2.verdict).toBe('FAIL')
  })

  it('warns on invented geometry keys with the geometry remedy', async () => {
    const lints = await lintsOf((m) => { component(m, 'c-web').layout = { x: 0, y: 0, width: 100, height: 60 } })
    const f = lints.find((x) => x.rule === 'unknown_element_key')!
    expect(f.element!.id).toBe('c-web')
    expect(f.message).toContain('positionX/positionY')
  })

  it('warns on siblings stacked on one point, not on elements in different boundaries', async () => {
    const stacked = await lintsOf((m) => { for (const b of walk(m)) for (const c of b.components ?? []) { c.positionX = 0; c.positionY = 0 } })
    expect(of(stacked, 'siblings_share_position').length).toBe(5) // one per boundary with two components
    const apart = await lintsOf((m) => {
      component(m, 'c-web').positionX = 40; component(m, 'c-web').positionY = 40
      component(m, 'c-orders').positionX = 40; component(m, 'c-orders').positionY = 40
    })
    expect(of(apart, 'siblings_share_position')).toEqual([])
  })

  it('warns on unknown keys on flows, data items and the structure root', async () => {
    const lints = await lintsOf((m) => {
      ;(m.dataFlows[0] as any).weight = 3
      ;(m.dataItems[0] as any).regulatoryFlags = ['PII']
      ;(m.structure as any).version = 2
    })
    expect(of(lints, 'unknown_element_key')).toEqual(['d-card', 'f-checkout', undefined].sort())
  })

  it('takes a data item\'s controls as a known key', async () => {
    const lints = await lintsOf((m) => { (m.dataItems[0] as any).controls = [{ id: 'ctl-1', name: 'Tokenisation' }] })
    expect(of(lints, 'unknown_element_key')).toEqual([])
  })
})

describe('credentials', () => {
  it.each([
    ['credential_without_required_credentials', (m: GateModel) => { delete fAttrs(m, 'f-submit').required_credentials }],
    ['empty_credentials_on_authenticated_flow', (m: GateModel) => { fAttrs(m, 'f-submit').required_credentials = [] }],
    ['credentials_where_authentication_none', (m: GateModel) => { fAttrs(m, 'f-submit').credential_type = 'None' }],
    ['credential_placeholder', (m: GateModel) => { fAttrs(m, 'f-submit').required_credentials = ['none'] }],
  ])('warns: %s', async (rule, mutate) => {
    const lints = await lintsOf(mutate)
    expect(of(lints, rule)).toEqual(['f-submit'])
  })

  it('warns on a placeholder credential scope', async () => {
    const lints = await lintsOf((m) => { cAttrs(m, 'c-audit').credential_scope = ['N/A'] })
    expect(of(lints, 'credential_placeholder')).toEqual(['c-audit'])
  })

  it('keeps a credential name on a flow typed none quiet', async () => {
    const lints = await lintsOf((m) => Object.assign(fAttrs(m, 'f-submit'), { credential_type: 'none', credential_name: 'shop-session-id', required_credentials: [], auth_failure_mode: 'fail_open' }))
    expect(rules(lints, 'warning')).toEqual([])
  })

  it('reads a response or pull flow through its own credential type, not its target\'s', async () => {
    // Like a registry → frontend image pull: the frontend serves users without authentication.
    const lints = await lintsOf((m) => {
      cAttrs(m, 'c-web').authentication_type = 'none'
      Object.assign(fAttrs(m, 'f-render'), { credential_type: 'service_account', required_credentials: ['node-sa'] })
    })
    expect(rules(lints, 'warning')).toEqual([])
    expect(of(lints, 'component_auth_mismatch')).not.toContain('f-render')
  })

  it('reports component hints as info only', async () => {
    const lints = await lintsOf((m) => {
      delete fAttrs(m, 'f-submit').credential_type
      fAttrs(m, 'f-submit').required_credentials = []
    })
    expect(lints.filter((f) => f.rule === 'component_auth_mismatch').every((f) => f.severity === 'info')).toBe(true)
    // f-report and f-audit record no credential type either, and their targets authenticate.
    expect(of(lints, 'component_auth_mismatch')).toEqual(['f-audit', 'f-report', 'f-submit'])
  })

  it('warns once, naming every flow, when flows that declare no authentication record deny or fallback', async () => {
    const lints = await lintsOf((m) => {
      for (const id of ['f-report', 'f-audit']) fAttrs(m, id).auth_failure_mode = 'deny'
      Object.assign(fAttrs(m, 'f-submit'), { auth_failure_mode: 'Fallback', required_credentials: [] })
      delete fAttrs(m, 'f-submit').credential_type
    })
    const found = lints.filter((f) => f.rule === 'auth_failure_mode_without_auth')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: 'warning' })
    for (const id of ['f-report', 'f-audit', 'f-submit']) expect(found[0]!.message).toContain(id)
    expect(of(lints, 'auth_without_credentials')).toEqual([])
  })

  it('reports deny with only placeholder credentials once, as info', async () => {
    const lints = await lintsOf((m) => {
      for (const id of ['f-report', 'f-audit']) Object.assign(fAttrs(m, id), { auth_failure_mode: 'deny', required_credentials: ['TBD'] })
    })
    const found = lints.filter((f) => f.rule === 'auth_without_credentials')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: 'info' })
    expect(found[0]!.message).toContain('2 flow(s)')
    expect(of(lints, 'auth_failure_mode_without_auth')).toEqual([])
  })

  it('reads fail_open without credentials as no authentication, not as a missing credential', async () => {
    const lints = await lintsOf((m) => Object.assign(fAttrs(m, 'f-submit'), { credential_type: 'none', required_credentials: [], auth_failure_mode: 'fail_open' }))
    expect(of(lints, 'auth_without_credentials')).not.toContain('f-submit')
  })

  it('reports shared credential ids and unknown credential types as info', async () => {
    const lints = await lintsOf((m) => {
      fAttrs(m, 'f-admin').required_credentials = ['checkout-token']
      fAttrs(m, 'f-admin').credential_type = 'jwt'
    })
    expect(lints.find((f) => f.rule === 'shared_credential_id')).toMatchObject({ severity: 'info' })
    expect(lints.find((f) => f.rule === 'credential_type_unknown')).toMatchObject({ severity: 'info', element: { id: 'f-admin' } })
  })
})

describe('monitoring, flags and asset signals', () => {
  it.each([[['None']], [['None configured']], [['-']], [['n/a', 'TBD']]])('warns on monitoring_tools %j', async (tools) => {
    const lints = await lintsOf((m) => { cAttrs(m, 'c-db').monitoring_tools = tools })
    expect(of(lints, 'monitoring_tools_placeholder')).toEqual(['c-db'])
  })

  it('warns on flags that are not spelled canonically, and says which one is meant', async () => {
    const lints = await lintsOf((m) => { m.dataItems[2]!.regulatory_flags = ['pii', 'HIPAA', 'export controlled'] })
    const msgs = lints.filter((f) => f.rule === 'non_canonical_regulatory_flag').map((f) => f.message)
    expect(msgs).toHaveLength(3)
    expect(msgs[0]).toContain('"PII"')
    expect(msgs[1]).toContain('"PHI"')
    expect(msgs[2]).toContain('not a canonical regulatory flag')
  })

  it('warns on sensitivity kept in an attribute file', async () => {
    const lints = await lintsOf((m) => { cAttrs(m, 'c-db').sensitivity = 'restricted' })
    expect(of(lints, 'asset_signal_in_attributes')).toEqual(['c-db'])
  })

  it("reads a data item's origin and credential flag as its own fields, and warns when they sit in its attributes", async () => {
    const own = await lintsOf((m) => { Object.assign(m.dataItems.find((d) => d.id === 'd-audit')!, { origin: 'curated_internal', is_credential: false }) })
    expect(of(own, 'unknown_element_key')).toEqual([])
    const misplaced = await lintsOf((m) => {
      m.attributes.dataItems['d-audit'] = { elementId: 'd-audit', elementType: 'dataItem', elementName: 'Audit event', attributes: { origin: 'curated_internal', is_credential: true } }
    })
    const found = misplaced.filter((f) => f.rule === 'asset_signal_in_attributes')
    expect(found.map((f) => f.element?.id)).toEqual(['d-audit', 'd-audit'])
    expect(found.map((f) => f.message).join(' ')).toMatch(/sets origin .*sets is_credential/)
  })

  it('leaves an origin attribute on a component alone: only a data item owns that field', async () => {
    const lints = await lintsOf((m) => { cAttrs(m, 'c-db').origin = 'https://shop.example' })
    expect(of(lints, 'asset_signal_in_attributes')).toEqual([])
  })
})

describe('where the lints land', () => {
  it('gives model_state and gates the same Gate 2', async () => {
    const dir = await dirOf((m) => { cAttrs(m, 'c-web').mitre_attack_techniques = ['T1190'] }, async (d) => {
      await fs.writeFile(path.join(d, '.dethereal', 'state.json'), JSON.stringify({
        currentState: 'ENRICHING', completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE'], staleElements: [],
      }))
    })
    const gates = (await validateModelTool.run({ action: 'gates', directory_path: dir }, { debug: false })).data as any
    expect(gates.gate2.verdict).toBe('FAIL')
    const state = await modelStateTool.run({ action: 'get', directory_path: dir }, { debug: false })
    expect((state.data as any).gates.gate2).toBe('FAIL')
    const promote = await modelStateTool.run({ action: 'transition', directory_path: dir, to: 'REVIEWED' }, { debug: false })
    expect(promote.error).toContain('Gate 2 fails')
  })

  it('makes validate invalid on a lint error and lists warnings with their rule', async () => {
    const dir = await dirOf((m) => { delete component(m, 'c-web').positionY; cAttrs(m, 'c-db').monitoring_tools = ['None'] })
    const data = (await validateModelTool.run({ action: 'validate', directory_path: dir }, { debug: false })).data as any
    expect(data.valid).toBe(false)
    expect(data.errors.some((e: any) => e.message.startsWith('component_position_missing:'))).toBe(true)
    expect(data.warnings.some((w: any) => w.message.startsWith('monitoring_tools_placeholder:'))).toBe(true)
  })

  it('lists the Gate 3 criteria still open as warnings', async () => {
    const lints = await lintsOf((m) => { delete m.scope!.crown_jewel_elements })
    expect(lints.find((f) => f.rule === 'gate3_in_progress')!.message).toContain('Gate 3 C6')
  })

  it('keeps validate a successful call when the model cannot be loaded', async () => {
    const dir = await dirOf(undefined, async (d) => { await fs.writeFile(path.join(d, 'structure.json'), 'not json') })
    const r = await validateModelTool.run({ action: 'validate', directory_path: dir }, { debug: false })
    expect(r.success).toBe(true)
    expect((r.data as any).valid).toBe(false)
  })
})

describe('contradictions, off-schema values and aliases', () => {
  it('warns on twin fields that disagree, naming the fields and never the values', async () => {
    const lints = await lintsOf((m) => Object.assign(cAttrs(m, 'c-db'), { encrypted_at_rest: false, encryption_at_rest: 'AES-256' }))
    const found = lints.find((f) => f.rule === 'contradictory_fields')!
    expect(found).toMatchObject({ severity: 'warning', element: { id: 'c-db' } })
    expect(found.message).toContain('encrypted_at_rest/encryption_at_rest')
    expect(found.message).not.toContain('AES-256')
    expect(found.message).toContain('change neither field until confirmed')
  })

  it('stays quiet on a consistent pair', async () => {
    const lints = await lintsOf((m) => Object.assign(cAttrs(m, 'c-db'), { encrypted_at_rest: false, encryption_at_rest: 'none' }))
    expect(of(lints, 'contradictory_fields')).toEqual([])
  })

  it('names the fields whose value the class schema does not allow, and ignores null stubs and placeholders', async () => {
    const lints = await lintsOf((m) => { cAttrs(m, 'c-web').input_validation = 'strict'; cAttrs(m, 'c-orders').runs_as_root = 'no' })
    const found = lints.filter((f) => f.rule === 'value_off_schema')
    expect(found.map((f) => f.element?.id).sort()).toEqual(['c-orders', 'c-web'])
    expect(found.find((f) => f.element?.id === 'c-web')!.message).toContain('input_validation')
    expect(found[0]!.message).not.toContain('strict')
    const quiet = await lintsOf((m) => { cAttrs(m, 'c-web').input_validation = null; cAttrs(m, 'c-orders').input_validation = 'TBD' })
    expect(of(quiet, 'value_off_schema')).toEqual([])
  })

  it('asks to remove an alias, and says so when the canonical flag is already listed', async () => {
    const lints = await lintsOf((m) => { m.dataItems[2]!.regulatory_flags = ['PII', 'pii'] })
    const msg = lints.find((f) => f.rule === 'non_canonical_regulatory_flag')!.message
    expect(msg).toContain('Remove the alias; "PII" is already listed.')
    const other = await lintsOf((m) => { m.dataItems[2]!.regulatory_flags = ['pii'] })
    expect(other.find((f) => f.rule === 'non_canonical_regulatory_flag')!.message).toContain('Replace it with "PII" (remove the alias).')
  })
})
