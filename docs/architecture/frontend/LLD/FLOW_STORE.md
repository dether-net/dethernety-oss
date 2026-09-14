# Flow Store & Optimistic Updates

## Table of Contents
- [Overview](#overview)
- [Temporary Node Tracking](#temporary-node-tracking)
- [Three-Phase Node Creation](#three-phase-node-creation)
- [Deferred Update Mechanism](#deferred-update-mechanism)
- [Narrowing the Write](#narrowing-the-write)
- [Error Handling & Rollback](#error-handling--rollback)
- [Boundary Zoning Getters](#boundary-zoning-getters)
- [Vue Flow Integration](#vue-flow-integration)
- [State Synchronization](#state-synchronization)
- [DtUtils Concurrency Patterns](#dtutils-concurrency-patterns)
- [Error Classification](#error-classification)
- [Complete State Reset](#complete-state-reset)

## Overview

The flowStore manages the data flow diagram editor, implementing advanced optimistic update patterns for responsive user experience during threat modeling.

Two mechanisms sit at its centre and are easy to conflate. The **optimistic merge** decides what the
canvas renders straight away; the **[projection](#narrowing-the-write)** decides what is actually sent.
They are not the same object, and the difference is what keeps two people editing one model from undoing
each other.

**Primary Source File:** `apps/dt-ui/src/stores/flowStore.ts`

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Optimistic Update Flow                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  User Action: Drop component on canvas                                  │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ PHASE 1: Optimistic Update                                      │    │
│  │ - Create temp node with temp-{timestamp} ID                     │    │
│  │ - Add to pendingNodes set                                       │    │
│  │ - Insert into nodes array immediately                           │    │
│  │ - User sees node appear instantly                               │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ PHASE 2: API Call                                               │    │
│  │ - Send create request to backend                                │    │
│  │ - Queue any user updates to deferredUpdates                     │    │
│  │ - Server returns real node with real ID                         │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ PHASE 3: Reconciliation                                         │    │
│  │ - Replace temp node with real node                              │    │
│  │ - Map temp ID to real ID in tempNodeMapping                     │    │
│  │ - Apply all deferred updates                                    │    │
│  │ - Clean up tracking state                                       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Temporary Node Tracking

### Data Structures

**Source:** `flowStore.ts:76-78`

```typescript
// Track nodes that are being created (temp ID exists, real ID pending)
const pendingNodes = ref<Set<string>>(new Set())

// Map temporary IDs to real IDs after server response
const tempNodeMapping = ref<Map<string, string>>(new Map())

// Queue updates that arrive while node is still being created
const deferredUpdates = ref<Map<string, Array<{
  updates: object
  timestamp: number
}>>>(new Map())
```

### Helper Functions

**Source:** `flowStore.ts` → `isPendingNode`, `getRealNodeId`, `queueUpdateForTempNode`

```typescript
// Check if a node is in pending state (being created)
const isPendingNode = (nodeId: string): boolean => {
  return pendingNodes.value.has(nodeId)
}

// Resolve a temp ID to its real ID (if creation completed)
const getRealNodeId = (nodeId: string): string => {
  return tempNodeMapping.value.get(nodeId) || nodeId
}

// Queue an update for a temp node to apply after creation
const queueUpdateForTempNode = (tempId: string, updates: object): void => {
  if (!deferredUpdates.value.has(tempId)) {
    deferredUpdates.value.set(tempId, [])
  }
  deferredUpdates.value.get(tempId)!.push({
    updates,
    timestamp: Date.now()
  })
}
```

---

## Three-Phase Node Creation

### Phase 1: Optimistic Update

**Source:** `flowStore.ts` → `createComponentNode`

```typescript
const createComponentNode = async ({ newNode, classId }): Promise<Node | null> => {
  const operationKey = 'createComponent'

  // Generate temporary ID
  const tempId = `temp-${Date.now()}`

  // Create optimistic node for immediate UI feedback
  const optimisticNode = {
    id: tempId,
    type: newNode.type,
    position: newNode.position,
    data: {
      ...newNode.data,
      pending: true,              // Flag for UI indication
      label: newNode.data?.label || 'Creating...'
    }
  }

  // Track as pending
  pendingNodes.value.add(tempId)

  // Add to nodes array IMMEDIATELY
  nodes.value.push(optimisticNode)

  // Update selection to the new node
  selectedItem.value = optimisticNode

  // ... Phase 2 & 3 continue
}
```

**UI Indication:**
- `pending: true` flag can be used to show loading spinner
- Label shows "Creating..." as placeholder

### Phase 2: API Call

**Source:** `flowStore.ts` → `createComponentNode` (the `dtComponent.createComponentNode` await)

```typescript
try {
  // Execute actual API call
  const createdComponent = await dtComponent.createComponentNode({
    newNode,
    classId,
    defaultBoundaryId: defaultBoundaryId.value || ''
  })

  // Phase 3 follows on success...
```

**During this phase:**
- User can interact with the temp node
- Any updates are queued via `updateNode()` detecting pending status

### Phase 3: Reconciliation

**Source:** `flowStore.ts` → `createComponentNode` (the `if (createdComponent)` branch)

```typescript
if (createdComponent) {
  // Find and replace optimistic node
  const index = nodes.value.findIndex((n: any) => n.id === tempId)
  if (index !== -1) {
    nodes.value.splice(index, 1, createdComponent)

    // Map temp ID to real ID for future lookups
    tempNodeMapping.value.set(tempId, createdComponent.id)

    // Update selection if it was pointing to temp node
    if (selectedItem.value && (selectedItem.value as any).id === tempId) {
      selectedItem.value = createdComponent
    }

    // Force Vue reactivity
    nodes.value = nodes.value.slice()
  }

  // Apply any updates that were queued during creation. applyDeferredUpdates
  // retires pendingNodes[tempId] itself, atomically with its final drain — see
  // "Applying Deferred Updates" below — so no delete belongs here.
  await applyDeferredUpdates(tempId, createdComponent.id)

  // Keep mapping for a short time for late-arriving updates
  setTimeout(() => tempNodeMapping.value.delete(tempId), 1000)
}
```

---

## Deferred Update Mechanism

### Why Deferred Updates?

```
Timeline:
─────────────────────────────────────────────────────────────────────────►
    │                                    │                           │
    │                                    │                           │
  User drops                         User changes              Server returns
  component                          node name                 real node
    │                                    │                           │
    ▼                                    ▼                           ▼
  tempId created                   Update queued              Apply deferred
  API call starts                  (node pending)             updates to real ID
```

Without deferred updates, the name change would be lost because the temp node doesn't exist on the server yet.

### Update Detection

**Source:** `flowStore.ts` → `updateNode`

```typescript
const updateNode = async ({
  nodeId,
  updates,
  skipDeferredQueue = false
}): Promise<boolean> => {

  // Check if this is a temporary node
  if (!skipDeferredQueue && isPendingNode(nodeId)) {
    // Queue the update for later
    queueUpdateForTempNode(nodeId, updates)

    // Also update the UI optimistically
    const tempNodeIndex = nodes.value.findIndex(n => n.id === nodeId)
    if (tempNodeIndex !== -1) {
      const tempNode = nodes.value[tempNodeIndex]
      dtUtils.deepMerge(tempNode, updates)
      nodes.value = nodes.value.slice()  // Force reactivity
    }

    return true  // Indicate update was handled (queued)
  }

  // Not (or no longer) pending: translate a stale temp id to its real id, so a
  // late edit lands on the real node instead of re-queueing into a map that will
  // never flush again. The rest is the merge-project-send path below.
  const targetId = getRealNodeId(nodeId)
  // ...
}
```

`isPendingNode` is true only while the node is genuinely mid-creation. `applyDeferredUpdates` clears the
flag as its last act, so once the create has resolved an edit takes the `getRealNodeId` path instead of
the queue. What happens after that translation is the subject of
[Narrowing the Write](#narrowing-the-write) — the merge is *not* what gets sent.

### Applying Deferred Updates

**Source:** `flowStore.ts` → `applyDeferredUpdates`

```typescript
const applyDeferredUpdates = async (tempId: string, realId: string) => {
  const initial = deferredUpdates.value.get(tempId)
  if (!initial || initial.length === 0) {
    // Nothing queued — still retire the pending flag.
    pendingNodes.value.delete(tempId)
    deferredUpdates.value.delete(tempId)
    return
  }

  // Small delay to ensure the real node is fully created and in the store.
  await new Promise(resolve => setTimeout(resolve, 100))

  // Verify real node exists before applying
  const realNodeExists = getNodeById({ nodeId: realId }) || realId === defaultBoundaryId.value
  if (!realNodeExists) { /* warn, clear tracking, return */ }

  // Drain loop: re-check the queue after every round-trip, so updates queued DURING
  // the awaits (the node is still pending) are applied rather than dropped. `processed`
  // advances monotonically over the stable array instance, so nothing is double-applied.
  const MAX_FLUSH_ITERATIONS = 50 // runaway backstop
  let processed = 0
  while (true) {
    const queue = deferredUpdates.value.get(tempId)
    if (!queue || queue.length === processed) break
    const batch = queue.slice(processed)
    processed = queue.length

    // Fold this batch: latest class update wins; node updates deep-merge.
    let classId: string | undefined
    const nodeUpdates: any = {}
    batch.forEach(({ updates: update }) => {
      if ('classId' in update) classId = (update as any).classId
      else dtUtils.deepMerge(nodeUpdates, update)
    })

    if (classId) await updateNodeClass({ nodeId: realId, classId })
    if (Object.keys(nodeUpdates).length > 0) {
      // skipDeferredQueue prevents infinite loop. updateNode reverts and returns
      // false silently on failure, so a failed deferred write is surfaced here.
      const ok = await updateNode({ nodeId: realId, updates: nodeUpdates, skipDeferredQueue: true })
      if (!ok) dtUtils.handleError({ action: 'applyDeferredUpdates', error: new Error(...) })
    }
  }

  // Stop accepting new deferred writes, atomically with the terminal length-check
  // above (no await in between): a late write either landed before the check — so it
  // was flushed — or runs after it, sees pendingNodes cleared, and updateNode
  // translates temp -> real directly.
  pendingNodes.value.delete(tempId)
  deferredUpdates.value.delete(tempId)
}
```

`updateNodeClass` routes through `dtClass.changeElementBinding` — the single sanctioned write path for the
`IS_INSTANCE_OF` / `REPRESENTS_MODEL` edges. A non-null `classId` binds
(`{ kind: 'CLASS', classIds: [classId] }`); a null one unassigns (`{ kind: 'NONE' }`), which also sweeps
SYSTEM-derived exposures server-side. On success the store writes the new `classId` into the local node
(`writeLocalClassId`). The returned `ChangeElementBindingResult` — not a boolean — is what callers branch
on to drive snackbar feedback (see the Class-change feedback pattern in
`Data architecture/IMPLEMENTATION_PATTERNS.md`).

**Update Priority:**
1. Class updates applied first (changes node type/schema)
2. Regular updates merged and applied second
3. Latest class update in a batch wins (if multiple)
4. Regular updates are deep-merged together
5. The flag clears only after the queue has drained, so nothing queued mid-flush is lost

---

## Narrowing the Write

An interactive save carries two things: the element as this client last loaded it, and an `updates`
object naming what the user just changed. The store merges `updates` into the live node so the canvas
renders the edit immediately — but **what the merge produces is not what is sent**. The payload is
narrowed back down to the paths `updates` names, and relationship edits are sent as a *delta* against a
pre-merge baseline rather than as a whole-list replace.

Both halves exist for the same reason: two people editing the same model must not undo each other.

```
Two clients, one component, overlapping saves:
─────────────────────────────────────────────────────────────────────────►
  A loads component         B loads component
  (name "API", 1 control)   (name "API", 1 control)
         │                         │
         ▼                         │
  A saves { label }                │
  → sends name only                │
  → connects nothing               ▼
                            B saves { dataItems: [+d2] }
                            → sends the dataItems delta only
                            → A's new name survives; B's attach survives
```

Send the whole element instead, and B's save rewrites `name` back to "API". Send the whole list instead
of a delta, and B's save disconnects the control A just attached — in both cases silently, with a
success response to both parties.

### What the caller supplies

`updates` is the only part of a save that states intent, so it is what decides which fields travel. A
call site must therefore name **what the user changed**, not hand over the form's whole contents:

```typescript
// SettingsWindow.vue — each field enters `updates` only when it differs from what was loaded.
// `selectedItem` is re-pinned from the server's answer after every save, so it already holds
// "what this client last loaded", moving forward as writes land.
const loaded = selectedItem.value.data
res = await flowStore.updateNode({
  nodeId: selectedItem.value.id,
  updates: {
    data: {
      ...(pendingFormData.value.name !== (loaded.label || '') && { label: pendingFormData.value.name }),
      ...(pendingFormData.value.description !== (loaded.description || '') && { description: pendingFormData.value.description }),
      ...(crownJewel.value !== (loaded?.crownJewel === true) && { crownJewel: crownJewel.value }),
      ...links,
    },
  },
})
```

`data` stays present even when it ends up empty — an object with no keys names no path, so the
projection narrows to the id and a no-op save stays a no-op rather than widening back to the whole
element. The call is still made: it is what clears a fresh draft.

### The store side: merge, then project

**Source:** `flowStore.ts` → `updateNode`, `linkBaseline`; `apps/dt-ui/src/utils/editProjection.ts`

```typescript
// What this client believed the element's links to be, read BEFORE the optimistic merge.
const linkBaseline = (element: Node | Edge) => ({
  controls: Array.isArray(element.data?.controls) ? [...element.data.controls] : undefined,
  dataItems: Array.isArray(element.data?.dataItems) ? [...element.data.dataItems] : undefined,
})

// ...inside updateNode, for a node that is not pending:
const baselineConduits = node.type === 'BOUNDARY' && Array.isArray(node.data?.conduits)
  ? [...node.data.conduits]
  : undefined
const baselineLinks = linkBaseline(node)   // pre-merge: the only correct delta baseline
const snapshot = safeClone(node)           // pre-merge: the revert target
dtUtils.deepMerge(node, updates)           // what the canvas renders

// What gets SENT is narrowed to the fields this edit names.
const edited = projectEdit(node, updates)

const ok = node.type === 'BOUNDARY'
  ? await updateBoundaryNode({ updatedNode: edited, baselineConduits, baselineLinks })
  : await updateComponentNode({ updatedNode: edited, baselineLinks })
```

Order matters and is load-bearing: the baselines and the snapshot are all taken **before** the merge. An
edit applied to the element first would make the baseline equal the new value, the delta empty, and the
attachment would never be written at all. It is also why the settings panel *names* its edit rather than
assigning into `selectedItem` — an out-of-band write to the element poisons the baseline.

The response carries the whole element back, so the local node still converges onto whatever the other
client changed: `updateComponentNode` / `updateBoundaryNode` re-pin from the mutation result.

### What `projectEdit` keeps

**Source:** `apps/dt-ui/src/utils/editProjection.ts` → `editPaths`, `projectEdit`

`editPaths(updates)` walks the edit into leaf paths; `projectEdit(source, updates)` rebuilds a fresh
object from `source` carrying only those paths. Four rules, each of which is a real case rather than a
precaution:

| Rule | Why |
|------|-----|
| **Arrays are leaves.** The walk does not descend into them. | The merge that produced the element replaces arrays wholesale rather than merging element-wise, so the projection must too. Descending would turn a conduit list into `data.conduits.0.justification` and rebuild a partial array from it. |
| **Presence is the test, not truth.** A named path travels whatever its value. | `zone: null` clears a zone, `crownJewel: false` un-marks a crown jewel, `parentNode: ''` relocates a node to the root boundary. All three are real edits; a truthiness test drops all three. |
| **An object with no keys names nothing.** | An empty edit narrows to nothing instead of quietly widening back to the whole element — which is what lets a no-op save stay a no-op. |
| **The `id` always travels**, and a named path missing from `source` is skipped. | The id is not part of the edit; it is how the write addresses the element at all. Absent and explicitly-`undefined` mean the same thing to the writers, so skipping keeps the projection honest about what it holds. |

`updateDataFlow` does the same for edges — merge into the live edge (so a ticked checkbox does not clear
itself while the server answers), then send `projectEdit(live, updates)` with `updates: {}`. The
narrowing cannot move into dt-core: the model import/update path (`DtUpdate`) shares that writer and
passes a fully-built edge with an `updates` object that names little or nothing, so narrowing there would
send almost nothing. dt-core still merges what it is given — an empty object here — which leaves the
projected edge as the whole of the input, and `projectEdit` builds a fresh object, so the writer never
receives the live reactive edge.

### The writer side: a field the element does not define is not written

**Source:** `packages/dt-core/src/dt-component/dt-component.ts` → `updateComponent`

Every field of the update input is gated on being defined on the node. The contract is one sentence:
**a field the element does not define is not written.**

```typescript
const controlsInput = linkInput(updatedNode.data?.controls, baselineLinks, 'controls')
const dataItemsInput = linkInput(updatedNode.data?.dataItems, baselineLinks, 'dataItems')

const variables = {
  componentId: updatedNode.id,
  input: {
    ...(updatedNode.data?.label !== undefined && { name: { set: updatedNode.data.label } }),
    ...(updatedNode.data?.description !== undefined && { description: { set: updatedNode.data.description } }),
    // The two axes are ONE edit and are gated together: reading them inside the guard is
    // what keeps a node carrying no position from throwing on `.x`.
    ...(updatedNode.position !== undefined && {
      positionX: { set: updatedNode.position.x },
      positionY: { set: updatedNode.position.y },
    }),
    ...(controlsInput !== undefined && { controls: controlsInput }),
    ...(dataItemsInput !== undefined && { dataItems: dataItemsInput }),
  },
}
```

The parent guard is a different kind of guard and is **not** optional: `parentBoundary.connect` filters on
an `eq` built from `parentNode`, and an undefined one produces a filter with no condition — matching
every boundary, after an unconditional `disconnect` has already run. An *empty* parent is the other case
and is a real edit meaning "put me at the root", i.e. the default boundary. `DtBoundary.updateBoundaryNode`
builds its input the same way.

### Relationship edits: delta, not replace

**Source:** `packages/dt-core/src/dt-utils/link-delta.ts` → `linkInput`, `buildLinkOps`

`linkInput` decides the shape of one link key. There are two different absences and collapsing them is
the one mistake that turns a bulk write into a delta against nothing:

| `current` | `baselines` | Shape emitted |
|-----------|-------------|---------------|
| absent | — | **Key omitted.** The element does not define this list, so it was not edited and must not be written. The conduit and import "safe node" passes rely on this. |
| present | absent | **Replace:** `{ disconnect: {}, connect: [...ids] }`. The caller is asserting the whole list — correct for an import or a bulk write. |
| present | present | **Delta:** `buildLinkOps(current, baselines[key] ?? [])` — connect only what was added, disconnect only what was removed, and omit the key entirely when nothing changed. A baseline that holds nothing for the key is a delta against an empty list, not a missing baseline. |

The replace shape's `disconnect` stays unconditional on purpose: `connect` compiles to a bare
relationship `CREATE`, so a disconnect that spared the incoming ids would re-create every already-attached
pair — one extra parallel edge per element per save.

The delta's cost is the mirror of that: two clients adding the **same** id at the same moment produce a
duplicate edge. That trade is deliberate — a duplicate is additive and invisible on read, a destroyed
attachment is neither. Both sides of the delta are de-duplicated and id-validated first; an unusable id
in the baseline would otherwise build a `disconnect` with no condition, clearing every edge of that type
on the element.

Boundary **conduits** take the same delta treatment through their own builder, with `baselineConduits` as
the pre-merge snapshot — see [Server re-pin keeps the baseline correct](#server-re-pin-keeps-the-baseline-correct)
and the dt-core conduit reconcile in
[Data Access Layer](../../dt-core/DATA_ACCESS_LAYER.md).

---

## Error Handling & Rollback

### Node Creation Failure

**Source:** `flowStore.ts` → `createComponentNode` (the `catch` block)

```typescript
catch (error) {
  // Remove the failed optimistic node
  nodes.value = nodes.value.filter(n => n.id !== tempId)

  // Clear selection if it was the failed node
  selectedItem.value = null

  // Clean up all tracking state
  pendingNodes.value.delete(tempId)
  deferredUpdates.value.delete(tempId)
  tempNodeMapping.value.delete(tempId)

  // Set user-friendly error
  const errorMessage = handleApiError(error as Error, 'create component')
  setError(operationKey, errorMessage)

  return null
}
```

**Rollback Guarantees:**
- Optimistic node removed from UI
- Selection cleared
- All tracking maps cleaned up
- Error message set for UI display

### Update Failure (Non-Pending Node)

`updateNode` **never rejects.** It snapshots the node before the optimistic merge and, on a failed save
(thrown error **or** falsy return), re-pins local state to that snapshot and returns `false`. On success the
downstream `updateBoundaryNode` / `updateComponentNode` already splice in the fresh server node, so no revert
runs. Callers therefore just check the boolean — no per-call-site `try/catch` is needed.

```typescript
const updateNode = async ({ nodeId, updates }): Promise<boolean> => {
  const targetId = getRealNodeId(nodeId)
  const isDefault = targetId === defaultBoundaryId.value
  const node = isDefault ? defaultBoundary.value : nodes.value[getNodeIndexById({ nodeId: targetId })]
  if (!node) return false

  // Baselines and snapshot are all taken BEFORE the optimistic merge
  // (safeClone = structuredClone + JSON fallback). See "Narrowing the Write".
  const baselineConduits = node.type === 'BOUNDARY' && Array.isArray(node.data?.conduits)
    ? [...node.data.conduits]
    : undefined
  const baselineLinks = linkBaseline(node)
  const snapshot = safeClone(node)
  dtUtils.deepMerge(node, updates)
  const edited = projectEdit(node, updates)   // only the paths this edit names

  try {
    const ok = node.type === 'BOUNDARY'
      ? await updateBoundaryNode({ updatedNode: edited, baselineConduits, baselineLinks })
      : await updateComponentNode({ updatedNode: edited, baselineLinks })
    if (!ok) revertNode(targetId, isDefault, snapshot)
    return ok
  } catch (error) {
    revertNode(targetId, isDefault, snapshot)   // never re-throws
    return false
  }
}
```

**`revertNode`** re-resolves the index *fresh* at revert time (a concurrent delete/create/sync can shift it),
splices the snapshot back (or reassigns `defaultBoundary.value` for the default-boundary path), re-pins
`selectedItem` if it points at the same node, and **skips entirely** if the node was concurrently removed
(`getNodeIndexById` returns `-1`) — it never resurrects a deleted node.

---

## Boundary Zoning Getters

Three read-only getters expose a boundary's **zoning** — its declared trust `zone`, business
`domains`, operational `planes`, and declared "approved channels" (conduits) — to the zoning
surfaces (the Zoning tab, the peer picker drawer, the model-wide overview, and the diagram pill).
They are pure reads over `nodes.value` / `defaultBoundary.value`; no GraphQL is issued. Writes
flow through the existing `updateNode` path — these getters never mutate.

**Source:** `flowStore.ts` → `boundaryById`, `allBoundaries`, `effectiveZone`

| Getter | Signature | Returns |
|--------|-----------|---------|
| `boundaryById` | `(id: string) => Node \| null \| undefined` | The boundary node for `id` — the default boundary when `id` is `defaultBoundaryId`, otherwise the matching `type === 'BOUNDARY'` node from `nodes.value` (or `undefined` if none). |
| `allBoundaries` | `() => Node[]` | Every `type === 'BOUNDARY'` node in `nodes.value`. **A function, not a computed** (see note). |
| `effectiveZone` | `(boundaryId: string) => EffectiveZone` | The boundary's zone after inheritance — delegates to `resolveEffectiveZone(boundaryId, boundaryById, defaultBoundaryId)`. |

```typescript
const boundaryById = (id: string): Node | null | undefined =>
  id === defaultBoundaryId.value
    ? defaultBoundary.value
    : nodes.value.find(n => n.id === id && n.type === 'BOUNDARY')

// A function (not a computed) to match the store's convention and sidestep the deeply-generic
// Vue-Flow Node type under computed(); stays reactive when read inside a consumer's computed/render.
const allBoundaries = (): Node[] => nodes.value.filter((n: any) => n.type === 'BOUNDARY')

const effectiveZone = (boundaryId: string) =>
  resolveEffectiveZone(boundaryId, boundaryById, defaultBoundaryId.value || '')
```

### `allBoundaries` is a function, not a computed — by design

`allBoundaries` is exposed as a plain function rather than a `computed`. This matches the store's
getter convention (`getNodeById`, `boundaryById`) and sidesteps a TypeScript instantiation depth
issue with the deeply-generic Vue Flow `Node` type under `computed()`. Reactivity is **not** lost:
because the function reads `nodes.value` on each call, invoking it **inside a consumer's own
`computed` or render function** re-tracks the `nodes` ref, so the consumer recomputes whenever
boundaries change. Callers must therefore call it inside their reactive scope — e.g.
`computed(() => flowStore.allBoundaries().map(...))` — rather than capturing the array once outside
one. The overview's row list, the picker's browse list, and the zoning tree are all built this way.

### `effectiveZone` and the inheritance contract

`effectiveZone` returns the `EffectiveZone` shape from `utils/effectiveZone.ts`:

```typescript
type EffectiveZone = {
  zone: Zone
  source: 'declared' | 'inherited' | 'default'
  from?: string // ancestor boundary id when source === 'inherited'
}
```

`resolveEffectiveZone` walks `node.parentNode` upward (an empty or null parent resolves to the
default boundary) to the nearest boundary with a non-null `data.zone`, capped at `MAX_DEPTH` (50)
and cycle-guarded. A match on the queried boundary itself is `'declared'`; a match on an ancestor
is `'inherited'` (with `from` set to that ancestor's id); reaching the top with nothing declared
returns `DEFAULT_ZONE` (`INTERNAL`) and `'default'`. Because the getter passes `boundaryById` as the
lookup, the walk also crosses into the default boundary. See
[the zoning utilities](../FRONTEND_ARCHITECTURE.md#boundary-zoning) for the full read-side.

### Server re-pin keeps the baseline correct

`updateBoundaryNode` re-pins `data.zone`, `data.domains`, `data.planes`, and `data.conduits` from the
mutation response after a successful save. This keeps the next save's optimistic-merge baseline aligned
with server truth, and is the reason `updateNode` snapshots the **pre-merge** conduit list as the conduit
delta baseline (`baselineConduits`; see [Narrowing the Write](#narrowing-the-write)), which
`updateBoundaryNode` then mirrors onto peer boundaries through `syncPeerConduits` — a `CONDUIT` is one
directed edge, and the mutation re-pins only the saved boundary, so without the mirror a peer's settings
would show a stale conduit list until a full model reload.

---

## Vue Flow Integration

### Node/Edge State

**Source:** `flowStore.ts:49-53`

```typescript
// Vue Flow reactive state
const nodes = ref<Node[]>([])
const edges = ref<Edge[]>([])

// Related data
const controls = ref<Control[]>([])
const dataItems = ref<DataItem[]>([])
const modules = ref<Module[]>([])
```

### Crown-Jewel Node Class

A component flagged as a **crown jewel** (`data.crownJewel === true`) carries a
`crown-jewel` CSS class on its Vue Flow wrapper, which `DataFlow/Style/main.css`
renders as a discrete gold treatment (a south-east gold cast plus a gradient
hairline that dissolves toward the top-left; gold is the `crownjewel` theme token in
`plugins/vuetify.ts`). The General-tab crown toggle
(`SettingsTabs/SettingsGeneralTab.vue`, gated to components only) persists the flag
through `saveItem → updateNode → DtComponent.updateComponent`. Like every other field,
it travels only when the edit names it: `saveItem` includes `crownJewel` in `updates`
only when it differs from the loaded value, and `updateComponent` writes
`crownJewel: { set: ... }` only when the node defines it (see
[Narrowing the Write](#narrowing-the-write)) — which is what keeps a follow-up
association-only write from clobbering a flag set at create time.

The class rides Vue Flow's **`node.class`** (not a manual DOM `classList`), so it
survives the framework's re-renders. It is derived purely from `data.crownJewel` by
the module-level `crownJewelClass(data)` helper at every point a component node is
(re)built:

- **Load** — `mapComponent` (dt-core) copies `crownJewel` into `node.data`; the store
  maps it to the class as components enter `nodes.value`.
- **Update reconciliation** — `updateComponentNode` re-derives the class from the
  (already deep-merged) in-memory `crownJewel`, since `UPDATE_COMPONENT` does not
  return the field. The data spread preserves `crownJewel`; only the stale class is
  recomputed.

Boundaries never set it (`componentType` is `null`, so the toggle is hidden and the
mapper runs for components only). The treatment layers over selection state, which
only changes the node fill.

### Selection Tracking

**Source:** `flowStore.ts:59` (state), `flowStore.ts` → `setSelectedItem`

```typescript
// Currently selected element (node or edge)
const selectedItem = ref<Node | Edge | null>(null)

const setSelectedItem = ({ item }: { item: Node | Edge | null }) => { selectedItem.value = item }
```

**Selection During Optimistic Updates** (all inside `createComponentNode` / `createBoundaryNode`):
- Phase 1: `selectedItem.value = optimisticNode` (immediate)
- Phase 3: selection re-pinned when the temp node is replaced with the real one
- `catch`: selection cleared on failure

`revertNode` and `revertEdge` do the same on a failed *update* — if `selectedItem` points at the
element being reverted, it is re-pinned to the snapshot so the settings panel does not keep rendering
an edit that was never saved.

### Boundary Nesting

**Source:** `flowStore.ts` → `createBoundaryNode`

Boundaries support hierarchical nesting. The parent is carried on the node itself (`newNode.parentNode`),
not as a separate argument — dt-core falls back to the default boundary when the node names no parent:

```typescript
const createBoundaryNode = async ({ newNode, classId }) => {
  const operationKey = 'createBoundary'
  const tempId = `temp-${Date.now()}`

  const optimisticNode = {
    id: tempId,
    type: newNode.type,
    position: newNode.position,
    data: {
      ...newNode.data,
      pending: true,
      label: newNode.data?.label || 'Creating boundary...'
    }
  }

  // Same three-phase pattern as components, via dtBoundary.createBoundaryNode({
  //   newNode, classId, defaultBoundaryId })
}
```

Nesting is re-expressed on update as `parentNode` — an empty string means "the default boundary", which
is why the writers gate the parent on presence rather than truthiness (see
[Narrowing the Write](#narrowing-the-write)). `deleteBoundaryNode` uses the same path: before deleting,
it re-parents each direct descendant to the grandparent boundary and offsets its position by the deleted
boundary's, through ordinary `updateNode` calls.

---

## State Synchronization

### Sync Helpers

**Source:** `flowStore.ts` → `syncDataItems`, `syncControls`

When a node update returns related data (data items, controls), sync helpers ensure consistency:

```typescript
const syncDataItems = (newDataItems: DataItem[]) => {
  newDataItems?.forEach((dataItem: DataItem) => {
    const index = getDataItemIndexById({ dataItemId: dataItem.id })
    if (index !== -1) {
      // Update existing
      dataItems.value.splice(index, 1, dataItem)
    } else {
      // Add new
      dataItems.value.push(dataItem)
    }
  })
  // Force reactivity
  dataItems.value = [...dataItems.value]
}

const syncControls = (newControls: Control[]) => {
  newControls?.forEach((control: Control) => {
    const index = getControlIndexById({ controlId: control.id })
    if (index !== -1) {
      controls.value.splice(index, 1, control)
    } else {
      controls.value.push(control)
    }
  })
  controls.value = [...controls.value]
}
```

### Usage in Node Updates

**Source:** `flowStore.ts` → `updateComponentNode`, `updateBoundaryNode`, `updateDataFlow`

```typescript
const updateComponentNode = async ({ updatedNode, baselineLinks }) => {
  const updatedComponent = await dtComponent.updateComponent({
    updatedNode,                                        // already projected by updateNode
    defaultBoundaryId: defaultBoundaryId.value || '',
    baselineLinks,                                      // pre-merge link baseline, may be undefined
  })
  if (!updatedComponent) return false

  // Splice the server's answer back into nodes.value, re-pin selectedItem, then:
  syncDataItems(updatedComponent.dataItems || [])
  syncControls(updatedComponent.controls || [])
  return true
}
```

The dt-core method is `DtComponent.updateComponent` (the store's wrapper is what is called
`updateComponentNode`). `updateBoundaryNode` and `updateDataFlow` call the same two sync helpers on their
own results; `updateBoundaryNode` additionally gates concurrent saves of one boundary behind the
`updateBoundary-<id>` operation flag, which the UI binds to disable **Save** while a save is in flight.

---

## DtUtils Concurrency Patterns

### Promise-Based Mutex

**Source:** `packages/dt-core/src/dt-utils/dt-utils.ts` → `withMutex`

Serialises execution of the same operation — a real FIFO queue, not a "wait for whoever is in the map":

```typescript
private mutex: Map<string, Promise<any>> = new Map()

async withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  // Chain each caller after the previous holder's *tail*, so at most one `fn` per key is
  // ever in flight. `prev.then(fn, fn)` runs ours once the predecessor settles regardless
  // of its outcome, so we never inherit the predecessor's rejection.
  const prev = this.mutex.get(key) ?? Promise.resolve()
  const run = prev.then(() => fn(), () => fn())
  const tail = run.then(() => {}, () => {})   // settle-only; what the next waiter chains on
  this.mutex.set(key, tail)

  try {
    return await run
  } finally {
    // Identity-checked: only ever remove our own entry, never a later waiter's.
    if (this.mutex.get(key) === tail) this.mutex.delete(key)
  }
}
```

**Mutex Key Pattern:**
```typescript
const mutexKey = `${action}-${JSON.stringify(variables)}`
// Example: "updateComponentNode-{\"componentId\":\"123\",\"input\":{...}}"
```

The serialised variables are part of the key, so the mutex serialises *identical* submissions only. Two
different edits of one element carry different variables, so they do not queue behind each other.

### Request Deduplication

**Source:** `dt-utils.ts` → `withDeduplication`, `performMutation`

Lets identical in-flight submits share one promise:

```typescript
private requestDeduplicator = new Map<string, Promise<any>>()
private requestMetadata = new Map<string, { timestamp: number; count: number }>()

private async withDeduplication<T>(
  key: string,
  operation: () => Promise<T>,
  ttl: number = 15000
): Promise<T> {
  // Join an in-flight request under this key, if any.
  const existing = this.requestDeduplicator.get(key) as Promise<T> | undefined
  if (existing) {
    const metadata = this.requestMetadata.get(key)
    if (metadata) metadata.count++
    return existing
  }

  // Start a new request. Clear the TTL timer on settle, and evict only if the stored
  // entry is still *this* promise, so a stale timer can never drop a newer entry
  // mid-flight. The TTL is a leak backstop only — mutations no longer retry, so it
  // comfortably exceeds any single operation's lifetime.
  let timer
  const promise = operation().finally(() => { /* clearTimeout + identity-checked evict */ })

  this.requestDeduplicator.set(key, promise)
  this.requestMetadata.set(key, { timestamp: Date.now(), count: 1 })
  timer = setTimeout(() => { /* identity-checked evict */ }, ttl)

  return promise
}
```

### The effective deduplication key

**Source:** `dt-utils.ts` → `performMutation`

Callers pass a readable `deduplicationKey` — `update-component-<id>`, `update-boundary-<id>`,
`update-dataflow-<id>` — but that string is **not** the key requests are joined on. `performMutation`
folds the serialised variables in:

```typescript
const mutexKey = `${action}-${JSON.stringify(variables)}`
const exec = () => this.withMutex(mutexKey, () => this.executeActualMutation(...))

if (deduplicationKey !== false && deduplicationKey) {
  const dedupKey = `${deduplicationKey}::${mutexKey}`
  return await this.withDeduplication(dedupKey, exec)
}
return await exec()
```

The consequence is worth stating plainly, because the caller-supplied key reads as if it were per-element:

- **Identical** submits (same action, same variables — a double-clicked Save) collapse onto one in-flight
  promise and one network call.
- **Different** writes that happen to share an id-only caller key do *not* collapse — and equally, they do
  not serialise, because `mutexKey` differs too. Two saves of one element issued back to back run
  concurrently. Do not assume they queue.

Dedup sits *outside* the mutex, so identical rapid submits share one flight rather than serialising and
then re-executing. `deduplicationKey: false` disables joining entirely — every delete passes it.

Element-level ordering, where it is needed, is enforced above dt-core: `updateBoundaryNode` sets an
`updateBoundary-<id>` operation flag and the UI disables **Save** while it is set.

### Deep Merge Utility

**Source:** `dt-utils.ts` → `deepMerge`

Used for the optimistic merge and for folding deferred updates together:

```typescript
deepMerge (target: any, updates: any) {
  // Own enumerable keys only, and reuse an existing nested value only when it is an own
  // object — never resolve or write through inherited members onto shared built-ins.
  for (const key of Object.keys(updates)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    if (updates[key] && typeof updates[key] === 'object' && !Array.isArray(updates[key])) {
      // Recursive merge for nested objects
      const existing = Object.hasOwn(target, key) ? target[key] : undefined
      target[key] = (existing && typeof existing === 'object') ? existing : {}
      this.deepMerge(target[key], updates[key])
    } else {
      // Direct assignment for primitives and arrays
      target[key] = updates[key]
    }
  }
  return target
}
```

**Arrays are replaced, not merged** — which is exactly why `projectEdit` treats them as leaves
(see [Narrowing the Write](#narrowing-the-write)).

### Retry with Exponential Backoff

**Source:** `dt-utils.ts` → `retryNetworkOperation`

**Queries only.** Mutations are deliberately *not* retried: a network-classified failure (timeout, 502,
504) may mean the write already committed server-side, so a blind retry risks a duplicate node. Only
`performQuery` wraps its work in this helper.

```typescript
private async retryNetworkOperation<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_NETWORK_RETRY
): Promise<T> {
  let lastError: any

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error

      // Only retry network/transport failures
      if (attempt === config.maxRetries || !this.isNetworkError(error)) {
        throw error
      }

      // Exponential backoff: 1s, 2s, 4s (capped at maxDelay)
      const delay = Math.min(
        config.baseDelay * Math.pow(2, attempt),
        config.maxDelay
      )

      console.warn(`Retrying (attempt ${attempt + 1}/${config.maxRetries + 1}) after ${delay}ms`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError
}
```

**Default Configuration:**
```typescript
const DEFAULT_NETWORK_RETRY = {
  maxRetries: 3,
  baseDelay: 1000,  // 1 second
  maxDelay: 5000    // 5 seconds cap
}
```

---

## Error Classification

### Error State Management

**Source:** `flowStore.ts` → `setError`, `clearError`, `setOperationLoading`

```typescript
const errors = ref<Record<string, string>>({})
const operationStates = ref<Record<string, boolean>>({})

const setError = (key: string, message: string) => {
  errors.value = { ...errors.value, [key]: message }
}

const clearError = (key: string) => {
  const newErrors = { ...errors.value }
  delete newErrors[key]
  errors.value = newErrors
}

const setOperationLoading = (operation: string, loading: boolean) => {
  operationStates.value = { ...operationStates.value, [operation]: loading }
}
```

**Key Pattern:**
- Operation-specific error keys isolate failures
- Examples: `createComponent`, `createBoundary`, `updateBoundary-<nodeId>`,
  `updateRepresentedModel-<nodeId>`
- UI can display errors per-operation without interference; the same keys drive
  `isOperationLoading`, which is how **Save** is disabled mid-save

### handleApiError

**Source:** `flowStore.ts` → `handleApiError`

Classifies a transport error into a user-facing message. It does not throw and does not log the raw
error to the user:

```typescript
const handleApiError = (error: Error, action: string): string => {
  const errorMessage = error.message || error.toString()

  if (errorMessage.includes('401') || errorMessage.includes('unauthorized')) return 'Please log in again to continue'
  if (errorMessage.includes('403') || errorMessage.includes('forbidden')) return 'Access denied to this resource'
  if (errorMessage.includes('404') || errorMessage.includes('not found')) return 'Resource not found'
  if (errorMessage.includes('network') || errorMessage.includes('fetch')) return 'Connection failed. Please check your internet connection.'
  if (errorMessage.includes('timeout')) return 'Request timed out. Please try again.'

  return `Failed to ${action}. Please try again.`
}
```

Transport-level diagnostics are logged separately by `DtUtils.handleError`, which the store calls on the
paths that have no user-facing message of their own.

---

## Complete State Reset

**Source:** `flowStore.ts` → `resetStore`

```typescript
const resetStore = () => {
  // Clear Vue Flow state and related data
  nodes.value = []
  edges.value = []
  controls.value = []
  dataItems.value = []
  modules.value = []

  // Clear model context
  modelId.value = undefined
  currentModel.value = null
  defaultBoundaryId.value = undefined
  selectedItem.value = null
  mitreAttackTactics.value = []
  activeModelLoad = null        // in-flight model-load guard; plain let, not a ref

  // Clear error and loading states
  clearAllErrors()
  isLoading.value = false
  operationStates.value = {}

  // Clear temporary node tracking
  pendingNodes.value.clear()
  tempNodeMapping.value.clear()
  deferredUpdates.value.clear()

  // Reset UI preferences
  editMode.value = false
  openedEmpty.value = false
}
```
