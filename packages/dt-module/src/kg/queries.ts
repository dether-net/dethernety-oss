/**
 * The Cypher behind the local knowledge-graph client — one statement per named query, plus the
 * capability probe.
 *
 * These are not new queries. Each is the graph half of a statement a consumer runs today, lifted
 * out of the consumer and widened to project the contract's full field set. The *shape* moves
 * verbatim; the `RETURN` does not, because a caller reading through the interface is promised
 * every declared field and the original projections were each narrowed to one caller's needs.
 *
 * ── The disciplines these statements carry are correctness constraints, not style ────────────
 * They come from the consumers' own source comments and hold on Memgraph specifically:
 *
 *   - **Group on graph entities, never on maps.** Every `WITH` here groups on a scalar and a node
 *     (`cid, kr` / `classId, ruleId, t` / `tid, t`). A map or list used as a grouping key hashes
 *     non-deterministically on Memgraph.
 *   - **`collect(DISTINCT …)` only over scalar-only maps.** The `reads` and `derivedFrom` maps hold
 *     scalars exclusively. A `DISTINCT` over a map that itself nests a list is the hashing hazard
 *     the consumers' comments call out; there is no such collect here, and none may be added.
 *   - **Pattern comprehension, not nested `OPTIONAL MATCH` fan-out.** The
 *     `[x IN collect(…) WHERE x IS NOT NULL]` form is what turns a missing optional match into an
 *     empty list rather than a one-element list holding `null`.
 *   - **No variable-length expansion.** The deepest shape is a fixed 3-hop join. This is not an
 *     accident of the current query set — it is the premise the whole serving design rests on, and
 *     `kg-local.test.ts` asserts it over this file's text so it cannot be lost to a later edit.
 *   - **No `NOT EXISTS{}` in a projection.** Likewise asserted rather than remembered.
 *
 * ── Every parameter is bound on every call ───────────────────────────────────────────────────
 * Memgraph rejects a statement referencing a parameter the call did not supply
 * (`Parameter $kind not provided.`) — it does not treat it as null. So `$kind` is always bound,
 * `null` when the caller did not filter. Verified against Memgraph 3.8.
 */

/**
 * Rules on the given classes, optionally narrowed to one kind.
 *
 * Widens the rule map an analysis module's per-element query builds today (which projects
 * `ruleId, name, description, conditionGroups, reads`) with the seven fields the contract also
 * declares, and generalises the countermeasure variant's hard-coded `kind` into `$kind`.
 *
 * `MATCH`, not `OPTIONAL MATCH`: a class with no rules simply produces no row, and the client
 * seeds its result map from the requested keys, so "asked and matched nothing" is expressed once
 * — in TypeScript — instead of twice.
 *
 * The projected `classId` is the **requested key** (`cid`), not `kr.classId`. It has to be the
 * class the rule hangs off, because that is the half of the composite key `threatsByRuleId`
 * matches on; the rule's own `classId` property is redundant here and deliberately unread.
 */
export const KG_RULES_BY_CLASS_ID = `
UNWIND $classIds AS cid
MATCH (kc:KgClass {classId: cid})-[:KG_HAS_RULE]->(kr:KgRule)
WHERE $kind IS NULL OR kr.kind = $kind
OPTIONAL MATCH (kr)-[:KG_READS]->(a:KgAttribute)
WITH cid, kr,
     [x IN collect(DISTINCT CASE WHEN a IS NULL THEN NULL ELSE
        {name: a.name, title: a.title, description: a.description, category: a.category} END)
      WHERE x IS NOT NULL] AS reads
RETURN cid AS classId, kr.id AS id, kr.ruleId AS ruleId, kr.kind AS kind, kr.name AS name,
       kr.description AS description, kr.criticality AS criticality, kr.score AS score,
       kr.attackVector AS attackVector, kr.conditionGroups AS conditionGroups,
       kr.mitreRefs AS mitreRefs, reads
`;

