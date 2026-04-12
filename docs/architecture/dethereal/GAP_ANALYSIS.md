# Implementation Gap Analysis

> Detailed, actionable inventory of gaps between the designed architecture (CONTROL_INTEGRATION.md, CLASSIFICATION_ENHANCEMENT.md, BACKEND_DELEGATION.md) and the current implementation. Each gap identifies the source document, affected files, what exists today, what the design requires, and dependencies on other gaps.

**Audit date:** 2026-04-11
**Source documents:** CONTROL_INTEGRATION.md (CI), CLASSIFICATION_ENHANCEMENT.md (CE), BACKEND_DELEGATION.md (BD)

---

## Table of Contents

- [Schema and Backend Gaps](#schema-and-backend-gaps)
- [MCP Tool Gaps](#mcp-tool-gaps)
- [Data Layer Gaps](#data-layer-gaps)
- [Quality Score Gaps](#quality-score-gaps)
- [Skill Instruction Gaps](#skill-instruction-gaps)
- [Agent Instruction Gaps](#agent-instruction-gaps)
- [Documentation Gaps](#documentation-gaps)
- [Security Gaps](#security-gaps)
- [Dependency Graph](#dependency-graph)

---

## Schema and Backend Gaps

### G-01: `controlCandidatesForType` query missing

**Source:** CI Section 10 (P5d), CI Section 6.3 (Layer 1), CI Section 11

**Files:**
- `oss/apps/dt-ws/schema/schema.graphql` — GraphQL type definitions + query field with `@authentication`
- `oss/apps/dt-ws/src/gql/resolver-services/` — new custom resolver service (not `@cypher`)
- `oss/apps/dt-ws/src/gql/services/custom-resolver.module.ts` — register the new service
- `oss/packages/dt-core/src/dt-control/dt-control.ts` — new method wrapping the GraphQL call
- `oss/packages/dt-core/src/dt-control/dt-control-gql.ts` — GQL query definition

**Current state:** No `controlCandidatesForType` query exists.

**Required:** Add `controlCandidatesForType(elementTypes: [ComponentType!]!, moduleIds: [ID!])` query returning `[ControlCandidate!]!` with `ControlClassFit` sub-type. Full Cypher query and GraphQL types specified in CI Section 10 (P5d, lines 800-848).

**Implementation approach — custom resolver, not `@cypher`:** The original design specified `@cypher`, but investigation revealed two blockers:
1. `@cypher` directives cannot access request context (no JWT, no user info). When folder-based authorization lands (see [G-24 note](#g-24-folder-based-authorization--systemic-platform-gap)), `@cypher` queries cannot participate.
2. Memgraph compatibility: `$moduleIds IS NULL` fails on Memgraph. Requires `size($moduleIds) = 0` with empty-array convention.

Use the established custom resolver pattern (7 exist in `custom-resolver.module.ts`): implement a `ControlCandidatesResolverService` (~50-100 lines boilerplate), register it in `custom-resolver.module.ts`, add the query field to `schema.graphql` with `@authentication`.

**Memgraph compatibility fixes** for the Cypher:
- Replace `$moduleIds IS NULL` with `size($moduleIds) = 0`, caller passes `[]` instead of `null`
- Verify `cc.supportedTypes` is stored as a list property, not a JSON string (required for `ANY(et IN $elementTypes WHERE et IN cc.supportedTypes)` to work)
- `collect({key: value})` map literals and nested `WITH` chains work on Memgraph 2.x+

**Calling convention:** MCP tools never call GraphQL directly. Add a `controlCandidatesForType()` method to `DtControl` in dt-core, define the GQL query in `dt-control-gql.ts`. The MCP `rank` action (G-04) calls through dt-core.

**Depends on:** Nothing — standalone. See [G-24](#g-24-folder-based-authorization--systemic-platform-gap) for the systemic auth context (not a blocker — no existing query has folder scoping either).

**Blocks:** [G-04](#g-04-manage_controls-rank-action-missing) (MCP `rank` action calls this query via dt-core).

---

### G-02: `controlIdsByElements` — custom resolver candidate for `@cypher` simplification

**Source:** CI Section 11 (Layer 1)

**File:** `oss/apps/dt-ws/src/gql/resolver-services/control-gaps-resolver.service.ts`

**Current state:** Exists as a custom resolver with boilerplate (~60 lines). Functions correctly.

**Required:** Design recommends simplification to a `@cypher` directive to reduce maintenance. Not blocking — current implementation works.

**Depends on:** Nothing.

**Blocks:** Nothing — this is an optional simplification.

**Priority:** Low. Functional as-is.

---

### G-03: Type-compatible filtering in `get_control_gaps` Phase 3

**Source:** CI Section 6.6, CI Section 11 (Layer 2)

**File:** `oss/apps/dt-ws/src/gql/resolver-services/control-gaps-resolver.service.ts` (or the underlying Cypher in `get-control-gaps.tool.ts`)

**Current state:** `get_control_gaps` MCP tool exists and is fully implemented. However, it is unclear whether the Phase 3 recommended controls Cypher already filters by `ControlClass.supportedTypes` compatibility with the affected element types.

**Required:** Three enhancements to the existing resolver:

1. **Type-compatible filtering:** The recommended controls output must filter by `WHERE ANY(et IN $elementTypes WHERE et IN cc.supportedTypes)` so that database-tier controls are not recommended for API gateway elements. Without this filter, the surface skill recommends type-incompatible controls — in a guided workflow where users accept recommendations with limited security expertise, this leads to misconfigured SUPPORTS edges that generate inaccurate countermeasures (the "false confidence" problem from CI Section 6.3).

2. **Fourth coverage state — "assigned but unconfigured":** The current three-state model (addressable, unaddressable/module gap, no MITRE chain) has a gap: an exposure has a SUPPORTS edge (control assigned) but the control's attributes are misconfigured or incomplete, so no countermeasures are generated. `CoverageSummary` currently counts this as "mitigated" (SUPPORTS edge exists) — a false positive. Add `configuredCoverage` to `CoverageSummary`: count controls with at least one non-default attribute (countermeasure count > 0). The surface skill should distinguish "assigned and effective" from "assigned but unconfigured."

3. **Boundary-level SUPPORTS traversal:** CI Section 6.5 (line 477) requires the Cypher to match both direct `(Control)-[:SUPPORTS]->(Component)` and indirect `(Control)-[:SUPPORTS]->(Boundary)<-[:BELONGS_TO]-(Component)` paths. Without this, components protected by boundary-level controls (the recommended assignment pattern per CI Section 6.4) appear as unmitigated, generating false-positive gap recommendations. Also add `noMitreChain` count (exposures without ATT&CK technique links) so all fields sum to `totalExposures`.

**Depends on:** Nothing — enhancement to existing resolver.

**Blocks:** [G-11](#g-11-surface-skill-does-not-use-get_control_gaps-mcp-tool) (should ship before — without type filtering and boundary traversal, surface recommendations are noisy and incomplete).

**Priority:** Important — elevating from low because type-incompatible recommendations and missing boundary coverage produce false confidence, not just noise.

---

## MCP Tool Gaps

### G-04: `manage_controls` `rank` action missing

**Source:** CI Section 6.3, CI Section 10 (P5c), CI Section 11

**File:** `oss/apps/dethereal/src/tools/manage-controls.tool.ts`

**Current state:** Tool has actions: `list`, `get`, `create`, `update`, `delete`, `assign`. No `rank` action.

**Required:** Add `rank` action that:
1. Accepts `elementTypes: ComponentType[]`, element class ID/module (from local files), and `moduleIds` scope
2. Calls `controlCandidatesForType` schema query ([G-01](#g-01-controlcandidatesfortype-schema-query-missing))
3. Enriches results with local element context (`compatible`, `configured`, `sameDomain`, `alreadyAssigned`)
4. Scores using the deterministic formula: `score = compatible_and_configured / total - 1.0 * incompatible_and_configured / total`
5. Labels results as `strong` (>= 0.8, zero misconfigured), `good` (>= 0.5), or `weak` (< 0.5)
6. Returns top 5 candidates pre-ranked with relevance labels, class-level fit details, and countermeasure summaries

**Edge case:** Guard against `total_classes == 0` (orphaned control with no ControlClasses — data corruption or mid-creation state). Controls with zero classes should be skipped, not produce a division-by-zero error.

**Schema update:** The tool's input JSON Schema definition (in `manage-controls.tool.ts`) must be updated to add `rank` to the `action` enum and define `elementTypes: ComponentType[]` and `moduleIds: ID[]` as parameters for the `rank` action. This is a schema-level change in the tool registration, not just implementation logic.

**Calling convention:** MCP tools call backend through dt-core classes, never direct GraphQL. The `rank` action instantiates `DtControl(apolloClient)` and calls the `controlCandidatesForType()` method added in G-01. The scoring formula, local file enrichment, and label assignment all happen in the MCP tool code — not in dt-core or the backend.

**Depends on:** [G-01](#g-01-controlcandidatesfortype-query-missing) (needs the backend query + dt-core method to call).

**Blocks:** [G-09](#g-09-enrich-skill-controls-focus-mode-missing) (the `--focus controls` mode uses `rank` for brownfield control selection).

---

### G-05: `validate_model_json` quality score — `controlCoverageRate` hardcoded to 0

**Source:** CI Section 6.5, CI Section 10 (P2), CI Section 11

**File:** `oss/apps/dethereal/src/tools/validate-model.tool.ts` (line 272)

**Current state:** `const controlCoverageRate = 0` with note "Requires platform data — set to 0 when offline." No positive attribute mapping logic exists. The method already reads attribute files via `readAttributes()` (line 189) and model structure files (lines 186-188) — both data sources are available.

**Required:** Replace the hardcoded 0 with a two-tier local computation:

**Tier 1 — Attribute-inferred coverage:** Count classified elements with at least one positive security attribute using this mapping table:

| Attribute | Positive when |
|-----------|---------------|
| `encryption_in_transit` | Not `none`, `null`, absent, `SSLv3`, or `TLS 1.0` |
| `encryption_at_rest` | Not `none`, `null`, absent, `DES`, `3DES`, or `RC4` |
| `authentication_type` | Not `none`, `null`, absent; `basic` excluded when `encryption_in_transit` is absent/none/SSLv3/TLS 1.0 |
| `monitoring_tools` | Non-empty array |
| `implicit_deny_enabled` | `true` |

**Tier 2 — Formal control coverage (Phase 2+):** Count elements with non-empty `controls[]` array (directly or boundary-inherited). Walk the boundary tree — propagate `controls[]` from boundaries to children recursively.

Use the **maximum** of the two tiers per element. Metric: classified elements with at least one positive attribute OR control reference / total classified elements.

**Output labeling:** When the score is attribute-inferred only (no `controls[]` entries found), the quality output `note` field must say "Inferred from attributes; no formal controls assigned" — not the current "Requires platform." This prevents the score from being mistaken for compliance evidence. A model where every component has basic TLS would score high on control coverage despite having zero formal controls; the label makes the distinction visible.

**Attribute table extensibility:** The five attributes above are a starting set. Module-provided attribute schemas may surface additional positive signals (e.g., `authorization_model`, `rate_limiting_enabled`). The mapping table should be documented as extensible. Additionally, `digest` auth over cleartext should receive the same exclusion as `basic` — it is not meaningfully better from a credential-theft perspective.

**Depends on:** Nothing — the data is already loaded in `computeQuality`.

**Blocks:** [G-09](#g-09-enrich-skill-controls-focus-mode-missing) (P2 must ship before or concurrently with P4).

**Estimated scope:** ~60-100 lines + tests. The original "20-40 lines" estimate did not account for: (a) compound attribute conditions (e.g., `basic` + encryption interaction requires multi-field logic), (b) recursive boundary tree walk for inherited coverage with `controls[]` propagation, (c) `max(tier1, tier2)` per-element rule, (d) test suite updates. The existing `quality-score.test.ts` asserts `control_coverage_rate.value` equals 0 — it needs new cases for: flat model with attribute-inferred coverage, nested boundary inheritance, mixed attribute + formal coverage, the compound `basic` + encryption exclusion, and the max-of-two-tiers rule.

---

### G-06: `compute_control_coverage` hybrid MCP tool missing

**Source:** BD Section 4.3, CI Section 11

**File:** `oss/apps/dethereal/src/tools/validate-model.tool.ts` (extend existing tool)

**Current state:** No coverage computation action exists. `validate_model_json` has `validate` and `quality` actions but neither computes coverage breakdown.

**Required:** Add a `coverage` action (or extend `quality`) that returns:
- `inferred`: per-category coverage (auth, encryption_transit, encryption_rest, monitoring) with covered/total/pct
- `formal`: per-tier coverage (crown jewels, cross-boundary, internet-facing, internal) with gap element lists
- `source_breakdown`: discovered/declared/both counts

Hybrid execution: reads local attribute files (filesystem access in MCP server) + optionally queries dt-ws for SUPPORTS edge counts (GraphQL).

**Depends on:** [G-05](#g-05-validate_model_json-quality-score--controlcoveragerate-hardcoded-to-0) (shares the same attribute-reading logic and positive attribute mapping table).

**Blocks:** Nothing directly — reporting enhancement. Makes the `/dethereal:surface` skill output more accurate.

**Priority:** Medium. Can ship after G-05.

---

## Data Layer Gaps

### G-07: Update pipeline silently drops `controls[]`

**Source:** CI Section 3.1, CI Section 10 (P1), CI Section 12 (Gap 3)

**File:** `oss/packages/dt-core/src/dt-update/dt-update.ts` (lines 387-399, 463-468)

**Current state:** The update pipeline initializes `const controlIds: string[] = []` (line 390) and passes `controls: controlIds` to `updateModel` (line 397) — always empty. `updateComponent()`, `updateBoundary()`, and `updateDataFlow()` do not read `controls[]` from the incoming JSON data. Import/export round-trip is broken for controls.

The import pipeline (`DtImportSplit`) does work — `resolveControls()` resolves references and creates SUPPORTS edges. The gap is specifically in the update path.

**Required:** Process `controls[]` from incoming JSON in `updateComponent()`, `updateBoundary()`, and `updateDataFlow()`. Use disconnect/connect semantics on the update mutation — do NOT copy the import pipeline's `associateControlsDirectly` pattern (it sets `dataItems: []` as a side effect).

**Implementation details** (from backend investigation):
- `dt-component.ts` (lines 112-125) already supports controls in `updateComponent` via the disconnect/connect pattern: `disconnect: { where: { NOT: { OR: [...] } } }` + `connect: [mapped IDs]` (smart diff — only disconnects edges not in the new list)
- **Critical trap:** When `data.controls` is `undefined`, the mutation sends `disconnect: {}` with `connect: []` — this **wipes all existing controls**. The fix must only set `controls` on the mutation data when `data.controls !== undefined` (input JSON explicitly includes the field)
- When `data.controls` is `[]` (explicitly empty), it correctly disconnects all controls — this is the intended "remove all controls" behavior
- Resolve control references using the same `resolveControls()` chain from `dt-import.ts` (line 1271): match by (1) ID exact, (2) name exact, (3) name case-insensitive, (4) name partial. Cache the control list for the duration of an update batch to avoid redundant fetches

**Depends on:** Nothing — standalone dt-core fix.

**Blocks:** [G-15](#g-15-sync-skill--unresolved-control-warnings) (sync push with controls requires the update pipeline to process them). Also a **soft prerequisite for [G-09](#g-09-enrich-skill-controls-focus-mode-missing)**: without this fix, controls written during the `--focus controls` pass are silently dropped on the next sync push — the user sees quality score improvements locally, but the platform never receives the controls. This creates a dangerous false positive where the local model shows coverage that the platform analysis does not have.

**Priority:** Critical — elevating from "supporting" because without it the entire control integration workflow produces local-only artifacts that do not survive sync.

---

## Quality Score Gaps

(Covered by [G-05](#g-05-validate_model_json-quality-score--controlcoveragerate-hardcoded-to-0) above.)

---

## Skill Instruction Gaps

### G-08: Classify skill still uses per-module `get_classes` loop

**Source:** CE Section 4.1, CE Section 3

**File:** `oss/apps/dethereal/skills/classify/SKILL.md` (lines 48-53, 64, 118)

**Current state:** Pass 1 (Step 3, lines 48-53) calls `mcp__dethereal__get_classes(module_name: '<name>')` per active module. Quality gate broadening (Step 7, line 118) calls `get_classes` without module filter per unclassified element.

**Required:** Replace Pass 1 with batch `match_classes` calls, one per class label:
```
match_classes(
  elements: [{ name, type, description }],
  classLabel: COMPONENT | SECURITY_BOUNDARY | DATA_FLOW | DATA,
  moduleIds: [...activeModuleIds],
  topN: 3,
  fields: ['description', 'category', 'type']
)
```
- Auto-accept `exact_name` matches (high confidence)
- Present fuzzy/vector/type matches for confirmation
- Cross-module tiebreaking: prefer module listed earlier in `activeModules`
- Quality gate broadening: `match_classes` without `moduleIds` (one call, not per-element)
- Offline fallback: try `match_classes` → fall back to `get_classes` → skip Pass 1

Also update the confirmation table format to show `matchType` column (exact/fuzzy/vector/type) and `Module` column.

**Depends on:** Nothing — `match_classes` MCP tool already exists.

**Blocks:** [G-09](#g-09-enrich-skill-controls-focus-mode-missing) (C1 must ship before P4 — establishes `match_classes` in plugin vocabulary).

---

### G-09: Enrich skill `--focus controls` mode missing

**Source:** CI Section 6.2, CI Section 8, CI Section 10 (P4)

**File:** `oss/apps/dethereal/skills/enrich/SKILL.md`

**Current state:** Focus modes are: `credentials`, `monitoring`, `compliance` (lines 29-33). No `controls` focus mode.

**Required:** Add `controls` to the `--focus` enum. Define the 3-step control pass:

1. **Enforcement controls (Category 2)** — batched per boundary. If platform reachable, call `manage_controls(action: 'rank', elementTypes: [...], moduleIds: [...])` for pre-ranked candidates. If not, greenfield prompts (name-only references). Write control references to `structure.json` after each boundary (incremental persistence).
   - Zero-boundary models: single global enforcement prompt
   - B > 6: tiered prompts — crown-jewel boundaries first
2. **Detection controls (Category 3)** — one global prompt, pre-populated from `monitoring_tools`
3. **Governance placeholder (Category 4)** — single prompt, free-text to `scope.json`

Execution model: separate agent invocation with own 40-turn budget. The separate invocation is achieved by the calling context (threat-model skill or user) invoking `/dethereal:enrich --focus controls` as a fresh slash command, which creates a new agent instance (`agent: security-enricher`) with its own 40-turn budget. Session break offered between main enrichment and control pass.

**B > 6 launch gate:** CONTROL_INTEGRATION.md Section 8 (line 686) explicitly states "Gap 8 mitigation (tiered prompts for B>6) is required for Phase 2 launch, not a deferred enhancement." At B=8 brownfield without tiering, the pass consumes 28 turns for enforcement alone, leaving only 12 for everything else. The tiered prompt implementation (identify crown-jewel boundaries, collapse remaining, adjust turn budget) is non-trivial and must be included in G-09's acceptance criteria, not deferred.

**Hook interaction:** The PostToolUse hook (`post-write-validate.sh`, matcher: `Write|Edit`) fires on every model file write. With incremental persistence writing `structure.json` after each boundary, this triggers B additional hook invocations per pass. The current hook is lightweight (stdout reminder, exit 0, non-blocking) so this is acceptable, but if the hook is ever upgraded to run actual validation (`validate_model_json`), it would consume B additional turns. Note this interaction in the implementation.

**Instruction loading:** The `@docs/controls-enrichment.md` reference in SKILL.md loads on every enrich invocation, not conditionally — Claude Code does not support conditional `@` references. G-10 addresses this with a self-gating preamble in the instructions file. The 150-line file adds to context on all enrich invocations but is only acted upon when `--focus controls` is parsed. The `@docs/` reference is prompt injection (0 tool-call turns), not a tool call, so it does not affect the turn budget.

**Existing model migration:** First control pass on a pre-existing model (enriched before control integration) must work correctly. The detection controls pre-population from `monitoring_tools` depends on existing attribute files being present — which they are for pre-existing models. Re-run behavior (reading existing `controls[]` from files) handles subsequent runs.

**Depends on:** [G-10](#g-10-control-instructions-file-missing) (instructions file must exist), [G-04](#g-04-manage_controls-rank-action-missing) (brownfield ranking), [G-05](#g-05-validate_model_json-quality-score--controlcoveragerate-hardcoded-to-0) (quality score must count `controls[]`), [G-08](#g-08-classify-skill-still-uses-per-module-get_classes-loop) (establishes `match_classes` pattern). Soft dependency: [G-07](#g-07-update-pipeline-silently-drops-controls) (without it, controls do not survive sync — local-only value).

**Blocks:** [G-14](#g-14-threat-model-skill--no-control-pass-integration) (threat-model skill control pass integration).

---

### G-10: Control instructions file missing

**Source:** CI Section 10 (P5), CI Section 11

**File:** `oss/apps/dethereal/docs/controls-enrichment.md` (new file)

**Current state:** File does not exist.

**Required:** New file (~150 lines) with control assignment instructions loaded by the security-enricher when `--focus controls` is invoked via the enrich skill's `SKILL.md`. The file is referenced via `@docs/controls-enrichment.md` in the skill. Contains:
- Multi-class control evaluation rules
- Brownfield/greenfield sub-paths
- Control source tracking (`discovered` / `declared` / `both`)
- Batch table format templates
- Assignment level guidance (boundary vs. component vs. flow)
- Re-run behavior (including first control pass on pre-existing models)
- Error recovery (fall back to greenfield if `rank` fails)
- Self-gating preamble ("If `--focus controls` was not specified, ignore this file") — because `@docs/` references in a skill's SKILL.md are loaded on every invocation, not conditionally

**Depends on:** Nothing — standalone content authoring. Must complete before or concurrently with G-09.

**Blocks:** [G-09](#g-09-enrich-skill-controls-focus-mode-missing) (the enrich skill's `--focus controls` mode loads this file at invocation time — the file must exist first).

---

### G-11: Surface skill does not use `get_control_gaps` MCP tool

**Source:** CI Section 6.6, BD Section 4.2

**File:** `oss/apps/dethereal/skills/surface/SKILL.md` (Step 4, lines 74-93)

**Current state:** The surface skill reads local attribute files and checks for `controls` arrays to detect gaps. It does not call the `mcp__dethereal__get_control_gaps` tool. Post-analysis gap recommendations are based on local file inspection only, not the MITRE framework chain traversal.

**Required:** When the model is synced (has `manifest.model.id`), call `mcp__dethereal__get_control_gaps(model_id)` for framework-grounded gap analysis. Present:
- Unmitigated exposures partitioned into addressable and unaddressable (module gap)
- Ranked type-compatible candidate controls with D3FEND technique links
- Coverage summary (total/mitigated/unmitigated/unaddressable/coverage_pct)
- MITRE chain completeness: exposures with no ATT&CK chain noted separately

Fall back to local file inspection when model is not synced (current behavior).

**Depends on:** [G-03](#g-03-type-compatible-filtering-in-get_control_gaps-phase-3) (optional — tool works without type filtering, but recommendations are noisier).

**Blocks:** Nothing — enhancement to existing skill.

---

### G-12: Surface skill missing two-tier reporting

**Source:** CI Section 9, CI Section 6.7

**File:** `oss/apps/dethereal/skills/surface/SKILL.md`

**Current state:** Step 4 shows a single "Control Gaps" section listing components without controls, grouped by tier. No distinction between inferred coverage (attribute-derived) and formal coverage (SUPPORTS-derived).

**Required:** Split into two sections:
- **Inferred coverage** (attribute-derived): authentication, encryption in transit, encryption at rest, monitoring — with percentages and gap lists
- **Formal coverage** (SUPPORTS-derived): per-tier breakdown with controls assigned vs. total, gap elements

Also add control source breakdown (discovered/declared/both) when populated.

**Depends on:** [G-06](#g-06-compute_control_coverage-hybrid-mcp-tool-missing) (optional — the skill can compute locally, but the MCP tool makes it deterministic).

**Blocks:** Nothing.

---

### G-13: Threat-model skill — module selection sub-step exists, but missing `match_classes` integration

**Source:** CE Section 4.3

**File:** `oss/apps/dethereal/skills/threat-model/SKILL.md`

**Current state:** Module selection sub-step exists (line 118). Classification in the guided workflow uses whatever the classify skill uses — currently `get_classes` per module.

**Required:** Update the classification section of the guided workflow to reference `match_classes` calls instead of `get_classes` loop. Update the D51 note (token savings estimate). The guided workflow inherits the classify skill's behavior, so this is primarily a documentation alignment after [G-08](#g-08-classify-skill-still-uses-per-module-get_classes-loop) ships.

**Depends on:** [G-08](#g-08-classify-skill-still-uses-per-module-get_classes-loop).

**Blocks:** Nothing.

---

### G-14: Threat-model skill — no control pass integration

**Source:** CI Section 6.2, CI Section 8

**File:** `oss/apps/dethereal/skills/threat-model/SKILL.md`

**Current state:** The guided workflow's Step 8 (Enrichment) does not mention or offer a control pass. No session break between main enrichment and controls.

**Required:** After Step 8 (Enrichment) completes, offer the control pass:
```
Enrichment complete. Quality: 72/100.
Ready for control assignment (~6 prompts). Continue now or resume later?
  [continue] Run control pass now
  [later]    Resume with /dethereal:enrich --focus controls
```
If user chooses "continue", spawn the control pass as a new enricher invocation.

**Depends on:** [G-09](#g-09-enrich-skill-controls-focus-mode-missing) (the `--focus controls` mode must exist).

**Blocks:** Nothing.

---

### G-15: Sync skill — unresolved control warnings

**Source:** CI Section 10 (P6), CI Section 12 (Gap 1, Gap 2)

**File:** `oss/apps/dethereal/skills/sync/SKILL.md`

**Current state:** The sync skill does not mention controls. No warning for unresolved control references. No ID pinning after successful resolution.

**Required:**
1. **Post-push:** Surface warnings from `resolveControls()` — unresolved name-only references, failed matches
2. **ID pinning:** After first successful sync, write resolved platform IDs back to local JSON to pin references (prevents name-match flipping on re-sync — Gap 1 mitigation)
3. **Stale reference detection:** On push, compare local control IDs against platform inventory. Flag stale references: "Control 'ctrl-xyz' no longer exists on the platform. Remove from local model?"

**Depends on:** [G-07](#g-07-update-pipeline-silently-drops-controls) (update pipeline must process controls for sync to work).

**Blocks:** Nothing — but required for reliable control round-trips.

---

## Agent Instruction Gaps

### G-16: Security-enricher agent — classification still uses `get_classes` loop

**Source:** CE Section 4.2

**File:** `oss/apps/dethereal/agents/security-enricher.md` (lines 91-107)

**Current state:** Pass 1 (lines 91-97) calls `mcp__dethereal__get_classes(module_name)` per active module. Pass 2 broadening (line 106) calls `get_classes` without module filter.

**Required:** Update Classification Protocol:
- Pass 1: Replace per-module `get_classes` with `match_classes(elements: [...], classLabel: <label>, moduleIds: [...], topN: 3)`
- Auto-accept `exact_name` matches, present others for confirmation
- Pass 2 broadening: `match_classes` without `moduleIds`
- Offline fallback: try `match_classes` → `get_classes` → skip Pass 1

**Depends on:** [G-08](#g-08-classify-skill-still-uses-per-module-get_classes-loop) (align with classify skill changes).

**Blocks:** Nothing independently — but classification protocol should be consistent across skill and agent.

---

### G-17: Security-enricher agent — no `source` field handling

**Source:** CI Section 10 (P5b), CI Section 7 (Q4)

**File:** `oss/apps/dethereal/agents/security-enricher.md`

**Current state:** Agent does not set `source: "discovered" | "declared" | "both"` on ControlReference entries.

**Required:** When writing control references:
- Set `source: "declared"` for user-stated controls
- Set `source: "discovered"` for controls inferred from IaC/code attributes
- Set `source: "both"` when both discovered and declared

This field is load-bearing for analysis confidence (0.7x discount for declared-only) and compliance reporting (SOC2 Type I distinguishes implemented vs. planned).

**Depends on:** [G-10](#g-10-control-instructions-file-missing) (the instructions file should document source field semantics).

**Blocks:** Nothing.

---

## Documentation Gaps

### G-18: THREAT_MODELING_WORKFLOW.md — classification section outdated

**Source:** CE Section 4.3

**File:** `oss/docs/architecture/dethereal/THREAT_MODELING_WORKFLOW.md`

**Current state:** Section 4 (Component Classification) describes `get_classes(action: 'classify_components')` with per-module calls. D51 note has old token savings estimate.

**Required:** Update Section 4 to describe `match_classes` batch calls. Update D51 note with new savings estimate (1-5 tool calls instead of 15-100).

**Depends on:** [G-08](#g-08-classify-skill-still-uses-per-module-get_classes-loop) (content alignment).

**Blocks:** Nothing.

---

### G-19: PLUGIN_ARCHITECTURE.md — missing module selection and control integration sections

**Source:** CE Section 7 (cross-document dependency), CI Section 10

**File:** `oss/docs/architecture/dethereal/PLUGIN_ARCHITECTURE.md`

**Current state:** Does not document multi-module selection design or control integration architecture.

**Required:** Add sections covering:
- Module selection: `activeModules` semantics, source-pattern → module mapping, precedence rules, fallback broadening, late module addition protocol
- Control integration: `--focus controls` mode, three-layer ranking architecture, two-tier quality scoring

**Depends on:** [G-08](#g-08-classify-skill-still-uses-per-module-get_classes-loop), [G-09](#g-09-enrich-skill-controls-focus-mode-missing) (content must be implemented before documenting).

**Blocks:** Nothing.

---

### G-20: BACKEND_SERVICES_SPEC.md not created

**Status: Resolved** — existing documentation is sufficient.

**Source:** BACKEND_DELEGATION.md references it. README.md index lists `CLASS_AND_CONTROL_RESOLVER_SPEC.md` and `CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md` (both exist in `backend/LLD/`), but a standalone `BACKEND_SERVICES_SPEC.md` for the dethereal-specific backend delegation was discussed but not created.

**Resolution:** `BACKEND_DELEGATION.md` covers the plugin-perspective delegation strategy (which operations are MCP tools vs. agent orchestration). `CLASS_AND_CONTROL_RESOLVER_SPEC.md` and `CLASS_AND_CONTROL_RESOLVER_ARCHITECTURE.md` in `backend/LLD/` cover the backend service specifications (Cypher queries, resolver patterns, GraphQL schema design). Together these three documents fully cover the backend services architecture. A separate `BACKEND_SERVICES_SPEC.md` is not needed.

**Depends on:** Nothing.

**Blocks:** Nothing.

---

### G-21: THREAT_MODELING_WORKFLOW.md — `control_coverage_rate` definition

**Source:** CI Section 6.5 (cross-document note)

**File:** `oss/docs/architecture/dethereal/THREAT_MODELING_WORKFLOW.md` (Section 8)

**Current state:** Defines `control_coverage_rate` as "percentage of classified components that have at least one DTControlClass control assigned via the platform." This is the platform-side definition only.

**Required:** Update to reflect the two-tier approach: attribute-inferred coverage (offline) and formal coverage (after sync). Reference the positive attribute mapping table in CONTROL_INTEGRATION.md.

**Depends on:** [G-05](#g-05-validate_model_json-quality-score--controlcoveragerate-hardcoded-to-0) (implementation defines the exact semantics).

**Blocks:** Nothing.

---

### G-22: Infrastructure-scout — `recommendedModules` not in formal output schema

**Source:** Multi-module selection plan (Step 2)

**File:** `oss/apps/dethereal/agents/infrastructure-scout.md`

**Current state:** `recommendedModules: string[]` is mentioned in narrative (line 91: "populate `recommendedModules: string[]` at the top level of `discovery.json`") but not formally included in the discovery report JSON schema example block.

**Required:** Add `recommendedModules` to the formal schema definition/example in the discovery output section.

**Priority:** Low — the narrative instruction is sufficient for the agent to populate the field.

**Depends on:** Nothing.

**Blocks:** Nothing.

---

## Security Gaps

### G-23: Compensating control expiration — no enforcement mechanism

**Source:** CI Section 12 (Gap 9)

**File:** `oss/apps/dethereal/src/tools/validate-model.tool.ts` (quality score) and/or `oss/apps/dethereal/skills/surface/SKILL.md`

**Current state:** The design defines a `compensating.expires` field on ControlReference (CI Gap 9) with date, primary control, original requirement, and risk acceptance. No mechanism exists — in `validate_model_json`, in the surface skill, or in any hook — to warn when a compensating control has passed its expiration date.

**Required:** Either the quality score computation (G-05) or the surface skill (G-11/G-12) must flag expired compensating controls. A compensating control for PCI-DSS 6.3.3 with `"expires": "2026-06-30"` must surface a warning after that date. Without this, compensating controls become permanent fixtures in the threat model — the exact risk the design doc calls out (CI Gap 9: "Without this, compensating controls become permanent fixtures"). PCI-DSS v4.0 Appendix B and SOC2 CC6.1 require expiration tracking.

**Implementation options:**
- Add to `computeQuality` in `validate_model_json`: scan `controls[]` for `compensating.expires < now()`, include in quality output as a warning
- Add to the surface skill: surface expired compensating controls in the control gap section
- Both (belt and suspenders — quality score warns, surface skill explains)

**Depends on:** [G-05](#g-05-validate_model_json-quality-score--controlcoveragerate-hardcoded-to-0) (quality score reads `controls[]`).

**Blocks:** Nothing.

**Priority:** Important — compliance risk if unaddressed.

---

### G-24: Folder-based authorization — systemic platform gap

**Source:** Security architect review, confirmed by Cypher/Memgraph expert investigation

**Scope:** Platform-wide (`oss/apps/dt-ws/`), not specific to any single query

**Current state:** Investigation confirmed that **no existing query in the backend has folder-based authorization**:
- All 8 `@cypher` directives in `schema.graphql` operate without folder constraints
- `AuthorizationService.checkAuthorization()` always returns `{ allowed: true }` (line 54 of `authorization.service.ts`) — role/resource-based checks are labeled "future"
- `getNotRepresentingModels` matches `MATCH (m:Model)` globally (same pattern as the proposed query)
- The `controlGaps` resolver's Phase 3 (recommended controls) matches Controls globally without folder constraints
- No middleware, context-level filter, or Cypher injection layer restricts results by folder
- The `folderId` string does not appear anywhere in `oss/apps/dt-ws/src/gql/`

**What this means for the control integration gaps:**
- G-01 (`controlCandidatesForType`) does not need folder scoping as a blocker — it would be no worse than every other query in the system
- G-25 (`assignControlToElements` authorization) is also part of this systemic gap — dt-core is a pure data access layer with no permission checks
- Adding folder scoping solely to new queries would be inconsistent and give a false sense of security

**Required:** Track as a separate platform-level work item. When folder-based authorization is implemented, it should be applied system-wide — likely as `@authorization` directives with JWT claims filtering, or as a Cypher injection layer in the GraphQL context. The `controlCandidatesForType` query is implemented as a custom resolver (not `@cypher`) specifically so it can participate in folder-based auth when that infrastructure lands.

**Depends on:** Nothing.

**Blocks:** Nothing — this is a systemic platform concern, not a blocker for the control integration gaps.

**Priority:** Important (platform-level) — tracked here for visibility, but implementation scope is beyond the control integration work.

---

### G-25: `assignControlToElements` — missing authorization check

**Source:** Security architect review

**File:** `oss/packages/dt-core/src/dt-control/dt-control.ts` (line 394)

**Current state:** The `assignControlToElements` method (#137) creates SUPPORTS edges via `MERGE` semantics (idempotent). It does not verify that the caller owns both the Control and the target Model/Element. Any authenticated user can create SUPPORTS edges on any model's elements if they know the IDs.

**Systemic context:** This is part of the same platform-wide authorization gap as [G-24](#g-24-folder-based-authorization--systemic-platform-gap). dt-core is a pure data access layer with no permission checks — no dt-core method (`updateComponent`, `createControl`, etc.) enforces authorization. Auth is JWT-only at the `@authentication` schema level; `AuthorizationService.checkAuthorization()` is a pass-through. Adding authorization to this single method would be inconsistent with the rest of the codebase.

**Required:** Track alongside G-24 as a platform-level authorization concern. When role/resource-based authorization is implemented, this method should verify write access to the target model.

**Depends on:** [G-24](#g-24-folder-based-authorization--systemic-platform-gap) (same systemic fix).

**Blocks:** Nothing.

**Priority:** Important — tracked for visibility, scoped with G-24.

---

## Dependency Graph

```
Legend: ──→ "must ship before"    ···→ "should ship before (not blocking)"

SCHEMA / BACKEND
────────────────
G-01 (controlCandidatesForType — custom resolver)
  │    standalone, no prerequisites
  │
  └──→ G-04 (manage_controls rank action)
         │
         └──→ G-09 (enrich --focus controls)

G-03 (type-compatible gap filtering + boundary traversal) ──→ G-11 (surface uses get_control_gaps)

PLATFORM-LEVEL (tracked for visibility, not blocking control integration)
─────────────────────────────────────────────────────────────────────────
G-24 (folder-based authorization — systemic) — all queries affected, not specific to G-01
G-25 (assignControlToElements authorization) — scoped with G-24

MCP TOOLS
─────────
G-05 (quality score fix)
  │    standalone, no prerequisites
  │
  ├──→ G-09 (enrich --focus controls)  ← must ship before or concurrently
  │
  ├···→ G-06 (compute_control_coverage) ← shares attribute mapping logic
  │
  └···→ G-23 (compensating control expiration) ← reads controls[] from same data

DATA LAYER
──────────
G-07 (update pipeline controls[])
  │
  ├──→ G-15 (sync control warnings)
  │
  └···→ G-09 (enrich --focus controls)  ← controls do not survive sync without this

SKILL INSTRUCTIONS
──────────────────
G-08 (classify skill → match_classes)
  │    standalone, match_classes tool already exists
  │
  ├──→ G-09 (enrich --focus controls)  ← C1 → P4 critical path
  │
  ├──→ G-13 (threat-model match_classes alignment)
  │
  └──→ G-16 (enricher agent classification alignment)

G-10 (controls-enrichment.md) ──→ G-09 (enrich --focus controls)
     standalone content authoring       │
                                        ├──→ G-14 (threat-model control pass integration)
                                        │
                                        └──→ G-17 (enricher source field handling)

DOCUMENTATION (all low priority, after implementation)
──────────────────────────────────────────────────────
G-08 ──→ G-18 (THREAT_MODELING_WORKFLOW.md classification)
G-05 ──→ G-21 (THREAT_MODELING_WORKFLOW.md coverage definition)
G-08 + G-09 ──→ G-19 (PLUGIN_ARCHITECTURE.md sections)
```

### Critical Path

The longest dependency chain:

```
G-01 (custom resolver) → G-04 (rank action) ──┐
                                               ├──→ G-09 (--focus controls)
G-10 (instructions file) ─────────────────────┘        ↑
                                                       │
G-05 (quality score) ─────────────────────────────────┘
                                                       ↑
G-08 (classify → match_classes) ──────────────────────┘
```

**G-01**, **G-05**, **G-08**, and **G-10** are the four independent starting points. All must complete before **G-09** (the primary new UX) can ship. **G-07** (update pipeline) is a soft prerequisite — G-09 works without it but controls do not survive sync.

### Parallel work streams

| Stream | Gaps | Prerequisites |
|--------|------|---------------|
| **A: Classification migration** | G-08, G-16, G-13, G-18 | None — `match_classes` tool already exists |
| **B: Quality score** | G-05, G-23, G-21 | None — data already loaded in `computeQuality` |
| **C: Backend + ranking** | G-01, G-04 | None — new custom resolver + MCP action |
| **D: Data layer** | G-07, G-15 | None — standalone dt-core fix |
| **E: Control UX** | G-10, G-09, G-14, G-17 | A + B + C must complete; D should complete |
| **F: Surface enhancements** | G-03, G-11, G-12, G-06 | Code-independent of E, but value-dependent (reports are most useful after controls exist) |
| **Platform** | G-24, G-25 | Independent — systemic auth concern tracked separately |

Streams A, B, C, and D can run in parallel. Stream E requires A+B+C and should wait for D. Stream F is code-independent but delivers most value after E ships. Platform stream is tracked for visibility but is not blocking.

### Partial implementation states

Phased rollout will produce intermediate states. Key viable subsets:

| State | What works | What doesn't |
|-------|-----------|--------------|
| G-05 only | Quality score reflects attribute coverage (was stuck at 0) | Score labeled "inferred" — no formal controls |
| G-08 only | Classify uses `match_classes` (faster, better matches) | Enricher agent still uses `get_classes` (inconsistent entry points) |
| G-05 + G-08 | Quality + classification both improved | No control UX — user still can't assign controls |
| A+B+C done, D not done | Full control UX works locally | Controls silently dropped on sync push — local-only value |
| A+B+C+D done | End-to-end controls: assign, quality, sync | Surface skill still uses local gap detection (no MITRE chain) |
| All done | Full integration | — |

---

## Summary

| Category | Gap count | Critical | Important | Low/Optional |
|----------|-----------|----------|-----------|--------------|
| Schema / backend | 3 | G-01 | G-03 | G-02 |
| MCP tools | 3 | G-04, G-05 | — | G-06 |
| Data layer | 1 | G-07 | — | — |
| Skill instructions | 8 | G-08, G-09 | G-10 | G-11, G-12, G-13, G-14, G-15 |
| Agent instructions | 2 | — | — | G-16, G-17 |
| Documentation | 5 | — | — | G-18, G-19, G-20, G-21, G-22 |
| Security | 1 | — | G-23 | — |
| Platform (systemic) | 2 | — | G-24, G-25 | — |
| **Total** | **25** | **6 critical** | **5 important** | **14 supporting** |

The 6 critical gaps (G-01, G-04, G-05, G-07, G-08, G-09) form the minimum viable implementation. G-07 was elevated from "supporting" after expert review because controls do not survive sync without it (false positive risk). G-24 was **downgraded** from critical after investigation revealed it is a systemic platform-wide authorization gap — no existing query has folder scoping, so adding it to one query would be inconsistent and give a false sense of security. It is tracked as an important platform concern. The 5 important gaps (G-03, G-10, G-23, G-24, G-25) address false confidence, compliance, and authorization risks. The remaining 14 are supporting enhancements and documentation alignment.
