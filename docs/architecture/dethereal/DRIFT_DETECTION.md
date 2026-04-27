# Drift Detection — Revised Design

## Status

Pre-implementation design. Replaces [`CODEBASE_DRIFT_RECONCILIATION.md`](CODEBASE_DRIFT_RECONCILIATION.md), which will be deleted as part of an upcoming branch reset. The over-engineered predecessor is preserved as research material under tag `archive/drift-reconciliation-v1-overengineered`.

## Purpose

Catch threat-model drift that arises when infrastructure code (Terraform, Kubernetes manifests, application code) is edited without a corresponding model update.

**Intended workflow:**

1. Operator edits IaC / app code inside a git repo that also contains the threat model.
2. Before opening the PR, the operator runs `/dethereal:threat-model`.
3. The skill detects which in-scope files changed since the last reconcile.
4. The scout maps the changed files into a proposed model delta (added / removed / changed elements).
5. The operator accepts or declines each delta item via the existing `/dethereal:add` / `/dethereal:remove` / `/dethereal:enrich` flows — same UX as authoring a model from scratch.
6. The model is updated locally; `/dethereal:sync push` ships it to the platform when the operator chooses.

## Scope

### In scope

- Detect drift between the last reconciled state and the current git working tree.
- Translate detected drift into a proposed model delta via the scoped scout.
- Route the delta through existing modeling skills.

### Out of scope (intentional)

- **Live-source reconciliation.** Continuously reconciling against running K8s clusters, AWS accounts, or GCP projects is a different product — continuous infra observability, not threat-modeling-time validation. If that becomes a real workflow, it gets its own spec.
- **Adversarial multi-operator concurrency.** Threat modeling is a single-operator activity by nature; even on a team, two people don't simultaneously reconcile the same model. Advisory locks, cross-host TOCTOU defense, Windows liveness probes solve no real problem for any operator.
- **Non-git workflows.** Drift detection requires a git repo. Non-git folders are refused with a one-line message recommending `git init`. Bundling a non-git fallback doubles the detection surface to support a workflow we'd actively discourage.
- **Verb-language reconciliation.** No `add` / `remove` / `keep` / `re-verify` / `reclassify` / `pair` / `link` / `drop-source` / `suppress-streak` action verbs *inside* a reconciliation grammar. The existing modeling skills (`/dethereal:add`, `/dethereal:remove`, `/dethereal:enrich`) already provide these operations; the drift orchestrator routes delta items into those skills. Routing into existing skills is not the same thing as a reconciliation verb language.
- **Intent ledger, batch-split, retention compaction, atomic-finalisation primitive.** None of these have a problem to solve here.
- **Crown-Jewel Guard Paths A/B/C with secondary confirms.** Removing a tagged element should prompt for confirmation, but that confirmation lives inside `/dethereal:remove`, not in drift logic.

## Detection

### Mechanism

`git diff $lastReconcileCommit..HEAD` filtered by [`source-globs.ts`](../../../apps/dethereal/src/utils/source-globs.ts), unioned with `git status --porcelain` (dirty working tree) similarly filtered.

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

