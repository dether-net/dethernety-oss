---
name: threat-model
description: Guided end-to-end threat modeling workflow — scope through validation and sync
agent: threat-modeler
argument-hint: "[system description or model path] [--full-scan]"
---

@../../docs/guidelines-layout.md
@../../docs/guidelines-schema.md
@../../docs/guidelines-examples.md

Walk through the complete 11-step threat modeling workflow. Each step builds on the previous, with state checkpoints that allow resuming later. The workflow delegates to specialized subagents for discovery, enrichment, and validation.

## Implementation Discipline

This workflow is local-first: model files are created on disk now and synced to the platform later (Step 10). Use built-in tools directly — do NOT invent scaffolding scripts, chained shell heredocs, or wrapper utilities.

| Operation | Tool to use |
|-----------|-------------|
| Create a directory | `Bash` with `mkdir -p <path>` |
| Write a JSON/YAML/Markdown file | `Write` tool, one call per file |
| Read a model file | `Read` tool |
| Edit an existing file | `Edit` tool |
| Inspect / sample attribute files between steps | `Read` (one call per file, parallelisable) — never `cat`/`head`/`tail` in a Bash loop |
| Search for a field across attribute files | `Grep` with the field name and `attributes/` path |
| Check enrichment progress / template coverage | `mcp__plugin_dethereal_dethereal__validate_model_json(action: 'quality')` — never sample files with `head` |
| Check control coverage / gap analysis | `mcp__plugin_dethereal_dethereal__validate_model_json(action: 'coverage')` |
| Validate model JSON | `mcp__plugin_dethereal_dethereal__validate_model_json` |
| Generate attribute stubs | `mcp__plugin_dethereal_dethereal__generate_attribute_stubs` |
| Match classes for elements | `mcp__plugin_dethereal_dethereal__match_classes` |
| Push/pull to platform | `mcp__plugin_dethereal_dethereal__create_threat_model` / `update_model` / `export_model` (invoked by `/dethereal:sync` at Step 10) |

**Do not:**
- Write a shell or Python script to scaffold the model directory — call `Write` once per file instead
- Use heredocs (`cat <<EOF > file.json`) to create files — use the `Write` tool, which produces a reviewable diff
- Sample attribute files with `for f in ...; do head -N "$f"; done` to "check progress" — call `validate_model_json(action: 'quality')` for an authoritative per-element coverage report, or `Read`/`Grep` for targeted inspection
- Try to call `mcp__plugin_dethereal_dethereal__create_threat_model` during Step 1 — that tool requires platform connectivity and is invoked by the sync skill at Step 10
- Substitute `get_classes` for `match_classes` in classification (D51) unless the offline fallback chain triggers it

## Entry / Resume Logic

Parse `$ARGUMENTS` to determine whether to start a new model or resume an existing one:

- **Natural language description** (e.g., "a payment processing API with PostgreSQL") → start new model from Step 1
- **Model path or name** (e.g., `./threat-models/payment-api`) → resolve existing model, check state.json for resume
- **No arguments** → check `.dethernety/models.json`:
  - If exactly one model exists, use it (check for resume)
  - If multiple models exist, present a numbered list
  - If no models exist, ask the user to describe their system

### Resume from Existing Model

If `.dethereal/state.json` exists and `currentState` is not `REVIEWED`:

