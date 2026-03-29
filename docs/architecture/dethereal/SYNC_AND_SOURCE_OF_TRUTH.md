# Sync Architecture and Source of Truth

> **Date**: 2026-03-26
> **Inputs**: Security Architect, Process Architect, Claude Code Expert, Security UX Designer
> **Status**: Proposal -- open questions resolved, pending implementation

---

## 1. Source of Truth: Dual-Authority Model

All four reviewers converge on the same recommendation: **neither side is "the" single source of truth. The architecture should adopt a dual-authority model.**

### The Two Authorities

| Concern | Authority | Rationale |
|---------|-----------|-----------|
| **Model structure** (components, boundaries, flows, attributes, data items, classifications) | Local filesystem (git-versioned) | Developer-centric, offline-capable, auditable via git log, rollback via git |
| **Computed artifacts** (exposures, analysis results, countermeasure-exposure links, OPA/Rego evaluations, cross-model graph analysis) | Platform (graph database) | Requires graph traversal, OPA engine, multi-model composition -- cannot be replicated locally |

### The Analogy

**Push is a publish operation, not a sync operation.** The local model is the manuscript; the platform is the published version. Pull is an import that creates a working copy. This framing avoids the false promise of "bidirectional sync" in V1.

> *"Local files are your working copy. The platform is the shared repository. You push changes up, pull changes down. If both sides changed, you resolve the differences."*

### Recommendation on Best Practice

When using the Dethereal plugin, **local-first is the recommended workflow**: create and enrich locally, push to platform for analysis. The platform receives snapshots, not the canonical version. Git provides version history, branching, and collaboration.

However, the architecture must prepare for both directions because:
- Platform-first users exist (GUI model creation, then pull for CLI enrichment)
- Team workflows require pulling models created by others
- Referenced models may originate from different workflows

---

## 2. Scenarios and Workflows

### Scenario 1: Local-First (Plugin Creates, Platform Receives)

**Support level**: Fully supported -- the golden path.

**Flow**: create -> enrich -> review -> sync push -> post-sync linking

**No changes needed** except:
- After `applyIdMapping()`, suggest commit: *"Server IDs written to local files. Commit these changes to preserve sync state."*
- If `manifest.model.id` is already set on push, use `update_model` (not `import_model`) to prevent duplicates.

---

### Scenario 2: Platform-First (Pull, Enrich Locally, Push Back)

**Support level**: Partially supported -- mechanical plumbing exists, but state bootstrap is a gap.

**Flow**:
1. `/dethereal:login`
2. `/dethereal:sync pull` -- select from model list (requires `list_models` tool)
3. `export_model` writes split files
4. **State bootstrap**: infer state, compute quality, register in `models.json`, write `sync.json` with `baseline_element_ids` captured from the pulled model's element IDs (so the first push after pull has a correct baseline for conflict detection)
5. User enriches locally via skills
6. `/dethereal:sync push` -- must route to `update_model` (not `import_model`) because `manifest.model.id` exists

**Gaps to close**:

| Gap | Description | Effort |
|-----|-------------|--------|
| State inference | No `.dethereal/` metadata after pull. Must infer from content. | Medium |
| Quality computation | Must run `validate_model_json(action: 'quality')` on pull | Low |
| Models registry | Must register in `.dethernety/models.json` on pull | Low |
| Push routing | Must check `manifest.model.id` to choose `update_model` vs `import_model` | Low |
| `list_models` implementation | Specified but not built. Required for CLI-first pull | Medium |
| Scope absence | Platform models have no `scope.json`. Prompt for scope on first skill invocation or infer from content | Low |

---

### Scenario 3: Pull to Empty Folder (Cross-Environment)

**Support level**: Same as Scenario 2 plus:
- No git history on pulled model. Suggest first commit after pull.
- Module/class mismatch possible across platform instances. The manifest stores module ID + name but not version.

---

### Scenario 4: GUI Edit After Push (Local Staleness)

**Support level**: Gap -- no conflict detection.

**The dangerous case**: User pushes, colleague edits in GUI, user pushes again. With `deleteOrphaned: true` (default on `update_model`), the colleague's additions are silently deleted.

**V1 mitigation** (no platform schema changes required):