return scoped  # the file set the scout will see
```

**`-M -C` flags matter.** `git mv`-style renames must resolve as identity-preserving so model elements keep their crown-jewel tags and other attributes. Without `-M -C`, a rename appears as REMOVED + ADDED and the operator loses the tag on the new path. File **splits** (one file becomes two) and **consolidations** (two files become one) still resolve as REMOVED + ADDED — that's a workflow the operator handles by re-tagging manually. Document the constraint; do not invent a heuristic for the split / consolidate case.

### Why git-diff alone is sufficient

In a git-controlled directory, git already tracks every file in the working tree (committed + dirty + untracked). There is no scenario where git reports "nothing changed" while a parallel content-hash sees something git missed — for files inside the repo. The previous design's content-hash fallback, parallel-hash worker pool, spot-check PRNG, cardinality-based 1:1-swap detection, and `capsAcknowledged` monotonicity invariant were all defending against "what if git is wrong?", which has no real answer.

The previous design's spec §3 admitted the whole thing was a "client-local speed bump" anyway. With git as the substrate, the speed bump is free: the operator can already audit what changed via `git log` / `git diff`, and any tampering shows up in the same audit trail.

### Refusals

| Condition | Behaviour |
|---|---|
| Working tree is not a git repo | Refuse with `git init` instruction |
| `state.lastReconcileCommit` absent | Instruct `/dethereal:discover` to set baseline |
| `merge-base` between baseline and HEAD missing | Refuse: "baseline not in this branch's ancestry — re-run `/dethereal:discover`" (covers both history-rewrite and branch-switch cases) |
| Scout fails on the scoped input (non-zero exit, parse error, …) | Refuse: "scout failed on scoped input; re-run or use `--full-scan`." Leave `state.lastReconcileCommit` untouched so the next attempt resumes from the same baseline. |

### State surface

`state.json.lastReconcileCommit: <SHA>`. Written at the end of a successful reconcile. That is the only persisted detection state.

There is no typed `state.ts` module on `main` — `.dethereal/state.json` is read and written as raw JSON from skill bodies via `Read` / `Edit` / `Write`. The new field is documented as an optional schema entry in [`docs/guidelines-core.md`](../../../apps/dethereal/docs/guidelines-core.md) alongside the other state-file fields (`currentState`, `completedStates`, `staleElements`, `model_signed_off`). No TypeScript interface change is required; `mcp__dethereal__validate_model_json` does not validate `state.json`, only the model-data files.

## Reconciliation

### Mechanism

The scoped scout produces a proposed delta; route the delta through the existing modeling skills.

```
if drift detected (scoped non-empty):

  scout(scope=scoped)  →  newElements
  modelElements_in_scope = model elements whose discoverySources ⊆ scoped

  delta = compare(modelElements_in_scope, newElements):
    REMOVED                = present in model, absent in newElements
    ADDED                  = absent in model,   present in newElements
    CHANGED-substrate      = present in both, (substrate_enum, substrate_detail) differs
    CHANGED-attribute-only = present in both, non-substrate attributes differ

  # Pre-loop summary so per-item prompts aren't a surprise mid-loop:
  surface "<R> removed (<C> crown-jewel-tagged), <A> added, <S> reclassified, <T> attribute-changed"

  for each item in delta:
    REMOVED                → /dethereal:remove flow  (existing UX; crown-jewel confirm lives here)
    ADDED                  → /dethereal:add flow     (existing UX)
    CHANGED-substrate      → re-run classification step against the existing element id, then /dethereal:enrich
    CHANGED-attribute-only → /dethereal:enrich flow

  on completion (all delta items resolved): state.lastReconcileCommit = git rev-parse HEAD
