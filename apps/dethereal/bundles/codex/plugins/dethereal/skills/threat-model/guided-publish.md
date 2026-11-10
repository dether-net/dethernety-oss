# Guided workflow — publish (Steps 10–11)

**Model files, once per step.** Read a model file once in a step and keep it: after your own write succeeds, the file holds what you wrote — do not read it again. Read it again only after a failed write or validate, a compaction or summary, or a write you did not make with your edit tool: an agent's (any model file) or a push (every model file). Nothing else rewrites a model file: `mcp__dethereal__validate_model_json` never does, and `mcp__dethereal__generate_attribute_stubs` writes only attribute files — read one again after it before you edit it. After any such write, read the file again before a whole-file write of it. The same holds for `.dethereal/discovery.json` and `.dethereal/scope.json`: never read a file to see what you wrote — your write is the file, and your edit tool edits it without a read first.

**Model-file writes, one message per answer.** Everything one operator answer changes in `structure.json`, `dataflows.json`, `data-items.json`, `.dethereal/discovery.json` and the attribute files (in the enrich skill, as Writing and validating says) goes in one message: every edit to every one of those files, as parallel calls; one edit per element is fine. A read those edits need goes in the message before. Validate in the message after, once every edit has succeeded. Never spread one answer's edits over two messages; only a failed edit is redone, after reading its file again. A whole-file write replaces a file's edits only when it is shorter.
With `apply_patch`, that message is one call: one patch, a section per file, a hunk per change.



## Step 10: Sync

Publish the model as the Push Flow below says, guided-workflow consent included. On a quick model, the consent's state line also says that it is a quick model, that Gate 3 was not run, and that `$dethereal:threat-model` with `--full` on the same path deepens it. A sign-in `skip` goes on to the README and the final footer without sync next steps; a consent `skip`, with `$dethereal:sync push` as the next step.

**Push consent**, asked where the Push Flow says: after Resolve and validate, before Routing. In the guided workflow, reaching the sync step is not consent to publish, and neither is a successful sign-in. Show, as markdown:

- the platform URL, and whether this creates a new platform model or updates the existing one (its `manifest.model.id`);
- the state as `mcp__dethereal__model_state` `get` reports it (`display_state`, with its waivers and a stale review) and the latest Gate 3 verdict — a model whose Gate 3 was skipped is **not** REVIEWED, and say so;
- the counts: boundaries, components, data flows, data items;
- that the model's asset context publishes too — scope, crown jewels, data sensitivity and regulatory flags — with REPLACE semantics: a value cleared locally is cleared on the platform.

Then ask:

`[prompt: push-consent]` Model passed Gate 2 and is ready to publish to <platformUrl>. Push to platform now? (push / skip) — table first, a numbered list; end your turn.

On `skip`, go on to README generation and the final footer, with `$dethereal:sync push` as the next step.

**After the push — the control library.** Call `mcp__dethereal__workspace_status` with `directory_path`. If its `controlLibrary` counts `pendingEdits` or `unpushed` controls, the model is published but its control library is not: say so, with the counts, and hand the control library over: load the `dethereal:sync-controls` skill (open its `SKILL.md`, whose path is in your skill list, and read it in full; its arguments are the ones named here) with `push`, the directory, the model id and this push's counts, and follow it to its footer — the model is already pushed, so never run `$dethereal:sync push` again for it. A `pull` answer at `push-conflict` hands over instead of pushing: load the `dethereal:sync-pull` skill (open its `SKILL.md`, whose path is in your skill list, and read it in full; its arguments are the ones named here) with the directory, the model id and `backup`, and follow it; push nothing. If a skill cannot be loaded, stop and tell the operator.

Then read the model files again (the server ids are now in them) and show the push summary:

```
Pushed "<model-name>" to platform.
  <N> boundaries, <M> components, <K> flows, <J> data items.
  Platform model ID: <id>

Server IDs written to local files.
Commit these changes to preserve sync state.
```

## Step 11: Post-Sync Linking

Link local countermeasures to the platform-computed exposures, so defense coverage credits existing controls.

