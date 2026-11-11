## Push Flow

The same flow serves an explicit push request and the guided workflow's sync step.

### Sign-in check

Call {{tool:auth_status}} with `verify: true`.

- If `authenticated` is true (this includes platforms with `authDisabled: true`): proceed.
- Otherwise show the tool's `detail` if present and ask the `auth-missing` question (Core Rules). On `signed in`, run this check again. On `skip`, stop the push; in the guided workflow, go on to README generation and the final footer without sync next-steps.

### Resolve and validate

1. Resolve the model path using the Model Resolution Protocol. If no model exists, suggest {{cmd:create}} first and stop.
2. Read the model files from disk: `manifest.json`, `structure.json`, `dataflows.json`, `data-items.json`.
3. Call {{tool:validate_model_json}}. If validation fails, show the errors and stop — do not push a broken model.
4. Call {{tool:validate_model_json}} with `action: 'gates'`. If Gate 2 fails, show its failing checks with their remedies and stop: the platform refuses a push while Gate 2 fails. A module gap in `manifest_complete` (`module_unknown`, `module_conflict`, `scope_unreadable`, `scope_module_invalid`, `manifest_module_invalid`) is fixed as its remedy says — for `module_unknown`, run {{tool:generate_attribute_stubs}} with platform access for the listed elements — never by editing `manifest.json`'s `modules`.
5. **Empty model guard.** If the model has 0 components and 0 boundaries (beyond the default boundary), ask:

   {{#ask id=push-empty-model}}Model has no components. Push will create/update an empty model on the platform. Continue? (continue / stop){{/ask}}

### Push consent

In the guided workflow, ask Push consent (the phase file) here, before Routing; an explicit push request is the consent. Never push on the operator's behalf because sign-in succeeded.

### Routing

Read `manifest.json` and check the `model.id` field:

- **If `model.id` is set** (model was previously pushed or pulled): this is an update to an existing platform model; the server checks it against the platform first.
- **If `model.id` is null or missing**: this is a first push (new platform model); there is nothing to conflict with.

### Conflicts, execution and after

The Push Flow Reference holds the detail of the after-push steps: the summaries and the control link warning. Read it before the push, and again after any compaction; if it cannot be read, stop.

1. **Execute:** first push → {{tool:import_model}} with `directory_path`. Update → {{tool:update_model}} with `directory_path` and `delete_orphaned: true`. The server compares the platform model with the record of the last pull or push before it writes anything, local files included, and refuses with `PLATFORM_CHANGED_SINCE_SYNC` when they differ. Never export the platform model to compare it yourself. A refusal with `control_errors` is handled as Control references says, before anything else.
2. **Platform changes.** The refusal's `data` holds `baseline` (`verified`, `missing`, `legacy` or `unverifiable`), `revision`, `changes_total`, `changed_ids` (every changed id) and `changes` (the detail of the first 500: `id`, `kind`, `name`, `change`, `fields`). Show them as a table, grouped:
   - **added on the platform** (`added_on_platform`) — the push DELETES these;
   - **changed on the platform** (`modified`) — content first (`properties`, `structure`, `controls`, `data_items`, `attributes`, `item_attributes`, `asset_context`), then the elements whose only change is `layout`, together on one line;
   - **deleted on the platform** (`deleted_on_platform`) — the push creates them again;
   - `@model` is the model itself.

   With `baseline` `missing` or `legacy` every element is `no_baseline`: there is no usable record of the last pull or push, so the server cannot tell what changed. `unverifiable` means the record cannot be verified here: the directory was moved or renamed, the model copied, or another platform URL is set. Say which, in one line. When `changes_total` is above the rows shown, say `+N more`. Then ask:

   {{#ask id=push-conflict}}Push the local model (the platform elements listed are DELETED), pull the platform version first, or cancel? (push / pull / cancel){{/ask}}

   - `push`: call {{tool:update_model}} again with `overwrite_changed` = the refusal's `changed_ids` — the full set, never built from `changes` — and `overwrite_revision` = its `revision`. When there are more changes than the server can overwrite, it refuses and asks for a pull first: offer only `pull` or `cancel`. A refusal with `acknowledgement: "stale"` means the platform changed again: show the new changes and ask again.
   - `pull`: pull the platform version first, backing up local changes — never without the backup.
   - `cancel`: stop.

   The same refusal can come from {{tool:update_attributes}}, for the elements it writes (`attributes`, `item_attributes`): handle it the same way, with the same question.

   A success with `acknowledgement: "unused"` means nothing had changed. `platform_baseline: "not_recorded"` means no record was kept: say the next push is checked without one.
3. **After the push:** read the updated model files — the push itself wrote back the id of each control it linked by name; show the push summary, any control link warning, and the local-only asset notice (all per the reference).
4. **Stale control references.** For each control reference with a non-null `id`, check the id exists in the platform control list — **except a greenfield one**: an id starting `greenfield-`, or one whose `controls/<id>.json` has `lifecycle` `greenfield` or `partially-pushed`. The control-library push creates those after this step, so they are never stale here. If any others are missing, show them (name and id), then ask:

   {{#ask id=stale-controls}}These control references no longer exist on the platform. Clear their ids (the names stay, for re-matching), or keep them as they are? (clear ids / keep){{/ask}}

   `clear ids`: set `id: null` on each stale reference — a changed `controls` list, handled as Control references says under Changed controls; `keep`: change nothing, and note the warning for manual review.
5. If countermeasures exist in the model: suggest {{cmd:surface}} after analysis, to link controls to exposures.

Skills that publish more than the model (the control library) continue after this section.
