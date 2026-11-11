---
name: sync-pull
description: The pull of sync — import a platform model into local files; start it with sync pull
argument-hint: "[model id or name] [directory-path]"
{{#harness claude}}
user-invocable: false
{{/harness}}
---

Pull a platform model into local files: the pull of {{cmd:sync}}, started by {{cmd:sync}} `pull`; its arguments: {{args}}. A push that met a conflict hands over here too, with the directory, the model id and `backup` already chosen.

{{include shared/core-rules.md}}

**The detail is in a file next to this skill:**

{{include shared/sync-pull-reference.md as-file}}

Read it before the first step, and again after any context compaction. If it cannot be read, stop and tell the operator — never pull from memory.

## 1. Sign-in

Call {{tool:auth_status}} with `verify: true`; not signed in → the core rules' sign-in question; on `skip`, stop the pull.

## 2. The platform model

Handed a model id: use it. A name in the arguments: use it only if exactly one platform model has that name. Otherwise call {{tool:list_models}}. None: "No models found on the platform." — suggest {{cmd:create}}, then {{cmd:sync}} `push`, and stop. Show them numbered (name, description), then:

{{#ask id=pull-model-choice text}}Which platform model? Give its number or id.{{/ask}}

## 3. The target directory

The directory argument, or the one handed over, or else `./threat-models/<kebab-case model name>/`. Call {{tool:workspace_status}} with `directory_path` set to it:

- `problem: absent` → pull.
- `problem: not_a_model`, or any other problem → stop and name it. Never pull into a directory that is not a model.
- `sync.platformModelId` set and not the chosen model: the directory holds another platform model. Stop: show both ids, and suggest `./threat-models/<kebab-case model name>/` or another new directory for the chosen model. Never pull over another platform model (the server refuses it too).
- `controlLibrary.journal`: stop before any export, and point to {{cmd:sync}} `repair-wal`.
- `sync.status: no_local_changes` and `controlLibrary` `pendingEdits`, `drift` and `unpushed` all 0 → pull. The content check does not cover `controls/`: a pull overwrites a control file's values that were changed by hand with no edit record; a control whose first push stopped part-way stays resumable and keeps the values it has not pushed yet.
- Anything else (local changes, never synced, unknown, control work not pushed): show what the tool reported, then — unless `backup` was handed over —

{{#ask id=pull-overwrite}}Local "<name>" has changes the platform does not have. Pulling will OVERWRITE the model files (a backup is taken first). (push first / backup / overwrite / cancel){{/ask}}

- `push first`: stop, and tell the operator to run {{cmd:sync}} `push` for this directory, then {{cmd:sync}} `pull` again. Nothing is pulled.
- `backup` or `overwrite`: pull. Both keep a backup, since the export always takes one.
- `cancel`: stop; nothing changed.

Never call {{tool:import_model}} or {{tool:update_model}} here.

## 4. Pull

1. {{tool:export_model}} with the model id, the directory and `if_exists: 'backup'` — always, never `update`. Note `backup_path`.
2. The control library files (reference): `pull-controls` for every referenced Control id. `WAL_REPLAY_FAILED`, `WAL_JOURNAL_REJECTED` or `MODEL_TREE_UNSAFE`: stop here, show the message, and point to {{cmd:sync}} `repair-wal` (for `MODEL_TREE_UNSAFE`: the operator fixes the named path; never delete or move files to get past it). Any other per-id error is a warning in the summary.
3. State: {{tool:model_state}} with `action: 'merge_pulled'` and the directory. Never write `state.json`.
4. Quality: {{tool:validate_model_json}} with `action: 'quality'`, `detail: 'summary'` and the directory. The tool records the result in `.dethereal/quality.json` itself (`quality_recorded`); never write that file. On `false`, show its warning and go on.
5. Registry: the export registered the directory in `.dethernety/models.json` (`registered`; reference); never write that file. On `false`, show its warning and go on.
6. Referenced models (reference): list them, and whether each is registered locally. They are not pulled.

## 5. Summary

The summary and its callouts (reference). The state line is what `merge_pulled` returned: its `state`, `display_state` and `note`. Say "inferred from content" only when the model had no state before.
