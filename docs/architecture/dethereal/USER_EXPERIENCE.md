# Dethereal Plugin -- User Experience Specification

> How users interact with the Dethereal plugin in Claude Code, Codex and OpenCode. Examples use the Claude Code command form (`/dethereal:<name>`); Codex runs the same commands as `$dethereal:<name>` and OpenCode as `/dethereal-<name>`, and where a harness behaves differently the text says so (see [PLUGIN_ARCHITECTURE.md → Per-Harness Output](PLUGIN_ARCHITECTURE.md#generator-lints-prompt-registry-rule-ledger-per-harness-output)).

## Table of Contents

- [1. User Journey](#1-user-journey)
- [2. Interaction Patterns](#2-interaction-patterns)
- [3. Information Presentation](#3-information-presentation)
- [4. File-Based Model Presentation](#4-file-based-model-presentation)
- [5. Sync Experience](#5-sync-experience)
- [6. Progress and Feedback](#6-progress-and-feedback)
- [7. Error Handling and Recovery](#7-error-handling-and-recovery)
- [8. Operator Paths and Agents](#8-operator-paths-and-agents)

---

## 1. User Journey

### Installation to First Interaction

**Session orientation.** On Claude Code a `SessionStart` hook runs at every startup, resume, clear and fork, and injects a short orientation built from the server's workspace status. Codex runs the same hook at startup, resume and clear (it has no `fork` event), and only once the operator has trusted the plugin's hooks. OpenCode has no startup hook, so it shows no orientation: `/dethereal-help` or `/dethereal-status` gives the same view. The wiring per harness is in [PLUGIN_ARCHITECTURE.md → Hooks](PLUGIN_ARCHITECTURE.md#6-hooks). With no local model:

```
Dethereal threat modeling is active.

  /dethereal:create   -- Create or import your first threat model
  /dethereal:status   -- Check connection and sign-in
  /dethereal:help     -- See all available commands

  Or describe your system in plain language, for example:
  "a React frontend talking to a Go API with a PostgreSQL database"
```

Three commands, not twelve. Natural language path is presented as primary.

With one local model, the orientation names it with its state and quality, and the suggested next commands:

```
Dethereal is active.

  model "Production Stack": ENRICHING, quality 56/100, 2 stale elements

  Suggested next:
  /dethereal:enrich   -- <reason from the workspace status>
```

With several models it is one line (`Dethereal is active. 3 local threat models. Run /dethereal:status for details.`). A line about the platform is added only when something needs attention: the platform URL is not set (the local default is used), the URL is unusable, or the runtime is not trusted with the session. The orientation lists no platform models; pulling one is a `/dethereal:create` entry point. After a compaction the hook injects a reminder instead: re-read the workspace status and the model's state before continuing, never relying on the summary alone.

### Authentication Flow

```
User: /dethereal:status

Plugin:  Dethernety Connection Status
         -----------------------------------------
         Platform URL:  https://dethernety.example.com
         Auth status:   Not authenticated
         -----------------------------------------
         Run /dethereal:login to authenticate via browser.

User: /dethereal:login

Plugin:  Opening your browser to authenticate...
         Waiting for login (timeout: 2 minutes)...

         Authenticated successfully.
         Platform:     https://dethernety.example.com
         User:         user@example.com
         Token valid:  59 minutes remaining
```

### The "Hello World" -- First Threat Model

```
User: /dethereal:create

Plugin: I'll help you create your first threat model. Choose a starting point:

  1. Describe -- tell me about your system and I'll build the model
  2. Template -- start from a template: web application, API service, or microservices
  3. Import -- point to Terraform, Kubernetes manifests or architecture documents
  4. Pull -- fetch an existing platform model into local files

[prompt: create-mode] How do you want to start the model? (describe / template / import / pull)

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

[prompt: create-structure] Confirm this structure, or adjust specific rows? (confirm / adjust)
```

The AI's interpretation is presented explicitly before it becomes the model. Before the structure, the scope interview runs (one free-text `scope` question: crown jewels, trust assumptions, adversary classes, exclusions, compliance), so the model directory exists. Nothing is written until the operator confirms: on `adjust` the table is shown again until they do. The model is built on disk only; it is published later with `/dethereal:sync push`. **Import** hands over to discovery on the given path, and **Pull** to the sync skill.

After creation, the plugin writes the model's README and ends with the footer:

```
[done] Model "Production Stack" created with 5 components, 5 data flows. Quality: 15/100.
[next] When you're ready: /dethereal:discover (scan the codebase for more infrastructure)
[info] Quick model: /dethereal:threat-model continues it; with --full it builds it in full.
Run /dethereal:help to see all available commands.
```

The `[info]` line appears only on a quick model — every created model unless the run had `--full`, and never a pulled one; on an import it follows discover's footer. The `/dethereal:help` line appears only for a first model. This created a minimal model. To continue, run `/dethereal:threat-model` on it — it picks up where you left off in the model's mode, not start over; with `--full` it builds the model in full.

This bridges creation and enrichment. The `/dethereal:threat-model` skill handles this transition implicitly, but users entering via `/dethereal:create` or natural language need the `[next]` line.

### Universal Post-Action Footer (D42)

Every mutating skill ends with a 2-line status footer showing the model's state, the absolute quality score and a next-step suggestion:

```
[done] Classification complete. State: ENRICHING. Quality: 56/100.
[next] When you're ready: /dethereal:enrich (3 components need attributes)
```

The state is `display_state` from `model_state` `get`, which carries waivers, a stale review and the quick mark — and, only with the settlement on, pending or unregistered values (see [MCP_ARCHITECTURE.md → Settlement Switch](MCP_ARCHITECTURE.md#settlement-switch)). The `[next]` line is advice: the plugin never starts the command it names.

This pattern provides ambient progress awareness between skill invocations without requiring explicit `/dethereal:status` calls. The absolute score avoids computing a "before" value (which would require an additional MCP tool call per mutation). The cached score in `.dethereal/quality.json` is available if a delta is needed.

### Resume and Skip in Guided Workflow

When a user returns to an in-progress threat model, the guided workflow first deals with what changed while they were away, then shows progress and lets them continue or jump. Before the progress table, in this order:

1. **Complete?** A model at REVIEWED whose review is not stale is complete: the plugin says so, points to `/dethereal:sync push` and `/dethereal:surface`, and stops.
2. **Drift**, when the model has a drift baseline: sources changed since then are reconciled first (see [DRIFT_DETECTION.md](DRIFT_DETECTION.md)).
3. **Crown jewels**, at ENRICHING or later, when Gate 3's C6 fails (a jewel unmapped, or its elements gone): the mapping is confirmed again.

Then the progress table:

```
Progress: "Production Stack" (Quality: 41/100)

| Step | Name                                    | Status      |
|------|-----------------------------------------|-------------|
| 1    | Scope Definition                        | [done]      |
| 2    | Discovery (modules: dethernety-general) | [done]      |
| 3    | Model Review                            | [done]      |
| 4    | Boundary Refinement                     | [auto-skip] |
| 5    | Data Flow Mapping                       | [>>>>]      |
| 6    | Classification                          | [    ]      |
| 7    | Data Item Classification                | [    ]      |
| 8    | Enrichment                              | [    ]      |
| 9    | Validation                              | [    ]      |
| 10   | Sync                                    | [    ]      |
| 11   | Post-Sync Linking                       | [    ]      |

[prompt: resume-cursor] Continue from Step 5, or jump to a step? (continue / a step number)
```

There is no restart option. The cursor is the first step not done: Steps 1–5 by the state the model has reached, Step 6 once Gate 3's C1 passes (every non-external component classified), Step 7 once a quick run has passed it; Steps 7–9 are otherwise never skipped on their own, and an open loop back puts the cursor at Step 9. Prior work therefore advances the cursor only through the server's verdicts: a model whose components were classified by an earlier `/dethereal:classify` run shows Step 6 as done when C1 passes, and while one non-external component is unclassified the cursor stays at Step 6.

**After a compaction.** When the conversation is compacted, the plugin injects a reminder to re-read the workspace status and the model's state: a `SessionStart` hook on `compact` on Claude Code and Codex, and on OpenCode its plugin, which adds the workspace state to the compaction context. The workflow re-enters the phase it was in (`--phase <phase> <model-path>`), reads the state and the model files again, and takes up the step they show; any question still unanswered is asked again. It does not run the drift check or ask the progress question again.

### Quick Mode Journey

A new model, started by `/dethereal:threat-model` or made with `/dethereal:create`, is a quick model unless the operator adds `--full`; a pulled model is a full model. Quick mode is for a first pass the operator means to deepen later. Steps 1–7 run in full; Step 8 enriches only the priority set (what Gate 3 holds to its floors), asks no scope question and defers the control pass to `/dethereal:enrich --focus controls`; Step 9 shows only the quality score, the red flags and the Top Findings (at most five ranked attack chains), with no Gate 3 verdict or review question; Steps 10–11 run as usual. The model is marked quick, and every place that shows its state carries the mark (`ENRICHING (quick)`): `/dethereal:status`, `/dethereal:review`, the push confirmation, the README (whose first line reads "Quick model, not reviewed: deepen with the threat-model skill and --full.") and the final footer, whose next step names deepening. A quick model is never REVIEWED.

**Deepening.** A later `/dethereal:threat-model` on the same model without a mode flag keeps it quick and resumes where it stopped. With `--full`, it clears the mark and, once the quick run has passed Step 7, resumes at Step 8 with the full scope (the progress table shows Steps 1–7 as done). When the step taken up is Step 7 or later, a Step 6 classification pass runs first — the pass a quick run may have skipped, with its classification gate — then that step. That deepening run offers the control pass and runs Step 9 with Gate 3, loop back, waivers and the review record. See [Quick Mode](../../user/dethereal/GUIDED_WORKFLOW.md#quick-mode).

### Session Break after Step 5 (D65)

After Step 5 (data flow mapping, state transitions to ENRICHING) of a full run, the guided workflow presents a checkpoint; a quick run skips it and goes on to Step 6 in the same turn. The message is calibrated to model size:

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

### Decomposition Recommendation

In Step 2, after the discovered components are confirmed and the blind-spots question is answered — before anything is written to the model files — the plugin checks the confirmed inventory against the complexity thresholds (D55/D56: 21+ components, 9+ trust boundaries, 36+ data flows or 19+ cross-boundary flows). If one is exceeded, it shows the thresholds exceeded and a recommendation. The framing is factual, not judgmental — the user made a legitimate scoping choice.

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

  [prompt: decomposition] The model exceeds the complexity thresholds shown.
  Narrow the scope, plan a decomposition, or continue with one model?
  (narrow / decompose / continue)
```

**Decomposition plan (when user described multiple systems):**

```
Discovery complete. Found 28 components across 5 trust boundaries.

  Your system spans 3 deployment environments with separate CI/CD
  pipelines. Options:

  - continue  — one model, 28 components, ~50-70 min to enrich
  - decompose — separate models, 3 natural clusters:
      "API Platform" (12), "ML Pipeline" (9), "Edge Services" (7)
      Linked via representedModel.
  - narrow    — begin with the highest-risk subsystem, expand later

  [prompt: decomposition] The model exceeds the complexity thresholds shown.
  Narrow the scope, plan a decomposition, or continue with one model?
  (narrow / decompose / continue)
```

**On narrow or decompose, show the proposed split before anything is written** — for narrow, the elements this model keeps and what it leaves out; for decompose, each planned model with its elements and the cross-model links:

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

  [prompt: decomposition-scope] Is this the split you want? (confirm / change)

  Note: The platform analyzes each model independently. Attack paths
  crossing model boundaries will not appear in analysis results.
```

> **Cross-model analysis gap (D65):** The decomposition confirmation must include this one-line warning. Users accepting decomposition should know that credential blast radius, lateral movement chains, and crown jewel reachability analysis do not traverse `REPRESENTS_MODEL` edges. If `credential_scope` values span multiple planned models, the decomposition plan should warn explicitly: *"Credential 'X' is used in both Model A and Model B. Lateral movement analysis cannot trace credential reuse across model boundaries. Consider keeping components that share this credential in the same model."*

Changes are natural-language driven: *"move Kafka to api-platform"*, *"merge edge-services into api-platform"*. The plugin applies them and shows the split again until the operator confirms; only then are this model's elements and the plan (`.dethernety/decomposition-plan.json`) written.

**Status display with decomposition progress:**

```
User: /dethereal:status

Dethernety Plugin Status
  Platform:  https://dethernety.example.com (authenticated)

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

  Discovery scans the codebase again; components the plan already
  assigns to api-platform and edge-services are filtered out of its
  results (D60).

  [prompt: scope] To scope the model: the system's name and a one-line
  description, if you have not given them. What are the most valuable
  assets in this system (crown jewels)? What do you explicitly trust?
  Which adversary classes should it consider (external, insider,
  supply_chain, others)? Anything out of scope? Any compliance
  requirements, and the depth and intent if not the defaults?
```

### Scope Interview

The scope is collected in conversation, not as a form: the plugin takes what the operator already said and asks for the rest in one free-text question.

```
User: /dethereal:threat-model an e-commerce platform: Next.js storefront,
      Node.js order API, PostgreSQL, Stripe for payments

Plugin: [prompt: scope] To scope the model: the system's name and a one-line
  description, if you have not given them. What are the most valuable
  assets in this system (crown jewels)? What do you explicitly trust?
  Which adversary classes should it consider (external, insider,
  supply_chain, others)? Anything out of scope? Any compliance
  requirements, and the depth and intent if not the defaults?

User: Crown jewels are the payment database and the user credentials store.
      We trust Stripe's side. External and insider. CI/CD is out of scope.
      PCI-DSS and SOC2; design-level security review.
```

The answer becomes `<model-path>/.dethereal/scope.json`. Only the system name, the description and at least one crown jewel are required; the rest have defaults, and nothing checks for an entry point. The plugin then scaffolds the model on disk and moves it to `SCOPE_DEFINED` — there is no separate confirm or save question. The crown jewels are mapped to elements later, at Step 6.

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

### Table Kinds and Caps

Every table shown before a question is one of three kinds, and its kind sets how much of it may be folded:

| Kind | The answer… | Shown |
|------|-------------|-------|
| **Confirm** | writes values (discovery, classification, data items) | Every row and every value it writes, each with its basis, never folded or capped; pages of at most 50 rows. "Accept all" covers only the rows in that message. The enrichment relay is the exception: its relay files are shown in one message, or one file per message past 50 written values (the conversation may summarize them), and "accept all" covers all the written values |
| **Collect** | supplies values (credentials, open fields) | At most 15 subjects per table. Rows with nothing known fold into one line that keeps their ids and names; a pre-filled cell never folds |
| **Display** | picks a direction and writes nothing (gaps, gate failures) | At most 10 rows per group, then `+N more — details <group>` |

Findings never fold and never count toward a cap: contradictions, changes to existing values, red flags, proposed defaults, rows newly failing a gate, lapsed waivers and crown-jewel rows. A row's evidence and rationale may wait behind `details <id>`, but never a value a question confirms.

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
  attributes/        # Per-element configurations, one file per element: attributes/<group>/<element-id>.json
    boundaries/
    components/
    dataFlows/
    dataItems/
  controls/          # The model's control library
  README.md          # Generated for human browsing; never imported
  .dethereal/        # Plugin metadata (not synced to platform)
```

### Enhancement: Auto-Generated README.md

The plugin generates a `README.md` at the model root for human browsing, on model creation (`/dethereal:create`) and at the end of the guided workflow (`/dethereal:threat-model`). It does not regenerate it on individual add or remove operations. This file is never imported.

```markdown
# Production Stack

> Auto-generated by Dethereal. Do not edit.

## Model Structure

  Internet Zone/
  |-- End Users (EXTERNAL_ENTITY)
  ...

## Data Flows

- End Users → Frontend: HTTP requests
...

## Status

Quality: 72/100 (Good)
State: REVIEWED
Last synced: 2026-03-25T14:30:00Z
Generated: 2026-03-25T14:31:02Z
```

On a quick model the first line under the title is `> **Quick model, not reviewed: deepen with the threat-model skill and --full.**`

### Enhancement: Named Attribute Files (not implemented)

A proposed alternative to id-only filenames: `nodejs-api__550e8400.json`, a slugified element name plus a short id. It was not built: attribute files are `attributes/<group>/<element-id>.json`, and the server renames them when a push replaces local ids with platform ids.

### Plugin Metadata Directory

Project-level plugin metadata lives in `.dethernety/` at the project root:

```
project-root/
  .dethernety/
    models.json               # Registry of known model paths (written by the server)
    discovery-cache.json      # Shared discovery results (multi-model projects)
    decomposition-plan.json   # Optional: planned models and progress
    .models.lock              # Registry lock
```

Per-model metadata lives in `<model-path>/.dethereal/`:

```
./threat-models/production-stack/
  .dethereal/
    state.json                # Workflow state; read and written only by the server
    scope.json                # Scope definition, crown-jewel map, active modules
    discovery.json            # Auto-discovery provenance records
    quality.json              # Last quality score (cache)
    class-cache/              # Class templates, keyed by class id
    template-fields/          # Per-element template field manifests
    loop-back.json            # An armed Gate 3 loop back
    relay/                    # Enrichment relay files, run-<n>.txt, one per enrichment run (this machine only)
```

Separates plugin state from model data that syncs to the platform. Models are stored at user-chosen visible paths (e.g., `./threat-models/production-stack/`), not hidden inside `.dethernety/`. A granted review is recorded in `state.json` (`reviewHash`, `reviewedAt`); there is no separate sign-off file.

**Gitignore policy for `.dethereal/`:**
```gitignore
# This machine's records — the server lists these in .dethereal/.gitignore itself
# .dethereal/sync.json, .dethereal/relay/, .dethereal/control-audit.log,
# .dethereal/settlement-baseline.json, .dethereal/settlements.json (settlement on only)

# Transient or local — recommended entries
.dethereal/pending-id-rewrite.json
.dethereal/control-audit.log
.dethereal/*.lock
.dethereal/*.tmp.*
.dethereal/*.breaking
.dethernety/.models.lock
.dethernety/discovery-cache.json

# Substantive artifacts (include — do NOT gitignore)
# .dethereal/state.json              # workflow state; a Gate 3 waiver in it counts only on the machine that granted it
# .dethereal/scope.json              # scope is part of the threat model record
# .dethereal/discovery.json          # provenance; drift detection reads it
# .dethereal/quality.json            # quality score cache
# .dethereal/class-cache/, .dethereal/template-fields/
# .dethernety/models.json, a decomposition plan
```

### External Edit Detection

When model files are modified outside the current session (via direct JSON editing, git branch switches, or other tools), the plugin should:

1. Re-validate the model on next skill invocation
2. Update the quality score
3. Read the state through the server, which judges it against the content: a state that claims REVIEWED reads as ENRICHING once the gates or the stale queue no longer support it, and a review whose content changed is reported as stale. With the settlement on, pending enrichment and unregistered values count as well, and values changed outside the workflow show up as unregistered

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

  View in platform: https://dethernety.example.com/model/abc-123-def-456
```

**Partial sync failure:** If sync fails mid-operation, the plugin reports which elements were synced and which were not. Local files remain unchanged until the full operation completes. The user can retry `/dethereal:sync push` to push remaining changes.

### Post-Sync: Countermeasure-to-Exposure Linking

After sync push, if the model contains countermeasures, the guided workflow reads back platform-computed exposures and presents a batch linking table. Without this step, the platform's defense coverage analysis will not credit existing controls.

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

  [prompt: linking] Link these exposures to the candidate countermeasures now,
  change specific rows, or defer? (yes / modify / defer)
```

On `modify`, the plugin takes the rows the operator drops or changes, shows the table again and asks again; a link is created only for a confirmed row, since a wrong link credits a control that does not mitigate the exposure. If the user defers:
```
Plugin: Deferred. The analysis undercounts your defenses until exposures
  are linked to countermeasures.
```

### Push Conflicts, and Field-Level Merge (not implemented)

Sync is push and pull. What ships is conflict **detection** on push: the server keeps a record of the last pull or push (`.dethereal/sync.json`), compares the platform model with it before an update push writes anything, and refuses with `PLATFORM_CHANGED_SINCE_SYNC` when the platform changed since. The plugin then shows the platform's changes — added on the platform (the push deletes them), changed, deleted on the platform (the push creates them again) — and asks `push-conflict`: push the local model anyway, pull the platform version first (local changes are backed up), or cancel. See [Push Conflict Resolution](SYNC_AND_SOURCE_OF_TRUTH.md#12-push-conflict-resolution).

> D40: Bidirectional sync with field-level merge and merge precedence rules was deferred and is not implemented. The conflict resolution UX below is the original design, kept as rationale.

<details>
<summary>Field-level conflict resolution UX (design, not implemented)</summary>

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
         Platform:  https://dethernety.example.com
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
         Platform:  https://dethernety.example.com
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

For development environments with authentication disabled:

```
Dethernety Connection
  Platform:  http://127.0.0.1:3000
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

  Worklist (from the Gate 3 snapshot):
    Crown jewels and their mapped elements: PostgreSQL Database, Redis Cache
    Rest of the priority set:               Next.js Frontend, API Gateway, Node.js API
    Flows Gate 3 lists as failing (C3):     API Gateway → Node.js API, Node.js API → PostgreSQL Database
    Every other in-scope element:           Background Worker, Log Aggregator

  Tiers: Tier 1: 2 · Tier 2: 2 · Tier 3: 3
  Cross-boundary pivots: 1

  Enrich the whole worklist, only the priority set (what Gate 3 holds to its floors), or pick elements? (all / priority / pick)

User: all

  [1/7] PostgreSQL Database
        Class: Relational Database (matched by name)
        Template attributes: 3/10 set (from class template)
        Missing: ssl_enabled, password_encryption, log_connections, ...

  ...

  [5/7] Node.js API
        Class: Web Application Server (matched by name + type)
        Template attributes: 5/8 set (from class template)
        Missing: session_management, cors_policy, csp_enabled

  ...
```

**Component tiers.** The tier sizes come from the server, which computes a tier for every non-external component; the operator never assigns one. Each component is in the first tier it qualifies for:

- **Tier 1** — internet-facing
- **Tier 2** — crown-jewel-bearing or restricted
- **Tier 3** — everything else, unzoned components included

Gate 3 holds Tier 1–2 to its attribute floors. The cross-boundary pivots (components outside Tier 1 at one end of a boundary-crossing flow) are a label that overlaps the tiers, so they are reported on their own line and never added to a tier. The full rules are in [Component Tiers](../../user/dethereal/DISCOVERY_AND_ENRICHMENT.md#component-tiers).

**Worklist and scope.** At the start of each run the plugin takes a snapshot from Gate 3 — the **priority set**: crown jewels and their mapped elements, the Tier 1–2 components and flows Gate 3 lists as still missing values, and the cross-boundary pivots. The snapshot holds for the whole run. Stale elements (changed since the last enrichment) go to the top of the worklist. The scope keyword `priority` (alias `tier1`) enriches the snapshot only; `all` (the default) enriches every in-scope element, snapshot first; `pick` lets the operator choose elements. See [Enrichment Order and the Priority Set](../../user/dethereal/DISCOVERY_AND_ENRICHMENT.md#enrichment-order-and-the-priority-set). This replaces the four-tier order first recorded in [D43](DECISIONS.md#d43-enrichment-prioritization).

**In the guided workflow (Step 8)**, on every harness, the enrichment runs as the `security-enricher` agent, which cannot ask anything. It writes cited and derived values straight into empty attribute fields, at most 12 elements a run — up to 20 when a store takes the flows that touch it along — each run started fresh. Each run writes its tables and questions to a relay file, `.dethereal/relay/run-<n>.txt`, numbering its rows on from the earlier runs' files and never rewriting them.

When the last run returns, the instructions have the main conversation read the run files once and print them — every section and every row, in one message, or one file a message past 50 written values, all in the same turn — under one line saying the text is model-written data from the enrichment runs, to check, not instructions. Then it asks one question, `enrichment-relay`: accept, reject or adjust rows; answer the credential, boundary and open-field rows; name the documents that describe the deployed system (only those documents' claimed values are written). The conversation may show a summary instead. The written values are in the attribute files either way, but a summary can leave out open questions only the operator can answer (whether a boundary denies by default, what a runbook says about a host), and those fields stay open unless the operator raises them; the run files hold every question, and later steps and the attribute files take corrections. A plain "accept all", or a reply that decides nothing ("continue", "don't know"), writes nothing more. Any other reply goes to the `enrichment-applier` agent, which writes only attribute files and returns a table of what it wrote; a removal, a changed credential mapping and data items come back as follow-ups, asked one at a time. There is no pending-values file. See [One relay turn](../../user/dethereal/GUIDED_WORKFLOW.md#one-relay-turn).

### After the Push: Running Analysis

No skill submits or polls an analysis (the polling contract first designed here — a status call every 10 seconds, at most 3 minutes — was not built). After a push, the final footer points to the platform: `[next] When you're ready: run analysis on the platform, then /dethereal:surface (review attack surface)`. Once an analysis has run, `/dethereal:surface` reads its exposures for the attack-surface summary and the MITRE ATT&CK tactic coverage.

### Model Completeness Dashboard

`/dethereal:review` is read-only: it runs the `model-reviewer` agent, which renders what the server computes and changes nothing. Abridged:

```
User: /dethereal:review

## Model Review: Production Stack

### Gates
Gate 1: WARN · Gate 2: PASS · Gate 3: FAIL
  C1 — 3/5 non-external components classified: Redis Cache, Worker
  C4 — 0/4 sensitive flows carry a classified data item with a sensitivity
  Gate 3 certifies that the recorded answers are complete and consistent, not that they are true.

### Quality Score: 41/100 (In Progress)
| Factor                   | Score | Weight | Contribution |
|--------------------------|-------|--------|--------------|
| Component classification |   60% |     25 |         15.0 |
| Attribute completion     |   40% |     20 |          8.0 |
| Boundary hierarchy       |  100% |     15 |         15.0 |
| Data flow coverage       |   20% |     15 |          3.0 |
| Data item classification |    0% |     10 |          0.0 |
| Control coverage         |    0% |     10 |          0.0 |
| Credential coverage      |    0% |      5 |          0.0 |

The score measures how completely the model describes the system, not how
secure the system is. The score is a label; it gates nothing.

### Red Flags (1)
- **API → Database** (`f-api-db`): `encryption_in_transit` = `none`

### Top Issues
1. **[Critical]** 2 components have no class (Redis Cache, Worker)
2. **[Warning]** 4 sensitive flows carry no classified data item
3. **[Info]** 2 components have no data flow (Worker, Log Shipper)

### Recommendations
- Run /dethereal:classify for Redis Cache and Worker

### Analysis Readiness
Not Ready for platform analysis:
  Gate 3 fails — a push is possible, but analysis would have gaps (C1, C4)

[done] Review complete. Gates: G1 WARN · G2 PASS · G3 FAIL. Quality 41/100 (In Progress).
[next] When you're ready: /dethereal:enrich (fill the gaps) or /dethereal:sync push (publish)
```

The full review also has a common-gaps checklist (administrative access, monitoring, backup, boundary crossings, external dependencies, human actors, two-way flows, error paths), the model's state as the server displays it, and cross-model gaps. Readiness comes from the server (`workspace_status`), never from the score: **Ready**, or **Not Ready** with each blocker in words — Gate 2 fails (the platform refuses the push), Gate 3 fails (a push is possible, but the analysis would have gaps), a model that could not be assessed, or — only with the settlement on — values awaiting confirmation or values nobody registered. When the model is Ready but has no credentials and no controls recorded, the review adds that analysis improves markedly with them. `--structure-only` runs only the structural checks (`[PASS]` / `[FAIL]` / `[WARN]` per line), with no gates and no score; the review has no other flag.

When `.dethereal/discovery.json` exists, `/dethereal:review` adds a one-line discovery basis, and always a reminder that runtime validation (a cloud asset inventory, DNS logs, network flow data) finds what the code does not show:

```
Model based on: code analysis (10 components) + manual (2). Known gaps: 3.
```

When the model carries trust zones, the review also rolls up an advisory **zoning-coherence** block — non-blocking findings such as unclassified boundaries, under-protected asset holders, management planes resolving to an exposed tier, undeclared external ingress, and flow-vs-conduit divergences. These inform the operator; they never lower the quality score or block a sync. See [TRUST_ZONING.md](TRUST_ZONING.md).

### Model Confidence Summary and Board-Ready Statement (not implemented)

> D53: A full confidence summary (discovery method, component counts by confidence, model freshness, board-ready statement with editorial workflow) was deferred and is not implemented. The review output focuses on the gates, the quality score, the red flags and improvement actions — the information developers need. Executive communication features require validation against actual board-level use.

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

Model files are version-controlled (D27), so git provides the undo mechanism. The plugin suggests the git commands and the operator runs them — the plugin never runs a git command that changes the repository — so no specialized git knowledge is required from the user:

```
User: I want to undo the last enrichment

Plugin: I can help you revert. To see what changed, run in your terminal:

    git diff -- ./threat-models/production-stack/attributes/

  To revert, run one of these yourself:
  - All enrichment (uncommitted):
      git checkout -- ./threat-models/production-stack/attributes/
  - One component:
      git checkout -- ./threat-models/production-stack/attributes/components/<element-id>.json
  - Or keep the changes.

  This discards the uncommitted attribute changes in those files.
  It reverts local files only; the platform model is unchanged until sync.
  Tell me once it ran.
```

**Commit before enrichment:** The session break after Step 5 recommends a git commit, which the operator runs. This creates a clean revert boundary — `git diff` shows exactly what enrichment added, and `git checkout` reverts to the pre-enrichment state without affecting the model structure.

**Undo leaves `.dethereal/` alone:** The suggested commands keep `.dethereal/` out, because the workflow state lives there and the server keeps it. Once the operator says the command ran, the plugin reads the model files again before anything else: they hold the restored values.

The state machine's backward transitions (D29) handle workflow-level undo — reverting to an earlier methodology state when structural changes invalidate later phases. On any backward transition the server deletes `.dethereal/quality.json` and clears the recorded review (`reviewHash`, `reviewedAt`), so the model is no longer REVIEWED (D64).

### Destructive Operation Guardrails

```
User: Delete the Redis cache from my model

Plugin: Removing "Redis Cache" would also affect:
  - Data flow: "API -> Redis Cache" (will be removed)
  - Data flow: "Redis Cache -> Database" (will be removed)
  - Attribute file: attributes/components/<id>.json (deleted through
    model_state_prune once you approve it)

  2 data flows removed with the component.
  Local only -- platform unchanged until sync.

  Proceed? (yes/no)
```

The skill never deletes a file itself. It passes `model_state_prune` exactly the files the operator confirmed in the chat table — that table is the display, on every harness — and the server deletes only those it finds orphaned; a file that only looks orphaned is listed for the operator to handle by hand (see [`/dethereal:remove`](../../user/dethereal/COMMAND_REFERENCE.md#detherealremove-element-reference)).

---

## 8. Operator Paths and Agents

### One Mode for Every Operator

Every operator gets the same behaviour; there is no expert mode. What adapts is the path, not a setting:

- **A first model.** When the project has no model yet, `/dethereal:create` says in a sentence or two what a threat model captures, guides a little more at each step, and ends by pointing to `/dethereal:help`.
- **State-aware help and orientation.** `/dethereal:help` and the session orientation suggest up to three commands from the model's current state (`workspace_status`), instead of listing every command. See [`/dethereal:help` Output](PLUGIN_ARCHITECTURE.md#detherealhelp-output).
- **Next steps everywhere.** Every mutating command ends with the post-action footer and its `[next]` line.
- **A shorter guided path by default.** A new model, from `/dethereal:threat-model` or `/dethereal:create`, is a quick model: the guided workflow builds the full structure but enriches only the priority set and skips the Gate 3 review, for a first pass deepened later with `--full`; `--full` from the start gives the full run (see [Quick Mode Journey](#quick-mode-journey)).
- **Targeted commands.** Experienced operators run the individual commands (`/dethereal:add`, `/dethereal:classify`, `/dethereal:enrich --focus credentials`, …) or describe the change in natural language, instead of the full workflow.

The guardrails hold for everyone: validation before a push (Gate 2), with the failing checks named; templates and descriptions rather than a blank page at `/dethereal:create`; and the boundary-hierarchy check of the guided workflow, which proposes sub-boundaries for a flat model because a flat model cannot show trust-boundary violations. Confirmations are never skipped, whatever the operator's experience: every value the operator gives is confirmed before it is written, and every value the enrichment agent cites or derives from the source is listed in the enrichment relay files, for the operator to keep, reject or change.

### Two-Mode Expertise System (D54 — design, not built)

> **Not implemented.** D54 chose an explicit two-mode toggle — a default mode with terminology hints on first use of each concept, and an expert mode, enabled by an `--expert` flag on any command or a `dethereal.expert_mode: true` setting, that would suppress explanations, compact the footer, and add `--yes` (skip confirmations on non-destructive operations) and `--json` (scriptable output) flags. None of it was built: no command accepts `--expert`, `--yes` or `--json`, and there is no such setting. The design is kept here as the record of the decision; what ships is described above.

### Agent Selection

**`threat-modeler`** -- Edits a model's files directly. Asks clarifying questions and validates its edits. Not a default agent: select it with `@agent-dethereal:threat-modeler`; it sends the guided workflow, creation, removal, discovery, classification, enrichment, review and sync to their skills, which run from a regular session. On Claude Code, started directly, it hands the specialists' part itself: a scan (a look only; the discovery of record stays with `/dethereal:discover`), classification proposals the operator confirms, enrichment of already-stubbed elements (the agent writes cited and derived values, and the threat-modeler shows its relay file; `/dethereal:enrich` asks the rest and takes corrections) and a review. Drift re-verification, the control pass, gate decisions and publishing still run in their skills.

**`infrastructure-scout`** -- Discovery-focused. Scans code, produces draft inventories. Read-only.

**`infrastructure-scout-scoped`** -- The same scan, constrained to a precomputed file allowlist. Drift reconciliation uses it to re-verify the elements whose sources changed, without re-scanning the whole repository. Read-only.

**`security-enricher`** -- Runs in three modes: classification (proposes classes, the crown-jewel mapping and reclassifications; writes nothing), enrichment (writes cited and derived attribute values into empty fields, and its tables and questions to a relay file for the conversation to show) and the control pass. It records no MITRE techniques: technique coverage is derived on the platform from an analysis's exposures.

**`model-reviewer`** -- Read-only auditor. Quality reports, gap analysis, readiness assessment.

**`enrichment-applier`** -- Writes what the operator's reply to the Step 8 enrichment relay decides, and returns a table of it. Writes attribute files only; asks nothing, and returns removals, credential-mapping changes and data items as follow-ups for the conversation.
