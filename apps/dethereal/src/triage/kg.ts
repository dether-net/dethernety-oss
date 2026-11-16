/**
 * Reading the platform's knowledge graph: whether it can be used here, and one class's rules with the threats they
 * address.
 *
 * The chain read is anchored on `kgRules(where: { classId })`, not on the knowledge graph's class nodes: those expose
 * no class id, and `KgRule.classId` carries the runtime `Class.id` that an element's class binding holds. A rule is
 * matched to an exposure by name (`Exposure.name == KgRule.name`).
 *
 * `conditionGroups`, `mitreRefs` and `techniqueProvenance` arrive as JSON-encoded strings. Condition groups are parsed
 * by the shared evaluator's parser, so a chain's group indexes are the ones an evaluation reports; the other two are
 * parsed tolerantly, carrying an unparseable value verbatim under `_raw`.
 */
import { CombinedGraphQLErrors, ServerError, gql } from '@apollo/client'
import { parseConditionGroups, type PredicateGroup } from '@dethernety/dt-module/condition-groups'
import { redactSecrets } from '../auth/redact.js'
import { KG_ABSENT_MARKER, KG_NO_DATA_NOTICE, KG_NOT_AVAILABLE_NOTICE } from './notices.js'

/**
 * One class's rules, each with the attributes it reads and the threats it addresses, and each threat's sources.
 *
 * Selects only fields that both kinds of knowledge-graph module declare: a deployment whose graph is served remotely
 * declares a narrower surface, and a field it lacks fails the whole document at validation on that deployment only.
 */
export const KG_CHAIN = gql`
  query KgChain($classId: String!) {
    kgRules(where: { classId: { eq: $classId } }) {
      id
      ruleId
      name
      kind
      criticality
      score
      attackVector
      conditionGroups
      mitreRefs
      reads {
        name
        title
        category
      }
      addresses {
        id
        slug
        name
        description
        attackSurface
        techniqueIds
        techniqueProvenance
        derivedFrom {
          id
          kind
          title
          canonicalUrl
          synthesis
          accessed
          resolved
        }
      }
    }
  }
`

/**
 * Whether the knowledge graph has data and whether this caller may read it.
 *
 * It asks a field rather than sampling a row, because both kinds of knowledge-graph module answer this field, and
 * only a field can tell a graph this caller may not read from one that is empty. A platform with no knowledge-graph
 * module has no such field, and refuses the document at validation.
 */
export const KG_CAPABILITY = gql`
  query KgCapability {
    kgCapability {
      available
      entitled
    }
  }
`

// =============================================================================
// Raw response shapes
// =============================================================================

export interface RawKgCorpusEntry {
  id: string
  kind: string | null
  title: string | null
  canonicalUrl: string | null
  synthesis: string | null
  accessed: string | null
  resolved: boolean | null
}

export interface RawKgThreat {
  id: string
  slug: string
  name: string | null
  description: string | null
  attackSurface: string | null
  techniqueIds: string[] | null
  techniqueProvenance: string | null
  derivedFrom: RawKgCorpusEntry[]
}

export interface RawKgRule {
  id: string
  ruleId: string
  name: string
  kind: string | null
  criticality: string | null
  score: number | null
  attackVector: string | null
  conditionGroups: string | null
  mitreRefs: string | null
  reads: Array<{ name: string; title: string | null; category: string | null }>
  addresses: RawKgThreat[]
}

export interface KgCapability {
  available: boolean
  entitled: boolean
}

// =============================================================================
// Probe results
// =============================================================================

export type KgAbsentReason = 'module_not_loaded' | 'not_entitled' | 'no_data'

export type KgProbeResult =
  | { regime: 'kg_present' }
  | { regime: 'kg_absent'; reason: KgAbsentReason; notice: string; marker: string }

/** Absence, with the notice the operator is shown for it and the marker that labels proposals made without the graph. */
export function kgAbsent(reason: KgAbsentReason): KgProbeResult {
  return {
    regime: 'kg_absent',
    reason,
    notice: reason === 'no_data' ? KG_NO_DATA_NOTICE : KG_NOT_AVAILABLE_NOTICE,
    marker: KG_ABSENT_MARKER,
  }
}

