/**
 * What may be registered as the operator's: one rule for every decision that registers a value (set, confirm,
 * accept, modify), and for how model_state get codes a row that no decision could register.
 *
 * An attribute value registers when its field is a field of the element's class template and the value fits
 * the template's schema, or when the field is a key the gates read or the workflow asks for on that kind of
 * element (WORKFLOW_KEYS) and the value has that key's type. A record value registers when it fits the
 * record's own rule, where it has one. Removing a value never needs the rule.
 */
import { WORKFLOW_KEYS, isAuthFailureMode, type ClassTemplate, type ClassTemplates, type WorkflowKeyType } from './gates.js'
import { ORIGIN_LEVELS } from '@dethernety/dt-core'
import { SENSITIVITY_SCALE, isValidForSchema, sensitivityRank } from './lints.js'

export type RegistrableCode = 'off_template_field' | 'no_template' | 'invalid_value'

export interface Refused {
  code: RegistrableCode
  message: string
}

/** An element's class template as the class cache holds it: usable, unusable (refused), missing, or no class at all. */
export type TemplateLookup =
  | { state: 'ok'; template: ClassTemplate }
  | { state: 'unusable'; reason: string }
  | { state: 'missing' | 'unclassified' }

export function templateFor(templates: ClassTemplates | null | undefined, classId: string | null | undefined): TemplateLookup {
  if (!classId) return { state: 'unclassified' }
  const template = templates?.templates.get(classId)
  if (template) return { state: 'ok', template }
  const refused = templates?.refused.find((r) => r.file.endsWith(`/${classId}.json`))
  return refused ? { state: 'unusable', reason: refused.reason } : { state: 'missing' }
}

const ZONES = ['UNTRUSTED', 'PUBLIC', 'EXPOSED', 'INTERNAL', 'RESTRICTED', 'VENDOR']
const PLANES = ['WORKLOAD', 'MANAGEMENT']
const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim().length > 0)

/** The record fields `set` writes, each on its own group, with the values it takes. */
export const SETTABLE_RECORDS: Record<string, { group: string; valid: (v: unknown) => boolean; message: string }> = {
  zone: { group: 'boundaries', valid: (v) => typeof v === 'string' && ZONES.includes(v), message: `zone is one of ${ZONES.join(', ')}` },
  domains: { group: 'boundaries', valid: strings, message: 'domains is a list of non-empty strings' },
  planes: { group: 'boundaries', valid: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && PLANES.includes(x)), message: `planes is a list of ${PLANES.join(', ')}` },
  crownJewel: { group: 'components', valid: (v) => typeof v === 'boolean', message: 'crownJewel is true or false' },
  // As the gates read it: any case, surrounding spaces ignored (the platform writes some of it capitalised).
  sensitivity: { group: 'dataItems', valid: (v) => sensitivityRank(v) >= 0, message: `sensitivity is one of ${SENSITIVITY_SCALE.join(', ')}` },
  regulatory_flags: { group: 'dataItems', valid: strings, message: 'regulatory_flags is a list of non-empty strings' },
  // Exactly as validate_model_json and a pull write it: a lowercase token, never the platform's capitalised form.
  origin: { group: 'dataItems', valid: (v) => typeof v === 'string' && (ORIGIN_LEVELS as readonly string[]).includes(v), message: `origin is one of ${ORIGIN_LEVELS.join(', ')}` },
  is_credential: { group: 'dataItems', valid: (v) => typeof v === 'boolean', message: 'is_credential is true or false' },
}

/** Why a record value cannot be registered, or null: only a record with a rule of its own on this group is checked. */
export function recordRefusal(group: string, field: string, value: unknown): Refused | null {
  const rule = SETTABLE_RECORDS[field]
  if (!rule || rule.group !== group) return null
  return rule.valid(value) ? null : { code: 'invalid_value', message: rule.message }
}

function fitsType(t: WorkflowKeyType, v: unknown): boolean {
  if (t === 'string') return typeof v === 'string' && v.trim().length > 0
  if (t === 'boolean') return typeof v === 'boolean'
  if (t === 'string[]') return Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim().length > 0)
  if (t === 'auth_failure_mode') return isAuthFailureMode(v)
  return typeof v === 'string' && t.enum.includes(v)
}

function describeType(t: WorkflowKeyType): string {
  if (t === 'string[]') return 'a list of non-empty strings'
  if (t === 'auth_failure_mode') return 'deny, fallback or fail_open'
  if (typeof t === 'object') return `one of ${t.enum.join(', ')}`
  return t === 'string' ? 'a non-empty string' : 'true or false'
}

const workflowKey = (group: string, field: string): WorkflowKeyType | undefined => {
  const keys = (WORKFLOW_KEYS as Record<string, Readonly<Record<string, WorkflowKeyType>>>)[group]
  return keys && Object.prototype.hasOwnProperty.call(keys, field) ? keys[field] : undefined
}

/** Why no value of this field can be registered on the element, or null when some value can. */
export function fieldRefusal(group: string, field: string, lookup: TemplateLookup): Refused | null {
  if (lookup.state === 'ok' && lookup.template.fields.includes(field)) return null
  if (workflowKey(group, field) !== undefined) return null
  if (lookup.state === 'ok') {
    return { code: 'off_template_field', message: `${field} is neither a field of the element's class nor a key the workflow asks for: drop it (set with absent: true) or reclassify the element` }
  }
  return {
    code: 'no_template',
    message: lookup.state === 'unclassified'
      ? `the element is unclassified, so only the workflow's keys register: classify it, or drop ${field} (set with absent: true)`
      : lookup.state === 'unusable' && lookup.reason === 'no_fields'
        ? `the element's class declares no attribute fields, so only the workflow's keys register: drop ${field} (set with absent: true)`
        : lookup.state === 'unusable'
          ? `the element's class-cache entry cannot be used (${lookup.reason}), so only the workflow's keys register: run generate_attribute_stubs with platform access to rewrite it, or drop ${field} (set with absent: true)`
        : `the element's class has no template in the class cache, so only the workflow's keys register: run generate_attribute_stubs with platform access, or drop ${field} (set with absent: true)`,
  }
}

/** Why this attribute value cannot be registered on the element, or null. */
export function valueRefusal(group: string, field: string, value: unknown, lookup: TemplateLookup): Refused | null {
  const why = fieldRefusal(group, field, lookup)
  if (why) return why
  if (lookup.state === 'ok' && lookup.template.fields.includes(field)) {
    return isValidForSchema(value, lookup.template.schema[field]) ? null : { code: 'invalid_value', message: `the value does not fit the class template's ${field}` }
  }
  const t = workflowKey(group, field)!
  return fitsType(t, value) ? null : { code: 'invalid_value', message: `${field} is ${describeType(t)}` }
}
