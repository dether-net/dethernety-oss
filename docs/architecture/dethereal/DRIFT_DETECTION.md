# Drift Detection

## Purpose

Catches threat-model drift that arises when infrastructure code (Terraform, Kubernetes manifests, application code) is edited without a corresponding model update.

## Workflow

1. Operator edits IaC / app code inside a git repo that also contains the threat model.
2. Before opening the PR, the operator runs `/dethereal:threat-model`.
3. The skill detects which in-scope files changed since the last reconcile.
4. The scoped scout re-discovers the elements in the changed files; the orchestrator compares them with the prior discovery and builds a proposed model delta (removed / added / reclassified / attribute-changed elements, plus changed secret files), leaving out the items an earlier, stopped pass already applied.
5. The operator resolves each delta item: removals and additions through the existing `/dethereal:remove` / `/dethereal:add` flows, a substrate change and a changed secret file through their own drift questions, and an attribute-only change by queueing the element for enrichment.
6. The model is updated locally; `/dethereal:sync push` ships it to the platform when the operator chooses.

## Scope

### In scope

- Detect drift between the last reconciled state and the current git working tree.
- Translate detected drift into a proposed model delta via the scoped scout.
- Route the delta through existing modeling skills and two drift questions of its own.

### Out of scope

- **Live-source reconciliation.** Continuously reconciling against running K8s clusters, AWS accounts, or GCP projects is a different product — continuous infra observability, not threat-modeling-time validation.
- **Multi-operator concurrency.** Threat modeling is a single-operator activity by nature; the design assumes one operator at a time reconciling a given model. No advisory locks, no cross-host coordination.
- **Non-git workflows.** Drift detection requires a git repo. Outside one, discovery records no baseline, so the resume skips drift; `detect_drift` itself refuses a non-git folder with a hint recommending `git init`.

## Detection

### Mechanism

Drift is the set of files committed since `$lastReconcileCommit`, unioned with the staged, unstaged and untracked ones, each listing limited to the discovery globs from [`source-globs.ts`](../../../apps/dethereal/src/utils/source-globs.ts). The listing, the filter and the union happen inside the `detect_drift` MCP tool ([`detect-drift.tool.ts`](../../../apps/dethereal/src/tools/detect-drift.tool.ts)), which reads the repository only and never contacts the platform.

The repository is treated as untrusted input: git runs through a hardened runner, the baseline must be a full commit id, and the returned paths are filtered (names with control or invisible characters, or over-long names, are left out and counted as `omitted`) and capped (`truncated`). `git status` is never run, because it refreshes the index; without that refresh a file whose timestamps changed but whose content did not is still listed — drift over-reports, never misses.

In a git-controlled directory, git already tracks every file in the working tree (committed + dirty + untracked). The operator can audit any drift the same way they audit any other change — `git log` / `git diff` against the baseline SHA. No parallel detection layer is needed.

### Pseudocode

```
# Resume (Drift Orchestration Protocol)
if model_state get shows no baseline_commit:
  skip drift logic silently; go to the step cursor

# detect_drift (the tool), in order
if the model directory is outside the project or missing:
  refuse — outside-root / not-found
if state.lastReconcileCommit is missing or not a full commit id:
  refuse — missing-baseline / invalid-baseline
if not in a git repo (or git cannot be used safely):
  refuse — not-a-git-repo / git-unavailable / unsupported-repository
if lastReconcileCommit is not an ancestor of HEAD:
  # Either history was rewritten past the baseline, or the operator
  # is on a branch whose ancestry doesn't include lastReconcileCommit
  # (branch switch). Both resolve via re-baseline.
  refuse — ancestry-broken

changed = git diff-tree -r --name-status -z -M -C $lastReconcileCommit HEAD
staged  = git diff-index --cached --name-status -z -M HEAD
dirty   = git diff-files --name-only
new     = git ls-files --others --exclude-standard
scoped  = (changed ∪ staged ∪ dirty ∪ new), each listing limited to source-globs
          # every path named; both paths of each rename (R) and copy (C)
renamed = R pairs { from, to } from changed and staged
copied  = C pairs { from, to } from changed
          # pairs sorted by to, then from; kept only when both paths are in scoped

return { baseline, scoped, renamed, copied, omitted?, truncated?, note? }
  # scoped is the file set the scout sees (unsafe names omitted, capped);
  # note is set whenever omitted or truncated is
```