1. Before push, fetch platform element IDs via a lightweight GraphQL query (`DtUpdate.fetchExistingModelStructure`) — not a full `export_model` (D62)
2. Compare element IDs (boundaries, components, flows, data items) against local model
3. Use `baseline_element_ids` from `sync.json` to disambiguate platform additions from user deletions
4. If platform has elements not in local model, warn before proceeding

See **Section 12: Push Conflict Resolution** for the complete flow and UX.

**Note on `updatedAt`**: Adding `updatedAt` to the Model graph node would enable a fast staleness check (single property read vs full export). However, tracking `updatedAt` is complex — every mutation to any model-related node (component, boundary, flow, attribute, class assignment, layout change, analysis module Cypher writes) must propagate to the parent Model. This includes 5 distinct mutation channels, some of which bypass application code. See **Section 14: Platform Dirtiness Tracking** for the full analysis. V1 uses snapshot comparison (zero platform changes, perfect correctness). V1.1 adds application-level `updatedAt` for performance.

---

### Scenario 5: Clone / Version

**Support level**: Not supported -- no clone mechanism.

**Proposed flow** (`/dethereal:create --from <source>`):

1. Resolve source (local path or platform model ID)
2. Deep copy all files to new directory
3. Generate new UUIDs for all elements (model, boundaries, components, flows, data items)
4. Update all internal cross-references
5. Clear platform model ID (`manifest.model.id = null`)
6. Reset audit trail (sign-off cleared -- clone has not been reviewed)
7. Preserve enrichment data (classifications, attributes) as time-saver
8. Set state to ENRICHING (structural changes expected)
9. Register in `.dethernety/models.json` with `source: "clone"` and `clonedFrom` lineage

**Critical**: If a user copies a model directory manually (`cp -r`) and pushes without clearing the platform ID, it overwrites the original. Add a pre-push safety check: if `manifest.model.id` matches another registered local model, warn.

**Git branching does NOT work for model versioning.** The platform model ID in `manifest.json` does not change across git branches. Pushing from branch B overwrites the same platform model as branch A. Clone with new IDs (`/dethereal:create --from`) is the only correct pattern for creating independent model versions.

---

### Scenario 6: Referenced Models (representedModel)

**Support level**: Partially supported -- `DtExportSplit` exports the reference; `DtImportSplit` resolves it on import.

**Design principles** (all four reviewers agree):

1. **Never auto-pull referenced models.** Recursive pull creates unbounded scope.
2. **Display references clearly** on pull: *"This model references 2 other models: 'API Service', 'Auth Service'. These are not pulled automatically."*
3. **Preserve references on push.** Do not modify `REPRESENTS_MODEL` relationships.
4. **Handle missing references gracefully.** Flag as warning, not error: *"Component X references model abc-123 which cannot be verified locally."*
5. **Track references in sync.json** for awareness:

```json
{
  "referencedModels": [
    { "id": "xyz-789", "name": "API Service", "localPath": null },
    { "id": "def-456", "name": "Auth Service", "localPath": "./threat-models/auth-service" }
  ]
}
```

#### Cross-Model Trust Assumptions

When setting `representedModel` on a component or boundary, the plugin should capture trust assumptions at the model boundary. These follow the same pattern as D48 (`auth_failure_mode`): capture now as attributes or scope trust assumptions (D49), engine integration later.

Key trust dimensions to capture:
- **Authentication trust**: Does this model trust the referenced model's authentication decisions? (`full` / `verify` / `zero`)
- **Boundary crossing**: Does the connection to this component cross a trust boundary in the originating model's terms?
- **Auth delegation**: Is auth handled by the referenced model, independently, or passed through? (`delegated` / `independent` / `passthrough`)
- **Data sensitivity at boundary**: Maximum sensitivity of data flowing to/from the referenced model (`public` / `internal` / `confidential` / `restricted`)

#### Cross-Model Analysis Gap

The platform's graph-based analysis algorithms (`build_graph_from_neo4j` in `weighted_analysis.py`) construct model-scoped NetworkX graphs. They do NOT follow `REPRESENTS_MODEL` edges. This means:

- **Privilege escalation chains** crossing model boundaries are not detected
- **Credential blast radius** spanning models is understated
- **Crown jewel reachability** from another model's entry points is not computed
- **Lateral movement loops** spanning models are invisible
- **PageRank / betweenness centrality** are computed only within each model's subgraph, losing broader system context

