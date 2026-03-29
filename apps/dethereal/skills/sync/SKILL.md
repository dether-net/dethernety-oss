---
name: sync
description: Push local model to platform, pull platform model to local, or check sync status
argument-hint: "push|pull|status [directory-path]"
---

Synchronize a Dethernety threat model between local files and the platform. Push publishes your local model for analysis; pull imports a platform model for local enrichment.

**Dual-authority model:** Local filesystem (git-versioned) is authoritative for model structure (components, boundaries, flows, attributes). The platform is authoritative for computed artifacts (exposures, analysis results, countermeasures). Push is a publish operation, not a bidirectional sync.

## Parse Arguments

Route `$ARGUMENTS` to the correct subcommand:

- `push [directory-path]` → **Push flow** (publish local model to platform)
- `pull [model-id-or-name]` → **Pull flow** (import platform model to local)
- `status [directory-path]` → **Status display** (sync state summary)
- No arguments or unrecognized → show usage hint:
  ```
  Usage: /dethereal:sync <push|pull|status> [options]
    push [directory-path]     Publish local model to platform
    pull [model-id-or-name]   Import platform model to local files
    status [directory-path]   Show sync state and local changes
  ```

For push and status: resolve the model directory using the Model Resolution Protocol. For pull: resolve the target model from the platform.

---

## Push Flow

### P0. Auth Check

Read the token store at `~/.dethernety/tokens.json`. Find the entry keyed by the platform URL (`DETHERNETY_URL` environment variable, default `http://localhost:3003`).

- If tokens exist and not expired: proceed
- If tokens expired or missing: "Not authenticated. Run `/dethereal:login` first." Stop.

### P1. Resolve and Validate

1. **Resolve model path** using the Model Resolution Protocol
2. If no model exists, suggest `/dethereal:create` first and stop
3. Read model files from disk: `manifest.json`, `structure.json`, `dataflows.json`, `data-items.json`
4. Call `mcp__dethereal__validate_model_json` to check structural validity
5. If validation fails, show errors and stop — do not push a broken model
6. **Empty model guard**: If the model has 0 components and 0 boundaries (beyond the default boundary), warn: "Model has no components. Push will create/update an empty model on the platform. Continue?" If the user declines, stop.

### P2. Check Push Routing

Read `manifest.json` and check the `model.id` field:

- **If `model.id` is set** (model was previously pushed or pulled): this is an update to an existing platform model. Proceed to P3.
- **If `model.id` is null or missing**: this is a first push (new platform model). Skip conflict detection — no conflicts are possible. Jump to P5 (import path).

### P3. Reconstruct sync.json if Missing

Read `.dethereal/sync.json` from the model directory.

If `sync.json` **does not exist** but `manifest.model.id` is set (model was synced before but sync metadata was lost — e.g., gitignored file not present after clone):

1. Call `mcp__dethereal__export_model` with `model_id` from manifest to a temporary directory
2. Read the exported `structure.json`, `dataflows.json`, and `data-items.json` to collect platform element IDs (boundaries, components, flows, data items)
3. Write `.dethereal/sync.json` with `platform_model_id` and `baseline_element_ids` from the exported files
4. Show: "Reconstructed sync baseline from platform state. Previous sync history is unavailable."
5. Clean up the temporary export directory

### P4. Pre-Push Conflict Detection

Detect whether the platform has elements not present locally (C1 — platform additions that would be deleted on push).

**Step 1 — Get platform element IDs:**
Call `mcp__dethereal__export_model` with `model_id` to a temporary directory (or reuse the P3 export if it was just performed). Read the exported files to collect platform element IDs **and element names** by type (boundaries, components, flows, dataItems). Retain the names so the conflict UX (P4a) can display human-readable labels, not UUIDs.

**Step 2 — Collect element inventories:**
- `local_ids` — IDs from local `structure.json`, `dataflows.json`, `data-items.json`
- `platform_ids` — IDs from the temporary platform export
- `baseline_ids` — IDs from `sync.json.baseline_element_ids` (if available)

