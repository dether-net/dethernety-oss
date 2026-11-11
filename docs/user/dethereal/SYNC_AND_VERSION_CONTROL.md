---
title: 'Sync and Version Control'
description: 'Push/pull workflow, conflict handling, git integration, and multi-model projects'
category: 'documentation'
position: 8
navigation: true
tags: ['dethereal', 'sync', 'git', 'version-control', 'push', 'pull']
---

# Sync and Version Control

Dethereal models live as JSON files on your filesystem. You work on them locally, commit them to git, and publish them to the Dethernety platform when ready for analysis.

---

## The Dual-Authority Model

Local files and the platform each own different things:

| Concern | Authority | Why |
|---------|-----------|-----|
| **Model structure** — components, boundaries, flows, attributes, data items, classifications | Local filesystem (git-versioned) | Developer-centric, offline-capable, auditable, rollback via git |
| **Computed artifacts** — exposures, analysis results, countermeasure-exposure links | Platform (graph database) | Requires graph traversal, analysis engine, multi-model composition |

**Push is a publish operation, not a sync.** Your local files are the manuscript; the platform is the published version. When you push, the local model replaces the platform model entirely.

A data item's sensitivity, regulatory flags, origin and credential flag travel together on push and pull, and each replaces the value on the other side: a field you removed locally is removed on the platform. A credential flag answered **no** is published as an answer, not dropped.

One exception: a data item's controls. A data item in `data-items.json` with a `controls` list (including `[]`) gets exactly that list on the platform, but a data item **without** a `controls` key keeps the controls it already has there. To remove a control from a data item, write the list without it; to remove them all, write `"controls": []`. Never delete the key — that leaves the platform's controls in place. (For components, boundaries, and flows, an absent `controls` key does clear them.)

---

## Pushing to the Platform

```
> /dethereal:sync push
```

### First Push

When a model has never been pushed (no `model.id` in manifest.json), the plugin creates a new model on the platform. After import:

- Server-generated IDs are written back to your local files (replacing temporary reference IDs)
- Sync metadata is created at `.dethereal/sync.json`
- The plugin recommends committing these changes to git

```
Pushed "Payment API" to platform.
  4 boundaries, 6 components, 8 flows, 5 data items.
  Platform model ID: abc-123-def

Server IDs written to local files.
Commit these changes to preserve sync state.
```

### Subsequent Pushes

