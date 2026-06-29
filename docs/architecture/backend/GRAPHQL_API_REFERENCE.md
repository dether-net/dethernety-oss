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
- [Input types](#input-types)
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
| `DATA` | A data class |
| `CONTROL` | A control class |

### ClassLabelEnum

Class label identifying which node type to match against.

| Value | Description |
|-------|-------------|
| `COMPONENT` | Component classes (PROCESS, STORE, EXTERNAL_ENTITY) |
| `SECURITY_BOUNDARY` | Security boundary classes |
| `DATA_FLOW` | Data flow classes |
| `DATA` | Data classes |
| `CONTROL` | Control classes |

### MatchClassFieldEnum

Optional fields to include on match candidates.

| Value | Description |
|-------|-------------|
| `description` |  |
| `category` |  |
| `type` |  |

### MatchType

How the match was determined.

| Value | Description |
|-------|-------------|
| `exact_name` |  |
| `fuzzy_name` |  |
| `vector_similarity` |  |
| `type_match` |  |

### ConfidenceLevel

Confidence level of the match.

| Value | Description |
|-------|-------------|
| `high` |  |
| `medium` |  |
| `low` |  |

### TrustLevel

Trust level assigned to a security boundary.

| Value | Description |
|-------|-------------|
| `UNTRUSTED` | No trust — external or hostile zone |
| `SEMI_TRUSTED` | Partial trust — DMZ or shared zone |
| `TRUSTED` | Full trust — internal or protected zone |

### Zone

Trust/exposure gradient of a security boundary (replaces TrustLevel).

| Value | Description |
|-------|-------------|
| `UNTRUSTED` | Open internet / hostile frontier (external) |
| `PUBLIC` | Internet-facing (your edge) |
| `EXPOSED` | Behind the front door (DMZ) |
| `INTERNAL` | Trusted zones only |
| `RESTRICTED` | Specifically-authorized paths only (CDE, secrets, DCs, security tooling) |
| `VENDOR` | Trusted external party (vetted vendor / connected partner) |

### Plane

Operational/privilege role of a boundary.

| Value | Description |
|-------|-------------|
| `WORKLOAD` | Business workload (front to back) |
| `MANAGEMENT` | Privileged control/admin infrastructure (incl. security tooling) |

### AttackVector

CVSS v3.1-aligned attack vector classification for exposures.

| Value | Description |
|-------|-------------|
| `NETWORK` | Exploitable from any network without preconditions |
| `ADJACENT` | Requires same shared physical or logical network segment |
| `LOCAL` | Requires local access (shell, code execution) |
| `PHYSICAL` | Requires physical hardware access |
| `UNSPECIFIED` | Not yet classified by the policy author |

### ValueType

Value types for dynamic attributes.

| Value | Description |
|-------|-------------|
| `STRING` | A text value |
| `NUMBER` | A numeric value (integer or float) |
| `BOOLEAN` | A true/false value |
| `DATE` | A date or datetime value |

### DispositionKind

Structured argument the user authors for treating a SYSTEM finding differently.

| Value | Description |
|-------|-------------|
| `NOT_APPLICABLE` | Finding does not apply to this element / model context |
| `FALSE_POSITIVE` | Finding is incorrect — the underlying weakness does not exist as described |
| `COMPENSATING_CONTROL` | A compensating control mitigates the finding to an acceptable residual risk |
| `RISK_ACCEPTED` | Risk has been formally accepted; finding remains documented |
| `WAIVED` | We have decided not to implement this control (control waiver). Countermeasure-only. |
| `SUPERSEDED` | Finding has been replaced by a user-authored exposure that better fits the model |
| `AFFIRMED` | Finding reviewed and confirmed as a real, live risk. The one disposition kind that keeps the finding live (not muted). |

### DispositionErrorCode

Error taxonomy for disposeExposure / clearDisposition mutations.

| Value | Description |
|-------|-------------|
| `VALIDATION_ERROR` | Input failed validation (reason empty, kind missing, exposureId malformed) |
| `EXPOSURE_NOT_FOUND` | No Exposure matched the supplied exposureId |
| `DATABASE_ERROR` | Underlying graph write failed for an infrastructure reason |

### MitreKind

MITRE corpus selector for matchMitreTechniques. Determines which HNSW index is consulted.

| Value | Description |
|-------|-------------|
| `ATTACK_TECHNIQUE` | MITRE ATT&CK adversary technique (T-codes; e.g. T1003, T1003.001) |
| `DEFEND_TECHNIQUE` | MITRE D3FEND defensive technique (D3-codes; e.g. D3-PMAD) |
| `ATTACK_MITIGATION` | MITRE ATT&CK mitigation (M-codes; e.g. M1041) |

### MitreMatchType

How a MITRE candidate matched the user's query. Distinct vocabulary from MatchType (matchClasses): MITRE matching cascades through id / name / description / vector tiers.

| Value | Description |
|-------|-------------|
| `EXACT_ID` | Query exactly equals the MITRE id (e.g. 'T1003' → T1003) |
| `PREFIX_ID` | Query is a prefix of the MITRE id (e.g. 'T100' → T1003) |
| `NAME_MATCH` | Query substring matched the candidate's name |
| `DESCRIPTION_MATCH` | Query substring matched the candidate's description |
| `VECTOR_SIMILARITY` | Server-computed embedding cosine-similarity match against the HNSW index |

### VectorDisabledReason

Why the vector tier of matchMitreTechniques is disabled. Drives the picker caption and lets it differentiate deployment-lacks-vector from module-misalignment.

| Value | Description |
|-------|-------------|
| `EMBEDDING_DISABLED` | EMBEDDING_ENABLED is false in the deployment's environment |
| `NO_INDEX_MODULE` | Graph backend lacks the vector_search procedure (Neo4j, or older Memgraph) |
| `NO_VECTORS` | MITRE module shipped no embeddings, or per-label coverage is incomplete (partial install) |
| `MODEL_MISMATCH` | Module's embeddingModel disagrees with the platform's runtime EMBEDDING_MODEL |

### ModelingDepth

Modeling depth the author asserts the model reaches.

| Value | Description |
|-------|-------------|
| `ARCHITECTURE` | Reasoning at the architecture level (systems and trust zones) |
| `DESIGN` | Reasoning at the design level (components and interfaces) |
| `IMPLEMENTATION` | Reasoning at the implementation level (concrete code and config) |

### ModelingIntent

Why this model is being built — drives the analysis-phase emphasis.

| Value | Description |
|-------|-------------|
| `INITIAL` | Initial pass to establish a baseline model |
| `SECURITY_REVIEW` | Focused security review of an existing system |
| `COMPLIANCE` | Driven by a compliance obligation |
| `INCIDENT_RESPONSE` | Modeling in support of an active incident response |

### SensitivityLevel

Author-asserted data sensitivity classification.

| Value | Description |
|-------|-------------|
| `PUBLIC` | Public — no confidentiality requirement |
| `INTERNAL` | Internal — restricted to the organization |
| `CONFIDENTIAL` | Confidential — limited distribution |
| `RESTRICTED` | Restricted — strict need-to-know |

### ElementBindingKind

Discriminator for the desired binding kind on an element.

| Value | Description |
|-------|-------------|
| `CLASS` |  |
| `REPRESENTED_MODEL` |  |
| `NONE` |  |

### ElementBindingErrorCode

Structured error codes returned from changeElementBinding. Null on
success. UI branches on the code; `errorMessage` carries a sanitised
human-readable string suitable for snackbar display.

| Value | Description |
|-------|-------------|
| `VALIDATION_ERROR` |  |
| `ELEMENT_NOT_FOUND` |  |
| `CLASS_NOT_FOUND` |  |
| `MODEL_NOT_FOUND` |  |
| `ORPHAN_CLASS_REFUSED` |  |
| `REPRESENTED_MODEL_NOT_ALLOWED` |  |
| `MODULE_ERROR` |  |
| `DATABASE_ERROR` |  |

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
| `modules` | `[Module!]!` | Modules previously attached to this model. UI-deprecated as of 2026-05 —
the class picker uses the global module catalogue via listClasses / matchClasses.
Reserved for potential future governance use cases (catalogue scoping policy).
Do not reintroduce a UI for this relationship without revisiting the
class-picker design. (→ `HAS_MODULE`) |
| `controls` | `[Control!]!` | Controls applied to this model (← `SUPPORTS`) |
| `dataItems` | `[Data!]!` | Data elements defined in this model (→ `CONTAINS`) |
| `representedBy` | `[Element!]!` | Components that represent this model (for model-in-model composition) (← `REPRESENTS_MODEL`) |
| `analyses` | `[Analysis!]!` | Analyses run against this model (→ `ANALYZED_BY`) |
| `issues` | `[Issue!]!` | Issues associated with this model (→ `HAS_ISSUE`) |
| `folder` | `[Folder!]!` | Folder containing this model (← `FOLDER_CONTAINS`) |
| `depth` | `ModelingDepth` | Modeling depth asserted by the author (architecture / design / implementation) |
| `modelingIntent` | `ModelingIntent` | Why this model is being built (drives the analysis-phase emphasis) |
| `complianceDrivers` | `[String!]` | Compliance frameworks driving this model (free-text, e.g. PCI-DSS, HIPAA) |
| `exclusions` | `[String!]` | Areas the author explicitly declared out of scope |
| `trustAssumptions` | `[String!]` | Trust assumptions the author is making about the environment |

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
| `crownJewel` | `Boolean` | Author flag marking this component a crown jewel (high-value asset). Null ⇒ false. |

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
| `trustLevel` | `TrustLevel` | Dormant/deprecated trust level — replaced by `zone`. |
| `zone` | `Zone` | Trust/exposure gradient. NULL = inherit from the nearest declaring ancestor. |
| `domains` | `[String!]` | Open-vocabulary business functions this boundary serves. |
| `planes` | `[String!]` | Operational roles present on this boundary, drawn from the `Plane` vocabulary. NULL/empty = undecided. |
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
| `outboundConduits` | `[SecurityBoundary!]!` | Peers this boundary is declared/intended to reach (egress) — CONDUIT edges OUT. Edge direction = approved flow direction. Declared intent, not an enforced permission. (→ `CONDUIT`) |
| `inboundConduits` | `[SecurityBoundary!]!` | Peers declared/intended to be able to reach this boundary (ingress) — CONDUIT edges IN. Declared intent, not an enforced permission. (← `CONDUIT`) |
| `positionX` | `Float` | X position on the canvas |
| `positionY` | `Float` | Y position on the canvas |
| `dimensionsWidth` | `Float` | Width on the canvas |
| `dimensionsHeight` | `Float` | Height on the canvas |
| `dimensionsMinWidth` | `Float` | Minimum width on the canvas |
| `dimensionsMinHeight` | `Float` | Minimum height on the canvas |
| `allDescendantBoundaries` | `[SecurityBoundary!]!` | All nested boundaries at any depth (computed via Cypher traversal) |
| `allDescendantComponents` | `[Component!]!` | All components inside this boundary or any nested boundary (computed) |
| `allDescendantDataFlows` | `[DataFlow!]!` | All data flows touching components in this boundary or nested boundaries (computed) |

### ConduitProperties

Disposition metadata on a CONDUIT edge. Carries intent only — never asserts legality.

| Field | Type | Description |
|-------|------|-------------|
| `justification` | `String` | Optional free-text rationale, written by the modeler (e.g. 'payment service to Stripe, sanctioned'). |
| `controlRefs` | `[ID!]` | Optional reference(s) to the mediating control(s) that make it safe. Scalar id(s) this round. |

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
| `sensitivity` | `SensitivityLevel` | Author-asserted sensitivity classification of this data. Null ⇒ unclassified. |
| `regulatoryFlags` | `[String!]` | Regulatory scopes this data falls under (free-text, e.g. "PCI cardholder", "PHI"). Null ⇒ []. |

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
| `elements` | `[Element!]!` | Elements this control is applied to (polymorphic). Note: the auto-generated resolver for this interface field has correctness and performance issues against Memgraph — prefer the typed fields below for production queries. Retained for backward compatibility with external consumers. (→ `SUPPORTS`) |
| `supportedComponents` | `[Component!]!` | Components this control is applied to (→ `SUPPORTS`) |
| `supportedBoundaries` | `[SecurityBoundary!]!` | Security boundaries this control is applied to (→ `SUPPORTS`) |
| `supportedDataFlows` | `[DataFlow!]!` | Data flows this control is applied to (→ `SUPPORTS`) |
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
| `orphanedComponentClasses` | `[ComponentClass!]!` | Component classes retired by this module (still attached to existing instances) (→ `HAS_ORPHANED_CLASS`) |
| `dataFlowClasses` | `[DataFlowClass!]!` | Data flow classes provided by this module (→ `HAS_CLASS`) |
| `orphanedDataFlowClasses` | `[DataFlowClass!]!` | Data flow classes retired by this module (→ `HAS_ORPHANED_CLASS`) |
| `securityBoundaryClasses` | `[SecurityBoundaryClass!]!` | Security boundary classes provided by this module (→ `HAS_CLASS`) |
| `orphanedSecurityBoundaryClasses` | `[SecurityBoundaryClass!]!` | Security boundary classes retired by this module (→ `HAS_ORPHANED_CLASS`) |
| `controlClasses` | `[ControlClass!]!` | Control classes provided by this module (→ `HAS_CLASS`) |
| `orphanedControlClasses` | `[ControlClass!]!` | Control classes retired by this module (→ `HAS_ORPHANED_CLASS`) |
| `dataClasses` | `[DataClass!]!` | Data classes provided by this module (→ `HAS_CLASS`) |
| `orphanedDataClasses` | `[DataClass!]!` | Data classes retired by this module (→ `HAS_ORPHANED_CLASS`) |
| `analysisClasses` | `[AnalysisClass!]!` | Analysis classes provided by this module (→ `HAS_CLASS`) |
| `orphanedAnalysisClasses` | `[AnalysisClass!]!` | Analysis classes retired by this module (still attached to existing analyses) (→ `HAS_ORPHANED_CLASS`) |
| `issueClasses` | `[IssueClass!]!` | Issue classes provided by this module (→ `HAS_CLASS`) |
| `orphanedIssueClasses` | `[IssueClass!]!` | Issue classes retired by this module (still attached to existing issues) (→ `HAS_ORPHANED_CLASS`) |
| `template` | `String` | Module configuration template (resolved at runtime) (custom resolver) |
| `attributes` | `String` | Module configuration attributes (JSON string) |
| `path` | `String` | File system path to the module |
| `idRebindPolicy` | `String` | Effective ID rebind policy from the module's metadata at last install ('audit' | 'strict' | 'silent'). |
| `lastInstallStatus` | `String` | Status of the most recent install attempt: 'authoritative' | 'partial' | 'unavailable' | 'error'. Null if the module has never been installed. |
| `lastAttemptedInstall` | `DateTime` | ISO timestamp of the most recent install attempt (success or failure). Null if never installed. |
| `lastAuthoritativeInstall` | `DateTime` | ISO timestamp of the most recent install that completed without partial/unavailable/error markers. Null if never had a clean install. |
| `lastInstallClassIds` | `String` | JSON snapshot of `[{classKind, className, declaredId}, ...]` written at the last install attempt. Internal — used to resolve `rebindConflicts.moduleDeclaredId` after a strict-mode block. Self-healing: every install overwrites the snapshot; null until the module's first install. |
| `rebindConflicts` | `[RebindConflictDetail!]!` | Per-class strict-mode rebind conflicts from the most recent install. Resolver joins `lastInstallClassIds` against the current DB ids; rows where they differ are surfaced as conflicts. Empty list if the module has never been installed (no snapshot) or every declared id matches the DB. (custom resolver) |
| `constraintsHealthy` | `Boolean!` | True if all schema constraints required by the class-identity safety net were created at startup; false if any label was skipped due to dirty data. Reflects the bootstrap result from EnsureConstraintsService — same value for every Module today (the safety net is a global property of the deployment, exposed per-Module for surfaceability in any modules-list view). (custom resolver) |

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
| `score` | `Float` | Risk score |
| `references` | `String` | External references (URLs, CVE IDs) |
| `mitigationSuggestions` | `[String!]` | Suggested mitigations |
| `detectionMethods` | `[String!]` | Detection methods |
| `tags` | `[String!]` | Tags for filtering and grouping |
| `techniques` | `[String!]` | MITRE ATT&CK technique IDs |
| `attackVector` | `AttackVector` | CVSS-aligned attack vector classification |
| `createdBy` | `String` | Authorship kind. 'SYSTEM' = module-instantiated via class binding. 'USER' = hand-authored. Null on legacy data is treated as SYSTEM by the cleanup paths. Server-enforced via @populatedBy on the auto-generated CREATE mutations — the callback overrides any client-supplied value with 'USER'. The SYSTEM write path goes via Cypher (SetInstantiationAttributesService) and bypasses this directive. |
| `authoredBy` | `String` | Creator reference, populated server-side at CREATE time. For USER findings: the authenticated user identifier (JWT sub claim) from context, set by the @populatedBy callback. For SYSTEM findings: an optional module-provided attribution string (feed name, advisory id, researcher name) that the module includes in its return; the module value flows through the resolver's sanitised \$attrs allowlist. Client-supplied values on auto-generated CREATE mutations are overridden by the @populatedBy callback. |
| `dispositionKind` | `DispositionKind` | Disposition kind. Null = active (no disposition). When non-null, the user has authored a structured argument that this finding should be treated differently from the default 'actionable' interpretation. Set via the disposeExposure / Supersede flows; cleared via clearDisposition. The @neo4j/graphql auto-generated update input shape exposes this field as writeable for legitimate operator workflows (direct-GraphQL is a power-user surface); the structured mutations are the preferred path and the only one the UI exercises. AFFIRMED is the one kind that keeps the finding live (reviewed and confirmed a real risk) rather than muting it. |
| `dispositionReason` | `String` | Free-text justification authored by the user. Mandatory (non-empty after trim) when dispositionKind is non-null. Captured at dispose time and on every modification / re-affirm. For SUPERSEDED dispositions populated via the frontend Supersede flow, defaults to "Superseded by user-authored exposure '<name>'" — user-editable after. The single-quote wrapping around the clone's name is load-bearing for the USER-copy-delete companion staleness flip. |
| `dispositionedBy` | `String` | User id (JWT sub claim) of the user who authored the current disposition. Stamped by the disposeExposure resolver from context.user.sub. Null when dispositionKind is null. Updated on every dispose call (including re-affirm — the backend treats them identically). Server-stamped via the structured mutation only — the @settable(onCreate/onUpdate: false) directives prevent direct-GraphQL spoofing of this forensic-provenance field, matching the posture of createdBy / authoredBy above. |
| `dispositionedAt` | `DateTime` | ISO-8601 timestamp when the current disposition was authored or last modified / re-affirmed. Stamped by the resolver. Null when dispositionKind is null. Updated on every dispose call. Server-stamped only — @settable directives prevent backdating via direct-GraphQL. |
| `dispositionStale` | `Boolean` | True when an instantiation attribute value has changed since the disposition was last authored or re-affirmed. Flipped by SetInstantiationAttributesService inside the same transaction that writes the attribute change, and by the USER-copy-delete companion stale-flip (via the generated update mutation). Cleared by a subsequent disposeExposure call (re-affirm). Meaningful only when dispositionKind is non-null; null / false otherwise. After clearDisposition the field is null alongside the other four; null and false are semantically equivalent across all consumers. Intentionally settable via the generated update mutation so the companion flip can write it — the GUI approval dialogs are the guard on the direct-GraphQL power-user surface (a self-affecting review flag does not warrant a backend lock; cf dispositionedBy / dispositionedAt which stay @settable-locked). |
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
| `score` | `Float` | Effectiveness score |
| `references` | `String` | External references |
| `addressedExposures` | `[String!]` | Exposure names this countermeasure addresses |
| `tags` | `[String!]` | Tags for filtering and grouping |
| `createdBy` | `String` | Authorship kind. 'SYSTEM' = module-instantiated via class binding. 'USER' = hand-authored. Server-enforced via @populatedBy on the auto-generated CREATE mutations — the callback overrides client input. See the matching field on Exposure for full rationale. |
| `authoredBy` | `String` | Creator reference, populated server-side at CREATE time. See the matching field on Exposure for full rationale. Client-supplied values on auto-generated CREATE mutations are overridden by the @populatedBy callback. |
| `dispositionKind` | `DispositionKind` | Disposition kind. Null = active (no disposition). When non-null, the user has authored a structured argument that this finding should be treated differently from the default 'actionable' interpretation. Set via the disposeCountermeasure / Supersede flows; cleared via clearCountermeasureDisposition. The @neo4j/graphql auto-generated update input shape exposes this field as writeable for legitimate operator workflows (direct-GraphQL is a power-user surface); the structured mutations are the preferred path and the only one the UI exercises. AFFIRMED is the one kind that keeps the finding live (reviewed and confirmed in place) rather than muting it. |
| `dispositionReason` | `String` | Free-text justification authored by the user. Mandatory (non-empty after trim) when dispositionKind is non-null. Captured at dispose time and on every modification / re-affirm. For SUPERSEDED dispositions populated via the frontend Supersede flow, defaults to "Superseded by user-authored countermeasure '<name>'" — user-editable after. The single-quote wrapping around the clone's name is load-bearing for the USER-copy-delete companion staleness flip. |
| `dispositionedBy` | `String` | User id (JWT sub claim) of the user who authored the current disposition. Stamped by the disposeCountermeasure resolver from context.user.sub. Null when dispositionKind is null. Updated on every dispose call (including re-affirm — the backend treats them identically). Server-stamped via the structured mutation only — the @settable(onCreate/onUpdate: false) directives prevent direct-GraphQL spoofing of this forensic-provenance field, matching the posture of createdBy / authoredBy above. |
| `dispositionedAt` | `DateTime` | ISO-8601 timestamp when the current disposition was authored or last modified / re-affirmed. Stamped by the resolver. Null when dispositionKind is null. Updated on every dispose call. Server-stamped only — @settable directives prevent backdating via direct-GraphQL. |
| `dispositionStale` | `Boolean` | True when an instantiation attribute value has changed since the disposition was last authored or re-affirmed. Flipped by SetInstantiationAttributesService inside the same transaction that writes the attribute change, and by the USER-copy-delete companion stale-flip (via the generated update mutation). Cleared by a subsequent disposeCountermeasure call (re-affirm). Meaningful only when dispositionKind is non-null; null / false otherwise. After clearCountermeasureDisposition the field is null alongside the other four; null and false are semantically equivalent across all consumers. Intentionally settable via the generated update mutation so the companion flip can write it — the GUI approval dialogs are the guard on the direct-GraphQL power-user surface (a self-affecting review flag does not warrant a backend lock; cf dispositionedBy / dispositionedAt which stay @settable-locked). |
| `mitigations` | `[MitreAttackMitigation!]!` | ATT&CK mitigations implemented by this countermeasure (→ `RESPONDS_WITH`) |
| `defendedTechniques` | `[MitreDefendTechnique!]!` | D3FEND techniques implemented by this countermeasure (→ `RESPONDS_WITH`) |
| `mitigates` | `[MitreAttackTechnique!]!` | ATT&CK techniques this countermeasure mitigates (COUNTERMEASURE_MITIGATES). Distinct from `mitigations` — those are the ATT&CK Mitigation nodes this countermeasure implements, via RESPONDS_WITH; these are the ATT&CK Techniques it counters. (→ `COUNTERMEASURE_MITIGATES`) |
| `protectsAgainst` | `[MitreAttackTechnique!]!` | ATT&CK techniques this countermeasure hardens against (COUNTERMEASURE_PROTECTS_AGAINST) (→ `COUNTERMEASURE_PROTECTS_AGAINST`) |
| `detects` | `[MitreAttackTechnique!]!` | ATT&CK techniques this countermeasure detects (COUNTERMEASURE_DETECTS) (→ `COUNTERMEASURE_DETECTS`) |
| `isolates` | `[MitreAttackTechnique!]!` | ATT&CK techniques this countermeasure isolates (COUNTERMEASURE_ISOLATES) (→ `COUNTERMEASURE_ISOLATES`) |
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
| `analysisStatus` | `String` | Analysis lifecycle status (active, complete, archived) |
| `scope_description` | `String` | Free-text scope description |
| `scope_elements` | `[String!]` | Element IDs defining the analysis scope (soft marker, not enforced) |
| `risk_mode` | `String` | Risk assessment mode (simple or graph_informed) |
| `notes` | `[String!]` | Analysis-level notes |

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

### OrphanSweepLabelCount

One (label, count) row in an OrphanSweepReport — `count` is the number of nodes of `label` deleted (or, on a dry-run, that would be deleted).

| Field | Type | Description |
|-------|------|-------------|
| `label` | `String!` | Node label swept (e.g. 'Data', 'Exposure'). Loaded modules contribute their own label values at runtime — the platform treats them as opaque strings. |
| `count` | `Int!` | Orphan nodes of this label deleted (planned, if dryRun=true). |

### OrphanSweepReport

Result of sweepOrphans. Counts are 'planned' if dryRun=true, 'applied' otherwise. `byLabel` is the per-label breakdown aggregated across the core sweep and every module's orphan-sweep hook.

| Field | Type | Description |
|-------|------|-------------|
| `dryRun` | `Boolean!` | True if this was a dry-run (no writes performed). |
| `totalNodes` | `Int!` | Total orphan nodes deleted (or planned). |
| `totalRelationships` | `Int!` | Total relationships removed from the orphan nodes (or planned). |
| `byLabel` | `[OrphanSweepLabelCount!]!` | Per-label orphan breakdown. |

### IdentityMigrationReport

Result of runIdentityMigration. Counts are 'planned' if dryRun=true, 'applied' otherwise. `details` is the human-readable per-action log (one entry per dedup group + mutating action).

| Field | Type | Description |
|-------|------|-------------|
| `dryRun` | `Boolean!` | True if this was a dry-run (no writes performed). |
| `totalActions` | `Int!` | Sum of mutating actions performed (or planned, in dry-run). |
| `details` | `[String!]!` | Per-source breakdown — log-line strings. |

### RebindConflictDetail

Per-class strict-mode rebind conflict detail. Surfaces the diff between the module's declared id at last install and the DB-resident id, so an operator can pick a resolution direction in `ConflictResolutionDialog`.

| Field | Type | Description |
|-------|------|-------------|
| `className` | `String!` | Class name (stable identifier across rebinds). |
| `classKind` | `String!` | Class kind label ('ComponentClass' | 'AnalysisClass' | …). |
| `dbId` | `ID!` | Current id of the class in the DB. |
| `moduleDeclaredId` | `ID!` | Id the module declared at the last install attempt (resolved from `Module.lastInstallClassIds`). |

### TypeCount

Generic (parent-label, count) pair. Used by `*Class.incomingInstancesByType` to break down :IS_INSTANCE_OF edges by parent label, so `CascadeDeleteDialog` can warn when 'Analyses' (user work) are present.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `String!` | Parent node label (e.g. 'Analysis', 'Component', 'Issue'). |
| `count` | `Int!` | Number of incoming :IS_INSTANCE_OF edges from nodes of this label. |

### ClassIdentityEvent

Discriminated event from the in-memory class-identity event log.
The `kind` field is the discriminant ('rebind' | 'rebind-conflict' |
'collision' | 'orphan' | 'revive'); per-kind fields are nullable on
the union shape and populated based on the discriminant value.

| Field | Type | Description |
|-------|------|-------------|
| `kind` | `String!` | Discriminant: 'rebind' | 'rebind-conflict' | 'collision' | 'orphan' | 'revive' |
| `timestamp` | `String!` | ISO timestamp of event emission. |
| `moduleName` | `String` | Module name (null for collision events — see firstModuleName/secondModuleName). |
| `classKind` | `String` | Pluralized class-kind key from @dethernety/dt-module ('analysisClasses' | 'componentClasses' | ...). |
| `className` | `String` | Class name (the human-readable identifier). |
| `oldId` | `String` | Pre-rebind id (rebind events) or current DB id (rebind-conflict events). |
| `newId` | `String` | Post-rebind id (rebind events only). |
| `moduleDeclaredId` | `String` | Module-declared id (rebind-conflict events only). |
| `dbId` | `String` | Current DB id at time of conflict (rebind-conflict events only). |
| `policy` | `String` | Rebind policy applied: 'audit' | 'silent' | 'strict'. |
| `classId` | `String` | Class id (orphan / revive events). |
| `reason` | `String` | Reason for orphaning ('absent-from-metadata' | 'legacy-id-superseded'). |
| `firstModuleName` | `String` | First module of a collision (the one that created the colliding id). |
| `secondModuleName` | `String` | Second module of a collision (the one whose install was rejected). |
| `collidingId` | `String` | The id that collided across modules. |

### ClassCandidate

A single candidate class match.

| Field | Type | Description |
|-------|------|-------------|
| `classId` | `ID!` | Class node ID |
| `className` | `String!` | Class name |
| `classDescription` | `String` | Class description (included when 'description' is in fields) |
| `classCategory` | `String` | Class category (included when 'category' is in fields) |
| `classType` | `String` | Class type (included when 'type' is in fields) |
| `moduleId` | `ID!` | ID of the module providing this class |
| `moduleName` | `String!` | Name of the module providing this class |
| `matchType` | `MatchType!` | How this match was determined |
| `confidence` | `ConfidenceLevel!` | Confidence level of the match |
| `similarityScore` | `Float` | Similarity score (0.0–1.0, present for vector matches) |

### ElementMatch

Match results for a single element.

| Field | Type | Description |
|-------|------|-------------|
| `elementName` | `String!` | The element name from the input |
| `candidates` | `[ClassCandidate!]!` | Ordered list of candidate matches (best first) |

### MatchClassesResult

Top-level result for the matchClasses query.

| Field | Type | Description |
|-------|------|-------------|
| `matches` | `[ElementMatch!]!` | Match results per element, in input order |
| `unmatched` | `[String!]!` | Element names that matched at no priority level |
| `vectorAvailable` | `Boolean!` | Whether the deployment supports semantic search (Memgraph 3.0+ with vector module). False on Neo4j or older Memgraph. Does not guarantee that any specific class label has an embedded index. |

### ClassFacetEntry

One facet bucket for a string-valued dimension (categories, types).

| Field | Type | Description |
|-------|------|-------------|
| `value` | `String!` |  |
| `count` | `Int!` |  |

### ClassModuleFacetEntry

One facet bucket for the modules dimension — carries id (for filter input) and name (for display).

| Field | Type | Description |
|-------|------|-------------|
| `moduleId` | `ID!` |  |
| `moduleName` | `String!` |  |
| `count` | `Int!` |  |

### ClassFacetCounts

Server-aggregated facet counts over the filtered listClasses candidate set.

| Field | Type | Description |
|-------|------|-------------|
| `categories` | `[ClassFacetEntry!]!` |  |
| `modules` | `[ClassModuleFacetEntry!]!` |  |
| `types` | `[ClassFacetEntry!]!` |  |

### ListClassesResult

Top-level result for the listClasses query.

| Field | Type | Description |
|-------|------|-------------|
| `items` | `[ClassCandidate!]!` | Page of class candidates (reuses ClassCandidate shape; matchType is 'type_match', similarityScore is null) |
| `totalCount` | `Int!` | Total candidates across all pages, given the current filter |
| `facetCounts` | `ClassFacetCounts!` | Facet counts derived from the same filtered set as items |

### UnmitigatedExposure

An exposure that has MITRE mitigations but no control implements them.

| Field | Type | Description |
|-------|------|-------------|
| `elementId` | `ID!` |  |
| `elementName` | `String!` |  |
| `exposureId` | `ID!` |  |
| `exposureName` | `String!` |  |
| `attackTechniques` | `[MitreReference!]!` |  |
| `recommendedMitigations` | `[MitreReference!]!` |  |

### UnaddressableExposure

An exposure whose MITRE mitigations have no installed ControlClass coverage.

| Field | Type | Description |
|-------|------|-------------|
| `elementId` | `ID!` |  |
| `elementName` | `String!` |  |
| `exposureId` | `ID!` |  |
| `exposureName` | `String!` |  |
| `attackTechniques` | `[MitreReference!]!` |  |
| `mitreMitigations` | `[MitreReference!]!` |  |

### RecommendedControl

A control or control class that addresses unmitigated techniques.

| Field | Type | Description |
|-------|------|-------------|
| `controlId` | `ID` |  |
| `controlName` | `String` |  |
| `controlClassId` | `ID!` |  |
| `controlClassName` | `String!` |  |
| `d3fendTechniques` | `[MitreReference!]!` |  |
| `addressesCount` | `Int!` |  |
| `elementsAffected` | `[ElementReference!]!` |  |

### ElementReference

A reference to a model element.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ID!` |  |
| `name` | `String!` |  |

### CoverageSummary

Coverage summary for the gap analysis.

| Field | Type | Description |
|-------|------|-------------|
| `totalExposures` | `Int!` |  |
| `mitigated` | `Int!` |  |
| `unmitigated` | `Int!` |  |
| `unaddressable` | `Int!` |  |
| `configuredCoverage` | `Int!` | Controls assigned but addressing different techniques than this exposure |
| `noMitreChain` | `Int!` | Exposures without ATT&CK technique links (not analyzable through MITRE chain) |
| `coveragePct` | `Float!` |  |

### ControlGapsResult

Result of the controlGaps query.

| Field | Type | Description |
|-------|------|-------------|
| `unmitigatedExposures` | `[UnmitigatedExposure!]!` |  |
| `unaddressableExposures` | `[UnaddressableExposure!]!` |  |
| `recommendedControls` | `[RecommendedControl!]!` |  |
| `coverageSummary` | `CoverageSummary!` |  |

### ControlClassFit

A control class's fit for a set of element types.

| Field | Type | Description |
|-------|------|-------------|
| `classId` | `ID!` | Class ID |
| `className` | `String!` | Class name |
| `moduleId` | `ID!` | Module ID this class belongs to |
| `moduleName` | `String!` | Module name |
| `compatible` | `Boolean!` | Whether this class's supportedTypes includes any of the queried element types |
| `countermeasureCount` | `Int!` | Number of countermeasures generated for this class (>0 means configured) |

### ControlCandidate

A control candidate with per-class fit details.

| Field | Type | Description |
|-------|------|-------------|
| `controlId` | `ID!` | Control ID |
| `controlName` | `String!` | Control name |
| `classes` | `[ControlClassFit!]!` | Per-class fit details |
| `totalCountermeasures` | `Int!` | Total countermeasures across all classes |
| `assignedElementIds` | `[ID!]!` | Element IDs this control already SUPPORTS |

### ReindexResult

Result of the reindexClassEmbeddings mutation.

| Field | Type | Description |
|-------|------|-------------|
| `reindexedCount` | `Int!` | Number of class nodes that were re-embedded |
| `moduleNames` | `[String!]!` | Names of modules whose classes were re-embedded |

### ControlAssignedModels

Set of Model IDs that reference a given Control via SUPPORTS edges.

Used by the control-library push pipeline to gate brownfield attribute edits
on shared Controls (shared = assigned to more than one model). See
CONTROL_LIBRARY.md §6 for the shared-ownership safety contract.

| Field | Type | Description |
|-------|------|-------------|
| `controlId` | `ID!` | Control UUID |
| `modelIds` | `[ID!]!` | Set of Model UUIDs reachable via SUPPORTS edges (deduplicated across branches) |

### ControlInstantiationAttribute

Per-(Control, ControlClass) instantiation attribute payload from the
IS_INSTANCE_OF edge. Backs the control-library pull and push-brownfield
refresh pipelines. See CONTROL_LIBRARY.md §7.

| Field | Type | Description |
|-------|------|-------------|
| `controlId` | `ID!` | Control UUID |
| `classId` | `ID` | ControlClass UUID — null if the Control has no IS_INSTANCE_OF edge to any ControlClass |
| `attributes` | `JSON` | Edge properties (the per-instance attribute payload). Null when classId is null. |

### ClassBinding

Class-based binding state (one or more ControlClasses, or exactly one of any other *Class).

| Field | Type | Description |
|-------|------|-------------|
| `classIds` | `[ID!]!` |  |

### RepresentedModelBinding

Represented-model binding state (Component / SecurityBoundary only).

| Field | Type | Description |
|-------|------|-------------|
| `modelId` | `ID!` |  |

### NoBinding

Empty-binding state. GraphQL union members must declare at least one
field, so `_empty` is a placeholder. Consumers should branch on
`__typename`, not read this field.

| Field | Type | Description |
|-------|------|-------------|
| `_empty` | `Boolean` |  |

### ElementBindingDeltas

Per-mutation counts of what the single executeWrite transaction touched.
All values are zero on identity-transition short-circuit or any error
path. Counts of SYSTEM findings are split between deleted and instantiated;
USER findings only ever appear in `preserved*` (cleanup never touches
them — see ElementBindingService's destructive sweep predicates, which
require `createdBy = 'SYSTEM' OR createdBy IS NULL`).

| Field | Type | Description |
|-------|------|-------------|
| `deletedDerivedExposures` | `Int!` |  |
| `instantiatedDerivedExposures` | `Int!` |  |
| `preservedCustomExposures` | `Int!` |  |
| `deletedDerivedCountermeasures` | `Int!` |  |
| `instantiatedDerivedCountermeasures` | `Int!` |  |
| `preservedCustomCountermeasures` | `Int!` |  |

### ChangeElementBindingResult

Resolver-returned envelope. On success: `errorCode` and `errorMessage`
are null, `deltas` carry the transaction counts, `targetBinding` echoes
the binding that landed. On failure: `success = false`, `errorCode` set,
all deltas zero, no graph mutation persisted.

| Field | Type | Description |
|-------|------|-------------|
| `success` | `Boolean!` |  |
| `elementId` | `ID!` |  |
| `targetBinding` | `ElementBinding!` |  |
| `deltas` | `ElementBindingDeltas!` |  |
| `errorCode` | `ElementBindingErrorCode` |  |
| `errorMessage` | `String` |  |

### SetInstantiationAttributesResult

Result envelope returned by setInstantiationAttributes. `staleFlippedCount`
is non-null when the attribute write succeeded; the value is the number of
dispositioned exposures on the element whose `dispositionStale` was flipped
to true by the second statement of the staleness Cypher. Zero on no-op saves (no value
change) or when the element has no dispositioned exposures.

On failure (`success: false`), `errorCode` and `errorMessage` carry a diagnosis
of why the write was rejected (e.g. the element or class id does not exist, or
the class id resolves to a non-Control class so no IS_INSTANCE_OF edge exists).
Both are null on success. The diagnosis is computed only on the failure path, so
the happy path stays a single round trip.

| Field | Type | Description |
|-------|------|-------------|
| `success` | `Boolean!` | True when the attribute write succeeded; false when validation or DB failure prevented the write. |
| `staleFlippedCount` | `Int` | Number of dispositioned exposures on the element whose `dispositionStale` was flipped to true. Zero on no-op saves or when the element carries no dispositions. |
| `errorCode` | `String` | Stable failure category (e.g. DATABASE_ERROR, VALIDATION_ERROR). Null on success. |
| `errorMessage` | `String` | Human-readable diagnosis of the failure, naming the offending id and the precise reason. Null on success. |

### DispositionMutationResult

Result envelope returned by both disposeExposure and clearDisposition. On
success: errorCode and errorMessage are null; the five disposition fields
echo the state landed on the Exposure (cleared mutation returns all five
as null). On failure: success = false, errorCode set, disposition fields
mirror the pre-mutation state (no graph change persisted).

| Field | Type | Description |
|-------|------|-------------|
| `success` | `Boolean!` |  |
| `exposureId` | `ID!` |  |
| `dispositionKind` | `DispositionKind` |  |
| `dispositionReason` | `String` |  |
| `dispositionedBy` | `String` |  |
| `dispositionedAt` | `DateTime` |  |
| `dispositionStale` | `Boolean` |  |
| `errorCode` | `DispositionErrorCode` |  |
| `errorMessage` | `String` |  |

### MatchMitreTechniquesResult

Result envelope returned by matchMitreTechniques. matches[] is parallel to
input.queries (same order, same length). unmatched[] lists queries that
produced no candidates. vectorAvailable and vectorDisabledReason describe
the runtime's vector-tier health at request time so the picker can surface
the right caption.

| Field | Type | Description |
|-------|------|-------------|
| `matches` | `[TechniqueQueryMatch!]!` |  |
| `unmatched` | `[String!]!` |  |
| `vectorAvailable` | `Boolean!` | False when the deployment has no HNSW indexes, the vector_search module is absent, embedding is disabled, or the module-shipped vectors mismatch the platform's runtime model. |
| `vectorDisabledReason` | `VectorDisabledReason` | When vectorAvailable is false, names the specific reason — drives the picker caption. Null when vectorAvailable is true. |

### TechniqueQueryMatch

Candidate list returned for a single TechniqueQueryInput.

| Field | Type | Description |
|-------|------|-------------|
| `query` | `String!` | Echoes the input query string so clients can correlate batched results. |
| `candidates` | `[MitreCandidate!]!` |  |

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
| `orphanedAt` | `DateTime` | Timestamp at which this class was last orphaned (HAS_CLASS → HAS_ORPHANED_CLASS rename). Null if never orphaned. |
| `incomingInstanceCount` | `Int!` | Count of incoming :IS_INSTANCE_OF edges. Read by operators before invoking deleteOrphanedClass to decide cascade safety. (computed) |
| `incomingInstancesByType` | `[TypeCount!]!` | Breakdown of incoming :IS_INSTANCE_OF edges by parent node label. Used by CascadeDeleteDialog to surface 'this includes user work (Analyses)' warnings via the parent-label rows. (computed) |

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
| `orphanedAt` | `DateTime` | Timestamp at which this class was last orphaned (HAS_CLASS → HAS_ORPHANED_CLASS rename). Null if never orphaned. |
| `incomingInstanceCount` | `Int!` | Count of incoming :IS_INSTANCE_OF edges. Read by operators before invoking deleteOrphanedClass to decide cascade safety. (computed) |
| `incomingInstancesByType` | `[TypeCount!]!` | Breakdown of incoming :IS_INSTANCE_OF edges by parent node label. Used by CascadeDeleteDialog to surface 'this includes user work (Analyses)' warnings via the parent-label rows. (computed) |

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
| `orphanedAt` | `DateTime` | Timestamp at which this class was last orphaned (HAS_CLASS → HAS_ORPHANED_CLASS rename). Null if never orphaned. |
| `incomingInstanceCount` | `Int!` | Count of incoming :IS_INSTANCE_OF edges. Read by operators before invoking deleteOrphanedClass to decide cascade safety. (computed) |
| `incomingInstancesByType` | `[TypeCount!]!` | Breakdown of incoming :IS_INSTANCE_OF edges by parent node label. Used by CascadeDeleteDialog to surface 'this includes user work (Analyses)' warnings via the parent-label rows. (computed) |

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
| `orphanedAt` | `DateTime` | Timestamp at which this class was last orphaned (HAS_CLASS → HAS_ORPHANED_CLASS rename). Null if never orphaned. |
| `incomingInstanceCount` | `Int!` | Count of incoming :IS_INSTANCE_OF edges. Read by operators before invoking deleteOrphanedClass to decide cascade safety. (computed) |
| `incomingInstancesByType` | `[TypeCount!]!` | Breakdown of incoming :IS_INSTANCE_OF edges by parent node label. Used by CascadeDeleteDialog to surface 'this includes user work (Analyses)' warnings via the parent-label rows. (computed) |

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
| `orphanedAt` | `DateTime` | Timestamp at which this class was last orphaned (HAS_CLASS → HAS_ORPHANED_CLASS rename). Null if never orphaned. |
| `incomingInstanceCount` | `Int!` | Count of incoming :IS_INSTANCE_OF edges. Read by operators before invoking deleteOrphanedClass to decide cascade safety. (computed) |
| `incomingInstancesByType` | `[TypeCount!]!` | Breakdown of incoming :IS_INSTANCE_OF edges by parent node label. Used by CascadeDeleteDialog to surface 'this includes user work (Analyses)' warnings via the parent-label rows. (computed) |

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
| `orphanedAt` | `DateTime` | Timestamp at which this class was last orphaned (HAS_CLASS → HAS_ORPHANED_CLASS rename). Null if never orphaned. |
| `incomingInstanceCount` | `Int!` | Count of incoming :IS_INSTANCE_OF edges. Read by operators before invoking deleteOrphanedClass to decide cascade safety. (computed) |
| `incomingInstancesByType` | `[TypeCount!]!` | Breakdown of incoming :IS_INSTANCE_OF edges by parent node label. Used by CascadeDeleteDialog to surface 'this includes user work (Analyses)' warnings via the parent-label rows. (computed) |

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
| `orphanedAt` | `DateTime` | Timestamp at which this class was last orphaned (HAS_CLASS → HAS_ORPHANED_CLASS rename). Null if never orphaned. |
| `incomingInstanceCount` | `Int!` | Count of incoming :IS_INSTANCE_OF edges. Read by operators before invoking deleteOrphanedClass to decide cascade safety. (computed) |
| `incomingInstancesByType` | `[TypeCount!]!` | Breakdown of incoming :IS_INSTANCE_OF edges by parent node label. Used by CascadeDeleteDialog to surface 'this includes user work (Analyses)' warnings via the parent-label rows. (computed) |

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

### MitreReference

A reference to a MITRE ATT&CK or D3FEND entity.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `String!` |  |
| `name` | `String!` |  |

### MitreCandidate

A single MITRE candidate. Shape is uniform across the three MitreKind values; mitreId reads from attack_id (ATT&CK) or d3fendId (D3FEND).

| Field | Type | Description |
|-------|------|-------------|
| `mitreId` | `String!` | T1003 / T1003.001 / D3-PMAD / M1041 — read from attack_id (ATT&CK) or d3fendId (D3FEND). |
| `name` | `String!` |  |
| `description` | `String` |  |
| `tactic` | `String` | ATT&CK tactic name or D3FEND tactic name (same field; distinct vocabularies). |
| `kind` | `MitreKind!` |  |
| `matchType` | `MitreMatchType!` |  |
| `similarityScore` | `Float` | Populated for VECTOR_SIMILARITY matches; null for the deterministic tiers (EXACT_ID, PREFIX_ID, NAME_MATCH, DESCRIPTION_MATCH). |

## Utility types

Helper types used as return values or nested structures.

### AnalysisStatus

Status of a running or completed analysis.

| Field | Type | Description |
|-------|------|-------------|
| `createdAt` | `String!` | When the analysis was started |
| `updatedAt` | `String!` | When the status was last updated |
| `status` | `String!` | Current status (e.g., running, completed, failed) |
| `hasDocument` | `Boolean!` | True once a run has completed successfully and a viewable result exists |
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

## Input types

Input object types passed as arguments to queries and mutations.

### MatchElementInput

A single element to match against the class catalog.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `String!` | Element name to match |
| `type` | `ComponentType` | Element type (for context; the componentType filter on MatchClassesInput controls catalog filtering) |
| `description` | `String` | Optional free-text description (used by vector matching in a future phase) |

### MatchClassesInput

Input for the matchClasses query.

| Field | Type | Description |
|-------|------|-------------|
| `elements` | `[MatchElementInput!]!` | Elements to match (max 100) |
| `classLabel` | `ClassLabelEnum!` | Which class node label to search |
| `componentType` | `ComponentType` | Filter ComponentClass nodes by type (only when classLabel = COMPONENT) |
| `moduleIds` | `[ID!]` | Restrict search to classes from these modules |
| `topN` | `Int` | Number of top candidates per element |
| `fields` | `[MatchClassFieldEnum!]` | Which optional fields to include on candidates |

### ListClassesInput

Input for the listClasses query — paginated, server-aggregated class catalogue.

| Field | Type | Description |
|-------|------|-------------|
| `classLabel` | `ClassLabelEnum!` | Which class node label to list |
| `componentType` | `ComponentType` | Filter ComponentClass nodes by type (only when classLabel = COMPONENT) |
| `search` | `String` | Case-insensitive substring filter on class name |
| `categories` | `[String!]` | OR within: classes matching any of these categories |
| `moduleIds` | `[ID!]` | OR within: classes provided by any of these modules |
| `offset` | `Int` | Result offset for pagination |
| `limit` | `Int` | Maximum number of items to return (clamped server-side to [1, 200]) |

### ControlGapsInput

Input for the controlGaps query.

| Field | Type | Description |
|-------|------|-------------|
| `modelId` | `ID!` | Model ID to analyze |
| `topN` | `Int` | Number of top recommended controls to return |
| `limit` | `Int` | Maximum number of unmitigated exposures to return |

### ElementBindingInput

Input shape for the desired post-mutation binding. Exactly one of
`classIds` / `modelId` must be set, gated by `kind`:
- kind = CLASS: `classIds` non-empty (length 1 for non-Controls; 0+ for Controls).
- kind = REPRESENTED_MODEL: `modelId` non-null.
- kind = NONE: both `classIds` and `modelId` null.

| Field | Type | Description |
|-------|------|-------------|
| `kind` | `ElementBindingKind!` |  |
| `classIds` | `[ID!]` |  |
| `modelId` | `ID` |  |

### MatchMitreTechniquesInput

Input envelope for matchMitreTechniques. Batch shape — the picker sends
single-element arrays today. Server clamps queries to MAX_QUERIES (25) and
topN to [1, 50].

| Field | Type | Description |
|-------|------|-------------|
| `queries` | `[TechniqueQueryInput!]!` | One or more query strings. Each becomes an entry in matches[] in result. |
| `kind` | `MitreKind!` | Corpus to match against — determines which HNSW index the server consults. |
| `topN` | `Int` | Per-query result cap. Clamped to [1, 50] server-side. Defaults to 3. |

### TechniqueQueryInput

Single query as part of a MatchMitreTechniquesInput.queries batch.

| Field | Type | Description |
|-------|------|-------------|
| `query` | `String!` | User-typed text. May be a MITRE id (T1003), a partial id (T100), a name fragment, or free-form intent. Hard cap MAX_QUERY_LENGTH (500). |

## Queries

All queries require authentication (`@authentication`).

### getExposuresForElement

Get all exposures attached to a specific element

**Returns:** `[Exposure!]!`

**Arguments:**

| Argument | Type |
|----------|------|
| `elementId` | `String!` |

### dataInRegulatoryScope

All Data whose regulatoryFlags contains the given flag (exact, case-sensitive).
Intentional full :Data scan (regulatoryFlags is a list — not indexable on Memgraph);
finds direct handlers only. A producer typo ("phi" vs "PHI") returns [] silently,
so producers must emit the canonical casing — see the canonical regulatory-flag
vocabulary in docs/architecture/dethereal/THREAT_MODELING_WORKFLOW.md.

**Returns:** `[Data!]!`

**Arguments:**

| Argument | Type |
|----------|------|
| `flag` | `String!` |

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

### matchClasses

Match elements against class catalog nodes using a multi-priority pipeline

**Returns:** `MatchClassesResult!`

**Arguments:**

| Argument | Type |
|----------|------|
| `input` | `MatchClassesInput!` |

### matchMitreTechniques

Match MITRE techniques / mitigations against user queries using the full
priority cascade (EXACT_ID → PREFIX_ID → NAME_MATCH → DESCRIPTION_MATCH →
VECTOR_SIMILARITY). Mirrors matchClasses; consumed by the TechniquePicker.
The server returns at most
one tier of results per query; the picker is responsible for displaying
the server's tier-5 results below client-computed tiers 1–4.

**Returns:** `MatchMitreTechniquesResult!`

**Arguments:**

| Argument | Type |
|----------|------|
| `input` | `MatchMitreTechniquesInput!` |

### listClasses

Paginated class catalogue with server-aggregated facet counts. Powers the class-picker side-sheet's browse-all path.

**Returns:** `ListClassesResult!`

**Arguments:**

| Argument | Type |
|----------|------|
| `input` | `ListClassesInput!` |

### controlIdsByElements

Find control IDs that have a SUPPORTS relationship to any of the given element IDs

**Returns:** `[ID!]!`

**Arguments:**

| Argument | Type |
|----------|------|
| `elementIds` | `[ID!]!` |

### controlGaps

Analyze control gaps for a model by traversing the MITRE framework chain

**Returns:** `ControlGapsResult!`

**Arguments:**

| Argument | Type |
|----------|------|
| `input` | `ControlGapsInput!` |

### controlCandidatesForType

Find control candidates whose classes support the given element types, with per-class fit details

**Returns:** `[ControlCandidate!]!`

**Arguments:**

| Argument | Type |
|----------|------|
| `elementTypes` | `[ComponentType!]!` |
| `moduleIds` | `[ID!]` |

### getControlsAssignedModels

Batched lookup of the live set of Model IDs that reference each given Control
via SUPPORTS edges. Used by the brownfield push pipeline's shared-ownership
check (CONTROL_LIBRARY.md §6). Per-label indexes on id are required for
production-scale performance (see §9 Platform / database).

Reaches Models via two branches: (1) components/boundaries the Control
supports, and (2) DataFlows the Control supports (reached via FLOWS-attached
components). Empty modelIds is valid — the Control has no SUPPORTS edges yet.

**Returns:** `[ControlAssignedModels!]!`

**Arguments:**

| Argument | Type |
|----------|------|
| `controlIds` | `[ID!]!` |

### getControlInstantiationAttributes

Batched lookup of per-(Control, ControlClass) instantiation attributes
(IS_INSTANCE_OF edge properties) for the given Control IDs. Backs the
control-library pull and the brownfield push Step B refresh.

A Control with no IS_INSTANCE_OF edge returns one row with classId = null
and attributes = null. A Control that is an instance of multiple
ControlClasses returns one row per (controlId, classId) pair.

**Returns:** `[ControlInstantiationAttribute!]!`

**Arguments:**

| Argument | Type |
|----------|------|
| `controlIds` | `[ID!]!` |

### classIdentityEvents

Admin: returns structured class-identity events from the in-memory ring
buffer (max 1000 events, drop-oldest, process-local — pre-restart
events are not persisted). Admin-gated to avoid surfacing per-module
operational state to non-admin authenticated users in multi-tenant
deployments. Filter by `kind` ('rebind' | 'rebind-conflict' |
'collision' | 'orphan' | 'revive'), `moduleName`, and/or `since`
(events at-or-after the timestamp are returned).

**Returns:** `[ClassIdentityEvent!]!`

**Arguments:**

| Argument | Type |
|----------|------|
| `kind` | `String` |
| `moduleName` | `String` |
| `since` | `String` |

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

### createAnalysisIdempotent

Idempotently create or update an Analysis bound to its element and AnalysisClass.
MERGE-by-id throughout — re-runs produce no duplicate IS_INSTANCE_OF edges.
Caller supplies a stable `id`; the schema-level UNIQUE constraint on
Analysis.id backstops the MERGE-non-atomic edge case under concurrent execution.

An Analysis is conceptually an instance of exactly one AnalysisClass — so the
cypher defensively removes any pre-existing IS_INSTANCE_OF edges to other
classes before the MERGE. Calling with a different `analysisClassId` for the
same `id` rebinds (it does not accumulate edges to multiple classes).
ANALYZED_BY bindings to other elements are NOT pruned: an Analysis can
legitimately span multiple elements per the schema's `Analysis.element`
list-cardinality field.

**Returns:** `Analysis`

**Arguments:**

| Argument | Type |
|----------|------|
| `id` | `ID!` |
| `name` | `String!` |
| `description` | `String` |
| `type` | `String` |
| `category` | `String` |
| `elementId` | `ID!` |
| `analysisClassId` | `ID!` |

### setInstantiationAttributes

Set configuration attributes on a component's class instantiation
relationship. Returns a structured result envelope: `success`
is true on the attribute write succeeding; `staleFlippedCount` is the
number of dispositioned exposures on the component whose
`dispositionStale` flipped to true as a result of an attribute value
change. Zero when no value change is detected
(no-op save), or when the component has no dispositioned exposures.

**Returns:** `SetInstantiationAttributesResult!`

**Arguments:**

| Argument | Type |
|----------|------|
| `componentId` | `String!` |
| `classId` | `String!` |
| `attributes` | `JSON!` |

### changeElementBinding

Atomically change the class or representedModel binding of an element.
Enforces class XOR representedModel mutual exclusion. Cleans up
class-derived exposures/countermeasures for any class being disconnected,
preserves user-authored findings (createdBy = USER) unconditionally, and
instantiates derived findings for newly-connected classes via the module
SDK — all in a single executeWrite transaction.

Result envelope carries structured errorCode for failure paths;
targetBinding echoes the binding that landed; deltas summarise the
transaction counts (deleted/instantiated derived; preserved custom).

**Returns:** `ChangeElementBindingResult!`

**Arguments:**

| Argument | Type |
|----------|------|
| `elementId` | `ID!` |
| `target` | `ElementBindingInput!` |

### disposeExposure

Author, modify, or re-affirm the disposition on an Exposure. Stamps
dispositionedBy and dispositionedAt from the authenticated user / current
time. Clears dispositionStale unconditionally — re-affirming a stale
disposition is a successful dispose call with prior kind and (possibly
edited) reason. If a disposition already exists, last-writer-wins.
Mandatory fields: kind, reason (non-empty after trim).

**Returns:** `DispositionMutationResult!`

**Arguments:**

| Argument | Type |
|----------|------|
| `exposureId` | `ID!` |
| `kind` | `DispositionKind!` |
| `reason` | `String!` |

### clearDisposition

Clear the disposition from an Exposure. Nulls all five disposition fields
in a single SET. Idempotent when no disposition exists.

**Returns:** `DispositionMutationResult!`

**Arguments:**

| Argument | Type |
|----------|------|
| `exposureId` | `ID!` |

### disposeCountermeasure

Author, modify, or re-affirm the disposition on a Countermeasure. Validates
kind ∈ {NOT_APPLICABLE, FALSE_POSITIVE, WAIVED} (SUPERSEDED accepted only from
the Supersede orchestrator). Stamps dispositionedBy / dispositionedAt
server-side. Clears dispositionStale unconditionally. Mandatory fields: kind,
reason (non-empty after trim). Returns the shared DispositionMutationResult —
the exposureId field carries the countermeasure id in this path.

**Returns:** `DispositionMutationResult!`

**Arguments:**

| Argument | Type |
|----------|------|
| `countermeasureId` | `ID!` |
| `kind` | `DispositionKind!` |
| `reason` | `String!` |

### clearCountermeasureDisposition

Clear the disposition from a Countermeasure. Idempotent.

**Returns:** `DispositionMutationResult!`

**Arguments:**

| Argument | Type |
|----------|------|
| `countermeasureId` | `ID!` |

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

### reindexClassEmbeddings

Re-embed all class nodes when the embedding model changes

**Returns:** `ReindexResult!`

**Arguments:**

| Argument | Type |
|----------|------|
| `moduleIds` | `[ID!]` |
| `capacity` | `Int` |

### migrateClassId

Admin: align the DB id of a (Module, *Class) pair to a new id.
Mechanically equivalent to an audit-mode rebind — emits the same
rebind event into the in-memory log so the operator-driven action
appears in the same timeline as automatic rebinds.

Recommended direction: pass the module-declared id as `newId` (the
canonical workflow — module source is authoritative for class id).
An operator may align the other way but then must also update the
module source — for source-controlled modules that means a code change;
for DtLgModule-derived classes that means renaming the underlying graph
in the LangGraph runtime.

Cross-module collision check refuses the migration if `newId` is
already owned by a different Module at the same label.

**Returns:** `Boolean!`

**Arguments:**

| Argument | Type |
|----------|------|
| `moduleName` | `String!` |
| `className` | `String!` |
| `classKind` | `String!` |
| `newId` | `ID!` |

### reviveOrphanedClass

Admin: revive an orphaned class — flips HAS_ORPHANED_CLASS edge back to
HAS_CLASS. Idempotent: revive of an already-active class returns true
without an event emission. Edge properties are preserved across the
rename.

**Returns:** `Boolean!`

**Arguments:**

| Argument | Type |
|----------|------|
| `classId` | `ID!` |
| `classKind` | `String!` |

### deleteOrphanedClass

Admin: hard-delete an orphaned class. With cascade=false (default),
refuses if any :IS_INSTANCE_OF edges exist — operator should query
`incomingInstanceCount` first to know the cascade scope. With
cascade=true, DETACH DELETE removes the class AND every incident
instance node (Analyses, Components, etc. depending on classKind) —
irreversible at the data layer.

**Returns:** `Boolean!`

**Arguments:**

| Argument | Type |
|----------|------|
| `classId` | `ID!` |
| `classKind` | `String!` |
| `cascade` | `Boolean!` |

### runIdentityMigration

Admin: re-runs the PR 0 idempotent class-identity cleanup against the
current DB. dryRun=true (default) reports planned changes without
writing. Safe to invoke any time — running twice produces identical
end state.

**Returns:** `IdentityMigrationReport!`

**Arguments:**

| Argument | Type |
|----------|------|
| `dryRun` | `Boolean!` |

### sweepOrphans

Admin: one-time sweep of pre-existing orphan nodes (nodes whose owner was
deleted before the delete path cascaded fully). dryRun=true (default) counts
the orphans per label without writing; dryRun=false deletes them. The
platform sweeps core labels and dispatches an orphan-sweep hook to every
loaded module for its own labels, aggregating the per-label counts.
Idempotent — a second apply is a no-op.

**Returns:** `OrphanSweepReport!`

**Arguments:**

| Argument | Type |
|----------|------|
| `dryRun` | `Boolean!` |

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

