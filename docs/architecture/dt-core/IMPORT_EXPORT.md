# Import/Export

## Table of Contents
- [Overview](#overview)
- [Model Formats](#model-formats)
- [Schema Package](#schema-package)
- [Export Process](#export-process)
- [Import Process](#import-process)
- [ID Mapping](#id-mapping)
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
│      ├── Resolve control IDs (exact → case-insensitive → partial)       │
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

```typescript
private resolveClassId = async (
  classData: any,
  classType: 'component' | 'boundary' | 'dataflow' | 'data'
): Promise<string | null> => {
  // Priority 1: Match by ID
  if (classData.id) {
    const exists = await this.dtClass.getClassById({ classId: classData.id })
    if (exists) return classData.id
  }

  // Priority 2: Match by module ID + class name
  if (classData.name && classData.moduleId) {
    const moduleClasses = await this.dtClass.getClassesByModule({
      moduleId: classData.moduleId,
      classType
    })
    const match = moduleClasses.find(c => c.name === classData.name)
    if (match) return match.id
  }

  // Priority 3: Match by module name + class name
  if (classData.name && classData.moduleName) {
    const module = await this.dtModule.getModuleByName({
      moduleName: classData.moduleName
    })
    if (module) {
      const moduleClasses = await this.dtClass.getClassesByModule({
        moduleId: module.id,
        classType
      })
      const match = moduleClasses.find(c => c.name === classData.name)
      if (match) return match.id
    }
  }

  // No match
  this.warnings.push(`Could not resolve class: ${classData.name || classData.id}`)
  return null
}
```

### Control Resolution (4-level fuzzy matching)

```typescript
private resolveControlId = async (controlData: any): Promise<string | null> => {
  const availableControls = await this.dtControl.getControls()

  // Priority 1: Exact ID match
  // Priority 2: Exact name match
  // Priority 3: Case-insensitive name match
  // Priority 4: Partial name match (substring)

  this.warnings.push(`Could not resolve control: ${controlData.name || controlData.id}`)
  return null
}
```

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
