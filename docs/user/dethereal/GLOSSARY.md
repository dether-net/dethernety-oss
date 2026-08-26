---
title: 'Dethereal Glossary'
description: 'Definitions for Dethereal-specific terminology'
category: 'documentation'
position: 10
navigation: true
tags: ['dethereal', 'glossary', 'terminology', 'reference']
---

# Dethereal Glossary

Plugin-specific terminology. For platform-wide terms, see the [Dethernety Glossary](../../GLOSSARY.md).

---

## Plugin Concepts

**Agent** — A specialized AI persona with specific tools, behaviors, and constraints. Dethereal has 5 agents: threat-modeler, infrastructure-scout, infrastructure-scout-scoped, security-enricher, and model-reviewer. See [Agents, Tools, and Hooks](AGENTS_AND_ARCHITECTURE.md#the-5-ai-agents).

**Command** (also called **Skill** internally) — A slash command (`/dethereal:<name>`) that performs a specific modeling workflow step. Commands invoke agents and use MCP tools. Dethereal has 14 commands. See [Command Reference](COMMAND_REFERENCE.md).

**Hook** — A lifecycle event handler that runs automatically at specific moments (session start, after file edits, before context compaction).

**MCP Tool** — A function exposed by the MCP (Model Context Protocol) server for platform communication. 22 tools handle authentication, model CRUD, MITRE queries, security elements, classification, control-gap analysis, and attribute stub generation.

**MCP Server** — The TypeScript server (`@dether.net/dethereal`) that implements the Model Context Protocol, exposing platform capabilities as tools that AI agents can use.

---

## Model Structure

**Component** — A building block of the threat model. Three types: PROCESS (running software), STORE (data persistence), EXTERNAL_ENTITY (outside your control).

**Trust Boundary** — A security zone in your architecture where the rules change. Boundaries form a hierarchy representing network segments, access control zones, or deployment environments.

**Data Flow** — A directed connection between two components, representing communication. Cross-boundary flows are high-priority for security analysis.

**Data Item** — A classification of what data a flow carries, with sensitivity level and regulatory labels.

**Sensitivity** — A data item's author-asserted confidentiality classification on a four-level scale, lowest to highest: `public`, `internal`, `confidential`, `restricted`. Absent ⇒ unclassified (which is *not* the same as `public`).

**Regulatory Flags** — Free-text compliance labels on a data item (e.g. `PCI cardholder`, `PHI`, `GDPR personal`), kept separate from sensitivity. Matched exactly and case-sensitively by the platform's `dataInRegulatoryScope` query; see the [canonical vocabulary](../../architecture/dethereal/THREAT_MODELING_WORKFLOW.md#canonical-sensitivity-and-regulatory-flag-vocabulary) for the recommended set and casing.

**Class** — A predefined type from the platform's module system (e.g., "Database", "Web Application", "Load Balancer"). Classification assigns a class to an element, enabling attribute schemas and analysis.

**Attribute** — A security property of an element, stored in `attributes/<type>/<id>.json`. The 6 key component attributes are: authentication, encryption in transit, encryption at rest, logging, access control, and log telemetry.

**Split-File Format** — The directory structure for threat models: separate JSON files for manifest, structure, dataflows, data-items, and per-element attributes.

---

## Trust Zoning and Conduits

Zoning records the *declared design intent* of your segmentation — which trust tier each boundary sits on and which boundaries are meant to talk. The plugin stores it on each boundary in `structure.json` (`zone`, `planes`, `domains`, `conduits`) and round-trips it to the platform. For the full how-to (setting zones in the GUI, inheritance, the Zoning overview), see the platform guide [Boundary Trust Zones](../BOUNDARY_TRUST_ZONES.md).

**Trust Zone** — The exposure tier a boundary sits on: *who can reach it*. Stored as the `zone` field on each boundary. Six values on an exposure gradient (plus an off-gradient external tier). A boundary with no zone **inherits** one (see *Zone Inheritance*).

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

**Scope** — The definition of what the model covers: system name, depth, modeling intent, crown jewels, compliance drivers, exclusions, trust assumptions. Stored in `.dethereal/scope.json`. The platform-synced fields (depth, modeling intent, compliance drivers, exclusions, trust assumptions) round-trip to the Model node; the rest stay local.

**Crown Jewel** — The most valuable asset in the system — what an attacker would target. Named in scope, matched to **components** during classification (synced as the `Component.crownJewel` field), and enriched with highest priority (Tier 1).

**Enrichment Tier** — Priority grouping for enrichment order. Tier 1 (crown jewels), Tier 2 (cross-boundary), Tier 3 (internet-facing), Tier 4 (internal). Each component appears in its highest-priority tier only.

**Backward Transition** — When structural changes (add/remove elements) at ENRICHING or REVIEWED revert the state to STRUCTURE_COMPLETE. Preserves enrichment on existing elements; flags new elements as stale.

**Stale Element** — An element added during ENRICHING that hasn't been enriched yet. Tracked in `state.json.staleElements[]` and prioritized during the next enrichment pass.

**Session Break** — A checkpoint after Step 5 (data flow mapping) in the guided workflow. Recommends committing to git and optionally continuing enrichment in a fresh session (saves context budget for large models).

---

## Discovery

**Discovery** — Automated scanning of a codebase to identify infrastructure components, trust boundaries, and data flows. Performed by the infrastructure-scout agent.

**Discovery Source** — One of 10 categories of files the scout checks: code structure, IaC, containers, Kubernetes, APIs, network config, CI/CD, database schemas, environment files, and documentation.

**Confidence** — Two-dimensional score for discovered elements: existence confidence (how certain the component exists) and classification confidence (how certain the class assignment is). Each dimension is high, medium, or low.

**Pre-Classification** — Deterministic class assignment during discovery using IaC mapping tables (e.g., `aws_rds_instance` maps to STORE/Database). Validated against the platform's class library.

**Blind-Spots Interview** — A consolidated post-discovery prompt asking about commonly missed elements: shared infrastructure, side-channel flows, deployment pipeline, SaaS integrations, human actors, and shared credentials.

**Discovery Cache** — A project-level file (`.dethernety/discovery-cache.json`) storing raw discovery results for reuse across multiple models in a decomposition plan.

---

## Security Concepts

**Credential Topology** — The mapping of which components share credentials, which flows require which credentials, and which stores hold credential material. Drives lateral movement analysis on the platform.

**Auth Failure Mode** — What happens when authentication fails on a data flow: `deny` (connection refused), `fallback` (weaker auth), `fail_open` (allows unauthenticated access), `unknown`. Flows that fail open are security-critical.

**Boundary Enforcement** — The traffic control posture of a trust boundary: `implicit_deny_enabled` (blocks by default), `allow_any_inbound` (unrestricted inbound), `egress_filtering` (outbound policy: deny_all, allow_list, allow_all, unknown).

**Monitoring Tools** — Which detection and response systems observe a component: SIEM, EDR, NDR, APM, cloud-native. Components without monitoring are SOC blind spots.

**Credential Blast Radius** — The set of components affected when a shared credential is compromised. Flagged in the attack surface analysis when the same credential appears on multiple cross-boundary flows.

**Exposure** — A platform-computed potential vulnerability specific to a model's structure and attributes. Exposures are read-only from the plugin's perspective — only the analysis engine creates them.

**Countermeasure** — A link between a security control and an exposure, indicating that the control addresses the identified threat. Without linking, the platform's defense coverage analysis cannot credit existing defenses.

---

## Controls and the Control Library

**Control** — A reusable security control (e.g., "Database Encryption Package", "SOC Monitoring") that one or more model elements can reference. Controls live in the platform's library and are mirrored locally as `controls/<id>.json`.

**ControlClass** — A platform-defined class of control (e.g., "Encryption at Rest", "Access Control"). A Control is an *instance* of one or more ControlClasses; per-(Control, Class) attribute payloads describe how the instance is configured.

**Greenfield Control** — A Control created locally that has no platform counterpart yet. Its `controls/<id>.json` file uses a temporary `id` (or `id: null`); the first push asks the platform for a UUID and the plugin atomically rebinds every reference.

**Brownfield Control** — A Control that already exists on the platform and was pulled into the local model. Edits to its attributes go through the shared-ownership safety check on push.

**`pendingEdit`** — A block on a brownfield Control's `classes[idx]` recording an in-flight attribute change. Created when the operator edits attributes; consumed by the next push. Its presence is what the shared-ownership prompt refers to as "your changes."

**`platformAttributes`** — The raw server-side attribute payload as of the last pull, stored alongside the editable `attributes` block on each `controls/<id>.json` class entry. The pair (`attributes` vs `platformAttributes`) is how the plugin detects local edits and shared-ownership conflicts.

**Two-Write Rule** — Every edit to a Control's `attributes` must (a) bump `localEditedAt` and (b) populate `pendingEdit`. The plugin enforces this via the `set-local-edited` MCP action — never edit `controls/<id>.json` by hand.

**Shared-Ownership Prompt** — When pushing a brownfield Control assigned to multiple Models, the plugin shows the operator the list of co-owner Models and offers per-row choices: `cancel`, `push-anyway` (apply your edits to all sharing Models), `push-unverified` (apply when the ownership query failed), `clone-and-swap` (V1.1 — fork into a new Control). See [Sync and Version Control](SYNC_AND_VERSION_CONTROL.md#shared-ownership-prompts).

**Force-Shared / Force-Unverified** — Audit-log entry shapes recording the operator's choice when they bypass the shared-ownership default. `force-shared` means "I knowingly mutated a multi-owner Control." `force-unverified` means "I mutated despite a failed ownership query."

**Control Audit Log** — `.dethereal/control-audit.log`. Append-only, line-oriented JSON. Records every shared-ownership decision with operator identity, decision verb, and prior `platformAttributes`. **Committed to git** so PR review can see who decided what; grep/jq friendly.

**External-Edit Guard** — A check on push that aborts if the platform's current `platformAttributes` differ from the snapshot taken at the start of your edit. Surfaces as `EXTERNAL_EDIT_DETECTED`; recovery via `promote-external-edit`.

**`promote-external-edit`** — Recovery verb (`/dethereal:sync promote-external-edit <controlId> <classId>`) that promotes the platform's current state into your local `pendingEdit`, treating the external change as legitimate operator intent. After this, the next push runs the shared-ownership check against your effective state.

**WAL Journal** — `.dethereal/pending-id-rewrite.json`. Pre-write log capturing the planned greenfield ID rebind so a crash mid-push leaves no stranded files. Replayed automatically on every skill entry.

**`repair-wal`** — Recovery verb (`/dethereal:sync repair-wal`) that surfaces a stranded WAL journal's contents and walks the operator through delete-journal / retry-replay / manual-rename. Use when any push/pull/status returns `WAL_REPLAY_FAILED`.

**Tombstone** — Lifecycle state for a Control that should not be re-pulled (deleted on the platform, or operator-retired locally). Set automatically when reconciliation detects platform deletion, or manually via `/dethereal:sync tombstone <controlId>`.

---

## Sync and Files

**Push** — Publishing a local model to the platform. The local version replaces the platform version entirely. First push creates a new platform model; subsequent pushes update the existing one.

**Pull** — Importing a platform model to local files for offline enrichment. Creates a working copy that can be edited and pushed back.

**Dual-Authority Model** — The principle that local files own model structure and the platform owns computed artifacts (exposures, analysis results). Each side is authoritative for its domain.

**Sync Metadata** — The `.dethereal/sync.json` file tracking platform model ID, last push/pull timestamps, content hashes, and baseline element IDs. Should be gitignored (per-user state).

**Decomposition Plan** — A strategy for breaking a complex system into multiple models. Tracked in `.dethernety/decomposition-plan.json` with model paths, statuses, and cross-model links.

**Cross-Model Reference** — A `representedModel` link on a component or boundary, pointing to another model that provides detailed coverage. Attack paths don't traverse these links — each model is analyzed independently.

---

## Metadata Directories

**`.dethernety/`** — Plugin-level metadata at the project root. Contains `models.json` (model registry), `discovery-cache.json` (cached discovery results), and `decomposition-plan.json` (multi-model plan).

**`.dethereal/`** — Per-model workflow metadata inside each model directory. Contains `state.json` (workflow state), `scope.json` (scope definition), `quality.json` (quality cache), `discovery.json` (discovery provenance), `sync.json` (sync metadata), `control-audit.log` (control-decision ledger), `class-cache/` (cached class templates and guides), and `template-fields/` (per-element template field manifests, used on reclassification).

---

## Additional Terms

**Model Resolution Protocol** — The logic for determining which model a command operates on. If you have a single local model, it's used automatically. If you have multiple, the plugin prompts you to choose.

**Content Hash** — A hash of model file contents (excluding layout properties like position and dimensions) used to detect whether local changes exist since the last sync.

**Discovery Provenance** — Metadata tracking where each discovered component came from: which source file, which IaC resource, what confidence level. Stored in `.dethereal/discovery.json`.

**Decomposition Threshold** — Size limits that trigger a recommendation to split a model into multiple sub-models. Thresholds: 21+ components, 9+ boundaries, 36+ flows, 19+ cross-boundary flows. These reflect diminishing returns of modeling very large systems as monoliths.

**Post-Action Footer** — The standardized output format after any command that modifies model files: `[done]` with quality score, `[next]` with recommended follow-up command.

**Adversary Class** — A scoping hint indicating which threat actor types to model: `external` (outside attackers), `insider` (malicious or compromised employees), `supply_chain` (compromised dependencies or build pipelines). Prompted during scope definition for `security_review` and `incident_response` intents.

---

**Back to:** [Documentation Index](README.md)
