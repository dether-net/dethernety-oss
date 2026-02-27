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
- [DtControl](#dtcontrol)
- [DtFolder](#dtfolder)
- [DtAnalysis](#dtanalysis)
- [DtIssue](#dtissue)
- [MITRE Framework Classes](#mitre-framework-classes)

## Overview

Each domain area in dt-core has a dedicated class that encapsulates GraphQL operations. Classes follow a consistent pattern:

1. **Constructor** - Accepts GraphQL client (ApolloClient for TypeScript, GQL Client for Python)
2. **Query methods** - Read operations (get*, find*, dump*)
3. **Mutation methods** - Write operations (create*, update*, delete*)
4. **Helper methods** - Domain-specific utilities

**File Naming Convention:**
- `dt-{domain}.ts` / `dt_{domain}.py` - Class implementation
- `dt-{domain}-gql.ts` / `dt_{domain}_gql.py` - GraphQL definitions

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
| `updateComponentClass` | Change component classification | `{ componentId, classId }` | `Promise<void>` |
| `updateComponentRepresentedModel` | Link to represented model | `{ componentId, modelId }` | `Promise<void>` |
| `getComponentRepresentedModel` | Get linked model | `{ componentId }` | `Promise<Model \| null>` |
| `deleteComponent` | Delete component | `{ componentId }` | `Promise<boolean>` |

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

// Link component to another model (composition)
await dtComponent.updateComponentRepresentedModel({
  componentId: 'comp-123',
  modelId: 'other-model-456'
})
```

---

## DtBoundary

**Source:** `packages/dt-core/src/dt-boundary/`

Manages security boundaries and trust zones.

### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `createBoundaryNode` | Create new boundary | `{ newNode, classId, parentBoundaryId }` | `Promise<Node \| null>` |
| `updateBoundaryNode` | Update boundary properties | `{ boundaryId, name?, description?, x?, y?, width?, height? }` | `Promise<BoundaryData>` |
| `updateBoundaryClass` | Change boundary classification | `{ boundaryId, classId }` | `Promise<void>` |
| `updateBoundaryRepresentedModel` | Link to represented model | `{ boundaryId, modelId }` | `Promise<void>` |
| `getBoundaryRepresentedModel` | Get linked model | `{ boundaryId }` | `Promise<Model \| null>` |
| `getDescendants` | Get direct children | `{ boundaryId }` | `Promise<DirectDescendant[]>` |
| `deleteBoundary` | Delete boundary | `{ boundaryId }` | `Promise<boolean>` |

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
  parentBoundaryId: 'root-boundary-123'
})

// Update boundary dimensions
await dtBoundary.updateBoundaryNode({
  boundaryId: 'boundary-456',
  width: 500,
  height: 400
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
| `updateDataFlowClass` | Change data flow classification | `{ dataFlowId, classId }` | `Promise<void>` |
| `deleteDataFlow` | Delete data flow | `{ dataFlowId }` | `Promise<boolean>` |

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

// Update flow classification
await dtDataflow.updateDataFlowClass({
  dataFlowId: flow.id,
  classId: 'class-encrypted-connection'
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
| `updateDataItem` | Update data item | `{ dataItemId, name?, description?, classId? }` | `Promise<DataItem>` |
| `deleteDataItem` | Delete data item | `{ dataItemId }` | `Promise<boolean>` |

---

## DtClass

**Source:** `packages/dt-core/src/dt-class/`

Manages entity classifications and templates.

### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `getComponentClass` | Get component's classification | `{ componentId }` | `Promise<Class \| null>` |
| `getBoundaryClass` | Get boundary's classification | `{ boundaryId }` | `Promise<Class \| null>` |
| `getDataFlowClass` | Get data flow's classification | `{ dataFlowId }` | `Promise<Class \| null>` |
| `getDataClass` | Get data class by ID | `{ classId }` | `Promise<Class \| null>` |
| `getControlClasses` | Get available control classes | `{ moduleId }` | `Promise<Class[]>` |
| `getControlClassById` | Get specific control class | `{ classId }` | `Promise<Class \| null>` |
| `setInstantiationAttributes` | Set element attributes from class | `{ elementId, elementType, attributes }` | `Promise<void>` |
| `getAttributesFromClassRelationship` | Get instantiation attributes | `{ elementId, elementType }` | `Promise<object \| null>` |

### Special Handling

The DtClass implementation includes special handling for:
- **Base64-encoded YAML guides** - Automatically decoded and parsed
- **Malformed data** - Graceful degradation with warnings
- **Template schema extraction** - Parses JSONForms schema/uischema

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

## DtControl

**Source:** `packages/dt-core/src/dt-control/`

Manages security controls.

### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `getControls` | Get all controls | `{ folderId?: string }` | `Promise<Control[]>` |
| `createControl` | Create new control | `{ name, description, folderId }` | `Promise<Control>` |
| `updateControl` | Update control | `{ controlId, name?, description?, controlClasses? }` | `Promise<Control>` |
| `deleteControl` | Delete control | `{ controlId }` | `Promise<boolean>` |

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

| Method | Description | Returns |
|--------|-------------|---------|
| `getExposures` | Get all exposures | `Promise<Exposure[]>` |
| `getExposureById` | Get exposure by ID | `Promise<Exposure \| null>` |
| `searchExposures` | Search by criteria | `Promise<Exposure[]>` |

### DtCountermeasure

**Source:** `packages/dt-core/src/dt-countermeasure/`

| Method | Description | Returns |
|--------|-------------|---------|
| `getCountermeasures` | Get all countermeasures | `Promise<Countermeasure[]>` |
| `getCountermeasureById` | Get by ID | `Promise<Countermeasure \| null>` |
| `searchCountermeasures` | Search by criteria | `Promise<Countermeasure[]>` |
