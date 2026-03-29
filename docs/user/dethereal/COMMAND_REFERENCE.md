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

If already authenticated, returns immediately without opening the browser. Expired tokens are refreshed automatically when possible. If the platform has auth disabled (development/demo mode), all tools work without login.

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

### `/dethereal:enrich [tier1|all|pick] [--focus credentials|monitoring|compliance]`

Populate security attributes, credentials, MITRE ATT&CK references, and monitoring tools.

**Scope arguments:**
- `tier1` — crown jewels only (fastest)
- `all` — all components in tier order (default)
- `pick` — manual selection

**Focus arguments:**
- `--focus credentials` — credential topology only
- `--focus monitoring` — monitoring tools only
- `--focus compliance` — compliance-driven prompts only

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

Shows quality score (7-factor breakdown), quality gate evaluation (Gate 1/2/3), common gaps checklist, top issues, and analysis readiness assessment.

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

### `/dethereal:sync push|pull|status [directory-path]`

Synchronize local model with the Dethernety platform.

**Push (publish local to platform):**

```
> /dethereal:sync push
```

Validates the model (Gate 2 pre-flight), checks for conflicts with the platform version, and publishes. Server-generated IDs are written back to local files.

**Pull (import from platform):**

```
> /dethereal:sync pull
```

Lists platform models, lets you select one, and exports it to local files. If a local model already exists at the target path, offers to backup, overwrite, or cancel.

**Status:**

```
> /dethereal:sync status
```

Shows sync state, last push/pull timestamps, and whether local changes have been pushed.

See [Sync and Version Control](SYNC_AND_VERSION_CONTROL.md) for conflict handling and git integration.

---

## Guided Workflow

### `/dethereal:threat-model [system description or model path]`

The complete 11-step guided workflow — scope definition through validation and platform sync.

```
> /dethereal:threat-model a payment processing API with PostgreSQL and Redis
```

Or to resume an existing model:

```
> /dethereal:threat-model ./threat-models/payment-api
```

This is the recommended approach for new models. It chains together discovery, classification, enrichment, validation, and sync with checkpoints between phases. You can stop at any point and resume later.

See [The 11-Step Guided Workflow](GUIDED_WORKFLOW.md) for the complete walkthrough.

---

**Next:** [Model Concepts](MODEL_CONCEPTS.md) — components, boundaries, data flows, classes, and quality scoring