**Step 3 — Compute diff:**
```
platform_additions = platform_ids - local_ids

If baseline_ids available:
  user_deletions    = baseline_ids - local_ids
  true_platform_additions = platform_additions - baseline_ids
Else:
  user_deletions    = {} (empty)
  true_platform_additions = platform_additions
```

**Step 4 — Decision:**
- If `true_platform_additions` is **empty**: no conflicts. Proceed to P5.
- If `true_platform_additions` is **non-empty**: show Conflict UX (P4a).

Clean up the temporary export directory after computing the diff.

### P4a. Conflict UX

**Standard conflict warning:**
```
WARNING: Platform has elements not in your local model.
These will be DELETED from the platform on push.

Elements on platform but not local (will be deleted):
  Boundaries: <list names, if any>
  Components: <list names, if any>
  Flows:      <list names, if any>
  Data Items: <list names, if any>

Your local changes (will be applied):
  <N> components modified, <M> data flows added

Note: Push updates all attributes to match local values. Attribute changes
made on the platform since your last sync will be overwritten (C4 — V1 tradeoff).

Options:
  push   -- Push local model. <K> platform elements DELETED.
  pull   -- Pull platform version first, then review differences.
  cancel -- Do nothing.

Choice (push / pull / cancel):
```

List all four element types in the deletion warning. Omit types with no deletions. Boundaries are especially important — deleting a boundary has cascading structural consequences.

**Special case — first push after pull** (when `sync.last_pull_at` is set but `sync.last_push_at` is null): use softer wording:
```
You pulled this model from the platform and have since modified it.
The following elements exist on the platform but not locally.
If you removed them intentionally, "push" is correct.

  Boundaries: <list names, if any>
  Components: <list names, if any>
  Flows:      <list names, if any>
  Data Items: <list names, if any>

Options:
  push   -- Push your local version (platform-only elements removed)
  pull   -- Get platform version first (your local changes backed up)
  cancel -- Do nothing

Choice (push / pull / cancel):
```

If user chooses **push**: proceed to P5 (update path).
If user chooses **pull**: route to the Pull flow with `backup` behavior.
If user chooses **cancel**: stop.

### P5. Execute Push

**First push** (no `manifest.model.id`):
- Call `mcp__dethereal__import_model` with `directory_path`
- The tool handles: ID mapping (writes server UUIDs back to local files), sync.json creation

**Update** (has `manifest.model.id`):
- Call `mcp__dethereal__update_model` with `directory_path` and `delete_orphaned: true`
- The tool handles: structural diff, applying changes, sync.json update
- `delete_orphaned` is always `true` because at this point the user has either confirmed deletion of platform additions (P4a → push), or no platform additions exist (P4 → no conflicts). The conflict resolution decision happens at the skill level (push/pull/cancel), not at the tool parameter level.

### P6. Post-Push

1. Read the updated model files (server IDs now written to local files)
2. Display push summary:
   ```
   Pushed "<model-name>" to platform.
     <N> boundaries, <M> components, <K> flows, <J> data items.
     Platform model ID: <id>

   Server IDs written to local files.
   Commit these changes to preserve sync state.
   ```
3. If countermeasures exist in the model: "Run `/dethereal:surface` after analysis to link controls to exposures."
4. Post-action footer:
   ```
   [done] Push complete. Quality: X/100.
   [next] Commit changes to git, then /dethereal:review (assess quality)
   ```

---

## Pull Flow

### L1. Auth Check

Read the token store at `~/.dethernety/tokens.json`. Find the entry keyed by the platform URL (`DETHERNETY_URL` environment variable, default `http://localhost:3003`).

- If tokens exist and not expired: proceed
- If tokens expired or missing: "Not authenticated. Run `/dethereal:login` first." Stop.

### L2. Model Selection

If `$ARGUMENTS` contains a model ID or name, use it directly. Otherwise, present a selection table:

1. Call `mcp__dethereal__list_models`
2. If no models are returned: "No models found on the platform. Create a model locally with `/dethereal:create`, then push with `/dethereal:sync push`." Stop.
3. Display:
   ```
   Connected to <platform-url> (<N> models available)

     #  Name                   Description
     1  Production Stack       Main production environment
     2  Staging Environment    Staging services
     3  Payment Service (v2)   Payment processing subsystem

   Which model? (number or model ID):
   ```
