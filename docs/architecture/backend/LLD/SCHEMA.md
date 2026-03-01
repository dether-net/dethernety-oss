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

**Relationships:**
- `(Countermeasure)-[:RESPONDS_WITH]->(MitreAttackMitigation)` — ATT&CK mitigations
- `(Countermeasure)-[:RESPONDS_WITH]->(MitreDefendTechnique)` — D3FEND techniques
- `(Countermeasure)<-[:HAS_COUNTERMEASURE]-(Control)` — Parent control
- `(Countermeasure)-[:IS_COUNTERMEASURE_OF]->(ControlClass)` — Control class
- `(Countermeasure)-[:HAS_ISSUE]->(Issue)` — Issues associated with this countermeasure

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

**Relationships:**
- `(Module)<-[:HAS_MODULE]-(Model)` — Models using this module
- `(Module)-[:HAS_CLASS]->(ComponentClass)` — Component classes
- `(Module)-[:HAS_CLASS]->(DataFlowClass)` — Data flow classes
- `(Module)-[:HAS_CLASS]->(SecurityBoundaryClass)` — Security boundary classes
- `(Module)-[:HAS_CLASS]->(ControlClass)` — Control classes
- `(Module)-[:HAS_CLASS]->(DataClass)` — Data classes
- `(Module)-[:HAS_CLASS]->(AnalysisClass)` — Analysis classes
- `(Module)-[:HAS_CLASS]->(IssueClass)` — Issue classes

**Computed fields:**
- `template` — Module template (custom resolver)

### Class Types

All class types share the same base structure:

**Common Properties:**
- `id` (ID!) — Unique identifier
- `name` (String!) — Class name
- `description` (String) — Class description
- `type` (String or ComponentType) — Class type
- `category` (String) — Class category
- `path` (String) — Class path

**Common Relationships:**
- `(Class)<-[:HAS_CLASS]-(Module)` — Parent module
- `(Class)<-[:IS_INSTANCE_OF]-(Instance)` — Instances of this class

**Common Computed Fields:**
- `template` — UI configuration template (custom resolver)
- `guide` — Usage documentation (custom resolver)

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

### Mutations

| Mutation | Parameters | Returns | Description |
|----------|-----------|---------|-------------|
| `setInstantiationAttributes` | `componentId`, `classId`, `attributes` | `Boolean!` | Set attributes on an IS_INSTANCE_OF relationship |
| `deleteModel` | `modelId` | `DeletionStats!` | Delete a model and all contained elements |
| `runAnalysis` | `analysisId`, `additionalParams?` | `Session!` | Start an analysis run |
| `startChat` | `analysisId`, `userQuestion`, `additionalParams?` | `Session!` | Start a chat session with an analysis |
| `resumeAnalysis` | `analysisId`, `userInput` | `Session!` | Resume an analysis with user input |
| `deleteAnalysis` | `analysisId` | `Boolean!` | Delete an analysis |
| `resetModule` | `moduleId` | `Boolean!` | Reset a module's state |
| `addElementsToIssue` | `issueId`, `elementIds` | `AddElementsToIssueResult!` | Link elements to an issue |
| `removeElementFromIssue` | `issueId`, `elementId` | `Boolean!` | Remove an element from an issue |

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
