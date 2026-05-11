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
│  │  ┌─────────────────┐      ┌─────────────────┐                   │    │
│  │  │   Boundary      │◀────▶│   Boundary      │ (nested)          │    │
│  │  └────────┬────────┘      └─────────────────┘                   │    │
│  │           │                                                     │    │
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
}
```

### BoundaryData

Security boundary or trust zone:

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
}
```

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
}
```

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
