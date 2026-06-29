# Domain Model

## Table of Contents
- [Overview](#overview)
- [Entity Relationship Diagram](#entity-relationship-diagram)
- [Core Interfaces](#core-interfaces)
- [Threat Model Elements](#threat-model-elements)
- [Security Framework Integration](#security-framework-integration)
- [Analysis and Issues](#analysis-and-issues)
- [Type Definitions](#type-definitions)

## Overview

The domain model defines all entities in the Dethernety threat modeling framework. These interfaces define the contract for the TypeScript implementation.

**Source Files:**
- TypeScript: `packages/dt-core/src/interfaces/core-types-interface.ts`

---

## Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Domain Entity Relationships                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                         Organization Layer                      │    │
│  │  ┌────────┐     ┌────────┐     ┌────────┐     ┌────────┐        │    │
│  │  │ Folder │────▶│ Model  │────▶│ Module │────▶│ Class  │        │    │
│  │  └────────┘     └────────┘     └────────┘     └────────┘        │    │
│  │       │              │                             │            │    │
│  │       │              │                             ▼            │    │
│  │       ▼              │                       ┌────────┐         │    │
│  │  ┌────────┐          │                       │Template│         │    │
│  │  │Control │◀─────────┘                       └────────┘         │    │
│  │  └────────┘                                                     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                          │
│                              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                        Threat Model Layer                       │    │
│  │                                                                 │    │
│  │  Model contains:                                                │    │
│  │  ┌───────────────────┐                                          │    │
│  │  │  Default Boundary │ (root security boundary)                 │    │
│  │  └─────────┬─────────┘                                          │    │
│  │            │                                                    │    │
│  │            ▼                                                    │    │
│  │  ┌─────────────────┐ CONDUIT ┌─────────────────┐                │    │
│  │  │   Boundary      │◀───────▶│   Boundary      │ (nested)       │    │
│  │  │ zone/domains/   │ (directed│  zone/domains/  │               │    │
│  │  │ planes          │  edge)   │  planes         │               │    │
│  │  └────────┬────────┘         └─────────────────┘                │    │
│  │           │  (CONDUIT = declared boundary-to-boundary link,     │    │
│  │           │   outbound/inbound from each boundary's view)       │    │
│  │           ▼                                                     │    │
│  │  ┌─────────────────┐                                            │    │
│  │  │   Component     │ (processes, services, databases)           │    │
│  │  └────────┬────────┘                                            │    │
│  │           │                                                     │    │
│  │           ▼                                                     │    │
│  │  ┌─────────────────┐      ┌─────────────────┐                   │    │
│  │  │   DataFlow      │─────▶│   DataItem      │                   │    │
│  │  │ (source→target) │      │ (data class)    │                   │    │
│  │  └─────────────────┘      └─────────────────┘                   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                          │
│                              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                        Security Layer                           │    │
│  │                                                                 │    │
│  │  ┌────────────┐     ┌────────────┐     ┌────────────┐           │    │
│  │  │  Exposure  │────▶│   Issue    │◀────│Countermeas.│           │    │
│  │  └─────┬──────┘     └─────┬──────┘     └─────┬──────┘           │    │
│  │        │                  │                  │                  │    │
│  │        ▼                  │                  ▼                  │    │
│  │  ┌────────────┐           │           ┌────────────┐            │    │
│  │  │ATT&CK Tech │           │           │D3FEND Tech │            │    │
│  │  └────────────┘           │           └────────────┘            │    │
│  │                           ▼                                     │    │
│  │                    ┌────────────┐                               │    │
│  │                    │  Analysis  │ (AI-powered)                  │    │
│  │                    └────────────┘                               │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Core Interfaces

### Base Element

All entities extend the base `Element` interface:

```typescript
interface Element {
  id?: string
  name?: string
  description?: string
}
```

### Organizational Entities

#### Folder

Hierarchical organization for models and controls:

```typescript
interface Folder extends Element {
  id?: string
  name?: string
  description?: string
  parentFolder?: Folder
  childrenFolders?: Folder[]
  models?: Model[]
  controls?: Control[]
}
```

#### Module

Feature module containing classification schemas:

```typescript
interface Module extends Element {
  id: string
  name: string
  description?: string
  componentClasses?: Class[]        // Active component type definitions
  securityBoundaryClasses?: Class[] // Active boundary type definitions
  dataFlowClasses?: Class[]         // Active data flow type definitions
  dataClasses?: Class[]             // Active data classification definitions
  controlClasses?: Class[]          // Active control type definitions
  issueClasses?: Class[]            // Active issue type definitions
  analysisClasses?: Class[]         // Active analysis type definitions
  attributes?: string               // Module configuration (JSON)
  template?: string                 // Default template (JSON)

  // ── Class-identity admin surface ─────────────────────────────────────
  // Populated by DtClassIdentity.getModulesWithIdentity(). Absent on the
  // basic DtModule.getModules() path.
  idRebindPolicy?: string                          // 'audit' | 'strict' | 'silent'
  lastInstallStatus?: string                       // 'authoritative' | 'partial' | 'unavailable' | 'error'
  lastAttemptedInstall?: string                    // ISO timestamp
  lastAuthoritativeInstall?: string                // ISO timestamp of last clean install
  rebindConflicts?: RebindConflictDetail[]         // strict-mode conflicts from last install
  constraintsHealthy?: boolean                     // bootstrap constraint state

  // Classes retired by the module that still have existing instances
  // (HAS_CLASS → HAS_ORPHANED_CLASS at the graph level).
  orphanedComponentClasses?: OrphanedClass[]
  orphanedDataFlowClasses?: OrphanedClass[]
  orphanedSecurityBoundaryClasses?: OrphanedClass[]
  orphanedControlClasses?: OrphanedClass[]
  orphanedDataClasses?: OrphanedClass[]
  orphanedAnalysisClasses?: OrphanedClass[]
  orphanedIssueClasses?: OrphanedClass[]
}
```

> **Breaking change (PR #224)**: `Module.classesWithRebindConflicts: string[]` was renamed to `Module.rebindConflicts: RebindConflictDetail[]`. Clean break — no compatibility shim, since there are no external consumers. Callers must move from the bare class-name array to the structured `RebindConflictDetail` records (which also carry `dbId` and `moduleDeclaredId`).

#### Class-identity types

Supporting types for the class-identity admin surface. Source: [`packages/dt-core/src/interfaces/core-types-interface.ts`](../../../packages/dt-core/src/interfaces/core-types-interface.ts).

```typescript
interface OrphanedClass {
  id: string
  name: string
  orphanedAt?: string              // ISO timestamp of HAS_CLASS → HAS_ORPHANED_CLASS flip
  incomingInstanceCount: number    // count of :IS_INSTANCE_OF edges
  incomingInstancesByType?: TypeCount[]  // per-parent-label breakdown
}

interface RebindConflictDetail {
  className: string                // stable identifier across rebinds
  classKind: string                // 'ComponentClass' | 'AnalysisClass' | ...
  dbId: string                     // current id of the class in the DB
  moduleDeclaredId: string         // id the module declared at last install (from Module.lastInstallClassIds)
}

interface TypeCount {
  type: string                     // parent node label (e.g., 'Analysis', 'Component')
  count: number                    // number of incoming :IS_INSTANCE_OF edges from this label
}

interface IdentityMigrationReport {
  dryRun: boolean
  totalActions: number             // 'planned' if dryRun, 'applied' otherwise
  details: string[]                // per-action log lines
}

interface ClassIdentityEvent {
  kind: string                     // 'rebind' | 'rebind-conflict' | 'collision' | 'orphan' | 'revive'
  timestamp: string
  moduleName?: string              // null for collision events (see firstModuleName/secondModuleName)
  classKind?: string               // pluralized key: 'componentClasses' | ...
  className?: string
  // rebind / rebind-conflict
  oldId?: string
  newId?: string
  moduleDeclaredId?: string
  dbId?: string
  policy?: string                  // 'audit' | 'silent' | 'strict'
  // orphan / revive
  classId?: string
  reason?: string                  // 'absent-from-metadata' | 'legacy-id-superseded'
  // collision
  firstModuleName?: string
  secondModuleName?: string
  collidingId?: string
}
```

#### Class

Entity classification with templates and guides:

```typescript
interface Class extends Element {
  id: string
  name: string
  description?: string
  category?: string
  type?: string
  supportedTypes?: string[]
  supportedCategories?: string[]
  module?: Module
  template?: {
    schema?: object | null        // JSON Schema for attributes
    uischema?: object | null      // UI Schema for form rendering
  } | null
  guide?: object | null           // Usage guidance (parsed from YAML)
}
```

#### Control

Security control that can be associated with model elements:

```typescript
interface Control extends Element {
  id?: string
  name?: string
  description?: string
  folder?: Folder
  controlClasses?: Class[]
}
```

---

## Threat Model Elements

### Model

Top-level container for a threat model:

```typescript
interface Model extends Element {
  id: string
  name?: string
  description?: string
  controls?: Control[]            // Associated security controls
  modules?: Module[]              // Active modules for this model
  folder?: Folder                 // Organization folder
  // Asset-context scope, flat — mirrors the platform Model node.
  // (The grouped local snake_case shape is ModelScopeLocal in manifest.schema.)
  depth?: string                  // ModelingDepth enum value
  modelingIntent?: string         // ModelingIntent enum value
  complianceDrivers?: string[]    // Regulatory/standards obligations in scope
  exclusions?: string[]           // Deliberately out-of-scope areas
  trustAssumptions?: string[]     // What the model treats as trusted
}
```

### ComponentData

System component (process, service, database, external entity):

```typescript
interface ComponentData extends Element {
  id: string
  name: string
  description: string
  type: string                    // PROCESS, EXTERNAL_ENTITY, STORE
  positionX: number               // Canvas X position
  positionY: number               // Canvas Y position
  parentBoundary?: { id: string } // Containing boundary
  controls?: Control[]            // Associated controls
  dataItems?: DataItem[]          // Associated data classifications
  crownJewel?: boolean            // Author-asserted high-value asset marker
}
```

### BoundaryData

Security boundary or trust zone. Carries the optional **zoning** fields (`zone`, `domains`, `planes`) and the boundary-to-boundary **conduit** connections described under [Boundary Zoning](#boundary-zoning) below:

```typescript
interface BoundaryData extends Element {
  id: string
  name: string
  description: string
  positionX?: number              // Canvas X position
  positionY?: number              // Canvas Y position
  dimensionsWidth?: number        // Boundary width
  dimensionsHeight?: number       // Boundary height
  dimensionsMinWidth?: number     // Minimum resize width
  dimensionsMinHeight?: number    // Minimum resize height
  parentBoundary?: { id: string } // Parent boundary (nesting)
  controls?: Control[]
  dataItems?: DataItem[]

  // ── Zoning ──
  zone?: Zone | null              // Trust/exposure gradient; null = inherit/undecided
  domains?: string[]              // Free-text segmentation domains (sanitized, capped)
  planes?: Plane[]                // Operational/privilege role(s) of the boundary

  // Raw directed CONDUIT edge reads (flattened by mapBoundary / updateBoundaryNode):
  outboundConduitsConnection?: { edges: ConduitEdge[] }
  inboundConduitsConnection?: { edges: ConduitEdge[] }
  conduits?: Conduit[]            // Flattened outbound + inbound union, for node.data
}
```

### Boundary Zoning

Zoning attaches declared trust-and-segmentation **intent** to a boundary, plus directed **conduit** relationships between boundaries. These types capture intent only — dt-core persists what the author declared and computes no legality verdict against it.

**Source:** [`packages/dt-core/src/interfaces/core-types-interface.ts`](../../../packages/dt-core/src/interfaces/core-types-interface.ts).

```typescript
// Trust/exposure gradient on a boundary.
type Zone = 'UNTRUSTED' | 'PUBLIC' | 'EXPOSED' | 'INTERNAL' | 'RESTRICTED' | 'VENDOR'

// Operational/privilege role of a boundary.
type Plane = 'WORKLOAD' | 'MANAGEMENT'

// Which side of a directed CONDUIT edge a peer sits on, from this boundary's view.
type ConduitDirection = 'OUTBOUND' | 'INBOUND'
```

A **conduit** is a directed `CONDUIT` edge between two boundaries that declares an intended/allowed connection. The graph stores each conduit once as a directed edge; from a given boundary's perspective the same edge reads as `OUTBOUND` or `INBOUND` depending on which connection it was returned from. `Conduit` is the UI-facing flattened shape (outbound + inbound unioned, each tagged with its `direction`); `ConduitEdge` is the raw per-edge read shape before flattening.

```typescript
// UI-facing flattened conduit.
interface Conduit {
  peerId: string
  peerName?: string               // denormalised for display; source of truth is the peer node
  direction: ConduitDirection
  justification?: string
  controlRefs?: string[]
}

// Raw edge shape from an outbound/inboundConduitsConnection read, before flattening.
interface ConduitEdge {
  properties?: { justification?: string | null; controlRefs?: string[] | null }
  node: { id: string; name?: string }
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `zone` | `Zone \| null` | Trust/exposure gradient. `null` means inherit/undecided — not a distinct level |
| `domains` | `string[]` | Free-text segmentation domains. Trimmed, de-duped case-insensitively, capped per-entry and per-count |
| `planes` | `Plane[]` | Operational role(s). De-duped and emitted in a fixed canonical order so equal sets compare equal |
| `conduits` | `Conduit[]` | Flattened union of the directed `CONDUIT` edges incident to this boundary |

The sanitizers, the conduit flattening (`flattenConduits`), and the baseline-delta write reconcile (`buildConduitOps`) live in [`boundary-zoning-utils.ts`](./DATA_ACCESS_LAYER.md#boundary-zoning-utilities); the boundary write path that persists these fields is [`DtBoundary.updateBoundaryNode`](./GRAPHQL_OPERATIONS.md#dtboundary).

### DataFlowData

Data flow edge between components:

```typescript
interface DataFlowData extends Element {
  id: string
  name: string
  description: string
  source: { id: string }          // Source component/boundary ID
  target: { id: string }          // Target component/boundary ID
  sourceHandle?: string           // Source connection point
  targetHandle?: string           // Target connection point
  controls?: Control[]
  dataItems?: DataItem[]
}
```

### DataItem

Data classification entity:

```typescript
interface DataItem extends Element {
  id: string
  name: string
  description: string
  dataClass?: { id: string, name: string } | null  // Classification class
  elements?: { id: string }[] | null               // Associated elements
  sensitivity?: string                              // SensitivityLevel value; absent ⇒ unclassified
  regulatoryFlags?: string[]                        // Free-text compliance labels (see canonical vocabulary)
}
```

### DirectDescendant

Helper for tracking boundary hierarchy:

```typescript
interface DirectDescendant {
  id: string
  positionX: number
  positionY: number
  parentBoundary?: {
    id: string
    positionX: number
    positionY: number
    parentBoundary?: {
      id: string
      positionX: number
      positionY: number
    }
  }
}
```

---

## Security Framework Integration

### MITRE ATT&CK

#### Tactic

```typescript
interface MitreAttackTactic extends Element {
  id: string
  name?: string
  description?: string
  attack_id: string               // e.g., "TA0001"
  attack_version?: string
  stix_id: string
  stix_spec_version?: string
}
```

#### Technique

```typescript
interface MitreAttackTechnique extends Element {
  id: string
  name: string
  description: string
  attack_id: string               // e.g., "T1059"
  attack_version?: string
  stix_id?: string
  stix_spec_version?: string
  stix_type?: string
  subTechniques?: MitreAttackTechnique[]
  parentTechniques?: MitreAttackTechnique[]
  tactics?: MitreAttackTactic[]
}
```

#### Mitigation

```typescript
interface MitreAttackMitigation {
  id: string
  name: string
  description: string
  attack_id: string               // e.g., "M1026"
  attackTechniqueMitigated?: MitreAttackTechnique[]
  countermeasure?: Countermeasure
}
```

### MITRE D3FEND

#### Tactic

```typescript
interface MitreDefendTactic extends Element {
  id: string
  name?: string
  description?: string
  attack_id: string
  d3fendId: string               // D3FEND identifier
}
```

#### Technique

```typescript
interface MitreDefendTechnique extends Element {
  id: string
  name: string
  description: string
  uri: string                    // D3FEND URI
  d3fendId: string
  subTechniques?: MitreDefendTechnique[]
  parentTechnique?: MitreDefendTechnique
  countermeasures?: Countermeasure[]
}
```

### MITRE Technique Matching

Types for the `matchMitreTechniques` semantic-search surface (consumed by the technique picker via [`DtMitre`](./GRAPHQL_OPERATIONS.md#dtmitre)). The server matches user-typed queries against a MITRE corpus through a five-tier cascade and returns at most one tier per query.

```typescript
type MitreKind = 'ATTACK_TECHNIQUE' | 'DEFEND_TECHNIQUE' | 'ATTACK_MITIGATION'

type MitreMatchType =
  | 'EXACT_ID'            // deterministic tiers
  | 'PREFIX_ID'
  | 'NAME_MATCH'
  | 'DESCRIPTION_MATCH'
  | 'VECTOR_SIMILARITY'   // semantic tier (Memgraph HNSW + embedding model)

type VectorDisabledReason =
  | 'EMBEDDING_DISABLED'  // semantic search turned off on this deployment
  | 'NO_INDEX_MODULE'     // no module provides a vector index
  | 'NO_VECTORS'          // MITRE vectors not yet installed
  | 'MODEL_MISMATCH'      // module ships vectors for a different embedding model

interface TechniqueQueryInput {
  query: string
}

interface MatchMitreTechniquesInput {
  queries: TechniqueQueryInput[]
  kind: MitreKind
  topN?: number           // per-query cap; clamped server-side to [1, 50], default 3
}

interface MitreCandidate {
  mitreId: string         // T1003 / T1003.001 / D3-PMAD / M1041
  name: string
  description?: string | null
  tactic?: string | null  // ATT&CK or D3FEND tactic name (same field, distinct vocabularies)
  kind: MitreKind
  matchType: MitreMatchType
  similarityScore?: number | null  // populated for VECTOR_SIMILARITY; null for deterministic tiers
}

interface TechniqueQueryMatch {
  query: string           // echoes the input query so clients can correlate batched results
  candidates: MitreCandidate[]
}

interface MatchMitreTechniquesResult {
  matches: TechniqueQueryMatch[]   // parallel to the input queries[]
  unmatched: string[]
  vectorAvailable: boolean
  vectorDisabledReason?: VectorDisabledReason | null  // names the reason when vectorAvailable is false
}
```

> **Graceful vector degradation.** When the HNSW index is absent or built against a different embedding model, the server sets `vectorAvailable: false` and a specific `vectorDisabledReason` rather than failing the query. The deterministic tiers (`EXACT_ID` through `DESCRIPTION_MATCH`) still return results; the picker shows a caption explaining that semantic search is unavailable.

### Exposure

Security vulnerability or weakness:

```typescript
interface Exposure extends Element {
  id: string
  name: string
  description?: string
  type?: string
  category?: string
  score?: number                  // Severity score
  attackVector?: string            // CVSS v3.1 attack vector (NETWORK, ADJACENT, LOCAL, PHYSICAL, UNSPECIFIED)
  mitigationSuggestions?: string[]
  detectionMethods?: string[]
  tags?: string[]
  exploitedBy?: MitreAttackTechnique[]  // Linked ATT&CK techniques
  createdBy?: string | null       // Provenance: 'USER' | 'SYSTEM' | null. Server-stamped at CREATE time; sealed against UPDATE-path forgery.
  authoredBy?: string | null      // USER findings: JWT sub claim. SYSTEM findings: optional module-provided attribution string. Same write-once seal as createdBy.

  // Disposition fields — see "Disposition fields" below. All five nullable;
  // null means "no active disposition."
  dispositionKind?: DispositionKind | null
  dispositionReason?: string | null    // Free-text justification; mandatory when dispositionKind is non-null
  dispositionedBy?: string | null      // JWT sub claim of the user who authored the disposition
  dispositionedAt?: string | null      // ISO-8601 timestamp of authoring / re-affirmation
  dispositionStale?: boolean | null    // True when an instantiation attribute changed since the disposition was set
}
```

### Countermeasure

Security control mapped to frameworks:

```typescript
interface Countermeasure extends Element {
  id: string
  name: string
  description: string
  type: string
  category: string
  score: number                   // Effectiveness score
  references: string
  addressedExposures: string[]
  tags: string[]
  mitigations?: MitreAttackMitigation[]
  defendedTechniques?: MitreDefendTechnique[]
  control?: Control
  createdBy?: string | null       // Provenance: 'USER' | 'SYSTEM' | null. Same semantics as Exposure.createdBy.
  authoredBy?: string | null      // Same semantics as Exposure.authoredBy.

  // Disposition fields — same shape and semantics as Exposure (see below).
  dispositionKind?: DispositionKind | null
  dispositionReason?: string | null
  dispositionedBy?: string | null
  dispositionedAt?: string | null
  dispositionStale?: boolean | null
}
```

> **Provenance fields.** `createdBy` and `authoredBy` are populated server-side at CREATE time and are immutable thereafter. They drive the destructive-sweep predicate inside `changeElementBinding` (USER findings are preserved unconditionally; SYSTEM findings are diff-cleaned) and the provenance icon UX in the exposures and countermeasures tables. The full server-side mechanism is in [backend SCHEMA.md — Provenance fields](../backend/LLD/SCHEMA.md#provenance-fields-on-exposure-and-countermeasure).

### Disposition fields

Both `Exposure` and `Countermeasure` carry five nullable disposition fields. A disposition is a structured decision a user records on a SYSTEM-generated finding instead of deleting it — the finding stays in the model but is annotated with the reason it is being treated differently. `null` on all five means "no active disposition."

| Field | Type | Meaning |
|-------|------|---------|
| `dispositionKind` | `DispositionKind \| null` | The structured argument for treating this finding differently |
| `dispositionReason` | `string \| null` | Free-text justification. Mandatory when `dispositionKind` is non-null |
| `dispositionedBy` | `string \| null` | JWT `sub` claim of the user who authored the current disposition |
| `dispositionedAt` | `string \| null` | ISO-8601 string — when the disposition was authored or last re-affirmed |
| `dispositionStale` | `boolean \| null` | `true` when an instantiation attribute changed since the disposition was authored / re-affirmed |

```typescript
type DispositionKind =
  | 'NOT_APPLICABLE'
  | 'FALSE_POSITIVE'
  | 'COMPENSATING_CONTROL'
  | 'RISK_ACCEPTED'
  | 'WAIVED'
  | 'SUPERSEDED'
```

**Staleness.** A disposition records a judgement made against a finding at a point in time. When the model changes underneath it — an instantiation attribute changes — the judgement may no longer hold, so the server flips `dispositionStale: true`. The UI surfaces stale rows distinctly and offers a re-affirm action; re-affirming clears the flag (the wire call is identical to authoring fresh).

**Supersede.** `SUPERSEDED` is not a user-pickable kind. It is set only by the "Fork / Supersede" flow, which clones a SYSTEM finding into an editable USER copy and then disposes the original as `SUPERSEDED` with a reason that names the clone. Deleting the USER copy later flips the original's disposition back to stale (a fire-and-forget companion mutation keyed on the clone name). The orchestration lives in [`packages/dt-core/src/orchestration/`](./GRAPHQL_OPERATIONS.md#supersede-orchestration-helpers); the mutation surface is in [GraphQL Operations — Disposition Operations](./GRAPHQL_OPERATIONS.md#disposition-operations).

The mutations that write these fields return a `DispositionMutationResult` envelope:

```typescript
type DispositionErrorCode = 'VALIDATION_ERROR' | 'EXPOSURE_NOT_FOUND' | 'DATABASE_ERROR'

interface DispositionMutationResult {
  success: boolean
  exposureId: string              // carries the finding id for BOTH Exposure and Countermeasure paths
  dispositionKind: DispositionKind | null
  dispositionReason: string | null
  dispositionedBy: string | null
  dispositionedAt: string | null
  dispositionStale: boolean | null
  errorCode: DispositionErrorCode | null
  errorMessage: string | null
}
```

On a domain error (validation, not-found, database) the server returns `success: false` with `errorCode` set and no graph change; transport errors throw instead. `EXPOSURE_NOT_FOUND` is reused as the not-found code for both finding types.

---

## Analysis and Issues

### Analysis

AI-powered security analysis:

```typescript
interface Analysis extends Element {
  id?: string
  name?: string
  description?: string
  type?: string
  category?: string
  status?: AnalysisStatus
  analysisClass?: AnalysisClass
  model?: Model
  component?: Element
  dataFlow?: Element
  securityBoundary?: Element
  control?: Element
  data?: Element
  element?: Element               // Generic element reference
}
```

### AnalysisClass

Type of analysis available from a module:

```typescript
interface AnalysisClass extends Element {
  id: string
  name?: string
  description?: string
  type?: string
  category?: string
}
```

### AnalysisSession

Active analysis workflow session:

```typescript
interface AnalysisSession {
  sessionId: string
}
```

### AnalysisStatus

Analysis execution state:

```typescript
interface AnalysisStatus {
  createdAt: string
  updatedAt: string
  status: string                  // pending, running, completed, failed
  hasDocument?: boolean           // True once a run completed successfully and a result exists
  interrupts: object              // Pause/resume state
  messages: object[]              // Analysis output messages
  metadata: object                // Additional metadata
}
```

### Issue

Security issue tracking:

```typescript
interface Issue extends Element {
  id: string
  name: string
  description?: string
  type?: string
  category?: string
  attributes?: string             // Custom attributes (JSON)
  lastSyncAt?: string
  createdAt?: string
  updatedAt?: string
  syncedAttributes?: any
  issueStatus?: string            // open, in_progress, resolved, closed
  comments?: string[]
  issueClass?: Class

  // Linked elements
  models?: Element[]
  components?: Element[]
  dataFlows?: Element[]
  securityBoundaries?: Element[]
  controls?: Element[]
  data?: Element[]
  analyses?: Element[]
  exposures?: Element[]
  countermeasures?: Element[]
  elements?: Element[]
  elementsWithExtendedInfo?: IssueElement[]
}
```

### IssueElement

Extended element information for issues:

```typescript
interface IssueElement extends Element {
  id: string
  name?: string
  description?: string
  type?: string
  element_type?: string
  category?: string
  model_id?: string
  model_name?: string
  model_description?: string
  exposed_component_id?: string
  exposed_component_name?: string
  exposed_component_description?: string
}
```

---

## Type Definitions

### Authentication Types

```typescript
interface User {
  id: string
  email: string
  name: string
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

interface UserInfo {
  sub: string
  email: string
  name?: string
  preferred_username?: string
  roles?: string[]
  'urn:zitadel:iam:org:project:roles'?: Record<string, any>
}

interface AuthConfig {
  issuer: string
  clientId: string
  redirectUri: string
  appUrl: string
  nodeEnv: string
}

interface AuthStoreConfig {
  tokenRefreshThreshold?: number
  pkceCodeVerifierLength?: number
  stateLength?: number
  defaultScope?: string
  maxRetryAttempts?: number
  retryDelay?: number
  enableDebugLogging?: boolean
  roleClaimPath?: string
  permissionClaimPath?: string
}
```

### Event Types

```typescript
interface AnalysisEvents {
  analysisResponse: {
    analysisResponse: any
    sessionId: string
  }
  [event: string]: unknown
}
```
