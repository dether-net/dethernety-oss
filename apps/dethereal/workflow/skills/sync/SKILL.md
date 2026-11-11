---
name: sync
description: Push the local model to the platform, pull a platform model, check sync status, or recover the control library
argument-hint: "push|pull|status|promote-external-edit|tombstone|repair-wal [directory-path]"
---

Synchronize a threat model between local files and the platform. The local files are authoritative for the model (structure, flows, attributes); the platform for what it computes (exposures, analyses). A push publishes; it is not a two-way sync.

{{include shared/core-rules.md}}

**Arguments:** {{args}}

| Verb | Runs |
|---|---|
| `push [directory]` | Push, below; then the control library in `sync-controls` |
| `status [directory]` | Status, below |
| `pull [model id or name]` | `sync-pull` |
| `promote-external-edit <control id> <class id>`, `tombstone <control id>`, `repair-wal [directory]` | `sync-controls` |

No verb, or an unknown one: show this table and stop.

**Handing over.** To run a verb in `sync-pull` or `sync-controls`, start that skill with the verb and its arguments plus what the step names, and do nothing else here:
{{#harness claude}}
- invoke the `Skill` tool with `dethereal:sync-pull` or `dethereal:sync-controls`. If it cannot be loaded, stop and tell the operator the sync companion did not load: run `/reload-plugins`, then {{cmd:sync}} again.
{{/harness}}
{{#harness codex}}
- open the `dethereal:sync-pull` or `dethereal:sync-controls` skill — its `SKILL.md` path is in your skill list — read it in full and follow it. If it cannot be read, stop and tell the operator to run {{cmd:sync}} again.
{{/harness}}
{{#harness opencode}}
- load the `dethereal-sync-pull` or `dethereal-sync-controls` skill with the `skill` tool and follow it. If it cannot be loaded, stop and tell the operator to run {{cmd:sync}} again.
{{/harness}}

Never run a companion's steps from memory.

{{include shared/model-resolution.md}}

## Push

{{include shared/push-flow-reference.md as-file}}

When a push is refused over its control references, or `clear ids` changes them, read the file below and follow it:

{{include shared/control-resolution.md as-file}}

{{include shared/push-flow.md}}

**After the push:** hand over to `sync-controls` with `push`, the directory, the model id and the push's counts. It pushes the control library and prints the footer. If the hand-over fails, say that the model was pushed and the control library was not. The `push-conflict` answer `pull`: hand over to `sync-pull` with the directory, the model id and `backup`; push nothing.

## Status

1. {{tool:workspace_status}} with `directory_path`, and {{tool:auth_status}} with `verify: true`.
2. Show the model name, state (`displayState` when present) and quality; the platform model id or "not pushed", the platform URL, and who is signed in; the last push and pull; the local state from `sync.status` (no local changes, local changes not pushed, never synced, or unknown with its `problem`); the control-library counts that are not 0 (a `journal` → {{cmd:sync}} `repair-wal`); referenced model ids. Never compute a hash yourself.
3. This machine's records, as the note below says, when the repository may track them.
4. `[next]` When you're ready: {{cmd:sync}} `push` when never synced, not pushed, or with local changes or control work; otherwise {{cmd:status}}.

{{include shared/per-machine-files.md}}
