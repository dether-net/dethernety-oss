/**
 * Validation lints, and the value predicates the gates share.
 *
 * The rule behind every lint: never reward an invented value. A placeholder
 * ("unknown", "none configured", ["none"]), an annotation the platform derives
 * itself (MITRE techniques), invented structure keys or stacked-up geometry are
 * findings; an honest insecure answer ("none", false, []) never is. Every
 * finding names its own remedy, and none asks for a value to be made up.
 *
 * Errors block Gate 2 (through the gates); warnings and info are advisory.
 */
import { flattenStructure } from '@dethernety/dt-core'
import type { ElementAttributes, StructureBoundary } from '@dethernety/dt-core'
import type { ClassTemplate, GateInput } from './gates.js'

// =============================================================================
// Values
// =============================================================================

/**
 * Placeholder answers, compared after trimming and lower-casing. `"unknown"` is
 * the only sentinel the class templates document; the empty string is never an
 * answer. A class template that documents another unknown/declined sentinel
 * belongs here.
 */
export const STAND_INS: readonly string[] = ['unknown', '']

/** Code point → the Latin letter it looks like: Cyrillic, Greek, Armenian, small capitals and IPA look-alikes of a–z. */
const CONFUSABLES: ReadonlyMap<number, string> = new Map([
  // Cyrillic, lower and upper case
  [0x0430, 'a'], [0x0435, 'e'], [0x043e, 'o'], [0x0440, 'p'], [0x0441, 'c'], [0x0443, 'y'], [0x0445, 'x'], [0x0456, 'i'],
  [0x0458, 'j'], [0x0455, 's'], [0x0501, 'd'], [0x051b, 'q'], [0x051d, 'w'], [0x04bb, 'h'], [0x04cf, 'l'],
  [0x0410, 'A'], [0x0412, 'B'], [0x0415, 'E'], [0x041a, 'K'], [0x041c, 'M'], [0x041d, 'H'], [0x041e, 'O'], [0x0420, 'P'],
  [0x0421, 'C'], [0x0422, 'T'], [0x0423, 'Y'], [0x0425, 'X'], [0x0406, 'I'], [0x0408, 'J'], [0x0405, 'S'],
  // Greek
  [0x0391, 'A'], [0x0392, 'B'], [0x0395, 'E'], [0x0396, 'Z'], [0x0397, 'H'], [0x0399, 'I'], [0x039a, 'K'], [0x039c, 'M'],
  [0x039d, 'N'], [0x039f, 'O'], [0x03a1, 'P'], [0x03a4, 'T'], [0x03a5, 'Y'], [0x03a7, 'X'],
  [0x03b1, 'a'], [0x03b9, 'i'], [0x03ba, 'k'], [0x03bd, 'v'], [0x03bf, 'o'], [0x03c1, 'p'], [0x03c5, 'u'], [0x03c7, 'x'],
  // Armenian
  [0x0585, 'o'], [0x057d, 'u'], [0x0570, 'h'], [0x0578, 'n'], [0x0584, 'q'],
  // Small capitals and IPA
  [0x1d00, 'a'], [0x0299, 'b'], [0x1d04, 'c'], [0x1d05, 'd'], [0x1d07, 'e'], [0xa730, 'f'], [0x0262, 'g'], [0x029c, 'h'],
  [0x026a, 'i'], [0x1d0a, 'j'], [0x1d0b, 'k'], [0x029f, 'l'], [0x1d0d, 'm'], [0x0274, 'n'], [0x1d0f, 'o'], [0x1d18, 'p'],
  [0x0280, 'r'], [0xa731, 's'], [0x1d1b, 't'], [0x1d1c, 'u'], [0x1d20, 'v'], [0x1d21, 'w'], [0x028f, 'y'], [0x1d22, 'z'],
  [0x0251, 'a'], [0x0261, 'g'], [0x0131, 'i'],
])

/** Marks, format characters, default-ignorable characters and the braille blank: all render as nothing. */
const INVISIBLE = /[\p{M}\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/gu

/**
 * A value's text as the placeholder rules compare it: decomposed (NFKD, so
 * full-width and accented letters become plain), with marks and everything
 * invisible removed, trimmed, look-alike letters from other scripts folded to
 * the Latin letter they imitate, lower-cased, and punctuation and symbols
 * stripped from both ends. A value that is empty after this ("?", "-", a
 * zero-width space) says nothing.
 */
export function normToken(value: string): string {
  const bare = value.normalize('NFKD').replace(INVISIBLE, '').trim()
  let folded = ''
  for (const ch of bare) folded += CONFUSABLES.get(ch.codePointAt(0)!) ?? ch
  return folded.toLowerCase().replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, '')
}