1. Read `state.json`, `quality.json` (if exists), and model files
2. **Drift detection.** If `state.lastReconcileCommit` is present and the user did **not** pass `--full-scan`, run the Drift Orchestration Protocol from the threat-modeler agent before computing the cursor:
   - Invoke `Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/detect-drift.js" --model-dir <model-path>)`. If `${CLAUDE_PLUGIN_ROOT}` is not propagated to the shell (variable expands empty), resolve the plugin root via `node -e "console.log(require.resolve('@dether.net/dethereal/package.json').replace(/\/package\.json$/, ''))"` and reissue the command. Parse stdout JSON `{ baseline, scoped }`; on non-zero exit, surface stderr `message` + `hint` and stop drift logic.
   - If `scoped` is empty, emit `[info] No drift since last reconcile (commit <baseline>).` and skip to step 3.
   - Else, read `.dethereal/discovery.json`. If absent, emit `[info] No prior discovery provenance; drift detection skipped. Run /dethereal:discover to set a baseline.` and skip to step 3.
   - Else, derive `priorElements_in_scope` (elements whose `sources[].file` ⊆ `scoped`), invoke `Agent(infrastructure-scout-scoped)` in `discover elements` mode with the file allowlist, and compute the four-way delta (REMOVED / ADDED / CHANGED-substrate / CHANGED-attribute-only) by name-joining against `newElements` and comparing `suggestedClass.id`.
   - Emit a one-line pre-loop summary: `[drift] <R> removed (<C> crown-jewel-tagged), <A> added, <S> reclassified, <T> attribute-changed since <baseline>.`
   - Iterate the delta items, emitting `/dethereal:remove <id>` for REMOVED, `/dethereal:add <description>` for ADDED, `mcp__plugin_dethereal_dethereal__match_classes` + `Edit` on `structure.json` + `/dethereal:enrich --pick <id>` for CHANGED-substrate, and `/dethereal:enrich --pick <id>` for CHANGED-attribute-only.
   - **After every delta item resolves**, write `state.lastReconcileCommit = <git rev-parse HEAD>` and update `lastModified` via `Edit`. Do **not** advance the baseline mid-loop — the deferred advance is the entire crash-safety story.
   - If the user passed `--full-scan`, skip drift entirely; emit `[info] Full scan requested; running /dethereal:discover end-to-end.` and invoke `/dethereal:discover` instead of the cursor.
3. Compute the step cursor from `currentState` (see step-to-state mapping in the Guided Workflow Orchestration section of the threat-modeler agent)
4. Auto-detect prior work:
   - Classification rate > 80% from quality.json → mark Step 6 as `[done]`
   - `attribute_completion_rate` > 0 → note "Step 8 partially complete"
   - Show auto-detection decisions to the user for confirmation
5. Display progress table:

```
Progress: "<Model Name>" (Quality: X/100)
  [done]        1. Scope Definition
  [done]        2. Discovery (modules: dethernety-general, Kubernetes)
  [done]        3. Model Review
  [auto-skip]   4. Boundary Refinement (hierarchy already well-structured)
  [>>>>]        5. Data Flow Mapping  — current step
  [    ]        6. Classification
  [    ]        7. Data Item Classification
  [    ]        8. Enrichment
  [    ]        9. Validation
  [    ]       10. Sync
  [    ]       11. Post-Sync Linking
```

- `[done]`: step's corresponding state is in `completedStates`
- `[auto-skip]`: Step 4 auto-skips if `boundary_hierarchy_quality` factor = 1.0
- `[>>>>]`: current step
- `[    ]`: not yet reached
- Allow jumping to any step by number, or "continue" to proceed from current

If `currentState` is `REVIEWED`: "Workflow complete. Model is reviewed and ready for analysis. Run `/dethereal:sync push` to publish, or `/dethereal:surface` to review attack surface."

---

## Step 1: Scope Definition

Collect scope information through conversation — ask naturally, don't present a form.

| Field | Required | Default | Guidance |
|-------|----------|---------|----------|
| `system_name` | yes | — | From description or ask |
| `description` | yes | — | 1-2 sentence architecture summary |
| `depth` | no | `architecture` | Options: architecture, design, implementation |
| `modeling_intent` | no | `initial` | Options: initial, security_review, compliance, incident_response |
| `compliance_drivers` | no | `[]` | Ask if not mentioned: "Any compliance requirements?" |
| `crown_jewels` | yes (≥1) | — | Ask: "What are the most valuable assets in this system?" |
| `exclusions` | no | `[]` | Ask if multi-system: "Anything explicitly out of scope?" |
| `trust_assumptions` | no | `[]` | Ask: "What do you explicitly trust?" |
| `adversary_classes` | no | — | Only for security_review or incident_response intent |