/**
 * Threats addressed by the given rules, each rule named by the `(classId, ruleId)` pair.
 *
 * `$ruleRefs` is a list of maps here — the shape the existing consumer already passes — while the
 * wire carries the same pairs joined into strings. That difference is the whole point of encoding
 * at the client boundary: each transport takes the pairs in the form it can express, and both
 * return a map keyed by the joined string.
 *
 * Never fused into the rules query. A single
 * `(rule)-[:KG_ADDRESSES]->(threat)-[:KG_DERIVED_FROM]->(corpus)` mega-pattern Cartesians corpus
 * against threats; splitting it and joining in the client is what keeps the row count linear.
 *
 * Widens the consumer's corpus projection (`kind, id, title, url`) to the contract's seven fields,
 * and adds `slug`, which the contract declares non-null and no consumer selects today.
 */
export const KG_THREATS_BY_RULE_ID = `
UNWIND $ruleRefs AS ref
MATCH (kc:KgClass {classId: ref.classId})-[:KG_HAS_RULE]->(kr:KgRule {ruleId: ref.ruleId})-[:KG_ADDRESSES]->(t:KgThreat)
OPTIONAL MATCH (t)-[:KG_DERIVED_FROM]->(ce:KgCorpusEntry)
WITH ref.classId AS classId, ref.ruleId AS ruleId, t,
     [x IN collect(DISTINCT CASE WHEN ce IS NULL THEN NULL ELSE
        {id: ce.id, kind: ce.kind, title: ce.title, canonicalUrl: ce.canonicalUrl,
         synthesis: ce.synthesis, accessed: ce.accessed, resolved: ce.resolved} END)
      WHERE x IS NOT NULL] AS derivedFrom
RETURN classId, ruleId, t.id AS id, t.slug AS slug, t.name AS name, t.description AS description,
       t.attackSurface AS attackSurface, t.techniqueIds AS techniqueIds,
       t.techniqueProvenance AS techniqueProvenance, derivedFrom
`;

/**
 * Threats carrying the given ATT&CK technique ids.
 *
 * The only statement here with no ancestor in a consumer — it exists because the published query
 * registry names it. Written to the same `UNWIND $keys` shape as the other two rather than to a
 * cheaper one, because that shape *is* the contract's batch shape and consistency across the three
 * is worth more than a scan this corpus is far too small to notice.
 *
 * A threat's techniques are a bare list property (there is no edge to walk), so membership is the
 * only available test. `tid IN t.techniqueIds` is null — and therefore false — for a threat whose
 * list property is absent, which is the wanted behaviour and is asserted rather than assumed.
 */
export const KG_THREATS_BY_TECHNIQUE_ID = `
UNWIND $techniqueIds AS tid
MATCH (t:KgThreat)
WHERE tid IN t.techniqueIds
OPTIONAL MATCH (t)-[:KG_DERIVED_FROM]->(ce:KgCorpusEntry)
WITH tid, t,
     [x IN collect(DISTINCT CASE WHEN ce IS NULL THEN NULL ELSE
        {id: ce.id, kind: ce.kind, title: ce.title, canonicalUrl: ce.canonicalUrl,
         synthesis: ce.synthesis, accessed: ce.accessed, resolved: ce.resolved} END)
      WHERE x IS NOT NULL] AS derivedFrom
RETURN tid AS techniqueId, t.id AS id, t.slug AS slug, t.name AS name, t.description AS description,
       t.attackSurface AS attackSurface, t.techniqueIds AS techniqueIds,
       t.techniqueProvenance AS techniqueProvenance, derivedFrom
`;

/**
 * Is there a knowledge graph in this deployment's own graph at all.
 *
 * `RETURN k LIMIT 1`, matching the probe the existing consumer runs, and deliberately **not**
 * `count(k)`: the question is existence, and a count is a full label scan to answer it. The answer
 * is a row or no row.
 */
export const KG_PRESENCE_PROBE = `MATCH (k:KgClass) RETURN k LIMIT 1`;

/** Every statement above, for the tests that assert the disciplines over the text itself. */
export const KG_ALL_QUERIES = [
  KG_RULES_BY_CLASS_ID,
  KG_THREATS_BY_RULE_ID,
  KG_THREATS_BY_TECHNIQUE_ID,
  KG_PRESENCE_PROBE,
];