The **copilot module** has partial cross-model awareness: when a component has a `REPRESENTS_MODEL` relationship, it checks for existing analyses on the sub-model and uses those findings as context. This is LLM-mediated reasoning, not graph-traversal analysis.

**Mitigation for the plugin:** Each decomposed model should contain at least one entry point AND at least one crown jewel. The review phase flags: *"N components reference external models. Attack paths through these components are not included in this model's analysis."*

**Platform-level fix (not plugin scope):** The Analysis Engine could support a `cross_model_analysis` mode that constructs a unified graph by following `REPRESENTS_MODEL` edges and merging referenced models' components. The data is in the graph database; the query needs to follow the edge.

#### Decomposition Plan Metadata

When the user accepts a decomposition recommendation (see THREAT_MODELING_WORKFLOW.md Section 9), the plugin writes `.dethernety/decomposition-plan.json` tracking planned models, completion status, and cross-model links. `/dethereal:status` reads this file and displays multi-model progress.

The decomposition plan is a convenience artifact, not a commitment. Users may complete only one model and defer the rest indefinitely.

**Deferred**: Cross-model authorization boundaries (per-model access control) and system replacement at scale (bulk-updating references when a referenced system is replaced) are deferred. The platform does not currently support model-level authorization. These are platform-level concerns, not plugin concerns.

---

### Scenario 7: Multi-User (Concurrent Edits)

**Support level**: Gap -- same as Scenario 4 for two plugin users.

**V1 recommendation**: Use git as the collaboration layer. One user pushes at a time. Pull before push. Document as the recommended pattern (same model as `git pull` before `git push`).

**V1.1**: Optimistic concurrency control via version counter or content hash.

---

## 3. State Inference Algorithm

When a model is pulled from the platform, no `.dethereal/` metadata exists. The plugin infers state from content:

```
function inferState(modelPath):
  structure = read structure.json
  components = countComponents(structure)
  dataflows = read dataflows.json
  attributes = read attributes/

  if components == 0:
    return INITIALIZED

  classifiedCount = components with classData set
  attributeCount = components with attribute files

  if dataflows.length == 0:
    return SCOPE_DEFINED                    // has structure, no flows

  if classifiedCount == 0 && attributeCount == 0:
    return STRUCTURE_COMPLETE               // has flows, nothing enriched

  return ENRICHING                          // some enrichment exists
```

**Key decisions**:
- **DISCOVERED is skipped** -- discovery is a plugin concept; platform models were not "discovered"
- **REVIEWED is never inferred** -- review is a human attestation, must be explicit
- State is marked `inferredFromContent: true` so the guided workflow can adjust messaging

---

## 4. Sync Metadata (V1)

Even though D40 defers conflict resolution to V1.1, a minimal `sync.json` should exist in V1. The data is cheap to capture now, and retrofitting later means existing users start V1.1 with no sync history.

### `<model-path>/.dethereal/sync.json`

```json
{
  "platform_model_id": "abc-123-def-456",
  "platform_url": "https://demo.dethernety.io",
  "last_pull_at": "2026-03-26T10:00:00Z",
  "last_push_at": null,
  "pull_content_hash": "sha256:...",
  "push_content_hash": null,
  "baseline_element_ids": {
    "boundaries": ["b-001", "b-002"],
    "components": ["c-001", "c-002", "c-003"],
    "flows": ["f-001", "f-002"],
    "dataItems": ["d-001"]
  },
  "referenced_models": []
}
```

**Content hash**: SHA-256 of all model files (not `.dethereal/`), excluding layout properties (`positionX`, `positionY`, `dimensionsWidth`, `dimensionsHeight`), sorted by path. Layout changes should not trigger staleness warnings — they are cosmetic.

**Baseline element IDs**: Captured after every push/pull. Enables disambiguation of platform additions (C1) from user deletions (C2) during the pre-push diff. See Section 12.

**Gitignore policy**: `sync.json` should be gitignored (per-user, per-instance state). Two developers pulling the same model have independent sync state. On push/pull/start-modeling, if `sync.json` is missing but `manifest.model.id` exists (model was synced before but `sync.json` was lost), reconstruct baseline from a platform export.