/** Regex sources of the not-applicable spellings (matched against `normToken`), shared with the acceptance keys. */
export const NOT_APPLICABLE_SPELLINGS: readonly string[] = ['n[\\s\\p{P}\\p{S}]*a', 'not[\\s\\p{P}\\p{S}]*applicable']
// The whole value, or followed by a space or a parenthesis: "n / a (process)" is one, "na-east-1" is not.
const NOT_APPLICABLE_RE = new RegExp(`^(?:${NOT_APPLICABLE_SPELLINGS.join('|')})(?:$|\\s|\\()`, 'iu')
/** A not-applicable answer in any spelling ("n/a", "N.A.", "n / a", "not applicable"). */
export const isNotApplicable = (v: unknown): boolean => typeof v === 'string' && NOT_APPLICABLE_RE.test(normToken(v))

const isStandInString = (v: unknown): boolean => typeof v === 'string' && STAND_INS.includes(normToken(v))

/** Markers that never appear in an honest value, wherever they stand. */
const PLACEHOLDER_ANYWHERE = /(^|[^\p{L}\p{N}])(tbd|tbc|tba|todo|fixme|xxx|to be (confirmed|determined|decided|defined|verified))($|[^\p{L}\p{N}])/u
/** Openings that say the value is not known ("not encrypted" or "none" stay honest). */
const PLACEHOLDER_OPENING = new RegExp(
  '^(unknown|unsure|unclear|uncertain|undetermined|unspecified|pending|placeholder|idk|no idea|' +
  'not (sure|known|yet|specified|documented|determined|confirmed|stated|provided|clear|certain))($|[^\\p{L}\\p{N}])', 'u')

/**
 * Free text that stands in for an answer: empty once normalised, a marker such
 * as "TBD" or "to be confirmed" anywhere, or an opening such as "unknown",
 * "pending" or "not specified".
 */
export function isPlaceholderText(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const t = normToken(value)
  return t === '' || PLACEHOLDER_ANYWHERE.test(t) || PLACEHOLDER_OPENING.test(t)
}

/** A placeholder: a stand-in string, or a non-empty array holding only stand-in strings. */
export function isStandIn(value: unknown): boolean {
  return isStandInString(value) || (Array.isArray(value) && value.length > 0 && value.every(isStandInString))
}

/** The laziest answer of each type: `false`, `0`, `[]`, `"none"`. Valid, and reported. */
export function isTypeDefault(value: unknown): boolean {
  return value === false || value === 0 || (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'string' && value.trim().toLowerCase() === 'none')
}

const hasType = (v: unknown, type: unknown): boolean => {
  switch (type) {
    case 'string': return typeof v === 'string'
    case 'boolean': return typeof v === 'boolean'
    case 'number': return typeof v === 'number'
    case 'integer': return Number.isInteger(v)
    case 'array': return Array.isArray(v)
    case 'object': return !!v && typeof v === 'object' && !Array.isArray(v)
    case 'null': return v === null
    default: return true
  }
}

/**
 * Whether `value` fits a class-template field's schema: its `type` and `enum`,
 * and for arrays the items' `type` and `enum`. Richer schemas (`oneOf`, nested
 * objects) are not interpreted and pass.
 */
export function isValidForSchema(value: unknown, schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return true
  const s = schema as { type?: unknown; enum?: unknown; items?: { type?: unknown; enum?: unknown } }
  if (Array.isArray(s.enum) && !s.enum.some((e) => e === value)) return false
  if (typeof s.type === 'string' && !hasType(value, s.type)) return false
  if (Array.isArray(s.type) && !s.type.some((t) => hasType(value, t))) return false
  if (s.type === 'array' && Array.isArray(value) && s.items && typeof s.items === 'object') {
    const items = s.items
    if (typeof items.type === 'string' && !value.every((x) => hasType(x, items.type))) return false
    if (Array.isArray(items.enum) && !value.every((x) => (items.enum as unknown[]).includes(x))) return false
  }
  return true
}

/** Element ids: the attribute-file name charset, length-capped. */
export const ELEMENT_ID = /^[A-Za-z0-9_-]{1,256}$/

const own = (o: unknown, k: string): boolean =>
  !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k)
const present = (o: Record<string, unknown>, k: string): boolean => own(o, k) && o[k] !== null && o[k] !== undefined

/** The sensitivity scale, lowest first. */
export const SENSITIVITY_SCALE = ['public', 'internal', 'confidential', 'restricted'] as const

/** Position on the scale (case-insensitive); -1 for anything off it, including stand-ins. */
export function sensitivityRank(value: unknown): number {
  return typeof value === 'string' ? (SENSITIVITY_SCALE as readonly string[]).indexOf(value.trim().toLowerCase()) : -1
}

/** Sensitivity floor of each canonical regulatory flag (exact spelling). */
export const REGULATORY_FLAG_FLOORS: Readonly<Record<string, number>> = {
  'PCI cardholder': 3,
  PHI: 3,
  'GDPR personal': 2,
  PII: 2,
  'SOX financial': 2,
  'CCPA personal': 2,
}


