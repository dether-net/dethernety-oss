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
| 4 | Boundary Refinement | Adjust trust boundaries and enforcement; ratify the trust skeleton (zones, planes) | STRUCTURE_COMPLETE |
| 5 | Data Flow Mapping | Connect components, add operational flows; ratify risk-bearing crossings as approved channels | ENRICHING |
| — | *Session Break* | *Checkpoint — resume later or continue* | — |
| 6 | Classification | Classify remaining elements, tag crown jewels | ENRICHING |
| 7 | Data Item Classification | Classify sensitive data on flows; promote qualifying boundaries to Restricted | ENRICHING |
| 8 | Enrichment | Class-template attributes, security floor, credentials | ENRICHING |
| 9 | Validation | Quality score, gate checks, readiness; advisory zoning-coherence findings | REVIEWED |
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

#### One gate, two tables

Both decisions — the **trust skeleton** (zone + plane) and the **enforcement posture** — are settled in a single batched accept-all / adjust gate. There is no per-boundary interrogation. The plugin computes the proposal; it never silently sets it:

```
## Boundary Refinement

Trust classification (proposed from discovery + scope)
| Boundary    | Zone            | Role (plane) | Resolved              |
|-------------|-----------------|--------------|-----------------------|
| Edge / DMZ  | DMZ       [hi]  | Workload     | declared              |
| App Tier    | Internal        | Workload     | declared              |
| payment-db  | Internal        | Workload     | declared              |
| Logging     | —               | Undecided    | inherited · App Tier  |

Enforcement posture
| Boundary    | Implicit deny   | Any inbound  | Egress                |
| …           | …               | …            | …                     |

Proposed from discovery + scope. Accept all, or adjust specific rows?
```

