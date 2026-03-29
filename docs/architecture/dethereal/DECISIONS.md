# Dethereal Plugin -- Architecture Decisions

> Decisions identified during the architecture planning exercise. D1-D12, D14-D19 resolved by accepting recommendations (batch resolution). D13 resolved through R4 (effectively implemented in architecture). D20-D25 resolved through multi-agent review R1 (mapping vs. analysis boundary). D26-D32 resolved through R2 (plugin structure, MCP schemas, quality calibration). D33-D37 resolved through R3 (cross-document consistency, UX trust, documentation completeness). D38-D43 resolved through R4 (spec completeness, UX patterns, gate timing). D44-D54 resolved through R5 (token efficiency, overengineering, operational gaps). D55-D60 resolved through R7 (model decomposition for complex systems). D61-D66 resolved through R8 (pre-implementation security and UX review). **All 66 decisions resolved.**

---

## Decision Summary

| # | Decision | Options | Agent Recommendation | Risk if wrong | Status |
|---|----------|---------|---------------------|---------------|--------|
| D1 | [Default methodology](#d1-default-methodology) | STRIDE default vs. ask user | Default to STRIDE-per-element | Users blocked by methodology selection barrier; wrong default misleads toward inapplicable threat categories | **Resolved** |
| D2 | [Auto-discovery acceptance](#d2-auto-discovery-acceptance) | Auto-accept high-confidence vs. always confirm | Always confirm (configurable) | Auto-accept injects inaccurate elements that propagate through analysis, producing false findings | **Resolved** |
| D3 | [Offline-first support](#d3-offline-first-support) | Require platform vs. offline-first with class caching | Offline-first with caching | Stale cached classes produce models with invalid attribute schemas; cross-instance class ID contamination | **Resolved** |
| D4 | [MITRE data caching](#d4-mitre-data-caching) | Always query platform vs. local cache | Local tactic names only (14 items) | Full cache enables LLM approximate matching, bypassing platform's verified graph and producing hallucinated technique references | **Resolved** |
| D5 | [Quality gate enforcement](#d5-quality-gate-enforcement) | Advisory vs. blocking | Advisory during creation, blocking before sync/analysis | Advisory-only allows malformed models to reach analysis; strict blocks iterative workflows | **Resolved** |
| D6 | [Default action after model creation](#d6-default-action-after-model-creation) | Import to platform vs. save locally | Save locally for first-time, import for connected | Auto-import of unreviewed models violates human-in-the-loop principle | **Resolved** |
| D7 | [File naming convention](#d7-file-naming-convention) | UUID-only vs. slug+UUID | Slug+short-UUID for readability | Filename drift when elements are renamed; UUID-only hurts filesystem browsing | **Resolved** |
| D8 | [YAML support](#d8-yaml-support) | YAML on disk vs. JSON-only with YAML view | JSON canonical, YAML view only | YAML on disk creates second source of truth and parser dependency | **Resolved** |
| D9 | [Skill routing](#d9-skill-routing) | Single /dethereal router vs. separate skills | Separate skills, /dethereal = /dethereal:help | Single router adds navigation friction; separate skills fragment discoverability | **Resolved** |
| D10 | [Default agent setting](#d10-default-agent-setting) | Set threat-modeler as default vs. no default | Set threat-modeler as default | Wrong default agent provides irrelevant context for non-modeling tasks | **Resolved** |
| D11 | [Analysis chat via MCP](#d11-analysis-chat-via-mcp) | MCP tools vs. platform-only vs. subagent | Evaluate post-v1 | Premature implementation adds complexity without validated user need | **Resolved** |
| D12 | [Guided workflow model selection](#d12-guided-workflow-model-selection) | Hardcode opus vs. inherit | Inherit (let user decide) | Hardcoded model limits flexibility and increases cost | **Resolved** |
| D13 | [Agent invocation pattern](#d13-agent-invocation-pattern) | `agent` frontmatter vs. Agent() tool calls | `agent` frontmatter + Agent() for orchestration | Frontmatter-only cannot support multi-agent orchestration needed by /dethereal:threat-model | **Resolved** |
| D14 | [Discovery confidence storage](#d14-discovery-confidence-storage) | Description / custom attribute / split-file metadata | Split-file metadata (.dethernety/) for v1 | Metadata in model files pollutes platform data; metadata in separate file requires extra management | **Resolved** |
| D15 | [Model co-location](#d15-model-co-location) | .dethernety/ in app repo vs. separate repo | Co-locate in .dethernety/ | Model files in app repo add noise to PRs; separate repo reduces developer adoption | **Resolved** |
| D16 | [Scope template format](#d16-scope-template-format) | Structured fields vs. freeform text | Structured fields | Freeform text makes downstream phases non-deterministic | **Resolved** |
| D17 | [Data items required scope](#d17-data-items-required-scope) | Every flow vs. boundary-crossing only | Boundary-crossing and crown jewel flows | Requiring data items on every flow adds burden; boundary-only misses internal sensitive flows | **Resolved** |
| D18 | [Multi-system sessions](#d18-multi-system-sessions) | Multi-system vs. one per session | One system per session with cross-refs | Multi-system creates scope creep; one-per-session frustrates monorepo users | **Resolved** |
| D19 | [Auth-disabled mode documentation](#d19-auth-disabled-mode-documentation) | Explicit support vs. implicit | Explicitly document and support | Undocumented mode causes confusion in dev/demo environments | **Resolved** |
| D20 | [Threat actor modeling](#d20-threat-actor-modeling-in-scope) | Add to scope vs. defer vs. optional | Optional by intent (lightweight) | Omitting entirely under-models insider/supply chain; full specs duplicate analysis engine | **Resolved** |
| D21 | [Crown jewel operationalization](#d21-crown-jewel-operationalization) | Full schema vs. lightweight attrs vs. defer | Lightweight component attributes | Full schema duplicates engine computation; defer leaves quality gates unevaluable | **Resolved** |
| D22 | [Credential scope structure](#d22-credential-scope-data-structure) | credentials.json vs. flow attributes vs. both | Data flow + component attributes | Separate file creates drift; missing data degenerates lateral movement to BFS | **Resolved** |
| D23 | [Quality score formula](#d23-quality-score-formula) | Restructure vs. profiles vs. calibrate | Keep and calibrate with real models | Restructuring without data is guessing; profiles add complexity without demonstrated need | **Resolved** |
| D24 | [D3FEND API gap](#d24-search_mitre_defend-api-gap) | Add search to dt-core vs. rename vs. client-side | Rename to get_mitre_defend for v1 | "search" name implies capability only in platform analysis modules; client-side violates verified DB principle | **Resolved** |
| D25 | [Exposures CRUD scope](#d25-manage_exposures-crud-scope) | Keep full CRUD vs. remove CUD vs. mark as module | Mark CUD as analysis module feature | Full CRUD allows unverified exposures to pollute evidence chain | **Resolved** |
| D26 | [`search_mitre_attack` input schema](#d26-search_mitre_attack-input-schema-design) | Action-based vs. free-text vs. hybrid | Hybrid — both free-text search and direct ID lookup | Low — schema can be extended without breaking changes | **Resolved** |
| D27 | [Model directory structure](#d27-model-directory-structure) | `.dethernety/<model>/` vs. single model vs. user-chosen paths | User-chosen visible paths with `.dethernety/` metadata | Medium — directory structure is hard to change after adoption | **Resolved** |
| D28 | [`manage_countermeasures` schema scope](#d28-manage_countermeasures-schema-scope) | Expand schema vs. provide defaults vs. defer to analysis | Expand to match full DtCountermeasure API | Low — extra fields can be optional | **Resolved** |
| D29 | [State machine invalidation granularity](#d29-state-machine-invalidation-granularity) | Blanket revert vs. selective invalidation vs. additive exception | Blanket revert with better UX messaging | Medium — user frustration if reverts are frequent | **Resolved** |
| D30 | [STRIDE-to-ATT&CK enrichment boundary](#d30-stride-to-attck-enrichment-boundary) | Systematic in plugin vs. move to analysis vs. user-initiated browsing | Narrow to user-initiated browsing | Low — users can still browse MITRE on demand | **Resolved** |
| D31 | [`/dethereal:surface` skill scope](#d31-dethereal-surface-skill-scope) | Structural only vs. light analysis vs. full summary | Full summary (structural + control gaps + exposure counts) | Low — scope only adds read operations | **Resolved** |
| D32 | [Platform feature adoption](#d32-platform-feature-adoption) | 8 features evaluated individually | Phased adoption based on benefit vs. effort | Low — features are additive and individually toggleable | **Resolved** |
| D33 | [Skill frontmatter documentation](#d33-skill-frontmatter-documentation) | Full blocks vs. as-is vs. summary table | Summary table of all 19 skills | Low — table can be expanded if needed | **Resolved** |
| D34 | [Board-ready accept affordance](#d34-board-ready-statement-accept-affordance) | Edit-recommended vs. keep accept vs. review-and-accept | Edit as recommended, "use as-is" for acceptance | Low — friction can be relaxed later | **Resolved** |
| D35 | [Phase count reconciliation](#d35-phase-count-reconciliation) | Mapping table vs. single numbering vs. both | Both — mapping table + aligned UX resume | Low — purely additive documentation | **Resolved** |
| D36 | [Redundant disallowedTools](#d36-redundant-disallowedtools-on-agents-with-tools-allowlist) | Remove vs. keep as defense-in-depth vs. document in body | Remove — tools allowlist is sufficient | Negligible — equivalent protection | **Resolved** |
| D37 | [Coverage estimate format](#d37-coverage-estimate-in-board-ready-statement) | Qualitative vs. percentage with methodology vs. remove | Qualitative framing (counts + gaps) | Low — quantitative can be added later | **Resolved** |
| D38 | [Scope template schema](#d38-scope-template-schema) | TypeScript interface vs. prose-only | Add TypeScript interface to WORKFLOW Phase 1 | Low — can be extended during implementation | **Resolved** |
| D39 | [Undo mechanism scope](#d39-undo-mechanism-scope) | Full spec vs. defer vs. remove | Remove from V1 — git provides undo | Low — git undo is sufficient for V1 | **Resolved** |
| D40 | [Sync conflict metadata](#d40-sync-conflict-metadata) | Add sync metadata vs. defer | Defer sync implementation details to V1.1 | Medium — sync UX is aspirational for V1 | **Resolved** |
| D41 | [Crown jewel gate timing](#d41-crown-jewel-gate-timing) | Split tagging vs. move gate | Split: tag in Phase 3, enrich in Phase 7 | Low — lightweight tagging is additive | **Resolved** |
| D42 | [State-aware help and status footer](#d42-state-aware-help-and-status-footer) | State-aware + footer vs. static help | State-aware help + universal post-action footer | Low — reduces token usage and follow-up turns | **Resolved** |
| D43 | [Enrichment prioritization](#d43-enrichment-prioritization) | Tier-based vs. sequential | Tier-based: crown jewels → cross-boundary → internet-facing → internal | Low — users can still choose "enrich all" | **Resolved** |
| D44 | [Skill consolidation](#d44-skill-consolidation) | Merge overlapping skills vs. keep all | Merge: start→create, validate→review, import+export→sync (18→14) | Medium — changes user-facing API | **Resolved** |
| D45 | [State machine simplification](#d45-state-machine-simplification) | Derived state vs. collapse enrichment vs. keep 8 | Collapse CLASSIFIED+DATA_ITEMS_MAPPED+ENRICHED→ENRICHING (8→6) | Low — quality score already tracks sub-progress | **Resolved** |
| D46 | [Agent consolidation](#d46-agent-consolidation) | Merge scout into threat-modeler vs. keep 4 vs. strip scout | Keep 4 agents, strip unnecessary tools from scout | Low — scout benefits from context isolation | **Resolved** |
| D47 | [Guidelines splitting](#d47-guidelines-splitting) | Split core+layout vs. keep single file | Split: core (~3KB always loaded) + layout (~12KB editing only) | Low — saves 3-4K tokens per non-editing invocation | **Resolved** |
| D48 | [auth_failure_mode disposition](#d48-auth_failure_mode-disposition) | Defer capture vs. Known Gap vs. implement engine mapping | Keep capture, add explicit Known Gap callout | Medium — fail-open flows underweighted in analysis | **Resolved** |
| D49 | [Scope trust assumptions](#d49-scope-trust-assumptions) | Add trust_assumptions vs. defer vs. combine with exclusions | Add `trust_assumptions: string[]` to ScopeDefinition | Low — one field, one prompt, high audit value | **Resolved** |
| D50 | [Egress filtering attribute](#d50-egress-filtering-attribute) | Add to boundaries vs. defer vs. enrichment phase | Add `egress_filtering` as boundary attribute in Phase 4 | Low — captured alongside existing enforcement prompt | **Resolved** |
| D51 | [Deterministic classification](#d51-deterministic-classification) | Add MCP tool vs. keep LLM-only vs. advisory tool | Add `classify_components` action to `get_classes` | Low — LLM handles only ambiguous cases | **Resolved** |
| D52 | [Compliance framework tiering](#d52-compliance-framework-tiering) | Tier 3 levels vs. keep all 7 vs. support 3 only | Tier 1 (SOC2, ISO), Tier 2 (PCI, HIPAA, GDPR), Tier 3 (NIST, NIS2, DORA) | Medium — NIS2/DORA users may want more | **Resolved** |
| D53 | [Board-ready statement V1 scope](#d53-board-ready-statement-v1-scope) | Defer to V1.1 vs. separate skill vs. keep in review | Defer full confidence summary to V1.1 | Low — most V1 users won't need executive reporting | **Resolved** |
| D54 | [Expertise detection](#d54-expertise-detection) | 2-mode toggle vs. 3-level behavioral vs. single mode | Replace 3-level implicit with 2-mode explicit toggle | Low — explicit toggle is predictable | **Resolved** |
| D55 | [Decomposition trigger heuristic](#d55-decomposition-trigger-heuristic) | Component count only vs. multi-signal vs. no trigger | Multi-signal (components 25+, boundaries 5+, deployment diversity, qualitative signals). Advisory, never blocking | Medium — wrong threshold wastes user time or misses decomposition need | **Resolved** |
| D56 | [Decomposition timing](#d56-decomposition-timing) | Before Step 1 vs. after Step 2 vs. after Step 3 | After Step 3 (discovery confirmation). Zero rework cost at this point | Low — earlier timing wastes effort on incomplete data | **Resolved** |
| D57 | [Default: narrow scope vs. decompose](#d57-default-narrow-scope-vs-decompose) | Always decompose vs. always narrow vs. context-dependent | Narrow scope first as default. Decomposition plan when user described multiple systems | Medium — wrong default delays time-to-value or creates incomplete coverage | **Resolved** |
| D58 | [Decomposition plan persistence](#d58-decomposition-plan-persistence) | No persistence vs. decomposition-plan.json vs. embed in models.json | `.dethernety/decomposition-plan.json` — plugin metadata, tracks planned models and progress | Low — plan is a convenience, not a commitment | **Resolved** |
| D59 | [Reference component pre-creation](#d59-reference-component-pre-creation) | Pre-create stubs vs. prompt during workflow vs. manual only | Pre-create `representedModel` stubs for adjacent models when starting model N in a plan. Unresolved refs are warnings, not errors | Low — unresolved refs handled gracefully by existing import logic | **Resolved** |
| D60 | [Cross-model scope exclusions](#d60-cross-model-scope-exclusions) | No exclusions vs. filter discovery vs. scope annotation | Deferred subsystems listed in `scope.json` exclusions as "(separate model)". Discovery filters them out | Medium — without filtering, discovery re-surfaces components assigned to other models | **Resolved** |
| D61 | [MCP security hardening](#d61-mcp-security-hardening) | Accept `_token` with JWKS vs. remove `_token` vs. both | Remove `_token` from tool args (tokens from store only), add path containment, URL-keyed token store, `state` parameter, HTTPS enforcement | High — `_token` injection + path traversal are exploitable | **Resolved** |
| D62 | [Credential attribute key mapping](#d62-credential-attribute-key-mapping) | `credential_name` vs. `required_credentials` vs. translation layer | Plugin writes `required_credentials` (engine property name) on data flow edges. `credential_name` is human-readable label only | High — wrong key breaks credential gating entirely | **Resolved** |
| D63 | [auth_failure_mode engine integration](#d63-auth_failure_mode-engine-integration) | Capture without engine integration vs. integrate vs. defer capture | Capture in plugin, engine fix required separately (`fail_open` → `auth_strength = 0.0`) | High — contradictory signals erode trust | **Resolved** |
| D64 | [Plugin defaults and state management](#d64-plugin-defaults-and-state-management) | Default agent vs. explicit invocation; sign-off behavior on backward transitions | No default agent (invoke via skills/`@`); clear `model_signed_off` and invalidate `quality.json` on backward transitions | Low — clean separation of concerns | **Resolved** |
| D65 | [UX hardening: discovery, session break, undo, decomposition](#d65-ux-hardening) | Various options per sub-finding | Sources-checked summary; size-calibrated session break; git-based undo with LLM guidance; cross-model gap warning at decomposition; commit recommendation at STRUCTURE_COMPLETE | Medium — UX gaps that compound on large models | **Resolved** |
| D66 | [monitoring_tools V1 scope](#d66-monitoring_tools-v1-scope) | Engine integration vs. human review only vs. defer capture | V1: capture for human review only. No engine integration point exists. Engine integration is a future capability | Low — documented as human review, no false expectations | **Resolved** |

---

## Decision Details

### D1: Default Methodology

**Context:** The plugin is methodology-agnostic. Should it default to a specific methodology or ask users to choose?

**Options:**
- (a) Default to STRIDE-per-element, allow override via parameter
- (b) Ask users to choose methodology at scope definition

**Recommendation:** (a) STRIDE-per-element as default. It covers the majority of professional use cases, maps directly to the existing data model, and avoids a decision barrier for new users. Methodology selection available as optional parameter: `/dethereal:threat-model --methodology pasta`

**Status: Resolved**

---

### D2: Auto-Discovery Acceptance

**Context:** When auto-discovery finds high-confidence components, should they be auto-added to the model?

**Options:**
- (a) Auto-accept high-confidence, confirm medium/low
- (b) Always confirm all (configurable via setting)

**Recommendation:** (b) Always confirm. For professional threat modeling, auto-adding elements risks noise that affects analysis quality. However, make this configurable: `auto_accept_high_confidence: boolean` in plugin settings. Present all discovered elements in a single batch table for one-click confirmation.

**Refined UX:** Default to confirm-all for the first model (trust must be earned). After the first successful model creation, switch to auto-accept-high-confidence with a summary: "Auto-accepted 12 high-confidence components from Terraform/K8s declarations. Presenting 5 medium/low-confidence items for review." This respects human-in-the-loop for new users while removing unnecessary friction for returning users.

**Note:** Plugin-specific configuration like `auto_accept_high_confidence` should be stored in `${CLAUDE_PLUGIN_DATA}/config.json`, not in `settings.json` (which only supports the `agent` key).

**Status: Resolved**

---

### D3: Offline-First Support

**Context:** Should the plugin require a platform connection for model creation, or support offline-first with sync later?

**Options:**
- (a) Require platform connection for class queries and model creation
- (b) Cache class definitions locally (24h TTL), create models offline, sync when ready

**Recommendation:** (b) Offline-first. Many developers work in environments without constant platform access. Cache class definitions, templates, and guides locally. Resolve class IDs at sync time if working with cached names.

**Edge cases to address:**
- Cache key must include the platform URL to prevent cross-instance class contamination
- Class resolution at sync time should use `(moduleName, className)` tuple, not just `className` (class names may not be unique across modules)
- Store `moduleVersion` in the cache and invalidate when the platform's module version differs
- If cached class IDs are stale, import will fail with "class not found" — this is the correct behavior; user should re-run classification with fresh class data

**Status: Resolved**

---

### D4: MITRE Data Caching

**Context:** Should the plugin cache MITRE ATT&CK/D3FEND data locally for offline use?

**Options:**
- (a) Always query platform for MITRE lookups
- (b) Cache full MITRE dataset locally (~700+ techniques)
- (c) Cache tactic names only (14 items) for conversational reference

**Recommendation:** (c) Cache only the 14 tactic names for conversation. Including the full technique catalog risks hallucination through approximate matching. All technique-level references must come from the platform's verified graph database. Cache invalidates when `mitre-frameworks` module version changes.

**Status: Resolved**

---

### D5: Quality Gate Enforcement

**Context:** When should quality gates block the user vs. just warn?

**Options:**
- (a) Advisory only -- always allow operations
- (b) Advisory during creation, blocking before sync and analysis
- (c) Strict -- blocking at all stages

**Recommendation:** (b) Progressive strictness. During conversational creation, show inline warnings. Before sync/import, require structural validity. Before analysis, require classification and attribute completion thresholds.

**Status: Resolved**

---

### D6: Default Action After Model Creation

**Context:** When `/dethereal:start` finishes, should the default be to import to the platform or save locally?

**Options:**
- (a) Import to platform (requires auth)
- (b) Save to local files

**Recommendation:** Context-dependent. If the user is authenticated and connected, default to import. If not, default to local save. First-time users always get local save as default (non-destructive, allows review).

**Status: Resolved**

---

### D7: File Naming Convention

**Context:** Attribute files are currently named by UUID only (`550e8400-...json`). Should they include a human-readable prefix?

**Options:**
- (a) UUID-only (current behavior)
- (b) `{slug}__{short-uuid}.json` (e.g., `nodejs-api__550e8400.json`)

**Recommendation:** (b) Slug prefix improves filesystem browsing. The full UUID remains in the file content for authoritative reference. Slugs are generated from element names at write time.

**Risk:** Name changes create filename drift. Mitigated by using element ID (not slug) for all references.

**Status: Resolved**

---

### D8: YAML Support

**Context:** Should the plugin support YAML as an alternative to JSON for model files?

**Options:**
- (a) YAML as canonical format on disk
- (b) JSON canonical, YAML rendering in terminal via `/dethereal:view`
- (c) JSON only

**Recommendation:** (b) JSON canonical, YAML for viewing. YAML on disk creates a second source of truth and introduces parser dependency. The plugin's `/dethereal:view` skill can render any model file as formatted YAML in the terminal for human inspection.

**Design intent:** Users should edit models via the plugin's conversational interface or skills, not by hand-editing JSON. The JSON format is optimized for machine readability and git diffability, not human editing. For inspection, `/dethereal:view` provides formatted summaries. For CI/CD scripting, `--json` output is available. If hand-editing becomes a common workflow pattern, revisit YAML as canonical format.

**Status: Resolved**

---

### D9: Skill Routing

**Context:** Should there be a single `/dethereal` router command, or separate skills for each action?

**Options:**
- (a) Single `/dethereal` that routes to sub-commands
- (b) Separate skills (`/dethereal:create`, `/dethereal:sync`, etc.)

**Recommendation:** (b) Separate skills. Tab completion works per-skill. Each skill has its own `argument-hint`. No extra navigation step. Users invoke help via `/dethereal:help`. The bare `/dethereal` invocation is not supported by the plugin system.

**Status: Resolved**

---

### D10: Default Agent Setting

**Context:** Should the plugin's `settings.json` set `threat-modeler` as the default agent?

**Options:**
- (a) Set `threat-modeler` as default -- specialized context always active
- (b) No default agent -- rely on skill invocations to route to the right agent

**Recommendation:** (a) Set `threat-modeler` as default. The plugin is installed for threat modeling; making the specialized agent the default thread is the expected behavior. Users switch agents via `@infrastructure-scout` etc. If the plugin is one of several, the user can override in project settings.

**Status: Resolved**

---

### D11: Analysis Chat via MCP

**Context:** The platform supports interactive analysis chat (`startChat`/`resumeAnalysis`). Should this be exposed via MCP?

**Options:**
- (a) MCP tools returning session IDs with subsequent polling calls
- (b) Platform-UI-only (Claude agent provides its own analysis from results data)
- (c) Dedicated `analysis-chat` subagent managing session state

**Recommendation:** Defer to post-v1. The primary plugin scope is data flow model creation. Analysis tools (`manage_analyses`) should support triggering and polling results, but interactive chat is complex and may not add value beyond the platform UI's native experience.

**Status: Resolved**

---

### D12: Guided Workflow Model Selection

**Context:** Should `/dethereal:threat-model` hardcode `model: opus` or use `inherit`?

**Recommendation:** `inherit`. Let the user choose their model. The skill works with any capable model; forcing opus limits flexibility and increases cost.

**Status: Resolved**

---

### D13: Agent Invocation Pattern

**Context:** Should skills invoke agents via `agent` frontmatter or via `Agent()` tool calls?

**Recommendation:** `agent` frontmatter for initial implementation. Simpler, the skill body becomes the agent's prompt. `Agent()` tool calls offer more control but add complexity. Evaluate switching for specific skills that need multi-agent orchestration.

**Clarification:** `agent` frontmatter is appropriate for single-agent skills (e.g., `/dethereal:discover` → `infrastructure-scout`, `/dethereal:review` → `model-reviewer`). For `/dethereal:threat-model`, which orchestrates a multi-agent pipeline (discovery → modeling → enrichment → review), the `threat-modeler` agent must use `Agent()` tool calls to delegate phases to `infrastructure-scout`, `security-enricher`, and `model-reviewer`. This is the one skill where `agent` frontmatter alone is insufficient.

Updated recommendation: `agent` frontmatter for single-agent skills; `Agent()` tool calls within the `threat-modeler` agent for multi-agent orchestration in `/dethereal:threat-model`.

**Status: Resolved**

---

### D14: Discovery Confidence Storage

**Context:** Where should discovery confidence metadata be stored?

**Options:**
- (a) Component description field (simple, works today)
- (b) Custom attribute in class template (structured, queryable, requires schema changes)
- (c) Split-file metadata in `<model-path>/.dethereal/discovery.json` (separate from model data)

**Recommendation:** (c) for v1. Keeps plugin metadata separate from model data that syncs to the platform. Clear path to (b) later if structured confidence becomes an analysis input.

> **Note:** Path updated per D27 resolution — discovery metadata lives in `<model-path>/.dethereal/`, not `.dethernety/`.

**Status: Resolved**

---

### D15: Model Co-Location

**Context:** Should threat model files live in the application repo or a separate repo?

**Recommendation:** Co-locate model files in visible paths within the project repo. `.dethernety/` stores plugin metadata only. See D27 for the resolved directory structure.

> **Note:** Superseded by D27, which resolved that models live at user-chosen visible paths (e.g., `./threat-models/production-stack/`), not inside `.dethernety/`.

Improves developer adoption and keeps model changes in the same review cycle as code changes. Use `.gitattributes` to collapse model diffs in PRs if they become noisy.

**Status: Resolved** (superseded by D27)

---

### D16: Scope Template Format

**Context:** Should scope definitions be structured fields or freeform text?

**Recommendation:** Structured fields: `system_name`, `description`, `depth`, `compliance_drivers`, `crown_jewels`, `exclusions`. Keeps downstream phases deterministic. The plugin still accepts natural language and converts to structured format.

**Status: Resolved**

---

### D17: Data Items Required Scope

**Context:** Should data items be required on every data flow, or only on specific flows?

**Recommendation:** Required only on flows crossing trust boundaries or touching crown jewels. Warning (not blocking) when other flows lack data items. Reduces user burden while maintaining analysis value.

**Status: Resolved**

---

### D18: Multi-System Sessions

**Context:** Should the plugin support modeling multiple systems in one session?

**Recommendation:** One system per session with explicit cross-references via `representedModel`. Multi-system modeling creates scope creep and reduces model quality.

**Monorepo clarification:** In monorepo environments (where a single Claude Code session covers the entire repository), "one system per session" means one *active* model per skill invocation, not one per session lifetime. The user can switch between models within a session:

```
User: /dethereal:status

Plugin: Local models found:
  1. ./frontend/threat-model/    "Frontend App"     (72% quality)
  2. ./backend/threat-model/     "API Service"      (45% quality)

Active: none. Use /dethereal:enrich ./frontend/threat-model/ to work on a model.
```

Cross-model references use `representedModel` to link components across system boundaries.

**Status: Resolved**

---

### D19: Auth-Disabled Mode Documentation

**Context:** The MCP server already supports auth-disabled mode internally. Should it be explicitly documented and supported for the plugin?

**Recommendation:** Yes. Explicitly document `DETHERNETY_AUTH_DISABLED=true` (or platform-detected) for development and demo instances. The `/dethereal:status` command should display auth-disabled state clearly.

**Status: Resolved**

---

## Resolved Decisions (Mapping vs. Analysis Boundary)

> The following decisions were resolved through multi-agent architectural review (Security Architect, Threat Modeler, Security Operations Reviewer) with full Analysis Engine V2 context. The unifying principle: **the plugin maps, the engine analyzes.** The plugin produces structural model data (components, boundaries, flows, attributes, credentials, classifications). Analysis modules consume that model to produce evaluative outputs (exposures, crown jewel rankings, attack paths, findings). This boundary also maps to the OSS/platform-module separation.

---

### D20: Threat Actor Modeling in Scope

**Context:** The workflow never asks users to define threat actors. Without this, MITRE technique relevance is ungrounded and exposure prioritization has no attacker-capability context.

**Options:**
- (a) Add threat actors to Phase 1 scope template (type, capability, access position, motivation)
- (b) Defer to post-v1
- (c) Add as optional field -- present for "security review" and "incident prep" intents, skip for "quick triage"

**Decision: (c) Optional by intent, lightweight.**

**Rationale:** Threat actor specification belongs to the analysis engine, not the mapping plugin. The Analysis Engine V2 has a full `ThreatActorSpec` schema with `skill_level`, `access_position`, `resource_budget`, `persistence`, `stealth_priority`, and `entry_points`. Its scope agent generates threat actors during its own SCOPING phase from the model graph -- it does not expect actors as input from the plugin.

However, adversary *class selection* is a mapping concern: it guides *what gets modeled*. Selecting "insider" means the plugin should prompt for admin paths and credential flows. Selecting "supply_chain" means prompting for CI/CD and dependency chains.

**Implementation:** Add `adversary_classes: string[]` to the scope template, prompted only for `security_review` and `incident_response` intents (see `ScopeDefinition` interface in THREAT_MODELING_WORKFLOW.md Phase 1). Options: `external`, `insider`, `supply_chain`. Not a quality gate input. Not the full `ThreatActorSpec` -- just a scoping hint that passes through to the Analysis Engine.

**Boundary:** Adversary *class selection* = mapping concern (plugin/OSS). Full *threat actor specification* = analysis concern (platform analysis modules).

**Risk if wrong:** Omitting entirely (b) causes the plugin to systematically under-model insider and supply chain scenarios. Including full actor specs (a) duplicates the analysis engine's capability and couples the plugin to the engine's schema.

**Status: Resolved**

---

### D21: Crown Jewel Operationalization

**Context:** Crown jewels are declared as free text in scope but never linked to actual component IDs. Quality gates reference them but can't evaluate programmatically.

**Options:**
- (a) Full structured schema with component_ref, data_sensitivity, business_impact_category, priority ranking
- (b) Lightweight: `crown_jewel: boolean` and `asset_criticality: high|medium|low` as component attributes
- (c) Defer linking -- keep crown jewels in scope text, manually verify during review

**Decision: (b) Lightweight component attributes. Unanimous across all three reviewers.**

**Rationale:** The Analysis Engine V2 performs **semi-automatic crown jewel identification** using `CJ(v) = 0.45 * data_sensitivity + 0.25 * pagerank + 0.15 * in_degree + 0.15 * control_density`. The engine *computes* crown jewels from graph-structural signals -- it does not expect a pre-built `CrownJewel` schema as input. What it needs from the model is raw signals: `data_sensitivity` labels on components, data items with sensitivity classifications, and control assignments.

Option (a) duplicates the engine's `CrownJewel` TypedDict and encroaches on analysis territory. The plugin should provide the inputs, not the computation.

**Implementation:**
- Add `asset_criticality: "high" | "medium" | "low"` as a component attribute (already required by Operational Requirements)
- Add `crown_jewel: boolean` as a component attribute (enables programmatic quality gate evaluation)
- During Phase 7 enrichment, map free-text crown jewels from scope to actual components: "You named 'Payment Database' as a crown jewel. I found component 'payment-db'. Confirming mapping and setting `asset_criticality` to 'high'."
- Data sensitivity labels on data items (Phase 6) feed the engine's 0.45 weight automatically

**Boundary:** Crown jewel *designation* = mapping concern (plugin/OSS). Crown jewel *scoring, ranking, impact analysis* = analysis concern (platform analysis modules).

**Risk if wrong:** Option (a) creates a parallel data structure that the engine ignores or must reconcile. Option (c) leaves quality gates unevaluable.

**Status: Resolved**

---

### D22: Credential Scope Data Structure

**Context:** Lateral movement modeling requires knowing the blast radius of credentials. Currently captured only in conversation, not structurally.

**Options:**
- (a) New `credentials.json` file with credential-to-component mappings
- (b) Capture credential scope as data flow and component attributes
- (c) Both

**Decision: (b) Data flow and component attributes. Unanimous across all three reviewers.**

**Rationale:** The Analysis Engine V2's lateral movement model reads `required_credentials` on edges and `stores_credentials`/`credential_scope` on nodes -- these are graph-native properties, not external files. A separate `credentials.json` would require a translation layer, introduce drift risk, and add a primitive with no graph database representation.

Without credential data, the engine's `can_traverse` function never gates on credentials and all paths appear equally traversable -- the analysis degenerates to BFS reachability, losing the core insight of credential-based lateral movement.

**Implementation:**

On data flows (enrichment phase, cross-boundary flows):
- `credential_type: "service_account" | "api_key" | "oauth_token" | "ssh_key" | "certificate" | "password" | "none"`
- `credential_name: string` (label, e.g., "db-service-account")
- `credential_scope: string[]` (machine-comparable identifiers for what else this credential accesses)

On components (stores identified as credential repositories):
- `stores_credentials: boolean`
- `credential_scope: string[]` (credentials yielded when compromised)

Enrichment prompt: "What credential is used for this data flow? What else can that credential access? I'll label this as '{scope}' -- does any other flow use the same credential?"

**Boundary:** Credential *topology capture* = mapping concern (plugin/OSS). Credential *accumulation, traversal, blast radius computation* = analysis concern (platform analysis modules).

**Risk if wrong:** Option (a) creates a sidecar file outside the graph model that the engine cannot query natively. Missing credential data entirely means lateral movement analysis degenerates to undifferentiated BFS.

**Status: Resolved**

---

### D23: Quality Score Formula

**Context:** Current formula weights MITRE mapping at 5%, has no crown jewel weight, and uses a single profile for all use cases. The Analysis Engine V2 has its own `model_completeness` score.

**Options:**
- (a) Single formula with restructured weights
- (b) Use-case-specific weight profiles
- (c) Keep current formula, calibrate with real models before changing

**Decision: (c) Keep current formula, calibrate with real models. Add alignment documentation.**

**Rationale:** The plugin's quality score and the Analysis Engine V2's `model_completeness` score measure **different things** and should remain independent:

- Plugin score = "is this model structurally complete?" (mapping concern)
- Engine score = "does this model have enough data for confident analysis?" (analysis concern, includes dimensions like `components_with_exposures` that the plugin cannot compute)

Changing weights without empirical data is "guessing differently, not improving." Build 5-10 reference models with known quality levels, run the formula, see where it diverges from human judgment, and adjust.

**Note:** One concrete change to evaluate: replacing `mitre_mapping_rate` (5%) with `credential_coverage` (% of cross-boundary flows with `credential_type` set). MITRE mapping is an analysis enrichment; the plugin explicitly says it should not fabricate MITRE IDs. Credential coverage is a mapping completeness signal that directly improves analysis quality.

**Alignment documentation:** Add a mapping between plugin quality score ranges and engine readiness levels so users understand how their modeling effort translates to analysis confidence.

| Plugin Score | Engine Readiness | Meaning |
|---|---|---|
| 0-39 (Starting) | Low confidence | Analysis will produce mostly theoretical findings |
| 40-69 (In Progress) | Medium confidence | Analysis is useful but will have data gaps |
| 70-89 (Good) | High confidence | Analysis will produce grounded findings |
| 90-100 (Comprehensive) | High confidence | Full coverage analysis |

**Boundary:** Plugin quality score = mapping concern. Engine readiness score = analysis concern. They should be displayed side-by-side, not merged.

**Risk if wrong:** Restructuring weights without data produces a different but not better score. Use-case profiles add configuration complexity without demonstrated need.

**Status: Resolved**

---

### D24: `search_mitre_defend` API Gap

**Context:** The `DtMitreDefend` class in dt-core has no text search method -- only `fetchTactics()`, `getTechniquesByTactic()`, `getTechnique()`. The `search_mitre_defend` tool cannot be implemented as specified.

**Options:**
- (a) Add `findMitreDefendTechniques` to dt-core (requires backend GraphQL query)
- (b) Rename tool to `get_mitre_defend` with actions matching available API
- (c) Client-side text search over fetched techniques

**Decision: (b) Rename to `get_mitre_defend` for v1. Evaluate (a) as a fast-follow.**

**Rationale:** The Analysis Engine V2 uses semantic vector search (PostgreSQL pgvector) for D3FEND -- a platform analysis module capability that leverages infrastructure not available in the OSS plugin context. Naming the OSS tool `search_mitre_defend` implies a search capability that only exists in platform analysis modules.

The plugin's D3FEND use case during enrichment is narrower: browse by tactic, look up by known ID. Countermeasure *recommendation* (which requires search) is an analysis concern handled by the engine's `search_defend_techniques` tool.

**Implementation:** Rename to `get_mitre_defend` with input:
```
{ action: 'tactics' | 'techniques_by_tactic' | 'technique', tactic_id?: string, d3fend_id?: string }
```

Adding `findMitreDefendTechniques` to dt-core (mirroring the ATT&CK pattern) is a worthwhile fast-follow that benefits both OSS and platform analysis modules. Low effort, matching existing pattern.

**Boundary:** D3FEND *browsing* during enrichment = mapping concern (plugin/OSS). D3FEND *semantic search* for gap analysis = analysis concern (platform analysis modules).

**Risk if wrong:** Keeping the name "search" implies capability that doesn't exist. Client-side search (c) violates the "query the platform's verified database" principle.

**Status: Resolved**

---

### D25: `manage_exposures` CRUD Scope

**Context:** The tool provides full CRUD, but the workflow says "exposures are computed by the platform, not by the plugin."

**Options:**
- (a) Keep full CRUD in schema for future use
- (b) Remove create/update/delete entirely from v1 spec
- (c) Mark create/update/delete as analysis module features

**Decision: (c) Mark CUD as analysis module features. List/Get only in the OSS plugin.**

**Rationale:** Exposures are generated by OPA/Rego policy evaluation on the platform. The analysis engine's evidence chain (`Component -> HAS_EXPOSURE -> Exposure -> EXPLOITED_BY -> Technique`) depends on exposures being authoritative computed signals. Plugin-created exposures would be indistinguishable from platform-evaluated ones, polluting the evidence chain with unverified claims.

Manual exposure entry (e.g., from pentest findings) is a valid future use case, but it belongs in a dedicated import module with explicit `source: "manual"` provenance tagging, not in the mapping plugin.

**Implementation:**
- Plugin v1: `manage_exposures` with `list` and `get` actions only
- After model import, the plugin reads back computed exposures: "12 exposures found on your model. Run analysis for full findings and remediation roadmaps."
- Exposure creation belongs to: (1) platform Rego evaluation (automated), (2) analysis module UI (manual/pentest import), or (3) a future pentest-import module

**Boundary:** Exposure *display* = mapping concern (plugin/OSS). Exposure *computation and creation* = analysis concern (platform modules).

**Risk if wrong:** Keeping full CRUD (a) leaves a loaded footgun -- users or integrations may create unverified exposures. The analysis engine cannot distinguish verified vs. asserted exposures, corrupting defense coverage gap analysis.

**Status: Resolved**

---

### D26: `search_mitre_attack` Input Schema Design

**Context:** The `DtMitreAttack` API supports both `findMitreAttackTechniques` (GraphQL filter) and `getMitreAttackTechnique` (by ATT&CK ID). How should the MCP tool's input schema expose these capabilities?

**Options:**
- (a) Action-based schema only (like `get_mitre_defend`)
- (b) Free-text translation only (agent describes what it wants, tool translates)
- (c) Hybrid -- both free-text `search` and direct `attack_id` lookup

**Decision: (c) Hybrid -- both free-text search and direct ID lookup.**

**Rationale:** The underlying `DtMitreAttack` API supports both `findMitreAttackTechniques` (GraphQL filter) and `getMitreAttackTechnique` (by ATT&CK ID). A hybrid schema exposes both: free-text `search` for agent-friendly browsing (MCP tool translates to GraphQL name filter internally) and `attack_id` for direct ID validation (confirming a technique exists before annotating). Consistent with `get_mitre_defend` action-based pattern (D24) while adding search capability that the ATT&CK API supports (unlike D3FEND). Results capped at 20; agent refines if more exist.

**Boundary:** Mapping concern -- reference data browsing.

**Risk if wrong:** Low -- schema can be extended without breaking changes.

**Status: Resolved**

---

### D27: Model Directory Structure

**Context:** Where should threat model files live on disk, and how should the `.dethernety/` directory be used?

**Options:**
- (a) `.dethernety/<model-name>/` with `.meta/` inside
- (b) `.dethernety/` as single model per project
- (c) Models at user-chosen visible paths, `.dethernety/` as plugin metadata only

**Decision: (c) User-chosen visible paths.**

**Rationale:** Users should see and version-control their threat model files alongside code. Hidden directories are appropriate for plugin metadata and caches but not for model data. Enables flexible project structures (monorepo models per service, co-located models). `.dethernety/` at project root stores plugin metadata (model registry in `models.json`, plugin config in `config.json`). Per-model metadata (workflow state, discovery cache, quality scores) lives in `<model-path>/.dethereal/`.

**Boundary:** Plugin structure concern.

**Risk if wrong:** Medium -- directory structure is hard to change after adoption. Mitigated by model registry in `.dethernety/models.json` which can track moves.

**Status: Resolved**

---

### D28: `manage_countermeasures` Schema Scope

**Context:** Countermeasures are core mapping artifacts documenting existing controls. Should the MCP tool expose the full `DtCountermeasure` API or provide a simplified schema?

**Options:**
- (a) Expand to match full DtCountermeasure API
- (b) Provide defaults for missing fields
- (c) Defer to analysis module

**Decision: (a) Expand schema.**

**Rationale:** Countermeasures are core mapping artifacts -- they document "what controls exist." Unlike exposures (analysis outputs, D25), countermeasures are user-asserted facts about infrastructure. Full schema including `type`, `category`, `score`, `exposure_ids`, `defend_technique_ids`, `mitigations`, and `references` gives complete control documentation capability. Sensible defaults where practical (score defaults to 50).

**Boundary:** Mapping concern -- control documentation.

**Risk if wrong:** Low -- extra fields can be optional; simpler to have them available than to add later.

**Status: Resolved**

---

### D29: State Machine Invalidation Granularity

**Context:** When a user adds new elements to a model that has already progressed through workflow phases, should the state machine selectively invalidate only affected elements or blanket-revert to an earlier state?

**Options:**
- (a) Keep blanket revert with better UX messaging
- (b) Selective invalidation (only new elements)
- (c) Additive-only exception

**Decision: (a) Blanket revert with better UX.**

**Rationale:** Selective invalidation is technically superior but adds significant implementation complexity for an infrequent scenario. Blanket revert maintains model integrity guarantees: every element at a given state has been through all prior phases. The cost is manageable with clear UX -- a detailed warning showing what was preserved (enrichment on existing elements), what needs attention (new elements), and commands to bring new elements up to the same state.

**Boundary:** Plugin UX concern.

**Risk if wrong:** Medium -- user frustration if reverts are more frequent than expected. Monitor and reconsider selective invalidation for V1.1 if users report issues.

**Status: Resolved**

---

### D30: STRIDE-to-ATT&CK Enrichment Boundary

**Context:** The enrichment workflow includes a STRIDE-to-ATT&CK mapping step that systematically evaluates each component against relevant ATT&CK techniques. Is this a mapping or analysis concern?

**Options:**
- (a) Keep systematic evaluation in plugin
- (b) Move entirely to analysis modules
- (c) Narrow to user-initiated browsing

**Decision: (c) Narrow to user-initiated browsing.**

**Rationale:** Systematic STRIDE-to-ATT&CK mapping evaluates "what threatens this component" -- an analysis concern. The plugin's job is mapping: capture security attributes so analysis modules can generate findings. The STRIDE mapping table remains as reference for users who want to browse relevant techniques, but the enrichment workflow does not systematically run every component through STRIDE-to-ATT&CK queries. This keeps the mapping/analysis boundary clean and avoids the plugin making unverified threat assertions.

**Boundary:** Analysis concern moved out of plugin.

**Risk if wrong:** Low -- users can still browse MITRE on demand. If demand for in-plugin systematic mapping is high, it can be re-added as an opt-in enrichment step.

**Status: Resolved**

---

### D31: `/dethereal:surface` Skill Scope

**Context:** The `/dethereal:surface` skill provides an attack surface summary. How much analysis should it include beyond structural queries?

**Options:**
- (a) Structural query only (internet-facing components, cross-boundary flows)
- (b) Light analysis (structural + control gaps)
- (c) Full summary (structural + control gaps + exposure counts)

**Decision: (c) Full summary.**

**Rationale:** Attack surface summary is the most common quick check for security engineers. Structural-only feels incomplete. Full summary combines: structural data (internet-facing components, cross-boundary flows), control gap identification (missing TLS, missing auth -- derived from attribute presence, not analysis), and exposure counts from the platform (read from synced data, not computed). Control gaps are mapping-derived (checking attribute presence), staying within the mapping boundary.

**Boundary:** Mapping concern (structural + attribute checks) + read-only platform data.

**Risk if wrong:** Low -- scope only adds read operations, never generates findings.

**Status: Resolved**

---

### D32: Platform Feature Adoption

**Context:** Claude Code's plugin platform offers several features (effort, maxTurns, context forking, memory, background tasks, notifications, elicitation, channels). Which should be adopted for v1?

**Options:** 8 Claude Code platform features evaluated individually.

**Decision: Phased adoption based on benefit vs. implementation effort.**

**Rationale:** Claude Code's plugin platform offers features that improve cost control, safety, and user experience. Phased adoption ensures V1 ships with highest-impact features. Priority assessment: V1 (High priority) -- `effort`, `maxTurns`, `context: fork`, `memory: project`; V1.1 (Medium priority) -- `background`, `Notification` hook; V2 (Low priority) -- `Elicitation` hook, Plugin channels.

**Boundary:** Plugin infrastructure concern.

**Risk if wrong:** Low -- features are additive and individually toggleable.

**Implementation:** See PLUGIN_ARCHITECTURE.md "Platform Feature Adoption" section for full priority table.

**Status: Resolved**

---

### D33: Skill Frontmatter Documentation

**Context:** PLUGIN_ARCHITECTURE.md showed agent frontmatter for all 4 agents but no skill frontmatter. Skill fields like `context: fork`, `agent: threat-modeler`, `user-invocable`, `disable-model-invocation`, and `argument-hint` were mentioned in prose but never shown concretely, making the spec unimplementable for skills.

**Options:**
- (a) Add full frontmatter blocks for ~5 key skills
- (b) Keep as-is — skill frontmatter defined during implementation
- (c) Add a summary table of skill frontmatter fields for all 19 skills

**Decision: (c) Summary table.**

**Rationale:** A summary table provides implementable specificity for all skills without the bulk of 19 separate YAML blocks. The table captures the key differentiating fields (`agent`, `context`, `effort`, `argument-hint`, `disable-model-invocation`) in a scannable format. Full frontmatter blocks will emerge naturally during implementation.

**Boundary:** Plugin structure concern.

**Risk if wrong:** Low — table can be expanded to full blocks if needed.

**Status: Resolved**

---

### D34: Board-Ready Statement Accept Affordance

**Context:** The board-ready statement pattern used `accept/edit/skip` as interaction options for an AI-generated executive summary. Single-word "accept" for AI-generated content is a dark pattern risk — it makes uncritical acceptance the easiest action.

**Options:**
- (a) Change to `'edit' (recommended)`, `'use as-is' (confirm you have reviewed it)`, `'skip'`
- (b) Keep `accept/edit/skip` with existing "DRAFT — AI-generated" label
- (c) Change to `'review and accept'`, `'edit'`, `'skip'`

**Decision: (a) Edit as recommended action.**

**Rationale:** The extra friction of typing "use as-is" and seeing "(confirm you have reviewed it)" makes acceptance a deliberate act rather than a reflexive one. This follows the same pattern as security confirmation dialogs — never make the potentially dangerous action the easiest one. The "DRAFT — AI-generated" label is necessary but not sufficient; the affordance design must reinforce the review intent.

**Boundary:** UX trust concern.

**Risk if wrong:** Low — if the friction proves excessive, it can be relaxed. Easier to start strict than to tighten later.

**Status: Resolved**

---

### D35: Phase Count Reconciliation

**Context:** Four different numbering schemes existed across documents with no explicit mapping: 7 methodology phases (THREAT_MODELING_WORKFLOW), 8 state machine states, 9 UX resume steps (USER_EXPERIENCE), and 10 guided workflow steps (PLUGIN_ARCHITECTURE). This caused alignment confusion for implementers.

**Options:**
- (a) Add explicit mapping table showing relationships
- (b) Reconcile to a single numbering — align UX resume to 10 guided steps
- (c) Both

**Decision: (c) Both — mapping table and aligned UX resume.**

**Rationale:** The different numbering schemes serve different purposes (analytical framework, maturity tracking, user-facing sequence) and should coexist with an explicit mapping. The UX resume display was aligned to the 10 guided workflow steps from PLUGIN_ARCHITECTURE.md for consistency. The mapping table in THREAT_MODELING_WORKFLOW.md documents how methodology phases, guided workflow steps, and state machine states relate, noting that classification occurs after boundary placement in the UX flow (for better user experience) despite being Phase 3 in the methodology.

**Boundary:** Documentation clarity concern.

**Risk if wrong:** Low — mapping table is purely additive.

**Status: Resolved**

---

### D36: Redundant `disallowedTools` on Agents with `tools` Allowlist

**Context:** The `infrastructure-scout` and `model-reviewer` agents had both a `tools` allowlist and a `disallowedTools` denylist. When `tools` is specified in Claude Code agent frontmatter, only those tools are available — `disallowedTools` is redundant.

**Options:**
- (a) Remove `disallowedTools` — the `tools` allowlist is sufficient
- (b) Keep as defense-in-depth with a comment
- (c) Remove from frontmatter but document the restriction in agent body

**Decision: (a) Remove redundant `disallowedTools`.**

**Rationale:** The `tools` allowlist is the primary and sufficient restriction mechanism. Redundant `disallowedTools` creates a maintenance burden (two lists to update) and implies that the `tools` field alone is insufficient, which is incorrect. The restriction intent is documented in the agent body text ("read-only" descriptions) and in the `tools` list itself.

**Boundary:** Plugin structure concern.

**Risk if wrong:** Negligible — the `tools` allowlist provides equivalent protection.

**Status: Resolved**

---

### D37: Coverage Estimate in Board-Ready Statement

**Context:** The board-ready statement included `coverage_estimate: ~85%` with no defined methodology for computing the denominator. The same document warned against false precision ("Never present '73.2% probability' when based on incomplete data").

**Options:**
- (a) Replace percentage with qualitative framing (component counts + known gaps)
- (b) Keep percentage but add methodology note
- (c) Remove coverage estimate entirely

**Decision: (a) Qualitative framing.**

**Rationale:** The total infrastructure denominator is unknowable at model time — "~85%" is inherently unverifiable. Qualitative framing ("10 code-analyzed components + 2 manual, 3 known gaps") is honest, verifiable, and more useful to a board member. It also includes the discovery basis ("code-time analysis only; runtime validation recommended"), which is critical context for executive communication. This aligns with the document's own false-precision warning.

**Boundary:** UX trust concern.

**Risk if wrong:** Low — if quantitative coverage becomes computable (e.g., via cloud asset inventory comparison), it can be added alongside the qualitative basis.

**Status: Resolved**

---

### D38: Scope Template Schema

**Context:** The scope is the most referenced data structure across all phases but had no concrete definition — only prose listing field names without types or required/optional annotations.

**Decision: Add TypeScript interface to THREAT_MODELING_WORKFLOW.md Phase 1.**

**Rationale:** A concrete `ScopeDefinition` interface follows the same pattern as `DiscoveredElement` (Phase 2) and `state.json` (state machine). It makes the spec implementable without guessing field types. The interface includes all fields from D16 and D20: `system_name`, `description`, `depth`, `modeling_intent`, `compliance_drivers`, `crown_jewels`, `exclusions`, and optional `adversary_classes`.

**Boundary:** Plugin structure concern.

**Risk if wrong:** Low — interface can be extended during implementation.

**Status: Resolved**

---

### D39: Undo Mechanism Scope

**Context:** `/dethereal:undo` was specified as a skill but the implementation mechanism was never defined — no snapshot creation, storage, retention, or relationship to state machine backward transitions.

**Options:**
- (a) Specify fully: snapshots in `<model-path>/.dethereal/snapshots/`, taken before each mutating skill
- (b) Defer to V1.1 — document as planned
- (c) Remove from V1 skill list — git provides undo for versioned model files

**Decision: (c) Remove from V1.**

**Rationale:** Model files live at user-chosen visible paths and are committed to version control (D27). Git provides robust undo (`git checkout`, `git stash`, `git diff`) for versioned files. Adding a parallel snapshot mechanism introduces complexity and storage management without clear advantage over git. The state machine's backward transitions (D29) handle workflow-level undo (reverting to earlier methodology states).

**Implementation:** Removed `/dethereal:undo` from skill list, directory layout, help output, and frontmatter table. State machine backward transitions remain as the workflow-level undo mechanism. If user demand for file-level undo outside git emerges, re-evaluate for V1.1.

**Boundary:** Plugin scope concern.

**Risk if wrong:** Low — git undo is sufficient for version-controlled files.

**Status: Resolved**

---

### D40: Sync Conflict Metadata

**Context:** The sync UX shows rich conflict resolution (field-level comparison, local/platform/merge options) but the implementation mechanism was never specified — no sync timestamps, version tracking, or diffing strategy.

**Decision: Defer sync implementation details to V1.1.**

**Rationale:** The sync UX specification is aspirational for V1 — describing the target interaction pattern. The core V1 sync capability is push (import) and pull (export), which are already implemented via existing MCP tools. Full bidirectional sync with conflict detection requires sync metadata (`last_sync_at`, `platform_version`, `local_hash`), a diffing strategy, and merge logic. This is significant implementation work that should be designed alongside the actual implementation, not in architecture docs.

**Boundary:** Plugin infrastructure concern.

**Risk if wrong:** Medium — sync is a core user workflow. Mitigated by V1 push/pull being fully functional.

**Status: Resolved**

---

### D41: Crown Jewel Gate Timing

**Context:** Phase 3 quality gate required crown jewel components to be classified with `asset_criticality` set, but D21 specified crown jewel mapping during Phase 7 enrichment — the gate couldn't evaluate at the time it ran.

**Options:**
- (a) Split: lightweight `crown_jewel: true` tagging in Phase 3 (name matching from scope), full `asset_criticality` in Phase 7
- (b) Move the crown jewel gate check entirely to Phase 7

**Decision: (a) Split tagging across phases.**

**Rationale:** The analysis module will also identify crown jewels via graph-structural scoring (`CJ(v) = 0.45 * data_sensitivity + ...`). The plugin's job is lightweight identification — matching scope-declared crown jewel names to discovered components and setting a boolean flag. This enables the Phase 3 quality gate to evaluate ("are crown jewel candidates tagged?") without requiring the full `asset_criticality` enrichment that belongs in Phase 7.

**Boundary:** Mapping concern — crown jewel designation is a lightweight input, not analysis.

**Risk if wrong:** Low — lightweight tagging is additive and does not conflict with Phase 7 enrichment.

**Status: Resolved**

---

### D42: State-Aware Help and Status Footer

**Context:** 18 skills with static help is a wall of text. No ambient progress between individual skill invocations — users must run `/dethereal:status` explicitly to know where they are.

**Options:**
- (a) State-aware help + universal post-action status footer
- (b) State-aware help only
- (c) Keep static help, add footer only

**Decision: (a) Both — state-aware help and universal post-action footer.**

**Rationale:** Decided based on LLM token efficiency. State-aware help produces a shorter response than dumping 18 commands (shows 2-3 relevant ones based on model state). The post-action footer (quality delta + next-step suggestion) preempts the "what should I do next?" follow-up turn, saving a full round-trip. Both reduce total token consumption.

**Implementation:**
- `/dethereal:help` shows "Suggested now" section based on model state, read from `.dethernety/models.json` and `<model-path>/.dethereal/quality.json`
- Every mutating skill ends with a 2-line footer: `[done] Action complete. Quality: X -> Y/100.` and `[next] /dethereal:foo (reason) or /dethereal:bar`

**Boundary:** UX concern.

**Risk if wrong:** Low — reduces token usage. If the footer proves noisy, it can be suppressed via verbosity settings.

**Status: Resolved**

---

### D43: Enrichment Prioritization

**Context:** Phase 7 enrichment asks users to populate six security attributes per component. For a model with 12 components, that is 72 attribute decisions — the point where threat modeling workshops traditionally stall.

**Options:**
- (a) Tier-based: crown jewels → cross-boundary → internet-facing → internal, with option to stop after tier 1
- (b) Keep sequential (order by component name or discovery order)

**Decision: (a) Tier-based enrichment.**

**Rationale:** Prioritizing by security impact (crown jewels first) ensures the highest-value enrichment happens even if the user stops early. Tier 1 (crown jewels) produces the minimum enrichment for meaningful analysis. This mirrors how Wiz and Snyk prioritize remediation by blast radius, not alphabetically. Users retain the option to "enrich all" for comprehensive models.

**Implementation:** Enrichment tiers:
- **Tier 1 — Crown jewels** (must enrich for meaningful analysis)
- **Tier 2 — Cross-boundary components** (trust boundary violations are primary analysis output)
- **Tier 3 — Internet-facing components** (highest attacker accessibility)
- **Tier 4 — Internal-only** (can defer without blocking analysis)

Users choose: `tier1` (quick pass), `all` (comprehensive), or `pick` (manual selection).

**Boundary:** UX concern.

**Risk if wrong:** Low — users can still choose "all" for comprehensive enrichment.

**Status: Resolved**

---

### D44: Skill Consolidation

**Context:** 18 skills had significant overlaps: `/dethereal:start` duplicated `/dethereal:create`, `/dethereal:validate` was a subset of `/dethereal:review`, and `/dethereal:import`+`/dethereal:export` duplicated `/dethereal:sync push`+`pull`. More skills = more agent context, more help output, more user confusion.

**Options:**
- (a) Merge: start→create, validate→review --structure-only, import+export→sync subcommands (18→14)
- (b) Keep 18 skills, document consolidation plan for V1.1
- (c) Partial merge: only import+export→sync subcommands (18→16)

**Decision: (a) Merge to 14 skills.**

**Rationale:** Fewer skills reduces agent context (~200-400 tokens in help output), reduces cognitive load, and eliminates the "which command do I use?" ambiguity. Onboarding mode is detected when no models exist (create becomes context-aware). Structural validation is a flag on review (`--structure-only`). Sync subsumes import/export with `push`/`pull` subcommands matching the git mental model.

**Boundary:** UX + token efficiency.

**Risk if wrong:** Medium — changes user-facing API. But fewer commands is almost always better for discoverability.

**Status: Resolved**

---

### D45: State Machine Simplification

**Context:** The 8-state machine had 3 enrichment sub-states (CLASSIFIED, DATA_ITEMS_MAPPED, ENRICHED) that added state management complexity without user-visible benefit. The quality score (0-100) already provides continuous enrichment progress.

**Options:**
- (a) Derived state from model content — eliminate state.json
- (b) Collapse enrichment sub-states: 8→6 states
- (c) Keep 8 states

**Decision: (b) Collapse to 6 states (INITIALIZED→SCOPE_DEFINED→DISCOVERED→STRUCTURE_COMPLETE→ENRICHING→REVIEWED).**

**Rationale:** Derived state (a) loses the audit trail of human confirmations. But 3 enrichment sub-states add no value since enrichment is iterative and interleaved in practice. The quality score formula captures detailed sub-progress within the single ENRICHING state.

**Boundary:** State machine design.

**Risk if wrong:** Low — quality score already tracks sub-progress.

**Status: Resolved**

---

### D46: Agent Consolidation

**Context:** The infrastructure-scout uses a subset of threat-modeler's tools. Each Agent() delegation creates a new context with system prompt, tool definitions, and handoff overhead.

**Options:**
- (a) Merge scout into threat-modeler (4→3 agents)
- (b) Keep 4 agents
- (c) Keep 4 agents, strip unnecessary tools from scout

**Decision: (c) Keep 4, strip scout.**

**Rationale:** The scout benefits from context isolation — focused scanning instructions don't need modeling guidelines. Removing `get_model_schema` from the scout's tools saves ~4K tokens per discovery session. The biggest token savings come from tool stripping, not agent consolidation.

**Boundary:** Agent architecture + token efficiency.

**Risk if wrong:** Low — scout isolation provides clean separation of concerns.

**Status: Resolved**

---

### D47: Guidelines Splitting

**Context:** `guidelines.md` (~15KB) loaded into threat-modeler on every invocation. ~12KB is layout rules (coordinates, pixels, handles) only relevant during model creation/editing.

**Options:**
- (a) Split into `guidelines-core.md` (~3KB) + `guidelines-layout.md` (~12KB)
- (b) Keep single file
- (c) Split core + layout + modify `get_model_schema` to return layout only

**Decision: (a) Split core + layout.**

**Rationale:** Saves ~3-4K tokens per non-editing invocation. Clean split: structure rules vs. coordinate/pixel details. Editing skills load layout via skill body `@` import.

**Boundary:** Token efficiency.

**Risk if wrong:** Low — saves tokens, clean separation.

**Status: Resolved**

---

### D48: auth_failure_mode Disposition

**Context:** `auth_failure_mode` captured on data flows but Analysis Engine V2 ignores it in `_derive_auth_strength()`. Users provide data nothing consumes. But fail-open is genuinely important metadata.

**Options:**
- (a) Defer capture to V1.1
- (b) Keep capture, add Known Gap callout
- (c) Implement engine mapping now

**Decision: (b) Keep capture with Known Gap.**

**Rationale:** The attribute has documentation value for human review. A Known Gap callout ensures reviewers know the engine doesn't factor this in. Engine implementation deferred to analysis engine work.

**Boundary:** Mapping vs. analysis concern.

**Risk if wrong:** Medium — fail-open flows underweighted in analysis results until engine integration.

**Status: Resolved**

---

### D49: Scope Trust Assumptions

**Context:** ScopeDefinition has `exclusions` (what is not modeled) but no field for trust assumptions (what is assumed secure). Professional threat models need explicit trust statements for auditability.

**Options:**
- (a) Add `trust_assumptions: string[]` to ScopeDefinition
- (b) Defer to V1.1
- (c) Combine into exclusions

**Decision: (a) Add trust_assumptions.**

**Rationale:** Low cost (one field, one prompt), high audit value. Trust assumptions are distinct from exclusions: exclusions = not modeled, trust assumptions = assumed secure. Auditors ask "what did you assume?"

**Boundary:** Scope definition.

**Risk if wrong:** Low — additive field.

**Status: Resolved**

---

### D50: Egress Filtering Attribute

**Context:** Boundaries capture ingress enforcement but not egress filtering. For data exfiltration analysis, egress controls are the critical dimension.

**Options:**
- (a) Add `egress_filtering` as boundary attribute in Phase 4
- (b) Defer to V1.1
- (c) Add as enrichment attribute in Phase 7

**Decision: (a) Add in Phase 4.**

**Rationale:** Captured alongside existing enforcement prompt (minimal additional cost). Directly improves exfiltration path analysis. Values: `"deny_all" | "allow_list" | "allow_all" | "unknown"`.

**Boundary:** Model accuracy.

**Risk if wrong:** Low — additive attribute.

**Status: Resolved**

---

### D51: Deterministic Classification

**Context:** Classification requires LLM reasoning over ~300 comparisons (12 components × 25 classes). IaC mapping table already provides exact matches for common patterns.

**Options:**
- (a) Add `classify_components` action to `get_classes` — deterministic fuzzy match
- (b) Keep LLM-only classification
- (c) Advisory tool, LLM reviews all suggestions

**Decision: (a) Deterministic classification tool.**

**Rationale:** Saves 3-5K tokens per classification. IaC mapping table provides deterministic matching for common patterns. LLM handles only low-confidence/ambiguous items.

**Boundary:** Token efficiency + MCP tool design.

**Risk if wrong:** Low — LLM still handles ambiguous cases.

**Status: Resolved**

---

### D52: Compliance Framework Tiering

**Context:** 7 regulatory frameworks with equal support. V1's actual capability is data classification + sign-off. NIS2/DORA require deep domain expertise.

**Options:**
- (a) Tier 1 (full): SOC2, ISO 27001. Tier 2 (data only): PCI-DSS, HIPAA, GDPR. Tier 3 (declared): NIST CSF, NIS2, DORA.
- (b) Keep all 7 equal
- (c) Support only SOC2 + ISO 27001

**Decision: (a) Three-tier support.**

**Rationale:** Honest about V1 capabilities. Incorrect NIS2/DORA mapping creates false compliance confidence — worse than not supporting them. SOC2/ISO 27001 map cleanly to the six security attributes.

**Boundary:** Product scope + compliance accuracy.

**Risk if wrong:** Medium — NIS2/DORA users may want more. Tier 3 can be upgraded in V1.1.

**Status: Resolved**

---

### D53: Board-Ready Statement V1 Scope

**Context:** Full confidence summary with board-ready statement is substantial UX for a feature most V1 users won't reach (requires quality >= 70 + executive communication needs).

**Options:**
- (a) Defer to V1.1; V1 shows quality score, checks, one-line discovery basis
- (b) Separate `/dethereal:report` skill
- (c) Keep in `/dethereal:review`

**Decision: (a) Defer to V1.1.**

**Rationale:** V1 focuses on model creation and enrichment. Executive reporting can be added with validated user demand. Freshness tracking depends on sync metadata (D40). `commits_since_update` requires Bash access the model-reviewer doesn't have.

**Boundary:** Product scope.

**Risk if wrong:** Low — executive users can still manually summarize from review output.

**Status: Resolved**

---

### D54: Expertise Detection

**Context:** 3-level implicit behavioral detection is fragile — power user on new project appears as novice, novice copying docs commands appears as power user.

**Options:**
- (a) 2-mode explicit toggle: default + expert (`--expert` flag or config)
- (b) Keep 3-level behavioral detection
- (c) Single mode for all users

**Decision: (a) Two-mode explicit toggle.**

**Rationale:** Behavioral detection adds complexity and testing surface for marginal benefit. Explicit toggle is predictable and controllable. Default mode includes hints; expert mode suppresses them.

**Boundary:** UX design.

**Risk if wrong:** Low — can always add behavioral detection later.

**Status: Resolved**

---

## R7: Model Decomposition for Complex Systems

> Decisions on how the plugin handles systems too complex for a single model. Resolved through multi-agent review (threat-modeler, process-architect, security-architect, security-ux-designer).

### D55: Decomposition Trigger Heuristic

**Context:** The plugin needs to detect when a system is too complex for a single model and recommend decomposition. A pure component-count threshold misses qualitative complexity; no threshold means users discover too late.

**Options:**
- (a) Component count only (e.g., >25)
- (b) Multi-signal: quantitative (components 25+, boundaries 5+, cross-boundary flows 19+) plus qualitative (multiple crown jewels, team ownership boundaries, mixed compliance regimes, heterogeneous depth)
- (c) No trigger — let users decide entirely on their own

**Decision: (b) Multi-signal, advisory only.**

**Rationale:** Component count alone is insufficient — a 40-component system with uniform trust boundaries may be fine; a 15-component system spanning 6 trust zones with separate deployment lifecycles may need splitting. Qualitative signals (multiple crown jewels with independent attack surfaces, different team ownership, mixed compliance regimes) are often more reliable than raw counts. The recommendation is advisory, never blocking — the user knows their system best.

**Boundary:** Workflow design (THREAT_MODELING_WORKFLOW.md Section 9).

**Risk if wrong:** Medium — too aggressive triggers waste user time with unnecessary decomposition planning; too conservative triggers let users build oversized models with degraded enrichment quality.

**Status: Resolved**

### D56: Decomposition Timing

**Context:** At what point in the 11-step workflow should the plugin recommend decomposition?

**Options:**
- (a) Before Step 1 (pre-scoping) — no data yet, premature
- (b) After Step 2 (after discovery, before confirmation) — raw inventory available but blind spots not yet covered
- (c) After Step 3 (after discovery confirmation and blind spot interview) — complete validated inventory

**Decision: (c) After Step 3.**

**Rationale:** Decomposition quality depends on information completeness. After Step 3, the user has confirmed the component inventory, added missing elements from the blind spot interview, and the plugin has the full validated scope. The cost of changing course is near zero — no structural work (boundaries, flows, enrichment) has been done yet. Placing it at Step 2 risks redoing decomposition after the blind spot interview reveals significant missing subsystems.

**Boundary:** Workflow design.

**Risk if wrong:** Low — earlier timing (Step 2) wastes one round-trip if blind spots change the picture; later timing (Step 4+) wastes structural work that may need to be discarded.

**Status: Resolved**

### D57: Default: Narrow Scope vs. Decompose

**Context:** When the plugin detects complexity, should it default to recommending upfront decomposition (plan all models first) or scope narrowing (start with the most critical subsystem, expand later)?

**Options:**
- (a) Always recommend decomposition plan
- (b) Always recommend narrowing scope to highest-risk subsystem
- (c) Context-dependent: narrow when user described one system that turned out complex; decompose when user described multiple systems

**Decision: (c) Context-dependent, defaulting to narrow scope.**

**Rationale:** Scope narrowing gets to value faster — one complete, analysis-ready model of the most critical subsystem is more useful than N partially planned models. Users who only finish one model still have the most important one. Upfront decomposition planning is appropriate when the user explicitly described multiple systems in their scope definition or wants coverage across the platform. The plugin presents both options and lets the user choose.

**Boundary:** UX design (USER_EXPERIENCE.md).

**Risk if wrong:** Medium — always-decompose delays time-to-value; always-narrow misses the planning opportunity for users who genuinely need multi-model coverage.

**Status: Resolved**

### D58: Decomposition Plan Persistence

**Context:** If the user accepts a decomposition recommendation, should the planned models and their status be persisted?

**Options:**
- (a) No persistence — user remembers planned models
- (b) `.dethernety/decomposition-plan.json` — lightweight JSON with planned models, status, cross-model links
- (c) Embed in `.dethernety/models.json` — merge with existing model registry

**Decision: (b) Separate `decomposition-plan.json`.**

**Rationale:** The plan is plugin metadata, not model data. It tracks intention (planned models) and progress (which are complete). Keeping it separate from `models.json` avoids conflating "models that exist" with "models that are planned." `/dethereal:status` reads both files. The plan is a reminder, not a commitment — users may complete only one model and defer the rest indefinitely.

**Boundary:** Plugin metadata design.

**Risk if wrong:** Low — the plan is a convenience artifact. Worst case: stale plan file shows planned models that were never created.

**Status: Resolved**

### D59: Reference Component Pre-Creation

**Context:** When starting model N in a decomposition plan, should `representedModel` reference components for adjacent models be pre-created?

**Options:**
- (a) Pre-create stubs with `representedModel` links during model initialization
- (b) Prompt for references during Step 4 (boundary refinement)
- (c) Manual only — user creates references themselves

**Decision: (a) Pre-create stubs, with (b) as fallback for unplanned models.**

**Rationale:** When the decomposition plan identifies cross-model links, pre-creating reference components reduces friction and ensures the user does not forget to model the dependency. Unresolved references (model not yet synced to platform) are flagged as warnings, not errors — the existing `DtImportSplit` logic already handles this gracefully. For models not part of a decomposition plan, the plugin prompts during Step 4 using `getNotRepreseningModels(modelId)` to list linkable platform models.

**Boundary:** Workflow design.

**Risk if wrong:** Low — unresolved references are already handled by the import pipeline. Worst case: a stub component references a model that is never created.

**Status: Resolved**

### D60: Cross-Model Scope Exclusions

**Context:** When creating model N in a multi-model project, discovery may re-surface components that belong to other models. Should these be filtered out?

**Options:**
- (a) No filtering — user sees all discovered components and manually excludes
- (b) Filter discovery results against components assigned to other models in the decomposition plan
- (c) Annotate scope.json exclusions with "(separate model)" and filter discovery accordingly

**Decision: (c) Scope exclusions with annotation.**

**Rationale:** Deferred subsystems are listed in `scope.json` exclusions as "(separate model)". Discovery filters out components matching these exclusions. This keeps the discovery output focused on the current model's scope without hiding information — the exclusions are visible in scope.json and the user can override them. This also provides audit trail: the scope document shows what was intentionally deferred.

**Boundary:** Workflow design, scope metadata.

**Risk if wrong:** Medium — without filtering, discovery re-surfaces components assigned to other models, creating confusion. Over-aggressive filtering may hide components that belong in the current model.

**Status: Resolved**

---

## R8: Pre-Implementation Security and UX Review

Decisions D61-D66 were identified during the final pre-implementation review (R8), where 6 specialized agents reviewed the architecture documentation. Findings were deduplicated, critically evaluated, and resolved.

---

### D61: MCP Security Hardening

**Context:** Pre-implementation security review identified multiple vulnerabilities in the MCP server architecture: `_token` parameter in tool arguments allows prompt injection-based auth bypass, `directory_path` inputs lack path traversal protection, token store is not keyed by platform URL (cross-instance confusion), OAuth callback lacks `state` parameter (CSRF), and `authDisabled` flag trusted from unauthenticated HTTP on non-localhost URLs.

**Options:**
- (a) Fix each individually with minimal changes
- (b) Comprehensive security hardening pass across all identified issues

**Decision: (b) Comprehensive hardening.**

- **`_token` removed from tool arguments.** Tokens must only come from the secure token store (`~/.dethernety/tokens.json`), never from the conversation layer. Prevents prompt injection attacks from supplying attacker-controlled JWTs.
- **Path containment enforced.** `directory_path` must resolve to a subdirectory of the current working directory or a path registered in `.dethernety/models.json`. Paths must not contain `..` after `path.resolve()`. Symlink targets validated. Enforced via shared `validatePath()` utility.
- **Token store keyed by platform URL.** `TokenStore` interface: `{ [platformUrl: string]: StoredTokens }`. Prevents cross-instance token confusion when working with multiple platform instances.
- **OAuth `state` parameter added.** Generated alongside PKCE codes, validated on callback receipt. Rejects callbacks with missing or mismatched `state`.
- **HTTPS enforced for non-localhost.** When `DETHERNETY_URL` is not `localhost`/`127.0.0.1`, the server rejects HTTP URLs at startup.
- **Transparent token refresh.** When access token is expired but refresh token is valid, `buildToolContext()` refreshes automatically. Removes false "automatic refresh" claim.

**Boundary:** MCP server security model.

**Risk if wrong:** High — `_token` injection and path traversal are exploitable vulnerabilities that would ship in V1.

**Status: Resolved**

---

### D62: Credential Attribute Key Mapping

**Context:** The integration mapping table showed `credential_name` as the plugin capture attribute mapped to engine property `required_credentials`. But the engine's `can_traverse()` reads `edge_data.get("required_credentials", [])`. If the plugin writes `credential_name` as the attribute key, credential gating never fires and lateral movement analysis degenerates to undifferentiated BFS.

Additionally, the push conflict detection spec was contradictory — Section 4 described a full `export_model` while Section 12 described a lightweight GraphQL query via `fetchExistingModelStructure`.

**Options:**
- (a) Plugin writes `credential_name`, add translation layer in import
- (b) Plugin writes `required_credentials` directly (engine property name)
- (c) Add intermediate mapping in dt-core

**Decision: (b) Plugin writes engine property names directly.**

The plugin writes `required_credentials: [credential_name_value]` as the attribute key on data flow edges. `credential_name` remains as a separate human-readable label. `credential_scope` on STORE nodes is a list of credential identifiers that match `required_credentials` values on flows.

Push conflict detection uses the lightweight GraphQL query (`fetchExistingModelStructure`) for V1, not a full `export_model`. C4 (attribute divergence) is an accepted V1 tradeoff.

**Boundary:** Credential topology, sync architecture.

**Risk if wrong:** High — wrong attribute key breaks the single highest-impact analysis feature.

**Status: Resolved**

---

### D63: `auth_failure_mode` Engine Integration

**Context:** The plugin captures `auth_failure_mode` on data flows, but the Analysis Engine V2's `_derive_auth_strength()` only reads `authType`. A flow with `authType: "OAuth2"` and `auth_failure_mode: "fail_open"` gets `auth_strength = 3.0` (near max) when the effective strength is zero. Capturing data that contradicts analysis output is worse than not capturing it.

**Options:**
- (a) Fix engine now (5-line change in `_derive_auth_strength()`)
- (b) Document as known gap, fix engine later
- (c) Don't capture `auth_failure_mode` in V1

**Decision: (a) Fix engine in a separate PR.**

The plugin continues capturing `auth_failure_mode` (the data is valuable). The engine fix (`fail_open` → `auth_strength = 0.0`, `fallback` → halve `auth_strength`) is tracked as a separate PR against the analysis engine module, independent of the plugin implementation.

**Boundary:** Engine integration, separate PR.

**Risk if wrong:** High — false-security gap where the engine says a path is well-protected when it's wide open.

**Status: Resolved**

---

### D64: Plugin Defaults and State Management

**Context:** Two design decisions identified during pre-implementation review: (1) `settings.json` set `threat-modeler` as the default agent for all conversations in the project, adding ~3KB of modeling guidelines to every interaction including non-threat-modeling work; (2) the state machine's backward transition did not invalidate `model_signed_off` or `.dethereal/quality.json`, meaning sign-off persisted after structural changes.

**Decisions:**

1. **No default agent.** `settings.json` is empty (`{}`). Users invoke threat modeling via skills (`/dethereal:threat-model`) or explicit agent selection (`@dethereal:threat-modeler`). Skills that need the modeling agent specify it in their frontmatter.

2. **Sign-off and quality cache invalidation on backward transitions.** Any backward state transition clears `model_signed_off` and invalidates `.dethereal/quality.json`. This ensures a model cannot carry stale sign-off after structural changes.

**Boundary:** Plugin configuration, state machine.

**Risk if wrong:** Low — both are correctness fixes with clear behavior.

**Status: Resolved**

---

### D65: UX Hardening

**Context:** Pre-implementation UX review identified several gaps: silent discovery source failures, rigid session break recommendation, git-dependent undo without LLM guidance, cross-model analysis gap not communicated at decomposition decision point, and inconsistent step labels across documents.

**Decisions:**

1. **Sources-checked summary.** After discovery, show which source categories were checked and results/gaps: `Sources checked: Terraform (12), K8s (—), Docker (4)`. A `(—)` means no matching files; `(⚠ error)` means parse failure. Makes omissions visible without formal error contracts.

2. **Size-calibrated session break.** At STRUCTURE_COMPLETE: small models (< 15 components) get a gentle suggestion; large models (15+) get an explicit warning about quality degradation. Continuing is always allowed. Includes git commit recommendation.

3. **Git-based undo with LLM guidance.** V1 uses git for undo — the LLM runs `git diff` and presents options. No plugin-level undo infrastructure. The commit recommendation at STRUCTURE_COMPLETE creates a clean revert boundary. Re-evaluate based on usage.

4. **Cross-model analysis gap at decomposition.** The decomposition confirmation includes: *"The platform analyzes each model independently. Attack paths crossing model boundaries will not appear in analysis results."* If credential scopes span models, warn explicitly.

5. **Canonical step labels.** THREAT_MODELING_WORKFLOW.md Phase-to-Step mapping table is the single source of truth. PLUGIN_ARCHITECTURE.md and USER_EXPERIENCE.md reference it.

**Boundary:** UX design, workflow presentation.

**Risk if wrong:** Medium — UX gaps compound on large models where users invest significant time.

**Status: Resolved**

---

### D66: `monitoring_tools` V1 Scope

**Context:** The OPERATIONAL_REQUIREMENTS document specifies a `monitoring_tools` → `coverage_layer` detection feasibility mapping with a lookup table. Neither `monitoring_tools` nor `coverage_layer` is consumed by any engine code. The mapping table implies engine integration that does not exist.

**Options:**
- (a) Build engine integration for V1
- (b) Capture attribute for human review only, document lack of engine integration
- (c) Defer capture entirely

**Decision: (b) Capture for human review only.**

The plugin captures `monitoring_tools` as a component attribute. The detection feasibility mapping table documents the intended future relationship but is explicitly labeled as V1 human review only. No engine integration point exists — implementers should not look for one.

**Boundary:** Operational requirements, engine scope.

**Risk if wrong:** Low — documented limitation prevents wasted implementation effort.

**Status: Resolved**
