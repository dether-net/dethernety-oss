# Control Integration in the Threat Modeling Workflow

> Design analysis for integrating security controls into the Dethereal plugin's guided threat modeling workflow. Status: **implemented** — the six-sprint implementation shipped in April 2026. Two carve-outs survive: governance and procedural controls (§4, Category 4) are still deferred to their own design treatment, and §6.1's timing for greenfield Control creation is superseded by [CONTROL_LIBRARY.md](CONTROL_LIBRARY.md) — see the note in that section.

## Table of Contents

- [1. Problem Statement](#1-problem-statement)
- [2. Platform Control Architecture](#2-platform-control-architecture)
- [3. Current Gaps](#3-current-gaps)
- [4. Control Categories](#4-control-categories)
- [5. Approach Analysis](#5-approach-analysis)
- [6. Recommended Design](#6-recommended-design)
- [7. Resolved Design Questions](#7-resolved-design-questions)
- [8. Enrichment Prompt Design](#8-enrichment-prompt-design)
- [9. Two-Tier Reporting Format](#9-two-tier-reporting-format)
- [10. Implementation Phasing](#10-implementation-phasing)
- [11. Implementation Architecture](#11-implementation-architecture)
- [12. Known Gaps and Risks](#12-known-gaps-and-risks)

---

## 1. Problem Statement

During the guided threat modeling workflow, security controls are never assigned to model elements. The workflow captures security attributes (encryption, authentication, monitoring) during enrichment, but does not connect formal Control entities to components, data flows, or boundaries. This means:

1. **Analysis without defense context.** The platform's analysis engine doesn't know what defenses exist. Attack paths that are blocked by a firewall or gated by MFA appear as open as unprotected paths.
2. **Overstated risk.** The first analysis run produces findings that include threats already mitigated by existing controls. This creates a "cry wolf" effect that erodes trust in the tool.
3. **Incomplete model.** A threat model without controls is a vulnerability assessment, not a threat model. It answers "what could go wrong" but not "what is our residual risk."
4. **Quality ceiling.** The quality score hardcodes `control_coverage_rate = 0` locally. Models max at ~85/100 without controls, and the `/dethereal:surface` control gap analysis has nothing to work with.
5. **Crown jewel scoring gap.** The analysis engine's crown jewel formula includes `control_density` as a factor (15% weight). Without controls, this signal is absent.

---

## 2. Platform Control Architecture

The platform implements a three-layer control model:

```
Module -[HAS_CLASS]-> ControlClass            (template: "Encryption at Rest", "MFA", etc.)
                          | IS_INSTANCE_OF
                          v
                       Control                 (user-created, reusable, lives in folders)
                          |                         |
                    SUPPORTS (polymorphic)     HAS_COUNTERMEASURE
                          |                         |
                          v                         v
                  Model / Component /         Countermeasure
                  DataFlow / Boundary              |
                          |                   IS_COUNTERMEASURE_OF -> ControlClass
                    HAS_EXPOSURE              RESPONDS_WITH -> MitreAttackMitigation
                          |                   RESPONDS_WITH -> MitreDefendTechnique
                          v
                       Exposure -[EXPLOITED_BY]-> MitreAttackTechnique
```

### Layer 1: ControlClass (module-provided templates)

Defined by modules (e.g., `dethernety-general`). Each ControlClass has `supportedTypes` and `supportedCategories` defining which element types it can apply to, plus `template` and `guide` (custom resolvers resolved at runtime). Examples: Encryption at Rest, MFA, Input Validation, Network Segmentation.

### Layer 2: Control (user-created instances)

Reusable security controls created by users. A Control links to one or more ControlClasses via `IS_INSTANCE_OF` (e.g., a "Web Server Security Package" bundles TLS, input validation, and authentication classes). Each ControlClass has a configuration template (JSON Schema) and a guide — the same pattern as ComponentClass. When the user configures the ControlClass attributes on a Control, the platform's OPA/Rego policies evaluate them and **automatically generate Countermeasures** with the appropriate MITRE ATT&CK Mitigation and D3FEND Technique links. This happens at control creation/configuration time, not at element assignment time.

Controls are applied to elements via the polymorphic `SUPPORTS` relationship — the same control can protect a Component, DataFlow, SecurityBoundary, or Model.

### Layer 3: Countermeasure (platform-computed, automatic)

Countermeasures are **computed outputs**, like Exposures — not manually created entities. The symmetry is:

```
Component + ComponentClass + attributes  →  OPA/Rego  →  Exposures (automatic)
Control   + ControlClass   + attributes  →  OPA/Rego  →  Countermeasures (automatic)
```

Each Countermeasure is linked to its parent Control (`HAS_COUNTERMEASURE`), the ControlClass that triggered it (`IS_COUNTERMEASURE_OF`), and the relevant MITRE frameworks (`RESPONDS_WITH -> MitreAttackMitigation`, `RESPONDS_WITH -> MitreDefendTechnique`). These links are created by the platform module that provides the ControlClass — the plugin does not compute or create them.

When a Control is assigned to an element (SUPPORTS edge), the element inherits countermeasure coverage through the graph path:

```
(Element)<-[:SUPPORTS]-(Control)-[:HAS_COUNTERMEASURE]->(Countermeasure)-[:RESPONDS_WITH]->(MitreDefendTechnique)
```

The countermeasure chain exists on the Control before assignment. Assigning to an element is pure linking — no computation occurs at assignment time.

### Exposures (platform-computed, automatic)

Platform-computed vulnerabilities found by OPA/Rego policy evaluation against component class attributes. Linked to ATT&CK techniques via `EXPLOITED_BY`. The plugin can read exposures but cannot create or modify them — they are analysis outputs, not modeling inputs.

### The Controls-Exposures Symmetry

Controls and components follow the same platform pattern:

| | Components | Controls |
|---|-----------|----------|
| **Class** | ComponentClass | ControlClass |
| **Template** | JSON Schema for attributes | JSON Schema for attributes |
| **Guide** | How to obtain attribute values | How to configure control settings |
| **OPA evaluation** | Attributes → Exposures | Attributes → Countermeasures |
| **MITRE links** | Exposure → EXPLOITED_BY → ATT&CK Technique | Countermeasure → RESPONDS_WITH → D3FEND Technique |
| **Plugin's job** | Assign class, fill attributes | Assign class, fill attributes |
| **Plugin does NOT** | Generate exposures | Generate countermeasures |

This means the plugin treats control configuration exactly like component enrichment: assign the class, use the template/guide to discover attribute values, fill them in. The platform handles everything downstream.

### Existing MCP Tools

| Tool | Actions | Plugin's use during modeling |
|------|---------|------------------------------|
| `manage_controls` | list, get, create, update, delete | Browse existing controls. Create new controls with ControlClasses and attributes. Does NOT assign controls to model elements (no SUPPORTS edge creation). |
| `manage_countermeasures` | list, get | **Query only during modeling.** Countermeasures are auto-generated by the platform when control attributes are set. Use to verify what countermeasures a control provides. |
| `manage_exposures` | list, get | Read-only. Query platform-computed exposures. |

### SUPPORTS Relationship Direction

The SUPPORTS relationship is owned by the Control side (`Control -[SUPPORTS]-> Element`), not the Element side. This is correct: one Control can SUPPORTS many elements across many models (it is a shared organizational resource). If the edge were owned by elements, deleting a model would cascade-delete the control's relationships.

The practical consequence: auto-generated GraphQL mutations for Component/DataFlow/Boundary do not accept control input. Controls must be assigned either through the Control entity's mutation or through the import pipeline.

---

## 3. Current Gaps

### 3.1 Local JSON supports controls, but the engine ignores them

The split-file schemas define `controls?: ControlReference[]` on Component, Boundary, and DataFlow. The historical type is `ControlReference = { id: string, name?: string }`. `source` is documented on `controls[]` references in [§6.4](#64-local-json-format) today but is dropped on export — the [CONTROL_LIBRARY.md §9](CONTROL_LIBRARY.md#9-what-needs-building) work adds passthrough in `dt-export-split.ts` so the type matches reality (`{ id: string, name?: string, source?: 'discovered' | 'declared' | 'both' }`). The export pipeline includes the rest of the reference. But the update pipeline (`DtUpdateSplit`) silently drops them — `updateComponent()`, `updateBoundary()`, and `updateDataFlow()` do not process control references. Import-export round-trip is broken for controls.

Note: The import pipeline (`DtImportSplit`) **does** work — `resolveControls()` resolves references by ID then name and creates SUPPORTS edges via `setElementControlsDirect()`. The gap is specifically in the update path.

### 3.2 No MCP tool assigns controls to elements

`manage_controls` creates and manages Control entities but has no `assign` action that creates the `SUPPORTS` edge between a Control and a model element. There is no tool that performs this operation.

### 3.3 No workflow step captures control assignments

The 11-step guided workflow has no step that asks "what controls protect this component/boundary/flow?" Enrichment captures security attributes (authentication type, encryption, monitoring tools), but these are element properties, not formal control assignments.

### 3.4 Quality score hardcoded to zero

In `validate-model.tool.ts`, `control_coverage_rate` is hardcoded to `0` for offline scoring. The formula gives this factor 10% weight, capping the offline score at ~90/100 even for otherwise complete models.

### 3.5 Enrichment attributes don't feed edge weights

The analysis engine's edge weight computation reads `authType` and protocol from graph topology, but does not currently consume the full set of enrichment attributes (encryption strength, auth failure mode, monitoring coverage) for path cost calculation. This means even well-enriched models produce inaccurate path costs.

---

## 4. Control Categories

Not all controls are equal. The "enrichment attributes ARE controls" argument holds for one category but breaks down for the rest. Four distinct categories exist, each requiring different treatment:

### Category 1: Inherent configuration properties

**Examples:** `encryption_in_transit: TLS 1.3`, `implicit_deny_enabled: true`, `egress_filtering: allow_list`

These are attributes of the element itself, discoverable from code and IaC. The analysis engine can infer control presence directly from attribute values. No separate control entity is needed — the attribute IS the evidence.

**Workflow:** Already captured during enrichment. No additional step required.

### Category 2: Distinct enforcement entities

**Examples:** Firewall, WAF, IDS/IPS, API gateway with rate limiting

These are separate entities with their own lifecycle, configuration surface, failure modes, and bypass vulnerabilities. A firewall is not a property of the network segment — it is a Control node with its own ControlClass, attributes (rule count, last audit date, firmware version), and auto-generated countermeasures with D3FEND mappings.

Flattening "there is a firewall here" into an enrichment attribute loses the entire countermeasure chain: the ControlClass's OPA policies evaluate firewall attributes and generate specific countermeasures (e.g., "Network Filtering" → D3-NF) that would not exist as attribute values.

**Workflow:** Requires explicit control assignment. The user either assigns an existing Control from the org library (SUPPORTS edge) or creates a new Control (assign ControlClass, configure attributes, platform auto-generates countermeasures, then assign to element).

### Category 3: Detection and response controls

**Examples:** SIEM integration, NDR, log correlation, automated alerting, SOC monitoring

The enrichment step already captures `monitoring_tools: ["SIEM", "NDR"]` as a string array, but a formal detection Control with a ControlClass provides more: the class's OPA policies evaluate detection attributes (coverage scope, alert fidelity, response automation) and auto-generate countermeasures with D3FEND technique links (e.g., "Network Traffic Analysis" → D3-NTA). The `monitoring_tools` string array cannot trigger countermeasure generation — only a configured Control can.

**Workflow:** Partially captured by enrichment (the `monitoring_tools` attribute). Full formalization as Controls requires explicit assignment. The analysis engine's stealth modifier (`+1.5 * detection_coverage`) benefits from the richer signal that configured Controls provide.

### Category 4: Governance and procedural controls

**Examples:** Patch management policy, access review cadence, change management process, security training, incident response procedures

Not discoverable from code or infrastructure. Require human declaration. Have effectiveness that depends on organizational discipline. Map to frameworks like ISO 27001, NIST CSF, SOC2 — not to technical configurations.

**Workflow:** Requires interactive conversation with the user. Cannot be auto-inferred. This is the most complex category and may require its own design treatment (deferred to a future iteration).

### Summary

| Category | Discoverable? | Attributes sufficient? | Needs explicit control? |
|----------|---------------|----------------------|------------------------|
| 1. Inherent config | Yes (IaC/code) | Yes | No |
| 2. Enforcement entities | Partially (infra scan) | No | Yes |
| 3. Detection/response | Partially (`monitoring_tools`) | No | Yes |
| 4. Governance/procedural | No | No | Yes (interactive) |

Categories 2-4 require explicit Control entities with ControlClasses. The platform auto-generates countermeasures (with D3FEND/ATT&CK links) from the control's configured attributes — the plugin's job is to assign the class and fill attributes, same as with components.

---

## 5. Approach Analysis

Four approaches were evaluated by security architect, process architect, threat modeling methodology, and security operations expert reviews.

### Approach A: Local intent capture, materialize at sync

During enrichment, capture control references in local JSON (`controls: [{ id, name }]` on elements). At sync time, `resolveControls()` resolves references to platform controls and creates SUPPORTS edges.

| Pros | Cons |
|------|------|
| Works offline — aligns with local-first design principle | No quality score benefit until sync |
| Fits existing sync architecture — import pipeline already handles it | Reference resolution can fail (control renamed/deleted) |
| Control intent is part of the version-controlled model artifact | Requires fixing the update pipeline bug |
| Minimal new tool surface needed | |

### Approach B: Online control assignment step

Add a workflow step that queries the platform for existing controls, presents relevant ones, and assigns them immediately. Requires connectivity.

| Pros | Cons |
|------|------|
| Real SUPPORTS edges created immediately | Breaks the offline workflow promise |
| Quality score updates in real-time | Adds connectivity dependency to the longest workflow phase |
| Analysis-ready without sync | Contradicts local-first design principle |

### Approach C: Hybrid — local intent + eager partial sync

Capture control references locally, offer optional "sync controls" sub-step that pushes just control assignments.

| Pros | Cons |
|------|------|
| Balances offline capability with early integration | Introduces a third sync mode with its own conflict surface |
| Optional connectivity | "Controls synced but model not synced" state is untracked |
| | Over-engineered for V1 |

### Approach D: Post-analysis control recommendation

Don't assign controls during modeling. After analysis produces exposures, recommend controls that address unmitigated gaps.

| Pros | Cons |
|------|------|
| Controls driven by actual findings, not guesswork | First analysis run overstates risk (cry-wolf problem) |
| Leverages platform's automatic countermeasure generation | Doesn't capture controls already in place |
| Natural for greenfield scenarios | Two-pass workflow: analyze → assign controls → re-analyze |

### Expert Consensus

All four expert reviews converge on the same recommendation:

- **Primary:** Approach A (local intent capture, materialize at sync)
- **Complementary:** Approach D retained for post-analysis gap-filling
- **Reject for V1:** Approach B (breaks offline), Approach C (over-engineered)

Key arguments:

1. **Security Architect:** The import pipeline's `resolveControls()` already works — less new code than expected. But the update pipeline bug is blocking.
2. **Process Architect:** Controls belong inside the existing enrichment step (Step 7), not as a new workflow step. Can run in parallel with credential enrichment.
3. **Threat Modeler:** Enrichment already does 80% of the work for Category 1 controls. The gap is the formal bridge for Categories 2-4.
4. **SecOps/CISO:** The cry-wolf problem (Approach D alone) has killed tool adoption at organizations. First analysis credibility is a product adoption risk. Two-tier reporting (inferred coverage from attributes + formal coverage from SUPPORTS edges) addresses both operational and governance needs.

---

## 6. Recommended Design

### 6.1 Two-path control integration

> **Superseded in part by [CONTROL_LIBRARY.md](CONTROL_LIBRARY.md).** The two-path structure (brownfield / greenfield) below is correct, but the **timing** of greenfield Control creation has changed: instead of calling `manage_controls(action: 'create')` eagerly during the control pass, the agent writes a `controls/<temp-id>.json` file with `lifecycle: "greenfield"` and defers the platform create to `/dethereal:sync push`. Per-instance attributes live in that file, not in `structure.json`. The reference shape in [§6.4](#64-local-json-format) (`{id, name, source}`) is unchanged. See [CONTROL_LIBRARY.md §5](CONTROL_LIBRARY.md#5-lifecycle-greenfield--brownfield) for the full lifecycle and [§7](CONTROL_LIBRARY.md#7-sync-flows) for the sync flows.

**Path 1 — Auto-inferred (Category 1):** The analysis engine derives control presence from enrichment attributes. When a component has `encryption_in_transit: TLS 1.3`, the engine treats this as evidence of an encryption control for edge weight computation. No user action required, no Control entity needed.

**Path 2 — Declared (Categories 2-4):** Users explicitly assign Control entities to elements during enrichment. Two sub-paths:

- **Brownfield (existing controls):** The org already has Controls in their platform library with ControlClasses configured and countermeasures auto-generated. The plugin browses, selects, and assigns them to elements (SUPPORTS edge). The countermeasure chain already exists on the Control — assignment is pure linking. An auto-pull materialises a `controls/<id>.json` file as a local cache ([CONTROL_LIBRARY.md §7](CONTROL_LIBRARY.md#pull-auto-at-start-of-control-pass)).
- **Greenfield (new controls):** The agent writes `controls/<temp-id>.json` with `lifecycle: "greenfield"`, populates `classes[]` (each with a ControlClass binding and per-instance attributes derived from observed config or the class template/guide), and sets the `controls[]` reference in `structure.json` / `dataflows.json` to the same temp id. On `/dethereal:sync push`, the pipeline creates the Control on the platform, sets attributes per class, assigns SUPPORTS edges, and writes the server-generated id back into the local files. The platform auto-generates countermeasures once the class-bound attributes land.

In both cases, control references in `structure.json` / `dataflows.json` are `{ id, name, source }` — resolved to platform Controls at sync, materialized as SUPPORTS edges. Per-instance attributes are NOT inlined in these files; they live in `controls/<id>.json`.

### 6.2 Workflow placement

Control assignment is a **focus mode** within the existing enrichment step (Step 8 of the guided workflow), invoked as `/dethereal:enrich --focus controls`. It does not warrant a new top-level workflow step.

The focus mode approach (rather than inline sub-steps) is driven by three Claude Code implementation constraints:

1. **Turn budget:** The security-enricher agent has `maxTurns: 40`. Current enrichment already uses 20-30 turns for a 15-component model. Embedding control prompts inline risks exhausting the budget before reaching later steps.
2. **Instruction linearity:** Splitting control sub-steps across the enrichment flow (enforcement controls after Step 4, detection controls after Step 9) creates non-linear control flow that degrades LLM instruction-following.
3. **Instruction size:** The security-enricher is already ~360 lines. Adding ~150 lines of control instructions inline would exceed the effective limit for reliable agent behavior. The `--focus controls` mode loads control instructions from a separate file (`@docs/controls-enrichment.md`) only when invoked.

The enrichment step already captures the security attributes that inform control selection. The `--focus controls` pass runs after main enrichment is complete — the agent has the full context of what protections each element has (attributes), and asks what additional protective systems exist (controls).

**Execution model:** The `--focus controls` pass is a **separate agent invocation** with its own 40-turn budget, not a continuation of the main enrichment session. Main enrichment consumes 20-30 turns; the control pass cannot share that budget. In the guided workflow (`/dethereal:threat-model`), the orchestrating skill spawns the control pass as a new enricher invocation after main enrichment completes, with a session break offered to the user:

```
Enrichment complete. Quality: 72/100.
Ready for control assignment (~6 prompts). Continue now or resume later?
  [continue] Run control pass now
  [later]    Resume with /dethereal:enrich --focus controls
```

**Instruction loading:** The `@docs/controls-enrichment.md` reference goes in the enrich skill's `SKILL.md` under the `--focus controls` conditional block, not in the agent's base instructions. This ensures control instructions load only when the focus mode is invoked and do not consume context on regular enrichment runs.

### 6.3 User interaction model

#### Brownfield (existing control library)

When the platform is reachable, query existing controls via `manage_controls(action: 'list')`. Filter by relevance using the control's `controlClasses` — each class has `supportedTypes` and `supportedCategories` that indicate which element types it can protect. Note: the current `GET_CONTROLS` GraphQL query returns class names but not `supportedTypes`; the query must be extended to include these fields, or the agent filters by class name heuristics.

##### Multi-class control evaluation

A Control can have multiple ControlClasses via `IS_INSTANCE_OF` edges (e.g., a "Web Server Security Package" bundles TLS, input validation, and authentication classes). When searching for a control by a needed class, the agent must evaluate the control's **full class profile** — not just the matching class:

1. **Not all classes on a control are necessarily applicable.** A control with classes `[WAF, CloudFront-WAF-Config, AWS-SecurityGroup-Rules]` is a strong match for an AWS environment but a poor fit for Azure infrastructure — two of its three classes are irrelevant and configured for the wrong platform.

2. **Relevance requires checking other classes.** A control can only be reused if its non-matching classes are also relevant to the current context (element type, technology stack, deployment environment) and properly configured for the actual use. A PostgreSQL-specific encryption control (`[Encryption-at-Rest, PostgreSQL-TDE, Key-Management-KMS]`) found via the `Encryption-at-Rest` class is only applicable if the target element is actually PostgreSQL.

3. **When multiple controls match, select the most applicable.** The best-fit control is the one with the most relevant, properly-configured classes for the current context:
   - **All classes relevant and configured** — strong match (assign directly)
   - **Some classes relevant, others neutral** — good match (assign, note unused classes)
   - **Some classes irrelevant but unconfigured** — acceptable (unused classes generate no countermeasures)
   - **Some classes irrelevant AND configured** — **weak match / disqualifier** (misconfigured classes actively generate inaccurate countermeasures via OPA/Rego, which is worse than no control — creates false confidence)

##### Ranking: backend-delegated, not agent-reasoned

The multi-class evaluation is **deterministic scoring**, not a judgment call. The backend and MCP tool layer compute it; the agent presents the result. Three layers collaborate:

**Layer 1 — Schema `@cypher` query (`controlCandidatesForType`):** Returns controls whose ControlClasses have `supportedTypes` matching the target element type, with countermeasure counts per class (proxy for "configured") and already-assigned element IDs. Single Cypher traversal, no custom resolver needed.

**Layer 2 — MCP tool (`manage_controls` `rank` action):** Accepts element type, element class ID/module (from local files), and module scope. Calls the schema query, then enriches with local context:
- `compatible` = `supportedTypes` includes element type (from query result)
- `configured` = countermeasure count > 0 for this class (from query result)
- `sameDomain` = control class module matches element class module (local + query)
- `alreadyAssigned` = element ID in assigned element list (local + query)

> **Implementation status:** the shipped `rank` action implements `compatible` + `configured` scoring only. The `sameDomain` and element-class inputs are **not implemented** — the tool's input schema accepts `element_types` and `module_id`, not element class ids. The control pass compensates by pre-populating proposals from attribute evidence (see controls-enrichment.md Step 1 prerequisites) rather than per-element class context.

Scoring formula:

```
score = compatible_and_configured / total_classes
      - penalty * incompatible_and_configured / total_classes

where:
  compatible_and_configured = classes with supportedTypes match AND countermeasures > 0
  incompatible_and_configured = classes WITHOUT supportedTypes match BUT countermeasures > 0
  penalty = 1.0 (misconfigured classes fully offset a compatible class)
```

Three buckets:
- **compatible + configured** → contributes positively (this class helps)
- **incompatible + unconfigured** → neutral (dormant, generates nothing)
- **incompatible + configured** → penalty (generates wrong countermeasures)

**Relevance label thresholds:**

| Label | Score range | Additional constraint | Meaning |
|-------|-----------|----------------------|---------|
| **strong** | >= 0.8 | `incompatible_and_configured == 0` | All relevant classes fit; no wrong countermeasures |
| **good** | >= 0.5 | — | Majority of classes fit; minor gaps |
| **weak** | < 0.5 | — | More noise than signal; recommend creating new |

The `strong` label requires zero misconfigured classes regardless of score. A control with 3 compatible + 1 misconfigured class scores `3/4 - 1.0*1/4 = 0.5` ("good", not "strong") — the misconfigured class prevents the strong label both by score and by the explicit constraint. This prevents false confidence: a control labeled "strong" never generates inaccurate countermeasures.

Returns top 5 candidates pre-ranked with relevance label, class-level fit details, and pre-loaded countermeasure summaries.

**Layer 3 — Agent:** Presents the pre-ranked table. Asks yes/no. No scoring loop, no unbounded reasoning. The agent's only judgment call is whether to recommend creating a new control when all candidates are weak.

**Post-assignment verification:** After assigning a control, the countermeasures it generates are already in the `manage_controls` response (pre-loaded by `findControls`). The agent presents these in the confirmation: "This control provides: [Network Filtering (D3-NF), Packet Filtering (D3-PF)]. Assign?" This closes the verification gap without an additional tool call.

**Why not create a new control instead?** When no existing control scores above `weak` (all candidates have incompatible-and-configured classes), the agent recommends creating a new control with only the applicable classes rather than reusing a poor match.

Present as a batch table with class relevance visible:

```
## Control Assignment — Tier 1 Components (Crown Jewels)

Existing controls from your library:

| # | Component | Suggested Control | Relevance | Classes (relevant / total) | Assign? |
|---|-----------|-------------------|-----------|---------------------------|---------|
| 1 | payment-db | DB Encryption (PG) | strong | 3/3 (Encryption-at-Rest, PG-TDE, KMS) | Y |
| 2 | payment-db | SOC Monitoring | good | 2/3 (SIEM, Log-Correlation; NDR N/A) | Y |
| 3 | api-gateway | WAF Protection (AWS) | strong | 3/3 (WAF, CloudFront, AWS-SG) | Y |
| 4 | api-gateway | WAF Protection (Generic) | weak | 1/2 (WAF; Azure-FrontDoor N/A) | ? |

Additional controls not in your library? (describe or "none")
```

#### Greenfield (no existing controls)

When no controls exist or the platform is unreachable, capture name-only references:

```
What additional security controls protect these components beyond their configured attributes?
(Firewalls, WAFs, monitoring, security policies, etc.)

| # | Component | Current Attributes | Additional Controls? |
|---|-----------|-------------------|---------------------|
| 1 | payment-db | encryption_at_rest: AES-256, auth: password | ? |
| 2 | api-gateway | tls: 1.3, auth: OAuth2 | ? |
```

Write references as `{ id: null, name: "WAF Protection" }`. At sync time, `resolveControls()` attempts name matching. Unresolved references surface as warnings: "Control 'WAF Protection' not found on platform. Create it or adjust the name."

### 6.4 Local JSON format

Control references use the existing `ControlReference` schema (already defined, already exported, currently ignored by the update pipeline). Controls can be stored on **boundaries, components, or data flows** — the schema supports `controls?: ControlReference[]` on all three.

**Boundary-level assignment (preferred for enforcement controls):** When a control protects an entire boundary (e.g., a firewall protecting a DMZ), store the control reference on the boundary in `structure.json`, not on each individual component. This matches how security teams think ("WAF protects the DMZ zone"), avoids stale fan-out when components are added later, and creates a `SUPPORTS -> SecurityBoundary` edge at sync — which the platform supports natively.

```json
// structure.json — boundary with enforcement controls
{
  "id": "boundary-dmz",
  "name": "DMZ",
  "type": "BOUNDARY",
  "controls": [
    { "id": "ctrl-waf", "name": "WAF Protection", "source": "declared" },
    { "id": null, "name": "Perimeter Firewall", "source": "declared" }
  ],
  "children": [
    {
      "id": "comp-api-gateway",
      "name": "API Gateway",
      "type": "PROCESS",
      "controls": [
        { "id": "ctrl-rate-limit", "name": "Rate Limiting", "source": "declared" }
      ]
    }
  ]
}
```

**Element-level assignment (for component-specific or flow-specific controls):**

```json
// structure.json — component with specific controls
{
  "id": "comp-payment-db",
  "name": "Payment Database",
  "type": "STORE",
  "classData": { "id": "class-postgresql" },
  "controls": [
    { "id": "ctrl-db-encryption", "name": "Database Encryption Package", "source": "discovered" },
    { "id": null, "name": "SOC Monitoring", "source": "declared" }
  ]
}

// dataflows.json — flow with controls
{
  "id": "flow-api-to-db",
  "source": { "id": "comp-api" },
  "target": { "id": "comp-payment-db" },
  "controls": [
    { "id": "ctrl-tls", "name": "TLS Encryption", "source": "discovered" }
  ]
}
```

**Assignment level guidance:**

| Control type | Preferred assignment level | Rationale |
|-------------|---------------------------|-----------|
| Firewall, WAF, IDS/IPS | Boundary | Protects a zone, not individual components |
| Database encryption, application auth | Component | Specific to the element's configuration |
| TLS, mTLS | Data flow | Protects a specific communication path |
| SIEM, monitoring | Boundary or component | Depends on coverage scope |

### 6.5 Quality score integration

Replace the hardcoded `control_coverage_rate = 0` with a two-tier local computation:

1. **Attribute-inferred coverage (Phase 1):** Count classified elements with at least one positive security attribute (per the mapping table in Section 10, Phase 1). This is the offline-only baseline.
2. **Formal control coverage (Phase 2+):** Count classified elements that are "control-covered" divided by total classified elements. This supplements attribute-inferred coverage once the enrichment workflow captures control references.

An element is **control-covered** when any of the following is true:
- It has a non-empty `controls[]` array (even with null IDs) — directly assigned
- It is a child of a boundary that has a non-empty `controls[]` array — **boundary-inherited coverage**

Boundary-inherited coverage is critical: Section 6.4 recommends boundary-level assignment for enforcement controls (`SUPPORTS → SecurityBoundary`). A firewall assigned to the DMZ boundary protects all components inside that boundary. Without inheritance, the quality score would show 0% formal coverage on those components despite them being protected — a misleading signal that contradicts the recommended assignment pattern.

**Implementation:** The `computeQuality` method already reads `structure.json` and walks the boundary tree (it collects component IDs recursively). When counting formal coverage, walk the tree and propagate `controls[]` from boundaries to their children. A component counts as covered if `component.controls.length > 0` OR `parentBoundary.controls.length > 0` (checked recursively up the boundary hierarchy).

The quality score should use the **maximum** of the two computations (attribute-inferred and formal) for each element: an element with `encryption_in_transit: TLS 1.3` and no `controls[]` still counts as covered (attribute-inferred). An element with a `controls[]` entry (directly or boundary-inherited) but no enrichment attributes also counts (formally assigned).

**Platform-side note:** The `get_control_gaps` backend query must also traverse boundary-level SUPPORTS edges. When checking whether a component is mitigated, the Phase 2 Cypher should match both direct `(Control)-[:SUPPORTS]->(Component)` and indirect `(Control)-[:SUPPORTS]->(Boundary)<-[:BELONGS_TO]-(Component)` paths. Without this, post-analysis gap recommendations will suggest redundant controls for components already protected by boundary-level assignments.

**Cross-document note:** THREAT_MODELING_WORKFLOW.md Section 8 defines `control_coverage_rate` as "percentage of classified components that have at least one DTControlClass control assigned via the platform." This definition applies to platform-side scoring (after sync). The local computation described here is a pre-sync approximation using attribute inference, local JSON references, and boundary inheritance. The workflow doc should be updated to reflect the two-tier approach when this design is implemented.

### 6.6 Post-analysis complementary path (Approach D)

After sync and analysis, the `/dethereal:surface` skill identifies unmitigated exposures and recommends controls. This is the second pass that catches what the user missed during enrichment.

The platform has the full MITRE ATT&CK and D3FEND frameworks loaded in the graph database and connected to each other (`mitre-frameworks` module). This means the exposure→countermeasure loop can be closed with a single graph traversal:

```
Exposure -[:EXPLOITED_BY]-> ATT&CK Technique
                              ↑
              [:MITIGATION_DEFENDS_AGAINST_TECHNIQUE]
                              |
                       ATT&CK Mitigation
                              ↑
                      [:RESPONDS_WITH]
                              |
                        Countermeasure -[:RESPONDS_WITH]-> D3FEND Technique
                              ↑
                   [:HAS_COUNTERMEASURE]
                              |
                           Control -[:SUPPORTS]-> Element
```

This chain enables **framework-grounded recommendations**: starting from an unmitigated exposure, the backend walks the graph to find which ATT&CK Mitigations defend against the technique, which Countermeasures implement those mitigations, and which Controls (or ControlClasses) produce those countermeasures. The recommendation is a deterministic graph query grounded in the MITRE frameworks — not LLM-generated guesswork. However, the MITRE data has known coverage gaps (see "Chain completeness" below), and ATT&CK Mitigations are intentionally coarse (M1032 "Multi-factor Authentication" links to dozens of techniques), so recommendations should be treated as ranked candidates, not prescriptions.

**Chain completeness:** The `get_control_gaps` backend distinguishes three states for unmitigated exposures:

1. **Unmitigated, addressable** — ATT&CK Mitigations exist and at least one installed module's ControlClass covers them. Actionable: assign or create a control.
2. **Unmitigated, unaddressable (module gap)** — ATT&CK Mitigations exist but no installed module's ControlClass produces countermeasures for them. Actionable for module authors, not for users. The backend returns these separately so the agent can present: "No ControlClass covers mitigation M1032 in your installed modules."
3. **Unmitigated, no MITRE chain** — Exposure has no `EXPLOITED_BY` link to an ATT&CK Technique, or the technique has no mapped mitigations. Not actionable through the framework. These count toward `totalExposures` but not toward any coverage tier.

**Type-compatible filtering:** The `get_control_gaps` Phase 3 Cypher filters recommended controls by `ControlClass.supportedTypes` compatibility with the affected element types. A database-tier MFA control is not recommended for an API gateway element. This is a backend-side filter (one-line `WHERE` in the existing Cypher), not an agent-side evaluation.

**Workflow (via backend `get_control_gaps` tool — see Section 11):**

1. Agent calls `get_control_gaps(model_id)` — a single MCP tool call
2. Backend traverses the full chain, returns: unmitigated exposures (partitioned into addressable and unaddressable), ranked type-compatible candidate controls, and MITRE technique/mitigation/D3FEND context for each
3. Agent presents the top recommendations to the user: "Exposure 'Valid Accounts' (T1078) is unmitigated. MITRE recommends 'Multi-factor Authentication' (M1032 / D3-MFA). Your org has ControlClass 'MFA' available. Create a control?"
4. User confirms — agent assigns Controls to elements

This replaces what would otherwise be 20+ sequential MCP tool calls (N exposure queries + M countermeasure queries + agent-side diffing) with a single backend-computed result. The agent's job is presentation and confirmation, not graph traversal.

### 6.7 Two-tier reporting

Analysis output should distinguish:

- **Inferred coverage:** "Based on enrichment data, 80% of components have authentication configured and 65% have encryption." Derived from security attributes. Available without formal control assignment.
- **Formal coverage:** "15 controls formally assigned, covering 12 of 18 components." Derived from SUPPORTS edges. Required for compliance reporting (SOC2, ISO 27001).

Board-level presentations need both: the first is a security posture snapshot, the second is a governance maturity indicator.

---

## 7. Resolved Design Questions

Four design questions were evaluated by security architect, process architect, threat modeler, and security operations (IR Lead + CISO) expert reviews. All four experts converged on the same positions.

### Q1: Governance controls (Category 4) — Defer

**Decision:** Defer formal governance control integration. Capture as free-text placeholder only.

**Rationale:** Governance controls (patch management, access reviews, change management) span multiple elements and require model-level or boundary-level assignment, not per-component assignment. Shoehorning them into the per-element enrichment loop creates variability in step duration and complexity. Their effectiveness depends on organizational discipline, which a code-analysis tool cannot verify. Premature governance control inclusion risks false confidence — teams mark "patch management: active" when their actual patch cadence is 6 months.

**V1 placeholder:** The security-enricher captures a single free-text prompt during enrichment: "Are there organizational security policies that apply to this system?" Responses are recorded as `declared_governance_controls: string[]` in `.dethereal/scope.json`. No graph entities, no SUPPORTS edges, no quality score impact — just a record that governance controls were acknowledged.

**Future direction:** When formal governance control support lands, these controls should use `SUPPORTS -> SecurityBoundary` or `SUPPORTS -> Model` edges, never element-level edges. This aligns with how NIST CSF and ISO 27001 scope administrative controls — they apply at organizational or system boundaries, not individual components.

### Q2: Control effectiveness scoring — Not a plugin concern

**Decision:** Do not prompt users for effectiveness scores. Effectiveness is derived from ControlClass attributes by the platform's OPA/Rego policies, not manually assessed.

**Rationale:** This question was based on a misunderstanding. Controls follow the same pattern as components: the ControlClass defines a template (JSON Schema), the user fills in attributes using the class guide, and the platform's OPA policies evaluate those attributes to generate countermeasures with appropriate effectiveness scores. The plugin's job is to configure the attributes correctly — the platform computes effectiveness from them.

Self-assessed effectiveness scoring would also be unreliable. Organizations routinely rate controls at 90% effectiveness while penetration tests bypass them in minutes. The platform's deterministic evaluation against configured attributes is more trustworthy.

**Implementation:** When creating new Controls (greenfield path), the plugin uses the ControlClass template/guide to configure attributes — same UX as component enrichment. The platform derives effectiveness from the attribute values. No separate effectiveness prompt needed.

### Q3: Countermeasure generation — Already handled by the platform

**Decision:** The plugin does not generate countermeasures. The platform generates them automatically when Control attributes are configured.

**Rationale:** This question was based on a misunderstanding. Countermeasures are not manually created — they are **computed outputs**, generated by the platform's OPA/Rego policies when a Control's ControlClass attributes are set. The symmetry is exact:

- Setting **component** attributes → platform generates **Exposures**
- Setting **control** attributes → platform generates **Countermeasures**

The plugin's role is the same in both cases: assign the class, fill in the attributes. The platform handles countermeasure generation, MITRE D3FEND linking, and ATT&CK Mitigation mapping. The `manage_countermeasures` tool is used to **query** generated countermeasures, not to create them during modeling.

**Implementation:** No countermeasure creation logic in the plugin. When viewing control coverage (e.g., in `/dethereal:surface`), query `manage_countermeasures(action: 'list', control_id: '...')` to show what countermeasures a control provides.

### Q4: Control source tracking — Implement for V1

**Decision:** Implement `source: "discovered" | "declared" | "both"` on `ControlReference` in local JSON. No platform schema migration required.

**Rationale:** This distinction is load-bearing for two critical features:
1. **Analysis confidence:** The engine should apply a confidence discount to declared-only controls for edge weight computation (e.g., 0.7x for declared vs 1.0x for discovered). Discovered controls represent verified implementation; declared controls represent security intent.
2. **Compliance reporting:** SOC2 Type I auditors distinguish between implemented and planned controls. The `source` field enables this distinction in the two-tier reporting output.

**Implementation:** Add `source?: "discovered" | "declared" | "both"` to `ControlReference` in the local JSON schema. The security-enricher sets `source: "declared"` for user-stated controls and `source: "discovered"` when controls are inferred from IaC/code attributes. Promote to a platform schema field after V1 validates the signal's usefulness.

```json
{
  "controls": [
    { "id": "ctrl-tls", "name": "TLS Encryption", "source": "discovered" },
    { "id": null, "name": "WAF Protection", "source": "declared" }
  ]
}
```

---

## 8. Enrichment Prompt Design

Control assignment runs as a **focus mode** (`/dethereal:enrich --focus controls`) — a separate pass after main enrichment is complete. This avoids the turn budget, instruction bloat, and split-step ordering problems of inline embedding (see Section 6.2). The control pass has access to all enrichment data (attributes, monitoring tools, credentials) since main enrichment has already run.

The prompts are designed to minimize fatigue while capturing Categories 2-4. The total is **B + 2 prompts** (B = boundary count, typically 3-5). For a typical 4-boundary model, that is 6 prompts.

### Step 1 — Enforcement Controls (Category 2)

**Batched per boundary**, not per component. Enforcement entities (firewalls, WAFs, IDS/IPS) typically sit at boundaries, not at individual components. This reduces N component-level prompts to B boundary-level prompts.

```
## Security Controls — [Boundary Name]

What enforcement controls protect components in this boundary?
(Firewalls, WAFs, API gateways with security rules, IDS/IPS, network access controls)

| # | Control | Protects | Type |
|---|---------|----------|------|
| ? | ?       | all / specific components | firewall / WAF / IDS / other |

Enter controls or "none" to skip.
```

For boundary-scoped controls (e.g., "this firewall protects the entire DMZ"), the agent writes the control reference to the **boundary** entry in `structure.json`. For controls protecting specific components, the agent writes to the component entry. See Section 6.4 for assignment level guidance.

If the platform is reachable, the agent calls `manage_controls(action: 'rank', element_type: '<boundary-type>', module_ids: [...])` to get pre-ranked control candidates with class-level fit details (Section 6.3). The MCP tool returns top 5 candidates scored and labeled (strong/good/weak), with countermeasure summaries pre-loaded. The agent presents the table directly — no scoring loop needed. If no existing control scores above `weak`, the agent recommends creating a new one with only the applicable classes. Existing controls that are assigned already have countermeasures generated — assigning them is pure linking, immediately providing countermeasure coverage on the element.

**Error recovery:** If `manage_controls(action: 'rank')` fails (platform unreachable or error), fall back to the greenfield prompts (name-only references). Do not retry or stall.

### Step 2 — Detection and Response Controls (Category 3)

**One global prompt**, pre-populated from `monitoring_tools` data captured during main enrichment. Since the control pass runs after main enrichment, `monitoring_tools` is always available — no ordering dependency. This turns an open-ended question into a confirmation task — dramatically lower cognitive load.

```
## Detection & Response Coverage

Monitoring tools captured during enrichment:

| # | Tool | Components Covered | Detection Scope | Assign as Control? |
|---|------|-------------------|-----------------|-------------------|
| 1 | SIEM | api-server, db    | network, auth   | Y/N |
| 2 | EDR  | api-server        | endpoint        | Y/N |

Additional detection controls? (SOC monitoring, NDR, automated response, or "none")
```

### Step 3 — Governance Placeholder (Category 4, V1 only)

**Single prompt, once per model.** No graph entities created — documentation only.

```
Any organizational security policies apply to this system?
(patch management, access reviews, change control, incident response)

Noted for documentation — formal governance control mapping in a future version.
```

Responses written to `.dethereal/scope.json` as `declared_governance_controls: string[]`.

### Prompt Sequence

The control focus pass runs as a separate agent invocation (own 40-turn budget) in a linear sequence with **incremental persistence** — control references are written to local JSON after each boundary completes, not at the end:

```
/dethereal:enrich --focus controls
  1. Read model files + attribute files (context loading)
  2. Step 1: For each boundary (Category 2):
     a. Rank or prompt for enforcement controls
     b. Write control references to structure.json  ← checkpoint
     - If boundary_count == 0: single global enforcement prompt (Gap 6 mitigation)
     - If boundary_count > 6: tiered prompt — crown-jewel boundaries first (Gap 8)
  3. Step 2: Detection controls — pre-populated from monitoring_tools (Category 3)
     a. Write detection control references  ← checkpoint
  4. Step 3: Governance placeholder (Category 4)
  5. Validate and report quality score
```

**Incremental persistence rationale:** Claude Code agents cannot detect their remaining turn count — the harness terminates them at the limit. If the agent is cut off at turn 38, boundaries 1-4 are already persisted because each boundary writes its results immediately. The re-run behavior (Section 8, "Re-run behavior") handles resumption: previously declared controls appear as "currently assigned" and the agent continues with remaining boundaries.

### Turn Budget Breakdown

Turn counts use tool-call accounting (each MCP call + file read/write = 1 turn), not prompt counting.

The `rank` action accepts an array of element types (`element_types: [PROCESS, STORE]`), returning a unified candidate list for the boundary. This avoids per-type rank calls for mixed-type boundaries — one `rank` call per boundary regardless of how many element types it contains.

| Step | Greenfield (no existing controls) | Brownfield (org library) |
|------|-----------------------------------|--------------------------|
| 1. Context loading (read model, attributes, scope) | 3 | 3 |
| 2. Enforcement per boundary (B boundaries) | B × 2 (prompt + write) | B × 3 (rank + prompt + write) |
| 3. Detection controls | 2 (prompt + write) | 3 (rank + prompt + write) |
| 4. Governance placeholder | 1 | 1 |
| 5. Validation | 1 | 1 |
| **Total (B=4)** | **12** | **16** |
| **Total (B=6)** | **16** | **22** |

At B=6 brownfield, the pass uses 22 of 40 turns — leaving 18 turns for error recovery, follow-up questions, and `rank` failures (which fall back to greenfield prompts, saving 1 turn per failed boundary). **Gap 8 mitigation (tiered prompts for B>6) is required for Phase 2 launch**, not a deferred enhancement. For B>6, collapsing to crown-jewel boundaries first reduces the effective B to 3-4 while preserving coverage for the highest-value elements.

**Skip behavior:** If the user answers "none" to any step, it takes one word to skip. Skipped controls leave `controls[]` empty; the quality score reflects this, and `/dethereal:surface` catches gaps post-analysis.

**Re-run behavior:** On re-run, the agent reads existing `controls[]` from local JSON and pre-populates batch tables with previously declared controls. Boundaries with existing controls show them as "currently assigned" with options to add or remove.

**Turn budget exhaustion:** With incremental persistence, each boundary's controls are written immediately after confirmation. If the harness terminates the agent at the turn limit, all completed boundaries are already saved. On re-run, the agent reads existing controls and continues with remaining boundaries (see "Re-run behavior" above).

---

## 9. Two-Tier Reporting Format

Analysis output and the `/dethereal:surface` skill should distinguish between inferred coverage (derived from enrichment attributes) and formal coverage (derived from SUPPORTS edges). Both are needed: the first is a security posture snapshot, the second is a governance maturity indicator.

### Inferred Coverage (attribute-derived)

Available without formal control assignment. Answers: "what protections are configured?"

```
### Inferred Coverage (from enrichment attributes)

| Protection | Coverage | Details |
|------------|----------|---------|
| Authentication | 10/12 components (83%) | 2 missing: scheduler, batch-worker |
| Encryption in transit | 8/10 cross-boundary flows (80%) | 2 unencrypted: internal → data tier |
| Encryption at rest | 3/4 stores (75%) | Missing: session-cache |
| Monitoring | 6/12 components (50%) | 6 blind spots (see Detection Coverage) |

Note: Inferred from component attributes. Does not represent formal
control assignments. Sufficient for security posture review; insufficient
for compliance evidence.
```

### Formal Coverage (SUPPORTS-derived)

Requires explicit control assignment. Answers: "what controls are formally documented and assigned?"

```
### Formal Control Coverage (from assigned controls)

| Tier | Components | With Controls | Gap |
|------|------------|---------------|-----|
| 1 — Crown Jewels | 3 | 2 (67%) | payment-db: no formal controls |
| 2 — Cross-boundary | 4 | 1 (25%) | api-gw, auth-svc, msg-queue |
| 3 — Internet-facing | 2 | 2 (100%) | — |
| 4 — Internal | 3 | 0 (0%) | scheduler, batch-worker, config-svc |
| **Total** | **12** | **5 (42%)** | **7 components without formal controls** |

Formal coverage required for: SOC2 CC6.1, ISO 27001 A.8, PCI-DSS 6.x.
Run /dethereal:enrich --focus controls to assign controls.
```

### The Governance Story

The gap between the two tiers tells the governance narrative. When inferred coverage is 83% but formal coverage is 42%, the message to leadership is: "We have the controls; we need to formalize the documentation." That is a resource conversation, not a risk conversation — exactly the right framing for executive reporting.

### Control Source Breakdown (when source tracking is populated)

```
### Control Verification Status

| Source | Controls | Note |
|--------|----------|------|
| Discovered (verified in code/IaC) | 8 | Full confidence — implementation confirmed |
| Declared (user-asserted) | 5 | Assumed effective, unverified |
| Both (discovered + declared) | 2 | Highest confidence — governed and verified |
```

---

## 10. Implementation Phasing

Three phases with clean dependency boundaries. Each phase delivers independent value.

### Phase 1 — "Fix the quality score" (zero new UX)

Fix the quality score to derive `control_coverage_rate` from existing enrichment attributes (Category 1 auto-inference). This raises the quality ceiling and gives accurate completeness feedback — with no user interaction change.

| # | Item | File | Description |
|---|------|------|-------------|
| P2 | Compute quality score locally | `dethereal/src/tools/validate-model.tool.ts` | Replace hardcoded `controlCoverageRate = 0`. Derive from enrichment attributes using the positive attribute mapping table below. |

**Value:** Quality score reflects actual security attribute coverage. No new tools, no schema changes, no workflow changes.

**Scope limitation:** Phase 1 fixes the quality score display, not the analysis engine's edge weight computation. The analysis engine still does not consume the full set of enrichment attributes for path cost calculation (Gap 3.5). The cry-wolf problem in analysis findings is addressed by Phase 3 (SUPPORTS edges feed the engine). Phase 1 is a necessary first step, not a complete fix.

**Positive attribute mapping table** (used by the quality score computation):

| Attribute | Counts as "control present" when | Does NOT count |
|-----------|----------------------------------|----------------|
| `encryption_in_transit` | Value is not `none`, `null`, absent, `SSLv3`, or `TLS 1.0` | `none`, `null`, absent, deprecated protocols |
| `encryption_at_rest` | Value is not `none`, `null`, absent, `DES`, `3DES`, or `RC4` | `none`, `null`, absent, deprecated algorithms |
| `authentication_type` | Value is not `none`, `null`, or absent; additionally, `basic` does not count when `encryption_in_transit` is absent, `none`, `SSLv3`, or `TLS 1.0` (basic auth over cleartext or deprecated TLS is a vulnerability per PCI-DSS 4.0 §4.2.1, not a control) | `none`, `null`, absent; `basic` without adequate encryption |
| `monitoring_tools` | Non-empty array | `[]`, `null`, absent |
| `implicit_deny_enabled` | `true` | `false`, `null`, absent |

An element counts toward `control_coverage_rate` when it has **at least one positive security attribute** from this table. The metric is: classified elements with at least one positive security attribute / total classified elements.

**Quality threshold rationale:** A model where every component uses `TLS 1.0` and `basic` auth should not score 100% on control coverage — that is a false confidence signal. The thresholds exclude deprecated protocols and cleartext-credential combinations that a security team would flag as findings, not credit as controls.

### Phase 2 — "Start asking" (control focus mode)

Add the `--focus controls` mode to the enrichment skill. Users declare Category 2-3 controls in a dedicated pass. Controls written to local JSON as `ControlReference[]`.

| # | Item | File | Description |
|---|------|------|-------------|
| P4 | Enrich skill update | `dethereal/skills/enrich/SKILL.md` | Add `controls` to the `--focus` enum. Define the 3-step control pass (Section 8). |
| P5 | Control instructions file | `dethereal/docs/controls-enrichment.md` | New file with control assignment instructions, loaded by the security-enricher only when `--focus controls` is invoked. Keeps the base agent instructions under ~360 lines. |
| P5b | Security-enricher agent update | `dethereal/agents/security-enricher.md` | No `@docs/controls-enrichment.md` reference in the base agent — the reference goes in the enrich skill's SKILL.md (P4) under the `--focus controls` conditional. The agent's base instructions stay under ~360 lines. Add `source` field handling only. |
| P5c | MCP `rank` action on manage_controls | `dethereal/src/tools/manage-controls.tool.ts` | Add `rank` action that calls `controlCandidatesForType` schema query, enriches with local element context, scores using Section 6.3 formula, returns top N. |
| P5d | Schema `@cypher` query | `dt-ws/schema/schema.graphql` | Add `controlCandidatesForType` query as `@cypher` directive (spec below). No custom resolver needed. |

**P5d specification — `controlCandidatesForType` schema query:**

```graphql
type ControlCandidate {
  controlId: ID!
  controlName: String!
  classes: [ControlClassFit!]!
  totalCountermeasures: Int!
  assignedElementIds: [ID!]!
}

type ControlClassFit {
  classId: ID!
  className: String!
  moduleId: ID!
  moduleName: String!
  compatible: Boolean!          # supportedTypes includes the queried element type
  countermeasureCount: Int!     # >0 means configured (OPA generated countermeasures)
}

type Query {
  controlCandidatesForType(
    elementTypes: [ComponentType!]!
    moduleIds: [ID!]
  ): [ControlCandidate!]!
    @authentication
    @cypher(statement: """
      // Two-pass: prune to eligible controls first, THEN collect ALL of
      // each eligible control's classes. Filtering classes by
      // supportedTypes before the collect would make `compatible`
      // tautologically true and the incompatible-configured penalty
      // (§6.3) unreachable.
      MATCH (ctrl:Control)-[:IS_INSTANCE_OF]->(cc0:ControlClass)<-[:HAS_CLASS]-(m0:Module)
      WHERE ANY(et IN $elementTypes WHERE et IN coalesce(cc0.supportedTypes, []))
        AND ($moduleIds IS NULL OR m0.id IN $moduleIds)
      WITH DISTINCT ctrl
      MATCH (ctrl)-[:IS_INSTANCE_OF]->(cc:ControlClass)<-[:HAS_CLASS]-(m:Module)
      OPTIONAL MATCH (ctrl)-[:HAS_COUNTERMEASURE]->(cm:Countermeasure)
                     -[:IS_COUNTERMEASURE_OF]->(cmClass:ControlClass)
      WHERE cmClass.id = cc.id
      WITH ctrl, cc, head(collect(DISTINCT m)) AS m, count(DISTINCT cm) AS cmCount
      WITH ctrl,
           collect({
             classId: cc.id, className: cc.name,
             moduleId: m.id, moduleName: m.name,
             compatible: ANY(et IN $elementTypes WHERE et IN coalesce(cc.supportedTypes, [])),
             countermeasureCount: cmCount
           }) AS classes,
           sum(cmCount) AS totalCm
      OPTIONAL MATCH (ctrl)-[:SUPPORTS]->(elem)
      WITH ctrl, classes, totalCm, collect(DISTINCT elem.id) AS assignedIds
      RETURN ctrl.id AS controlId, ctrl.name AS controlName,
             classes, totalCm AS totalCountermeasures, assignedIds AS assignedElementIds
    """)
}
```

Note: `elementTypes` is an array — the MCP `rank` action passes all element types present in the boundary, and the Cypher returns controls compatible with any of them. The `compatible` field per class tells the MCP tool which specific classes match which types, enabling per-class scoring without additional queries.

**Value:** Models capture enforcement and detection controls. Quality score reflects control coverage from local JSON. The prompt design (Section 8) keeps interaction to B+2 prompts in a dedicated pass with its own 40-turn budget.

**Dependencies:**
- P2 must ship first or concurrently (quality score must count `controls[]` from local JSON, not just attributes)
- The `match_classes` pattern must be established in plugin vocabulary first (the classify skill's Pass 1 migration shipped in #137 + #139)
- Gap 8 mitigation (tiered prompts for B>6) is required for launch, not deferred

### Phase 3 — "Close the loop" (platform integration)

Fix the update pipeline, add the batch assignment tool, and surface sync warnings. This closes the import-export round-trip and enables the Approach D post-analysis path.

| # | Item | File | Description |
|---|------|------|-------------|
| P1 | Fix update pipeline | `dt-core/src/dt-update/dt-update.ts` | `updateComponent()`, `updateBoundary()`, `updateDataFlow()` must process `controls[]` from local JSON. Use disconnect/connect semantics on the update mutation — do NOT copy the import pipeline's `associateControlsDirectly` pattern, which sets `dataItems: []` as a side effect. Only touch controls when the incoming JSON includes them (`data.controls !== undefined`). |
| P3 | ~~Add `assign` action to `manage_controls`~~ | `dethereal/src/tools/manage-controls.tool.ts` | **Done** (#140). Accepts `control_id` + `element_ids[]`, creates SUPPORTS edges. |
| P3b | ~~Add `findControls()` method to dt-core~~ | `dt-core/src/dt-control/dt-control.ts` | **Done** (#137). Dual-path: `controlIdsByElements` Cypher helper for element-based lookup, auto-generated GraphQL for other filters. |
| P3c | ~~Add `assignControlToElements()` method to dt-core~~ | `dt-core/src/dt-control/dt-control.ts` | **Done** (#137). Append-only connect via the three typed relationships (`supportedComponents`, `supportedBoundaries`, `supportedDataFlows`) — not the polymorphic `elements` field, whose auto-generated resolver is unreliable on Memgraph. Idempotent across sequential calls only: it reads the attached IDs first and connects the difference, because `connect` compiles to a bare relationship CREATE rather than a MERGE. Two concurrent callers can still append a parallel edge. |
| P6 | Surface unresolved controls at sync | `dethereal/skills/sync/SKILL.md` | Pass through warnings from `resolveControls()`. After first successful sync, write resolved IDs back to local JSON to pin references. |

**Value:** Controls survive re-sync. Post-analysis gap-filling via `/dethereal:surface` works end-to-end. Two-tier reporting has both inferred and formal coverage.

**Critical implementation detail for P1:** The import pipeline's `associateControlsDirectly` (`dt-import.ts` lines 1060-1084) sets `dataItems: []` when associating controls, with a comment "Will be set later during data item association." The update pipeline operates on existing elements with existing relationships. It must use the update mutation's disconnect/connect semantics to operate on controls independently of other relationships. The `dt-component.ts` mutation already supports this — it disconnects controls not in the new list and connects new ones, leaving other relationships untouched, but only if `data.controls` is explicitly set. If `data.controls` is `undefined`, it skips the operation entirely. This is the correct default for the update pipeline.

### Phase Summary

| Phase | Prerequisites | New UX | Value |
|-------|--------------|--------|-------|
| 1. Fix quality score | P2 | None | Quality score accuracy, attribute-inferred coverage |
| 2. Start asking | P4, P5, P5b, P5c, P5d | B+2 prompts in `--focus controls` pass (separate invocation) | Control capture, local quality score, deterministic ranking |
| 3. Close the loop | P1, ~~P3~~, ~~P3b~~, ~~P3c~~, P6 | Sync warnings | Platform integration, two-tier reporting. P3/P3b/P3c done (#137, #140). |

---

## 11. Implementation Architecture

### Backend delegation strategy

Three operations should be implemented as server-side computations exposed through MCP tools, rather than multi-step agent orchestrations. The agent has a 40-turn budget; these operations would consume 24+ turns if done client-side. As backend tools, they each take 1 turn.

#### `get_control_gaps(model_id)` — highest impact

Replaces the 5-step Approach D workflow (~20 agent turns → 1 tool call). The backend traverses the full MITRE framework chain in the graph database:

```
Exposure -[:EXPLOITED_BY]-> ATT&CK Technique
  <-[:MITIGATION_DEFENDS_AGAINST_TECHNIQUE]- ATT&CK Mitigation
  <-[:RESPONDS_WITH]- Countermeasure
  <-[:HAS_COUNTERMEASURE]- Control -[:SUPPORTS]-> Element
```

Both MITRE ATT&CK and D3FEND frameworks are loaded in the graph (`mitre-frameworks` module) and connected to each other. The query walks the full chain to find unmitigated exposures and recommend controls grounded in the frameworks — not LLM guesswork.

```
Input:  { model_id: string, top_n?: number (default 3) }
Output: {
  unmitigated_exposures: [{
    element_id, element_name,
    exposure_id, exposure_name,
    attack_techniques: [{ id, name }],
    recommended_mitigations: [{ id, name }]  // ATT&CK Mitigations
  }],
  recommended_controls: [{
    control_id?,          // existing control from org library (null if only ControlClass match)
    control_name?,
    control_class_id, control_class_name,
    d3fend_techniques: [{ id, name }],
    addresses_count: number,
    elements_affected: [{ id, name }]
  }],
  coverage_summary: { total_exposures, mitigated, unmitigated, coverage_pct }
}
```

Implementation: A single Cypher query with pattern matching and set difference. The graph engine handles this in milliseconds. The agent's job is "present table, ask yes/no."

#### Control matching — three-layer architecture

Control candidate ranking is split across three layers (see Section 6.3 for details):

| Layer | Component | Responsibility | Why here |
|-------|-----------|---------------|----------|
| **Schema `@cypher`** | `controlCandidatesForType` query | Return controls with matching `supportedTypes`, countermeasure counts, assigned elements | Single Cypher traversal, serves both MCP and Studio, no app logic needed |
| **MCP tool** | `manage_controls` `rank` action | Score candidates using local element context (class module match, technology domain), sort, return top N | Needs local file data (element classId, activeModules) not available to the backend |
| **Agent** | Presentation + confirmation | Present pre-ranked table, ask yes/no, recommend new control if all candidates weak | Judgment: only whether to create new vs assign existing |

This replaces the previous design where the agent performed the entire evaluation loop (~10-15 reasoning turns) with a single MCP tool call (1 turn). The scoring formula is deterministic (Section 6.3).

#### `compute_control_coverage(directory_path, model_id?)` — reporting

Replaces multi-step coverage computation (~4 agent turns → 1 tool call). Hybrid local/online:

- **Offline** (directory_path only): Reads local attribute files, computes inferred coverage using the positive attribute mapping table. Also counts `controls[]` references in structure.json/dataflows.json.
- **Online** (model_id provided): Additionally queries SUPPORTS edges and countermeasure coverage from the platform.

```
Input:  { directory_path: string, model_id?: string }
Output: {
  inferred: { auth: {covered, total, pct}, encryption_transit: {...}, encryption_rest: {...}, monitoring: {...} },
  formal: { by_tier: [{ tier, label, total, with_controls, gap_elements: string[] }], total_pct },
  source_breakdown: { discovered: number, declared: number, both: number }
}
```

The key benefit beyond turn savings: **the tool computes percentages, not the LLM.** This eliminates arithmetic errors in the reporting output that would erode user trust.

#### Turn budget impact

| Operation | Without backend/MCP tools | With backend/MCP tools | Turns saved |
|-----------|----------------------|-------------------|-------------|
| Gap analysis (Approach D) | ~20 turns | 1 turn | ~19 |
| Class matching (incl. controls) | ~3 turns | 1 turn | ~2 |
| Control candidate ranking (Section 6.3) | ~10-15 turns (agent reasoning loop) | 1 turn (MCP `rank` action) | ~10-14 |
| Coverage reporting | ~4 turns | 1 turn | ~3 |
| **Total** | **~37-42 turns** | **4 turns** | **~34-38** |

The MCP `rank` action on `manage_controls` (Section 6.3) is the largest single improvement — it replaces an unbounded agent reasoning loop (evaluate every candidate control's class profile) with a single deterministic tool call. Combined with the backend delegation, these 4 tool calls replace what was previously impossible to fit within a 40-turn budget.

See Section 8 "Turn Budget Breakdown" for the full control pass turn accounting.

### Agent instruction strategy

The security-enricher agent (`agents/security-enricher.md`, ~360 lines) is near the practical limit for reliable LLM instruction-following. Control assignment instructions (~150 lines) are factored into a separate file (`docs/controls-enrichment.md`) loaded only when `--focus controls` is invoked. This keeps the base agent under its effective instruction limit and prevents performance degradation for non-control enrichment flows.

### Enhancement architecture — three-layer split

New enhancements are split across three layers based on what each layer has access to:

#### Layer 1: Schema `@cypher` directives (graph data, no app logic)

Queries that are single Cypher traversals with no multi-phase orchestration. Use `@cypher` in `schema.graphql` with `@authentication` — no custom resolver needed. This follows the pattern of existing `@cypher` operations (`getExposuresForElement`, `addElementsToIssue`, `removeElementFromIssue`, etc.).

| Query | Purpose | Cypher |
|-------|---------|--------|
| `controlCandidatesForType(elementType, moduleIds)` | Return controls with `supportedTypes` match, countermeasure counts per class, assigned element IDs | `MATCH (ctrl:Control)-[:IS_INSTANCE_OF]->(cc:ControlClass)` with `$elementType IN cc.supportedTypes` |
| `controlIdsByElements(elementIds)` | Control IDs by SUPPORTS edges | Already exists as custom resolver; candidate for simplification to `@cypher` |

**Why `@cypher` and not custom resolvers:** These are pure data retrieval — no multi-phase orchestration, no application-level partitioning, no complex output assembly. The `@cypher` directive provides auth via `@authentication`, avoids ~60 lines of resolver boilerplate per query, and is simpler to maintain. Custom resolvers are reserved for operations that need multi-phase Cypher orchestration with application logic between phases (like `controlGaps` and `matchClasses`).

#### Layer 2: Custom resolver enhancements (existing resolvers, multi-phase logic)

Modifications to existing custom resolvers that already need application logic:

| Enhancement | Resolver | Change |
|-------------|----------|--------|
| Type-compatible gap recommendations | `ControlGapsResolverService` | Add `WHERE $elementType IN cc.supportedTypes` to Phase 3 recommended controls Cypher |
| Configured coverage metric | `ControlGapsResolverService` | Compute `configuredCoverage` (controls with at least one non-default attribute) from existing Phase 2/3 data, add to `CoverageSummary` output. Also add `noMitreChain` count so all fields sum to `totalExposures`. **Assign to Phase 3** alongside P1/P6. |

#### Layer 3: MCP tool functions (local data + compose from backend)

Deterministic scoring that requires local file context (element classData, activeModules) not available to the backend:

| Function | Tool | What it does |
|----------|------|-------------|
| Control candidate ranking | `manage_controls` `rank` action | Calls `controlCandidatesForType`, enriches with local element context (class module match), scores using Section 6.3 formula, returns top N |
| Match result ordering | Post-process `match_classes` | Re-order same-confidence candidates by `activeModules` priority (user-set order from `scope.json`) |
| Attribute quality thresholds | `validate_model_json` `quality` action | Exclude deprecated protocols (TLS 1.0, basic-over-cleartext) from positive attribute table |

### MCP tool changes (existing tools)

**`manage_controls` tool** (`src/tools/manage-controls.tool.ts`):
- `assign` action — **Done** (#140). Accepts `control_id` + `element_ids[]`, creates SUPPORTS edges via `assignControlToElements`.
- `rank` action — **New (P5c)**. Accepts element type, element class ID/module, module scope. Calls `controlCandidatesForType` schema query, scores per Section 6.3 formula, returns top N pre-ranked with relevance labels and countermeasure summaries.

### Quality score computation

The `computeQuality` method (`validate-model.tool.ts` line 177) already reads all attribute files via `readAttributes()` (line 189) and model structure files (lines 186-188). Both data sources needed for the two-tier `control_coverage_rate` computation are already loaded — no additional I/O required. Phase 1 is a ~20-line change replacing `const controlCoverageRate = 0` at line 253.

### Plugin configuration

No changes needed to:
- Plugin manifest (`plugin.json`) — new backend tools are additional actions on existing tools or new tools registered in the MCP server
- Hook definitions (`hooks.json`) — the post-write validation hook does not inspect file contents
- Plugin settings (`settings.json`) — no new configuration surfaces

---

## 12. Known Gaps and Risks

### Gap 1: SUPPORTS edge idempotency on re-sync

Name-only control references (`{ id: null, name: "WAF" }`) use partial name matching in `resolveControls()` (Priority 4 in the resolution chain), which is non-deterministic — "WAF" could match "WAF Protection" or "Cloud WAF Gateway." Repeated syncs with name-only references could flip between different controls.

**Mitigation:** After first successful sync, write the resolved platform ID back to the local JSON to pin the reference. Subsequent syncs use ID matching (Priority 1), which is deterministic. Implement in Phase 3 (P6).

### Gap 2: Control deletion between syncs

If a control referenced in local JSON is deleted on the platform between syncs, `resolveControls()` silently skips it with a warning. The local JSON retains the stale reference, and divergence accumulates over time.

**Mitigation:** During sync push, compare local control IDs against the platform's control inventory. Flag stale references explicitly: "Control 'ctrl-xyz' (Database Encryption) no longer exists on the platform. Remove from local model? (yes / keep as name-only)." Implement in Phase 3 (P6).

### Gap 3: Import pipeline `dataItems` side effect

The import pipeline's `associateControlsDirectly` (`dt-import.ts` lines 1060-1084) sets `dataItems: []` when associating controls. This is safe during initial import (data items are associated in a later pass) but would be destructive if naively copied to the update pipeline, which operates on elements with existing data item relationships.

**Mitigation:** The update pipeline must use the update mutation's disconnect/connect semantics, operating on `controls` independently of `dataItems`. The `dt-component.ts` mutation supports this — it only touches controls when `data.controls` is explicitly set. If `data.controls` is `undefined`, it skips the operation. Addressed in Phase 3 (P1) implementation guidance above.

### Gap 4: No batch assignment API — Resolved

Resolved by the `assign` action on `manage_controls` (#140). Accepts `control_id` + `element_ids[]` array and calls `assignControlToElements`, which creates the SUPPORTS edges. The method reads the control's currently-attached elements first and connects only the missing ones — a repeat call on an already-attached set issues no mutation at all, and a partially overlapping call connects just the difference. This is **not** MERGE semantics: GraphQL `connect` compiles to a bare relationship CREATE, and no engine-level constraint prevents parallel edges, so the read is what makes repeat calls safe. Idempotent across sequential calls; two concurrent callers that both read "not attached" will both connect.

### Gap 5: Category 1 auto-inference boundary — Resolved

Phase 1 derives `control_coverage_rate` from enrichment attributes. The positive attribute mapping table is now defined in Section 10, Phase 1.

### Gap 6: Zero-boundary models

A model with no boundaries (flat architecture) produces zero Step 4b.1 prompts. Enforcement controls are silently skipped entirely. The quality score does not flag the gap.

**Mitigation:** When the boundary count is zero, collapse Step 4b.1 into a single global prompt: "What enforcement controls protect this system? (Firewalls, WAFs, IDS/IPS, or 'none')." Assign declared controls to the model root or to individual components.

### Gap 7: Re-running enrichment

The document says "re-running enrich is additive" for state transitions but does not specify control behavior on re-run. If the user enriches, declares a WAF, then re-runs enrichment — does Step 4b.1 show the previously declared WAF? Does it re-ask for boundaries that already have controls?

**Mitigation:** On re-run, the agent reads existing `controls[]` from local JSON and pre-populates the batch tables with previously declared controls. Boundaries with existing controls show them as "currently assigned" with an option to add more or remove. This mirrors the existing enrichment re-run pattern for attributes (read current values, present for confirmation/modification).

### Gap 8: Large models (20+ boundaries) — Required for Phase 2

At B=20, Step 1 alone produces 20 prompts (60 turns brownfield). Combined with user fatigue from main enrichment, this creates a prompt fatigue cliff where users answer "none" to skip — degrading control coverage without a conscious decision.

**Mitigation (required for Phase 2 launch):** For models with B > 6 boundaries, collapse Step 1 into a tiered prompt: "N boundaries have no enforcement controls. Review: (1) crown-jewel boundaries only, (2) all boundaries, (3) skip." This respects the enrichment priority tiers (D43) already defined in the security-enricher agent. Crown-jewel boundaries first reduces the effective B to 3-4 while preserving coverage for the highest-value elements.

### Gap 9: Compensating controls

Compensating controls — temporary mitigations that exist because a primary control cannot be implemented (e.g., enhanced monitoring when patching is delayed) — do not have a clear home in the four-category taxonomy. They straddle Categories 2/3/4.

**Mitigation:** Compensating controls are handled as regular Category 2 or 3 controls with a `source: "declared"` tag and an optional `compensating` field in the local JSON:

```json
{
  "id": null,
  "name": "Enhanced Monitoring (compensating for delayed patching)",
  "source": "declared",
  "compensating": {
    "expires": "2026-06-30",
    "primary_control": "Automated Patch Management",
    "original_requirement": "PCI-DSS 6.3.3",
    "risk_acceptance": "RISK-2026-042"
  }
}
```

The `compensating` field is local-only (no platform schema change) and preserves the audit trail required by PCI-DSS v4.0 Appendix B (Compensating Controls Worksheet): expiration date, primary control being compensated for, the original requirement not being met, and risk acceptance reference. SOC2 CC6.1 has similar documentation requirements. Without this, compensating controls become permanent fixtures in the threat model. The field is optional — non-compensating controls omit it.

### Gap 10: Post-analysis recommendation noise — Resolved

Addressed by the `get_control_gaps` backend tool (Section 11). The backend ranks recommendations by exposure coverage and returns `top_n` (default 3) candidates. The agent presents pre-ranked results, not an exhaustive mapping. The MITRE framework chain provides framework-grounded justifications rather than LLM-generated reasoning.

---

## Related Documents

- [THREAT_MODELING_WORKFLOW.md](THREAT_MODELING_WORKFLOW.md) — Section 6: Exposure and Control Mapping
- [SYNC_AND_SOURCE_OF_TRUTH.md](SYNC_AND_SOURCE_OF_TRUTH.md) — Publish/pull architecture and `resolveControls()`
- [PLUGIN_ARCHITECTURE.md](PLUGIN_ARCHITECTURE.md) — Section 10: Quality scoring and control coverage
- [OPERATIONAL_REQUIREMENTS.md](OPERATIONAL_REQUIREMENTS.md) — Section 5: Compliance-driven control checklists
- [BACKEND_DELEGATION.md](BACKEND_DELEGATION.md) — Backend delegation strategy (prerequisite — generalizes the backend tools proposed in Section 11)
- [DECISIONS.md](DECISIONS.md) — D28 (countermeasure schema scope), D31 (surface skill scope)
