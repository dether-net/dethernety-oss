# Backend Services -- Sprint Plan

> Implementation plan for the backend services defined in [Custom Resolver Services Architecture](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md) and [Custom Resolver Services Spec](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_SPEC.md). Five sprints, ordered by dependency graph. Sprints 1-2 can run in parallel.

## Dependency Graph

```
Sprint 1 (A1) ──→ Sprint 3 (A2)
      │
      └──────────→ Sprint 4 (C)
                        ↑
Sprint 2 (B) ──────────┘

Sprint 5 (MCP + Studio integration) depends on all above
```

---

## Sprint 1 — match_classes (deterministic)

**Phase:** A1
**Parallel with:** Sprint 2

### User Stories

**S1.1 — Schema and resolver for match_classes**

As a platform developer, I want a `matchClasses` GraphQL query that accepts a list of elements and returns ranked class candidates, so that both the MCP plugin and the web UI can classify elements in a single call.

- Add `MatchClassesInput`, `MatchClassesResult`, `ClassLabelEnum`, `MatchClassFieldEnum`, `MatchType`, `ConfidenceLevel`, `ElementMatch`, `ClassCandidate` types to `schema.graphql`
- Create `MatchClassesResolverService` following the `TemplateResolverService` pattern
- Register in `custom-resolver.module.ts` `resolverServiceClasses` array
- Implement priorities 1 (exact name), 2 (substring), 4 (type-filtered heuristic)
- Inject `@Inject('NEO4J_DRIVER')`, `AuthorizationService`, `MonitoringService`
- Add `ALLOWED_CLASS_LABELS` whitelist validation before Cypher interpolation

