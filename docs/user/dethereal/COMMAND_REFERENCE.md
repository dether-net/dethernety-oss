---
title: 'Command Reference'
description: 'Complete reference for all 14 Dethereal slash commands'
category: 'documentation'
position: 4
navigation: true
tags: ['dethereal', 'commands', 'reference', 'skills']
---

# Command Reference

All Dethereal commands use the `/dethereal:` prefix. Run `/dethereal:help` for context-aware suggestions, or `/dethereal:help <command>` for usage details.

---

## How Commands Work

### Slash Command Syntax

```
/dethereal:<command> [arguments]
```

Arguments can be natural language, paths, or flags. Most commands work without arguments by using the Model Resolution Protocol — if you have a single model, it's used automatically. If you have multiple, the plugin asks you to choose.

### Agent Delegation

Each command runs on a specific AI agent. The agent determines what tools and behaviors are available:

| Agent | Role | Commands |
|-------|------|----------|
| *(no agent)* | Simple display, no model writes | status, login, help |
| threat-modeler | Creates and modifies model files | create, discover, add, remove, threat-model, sync |
| security-enricher | Classification and security attributes | classify, enrich |
| model-reviewer | Read-only quality analysis | review, surface, view |

### Post-Action Footer

Every command that modifies model files ends with a footer showing quality and recommended next steps:

```
[done] Action complete. Quality: X/100.
[next] /dethereal:foo (reason for next step)
```

---

## Foundation Commands

### `/dethereal:status`

Show connection status, authentication state, and local model summary.

```
> /dethereal:status

Dethernety Connection Status
─────────────────────────────────────────
Platform URL:  https://demo.dethernety.io
Auth status:   Authenticated (user@example.com, 59 min remaining)
─────────────────────────────────────────

Local Models:
  Production Stack  ./threat-models/prod  56/100 (ENRICHING)  synced 2h ago
  Dev Environment   ./threat-models/dev   23/100 (DISCOVERED) never synced
```

Reads all data from local files — does not call the platform.

---

### `/dethereal:login`

Authenticate with the Dethernety platform via browser-based OAuth.

```
> /dethereal:login

Opening browser for authentication...

Authenticated successfully.
Platform:     https://demo.dethernety.io
User:         user@example.com
Token valid:  60 minutes remaining
```

If already authenticated, returns immediately without opening the browser. Expired tokens are refreshed automatically when possible. If the platform has auth disabled (no-auth mode), all tools work without login.

---

### `/dethereal:help [command]`

Show available commands with context-aware suggestions.

```
> /dethereal:help
```

Shows command categories with suggestions based on your current model state. For detailed usage on a specific command:

```
> /dethereal:help enrich
```

---

### `/dethereal:view [model-path] [--format yaml|json|tree]`

Display a read-only summary of a threat model.

**Arguments:**
- `[model-path]` — path to model directory (optional if you have one model)
- `--format tree` — hierarchical tree view (default)
- `--format json` — raw JSON
- `--format yaml` — YAML view

```
> /dethereal:view

Production Stack (56/100 quality, ENRICHING)

├── Internet Zone
│   └── [EXTERNAL_ENTITY] End Users
├── DMZ
│   └── [PROCESS] Web Server (classified: Web Application)
└── Internal Network
    ├── Application Tier
    │   └── [PROCESS] API Server (classified: REST API)
    └── Data Tier
        ├── [STORE] Database (classified: PostgreSQL)
        └── [STORE] Cache (classified: Redis)

Data Flows (5):
  1. End Users → Web Server: HTTP requests
  2. Web Server → API Server: API calls (HTTPS)
  3. API Server → Database: SQL queries
  4. API Server → Cache: Cache lookups
  5. Database → API Server: Query results

Quality: 56/100 (In Progress)
  Component classification:  60%  (3/5 classified)
  Attribute completion:      40%  (2/5 with attributes)

Sync: last pushed 2h ago | Platform model ID: abc123
```

---

## Modeling Commands

### `/dethereal:create [description or template]`