---

## 5. Pull UX

### First Pull (Model Selection)

```
User: /dethereal:sync pull

Plugin: Connected to https://demo.dethernety.io (3 models available)

  #  Name                   Components  Flows  Last modified
  1  Production Stack       12          8      2 days ago
  2  Staging Environment    5           3      1 week ago
  3  Payment Service (v2)   18          14     3 hours ago

  Which model? (number or model ID):
```

### Pull Output (State Bootstrap)

```
Plugin: Pulling "Production Stack" from platform...

  Written to: ./threat-models/production-stack/

  manifest.json        Model metadata
  structure.json       5 boundaries, 12 components
  dataflows.json       8 data flows
  data-items.json      3 data items
  attributes/          14 attribute files

  Quality: 72/100 (Good -- ready for analysis)
  State:   ENRICHING (inferred from content)

  This is now your working copy.
  Edit locally, then /dethereal:sync push to send changes back.

  Next: /dethereal:review to assess, or /dethereal:enrich to fill gaps.
```

### Pull With Local Changes

```
Plugin: Local model "Production Stack" has changes since last pull:

  Modified: structure.json (1 component added)
  New file: attributes/components/redis-cache__a1b2c3.json

  Pulling will OVERWRITE these local changes.

  Options:
    "push first"  -- Push your changes, then pull
    "backup"      -- Save to ./threat-models/production-stack.backup/
    "overwrite"   -- Discard local changes
    "cancel"      -- Keep local files unchanged
```

---

## 6. Push UX (Conflict-Aware)

### Happy Path (No Conflicts)

```
/dethereal:sync push

Pushing "Production Stack" to platform...

  Checking platform state... no changes since last push.
  Pushing 5 boundaries, 12 components, 8 flows, 3 data items... done.

  Server IDs written to local files.
  Commit these changes to preserve sync state.

[done] Push complete.
```

### Platform Has New Elements (Deletion Warning)

```
/dethereal:sync push

Pushing "Production Stack" to platform...

  Checking platform state...

  WARNING: Platform has elements not in your local model.
  These will be DELETED from the platform on push.

  Elements on platform but not local (will be deleted):
    Components: API Rate Limiter, Redis Sentinel (added via GUI)
    Flows:      Rate Limiter -> API Gateway

  Your local changes (will be applied):
    2 components modified, 1 data flow added

  Options:
    push   -- Push local model. 3 platform elements DELETED.
    pull   -- Pull platform version first, then review differences.
    cancel -- Do nothing.

  Choice (push / pull / cancel):
```

### Mixed Changes (Additions + Deletions + Conflicts)

```
/dethereal:sync push

Pushing "Production Stack" to platform...

  Checking platform state...

  Push requires review. Summary:

  +----+-----------------------------------+-------+
  |    | Change                            | Count |
  +----+-----------------------------------+-------+
  | +L | Elements added locally            |     3 |
  | ~  | Elements modified (no conflict)   |     4 |
  | -P | Platform-only elements (DELETED)  |     2 |
  +----+-----------------------------------+-------+

  DELETIONS (2 platform-only elements):
    Components: Message Queue (added by bob, 1d ago)
    Flows:      MQ -> Worker

  Your additions (3) and modifications (4) will be applied.

  Options:
    push   -- Push local model. 2 platform elements DELETED.
    pull   -- Pull platform version first.
    cancel -- Do nothing.

  Choice (push / pull / cancel):
```

### Expert Mode

Same warnings, compressed. Data loss warnings are never suppressed:

```
  WARNING: 3 platform-only elements will be deleted.
  (comp: API Rate Limiter, Redis Sentinel; flow: Rate Limiter -> API Gateway)

  push / pull / cancel?
```

### Push Routing Logic

```
if manifest.model.id is set:
  use update_model (existing platform model)
  run pre-push conflict detection (Section 12)
else:
  use import_model (new platform model, no conflicts possible)
```

---

## 7. Status Display

```
Dethernety Connection
  Platform:  https://demo.dethernety.io
  Auth:      levente@dether.net (38 min remaining)

Local Model: ./threat-models/production-stack/
  Name:      "Production Stack"
  Quality:   73/100 (Good)
  Sync:      Local changes not pushed (1 component added)
  Last sync: 2 hours ago (pushed)
  Model ID:  abc-123
```