Scaffold the model on disk. Default path: `./threat-models/<kebab-case-name>/`.

1. Create the directory tree with a single Bash call:
   ```
   Bash: mkdir -p <model-path>/.dethereal
   ```
2. Write each file individually with the `Write` tool (one tool call per file — no scripts, no heredocs):

| File | Content |
|------|---------|
| `<model-path>/manifest.json` | `{ schemaVersion, format: "split", model: { id: null, name, description, defaultBoundaryId }, files: { structure, dataFlows, dataItems, attributes }, modules: [] }` per the schema |
| `<model-path>/structure.json` | Initial structure with `defaultBoundary` (no children yet) |
| `<model-path>/dataflows.json` | `[]` |
| `<model-path>/data-items.json` | `[]` |
| `<model-path>/.dethereal/scope.json` | The scope object from this step (system_name, description, crown_jewels, compliance_drivers, etc.) |
| `<model-path>/.dethereal/state.json` | `{ "currentState": "SCOPE_DEFINED", "completedStates": ["INITIALIZED", "SCOPE_DEFINED"], "lastModified": "<ISO 8601>", "staleElements": [] }` |

3. Register the model in `.dethernety/models.json` at the project root:
   - Use `Read` to load it if it exists, then `Write` the updated JSON; if it does not exist, `Write` a new file with `{ "version": 1, "models": [{ name, path, createdAt }] }`.

Do **not** call `mcp__plugin_dethereal_dethereal__create_threat_model` here — it requires platform auth and is invoked by `/dethereal:sync` at Step 10.

---

## Step 2: Discovery

Delegate to `Agent(infrastructure-scout)` per the Discovery Orchestration Protocol in the threat-modeler agent.

1. Read `.dethereal/scope.json` — pass scope context to scout
2. Check discovery cache at `.dethernety/discovery-cache.json`
3. Delegate scanning to `Agent(infrastructure-scout)` with model directory path and scope summary
4. Receive compact discovery report
5. Write full provenance to `.dethereal/discovery.json`
6. Present batch confirmation table (boundaries + components + flows)
7. Run post-discovery blind spots interview (consolidated prompt)
8. After confirmation, write `structure.json` and `dataflows.json`
9. Call `mcp__plugin_dethereal_dethereal__validate_model_json` to check structural validity
10. Update `.dethernety/discovery-cache.json` if this is a multi-model project
11. Update state via `Edit` on `.dethereal/state.json`: `currentState` → `DISCOVERED`, add `DISCOVERED` to `completedStates`, refresh `lastModified`, and write `lastReconcileCommit = <git rev-parse HEAD>` to establish the drift-detection baseline (resolve via `Bash(git -C <model-path> rev-parse HEAD)`; on non-zero exit, omit the field — drift detection will skip on resume until the operator re-runs discovery in a git repo)

If the model was created from a description (not IaC), discovery still scans the codebase for IaC corroboration. If no codebase context is available, skip to Step 3 with the description-derived structure.

### Module Selection (post-discovery)

Select which platform modules provide classes for classification and enrichment.

1. Read `.dethereal/discovery.json` — extract `recommendedModules` and source type patterns
2. Query available modules on the platform: call `mcp__plugin_dethereal_dethereal__match_classes` or `mcp__plugin_dethereal_dethereal__get_classes(fields: ['module'])` with no module filter to list all installed modules
3. Map discovery source patterns to recommended modules using the infrastructure-scout's Source Type → Module Mapping table
4. Always include the baseline module — match by name `dethernety-general` (non-removable)
5. Present a confirmation table:

```
## Module Selection

Based on discovery, these modules are recommended for classification:

| # | Module | Reason | Include? |
|---|--------|--------|----------|
| 1 | dethernety-general | Always included (baseline classes) | yes (locked) |
| 2 | Kubernetes | K8s manifests found (12 resources) | yes |
| 3 | AWS | Terraform aws_* resources found (8 resources) | yes |

Available but not recommended:
| 4 | Databases | No database sources detected | no |
| 5 | Azure | No azurerm_* resources detected | no |

Confirm selection? (yes / modify)
```

6. Write confirmed modules to `.dethereal/scope.json` as `activeModules`:
```json
"activeModules": [
  { "id": "module-uuid-1", "name": "dethernety-general" },
  { "id": "module-uuid-2", "name": "Kubernetes" }
]
```

If no discovery was performed (model created from description only), skip module recommendation — classification will search all installed modules.

No state transition — stays at `DISCOVERED` (same as Step 3).

---

## Step 3: Model Review

Run deterministic Pass 1 classification and review the discovered model.

1. Read `activeModules` from `.dethereal/scope.json`. Call `mcp__plugin_dethereal_dethereal__match_classes` with element names, types, and descriptions from the model, scoped to active module IDs (`moduleIds`). Auto-accept `exact_name` matches; present others for confirmation. If `activeModules` is absent, call `match_classes` without `moduleIds` (searches all installed modules). Prefer classes from specialized modules over baseline (dethernety-general) when both match — specialized classes have more targeted attribute schemas (D51)
2. For components not matched by the deterministic pass, match by name, type, and description against available classes from active modules
3. If the component was discovered from IaC (check `.dethereal/discovery.json`), use the pre-classification from IaC mapping
4. Check decomposition thresholds (21+ components, 9+ boundaries, 36+ flows, 19+ cross-boundary) — follow Decomposition Protocol if exceeded (D56: decomposition check runs after Step 3, not Step 2, because the blind spots interview may add components)
4. Present batch confirmation table with proposed classifications:

```
## Model Review

| # | Element | Type | Boundary | Proposed Class | Confidence |
|---|---------|------|----------|----------------|------------|
| 1 | PostgreSQL | STORE | Data Tier | Database | high (IaC) |
| 2 | Redis | STORE | Data Tier | Key-Value Store | high (IaC) |
| 3 | API Server | PROCESS | Internal | Web Application | medium (LLM) |

Confirm classifications? (yes / modify / skip)
```

5. Write confirmed classifications to `structure.json` (set `classData` on elements)
6. Call `mcp__plugin_dethereal_dethereal__generate_attribute_stubs(directory_path)` to write class template attribute stubs for all classified elements

No state transition — stays at `DISCOVERED`.

---

## Step 4: Boundary Refinement

Review and refine the trust boundary hierarchy.

1. Display current boundary hierarchy as a tree view
2. Check for structural issues:
   - Single-component boundaries (may need merging)
   - Flat hierarchy (no nesting — consider adding sub-boundaries)
   - External entities inside internal boundaries (should be in an external boundary)
3. Prompt for boundary enforcement attributes on each boundary:
   - `implicit_deny_enabled` (boolean) — boundary blocks traffic by default
   - `allow_any_inbound` (boolean) — boundary allows unrestricted inbound
   - `egress_filtering` (`"deny_all"` | `"allow_list"` | `"allow_all"` | `"unknown"`) — outbound traffic policy (D50)
4. Apply user refinements to `structure.json`

**Auto-skip:** If `boundary_hierarchy_quality` factor = 1.0 (hierarchy depth ≥ 2, no single-child boundaries, no external entities in internal boundaries), show:
```
Boundary hierarchy is well-structured (quality factor: 1.0). Skipping refinement.
```
Mark as `[auto-skip]` in progress table. User can still jump to Step 4 explicitly.

Update state: `currentState` → `STRUCTURE_COMPLETE`, add `STRUCTURE_COMPLETE` to `completedStates`.

---

## Step 5: Data Flow Mapping

Connect components with data flows to complete the structural model.

