---
title: 'Sync and Version Control'
description: 'Push/pull workflow, conflict handling, git integration, and multi-model projects'
category: 'documentation'
position: 7
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

When updating an existing platform model, the plugin runs conflict detection first (see below), then pushes with `delete_orphaned: true` — elements you removed locally are also removed on the platform.

### Gate 2 Pre-Flight

Before any push, the plugin validates Gate 2 (sync-blocking) criteria:

- Manifest has name and description
- At least 1 boundary, 1 component, and 1 data flow
- All data flow source/target IDs exist in structure.json
- No orphaned attribute files

If Gate 2 fails, the push is blocked. Fix the reported issues first.

### Conflict Detection — Structural

When pushing an update, the plugin checks whether the platform version has elements that your local version doesn't. This can happen when someone edits the model through the platform GUI after your last push.

**If structural conflicts are found:**

```
WARNING — Platform has elements not in your local model.
These elements will be DELETED if you push:

  Components: "New Service" (added via GUI)
  Data flows: "New Service → Database" (added via GUI)

Options:
  push   — Push anyway (deletes these elements)
  pull   — Pull platform version first, then push
  cancel — Cancel push
```

The plugin shows you exactly what will be lost and lets you choose.

### Shared-Ownership Prompts

If your model contains brownfield Controls (Controls pulled from the platform that other Models also reference), the push pauses **per Control** to confirm the impact of your edits. Editing a shared Control mutates state in models you may not even have open — the plugin refuses to do this silently.

The prompt looks like this:

```
Brownfield Control "Database Encryption Package" (assigned to 4 Models):
  - This model: "Payment API"
  - Co-owners:  "User Service", "Reporting", "Admin Console"

Your changes (pendingEdit on class "Encryption at Rest"):
  algorithm: AES-128 → AES-256
  keyRotationDays: 90 → 30

Options (per row):
  cancel        — Skip this Control. Push everything else.
  push-anyway   — Apply your changes to all 4 Models. Audit-log entry: force-shared.
  push-unverified — Apply when the ownership query failed. Audit-log entry: force-unverified.
  clone-and-swap — Fork into a new Control just for this Model. (V1.1 — not yet implemented)
```

Choosing `push-anyway` writes a `force-shared` entry to `.dethereal/control-audit.log` so PR review can see who decided to mutate the shared state. Choosing `push-unverified` writes a `force-unverified` entry with the reason the ownership query failed (timeout, forbidden, no-data).

**Per-key resolution.** If only some attribute keys conflict, you can resolve them individually with `keep <n>.<key>` (keep yours), `accept-theirs <n>.<key>`, `merge <n>.<key>`, or `drop <n>.<key>` instead of an all-or-nothing per-Control verb.

**Large payloads.** For lengthy JSON values, stage edits via `merge-from-file <n>.<key> = <path>` instead of pasting inline. The file lives under `.dethereal/merge-staging/` (auto-created).

### External-Edit Guard

If someone else changed a brownfield Control on the platform between your pull and your push, the push aborts with `EXTERNAL_EDIT_DETECTED` rather than silently overwriting their edit. To proceed:

```
> /dethereal:sync promote-external-edit <controlId> <classId>
```

This promotes the platform's current state into your local `pendingEdit`, treating the external edit as legitimate operator intent. The next push runs the shared-ownership check against your effective state.

### Recovery Verbs

Three operator recovery paths exist for the control-library workflow:

| Verb | When to use |
|------|-------------|
| `/dethereal:sync repair-wal` | Any push/pull/status returned `WAL_REPLAY_FAILED`. Surfaces the stranded `.dethereal/pending-id-rewrite.json` journal and walks through delete-journal / retry-replay / manual-rename. |
| `/dethereal:sync promote-external-edit <controlId> <classId>` | Push aborted with `EXTERNAL_EDIT_DETECTED`. Promotes the platform's state into your local `pendingEdit`. Purely local — no platform mutation. |
| `/dethereal:sync tombstone <controlId>` | Retiring a Control locally without waiting for the platform-deletion-detected path. Future pulls won't resurrect it. |

---

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

If a local model already exists at the target path:

```
Local model "Production Stack" already exists at ./threat-models/prod/

Options:
  push     — Push your local changes first, then pull
  backup   — Save current local to .backup/, then pull
  overwrite — Replace local with platform version
  cancel   — Cancel pull
```

### State Inference

Platform models don't have `.dethereal/state.json`. After pull, the plugin infers the workflow state from model content:

| Content | Inferred State |
|---------|---------------|
| 0 components | INITIALIZED |
| No data flows | SCOPE_DEFINED |
| No classifications or attributes | STRUCTURE_COMPLETE |
| Has classifications or attributes | ENRICHING |

**REVIEWED is never inferred** — it requires explicit validation through the workflow.

**DISCOVERED is skipped** — discovery is a plugin-side concept. Platform models don't track discovery provenance. If you resume the guided workflow (`/dethereal:threat-model`) on a pulled model inferred as STRUCTURE_COMPLETE, it starts from Step 5 (Data Flow Mapping), skipping discovery and model review.

### Missing Scope Metadata

Platform models don't include `scope.json` (scope is a plugin concept). After pull:

```
Note: Platform models do not include scope.json.
Create one manually for full workflow support (/dethereal:threat-model to resume with scope).
```

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
    URL: https://demo.dethernety.io
    Auth: user@example.com (45 min remaining)

  Sync:
    Last push: 2 hours ago
    Last pull: never
    Local: Changes not pushed (3 files modified)

  Referenced Models: API Service (not available locally)
```

### Content Hashing

The plugin uses content hashes to determine if local changes exist. Layout properties (position, dimensions) are excluded from the hash — moving components around in a diagram doesn't count as a model change.

---

## Version Control with Git

### What to Commit

**Always commit:**
- Model files: `manifest.json`, `structure.json`, `dataflows.json`, `data-items.json`
- Attribute files: `attributes/**/*.json`
- Control files: `controls/<id>.json` (one per Control referenced by the model)
- Control audit log: `.dethereal/control-audit.log` — append-only JSONL ledger of shared-ownership decisions (force-shared, force-unverified). Committed so PR review can see who decided what; grep/jq friendly.
- Workflow metadata: `.dethereal/state.json`, `.dethereal/quality.json`, `.dethereal/scope.json`
- Auto-generated README: `README.md`
- Model registry: `.dethernety/models.json`

**Always gitignore:**
- `.dethereal/sync.json` — per-user sync state (different per developer)
- `.dethereal/discovery.json` — discovery provenance (may contain infrastructure paths and resource identifiers)
- `.dethereal/pending-id-rewrite.json` — WAL journal (transient; replayed automatically on next skill entry)
- `.dethereal/merge-staging/` — staging directory for `merge-from-file` payloads
- `.dethernety/discovery-cache.json` — transient cache

**Note on the audit log.** `.dethereal/control-audit.log` records per-Control decisions verbatim, including the prior `platformAttributes` payload. If your Controls store secret-shaped values (raw API keys, tokens), redact before commit. The log is human-readable, line-oriented JSON.

Token storage (`~/.dethernety/`) is in your home directory, outside the repository — no gitignore entry needed.

Add to your `.gitignore`:

```gitignore
# Dethereal per-user state
**/.dethereal/sync.json

# Discovery provenance (may contain infrastructure details)
**/.dethereal/discovery.json

# WAL journal (transient — replayed automatically)
**/.dethereal/pending-id-rewrite.json

# Merge-staging payloads (per-prompt working files)
**/.dethereal/merge-staging/

# Discovery cache (transient)
.dethernety/discovery-cache.json
```

### Git as the Undo Mechanism

Dethereal has no custom undo tool — git is the undo mechanism. When you want to revert changes:

- **Uncommitted changes:** `git diff` to see what changed, `git checkout -- <file>` to revert specific files, or `git stash` to save changes for later
- **Committed changes:** `git revert <commit>` to undo a specific commit

The plugin assists with git commands when you ask to undo, but it **never auto-executes destructive git commands** — it shows you the command, explains what will happen, and lets you confirm.

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

This check runs after Step 3 (Model Review) in the guided workflow. The recommendation is advisory — you can proceed with a large model.

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