**Documentation:**
- [BACKEND_SERVICES_SPEC.md §3](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_SPEC.md#3-service-1-match_classes) — GraphQL API, input validation, match priority implementation, label mapping
- [BACKEND_SERVICES_ARCHITECTURE.md §4.1](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#41-match_classes----class-recommendation-engine) — Priority pipeline, design decisions
- [BACKEND_SERVICES_ARCHITECTURE.md §8](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#8-security-architecture) — Auth pattern, Cypher injection prevention
- [TemplateResolverService LLD](../backend/LLD/TEMPLATE_RESOLVER.md) — Reference implementation
- [ModuleManagementService LLD](../backend/LLD/MODULE_MANAGEMENT_SERVICE.md) — `ALLOWED_CLASS_LABELS` whitelist pattern

**Files:**
- `dt-ws/schema/schema.graphql` (modify)
- `dt-ws/src/gql/resolver-services/match-classes-resolver.service.ts` (new)
- `dt-ws/src/gql/custom-resolver.module.ts` (modify)

---

**S1.2 — dt-core wrapper for matchClasses**

As a dt-core consumer, I want a `DtClass.matchClasses()` method that wraps the GraphQL query, so that the MCP plugin can call it without building GraphQL queries directly.

- Add `matchClasses()` method to `DtClass`
- Add `MATCH_CLASSES` query to `dt-class-gql.ts`
- Follow the `DtIssue.findIssues()` pattern (Apollo Client, condition builder)

**Documentation:**
- [BACKEND_SERVICES_ARCHITECTURE.md §7](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#7-integration-architecture) — dt-core integration table
- [BACKEND_SERVICES_SPEC.md §3](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_SPEC.md#3-service-1-match_classes) — GraphQL query shape
- `dt-core/src/dt-issue/dt-issue.ts` lines 83-150 — Pattern reference

**Files:**
- `dt-core/src/dt-class/dt-class.ts` (modify)
- `dt-core/src/dt-class/dt-class-gql.ts` (modify)

---

### Definition of Done

- [ ] `matchClasses` query returns results in GraphQL playground at `localhost:3003/graphql`
- [ ] Exact name match (Priority 1): "PostgreSQL Database" matches `ComponentClass` named "PostgreSQL Database" with `confidence: high`
- [ ] Substring match (Priority 2): "Postgres" matches "PostgreSQL Database" with `confidence: high`
- [ ] Type filter: `classLabel: COMPONENT, componentType: STORE` returns only STORE-typed classes
- [ ] Module filter: `moduleIds: ["mod-1"]` restricts to that module's classes
- [ ] `fields` parameter returns `description`, `category`, `type` when requested
- [ ] `unmatched[]` contains element names that didn't match at any priority
- [ ] Auth: `extractAuthContext` + `checkAuthorization` called on every request
- [ ] Monitoring: `recordOperation` called with duration and success/failure
- [ ] `classLabelToNodeLabel()` validates against `ALLOWED_CLASS_LABELS` before Cypher interpolation
- [ ] `DtClass.matchClasses()` works from dt-core (Apollo Client round-trip)
- [ ] Input validation: elements array > 100 returns error

### Verification

```
Test via GraphQL playground (localhost:3003/graphql, no auth):

1. Exact match:
   matchClasses(input: {
     elements: [{name: "PostgreSQL Database", type: STORE}],
     classLabel: COMPONENT, topN: 3
   })
   → expect: candidates with matchType: exact_name, confidence: high

2. Fuzzy match:
   matchClasses(input: {
     elements: [{name: "Postgres"}],
     classLabel: COMPONENT, topN: 3
   })
   → expect: "PostgreSQL Database" in candidates with matchType: fuzzy_name

3. No match:
   matchClasses(input: {
     elements: [{name: "xyzzy_nonexistent"}],
     classLabel: COMPONENT, topN: 3
   })
   → expect: "xyzzy_nonexistent" in unmatched[]

4. Performance: 15 elements, all installed classes → < 100ms (check resolver timing in logs)
```

**Unit tests:** `match-classes-resolver.service.spec.ts` — see [BACKEND_SERVICES_SPEC.md §9](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_SPEC.md#9-testing-strategy) for key cases.

---

## Sprint 2 — findControls + assignControlToElements

**Phase:** B
**Parallel with:** Sprint 1

### User Stories

**S2.1 — controlIdsByElements helper query**

As a backend developer, I need a fast Cypher-based lookup from element IDs to control IDs, so that `findControls` can filter by element without hitting the 5+ second polymorphic interface query.

- Add `controlIdsByElements(elementIds: [ID!]!): [ID!]!` query to `schema.graphql`
- Implement resolver in `ControlGapsResolverService` (create file now, gap analysis added in Sprint 4)
- Direct Cypher: `MATCH (ctrl:Control)-[:SUPPORTS]->(elem) WHERE elem.id IN $element_ids RETURN DISTINCT ctrl.id`
- Register in `custom-resolver.module.ts`

**Documentation:**
- [BACKEND_SERVICES_SPEC.md §5](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_SPEC.md#5-service-3-findcontrols-dt-core) — Helper query, condition builder path 1
- [BACKEND_SERVICES_ARCHITECTURE.md §4.3](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#43-findcontrols----flexible-control-query-dt-core) — Dual path rationale, resolver location

**Files:**
- `dt-ws/schema/schema.graphql` (modify)
- `dt-ws/src/gql/resolver-services/control-gaps-resolver.service.ts` (new — stub for Sprint 4, `controlIdsByElements` now)
- `dt-ws/src/gql/custom-resolver.module.ts` (modify)

---

**S2.2 — findControls dt-core method**

As an MCP tool developer, I want a `DtControl.findControls()` method with filters for class, element, module, and name, so that `manage_controls list` can replace the current `getControls(folderId)` with flexible querying.

- Add `findControls()` to `DtControl` following `DtIssue.findIssues()` pattern
- Add `FIND_CONTROLS` and `CONTROL_IDS_BY_ELEMENTS` queries to `dt-control-gql.ts`
- Implement dual path: elementIds → helper query → merge with other filters; no elementIds → auto-generated GraphQL
- Do NOT use interface filter on `elements` field (Memgraph 5+ sec performance issue)

**Documentation:**
- [BACKEND_SERVICES_SPEC.md §5](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_SPEC.md#5-service-3-findcontrols-dt-core) — Method signature, condition builder, use cases
- `dt-core/src/dt-issue/dt-issue.ts` lines 83-150 — Pattern reference (note commented-out interface filter at line 133)

**Files:**
- `dt-core/src/dt-control/dt-control.ts` (modify)
- `dt-core/src/dt-control/dt-control-gql.ts` (modify)

---

**S2.3 — assignControlToElements dt-core method**

As an MCP tool developer, I want a `DtControl.assignControlToElements()` method that creates SUPPORTS edges between a control and elements, so that controls can be linked to the model elements they protect.

- Add `assignControlToElements()` to `DtControl`
- Try auto-generated GraphQL `connect` on polymorphic `elements` field first
- If it doesn't work (test in GraphQL playground), fall back to direct Cypher `MERGE`
- Append-only, idempotent, batch

**Documentation:**
- [BACKEND_SERVICES_SPEC.md §6](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_SPEC.md#6-service-4-assigncontroltoelements-dt-core) — Method signature, GraphQL mutation, Cypher fallback, idempotency
- [BACKEND_SERVICES_ARCHITECTURE.md §4.4](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#44-assigncontroltoelements----supports-edge-creation-dt-core) — Design decisions

**Files:**
- `dt-core/src/dt-control/dt-control.ts` (modify)
- `dt-core/src/dt-control/dt-control-gql.ts` (modify)

---

### Definition of Done

- [ ] `controlIdsByElements` query returns control IDs in GraphQL playground (< 50ms)
- [ ] `findControls({ elementIds })` returns controls linked to those elements
- [ ] `findControls({ classId })` returns controls implementing that class
- [ ] `findControls({ name: "encryption" })` returns substring matches
- [ ] `findControls({ elementIds, classId })` intersects both filters (already_assigned check)
- [ ] `assignControlToElements({ controlId, elementIds })` creates SUPPORTS edges
- [ ] Calling assign twice with same args does not create duplicate edges (idempotent)
- [ ] Polymorphic approach decision documented (GraphQL connect vs Cypher MERGE)

### Verification

**S2.3 — Test polymorphic connect first (blocking decision):**
```
In GraphQL playground, test whether the auto-generated mutation handles
polymorphic elements connect:

mutation {
  updateControls(
    where: { id: { eq: "some-control-id" } }
    update: { elements: { connect: [{ where: { node: { id: { eq: "some-component-id" } } } }] } }
  ) {
    controls { id elements { ... on Component { id } } }
  }
}

If this works → use GraphQL path
If error or wrong behavior → use Cypher MERGE fallback
```

**Unit tests:** `dt-control.spec.ts` — see [BACKEND_SERVICES_SPEC.md §9](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_SPEC.md#9-testing-strategy).

**Cypher verification (via mgconsole or Agent(cypher-memgraph-expert)):**
```cypher
// Verify SUPPORTS traversal performance
MATCH (ctrl:Control)-[:SUPPORTS]->(elem)
WHERE elem.id IN ["comp-1", "comp-2"]
RETURN DISTINCT ctrl.id;
// Expect: < 50ms
```

---

## Sprint 3 — Embedding Pipeline + Vector Search

**Phase:** A2
**Depends on:** Sprint 1 (match_classes resolver exists)

### User Stories

**S3.1 — EmbeddingService**

As a platform developer, I want a thin HTTP client service that calls any OpenAI-compatible embeddings endpoint, so that class nodes can be embedded without coupling to a specific provider.

- Create `EmbeddingService` as NestJS `@Injectable`
- Configuration: `EMBEDDING_ENABLED`, `EMBEDDING_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `EMBEDDING_SIMILARITY_THRESHOLD`
- Methods: `isEnabled()`, `getModel()`, `embedBatch()`, `composeClassText()`, `composeElementText()`
- Retry: 3x with exponential backoff (1s, 3s, 9s)
- Register in `CustomResolverModule`

**Documentation:**
- [BACKEND_SERVICES_SPEC.md §7](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_SPEC.md#7-embedding-pipeline) — Service implementation, configuration, deployment examples
- [BACKEND_SERVICES_ARCHITECTURE.md §6](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#6-embedding-pipeline-architecture) — Architecture, embed-before-insert principle, failure behavior

**Files:**
- `dt-ws/src/gql/services/embedding.service.ts` (new)
- `dt-ws/src/gql/custom-resolver.module.ts` (modify — register EmbeddingService)
- `.env.example` (modify — add EMBEDDING_* variables)

---

**S3.2 — Module ingestion integration**

As a platform operator, I want class nodes to be embedded during module install, so that vector search works immediately without a separate indexing step.

- Inject `EmbeddingService` into `ModuleManagementService`
- Before the class upsert loop: batch embed all classes if enabled
- Pass embedding vector to `upsertClass()`, include in MERGE/SET Cypher
- Store `embeddingModel` property alongside vector
- On failure: retry 3x → fail entire module install (no partial state)

**Documentation:**
- [BACKEND_SERVICES_SPEC.md §7](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_SPEC.md#7-embedding-pipeline) — Module ingestion integration code, upsertClass modification, failure behavior
- [BACKEND_SERVICES_ARCHITECTURE.md §6](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#module-ingestion-integration) — Integration flow diagram
- [ModuleManagementService LLD](../backend/LLD/MODULE_MANAGEMENT_SERVICE.md) — `upsertModule()` at lines 438-547

**Files:**
- `dt-ws/src/gql/module-management-services/module-management.service.ts` (modify)

---

**S3.3 — Vector index creation and Priority 3**

As a platform developer, I want match_classes to use HNSW vector similarity as Priority 3 when available, so that elements with descriptions but no exact/fuzzy name match still get class suggestions.

- Add vector index creation at startup (check existence first via `vector_search.show_index_info()`)
- Add Priority 3 branch to `MatchClassesResolverService`
- Query-time embedding: `composeElementText()` → `embedBatch([text])` → `vector_search.search()`
- Post-filter with `WHERE` (no pre-filter parameter available)
- Request 2-3x `topN` from index, filter and limit in Cypher
- Skip gracefully if `SHOW VECTOR INDEX INFO` fails (Neo4j) or embedding service unavailable

**Documentation:**
- [BACKEND_SERVICES_SPEC.md §3](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_SPEC.md#priority-3-vector-similarity-optional-requires-embedding-index-memgraph-only) — Priority 3 Cypher (corrected syntax)
- [BACKEND_SERVICES_ARCHITECTURE.md §6](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#vector-index-topology) — Index topology, creation syntax, capacity strategy, database detection
- [BACKEND_SERVICES_ARCHITECTURE.md §6](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#query-time-element-embedding) — Query-time embedding flow
- [BACKEND_SERVICES_ARCHITECTURE.md §6](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#vector-search-query-syntax) — Corrected `vector_search.search()` syntax

**Files:**
- `dt-ws/src/gql/resolver-services/match-classes-resolver.service.ts` (modify)

---

**S3.4 — reindexClassEmbeddings mutation**

As a platform operator, I want to re-embed all class nodes when the embedding model changes, so that vector search produces consistent results after a model upgrade.

- Add `ReindexResult` type and `reindexClassEmbeddings` mutation to `schema.graphql`
- Implement in `MatchClassesResolverService` (shares `EmbeddingService` dependency)
- Accept optional `moduleIds` and `capacity` parameters
- Drop and recreate vector indexes with new capacity during reindex
- Blocking operation — does not return until complete
- Authorization required

**Documentation:**
- [BACKEND_SERVICES_SPEC.md §7](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_SPEC.md#re-indexing-embedding-model-migration) — Mutation spec, behavior, when to use
- [BACKEND_SERVICES_ARCHITECTURE.md §6](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#model-version-tracking-and-re-indexing) — Version tracking, reindex as resize opportunity

**Files:**
- `dt-ws/schema/schema.graphql` (modify)
- `dt-ws/src/gql/resolver-services/match-classes-resolver.service.ts` (modify)

---

### Definition of Done

- [ ] `EmbeddingService` works with a local Ollama instance running `nomic-embed-text`
- [ ] Module install with `EMBEDDING_ENABLED=true` stores embedding + embeddingModel on class nodes
- [ ] Module install with unreachable embedding endpoint fails after 3 retries with clear error
- [ ] Module install with `EMBEDDING_ENABLED=false` works as before (no embedding properties)
- [ ] `SHOW VECTOR INDEX INFO` shows 5 indexes after startup
- [ ] `matchClasses` with elements that have descriptions returns vector similarity candidates when Priority 1-2 miss
- [ ] Vector similarity threshold (0.75 default) filters low-quality matches
- [ ] `matchClasses` on Neo4j (or without indexes) skips Priority 3 gracefully, falls through to Priority 4
- [ ] `reindexClassEmbeddings` re-embeds all classes and recreates indexes with new capacity
- [ ] `embeddingModel` mismatch logged as warning at query time

### Verification

**Prerequisite:** Start Ollama locally with `nomic-embed-text`:
```bash
ollama pull nomic-embed-text
# Add to .env: EMBEDDING_ENABLED=true, EMBEDDING_URL=http://localhost:11434/api/embeddings
```

**Verify via mgconsole (Agent(cypher-memgraph-expert) can assist):**
```cypher
-- Check indexes exist
SHOW VECTOR INDEX INFO;
-- Expect: 5 rows (one per class label)

-- Check class nodes have embeddings
MATCH (c:ComponentClass) WHERE c.embedding IS NOT NULL
RETURN c.name, c.embeddingModel, size(c.embedding) AS dims LIMIT 5;
-- Expect: dims = 768, embeddingModel = "nomic-embed-text"

-- Test vector search directly
CALL vector_search.search('component_class_embeddings', 5, $some_vector)
YIELD node, similarity
RETURN node.name, similarity;
```

**Performance:** Module install with 50 classes + embeddings (local Ollama) < 2s.

**Unit tests:** `embedding.service.spec.ts` — see [BACKEND_SERVICES_SPEC.md §9](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_SPEC.md#9-testing-strategy).

---

## Sprint 4 — get_control_gaps

**Phase:** C
**Depends on:** Sprint 1 (classification workflow), Sprint 2 (`controlIdsByElements` + `findControls`)

### User Stories

**S4.1 — Schema and resolver for controlGaps**

As a security analyst, I want a `controlGaps` GraphQL query that shows unmitigated exposures and recommends controls by traversing the MITRE framework chain, so that I can identify security gaps in a single call instead of 20+ sequential queries.

- Add `ControlGapsInput`, `ControlGapsResult`, `UnmitigatedExposure`, `UnaddressableExposure`, `RecommendedControl`, `CoverageSummary`, `MitreReference`, `ElementReference` types to `schema.graphql`
- Add `controlGaps` query resolver to existing `ControlGapsResolverService`
- Implement three-phase Cypher pipeline:
  - Phase 1: Scope model elements (variable-length `BELONGS_TO`, `CONTAINS`, `FLOWS`)
  - Phase 2: Traverse MITRE chain (HAS_EXPOSURE → EXPLOITED_BY → MITIGATION_DEFENDS → RESPONDS_WITH → HAS_COUNTERMEASURE → SUPPORTS)
  - Phase 3: Classify (mitigated / unmitigated / unaddressable) + recommend controls ranked by `addressesCount`
- Unaddressable partitioning in application code (two simple queries, not `NOT EXISTS`)
- Coverage formula: `(mitigated / totalExposures) * 100`
- Empty state: zero exposures → all arrays empty, `coveragePct: 0`

**Documentation:**
- [BACKEND_SERVICES_SPEC.md §4](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_SPEC.md#4-service-2-get_control_gaps) — GraphQL API, Cypher implementation (Phase 1-3), coverage summary, empty state, performance notes
- [BACKEND_SERVICES_ARCHITECTURE.md §4.2](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#42-get_control_gaps----framework-grounded-gap-analysis) — Three-phase pipeline diagram, design decisions, coverage formula
- [BACKEND_SERVICES_ARCHITECTURE.md §5](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#5-data-architecture) — Relationship usage map (all relationships used by gap analysis)

**Files:**
- `dt-ws/schema/schema.graphql` (modify)
- `dt-ws/src/gql/resolver-services/control-gaps-resolver.service.ts` (modify — add controlGaps resolver to existing file from Sprint 2)

---

**S4.2 — dt-core wrapper for controlGaps**

As an MCP tool developer, I want a `DtControl.controlGaps()` method that wraps the GraphQL query, so that the `get_control_gaps` MCP tool can call it.

- Add `controlGaps()` method to `DtControl`
- Add `CONTROL_GAPS` query to `dt-control-gql.ts`
- Complex output mapping — ensure all nested types are correctly typed

**Documentation:**
- [BACKEND_SERVICES_ARCHITECTURE.md §7](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#7-integration-architecture) — dt-core integration table
- [BACKEND_SERVICES_SPEC.md §4](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_SPEC.md#4-service-2-get_control_gaps) — GraphQL response shape

**Files:**
- `dt-core/src/dt-control/dt-control.ts` (modify)
- `dt-core/src/dt-control/dt-control-gql.ts` (modify)

---

### Definition of Done

- [ ] `controlGaps` query returns results in GraphQL playground
- [ ] Model with zero exposures → empty arrays, `coveragePct: 0`
- [ ] Model with exposures, no controls → all exposures in `unmitigatedExposures`, `coveragePct: 0`
- [ ] Model with some controls assigned → `mitigated` count increases, `coveragePct` > 0
- [ ] Unaddressable exposures (no ControlClass covers the mitigation) correctly partitioned
- [ ] `recommendedControls` ranked by `addressesCount` DESC
- [ ] Each recommendation includes `d3fendTechniques` and `elementsAffected`
- [ ] Coverage formula: un-linked exposures (no EXPLOITED_BY) count in total but not in mitigated/unmitigated/unaddressable
- [ ] Variable-length `BELONGS_TO` traversal handles nested boundaries (verified on Memgraph)
- [ ] `DtControl.controlGaps()` works from dt-core

### Verification

**Prerequisite:** A model synced to the platform with exposures (analysis must have run) and MITRE data loaded (`pnpm m-ingest`).

**Cypher verification (Agent(cypher-memgraph-expert) can assist with query correctness):**
```cypher
-- Verify the MITRE chain exists
MATCH (exp:Exposure)-[:EXPLOITED_BY]->(tech:MitreAttackTechnique)
      <-[:MITIGATION_DEFENDS_AGAINST_TECHNIQUE]-(mit:MitreAttackMitigation)
      <-[:RESPONDS_WITH]-(cm:Countermeasure)
RETURN count(*) AS chain_depth;
-- Expect: > 0 (MITRE data loaded and linked)

-- Verify Phase 1 scoping
MATCH (m:Model {id: $model_id})-[:CONTAINS]->(b:SecurityBoundary)
OPTIONAL MATCH (b)<-[:BELONGS_TO*1..]-(nested:SecurityBoundary)
RETURN count(DISTINCT b) AS boundaries, count(DISTINCT nested) AS nested;
-- Validated: works on Memgraph 3.6.2
```

**Performance:** 20 components, 50 exposures → < 200ms. Use `PROFILE` prefix on Cypher queries to verify execution plan.

**Unit tests:** `control-gaps-resolver.service.spec.ts` — see [BACKEND_SERVICES_SPEC.md §9](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_SPEC.md#9-testing-strategy).

---

## Sprint 5 — MCP + Studio Integration

**Phase:** Integration
**Depends on:** Sprints 1-4

### User Stories

**S5.1 — match_classes MCP tool**

As a Dethereal user, I want a `match_classes` MCP tool that classifies my model elements against the platform's class catalog, so that the classification workflow step uses server-side matching instead of 6+ sequential `get_classes` calls.

- Create new MCP tool wrapping `DtClass.matchClasses()`
- Input: elements from local model files, classLabel, optional moduleIds
- Output: formatted match table for agent presentation
- Handles unmatched elements for Pass 2 (agent reasoning)

**Documentation:**
- [BACKEND_SERVICES_ARCHITECTURE.md §7](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#mcp-tool-integration) — MCP tool integration table
- [BACKEND_SERVICES_ARCHITECTURE.md §4.1](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#41-match_classes----class-recommendation-engine) — Integration with classification workflow, Pass 1/Pass 2 split
- [THREAT_MODELING_WORKFLOW.md](THREAT_MODELING_WORKFLOW.md) — Classification workflow step (consumer)

---

**S5.2 — get_control_gaps MCP tool**

As a Dethereal user, I want a `get_control_gaps` MCP tool that shows unmitigated exposures and recommends controls, so that I can identify security gaps after publishing my model.

- Create new standalone MCP tool wrapping `DtControl.controlGaps()`
- Detect empty state (no exposures) → user-friendly message "No exposures found — run analysis first"
- Format output: unmitigated exposures with ATT&CK references, recommended controls ranked

**Documentation:**
- [BACKEND_SERVICES_ARCHITECTURE.md §7](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#mcp-tool-integration) — Standalone tool rationale
- [BACKEND_SERVICES_SPEC.md §4](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_SPEC.md#empty-state-handling) — Empty state handling

---

**S5.3 — manage_controls: list + assign actions**

As a Dethereal user, I want the `manage_controls` MCP tool to support flexible listing (by class, element, module, name) and element assignment, so that I can find relevant controls and link them to my model.

- Replace `getControls()` call in `list` action with `findControls()`
- Add new `assign` action: accepts `[{ control_id, element_id }]` pairs, groups by control_id, calls `assignControlToElements()` per group

**Documentation:**
- [BACKEND_SERVICES_ARCHITECTURE.md §7](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#mcp-tool-integration) — manage_controls integration
- [BACKEND_SERVICES_SPEC.md §6](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_SPEC.md#6-service-4-assigncontroltoelements-dt-core) — Batch semantics, MCP tool grouping code

---

**S5.4 — compute_control_coverage action**

As a Dethereal user, I want a `coverage` action on `validate_model_json` that computes control coverage percentage, so that I get deterministic server-side arithmetic instead of LLM-computed numbers.

- Add `coverage` action to existing `validate_model_json` MCP tool
- Hybrid: read local attribute files + query `controlIdsByElements` for validation
- Formula: `(mitigated / totalExposures) * 100`

**Documentation:**
- [BACKEND_SERVICES_ARCHITECTURE.md §4.5](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#45-compute_control_coverage----hybrid-coverage-computation-mcp) — Hybrid architecture
- [CONTROL_INTEGRATION.md](CONTROL_INTEGRATION.md) — Control workflow (consumer)

---

**S5.5 — Studio GraphQL integration**

As a Studio developer, I want the new GraphQL queries available for the web UI, so that the classification bootstrap and control gap dashboard can use server-side services.

- Wire `matchClasses` into `BootstrapExistingClasses` component
- Wire `controlGaps` into control gap dashboard (new or existing)
- Wire `controlIdsByElements` into component detail panel
- Wire `findControls` into control library browser
- Wire `assignControlToElements` into control assignment dialog

**Documentation:**
- [BACKEND_SERVICES_ARCHITECTURE.md §7](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#studio-web-ui-integration) — Studio integration table with component mapping

---

### Definition of Done

- [ ] `match_classes` MCP tool works end-to-end: local model → server matching → formatted results
- [ ] `get_control_gaps` MCP tool works end-to-end: model ID → gap analysis → formatted recommendations
- [ ] `manage_controls list` uses `findControls` with all filter options
- [ ] `manage_controls assign` creates SUPPORTS edges via `assignControlToElements`
- [ ] `validate_model_json coverage` returns deterministic coverage percentage
- [ ] Studio `BootstrapExistingClasses` calls `matchClasses` instead of client-side matching
- [ ] All MCP tools handle offline/error states gracefully (see offline behavior table)

### Verification

End-to-end workflow test (Dethereal plugin):
```
1. /dethereal:discover → produces element inventory
2. match_classes tool → classifies elements (verify Pass 1 results)
3. manage_controls list (classId: "...") → finds relevant controls
4. manage_controls assign → links controls to elements
5. get_control_gaps → shows remaining gaps after assignment
6. validate_model_json coverage → reports coverage percentage
```

Studio smoke test:
```
1. Open model in Studio
2. Add component → BootstrapExistingClasses suggests classes from matchClasses
3. Navigate to control gap view → displays unmitigated exposures
4. Click component → detail panel shows linked controls via controlIdsByElements
```

---

## Summary

| Sprint | Phase | Stories | Depends on | Key risk |
|--------|-------|---------|------------|----------|
| 1 | A1 | S1.1-S1.2 | — | Low. Proven patterns. |
| 2 | B | S2.1-S2.3 | — | Low. Polymorphic connect decision (test early). |
| 3 | A2 | S3.1-S3.4 | Sprint 1 | Medium. New infrastructure (EmbeddingService, Ollama, vector indexes). |
| 4 | C | S4.1-S4.2 | Sprint 1+2 | Medium. Complex multi-hop Cypher, performance on large models. |
| 5 | Integration | S5.1-S5.5 | Sprint 1-4 | Low. Wiring — all backend services already verified. |