/**
 * Placeholder entries in free-text lists (tools, credential ids): an entry that
 * names nothing. Besides placeholder text, "none", "n/a", "null" and phrases
 * that start with "no", "none" or "not" as a separate word ("no monitoring",
 * "none configured") count; an id such as "no-reply-smtp" does not.
 */
const PLACEHOLDER_TOKENS = new Set(['none', 'null', 'nil', 'undefined'])

export function isPlaceholderToken(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const t = normToken(value)
  return isPlaceholderText(value) || isNotApplicable(value) || PLACEHOLDER_TOKENS.has(t) || /^(no|none|not)(\s|$)/.test(t)
}

/**
 * A flow that declares it presents no authentication: no credentials, and no
 * credential type (or "none"). It has no authentication failure mode.
 */
export function declaresNoAuthentication(a: Record<string, unknown>): boolean {
  const ct = typeof a.credential_type === 'string' ? normToken(a.credential_type) : undefined
  return Array.isArray(a.required_credentials) && a.required_credentials.length === 0 &&
    (a.credential_type === undefined || a.credential_type === null || ct === 'none')
}

/**
 * What a flow's attributes say about its authentication: `declared_none` when
 * it declares that it presents none; `declared` when it names a credential or
 * a credential type (a real one, not a placeholder, other than none);
 * `undeclared` otherwise.
 */
export function flowAuthentication(a: Record<string, unknown>): 'declared' | 'declared_none' | 'undeclared' {
  if (declaresNoAuthentication(a)) return 'declared_none'
  const rc = Array.isArray(a.required_credentials) ? a.required_credentials : []
  if (rc.some((c) => typeof c === 'string' && c.trim() !== '' && !isPlaceholderToken(c))) return 'declared'
  const ct = a.credential_type
  if (typeof ct === 'string' && ct.trim() !== '' && !isPlaceholderToken(ct) && normToken(ct) !== 'none') return 'declared'
  return 'undeclared'
}

/** A word mixing Latin letters with Cyrillic or Greek ones, as written (before any normalisation). */
const MIXED_SCRIPT_WORD = /(?=\p{L}*\p{Script=Latin})(?=\p{L}*[\p{Script=Cyrillic}\p{Script=Greek}])\p{L}+/u

/** Does any string in `value` hold a word that mixes Latin with Cyrillic or Greek letters? */
export function hasMixedScriptWord(value: unknown): boolean {
  if (typeof value === 'string') return MIXED_SCRIPT_WORD.test(value)
  return Array.isArray(value) && value.some(hasMixedScriptWord)
}

/** Transit and at-rest answers that say the data is not encrypted, as a whole value. */
const ENCRYPTION_NEGATIONS = new Set([
  'none', 'no', 'off', 'disabled', 'false', 'plaintext', 'plain text', 'cleartext', 'clear text', 'unencrypted', 'not encrypted',
  'no encryption', 'http', 'sslv3', 'ssl v3', 'sslv2', 'tls 1.0', 'tls1.0', 'tlsv1.0', 'tls 1.1', 'tls1.1', 'tlsv1.1',
])
/** At-rest answers that name only a broken cipher. */
const AT_REST_NEGATIONS = new Set(['des', '3des', 'triple-des', 'triple des', 'rc4'])
/** Whole-value answers that affirm encryption for a field that asks about it. */
const ENCRYPTION_AFFIRMATIONS = new Set(['yes', 'true', 'on', 'enabled'])
/** Terms that name encryption in place. */
const ENCRYPTION_TERMS = /(^|[^\p{L}])(tls|ssl|https|mtls|ipsec|wireguard|ssh|sftp|vpn|aes|kms|sse|tde|luks|bitlocker|encrypted|encryption)([^\p{L}]|$)/u

/**
 * What an encryption answer claims: `affirms` (it names encryption in place),
 * `negates` (the whole value says there is none, or only a deprecated protocol)
 * or `indeterminate` (a placeholder, not-applicable, or anything else).
 * Coverage counts only `affirms`, and a boolean twin contradicts only a clear claim.
 */
export function encryptionClaim(value: unknown, kind: 'transit' | 'rest' = 'transit'): 'affirms' | 'negates' | 'indeterminate' {
  if (typeof value !== 'string' || isStandIn(value) || isPlaceholderText(value)) return 'indeterminate'
  const t = normToken(value)
  if (ENCRYPTION_NEGATIONS.has(t) || (kind === 'rest' && AT_REST_NEGATIONS.has(t))) return 'negates'
  if (ENCRYPTION_AFFIRMATIONS.has(t)) return 'affirms'
  if (isNotApplicable(value)) return 'indeterminate'
  return ENCRYPTION_TERMS.test(t) && !/^(no|not|without)\s/.test(t) ? 'affirms' : 'indeterminate'
}

