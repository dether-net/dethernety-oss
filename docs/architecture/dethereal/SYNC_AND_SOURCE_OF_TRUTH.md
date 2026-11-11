# Sync Architecture and Source of Truth

> **Date**: 2026-03-26
> **Inputs**: Security Architect, Process Architect, Claude Code Expert, Security UX Designer
> **Status**: Implemented. The push's conflict check shipped as a signed platform baseline (Section 12); Sections 9 and 11 keep the design-time lists, with notes on what shipped. Control-library decisions: [CONTROL_LIBRARY.md §11 Decisions](CONTROL_LIBRARY.md#11-decisions).

---

## 1. Source of Truth: Dual-Authority Model

All four reviewers converge on the same recommendation: **neither side is "the" single source of truth. The architecture should adopt a dual-authority model.**

### The Two Authorities

| Concern | Authority | Rationale |
|---------|-----------|-----------|
| **Model structure** (components, boundaries, flows, attributes, data items, classifications) | Local filesystem (git-versioned) | Developer-centric, offline-capable, auditable via git log, rollback via git |
| **Control references** (SUPPORTS edges: which Control applies to which element in *this* model) | Local filesystem (git-versioned) | Part of model structure; captured as `controls[]` arrays in `structure.json` / `dataflows.json` / `data-items.json` with the `{id, name, source}` shape. A data item's absent `controls` key leaves its platform controls in place on push, where an element's absent key clears them ([IMPORT_EXPORT.md — Data Item Controls](../dt-core/IMPORT_EXPORT.md#data-item-controls)). |
| **Control library** (Control nodes, per-instance `IS_INSTANCE_OF` attributes) | Lifecycle-dependent — see [CONTROL_LIBRARY.md](CONTROL_LIBRARY.md) | Greenfield: local file under `controls/<id>.json` is authoritative until first push. Brownfield: platform is authoritative, local file is a cache. Edits to shared brownfield Controls fire the explicit shared-ownership safety prompt ([CONTROL_LIBRARY.md §6](CONTROL_LIBRARY.md#6-shared-ownership-safety)) at `/dethereal:sync push` time, because a single Control is reused across many models. Pull / push / tombstone / set-local-edited drive through `manage_controls` MCP actions; the engine enforces the two-write rule, the partial-payload contract and the shared-ownership safety ([CONTROL_LIBRARY.md §4, §7 and §6](CONTROL_LIBRARY.md)). |
| **Computed artifacts** (exposures, analysis results, countermeasure-exposure links, OPA/Rego evaluations, cross-model graph analysis) | Platform (graph database) | Requires graph traversal, OPA engine, multi-model composition -- cannot be replicated locally |

### The Analogy

**Push is a publish operation, not a sync operation.** The local model is the manuscript; the platform is the published version. Pull is an import that creates a working copy. This framing avoids the false promise of "bidirectional sync".

> *"Local files are your working copy. The platform is the shared repository. You push changes up, pull changes down. If both sides changed, you resolve the differences."*

### Recommendation on Best Practice

When using the Dethereal plugin, **local-first is the recommended workflow**: create and enrich locally, push to platform for analysis. The platform receives snapshots, not the canonical version. Git provides version history, branching, and collaboration.

However, the architecture must prepare for both directions because:
- Platform-first users exist (GUI model creation, then pull for CLI enrichment)
- Team workflows require pulling models created by others
- Referenced models may originate from different workflows

---

## 2. Scenarios and Workflows

### Scenario 1: Local-First (Plugin Creates, Platform Receives)

**Support level**: Fully supported -- the golden path.

**Flow**: create -> enrich -> review -> sync push -> post-sync linking

**No changes needed** except:
- After `applyIdMapping()`, suggest commit: *"Server IDs written to local files. Commit these changes to preserve sync state."*
- If `manifest.model.id` is already set on push, use `update_model` (not `import_model`) to prevent duplicates.

---

### Scenario 2: Platform-First (Pull, Enrich Locally, Push Back)

**Support level**: Supported.

**Flow**:
1. `/dethereal:login`
2. `/dethereal:sync pull` -- select from the model list (`list_models`)
3. `export_model` writes split files, registers the directory in `.dethernety/models.json`, and writes `sync.json` with the signed platform baseline (Section 4), so the first push after the pull is checked against the platform model as it was pulled
4. **State bootstrap**: `model_state` `merge_pulled` infers the state, or keeps an existing one (Section 3); `validate_model_json` records the quality score
5. User enriches locally via skills
6. `/dethereal:sync push` -- routes to `update_model` (not `import_model`) because `manifest.model.id` exists

**Gaps identified at design time** (all closed):

| Gap | Description | Status |
|-----|-------------|--------|
| State inference | `model_state` `merge_pulled` infers the state from content, or keeps an existing one | Done |
| Quality computation | `validate_model_json(action: 'quality')` on pull; the tool records `.dethereal/quality.json` | Done |
| Models registry | `export_model` registers the directory in `.dethernety/models.json` | Done |
| Push routing | `manifest.model.id` chooses `update_model` vs `import_model` | Done |
| `list_models` implementation | Lists the platform models for the pull's model choice | Done |
| Scope materialisation | Pull writes `.dethereal/scope.json` from the platform `Model` scope fields (merge-preserving any skill-owned local-only keys); push reads it back. Legacy models with no scope ⇒ file simply carries no synced keys | Done |

---

### Scenario 3: Pull to Empty Folder (Cross-Environment)

**Support level**: Same as Scenario 2 plus:
- No git history on pulled model. Suggest first commit after pull.
- Module/class mismatch possible across platform instances. The manifest stores module ID + name but not version. Push finds each class by id, then by module and class name, and leaves an element whose class the target platform lacks as it is, with a warning — see [Class Resolution on Push](#class-resolution-on-push).

---

### Scenario 4: GUI Edit After Push (Local Staleness)

**Support level**: Supported -- the push is refused when the platform model changed since the last pull or push.

**The dangerous case**: User pushes, colleague edits in GUI, user pushes again. A push replaces each element it sends, and with `delete_orphaned: true` (which the sync skill always sets) it deletes platform elements the local model does not hold. Without a check, the colleague's work would be overwritten or deleted without a word.

**How the push handles it** (no platform schema changes required):

1. Every pull and push records a signed fingerprint of the platform model, per element and per field class, in `sync.json` (`platform_baseline`, Section 4).
2. Before an update push writes anything, `update_model` exports the platform model, fingerprints it the same way, and compares the two within the field classes the push writes.
3. Any difference refuses the push with `PLATFORM_CHANGED_SINCE_SYNC`. The refusal lists the elements added, changed and deleted on the platform.
4. The operator answers `push` (overwrite exactly the listed changes), `pull` (with a backup) or `cancel`.

See **Section 12: Push Conflict Resolution** for the complete flow, and Section 6 for the UX.

**Note on `updatedAt`**: Adding `updatedAt` to the Model graph node would enable a fast staleness check (single property read vs full export). However, tracking `updatedAt` is complex — every mutation to any model-related node (component, boundary, flow, attribute, class assignment, layout change, analysis module Cypher writes) must propagate to the parent Model. This includes 5 distinct mutation channels, some of which bypass application code. See **Section 14: Platform Dirtiness Tracking** for the full analysis. The push compares a platform export with the recorded baseline instead (no platform changes; every mutation channel shows up in the export). An application-level `updatedAt` is not built.

---

### Scenario 5: Clone / Version

**Support level**: Not supported -- no clone mechanism. The flow below is proposed, not implemented: `/dethereal:create` takes a description or a template, and has no `--from`.

**Proposed flow** (`/dethereal:create --from <source>`):

1. Resolve source (local path or platform model ID)
2. Deep copy all files to new directory
3. Generate new UUIDs for all elements (model, boundaries, components, flows, data items)
4. Update all internal cross-references
5. Clear platform model ID (`manifest.model.id = null`)
6. Reset audit trail (sign-off cleared -- clone has not been reviewed)
7. Preserve enrichment data (classifications, attributes) as time-saver
8. Set state to ENRICHING (structural changes expected)
9. Register in `.dethernety/models.json` with `source: "clone"` and `clonedFrom` lineage

**Critical**: If a user copies a model directory manually (`cp -r`) and pushes without clearing the platform ID, it overwrites the original. The proposed pre-push check (warn when `manifest.model.id` matches another registered local model) is not built either. Today the copy's first push is refused instead: the platform baseline in `sync.json` is bound to the original directory's real path, so in the copy it reads as `unverifiable` (or `missing`, when `sync.json` was not copied) and every platform element is listed as changed; for `unverifiable` the plugin says the directory was moved, renamed or copied, or another platform URL is set. Answering `push` there still overwrites the original.

**Git branching does NOT work for model versioning.** The platform model ID in `manifest.json` does not change across git branches. Pushing from branch B overwrites the same platform model as branch A. Clone with new IDs (the proposed `/dethereal:create --from`) is the only correct pattern for creating independent model versions.

---

### Scenario 6: Referenced Models (representedModel)

**Support level**: Partially supported -- `DtExportSplit` exports the reference; `DtImportSplit` resolves it on import.

**Design principles** (all four reviewers agree):

1. **Never auto-pull referenced models.** Recursive pull creates unbounded scope.
2. **Display references clearly** on pull: *"This model references 2 other models: 'API Service', 'Auth Service'. These are not pulled automatically."*
3. **Preserve references on push.** Do not modify `REPRESENTS_MODEL` relationships.
4. **Handle missing references gracefully.** Flag as warning, not error: *"Component X references model abc-123 which cannot be verified locally."*
5. **Track references** for awareness. `/dethereal:sync status` lists the referenced model ids, which `workspace_status` reads from the `representedModel` references in `structure.json` (ids only, at most 20). The pull lists each referenced model and whether it is registered locally. `sync.json` also has a `referenced_models` field, a list of platform model ids, but the pull and push tools leave it empty:

```json
{
  "referenced_models": []
}
```

#### Cross-Model Trust Assumptions

When setting `representedModel` on a component or boundary, the plugin should capture trust assumptions at the model boundary. These follow the same pattern as D48 (`auth_failure_mode`): capture now as attributes or scope trust assumptions (D49), engine integration later.

Key trust dimensions to capture:
- **Authentication trust**: Does this model trust the referenced model's authentication decisions? (`full` / `verify` / `zero`)
- **Boundary crossing**: Does the connection to this component cross a trust boundary in the originating model's terms?
- **Auth delegation**: Is auth handled by the referenced model, independently, or passed through? (`delegated` / `independent` / `passthrough`)
- **Data sensitivity at boundary**: Maximum sensitivity of data flowing to/from the referenced model (`public` / `internal` / `confidential` / `restricted`)

#### Cross-Model Analysis Gap

Graph-based analysis builds a graph per model. It does not follow `REPRESENTS_MODEL` edges. This means:

- **Privilege escalation chains** crossing model boundaries are not detected
- **Credential blast radius** spanning models is understated
- **Crown jewel reachability** from another model's entry points is not computed
- **Lateral movement loops** spanning models are invisible
- **Graph-structural scores** are computed only within each model's subgraph, losing broader system context

An AI-assisted analysis that reads a sub-model's existing analyses as context has some cross-model awareness, but that is LLM-mediated reasoning, not graph-traversal analysis.

**Mitigation for the plugin:** Each decomposed model should contain at least one entry point AND at least one crown jewel. The review phase flags: *"N components reference external models. Attack paths through these components are not included in this model's analysis."*

**Platform-level fix (not plugin scope):** The platform's analysis could support a cross-model mode that constructs a unified graph by following `REPRESENTS_MODEL` edges and merging referenced models' components. The data is in the graph database; the query needs to follow the edge.

#### Decomposition Plan Metadata

When the user accepts a decomposition recommendation (see THREAT_MODELING_WORKFLOW.md Section 9), the plugin writes `.dethernety/decomposition-plan.json` tracking planned models, completion status, and cross-model links. `/dethereal:status` reads this file and displays multi-model progress.

The decomposition plan is a convenience artifact, not a commitment. Users may complete only one model and defer the rest indefinitely.

**Deferred**: Cross-model authorization boundaries (per-model access control) and system replacement at scale (bulk-updating references when a referenced system is replaced) are deferred. The platform does not currently support model-level authorization. These are platform-level concerns, not plugin concerns.

---

### Scenario 7: Multi-User (Concurrent Edits)

**Support level**: Supported for detection -- the same check as Scenario 4. When two plugin users push the same model, the second push is refused with `PLATFORM_CHANGED_SINCE_SYNC` and lists the first user's changes, until the second user pulls or overwrites exactly those changes.

**Recommendation**: Use git as the collaboration layer. One user pushes at a time. Pull before push. Document as the recommended pattern (same model as `git pull` before `git push`).

**Not built**: server-side optimistic concurrency control (a version counter or content hash). The platform-baseline check runs before the write, not atomically with it (Section 12, accepted tradeoffs).

---

## 3. State Inference Algorithm

After a pull, `model_state` with `action: 'merge_pulled'` reconciles the workflow state with the pulled content. When the directory has no workflow state yet, the tool infers it from content:

```
function inferState(modelPath):
  structure = read structure.json
  components = countComponents(structure)
  dataflows = read dataflows.json
  attributes = read attributes/

  if components == 0:
    return INITIALIZED

  classifiedCount = components with classData set
  attributeCount = attribute entries of any element

  if dataflows.length == 0:
    return SCOPE_DEFINED                    // has structure, no flows

  if classifiedCount == 0 && attributeCount == 0:
    return STRUCTURE_COMPLETE               // has flows, nothing enriched

  return ENRICHING                          // some enrichment exists
```

**An existing state is kept.** When the directory already has a workflow state, the pull keeps it, together with the rest of `state.json` (the drift baseline, the sign-off, the elements awaiting re-enrichment). The tool's `note` says when the pulled content supports a later state (advance with a transition) or only an earlier one (consider a backward transition).

**Key decisions**:
- **DISCOVERED is skipped** -- discovery is a plugin concept; platform models were not "discovered"
- **REVIEWED is never inferred** -- review is a human attestation, must be explicit
- An inferred state is marked `inferredFromContent: true` so the guided workflow can adjust messaging

---

## 4. Sync Metadata

D40 originally deferred the sync implementation details, but `sync.json` shipped, and it now also carries the signed platform baseline that the push check reads (Section 12). The pull and push tools write it themselves; it is never written by hand.

### `<model-path>/.dethereal/sync.json`

```json
{
  "platform_model_id": "abc-123-def-456",
  "platform_url": "https://dethernety.example.com",
  "last_pull_at": "2026-03-26T10:00:00Z",
  "last_push_at": null,
  "pull_content_hash": "sha256:v2:...",
  "push_content_hash": null,
  "baseline_element_ids": {
    "boundaries": ["b-001", "b-002"],
    "components": ["c-001", "c-002", "c-003"],
    "flows": ["f-001", "f-002"],
    "dataItems": ["d-001"]
  },
  "referenced_models": [],
  "platform_baseline": {
    "v": 1,
    "model_id": "abc-123-def-456",
    "recorded_at": "2026-03-26T10:00:00Z",
    "elements": {
      "@model": { "k": "model", "n": "Production Stack", "f": { "properties": "...", "controls": "...", "asset_context": "..." } },
      "c-001": { "k": "component", "n": "API Gateway", "f": { "properties": "...", "structure": "...", "layout": "...", "controls": "...", "data_items": "...", "attributes": "...", "asset_context": "..." } }
    },
    "mac": "..."
  }
}
```

**Platform baseline**: what the platform model looked like at the last pull or push. Each element (with `@model` for the model's own fields) has a name and one short hash per field class: `properties`, `structure`, `layout`, `controls`, `data_items`, `attributes`, `asset_context`, and, for data items, `item_attributes`. The hashes are always taken from a platform export, never from local files, so both sides of the comparison go through the same normalisation. The record is signed (HMAC-SHA256) with a key this machine keeps outside the project, and bound to the model id, the platform URL and the model directory's real path. The push check reads it as one of four states: `verified`; `missing` (no `sync.json`); `legacy` (a `sync.json` without a baseline); or `unverifiable` (the signature or the binding fails: the directory was moved, renamed or copied, or another platform URL is set). Anything but `verified` makes every platform element count as changed. A pull or push that cannot record a baseline removes the old one and reports `platform_baseline: "not_recorded"` with a warning, so its own writes are never read as platform changes later; if even the removal fails, the warning says the old record was kept.

**Content hash**: SHA-256 over the semantic content of the model directory, version-tagged as `sha256:v2:<hex>`. It covers the four top-level files (`manifest.json`, `structure.json`, `dataflows.json`, `data-items.json`), **`.dethereal/scope.json`** (model scope + skill-owned local-only keys), and the per-element `attributes/{boundaries,components,dataFlows,dataItems}/*.json` bags, sorted within each subdir. It **excludes non-semantic properties**: diagram layout (`positionX`, `positionY`, `dimensionsWidth`, `dimensionsHeight`) and churny export/edit metadata (`modifiedAt`, `exportedAt`), so cosmetic re-exports do not trigger staleness warnings. A stored hash whose version prefix differs from the current algorithm is treated as a clean baseline (silently re-baselined on the next sync), not as local changes.

**Baseline element IDs**: Still captured after every push and pull, from the model files. The push check does not read them: it reads `platform_baseline`, which tells platform additions (C1) from local deletions (C2) on its own. See Section 12.

**Gitignore policy**: `sync.json` is kept out of git (per-user, per-instance state): it is listed in `.dethereal/.gitignore` with the server's other per-machine files (`PER_MACHINE_FILES` in `src/utils/settlement-writers.ts`) — `control-audit.log`, the enrichment relay folder `relay/`, and `settlement-baseline.json` and `settlements.json`, which exist only with the settlement on. The server writes that file when it registers values or pulls (with the settlement off, on every pull, push and `model_state` change) — creating the file if absent, only appending missing lines, never writing through a link. A repository that already tracks one of them needs a one-time `git rm --cached -- <file>`, run by the operator. Two developers pulling the same model have independent sync state.

**Missing `sync.json`**: when `sync.json` is missing but `manifest.model.id` is set (a fresh clone, or a lost file), nothing reconstructs it. The push goes ahead: the server refuses with `PLATFORM_CHANGED_SINCE_SYNC` and `baseline: missing`, listing every platform element, and the operator answers as for any other refusal (Section 12). Pulling only to get the file back is never suggested, because a pull overwrites the local model.

---

## 5. Pull UX

### First Pull (Model Selection)

A model id in the arguments is used as given; a name is used only if exactly one platform model has it. Otherwise the plugin lists the platform models (`list_models`) by name and description:

```
User: /dethereal:sync pull

  1  Production Stack       Customer-facing web stack
  2  Staging Environment    Pre-production copy of the stack
  3  Payment Service (v2)   Card payment processing

Which platform model? Give its number or id.
```

The target directory is the one given, or `./threat-models/<kebab-case model name>/`.

### Pull Output (State Bootstrap)

```
Pulled "Production Stack" from platform.

  Written to: ./threat-models/production-stack/

  manifest.json        Model metadata
  structure.json       5 boundaries, 12 components
  dataflows.json       8 data flows
  data-items.json      3 data items
  attributes/          14 attribute files
  .dethereal/scope.json  Model scope (synced keys merged; local-only keys preserved)
  controls/            6 control file(s) refreshed

  Quality: 72/100 (Good)
  State:   ENRICHING (inferred from content)
  Backup:  none

  This is now your working copy.
  Edit locally, then /dethereal:sync push to send changes back.
```

The state line is what `merge_pulled` returned; "inferred from content" appears only when the model had no state before. When the pull replaced an existing model directory, `Backup:` names the backup.

**Control files.** `export_model` writes the `controls[]` references but not the per-control files, so the pull then runs `manage_controls` `pull-controls` once for every Control id the pulled `structure.json` and `dataflows.json` reference. A pull returns a self-consistent directory: no follow-up `pull-controls` is needed. For each control file:

- a referenced Control is refreshed (or created) as `controls/<id>.json` with the platform's current state;
- an in-flight `pendingEdit` is kept: the operator's edited `attributes` stay, and only `platformAttributes` is refreshed (the summary says how many files kept one);
- a brownfield control file edited by hand, with no `pendingEdit`, gets the platform's values (this is why drift makes the pull ask first, below);
- a partially-pushed control stays resumable: the pull does not overwrite its class values that were not pushed yet, so the next push continues it;
- a brownfield or partially-pushed file whose id the platform no longer returns is marked `tombstoned`, not deleted;
- a reference without a usable id is not sent, and is named in the summary.

A recovery-journal error (`WAL_REPLAY_FAILED`, `WAL_JOURNAL_REJECTED`) or `MODEL_TREE_UNSAFE` stops the pull at this step and points to `/dethereal:sync repair-wal`; for `MODEL_TREE_UNSAFE` the operator fixes the named path. Any other per-id error is a warning in the summary.

### Pull With Local Changes

Before anything is exported, the pull checks the target directory with `workspace_status`:

- **Another platform model** in the directory: the pull stops and suggests a new directory. It never pulls over another platform model, and `export_model` refuses it too (`directory_linked_to_other_model`).
- **A recovery journal** (`controlLibrary.journal`): the pull stops and points to `/dethereal:sync repair-wal`.
- **No local changes and no control work** (`sync.status: no_local_changes`, and `pendingEdits`, `drift` and `unpushed` all 0): the pull goes ahead. The content hash does not cover `controls/`; the control-library counts do.
- **Anything else** — local changes, never synced, a state that cannot be compared, or control work not pushed (pending edits, drift, unpushed controls): the plugin shows what `workspace_status` reported, then asks:

```
Local "Production Stack" has changes the platform does not have. Pulling will OVERWRITE the model files (a backup is taken first). (push first / backup / overwrite / cancel)
```

- `push first` -- stops, and tells the operator to run `/dethereal:sync push` for this directory, then `/dethereal:sync pull` again. Nothing is pulled.
- `backup` or `overwrite` -- pulls. Both keep a backup, because the export always runs with `if_exists: 'backup'`: a full copy of the model tree beside the directory, `./threat-models/production-stack.backup-<timestamp>/`.
- `cancel` -- stops; nothing changes.

A push that met a platform conflict and was answered `pull` hands over with `backup` already chosen, so the question is not asked again.

---

## 6. Push UX (Conflict-Aware)

### Happy Path (No Platform Changes)

```
/dethereal:sync push

Pushed "Production Stack" to platform.
  5 boundaries, 12 components, 8 flows, 3 data items.
  Platform model ID: abc-123-def-456

Server IDs written to local files.
Commit these changes to preserve sync state.
```

Any control link warning, the local-only asset notice (crown-jewel marks on non-component elements are not synced) and a `settlement_registration` warning follow the summary. The control-library push runs after the model push and prints the combined footer.

### Platform Changed Since the Last Sync

The refusal's `data` holds `baseline`, `revision`, `changes_total`, `changed_ids` (every changed id) and `changes` (the detail of the first 500: `id`, `kind`, `name`, `change`, `fields`). The plugin shows them as a table in three groups — added on the platform, changed on the platform (content changes first, then the elements whose only change is `layout`, together on one line), deleted on the platform — with `@model` standing for the model itself. Illustrative render:

```
/dethereal:sync push

The platform model changed since your last pull or push: 7 element(s).

| Group                                   | Kind      | Name                        | Fields               |
|-----------------------------------------|-----------|-----------------------------|----------------------|
| Added on the platform (push DELETES)    | component | API Rate Limiter            |                      |
| Added on the platform (push DELETES)    | component | Redis Sentinel              |                      |
| Added on the platform (push DELETES)    | flow      | Rate Limiter -> API Gateway |                      |
| Changed on the platform                 | component | Payment API                 | attributes, controls |
| Changed on the platform (layout only)   |           | Web Frontend, Auth Service  | layout               |
| Deleted on the platform (push recreates)| flow      | Legacy Auth -> Database     |                      |

Push the local model (the platform elements listed are DELETED), pull the platform version first, or cancel? (push / pull / cancel)
```

- `push` calls `update_model` again with `overwrite_changed` = the refusal's full `changed_ids` and `overwrite_revision` = its `revision`. If the platform changed again since the refusal, the push is refused with `acknowledgement: "stale"` and the new changes are shown and asked about again. With more than 5,000 changes the server cannot overwrite them by name: only `pull` or `cancel` is offered.
- `pull` hands over to the pull with a backup (Section 5); nothing is pushed.
- `cancel` stops.

When `changes_total` is larger than the rows shown, the plugin says `+N more`. A success with `acknowledgement: "unused"` means nothing had changed after all.

### No Usable Baseline

With `baseline` `missing` or `legacy` every platform element is listed as `no_baseline`: there is no usable record of the last pull or push, so the server cannot tell what changed. With `unverifiable` the record exists but does not verify here: the directory was moved or renamed, the model copied, or another platform URL is set. The plugin says which in one line, then asks the same question. Data-loss warnings are the same for every operator; there is no expert mode that compresses them.

### Push Routing Logic

```
if manifest.model.id is set:
  use update_model with delete_orphaned: true (existing platform model)
  update_model checks the platform model against the signed baseline first (Section 12)
else:
  use import_model (new platform model, nothing to conflict with)
```

---

## 7. Status Display

`/dethereal:sync status` reads `workspace_status` (with the directory) and `auth_status`. It shows the model name, state (the display state when present) and quality; the platform model id or "not pushed", the platform URL and who is signed in; the last push and pull; the local state from `sync.status` (no local changes, local changes not pushed, never synced, or unknown with its `problem`); the control-library counts that are not 0, with a recovery journal pointing to `/dethereal:sync repair-wal`; and the referenced model ids. The plugin never computes a hash itself. Illustrative:

```
Model:      "Production Stack"   ENRICHING   73/100 (Good)
Platform:   https://dethernety.example.com   model abc-123
Signed in:  user@example.com (38 min left)
Last push:  2 hours ago     Last pull: never
Local:      local changes not pushed
Controls:   14 controls; 2 with pending edits; 1 not yet pushed
Referenced: xyz-789
```

The next step it suggests is `/dethereal:sync push` when the model was never synced or never pushed, or has local changes or control work, and `/dethereal:status` otherwise.

---

## 8. Metadata File Layout After Pull

```
project-root/
  .dethernety/                              # Plugin-level (project root)
    models.json                             # Registry: name, path, createdAt, source ("pull")
  threat-models/
    production-stack/                       # User-chosen visible path
      manifest.json                         # SplitModel
      structure.json
      dataflows.json
      data-items.json
      attributes/
      controls/                             # One <id>.json per referenced Control, refreshed by the pull
      .dethereal/                           # Per-model plugin metadata
        state.json                          # Inferred: currentState, inferredFromContent (or the existing state, kept)
        quality.json                        # Computed on pull
        scope.json                          # Model scope, materialised from the platform's scope fields
        sync.json                           # Sync tracking and the signed platform baseline (this machine's)
        settlement-baseline.json            # Settlement on only: values registered as the operator's, the pulled ones (this machine's)
        settlements.json                    # Settlement on only: log of registrations (this machine's)
        .gitignore                          # Keeps this machine's files out of git
        # No discovery.json (not discovered via plugin)
```

`sync.json`, `control-audit.log`, the enrichment relay folder `relay/`, and — only with the settlement on — `settlement-baseline.json` and `settlements.json` belong to this machine; the server lists all of them in `.dethereal/.gitignore` when it registers the pulled values. With the settlement off, the pull registers nothing and writes no settlement file, but still writes `.dethereal/.gitignore`. The model files, `controls/`, `state.json`, `quality.json` and `scope.json` are model content and are committed.

---

## 9. Prerequisites

The design-time list of prerequisites, split by whether they need a platform change, with what became of each item.

### Without Platform Changes

| Change | Where | Effort | Enables | Status |
|--------|-------|--------|---------|--------|
| `list_models` MCP tool implementation | MCP server | Medium | Pull model selection (Scenario 2) | Done |
| State inference on pull | `sync pull` skill | Medium | Resume after pull (all pull scenarios) | Done, as `model_state` `merge_pulled` |
| Quality computation on pull | `sync pull` skill | Low | Status display after pull | Done |
| Push routing (`update_model` vs `import_model`) | `sync push` skill | Low | Correct push for pulled models | Done |
| `sync.json` with `baseline_element_ids` | `sync` skill | Low | Conflict detection | Done, written by the pull and push tools; conflict detection reads the signed `platform_baseline` |
| Pre-push element ID comparison + conflict UX | `sync push` skill | Medium | Prevent silent data loss (Scenario 4) | Done in another form: the platform-baseline check inside `update_model` (`PLATFORM_CHANGED_SINCE_SYNC`) |
| `/dethereal:create --from` (clone) | New skill flag | Medium | Model versioning (Scenario 5) | Not built |
| Scope fields on Model graph node | GraphQL schema | Low | Scope preservation on pull (see Section 15) | Done |

### With Platform Changes

| Change | Where | Effort | Enables | Status |
|--------|-------|--------|---------|--------|
| `updatedAt` + `createdAt` on Model graph node | Schema + 3 orchestrators | Medium | Fast staleness check (10ms vs 1-3s) | Not built |
| Attribute-level diff + merge UX | `sync push` skill | High | Per-attribute conflict resolution | Not built; the platform-baseline check detects attribute changes per element, with no merge |
| Per-element selective push | `sync push` skill + `DtUpdate` | High | Cherry-pick which changes to push | Not built |
| Optimistic concurrency control | Backend | Medium | Reject concurrent pushes | Not built |

---

## 10. Provenance Split

Neither side alone tells the full compliance story:

| Concern | Git (Local) | Platform |
|---------|------------|----------|
| Who changed the model | git log, git blame | `updatedAt` (proposed) |
| Why they changed it | Commit messages | Not captured |
| Who reviewed it | `.dethereal/state.json` sign-off (`model_signed_off`, `reviewedAt`, `reviewHash`), and its git history | Not specified |
| What analysis found | Not stored locally | Analysis nodes + results |
| What exposures exist | Not stored locally | OPA/Rego computed |
| Cross-model context | Not available locally | Graph traversal |

For compliance (SOC2, PCI-DSS), auditors need both: git for "who approved the model" and platform for "what the analysis found."

---

## 11. Resolved Questions

| # | Question | Resolution |
|---|----------|------------|
| 1 | `updatedAt` on Model | Element ID comparison via lightweight `fetchExistingModelStructure` query (no platform change, catches structural changes, sub-1s per push); as a faster option, `updatedAt` + `createdAt` on the Model schema + 3 orchestrator modifications for 10ms checks. See Section 14. **Note (2026-10-12):** What shipped is an export-based check instead: `update_model` fingerprints a platform export per element and field class and compares it with the signed baseline, which also catches attribute changes. See Section 12. The `updatedAt` option is not built. |
| 2 | Scope after pull | (c) Add scope fields to Model graph node. On pull, if model is dirty (snapshot hash differs from last push), require user approval for scope. See Section 15. |
| 3 | `deleteOrphaned` behavior | Do NOT change the default. The skill layer sets `deleteOrphaned` dynamically based on the element-level diff: no platform additions → `true` (safe); platform additions detected → present choice to user. See Section 12. **Note (2026-10-12):** The skill always passes `delete_orphaned: true`. The server refuses before deleting anything the operator has not named (the refusal's `added_on_platform` rows), so the conflict decision is the operator's `push` answer, not a tool parameter. |
| 4 | Clone `representedModel` refs | Preserve by default (they point to the same platform models). `--strip-refs` option to remove them. |
| 5 | `sync.json` gitignored | Yes. Conflict checks run on push/pull/start-modeling operations. If `sync.json` missing but `manifest.model.id` exists, reconstruct baseline from platform export. **Note (2026-10-12):** Nothing reconstructs it. The push goes ahead and is refused with `baseline: missing`, listing every platform element (Section 4). The check runs on update pushes only (`update_model`, `update_attributes`). |

---

## 12. Push Conflict Resolution

### Conflict Taxonomy

The "Detected" column is what the platform-baseline check reports. The baseline is the platform model as of the last pull or push, so only changes made on the platform since then count; the field class it reports is in parentheses.

| ID | Conflict | Cause | Detected | Severity |
|----|----------|-------|:---:|----------|
| C1 | Platform addition | Someone added elements via GUI | Yes (`added_on_platform`) | **Critical** (data loss) |
| C2 | Local deletion | User intentionally removed elements | Not a conflict: not a platform change, so it does not refuse the push | Low (desired) |
| C3 | Platform deletion | Someone removed elements via GUI | Yes (`deleted_on_platform`; the push creates them again) | Low |
| C4 | Attribute divergence | Both sides modified same element's attributes | Yes (`modified`: `attributes`, or `item_attributes` for a data item) | **High** (silent overwrite) |
| C5 | Classification change | Someone reclassified on platform | Yes (`modified`: `properties`) | Medium |
| C6 | Position/layout change | Someone moved elements in GUI | Yes (`modified`: `layout`, listed apart from content changes) | Low (cosmetic) |
| C7 | Topology change | Data flow routing changed on platform | Yes (`modified`: `structure`) | Medium |
| C8 | Computed artifact destruction | Exposures/analyses deleted on push | Follows C1: deleting an element deletes its exposures and analyses | Part of C1's data loss |

Changes to an element's control references (`controls`), data-item links (`data_items`) and asset context (`asset_context`) are detected the same way.

**C8 clarification**: `deleteOrphanedElements()` in `dt-update.ts` deletes the structural elements the local model no longer holds (data items, flows, components, boundaries). Each element delete also deletes that element's exposures and analyses; see Section 13. The check names every platform element the push would delete (C1) before anything is written.

### Push Flow

```
/dethereal:sync push [directory-path]
    |
[Step 0: Pre-checks]  (sync skill)
    Resolve and read the local model files; validate_model_json
    model_state get: stop on unconfirmed enrichment values, unregistered values,
      or an unavailable settlement baseline (settlement on only: with it off,
      get reports none of them)
    validate_model_json gates: stop while Gate 2 fails
    Empty-model guard
    Check manifest.model.id
    +-- No model.id → import_model (first push, nothing to conflict with) → Step 5
    +-- model.id exists → update_model with delete_orphaned: true → Step 1
    |
[Step 1: Platform Export]  (inside update_model, before anything is written)
    Export the platform model; fingerprint it per element and field class
    Load platform_baseline from sync.json: verified / missing / legacy / unverifiable
    |
[Step 2: Element Inventory]
    recorded = baseline fingerprints (none unless verified)
    live     = platform fingerprints
    compared = the field classes update_model writes (all but a data item's attributes)
    |
[Step 3: Diff Computation]
    No verified baseline: every live element → no_baseline
    Else:
      added_on_platform   = live ids not in recorded (the push would delete them)
      deleted_on_platform = recorded ids not in live (the push creates them again)
      modified            = in both, with a compared field class that differs
    |
[Step 4: Decision Point]
    IF no changes:
      → Step 5
    ELSE:
      Refuse with PLATFORM_CHANGED_SINCE_SYNC (nothing written)
      Show the changes (Section 6) → operator chooses:
        push   → update_model again with overwrite_changed = changed_ids,
                 overwrite_revision = revision
                 (platform changed again → refused with acknowledgement: "stale";
                  more than 5,000 changes → only pull or cancel)
        pull   → route to sync pull (with backup)
        cancel → stop
    |
[Step 5: Execute Push]
    Backup the directory (create_backup, on by default)
    update_model or import_model: control-reference linking (strict),
      the derived module list, the write (see below)
    |
[Step 6: Post-Push]
    Re-export: write the platform ids back to the local files
    Re-key .dethereal/ sidecars onto the platform ids (see below)
    Update sync.json: last_push_at, push_content_hash, baseline_element_ids,
      and a new signed platform_baseline from the post-push export
    Suggest git commit
    Stale control references → ask: clear ids / keep
    If countermeasures exist → suggest /dethereal:surface after analysis,
      to link controls to exposures
    Control-library push (greenfield and brownfield controls)
```

`update_attributes` runs the same check for the elements it writes, comparing only `attributes` and `item_attributes`, and never lists platform additions (it deletes nothing). A refusal there is handled with the same question. After a successful push it re-signs only the field classes it wrote, for the elements it wrote.

**Step 5 links the control references before it writes anything.** Both `import_model` and `update_model` resolve every `controls[]` entry — the model's own, and every boundary's, component's, data flow's and data item's — against the organisation's control catalog before the first mutation. An entry with an `id` links to that id only. An entry with no id links only to a Control whose name is identical after Unicode NFC normalisation, removal of invisible default-ignorable characters, and trimming; there is no case-insensitive or partial fallback. An entry whose id is a greenfield temporary id (`greenfield-…`) is deferred: the model push does not link, refuse or warn about it, and it never appears in the refusal's errors. The model push goes first; the control library's greenfield push then creates the Control and links the entry, and an entry whose greenfield push failed before its id was rewritten stays deferred until that push runs again. Any other entry that cannot be linked (`control_name_ambiguous`, `control_name_not_found`, `control_id_not_found`, `control_entry_invalid`), or a catalog that cannot be read in full (`control_catalog_unavailable`), refuses the whole push with nothing written; a `duplicate_element_id` validation error has the same outcome. The plugin collects the operator's answer per entry (a candidate, `create`, `remove`, or another Control's exact name), and the changed entries are confirmed as the operator's values before the push runs again — see [Sync and Version Control: Control References](../../user/dethereal/SYNC_AND_VERSION_CONTROL.md#control-references). The rule is strict because a confirmed model must reach the platform as confirmed: a fuzzy link, or an entry dropped with a warning, would put a control assignment on the platform that the operator never chose. This is the plugin push's rule; dt-core's import pipeline keeps its own name matching for other callers (see [IMPORT_EXPORT.md](../dt-core/IMPORT_EXPORT.md)).

**Step 5 pushes the derived module list.** `manifest.json`'s `modules` is derived by the server: the modules it lists, the scope's `activeModules`, and the module of every class the model uses. Both `import_model` and `update_model` gate and send that list, and write it into `manifest.json` only after every refusal has passed and only if the file is unchanged since the push read it, so a refused push leaves the directory as it was. An update push sets the platform model's modules to exactly this list. See [MCP_ARCHITECTURE.md §Manifest Modules](MCP_ARCHITECTURE.md#manifest-modules).

**Step 5 rewrites local files, and two invariants govern that rewrite.**

*Element IDs are re-keyed everywhere they appear on disk.* A push mints platform IDs for elements that only existed locally, and the re-export writes the model files with them. Two sidecars under `.dethereal/` are keyed by element ID and must follow, or they orphan silently: `template-fields/<element-id>.json` (reclassification cleanup looks the manifest up by the element's *current* ID, so an orphaned set always misses) and `state.json`'s `staleElements[]` (the re-enrichment queue, which otherwise holds pre-push IDs that resolve to nothing). This runs on the `update_model` path as well as first create/import — both are ID-remap sites. Unmapped IDs are left alone, every other key in `state.json` is preserved, and the whole re-key is best-effort: these are local optimisations, never model data, so a failure here warns but never reports a successful push as failed.

*An attribute file that cannot be read is preserved, not destroyed.* The push path re-reads `attributes/` to merge local values the platform does not have. A file that fails to parse — or a flat-format file with no structure context to resolve it — is absent from that merge, and the write that follows would then treat it as stale and unlink it, destroying enrichment that was never pushed. Read failures are instead collected and surfaced as push warnings naming the file, the reason, and where to restore it from (the pre-push backup, or version control if none was taken). The same set marks the file protected: **no write path may write over it, rename over it, or unlink it.** Comparison is case-insensitive, because on APFS and NTFS a file protected under one spelling would otherwise be truncated through its case-folded name. The tradeoff is deliberate — over-protection keeps a stale file and says so; under-protection destroys a live one in silence.

**The server registers what the platform held or linked.** Values count as the operator's only once registered, but some values come from the platform rather than from an operator's answer, and the server registers those itself, with nothing for the operator to settle:

- **after a pull**, the values the platform held (a value changed locally afterwards is unregistered as usual);
- **after a push**, a `controls[]` entry named without an id is written back into the model files with the id the push linked, and its registration follows it;
- **after the control library's greenfield push**, registrations that named the temporary id follow the new id.

A push or pull result carries this as `settlement_registration`. A `failed` one registered nothing: the plugin shows it as a warning, and the values stay unregistered for the operator to confirm — nothing is lost.

All of this applies only with the settlement on, which is off by default (see [MCP_ARCHITECTURE.md → Settlement Switch](MCP_ARCHITECTURE.md#settlement-switch)). With it off, a pull and a push register nothing and only keep this machine's files out of git; the push still writes the linked control ids into the model files.

**How the tools do it.** The operator's registrations (the values counted as theirs, which `model_state_settle` records) live in this machine's settlement under `.dethereal/`. `export_model` registers the pulled values for the platform model from the model exactly as it wrote it: scope moved out to `.dethereal/scope.json`, no local values merged in. `import_model` pins, then registers. After the platform ids are written back, it writes the control ids the push linked into each controls list the files still hold exactly as pushed (a list edited since is left as it is), then moves the operator's registration of each pinned list to its pinned form, working from the pushed model, never a re-read of the directory. It pins and registers nothing when the files keep their reference ids (`disable_source_file_update` with ids to map) or when writing the platform ids back failed. Both tools report the outcome as `settlement_registration` (`{ status: 'registered' | 'failed', code?, registered?, … }`), present only when something was registered or the registration failed; `failed` also adds a warning that the values show as unregistered until the operator settles them. This is distinct from `registered`, which says whether the directory is in the project's model registry (`.dethernety/models.json`). `update_model` and `create_threat_model` also register the lists they pin, and report it the same way.

### Class Resolution on Push

Both push paths resolve each element's `classData` on the target platform with one dt-core resolver, `ClassResolver` in [`class-resolver.ts`](../../../packages/dt-core/src/dt-class/class-resolver.ts): by id, then by module id + class name, then by module name + class name (see [Import/Export → Class Resolution](../dt-core/IMPORT_EXPORT.md#class-resolution-3-level-priority)). A class found by name is used under this platform's id, so a model exported from another instance binds even when the class ids differ. The paths differ only in what a miss means:

| Path | Element whose class is not found | Warning |
|------|----------------------------------|---------|
| `import_model` (first push) | Created without a class; its answers are not written | `Could not resolve component class (id=…, name=…, module=…); instance will be created without an IS_INSTANCE_OF edge.` |
| `update_model` (`DtUpdate`) | Its `classData` is dropped from the update data, so its current class binding and answers stay as they are; an element this update creates is created without a class | `Component "Orders DB": Could not resolve component class (…); it keeps its current class binding and answers.` For a new element: `…; it is created without a class, and its answers are not written.` |

- **Resolution runs before the first write.** `DtUpdate.updateModel` resolves on a copy of the update data after it reads the existing model, which tells existing elements from new ones, and before its first write. Dropping `classData` reuses the existing rule that an absent `classData` leaves the binding untouched, so a missing class triggers neither a rebind nor an answer write.
- **Why the element is left alone.** Updates are not atomic: failing over one class would report failure for a push whose other changes are already written. Unbinding the element instead (a `NONE` rebind) would sweep the findings derived from its current class. Keeping the current state and warning is the non-destructive choice.
- **A catalogue outage is not a missing class.** The module catalogue is fetched once per run. If the fetch fails, update skips resolution and uses the ids as written, rather than treating every class as missing and dropping every binding. A wrong id then surfaces as a refused binding (below).
- **The local files keep the chosen class.** `DtUpdate`'s result carries `unresolvedClasses`: for each element whose class was not found, its id in the update data, its name, its kind, and the class reference the data gave. After a successful `update_model` push, the Step 6 re-export rewrites the model files from the platform, then `keepUnresolvedClasses` in [`unresolved-classes.ts`](../../../apps/dethereal/src/utils/unresolved-classes.ts) puts each listed element's local state back over the export: its `classData` in `structure.json`, `dataflows.json` or `data-items.json`, and its local attribute entry. An element with no local attribute entry gets none, so the platform's answers for another class are not written under the class the user chose. An element this push created is found through the id mapping (reference id to platform id). Every other element is rewritten from the platform as before. The files therefore keep the user's class until the platform has it, and every later push warns again. (`import_model` only writes the new ids back, so the local class reference stays there too.)
- **The baseline records the platform's class.** The signed `platform_baseline` written after the push is fingerprinted from the export before `keepUnresolvedClasses` runs, so it holds what the platform has: the element's current class, or none. The class kept in the files is a local change, not a platform change, so it never refuses a push; the next push sends it again and warns again.

**Errors that remain name the element and the platform's reason.**

| Failure | Error message |
|---------|---------------|
| The platform refuses a class binding (`changeElementBinding` returns `success: false`) | `Could not bind "API" to class <id> (<errorCode>): <errorMessage>` (`to no class` for a `NONE` rebind). The element's answers are then not written against that class. |
| The platform refuses an answer write | `Failed to set the answers of "API" for class <id>: <reason>` |
| A data item's binding is refused | `Data item "Password" update failed (binding: <errorCode>: <errorMessage>)` |

The attributes-only update path (`DtUpdateSplit` writing only the attribute files) does not resolve classes: it writes against the class id in each attribute file and still fails per element, with the same `Failed to set the answers of …` message. `update_model` reports a failed update as `Update failed: ` followed by the errors joined with `; `, and prefixes an error with `<element name>: ` when the message does not already quote the element's name. A failed update keeps the platform baseline from before the push, so the next push lists any part of it that reached the platform as platform changes.

### First Push After Pull

A softer warning for the first push after a pull was designed, for platform-only elements that were probably deleted locally on purpose. It is not needed: the pull records the platform baseline, so elements deleted locally after a pull are not platform changes (C2) and the push deletes them on the platform without a refusal. A refusal after a pull lists only what changed on the platform since that pull.

### Accepted Tradeoffs

- **No attribute-level merge (C4).** A platform attribute change refuses the push and is shown per element and field class; it is overwritten with the local values only when the operator answers `push`, naming exactly those changes. Attribute-level merge requires significant UX design and is not built.
- **Binary choice only.** User chooses "push" (overwrite every listed platform change, deleting platform additions) or "pull" (get platform version). No per-element selectivity.
- **No merge option.** There is no merge logic. The honest alternative is: pull, use `git diff` to review, integrate manually, push.
- **Check, then write.** The check and the write are separate steps. A platform change that lands after the check's export and before the write is not detected. Server-side optimistic concurrency (Section 9; not built) would close this window.

---

## 13. Analysis Artifact Safety

A push deletes the platform elements the local model no longer holds: `delete_orphaned` is always `true`, and the platform-baseline check has named every platform-only element to the operator first (C1). The `deleteOrphanedElements()` method (`dt-update.ts`) deletes, in this order:
- Data items
- Data flows
- Components
- Boundaries

Each of these deletes also deletes the element's computed artifacts: dt-core's delete mutations for a data item, data flow, component and boundary first delete the element's exposures (`HAS_EXPOSURE`) and analyses (`ANALYZED_BY`). Deleting a component also deletes the data flows that start or end at it.

**Artifacts of elements the push deletes are deleted with them; the rest survive.** The orphan deletion does not touch the analyses of elements the push keeps, the model's own analyses, Control nodes (an element's `SUPPORTS` edges go with the element, the Control stays), or the countermeasures a Control provides (`HAS_COUNTERMEASURE`).

Exposures of kept elements follow their attributes, not the orphan deletion. The push writes each element's attributes through `setInstantiationAttributes`, which re-evaluates the class's policies: the exposures they produce are upserted, and the policy-generated exposures they no longer produce are deleted. Hand-authored exposures (`createdBy: USER`) are kept.

---

## 14. Platform Dirtiness Tracking

### The Problem

Detecting "has the platform model changed since last push?" requires tracking all mutations to any model-related node. The current GraphQL schema has **zero timestamps** on Model, Component, SecurityBoundary, DataFlow, or Data types. Only `AnalysisStatus` and `Issue` have `createdAt`/`updatedAt`.

### Mutation Channels

| Channel | Examples | Controllability |
|---------|----------|:---:|
| 1. Neo4j GraphQL auto-generated mutations | `createComponents`, `updateSecurityBoundaries` via dt-core classes, flowStore | HIGH |
| 2. `@cypher` mutations in schema | Issue linking (e.g. `addElementsToIssue`). Note: `deleteModel` is no longer in this channel — it is now an application-code resolver (`ModelResolverService.deleteModel`), so it runs through application logic rather than a `@cypher` directive. | MEDIUM |
| 3. `setInstantiationAttributes` service | OPA/Rego evaluation writes: attribute sets, exposure upserts, countermeasure upserts via direct Cypher | MEDIUM |
| 4. DTModule raw driver access | `DbOps` is read-only today, but raw driver exposed to modules | LOW |
| 5. Import/Update pipeline | `DtUpdate`, `DtImport` bulk writes via dt-core classes | HIGH |

### Shipped: Snapshot Comparison (No Platform Changes)

Before an update push writes anything, `update_model` exports the platform model, fingerprints it per element and per field class, and compares it with the signed `platform_baseline` recorded at the last pull or push (Sections 4 and 12). Both sides are fingerprints of a platform export, so every mutation channel shows up, attribute changes (C4) included. Only the field classes the push writes are compared.

| Property | Value |
|----------|-------|
| Platform changes required | None |
| Correctness | Catches every mutation channel, within the field classes the push writes; a change between the check and the write is missed (Section 12, accepted tradeoffs) |
| Performance | One full platform export before the push; the post-push export, which also writes the platform ids back, re-records the baseline |
| Answers "what changed" | Yes, per element and field class (`added_on_platform`, `modified` with its fields, `deleted_on_platform`) |
| Layout sensitivity | Excluded from the local content hash; compared by the platform check as its own field class (`layout`) and listed apart from content changes |

The `SplitModel` manifest already has a `checksum` field. The content hash excludes diagram layout (and churny export metadata) so GUI layout changes don't trigger false-positive warnings — see Section 4 for its full coverage (attributes, scope, and the `sha256:v2:` versioning).

### Not Built: Application-Level `updatedAt`

This design is not built. It adds `updatedAt: String` and `createdAt: String` to the `Model` type in `schema.graphql`, with three orchestrator modifications:

1. **GraphQL interceptor**: NestJS interceptor detects mutations on model-related types, updates parent Model's `updatedAt` via graph traversal
2. **`setInstantiationAttributes` service**: Post-operation hook traverses to parent Model and sets `updatedAt`
3. **Import/Update pipeline**: `DtUpdate` sets `Model.updatedAt` at operation end (already has `modelId`)

**Known gap (~5%)**: Channel 2 (`@cypher` mutations) and Channel 4 (arbitrary module Cypher) bypass application code. Note that `deleteModel` is **not** part of this gap any more — it is now an application-code resolver (`ModelResolverService.deleteModel`) running an atomic transaction, so it goes through application logic and can stamp `Model.updatedAt` like any other orchestrated write. The remaining Channel-2 surface is the residual schema `@cypher` writes (e.g. issue linking). Current modules are read-only via `DbOps`. Under this design, a module that writes directly would also have to update `Model.updatedAt`, as part of the DTModule interface contract.

**Compatibility**: the plugin would check whether `updatedAt` is available on the Model node, use the fast check (10ms) if so, and fall back to snapshot comparison otherwise, so older platform versions keep working.

---

## 15. Scope on Platform Models

Model scope round-trips through five **flat** fields on the `Model` graph node. (A `ModelScope` sub-object was considered and rejected: the fields must exist flat for the write path anyway, so a wrapper would have been a duplicate read surface for no gain.) All are **nullable** so legacy models read cleanly.

**Scope fields on the `Model` type:**

```graphql
type Model {
  # ... existing fields ...
  depth: ModelingDepth            # ARCHITECTURE | DESIGN | IMPLEMENTATION
  modelingIntent: ModelingIntent  # INITIAL | SECURITY_REVIEW | COMPLIANCE | INCIDENT_RESPONSE
  complianceDrivers: [String!]
  exclusions: [String!]
  trustAssumptions: [String!]
}
```

`ModelingDepth` / `ModelingIntent` are GraphQL enums; on disk in `.dethereal/scope.json` they are the lowercase snake_case forms (`depth`, `modeling_intent`, `compliance_drivers`, `exclusions`, `trust_assumptions`). The enum/case transform is centralised in dt-core.

The companion per-element asset-context fields landed alongside scope: `Component.crownJewel: Boolean`, `Data.sensitivity: SensitivityLevel`, and `Data.regulatoryFlags: [String!]` (see [DT_MODULE_INTERFACE.md → Asset-context fields exposed to modules](../modules/DT_MODULE_INTERFACE.md#asset-context-fields-exposed-to-modules)). Crown jewels are tracked **per component** — there is no crown-jewels list on the `Model` node; the skill's local `crown_jewels` name list stays a local-only key inside `scope.json`. On disk these per-element fields are first-class: `crownJewel` on the component in `structure.json`, and `sensitivity` / `regulatory_flags` on each data item in `data-items.json` (not in the attribute bags).

Two more per-data fields joined them later: `Data.origin: DataOrigin` (who can write the content) and `Data.isCredential: Boolean` (the data is a credential). On disk they are `origin` (lowercase token, e.g. `arbitrary_public` ↔ `ARBITRARY_PUBLIC`) and `is_credential` on each data item in `data-items.json`, beside `sensitivity` and `regulatory_flags`; their meanings are in the [canonical data-origin and credential vocabulary](../../user/dethereal/MODEL_CONCEPTS.md#origin). They sync like `sensitivity`:

- **On push** (full sync, REPLACE): a field the file omits is cleared on the platform; `is_credential: false` is an answer and is published as `false`. An unknown `origin` token is never sent as an invalid enum: it is dropped with a warning, which on an existing item clears the field.
- **On pull**: `origin` is written as the lowercase token, `is_credential` is written including `false`, and an unset (`null`) value is omitted from the file.

**On push**: write the scope fields from `scope.json` to the Model node, with REPLACE semantics — a value cleared locally is cleared on the platform, but a push that carries no scope at all leaves the platform untouched.

**On pull**: read the scope fields from the Model node and write them to `.dethereal/scope.json`, merge-preserving any skill-owned local-only keys.

**Drift surfacing**: `.dethereal/scope.json` is part of the content hash (Section 4), so a scope change — local or pulled — is surfaced as a local-change warning by the sync skill before a pull would overwrite it.

**Legacy models**: a Model node with no scope fields reads `null` for each; `scope.json` simply carries no synced keys. No backfill.