---

## 8. Metadata File Layout After Pull

```
project-root/
  .dethernety/                              # Plugin-level (project root)
    models.json                             # Registry: path, name, platformModelId, source
    config.json                             # Plugin configuration
  threat-models/
    production-stack/                       # User-chosen visible path
      manifest.json                         # SplitModel
      structure.json
      dataflows.json
      data-items.json
      attributes/
      .dethereal/                           # Per-model plugin metadata
        state.json                          # Inferred: currentState, inferredFromContent
        quality.json                        # Computed on pull
        sync.json                           # Sync tracking (gitignored)
        # No scope.json (platform model has no plugin scope)
        # No discovery.json (not discovered via plugin)
        # No audit_trail.json (no plugin operations yet)
```

---

## 9. Prerequisites

### V1 (No Platform Changes)

| Change | Where | Effort | Enables |
|--------|-------|--------|---------|
| `list_models` MCP tool implementation | MCP server | Medium | Pull model selection (Scenario 2) |
| State inference on pull | `sync pull` skill | Medium | Resume after pull (all pull scenarios) |
| Quality computation on pull | `sync pull` skill | Low | Status display after pull |
| Push routing (`update_model` vs `import_model`) | `sync push` skill | Low | Correct push for pulled models |
| `sync.json` with `baseline_element_ids` | `sync` skill | Low | Conflict detection, V1.1 migration |
| Pre-push element ID comparison + conflict UX | `sync push` skill | Medium | Prevent silent data loss (Scenario 4) |
| `/dethereal:create --from` (clone) | New skill flag | Medium | Model versioning (Scenario 5) |
| Scope fields on Model graph node | GraphQL schema | Low | Scope preservation on pull (see Section 15) |

### V1.1 (Platform Changes)

| Change | Where | Effort | Enables |
|--------|-------|--------|---------|
| `updatedAt` + `createdAt` on Model graph node | Schema + 3 orchestrators | Medium | Fast staleness check (10ms vs 1-3s) |
| Attribute-level diff + merge UX | `sync push` skill | High | Per-attribute conflict resolution |
| Per-element selective push | `sync push` skill + `DtUpdate` | High | Cherry-pick which changes to push |
| Optimistic concurrency control | Backend | Medium | Reject concurrent pushes |

---

## 10. Provenance Split

Neither side alone tells the full compliance story:

| Concern | Git (Local) | Platform |
|---------|------------|----------|
| Who changed the model | git log, git blame | `updatedAt` (proposed) |
| Why they changed it | Commit messages | Not captured |
| Who reviewed it | `.dethereal/audit_trail.json` | Not specified |
| What analysis found | Not stored locally | Analysis nodes + results |
| What exposures exist | Not stored locally | OPA/Rego computed |
| Cross-model context | Not available locally | Graph traversal |

For compliance (SOC2, PCI-DSS), auditors need both: git for "who approved the model" and platform for "what the analysis found."

---

## 11. Resolved Questions

| # | Question | Resolution |
|---|----------|------------|
| 1 | `updatedAt` on Model | V1: element ID comparison via lightweight `fetchExistingModelStructure` query (no platform change, catches structural changes, sub-1s per push). V1.1: add `updatedAt` + `createdAt` to Model schema + 3 orchestrator modifications for 10ms checks. See Section 14. |
| 2 | Scope after pull | (c) Add scope fields to Model graph node. On pull, if model is dirty (snapshot hash differs from last push), require user approval for scope. See Section 15. |
| 3 | `deleteOrphaned` behavior | Do NOT change the default. The skill layer sets `deleteOrphaned` dynamically based on the element-level diff: no platform additions → `true` (safe); platform additions detected → present choice to user. See Section 12. |
| 4 | Clone `representedModel` refs | Preserve by default (they point to the same platform models). `--strip-refs` option to remove them. |
| 5 | `sync.json` gitignored | Yes. Conflict checks run on push/pull/start-modeling operations. If `sync.json` missing but `manifest.model.id` exists, reconstruct baseline from platform export. |

---

## 12. Push Conflict Resolution (V1)

### Conflict Taxonomy