/**
 * Boolean fields that restate a string answer on the same element. `both`:
 * false contradicts a string that affirms encryption, true one that negates it.
 * `true_only`: the boolean says something narrower (TLS enforced, mutual TLS),
 * so only true against a negating string contradicts.
 */
const ENCRYPTION_TWINS: ReadonlyArray<{ flag: string; field: string; direction: 'both' | 'true_only' }> = [
  { flag: 'encrypted_at_rest', field: 'encryption_at_rest', direction: 'both' },  // judged as an at-rest answer
  { flag: 'flow_tls_encrypted', field: 'encryption_in_transit', direction: 'both' },
  { flag: 'encryption_in_transit_enabled', field: 'encryption_in_transit', direction: 'both' },
  { flag: 'data_tier_transit_encrypted', field: 'encryption_in_transit', direction: 'both' },
  { flag: 'registry_pull_over_tls', field: 'encryption_in_transit', direction: 'both' },
  { flag: 'service_to_service_mtls_enforced', field: 'encryption_in_transit', direction: 'true_only' },
  { flag: 'tls_only_transport', field: 'encryption_in_transit', direction: 'true_only' },
]
const AUTH_FLAGS = ['authentication_required', 'authentication_enabled']

/** Authentication answers that say there is none. */
const AUTH_NEGATIONS = new Set(['none', 'no', 'no auth', 'no authentication', 'anonymous', 'not required', 'disabled', 'off', 'false', 'open'])

/** Does an `authentication_type` answer name authentication in place (not none, not a placeholder)? */
export function authenticationClaimed(value: unknown): boolean {
  return typeof value === 'string' && !isStandIn(value) && !isPlaceholderText(value) && !AUTH_NEGATIONS.has(normToken(value))
}

/** Pairs of fields on one element that disagree, as `flag/field` names. */
export function contradictions(values: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const { flag, field, direction } of ENCRYPTION_TWINS) {
    const b = values[flag]
    if (typeof b !== 'boolean') continue
    const claim = encryptionClaim(values[field], field === 'encryption_at_rest' ? 'rest' : 'transit')
    if ((b && claim === 'negates') || (!b && direction === 'both' && claim === 'affirms')) out.push(`${flag}/${field}`)
  }
  const at = values.authentication_type
  for (const flag of AUTH_FLAGS) {
    if (values[flag] === true && typeof at === 'string' && normToken(at) === 'none') out.push(`${flag}/authentication_type`)
  }
  return out
}

/** A list entry that names something: a non-empty string that is not a placeholder. */
export const isRealListEntry = (v: unknown): boolean => typeof v === 'string' && !isStandIn(v) && !isPlaceholderToken(v)

/** A non-empty list holding only placeholders: it records nothing. */
export function isPlaceholderList(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((v) => isStandIn(v) || isPlaceholderToken(v))
}

/** Common spellings of the canonical flags, lower-cased. */
const FLAG_ALIASES: Readonly<Record<string, string>> = {
  'pci cardholder': 'PCI cardholder', pci: 'PCI cardholder', 'pci-dss': 'PCI cardholder', 'pci dss': 'PCI cardholder', pan: 'PCI cardholder',
  phi: 'PHI', hipaa: 'PHI', 'hipaa phi': 'PHI',
  'gdpr personal': 'GDPR personal', gdpr: 'GDPR personal',
  pii: 'PII',
  'sox financial': 'SOX financial', sox: 'SOX financial',
  'ccpa personal': 'CCPA personal', ccpa: 'CCPA personal',
}

/** The canonical flag a spelling stands for, or `null`. */
export function canonicalFlag(flag: unknown): string | null {
  if (typeof flag !== 'string') return null
  if (REGULATORY_FLAG_FLOORS[flag] !== undefined) return flag
  return FLAG_ALIASES[flag.trim().toLowerCase()] ?? null
}

/** Sensitivity floor of a flag, spelled exactly or not; -1 when it is no known flag. */
export function regulatoryFlagFloor(flag: unknown): number {
  const canonical = canonicalFlag(flag)
  return canonical ? REGULATORY_FLAG_FLOORS[canonical]! : -1
}

const lower = (v: unknown): string | null => (typeof v === 'string' ? v.trim().toLowerCase() : null)

// =============================================================================
// Findings
// =============================================================================

export type LintSeverity = 'error' | 'warning' | 'info'

/**
 * Transit fields a flow class may use in place of `encryption_in_transit`.
 * Only fields that say whether the flow is encrypted: version floors, modes and
 * verification switches do not answer that.
 */
export const TRANSIT_ALIASES: readonly string[] = [
  'flow_tls_encrypted',
  'service_to_service_mtls_enforced',
  'tls_only_transport',
  'encryption_in_transit_enabled',
  'data_tier_transit_encrypted',
  'registry_pull_over_tls',
]