1. If no element carries a control, say "No countermeasures defined. After analysis completes, run `$dethereal:surface` to see control gaps and exposure distribution." and go to the README.
2. Call `mcp__dethereal__get_control_gaps` with the `model_id` for the model's exposures — never `mcp__dethereal__query_exposures` `list`, which needs an `element_id` and refuses a model-wide call.
3. No exposures: "Analysis results not available yet. Linking will be possible after the analysis engine processes this model." An error is not that: show it — the call was malformed or the platform unreachable.
4. With exposures, show the table — exposure, component, candidate countermeasure, link — then ask:

   `[prompt: linking]` Link these exposures to the candidate countermeasures now, change specific rows, or defer? (yes / modify / defer) — table first, a numbered list; end your turn.

   `yes`: create the links with `mcp__dethereal__manage_countermeasures`. Linking an existing countermeasure is an `update` with `exposure_ids`, and `update`, like `delete`, works only on a USER countermeasure: the tool refuses a SYSTEM one (derived from its control's class). For a SYSTEM one, tell the operator to supersede it into an editable copy in the platform (**Customize as an editable copy**), then link the copy. `modify`: take the rows the operator drops or changes, show the table again and ask again; a link is created only for a row they confirmed — a wrong link credits a control that does not mitigate the exposure. `defer`: say that the analysis undercounts the defenses until exposures are linked to countermeasures.

## README and footer

Generate `README.md` (README Generation Protocol), also when the sync was skipped. On a quick model, show the Top Findings block Step 9 relayed again, verbatim, when it is in this conversation; otherwise say it is in the review of Step 9. Then:

```
[done] Threat model "<name>" complete. Quality: X/100 (<label>). State: <display_state>.
[next] When you're ready: run analysis on the platform, then $dethereal:surface (review attack surface)
```

After a consent `skip`, the next step is `$dethereal:sync push (publish to platform for analysis)`; after a sign-in `skip`, the footer names no sync step. On a quick model, the footer's next step also names deepening: `$dethereal:threat-model` with `--full` on the same path runs the full enrichment from Step 8, then the review.

## Push Flow

The same flow serves an explicit push request and the guided workflow's sync step.

### Sign-in check

Call `mcp__dethereal__auth_status` with `verify: true`.

- If `authenticated` is true (this includes platforms with `authDisabled: true`): proceed.
- Otherwise show the tool's `detail` if present and ask the `auth-missing` question (Core Rules). On `signed in`, run this check again. On `skip`, stop the push; in the guided workflow, go on to README generation and the final footer without sync next-steps.

### Resolve and validate

1. Resolve the model path using the Model Resolution Protocol. If no model exists, suggest `$dethereal:create` first and stop.
2. Read the model files from disk: `manifest.json`, `structure.json`, `dataflows.json`, `data-items.json`.
3. Call `mcp__dethereal__validate_model_json`. If validation fails, show the errors and stop — do not push a broken model.
4. Call `mcp__dethereal__validate_model_json` with `action: 'gates'`. If Gate 2 fails, show its failing checks with their remedies and stop: the platform refuses a push while Gate 2 fails. A module gap in `manifest_complete` (`module_unknown`, `module_conflict`, `scope_unreadable`, `scope_module_invalid`, `manifest_module_invalid`) is fixed as its remedy says — for `module_unknown`, run `mcp__dethereal__generate_attribute_stubs` with platform access for the listed elements — never by editing `manifest.json`'s `modules`.
5. **Empty model guard.** If the model has 0 components and 0 boundaries (beyond the default boundary), ask:

   `[prompt: push-empty-model]` Model has no components. Push will create/update an empty model on the platform. Continue? (continue / stop) — table first, a numbered list; end your turn.

### Push consent

In the guided workflow, ask Push consent (the phase file) here, before Routing; an explicit push request is the consent. Never push on the operator's behalf because sign-in succeeded.

### Routing

Read `manifest.json` and check the `model.id` field:

- **If `model.id` is set** (model was previously pushed or pulled): this is an update to an existing platform model; the server checks it against the platform first.
- **If `model.id` is null or missing**: this is a first push (new platform model); there is nothing to conflict with.

### Conflicts, execution and after

The Push Flow Reference holds the detail of the after-push steps: the summaries and the control link warning. Read it before the push, and again after any compaction; if it cannot be read, stop.

1. **Execute:** first push → `mcp__dethereal__import_model` with `directory_path`. Update → `mcp__dethereal__update_model` with `directory_path` and `delete_orphaned: true`. The server compares the platform model with the record of the last pull or push before it writes anything, local files included, and refuses with `PLATFORM_CHANGED_SINCE_SYNC` when they differ. Never export the platform model to compare it yourself. A refusal with `control_errors` is handled as Control references says, before anything else.
2. **Platform changes.** The refusal's `data` holds `baseline` (`verified`, `missing`, `legacy` or `unverifiable`), `revision`, `changes_total`, `changed_ids` (every changed id) and `changes` (the detail of the first 500: `id`, `kind`, `name`, `change`, `fields`). Show them as a table, grouped:
   - **added on the platform** (`added_on_platform`) — the push DELETES these;
   - **changed on the platform** (`modified`) — content first (`properties`, `structure`, `controls`, `data_items`, `attributes`, `item_attributes`, `asset_context`), then the elements whose only change is `layout`, together on one line;
   - **deleted on the platform** (`deleted_on_platform`) — the push creates them again;
   - `@model` is the model itself.

   With `baseline` `missing` or `legacy` every element is `no_baseline`: there is no usable record of the last pull or push, so the server cannot tell what changed. `unverifiable` means the record cannot be verified here: the directory was moved or renamed, the model copied, or another platform URL is set. Say which, in one line. When `changes_total` is above the rows shown, say `+N more`. Then ask:

   `[prompt: push-conflict]` Push the local model (the platform elements listed are DELETED), pull the platform version first, or cancel? (push / pull / cancel) — table first, a numbered list; end your turn.

   - `push`: call `mcp__dethereal__update_model` again with `overwrite_changed` = the refusal's `changed_ids` — the full set, never built from `changes` — and `overwrite_revision` = its `revision`. When there are more changes than the server can overwrite, it refuses and asks for a pull first: offer only `pull` or `cancel`. A refusal with `acknowledgement: "stale"` means the platform changed again: show the new changes and ask again.
   - `pull`: pull the platform version first, backing up local changes — never without the backup.
   - `cancel`: stop.

   The same refusal can come from `mcp__dethereal__update_attributes`, for the elements it writes (`attributes`, `item_attributes`): handle it the same way, with the same question.

   A success with `acknowledgement: "unused"` means nothing had changed. `platform_baseline: "not_recorded"` means no record was kept: say the next push is checked without one.
3. **After the push:** read the updated model files — the push itself wrote back the id of each control it linked by name; show the push summary, any control link warning, and the local-only asset notice (all per the reference).
4. **Stale control references.** For each control reference with a non-null `id`, check the id exists in the platform control list — **except a greenfield one**: an id starting `greenfield-`, or one whose `controls/<id>.json` has `lifecycle` `greenfield` or `partially-pushed`. The control-library push creates those after this step, so they are never stale here. If any others are missing, show them (name and id), then ask:

   `[prompt: stale-controls]` These control references no longer exist on the platform. Clear their ids (the names stay, for re-matching), or keep them as they are? (clear ids / keep) — table first, a numbered list; end your turn.

   `clear ids`: set `id: null` on each stale reference — a changed `controls` list, handled as Control references says under Changed controls; `keep`: change nothing, and note the warning for manual review.
5. If countermeasures exist in the model: suggest `$dethereal:surface` after analysis, to link controls to exposures.

Skills that publish more than the model (the control library) continue after this section.

## Push Flow Reference

The detail behind the Push Flow's steps; it holds no questions. Read it before the push and again after any compaction.

### Sync record

The pull and push tools write `.dethereal/sync.json` themselves: never write or rebuild it by hand. It holds the ids of the last sync and the signed record of the platform model the push checks, which no hand-written file can carry. When it is missing but `manifest.model.id` is set (e.g. a fresh clone), push anyway: the server refuses with `PLATFORM_CHANGED_SINCE_SYNC` and `baseline: missing`, listing every platform element, and the Push Flow's platform-changes step handles it. Never pull only to get the file back: a pull overwrites the local model.

What the push would delete on the platform — elements there that the local model does not hold — comes from the same refusal: its `added_on_platform` rows. Boundaries among them matter most: deleting a boundary has cascading structural consequences, so name them first. Never export the platform model to diff it yourself.

### Execute the push

**First push** (no `manifest.model.id`):
- Call `mcp__dethereal__import_model` with `directory_path`
- The tool handles: ID mapping (writes server UUIDs back to local files), sync.json creation

**Update** (has `manifest.model.id`):
- Call `mcp__dethereal__update_model` with `directory_path` and `delete_orphaned: true`
- The tool handles: structural diff, applying changes, sync.json update
- `delete_orphaned` is always `true`: the server refuses before it deletes anything the operator has not named (the refusal's `added_on_platform` rows), and the operator's `push` answer names them. The conflict decision is the operator's answer, not a tool parameter.

Both tools also publish the model's **asset context**: model scope (read from `.dethereal/scope.json`), per-component `crownJewel` (first-class in `structure.json`), and per-data `sensitivity` / `regulatoryFlags` / `origin` / `isCredential` (first-class in `data-items.json` as `sensitivity`, `regulatory_flags`, `origin`, `is_credential`). These use REPLACE semantics — clearing a value locally clears it on the platform on the next push; an `is_credential: false` is an answer and is published as such.

### After the push — details

- **Push summary:**
  ```
  Pushed "<model-name>" to platform.
    <N> boundaries, <M> components, <K> flows, <J> data items.
    Platform model ID: <id>

  Server IDs written to local files.
  Commit these changes to preserve sync state.
  ```
- **Control links:** a push that succeeds has linked every `controls[]` entry (an entry that cannot be linked refuses the whole push: Control references). A warning that an entry's linked Control has another name in the catalog is shown with the entry and both names.
- **Local-only asset notice:** `mcp__dethereal__import_model` / `mcp__dethereal__update_model` may warn that crown-jewel marks on non-component elements (data items, boundaries, flows) were not synced — the platform tracks crown jewels on components only. Surface it verbatim when present.

## Control references

A push links every `controls[]` entry to a Control in the organisation's catalog before it writes anything. An entry with an `id` links to that id only. An entry with no id links to the Control whose name is the same — exact after Unicode normalisation (NFC), with invisible default-ignorable characters removed and spaces trimmed; never a case-insensitive or partial match. When an entry cannot be linked, the push is refused.

**Greenfield entries are deferred.** An entry whose id is a greenfield temporary id (`greenfield-…`) is not linked, refused or warned about by the model push: it never appears in `control_errors`. The model push goes first; the control library's greenfield push then creates the Control and links the entry. An entry whose greenfield push failed before its id was rewritten stays deferred until that push runs again.

**The refusal.** "Control references could not be resolved; nothing was pushed", or "Element ids must be unique in the model; nothing was pushed" — its `data` holds `codes` and `control_errors`, one per entry, at most 100 (`control_errors_total`, when present, is the whole count): `code`, `ref` (an element id, `@model` for the model's own controls, or `<group>[<n>]` for an element that has no id yet), `index` (its position in that `controls` list; absent when the element's `controls` is not a list at all), `control` (`id`, `name`), and `candidates` (`id`, `name`) with `candidates_total` when catalog Controls carry the entry's name. When the refusal does not say nothing was pushed, a model may already exist: show the error as it is and stop.

- `control_catalog_unavailable` — the catalog could not be read: nothing was pushed. Say so, and stop; the push can be tried again later.
- `duplicate_element_id` — two elements share an id, or an id equals `@model` or a `<group>[<n>]` reference: name them and stop. The ids are fixed in the model files first.

Otherwise, show every entry as one table — `C# | element (or the model) | entry (name, id) | problem | candidates` — the candidates by number with their ids, `+N more` past the listed ones; with `control_errors_total`, say how many more entries wait (that total minus the rows shown): they come back on the next push:

- `control_name_ambiguous` — several Controls have this name;
- `control_name_not_found` — no Control has this name;
- `control_id_not_found` — the linked Control is gone from the catalog (exact-name candidates, if any);
- `control_entry_invalid` — the entry has neither an id nor a name, or the element's `controls` is not a list.

Then ask:

`[prompt: control-resolve]` For each row, give a candidate's number, `create` (a new Control in the catalog, under this name), `remove` (drop the entry from its element), or the exact name of another Control. Every row needs an answer; `not now` cancels the push. — a plain message; end your turn.

Never pick for the operator, never remove, rename or strip a control to get a push through, and never push again while a row is unanswered. `not now` stops: nothing is pushed. In the guided workflow, go on as after a consent `skip`.

**Writing the answers**, with your edit tool, into the entry at `ref` and `index`. `@model` is `manifest.json`'s `model.controls`; an element id is that element's `controls`; `<group>[<n>]` is the element at position `n` (from 0) of its group, counted in this order: the boundaries and components of `structure.json` from the root boundary down — a boundary, then its components, then its child boundaries — then the data flows of `dataflows.json`, then the data items of `data-items.json`, each in list order. A data item id is that item's `controls` in `data-items.json`. Then:

- a candidate, or another Control by name — its `id` and its catalog `name`;
- `create` — `mcp__dethereal__manage_controls` `create` under the entry's name (it asks the operator's approval), then the new Control's `id`;
- `remove` — the entry leaves its `controls` list.

**Changed controls.** Every entry changed this way was written from the operator's answer: show the changed `controls` lists in one table, then push again. An entry whose id `clear ids` cleared after a push is shown the same way, with no push: the next push links it again by name.

**After a push.** A warning that an entry's linked Control has another name in the catalog than the entry holds means a stale id may link a different Control: show the entry and both names.

## README Generation Protocol

After model creation or guided workflow completion, generate `README.md` in the model directory root:

```markdown
# <Model Name>

> Auto-generated by Dethereal. Do not edit.

## Model Structure

<tree view — boundaries and components hierarchy>

## Data Flows

<list — source → target: description>

## Status

Quality: X/100 (<Label>)
State: <display_state from the state tool>
Last synced: <timestamp from sync.json, or "never">
Generated: <ISO 8601 timestamp>
```

While `mcp__dethereal__model_state` `get` shows `mode: 'quick'`, the README's first line under the title is `> **Quick model, not reviewed: deepen with the threat-model skill and --full.**`; without it, no such line.

Regenerate on: model creation (`$dethereal:create`), guided workflow completion (`$dethereal:threat-model`). Do not regenerate on individual add/remove operations (too frequent). The README is never imported to the platform — it exists only for human browsability in git.
