# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-06-08

A feature release centred on residual-risk reporting, the finding disposition
lifecycle, and a substantially expanded default module. Releases 0.1.1 through
0.2.1 were published as GitHub releases without changelog entries; this entry
resumes the changelog and compares against the previous tag, `v0.2.1`.

### Added

- **Threat Report module** — query-based residual-risk and disposition reporting:
  graded MITRE coverage matrix, flow-route reachability analysis, crown-jewel
  tile with killer-route cross-references, per-component profiles, posture
  summary, a structural boundary-crossing ledger with a faithful minimap,
  snapshot lifecycle with staleness detection, and JSON/HTML export.
- **coverage-tools module** — graded, element-scoped MITRE coverage primitive
  consumed by the Threat Report.
- **Finding disposition lifecycle** — pending / confirmed / disposed states with
  lifecycle badges, one-click affirm, and an affirm-edit dialog. The new
  **AFFIRMED** disposition keeps a finding live across the ledger, coverage
  metrics, and exports (ADR-010).
- **MITRE technique picker** for assigning ATT&CK techniques to findings.
- **MITRE verb edges** — countermeasure→technique verb relationships surfaced in
  GraphQL with allowlisted edge provenance and append-only justification
  durability.
- **Asset-context sync** — user-asserted threat-model context (crown jewels,
  data-item sensitivity and regulatory flags, compliance drivers) promoted to
  first-class platform fields and surfaced in the diagram editor and model dialog.
- **Data-item lifecycle association** — data items can be associated across the
  full element lifecycle.
- **Atomic class-change mutation** and a redesigned class-picker family backed by
  a `listClasses` query.
- **Cascade-delete orphan prevention** — atomic `deleteModel`, lifecycle hooks,
  and an admin orphan sweep.
- **dethernety-general** default module expanded to 75 component classes,
  including container and operating-system-host boundaries and file-based issue
  classes (replaces the former dethernety-module as the default).

### Changed

- `Exposure.score` and `Countermeasure.score` widened to `Float`.
- MITRE search aligned to the Memgraph tier with an updated default embedding
  model.

### Fixed

- `createAnalysis` null-return and Memgraph constraint fallback.
- `elementsWithExtendedInfo` model resolution bounded to prevent a Memgraph
  timeout on large models.
- Numerous dt-ui disposition and exposure UX corrections, including readable
  control-dialog theming, terse pending badges that fit the tab rail, and a
  dirty-guard on the control editor.

## [0.2.1] - 2026-04-22

Two-commit follow-up to v0.2.0. One architectural simplification in Dethereal's
enrichment flow, one TypeScript strict-mode cleanup. No breaking changes.

### Dethereal