**Zones are shown by display name, never by their stored value.** The table says "Open internet", "DMZ", "Internal", "Restricted" — `UNTRUSTED`, `EXPOSED`, `INTERNAL`, `RESTRICTED` are what lands in `structure.json`, and you will only see them if you open the file. The mapping is in the [Glossary](GLOSSARY.md#trust-zoning-and-conduits).

**Scan the Resolved column.** It is the one column worth reading row by row, and it is a glyph rather than prose:

| Resolved | Meaning |
|----------|---------|
| `⬆` | Declared **and stricter than its parent** — the case to catch |
| A plain zone name | Declared on this boundary |
| `· inherited · <ancestor>` | Resolves from a named ancestor, not declared here |
| `—` | Unclassified; counted in the Step 9 review |
| `— structural` | A container that nests other boundaries; it abstains and is not counted |

The other columns: **Zone** carries an inline `[hi/med/lo]` confidence from discovery when there was a topology signal to go on. **Role (plane)** is `Workload` or `Management`, defaulting to **Undecided** — which is not the same as Workload. A boundary that is both carries an inline ⚠.

The enforcement posture table carries three attributes:

| Attribute | Options | What It Means |
|-----------|---------|--------------|
| `implicit_deny_enabled` | true / false | Boundary blocks traffic by default |
| `allow_any_inbound` | true / false | Boundary allows unrestricted inbound |
| `egress_filtering` | deny_all / allow_list / allow_all / unknown | Outbound traffic policy |

Notes on how zones behave here:

- A boundary you leave unset **inherits** its nearest declaring ancestor's zone, falling back to Internal.
- **Structural containers abstain.** A boundary that only nests other boundaries renders `— structural` and is not nagged — zone the leaves inside it, not the wrapper.
- This is the **skeleton** phase: it sets the external, exposed, and internal tiers but **defers Restricted**, which needs asset classification (promoted at Step 7).
- **Proposed is not set.** Only rows you accept are written. An unconfirmed boundary keeps no zone and shows up in the Step 9 unclassified count.
- A row already marked `declared` was ratified by you earlier and is never re-proposed, including on resume.
- Identity, compute-node, location, and business grouping are steered to `domains` / `planes` **tags**, not zone-bearing boundaries.

For the concepts and the GUI equivalent, see [Boundary Trust Zones](../BOUNDARY_TRUST_ZONES.md).

**Auto-skip:** This step skips only when the hierarchy is already well-structured (depth >= 2, no single-child boundaries, no external entities in internal boundaries) **and** there are no zone proposals left to ratify:

```
Boundary hierarchy is well-structured (quality factor: 1.0), no zone proposals pending. Skipping refinement.
```

On a freshly discovered model, discovery almost always produces zone proposals — so expect a well-structured model to still stop here for the trust table. That is the trust skeleton doing its job, not the workflow ignoring your structure. You can also jump to Step 4 explicitly at any time.

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

#### Ratify approved channels (conduits)

Once flows exist, the plugin surfaces the **risk-bearing crossings** — flows where an external-tier boundary reaches a trusted one. You ratify the few that are legitimate as **approved channels** (conduits), each with a short justification:

```
Risk-bearing crossings — ratify as approved channels?
| Crossing                          | Ratify? | Why                              |
|-----------------------------------|---------|----------------------------------|
| External → DMZ (Nginx)            | Y       | public entry point               |
| DMZ → Internal (Payment API)      | Y       | front-end forwards requests      |

Ratify selected as approved channels?
```

Ratified crossings are recorded as directional conduits on the source boundary. A crossing you **don't** ratify stays a plain flow and re-surfaces as an advisory `external-ingress` finding at Step 9 — that divergence between declared intent and modeled reality is the review working as designed. Conduits are declared intent only; the platform records them but does not verify or enforce them.

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

#### Restricted promotion

Now that assets and sensitive data are classified, the plugin re-runs the trust determination it deferred at Step 4 and proposes promoting qualifying boundaries to **Restricted** — the strictest tier, for boundaries that hold high-value assets and take ingress only from other trusted tiers. Promotions are folded into a batched confirm:

```
## Restricted promotion — completing the trust skeleton

The promotion we deferred at Step 4: now that data sensitivity and the flow graph exist, these
Internal boundaries qualify for Restricted. This is a safe-direction change (Internal → Restricted)
— tightening only; declared zones are never loosened or overwritten.

| Boundary   | Now      | → Proposed | Why                                               |
|------------|----------|------------|---------------------------------------------------|
| payment-db | Internal | Restricted | holds Card data (PCI), ingress only from App Tier |

Promote all, or adjust?
```

This only ever tightens. A boundary you declared Internet-facing, DMZ, Open internet, or Trusted external is never offered here — exposure outranks asset pull. A boundary you declared Internal *is* offered, but only ever proposed: nothing is written unless you confirm it this turn. If a boundary holds an asset but cannot qualify — it is reachable from a DMZ, or vendor-touched — it stays Internal and surfaces as an `under-protected` finding at Step 9.

**State:** No transition — already at ENRICHING.

---

## Step 8: Enrichment

The most intensive step, and the one hardest to size in advance. The plugin delegates to the **security-enricher** agent.

**Class templates set the workload.** The bulk of the pass walks every field of each element's class template — the stubs written during classification, each field seeded to `null` — and resolves all of them. That means the questions differ per element (a Database is asked about `ssl_enabled`, `password_encryption`, `log_connections`; other classes ask about other things), and the volume scales with your class templates, not with a fixed list. Values the enricher can find in your code, IaC, or config it fills in itself and shows you for confirmation; it asks only about the rest.

**Then a six-attribute floor** is applied to every in-scope component, whatever its class template covered: `authentication_type`, `encryption_in_transit`, `encryption_at_rest`, `implicit_deny_enabled`, and `monitoring_tools` (logging is captured by the class template and has no floor key). Two of these are not free-text choices — `implicit_deny_enabled` is a boolean and `monitoring_tools` is a list — and the key names are read literally by the quality score and the surface report. See [The Six-Attribute Floor](DISCOVERY_AND_ENRICHMENT.md#the-six-attribute-floor) for the exact spellings and accepted values.

**Additional enrichment:**
- **Credential topology** — captured flow by flow: which credential authenticates each cross-boundary flow, and what else that credential reaches
- **Monitoring tools** — SIEM, EDR, NDR coverage per component
- **Auth failure modes** — what happens when authentication fails (deny, fallback, fail_open)
- **Boundary enforcement** — implicit deny, egress filtering per boundary

MITRE ATT&CK techniques are **not** written during this step. Technique coverage is derived on the platform from analysis exposures — see [Discovery and Enrichment Part 3](DISCOVERY_AND_ENRICHMENT.md#part-3-mitre-attck-and-d3fend-integration).

If stale elements exist (from a backward transition), they're enriched first.

The enricher runs without being able to ask you directly, so it returns its work for one batched review: the values it set, plus an explicit **"Operator confirmations needed"** list of everything it took on a defensive default or could not find in code. Accept all or adjust specific rows — nothing is silently accepted on your behalf.

**Control assignment is a separate pass.** The default Step 8 enrichment covers template attributes, the six-attribute floor, credentials, and monitoring. Assigning reusable security Controls (e.g., "Database Encryption Package") to elements is a follow-up pass invoked as `/dethereal:enrich --focus controls` — its own 40-turn budget, auto-pulls referenced Controls, and queues `pendingEdit` blocks for the next push. See [Discovery and Enrichment Part 4](DISCOVERY_AND_ENRICHMENT.md#part-4-control-enrichment).

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

#### Zoning coherence (advisory)

The review also rolls up your **zoning coherence** as an advisory block — up to six findings that check whether your declared segmentation hangs together:

```
Zoning coherence (advisory — never blocks sync):
  [info] external-ingress: DMZ reaches Data Tier with no approved channel
  [info] unclassified: "Legacy Gateway" has no zone (defaults to INTERNAL)
```

The six findings are `unclassified`, `under-protected`, `mgmt-plane`, `external-ingress`, `flow-channel`, and `cross-tier-domain`. They are always **advisory** — they inform you and never block a sync. See [Review and Analysis](REVIEW_AND_ANALYSIS.md#zoning-coherence-advisory) for what each finding means.

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

### Push Consent

Authentication is **not** the last decision point. Passing the auth check — including on a platform running with auth disabled, which counts as authenticated — is permission to *reach* the platform, not permission to publish this model. Before anything is pushed, the plugin asks:

```
Model passed Gate 2 and is ready to publish to <platform URL>.
Push to platform now? (push / skip — resume later with /dethereal:sync push)
```

Answer **skip** to finish the workflow locally and publish later with `/dethereal:sync push`. This is the way to hold a sensitive model back — you do not have to stay logged out, and it works the same on a no-auth platform. The workflow never pushes on your behalf just because authentication succeeded.

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

**Control-library prompts.** If you ran the control pass (`/dethereal:enrich --focus controls`) and have edits to brownfield Controls assigned to multiple Models, the push pauses on the **shared-ownership prompt** — you confirm `cancel`, `push-anyway`, or `push-unverified` per Control. (`clone-and-swap` is a planned V1.1 option; choosing it today returns `CLONE_AND_SWAP_NOT_IMPLEMENTED`. The V1 equivalent is `cancel`, then create a separate Control with `/dethereal:enrich --focus controls`. `push-anyway` and `push-unverified` both **overwrite the shared Control on every model that references it** — the opposite of what you wanted if you reached for clone-and-swap.) Decisions land in `.dethereal/control-audit.log`. If someone else changed a Control on the platform between your pull and push, the push aborts with `EXTERNAL_EDIT_DETECTED`; recover with `/dethereal:sync promote-external-edit <controlId> <classId>`.

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

## Drift detection on resume

When you re-run `/dethereal:threat-model` on a model that already has a baseline, the skill detects drift between your last reconcile point and the current git working tree. If in-scope source files have changed since the baseline commit, the resume path surfaces a four-way delta — REMOVED, ADDED, CHANGED-substrate, CHANGED-attribute-only — and routes each item through the existing `/dethereal:add`, `/dethereal:remove`, or `/dethereal:enrich` flows. You review drift via the same UX you used to author the model.

Two operator-facing details:

- **`/dethereal:threat-model --full-scan`** bypasses drift detection entirely and re-runs `/dethereal:discover` end-to-end. Use this when history was rewritten past the baseline (e.g., a force-push or a branch-switch that orphaned the prior reconcile commit), or when you want to re-baseline against the current source tree.
- **Crown-jewel removal triggers an elevated confirm.** When the drift detector proposes removing an element tagged `crown_jewel: true`, `/dethereal:remove` shows an explicit "this element is tagged as a CROWN JEWEL" prompt before applying. Untagged removals fall through to the standard confirmation.

For the full mechanism (git-diff substrate, scoped scout invocation, four-way delta routing), see [`oss/docs/architecture/dethereal/DRIFT_DETECTION.md`](../../architecture/dethereal/DRIFT_DETECTION.md).

---

## Tips

- **Commit at the session break** — Step 5 is a natural checkpoint. Committing here gives you a clean revert point if enrichment needs to be redone.
- **Jump by step number** — you can type any step number to jump directly to it, without needing to go through intermediate steps.
- **Individual commands work too** — you don't need to use the guided workflow for everything. Run `/dethereal:classify` or `/dethereal:enrich` independently whenever you want.
- **Resume from any session** — your progress is saved in `state.json`. Start a new Claude Code session and run `/dethereal:threat-model` to pick up where you left off.

---

**Next:** [Command Reference](COMMAND_REFERENCE.md) — all 14 commands with syntax and examples