**Renames and copies.** With `-M` (and `-C` on the commits), git reports a rename or copy as one record naming both paths. `detect_drift` lists both paths in `scoped`, so a file moved away from what discovery read still counts as drift, and returns each record as a `{ from, to }` pair in `renamed` or `copied`. Both arrays are always present (possibly empty), sorted by `to` and then `from`, and de-duplicated. Renames come from the commits since the baseline and from the index; copies come only from the commits (git's `-C` finds a copy whose source changed in the same range). An unstaged move is a deletion plus a new file, not a pair. A pair is reported only when both of its paths are listed in `scoped`: a name omitted as unsafe or cut by the cap drops its pair too.

The pairs do not decide element identity — the name does (see §Element identity). The orchestrator uses them to mark a REMOVED + ADDED couple that may be one renamed element, to turn a copy into an ADDED item, to ask about a renamed secret file once rather than once per path, and to move the recorded source paths in `discovery.json` onto the new path when the reconcile completes.

### Refusals

| Condition | Behaviour |
|---|---|
| Working tree is not a git repo | Refuse with `not-a-git-repo`; the hint recommends `git init`, `git add .` and an initial commit. A model whose discovery ran outside git has no baseline, so the resume skips drift before this point |
| `state.lastReconcileCommit` absent | Drift is skipped silently; the resume goes on to the step cursor. No hint is shown |
| Baseline is not an ancestor of HEAD | Refuse with `ancestry-broken`; the hint says to re-baseline (covers both history-rewrite and branch-switch cases) |
| `.dethereal/discovery.json` absent (a model created from a description) | Drift is skipped with a one-line note that there is no prior discovery provenance and that discovery sets a baseline |
| The scoped scout cannot be started, or returns without doing the work | Stop and tell the operator; the work is never done in its place. A scout cut off by its turn limit is started once more with only what is left; cut off again, stop and tell the operator. The baseline is not advanced, so the next attempt starts from the same baseline |
| The file list is incomplete (`omitted` or `truncated`) | Say so before the delta; never report "no drift"; after the reconcile, leave `discovery.json` and the baseline where they are |

`detect_drift` returns each refusal as a code (`not-a-git-repo`, `missing-baseline`, `invalid-baseline`, `ancestry-broken`, `outside-root`, `not-found`, `git-unavailable`, `unsupported-repository`, `git-failure`) with a one-line hint. The orchestrator shows the error text, the code and the hint, leaves the baseline untouched and stops drift logic; the operator's next move is what the hint says.

### State surface

`state.json.lastReconcileCommit: <SHA>`. `state.json` belongs to the MCP server: prompts read it through the `model_state` tool (`action: 'get'`, which reports the field as `baseline_commit`) and change it only through that tool — never by editing the file. The tool writes the baseline two ways: `action: 'set_baseline'` (with no `commit`, or `commit: 'HEAD'`), and a `transition` that carries `commit`, which records it in the same write as the state change. An explicit `commit` is `'HEAD'`, which the server reads, or a full commit id, 40 or 64 hex characters, that is an ancestor of HEAD — never a short id or another ref. The workflow has two writers, below; each records HEAD, through `set_baseline` or the transition it makes at that step.

- **Initial baseline.** The [Discovery Orchestration Protocol](../../../apps/dethereal/workflow/shared/discovery-protocol.md) step 13 — run by `/dethereal:discover` and by the build step of `/dethereal:threat-model` — sets the baseline at the end of discovery. This establishes the baseline for the first time. Re-running `/dethereal:discover` on an existing model overwrites the field — that's the explicit re-baseline path.
- **Subsequent advances.** The [Drift Orchestration Protocol](../../../apps/dethereal/workflow/shared/drift-protocol.md) step 16, on the `/dethereal:threat-model` resume path, advances the field at the end of a successful drift-loop reconcile (after every delta item resolves and the scan was complete; see §"Crash safety and idempotency" for why the advance is deferred to loop-end rather than per-item).

That is the only persisted detection state. What the next pass compares against is `.dethereal/discovery.json`, the discovery provenance: the same step brings it up to date just before it advances the baseline (see §"Crash safety and idempotency").

In a non-git folder, the server refuses the baseline write with `not_a_git_repo` (or `no_commits`, `git_unavailable`, `unsupported_repository`, `git_failure`); when that write was the transition, nothing was written, and the workflow repeats the transition without `commit`. The workflow then skips the baseline, says why, and never retries through a shell. With no baseline, drift detection is skipped silently on resume until the operator re-runs discovery in a git repo.

The field is documented in the State Management section of [`guidelines-core.md`](../../../apps/dethereal/workflow/shared/guidelines-core.md) alongside the other state-file fields. `validate_model_json` does not validate `state.json`, only the model-data files.

**Other server writes of the file never touch this field.** When a push mints platform IDs for locally created elements, the server re-keys `state.json`'s `staleElements[]` onto the new IDs — see [THREAT_MODELING_WORKFLOW.md §Methodology State Machine](THREAT_MODELING_WORKFLOW.md#methodology-state-machine). State changes keep every key they do not own, so `lastReconcileCommit` survives them untouched. The drift baseline is therefore still the two writers above, and still the only persisted detection state.

## Reconciliation

### Mechanism

The scoped scout re-discovers the elements in the allowlisted files; the orchestrator computes the delta and routes each item to a modeling skill or one of its own drift questions.

```
if drift detected (scoped non-empty):

  priorElements_in_scope = discovery.json elements with at least one
                           sources[].file in scoped (secret files excluded)
  allowlist = scoped + one-directory-level siblings, minus secret files
              and symbolic links
  scout(allowlist, mode=`discover elements`)  →  newElements
  drop any returned source outside the allowlist

  delta = join(priorElements_in_scope, newElements) on suggestedName:
    REMOVED                = prior element, no name match in newElements
    ADDED                  = newElements entry, no name match in prior
    CHANGED-substrate      = name match, suggestedClass.id or
                             suggestedComponentType differs
    CHANGED-attribute-only = name match, same type and class, attribute
                             file content changed
    changed secret file    = a secret file in scoped (never read);
                             one item per renamed pair, not per path
    # a renamed element on a renamed pair: REMOVED and ADDED both noted (renamed from → to)
    # a returned element on a copied pair's new path: also ADDED, noted (copied from → to)

  # Drop what a stopped pass already applied (checked against the model files):
  drop REMOVED                whose model element no longer exists
  drop ADDED                  whose name already names a model element
                              (a CHANGED-substrate item if its type or class differs;
                              a (copied …) item is never dropped)
  drop CHANGED-attribute-only whose element is already stale
  skip REMOVED / CHANGED      whose discovery.json entry is confirmed: false

  # Pre-loop summary so per-item prompts aren't a surprise mid-loop:
  surface "<R> removed (<C> crown-jewel-tagged), <A> added, <S> reclassified,
           <T> attribute-changed (<P> partial-evidence),
           <K> secret files changed (not read), <D> already applied since <baseline>"
  # the (<P> …), <K> and <D> clauses are left out when zero;
  # each dropped REMOVED item is then named

  for each item in delta:
    REMOVED                → suggest /dethereal:remove <id>  (crown-jewel confirm lives there)
    ADDED                  → suggest /dethereal:add <name>   (the add skill confirms the class)
    CHANGED-substrate      → match_classes on the new file content →
                             already the proposed class? say so, ask nothing;
                             else drift-reclassify (reclassify / keep)
    CHANGED-attribute-only → queue the element as stale (no question);
                             suggest /dethereal:enrich --pick <id>
    changed secret file    → drift-secret-file (free text)

  on completion (every item resolved and the scan complete):
    update discovery.json (renamed paths, matched entries, applied and dropped items)
    model_state set_baseline (the server records HEAD)
```

### Drift questions

The orchestrator routes removals and additions to the existing modeling skills, so the operator sees the same confirmations there as when authoring a model. It asks two questions of its own:

| Question | Asked for | On the answer |
|---|---|---|
| `drift-reclassify` — "Reclassify `<element>` from `<current class>` to `<proposed class>`? (reclassify / keep)" | A CHANGED-substrate item, after `match_classes` runs on the new file content (never a secret file's) with the active modules — unless the element already has the proposed class (applied before a stop), which is said in one line with no question | `reclassify` writes the new `classData` to `structure.json`, registers it, queues the element as stale (`model_state` `action: 'stale'`) and suggests `/dethereal:enrich --pick <id>`. `keep` resolves the item with no write |
| `drift-secret-file` — "`<file>` changed (not read). Was a credential added, removed or re-scoped?" (free text) | A changed secret file, shown with its class and the elements that reference it | Named elements are queued as stale and `/dethereal:enrich --focus credentials` is suggested. "No change" (a rotated value) resolves the item |

A CHANGED-attribute-only item gets no question: the element is queued as stale (enrichment takes stale elements first) and `/dethereal:enrich --pick <id>` is suggested.

An item is resolved when it is applied, declined (in the remove or add skill, or with `keep`), queued as stale, or answered at `drift-secret-file`. A suggested command the operator has not run leaves its item open, and the baseline does not advance.

### Secret files and partial evidence

The scoped scout is read-only and cannot tell a secret file from its content without reading it, so the orchestrator filters the allowlist before delegating:

- **Secret files are never read.** After the sibling expansion, and again whenever the scout asks for more paths, the orchestrator removes every secret file (in any letter case), every Secret manifest found by a name-only search, every file a compose or kustomization file names as a secret source, and every symbolic link or path reached through one. The removed files are passed to the scout as "present, not read".
- **Elements backed only by secret files are not re-verified.** A secret-file source never counts toward `priorElements_in_scope`. An element whose in-scope sources are all secret files is tagged `partial-evidence` and is never REMOVED.
- **A changed secret file is its own delta item** (see `drift-secret-file` above), counted in the summary as `<K> secret files changed (not read)`. A renamed secret file is one item, not one per path.
- **Returned sources are checked.** A returned source outside the allowlist is dropped; an element left with no source is dropped, and the operator is told which file the scout cited.
- **Partial evidence.** When a matched element's prior sources include paths outside the extended allowlist (`scoped` plus one-directory-level siblings), its delta item is tagged `partial-evidence`. The summary counts these separately, and each per-item prompt says the proposal may be incomplete because out-of-scope sources were not re-read.

### Orchestration

**Skill composition is prose-driven.** The harnesses have no "skill calls skill" primitive. The orchestrator is the Drift Orchestration Protocol, written once in [`workflow/shared/drift-protocol.md`](../../../apps/dethereal/workflow/shared/drift-protocol.md): the generator ships it as a file beside the [`/dethereal:threat-model` skill](../../../apps/dethereal/workflow/skills/threat-model/SKILL.md), read on a resume. The [threat-modeler agent](../../../apps/dethereal/workflow/agents/threat-modeler.md) does not carry it: asked to reconcile drift, it names `/dethereal:threat-model` and stops. The model walking that prose calls MCP tools (`detect_drift` for the file list, `model_state` for the state, the baseline and the stale queue, `match_classes` for substrate-flip re-classification), the harness's file tools for the model files, delegates the re-verification to the [scoped scout](../../../apps/dethereal/workflow/agents/infrastructure-scout-scoped.md), and suggests other slash-commands as the prose instructs. The model — not a runtime — drives sequencing. This is the same pattern every other skill on the plugin uses.

### Element identity

A prior element and a re-discovered element are the same when their `suggestedName` matches — the same key discovery uses. Only the prior elements with at least one source in `scoped` take part in the join; an element whose sources are all outside `scoped` is unaffected by the diff.

- **Renamed file.** A `renamed` pair puts both paths in `scoped`, so an element whose source was the old path is re-verified against the new one. If it keeps its name, it matches: the move makes no delta item, the model element is untouched (its crown-jewel tag and attributes included), and the reconcile records the new path in `discovery.json`.
- **Renamed file and renamed element.** When the element's name changed too, the join yields a REMOVED item (source on the old path) and an ADDED item (source on the new path). Both carry the note `(renamed <from> → <to>: may be one element under a new name)`, so the operator can decline both.
- **Copied file.** A copy is new evidence, not a move. When a returned element has a source on a `copied` pair's new path and its matched prior entry has none there, the copy also makes an ADDED item, noted `(copied <from> → <to>: a second instance, or the same element?)`; the add skill's confirm decides.
- **Unstaged move, split, consolidation.** No pair is reported, but every file involved is in `scoped`, so an element that keeps its name still matches. An element whose name changed shows as REMOVED + ADDED without a note.

**Known limits.**

- Elements are identified by name only. Nothing else (type, class, source path, content) links a prior element to a re-discovered one.
- A `keep` answered to a reclassification found through the baseline-module caveat (§Substrate / classification changes) is asked again on a later pass that touches the file: the reconcile records the scout's class for the element, which is still the baseline class, so the next pass forces `match_classes` again.
- A renamed file whose element was also renamed, with both items declined, is proposed again on later changes to that file, without the rename note: the declined REMOVED entry stays in `discovery.json` (under the new path), the declined ADDED entry is not recorded, and the later diff has no `renamed` pair.

### Substrate / classification changes

A substrate flip (e.g. Terraform module previously `managed-cloud:eks-managed-nodes`, now `managed-cloud:eks-fargate`) is **not** an enrichment update — it's a different threat surface (node-level controls vs. Fargate-managed). The orchestrator branches `CHANGED` on `suggestedClass.id` *or* `suggestedComponentType` inequality and routes substrate flips through `drift-reclassify` (§Drift questions) before re-enriching. Pure attribute changes queue the element as stale and suggest `/dethereal:enrich --pick <id>`.

The substrate re-classification matches against the active modules only (every installed module when `activeModules` is absent). When the only fitting class is in an inactive module, the orchestrator shows it as a note (the module and its class) and asks nothing. That class is never proposed, and a drift reclassification never adds a module.

When both prior and new sides resolve to the same baseline (`dethernety-general`) class, class-id equality is not proof of substrate equivalence. In that case the orchestrator forces a `match_classes` call against the new file content and uses its output as the comparison source. Documented as a runtime predicate in the [Drift Orchestration Protocol](../../../apps/dethereal/workflow/shared/drift-protocol.md) step 11.

### Crash safety and idempotency

Each item is written to the model files when it is applied — by the routed `/dethereal:add`, `/dethereal:remove` or `/dethereal:enrich`, or by the `drift-reclassify` write — so an applied item stays in the model if the session stops. `.dethereal/discovery.json` and `state.lastReconcileCommit` change **only after every delta item is resolved and the scan was complete** — not per-item. Then, in this order, the orchestrator:

1. brings `discovery.json` up to date with its edit tool, so the next pass compares against what this one saw: sources on a renamed pair's old path take the new path; a matched element's entry takes the returned type, class and sources (keeping its sources outside the allowlist and its `confirmed`); an applied REMOVED item's entry is dropped and a declined one stays; an applied ADDED item is recorded with `confirmed: true` and a declined one is not recorded, so it is proposed again when its files change; an item dropped as already applied counts as applied;
2. calls `model_state` `set_baseline`.

A failed `set_baseline` leaves a `discovery.json` the next pass reads correctly against the old baseline. When the reconcile is not complete, both stay where they are.

The recovery cases:

- **Operator stops the session mid-flow.** Already-applied items are durably in the model; `discovery.json` and `lastReconcileCommit` are unchanged. Re-running `/dethereal:threat-model` re-detects the same diff, and the orchestrator checks each item against the model files before the summary: a REMOVED item whose element is gone, an ADDED item whose name already names a model element (unless its type or class differs, which makes it a CHANGED-substrate item; a `(copied …)` item is never dropped this way) and a CHANGED-attribute-only item whose element is already stale are dropped and counted as `<D> already applied`; each dropped REMOVED item is named, so an element renamed by hand is not lost unseen. A CHANGED-substrate item already applied is caught when `match_classes` proposes the class the element already has. A REMOVED or CHANGED item whose `discovery.json` entry is `confirmed: false` (discovery proposed it; the operator never took it into the model) makes no item.
- **What comes back after a stop.** Only the baseline advance records a decision, so an item the operator declined is asked again, a changed secret file already answered is asked again, and an attribute-only change whose stale mark enrichment has since cleared is queued again.
- **Operator runs `/dethereal:threat-model` twice in a row with no changes.** First run resolves the delta, updates `discovery.json` and advances `lastReconcileCommit` to HEAD. When the changes were committed before the first run, the second run produces an empty delta and a "no drift" message, with no re-prompts. When they were still uncommitted, `detect_drift` lists the same files again (the baseline is HEAD, the edits are still in the working tree), so they are re-verified and an item declined in the first run is proposed again.

## Crown-jewel safety

Removing a crown-jewel-tagged element requires confirmation, and that confirmation lives inside `/dethereal:remove` itself. Drift treats the modeling skills as authoritative for safety prompts.

[`/dethereal:remove` SKILL.md](../../../apps/dethereal/workflow/skills/remove/SKILL.md) step 3 carries a tagged-element branch that elevates the prompt wording when the target is a crown jewel: an element whose id is mapped in the scope's `crown_jewel_elements` (a mapped data item included), the only store holding a mapped data item, a component with `crownJewel: true` in `structure.json`, or another element with `crown_jewel: true` in its attribute file (top level or under `attributes`). The drift summary's crown-jewel count uses the narrower test of the Drift Orchestration Protocol step 12: an id mapped in `crown_jewel_elements`, or `crownJewel: true` on a component. Untagged removals fall through to the existing generic confirm — zero behaviour change for them.

## Backend sync

Unchanged. `/dethereal:sync push` operates on the local model files exactly as it does outside the drift flow. Drift reconciliation produces a modified local model; sync ships it.

## Full-scan escape hatch

`/dethereal:threat-model --full-scan` bypasses drift detection, with or without a baseline, and runs Step 2 (Discovery) of the guided workflow's `build` phase whatever the state shows; the workflow goes on from there. Discovery sets a new baseline at its end.

Used when:

- The operator wants to re-baseline (history rewrite, suspected drift in non-tracked areas).
- The operator hasn't reconciled in long enough that the diff is unhelpful.
- The operator is onboarding a new module or source kind.

## Implementation surface

The prompts below are the workflow sources; the generator renders them into each harness's bundle (for Claude Code, `bundles/claude/` at the package root).

| Component | File |
|---|---|
| Detection (git listing + globs filter) | `detect_drift` MCP tool — [`src/tools/detect-drift.tool.ts`](../../../apps/dethereal/src/tools/detect-drift.tool.ts) |
| Baseline read and write | `model_state` MCP tool (`get`, `set_baseline`) — [`src/tools/model-state.tool.ts`](../../../apps/dethereal/src/tools/model-state.tool.ts) |
| Source-glob set (canonical lookup) | [`src/utils/source-globs.ts`](../../../apps/dethereal/src/utils/source-globs.ts) + [`source-globs.v1.json`](../../../apps/dethereal/src/utils/source-globs.v1.json) |
| Drift Orchestration Protocol | [`workflow/shared/drift-protocol.md`](../../../apps/dethereal/workflow/shared/drift-protocol.md) |
| Resume entry | [`workflow/skills/threat-model/SKILL.md`](../../../apps/dethereal/workflow/skills/threat-model/SKILL.md) §"Entry and resume" |
| Initial baseline write | [`workflow/shared/discovery-protocol.md`](../../../apps/dethereal/workflow/shared/discovery-protocol.md) step 13 (run by [`workflow/skills/discover/SKILL.md`](../../../apps/dethereal/workflow/skills/discover/SKILL.md)) |
| Crown-jewel pre-confirm | [`workflow/skills/remove/SKILL.md`](../../../apps/dethereal/workflow/skills/remove/SKILL.md) step 3 |
| Targeted enrich flag | [`workflow/skills/enrich/SKILL.md`](../../../apps/dethereal/workflow/skills/enrich/SKILL.md) (`--pick <id>`) |
| Scoped scout (`discover elements` mode) | [`workflow/agents/infrastructure-scout-scoped.md`](../../../apps/dethereal/workflow/agents/infrastructure-scout-scoped.md) |
| Substrate classification | `match_classes` MCP tool — a ranked class matcher (exact name, fuzzy name, vector similarity, type heuristic) against the platform's class catalog; no generative model |
| Decision record | [`DECISIONS.md` §D67](DECISIONS.md#d67-drift-detection--simplified-design) |

## Testing

- `detect_drift` in [`src/tools/__tests__/detect-drift.tool.test.ts`](../../../apps/dethereal/src/tools/__tests__/detect-drift.tool.test.ts), on the git-fixture scenarios of [`fixtures/drift-scenarios.ts`](../../../apps/dethereal/src/tools/__tests__/fixtures/drift-scenarios.ts) (committed, staged, unstaged and untracked changes and deletions, a committed rename with and without a content change, a staged rename, a committed copy, out-of-glob and ignored files, a model in a subdirectory, spaces and non-ASCII characters in paths): the exact `scoped`, `renamed` and `copied` of each, both paths of every pair in `scoped`; a timestamp-only change still listed; no repository filter run while listing; every refusal (outside the project, missing directory, non-git, missing or invalid baseline, broken ancestry, symlinked state file), unsafe names omitted and the cap.
- `set_baseline` in [`src/tools/__tests__/model-state.tool.test.ts`](../../../apps/dethereal/src/tools/__tests__/model-state.tool.test.ts): a full commit id is recorded; a short id, an unknown commit and a non-ancestor of HEAD are refused.
- The prompt contract, asserted on the generated bundles in [`src/generator/__tests__/package.test.ts`](../../../apps/dethereal/src/generator/__tests__/package.test.ts): the threat-modeler agent carries no Drift Orchestration Protocol on any harness and names `/dethereal:threat-model` instead; the protocol's secret-file filter and question gates; the `detect_drift` result shape, the rename and copy notes, the drop of items a stopped pass already applied, and the `discovery.json` update placed before `set_baseline`; the resume order (drift, crown jewels, cursor); and the crown-jewel gate of `/dethereal:remove` before anything is removed.

## Open questions

1. **Multi-repo models.** What if the model lives in repo A but some IaC sits in repo B? The current design assumes single-repo. Documented as a constraint; deferred to a future need that may never arrive.
2. **Hand-edited model files between reconciles.** If the operator hand-edits `structure.json` / `attributes.json` *after* the last reconcile (i.e. via direct file edit or a different `/dethereal:` skill invocation), drift detection still trusts `lastReconcileCommit`. The diff is git-only and does not re-read model state. Behaviour is correct: hand edits are a separate workflow, not drift; if the operator wants to re-baseline against the current model, they run `--full-scan`.
3. **Element-identity edge case.** What if a scoped scan picks up a file that always existed but a previous full scan missed (glob change, scout improvement)? Treat as ADDED and route through `/dethereal:add`. Acceptable behaviour.
4. **Boundary-membership drift via directory-tree moves.** A `git mv` of an in-scope file from one boundary's directory to another's moves the element across a trust boundary in any model that derives boundary membership from directory layout. The four-way delta does **not** surface this case as a separate disposition: no lane compares an element's boundary before and after the move. From a threat-modeling perspective a boundary change is at least as significant as a substrate change. Mitigation today: rely on the operator to notice via `git diff`. Future work: add a fifth `CHANGED-boundary` lane that compares the element's `boundaryId` before/after by re-deriving boundary membership from path.
5. **Crown-jewel transitions in hand-edited model files.** A `crownJewel: false → true` transition on a component in `structure.json` is a security-posture change, but it's a model-state edit rather than an infrastructure-source edit, so the scoped scout's `discover elements` mode won't surface it. Per Open question 2, hand-edits to model files are out of scope for drift detection. The `/dethereal:enrich --pick <id>` flow remains the canonical path for crown-jewel tag transitions.
6. **Substrate flips when both sides collapse to a baseline class.** When both prior and new element classifications resolve to the same baseline (`dethernety-general`) class, `suggestedClass.id` equality is not proof of substrate equivalence. The current mitigation is described in §"Substrate / classification changes": when the prior element's class is from the baseline (`dethernety-general`) module, the orchestrator forces a `match_classes` call against the new file content and uses its output as the comparison source. The asymmetric coverage of specialised modules is the root cause; broader module coverage would shrink this case to nothing.
7. **Determinism of `suggestedName` between scout runs.** The name join (§Element identity) and the drop of already-applied items after a stop (an ADDED item is dropped when its `suggestedName` already names a model element) assume the scout's `discover elements` mode is deterministic on stable input. If `suggestedName` varies run-to-run for the same file content, unchanged elements would show as REMOVED + ADDED, and items applied before a stop would re-prompt as ADDED on the next run. The agent's prose constrains naming to file-content-derived identifiers; confirming that determinism on real repositories is the remaining verification task.