/** The transit aliases a flow's attributes set (not null) while its floor key `encryption_in_transit` is absent or null. */
export function transitAliasesOnly(attrs: Record<string, unknown>): string[] {
  if (attrs.encryption_in_transit !== undefined && attrs.encryption_in_transit !== null) return []
  return TRANSIT_ALIASES.filter((k) => attrs[k] !== undefined && attrs[k] !== null)
}

export interface LintFinding {
  rule: string
  severity: LintSeverity
  element?: { id: string; name?: string }
  /** For findings about a file rather than an element. */
  file?: string
  message: string
}

/** Longest id list quoted inside one finding's message. */
const MAX_QUOTED = 10

const KNOWN_KEYS = {
  component: new Set(['id', 'name', 'description', 'type', 'positionX', 'positionY', 'parentBoundary', 'classData', 'controls', 'dataItemIds', 'representedModel', 'crownJewel']),
  boundary: new Set([
    'id', 'name', 'description', 'positionX', 'positionY', 'dimensionsWidth', 'dimensionsHeight', 'dimensionsMinWidth',
    'dimensionsMinHeight', 'parentBoundary', 'classData', 'controls', 'dataItemIds', 'representedModel', 'zone', 'domains',
    'planes', 'conduits', 'boundaries', 'components',
  ]),
  flow: new Set(['id', 'name', 'description', 'source', 'target', 'sourceHandle', 'targetHandle', 'classData', 'controls', 'dataItemIds', 'attributes']),
  dataItem: new Set(['id', 'name', 'description', 'classData', 'controls', 'attributes', 'sensitivity', 'regulatory_flags', 'origin', 'is_credential']),
  structure: new Set(['defaultBoundary']),
} as const

const GEOMETRY_KEY = /^(layout|x|y|w|h|width|height|pos|position|positions|size|bounds|coords|coordinates|geometry|dimensions)$/i
const MITRE_KEY = /mitre|att&?ck|(^|_)ttps?($|_)|technique_?ids?/i
const TECHNIQUE_KEY = /technique/i
const MITRE_ID = /\bT\d{4}(\.\d{3})?\b|\bTA\d{4}\b/

const CREDENTIAL_TYPES = new Set(['service_account', 'api_key', 'oauth_token', 'ssh_key', 'certificate', 'password', 'none'])

const REMEDY = {
  observe: 'Record the observed value, or leave it null and ask the operator.',
  mitre: 'Remove the field: technique coverage comes from the platform\'s exposure analysis, not from attribute files. ' +
    'If the element\'s class declares the field, run generate_attribute_stubs so its template is cached.',
  position: 'Set positionX/positionY following the layout guidelines (placement relative to the parent boundary). ' +
    'Coordinates carry layout only; never guess them from meaning.',
  geometry: 'Positions are positionX/positionY and a boundary\'s size is dimensionsWidth/dimensionsHeight; move the values ' +
    'there following the layout guidelines, or remove the key.',
  unknownKey: 'Remove the key or move its value to the field the schema defines; ask the operator if its meaning is unclear.',
  controls: 'Move controls out of attribute files; manage them with the controls tools.',
  credentials: 'Propose the credential id the flow presents from what a source shows, and write it to required_credentials ' +
    'only after the operator confirms. Propose [] when a cited source shows the flow is unauthenticated; write it only after ' +
    'the operator confirms. Otherwise leave it null and ask.',
  monitoring: 'List only tools that are actually in place. Use [] only when a source or the operator says there is no ' +
    'monitoring; if it is not known, leave it null.',
  flag: 'Use the canonical flag, spelled exactly (the platform matches it case-sensitively), or ask the operator which regulation applies.',
  contradiction: 'Ask the operator which is right; change neither field until confirmed.',
  mixedScript: 'Retype each value in one script from what a source shows; a look-alike letter hides what the value says.',
  offSchema: 'Correct each to a value the class schema allows, from what a source shows, or leave it null and ask the operator.',
  assetSignal: 'Move it to the data item in data-items.json; the gates and the push read it only there.',
  siblings: 'Place the listed elements apart following the layout guidelines.',
}

function walkStrings(value: unknown, visit: (s: string) => boolean): boolean {
  if (typeof value === 'string') return visit(value)
  if (Array.isArray(value)) return value.some((v) => walkStrings(v, visit))
  if (value && typeof value === 'object') return Object.values(value).some((v) => walkStrings(v, visit))
  return false
}

/** Keys at any depth of `value`. */
function walkKeys(value: unknown, visit: (k: string) => void): void {
  if (Array.isArray(value)) { value.forEach((v) => walkKeys(v, visit)); return }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { visit(k); walkKeys(v, visit) }
  }
}

const quote = (ids: string[]): string =>
  ids.slice(0, MAX_QUOTED).join(', ') + (ids.length > MAX_QUOTED ? ` and ${ids.length - MAX_QUOTED} more` : '')

