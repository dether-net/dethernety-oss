# Backend Delegation Strategy

> Defines which operations should be server-side (dt-ws backend, exposed via MCP tools) vs client-side (agent logic, local file operations). Applies to classification, enrichment, control integration, and reporting. Status: **draft**.

## Table of Contents

- [1. Problem Statement](#1-problem-statement)
- [2. Decision Framework](#2-decision-framework)
- [3. Current State](#3-current-state)
- [4. Proposed Backend Services](#4-proposed-backend-services)
- [5. Impact on Existing Design](#5-impact-on-existing-design)
- [6. Vector-Enhanced Class Matching](#6-vector-enhanced-class-matching)
- [7. Implementation Notes](#7-implementation-notes)

---

## 1. Problem Statement

### The scaling problem

The Dethernety platform supports a growing module ecosystem. Each module provides classes (ComponentClass, DataFlowClass, SecurityBoundaryClass, ControlClass, DataClass) with attribute templates (JSON Schema, 30-100 fields per class). As the module count grows, client-side class selection does not scale:

| Module count | Classes per module | Total classes | Agent context cost |
|-------------|-------------------|---------------|-------------------|
| 3 (current typical) | ~30-50 | ~100-150 | Manageable |
| 6 (near-term) | ~30-50 | ~200-300 | Context pressure |
| 10-20 (target) | ~30-50 | ~500-1000 | Unworkable |

The problem is not unique to the Claude Code plugin. The Dethernety Studio web UI faces the same challenge — the `BootstrapExistingClasses` component already needs to present relevant classes from a growing pool. Both clients need the same server-side intelligence.

### What breaks at scale

**Classification (current):** The agent calls `get_classes(module_name: 'X')` per active module, receives all classes from each module, and matches unclassified elements by name/type/description in-context. With 500+ classes, the LLM context fills with class metadata before the agent can do actual matching. Each class includes name, description, type, category, and optionally template + guide — ~200-500 tokens per class.

**Control matching (proposed):** The brownfield path calls `manage_controls(list)`, gets all org controls, and filters client-side by `supportedTypes`/`supportedCategories`. With 50+ controls and growing, the same context pressure applies.

**Gap analysis (proposed):** The post-analysis path queries exposures per element (N calls) and countermeasures per control (M calls), then diffs in-context. This is N+M sequential tool calls before the agent starts reasoning.

**Coverage reporting:** The agent reads attribute files, reads control references, optionally queries platform SUPPORTS edges, and computes percentages. LLM arithmetic is unreliable for coverage calculations.

### The pattern

Every case follows the same anti-pattern: **the agent retrieves raw data, processes it locally, and presents a result.** The agent is an LLM — it excels at judgment, conversation, and writing. It is poor at data traversal, filtering, arithmetic, and graph queries. The backend has direct Cypher/Bolt access to the graph database and can do these operations in milliseconds.

---

## 2. Decision Framework

### When to delegate to the backend

An operation should be a backend service when **any** of these apply:

| Criterion | Rationale |
|-----------|-----------|
| **Scales with module/class count** | Don't push scaling to the client. Today's 150 classes become tomorrow's 1000. |
| **Requires graph traversal** | The backend has direct Cypher access. The agent must do sequential MCP tool calls. |
| **Both Studio and CLI need it** | Single implementation, DRY. The backend serves both clients. |
| **Involves arithmetic or aggregation** | LLMs make arithmetic errors. The backend is deterministic. |
| **Result is a filtered/ranked subset** | Sending all data for client-side filtering wastes tokens and turns. |

### When to keep client-side

An operation should remain as agent logic when **all** of these apply:

| Criterion | Rationale |
|-----------|-----------|
| **Requires offline operation** | The plugin works locally until sync. Some operations MUST run without the platform. |
| **Requires conversation context** | The agent knows what the user just said. The backend does not. |
| **Requires judgment** | Deciding which control to recommend for an ambiguous case. Asking follow-up questions. |
| **Is a write to local files** | The agent's primary job is writing structured JSON to disk. |
| **Does not scale with data size** | A fixed-size operation (e.g., writing one attribute file) is fine client-side. |

### The compound test

If an operation is needed by both Studio and CLI, scales with data, requires graph access, and involves aggregation — it belongs in the backend. If it requires offline + conversation + judgment — it stays client-side. Most operations are clearly one or the other. The borderline cases involve hybrid operations (local files + optional platform data).

---

## 3. Current State

### Already server-side (correct placement)

| Operation | Tool | Why it works |
|-----------|------|-------------|
| Attribute stub generation | `generate_attribute_stubs` | Scans structure.json, deduplicates classes, fetches templates via GraphQL, merges into attribute files. One tool call replaces per-element schema extraction. |
| MITRE ATT&CK search | `search_mitre_attack` | Queries 600+ techniques in the graph. Would be unworkable as client-side iteration. |
| MITRE D3FEND lookup | `get_mitre_defend` | Same pattern — graph query, not client enumeration. |
| Model validation | `validate_model_json` | Reads local files + applies structural rules. Hybrid local operation. |
| Model import/export | `import_model`, `export_model` | Bulk graph operations with reference resolution. |

### Currently client-side (should be reconsidered)

| Operation | Current approach | Problem at scale |
|-----------|-----------------|-----------------|
| **Class matching during classification** | Agent calls `get_classes()` per module, matches elements by name/type/description in-context | 500+ classes × N elements in context. Each match requires the LLM to compare one element against all classes. Applies to all 5 class types (component, flow, boundary, data, control). |
| **Control matching (brownfield)** | Agent calls `manage_controls(list)`, filters client-side by class compatibility | 50+ controls with class metadata. Solved by `match_classes(class_type: CONTROL)` + existing `manage_controls(list, class_ids)`. |
| **Control gap analysis** | Agent calls `manage_exposures` per element + `manage_countermeasures` per control, diffs | N+M sequential tool calls before reasoning begins. |
| **Coverage computation** | Agent reads attributes, counts, computes percentages | LLM arithmetic errors in reporting output. |
| **Class guide/template retrieval** | Agent calls `get_classes(class_id, fields: ['guide'])` per class | Sequential calls for each class that needs enrichment. |

---

## 4. Proposed Backend Services

### 4.1 `match_classes` — Class recommendation for elements

**Covers all five class types:** ComponentClass, DataFlowClass, SecurityBoundaryClass, DataClass, and ControlClass. The `class_type` parameter determines which class label to search. This is the single generalized matching service — no separate tool needed per class type.

**Replaces:** Agent-side class matching during Pass 1 (deterministic) classification. Pass 2 (LLM-assisted contextual reasoning) is **not replaced** — the agent still applies boundary context, connected flow analysis, and peer inference to validate and supplement server-side matches. `match_classes` provides ranked hypotheses; the agent validates them.

**Current cost:** For a 15-component model with 6 active modules (~300 classes), the agent makes 6 `get_classes()` calls to load all classes, then reasons over 300 class descriptions to match 15 elements. This is ~10-15 turns and fills context with class metadata.

```
Input: {
  elements: [{
    name: string,
    type: "PROCESS" | "STORE" | "EXTERNAL_ENTITY",
    description?: string,
    boundary_context?: string,     // parent boundary name
    iac_source?: string            // e.g., "aws_rds_instance"
  }],
  class_type: "PROCESS" | "STORE" | "EXTERNAL_ENTITY" | "BOUNDARY" | "DATA_FLOW" | "DATA" | "CONTROL",
  module_ids?: string[],           // active modules (default: all)
  top_n?: number,                  // candidates per element (default: 3)
  fields?: string[]                // optional: ["description", "category", "type"] to include in response
}

Output: {
  matches: [{
    element_name: string,
    candidates: [{
      class_id: string,
      class_name: string,
      class_description?: string,  // included when "description" in fields
      class_category?: string,     // included when "category" in fields
      module_name: string,
      match_type: "iac_mapping" | "exact_name" | "fuzzy_name" | "vector_similarity" | "type_match",
      confidence: "high" | "medium" | "low",
      similarity_score?: number    // 0-1, present when match_type is "vector_similarity"
    }]
  }],
  unmatched: string[]              // elements with no candidates
}
```

**Match priority (highest to lowest):**

| Priority | Match type | Confidence | Example | Cost |
|----------|-----------|------------|---------|------|
| 1 | IaC mapping table | high | `aws_rds_instance` → "Database" | Deterministic lookup |
| 2 | Exact name match | high | "PostgreSQL" → "PostgreSQL" class | Case-insensitive string compare |
| 2b | Fuzzy name match | high | "Postgres" → "PostgreSQL" class | Levenshtein / substring, no AI |
| 3 | Vector similarity | medium | "payment processor backend" → "Web Application" (see Section 6) | Requires embedding index |
| 4 | Type-filtered heuristic | low | STORE element → STORE-typed classes | Returns all type-matching classes |

Priorities 1-2b are deterministic and free. Priority 2b catches common abbreviations and naming variations ("K8s" → "Kubernetes", "Postgres" → "PostgreSQL") without needing embeddings. Priority 3 requires the vector index (optional — see Section 6). Priority 4 is the baseline fallback.

If the vector index is not available, Priority 3 is skipped. Elements that remain unmatched (or matched only at Priority 3-4) are returned in the `unmatched` array or flagged as low-confidence. The agent handles these via **Pass 2 LLM reasoning** — applying boundary context, connected flow analysis, and peer inference that the server-side tool cannot do. This preserves the two-pass methodology: `match_classes` handles Pass 1 (deterministic + semantic), the agent handles Pass 2 (contextual).

**Turn savings:** 6+ `get_classes` calls + in-context matching → 1 tool call. The agent's job shifts from "match all elements" to "confirm high-confidence matches, reason about low-confidence ones."

**The `fields` parameter** (mirroring `get_classes`'s existing `fields` parameter) lets the agent request `description` and `category` in the match response. This eliminates the most common follow-up `get_classes` call — the agent can present meaningful confirmation tables from a single `match_classes` call. Full `template`/`guide` data stays behind `get_classes` (large, needed only after confirmation).

**Studio benefit:** The same endpoint powers the `BootstrapExistingClasses` component — suggest classes as the user names components, without loading the full class catalog client-side.

### Control matching via `match_classes` — no separate tool needed

The brownfield control workflow (finding relevant Controls from the org library) does **not** need a separate `match_controls` backend service. It decomposes into two existing operations:

**Step 1 — Find relevant ControlClasses** via `match_classes(class_type: CONTROL)`:
```
match_classes(
  elements: [{ name: "payment-db", type: "STORE", description: "PostgreSQL..." }],
  class_type: "CONTROL",
  fields: ["description", "type"]
)
→ Returns: "Encryption at Rest" (0.91), "Access Control" (0.85), "Audit Logging" (0.78)
```

**Step 2 — Find Controls that implement those ControlClasses** via existing `manage_controls`:
```
manage_controls(action: 'list', class_ids: ["class-encryption-at-rest", "class-access-control"])
→ Returns: "Database Encryption Package" (implements Encryption at Rest + Access Control),
           "SOC Monitoring" (implements Audit Logging)
```

The existing `manage_controls` tool already accepts `class_ids` as a filter parameter ([manage-controls.tool.ts:48-53](oss/apps/dethereal/src/tools/manage-controls.tool.ts#L48-L53)). The only missing piece was finding the *right* ControlClass IDs — which is exactly what `match_classes` with `class_type: CONTROL` provides.

This eliminates a separate backend service and reuses existing infrastructure. The agent's turn cost is 2 tool calls (match + list), not 1, but both return small, pre-filtered payloads.

**Note:** The discovery workflow above finds relevant controls, but **assigning** controls to elements (creating SUPPORTS edges) still requires a new `assign` action on `manage_controls` and a corresponding `assignControlToElements()` method in `DtControl` (dt-core). This uses the same disconnect/reconnect pattern as `updateControl()` for `controlClasses`. See CONTROL_INTEGRATION.md Section 10, Phase 3 (P3/P3b) for details.

### 4.2 `get_control_gaps` — Framework-grounded gap analysis

**Replaces:** The N+M sequential MCP tool calls for post-analysis gap filling.

The platform has the full MITRE ATT&CK and D3FEND frameworks loaded in the graph database (`mitre-frameworks` module). The backend traverses the full chain in a single Cypher query:

```
Exposure -[:EXPLOITED_BY]-> ATT&CK Technique
  <-[:MITIGATION_DEFENDS_AGAINST_TECHNIQUE]- ATT&CK Mitigation
  <-[:RESPONDS_WITH]- Countermeasure
  <-[:HAS_COUNTERMEASURE]- Control -[:SUPPORTS]-> Element
```

```
Input: {
  model_id: string,
  top_n?: number,                  // max recommended controls (default: 3)
  limit?: number                   // max exposures returned (default: 50, for pagination)
}

Output: {
  unmitigated_exposures: [{
    element_id: string,
    element_name: string,
    exposure_id: string,
    exposure_name: string,
    attack_techniques: [{ id: string, name: string }],
    recommended_mitigations: [{ id: string, name: string }]
  }],
  unaddressable_exposures: [{      // exposures with NO matching ControlClass in any module
    element_id: string,
    exposure_id: string,
    exposure_name: string,
    attack_techniques: [{ id: string, name: string }],
    mitre_mitigations: [{ id: string, name: string }]  // what MITRE recommends, even without a platform match
  }],
  recommended_controls: [{
    control_id?: string,           // existing org control (null if only class match)
    control_name?: string,
    control_class_id: string,
    control_class_name: string,
    d3fend_techniques: [{ id: string, name: string }],
    addresses_count: number,
    elements_affected: [{ id: string, name: string }]
  }],
  coverage_summary: {
    total_exposures: number,
    mitigated: number,
    unmitigated: number,
    unaddressable: number,
    coverage_pct: number
  }
}
```

**`unaddressable_exposures`**: Exposures where the MITRE chain has ATT&CK Mitigations but no ControlClass in any installed module produces matching countermeasures. These are the most valuable gap findings — they indicate module coverage holes. The agent should present these separately: "These 3 exposures have no matching control type in your installed modules. Consider adding module X or creating a custom ControlClass."

**Cypher implementation note:** The traversal must use `OPTIONAL MATCH` on the mitigation chain to distinguish truly unmitigated exposures (no ATT&CK Mitigation exists) from addressable ones (mitigations exist but no Controls implement them). For large models (50+ components, hundreds of exposures), apply the `limit` parameter and consider result pagination.

**Turn savings:** ~20 turns → 1. The agent presents pre-ranked, framework-grounded recommendations.

**Studio benefit:** The same query powers a "control gap dashboard" in the Studio UI — no client-side graph traversal needed.

### 4.3 `compute_control_coverage` — Two-tier coverage reporting

**Replaces:** Agent-side attribute reading, control counting, and percentage computation.

```
Input: {
  directory_path: string,          // local model (for offline/inferred coverage)
  model_id?: string                // platform model (for formal SUPPORTS coverage)
}

Output: {
  inferred: {
    auth: { covered: number, total: number, pct: number },
    encryption_transit: { covered: number, total: number, pct: number },
    encryption_rest: { covered: number, total: number, pct: number },
    monitoring: { covered: number, total: number, pct: number }
  },
  formal: {
    by_tier: [{
      tier: number,
      label: string,
      total: number,
      with_controls: number,
      gap_elements: string[]
    }],
    total_pct: number
  },
  source_breakdown: {
    discovered: number,
    declared: number,
    both: number
  }
}
```

**Execution context:** This is a **hybrid MCP tool** that runs in the MCP server (dethereal), NOT a pure backend service. The local file reads (attribute files, structure.json) happen in the MCP server process, which has filesystem access. The platform query (SUPPORTS edges, formal coverage) is delegated to dt-ws via GraphQL. This distinction matters: dt-ws does not have access to the user's local model directory.

- **Offline** (directory_path only): MCP server reads local attribute files and `controls[]` arrays. Computes inferred coverage + local formal coverage. No platform connectivity needed.
- **Online** (directory_path + model_id): MCP server reads local files AND queries dt-ws for SUPPORTS edge counts and countermeasure coverage.

The agent always gets the same response shape regardless of mode.

**Turn savings:** ~4 turns → 1. Eliminates LLM arithmetic errors in percentage calculations. Can be implemented as an extension to the existing `validate_model_json` tool (which already follows the hybrid MCP pattern).

---

## 5. Impact on Existing Design

### Classification workflow

The `match_classes` service changes **Pass 1** (deterministic classification) from "agent fetches all classes, matches in-context" to "single tool call with pre-ranked results." **Pass 2** (LLM-assisted contextual reasoning) is preserved — the agent applies boundary context, connected flow analysis, and peer inference to elements that `match_classes` returned as unmatched or low-confidence. This maintains the two-pass methodology: server handles data-intensive matching, agent handles judgment-intensive reasoning.

Files affected:

- **`classify/SKILL.md`** — Pass 1 becomes a single `match_classes` call. Pass 2 handles the `unmatched[]` array and `vector_similarity` matches that need contextual validation.
- **`security-enricher.md`** — Classification Protocol Pass 1 (currently lines 88-99) simplifies from "call `get_classes` per module, match by name/type/description" to "call `match_classes`, confirm high-confidence matches." Pass 2 (lines 101-107) remains for contextual reasoning on residuals.
- **`threat-model/SKILL.md`** — Step 3 (Model Review) deterministic classification uses `match_classes` instead of agent-side matching.

The existing `get_classes` tool remains for browsing/exploration (e.g., "show me all Kubernetes classes"). The `match_classes` tool is for the classification workflow.

### Control integration (CONTROL_INTEGRATION.md)

Two of the three backend services (`get_control_gaps`, `compute_control_coverage`) are documented in CONTROL_INTEGRATION.md Section 11. The control matching workflow (previously a proposed `match_controls` service) is now handled by `match_classes(class_type: CONTROL)` + existing `manage_controls(list, class_ids)` — no separate service needed. This document provides the architectural rationale and generalizes the pattern beyond controls.

### Multi-module selection

The `activeModules` scoping (from the multi-module selection design) works in concert with `match_classes`: the tool accepts `module_ids` to scope the search. Without backend delegation, module scoping merely reduces the per-call class count; with `match_classes`, the backend handles module scoping as part of the matching logic.

---

## 6. Vector-Enhanced Class Matching

### Motivation

Deterministic matching (IaC mapping, exact name, fuzzy name) handles the easy cases. But the long tail of classification requires semantic understanding: "payment processor backend" should match "Web Application," "session cache" should match "Key-Value Store," and "customer data warehouse" should match "Data Lake." These are not string matches — they require understanding what an element does, not just what it's called.

The current approach pushes this to the LLM agent (Priority 4 — agent-side reasoning over class descriptions). This works but does not scale: with 500+ classes, the agent cannot hold all descriptions in context. Vector similarity search provides a middle tier — semantic matching without LLM context cost.

### Ingestion architecture: embed before insert

The key design principle is **embed before insert** — vectors are computed before class nodes enter the database. This eliminates eventual consistency concerns: if a class node exists, it already has its embedding. There is no window where a class is queryable by name but not by vector similarity.

**Step 1 — Create the index (once per label):**

```cypher
CREATE VECTOR INDEX class_embeddings ON :ComponentClass(embedding)
  WITH CONFIG {"dimension": 768, "capacity": 500, "metric": "cos"};
```

One index per class label (`ComponentClass`, `ControlClass`, `DataFlowClass`, etc.). Created at platform setup or on first module install. Not idempotent — check existence first via `vector_search.show_index_info()`. Vector search is built into Memgraph core since version 3.0 (not a MAGE add-on).

**Step 2 — Pre-compute embeddings (before inserting module data):**

During module ingestion, before any graph writes:

```
Parse module definition → extract class name, description, category, type
  → Compose embedding text per class:
      "{class_name}. {class_description}. Category: {class_category}. Type: {class_type}."
  → Batch embed all classes in one call → [vector_1, vector_2, ..., vector_n]
```

The embedding is computed externally (local model or cloud API), not by the database. The module ingestion tool holds both the class data and the vectors in memory before writing anything.

**Step 3 — Insert everything at once (UNWIND):**

Data and vectors are written together in a single atomic operation:

```cypher
UNWIND $batch_data AS item
CREATE (c:ComponentClass {
    id: item.id,
    name: item.name,
    description: item.description,
    type: item.type,
    category: item.category,
    embedding: item.vector
})
```

Because the HNSW index already exists on the `embedding` property, Memgraph automatically adds each new node to the USearch vector index in memory as it is created. No separate indexing step. No async pipeline. No `embeddingReady` flag needed.

**Module update:** When a module is updated (classes renamed, descriptions changed), the ingestion tool re-embeds the affected classes and issues `SET c.embedding = $new_vector` on the existing nodes. The HNSW index updates in place.

This follows the same pattern as `mitre-frameworks/ingest.py` — pre-compute all data, then bulk-insert via Cypher. The embedding step adds ~250ms for 50 classes with a local model, negligible compared to the rest of module ingestion.

### Embedding model options

The embedding model is optional and configurable per deployment:

| Deployment | Embedding source | Model | Notes |
|-----------|-----------------|-------|-------|
| Self-hosted (no AI budget) | Disabled | — | No embeddings computed. Falls back to priorities 1-2b-4. System works without it. |
| Self-hosted (local) | Local model | all-MiniLM-L6-v2 (~80MB) or similar | No network dependency, ~5ms per embedding, 384 dimensions. Sufficient for class matching. |
| SaaS | Cloud API | OpenAI, Bedrock Titan, or Cohere embedding API | Highest quality, managed, ~$0.0001 per embedding (fractions of a cent per module install) |

**Cost profile:** Embeddings are computed once per class on module install/update — not per query. A module with 50 classes costs 50 embedding calls. Queries use the pre-computed index.

**Model integrity:** When using a local embedding model, verify the model file against a pinned checksum at load time. A compromised model would taint every classification decision. The platform should bundle the model or download from a pinned URL with integrity verification.

### Query-time flow

At match time, `match_classes` embeds each element's `name + description` and performs a vector similarity search:

```
match_classes(elements: [...], type: PROCESS)
  → Batch embed all element texts in one call
  → For each element: HNSW search across PROCESS-typed classes in active modules
  → Returns ranked candidates with similarity scores
```

**Batch embedding at query time:** When `match_classes` receives N elements, embed all N texts in a single batch call (most embedding APIs and local models support this). For 15 elements with a local model, this is ~5ms total; with a cloud API, one network round-trip.

```cypher
// Query (at match time, per element)
// vector_search.search() takes (index_name, limit, query_vector) — no filter parameter
CALL vector_search.search('class_embeddings', 10, $query_vector)
YIELD node, similarity
WHERE similarity >= 0.75
  AND ($element_type IS NULL OR node.type = $element_type)
RETURN node.id, node.name, node.description, similarity
ORDER BY similarity DESC
LIMIT 5;
```

Neo4j deployments skip vector search entirely (Priority 3 is Memgraph-only for this phase).

### Match priority integration

Vector similarity is Priority 3 in the `match_classes` pipeline:

```
1.  IaC mapping table       → deterministic, confidence: high
2.  Exact name match        → deterministic, confidence: high
2b. Fuzzy name match        → deterministic, confidence: high
3.  Vector similarity       → semantic, confidence: medium (threshold ≥ 0.75)
4.  Type-filtered heuristic → fallback, confidence: low
```

Priorities 1-2b are deterministic and free. Priority 3 replaces most of what the agent currently does in-context. Priority 4 remains as a rare fallback. Elements matched at Priority 3-4 go through Pass 2 agent reasoning for contextual validation.

### What gets embedded

**Classes** (at module install time):
```
"{class_name}. {class_description}. Category: {class_category}. Type: {class_type}."
```
Example: `"PostgreSQL. Open-source relational database management system. Category: Databases. Type: STORE."`

**Elements** (at query time):
```
"{element_name}. {element_description}. Type: {element_type}."
```
Example: `"payment-db. Stores customer payment records and transaction history. Type: STORE."`

### Scope filtering

Vector search is scoped by two dimensions, applied as pre-filters (before the vector search, not after):

1. **Type filtering:** Only search classes whose `type` matches the element's type (PROCESS, STORE, EXTERNAL_ENTITY). Eliminates cross-type false positives.
2. **Module filtering:** When `activeModules` is set, only search classes from those modules. Uses the `module_ids` parameter on `match_classes`.

### Similarity threshold calibration

The 0.75 cosine similarity threshold is a starting value, not an empirically calibrated constant. Different embedding models produce different similarity distributions — 0.75 on `all-MiniLM-L6-v2` is not the same as 0.75 on a cloud API. The threshold should be calibrated against a labeled dataset of element-to-class pairings (constructed from existing models where classification is confirmed). Until calibration data exists, 0.75 is a conservative default that favors precision over recall.

### Generalized matching infrastructure

`match_classes` is already the generalized matching service. It handles all five class types via the `class_type` parameter — one HNSW index per label (`ComponentClass`, `ControlClass`, `DataFlowClass`, `SecurityBoundaryClass`, `DataClass`), one service that targets the right index based on `class_type`. No separate `MatchService` abstraction is needed.

The vector ingestion pipeline during module install embeds all five class types in a single pass — each class node gets an `embedding` property regardless of its label. The HNSW indexes are created per label at platform setup.

### Trust and integrity

**Module trust:** Module authors control class `name`, `description`, and `category` — the fields that get embedded. A poorly-written module could craft descriptions that attract unrelated elements. Module trust is the primary mitigation: modules are installed by platform administrators, not end users. The embedding pipeline does not need adversarial robustness beyond what module review provides.

### Fallback behavior

If embeddings are disabled (no embedding model configured):

- Module ingestion skips the embedding step — class nodes are created without the `embedding` property
- `match_classes` skips Priority 3 (vector search finds no nodes with embeddings) and returns only Priority 1-2b matches
- Unmatched elements are returned in the `unmatched` array for Pass 2 agent reasoning

This makes the vector index a **progressive enhancement**: it improves match quality when available but the system is fully functional without it. There is no "partially available" state — a class either has its embedding (computed atomically at insert) or it doesn't.

---

## 7. Implementation Notes

### Implementation sequencing

The three services have dependencies. `get_control_gaps` only works on models that are classified (requires `match_classes`), enriched, synced, and have controls assigned. The control matching workflow uses `match_classes(class_type: CONTROL)` + existing `manage_controls`, so it depends on `match_classes` shipping first. The implementation order:

```
Phase A: match_classes
  → Unblocks classification scaling for ALL class types (every model, every workflow)
  → Also enables the brownfield control workflow (match_classes + manage_controls)
  → Sub-phases:
      A1: Priority 1-2b (deterministic + fuzzy) — no vector infrastructure needed
      A2: Priority 3 (vector) — add embedding pipeline, HNSW indexes for all 5 class labels

Phase B: compute_control_coverage
  → Extends validate_model_json (independent of match_classes)
  → Can ship in parallel with Phase A

Phase C: get_control_gaps
  → Requires classified + enriched + synced models with controls
  → Ships after match_classes is in use and models have control assignments
```

### Execution contexts

Not all services run in the same place. The architecture has two execution contexts:

| Service | Runs in | Accesses |
|---------|---------|----------|
| `match_classes` | dt-ws (backend) | Graph database (+ embedding model for Priority 3) |
| `get_control_gaps` | dt-ws (backend) | Graph database only |
| `compute_control_coverage` | dethereal (MCP server) | Local filesystem + GraphQL to dt-ws |

The first two are pure backend services: the MCP tool calls a dt-core method which calls a custom GraphQL resolver on dt-ws. The third is a hybrid: the MCP tool reads local model files directly and optionally queries dt-ws for platform data. This matches the existing pattern in `validate_model_json`.

### Implementation approach

Pure backend services (`match_classes`, `get_control_gaps`):

1. **Custom resolver** on dt-ws — the auto-generated GraphQL schema (`@neo4j/graphql`) does not support vector queries or multi-hop traversals. Custom resolvers are an established pattern in the codebase (`custom-resolver.module.ts` already registers 5 resolver services).
2. **dt-core method** — wraps the GraphQL call for the MCP tool
3. **MCP tool** in `dethereal/src/tools/` — input validation, result formatting

Hybrid service (`compute_control_coverage`):

1. **New action** (`action: 'coverage'`) on the existing `validate_model_json` MCP tool — not a separate tool registration
2. Reads local files (attribute files, structure.json) directly
3. Optionally calls dt-ws via GraphQL for SUPPORTS edge counts
4. Computes coverage percentages deterministically (no LLM arithmetic)

### What stays in `get_classes`

The existing `get_classes` tool is **not replaced**. It remains for:
- Browsing available classes ("show me all classes in the Kubernetes module")
- Fetching class templates/guides for enrichment (after classification is done)
- Module discovery ("what modules are installed?")
- `generate_attribute_stubs` continues to use it internally

`match_classes` is a new tool that answers a different question: "given these elements, which classes match best?" vs `get_classes` which answers "what classes exist?"

### Offline considerations

| Service | Offline capability | Fallback |
|---------|-------------------|----------|
| `match_classes` | No — requires platform (class catalog is server-side) | Existing `get_classes` + agent-side matching via class cache |
| `get_control_gaps` | No — requires platform (exposures are analysis outputs) | N/A — this workflow is inherently post-sync |
| `compute_control_coverage` | **Partial** — inferred coverage from local files (runs in MCP server, no platform needed); formal coverage requires platform | Inferred-only mode is fully functional offline |
| Control matching | No — uses `match_classes` + `manage_controls` (both require platform) | Greenfield name-only references in local JSON |

For offline classification, the existing `get_classes` + agent-side matching remains the fallback. The class cache (`.dethereal/class-cache/`) populated by `generate_attribute_stubs` provides limited offline class data. Full offline class matching would require caching the class catalog locally — a potential future enhancement.

---

## Related Documents

- [CONTROL_INTEGRATION.md](CONTROL_INTEGRATION.md) — Section 11: Backend delegation for control-specific operations
- [MCP_ARCHITECTURE.md](MCP_ARCHITECTURE.md) — MCP server tool system and dt-core integration
- [PLUGIN_ARCHITECTURE.md](PLUGIN_ARCHITECTURE.md) — Section 8: Multi-module selection
- [THREAT_MODELING_WORKFLOW.md](THREAT_MODELING_WORKFLOW.md) — Section 4: Component Classification
