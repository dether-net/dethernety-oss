# Classification Workflow Enhancement — Server-Side Class Matching

> Plugin-side integration of the `match_classes` backend service into the classification workflow. Replaces the N*M sequential `get_classes` loop with single-call batch matching. Status: **draft**.

## Table of Contents

- [1. Problem Statement](#1-problem-statement)
- [2. Current Workflow](#2-current-workflow)
- [3. Target Workflow](#3-target-workflow)
- [4. Changes by File](#4-changes-by-file)
- [5. Control Matching Integration](#5-control-matching-integration)
- [6. Backward Compatibility](#6-backward-compatibility)
- [7. Implementation Phasing](#7-implementation-phasing)
- [8. Known Considerations](#8-known-considerations)

---

## 1. Problem Statement

The classification workflow (Pass 1 — deterministic) calls `get_classes` per module per class type. With M active modules and up to 5 class types, this produces M*5 sequential GraphQL calls. Today at M=3, that is 15 calls. At the target scale of 10-20 modules, it becomes 50-100 calls — each loading class definitions into the context window, each consuming a tool turn.

The `match_classes` backend service (#136, #139, #140) solves this: it accepts a batch of elements and returns ranked class candidates in a single call, using a multi-priority pipeline (exact name → fuzzy name → vector similarity → type heuristic). The service is live and tested. The plugin does not yet use it.

### What this changes

| Aspect | Before | After |
|--------|--------|-------|
| Pass 1 tool calls | M*5 `get_classes` calls (15-100) | 1-5 `match_classes` calls (one per class label) |
| Matching logic | Agent-side name comparison in context | Server-side multi-priority pipeline with optional vector similarity |
| Context window usage | All class definitions loaded into context | Only ranked candidates returned |
| Unmatched handling | Agent re-queries with broadened module scope | `unmatched[]` array feeds directly into Pass 2 |
| Turn budget | 15-100 turns for class retrieval alone | 1-5 turns for retrieval, remaining budget for reasoning |

### What this does NOT change

- **Pass 2 (LLM-assisted reasoning)** — unchanged. Agent validates candidates, applies boundary context, connected flow analysis, and peer inference
- **`get_classes` tool** — still available for browsing/exploration ("what classes exist in this module?"). Not deprecated
- **Classification quality gates** — unchanged (100% STORE, 80% overall)
- **Crown jewel tagging** — unchanged
- **Two-pass methodology** — preserved. Server handles data-intensive matching, agent handles judgment-intensive reasoning

---

## 2. Current Workflow

### Classify skill (SKILL.md, Step 3)

```
Pass 1 — Deterministic Classification:
  1. Read activeModules from scope.json
  2. For EACH active module:
       get_classes(module_name: '<name>')     ← one call per module
     If activeModules absent:
       get_classes()                          ← all modules, all types
  3. Match each unclassified element against all returned classes
  4. Mark high-confidence matches
```

The skill loads the entire class catalog into the agent's context, then the agent does name matching. For a model with 15 components and 3 modules (each with ~40 classes across all types), this means:
- 3 `get_classes` calls (one per module)
- ~120 class definitions in context
- Agent compares 15 element names against 120 classes

### Security-enricher agent (Classification Protocol)

The enricher has its own copy of the same classification protocol (used when classification is invoked during enrichment). Same N*M pattern.

### Quality gate broadening (Step 7)

When classification falls short of quality gates, the skill tries broadening:
```
For each unclassified element:
  get_classes()    ← without module filter, searches all installed modules
```

This adds another round of full-catalog retrieval per unmatched element.

---

## 3. Target Workflow

### Pass 1 — Server-side matching

Replace the per-module `get_classes` loop with batch `match_classes` calls, one per class label that has unclassified elements:

```
Pass 1 — Deterministic Classification:
  1. Read activeModules from scope.json → extract moduleIds
  2. Inventory unclassified elements by type:
     - components (PROCESS, STORE, EXTERNAL_ENTITY)
     - boundaries
     - data flows
     - data items
  3. For each class label with unclassified elements:
       match_classes(
         elements: [{ name, type, description }],    ← batch
         classLabel: COMPONENT | SECURITY_BOUNDARY | DATA_FLOW | DATA,
         moduleIds: [...activeModuleIds],
         topN: 3,
         fields: ['description', 'category', 'type']
       )
     → Returns: matches[] (ranked candidates per element) + unmatched[]
  4. Auto-accept high-confidence exact matches (matchType: exact_name)
  5. Present medium/low-confidence matches for confirmation
  6. Collect unmatched[] → feed to Pass 2
```

**Component sub-types:** Components have three sub-types (PROCESS, STORE, EXTERNAL_ENTITY). Send all components together in one call without `componentType` filter. The `topN: 3` limit constrains response size, and exact/fuzzy matching naturally returns type-appropriate candidates ("PostgreSQL" matches "Database", not "API Gateway"). The optional `componentType` parameter exists on the backend for future use if needed, but the default flow does not use it.

### Pass 2 — LLM-assisted reasoning (unchanged)

For elements in `unmatched[]` or matched at low confidence:

```
Pass 2 — LLM-Assisted Classification:
  1. Boundary context (which boundary, what siblings)
  2. Connected flows (protocols, data types)
  3. Peer inference (if siblings are all "Microservice", unclassified sibling likely is too)
  4. Propose the closest class from match_classes candidates or agent knowledge
  5. Never fabricate class IDs — only use IDs returned by match_classes or get_classes
```

The agent has the `candidates[]` from Pass 1 available — even low-confidence matches may be correct with additional context. The agent does not need to re-query the backend.

### Quality gate broadening

When classification falls below gates:

```
Broadening:
  match_classes(
    elements: [... still-unclassified elements ...],
    classLabel: COMPONENT,
    moduleIds: null,              ← search ALL installed modules
    topN: 3
  )
  → If matches found in inactive modules:
    "Adding modules [Kubernetes, Azure] would classify 2 more elements. Add?"
```

One call replaces per-element `get_classes` queries. The `moduleName` field on each candidate tells the agent which module to suggest adding.

### `get_classes` — retained for follow-up

`get_classes` remains the tool for:
- **Attribute template retrieval:** `get_classes(class_id: '...', fields: ['attributes', 'guide'])` fetches the full JSON Schema template and configuration guide for a specific class. `match_classes` returns `description`/`category`/`type` but not the full template — it's a matching tool, not a browsing tool.
- **Class exploration:** "What classes does the Kubernetes module provide?" — a browsing question, not a matching question.
- **Offline fallback:** When `match_classes` fails (platform unreachable), fall back to cached class data from `generate_attribute_stubs` or skip Pass 1 entirely (existing behavior).

The division is: **`match_classes`** answers "which classes fit these elements?" and **`get_classes`** answers "what does this class look like?"

---

## 4. Changes by File

### 4.1 Classify skill — `skills/classify/SKILL.md`

**Step 3 (Pass 1):** Replace the `get_classes` loop.

Current (lines 48-53):
```
2. For each active module, call get_classes(module_name) to fetch class types
   scoped to that module. If activeModules absent, call get_classes without
   module filter.
3. Prefer specialized modules over baseline module
4. Match by name, type, description against available classes from active modules
5. Use IaC pre-classification from discovery.json
```

Target:
```
2. Extract moduleIds from activeModules in scope.json (order matters — see tiebreaking)
3. Group unclassified elements by class label (component, boundary, flow, data)
4. For each label with unclassified elements, call:
     match_classes(elements: [...], classLabel: <label>, moduleIds: [...], topN: 3,
                   fields: ['description', 'category', 'type'])
5. Cross-module tiebreaking: when multiple modules return same-confidence matches
   for the same element, prefer the module listed earlier in activeModules (user-set
   priority order). Specialized modules should precede baseline (dethernety-module).
   This is MCP-side post-processing on match_classes results.
6. For IaC-discovered elements, check discovery.json sources — if pre-classification
   exists and matches a match_classes candidate, boost confidence to 'high (IaC)'
7. Auto-accept exact_name matches (high confidence)
8. Present fuzzy/vector/type matches for confirmation
```

**Step 5 (quality gate broadening, line 64):** Replace per-element `get_classes` without module filter.

Current:
```
call get_classes without a module filter. If match found in inactive module, flag it.
```

Target:
```
call match_classes(elements: [...unclassified...], classLabel: <label>, topN: 3)
without moduleIds. If match found in inactive module, flag it — moduleName is on
each candidate.
```

**Step 7 (quality gate, line 118):** Same change — broadening uses `match_classes` without `moduleIds`.

### 4.2 Security-enricher agent — `agents/security-enricher.md`

**Classification Protocol, Pass 1 (lines 91-97):** Same replacement as the classify skill.

Current:
```
2. For each active module, call get_classes(module_name)
4. Match unclassified elements by name, type, description
```

Target:
```
2. Extract moduleIds from scope.json
3. For each class label with unclassified elements:
     match_classes(elements: [...], classLabel: <label>, moduleIds: [...], topN: 3)
4. Auto-accept exact_name matches, present others for confirmation
```

**Pass 2 (lines 103-107):** Replace broadening `get_classes` call.

Current:
```
4. broaden: call get_classes without module filter
```

Target:
```
4. broaden: call match_classes without moduleIds
```

### 4.3 Threat modeling workflow — `THREAT_MODELING_WORKFLOW.md`

**Section 4 (Component Classification, line 477):** Update the Pass 1 description.

Current:
```
Query get_classes(action: 'classify_components') with { name, type, description,
discovery_source }. The MCP tool performs deterministic fuzzy matching...
```

Target:
```
Call match_classes(elements: [...], classLabel: COMPONENT, moduleIds: [...]) to
batch-match all unclassified components against the class catalog. The backend
performs multi-priority matching (exact name, fuzzy name, vector similarity,
type heuristic) and returns ranked candidates per element.
```

**D51 note (line 484):** Update the token savings estimate. The savings are larger with `match_classes` — the agent no longer receives the full class catalog, only ranked candidates.

### 4.4 Infrastructure-scout agent — `agents/infrastructure-scout.md`

No changes. The scout's `recommendedModules` and source-type→module mapping table feed into `activeModules` in scope.json, which provides the `moduleIds` parameter to `match_classes`. The scout does not call `get_classes` or `match_classes` directly.

### 4.5 MCP tools — no changes

`match_classes` tool (#140) is already implemented and registered. `get_classes` tool remains unchanged.

---

## 5. Control Matching Integration

Control class matching is a special case of the same workflow, using `classLabel: CONTROL`. The [CONTROL_INTEGRATION.md](CONTROL_INTEGRATION.md) Section 6.3 defines a three-layer ranking architecture:

```
1. Schema @cypher query (controlCandidatesForType):
   → Returns controls with matching supportedTypes, countermeasure counts, assigned elements
2. MCP tool (manage_controls action: 'rank'):
   → Enriches with local element context, scores, returns top N pre-ranked
3. Agent: present table, ask yes/no
```

The multi-class relevance evaluation (previously an unbounded agent reasoning loop) is now a deterministic MCP tool computation. See CONTROL_INTEGRATION.md Section 6.3 for the scoring formula.

This is a consumer of `match_classes`, not a modification to it. The control enrichment focus mode (`--focus controls`) invokes this flow during the control pass. The classify skill does not handle control classes — controls are assigned during enrichment (Phase 2 of CONTROL_INTEGRATION.md), not during classification.

---

## 6. Backward Compatibility

### Offline fallback

When `match_classes` fails (platform unreachable or error):
- **Fall back to `get_classes`** if the platform is reachable but the custom resolver is unavailable (version mismatch between plugin and backend)
- **Skip Pass 1 entirely** if the platform is unreachable — same as current behavior. All classification happens in Pass 2

The classify skill should attempt `match_classes` first and fall back based on the tool result:

```
// In the skill's Pass 1 logic (agent instructions):
1. Call match_classes(...)
2. If the result contains { success: false } or an error message → fall back to
   get_classes per module (current behavior)
3. If get_classes also returns errors → skip Pass 1, all classification in Pass 2
```

Note: the agent observes tool results, not exceptions. The fallback instruction is phrased in terms the agent can act on — `success: false` in the response, not try/catch.

**Cascading fallback warning:** If both `match_classes` and `get_classes` fail (platform fully unreachable), the agent should surface this to the user: "Platform connectivity issues — classification running in LLM-only mode. Re-run with platform access for server-side matching." This prevents silent quality degradation when multiple subsystems fall back simultaneously.

### `activeModules` absent

When `scope.json` has no `activeModules` field (old models or backward compatibility):
- Call `match_classes` without `moduleIds` — searches all installed modules
- Same behavior as current "call `get_classes` without module filter"

### Pre-classification from discovery

IaC-discovered elements with `sources` in `discovery.json` may have pre-classification from the infrastructure-scout's IaC mapping table. These should be cross-referenced against `match_classes` results:
- If the scout's pre-classification matches a `match_classes` candidate → boost to `high (IaC)` confidence
- If they differ → present both options in the confirmation table, note the discrepancy

This is the same logic as today — the data source changes (from `get_classes` to `match_classes`), not the decision logic.

---

## 7. Implementation Phasing

### Phase 1 — Classify skill migration

Update the classify skill (`SKILL.md`) to use `match_classes` for Pass 1. This is the primary consumer and the highest-impact change.

| Item | File | Description |
|------|------|-------------|
| C1 | `skills/classify/SKILL.md` | Replace Pass 1 `get_classes` loop with `match_classes` batch calls. Update quality gate broadening. |
| C2 | `skills/classify/SKILL.md` | Add offline fallback: try `match_classes` → fall back to `get_classes` → skip Pass 1. |

### Phase 2 — Enricher agent alignment

Synchronize the security-enricher's classification protocol with the skill changes.

| Item | File | Description |
|------|------|-------------|
| C3 | `agents/security-enricher.md` | Update Classification Protocol (Pass 1 + Pass 2 broadening) to use `match_classes`. |

### Phase 3 — Documentation alignment

Update architecture docs to reflect the new flow.

| Item | File | Description |
|------|------|-------------|
| C4 | `THREAT_MODELING_WORKFLOW.md` | Update Section 4 (Component Classification) and D51 note. |
| C5 | `README.md` | Update MCP tool count (22) if not already done. |

### Dependencies

```
Phase 1 (C1, C2) — standalone, can ship independently
     │
     └── Phase 2 (C3) — must align with Phase 1 changes
              │
              └── Phase 3 (C4, C5) — documentation cleanup
```

No backend changes required — `match_classes` is already live.

### Relationship to CONTROL_INTEGRATION.md phasing

C1 is on the **critical path** for control integration. The control focus mode (P4) depends on `match_classes` being in the plugin vocabulary — the control enrichment instructions use `match_classes(classLabel: CONTROL)` for brownfield ControlClass matching, and the MCP `rank` action on `manage_controls` (P5c) builds on the same pattern. The cross-document dependency:

```
C1 (classify skill) ──→ P4/P5 (control focus mode)
P2 (quality score)  ──→ P4/P5 (control focus mode)
                         │
                         ▼
                    P1/P6 (platform integration)
```

C1 and P2 can run in parallel. P4 requires both. See CONTROL_INTEGRATION.md Section 10 for the full dependency diagram.

---

## 8. Known Considerations

### 8.1 IaC mapping table removal

The backend spec ([CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md) Section 4.1) notes: "No IaC mapping table. Dropped during review — the same results are achieved by exact/fuzzy name matching against class names." The infrastructure-scout still has its own source-type→module mapping table for `recommendedModules`, but it does not do class-level mapping. IaC pre-classification confidence comes from the scout's `classificationConfidence` field in `discovery.json`, not from a separate IaC→class table.

If exact/fuzzy name matching produces worse results than the scout's IaC mappings for specific technologies (e.g., `aws_rds_instance` → "Database" is trivial but `aws_elasticache_replication_group` → "Cache Cluster" requires domain knowledge), the agent's Pass 2 reasoning covers the gap — the scout's pre-classification is available in `discovery.json` as a hint.

### 8.2 Confirmation table format change

The current classification table shows a flat `Proposed Class` column. With `match_classes`, the table can show richer information from the `fields` parameter:

```
| # | Element | Type | Proposed Class | Module | Confidence | Match |
|---|---------|------|----------------|--------|------------|-------|
| 1 | Redis | STORE | Key-Value Store | dethernety-module | high | exact |
| 2 | PostgreSQL | STORE | Database | Databases | high | exact |
| 3 | Auth0 | EXT | Identity Provider | dethernety-module | medium | fuzzy |
| 4 | gRPC Handler | PROCESS | — | — | — | unmatched |
```

The `matchType` column (exact/fuzzy/vector/type) helps users understand why a class was proposed — "exact" means the name matched directly, "vector" means semantic similarity. This is more transparent than the current "high/medium/low" confidence labels.

### 8.3 Cross-module class conflicts

When multiple active modules return same-confidence matches for the same element (e.g., both the baseline `dethernety-module` and a Kubernetes module define a "Database" class), the agent needs a tiebreaker. The backend returns `moduleName` per candidate but has no module priority concept.

**Tiebreaker rule:** Prefer the module listed earlier in `activeModules` from `scope.json`. The user sets this order during module selection (the infrastructure-scout places specialized modules first, baseline module last). This is MCP-side post-processing — the agent re-orders same-confidence candidates by `activeModules` position before presenting the confirmation table.

### 8.4 Vector similarity quality

When vector search is enabled (Memgraph with embeddings), Priority 3 candidates may surface classes that are semantically related but technically inappropriate. For example, "API Gateway" might vector-match to "Load Balancer" (both are network infrastructure). The `confidence: medium` and `matchType: vector_similarity` signals tell the agent (and user) that this is a semantic suggestion, not a deterministic match. Pass 2 reasoning should treat vector matches as hypotheses, not assertions.

Module trust is the appropriate security boundary for vector matching: module authors control the class names and descriptions that generate embeddings, and modules are installed by platform administrators, not end users. An adversarial module could craft descriptions that attract inappropriate matches, but the blast radius is limited by `topN: 3` and the agent's Pass 2 validation.

### 8.5 Class template retrieval after matching

`match_classes` returns `description`, `category`, `type` per candidate — enough for the confirmation table. But after the user confirms a classification, the agent needs the full template (JSON Schema) and guide to write attribute stubs. This is already handled by `generate_attribute_stubs` (called at Step 8 of the classify skill), which fetches templates via `get_classes(class_id)` internally. No change needed.

### 8.6 Turn budget savings

The primary benefit is turn budget, not latency. Each `get_classes` call consumes one agent turn (tool call + response processing). With 3 modules, Pass 1 uses 3-15 turns just for class retrieval. With `match_classes`, it uses 1-5 turns (one per class label that has unclassified elements). For a typical model with components, flows, and boundaries, that is 3 calls instead of 9-15.

The saved turns are available for Pass 2 reasoning, confirmation interactions, and quality gate checks — activities that improve classification quality rather than just retrieving data.

---

## Related Documents

- [THREAT_MODELING_WORKFLOW.md](THREAT_MODELING_WORKFLOW.md) — Section 4: Component Classification, D51 (deterministic classification)
- [CONTROL_INTEGRATION.md](CONTROL_INTEGRATION.md) — Section 6.3: Multi-class control evaluation (consumer of `match_classes(classLabel: CONTROL)`)
- [CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md) — Section 4.1: match_classes service architecture
- [CLASS_AND_CONTROL_RESOLVER_SPEC.md](../backend/LLD/CLASS_AND_CONTROL_RESOLVER_SPEC.md) — Section 3: match_classes specification (GraphQL types, Cypher queries, priorities)
- [PLUGIN_ARCHITECTURE.md](PLUGIN_ARCHITECTURE.md) — Section 8: Multi-module selection
- [DECISIONS.md](DECISIONS.md) — D51 (deterministic classification), D64 (no default agent)