- **MITRE tactic coverage now platform-derived.** `/dethereal:surface` §5 now
  aggregates `Exposure.exploitedBy` across analysed elements instead of reading a
  hand-maintained `mitre_attack_techniques` field on component attributes. The
  security-enricher agent's 3-step MITRE anti-hallucination protocol
  (`search_mitre_attack` → validate → persist) is removed — the platform graph is
  now the single source of truth for technique mappings. Module policies already
  declare `exploited_by: [T...]` on every exposure; removing the duplicate
  client-side list eliminates a two-source-of-truth drift risk. Escape hatch for
  uncovered techniques is a module policy addition, not a hand annotation. See
  `BACKEND_DELEGATION.md` §3 for rationale. (#106)
- **TypeScript strict-mode fixes in three tools.** `generate-attribute-stubs`,
  `manage-controls`, and `validate-model` now pass `noUncheckedIndexedAccess`
  cleanly — replaces ad-hoc structural parameter types with dt-core types,
  narrows `apolloClient` once at the action-dispatch site, and adds a JWT
  payload-segment guard. No behaviour change. (#109)

## [0.2.0] - 2026-04-20

This release introduces **Dethereal**, a Claude Code plugin that brings
AI-assisted threat modeling and DevSecOps shift-left into the developer's editor,
plus a per-Control library with crash-safe write-ahead logging and
shared-ownership safety. It also lands the **file-based v2 module architecture**,
**pre-computed class embeddings** for offline install, a CVSS v3.1-aligned
**`AttackVector`** field on Exposures, and a **chunked archive upload** transport
for multi-megabyte module imports.

### Dethereal Plugin (new)

A Claude Code plugin for AI-assisted threat modeling against the Dethernety
platform.

- **14 slash commands**, **4 specialized AI agents**, **22 MCP tools**,
  **11-step guided workflow** (#65, #97)
- **Class matching, control gap analysis, embedding pipeline** (#84)
- **Multi-module selection** in the classification workflow (#82)
- **Control integration** — classification, coverage analysis, two-tier
  reporting (#88)
- Full user docs: getting started, guided workflow, glossary, command reference,
  sync & version control, model concepts, agents & architecture

### Control Library (new)

Per-Control file mirror (`controls/<id>.json`) with platform sync, crash-safe
greenfield ID rebinding, and append-only audit log (#104).

- **Two-Write Rule** — every Control change writes to both the per-Control file
  and the platform; the audit log captures every decision
- **WAL-protected ID rebinding** — atomic rename of `greenfield-*` → server UUID
  survives mid-write crashes
- **Shared-ownership safety prompts** on push when a Control is referenced by
  multiple model elements
- **Recovery verbs**: `repair-wal`, `promote-external-edit`, `tombstone`,
  `merge-from-file`
- **Path-traversal hardening** — `validatePathConfinement`, `assertSafeRelPath`,
  `assertSafeControlId` defence-in-depth at every boundary
- **Coarse model-dir lock** with PID-aware stale-lock recovery serialises
  concurrent `manage_controls` invocations

### Modules — File-Based v2 Architecture

- **File-based v2 modules** — module manifest, classes, exposures, countermeasures
  live as files; loader unifies install paths (#85, #91)
- **Module custom resolvers** — DTModules can register GraphQL resolver functions;
  module workspace receives structured interrupts (#67, #61)
- **Module schema extensions, SSE auth, analysis flow navigation** (#58)
- **Pre-computed class embeddings** ship with the catalog for offline install —
  no embed-on-install latency (#97)
- **`AttackVector` on Exposure** (CVSS v3.1-aligned: `network` / `adjacent` /
  `local` / `physical`); backfilled across the dethernety-module catalog
  (#89, #90)

### Platform — Chunked Archive Upload

- **Chunked archive upload backend** on the GraphQL API — `UploadSessionManager`
  (in-memory per-user session, 5-min TTL, sweeper) + reusable `importFromTarball`
  helper enables multi-megabyte module imports without raising the platform
  body-parser limit. Includes a `module-manager.sh export` subcommand to produce
  importable tarballs, plus `value_type` backfill on 32 guide entries (#99)

### Demo & Build

- Demo: clean up straggler containers and surface real MITRE ingest build
  errors (#98)

### Security & Dependencies

- Resolve `@apollo/federation-internals` prototype pollution (#80)
- Resolve remaining transitive dependency vulnerabilities (#75, #77, #78)
- Tighten `ajv` overrides; bump 33 dependencies (#74)
- Bump `hono` override to ≥4.12.7 (prototype pollution fix) (#55)
- Remove dead `apollo-server-express` (#75)
- `noauth` gate in module resolver wrapper; pass `configurable` to LangGraph (#72)
- Routine dependency sync — 2026-04-16 (#101)
- Bump safe minor/patch dependencies (#79)

## [0.1.0] - 2026-02-27

### Added

- **dt-ui**: Interactive threat modeling frontend with Vue 3, Vuetify, and Vue Flow
- **dt-ws**: NestJS backend with GraphQL API and graph database integration
- **dethereal**: Supplementary application
- **dt-core**: Shared TypeScript data access layer and core interfaces
- **dt-module**: Base classes and utilities for the extensible module system
- **dethernety-general**: Default threat modeling module with component classes, controls, and exposures
- **mitre-frameworks**: MITRE ATT&CK and D3FEND framework data and ingestion tooling
- **demo**: Docker Compose environment for quick local evaluation
- **Dockerfile.production**: Production-ready container image
- MITRE ATT&CK technique and mitigation mapping
- MITRE D3FEND defensive technique integration
- Drag-and-drop data flow diagram editor
- Security boundary and trust level modeling
- Exposure detection and risk scoring
- Control and countermeasure management
- Module-based extensibility system
- GraphQL API with real-time subscriptions
- OIDC/JWT authentication support

[Unreleased]: https://github.com/dether-net/dethernety-oss/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/dether-net/dethernety-oss/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/dether-net/dethernety-oss/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/dether-net/dethernety-oss/compare/v0.1.3...v0.2.0
[0.1.0]: https://github.com/dether-net/dethernety-oss/releases/tag/v0.1.0
