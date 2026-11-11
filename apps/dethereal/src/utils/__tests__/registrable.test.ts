/**
 * What may be registered: a field of the element's class template with a value that fits it, or a key the
 * gates read or the workflow asks for on that kind of element, with that key's type.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { WORKFLOW_KEYS, type ClassTemplates } from '../gates.js'
import { fieldRefusal, recordRefusal, templateFor, valueRefusal, type TemplateLookup } from '../registrable.js'

const templates: ClassTemplates = {
  templates: new Map([
    ['cls-svc', { name: 'Service', fields: ['input_validation', 'egress_filtering', 'authentication_type'], schema: {
      input_validation: { type: 'string', enum: ['none', 'allow_list', 'schema'] }, egress_filtering: { type: 'boolean' },
      authentication_type: { type: 'string', enum: ['oidc', 'mtls'] },
    } }],
  ]),
  refused: [{ file: '.dethereal/class-cache/cls-empty.json', reason: 'no_fields' }, { file: '.dethereal/class-cache/cls-bad.json', reason: 'class_id_mismatch' }],
}
const svc = templateFor(templates, 'cls-svc')
const code = (group: string, field: string, value: unknown, lookup: TemplateLookup = svc) => valueRefusal(group, field, value, lookup)?.code ?? 'ok'

describe('templateFor', () => {
  it('tells a usable template from a refused one, a missing one, and no class', () => {
    expect(svc.state).toBe('ok')
    expect(templateFor(templates, 'cls-empty')).toEqual({ state: 'unusable', reason: 'no_fields' })
    expect(templateFor(templates, 'cls-bad')).toEqual({ state: 'unusable', reason: 'class_id_mismatch' })
    expect(templateFor(templates, 'cls-other').state).toBe('missing')
    expect(templateFor(templates, '').state).toBe('unclassified')
    expect(templateFor(null, 'cls-svc').state).toBe('missing')
  })
})

describe('an attribute value', () => {
  it("a field of the class: the template's schema decides", () => {
    expect(code('components', 'input_validation', 'allow_list')).toBe('ok')
    expect(code('components', 'input_validation', 'allowlist')).toBe('invalid_value')
  })

  it("a key the workflow asks for, off the template, with its type", () => {
    expect(code('components', 'authentication_type', 'oidc', { state: 'missing' })).toBe('ok')
    expect(code('components', 'authentication_type', '', { state: 'missing' })).toBe('invalid_value')
    expect(code('components', 'implicit_deny_enabled', true)).toBe('ok')
    expect(code('components', 'implicit_deny_enabled', 'yes')).toBe('invalid_value')
    expect(code('components', 'monitoring_tools', [])).toBe('ok')
    expect(code('components', 'monitoring_tools', ['siem', ''])).toBe('invalid_value')
    expect(code('components', 'credential_scope', ['db-app-cred'])).toBe('ok')
    expect(code('components', 'stores_credentials', false)).toBe('ok')
    expect(code('components', 'asset_criticality', 'high')).toBe('ok')
    expect(code('components', 'asset_criticality', 'critical')).toBe('invalid_value')
    expect(code('boundaries', 'allow_any_inbound', false, { state: 'missing' })).toBe('ok')
    expect(code('boundaries', 'allow_any_inbound', 'no', { state: 'missing' })).toBe('invalid_value')
    expect(code('boundaries', 'crown_jewel', true, { state: 'unclassified' })).toBe('ok')
    for (const v of ['deny_all', 'allow_list', 'allow_all']) expect(code('boundaries', 'egress_filtering', v, { state: 'missing' })).toBe('ok')
    expect(code('boundaries', 'egress_filtering', 'maybe', { state: 'missing' })).toBe('invalid_value')
    for (const v of ['deny', 'fallback', 'fail_open', 'fail-open', 'FAIL OPEN']) expect(code('dataFlows', 'auth_failure_mode', v, { state: 'missing' }), v).toBe('ok')
    expect(code('dataFlows', 'auth_failure_mode', 'retry', { state: 'missing' })).toBe('invalid_value')
    expect(code('dataFlows', 'required_credentials', [], { state: 'missing' })).toBe('ok')
    expect(code('dataFlows', 'credential_type', 'none', { state: 'missing' })).toBe('ok')
    expect(code('dataFlows', 'credential_name', 'DB password', { state: 'missing' })).toBe('ok')
    expect(code('dataItems', 'crown_jewel', false, { state: 'missing' })).toBe('ok')
  })

  it("the template wins over a workflow key's type when the class declares the field", () => {
    // The class declares egress_filtering as a boolean: the enum the workflow uses does not apply here.
    expect(code('components', 'egress_filtering', true)).toBe('ok')
    expect(code('components', 'egress_filtering', 'allow_list')).toBe('invalid_value')
    // A workflow key the class declares itself: its enum decides, not the workflow's plain string.
    expect(code('components', 'authentication_type', 'mtls')).toBe('ok')
    expect(code('components', 'authentication_type', 'basic')).toBe('invalid_value')
  })

  it("a workflow key belongs to its own kind of element only", () => {
    expect(code('components', 'allow_any_inbound', true)).toBe('off_template_field')
    expect(code('boundaries', 'auth_failure_mode', 'deny', { state: 'missing' })).toBe('no_template')
    expect(code('dataItems', 'authentication_type', 'oidc', { state: 'missing' })).toBe('no_template')
  })

  it('a transit alias counts only as a field of the class', () => {
    expect(code('dataFlows', 'flow_tls_encrypted', true, { state: 'missing' })).toBe('no_template')
  })

  it("anything else: off_template_field with a class, no_template without one, each with its own remedy", () => {
    expect(code('components', 'made_up_field', 'x')).toBe('off_template_field')
    expect(fieldRefusal('components', 'made_up_field', svc)?.message).toMatch(/drop it \(set with absent: true\)/)
    expect(fieldRefusal('components', 'x', { state: 'missing' })?.message).toMatch(/run generate_attribute_stubs/)
    expect(fieldRefusal('components', 'x', { state: 'unusable', reason: 'no_fields' })?.message).toMatch(/declares no attribute fields/)
    expect(fieldRefusal('components', 'x', { state: 'unusable', reason: 'no_fields' })?.message).not.toMatch(/generate_attribute_stubs/)
    expect(fieldRefusal('components', 'x', { state: 'unusable', reason: 'class_id_mismatch' })?.message).toMatch(/cannot be used \(class_id_mismatch\).*generate_attribute_stubs/)
    expect(fieldRefusal('components', 'x', { state: 'unclassified' })?.message).toMatch(/unclassified/)
    for (const lookup of [{ state: 'missing' }, { state: 'unusable', reason: 'no_fields' }, { state: 'unclassified' }] as TemplateLookup[]) expect(code('components', 'x', 'v', lookup)).toBe('no_template')
  })
})

describe('a record value', () => {
  it("holds a record to its own rule, where it has one on that group", () => {
    expect(recordRefusal('boundaries', 'zone', 'INTERNAL')).toBeNull()
    expect(recordRefusal('boundaries', 'zone', 'BANANA')?.code).toBe('invalid_value')
    expect(recordRefusal('components', 'crownJewel', 'yes')?.code).toBe('invalid_value')
    expect(recordRefusal('boundaries', 'planes', ['WORKLOAD', 'DATA'])?.code).toBe('invalid_value')
    expect(recordRefusal('dataItems', 'regulatory_flags', ['PII', ''])?.code).toBe('invalid_value')
    // Sensitivity as the gates read it: any case, spaces ignored.
    expect(recordRefusal('dataItems', 'sensitivity', 'Restricted')).toBeNull()
    expect(recordRefusal('dataItems', 'sensitivity', ' confidential ')).toBeNull()
    expect(recordRefusal('dataItems', 'sensitivity', 'secret')?.code).toBe('invalid_value')
    // A data item's origin as validate_model_json and a pull write it, and its credential flag.
    expect(recordRefusal('dataItems', 'origin', 'not_assessed')).toBeNull()
    expect(recordRefusal('dataItems', 'origin', 'arbitrary-public')?.code).toBe('invalid_value')
    expect(recordRefusal('dataItems', 'origin', 'ARBITRARY_PUBLIC')?.code).toBe('invalid_value')
    expect(recordRefusal('dataItems', 'origin', '')?.code).toBe('invalid_value')
    expect(recordRefusal('dataItems', 'is_credential', false)).toBeNull()
    expect(recordRefusal('dataItems', 'is_credential', 'yes')?.code).toBe('invalid_value')
    expect(recordRefusal('components', 'origin', 'anything')).toBeNull()
    // No rule of its own: nothing to check.
    expect(recordRefusal('components', 'controls', 'anything')).toBeNull()
    expect(recordRefusal('components', 'zone', 'BANANA')).toBeNull()
  })
})

describe('the keys the workflow asks the operator to decide', () => {
  it("are all registrable on the elements the prose names", () => {
    const prose = readFileSync(path.join(__dirname, '..', '..', '..', 'workflow', 'shared', 'enrichment-protocol.md'), 'utf8')
    const line = prose.split('\n').find((l) => l.includes('never a key a question decides'))
    expect(line, 'the enrichment protocol names the keys a question decides').toBeTruthy()
    const decided = line!.slice(line!.indexOf('never a key a question decides')).split(':')[0]!
    const keys = [...decided.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]!)
    expect(keys).toEqual(['crown_jewel', 'asset_criticality', 'stores_credentials', 'credential_scope', 'required_credentials', 'implicit_deny_enabled', 'allow_any_inbound', 'egress_filtering'])
    const table = new Set(Object.values(WORKFLOW_KEYS).flatMap((k) => Object.keys(k)))
    for (const k of keys) expect(table.has(k), k).toBe(true)
  })
})