Create a new threat model. Four entry points:

| Input | Mode |
|-------|------|
| Natural language description | Describe |
| `template web_app` | Template |
| Path to IaC files | Import |
| `pull` | Pull from platform |

```
> /dethereal:create a microservices system with API gateway, 3 services, and PostgreSQL
```

The plugin collects scope information through conversation (crown jewels, compliance drivers, trust assumptions), then creates the model directory with initial structure. See [Getting Started](GETTING_STARTED.md) for a detailed walkthrough.

**Creates:** Model directory at `./threat-models/<name>/` with manifest, structure, dataflows, data-items, scope, state, and README.

**State after:** SCOPE_DEFINED

---

### `/dethereal:discover [scope] [path]`

Scan your codebase for infrastructure components using the infrastructure-scout agent.

```
> /dethereal:discover
```

The plugin scans 10 source categories (IaC, containers, K8s, APIs, CI/CD, etc.), presents a batch confirmation table, then runs a blind-spots interview to catch commonly missed elements.

**Prerequisites:** A model must exist. If you have IaC files (Terraform, CloudFormation, Kubernetes manifests), discovery produces the best results.

**Output:** Sources-checked summary, batch confirmation table, discovery provenance saved to `.dethereal/discovery.json`.

**State after:** DISCOVERED

See [Discovery and Enrichment](DISCOVERY_AND_ENRICHMENT.md) for details on the discovery process.

---

### `/dethereal:add [element description]`

Add components, boundaries, data flows, or data items using natural language.

```
> /dethereal:add a Redis cache in the data tier
> /dethereal:add a flow from API Server to Redis for session lookups
> /dethereal:add a DMZ boundary for internet-facing services
> /dethereal:add PII data item on the user registration flow
```

The plugin infers the element type from your description, determines placement and connections, and shows a preview before writing:

```
Adding to "Production Stack":
  Component: "Redis Cache" (STORE) in Data Tier boundary
  New data flows:
    API Server → Redis Cache: "Cache read/write"

Confirm? (yes / adjust)
```

