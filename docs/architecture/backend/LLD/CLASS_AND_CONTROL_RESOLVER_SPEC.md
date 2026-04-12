# Backend Services Specification

> Detailed specification for new backend services on the Dethernety platform (dt-ws + dt-core). These services support both the Claude Code plugin (Dethereal) and the Dethernety web UI. Implementable independently from plugin changes. Status: **draft**.

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
- `classLabel` maps directly to the graph label: `COMPONENT` → `ComponentClass`, `SECURITY_BOUNDARY` → `SecurityBoundaryClass`, `DATA_FLOW` → `DataFlowClass`, `DATA` → `DataClass`, `CONTROL` → `ControlClass`.
- `componentType`: optional filter, only applicable when `classLabel = COMPONENT`. Filters `ComponentClass` nodes by their `type` property (`PROCESS`, `STORE`, `EXTERNAL_ENTITY`). Ignored for other class labels.
- `moduleIds`: when provided, only search classes from these modules. When absent, search all modules.

### Match priority implementation

The resolver executes priorities sequentially, short-circuiting per element when a high-confidence match is found.

#### Priority 1: Exact name match (deterministic)

**Note:** All Cypher queries in this section use `ComponentClass` as an example label. In the resolver, substitute the label dynamically via `classLabelToNodeLabel(classLabel)`. When `classLabel = COMPONENT` and `componentType` is provided, add `AND c.type = $componentType` to the WHERE clause.

```cypher
MATCH (c:ComponentClass)<-[:HAS_CLASS]-(m:Module)
WHERE toLower(c.name) = toLower($element_name)
  AND ($module_ids IS NULL OR m.id IN $module_ids)
RETURN c.id, c.name, c.description, c.category, m.name AS moduleName
```

Case-insensitive exact match against class names.

#### Priority 2: Fuzzy name match (deterministic)

For elements not matched by exact name. Use substring containment with a minimum length guard:

```typescript
// Server-side in the resolver, not in Cypher
function fuzzyMatch(elementName: string, className: string): boolean {
  const a = elementName.toLowerCase()
  const b = className.toLowerCase()
  // Skip very short inputs to avoid false positives ("DB" matching "DeBug")
  if (a.length < 3 && b.length < 3) return false
  // Substring: "Postgres" matches "PostgreSQL", "API" matches "API Gateway"
  if (b.includes(a) || a.includes(b)) return true
  return false
}
```

No Levenshtein — character-level edit distance on short identifiers produces more false positives than value. Elements that don't substring-match fall through to vector similarity (Priority 3) or agent reasoning (Pass 2), which are better equipped for approximate matching.

Fetch all classes of the target label (scoped to modules), run `fuzzyMatch` in-memory. The class count is bounded by module filtering (typically 30-300, not thousands).

#### Priority 3: Vector similarity (optional, requires embedding index, Memgraph only)

Only if the HNSW index exists and elements have descriptions. Memgraph-only — Neo4j deployments skip this priority (same as when embeddings are disabled).

```cypher
// vector_search.search() takes exactly 3 params: (index_name, limit, query_vector)
// No filter parameter exists — post-filter with WHERE
// Request 2-3x topN to allow for post-filtering
CALL vector_search.search('component_class_embeddings', 10, $query_vector)
YIELD node, similarity
WHERE similarity >= $threshold
  AND ($component_type IS NULL OR node.type = $component_type)
MATCH (node)<-[:HAS_CLASS]-(m:Module)
WHERE $module_ids IS NULL OR m.id IN $module_ids
RETURN node.id, node.name, node.description, node.category, m.name AS moduleName, similarity
ORDER BY similarity DESC
LIMIT $top_n
```

See Section 7 for the embedding pipeline. The threshold is configurable (default: 0.75).

**Detecting index availability:** Before executing vector search, check if the index exists:
```cypher
// Option 1: DDL query
SHOW VECTOR INDEX INFO

// Option 2: Procedure (filter for a specific index)
CALL vector_search.show_index_info() YIELD index_name
WHERE index_name = 'component_class_embeddings'
RETURN index_name
```
If this fails (syntax error on Neo4j, procedure not found on Memgraph < 3.0) or returns no results, skip Priority 3.

