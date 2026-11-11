---
name: sync-controls
description: The control library of sync — push, promote-external-edit, tombstone, repair-wal; start it with sync
argument-hint: "push | promote-external-edit <control id> <class id> | tombstone <control id> | repair-wal [directory-path]"
{{#harness claude}}
user-invocable: false
{{/harness}}
---

The control library of {{cmd:sync}}: its push, and the three recovery verbs. Started by {{cmd:sync}}; its arguments: {{args}}.

{{include shared/core-rules.md}}

## What runs here

| Verb | Section |
|---|---|
| `push` — handed over by {{cmd:sync}} `push` after the model was pushed, with the directory, the model id and the push's counts | Control-library push |
| `promote-external-edit <control id> <class id>` | Promote an external edit |
| `tombstone <control id>` | Tombstone |
| `repair-wal [directory]` | Repair the recovery journal |

A control-library push runs only when handed over by a model push: started any other way, or for a model with no platform id, say so and tell the operator to run {{cmd:sync}} `push`. No verb, or an unknown one: show this table and stop.

Before any verb, call {{tool:auth_status}} with `verify: true`; not signed in → the core rules' sign-in question; on `skip`, stop.

{{include shared/model-resolution.md}}

**The detail is in a file next to this skill:**

{{include shared/control-library-push.md as-file}}

Read it before the first step, and again after any context compaction. If it cannot be read, stop and tell the operator — never push the control library from memory.

## Control-library push

1. **Gather.** Call {{tool:workspace_status}} with `directory_path`; `controlLibrary` counts what there is. `drift` above 0: render the pre-flight error (reference: Gather) and stop — no fetch, no push. `pendingEdits`, `unpushed` and `drift` all 0: print the plain footer and stop.
2. **Fetch.** One batched `pull-controls` (reference: Batched fresh fetch). If it fails, stop: nothing is pushed on stale ownership data.
3. **Classify** every touched control (reference: Classify per-control state).
4. **Decide.**
   - Alone, no conflicting keys: push without a question.
   - Exactly one control needs a decision, it is shared, has no conflicting keys and its ownership is known: show the single-control prompt (reference), then

     {{#ask id=shared-control}}This control is used by other models too: your change applies to all of them. (cancel / push-anyway){{/ask}}

   - Anything else (two or more to decide, any conflicting key, unknown ownership): show the review screen (reference), then repeat until the operator types `done`:

     {{#ask id=shared-control-review text}}Give your decisions with the verbs above, one or more per message; type done to push.{{/ask}}

     Show the decision table and the `done` before any push.
5. **Push** each decided control with `push-brownfield` (reference: Apply decisions); report what the tool returned.
6. **Greenfield** controls (reference: Greenfield). One with no supporting elements:

   {{#ask id=greenfield-no-elements}}Greenfield control "<name>" has no supporting elements: it would be created with no SUPPORTS edges. Continue anyway? (continue / skip){{/ask}}

7. The audit-log note once, then the combined footer (reference).

## Promote an external edit

For a control whose local `attributes` diverge from `platformAttributes` with no `pendingEdit`: the push refuses it until the divergence is promoted to a pending edit. Promoting does not re-pull.

1. Both ids are required; otherwise show the table and stop.
2. Read `controls/<control id>.json`. Absent: tell the operator to run {{cmd:enrich}} `--focus controls` to pull it, and stop. Find the class entry whose `classId` matches and note its 0-based index; none matches: list the class ids and stop.
3. Show every diverging key, platform value → local value. This is what the next push publishes. Then:

   {{#ask id=promote-confirm}}Record these local values as your edit, to be pushed next time? (promote / cancel){{/ask}}

4. On `promote`: {{tool:manage_controls}} with `action: 'promote-external-edit'`, `directory_path`, `control_id`, `class_idx`. `NO_DIVERGENCE`: nothing to promote; say so.
5. `[done] Promoted the external edit on <control id> [class <class id>].` `[next]` When you're ready: {{cmd:sync}} `push`. The audit entry of that push records `editedBy: external`.

## Tombstone

Marks a control `tombstoned` locally; the platform Control is not deleted (that is done in the platform's interface).

1. Read `controls/<control id>.json`; absent: "Control <id> not found locally. Nothing to tombstone." and stop.
2. Show the control's name and lifecycle, then:

   {{#ask id=tombstone-confirm}}Mark "<name>" tombstoned? It is left out of pushes, but a later pull brings it back while the model still references it — remove the reference to retire it for good. (tombstone / cancel){{/ask}}

3. On `tombstone`: {{tool:manage_controls}} with `action: 'tombstone'`, `directory_path`, `control_id`. Report: lifecycle → tombstoned; a pending edit, if any, is kept.

## Repair the recovery journal

1. Call {{tool:manage_controls}} with `action: 'inspect-wal'`. `present: false`: "No recovery journal. Nothing to repair." and stop.
2. Show every operation in a code block (reference: Rendering journal data): ids, the two control files with present or absent, each file's rewrite state, `ambiguous`. Say whether the journal is `verified`, and list `rejected` codes.
3. Ask:

   {{#ask id=repair-wal-choice}}How to recover the journal? cancel keeps it; retry replays it, only after you resolved an ambiguous file pair by hand; clear deletes it and leaves the files for you to reconcile. (cancel / retry / clear){{/ask}}

   `verified: false` or `rejected` not empty: this machine did not write it for this model — it is never replayed. Offer cancel or clear only; `retry` is refused and the question asked again.
4. `cancel`: the journal stays; stop. `retry`: inspect again first, then {{tool:manage_controls}} `pull-controls` with `control_ids: []` (it replays on entry); at most twice, then only cancel or clear. `clear`:

   {{#ask id=clear-journal-confirm text}}Deleting the journal leaves the control files and references as they are, for you to reconcile. Type clear-journal to confirm; anything else cancels.{{/ask}}

   Only the exact text `clear-journal` deletes, with `action: 'clear-wal'`. Then suggest checking that exactly one of `controls/<tempId>.json` and `controls/<serverId>.json` exists and that no reference still holds the temp id; the platform Control created before the journal stays.
5. `MODEL_TREE_UNSAFE` at any step: show its message and stop; never delete or move files to get past it.
