# Control Integration & Classification Enhancement — Sprint Plan

> Implementation plan for the gaps identified in [GAP_ANALYSIS.md](GAP_ANALYSIS.md), covering the control integration (CONTROL_INTEGRATION.md), classification enhancement (CLASSIFICATION_ENHANCEMENT.md), and related backend/data layer fixes. Six sprints, ordered by dependency graph. Sprints 1-4 can run in parallel.

**Source documents:**
- [GAP_ANALYSIS.md](GAP_ANALYSIS.md) — 25 implementation gaps with dependencies
- [CONTROL_INTEGRATION.md](CONTROL_INTEGRATION.md) (CI) — Control integration design
- [CLASSIFICATION_ENHANCEMENT.md](CLASSIFICATION_ENHANCEMENT.md) (CE) — Classification workflow migration
- [BACKEND_DELEGATION.md](BACKEND_DELEGATION.md) (BD) — Backend delegation strategy
- [SPRINT_PLAN.md](SPRINT_PLAN.md) — Backend services sprint plan (predecessor, Sprints 1-5 completed)

## Dependency Graph

```
Sprint 1 (A) ──→ Sprint 5 (E)
                    ↑
Sprint 2 (B) ──────┘
                    ↑
Sprint 3 (C) ──────┘
                    ↑
Sprint 4 (D) ·····→┘  (soft — controls don't survive sync without D)

Sprint 5 (E) ──→ Sprint 6 (F)
```

Sprints 1-4 are independent and can run in parallel. Sprint 5 requires 1+2+3 and should wait for 4. Sprint 6 follows Sprint 5.

---

## Sprint 1 — Classification Migration (Stream A)