#### Priority 4: Type-filtered heuristic (fallback)

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
- Access to the embedding service (for Priority 3) — inject as optional dependency

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

The HNSW index name follows the label: `component_class_embeddings`, `control_class_embeddings`, etc.

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

Optional enhancement for `match_classes` Priority 3 (vector similarity). Memgraph-only — Neo4j deployments skip vector search entirely (same as when embeddings are disabled). When enabled, class nodes are embedded during module ingestion and indexed via Memgraph HNSW. When disabled, `match_classes` falls back to priorities 1-2-4 (deterministic + fuzzy matching).

### Configuration

The embedding service is a thin HTTP client — it calls any OpenAI-compatible embeddings endpoint. There is no provider distinction in code. Local (Ollama, LocalAI) vs cloud (OpenAI, Bedrock) is a deployment decision, not a code path.

```typescript
// Environment variables
EMBEDDING_ENABLED=true|false        // default: false
EMBEDDING_URL=http://localhost:11434/api/embeddings  // any OpenAI-compatible endpoint
EMBEDDING_API_KEY=                  // empty for local (Ollama), set for cloud (OpenAI, Bedrock)
EMBEDDING_MODEL=nomic-embed-text   // model name passed in the request body
EMBEDDING_DIMENSIONS=768            // must match model output
EMBEDDING_SIMILARITY_THRESHOLD=0.75 // configurable
```

**Deployment examples:**

| Stack | `EMBEDDING_URL` | `EMBEDDING_API_KEY` | Notes |
|-------|----------------|--------------------| ------|
| Ollama (local) | `http://ollama:11434/api/embeddings` | (empty) | Add Ollama to `docker-compose.yml` |
| LocalAI (local) | `http://localai:8080/v1/embeddings` | (empty) | OpenAI-compatible API |
| OpenAI (cloud) | `https://api.openai.com/v1/embeddings` | `sk-...` | Uses `text-embedding-3-small` or similar |
| AWS Bedrock (cloud) | Bedrock endpoint | AWS credentials | Via OpenAI-compatible proxy or direct SDK |

### Index creation (platform setup)

Create one HNSW index per class label. Run at platform startup or on first module install. **Not idempotent** — duplicate creation raises an error; check existence via `vector_search.show_index_info()` first or wrap in error handling.

```cypher
CREATE VECTOR INDEX component_class_embeddings ON :ComponentClass(embedding)
  WITH CONFIG {"dimension": 768, "capacity": 500, "metric": "cos"};
CREATE VECTOR INDEX control_class_embeddings ON :ControlClass(embedding)
  WITH CONFIG {"dimension": 768, "capacity": 500, "metric": "cos"};
CREATE VECTOR INDEX dataflow_class_embeddings ON :DataFlowClass(embedding)
  WITH CONFIG {"dimension": 768, "capacity": 500, "metric": "cos"};
CREATE VECTOR INDEX boundary_class_embeddings ON :SecurityBoundaryClass(embedding)
  WITH CONFIG {"dimension": 768, "capacity": 500, "metric": "cos"};
CREATE VECTOR INDEX data_class_embeddings ON :DataClass(embedding)
  WITH CONFIG {"dimension": 768, "capacity": 500, "metric": "cos"};
```

Vector search is built into Memgraph core since version 3.0 (not a MAGE add-on). Neo4j support is not in scope for this phase — Neo4j deployments skip Priority 3. The `capacity` parameter sets initial HNSW index size (Memgraph rounds up internally, e.g. 500 → 512). Start small and resize via `reindexClassEmbeddings` as the module ecosystem grows. The metric name is `"cos"` (not `"cosine"`).

### Embedding service

```
dt-ws/src/gql/services/embedding.service.ts
```

