# Import/Export

## Table of Contents
- [Overview](#overview)
- [Model Formats](#model-formats)
- [Schema Package](#schema-package)
- [Export Process](#export-process)
- [Import Process](#import-process)
- [ID Mapping](#id-mapping)
- [Boundary Zoning and Conduits](#boundary-zoning-and-conduits)
- [Resolution Strategies](#resolution-strategies)
- [Progress Tracking](#progress-tracking)
- [Error Handling](#error-handling)
- [Validation](#validation)

## Overview

The import/export functionality enables threat model portability, backup, and migration between Dethernety instances.

**Source Files:**
- Monolithic Export: `packages/dt-core/src/dt-export/dt-export.ts`
- Monolithic Import: `packages/dt-core/src/dt-import/dt-import.ts`
- Split Export: `packages/dt-core/src/dt-export/dt-export-split.ts`
- Split Import: `packages/dt-core/src/dt-import/dt-import-split.ts`
- Schema definitions: `packages/dt-core/src/schemas/`

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Import/Export Data Flow                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────┐                    ┌─────────────────────┐     │
│  │    Source Model     │                    │   Target Instance   │     │
│  │   (Graph Database)  │                    │   (Graph Database)  │     │
│  └──────────┬──────────┘                    └──────────▲──────────┘     │
│             │                                          │                │
│             ▼                                          │                │
│  ┌─────────────────────┐                    ┌─────────────────────┐     │
│  │  DtExport /         │                    │  DtImport /         │     │
│  │  DtExportSplit      │                    │  DtImportSplit      │     │
│  └──────────┬──────────┘                    └──────────▲──────────┘     │
│             │                                          │                │
│             ▼                                          │                │
│  ┌──────────────────────┐            ┌──────────────────────┐          │
│  │  Monolithic Format   │    OR      │  Split-File Format   │          │
│  │  (single JSON file)  │            │  (multiple files)    │          │
│  └──────────────────────┘            └──────────────────────┘          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Model Formats

Two serialization formats are supported. Both represent the same data and can be converted between each other.

### Monolithic Format (v1 compatible)

A single JSON file containing the entire model with inline attributes. This is the original format, backward-compatible with v1 exports.

```json
{
  "name": "My Model",
  "defaultBoundary": {
    "id": "boundary-1",
    "name": "Root",
    "components": [ ... ],
    "boundaries": [ ... ],
    "attributes": { ... }
  },
  "dataFlows": [ ... ],
  "dataItems": [ ... ],
  "modules": [ ... ]
}
```

**Use `MonolithicModel` type** — see `packages/dt-core/src/schemas/model.schema.ts`.

### Split-File Format (v2)

Multiple files designed for git-friendly workflows and AI agent updates. Attributes are stored separately to reduce merge conflicts and keep diffs focused.

```
model-directory/
├── manifest.json        # Model metadata and file references
├── structure.json       # Hierarchy (boundaries + components, no attributes)
├── dataflows.json       # Data flow connections
├── data-items.json      # Data classification items
└── attributes/          # Element attributes (per-element files in type subfolders)
    ├── boundaries/
    │   └── {elementId}.json
    ├── components/
    │   └── {elementId}.json
    ├── dataFlows/
    │   └── {elementId}.json
    └── dataItems/
        └── {elementId}.json
```

**Use `SplitModel` type** — see `packages/dt-core/src/schemas/model.schema.ts`.

### Converting Between Formats

```typescript
import { monolithicToSplit, splitToMonolithic } from 'dt-core/schemas'

// Convert monolithic → split
const splitModel = monolithicToSplit(monolithicModel)

// Convert split → monolithic
const monolithicModel = splitToMonolithic(splitModel)
```

---

## Schema Package

All type definitions and validation logic live in `packages/dt-core/src/schemas/`:

| File | Purpose |
|------|---------|
| `common.schema.ts` | Shared types (`UUID`, `ComponentType`, `ClassReference`, `Attributes`, etc.) |
| `manifest.schema.ts` | `ModelManifest`, `FileReferences`, `DEFAULT_FILE_NAMES` |
| `structure.schema.ts` | `ModelStructure`, `StructureBoundary`, `StructureComponent`, hierarchy utilities |
| `dataflows.schema.ts` | `DataFlow`, validation, adjacency list builder |
| `data-items.schema.ts` | `DataItem`, usage analysis, orphan detection |
| `attributes.schema.ts` | `ConsolidatedAttributesFile`, `ElementAttributes`, merge/get/set utilities |
| `model.schema.ts` | `MonolithicModel`, `SplitModel`, conversion functions, `validateMonolithicModel` |
| `index.ts` | Re-exports all types and functions |

### Key Types

```typescript
// Monolithic format
interface MonolithicModel {
  id?: UUID | null
  name: string
  description?: string
  defaultBoundary: MonolithicBoundary
  dataFlows?: MonolithicDataFlow[]
  dataItems?: MonolithicDataItem[]
  modules?: ModuleReference[]
}

// Split format
interface SplitModel {
  manifest: ModelManifest
  structure: ModelStructure
  dataFlows: DataFlow[]
  dataItems: DataItem[]
  attributes: ConsolidatedAttributesFile
}

// Manifest (root of split format)
interface ModelManifest {
  schemaVersion: '2.0.0'
  format: 'split' | 'monolithic'
  model: ModelMetadata
  files?: FileReferences
  modules: ModuleReference[]
  checksum?: string
  exportedAt?: string
}
```

---

## Export Process

### Monolithic Export — DtExport

```typescript
class DtExport {
  constructor(apolloClient: ApolloClient<NormalizedCacheObject>)

  exportModel(modelId: string): Promise<ExportedModel>
  exportAndDownload(modelId: string, filename?: string): Promise<void>
}
```

### Split Export — DtExportSplit

```typescript
class DtExportSplit {
  constructor(apolloClient: ApolloClient<NormalizedCacheObject>)

  exportModelToSplit(modelId: string): Promise<SplitModel>
}
```

Internally, `DtExportSplit` calls `DtExport.exportModel()` to get the monolithic data, then converts it to split format using `monolithicToSplit()`.

### Export Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Export Steps                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. Fetch Model                                                         │
│     └── dtModel.getModelData({ modelId })                               │
│         └── Returns: model metadata, default boundary                   │
│                                                                         │
│  2. Process Data Items                                                  │
│     └── For each data item:                                             │
│         ├── Fetch class data                                            │
│         └── Fetch instantiation attributes                              │
│                                                                         │
│  3. Process Boundary Hierarchy                                          │
│     └── Recursively process defaultBoundary:                            │
│         ├── Enrich boundary with class data                             │
│         ├── Process nested components                                   │
│         │   ├── Fetch class data                                        │
│         │   ├── Fetch attributes                                        │
│         │   └── Fetch represented model (if any)                        │
│         └── Process nested boundaries (recursive)                       │
│                                                                         │
│  4. Process Data Flows                                                  │
│     └── For each data flow:                                             │
│         ├── Fetch class data                                            │
│         ├── Fetch instantiation attributes                              │
│         └── Resolve data item references                                │
│                                                                         │
│  5. Include Modules                                                     │
│     └── Add module references with IDs and names                        │
│                                                                         │
│  6. Clean Output                                                        │
│     └── Remove __typename fields                                        │
│                                                                         │
│  For split format:                                                      │
│  7. Separate attributes from structure into ConsolidatedAttributesFile  │
│  8. Build manifest with file references                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Import Process

### Monolithic Import — DtImport

```typescript
class DtImport {
  constructor(apolloClient: ApolloClient<NormalizedCacheObject>)

  importModel(jsonData: any, options?: ImportOptions): Promise<ImportResult>
}

interface ImportOptions {
  folderId?: string
  onProgress?: (progress: ImportProgress) => void
}

interface ImportResult {
  success: boolean
  model?: Model
  errors: ImportError[]
  warnings: string[]
  progress: ImportProgress
}
```

### Split Import — DtImportSplit

```typescript
class DtImportSplit {
  constructor(apolloClient: ApolloClient<NormalizedCacheObject>)

  importSplitModel(
    splitModel: SplitModel,
    options?: ImportSplitOptions
  ): Promise<ImportSplitResult>
}

interface ImportSplitOptions extends ImportOptions {
  validateBeforeImport?: boolean  // default: true
}

interface ImportSplitResult extends ImportResult {
  idMapping: Map<string, string>  // reference ID → server ID
}
```

`DtImportSplit` validates the split model, converts it to monolithic format via `splitToMonolithic()`, then delegates to `DtImport.importModel()`. It returns the ID mapping so callers (e.g., the MCP server) can update source files with server-generated IDs.

### Import Steps (8 Total)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Import Steps                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Step 1: Validation (12.5%)                                             │
│  └── Validate JSON structure                                            │
│      ├── Check required fields (name, defaultBoundary)                  │
│      └── Validate data types and references                             │
│                                                                         │
│  Step 2: Create Model (25%)                                             │
│  └── Create new model with resolved modules                             │
│      ├── Resolve module IDs (by ID → by name → default)                 │
│      └── dtModel.createModel({ name, description, modules, folderId })  │
│                                                                         │
│  Step 3: Setup Default Boundary (37.5%)                                 │
│  └── Configure the auto-created default boundary                        │
│      ├── Get default boundary ID from created model                     │
│      ├── Map JSON boundary ID → created boundary ID                     │
│      ├── Update boundary properties                                     │
│      └── Resolve and set boundary class                                 │
│                                                                         │
│  Step 4: Create Hierarchy (50%)                                         │
│  └── Recursively process boundaries and components                      │
│      ├── Create nested boundaries                                       │
│      │   ├── Resolve class IDs                                          │
│      │   ├── Set attributes                                             │
│      │   └── Map old ID → new ID                                        │
│      └── Create components                                              │
│          ├── Resolve class IDs                                          │
│          ├── Set attributes                                             │
│          ├── Link represented model (if any)                            │
│          └── Map old ID → new ID                                        │
│                                                                         │
│  Step 5: Create Data Flows (62.5%)                                      │
│  └── Create edges between components                                    │
│      ├── Resolve source/target IDs using mapping                        │
│      ├── Resolve class IDs                                              │
│      ├── Set attributes                                                 │
│      └── Map old ID → new ID                                            │
│                                                                         │
│  Step 6: Create Data Items (75%)                                        │
│  └── Create data classifications                                        │
│      ├── Resolve class IDs                                              │
│      ├── Link to elements using mapped IDs                              │
│      └── Map old ID → new ID                                            │
│                                                                         │
│  Step 7: Associate Controls (87.5%)                                     │
│  └── Process deferred control associations                              │
│      ├── Resolve control IDs (id → exact name → unique case-insens.)    │
│      └── Link controls to elements                                      │
│                                                                         │
│  Step 8: Complete (100%)                                                │
│  └── Return result with model, errors, warnings                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## ID Mapping

During import, original IDs are mapped to newly created IDs:

```typescript
// Internal state
private idMapping: Map<string, string> = new Map()

// Usage during hierarchy creation
const originalBoundaryId = jsonBoundary.id      // e.g., "boundary-123"
const createdBoundary = await dtBoundary.createBoundaryNode(...)
const newBoundaryId = createdBoundary.id        // e.g., "uuid-abc-def"

this.idMapping.set(originalBoundaryId, newBoundaryId)

// Later: resolve references
const dataFlow = jsonData.dataFlows[0]
const sourceId = this.idMapping.get(dataFlow.source.id)  // Resolves to new ID
const targetId = this.idMapping.get(dataFlow.target.id)
```

### Mapping Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           ID Mapping                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  JSON Data                          Created Elements                    │
│  ──────────                         ────────────────                    │
│                                                                         │
│  boundary-001 ─────────────────────▶ uuid-aaa-111                       │
│       │                                  │                              │
│       └── component-001 ───────────▶ uuid-bbb-222                       │
│       └── component-002 ───────────▶ uuid-ccc-333                       │
│       └── boundary-002 ────────────▶ uuid-ddd-444                       │
│               │                          │                              │
│               └── component-003 ───▶ uuid-eee-555                       │
│                                                                         │
│  dataflow-001 ─────────────────────▶ uuid-fff-666                       │
│    source: component-001 ──────────▶ uuid-bbb-222 (resolved)            │
│    target: component-002 ──────────▶ uuid-ccc-333 (resolved)            │
│                                                                         │
│  dataitem-001 ─────────────────────▶ uuid-ggg-777                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

`DtImportSplit` exposes the ID mapping in its result, enabling callers to update source files with server-generated IDs after import.

---

## Boundary Zoning and Conduits

A boundary's **zoning intent** (`zone` / `domains` / `planes`) and its declared **conduit** edges round-trip through import, update, and export **clobber-safe** — a model that carries no zoning imports and exports cleanly, and a re-sync neither invents zoning nor duplicates conduit edges. The field shapes are in [Domain Model — Boundary Zoning](./DOMAIN_MODEL.md#boundary-zoning); the trust-model semantics are in [dethereal/TRUST_ZONING.md](../dethereal/TRUST_ZONING.md); this section covers only how they are threaded through the serialization paths.

**Source files:** `dt-import/dt-import.ts`, `dt-update/dt-update.ts` (mutable re-sync), `dt-export/dt-export-split.ts`, and the `DUMP_MODEL_DATA` selection in `dt-model/dt-model-gql.ts`.

### The wire selection

`DUMP_MODEL_DATA` (used by `getModelData`, which feeds both export and the update baseline) selects `zone`, `domains`, `planes`, and the `outboundConduitsConnection` / `inboundConduitsConnection` edge reads on **both** the default boundary and every descendant boundary. Every zoning-carrying read therefore comes from the same selection.

### Zoning scalars (zone / domains / planes)

The three scalars ride the boundary create and update passes:

- On **import**, they are passed at boundary creation, and a follow-up boundary update writes them for the auto-created default boundary. Both `DtImport` and `DtUpdate` **guard** the write: a boundary that declares none of `zone` / `domains` / `planes` incurs no extra mutation (`boundaryData.zone !== undefined || domains !== undefined || planes !== undefined`), so a zoneless model produces no spurious zoning writes.
- The values reach the graph through [`DtBoundary.updateBoundaryNode`](./GRAPHQL_OPERATIONS.md#dtboundary), whose **partial-update semantics** emit a `{ set }` for a scalar only when its key is present on the node data. An absent key leaves the field untouched; an explicit `null` / `[]` still writes (a deliberate clear/inherit). This is what protects the controls/data-item association passes — which rebuild node data without zoning — from clobbering fields the boundary already carries.

### Conduits — a dedicated final pass

Conduits reference peer boundaries by `peerId`, and a peer is frequently created *later* in the hierarchy walk. So conduit writes are **not** interleaved with boundary creation; they run in a single pass (`associateConduitsWithBoundaries`) **after every boundary exists and every id is mapped**:

- **Import** runs the pass after the hierarchy, data items, and controls are in place (it is folded into the final step rather than adding a numbered step). Its baseline is empty — every surviving edge is a fresh `connect`.
- **Update** runs the pass after every boundary is created/updated/mapped and **before** orphan deletion (a conduit peer that is about to be deleted must not be connected). Its baseline is the fetched **server** state, flattened per boundary via `flattenConduits`, so an unchanged edge is **not** re-connected.

Both paths write **OUTBOUND-canonical**: `prepareConduitsForWrite` keeps only the OUTBOUND end of each physical edge (translating each `peerId` through the id mapping and dropping — with a warning — any peer that does not resolve), and the baseline is filtered to OUTBOUND before the delta so the INBOUND mirror is never disconnected. Because the graph `CONDUIT` `connect` is not idempotent, this delta-against-baseline discipline (see [`buildConduitOps`](./DATA_ACCESS_LAYER.md#buildconduitops--baseline-delta-reconcile)) is what keeps a re-sync from accumulating duplicate parallel edges. The conduit-carrying update deliberately **omits** controls / data items / zoning so the pass leaves those untouched.

### Export (split)

`DtExportSplit` re-derives conduits from the raw connection reads via `flattenConduits`, and writes each zoning field **only when it carries a value** — `zone` only when non-null, `domains` / `planes` / `conduits` only when non-empty. A zoneless boundary therefore serializes with no zoning keys at all, closing the round-trip: nothing written on export, nothing to clobber on the next import.

---

## Resolution Strategies

### Module Resolution (3-level priority)

```typescript
private resolveModuleIds = async (modules: any[]): Promise<string[]> => {
  const availableModules = await this.dtModule.getModules()

  for (const moduleData of modules) {
    // Priority 1: Match by ID
    if (moduleData.id) {
      const match = availableModules.find(m => m.id === moduleData.id)
      if (match) { moduleIds.push(match.id); continue }
    }

    // Priority 2: Match by name
    if (moduleData.name) {
      const match = availableModules.find(m => m.name === moduleData.name)
      if (match) { moduleIds.push(match.id); continue }
    }

    // No match: add warning
    this.warnings.push(`Could not find module: ${moduleData.name || moduleData.id}`)
  }

  // Fallback: use first available module
  if (moduleIds.length === 0 && availableModules.length > 0) {
    moduleIds.push(availableModules[0].id)
    this.warnings.push('No matching modules found, using default module')
  }

  return moduleIds
}
```

### Class Resolution (3-level priority)

Implemented by `ClassResolver` in [`class-resolver.ts`](../../../packages/dt-core/src/dt-class/class-resolver.ts), which import (`DtImport.resolveClass`) and update (`DtUpdate`) share. Each run creates one resolver; it fetches the module catalogue once, walks three priorities in order, and returns an unresolved-class warning instead of an id if all of them miss.

```typescript
resolve = async (
  classData: ExportedClassData,
  kind: 'COMPONENT' | 'BOUNDARY' | 'DATA_FLOW' | 'DATA'
): Promise<{ id: string } | { id: null; warning: string }> => {
  const modules = await this.catalog()  // fetched once per resolver; [] if the fetch failed
  const classesOf = CLASSES_OF[kind]    // componentClasses | securityBoundaryClasses | dataFlowClasses | dataClasses

  // Priority 1: Match by ID across all modules (id lookup is enough — class
  // ids are globally unique within a deployment).
  if (classData.id && modules.some(m => classesOf(m)?.some(c => c.id === classData.id))) {
    return { id: classData.id }
  }

  // Priority 2: Match by module ID + class name. Reaches the right module
  // even when ids have been re-keyed (e.g. by `migrateClassId` or a strict-
  // mode rebind resolved with `adopt-module-id`).
  // Priority 3: Match by module name + class name. The graceful fallback
  // when both id and module id have moved.
  // (Each finds the module, then the class of that kind with that name.)

  // No match: an export's id may no longer exist here (a migrated id), and
  // Priority 2/3 are unreachable when the export omitted `module`.
  return {
    id: null,
    warning:
      `Could not resolve ${kind.toLowerCase()} class ` +
      `(id=${classData.id ?? '<missing>'}, name=${classData.name ?? '<missing>'}, ` +
      `module=${classData.module?.name ?? classData.module?.id ?? '<missing from export>'}); ` +
      `instance will be created without an IS_INSTANCE_OF edge.`,
  }
}
```

**What each caller does with a miss.** Silently dropping a class link is a real failure mode, so neither caller does:

- **Import** — `DtImport.resolveClass` adds the warning to the import result and creates the element without an `IS_INSTANCE_OF` edge and without its answers. If the catalogue cannot be fetched, every class misses and warns.
- **Update** — `DtUpdate` resolves every element's class on a copy of the update data after reading the existing model and before its first write. A class found by name replaces the id in the copy. A miss removes the element's `classData`, which leaves its current binding and answers untouched, and adds the warning prefixed with the element (`Component "Orders DB": …`) and ending `it keeps its current class binding and answers.` (for an element the update creates: `it is created without a class, and its answers are not written.`) If the catalogue cannot be fetched, update skips resolution and uses the ids as written.

For how the push paths surface these warnings and the errors that remain, see [Sync Architecture → Class Resolution on Push](../dethereal/SYNC_AND_SOURCE_OF_TRUTH.md#class-resolution-on-push).

**`ExportedClassData` shape** — the disambiguator that makes Priority 2/3 reachable:

```typescript
// packages/dt-core/src/dt-export/dt-export.ts
export interface ExportedClassData {
  id: string
  name: string
  module?: Pick<Module, 'id' | 'name'>   // origin module — required for re-keyed-id fallback
}
```

Every `classData` written by `DtExport` (and `DtExportSplit`) carries `module: { id, name }` for components, boundaries, data flows, and data items. PR #225 closed the gap where some export paths emitted `classData` without the `module` reference — without that field, an export taken before a `migrateClassId` could not be re-imported after the rebind, because Priority 1 misses on the stale id and Priority 2/3 have nothing to match against.

### Control Resolution

Import and update resolve control references through one `ControlResolver` (`packages/dt-core/src/dt-control/control-resolver.ts`), which fetches the control catalog once per run:

1. **Id** — a control with that id.
2. **Exact name** — attached only when exactly one control has that name.
3. **Name ignoring case and surrounding spaces** — attached only when exactly one control matches.

There is no partial-name match: a reference to "Firewall" does not attach "Perimeter Firewall". A reference that matches no control, or a name that several controls share, attaches nothing; it is reported in the result's `unresolvedControls` (`reason: 'not_found' | 'ambiguous'`, with the candidate controls for an ambiguous one, and `owner`: the model or the boundary, component or data flow it came from, by its id in the model file) and in a warning, which names the model or element and lists an ambiguous reference's candidate ids.

On update, a name several controls share never removes a control: if the element (or the model) already has one or more of the candidates, they stay attached and a warning says so, and the reference is not reported as unresolved. Only when it has none of them is the reference reported.

When the catalog could not be fetched in full (the all-folders fetch failed), an update leaves every element's controls as they are and reports one `resolve_controls` error. An import attaches only by id, since a name unique among the controls that were fetched may be shared by one in a folder; it reports every other reference with `reason: 'catalog_unavailable'`.

Dethereal's push rewrites the local model files from the platform afterwards. It writes each entry of `unresolvedControls` back to the `controls[]` of its owner, as the local file has it (including fields such as `source`), so an unresolved reference stays in `manifest.json`, `structure.json` or `dataflows.json` until it is pinned by id or removed. A reference whose element is no longer in the model is named in a warning instead.

---

## Progress Tracking

### Progress Interface

```typescript
interface ImportProgress {
  currentStep: number   // 1-8
  totalSteps: number    // 8
  stepName: string      // Human-readable step description
  percentage: number    // 0-100
}
```

### Progress Callback

```typescript
const result = await dtImport.importModel(jsonData, {
  folderId: 'folder-123',
  onProgress: (progress) => {
    console.log(`[${progress.percentage}%] ${progress.stepName}`)
  }
})
```

### Step Names

| Step | Name | Percentage |
|------|------|------------|
| 1 | Validating import data | 12.5% |
| 2 | Creating model | 25% |
| 3 | Setting up default boundary | 37.5% |
| 4 | Creating boundaries and components | 50% |
| 5 | Creating data flows | 62.5% |
| 6 | Creating data items | 75% |
| 7 | Associating controls | 87.5% |
| 8 | Import completed | 100% |

---

## Error Handling

### Error Structure

```typescript
interface ImportError {
  step: string          // Which step failed
  elementName?: string  // Element being processed
  elementId?: string    // Element ID
  error: string         // Error message
  details?: any         // Additional context
}
```

### Error Collection

Errors are collected throughout import rather than failing immediately:

```typescript
// Non-fatal error: add to list and continue
this.errors.push({
  step: 'hierarchy_creation',
  elementName: componentData.name,
  elementId: componentData.id,
  error: 'Failed to resolve class ID'
})

// Final result includes all errors
return {
  success: this.errors.length === 0,
  model: createdModel,
  errors: this.errors,
  warnings: this.warnings,
  progress: this.progress
}
```

### Warning vs Error

| Type | When Used | Impact |
|------|-----------|--------|
| **Warning** | Non-critical issue (e.g., using default module) | Import continues, result.success = true |
| **Error** | Element creation failed | Import continues, result.success = false |
| **Exception** | Critical failure (e.g., invalid JSON) | Import stops immediately |

---

## Validation

### Monolithic Model Validation

```typescript
import { validateMonolithicModel } from 'dt-core/schemas'

const result = validateMonolithicModel(model)
if (!result.valid) {
  console.error('Errors:', result.errors)
}
if (result.warnings.length > 0) {
  console.warn('Warnings:', result.warnings)
}
```

Checks performed:
- Model name is required
- Default boundary is required with a valid ID
- Data flow source/target references must exist in the hierarchy
- Data item references are validated (orphaned refs produce warnings)

### Split Model Validation

`DtImportSplit` validates before import (opt-out via `validateBeforeImport: false`):
- Manifest must exist with a model name
- Structure must exist with a default boundary ID
- Data flow source/target references must exist in the structure hierarchy

### Complete Monolithic Schema Example

```json
{
  "id": "model-123",
  "name": "E-Commerce Platform",
  "description": "Security model for online store",

  "modules": [
    { "id": "module-web", "name": "Web Application Module" }
  ],

  "defaultBoundary": {
    "id": "boundary-root",
    "name": "System Boundary",
    "description": "Root boundary",
    "positionX": 0,
    "positionY": 0,
    "dimensionsWidth": 1000,
    "dimensionsHeight": 800,
    "classData": { "id": "class-network", "name": "Network Zone" },
    "attributes": { "zone_type": "external" },

    "components": [
      {
        "id": "comp-web",
        "name": "Web Server",
        "description": "Frontend server",
        "type": "PROCESS",
        "positionX": 100,
        "positionY": 100,
        "classData": { "id": "class-web", "name": "Web Server" },
        "attributes": { "technology": "nginx" },
        "dataItemIds": ["data-user"]
      }
    ],

    "boundaries": [
      {
        "id": "boundary-dmz",
        "name": "DMZ",
        "description": "Demilitarized zone",
        "positionX": 50,
        "positionY": 50,
        "dimensionsWidth": 400,
        "dimensionsHeight": 300,
        "components": [],
        "boundaries": []
      }
    ]
  },

  "dataFlows": [
    {
      "id": "flow-1",
      "name": "HTTP Request",
      "description": "User requests",
      "source": { "id": "comp-client" },
      "target": { "id": "comp-web" },
      "classData": { "id": "class-http", "name": "HTTP Traffic" },
      "dataItemIds": ["data-request"]
    }
  ],

  "dataItems": [
    {
      "id": "data-user",
      "name": "User Credentials",
      "description": "Username and password",
      "classData": { "id": "class-pii", "name": "PII Data" }
    }
  ]
}
```
