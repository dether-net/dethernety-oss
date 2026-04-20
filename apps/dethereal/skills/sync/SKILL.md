---
name: sync
description: Push local model to platform, pull platform model to local, or check sync status
argument-hint: "push|pull|status|promote-external-edit|tombstone|repair-wal [directory-path]"
---

Synchronize a Dethernety threat model between local files and the platform. Push publishes your local model for analysis; pull imports a platform model for local enrichment.

**Dual-authority model:** Local filesystem (git-versioned) is authoritative for model structure (components, boundaries, flows, attributes). The platform is authoritative for computed artifacts (exposures, analysis results, countermeasures). Push is a publish operation, not a bidirectional sync.

## Parse Arguments

Route `$ARGUMENTS` to the correct subcommand:

- `push [directory-path]` → **Push flow** (publish local model to platform)
- `pull [model-id-or-name]` → **Pull flow** (import platform model to local)
- `status [directory-path]` → **Status display** (sync state summary)
- `promote-external-edit <controlId> <classId>` → **Recovery verb** (unblocks the Step A external-edit guard after someone else changed the Control on the platform between your pull and push; see §Promote External Edit below)
- `tombstone <controlId>` → **Recovery verb** (Sprint 4 F-10) — flip a control's lifecycle to `tombstoned` locally so future pulls don't resurrect it; useful for retiring a Control without waiting for platform-deletion-detected reconciliation. See §Tombstone Recovery Verb below.
- `repair-wal` → **Recovery verb** (Sprint 5 F-20) — surface the stranded WAL journal contents and walk the operator through the three available recovery actions (delete journal, retry replay, or manually rename). Use when any push/pull/status action returns `WAL_REPLAY_FAILED`. See §Repair WAL Recovery Verb below.
- No arguments or unrecognized → show usage hint:
  ```
  Usage: /dethereal:sync <push|pull|status|promote-external-edit|tombstone|repair-wal> [options]
    push [directory-path]                        Publish local model to platform
    pull [model-id-or-name]                      Import platform model to local files
    status [directory-path]                      Show sync state and local changes
    promote-external-edit <controlId> <classId>  Promote platform state into local pendingEdit
                                                 (recovery for the Step A external-edit guard)
    tombstone <controlId>                        Mark a control as tombstoned locally
                                                 (decouples from future pulls)
    repair-wal [directory-path]                  Inspect + recover from a stranded WAL journal
                                                 (after WAL_REPLAY_FAILED)
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
3. **Control Resolution Warnings:** Check the `update_model` response for control resolution warnings (emitted by `resolveControls()` during the push).
   If any warnings contain unresolved control references:
   ```
   Control resolution warnings:
     - "WAF Protection" not found on platform. Create it or adjust the name.
     - "Custom Firewall" not found on platform.
   
   Unresolved controls are stored as name-only references.
   Create these controls on the platform, then re-sync to link them.
   ```
   If no control warnings: omit this section.

4. **Control ID Pinning:** After successful push, check local model files for name-only control references (`id: null`).
   If any exist:
   - Call `mcp__dethereal__manage_controls(action: 'list')` to get the platform control inventory
   - For each name-only control reference in `structure.json` and `dataflows.json`, match by name against platform controls
   - If matched: write the resolved platform ID back to the local JSON file:
     `{ id: null, name: "WAF", source: "declared" }` → `{ id: "ctrl-xyz", name: "WAF", source: "declared" }`
   - Write updated files to disk
   - Show: "Pinned N control IDs to local files."

   ID pinning prevents name-match flipping on re-sync — without it, a renamed platform control would silently break the reference.

5. **Stale Reference Detection:** For each control reference with a non-null `id` in local files:
   - Check if that ID exists in the platform controls list (from step 4)
   - If not found, warn:
     ```
     Stale control references:
       - "Old Firewall" (ctrl-abc-123) — no longer exists on platform
     
     Remove from local model? (yes / keep as name-only)
     ```
   If "yes": set `id: null` on the stale reference (preserves the control name for re-matching).
   If "keep": no change. Warning noted for manual review.

6. If countermeasures exist in the model: "Run `/dethereal:surface` after analysis to link controls to exposures."

(The P6 footer is merged into P7's footer below — it covers both the structural push and the control-library push in one summary.)

### P7. Control Library Push (CL §7 Steps 0–F)

> Runs AFTER P5/P6 structural push succeeds. Drives per-Control attribute edits (from the `pendingEdit` blocks populated by `/dethereal:enrich --focus controls`) through the Steps 0–F safety pipeline with full shared-ownership UX.

#### P7.1 — Pre-flight Gather

Enumerate `<modelDir>/controls/<id>.json` files. Sort each into one of three buckets:

1. **Brownfield with pending edits** (the canonical case): `lifecycle === 'brownfield'` AND any `classes[].pendingEdit` populated. Routes through P7.2–P7.6 below.

2. **Greenfield / partially-pushed** (Sprint 4 F-05): `lifecycle === 'greenfield' || lifecycle === 'partially-pushed'`. Routes through the **Greenfield push branch** (P7.G below) — these are locally-authored Controls that need to be created on the platform with WAL-protected id rewrite. Pre-Sprint-4 these were silently skipped, leaving the file-first greenfield workflow unreachable.

3. **External-edit drift** (Sprint 4 F-06): `lifecycle === 'brownfield' || lifecycle === 'partially-pushed'`, AND `attributes != platformAttributes` for any class entry, AND that class entry has NO `pendingEdit` block. Pre-Sprint-4 these were silently skipped — a hand-edited control file would never trigger the Step A external-edit guard because the engine was never invoked. Render as a **pre-flight error** before any P7.2 fetch:
   ```
   External edit detected on control(s):
     - "<name>" [class "<className>"]: attributes diverge from platformAttributes with no pendingEdit.
       Recovery: /dethereal:sync promote-external-edit <controlId> <classId>
   Aborting P7 — re-run after promoting the external edits (the safety guard exists so untracked
   changes cannot silently overwrite the platform).
   ```
   Stop P7 entirely; do not proceed to P7.2 even if other Controls have valid pending edits in the same batch. Forcing the operator to resolve drift before any further pushes mirrors the engine's Step A guard.

If all three buckets are empty, skip P7 entirely — proceed to the footer (P7.6) with control-library counts zeroed. **Do not surface noise** when the common case (no pending edits, no drift, no greenfield files) applies.

#### P7.2 — Batched Fresh-Fetch

Refresh `platformAttributes` and `platformState.assignedModelIds` for the touched controls in a single batched round-trip:

```
mcp__dethereal__manage_controls(
  action: 'pull-controls',
  directory_path: <modelDir>,
  control_ids: [ <touchedId1>, <touchedId2>, ... ]
)
```

`pull-controls` preserves `pendingEdit` when it exists on disk — only `platformAttributes` and `platformState.assignedModelIds` are overwritten. Re-read each touched file from disk; the skill now has the three inputs the engine needs per control:

- `freshPlatformAttrs`: `Map<classId, Record<string, unknown>>` built from each class entry's refreshed `platformAttributes`.
- `liveAssignedModelIds`: the refreshed `platformState.assignedModelIds`.
- `thisModelId`: read from `manifest.json` `model.id`.

If `pull-controls` reconciled one of the ids to `tombstoned` (the control was deleted on the platform between enrich and sync), surface it in the next render and skip the push for that control.

#### P7.3 — Classify Per-Control State

For each touched control, classify its state locally (no extra round-trips) using the refreshed data:

| State | Detection | Action |
|---|---|---|
| `alone` | `assignedModelIds.length === 0` OR `assignedModelIds.length === 1 && assignedModelIds[0] === thisModelId` | Push without prompt (default `decision.sharedOwnership: 'push-anyway'` but no prompt — alone is always safe). |
| `shared` | `assignedModelIds.length > 1` | Prompt for `sharedOwnership` decision. |
| `query-failed` | The `pull-controls` call errored for this id (rare, but handle defensively) | Offer `push-unverified` or `cancel` per-row. |
| `tombstoned` | `lifecycle === 'tombstoned'` after reconciliation | Surface as "Control deleted on platform; skip or re-create locally." No push. |

Within each state, compute per-key conflicts: for each `entry.pendingEdit.previousAttributes` key `k`, check whether `freshPlatformAttrs[classId][k] !== pendingEdit.previousAttributes[k]`. Conflicting keys require a `decision.perKey[<classIdx>.<key>]` resolution (Step D Case 3).

#### P7.4 — Render Operator Prompt

**Case A — 1 control needs decision** — render the CL §6 single-control prompt verbatim:

```
Shared Control: <controlName> (<thisModelName>)
This Control is also assigned to <M> other models (<M+1> total):
  - <modelName2>
  - <modelName3>
  (and <X> more — full list with `show models 1`)

