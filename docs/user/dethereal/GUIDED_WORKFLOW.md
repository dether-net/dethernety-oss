---
title: 'The 11-Step Guided Workflow'
description: 'Complete walkthrough of the /dethereal:threat-model guided process'
category: 'documentation'
position: 3
navigation: true
tags: ['dethereal', 'workflow', 'threat-model', 'guided', 'process']
---

# The 11-Step Guided Workflow

The `/dethereal:threat-model` command walks you through building a complete threat model from scope definition to platform sync. You can stop at any point and resume later — your progress is saved automatically.

---

## Overview

### When to Use the Guided Workflow

Use `/dethereal:threat-model` when you want the full modeling experience. It chains together discovery, classification, enrichment, validation, and sync in a logical order, with checkpoints between phases. For quick tasks (adding a single component, re-classifying one element), use individual commands instead — see the [Command Reference](COMMAND_REFERENCE.md).

### The State Machine

Models progress through 6 states:

```
INITIALIZED → SCOPE_DEFINED → DISCOVERED → STRUCTURE_COMPLETE → ENRICHING → REVIEWED
```

Each state represents a maturity level. The guided workflow advances through these states as you complete steps. If you add or remove components during enrichment, the state automatically reverts to STRUCTURE_COMPLETE to ensure consistency (see [Backward Transitions](#backward-transitions)).

### The 11 Steps at a Glance

| Step | Name | What Happens | State After |
|------|------|-------------|-------------|
| 1 | Scope Definition | Define system, crown jewels, compliance | SCOPE_DEFINED |
| 2 | Discovery | Scan codebase for infrastructure | DISCOVERED |
| 3 | Model Review | Confirm components, initial classification | DISCOVERED |
| 4 | Boundary Refinement | Adjust trust boundaries and enforcement | STRUCTURE_COMPLETE |
| 5 | Data Flow Mapping | Connect components, add operational flows | ENRICHING |
| — | *Session Break* | *Checkpoint — resume later or continue* | — |
| 6 | Classification | Classify remaining elements, tag crown jewels | ENRICHING |
| 7 | Data Item Classification | Classify sensitive data on flows | ENRICHING |
| 8 | Enrichment | Security attributes, credentials, MITRE | ENRICHING |
| 9 | Validation | Quality score, gate checks, readiness | REVIEWED |
| 10 | Sync | Push to platform | REVIEWED |
| 11 | Post-Sync Linking | Link countermeasures to exposures | REVIEWED |

Steps 5 through 8 all operate within the ENRICHING state. Sub-progress is tracked by the quality score (0-100), not by discrete state transitions.

---

## Starting the Workflow

### From a System Description (New Model)

```
> /dethereal:threat-model a payment processing API with PostgreSQL and Redis
```

The plugin starts from Step 1, asking you to define the scope before creating any files.

### Resuming an Existing Model

```
> /dethereal:threat-model ./threat-models/payment-api
```

Or if you only have one model:

```
> /dethereal:threat-model
```

The plugin reads `state.json` and shows a progress table:

```
Progress: "Payment API" (Quality: 56/100)
  [done]        1. Scope Definition
  [done]        2. Discovery
  [done]        3. Model Review
  [auto-skip]   4. Boundary Refinement (hierarchy already well-structured)
  [>>>>]        5. Data Flow Mapping  — current step
  [    ]        6. Classification
  [    ]        7. Data Item Classification
  [    ]        8. Enrichment
  [    ]        9. Validation
  [    ]       10. Sync
  [    ]       11. Post-Sync Linking
```

**Progress markers:**
- `[done]` — step complete (state in `completedStates`)
- `[auto-skip]` — step skipped because its conditions are already met
- `[>>>>]` — current step
- `[    ]` — not yet reached

You can jump to any step by typing its number, or type "continue" to proceed from the current position.

### When the Workflow Is Complete

If `currentState` is `REVIEWED`:

```
Workflow complete. Model is reviewed and ready for analysis.
Run /dethereal:sync push to publish, or /dethereal:surface to review attack surface.
```

---

## Step 1: Scope Definition

The plugin asks about your system through conversation — no forms to fill out.

**What it collects:**

| Field | Required | Example |
|-------|----------|---------|
| System name | Yes | "Payment Processing API" |
| Description | Yes | "REST API handling card transactions with PostgreSQL and Redis cache" |
| Crown jewels | Yes (at least 1) | "Cardholder data", "API keys" |
| Compliance drivers | Optional | SOC2, PCI-DSS, GDPR |
| Modeling depth | Optional (default: architecture) | architecture, design, or implementation |
| Modeling intent | Optional (default: initial) | initial, security_review, compliance, incident_response |
| Adversary classes | Optional (prompted for security_review/incident_response) | external, insider, supply_chain |
| Exclusions | Optional | "Mobile app (separate model)" |
| Trust assumptions | Optional | "AWS infrastructure is trusted" |

**Example conversation:**

```
What are the most valuable assets in this system?
> Cardholder data in the database and API authentication tokens

Any compliance requirements?
> PCI-DSS

What do you explicitly trust?
> AWS control plane and VPC networking
```

The scope is saved to `.dethereal/scope.json` and referenced throughout the workflow — crown jewel names are matched to components during classification, compliance drivers trigger framework-specific enrichment prompts, and adversary class selection (when present) guides discovery and enrichment prompts (e.g., "insider" triggers admin path and credential flow prompts; "supply_chain" triggers CI/CD and dependency chain prompts).

**State after:** SCOPE_DEFINED

---

## Step 2: Discovery

The plugin delegates to the **infrastructure-scout** agent to scan your codebase for infrastructure components. The scout checks 10 source categories:

1. Code structure (package.json, go.mod, etc.)
2. Infrastructure-as-Code (Terraform, CloudFormation, Pulumi)
3. Container definitions (Dockerfiles, docker-compose)
4. Kubernetes manifests (Deployments, Services, NetworkPolicy)
5. API definitions (OpenAPI, gRPC .proto, GraphQL schemas)
6. Network configuration (Nginx, HAProxy, Envoy)
7. CI/CD pipelines (GitHub Actions, GitLab CI)
8. Database schemas (SQL migrations, ORM models)
9. Environment files (variable names only — never secret values)
10. Documentation and diagrams

You'll see a sources-checked summary:

```
Sources checked: IaC/Terraform (12), Containers (3), K8s (—), CI/CD (2), Code (5), API defs (1)
```

Then a batch confirmation table with all discovered elements:

```
| # | Name | Type | Boundary | Confidence |
|---|------|------|----------|------------|
| 1 | payment-api | PROCESS | Internal | high (Terraform) |
| 2 | postgres-db | STORE | Data Tier | high (Terraform) |
| 3 | redis-cache | STORE | Data Tier | high (Docker) |
| 4 | nginx-proxy | PROCESS | DMZ | medium (config) |
| 5 | stripe-api | EXTERNAL_ENTITY | External | medium (code ref) |

Confirm, adjust, or add missing components?
```

After confirmation, the plugin runs a **blind-spots interview** — a consolidated prompt for commonly missed elements:

> Discovery found your main components. Common elements NOT found in code: admin access paths, monitoring/logging flows, backup processes, shared infrastructure (IdP, DNS, CA), deployment pipeline. Are any of these relevant?

This is a single question, not a sequence of individual prompts.

**State after:** DISCOVERED

---

## Step 3: Model Review

Deterministic classification runs first — the plugin queries the platform's class library and matches components by name and type. High-confidence matches (e.g., "PostgreSQL" matches the "Database" class) are pre-filled.

```
| # | Element | Type | Proposed Class | Confidence |
|---|---------|------|----------------|------------|
| 1 | PostgreSQL | STORE | Database | high (deterministic) |
| 2 | Redis | STORE | Key-Value Store | high (deterministic) |
| 3 | Payment API | PROCESS | Web Application | medium (LLM) |
| 4 | Nginx | PROCESS | Reverse Proxy | high (deterministic) |

Confirm classifications? (yes / modify / skip)
```

After classification, the plugin checks **decomposition thresholds**. If your model has 21+ components, 9+ trust boundaries, 36+ data flows, or 19+ cross-boundary flows, it recommends either narrowing scope (model the highest-risk subsystem first) or creating a decomposition plan for multiple models. This is advisory — you can proceed with a large model if you choose.

**State after:** DISCOVERED (no state transition — stays at DISCOVERED until boundaries are refined)

---

## Step 4: Boundary Refinement

Review the trust boundary hierarchy:

```
Trust Boundary Hierarchy:
├── defaultBoundary
│   ├── External
│   │   └── [EXTERNAL_ENTITY] Stripe API
│   ├── DMZ
│   │   └── [PROCESS] Nginx Proxy
│   ├── Internal Network
│   │   └── [PROCESS] Payment API
│   └── Data Tier
│       ├── [STORE] PostgreSQL
│       └── [STORE] Redis
```

The plugin checks for structural issues:
- Single-component boundaries (might need merging)
- Flat hierarchy (no nesting — consider sub-boundaries)
- External entities inside internal boundaries

For each boundary, it prompts for enforcement attributes:

| Attribute | Options | What It Means |
|-----------|---------|--------------|
| `implicit_deny_enabled` | true / false | Boundary blocks traffic by default |
| `allow_any_inbound` | true / false | Boundary allows unrestricted inbound |
| `egress_filtering` | deny_all / allow_list / allow_all / unknown | Outbound traffic policy |

**Auto-skip:** If the boundary hierarchy is already well-structured (depth >= 2, no single-child boundaries, no external entities in internal boundaries), this step shows "Boundary hierarchy is well-structured" and skips automatically. You can still jump to Step 4 explicitly if needed.

**State after:** STRUCTURE_COMPLETE

---

## Step 5: Data Flow Mapping

Connect components with data flows to complete the structural model. The plugin:

1. Reviews existing flows from discovery
2. Identifies orphaned components (no inbound or outbound flows) and prompts you to connect them
3. Prompts for commonly missing operational flows:
   - **Administrative access** — SSH, RDP, management consoles
   - **Monitoring/logging** — components to log aggregators or SIEM
   - **Backup/recovery** — databases to backup destinations

For each new flow, you specify the source, target, protocol, and description.

```
[done] Data flow mapping complete. Quality: 45/100.
```

**State after:** ENRICHING

---

## Session Break

After Step 5, the plugin inserts a checkpoint. Your model structure is complete and saved — everything from here forward reads model files from disk.

**For small models (< 15 components):**

```
Your model structure is complete and saved. You can continue enrichment
now or resume later — your progress is saved.

Consider committing your model before enrichment (clean revert point).

Continue now? (yes / later)
```

**For large models (>= 15 components):**

```
Your model structure is complete and saved. For models this size,
starting enrichment in a fresh session produces better results — the
enrichment phase reads model files from disk and doesn't need the
discovery context.

Consider committing your model before enrichment (clean revert point).

Continue now? (yes / later)
```

**If you choose "later":**

```
To resume: /dethereal:threat-model ./threat-models/payment-api
Your progress is saved at ENRICHING. Resume from Step 6 (Classification).
```

**Why the break?** The enrichment phase (Steps 6-8) works independently from the discovery context accumulated in Steps 1-5. For large models, starting fresh significantly reduces token costs and produces better results because the AI has more context budget for security analysis.

The recommendation is informational — if you continue, the plugin proceeds without asking again.

This is also a good point to commit your model to git, creating a clean revert point if you want to redo enrichment later.

---

## Step 6: Classification (Pass 2)

LLM-assisted classification for elements that weren't matched in the deterministic pass at Step 3. The plugin uses boundary context and peer components to propose classes:

- Components in the "Data Tier" boundary alongside a classified Database are likely also data stores
- Components receiving HTTPS traffic are likely web-facing processes

Crown jewel tagging also happens here — free-text crown jewel names from your scope definition are fuzzy-matched to components and tagged.

**Quality gate:** 100% of STORE components must be classified (stores hold data — classification is critical for analysis). 80% overall classification is the target.

**State:** No transition — already at ENRICHING from Step 5.

---

## Step 7: Data Item Classification

For cross-boundary data flows that carry sensitive data, the plugin proposes data items:

```
Data items for sensitive flows:
| Flow | Data Item | Sensitivity | Compliance | Confirm? |
|------|-----------|-------------|------------|----------|
| User → API | User credentials | Restricted | PCI-DSS | Y |
| API → DB | Cardholder data | Restricted | PCI-DSS | Y |
| API → Redis | Session tokens | Confidential | SOC2 | Y |
```

Sensitivity levels:
- **Restricted** — regulated PII, credentials, cardholder data, health records
- **Confidential** — internal business data, session tokens, API keys
- **Internal** — operational data, metrics, internal logs
- **Public** — public content, documentation

Compliance drivers from your scope definition inform the regulatory mapping.

**State:** No transition — already at ENRICHING.

---

## Step 8: Enrichment

The most intensive step. The plugin delegates to the **security-enricher** agent, which populates security attributes for every component:

**6 key attributes per component:**
1. Authentication — OAuth2, JWT, mTLS, API key, none
2. Encryption in transit — TLS 1.3, TLS 1.2, mTLS, none
3. Encryption at rest — AES-256, none, unknown
4. Logging — access logging, audit logging, centralized
5. Access control — RBAC, ABAC, ACL, none
6. Log telemetry — SIEM, CloudWatch, local, none

**Additional enrichment:**
- **Credential topology** — which components share credentials, where service accounts are used
- **MITRE ATT&CK mapping** — relevant attack techniques per component (verified against the platform, never generated from memory)
- **Monitoring tools** — SIEM, EDR, NDR coverage per component
- **Auth failure modes** — what happens when authentication fails (deny, fallback, fail_open)
- **Boundary enforcement** — implicit deny, egress filtering per boundary

If stale elements exist (from a backward transition), they're enriched first.

For details on the enrichment process, see [Discovery and Enrichment](DISCOVERY_AND_ENRICHMENT.md).

**State:** No transition — already at ENRICHING.

---

## Step 9: Validation

The plugin delegates to the **model-reviewer** agent for a quality assessment:

```
Quality: 78/100 (Good)

Factor Breakdown:
| Factor | Score | Weight | Contribution |
|--------|-------|--------|-------------|
| Component classification | 100% | 25 | 25.0 |
| Attribute completion | 80% | 20 | 16.0 |
| Boundary hierarchy | 100% | 15 | 15.0 |
| Data flow coverage | 90% | 15 | 13.5 |
| Data classification | 60% | 10 | 6.0 |
| Control coverage | 20% | 10 | 2.0 |
| Credential coverage | 10% | 5 | 0.5 |

Quality Gates:
  Gate 1 (Creation):  PASS
  Gate 2 (Sync):      PASS
  Gate 3 (Analysis):  PASS — quality >= 70, all criteria met
```

**If Gate 3 passes** (quality >= 70 and all criteria met): the state advances to REVIEWED and the workflow proceeds to sync.

**If Gate 3 fails:** the plugin shows specific gaps and offers to loop back to Step 8 to fill them:

```
Gate 3 requires: 100% classification (currently 80%), >=80% attributes (currently 60%)

Loop back to Step 8 to fill gaps? (yes / skip to sync anyway)
```

For details on quality scoring and gates, see [Review and Analysis](REVIEW_AND_ANALYSIS.md).

**State after:** REVIEWED (if Gate 3 passes)

---

## Step 10: Sync

Pushes your model to the platform for analysis.

### Pre-Flight Check

Before pushing, the plugin verifies Gate 2 (sync-blocking) criteria: manifest completeness, structure validity, reference integrity. If Gate 2 fails, push is blocked.

### Authentication Check

The plugin checks your token at `~/.dethernety/tokens.json`. If expired or missing:

```
Not authenticated. Run /dethereal:login first, or skip sync for now.
```

If you skip, the workflow jumps to README generation and finishes without sync.

### The Push

- **First push** (no platform model ID): creates a new model on the platform
- **Update** (has model ID): updates the existing platform model, with conflict detection if the platform version has changed

```
Pushed "Payment API" to platform.
  4 boundaries, 6 components, 8 flows, 5 data items.
  Platform model ID: abc-123-def

Server IDs written to local files.
Commit these changes to preserve sync state.
```

For details on sync, conflicts, and version control, see [Sync and Version Control](SYNC_AND_VERSION_CONTROL.md).

---

## Step 11: Post-Sync Linking

After sync, the platform's analysis engine computes exposures (potential vulnerabilities). If your model has countermeasures (security controls linked to components), this step links them to exposures so the platform's defense coverage analysis credits your existing defenses.

**If no countermeasures exist:**

```
No countermeasures defined. After analysis completes, run /dethereal:surface
to see control gaps and exposure distribution.
```

**If countermeasures exist and analysis has run:**

```
Exposure-to-Countermeasure Linking

| Exposure | Component | Candidate Countermeasure | Link? |
|----------|-----------|------------------------|-------|
| SQL Injection | payment-db | Input validation control | Y |
| Auth Bypass | api-gateway | OAuth2 enforcement | Y |

Link all? (yes / modify / defer)
```

If you defer linking: "Analysis will undercount your defenses — defense coverage analysis will not credit existing controls until exposures are linked to countermeasures."

---

## README Generation

After Step 10 (or at workflow end if sync was skipped), the plugin generates a `README.md` in the model directory:

```markdown
# Payment API

> Auto-generated by Dethereal. Do not edit.

## Model Structure

├── External
│   └── [EXTERNAL_ENTITY] Stripe API
├── DMZ
│   └── [PROCESS] Nginx Proxy
├── Internal Network
│   └── [PROCESS] Payment API
└── Data Tier
    ├── [STORE] PostgreSQL
    └── [STORE] Redis

## Data Flows

- End Users → Nginx Proxy: HTTPS requests
- Nginx Proxy → Payment API: Internal API (HTTP)
- Payment API → PostgreSQL: SQL queries (TLS)
- Payment API → Redis: Cache operations

## Status

Quality: 78/100 (Good)
State: REVIEWED
Last synced: 2026-03-27T15:30:00Z
Generated: 2026-03-27T15:30:05Z
```

This README exists for human browsability in git — it is not imported to the platform.

---

## Workflow Completion

```
[done] Threat model "Payment API" complete. Quality: 78/100 (Good). State: REVIEWED.
[next] Run analysis on the platform, then /dethereal:surface (review attack surface)
```

If sync was skipped:

```
[done] Threat model "Payment API" complete. Quality: 78/100 (Good). State: ENRICHING.
[next] /dethereal:sync push (publish to platform for analysis)
```

---

## Backward Transitions

If you add or remove elements during Steps 6-9 (while at ENRICHING or REVIEWED), the state automatically reverts to STRUCTURE_COMPLETE:

```
Adding elements reverted state from ENRICHING to STRUCTURE_COMPLETE.
Enrichment on existing elements is preserved. New elements are tracked
as stale and will be enriched next.
```

The progress table updates to show re-opened steps:

```
  [done]        1. Scope Definition
  [done]        2. Discovery
  [done]        3. Model Review
  [>>>>]        4. Boundary Refinement (re-opened — structural change)
  [    ]        5. Data Flow Mapping
  [    ]        6. Classification
  ...
```

If boundaries are unaffected (e.g., you added a component to an existing boundary), Step 4 auto-skips to Step 5.

**What happens during a backward transition:**
- `currentState` reverts to `STRUCTURE_COMPLETE`
- `quality.json` is deleted (forces recomputation)
- New element IDs are added to `staleElements[]` in `state.json`
- `model_signed_off` is cleared if set

Enrichment data on existing elements is preserved — only the new elements need enrichment. The enrichment step (Step 8) prioritizes stale elements first.

---

## Tips

- **Commit at the session break** — Step 5 is a natural checkpoint. Committing here gives you a clean revert point if enrichment needs to be redone.
- **Jump by step number** — you can type any step number to jump directly to it, without needing to go through intermediate steps.
- **Individual commands work too** — you don't need to use the guided workflow for everything. Run `/dethereal:classify` or `/dethereal:enrich` independently whenever you want.
- **Resume from any session** — your progress is saved in `state.json`. Start a new Claude Code session and run `/dethereal:threat-model` to pick up where you left off.

---

**Next:** [Command Reference](COMMAND_REFERENCE.md) — all 14 commands with syntax and examples
