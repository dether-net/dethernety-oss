---
title: 'Command Reference'
description: 'Complete reference for all 14 Dethereal slash commands'
category: 'documentation'
position: 5
navigation: true
tags: ['dethereal', 'commands', 'reference', 'skills']
---

# Command Reference

All Dethereal commands carry a `dethereal` prefix; its form depends on your harness (see [Slash Command Syntax](#slash-command-syntax)). This reference uses the Claude Code form. Run `/dethereal:help` for context-aware suggestions, or `/dethereal:help <command>` for usage details.

---

## How Commands Work

### Slash Command Syntax

```
/dethereal:<command> [arguments]
```

Each harness names the commands its own way:

| Harness | Form | Example |
|---------|------|---------|
| Claude Code | `/dethereal:<command>` | `/dethereal:status` |
| Codex | `$dethereal:<command>` | `$dethereal:status` |
| OpenCode | `/dethereal-<command>` | `/dethereal-status` |

Arguments can be natural language, paths, or flags. Most commands work without arguments by using the Model Resolution Protocol — if you have a single model, it's used automatically. If you have multiple, the plugin asks you to choose.

### Agent Delegation

Only `review` and `surface` run as a dedicated AI agent. The other commands run in the main conversation and start a specialist agent where a step needs one:

| Agent | Role | Commands |
|-------|------|----------|
| *(no agent)* | Runs in the main conversation — no dedicated agent, so no agent-level tool allowlist applies | status, login, help, view, sync, create, add, remove, classify, enrich, discover, threat-model |
| model-reviewer | Read-only quality analysis | review, surface |

Specialist agents started by commands:

| Agent | Role | Started by |
|-------|------|------------|
| infrastructure-scout | Read-only discovery scan | discover, threat-model |
| infrastructure-scout-scoped | Drift re-verification | threat-model (resume) |
| security-enricher | Classification, enrichment and the control pass | enrich (`--focus controls`), threat-model |
| enrichment-applier | Writes what your reply to the enrichment relay decides | threat-model (Step 8) |
| model-reviewer | Read-only review | threat-model |

The threat-modeler agent is not started by any command. You can start it yourself to edit a model's files: on Claude Code with `@agent-dethereal:threat-modeler`, on Codex by asking the conversation to start the `dethereal-threat-modeler` agent, and on OpenCode by mentioning `@dethereal-threat-modeler`. It sends other work to the command that runs it — removing elements to `/dethereal:remove`, for example. On Claude Code, when you start it directly, it hands a scan, classification proposals, enrichment and a review to the specialist agents itself; on Codex and OpenCode it runs as a subagent of your conversation, which relays its questions, and starts no other agent (see [threat-modeler](AGENTS_AND_ARCHITECTURE.md#threat-modeler-model-editor)).

### Post-Action Footer

Every command that modifies model files ends with a footer showing quality and recommended next steps:

```
[done] Action complete. State: <state>. Quality: X/100.
[next] When you're ready: /dethereal:foo (reason for next step)
```

The state is shown as the server reports it, with its qualifiers — waivers, a stale review, or the quick mark, for example `ENRICHING (quick)`.

---

## Foundation Commands

### `/dethereal:status [show models <controlId> [directory-path]]`

Show connection status, sign-in state, local model summary, and a per-model control-library roll-up.

```
> /dethereal:status

Dethernety status
─────────────────────────────────────────
Platform:   https://dethernety.example.com
Sign-in:    Signed in (user@example.com, 59 min left)
─────────────────────────────────────────

Local models:
  Production Stack  ./threat-models/prod  56/100  ENRICHING   local changes since the last push
  Dev Environment   ./threat-models/dev   23/100  DISCOVERED  never synced

Control library (Production Stack): 14 controls
  Pending edits:   2 controls with edits to push
    - Azure Firewall (Hub) [Firewall Policy]: 5 keys, edited by agent at 2026-04-18T10:30Z
    - NSG Least-Privilege Ingress [Network Access Control]: 2 keys, edited by operator at 2026-04-18T11:05Z
  Not yet pushed:  1 control (greenfield or partially pushed)
  Drift:           1 control differs from the platform with no pending edit (an external edit):
                   - "TLS 1.3 (API Gateway)" (ctrl-7f3a)
                   /dethereal:sync push stops on it; recover it with /dethereal:sync promote-external-edit <control id> <class id>
  Stale:           1 control last synced 3h ago — refreshed at the next push, or /dethereal:enrich --focus controls
  Orphan files:    ctrl-abc-123.json — referenced by no element; remove it or re-link it with /dethereal:enrich
  Tombstoned:      1
  Recovery journal present: run /dethereal:sync repair-wal before anything else

/dethereal:help lists the commands.
```

A `Control library (<model-name>):` block is rendered per model that has controls. Its rows are `Pending edits`, `Not yet pushed`, `Drift`, `Stale`, `Orphan files`, `Tombstoned`, and `Recovery journal present`; a row with a zero count is left out, except that a recovery journal always shows. **Drift** is the only place a suspected external edit — a control file changed outside the plugin — is surfaced proactively; it is what routes you to `/dethereal:sync promote-external-edit`. Every drifted control is listed. With more than 10 pending edits, stale controls, or orphan files, the first 5 are listed, then `(N more — run /dethereal:enrich --focus controls)`.

**Sub-verb:**

```
> /dethereal:status show models <controlId>
```

Lists the model IDs assigned to a Control, read from the `platformState.assignedModelIds` cached in the local `controls/<controlId>.json` — no fresh platform query. If the Control has not been pulled locally, the command says so and points you at `/dethereal:enrich --focus controls`. Only model ids are shown: the platform does not report a model's owner or last change yet.

Model and control-library data come from local files. The connection and authentication lines come from the plugin's MCP server, which may contact the platform to load its configuration and refresh an expired session (bounded to 10 seconds). Session tokens are never read into the conversation.

---

### `/dethereal:login [--new]`

Sign in to the Dethernety platform in your browser.

**Arguments:**
- `--new` — start a fresh sign-in even when a session exists (for example, to switch accounts)

```
> /dethereal:login

Signed in (signed in).
Platform:     https://dethernety.example.com
Account:      user@example.com
Valid for:    60 minutes
```

The first line says `already signed in` when the session was still valid — no browser opens — and `session renewed` when an expired session was refreshed. If the browser sign-in has not finished when the command returns, it says `Not signed in yet. Open <sign-in URL> in your browser and sign in, then run /dethereal:login again.` If the platform has auth disabled (no-auth mode), it says so and all tools work without login.

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

Data flows (5):
  1. End Users → Web Server: HTTP requests
  2. Web Server → API Server: API calls (HTTPS)
  3. API Server → Database: SQL queries
  4. API Server → Cache: Cache lookups
  5. Database → API Server: Query results

Data items (2):
  • User Credentials (classified: PII)
  • Session Tokens (classified: Credentials)

Quality: 56/100 (In Progress) — how complete the model is, not how secure the system is
  Component classification   60%
  Attribute completion       40%
  …one line per factor

Sync: last pushed 2h ago | Platform model ID: abc123
```

---

## Modeling Commands

### `/dethereal:create [description or template] [--full]`

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

**`--full`** makes the new model a full model. Without it, a model you describe, start from a template or import is a **quick model**, marked as its scope is recorded: it is never REVIEWED, and its README opens with the "Quick model, not reviewed" banner. A model pulled from the platform is never marked. `--full` is a flag, never read as part of the description, path or template name. On a quick model the footer adds one line — on an import, after discover's footer:

```
[info] Quick model: /dethereal:threat-model continues it; with --full it builds it in full.
```

See [Quick Mode](GUIDED_WORKFLOW.md#quick-mode).

**Creates:** Model directory at `./threat-models/<name>/` with manifest, structure, dataflows, data-items, scope, state, and README.

**State after:** SCOPE_DEFINED

---

### `/dethereal:discover [model path] [--scan <directory or file>]`

Scan your codebase for infrastructure components using the infrastructure-scout agent.

**Arguments:**
- `[model path]` — the model to add to (optional if you have one model)
- `--scan <directory or file>` — scan only that directory or file instead of the whole codebase

```
> /dethereal:discover
> /dethereal:discover --scan ./infrastructure/
```

The plugin scans 11 source categories (IaC, containers, K8s, APIs, CI/CD, diagrams, documentation, etc.), presents a batch confirmation table, then runs a blind-spots interview to catch commonly missed elements.

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

Add these elements as shown, or adjust specific rows? (add / adjust)
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
  Attribute files (deleted once you approve):
    - attributes/components/abc123.json

Proceed? (yes / no / component only)
```

After the removal, the plugin deletes the removed elements' attribute files through the `model_state_prune` MCP tool. The files are the ones in the table you confirmed in the chat — that table is where you check them, on every harness — and nothing is deleted until you approve the call. The server deletes only files it finds orphaned itself: a structured attribute file named for an element id that no element group holds any more. The deletion is all or nothing, at most 50 files a call. With more than 50 files, the plugin pages through them: each result names the next page, which the plugin prunes next when every file on it was in the table you confirmed; otherwise it shows that page and asks you to confirm it first.

- **Files it never deletes.** A flat attribute file, a file named for an id other than the one it holds, or a file whose name differs from a live element id only in letter case is listed as not deleted. Handle those by hand in your own terminal; Gate 2 (`no_orphan_attribute_files`) names any that are left behind.
- **Files that block the prune.** If an attribute file cannot be read as element attributes (a flat or broken file), nothing is deleted. Fix the file, or remove it by hand, then prune again.

If removing a boundary, child components are relocated to the parent boundary — they're never silently deleted.

**State behavior:** Same as `/dethereal:add` — backward transition at ENRICHING or later.

---

## Classification and Enrichment Commands

### `/dethereal:classify`

**Usage:** `/dethereal:classify [--type components|flows|boundaries|data-items]`

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

| # | Element | Type | Proposed Class | Module | Confidence | Match | Crown Jewel |
|---|---------|------|----------------|--------|------------|-------|-------------|
| 1 | PostgreSQL | STORE | Database | dethernety-general | high (IaC) | exact_name | yes |
| 2 | Redis | STORE | Key-Value Store | dethernety-general | high (IaC) | fuzzy | — |
| 3 | API Server | PROCESS | Web Application | dethernety-general | medium (LLM) | — | — |

Apply these classes, or modify rows? (yes / modify / skip)
```

**Gate:** Gate 3's C1 — every non-external component classified — with C6 for the crown jewels. If C1 fails, or flows, boundaries, or data items are still unclassified, the plugin lists them by name, STOREs first, and asks: `Classify these elements now, or skip with the gap on record? (classify / skip)`.

**State:** No transition — classification is tracked by the quality score.

---

### `/dethereal:enrich [all|priority|pick] [--focus credentials|monitoring|compliance|controls] [--pick <element-id>]`

Populate security attributes, credentials, data items, monitoring tools, and security controls.

**Scope arguments:**
- `priority` (alias `tier1`) — the priority set only (fastest): the snapshot the plugin takes from Gate 3 at the start of the run — crown jewels and their mapped elements, the Tier 1–2 components and flows Gate 3 lists as still missing values, and the cross-boundary pivots. See [Enrichment Order and the Priority Set](DISCOVERY_AND_ENRICHMENT.md#enrichment-order-and-the-priority-set)
- `all` — the whole worklist, priority set first (default)
- `pick` — manual selection (interactive list)

Tiers are computed by the server, never assigned by you; see [Component Tiers](DISCOVERY_AND_ENRICHMENT.md#component-tiers).

**Focus arguments:**
- `--focus credentials` — credential topology only
- `--focus monitoring` — monitoring tools only
- `--focus compliance` — compliance-driven prompts only
- `--focus controls` — control assignment pass (a separate invocation: the security-enricher agent runs apart from the attribute enrichment, with its own limit of 40 turns on Claude Code or 40 steps on OpenCode; the plugin sets none on Codex). Auto-pulls referenced Controls, lets you edit per-instance attributes, and queues `pendingEdit` blocks for the next push. Greenfield Controls get a temporary ID; brownfield Controls write to `controls/<id>.json`. See [Discovery and Enrichment](DISCOVERY_AND_ENRICHMENT.md#part-4-control-enrichment).

**Targeted flag:**
- `--pick <element-id>` — target a single element by id, skipping the interactive selector. Drift detection on resume uses it to re-enrich an element whose technology or attributes changed in your source; also available for direct invocation when you know the element id.

```
> /dethereal:enrich
```

Shows the worklist by name, stale elements first, with the tier sizes from Gate 3, then asks for the scope unless you gave one:

```
Worklist: 14 elements
  Crown jewels:           payment-db, user-db
  Rest of priority set:   api-gateway, auth-service, web-frontend
  Failing flows:          Client → API Gateway, API Gateway → Auth Service
  Others:                 7 elements
Tiers: Tier 1: 2 · Tier 2: 3 · Tier 3: 8 (1 unzoned)
Cross-boundary pivots: 2 (a label: not added to the tiers)

Enrich the whole worklist, only the priority set (what Gate 3 holds to its floors),
or pick elements? (all / priority / pick)
```

The enricher then works through the worklist in batches of at most 15 questions; each batch is confirmed and written before the next.

Enrichment is driven by each element's **class template**, not by a fixed question list. The attribute stub written during classification contains every field the assigned class declares, seeded to `null`; those null fields are the checklist, and every one of them must be resolved to a concrete value. The plugin looks for values in code, IaC, and config first, then asks you only about what it could not find.

The **six key attributes** are a floor applied after the template pass — checked on every in-scope component regardless of what its class template happened to cover. See [The 6 Key Component Attributes](MODEL_CONCEPTS.md#the-6-key-component-attributes) for the exact key names, which must be written literally.

Enrichment also covers credential mapping and monitoring tools. It does **not** write MITRE ATT&CK technique IDs onto attribute files — tactic coverage is derived on the platform from analysis exposures.

Each part has its own question here. After the attribute batches come the data items, then the credentials — the Credentials table, then the Credential mapping — and then boundary enforcement. Credentials follow the data items so that every flow carrying a credential data item gets a credential row. (Step 8 of `/dethereal:threat-model` asks the credential, mapping, boundary, and open-field rows together in [one relay turn](GUIDED_WORKFLOW.md#one-relay-turn).)

Because `attribute_completion_rate` (20 points of the quality score) counts resolved **template** fields, answering only the six and stopping leaves the score low — the remaining null fields in each attribute file are the outstanding work.

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

Shows the quality gate evaluation (Gate 1/2/3), quality score (7-factor breakdown), the [red flags](REVIEW_AND_ANALYSIS.md#red-flags), the advisory [zoning-coherence roll-up](REVIEW_AND_ANALYSIS.md#zoning-coherence-advisory) (six finding kinds, never sync-blocking), common gaps checklist, top issues, recommendations, the model's state, and analysis readiness assessment. The red flags are every insecure value recorded in the attribute files, under a heading with their count, plus flows that fail open or fall back on an authentication failure, crown jewels with no control, controls whose class binding is empty, and — on a synced model — controls with no countermeasure after analysis.

**Structure-only review:**

```
> /dethereal:review --structure-only
```

Lightweight structural validation, with no gates and no score. Each check reports `[PASS]`, `[FAIL]`, or `[WARN]`:

1. Required fields — the manifest's name and description, the default boundary, the data-flow list
2. Unique IDs — no ID used twice across components, boundaries, flows, and data items
3. References — every flow's source and target exists (FAIL)
4. Unconnected components — no flow in or out (WARN)
5. Empty boundaries — no component and no child boundary (WARN)
6. Orphaned attribute files — a file in `attributes/` whose element no longer exists (WARN)
7. Schema — the full schema validation

Useful for catching errors before enrichment.

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
4. Control gap analysis by component tier
5. MITRE ATT&CK tactic coverage
6. Credential topology and blast radius
7. Detection coverage and SOC blind spots
8. Cross-model analysis boundaries

See [Review and Analysis](REVIEW_AND_ANALYSIS.md) for details.

---

## Sync Commands

### `/dethereal:sync push|pull|status|repair-wal|promote-external-edit|tombstone [...]`

Synchronize local model with the Dethernety platform, plus three recovery verbs for the control-library workflow.

**Push (publish local to platform):**

```
> /dethereal:sync push
```

Validates the model (Gate 2 pre-flight), checks for conflicts with the platform version, and publishes. Server-generated IDs are written back to local files.

Before it writes anything, the push links every `controls` entry to your organisation's control catalog — an entry with an `id` to that Control only, an entry without one only to a Control with exactly the same name (no case-insensitive or partial match). An entry with a greenfield temporary id (`greenfield-…`) is deferred: the control library's greenfield push creates and links it after the model push. If any entry cannot be linked, the whole push is refused and nothing is pushed. The plugin lists every such entry in one table and asks you, per row, for a candidate's number, `create` (a new Control under that name, with your approval), `remove`, or another Control's exact name; `not now` cancels. It never picks for you. You then confirm the changed entries in `/dethereal:threat-model`, and run `/dethereal:sync push` again. See [Sync and Version Control](SYNC_AND_VERSION_CONTROL.md#control-references).

If your edits change Controls that other Models also use, the push pauses on the **shared-ownership prompt**. For a single shared Control it asks `(cancel / push-anyway)`. With several to decide, a key that conflicts with the platform, or unknown ownership, it shows a review screen: you give `cancel`, `push-anyway`, or `push-unverified` per Control, and per-key decisions for conflicting keys, then type `done`. To fork a shared Control instead, cancel it and create a separate Control with `/dethereal:enrich --focus controls`. Decisions are recorded in `.dethereal/control-audit.log`, which stays on your machine and records no attribute values. See [Sync and Version Control](SYNC_AND_VERSION_CONTROL.md#shared-ownership-prompts).

**Pull (import from platform):**

```
> /dethereal:sync pull
```

Lists platform models, lets you select one, and exports it to local files. If the local model at the target path has changes the platform does not have, it asks `(push first / backup / overwrite / cancel)`: **push first** stops so you can run `/dethereal:sync push` and then pull again; **backup** and **overwrite** both pull, and both take a backup first; **cancel** changes nothing. Pulling also materialises `controls/<id>.json` for every Control referenced by the model.

**Status:**

```
> /dethereal:sync status
```

Shows the model's name, state, and quality; its platform model ID (or "not pushed"), the platform URL, and who is signed in; the last push and pull; whether there are local changes (no local changes, local changes not pushed, never synced, or unknown with the reason); the control-library counts that are not zero — a recovery journal points you to `/dethereal:sync repair-wal`; and the IDs of referenced models.

**Recovery verbs (control-library workflow):**

```
> /dethereal:sync repair-wal [directory-path]
```

Show a stranded recovery journal (`.dethereal/pending-id-rewrite.json`) and ask how to recover it: `(cancel / retry / clear)`. **cancel** keeps the journal; **retry** replays it, after you have resolved an ambiguous file pair by hand; **clear** deletes it — you confirm by typing `clear-journal` — and leaves the control files for you to reconcile. Use when a command reports `WAL_REPLAY_FAILED`, or `WAL_JOURNAL_REJECTED` for a journal this machine did not write for this model; such a journal is never replayed, so only cancel and clear are offered.

```
> /dethereal:sync promote-external-edit <controlId> <classId>
```

Unblock the push's external-edit guard. When a local control file's `attributes` differ from its `platformAttributes` with no `pendingEdit` — the file was changed outside the plugin, by hand or by another tool — the push refuses that Control. This verb shows each diverging key (platform value → local value) and, once you confirm, records your **local** values as your edit, so the next push publishes them. The local `attributes` are left untouched. No platform mutation; purely local.

```
> /dethereal:sync tombstone <controlId>
```

Mark a Control as tombstoned locally: it is left out of pushes, and the platform Control is not deleted. A later pull brings it back while the model still references it — remove the reference to retire it for good.

**Long values in a shared-ownership prompt.** A large per-key value (a long list, a multi-paragraph text) is given with the same `merge <n>.<key> = <json>` verb, pasted as one JSON literal; a multi-line paste carries it whole. The skill never reads a value from a file.

See [Sync and Version Control](SYNC_AND_VERSION_CONTROL.md) for conflict handling and the control-library push flow.

---

## Guided Workflow

### `/dethereal:threat-model [system description or model path] [--full-scan] [--full|--quick]`

The 11-step guided workflow — scope definition through validation and platform sync. A call that starts a new model builds a quick model unless you add `--full`; see **Quick by default** below.

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

**`--full-scan`** bypasses drift detection and re-runs Step 2 (Discovery) end-to-end. Use this after a history rewrite, when the baseline is no longer in your branch's ancestry, or when you want to re-baseline against the current source tree.

**Quick by default.** A new model — one this command starts (from a system description, or with no model at all) or one made with `/dethereal:create` — is a **quick model** unless its run has `--full`: a shorter workflow with Steps 1–7 in full, Step 8 on the priority set only with the control pass deferred, and a read-only Step 9 (quality score, red flags and top findings, no Gate 3 verdict or review record), then publishing. The model is marked quick (its state reads, for example, `ENRICHING (quick)`) and is never REVIEWED. On an existing model, a run without a mode flag keeps the model's mode and resumes it: a paused or newly created quick model continues as a quick run, and a model pulled from the platform, or created with `--full`, continues as a full run. Your confirmation of every value, the Gate 2 check before a push, and the secret-file and scope-exclusion rules are never relaxed. See [Quick Mode](GUIDED_WORKFLOW.md#quick-mode).

**`--full`** runs the full workflow on a new model, which is not marked quick. On a quick model it deepens it: the mark is cleared and, once the quick run has passed Step 7, the run resumes at Step 8 with the full scope, then the normal Step 9; a quick run stopped before Step 7 resumes where it stopped. When the step it takes up is Step 7 or later, a [Step 6](GUIDED_WORKFLOW.md#step-6-classification-pass-2) classification pass and its classification gate run first, so your classes get the second look a quick run may have skipped. `--full` is not `--full-scan` (above), which changes discovery, not the mode.

**`--quick`** makes a quick model explicitly. On a new model it gives the same quick model as no flag; on an existing full model it sets the mark when the run starts. On a REVIEWED model it is refused.

```
> /dethereal:threat-model a payment processing API with PostgreSQL and Redis --full
```

See [The 11-Step Guided Workflow](GUIDED_WORKFLOW.md) for the complete walkthrough.

---

**Next:** [Model Concepts](MODEL_CONCEPTS.md) — components, boundaries, data flows, classes, and quality scoring