| ID | Conflict | Cause | V1 Detectable | Severity |
|----|----------|-------|:---:|----------|
| C1 | Platform addition | Someone added elements via GUI | Yes (element diff) | **Critical** (data loss) |
| C2 | Local deletion | User intentionally removed elements | Yes (with baseline) | Low (desired) |
| C3 | Platform deletion | Someone removed elements via GUI | Yes (snapshot) | Low |
| C4 | Attribute divergence | Both sides modified same element's attributes | Expensive (full export) | **High** (silent overwrite) |
| C5 | Classification change | Someone reclassified on platform | Yes (snapshot) | Medium |
| C6 | Position/layout change | Someone moved elements in GUI | Yes (skip) | Low (cosmetic) |
| C7 | Topology change | Data flow routing changed on platform | Yes (snapshot) | Medium |
| C8 | Computed artifact destruction | Exposures/countermeasures deleted on push | **Not an issue** | N/A |

**C8 clarification**: `deleteOrphanedElements()` in `dt-update.ts` only deletes structural elements (boundaries, components, flows, data items). Controls, exposures, countermeasures, and analysis results are graph neighbors linked by relationships — they are NOT in the orphan deletion scope. Analysis artifacts survive push.

### V1 Push Flow

```
/dethereal:sync push [directory-path]
    |
[Step 0: Pre-checks]
    Read local model files
    Validate model structure
    Check manifest.model.id
    +-- No model.id → import_model (first push, no conflicts) → Step 5
    +-- model.id exists → update path → Step 1
    |
[Step 1: Snapshot Comparison]
    Fetch platform element IDs via lightweight GraphQL query
    (DtUpdate.fetchExistingModelStructure already does this internally)
    |
[Step 2: Element Inventory]
    local_ids = IDs from structure.json, dataflows.json, data-items.json
    platform_ids = IDs from platform query
    baseline_ids = IDs from sync.json (if available)
    |
[Step 3: Diff Computation]
    platform_additions = platform_ids - local_ids
    If baseline available:
      user_deletions = baseline_ids - local_ids
      true_platform_additions = platform_additions - baseline_ids
    Else:
      user_deletions = {}
      true_platform_additions = platform_additions
    |
[Step 4: Decision Point]
    IF true_platform_additions is empty:
      No conflicts → push with deleteOrphaned: true
    ELSE:
      Show conflict UX (Section 6) → user chooses:
        push   → deleteOrphaned: true
        pull   → route to sync pull (with backup)
        cancel → stop
    |
[Step 5: Execute Push]
    Call update_model or import_model
    |
[Step 6: Post-Push]
    Update sync.json: push_content_hash, baseline_element_ids
    Suggest git commit
    If countermeasures exist → suggest linking (R6/F3)
```

### First Push After Pull (Special Case)

When `sync.last_pull_at` is set but `sync.last_push_at` is null, platform-only elements are likely intentional local deletions. The warning is softer:

```
  You pulled this model from the platform and have since modified it.
  The following elements exist on the platform but not locally.
  If you removed them intentionally, "push" is correct.

  Components: Legacy Auth Service
  Flows:      Legacy Auth -> Database

  push / pull / cancel?
```

### V1 Accepted Tradeoffs

- **No attribute-level merge (C4).** V1 overwrites platform attributes with local values. The staleness warning covers this partially. Attribute-level merge requires significant UX design — deferred to V1.1.
- **Binary choice only.** User chooses "push" (delete platform additions) or "pull" (get platform version). No per-element selectivity in V1.
- **No merge option.** V1 has no merge logic. The honest alternative is: pull, use `git diff` to review, integrate manually, push.

---

## 13. Analysis Artifact Safety

Exposures, controls, countermeasures, and analysis results are **not affected by `sync push`**. The `deleteOrphanedElements()` method (`dt-update.ts`) only tracks and deletes:
- Data items
- Data flows
- Components
- Boundaries

These computed artifacts live as separate graph nodes connected via relationships (`HAS_EXPOSURE`, `HAS_CONTROL`, `ADDRESSED_BY`, `ANALYZED_BY`). They are not in the `existingIds` / `processedIds` tracking sets.

The push UX confirms this to the user when analysis artifacts exist:

