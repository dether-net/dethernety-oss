# ADR-008: Embedding-based MITRE technique matching

**Status:** Accepted
**Date:** 2026-05-20

## Context

Users authoring exposures and countermeasures need to attach MITRE references — ATT&CK techniques to exposures, D3FEND techniques and ATT&CK mitigations to countermeasures. The MITRE corpora are large (ATT&CK technique catalogue is ~1,100 base + sub-techniques and growing) and users rarely know the exact id. They type fragments ("credential dumping", "T1003", "mfa"), partial names, or whole problem descriptions.

A pure substring search misses semantic matches (a description that never contains the technique's exact words); a pure vector search is overkill for the common cases (someone pasting a known id) and fails closed if embeddings aren't available in a given deployment. The platform also runs on two databases (Neo4j and Memgraph) and supports deployments with no embedding backend at all, so the matcher cannot *require* vector search.

## Decision

Add a `matchMitreTechniques` query backed by a **five-tier cascade** that short-circuits at the first tier to return candidates, over three corpora selected by a `kind` argument (`ATTACK_TECHNIQUE` / `DEFEND_TECHNIQUE` / `ATTACK_MITIGATION`):

1. **EXACT_ID** — the query normalises to an exact MITRE id.
2. **PREFIX_ID** — the query is an id prefix (e.g. `T1003` matching its sub-techniques).
3. **NAME_MATCH** — case-insensitive substring of the technique name (gated at ≥ 3 chars).
4. **DESCRIPTION_MATCH** — case-insensitive substring of the description (gated at ≥ 3 chars).
5. **VECTOR_SIMILARITY** — semantic nearest-neighbour search over embeddings.

Tiers 1–4 are deterministic and need no embedding backend. Tier 5 is the semantic fallback, used only when the deterministic tiers find nothing.

**Vector tier on Memgraph HNSW.** Each corpus gets an HNSW vector index (`CREATE VECTOR INDEX … WITH CONFIG {metric:"cos", m:16, ef_construction:200, dimension, capacity}`), queried with `CALL vector_search.search(index, searchLimit, $query_vector) YIELD node, similarity WHERE similarity >= $threshold`. The query text is embedded at request time and matched against pre-computed corpus embeddings. We oversample (`searchLimit = max(topN × 10, 50)`) so the post-search threshold filter doesn't starve `topN`. Indexes are created lazily and idempotently, alongside auxiliary label-property indexes for the deterministic seeks.

**Graceful degradation, not failure.** The vector tier is gated by a per-corpus precheck that resolves a `vectorDisabledReason` ∈ `{EMBEDDING_DISABLED, NO_INDEX_MODULE, NO_VECTORS, MODEL_MISMATCH}` and surfaces it on the response envelope (`vectorAvailable`, `vectorDisabledReason`). When the vector tier is unavailable — Neo4j (no `vector_search` module), no embedding backend configured, an un-embedded corpus, or a model mismatch — the deterministic tiers still serve results. The picker degrades to id/name/description matching rather than erroring.

**Swappable embedding model with coherence enforcement.** The embedding model is configurable. The precheck requires every corpus node to carry the same `embeddingModel`, and that it equals the runtime model — otherwise the tier degrades with `MODEL_MISMATCH` rather than scoring vectors from two different models against each other. A dimension cross-check on the existing index guards the same hazard at index level. Corpus embeddings are produced by a build-time pipeline (kept byte-stable across builds), not at query time.

**Resilience and privacy.** Vector availability is cached (10-minute TTL) and the corpus is cached (5-minute TTL) so the picker can fire per-keystroke without per-request probing. Raw query text is never logged — the picker fires on every keystroke and may contain pasted secrets, so only shape (length, kind) reaches the logs on an embedding error.

## Consequences

**Positive:**
- Common cases (known id, id prefix, obvious name) resolve instantly with no embedding cost; semantic search is the fallback, not the default.
- The matcher works on any supported database and in deployments with no embedding backend — it never hard-fails on a missing vector tier.
- Swapping the embedding model is a configuration change; the coherence precheck prevents silently mixing models.
- The same cascade serves all three MITRE corpora through one query shape.

**Negative:**
- The vector tier's quality depends on the build-time embedding pipeline and on corpus/runtime model coherence — an operator who changes the model without re-embedding gets `MODEL_MISMATCH` (degraded, but a real operational step).
- HNSW index capacity is a pre-allocated hint per corpus; growth past it triggers a resize, so the capacities carry headroom and need occasional review as the MITRE catalogues grow.
- Five tiers plus the precheck and caching add moving parts to one query path. The short-circuit semantics and the explicit `vectorDisabledReason` envelope keep the behaviour observable.

- **Suggestion provenance is not persisted.** The picker dropdown marks vector-tier candidates ("· Suggested" + a confidence meter), but once a technique is committed it is stored as a plain MITRE reference by id — identical to a hand-typed exact-ID pick. We deliberately do **not** carry an "AI-suggested" marker onto committed chips: the picker's bound value is a list of ids, so an in-session-only marker would be misleading (it would vanish on reload and would never mark suggestions from earlier sessions), and persisting it properly would require a provenance flag on the finding→technique edge plus a semantics decision (does "suggested" still hold after a human reviews and keeps it?). That edge-level provenance is deferred until there's a concrete reviewer need; the matcher remains a discovery aid, and the committed model is the user's own assertion.

**Operational note (degradation recovery).** A `MODEL_MISMATCH` (index/runtime dimension mismatch) disables embeddings **process-wide for the lifetime of the process** — the deterministic tiers keep serving, but the vector tier stays off until the backend restarts. Recovery: drop the mismatched vector index and restart, or set `EMBEDDING_DIMENSIONS` to match the existing index's dimension. There is no runtime re-enable; the disable is intentionally sticky so a misconfigured deployment fails closed rather than flapping.

## References

- [ADR-001: Graph-native data model (Bolt/Cypher)](001-graph-native-data-model.md)
- [ADR-002: GraphQL API layer](002-graphql-api-layer.md)
- [Backend GraphQL API reference](../backend/GRAPHQL_API_REFERENCE.md) — the `matchMitreTechniques` query
- [Working with Security Controls](../../user/WORKING_WITH_SECURITY_CONTROLS.md) — the picker workflow