**Gaps:** G-08, G-16
**Parallel with:** Sprints 2, 3, 4
**Prerequisites:** `match_classes` MCP tool already implemented (#140)

### User Stories

**S1.1 — Classify skill uses `match_classes` for Pass 1**

As a Dethereal user, I want the `/dethereal:classify` skill to use batch `match_classes` calls instead of per-module `get_classes` loops, so that classification is faster (1-5 tool calls instead of 15-100) and the agent spends its turn budget on reasoning, not data retrieval.

- Replace Pass 1 (Step 3, lines 48-53 of `skills/classify/SKILL.md`) with batch `match_classes` calls, one per class label
- Add cross-module tiebreaking: prefer module listed earlier in `activeModules` from `scope.json`
- Update quality gate broadening (Step 7, line 118): `match_classes` without `moduleIds` instead of per-element `get_classes`
- Add offline fallback chain: try `match_classes` → fall back to `get_classes` → skip Pass 1
- Update confirmation table to show `matchType` (exact/fuzzy/vector/type) and `Module` columns

**Documentation:**
- [CE §3](CLASSIFICATION_ENHANCEMENT.md#3-target-workflow) — Target workflow, Pass 1 batch calls, tiebreaking
- [CE §4.1](CLASSIFICATION_ENHANCEMENT.md#41-classify-skill--skillsclassifyskillmd) — Exact line-by-line changes to SKILL.md
- [CE §6](CLASSIFICATION_ENHANCEMENT.md#6-backward-compatibility) — Offline fallback chain, cascading fallback warning
- [CE §8.2](CLASSIFICATION_ENHANCEMENT.md#82-confirmation-table-format-change) — New confirmation table format with matchType
- [CE §8.3](CLASSIFICATION_ENHANCEMENT.md#83-cross-module-class-conflicts) — Cross-module tiebreaking rule

**File:** `oss/apps/dethereal/skills/classify/SKILL.md` (modify)

---

**S1.2 — Security-enricher agent classification protocol alignment**

As an agent author, I want the security-enricher's Classification Protocol to use `match_classes` instead of per-module `get_classes`, so that classification behavior is consistent whether invoked via `/dethereal:classify` or during enrichment.

- Update Pass 1 (lines 91-97 of `agents/security-enricher.md`): replace per-module `get_classes` with `match_classes(elements: [...], classLabel: <label>, moduleIds: [...], topN: 3)`
- Update Pass 2 broadening (line 106): `match_classes` without `moduleIds`
- Add same offline fallback as S1.1

**Documentation:**
- [CE §4.2](CLASSIFICATION_ENHANCEMENT.md#42-security-enricher-agent--agentssecurity-enrichermd) — Exact changes to enricher classification protocol

**File:** `oss/apps/dethereal/agents/security-enricher.md` (modify)

---

### Definition of Done

- [ ] `/dethereal:classify` calls `match_classes` instead of `get_classes` for Pass 1
- [ ] Classification with 3 active modules uses 3-4 tool calls (one per class label with unclassified elements), not 9-15
- [ ] Cross-module tiebreaking: when two modules return same-confidence matches, the module earlier in `activeModules` wins
- [ ] Quality gate broadening calls `match_classes` without `moduleIds` (one call, not per-element)
- [ ] Offline: when `match_classes` returns `{ success: false }`, falls back to per-module `get_classes`
- [ ] When both `match_classes` and `get_classes` fail, agent warns: "Platform connectivity issues — classification running in LLM-only mode"
- [ ] Confirmation table shows `matchType` and `Module` columns
- [ ] Security-enricher Classification Protocol matches the classify skill's behavior

### Review & Test

**Manual test:** Run `/dethereal:classify` on a model with 3+ active modules. Verify:
1. Agent calls `match_classes` (not `get_classes`) in the tool call log
2. Confirmation table shows match types (exact, fuzzy, vector, type)
3. Stop the platform → re-run classify → verify fallback to `get_classes`, then LLM-only mode

**Agent review:** `Agent(claude-code-expert)` — verify skill/agent instruction loading mechanics, turn budget impact, `@docs/` reference patterns.

---

## Sprint 2 — Quality Score Fix (Stream B)

**Gaps:** G-05, G-23
**Parallel with:** Sprints 1, 3, 4
**Prerequisites:** None — data already loaded in `computeQuality`

### User Stories

**S2.1 — Replace hardcoded `controlCoverageRate = 0` with attribute-inferred computation**

As a Dethereal user, I want the quality score to reflect actual security attribute coverage instead of always showing 0% for control coverage, so that the score provides meaningful feedback on model completeness.

- Replace `const controlCoverageRate = 0` (line 272 of `validate-model.tool.ts`) with two-tier computation:
  - **Tier 1 — Attribute-inferred:** Count classified elements with at least one positive security attribute using the mapping table (encryption_in_transit, encryption_at_rest, authentication_type, monitoring_tools, implicit_deny_enabled)
  - **Tier 2 — Formal coverage:** Count elements with non-empty `controls[]` (directly or boundary-inherited). Walk boundary tree, propagate `controls[]` from boundaries to children recursively
  - Use `max(tier1, tier2)` per element
- Apply quality thresholds: exclude deprecated protocols (SSLv3, TLS 1.0, DES, 3DES, RC4) and `basic` auth over cleartext/deprecated TLS
- Update the quality output `note` field: when score is attribute-inferred only (no `controls[]` entries), label as "Inferred from attributes; no formal controls assigned"
- `digest` auth over cleartext receives the same exclusion as `basic`

**Documentation:**
- [CI §6.5](CONTROL_INTEGRATION.md#65-quality-score-integration) — Two-tier computation, boundary inheritance, max rule
- [CI §10 Phase 1](CONTROL_INTEGRATION.md#phase-1--fix-the-quality-score-zero-new-ux) — Positive attribute mapping table with quality thresholds
- [GAP_ANALYSIS.md G-05](GAP_ANALYSIS.md#g-05-validate_model_json-quality-score--controlcoveragerate-hardcoded-to-0) — Scope estimate (60-100 lines), test requirements

**File:** `oss/apps/dethereal/src/tools/validate-model.tool.ts` (modify)

---

**S2.2 — Compensating control expiration check**

As a compliance officer, I want the quality score to flag expired compensating controls, so that temporary mitigations do not become permanent fixtures in the threat model.

- In the `computeQuality` method, scan `controls[]` for entries with `compensating.expires < current date`
- Include expired compensating controls as warnings in the quality output
- Format: "Compensating control 'X' expired on YYYY-MM-DD (original requirement: PCI-DSS 6.3.3). Review or remove."

**Documentation:**
- [CI §12 Gap 9](CONTROL_INTEGRATION.md#gap-9-compensating-controls) — `compensating` field spec with `expires`, `primary_control`, `original_requirement`, `risk_acceptance`
- [GAP_ANALYSIS.md G-23](GAP_ANALYSIS.md#g-23-compensating-control-expiration--no-enforcement-mechanism) — Placement options, compliance rationale

**File:** `oss/apps/dethereal/src/tools/validate-model.tool.ts` (modify — extends S2.1's work in `computeQuality`)

---

### Definition of Done

- [ ] Quality score for a model with `encryption_in_transit: TLS 1.3` on all components shows > 0% control coverage
- [ ] Model with `encryption_in_transit: TLS 1.0` does NOT count as positive (deprecated protocol exclusion)
- [ ] Model with `authentication_type: basic` and no `encryption_in_transit` does NOT count as positive
- [ ] Model with `authentication_type: digest` and no `encryption_in_transit` does NOT count as positive
- [ ] Boundary with `controls[]` propagates coverage to child components
- [ ] Nested boundaries: grandchild components inherit from grandparent boundary's `controls[]`
- [ ] Element with attribute-inferred coverage AND formal `controls[]` uses the max (both count)
- [ ] Quality output `note` says "Inferred from attributes; no formal controls assigned" when no `controls[]` exist
- [ ] Expired compensating control (date in the past) produces a warning in quality output
- [ ] Non-expired compensating control produces no warning
- [ ] All existing tests pass; no regressions in other quality factors

### Review & Test

**Unit tests** (new cases for `quality-score.test.ts`):
1. Flat model with attribute-inferred coverage → `controlCoverageRate > 0`
2. Nested boundary inheritance → children counted as covered
3. Mixed attribute + formal coverage → max rule applies
4. `basic` auth + no encryption → NOT counted
5. `basic` auth + TLS 1.3 → counted (adequate encryption)
6. `TLS 1.0` → NOT counted (deprecated)
7. `DES`, `3DES`, `RC4` → NOT counted (deprecated algorithms)
8. `digest` auth + no encryption → NOT counted
9. Compensating control with past `expires` → warning emitted
10. Compensating control with future `expires` → no warning
11. Empty `controls[]` → note says "Inferred from attributes"

**Agent review:** `Agent(threat-modeler)` — validate that the positive attribute mapping table produces trustworthy coverage signals. Check for false positives (weak security counted as coverage) and false negatives (real controls not counted).

---

## Sprint 3 — Backend: Control Candidate Ranking (Stream C)

**Gaps:** G-01, G-04
**Parallel with:** Sprints 1, 2, 4
**Prerequisites:** None

### User Stories

**S3.1 — `controlCandidatesForType` custom resolver**

As a backend developer, I want a `controlCandidatesForType` GraphQL query that returns controls with matching `supportedTypes`, countermeasure counts per class, and assigned element IDs, so that the MCP plugin can rank control candidates without loading all controls into the agent context.

- Add `ControlCandidate`, `ControlClassFit` types to `schema.graphql`
- Add `controlCandidatesForType(elementTypes: [ComponentType!]!, moduleIds: [ID!]): [ControlCandidate!]!` query with `@authentication`
- Create `ControlCandidatesResolverService` following the established custom resolver pattern
- Register in `custom-resolver.module.ts`
- Memgraph compatibility: use `size($moduleIds) = 0` instead of `$moduleIds IS NULL`; verify `cc.supportedTypes` is a list property
- Inject `AuthorizationService`, call `checkAuthorization` on every request

**Documentation:**
- [CI §10 P5d](CONTROL_INTEGRATION.md#phase-2--start-asking-control-focus-mode) — Full Cypher query (lines 824-844), GraphQL types
- [CI §6.3](CONTROL_INTEGRATION.md#63-user-interaction-model) — Three-layer architecture, Layer 1 spec
- [GAP_ANALYSIS.md G-01](GAP_ANALYSIS.md#g-01-controlcandidatesfortype-query-missing) — Custom resolver rationale, Memgraph fixes, file list

**Files:**
- `oss/apps/dt-ws/schema/schema.graphql` (modify)
- `oss/apps/dt-ws/src/gql/resolver-services/control-candidates-resolver.service.ts` (new)
- `oss/apps/dt-ws/src/gql/services/custom-resolver.module.ts` (modify)

**Implementation:** `Agent(backend-dev)` — load custom resolver docs (`LLD/CUSTOM_RESOLVER_SERVICES_QUICK_REFERENCE.md`, `LLD/EXAMPLES.md`), follow established resolver service pattern from existing services in `custom-resolver.module.ts`.

---

**S3.2 — dt-core wrapper for `controlCandidatesForType`**

As an MCP tool developer, I want a `DtControl.controlCandidatesForType()` method that wraps the GraphQL query, so that the MCP `rank` action can call it through dt-core (not direct GraphQL).

- Add `controlCandidatesForType()` method to `DtControl`
- Add `CONTROL_CANDIDATES_FOR_TYPE` query to `dt-control-gql.ts`
- Follow `DtControl.findControls()` pattern (Apollo Client, typed result)

**Documentation:**
- [GAP_ANALYSIS.md G-01](GAP_ANALYSIS.md#g-01-controlcandidatesfortype-query-missing) — Calling convention: MCP → dt-core → GraphQL

**Files:**
- `oss/packages/dt-core/src/dt-control/dt-control.ts` (modify)
- `oss/packages/dt-core/src/dt-control/dt-control-gql.ts` (modify)

**Implementation:** `Agent(backend-dev)` — follow `DtControl.findControls()` pattern for method signature, Apollo Client usage, and typed result mapping.

---

**S3.3 — MCP `rank` action on `manage_controls`**

As a Dethereal user, I want the `manage_controls` tool to have a `rank` action that returns pre-scored control candidates for a boundary, so that the agent can present a ranked table instead of performing an unbounded reasoning loop.

- Add `rank` to the `action` enum in the tool's input schema
- Add `elementTypes: ComponentType[]` and `moduleIds: ID[]` parameters for the `rank` action
- Call `DtControl.controlCandidatesForType()` (S3.2)
- Enrich with local element context: `compatible`, `configured` (countermeasure count > 0), `sameDomain` (module match), `alreadyAssigned`
- Score using deterministic formula: `score = compatible_and_configured / total - 1.0 * incompatible_and_configured / total`
- Guard against `total_classes == 0` (orphaned control) — skip, do not divide by zero
- Label: `strong` (>= 0.8, zero misconfigured), `good` (>= 0.5), `weak` (< 0.5)
- Return top 5 candidates with relevance labels, class-level fit details, countermeasure summaries

**Documentation:**
- [CI §6.3](CONTROL_INTEGRATION.md#63-user-interaction-model) — Scoring formula, three buckets, label thresholds, Layer 2 spec
- [CI §10 P5c](CONTROL_INTEGRATION.md#phase-2--start-asking-control-focus-mode) — MCP `rank` action spec
- [GAP_ANALYSIS.md G-04](GAP_ANALYSIS.md#g-04-manage_controls-rank-action-missing) — Edge cases, schema update, calling convention

**File:** `oss/apps/dethereal/src/tools/manage-controls.tool.ts` (modify)

---

### Definition of Done

- [ ] `controlCandidatesForType` query returns results in GraphQL playground at `localhost:3003/graphql`
- [ ] Query with `elementTypes: [STORE]` returns only controls whose ControlClasses have `STORE` in `supportedTypes`
- [ ] Query with `moduleIds: ["mod-1"]` restricts to that module's classes
- [ ] Query with `moduleIds: []` (empty array) returns all controls (no module filter)
- [ ] Each `ControlClassFit` has correct `compatible` flag and `countermeasureCount`
- [ ] `assignedElementIds` reflects existing SUPPORTS edges
- [ ] `DtControl.controlCandidatesForType()` works from dt-core (Apollo Client round-trip)
- [ ] `manage_controls(action: 'rank', elementTypes: ['PROCESS', 'STORE'])` returns scored candidates
- [ ] A control with 3 compatible + 1 misconfigured class scores `0.5` ("good", not "strong")
- [ ] A control with 0 ControlClasses is skipped (no division by zero)
- [ ] Result is sorted by score descending, top 5 returned
- [ ] Auth: `checkAuthorization` called in the custom resolver

### Review & Test

**Verification** (GraphQL playground):
```graphql
query {
  controlCandidatesForType(
    elementTypes: [STORE]
    moduleIds: []
  ) {
    controlId controlName
    classes { classId className compatible countermeasureCount }
    totalCountermeasures
    assignedElementIds
  }
}
```

**Agent review:** `Agent(cypher-memgraph-expert)` — validate Cypher compatibility with Memgraph, review `ANY()` predicate on list properties, verify `collect({...})` map literal behavior, check query performance with `PROFILE`.

**Unit tests:**
1. Scoring formula: 3 compatible + 0 incompatible = 1.0 (strong)
2. Scoring formula: 3 compatible + 1 misconfigured = 0.5 (good, not strong)
3. Scoring formula: 1 compatible + 2 misconfigured = -0.33 (weak)
4. Zero classes: control skipped, no error
5. Empty result: no controls match → empty array returned

---

## Sprint 4 — Data Layer Fix (Stream D)

**Gaps:** G-07
**Parallel with:** Sprints 1, 2, 3
**Prerequisites:** None

### User Stories

**S4.1 — Update pipeline processes `controls[]` from local JSON**

As a Dethereal user, I want controls assigned to model elements to survive sync push, so that control assignments persist across publish cycles instead of being silently dropped.

- In `updateComponent()`: read `componentData.controls` from input JSON, resolve control IDs using `resolveControls()` chain (match by ID exact → name exact → name case-insensitive → name partial), populate `updatedNode.data.controls`
- Same for `updateBoundary()` and `updateDataFlow()`
- Use disconnect/connect semantics on the update mutation (already supported in `dt-component.ts` lines 112-125)
- **Critical:** Only set `controls` on mutation data when `data.controls !== undefined`. When `undefined`, the mutation triggers `disconnect: {}` with `connect: []` — which wipes all existing controls. When explicitly `[]`, it correctly clears controls. When populated, it performs smart diff (disconnect NOT in list + connect new ones)
- Do NOT copy `associateControlsDirectly` pattern from import pipeline (it sets `dataItems: []` as side effect)
- Cache the control list from `resolveControls()` for the duration of the update batch to avoid redundant platform fetches

**Documentation:**
- [CI §3.1](CONTROL_INTEGRATION.md#31-local-json-supports-controls-but-the-engine-ignores-them) — The bug: update pipeline silently drops controls
- [CI §10 P1](CONTROL_INTEGRATION.md#phase-3--close-the-loop-platform-integration) — Implementation guidance, `associateControlsDirectly` trap
- [CI §12 Gap 3](CONTROL_INTEGRATION.md#gap-3-import-pipeline-dataitems-side-effect) — `dataItems: []` side effect detail
- [GAP_ANALYSIS.md G-07](GAP_ANALYSIS.md#g-07-update-pipeline-silently-drops-controls) — disconnect/connect pattern, `undefined` vs `[]` trap, `resolveControls()` caching

**Files:**
- `oss/packages/dt-core/src/dt-update/dt-update.ts` (modify — `updateComponent()`, `updateBoundary()`, `updateDataFlow()`, `updateModelProperties()`)

**Implementation:** `Agent(backend-dev)` — load `LLD/SCHEMA.md` for SUPPORTS edge semantics, follow disconnect/connect pattern from `dt-component.ts` lines 112-125. Critical: respect `undefined` vs `[]` semantics (see story description).

---

### Definition of Done

- [ ] `updateComponent()` reads `controls[]` from input JSON and creates/maintains SUPPORTS edges
- [ ] `updateBoundary()` reads `controls[]` from input JSON and creates/maintains SUPPORTS edges
- [ ] `updateDataFlow()` reads `controls[]` from input JSON and creates/maintains SUPPORTS edges
- [ ] `updateModelProperties()` reads model-level `controls[]` instead of hardcoded empty array
- [ ] When `controls` is `undefined` in input: existing controls are preserved (not wiped)
- [ ] When `controls` is `[]` in input: all controls are disconnected (intentional clear)
- [ ] When `controls` is populated: smart diff (disconnect removed + connect added)
- [ ] `dataItems` relationships are NOT affected by control updates
- [ ] Import → update → export round-trip preserves controls
- [ ] No regressions in existing update tests

### Review & Test

**Integration test** (end-to-end):
```
1. Import model with controls: /dethereal:sync push (first push)
   → Verify SUPPORTS edges exist in graph
2. Modify model locally (add a component), keep controls
3. Sync push again (update path)
   → Verify SUPPORTS edges still exist after update
4. Remove a control from local JSON, sync push
   → Verify that specific SUPPORTS edge is removed, others remain
5. Add controls to a new component, sync push
   → Verify new SUPPORTS edges created
```

**Agent review:** `Agent(cypher-memgraph-expert)` — verify the disconnect/connect Cypher pattern works correctly on Memgraph, especially the `WHERE NOT { OR: [...] }` pattern for smart diff.

**Regression test:** Run existing import/export tests to ensure no `dataItems` side effects.

---

## Sprint 5 — Control UX (Stream E)

**Gaps:** G-10, G-09, G-14, G-17
**Depends on:** Sprints 1 + 2 + 3 (must complete). Sprint 4 should complete (soft dependency — without it, controls don't survive sync).

### User Stories

**S5.1 — Control instructions file**

As an agent author, I want a `controls-enrichment.md` instructions file with the complete control assignment protocol, so that the security-enricher agent can load it only when `--focus controls` is invoked.

- Create `oss/apps/dethereal/docs/controls-enrichment.md` (~150 lines)
- Self-gating preamble: "If `--focus controls` was not specified, ignore this file" (because `@docs/` references load on every enrich invocation, not conditionally)
- Content:
  - Multi-class control evaluation rules (reference CI §6.3 scoring formula)
  - Brownfield sub-path: call `manage_controls(action: 'rank')`, present pre-ranked table, ask yes/no
  - Greenfield sub-path: name-only reference prompts, `{ id: null, name: "..." }`
  - Control source tracking: set `source: "discovered" | "declared" | "both"` on ControlReference
  - Batch table format templates (CI §6.3 example tables)
  - Assignment level guidance: boundary vs. component vs. flow (CI §6.4 table)
  - Re-run behavior: read existing `controls[]`, present as "currently assigned"
  - First-run on pre-existing model: detection controls pre-populated from existing `monitoring_tools`
  - Error recovery: if `rank` fails (platform unreachable), fall back to greenfield prompts

**Documentation:**
- [CI §6.3](CONTROL_INTEGRATION.md#63-user-interaction-model) — Brownfield/greenfield interaction, batch table format
- [CI §6.4](CONTROL_INTEGRATION.md#64-local-json-format) — Assignment level guidance table
- [CI §7 Q4](CONTROL_INTEGRATION.md#q4-control-source-tracking--implement-for-v1) — `source` field semantics
- [CI §8](CONTROL_INTEGRATION.md#8-enrichment-prompt-design) — Three-step prompt sequence, re-run behavior, error recovery
- [GAP_ANALYSIS.md G-10](GAP_ANALYSIS.md#g-10-control-instructions-file-missing) — Self-gating preamble requirement

**File:** `oss/apps/dethereal/docs/controls-enrichment.md` (new)

---

**S5.2 — Enrich skill `--focus controls` mode**

As a Dethereal user, I want `/dethereal:enrich --focus controls` to run a dedicated control assignment pass, so that I can declare enforcement and detection controls in a structured, guided interaction.

- Add `controls` to the `--focus` enum in `skills/enrich/SKILL.md` (Step 1, Parse Arguments)
- Add `@docs/controls-enrichment.md` reference in the skill (loads the instructions file from S5.1)
- Define the 3-step control pass:
  1. **Enforcement controls (Category 2):** Batched per boundary. If platform reachable, call `manage_controls(action: 'rank', elementTypes: [...], moduleIds: [...])`. If not, greenfield prompts. Write control references to `structure.json` after each boundary (incremental persistence).
     - Zero-boundary models: single global enforcement prompt
     - **B > 6 tiered prompts (launch gate):** For B > 6, collapse to crown-jewel boundaries first (reduces effective B to 3-4)
  2. **Detection controls (Category 3):** One global prompt, pre-populated from `monitoring_tools`
  3. **Governance placeholder (Category 4):** Single prompt, free-text to `scope.json`
- Session break: offer between main enrichment and control pass
- Separate agent invocation: the calling context (threat-model skill or user) invokes `/dethereal:enrich --focus controls` as a fresh slash command → new agent instance with own 40-turn budget
- Note PostToolUse hook interaction: incremental persistence triggers B hook invocations per pass (non-blocking with current lightweight hook)

**Documentation:**
- [CI §6.2](CONTROL_INTEGRATION.md#62-workflow-placement) — Focus mode rationale, separate invocation, instruction loading
- [CI §8](CONTROL_INTEGRATION.md#8-enrichment-prompt-design) — Three-step prompt sequence, turn budget breakdown, incremental persistence, B>6 tiered prompts
- [CI §10 P4](CONTROL_INTEGRATION.md#phase-2--start-asking-control-focus-mode) — Enrich skill update spec
- [CI §12 Gap 6](CONTROL_INTEGRATION.md#gap-6-zero-boundary-models) — Zero-boundary mitigation
- [CI §12 Gap 8](CONTROL_INTEGRATION.md#gap-8-large-models-20-boundaries--required-for-phase-2) — B>6 launch gate
- [GAP_ANALYSIS.md G-09](GAP_ANALYSIS.md#g-09-enrich-skill-controls-focus-mode-missing) — Hook interaction, `@docs/` always-load, invocation mechanism, B>6 acceptance criteria

**File:** `oss/apps/dethereal/skills/enrich/SKILL.md` (modify)

---

**S5.3 — Threat-model skill control pass integration**

As a Dethereal user running the guided workflow, I want the threat-model skill to offer a control pass after enrichment, so that I can assign controls as part of the end-to-end workflow.

- After Step 8 (Enrichment) completes, add session break offering:
  ```
  Enrichment complete. Quality: 72/100.
  Ready for control assignment (~6 prompts). Continue now or resume later?
    [continue] Run control pass now
    [later]    Resume with /dethereal:enrich --focus controls
  ```
- If user chooses "continue", the threat-model skill invokes the enrich skill as a sub-agent, which creates a new agent instance

**Documentation:**
- [CI §6.2](CONTROL_INTEGRATION.md#62-workflow-placement) — Session break UX
- [GAP_ANALYSIS.md G-14](GAP_ANALYSIS.md#g-14-threat-model-skill--no-control-pass-integration) — Integration spec

**File:** `oss/apps/dethereal/skills/threat-model/SKILL.md` (modify)

---

**S5.4 — Security-enricher agent `source` field handling**

As a compliance officer, I want control references to track whether they were discovered from code or declared by the user, so that analysis confidence and SOC2 Type I reporting can distinguish implemented vs. planned controls.

- When writing control references in the security-enricher agent:
  - `source: "discovered"` for controls inferred from IaC/code attributes
  - `source: "declared"` for user-stated controls
  - `source: "both"` when both discovered and declared

**Documentation:**
- [CI §7 Q4](CONTROL_INTEGRATION.md#q4-control-source-tracking--implement-for-v1) — `source` field rationale, compliance use cases
- [GAP_ANALYSIS.md G-17](GAP_ANALYSIS.md#g-17-security-enricher-agent--no-source-field-handling) — Spec

**File:** `oss/apps/dethereal/agents/security-enricher.md` (modify)

---

### Definition of Done

- [ ] `/dethereal:enrich --focus controls` runs the 3-step control pass in a separate agent invocation
- [ ] Enforcement controls batched per boundary — control references written to `structure.json` after each boundary
- [ ] Zero-boundary model: single global enforcement prompt instead of zero prompts
- [ ] B > 6: tiered prompt — crown-jewel boundaries first, remaining collapsed
- [ ] Detection controls pre-populated from existing `monitoring_tools` attribute data
- [ ] Governance placeholder writes to `scope.json` as `declared_governance_controls`
- [ ] Brownfield (platform reachable): `rank` action returns pre-scored candidates with relevance labels
- [ ] Greenfield (platform unreachable): name-only references with `source: "declared"`
- [ ] If `rank` fails: falls back to greenfield prompts (no retry, no stall)
- [ ] Re-run: previously declared controls shown as "currently assigned"
- [ ] First run on pre-existing model: detection pre-population from `monitoring_tools` works
- [ ] Threat-model skill offers session break after enrichment
- [ ] `source` field set correctly on all ControlReference entries
- [ ] Turn budget: B=4 brownfield uses ≤ 16 of 40 turns; B=6 brownfield ≤ 22

### Review & Test

**Manual test** (end-to-end):
```
1. /dethereal:enrich --focus controls on a model with 4 boundaries
   → Verify 3-step sequence: enforcement (4 boundary prompts) → detection → governance
   → Verify incremental persistence: interrupt mid-pass, re-run → completed boundaries preserved
2. /dethereal:enrich --focus controls on a model with 0 boundaries
   → Verify single global enforcement prompt
3. /dethereal:enrich --focus controls with platform offline
   → Verify greenfield prompts (name-only references)
4. /dethereal:threat-model → complete through enrichment
   → Verify session break offered → choose "continue" → control pass runs
```

**Agent reviews** (run in parallel):
- `Agent(claude-code-expert)` — verify skill/agent instruction loading, `@docs/` reference mechanics, separate invocation boundary, PostToolUse hook interaction, turn budget accounting
- `Agent(threat-modeler)` — verify control category coverage (Cat 2-4), prompt design effectiveness, that the interaction produces actionable control assignments
- `Agent(process-architect)` — verify turn budget holds for B=4 and B=6, incremental persistence crash recovery, tiered prompt behavior for B>6
- `Agent(security-architect)` — verify brownfield ranking produces trustworthy recommendations, compensating control handling, `source` field distinction between discovered/declared

---

## Sprint 6 — Surface Enhancements & Documentation (Streams F + docs)

**Gaps:** G-03, G-11, G-12, G-06, G-13, G-15, G-18, G-19, G-20, G-21, G-22
**Depends on:** Sprint 5 (control UX must exist for surface enhancements to report on)

### User Stories

**S6.1 — `get_control_gaps` resolver enhancements**

As a security analyst, I want the control gap analysis to filter by element type, handle boundary-level controls, and distinguish configured from unconfigured controls, so that gap recommendations are accurate and actionable.

Three enhancements to the existing `ControlGapsResolverService`:

1. **Type-compatible filtering:** Add `WHERE ANY(et IN $elementTypes WHERE et IN cc.supportedTypes)` to Phase 3 recommended controls Cypher
2. **Boundary-level SUPPORTS traversal:** Match both direct `(Control)-[:SUPPORTS]->(Component)` and indirect `(Control)-[:SUPPORTS]->(Boundary)<-[:BELONGS_TO]-(Component)`
3. **Fourth coverage state:** Add `configuredCoverage` (countermeasure count > 0) and `noMitreChain` count to `CoverageSummary`

**Documentation:**
- [CI §6.5](CONTROL_INTEGRATION.md#65-quality-score-integration) — Boundary-level SUPPORTS traversal requirement
- [CI §6.6](CONTROL_INTEGRATION.md#66-post-analysis-complementary-path-approach-d) — Type-compatible filtering, MITRE chain completeness
- [GAP_ANALYSIS.md G-03](GAP_ANALYSIS.md#g-03-type-compatible-filtering-in-get_control_gaps-phase-3) — Three enhancements spec

**File:** `oss/apps/dt-ws/src/gql/resolver-services/control-gaps-resolver.service.ts` (modify)

**Implementation:** `Agent(backend-dev)` — load existing `control-gaps-resolver.service.ts`, extend Phase 3 Cypher with type filtering and boundary traversal. Validate Memgraph compatibility of `BELONGS_TO` path pattern.

---

**S6.2 — Surface skill uses `get_control_gaps` tool**

As a Dethereal user, I want the `/dethereal:surface` skill to call `get_control_gaps` for framework-grounded gap analysis when the model is synced, so that control recommendations are based on the MITRE chain traversal, not local file inspection.

- When model is synced: call `mcp__dethereal__get_control_gaps(model_id)` and present results
- When model is not synced: fall back to local file inspection (current behavior)
- Present unmitigated exposures partitioned into addressable and unaddressable
- Present recommended controls with D3FEND technique links
- Note exposures with no MITRE chain separately

**Documentation:**
- [CI §6.6](CONTROL_INTEGRATION.md#66-post-analysis-complementary-path-approach-d) — Post-analysis workflow, presentation format
- [GAP_ANALYSIS.md G-11](GAP_ANALYSIS.md#g-11-surface-skill-does-not-use-get_control_gaps-mcp-tool) — Fallback behavior

**File:** `oss/apps/dethereal/skills/surface/SKILL.md` (modify — Step 4)

---

**S6.3 — Surface skill two-tier reporting**

As a CISO, I want the surface analysis to distinguish inferred coverage (from attributes) from formal coverage (from SUPPORTS edges), so that I can present both security posture and governance maturity to the board.

- Split Step 4 into two sections: inferred coverage + formal coverage
- Add control source breakdown (discovered/declared/both) when populated
- Add governance controls section sourced from `scope.json.declared_governance_controls`

**Documentation:**
- [CI §9](CONTROL_INTEGRATION.md#9-two-tier-reporting-format) — Full report format with examples
- [CI §6.7](CONTROL_INTEGRATION.md#67-two-tier-reporting) — Governance story
- [GAP_ANALYSIS.md G-12](GAP_ANALYSIS.md#g-12-surface-skill-missing-two-tier-reporting) — Spec

**File:** `oss/apps/dethereal/skills/surface/SKILL.md` (modify — Step 4)

---

**S6.4 — Sync skill: unresolved control warnings + ID pinning**

As a Dethereal user, I want the sync skill to warn me about unresolved control references and pin resolved IDs back to local JSON, so that controls survive re-sync reliably.

- Post-push: surface warnings from `resolveControls()` for unresolved references
- ID pinning: after first successful sync, write resolved platform IDs back to local JSON
- Stale reference detection: on push, compare local control IDs against platform inventory

**Documentation:**
- [CI §10 P6](CONTROL_INTEGRATION.md#phase-3--close-the-loop-platform-integration) — Sync warning spec
- [CI §12 Gap 1](CONTROL_INTEGRATION.md#gap-1-supports-edge-idempotency-on-re-sync) — Name-match flipping mitigation
- [CI §12 Gap 2](CONTROL_INTEGRATION.md#gap-2-control-deletion-between-syncs) — Stale reference detection
- [GAP_ANALYSIS.md G-15](GAP_ANALYSIS.md#g-15-sync-skill--unresolved-control-warnings) — Spec

**File:** `oss/apps/dethereal/skills/sync/SKILL.md` (modify — P6 post-push section)

---

**S6.5 — `compute_control_coverage` MCP action**

As a Dethereal user, I want a `coverage` action on `validate_model_json` that computes detailed coverage breakdown with deterministic arithmetic, so that the surface skill gets accurate percentages.

- Add `coverage` action (or extend `quality`) to existing tool
- Hybrid execution: local attribute files + optional GraphQL for SUPPORTS edges
- Return inferred (per-category), formal (per-tier with gap lists), and source breakdown

**Documentation:**
- [BD §4.3](BACKEND_DELEGATION.md#43-compute_control_coverage--two-tier-coverage-reporting) — Hybrid architecture, input/output spec
- [CI §11](CONTROL_INTEGRATION.md#implementation-architecture) — Coverage computation design
- [GAP_ANALYSIS.md G-06](GAP_ANALYSIS.md#g-06-compute_control_coverage-hybrid-mcp-tool-missing) — Spec

**File:** `oss/apps/dethereal/src/tools/validate-model.tool.ts` (modify)

---

**S6.6 — Documentation alignment**

As a contributor, I want the architecture docs to reflect the current implementation, so that new developers get accurate context.

| Item | File | Change | Gap |
|------|------|--------|-----|
| Threat-model classification | `THREAT_MODELING_WORKFLOW.md` §4 | Update to `match_classes` batch calls, update D51 savings estimate | G-18 |
| Plugin architecture | `PLUGIN_ARCHITECTURE.md` | Add module selection + control integration sections | G-19 |
| Threat-model coverage def | `THREAT_MODELING_WORKFLOW.md` §8 | Update `control_coverage_rate` to two-tier approach | G-21 |
| Scout output schema | `agents/infrastructure-scout.md` | Add `recommendedModules` to formal JSON schema block | G-22 |
| Threat-model `match_classes` | `skills/threat-model/SKILL.md` | Update classification section to reference `match_classes` | G-13 |
| Backend services spec | `BACKEND_SERVICES_SPEC.md` | Determine if BACKEND_DELEGATION.md + backend/LLD specs are sufficient | G-20 |

**Documentation:** Each gap entry in [GAP_ANALYSIS.md](GAP_ANALYSIS.md) references the exact section to update.

---

### Definition of Done

- [ ] S6.1: `controlGaps` Phase 3 filters by `supportedTypes` — no database-tier controls recommended for API gateways
- [ ] S6.1: Boundary-level SUPPORTS edges counted — components in controlled boundaries show as mitigated
- [ ] S6.1: `CoverageSummary` includes `configuredCoverage` and `noMitreChain`, all fields sum to `totalExposures`
- [ ] S6.2: `/dethereal:surface` on a synced model calls `get_control_gaps` (not local file inspection)
- [ ] S6.2: On an unsynced model, falls back to local file inspection
- [ ] S6.3: Surface output has separate "Inferred Coverage" and "Formal Coverage" sections
- [ ] S6.3: Governance controls section appears when `declared_governance_controls` is populated
- [ ] S6.4: Sync push surfaces unresolved control warnings
- [ ] S6.4: After first push, resolved IDs written back to local JSON
- [ ] S6.5: `validate_model_json(action: 'coverage')` returns per-category and per-tier breakdown
- [ ] S6.6: All documentation updates reflect current implementation

### Review & Test

**S6.1 — Agent review:** `Agent(cypher-memgraph-expert)` — validate boundary traversal Cypher, verify `BELONGS_TO` path works with variable-length patterns on Memgraph, check the type-compatible WHERE clause.

**S6.2-S6.3 — Manual test:**
```
1. /dethereal:surface on synced model with controls
   → Verify two-tier report: inferred + formal sections
   → Verify MITRE-grounded recommendations (not just local file checks)
2. /dethereal:surface on unsynced model
   → Verify fallback to local file inspection
3. /dethereal:surface on model with declared_governance_controls
   → Verify governance section appears
```

**S6.4 — Manual test:**
```
1. Add a name-only control reference (id: null), sync push
   → Verify warning if name doesn't resolve
   → Verify ID written back to local JSON if name resolves
2. Delete a control on the platform, sync push
   → Verify stale reference warning
```

**S6.6 — Agent review:** `Agent(technical-writer)` — review all documentation updates for clarity, completeness, and cross-document consistency.

---

## Summary

| Sprint | Stream | Gaps | Parallel | Key output |
|--------|--------|------|----------|------------|
| 1 | A: Classification | G-08, G-16 | Yes | `match_classes` in classify skill + enricher agent |
| 2 | B: Quality score | G-05, G-23 | Yes | Attribute-inferred coverage, compensating control expiration |
| 3 | C: Backend + ranking | G-01, G-04 | Yes | `controlCandidatesForType` resolver + MCP `rank` action |
| 4 | D: Data layer | G-07 | Yes | Update pipeline processes `controls[]` |
| 5 | E: Control UX | G-10, G-09, G-14, G-17 | No | `--focus controls` mode, instructions file, guided workflow |
| 6 | F: Surface + docs | G-03, G-11, G-12, G-06, G-13, G-15, G-18-G-22 | No | Surface enhancements, sync warnings, documentation |

**Platform gaps** (G-24, G-25) are tracked in GAP_ANALYSIS.md but not scheduled in this plan — they are systemic authorization concerns scoped beyond the control integration work.

**Total: 23 gaps across 6 sprints, 20 user stories.**
