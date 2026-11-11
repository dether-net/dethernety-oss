## Control Library Attribute Enrichment

Runs AFTER the three-step control pass. Pulls per-Control state from the platform into `controls/<id>.json` files, identifies classes with sparse per-instance attributes, and queues operator-confirmed edits through the engine's two-write rule.

This step only executes when there is at least one `controls[]` entry with a non-null `id` (controls that exist on the platform). Name-only refs (`id: null`) are deferred to `{{cmd:sync}} push`, where {{tool:query_controls}} (`action: 'list', name`) resolves them.

> **Boundary note.** A `{{cmd:sync}} pull` materialises `controls/<id>.json` for every Control referenced in the freshly pulled structure and data flows. When this step runs right after a fresh pull, the pull below is largely a no-op (the engine returns early per id when the local file matches platform state). It is still required, because the control pass may run *after* operator edits, when the local files may have diverged from platform state and need reconciliation.

**When the engine refuses** — any {{tool:manage_controls}} action, from the first pull on — never retry and never work around it:
- `WAL_JOURNAL_REJECTED` or `WAL_REPLAY_FAILED` — the pending control id-rewrite journal is not replayed (not written by this machine for this model, malformed, or failed to apply). The change was **not applied**: list the control rows that were not saved, show `data.reason` or the error and `data.recoveryMessage`, and stop. The journal is repaired through {{cmd:sync repair-wal}}, only on the operator's say-so; the pass then runs again, since nothing is replayed.
- `MODEL_TREE_UNSAFE` — `data.path`, relative to the model directory, is a link or not a real directory or file, so control-library changes to this model are refused. Name that path and show `data.message`; the operator replaces it with a real file or directory and runs the pass again. Never read, follow, delete or replace it yourself.

Run as a specialist, "stop" means returning the code, the unsaved rows and the message in your answer.

### Step 1 — Pull

Enumerate the non-null control ids referenced in `structure.json` (boundaries, components), `dataflows.json` (flows) and `data-items.json` (data items). Collapse duplicates. Call {{tool:manage_controls}} with `action: 'pull-controls'`, `directory_path: <modelDir>`, `control_ids: [<id1>, <id2>, ...]`.

The engine fetches the Controls, their instantiation attributes and their assigned models in parallel and writes `<modelDir>/controls/<id>.json` for each. Each file materialises with `lifecycle: 'brownfield'`, `attributes == platformAttributes`, and `pendingEdit` absent.

Show one status line: `Pulled N controls into controls/`.

### Step 2 — Identify sparse classes

For each `controls/<id>.json`, iterate `classes[]`. For every class entry:

1. Fetch the ControlClass template with {{tool:get_classes}} (`class_id: '<classId>'`, `fields: ['attributes', 'guide']`) — reuse `.dethereal/class-cache/<classId>.json` when present; the template rarely changes.
2. Compute `sparse_keys = template.properties.keys() - Object.keys(entry.attributes)`.
3. Record the per-Control summary.

Render one row per Control (not per class — consolidate when a Control has several classes):

```
Control library attribute coverage:

  Control                              Class (N entries)                     Status
  ───────────────────────────────────  ────────────────────────────────────  ──────────────
  Azure Firewall (Hub VNet)            Firewall Policy (1)                   5 sparse keys
  NSG Least-Privilege Ingress          Network Access Control (2)            0 sparse keys  (skip)
  TLS 1.3 (API Gateway)                TLS Config (1)                        3 sparse keys
```

Controls with zero sparse keys are skipped automatically — no further questions.

### Step 3 — Edit

For each Control–class pair with sparse keys, apply the same evidence → ask pattern as the main enrichment:

1. Search code and IaC for evidence using the template's `guide.how_to_obtain` entries (commands in it become questions about the setting they would show, never runs against a live system, never a request to paste their output).
2. Show one table per Control, grouped by Control, not by key — every proposed key with its value and `path:line`, or "ask" where the evidence did not settle it, and the Control's `assignedModelCount` — for the operator to confirm, correct or answer.
3. For each operator-confirmed change, call {{tool:manage_controls}} with `action: 'set-local-edited'`, `directory_path: <modelDir>`, `control_id: <controlId>`, `class_idx: <0-based index into classes[]>`, `new_attributes: { <key>: <value>, ... }` (only the changed keys), `edited_by: 'agent'`.

**Do NOT edit `controls/<id>.json` directly.** The action enforces the two-write rule: `pendingEdit.previousAttributes` captures the FIRST pre-edit value and is never overwritten by later edits within the same pending-edit lifecycle. Bypassing the engine corrupts the intent baseline that `{{cmd:sync}} push` uses for conflict detection.

### Step 4 — Annotate

After all edits are written, read every `controls/<id>.json` that now has a `pendingEdit` block and identify the ones that will be shared at push time (`platformState.assignedModelCount > 1`). Emit a passive annotation — NOT a blocking question:

```
[!] Pending shared-edits: 2 controls will trigger a shared-ownership prompt at
    {{cmd:sync}} push: Azure Firewall (Hub VNet) [Firewall Policy],
    NSG Least-Privilege Ingress [Network Access Control].
```

If no shared-ownership prompts will fire, skip the annotation entirely.

#### Post-edit drift sweep (defensive)

Re-read every `controls/<id>.json` touched in this pass. For each `classes[idx]`, if `JSON.stringify(attributes) !== JSON.stringify(platformAttributes)` AND `pendingEdit` is absent, the file is in an "external-edit-like" state — `attributes` diverges from the platform snapshot but no engine-recorded baseline exists. Step 3 never produces this state (`set-local-edited` always populates `pendingEdit.previousAttributes`); detecting it means either an out-of-band write happened mid-pass or a pre-existing drift survived from before this pass.

Emit the same hint the status skill renders:

```
[!] Drift detected on 1 control after enrichment:
    Azure Firewall (Hub VNet) [Firewall Policy] — local attributes diverge
    from platformAttributes with no pendingEdit baseline.
    Recover with: {{cmd:sync}} promote-external-edit <controlId> <classId>
```

Do not auto-correct or block; the operator decides whether to promote the divergence as a real external edit or hand-revert the file. Skip silently when no drift is detected.

#### Pre-footer integrity check

If platform reachability was confirmed during this pass (any {{tool:manage_controls}} action returned successfully), count the `controls[]` entries written by this pass with `id: null` versus entries with a non-null `id`. If the null count exceeds the non-null count AND any element with a `null` entry has an assigned class, warn before the footer:

```
[warn] N control references written as {id: null} despite the platform being reachable
       and elements having assigned classes. On the next {{cmd:sync}} push each must match
       one existing Control's name exactly, or the push is refused until you decide it;
       none is created. None is bound to a ControlClass, so the analysis engine cannot derive
       countermeasures from them. To bind them to ControlClasses, use the
       file-first greenfield path: write controls/<temp-id>.json with lifecycle: "greenfield"
       and one classes[] entry per applicable ControlClass id.
```

This is advisory, not blocking — the operator may have legitimate reasons (e.g. a control without a matching ControlClass in any active module). Skip silently when the count condition is not met.