```
  Note: The platform has 8 exposures, 3 controls from analysis.
  These are not affected by push -- only model structure is updated.
```

---

## 14. Platform Dirtiness Tracking

### The Problem

Detecting "has the platform model changed since last push?" requires tracking all mutations to any model-related node. The current GraphQL schema has **zero timestamps** on Model, Component, SecurityBoundary, DataFlow, or Data types. Only `AnalysisStatus` and `Issue` have `createdAt`/`updatedAt`.

### Mutation Channels

| Channel | Examples | Controllability |
|---------|----------|:---:|
| 1. Neo4j GraphQL auto-generated mutations | `createComponents`, `updateSecurityBoundaries` via dt-core classes, flowStore | HIGH |
| 2. `@cypher` mutations in schema | `deleteModel` (cascading), issue linking | MEDIUM |
| 3. `setInstantiationAttributes` service | OPA/Rego evaluation writes: attribute sets, exposure upserts, countermeasure upserts via direct Cypher | MEDIUM |
| 4. DTModule raw driver access | `DbOps` is read-only today, but raw driver exposed to modules | LOW |
| 5. Import/Update pipeline | `DtUpdate`, `DtImport` bulk writes via dt-core classes | HIGH |

### V1 Approach: Snapshot Comparison (No Platform Changes)

Before push, fetch platform element IDs via `DtUpdate.fetchExistingModelStructure` (lightweight GraphQL query), compare against local element IDs and `baseline_element_ids` in `sync.json`. This catches structural changes (additions, deletions) but not attribute-level divergence (C4 — accepted V1 tradeoff).

| Property | Value |
|----------|-------|
| Platform changes required | None |
| Correctness | 100% — catches ALL mutation channels |
| Performance | 1-3s per push (full export) |
| Answers "what changed" | Yes (via element-level diff) |
| Layout sensitivity | Excluded from hash — position changes are cosmetic |

The `SplitModel` manifest already has a `checksum` field. The content hash excludes `positionX`, `positionY`, `dimensionsWidth`, `dimensionsHeight` to avoid false-positive warnings from GUI layout changes.

### V1.1 Approach: Application-Level `updatedAt`

Add `updatedAt: String` and `createdAt: String` to the `Model` type in `schema.graphql`. Three orchestrator modifications:

1. **GraphQL interceptor**: NestJS interceptor detects mutations on model-related types, updates parent Model's `updatedAt` via graph traversal
2. **`setInstantiationAttributes` service**: Post-operation hook traverses to parent Model and sets `updatedAt`
3. **Import/Update pipeline**: `DtUpdate` sets `Model.updatedAt` at operation end (already has `modelId`)

**Known gap (~5%)**: Channel 2 (`@cypher` mutations) and Channel 4 (arbitrary module Cypher) bypass application code. Current modules are read-only via `DbOps`. If a future module writes directly, it must also update `Model.updatedAt` — document as DTModule interface contract.

**Migration V1 → V1.1**: Plugin checks if `updatedAt` is available on Model node. If yes, use fast check (10ms). If no, fall back to snapshot comparison. Backward-compatible with older platform versions.

---

## 15. Scope on Platform Models

A pulled model has no `scope.json` (scope is a plugin concept). Resolution: add scope fields to the Model graph node.

**Fields to add to Model type:**

```graphql
type Model {
  # ... existing fields ...
  scopeDescription: String
  scopeDepth: String           # 'architecture' | 'design' | 'implementation'
  scopeModelingIntent: String  # 'initial' | 'security_review' | 'compliance' | 'incident_response'
  scopeComplianceDrivers: [String!]
  scopeCrownJewels: [String!]
  scopeExclusions: [String!]
  scopeTrustAssumptions: [String!]
}
```

**On push**: Write scope fields from `scope.json` to the Model node.

**On pull**: Read scope fields from the Model node, write to `scope.json`.

**Dirty-check**: If the model was modified on the platform (detected via element ID comparison at push time, or `updatedAt` when available), scope may have changed. On first skill invocation after pull, present the scope and require confirmation: *"Scope was imported from the platform. Review and confirm, or modify."*

If the Model node has no scope fields (older platform, or model created via GUI without scope), the plugin prompts for scope on first skill invocation — same as the current behavior for new models.
