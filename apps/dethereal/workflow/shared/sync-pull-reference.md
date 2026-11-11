## Sync Pull Reference

The pull imports a platform model into local files for local enrichment. The questions are asked by the skill that read this file.

### What the export writes

{{tool:export_model}} writes `manifest.json`, `structure.json`, `dataflows.json`, `data-items.json`, `attributes/`, `.dethereal/scope.json`, and `.dethereal/sync.json`. Model scope is materialised into `.dethereal/scope.json` (merge-preserving any local-only keys such as `crown_jewels` / `adversary_classes` / `activeModules`); component `crownJewel` is written first-class into `structure.json`; per-data `sensitivity` / `regulatoryFlags` / `origin` / `isCredential` are written first-class into `data-items.json` (`origin` lowercased, `is_credential` written including `false`; an unset value is omitted).

With `if_exists: 'backup'` it takes a timestamped snapshot of an existing directory before writing, so a crashed or incomplete pull is recovered by restoring `<dir>.backup-<timestamp>/` over the model directory. These backups are full-tree copies and are not garbage-collected, so prune stale `*.backup-*` siblings periodically.

### The control library files

{{tool:export_model}} writes `structure.json`, `dataflows.json` and `data-items.json` with `controls[]` references but does NOT write the per-control files at `controls/<id>.json`. Without this step, the local view shows Control references that have no local backing file — {{cmd:enrich}} `--focus controls` would re-pull each one individually, and the `controls/` directory drifts silently from `structure.json` between pulls.

**Discover the Control id set** by walking the freshly-pulled structure + dataflows + data-items:

```
controlIds = new Set()
for each component / boundary / flow / data item in structure.json + dataflows.json + data-items.json:
  for each ref in element.controls[] (if any):
    if ref.id is a string matching ^[A-Za-z0-9_-]+$: controlIds.add(ref.id)
    else: count it as a reference without a usable id
```

The set holds each id once. One id that does not match fails the whole batched call, so a reference without a usable id (null, absent, or another shape) is never sent: count those, and name them in the summary (the control and the element that references it). If no Control is referenced, skip this step; so too when no usable id is left. Otherwise `pull-controls` with those ids:

- Refreshes (or creates) `controls/<id>.json` for each id with the platform's current state.
- Preserves any in-flight `pendingEdit` block on existing files (caller's local edits are not silently overwritten).
- Reconciles tombstoned ids by flipping `lifecycle: 'tombstoned'` rather than deleting the file.

The rule is: a sync pull returns a self-consistent model directory — no follow-up `pull-controls` required. {{cmd:enrich}} `--focus controls` still calls `pull-controls` for newly-discovered Control references during enrichment, but a fresh pull no longer leaves `controls/` empty against a populated `structure.json`.

### The state after a pull

{{tool:model_state}} `action: 'merge_pulled'` reconciles the workflow state with the pulled content:

- A model with no workflow state gets the state the content supports: no components → INITIALIZED; no data flows → SCOPE_DEFINED; no classification and no attribute files → STRUCTURE_COMPLETE; otherwise ENRICHING. **DISCOVERED is skipped** — discovery is a plugin concept; platform models were not "discovered". **REVIEWED is never inferred** — review is a human attestation, must be explicit.
- A model that already has a state keeps it; the tool's `note` says when the pulled content supports a later or an earlier state. It keeps the rest of the state (the drift baseline, the sign-off, the elements awaiting re-enrichment).

### The registry entry

{{tool:export_model}} registers the pulled directory in `.dethernety/models.json` at the project root itself: an existing entry for the same directory is updated, never duplicated, and a new one records the name, the path, when it was added and `source: pull`. The file is created when absent and every other entry is kept. Nothing in the workflow writes the registry by hand.

### Referenced models

Components or boundaries in `structure.json` with `representedModel` represent entire sub-models on the platform:

```
This model references <N> other models:
  "<Model A>" (<id>) -- not available locally
  "<Model B>" (<id>) -- available at ./threat-models/model-b/

Referenced models are not pulled automatically.
Use {{cmd:sync}} pull to import them individually.
```

### The summary

```
Pulled "<model-name>" from platform.

  Written to: <directory-path>/

  manifest.json        Model metadata
  structure.json       <N> boundaries, <M> components
  dataflows.json       <K> data flows
  data-items.json      <J> data items
  attributes/          <A> attribute files
  .dethereal/scope.json  Model scope (synced keys merged; local-only keys preserved)
  controls/            <C> control file(s) refreshed

  Quality: <score>/100 (<label>)
  State:   <STATE> <how the state tool reported it>
  Backup:  <backup_path, or none>

  This is now your working copy.
  Edit locally, then {{cmd:sync}} push to send changes back.
```

**Callout when any control file had a `pendingEdit` block preserved.** The operator needs to see this because the pull deliberately did NOT overwrite their in-flight local edits:
```
  Preserved in-flight edits on <P> control file(s) — your uncommitted pendingEdit
  blocks were kept; only platformAttributes was refreshed. Next push will compute
  conflict detection against the freshly-pulled platform state.
```

**Callout when structure/dataflows/data-items referenced a Control id that the platform no longer returns** (tombstoned server-side between the export and the `pull-controls` call — a known race):
```
  Note: <Q> Control reference(s) in structure/dataflows/data-items had no matching entry
  in the platform response — likely tombstoned server-side after the structure
  pull. These ids have no local controls/<id>.json. Re-run {{cmd:sync}} pull once
  tombstone state has propagated if unexpected.
```

{{include shared/per-machine-files.md}}

Post-action footer:
```
[done] Pulled "<model-name>" (<STATE>, <score>/100 quality). <N> boundaries, <M> components, <K> flows.
[next] When you're ready: {{cmd:enrich}} (fill enrichment gaps) or {{cmd:review}} (assess quality)
```