```typescript
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name)
  private enabled: boolean
  private url: string
  private apiKey: string
  private model: string

  constructor(private configService: ConfigService) {
    this.enabled = configService.get('EMBEDDING_ENABLED') === 'true'
    this.url = configService.get('EMBEDDING_URL') || ''
    this.apiKey = configService.get('EMBEDDING_API_KEY') || ''
    this.model = configService.get('EMBEDDING_MODEL') || 'nomic-embed-text'
  }

  isEnabled(): boolean { return this.enabled }

  getModel(): string { return this.model }

  /**
   * Embed a batch of texts via the configured HTTP endpoint.
   * Returns null if embeddings are disabled.
   * Retries up to 3 times with exponential backoff (1s, 3s, 9s) on failure.
   * Throws after all retries are exhausted.
   */
  async embedBatch(texts: string[]): Promise<number[][] | null> {
    if (!this.enabled) return null

    const maxRetries = 3
    const backoffBase = 1000 // 1s, 3s, 9s

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // OpenAI-compatible embeddings API (works with Ollama, LocalAI, OpenAI, etc.)
        const response = await fetch(this.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify({ model: this.model, input: texts }),
        })
        if (!response.ok) throw new Error(`Embedding API returned ${response.status}`)
        const data = await response.json()
        return data.data.map((item: any) => item.embedding)
      } catch (error) {
        if (attempt === maxRetries) throw error
        const delay = backoffBase * Math.pow(3, attempt - 1)
        this.logger.warn(`Embedding attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  /**
   * Compose the embedding text for a class node.
   */
  composeClassText(cls: { name: string, description?: string, category?: string, type?: string }): string {
    return `${cls.name}. ${cls.description || ''}. Category: ${cls.category || 'General'}. Type: ${cls.type || 'Unknown'}.`
  }

  /**
   * Compose the embedding text for a query element.
   */
  composeElementText(element: { name: string, description?: string, type?: string }): string {
    return `${element.name}. ${element.description || ''}. Type: ${element.type || 'Unknown'}.`
  }
}
```

### Module ingestion integration

In `ModuleManagementService.upsertModule()` (`module-management.service.ts`), before the class upsert loop. `EmbeddingService` is injected into `ModuleManagementService`.

```typescript
// In module-management.service.ts, inside upsertModule()

// 1. Collect all classes from the module metadata (all class labels)
const allClasses: { cls: any, label: string }[] = []
for (const modClass of MODULE_CLASS_CONFIGS) {
  const classes = metadata[modClass.key]
  if (classes && Array.isArray(classes)) {
    for (const cls of classes) {
      allClasses.push({ cls, label: modClass.label })
    }
  }
}

// 2. Batch-embed all classes (if enabled)
let vectors: number[][] | null = null
if (this.embeddingService.isEnabled()) {
  const texts = allClasses.map(({ cls }) => this.embeddingService.composeClassText(cls))
  vectors = await this.embeddingService.embedBatch(texts)
  // embedBatch returns null when disabled; throws after 3 retries when enabled but unreachable
  // If embedBatch throws, the error propagates and fails the module install
}

// 3. Upsert each class with its embedding vector (if available)
for (let i = 0; i < allClasses.length; i++) {
  const { cls, label } = allClasses[i]
  const embedding = vectors ? vectors[i] : undefined
  await this.upsertClass(tx, moduleId, cls, label, embedding)
}
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

The Memgraph HNSW index automatically includes any node with an `embedding` property that matches the index definition — no separate indexing step is needed.

### Failure behavior