You are about to change these attributes on the IS_INSTANCE_OF edge to ControlClass "<className>":

  <key1>:   <platformValue>  →  <yourValue>   (you proposed)
  <key2>:   <platformValue>  →  <yourValue>   (you proposed)

  No other attributes will be touched (push uses partial payload; see DEC-CL-11).

Affected ControlClass: <className> (<i> of <N> classes on this Control)

Choose:
  cancel        Leave platform attributes unchanged. Local edits stay; prompt fires again next push.
  push-anyway   Apply YOUR changes to all <M+1> models. Audit-log entry written. Server keys you
                did not propose to change are left untouched.
  clone         Create a new Control as a fork of this one and repoint this model only;
                other models keep the original Control unchanged.
```

**Case B — ≥2 controls need decision** — render the batched review screen per CL §6, with the row format and verb table grouped for scannability under panic load (UX-reviewed):

```
Shared-Control review (<P> of <T> controls require approval):

  Prompted (require your decision):
    #1  <controlName>     [shared: <M> models]   [conflict: <key1>, <key2>]
                                                 [intent:   <key3>]
    #2  <controlName>     [shared: <M> models]   [intent:   <key1>, <key2>, <key3>, <key4>]
    #3  <controlName>     [query failed: <reason>]

  Safe-to-push (alone on platform OR only assigned to this model — no other models affected):
    #4  <controlName>
    #5  <controlName>

