# GraphQL Operations

## Table of Contents
- [Overview](#overview)
- [Shared Write Contracts](#shared-write-contracts)
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
- [DtExposure](#dtexposure)
- [DtCountermeasure](#dtcountermeasure)
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

## Shared Write Contracts

Two contracts govern the element update writers — `DtModel.updateModel`, `DtComponent.updateComponent`,
`DtBoundary.updateBoundaryNode`, `DtDataflow.updateDataFlow`, and `DtDataItem.updateDataItem`. They are
what lets a caller send only the fields a user actually edited instead of the whole element it last
loaded, and they are what stops one person's save from rewriting a field somebody else just changed.
**Presence gating** holds for all five; **link deltas** apply to the four that carry `controls` /
`dataItems` lists.

The caller's half of the same story — how a store decides what counts as edited, and why the
relationship baseline must be captured **before** the optimistic merge — is in
[Flow Store — Narrowing the Write](../frontend/LLD/FLOW_STORE.md#narrowing-the-write). This section is
the writer's half: what dt-core does with the input it is handed.

### Presence gating — a field the element does not define is not written

**Source:** `packages/dt-core/src/dt-component/dt-component.ts` → `updateComponent`

Every key of an update input is emitted only when the field it carries is **defined** on the element.
`updateComponent` is the clearest example:

```typescript
const controlsInput = linkInput(updatedNode.data?.controls, baselineLinks, 'controls')
const dataItemsInput = linkInput(updatedNode.data?.dataItems, baselineLinks, 'dataItems')

const variables = {
  componentId: updatedNode.id,
  input: {
    ...(updatedNode.data?.label !== undefined && { name: { set: updatedNode.data.label } }),
    ...(updatedNode.data?.description !== undefined && { description: { set: updatedNode.data.description } }),
    ...(updatedNode.position !== undefined && {
      positionX: { set: updatedNode.position.x },
      positionY: { set: updatedNode.position.y },
    }),
    ...(updatedNode.type !== undefined && { type: { set: updatedNode.type } }),
    ...crownJewelInput,
    ...(controlsInput !== undefined && { controls: controlsInput }),
    ...(dataItemsInput !== undefined && { dataItems: dataItemsInput }),
  },
}
```

Two details in that block are load-bearing rather than stylistic:

- **The two position axes are one compound value and are gated together.** A node carrying no
  `position` at all would otherwise throw on `.x`; reading the axes *inside* the guard is what makes
  that safe, because the object literal is never evaluated when the guard is false.
- **The parent guard is a different kind of guard.** `parentBoundary.connect` filters on an `eq` built
  from `parentNode`, and an undefined one produces a filter with **no condition** — which does not match
  nothing, it matches every boundary, after the unconditional `disconnect` beside it has already run. An
  *empty* parent is the other case and is a real edit meaning "put me at the root", i.e. the default
  boundary. That can only be honoured while the root is known, so an unresolved default boundary refuses
  rather than emitting a filter that matches nothing. `DtBoundary.updateBoundaryNode` builds its parent
  input the same way, and `DtDataflow.updateDataFlow` gates its `source` / `target` endpoints on the same
  reasoning — with no root to fall back to, a named-but-empty endpoint refuses outright.

The id validation behind those filters lives in `packages/dt-core/src/dt-utils/connect-id.ts`
(`isConnectId`, `connectIds`, `assertConnectId`, `UnresolvedIdError`). The rule it enforces is that a
relationship operation is built from a validated non-empty id or it is not built at all, with two
answers because the two situations differ: a **scalar** *is* the edit, so it refuses; an **array
element** names one item among many, so it is dropped and the rest of the write stands.

### Link deltas — `controls` and `dataItems`

**Source:** `packages/dt-core/src/dt-utils/link-delta.ts` → `linkInput`, `buildLinkOps`

The four writers that carry link lists (`updateComponent`, `updateBoundaryNode`, `updateDataFlow` for
`controls` + `dataItems`; `updateModel` for `controls`) all route them through `linkInput`, which decides
the shape of one link key from the list and the caller's `baselineLinks`. There are two different
absences, and collapsing them is the one mistake that turns a bulk write into a delta against nothing:

| List | Baseline | Shape emitted |
|------|----------|---------------|
| absent | — | **Key omitted.** The element does not define this list, so it was not edited and must not be written. The conduit and import "safe node" passes rely on this to preserve associations. |
| present | absent | **Replace:** `{ disconnect: {}, connect: [...ids] }`. The caller is asserting the whole list — correct for an import or a bulk write. |
| present | present | **Delta:** `buildLinkOps(current, baselines[key] ?? [])` — connect only what was added, disconnect only what was removed, and omit the key entirely when nothing changed. A baseline holding nothing for the key is a delta against an empty list, not a missing baseline. |

The replace shape's `disconnect` stays **unconditional** on purpose: `connect` compiles to a bare
relationship `CREATE`, so a disconnect that spared the incoming ids would re-create every
already-attached pair — one extra parallel edge per element per save. It is safe because the translator
emits `disconnect` before `connect` for the same field.

The delta's cost is the mirror of that, and it is taken deliberately: two clients adding the **same** id
at the same moment produce a duplicate edge. A duplicate is additive and invisible on read; a destroyed
attachment is neither. Both sides of the delta are de-duplicated and id-validated first — an unusable id
in the *baseline* would otherwise build a `disconnect` with no condition, clearing every edge of that
type on the element.

Boundary **conduits** get the identical treatment through a different builder — see
[`updateBoundaryNode` — zoning and conduit reconcile](#updateboundarynode--zoning-and-conduit-reconcile)
and [`buildConduitOps`](./DATA_ACCESS_LAYER.md#buildconduitops--baseline-delta-reconcile).

`updateModel`'s asymmetry is worth naming: its `controls` take the delta treatment, its `modules` are
**always** a replace. Nothing edits a model's modules except the push path, which asserts them whole and
has no earlier state to compare against.

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
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐         │   │
│  │  │DtCounter.│  │DtClassId.│  │ DtMitre  │  │DtCtrlLib.│         │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘         │   │
│  │                                                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

`DtExport` and `DtImport` appear above to place them in the hierarchy, but they — together with
`DtUpdate` and the `*Split` siblings of all three — are the model file round-trip and are documented in
[Import & Export](./IMPORT_EXPORT.md) rather than here. `DtControlLibrary` (`DtCtrlLib.` above) has no
section in this document yet.

---

## DtModel

**Source:** `packages/dt-core/src/dt-model/`

Manages threat model lifecycle and data retrieval.

### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `getModels` | Get models in a folder (no `folderId` → models with no folder) | `{ folderId?: string }` | `Promise<Model[]>` |
| `getModel` | Get a single model by ID | `{ modelId: string }` | `Promise<Model \| null>` |
| `getNotRepresentingModels` | Get models not linked as represented | `{ modelId: string }` | `Promise<Model[]>` |
| `dumpModelData` | Export complete model structure, mapped to canvas nodes / edges | `{ modelId: string }` | `Promise<{ currentModel, components, boundaries, dataFlows, dataItems, modules, defaultBoundary }>` |
| `getModelData` | Raw model payload from the same `DUMP_MODEL_DATA` query, unmapped | `{ modelId: string }` | `Promise<any>` |
| `createModel` | Create new model | `{ name, description, modules, folderId, scope?, controls? }` | `Promise<Model>` |
| `updateModel` | Update model properties — presence-gated; `controls` delta, `modules` replace | `{ id, name?, description?, modules?, controls?, folderId?, scope?, baselineLinks? }` | `Promise<Model>` |
| `deleteModel` | Delete model | `{ modelId: string }` | `Promise<{ nodesDeleted, relationshipsDeleted } \| null>` |

> **`updateModel` input.** Only `id` is required; a field that is not supplied is not written (see
> [Shared Write Contracts](#shared-write-contracts)). `folderId` carries three meanings: absent leaves
> the model where it is, a named id moves it, and the **empty string** means the root — which for a model
> is the *absence* of a folder, so it emits `{ disconnect: {} }` and connects nothing. `baselineLinks`
> is what the caller knew `controls` to be before this edit; supplying it turns the control write into a
> delta instead of a whole-list replace.

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
GET_MODELS                   // Query models with a folder filter (also backs getModel)
GET_NOT_REPRESENTING_MODELS  // Find models not linked
DUMP_MODEL_DATA              // Full model export query (backs dumpModelData + getModelData)
CREATE_MODEL                 // Create with modules
UPDATE_MODEL                 // Update properties
DELETE_MODEL                 // Delete by ID
```

`dt-model-gql.ts` also exports `GET_DUMP_MODEL_DATA`, `GET_MODEL_BOUNDARIES`, `GET_MODEL_DATAFLOWS`, and
`GET_MODEL_DATAITEMS`. No `DtModel` method issues them today.

---

## DtComponent

**Source:** `packages/dt-core/src/dt-component/`

Manages system components (processes, services, databases, external entities).

### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `createComponentNode` | Create new component | `{ newNode: Node, classId: string, defaultBoundaryId: string }` | `Promise<Node \| null>` |
| `updateComponent` | Update component properties, parent boundary, and control / data-item links | `{ updatedNode: Node, defaultBoundaryId: string, baselineLinks?: LinkBaselines }` | `Promise<ComponentData \| null>` |
| `getComponentRepresentedModel` | Get linked model | `{ componentId }` | `Promise<Model \| null>` |
| `deleteComponent` | Delete component | `{ componentId }` | `Promise<boolean>` |

> **`updateComponent` takes the node, not a field bag.** There are no `componentId` / `name` / `x` / `y`
> arguments: the caller passes the component **as a `Node`** and the writer reads `id`, `data.label`,
> `data.description`, `data.crownJewel`, `position`, `type`, `parentNode`, `data.controls`, and
> `data.dataItems` off it. Every one of those is presence-gated, so a node carrying only the fields the
> user edited writes only those fields, and `baselineLinks` turns the two link lists into a delta. This
> writer is the reference implementation of both contracts — see
> [Shared Write Contracts](#shared-write-contracts). `defaultBoundaryId` is what an empty `parentNode`
> resolves to.

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

// Rename a component and move it. Only the fields named on the node are written:
// no `data.controls` key means the control association is left untouched.
await dtComponent.updateComponent({
  updatedNode: {
    id: 'comp-123',
    position: { x: 150, y: 250 },
    data: { label: 'Updated Name' },
  },
  defaultBoundaryId: 'root-boundary-123',
})

// Attach one control without disturbing a control another client attached
// concurrently: pass the list plus the baseline this client loaded, and the
// write becomes `connect ctrl-new` rather than disconnect-all + connect-all.
await dtComponent.updateComponent({
  updatedNode: {
    id: 'comp-123',
    data: { controls: ['ctrl-existing', 'ctrl-new'] },
  },
  defaultBoundaryId: 'root-boundary-123',
  baselineLinks: { controls: ['ctrl-existing'] },
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
| `createBoundaryNode` | Create new boundary | `{ newNode: Node, classId: string, defaultBoundaryId: string }` | `Promise<Node \| null>` |
| `updateBoundaryNode` | Update boundary properties, zoning, conduits, and control / data-item links | `{ updatedNode: Node, defaultBoundaryId: string, baselineConduits?: Conduit[], baselineLinks?: LinkBaselines }` | `Promise<BoundaryData \| null>` |
| `getBoundaryRepresentedModel` | Get linked model | `{ boundaryId }` | `Promise<Model \| null>` |
| `getDescendants` | Get direct children | `{ boundaryId }` | `Promise<{ components: DirectDescendant[], securityBoundaries: DirectDescendant[] } \| null>` |
| `deleteBoundary` | Delete boundary | `{ boundaryId }` | `Promise<boolean>` |

> Class / model binding changes route through [`DtClass.changeElementBinding`](#dtclass) — see the DtComponent block above.

#### `updateBoundaryNode` — zoning and conduit reconcile

Like `updateComponent`, this writer takes the boundary **as a `Node`** and presence-gates every field it
reads off it, including the parent guard; and it routes `data.controls` / `data.dataItems` through the
same `linkInput` delta against `baselineLinks`. See [Shared Write Contracts](#shared-write-contracts) for
both. What follows is what is specific to boundaries.

Beyond the position/dimension properties, `updateBoundaryNode` also persists the boundary's **zoning** fields and reconciles its **conduit** edges in the same `updateSecurityBoundaries` mutation. The values are read off `updatedNode.data` and pass through the [boundary zoning utilities](./DATA_ACCESS_LAYER.md#boundary-zoning-utilities) before being sent:

- `zone` — sanitized via `sanitizeZone` (invalid/garbage → `null`).
- `domains` — sanitized via `sanitizeDomains` (trim, drop empties, case-insensitive de-dupe, length/count caps).
- `planes` — normalized via `normalizePlanes` (valid members only, de-duped, canonical order). Persisted as a `[String!]` field — the values are constrained to the `Plane` union app-side, not by a GraphQL enum.

**Conduit reconcile (baseline delta).** Conduits are reconciled **only when** `updatedNode.data.conduits` is present; an `undefined` buffer leaves the edges untouched (the same convention `linkInput` applies to `controls` / `dataItems` — see [Link deltas](#link-deltas--controls-and-dataitems)). When present, the method calls `buildConduitOps('OUTBOUND', …)` and `buildConduitOps('INBOUND', …)` to compute a **delta against `baselineConduits`** — peers added are `connect`-ed, peers removed are `disconnect`-ed, and justification-only changes become `update` ops. This is deliberately a delta and not a connect-all: the graph `CONDUIT` `connect` is **not idempotent**, so re-connecting an existing peer would create a duplicate parallel edge. See [`buildConduitOps`](./DATA_ACCESS_LAYER.md#buildconduitops--baseline-delta-reconcile) for the full rationale.

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
| `createDataFlow` | Create new data flow | `{ newEdge: Edge, classId: string }` | `Promise<Edge \| null>` |
| `updateDataFlow` | Update data flow properties, endpoints, and control / data-item links | `{ edge: Edge, updates: object, baselineLinks?: LinkBaselines }` | `Promise<DataFlowData \| null>` |
| `deleteDataFlow` | Delete data flow | `{ dataFlowId }` | `Promise<boolean>` |

> Class binding changes route through [`DtClass.changeElementBinding`](#dtclass) — see the DtComponent block above.

> **Both methods take the edge, not a field bag.** `createDataFlow` reads `label`, `data.description`,
> `source`, `target`, `sourceHandle`, and `targetHandle` off `newEdge`, and on success writes the
> server-assigned id back onto that same edge before returning it. `updateDataFlow` **deep-merges
> `updates` into `edge` first**, then builds a presence-gated input from the merged edge — so a caller
> that has already merged passes `updates: {}` and the edge stands as the whole of the input. The two
> endpoints are gated for the same reason a parent boundary is, but with one difference: a data flow has
> no root to fall back to, so a named-but-empty `source` / `target` refuses rather than resolving to a
> default. See [Shared Write Contracts](#shared-write-contracts).

### Example Usage

```typescript
const dtDataflow = new DtDataflow(apolloClient)

// Create data flow between components. The edge comes back with the server's id
// written onto it (the same object, mutated in place).
const flow = await dtDataflow.createDataFlow({
  newEdge: {
    id: 'temp-789',
    source: 'component-api',
    target: 'component-database',
    sourceHandle: 'right',
    targetHandle: 'left',
    label: 'Database Queries',
    data: { description: 'SQL queries from API to DB' },
  },
  classId: 'class-sql-query',
})

// Rename the flow. `updates` is merged into `edge` first, so an already-merged
// caller passes `updates: {}`; nothing but `id` and `label` is named here, so
// nothing else is written.
await dtDataflow.updateDataFlow({
  edge: { id: flow.id, label: 'Database Queries (TLS)' },
  updates: {},
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
| `createDataItem` | Create new data item, attached to an element and a model | `{ name, description, elementId, classId: string \| null, modelId, sensitivity?, regulatoryFlags? }` | `Promise<DataItem \| null>` |
| `updateDataItem` | Update data item — bundled binding + residual write. When `classId` is supplied the call routes the binding portion through `DtClass.changeElementBinding` and the residual property update through the auto-generated `updateData` mutation. | `{ dataItemId, name?, description?, classId?, sensitivity?, regulatoryFlags?, attributes? }` | `Promise<UpdateDataItemResult>` |
| `deleteDataItem` | Delete data item | `{ dataItemId }` | `Promise<boolean>` |

> **`updateDataItem` return shape.** `UpdateDataItemResult` is `{ dataItem: DataItem \| null, bindingResult: ChangeElementBindingResult \| null, residualOk: boolean }`. The bundled return surfaces both halves so callers can render partial-failure UX: if the class binding committed but the residual property update failed, `bindingResult.success` is `true`, `dataItem` is `null`, and `residualOk` is `false`. The frontend uses this to fire a separate "settings could not be saved" toast in addition to the class-change delta-receipt snackbar.

> **Asset context is presence-gated, and `null` is not `undefined`.** The residual input emits `name`,
> `description`, `sensitivity`, and `regulatoryFlags` only when the caller supplies them. The two
> asset-context fields are the expensive half of that contract: `sensitivity: null` or
> `regulatoryFlags: []` is a **clear** and has to be said, whereas leaving either out leaves the platform
> value alone. An unrecognised `sensitivity` drops to `null` with a warning rather than failing the save
> — the value typically comes from a file somebody hand-edited. `attributes` is accepted in the argument
> type but is not read by the writer; nothing in the residual mutation writes it.

> **Three states for `classId`.** Truthy targets `CLASS`, explicit `null` targets `NONE` (sweeping
> SYSTEM-derived findings), and **omitted** attempts no binding change at all — `bindingResult` comes
> back `null`. A falsy `dataItemId` short-circuits to `{ dataItem: null, bindingResult: null, residualOk: false }`
> without a round trip.

> **The deduplication key names the fields.** `update-dataitem-<id>-<sorted input keys>` rather than
> `update-dataitem-<id>`: a class pick fires a save without awaiting it, and an id-only key would let a
> **Save** pressed during that flight join it and never be written. `DtModel.updateModel` keys the same way.

---

## DtClass

**Source:** `packages/dt-core/src/dt-class/`

Manages entity classifications, templates, and atomic class / model binding.

### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `changeElementBinding` | Atomically change an element's class / representedModel / none binding (destructive sweep + rewire + constructive upsert). The single sanctioned write path for `IS_INSTANCE_OF` and `REPRESENTS_MODEL` edges. | `{ elementId, target: ClassBinding \| RepresentedModelBinding \| NoBinding }` | `Promise<ChangeElementBindingResult>` |
| `getComponentClass` | Get component's classification | `{ componentId }` | `Promise<Class \| undefined>` |
| `getBoundaryClass` | Get boundary's classification | `{ boundaryId }` | `Promise<Class \| undefined>` |
| `getDataFlowClass` | Get data flow's classification | `{ dataFlowId }` | `Promise<Class \| undefined>` |
| `getDataClass` | Get data class by ID | `{ dataClassId }` | `Promise<Class \| undefined>` |
| `getClassById` | Get any class by ID, routed on `classType` (`component` \| `boundary` \| `dataflow` \| `data` \| `control`); an unrecognised type returns `undefined` without a round trip | `{ classId, classType }` | `Promise<Class \| undefined>` |
| `getControlClasses` | Get control classes, filtered by raw module / class `where` conditions | `{ moduleWhere, classWhere }` | `Promise<Module[]>` — modules with their `controlClasses` flattened |
| `getControlClassById` | Get specific control class | `{ classId }` | `Promise<Class \| null>` |
| `matchClasses` | Match element names / descriptions against a class corpus | `{ elements, classLabel, componentType?, moduleIds?, topN?, fields? }` | `Promise<{ matches, unmatched, vectorAvailable }>` |
| `listClasses` | Paginated, filterable, facetted class browse | `{ classLabel, componentType?, search?, categories?, moduleIds?, offset?, limit? }` | `Promise<{ items, totalCount, facetCounts }>` |
| `setInstantiationAttributes` | Set per-instance `IS_INSTANCE_OF` edge attributes | `{ componentId, classId, attributes }` | `Promise<boolean>` |
| `setInstantiationAttributesWithStaleCount` | Same write, with the disposition-staleness count the picker needs | `{ componentId, classId, attributes }` | `Promise<{ success, staleFlippedCount, errorMessage }>` |
| `getAttributesFromClassRelationship` | Get instantiation attributes for one (element, class) pair | `{ componentId, classId }` | `Promise<object>` (empty object when none) |

> **`componentId` names any element.** The two instantiation-attribute writers and the reader take a
> parameter called `componentId`, but it carries the id of whichever element holds the `IS_INSTANCE_OF`
> edge — `DtControl.setInstantiationAttributes` passes a Control id straight through. There is no
> `elementType` argument; the class id disambiguates.

> **Two instantiation writers, one mutation.** `setInstantiationAttributes` selects only `{ success }`
> from `SetInstantiationAttributesResult` so its callers keep binding a boolean.
> `setInstantiationAttributesWithStaleCount` selects the full result and is what the frontend picker
> save path uses, because it needs `staleFlippedCount` and propagates `errorMessage`.

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

**Mutex scope.** Calls are serialised on a `binding_<elementId>` key, but only **within one `DtClass`
instance**. Cross-store / cross-instance races fall through to the backend `executeWrite` — the
client-side mutex is a latency hedge, not a distributed coordination primitive.

**Cancel-on-replace.** `matchClasses` and `listClasses` route through `dtUtils.withCancellableLatest`
keyed by `matchClasses:<classLabel>:<componentType>` / `listClasses:<classLabel>:<componentType>`, so
keystrokes from one picker supersede each other while differently-scoped pickers proceed in parallel —
the same pattern [`DtMitre.matchTechniques`](#dtmitre) uses.

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
| `getModuleById` | Get module by ID | `moduleId: string` (positional) | `Promise<Module>` |
| `getModuleByName` | Get module by name | `moduleName: string` (positional) | `Promise<Module>` |
| `saveModule` | Save a module's attributes (serialised JSON) | `{ moduleId, attributes }` | `Promise<Module>` |
| `resetModule` | Reset module to defaults | `moduleId: string` (positional) | `Promise<boolean>` |
| `getAvailableFrontendModules` | List frontend bundles | `none` | `Promise<string[]>` |
| `getModuleFrontendBundle` | Get bundle code | `{ moduleName }` | `Promise<string>` |

> **Argument style is not uniform here.** `getModuleById`, `getModuleByName`, and `resetModule` take a
> bare positional string; `saveModule` and `getModuleFrontendBundle` take an options object. The bundle
> lookup keys on the module **name**, not its id. `saveModule` throws when either `moduleId` or
> `attributes` is missing, and `getModuleFrontendBundle` throws on a missing name, rather than returning
> a null result.

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
| `deleteOrphanedClass` | Admin: hard-delete an orphaned class. `cascade` is required; `cascade=false` (the operator default in the UI) refuses with a non-zero incident count. `cascade=true` DETACH DELETEs the class AND every incident instance — capped at 1000 server-side. Server-side: `requireAdmin(ctx)` | `{ classId, classKind, cascade }` | `Promise<boolean>` |
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
| `getControl` | Get a single control by ID | `{ controlId }` | `Promise<Control \| null>` |
| `getControlsByIds` | Batched control + class metadata fetch (de-duplicates input; no round trip on an empty list) | `{ ids: string[] }` | `Promise<Control[]>` |
| `createControl` | Create new control, bound to zero or more control classes | `{ newControl: Control, classIds: string[] \| null, folderId }` | `Promise<Control \| null>` |
| `updateControl` | Update control — bundled binding + residual write. The binding portion routes through `DtClass.changeElementBinding` and the residual property update through the auto-generated `updateControls` mutation. | `{ controlId, name, description, controlClasses: string[], folderId }` | `Promise<UpdateControlResult>` |
| `deleteControl` | Delete control | `{ controlId }` | `Promise<boolean>` |
| `findControls` | Filtered control search; an `elementIds` filter takes a Cypher-helper path instead of the polymorphic interface query | `{ controlId?, name?, classId?, classType?, elementIds?, moduleId?, moduleName? }` | `Promise<Control[]>` |
| `assignControlToElements` | Attach a control to elements, read-before-write so an already-attached pair is not re-created | `{ controlId, elementIds }` | `Promise<Control \| null>` |
| `getControlsAssignedModels` | Which models each control supports | `{ ids: string[] }` | `Promise<Map<string, string[]>>` |
| `getControlInstantiationAttributes` | Per-`(Control, ControlClass)` edge attributes | `{ controlIds: string[] }` | `Promise<{ controlId, classId, attributes }[]>` |
| `controlGaps` | Control-gap analysis over the MITRE framework chain — unmitigated / unaddressable exposures, recommended controls, coverage summary | `{ modelId, topN?, limit? }` | `Promise<ControlGapsResult>` |
| `controlCandidatesForType` | Controls whose classes support the given element types, with per-class fit detail | `{ elementTypes, moduleIds? }` | `Promise<ControlCandidate[]>` |
| `setInstantiationAttributes` | Set the control's per-instance class-edge attributes | `{ controlId, classId, attributes }` | `Promise<{ success, errorMessage }>` |

> **`updateControl` return shape.** `UpdateControlResult` is `{ control: Control \| null, bindingResult: ChangeElementBindingResult \| null, residualOk: boolean }` — the same bundled shape as `updateDataItem` above, so callers can render two distinct snackbars when the binding committed but the residual property update failed. See [`changeElementBinding`](#dtclass) for the binding-portion contract.

> **`controlClasses` is required, and its emptiness is meaningful.** Unlike `updateDataItem`'s optional
> `classId`, `updateControl` always attempts a binding change: a non-empty list targets `CLASS` (Controls
> are the one element type that may hold several), an **empty** list targets `NONE`. The backend
> identity-short-circuits when the target already matches. A falsy `controlId` short-circuits client-side
> to `{ control: null, bindingResult: null, residualOk: false }`.

> **`assignControlToElements` reads before it writes.** `connect` compiles to a bare relationship
> `CREATE`, so connecting an already-attached pair appends a parallel `SUPPORTS` edge. The method reads
> the current set and connects only the difference — the same non-idempotence that drives the
> [link deltas](#link-deltas--controls-and-dataitems) and the conduit reconcile.

> **`setInstantiationAttributes` delegates.** It calls `DtClass.setInstantiationAttributesWithStaleCount`
> with the control id as `componentId` and narrows the result to `{ success, errorMessage }`.

---

## DtFolder

**Source:** `packages/dt-core/src/dt-folder/`

Manages organizational folders.

### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `getFolders` | Get every folder, each with its `parentFolder` flattened to a single object | `none` | `Promise<Folder[]>` |
| `createFolder` | Create new folder | `folder: Folder` (positional) | `Promise<Folder>` |
| `updateFolder` | Update folder | `folder: Folder` (positional) | `Promise<boolean>` |
| `deleteFolder` | Delete folder | `folderId: string` (positional) | `Promise<boolean>` |

> **Positional arguments, and the whole folder.** Like three of the `DtModule` methods and unlike the
> rest of dt-core, `DtFolder` takes bare positional arguments rather than an options object.
> `createFolder` and `updateFolder` take the folder
> itself and read `name`, `description`, and `parentFolder.id` off it. `updateFolder` does **not**
> presence-gate: it always writes `name` and `description` (empty-string-coalesced), and rebinds
> `parentFolder` whenever the folder names one. It returns a boolean, not the updated folder — callers
> that need the new state re-read through `getFolders`. The hierarchy is not a query argument; it is
> reconstructed from the `parentFolder` on each returned folder.

---

## DtAnalysis

**Source:** `packages/dt-core/src/dt-analysis/`

Manages AI-powered security analysis workflows.

### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `findAnalysisClasses` | Get available analysis types | `{ classType?, moduleId?, classId?, className? }` | `Promise<AnalysisClass[] \| null>` |
| `findAnalyses` | Find analyses by criteria | `{ name?, analysisId?, classId?, elementId?, classType?, moduleId? }` | `Promise<Analysis[] \| null>` |
| `createAnalysis` | Create an analysis on an element | `{ id, elementId, name, description, type?, category?, analysisClassId }` | `Promise<Analysis \| null>` |
| `updateAnalysis` | Update analysis properties | `{ analysisId, name, description, type?, category? }` | `Promise<Analysis \| null>` |
| `deleteAnalysis` | Delete analysis | `{ analysisId }` | `Promise<boolean>` |
| `runAnalysis` | Execute analysis; resolves the **session id** | `{ analysisId, additionalParams? }` | `Promise<string \| null>` |
| `resumeAnalysis` | Continue a paused analysis with user input | `{ analysisId, userInput }` | `Promise<string \| null>` |
| `getAnalysisValues` | Read one keyed value off an analysis | `{ analysisId, valueKey }` | `Promise<object \| null>` |
| `getDocument` | Read a filtered document produced by an analysis | `{ analysisId, filter }` | `Promise<object \| null>` |
| `subscribeToStream` | Real-time updates — returns the raw Apollo observable | `{ sessionId }` | `Observable<FetchResult<any>> \| null` |
| `startChat` | Interactive chat against an analysis | `{ analysisId, userQuestion }` | `Promise<{ sessionId } \| null>` |

> **The caller supplies the analysis id.** `createAnalysis` takes a client-generated `id` so retries are
> idempotent end to end: both the deduplication key (`create-analysis-<id>`) and the server-side `MERGE`
> key on it. A wrapper-generated id would defeat that.

> **`runAnalysis` and `resumeAnalysis` resolve a session id string,** not a session object — the value to
> hand to `subscribeToStream`. Both return `null` when a required argument is missing, without a round
> trip, and both pass `deduplicationKey: false` — as does `startChat` — so a second invocation never
> joins an in-flight one.

### Subscription Pattern

`subscribeToStream` hands back the Apollo observable directly; there is no callback argument and no
wrapper subscription object. The caller subscribes and owns the teardown.

```typescript
const dtAnalysis = new DtAnalysis(apolloClient)

// Start the analysis — the result IS the session id
const sessionId = await dtAnalysis.runAnalysis({ analysisId: 'analysis-123' })
if (!sessionId) return

const observable = dtAnalysis.subscribeToStream({ sessionId })
const subscription = observable?.subscribe({
  next: (result) => {
    console.log('Analysis update:', result.data)
  },
})

// Later: cleanup
subscription?.unsubscribe()
```

---

## DtIssue

**Source:** `packages/dt-core/src/dt-issue/`

Manages security issue tracking.

### Methods

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `findIssueClasses` | Get available issue classes | `{ classType?, moduleId?, classId?, className?, moduleName?, classCategory? }` | `Promise<Class[]>` |
| `findIssues` | Find issues by criteria | `{ name?, issueId?, classId?, elementIds?, classType?, moduleId?, moduleName?, issueStatus? }` | `Promise<Issue[]>` |
| `findIssueDetail` | Full detail for one issue — `syncedAttributes`, `elementsWithExtendedInfo`, `issueClass.template`, and the relationship collections flattened into `elements` | `{ issueId }` | `Promise<Issue \| null>` |
| `createIssue` | Create new issue, bound to an issue class | `{ name, description?, type?, category?, attributes?, issueClassId, comments? }` | `Promise<Issue>` |
| `updateIssue` | Update issue | `{ issueId, name?, description?, type?, category?, attributes?, issueClassId?, issueStatus?, comments? }` | `Promise<Issue>` |
| `deleteIssue` | Delete issue | `{ issueId }` | `Promise<boolean>` |
| `addElementsToIssue` | Attach elements to an issue across all six element labels | `{ issueId, elementIds }` | `Promise<number>` (elements added) |
| `removeElementFromIssue` | Detach one element | `{ issueId, elementId }` | `Promise<boolean>` |

> **There is no `getIssues`.** The read surface is `findIssues` (list, filtered) and `findIssueDetail`
> (one issue, fully expanded). An issue's status is filtered on as `issueStatus`; `createIssue` sets it
> to `open` and stamps `createdAt` / `updatedAt` client-side.

> **`updateIssue` gates the class relationship, and only that.** The scalar fields are emitted
> unconditionally as `{ set: … }` rather than presence-gated, so an omitted one carries `undefined` into
> the input. `issueClassId` is the exception, and the guard there is load-bearing: omitting it used to
> emit a bare disconnect-all plus a connect
> on `eq: undefined`, which wiped the issue's class. Absent id → key omitted → class preserved; present →
> disconnect old + connect new.

---

## MITRE Framework Classes

### DtMitreAttack

**Source:** `packages/dt-core/src/dt-mitreattack/`

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `getMitreAttackTactics` | Get all ATT&CK tactics | `none` | `Promise<MitreAttackTactic[]>` |
| `getMitreAttackTechniquesByTactic` | Get the techniques of one tactic | `{ tacticId }` | `Promise<MitreAttackTechnique[]>` |
| `getMitreAttackTechnique` | Get one technique by its ATT&CK id | `{ attackId }` | `Promise<MitreAttackTechnique \| null>` |
| `findMitreAttackTechniques` | Search techniques with a raw GraphQL filter object | `{ query: object }` | `Promise<MitreAttackTechnique[]>` |
| `getMitreAttackMitigations` | Get all mitigations | `none` | `Promise<MitreAttackMitigation[]>` |
| `getMitreAttackMitigation` | Get one mitigation by its ATT&CK id | `{ attackId }` | `Promise<MitreAttackMitigation \| null>` |

The `attackId` parameters carry an ATT&CK id (`T1566`, `M1049`) and are sent as the schema's `attack_id`
variable, not the node's internal id.

### DtMitreDefend

**Source:** `packages/dt-core/src/dt-mitredefend/`

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `fetchMitreDefendTactics` | Get all D3FEND tactics | `none` | `Promise<MitreDefendTactic[] \| null>` |
| `getMitreDefendTechniquesByTactic` | Get the techniques of one tactic | `{ tacticId }` | `Promise<MitreDefendTechnique[]>` |
| `getMitreDefendTechnique` | Get one technique by its D3FEND id | `{ d3fendId }` | `Promise<MitreDefendTechnique \| null>` |

Neither class exposes a keyword search of its own — the ATT&CK side's `findMitreAttackTechniques` takes a
raw GraphQL filter rather than a search string, and D3FEND has no equivalent. Free-text matching against
either corpus goes through [`DtMitre.matchTechniques`](#dtmitre).

---

## DtExposure

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

### Example Usage

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

### GraphQL Definitions

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

---

## DtCountermeasure

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

### GraphQL Definitions

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
