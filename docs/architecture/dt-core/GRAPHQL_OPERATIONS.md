# GraphQL Operations

## Table of Contents
- [Overview](#overview)
- [Domain Classes](#domain-classes)
- [DtModel](#dtmodel)
- [DtComponent](#dtcomponent)
- [DtBoundary](#dtboundary)
- [DtDataflow](#dtdataflow)
- [DtDataItem](#dtdataitem)
- [DtClass](#dtclass)
- [DtModule](#dtmodule)
- [DtClassIdentity](#dtclassidentity)
- [DtControl](#dtcontrol)
- [DtFolder](#dtfolder)
- [DtAnalysis](#dtanalysis)
- [DtIssue](#dtissue)
- [MITRE Framework Classes](#mitre-framework-classes)
- [DtMitre](#dtmitre)
- [Disposition Operations](#disposition-operations)
- [Supersede Orchestration Helpers](#supersede-orchestration-helpers)

## Overview

Each domain area in dt-core has a dedicated class that encapsulates GraphQL operations. Classes follow a consistent pattern:

1. **Constructor** - Accepts an ApolloClient instance
2. **Query methods** - Read operations (get*, find*, dump*)
3. **Mutation methods** - Write operations (create*, update*, delete*)
4. **Helper methods** - Domain-specific utilities

**File Naming Convention:**
- `dt-{domain}.ts` - Class implementation
- `dt-{domain}-gql.ts` - GraphQL definitions

---

## Domain Classes

### Class Hierarchy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Domain Class Structure                          │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌─────────────────┐                                                   │
│  │    DtUtils      │ ◀── Base utility class                            │
│  └────────┬────────┘                                                   │
│           │                                                            │
│           │ uses                                                       │
│           │                                                            │
│  ┌────────┴────────────────────────────────────────────────────────┐   │
│  │                                                                 │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐         │   │
│  │  │ DtModel  │  │DtCompone.│  │DtBoundary│  │DtDataflow│         │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘         │   │
│  │                                                                 │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐         │   │
│  │  │DtDataItem│  │ DtClass  │  │ DtModule │  │ DtControl│         │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘         │   │
│  │                                                                 │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐         │   │
│  │  │ DtFolder │  │DtAnalysis│  │ DtIssue  │  │ DtExport │         │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘         │   │
│  │                                                                 │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐         │   │
│  │  │ DtImport │  │DtMitreAt.│  │DtMitreDe.│  │DtExposure│         │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘         │   │
│  │                                                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## DtModel

**Source:** `packages/dt-core/src/dt-model/`

Manages threat model lifecycle and data retrieval.

### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `getModels` | Get all models | `{ folderId?: string }` | `Promise<Model[]>` |
| `getNotRepresentingModels` | Get models not linked as represented | `{ modelId: string }` | `Promise<Model[]>` |
| `dumpModelData` | Export complete model structure | `{ modelId: string }` | `Promise<ModelDump>` |
| `createModel` | Create new model | `{ name, description, modules, folderId }` | `Promise<Model>` |
| `updateModel` | Update model properties | `{ modelId, name?, description?, modules?, controls? }` | `Promise<Model>` |
| `deleteModel` | Delete model | `{ modelId: string }` | `Promise<boolean>` |

### Example Usage

```typescript
const dtModel = new DtModel(apolloClient)

// Get all models in a folder
const models = await dtModel.getModels({ folderId: 'folder-123' })

// Create new model with modules
const newModel = await dtModel.createModel({
  name: 'My Threat Model',
  description: 'API security analysis',
  modules: ['module-1', 'module-2'],
  folderId: 'folder-123'
})

// Dump complete model data for export
const modelData = await dtModel.dumpModelData({ modelId: 'model-123' })
```

### GraphQL Definitions

```typescript
// dt-model-gql.ts exports:
GET_MODELS           // Query all models with folder filter
GET_NOT_REPRESENTING_MODELS  // Find models not linked
DUMP_MODEL_DATA      // Full model export query
CREATE_MODEL         // Create with modules
UPDATE_MODEL         // Update properties
DELETE_MODEL         // Delete by ID
```

---

## DtComponent

**Source:** `packages/dt-core/src/dt-component/`

Manages system components (processes, services, databases, external entities).

### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `createComponentNode` | Create new component | `{ newNode, classId, defaultBoundaryId }` | `Promise<Node \| null>` |
| `updateComponent` | Update component properties | `{ componentId, name?, description?, x?, y?, controls?, dataItems? }` | `Promise<ComponentData>` |
| `getComponentRepresentedModel` | Get linked model | `{ componentId }` | `Promise<Model \| null>` |
| `deleteComponent` | Delete component | `{ componentId }` | `Promise<boolean>` |

> **Class / model binding changes** for components, boundaries, data flows, data items, and controls all flow through [`DtClass.changeElementBinding`](#dtclass) — the atomic single-mutation surface that owns destructive-sweep + rewire + constructive-upsert. The legacy per-type wrappers (`updateComponentClass`, `updateComponentRepresentedModel`, `updateBoundaryClass`, `updateBoundaryRepresentedModel`, `updateDataFlowClass`) were removed in the atomic class-change consolidation.

### Example Usage

```typescript
const dtComponent = new DtComponent(apolloClient)

// Create component node
const node = await dtComponent.createComponentNode({
  newNode: {
    id: 'temp-123',
    type: 'PROCESS',
    position: { x: 100, y: 200 },
    data: { label: 'API Server', description: 'Main API' }
  },
  classId: 'class-web-server',
  defaultBoundaryId: 'boundary-123'
})

// Update component position and properties
await dtComponent.updateComponent({
  componentId: 'comp-123',
  name: 'Updated Name',
  x: 150,
  y: 250
})

// Link component to another model (composition) — routes through DtClass.changeElementBinding.
await dtClass.changeElementBinding({
  elementId: 'comp-123',
  target: { kind: 'REPRESENTED_MODEL', modelId: 'other-model-456' },
})
```

---

## DtBoundary

**Source:** `packages/dt-core/src/dt-boundary/`

Manages security boundaries and trust zones.

### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `createBoundaryNode` | Create new boundary | `{ newNode, classId, defaultBoundaryId }` | `Promise<Node \| null>` |
| `updateBoundaryNode` | Update boundary properties, zoning, and conduits | `{ updatedNode, defaultBoundaryId, baselineConduits? }` | `Promise<BoundaryData \| null>` |
| `getBoundaryRepresentedModel` | Get linked model | `{ boundaryId }` | `Promise<Model \| null>` |
| `getDescendants` | Get direct children | `{ boundaryId }` | `Promise<{ components, securityBoundaries } \| null>` |
| `deleteBoundary` | Delete boundary | `{ boundaryId }` | `Promise<boolean>` |

> Class / model binding changes route through [`DtClass.changeElementBinding`](#dtclass) — see the DtComponent block above.

#### `updateBoundaryNode` — zoning and conduit reconcile

Beyond the position/dimension properties, `updateBoundaryNode` also persists the boundary's **zoning** fields and reconciles its **conduit** edges in the same `updateSecurityBoundaries` mutation. The values are read off `updatedNode.data` and pass through the [boundary zoning utilities](./DATA_ACCESS_LAYER.md#boundary-zoning-utilities) before being sent:

- `zone` — sanitized via `sanitizeZone` (invalid/garbage → `null`).
- `domains` — sanitized via `sanitizeDomains` (trim, drop empties, case-insensitive de-dupe, length/count caps).
- `planes` — normalized via `normalizePlanes` (valid members only, de-duped, canonical order). Persisted as a `[String!]` field — the values are constrained to the `Plane` union app-side, not by a GraphQL enum.

**Conduit reconcile (baseline delta).** Conduits are reconciled **only when** `updatedNode.data.conduits` is present; an `undefined` buffer leaves the edges untouched (the same convention as `controls` / `dataItems`). When present, the method calls `buildConduitOps('OUTBOUND', …)` and `buildConduitOps('INBOUND', …)` to compute a **delta against `baselineConduits`** — peers added are `connect`-ed, peers removed are `disconnect`-ed, and justification-only changes become `update` ops. This is deliberately a delta and not a connect-all: the graph `CONDUIT` `connect` is **not idempotent**, so re-connecting an existing peer would create a duplicate parallel edge. See [`buildConduitOps`](./DATA_ACCESS_LAYER.md#buildconduitops--baseline-delta-reconcile) for the full rationale.

`baselineConduits` is the boundary's conduits **as they were on the server before the optimistic edit** — the caller snapshots them and passes them in (defaults to `[]`). On success the method re-derives `conduits` from the server response via `flattenConduits` so the caller can re-pin its baseline to server truth.

The `ADD_BOUNDARY` / `UPDATE_BOUNDARY` selections both return `zone`, `domains`, and `planes`; `UPDATE_BOUNDARY` additionally returns the `outboundConduitsConnection` / `inboundConduitsConnection` edge reads that `flattenConduits` consumes.

### Example Usage

```typescript
const dtBoundary = new DtBoundary(apolloClient)

// Create nested boundary
const boundary = await dtBoundary.createBoundaryNode({
  newNode: {
    id: 'temp-456',
    type: 'BOUNDARY',
    position: { x: 50, y: 50 },
    data: { label: 'DMZ', description: 'Demilitarized zone' }
  },
  classId: 'class-network-zone',
  defaultBoundaryId: 'root-boundary-123'
})

// Update boundary dimensions + zoning + conduits.
// `baselineConduits` is the server-truth snapshot taken before the optimistic edit;
// buildConduitOps diffs updatedNode.data.conduits against it (delta, not connect-all).
await dtBoundary.updateBoundaryNode({
  updatedNode: {
    id: 'boundary-456',
    position: { x: 50, y: 50 },
    width: 500,
    height: 400,
    data: {
      label: 'DMZ',
      zone: 'EXPOSED',
      domains: ['payments'],
      planes: ['WORKLOAD'],
      conduits: [
        { peerId: 'boundary-internal', direction: 'OUTBOUND', justification: 'app → db' },
      ],
    },
  },
  defaultBoundaryId: 'root-boundary-123',
  baselineConduits: serverConduitsBeforeEdit,
})

// Get child elements
const children = await dtBoundary.getDescendants({ boundaryId: 'boundary-456' })
```

---

## DtDataflow

**Source:** `packages/dt-core/src/dt-dataflow/`

Manages data flow edges between components.

### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `createDataFlow` | Create new data flow | `{ sourceId, targetId, classId, name, description }` | `Promise<DataFlowData>` |
| `updateDataFlow` | Update data flow properties | `{ dataFlowId, name?, description?, sourceHandle?, targetHandle? }` | `Promise<DataFlowData>` |
| `deleteDataFlow` | Delete data flow | `{ dataFlowId }` | `Promise<boolean>` |

> Class binding changes route through [`DtClass.changeElementBinding`](#dtclass) — see the DtComponent block above.

### Example Usage

```typescript
const dtDataflow = new DtDataflow(apolloClient)

// Create data flow between components
const flow = await dtDataflow.createDataFlow({
  sourceId: 'component-api',
  targetId: 'component-database',
  classId: 'class-sql-query',
  name: 'Database Queries',
  description: 'SQL queries from API to DB'
})

// Update flow classification — routes through DtClass.changeElementBinding.
await dtClass.changeElementBinding({
  elementId: flow.id,
  target: { kind: 'CLASS', classIds: ['class-encrypted-connection'] },
})
```

---

## DtDataItem

**Source:** `packages/dt-core/src/dt-dataitem/`

Manages data classification entities.

### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `getDataItems` | Get all data items | `{ modelId?: string }` | `Promise<DataItem[]>` |
| `createDataItem` | Create new data item | `{ name, description, classId }` | `Promise<DataItem>` |
| `updateDataItem` | Update data item — bundled binding + residual write. When `classId` is supplied the call routes the binding portion through `DtClass.changeElementBinding` and the residual property update through the auto-generated `updateData` mutation. | `{ dataItemId, name?, description?, classId? }` | `Promise<{ dataItem: DataItem \| null, bindingResult: ChangeElementBindingResult \| null, residualOk: boolean }>` |
| `deleteDataItem` | Delete data item | `{ dataItemId }` | `Promise<boolean>` |

> **`updateDataItem` return shape.** The bundled return surfaces both halves so callers can render partial-failure UX: if the class binding committed but the residual property update failed, `bindingResult.success` is `true`, `dataItem` is `null`, and `residualOk` is `false`. The frontend uses this to fire a separate "settings could not be saved" toast in addition to the class-change delta-receipt snackbar.

---

## DtClass

**Source:** `packages/dt-core/src/dt-class/`

Manages entity classifications, templates, and atomic class / model binding.

### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `changeElementBinding` | Atomically change an element's class / representedModel / none binding (destructive sweep + rewire + constructive upsert). The single sanctioned write path for `IS_INSTANCE_OF` and `REPRESENTS_MODEL` edges. | `{ elementId, target: ClassBinding \| RepresentedModelBinding \| NoBinding }` | `Promise<ChangeElementBindingResult>` |
| `getComponentClass` | Get component's classification | `{ componentId }` | `Promise<Class \| null>` |
| `getBoundaryClass` | Get boundary's classification | `{ boundaryId }` | `Promise<Class \| null>` |
| `getDataFlowClass` | Get data flow's classification | `{ dataFlowId }` | `Promise<Class \| null>` |
| `getDataClass` | Get data class by ID | `{ classId }` | `Promise<Class \| null>` |
| `getControlClasses` | Get available control classes | `{ moduleId }` | `Promise<Class[]>` |
| `getControlClassById` | Get specific control class | `{ classId }` | `Promise<Class \| null>` |
| `setInstantiationAttributes` | Set element attributes from class | `{ elementId, elementType, attributes }` | `Promise<void>` |
| `getAttributesFromClassRelationship` | Get instantiation attributes | `{ elementId, elementType }` | `Promise<object \| null>` |

### `changeElementBinding` — atomic class / model binding

Single mutation that replaces five legacy per-type wrappers (`updateComponentClass`, `updateBoundaryClass`, `updateDataFlowClass`, `updateControlClass`, `updateBoundaryRepresentedModel`). Every binding transition — class → class, class → none, none → class, class → represented-model, represented-model → class — runs in one Bolt transaction with destructive sweep of stale derived findings, idempotent rewire, and scoped exposure / countermeasure upsert.

```typescript
const result = await dtClass.changeElementBinding({
  elementId: 'comp-1',
  target: { kind: 'CLASS', classIds: ['cc-webserver'] },
})

if (result.success) {
  // result.deltas: instantiatedDerivedExposures, deletedDerivedExposures,
  //                instantiatedDerivedCountermeasures, deletedDerivedCountermeasures,
  //                preservedCustomExposures, preservedCustomCountermeasures
  console.log(result.deltas)
} else {
  // result.errorCode is one of:
  //   VALIDATION_ERROR | ELEMENT_NOT_FOUND | CLASS_NOT_FOUND | MODEL_NOT_FOUND
  //   ORPHAN_CLASS_REFUSED | REPRESENTED_MODEL_NOT_ALLOWED | MODULE_ERROR | DATABASE_ERROR
  console.error(result.errorCode, result.errorMessage)
}
```

Target shapes:
- `{ kind: 'CLASS', classIds: string[] }` — bind to one or more classes (Controls allow multi-class; other elements take a single id)
- `{ kind: 'REPRESENTED_MODEL', modelId: string }` — bind to a model (Components / Security Boundaries only)
- `{ kind: 'NONE' }` — unbind; sweeps all SYSTEM-derived findings, preserves USER-authored ones

Identity transitions (target equals current) short-circuit server-side with zero deltas — safe to retry.

### Special Handling

The DtClass implementation includes special handling for:
- Base64-encoded YAML guides — automatically decoded and parsed
- Malformed data — logs warnings and returns partial results
- Template schema extraction — parses JSONForms schema/uischema

---

## DtModule

**Source:** `packages/dt-core/src/dt-module/`

Manages module registry and frontend bundles.

### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `getModules` | Get all modules | `none` | `Promise<Module[]>` |
| `getModuleById` | Get module by ID | `{ moduleId }` | `Promise<Module \| null>` |
| `getModuleByName` | Get module by name | `{ moduleName }` | `Promise<Module \| null>` |
| `saveModule` | Save module configuration | `{ module }` | `Promise<Module>` |
| `resetModule` | Reset module to defaults | `{ moduleId }` | `Promise<void>` |
| `getAvailableFrontendModules` | List frontend bundles | `none` | `Promise<string[]>` |
| `getModuleFrontendBundle` | Get bundle code | `{ moduleId }` | `Promise<string \| null>` |

---

## DtClassIdentity

**Source:** [`packages/dt-core/src/dt-class-identity/`](../../../packages/dt-core/src/dt-class-identity/)

Class-identity admin surface — modules with install lifecycle + orphaned-class lists, the in-memory event log, and the four admin mutations that back the **Operations** tab of the modules page. Every method targets an admin-gated server operation; calls fail with `ForbiddenException` if the caller does not have the admin role.

### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `getModulesWithIdentity` | Modules augmented with `idRebindPolicy`, `lastInstallStatus`, `lastAttemptedInstall`, `lastAuthoritativeInstall`, `rebindConflicts`, `constraintsHealthy`, and the seven `orphaned*Classes` lists | `none` | `Promise<Module[]>` |
| `getClassIdentityEvents` | Events from the in-memory ring buffer (max 1000, drop-oldest, process-local) | `{ kind?, moduleName?, since? }` | `Promise<ClassIdentityEvent[]>` |
| `migrateClassId` | Admin: align the DB id of a `(Module, *Class)` pair to a new id. Server-side: `requireAdmin(ctx)`; emits audit log + `kind: 'rebind', policy: 'audit'` event | `{ moduleName, className, classKind, newId }` | `Promise<boolean>` |
| `reviveOrphanedClass` | Admin: revive an orphaned class (HAS_ORPHANED_CLASS → HAS_CLASS). Idempotent. Server-side: `requireAdmin(ctx)`; emits audit log + `kind: 'revive'` event | `{ classId, classKind }` | `Promise<boolean>` |
| `deleteOrphanedClass` | Admin: hard-delete an orphaned class. `cascade=false` (default) refuses with a non-zero incident count. `cascade=true` DETACH DELETEs the class AND every incident instance — capped at 1000 server-side. Server-side: `requireAdmin(ctx)` | `{ classId, classKind, cascade }` | `Promise<boolean>` |
| `runIdentityMigration` | Admin: re-run the idempotent class-identity cleanup. `dryRun=true` reports planned actions without writing. Server-side: `requireAdmin(ctx)` | `{ dryRun }` | `Promise<IdentityMigrationReport>` |

**Authz model.** Every method maps to a server operation gated by `requireAdmin(ctx)` at resolver entry — UI gating in the Modules page is defence-in-depth, the server gate is the only enforcement. See the backend [`ClassIdentityResolverService`](../backend/LLD/CUSTOM_RESOLVER_SERVICES_DOCUMENTATION.md#6-classidentityresolverservice) for the audit-log + admin-check details.

### Example Usage

```typescript
import { DtClassIdentity } from '@dethernety/dt-core'

const dtClassIdentity = new DtClassIdentity(apolloClient)

// Fetch modules with the admin surface populated
const modules = await dtClassIdentity.getModulesWithIdentity()
const blocked = modules.filter(m => m.lastInstallStatus === 'unavailable')

// Resolve a strict-mode rebind conflict by adopting the module-declared id
for (const conflict of blocked[0].rebindConflicts ?? []) {
  await dtClassIdentity.migrateClassId({
    moduleName: blocked[0].name,
    className: conflict.className,
    classKind: conflict.classKind,
    newId: conflict.moduleDeclaredId,
  })
}

// Re-run the cleanup migration (dry-run first)
const plan = await dtClassIdentity.runIdentityMigration({ dryRun: true })
console.log(`${plan.totalActions} actions planned`)
```

---

## DtControl

**Source:** `packages/dt-core/src/dt-control/`

Manages security controls.

### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `getControls` | Get all controls | `{ folderId?: string }` | `Promise<Control[]>` |
| `createControl` | Create new control | `{ name, description, folderId }` | `Promise<Control>` |
| `updateControl` | Update control — bundled binding + residual write. When `controlClasses` is supplied the call routes the binding portion through `DtClass.changeElementBinding` and the residual property update through the auto-generated `updateControls` mutation. | `{ controlId, name?, description?, controlClasses? }` | `Promise<{ control: Control \| null, bindingResult: ChangeElementBindingResult \| null, residualOk: boolean }>` |
| `deleteControl` | Delete control | `{ controlId }` | `Promise<boolean>` |

> **`updateControl` return shape.** Same bundled `{ control, bindingResult, residualOk }` shape as `updateDataItem` above: callers can render two distinct snackbars when the binding committed but the residual property update failed. See [`changeElementBinding`](#dtclass) for the binding-portion contract.

---

## DtFolder

**Source:** `packages/dt-core/src/dt-folder/`

Manages organizational folders.

### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `getFolders` | Get folder hierarchy | `{ parentId?: string }` | `Promise<Folder[]>` |
| `createFolder` | Create new folder | `{ name, description, parentId }` | `Promise<Folder>` |
| `updateFolder` | Update folder | `{ folderId, name?, description? }` | `Promise<Folder>` |
| `deleteFolder` | Delete folder | `{ folderId }` | `Promise<boolean>` |

---

## DtAnalysis

**Source:** `packages/dt-core/src/dt-analysis/`

Manages AI-powered security analysis workflows.

### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `findAnalysisClasses` | Get available analysis types | `{ moduleId?: string }` | `Promise<AnalysisClass[]>` |
| `findAnalyses` | Find analyses by criteria | `{ modelId?, status?, type? }` | `Promise<Analysis[]>` |
| `createAnalysis` | Start new analysis | `{ modelId, analysisClassId, scope }` | `Promise<Analysis>` |
| `runAnalysis` | Execute analysis | `{ analysisId }` | `Promise<AnalysisSession>` |
| `resumeAnalysis` | Continue analysis | `{ sessionId }` | `Promise<AnalysisSession>` |
| `subscribeToStream` | Real-time updates | `{ sessionId, callback }` | `Subscription` |
| `startAnalysisChat` | Interactive chat | `{ analysisId, message }` | `Promise<void>` |

### Subscription Pattern

```typescript
const dtAnalysis = new DtAnalysis(apolloClient)

// Start analysis and subscribe to updates
const session = await dtAnalysis.runAnalysis({ analysisId: 'analysis-123' })

const subscription = dtAnalysis.subscribeToStream({
  sessionId: session.sessionId,
  callback: (event) => {
    console.log('Analysis update:', event.analysisResponse)
  }
})

// Later: cleanup
subscription.unsubscribe()
```

---

## DtIssue

**Source:** `packages/dt-core/src/dt-issue/`

Manages security issue tracking.

### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `getIssues` | Get all issues | `{ modelId?: string, status?: string }` | `Promise<Issue[]>` |
| `createIssue` | Create new issue | `{ name, description, type, elements }` | `Promise<Issue>` |
| `updateIssue` | Update issue | `{ issueId, name?, status?, attributes? }` | `Promise<Issue>` |
| `deleteIssue` | Delete issue | `{ issueId }` | `Promise<boolean>` |

---

## MITRE Framework Classes

### DtMitreAttack

**Source:** `packages/dt-core/src/dt-mitreattack/`

| Method | Description | Returns |
|--------|-------------|---------|
| `getTactics` | Get all ATT&CK tactics | `Promise<MitreAttackTactic[]>` |
| `getTechniques` | Get techniques (optionally by tactic) | `Promise<MitreAttackTechnique[]>` |
| `getMitigations` | Get all mitigations | `Promise<MitreAttackMitigation[]>` |
| `searchTechniques` | Search by keyword | `Promise<MitreAttackTechnique[]>` |

### DtMitreDefend

**Source:** `packages/dt-core/src/dt-mitredefend/`

| Method | Description | Returns |
|--------|-------------|---------|
| `getTactics` | Get all D3FEND tactics | `Promise<MitreDefendTactic[]>` |
| `getTechniques` | Get techniques (optionally by tactic) | `Promise<MitreDefendTechnique[]>` |
| `searchTechniques` | Search by keyword | `Promise<MitreDefendTechnique[]>` |

### DtExposure

**Source:** `packages/dt-core/src/dt-exposure/`

Manages exposures (security weaknesses) attached to model elements, plus their disposition lifecycle.

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `getExposures` | Get all exposures for an element | `{ elementId }` | `Promise<Exposure[]>` |
| `getExposure` | Get exposure by ID | `{ exposureId }` | `Promise<Exposure>` |
| `createExposure` | Create exposure on an element | `{ exposure, elementId, attackTechniqueIds }` | `Promise<Exposure>` |
| `updateExposure` | Update exposure properties + technique links | `{ exposureId, exposure, attackTechniqueIds }` | `Promise<Exposure>` |
| `deleteExposure` | Delete exposure; fires the SUPERSEDED-staleness companion when `exposureName` is supplied | `{ exposureId, exposureName? }` | `Promise<boolean>` |
| `disposeExposure` | Author or replace a disposition | `{ exposureId, kind, reason }` | `Promise<DispositionMutationResult>` |
| `clearDisposition` | Clear a disposition (idempotent) | `{ exposureId }` | `Promise<DispositionMutationResult>` |
| `reAffirmDisposition` | Thin alias for `disposeExposure` (caller-narrative clarity; identical wire call) | `{ exposureId, kind, reason }` | `Promise<DispositionMutationResult>` |

> **Disposition return contract.** `disposeExposure` / `clearDisposition` resolve a [`DispositionMutationResult`](#disposition-operations) envelope. Domain errors (validation, not-found, database) return `success: false` with `errorCode` + `errorMessage` set rather than throwing; only transport / network errors propagate as exceptions.

> **USER-copy-delete companion.** When `deleteExposure` is called with `exposureName`, it fires a fire-and-forget `updateExposures` (`FLIP_SUPERSEDED_STALE`) that sets `dispositionStale: true` on any `SUPERSEDED` exposure whose `dispositionReason` contains the single-quote-wrapped name (`'<name>'`). The companion swallows its own errors and never blocks the delete return. When `exposureName` is omitted the companion is skipped — without a name a bare-substring match could flip unrelated dispositions.

#### Example Usage

```typescript
const dtExposure = new DtExposure(apolloClient)

// Dispose a SYSTEM-generated exposure instead of deleting it
const result = await dtExposure.disposeExposure({
  exposureId: 'exp-123',
  kind: 'RISK_ACCEPTED',
  reason: 'Accepted by security review board, ticket SEC-...',
})
if (!result.success) {
  console.error(result.errorCode, result.errorMessage)
}

// Clear a disposition (idempotent — no-op clear still returns success: true)
await dtExposure.clearDisposition({ exposureId: 'exp-123' })

// Delete a USER copy and flip staleness on the SYSTEM original it superseded
await dtExposure.deleteExposure({ exposureId: 'exp-456', exposureName: 'SQL Injection (custom)' })
```

#### GraphQL Definitions

```typescript
// dt-exposure-gql.ts exports:
GET_EXPOSURES         // Exposures for an element (incl. 5 disposition fields)
GET_EXPOSURE          // Single exposure by ID (incl. 5 disposition fields)
ADD_EXPOSURE          // createExposures
UPDATE_EXPOSURE       // updateExposures (selection includes disposition fields)
DELETE_EXPOSURE       // deleteExposures
DISPOSE_EXPOSURE      // disposeExposure custom mutation → DispositionMutationResult
CLEAR_DISPOSITION     // clearDisposition custom mutation → DispositionMutationResult
FLIP_SUPERSEDED_STALE // updateExposures companion (staleness flip by name)
```

The `GET_*` / `UPDATE_EXPOSURE` selections include `dispositionKind`, `dispositionReason`, `dispositionedBy`, `dispositionedAt`, and `dispositionStale` so post-save refetches render disposition state correctly without a second round trip.

### DtCountermeasure

**Source:** `packages/dt-core/src/dt-countermeasure/`

Manages countermeasures attached to Controls, plus their disposition lifecycle. Mirrors `DtExposure` method-for-method.

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `getCountermeasuresFromControl` | Get countermeasures for a Control | `{ controlId }` | `Promise<Countermeasure[] \| null>` |
| `getCountermeasure` | Get countermeasure by ID | `{ countermeasureId }` | `Promise<Countermeasure \| null>` |
| `createCountermeasure` | Create countermeasure on a Control | `{ controlId, countermeasure }` | `Promise<Countermeasure \| null>` |
| `updateCountermeasure` | Update countermeasure properties + framework links | `{ countermeasureId, countermeasure }` | `Promise<Countermeasure \| null>` |
| `deleteCountermeasure` | Delete countermeasure; fires the SUPERSEDED-staleness companion when `countermeasureName` is supplied | `{ countermeasureId, countermeasureName? }` | `Promise<boolean>` |
| `disposeCountermeasure` | Author or replace a disposition | `{ countermeasureId, kind, reason }` | `Promise<DispositionMutationResult>` |
| `clearCountermeasureDisposition` | Clear a disposition (idempotent) | `{ countermeasureId }` | `Promise<DispositionMutationResult>` |

> **Shared result envelope.** `disposeCountermeasure` / `clearCountermeasureDisposition` resolve the same [`DispositionMutationResult`](#disposition-operations) type as the exposure side. Its `exposureId` field carries the **countermeasure** id on this path (the field is reused unchanged across both finding types). Same domain-error-vs-throw contract as `DtExposure`.

> **USER-copy-delete companion.** `deleteCountermeasure` with `countermeasureName` fires a fire-and-forget `updateCountermeasures` (`FLIP_SUPERSEDED_COUNTERMEASURE_STALE`) that flips `dispositionStale: true` on any `SUPERSEDED` countermeasure whose `dispositionReason` contains `'<name>'`. Same skip-when-absent default as the exposure side.

#### GraphQL Definitions

```typescript
// dt-countermeasure-gql.ts exports:
GET_COUNTERMEASURES_FROM_CONTROL      // Countermeasures for a Control (incl. disposition fields)
GET_COUNTERMEASURE                    // Single countermeasure by ID (incl. disposition fields)
CREATE_COUNTERMEASURE                 // createCountermeasures (selection includes disposition fields)
UPDATE_COUNTERMEASURE                 // updateCountermeasures (selection includes disposition fields)
DELETE_COUNTERMEASURE                 // deleteCountermeasures
DISPOSE_COUNTERMEASURE                // disposeCountermeasure custom mutation → DispositionMutationResult
CLEAR_COUNTERMEASURE_DISPOSITION      // clearCountermeasureDisposition custom mutation → DispositionMutationResult
FLIP_SUPERSEDED_COUNTERMEASURE_STALE  // updateCountermeasures companion (staleness flip by name)
```

---

## DtMitre

**Source:** `packages/dt-core/src/dt-mitre/`

Vector-tier semantic match surface over the MITRE corpus. A thin façade over the `matchMitreTechniques` server query. Direct catalog access (tactics, full technique / mitigation lists) stays on [`DtMitreAttack`](#dtmitreattack) and [`DtMitreDefend`](#dtmitredefend) — `DtMitre` only adds the semantic-match tier.

### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `matchTechniques` | Match user-typed queries against a MITRE corpus through the five-tier cascade | `{ queries: string[], kind: MitreKind, topN? }` | `Promise<MatchMitreTechniquesResult>` |

**Cascade.** The server evaluates each query through five tiers and returns at most one tier's results per query: `EXACT_ID` → `PREFIX_ID` → `NAME_MATCH` → `DESCRIPTION_MATCH` → `VECTOR_SIMILARITY`. The vector tier reads a Memgraph HNSW index built from an embedding model and degrades gracefully — `vectorAvailable: false` plus a structured `vectorDisabledReason` (`EMBEDDING_DISABLED` | `NO_INDEX_MODULE` | `NO_VECTORS` | `MODEL_MISMATCH`) when the index is absent or mismatched.

**`kind`** selects the corpus and the index the server reads: `ATTACK_TECHNIQUE`, `DEFEND_TECHNIQUE`, or `ATTACK_MITIGATION`. **`topN`** caps candidates per query; the server clamps to `[1, 50]` and defaults to `3` when omitted.

**Cancellation.** `matchTechniques` routes through `dtUtils.withCancellableLatest` keyed by `matchTechniques:${kind}`, so rapid keystrokes from one picker supersede each other while mixed-kind pickers proceed in parallel. Superseded calls reject with `CancelledError` (callers exit silently).

### Example Usage

```typescript
const dtMitre = new DtMitre(apolloClient)

const result = await dtMitre.matchTechniques({
  queries: ['adversary-in-the-middle email interception'],
  kind: 'ATTACK_TECHNIQUE',
  topN: 10,
})

if (!result.vectorAvailable) {
  // Show deterministic-only tiers; surface a caption from result.vectorDisabledReason
}
for (const candidate of result.matches[0]?.candidates ?? []) {
  console.log(candidate.mitreId, candidate.matchType, candidate.similarityScore)
}
```

### GraphQL Definitions

```typescript
// dt-mitre-gql.ts exports:
MATCH_MITRE_TECHNIQUES  // matchMitreTechniques(input) → matches[] + unmatched + vectorAvailable + vectorDisabledReason
```

The server clamps `queries` to `MAX_QUERIES` (25) and `topN` to `[1, 50]`. The wrapper accepts bare query strings for ergonomics and maps each to the `TechniqueQueryInput { query }` shape the schema expects.

---

## Disposition Operations

Dispositions let users record a structured decision on a SYSTEM-generated finding (Exposure or Countermeasure) instead of deleting it. The four mutations — `disposeExposure`, `clearDisposition`, `disposeCountermeasure`, `clearCountermeasureDisposition` — all return the shared `DispositionMutationResult` envelope.

```typescript
interface DispositionMutationResult {
  success: boolean
  exposureId: string                    // carries the finding id for BOTH types
  dispositionKind: DispositionKind | null
  dispositionReason: string | null
  dispositionedBy: string | null
  dispositionedAt: string | null
  dispositionStale: boolean | null
  errorCode: DispositionErrorCode | null
  errorMessage: string | null
}
```

**Domain errors vs throws.** On success, `errorCode` / `errorMessage` are null and the `disposition*` fields echo the state landed on the finding (a clear lands all five null). On a domain error the server returns `success: false` with `errorCode` set and persists no graph change. Transport / network failures still propagate as exceptions through `performMutation`. This split lets callers branch on `result.success` for expected domain outcomes without a `try/catch`.

**Field reuse.** The result type names its id field `exposureId` for both finding types; on the countermeasure path it carries the countermeasure id. See [`DispositionMutationResult` in the Domain Model](../dt-core/DOMAIN_MODEL.md#disposition-fields) for the full type and `DispositionKind` enum.

---

## Supersede Orchestration Helpers

**Source:** `packages/dt-core/src/orchestration/`

Pure helpers (no Vue / Pinia dependency) that compose the two backend mutations behind a "Fork / Supersede" operation. Each takes a `DtExposure` / `DtCountermeasure` instance via args so it stays unit-testable with a mock.

| Helper | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `executeSupersedeFlow` | Clone a SYSTEM exposure into a USER copy, then dispose the original as `SUPERSEDED` | `{ systemExposureId, systemExposure, elementId, cloneNameSuffix?, dtExposure }` | `Promise<{ userCopy, systemDispositionResult }>` |
| `executeSupersedeCountermeasureFlow` | Clone a SYSTEM countermeasure into a USER copy (retaining the Control edge, dropping the class edge), then dispose the original as `SUPERSEDED` | `{ systemCountermeasureId, systemCountermeasure, controlId, cloneNameSuffix?, dtCountermeasure }` | `Promise<{ userCopy, systemDispositionResult }>` |

**Two-step composition.** Step 1 creates the USER copy (`createExposure` / `createCountermeasure`); step 2 disposes the SYSTEM original with `kind: 'SUPERSEDED'` and reason `Superseded by user-authored {exposure|countermeasure} '<cloneName>'`. The clone defaults its name to `<sourceName> (custom)` and annotates its description with a `(custom of '<sourceName>')` backreference.

**Partial-failure handling.** If step 2 returns `success: false`, the USER copy already exists — the helper does **not** roll it back (the copy is a legitimate authoring artefact) and returns both halves so the caller can surface a Retry affordance. Step 1 transport failures throw before step 2 runs, so no orphaned disposition is possible.

**Load-bearing quote wrapping.** The single-quote wrap around `<cloneName>` in the disposition reason is the match anchor for the [USER-copy-delete companion](#dtexposure): `flipSupersededStaleByName` filters on `dispositionReason CONTAINS "'<name>'"` (with the quotes). The two sites must agree byte-for-byte.