Verbs (grouped by scope):

  Per-row decisions:
    cancel <n>           leave Control #n unchanged on the platform
    push-anyway <n>      apply YOUR intended changes to Control #n (writes force-shared)
    push-unverified <n>  apply YOUR intended changes despite failed ownership query (force-unverified)
    clone <n>            fork Control #n and repoint this model only
    retry-query <n>      re-run the ownership query for Control #n

  Per-key decisions (use when row has [conflict: ...]):
    keep <n>.<key>             push your intended new value (overwrites server)
    accept-theirs <n>.<key>    drop the key from outbound payload; copy server value local
    merge <n>.<key> = <json>   push the typed value (JSON literal; "string"|true|42|{"k":"v"})
    drop <n>.<key>             remove the key from outbound payload AND from pendingEdit.previousAttributes

  Bulk shortcuts:
    keep-all <n>          apply 'keep' to every conflicting key on Control #n
    accept-theirs-all <n> apply 'accept-theirs' to every conflicting key on Control #n
    clone-all             fork ALL prompted rows (safe-to-push group untouched)
    cancel-all            cancel ALL prompted rows (safe-to-push group will still push)
    cancel-everything     cancel ALL rows including safe-to-push (full abort — nothing pushes)

  Inspection (read-only — does not commit anything):
    show <n>              expand row <n> to the full single-control prompt
    show all              expand every prompted row (warns if >4 prompted)
    show failed           expand only query-failed rows
    show models <n>       list every model that references Control #n

  When ready:
    done                  proceed to push with the decisions made so far
```

**Row format rules:**

- The `[conflict: ...]` segment lists conflicting key names inline when the conflicting-key count is ≤ 3. When > 3, render `[conflict: 4+ keys — show <n> to expand]`. This eliminates the forced `show <n>` round-trip for 80% of cases.
- `[intent: ...]` follows the same rule but applies to non-conflicting intended keys (the keys the operator wants to push that the server agrees on the pre-edit value for).
- Always indent continuation lines by exactly the column width of the row label so the eye can scan vertically.

**`cancel-all` vs `cancel-everything`:**

- `cancel-all` cancels only the *prompted* rows (the ones the operator was being asked about). The safe-to-push group still pushes when the operator types `done`.
- `cancel-everything` aborts the entire P7 step — no pushes at all, including safe-to-push. Use for "kill all control-library writes this session."

The asymmetric default exists so an operator can deal with the prompts without inadvertently blocking the safe-to-push group; the explicit `cancel-everything` is the kill switch.

**Per-key conflict rendering** (Step D Case 3) — when the operator types `show <n>` or for every 3-way conflict the single-control prompt expands inline:

```
  <key> (<type>):
    <yourValue>        →  <yourProposed>         (you proposed)
    <serverValue>                                (server changed since your pull)
    Per-key choice:  keep <n>.<key>
                   | accept-theirs <n>.<key>
                   | merge <n>.<key> = <value>
```

Parse operator input iteratively until `done` is issued. Maintain a `decisions` map keyed by control index; carry forward unresolved conflicts (treat any conflicting key without a per-key decision as `cancel` for the entire control row per CL §6).

**Key-name syntax with dots / hyphens / spaces:** When a key contains a dot (`tls.min_version`), wrap the key in double quotes:
```
keep 3."tls.min_version"
```
Without quoting, the dot is parsed as the row/key separator and `keep 3.tls.min_version` is rejected as ambiguous.

**`show models <n>` sub-verb** renders cached `platformState.assignedModelIds` with the V1 limitation note per CL §6:

```
Models assigned to "<controlName>" (<M> total, cached from last pull):
  - <modelId1>
  - <modelId2>
  ...
  (model freshness/ownership not shown — V1 limitation)
For history of this control's local edits:
  git log --follow controls/<controlId>.json
```

The `--follow` flag matters because `controls/` files get renamed when class IDs change (greenfield → brownfield WAL id rewrite).

**`merge <n>.<key> = <json>` — JSON literal validation with helpful error:**

When `JSON.parse(<json>)` throws, render the parse error verbatim plus the input plus three example forms (covers ~95% of attribute types in the template schema):

```
Invalid JSON literal: <error message from JSON.parse>
Got:   <user input>
Try:   "string"            (string)         |   true / false   (boolean)
       42                  (number)         |   {"k":"v"}      (object)
       ["a","b"]           (string array)
