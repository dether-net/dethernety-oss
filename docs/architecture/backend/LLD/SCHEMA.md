# Graph Database Schema

This document describes the graph database schema used by Dethernety. The schema is defined in `apps/dt-ws/schema/schema.graphql` and uses the Neo4j GraphQL Library to map GraphQL types directly to graph nodes and relationships.

The database uses Bolt protocol and Cypher query language, supporting both Neo4j and Memgraph.

---

## Enums

### ComponentType

```graphql
enum ComponentType {
  PROCESS
  EXTERNAL_ENTITY
  STORE
  BOUNDARY
  SECURITY_BOUNDARY
  DATA_FLOW
}
```

### TrustLevel

```graphql
enum TrustLevel {
  UNTRUSTED
  SEMI_TRUSTED
  TRUSTED
}
```

### AttackVector

```graphql
enum AttackVector {
  NETWORK
  ADJACENT
  LOCAL
  PHYSICAL
  UNSPECIFIED
}
```

### ValueType

```graphql
enum ValueType {
  STRING
  NUMBER
  BOOLEAN
  DATE
}
```

---

## Core Modeling Elements

### Model

Represents a system model containing components, boundaries, and data flows.

**Properties:**
- `id` (ID!) — Unique identifier
- `name` (String!) — Model name
- `description` (String) — Model description

**Relationships:**
- `(Model)-[:CONTAINS]->(SecurityBoundary)` — Default boundary for the model
- `(Model)-[:HAS_MODULE]->(Module)` — Modules associated with the model
- `(Model)<-[:SUPPORTS]-(Control)` — Controls supporting elements in the model
- `(Model)-[:CONTAINS]->(Data)` — Data elements within the model
- `(Model)<-[:REPRESENTS_MODEL]-(Element)` — Elements representing the model (for nested models)
- `(Model)-[:ANALYZED_BY]->(Analysis)` — Analyses of the model
- `(Model)-[:HAS_ISSUE]->(Issue)` — Issues associated with the model
- `(Model)<-[:FOLDER_CONTAINS]-(Folder)` — Parent folder

### Component

Represents a key entity in the system (process, store, external entity).

**Properties:**
- `id` (ID!) — Unique identifier
- `name` (String!) — Component name
- `description` (String) — Component description
- `type` (ComponentType!) — Type of component
- `positionX` (Float) — X coordinate on canvas
- `positionY` (Float) — Y coordinate on canvas
- `dimensionsWidth` (Float) — Width on canvas
- `dimensionsHeight` (Float) — Height on canvas

**Relationships:**
- `(Component)-[:BELONGS_TO]->(SecurityBoundary)` — Parent boundary
- `(Component)-[:FLOWS]->(DataFlow)` — Outgoing data flows
- `(Component)<-[:FLOWS]-(DataFlow)` — Incoming data flows
- `(Component)-[:HAS_EXPOSURE]->(Exposure)` — Exposures on this component
- `(Component)<-[:SUPPORTS]-(Control)` — Controls supporting this component
- `(Component)-[:HANDLES]->(Data)` — Data elements handled by this component
- `(Component)-[:IS_INSTANCE_OF]->(ComponentClass)` — Component class
- `(Component)-[:REPRESENTS_MODEL]->(Model)` — Model represented by this component (nested models)
- `(Component)-[:ANALYZED_BY]->(Analysis)` — Analyses of this component
- `(Component)-[:HAS_ISSUE]->(Issue)` — Issues associated with this component

### DataFlow

Represents the flow of data between two components.

**Properties:**
- `id` (ID!) — Unique identifier
- `name` (String!) — Data flow name
- `description` (String) — Data flow description
- `sourceHandle` (String) — Handle for the source component
- `targetHandle` (String) — Handle for the target component
- `dataFlowTypes` ([String!]) — Types of data flow

