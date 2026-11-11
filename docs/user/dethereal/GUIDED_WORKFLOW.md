---
title: 'The 11-Step Guided Workflow'
description: 'Complete walkthrough of the /dethereal:threat-model guided process'
category: 'documentation'
position: 4
navigation: true
tags: ['dethereal', 'workflow', 'threat-model', 'guided', 'process']
---

# The 11-Step Guided Workflow

The `/dethereal:threat-model` command walks you through building a threat model from scope definition to platform sync. You can stop at any point and resume later — your progress is saved automatically.

---

## Overview

### When to Use the Guided Workflow

Use `/dethereal:threat-model` when you want the guided modeling experience. It chains together discovery, classification, enrichment, validation, and sync in a logical order, with checkpoints between phases. For quick tasks (adding a single component, re-classifying one element), use individual commands instead — see the [Command Reference](COMMAND_REFERENCE.md).

A new model — one the workflow starts from a system description or with no model at all, or one you made with `/dethereal:create` — is a quick model by default: a first pass you deepen later, which builds the whole structure, enriches only the priority set, and publishes without a Gate 3 review. For the full run from the start, add `--full` to the command that makes the model. A model pulled from the platform is a full model. See [Quick Mode](#quick-mode).

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
| 2 | Discovery | Scan codebase for infrastructure; select modules | DISCOVERED |
| 3 | Model Review | Confirm components, initial classification | DISCOVERED |
| 4 | Boundary Refinement | Adjust trust boundaries and enforcement; ratify the trust skeleton (zones, planes) | STRUCTURE_COMPLETE |
| 5 | Data Flow Mapping | Connect components, add operational flows; ratify risk-bearing crossings as approved channels | ENRICHING |
| — | *Session Break* | *Checkpoint — resume later or continue (full run only)* | — |
| 6 | Classification | Classify remaining elements, tag crown jewels | ENRICHING |
| 7 | Data Item Classification | Classify sensitive data on flows; promote qualifying boundaries to Restricted | ENRICHING |
| 8 | Enrichment | Class-template attributes, security floor, credentials | ENRICHING |
| 9 | Validation | Quality score, gate checks, readiness; advisory zoning-coherence findings; the review record | REVIEWED if you record the review, otherwise ENRICHING |
| 10 | Sync | Push to platform | Unchanged |
| 11 | Post-Sync Linking | Link countermeasures to exposures | Unchanged |

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

The plugin asks the server for the model's state (the state file is never read directly) and shows a progress table:

```
Progress: "Payment API" (Quality: 56/100)

| Step | Name                                        | Status      |
|------|---------------------------------------------|-------------|
| 1    | Scope Definition                            | [done]      |
| 2    | Discovery (modules: dethernety-general)     | [done]      |
| 3    | Model Review                                | [done]      |
| 4    | Boundary Refinement                         | [auto-skip] |
| 5    | Data Flow Mapping                           | [>>>>]      |
| 6    | Classification                              | [    ]      |
| 7    | Data Item Classification                    | [    ]      |
| 8    | Enrichment                                  | [    ]      |
| 9    | Validation                                  | [    ]      |
| 10   | Sync                                        | [    ]      |
| 11   | Post-Sync Linking                           | [    ]      |
```

**Progress markers:**
- `[done]` — step complete. Steps 1–5 count as done by the state the model has reached, Step 6 once Gate 3's C1 passes, and Step 7 once a quick run has passed it. Steps 7–9 are otherwise never skipped on their own.
- `[auto-skip]` — Step 4, skipped because its [auto-skip conditions](#step-4-boundary-refinement) hold
- `[>>>>]` — current step: the first step not done. If a Step 9 loop back is still open, the cursor is at Step 9.
- `[    ]` — not yet reached

Step 2 shows the active modules. The plugin then asks:

```
Continue from Step 5, or jump to a step? (continue / a step number)
```

### When the Workflow Is Complete

If the model is `REVIEWED` and the review is not stale (the model has not changed since it):

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
| Adversary classes | Optional (asked for every intent) | external, insider, supply_chain |
| Exclusions | Optional | "Mobile app (separate model)" |
| Trust assumptions | Optional | "AWS infrastructure is trusted" |

**Example conversation.** The plugin takes what you already said and asks for the rest in one question:

```
To scope the model: the system's name and a one-line description, if you have not
given them. What are the most valuable assets in this system (crown jewels)? What do
you explicitly trust? Which adversary classes should it consider (external, insider,
supply_chain, others)? Anything out of scope? Any compliance requirements, and the
depth and intent if not the defaults?

> Cardholder data in the database and API authentication tokens. We trust the AWS
  control plane and VPC networking. External attackers and insiders. The mobile app
  is a separate model. PCI-DSS.
```

The scope is saved to `.dethereal/scope.json` and referenced throughout the workflow — crown jewel names are matched to components during classification, compliance drivers trigger framework-specific enrichment prompts, and the adversary classes you declare drive enrichment questions (e.g., "insider" adds a question on administrative access paths; "supply_chain" a question on the CI/CD system, its credentials, and its registries). Discovery is not steered by them: the scout receives the system name, description, crown jewels, and exclusions.

**Exclusions remove what a provider runs inside a service, never the service your system uses.** A managed database, cluster, or queue your system stores data in or runs on stays a component in scope; only its provider-side internals — storage-key binding, log export, the control plane — are out of scope. When an exclusion could mean either, the plugin keeps the service and says so.

**State after:** SCOPE_DEFINED

---

## Step 2: Discovery

The plugin delegates to the **infrastructure-scout** agent to scan your codebase for infrastructure components. The scout checks 11 source categories:

1. Code structure (package.json, go.mod, etc.)
2. Infrastructure-as-Code (Terraform, CloudFormation, Pulumi)
3. Container definitions (Dockerfiles, docker-compose)
4. Kubernetes manifests (Deployments, Services, NetworkPolicy)
5. API definitions (OpenAPI, gRPC .proto, GraphQL schemas)
6. Network configuration (Nginx, HAProxy, Envoy)
7. CI/CD pipelines (GitHub Actions, GitLab CI)
8. Database schemas (SQL migrations, ORM models)
9. Environment files (variable names only — never secret values)
10. Architecture diagrams (always low confidence; you confirm them explicitly)
11. Documentation (supporting evidence only)

You'll see a sources-checked summary:

```
Sources checked: Code (5), IaC/Terraform (12), Containers (3), K8s (—), API defs (1), Network (—), CI/CD (2), DB schemas (—), Env files (1), Diagrams (—), Docs (2)
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

I found 5 components, 4 boundaries, and 6 data flows. Review the table above:
- Are any components missing? (shared infrastructure, third-party services, admin tools)
- Should any be removed? (false positives, out-of-scope)
- Are the suggested types and classes correct?

Respond with changes or "looks good" to confirm.
```

After confirmation, the plugin runs a **blind-spots interview** — one consolidated question for elements code analysis systematically misses:

1. **Shared infrastructure** — identity provider, DNS, certificate authority, log aggregator, SIEM, secret manager
2. **Side-channel data flows** — logging pipelines, metrics collection, DNS resolution, backup/replication, health checks
3. **Deployment pipeline** — CI/CD platform, container registries, artifact stores, deployment agents
4. **Third-party SaaS** — OAuth providers, payment processors, CDN, email/SMS services, webhook consumers
5. **Human actors with privileged access** — system admins, database admins, on-call engineers, third-party support
6. **Shared credentials** — service accounts used by multiple components, shared API keys, reused database credentials

This is a single question, not a sequence of individual prompts.

### Decomposition Check

Before anything is written to the model files, the plugin checks the confirmed inventory against **decomposition thresholds**. If it has 21+ components, 9+ trust boundaries, 36+ data flows, or 19+ cross-boundary flows, the plugin shows the thresholds exceeded and asks:

```
The model exceeds the complexity thresholds shown. Narrow the scope, plan a
decomposition, or continue with one model? (narrow / decompose / continue)
```

- **narrow** — model the highest-risk subsystem (the one with your crown jewels) first
- **decompose** — plan several models, tracked in `.dethernety/decomposition-plan.json`
- **continue** — keep one model; the check is advisory

For **narrow** and **decompose**, the plugin shows the proposed split as a table and asks you to confirm it before anything is written.

### Module Selection

Next, the plugin recommends the platform modules to classify against, based on the source types discovery found. `dethernety-general` is always included and can't be removed. It shows the recommended modules with the reason for each, lists the other installed modules below them, and asks:

```
Use these modules for classification? (yes / modify)
```

Your choice is saved to `.dethereal/scope.json`. The plugin then shows, once, the module list the model will carry. The server derives this list, so you never enter module references yourself (see [manifest.json](MODEL_CONCEPTS.md#manifestjson)). With no discovery results (a model you described, with no codebase to scan), the plugin makes no recommendation and classification searches every installed module.

**State after:** DISCOVERED

---

## Step 3: Model Review

Deterministic classification runs first — the plugin queries the platform's class library and matches components, boundaries, and data flows by name, type, and description. High-confidence matches (e.g., "PostgreSQL" matches the "Database" class) are pre-filled.

An element discovered from infrastructure-as-code keeps its IaC pre-classification only when that class comes from one of your selected modules. Otherwise, the plugin proposes a class from the selected modules, and the table's note names the dropped class and its module. To use that class, answer **add** when Step 6 asks about its module (see [Modules outside your selection](#modules-outside-your-selection)).

A cloud provider's managed service your system consumes as a dependency — key management, a secret manager, managed log groups, a managed certificate service — is proposed as an `EXTERNAL_ENTITY` with the baseline module's **External Cloud Service** class when no class in your selected modules fits it as an internal component. Its row proposes the type and the class together, never an unclassified internal store. The service belongs in the provider's own external boundary, never an internal one, and a flow to it runs from the component that calls it (a database to key management, an application to a secret manager or a log group), never from the service into your system unless the service starts the call. A store your system runs itself, such as Secrets inside your own cluster or a self-hosted vault, stays internal.

```
| # | Element | Type | Boundary | Proposed Class | Confidence |
|---|---------|------|----------|----------------|------------|
| 1 | PostgreSQL | STORE | Data Tier | Database | high (deterministic) |
| 2 | Redis | STORE | Data Tier | Key-Value Store | high (deterministic) |
| 3 | Payment API | PROCESS | Internal | Web Application | medium (LLM) |
| 4 | Nginx | PROCESS | DMZ | Reverse Proxy | high (deterministic) |

Confirm these classes, or modify rows? (yes / modify / skip)
```

The decomposition check has already run, in [Step 2](#decomposition-check).

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

**Every finding becomes a row** of a proposed-changes table; the plugin never drops one because it judges the change unwise. A row's **Change** column is the recommended action:

- A **merge**, a **move**, or a new **sub-boundary** — with the elements it moves, why, and, for a merge, the zone the merged boundary keeps.
- **Keep as is** — with the alternative change and why it isn't recommended. A single-component boundary is often correct: a DMZ holding only a reverse proxy, for example.

```
Apply these hierarchy changes, or adjust specific rows? (apply all / adjust)
```

**apply all** applies the recommended actions, so a keep row changes nothing. **adjust** takes a row's alternative instead. When the hierarchy's quality factor is below 1.0 there is always at least one row. With no finding, the plugin says so in one line and asks nothing.

#### One gate, two tables

Both decisions — the **trust skeleton** (zone + plane) and the **enforcement posture** — are settled in a single batched accept-all / adjust gate. There is no per-boundary interrogation. The plugin computes the proposal; it never silently sets it:

```
## Boundary Refinement

Trust classification (proposed from discovery + scope)
| Boundary    | Zone               | Role (plane) | Resolved              | Note                                        |
|-------------|--------------------|--------------|-----------------------|---------------------------------------------|
| Edge / DMZ  | DMZ       [hi]     | Workload     | declared              |                                             |
| App Tier    | Internal           | Workload     | declared              |                                             |
| payment-db  | Internal           | Workload     | declared              |                                             |
| Logging     | —                  | Undecided    | inherited · App Tier  |                                             |
| External    | Open internet [lo] | Undecided    | —                     | holds only external entities: Stripe API    |
| Batch       | needs a zone       | Undecided    | —                     |                                             |

Enforcement posture
| Boundary    | Implicit deny   | Any inbound  | Egress                |
| …           | …               | …            | …                     |

Accept the trust classification and the Enforcement posture as proposed, or adjust specific rows? (accept all / adjust)
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

The other columns: **Zone** is discovery's proposal, with an inline `[hi/med/lo]` confidence, when discovery had a signal to go on — the network topology, or a boundary that holds only external entities. **Role (plane)** is `Workload` or `Management`, defaulting to **Undecided** — which is not the same as Workload. A boundary that is both carries an inline ⚠.

**A boundary of external entities gets a proposal.** When discovery proposed no zone for a leaf boundary whose components are all external entities, the plugin proposes **Open internet** — or **Trusted external**, only when the source or you name the party a vetted partner (a cloud provider whose managed services your system consumes counts as one) — marked `[lo]`. The reason goes in the **Note** column. A boundary that mixes external entities with other components gets no external zone: its external entities are a hierarchy finding to move instead.

**needs a zone** marks a leaf boundary with no proposal and no zone anywhere up its chain, so it would fall back to the Internal default. The cell is never left blank for it: set a zone here, or it is counted as unclassified at Step 9.

The enforcement posture table carries three attributes:

| Attribute | Options | What It Means |
|-----------|---------|--------------|
| `implicit_deny_enabled` | true / false | Boundary blocks traffic by default |
| `allow_any_inbound` | true / false | Boundary allows unrestricted inbound |
| `egress_filtering` | deny_all / allow_list / allow_all | Outbound traffic policy |

A value no source shows stays blank; answering "not sure" leaves it empty (`null`).

Notes on how zones behave here:

- A boundary you leave unset **inherits** its nearest declaring ancestor's zone, falling back to Internal.
- **Structural containers abstain.** A boundary that only nests other boundaries renders `— structural` and is not nagged — zone the leaves inside it, not the wrapper.
- This is the **skeleton** phase: it sets the external, exposed, and internal tiers but **defers Restricted**, which needs asset classification (promoted at Step 7).
- **Proposed is not set.** Only rows you accept are written. An unconfirmed boundary keeps no zone and shows up in the Step 9 unclassified count.
- A row already marked `declared` was ratified by you earlier and is never re-proposed, including on resume.
- Identity, compute-node, location, and business grouping are steered to `domains` / `planes` **tags**, not zone-bearing boundaries.

For the concepts and the GUI equivalent, see [Boundary Trust Zones](../BOUNDARY_TRUST_ZONES.md).

**Auto-skip:** This step skips only when the hierarchy is already well-structured (depth >= 2, no single-child boundaries, no external entities in internal boundaries), there are no zone proposals left to ratify, **and** no boundary is unclassified:

```
Boundary hierarchy is well-structured (quality factor: 1.0), no zone proposals pending. Skipping refinement.
```

On a freshly discovered model, discovery almost always produces zone proposals or leaves a boundary that needs a zone — so expect a well-structured model to still stop here for the trust table. That is the trust skeleton doing its job, not the workflow ignoring your structure. You can also jump to Step 4 explicitly at any time.

**State after:** STRUCTURE_COMPLETE

---

## Step 5: Data Flow Mapping

Connect components with data flows to complete the structural model. The plugin:

1. Reviews existing flows from discovery
2. Identifies orphaned components (no inbound or outbound flows) and prompts you to connect them
3. Asks, in one question, which commonly missing operational flows exist, and what connects the components listed without a flow:
   - **Administrative access** — SSH, RDP, management consoles
   - **Monitoring/logging** — components to log aggregators or SIEM
   - **Backup/recovery** — databases to backup destinations
   - **Privilege or auth transitions** — a caller and callee at different authorization levels inside one zone

For each new flow, you specify the source, target, protocol, and description.

A privilege or auth transition you confirm is proposed as a new sub-boundary, or as a `Management` plane when the callee's segment really is management, with the same hierarchy and trust questions as Step 4. If you decline both, it stays a flow, and the plugin records it so the credential questions at Step 8 cover it.

#### Ratify approved channels (conduits)

Once flows exist, the plugin surfaces the **risk-bearing crossings** — flows where an external-tier boundary reaches a trusted one. You ratify the few that are legitimate as **approved channels** (conduits), each with a short justification:

```
| Channel                 | Justification (draft)          |
|-------------------------|--------------------------------|
| External → DMZ          | public entry point             |

Ratify these crossings as approved channels — declared intent, not enforcement — or adjust specific rows? (ratify all / adjust)
```

Ratified crossings are recorded as directional conduits on the source boundary. A crossing you **don't** ratify stays a plain flow and re-surfaces as an advisory `external-ingress` finding at Step 9 — that divergence between declared intent and modeled reality is the review working as designed. Conduits are declared intent only; the platform records them but does not verify or enforce them.

```
[done] Data flow mapping complete. Quality: 45/100.
```

**State after:** ENRICHING

---

## Session Break

After Step 5 of a full run, the plugin inserts a checkpoint. Your model structure is complete and saved — everything from here forward reads model files from disk. A [quick run](#quick-mode) skips the checkpoint and goes on to Step 6 in the same turn.

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
- A cloud provider's managed service still left unclassified gets the same row as at [Step 3](#step-3-model-review): type and class change together, with its move to the provider's external boundary (zoned Trusted external) when it sits in an internal one

The proposed classes come from your selected modules only. You confirm them in a table, and confirming it never adds a module.

Crown jewel tagging also happens here — free-text crown jewel names from your scope definition are fuzzy-matched to components and tagged. An unresolved crown jewel is a blocking question, not a note: left unmapped, it fails Gate 3 (C6).

On a [quick run](#quick-mode) with nothing left to classify — every element has a class, apart from those you chose to leave unclassified at Step 3 — and no IaC class dropped at Step 3 from a module that is still outside your selection, this pass is skipped: there is no class table and no module question. The crown-jewel mapping is still proposed, and you still confirm it.

#### Modules outside your selection

Sometimes the only class that fits an element comes from an installed module you didn't select. This can be an IaC class dropped at Step 3, or a match the plugin found by searching every installed module. The plugin never puts such a class in the confirm table. It lists these elements separately, each with its current class (if any) and the module and class that would classify it, and asks:

```
Add these modules to the active modules and classify the elements with them? (add / skip)
```

- **add** — the modules are added to `.dethereal/scope.json`, and the listed elements are classified again. You confirm the new classes, or changes from an element's current class, in a second table that covers only those elements. Elements already classified may also be offered a more specific class from a new module. Classes you confirmed earlier are kept.
- **skip** — the elements keep their classes or stay unclassified, and the gap is recorded.

This answer is the only way classification adds a module, and the question is asked once per run. If the model has no module selection (see [Module Selection](#module-selection)), every installed module is already in use and the question never comes up.

**Classification gate:** Gate 3's C1 — every non-external component classified. If it fails, or data flows or boundaries are still unclassified, the plugin lists them by name, STOREs first, with any module that would classify them, and asks:

```
Classify these elements now, or skip with the gap on record? (classify / skip)
```

**classify** runs this step again for them; **skip** leaves the gap on record.

**State:** No transition — already at ENRICHING from Step 5.

---

## Step 7: Data Item Classification

The plugin asks what data crosses each boundary-crossing flow that has no data item, and which elements originate, carry, process, store, or contain each sensitive data type (the **handlers question**). The credential that authenticates a flow (a password, an SSH key, a token) is a data item on that flow too.

Before you see the proposed items, the plugin prepares them:

1. **Classifies each item** against the data classes of your selected modules: an exact name match first, then a check against every data class those modules provide. If a fitting class exists only in another installed module, you get the module question from [Step 6](#modules-outside-your-selection); on **add**, the items are matched again with the new module.
2. **Runs the four lifecycle checks** — every crown-jewel store has classified data items; every origin, every process that reads, transforms, or caches a sensitive item, and the boundary that contains a crown-jewel item reference it. What they find is added as gap-fill rows.
3. **Proposes each sensitivity at no less than its floor** (below).

You confirm everything in **one table, with one question**. On Claude Code the handlers question comes in the same dialog: the plugin builds the proposal first, then shows the flows the handlers question names and the confirm table in one message, and asks both together. There, `none` to the handlers question means nothing to add to the proposal; an answer that adds or changes data items has those rows classified again, and the table is asked again, alone, before anything is written. On Codex and OpenCode the handlers question comes first, on its own.

```
| # | Data item       | Sensitivity | Regulatory flags | Handling elements                                         | Origin                    | Data class                       | Credential |
|---|-----------------|-------------|------------------|-----------------------------------------------------------|---------------------------|----------------------------------|------------|
| 1 | Cardholder data | Restricted  | PCI cardholder   | origin: Customer · transit: API → DB · rest: payment-db   | authenticated_first_party | Customer & Personal Data (near)  |            |
| 2 | Session tokens  | Restricted  |                  | transit: API → Redis · use: Payment API · rest: Redis     | authenticated_first_party | Authentication Tokens (near)     | yes        |
| 3 | Login password  | Restricted  |                  | origin: Customer · transit: User → API · rest: payment-db |                           | User Credentials (near)          | yes        |

Confirm these data items, their handling elements, their DATA class, their origin column and their credential column, or adjust specific rows? (accept all / adjust)
```

- **Regulatory flags** come from your scope's compliance drivers, in the canonical spelling (`PCI cardholder`, `PHI`, `PII`, `GDPR personal`) — never the driver's own name (`PCI-DSS`, `GDPR`).
- **Handling elements** lists every element, grouped by role: origin, transit, use, rest, and scope (the containing boundary). The list is never shortened to `+N more`, because these links are written. Why each element handles the item is behind `details`.
- **Origin** records who can write the item's content; the least-trusted source wins. It is blank when the source is unknown, and the item then stays unanswered. See [Origin and credential flag](DISCOVERY_AND_ENRICHMENT.md#origin-and-credential-flag) for the seven values.
- **Data class** is an exact or near match, or `none suitable (N listed)` when no class in the full list fits; the other candidates and their scores are behind `details`. An item confirmed as `none suitable` stays unclassified.
- **Credential** proposes **yes** for every item whose class is credential-like (for example *User Credentials* or *Authentication Tokens*). Only the rows you confirm are recorded, and an answered **no** is kept. Items you leave unanswered are proposed again at Step 8.

**The sensitivity floor** is the higher of two floors:

| Set by | Restricted | Confidential |
|--------|------------|--------------|
| Regulatory flag | `PCI cardholder`, `PHI` | `PII`, `GDPR personal`, `SOX financial`, `CCPA personal` |
| A whole word in the data class's name | credentials, tokens, secrets, passwords, private/signing/encryption/API keys, sessions, cookies, JWTs, payments, cards, cardholders, health, medical, PHI | personal, customer, PII |

The four levels are **Restricted**, **Confidential**, **Internal**, and **Public**.

**Adjusting.** If your adjustment adds or renames an item, or changes its class, the plugin classifies those rows again, recomputes their floor and credential column, and shows them again with the same question before anything is written.

**Follow-ups after the write.** Two questions remain, asked only when something is still missing once the table is written:

- If sensitive flows still carry no classified data item (Gate 3's C4), or a lifecycle check finds a gap that was not offered as a gap-fill row:

  ```
  Classify the missing data items now, or skip with the gap on record? (classify / skip)
  ```

  **classify** proposes a class for every item listed, in a new confirm table. **skip** leaves C4 failing — it is not a waiver. Waivers are offered only at Gate 3, in [Step 9](#waiving-a-gate-3-gap).
- If an item ended below its floor (Gate 3's C7) — for example a row you adjusted down — the plugin offers to raise it. A floor set by a data class or a regulatory flag cannot be waived: kept below it, Gate 3 keeps failing.

**Crown jewels again.** If a crown jewel from your scope is still unmapped and an element classified at Step 6 or 7 matches it, the plugin asks the crown-jewel mapping again, for those jewels only. With every crown jewel mapped, it is not asked again.

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

**Class templates set the workload.** The bulk of the pass walks every field of each element's class template — the stubs written during classification, each field seeded to `null` — and resolves all of them. That means the questions differ per element (a Database is asked about `ssl_enabled`, `password_encryption`, `log_connections`; other classes ask about other things), and the volume scales with your class templates, not with a fixed list. Values the enricher can find in your code, IaC, or config it fills in itself and lists in the relay files, for you to keep, reject or change; it asks only about the rest.

**Then a six-attribute floor** is applied to every in-scope component, whatever its class template covered: `authentication_type`, `encryption_in_transit`, `encryption_at_rest`, `implicit_deny_enabled`, and `monitoring_tools` (logging is captured by the class template and has no floor key). Two of these are not free-text choices — `implicit_deny_enabled` is a boolean and `monitoring_tools` is a list — and the key names are read literally by the quality score and the surface report. See [The Six-Attribute Floor](DISCOVERY_AND_ENRICHMENT.md#the-six-attribute-floor) for the exact spellings and accepted values.

**Additional enrichment:**
- **Credential topology** — captured flow by flow: which credential authenticates each cross-boundary flow, and what else that credential reaches
- **Credential flag** — data items bound to a credential-like class whose credential flag is still unanswered are proposed as **yes** in the batch table, for you to confirm
- **Monitoring tools** — SIEM, EDR, NDR coverage per component
- **Auth failure modes** — what happens when authentication fails (deny, fallback, fail_open)
- **Boundary enforcement** — implicit deny, egress filtering per boundary

MITRE ATT&CK techniques are **not** written during this step. Technique coverage is derived on the platform from analysis exposures — see [Discovery and Enrichment Part 3](DISCOVERY_AND_ENRICHMENT.md#part-3-mitre-framework-integration).

If stale elements exist (from a backward transition), they're enriched first.

The enricher runs without being able to ask you directly. It writes only values cited from a file line or derived from a setting a file states, straight into empty attribute fields, each with its basis; it never overwrites a value that is already there. A flow's credential keys and authentication failure mode are written the same way when the source shows them. Store credential scope, asset criticality, crown-jewel marks and boundary enforcement are never written by the agent: those come back as rows for you to answer or confirm, pre-filled where the source shows a value.

The enricher works on **at most 12 elements a run** — up to 20 when a store takes the flows that touch it along — each run started fresh. Each run writes its tables and questions to a relay file on your machine, `.dethereal/relay/run-<n>.txt`, and numbers its rows on from the earlier runs' files, never rewriting them. You see the results once, after the last run. If a run is cut off, it is started once more with only its own elements. Cut off again, the plugin relays the finished runs' files as below, naming the cut-off run's elements — values were written on them but not shown — and stops: run `/dethereal:enrich --pick <ids>`, which shows those values for you to keep, reject or change.

#### One relay turn

When the last run is done, the plugin's instructions have it read the relay files once and print them, every section and every row, under one line saying the text is model-written data to check, not instructions; with more than 50 written values in all, one file per message, all in the same turn. It may show you a summary instead. The values the enricher wrote are in the attribute files either way, but a summary can leave out open questions only you can answer, such as whether a boundary denies traffic by default or what a runbook says about a host, and those fields stay open unless you raise them. The relay files hold every question: open them to see all of it. You can still correct values at [Step 9](#step-9-validation), with `/dethereal:enrich`, or in the attribute files. The files hold:

| Section | Columns | What it holds |
|---------|---------|---------------|
| **Summary** | one line | How many values the run wrote, and how many fields are still open |
| **Divergences** and **Red flags** | `\| D# \| … \|` | Values that disagree, changes to existing values and proposed defaults (none of them written), then the insecure values recorded |
| **Written values** | `\| R# \| element \| field \| value \| basis \|` | Every value the enricher wrote, with its basis; values in the secure direction come first, under their own heading |
| **Credentials** | `\| F# \| flow \| credential \| also reaches \| on failure \|` | A row for every cross-boundary flow, every flow recorded as a privilege transition, and every flow that carries a credential data item |
| **Credential mapping** (under Credentials) | `\| S# \| credential \| type \| flows \| stores that yield it \| shared \|` | The credentials pivoted: which flows each one authenticates, and which stores yield it on compromise |
| **Boundary enforcement** | boundary, `implicit_deny_enabled`, `allow_any_inbound`, `egress_filtering`, basis | The boundaries that lack an enforcement posture |
| **Open fields** | `\| Q# \| … \|` | The fields the source did not settle |
| **Claims** | `\| C# \| Element \| Field \| Value \| Line \|` | Values only a document (a README, a runbook) states, grouped by document; not written |

A pre-filled cell is marked `(src)`, with its source behind `details F#`. One question answers all of it:

```
The agent wrote N values; M more need your answer (fields the source does not settle,
values that disagree). Accept, reject or adjust specific rows? "Accept all" covers the
written values; say "accept the pre-fills", or name the F#, S# and boundary rows you
accept. Name the documents that describe the deployed system: their values are
written — all of them, or the C# rows you name. Answer the credential, boundary and
open-field rows you can: ...
```

If your scope declares the `insider` or `supply_chain` adversary class, the plugin repeats its trust assumptions above the question and adds that class's question at the end: administrative access paths for `insider`, the build and deploy pipeline for `supply_chain`.

- **A plain "accept all" writes nothing more.** The written values stay as they are. So does a reply that decides nothing ("continue", "don't know").
- **Any other reply is applied by the [enrichment-applier](AGENTS_AND_ARCHITECTURE.md#enrichment-applier-relay-answers) agent**, which writes only attribute files and returns a table of what it wrote. A rejected value goes back to empty; a changed one takes your value. A claim is written only for a document you name.
- **"Accept all" covers the Written values only.** To accept the credential, mapping, and boundary pre-fills, say "accept the pre-fills" or name the rows. A pre-fill your reply does not mention is not written. When your reply is applied, the applier names those rows, in one line, as left empty; a plain "accept all" names nothing.
- **Your words never silently replace a cited value.** If a fact in your reply disagrees with a value cited from your source, the cited value stays and the plugin shows the conflict once; change it with `/dethereal:enrich` if you want to. An answer to the row itself is written as you give it.
- **Follow-ups come one at a time.** An element you asked to remove goes through the removal confirmation. If your reply adds, removes, or changes a credential — its id, type, flows, stores, or label — the plugin shows the Credential mapping again, recomputed, and asks you to confirm it before any credential store key is written. Data items your reply decided get the data-item questions from Step 7; classes, crown jewels and zones are named for `/dethereal:classify`, and elements to add for `/dethereal:add`.
- **A field you reject or leave empty** stays empty (`null`), and later enrichment runs in the same conversation do not ask it again (give its value any time and it is written); if a Gate 3 floor needs it, the plugin says so and points to the waiver questions in [Step 9](#waiving-a-gate-3-gap) — it never offers a waiver during enrichment.

The relay files stay on your machine: `.dethereal/.gitignore` keeps them out of git. Nothing reads them once the step is over, and you may delete `.dethereal/relay/` by hand whenever no enrichment is running.

See [Class Templates Drive the Questions](DISCOVERY_AND_ENRICHMENT.md#class-templates-drive-the-questions) for what counts as evidence, the basis labels, and what is never written.

**Control assignment is a separate pass.** The default Step 8 enrichment covers template attributes, the six-attribute floor, credentials, and monitoring. Assigning reusable security Controls (e.g., "Database Encryption Package") to elements is a follow-up pass invoked as `/dethereal:enrich --focus controls` — it runs the security-enricher agent apart from Step 8's runs, with the agent's own limit (40 turns on Claude Code, 40 steps on OpenCode; the plugin sets none on Codex), auto-pulls referenced Controls, and queues `pendingEdit` blocks for the next push. At the end of Step 8 the plugin offers to run it now or later. See [Discovery and Enrichment Part 4](DISCOVERY_AND_ENRICHMENT.md#part-4-control-enrichment).

For details on the enrichment process, see [Discovery and Enrichment](DISCOVERY_AND_ENRICHMENT.md). On a quick model, Step 8 covers the priority set only and defers the control pass — see [Quick Mode](#quick-mode).

**State:** No transition — already at ENRICHING.

---

## Step 9: Validation

The plugin delegates to the **model-reviewer** agent for a quality assessment, then runs the gates itself. On a quick model this step is read-only — the quality score, the red flags and the top findings, with no Gate 3 verdict or question; see [Quick Mode](#quick-mode). In a full run:

```
Gate 1 PASS · Gate 2 PASS · Gate 3 PASS · Quality 78/100 Good
```

The gate verdicts come first, on one line with the quality score and its label; when waivers change Gate 3's verdict, the line also shows the verdict without waivers. Below it, each failing criterion is listed with what blocks it. The per-factor quality table waits until you ask for it (`details quality`).

The review also shows the reviewer's **Red Flags** block exactly as the reviewer returned it: the heading with the count, then one flag per line with the element, the field and the value — never reworded, merged into a sentence, or folded. Each time the results are shown again, every red flag is listed again, with the new ones marked; with none, the review says "No red flags". See [Red Flags](REVIEW_AND_ANALYSIS.md#red-flags) for what counts as one.

#### Zoning coherence (advisory)

The review also rolls up your **zoning coherence** as an advisory block — findings of six kinds that check whether your declared segmentation hangs together. Each Warning kind gets one line with its count and up to three boundary names; the Info findings share one line, with their names behind `details zoning`:

```
Zoning coherence (advisory — never blocks a push):
  [Warning] 1 external-tier boundary reaches a trusted tier without an approved channel: External → Data Tier
  [Info] 2 findings: unclassified (1), flow-channel (1) — details zoning
```

The six kinds are `unclassified`, `under-protected`, `mgmt-plane`, `external-ingress`, `flow-channel`, and `cross-tier-domain`. They are always **advisory** — they inform you and never block a sync. See [Review and Analysis](REVIEW_AND_ANALYSIS.md#zoning-coherence-advisory) for what each finding means.

**If Gate 3 passes** (all criteria met, as the server reports it — the quality score is a label and gates nothing), the plugin asks whether to record the review:

```
Record this model as REVIEWED — the answers are complete and consistent (Gates 2 and 3),
not proven true, and the waivers shown stay on record? (record / not now)
```

- **record** — the plugin asks the server for REVIEWED. The server grants it only when Gates 2 and 3 pass, no queued stale element still exists, every model file can be read, and the model is not a [quick model](#quick-mode). If it refuses, the plugin shows why and the state stays ENRICHING. Then the workflow goes on to sync in the same turn.
- **not now** — the state stays ENRICHING, and the workflow goes on to sync as after **skip to sync anyway**.

**If Gate 3 fails:** the plugin shows what blocks — each failing criterion with up to five failing elements; for a field gap of C2, C3, or C8, the element's `missing` and `placeholder` fields — then offers to skip, to loop back to Step 8 to fill the gaps, or to waive named failures:

```
Gate 3 did not pass. Skip to sync anyway, loop back to Step 8 to fill the gaps, or waive
named elements? Skipping leaves the model un-REVIEWED (ENRICHING).
(skip to sync anyway / loop back / waive)
```

- **skip to sync anyway** — the state stays ENRICHING, and everything that shows the state from then on, the push confirmation included, shows the model as not REVIEWED.
- **loop back** — returns to Step 8 with the failing elements and their fields as the worklist; Gate 3 runs again when the loop reaches Step 9.
- **waive** — see [Waiving a Gate 3 gap](#waiving-a-gate-3-gap).

A `placeholder` field holds a stand-in value (`unknown`, `TBD`, `n/a`, an empty string): that failure can never be waived until the stand-in is replaced with a real value or cleared.

When the gate results are shown again after a loop-back, the plugin says what changed in the verdicts; the red flags are not summarised as a change — they are listed in full every time.

For details on quality scoring and gates, see [Review and Analysis](REVIEW_AND_ANALYSIS.md).

**State after:** REVIEWED if Gate 3 passes, you answer **record**, and the server grants it; otherwise ENRICHING.

#### Waiving a Gate 3 gap

Answer **waive** to accept a Gate 3 failure for named elements instead of fixing it. The plugin lists the failures that can be waived — each with its criterion, element, and detail (for a field gap of C2, C3, or C8, its `missing` and `placeholder` fields), the remedy, and how many waivers the criterion has left — then asks four questions: whether to waive any, which ones, on which basis, and why, in your own words. It never words the reason for you. Some failures can never be waived; the plugin says why.

**Only these questions grant a waiver.** Your consent is the answer **waive** to the first question, and the reason is your reply to the last. A reply to any other question — "not sure", "record the rest as unknown" — is neither: the field stays empty (declined) and the failure stays. Earlier steps never offer a waiver; if you ask for one there, the plugin points you here.

**A waiver counts only on the machine that granted it.** The waiver is recorded in the model's state, but the grant that makes it count is kept beside this machine's waiver key, in your home directory.

- **Inherited waivers.** A waiver granted on another machine, in a copy of the model, or before waivers were bound to one machine reads as *inherited* and does not count. The verdicts show one line with how many there are.
- **Lapsed waivers.** A waiver applies only while its element fails the same way; a changed failure, even progress, lapses it. It counts again only when you grant it anew, with a new **waive** and a new reason.
- **Granting one again.** To use an inherited waiver, grant it on your machine through the same questions, for the same criterion and elements. The plugin shows the recorded reason as "recorded by another machine, not verified". Confirm it ("use the same reason") or give your own; the plugin never reuses it without your confirmation.
- **When a grant is refused.** The plugin refuses a grant when this machine has no usable waiver key, when the grants file beside the key can't be used, or when that file is full for this model. If it is full, revoke waivers you no longer use first.

---

## Step 10: Sync

Pushes your model to the platform for analysis.

### Pre-Flight Check

Before pushing, the plugin verifies Gate 2 (sync-blocking) criteria: manifest completeness (including module references the server can derive), structure validity, reference integrity. If Gate 2 fails, push is blocked. For the module gaps it can report (`module_unknown`, `module_conflict`, `scope_unreadable`, `scope_module_invalid`, `manifest_module_invalid`) and their remedies, see [Gate 2 Pre-Flight](SYNC_AND_VERSION_CONTROL.md#gate-2-pre-flight).

### Authentication Check

The plugin asks its MCP server whether you are signed in, refreshing an expired session if it can. If you are not signed in:

```
Not signed in to <platform URL>. Sign in with /dethereal:login first, or skip this step for now? (signed in / skip)
```

Answer **signed in** after you have run `/dethereal:login`, and the plugin checks again.

If you skip, the workflow jumps to README generation and finishes without sync.

### Push Consent

Authentication is **not** the last decision point. Passing the auth check — including on a platform running with auth disabled, which counts as authenticated — is permission to *reach* the platform, not permission to publish this model. Before anything is pushed, the plugin asks:

```
Model passed Gate 2 and is ready to publish to <platform URL>.
Push to platform now? (push / skip)
```

Above the question, the plugin shows the platform URL, whether the push creates a new platform model or updates one, the model's state and latest Gate 3 verdict (a model whose Gate 3 was skipped is shown as not REVIEWED), the element counts, and a reminder that the model's asset context — scope, crown jewels, data sensitivity, regulatory flags — publishes too. On a [quick model](#quick-mode), it also says the model is quick, that Gate 3 was not run, and that `/dethereal:threat-model` with `--full` on the same path deepens it.

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

**Control-library prompts.** If you ran the control pass (`/dethereal:enrich --focus controls`) and have edits to brownfield Controls that other Models also use, the push pauses on the **shared-ownership prompt**. For a single shared Control it asks `(cancel / push-anyway)`; otherwise a review screen takes `cancel`, `push-anyway`, or `push-unverified` per Control, and per-key decisions for conflicting keys. `push-anyway` and `push-unverified` both **overwrite the shared Control on every model that references it**. To fork a shared Control instead, `cancel` it, then create a separate Control with `/dethereal:enrich --focus controls`. Decisions land in `.dethereal/control-audit.log`, which stays on your machine and records no attribute values. If a control file was changed outside the plugin — its `attributes` differ from its `platformAttributes` with no `pendingEdit` — the control-library push stops before pushing any Control; recover with `/dethereal:sync promote-external-edit <controlId> <classId>`, which records the local values as your edit.

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

Link these exposures to the candidate countermeasures now, change specific rows, or defer? (yes / modify / defer)
```

If you defer linking: "Analysis will undercount your defenses — defense coverage analysis will not credit existing controls until exposures are linked to countermeasures."

The plugin can change only countermeasures you authored. A countermeasure the platform derived from the control's class is refused. In the platform, open the control and click **Customize as an editable copy** on that countermeasure, then link the copy (see [Customizing a finding](../MANAGING_FINDINGS.md#customizing-a-finding-editable-copy)).

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

On a [quick model](#quick-mode), the first line under the title reads `> **Quick model, not reviewed: deepen with the threat-model skill and --full.**` The README generated at the end of a deepening run has no such line.

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

On a quick model, the next step also names deepening: `/dethereal:threat-model` with `--full` on the same path runs the full enrichment from Step 8, then the review.

---

## Quick Mode

On a new model — one it starts, or one made with `/dethereal:create` — `/dethereal:threat-model` runs a shorter guided workflow by default, for a first pass you mean to deepen later. It builds the full structure but trims the two phases that cost the most — enrichment and validation:

| Steps | In a quick run |
|-------|----------------|
| 1–7 | Run in full: scope, discovery, model review, boundaries, data flows, classification, data items. When nothing is left to classify at Step 6 and no IaC class dropped at Step 3 still waits on a module outside your selection, the second classification pass is skipped; the crown-jewel mapping is still proposed, and you confirm it |
| 8 | Enriches the **priority set** only, without asking you for a scope. The control pass is deferred: one line points to `/dethereal:enrich --focus controls`, and there is no offer to run it |
| 9 | Read-only: the quality score, the red flags, and the **top findings** — at most five attack chains through the model, each from its entry, hop by hop, to its target, ranked with any that reaches a crown jewel first. No Gate 3 verdict, no loop-back, no waivers, no review record |
| 10–11 | Run as usual: you can publish a quick model |

The **priority set** is what Gate 3 holds to its floors, as a snapshot taken from Gate 3 when Step 8 starts: every crown jewel and its mapped elements, the Tier 1–2 components and the flows with a Tier 1–2 end that Gate 3 lists as still missing values (criteria C2 and C8), and the cross-boundary pivots (components outside Tier 1 at one end of a boundary-crossing flow). It is the same set the `priority` scope of `/dethereal:enrich` enriches. The server computes the tiers; see [Component Tiers](DISCOVERY_AND_ENRICHMENT.md#component-tiers) and [Enrichment Order and the Priority Set](DISCOVERY_AND_ENRICHMENT.md#enrichment-order-and-the-priority-set).

### A quick model

The model is **marked quick**, and its state shows the mark — for example `ENRICHING (quick)` — in `/dethereal:status`, `/dethereal:review`, the push confirmation, the README, and the final footer. A quick model is **never REVIEWED**: the server refuses to record a review for it.

To build a new model with the full run instead, add `--full` to `/dethereal:threat-model` or to `/dethereal:create`: the model is not marked quick. `--full` is not `--full-scan`, which runs a full discovery in place of the drift check. `--quick`, a `/dethereal:threat-model` flag only, makes a quick model explicitly: on a new model it gives the same quick model as no flag, and on an existing full model it sets the mark when the run starts. A model that is already REVIEWED refuses it, and the run ends in one line: a quick run never downgrades a review.

**Resuming a paused quick run.** A run without a mode flag keeps the model's mode. If you stopped a quick run early, or made a quick model with `/dethereal:create`, run `/dethereal:threat-model` on the same path and it continues as a quick run from where the model stands; only `--full` [deepens it](#deepening-a-quick-model).

### What quick mode never relaxes

- Every value you give is confirmed before it is written, and the enrichment relay files list every value the agent wrote, exactly as in a full run.
- Gate 2 still applies before a push.
- The secret-file rules and the scope-exclusion rules are unchanged.

### Publishing a quick model

A quick model can be pushed. The [push confirmation](#push-consent) says it is a quick model, that Gate 3 was not run, and that `/dethereal:threat-model` with `--full` on the same path deepens it. The generated [README](#readme-generation) opens with "Quick model, not reviewed: deepen with the threat-model skill and --full.", and the [final footer](#workflow-completion) names deepening as a next step. Before that footer, the plugin shows the top findings from Step 9 again, or, when they are no longer in the conversation, says they are in the Step 9 review.

### Deepening a quick model

Run `/dethereal:threat-model` on the same model, with `--full`:

```
> /dethereal:threat-model ./threat-models/payment-api --full
```

The plugin clears the quick mark and shows the progress table — once the quick run has passed Step 7 (even if it was paused at a later step), with Steps 1–7 done and the cursor at **Step 8 with the full scope**, so the rest of them is not redone; a quick run stopped before Step 7 resumes where it stopped. If you continue or jump to Step 7 or later, the plugin first runs the [Step 6](#step-6-classification-pass-2) classification pass and its classification gate, so your classes get the second look a quick run may have skipped, and then takes up that step. If you continue or jump to Step 6 or earlier, Step 6 runs its full pass there, once. The control pass is offered as usual, then the normal [Step 9](#step-9-validation) runs, with Gate 3, loop-back, waivers, and the review record.

Values from the quick run are kept. The enricher only fills fields that are still empty; where it observes a different value for a field that already holds one, it shows a divergence row for you to accept or reject, and never overwrites.

---

## Backward Transitions

If you add or remove elements during Steps 6-9 (while at ENRICHING or REVIEWED), the state automatically reverts to STRUCTURE_COMPLETE:

```
Adding or removing elements reverted state from ENRICHING to STRUCTURE_COMPLETE.
Enrichment on existing elements is preserved. New or changed elements are
tracked as stale and will be enriched next.
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

If boundaries are unaffected (e.g., you added a component to an existing boundary) and its [auto-skip conditions](#step-4-boundary-refinement) still hold, Step 4 auto-skips to Step 5.

**What happens during a backward transition:**
- The state reverts to `STRUCTURE_COMPLETE`
- `quality.json` is deleted (forces recomputation)
- The IDs of new or changed elements are added to `staleElements[]` in `state.json`
- The server clears the sign-off and the review: a REVIEWED model is no longer REVIEWED
- Waivers lapse on the elements that changed
- A loop back already open from Step 9 survives the transition

Enrichment data on existing elements is preserved — only the new or changed elements need enrichment. The enrichment step (Step 8) prioritizes stale elements first.

---

## Drift detection on resume

When you re-run `/dethereal:threat-model` on a model that already has a baseline, the skill detects drift between your last reconcile point and the current git working tree. If in-scope source files have changed since the baseline commit, the resume path sorts each change into one of four kinds — an element removed, an element added, an element whose technology changed (it now matches a different class or element type), or an element whose attributes alone changed — and routes each item through the existing `/dethereal:add`, `/dethereal:remove`, or `/dethereal:enrich` flows. A changed component whose substrate now points to another class is asked with `drift-reclassify` (reclassify / keep), and a changed secret file — never read — is asked with `drift-secret-file`, which names the flows or stores it serves. Otherwise you review drift through the same flows you used to author the model.

Two operator-facing details:

- **`/dethereal:threat-model --full-scan`** bypasses drift detection entirely and re-runs Step 2 (Discovery) end-to-end. Use this when history was rewritten past the baseline (e.g., a force-push or a branch-switch that orphaned the prior reconcile commit), or when you want to re-baseline against the current source tree.
- **Crown-jewel removal triggers an elevated confirm.** When the drift detector proposes removing an element tagged as a crown jewel, `/dethereal:remove` shows an explicit "this element is tagged as a CROWN JEWEL" prompt before applying. Untagged removals fall through to the standard confirmation.

For how drift detection works under the hood, see [Drift Detection architecture](../../architecture/dethereal/DRIFT_DETECTION.md).

### Where crown-jewel status lives

That elevated confirm reads two different fields, because the tag itself has two homes:

| Element | Field checked |
|---|---|
| Component | `crownJewel: true` on the component in `structure.json` — the single source of truth, written by `/dethereal:classify` |
| Data flow, data item, boundary | `crown_jewel: true` in that element's attribute file (`attributes/<kind>/<id>.json`) — a local-only mark, since these have no first-class field in `structure.json` |

The two spellings are not interchangeable. The snake_case `crown_jewel` that can appear in a *component's* attribute file is only a derived copy: tagging a component there and nowhere else leaves `structure.json` untouched, so neither the enrichment worklist nor the surface report treats the component as a crown jewel. On a component, always set `crownJewel` in `structure.json`.

---

## Tips

- **Commit at the session break** — Step 5 is a natural checkpoint. Committing here gives you a clean revert point if enrichment needs to be redone.
- **Jump by step number** — you can type any step number to jump directly to it, without needing to go through intermediate steps.
- **Individual commands work too** — you don't need to use the guided workflow for everything. Run `/dethereal:classify` or `/dethereal:enrich` independently whenever you want.
- **Resume from any session** — your progress is saved in `state.json`. Start a new session and run `/dethereal:threat-model` to pick up where you left off.

---

**Next:** [Command Reference](COMMAND_REFERENCE.md) — all 14 commands with syntax and examples