```

Then re-prompt. Without the type hint, operators retype the same broken input (most common: typing `strict` instead of `"strict"`).

**`show all` cost guard:** When prompted-control count > 4, render `show all` as `show all (will print ~<N×~5> lines)` so the operator can prefer `show 1` then iterate.

#### P7.4a — Compact rendering mode (Sprint 5 S5.13)

Under realistic operator load (5+ shared Controls × 3+ conflicting keys each), even the Case B batched render becomes a wall of text — multi-line `[shared:...]`/`[conflict:...]`/`[intent:...]` per row × N rows × per-key conflict expansion. Auto-engage **compact mode** when EITHER threshold is met:

- **≥5 prompted Controls**, OR
- **≥10 total conflicting keys** across all prompted Controls.

(The row threshold is intentionally generous — a 3- or 4-row table reads cleanly verbose; the wall-of-text emerges around 5+. The conflicting-key threshold is the load-bearing axis since per-key prompts dominate vertical space.)

Render rules in compact mode:

- Strip the per-row `[shared: ...]` / `[intent: ...]` segments. Keep only `[!<N> conflicts]` as a badge when N>0; emit nothing for rows with no conflicts.
- For query-failed rows, keep a one-word category tag: `[query failed: timeout]` / `[query failed: forbidden]` / `[query failed: no-data]` (the category drives whether the operator picks `push-unverified` or retries; the verbose reason is reached via `show <n>`).
- Replace the multi-line Verbs block with a one-line hint that includes the display toggle: `Verbs: per-row (cancel|push-anyway|clone|push-unverified <n>) | per-key (keep|accept-theirs|merge|drop <n>.<key>) | bulk (keep-all|accept-theirs-all|cancel-all|cancel-everything <n>?) | inspect (show <n>|show all|show failed|show models <n>) | display (verbose|compact) | done. Use 'show <n>' for full row detail.`
- Always render `show <n>` and `show all` outputs in **verbose mode** (compact is for the at-a-glance summary; the operator reaches for full detail when they need it).

Example compact render under load (6 prompted, 14 conflicting keys):
```
Shared-Control review (6 of 8 controls require approval):

  Prompted:
    #1  TLS minimum version            [!3 conflicts]
    #2  WAF rate-limit                 [!4 conflicts]
    #3  Database encryption-at-rest    [!2 conflicts]
    #4  S3 bucket public-access-block  [!1 conflict]
    #5  Lambda IAM least-privilege     [!4 conflicts]
    #6  CloudFront geo-restriction     [query failed: timeout]

  Safe-to-push:
    #7  ECS task-role permissions
    #8  Secrets Manager rotation

Verbs: per-row (cancel|push-anyway|clone|push-unverified <n>) | per-key (keep|accept-theirs|merge|drop <n>.<key>) | bulk (keep-all|accept-theirs-all|cancel-all|cancel-everything <n>?) | inspect (show <n>|show all|show failed|show models <n>) | display (verbose|compact) | done
Use 'show <n>' for full row detail (per-key conflicts, models list, intent breakdown).
```

The thresholds are V1 defaults pending operator-load telemetry. They can be revisited in a Sprint 6 iteration without code changes (skill prose only). Operator override: typing `verbose` once flips back to Case B rendering for the rest of the session; `compact` flips back. The toggle is also surfaced in the Verbs hint above so it's discoverable in-band.

#### P7.4b — `merge-from-file` for large JSON payloads (Sprint 5 S5.14)

For attribute values larger than ~120 characters (long allow-lists, certificate PEMs, multi-paragraph descriptions), pasting the JSON literal at the prompt is error-prone (newline handling, shell quoting, paste truncation). Add a file-backed variant:

```
merge-from-file <n>.<key> = <path>
```

Where `<path>` is a path **relative to the model directory** (for path-confinement safety — see Sprint 4 F-07). The skill:

1. **Validate path confinement** — reject any absolute path or path containing `..`. Acceptable forms: `controls/<id>.merged-foo.json`, `.dethereal/merge-staging/<key>.json`. Render `Invalid path '<path>': must be a relative path within the model directory. Try staging the file at .dethereal/merge-staging/<basename>.` on rejection (suggesting the canonical staging path so the operator learns the convention without trial-and-error).
2. **Auto-create the staging dir on demand (Sprint 6 Tier-3 carryover).** When `<path>` is exactly under `.dethereal/merge-staging/` and the directory does not yet exist, `mkdir -p .dethereal/merge-staging/` before reading. Render the one-line confirmation `Created .dethereal/merge-staging/ (gitignored).` so the operator knows the side-effect happened. Skip both the directory creation AND the confirmation when the path is anywhere else (e.g. `controls/<id>.merged-foo.json`) — only the canonical staging dir is auto-provisioned. Reuses the Sprint 4 `validatePathConfinement` helper for the path check; the `mkdir` is a thin wrapper that respects the confinement decision.
3. **Read the file** — if absent, render `File not found: <modelDir>/<path>. Stage the JSON literal at this path and retry.` and re-prompt.
4. **Parse + validate** — `JSON.parse(content)`. On error, surface the same parse-error rendering as inline `merge` (line 398-410 above) but with **offset-aware context** when `JSON.parse` provides a position (most engines do via `error.message` matching `at position N`):
   ```
   Invalid JSON literal at offset N: <error message>
   Got (around offset N):
     ...<60 chars before the error>HERE>><60 chars after>...
   ```
   Falls back to `Got: <first 80 chars of content>...` when offset extraction fails.
5. **Apply** — substitute the parsed value as the `decision.perKey[<n>.<key>].merged` payload.

Render confirmation, branching on parsed type so the count makes sense:

| Parsed type | Confirmation line |
|---|---|
| Array | `Parsed array (<N> entries) from <path>. Staged as the merge value for #<n>.<key>.` |
| Object | `Parsed object (<N> top-level keys) from <path>. Staged as the merge value for #<n>.<key>.` |
| String | `Parsed string (<N> chars) from <path>. Staged as the merge value for #<n>.<key>.` |
| Number/boolean/null | `Parsed <type> (<value>) from <path>. Staged as the merge value for #<n>.<key>.` |