4. Wait for user selection

### L3. Check for Existing Local Model

Determine the target directory:
- If `directory-path` argument provided: use it
- Otherwise: `./threat-models/<kebab-case-model-name>/`

If the target directory already exists:
1. Read `manifest.json` to confirm it's a model directory
2. Read `.dethereal/sync.json` for stored content hashes
3. Read the model files and compute a content hash: SHA-256 of `manifest.json`, `structure.json`, `dataflows.json`, `data-items.json`, sorted by filename, excluding layout properties (`positionX`, `positionY`, `dimensionsWidth`, `dimensionsHeight`). Per SYNC_AND_SOURCE_OF_TRUTH.md §4.
4. Compare the computed hash against `pull_content_hash` or `push_content_hash` from sync.json (whichever is more recent based on `last_pull_at` vs `last_push_at`)
5. If hashes **match**: no local changes. Proceed to L4.
6. If hashes **differ** (or no sync.json exists): show warning:
   ```
   Local model "<name>" has changes since last pull/push.
   Pulling will OVERWRITE these local changes.

   Options:
     "push first"  -- Push your changes, then pull
     "backup"      -- Save current files to <path>.backup/ before pulling
     "overwrite"   -- Discard local changes and pull
     "cancel"      -- Keep local files unchanged
   ```
   - **push first**: route to Push flow, then return to Pull flow after push completes
   - **backup**: note the backup path, proceed to L4
   - **overwrite**: proceed to L4
   - **cancel**: stop

### L4. Execute Export

Call `mcp__dethereal__export_model` with:
- `model_id`: the selected platform model ID
- `directory_path`: the target directory

The tool writes: `manifest.json`, `structure.json`, `dataflows.json`, `data-items.json`, `attributes/`, and `.dethereal/sync.json`.

### L5. State Inference

Read the exported model files and infer workflow state. Platform models have no `.dethereal/state.json`, so state must be inferred from content:

```
1. Count components in structure.json (recursively through boundaries)

2. If components == 0:
     state = INITIALIZED

3. Else if dataflows.json is empty or has 0 flows:
     state = SCOPE_DEFINED

4. Else:
     Check for enrichment signals:
     - classifiedCount = components with classData set (non-null classData in structure.json)
     - attributeCount  = number of files in attributes/ directory

     If classifiedCount == 0 AND attributeCount == 0:
       state = STRUCTURE_COMPLETE
     Else:
       state = ENRICHING
```

**Key rules:**
- **DISCOVERED is skipped** — discovery is a plugin concept; platform models were not "discovered"
- **REVIEWED is never inferred** — review is a human attestation, must be explicit

Write `.dethereal/state.json`:
```json
{
  "currentState": "<inferred-state>",
  "completedStates": [<all states up to inferred state, excluding DISCOVERED>],
  "lastModified": "<ISO 8601 timestamp>",
  "inferredFromContent": true,
  "staleElements": []
}
```

The `completedStates` array should include all states up to and including the current state (excluding DISCOVERED, which was not performed):

| Inferred State | completedStates |
|----------------|-----------------|
| INITIALIZED | `["INITIALIZED"]` |
| SCOPE_DEFINED | `["INITIALIZED", "SCOPE_DEFINED"]` |
| STRUCTURE_COMPLETE | `["INITIALIZED", "SCOPE_DEFINED", "STRUCTURE_COMPLETE"]` |
| ENRICHING | `["INITIALIZED", "SCOPE_DEFINED", "STRUCTURE_COMPLETE"]` |

### L6. Quality Computation

Call `mcp__dethereal__validate_model_json` with `action: 'quality'` and the model directory path.

Write the quality result to `.dethereal/quality.json`.

### L7. Register in models.json

