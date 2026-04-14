# Backend Services -- Target Architecture

> Target architecture for backend services that support class matching, control gap analysis, element-control assignment, and vector-enhanced semantic search. These services extend the dt-ws backend and dt-core data access layer, serving both the Dethereal plugin and the Dethernety web UI. Status: **draft**.

## Table of Contents

- [1. Goals](#1-goals)
- [2. Architecture Principles](#2-architecture-principles)
- [3. System Context](#3-system-context)
- [4. Service Architecture](#4-service-architecture)
- [5. Data Architecture](#5-data-architecture)
- [6. Embedding Pipeline Architecture](#6-embedding-pipeline-architecture)
- [7. Integration Architecture](#7-integration-architecture)
- [8. Security Architecture](#8-security-architecture)
- [9. Deployment Architecture](#9-deployment-architecture)
- [10. Quality Attributes](#10-quality-attributes)
- [11. Constraints and Trade-offs](#11-constraints-and-trade-offs)
- [12. Related Documents](#12-related-documents)

---

## 1. Goals

### Problem

As the module ecosystem grows (3 modules today, 10-20 target), client-side operations that iterate over classes, controls, and exposures become unworkable. Each module provides 30-50 classes with attribute templates. At 10 modules, a classification workflow must consider 300-500 classes -- too many to load into an LLM context window, too many to send over sequential MCP tool calls, and too many for the web UI to render as a flat list.

The same scaling problem applies to control gap analysis (N+M sequential queries), coverage computation (LLM arithmetic errors), and element-control assignment (polymorphic interface performance issues on Memgraph).

See [BACKEND_DELEGATION.md](BACKEND_DELEGATION.md) Section 1 for the full problem statement and scaling analysis.

### Architecture goals

| Goal | Success criteria |
|------|-----------------|
| **Classification scaling** | Classify 15 elements against 300+ classes in a single tool call (< 500ms) instead of 6+ sequential `get_classes` calls |
| **Framework-grounded gap analysis** | Traverse the full MITRE ATT&CK/D3FEND chain in a single Cypher query, producing ranked recommendations |
| **Deterministic coverage reporting** | Server-side arithmetic for coverage percentages -- no LLM-computed numbers |
| **Dual-client support** | Every backend service is consumable by both the Dethereal MCP plugin (via dt-core) and the Dethernety web UI (via GraphQL) |
| **Progressive vector enhancement** | Semantic class matching via embeddings improves results when available, but the system is fully functional without it |
| **Database portability** | All deterministic services work on both Neo4j and Memgraph; vector search is Memgraph-only for this phase |

### Non-goals

- **Replacing `get_classes`**: The existing browsing/exploration tool remains unchanged. `match_classes` answers "which classes match these elements?" while `get_classes` answers "what classes exist?"
- **Real-time sync**: These services do not introduce bidirectional sync between the plugin and platform. The publish/working-copy model is preserved.
- **Analysis engine replacement**: Gap analysis uses the MITRE framework chain as a lookup, not as an analysis algorithm. Platform analysis modules remain responsible for computing exposures, attack paths, and findings.

---

## 2. Architecture Principles

The backend services architecture applies both the platform-level and Dethereal-specific design principles established across the documentation set.

### Platform principles applied

These principles are defined in the [Platform Architecture Overview](../README.md):

| Principle | How it applies |
|-----------|----------------|
| **Graph-native** | All services use direct Cypher traversals against the graph database. Gap analysis follows the full `Exposure -> ATT&CK Technique -> Mitigation -> Countermeasure -> Control -> Element` chain as a native graph query. No object-relational mapping, no intermediate data structures. |
| **Extensibility** | The match_classes service is generalized across all five class types via a single `classLabel` parameter. New class types added by modules are automatically searchable. The embedding pipeline embeds all class labels without code changes. |
| **Standards-based** | Gap analysis is grounded in MITRE ATT&CK and D3FEND. Recommendations are linked to specific techniques and mitigations, not heuristic rules. |
| **Secure by design** | Custom resolvers bypass `@neo4j/graphql`'s auto-generated `@authentication` directive, so each resolver explicitly checks authorization via `AuthorizationService`. No exception, no shortcut. |
| **Database portability** | Deterministic matching (priorities 1-2) and gap analysis work on both Neo4j and Memgraph. Vector search uses Memgraph's built-in HNSW indexes (available since 3.0); Neo4j deployments gracefully skip Priority 3. |

### Dethereal principles applied

These principles are defined in the [Plugin Architecture](PLUGIN_ARCHITECTURE.md) and [Dethereal README](README.md):

| Principle | How it applies |
|-----------|----------------|
| **Mapping, not analysis** | `match_classes` provides ranked *hypotheses*. The agent (or user) validates them. The backend does not auto-classify -- it narrows the search space. |
| **Grounded, not hallucinated** | MITRE references in gap analysis come from the platform's graph database, not from LLM reasoning. Every recommended control traces back to a D3FEND technique that addresses a specific ATT&CK technique. |
| **Efficiency first** | Single tool calls replace multi-turn workflows: 6+ `get_classes` calls become 1 `match_classes`; 20+ exposure/countermeasure queries become 1 `get_control_gaps`. |

### Backend delegation principle

Defined in [BACKEND_DELEGATION.md](BACKEND_DELEGATION.md) Section 2:

> An operation belongs in the backend when it **scales with module/class count**, **requires graph traversal**, **serves both Studio and CLI**, **involves arithmetic or aggregation**, or **produces a filtered/ranked subset**. An operation stays client-side when it **requires offline operation**, **requires conversation context**, **requires judgment**, **is a write to local files**, or **does not scale with data size**.

Every service in this architecture was evaluated against this framework. The results:

| Service | Scales with data | Graph traversal | Dual-client | Arithmetic | Filtered result | **Placement** |
|---------|:---:|:---:|:---:|:---:|:---:|---|
| `match_classes` | Yes | Yes | Yes | No | Yes | **Backend** |
| `get_control_gaps` | Yes | Yes (multi-hop) | Yes | Yes | Yes | **Backend** |
| `findControls` | Moderate | Yes (SUPPORTS) | Yes | No | Yes | **Backend** (dt-core) |
| `assignControlToElements` | No | Yes (MERGE) | Yes | No | No | **Backend** (dt-core) |
| `compute_control_coverage` | Yes | Partial | Yes | Yes | No | **Hybrid** (MCP + backend) |

---

## 3. System Context

### Where the services live

```
                                    AI Assistant / Web UI
                                           │
                           ┌───────────────┼───────────────┐
                           │               │               │
                           ▼               ▼               ▼
                      ┌─────────┐   ┌───────────┐   ┌──────────┐
                      │Dethereal│   │Dethernety │   │  Other   │
                      │  MCP    │   │  Studio   │   │ Clients  │
                      │ Server  │   │  (Vue 3)  │   │          │
                      └────┬────┘   └─────┬─────┘   └────┬─────┘
                           │              │               │
                     dt-core (Apollo)  Apollo Client   Apollo Client
                           │              │               │
                           ▼              ▼               ▼
                    ┌──────────────────────────────────────────────┐
                    │              dt-ws (NestJS)                   │
                    │                                              │
                    │  ┌────────────────────────────────────────┐  │
                    │  │    Custom Resolver Services             │  │
                    │  │                                        │  │
                    │  │  ┌──────────────────────────────────┐  │  │
                    │  │  │  NEW: MatchClassesResolverService │  │  │
                    │  │  │  NEW: ControlGapsResolverService  │  │  │
                    │  │  ├──────────────────────────────────┤  │  │
                    │  │  │  TemplateResolverService          │  │  │
                    │  │  │  AnalysisResolverService          │  │  │
                    │  │  │  ComponentClassResolverService    │  │  │
                    │  │  │  IssueResolverService             │  │  │
                    │  │  │  SetInstantiationResolverService  │  │  │
                    │  │  └──────────────────────────────────┘  │  │
                    │  └────────────────────────────────────────┘  │
                    │                                              │
                    │  ┌────────────────────────────────────────┐  │
                    │  │    Shared Services                      │  │
                    │  │                                        │  │
                    │  │  AuthorizationService                  │  │
                    │  │  MonitoringService                     │  │
                    │  │  NEW: EmbeddingService                 │  │
                    │  │  Neo4j Driver (@Inject)                │  │
                    │  └────────────────────────────────────────┘  │
                    │                                              │
                    │  ┌────────────────────────────────────────┐  │
                    │  │    Module Management                    │  │
                    │  │                                        │  │
                    │  │  ModuleManagementService               │  │
                    │  │    └─ upsertClass() + embedding        │  │
                    │  │  ModuleRegistryService                 │  │
                    │  └────────────────────────────────────────┘  │
                    │                      │                       │
                    └──────────────────────┼───────────────────────┘
                                           │
                                    Bolt/Cypher driver
                                           │
                                           ▼
                              ┌────────────────────────┐
                              │  Graph Database         │
                              │  (Neo4j or Memgraph)    │
                              │                        │
                              │  + HNSW Vector Index   │
                              │    (Memgraph only)     │
                              └────────────────────────┘
```

### Execution contexts

The architecture has two execution contexts, following the established pattern:

| Context | Services | Data access | Rationale |
|---------|----------|-------------|-----------|
| **dt-ws backend** | `match_classes`, `get_control_gaps`, `controlIdsByElements` | Bolt/Cypher (direct), GraphQL (auto-generated) | Graph traversals and vector queries require database proximity |
| **Dethereal MCP server** | `compute_control_coverage` | Local filesystem + GraphQL to dt-ws | Hybrid: local file reads (attribute files) + platform query (SUPPORTS edges) |

Pure backend services follow a three-layer call chain:

```
MCP tool (dethereal)  →  dt-core method (Apollo Client)  →  Custom resolver (dt-ws, Bolt/Cypher)
```

The MCP layer handles input validation and result formatting. The dt-core layer wraps the GraphQL call. The resolver executes the Cypher queries. This is the same pattern used by every existing platform operation (e.g., `manage_exposures` → `DtExposure.getExposures()` → auto-generated resolver).

### Resolver infrastructure

Custom resolvers are registered in `CustomResolverModule` (`custom-resolver.module.ts`) which provides shared service injection. The new resolvers follow the established registration pattern described in [GraphQL Module](GRAPHQL_MODULE.md) -- add to the `resolverServiceClasses` array, and the module wires up `AuthorizationService`, `MonitoringService`, and the Bolt driver automatically.

Database access uses the Neo4j Bolt driver injected via `@Inject('NEO4J_DRIVER')` from `DatabaseModule` (there is no `GqlService` wrapper -- resolvers receive the driver directly). Queries use Neo4j v5 transaction patterns (`session.executeRead()` / `session.executeWrite()`). See [Database Module](DATABASE_MODULE.md) for connection pooling, health monitoring, and session management. Read-only queries (`match_classes`, `get_control_gaps`, `controlIdsByElements`) use `executeRead()`. The `assignControlToElements` Cypher fallback (if needed) uses `executeWrite()`.

---

## 4. Service Architecture

### 4.1 match_classes -- Class recommendation engine

**Role:** Given a list of elements (name, type, description), find the best matching classes from the class catalog. Covers all five class types: ComponentClass, DataFlowClass, SecurityBoundaryClass, DataClass, ControlClass.

**Architecture pattern:** Multi-priority pipeline with short-circuit evaluation.

```
                            Input: elements[]
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
                    ▼              ▼              ▼
               element₁      element₂      element₃  ...
                    │
     ┌──────────────┼──────────────────────────────────┐
     │              │                                  │
     │    ┌─────────▼──────────┐                       │
     │    │ Priority 1         │                       │
     │    │ Exact name match   │──── hit ──→ done      │
     │    │ (case-insensitive) │                       │
     │    └─────────┬──────────┘                       │
     │         no match                                │
     │    ┌─────────▼──────────┐                       │
     │    │ Priority 2         │                       │
     │    │ Fuzzy name match   │──── hit ──→ done      │
     │    │ (substring)        │                       │
     │    └─────────┬──────────┘                       │
     │         no match                                │
     │    ┌─────────▼──────────┐                       │
     │    │ Priority 3         │                       │
     │    │ Vector similarity  │──── hit ──→ done      │
     │    │ (HNSW, optional)   │                       │
     │    └─────────┬──────────┘                       │
     │     no match / unavailable                      │
     │    ┌─────────▼──────────┐                       │
     │    │ Priority 4         │                       │
     │    │ Type-filtered      │──→ fallback candidates│
     │    │ heuristic          │                       │
     │    └────────────────────┘                       │
     │                                                 │
     └──────── per-element pipeline ───────────────────┘
                    │
                    ▼
            Output: matches[] + unmatched[]
```

**Priority characteristics:**

| Priority | Method | Confidence | Cost | Database | Deterministic |
|----------|--------|------------|------|----------|:---:|
| 1 | Exact name (case-insensitive) | high | Cypher `toLower` compare | Neo4j + Memgraph | Yes |
| 2 | Substring containment | high | In-memory string ops | Neo4j + Memgraph | Yes |
| 3 | Vector similarity (cosine, threshold >= 0.75) | medium | HNSW search + query-time embedding | Memgraph only | No |
| 4 | Type-filtered heuristic | low | Cypher label match | Neo4j + Memgraph | Yes |

**Key design decisions:**

- **Single generalized service.** One `classLabel` parameter selects which node label to search. No per-class-type services, no separate `match_controls` tool. The `ClassLabelEnum` maps directly to graph labels: `COMPONENT` -> `ComponentClass`, `CONTROL` -> `ControlClass`, etc.
- **`componentType` filter only for COMPONENT.** The `ComponentType` enum (PROCESS, STORE, EXTERNAL_ENTITY) is a property of `ComponentClass` only. Other class labels have no type property to filter on. Priority 4 returns `topN` classes of the label for non-COMPONENT types.
- **Short-circuit per element, not per batch.** Each element walks the priority pipeline independently. A batch of 15 elements may have some matched at Priority 1 and others falling through to Priority 3.
- **No IaC mapping table.** Dropped during review -- the same results are achieved by exact/fuzzy name matching against class names. An IaC-to-class mapping table would duplicate class naming and drift.
- **`fields` parameter for follow-up elimination.** The caller can request `description`, `category`, `type` in the match response. This eliminates the most common follow-up `get_classes` call -- the agent can present confirmation tables from a single `match_classes` call.

**Integration with the classification workflow:**

`match_classes` handles **Pass 1** (deterministic + semantic matching). **Pass 2** (LLM-assisted contextual reasoning) is preserved -- the agent validates high-confidence matches, applies boundary context, connected flow analysis, and peer inference to elements returned in the `unmatched[]` array or matched at low confidence. The two-pass methodology remains: server handles data-intensive matching, agent handles judgment-intensive reasoning.

**Control matching workflow:**

The brownfield control workflow (finding relevant Controls from the org library) decomposes into two existing operations without a separate tool:

1. `match_classes(classLabel: CONTROL)` -> finds relevant ControlClass IDs
2. `manage_controls(list, class_ids: [...])` -> finds Controls implementing those classes

### 4.2 get_control_gaps -- Framework-grounded gap analysis

**Role:** Given a synced model, traverse the MITRE framework chain to identify unmitigated exposures and recommend controls. Post-analysis service -- requires exposures to exist.

**Architecture pattern:** Three-phase Cypher pipeline with application-level partitioning.

```
  Phase 1: Scope                     Phase 2: Traverse                Phase 3: Classify
  ─────────────────                  ──────────────────               ──────────────────

  Model                              Element ──HAS_EXPOSURE──> Exposure          Partition:
    │                                                              │              ├─ mitigated
    ├── CONTAINS ──> Boundary                              EXPLOITED_BY           ├─ unmitigated
    │                   │                                          │              └─ unaddressable
    │              BELONGS_TO ──> Component                        ▼
    │                (nested,       │                    ATT&CK Technique         Recommend:
    │                 var-length)   │                              │              └─ controls ranked
    │                            FLOWS                   MITIGATION_DEFENDS       by addresses_count
    │                              │                     _AGAINST_TECHNIQUE
    ├── CONTAINS ──> Data          ▼                              │
    │                          DataFlow                           ▼
    │                                              ATT&CK Mitigation
    └──────────────────────────                           │
           all elements                          RESPONDS_WITH
                                                          │
                                                          ▼
                                                   Countermeasure
                                                          ▲
                                                 HAS_COUNTERMEASURE
                                                          │
                                                       Control ──SUPPORTS──> Element
```

**Key design decisions:**

- **Full model scope.** All components in the model are included regardless of boundary nesting. Variable-length `BELONGS_TO` traversal handles nested boundaries. Viewpoint-based scoping (e.g., "external only") is a future enhancement.
- **Unaddressable partitioning in application code.** The resolver collects unique mitigation IDs from unmitigated exposures, then runs a second simple query to check which mitigations have a `Countermeasure -> ControlClass -> Module` path. This avoids complex `NOT EXISTS` patterns that differ between Neo4j and Memgraph.
- **Coverage formula.** `coveragePct = totalExposures > 0 ? (mitigated / totalExposures) * 100 : 0`. Exposures with no `EXPLOITED_BY` link (no ATT&CK technique mapped) count toward `totalExposures` but not toward `mitigated`/`unmitigated`/`unaddressable` -- they have no MITRE chain to evaluate. Consequence: `totalExposures != mitigated + unmitigated + unaddressable` when un-linked exposures exist, and `coveragePct` cannot reach 100% until all exposures have ATT&CK technique mappings. This is intentional -- un-linked exposures represent a data quality gap, not a controls gap.
- **Empty state.** If no exposures exist (analysis not yet run), all arrays are empty and `coveragePct` is 0. The MCP tool detects this and returns a user-friendly message.

### 4.3 findControls -- Flexible control query (dt-core)

**Role:** Query controls with filters beyond the current `folderId`-only `getControls()`. Adds filtering by class, element, module, and name. Follows the `DtIssue.findIssues()` pattern.

**Architecture pattern:** Condition builder with dual query paths.

```
  findControls({ elementIds, classId, name, moduleId })
           │
           ├─── elementIds provided? ──── yes ──→ Path 1: Cypher helper
           │                                      controlIdsByElements(elementIds)
           │                                        → returns control IDs
           │                                        → merge with other filters
           │
           └─── no ───────────────────────────→ Path 2: Auto-generated GraphQL
                                                  Build ControlWhere condition
                                                  from classId, name, moduleId
```

**Why the dual path:** The `Control.elements` field is typed as `[Element!]!` -- a polymorphic interface. Auto-generated interface queries on Memgraph cause 5+ second response times due to missing index usage. This is the same problem `DtIssue.findIssues()` encountered (its interface-based filter is commented out at line 133 of `dt-issue.ts`). The `controlIdsByElements` helper query uses direct Cypher (`MATCH (ctrl:Control)-[:SUPPORTS]->(elem) WHERE elem.id IN $element_ids`) which is fast.

**Resolver location:** The `controlIdsByElements` helper query is registered in `ControlGapsResolverService` since gap analysis also needs element-to-control lookups for SUPPORTS traversal. Both `findControls` (via dt-core) and `controlGaps` consume it.

### 4.4 assignControlToElements -- SUPPORTS edge creation (dt-core)

**Role:** Create `SUPPORTS` edges between a Control and model elements. Append-only -- adds edges without removing existing ones.

**Architecture pattern:** Idempotent MERGE with batch semantics.

**Key characteristics:**

- **Append-only.** Replace semantics (disconnect + reconnect) are handled by the existing `updateControl()`, which already implements this pattern for `controlClasses`.
- **Idempotent.** `MERGE` (or GraphQL `connect`) ensures duplicate calls do not create duplicate edges.
- **Batch.** One call handles multiple `elementIds` in a single database transaction.
- **Polymorphic fallback.** If the auto-generated `ControlUpdateInput` does not correctly handle the polymorphic `elements` connect, fall back to direct Cypher: `MATCH (ctrl:Control {id: $control_id}) MATCH (elem) WHERE elem.id IN $element_ids MERGE (ctrl)-[:SUPPORTS]->(elem)`.

### 4.5 compute_control_coverage -- Hybrid coverage computation (MCP)

**Role:** Compute a coverage percentage for a model's controls against its elements. Not a new backend service -- this is an MCP-layer computation that combines local file reads with a single platform query.

**Architecture pattern:** Hybrid (local + backend).

The MCP tool reads local attribute files to determine which elements have controls configured, then queries the platform for `SUPPORTS` edge counts to validate. The formula is `(mitigated / totalExposures) * 100`, using the same coverage semantics as `get_control_gaps`.

This is exposed as a new `coverage` action on the existing `validate_model_json` MCP tool. No new GraphQL endpoint, no new dt-core method, no new resolver. The backend contribution is limited to the existing `controlIdsByElements` helper query for validation.

---

## 5. Data Architecture

### Graph schema extensions

No new node labels are introduced. All services operate on existing labels and relationships defined in `schema.graphql`. The only schema additions are:

| Addition | Type | Purpose |
|----------|------|---------|
| `matchClasses` | Query | Class matching entry point |
| `controlGaps` | Query | Gap analysis entry point |
| `controlIdsByElements` | Query | Helper for element-based control lookup |
| `reindexClassEmbeddings` | Mutation | Embedding model migration |
| Input/output types | Types | `MatchClassesInput`, `ControlGapsResult`, etc. |

### Node property extension

Two new properties are added to class nodes when embeddings are enabled:

| Property | Labels | Type | Purpose |
|----------|--------|------|---------|
| `embedding` | All 5 class labels | `float[]` (768 dimensions) | Vector for HNSW similarity search |
| `embeddingModel` | All 5 class labels | `string` | Model identifier for version drift detection |

These properties are **optional**. Class nodes without them are valid and fully functional -- they simply do not participate in Priority 3 vector search.

### Relationship usage map

```
  Module ──HAS_CLASS──> ComponentClass      (match_classes: class catalog)
                        ControlClass
                        DataFlowClass
                        SecurityBoundaryClass
                        DataClass

  Control ──IS_INSTANCE_OF──> ControlClass   (findControls, gap analysis)
  Control ──SUPPORTS──> Component            (assignControlToElements, gap analysis)
                        SecurityBoundary
                        DataFlow
                        Model
  Control ──HAS_COUNTERMEASURE──> Countermeasure  (gap analysis)

  Countermeasure ──IS_COUNTERMEASURE_OF──> ControlClass    (gap analysis)
  Countermeasure ──RESPONDS_WITH──> MitreAttackMitigation  (gap analysis)
  Countermeasure ──RESPONDS_WITH──> MitreDefendTechnique   (gap analysis)

  Exposure ──EXPLOITED_BY──> MitreAttackTechnique          (gap analysis)
  MitreAttackMitigation ──MITIGATION_DEFENDS_AGAINST_TECHNIQUE──> MitreAttackTechnique  (gap analysis)

  Element ──HAS_EXPOSURE──> Exposure         (gap analysis: model scoping)
  Model ──CONTAINS──> SecurityBoundary       (gap analysis: model scoping)
  Model ──CONTAINS──> Data                   (gap analysis: model scoping)
  Component ──BELONGS_TO──> SecurityBoundary  (gap analysis: nested boundaries)
  SecurityBoundary ──BELONGS_TO──> SecurityBoundary  (gap analysis: boundary nesting)
  Component ──FLOWS──> DataFlow              (gap analysis: model scoping)
```

---

## 6. Embedding Pipeline Architecture

### Design principle: embed before insert

The central design principle is **embed before insert**: vectors are computed before class nodes enter the database. This eliminates eventual consistency -- if a class node exists, it already has its embedding. There is no window where a class is queryable by name but not by vector similarity, no `embeddingReady` flag, no background worker.

### Pre-computed vectors (offline install)

Before the pipeline reaches the embedding endpoint, `ModuleManagementService.resolveVectors()` asks the module itself whether it has a pre-computed vector for each class via `DTModule.getEmbedding(className, slug)`. When present, the shipped vector is used directly; only classes without a shipped vector are embedded on the fly. Fully-embedded modules install with zero HTTP calls to the embedding endpoint.

The shipped vector path, the on-the-fly path, and the CLI (`module-manager embed`) all share a single text-composition helper (`@dethernety/dt-module/embedding::composeClassText`) to guarantee the text embedded at build time is byte-equal to the text embedded at install time. See [PRE_COMPUTED_EMBEDDINGS_SPEC.md](../../modules/PRE_COMPUTED_EMBEDDINGS_SPEC.md) for the full design.

```
  Module metadata (YAML/JSON)
         │
         ▼
  Parse class definitions
  (name, description, category, type)
         │
         ▼
  Compose embedding text per class:        ─── Embedding Service ───
  "{name}. {description}. Category:       │                         │
   {category}. Type: {type}."             │  HTTP POST to           │
         │                                │  OpenAI-compatible      │
         ▼                                │  endpoint (Ollama,      │
  Batch embed all classes ──────────────→ │  LocalAI, OpenAI, etc.) │
         │                                │                         │
         ▼                                 ─────────────────────────
  vectors[] in memory
         │
         ▼
  MERGE class nodes with embedding + embeddingModel
  (single Cypher transaction)
         │
         ▼
  HNSW index auto-includes new nodes
  (Memgraph automatic indexing)
```

### Embedding service architecture

A thin HTTP client, not a model runtime. The service calls any OpenAI-compatible embeddings endpoint. There is no `EMBEDDING_PROVIDER` enum -- local (Ollama, LocalAI) vs cloud (OpenAI, Bedrock) is a deployment decision, not a code path.

```
  dt-ws/src/gql/services/embedding.service.ts

  ┌───────────────────────────────────────────────┐
  │  EmbeddingService (@Injectable)               │
  │                                               │
  │  Configuration:                               │
  │    EMBEDDING_ENABLED    (bool, default: false) │
  │    EMBEDDING_URL        (any compatible URL)   │
  │    EMBEDDING_API_KEY    (empty for local)      │
  │    EMBEDDING_MODEL      (default: nomic-embed-│
  │                          text, 768 dims)       │
  │    EMBEDDING_DIMENSIONS (default: 768)         │
  │    EMBEDDING_SIMILARITY_THRESHOLD (def: 0.75)  │
  │                                               │
  │  Methods:                                     │
  │    isEnabled()       → boolean                │
  │    getModel()        → string                 │
  │    embedBatch(texts) → number[][] | null      │
  │    composeClassText(cls)    → string          │
  │    composeElementText(elem) → string          │
  │                                               │
  │  Retry: 3x with exponential backoff           │
  │         (1s, 3s, 9s)                          │
  │  Failure: throw after exhausting retries      │
  └───────────────────────────────────────────────┘
```

**Default model: `nomic-embed-text`** (768 dimensions). Chosen for quality-to-size ratio, local deployment via Ollama, and suitability for the domain (technical infrastructure descriptions). The embedding model is configurable per deployment.

### Vector index topology

One HNSW index per class label, created at platform startup. Memgraph-only -- Neo4j deployments skip this entirely.

```
  component_class_embeddings    → ComponentClass.embedding
  control_class_embeddings      → ControlClass.embedding
  dataflow_class_embeddings     → DataFlowClass.embedding
  boundary_class_embeddings     → SecurityBoundaryClass.embedding
  data_class_embeddings         → DataClass.embedding
```

Created via Memgraph DDL `CREATE VECTOR INDEX`. Vector search is **built into Memgraph core since version 3.0** -- it is not a MAGE add-on. The `memgraph-mage:3.6.2` image includes it, but so does the plain `memgraph/memgraph` image.

Index creation syntax:

```cypher
CREATE VECTOR INDEX component_class_embeddings ON :ComponentClass(embedding)
WITH CONFIG {"dimension": 768, "capacity": 500, "metric": "cos"};
```

**Capacity strategy:** Start small (500), monitor via `vector_search.show_index_info()` (check `size` vs `capacity`), and resize by dropping and recreating the index with larger capacity during `reindexClassEmbeddings`. The reindex mutation already re-embeds all classes, so it is the natural place to resize. Memgraph rounds capacity up internally (e.g. 100 → 256, 500 → 512). At target scale (10-20 modules × 50 classes = 500-1000 per label), a capacity of 2000-5000 is appropriate. The `reindexClassEmbeddings` mutation should accept an optional `capacity` parameter to control this.

**Note:** The metric name is `"cos"`, not `"cosine"`. Creation is **not idempotent** -- creating a duplicate index raises an error. The application must check for existence first via `vector_search.show_index_info()` or wrap creation in error handling.

### Vector search query syntax

The `vector_search.search()` procedure takes exactly 3 parameters in this order: `(index_name, limit, query_vector)`. There is no filter parameter -- post-filter with `WHERE`:

```cypher
CALL vector_search.search('component_class_embeddings', 10, $query_vector)
YIELD node, similarity
WHERE node.type = $component_type AND similarity >= 0.75
MATCH (node)<-[:HAS_CLASS]-(m:Module)
WHERE $module_ids IS NULL OR m.id IN $module_ids
RETURN node.id, node.name, node.description, node.category, m.name AS moduleName, similarity
ORDER BY similarity DESC
LIMIT $top_n
```

Since pre-filtering is not supported, request more results from the index (e.g., 2-3x `topN`) and filter in Cypher. This is a meaningful design consideration for indexes with many class types.

### Database detection

The codebase currently has no mechanism to detect whether the graph database is Neo4j or Memgraph -- both are accessed via the same Bolt driver with `NEO4J_URI`. Vector search requires knowing the database type to decide whether to attempt HNSW operations.

**Detection strategy:** Runtime feature detection via `SHOW VECTOR INDEX INFO`. Before executing any vector operation, the resolver calls:

```cypher
SHOW VECTOR INDEX INFO
```

If this succeeds, vector search is available (Memgraph 3.0+). If it throws (syntax error or procedure not found), the system is running Neo4j or an older Memgraph -- log a warning and skip Priority 3. This is preferred over a `DATABASE_TYPE` env var because it detects actual capability, not declared intent.

To check for a specific index:

```cypher
CALL vector_search.show_index_info() YIELD index_name
WHERE index_name = 'component_class_embeddings'
RETURN index_name
```

### Module ingestion integration

The embedding pipeline integrates into the existing `ModuleManagementService.upsertModule()` method. The integration point is before the class upsert loop:

```
  upsertModule()
       │
       ├─ 1. Parse module metadata → extract all classes (all labels)
       │
       ├─ 2. Batch embed all classes (if EMBEDDING_ENABLED)
       │      └─ EmbeddingService.embedBatch(texts)
       │         └─ On failure: retry 3x → fail module install
       │
       └─ 3. Upsert each class with embedding vector
              └─ upsertClass(tx, moduleId, cls, label, embedding)
                 └─ MERGE + SET including embedding + embeddingModel
```

**Failure behavior:** If embeddings are enabled but unreachable, module install fails after 3 retries. No partial state -- either all classes are inserted with embeddings, or nothing is inserted. This prevents a state where the module is installed without embeddings and is never re-processed (the module registry won't re-ingest an already-registered module).

### Query-time element embedding

When `match_classes` reaches Priority 3 for an unmatched element, the resolver embeds the query element on the fly:

1. Compose embedding text via `EmbeddingService.composeElementText(element)` -- produces `"{name}. {description}. Type: {type}."`
2. Call `EmbeddingService.embedBatch([text])` to get the query vector
3. Pass the query vector to `vector_search.search()` against the appropriate HNSW index

This is a per-element call at query time, not a batch. For a batch of 15 elements where 10 matched at Priority 1-2, only the remaining 5 trigger embedding calls. If the embedding service is unavailable at query time, Priority 3 is skipped (same as when embeddings are disabled) and the element falls through to Priority 4.

### Model version tracking and re-indexing

The `embeddingModel` property on class nodes tracks which model produced the vector. At query time, if the configured model differs from the stored model, a warning is logged. A `reindexClassEmbeddings` mutation allows re-computing all vectors after an embedding model change -- this is a blocking operation to prevent stale vectors from producing incorrect rankings during a partial reindex.

---

## 7. Integration Architecture

### dt-core integration

New methods are added to existing dt-core classes. No new dt-core classes are introduced.

| Class | New method | Wraps | Pattern reference |
|-------|-----------|-------|-------------------|
| `DtClass` | `matchClasses()` | `matchClasses` GraphQL query | `DtIssue.findIssues()` |
| `DtControl` | `findControls()` | `FindControls` GraphQL query | `DtIssue.findIssues()` |
| `DtControl` | `assignControlToElements()` | `AssignControlToElements` GraphQL mutation | `DtControl.updateControl()` |
| `DtControl` | `controlGaps()` | `controlGaps` GraphQL query | New (complex output) |

All dt-core methods use Apollo Client exclusively. No Bolt driver calls from dt-core -- this is an established constraint (dt-core is a client-side library shared across consumers).

### MCP tool integration

Backend services are exposed as MCP tools or as new actions on existing tools:

| Backend service | MCP tool | Integration |
|----------------|----------|-------------|
| `match_classes` | New `match_classes` tool | Direct wrapper around `DtClass.matchClasses()` |
| `get_control_gaps` | New `get_control_gaps` tool | Wrapper around `DtControl.controlGaps()`. Standalone tool (not an action on `manage_exposures`) because the output shape (gaps, recommendations, coverage) is distinct from exposure CRUD. |
| `findControls` | Existing `manage_controls` (`list` action) | Replaces current `getControls()` call |
| `assignControlToElements` | Existing `manage_controls` (new `assign` action) | New action, groups by control_id |
| `compute_control_coverage` | Existing `validate_model_json` (new `coverage` action) | Hybrid: local file reads + GraphQL |

### Studio (web UI) integration

All backend services are standard GraphQL queries/mutations. The Studio consumes them directly via Apollo Client, the same way it consumes all existing platform APIs. Specific UI integration points:

| Service | Studio component | Use case |
|---------|-----------------|----------|
| `matchClasses` | `BootstrapExistingClasses` | Suggest classes as user names components |
| `controlGaps` | Control gap dashboard | Display unmitigated exposures and recommendations |
| `controlIdsByElements` | Component detail panel | Show controls protecting a specific element |
| `findControls` | Control library browser | Filter controls by class, module, or element |
| `assignControlToElements` | Control assignment dialog | Link a control to selected elements |

---

## 8. Security Architecture

### Authentication and authorization

Custom resolvers bypass the `@neo4j/graphql` auto-generated `@authentication` directive. Every resolver method must explicitly:

1. Extract auth context: `authorizationService.extractAuthContext(context)`
2. Check authorization: `authorizationService.checkAuthorization(authContext, { operationName, resourceType, resourceId })`
3. Record metrics: `monitoringService.recordOperation({ operationName, duration, success })`

This follows the established pattern in `TemplateResolverService` and `AnalysisResolverService`. See [Custom Resolver Services](CUSTOM_RESOLVER_SERVICES_DOCUMENTATION.md) for the full shared services architecture and [TemplateResolverService](TEMPLATE_RESOLVER.md) for the reference implementation.

**Current state:** `AuthorizationService.checkAuthorization()` is currently a pass-through stub -- it always returns `{ allowed: true }` because existing resolvers rely on schema-level `@authentication` directives for actual JWT validation. The new custom resolvers bypass `@authentication` (they use direct Cypher, not auto-generated queries), so they depend on this call for protection. Until `checkAuthorization()` implements real authorization logic, the resolvers are authenticated at the GraphQL context level (JWT is validated when the Apollo context is created) but not authorized at the operation level. This is acceptable for initial implementation since all authenticated users currently have full access, but must be addressed before role-based access control is introduced.

### Cypher injection prevention

The `match_classes` resolver dynamically substitutes node labels into Cypher queries via `classLabelToNodeLabel()`. This is a Cypher injection vector if the input is not validated. The resolver must use the same whitelist validation pattern established in `ModuleManagementService` (see [ModuleManagementService](MODULE_MANAGEMENT_SERVICE.md)):

```typescript
private readonly ALLOWED_CLASS_LABELS = new Set([
  'ComponentClass', 'DataFlowClass', 'SecurityBoundaryClass', 'DataClass', 'ControlClass'
]);
```

The `ClassLabelEnum` GraphQL type provides schema-level validation, but the resolver must also validate server-side before interpolating into Cypher -- GraphQL enums can be bypassed via direct Bolt access or future API surface changes.

### Embedding service security

| Concern | Mitigation |
|---------|------------|
| **Embedding endpoint authentication** | `EMBEDDING_API_KEY` sent as Bearer token. Empty for local deployments. |
| **Module trust** | Module authors control class descriptions (embedding input). Adversarial descriptions could attract unrelated elements. Mitigation: modules are installed by platform administrators, not end users. Module review is the trust boundary. |
| **Data exposure** | Embedding text is `"{name}. {description}. Category: {category}. Type: {type}."` -- class metadata only, no user data. Local models (Ollama) keep data on-premises. Cloud providers see only class descriptions. |

---

## 9. Deployment Architecture

### Embedding provider deployment

The embedding service is deployment-configured. No code changes between local and cloud:

| Deployment | Embedding source | Configuration |
|-----------|-----------------|---------------|
| Self-hosted (no AI budget) | Disabled | `EMBEDDING_ENABLED=false`. System works without it -- priorities 1-2-4. |
| Self-hosted (local) | Ollama / LocalAI | `EMBEDDING_URL=http://ollama:11434/api/embeddings`. Add to `docker-compose.yml`. |
| SaaS (cloud) | OpenAI / Bedrock | `EMBEDDING_URL=https://api.openai.com/v1/embeddings`, `EMBEDDING_API_KEY=sk-...` |

### Database requirements

| Capability | Neo4j | Memgraph |
|-----------|-------|----------|
| Deterministic matching (priorities 1-2-4) | Yes | Yes |
| Gap analysis (multi-hop Cypher) | Yes | Yes |
| `findControls` / `assignControlToElements` | Yes | Yes |
| Vector similarity (Priority 3) | **No** (future) | **Yes** (built-in since 3.0) |
| HNSW index | N/A | Built into Memgraph core (not a MAGE add-on) |

---

## 10. Quality Attributes

### Performance targets

| Scenario | Target | Notes |
|----------|--------|-------|
| `match_classes`: 15 elements, 300 classes, deterministic | < 100ms | Priorities 1-2-4 only |
| `match_classes`: 15 elements, 300 classes, with vector | < 500ms | Including batch embedding call |
| `get_control_gaps`: 20 components, 50 exposures | < 200ms | Cypher execution time |
| Module install: 50 classes + embeddings (local) | < 2s | Total ingestion including embedding |
| `controlIdsByElements`: 10 element IDs | < 50ms | Simple Cypher SUPPORTS traversal |

### Scalability

| Dimension | Current | Target | Architecture response |
|-----------|---------|--------|----------------------|
| Module count | 3 | 10-20 | `match_classes` scopes by `moduleIds`, class count bounded by module filtering |
| Classes per module | 30-50 | 30-50 | HNSW search is O(log n), deterministic matching is bounded by module scope |
| Model elements | 15-30 | 50-100 | Batch processing, `LIMIT` on final results, not intermediate matches |
| Exposures per model | 10-50 | 100-500 | Gap analysis batches by element groups for large models |

### Availability and degradation

| Component | Unavailable | System behavior |
|-----------|-------------|-----------------|
| Embedding model | Down | Vector search (Priority 3) skipped. Deterministic matching continues. Logged warning. |
| Embedding model at module install | Down | Module install fails after 3 retries. Clear error message. |
| Graph database | Down | All services fail. Existing platform behavior. |
| Memgraph < 3.0 or Neo4j | Vector search unavailable | Priority 3 skipped (`SHOW VECTOR INDEX INFO` fails). System functional. |

---

## 11. Constraints and Trade-offs

### Constraints

| Constraint | Source | Impact |
|-----------|--------|--------|
| dt-core uses Apollo Client only | Established architecture (all consumers share dt-core) | `findControls` cannot execute Cypher for element filtering; requires `controlIdsByElements` helper query on dt-ws |
| Memgraph polymorphic interface performance | Database limitation (5+ sec on interface queries) | `findControls` and `get_control_gaps` use direct Cypher instead of auto-generated GraphQL for element traversals |
| Vector search Memgraph-only | Built into Memgraph core since 3.0; not available on Neo4j | Priority 3 is skipped on Neo4j; full system functionality maintained via fallback |
| No database type detection | Codebase uses same Bolt driver for Neo4j and Memgraph; no `DATABASE_TYPE` flag | Vector search uses runtime feature detection (`SHOW VECTOR INDEX INFO`) rather than configuration |
| No pre-filter on vector search | Memgraph `vector_search.search()` has no filter parameter | Request 2-3x `topN` results from index, post-filter with `WHERE` in Cypher |
| Non-idempotent index creation | `CREATE VECTOR INDEX` raises error on duplicate | Must check existence via `vector_search.show_index_info()` before creating, or wrap in error handling |
| Embedding model at module install | No partial state allowed (module registry won't re-ingest) | Embedding failure fails the entire module install -- no "install without embeddings" path |
| Authorization pass-through | `AuthorizationService.checkAuthorization()` currently returns `{ allowed: true }` | New resolvers are authenticated (JWT) but not operation-authorized; acceptable until RBAC is introduced |

### Trade-offs

| Trade-off | Chosen | Alternative | Why |
|-----------|--------|-------------|-----|
| **Single generalized match service** vs per-class-type services | Single `match_classes` with `classLabel` param | Separate `match_components`, `match_controls`, etc. | DRY. One pipeline, one embedding strategy, one set of priorities. The `classLabel` → node label mapping is trivial. |
| **Fail module install** vs install without embeddings | Fail after 3 retries | Install without embeddings, log warning | A module installed without embeddings is never re-processed. Frontends that rely on vector search would silently produce degraded results. Explicit failure is honest. |
| **Application-level partitioning** for unaddressable exposures vs complex Cypher `NOT EXISTS` | Application code | Single Cypher query with `NOT EXISTS` | `NOT EXISTS` semantics differ between Neo4j and Memgraph. Two simple queries (one for unmitigated, one to check addressability) are portable and debuggable. |
| **Helper query** for element-based control lookup vs interface query | `controlIdsByElements` Cypher helper on dt-ws | Auto-generated `ControlWhere` with interface filter | Memgraph interface queries take 5+ seconds. Direct Cypher takes < 50ms. The helper adds one extra round-trip but eliminates a known performance pathology. |
| **No fuzzy Levenshtein** in Priority 2 | Substring containment only | Levenshtein edit distance | Character-level edit distance on short identifiers produces false positives ("DB" matching "DeBug"). Substring matching catches the common cases ("Postgres" -> "PostgreSQL", "K8s" -> "Kubernetes"). Ambiguous matches fall through to vector search (Priority 3) or agent reasoning (Pass 2). |

### Offline behavior

| Service | Offline | Fallback |
|---------|---------|----------|
| `match_classes` | No | Existing `get_classes` + agent-side matching via class cache |
| `get_control_gaps` | No | N/A -- inherently post-sync |
| `findControls` | No | Existing `getControls(folderId)` |
| `assignControlToElements` | No | Greenfield name-only references in local JSON |
| `compute_control_coverage` | Partial | Inferred coverage from local attribute files (no platform query) |

---

## 12. Related Documents

### Rationale and design

- [BACKEND_DELEGATION.md](BACKEND_DELEGATION.md) -- Decision framework for backend vs client-side placement; problem statement and scaling analysis
- [CONTROL_INTEGRATION.md](CONTROL_INTEGRATION.md) -- Control workflow design; consumer of gap analysis and coverage services
- [DECISIONS.md](DECISIONS.md) -- D51 (deterministic classification), D30 (STRIDE-to-ATT&CK boundary)

### Implementation specification

- [CLASS_AND_CONTROL_RESOLVER_SPEC.md](CLASS_AND_CONTROL_RESOLVER_SPEC.md) -- Detailed specification: GraphQL types, Cypher queries, method signatures, test strategy, implementation sequence

### System context

- [MCP_ARCHITECTURE.md](MCP_ARCHITECTURE.md) -- MCP server tool system and dt-core integration pattern
- [PLUGIN_ARCHITECTURE.md](PLUGIN_ARCHITECTURE.md) -- Plugin structure, multi-module selection
- [THREAT_MODELING_WORKFLOW.md](THREAT_MODELING_WORKFLOW.md) -- Classification workflow (consumer of `match_classes`)
- [Platform Architecture Overview](../README.md) -- Core design principles and architecture goals

### Backend implementation references

- [Custom Resolver Services](CUSTOM_RESOLVER_SERVICES_DOCUMENTATION.md) -- Shared services architecture (AuthorizationService, MonitoringService), resolver ecosystem, dependency graph
- [TemplateResolverService](TEMPLATE_RESOLVER.md) -- Reference implementation for new resolvers: caching, timeout protection, error handling, monitoring integration
- [ModuleManagementService](MODULE_MANAGEMENT_SERVICE.md) -- Neo4j v5 transaction patterns, `ALLOWED_CLASS_LABELS` whitelist, `upsertClass()` integration point for embedding pipeline
- [GraphQL Module](GRAPHQL_MODULE.md) -- `CustomResolverModule` registration, schema service integration, `resolverServiceClasses` array
- [Database Module](DATABASE_MODULE.md) -- Bolt driver factory, connection pooling, session management, health monitoring
- [Graph Database Schema](SCHEMA.md) -- Node labels, relationship types, and property definitions referenced by all services
