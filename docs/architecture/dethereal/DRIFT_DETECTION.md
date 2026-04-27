# Drift Detection

## Purpose

Catches threat-model drift that arises when infrastructure code (Terraform, Kubernetes manifests, application code) is edited without a corresponding model update.

## Workflow

1. Operator edits IaC / app code inside a git repo that also contains the threat model.
2. Before opening the PR, the operator runs `/dethereal:threat-model`.
3. The skill detects which in-scope files changed since the last reconcile.
4. The scoped scout maps the changed files into a proposed model delta (added / removed / changed elements).
5. The operator accepts or declines each delta item via the existing `/dethereal:add` / `/dethereal:remove` / `/dethereal:enrich` flows — same UX as authoring a model from scratch.
6. The model is updated locally; `/dethereal:sync push` ships it to the platform when the operator chooses.

## Scope

### In scope

- Detect drift between the last reconciled state and the current git working tree.
- Translate detected drift into a proposed model delta via the scoped scout.
- Route the delta through existing modeling skills.

### Out of scope

- **Live-source reconciliation.** Continuously reconciling against running K8s clusters, AWS accounts, or GCP projects is a different product — continuous infra observability, not threat-modeling-time validation.
- **Multi-operator concurrency.** Threat modeling is a single-operator activity by nature; the design assumes one operator at a time reconciling a given model. No advisory locks, no cross-host coordination.
- **Non-git workflows.** Drift detection requires a git repo. Non-git folders are refused with a one-line message recommending `git init`.

## Detection

### Mechanism

`git diff $lastReconcileCommit..HEAD` filtered by [`source-globs.ts`](../../../apps/dethereal/src/utils/source-globs.ts), unioned with `git status --porcelain` (dirty working tree) similarly filtered. The filter and the unioning happen inside [`scripts/detect-drift.js`](../../../apps/dethereal/scripts/detect-drift.js).

In a git-controlled directory, git already tracks every file in the working tree (committed + dirty + untracked). The operator can audit any drift the same way they audit any other change — `git log` / `git diff` against the baseline SHA. No parallel detection layer is needed.

### Pseudocode

```
if not in a git repo:
  refuse — "drift detection requires a git repo; run `git init && git add .` and try again"

if state.lastReconcileCommit is missing:
  return "no baseline — run /dethereal:discover"

if not merge-base(lastReconcileCommit, HEAD):
  # Either history was rewritten past the baseline, or the operator
  # is on a branch whose ancestry doesn't include lastReconcileCommit
  # (branch switch). Both resolve via re-baseline.
  return "baseline not in this branch's ancestry (history rewrite or branch switch) — re-run /dethereal:discover"

changed = git diff --name-only -M -C $lastReconcileCommit..HEAD
dirty   = git status --porcelain  (parse the path columns)
scoped  = (changed ∪ dirty) filtered by source-globs

return scoped  # the file set the scout sees
```

**`-M -C` flags matter.** `git mv`-style renames resolve as identity-preserving so model elements keep their crown-jewel tags and other attributes. Without `-M -C`, a rename appears as REMOVED + ADDED and the operator loses the tag on the new path. File **splits** (one file becomes two) and **consolidations** (two files become one) still resolve as REMOVED + ADDED — that's a workflow the operator handles by re-tagging manually.

### Refusals

| Condition | Behaviour |
|---|---|
| Working tree is not a git repo | Refuse with `git init` instruction |
| `state.lastReconcileCommit` absent | Instruct `/dethereal:discover` to set baseline |
| `merge-base` between baseline and HEAD missing | Refuse: "baseline not in this branch's ancestry — re-run `/dethereal:discover`" (covers both history-rewrite and branch-switch cases) |
| Scout fails on the scoped input (non-zero exit, parse error, …) | Refuse: "scout failed on scoped input; re-run or use `--full-scan`." `state.lastReconcileCommit` is left untouched so the next attempt resumes from the same baseline. |

### State surface