When updating an existing platform model, the server checks for platform changes first (see [Conflict Detection](#conflict-detection--structural)), then pushes with `delete_orphaned: true` — elements you removed locally are also removed on the platform.

### Classes the Platform Does Not Have

Each element's class is looked up on the platform you push to: first by its ID, then by its module and class name. A class that has a different ID on that platform — for example, because the model came from another Dethernety instance — is still found.

If a class in your model is not available on the platform you push to (for example, its module is not installed there), the push keeps going:

- **First push:** the element is created without a class, and its answers are not written.
- **Later pushes:** the element keeps its current class and answers on the platform.

Either way, the push reports a warning that names the class. On later pushes the warning also names the element:

```
Component "Orders DB": Could not resolve component class (id=…, name=Database, module=example-module); it keeps its current class binding and answers.
```

Your files keep the class you chose for that element, and its answers. Each push reminds you with the warning above until the class is available on the platform (for example, once its module is installed there) or you choose another class for the element.

**If the platform refuses a change.** When the platform refuses a change, such as binding an element to a class, the push fails with an error that names the element and gives the platform's reason — for example, `Could not bind "API" to class <id> (<code>): <reason>`. The rest of the push is still written. Fix the cause and push again; that push lists the parts already written as changes on the platform (see [Conflict Detection](#conflict-detection--structural)).

### Pushing a Quick Model

A quick model — a new model started by `/dethereal:threat-model` or made with `/dethereal:create` (except a pull) without `--full` — can be pushed. It is held to the same checks as any other push — Gate 2 — but it is never REVIEWED. In the guided workflow, the push confirmation says it is a quick model, that Gate 3 was not run, and that `/dethereal:threat-model` with `--full` on the same path deepens it. See [Quick Mode](GUIDED_WORKFLOW.md#quick-mode).

### Classes the Platform Does Not Have

Each element's class is looked up on the platform you push to: first by its ID, then by its module and class name. A class that has a different ID on that platform — for example, because the model came from another Dethernety instance — is still found.

If a class in your model is not available on the platform you push to (for example, its module is not installed there), the push keeps going:

- **First push:** the element is created without a class, and its answers are not written.
- **Later pushes:** the element keeps its current class and answers on the platform.

Either way, the push reports a warning that names the class. On later pushes the warning also names the element:

```
Component "Orders DB": Could not resolve component class (id=…, name=Database, module=example-module); it keeps its current class binding and answers.
```

Your files keep the class you chose for that element, and its answers. Each push reminds you with the warning above until the class is available on the platform (for example, once its module is installed there) or you choose another class for the element.

**If the platform refuses a change.** When the platform refuses a change, such as binding an element to a class, the push fails with an error that names the element and gives the platform's reason — for example, `Could not bind "API" to class <id> (<code>): <reason>`. The rest of the push is still written. Fix the cause and push again.

**If a push, pull, or control assignment fails with "Platform too old for this Dethereal version".** The platform you are connected to predates controls on data items, which this version of Dethereal reads and writes. The plugin checks for this before it pushes, pulls, or assigns controls, and stops with this error instead of a failure that does not say why; the message names the platform's address. Update the platform, or use a Dethereal version released before controls on data items.

### Gate 2 Pre-Flight

Before any push, the plugin validates Gate 2 (sync-blocking) criteria:

- Manifest has name and description, and a module list the server can derive (see [manifest.json](MODEL_CONCEPTS.md#manifestjson))
- At least 1 boundary besides the default boundary, 1 component, and 1 data flow
- All data flow source/target IDs exist in structure.json
- No orphaned attribute files
- Every attribute file can be read
- No attribute file carries a `controls` key — controls belong in `structure.json` and `dataflows.json`, managed with the control tools
- No validation errors

If Gate 2 fails, the push is blocked. Fix the reported issues first.

A module reference the server cannot derive is reported under the manifest check with one of these codes. Apply the remedy; editing `modules` in `manifest.json` by hand does not fix it.

| Code | What it means | Remedy |
|------|---------------|--------|
| `module_unknown` | No module is known for a class the model uses. | Run `generate_attribute_stubs` with platform access for the listed elements, to refresh the class's cache entry. |
| `module_conflict` | The class cache and the elements name different modules for a class. | Run `generate_attribute_stubs` with platform access for the listed elements, to refresh the class's cache entry. |
| `scope_unreadable` | `.dethereal/scope.json` could not be read, so its `activeModules` are unknown. | Fix or restore `.dethereal/scope.json` so it can be read. |
| `scope_module_invalid` | An `activeModules` entry in `.dethereal/scope.json` is not `{id, name}`. | Fix or remove that entry. |
| `manifest_module_invalid` | A `modules` entry in `manifest.json` is not `{id, name}`. | Fix or remove that entry. |

When the manifest lacks `modules` because there is nothing to derive them from, confirm the model's modules into the scope's `activeModules` (the workflow's module selection does this).

### Control References

Before a push writes anything — first push or update — every entry in a `controls` list (on an element, or on the model itself) must link to exactly one Control in your organisation's control catalog, except a greenfield entry:

- **An entry with an `id`** links to that Control only.
- **An entry with no `id`** links only to a Control whose name is exactly the same. Names are compared after Unicode normalisation, with invisible characters removed and surrounding spaces trimmed. A name that differs in letter case, or is only part of a Control's name, does not match.
- **An entry with a greenfield temporary id** (`greenfield-…`) is deferred: the model push does not link it, refuse it or warn about it. The model push goes first; the control library's greenfield push then creates the Control and links the entry. If that greenfield push fails before the id is rewritten, the entry stays deferred until it runs again.

**If any entry cannot be linked, the whole push is refused and nothing is pushed.** The plugin shows every such entry in one table, with the element, the entry, the problem, and numbered candidates where there are any:

| Problem | Meaning |
|---------|---------|
| `control_name_ambiguous` | Several Controls have this name |
| `control_name_not_found` | No Control has this name |
| `control_id_not_found` | The Control with this id is no longer in the catalog |
| `control_entry_invalid` | The entry has neither an id nor a name |

It then asks you to answer every row with one of:

- **a candidate's number** — link the entry to that Control;
- **`create`** — create a new Control under the entry's name (the plugin asks you to approve the creation);
- **`remove`** — drop the entry from its element;
- **the exact name of another Control** — link the entry to that Control.

`not now` cancels, and nothing is pushed. The plugin never picks a Control for you, and never removes a control to get a push through.

**The changed entries.** The plugin writes your answers into the control entries in your model files, shows the changed `controls` lists in one table, and then pushes again.

Two other refusals also stop the push with nothing pushed, but have no table to answer:

- `control_catalog_unavailable` — the control catalog could not be read. Try the push again later.
- `duplicate_element_id` — two elements share an id. Fix the ids in the model files, then push again.

**After a successful push**, if an entry's `id` links a Control whose name in the catalog differs from the name in the entry, the plugin shows the entry with both names: a stale id may link a different Control than you meant.

### Confirming Values

Whenever you confirm values — answering a question, accepting a proposal, or adjusting rows — you see them first as **a table in the chat**, one row per value: the element, the field and the value. Reply to confirm it, or adjust rows. This table is where you check the values, on every harness.

Once you have answered, the assistant writes what you confirmed — and only that — into the model files with its edit tool, then validates the model. A value you did not confirm is not written.

**One exception: Step 8 of the guided workflow.** The enrichment agent writes the values it can cite from a file line, or derive from a setting a file states, into empty attribute fields before you see them. The relay files that follow list every value it wrote, and your reply keeps, rejects or changes them. See [One relay turn](GUIDED_WORKFLOW.md#one-relay-turn).

To take back values that were written, revert the model files with git (see [Git as the Undo Mechanism](#git-as-the-undo-mechanism)), or change them with `/dethereal:enrich`.

### The Settlement Switch

The Dethereal server has a **settlement**: a signed record, kept on this machine, of the values you registered as yours. The settlement is **off by default** and reserved. The guided workflow and the commands do not use it: what you confirm is written to the model files, as above.

It is on only when the server's environment sets `DETHEREAL_SETTLEMENT` to exactly `on`. Any other value reads as off, and the server says so once when it starts. The shipped plugin bundles do not set the variable. On Codex, the server takes it from your shell's environment if you set it there.

With the settlement off:

- The `model_state_settle` tool is not served, and no value is registered.
- Nothing holds back a review record (REVIEWED) or a push for being unregistered or awaiting confirmation.
- Gate 2, Gate 3, [Gate 3 waivers](GUIDED_WORKFLOW.md#waiving-a-gate-3-gap) and the deletion of orphaned attribute files work as usual.

With the settlement on, a value in the model files that nobody registered blocks REVIEWED and a push. Turning it on therefore holds back REVIEWED and every push, because this version's workflow registers none of the values the operator confirms (only a pull registers what it pulled). For the full behaviour, see [Settlement Switch](../../architecture/dethereal/MCP_ARCHITECTURE.md#settlement-switch).

### Conflict Detection — Structural

When pushing an update, the server first compares the platform model with its record of your last pull or push, before it writes anything. This catches changes someone made through the platform GUI since then. If the platform changed, the push is refused (`PLATFORM_CHANGED_SINCE_SYNC`) and the plugin shows the changes as a table, in three groups:

- **Added on the platform** — the push **deletes** these;
- **Changed on the platform** — content changes first, then the elements whose only change is their layout, together on one line;
- **Deleted on the platform** — the push creates them again.

If there is no usable record of your last pull or push (it is missing, or from an older version), the server cannot tell what changed, and every element is listed, since there is nothing to compare it with. If the record cannot be verified here — the directory was moved or renamed, the model was copied, or another platform URL is set — the plugin says which. Then it asks:

```
Push the local model (the platform elements listed are DELETED), pull the platform version first, or cancel? (push / pull / cancel)
```

- **push** overwrites exactly the changes listed. If the platform changed again in the meantime, you see the new changes and are asked again; if there are more changes than the server can overwrite, only pull or cancel is offered.
- **pull** pulls the platform version first, always taking a backup of your local model.
- **cancel** stops; nothing is pushed.

### Shared-Ownership Prompts

If your edits change brownfield Controls (Controls pulled from the platform) that other Models also use, the push asks before it changes them. Editing a shared Control changes it in models you may not even have open — the plugin refuses to do this silently. A Control used only by this model, with no key that conflicts with the platform, is pushed without a question.

**One shared Control.** When exactly one Control needs a decision — it is shared, its ownership is known, and none of its keys conflict — the push shows it on its own:

```
Shared Control: Database Encryption Package (Payment API)
This Control is also assigned to 3 other models (4 total):
  - User Service
  - Reporting
  - Admin Console

You are about to change these attributes on the IS_INSTANCE_OF edge to ControlClass "Encryption at Rest":

  algorithm:        AES-128  →  AES-256   (you proposed)
  keyRotationDays:  90       →  30        (you proposed)

  No other attributes will be touched (push uses partial payload).

Affected ControlClass: Encryption at Rest (1 of 1 classes on this Control)

This control is used by other models too: your change applies to all of them. (cancel / push-anyway)
```

`cancel` leaves the platform unchanged; your local edits stay, and the question comes back on the next push. `push-anyway` applies your changes to all four models and leaves the keys you did not change as they are.

**The review screen.** With two or more Controls to decide, any key that conflicts with the platform, or a Control whose ownership could not be checked, the push shows a review screen instead. Give your decisions one or more per message, then type `done` to push:

- **Per Control:** `cancel <n>`, `push-anyway <n>`, or `push-unverified <n>`. A Control whose ownership is unknown takes only `push-unverified` or `cancel`.
- **Per conflicting key:** see Per-key resolution below.
- **Bulk:** `cancel-all` cancels every Control that needs a decision (the Controls that are safe to push still push); `cancel-everything` pushes nothing.
- **Inspection:** `show <n>` expands a row; it decides nothing.

To fork a shared Control instead of changing it, `cancel` it, then create a separate Control with `/dethereal:enrich --focus controls`.

Choosing `push-anyway` writes a `force-shared` entry to `.dethereal/control-audit.log`, recording who decided to mutate the shared state. Choosing `push-unverified` writes a `force-unverified` entry with the reason the ownership query failed. The log stays on your machine and records no attribute values — see [the note on the audit log](#what-to-commit) below.

**Per-key resolution.** A key conflicts when the platform value changed since your edit started. Resolve each conflicting key with `keep <n>.<key>` (push your value), `accept-theirs <n>.<key>` (take the platform value), `merge <n>.<key> = <json>` (push the value you type), or `drop <n>.<key>` (leave the key out of the push); `keep-all <n>` and `accept-theirs-all <n>` cover every conflicting key of one Control. The review screen asks until every conflicting key has a decision.

**Large payloads.** For a lengthy value (a long list, a multi-paragraph text), use `merge <n>.<key> = <json>` and paste the value as one JSON literal; a multi-line paste carries it whole. The skill never reads a value from a file.

### External-Edit Guard

If a local control file was changed outside the plugin — its `attributes` differ from its `platformAttributes` with no `pendingEdit` recording the change, because it was edited by hand or written by another tool — the control-library push stops before pushing any Control, even ones with valid pending edits:

```
External edit detected on control(s):
  - "Database Encryption Package" [class "Encryption at Rest"]: attributes diverge from platformAttributes with no pendingEdit.
    Recovery: /dethereal:sync promote-external-edit <controlId> <classId>
```

If the guard catches one while Controls are being pushed, that Control is refused with `Control "<name>" [class "<classId>"]: its local values were changed outside the plugin (no edit record for them).` and the same recovery line. The guard exists so untracked changes cannot silently overwrite the platform. To proceed:

```
> /dethereal:sync promote-external-edit <controlId> <classId>
```

It shows each diverging key (platform value → local value) and, once you confirm, records your **local** values as your edit, so the next push publishes them — through the shared-ownership check like any other edit. The local `attributes` are left untouched, and nothing is re-pulled.

### Recovery Verbs

Three operator recovery paths exist for the control-library workflow:

| Verb | When to use |
|------|-------------|
| `/dethereal:sync repair-wal` | A command reported `WAL_REPLAY_FAILED`, or `WAL_JOURNAL_REJECTED` for a journal this machine did not write for this model. Shows the stranded `.dethereal/pending-id-rewrite.json` journal and asks `(cancel / retry / clear)`: **cancel** keeps the journal; **retry** replays it, after you have resolved an ambiguous file pair by hand; **clear** deletes it once you type `clear-journal`, and leaves the control files for you to reconcile. A rejected journal is never replayed, so only cancel and clear are offered. |
| `/dethereal:sync promote-external-edit <controlId> <classId>` | The control-library push stopped on an external edit. Records the local values as your edit. Purely local — no platform mutation. |
| `/dethereal:sync tombstone <controlId>` | Retiring a Control locally: it is left out of pushes, and the platform Control is not deleted. A later pull brings it back while the model still references it — remove the reference to retire it for good. |

---

### A Control Push That Cannot Finish

A new control is pushed in steps: it is created on the platform first, then each of its classes gets its values. If a push stops part-way, the control file stays `partially-pushed` and the next push resumes it. A pull in between is safe: it keeps the file resumable and keeps the values not yet pushed.

If, before the push resumed, someone unbound one of the control's classes on the platform, the resumed push pushes the other classes, names the class that is no longer bound, and stops with the file still `partially-pushed` and that class's local values kept. For each class it names, choose one:

- **Keep the class** — ask Dethereal to bind it to the control again. The class list you give replaces the control's classes, so it names every class the control should carry, this one included. Then push again; the push sets the class's values and finishes.
- **Give up its local values** — remove that class's entry from the `classes` list in `controls/<id>.json`, leaving `lifecycle` and `platformState` as they are. Then push again; the push finishes.

If the class was deleted from the platform rather than unbound, the push refuses earlier and names it as no longer existing. Only the second choice works then.

## Pulling From the Platform

```
> /dethereal:sync pull
```

### Model Selection

If you don't specify a model ID, the plugin lists available platform models:

```
Platform models:
  1. Production Stack (ID: abc-123)
  2. Staging Environment (ID: def-456)
  3. API Gateway (ID: ghi-789)

Select a model (number or ID):
```

### Handling Existing Local Models

If the target directory holds a different platform model, the pull stops and suggests a new directory; it never pulls over another platform model. If it holds this model with no local changes and no unpushed control work, the pull goes ahead. Otherwise — local changes, never synced, an unknown state, or control work not pushed — it asks:

```
Local "Production Stack" has changes the platform does not have. Pulling will OVERWRITE the model files (a backup is taken first). (push first / backup / overwrite / cancel)
```

- **push first** — stops, and tells you to run `/dethereal:sync push` for this directory, then `/dethereal:sync pull` again. Nothing is pulled.
- **backup** or **overwrite** — pulls. Both take a backup first, since the pull always takes one.
- **cancel** — stops; nothing changes.

A recovery journal in the directory stops the pull before anything is exported and points you to `/dethereal:sync repair-wal`.

The backup is a full copy of the model tree written **beside** the model directory — `./threat-models/prod.backup-2026-08-25T09-14-02-771Z/`, not a `.backup/` subdirectory. Push takes one too, by default, before it updates the platform. Backups are never garbage-collected, so prune stale `*.backup-*` siblings periodically and keep them out of git (see [What to Commit](#what-to-commit)).

### State Inference

Platform models don't have `.dethereal/state.json`. When the pulled directory had no workflow state yet, the pull infers it from model content:

| Content | Inferred State |
|---------|---------------|
| 0 components | INITIALIZED |
| No data flows | SCOPE_DEFINED |
| No classifications or attributes | STRUCTURE_COMPLETE |
| Has classifications or attributes | ENRICHING |

**REVIEWED is never inferred** — it requires explicit validation through the workflow.

**DISCOVERED is skipped** — discovery is a plugin-side concept. Platform models don't track discovery provenance. If you resume the guided workflow (`/dethereal:threat-model`) on a pulled model inferred as STRUCTURE_COMPLETE, it starts from Step 5 (Data Flow Mapping), skipping discovery and model review.

**An existing state is kept.** When the directory already had a workflow state, the pull keeps it, a quick model's mark included, and only compares it with what the content supports. A fresh pull's inferred state is never marked quick. If the pulled content supports a later state, the summary says so and suggests advancing; if it supports only an earlier one, the summary suggests a backward transition. A kept REVIEWED state is shown as ENRICHING unless the model still meets the review's conditions.

### Missing Scope Metadata

Pull materialises `.dethereal/scope.json` from the platform model's scope fields (depth, modeling intent, compliance drivers, exclusions, trust assumptions), keeping any local-only workflow settings already in the file; push reads it back. A legacy model created without scope simply yields a `scope.json` with no synced keys — you can fill it in via `/dethereal:threat-model`, but you no longer need to hand-create the file.

### Referenced Models

If the pulled model references other models (via `representedModel` links), those references are displayed but **not auto-pulled** — pulling referenced models could trigger unbounded recursive imports.

---

## Sync Status

```
> /dethereal:sync status

Sync Status: ./threat-models/prod/

  Model: "Production Stack"
  Quality: 56/100
  State: ENRICHING

  Platform:
    Model ID: abc-123-def
    URL: https://dethernety.example.com
    Auth: user@example.com (45 min remaining)

  Sync:
    Last push: 2 hours ago
    Last pull: never
    Local: Changes not pushed

  Referenced Models: API Service (not available locally)
```

### Content Hashing

The plugin uses content hashes to determine if local changes exist. Diagram layout (position, dimensions) and export timestamps are excluded — moving components around doesn't count as a model change — but edits to structure (including component crown-jewel marks), data items (including data sensitivity and regulatory flags), element security attributes, and model scope all do, so local enrichment is detected before a pull would overwrite it.

---

## Version Control with Git

### What to Commit

**Always commit:**
- Model files: `manifest.json`, `structure.json`, `dataflows.json`, `data-items.json`
- Attribute files: `attributes/**/*.json`
- Control files: `controls/<id>.json` (one per Control referenced by the model)
- Workflow metadata: `.dethereal/state.json`, `.dethereal/quality.json`, `.dethereal/scope.json` — `state.json` is safe to share: a Gate 3 waiver it records counts only on the machine that granted it (see [Waiving a Gate 3 gap](GUIDED_WORKFLOW.md#waiving-a-gate-3-gap))
- Discovery provenance: `.dethereal/discovery.json` — drift detection reads it
- Class files: `.dethereal/class-cache/`, `.dethereal/template-fields/`
- Auto-generated README: `README.md`
- Model registry: `.dethernety/models.json`
- Decomposition plan: `.dethernety/decomposition-plan.json` (multi-model projects)

**Kept out of git for you:**
- `.dethereal/sync.json` — this machine's sync state
- `.dethereal/relay/` — the enrichment relay files, one per enrichment run: Step 8 of the guided workflow (see [One relay turn](GUIDED_WORKFLOW.md#one-relay-turn)), or an enrichment the threat-modeler agent hands to the security-enricher. Nothing reads them again once that enrichment is over: you may delete the folder by hand, in your own terminal, whenever no enrichment is running
- `.dethereal/settlement-baseline.json`, `.dethereal/settlements.json` — the settlement's records, written only with the [settlement](#the-settlement-switch) switched on

These belong to this machine and are never shared. With the default settings, the Dethereal server writes `.dethereal/.gitignore` listing them, together with `control-audit.log`, on every pull, push and workflow-state change. It creates the file if there is none; otherwise it only appends the lines that are missing, and never changes a line you wrote. If `.dethereal/.gitignore` is a link or not a regular file, the server leaves it alone, and the plugin tells you to keep these files out of git yourself. If your repository already tracks one of them, untrack it once, in your own terminal:

```bash
git rm --cached -- <model-path>/.dethereal/sync.json
```

**Recommended for `.gitignore`:**
- `.dethereal/pending-id-rewrite.json` — WAL journal (transient; replayed automatically by the next control-library action)
- `.dethereal/control-audit.log` — the control audit log; it stays on your machine
- Lock and temporary files in `.dethereal/` — `*.lock`, `*.tmp.*`, `*.breaking`
- `.dethernety/.models.lock` — the model registry's lock file
- `.dethernety/discovery-cache.json` — transient cache
- `*.backup-*/` — timestamped model-tree snapshots dropped beside the model directory by push and by backup-mode pull

**What `/dethereal:discover` recommends.** At the end of discovery, `/dethereal:discover` tells you that the server keeps this machine's records out of git, recommends `.gitignore` entries only for the files that are transient or local, and names the files that make up the model, which you commit. It does not recommend ignoring the whole `.dethereal/` directory.

**Note on the audit log.** `.dethereal/control-audit.log` records per-Control decisions — who, when, which Control and which attribute keys — as human-readable, line-oriented JSON. It never records an attribute value: in place of each value it keeps a short tag computed with a key that exists only on your machine. On that machine a tag tells you whether a value changed, or whether it is the same value as in another entry; anywhere else it tells nothing. The log stays on your machine and is not committed; the platform keeps the authoritative record of a push.

**If you have an older log.** A `control-audit.log` written by an earlier version may hold attribute values verbatim (entries without a `schemaVersion` field). Delete or rotate it. If it was committed, untrack it — adding an ignore rule does not untrack a file that is already committed:

```bash
git rm --cached .dethereal/control-audit.log
```

The old values remain in the repository's history.

Token storage (`~/.dethernety/`) is in your home directory, outside the repository — no gitignore entry needed.

Add to your `.gitignore`:

```gitignore
# sync.json, relay/ and the settlement files need no entry here:
# the server lists them in the model's .dethereal/.gitignore (see above)

# Control audit log (stays on this machine)
**/.dethereal/control-audit.log

# WAL journal (transient — replayed automatically)
**/.dethereal/pending-id-rewrite.json

# Lock and temporary files
**/.dethereal/*.lock
**/.dethereal/*.tmp.*
**/.dethereal/*.breaking
.dethernety/.models.lock

# Discovery cache (transient)
.dethernety/discovery-cache.json

# Timestamped model backups (push, and backup-mode pull)
*.backup-*/
```

### Git as the Undo Mechanism

Dethereal has no custom undo tool — git is the undo mechanism for file changes. When you want to revert changes:

- **Uncommitted changes:** `git diff` to see what changed, `git checkout -- <file>` to revert specific files, or `git stash push -- <file>` to save changes for later
- **Committed changes:** `git revert <commit>` to undo a specific commit

The plugin assists with git commands when you ask to undo, but it **never runs them** — it shows you the exact command, explains what it does and what will be lost, and you run it in your own terminal.

**Keep `.dethereal/` out of undo commands.** The model's workflow state lives there, and the server keeps it. Revert the model files instead. A `git revert` of a commit that changed `.dethereal/` restores those files too; the plugin tells you when that is the case.

**After an undo**, once you say the command ran, the plugin reads the model files again before anything else: they hold the restored values.

**Recommended commit points:**
- After model creation (`/dethereal:create`)
- After the session break (Step 5 — structure complete, before enrichment)
- After enrichment (`/dethereal:enrich`)
- After pushing to the platform (`/dethereal:sync push` — server IDs updated)

### Branching and Model Identity

Models carry a platform model ID in `manifest.json`. When you branch:

- Both branches reference the **same platform model**
- Pushing from either branch updates the same platform model
- Merging model file changes works like any JSON merge (git handles it)

Be aware that if two branches diverge significantly, pushing from one may overwrite the other's changes on the platform. The conflict detection mechanism helps, but it compares local-vs-platform, not branch-vs-branch.

### Reviewing Model Changes in PRs

Since models are plain JSON, model updates go through the same code review process as code changes. Reviewers can see exactly which components, flows, or attributes changed in the diff.

---

## Multi-Model Projects

### When to Decompose

The plugin recommends decomposition when a model exceeds complexity thresholds:

| Dimension | Threshold |
|-----------|----------|
| Components | 21+ |
| Trust boundaries | 9+ |
| Data flows | 36+ |
| Cross-boundary flows | 19+ |

This check runs after discovery is confirmed (Step 2), before anything is written to the model files. The recommendation is advisory — you can proceed with a large model.

### Scope Narrowing vs. Decomposition Plan

**Default recommendation: scope narrowing.** Start with the highest-risk subsystem (containing crown jewels). This produces one complete, analysis-ready model first and gets to value faster.

**If you described multiple systems:** the plugin offers a decomposition plan. This tracks multiple models upfront in `.dethernety/decomposition-plan.json`:

```json
{
  "models": [
    { "name": "API Layer", "path": "./threat-models/api-layer", "status": "complete" },
    { "name": "Data Platform", "path": "./threat-models/data-platform", "status": "in_progress" },
    { "name": "Auth Infrastructure", "path": "./threat-models/auth", "status": "planned" }
  ],
  "cross_model_links": [
    { "from_model": "API Layer", "to_model": "Data Platform", "description": "Database queries" }
  ]
}
```

### Cross-Model References

When one model references components from another model, it uses `representedModel` links. These are stub components that point to the detailed model:

- The stub is visible in the local model but marked as representing an external model
- Attack paths through these stubs are **not included** in the local model's analysis
- If the same credential appears in multiple local models, the attack surface analysis warns about cross-model credential reuse

### Discovery Cache Sharing

The discovery cache (`.dethernety/discovery-cache.json`) is shared across models in a project. When creating a second model in a decomposition plan, the plugin filters the cache to exclude components already assigned to the first model's scope.

---

**Next:** [Review and Analysis](REVIEW_AND_ANALYSIS.md) — quality review, attack surface analysis