```

### No new prompts

The drift orchestrator's job is sequencing, not UX. The operator sees the same accept/decline prompts they see when authoring a model from scratch — there is no separate "reconciliation table modify-loop", no "Path A/B/C secondary confirm", no "modify-loop verbs."

**Skill composition is prose-driven.** Claude Code does not have a "skill calls skill" primitive. The orchestrator lives in the `/dethereal:threat-model` SKILL.md resume body as prose; the threat-modeler agent walks that prose and invokes `Bash` (for `detect-drift.js`), `Read`/`Write`/`Edit` (for state.json + model files), MCP tools (e.g. `mcp__dethereal__match_classes` for the substrate-flip re-classification call), and other slash-commands as the prose instructs. The agent — not a runtime — drives sequencing. This is the same pattern every other skill on the plugin uses today.

If the existing modeling skills' UX is wrong for some case, fix it in the modeling skill — not in drift logic.

### Element identity

Same source path = same model element. File renames are `git diff --find-renames`'s job, not the orchestrator's. The previous design's tier-3 similarity-score rename detection (and the H1 inline crown-jewel tag-transfer prompt that grew out of it) had no problem to solve once git is the source of truth for path changes.

### Substrate / classification changes

A substrate flip (e.g. Terraform module previously `managed-cloud:eks-managed-nodes`, now `managed-cloud:eks-fargate`) is **not** an enrichment update — it's a different threat surface (node-level controls vs Fargate-managed). The orchestrator branches `CHANGED` on `(substrate_enum, substrate_detail)` inequality and routes substrate flips through the existing classification step before re-enriching. Pure attribute changes go straight to `/dethereal:enrich`.

There is no `reclassify` action verb, no chain-fusion rejection logic, no intent-ledger precondition. The branch is a one-line condition in the orchestrator.

### Crash safety and idempotency

Each routed `/dethereal:add`, `/dethereal:remove`, `/dethereal:enrich` invocation already writes the model atomically (tempfile + fsync + rename, the same pattern used everywhere else in the plugin). `state.lastReconcileCommit` advances **only after every delta item is resolved** — not per-item.

This makes the recovery story trivial:

- **Operator kills the session mid-flow.** Already-applied items are durably in the model. `lastReconcileCommit` is unchanged. Re-running `/dethereal:threat-model` re-detects the same diff, but the items already applied no longer appear (they're now in the model and match the scout's `newElements`); only the un-applied items re-prompt.
- **Operator runs `/dethereal:threat-model` twice in a row with no changes.** First run resolves the delta, advances `lastReconcileCommit`. Second run produces an empty delta and a "no drift" message. No re-prompts.

No replay protocol, no resume-lookup outcome table, no `pendingReconciliation` pointer. Crash safety falls out of the existing modeling skills' atomicity + the deferred baseline advance.

## Crown-jewel safety

If removing a `crownJewel: true` element should require confirmation, that confirmation lives inside `/dethereal:remove` itself. Drift treats the modeling skills as authoritative for safety prompts.

**Pre-execution audit finding (resolved into Sprint 2 scope):** the `/dethereal:remove` skill on `main` step 4 has a generic confirm (`Remove [STORE] "Redis Cache" from Data Tier? (yes / no)`) but **no crown-jewel-specific elevation**. The rebuild adds a tagged-element branch in step 4 that elevates the prompt wording when the target carries `crownJewel: true`. This is an *addition* to the skill, not a verification of existing behaviour.

There is no separate three-path Crown-Jewel Guard, no `pendingCrownJewelReassignments[]` queue, no `clear-pending-reassignment` verb, no `crown-jewel-debounce.json` file.

## Backend sync

Unchanged. `/dethereal:sync push` operates on the local model files exactly as it does today. Drift reconciliation produces a modified local model; sync ships it. There is no `pendingSyncPush` flag, no publish-divergence gate, no platform-side enforcement.

## Full-scan escape hatch

`/dethereal:threat-model --full-scan` (or equivalent argument) bypasses drift detection and falls through to the existing `/dethereal:discover` end-to-end path: scope → discovery → mapping → classification → enrichment.

Used when:
- The operator wants to re-baseline (history rewrite, suspected drift in non-tracked areas).
- The operator hasn't reconciled in long enough that the diff is unhelpful.
- The operator is onboarding a new module or source kind.

## State surfaces (compared to the over-engineered version)

> Scope: persisted `state.json` / `scope.json` fields and `.dethereal/` artefacts. Deleted user-facing docs and OSS modules are listed in the next section.


| Field / file | Status |
|---|---|
| `state.lastReconcileCommit` | **New** — sole detection baseline |
| `scope.driftReconciliation` (tri-state) | **Removed** — feature is on if git repo + model exist |
| `scope.driftReconciliationHistory` | **Removed** — git history is the audit trail |
| `scope.capsAcknowledged` | **Removed** — no caps |
| `scope.similarityThreshold` | **Removed** — no similarity-rename detection |
| `state.pendingReconciliation` | **Removed** — no async ledger |
| `state.pendingCrownJewelReassignments[]` | **Removed** — no async queue |
| `state.driftSkip` | **Removed** — no skip persistence |
| `state.pendingSyncPush` | **Removed** — sync already tracks this without help |
| `state._driftMeta.*` (sourceUncertainStreak, manifest, …) | **Removed** — no streak / manifest / tier-3 |
| `.dethereal/source-fingerprint.json` | **Removed** — git is the fingerprint |
| `.dethereal/reconciliations/*.json` | **Removed** — no ledger |
| `.dethereal/live-scans/*.json` | **Removed** — no live-source |
| `.dethereal/crown-jewel-debounce.json` | **Removed** — no debounce |
| `.dethereal/paired-discards/` | **Removed** — no `pair` verb |
| `.dethereal/logs/reconciliation-events.jsonl` | **Removed** — no telemetry layer |

## What this replaces from the over-engineered version

### Deleted entirely

- `oss/apps/dethereal/docs/reconciliation-primitive-core.md` + `-ext.md` (~118 KB combined)
- `oss/apps/dethereal/docs/reconciliation-implementation-notes.md`
- `oss/apps/dethereal/src/utils/reconciliation-finalize.ts`
- `oss/apps/dethereal/src/utils/reconciliation-ledger.ts`
- `oss/apps/dethereal/src/utils/pass-transition.ts`
- `oss/apps/dethereal/src/utils/advisory-lock.ts`
- `oss/apps/dethereal/src/utils/telemetry.ts`
- `oss/apps/dethereal/src/bin/reconcile.ts` and all its sub-commands (`resolve-lookup`, `replay`, `write-pending-ledger`, `validate-precondition`, `stamp-completed`, `acquire-lock`, `release-lock`, `emit-reconciliation-event`, `emit-abort-event`, `tail-events`, `scope-compare`, `onboarding-check`, `check-scope-gitignored`, `compact-archive`, …)
- All associated test files
- `scope.driftReconciliation` tri-state parser + `driftReconciliationHistory` breadcrumb helpers
- `oss/docs/user/dethereal/DRIFT_RECONCILIATION.md` user guide (replaced by a short paragraph in the existing threat-model user doc)
- `oss/docs/user/dethereal/DOGFOODING.md` + `dogfooding-log.template.md` (artifacts of a multi-operator dogfooding plan that does not apply)
- ADR D67 in `DECISIONS.md` (replaced by a new ADR for the simpler design)
- `CODEBASE_DRIFT_RECONCILIATION.md` itself (replaced by **this** document)

### Brought forward from the archived branch

These files do not exist on `main` — they were created on the over-engineered branch and survive the design simplification on their merits (canonical lookup tables / a narrow-tools agent declaration unrelated to the verb-language reconciliation surface). The rebuild pulls them via file-level checkout from the archive tag:

- `oss/apps/dethereal/src/utils/source-globs.ts` — canonical glob set
- `oss/apps/dethereal/src/utils/substrate-providers.ts` — provider + mapping rules (used by classification / enrichment, not by drift logic itself)
- `oss/apps/dethereal/agents/infrastructure-scout-scoped.md` — narrow-tools scoped-scout agent declaration
- Their unit tests

### Built fresh

- `oss/apps/dethereal/scripts/detect-drift.js` — git-diff + globs filter (~50 lines)
- Skill-body orchestration in `oss/apps/dethereal/skills/threat-model/SKILL.md` resume path (~50 lines of prose)
- Crown-jewel confirm in `oss/apps/dethereal/skills/remove/SKILL.md` if not already wired (verify; one-line fix if missing)
- This document, `DRIFT_DETECTION.md`
- A short ADR replacing D67

## Testing

- Unit tests for `detect-drift.js`: git diff filtering, dirty-tree handling, merge-base failure, non-git refusal, missing baseline.
- Integration test for `/dethereal:threat-model` resume: fixture model + scripted git history → assert proposed delta + correct skill routing.
- Test for `/dethereal:remove` crown-jewel confirmation if newly added.

The previous test surface (intent-ledger crash recovery, advisory-lock TOCTOU scenarios across hosts and pid-recycling, batch-split abandonment + resume, source-uncertain streak escalation with wall-clock floor and per-kind suppression, multi-source re-entry via `droppedSources[]`, retention-compaction marker-file crash-recovery, similarity rename-split tier-3 cascade, telemetry path-inference ground-truth fields, …) does not exist because the features being tested do not exist.

Estimated test count: 30–50 cases, vs the over-engineered version's 606. Most of the deleted tests were testing deleted code.

## Open questions

1. **Multi-repo models.** What if the model lives in repo A but some IaC sits in repo B? The simplified design assumes single-repo. Document the constraint in the user guide; defer multi-repo to a future need that may never arrive.
2. **Hand-edited model files between reconciles.** If the operator hand-edits `structure.json` / `attributes.json` *after* the last reconcile (i.e. via direct file edit or a different `/dethereal:` skill invocation), drift detection still trusts `lastReconcileCommit`. The diff is git-only and does not re-read model state. Behaviour is correct: hand edits are a separate workflow, not drift; if the operator wants to re-baseline against the current model, they run `--full-scan`. Document this so it isn't a surprise.
3. **Scout's behaviour on a scoped file set.** Confirm that the existing scout (or its scoped variant at [`agents/infrastructure-scout-scoped.md`](../../../apps/dethereal/agents/infrastructure-scout-scoped.md)) accepts a file allowlist as input and returns the same `DiscoveredElement[]` shape it produces for full-repo runs. **This is a hard prerequisite** — see Sequencing step 3.5.
4. **Element-identity edge case.** What if a scoped scan picks up a file that always existed but a previous full scan missed (glob change, scout improvement)? Treat as ADDED and route through `/dethereal:add`. Acceptable behaviour.

## Pre-merge gates

Items that must be verified before the rebuild PR can merge — promoted out of "Open questions" because they are blocking, not optional:

- **`/dethereal:remove` confirms on `crownJewel: true` removal.** A test must assert the skill prompts (or auto-rejects + asks) before applying a tagged removal. If the existing skill does not, add a one-line confirmation step in the same PR. The drift design's safety story depends entirely on this.

## Sequencing

1. Land this document on `main` (no implementation yet).
2. Tag the over-engineered work as `archive/drift-reconciliation-v1-overengineered` for research preservation.
3. **Verify the scout-scoped invocation contract.** Confirm `agents/infrastructure-scout-scoped.md` accepts a file allowlist and returns `DiscoveredElement[]` end-to-end on a fixture before resetting the branch. If it doesn't, scope a small extension to the scout as part of the rebuild scope.
4. Reset `feat/dethereal-drift-reconciliation` to main, or branch fresh.
5. Implement per the design above. ~1–2 days of focused work, plus the `/dethereal:remove` crown-jewel confirmation if not already present.
6. Single PR; review; merge; subtree-push.

## Why this design

The over-engineered predecessor bundled two distinct products into one feature: **filesystem-drift detection** (legitimate, narrow — "I edited code; flag what diverged from my model") and **live-source reconciliation** (continuous infra observability against running K8s/AWS/GCP — a different product entirely). Sprints 1–4 implemented the first; Sprints 5–7.1 grafted the second on top, which forced a verb language broad enough to cover both, which forced a ledger to keep the verb language correct under crash, which forced advisory locks to keep the ledger correct under concurrency, which forced batch-split to keep the ledger writable in finite memory, and so on. ~80% of the shipped surface is duplication of existing modeling-skill infrastructure with extra defensive machinery layered on to keep the duplication self-consistent.

Stripping the second product and routing reconciliation through the existing modeling pipeline collapses the design to ~100 lines of orchestration plus a ~50-line git-diff script. The result is small enough to read in a single sitting, small enough to test exhaustively, and narrow enough that the next operator who looks at it will not need a primitive document, an implementation-notes companion, and a sprint-by-sprint history to understand what it does.