/** Compute every lint finding for a loaded model. Gate 3 progress findings are added by the gates. */
export function computeLints(input: GateInput): LintFinding[] {
  const out: LintFinding[] = []
  const { boundaries, components, parentMap } = flattenStructure(input.structure)
  const templates: ReadonlyMap<string, ClassTemplate> = input.classTemplates.templates
  const names = new Map<string, string>()
  for (const e of [...boundaries, ...components, ...input.dataFlows, ...input.dataItems]) if (e?.id) names.set(e.id, e.name)
  const el = (id: string) => ({ id, ...(names.get(id) ? { name: names.get(id) } : {}) })
  const add = (rule: string, severity: LintSeverity, message: string, element?: string, file?: string) =>
    out.push({ rule, severity, message, ...(element ? { element: el(element) } : {}), ...(file ? { file } : {}) })

  const classOf = new Map<string, string | undefined>()
  for (const e of [...boundaries, ...components, ...input.dataFlows, ...input.dataItems]) if (e?.id) classOf.set(e.id, e.classData?.id ?? undefined)
  const declared = (id: string): ReadonlySet<string> => new Set(templates.get(classOf.get(id) ?? '')?.fields ?? [])

  // Attribute files: MITRE fields, controls, asset signals, placeholder monitoring and credential scopes.
  for (const [group, bag] of Object.entries(input.attributes ?? {})) {
    for (const [id, entry] of Object.entries((bag ?? {}) as Record<string, ElementAttributes>)) {
      const values = (entry?.attributes ?? {}) as Record<string, unknown>
      const fields = declared(id)
      const file = `attributes/${group}/${id}.json`
      const mitreKeys = new Set<string>()
      let techniqueKey = false
      let mitreValue = false
      for (const scope of [entry as unknown as Record<string, unknown>, values]) {
        for (const [k, v] of Object.entries(scope ?? {})) {
          if (scope === (entry as unknown) && (k === 'attributes' || k === 'classData' || k === 'elementId' || k === 'elementType' || k === 'elementName')) continue
          if (fields.has(k)) continue
          const nested: string[] = [k]
          walkKeys(v, (kk) => nested.push(kk))
          for (const kk of nested) {
            if (MITRE_KEY.test(kk)) mitreKeys.add(kk)
            else if (TECHNIQUE_KEY.test(kk)) techniqueKey = true
          }
          if (walkStrings(v, (s) => MITRE_ID.test(s))) mitreValue = true
        }
      }
      if (mitreKeys.size || mitreValue) {
        add('mitre_technique_field', 'error',
          `${file} carries MITRE technique annotations${mitreKeys.size ? ` (${[...mitreKeys].join(', ')})` : ' (technique ids in values)'}. ${REMEDY.mitre}`, id, file)
      } else if (techniqueKey) {
        add('technique_key', 'warning', `${file} has a field named like a technique annotation. If it records MITRE techniques, remove it; ${REMEDY.mitre}`, id, file)
      }
      if (own(entry, 'controls') || own(values, 'controls')) add('controls_in_attributes', 'error', `${file} carries a controls key. ${REMEDY.controls}`, id, file)
      // origin and is_credential are a data item's own fields; on another element an origin is an ordinary attribute.
      for (const k of group === 'dataItems' ? ['sensitivity', 'regulatory_flags', 'origin', 'is_credential'] : ['sensitivity', 'regulatory_flags']) {
        if (own(values, k) && !fields.has(k)) add('asset_signal_in_attributes', 'warning', `${file} sets ${k} in its attributes. ${REMEDY.assetSignal}`, id, file)
      }
      const tools = values.monitoring_tools
      if (Array.isArray(tools) && tools.length > 0 && tools.every(isPlaceholderToken)) {
        add('monitoring_tools_placeholder', 'warning', `monitoring_tools holds only placeholders (${JSON.stringify(tools.slice(0, 3))}). ${REMEDY.monitoring}`, id)
      }
      const scope = values.credential_scope
      if (Array.isArray(scope) && scope.some((v) => isPlaceholderToken(v) || isStandIn(v))) {
        add('credential_placeholder', 'warning', `credential_scope holds a placeholder instead of a credential id. ${REMEDY.credentials}`, id)
      }
      const mixed = Object.keys(values).filter((k) => hasMixedScriptWord(values[k]))
      if (mixed.length) {
        add('mixed_script_value', 'warning', `Values with a word that mixes Latin letters with Cyrillic or Greek look-alikes: ${quote(mixed)}. ` +
          REMEDY.mixedScript, id, file)
      }
      const disagree = contradictions(values)
      if (disagree.length) add('contradictory_fields', 'warning', `These fields disagree: ${disagree.join('; ')}. ${REMEDY.contradiction}`, id, file)
      // Only answered values: a null stub or a placeholder is reported elsewhere, never as off-schema.
      const schema = templates.get(classOf.get(id) ?? '')?.schema ?? {}
      const offSchema = [...fields].filter((k) => {
        const v = values[k]
        return v !== null && v !== undefined && !isStandIn(v) && !isPlaceholderText(v) && !isValidForSchema(v, schema[k])
      })
      if (offSchema.length) {
        add('value_off_schema', 'warning', `Values the class schema does not allow: ${quote(offSchema)}. ${REMEDY.offSchema}`, id, file)
      }
    }
  }

  // Flows: credentials.
  const flowAttrs = (id: string): Record<string, unknown> => {
    const bag = (input.attributes?.dataFlows ?? {}) as Record<string, ElementAttributes>
    return ((bag[id]?.attributes ?? {}) as Record<string, unknown>)
  }
  const componentAttrs = (id: string): Record<string, unknown> => {
    const bag = (input.attributes?.components ?? {}) as Record<string, ElementAttributes>
    return ((bag[id]?.attributes ?? {}) as Record<string, unknown>)
  }
  const componentIds = new Set(components.map((c) => c.id))
  const holders = new Map<string, string[]>()
  const noAuthButFailureMode: string[] = []
  const authWithoutCredentials: string[] = []
  for (const f of input.dataFlows) {
    const a = flowAttrs(f.id)
    const ct = lower(a.credential_type)
    const ctSet = ct !== null && !isStandIn(a.credential_type) && (ct === 'none' || !isPlaceholderToken(ct))
    const ctNone = ct === 'none'
    const ctAuth = ctSet && !ctNone
    const cnSet = typeof a.credential_name === 'string' && !isStandIn(a.credential_name) && !isPlaceholderToken(a.credential_name)
    const rcKey = own(a, 'required_credentials') && a.required_credentials !== null && a.required_credentials !== undefined
    const rcArr = Array.isArray(a.required_credentials) ? (a.required_credentials as unknown[]) : null
    const rcReal = (rcArr ?? []).filter((v): v is string => typeof v === 'string' && !isStandIn(v) && !isPlaceholderToken(v))
    const rcPlaceholder = (rcArr ?? []).some((v) => isStandIn(v) || isPlaceholderToken(v))
    for (const cid of rcReal) holders.set(cid, [...(holders.get(cid) ?? []), f.id])

    if (ctSet && !CREDENTIAL_TYPES.has(ct!)) {
      add('credential_type_unknown', 'info', `credential_type "${String(a.credential_type).slice(0, 40)}" is not one of ${[...CREDENTIAL_TYPES].join(', ')}. ${REMEDY.observe}`, f.id)
    }
    if (rcPlaceholder) add('credential_placeholder', 'warning', `required_credentials holds a placeholder instead of a credential id. ${REMEDY.credentials}`, f.id)
    if ((ctAuth || (cnSet && !ctNone)) && !rcKey) {
      add('credential_without_required_credentials', 'warning', `The flow names a credential (credential_type or credential_name) but has no required_credentials. ${REMEDY.credentials}`, f.id)
    }
    if (ctAuth && rcArr && rcReal.length === 0 && !rcPlaceholder) {
      add('empty_credentials_on_authenticated_flow', 'warning', `credential_type is ${ct}, but required_credentials is empty. ${REMEDY.credentials}`, f.id)
    }
    if (ctNone && rcReal.length > 0) {
      add('credentials_where_authentication_none', 'warning', `credential_type is none, but required_credentials lists ${quote(rcReal)}. ${REMEDY.credentials}`, f.id)
    }
    const target = f.target?.id
    if (!ctSet && target && componentIds.has(target)) {
      const at = lower(componentAttrs(target).authentication_type)
      if (at !== null && !isStandIn(at)) {
        if (at === 'none' && rcReal.length > 0) {
          add('component_auth_mismatch', 'info', `The target's authentication_type is none, but the flow requires ${quote(rcReal)}; the flow may be a response or a pull. ${REMEDY.observe}`, f.id)
        } else if (at !== 'none' && !isPlaceholderToken(at) && rcArr && rcReal.length === 0) {
          add('component_auth_mismatch', 'info', `The target authenticates callers (${at}), but the flow records no credential; the flow may be a response or a pull. ${REMEDY.observe}`, f.id)
        }
      }
    }
    const afm = typeof a.auth_failure_mode === 'string' ? normToken(a.auth_failure_mode) : null
    // deny and fallback mean the flow authenticates; fail_open is also written for flows that do not.
    if ((afm === 'deny' || afm === 'fallback') && rcArr && rcReal.length === 0 && (!ctSet || ctNone)) {
      if (declaresNoAuthentication(a)) noAuthButFailureMode.push(f.id)
      else authWithoutCredentials.push(f.id)
    }
  }
  if (noAuthButFailureMode.length) {
    add('auth_failure_mode_without_auth', 'warning', `${noAuthButFailureMode.length} flow(s) declare no authentication (required_credentials is [] ` +
      `and no credential type) yet record auth_failure_mode deny or fallback, which means they authenticate: ${quote(noAuthButFailureMode)}. ` +
      REMEDY.contradiction, noAuthButFailureMode[0])
  }
  if (authWithoutCredentials.length) {
    add('auth_without_credentials', 'info', `${authWithoutCredentials.length} flow(s) record auth_failure_mode deny or fallback, so they ` +
      `authenticate, but no credential id: ${quote(authWithoutCredentials)}. ${REMEDY.credentials}`, authWithoutCredentials[0])
  }
  for (const [cid, flows] of holders) {
    if (flows.length > 1) add('shared_credential_id', 'info', `Credential "${cid}" is required by ${flows.length} flows (${quote(flows)}); a compromise of it opens all of them.`, flows[0])
  }

  // Data items: regulatory flags.
  for (const item of input.dataItems) {
    for (const flag of Array.isArray(item.regulatory_flags) ? item.regulatory_flags : []) {
      if (typeof flag === 'string' && REGULATORY_FLAG_FLOORS[flag] !== undefined) continue
      const canonical = canonicalFlag(flag)
      const listed = canonical !== null && (item.regulatory_flags as unknown[]).includes(canonical)
      add('non_canonical_regulatory_flag', 'warning', canonical
        ? `Regulatory flag "${String(flag).slice(0, 40)}" means "${canonical}". ` +
          (listed ? `Remove the alias; "${canonical}" is already listed.` : `Replace it with "${canonical}" (remove the alias).`)
        : `"${String(flag).slice(0, 40)}" is not a canonical regulatory flag (${Object.keys(REGULATORY_FLAG_FLOORS).join(', ')}). ${REMEDY.flag}`, item.id)
    }
  }

  // Structure: unknown keys, positions, stacked siblings.
  const unknownKeys = (id: string | undefined, obj: Record<string, unknown>, known: ReadonlySet<string>, what: string) => {
    for (const k of Object.keys(obj ?? {})) {
      if (known.has(k)) continue
      if (MITRE_KEY.test(k)) {
        add('mitre_technique_field', 'error', `${what} carries a MITRE annotation key (${k}). ${REMEDY.mitre}`, id)
        continue
      }
      add('unknown_element_key', 'warning', `${what} has a key the model schema does not define: ${k}. ${GEOMETRY_KEY.test(k) ? REMEDY.geometry : REMEDY.unknownKey}`, id)
    }
  }
  unknownKeys(undefined, input.structure as unknown as Record<string, unknown>, KNOWN_KEYS.structure, 'structure.json')
  for (const b of boundaries) unknownKeys(b.id, b as unknown as Record<string, unknown>, KNOWN_KEYS.boundary, `Boundary "${b.name ?? b.id}"`)
  for (const c of components) {
    unknownKeys(c.id, c as unknown as Record<string, unknown>, KNOWN_KEYS.component, `Component "${c.name ?? c.id}"`)
    if (!Number.isFinite(c.positionX) || !Number.isFinite(c.positionY)) {
      add('component_position_missing', 'error', `Component "${c.name ?? c.id}" has no positionX/positionY. ${REMEDY.position}`, c.id)
    }
  }
  for (const f of input.dataFlows) unknownKeys(f.id, f as unknown as Record<string, unknown>, KNOWN_KEYS.flow, `Flow "${f.name ?? f.id}"`)
  for (const i of input.dataItems) unknownKeys(i.id, i as unknown as Record<string, unknown>, KNOWN_KEYS.dataItem, `Data item "${i.name ?? i.id}"`)

  const children = new Map<string, Array<{ id: string; x: number; y: number }>>()
  const placed = (e: { id: string; positionX?: unknown; positionY?: unknown }) =>
    Number.isFinite(e.positionX) && Number.isFinite(e.positionY)
  for (const e of [...components, ...(boundaries as StructureBoundary[])]) {
    const parent = parentMap.get(e.id)
    if (!parent || !placed(e as { id: string; positionX?: unknown; positionY?: unknown })) continue
    children.set(parent, [...(children.get(parent) ?? []), { id: e.id, x: e.positionX as number, y: e.positionY as number }])
  }
  for (const [parent, kids] of children) {
    const byPoint = new Map<string, string[]>()
    for (const k of kids) byPoint.set(`${k.x},${k.y}`, [...(byPoint.get(`${k.x},${k.y}`) ?? []), k.id])
    for (const [point, ids] of byPoint) {
      if (ids.length < 2) continue
      add('siblings_share_position', 'warning',
        `${ids.length} elements inside "${names.get(parent) ?? parent}" sit at the same position (${point}): ${quote(ids)}. ${REMEDY.siblings}`, ids[0])
    }
  }
  return out
}