/**
 * The capability answer as a regime: `available: false` is no data; a graph that has data but that this caller may
 * not read is not entitled, which is neither. A missing answer is neither a yes nor a no: the state is unknown, which
 * is not absence, so it folds to null, which the probe reports as its failure.
 */
export function foldCapability(cap: KgCapability | null | undefined): KgProbeResult | null {
  if (!cap || typeof cap.available !== 'boolean' || typeof cap.entitled !== 'boolean') return null
  if (!cap.available) return kgAbsent('no_data')
  if (!cap.entitled) return kgAbsent('not_entitled')
  return { regime: 'kg_present' }
}

// =============================================================================
// Errors
// =============================================================================

type GraphQLErrorLike = { message?: unknown; extensions?: { code?: unknown } }

/**
 * The GraphQL errors a thrown query carries, in either shape the client raises.
 *
 * A GraphQL response with `errors`, whatever its status, arrives as `CombinedGraphQLErrors`; the platform answers a
 * validation failure that way. A non-2xx response in another media type (a proxy or gateway answering JSON or HTML)
 * arrives as `ServerError` with only its body text, so the errors are parsed back out of it. That parse is guarded:
 * an HTML error page must classify as "no GraphQL errors", never throw.
 */
function kgErrorsOf(error: unknown): readonly GraphQLErrorLike[] {
  if (CombinedGraphQLErrors.is(error)) return error.errors
  if (ServerError.is(error)) {
    try {
      const body = JSON.parse(error.bodyText) as { errors?: unknown }
      return Array.isArray(body?.errors) ? (body.errors as GraphQLErrorLike[]) : []
    } catch {
      return []
    }
  }
  return []
}

/** The first GraphQL error code a thrown query carries, if any. */
export function graphQLErrorCode(error: unknown): string | undefined {
  return kgErrorsOf(error).find((e) => typeof e?.extensions?.code === 'string')?.extensions?.code as string | undefined
}

/**
 * Whether the platform refused the document at validation: it has no knowledge-graph field, so no module is loaded.
 * This is how a missing module is detected, not a failure taken for absence: only a schema without the field refuses
 * a valid document at validation.
 */
export function isValidationFailure(error: unknown): boolean {
  return kgErrorsOf(error).some((e) => e?.extensions?.code === 'GRAPHQL_VALIDATION_FAILED')
}

/** What a platform read refused for the session says: the login tool is the way back. */
export const LOGIN_SENTENCE = 'the platform refused this session. Call the "login" tool, then retry.'

/**
 * A failed knowledge-graph read as a sentence that says what happened and what to do, with every session secret
 * redacted.
 *
 * A production platform masks error messages and keeps only `extensions.code`, so the code is what tells a module
 * fault on the platform from a refused session. The log fragment names no module, because the two kinds of
 * knowledge-graph module log under different names.
 */
export function describeKgFailure(error: unknown, surface: 'probe' | 'chain'): string {
  const field = surface === 'probe' ? 'Query.kgCapability' : 'Query.kgRules'
  const what = surface === 'probe' ? 'capability query' : 'chain query'
  const failed = surface === 'probe' ? 'the KG capability probe failed' : 'the KG chain read failed'
  const code = graphQLErrorCode(error)
  const message = error instanceof Error ? error.message : String(error)
  let sentence: string
  switch (code) {
    case 'MODULE_RESOLVER_ERROR':
    case 'MODULE_RESOLVER_TIMEOUT':
      sentence = `the platform's knowledge-graph module failed its ${what} (${code}). The cause is in the platform log as "Module resolver <module>:${field} failed"; the KG evidence tier is unavailable for this run.`
      break
    case 'UNAUTHENTICATED':
      sentence = LOGIN_SENTENCE
      break
    default:
      sentence = code ? `${failed}: ${message} (${code})` : `${failed}: ${message}`
  }
  return redactSecrets(sentence)
}

// =============================================================================
// The chain
// =============================================================================

/**
 * A JSON-encoded array field: absent → `[]` (nothing authored); an array → the array; anything else, malformed JSON
 * or a value that is not an array, → `{_raw}` with the original string. Never throws.
 */
