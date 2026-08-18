/**
 * The knowledge-graph access contract — a closed set of named, keyed queries.
 *
 * A knowledge graph can be reached two ways: from nodes ingested into the deployment's own
 * graph, or from a service that answers queries over content the deployment never holds.
 * `KgClient` is the single surface a consumer touches, so which of the two is in use is
 * deployment configuration rather than something every caller re-implements. The
 * implementations live behind a factory; nothing above this interface knows which it has.
 *
 * The query set is not designed — it is read off the callers. Every query is keyed by
 * identifiers the caller already holds, and there is no enumeration: no "list all rules", no
 * unbounded traversal, no query that returns everything.
 */

/**
 * A rule is either an exposure (a condition that constitutes a weakness) or a countermeasure
 * (one that mitigates). The two are authored as one closed set, so this is a union rather than
 * a free string.
 */
export type KgRuleKind = 'exposure' | 'countermeasure';

/** An attribute a rule reads to decide whether it fires. */
export interface KgAttribute {
  name: string;
  title: string | null;
  description: string | null;
  category: string | null;
}

/** A cited source a threat was derived from. */
export interface KgCorpusEntry {
  id: string;
  /**
   * The source family — a standards body, an advisory database, a bare URL. Deliberately
   * `string` and not a union: the producer's set grows, and narrowing it here would turn a
   * producer-side addition into a breaking change for every client.
   */
  kind: string | null;
  title: string | null;
  canonicalUrl: string | null;
  synthesis: string | null;
  accessed: string | null;
  resolved: boolean | null;
}

/** A threat a rule addresses. */
export interface KgThreat {
  id: string;
  slug: string;
  name: string | null;
  description: string | null;
  attackSurface: string | null;
  techniqueIds: string[] | null;
  /** JSON text, passed through unparsed — see the note on `KgRule.conditionGroups`. */
  techniqueProvenance: string | null;
  derivedFrom: KgCorpusEntry[];
}

/** A knowledge-graph rule, with the attributes it reads. */
export interface KgRule {
  id: string;
  ruleId: string;
  /**
   * The class this rule hangs off. No consumer selects it — they already know which class they
   * asked about — but the contract needs it: `threatsByRuleId` is composite-keyed, and the only
   * place the pair can be assembled is off the rule itself. Do not drop it as unused.
   */
  classId: string;
  name: string | null;
  kind: KgRuleKind | null;
  description: string | null;
  criticality: string | null;
  score: number | null;
  attackVector: string | null;
  /**
   * JSON text, stored and returned exactly as the graph holds it. The caller parses. This is a
   * property of the contract, not an oversight: parsing on the caller's behalf would make the
   * two implementations able to disagree about the shape, which is the one thing this interface
   * exists to prevent.
   */
  conditionGroups: string | null;
  /** JSON text, passed through unparsed — as `conditionGroups`. */
  mitreRefs: string | null;
  reads: KgAttribute[];
}

/**
 * Whether a knowledge graph can be reached, and whether this caller may query it.
 *
 * The two flags are independent and the difference is load-bearing: "there is no knowledge
 * graph here" and "there is one and you may not query it" are different answers, and a consumer
 * that collapses them reports a subscription problem as missing data, or the reverse.
 */
export interface KgCapability {
  /** Is a knowledge graph reachable at all. */
  available: boolean;
  /**
   * May this caller query it. Always `true` where the graph is local — there is no entitlement
   * gate on a graph the deployment already holds.
   */
  entitled: boolean;
  /** Entitled slices. Zero where the graph is local, which is not a statement about access. */
  sliceCount: number;
}

/** A rule addressed by the pair that identifies it. `ruleId` is unique only within a class. */
export interface KgRuleRef {
  classId: string;
  ruleId: string;
}

/**
 * The separator joining the components of a composite key.
 *
 * A key that names more than one component is carried as one string, its parts joined by the
 * ASCII unit separator — a character that cannot occur in an identifier, so the join is
 * unambiguous and needs no escaping. Exported rather than inlined because the producer, both
 * implementations and the service all have to agree on it, and four copies of a control
 * character in four files is how they stop agreeing.
 */
export const KG_KEY_SEPARATOR = '\u001F';

/**
 * The knowledge-graph client. One method per named query, plus capability.
 *
 * **Every requested key is present in the returned map**; a key that matched nothing carries an
 * empty array. A caller can therefore treat a missing key as a bug rather than as an answer,
 * and "no matches" never has to be inferred.
 *
 * The trailing `token` carries the caller's bearer, because entitlement is a statement about the
 * caller and the client is constructed once at startup while callers arrive per request. A local
 * implementation ignores it. **A call that needs a token and has none resolves to the explicit
 * locked outcome — never to an empty result**, which would be indistinguishable from a real
 * absence of matches.
 */
export interface KgClient {
  capability(token?: string): Promise<KgCapability>;

  rulesByClassId(
    classIds: string[],
    opts?: { kind?: KgRuleKind },
    token?: string,
  ): Promise<Map<string, KgRule[]>>;

  /**
   * Threats addressed by the given rules.
   *
   * Takes refs for the caller's convenience; the map is keyed by the joined composite string, so
   * a caller reading a result builds its lookup key with {@link KG_KEY_SEPARATOR} — or, more
   * usually, iterates the map rather than indexing it.
   */
  threatsByRuleId(refs: KgRuleRef[], token?: string): Promise<Map<string, KgThreat[]>>;

  threatsByTechniqueId(techniqueIds: string[], token?: string): Promise<Map<string, KgThreat[]>>;
}