Read `.dethernety/models.json` from the project root (create the file and `.dethernety/` directory if they don't exist).

Add or update an entry for this model:
```json
{
  "name": "<model-name>",
  "path": "<relative-path-from-project-root>",
  "createdAt": "<ISO 8601 timestamp>",
  "source": "pull"
}
```

If a model with the same path is already registered, update its entry rather than adding a duplicate.

### L8. Referenced Models

Check `structure.json` for components or boundaries with `representedModel` references (components that represent entire sub-models on the platform).

If references are found:
1. Collect referenced model IDs and names
2. Read `.dethernety/models.json` to check which referenced models are available locally
3. Update `sync.json.referenced_models` with the reference list
4. Display reference summary:
   ```
   This model references <N> other models:
     "<Model A>" (<id>) -- not available locally
     "<Model B>" (<id>) -- available at ./threat-models/model-b/

   Referenced models are not pulled automatically.
   Use /dethereal:sync pull to import them individually.
   ```

If no references are found, skip this step.

### L9. Post-Pull Summary

Display the pull output:
```
Pulled "<model-name>" from platform.

  Written to: <directory-path>/

  manifest.json        Model metadata
  structure.json       <N> boundaries, <M> components
  dataflows.json       <K> data flows
  data-items.json      <J> data items
  attributes/          <A> attribute files

  Quality: <score>/100 (<label>)
  State:   <STATE> (inferred from content)

  This is now your working copy.
  Edit locally, then /dethereal:sync push to send changes back.
```

**Scope absence note** (show once per pull):
```
Note: Platform models do not include scope metadata (.dethereal/scope.json).
For full workflow support (enrichment prioritization, compliance-driven prompts),
create scope.json manually or run /dethereal:create with scope definition.
```

Post-action footer:
```
[done] Pulled "<model-name>" (<STATE>, <score>/100 quality). <N> boundaries, <M> components, <K> flows.
[next] /dethereal:enrich (fill enrichment gaps) or /dethereal:review (assess quality)
```

---

## Status Display

### S1. Resolve Model

Use the Model Resolution Protocol to find the target model. Read:
- `manifest.json` — model name and platform model ID
- `.dethereal/sync.json` — sync timestamps, content hashes, referenced models
- `.dethereal/state.json` — current workflow state
- `.dethereal/quality.json` — quality score

### S2. Compute Local Change Status

If `sync.json` exists:
1. Read model files and compute a content hash (read `manifest.json`, `structure.json`, `dataflows.json`, `data-items.json` — hash content excluding layout properties)
2. Determine which hash to compare against:
   - If `last_push_at` is more recent than `last_pull_at`: compare against `push_content_hash`
   - Otherwise: compare against `pull_content_hash`
3. If hashes match: "No local changes"
4. If hashes differ: "Local changes not pushed"

If `sync.json` does not exist: "Never synced"

### S3. Display Status

Also read auth status from `~/.dethernety/tokens.json` (same as L1).

```
Sync Status: <directory-path>/
──────────────────────────────────────────────
  Model:     "<model-name>"
  Quality:   <score>/100 (<label>)
  State:     <STATE>

  Platform:
    Model ID:   <id or "not pushed">
    URL:        <platform-url>
    Auth:       <user-email> (<N> min remaining) | token expired | not authenticated

  Sync:
    Last push:  <relative-time or "never">
    Last pull:  <relative-time or "never">
    Local:      <"No local changes" | "Local changes not pushed" | "Never synced">

  Referenced Models:
    "<Model A>" (<id>) -- not available locally
    "<Model B>" (<id>) -- ./threat-models/model-b/

For system-wide status, run /dethereal:status.
```

If no `sync.json` and no `manifest.model.id`:
```
  Sync:       Never synced. Run /dethereal:sync push to publish.
```

If referenced models list is empty, omit that section.

---

## Gitignore Guidance

When displaying sync results (after push, pull, or status), remind the user if `.dethereal/sync.json` is not gitignored:

```
Reminder: sync.json is per-user state and should be gitignored.
Add to your .gitignore:
  .dethereal/sync.json
```

Two developers pulling the same model will have independent sync state. If `sync.json` is missing but `manifest.model.id` exists, the sync skill reconstructs the baseline from the platform on next push (Step P3).

