# Backend Delegation Strategy

> Defines which operations should be server-side (dt-ws backend, exposed via MCP tools) vs client-side (agent logic, local file operations). Applies to classification, enrichment, control integration, and reporting. Status: **implemented** — the services described here shipped in April 2026. The "(current)" and "(proposed)" labels under "What breaks at scale" describe the pre-delegation workflows this design replaced; they are the problem statement, not open work.

## Table of Contents

- [1. Problem Statement](#1-problem-statement)
- [2. Decision Framework](#2-decision-framework)
- [3. Current State](#3-current-state)
- [4. Backend Services](#4-backend-services)
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

### MITRE tactic coverage derivation

**Decision.** MITRE ATT&CK tactic coverage reported by `/dethereal:surface` §5 is derived from `Exposure.exploitedBy` — the MITRE techniques linked to exposures emitted by OPA policies during platform analysis. The plugin does not maintain a separate client-side technique annotation on component attribute files.

**Rationale.** An earlier version of the enricher wrote `mitre_attack_techniques: string[]` on component attributes using a 3-step anti-hallucination protocol (`search_mitre_attack` → validate → persist). That created a two-source-of-truth problem:
- Policies in installed modules declare `exploited_by: [T1078, T1190, ...]` on each exposure definition, so every fired exposure already carries its MITRE mapping as evidence (OPA policies fired against real attribute values).
- A separate hand-maintained technique list on the component is a guess that can diverge from the evidence, and nothing reconciles the two.

The architecturally consistent choice is evidence-over-guess: derive tactic coverage from `Exposure.exploitedBy` and drop the client-side annotation.

**Escape hatch.** If a component appears vulnerable to a technique that no exposure flags, the correct fix is to add or update a module policy so the OPA rule fires — not to hand-annotate the component. `search_mitre_attack` and `get_mitre_defend` MCP tools remain available for interactive technique lookup (e.g., explaining an exposure-surfaced technique to the user), but are no longer part of routine enrichment.

**Pre-analysis UX.** `/dethereal:surface` §5 requires a synced model with a completed analysis run. Before analysis, it prompts the user to `/dethereal:sync push` and `/dethereal:analyse`. The trade-off — losing pre-analysis technique commentary — is accepted: tactic coverage should reflect evidence, not intent.

---

## 4. Backend Services

### 4.1 `match_classes` — Class recommendation for elements

**Covers all five class types:** ComponentClass, DataFlowClass, SecurityBoundaryClass, DataClass, and ControlClass. The `class_type` parameter determines which class label to search. This is the single generalized matching service — no separate tool needed per class type.

**Replaces:** Agent-side class matching during Pass 1 (deterministic) classification. Pass 2 (LLM-assisted contextual reasoning) is **not replaced** — the agent still applies boundary context, connected flow analysis, and peer inference to validate and supplement server-side matches. `match_classes` provides ranked hypotheses; the agent validates them.

**Current cost:** For a 15-component model with 6 active modules (~300 classes), the agent makes 6 `get_classes()` calls to load all classes, then reasons over 300 class descriptions to match 15 elements. This is ~10-15 turns and fills context with class metadata.

```
Input: {
  elements: [{
    name: string,
    type: "PROCESS" | "STORE" | "EXTERNAL_ENTITY",
    description?: string           // embedded for the vector tier; without it the tier is skipped
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
      match_type: "exact_name" | "fuzzy_name" | "vector_similarity" | "type_match",
      confidence: "high" | "medium" | "low",
      similarity_score?: number    // 1.0 for exact_name, name-overlap ratio for fuzzy_name, cosine for vector_similarity; absent for type_match
    }]
  }],
  unmatched: string[]              // elements with no candidates
}
```

**Match priority (highest to lowest):**

| Priority | Match type | Confidence | Example | Cost |
|----------|-----------|------------|---------|------|
| 1a | Exact name match | high | "PostgreSQL" → "PostgreSQL" class | Case-insensitive string compare |
| 1b | Vector similarity | medium | "payment processor backend" → "Web Application" (see Section 6) | Requires class embeddings |
| 2 | Name containment (`fuzzy_name`) | high | "Orders Relational Database" → "Relational Database" class | Whole-word containment in either direction, no AI |
| 3 | Type-filtered heuristic | low | STORE element → STORE-typed classes | Returns all type-matching classes |

Priorities 1a and 1b run together: exact-name hits come first, then the vector hits not already listed, so a name hit does not keep the vector tier from running. Priorities 2 and 3 run only when 1a and 1b both find nothing. Priorities 1a and 2 are deterministic and free. Priority 2 catches an element name that contains a class name as whole words, or is contained in one ("Orders Relational Database" → "Relational Database"); a word inside a longer word is not a hit, and names shorter than 3 characters are skipped. It does not catch abbreviations or spelling variants ("K8s" → "Kubernetes", "Postgres" → "PostgreSQL"): those are left to the vector tier and to Pass 2. Priority 1b requires class embeddings (optional — see Section 6) and an element description. Priority 3 is the baseline fallback.

If vector search is not available, Priority 1b is skipped. Elements that remain unmatched (or matched only at Priority 1b or 3) are returned in the `unmatched` array or flagged as low-confidence. The agent handles these via **Pass 2 LLM reasoning** — applying boundary context, connected flow analysis, and peer inference that the server-side tool cannot do. This preserves the two-pass methodology: `match_classes` handles Pass 1 (deterministic + semantic), the agent handles Pass 2 (contextual).

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

**Note:** The discovery workflow above finds relevant controls; **assigning** them to elements (creating SUPPORTS edges) is a separate path — the `assign` action on `manage_controls`, wrapping `assignControlToElements()` in `DtControl` (dt-core). Both have shipped.

Its write mechanism is **not** the disconnect/reconnect pattern `updateControl()` uses for `controlClasses`, and must not be changed into it. The method is append-only by contract: it may not remove an element some other caller assigned, so it never disconnects. Because `connect` compiles to a bare relationship CREATE rather than a MERGE, idempotency instead comes from reading the currently-attached ids and connecting only the difference — the read is load-bearing, not defensive scaffolding, and its coverage must stay a superset of the write's — [dt-control.ts:430-434](../../../packages/dt-core/src/dt-control/dt-control.ts#L430-L434) states that pairing at the construction site. See CONTROL_INTEGRATION.md Section 10, Phase 3 (P3/P3b) for details.

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

Deterministic matching (exact name, name containment) handles the easy cases. But the long tail of classification requires semantic understanding: "payment processor backend" should match "Web Application," "session cache" should match "Key-Value Store," and "customer data warehouse" should match "Data Lake." These are not string matches — they require understanding what an element does, not just what it's called.

The current approach pushes this to the LLM agent (Priority 3 — agent-side reasoning over class descriptions). This works but does not scale: with 500+ classes, the agent cannot hold all descriptions in context. Vector similarity search provides a middle tier — semantic matching without LLM context cost.

### Ingestion architecture: embed before insert

The key design principle is **embed before insert** — vectors are computed before class nodes enter the database. This eliminates eventual consistency concerns: if a class node exists, it already has its embedding. There is no window where a class is queryable by name but not by vector similarity.

**Step 1 — No vector index:**

Class vectors need no index. The query scores every candidate class with the database's own cosine function (see *Query-time flow*), so there is nothing to create, size or repair before the first install. This works on Memgraph 3.6+ and on Neo4j 5.26 Community.

**Step 2 — Pre-compute embeddings (before inserting module data):**

During module ingestion, before any graph writes:

```
Parse module definition → extract class name, description, category, type
  → Compose embedding text per class:
      "{class_name}. {class_description}. Category: {class_category}. Type: {class_type}."
  → Batch embed all classes in one call → [vector_1, vector_2, ..., vector_n]
```

The embedding is computed outside the database (by the in-process embedder or an HTTP embedding endpoint, see *Embedding model options*). The module ingestion tool holds both the class data and the vectors in memory before writing anything.

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

Because the search reads the `embedding` property directly, a class is searchable as soon as the write commits. No separate indexing step. No async pipeline. No `embeddingReady` flag needed.

**Module update:** When a module is updated (classes renamed, descriptions changed), the ingestion tool re-embeds the affected classes and issues `SET c.embedding = $new_vector` on the existing nodes. The next search reads the new vector.

This follows the same pattern as `mitre-frameworks/ingest.py` — pre-compute all data, then bulk-insert via Cypher. The embedding step adds ~250ms for 50 classes with a local model, negligible compared to the rest of module ingestion.

### Embedding model options

The embedding model is optional and configurable per deployment. `EMBEDDING_MODEL` names an **embedding profile**, which fixes the model, its prompts, its dimensions and its similarity thresholds (see [Class and control resolver architecture → Embedding service architecture](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#embedding-service-architecture)):

| Deployment | Embedding source | Model | Notes |
|-----------|-----------------|-------|-------|
| No embeddings | Disabled | — | No embeddings computed. Falls back to priorities 1a, 2 and 3. System works without it. |
| In-process | A built-in ONNX profile, run inside dt-ws | EmbeddingGemma variants, 768 dimensions | No embedding service to run. Weights are fetched once and verified before use; until they are loaded the vector tier is off. |
| HTTP endpoint | Ollama `/api/embed` or an endpoint that takes the same request and answers in Ollama or OpenAI format | `embeddinggemma` (the default), or any model the endpoint serves | No prompts. A model that is not a built-in profile runs under the `embeddinggemma` profile's thresholds unless they are overridden. |

**Cost profile:** Embeddings are computed once per class on module install/update — not per query. A module with 50 classes costs 50 embedding calls. Queries use the pre-computed vectors.

**Model integrity:** A built-in in-process profile pins the weights' repository revision and each file's size and sha256; the files are verified before the model is loaded. A compromised model would taint every classification decision. An HTTP endpoint is trusted as configured.

### Query-time flow

At match time, `match_classes` embeds each element that has a description (its name, description and type, as a query under the profile's query prompt) and performs a vector similarity search:

```
match_classes(elements: [...], classLabel: COMPONENT, componentType: PROCESS)
  → For each element with a description: embed its text as a query (one call per element)
  → Exact cosine search across PROCESS-typed classes in active modules, at or above the classes threshold
  → Returns ranked candidates with similarity scores
```

**Embedding at query time:** Each element with a description is embedded in its own call, including elements that also have an exact-name hit. Elements without a description skip the vector tier.

```cypher
// Query (at match time, per element); no vector index, every candidate is scored
MATCH (m:Module)-[:HAS_CLASS]->(n:ComponentClass)
WHERE n.embeddingModel = $profileId AND size(n.embedding) = $dims
  AND ($componentType IS NULL OR n.type = $componentType)
WITH n, vector_search.cosine_similarity(n.embedding, $query_vector) AS similarity
WHERE similarity >= $threshold
RETURN n.id, n.name, n.description, similarity
ORDER BY similarity DESC, n.id ASC
LIMIT $k;
```

On Neo4j the score is `2 * vector.similarity.cosine(a, b) - 1` (Neo4j returns `(1 + cos) / 2`), so scores and thresholds are cosines on both engines. Only vectors of the active embedding profile are compared. See [Class and control resolver spec → Vector tier](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_SPEC.md#vector-tier-optional-requires-embeddings).

### Match priority integration

Vector similarity is Priority 1b in the `match_classes` pipeline and runs together with exact name match:

```
1a. Exact name match        → deterministic, confidence: high   (listed first)
1b. Vector similarity       → semantic, confidence: medium (threshold per embedding profile; runs with 1a, hits follow 1a's)
2.  Name containment        → deterministic, confidence: high   (only when 1a and 1b find nothing)
3.  Type-filtered heuristic → fallback, confidence: low
```

Priorities 1a and 2 are deterministic and free. Priority 1b replaces most of what the agent currently does in-context. Priority 3 remains as a rare fallback. Elements matched at Priority 1b or 3 go through Pass 2 agent reasoning for contextual validation.

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

Vector search is scoped by two dimensions. Both are ordinary `WHERE` filters applied before ranking, since the search scores every candidate:

1. **Type filtering:** When `componentType` (PROCESS, STORE, EXTERNAL_ENTITY) is given, which is allowed only for COMPONENT, only classes of that type are kept. Eliminates cross-type false positives. The element's own type is part of the embedded text, not a filter.
2. **Module filtering:** When `activeModules` is set, only classes from those modules are kept. Uses the `module_ids` parameter on `match_classes`.

### Similarity threshold

The threshold is a cosine floor that depends on the **embedding profile** and on the **corpus**. Different embedding models produce different similarity distributions, so the same cosine means different things under different models. Each built-in profile therefore carries its own thresholds, one for class search and one for MITRE technique search, calibrated per profile on a set of class and ATT&CK technique retrieval queries: the highest threshold at which at least 99% of the queries that find an expected match in their top 3 results with no threshold still find one.

A deployment can override the threshold per corpus (`EMBEDDING_THRESHOLD_CLASSES`, `EMBEDDING_THRESHOLD_MITRE`); the legacy `EMBEDDING_SIMILARITY_THRESHOLD` still applies to the HTTP embedder only. See [Class and control resolver architecture → Similarity threshold](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md#similarity-threshold) for the resolution order.

### Generalized matching infrastructure

`match_classes` is already the generalized matching service. It handles all five class types via the `class_type` parameter — one service that searches the right label (`ComponentClass`, `ControlClass`, `DataFlowClass`, `SecurityBoundaryClass`, `DataClass`) based on `class_type`. No separate `MatchService` abstraction is needed.

The vector ingestion pipeline during module install embeds all five class types in a single pass — each class node gets an `embedding` property regardless of its label.

### Trust and integrity

**Module trust:** Module authors control class `name`, `description`, and `category` — the fields that get embedded. A poorly-written module could craft descriptions that attract unrelated elements. Module trust is the primary mitigation: modules are installed by platform administrators, not end users. The embedding pipeline does not need adversarial robustness beyond what module review provides. Two further mitigations bound the blast radius if a low-quality module slips through review: `top_n` is capped at 3 (a single bad embedding cannot drown out legitimate matches), and the agent's Pass 2 validates `vector_similarity` matches against boundary context and connected flows before acceptance — semantic suggestions are treated as hypotheses, not assertions.

### Fallback behavior

If embeddings are disabled (no embedding model configured):

- Module ingestion skips the embedding step — class nodes are created without the `embedding` property
- `match_classes` skips Priority 1b (no class in scope has a vector of the active profile) and returns only deterministic matches
- Unmatched elements are returned in the `unmatched` array for Pass 2 agent reasoning

This makes vector search a **progressive enhancement**: it improves match quality when available but the system is fully functional without it. A class either has its embedding (computed atomically at insert) or it doesn't.

---

## 7. Implementation Notes

### Implementation sequencing

The three services have dependencies. `get_control_gaps` only works on models that are classified (requires `match_classes`), enriched, synced, and have controls assigned. The control matching workflow uses `match_classes(class_type: CONTROL)` + existing `manage_controls`, so it depends on `match_classes` shipping first. The implementation order:

```
Phase A: match_classes
  → Unblocks classification scaling for ALL class types (every model, every workflow)
  → Also enables the brownfield control workflow (match_classes + manage_controls)
  → Sub-phases:
      A1: deterministic tiers (exact + fuzzy name) — no vector infrastructure needed
      A2: vector tier — add embedding pipeline and exact vector search for all 5 class labels

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
| `match_classes` | dt-ws (backend) | Graph database (+ embedding model for the vector tier) |
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
