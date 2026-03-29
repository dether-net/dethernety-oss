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

**Agent** — A specialized AI persona with specific tools, behaviors, and constraints. Dethereal has 4 agents: threat-modeler, infrastructure-scout, security-enricher, and model-reviewer.

**Command** (also called **Skill** internally) — A slash command (`/dethereal:<name>`) that performs a specific modeling workflow step. Commands invoke agents and use MCP tools. Dethereal has 14 commands. See [Command Reference](COMMAND_REFERENCE.md).

**Hook** — A lifecycle event handler that runs automatically at specific moments (session start, after file edits, before context compaction).

**MCP Tool** — A function exposed by the MCP (Model Context Protocol) server for platform communication. 20 tools handle authentication, model CRUD, MITRE queries, security elements, and attribute stub generation.

**MCP Server** — The TypeScript server (`@dether.net/dethereal`) that implements the Model Context Protocol, exposing platform capabilities as tools that AI agents can use.

---

## Model Structure

**Component** — A building block of the threat model. Three types: PROCESS (running software), STORE (data persistence), EXTERNAL_ENTITY (outside your control).

**Trust Boundary** — A security zone in your architecture where the rules change. Boundaries form a hierarchy representing network segments, access control zones, or deployment environments.

**Data Flow** — A directed connection between two components, representing communication. Cross-boundary flows are high-priority for security analysis.

**Data Item** — A classification of what data a flow carries, with sensitivity level and regulatory labels.

**Class** — A predefined type from the platform's module system (e.g., "Database", "Web Application", "Load Balancer"). Classification assigns a class to an element, enabling attribute schemas and analysis.

**Attribute** — A security property of an element, stored in `attributes/<type>/<id>.json`. The 6 key component attributes are: authentication, encryption in transit, encryption at rest, logging, access control, and log telemetry.

**Split-File Format** — The directory structure for threat models: separate JSON files for manifest, structure, dataflows, data-items, and per-element attributes.

---

## Workflow and State

**State** — The current maturity level of a model. 6 states: INITIALIZED, SCOPE_DEFINED, DISCOVERED, STRUCTURE_COMPLETE, ENRICHING, REVIEWED.

**Quality Score** — A 0-100 score measuring model completeness (not system security). Computed from 7 weighted factors. Labels: Starting (0-39), In Progress (40-69), Good (70-89), Comprehensive (90-100).

**Quality Gate** — A progressive checkpoint with pass/fail criteria. Gate 1 (creation, advisory), Gate 2 (sync, blocking), Gate 3 (analysis, blocking).

**Scope** — The definition of what the model covers: system name, crown jewels, compliance drivers, exclusions, trust assumptions. Stored in `.dethereal/scope.json`.

**Crown Jewel** — The most valuable asset in the system — what an attacker would target. Named in scope, matched to components during classification, and enriched with highest priority (Tier 1).

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

**`.dethereal/`** — Per-model workflow metadata inside each model directory. Contains `state.json` (workflow state), `scope.json` (scope definition), `quality.json` (quality cache), `discovery.json` (discovery provenance), `sync.json` (sync metadata), `class-cache/` (cached class templates and guides), and `template-fields/` (template field manifests for reclassification).

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