**Relationships:**
- `(DataFlow)<-[:FLOWS]-(Component)` — Source component
- `(DataFlow)-[:FLOWS]->(Component)` — Target component
- `(DataFlow)-[:HAS_EXPOSURE]->(Exposure)` — Exposures on this data flow
- `(DataFlow)<-[:SUPPORTS]-(Control)` — Controls supporting this data flow
- `(DataFlow)-[:HANDLES]->(Data)` — Data elements carried by this flow
- `(DataFlow)-[:IS_INSTANCE_OF]->(DataFlowClass)` — Data flow class
- `(DataFlow)-[:ANALYZED_BY]->(Analysis)` — Analyses of this data flow
- `(DataFlow)-[:HAS_ISSUE]->(Issue)` — Issues associated with this data flow

### SecurityBoundary

Represents a trust boundary within the system.

**Properties:**
- `id` (ID!) — Unique identifier
- `name` (String!) — Boundary name
- `description` (String) — Boundary description
- `trustLevel` (TrustLevel!) — Trust level
- `positionX` (Float) — X coordinate on canvas
- `positionY` (Float) — Y coordinate on canvas
- `dimensionsWidth` (Float) — Width on canvas
- `dimensionsHeight` (Float) — Height on canvas
- `dimensionsMinWidth` (Float) — Minimum width on canvas
- `dimensionsMinHeight` (Float) — Minimum height on canvas

**Relationships:**
- `(SecurityBoundary)<-[:CONTAINS]-(Model)` — Parent model
- `(SecurityBoundary)<-[:BELONGS_TO]-(Component)` — Components within this boundary
- `(SecurityBoundary)<-[:BELONGS_TO]-(SecurityBoundary)` — Child boundaries
- `(SecurityBoundary)-[:BELONGS_TO]->(SecurityBoundary)` — Parent boundary
- `(SecurityBoundary)-[:HAS_EXPOSURE]->(Exposure)` — Exposures on this boundary
- `(SecurityBoundary)<-[:SUPPORTS]-(Control)` — Controls supporting this boundary
- `(SecurityBoundary)-[:HANDLES]->(Data)` — Data elements handled by this boundary
- `(SecurityBoundary)-[:IS_INSTANCE_OF]->(SecurityBoundaryClass)` — Boundary class
- `(SecurityBoundary)-[:REPRESENTS_MODEL]->(Model)` — Model represented by this boundary
- `(SecurityBoundary)-[:ANALYZED_BY]->(Analysis)` — Analyses of this boundary
- `(SecurityBoundary)-[:HAS_ISSUE]->(Issue)` — Issues associated with this boundary

**Cypher computed fields:**
- `allDescendantBoundaries` — All nested boundaries (recursive up to depth 10)
- `allDescendantComponents` — All components in nested boundaries
- `allDescendantDataFlows` — All data flows touching nested components

### Folder

Represents a folder for organizing models and controls.

**Properties:**
- `id` (ID!) — Unique identifier
- `name` (String!) — Folder name
- `description` (String) — Folder description

**Relationships:**
- `(Folder)<-[:FOLDER_CONTAINS]-(Folder)` — Parent folder
- `(Folder)-[:FOLDER_CONTAINS]->(Folder)` — Child folders
- `(Folder)-[:FOLDER_CONTAINS]->(Model)` — Models in this folder
- `(Folder)-[:FOLDER_CONTAINS]->(Control)` — Controls in this folder

---

## Data and Classification

### Data

Represents data elements within the system.

**Properties:**
- `id` (ID!) — Unique identifier
- `name` (String!) — Data name
- `description` (String) — Data description

**Relationships:**
- `(Data)<-[:CONTAINS]-(Model)` — Parent model
- `(Data)-[:IS_INSTANCE_OF]->(DataClass)` — Data class
- `(Data)<-[:HANDLES]-(Component)` — Components handling this data
- `(Data)<-[:HANDLES]-(DataFlow)` — Data flows carrying this data
- `(Data)<-[:HANDLES]-(SecurityBoundary)` — Boundaries handling this data
- `(Data)-[:HAS_EXPOSURE]->(Exposure)` — Exposures on this data
- `(Data)-[:ANALYZED_BY]->(Analysis)` — Analyses of this data
- `(Data)-[:HAS_ISSUE]->(Issue)` — Issues associated with this data