The on-disk staging file is the operator's responsibility to clean up (the skill doesn't unlink). Suggested convention: stage under `.dethereal/merge-staging/` so it's gitignored and obvious it's transient.

#### P7.5 — Apply Decisions

Iterate touched controls in stable (lexicographic by id) order. For each control whose decision is NOT `cancel`:

```
mcp__dethereal__manage_controls(
  action: 'push-brownfield',
  directory_path: <modelDir>,
  control_id: <id>,
  decision: {
    sharedOwnership: '<cancel|push-anyway|clone-and-swap|push-unverified>',
    perKey: { '<classIdx>.<key>': { chosen: '<keep|accept-theirs|merge>', merged?: <value> }, ... },
    queryFailureReason: '<...>',   // only for push-unverified
    queryAttempts: <n>             // only for push-unverified
  },
  fresh_platform_attrs: { '<classId>': { <key>: <value>, ... }, ... },
  live_assigned_model_ids: [ <modelId>, ... ],
  this_model_id: '<manifest.model.id>'
)
```

**Error handling**:

- `success: false, error: 'EXTERNAL_EDIT_DETECTED'` — the skill knows the row index from the current `decisions` map, so render with copyable shorthand:
  ```
  Control "<name>" [class "<classId>"]: platform state drifted outside your edit history.
  Recovery (pick one):
    promote-external-edit <n>           — same-session shortcut (n = row index)
    /dethereal:sync promote-external-edit <controlId> <classId>   — out-of-session
  ```
  When the operator types `promote-external-edit <n>` *during the same prompt session*, resolve `<n>` to (controlId, classId) from the `decisions` map and invoke `mcp__dethereal__manage_controls(action: 'promote-external-edit', ...)` directly without dropping out of the prompt loop. This collapses the recovery from "copy two UUIDs from the error message into a separate skill invocation" to one keystroke.