export function parseJsonArrayTolerant(value: string | null | undefined): unknown[] | { _raw: string } {
  if (value == null) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : { _raw: value }
  } catch {
    return { _raw: value }
  }
}

/**
 * Whether a stored `conditionGroups` is something other than a JSON array of arrays. The parser then keeps what it
 * can (or nothing), so a rule shown with fewer groups than were stored is marked. An absent value is not malformed:
 * nothing was stored.
 */
export function conditionGroupsMalformed(raw: string | null | undefined): boolean {
  if (raw == null) return false
  try {
    const parsed: unknown = JSON.parse(raw)
    return !Array.isArray(parsed) || !parsed.every(Array.isArray)
  } catch {
    return true
  }
}

export interface KgChainRule {
  ruleId: string
  name: string
  kind: string | null
  conditionGroups: PredicateGroup[]
  malformed?: true
  readAttributes: Array<{ name: string; title: string | null; category: string | null }>
}

export interface KgChainThreat {
  slug: string
  name: string | null
  description: string | null
  attackSurface: string | null
  techniqueIds: string[]
  techniqueProvenance: unknown[] | { _raw: string } | null
}

export type KgChainCorpusEntry = RawKgCorpusEntry

export type KgChain =
  | { covered: false; classId: string }
  | {
      covered: true
      classId: string
      rules: KgChainRule[]
      // The threats, their sources and the rules' MITRE references are authored prose. They are for the operator's
      // display and the cross-examination, not for analyst dossiers.
      threats: KgChainThreat[]
      corpus: KgChainCorpusEntry[]
      ruleMitreRefs: Array<{ ruleId: string; refs: unknown[] | { _raw: string } }>
    }

/**
 * A class's chain from its rules. No rules → `covered: false`. Coverage is decided before the `ruleName` filter: a
 * name that matches no rule of a covered class leaves `covered: true` with empty lists. Threats are listed once
 * across rules (by node id), sources once across threats.
 */
export function buildKgChain(rules: RawKgRule[], classId: string, ruleName?: string): KgChain {
  if (rules.length === 0) return { covered: false, classId }
  const filtered = ruleName === undefined ? rules : rules.filter((r) => r.name === ruleName)

  const threats = new Map<string, RawKgThreat>()
  for (const rule of filtered) {
    for (const threat of rule.addresses ?? []) if (!threats.has(threat.id)) threats.set(threat.id, threat)
  }
  const corpus = new Map<string, RawKgCorpusEntry>()
  for (const threat of threats.values()) {
    for (const entry of threat.derivedFrom ?? []) if (!corpus.has(entry.id)) corpus.set(entry.id, entry)
  }

  return {
    covered: true,
    classId,
    rules: filtered.map((r) => ({
      ruleId: r.ruleId,
      name: r.name,
      kind: r.kind,
      conditionGroups: parseConditionGroups(r.conditionGroups),
      ...(conditionGroupsMalformed(r.conditionGroups) ? { malformed: true as const } : {}),
      readAttributes: (r.reads ?? []).map((a) => ({ name: a.name, title: a.title, category: a.category })),
    })),
    threats: [...threats.values()].map((t) => ({
      slug: t.slug,
      name: t.name,
      description: t.description,
      attackSurface: t.attackSurface,
      techniqueIds: t.techniqueIds ?? [],
      techniqueProvenance: t.techniqueProvenance == null ? null : parseJsonArrayTolerant(t.techniqueProvenance),
    })),
    corpus: [...corpus.values()].map((c) => ({
      id: c.id,
      kind: c.kind,
      title: c.title,
      canonicalUrl: c.canonicalUrl,
      synthesis: c.synthesis,
      accessed: c.accessed,
      resolved: c.resolved,
    })),
    ruleMitreRefs: filtered.map((r) => ({ ruleId: r.ruleId, refs: parseJsonArrayTolerant(r.mitreRefs) })),
  }
}

/**
 * The framing every evaluation is shown with: the condition comes from the knowledge graph loaded now, while the
 * exposure was created by the platform's policy at an earlier time.
 */
export const EVALUATE_FRAMING =
  "This rule's recorded condition, evaluated against the supplied attribute values as of the run — a counterfactual statement, never \"the platform fired because\"."