`state.json.lastReconcileCommit: <SHA>`. Two writers — both invocations of `Edit` against `<model-path>/.dethereal/state.json`:

- **Initial baseline.** [`/dethereal:discover` Step 9](../../../apps/dethereal/skills/discover/SKILL.md) (and the [threat-modeler agent's](../../../apps/dethereal/agents/threat-modeler.md) Discovery Orchestration Protocol step 12) writes `lastReconcileCommit = <git rev-parse HEAD>` at the end of discovery. This establishes the baseline for the first time. Re-running `/dethereal:discover` on an existing model overwrites the field — that's the explicit re-baseline path.
- **Subsequent advances.** The [`/dethereal:threat-model`](../../../apps/dethereal/skills/threat-model/SKILL.md) resume path advances the field at the end of a successful drift-loop reconcile (after every delta item resolves; see §"Crash safety and idempotency" for why the advance is deferred to loop-end rather than per-item).

That is the only persisted detection state.

In a non-git folder, neither writer fires (both check `git rev-parse HEAD` and omit the field on non-zero exit). Drift detection skips on resume and the operator gets a "no baseline — run /dethereal:discover" hint until they re-run discovery in a git repo.

`.dethereal/state.json` is read and written as raw JSON from skill bodies via `Read` / `Edit` / `Write`. The field is documented as an optional schema entry in [`docs/guidelines-core.md`](../../../apps/dethereal/docs/guidelines-core.md) alongside the other state-file fields (`currentState`, `completedStates`, `staleElements`, `model_signed_off`). `mcp__dethereal__validate_model_json` does not validate `state.json`, only the model-data files.

## Reconciliation

### Mechanism

The scoped scout produces a proposed delta; the orchestrator routes the delta through the existing modeling skills.

```
if drift detected (scoped non-empty):

  scout(scope=scoped, mode=`discover elements`)  →  newElements
  modelElements_in_scope = model elements whose discoverySources ⊆ scoped
                           (joined from .dethereal/discovery.json)

  delta = compare(modelElements_in_scope, newElements):
    REMOVED                = present in model, absent in newElements
    ADDED                  = absent in model,   present in newElements
    CHANGED-substrate      = present in both, suggestedClass.id or
                             suggestedComponentType differs
    CHANGED-attribute-only = present in both, non-substrate attributes differ

  # Pre-loop summary so per-item prompts aren't a surprise mid-loop:
  surface "<R> removed (<C> crown-jewel-tagged), <A> added, <S> reclassified, <T> attribute-changed"

  for each item in delta:
    REMOVED                → /dethereal:remove flow  (existing UX; crown-jewel confirm lives here)
    ADDED                  → /dethereal:add flow     (existing UX)
    CHANGED-substrate      → re-run classification step against the existing
                             element id, then /dethereal:enrich --pick <id>
    CHANGED-attribute-only → /dethereal:enrich --pick <id>

  on completion (all delta items resolved): state.lastReconcileCommit = git rev-parse HEAD
```

### No new prompts

The drift orchestrator's job is sequencing, not UX. The operator sees the same accept/decline prompts they see when authoring a model from scratch. If a modeling skill's UX is wrong for some case, fix it in the modeling skill — not in drift logic.

**Skill composition is prose-driven.** Claude Code does not have a "skill calls skill" primitive. The orchestrator lives in the [`/dethereal:threat-model` SKILL.md](../../../apps/dethereal/skills/threat-model/SKILL.md) resume body as prose; the [threat-modeler agent](../../../apps/dethereal/agents/threat-modeler.md) walks that prose and invokes `Bash` (for `detect-drift.js`), `Read`/`Write`/`Edit` (for state.json + model files), MCP tools (e.g. `mcp__dethereal__match_classes` for substrate-flip re-classification), and other slash-commands as the prose instructs. The agent — not a runtime — drives sequencing. This is the same pattern every other skill on the plugin uses.

### Element identity

Same source path = same model element. File renames are `git diff --find-renames`'s job (resolved by the `-M -C` flags in §Detection), not the orchestrator's.

### Substrate / classification changes

A substrate flip (e.g. Terraform module previously `managed-cloud:eks-managed-nodes`, now `managed-cloud:eks-fargate`) is **not** an enrichment update — it's a different threat surface (node-level controls vs. Fargate-managed). The orchestrator branches `CHANGED` on `suggestedClass.id` *or* `suggestedComponentType` inequality and routes substrate flips through the existing classification step before re-enriching. Pure attribute changes go straight to `/dethereal:enrich --pick <id>`.

When both prior and new sides resolve to the same baseline / `dethernety-module` `General` class, class-id equality is not proof of substrate equivalence. In that case the orchestrator forces a `mcp__dethereal__match_classes` call against the new file content and uses its output as the comparison source. Documented as a runtime predicate in the [threat-modeler agent's](../../../apps/dethereal/agents/threat-modeler.md) §"Drift Orchestration Protocol" step 9.

### Crash safety and idempotency

Each routed `/dethereal:add`, `/dethereal:remove`, `/dethereal:enrich` invocation writes the model atomically (tempfile + fsync + rename, the same pattern used everywhere else in the plugin). `state.lastReconcileCommit` advances **only after every delta item is resolved** — not per-item.

This makes the recovery story trivial:

- **Operator kills the session mid-flow.** Already-applied items are durably in the model. `lastReconcileCommit` is unchanged. Re-running `/dethereal:threat-model` re-detects the same diff, but the items already applied no longer appear (they're now in the model and match the scout's `newElements`); only the un-applied items re-prompt.
- **Operator runs `/dethereal:threat-model` twice in a row with no changes.** First run resolves the delta and advances `lastReconcileCommit`. Second run produces an empty delta and a "no drift" message. No re-prompts.

## Crown-jewel safety

Removing a `crown_jewel: true` element requires confirmation, and that confirmation lives inside `/dethereal:remove` itself. Drift treats the modeling skills as authoritative for safety prompts.

[`/dethereal:remove` SKILL.md](../../../apps/dethereal/skills/remove/SKILL.md) step 4 carries a tagged-element branch that elevates the prompt wording when the target carries `crown_jewel: true` (top-level pre-import) or `attributes.crown_jewel: true` (nested post-import). Untagged removals fall through to the existing generic confirm — zero behaviour change for them.

## Backend sync

Unchanged. `/dethereal:sync push` operates on the local model files exactly as it does outside the drift flow. Drift reconciliation produces a modified local model; sync ships it.

## Full-scan escape hatch

`/dethereal:threat-model --full-scan` bypasses drift detection and falls through to the existing `/dethereal:discover` end-to-end path: scope → discovery → mapping → classification → enrichment.

Used when:

- The operator wants to re-baseline (history rewrite, suspected drift in non-tracked areas).
- The operator hasn't reconciled in long enough that the diff is unhelpful.
- The operator is onboarding a new module or source kind.

## Implementation surface

| Component | File |
|---|---|
| Detection script (git-diff + globs filter) | [`scripts/detect-drift.js`](../../../apps/dethereal/scripts/detect-drift.js) |
| Source-glob set (canonical lookup) | [`src/utils/source-globs.ts`](../../../apps/dethereal/src/utils/source-globs.ts) + [`source-globs.v1.json`](../../../apps/dethereal/src/utils/source-globs.v1.json) |
| Resume orchestration prose | [`skills/threat-model/SKILL.md`](../../../apps/dethereal/skills/threat-model/SKILL.md) §"Resume from Existing Model" |
| Initial baseline write | [`skills/discover/SKILL.md`](../../../apps/dethereal/skills/discover/SKILL.md) Step 9 |
| Crown-jewel pre-confirm | [`skills/remove/SKILL.md`](../../../apps/dethereal/skills/remove/SKILL.md) Step 4 |
| Targeted enrich flag | [`skills/enrich/SKILL.md`](../../../apps/dethereal/skills/enrich/SKILL.md) (`--pick <id>`) |
| Scoped scout (`discover elements` mode) | [`agents/infrastructure-scout-scoped.md`](../../../apps/dethereal/agents/infrastructure-scout-scoped.md) |
| Drift Orchestration Protocol | [`agents/threat-modeler.md`](../../../apps/dethereal/agents/threat-modeler.md) §"Drift Orchestration Protocol" |
| Substrate classification | `mcp__dethereal__match_classes` (LLM-backed; covers all providers uniformly) |
| Decision record | [`DECISIONS.md` §D67](DECISIONS.md#d67-drift-detection--simplified-design) |

## Testing

- Unit tests for `detect-drift.js`: git diff filtering, dirty-tree handling, merge-base failure, non-git refusal, missing baseline.
- Integration tests for `/dethereal:threat-model` resume in [`src/utils/__tests__/threat-model-resume.test.ts`](../../../apps/dethereal/src/utils/__tests__/threat-model-resume.test.ts): fixture model + scripted git history → asserts proposed delta + correct skill routing for each disposition; partial-kill scenario verified; initial-baseline write at end of discovery verified.
- Crown-jewel confirmation test in `/dethereal:remove` (tagged elevates / untagged falls through).

## Open questions

1. **Multi-repo models.** What if the model lives in repo A but some IaC sits in repo B? The current design assumes single-repo. Documented as a constraint; deferred to a future need that may never arrive.
2. **Hand-edited model files between reconciles.** If the operator hand-edits `structure.json` / `attributes.json` *after* the last reconcile (i.e. via direct file edit or a different `/dethereal:` skill invocation), drift detection still trusts `lastReconcileCommit`. The diff is git-only and does not re-read model state. Behaviour is correct: hand edits are a separate workflow, not drift; if the operator wants to re-baseline against the current model, they run `--full-scan`.
3. **Element-identity edge case.** What if a scoped scan picks up a file that always existed but a previous full scan missed (glob change, scout improvement)? Treat as ADDED and route through `/dethereal:add`. Acceptable behaviour.
4. **Boundary-membership drift via directory-tree moves.** A `git mv` of an in-scope file from one boundary's directory to another's is identity-preserving for the element (per §"Element identity") but moves it across a trust boundary in any model that derives boundary membership from directory layout. The four-way delta does **not** surface this case as a separate disposition — class-id is unchanged so it routes to attribute-only enrich at best, or doesn't route at all if attribute-file content is unchanged. From a threat-modeling perspective a boundary change is at least as significant as a substrate change. Mitigation today: rely on the operator to notice via `git diff`. Future work: add a fifth `CHANGED-boundary` lane that compares the element's `boundaryId` before/after by re-deriving boundary membership from path.
5. **Crown-jewel transitions in hand-edited attribute files.** A `crown_jewel: false → true` transition in a committed attribute file is a security-posture change, but it's a model-state edit rather than an infrastructure-source edit, so the scoped scout's `discover elements` mode won't surface it. Per Open question 2, hand-edits to model files are out of scope for drift detection. The `/dethereal:enrich --pick <id>` flow remains the canonical path for crown-jewel tag transitions.
6. **Substrate flips when both sides collapse to a baseline class.** When both prior and new element classifications resolve to the same `dethernety-module` / `General` baseline class, `suggestedClass.id` equality is not proof of substrate equivalence. The current mitigation is described in §"Substrate / classification changes": when the prior element's class is from the General/baseline module, the orchestrator forces a `match_classes` call against the new file content and uses its output as the comparison source. The asymmetric coverage of specialised modules is the root cause; broader module coverage would shrink this case to nothing.
7. **Determinism of `suggestedName` between scout runs.** The deferred-baseline crash-safety story (re-applied items drop out of the next delta because they appear in `newElements` with stable name keys) assumes the scout's `discover elements` mode is deterministic on stable input. If `suggestedName` varies run-to-run for the same file content, re-applied items would re-prompt as ADDED on the next run. The agent's prose constrains naming to file-content-derived identifiers; an empirical confirmation against a real fixture is the remaining verification task.
