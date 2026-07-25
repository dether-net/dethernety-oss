# DTModule Interface

## Table of Contents
- [Overview](#overview)
- [DTModule Interface](#dtmodule-interface-1)
- [DTMetadata Interface](#dtmetadata-interface)
- [Class Identity Contract](#class-identity-contract)
- [Class Metadata Interfaces](#class-metadata-interfaces)
- [Exposure and Countermeasure Interfaces](#exposure-and-countermeasure-interfaces)
- [Analysis Interfaces](#analysis-interfaces)
- [Asset-context fields exposed to modules](#asset-context-fields-exposed-to-modules)
- [Method Details](#method-details)
- [Lifecycle Hooks (Optional)](#lifecycle-hooks-optional)

## Overview

The `DTModule` interface is the core contract that all Dethernety modules must implement. It defines the methods for retrieving module metadata, class templates, and security evaluation (exposures/countermeasures).

**Source File:** `packages/dt-module/src/interfaces/module-interface.ts`

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          DTModule Interface                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    Required Methods                             │    │
│  │  • getMetadata(): DTMetadata                                    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    Template Methods (Optional)                  │    │
│  │  • getModuleTemplate(): string                                  │    │
│  │  • getClassTemplate(id, token): string                          │    │
│  │  • getClassGuide(id, token): string                             │    │
│  │  • isContentCallerVariant(): boolean                            │    │
│  │      └ declares template/guide content may vary by caller       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                  Security Evaluation (Optional)                 │    │
│  │  • getExposures(id, classId, token): Exposure[]                 │    │
│  │  • getCountermeasures(id, classId, token): Countermeasure[]     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                   Analysis Methods (Optional)                   │    │
│  │  • runAnalysis(id, classId, scope, pubSub, params)              │    │
│  │  • startChat(id, classId, scope, question, pubSub, params)      │    │
│  │  • resumeAnalysis(id, classId, input, pubSub)                   │    │
│  │  • getAnalysisStatus(id): AnalysisStatus                        │    │
│  │  • getAnalysisValueKeys(id): string[]                           │    │
│  │  • getAnalysisValues(id, valueKey): object                      │    │
│  │  • getDocument(id, classId, scope, filter): object              │    │
│  │  • deleteAnalysis(id): boolean                                  │    │
│  │  • stopAnalysis(id): boolean                                    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                   Issue Sync Methods (Optional)                 │    │
│  │  • getSyncedIssueAttributes(issueId, attributes, lastSyncAt)    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                 Schema Extension (Optional)                     │    │
│  │  • getSchemaExtension(): string                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │              Custom Resolvers (Optional)                        │    │
│  │  • getResolvers(context): ResolverMap                           │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │              Lifecycle Hooks (Optional)                         │    │
│  │  • onModelDeleted(tx, modelId, analysisIds)                     │    │
│  │  • onOrphanSweep(tx, { apply })                                 │    │
│  │  • afterInstall(ctx)                                            │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## DTModule Interface

```typescript
// packages/dt-module/src/interfaces/module-interface.ts

export interface ExtendedPubSubEngine extends PubSubEngine {
  asyncIterator<T>(triggers: string | string[]): AsyncIterator<T>;
}

// Context handed to the post-commit afterInstall hook. Unlike the in-transaction
// hooks, this carries the raw driver — the hook opens its own session.
export interface ModuleInstallContext {
  driver: any;          // Raw neo4j-driver Driver (typed `any` to keep neo4j out of the base lib)
  moduleName: string;   // This module's name — equals its `:Module {name}` in the graph
  databaseName: string; // The database installed into — for `driver.session({ database })`
}

export interface DTModule {
  // Required - Module metadata
  getMetadata(): DTMetadata | Promise<DTMetadata>;

  // Optional - Lifecycle. Called by the platform before an instance is discarded
  // (reload, replacement, failed load). Must be idempotent and never throw in
  // normal operation. DtFileOpaModule uses it to free its in-process Rego engines:
  // the WASM heap is not reclaimed by garbage collection, so a discarded instance
  // that is not disposed permanently strands its policy set.
  dispose?(): void;

  // Optional - Configuration templates
  getModuleTemplate?(): Promise<string>;
  getClassTemplate?(id: string, token?: string): Promise<string>;
  getClassGuide?(id: string, token?: string): Promise<string>;

  // Optional - Declares whether template/guide content varies by caller (default false)
  isContentCallerVariant?(): boolean;

  // Optional - Security evaluation
  getExposures?(id: string, classId: string, token?: string): Promise<Exposure[]>;
  getCountermeasures?(id: string, classId: string, token?: string): Promise<Countermeasure[]>;

  // Optional - Analysis methods (for modules providing analysis capabilities)
  runAnalysis?(
    id: string,
    analysisClassId: string,
    scope: string,
    pubSub: ExtendedPubSubEngine,
    additionalParams?: object
  ): Promise<AnalysisSession>;

  startChat?(
    id: string,
    analysisClassId: string,
    scope: string,
    userQuestion: string,
    pubSub: ExtendedPubSubEngine,
    additionalParams?: object
  ): Promise<AnalysisSession>;

  resumeAnalysis?(
    id: string,
    analysisClassId: string,
    input: any,
    pubSub: ExtendedPubSubEngine
  ): Promise<AnalysisSession>;

  getAnalysisStatus?(id: string): Promise<AnalysisStatus>;
  getAnalysisValueKeys?(id: string): Promise<string[]>;
  getAnalysisValues?(id: string, valueKey: string): Promise<object>;
  getDocument?(
    id: string,
    analysisClassId: string,
    scope: string,
    filter: object
  ): Promise<object>;
  deleteAnalysis?(id: string): Promise<boolean>;
  stopAnalysis?(id: string): Promise<boolean>;

  // Optional - Issue synchronization
  getSyncedIssueAttributes?(
    issueId: string,
    attributes: string,
    lastSyncAt: string
  ): Promise<string>;

  // Optional - GraphQL schema extension
  getSchemaExtension?(): string | Promise<string | undefined> | undefined;

  // Optional - Custom GraphQL resolvers for fields declared in getSchemaExtension()
  getResolvers?(context: ModuleResolverContext): ResolverMap | Promise<ResolverMap>;

  // Optional - Pre-computed class embeddings (offline-install support)
  getEmbedding?(className: string, embeddingModel: string): number[] | null;

  // Optional - Lifecycle hooks (see Lifecycle Hooks section below)
  onModelDeleted?(
    tx: any,
    modelId: string,
    analysisIds: string[],
  ): Promise<{ nodesDeleted: number; relationshipsDeleted: number } | void>;
  onOrphanSweep?(
    tx: any,
    opts: { apply: boolean },
  ): Promise<{
    byLabel: Record<string, number>;
    nodesDeleted: number;
    relationshipsDeleted: number;
  } | void>;
  afterInstall?(ctx: ModuleInstallContext): Promise<void>;
}
```

### `getEmbedding?(className, embeddingModel)`

Returns a pre-computed embedding vector for `className` under the slugified
`embeddingModel`, or `null` if no vector is available. When present, the
platform uses it instead of calling the embedding endpoint — enabling
offline install.

- `embeddingModel` is the **slugified** model identifier (produced by
  `slugifyModelName()` in `@dethernety/dt-module/embedding`), so it is
  always safe to use as a filename segment. A model like
  `sentence-transformers/all-MiniLM-L6-v2` is slugified to
  `sentence-transformers-all-MiniLM-L6-v2`.
- The base class `DtFileOpaModule` implements this by reading
  `{classDir}/embeddings/{slug}.json`. See
  [Pre-Computed Embeddings Spec](./PRE_COMPUTED_EMBEDDINGS_SPEC.md).
- Generate vectors with the `module-manager embed` CLI; see
  [Development Guide → Pre-computed Embeddings](./DEVELOPMENT_GUIDE.md#pre-computed-embeddings-optional).

---

## DTMetadata Interface

The `DTMetadata` interface defines the structure returned by `getMetadata()`. It contains the module identity and all class definitions.

**Source File:** `packages/dt-module/src/interfaces/module-metadata-interface.ts`

```typescript
export interface DTMetadata {
  name: string;                                    // Module identifier
  description?: string;                            // Human-readable description
  icon?: string;                                   // Icon identifier for UI
  version?: string;                                // Semantic version
  author?: string;                                 // Module author

  // Class definitions
  componentClasses?: ComponentClassMetadata[];     // System components
  dataFlowClasses?: DataFlowClassMetadata[];       // Data flow types
  securityBoundaryClasses?: SecurityBoundaryClassMetadata[];  // Trust zones
  dataClasses?: DataClassMetadata[];               // Data classifications
  controlClasses?: ControlClassMetadata[];         // Security controls
  analysisClasses?: AnalysisClassMetadata[];       // AI analysis types
  issueClasses?: IssueClassMetadata[];             // Issue tracking types
}
```

### Metadata Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Metadata Registration Flow                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Module Registry Service                                                │
│       │                                                                 │
│       │  1. Loads module                                                │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────┐                                                    │
│  │ module.getMetadata()                                                 │
│  └────────┬────────┘                                                    │
│           │                                                             │
│           │  2. Returns DTMetadata                                      │
│           ▼                                                             │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  DTMetadata                                                     │    │
│  │  {                                                              │    │
│  │    name: "dethernety-general",                                  │    │
│  │    version: "1.0.0",                                            │    │
│  │    componentClasses: [...],                                     │    │
│  │    dataFlowClasses: [...],                                      │    │
│  │    securityBoundaryClasses: [...],                              │    │
│  │    ...                                                          │    │
│  │  }                                                              │    │
│  └────────┬────────────────────────────────────────────────────────┘    │
│           │                                                             │
│           │  3. Store in graph database                                 │
│           ▼                                                             │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Graph Database                                                 │    │
│  │                                                                 │    │
│  │  (DTModule {name: "dethernety-general"})                        │    │
│  │       │                                                         │    │
│  │       ├──[:MODULE_PROVIDES_CLASS]──>(DTComponentClass)          │    │
│  │       ├──[:MODULE_PROVIDES_CLASS]──>(DTDataFlowClass)           │    │
│  │       ├──[:MODULE_PROVIDES_CLASS]──>(DTSecurityBoundaryClass)   │    │
│  │       └──[:MODULE_PROVIDES_CLASS]──>(DTControlClass)            │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Class Identity Contract

Every class metadata entry (`ComponentClassMetadata`, `AnalysisClassMetadata`, …) carries an optional `id`. That id is the **stable, operational identity** of the class within the deployment — it survives renames, is referenced by exported models, and is what `:IS_INSTANCE_OF` edges in the graph store.

### Stable ids

Module authors should set `id` to a deployment-stable value (UUID or any opaque string) and **not change it across versions**. The `name` is the human-readable identifier and is allowed to drift; the id is what the platform uses for instance edges, control library entries, and export references.

If the module omits `id`, the platform mints one at install time. That auto-minted id is then re-used on subsequent installs as long as the same `(module, className)` pair is present — the install flow uses `name` as the match key when reconciling existing classes.

### Rebind behaviour

When a module's declared id for a class diverges from the DB-resident id (typical cause: an author changed the source `id` after the first install), the install flow follows the module's `idRebindPolicy`:

| Policy | Behaviour |
|--------|-----------|
| `audit` (default) | Rebind the DB id to the module-declared id; emit a `rebind` event into the class-identity log |
| `silent` | Same as `audit` but suppresses the event emission |
| `strict` | Refuse to rebind; mark the install as `unavailable` (or `partial` if only some classes conflict) and surface the conflict via `Module.rebindConflicts` for operator resolution |

Set the policy in your module's `DTMetadata` if your module is source-controlled and you'd rather catch unintended id changes than have them silently applied. Most first-party modules use the default (`audit`).

### Orphaned classes

A class that exists in the DB but is no longer declared by the module's metadata is **orphaned**, not deleted. At the graph level this is the rename `HAS_CLASS` → `HAS_ORPHANED_CLASS` on the `(Module)→(Class)` edge — instance edges (`:IS_INSTANCE_OF`) are preserved, so existing analyses, components, etc. that reference the class continue to work.

Operators can revive (un-orphan) or hard-delete orphaned classes through the admin Operations tab in the modules page. Module authors should not delete a class outright from metadata without first confirming there are no live instances — the platform's safe default is to orphan rather than break references.

### Cross-references

- Backend admin surface: [`ClassIdentityResolverService`](../backend/LLD/CUSTOM_RESOLVER_SERVICES_DOCUMENTATION.md#6-classidentityresolverservice)
- Frontend Operations tab: [Frontend Architecture → Modules Page](../frontend/FRONTEND_ARCHITECTURE.md#6-modules-page)
- Conflict resolution helper API: [`DtClassIdentity`](../dt-core/GRAPHQL_OPERATIONS.md#dtclassidentity)
- Graph schema: [Module + class types](../backend/LLD/SCHEMA.md#module-system)

---

## Class Metadata Interfaces

All class metadata interfaces share a common structure with slight variations for specific class types.

### ComponentClassMetadata

**Source File:** `packages/dt-module/src/interfaces/component-class-metadata-interface.ts`

```typescript
export interface ComponentClassMetadata {
  id?: string;              // Unique identifier (auto-generated if not provided)
  name: string;             // Display name
  description?: string;     // Description for tooltips/documentation
  type: string;             // Component type: PROCESS, EXTERNAL_ENTITY, STORE
  category: string;         // Grouping category (e.g., "Web", "Database", "API")
  icon?: string;            // Icon identifier
  properties?: object;      // Additional metadata
}
```

**Component Types:**
- `PROCESS` - Internal system processes
- `EXTERNAL_ENTITY` - External actors or systems
- `STORE` - Data stores (databases, file systems)

### DataFlowClassMetadata

**Source File:** `packages/dt-module/src/interfaces/dataflow-class-metadata-interface.ts`

```typescript
export interface DataFlowClassMetadata {
  id?: string;
  name: string;
  description?: string;
  type: string;                    // Flow type (e.g., "HTTP", "gRPC", "TCP")
  category: string;                // Grouping category
  compatibleTypes?: string[];      // Component types this can connect
  compatibleCategories?: string[]; // Component categories this can connect
  icon?: string;
  properties?: object;
}
```

### SecurityBoundaryClassMetadata

**Source File:** `packages/dt-module/src/interfaces/securityboundary-class-metadata-interface.ts`

```typescript
export interface SecurityBoundaryClassMetadata {
  id?: string;
  name: string;
  description?: string;
  type: string;             // Boundary type: BOUNDARY, SECURITY_BOUNDARY
  category: string;         // Trust level (e.g., "Internal", "DMZ", "External")
  icon?: string;
  properties?: object;
}
```

### DataClassMetadata

**Source File:** `packages/dt-module/src/interfaces/data-class-metadata-interface.ts`

```typescript
export interface DataClassMetadata {
  id?: string;
  name: string;
  description?: string;
  type: string;             // Data type classification
  category: string;         // Sensitivity category (e.g., "PII", "Credentials")
  icon?: string;
  properties?: object;
}
```

### ControlClassMetadata

**Source File:** `packages/dt-module/src/interfaces/control-class-metadata-interface.ts`

```typescript
export interface ControlClassMetadata {
  id?: string;
  name: string;
  description?: string;
  type: string;                    // Control type (e.g., "Authentication", "Encryption")
  category: string;                // Control framework category
  compatibleTypes?: string[];      // Element types this control applies to
  compatibleCategories?: string[]; // Element categories this control applies to
  icon?: string;
  properties?: object;
}
```

### AnalysisClassMetadata

**Source File:** `packages/dt-module/src/interfaces/analysis-class-metadata-interface.ts`

```typescript
export interface AnalysisClassMetadata {
  id?: string;              // Identifies the analysis workflow (e.g., LangGraph assistant_id when using DtLgModule)
  name: string;             // Analysis name
  description?: string;     // Analysis description
  type: string;             // Analysis type (e.g., "model_analysis")
  category: string;         // Category (e.g., "attack_scenario", "threat")
  icon?: string;
  properties?: object;
}
```

### IssueClassMetadata

**Source File:** `packages/dt-module/src/interfaces/issue-class-metadata-interface.ts`

```typescript
export interface IssueClassMetadata {
  id?: string;
  name: string;
  description?: string;
  type: string;             // Issue type (e.g., "vulnerability", "finding")
  category: string;         // Issue category
  icon?: string;
  properties?: object;
}
```

---

## Exposure and Countermeasure Interfaces

### MitreRef

A reference from a finding (`Exposure` / `Countermeasure`) to a MITRE node. `label` + `property` + `value` self-describe the target node and its key (e.g. `MitreAttackTechnique` / `attack_id` / `T1078`). The relationship type (edge name) is decided by the field the ref sits under, not by the ref itself. `attributes` is free-form provenance (e.g. `justification`) copied onto the graph edge — values must be primitives.

**Source File:** `packages/dt-module/src/interfaces/mitre-ref-interface.ts`

```typescript
export interface MitreRef {
  label: string;
  property: string;
  value: string;
  attributes?: Record<string, string | number | boolean>;
}
```

### Exposure

Represents a security vulnerability or weakness detected for a model element.

**Source File:** `packages/dt-module/src/interfaces/exposure-interface.ts`

```typescript
import { MitreRef } from './mitre-ref-interface';

export interface Exposure {
  id?: string;
  name: string;                  // Exposure name
  description?: string;          // Detailed description
  type: string;                  // Exposure type
  category: string;              // Exposure category
  score?: number;                // Severity score (0-10)
  reference?: string;            // External reference (e.g., CVE, CWE)
  attackVector?: string;         // CVSS v3.1 attack vector (NETWORK, ADJACENT, LOCAL, PHYSICAL, UNSPECIFIED)
  mitigationTechniques?: string[]; // Recommended mitigations
  detectionTechniques?: string[];  // Detection methods
  tags?: string[];               // Classification tags

  // → EXPLOITED_BY edges to the MITRE node(s) that exploit this exposure.
  // MitreRef form may carry edge `attributes`; the bare-string fallback is preserved.
  exploitedBy?: MitreRef[] | string[];
}
```

### Countermeasure

Represents a security control that addresses exposures.

**Source File:** `packages/dt-module/src/interfaces/countermeasure-interface.ts`

```typescript
import { MitreRef } from './mitre-ref-interface';

export interface Countermeasure {
  id?: string;
  name: string;                   // Countermeasure name
  description?: string;           // Detailed description
  type: string;                   // Countermeasure type
  category: string;               // Countermeasure category
  score?: number;                 // Effectiveness score (0-10)
  reference?: string;             // External reference
  addressedExposures?: string[];  // Exposures this countermeasure addresses
  tags?: string[];                // Classification tags

  // Identity block → RESPONDS_WITH edges (the ATT&CK Mitigation + D3FEND technique
  // this control implements). MitreRef form may carry edge `attributes`; bare-string preserved.
  respondsWith?: MitreRef[] | string[];

  // Verb blocks → COUNTERMEASURE_<VERB> edges to MitreAttackTechnique (how this control
  // counters each technique). Each countermeasure populates only the verbs its policy emits.
  // The first four are surfaced as GraphQL fields; the last four are written ahead but not yet queryable.
  mitigates?: MitreRef[];
  protectsAgainst?: MitreRef[];
  detects?: MitreRef[];
  isolates?: MitreRef[];
  deceives?: MitreRef[];
  evicts?: MitreRef[];
  restores?: MitreRef[];
  respondsTo?: MitreRef[];
}
```

### Exposure/Countermeasure Evaluation Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Exposure Evaluation Flow                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  User configures component attributes in UI                             │
│       │                                                                 │
│       │  1. Attributes saved to graph database                          │
│       ▼                                                                 │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │  Component Instance                                       │          │
│  │  {                                                        │          │
│  │    id: "comp-123",                                        │          │
│  │    classId: "class-456",                                  │          │
│  │    attributes: {                                          │          │
│  │      "authentication_enabled": false,                     │          │
│  │      "encryption_at_rest": false                          │          │
│  │    }                                                      │          │
│  │  }                                                        │          │
│  └─────────────────────────┬─────────────────────────────────┘          │
│                            │                                            │
│                            │  2. module.getExposures(id, classId)       │
│                            ▼                                            │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │  In-Process Rego Policy Evaluation                        │          │
│  │                                                           │          │
│  │  package dethernety.webserver                             │          │
│  │                                                           │          │
│  │  exposures[exp] {                                         │          │
│  │    not input.authentication_enabled                       │          │
│  │    exp := {                                               │          │
│  │      "name": "Missing Authentication",                    │          │
│  │      "type": "vulnerability",                             │          │
│  │      "score": 8                                           │          │
│  │    }                                                      │          │
│  │  }                                                        │          │
│  └─────────────────────────┬─────────────────────────────────┘          │
│                            │                                            │
│                            │  3. Return exposures                       │
│                            ▼                                            │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │  Exposure[]                                               │          │
│  │  [                                                        │          │
│  │    {                                                      │          │
│  │      name: "Missing Authentication",                      │          │
│  │      type: "vulnerability",                               │          │
│  │      category: "access_control",                          │          │
│  │      score: 8,                                            │          │
│  │      exploitedBy: ["T1078"]                               │          │
│  │    }                                                      │          │
│  │  ]                                                        │          │
│  └───────────────────────────────────────────────────────────┘          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Analysis Interfaces

### LgGraphConfig

Configuration for a single LangGraph analysis graph.

**Source File:** `packages/dt-module/src/interfaces/lg-analysis-config-interface.ts`

```typescript
export interface LgGraphConfig {
  description?: string;        // Human-readable description
  type?: string;               // Analysis type classification
  category?: string;           // Category for grouping

  // Document storage location
  index_document?: (
    scope: string,
    analysisId?: string
  ) => Promise<{ namespace: string[]; key: string }>;

  // Input payload builder (required)
  input: (
    scope: string,
    analysisId?: string,
    driver?: any,
    additionalParams?: any
  ) => Promise<any>;

  // Optional post-processing
  post_process?: (result: any) => Promise<any>;
}
```

### LgAnalysisConfig

Maps graph names to their configurations.

```typescript
export interface LgAnalysisConfig {
  graphs: {
    [graphName: string]: LgGraphConfig;
  };
}
```

### LgModuleMetadata

Static metadata for LangGraph modules.

```typescript
export interface LgModuleMetadata {
  description: string;
  version: string;
  author: string;
  icon?: string;
}
```

### LgModuleOptions

Constructor options for `DtLgModule`.

```typescript
export interface LgModuleOptions {
  langgraphApiUrl?: string;         // LangGraph API URL
  langgraphTimeoutMs?: number;      // Control-plane request timeout (default 30000; the run stream is exempt)
  analysisConfig: LgAnalysisConfig; // Graph configurations
  metadata: LgModuleMetadata;       // Module metadata
}
```

---

## Asset-context fields exposed to modules

Analysis modules read the model graph through the per-request `GraphQLContext` (the `driver` + `sessionConfig` available in `getResolvers`/analysis). Alongside structure, classes, controls, and exposures, the graph carries **author-asserted asset context** — what the modeller declared about scope, value, and data sensitivity. These are *inputs* to analysis, not computed verdicts: treat the model-level fields as **seeds for the analysis-phase scope, not direct risk-math inputs**, and the per-element fields as evidence to weigh.

No module-API change is required — these are ordinary node properties on `Model`, `Component`, and `Data`, selectable in any module query.

### Model scope (five flat fields on `Model`)

| Field | Type | Meaning |
|-------|------|---------|
| `depth` | `ModelingDepth` — `ARCHITECTURE` \| `DESIGN` \| `IMPLEMENTATION` | How deep the model reasons (architecture, design, or implementation fidelity). |
| `modelingIntent` | `ModelingIntent` — `INITIAL` \| `SECURITY_REVIEW` \| `COMPLIANCE` \| `INCIDENT_RESPONSE` | Why the model exists; frames which findings matter. |
| `complianceDrivers` | `[String!]` | Regulatory/standards obligations in scope (e.g. `PCI-DSS`, `HIPAA`). Free-text. |
| `exclusions` | `[String!]` | What the modeller deliberately put out of scope; analysis should not fault their absence. |
| `trustAssumptions` | `[String!]` | What the model treats as trusted (e.g. "cloud control plane"); analysis may surface these as assumptions to test. |

### Per-element fields

- **`Component.crownJewel: Boolean`** — the modeller marked this component a high-value asset. Crown-jewel marks exist on **components only**.
- **`Data.sensitivity: SensitivityLevel`** (`PUBLIC` < `INTERNAL` < `CONFIDENTIAL` < `RESTRICTED`) — author-asserted classification. Rank an element by the **maximum sensitivity of the data it handles** (but see the coalescing contract below: `null`-sensitivity data is excluded from that max and surfaced separately, never treated as `PUBLIC`).
- **`Data.regulatoryFlags: [String!]`** — free-text compliance labels; see the [canonical vocabulary](../dethereal/THREAT_MODELING_WORKFLOW.md#canonical-sensitivity-and-regulatory-flag-vocabulary) for the recommended set and casing.

### Coalescing contract (legacy + un-set nodes)

All asset-context fields are **nullable** — legacy nodes and un-classified elements read `null`. Coalesce consistently:

| Field | `null` means |
|-------|--------------|
| `crownJewel` | not a crown jewel (treat as `false`) |
| `regulatoryFlags` | none declared (treat as `[]`) |
| `sensitivity` | **unclassified — not `public`** |

Treat `sensitivity: null` as **unknown, surfaced separately** — never as a `public` floor. An element handling only `null`-sensitivity data is *unrated*, not *low-risk*; folding it into a max-sensitivity aggregation as `public` would silently under-rate genuinely-sensitive-but-unclassified data. Report the unclassified gap rather than scoring through it.

### `dataInRegulatoryScope(flag: String!): [Data!]!`

Returns every `Data` node whose `regulatoryFlags` contains `flag`. For module authors:

- **Exact, case-sensitive match** — a producer typo (`"phi"` vs `"PHI"`) returns `[]` silently, not an error. Query with the [canonical casing](../dethereal/THREAT_MODELING_WORKFLOW.md#canonical-sensitivity-and-regulatory-flag-vocabulary).
- **O(|Data|) full scan** — `regulatoryFlags` is a list and is not indexable on Memgraph, so cost is linear in the number of `Data` nodes. Fine for analysis-phase use; don't call it in a tight loop.
- **Direct handlers only** — it finds the data items *carrying* the flag, not the components/flows adjacent to them. Cardholder-data-environment (CDE) adjacency — which components touch regulated data — is an analysis-phase traversal you compose on top, not something this query does.

### Not available (deliberately, in this version)

- No `crownJewel` on `Data`, `SecurityBoundary`, or `DataFlow` — crown-jewel marks on those live only in local plugin files and are not synced to the platform.
- No persisted **adversary classes** / threat-actor model on the graph.
- **Monitoring-coverage** and **credential-handling** asset context are not yet first-class graph fields — they remain local enrichment pending separate node authoring.

---

## Method Details

### getMetadata()

**Required.** Returns the module's metadata including all class definitions.

```typescript
async getMetadata(): Promise<DTMetadata>
```

**Called by:** Module Registry Service at startup

**Returns:** `DTMetadata` containing module identity and all class arrays

---

### getModuleTemplate()

**Optional.** Returns a JSON string containing the JSON Schema and UI Schema for module-wide configuration. A module implements it only if it has genuine module-wide settings to expose; when a module does not define it, the platform's template resolver returns its documented fallback.

`DtFileOpaModule` does **not** implement `getModuleTemplate()`: Rego policies evaluate in-process and need no configuration, so there is no module-wide setting to surface. `DtLgModule` likewise does not: its only conceivable module-wide setting (the LangGraph API URL) is resolved from constructor options/environment, not from a template.

```typescript
getModuleTemplate?(): Promise<string>
```

**Returns:** JSON string with `schema` and `uischema` properties

**Example Response:**
```json
{
  "schema": {
    "type": "object",
    "properties": {
      "report_verbosity": {
        "type": "string",
        "enum": ["summary", "detailed"]
      }
    }
  },
  "uischema": {
    "type": "VerticalLayout",
    "elements": [
      { "type": "Control", "scope": "#/properties/report_verbosity" }
    ]
  }
}
```

---

### getClassTemplate(id, token?)

Returns the JSON Schema template for a specific class's attributes.

```typescript
async getClassTemplate(id: string, token?: string): Promise<string>
```

**Parameters:**
- `id` - The class instance ID (component, dataflow, boundary, etc.)
- `token?` - The **raw bearer token** of the calling request: an opaque credential to forward to an upstream service on the caller's behalf. **Never decode it for identity, and never log it.** Absent (`undefined`) in dev/NOAUTH or when the request carries no bearer — the implementation must tolerate absence.

**Returns:** JSON string with `schema` and `uischema` for class configuration

---

### getClassGuide(id, token?)

Returns usage guidance for configuring a specific class.

```typescript
async getClassGuide(id: string, token?: string): Promise<string>
```

**Parameters:**
- `id` - The class instance ID
- `token?` - Same as `getClassTemplate` — the raw bearer token to forward upstream; opaque, never decoded for identity, never logged; `undefined` when absent.

**Returns:** YAML or JSON string with configuration guidance

---

### getExposures(id, classId, token?)

Evaluates and returns exposures for a model element based on its attributes.

```typescript
async getExposures(id: string, classId: string, token?: string): Promise<Exposure[]>
```

**Parameters:**
- `id` - The element instance ID
- `classId` - The class ID assigned to the element
- `token?` - The raw bearer token to forward upstream; opaque, never decoded for identity, never logged; `undefined` when absent. Unlike the template/guide methods, results here are persisted to the **shared** model graph, so they must **not** vary by caller (see `isContentCallerVariant`).

**Returns:** Array of `Exposure` objects

---

### getCountermeasures(id, classId, token?)

Evaluates and returns countermeasures for a model element.

```typescript
async getCountermeasures(id: string, classId: string, token?: string): Promise<Countermeasure[]>
```

**Parameters:**
- `id` - The element instance ID
- `classId` - The class ID assigned to the element
- `token?` - The raw bearer token to forward upstream; opaque, never decoded for identity, never logged; `undefined` when absent. As with `getExposures`, results persist to the shared graph and must **not** vary by caller.

**Returns:** Array of `Countermeasure` objects

---

### isContentCallerVariant()

Declares whether this module's **template/guide** output may depend on the calling
user (the `token` passed to `getClassTemplate`/`getClassGuide`).

```typescript
isContentCallerVariant?(): boolean
```

**Returns:** `true` if template/guide content is caller-dependent; **absent or `false`
(the default)** means caller-independent and freely cacheable — the case for every
module that answers from static, on-disk content.

**When to return `true`.** Only when `getClassTemplate`/`getClassGuide` genuinely
produce different content for different callers. The platform then **bypasses its
template cache** for this module, so no caller ever receives content generated for
another.

**Invariant — template/guide only.** `getExposures`/`getCountermeasures` must **never**
vary by caller regardless of this predicate: their results are persisted to the shared
model graph and read back by every caller of that element, so a per-caller value would
leak across callers (a durable leak the cache bypass cannot prevent). Returning `true`
licenses per-caller *template/guide* content and nothing else.

---

### runAnalysis(...)

Starts an analysis workflow. `DtLgModule` delegates this to a LangGraph server; direct implementations handle execution themselves.

```typescript
async runAnalysis(
  id: string,
  analysisClassId: string,
  scope: string,
  pubSub: ExtendedPubSubEngine,
  additionalParams?: object
): Promise<AnalysisSession>
```

**Parameters:**
- `id` - Analysis session ID
- `analysisClassId` - The analysis class ID
- `scope` - Analysis scope (usually model ID)
- `pubSub` - GraphQL subscription engine for streaming results
- `additionalParams` - Optional parameters to pass to the graph

**Returns:** `AnalysisSession` with `sessionId`

---

### startChat(...)

Starts an interactive chat session with an analysis module.

```typescript
async startChat(
  id: string,
  analysisClassId: string,
  scope: string,
  userQuestion: string,
  pubSub: ExtendedPubSubEngine,
  additionalParams?: object
): Promise<AnalysisSession>
```

**Parameters:**
- `id` - Chat session ID
- `analysisClassId` - The analysis class ID
- `scope` - Analysis scope
- `userQuestion` - User's question
- `pubSub` - Subscription engine
- `additionalParams` - Optional parameters

**Returns:** `AnalysisSession` with `sessionId`

---

### resumeAnalysis(...)

Resumes a paused or interrupted analysis.

```typescript
async resumeAnalysis(
  id: string,
  analysisClassId: string,
  input: any,
  pubSub: ExtendedPubSubEngine
): Promise<AnalysisSession>
```

**Parameters:**
- `id` - Analysis session ID
- `analysisClassId` - The analysis class ID
- `input` - Input to provide for resumption (e.g., human feedback)
- `pubSub` - Subscription engine

**Returns:** `AnalysisSession`

---

### getAnalysisStatus(id)

Gets the current status of an analysis session.

```typescript
async getAnalysisStatus(id: string): Promise<AnalysisStatus>
```

**Returns:** `AnalysisStatus` with `status`, `hasDocument`, `messages`, `interrupts`, `metadata`

`hasDocument` (optional on the interface, defaulted to `false` at the GraphQL resolver) should be `true` once a run has completed successfully and a viewable result exists, so the UI can tell a never-run analysis from a completed one (both report `status: idle`).

---

### deleteAnalysis(id) / stopAnalysis(id)

Deletes or stops an analysis session.

```typescript
async deleteAnalysis(id: string): Promise<boolean>
async stopAnalysis(id: string): Promise<boolean>
```

**Returns:** `true` if successful

---

### getSchemaExtension()

Returns a GraphQL SDL string that extends the platform's base schema. The `ModuleRegistryService` calls this on each loaded module at startup and stores the result in `ModuleEntry.schemaFragment`. The `SchemaService` merges all valid fragments into the base schema before constructing the `Neo4jGraphQL` instance.

```typescript
getSchemaExtension?(): string | Promise<string | undefined> | undefined
```

**Called by:** Module Registry Service at startup

**Returns:** GraphQL SDL string, or `undefined` if the module does not extend the schema

**Rules:**
- Define new types only. Do not redefine existing platform types.
- Invalid fragments (those that fail `graphql.parse()`) are skipped at startup with a warning.

**Example Return Value:**
```graphql
type ThreatIntel {
  id: ID!
  name: String!
  severity: String
  source: String
}
```

`DtLgModule` provides a default implementation that reads `schema.graphql` from the compiled module directory using the `readSchemaExtension()` utility. See [BASE_CLASSES.md](./BASE_CLASSES.md) for details.

---

### getResolvers(context)

Returns custom GraphQL resolver functions for fields declared in this module's schema extension. This allows modules to back their SDL types with non-Cypher logic (external API calls, procedural operations, policy evaluation) without hardcoding resolver services in the platform.

**Source File:** `packages/dt-module/src/interfaces/module-interface.ts`

```typescript
getResolvers?(context: ModuleResolverContext): ResolverMap | Promise<ResolverMap>
```

**Called by:** Module Registry Service at startup (once, not per-request)

**Parameters:**
- `context` — A `ModuleResolverContext` providing shared resources for constructing resolver closures

**Returns:** A `ResolverMap` mapping `TypeName.fieldName` to resolver functions, or a Promise thereof

**Contract rules:**
- Only called if `getSchemaExtension()` returned a non-empty SDL fragment
- The returned resolver map must only contain fields that appear in the module's SDL
- Resolvers for undeclared fields are silently rejected at startup
- Subscription resolvers are not supported — any `Subscription` key is rejected
- If `getResolvers()` throws, the module remains healthy; resolvers are a best-effort addition
- Resolver functions are closures — capture shared resources from `context` at construction time; per-request data (auth token, user) arrives via the standard resolver function signature `(parent, args, context, info)`

**Security:**
- All module resolvers are wrapped with auth enforcement — a valid JWT is required even if the module's SDL omits `@authentication`
- All module resolvers are wrapped with a 30-second timeout
- Module errors are sanitized before reaching clients (internal details hidden in production)
- Hardcoded platform resolvers always take precedence over module resolvers on conflict

For detailed architecture and security model, see [MODULE_CUSTOM_RESOLVERS.md](../backend/LLD/MODULE_CUSTOM_RESOLVERS.md).

### ModuleResolverContext

**Source File:** `packages/dt-module/src/interfaces/module-resolver-interface.ts`

Context passed to `getResolvers()` at startup. Use this to construct resolver functions that close over shared resources. This is NOT a per-request context.

```typescript
export interface ModuleResolverContext {
  /** Neo4j/Memgraph driver -- same driver the module received at construction time */
  driver: any;
  /** Logger scoped to the module */
  logger: Logger;
  /** Database name for session creation */
  databaseName: string;
}
```

### ResolverMap / ResolverFunction

**Source File:** `packages/dt-module/src/interfaces/module-resolver-interface.ts`

```typescript
export interface ResolverMap {
  [typeName: string]: {
    [fieldName: string]: ResolverFunction;
  };
}

export interface ResolverFunction {
  (parent: any, args: any, context: any, info: any): any;
}
```

The `context` parameter in `ResolverFunction` is typed as `any` intentionally — modules must not depend on platform-internal types. At runtime, it is the per-request `GraphQLContext` containing `token`, `jwt`, `driver`, `sessionConfig`, etc.

---

## Lifecycle Hooks (Optional)

Lifecycle hooks are **push-style** callbacks: the platform invokes them on a platform event or a maintenance operation, rather than the module pulling state on a user request.

They split into two kinds by **when** they run relative to the platform's transaction:

- **In-transaction hooks** — `onModelDeleted` and `onOrphanSweep`. The platform hands the hook a live `tx` and the module's writes commit or roll back **together** with the platform's.
- **Post-commit hook** — `afterInstall`. The platform hands the hook the raw `driver` (not a `tx`) **after** its write transaction has committed; the hook opens its own session and the platform does **not** roll back its writes. See [afterInstall(ctx)](#afterinstallctx) for the carve-out that follows from this timing.

The division of responsibility is by **label ownership**. The platform owns the core/structural labels (`Model`, `SecurityBoundary`, `Component`, `DataFlow`, `Data`, `Exposure`) and removes them itself. Each module owns — and is the only participant that removes — the labels *it* defines. A hook is the seam through which the platform tells a module "a model was deleted" or "remove your orphans" without the platform surface ever naming a module's labels.

The **in-transaction** hooks (`onModelDeleted`, `onOrphanSweep`) share the same discipline (`afterInstall` deliberately differs — see its subsection):

- **Transaction-bound.** Perform graph operations **only** on the passed `tx`. Do not open your own session or transaction — a rollback must be able to revert the hook's writes.
- **Idempotent.** The platform runs the work inside a managed transaction that may re-run the whole callback (and therefore the hook) on a retriable error. Re-running `DETACH DELETE`-style graph operations is safe; a second invocation on already-clean data is a no-op.
- **Side-effect-free.** No event emit, external call, counter increment, or any off-`tx` write. A non-transactional side effect would be doubled on a retry and never rolled back.
- **Throw-to-abort.** A throw from any hook aborts the whole operation — the transaction rolls back and the throw surfaces as an error. Invocation order across modules is unspecified, so each implementation must be self-contained from its arguments and must not depend on another module's hook running first.

### onModelDeleted(tx, modelId, analysisIds)

```typescript
onModelDeleted?(
  tx: any,
  modelId: string,
  analysisIds: string[],
): Promise<{ nodesDeleted: number; relationshipsDeleted: number } | void>
```

Removes the module's own model-scoped nodes when the platform deletes a model.

**Called by:** the platform's model-delete path, inside the single write transaction that also runs the structural delete. The platform pre-enumerates the model's owned analysis ids and dispatches this hook to every loaded module before running the structural delete; everything commits or rolls back together.

**Parameters:**
- `tx` — the active write transaction. Typed `any` to match this package's transaction-callback convention (so the base library carries no driver dependency). All of the hook's graph operations must run on this `tx`.
- `modelId` — the id of the model being deleted.
- `analysisIds` — the model's owned analysis ids, pre-collected by the platform so the hook need not re-enumerate them.

**Returns:** `{ nodesDeleted, relationshipsDeleted }` for the platform to fold into its deletion stats, or `void`.

**Contract rules:**
- Operate only on the passed `tx` — open no session or transaction of your own.
- Be idempotent: the managed transaction may re-run the callback, and therefore this hook, on a retriable error.
- Perform no non-transactional side effects (no event emit, external call, counter, or off-`tx` write).
- Be self-contained from `{ modelId, analysisIds }` — invocation order across modules is unspecified, so do not depend on another module's nodes already being gone.
- A throw aborts the whole delete: the transaction rolls back and the error propagates.

### onOrphanSweep(tx, opts)

```typescript
onOrphanSweep?(
  tx: any,
  opts: { apply: boolean },
): Promise<{
  byLabel: Record<string, number>;
  nodesDeleted: number;
  relationshipsDeleted: number;
} | void>
```

Counts or removes the module's own orphaned nodes during an admin-run, graph-wide sweep of pre-existing orphans (nodes whose owner was deleted before the delete path cascaded fully).

**Called by:** the admin orphan-sweep operation, on a single transaction shared with the platform's core sweep. The platform aggregates each module's per-label counts into one operator-facing report; it never names a module's labels itself.

**Parameters:**
- `tx` — the active transaction. Typed `any` per this package's transaction-callback convention. Read transaction on dry-run, write transaction on apply.
- `opts.apply`:
  - `false` (dry-run) — **count only**. Must not mutate the graph; the platform runs this on a read transaction. Return the would-delete counts so an operator can preview the blast radius.
  - `true` — **delete** the orphans and return actual counts. The platform runs this on a write transaction.

**Returns:** `{ byLabel, nodesDeleted, relationshipsDeleted }` to fold into the platform's report, or `void`. `byLabel` maps each of the module's own labels to its node count.

**Contract rules:**
- Operate only on the passed `tx`; respect the mode — never mutate the graph when `apply` is `false`.
- Report node counts only on the dry-run; the dry-run count and the apply count for the same graph state must agree per label (the sweep's self-consistency contract).
- Be idempotent: a second sweep over already-clean data is a no-op (`{}`), and the managed transaction may re-run the callback on a retriable error.
- Perform no non-transactional side effects.
- A throw aborts the whole sweep — for example, a violated data-integrity precondition that would make deletion risk live data. The throw rolls the transaction back and surfaces as an error.

### afterInstall(ctx)

```typescript
afterInstall?(ctx: ModuleInstallContext): Promise<void>
```

Runs graph work that must reference the module's **own** committed `:Module` node — for example, a module that links a bespoke node it seeds to its `(:Module {name})`.

**Unlike the in-transaction hooks above, this one runs *post-commit* on a session the module opens itself.** It fires **once per install/reinstall**, strictly **after** the multi-module write transaction commits — the first (and only) lifecycle point at which the module's own `:Module` node is committed and visible to a fresh session. Every other module hook fires *before* that node is written. Because the platform hands over the raw `driver` rather than a `tx`, the module's writes are **not** part of a platform transaction and are **not** rolled back by the platform.

**Called by:** the platform's post-commit install step, once the module upsert transaction has committed. It runs on both freshly-installed modules and content-hash-skipped (unchanged) modules — an unchanged module still re-runs its hook on each boot. See [ModuleManagementService → afterInstall invocation](../backend/LLD/MODULE_MANAGEMENT_SERVICE.md#afterinstall-post-commit-hook-invocation) for the mechanism.

**Parameters:**
- `ctx` — a `ModuleInstallContext` with exactly three fields:
  - `driver` — the raw neo4j-driver `Driver`. Typed `any` to keep a neo4j-driver dependency out of the base library. The hook opens its **own** session from it (`ctx.driver.session({ database: ctx.databaseName })`); this is **not** a `tx`.
  - `moduleName` — this module's name, equal to its `:Module {name}` in the graph. Use it to `MATCH` the module's own node.
  - `databaseName` — the database the platform installed into, for opening the session.

**Returns:** `Promise<void>`.

**Contract rules:**
- **Open your own session** from `ctx.driver` and close it before returning — do not hold it open beyond the call. (This is the deliberate opposite of the in-transaction hooks, which forbid opening a session.)
- **Be idempotent — MERGE, not CREATE.** The hook re-runs on every boot for an unchanged module, and it re-runs after a self-heal reinstall, so it may execute more than once for the same logical state.
- **Failure is isolated and self-healing.** A throw — or exceeding the module-load timeout (`MODULE_LOAD_TIMEOUT`, default 30 000 ms) — is caught and logged, and downgrades **only this module** (`SET m.lastInstallStatus = 'partial'`) so the content-hash skip gate reinstalls and re-invokes it on the next boot. Sibling modules in the same batch are unaffected, and the install itself never fails.
- **The platform does not roll back the hook's writes.** Because it runs post-commit on your own session, a partial write survives a later throw; idempotent MERGE-based writes keep re-runs safe.

**Example** — link the module's own `:Module` node to a node it seeds, proving post-commit visibility:

```typescript
import type { ModuleInstallContext } from '@dethernety/dt-module';

async afterInstall(ctx: ModuleInstallContext): Promise<void> {
  const session = ctx.driver.session({ database: ctx.databaseName });
  try {
    await session.executeWrite((tx: any) =>
      tx.run(
        `MATCH (m:Module {name: $name})
         MERGE (m)-[:AFTER_INSTALL_MARKER]->(:ReferenceData {n: $name})`,
        { name: ctx.moduleName },
      ),
    );
  } finally {
    await session.close();
  }
}
```

The `MATCH (m:Module {name})` succeeds only because the hook runs post-commit — this is the guarantee no earlier hook can offer. The `MERGE` keeps the write idempotent across the re-runs described above.

---

## Remote content modules (DtRemoteModule)

`DtRemoteModule` is a sibling of `DtFileOpaModule` that implements the same `DTModule` contract, but serves metadata, class templates, guides, embeddings, and evaluation from an HTTP content service over the module content wire protocol instead of from a local data directory. Every difference from a file-backed module (network, caching, denial, not-evaluated) is expressed *through* the `DTModule` contract — a returned template, a returned finding list, or a thrown error — never a new platform hook, so the platform (and dt-ui) stay unaware that the module is remote.

**Source file:** `packages/dt-module/src/dt-remote-module.ts`

### Mounting

An operator mounts a remote module with a trivial stub whose default export constructs a `DtRemoteModule` for one module key at one pinned content version:

```typescript
import { DtRemoteModule } from '@dethernety/dt-module';

export default class MyRemoteModule extends DtRemoteModule {
  constructor(driver, logger) {
    super({ moduleKey: 'my-module', pin: 'sha256:…' }, driver, logger);
  }
}
```

### Configuration

| Setting | Scope | Meaning |
|---------|-------|---------|
| `MODULE_CONTENT_BASE_URL` | Deployment (env) | The content service base URL. **No default** — an unset value leaves the module inert (it registers nothing and reports unavailable). |
| `MODULE_CONTENT_CACHE_DIR` | Deployment (env) | Where the metadata/content caches live. **Must be co-durable with the graph database** — the caches and the classes they protect have to survive a restart together. An unset or ephemeral directory logs a loud boot warning; see below. |
| `moduleKey` + `pin` | Per module (stub literal) | Which module, at which immutable content-hash version. |

### Boot, caching, and the pin

- **Boot is credential-free** and completes offline from cache. `getMetadata()` fetches the module document + embeddings and returns the platform's metadata verbatim; `getEmbedding()` answers synchronously from vectors prefetched at registration.
- The metadata cache is placed **co-durable with the graph database** so that a warm deployment boots offline and a registered module never has to fail its load. A remote module that failed to load would be swept along with its classes' bindings; the client's rule is therefore to **never throw once it has registered** — on an offline pin-miss it serves the newest cached document for the module, keeping ids stable. This is why the cache directory placement is a correctness concern, not just a latency one, and why an ephemeral/unset directory warns loudly.
- The **pin** is an immutable content hash. All reads serve at that pin; an assessment can state exactly what content produced it. The operator advances a version by editing the stub's `pin` and restarting — registration re-registers the *same* class ids at the new content (ids are stable across versions), so an upgrade never orphans or rebinds.

### Entitlement, denial, and not-evaluated

- Template/guide calls forward the caller's bearer token. A caller who is **not entitled** (or a deployment with no cloud credential) receives valid, self-sanitized read-only fallback content — the platform renders it like any other module template. Server-authored denial text is escaped to inert plain text and length-bounded before it is embedded, and any action URL is honoured only on the service-declared portal origin.
- Evaluation reads the element's attributes locally, sends only the class-schema-declared keys to the service (payload minimization), and returns the findings. A denied or unavailable evaluation **throws a typed error** — never an empty result, which would masquerade as evaluated-clean and overwrite prior findings. A recalled content version (`410`) surfaces the operator reason and stops serving that pin's cached content.

`DtRemoteModule` implements the catalog, content, and evaluation surfaces of the wire protocol; other surfaces are separate modules.

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [BASE_CLASSES.md](./BASE_CLASSES.md) | Implementation patterns for DTModule |
| [UTILITY_CLASSES.md](./UTILITY_CLASSES.md) | Helper classes (DbOps, LangGraph ops) |
| [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md) | Step-by-step development guide |
| [MODULE_CUSTOM_RESOLVERS.md](../backend/LLD/MODULE_CUSTOM_RESOLVERS.md) | Custom resolver architecture (LLD) |
| [MODULE_MANAGEMENT_SERVICE.md](../backend/LLD/MODULE_MANAGEMENT_SERVICE.md) | Module upsert + `afterInstall` invocation mechanism (LLD) |
