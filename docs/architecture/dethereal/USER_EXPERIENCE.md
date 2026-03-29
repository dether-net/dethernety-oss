# Dethereal Plugin -- User Experience Specification

> How users interact with the Dethereal plugin in the Claude Code CLI/IDE environment.

## Table of Contents

- [1. User Journey](#1-user-journey)
- [2. Interaction Patterns](#2-interaction-patterns)
- [3. Information Presentation](#3-information-presentation)
- [4. File-Based Model Presentation](#4-file-based-model-presentation)
- [5. Sync Experience](#5-sync-experience)
- [6. Progress and Feedback](#6-progress-and-feedback)
- [7. Error Handling and Recovery](#7-error-handling-and-recovery)
- [8. Expert vs Novice Paths](#8-expert-vs-novice-paths)

---

## 1. User Journey

### Installation to First Interaction

**First-session orientation.** A SessionStart hook detects the first session and injects:

```
Dethereal threat modeling plugin is active.

  /dethereal:create     -- Create or import your first threat model
  /dethereal:status     -- Check connection and auth status
  /dethereal:help       -- See all available commands

  Or just describe your system in natural language:
  "I have a React frontend talking to a Go API with a PostgreSQL database"

Platform: not connected (run /dethereal:login to connect)
```

Three commands, not twelve. Natural language path is presented as primary.

**Connected, no local models.** When the user is authenticated to a platform with existing models but has no local models:

```
Dethereal threat modeling plugin active.

No local models found. Getting started:
  /dethereal:create   — Create a new threat model from scratch
  /dethereal:sync pull — Pull an existing model from the platform
  /dethereal:help     — See all available commands

Or describe your system: "Model our React + Go + PostgreSQL stack"

Platform: connected (demo.dethernety.io, 3 models available)
```

### Authentication Flow

```
User: /dethereal:status

Plugin:  Dethernety Connection Status
         -----------------------------------------
         Platform URL:  https://demo.dethernety.io
         Auth status:   Not authenticated
         -----------------------------------------
         Run /dethereal:login to authenticate via browser.

User: /dethereal:login

Plugin:  Opening your browser to authenticate...
         Waiting for login (timeout: 2 minutes)...

         Authenticated successfully.
         Platform:     https://demo.dethernety.io
         User:         levente@dether.net
         Token valid:  59 minutes remaining
```

### The "Hello World" -- First Threat Model

```
User: /dethereal:create

Plugin: I'll help you create your first threat model. Choose a starting point:

  1. Describe your system -- I'll build the model from your description
  2. Start from a template -- web app, API service, microservices, database
  3. Import existing -- point me to Terraform, K8s manifests, or docs
  4. Pull from platform -- export an existing model to work on locally

Which approach?

User: I have a Next.js frontend on Vercel, a Node.js API on AWS ECS,
      and a PostgreSQL RDS database. Users authenticate via Auth0.

Plugin: Building threat model for your architecture...

  Identified components:
  +-----+---------------------+---------+------------------+
  |  #  | Component           | Type    | Trust Zone       |
  +-----+---------------------+---------+------------------+
  |  1  | Next.js Frontend    | PROCESS | Public (Vercel)  |
  |  2  | Node.js API         | PROCESS | Private (ECS)    |
  |  3  | PostgreSQL Database | STORE   | Data (RDS)       |
  |  4  | Auth0               | EXT     | External         |
  |  5  | End Users           | EXT     | Internet         |
  +-----+---------------------+---------+------------------+

  Identified data flows:
  +-----+----------------------------+-------------------+
  |  #  | Flow                       | Data              |
  +-----+----------------------------+-------------------+
  |  1  | Users -> Frontend          | HTTP requests     |
  |  2  | Frontend -> API            | API calls (HTTPS) |
  |  3  | API -> Database            | SQL queries       |
  |  4  | Frontend -> Auth0          | Auth redirects    |
  |  5  | Auth0 -> API               | JWT tokens        |
  +-----+----------------------------+-------------------+

  Trust boundaries:
    Internet / Public CDN (Vercel) / Private VPC (ECS+RDS) / External (Auth0)

  Your options:
  - "view"   — Preview the full model before saving (recommended for first model)
  - "save"   — Save to local files only
  - "modify" — Add, remove, or rename components
  - "import" — Save and import to platform

  Type your choice, or describe what you'd like to change:
```

The AI's interpretation is presented explicitly before it becomes the model.

After creation or save, the plugin always shows next steps:

```
Model saved to ./threat-models/production-stack/ with 5 components, 5 data flows.

Next steps to improve analysis quality:
  1. Classify components:    /dethereal:classify     (0/5 classified)
  2. Enrich with attributes: /dethereal:enrich       (0/5 have attributes)
  3. Run quality check:      /dethereal:review

Current quality score: 15/100 (Starting — minimum 70 for analysis)

Or continue with the full guided workflow: /dethereal:threat-model
```

This created a minimal model. To continue with full enrichment, run `/dethereal:threat-model` — it picks up where you left off, not start over.

This bridges creation and enrichment. The `/dethereal:threat-model` skill handles this transition implicitly, but users entering via `/dethereal:start` or natural language need explicit guidance.

### Universal Post-Action Footer (D42)

Every mutating skill ends with a 2-line status footer showing absolute quality score and next-step suggestion:

```
[done] Classification complete. Quality: 56/100.
[next] /dethereal:enrich (3 components need attributes) or /dethereal:review
```

This pattern provides ambient progress awareness between skill invocations without requiring explicit `/dethereal:status` calls. The absolute score avoids computing a "before" value (which would require an additional MCP tool call per mutation). The cached score in `.dethereal/quality.json` is available if a delta is needed.

### Resume and Skip in Guided Workflow

When a user returns to an in-progress threat model, the guided workflow shows progress and allows resuming or skipping steps:

```
Resuming "Production Stack" threat model...

Progress:
  [done]        1. Scope Definition
  [done]        2. Discovery
  [done]        3. Model Review (discovery confirmation)
  [auto-skip]   4. Boundary Refinement (boundaries already structured)
  [>>>>]        5. Data Flow Mapping  — current step
  [    ]        6. Classification
  [    ]        7. Data Item Classification
  [    ]        8. Enrichment
  [    ]        9. Validation
  [    ]       10. Sync
  [    ]       11. Post-sync linking

Continue from step 5? Or jump to a different step?
Type step number to jump (including skipped steps), "continue" from current, or "restart":
```

The workflow also detects prior work and auto-advances completed steps:

```
I detected that 10/12 components already have classes assigned (likely
from a previous `/dethereal:classify` run). Marking Classification as
complete. 2 unclassified components will be handled during enrichment.
```

### Session Break at STRUCTURE_COMPLETE (D65)

After Step 5 (data flow mapping, state transitions to ENRICHING), the guided workflow presents a checkpoint. The message is calibrated to model size:

**Small models (< 15 components):**

```
[done] Data flow mapping complete. Quality: 32/100.

Your model structure is complete and saved. You can continue enrichment
now or resume later — your progress is saved.

Consider committing your model before enrichment (clean revert point).

Continue now? (yes / later)
```

**Large models (15+ components):**

```
[done] Data flow mapping complete. Quality: 32/100.

Your model structure is complete and saved. For models this size,
starting enrichment in a fresh session produces better results — the
enrichment phase reads model files from disk and doesn't need the
discovery context.

Consider committing your model before enrichment (clean revert point).

Continue now? (yes / later)
```

If the user chooses to continue on a large model, proceed without re-asking. The enrichment phase reads model files from disk (Skill Design Principle 7) and does not need the scope/discovery/boundary conversation context. A fresh session starts with ~5K tokens of model context instead of ~50-80K tokens of accumulated history.

### Decomposition Recommendation (R7)

After Step 3 (discovery confirmation), if the validated inventory exceeds complexity thresholds (D55/D56), the plugin presents a decomposition recommendation. The framing is factual, not judgmental — the user made a legitimate scoping choice.

**Scope narrowing (default recommendation):**

```
Discovery complete. Found 34 components across 6 trust boundaries.

  That is a substantial system. For the best results, I recommend
  starting with the highest-risk subsystem and expanding from there.

  Based on your crown jewels ("Payment Database", "User Credentials"):

  Suggested starting scope: Payment Processing subsystem
    8 components, 2 trust boundaries
    Contains 1 of 2 crown jewels (Payment Database)
    Estimated enrichment time: 25-35 minutes

  After this model is complete, you can create adjacent models for
  User Platform, Data Pipeline — linked via representedModel.

  Start with Payment Processing? (yes / pick different / model everything)
```

**Decomposition plan (when user described multiple systems):**

```
Discovery complete. Found 28 components across 5 trust boundaries.

  Your system spans 3 deployment environments with separate CI/CD
  pipelines. Options:

  (a) Single model — 28 components, ~50-70 min to enrich
  (b) Separate models — 3 natural clusters:
      "API Platform" (12), "ML Pipeline" (9), "Edge Services" (7)
      Linked via representedModel.
  (c) Start with one — begin with the highest-risk subsystem, expand later

  Which approach? (a / b / c)
```

**If user chooses decomposition plan, show the proposed split:**

```
Decomposition plan:

  [Model 1] api-platform/ (12 components)
  |-- Public Zone/
  |   |-- API Gateway, CDN
  |-- App Zone/
  |   |-- Auth Service, Order Service, User Service, Notification Service
  |-- Data Zone/
  |   |-- User DB, Order DB, Redis Cache
  +-- References: "ML Pipeline" [REF]

  [Model 2] ml-pipeline/ (9 components)
  |-- Ingestion/   -- Event Stream, Feature Store
  |-- Training/    -- Training Jobs, Model Registry
  |-- Serving/     -- Inference API, Model Cache, A/B Router
  +-- References: "API Platform" [REF]

  [Model 3] edge-services/ (7 components)
  |-- Edge/        -- Edge Proxy, Local Cache, Health Monitor
  |-- Regional/    -- Regional LB, Config Service, Regional DB
  +-- References: "API Platform" [REF]

  Adjust plan? (confirm / move / merge / rename)

  Note: The platform analyzes each model independently. Attack paths
  crossing model boundaries will not appear in analysis results.
```

> **Cross-model analysis gap (D65):** The decomposition confirmation must include this one-line warning. Users accepting decomposition should know that credential blast radius, lateral movement chains, and crown jewel reachability analysis do not traverse `REPRESENTS_MODEL` edges. If `credential_scope` values span multiple planned models, the decomposition plan should warn explicitly: *"Credential 'X' is used in both Model A and Model B. Lateral movement analysis cannot trace credential reuse across model boundaries. Consider keeping components that share this credential in the same model."*

Modifications are natural-language driven: *"move Kafka to api-platform"*, *"merge edge-services into api-platform"*.

**Status display with decomposition progress:**

```
User: /dethereal:status

Dethernety Plugin Status
  Platform:  https://app.dethernety.io (authenticated)

  Local models:
  +---+-----------------------------+---------+----------+
  | # | Model                       | Quality | Status   |
  +---+-----------------------------+---------+----------+
  | 1 | ./threat-models/api-platform/   | 78/100 | Synced   |
  | 2 | ./threat-models/ml-pipeline/    |   --   | Planned  |
  | 3 | ./threat-models/edge-services/  |   --   | Planned  |
  +---+-----------------------------+---------+----------+

  Decomposition plan: 1/3 models complete.
  Next suggested: ml-pipeline (contains Feature Store — data sensitivity)
```

**Resuming the next model in a subsequent session:**

```
User: /dethereal:threat-model ml-pipeline

Starting "ML Pipeline" threat model.

  Part of decomposition plan (model 2 of 3).

  Pre-created reference component:
    "API Platform" [REF] -> ./threat-models/api-platform/
    (linked to platform model abc-123 after sync)

  Discovery will use cached results. Components already assigned to
  api-platform and edge-services are excluded (D60).

  Scope Definition (Step 1):
    System:       ML Pipeline
    Intent:       Security review
    Crown jewels: Feature Store (PII training data), Model Registry
    Exclusions:   API Platform (separate model), Edge Services (separate model)
    Trust assumptions: API Platform authentication is trusted (modeled separately)

  Confirm this scope? (yes / modify)
```

### Scope Summary Display

```
Threat Model Scope
==================
System:       E-Commerce Platform
Intent:       Security review (pre-release)
Depth:        Design-level
Compliance:   PCI-DSS, SOC2
Crown jewels: Payment database, User credentials store
Exclusions:   CI/CD pipeline, CDN configuration

Quality gate: PASS (1 crown jewel identified, 1 entry point defined)

Proceed with this scope?
  - "yes"    — Accept scope and continue
  - "modify" — Adjust scope parameters
  - "save"   — Save scope and review later
```

The "save" option supports asynchronous scope review — the scope is written to `<model-path>/.dethereal/scope.json` and the workflow pauses at the `SCOPE_DEFINED` state.

---

## 2. Interaction Patterns

### Natural Language Editing

```
User: Add a Redis cache between the API and the database

Plugin: Adding Redis cache to your model...

  Added:
    Component: "Redis Cache" (STORE) in Private VPC boundary
  Added data flows:
    API -> Redis Cache ("Cache read/write")
    Redis Cache -> Database ("Cache miss passthrough")
  Removed data flow:
    API -> Database (replaced by cache-mediated path)

  Updated files:
    structure.json   (1 component added)
    dataflows.json   (2 added, 1 removed)
```

### Corrections

```
User: Actually, the frontend talks directly to Auth0, not through the API.

Plugin: Understood. Updating data flows:
  Removed: Frontend -> API -> Auth0
  Added:   Frontend -> Auth0 (direct)
  Kept:    Auth0 -> API (JWT validation -- still needed?)

  Should I keep the Auth0 -> API flow for token validation?
```

Pattern: acknowledge change, show what was done, ask about implications. Never silently modify unrelated elements.

### When to Ask vs Suggest

**Ask when the decision has security implications.** Trust zone placement, data sensitivity classification, authentication decisions.

**Suggest when low-stakes and reversible.** Component naming, position coordinates, handle selection.

**Never assume sensitivity classifications.** If the user mentions "user data," ask what kind (PII, credentials, financial, health) rather than guessing.

### Batch Confirmations

Present 3-5 related decisions at once rather than one at a time:

```
Plugin: I have a few assumptions to confirm:

  1. Redis is used as a cache (not primary data store) -- correct?
  2. The API -> Database connection uses TLS -- correct?
  3. Auth0 is the only identity provider -- correct?

  Confirm all? Or flag items to correct? (yes / no / 1,3 to correct)
```

When the user flags items for correction, present only those items with their current values and ask for the corrected values in a single prompt:

```
Items 1, 3 flagged for correction:
  1. Redis is a cache (not primary store) — your correction?
  3. Auth0 is the only IdP — your correction?
```

Accept all corrections in one response. Do not ask about corrected items individually — this keeps the correction to one additional turn.

---

## 3. Information Presentation

### Tables for Element Lists

Fixed-width tables for component lists, data flows, validation results. Maximum 5-6 columns.

```
Components (5):
+------+---------------------+--------+-----------------+--------+
| ID   | Name                | Type   | Boundary        | Class  |
+------+---------------------+--------+-----------------+--------+
| c-01 | Next.js Frontend    | PROC   | Public/Vercel   | --     |
| c-02 | Node.js API         | PROC   | Private/ECS     | --     |
| c-03 | PostgreSQL          | STORE  | Data/RDS        | --     |
+------+---------------------+--------+-----------------+--------+
```

### Tree Views for Hierarchy

```
Model: "Production Stack"

  Internet Zone/
  |-- End Users (EXTERNAL_ENTITY)
  |
  Public (Vercel)/
  |-- Next.js Frontend (PROCESS)
  |
  Private VPC/
  |-- Node.js API (PROCESS)
  |-- Data Tier/
  |   |-- PostgreSQL Database (STORE)
  |   +-- Redis Cache (STORE)
  |
  External/
  +-- Auth0 (EXTERNAL_ENTITY)
```

### Inline Data Flow Visualization

For small models (under 10 flows):

```
Data Flows (5):
  Users ----[HTTP requests]----> Frontend
  Frontend -[API calls]-------> API
  API ------[SQL queries]-----> PostgreSQL
  Frontend -[Auth redirect]---> Auth0
  Auth0 ----[JWT validation]--> API
```

For larger models, suggest viewing in the Dethernety web UI.

### Batch Size Scaling

For batch confirmations (discovery results, classification proposals), adapt presentation to element count:

- **Under 15 elements**: Single table, as shown above
- **15--40 elements**: Group by type (components, boundaries, data flows) or by source (Terraform, K8s, code) with per-group confirmation
- **40+ elements**: Summary first ("Found 67 components across 4 sources"), then drill into each category with per-category confirmation

The user should never face a single table with more than 15 rows requiring individual review.

### MITRE Mapping Display

```
MITRE ATT&CK Coverage:
  T1190  Exploit Public-Facing App    -> Frontend, API
  T1078  Valid Accounts               -> Auth0, API
  T1565  Data Manipulation            -> Database
  T1040  Network Sniffing             -> API <-> Database flow
```

---

## 4. File-Based Model Presentation

### Current Format (Retained)

The split-file JSON format is retained for its git-friendliness and separation of concerns:

```
./threat-models/production-stack/
  manifest.json      # Model metadata and module references
  structure.json     # Boundary/component hierarchy
  dataflows.json     # Data flow connections
  data-items.json    # Data classifications
  attributes/        # Per-element configurations
    boundaries/
    components/
    dataFlows/
    dataItems/
  .dethereal/        # Plugin metadata (not synced to platform)
    state.json
    discovery.json
    quality.json
    scope.json
    audit_trail.json
```

### Enhancement: Auto-Generated README.md

The plugin generates (and regenerates on changes) a `README.md` at the model root for human browsing. This file is never imported.

```markdown
# Production Stack -- Threat Model

> Auto-generated by Dethereal. Do not edit.

## Architecture Overview

  Internet Zone/
  |-- End Users (EXTERNAL_ENTITY)
  ...

## Data Flows

| # | Source | Target | Name |
|---|--------|--------|------|
| 1 | End Users | Frontend | HTTP requests |
...

## Status

- Components: 5 (3 classified, 2 unclassified)
- Last synced: 2026-03-25T14:30:00Z
- Platform model ID: abc-123-def-456
```

### Enhancement: Named Attribute Files

Instead of UUID-only filenames (`550e8400-e29b-41d4-a716-446655440001.json`), use `nodejs-api__550e8400.json` where the prefix is a slugified component name and the suffix is a short UUID. File content remains unchanged.

### Plugin Metadata Directory

Project-level plugin metadata lives in `.dethernety/` at the project root:

```
project-root/
  .dethernety/
    models.json       # Registry of known model paths
    config.json       # Plugin configuration
```

Per-model metadata lives in `<model-path>/.dethereal/`:

```
./threat-models/production-stack/
  .dethereal/
    state.json        # Methodology state machine position
    discovery.json    # Auto-discovery provenance records
    quality.json      # Last quality gate results
    scope.json        # Scope definition and exclusions
    audit_trail.json  # Sign-off records and operation history
```

Separates plugin state from model data that syncs to the platform. Models are stored at user-chosen visible paths (e.g., `./threat-models/production-stack/`), not hidden inside `.dethernety/`.

**Gitignore policy for `.dethereal/`:**
```gitignore
# Ephemeral plugin metadata (exclude)
.dethereal/discovery.json    # provenance, potentially sensitive file paths
.dethereal/state.json        # workflow state, ephemeral
.dethereal/quality.json      # computed, can be regenerated

# Substantive artifacts (include — do NOT gitignore)
# .dethereal/scope.json      # scope is part of the threat model record
# .dethereal/audit_trail.json # compliance evidence for SOC2/PCI
```

### External Edit Detection

When model files are modified outside the current session (via direct JSON editing, git branch switches, or other tools), the plugin should:

1. Re-validate the model on next skill invocation
2. Update the quality score
3. If `<model-path>/.dethereal/state.json` is inconsistent with model content (e.g., state says `CLASSIFIED` but no classes assigned), warn the user and offer to infer state from model content

This is important because models are committed to git — branch switches will change model files unexpectedly.

### State Invalidation Warning

When a user modifies a model that has already progressed past certain methodology states, the plugin warns about state regression:

```
You added a new component ("Message Queue") to a model that was
already in the enrichment phase.

Impact:
  - Model state reverted from ENRICHING to STRUCTURE_COMPLETE
  - Existing enrichment on 10 other components is preserved
  - "Message Queue" needs classification and enrichment

Run /dethereal:classify to classify the new component,
then /dethereal:enrich to add its security attributes.
```

---

## 5. Sync Experience

### Mental Model

**Mental Model:** Local files are your working copy. When connected to the platform, sync keeps them in agreement. On conflict, you choose which version wins. After sync, both local and platform agree. If you work offline, your local files are authoritative until you sync. Analogous to git: edit locally, push/pull to synchronize.

### Sync Pull (Export from Platform)

```
User: /dethereal:sync pull abc-123

Plugin: Pulling "Production Stack" from platform...

  Downloading... done
  Writing files:
    manifest.json        (1.2 KB)
    structure.json       (4.8 KB)    5 boundaries, 12 components
    dataflows.json       (2.1 KB)    8 flows
    data-items.json      (0.6 KB)    3 items
    attributes/          (14 files)

  Exported to: ./threat-models/production-stack/

  Next: edit files locally, then /dethereal:sync push to push changes back.
```

### Sync Push (Import to Platform)

```
User: /dethereal:sync push ./production-stack

Plugin: Pushing from ./threat-models/production-stack/...

  Validating... 0 errors, 0 warnings
  Importing to platform... done

  Created model: "Production Stack"
  Model ID: abc-123-def-456
  Elements: 5 boundaries, 12 components, 8 flows, 3 data items

  Server IDs written back to source files.

  View in platform: https://demo.dethernety.io/model/abc-123-def-456
```

**Partial sync failure:** If sync fails mid-operation, the plugin reports which elements were synced and which were not. Local files remain unchanged until the full operation completes. The user can retry `/dethereal:sync push` to push remaining changes.

### Post-Sync: Countermeasure-to-Exposure Linking (R6/F3)

After sync push, if the model contains countermeasures, the guided workflow reads back platform-computed exposures and presents a batch linking table. Without this step, the Analysis Engine's defense coverage gap analysis will not credit existing controls.

```
Plugin: Sync complete. The platform computed 8 exposures for your model.

  You have 5 countermeasures not yet linked to exposures.
  I'll match them based on component and control type:

  Countermeasure                  Suggested Exposure Match         Confidence
  ─────────────────────────────────────────────────────────────────────────────
  WAF on API Gateway              Missing input validation (API)   high
  TLS on DB Connection            Unencrypted data in transit (DB) high
  MFA on Admin Portal             Weak authentication (Admin)      high
  Encryption at rest (S3)         Unencrypted storage (S3)         medium
  Rate limiting (API)             No match found                   --

  Confirm these mappings? (yes / edit / skip)
```

If the user skips:
```
Plugin: Skipped. Your controls exist but are not linked to exposures.
  Analysis will undercount your defenses until linked.
  Run /dethereal:enrich to link them later.
```

### V1.1 Target: Bidirectional Sync with Conflict Resolution

> D40: V1 supports push (import to platform) and pull (export from platform) with overwrite semantics. Bidirectional sync with conflict detection, field-level merge, and merge precedence rules is planned for V1.1. The conflict resolution UX below is aspirational design for V1.1.

<details>
<summary>V1.1 Conflict Resolution UX (deferred)</summary>

```
User: /dethereal:sync

Plugin: Comparing local files to platform state...

  +-------+------------------------+--------+----------+
  | Type  | Element                | Local  | Platform |
  +-------+------------------------+--------+----------+
  | comp  | Redis Cache            | added  | --       |
  | comp  | Node.js API            | mod    | mod      |  CONFLICT
  | flow  | API -> Redis           | added  | --       |
  +-------+------------------------+--------+----------+

  1 conflict: "Node.js API"
    Local:    description updated
    Platform: position moved, class assigned

  How to resolve?
  - "local"    — Keep local version
  - "platform" — Keep platform version
  - "merge"    — Merge both (field-level)
  - "diff"     — Show full diff
```

Default precedence (local for descriptions/custom attributes, platform for position/IDs) applies only to non-conflicting fields. Fields changed on both sides always prompt for manual resolution.

</details>

### Sync Status

```
User: /dethereal:status

Plugin: Dethernety Connection
         Platform:  https://demo.dethernety.io
         Auth:      Authenticated (45 min remaining)

        Local Model: ./threat-models/production-stack/
         Name:      "Production Stack" (abc-123)
         Sync:      2 local changes since last sync
         Last sync: 2026-03-25T10:00:00Z (4 hours ago)
```

For never-synced models:

```
User: /dethereal:status

Plugin: Dethernety Connection
         Platform:  https://demo.dethernety.io
         Auth:      Authenticated (45 min remaining)

        Local Model: ./threat-models/production-stack/
         Name:      "Production Stack"
         Sync:      Never synced (local only)

         To push to platform: /dethereal:sync push
         To continue offline: edit files directly or use /dethereal:add
```

### Error Recovery for Sync

If sync encounters errors:
- **Network failure during push:** Local files unchanged. Retry `/dethereal:sync push`.
- **Validation failure:** Fix errors shown by validation output, then retry.
- **Auth expired during sync:** Re-authenticate with `/dethereal:login`, then retry.
```

For development environments with authentication disabled:

```
Dethernety Connection
  Platform:  http://localhost:3003
  Auth:      Disabled (development mode)

  All tools available without login.
  Note: Auth-disabled mode should not be used in production.
```

---

## 6. Progress and Feedback

### Auto-Discovery Progress

```
User: /dethereal:discover

Plugin: Scanning codebase for infrastructure...

  [1/5] Terraform files (./infra/)
        Found: 3 resources (ECS service, RDS instance, S3 bucket)

  [2/5] Kubernetes manifests (./k8s/)
        Found: 2 deployments, 1 service, 1 ingress

  [3/5] Docker Compose (./docker-compose.yml)
        Found: 4 services

  [4/5] API definitions (./openapi.yaml)
        Found: 12 endpoints

  [5/5] Application code (./src/)
        Found: 3 database connections, 2 external API calls

  Sources checked: Terraform (3), K8s (4), Docker (4), API defs (12), Code (5)
  Deduplication: 15 unique elements (7 merged from overlapping sources)
```

The sources-checked summary (D65) makes omissions visible. If a source category has no matching files, it shows `(—)`. If a source fails to parse, it shows `(⚠ error detail)`. Example with a gap:

```
  Sources checked: Terraform (3), K8s (—), Docker (4), CI/CD (⚠ parse error in .github/workflows/deploy.yml), Code (5)
```

### Enrichment Progress

```
User: /dethereal:enrich

Plugin: Enriching model "Production Stack"...

  [1/5] Node.js API
        Class: Web Application Server (matched by name + type)
        Template attributes: 5/8 set (from class template)
        Missing: session_management, cors_policy, csp_enabled

  [2/5] PostgreSQL Database
        Class: Relational Database (matched by name)
        Template attributes: 3/10 set (from class template)
        Missing: ssl_enabled, password_encryption, log_connections, ...

  ...

  Enrichment priority order (D43):

  TIER 1 — Crown jewels (must enrich for meaningful analysis):
    PostgreSQL Database, Redis Cache
    6 attributes each, ~5 min

  TIER 2 — Cross-boundary components:
    Node.js API, Auth0
    6 attributes each, ~5 min

  TIER 3 — Internet-facing (highest attacker accessibility):
    Next.js Frontend, API Gateway
    6 attributes each, ~5 min

  TIER 4 — Internal only (can defer):
    Background Worker, Log Aggregator
    Enriching these improves quality but is not required for analysis.

  Start with Tier 1? Or enrich all? (tier1 / all / pick)
```

On repeat invocations within the same model, the enrichment display uses the compact form (skips tier explanations):

```
Tier 1: 2 components (done). Tier 2: 2 components (ready). Tier 3: 2 (ready). Tier 4: 2 (deferred).
Continue with Tier 2?
```

### Analysis Polling

When a model is submitted for analysis, the plugin polls at 10-second intervals with a single updating status line (not a new message per poll):

```
Submitted "Production Stack" for analysis...

Analysis running... 4/12 tasks complete (evaluating trust boundary crossings)

  You can continue editing other models while this runs.

Analysis complete. 12 exposures, 3 critical findings.
Top finding: Unencrypted database connection crosses trust boundary

Run /dethereal:surface for the full attack surface summary.
```

**Polling contract:** Poll `manage_analyses(action: 'status')` every 10 seconds. Maximum 18 polls (3 minutes). After 3 minutes without completion, suggest: "Analysis still running. Check the platform UI for progress, or run `/dethereal:review` later to retrieve results."

### Model Completeness Dashboard

```
User: /dethereal:review

Plugin: Model Review: "Production Stack"
        =================================

  Quality Score: 41/100 (In Progress — minimum 70 for analysis)

  +-----------------------------------+-------+--------+------+------+
  | Factor                            | Value | Weight | Pts  | Max  |
  +-----------------------------------+-------+--------+------+------+
  | Component classification          |   60% |    25% |   15 |   25 |
  | Attribute completion              |   40% |    20% |    8 |   20 |
  | Boundary hierarchy                |  good |    15% |   15 |   15 |
  | Data flow coverage                |   20% |    15% |    3 |   15 |
  | Cross-boundary data classification|    0% |    10% |    0 |   10 |
  | Control coverage                  |    0% |    10% |    0 |   10 |
  | Credential coverage               |    0% |     5% |    0 |    5 |
  +-----------------------------------+-------+--------+------+------+
                                                  Total:  41 / 100

  Highest-impact next action: Classify 2 remaining components (+10 points)

  Checks:
    [PASS] All data flow references valid
    [PASS] No orphaned components
    [WARN] 2 components have no outgoing data flows
    [WARN] External entities share boundary with internal components

  Ready for analysis: No (minimum 70 recommended)
```

When the quality score is below the analysis threshold, the default view is improvement-oriented (no detailed factor table — that is a V1.1 addition via `--breakdown` flag):

```
Quality Score: 41/100 (In Progress — minimum 70 for analysis)

Fastest improvements:
  # | Action                                  | Effort | Impact
  1 | Classify 2 remaining components         | Low    | +10 pts
  2 | Add data flows to 2 orphan components   | Low    | +9 pts
  3 | Fill attributes on 3 components         | Medium | +8 pts
  4 | Classify data items on boundary-crossing | Medium | +5 pts
    | flows (0/4 classified)                  |        |

Total if all done: ~73/100 (Good — ready for analysis)

Run /dethereal:classify to start with #1 (highest impact, lowest effort).
```

When the model reaches analysis readiness (quality >= 70), `/dethereal:review` adds a one-line discovery basis:

```
Model based on: code analysis (10 components) + manual (2). Known gaps: 3.
```

### V1.1 Target: Model Confidence Summary and Board-Ready Statement

> D53: Full confidence summary (discovery method, component counts by confidence, model freshness, board-ready statement with editorial workflow) is deferred to V1.1. The V1 review output focuses on quality score, structural checks, and improvement actions — the information developers need. Executive communication features require validation against actual board-level use, which is premature for V1.

---

## 7. Error Handling and Recovery

### Validation Errors

```
Plugin: Validation Results: 2 errors, 1 warning

  ERRORS:

  1. dataflows.json
     Flow "API -> Cache" references source "component-xxx"
     which does not exist in structure.json.
     Hint: Did you mean "component-api" (Node.js API)?

  2. manifest.json
     defaultBoundaryId does not match any boundary.

  WARNINGS:

  1. attributes/components/old-component.json
     References component not in structure.json (stale file?).

  Fix errors before importing. Run /dethereal:review --structure-only to re-check.
```

### Token Expiry Handling

The MCP server attempts auto-refresh using the stored refresh token. If the refresh token is also expired, the tool returns an authentication error. The agent prompt includes instructions to suggest re-running `/dethereal:login` when auth errors occur:

```
Plugin: Session expired. Please re-authenticate:
  /dethereal:login
```

After re-authentication, the agent retries the failed operation.

### MCP Health Check Errors

```
/dethereal:status

Dethernety Plugin Status
  MCP server:  ERROR — connection failed

Troubleshooting:
  1. Verify the MCP server is built: pnpm build (in plugin directory)
  2. Check Node.js version: node --version (requires 18+)
  3. Verify DETHERNETY_URL is set in your environment
  4. Run with --debug flag for detailed MCP logs
```

### Undo/Revert (D65)

Model files are version-controlled (D27), so git provides the undo mechanism for V1. The LLM assists with git commands — no specialized git knowledge is required from the user:

```
User: I want to undo the last enrichment

Plugin: I can help you revert. Let me check what changed:

  [runs git diff ./threat-models/production-stack/]

  Changed files:
  - attributes/nodejs-api__550e8400.json (6 attributes added)
  - attributes/postgres-db__a1b2c3d4.json (4 attributes added)
  - .dethereal/quality.json (score: 32 → 58)

  Options:
  - Revert all enrichment: git checkout -- ./threat-models/production-stack/attributes/
  - Revert specific component: git checkout -- ./threat-models/production-stack/attributes/nodejs-api__550e8400.json
  - Keep changes (cancel)

  Note: This reverts local files only. Platform model unchanged until sync.
```

**Commit before enrichment:** The session break at STRUCTURE_COMPLETE recommends a git commit. This creates a clean revert boundary — `git diff` shows exactly what enrichment added, and `git checkout` reverts to the pre-enrichment state without affecting the model structure.

The state machine's backward transitions (D29) handle workflow-level undo — reverting to an earlier methodology state when structural changes invalidate later phases. On any backward transition, `.dethereal/quality.json` is invalidated and `model_signed_off` is cleared (D64).

### Destructive Operation Guardrails

```
User: Delete the Redis cache from my model

Plugin: Removing "Redis Cache" would also affect:
  - Data flow: "API -> Redis Cache" (will be removed)
  - Data flow: "Redis Cache -> Database" (will be removed)
  - Attribute file: redis-cache.json (will be deleted)

  2 data flows removed with the component.
  Local only -- platform unchanged until sync.

  Proceed? (yes/no)
```

---

## 8. Expert vs Novice Paths

### Two-Mode Expertise System (D54)

The plugin uses an explicit two-mode toggle instead of implicit behavioral detection (which is fragile — a power user starting a new project appears as a novice):

**Default mode:** Includes brief terminology hints on first use of each concept in a session, template suggestions, post-action footer, and next-step suggestions. Suitable for most users.

**Expert mode:** Suppresses explanations and reduces footer verbosity. Enabled via `--expert` flag on any command or `dethereal.expert_mode: true` in plugin config.

### Default Mode Guardrails

- **Terminology explanations** on first use: "trust boundaries (separate security zones like DMZ, internal network)"
- **Template suggestions** rather than blank-page creation
- **Validation before import** with explanation of each error
- **Platform UI link** after model creation for visual diagram viewing
- **Flat model detection** when all components are in a single boundary: "Your model has all components in one trust zone. This means analysis cannot detect trust boundary violations — one of the most valuable findings. Would you like me to suggest trust boundaries based on your architecture?"

### Expert Mode Shortcuts

- `--yes` flag to skip confirmations on non-destructive operations
- Batch operations across multiple model directories
- Direct MCP tool invocation via natural language
- `--json` flag for scriptable output
- Suppressed terminology explanations and compact footer

### Agent Selection

**`threat-modeler` (default)** -- Balanced guidance. Asks clarifying questions. Produces well-structured models.

**`infrastructure-scout`** -- Discovery-focused. Scans code, produces draft inventories. Read-only.

**`security-enricher`** -- Expert-level security annotation. MITRE mappings, control recommendations.

**`model-reviewer`** -- Read-only auditor. Quality reports, gap analysis, readiness assessment.