1. Review existing data flows from discovery
2. Identify components without any data flows (orphaned) — prompt user to connect them
3. Check for commonly missing operational flows and prompt for each:
   - Administrative access paths (SSH, RDP, management consoles → components)
   - Monitoring/logging flows (components → log aggregators, SIEM)
   - Backup/recovery flows (databases → backup destinations)
4. For each new flow:
   - Determine source/target handles based on relative position (use layout guidelines)
   - Avoid handle conflicts with existing flows
   - Set description and protocol
5. Write new flows to `dataflows.json`
6. Validate: `mcp__plugin_dethereal_dethereal__validate_model_json`

Update state: `currentState` → `ENRICHING`, add `ENRICHING` to `completedStates`. Per the canonical Phase-to-Step Mapping, Steps 5-8 all operate within the ENRICHING state.

Show post-action footer before the session break:
```
[done] Data flow mapping complete. Quality: X/100.
```

---

## Session Break

After Step 5 completes, insert a size-calibrated checkpoint.

Count components in `structure.json`:

**Small models (< 15 components):**
```
Your model structure is complete and saved. You can continue enrichment
now or resume later — your progress is saved.

Consider committing your model before enrichment (clean revert point).

Continue now? (yes / later)
```

**Large models (≥ 15 components):**
```
Your model structure is complete and saved. For models this size,
starting enrichment in a fresh session produces better results — the
enrichment phase reads model files from disk and doesn't need the
discovery context.

Consider committing your model before enrichment (clean revert point).

Continue now? (yes / later)
```

If the user says **"later"**: show resume instructions and stop:
```
To resume: /dethereal:threat-model <model-path>
Your progress is saved at Step 5 (ENRICHING).
```

If the user says **"yes"** (even on a large model): proceed to Step 6 without re-asking. The recommendation is informational, not blocking.

---

## Step 6: Classification (Pass 2)

Delegate classification to `Agent(security-enricher)` per the classify skill workflow.

1. Inventory unclassified elements across all types (components, flows, boundaries, data items)
2. Read `activeModules` from `.dethereal/scope.json` — classification searches only within active modules (same module-scoped approach as Step 3)
3. For each unclassified element:
   - Use boundary context — which boundary contains it, what neighbors are classified as
   - Consider connected data flows — protocols, data types
   - Peer inference — siblings in the same boundary likely have similar classes
   - If no match in active modules, broaden search to all modules and suggest adding the matched module
4. Crown jewel tagging: match free-text crown jewel names from `scope.json` to components
5. Present batch confirmation table (same format as `/dethereal:classify`)
6. Quality gate: 100% STORE classification, 80% overall classification
6. Write classifications and crown jewel tags to model files. Call `mcp__plugin_dethereal_dethereal__generate_attribute_stubs(directory_path)` to write class template attribute stubs for all classified elements

State: no transition — already at ENRICHING from Step 5.

---

## Step 7: Data Item Classification

Model each sensitive data type once, then associate it with **every element that handles it** across its lifecycle — its origin (`EXTERNAL_ENTITY` / `PROCESS`), the flows that carry it, the components that process or store it, and the boundaries that contain it. `dataItemIds` is valid on components (all types), data flows, and boundaries.

1. Identify the elements that handle sensitive data without classified data items — origins, cross-boundary flows, processing/storing components, and containing boundaries
2. For each data item, propose its classification and handling elements:
   - Use `compliance_drivers` from scope.json for regulatory mapping
   - Apply sensitivity tiers: Tier 1 (regulated PII, credentials), Tier 2 (internal business data), Tier 3 (public/declared data)
3. Present proposals:
   ```
   Data item associations:
   | Element (type) | Data Item | Sensitivity | Compliance | Confirm? |
   |----------------|-----------|-------------|------------|----------|
   | User (external entity) | User credentials | Tier 1 | SOC2, GDPR | Y |
   | User Login → Auth (flow) | User credentials | Tier 1 | SOC2, GDPR | Y |
   | payment-db (store) | Customer records | Tier 1 | GDPR | Y |
   | API → DB (flow) | Customer records | Tier 1 | GDPR | Y |
   | Cache (process) | Session tokens | Tier 2 | SOC2 | Y |
   ```
