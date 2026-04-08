# Control Integration in the Threat Modeling Workflow

> Design analysis for integrating security controls into the Dethereal plugin's guided threat modeling workflow. Status: **draft** (design concluded, implementation pending).

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
- [11. Known Gaps and Risks](#11-known-gaps-and-risks)

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

Defined by modules (e.g., `dethernety-module`). Each ControlClass has `supportedTypes` and `supportedCategories` defining which element types it can apply to, plus `template` and `guide` (custom resolvers resolved at runtime). Examples: Encryption at Rest, MFA, Input Validation, Network Segmentation.

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

The split-file schemas define `controls?: ControlReference[]` on Component, Boundary, and DataFlow (`ControlReference = { id: string, name?: string }`). The export pipeline includes these references. But the update pipeline (`DtUpdateSplit`) silently drops them — `updateComponent()`, `updateBoundary()`, and `updateDataFlow()` do not process control references. Import-export round-trip is broken for controls.

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

**Path 1 — Auto-inferred (Category 1):** The analysis engine derives control presence from enrichment attributes. When a component has `encryption_in_transit: TLS 1.3`, the engine treats this as evidence of an encryption control for edge weight computation. No user action required, no Control entity needed.

**Path 2 — Declared (Categories 2-4):** Users explicitly assign Control entities to elements during enrichment. Two sub-paths:

- **Brownfield (existing controls):** The org already has Controls in their platform library with ControlClasses configured and countermeasures auto-generated. The plugin browses, selects, and assigns them to elements (SUPPORTS edge). The countermeasure chain already exists on the Control — assignment is pure linking.
- **Greenfield (new controls):** The plugin creates a new Control via `manage_controls`, assigns ControlClasses, and configures attributes using the class template/guide (same pattern as component enrichment). The platform auto-generates countermeasures. Then the Control is assigned to elements.

In both cases, control references are captured as `controls: [{ id, name }]` in local JSON, resolved to platform Controls at sync, and materialized as SUPPORTS edges.

### 6.2 Workflow placement

Control assignment is a sub-step within the existing enrichment step (Step 7/8 of the guided workflow), positioned after class-template-driven attribute enrichment and before credential enrichment. It does not warrant a new top-level workflow step.

The enrichment step already captures the security attributes that inform control selection. After the agent discovers what protections an element has (attributes), it asks what additional protective systems exist (controls). The question shifts from "what are this element's security properties?" to "what additional enforcement, detection, or governance controls protect this element beyond its own configuration?"

### 6.3 User interaction model

#### Brownfield (existing control library)

When the platform is reachable, query existing controls via `manage_controls(action: 'list')`. Filter by relevance using `supportedTypes` and `supportedCategories` matching the element's type and class. Present as a batch table:

```
## Control Assignment — Tier 1 Components (Crown Jewels)

Existing controls from your library:

| # | Component | Suggested Control | Type | Classes | Assign? |
|---|-----------|-------------------|------|---------|---------|
| 1 | payment-db | Database Encryption Package | technical | Encryption at Rest, Access Control | Y |
| 2 | payment-db | SOC Monitoring | detection | SIEM Integration, Log Correlation | Y |
| 3 | api-gateway | WAF Protection | technical | Web Application Firewall | Y |
| 4 | api-gateway | Rate Limiting | technical | API Rate Limiting | ? |

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

Control references on elements use the existing `ControlReference` schema (already defined, already exported, currently ignored by the update pipeline):

```json
// structure.json — component with controls
{
  "id": "comp-payment-db",
  "name": "Payment Database",
  "type": "STORE",
  "classData": { "id": "class-postgresql" },
  "controls": [
    { "id": "ctrl-db-encryption", "name": "Database Encryption Package" },
    { "id": null, "name": "SOC Monitoring" }
  ]
}

// dataflows.json — flow with controls
{
  "id": "flow-api-to-db",
  "source": { "id": "comp-api" },
  "target": { "id": "comp-payment-db" },
  "controls": [
    { "id": "ctrl-tls", "name": "TLS Encryption" }
  ]
}
```

### 6.5 Quality score integration

Replace the hardcoded `control_coverage_rate = 0` with a local computation: count classified elements with non-empty `controls[]` arrays (even with null IDs) divided by total classified elements. This gives offline progress visibility and raises the max offline score from ~85 to ~95.

### 6.6 Post-analysis complementary path (Approach D)

After sync and analysis, the `/dethereal:surface` skill identifies unmitigated exposures and recommends controls. This is the second pass that catches what the user missed during enrichment. The workflow is:

1. Query platform-computed exposures on elements (`manage_exposures`)
2. Query countermeasures on assigned controls (`manage_countermeasures`) to see what is already covered
3. Identify unmitigated exposures (exposures not addressed by any countermeasure)
4. Recommend Controls from the org library whose countermeasures address the gaps — or suggest creating new Controls with appropriate ControlClasses
5. Assign recommended Controls to elements (SUPPORTS edges)

This path complements pre-analysis control assignment, not replaces it. It leverages the platform's automatic countermeasure generation: once a Control with configured attributes is assigned to an element, its countermeasures automatically cover the relevant exposures.

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

Control assignment is positioned within the existing enrichment step (Step 7/8 of the guided workflow), after class-template-driven attribute enrichment and before credential enrichment. The prompts are designed to minimize fatigue while capturing Categories 2-4.

### Prompt Budget

The enrichment step already captures 6+ attributes per component, credentials, monitoring tools, auth failure modes, and compliance attributes. The control sub-step adds at most **B + 2 prompts** (B = boundary count, typically 3-5). For a typical 4-boundary model, that is 6 additional prompts. Each prompt captures multiple controls via batch tables.

### Step 4b.1 — Enforcement Controls (Category 2)

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

For each declared control, the agent writes `controls: [{ id: null, name: "...", source: "declared" }]` to the relevant element entries in `structure.json` or `dataflows.json`.

If the platform is reachable, the agent first queries `manage_controls(action: 'list')` and filters by `supportedTypes` matching the boundary's element types. Matching existing controls are pre-populated in the table with their platform IDs. Existing controls already have countermeasures generated — assigning them is pure linking, immediately providing countermeasure coverage on the element.

### Step 4b.2 — Detection and Response Controls (Category 3)

**One global prompt**, pre-populated from `monitoring_tools` data captured earlier in enrichment. This turns an open-ended question into a confirmation task — dramatically lower cognitive load.

```
## Detection & Response Coverage

You declared monitoring_tools on components during enrichment.
Which of these are formal detection controls with defined coverage?

| # | Tool | Components Covered | Detection Scope | Assign as Control? |
|---|------|-------------------|-----------------|-------------------|
| 1 | SIEM | api-server, db    | network, auth   | Y/N |
| 2 | EDR  | api-server        | endpoint        | Y/N |

Additional detection controls? (SOC monitoring, NDR, automated response, or "none")
```

### Step 4b.3 — Governance Placeholder (Category 4, V1 only)

**Single prompt, once per model.** No graph entities created — documentation only.

```
Any organizational security policies apply to this system?
(patch management, access reviews, change control, incident response)

Noted for documentation — formal governance control mapping in a future version.
```

Responses written to `.dethereal/scope.json` as `declared_governance_controls: string[]`.

### Prompt Sequence Within Enrichment

```
Tier N attribute enrichment (existing Step 4)
  → Step 4b.1: Enforcement controls per boundary
  → Step 4b.2: Detection controls (global, pre-populated)
  → Step 4b.3: Governance placeholder (global, once)
  → Step 5: Credential enrichment (existing)
```

The control sub-steps run after the agent has discovered each element's security attributes (encryption, auth, monitoring) — it has the context to ask the right control question without a cold start. The user is already thinking about security posture; the cognitive switching cost is near zero.

**Skip behavior:** If the user answers "none" to any sub-step, it takes one word to skip. Skipped controls leave `controls[]` empty; the quality score reflects this, and `/dethereal:surface` catches gaps post-analysis.

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

### Phase 1 — "Stop lying" (zero new UX)

Fix the quality score to derive `control_coverage_rate` from existing enrichment attributes (Category 1 auto-inference). This immediately reduces the cry-wolf problem and raises the quality ceiling — with no user interaction change.

| # | Item | File | Description |
|---|------|------|-------------|
| P2 | Compute quality score locally | `dethereal/src/tools/validate-model.tool.ts` | Replace hardcoded `controlCoverageRate = 0`. Derive from enrichment attributes: count classified elements with security-relevant attributes (authentication, encryption, monitoring) populated, divided by total classified elements. |

**Value:** Quality score stops lying. First analysis run has fewer false positives for controls visible in attributes. No new tools, no schema changes, no workflow changes.

### Phase 2 — "Start asking" (enrichment workflow)

Add the control assignment sub-step to the enrichment workflow. Users declare Category 2-3 controls during enrichment. Controls written to local JSON as `ControlReference[]`.

| # | Item | File | Description |
|---|------|------|-------------|
| P4 | Enrich skill update | `dethereal/skills/enrich/SKILL.md` | Add control assignment sub-step (Steps 4b.1-4b.3) after class-template attributes, before credentials. |
| P5 | Security-enricher agent update | `dethereal/agents/security-enricher.md` | Add Category 2-4 control prompts per the enrichment prompt design (Section 8). Add `source` field handling. |

**Value:** Models capture enforcement and detection controls. Quality score reflects control coverage from local JSON. The enrichment prompt design (Section 8) keeps added interaction to B+2 prompts.

**Dependency:** P2 must ship first or concurrently (quality score must count `controls[]` from local JSON, not just attributes).

### Phase 3 — "Close the loop" (platform integration)

Fix the update pipeline, add the batch assignment tool, and surface sync warnings. This closes the import-export round-trip and enables the Approach D post-analysis path.

| # | Item | File | Description |
|---|------|------|-------------|
| P1 | Fix update pipeline | `dt-core/src/dt-update/dt-update.ts` | `updateComponent()`, `updateBoundary()`, `updateDataFlow()` must process `controls[]` from local JSON. Use disconnect/connect semantics on the update mutation — do NOT copy the import pipeline's `associateControlsDirectly` pattern, which sets `dataItems: []` as a side effect. Only touch controls when the incoming JSON includes them (`data.controls !== undefined`). |
| P3 | Add `assign` action to `manage_controls` | `dethereal/src/tools/manage-controls.tool.ts` | Must accept a batch of `{ control_id, element_id }` pairs, not one-at-a-time. 20 components x 5 controls = 100 sequential tool calls otherwise. Creates SUPPORTS edges on the platform. |
| P6 | Surface unresolved controls at sync | `dethereal/skills/sync/SKILL.md` | Pass through warnings from `resolveControls()`. After first successful sync, write resolved IDs back to local JSON to pin references. |

**Value:** Controls survive re-sync. Post-analysis gap-filling via `/dethereal:surface` works end-to-end. Two-tier reporting has both inferred and formal coverage.

**Critical implementation detail for P1:** The import pipeline's `associateControlsDirectly` (`dt-import.ts` lines 1060-1084) sets `dataItems: []` when associating controls, with a comment "Will be set later during data item association." The update pipeline operates on existing elements with existing relationships. It must use the update mutation's disconnect/connect semantics to operate on controls independently of other relationships. The `dt-component.ts` mutation already supports this — it disconnects controls not in the new list and connects new ones, leaving other relationships untouched, but only if `data.controls` is explicitly set. If `data.controls` is `undefined`, it skips the operation entirely. This is the correct default for the update pipeline.

### Phase Summary

| Phase | Prerequisites | New UX | Value |
|-------|--------------|--------|-------|
| 1. Stop lying | P2 | None | Quality score accuracy, reduced cry-wolf |
| 2. Start asking | P4, P5 | B+2 prompts during enrichment | Control capture, local quality score |
| 3. Close the loop | P1, P3, P6 | Sync warnings | Platform integration, two-tier reporting |

---

## 11. Known Gaps and Risks

### Gap 1: SUPPORTS edge idempotency on re-sync

Name-only control references (`{ id: null, name: "WAF" }`) use partial name matching in `resolveControls()` (Priority 4 in the resolution chain), which is non-deterministic — "WAF" could match "WAF Protection" or "Cloud WAF Gateway." Repeated syncs with name-only references could flip between different controls.

**Mitigation:** After first successful sync, write the resolved platform ID back to the local JSON to pin the reference. Subsequent syncs use ID matching (Priority 1), which is deterministic. Implement in Phase 3 (P6).

### Gap 2: Control deletion between syncs

If a control referenced in local JSON is deleted on the platform between syncs, `resolveControls()` silently skips it with a warning. The local JSON retains the stale reference, and divergence accumulates over time.

**Mitigation:** During sync push, compare local control IDs against the platform's control inventory. Flag stale references explicitly: "Control 'ctrl-xyz' (Database Encryption) no longer exists on the platform. Remove from local model? (yes / keep as name-only)." Implement in Phase 3 (P6).

### Gap 3: Import pipeline `dataItems` side effect

The import pipeline's `associateControlsDirectly` (`dt-import.ts` lines 1060-1084) sets `dataItems: []` when associating controls. This is safe during initial import (data items are associated in a later pass) but would be destructive if naively copied to the update pipeline, which operates on elements with existing data item relationships.

**Mitigation:** The update pipeline must use the update mutation's disconnect/connect semantics, operating on `controls` independently of `dataItems`. The `dt-component.ts` mutation supports this — it only touches controls when `data.controls` is explicitly set. If `data.controls` is `undefined`, it skips the operation. Addressed in Phase 3 (P1) implementation guidance above.

### Gap 4: No batch assignment API

The proposed `assign` action on `manage_controls` creates one SUPPORTS edge at a time. A model with 20 components and 5 controls each means 100 sequential MCP tool calls. The enricher agent's batch table UX implies batch assignment, but the underlying tool does not support it.

**Mitigation:** The `assign` action must accept an array of `{ control_id, element_id }` pairs and process them in a single GraphQL mutation batch. Addressed in Phase 3 (P3).

### Gap 5: Category 1 auto-inference boundary

Phase 1 derives `control_coverage_rate` from enrichment attributes, but the exact mapping from attribute values to "control present" is not defined. Which attributes count? Does `authentication_type: none` count as "authentication attribute populated" (yes for completeness, no for control presence)?

**Mitigation:** Define a minimal attribute-to-control mapping table. Only positive security attributes count: `encryption_in_transit` with a value other than `none`/`null`, `authentication_type` with a value other than `none`/`null`, `monitoring_tools` with a non-empty array. The quality score should count "elements with at least one positive security attribute" not just "elements with any attribute populated."

---

## Related Documents

- [THREAT_MODELING_WORKFLOW.md](THREAT_MODELING_WORKFLOW.md) — Section 6: Exposure and Control Mapping
- [SYNC_AND_SOURCE_OF_TRUTH.md](SYNC_AND_SOURCE_OF_TRUTH.md) — Publish/pull architecture and `resolveControls()`
- [PLUGIN_ARCHITECTURE.md](PLUGIN_ARCHITECTURE.md) — Section 10: Quality scoring and control coverage
- [OPERATIONAL_REQUIREMENTS.md](OPERATIONAL_REQUIREMENTS.md) — Section 5: Compliance-driven control checklists
- [DECISIONS.md](DECISIONS.md) — D28 (countermeasure schema scope), D31 (surface skill scope)