---

## Security Elements

### Exposure

Represents a potential security vulnerability.

**Properties:**
- `id` (ID!) — Unique identifier
- `name` (String!) — Exposure name
- `description` (String) — Exposure description
- `type` (String) — Exposure type
- `category` (String) — Exposure category
- `score` (Int) — Risk score
- `references` (String) — References
- `mitigationSuggestions` ([String!]) — Suggested mitigations
- `detectionMethods` ([String!]) — Detection methods
- `tags` ([String!]) — Tags
- `techniques` ([String!]) — Related techniques
- `attackVector` (AttackVector) — CVSS v3.1-aligned attack vector (NETWORK, ADJACENT, LOCAL, PHYSICAL, UNSPECIFIED)
- `createdBy` (String) — Provenance marker, server-stamped at CREATE. See [Provenance fields on Exposure and Countermeasure](#provenance-fields-on-exposure-and-countermeasure).
- `authoredBy` (String) — Author reference, server-stamped at CREATE. See [Provenance fields on Exposure and Countermeasure](#provenance-fields-on-exposure-and-countermeasure).

**Relationships:**
- `(Exposure)<-[:HAS_EXPOSURE]-(Component|DataFlow|SecurityBoundary|Data)` — Element with this exposure
- `(Exposure)-[:EXPLOITED_BY]->(MitreAttackTechnique)` — ATT&CK techniques exploiting this exposure
- `(Exposure)-[:HAS_ISSUE]->(Issue)` — Issues associated with this exposure

### Control

Represents a security control.

**Properties:**
- `id` (ID!) — Unique identifier
- `name` (String!) — Control name
- `description` (String) — Control description
- `type` (String) — Control type
- `category` (String) — Control category

**Relationships:**
- `(Control)-[:IS_INSTANCE_OF]->(ControlClass)` — Control class
- `(Control)-[:SUPPORTS]->(Element)` — Elements supported by this control
- `(Control)-[:HAS_COUNTERMEASURE]->(Countermeasure)` — Countermeasures for this control
- `(Control)<-[:FOLDER_CONTAINS]-(Folder)` — Parent folder
- `(Control)-[:ANALYZED_BY]->(Analysis)` — Analyses of this control
- `(Control)-[:HAS_ISSUE]->(Issue)` — Issues associated with this control

### Countermeasure

Represents a specific countermeasure implementation.

**Properties:**
- `id` (ID!) — Unique identifier
- `name` (String!) — Countermeasure name
- `description` (String) — Countermeasure description
- `type` (String) — Countermeasure type
- `category` (String) — Countermeasure category
- `score` (Int) — Effectiveness score
- `references` (String) — References
- `addressedExposures` ([String!]) — Addressed exposures
- `tags` ([String!]) — Tags
- `createdBy` (String) — Provenance marker, server-stamped at CREATE. See [Provenance fields on Exposure and Countermeasure](#provenance-fields-on-exposure-and-countermeasure).
- `authoredBy` (String) — Author reference, server-stamped at CREATE. See [Provenance fields on Exposure and Countermeasure](#provenance-fields-on-exposure-and-countermeasure).

**Relationships:**
- `(Countermeasure)-[:RESPONDS_WITH]->(MitreAttackMitigation)` — ATT&CK mitigations
- `(Countermeasure)-[:RESPONDS_WITH]->(MitreDefendTechnique)` — D3FEND techniques
- `(Countermeasure)<-[:HAS_COUNTERMEASURE]-(Control)` — Parent control
- `(Countermeasure)-[:IS_COUNTERMEASURE_OF]->(ControlClass)` — Control class
- `(Countermeasure)-[:HAS_ISSUE]->(Issue)` — Issues associated with this countermeasure

### Provenance fields on Exposure and Countermeasure

Every `Exposure` and `Countermeasure` carries two server-stamped provenance fields:

| Field | Values | Set by |
|-------|--------|--------|
| `createdBy` | `'USER'` &#124; `'SYSTEM'` &#124; `null` (legacy data, treated as SYSTEM by cleanup paths) | CREATE-time only. USER findings: `stampCreatedByUserOnCreate` `@populatedBy` callback in [`src/gql/populated-by/authored-by.ts`](../../../../apps/dt-ws/src/gql/populated-by/authored-by.ts) fires on the auto-generated `createExposures` / `createCountermeasures` mutations. SYSTEM findings: stamped inline by the Cypher MERGE in `SetInstantiationAttributesService` / `ElementBindingService`. |
| `authoredBy` | USER: the authenticated user identifier (JWT `sub` claim). SYSTEM: optional module-provided attribution string (feed name, advisory id, researcher name) flowing through the resolver's sanitised attribute allowlist. | CREATE-time only. USER findings: `populateAuthoredByOnCreate` callback (same file). SYSTEM findings: included in the module-returned `Exposure` / `Countermeasure` object, passed through the allowlist in [`src/gql/resolver-services/shared/finding-attrs.ts`](../../../../apps/dt-ws/src/gql/resolver-services/shared/finding-attrs.ts). |

Both fields are sealed against UPDATE-path forgery: each is declared with `@populatedBy(operations: [CREATE])` **and** `@settable(onUpdate: false)`. The `@populatedBy` directive overrides any client-supplied value on the auto-generated `createExposures` / `createCountermeasures` shapes; the `@settable(onUpdate: false)` directive removes the field from the auto-generated `updateExposures` / `updateCountermeasures` input types entirely. Together they preserve `createdBy = 'USER'` as a tamper-evident marker that the destructive sweep in [`changeElementBinding`](#mutations) can trust.

The sweep predicates in `ElementBindingService` require `createdBy = 'SYSTEM' OR createdBy IS NULL` — USER findings are preserved unconditionally; legacy null-`createdBy` rows are treated as SYSTEM (covered by the legacy-null adoption suite in `test/integration/provenance.e2e-spec.ts`).

---

## Issue Tracking

### Issue

Represents an issue linked to model elements, typically synced with external trackers.

**Properties:**
- `id` (ID!) — Unique identifier
- `name` (String!) — Issue name
- `description` (String) — Issue description
- `type` (String) — Issue type
- `category` (String) — Issue category
- `issueStatus` (String) — Current status
- `comments` ([String!]) — Comments
- `attributes` (String) — Custom attributes
- `lastSyncAt` (String) — Last sync timestamp
- `createdAt` (String) — Creation timestamp
- `updatedAt` (String) — Last update timestamp

**Relationships:**
- `(Issue)<-[:HAS_ISSUE]-(Model|Component|DataFlow|SecurityBoundary|Control|Data|Analysis|Exposure|Countermeasure)` — Linked elements
- `(Issue)-[:IS_INSTANCE_OF]->(IssueClass)` — Issue class

**Computed fields:**
- `syncedAttributes` — Attributes merged with external tracker data (custom resolver)
- `elementsWithExtendedInfo` — Linked elements with model context (Cypher query)

### IssueClass

Represents a class of issues, provided by a module.

**Properties:**
- `id` (ID!) — Unique identifier
- `name` (String!) — Class name
- `description` (String) — Class description
- `type` (String) — Issue type
- `category` (String) — Issue category

**Relationships:**
- `(IssueClass)<-[:HAS_CLASS]-(Module)` — Parent module
- `(IssueClass)<-[:IS_INSTANCE_OF]-(Issue)` — Issues of this class

**Computed fields:**
- `template` — UI template (custom resolver)

---

## Module System

### Module

Represents a module providing classes for modeling, analysis, and issue tracking.

**Properties:**
- `id` (ID!) — Unique identifier
- `name` (String!) — Module name
- `version` (String!) — Module version
- `description` (String) — Module description
- `path` (String) — Module path
- `attributes` (String) — Module attributes

**Class-identity admin properties** (persisted on the Module node by the install flow):
- `idRebindPolicy` (String) — `audit` \| `strict` \| `silent` (from module metadata at last install)
- `lastInstallStatus` (String) — `authoritative` \| `partial` \| `unavailable` \| `error`
- `lastAttemptedInstall` (DateTime) — Most recent install attempt
- `lastAuthoritativeInstall` (DateTime) — Most recent clean install
- `lastInstallClassIds` (String) — JSON snapshot of `[{classKind, className, declaredId}]` written at every install attempt (internal — read by the `rebindConflicts` resolver to compute the diff against current DB ids; self-healing, every install overwrites)

**Relationships:**
- `(Module)<-[:HAS_MODULE]-(Model)` — Models using this module
- `(Module)-[:HAS_CLASS]->(ComponentClass | DataFlowClass | SecurityBoundaryClass | ControlClass | DataClass | AnalysisClass | IssueClass)` — Active classes provided by this module
- `(Module)-[:HAS_ORPHANED_CLASS]->(ComponentClass | DataFlowClass | SecurityBoundaryClass | ControlClass | DataClass | AnalysisClass | IssueClass)` — Classes retired by the module that still have existing instances. The `HAS_CLASS` → `HAS_ORPHANED_CLASS` rename is what "orphaned" means at the graph level; edge properties are preserved across the rename and the inverse rename (`reviveOrphanedClass`)

**Computed fields:**
- `template` — Module template (custom resolver)
- `rebindConflicts` — Per-class strict-mode rebind conflicts from the most recent install (custom resolver — joins `lastInstallClassIds` against current DB ids; rows where they differ are surfaced as `RebindConflictDetail`)
- `constraintsHealthy` — Reflects the bootstrap result from `EnsureConstraintsService` — same value for every Module today (the safety net is a global property of the deployment, exposed per-Module for surfaceability)

### Class Types

All class types share the same base structure:

**Common Properties:**
- `id` (ID!) — Unique identifier
- `name` (String!) — Class name (the stable identifier across rebinds; carries the operational identity of the class)
- `description` (String) — Class description
- `type` (String or ComponentType) — Class type
- `category` (String) — Class category
- `path` (String) — Class path
- `orphanedAt` (DateTime) — Timestamp at which this class was last orphaned (HAS_CLASS → HAS_ORPHANED_CLASS rename). Null if never orphaned

**Common Relationships:**
- `(Class)<-[:HAS_CLASS]-(Module)` — Parent module (active)
- `(Class)<-[:HAS_ORPHANED_CLASS]-(Module)` — Parent module (orphaned — class is retired by the module but still attached to existing instances)
- `(Class)<-[:IS_INSTANCE_OF]-(Instance)` — Instances of this class

**Common Computed Fields:**
- `template` — UI configuration template (custom resolver)
- `guide` — Usage documentation (custom resolver)
- `incomingInstanceCount` (Int!) — Count of `:IS_INSTANCE_OF` edges (Cypher computed)
- `incomingInstancesByType` ([TypeCount!]!) — Per-parent-label breakdown of `:IS_INSTANCE_OF` edges (Cypher computed) — surfaces "this includes Analyses (user work)" warnings in the cascade-delete UI

The class types are:

| Class Type | Instance Type | Additional Properties |
|-----------|--------------|----------------------|
| `ComponentClass` | Component | `type: ComponentType!` |
| `SecurityBoundaryClass` | SecurityBoundary | `type: ComponentType!` |
| `DataFlowClass` | DataFlow | `type: ComponentType!` |
| `ControlClass` | Control | `supportedTypes: [ComponentType!]`, `supportedCategories: [String!]` |
| `DataClass` | Data | — |
| `AnalysisClass` | Analysis | — |
| `IssueClass` | Issue | — (see Issue Tracking section) |

`ControlClass` also has: `(ControlClass)<-[:IS_COUNTERMEASURE_OF]-(Countermeasure)` — countermeasures belonging to this class.

---

## Analysis System

### Analysis

Represents an analysis run on a model element.

**Properties:**
- `id` (ID!) — Unique identifier
- `name` (String!) — Analysis name
- `description` (String) — Analysis description
- `type` (String) — Analysis type
- `category` (String) — Analysis category

**Relationships:**
- `(Analysis)-[:IS_INSTANCE_OF]->(AnalysisClass)` — Analysis class
- `(Analysis)<-[:ANALYZED_BY]-(Model|Component|DataFlow|SecurityBoundary|Control|Data)` — Analyzed elements
- `(Analysis)-[:HAS_ISSUE]->(Issue)` — Issues from this analysis

**Computed fields:**
- `status` — Current analysis status including messages and metadata (custom resolver)
- `valueKeys` — Available result keys (custom resolver)

### AnalysisStatus

Runtime status of an analysis (not a graph relationship — resolved via custom resolver).

**Properties:**
- `createdAt` (String!) — Creation timestamp
- `updatedAt` (String!) — Last update timestamp
- `status` (String!) — Current status
- `interrupts` (JSON) — Pending interrupts
- `messages` ([JSON!]) — Analysis messages
- `metadata` (JSON) — Additional metadata

---

## MITRE Framework Integration

### ATT&CK

| Type | Properties | Key Relationships |
|------|-----------|-------------------|
| `MitreAttackTactic` | `attack_id`, `attack_version`, `stix_id`, `stix_spec_version`, `stix_type` | `-[:TACTIC_INCLUDES_TECHNIQUE]->` MitreAttackTechnique |
| `MitreAttackTechnique` | `attack_id`, `attack_spec_version`, `attack_decreased`, `attack_subtechnique`, `attack_version`, `ref_url`, `stix_id`, `stix_spec_version`, `stix_type` | `<-[:SUBTECHNIQUE_OF]-` (subtechniques), `<-[:EXPLOITED_BY]-` Exposure, `<-[:MITIGATION_DEFENDS_AGAINST_TECHNIQUE]-` MitreAttackMitigation |
| `MitreAttackMitigation` | `attack_id`, `attack_deprecated`, `ref_url`, `attack_spec_version`, `stix_spec_version`, `stix_modified`, `stix_id`, `attack_version`, `stix_created`, `stix_revoked`, `stix_type` | `-[:MITIGATION_DEFENDS_AGAINST_TECHNIQUE]->` MitreAttackTechnique, `<-[:RESPONDS_WITH]-` Countermeasure |

### D3FEND

| Type | Properties | Key Relationships |
|------|-----------|-------------------|
| `MitreDefendTactic` | `attack_id`, `uri` | `<-[:ENABLES]-` MitreDefendTechnique |
| `MitreDefendTechnique` | `d3fendId`, `uri` | `-[:ENABLES]->` MitreDefendTactic, `<-[:SUB_TECHNIQUE_OF]-` (subtechniques), `<-[:RESPONDS_WITH]-` Countermeasure |

All MITRE types implement the `Element` interface (`id`, `name`, `description`).

---

## GraphQL Operations

### Queries

| Query | Parameters | Returns | Description |
|-------|-----------|---------|-------------|
| `getExposuresForElement` | `elementId` | `[Exposure!]!` | Get exposures for any element |
| `getAttributesFromClassRel` | `componentId`, `classId` | `JSON` | Get attributes from an IS_INSTANCE_OF relationship |
| `getNotRepreseningModels` | `modelId` | `[Model!]` | Get models not already represented by components in the given model |
| `getAnalysisValues` | `analysisId`, `valueKey` | `JSON!` | Get analysis result values by key |
| `getDocument` | `analysisId`, `filter` | `JSON!` | Get a document from an analysis |
| `getAvailableFrontendModules` | — | `[String!]!` | List modules with frontend bundles |
| `getModuleFrontendBundle` | `moduleName` | `String!` | Get a module's frontend JavaScript bundle |
| `classIdentityEvents` | `kind?`, `moduleName?`, `since?` | `[ClassIdentityEvent!]!` | Admin: read the in-memory class-identity event ring buffer (max 1000 events, process-local) |

### Mutations

| Mutation | Parameters | Returns | Description |
|----------|-----------|---------|-------------|
| `setInstantiationAttributes` | `componentId`, `classId`, `attributes` | `Boolean!` | Set attributes on an IS_INSTANCE_OF relationship |
| `changeElementBinding` | `elementId`, `target: ElementBindingInput` | `ChangeElementBindingResult!` | Atomically change an element's `IS_INSTANCE_OF` / `REPRESENTS_MODEL` binding. Single sanctioned write path: destructive sweep of stale SYSTEM-derived findings → rewire → constructive upsert, all in one `executeWrite`. See [Atomic binding mutation](#atomic-binding-mutation-changeelementbinding) below. |
| `deleteModel` | `modelId` | `DeletionStats!` | Delete a model and all contained elements |
| `runAnalysis` | `analysisId`, `additionalParams?` | `Session!` | Start an analysis run |
| `startChat` | `analysisId`, `userQuestion`, `additionalParams?` | `Session!` | Start a chat session with an analysis |
| `resumeAnalysis` | `analysisId`, `userInput` | `Session!` | Resume an analysis with user input |
| `deleteAnalysis` | `analysisId` | `Boolean!` | Delete an analysis |
| `resetModule` | `moduleId` | `Boolean!` | Reset a module's state |
| `addElementsToIssue` | `issueId`, `elementIds` | `AddElementsToIssueResult!` | Link elements to an issue |
| `removeElementFromIssue` | `issueId`, `elementId` | `Boolean!` | Remove an element from an issue |
| `migrateClassId` | `moduleName`, `className`, `classKind`, `newId` | `Boolean!` | Admin: align a `(Module, *Class)` pair to a new id (audit-mode rebind) |
| `reviveOrphanedClass` | `classId`, `classKind` | `Boolean!` | Admin: flip `HAS_ORPHANED_CLASS` → `HAS_CLASS` |
| `deleteOrphanedClass` | `classId`, `classKind`, `cascade` | `Boolean!` | Admin: hard-delete an orphaned class (cascade gated, capped at 1000 incidents) |
| `runIdentityMigration` | `dryRun` | `IdentityMigrationReport!` | Admin: re-run the idempotent class-identity cleanup |

> **Admin mutations** (`migrateClassId`, `reviveOrphanedClass`, `deleteOrphanedClass`, `runIdentityMigration`) and the `classIdentityEvents` admin query are gated at resolver entry via `requireAdmin(ctx)` — see [`ClassIdentityResolverService`](../../../../apps/dt-ws/src/gql/resolver-services/class-identity-resolver.service.ts). The schema directive on these operations is `@authentication` (token validity); the role check happens in TypeScript, not in the schema, to keep the admin contract role-aware without introducing a new schema directive. Every admin mutation emits a `Logger.warn` audit entry capturing operator identity before performing the work.

### Atomic binding mutation (`changeElementBinding`)

`changeElementBinding` is the **only** sanctioned write path for the `IS_INSTANCE_OF` and `REPRESENTS_MODEL` edges. Direct `@cypher` edits, ad-hoc `MERGE (a)-[:IS_INSTANCE_OF]->(b)` from custom resolvers, and auto-generated `connect` / `disconnect` operations on these edges are excluded by convention — every binding transition routes through this mutation to keep the destructive sweep, rewire, and constructive upsert atomic.

**Input shape.** Discriminated by `ElementBindingInput.kind`:

| Kind | Required field | Effect |
|------|----------------|--------|
| `CLASS` | `classIds: [ID!]!` (length 1 for non-Controls; 0+ for Controls) | Bind to one class (single-class elements) or N control classes |
| `REPRESENTED_MODEL` | `modelId: ID!` | Bind a Component or SecurityBoundary to a model via `REPRESENTS_MODEL` |
| `NONE` | (neither) | Unbind; sweeps all SYSTEM-derived findings |

GraphQL has no native input unions, so the `kind` enum is the discriminator — the resolver validates the combination per the comments on each field of `ElementBindingInput` in [`schema.graphql`](../../../../apps/dt-ws/schema/schema.graphql).

**Output shape.** `ChangeElementBindingResult` carries:
- `success` — `false` only when an error path fired before the `executeWrite`; `true` for both real transitions and identity short-circuits.
- `targetBinding` — a real GraphQL union (`ClassBinding | RepresentedModelBinding | NoBinding`) echoing the binding that landed. Consumers should branch on `__typename`.
- `deltas: ElementBindingDeltas` — six counters split by finding kind (Exposure / Countermeasure) and disposition (deleted-derived / instantiated-derived / preserved-custom). All zero on identity short-circuit or any error path.
- `errorCode: ElementBindingErrorCode` — null on success. The 8-value enum is structured for UI branching: `VALIDATION_ERROR`, `ELEMENT_NOT_FOUND`, `CLASS_NOT_FOUND`, `MODEL_NOT_FOUND`, `ORPHAN_CLASS_REFUSED`, `REPRESENTED_MODEL_NOT_ALLOWED`, `MODULE_ERROR`, `DATABASE_ERROR`.
- `errorMessage: String` — sanitised human-readable string suitable for snackbar display.

**Transaction discipline.** The resolver runs validation and a preflight read outside the transaction, then opens a single `session.executeWrite(...)` block that performs an **in-tx authoritative re-read** of the current binding, identity short-circuit, destructive sweep, rewire, and constructive upsert. The in-tx read is authoritative — the preflight is an optimisation that lets the resolver call module SDKs (to produce module-supplied exposure / countermeasure data) before opening the write transaction. On any database error inside the transaction, Bolt rolls back the entire write — no partial graph state can persist.

**Authorization.** Enforced exclusively by `@authentication` on the mutation. The service does no in-resolver authz checks (per the project convention: module and resolver code never owns authz — the JWT guard and Neo4j session scoping do).

Service: [`ElementBindingService`](../../../../apps/dt-ws/src/gql/resolver-services/element-binding.service.ts). It reuses the public tx-bound helpers `upsertExposuresInTx` / `upsertCountermeasuresInTx` from [`SetInstantiationAttributesService`](SET_INSTANTIATION_ATTRIBUTES.md) so both write paths share one upsert implementation. Module-supplied attributes flow through the shared positive allowlist in [`src/gql/resolver-services/shared/finding-attrs.ts`](../../../../apps/dt-ws/src/gql/resolver-services/shared/finding-attrs.ts).

### Subscriptions

| Subscription | Parameters | Returns | Description |
|-------------|-----------|---------|-------------|
| `streamResponse` | `sessionId` | `AIResponse!` | Stream analysis/chat responses |

> Note: `@authentication` is not supported on Subscription types by the Neo4j GraphQL Library. Subscription authentication is enforced by the JwtAuthGuard on the controller.

---

## Element Interface

All core types implement the `Element` interface:

```graphql
interface Element {
  id: ID!
  name: String!
  description: String
}
```

Types implementing Element: Model, Component, DataFlow, SecurityBoundary, Data, Control, Module, Exposure, Countermeasure, Analysis, AnalysisClass, ComponentClass, DataFlowClass, SecurityBoundaryClass, ControlClass, DataClass, IssueClass, Issue, Folder, and all MITRE types.