4. Write confirmed data items to `data-items.json` and link them via `dataItemIds` on each handling element

State: no transition — already at ENRICHING.

---

## Step 8: Enrichment

Delegate to `Agent(security-enricher)` for comprehensive security attribute enrichment.

1. Pass model directory path to `Agent(security-enricher)`
2. The enricher handles:
   - Class-specific template attributes per element — template stubs are already on disk from `generate_attribute_stubs` (run during classification). The enricher reads the configuration guide from `.dethereal/class-cache/<classId>.json`, discovers values from code/IaC, asks the user for undiscoverable attributes, and sets all template fields (100% coverage)
   - Plugin-enrichment fields preserved via merge (`crown_jewel`, `credential_scope`, `monitoring_tools`)
   - Credential enrichment (inventory → map to flows → STORE credential scope)
   - Auth failure mode capture (`deny`, `fallback`, `fail_open`)
   - Boundary enforcement attributes
   - Processing of `staleElements[]` first (if any exist from backward transitions)

MITRE ATT&CK tactic coverage is derived server-side from `Exposure.exploitedBy` (see `/dethereal:surface` §5). The enricher does not annotate MITRE techniques on attribute files.
3. Receive compact summary (enriched element count + template coverage metrics)
4. Read updated attribute files from disk

State: no transition — already at ENRICHING from Step 5.

### Control Pass Offer

After Step 8 (Enrichment) completes, offer a session break for the control assignment pass:

```
Enrichment complete. Quality: X/100.
Ready for control assignment (~N prompts). Continue now or resume later?
  [continue] Run control pass now
  [later]    Resume with /dethereal:enrich --focus controls
```

Compute N from boundary count: N = B + 2 (B enforcement prompts + 1 detection + 1 governance). For B=0, N = 3.

**If "continue":**
1. Invoke `Agent(security-enricher)` as a new agent instance with control-pass context
2. The agent runs the 3-step control pass per `@docs/controls-enrichment.md`
3. This is a separate agent invocation with its own 40-turn budget
4. After the control pass completes, read updated model files from disk
5. Proceed to Step 9 (Validation)

**If "later":**
```
To resume: /dethereal:enrich --focus controls
Your enrichment progress is saved. Control assignment can be done at any time.
```
Proceed to Step 9 (Validation) without controls. The quality score's `control_coverage_rate` factor reflects the gap.

---

## Step 9: Validation

Delegate to `Agent(model-reviewer)` for quality assessment.

1. Pass model directory path to `Agent(model-reviewer)`
2. Receive quality score + top 3 issues
3. Write the quality results to `.dethereal/quality.json` (the threat-modeler has Write access; the model-reviewer is read-only)
4. Display inline quality dashboard:
   - Quality score with label
   - Factor breakdown table
   - Quality gate evaluation (Gate 1/2/3)
   - Top issues

**If Gate 3 passes (quality ≥ 70, all Gate 3 criteria met):**
- Update state: `currentState` → `REVIEWED`, add `ENRICHING` to `completedStates`
- Proceed to Step 10

**If Gate 3 fails:**
- Stay at `ENRICHING`
- Show specific gaps: "Gate 3 requires: 100% classification (currently X%), ≥80% attributes (currently Y%)"
- Offer: "Loop back to Step 8 to fill gaps? (yes / skip to sync anyway)"
- If "yes": return to Step 8. If "skip": proceed to Step 10 with a warning that analysis may be incomplete

---

## Step 10: Sync

Push the model to the platform for analysis.

### Gate 2 Pre-Flight Check

Before pushing, verify Gate 2 (sync-blocking) criteria: manifest completeness, structure validity (≥1 boundary, ≥1 component, ≥1 data flow), reference integrity, no orphaned attribute files. Call `mcp__plugin_dethereal_dethereal__validate_model_json(action: 'validate')`. If Gate 2 fails, show the specific failures and stop — do not push a broken model.

