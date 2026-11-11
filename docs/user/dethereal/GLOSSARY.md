---
title: 'Dethereal Glossary'
description: 'Definitions for Dethereal-specific terminology'
category: 'documentation'
position: 11
navigation: true
tags: ['dethereal', 'glossary', 'terminology', 'reference']
---

# Dethereal Glossary

Plugin-specific terminology. For platform-wide terms, see the [Dethernety Glossary](../../GLOSSARY.md).

---

## Plugin Concepts

**Agent** — A specialized AI persona with specific tools, behaviors, and constraints. Dethereal has 6 agents: threat-modeler, infrastructure-scout, infrastructure-scout-scoped, security-enricher, model-reviewer, and enrichment-applier. See [Agents, Tools, and Hooks](AGENTS_AND_ARCHITECTURE.md#the-6-ai-agents).

**Command** (also called **Skill** internally) — A command that performs a specific modeling workflow step. Each harness names it its own way: `/dethereal:<name>` on Claude Code, `$dethereal:<name>` on Codex, `/dethereal-<name>` on OpenCode; this documentation uses the Claude Code form. Commands invoke agents and use MCP tools. Dethereal has 14 commands. See [Command Reference](COMMAND_REFERENCE.md).

**Hook** — A lifecycle event handler that runs automatically at specific moments: when a session starts (including right after a context compaction), before a tool call, and after a file write. The Claude Code plugin ships five, on three events. See [Lifecycle Hooks](AGENTS_AND_ARCHITECTURE.md#lifecycle-hooks).

**MCP Tool** — A function exposed by the MCP (Model Context Protocol) server for platform communication. 30 tools handle authentication, model CRUD, the local workspace and workflow state, MITRE queries, security elements, classification, control-gap analysis, and attribute stub generation.

**MCP Server** — The TypeScript server (`@dether.net/dethereal`) that implements the Model Context Protocol, exposing platform capabilities as tools that AI agents can use.

---

## Model Structure

**Component** — A building block of the threat model. Three types: PROCESS (running software), STORE (data persistence), EXTERNAL_ENTITY (outside your control).

**Trust Boundary** — A security zone in your architecture where the rules change. Boundaries form a hierarchy representing network segments, access control zones, or deployment environments.

**Data Flow** — A directed connection between two components, representing communication. Cross-boundary flows are high-priority for security analysis.

**Data Item** — A classification of a type of data the system handles, with sensitivity level and regulatory labels. Components, data flows and boundaries link to it through `dataItemIds`.

**Sensitivity** — A data item's author-asserted confidentiality classification on a four-level scale, lowest to highest: `public`, `internal`, `confidential`, `restricted`. Absent ⇒ unclassified (which is *not* the same as `public`).

**Regulatory Flags** — Free-text compliance labels on a data item (e.g. `PCI cardholder`, `PHI`, `GDPR personal`), kept separate from sensitivity. Matched exactly and case-sensitively by the platform's compliance queries; see the [canonical vocabulary](../../architecture/dethereal/THREAT_MODELING_WORKFLOW.md#canonical-sensitivity-and-regulatory-flag-vocabulary) for the recommended set and casing.

**Origin** — A data item's author-asserted answer to who can write its content (`origin` in `data-items.json`), most to least trusted: `authenticated_first_party`, `curated_internal`, `agent_relayed`, `model_generated`, `third_party`, `arbitrary_public`, `not_assessed`. The last three are untrusted, and the least-trusted source wins. Absent ⇒ unclassified (which is *not* the same as `not_assessed`). See [Origin](MODEL_CONCEPTS.md#origin).

**Credential Flag** — A data item's author-asserted answer to whether it is a credential (`is_credential` in `data-items.json`): `true`, `false`, or absent (unknown). Enrichment proposes `true` for items bound to a credential-like data class and never sets it on its own; an answered `false` is kept. Distinct from [Credential Topology](#security-concepts). See [Origin and credential flag](DISCOVERY_AND_ENRICHMENT.md#origin-and-credential-flag).

**Class** — A predefined type from the platform's module system (e.g., "Database", "Web Application", "Load Balancer"). Classification assigns a class to an element, enabling attribute schemas and analysis.

**Attribute** — A security property of an element, stored in `attributes/<type>/<id>.json`. The 6 key component attributes are: authentication, encryption in transit, encryption at rest, logging, access control, and log telemetry.

**Split-File Format** — The directory structure for threat models: separate JSON files for manifest, structure, dataflows, data-items, and per-element attributes.

---

## Trust Zoning and Conduits

Zoning records the *declared design intent* of your segmentation — which trust tier each boundary sits on and which boundaries are meant to talk. The plugin stores it on each boundary in `structure.json` (`zone`, `planes`, `domains`, `conduits`) and round-trips it to the platform. For the full how-to (setting zones in the GUI, inheritance, the Zoning overview), see the platform guide [Boundary Trust Zones](../BOUNDARY_TRUST_ZONES.md).

**Trust Zone** — The exposure tier a boundary sits on: *who can reach it*. Stored as the `zone` field on each boundary. Six values: five on an exposure gradient, plus `VENDOR`, which sits off it. A boundary with no zone **inherits** one (see *Zone Inheritance*).

**The Six Zones** — The fixed set of trust-zone values the plugin writes to `zone`. Ordered by exposure, with the platform guide's friendly label in parentheses:

| Value | Friendly label | Reachable by |
|-------|----------------|--------------|
| `UNTRUSTED` | Open internet | Anonymous, hostile — the open internet |
| `PUBLIC` | Internet-facing | Directly reachable from the internet |
| `EXPOSED` | Behind the front door (DMZ) | Reachable only through a public edge |
| `INTERNAL` | Internal | Reachable only from trusted zones; the default fallback |
| `RESTRICTED` | Restricted | CDE, secrets, domain controllers, regulated-data stores |
| `VENDOR` | Trusted external | Vetted vendor / partner — kept **off** the exposure gradient |

**Zone Inheritance** — A boundary with no zone of its own (`zone: null`) resolves to the zone of its nearest ancestor boundary that declares one. If nothing up the chain declares a zone, it falls back to the default `INTERNAL` and is flagged (the `unclassified` finding).

**Structural Container** — A boundary that mainly *nests* other boundaries (a VPC, a cluster, a cloud account). It usually spans several tiers at once, so it **abstains** — the plugin proposes it no zone and does not nag it as unclassified. Zone the **leaf** boundaries inside it, not the wrapper. The model review renders a container's span as a **display roll-up** (`— structural · spans <min>…<max>`).

**Plane** — A boundary's operational role, stored in the `planes` array: `WORKLOAD` (runs application workload) and/or `MANAGEMENT` (runs admin / control-plane infrastructure). A `MANAGEMENT` plane that resolves to an exposed tier is a finding (`mgmt-plane`).

**Domain** — A free-text business-function tag on a boundary, stored in the `domains` array (e.g. `payments`, `identity`). Advisory grouping; the only finding that reads it is `cross-tier-domain`.

**Conduit (Approved Channel)** — A declared, directional channel recording that one boundary is *meant* to communicate with a peer, with an optional justification. Stored in the `conduits` array and written **OUTBOUND-canonical** (a crossing is recorded once, as `OUTBOUND` on the source; the inbound view is re-derived on read). The plugin authors only the `justification`; enforcement is left to analysis.

**Zoning Findings** — Six **advisory** findings the model review rolls up from your zoning. They inform; they **never** block a sync:

| Finding | Fires when |
|---------|-----------|
| `unclassified` | A boundary has no zone anywhere up its chain (falls back to default `INTERNAL`). |
| `under-protected` | A boundary holding an asset directly resolves looser than `RESTRICTED`. |
| `mgmt-plane` | A `MANAGEMENT` plane resolves to an exposed tier. |
| `external-ingress` | An external-tier boundary reaches a trusted tier with no approved channel. |
| `flow-channel` | A risk-bearing crossing diverges from its declared conduit (undeclared path, dead intent, or unreviewable declaration). |
| `cross-tier-domain` | A shared `domains` tag couples an externally-reachable boundary with a protected one. Dormant until you hand-author matching tags. |

**Declared Intent (not enforcement)** — Zoning and conduits document how trust is *meant* to flow; the platform does **not** verify or enforce them. Setting a zone does not block traffic, and declaring a conduit does not prove the channel exists. That judgement is the job of security analysis, which reads zoning as its baseline.

---

## Workflow and State

**State** — The current maturity level of a model. 6 states: INITIALIZED, SCOPE_DEFINED, DISCOVERED, STRUCTURE_COMPLETE, ENRICHING, REVIEWED.

**Quality Score** — A 0-100 score measuring model completeness (not system security). Computed from 7 weighted factors. Labels: Starting (0-39), In Progress (40-69), Good (70-89), Comprehensive (90-100).

**Quality Gate** — A progressive checkpoint with pass/fail criteria. Gate 1 (creation, advisory), Gate 2 (sync, blocking), Gate 3 (analysis, blocking).

**Waiver** — Your decision, with your reason on record, that one Gate 3 criterion's failure is accepted for named elements. You grant it only through Gate 3's waiver questions at Step 9 of the guided workflow. It counts only on the machine that granted it. A waiver granted elsewhere, in a copy of the model, or before waivers were bound to one machine is **inherited** and counts only once you grant it again on your machine. See [Waiving a Gate 3 gap](GUIDED_WORKFLOW.md#waiving-a-gate-3-gap).

**Quick Model** — A new model, started by `/dethereal:threat-model` or made with `/dethereal:create`, unless that run has `--full` (`/dethereal:threat-model --quick` asks for it explicitly, also on an existing model; a model pulled from the platform is never marked): Steps 1–7 in full, enrichment of the priority set only, and a read-only review — quality score, red flags and top findings — with no Gate 3 verdict. Its state carries the mark (e.g. `ENRICHING (quick)`), and it is never REVIEWED. It can be pushed. Running `/dethereal:threat-model` on it without a mode flag resumes it as a quick model; `--full` deepens it: the mark is cleared and, once the quick run has passed Step 7, the run resumes at Step 8; a quick run stopped before Step 7 resumes where it stopped. When the step taken up is Step 7 or later, a Step 6 classification pass runs first. See [Quick Mode](GUIDED_WORKFLOW.md#quick-mode).

**Scope** — The definition of what the model covers: system name, depth, modeling intent, crown jewels, compliance drivers, exclusions, trust assumptions. Stored in `.dethereal/scope.json`. The platform-synced fields (depth, modeling intent, compliance drivers, exclusions, trust assumptions) round-trip to the Model node; the rest stay local.

**Crown Jewel** — The most valuable asset in the system — what an attacker would target. Named in scope, matched to **components** during classification (synced as the `Component.crownJewel` field), and enriched first. A component holding a crown jewel is in Tier 2 unless it is internet-facing (Tier 1); see *Component Tier*.

**Component Tier** — The rank the server computes for each non-external component; you never assign one. Tier 1 (internet-facing), Tier 2 (crown-jewel-bearing or in a RESTRICTED zone), Tier 3 (everything else, unzoned components included). Each component is in the first tier it qualifies for. Gate 3 holds Tier 1–2 to its attribute floors. See [Component Tiers](DISCOVERY_AND_ENRICHMENT.md#component-tiers).

**Priority Set** — The snapshot enrichment takes from Gate 3 at the start of a run: crown jewels and their mapped elements, the Tier 1–2 components and flows Gate 3 lists as still missing values, and the cross-boundary pivots. It holds for the whole run. The `priority` scope of `/dethereal:enrich` (alias `tier1`) and a quick model's Step 8 enrich it only. See [Enrichment Order and the Priority Set](DISCOVERY_AND_ENRICHMENT.md#enrichment-order-and-the-priority-set).

**Backward Transition** — When structural changes (add/remove elements) at ENRICHING or REVIEWED revert the state to STRUCTURE_COMPLETE. Preserves enrichment on existing elements; flags new or changed elements as stale.

**Stale Element** — An element added or changed at ENRICHING or REVIEWED (including one reclassified during drift reconciliation) that hasn't been enriched since. Tracked in `state.json.staleElements[]` and prioritized during the next enrichment pass.

**Declined Field** — A field you left empty when asked. It stays empty (`null`), and the guided workflow's later enrichment runs in the same conversation do not ask it again; give its value at any time. A stand-in such as `unknown`, `TBD`, or `n/a` is not an answer: Gate 3 lists it as a placeholder.

**Session Break** — A checkpoint after Step 5 (data flow mapping) in a full run of the guided workflow; a quick run skips it. Recommends committing to git and optionally continuing enrichment in a fresh session (saves context budget for large models).

**Enrichment Relay** — The one turn of Step 8 in which the plugin presents what the enrichment agent wrote and could not answer, from the relay files in `.dethereal/relay/`, and asks you one question. The files hold all of it; the conversation may show a summary. See [One relay turn](GUIDED_WORKFLOW.md#one-relay-turn).

**Settlement** — A server feature, off by default, reserved, and not used by the guided workflow, that keeps a signed record of the values you registered and blocks REVIEWED and a push on values not registered. It is on only when `DETHEREAL_SETTLEMENT` is exactly `on`. Turning it on holds back REVIEWED and every push, because this version's workflow registers none of the values the operator confirms (only a pull registers what it pulled). See [The Settlement Switch](SYNC_AND_VERSION_CONTROL.md#the-settlement-switch).

---

## Discovery

**Discovery** — Automated scanning of a codebase to identify infrastructure components, trust boundaries, and data flows. Performed by the infrastructure-scout agent.

**Discovery Source** — One of 11 categories of files the scout checks: code structure, IaC, containers, Kubernetes, APIs, network config, CI/CD, database schemas, environment files, architecture diagrams, and documentation.

**Confidence** — Two-dimensional score for discovered elements: existence confidence (how certain the component exists) and classification confidence (how certain the class assignment is). Each dimension is high, medium, or low.

**Pre-Classification** — Deterministic class assignment during discovery using IaC mapping tables (e.g., `aws_rds_instance` maps to STORE/Database). Validated against the platform's class library.

**Blind-Spots Interview** — A consolidated post-discovery prompt asking about commonly missed elements: shared infrastructure, side-channel flows, deployment pipeline, SaaS integrations, human actors, and shared credentials.

**Discovery Cache** — A project-level file (`.dethernety/discovery-cache.json`) storing raw discovery results for reuse across multiple models in a decomposition plan.

---

## Security Concepts

**Credential Topology** — The mapping of which components share credentials, which flows require which credentials, and which stores hold credential material. Drives lateral movement analysis on the platform.

**Auth Failure Mode** — What happens when authentication fails on a data flow: `deny` (connection refused), `fallback` (weaker auth), `fail_open` (allows unauthenticated access); left empty when nobody knows. Flows that fail open are security-critical.

**Boundary Enforcement** — The traffic control posture of a trust boundary: `implicit_deny_enabled` (blocks by default), `allow_any_inbound` (unrestricted inbound), `egress_filtering` (outbound policy: deny_all, allow_list, allow_all). A field nobody knows stays empty.

**Monitoring Tools** — Which detection and response systems observe a component: SIEM, EDR, NDR, APM, cloud-native. Components without monitoring are SOC blind spots.

**Credential Blast Radius** — The set of components affected when a shared credential is compromised. Flagged in the attack surface analysis when the same credential appears on multiple cross-boundary flows.

**Exposure** — A platform-computed potential vulnerability specific to a model's structure and attributes. Exposures are read-only from the plugin's perspective — only the analysis engine creates them.

**Countermeasure** — A link between a security control and an exposure, indicating that the control addresses the identified threat. Without linking, the platform's defense coverage analysis cannot credit existing defenses.

---

## Controls and the Control Library

**Control** — A reusable security control (e.g., "Database Encryption Package", "SOC Monitoring") that one or more model elements can reference. Controls live in the platform's library and are mirrored locally as `controls/<id>.json`.

**ControlClass** — A platform-defined class of control (e.g., "Encryption at Rest", "Access Control"). A Control is an *instance* of one or more ControlClasses; per-(Control, Class) attribute payloads describe how the instance is configured.

**Greenfield Control** — A Control created locally that has no platform counterpart yet. Its `controls/<id>.json` file uses a temporary id of the form `greenfield-<suffix>`, which is also its file name; the next push creates the Control on the platform and rewrites the id in the file name and in every reference, protected by the WAL journal. (A `controls[]` entry with `id: null` is something else: a reference by name only, linked at push to the Control with exactly that name.)

**Brownfield Control** — A Control that already exists on the platform and was pulled into the local model. Edits to its attributes go through the shared-ownership safety check on push.

**`pendingEdit`** — A block on a brownfield Control's `classes[idx]` recording an in-flight attribute change. Created when the operator edits attributes; consumed by the next push. Its presence is what the shared-ownership prompt refers to as "your changes."

**`platformAttributes`** — The raw server-side attribute payload as of the last pull, stored alongside the editable `attributes` block on each `controls/<id>.json` class entry. The pair (`attributes` vs `platformAttributes`) is how the plugin detects local edits and shared-ownership conflicts.

**Two-Write Rule** — Every edit to a Control's `attributes` must (a) bump `localEditedAt` and (b) populate `pendingEdit`. The plugin enforces this via the `set-local-edited` MCP action — never edit `controls/<id>.json` by hand.

**Shared-Ownership Prompt** — When pushing edits to a brownfield Control assigned to multiple Models, the plugin shows the operator every co-owner Model and asks for a decision: for a single shared Control `(cancel / push-anyway)`; otherwise a review screen with per-row choices `cancel`, `push-anyway` (apply your edits to all sharing Models), and `push-unverified` (apply when the ownership query failed), plus per-key decisions for conflicting keys. To fork a shared Control, cancel it and create a separate Control with `/dethereal:enrich --focus controls`. See [Sync and Version Control](SYNC_AND_VERSION_CONTROL.md#shared-ownership-prompts).

**Force-Shared / Force-Unverified** — Audit-log entry shapes recording the operator's choice when they bypass the shared-ownership default. `force-shared` means "I knowingly mutated a multi-owner Control." `force-unverified` means "I mutated despite a failed ownership query."

**Control Audit Log** — `.dethereal/control-audit.log`. Append-only, line-oriented JSON. Records every shared-ownership decision with the platform login that made it (`authnOperator`; not your git email or local user name), decision verb, and the attribute keys involved. Records **no attribute values**: each value is replaced by a tag computed with a key that exists only on your machine, which tells "changed / same value" there and nothing anywhere else. **Stays on your machine** — gitignored, never committed. Entries written by earlier versions (no `schemaVersion`) may hold values verbatim. grep/jq friendly.

**External-Edit Guard** — A check that stops the control-library push when a local control file was changed outside the plugin: its `attributes` differ from its `platformAttributes` with no `pendingEdit` recording the change (a hand edit, or another tool writing the file). No Control is pushed until the change is promoted. Surfaces as `EXTERNAL_EDIT_DETECTED`; recovery via `promote-external-edit`.

**`promote-external-edit`** — Recovery verb (`/dethereal:sync promote-external-edit <controlId> <classId>`) that shows each diverging key (platform value → local value) and, once you confirm, records your **local** values as your edit in a `pendingEdit`, so the next push publishes them through the shared-ownership check. The local `attributes` are left untouched; nothing is re-pulled and nothing changes on the platform.

**WAL Journal** — `.dethereal/pending-id-rewrite.json`. Pre-write log capturing the planned greenfield ID rebind so a crash mid-push leaves no stranded files. Replayed automatically by the next control-library action.

**`repair-wal`** — Recovery verb (`/dethereal:sync repair-wal`) that shows a stranded WAL journal's contents and asks `(cancel / retry / clear)`: cancel keeps it, retry replays it, clear deletes it once you type `clear-journal`. Use when a command returns `WAL_REPLAY_FAILED`, or `WAL_JOURNAL_REJECTED` for a journal this machine did not write for this model — that journal is never replayed, so only cancel and clear are offered.

**Tombstone** — Lifecycle state for a Control that is left out of pushes. Set automatically when reconciliation finds the Control deleted on the platform, or manually via `/dethereal:sync tombstone <controlId>`, which does not delete the platform Control. A later pull brings a locally tombstoned Control back while the model still references it — remove the reference to retire it for good.

---

## Sync and Files

**Push** — Publishing a local model to the platform. The local version replaces the platform version entirely. First push creates a new platform model; subsequent pushes update the existing one.

**Pull** — Importing a platform model to local files for offline enrichment. Creates a working copy that can be edited and pushed back.

**Dual-Authority Model** — The principle that local files own model structure and the platform owns computed artifacts (exposures, analysis results). Each side is authoritative for its domain.

**Sync Metadata** — The `.dethereal/sync.json` file tracking platform model ID, last push/pull timestamps, content hashes, and baseline element IDs. This machine's own state: the server keeps it out of git through `.dethereal/.gitignore`.

**Decomposition Plan** — A strategy for breaking a complex system into multiple models. Tracked in `.dethernety/decomposition-plan.json` with model paths, statuses, and cross-model links.

**Cross-Model Reference** — A `representedModel` link on a component or boundary, pointing to another model that provides detailed coverage. Attack paths don't traverse these links — each model is analyzed independently.

---

## Metadata Directories

**`.dethernety/`** — Plugin-level metadata at the project root. Contains `models.json` (model registry), `discovery-cache.json` (cached discovery results), and `decomposition-plan.json` (multi-model plan).

**`.dethereal/`** — Per-model workflow metadata inside each model directory. Contains `state.json` (workflow state), `scope.json` (scope definition), `quality.json` (quality cache), `discovery.json` (discovery provenance), `sync.json` (sync metadata), `relay/` (the enrichment relay files, one per enrichment run), `settlement-baseline.json` and `settlements.json` (with the settlement on only: the values you registered on this machine, and their log), `control-audit.log` (control-decision ledger), `class-cache/` (cached class templates and guides), and `template-fields/` (per-element template field manifests, used on reclassification).

---

## Additional Terms

**Model Resolution Protocol** — The logic for determining which model a command operates on. If you have a single local model, it's used automatically. If you have multiple, the plugin prompts you to choose.

**Content Hash** — A hash of model file contents (excluding layout properties like position and dimensions) used to detect whether local changes exist since the last sync.

**Discovery Provenance** — Metadata tracking where each discovered component came from: which source file, which IaC resource, what confidence level. Stored in `.dethereal/discovery.json`.

**Decomposition Threshold** — Size limits that trigger a recommendation to split a model into multiple sub-models. Thresholds: 21+ components, 9+ boundaries, 36+ flows, 19+ cross-boundary flows. These reflect diminishing returns of modeling very large systems as monoliths.

**Post-Action Footer** — The standardized output format after any command that modifies model files: `[done]` with the model's state and quality score, `[next]` with recommended follow-up command.

**Adversary Class** — A scoping hint indicating which threat actor types to model: `external` (outside attackers), `insider` (malicious or compromised employees), `supply_chain` (compromised dependencies or build pipelines), and others you name. Asked during scope definition for every modeling intent; the classes you declare drive enrichment questions.

---

**Back to:** [Documentation Index](README.md)
