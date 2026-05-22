# Control Library — Local File Layout and Sync Semantics

> Design for managing per-instance Control configuration outside the model sync path.
>
> **Status: implemented.** Companion to [CONTROL_INTEGRATION.md](CONTROL_INTEGRATION.md), which covers control assignment semantics and two-tier reporting. **Supersedes** [CONTROL_INTEGRATION.md §6.1](CONTROL_INTEGRATION.md#61-two-path-control-integration) on the timing of greenfield Control creation: this doc defers the `manage_controls` create call to sync push (with a temp local id) instead of invoking it eagerly during the control pass. The reference shape in [§6.4](CONTROL_INTEGRATION.md#64-local-json-format) (`{id, name, source}`) is unchanged.

## Table of Contents

- [1. Problem Statement](#1-problem-statement)
- [2. Why Not in `structure.json`](#2-why-not-in-structurejson)
- [3. Proposed Layout — `controls/` Folder](#3-proposed-layout--controls-folder)
- [4. Per-Control File Schema](#4-per-control-file-schema)
- [5. Lifecycle: Greenfield → Brownfield](#5-lifecycle-greenfield--brownfield)
- [6. Shared-Ownership Safety](#6-shared-ownership-safety)
- [7. Sync Flows](#7-sync-flows)
- [8. Agent Workflow Changes](#8-agent-workflow-changes)
- [9. What Needs Building](#9-what-needs-building)
- [10. Open Questions](#10-open-questions)
- [11. Decisions](#11-decisions)
- [12. Out of Scope](#12-out-of-scope)
- [13. V1.1 Roadmap](#13-v11-roadmap)
- [Appendix A. Implementation Notes](#appendix-a-implementation-notes) (A.1 – A.12, including hardening design-choice rationale at A.12)

---

## 1. Problem Statement

The platform's `setInstantiationAttributes(componentId, classId, attributes)` mutation writes per-instance configuration values onto the `IS_INSTANCE_OF` edge between a Control and its ControlClass. Today the threat-model sync pipeline never invokes it for Controls — it only handles attributes on Boundaries, Components, DataFlows, and DataItems.

The first attempt to close this gap added `classId` and `attributes` fields to each `controls[]` entry inside `structure.json` / `dataflows.json` and a sync helper in `DtUpdate` / `DtImport` that wrote them via `setInstantiationAttributes`. That approach was reverted (see Section 2) and this document specifies the replacement.

**Authority placement.** Per [SYNC_AND_SOURCE_OF_TRUTH.md §1](SYNC_AND_SOURCE_OF_TRUTH.md#1-source-of-truth-dual-authority-model) the dual-authority table is amended: greenfield Controls (and their per-instance attributes) are local-authoritative until first push promotes them to brownfield, after which the platform is authoritative. Push under this design is a **publish operation**, not a bidirectional sync — same semantics as the rest of `sync push`.

---

## 2. Why Not in `structure.json`

Three concrete problems with embedding control attributes inside the model's structural files:

1. **Controls are reusable, model-independent entities.** A single Control on the platform (e.g. "Azure Firewall (MCE/MCETest Hub)") is typically assigned via SUPPORTS edges to elements across multiple models. Its instantiation attributes (on the IS_INSTANCE_OF edge to its ControlClass) are global properties of that Control, not per-model. Storing them inside any one model's `structure.json` makes that model the apparent owner of state that is in fact shared.

2. **File-size explosion.** A single ControlClass template can carry 30+ attribute fields. A typical infrastructure boundary may reference 4–8 controls, each potentially bound to multiple ControlClasses. Inlining attributes across the boundary/component/dataflow tree pushes `structure.json` well past the size threshold that motivated the split-file schema in the first place ([SYNC_AND_SOURCE_OF_TRUTH.md](SYNC_AND_SOURCE_OF_TRUTH.md)).

3. **Export/import asymmetry.** [`dt-export-split.ts`](../../packages/dt-core/src/dt-export/dt-export-split.ts) intentionally flattens each control reference to `{id, name}` only — `classId` and `attributes` are never written on export. An import path that reads them from `structure.json` therefore drifts from export, and round-trips silently lose data.

The design below moves Control configuration into a dedicated peer of `attributes/` so each Control owns its own file, sized independently of the models that reference it.

---

## 3. Proposed Layout — `controls/` Folder

```
threat-models/<model>/
├── manifest.json
├── structure.json             ← controls[] = [{ id, name, source }] only
├── dataflows.json             ← same minimal shape
├── data-items.json
├── attributes/                ← per-element attributes (existing)
│   ├── boundaries/<id>.json
│   ├── components/<id>.json
│   └── dataFlows/<id>.json
└── controls/                  ← NEW — per-control configuration
    └── <control-id>.json
```

`controls/<id>.json` is created when:
- The agent **assigns** a brownfield platform Control to any element in this model (file is auto-pulled from platform state), OR
- The agent **creates** a new greenfield Control during enrichment (file is the source of truth until first push).

There is no `_index.json` lookup file. The folder is small enough to scan, and an index would risk drift versus the per-control files. Agents that need a name→id mapping should keep it in conversation memory or scan the folder.

`structure.json` and `dataflows.json` continue to carry only the minimal control reference shape:

```json
{ "id": "ctrl-uuid", "name": "Azure Firewall", "source": "declared" }
```

This matches the export contract exactly.

---

## 4. Per-Control File Schema

```json
{
  "id": "bcdd0034-a355-4ffc-aac3-98083c5416f8",
  "name": "Azure Firewall (MCE/MCETest Hub)",
  "source": "declared",
  "lifecycle": "brownfield",
  "classes": [
    {
      "classId": "d3e851bb-caaa-4db4-a134-3afc13595c58",
      "className": "Firewall Policy",
      "moduleId": "<module-uuid>",
      "attributes": {
        "inbound_firewall_enabled": true,
        "default_inbound_policy": "log_only",
        "egress_filtering_enabled": true
      },
      "platformAttributes": {
        "inbound_firewall_enabled": true,
        "default_inbound_policy": "deny",
        "egress_filtering_enabled": true
      },
      "localEditedAt": "2026-04-17T19:05:42Z",
      "pushedAt": "2026-04-17T18:42:11Z",
      "pendingEdit": {
        "editedBy": "agent",
        "editedAt": "2026-04-17T19:05:42Z",
        "previousAttributes": {
          "default_inbound_policy": "deny"
        }
      }
    }
  ],
  "platformState": {
    "lastSyncedAt": "2026-04-17T18:42:11Z",
    "lastPushedAt": "2026-04-17T18:55:42Z",
    "assignedModelCount": 3,
    "assignedModelIds": [
      "this-model-id",
      "model-b-id",
      "model-c-id"
    ]
  }
}
```

### Field-by-field

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Platform Control ID once promoted to brownfield. While `lifecycle: "greenfield"`, a temp local id (`greenfield-<short-uuid>`) — replaced via the WAL-protected id-rewrite mechanism (see [§7 ID write-back](#id-write-back-wal-protected)) immediately after the platform create succeeds, before any per-class attribute mutation runs. |
| `name` | yes | Mirrors the `name` in `controls[]` references; useful for human review of the file. |
| `source` | yes | Same `discovered` / `declared` / `both` semantics already documented in [controls-enrichment.md](../../apps/dethereal/docs/controls-enrichment.md). Mirrors the `source` field on the corresponding `controls[]` reference in `structure.json`. |
| `lifecycle` | yes | One of `greenfield`, `partially-pushed`, `brownfield`, or `tombstoned`. Sync writes this back. See [§5](#5-lifecycle-greenfield--brownfield) for transitions. |
| `classes[]` | yes | One entry per ControlClass the Control is `IS_INSTANCE_OF`. A single Control can be an instance of multiple classes (e.g. an Azure Firewall is both "Firewall Policy" and "Network Access Control"); each class has its own template and its own attribute payload. |
| `classes[].classId` | yes | ControlClass UUID. Drives the `setInstantiationAttributes` mutation. |
| `classes[].className`, `moduleId` | no | Cached from platform for human readability and for the agent to skip a `get_classes` round-trip when populating attributes. |
| `classes[].attributes` | yes | Per-instance values whose keys must match the ControlClass template's `properties`. Empty object `{}` is valid (agent has not yet observed values). The **editable** copy. |
| `classes[].platformAttributes` | brownfield / partially-pushed only | Raw payload as returned by the platform on last successful push or pull. Diff is computed against this, not against the agent-edited `attributes` field. Insulates against false positives from server-side normalization (string trimming, default-value coercion). Re-read fresh from the platform at the start of every brownfield push (see [§7 brownfield Step A](#push--brownfield-controls)) so a concurrent push from another operator doesn't make our snapshot stale. |
| `classes[].localEditedAt` | yes (when `attributes` differs from `platformAttributes`, or on greenfield) | ISO-8601 of the last agent or operator write to this `attributes` payload. Bumped explicitly by the writer — **not** filesystem mtime, which is unreliable across `git checkout`, editor rewrites, and CI clones. Drives Step B's resume-skip logic (skip class entries whose `pushedAt` is `>= localEditedAt`). |
| `classes[].pushedAt` | brownfield / partially-pushed only | ISO-8601 of the last successful `setInstantiationAttributes` for this class entry. Enables resume from `partially-pushed`. |
| `classes[].pendingEdit` | present only between agent edit and next push | Marker block that the security-enricher agent or operator writes when modifying a brownfield class entry's `attributes`. **Records exactly which keys were intended to change and what their pre-edit values were** (`previousAttributes` is keyed by changed-attribute name, not the full attribute payload). The push phase uses this key set to determine which keys to send to the platform — see [§7 brownfield Step D](#push--brownfield-controls) and [DEC-CL-11](#11-decisions). This narrow-payload contract is what protects against the mid-session-staleness corruption case where another operator pushed an edit to a different key in between our pull and our push.<br><br>**Two-write semantic.** When an existing `pendingEdit` block is being updated by a subsequent edit (operator/agent edits the same class entry twice in one session, or a session resumes from a partially-pushed state), the writer **does not overwrite** `previousAttributes` for keys already recorded — the original pre-edit value is what represents the operator's intent baseline. Rule: for each key `k` in the new edit, set `previousAttributes[k] = entry.attributes[k]` **only if `k` is not already in `previousAttributes`**. Then update `entry.attributes[k]` to the new value. Result: `previousAttributes[k]` always holds the pre-edit value as of the FIRST agent/operator write within the current pendingEdit lifecycle, never an intermediate value. The write helper in [§9 dt-core local file machinery](#dt-core--local-file-machinery) enforces this rule.<br><br>Cleared on successful push, on operator-cancel, or on operator-driven revert (the revert path also writes a `reverted` audit-log entry — see [§6 Audit log](#audit-log)). **Lives in-file**, not in a side-file: keeps git-diff visibility on every PR review. See [DEC-CL-6](#11-decisions). |
| `platformState` | brownfield / partially-pushed only | Cached snapshot of platform-wide state at last interaction (model assignments only — attribute snapshots live per-class above). Used by `/dethereal:status` for drift display only — **not** by the shared-ownership check, which always queries fresh (see §6). Greenfield files have no `platformState` until first successful push. |
| `platformState.lastSyncedAt` | brownfield / partially-pushed only | ISO-8601 of the most recent successful **pull** (auto-pull at start of control pass, or explicit `/dethereal:sync pull`). Drives the freshness side of `/dethereal:status` drift display ("attributes pulled 4 hours ago — refresh recommended"). Never bumped by push operations; `setInstantiationAttributes` doesn't return enough information about other operators' pre-existing values to warrant a freshness claim. |
| `platformState.lastPushedAt` | brownfield / partially-pushed only | ISO-8601 of the most recent successful **push** (any class entry on this Control had `setInstantiationAttributes` mutated successfully). Drives the activity side of `/dethereal:status` drift display ("you pushed 2 minutes ago"). Distinct from `lastSyncedAt` because pushing bytes does not refresh the local snapshot of other operators' values. |

### Why `classes[]` is a list

A Control may be `IS_INSTANCE_OF` multiple ControlClasses. The platform mutation is per-(Control, ControlClass) pair, so the local file mirrors that shape: one entry per class, one mutation per entry on push. Existing platform behaviour ([`dt-control.ts`](../../packages/dt-core/src/dt-control/dt-control.ts) `assignControlToElements`) confirms multi-class Controls are first-class.

### Why both `attributes` and `platformAttributes`

`attributes` is the agent-editable copy. `platformAttributes` is the immutable last-known-server payload. The brownfield push diff (§7) computes against `platformAttributes`, never against `attributes` itself; this is the only correct way to detect "user actually changed something" vs "server returned a normalised version of what we sent". A single field is ambiguous: if the platform trims `"deny "` to `"deny"` on save, a one-field design would either flag every push as a diff (false positive prompt fatigue) or silently miss real edits.

---

## 5. Lifecycle: Greenfield → Brownfield

### States

| State | Source of truth | Sync direction |
|---|---|---|
| `greenfield` | local file | local → platform (create + setInstantiationAttributes per class + assign SUPPORTS) |
| `partially-pushed` | local file (resume) | local → platform; only class entries with `pushedAt < localEditedAt` are re-attempted |
| `brownfield` | platform | platform → local (cache); local edits gated by [shared-ownership safety](#6-shared-ownership-safety) |
| `tombstoned` | local file (orphan record) | none — Control no longer exists on the platform; file kept for recovery / inspection |

### Transitions

```
greenfield ──[create OK + WAL-protected id write-back]──▶ partially-pushed ──[all classes pushed]──▶ brownfield
                                                            ▲                                          │
                                                            │                                          │ [next pull's
                                                            │                                          │  getControl
                                                            │ [any class fails or interrupted;         │  returns 404]
                                                            │  retry resumes from partially-pushed]    │
                                                            │                                          │
                                                            └─────────[partially-pushed loop]──────────┤
                                                                                                       ▼
                                                                                                  tombstoned
```

The right-hand arrow originates from **brownfield** (a Control that was successfully pushed and later deleted on the platform), not from `partially-pushed`.

- **greenfield → partially-pushed.** As soon as the platform create returns, write the server id back via the WAL-protected id-rewrite mechanism (see [§7 ID write-back](#id-write-back-wal-protected)) — into the per-control file and into every `controls[]` reference in `structure.json` / `dataflows.json` — before attempting any per-class attribute mutation. Flip lifecycle to `partially-pushed`. This is the idempotency anchor — a retry after this point will not duplicate the Control on the platform.
- **partially-pushed → brownfield.** When all `classes[]` entries have `pushedAt >= localEditedAt` and SUPPORTS edges are confirmed, flip to `brownfield` and populate `platformState`.
- **partially-pushed → partially-pushed (retry).** Resumable. Skip class entries whose `pushedAt >= localEditedAt` (already-pushed work is not re-applied).
- **brownfield → tombstoned.** Pull-time `getControl(id)` returning 404 (or `getControls({ids: [...]})` returning the id with no payload) flips the file to `tombstoned`. The `pendingEdit` block (if any) is preserved so the operator can recover edits via clone-and-swap.

### Drift / cleanup transitions

| Local-file reaction to platform event | Behaviour |
|---|---|
| **Control deleted on platform** (next pull's `getControl` returns 404) | Flag the local file with `lifecycle: "tombstoned"` and warn at next `/dethereal:enrich --focus controls` or `/dethereal:status`. Do not auto-delete the local file — operator may want to recover it as a greenfield re-create. The corresponding `controls[]` references in `structure.json` are left in place; sync will fail to resolve them and surface a `Could not resolve control` warning, which the operator can fix by re-running enrich or removing the reference. |
| **Local-side Control rename** | Not supported in V1. The `name` field is platform-authoritative for brownfield Controls and is overwritten on every pull (we pull by id, so resolution is unaffected). To rename, clone-and-swap (§6 option 3). |
| **ControlClass removed from a Control on platform** | Pull drops the corresponding `classes[]` entry from the local file and emits a warning. If the agent had pending local edits in that entry (`pendingEdit` populated), they are surfaced to the operator before the drop (cancel / accept loss / clone-and-swap). |
| **Orphan local file** (`controls/<id>.json` exists with no matching `controls[]` reference in `structure.json` or `dataflows.json`) | Validator emits a warning (not error). Cleaned up by the operator or by a future `pnpm dethereal gc` command. Out of scope for V1 to auto-delete — could mask real bugs. |

### No demotion

Brownfield Controls do not become greenfield again. Tombstoned Controls do not become brownfield again — recovery is via clone-and-swap, which produces a fresh greenfield. Deleting a Control on the platform is out of scope here — it goes through `manage_controls(action: 'delete')`. The local file's reaction to that deletion is the `tombstoned` row above.

---

## 6. Shared-Ownership Safety

> **Section boundary.** §6 specifies the **operator-facing UX** of the safety check (prompts, verbs, batched review, audit-log shape). [§7](#7-sync-flows) specifies **where in the push pipeline** the check fires (Step ordering, idempotency, WAL, partial-payload semantics). Both sections describe push-time behaviour; the cross-references resolve overlap rather than duplicate intent.

Brownfield attribute edits must be gated because Controls are shared across models. Editing one model's local Control file and pushing would silently mutate every other model that references the same Control.

### Check

Before any brownfield attribute push, sync queries the platform for the **live** set of model IDs (`liveAssignedModelIds`) that reference each touched Control. Fresh query at push time, not the cached `platformState.assignedModelIds` (which is for `/dethereal:status` drift display only). Single batched GraphQL call per push.

The platform schema has Models reaching elements via `(:Model)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*]-(:Component|:SecurityBoundary)` for boundary/component supports, and via `(:Component)-[:FLOWS]-(:DataFlow)` for data-flow supports. A naive single-pattern query that uses `HAS_CHILD*` (which doesn't exist as an edge label) would always return zero models for DataFlow-attached Controls, silently passing the safety check — verified against the live Memgraph schema. The correct batched query:

```cypher
UNWIND $controlIds AS cid
MATCH (c:Control {id: cid})
OPTIONAL MATCH (c)-[:SUPPORTS]->(e)
OPTIONAL MATCH (m1:Model)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..10]-(e)
  WHERE e:Component OR e:SecurityBoundary
OPTIONAL MATCH (e2:DataFlow)<-[:SUPPORTS]-(c)
OPTIONAL MATCH (e2)-[:FLOWS]-(:Component)-[:BELONGS_TO*0..10]->(:SecurityBoundary)<-[:CONTAINS]-(m2:Model)
WITH cid, collect(DISTINCT m1.id) + collect(DISTINCT m2.id) AS ms
UNWIND ms AS m
WITH cid, m WHERE m IS NOT NULL
RETURN cid AS controlId, collect(DISTINCT m) AS modelIds
```

Notes:
- Variable-length paths capped at `*0..10` defensively (real boundary depth is 3–5; cap prevents pathological plans on cyclic/malformed graphs). Implementation should log a metric whenever a returned path actually used depth ≥ 8 — that signals graph corruption (cycles or malformed `BELONGS_TO`) worth investigating.
- Separate `OPTIONAL MATCH` clauses, not comma-joined multi-patterns — known Memgraph planner weakness.
- Components and DataFlows are handled in separate branches because DataFlow reaches a Model only via its `FLOWS`-attached Components.
- The trailing `UNWIND ms / collect(DISTINCT m)` block deduplicates **across branches**: a Control supporting both a Component and a DataFlow that route to the same Model returns one model id, not two. The simpler `collect(DISTINCT m1.id) + collect(DISTINCT m2.id)` form deduplicates only within each branch.
- Empty result for a Control with no SUPPORTS edges = `modelIds == []`, treated as safe to edit (Control was just created and not yet referenced).
- **DataFlow branch is currently untested in demo fixtures.** demo1/demo2 contain zero `(:Control)-[:SUPPORTS]->(:DataFlow)` edges (verified live). Whoever writes integration tests for `getControlsAssignedModels` must build a synthetic Control→DataFlow fixture; do not assume the demo dataset exercises this path.
- **Required indexes.** Memgraph has no auto-index on `id` properties. Without per-label indexes on `id` the query does a full label scan per `UNWIND` row — at production scale (~10k controls × 50 in batch) that's ~500k row touches per push. The migration that adds the required indexes is listed in [§9 Platform / database](#platform--database) — confirmed via live `EXPLAIN`: `Filter (c :Control), {c.id} / ScanAll (c)` becomes `ScanAllByLabelProperties (c :Control {id})` after the index lands.
- **Caller contract for missing IDs.** If `$controlIds` contains an id with no matching `:Control` node, the row is silently dropped (the leading `MATCH` fails). The dt-core wrapper must reconcile `requested vs returned`, **filtered by local lifecycle**:
  - For ids whose local lifecycle is `brownfield` or `partially-pushed` → "Control deleted upstream". Refuse the push for that id, flip the local file to `tombstoned` per [§5 drift transitions](#drift--cleanup-transitions), and surface to the operator.
  - For ids whose local lifecycle is `greenfield` → expected absence (the Control hasn't been pushed yet). The wrapper omits these from the `controlIds` batch in the first place; this is a defensive note in case a caller passes them by mistake.
  - **Never tombstone based on a single missing-id observation alone** without checking lifecycle — a brand-new Control pushed by another operator on a separate branch may not yet be visible from this branch's perspective.
- **Bolt partial-result handling.** Treat any non-`SUCCESS` Bolt terminal (timeout, mid-stream `FAILURE`) as **refuse-all** rather than reconciling against the partial set of rows already streamed. Partial results from an aborted transaction are not safe to interpret as "definitive list of controls present on platform".
- **Result ordering.** Memgraph returns rows in index-scan order, not `$controlIds` order. The wrapper must build `Map<controlId, modelIds[]>` keyed by the returned `controlId` field — never positional alignment with the input array.
- **Client-side dedupe.** `Array.from(new Set(controlIds))` before the call. Duplicate ids in `$controlIds` would produce redundant UNWIND rows; the result Map handles this gracefully but the redundant work is avoidable.
- **Do not `PROFILE` this query on Memgraph 3.x.** Confirmed crash-on-PROFILE (segfault, full server restart) on the live `bolt://localhost:7687` instance during round-4 review. Use `EXPLAIN` for plan inspection; rely on application-level timing for cardinality/perf measurement until upstream Memgraph fixes the planner crash.
- **TypeScript parameter typing.** `controlIds` must be a JS `string[]`, never `null` or `Set`. A `null` UNWIND silently produces zero rows. Wrap with `if (!controlIds?.length) return new Map()` before the Bolt call.

This query lives behind a new `dtControl.getControlsAssignedModels(controlIds: string[])` method as the cleanest seam.

### Behaviour

| `liveAssignedModelIds` for this Control | Sync behaviour |
|---|---|
| `[thisModel]` (alone) | Push attributes — safe. |
| `[thisModel, ...others]` (shared) | **Refuse by default.** Defer to operator-decision queue (see "Handoff" below). On operator confirmation: see three options below. |
| `[]` (no SUPPORTS edges yet — race against assignment) | Treated as safe; push attributes. The SUPPORTS edges this push is about to create are this model's. If a concurrent push from another model added a SUPPORTS edge in the same window, that's a TOCTOU acknowledged in [§10 Q3](#10-open-questions) — V1 limitation. |
| **Query failed** (network, auth, schema mismatch) | **Refuse by default with explicit error.** Do NOT fall back to the cached `platformState.assignedModelIds`, do NOT silently skip, do NOT assume "alone". Per-control behaviour in the batched review screen; see "Error-path UX" below. |

Three options when shared (operator picks at the prompt):

1. **Cancel** — make no change to the Control on the platform; leave existing platform attributes intact. The local edits remain in `classes[].attributes` (and the `pendingEdit` block stays populated) and the prompt fires again on the next push attempt.
2. **Push anyway** — explicit approval; the sync proceeds and writes a `force-shared` audit-log entry recording: timestamp, operator, control id, the live `liveAssignedModelIds` at decision time, the attribute diff, and the resulting `setInstantiationAttributes` mutation timestamps. The audit entry enables post-hoc reconstruction of who-changed-what when two operators legitimately race (V1 limitation; see [§10 Q3](#10-open-questions)).
3. **Clone-and-swap** — create a new Control on the platform from the local file, copy attributes, repoint this model's `controls[]` reference to the new Control. Other models keep the original Control unchanged.

   **Default name:** `<original name> (<thisModel.name>)`. Never `(local copy)` — that produces unreadable libraries (`(local copy) (local copy)`) over time.

   **Name sanitisation:** the platform's Control-name validation rules are applied to the default before presenting it to the operator. The current platform regex (subject to schema confirmation at implementation time) treats Control names as free text but rejects characters that break Cypher string escaping, GraphQL identifiers, and filesystem-derived display contexts: `/`, `\`, `"`, control characters (U+0000–U+001F), and trailing/leading whitespace. Apply this sanitisation to `thisModel.name` before substituting (e.g. a model named `Customer A / Prod` produces a default of `<original> (Customer A - Prod)`). Length is capped at the platform's name-length limit (256 characters as of writing), with `…` truncation suffix if needed.

   The operator is **prompted with the sanitised default pre-filled** and can override. Operator-typed names are **re-validated** against the same regex before submission to `manage_controls(action: 'create')`; failures show the violating characters and re-prompt.

   **Collision handling:** before submitting, run `manage_controls(action: 'list', name: <chosen>)` against the org's library. If a name collision exists, present three options: append a numeric suffix (`(2)`), prompt for a different name, or abort the clone.

   After successful create, the old `controls/<old-id>.json` is removed in the same WAL-protected rewrite that creates the new file (see [§7 ID write-back](#id-write-back-wal-protected)) — a half-applied swap that left the old file behind would re-fire the prompt next push.

The default (option 1) is non-destructive. There is no automatic "push without asking" path — explicit approval is required every time the safety check fires.

### Prompt content (single-control)

The prompt must give the operator enough to make an informed choice. "N other models" alone hides blast radius. Required content:

```
Shared Control: Azure Firewall (MCE/MCETest Hub)
This Control is also assigned to 2 other models (3 total):
  - Production Stack
  - Staging Environment
  (and 0 more — full list with `show models 1`)

You are about to change these attributes on the IS_INSTANCE_OF edge to ControlClass "Firewall Policy":

  default_inbound_policy:    "deny"     →  "log_only"   (you proposed)
  egress_filtering_enabled:  true       →  false        (you proposed)

  No other attributes are touched (push uses partial payload; see DEC-CL-11).

Affected ControlClass: Firewall Policy (1 of 1 classes on this Control)

Choose:
  cancel        Leave platform attributes unchanged. Local edits stay; prompt fires again next push.
  push-anyway   Apply YOUR changes to all 3 models. Audit-log entry written. Server keys you
                did not propose to change are left untouched.
  clone         Create a new Control as a fork of this one and repoint this model only;
                other models keep the original Control unchanged.
```

When **conflict** is detected on at least one key (server value changed since our snapshot — see [§7 brownfield Step D](#push--brownfield-controls)), the relevant key rows are replaced with a typed 3-way display and additional per-key choices:

```
  default_inbound_policy (string):
    "deny"           →  "log_only"      (you proposed)
    "alert_only"                        (server changed since your pull)
    Per-key choice:  keep 1.default_inbound_policy
                   | accept-theirs 1.default_inbound_policy
                   | merge 1.default_inbound_policy = <value>

  egress_filtering_enabled (boolean):  true → false   (you proposed; no conflict)
```

- The display includes the attribute's JSON Schema type (`string`, `boolean`, `integer`, `number`, `array`, `object`) drawn from the ControlClass template. Operators need this to type the `merge` value correctly — `merge ... = true` is a boolean, `merge ... = "true"` is a string.
- **Per-key choice syntax** (used in the verb interface — see [Batched review screen](#batched-review-screen-multiple-controls)):
  - `keep <row>.<key>` — push your intended new value (overwrites the server)
  - `accept-theirs <row>.<key>` — drop the key from the outbound payload; copy the server value into local `attributes`
  - `merge <row>.<key> = <json-literal>` — push the typed value. The right-hand side **must** be a JSON literal: `true`, `42`, `"text"`, `["a","b"]`, `{"k":1}`. The push surface validates the literal against the attribute's declared type before accepting and re-prompts on type mismatch (e.g. `merge 1.egress_filtering_enabled = "false"` is rejected because the attribute is boolean, not string). Type-corrupt payloads attributed to the operator are blocked at this layer — they never reach the platform mutation, never land in the `force-shared` audit entry.
- Other-model names truncated at 5 with `(and N more)`; full list via `show models <row>` in the batched review screen.
- The diff shows only keys present in `pendingEdit.previousAttributes` — i.e. keys the operator/agent intended to change. The push will send only those keys (partial payload; the platform's `r += $attributes` merge leaves untouched keys on the edge alone).
- Affected class made explicit because only changed `classes[]` entries trigger writes.
- Total count includes `thisModel` for clarity ("2 other / 3 total"), removing the "does N include us" ambiguity.

### Batched review screen (multiple controls)

When more than one Control is pending the safety check at push time (typical for a re-enrichment pass touching 5–10 controls), enumerating each full prompt produces a wall of scroll that operators page through and rubber-stamp. The push surface is a **collapsed master list** that the operator drives with explicit verbs (Claude Code's chat surface has no interactive collapse widgets — there is no real ▶ click affordance, so the spec uses a typed verb interface):

```
Shared-Control review (3 of 8 controls require approval):

  Prompted (require your decision):
    #1  Azure Firewall (MCE/MCETest Hub)    [shared: 3 models]   [conflict: 1 key, intent: 2 keys]
    #2  NSG Least-Privilege Ingress         [shared: 2 models]   [intent: 4 keys]
    #3  Entra ID RBAC (Nexus Groups)        [query failed: bolt timeout after 10s]

  Safe-to-push (no shared-ownership concerns; will push without further prompts):
    #4  TLS 1.3 (API Gateway)
    #5  CloudWatch Alarms (Production)
    #6  Vault KMS Rotation
    #7  ALB Access Logs
    #8  RDS Encryption-at-Rest

Verbs:
  show <n>               — expand row <n> to the full single-control prompt
  show all               — expand every prompted row
  show failed            — expand only query-failed rows
  show models <n>        — list every model that references Control #n, with
                            lastModifiedAt and owner per model

  cancel <n>             — leave Control #n unchanged on the platform
  push-anyway <n>        — apply YOUR intended changes to Control #n (writes force-shared
                            audit entry; only for shared rows)
  push-unverified <n>    — apply YOUR intended changes to Control #n despite the failed
                            ownership query (writes force-unverified audit entry; only for
                            query-failed rows)
  clone <n>              — fork Control #n as a new Control and repoint this model only
  retry-query <n>        — re-run the ownership query for Control #n

  Per-key (used inside an expanded conflict view; see "Prompt content"):
    keep <n>.<key>           — push your intended new value (overwrites server)
    accept-theirs <n>.<key>  — drop the key from outbound payload; copy server value local
    merge <n>.<n>.<key> = <json-literal>
                             — push the typed value (JSON literal, type-validated against
                                the attribute's declared type)
    drop <n>.<key>           — remove the key from outbound payload AND from
                                pendingEdit.previousAttributes (operator chose not to push;
                                also used for re-add prompts in Step D Case 2 where the
                                key is absent on the platform but in the ControlClass
                                template)
    keep-all <n>             — apply 'keep' to every conflicting key on Control #n
    accept-theirs-all <n>    — apply 'accept-theirs' to every conflicting key on Control #n

  cancel-all (3 prompted)  — cancel all 3 prompted rows; safe-to-push group is unaffected
  cancel-everything        — full abort — cancel ALL rows including safe-to-push
                              (kill switch for "stop all control-library writes this session")
  clone-all (3 prompted)   — clone all 3 prompted rows; safe-to-push group is unaffected
                              (push-anyway-all and push-unverified-all are not offered;
                               see DEC-CL-6 and the rejection message below)
  done                     — proceed to push with the decisions made so far
                              (any prompted row without a decision is treated as 'cancel';
                               any conflicting key without a per-key decision is treated as
                               'cancel' for the entire control row)
```

**`cancel-all` vs `cancel-everything`** — the asymmetric default exists so an operator can deal with the prompts without inadvertently blocking the safe-to-push group; the explicit `cancel-everything` is the kill switch.

- `cancel-all` cancels only the *prompted* rows. The safe-to-push group still pushes when the operator types `done`.
- `cancel-everything` aborts the entire P7 step — no pushes at all, including safe-to-push.

`safe-to-push` rows are those whose ownership query returned a result that does NOT trigger a shared-ownership prompt — typically the alone case (no other models reference the Control), but also the case where every model that does reference it has the operator as a co-owner. The skill renders these as a separate group so the operator can scan them once and let `done` apply them en bloc.

The single-control prompt (when only one Control needs review) is functionally a 1-row instance of this batched screen — the same verbs apply, but `<n>` is always `1` and `cancel-all`/`clone-all`/`done` are omitted as redundant. An implementer should write **one** verb parser, not two.

If the operator types `push-anyway-all` or `push-unverified-all`, the push surface responds:

```
  Bulk push-anyway / push-unverified is disabled by policy (DEC-CL-6). A single command
  could write to dozens of foreign models. Approve per-row, or use 'clone-all' to fork
  all prompted Controls and decouple them from the shared library.
```

`push-anyway` and `push-unverified` are **distinct verbs** because they produce different audit-log entries (`force-shared` vs `force-unverified`) and represent different operator intents (overriding ownership consensus vs proceeding without an ownership check). The verb names match the audit type names so an auditor reading the log can trace each entry back to the operator's exact action. See [DEC-CL-7](#11-decisions).

### Error-path UX

When the live shared-ownership query fails for a particular control (network timeout, schema mismatch, auth expiry), the row appears in the batched review screen with a `[query failed: <reason>]` badge. Per-row choices for query-failed rows are restricted to `cancel`, `clone`, `retry-query`, and `push-unverified` (the dedicated query-failure verb described above).

`push-unverified` writes a `force-unverified` audit-log entry — same fields as `force-shared`, plus `query_failure_reason` and `query_attempts`, with `liveAssignedModelIds: null` to make the unknown-blast-radius explicit in the audit record. **Never** falls back to the cached `platformState.assignedModelIds` — silently using stale data would defeat the entire purpose of the live check.

`--force-unverified` is also available as a CLI flag on `/dethereal:sync push` for non-interactive scenarios (CI). Two forms:

- `--force-unverified` (no argument) — apply to **all** controls whose ownership query failed in this push. CI's typical case when ownership queries fail because a downstream service is down.
- `--force-unverified=<id>,<id>,...` — scope to the listed control ids. Required when CI needs to mix legitimate-failed controls (force-unverified them) with shared-pending controls (must remain refused-by-default). Without scoping, the CI flag would be all-or-nothing and operators couldn't proceed.

The flag applies **only** to controls whose ownership query failed — never to shared controls with a successful query result. Using the CLI flag still produces per-control `force-unverified` audit entries; using `--force-unverified=<id>` on an id whose query did NOT fail is a **hard error**, not a silent no-op, to prevent operators from accidentally bypassing shared-ownership prompts.

### Handoff: agent → operator

Inside `/dethereal:enrich --focus controls`, the security-enricher agent runs with a 40-turn budget and can't pause mid-turn for a synchronous human decision. The handoff mechanism is **deferred-queue**:

- During the control pass, when the agent edits a brownfield class entry's `attributes`, it bumps `localEditedAt` and writes a `pendingEdit` block in the same `controls/<id>.json` file (see [§4 schema](#4-per-control-file-schema)). The block records who edited (`agent` vs `operator`), when, and **the pre-edit values for exactly the keys the operator/agent intended to change** — this key set is what the push later sends as a partial payload (see [§7 brownfield Step C](#push--brownfield-controls) and [DEC-CL-11](#11-decisions)). In-file placement is deliberate: it makes pending state visible in `git diff` and in PR review, which is the governance story.
- The agent emits a passive annotation in its final batched output (the message the operator reads at the end of the agent's turn), e.g.: `⚠ Pending shared-edits: 2 controls will trigger a shared-ownership prompt at /dethereal:sync push: Azure Firewall (MCE/MCETest Hub) [class: Firewall Policy], NSG Least-Privilege Ingress [class: Network Access Control].` — not a blocking question. The same count is also surfaced in `/dethereal:status` so a future session that picks up after a branch switch sees the queue.
- When the operator runs `/dethereal:sync push`, the push phase runs the live shared-ownership query for every Control with a `pendingEdit` block, surfaces the batched review screen above, and clears each `pendingEdit` block on operator decision (cancel: leave `attributes` and `pendingEdit` as-is so the queue stays visible; push-anyway / push-unverified: clear after successful mutation; clone: clear on the new file, delete the old file via WAL).

#### Commit hygiene for `pendingEdit`

`pendingEdit` blocks **should be committed** alongside the model edit they document. They are the PR-review artefact for shared-edit intent — without them, a reviewer sees `attributes` change with no context. The push phase clears the block on successful mutation; the next commit naturally removes it.

To prevent operators from accidentally landing un-pushed `pendingEdit` blocks on `main` (which would make the queue a permanent fixture of the trunk), CI enforces a **base-vs-head diff** check on PRs targeting `main` only — feature branches are exempt so operators can commit in-flight `pendingEdit` blocks during PR review without the check screaming at every push.

The check passes if any of the following holds for each `controls/*.json` modified by the PR:
- The file has no `pendingEdit` blocks on the head SHA (clean), OR
- The file has the same `pendingEdit` blocks on the base SHA (operator inherited them), OR
- The merge commit clears all blocks the PR introduced.

On failure, the CI script emits a structured message:

```
Un-pushed pendingEdit blocks detected on this PR (base→head):

  threat-models/payment-api/controls/azure-firewall-...json
    classes[0] (Firewall Policy)
      pending keys: default_inbound_policy, egress_filtering_enabled

  threat-models/payment-api/controls/nsg-...json
    classes[0] (Network Access Control)
      pending keys: default_deny_posture

These blocks must be cleared before merge. Two options:

  1. Push the pending edits to the platform:
       /dethereal:sync push
     This clears each block on successful platform mutation.

  2. Discard the pending edits and revert to the base values:
       git checkout origin/main -- threat-models/payment-api/controls/azure-firewall-*.json
       git checkout origin/main -- threat-models/payment-api/controls/nsg-*.json
     Then commit and push the revert.

Reference: CONTROL_LIBRARY.md §6 "Commit hygiene for pendingEdit"
```

A first-pass implementation sketch is in [§9 CI check row](#dethereal-skills); the actual workflow file is host-CI-specific (GitHub Actions, GitLab CI, etc.).

#### Audit log

The `force-shared`, `force-unverified`, and `reverted` audit-log entries are **the** governance record for cross-model writes and considered-but-discarded edits — the trail SOC 2 / ISO 27001 auditors look for. They are **committed** to the repository under `.dethereal/control-audit.log` (append-only, line-oriented JSON-per-line), not gitignored. Per-operator attribution comes from the `operator` field on each entry (typically `git config user.email`), not from per-clone separation.

Schema (one JSON object per line):

```json
{
  "timestamp": "<iso>",
  "operator": "<git-user-email>",
  "kind": "force-shared" | "force-unverified" | "reverted",
  "controlId": "<uuid>",
  "controlName": "<string>",
  "classId": "<uuid>",
  "className": "<string>",
  "modelId": "<this-model-id>",
  "liveAssignedModelIds": ["<id>", ...] | null,
  "intendedKeys": ["<key>", ...],
  "attributesPushed": { "<key>": "<value>", ... },
  "previousAttributes": { "<key>": "<value>", ... },
  "effective": "ours" | "theirs" | "novel" | null,
  "conflictResolutions": [
    { "key": "<string>", "ours": "<value>", "theirs": "<value>", "chosen": "ours" | "theirs" | "merge", "merged": "<value>" }
  ],
  "blockedKeys": ["<key>", ...],
  "readdedKeys": ["<key>", ...],
  "droppedKeys": ["<key>", ...],
  "queryFailureReason": "<string>",
  "queryAttempts": 1
}
```

Field semantics:

- **`intendedKeys`** is the canonical "what did the operator try to do" — equal to `keys(pendingEdit.previousAttributes)` at push time. This is the single authoritative intent record; `attributesPushed` and `previousAttributes` are derived from it.
- **`previousAttributes`** is the pre-edit snapshot (`pendingEdit.previousAttributes`) — the values the operator started from.
- **`attributesPushed`** is `intendedKeys` projected through `attributes` AFTER [§7 Step D](#push--brownfield-controls) conflict resolution. A key may be absent from `attributesPushed` (despite being in `intendedKeys`) if the operator chose `accept theirs` on conflict or `drop` on a re-add prompt.
- **`effective`** is a derived field for cheap auditor readability. `"theirs"` if every conflicting key resolved to `accept theirs`; `"ours"` if every conflicting key resolved to `keep ours` AND no merge produced a value matching `theirs`; `"novel"` if any merge produced a value not equal to either `ours` or `theirs`. `null` for `force-unverified` (no conflict detection ran) and for `reverted`.
- **`blockedKeys`** is the list of `absent-and-unknown` keys that aborted the push (Step D Case 1). Empty unless the operator unblocked them (which they cannot — Case 1 is a hard block; this field is for post-hoc forensics on aborted pushes).
- **`readdedKeys`** is the list of `absent-but-known` keys the operator chose to re-add (Step D Case 2 → `keep`).
- **`droppedKeys`** is the list of `absent-but-known` keys the operator chose to drop (Step D Case 2 → `drop`).
- Fields `queryFailureReason` and `queryAttempts` populated only on `force-unverified`; `liveAssignedModelIds` is `null` only on `force-unverified`. `conflictResolutions` populated only when [§7 Step D](#push--brownfield-controls) Case 3 detected per-key conflicts.

**`force-unverified` partial-payload note.** When the ownership query failed, the pre-existing server values for keys not present in `attributesPushed` are unknowable from this entry alone — that's the inherent meaning of "unverified". Auditors reconstructing post-hoc state should treat absent keys in `attributesPushed` as "untouched on the platform during this push; pre-existing server value unrecoverable from this entry".

**`reverted` semantics.** Written when [§7 Step C](#push--brownfield-controls) clears a `pendingEdit` because the operator reverted all proposed values back to their pre-edit values before push. `intendedKeys` records what the agent or operator originally proposed; `attributesPushed` is empty `{}`; `effective: null`. Captures the "we considered this and decided not to" governance signal that would otherwise vanish silently when `pendingEdit` is cleared.

#### Reading the audit log

The log is line-oriented JSON (one entry per line), so it grep/jq cleanly without a dedicated tool. Common operator queries:

```bash
# What did I (force-)push this week?
jq -c 'select(.operator == "$(git config user.email)" and .timestamp > "2026-04-10")' \
  .dethereal/control-audit.log

# Every cross-model write to "Azure Firewall" in the last quarter:
jq -c 'select(.controlName == "Azure Firewall (MCE/MCETest Hub)" and .kind == "force-shared")' \
  .dethereal/control-audit.log

# All considered-but-discarded edits (governance signal of "we thought about this"):
jq -c 'select(.kind == "reverted")' .dethereal/control-audit.log

# Controls that needed force-unverified (ownership query failures):
jq -c 'select(.kind == "force-unverified") | {timestamp, controlName, queryFailureReason}' \
  .dethereal/control-audit.log
```

A `/dethereal:audit` skill is **deferred to V1.1** — the jq surface is sufficient for V1, and a wrapping skill would otherwise need design (filter UX, time-range semantics, multi-model aggregation). Tracked in [§10 Q7](#10-open-questions). For SOC 2 / ISO 27001 audit response, the log is committed to the repo, so the auditor's own tooling (Splunk, Datadog log ingest, anything that reads JSON lines) can consume it directly without the plugin.

The log is append-only — never rewritten or compacted. Append happens after the platform mutation has acknowledged success; a crash mid-append leaves the log without the entry but the platform state still reflects the change (acceptable: re-running `/dethereal:sync` after a crash will re-detect the now-applied edit as already-pushed and not re-prompt). Audit-log retention/rotation policy is out of scope — operators can archive at organisational policy intervals (move-and-truncate is safe).

See [DEC-CL-12](#11-decisions). **Secret-handling caveat: see [Appendix A.7](#a7--audit-log-records-attribute-values-verbatim-secret-handling-caveat).** Attribute values are recorded verbatim in the audit log — operators authoring Controls with secret-shaped values (API keys, credentials) should redact upstream or rotate post-attempt.

### When the check fires

The single authoritative trigger: a Control has a `pendingEdit` block on at least one of its `classes[]` entries. The agent (and any operator-driven edit tool) is responsible for writing this block on every brownfield attribute edit; the push phase reads it as the truth source. The validator catches asymmetric state where `attributes != platformAttributes` but no `pendingEdit` is present (signals an external tool bypassed the agent), and the brownfield push's [Step A external-edit guard](#push--brownfield-controls) refuses such states at runtime — defense in depth. **Not at enrich time.** The agent's enrich-time annotation is informational only.

---

## 7. Sync Flows

### Pull (auto, at start of control pass)

Decision DEC-CL-2: pull is **eager** at the start of the control pass, not lazy on first edit. The agent gathers full local context once, avoiding mid-task GraphQL round-trips and giving the user a coherent view of what already exists before making decisions.

**Batched, not sequential.** For a model with N boundaries × M controls each, a naive `getControl(id)` + `getControlsAssignedModels(id)` per-Control design produces 2N×M sequential round-trips — at ~50–150ms each, a 15-boundary × 6-control model wastes 9–27s of blocking wait at the start of every control pass. That's not "negligible" (as the first draft claimed) — it's operator-visible latency that hurts adoption. Both queries are batched.

**`STALE_TTL`: 15 minutes.** Within a single control-pass session (typically 10–25 minutes), auto-pulled data is fresh enough that a second invocation in the same session does not re-query the platform. Beyond that, risk of pulling stale data into an agent's context window outweighs the saved latency. Configurable via `.dethereal/config.json` for operators with slow connections. The TTL gates whether the **next** invocation re-pulls; an in-flight agent always works against the snapshot it pulled at session start, regardless of how long the session runs (see [DEC-CL-9](#11-decisions)).

```
1. Read structure.json + dataflows.json — collect all referenced control IDs (including null-id refs)
2. Compute the "stale" subset:
     - controls/<id>.json does not exist, OR
     - file.platformState.lastSyncedAt is older than STALE_TTL
3. Batched calls (three round-trips total — one per primitive):
     - dtControl.getControls({ ids: staleIds })
         returns { id, name, controlClasses: [{ id, name, module: { id } }] }
         # Class metadata only — IS_INSTANCE_OF edge properties not exposed here.
     - dtControl.getControlInstantiationAttributes({ controlIds: staleIds })
         returns [{ controlId, classId, attributes }]
         # Per-(control, class) instantiation attribute payloads.
     - dtControl.getControlsAssignedModels({ ids: staleIds })
         returns { id: string → modelIds: string[] }
4. For each stale id:
     - Compose classes[] entries by joining the class-metadata result with the
       instantiation-attributes result on (controlId, classId).
     - Write controls/<id>.json with lifecycle: "brownfield",
       classes[].attributes = classes[].platformAttributes = the joined attributes payload,
       platformState populated (lastSyncedAt = now())
5. Null-id (greenfield name-only) refs: defer; the agent decides during the control pass
   whether to upgrade them to a class-bound greenfield Control or leave name-only
```

### Push — greenfield Controls (idempotent)

Every step is individually idempotent and resumable from `partially-pushed` state (see §5). Failure at any step leaves the local file in a recoverable state; the next push skips already-done work.

```
For each controls/<id>.json with lifecycle in {"greenfield", "partially-pushed"}:

  Step A — Create Control on platform (if not already done):
    If lifecycle == "greenfield":
      serverControl = DtControl.createControl({
        name, classIds: [c.classId for c in classes]
      })
      Apply the WAL-protected id rewrite (see "ID write-back" below) to:
        - replace temp id with serverControl.id in controls/<tempId>.json
        - replace temp id with serverControl.id in every controls[] reference in
          structure.json and dataflows.json that held the temp id
        - flip lifecycle to "partially-pushed"
        - rename the file: controls/<tempId>.json → controls/<serverControl.id>.json
    # From this point forward, a retry will NOT duplicate the Control.

  Step B — Set per-class instantiation attributes (skip entries already-pushed):
    For each entry in classes[]:
      If entry.pushedAt and entry.pushedAt >= entry.localEditedAt:
        skip  # already pushed, idempotent
      setInstantiationAttributes(serverControl.id, entry.classId, entry.attributes)
      entry.platformAttributes = entry.attributes  # snapshot what went to server
      entry.pushedAt = now()
      clear entry.pendingEdit (if present)
      persist controls/<id>.json

  Step C — Assign SUPPORTS edges:
    For each element that references this control id in structure.json or dataflows.json:
      assignControlToElement(serverControl.id, elementId)
        # Backed by updateControls(connect: ...) under the hood; the @neo4j/graphql
        # connect operator is upsert-shaped — re-running with the same (control, element)
        # pair does not create a duplicate edge or error.

  Step D — Finalize:
    If all classes[] entries have pushedAt >= localEditedAt AND all SUPPORTS edges confirmed:
      flip lifecycle to "brownfield"
      populate platformState { lastPushedAt, assignedModelCount, assignedModelIds }
      (lastSyncedAt is left absent — set on the next pull, not on this push;
       assignedModelIds comes from the live query that ran as part of the batched
       pre-push check — no extra round-trip)
```

**Partial-model-push gate.** Control-library push runs ONLY if the model push phase (dt-update/dt-import) reported full success. If element creation partially failed (some components or boundaries missing), the control phase skips with a clear message: `"Control library push skipped — model push had N errors. Fix element errors and re-run sync."`. Otherwise Step C would silently fail to assign SUPPORTS edges to missing target elements, and the operator would not notice.

**Rollback explicit non-goal.** Half-applied greenfield pushes (Step A succeeded, Step B partially succeeded, operator abandons) are handled by resume-on-next-push, not rollback. An abandoned greenfield Control does exist on the platform after Step A; it can be deleted via `manage_controls(action: 'delete')` if the operator decides never to use it. See [§12](#12-out-of-scope).

### Push — brownfield Controls

```
For each controls/<id>.json with lifecycle: "brownfield":

  Step 0 — Short-circuit (no network):
    If no class entry has a pendingEdit block AND no class entry's attributes
    differs from platformAttributes:
      → no-op. Skip all remaining steps for this Control. No round-trips.

  Step A — External-edit guard:
    For each entry in classes[]:
      If entry.attributes differs from entry.platformAttributes AND
         entry.pendingEdit is absent:
        → ABORT push for this Control with explicit error:
          "External edit detected on Control <name>, class <className>.
           The attributes payload differs from the last-known-server snapshot,
           but no pendingEdit block records what changed.

           Three recovery paths:

             1. Keep your edits as authoritative intent:
                /dethereal:sync promote-external-edit <controlId> <classId>
                Captures the current `attributes` payload as a pendingEdit block
                with editedBy: 'external' and previousAttributes populated from
                the current platformAttributes. The next push will treat your
                edits as the operator's intent and run the shared-ownership
                check against them.

             2. Re-derive from observed evidence:
                /dethereal:enrich --focus controls
                Runs the agent to re-derive attribute values from code/IaC,
                producing a fresh pendingEdit. Discards any hand-edits the
                agent doesn't reproduce.

             3. Discard your edits and restore from server:
                /dethereal:sync pull (will overwrite this Control's local file)

           This Control is skipped; other Controls in this push proceed."
    # Why: an external tool (editor, CI job, naive script) modified attributes
    # without bumping localEditedAt or writing pendingEdit. Pushing such a
    # state would lose the operator's intent record and silently overwrite
    # whatever the platform now holds.

  Step B — Refresh platformAttributes BEFORE diff:
    For every class entry that has a pendingEdit block:
      Re-fetch the live IS_INSTANCE_OF attribute payload from the platform
      via the batched call below (this is the SAME call that runs as part of
      the pre-push pipeline — see "Sync pipeline boundary"; Step B reads from
      that result, does not re-issue the round-trip):
        dtControl.getControlInstantiationAttributes({ controlIds: touchedControlIds })
      For each (controlId, classId) returned, overwrite the matching
      class entry's platformAttributes with the fresh payload.
    # Why: between our last sync and this push, another operator may have updated
    # this Control's attributes. Without this refresh, our diff uses a stale
    # snapshot and the prompt shows a misleading "old → new" where "old" is
    # OUR cached old, not server-current.

  Step C — Compute the intended-change key set per class entry:
    For each entry with pendingEdit:
      changedKeys = set of keys in entry.pendingEdit.previousAttributes
      # These are the keys the operator/agent INTENDED to change. They are NOT
      # derived from a current diff against platformAttributes — see DEC-CL-11.

      For each k in changedKeys:
        entry.outboundPayload[k] = entry.attributes[k]

        # Classify each key against the just-refreshed platformAttributes:
        if k in entry.platformAttributes:
          k.serverState = "present"
        elif k in entry.classTemplate.properties:   # known to ControlClass schema
          k.serverState = "absent-but-known"        # platform deliberately dropped or never set
        else:
          k.serverState = "absent-and-unknown"      # typo or template drift

      If entry.outboundPayload is empty (operator reverted all intended edits
      back to their pre-edit values):
        Append `reverted` audit-log entry (see §6 Audit log).
        Emit operator confirmation line:
          "Control <name> [class <className>]: pendingEdit cleared
           (proposed values matched platform state — no mutation needed)."
        Clear pendingEdit. Continue (no platform mutation).

  Step D — Conflict detection per intended key:
    For each entry with non-empty outboundPayload:
      For each intended key k:

        Case 1 — k.serverState == "absent-and-unknown":
          → BLOCK with explicit error in batched review screen:
            "Key '<k>' is not in the ControlClass template's properties.
             Likely causes: typo, or the template has changed since the
             local file was created. Fix the local file or update the
             ControlClass on the platform; this push will not proceed
             for Control <name> until resolved."
          # Why: r += $attributes would happily persist a junk key,
          # producing schema drift the validator never catches.

        Case 2 — k.serverState == "absent-but-known":
          → WARN with explicit confirmation in batched review screen:
            "Key '<k>' is not currently set on the platform (likely
             dropped by another operator's clone-and-swap or never set).
             Push will RE-ADD this key."
            Operator chooses per key: keep / drop.
              keep → push k as planned.
              drop → remove k from outboundPayload; remove from
                     pendingEdit.previousAttributes; no audit entry beyond
                     the eventual force-shared/force-unverified record.

        Case 3 — k.serverState == "present" AND
                 entry.platformAttributes[k] != entry.pendingEdit.previousAttributes[k]:
          → CONFLICT: server value of k changed since our snapshot.
            Surface in the batched review screen as a per-key 3-way display:
              k (<type>):
                <our pre-edit>   →  <our intended new>     (we proposed)
                <server-current>                            (someone else changed)
            Operator chooses, per conflicting key:
              keep ours        → push our intended new value (overwrites the server)
              accept theirs    → drop k from outboundPayload, copy server value into
                                 attributes; pendingEdit.previousAttributes[k] also
                                 updated to the server value
              merge            → operator types a final value; treated as "keep ours"
                                 with the typed value (type-validated — see §6
                                 prompt content)

        Case 4 — k.serverState == "present" AND no conflict:
          → push as intended. No prompt.

      Operator decisions for Cases 1–3 are recorded in the eventual
      audit-log entry (force-shared or force-unverified) under
      conflictResolutions / blockedKeys / readdedKeys (see §6 Audit log).

  Step E — Run shared-ownership check (§6) for this Control if outboundPayload
           remains non-empty after Step D.
    - live query runs as part of the batched pre-push check for all touched Controls
    - alone              → push setInstantiationAttributes(controlId, classId,
                           outboundPayload)  # PARTIAL update — only changed keys
                           Update entry.platformAttributes[k] = entry.attributes[k]
                                  for each k in outboundPayload
                           Set entry.pushedAt = now()
                           Clear pendingEdit.
    - shared, allowed    → same, plus force-shared audit-log entry
                           (recording the conflict-resolution choices from Step D)
    - shared, refused    → skip; leave attributes + pendingEdit as-is
    - query failed       → per-control branch: skip + flag in batched review screen
                           (see §6 Error-path UX), or push with force-unverified
                           entry if operator approved at the prompt

  Step F — Bump platformState.lastPushedAt = now() (regardless of per-class outcome).
           Do NOT bump platformState.lastSyncedAt — pushing bytes is not the
           same as having fresh server state for other operators' keys.
```

**Why partial-payload push.** The `setInstantiationAttributes` mutation uses `r += $attributes` (Cypher property merge), which is partial-update-friendly: keys not present in the input are left unchanged on the edge. Sending only the operator's intended-change keys (computed in Step C from `pendingEdit.previousAttributes` and adjusted by Step D's per-key conflict / re-add resolutions) means the brownfield push never touches keys the operator didn't reason about — fully closes the [DEC-CL-11](#11-decisions) staleness corruption case.

### Sync pipeline boundary

`dt-update.ts` and `dt-import.ts` are **not modified** for this work. They continue to handle SUPPORTS edges only on model elements (boundaries, components, flows, data items). The control-library push runs as a separate phase invoked by the `/dethereal:sync` skill, sequenced as:

```
1. model push (dt-update / dt-import)
   ├─ full success → continue to step 2
   └─ partial failure → STOP. Report errors. Do not attempt control phase.
2. control-library push (this doc)
   ├─ batched pre-push (two round-trips, both batched over `touchedControlIds`):
   │     - getControlInstantiationAttributes({controlIds: touchedIds})
   │       // refreshes per-(control, class) IS_INSTANCE_OF attributes
   │       // — feeds §7 brownfield Step B (Step B does not re-issue this call)
   │     - getControlsAssignedModels({ids: touchedIds})
   │       // shared-ownership liveAssignedModelIds (§6)
   │  Two separate round-trips by design — pull-time results from the start of the control
   │  pass cannot be reused (TTL would reset the freshness guarantee §6 depends on).
   ├─ greenfield push (Section 7 — Step A/B/C/D, WAL-protected)
   ├─ brownfield push (Section 7 — Step A/B/C/D/E)
   └─ finalise: write back ids, lifecycle, platformState
3. post-sync footer
```

#### ID write-back (WAL-protected)

Greenfield Step A's id rewrite touches multiple files: `controls/<tempId>.json` (rename + content edit), `structure.json` (every `controls[]` entry holding the temp id), and `dataflows.json` (same). POSIX gives no multi-file atomic transaction; a naive sequential implementation that crashes mid-rewrite leaves the server id present on the platform but absent from the local files, and the next push will create a duplicate Control on the platform — exactly the bug DEC-CL-8 is meant to prevent.

The mechanism is a **write-ahead log**.

##### Journal schema

`.dethereal/pending-id-rewrite.json` is a single JSON object containing one or more pending operations. Two operation shapes are supported:

```json
{
  "operations": [
    {
      "kind": "greenfield-id-rewrite",
      "tempId": "greenfield-abc",
      "serverId": "<uuid>",
      "filePaths": ["structure.json", "dataflows.json"],
      "controlFileRename": {
        "from": "controls/greenfield-abc.json",
        "to":   "controls/<uuid>.json"
      },
      "createdAt": "<iso>"
    },
    {
      "kind": "clone-and-swap",
      "oldId": "<original-uuid>",
      "newId": "<clone-uuid>",
      "filePaths": ["structure.json", "dataflows.json"],
      "controlFileWrite": "controls/<clone-uuid>.json",
      "controlFileDelete": "controls/<original-uuid>.json",
      "createdAt": "<iso>"
    }
  ]
}
```

The journal is written via fsync + rename (POSIX-atomic on all common filesystems) before any platform mutation that the journal records is considered "real" locally.

##### Apply order

For each operation, in declared order:

1. **Rewrite content**: for every path in `filePaths`, apply the temp-file-then-rename pattern (write `path.tmp`, fsync, atomic rename). Replace `tempId` → `serverId` (greenfield) or `oldId` → `newId` (clone).
2. **Apply file-level changes**:
   - greenfield: rename `controlFileRename.from` → `controlFileRename.to` (atomic on POSIX).
   - clone-and-swap: write `controlFileWrite` (temp + fsync + rename), then unlink `controlFileDelete`.
3. After all operations apply cleanly, delete the journal (atomic unlink).

##### Crash recovery (per-operation, idempotent)

Replay logic for each operation in the journal — applied in order, each step idempotent:

| Crash point | Recovery rule |
|---|---|
| Crash before any file rewritten | Each path's content still contains `tempId`/`oldId` → apply the rewrite. |
| Crash mid-rewrite (some files rewritten, some not) | Per file: if it contains `tempId`/`oldId` → rewrite; if it contains `serverId`/`newId` → skip. |
| Crash after all paths rewritten, before file rename/write | greenfield: if `controls/<serverId>.json` does not exist and `controls/<tempId>.json` does → rename; else skip. clone-and-swap: if `controlFileWrite` does not exist → write it; if `controlFileDelete` exists → unlink it; either step skipped if already done. |
| Crash after file rename/write done, before journal delete | All checks are no-ops; proceed to journal delete. |
| Crash on a non-POSIX filesystem (network mount, some Windows configs) | Out of scope for V1. The replay can detect inconsistent state — e.g. both `<tempId>.json` and `<serverId>.json` present with conflicting content — and abort with explicit error: "WAL replay detected ambiguous state (both `<tempId>.json` and `<serverId>.json` present); manual reconciliation required". |

##### Replay scope (every MCP entry)

The journal is replayed at the **MCP boundary** — the top of `manage_controls.execute()`'s switch, after lock acquisition and before action dispatch — for every action that takes `directory_path`: `pull-controls`, `push-greenfield`, `push-brownfield`, `tombstone`, `set-local-edited`, `promote-external-edit`. Replay before lock release means two concurrent sessions can't replay the same journal twice; replay-failure aborts the action with `WAL_REPLAY_FAILED` rather than silently proceeding against a partially-rewritten directory.

The design originally intended replay at every skill entry (a longer enumerated list of skills); an earlier implementation only invoked replay inside `pushGreenfieldControl`. Relocating the replay seam to the MCP boundary closes the gap, since that boundary is single-pointed and reachable from every skill regardless of which action it invokes. The trade-off: skills that *only* read the model directory without invoking a directory-touching MCP action (`/dethereal:view`, `/dethereal:status` when run without `show models`) don't trigger replay; their reads are best-effort and may observe pre-replay state during the brief window between platform mutation and journal cleanup. This is acceptable: those skills are read-only and the worst-case is rendering slightly-stale ids — the next directory-touching action replays before its critical section.

Replay is a single fstat + (if present) JSON parse + apply — under 5ms when the journal is absent, which is the common case. The journal is gitignored (per-operator transient state, like `sync.json`).

**Non-skill / non-MCP readers.** Tools that read `controls/*.json` outside the MCP boundary — `pnpm test`, ad-hoc CI scripts, manual `cat`/`jq` inspection — bypass the WAL replay and may observe pre-replay state. The risk is read-only: such tools see slightly-stale ids in `structure.json` while `controls/` contains the new server-id file, or vice versa. Treat the model directory as authoritative only after a directory-touching MCP action has run. CI that mutates the model directory directly without going through the MCP boundary is unsupported.

---

## 8. Agent Workflow Changes

### Greenfield path

When the agent identifies a control that does not exist in the platform library:

1. Choose a temporary local id (e.g. `greenfield-<short-uuid>`).
2. Write `controls/<temp-id>.json`:
   - `lifecycle: "greenfield"`
   - `classes[]` populated from the bound ControlClass(es) (template fetched via `mcp__plugin_dethereal_dethereal__get_classes`)
   - `attributes` populated from observed code/IaC evidence; empty `{}` if nothing observed yet
3. Write `{ id: "<temp-id>", name, source: "declared" }` to `structure.json` / `dataflows.json`.
4. On `/dethereal:sync push`: pipeline creates the Control, sets attributes, assigns SUPPORTS, writes server id back, flips lifecycle.

### Brownfield path

When the agent assigns an existing platform Control to elements:

1. Auto-pull (Section 7) has already populated `controls/<id>.json` with platform state.
2. Write `{ id: "<existing-id>", name, source: "declared" }` to `structure.json` / `dataflows.json`. SUPPORTS edge will land on next sync.
3. **Do not modify `classes[].attributes`** unless the user explicitly asks. The agent treats brownfield attribute files as read-only by default.
4. If the user asks to update attributes (e.g. "the firewall's default policy is actually `log_only`, not `deny`"): edit `classes[].attributes`, then warn the user that this will trigger the shared-ownership check at sync time.

### Documentation updates

The agent-doc rewrites are listed as a hard prerequisite in the doc preamble — see "Prerequisites" above the Table of Contents. Build inventory below covers code changes only.

---

## 9. What Needs Building

Listed in dependency order. Items at the top must land before items below them. The agent-doc rewrites listed in the doc preamble's "Prerequisites" section are gating but not part of this build inventory (they are a content task, not a code task).

### Platform / database

| Item | Where | Notes |
|---|---|---|
| `CREATE INDEX ON :Control(id);` migration | Memgraph / migration script | Required before the §6 query is run on any non-trivial control inventory. Without it the query does a full Control label scan per `UNWIND` row. Confirmed live: `Filter (c :Control), {c.id} / ScanAll (c)` becomes `ScanAllByLabelProperties (c :Control {id})` after the index lands. |
| `CREATE INDEX ON :Model(id);`, `CREATE INDEX ON :SecurityBoundary(id);` | Memgraph / migration script | Same §6 query benefits from these on the m1/m2 hops. **Verified live (round-5 review): both indexes are currently absent on the demo Memgraph** — the migration must actually create them, not just declare them required. |
| `CREATE INDEX ON :ControlClass(id);` | Memgraph / migration script | Required for the new `getControlInstantiationAttributes` `@cypher` query (below). Without it, the IS_INSTANCE_OF lookup in the Step B refresh degrades to a full ControlClass label scan per touched class. |
| `CREATE INDEX ON :Component(id);` | Memgraph / migration script | Required for SUPPORTS-edge lookups in greenfield Step C (`assignControlToElement(serverControl.id, elementId)`) and for any Component-scoped traversal added by future enhancements. |

### dt-core — new GraphQL primitives

| Item | Where | Notes |
|---|---|---|
| **Batched `getControls({ ids: string[] })`** GraphQL query + `dt-control.ts` method | `oss/packages/dt-core/src/dt-control/dt-control-gql.ts` + `dt-control.ts` | **New.** Today there is `getControl({controlId})` (singular) and `getControls({folderId})` (folder-scoped). Neither matches the id-list shape §7 needs for the auto-pull. Returns `{ id, name, controlClasses: [{ id, name, module: { id } }] }` for each id — **class metadata only**. The auto-generated `controlClasses` field on `:Control` does NOT expose `IS_INSTANCE_OF` edge properties (verified live, round-5 review); per-instance attributes are fetched via the dedicated query below. |
| **Batched `getControlInstantiationAttributes({ controlIds: string[] }): { controlId, classId, attributes }[]`** | `dt-control.ts` + new `@cypher` query in `schema.graphql` | **New.** The `@neo4j/graphql` auto-generated relationship resolver does not expose edge properties; the existing per-(control, class) `getAttributesFromClassRel(componentId, classId)` query is singular. This `@cypher` resolver runs `MATCH (c:Control) WHERE c.id IN $controlIds OPTIONAL MATCH (c)-[r:IS_INSTANCE_OF]->(cc:ControlClass) RETURN c.id AS controlId, cc.id AS classId, properties(r) AS attributes` in a single round-trip. Backs §7 brownfield Step B refresh and the auto-pull's `platformAttributes` initialisation. Without this, Step B degrades to N×M sequential round-trips and DEC-CL-9's batching argument collapses. **Caller-side null guard required** — `UNWIND null` errors with `Argument of UNWIND must be a list` on Memgraph, so the wrapper must short-circuit with `if (!controlIds?.length) return []` before the Bolt call (same rule as `getControlsAssignedModels`, [§6 Notes](#check)). |
| **Batched `getControlsAssignedModels({ ids: string[] }): Map<string, string[]>`** | `dt-control.ts` + new `@cypher` query in `schema.graphql` | **New.** Backed by the Cypher in §6. Wrapper handles the missing-id reconciliation rule (lifecycle-filtered: only `brownfield`/`partially-pushed` ids absent from the result are treated as "Control deleted upstream" → flip local file to `tombstoned`; `greenfield` ids' absence is expected). |
| **`setInstantiationAttributes(controlId, classId, attributes)`** exposed on `dt-control.ts` | `dt-control.ts` | **Currently absent from `dt-control.ts`.** The mutation exists in `dt-class.ts` as a generic component-class method. **Mechanism (decided): thin pass-through wrapper** on `dt-control.ts` that delegates to `dt-class.ts`'s implementation — single source of truth, no duplicate code paths to drift apart. The `attributes` parameter is treated as a **partial payload** (the platform mutation uses `r += $attributes`, leaving keys not present in the input untouched on the edge). This is the mutation the entire design exists to drive — see [§7 brownfield Step E](#push--brownfield-controls) and [DEC-CL-11](#11-decisions). |

### dt-core — control-library module

| Item | Where | Notes |
|---|---|---|
| `DtControlLibrary` class | `oss/packages/dt-core/src/dt-control-library/` (new) | Composes the three primitives above. Methods: `pullControls(controlIds: string[]): ControlFile[]` (writes/refreshes `controls/<id>.json` for each), `pushGreenfieldControl(file): ControlFile` (Steps A–D from §7), `pushBrownfieldControl(file, decision): ControlFile` (Steps A–E with operator-supplied decision per shared-ownership row), `markTombstoned(file)`. |
| `ControlFile` interface | `oss/packages/dt-core/src/schemas/control-file.schema.ts` (new) | Matches the §4 schema. **Independent** from `ControlReference` — that interface stays at `{ id, name?, source? }` once `source` passthrough is added to `dt-export-split.ts` (currently `dt-export-split.ts` flattens to `{id, name?}` only). See [CONTROL_INTEGRATION.md §3.1](CONTROL_INTEGRATION.md#31-local-json-supports-controls-but-the-engine-ignores-them). |
| `source` passthrough in `dt-export-split.ts` | `oss/packages/dt-core/src/dt-export/dt-export-split.ts` lines ~155, ~218, ~272 | Today `source` is dropped on export; once we round-trip control files it must survive. Small change but the `ControlReference` schema claim depends on it. |

### dt-core — local file machinery

| Item | Where | Notes |
|---|---|---|
| WAL-protected id-rewrite | `oss/packages/dt-core/src/dt-control-library/wal.ts` (new) | Implements the `.dethereal/pending-id-rewrite.json` mechanism specified in [§7 ID write-back](#id-write-back-wal-protected). Used by greenfield push Step A and clone-and-swap. Crash-recovery replay runs at the start of every `/dethereal:sync` and `/dethereal:enrich --focus controls` invocation. |
| `localEditedAt` bumping helper | `dt-control-library` | Single helper that all `attributes` writers must call. Bumps `classes[].localEditedAt`, populates `pendingEdit` if the entry is brownfield/partially-pushed and `pendingEdit` is not already set. Filesystem mtime is **not** used — see §4 schema notes. |
| Audit-log writer | `dt-control-library` | Two entry shapes: `force-shared` and `force-unverified`, per [§6 Behaviour](#behaviour) and [§6 Error-path UX](#error-path-ux). Append-only log under `.dethereal/control-audit.log` — **committed to the repository**, NOT gitignored. Schema and rationale in [§6 Audit log](#audit-log) and [DEC-CL-12](#11-decisions). Append happens after the platform mutation has acknowledged success (idempotent against re-run on crash; see §6). |

### dethereal MCP tool

| Item | Where | Notes |
|---|---|---|
| `manage_controls` extended actions | `oss/apps/dethereal/src/tools/manage-controls.tool.ts` | Two new actions: `pull_local` (drives `DtControlLibrary.pullControls` for all referenced control ids) and `push_local` (drives the greenfield/brownfield push, returning the batched-review-screen payload for any prompts the operator must answer). Alternative: split into a new `manage_control_library` tool — decide at implementation time. |

### dethereal skills

| Item | Where | Notes |
|---|---|---|
| `/dethereal:sync push` skill | `oss/apps/dethereal/skills/sync/SKILL.md` | Sequence: model push → WAL replay → control library push (greenfield, then brownfield) → post-sync footer. Surface the [batched review screen](#batched-review-screen-multiple-controls) when the safety check fires. Wire the `--force-unverified` flag through. |
| `/dethereal:sync promote-external-edit <controlId> <classId>` skill action | `oss/apps/dethereal/skills/sync/SKILL.md` | **New sub-action.** Recovery path for the external-edit guard (see [§7 brownfield Step A](#push--brownfield-controls)). Reads the current `attributes` payload on the named class entry, captures it as a `pendingEdit` block with `editedBy: "external"` and `previousAttributes` populated from the **current** `platformAttributes`. After this runs, the next `/dethereal:sync push` treats the external edit as legitimate operator intent and runs the shared-ownership check against it. No platform mutation; purely local. |
| `/dethereal:enrich --focus controls` skill | `oss/apps/dethereal/skills/enrich/SKILL.md` + `controls-enrichment.md` (in Prerequisites) | Auto-pull at start (Section 7) with `STALE_TTL` honoured. Greenfield writes new `controls/<temp-id>.json`. Brownfield edits bump `localEditedAt` + `pendingEdit`. Final agent message includes the passive annotation listing pending shared-edit prompts. |
| `/dethereal:status` | existing + `oss/apps/dethereal/skills/status/SKILL.md` | (1) Display cached `platformState.assignedModelIds` for drift visibility (read-only, never used as source of truth). (2) **New:** count and surface pending shared-edit prompts — scan `controls/*.json` for any class entry with a `pendingEdit` block and show as a one-liner in the status header (e.g. `Pending shared-edit prompts: 2 (run /dethereal:sync push to review)`). Avoids the "branch-switch ambush" case where an operator forgets a queued review screen across days. |
| **CI check** for `pendingEdit` blocks on `main` | `.github/workflows/dethereal-pendingedit-check.yml` (or operator's host CI) | Per-PR check: any `controls/*.json` with a `pendingEdit` block on the PR's head SHA must NOT also have one on the base SHA, OR if present on both, must be cleared by the merge. Prevents un-pushed shared-edit intent from landing on trunk. Sketch in [§6 Commit hygiene for `pendingEdit`](#commit-hygiene-for-pendingedit). |

### Validator

| Item | Where | Notes |
|---|---|---|
| Cross-reference checks | `oss/apps/dethereal/src/tools/validate-model.tool.ts` (`validate` action) | (1) Every `controls[]` reference with a non-null id has a matching `controls/<id>.json` (warning, not error — may be created by next pull). (2) Every `controls/<id>.json` is referenced by at least one `controls[]` entry (warning — orphan). (3) For every brownfield class entry: if `pendingEdit` is populated then `localEditedAt > pushedAt` (or `pushedAt` absent). The inverse — `attributes != platformAttributes` without `pendingEdit` — is an **external-edit drift** flagged separately (see [§7 brownfield Step A external-edit guard](#push--brownfield-controls)). Asymmetric state with `pendingEdit` populated AND `attributes == platformAttributes` is **valid** (operator rolled an edit back to the server value; the `pendingEdit` block is cleared on the next push). |

### Out-of-scope for this build

- `dt-update.ts` / `dt-import.ts` — **no changes**. Model sync stays focused on element + SUPPORTS-edge sync.

---

## 10. Open Questions

1. **~~What counts as a "diff" in Section 7's brownfield push step?~~** **Resolved.** Store the raw server payload in `classes[].platformAttributes` per-class (not at top-level `platformState`). Diff is `!deepEqual(attributes, platformAttributes)` per class entry. See §4 "Why both `attributes` and `platformAttributes`" and §7 Brownfield Step A.

2. **~~Naming for the clone-and-swap option~~** **Resolved.** Default: `<Control name> (<thisModel.name>)`, never `(local copy)`. Operator is prompted with the default pre-filled and can override. Old local file is atomically deleted when the new one is written. See §6 option 3.

3. **Shared-Control TOCTOU race (V1 limitation).** The shared-ownership query runs fresh at push time, but the window between the query and the `setInstantiationAttributes` mutation is non-zero. Two operators who both pick "push anyway" on overlapping edits land in last-write-wins with no serialisation. V1 accepts this: concurrent shared-edit pushes are expected to be rare (multi-model control edits are a governance operation, not a hot path), and the `force-shared` audit-log entry (§6 option 2) captures enough to reconstruct who-changed-what for post-hoc review. V1.1 may add a platform-side `revision` or `updatedAt` on the `IS_INSTANCE_OF` edge for compare-and-swap — that's a platform schema change, out of scope here. Mirrors the same V1 acceptance pattern as [SYNC_AND_SOURCE_OF_TRUTH.md Scenario 7](SYNC_AND_SOURCE_OF_TRUTH.md#scenario-7-multi-user-concurrent-edits).

4. **Concurrent edits on different branches** — same limitation as Q3, but across git branches rather than concurrent operators. Last push wins on the platform; `git diff` is the operator's tool for pre-push review. No additional mechanism in V1.

5. **Migration for existing demo models** that already have `controls[]` populated under the old `{id, name}` shape — they work as-is. The first run of the new pull populates `controls/<id>.json` for each referenced Control. No data loss; nothing is removed from `structure.json`.

6. **`show models <n>` requires platform-side `Model.lastModifiedAt` and `Model.owner`.** The `getControlsAssignedModels` query returns model IDs; the verb interface enriches each with `lastModifiedAt` and `owner` so the operator can judge blast radius beyond just names. `Model.lastModifiedAt` is part of the V1.1 work tracked in [SYNC_AND_SOURCE_OF_TRUTH.md §11 Q1](SYNC_AND_SOURCE_OF_TRUTH.md#11-resolved-questions); `Model.owner` doesn't exist on the schema today and would need to be added (typically operator email of last pusher). Until both fields are available, `show models <n>` displays names only with an inline warning: `(model freshness/ownership not shown — V1 limitation; check git log)`. Track for V1.1 alongside the SYNC `updatedAt` work.

7. **`/dethereal:audit` skill is deferred to V1.1.** The committed line-oriented JSON log under `.dethereal/control-audit.log` is grep/jq-readable today (canonical recipes in [§6 Reading the audit log](#reading-the-audit-log)). A wrapping skill would need design work for filter UX, time-range semantics, and multi-model aggregation — disproportionate for V1 when the underlying file is already auditor-friendly. Operators who want a richer surface can pipe the log through their existing log-ingest tooling.

---

## 11. Decisions

| ID | Decision | Rationale |
|---|---|---|
| **DEC-CL-1** | Shared-Control attribute pushes require explicit operator approval every time | Editing a Control assigned to multiple models silently mutates state in models that may not even be open. Explicit approval — refuse-by-default — is the only safe default. The clone-and-swap option lets an operator make per-model edits without touching shared state. |
| **DEC-CL-2** | Auto-pull all referenced Controls at the start of the control pass (eager) | Lazy pull complicates the agent's flow (mid-task round-trips, partial knowledge). Eager pull buys a coherent up-front picture for negligible network cost. |
| **DEC-CL-3** | No `_index.json` lookup file in `controls/` | Adds drift risk for marginal gain — folder is small, agent can scan or hold the mapping in memory. Mirrors why `attributes/` has no index either. |
| **DEC-CL-4** | `classes[]` is a list (one entry per ControlClass) | Platform supports multi-class Controls. Per-(Control, ControlClass) attribute payload matches `setInstantiationAttributes` shape and avoids shoehorning multiple class templates into one `attributes` blob. |
| **DEC-CL-5** | `dt-update.ts` / `dt-import.ts` unchanged | Model sync stays focused on element + SUPPORTS-edge sync. Control-library writes are a separate phase, owned by the new `dt-control-library` module. |
| **DEC-CL-6** | Agent → operator handoff is **deferred-queue** with in-file `pendingEdit` markers; bulk decisions in the batched review screen are restricted to `cancel-all` and `clone-all` (never `push-anyway-all`) | Inside a 40-turn agent there is no synchronous way to pause for a human decision. Recording edits in an in-file `pendingEdit` block (not a side-file) keeps governance state visible in `git diff` and PR review, and batching the prompts into a single sync-time review screen avoids flow breakage. Enrich-time warnings are passive annotations; the blocking prompt fires only at `/dethereal:sync push`. Bulk `push-anyway` is intentionally excluded — a single click would write to potentially dozens of foreign models, re-introducing the silent-blast-radius risk DEC-CL-7 was written to prevent. |
| **DEC-CL-7** | Shared-ownership query failure → refuse-by-default with explicit error | Silent skip, fallback to cached `platformState.assignedModelIds`, or assumed-alone would all cause silent cross-model attribute corruption. `--force-unverified` provides an explicit per-control opt-out (audit-logged with `query_failure_reason` and `liveAssignedModelIds: null`). Available as a per-row choice in the batched review screen and as a CLI flag for non-interactive (CI) use; the CLI flag still produces per-control audit entries. Mirrors the refuse-by-default shape of DEC-CL-1. |
| **DEC-CL-8** | Greenfield push is idempotent via WAL-protected id write-back + per-class `pushedAt`/`localEditedAt` | The platform-create → per-class-attribute sequence is non-transactional across N+1 GraphQL calls and the id write-back touches multiple local files (POSIX has no multi-file atomic write). The WAL mechanism in [§7 ID write-back](#id-write-back-wal-protected) (`.dethereal/pending-id-rewrite.json`, fsync+rename = POSIX-atomic) anchors idempotency: a crash between platform-create and finishing the local-file rewrite is recoverable by replaying the journal on next sync entry. Per-class `pushedAt >= localEditedAt` enables resume without re-applying already-done work. Filesystem mtime is **not** used for `localEditedAt` — bumped explicitly by every writer so `git checkout` / editor rewrites / CI clones don't lose the marker. |
| **DEC-CL-9** | Pull is batched; `STALE_TTL = 15 minutes` gates **next** invocation only — never mid-session refresh | Sequential per-Control round-trips at 50–150ms each would burn 9–27s at the start of every control pass for a realistic model — "negligible" was wrong framing. Single batched query for metadata, single batched query for assigned-models. The TTL determines whether the **next** `/dethereal:enrich --focus controls` invocation re-pulls; an in-flight agent always works against the snapshot it pulled at session start, regardless of how long the session runs. This trades freshness for determinism and avoids surprising the agent mid-task with a re-fetched payload that contradicts what it already reasoned about. Operators on slow connections can override the TTL via `.dethereal/config.json`. |
| **DEC-CL-10** | Control phase gated on full model-push success | Control SUPPORTS assignment targets elements created by the model-push phase. Running the control phase after a partially-failed model push would produce silent "target element not found" failures. Fail loud: skip control phase, surface model errors, require operator to resolve element errors before re-running sync. |
| **DEC-CL-11** | Brownfield push uses **partial payload** keyed by `pendingEdit.previousAttributes`, not the whole `attributes` blob; per-key conflict detection prompts the operator for resolution | The platform mutation `setInstantiationAttributes` writes via `r += $attributes` (Cypher property merge), which is partial-friendly. Sending only the keys the operator/agent intended to change protects against the mid-session-staleness corruption case: if operator A's local snapshot is stale because operator B pushed an unrelated key in between, A's "push anyway" no longer silently overwrites B's edit. Per-key conflict detection (§7 brownfield Step D) catches the case where A and B touched the *same* key, surfacing a 3-way diff for explicit resolution. The alternative — full-payload push — required A's `attributes` to be a faithful representation of A's intent across every key, which is impossible to guarantee against mid-session staleness without re-reading the entire payload before every prompt and asking A to re-confirm every untouched key. The `pendingEdit.previousAttributes` key set is exactly the operator's intent record; the push respects it literally. |
| **DEC-CL-12** | Audit log (`force-shared` and `force-unverified` entries) is **committed** to the repository, not gitignored | The `force-*` entries are the V1 governance trail for cross-model writes — exactly what SOC 2 / ISO 27001 auditors look for ("who approved this cross-model attribute change and when"). Per-operator gitignore would lose entries on laptop reimage, hide them from PR review, and make them un-diffable against the model PR that triggered the edits. Committing them is the only V1-honest answer; per-operator attribution comes from the `operator` field on each entry (typically `git config user.email`). Append-only line-oriented JSON keeps `git diff` readable and merge conflicts trivial. The alternative — server-side audit sink — would require platform infrastructure not yet in scope for the dethereal plugin. |

---

## 12. Out of Scope

- **Control deletion semantics.** Platform-side deletion goes through `manage_controls(action: 'delete')`. Local-file reaction (tombstoning) is specified in §5 but no automatic GC.
- **Rollback of a half-applied greenfield push.** Step A of the greenfield push (`createControl`) creates the Control on the platform. If the operator abandons the model after that but before Step B completes, the orphan Control stays on the platform and the local file is in `partially-pushed`. Resume (next push) is the V1 recovery path; explicit rollback-on-abandon would require a separate undo command and platform-side delete + SUPPORTS cleanup. Out of scope for V1.
- **Control library export to a portable file** (e.g. `controls-library.json` for sharing across orgs). The platform is authoritative; no offline export pipeline yet.
- **Tenant-level shared control libraries** (vs per-org). Single-tenant scope only.
- **Attribute conflict resolution UI** when the same Control's attributes diverge across two model branches or two operators before either has synced. Documented as a known limitation in Open Question 3.
- **Cross-platform-instance Control identity.** A Control named "Azure Firewall" on a demo platform and the same-named Control on a prod platform have different UUIDs; pulling the same model into each environment will produce different `controls/<id>.json` files. V1 does not attempt to reconcile by name across platforms.
- **SUPPORTS edges to foreign-model elements.** A Control may end up supporting an element that belongs to a model the operator has no local copy of (e.g. shared infrastructure controls). The shared-ownership query still correctly counts the foreign model in `liveAssignedModelIds`, but the operator has no way to see that model's structure from inside this model's workflow. V1 surfaces the model IDs in the prompt; deeper cross-model visibility is a separate feature.
- **Automatic re-pull on `STALE_TTL` expiry mid-session.** See [DEC-CL-9](#11-decisions) for rationale. A future enhancement could add a "pull invalidated" signal when the operator triggers `/dethereal:sync pull` from a second terminal.

---

## 13. V1.1 Roadmap

Concrete deferrals captured during the V1 hardening initiative. Each entry is a **design sketch** — the implementation is not contractually frozen here; V1.1 may revise as it learns more.

Two things keep these out of V1:

1. **Migration story.** Two deferred changes alter the on-disk schema of `control-audit.log`, which is committed to operator repos and append-only forever. V1.1 will design the migration step (anchor block, schema-version field, verifier accept-with-warning).
2. **Threat-model trigger.** Two further deferred items are latent issues with no observed incident yet. V1.1 elevates them only if a real-world report appears.

### 13.1 — `authnOperator` JWT anchor on `AuditLogEntry`

V1 records `operator` (locally-claimed; spoofable). The `authnOperator` field carries the JWT-anchored truth from the OIDC token that authorised the platform mutation.

**Design sketch.**
- Apollo client extracts `email` / `sub` from the bearer token's payload (it already validates the token; this is a free read).
- The `apolloClient` wrapper exposes `getAuthClaims(): { email?: string; sub?: string }` for downstream use.
- `pushBrownfieldControl` and `pushGreenfieldControl` accept an `authnOperator` parameter (string sentinel for the unauthenticated case) and thread it into the `AuditLogEntry`. The `manage_controls` MCP tool is the only call site — adapt there.
- Three observable states the verifier must distinguish:
  - **absent** (`undefined`) → pre-V1.1 entry. Verifier reports `attribution: unknown-back-compat`.
  - **present** as an email or sub → JWT decode succeeded.
  - **present** as `'unauthenticated'` → no token / unparseable token at MCP layer.

**Migration story.**
- No data conversion needed (field is optional).
- Verifier (V1.1 `/dethereal:audit verify` skill) accepts absence with a structured INFO entry, not a warning.
- Operators who rotate keys partway through may see a mix of three states in one log; the verifier's per-entry classification handles that.

**Cost estimate.** ~30 lines across `audit-log-writer.ts` + `apollo-client.ts` + `manage-controls.tool.ts`, plus a small unit test. The JSDoc on `AuditLogEntry.authnOperator` already documents the three states ([audit-log-writer.ts:128-150](../../packages/dt-core/src/dt-control-library/audit-log-writer.ts)) so the contract surface is settled.

### 13.2 — Audit-log hash chain (`prevEntryHash`)

V1 trusts the operator to commit the audit log; a malicious operator with write access can `sed -i` an entry out without breaking anything visible. Hash-chaining makes any prior-entry edit detectable.

**Design sketch.**
- Add `prevEntryHash?: string` and `schemaVersion: 'v1.1'` to `AuditLogEntry`.
- `appendAuditEntry` reads the current last line of the log (cheap — append-only file with `O(file_size)` worst-case scan; the log is human-bounded, typically <1000 entries), computes `sha256(canonicalStringify(prevEntry))`, sets `prevEntryHash` accordingly. The first V1.1 entry has `prevEntryHash: '<v1-anchor>'` (a fixed sentinel marking the boundary).
- New `verifyAuditChain(modelDir): { valid: boolean; firstDivergenceLine?: number }` walks the chain and reports the first divergence.
- New `/dethereal:audit verify` skill renders the verifier output with operator-friendly context.

**Migration story.**
- V1 entries (no `prevEntryHash`, no `schemaVersion`) form an "anchor block" — the verifier reports them as `version: v1`, `chain-protected: false` and skips them.
- The first V1.1 entry seeds the chain with the sentinel; subsequent entries chain normally.
- A repo with a mix of V1 and V1.1 entries is honest about its mixed protection coverage.

**Cost estimate.** ~30 lines in `audit-log-writer.ts` + ~50 lines for `verifyAuditChain` + helper + tests. The existing `canonicalStringify` helper is the building block.

### 13.3 — `push-unverified` operator-asserted vs. engine-detected

Today the operator **declares** that the verification step ran (e.g. they confirmed the shared-ownership prompt). The engine trusts the declaration. A malicious or careless operator could fabricate the assertion.

**Design sketch.** Defer until threat-modelling indicates this matters.
- One option: a per-push signed assertion the platform issues at prompt time and the engine includes verbatim in the audit entry.
- Another: prompt-state token persisted across `/dethereal:sync` invocations so the engine knows "the operator was shown the §6 prompt at T-N seconds ago."
- The cleanest path probably requires a small platform change (issue + verify the token) — V1.1 design TBD.

**Cost estimate.** Unknown; depends on architectural decision.

### 13.4 — Multi-class controls last-write-wins

A single Control referenced by two ControlClasses with overlapping attribute keys can race: two enrich passes touch the same key on different `classes[idx]` and the last writer wins. V1 silently allows this.

**Design sketch.** Defer until V1.1 cardinality work.
- Two viable paths:
  - **Engine-level**: `setLocalEdited` rejects an edit when another `classes[idx]` already has a `pendingEdit` on the same key set.
  - **Platform-level**: `setInstantiationAttributes` rejects per-class writes that diverge on shared keys (requires a class-attribute-overlap registry).
- The platform path is the right long-term answer; the engine path is a stop-gap.

**Cost estimate.** Engine stop-gap: ~20 lines + tests. Platform fix: substantial, requires class-attribute-overlap modelling.

### 13.5 — V1.1 Backlog (improvement ideas)

Three items deferred by operator decision (defer-all-with-deferral-docs):

| Item | Trigger |
|---|---|
| Validator adversarial-input corpus test (~50 lines + fixtures dir) | Defence-in-depth for the validator's input surface; add when validator surface area grows |
| `O(n²)` dedup in shared-ownership query → `reduce(...)` form | Currently no-op at expected cardinality (≤10 modelIds); add when Memgraph ships `set()` or a real-world Control accumulates >1000 reachable Models |
| Memgraph index-bootstrap structured metric (`memgraph_index_bootstrap_failed_total`) | Production-debugging gap; add when ops dashboards exist that can consume the metric |

**Plus one earlier carryover:**

| Item | Why deferred |
|---|---|
| Memgraph bootstrap depth probe (`EXPLAIN MATCH ... :BELONGS_TO*0..50` at startup) | Today the `*0..50` raise is sufficient for the design's max boundary depth (~10 levels in practice). The probe is instrumentation that detects unindexed deep traversals on the actual model graph; defer until a real perf incident motivates it. |

---

## Appendix A. Implementation Notes

Recorded post-implementation — the design above is what landed; this appendix lists the small deviations and deferred items for traceability. (See §1 for the canonical landing date.)

### A.1 — `set-local-edited` MCP action added beyond original four

The original design listed four new `manage_controls` actions: `pull-controls`, `push-greenfield`, `push-brownfield`, `tombstone`. Implementation added a fifth — `set-local-edited` — that delegates to `DtControlLibrary.setLocalEdited`. Reason: routing the enrich agent through the engine method is the only way to guarantee the §4 two-write rule is not bypassed by direct JSON edits. The agent has filesystem write access; without an authoritative MCP path, the invariant is unenforceable.

### A.2 — `clone-and-swap` deferred to V1.1

`pushBrownfieldControl` recognises `decision.sharedOwnership: 'clone-and-swap'` but throws `CloneAndSwapNotImplemented`. The `/dethereal:sync` skill catches and renders a "V1.1 feature pending" message instructing the operator to choose `cancel`, `push-anyway`, or `push-unverified`. Implementing the path requires: a name-collision check via `manage_controls(action: 'list', name)`, name sanitisation (handling unicode + collision suffixes), and an atomic two-file WAL operation (clone Control + repoint this model's reference). Tracked as a V1.1 enhancement.

### A.3 — Step C `absent-but-known` collapsed to `absent-and-unknown` for V1

`pushBrownfieldControl` Step C classifies intended-edit keys as `present`, `absent-but-known`, or `absent-and-unknown` per CL §7. The `absent-but-known` branch requires the ControlClass template's `properties` keys to distinguish "schema-known but not yet set on this instance" from "platform doesn't know this key at all". The initial implementation didn't plumb template properties through the dt-class metadata cache. V1 collapses both into `absent-and-unknown` and aborts the push with a clear error message. V1.1 plumbs template properties through the `pull-controls` flow and re-introduces the `absent-but-known` branch (push the key as a re-add).

### A.4 — Bundle-safety lazy imports in dt-control-library

The dt-core barrel re-exports `dt-control-library/*` modules, which are also consumed by browser-bundled apps (dethernety-studio). Static `import * as fs from 'node:fs/promises'` at the top of `wal-helper.ts`, `audit-log-writer.ts`, and `file-io.ts` caused Vite to tag the entire `@dethernety/dt-core` barrel as `__vite-browser-external` at runtime, breaking the studio bundle. Fix: each Node-only import is now lazy-loaded behind a cached promise (`loadFs()`, `loadChildProcess()`) and `node:path` is replaced with inline POSIX `join()` / `dirname()` helpers. Compatible with the dt-export.ts pattern (existing precedent at the same barrel position).

### A.5a — Greenfield ID-rebinding closes the orphan-file corner case

The greenfield Control flow appears, on a casual read, to leave a stranded file: operator creates `controls/greenfield-abc.json` and writes `{id: null, name: "..."}` (or `{id: "greenfield-abc", ...}`) into `structure.json`; the next push asks the platform for a UUID; the structure entry is repointed to the new UUID — but the file is still named `greenfield-abc.json`.

The WAL pre-write rename (Appendix A.9) closes this seam by treating the rebinding as a single atomic operation:

1. Pre-`createControl` — write `<modelDir>/.dethereal/pending-id-rewrite.json` with `{tempId, intendedFiles, intendedRename}`.
2. Invoke `createControl(name, classes)` against the platform; receive `serverId`.
3. Rewrite every reference (`structure.json`, `dataflows.json`, `controls/greenfield-abc.json` body) `tempId → serverId`.
4. Rename `controls/greenfield-abc.json → controls/<serverId>.json`. Atomic on POSIX.
5. Delete the journal file. Push completes.

A crash between any two steps leaves the journal on disk. The next `/dethereal:sync push` (or the explicit `/dethereal:sync repair-wal <controlId>` recovery verb) replays steps 3–5 idempotently. The operator never observes an orphan greenfield file or a half-rebound structure.

This subsection is the design rationale; the engine implementation lives at [`wal-helper.ts:replayPendingRewrite`](../../packages/dt-core/src/dt-control-library/wal-helper.ts) and the operator workflow at [`oss/apps/dethereal/skills/sync/SKILL.md` § Repair WAL Recovery Verb](../../apps/dethereal/skills/sync/SKILL.md).

### A.5 — `pullControls` preserves in-flight `pendingEdit`

When the operator has an open `pendingEdit` block on a class entry and `pull-controls` is called for that control (e.g. as part of the sync skill's P7.2 batched fresh-fetch), `DtControlLibrary.pullControls` preserves the local `attributes` and `pendingEdit` while overwriting `platformAttributes` and `platformState.assignedModelIds`. This was needed so the sync skill could re-issue a single-call fresh-fetch without authoring a separate `batch-fetch-fresh` MCP action. The behaviour is documented in [dt-control-library.ts:241-265](../../packages/dt-core/src/dt-control-library/dt-control-library.ts#L241).

### A.6 — Demo2 integration test gated on `DEMO2_PATH` + `MEMGRAPH_URI`

[`oss/apps/dethereal/src/__tests__/integration/control-library-demo2.test.ts`](../../apps/dethereal/src/__tests__/integration/control-library-demo2.test.ts) exercises the full pull → set-local-edited → push-brownfield → re-pull loop against a live platform. Skips silently in CI (env vars absent). The DEC-CL-11 partial-payload regression (Test 5) verifies that editing only key A leaves platform-side keys B, C unchanged — the canonical contract for the entire design.

### A.7 — Audit log records attribute values verbatim (secret-handling caveat)

[CL §6 Audit log](#6-shared-ownership-safety) commits `.dethereal/control-audit.log` to the repository as a deliberate governance choice — auditors need the full pre-edit / post-edit / conflict-resolution context to reconstruct what happened. The corollary: any control attribute value that flows through a `force-shared` / `force-unverified` / `reverted` push is recorded **verbatim** in `attributesPushed` and `previousAttributes`, and is permanent in git history.

For control attributes that hold secret-like values (`api_key`, `password`, `vault_token_ref`, connection strings, JWT signing keys), this means:

- The terminal echo of the §6 single-control prompt and per-key conflict diff also prints the values verbatim. Operators in shoulder-surf-able environments should be aware.
- The audit log `.jsonl` lives under `.dethereal/control-audit.log` per model directory. Repos hosting models with secret-bearing controls should add `controls/control-audit.log` to `.gitignore` AND store secrets out-of-band (vault refs, environment-variable indirection on the platform side) rather than as literal Control attributes.

V1 does NOT auto-redact a known-secret-key list — control attribute schemas are operator-defined and there's no reliable heuristic for which keys are sensitive. The `/dethereal:sync` push skill does emit a one-time `NOTE` in the post-push summary pointing at this caveat. V1.1 may add a config-driven redaction list; V2 will likely route audit entries to a dedicated append-only secrets-aware sink rather than a git-tracked file.

This is an accepted V1 trade-off; document control attribute schemas with a sensitivity annotation in your module's class definitions and avoid storing literal secrets in Control attributes.

### A.8 — Step A external-edit guard is snapshot-relative; Step B re-fetches inline

The Step A guard at [dt-control-library.ts:534-542](../../packages/dt-core/src/dt-control-library/dt-control-library.ts#L534) checks `entry.attributes !== entry.platformAttributes && !entry.pendingEdit`, where `entry.platformAttributes` is the snapshot from the last `pull-controls` call. It does NOT re-query the platform at guard-fire time — by the time Step A runs, the snapshot is what's on disk.

**Inline re-fetching closes the silent-overwrite case for Step D conflict detection.** An earlier Step B trusted the caller's `freshPlatformAttrs` map, built once at `/dethereal:sync` P7.2's batched fetch. If a third party mutated the platform during the operator review window (seconds to minutes between P7.2 and P7.5), the snapshot would still show the operator's pre-edit value as the baseline — Step D would see no conflict, the third party's edit would be silently overwritten, no `force-shared` audit entry would record it. Step B now re-fetches `getControlInstantiationAttributes` inline per touched Control just before classification. Scope: ALL Controls (alone + shared) — the safety property is honest only if it covers every push regardless of shared/alone. Cost: one extra round-trip per touched Control.

**What this still doesn't cover:** the Step A guard itself doesn't re-fetch — it's a tripwire on the at-rest snapshot, not a live check. A third party who mutates after P7.2 but in a way that the operator's snapshot already accounts for (e.g., they wrote the same value the operator was about to push) is invisible to Step A. The Step D inline re-fetch catches the divergent case that matters; the at-rest tripwire is for the much commoner "operator hand-edited the file" case (now ALSO caught at the skill layer by the P7.1 pre-flight).

A V1.1 alternative is tracked: optimistic locking via `If-Match` on the GraphQL mutation eliminates round-trips for the happy path; the engine returns the conflict to the skill, which re-fetches only the conflicting rows. Defer until V1's per-push cost proves unacceptable in production.

The operator-facing mitigation lives in the `/dethereal:sync` P7.4 prompt rendering (the `retry-query <n>` verb re-fetches a single row's ownership and platformAttributes on demand).

### A.9 — Brownfield Step F crash-recovery is idempotent re-plan, not WAL replay

Greenfield gets WAL protection because its critical section (`controls/<tempId>.json` rename + every `controls[]` reference rewrite from temp id to server id) is multi-file. Brownfield Step F is per-class: each class entry's mutation is `setInstantiationAttributes(controlId, classId, partialAttrs)` followed by an in-memory `working.classes[i] = ...` update; the on-disk `writeControlFile` happens once at the end. A crash between class 1 and class 2 leaves: class 1's platform state mutated (per partial-payload contract), the on-disk file unchanged. Re-run sees `entry.attributes != entry.platformAttributes` for class 1 — but the partial-payload Cypher (`SET r += $attributes`) is idempotent, so re-applying class 1's partial payload is a no-op (platform already matches). Audit log for class 1 was already appended pre-crash, so the log is consistent. Class 2 then runs normally.

The maintainer-facing implication: the brownfield engine has no WAL because it doesn't need one. The crash-resilience contract is "re-plan from scratch and re-attempt; idempotent under partial-payload" — distinct from greenfield's "WAL replay reconverges from observed corruption". Don't mistakenly add WAL operations to brownfield in a future refactor.

**Crash-recovery contract layers** (now also inlined as a JSDoc block at `dt-control-library.ts` Step F):
1. *No on-disk mutation until success* — every `working.classes[i] = ...` is an in-memory edit; `writeControlFile` runs once after the loop. A crash between mutations leaves the file untouched.
2. *Re-plan from scratch on retry* — the next `push-brownfield` re-runs Steps A→F. Step A re-checks the external-edit guard, Step B re-fetches live platform attributes (the inline re-fetch catches concurrent mutations during the crash window), Step D re-runs conflict detection.
3. *Idempotent under partial-payload* (DEC-CL-11) — the Cypher mutation is `SET r += $attributes`. A class entry that was successfully pushed before the crash has its server state already at the desired value; the retry's outbound payload merges identical values (no-op).

The `pendingEdit` block on disk **is** the journal for brownfield. Caller responsibility: re-run `push-brownfield` after a transient failure. Step B re-fetch + Step D conflict detection + Step F partial-payload idempotency together ensure no data loss even on mid-batch abort.

### A.10 — CL §6 verb-table revision history

An early close-flow UX iteration introduced two verbs in the `/dethereal:sync` SKILL that didn't exist in the original CL §6 verb table:

- `cancel-everything` — full kill switch (cancels ALL rows including the safe-to-push group). Distinct from `cancel-all` which only cancels the prompted rows. The asymmetric default exists so an operator can deal with prompts without inadvertently blocking the safe-to-push push; the explicit `cancel-everything` verb is the explicit kill path.
- `drop <n>.<key>` was originally documented under "Per-key for re-add prompts (Step D Case 2)" only. Operator UX testing revealed that `drop` is also useful in the main per-key view (the operator wants to remove a key from the outbound payload AND from `pendingEdit.previousAttributes` so the next push doesn't surface the same conflict). The reconciliation moves `drop` into the main per-key list and clarifies that it serves both Step D Case 2 (re-add) and the main conflict view.

The CL §6 verb table now matches the `/dethereal:sync` SKILL exactly. A future revision should update CL §6 first and then propagate to the SKILL, not the other way around — the design doc is the auditor-facing contract.

### A.11 — Hardening additions

The hardening work added four security primitives orthogonal to the original CL design:

- **`authnOperator` field on `AuditLogEntry`**. JWT-anchored operator identity threaded through every `pushBrownfieldControl` audit-write call site. Optional for back-compat with older entries; populated whenever the MCP entry has a valid token. The locally-claimed `operator` field stays — a mismatch between the two is a forensic signal worth investigating.
- **`IllegalEditedByError`**. The `set-local-edited` MCP action's Zod enum drops `'external'`; the engine's `setLocalEdited` raises this error if a programmatic caller bypasses Zod. The `'external'` discriminator is reserved for the dedicated `promote-external-edit` recovery action.
- **`acquireLock` / `releaseLock`**. File-based advisory lock at `.dethereal/.control-library.lock` with PID + signal-zero stale detection. Wraps every `manage_controls` action that takes `directory_path`. Closes the WAL/audit-log corruption window from concurrent invocations.
- **WAL replay at every MCP entry**. `applyPendingRewrites` is called at the top of `manage_controls.execute()`'s switch, after lock acquisition and before action dispatch. An earlier implementation invoked replay only inside `pushGreenfieldControl`, so a stranded greenfield journal would silently persist across `pull-controls` / `push-brownfield` / `set-local-edited` operations.

Each addition has a unit-test suite under `oss/packages/dt-core/src/dt-control-library/__tests__/`.

### A.12 — Hardening design-choice rationale

The hardening initiative landed several architectural decisions where multiple defensible options existed. Recording the rejected alternatives here so a future revisitor doesn't re-derive the comparison from scratch.

**WAL replay seam — chose MCP-tool layer over engine layer.**
- Option (a, chosen) — `applyPendingRewrites(modelDir)` invoked at the top of `manage_controls.execute()`, after lock acquisition and before action dispatch. Six action handlers; replay runs once per entry regardless of which action fires.
- Option (b, rejected) — replay invoked inside each `DtControlLibrary` public method (six methods).
- Why (a) won: the engine layer stays free of cross-cutting concerns (replay, locking, JWT extraction) — those are responsibilities of the MCP boundary that owns the `directory_path` parameter and the operator session. Keeping the engine pure makes it independently usable from non-MCP callers (e.g. integration tests, dethernety-studio) without inheriting MCP-specific lifecycle hooks. Option (b)'s "harder to bypass" trade was real but mitigated by the fact that engine methods are not part of the public MCP surface.
- When to revisit: if a future non-MCP caller appears that needs the same replay-on-entry semantics, lift the call into the engine OR introduce a thin façade that does both — don't duplicate the replay logic at every entry.

**TOCTOU window — chose per-control fresh-fetch over `If-Match` semantics.**
- Option (a, chosen) — `pushBrownfieldControl` Step B re-fetches `getControlInstantiationAttributes` inline per touched Control just before classification. One extra round-trip per touched Control; ~all client-side; ships in V1 with no schema changes.
- Option (b, deferred to V1.1) — `updatedAt` field on the `IS_INSTANCE_OF` edge with `If-Match` on the GraphQL mutation. Schema work in dt-ws; per-mutation conflict reported by the server; eliminates the client-side round-trip on the happy path.
- Why (a) won: the safety property (catch concurrent mutations during the operator review window) is the priority for V1; the round-trip cost is acceptable at expected control counts (~10 per push). Option (b) is the right long-term answer but requires a server-side schema change and conflict-handling protocol that's V1.1-scoped.
- When to revisit: if the per-push round-trip cost becomes user-visible (operator complaints about slow pushes on shared brownfield Controls), or if the server schema gains optimistic-locking primitives for unrelated reasons, swap to option (b). The implementation is contained to `pushBrownfieldControl` — the swap is local.
- Documented as a V1.1 alternative in Appendix A.8.

**Risk-register Plan-B fallbacks (kept for swap traceability).** Each hardening item whose preferred technical bet had a documented fallback path:
- **JWT plumbing** — preferred path threads the token through the MCP `ToolContext` shape. Plan B (not exercised): `audit-log-writer.ts` reads the token directly from `~/.dethernety/tokens.json`. Less elegant (writer touches storage rather than receives an injected value) but ships in V1 if the `ToolContext` change turns out to be invasive elsewhere.
- **Advisory lock** — preferred path uses `proper-lockfile`. Plan B (chosen): `fs.open(path, 'wx')` sentinel — zero-dep, slightly more code, verified to not break the dethernety-studio bundle. Recorded here because if a future maintainer considers swapping back to `proper-lockfile`, they need to re-verify the studio-bundle compatibility.

**Later hardening design choices** are captured at each call site — JSDoc at the engine layer and inline comments at the touch points encode the why. Commit-level history is in `git log`.
