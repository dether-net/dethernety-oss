/**
 * The GraphQL surface a knowledge-graph-serving deployment exposes when the graph is remote.
 *
 * A locally-installed knowledge-graph module contributes browsable node types, and the platform's
 * schema generator turns those into queries, filters and relationship traversals automatically.
 * None of that machinery applies here: there are no local nodes to browse. So this fragment
 * declares plain types with custom resolvers, and declares **only what a named query can answer**.
 *
 * ── Why the field list is shorter than the local one ─────────────────────────────────────────
 * The local schema declares several fields that the access contract does not carry:
 * `KgThreat.classId` and `KgThreat.tactic`; `KgAttribute.id`, `.type`, `.criticality`,
 * `.categoryHint` and `.enumValues`; `KgRule.irVersion`. They are absent here because nothing
 * would fill them.
 *
 * That is a deliberate asymmetry, and the direction matters. A consumer selecting an absent field
 * fails at query validation — immediately, with the field named. A consumer selecting a *declared*
 * field with nothing behind it receives a null, which is indistinguishable from a real absence and
 * reaches whoever reads the output as missing information rather than as an error. Where the two
 * modes cannot match, failing loudly is the only honest option.
 *
 * `KgThreat.classId` is worth naming separately, because it is the one that could be filled: the
 * threats under a rule are reached through a key that contains the class. It stays out anyway. The
 * contract chose not to carry it, and widening the surface because a value happens to be in scope
 * is how a specification stops describing what was built.
 *
 * ── Nullability is copied, not re-derived ────────────────────────────────────────────────────
 * Every field below matches the local schema's own nullability. `KgRule.name` is nullable there,
 * so it is nullable here — a non-null would let one unnamed rule void an entire answer through
 * `[KgRule!]!`. `KgThreat.slug` is non-null there and non-null here, which is why the client's
 * payload type treats it as required rather than optional.
 */

/**
 * `kgCapability` — declared once, used by two modules.
 *
 * A consumer asks this to find out whether a knowledge graph is reachable and whether it may query
 * it, and the whole point is that the question validates in either mode. Two hand-maintained
 * copies of one type in two repositories is how that stops being true, so there is one copy and
 * both modules include it.
 *
 * The two flags are independent on purpose. "There is no knowledge graph here" and "there is one
 * and you may not query it" are different answers to a consumer, and a surface that collapsed them
 * would report an access problem as missing data, or the reverse.
 */
export const KG_CAPABILITY_SDL = `
"""Whether a knowledge graph is reachable, and whether this caller may query it."""
type KgCapability {
  """Is a knowledge graph reachable at all."""
  available: Boolean!
  """May this caller query it. Always true where the graph is local."""
  entitled: Boolean!
  """Reachable slices. Zero where the graph is local, which is not a statement about access."""
  sliceCount: Int!
}

extend type Query {
  """Whether a knowledge graph is reachable here, and whether this caller may query it."""
  kgCapability: KgCapability!
}
`;

/**
 * The remote module's whole fragment.
 *
 * `where` keeps both filters optional, matching the shape a locally-generated schema produces, so
 * a document valid against one is valid against the other. A call naming no class is refused by
 * the resolver rather than declared away, because there is no named query behind it and an empty
 * list would be a silent wrong answer.
 */
export const KG_REMOTE_SDL = `
"""A rule-input or contextual-evidence attribute a rule reads to decide whether it fires."""
type KgAttribute {
  name: String!
  title: String
  description: String
  category: String
}

"""A cited source a threat was derived from — a standard, an advisory, a URL."""
type KgCorpusEntry {
  id: ID!
  kind: String
  title: String
  canonicalUrl: String
  synthesis: String
  accessed: String
  resolved: Boolean
}

"""A threat a rule addresses. \`techniqueProvenance\` is JSON-encoded; callers parse it."""
type KgThreat {
  id: ID!
  slug: String!
  name: String
  description: String
  attackSurface: String
  techniqueIds: [String!]
  techniqueProvenance: String
  derivedFrom: [KgCorpusEntry!]!
}

"""A policy rule. \`conditionGroups\` and \`mitreRefs\` are JSON-encoded; callers parse them."""
type KgRule {
  id: ID!
  ruleId: String!
  classId: String!
  kind: String
  name: String
  description: String
  criticality: String
  score: Float
  attackVector: String
  conditionGroups: String
  mitreRefs: String
  reads: [KgAttribute!]!
  addresses: [KgThreat!]!
}

input StringEq { eq: String! }

"""Rule filters. \`classId\` is required in practice — a call without one is refused rather than
answered empty, because no named query resolves rules by rule id alone."""
input KgRuleWhere {
  classId: StringEq
  ruleId: StringEq
}

extend type Query {
  """Knowledge-graph rules addressing a class."""
  kgRules(where: KgRuleWhere): [KgRule!]!
  """Similarity search over KG corpus entries (standards). JSON-encoded ranked list."""
  matchKgStandards(query: String!, k: Int = 10): String
  """Similarity search over KG threats. JSON-encoded ranked list."""
  matchKgThreats(query: String!, k: Int = 10): String
}
${KG_CAPABILITY_SDL}`;