If `EMBEDDING_ENABLED=true` but the embedding model is unreachable during module install:
- **Retry 3 times with exponential backoff** (1s, 3s, 9s). This handles transient failures: network blips, embedding model cold-starting, temporary service unavailability.
- If all retries fail, **module install fails** with a clear error: "Embedding model unavailable after 3 retries. Fix the embedding service and retry, or disable embeddings (EMBEDDING_ENABLED=false)."
- No partial state — either all classes are inserted with embeddings, or nothing is inserted. This prevents a state where the module is installed without embeddings and is never re-processed (since the module registry won't re-ingest an already-registered module).

### Model version tracking

Store the embedding model identifier alongside vectors to detect version drift:

```cypher
CREATE (c:ComponentClass {
    ...,
    embedding: item.vector,
    embeddingModel: $model_identifier  // e.g., "nomic-embed-text"
})
```

At query time, if the configured model differs from `embeddingModel` on class nodes, log a warning: "Embedding model mismatch — re-embed classes with `/module re-embed`." The mismatch produces unreliable similarity scores but does not crash.

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

When the embedding model changes (e.g., `nomic-embed-text` → a newer model), all class vectors must be recomputed before the new model is used for queries. A GraphQL mutation exposes this as a platform operation:

```graphql
type Mutation {
  reindexClassEmbeddings(moduleIds: [ID!]): ReindexResult!
}

type ReindexResult {
  reindexedCount: Int!
  moduleNames: [String!]!
}
```

**Behavior:**
- When `moduleIds` is provided, re-embeds classes from those modules only. When absent, re-embeds all classes across all modules.
- Reads all class nodes (all 5 labels), composes embedding text, calls the embedding endpoint in batches, writes vectors back with the current `embeddingModel` identifier.
- This is a **blocking operation** — the mutation does not return until all vectors are updated. Stale vectors during a partial reindex would produce incorrect similarity rankings.
- Authorization required: same `AuthorizationService` pattern as other custom resolvers.

**When to use:**
- After changing `EMBEDDING_MODEL` in configuration
- After upgrading Ollama to a new model version that produces different vectors
- As a recovery step if class data was manually modified in the graph

The mutation lives in the same resolver as `match_classes` (`match-classes-resolver.service.ts`) since it shares the `EmbeddingService` dependency.

---

## 8. Implementation Sequence

```
Phase A1: match_classes (deterministic only — priorities 1, 2, 4)
  Files:
    - dt-ws/schema/schema.graphql (add new types, inputs, enums)
    - dt-ws/src/gql/resolver-services/match-classes-resolver.service.ts (new)
    - dt-ws/src/gql/custom-resolver.module.ts (register)
    - dt-core/src/dt-class/dt-class.ts (new matchClasses method, wraps GraphQL)
    - dt-core/src/dt-class/dt-class-gql.ts (new query)
  No embedding infrastructure. Works immediately.

Phase A2: match_classes (add vector — priority 3, Memgraph only)
  Files:
    - dt-ws/schema/schema.graphql (add ReindexResult type, reindexClassEmbeddings mutation)
    - dt-ws/src/gql/services/embedding.service.ts (new)
    - dt-ws/src/gql/module-management-services/module-management.service.ts (integrate embedding into upsertModule/upsertClass)
    - dt-ws/src/gql/custom-resolver.module.ts (register EmbeddingService)
    - Match classes resolver (add vector search branch + reindexClassEmbeddings mutation)
  Requires: Memgraph with vector_search MAGE module. Neo4j deployments skip Priority 3.

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

### Unit tests

| Service | Test file | Key cases |
|---------|----------|-----------|
| `match_classes` | `match-classes-resolver.service.spec.ts` | Exact name, fuzzy name (substring), no match, componentType filter, module filtering, empty elements array, max batch exceeded |
| `get_control_gaps` | `control-gaps-resolver.service.spec.ts` | Zero exposures, all mitigated, some unmitigated, unaddressable (no ControlClass), empty model |
| `findControls` | `dt-control.spec.ts` | Filter by class, by element, by module, combined filters, empty results |
| `assignControlToElements` | `dt-control.spec.ts` | Single assign, batch assign, idempotent re-assign |
| `EmbeddingService` | `embedding.service.spec.ts` | Disabled mode, local model, batch embedding, retry on failure, model unavailable after retries |

### Integration tests

| Test | Setup | Assertion |
|------|-------|-----------|
| Full classification flow | Create module with 10 classes → call `matchClasses` with 5 elements | High-confidence exact matches, fuzzy matches, unmatched residuals |
| Gap analysis end-to-end | Create model → sync → run analysis → assign 2 controls → call `controlGaps` | Unmitigated count decreases, recommended controls ranked |
| Embedding round-trip | Install module with embeddings → query vector search | Classes returned with similarity scores |
| Module update re-embed | Install module → update class description → verify embedding updated | New similarity scores reflect updated description |
| Reindex after model change | Install module with model A → change EMBEDDING_MODEL to B → call `reindexClassEmbeddings` | All `embeddingModel` properties updated, vector search returns results consistent with model B |

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