### Auth Check

Read `~/.dethernety/tokens.json`. Find the entry keyed by the platform URL (`DETHERNETY_URL` env var, default `http://localhost:3003`).

- If valid token: proceed
- If expired or missing: "Not authenticated. Run `/dethereal:login` first, or skip sync for now."
- If user skips: jump to README generation, then show final footer without sync-related next steps

### Execute Push

Check `manifest.model.id`:

- **First push** (no model.id): call `mcp__plugin_dethereal_dethereal__import_model` with `directory_path`
- **Update** (has model.id): follow the sync skill's push flow — reconstruct sync.json if missing, run pre-push conflict detection, execute `mcp__plugin_dethereal_dethereal__update_model` with `delete_orphaned: true`

### Post-Push

1. Read updated model files (server IDs now written to local files)
2. Display push summary:
   ```
   Pushed "<model-name>" to platform.
     <N> boundaries, <M> components, <K> flows, <J> data items.
     Platform model ID: <id>

   Server IDs written to local files.
   Commit these changes to preserve sync state.
   ```

---

## Step 11: Post-Sync Linking

Link local countermeasures to platform-computed exposures so that defense coverage analysis credits existing controls.

**Pre-check:** Scan attribute files for components that have controls defined. If no countermeasures exist in the model:
```
No countermeasures defined. After analysis completes, run /dethereal:surface
to see control gaps and exposure distribution.
```
Skip to README generation.

**If countermeasures exist:**

1. Call `mcp__plugin_dethereal_dethereal__manage_exposures(action: 'list')` to get platform-computed exposures
2. If no exposures yet (analysis hasn't run): "Analysis results not available yet. Linking will be possible after the analysis engine processes this model. Proceed to finish."
3. If exposures exist, present a batch linking table:
   ```
   ## Exposure-to-Countermeasure Linking

   | Exposure | Component | Candidate Countermeasure | Link? |
   |----------|-----------|------------------------|-------|
   | SQL Injection | payment-db | Input validation control | Y |
   | Auth Bypass | api-gateway | OAuth2 enforcement | Y |
   | Data Exfil | user-db | Encryption at rest | ? |

   Link all? (yes / modify / defer)
   ```
4. If user defers: "Analysis will undercount your defenses — defense coverage analysis will not credit existing controls until exposures are linked to countermeasures."
5. If user confirms: call `mcp__plugin_dethereal_dethereal__manage_countermeasures` to create the links

---

## README Generation

After Step 10 (or at workflow end if sync was skipped), generate `README.md` per the threat-modeler's README Generation Protocol:

- `# <Model Name>` with auto-generated notice
- Tree view of model structure (boundaries → components hierarchy)
- Data flow list (source → target: description)
- Quality status and workflow state
- Sync timestamp if applicable

---

## Backward State Handling

At any point during Steps 6–9, if the user requests structural changes (adding or removing elements), follow the Backward Transition Protocol from the threat-modeler agent:

1. Revert `currentState` to `STRUCTURE_COMPLETE`
2. Delete `.dethereal/quality.json`
3. Clear `model_signed_off` if present
4. Add new element IDs to `staleElements[]`
5. Warn the user about the state reversion
6. Re-position the workflow step cursor to Step 4. If boundaries are unaffected (e.g., adding a component to an existing boundary), Step 4 will auto-skip to Step 5
7. Show updated progress table with re-opened steps

The user can then proceed forward again from Step 4.

---

## Final Footer

```
[done] Threat model "<name>" complete. Quality: X/100 (<label>). State: REVIEWED.
[next] Run analysis on the platform, then /dethereal:surface (review attack surface)
```

If sync was skipped:
```
[done] Threat model "<name>" complete. Quality: X/100 (<label>). State: <state>.
[next] /dethereal:sync push (publish to platform for analysis)
```
