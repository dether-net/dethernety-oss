# Backend Services Specification

> Detailed specification for new backend services on the Dethernety platform (dt-ws + dt-core). These services support both the Claude Code plugin (Dethereal) and the Dethernety web UI. Implementable independently from plugin changes. Status: **implemented** — all four services and the embedding pipeline shipped in April 2026. The test strategy in §9 did not land as specified; read §9's as-built table for the coverage that exists and the gaps still open.

## Table of Contents

- [1. Overview](#1-overview)
- [2. Graph Schema Reference](#2-graph-schema-reference)
- [3. Service 1: match_classes](#3-service-1-match_classes)
- [4. Service 2: get_control_gaps](#4-service-2-get_control_gaps)
- [5. Service 3: findControls (dt-core)](#5-service-3-findcontrols-dt-core)
- [6. Service 4: assignControlToElements (dt-core)](#6-service-4-assigncontroltoelements-dt-core)
- [7. Embedding Pipeline](#7-embedding-pipeline)
- [8. Implementation Sequence](#8-implementation-sequence)
- [9. Testing Strategy](#9-testing-strategy)

---

## 1. Overview

### What and why

The Dethernety platform needs three new backend services and two new dt-core methods. These serve two clients:

1. **Dethereal** — Claude Code plugin, consumes via MCP tools wrapping dt-core methods
2. **Dethernety GUI** — web UI, consumes via GraphQL queries directly

The services solve a scaling problem: as the module ecosystem grows (3 modules today, 10-20 target), client-side class matching, control gap analysis, and coverage computation become unworkable. These operations require graph traversals, aggregation, and filtering that the backend handles in milliseconds.

### Service inventory

| Service | Layer | Type | Consumers |
|---------|-------|------|-----------|
| `match_classes` | dt-ws custom resolver | GraphQL query | MCP tool + GUI |
| `get_control_gaps` | dt-ws custom resolver | GraphQL query | MCP tool + GUI |
| `findControls` | dt-core method | GraphQL query wrapper | MCP tool (`manage_controls`) |
| `assignControlToElements` | dt-core method | GraphQL mutation wrapper | MCP tool (`manage_controls`) |

Additionally, the **embedding pipeline** (Section 7) extends module ingestion to support vector-enhanced class matching. This is optional — all services work without it.

### Existing patterns to follow

| Pattern | Reference implementation | Location |
|---------|------------------------|----------|
| Custom resolver service | `TemplateResolverService` | `dt-ws/src/gql/resolver-services/template-resolver.service.ts` |
| Custom resolver registration | `CustomResolverModule` | `dt-ws/src/gql/custom-resolver.module.ts` |
| dt-core query method | `DtIssue.findIssues()` | `dt-core/src/dt-issue/dt-issue.ts` (lines 83-173) |
| dt-core mutation with disconnect/connect | `DtControl.updateControl()` | `dt-core/src/dt-control/dt-control.ts` (lines 190-272) |
| Module ingestion | `ModuleManagementService.upsertModule()` | `dt-ws/src/gql/module-management-services/module-management.service.ts` (lines 438-547) |
| Bulk Cypher ingestion | `mitre-frameworks/ingest.py` | `modules/mitre-frameworks/ingest.py` |

---

## 2. Graph Schema Reference

All relationship types and node labels referenced in this specification are defined in `apps/dt-ws/schema/schema.graphql`.

### Node labels

| Label | Schema line | Key properties |
|-------|------------|----------------|
| `ComponentClass` | 335 | `id`, `name`, `description`, `type: ComponentType`, `category`, `template` (custom resolver), `guide` (custom resolver) |
| `DataFlowClass` | 383 | Same structure as ComponentClass |
| `SecurityBoundaryClass` | 359 | Same structure as ComponentClass |
| `DataClass` | 437 | Same structure, `type: String` |
| `ControlClass` | 407 | Same + `supportedTypes: [ComponentType!]`, `supportedCategories: [String!]` |
| `Control` | 277 | `id`, `name`, `description`, `type`, `category` |
| `Countermeasure` | 635 | `id`, `name`, `description`, `type`, `category`, `score`, `addressedExposures: [String!]` |
| `Exposure` | 461 | `id`, `name`, `description`, `type`, `category`, `score`, `techniques: [String!]`, `attackVector: AttackVector` |
| `MitreAttackTechnique` | 523 | `id`, `name`, `attack_id`, `description` |
| `MitreAttackMitigation` | 561 | `id`, `name`, `attack_id`, `description` |
| `MitreDefendTechnique` | 613 | `id`, `name`, `d3fendId`, `description` |
| `Component` | 98 | `id`, `name`, `type: ComponentType`, `description` |
| `SecurityBoundary` | 131 | `id`, `name`, `description`, `trustLevel` |
| `DataFlow` | 146 | `id`, `name`, `description` |
| `Model` | 74 | `id`, `name`, `description` |
| `Module` | 303 | `id`, `name`, `version`, `description` |

### Relationship types used by these services

| Relationship | Direction | Schema line | Used by |
|-------------|-----------|------------|---------|
| `HAS_CLASS` | `Module -> *Class` | 316-324 | `match_classes` |
| `IS_INSTANCE_OF` | `Control -> ControlClass` | 289 | `findControls`, `assignControlToElements` |
| `SUPPORTS` | `Control -> Element` | 84, 116, 160, 190, 291 | `findControls`, `assignControlToElements`, `get_control_gaps` |
| `HAS_COUNTERMEASURE` | `Control -> Countermeasure` | 293 | `get_control_gaps` |
| `IS_COUNTERMEASURE_OF` | `Countermeasure -> ControlClass` | 661 | `get_control_gaps` |
| `RESPONDS_WITH` | `Countermeasure -> MitreAttackMitigation` | 655 | `get_control_gaps` |
| `RESPONDS_WITH` | `Countermeasure -> MitreDefendTechnique` | 657 | `get_control_gaps` |
| `HAS_EXPOSURE` | `Component/Boundary/DataFlow/Data -> Exposure` | 114, 269, 487-491 | `get_control_gaps` |
| `EXPLOITED_BY` | `Exposure -> MitreAttackTechnique` | 495 | `get_control_gaps` |
| `MITIGATION_DEFENDS_AGAINST_TECHNIQUE` | `MitreAttackMitigation -> MitreAttackTechnique` | 555, 591 | `get_control_gaps` |
| `CONTAINS` | `Model -> SecurityBoundary`, `Model -> Data` | 80, 86 | `get_control_gaps` (model scoping) |
| `BELONGS_TO` | `Component/SecurityBoundary -> SecurityBoundary` | 108, 184 | `get_control_gaps` (model scoping, nested boundaries) |
| `FLOWS` | `Component <- DataFlow -> Component` | 146-148 | `get_control_gaps` (model scoping) |

---

## 3. Service 1: `match_classes`

### Purpose

Given a list of elements (name, type, description), find the best matching classes from the platform's class catalog. Covers all five class types: ComponentClass, DataFlowClass, SecurityBoundaryClass, DataClass, ControlClass.

### GraphQL API

```graphql
type Query {
  matchClasses(input: MatchClassesInput!): MatchClassesResult!
}

input MatchClassesInput {
  elements: [MatchElementInput!]!
  classLabel: ClassLabelEnum!
  componentType: ComponentType
  moduleIds: [ID!]
  topN: Int = 3
  fields: [MatchClassFieldEnum!]
}

input MatchElementInput {
  name: String!
  type: ComponentType
  description: String
}

"""
Selects which class node label to search. When classLabel is COMPONENT,
use the optional componentType parameter on MatchClassesInput to filter
by PROCESS, STORE, or EXTERNAL_ENTITY.
"""
enum ClassLabelEnum {
  COMPONENT
  SECURITY_BOUNDARY
  DATA_FLOW
  DATA
  CONTROL
}

enum MatchClassFieldEnum {
  description
  category
  type
}

type MatchClassesResult {
  matches: [ElementMatch!]!
  unmatched: [String!]!
}

type ElementMatch {
  elementName: String!
  candidates: [ClassCandidate!]!
}

type ClassCandidate {
  classId: ID!
  className: String!
  classDescription: String
  classCategory: String
  classType: String
  moduleName: String!
  matchType: MatchType!
  confidence: ConfidenceLevel!
  similarityScore: Float
}

enum MatchType {
  exact_name
  fuzzy_name
  vector_similarity
  type_match
}

enum ConfidenceLevel {
  high
  medium
  low
}
```

### Input validation

- `elements` array: max 100 elements per call. Return error if exceeded.
- Query text: each element's composed embedding text is cut to 2,000 characters (never between the two halves of a surrogate pair) before it is embedded. Longer text is cut, not refused.
- `classLabel` maps directly to the graph label: `COMPONENT` → `ComponentClass`, `SECURITY_BOUNDARY` → `SecurityBoundaryClass`, `DATA_FLOW` → `DataFlowClass`, `DATA` → `DataClass`, `CONTROL` → `ControlClass`.
- `componentType`: optional filter, only applicable when `classLabel = COMPONENT`. Filters `ComponentClass` nodes by their `type` property (`PROCESS`, `STORE`, `EXTERNAL_ENTITY`). Ignored for other class labels.
- `moduleIds`: when provided, only search classes from these modules. When absent, search all modules.

### Match priority implementation

Per element, the exact-name tier and the vector tier run together. If either has hits, the candidates are the exact-name hits first (`exact_name`, `high`, score 1.0), then the vector hits not already listed (deduplicated by class id; `vector_similarity`, `medium`, `similarityScore` = cosine), cut to `topN`. A name hit does not keep the vector tier from running, and an exact-name candidate always stays first. Only when both are empty does the fallback run: name containment, then the type-filtered heuristic; the first with hits ends the cascade.

#### Exact-name tier (deterministic)

**Note:** All Cypher queries in this section use `ComponentClass` as an example label. In the resolver, substitute the label dynamically via `classLabelToNodeLabel(classLabel)`. When `classLabel = COMPONENT` and `componentType` is provided, add `AND c.type = $componentType` to the WHERE clause.

```cypher
MATCH (c:ComponentClass)<-[:HAS_CLASS]-(m:Module)
WHERE toLower(c.name) = toLower($element_name)
  AND ($module_ids IS NULL OR m.id IN $module_ids)
RETURN c.id, c.name, c.description, c.category, m.name AS moduleName
```

Case-insensitive exact match against class names.

#### Vector tier (optional, requires embeddings)

Only if `vectorAvailable` is true and the element has a description. `vectorAvailable` means: the embedder is ready, the database's vector self-test passed, and at least one active class of the label in scope has a vector of the active embedding model. Both Memgraph and Neo4j run this tier.

When the embedder is too busy to embed the request's elements (its query backlog is full, or the embed runs past its timeout), the elements it left keep the name tiers and the response's `vectorAvailable` is false for that request, though the precheck passed.

The search is **exact**, with no vector index: every candidate class is scored with the database's own cosine function, so the scope filters are ordinary `WHERE` clauses and run before ranking.

```cypher
MATCH (m:Module)-[:HAS_CLASS]->(n:ComponentClass)
WHERE n.embedding IS NOT NULL
  AND n.embeddingModel = $profileId          // only vectors of the active embedding model
  AND size(n.embedding) = $dims
  AND ($componentType IS NULL OR n.type = $componentType)
  AND ($moduleIds IS NULL OR m.id IN $moduleIds)
WITH n, m, <cosine(n.embedding, $vector)> AS score
WHERE $threshold IS NULL OR score >= $threshold
RETURN n.id AS id, n.name AS name, n.description AS description, n.category AS category, n.type AS type,
       m.id AS moduleId, m.name AS moduleName, score
ORDER BY score DESC, id ASC
LIMIT $k
```

`<cosine(...)>` is `vector_search.cosine_similarity(a, b)` on Memgraph and `(2 * vector.similarity.cosine(a, b) - 1)` on Neo4j, which returns `(1 + cos) / 2` and is mapped back. The score (`similarityScore`) and the threshold are therefore cosines (-1..1) on both engines. Ties order by class id; `$k` is `topN`, clamped to 1..50 and passed as a Bolt integer. The query is built by `buildRankQuery` in `@dethernety/dt-module/embedding` and run by `VectorSearchService.rank()` in a read transaction.

See Section 7 for the embedding pipeline. The threshold is the class corpus's: `EMBEDDING_THRESHOLD_CLASSES` when set, else the active embedding profile's calibrated value.

**Detecting availability:** `VectorSearchService.healthy()` runs a memoized self-test on the configured engine: the cosine of two orthogonal vectors must be 0 and of two opposite vectors -1. A failure keeps the vector tier off and is retried after 60 seconds. The resolver then checks that the scope holds at least one vector of the active model; if not, it logs a warning and skips the vector tier.

#### Fallback 1: Name containment (deterministic)

Runs only when neither the exact-name nor the vector tier has hits (`fuzzy_name`, `high`). Use whole-word name containment with a minimum length guard:

```typescript
// Server-side in the resolver, not in Cypher
const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
// True when `needle` occurs in `hay` as a contiguous word sequence
const containsWords = (hay: string[], needle: string[]) =>
  needle.length > 0 && needle.length <= hay.length &&
  hay.some((_, i) => needle.every((w, k) => hay[i + k] === w))

function fuzzyMatch(elementName: string, className: string): boolean {
  // Skip very short element names (< 3 chars) to avoid false positives
  if (elementName.length < 3) return false
  const a = words(elementName)
  const b = words(className)
  // Whole words, either direction: "orders-db (PostgreSQL 15)" contains "PostgreSQL",
  // "API" is contained in "API Gateway". A word inside a longer word is not a hit:
  // "Go microservice" does NOT contain "Service".
  return containsWords(a, b) || containsWords(b, a)
}
```

No Levenshtein — character-level edit distance on short identifiers produces more false positives than value. Approximate matching is left to the vector tier, which has already run, and to agent reasoning (Pass 2).

Fetch all classes of the target label (scoped to modules), run `fuzzyMatch` in-memory. The class count is bounded by module filtering (typically 30-300, not thousands).

#### Fallback 2: Type-filtered heuristic

Return classes scoped to modules. Confidence: `low`. The type filter only applies when `classLabel = COMPONENT` and `componentType` is provided — for other class labels, return all classes of that label (no type filter).

```cypher
// When classLabel = COMPONENT and componentType is provided:
MATCH (c:ComponentClass)<-[:HAS_CLASS]-(m:Module)
WHERE c.type = $componentType
  AND ($module_ids IS NULL OR m.id IN $module_ids)
RETURN c.id, c.name, c.description, c.category, m.name AS moduleName
LIMIT $top_n

// For other class labels (DATA_FLOW, SECURITY_BOUNDARY, DATA, CONTROL):
MATCH (c:DataFlowClass)<-[:HAS_CLASS]-(m:Module)
WHERE $module_ids IS NULL OR m.id IN $module_ids
RETURN c.id, c.name, c.description, c.category, m.name AS moduleName
LIMIT $top_n
```

### Resolver implementation

```
dt-ws/src/gql/resolver-services/match-classes-resolver.service.ts
```

Follows the pattern of `TemplateResolverService`. Register in `custom-resolver.module.ts` by adding to the `resolverServiceClasses` array.

**Schema registration:** All new types (`MatchClassesInput`, `MatchClassesResult`, `ClassLabelEnum`, etc.) are defined in `schema.graphql` alongside existing types. The resolver registers under `Query` in `getResolvers()`, following the same pattern as `AnalysisResolverService` which registers `Query.getAnalysisValues` and `Query.getDocument`.

**Authorization and monitoring:** The resolver must inject `AuthorizationService` and `MonitoringService` (shared services from `custom-resolver.module.ts`) and follow the same safeguards as all other custom resolvers:
- Call `authorizationService.extractAuthContext(context)` at the start of every resolver method
- Call `authorizationService.checkAuthorization(authContext, { operationName, resourceType })` before processing
- Record operation metrics via `monitoringService.recordOperation({ operationName, duration, success })`
- Since `match_classes` uses direct Cypher (bypassing `@neo4j/graphql`), the schema-level `@authentication` directive does NOT protect it automatically — the explicit auth check is required

The resolver needs:
- `AuthorizationService` — injected, for auth context extraction and authorization checks
- `MonitoringService` — injected, for operation metrics
- Access to the Bolt driver (for Cypher queries) — inject via `GqlService` or directly
- Access to the embedding service (for the vector tier) — inject as optional dependency

### Label mapping

```typescript
function classLabelToNodeLabel(classLabel: ClassLabelEnum): string {
  switch (classLabel) {
    case 'COMPONENT':
      return 'ComponentClass'
    case 'SECURITY_BOUNDARY':
      return 'SecurityBoundaryClass'
    case 'DATA_FLOW':
      return 'DataFlowClass'
    case 'DATA':
      return 'DataClass'
    case 'CONTROL':
      return 'ControlClass'
  }
}
```

When `classLabel = COMPONENT` and `componentType` is provided, add a `WHERE c.type = $componentType` filter to the Cypher queries.

---

## 4. Service 2: `get_control_gaps`

### Purpose

Given a synced model, traverse the MITRE framework chain in the graph to identify unmitigated exposures and recommend controls. This is a **post-analysis** service — it requires that the model has been synced, analyzed (exposures generated), and optionally has controls assigned.

### GraphQL API

```graphql
type Query {
  controlGaps(input: ControlGapsInput!): ControlGapsResult!
}

input ControlGapsInput {
  modelId: ID!
  topN: Int = 3
  limit: Int = 50
}

type ControlGapsResult {
  unmitigatedExposures: [UnmitigatedExposure!]!
  unaddressableExposures: [UnaddressableExposure!]!
  recommendedControls: [RecommendedControl!]!
  coverageSummary: CoverageSummary!
}

type UnmitigatedExposure {
  elementId: ID!
  elementName: String!
  exposureId: ID!
  exposureName: String!
  attackTechniques: [MitreReference!]!
  recommendedMitigations: [MitreReference!]!
}

type UnaddressableExposure {
  elementId: ID!
  elementName: String!
  exposureId: ID!
  exposureName: String!
  attackTechniques: [MitreReference!]!
  mitreMitigations: [MitreReference!]!
}

type RecommendedControl {
  controlId: ID
  controlName: String
  controlClassId: ID!
  controlClassName: String!
  d3fendTechniques: [MitreReference!]!
  addressesCount: Int!
  elementsAffected: [ElementReference!]!
}

type MitreReference {
  id: String!
  name: String!
}

type ElementReference {
  id: ID!
  name: String!
}

type CoverageSummary {
  totalExposures: Int!
  mitigated: Int!
  unmitigated: Int!
  unaddressable: Int!
  coveragePct: Float!
}
```

### Cypher implementation

The query has three phases: scope the model, find gaps, recommend controls.

**Phase 1 — Scope model elements (full model scope):**

All components in the model are included regardless of boundary nesting depth. Viewpoint-based scoping (filtering by trust level or boundary context) is a future enhancement.

```cypher
// Get all boundaries including nested (variable-length BELONGS_TO traversal)
MATCH (model:Model {id: $model_id})-[:CONTAINS]->(b:SecurityBoundary)
OPTIONAL MATCH (b)<-[:BELONGS_TO*1..]-(nested:SecurityBoundary)
WITH model, collect(DISTINCT b) + collect(DISTINCT nested) AS allBoundaries
UNWIND allBoundaries AS boundary
OPTIONAL MATCH (boundary)<-[:BELONGS_TO]-(comp:Component)
WITH model, collect(DISTINCT comp) AS components, collect(DISTINCT boundary) AS boundaries
// Collect data flows in both directions (undirected — component may be source or target)
UNWIND components AS comp
OPTIONAL MATCH (comp)-[:FLOWS]-(df:DataFlow)
WITH model, components, boundaries, collect(DISTINCT df) AS flows
// Collect data items (model-level via CONTAINS, element-level via HANDLES)
OPTIONAL MATCH (model)-[:CONTAINS]->(d:Data)
WITH components, boundaries, flows, collect(DISTINCT d) AS dataItems
WITH components + boundaries + flows + dataItems AS allElements
UNWIND allElements AS element
```

**Phase 2 — Find exposures and check mitigation chain:**

```cypher
// For each element, find exposures
MATCH (element)-[:HAS_EXPOSURE]->(exp:Exposure)
// Walk the MITRE chain: exposure → technique → mitigation
OPTIONAL MATCH (exp)-[:EXPLOITED_BY]->(tech:MitreAttackTechnique)
OPTIONAL MATCH (tech)<-[:MITIGATION_DEFENDS_AGAINST_TECHNIQUE]-(mit:MitreAttackMitigation)
// Check if any control's countermeasure implements this mitigation
OPTIONAL MATCH (mit)<-[:RESPONDS_WITH]-(cm:Countermeasure)<-[:HAS_COUNTERMEASURE]-(ctrl:Control)-[:SUPPORTS]->(element)
WITH element, exp, tech, mit, ctrl, cm
```

**Phase 3 — Classify and rank:**

```cypher
// Unmitigated: has mitigations but no control implements them
WHERE ctrl IS NULL AND mit IS NOT NULL
RETURN element.id, element.name, exp.id, exp.name,
       collect(DISTINCT {id: tech.attack_id, name: tech.name}) AS techniques,
       collect(DISTINCT {id: mit.attack_id, name: mit.name}) AS mitigations
LIMIT $limit
```

**Unaddressable exposures — computed in application code, not Cypher.**

The Phase 2 query above returns unmitigated exposures with their `mitigation.attack_id` values. The resolver collects all unique mitigation IDs and runs a second, simple query to check which mitigations have a path to any installed ControlClass:

```cypher
// Check which mitigations are addressable (have a Countermeasure → ControlClass → Module path)
MATCH (mit:MitreAttackMitigation)<-[:RESPONDS_WITH]-(cm:Countermeasure)
      -[:IS_COUNTERMEASURE_OF]->(cc:ControlClass)<-[:HAS_CLASS]-(m:Module)
WHERE mit.attack_id IN $mitigation_ids
RETURN DISTINCT mit.attack_id
```

The resolver then partitions: mitigations returned by this query are addressable (a ControlClass exists that could be assigned). Mitigations **not** returned are unaddressable — no installed module covers them. Exposures whose mitigations are all unaddressable go into the `unaddressableExposures` array.

This avoids complex `NOT EXISTS` patterns that differ between Neo4j and Memgraph.

For `recommended_controls`, query existing Controls (or ControlClasses) whose countermeasures address the most unmitigated techniques:

```cypher
// Find controls whose countermeasures address unmitigated techniques
// Note: $unmitigated_technique_ids contains attack_id values (e.g., "T1190") from Phase 2 results
MATCH (ctrl:Control)-[:HAS_COUNTERMEASURE]->(cm:Countermeasure)-[:RESPONDS_WITH]->(mit:MitreAttackMitigation)
     -[:MITIGATION_DEFENDS_AGAINST_TECHNIQUE]->(tech:MitreAttackTechnique)
WHERE tech.attack_id IN $unmitigated_technique_ids
// Join to ControlClass for class metadata
OPTIONAL MATCH (ctrl)-[:IS_INSTANCE_OF]->(cc:ControlClass)
// Collect D3FEND techniques from the control's countermeasures
OPTIONAL MATCH (cm)-[:RESPONDS_WITH]->(d3:MitreDefendTechnique)
// Collect elements this control supports (within the model scope)
OPTIONAL MATCH (ctrl)-[:SUPPORTS]->(elem)
WHERE elem.id IN $model_element_ids
WITH ctrl, cc,
     count(DISTINCT tech) AS addressesCount,
     collect(DISTINCT {id: d3.d3fendId, name: d3.name}) AS d3fendTechniques,
     collect(DISTINCT {id: elem.id, name: elem.name}) AS elementsAffected
ORDER BY addressesCount DESC
LIMIT $top_n
RETURN ctrl.id AS controlId, ctrl.name AS controlName,
       cc.id AS controlClassId, cc.name AS controlClassName,
       d3fendTechniques, addressesCount, elementsAffected
```

**Coverage summary computation:**

The resolver computes `CoverageSummary` from the Phase 2/3 results:
- `totalExposures`: count of distinct exposures across all model elements
- `mitigated`: exposures where at least one control's countermeasure addresses all linked ATT&CK techniques (i.e., `ctrl IS NOT NULL` for every technique)
- `unmitigated`: exposures where ATT&CK mitigations exist but no control implements them
- `unaddressable`: subset of unmitigated where no installed module's ControlClass covers the mitigations
- `coveragePct`: `totalExposures > 0 ? (mitigated / totalExposures) * 100 : 0`

Exposures with no `EXPLOITED_BY` link (no ATT&CK technique mapped) are counted in `totalExposures` but not in `mitigated`, `unmitigated`, or `unaddressable` — they have no MITRE chain to evaluate. They appear as a gap in coverage but are not actionable through the MITRE framework.

**Performance notes:**
- Always filter by `model_id` first (Phase 1) to constrain the traversal scope
- Use `LIMIT` on final results, not on intermediate matches
- For models with 200+ exposures, consider batching: process 50 elements at a time
- The Cypher is complex — test with `EXPLAIN` / `PROFILE` before production

### Resolver implementation

```
dt-ws/src/gql/resolver-services/control-gaps-resolver.service.ts
```

This resolver uses direct Cypher via the Bolt driver, not auto-generated GraphQL. The query complexity exceeds what `@neo4j/graphql` can express.

**Schema registration:** All new types (`ControlGapsInput`, `ControlGapsResult`, `CoverageSummary`, etc.) are defined in `schema.graphql` alongside existing types. The resolver registers under `Query` in `getResolvers()`.

**Authorization and monitoring:** Same pattern as `match_classes` — inject `AuthorizationService` and `MonitoringService`. Since this resolver uses direct Cypher, `@authentication` does not protect it. The resolver must:
- Call `authorizationService.extractAuthContext(context)` and `checkAuthorization(authContext, { operationName: 'controlGaps', resourceType: 'Model', resourceId: modelId })` before executing any Cypher
- Record operation metrics via `monitoringService.recordOperation()`

### Empty state handling

If the model has zero exposures (analysis not yet run), return:
```json
{
  "unmitigatedExposures": [],
  "unaddressableExposures": [],
  "recommendedControls": [],
  "coverageSummary": {
    "totalExposures": 0,
    "mitigated": 0,
    "unmitigated": 0,
    "unaddressable": 0,
    "coveragePct": 0
  }
}
```

The MCP tool should detect this and return a message: "No exposures found — run analysis first."

---

## 5. Service 3: `findControls` (dt-core)

### Purpose

Flexible query method for controls, equivalent to `DtIssue.findIssues()`. The current `DtControl.getControls()` only filters by `folderId`. This method adds filtering by class, element, module, and name.

### Method signature

```typescript
// In dt-core/src/dt-control/dt-control.ts

findControls = async ({
  controlId,
  name,
  classId,
  classType,
  elementIds,
  moduleId,
  moduleName,
}: {
  controlId?: string
  name?: string
  classId?: string
  classType?: string
  elementIds?: string[]
  moduleId?: string
  moduleName?: string
}): Promise<Control[]>
```

### GraphQL query

Add to `dt-core/src/dt-control/dt-control-gql.ts`:

```graphql
query FindControls($condition: ControlWhere) {
  controls(where: $condition) {
    id
    name
    description
    type
    category
    controlClasses {
      id
      name
      type
      category
      supportedTypes
      supportedCategories
      module {
        id
        name
      }
    }
    elements {
      ... on Component { id name type }
      ... on SecurityBoundary { id name }
      ... on DataFlow { id name }
      ... on Model { id name }
    }
    countermeasures {
      id
      name
      type
      score
    }
    folder {
      id
      name
    }
  }
}
```

### Condition builder

Follow the `DtIssue.findIssues()` pattern (lines 88-143 of `dt-issue.ts`):

The condition builder has two paths depending on whether `elementIds` is provided.

**Path 1: `elementIds` provided — helper query on dt-ws.** The `elements` relationship on `Control` is typed as `[Element!]!` (the interface). The auto-generated `ControlWhere` queries through the `Element` interface, which causes poor performance on Memgraph (5+ second response times due to missing index usage on interface queries). This is the same problem `DtIssue.findIssues()` encountered — its interface-based filter is commented out (line 133 of `dt-issue.ts`).

Since dt-core uses Apollo Client (not Bolt), it cannot execute Cypher directly. A small helper query on dt-ws provides the element-to-control lookup:

```graphql
# Added to schema.graphql
type Query {
  controlIdsByElements(elementIds: [ID!]!): [ID!]!
}
```

The resolver (in `match-classes-resolver.service.ts` or a shared resolver) executes:

```cypher
MATCH (ctrl:Control)-[:SUPPORTS]->(elem)
WHERE elem.id IN $element_ids
RETURN DISTINCT ctrl.id
```

dt-core calls `controlIdsByElements` first, then passes the resulting IDs into the main `FindControls` query via `id: { in: $control_ids }`. If other filters are also provided (`name`, `classId`, `moduleId`), they intersect naturally in the GraphQL condition.

**Path 2: `elementIds` not provided — auto-generated GraphQL only:**

```typescript
let condition: Record<string, any> = {}

if (controlId) condition.id = { eq: controlId }
if (name) condition.name = { contains: name }  // substring match

if (classId || classType) {
  const classFilter: Record<string, any> = {}
  if (classId) classFilter.id = { eq: classId }
  if (classType) classFilter.type = { eq: classType }
  condition.controlClasses = { some: classFilter }
}

// elementIds handled via Cypher path above — NOT via the auto-generated interface filter

if (moduleId || moduleName) {
  const moduleFilter: Record<string, any> = {}
  if (moduleId) moduleFilter.id = { eq: moduleId }
  if (moduleName) moduleFilter.name = { eq: moduleName }
  condition.controlClasses = {
    ...condition.controlClasses,
    some: {
      ...condition.controlClasses?.some,
      module: { single: moduleFilter }
    }
  }
}
```

### Use cases

| Call | What it answers |
|------|----------------|
| `findControls({ elementIds: ['comp-1', 'comp-2'] })` | What controls protect these elements? |
| `findControls({ classId: 'class-mfa' })` | What controls implement MFA? |
| `findControls({ moduleId: 'mod-k8s' })` | What controls come from the Kubernetes module? |
| `findControls({ name: 'encryption' })` | Search controls by name |
| `findControls({ elementIds: ['comp-1'], classId: 'class-mfa' })` | Does this element have an MFA control? (already_assigned check) |

---

## 6. Service 4: `assignControlToElements` (dt-core)

### Purpose

Create `SUPPORTS` edges between a Control and model elements (Components, SecurityBoundaries, DataFlows, Models). Append-only — adds edges without removing existing ones. Replace semantics (disconnect + reconnect) are handled by `updateControl()`, which already implements this pattern for `controlClasses`.

### Method signature

```typescript
// In dt-core/src/dt-control/dt-control.ts

assignControlToElements = async ({
  controlId,
  elementIds,
}: {
  controlId: string
  elementIds: string[]       // elements to connect (SUPPORTS edges)
}): Promise<Control | null>
```

### Implementation

Append-only connect via the auto-generated GraphQL mutation. If the polymorphic `elements` connect does not work correctly with `@neo4j/graphql`, fall back to direct Cypher with `MERGE` (see below).

```typescript
const variables = {
  controlId,
  input: {
    elements: {
      connect: elementIds.map(id => ({
        where: { node: { id: { eq: id } } }
      }))
    }
  }
}
```

### GraphQL mutation

```graphql
mutation AssignControlToElements($controlId: ID!, $input: ControlUpdateInput!) {
  updateControls(
    where: { id: { eq: $controlId } }
    update: $input
  ) {
    controls {
      id
      name
      elements {
        ... on Component { id name }
        ... on SecurityBoundary { id name }
        ... on DataFlow { id name }
        ... on Model { id name }
      }
      controlClasses {
        id
        name
      }
    }
  }
}
```

**Polymorphic `elements` connect:** The `Control.elements` field is typed as `[Element!]!` via `@relationship(type: "SUPPORTS", direction: OUT)`. The auto-generated `ControlUpdateInput` may handle the `elements` connect differently from typed relationships like `controlClasses`. Test whether connect on the polymorphic `elements` field works correctly with the `@neo4j/graphql` auto-generated mutations. If it does not, fall back to direct Cypher:

```cypher
MATCH (ctrl:Control {id: $control_id})
MATCH (elem) WHERE elem.id IN $element_ids
MERGE (ctrl)-[:SUPPORTS]->(elem)
```

### Idempotency

`MERGE` (or `connect` via GraphQL) ensures that calling assign with the same `controlId` and `elementId` twice does not create duplicate SUPPORTS edges. The append-only design makes the operation inherently idempotent.

### Batch semantics

The method accepts multiple `elementIds` per call. One Control can protect many elements. The mutation creates one SUPPORTS edge per element in a single database transaction.

For the MCP tool (`manage_controls` `assign` action), the batch input is `[{ control_id, element_id }]` pairs. Group by `control_id` and call `assignControlToElements` once per control:

```typescript
// In manage-controls.tool.ts, assign action
const grouped = groupBy(input.assignments, 'control_id')
for (const [controlId, assignments] of Object.entries(grouped)) {
  await dtControl.assignControlToElements({
    controlId,
    elementIds: assignments.map(a => a.element_id)
  })
}
```

---

## 7. Embedding Pipeline

### Overview

Optional enhancement for the `match_classes` vector tier. Runs on Memgraph and Neo4j. When enabled, class nodes are embedded during module ingestion and searched with an exact cosine search in the database (no vector index). When disabled, `match_classes` runs only the deterministic tiers: exact name, then the name-containment and type-filtered fallbacks.

### Configuration

The embedder runs in process: dt-ws runs an **embedding profile** with onnxruntime on a worker thread. There is no HTTP embedder and no embedding service to deploy. A profile (`packages/dt-module/src/embedding-profile.ts`, built-ins in `src/embedding-profiles/*.json`) pins the weights (Hugging Face repository, revision, per-file size and sha256), the runtime (dimensions, pooling, normalisation), the query and document prompts, and the per-corpus thresholds. This release offers one profile, `embeddinggemma-300m-retrieval-v1` (768 dimensions).

```typescript
// Environment variables
EMBEDDING_ENABLED=true|false        // default: false
EMBEDDING_MODEL=                    // profile id; unset selects embeddinggemma-300m-retrieval-v1
EMBEDDING_MODEL_DIR=models          // where the weights are downloaded and verified
EMBEDDING_THREADS=4                 // onnxruntime threads
EMBEDDING_QUERY_BACKLOG=200         // query texts that may wait on the embedder (100..100000)
EMBEDDING_QUERY_TIMEOUT_MS=10000    // base time limit of a request's query embed (1..600000)
EMBEDDING_QUERY_TIMEOUT_PER_ITEM_MS=250 // added per query text (0..60000)
EMBEDDING_THRESHOLD_CLASSES=        // optional cosine floor; overrides the profile's value
EMBEDDING_THRESHOLD_MITRE=          // likewise for MITRE technique search
EMBEDDING_THRESHOLD_COMPONENTS=     // likewise for components (no floor by default)
HF_TOKEN=                           // only for a gated weight source; sent to the hub origin only
```

With `EMBEDDING_ENABLED=true` the environment validation refuses to start on `EMBEDDING_MODEL=embeddinggemma` (the removed HTTP embedder's model), on a built-in profile this release does not offer, and on any unknown id. `EMBEDDING_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_DIMENSIONS` and `EMBEDDING_SIMILARITY_THRESHOLD` are ignored with a logged warning. See [ADR-013](../../decisions/013-in-process-embedding.md).

### No vector index for classes

Class vectors need no index: the vector tier scores every candidate class directly (see [Vector tier](#vector-tier-optional-requires-embeddings)). Module install therefore creates, probes, resizes and repairs no class vector index, and a stored vector is searchable as soon as its write commits. The only engine requirement is a cosine function that passes the vector self-test: Memgraph 3.6+ (`vector_search.cosine_similarity`, tested on 3.13.2) or Neo4j 5.26 Community (`vector.similarity.cosine`).

### Embedding service

```
dt-ws/src/gql/services/embedding.service.ts
```

The service selects its profile with the same rule as the environment validation (`config/embedding-profile-selection.ts`). On module init it acquires the weights in the background (`ensureWeightsWithRetry` from `@dethernety/embedder`: sha256-verified, retried after 10 s, 30 s, 2 min, 10 min and 30 min, aborted on shutdown), then starts the worker (`createWorkerEmbedder`, a 120 s load bound) and warms it up. Until then `isEnabled()` is false and `isPending()` is true.

```typescript
@Injectable()
export class EmbeddingService implements OnModuleInit, OnModuleDestroy {
  isEnabled(): boolean                 // enabled by configuration AND ready
  isPending(): boolean                 // enabled, but downloading, loading or failed
  getState(): 'disabled' | 'downloading' | 'loading' | 'ready' | 'failed'
  getModel(): string                   // the profile id, stored as embeddingModel
  getDimensions(): number              // the profile's dimensions
  getThreshold(corpus: 'classes' | 'mitre' | 'components'): number | null

  /** Embed as queries or documents; a document's title feeds the profile's title rule.
   *  Returns null when not enabled; throws on failure (no retry). Without options there is no
   *  timeout, which document embeds (install, catch-up, reindex) rely on. */
  embedBatch(texts: string[], kind: 'query' | 'document', titles?: string[], options?: { timeoutMs?: number }): Promise<number[][] | null>

  /** One batch, then one text at a time if the batch throws or miscounts. A query embed carries
   *  a timeout of EMBEDDING_QUERY_TIMEOUT_MS + EMBEDDING_QUERY_TIMEOUT_PER_ITEM_MS per text. A busy
   *  refusal (EmbedderBusyError) or a timeout (EmbedTimeoutError) is not retried text by text, and
   *  in the per-text fallback the first one gives every remaining text null with that error. */
  embedEach(texts: string[], kind: 'query' | 'document'): Promise<{ vectors: (number[] | null)[]; failures: { index: number; error: unknown }[] }>

  whenStartupChecked(): Promise<void> // the start-up install's bounded wait (60 s, only when the weights are in place)
  onReady(listener: () => void): () => void

  composeClassText(cls: { name: string, description?: string, category?: string, type?: string }): string
  composeElementText(element: { name: string, description?: string, type?: string }): string
}
```

The two compose helpers delegate to `@dethernety/dt-module/embedding`, so build-time tooling and the runtime produce byte-equal text.

### Module ingestion integration

In `ModuleManagementService.upsertModule()` (`module-management.service.ts`), before the class upsert loop. `EmbeddingService` is injected into `ModuleManagementService`.

The vectors are resolved **before** the write transaction, by `ModuleManagementService.resolveVectors(metadata, moduleInstance)`:

```typescript
// Returns null (embedding off: write none, remove stale ones),
// 'pending' (embedder not ready: keep the stored vectors, install partial),
// or a Map className -> vector.
if (!this.embeddingService.isEnabled()) {
  return this.embeddingService.isPending() ? 'pending' : null
}
const slug = slugifyModelName(this.embeddingService.getModel())
const dims = this.embeddingService.getDimensions()
for (const { cls } of allClasses) {
  const pre = moduleInstance?.getEmbedding?.(cls.name, slug) ?? null
  // Used only when it can be stored: the profile's dimensions, finite values, a non-zero norm.
  if (pre && !vectorDefect(pre, dims)) resolved.set(cls.name, pre)
  else missing.push({ className: cls.name, text: this.embeddingService.composeClassText(cls) })
}
// Embedded as documents, each titled with its class name. A throw fails this module's install.
const fresh = await this.embeddingService.embedBatch(
  missing.map(m => m.text), 'document', missing.map(m => m.className))
// Every class gets a vector, or the install fails: a wrong count or a vector that cannot be stored throws.
```

The `upsertClass()` method receives the optional embedding and includes it in the MERGE/SET Cypher:

```typescript
// In upsertClass(), add embedding to the SET if provided
const nodeProperties = {
  ...classData,
  updatedAt: new Date().toISOString(),
  ...(embedding ? { embedding, embeddingModel: this.embeddingService.getModel() } : {}),
}

await tx.run(
  `MATCH (p:Module {id: $moduleId})
   MERGE (p)-[:HAS_CLASS]->(t:${classLabel} {name: $name})
   ON CREATE SET
     t.id = randomUUID(),
     t.createdAt = datetime()
   SET t += $nodeProperties
   RETURN t`,
  { moduleId, name: cls.name, nodeProperties }
)
```

No separate indexing step is needed: the exact search reads the `embedding` property directly, so a class is searchable as soon as the write commits.

### Failure behavior

If `EMBEDDING_ENABLED=true` but the embedder is **not ready** (downloading, loading or failed) during module install:
- The install keeps the vectors the classes already have, writes no new ones, and marks the module **partial**.
- When the embedder becomes ready, the **catch-up** (`enableCatchUp`) reinstalls the modules left partial; a module still partial at the next start is reinstalled then.

If the embedder is ready but a batch **throws**, returns another number of vectors than classes, or returns a vector that cannot be stored (the wrong length, a non-finite value, a zero norm), the module's install fails: either all classes are written with their vectors, or nothing is written. The start-up install logs it and continues with the other modules; a single-module install propagates the error.

### Model version tracking

Store the embedding model identifier alongside vectors to detect version drift:

```cypher
CREATE (c:ComponentClass {
    ...,
    embedding: item.vector,
    embeddingModel: $model_identifier  // the profile id, e.g. "embeddinggemma-300m-retrieval-v1"
})
```

The vector search compares only vectors whose `embeddingModel` is the active profile and whose length is its dimensions, so vectors of another model are never scored. The Module node records the embedder its classes were installed with (`embeddingProfile`: `<profile id>/<dimensions>`, or `off`); the start-up skip gate reinstalls an otherwise unchanged module whose record differs, so a profile change re-embeds every module's classes at the next start. The gate does not trust the record alone: with embedding on, it also reinstalls a module whose declared searchable classes hold a vector of another profile, of another length, or none, as after an older platform version installed the module again under a record that still matches (see [ModuleManagementService → The class vector check](./MODULE_MANAGEMENT_SERVICE.md#the-class-vector-check)).

### Module update

When a module is updated (classes renamed, descriptions changed), the existing `upsertClass()` method handles this — `MERGE` on `{name}` matches the existing node, then `SET` updates all properties including the embedding. Run per class label (substitute `ComponentClass` with the actual label):

```cypher
UNWIND $updated_classes AS item
MATCH (c:ComponentClass {id: item.id})
SET c.name = item.name,
    c.description = item.description,
    c.embedding = item.vector,
    c.embeddingModel = $model_identifier
```

### Re-indexing (embedding model migration)

When the embedding profile changes, all class vectors must be recomputed before the new profile is used for queries. The start-up skip gate does this per module; a GraphQL mutation also exposes it as a platform operation:

```graphql
type Mutation {
  reindexClassEmbeddings(moduleIds: [ID!]): ReindexResult!
}

type ReindexResult {
  reindexedCount: Int!
  moduleNames: [String!]!
  alreadyRunning: Boolean!
}
```

**Behavior:**
- When `moduleIds` is provided, re-embeds classes from those modules only. When absent, re-embeds all classes across all modules.
- Reads the active class nodes (all 5 labels), composes embedding text, embeds it as documents in batches, writes vectors back with the current `embeddingModel` identifier.
- Skips, with a warning, any returned vector that is not of the configured length, finite and non-zero.
- This is a **blocking operation** — the mutation does not return until all vectors are updated. Stale vectors during a partial reindex would produce incorrect similarity rankings.
- **One at a time.** A call while a reindex runs returns at once with `alreadyRunning: true`, `reindexedCount: 0` and an empty `moduleNames`, embeds nothing and logs a warning. A reindex's document embeds carry no timeout and are not counted against the query backlog.
- Authorization required: same `AuthorizationService` pattern as other custom resolvers.

**When to use:**
- After changing `EMBEDDING_MODEL` in configuration
- As a recovery step if class data was manually modified in the graph

The mutation lives in the same resolver as `match_classes` (`match-classes-resolver.service.ts`) since it shares the `EmbeddingService` dependency.

---

## 8. Implementation Sequence

```
Phase A1: match_classes (deterministic only — exact name, containment, type heuristic)
  Files:
    - dt-ws/schema/schema.graphql (add new types, inputs, enums)
    - dt-ws/src/gql/resolver-services/match-classes-resolver.service.ts (new)
    - dt-ws/src/gql/custom-resolver.module.ts (register)
    - dt-core/src/dt-class/dt-class.ts (new matchClasses method, wraps GraphQL)
    - dt-core/src/dt-class/dt-class-gql.ts (new query)
  No embedding infrastructure. Works immediately.

Phase A2: match_classes (add the vector tier)
  Files:
    - dt-ws/schema/schema.graphql (add ReindexResult type, reindexClassEmbeddings mutation)
    - dt-ws/src/gql/services/embedding.service.ts (new)
    - dt-ws/src/gql/module-management-services/module-management.service.ts (integrate embedding into upsertModule/upsertClass)
    - dt-ws/src/gql/custom-resolver.module.ts (register EmbeddingService)
    - Match classes resolver (add vector search branch + reindexClassEmbeddings mutation)
  Requires: a database cosine function that passes the vector self-test (Memgraph 3.6+ or Neo4j 5.26).

Phase B: findControls + assignControlToElements (parallel with A)
  Files:
    - dt-ws/schema/schema.graphql (add controlIdsByElements query)
    - dt-ws/src/gql/resolver-services/ (add controlIdsByElements resolver — can share existing resolver file)
    - dt-core/src/dt-control/dt-control.ts (add two methods)
    - dt-core/src/dt-control/dt-control-gql.ts (add FIND_CONTROLS + CONTROL_IDS_BY_ELEMENTS queries)

Phase C: get_control_gaps
  Files:
    - dt-ws/schema/schema.graphql (add new types, inputs, enums)
    - dt-ws/src/gql/resolver-services/control-gaps-resolver.service.ts (new)
    - dt-ws/src/gql/custom-resolver.module.ts (register)
    - dt-core/src/dt-control/dt-control.ts (add controlGaps method, wraps GraphQL)
    - dt-core/src/dt-control/dt-control-gql.ts (add query)
  Requires: models with exposures (analysis must have run) and MITRE data loaded.
```

### Dependency graph

```
Phase A1 ──→ Phase A2 (adds vector to existing service)
     │
     └──→ Phase C (match_classes enables classification → controls → gaps)

Phase B (independent, parallel with A)
     │
     └──→ Phase C (findControls needed for already_assigned checks in gap analysis)
```

---

## 9. Testing Strategy

> **Planned coverage — not an inventory.** The two tables below belong to the original
> specification: they record the tests intended for these services, written before the services
> existed. The services have since shipped, and what landed is narrower than planned and lives in
> different files than were predicted here. Read **As-built coverage** for what exists today; read the
> planned tables for design intent and for the gaps still open.

### Unit tests — planned

| Service | Key cases |
|---------|-----------|
| `match_classes` | Exact name, fuzzy name (substring), no match, componentType filter, module filtering, empty elements array, max batch exceeded |
| `get_control_gaps` | Zero exposures, all mitigated, some unmitigated, unaddressable (no ControlClass), empty model |
| `findControls` | Filter by class, by element, by module, combined filters, empty results |
| `assignControlToElements` | Single assign, batch assign, idempotent re-assign |
| `EmbeddingService` | Disabled mode, profile selection and refusal, weight acquisition failure, worker failure after ready, batch embedding, per-text fallback |

### Integration tests — planned

| Test | Setup | Assertion |
|------|-------|-----------|
| Full classification flow | Create module with 10 classes → call `matchClasses` with 5 elements | High-confidence exact matches, fuzzy matches, unmatched residuals |
| Gap analysis end-to-end | Create model → sync → run analysis → assign 2 controls → call `controlGaps` | Unmitigated count decreases, recommended controls ranked |
| Embedding round-trip | Install module with embeddings → query vector search | Classes returned with similarity scores |
| Module update re-embed | Install module → update class description → verify embedding updated | New similarity scores reflect updated description |
| Reindex after model change | Install module with model A → change EMBEDDING_MODEL to B → call `reindexClassEmbeddings` | All `embeddingModel` properties updated, vector search returns results consistent with model B |

### As-built coverage

Verified against the tree on 2026-09-01 (the `EmbeddingService` row on 2026-10-15). Each of these files is a targeted regression suite written
alongside a specific fix, which is why the coverage is deep on one axis and absent on the others.

| Service | Test file | Subject | Planned cases still open |
|---------|-----------|---------|--------------------------|
| `match_classes` | `oss/apps/dt-ws/src/gql/resolver-services/__tests__/match-classes-resolver.service.spec.ts` | The componentType filter across all matching tiers (6 cases) | Module filtering, empty elements array, max batch exceeded |
| `get_control_gaps` | `oss/apps/dt-ws/src/gql/resolver-services/__tests__/control-gaps-resolver.service.spec.ts` (unit, 4 cases) + `oss/apps/dt-ws/test/integration/control-gaps.e2e-spec.ts` (live Memgraph, 4 cases) | Graph-Integer LIMIT binding, bucket accounting summing to `totalExposures`, `configuredCoverage` feeding the Phase-3 pool, empty-scope short-circuit; live: nested boundary/flow exposures, a boundary-less model, the mitigated path | Unaddressable (no ControlClass) |
| `findControls` | `oss/packages/dt-core/src/dt-control/__tests__/find-controls-intersect.test.ts` | The `controlId` + `elementIds` intersection — notably that a disjoint pair yields an empty id set rather than everything | Filter by class, by module, combined filters |
| `assignControlToElements` | `oss/packages/dt-core/src/dt-control/__tests__/assign-control-idempotent.test.ts` | Idempotency across sequential calls (8 cases): the connect delta, the three typed paths, dedup of both the incoming list and the read, no-mutation-when-attached, read-failure propagation | — |
| `EmbeddingService` | `oss/apps/dt-ws/src/gql/services/__tests__/embedding.service.spec.ts` | Against a stubbed in-process embedder: the profile and the ignored HTTP-embedder settings, the start-up wait and the ready signal, the start (verification, warm-up failure, a worker that fails after it was ready, a failed acquisition), a shutdown during a download, the pending state, `embedEach`'s per-text fallback, the disabled paths. The worker thread, the download and the verification are tested in the `@dethernety/embedder` package's own suite | An embed against the real model inside dt-ws |

Of the five planned integration flows, only **gap analysis end-to-end** landed. No integration spec
exercises `matchClasses`, and the embedding flows have little coverage —
`reindex-class-embeddings.spec.ts` covers only which modules `reindexClassEmbeddings` records the
active embedder on.

**Two cautions.** The dt-core suites assert what the writer *emits* against a mocked Apollo client,
not what a graph ends up holding. And `oss/apps/dt-ws/test/integration/relationship-edge-uniqueness.e2e-spec.ts`
is **not** `assignControlToElements`' graph-level proof, despite the overlapping subject: it exercises
the element-side association write path (`Component.controls` with per-entry `id: { eq: }` connects)
and never the `id: { in: }` broadcast this method uses. Do not cite it as such.

### Performance benchmarks

| Scenario | Target | Measure |
|----------|--------|---------|
| `match_classes`: 15 elements, 300 classes, no vector | < 100ms | End-to-end resolver time |
| `match_classes`: 15 elements, 300 classes, with vector | < 500ms | Including batch embedding |
| `get_control_gaps`: 20 components, 50 exposures, 10 controls | < 200ms | Cypher execution time |
| Module install with 50 classes + embeddings (local model) | < 2s | Total ingestion time |

---

## Related Documents

- [BACKEND_DELEGATION.md](BACKEND_DELEGATION.md) — Architecture rationale and decision framework
- [CONTROL_INTEGRATION.md](CONTROL_INTEGRATION.md) — Control workflow design (consumer of these services)
- [PLUGIN_ARCHITECTURE.md](PLUGIN_ARCHITECTURE.md) — MCP server architecture (MCP tool layer above dt-core)
- [MCP_ARCHITECTURE.md](MCP_ARCHITECTURE.md) — How MCP tools wrap dt-core methods