- `success: false, error: 'CLONE_AND_SWAP_NOT_IMPLEMENTED'` → render with `cancel` recommended first (clone-and-swap was chosen *because* the operator didn't want to mutate the shared Control; `push-anyway` is the *opposite* of that intent):
  ```
  Control "<name>": clone-and-swap is a V1.1 feature.
  V1 fallback (recommended):
    cancel           Leave the Control unchanged on the platform. Manually create a
                     separate Control via /dethereal:enrich --focus controls (the
                     equivalent of clone-and-swap).
  V1 fallback (last resort — destructive):
    push-anyway      WILL overwrite the shared Control on every model that references it.
                     Only choose this if that's actually your intent.
    push-unverified  Same as push-anyway but with a force-unverified audit entry.
                     Only when the ownership query failed AND you accept the blast radius.
  ```
  Control left unchanged on the platform until the operator re-runs the row with one of these.

- Other errors → render control-scoped failure and continue with the next control (one failure does not abort the batch).

For each successful `push-anyway` / `push-unverified` (i.e., an audit entry was written), render:

```
Control "<name>" [class "<className>"]: attributes pushed (audit logged, force-shared).
```

Once per sync session (first audit entry), render the log pointer plus the secret-handling reminder and the V1-trust-model nudge:

```
Audit log: .dethereal/control-audit.log (append-only JSONL; query with jq).
NOTE: The audit log records attribute values verbatim. If your control attributes
contain secret-like values (api_key, password, vault_token_ref, etc.), add
controls/control-audit.log to .gitignore for this repo OR redact the offending
attribute on the platform before pushing. The log is committed to the repo per CL §6.

V1 trust model: the log is plain JSONL with no hash chaining. Tamper-evidence
relies on you committing it to git. Run:
  git add .dethereal/control-audit.log && git commit -m "audit: control-library push"
V1.1 will hash-chain entries so tampering with one entry breaks the chain
without requiring a separate git commit.
```

#### P7.6 — Combined Footer

Merge P6's structural counts with P7's control-library counts:

```
[done] Push complete. <N> structural elements + <P> control edits pushed (Q force-shared, R force-unverified, S reverted, T cancelled). Quality: X/100.
[next] Commit changes to git, then /dethereal:review (assess quality) or /dethereal:status (inspect lifecycle distribution)
```

If P7 had no work (empty gather in P7.1), keep the original P6 footer:

```
[done] Push complete. Quality: X/100.
[next] Commit changes to git, then /dethereal:review (assess quality)
```

#### P7.G — Greenfield Push Branch (Sprint 4 F-05)

> Pre-Sprint-4 the engine had a working `pushGreenfieldControl` method but no skill called it. A `controls/greenfield-foo.json` file authored by `/dethereal:enrich --focus controls` was silently skipped at P7.1, leaving the file-first greenfield workflow unreachable from the CLI. This branch closes that gap.

For each control file in P7.1's bucket 2 (`lifecycle === 'greenfield' || lifecycle === 'partially-pushed'`):

**Step G1 — derive `supporting_element_ids`** (also addresses RF F-13 documentation gap). Walk both `structure.json` and `dataflows.json`, collecting the id of every element whose `controls[]` array contains the new control's id (or its temp `greenfield-...` id, prior to platform creation):

```
supportingElementIds = []
for each boundary, component, flow in structure + dataflows:
  if element.controls?.some(c => c.id === <control.id>):
    supportingElementIds.push(element.id)
```

If `supportingElementIds` is empty, render a warning before pushing:
```
Greenfield control "<name>" has no supporting elements in structure or dataflows.
The Control will be created on the platform with no SUPPORTS edges. If that's not
intended, edit structure.json / dataflows.json to add controls[] references first,
then re-run /dethereal:sync.
Continue anyway? (y/n)
```

**Step G2 — pre-fetch `liveAssignedModelIds`** for the new id. For greenfield this is always `[]` (the Control doesn't exist on the platform yet — Step E sees it as alone). Pass `[]` explicitly rather than the empty default to make caller intent visible.

**Step G3 — invoke**:

```
mcp__dethereal__manage_controls(
  action: 'push-greenfield',
  directory_path: <modelDir>,
  control_id: <greenfieldId>,
  supporting_element_ids: [...],
  folder_id: <optional folder>,
  live_assigned_model_ids: []
)
```

The engine drives Steps A→D from CL §7 greenfield: create-on-platform, WAL-protected id rewrite (file rename + every `controls[]` reference in structure/dataflows rewritten from temp id to server id), per-class `setInstantiationAttributes`, lifecycle flip to `brownfield`. The WAL replay invoked by the F-02 pre-dispatch handles crash-recovery if the rewrite is interrupted.

On success, render:
```
Greenfield Control "<name>": created on platform (<serverId>), <K> SUPPORTS edge(s) attached, lifecycle → brownfield.
```

On failure, surface the engine's error and continue to the next greenfield file (one failure does not abort the batch). The on-disk file remains in `greenfield` or `partially-pushed` state for the next sync attempt.

**Counts**: include greenfield successes in P7.6's combined footer as `<G> greenfield Controls created`.

---

## Tombstone Recovery Verb (Sprint 4 F-10)

> `/dethereal:sync tombstone <controlId>` — flip a control's lifecycle to `tombstoned` locally, decoupling it from future pulls and signalling to the operator that the Control should not be re-pulled. Useful when an operator wants to retire a Control locally (e.g., after deciding the platform-side Control is the wrong choice) without waiting for the platform-deletion-detected path.

1. **Auth + lock** — uses the F-03 lock automatically via the MCP boundary.
2. **Read** the control file via `readControlFile(directory_path, controlId)`. If absent, render:
   ```
   Control <controlId> not found locally. Nothing to tombstone.
   ```
   and stop.
3. **Confirm** — render:
   ```
   Marking "<controlName>" (<lifecycle>) as tombstoned. This control will not be
   re-pulled and will be excluded from future push gathers. The on-disk file is
   preserved (not deleted) — re-pull-controls would resurrect it.
   Proceed? (y/n)
   ```
   Stop on `n`.
4. **Invoke** `mcp__dethereal__manage_controls(action: 'tombstone', directory_path, control_id)`.
5. **Render**:
   ```
   Control "<controlName>" tombstoned. Lifecycle → tombstoned; pendingEdit (if any) preserved
   for forensic reference. To re-activate, /dethereal:enrich --focus controls and edit the file.
   ```

This verb is local-only: the platform-side Control is not deleted. Use the platform UI for that.

---

## Repair WAL Recovery Verb (Sprint 5 F-20)

> `/dethereal:sync repair-wal [directory-path]` — recover from a stranded WAL journal that `applyPendingRewrites` refused to replay (`WAL_REPLAY_FAILED`). Surfaces the journal contents, the on-disk state of every operation, and walks the operator through the three available recovery actions. Use when any push/pull/status returned `WAL_REPLAY_FAILED` (typically the macOS overlay-FS / network-FS ambiguous-state case described in `wal-helper.ts:34-38`).

1. **Resolve directory** — same Model Resolution Protocol as `sync push`. Default to current working directory if no `[directory-path]`.

2. **Inspect** — invoke `mcp__dethereal__manage_controls(action: 'inspect-wal', directory_path)`. The engine returns:
   ```json
   {
     "present": true,
     "journalPath": "<modelDir>/.dethereal/pending-id-rewrite.json",
     "operations": [
       {
         "kind": "greenfield-id-rewrite",
         "tempId": "greenfield-abc",
         "serverId": "550e8400-...",
         "controlFileRename": { "from": "controls/greenfield-abc.json", "to": "controls/550e8400-...json" },
         "fromExists": true,
         "toExists": true,
         "ambiguous": true,
         "filePaths": [
           { "path": "structure.json", "exists": true, "containsTempId": false, "containsServerId": true },
           { "path": "dataflows.json", "exists": true, "containsTempId": true, "containsServerId": false }
         ],
         "createdAt": "2026-04-19T..."
       }
     ]
   }
   ```
   If `present: false`, render `No stranded WAL journal at <journalPath>. Nothing to repair.` and stop.

3. **Render** — for each operation, summarise the state and recovery options. Example for an ambiguous greenfield rewrite:
   ```
   Stranded WAL journal at .dethereal/pending-id-rewrite.json
     Created: <createdAt>
     Operation 1 of 1: greenfield-id-rewrite
       tempId    = greenfield-abc
       serverId  = 550e8400-...
       Control file rename:
         from: controls/greenfield-abc.json   [present]
         to:   controls/550e8400-...json      [present]
         [!] AMBIGUOUS — both files exist. Replay halted; operator must resolve.
       Reference rewrites:
         structure.json    serverId present, tempId absent   [ok]      rewritten
         dataflows.json    tempId present, serverId absent   [pending] not yet rewritten

   Recovery options:
     1. cancel           — leave the journal in place; investigate manually. (default)
     2. retry-replay     — re-run applyPendingRewrites. Safe iff you've already
                           manually resolved the ambiguous file pair (deleted
                           one of the two control files).
     3. clear-journal    — delete the journal without applying. Local files left
                           as-is; you'll need to manually reconcile (likely:
                           keep controls/<serverId>.json + finish rewriting
                           dataflows.json, or restore from git).

   Choose [1/2/3, default 1]:
   ```
   Order rationale (Sprint 5 cross-review): under WAL-recovery stress operators are fatigued; the safest option (cancel) is `1` and is the default on empty input. The destructive option (clear-journal) is `3` and requires verbatim confirmation below.

4. **Apply operator's choice** (empty input → `1`):
   - **`1` (cancel)** — render `Journal preserved. Re-run /dethereal:sync repair-wal when ready.` and stop.
   - **`2` (retry-replay)** — invoke any directory-touching MCP action (e.g. `mcp__dethereal__manage_controls(action: 'pull-controls', directory_path, control_ids: [])`); the F-02 pre-dispatch will replay the journal. If replay still fails, render the new error with `(attempt N of 2)` in the prompt label and offer options 1/2/3 again. After 2 retry attempts force the operator to choose 1 or 3.

     Re-inspect before each retry — the WAL state may have changed since the operator's prior inspect (another shell could have run `clear-wal` or pushed new operations). Render the freshly-inspected state alongside the retry prompt so the operator's mental model is current.

   - **`3` (clear-journal)** — destructive; require **verbatim confirmation**:
     ```
     Deleting the journal will leave .dethereal/pending-id-rewrite.json absent.
     Local files (controls/, structure.json, dataflows.json) are NOT modified.
     You are responsible for reconciling them manually.

     Type 'clear-journal' to confirm (anything else cancels):
     ```
     On exact match `clear-journal` invoke `mcp__dethereal__manage_controls(action: 'clear-wal', directory_path)`. Anything else (including `y`, blank, `clear`, etc.) is treated as cancel. On success render:
     ```
     WAL journal deleted. Local file reconciliation is now manual.

     Run /dethereal:sync status NOW before any other directory-touching action —
     the lock has been released; another shell may write a new WAL journal in
     the interim, and your next push/pull would auto-replay it without warning.

     Suggested manual checks:
       - Verify exactly one of {controls/<tempId>.json, controls/<serverId>.json} exists
       - grep -r "<tempId>" structure.json dataflows.json   (should return no hits)
     ```

5. **Re-run** `/dethereal:sync status` after a successful repair to confirm the directory is clean.

**Caveats:**
- `repair-wal` is the operator's escape hatch — it cannot guess the right resolution. The skill's job is to surface the state honestly and confirm intent.
- The lock is held for the duration of inspect-wal / clear-wal so two operators can't repair the same directory concurrently.
- The platform-side Control was already created (that's how the journal got a `serverId`). Clearing the journal does not delete the platform Control; if the operator decides the local rewrite shouldn't have been started, the platform-side cleanup is manual.
- **ASCII-only rendering convention (Sprint 6 Tier-3 carryover).** Every glyph the `repair-wal` flow renders — `[!]`, `[ok]`, `[pending]`, `[?]`, the bracketed prompt indicator above — is drawn from the same hard-coded ASCII palette used throughout this skill. Do NOT inject emoji, smart quotes, or non-ASCII separators when interpolating operator-supplied strings (e.g. `tempId` / `serverId` from a journal authored on a different host) into the rendered output: pass them through verbatim, but keep the surrounding skill prose ASCII-only so the recovery prompt stays legible in restricted terminals (CI logs, SSH-from-Windows-cmd, screen-readers).

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

### L4.5. Materialize Control Library Files (Sprint 5 F-15)

`export_model` writes `structure.json` and `dataflows.json` with `controls[]` references but does NOT write the per-control files at `controls/<id>.json`. Without this step, the local view shows Control references that have no local backing file — `/dethereal:enrich --focus controls` would re-pull each one individually, and the `controls/` directory drifts silently from `structure.json` between pulls.

**Discover the Control id set** by walking the freshly-pulled structure + dataflows:

```
controlIds = new Set()
for each component / boundary / flow in structure.json + dataflows.json:
  for each ref in element.controls[] (if any):
    controlIds.add(ref.id)
```

If `controlIds.size === 0`: skip this step entirely (no Controls referenced).

Otherwise invoke `mcp__dethereal__manage_controls(action: 'pull-controls', directory_path, control_ids: Array.from(controlIds))`. The MCP action:

- Refreshes (or creates) `controls/<id>.json` for each id with the platform's current state.
- Preserves any in-flight `pendingEdit` block on existing files (CL Appendix A.5 — caller's local edits are not silently overwritten).
- Reconciles tombstoned ids by flipping `lifecycle: 'tombstoned'` rather than deleting the file.

Render a one-line confirmation in the post-pull summary:
```
Controls library: <K> file(s) refreshed under controls/.
```

If `pull-controls` returns an error for a specific id (e.g. tombstoned + lifecycle mismatch), surface as a warning in the summary; do not abort the pull. The structure/dataflows files are already on disk in their refreshed state.

**Why this lives in pull and not enrich**: post-Sprint-5 the rule is "`/dethereal:sync pull` returns a self-consistent model directory — no follow-up `pull-controls` required." `/dethereal:enrich --focus controls` still calls `pull-controls` for newly-discovered Control references during enrichment, but a fresh pull no longer leaves `controls/` empty against a populated `structure.json`.

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
  controls/            <C> control file(s) refreshed

  Quality: <score>/100 (<label>)
  State:   <STATE> (inferred from content)

  This is now your working copy.
  Edit locally, then /dethereal:sync push to send changes back.
```

**Callout when any control file had a `pendingEdit` block preserved** (the L4.5 `pull-controls` reconciliation path — CL Appendix A.5). The operator needs to see this because the pull deliberately did NOT overwrite their in-flight local edits:
```
  Preserved in-flight edits on <P> control file(s) — your uncommitted pendingEdit
  blocks were kept; only platformAttributes was refreshed. Next push will compute
  conflict detection against the freshly-pulled platform state. (See CL A.5)
```

**Callout when structure/dataflows referenced a Control id that the platform no longer returns** (tombstoned server-side between the export_model call and the pull-controls call — the documented F-15 race, process-architect T2-1):
```
  Note: <Q> Control reference(s) in structure/dataflows had no matching entry
  in the platform response — likely tombstoned server-side after the structure
  pull. These ids have no local controls/<id>.json; next /dethereal:sync push
  will prompt for per-reference removal. Re-run /dethereal:sync pull once
  tombstone state has propagated if unexpected.
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

## Promote External Edit (Recovery Verb)

> Unblocks the Step A external-edit guard (CL §7 Step A). When the local `controls/<id>.json` `attributes` field diverges from `platformAttributes` *without* a `pendingEdit` block recording the change (e.g., the operator hand-edited the JSON, or some external tool wrote to the file), `push-brownfield` refuses to continue.
>
> This verb writes a `pendingEdit` block that records the divergence as the operator's deliberate intent so the next push proceeds. **It does NOT re-pull** — re-pulling would overwrite the local `attributes` divergence the operator is trying to promote.

### R1. Parse Arguments

`/dethereal:sync promote-external-edit <controlId> <classId>` — both required. If either is missing, render the usage hint and stop.

Resolve the model directory via the Model Resolution Protocol.

### R2. Resolve `class_idx`

Read `controls/<controlId>.json` from disk. If the file does not exist, render:

```
No local file for Control <controlId>. Run /dethereal:enrich --focus controls
to pull the control first, then re-try.
```
and stop.

Locate the class entry whose `classId === <classId>` and capture its 0-based **index** (`class_idx`). If no class matches, render the available class IDs and stop.

### R3. Promote (single MCP call)

```
mcp__dethereal__manage_controls(
  action: 'promote-external-edit',
  directory_path: <modelDir>,
  control_id: <controlId>,
  class_idx: <classIdx>
)
```

The engine method (`DtControlLibrary.promoteExternalEdit`):
- Computes the divergence between local `attributes` and `platformAttributes` for this class entry.
- Writes a `pendingEdit` block whose `previousAttributes` contains ONLY the keys that diverge (not a full snapshot — a full snapshot would push every key on the next push).
- Sets `editedBy: 'external'` and bumps `localEditedAt`.
- Persists via the WAL helper's atomic write.
- Local `attributes` is **untouched** — the operator's intended values stay.

**Error handling**:

- `success: false, error: 'NO_DIVERGENCE'` → render:
  ```
  Control <controlId> [class <classId>] has no divergence between local attributes
  and platformAttributes. Step A guard would not have fired — no recovery needed.
  Run /dethereal:status to inspect the current state.
  ```
  and stop.

### R4. Footer

```
[done] Promoted external edit on <controlId> [class <classId>] (editedBy: external).
       The local divergence is now recorded as a pendingEdit; Step A guard cleared.
[next] /dethereal:sync push — re-run the push to send the promoted edit to the platform.
       /dethereal:status (inspect the resulting pending-edit state)
```

The audit entry written by the next successful `push-brownfield` will carry `editedBy: 'external'` so an auditor can distinguish this reconciliation from a deliberate operator overwrite (CL §6 audit-log schema).

> **Stale `platformAttributes` note.** If your last `pull-controls` call was a while ago, `platformAttributes` in the local file may be stale — i.e., the platform has changed again since. The next `/dethereal:sync push` runs P7.2 (fresh batched fetch) before the engine's Step E mutation, so the conflict-detection step will catch any new server-side drift and re-prompt for per-key resolution at that point. You don't need to pull manually before invoking this verb.

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