**State behavior:** No change at DISCOVERED or STRUCTURE_COMPLETE. At ENRICHING or later, triggers a backward transition to STRUCTURE_COMPLETE (see [Backward Transitions](GUIDED_WORKFLOW.md#backward-transitions)).

---

### `/dethereal:remove [element reference]`

Remove elements with dependency checking.

```
> /dethereal:remove Redis Cache
```

Before removal, the plugin shows all dependent elements (connected flows, associated data items, attribute files):

```
Removing [STORE] "Redis Cache" will also affect:
  Data flows (will be removed):
    - "API Server → Redis Cache" (Cache read/write)
  Attribute files (will be deleted):
    - attributes/components/abc123.json

Proceed? (yes / no / remove component only)
```

If removing a boundary, child components are relocated to the parent boundary — they're never silently deleted.

**State behavior:** Same as `/dethereal:add` — backward transition at ENRICHING or later.

---

## Classification and Enrichment Commands

### `/dethereal:classify [--type components|flows|boundaries|data-items]`

Assign classes to unclassified elements using a two-pass process.

**Arguments:**
- `--type` — filter to a specific element type (optional; classifies all types by default)

```
> /dethereal:classify
```

**Pass 1 (Deterministic):** Queries the platform's class library and matches by name/type (e.g., "PostgreSQL" matches "Database" class). High confidence, no LLM needed.

**Pass 2 (LLM-Assisted):** For remaining unclassified elements, proposes classes using boundary context and peer inference.

**Crown jewel tagging:** Fuzzy-matches crown jewel names from your scope definition to components and tags them.

```
Classification Proposal

| # | Element | Type | Proposed Class | Confidence | Crown Jewel |
|---|---------|------|----------------|------------|-------------|
| 1 | PostgreSQL | STORE | Database | high (IaC) | yes |
| 2 | Redis | STORE | Key-Value Store | high (IaC) | — |
| 3 | API Server | PROCESS | Web Application | medium (LLM) | — |

Apply all? (yes / modify / skip)
```

**Quality gate:** 100% of STORE components must be classified. 80% overall target.

**State:** No transition — classification is tracked by the quality score.

---

### `/dethereal:enrich [tier1|all|pick] [--focus credentials|monitoring|compliance|controls] [--pick <element-id>]`

Populate security attributes, credentials, MITRE ATT&CK references, monitoring tools, and security controls.

**Scope arguments:**
- `tier1` — crown jewels only (fastest)
- `all` — all components in tier order (default)
- `pick` — manual selection (interactive list)

**Focus arguments:**
- `--focus credentials` — credential topology only
- `--focus monitoring` — monitoring tools only
- `--focus compliance` — compliance-driven prompts only
- `--focus controls` — control assignment pass (separate invocation, own 40-turn budget). Auto-pulls referenced Controls, lets you edit per-instance attributes, and queues `pendingEdit` blocks for the next push. Greenfield Controls get a temporary ID; brownfield Controls write to `controls/<id>.json`. See [Discovery and Enrichment](DISCOVERY_AND_ENRICHMENT.md#part-4--control-enrichment).

**Targeted flag:**
- `--pick <element-id>` — target a single element by id, skipping the interactive selector. Used by the drift orchestrator (CHANGED-substrate and CHANGED-attribute-only delta items route here); also available for direct invocation when you know the element id.

```
> /dethereal:enrich tier1
```

Presents enrichment in batches by tier:

```
Enrichment scope: 13 components
  Tier 1 (crown jewels):    2 — payment-db, user-db
  Tier 2 (cross-boundary):  5
  Tier 3 (internet-facing): 2
  Tier 4 (internal):        4

Processing: tier1 only. Confirm? (yes / all / pick)
```

For each component, prompts for the 6 key security attributes (authentication, encryption in transit, encryption at rest, logging, access control, log telemetry), plus credential mapping, MITRE ATT&CK techniques, and monitoring tools.

**State after:** ENRICHING (first confirmed batch triggers the transition if not already there)

See [Discovery and Enrichment](DISCOVERY_AND_ENRICHMENT.md) for the full enrichment workflow.

---

## Review and Analysis Commands

### `/dethereal:review [directory-path] [--structure-only]`

Quality dashboard with score breakdown, gap analysis, and readiness assessment. This command does not modify model files.

**Full review:**

```
> /dethereal:review
```

Shows quality score (7-factor breakdown), quality gate evaluation (Gate 1/2/3), common gaps checklist, top issues, analysis readiness assessment, and — if the model carries trust zoning — an advisory [zoning-coherence roll-up](REVIEW_AND_ANALYSIS.md#zoning-coherence-advisory) (the six findings, never sync-blocking).

**Structure-only review:**

```
> /dethereal:review --structure-only
```

Lightweight structural validation — checks required fields, ID uniqueness, reference integrity, orphaned components, and schema compliance. Useful for catching errors before enrichment.

See [Review and Analysis](REVIEW_AND_ANALYSIS.md) for output format details.

---

### `/dethereal:surface [directory-path]`

Attack surface summary with component breakdown, trust boundary crossings, and control gap analysis. This command does not modify model files.

```
> /dethereal:surface
```

Produces 8 analysis sections:
1. Component breakdown by boundary and type
2. Trust boundary crossing matrix (encryption and authentication status)
3. Exposure counts (requires platform sync)
4. Control gap analysis by enrichment tier
5. MITRE ATT&CK tactic coverage
6. Credential topology and blast radius
7. Detection coverage and SOC blind spots
8. Cross-model analysis boundaries

See [Review and Analysis](REVIEW_AND_ANALYSIS.md) for details.

---

## Sync Commands

### `/dethereal:sync push|pull|status|repair-wal|promote-external-edit|tombstone [...]`

Synchronize local model with the Dethernety platform, plus four recovery verbs for the control-library workflow.

**Push (publish local to platform):**

```
> /dethereal:sync push
```

Validates the model (Gate 2 pre-flight), checks for conflicts with the platform version, and publishes. Server-generated IDs are written back to local files. If your model has Controls assigned to multiple Models, the push pauses on the **shared-ownership prompt** — you choose `cancel`, `push-anyway`, `push-unverified`, or (V1.1) `clone-and-swap` per Control. Decisions are recorded in `.dethereal/control-audit.log`. See [Sync and Version Control](SYNC_AND_VERSION_CONTROL.md#shared-ownership-prompts).

**Pull (import from platform):**

```
> /dethereal:sync pull
```

Lists platform models, lets you select one, and exports it to local files. If a local model already exists at the target path, offers to backup, overwrite, or cancel. Pulling also materialises `controls/<id>.json` for every Control referenced by the model.

**Status:**

```
> /dethereal:sync status
```

Shows sync state, last push/pull timestamps, whether local changes have been pushed, and the count of pending shared-edit prompts (Controls with un-pushed `pendingEdit` blocks). If drift between local `attributes` and `platformAttributes` is detected, surfaces a hint to run `promote-external-edit`.

**Recovery verbs (control-library workflow):**

```
> /dethereal:sync repair-wal [directory-path]
```

Surface a stranded WAL journal (`.dethereal/pending-id-rewrite.json`) and walk through three recovery actions: delete journal, retry replay, or manually rename. Use when any push/pull/status returns `WAL_REPLAY_FAILED`.

```
> /dethereal:sync promote-external-edit <controlId> <classId>
```

Unblock the Step A external-edit guard. When someone else changed the Control on the platform between your pull and push, this promotes the platform's current state into your local `pendingEdit` so the next push runs the shared-ownership check against your effective intent. No platform mutation; purely local.

```
> /dethereal:sync tombstone <controlId>
```

Mark a Control as tombstoned locally so future pulls don't resurrect it. Useful when retiring a Control without waiting for the platform-deletion-detected reconciliation path.

**`merge-from-file` (in-prompt verb).** During a shared-ownership prompt with large per-key payloads, the operator can stage edits via `merge-from-file <n>.<key> = <path>` instead of pasting them inline. The file lives under `.dethereal/merge-staging/` (auto-created if absent).

See [Sync and Version Control](SYNC_AND_VERSION_CONTROL.md) for conflict handling and the control-library push flow.

---

## Guided Workflow

### `/dethereal:threat-model [system description or model path] [--full-scan]`

The complete 11-step guided workflow — scope definition through validation and platform sync.

```
> /dethereal:threat-model a payment processing API with PostgreSQL and Redis
```

Or to resume an existing model:

```
> /dethereal:threat-model ./threat-models/payment-api
```

This is the recommended approach for new models. It chains together discovery, classification, enrichment, validation, and sync with checkpoints between phases. You can stop at any point and resume later.

**Trust zoning** is ratified inline as you go: the trust skeleton (zones, planes) at Step 4, approved channels (conduits) at Step 5, `RESTRICTED` promotion at Step 7, and advisory zoning-coherence findings at Step 9. See [Boundary Trust Zones](../BOUNDARY_TRUST_ZONES.md) for the concepts and the GUI equivalent.

**Resume + drift detection.** When resuming a model with a prior baseline (`state.lastReconcileCommit` set at end of discovery), the workflow detects in-scope file changes since the baseline and routes them through `/dethereal:add` / `/dethereal:remove` / `/dethereal:enrich`. See [Drift detection on resume](GUIDED_WORKFLOW.md#drift-detection-on-resume).

**`--full-scan`** bypasses drift detection and re-runs `/dethereal:discover` end-to-end. Use this after a history rewrite, when the baseline is no longer in your branch's ancestry, or when you want to re-baseline against the current source tree.

See [The 11-Step Guided Workflow](GUIDED_WORKFLOW.md) for the complete walkthrough.

---

**Next:** [Model Concepts](MODEL_CONCEPTS.md) — components, boundaries, data flows, classes, and quality scoring
