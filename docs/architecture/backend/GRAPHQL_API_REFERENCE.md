# GraphQL API reference

> Auto-generated from [`schema.graphql`](../../../apps/dt-ws/schema/schema.graphql).
> Regenerate with `pnpm docs:api`.

> **For frontend and MCP integrations:** prefer the `dt-core` TypeScript library
> (`packages/dt-core/`) over raw GraphQL queries. dt-core wraps every call with
> retry logic, mutex protection, and request deduplication.
> See [Data Access Layer](../dt-core/DATA_ACCESS_LAYER.md).

---

## Contents

- [Enums](#enums)
- [Interfaces](#interfaces)
- [Core types](#core-types)
- [Class types](#class-types)
- [MITRE framework types](#mitre-framework-types)
- [Utility types](#utility-types)
- [Queries](#queries)
- [Mutations](#mutations)
- [Subscription](#subscription)

---

## Enums

### ComponentType

Component type (process, database, external entity, etc.).

| Value | Description |
|-------|-------------|
| `PROCESS` | A running process or service |
| `EXTERNAL_ENTITY` | An external actor or system outside the model boundary |
| `STORE` | A data store (database, file system, cache) |
| `BOUNDARY` | A logical grouping boundary |
| `SECURITY_BOUNDARY` | A trust boundary separating zones of different trust levels |
| `DATA_FLOW` | A data flow connection between components |

### TrustLevel

Trust level assigned to a security boundary.

| Value | Description |
|-------|-------------|
| `UNTRUSTED` | No trust — external or hostile zone |
| `SEMI_TRUSTED` | Partial trust — DMZ or shared zone |
| `TRUSTED` | Full trust — internal or protected zone |

### ValueType

Value types for dynamic attributes.

| Value | Description |
|-------|-------------|
| `STRING` | A text value |
| `NUMBER` | A numeric value (integer or float) |
| `BOOLEAN` | A true/false value |
| `DATE` | A date or datetime value |

## Interfaces

### Element

Base interface implemented by all graph-stored entities.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Display name |
| `description` | `String` | Free-text description |

## Core types

### Folder

Organizational folder for grouping models and controls.

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Folder name |
| `description` | `String` | Free-text description |
| `parentFolder` | `[Folder!]!` | Parent folder (if nested) (← `FOLDER_CONTAINS`) |
| `childrenFolders` | `[Folder!]!` | Child folders (→ `FOLDER_CONTAINS`) |
| `models` | `[Model!]!` | Models in this folder (→ `FOLDER_CONTAINS`) |
| `controls` | `[Control!]!` | Controls in this folder (→ `FOLDER_CONTAINS`) |

### Model

A threat model containing components, data flows, boundaries, and analysis results.

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Model name |
| `description` | `String` | Free-text description |
| `defaultBoundary` | `[SecurityBoundary!]!` | Top-level security boundaries in this model (→ `CONTAINS`) |
| `modules` | `[Module!]!` | Modules loaded for this model (→ `HAS_MODULE`) |
| `controls` | `[Control!]!` | Controls applied to this model (← `SUPPORTS`) |
| `dataItems` | `[Data!]!` | Data elements defined in this model (→ `CONTAINS`) |
| `representedBy` | `[Element!]!` | Components that represent this model (for model-in-model composition) (← `REPRESENTS_MODEL`) |
| `analyses` | `[Analysis!]!` | Analyses run against this model (→ `ANALYZED_BY`) |
| `issues` | `[Issue!]!` | Issues associated with this model (→ `HAS_ISSUE`) |
| `folder` | `[Folder!]!` | Folder containing this model (← `FOLDER_CONTAINS`) |

### Component

A modeled entity in the system (process, database, external entity, etc.).

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Component name |
| `description` | `String` | Free-text description |
| `type` | `ComponentType!` | Component type (process, store, external entity, etc.) |
| `parentBoundary` | `[SecurityBoundary!]!` | Security boundary this component belongs to (→ `BELONGS_TO`) |
| `flowsFrom` | `[DataFlow!]!` | Outgoing data flows from this component (→ `FLOWS`) |
| `flowsTo` | `[DataFlow!]!` | Incoming data flows to this component (← `FLOWS`) |
| `exposures` | `[Exposure!]!` | Security exposures identified on this component (→ `HAS_EXPOSURE`) |
| `controls` | `[Control!]!` | Controls applied to this component (← `SUPPORTS`) |
| `dataItems` | `[Data!]!` | Data elements handled by this component (→ `HANDLES`) |
| `componentClass` | `[ComponentClass!]!` | Class this component is an instance of (→ `IS_INSTANCE_OF`) |
| `representedModel` | `[Model!]!` | Model represented by this component (for model-in-model composition) (→ `REPRESENTS_MODEL`) |
| `analyses` | `[Analysis!]!` | Analyses run against this component (→ `ANALYZED_BY`) |
| `issues` | `[Issue!]!` | Issues associated with this component (→ `HAS_ISSUE`) |
| `positionX` | `Float` | X position on the canvas |
| `positionY` | `Float` | Y position on the canvas |
| `dimensionsWidth` | `Float` | Width on the canvas |
| `dimensionsHeight` | `Float` | Height on the canvas |

### DataFlow

A directed data flow between two components.

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Data flow name |
| `description` | `String` | Free-text description |
| `source` | `[Component!]!` | Source component of this data flow (← `FLOWS`) |
| `target` | `[Component!]!` | Target component of this data flow (→ `FLOWS`) |
| `sourceHandle` | `String` | Source handle identifier (for canvas rendering) |
| `targetHandle` | `String` | Target handle identifier (for canvas rendering) |
| `dataFlowTypes` | `[String!]` | Data flow protocol or transport types (e.g., HTTP, gRPC) |
| `analyses` | `[Analysis!]!` | Analyses run against this data flow (→ `ANALYZED_BY`) |
| `exposures` | `[Exposure!]!` | Security exposures identified on this data flow (→ `HAS_EXPOSURE`) |
| `controls` | `[Control!]!` | Controls applied to this data flow (← `SUPPORTS`) |
| `dataItems` | `[Data!]!` | Data elements carried by this data flow (→ `HANDLES`) |
| `dataFlowClass` | `[DataFlowClass!]!` | Class this data flow is an instance of (→ `IS_INSTANCE_OF`) |
| `issues` | `[Issue!]!` | Issues associated with this data flow (→ `HAS_ISSUE`) |

### SecurityBoundary

A trust boundary separating zones of different trust levels (e.g., network boundary, DMZ).

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Boundary name |
| `description` | `String` | Free-text description |
| `model` | `[Model!]!` | Model this boundary belongs to (← `CONTAINS`) |
| `trustLevel` | `TrustLevel!` | Trust level of this boundary (untrusted, semi-trusted, trusted) |
| `components` | `[Component!]!` | Components inside this boundary (← `BELONGS_TO`) |
| `childBoundaries` | `[SecurityBoundary!]!` | Nested child boundaries (← `BELONGS_TO`) |
| `parentBoundary` | `[SecurityBoundary!]!` | Parent boundary (if nested) (→ `BELONGS_TO`) |
| `exposures` | `[Exposure!]!` | Security exposures identified on this boundary (→ `HAS_EXPOSURE`) |
| `controls` | `[Control!]!` | Controls applied to this boundary (← `SUPPORTS`) |
| `dataItems` | `[Data!]!` | Data elements handled within this boundary (→ `HANDLES`) |
| `securityBoundaryClass` | `[SecurityBoundaryClass!]!` | Class this boundary is an instance of (→ `IS_INSTANCE_OF`) |
| `representedModel` | `[Model!]!` | Model represented by this boundary (for model-in-model composition) (→ `REPRESENTS_MODEL`) |
| `analyses` | `[Analysis!]!` | Analyses run against this boundary (→ `ANALYZED_BY`) |
| `issues` | `[Issue!]!` | Issues associated with this boundary (→ `HAS_ISSUE`) |
| `positionX` | `Float` | X position on the canvas |
| `positionY` | `Float` | Y position on the canvas |
| `dimensionsWidth` | `Float` | Width on the canvas |
| `dimensionsHeight` | `Float` | Height on the canvas |
| `dimensionsMinWidth` | `Float` | Minimum width on the canvas |
| `dimensionsMinHeight` | `Float` | Minimum height on the canvas |
| `allDescendantBoundaries` | `[SecurityBoundary!]!` | All nested boundaries at any depth (computed via Cypher traversal) |
| `allDescendantComponents` | `[Component!]!` | All components inside this boundary or any nested boundary (computed) |
| `allDescendantDataFlows` | `[DataFlow!]!` | All data flows touching components in this boundary or nested boundaries (computed) |

### Data

A data element handled by components and data flows (e.g., PII, credentials, API keys).

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Data element name |
| `description` | `String` | Free-text description |
| `model` | `[Model!]!` | Model this data element belongs to (← `CONTAINS`) |
| `dataClass` | `[DataClass!]!` | Class this data element is an instance of (→ `IS_INSTANCE_OF`) |
| `component` | `[Component!]!` | Components that handle this data (← `HANDLES`) |
| `dataFlow` | `[DataFlow!]!` | Data flows that carry this data (← `HANDLES`) |
| `securityBoundary` | `[SecurityBoundary!]!` | Boundaries that contain this data (← `HANDLES`) |
| `elements` | `[Element!]!` | All elements that handle this data (← `HANDLES`) |
| `exposures` | `[Exposure!]!` | Security exposures related to this data (→ `HAS_EXPOSURE`) |
| `analyses` | `[Analysis!]!` | Analyses involving this data (→ `ANALYZED_BY`) |
| `issues` | `[Issue!]!` | Issues associated with this data (→ `HAS_ISSUE`) |

### Control

A security control applied to one or more elements (e.g., encryption, authentication, firewall rule).

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Control name |
| `description` | `String` | Free-text description |
| `type` | `String` | Control type (e.g., technical, procedural, administrative) |
| `category` | `String` | Control category |
| `controlClasses` | `[ControlClass!]!` | Class this control is an instance of (→ `IS_INSTANCE_OF`) |
| `elements` | `[Element!]!` | Elements this control is applied to (→ `SUPPORTS`) |
| `countermeasures` | `[Countermeasure!]!` | Countermeasures provided by this control (→ `HAS_COUNTERMEASURE`) |
| `folder` | `[Folder!]!` | Folder containing this control (← `FOLDER_CONTAINS`) |
| `analyses` | `[Analysis!]!` | Analyses involving this control (→ `ANALYZED_BY`) |
| `issues` | `[Issue!]!` | Issues associated with this control (→ `HAS_ISSUE`) |

### Module

An executable module that provides component classes, analysis logic, controls, and other domain-specific functionality.

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Module name |
| `version` | `String!` | Module version |
| `description` | `String` | Free-text description |
| `model` | `[Model!]!` | Models this module is loaded in (← `HAS_MODULE`) |
| `componentClasses` | `[ComponentClass!]!` | Component classes provided by this module (→ `HAS_CLASS`) |
| `dataFlowClasses` | `[DataFlowClass!]!` | Data flow classes provided by this module (→ `HAS_CLASS`) |
| `securityBoundaryClasses` | `[SecurityBoundaryClass!]!` | Security boundary classes provided by this module (→ `HAS_CLASS`) |
| `controlClasses` | `[ControlClass!]!` | Control classes provided by this module (→ `HAS_CLASS`) |
| `dataClasses` | `[DataClass!]!` | Data classes provided by this module (→ `HAS_CLASS`) |
| `analysisClasses` | `[AnalysisClass!]!` | Analysis classes provided by this module (→ `HAS_CLASS`) |
| `template` | `String` | Module configuration template (resolved at runtime) (custom resolver) |
| `attributes` | `String` | Module configuration attributes (JSON string) |
| `path` | `String` | File system path to the module |

### Exposure

A security exposure (vulnerability or weakness) identified on a model element.

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Exposure name |
| `description` | `String` | Free-text description |
| `type` | `String` | Exposure type |
| `category` | `String` | Exposure category |
| `score` | `Int` | Risk score |
| `references` | `String` | External references (URLs, CVE IDs) |
| `mitigationSuggestions` | `[String!]` | Suggested mitigations |
| `detectionMethods` | `[String!]` | Detection methods |
| `tags` | `[String!]` | Tags for filtering and grouping |
| `techniques` | `[String!]` | MITRE ATT&CK technique IDs |
| `component` | `[Component!]!` | Components affected by this exposure (← `HAS_EXPOSURE`) |
| `securityBoundary` | `[SecurityBoundary!]!` | Boundaries affected by this exposure (← `HAS_EXPOSURE`) |
| `dataFlow` | `[DataFlow!]!` | Data flows affected by this exposure (← `HAS_EXPOSURE`) |
| `data` | `[Data!]!` | Data elements affected by this exposure (← `HAS_EXPOSURE`) |
| `element` | `[Element!]!` | All elements affected by this exposure (← `HAS_EXPOSURE`) |
| `exploitedBy` | `[MitreAttackTechnique!]!` | ATT&CK techniques that exploit this exposure (→ `EXPLOITED_BY`) |
| `issues` | `[Issue!]!` | Issues associated with this exposure (→ `HAS_ISSUE`) |

### Countermeasure

A defensive countermeasure linked to MITRE ATT&CK mitigations and D3FEND techniques.

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Countermeasure name |
| `description` | `String` | Free-text description |
| `type` | `String` | Countermeasure type |
| `category` | `String` | Countermeasure category |
| `score` | `Int` | Effectiveness score |
| `references` | `String` | External references |
| `addressedExposures` | `[String!]` | Exposure names this countermeasure addresses |
| `tags` | `[String!]` | Tags for filtering and grouping |
| `mitigations` | `[MitreAttackMitigation!]!` | ATT&CK mitigations implemented by this countermeasure (→ `RESPONDS_WITH`) |
| `defendedTechniques` | `[MitreDefendTechnique!]!` | D3FEND techniques implemented by this countermeasure (→ `RESPONDS_WITH`) |
| `control` | `[Control!]!` | Control that provides this countermeasure (← `HAS_COUNTERMEASURE`) |
| `controlClass` | `[ControlClass!]!` | Control class this countermeasure belongs to (→ `IS_COUNTERMEASURE_OF`) |
| `issues` | `[Issue!]!` | Issues associated with this countermeasure (→ `HAS_ISSUE`) |

### Analysis

An analysis instance run against model elements.

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Analysis name |
| `description` | `String` | Free-text description |
| `type` | `String` | Analysis type |
| `category` | `String` | Analysis category |
| `analysisClass` | `[AnalysisClass!]!` | Class this analysis is an instance of (→ `IS_INSTANCE_OF`) |
| `status` | `AnalysisStatus` | Current execution status (resolved at runtime) (custom resolver) |
| `valueKeys` | `[String!]!` | Available value keys for retrieving analysis results (resolved at runtime) (custom resolver) |
| `model` | `[Model!]!` | Model being analyzed (← `ANALYZED_BY`) |
| `component` | `[Component!]!` | Components being analyzed (← `ANALYZED_BY`) |
| `dataFlow` | `[DataFlow!]!` | Data flows being analyzed (← `ANALYZED_BY`) |
| `securityBoundary` | `[SecurityBoundary!]!` | Security boundaries being analyzed (← `ANALYZED_BY`) |
| `control` | `[Control!]!` | Controls being analyzed (← `ANALYZED_BY`) |
| `data` | `[Data!]!` | Data elements being analyzed (← `ANALYZED_BY`) |
| `element` | `[Element!]!` | All elements being analyzed (← `ANALYZED_BY`) |
| `issues` | `[Issue!]!` | Issues associated with this analysis (→ `HAS_ISSUE`) |

### Issue

A tracked issue created from analysis findings, linked to affected model elements.

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Issue name |
| `description` | `String` | Free-text description |
| `type` | `String` | Issue type |
| `category` | `String` | Issue category |
| `issueStatus` | `String` | Current status (e.g., open, in_progress, resolved) |
| `comments` | `[String!]` | Discussion comments |
| `models` | `[Model!]!` | Affected models (← `HAS_ISSUE`) |
| `components` | `[Component!]!` | Affected components (← `HAS_ISSUE`) |
| `dataFlows` | `[DataFlow!]!` | Affected data flows (← `HAS_ISSUE`) |
| `securityBoundaries` | `[SecurityBoundary!]!` | Affected security boundaries (← `HAS_ISSUE`) |
| `controls` | `[Control!]!` | Affected controls (← `HAS_ISSUE`) |
| `data` | `[Data!]!` | Affected data elements (← `HAS_ISSUE`) |
| `analyses` | `[Analysis!]!` | Related analyses (← `HAS_ISSUE`) |
| `exposures` | `[Exposure!]!` | Related exposures (← `HAS_ISSUE`) |
| `countermeasures` | `[Countermeasure!]!` | Related countermeasures (← `HAS_ISSUE`) |
| `attributes` | `String` | External system attributes (JSON string) |
| `lastSyncAt` | `String` | Timestamp of last external sync |
| `createdAt` | `String` | Creation timestamp |
| `updatedAt` | `String` | Last update timestamp |
| `syncedAttributes` | `JSON` | Attributes synced from external system (resolved at runtime) (custom resolver) |
| `issueClass` | `[IssueClass!]!` | Class this issue is an instance of (→ `IS_INSTANCE_OF`) |
| `elementsWithExtendedInfo` | `[IssueElement!]!` | All linked elements with model context and exposure info (computed via Cypher) |

## Class types

Class types define the categories available within modules. Components, data flows,
security boundaries, controls, data items, analyses, and issues are all instances of
their respective class types.

### ComponentClass

A component class definition provided by a module (e.g., Web Server, Database, API Gateway).

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Class name |
| `description` | `String` | Free-text description |
| `type` | `ComponentType!` | Component type this class represents |
| `category` | `String` | Grouping category within the module |
| `module` | `[Module!]!` | Module that provides this class (← `HAS_CLASS`) |
| `path` | `String` | File path within the module |
| `components` | `[Component!]!` | Components that are instances of this class (→ `IS_INSTANCE_OF`) |
| `template` | `String` | Configuration template (resolved at runtime) (custom resolver) |
| `guide` | `String` | User-facing guide content (resolved at runtime) (custom resolver) |

### SecurityBoundaryClass

A security boundary class definition provided by a module (e.g., Network Segment, Cloud VPC).

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Class name |
| `description` | `String` | Free-text description |
| `type` | `ComponentType!` | Component type this class represents |
| `category` | `String` | Grouping category within the module |
| `module` | `[Module!]!` | Module that provides this class (← `HAS_CLASS`) |
| `path` | `String` | File path within the module |
| `securityBoundaries` | `[SecurityBoundary!]!` | Security boundaries that are instances of this class (→ `IS_INSTANCE_OF`) |
| `template` | `String` | Configuration template (resolved at runtime) (custom resolver) |
| `guide` | `String` | User-facing guide content (resolved at runtime) (custom resolver) |

### DataFlowClass

A data flow class definition provided by a module (e.g., HTTP Request, Database Query).

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Class name |
| `description` | `String` | Free-text description |
| `type` | `ComponentType!` | Component type this class represents |
| `category` | `String` | Grouping category within the module |
| `module` | `[Module!]!` | Module that provides this class (← `HAS_CLASS`) |
| `path` | `String` | File path within the module |
| `dataFlows` | `[DataFlow!]!` | Data flows that are instances of this class (→ `IS_INSTANCE_OF`) |
| `template` | `String` | Configuration template (resolved at runtime) (custom resolver) |
| `guide` | `String` | User-facing guide content (resolved at runtime) (custom resolver) |

### ControlClass

A control class definition provided by a module (e.g., Encryption at Rest, MFA).

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Class name |
| `description` | `String` | Free-text description |
| `type` | `String` | Control type |
| `category` | `String` | Grouping category within the module |
| `supportedTypes` | `[ComponentType!]` | Component types this control class can be applied to |
| `supportedCategories` | `[String!]` | Component categories this control class can be applied to |
| `module` | `[Module!]!` | Module that provides this class (← `HAS_CLASS`) |
| `path` | `String` | File path within the module |
| `controls` | `[Control!]!` | Controls that are instances of this class (→ `IS_INSTANCE_OF`) |
| `countermeasures` | `[Countermeasure!]!` | Countermeasures associated with this control class (← `IS_COUNTERMEASURE_OF`) |
| `template` | `String` | Configuration template (resolved at runtime) (custom resolver) |
| `guide` | `String` | User-facing guide content (resolved at runtime) (custom resolver) |

### DataClass

A data class definition provided by a module (e.g., PII, Authentication Token, API Key).

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Class name |
| `description` | `String` | Free-text description |
| `type` | `String` | Data type |
| `category` | `String` | Grouping category within the module |
| `module` | `[Module!]!` | Module that provides this class (← `HAS_CLASS`) |
| `path` | `String` | File path within the module |
| `data` | `[Data!]!` | Data elements that are instances of this class (→ `IS_INSTANCE_OF`) |
| `template` | `String` | Configuration template (resolved at runtime) (custom resolver) |
| `guide` | `String` | User-facing guide content (resolved at runtime) (custom resolver) |

### AnalysisClass

An analysis class definition provided by a module.

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Class name |
| `module` | `[Module!]!` | Module that provides this class (← `HAS_CLASS`) |
| `description` | `String` | Free-text description |
| `type` | `String` | Analysis type |
| `category` | `String` | Analysis category |
| `analyses` | `[Analysis!]!` | Analysis instances of this class (← `IS_INSTANCE_OF`) |

### IssueClass

An issue class definition provided by a module.

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Class name |
| `module` | `[Module!]!` | Module that provides this class (← `HAS_CLASS`) |
| `description` | `String` | Free-text description |
| `type` | `String` | Issue type |
| `category` | `String` | Issue category |
| `template` | `String` | Configuration template (resolved at runtime) (custom resolver) |
| `issues` | `[Issue!]!` | Issues that are instances of this class (← `IS_INSTANCE_OF`) |

## MITRE framework types

Types for MITRE ATT&CK techniques/tactics/mitigations and D3FEND techniques/tactics.

### MitreAttackTactic

A MITRE ATT&CK tactic (e.g., Initial Access, Persistence, Exfiltration).

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Tactic name |
| `description` | `String` | Free-text description |
| `attack_id` | `String` | ATT&CK tactic ID (e.g., TA0001) |
| `attack_version` | `String` | ATT&CK version this tactic was introduced or updated in |
| `stix_id` | `String` | STIX identifier |
| `stix_spec_version` | `String` | STIX specification version |
| `stix_type` | `String` | STIX object type |
| `techniques` | `[MitreAttackTechnique!]!` | Techniques associated with this tactic (→ `TACTIC_INCLUDES_TECHNIQUE`) |

### MitreAttackTechnique

A MITRE ATT&CK technique or sub-technique (e.g., T1566 Phishing).

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Technique name |
| `description` | `String` | Free-text description |
| `attack_id` | `String` | ATT&CK technique ID (e.g., T1566, T1566.001) |
| `attack_spec_version` | `String` | ATT&CK specification version |
| `attack_decreased` | `Boolean` | Whether this technique has decreased usage |
| `attack_subtechnique` | `Boolean` | Whether this is a sub-technique |
| `attack_version` | `String` | ATT&CK version this technique was introduced or updated in |
| `ref_url` | `String` | Reference URL on attack.mitre.org |
| `stix_id` | `String` | STIX identifier |
| `stix_spec_version` | `String` | STIX specification version |
| `stix_type` | `String` | STIX object type |
| `subTechniques` | `[MitreAttackTechnique!]!` | Sub-techniques of this technique (← `SUBTECHNIQUE_OF`) |
| `parentTechnique` | `[MitreAttackTechnique!]!` | Parent technique (if this is a sub-technique) (→ `SUBTECHNIQUE_OF`) |
| `exposures` | `[Exposure!]!` | Exposures that this technique can exploit (← `EXPLOITED_BY`) |
| `mitigations` | `[MitreAttackMitigation!]!` | ATT&CK mitigations that defend against this technique (← `MITIGATION_DEFENDS_AGAINST_TECHNIQUE`) |
| `tactics` | `[MitreAttackTactic!]!` | Tactics this technique belongs to (← `TACTIC_INCLUDES_TECHNIQUE`) |

### MitreAttackMitigation

A MITRE ATT&CK mitigation (e.g., M1036 Account Use Policies).

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Mitigation name |
| `description` | `String` | Free-text description |
| `attack_id` | `String` | ATT&CK mitigation ID (e.g., M1036) |
| `attack_deprecated` | `Boolean` | Whether this mitigation has been deprecated |
| `ref_url` | `String` | Reference URL on attack.mitre.org |
| `attack_spec_version` | `String` | ATT&CK specification version |
| `stix_spec_version` | `String` | STIX specification version |
| `stix_modified` | `String` | STIX last-modified timestamp |
| `stix_id` | `String` | STIX identifier |
| `attack_version` | `String` | ATT&CK version this mitigation was introduced or updated in |
| `stix_created` | `String` | STIX creation timestamp |
| `stix_revoked` | `Boolean` | Whether this STIX object has been revoked |
| `stix_type` | `String` | STIX object type |
| `attackTechniqueMitigated` | `[MitreAttackTechnique!]!` | Techniques this mitigation defends against (→ `MITIGATION_DEFENDS_AGAINST_TECHNIQUE`) |
| `countermeasures` | `[Countermeasure!]!` | Countermeasures that implement this mitigation (← `RESPONDS_WITH`) |

### MitreDefendTactic

A MITRE D3FEND tactic (e.g., Detect, Isolate, Deceive).

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Tactic name |
| `description` | `String` | Free-text description |
| `attack_id` | `String` | D3FEND tactic ID |
| `uri` | `String` | D3FEND knowledge graph URI |
| `techniques` | `[MitreDefendTechnique!]!` | Techniques that enable this tactic (← `ENABLES`) |

### MitreDefendTechnique

A MITRE D3FEND defensive technique (e.g., Network Traffic Filtering).

Implements: `Element`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Unique identifier |
| `name` | `String!` | Technique name |
| `d3fendId` | `String` | D3FEND technique ID |
| `description` | `String` | Free-text description |
| `uri` | `String` | D3FEND knowledge graph URI |
| `tactics` | `[MitreDefendTactic!]!` | Tactics this technique enables (→ `ENABLES`) |
| `subTechniques` | `[MitreDefendTechnique!]!` | Sub-techniques of this technique (← `SUB_TECHNIQUE_OF`) |
| `parentTechnique` | `[MitreDefendTechnique!]!` | Parent technique (if this is a sub-technique) (→ `SUB_TECHNIQUE_OF`) |
| `countermeasures` | `[Countermeasure!]!` | Countermeasures that implement this technique (← `RESPONDS_WITH`) |

## Utility types

Helper types used as return values or nested structures.

### AnalysisStatus

Status of a running or completed analysis.

| Field | Type | Description |
|-------|------|-------------|
| `createdAt` | `String!` | When the analysis was started |
| `updatedAt` | `String!` | When the status was last updated |
| `status` | `String!` | Current status (e.g., running, completed, failed) |
| `interrupts` | `JSON` | Pending human-in-the-loop interrupts |
| `messages` | `[JSON!]` | Analysis messages and log entries |
| `metadata` | `JSON` | Additional metadata |

### IssueElement

Extended element info returned by Issue.elementsWithExtendedInfo (computed via Cypher).

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` | Element identifier |
| `name` | `String` | Element name |
| `description` | `String` | Element description |
| `type` | `String` | Element type |
| `element_type` | `String` | Graph label of the element (e.g., Component, DataFlow) |
| `category` | `String` | Element category |
| `model_id` | `ID` | ID of the model containing this element |
| `model_name` | `String` | Name of the model containing this element |
| `model_description` | `String` | Description of the model containing this element |
| `exposed_component_id` | `ID` | ID of the component affected by the exposure (if element is an Exposure) |
| `exposed_component_name` | `String` | Name of the exposed component |
| `exposed_component_description` | `String` | Description of the exposed component |

### DeletionStats

Statistics returned after deleting a model.

| Field | Type | Description |
|-------|------|-------------|
| `nodesDeleted` | `Int!` | Number of graph nodes deleted |
| `relationshipsDeleted` | `Int!` | Number of graph relationships deleted |

### Session

An analysis session identifier.

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | `ID!` | Session ID for subscribing to analysis results via streamResponse |

### AddElementsToIssueResult

Result of adding elements to an issue.

| Field | Type | Description |
|-------|------|-------------|
| `elementsAdded` | `String!` | Number of elements successfully added |

### ResponseMetadata

Metadata about the AI model response.

| Field | Type | Description |
|-------|------|-------------|
| `finish_reason` | `String` | Why the model stopped generating (e.g., stop, length, tool_use) |
| `model_name` | `String` | Name of the AI model that produced the response |
| `system_fingerprint` | `String` | Backend system fingerprint for reproducibility |

### AIResponse

A streamed response from an AI analysis agent.

| Field | Type | Description |
|-------|------|-------------|
| `content` | `String` | Text content of the response |
| `additional_kwargs` | `JSON` | Provider-specific extra fields |
| `response_metadata` | `ResponseMetadata` | Model response metadata (finish reason, model name) |
| `type` | `String` | Message type (e.g., ai, human, tool) |
| `name` | `String` | Agent or tool name |
| `id` | `String` | Message identifier |
| `example` | `Boolean` | Whether this is an example message used for few-shot prompting |
| `tool_calls` | `[JSON!]` | Tool calls requested by the agent |
| `invalid_tool_calls` | `[JSON!]` | Tool calls that failed validation |
| `usage_metadata` | `JSON` | Token usage statistics |
| `tool_call_chunks` | `[JSON!]` | Partial tool call data from streaming chunks |

## Queries

All queries require authentication (`@authentication`).

### getExposuresForElement

Get all exposures attached to a specific element

**Returns:** `[Exposure!]!`

**Arguments:**

| Argument | Type |
|----------|------|
| `elementId` | `String!` |

### getAttributesFromClassRel

Get the instantiation attributes from a component-to-class relationship

**Returns:** `JSON`

**Arguments:**

| Argument | Type |
|----------|------|
| `componentId` | `String!` |
| `classId` | `String!` |

### getNotRepreseningModels

Get models that are not already represented by a component in the given model

**Returns:** `[Model!]`

**Arguments:**

| Argument | Type |
|----------|------|
| `modelId` | `String!` |

### getAnalysisValues

Get analysis result values by key

**Returns:** `JSON!`

**Arguments:**

| Argument | Type |
|----------|------|
| `analysisId` | `String!` |
| `valueKey` | `String!` |

### getDocument

Get a document from the analysis document store

**Returns:** `JSON!`

**Arguments:**

| Argument | Type |
|----------|------|
| `analysisId` | `String!` |
| `filter` | `JSON!` |

### getAvailableFrontendModules

List module names that have frontend bundles available

**Returns:** `[String!]!`
### getModuleFrontendBundle

Get the compiled frontend bundle for a module

**Returns:** `String!`

**Arguments:**

| Argument | Type |
|----------|------|
| `moduleName` | `String!` |

## Mutations

All mutations require authentication (`@authentication`).

### addElementsToIssue

Link one or more elements to an issue

**Returns:** `AddElementsToIssueResult!`

**Arguments:**

| Argument | Type |
|----------|------|
| `issueId` | `String!` |
| `elementIds` | `[String!]!` |

### removeElementFromIssue

Remove an element from an issue

**Returns:** `Boolean!`

**Arguments:**

| Argument | Type |
|----------|------|
| `issueId` | `String!` |
| `elementId` | `String!` |

### setInstantiationAttributes

Set configuration attributes on a component's class instantiation relationship

**Returns:** `Boolean!`

**Arguments:**

| Argument | Type |
|----------|------|
| `componentId` | `String!` |
| `classId` | `String!` |
| `attributes` | `JSON!` |

### resetModule

Reset a module, clearing its cached state and reloading from disk

**Returns:** `Boolean!`

**Arguments:**

| Argument | Type |
|----------|------|
| `moduleId` | `ID!` |

### deleteModel

Delete a model and all its contained elements (boundaries, components, data flows, exposures)

**Returns:** `DeletionStats!`

**Arguments:**

| Argument | Type |
|----------|------|
| `modelId` | `ID!` |

### runAnalysis

Start an analysis run, returns a session ID for subscribing to results

**Returns:** `Session!`

**Arguments:**

| Argument | Type |
|----------|------|
| `analysisId` | `String!` |
| `additionalParams` | `JSON` |

### startChat

Start a chat session with an analysis agent

**Returns:** `Session!`

**Arguments:**

| Argument | Type |
|----------|------|
| `analysisId` | `String!` |
| `userQuestion` | `String!` |
| `additionalParams` | `JSON` |

### resumeAnalysis

Resume a paused analysis with user input (human-in-the-loop)

**Returns:** `Session!`

**Arguments:**

| Argument | Type |
|----------|------|
| `analysisId` | `String!` |
| `userInput` | `String!` |

### deleteAnalysis

Delete an analysis and its associated data

**Returns:** `Boolean!`

**Arguments:**

| Argument | Type |
|----------|------|
| `analysisId` | `String!` |

## Subscription

Subscription auth is enforced by `JwtAuthGuard` on the controller, not by
the `@authentication` directive (which `@neo4j/graphql` does not support on subscriptions).

### streamResponse

Subscribe to streamed AI responses for a given analysis session

**Returns:** `AIResponse!`

**Arguments:**

| Argument | Type |
|----------|------|
| `sessionId` | `String!` |

