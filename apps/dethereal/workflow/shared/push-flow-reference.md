## Push Flow Reference

The detail behind the Push Flow's steps; it holds no questions. Read it before the push and again after any compaction.

### Sync record

The pull and push tools write `.dethereal/sync.json` themselves: never write or rebuild it by hand. It holds the ids of the last sync and the signed record of the platform model the push checks, which no hand-written file can carry. When it is missing but `manifest.model.id` is set (e.g. a fresh clone), push anyway: the server refuses with `PLATFORM_CHANGED_SINCE_SYNC` and `baseline: missing`, listing every platform element, and the Push Flow's platform-changes step handles it. Never pull only to get the file back: a pull overwrites the local model.

What the push would delete on the platform — elements there that the local model does not hold — comes from the same refusal: its `added_on_platform` rows. Boundaries among them matter most: deleting a boundary has cascading structural consequences, so name them first. Never export the platform model to diff it yourself.

### Execute the push

**First push** (no `manifest.model.id`):
- Call {{tool:import_model}} with `directory_path`
- The tool handles: ID mapping (writes server UUIDs back to local files), sync.json creation

**Update** (has `manifest.model.id`):
- Call {{tool:update_model}} with `directory_path` and `delete_orphaned: true`
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
- **Local-only asset notice:** {{tool:import_model}} / {{tool:update_model}} may warn that crown-jewel marks on non-component elements (data items, boundaries, flows) were not synced — the platform tracks crown jewels on components only. Surface it verbatim when present.
