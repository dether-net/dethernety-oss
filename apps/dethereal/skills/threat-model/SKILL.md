---
name: threat-model
description: Guided end-to-end threat modeling workflow — scope through validation and sync
agent: threat-modeler
argument-hint: "[system description or model path]"
---

@../../docs/guidelines-layout.md
@../../docs/guidelines-schema.md
@../../docs/guidelines-examples.md

Walk through the complete 11-step threat modeling workflow. Each step builds on the previous, with state checkpoints that allow resuming later. The workflow delegates to specialized subagents for discovery, enrichment, and validation.

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
2. Compute the step cursor from `currentState` (see step-to-state mapping in the Guided Workflow Orchestration section of the threat-modeler agent)
3. Auto-detect prior work:
   - Classification rate > 80% from quality.json → mark Step 6 as `[done]`
   - `attribute_completion_rate` > 0 → note "Step 8 partially complete"
   - Show auto-detection decisions to the user for confirmation
4. Display progress table:

```
Progress: "<Model Name>" (Quality: X/100)
  [done]        1. Scope Definition
  [done]        2. Discovery
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

Write scope to `<model-path>/.dethereal/scope.json`.

Create model directory (default: `./threat-models/<kebab-case-name>/`) and initial model files:
- `manifest.json` — model metadata
- `structure.json` — empty boundaries/components
- `dataflows.json` — empty array
- `data-items.json` — empty array

Write `.dethereal/state.json`:
```json
{
  "currentState": "SCOPE_DEFINED",
  "completedStates": ["INITIALIZED", "SCOPE_DEFINED"],
  "lastModified": "<ISO 8601>",
  "staleElements": []
}
```

Register model in `.dethernety/models.json`.

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
9. Call `mcp__dethereal__validate_model_json` to check structural validity
10. Update `.dethernety/discovery-cache.json` if this is a multi-model project
11. Update state: `currentState` → `DISCOVERED`, add `DISCOVERED` to `completedStates`

If the model was created from a description (not IaC), discovery still scans the codebase for IaC corroboration. If no codebase context is available, skip to Step 3 with the description-derived structure.

---

## Step 3: Model Review

Run deterministic Pass 1 classification and review the discovered model.

1. Call `mcp__dethereal__get_classes(action: 'classify_components')` to run deterministic fuzzy matching against the platform's class library — this saves 3-5K tokens by eliminating LLM-side comparisons (D51)
2. For components not matched by the deterministic pass, match by name, type, and description against available classes
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
6. Call `mcp__dethereal__generate_attribute_stubs(directory_path)` to write class template attribute stubs for all classified elements

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
6. Validate: `mcp__dethereal__validate_model_json`

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
2. For each unclassified element:
   - Use boundary context — which boundary contains it, what neighbors are classified as
   - Consider connected data flows — protocols, data types
   - Peer inference — siblings in the same boundary likely have similar classes
3. Crown jewel tagging: match free-text crown jewel names from `scope.json` to components
4. Present batch confirmation table (same format as `/dethereal:classify`)
5. Quality gate: 100% STORE classification, 80% overall classification
6. Write classifications and crown jewel tags to model files. Call `mcp__dethereal__generate_attribute_stubs(directory_path)` to write class template attribute stubs for all classified elements

State: no transition — already at ENRICHING from Step 5.

---

## Step 7: Data Item Classification

Classify data items for boundary-crossing flows that carry sensitive data.

1. Identify cross-boundary flows without classified data items
2. For each sensitive flow, propose data items:
   - Use `compliance_drivers` from scope.json for regulatory mapping
   - Apply sensitivity tiers: Tier 1 (regulated PII, credentials), Tier 2 (internal business data), Tier 3 (public/declared data)
3. Present proposals:
   ```
   Data items for sensitive flows:
   | Flow | Data Item | Sensitivity | Compliance | Confirm? |
   |------|-----------|-------------|------------|----------|
   | User Login → Auth | User credentials | Tier 1 | SOC2, GDPR | Y |
   | API → DB | Customer records | Tier 1 | GDPR | Y |
   | API → Cache | Session tokens | Tier 2 | SOC2 | Y |
   ```
4. Write confirmed data items to `data-items.json`

State: no transition — already at ENRICHING.

---

## Step 8: Enrichment

Delegate to `Agent(security-enricher)` for comprehensive security attribute enrichment.

1. Pass model directory path to `Agent(security-enricher)`
2. The enricher handles:
   - Class-specific template attributes per element — template stubs are already on disk from `generate_attribute_stubs` (run during classification). The enricher reads the configuration guide from `.dethereal/class-cache/<classId>.json`, discovers values from code/IaC, asks the user for undiscoverable attributes, and sets all template fields (100% coverage)
   - Plugin-enrichment fields preserved via merge (`crown_jewel`, `credential_scope`, `mitre_attack_techniques`, `monitoring_tools`)
   - Credential enrichment (inventory → map to flows → STORE credential scope)
   - MITRE ATT&CK integration (3-step verification: search → validate → persist)
   - Auth failure mode capture (`deny`, `fallback`, `fail_open`)
   - Boundary enforcement attributes
   - Processing of `staleElements[]` first (if any exist from backward transitions)
3. Receive compact summary (enriched element count + template coverage metrics)
4. Read updated attribute files from disk

State: no transition — already at ENRICHING from Step 5.

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

Before pushing, verify Gate 2 (sync-blocking) criteria: manifest completeness, structure validity (≥1 boundary, ≥1 component, ≥1 data flow), reference integrity, no orphaned attribute files. Call `mcp__dethereal__validate_model_json(action: 'validate')`. If Gate 2 fails, show the specific failures and stop — do not push a broken model.

### Auth Check

Read `~/.dethernety/tokens.json`. Find the entry keyed by the platform URL (`DETHERNETY_URL` env var, default `http://localhost:3003`).

- If valid token: proceed
- If expired or missing: "Not authenticated. Run `/dethereal:login` first, or skip sync for now."
- If user skips: jump to README generation, then show final footer without sync-related next steps

### Execute Push

Check `manifest.model.id`:

- **First push** (no model.id): call `mcp__dethereal__import_model` with `directory_path`
- **Update** (has model.id): follow the sync skill's push flow — reconstruct sync.json if missing, run pre-push conflict detection, execute `mcp__dethereal__update_model` with `delete_orphaned: true`

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

1. Call `mcp__dethereal__manage_exposures(action: 'list')` to get platform-computed exposures
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
5. If user confirms: call `mcp__dethereal__manage_countermeasures` to create the links

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
