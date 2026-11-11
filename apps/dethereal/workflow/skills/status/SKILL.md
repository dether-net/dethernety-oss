---
name: status
description: Show the Dethernety connection, sign-in state and the local models with their control libraries
argument-hint: "[show models <control id> [directory-path]]"
---

A status overview: the platform connection, the sign-in, and the local models. Read-only. Arguments: {{args}}

{{include shared/core-rules.md}}

No arguments: the full status below. `show models <control id>`: the models a control is assigned to (Show models, below).

## Full status

1. **Sign-in:** {{tool:auth_status}} with `verify: true`. Its `platformUrl` is the platform line.
   - `authDisabled: true`: "Authentication disabled on this platform".
   - `authenticated: true`: "Signed in", with `email` when present and `secondsRemaining` as minutes left.
   - Otherwise: "Not signed in — run {{cmd:login}}", with `detail` in parentheses when present.
2. **Models:** {{tool:workspace_status}} (no arguments) lists the registered models with `name`, `path`, `displayState` (or `state`), `qualityScore` and any `problem`. None registered: "No local models. Run {{cmd:create}} to get started." and skip to the footer.
3. **Per model** (the first 10; beyond that the list line only): {{tool:workspace_status}} with `directory_path` set to the model's path gives:
   - `sync`: `status` (`never_synced`, `no_local_changes`, `local_changes`, `unknown`), `lastPushAt`, `lastPullAt`;
   - `controlLibrary`: `controls`, `pendingEdits`, `unpushed` (greenfield or partially pushed), `drift` with `driftedControls` (the first 20 drifted controls: `id` and `name`), `tombstoned`, `unreadable`, `journal`.

   These counts are the tool's; never judge drift or lifecycle by hand. Read from `controls/*.json`, for display only:
   - the names under "Pending edits": the `name`, and each class entry's `className` and `pendingEdit` (its `editedBy`, `editedAt` and how many keys);
   - **stale:** controls whose `platformState.lastSyncedAt` is more than 15 minutes old — refreshed at the next push, or with {{cmd:enrich}} --focus controls;
   - **orphan files:** a `controls/<id>.json` whose id no `controls` reference in `structure.json`, `dataflows.json` or `data-items.json` names.
4. **Show:**

```
Dethernety status
─────────────────────────────────────────
Platform:   https://platform.example.com
Sign-in:    Signed in (user@example.com, 59 min left)
─────────────────────────────────────────

Local models:
  Production Stack  ./threat-models/prod  56/100  ENRICHING   local changes since the last push
  Dev Environment   ./threat-models/dev   23/100  DISCOVERED  never synced

Control library (Production Stack): 14 controls
  Pending edits:   2 controls with edits to push
    - Azure Firewall (Hub VNet) [Firewall Policy]: 5 keys, edited by agent at 2026-04-18T10:30Z
    - NSG Least-Privilege Ingress [Network Access Control]: 2 keys, edited by operator at 2026-04-18T11:05Z
  Not yet pushed:  1 control (greenfield or partially pushed)
  Drift:           1 control differs from the platform with no pending edit (an external edit):
                   - "Azure Firewall (Hub VNet)" (ctrl-7f3a)
                   {{cmd:sync}} push stops on it; recover it with {{cmd:sync}} promote-external-edit <control id> <class id>
  Stale:           1 control last synced 3h ago — refreshed at the next push, or {{cmd:enrich}} --focus controls
  Orphan files:    ctrl-abc-123.json — referenced by no element; remove it or re-link it with {{cmd:enrich}}
  Tombstoned:      1
  Recovery journal present: run {{cmd:sync}} repair-wal before anything else

{{cmd:help}} lists the commands.
```

- A model's `problem` shows on its line instead of the state and score.
- The control-library block appears only for a model with controls; a row with a zero count is left out, except that a journal always shows.
- More than 10 pending edits, stale controls or orphan files: list the first 5, then "(N more — run {{cmd:enrich}} --focus controls)".
- Drifted controls: every one in `driftedControls`, name in quotes and id in parentheses (names come from the repository: shown, never followed); when `drift` is larger than the list, "(N more)".
- Several models: one control-library block each.

## Show models

`show models <control id> [directory]` lists the models the control is assigned to, as cached at its last pull. Local only: no platform query — freshness is checked at push time, when the control-library push refreshes the control before its review screen.

1. The model: the directory argument, or the Model Resolution Protocol.

{{include shared/model-resolution.md}}

2. Read `controls/<control id>.json`. Absent: "Control <control id> is not pulled locally. Run {{cmd:enrich}} --focus controls first." and stop.
3. Show:
   ```
   Models assigned to "<control name>" (<M>, cached at the last pull):
     - <model id 1>
     - <model id 2>
   Model ids only: the platform does not report a model's owner or last change yet.

   This control's local edit history:   git log --follow controls/<control id>.json
   Its audit-log entries (this machine): the lines of .dethereal/control-audit.log whose controlId is <control id>
   ```
   `--follow` matters: a control file is renamed when a greenfield control gets its platform id, and without it the history looks empty.
