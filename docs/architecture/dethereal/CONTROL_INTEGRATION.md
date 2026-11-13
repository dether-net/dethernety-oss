# Control Integration in the Threat Modeling Workflow

> Design analysis for integrating security controls into the Dethereal plugin's guided threat modeling workflow. Status: **implemented**; [Section 10](#10-what-shipped) records what shipped. Two carve-outs: formal governance and procedural controls (§4, Category 4) are not built — the control pass records them as free text only — and §6.1's timing for greenfield Control creation is superseded by [CONTROL_LIBRARY.md](CONTROL_LIBRARY.md) — see the note in that section.

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
- [10. What Shipped](#10-what-shipped)
- [11. Implementation Architecture](#11-implementation-architecture)
- [12. Known Gaps and Risks](#12-known-gaps-and-risks)

---

## 1. Problem Statement

During the guided threat modeling workflow, security controls are never assigned to model elements. The workflow captures security attributes (encryption, authentication, monitoring) during enrichment, but does not connect formal Control entities to components, data flows, or boundaries. This means:

1. **Analysis without defense context.** The platform's analysis doesn't know what defenses exist. Attack paths that are blocked by a firewall or gated by MFA appear as open as unprotected paths.
2. **Overstated risk.** The first analysis run produces findings that include threats already mitigated by existing controls. This creates a "cry wolf" effect that erodes trust in the tool.
3. **Incomplete model.** A threat model without controls is a vulnerability assessment, not a threat model. It answers "what could go wrong" but not "what is our residual risk."
4. **Quality ceiling.** The quality score hardcodes `control_coverage_rate = 0` locally. Models max at ~85/100 without controls, and the `/dethereal:surface` control gap analysis has nothing to work with.
5. **Crown jewel context gap.** The platform's analysis takes the controls around a crown jewel into account. Without controls, this signal is absent.

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

Controls are applied to elements via the polymorphic `SUPPORTS` relationship — the same control can protect a Component, DataFlow, SecurityBoundary, Data element, or Model.

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

> The tools as they stood when this design was written. Since replaced for reading: `manage_exposures` is retired, the `list` and `get` actions moved to the read-only `query_controls`, `query_countermeasures` and `query_exposures` (`query_controls` also carries `rank`), and `manage_controls` gained `assign` and the control-library actions. See [the security element tools in MCP_ARCHITECTURE.md](MCP_ARCHITECTURE.md#security-element-tools-client-dependent) for the current set.

### SUPPORTS Relationship Direction

The SUPPORTS relationship is owned by the Control side (`Control -[SUPPORTS]-> Element`), not the Element side. This is correct: one Control can SUPPORTS many elements across many models (it is a shared organizational resource). If the edge were owned by elements, deleting a model would cascade-delete the control's relationships.

The element types still expose the edge: Component, DataFlow and SecurityBoundary each have a `controls` field (`@relationship(type: "SUPPORTS", direction: IN)`), so their update mutations take a `controls` connect/disconnect, and the update pipeline uses it. The edge itself still runs from the Control to the element.

---

## 3. Current Gaps

> These were the gaps when this design was written. §3.1–§3.4 each end with how they were closed; §3.5 concerns the platform's analysis, outside the plugin.

### 3.1 Local JSON supports controls, but the engine ignores them

The split-file schemas define `controls?: ControlReference[]` on Component, Boundary, and DataFlow. The type is `ControlReference = { id, name?, source?: 'discovered' | 'declared' | 'both' }`. `source` is local-only: export writes each reference as `{ id, name }`, leaves out entries without an id, and import resolves controls by id or name only, so a pull drops `source`. Nothing carries it through; carrying it would need a property on the platform edge. At design time the update pipeline (`DtUpdateSplit`) also dropped references — `updateComponent()`, `updateBoundary()`, and `updateDataFlow()` did not process them, so the import-export round-trip was broken for controls.

**Closed.** The update pipeline resolves every `controls` list and writes it (see [Control writes in the update pipeline](#control-writes-in-the-update-pipeline), Section 10).

Note: The import pipeline (`DtImportSplit`) **does** work — `resolveControls()` resolves references by ID then name and creates SUPPORTS edges via `setElementControlsDirect()`. The gap is specifically in the update path. (The `import_model` tool now pushes with strict control resolution: a reference links only by its ID or by a name exactly one catalog control has, and any reference that does not resolve refuses the push before anything is written — see [Strict Control Resolution](../dt-core/IMPORT_EXPORT.md#strict-control-resolution).)

### 3.2 No MCP tool assigns controls to elements

`manage_controls` creates and manages Control entities but has no `assign` action that creates the `SUPPORTS` edge between a Control and a model element. There is no tool that performs this operation.

**Closed.** `manage_controls` has an `assign` action ([§12.4](#124-no-batch-assignment-api--resolved)).

### 3.3 No workflow step captures control assignments

The 11-step guided workflow has no step that asks "what controls protect this component/boundary/flow?" Enrichment captures security attributes (authentication type, encryption, monitoring tools), but these are element properties, not formal control assignments.

**Closed.** The control pass, `/dethereal:enrich --focus controls` ([§6.2](#62-workflow-placement), [Section 8](#8-enrichment-prompt-design)).

### 3.4 Quality score hardcoded to zero

In `validate-model.tool.ts`, `control_coverage_rate` is hardcoded to `0` for offline scoring. The formula gives this factor 10% weight, capping the offline score at ~90/100 even for otherwise complete models.

**Closed.** The quality score computes the rate from attributes and `controls[]` references (see [Quality score from attributes](#quality-score-from-attributes), Section 10).

### 3.5 Enrichment attributes don't feed edge weights

The platform's analysis uses a flow's `authType` and protocol when it weighs attack paths, but does not currently use the full set of enrichment attributes (encryption strength, auth failure mode, monitoring coverage). This means even well-enriched models can get inaccurate path weighting.

---

## 4. Control Categories

Not all controls are equal. The "enrichment attributes ARE controls" argument holds for one category but breaks down for the rest. Four distinct categories exist, each requiring different treatment:

### Category 1: Inherent configuration properties

**Examples:** `encryption_in_transit: TLS 1.3`, `implicit_deny_enabled: true`, `egress_filtering: allow_list`

These are attributes of the element itself, discoverable from code and IaC. The platform's analysis can infer control presence directly from attribute values. No separate control entity is needed — the attribute IS the evidence.

**Workflow:** Already captured during enrichment. No additional step required.

### Category 2: Distinct enforcement entities

**Examples:** Firewall, WAF, IDS/IPS, API gateway with rate limiting

These are separate entities with their own lifecycle, configuration surface, failure modes, and bypass vulnerabilities. A firewall is not a property of the network segment — it is a Control node with its own ControlClass, attributes (rule count, last audit date, firmware version), and auto-generated countermeasures with D3FEND mappings.

Flattening "there is a firewall here" into an enrichment attribute loses the entire countermeasure chain: the ControlClass's OPA policies evaluate firewall attributes and generate specific countermeasures (e.g., "Network Filtering" → D3-NF) that would not exist as attribute values.

**Workflow:** Requires explicit control assignment. The user either assigns an existing Control from the org library (SUPPORTS edge) or creates a new Control (assign ControlClass, configure attributes, platform auto-generates countermeasures, then assign to element).

### Category 3: Detection and response controls

**Examples:** SIEM integration, NDR, log correlation, automated alerting, SOC monitoring

The enrichment step already captures `monitoring_tools: ["SIEM", "NDR"]` as a string array, but a formal detection Control with a ControlClass provides more: the class's OPA policies evaluate detection attributes (coverage scope, alert fidelity, response automation) and auto-generate countermeasures with D3FEND technique links (e.g., "Network Traffic Analysis" → D3-NTA). The `monitoring_tools` string array cannot trigger countermeasure generation — only a configured Control can.

**Workflow:** Partially captured by enrichment (the `monitoring_tools` attribute). Full formalization as Controls requires explicit assignment. The platform's analysis weighs detection coverage, and configured detection Controls give it a richer signal than a list of tool names.

### Category 4: Governance and procedural controls

**Examples:** Patch management policy, access review cadence, change management process, security training, incident response procedures

Not discoverable from code or infrastructure. Require human declaration. Have effectiveness that depends on organizational discipline. Map to frameworks like ISO 27001, NIST CSF, SOC2 — not to technical configurations.

**Workflow:** Requires interactive conversation with the user. Cannot be auto-inferred. This is the most complex category and needs its own design treatment. Formal governance controls are not built: the control pass records them as free text only (§7 Q1).

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

During enrichment, capture control references in local JSON (`controls: [{ id, name }]` on elements). At sync time, `resolveControls()` resolves references to platform controls and creates SUPPORTS edges. On the first push (`import_model`) resolution is strict: an unresolved or ambiguous reference refuses the push rather than being matched loosely or dropped.

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
| | Over-engineered for the problem it solves |

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
- **Rejected:** Approach B (breaks offline), Approach C (over-engineered)

Key arguments:

1. **Security Architect:** The import pipeline's `resolveControls()` already works — less new code than expected. But the update pipeline bug is blocking.
2. **Process Architect:** Controls belong inside the existing enrichment step (Step 7), not as a new workflow step. Can run in parallel with credential enrichment.
3. **Threat Modeler:** Enrichment already does 80% of the work for Category 1 controls. The gap is the formal bridge for Categories 2-4.
4. **SecOps/CISO:** The cry-wolf problem (Approach D alone) has killed tool adoption at organizations. First analysis credibility is a product adoption risk. Two-tier reporting (inferred coverage from attributes + formal coverage from SUPPORTS edges) addresses both operational and governance needs.

---

## 6. Recommended Design

### 6.1 Two-path control integration

> **Superseded in part by [CONTROL_LIBRARY.md](CONTROL_LIBRARY.md).** The two-path structure (brownfield / greenfield) below is correct, but the **timing** of greenfield Control creation has changed: instead of calling `manage_controls(action: 'create')` eagerly during the control pass, the `enrich-controls` skill writes a `controls/<temp-id>.json` file with `lifecycle: "greenfield"` once the operator confirms the agent's proposal, and defers the platform create to `/dethereal:sync push`. Per-instance attributes live in that file, not in `structure.json`. The reference shape in [§6.4](#64-local-json-format) (`{id, name, source}`) is unchanged. See [CONTROL_LIBRARY.md §5](CONTROL_LIBRARY.md#5-lifecycle-greenfield--brownfield) for the full lifecycle and [§7](CONTROL_LIBRARY.md#7-sync-flows) for the sync flows.

**Path 1 — Auto-inferred (Category 1):** The platform's analysis derives control presence from enrichment attributes. When a component has `encryption_in_transit: TLS 1.3`, the analysis treats this as evidence of an encryption control when it weighs attack paths. No user action required, no Control entity needed.

**Path 2 — Declared (Categories 2-4):** Users explicitly assign Control entities to elements during enrichment. Two sub-paths:

- **Brownfield (existing controls):** The org already has Controls in their platform library with ControlClasses configured and countermeasures auto-generated. The plugin browses, selects, and assigns them to elements (SUPPORTS edge). The countermeasure chain already exists on the Control — assignment is pure linking. The control-library pull that follows the three-step control pass materialises a `controls/<id>.json` file as a local cache ([CONTROL_LIBRARY.md §7](CONTROL_LIBRARY.md#pull-auto-after-the-three-step-control-pass)).
- **Greenfield (new controls):** The agent proposes the Control — its ControlClass bindings and per-instance attributes derived from observed config or the class template/guide — and writes nothing. Once the operator confirms, the `enrich-controls` skill writes `controls/<temp-id>.json` with `lifecycle: "greenfield"` and one `classes[]` entry per binding, and sets the `controls[]` reference in `structure.json` / `dataflows.json` to the same temp id. On `/dethereal:sync push`, the pipeline creates the Control on the platform, sets attributes per class, assigns SUPPORTS edges, and writes the server-generated id back into the local files. The platform auto-generates countermeasures once the class-bound attributes land.

In both cases, control references in `structure.json` / `dataflows.json` are `{ id, name, source }` — resolved to platform Controls at sync, materialized as SUPPORTS edges. Per-instance attributes are NOT inlined in these files; they live in `controls/<id>.json`.

### 6.2 Workflow placement

Control assignment is a **focus mode** within the existing enrichment step (Step 8 of the guided workflow), invoked as `/dethereal:enrich --focus controls`. It does not warrant a new top-level workflow step.

The focus mode approach (rather than inline sub-steps) is driven by three Claude Code implementation constraints:

1. **Turn budget:** The security-enricher agent's turn limit is 40 turns on Claude Code (`maxTurns: 40`) and 40 steps on OpenCode (`steps: 40`); the plugin sets no turn limit on Codex. Current enrichment already uses 20-30 turns for a 15-component model. Embedding control prompts inline risks exhausting the budget before reaching later steps.
2. **Instruction linearity:** Splitting control sub-steps across the enrichment flow (enforcement controls after Step 4, detection controls after Step 9) creates non-linear control flow that degrades LLM instruction-following.
3. **Instruction size:** The security-enricher is already ~360 lines. Adding ~150 lines of control instructions inline would exceed the effective limit for reliable agent behavior. The `--focus controls` pass is its own skill, and its control instructions live in a separate file ([`workflow/shared/controls-enrichment.md`](../../../apps/dethereal/workflow/shared/controls-enrichment.md)).

The enrichment step already captures the security attributes that inform control selection. The `--focus controls` pass runs after main enrichment is complete — the agent has the full context of what protections each element has (attributes) and proposes the additional protective systems (controls); the `enrich-controls` skill asks the operator about them.

**Execution model:** The agent's part of the `--focus controls` pass is a **separate agent invocation** with its own turn budget (the agent's limit above), not a continuation of the main enrichment session. Main enrichment consumes 20-30 turns; the control pass cannot share that budget. In the guided workflow (`/dethereal:threat-model`), the skill offers the control pass once main enrichment completes, as a session break. On a quick-mode run there is no offer: the skill says in one line that the control pass is deferred to `/dethereal:enrich --focus controls` and moves on to review. On `continue` it loads the `enrich-controls` skill, which starts the new security-enricher invocation; on `later` it names the command that resumes the pass:

```
Enrichment complete. Quality: 72/100.
Run the control assignment pass now (about 6 questions), or later? (continue / later)
```

`later` answers `To resume: /dethereal:enrich --focus controls`. The count in the offer is B + 2 for B boundaries — one enforcement question per boundary, one for detection, one for governance (3 with no boundaries); the optional follow-ups listed in [Section 8](#8-enrichment-prompt-design) come on top.

**Instruction loading:** `/dethereal:enrich --focus controls` hands over to the `enrich-controls` companion skill (not user-invocable), which ships [`workflow/shared/controls-enrichment.md`](../../../apps/dethereal/workflow/shared/controls-enrichment.md) as a file beside its `SKILL.md` and reads it when the pass starts. Regular enrichment runs never load the control instructions into the main conversation. The security-enricher agent carries them inline for its control-pass mode, in which it proposes and writes nothing.

### 6.3 User interaction model

#### Brownfield (existing control library)

The agent checks that the platform is reachable with `query_controls(action: 'list')`. The candidates for a boundary then come from `query_controls(action: 'rank')` with the boundary's element types (see [Ranking](#ranking-backend-delegated-not-agent-reasoned)), not from filtering the list. A class can declare `supportedTypes` and `supportedCategories` to indicate which element types it can protect; both are optional, and the ranking reads a class without `supportedTypes` as applying to every element type.

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

The multi-class evaluation is **deterministic scoring**, not a judgment call. The backend and MCP tool layer compute it; the agent puts the result in its proposal table, and the `enrich-controls` skill shows that table to the operator. Three layers collaborate:

**Layer 1 — GraphQL query (`controlCandidatesForType`):** Served by a custom resolver (`ControlCandidatesResolverService` in dt-ws) that runs one two-pass Cypher query:

1. **Eligibility prune** — keeps controls with at least one ControlClass that is compatible with any of the requested element types and, when `moduleIds` is given, belongs to one of those modules.
2. **Full class profile** — collects *every* class of each eligible control, with no type or module filter, and computes a per-class `compatible` flag and countermeasure count (proxy for "configured"). Collecting all classes keeps `total_classes` honest and the incompatible-configured penalty reachable.

It also returns the element IDs each control already supports. Orphaned classes are excluded.

**How `supportedTypes` is read.** The property is optional on ControlClass:

| `supportedTypes` on the class | Compatible with |
|---|---|
| Absent (not set) | Every element type |
| Explicit list | Only the listed element types |
| Explicit empty list `[]` | No element type |

The control-gaps resolver reads the property the same way. The shipped catalogue's control classes set no `supportedTypes`, so today every class ranks as compatible and the ranking turns on countermeasure counts. A class is ranked strictly only once a module sets the list on it.

**Layer 2 — MCP tool (`query_controls` `rank` action):** Accepts `element_types`, an optional `module_id` and an optional `top_n`. Calls the schema query and scores each candidate from two per-class facts in the query result:
- `compatible` = the class's `supportedTypes` includes one of the element types, or the class sets no `supportedTypes`
- `configured` = countermeasure count > 0 for this class

> **Implementation status:** the design also had the tool enrich candidates with local context — `sameDomain` (the control class's module matches the element class's module) and `alreadyAssigned` (the element id is in the control's assigned elements). Neither is implemented: the tool reads no local file and takes no element class id, and the score uses `compatible` and `configured` only. The control pass compensates by pre-populating proposals from attribute evidence (see the prerequisites in [`controls-enrichment.md`](../../../apps/dethereal/workflow/shared/controls-enrichment.md)) rather than per-element class context.

Scoring formula:

```
score = compatible_and_configured / total_classes
      - penalty * incompatible_and_configured / total_classes

where:
  compatible_and_configured = compatible classes AND countermeasures > 0
  incompatible_and_configured = incompatible classes BUT countermeasures > 0
  penalty = 1.0 (misconfigured classes fully offset a compatible class)
```

Three buckets:
- **compatible + configured** → contributes positively (this class helps)
- **incompatible + unconfigured** → neutral (dormant, generates nothing)
- **incompatible + configured** → penalty (generates wrong countermeasures)

A class can only be incompatible if it sets an explicit `supportedTypes` list that omits the element type, so the penalty applies only to such classes. While no class sets the list, every class is compatible and a control's score is the share of its classes that have countermeasures.

**Relevance label thresholds:**

| Label | Score range | Additional constraint | Meaning |
|-------|-----------|----------------------|---------|
| **strong** | >= 0.8 | `incompatible_and_configured == 0` | All relevant classes fit; no wrong countermeasures |
| **good** | >= 0.5 | — | Majority of classes fit; minor gaps |
| **weak** | < 0.5 | — | More noise than signal; recommend creating new |

The `strong` label requires zero misconfigured classes regardless of score. A control with 3 compatible + 1 misconfigured class scores `3/4 - 1.0*1/4 = 0.5` ("good", not "strong") — the misconfigured class prevents the strong label both by score and by the explicit constraint. This prevents false confidence: a control labeled "strong" never generates inaccurate countermeasures.

Returns top 5 candidates pre-ranked with relevance label, class-level fit details, and countermeasure counts (per class and in total).

**Layer 3 — Agent and skill:** The security-enricher builds the proposal table from the pre-ranked candidates and returns it; it never asks the operator. The `enrich-controls` skill, in the main conversation, shows the table whole and asks its question (assign as marked / change marks / skip). No scoring loop, no unbounded reasoning. The agent's only judgment call is whether to recommend creating a new control when all candidates are weak.

**Verification before assignment:** The `rank` result carries each candidate's countermeasure counts — per class and in total — so the agent's table shows them (the Countermeasures column of the brownfield table in [`controls-enrichment.md`](../../../apps/dethereal/workflow/shared/controls-enrichment.md)) and the operator sees what a control provides before confirming it. This closes the verification gap without an additional tool call.

**Why not create a new control instead?** When no existing control scores above `weak` (all candidates have incompatible-and-configured classes), the agent recommends creating a new control with only the applicable classes rather than reusing a poor match.

The agent returns the candidates as one table per boundary, with class relevance and countermeasure counts visible, and the skill shows it with its questions:

```
## Control Assignment — [Boundary Name]

Components: [list component names and types in this boundary]

Existing controls from your library:

| # | Suggested Control | Relevance | Classes (relevant / total) | Countermeasures | Assign? |
|---|-------------------|-----------|---------------------------|-----------------|---------|
| 1 | DB Encryption (PG) | strong | 3/3 (Encryption-at-Rest, PG-TDE, KMS) | 12 | Y |
| 2 | WAF Protection (AWS) | good | 2/3 (WAF, CloudFront; Azure N/A) | 8 | Y |
| 3 | WAF Protection (Generic) | weak | 1/2 (WAF; Azure-FrontDoor N/A) | 3 | ? |
```

The skill then asks `Assign the controls marked Y for [Boundary Name]? (assign as marked / change marks / skip)` and, optionally, `Additional controls not in your library? (describe or "none")`.

#### Greenfield (no existing controls)

Three facts pick the path for a boundary: whether the platform is reachable, whether `rank` returned candidates, and whether the element has an assigned class.

| Platform reachable? | `rank` outcome | Element has a class? | Path |
|---|---|---|---|
| yes | ≥1 candidate | — | **Path 1 (brownfield)** — the table above |
| yes | empty | yes | **Path 2 (file-first greenfield)** — the agent proposes a new Control with its ControlClass bindings; once confirmed, the skill writes `controls/<temp-id>.json` with `lifecycle: "greenfield"` and the push creates the Control ([§6.1](#61-two-path-control-integration)) |
| yes | empty | no | **Path 3 (name-only)** |
| no | — | — | **Path 3 (name-only)** |

Path 2 is the greenfield default for an element with a class, because it keeps the ControlClass binding that countermeasures are derived from. The skill asks `Assign the proposed controls and ControlClass bindings for [Boundary Name]? (assign / change / skip)`, then optionally `Enter any other enforcement controls for [Boundary Name], or "none" to skip.` The greenfield table:

```
## Enforcement Controls — [Boundary Name]

Components: [list component names and types]

What enforcement controls protect components in this boundary?
(Firewalls, WAFs, API gateways with security rules, IDS/IPS, network access controls)

| # | Control | Protects | Type |
|---|---------|----------|------|
| ? | ?       | all / specific components | firewall / WAF / IDS / other |
```

Path 3 is the fallback: it writes references as `{ id: null, name: "WAF Protection" }` and creates nothing. At push time the reference links only to a Control with exactly this name; if none or several exist, the whole push is refused and nothing is pushed until the operator decides the entry (see [SYNC_AND_SOURCE_OF_TRUTH.md §12](SYNC_AND_SOURCE_OF_TRUTH.md#push-flow)). A name-only reference binds no ControlClass, so once the platform is reachable it should be promoted to Path 1 or Path 2.

### 6.4 Local JSON format

Control references use the `ControlReference` schema, which both the import and the update pipeline process. Controls can be stored on **boundaries, components, data flows, or data items** — the schema supports `controls?: ControlReference[]` on all four. A data item's list follows its own push rule: a present list (including `[]`) replaces the item's controls and an absent key leaves them as they are, where on the other three an absent key clears them. See [IMPORT_EXPORT.md — Data Item Controls](../dt-core/IMPORT_EXPORT.md#data-item-controls).

**Boundary-level assignment (preferred for enforcement controls):** When a control protects an entire boundary (e.g., a firewall protecting a DMZ), store the control reference on the boundary in `structure.json`, not on each individual component. This matches how security teams think ("WAF protects the DMZ zone"), avoids stale fan-out when components are added later, and creates a `SUPPORTS -> SecurityBoundary` edge at sync — which the platform supports natively.

Boundaries nest under `defaultBoundary.boundaries[]`, and each boundary lists its components under `components[]`; `controls` is a field on the boundary or component object itself:

```json
// structure.json — boundary with enforcement controls
{
  "defaultBoundary": {
    "id": "root",
    "boundaries": [
      {
        "id": "boundary-dmz",
        "name": "DMZ",
        "controls": [
          { "id": "ctrl-waf", "name": "WAF Protection", "source": "declared" },
          { "id": null, "name": "Perimeter Firewall", "source": "declared" }
        ],
        "components": [
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
    ]
  }
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

1. **Attribute-inferred coverage:** Count classified elements with at least one positive security attribute (per the positive attribute mapping table in Section 10). This is the offline-only baseline.
2. **Formal control coverage:** Count classified elements that are "control-covered" divided by total classified elements. This supplements attribute-inferred coverage once the enrichment workflow captures control references.

An element is **control-covered** when any of the following is true:
- It has a non-empty `controls[]` array (even with null IDs) — directly assigned
- It is a child of a boundary that has a non-empty `controls[]` array — **boundary-inherited coverage**

Boundary-inherited coverage is critical: Section 6.4 recommends boundary-level assignment for enforcement controls (`SUPPORTS → SecurityBoundary`). A firewall assigned to the DMZ boundary protects all components inside that boundary. Without inheritance, the quality score would show 0% formal coverage on those components despite them being protected — a misleading signal that contradicts the recommended assignment pattern.

**Implementation:** The `computeQuality` method already reads `structure.json` and walks the boundary tree (it collects component IDs recursively). When counting formal coverage, walk the tree and propagate `controls[]` from boundaries to their children. A component counts as covered if `component.controls.length > 0` OR `parentBoundary.controls.length > 0` (checked recursively up the boundary hierarchy).

The quality score should use the **maximum** of the two computations (attribute-inferred and formal) for each element: an element with `encryption_in_transit: TLS 1.3` and no `controls[]` still counts as covered (attribute-inferred). An element with a `controls[]` entry (directly or boundary-inherited) but no enrichment attributes also counts (formally assigned).

**Platform-side note:** The `get_control_gaps` backend query also traverses boundary-level SUPPORTS edges. When it checks whether an element is mitigated, and whether it has any control at all, it matches both direct `(Control)-[:SUPPORTS]->(Element)` and indirect `(Control)-[:SUPPORTS]->(Boundary)<-[:BELONGS_TO]-(Element)` paths, so gap recommendations do not suggest redundant controls for elements a boundary-level assignment already protects. The indirect path is **one hop**: only the boundary the element directly belongs to counts, not that boundary's ancestors. The local quality score is wider: it inherits `controls[]` down the whole boundary tree.

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
2. **Unmitigated, unaddressable (module gap)** — ATT&CK Mitigations exist but no installed module's ControlClass produces countermeasures for them, or the exposure's techniques have no mapped mitigations at all (then its `mitreMitigations` list is empty). Actionable for module authors, not for users. The backend returns these separately so the surface report lists them apart: "No ControlClass covers mitigation M1032 in your installed modules."
3. **No MITRE chain** — Exposure has no `EXPLOITED_BY` link to an ATT&CK Technique. Not actionable through the framework. These count toward `totalExposures` but not toward any coverage tier.

(The backend also counts the exposures that are mitigated, and those whose element has a control that addresses other techniques; [Section 11](#get_control_gapsmodel_id--highest-impact) has all five buckets.)

**Type-compatible filtering:** The `get_control_gaps` recommended-controls query keeps a control class only when its `supportedTypes` lists one of the element types present in the model, or when it sets no `supportedTypes` at all. The filter is lenient: it runs over all of the model's element types rather than the type of the element each gap is on, and a class without the list passes for every type. While classes set no `supportedTypes`, it removes nothing. This is a backend-side filter (one `WHERE` in the query), not an agent-side evaluation.

**Workflow (via backend `get_control_gaps` tool — see Section 11):**

1. The `/dethereal:surface` skill calls `get_control_gaps(model_id)` — a single MCP tool call. The skill runs read-only, in the model-reviewer agent.
2. Backend traverses the full chain, returns: unmitigated exposures (partitioned into addressable and unaddressable), ranked type-compatible candidate controls, and MITRE technique/mitigation/D3FEND context for each
3. The surface report lists the unmitigated exposures with their technique and mitigation (e.g. "Valid Accounts (T1078 → M1032)"), the unaddressable ones apart, and the recommended controls with their D3FEND links. It asks nothing and changes nothing.
4. To act on a recommendation, the operator runs the control pass (`/dethereal:enrich --focus controls`), which proposes controls and writes only what the operator confirms

This replaces what would otherwise be 20+ sequential MCP tool calls (N exposure queries + M countermeasure queries + agent-side diffing) with a single backend-computed result. The report's job is presentation, not graph traversal.

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

**Placeholder:** The control pass asks a single, optional free-text question: "Any governance controls to record — patch management, access reviews, change control, incident response? Describe them, or "none"." The `enrich-controls` skill records the answer as `declared_governance_controls: string[]` in `.dethereal/scope.json`. No graph entities, no SUPPORTS edges, no quality score impact — just a record that governance controls were acknowledged.

**Design direction (not built):** Formal governance controls would use `SUPPORTS -> SecurityBoundary` or `SUPPORTS -> Model` edges, never element-level edges. This aligns with how NIST CSF and ISO 27001 scope administrative controls — they apply at organizational or system boundaries, not individual components.

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

The plugin's role is the same in both cases: assign the class, fill in the attributes. The platform handles countermeasure generation, MITRE D3FEND linking, and ATT&CK Mitigation mapping. The `query_countermeasures` tool is used to **query** generated countermeasures; `manage_countermeasures` is not used to create them during modeling.

**Implementation:** No countermeasure creation logic in the plugin. When viewing control coverage (e.g., in `/dethereal:surface`), query `query_countermeasures(action: 'list', control_id: '...')` to show what countermeasures a control provides.

### Q4: Control source tracking — Implement

**Decision:** Implement `source: "discovered" | "declared" | "both"` on `ControlReference` in local JSON. No platform schema migration required.

**Rationale:** This distinction was meant to serve two features:
1. **Analysis confidence (design rationale, not implemented):** the platform's analysis could discount declared-only controls against discovered ones, since discovered controls represent verified implementation and declared controls represent security intent. It does not: `source` is local-only — export does not write it and import discards it — so the platform never sees it.
2. **Compliance reporting:** SOC2 Type I auditors distinguish between implemented and planned controls. The `source` field enables this distinction in the local two-tier reporting output (the `source_breakdown` of the coverage report).

**Implementation:** `source?: "discovered" | "declared" | "both"` is on `ControlReference` in the local JSON schema. The control pass sets `source: "declared"` for user-stated controls and `source: "discovered"` when controls are inferred from IaC/code attributes. Promoting it to the platform would need a property on the SUPPORTS edge; that is out of scope for now.

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

The prompts are designed to minimize fatigue while capturing Categories 2-4. The core is **B + 2 questions** (B = boundary count, typically 3-5): one enforcement question per boundary, one for detection, one for governance — 6 for a typical 4-boundary model (the governance question is optional). On top come one question per crown-jewel component (the crown-jewel sweep), the optional "additional controls" follow-ups per boundary and for detection, and the control-library step's questions when a reference has a platform id.

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

For boundary-scoped controls (e.g., "this firewall protects the entire DMZ"), the control reference goes on the **boundary** entry in `structure.json`; for controls protecting specific components, on the component entry. The agent proposes the level; the `enrich-controls` skill writes the reference once the operator confirms it. See Section 6.4 for assignment level guidance.

If the platform is reachable, the agent calls `query_controls(action: 'rank', element_types: [...], module_id: '<active-module-id>')` to get pre-ranked control candidates with class-level fit details (Section 6.3). The MCP tool returns top 5 candidates scored and labeled (strong/good/weak), with their countermeasure counts. The agent puts them in its proposal table and returns it — no scoring loop needed — and the `enrich-controls` skill shows the table and asks the operator. If no existing control scores above `weak`, the agent's table recommends creating a new one with only the applicable classes. Existing controls that are assigned already have countermeasures generated — assigning them is pure linking, immediately providing countermeasure coverage on the element.

**Error recovery:** If `query_controls(action: 'rank')` fails (platform unreachable or error), fall back to the greenfield prompts (name-only references). Do not retry or stall.

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

### Step 3 — Governance Placeholder (Category 4)

**Single prompt, once per model.** No graph entities created — documentation only.

```
Any governance controls to record — patch management, access reviews, change control,
incident response? Describe them, or "none".
```

The question is optional, and no formal governance control mapping is made.

Responses written to `.dethereal/scope.json` as `declared_governance_controls: string[]`.

### Prompt Sequence

The control focus pass has two roles. The security-enricher runs as a separate agent invocation (its own turn budget; see Section 6.2): it gathers the evidence, ranks, and returns every proposal table — it never asks the operator and writes nothing. The `enrich-controls` skill, in the main conversation, shows each table, asks its question, and writes what the operator confirms, with **incremental persistence** — each boundary's confirmed control references are written to local JSON as soon as its answers are in, not at the end:

```
/dethereal:enrich --focus controls  (enrich-controls skill, main conversation)
  1. Resolve the model; read structure, data flows and scope; read the workflow state
  2. Choose boundaries — those without enforcement controls, crown-jewel boundaries first
     - If more than 6: tiered question — crown-jewel only / all / skip
  3. Start the security-enricher in control-pass mode with those boundaries.
     The agent (writes nothing):
     a. Reads model files + attribute files (context loading)
     b. Step 1, per boundary (Category 2): ranks, or builds the greenfield table
        - If boundary_count == 0: one global enforcement proposal
     c. Crown-jewel sweep: per crown-jewel component, a component-scoped control
        or a one-line reason why boundary-level protection suffices
     d. Step 2: detection proposal, pre-populated from monitoring_tools (Category 3)
     e. Step 3: governance placeholder (Category 4)
     f. Returns every table; if its turns run short, stops after a complete
        boundary and lists the ones left
  4. For each returned table: show it, ask its question, then write the
     confirmed control references  ← checkpoint (per boundary)
  5. Start the agent again for the boundaries it left
  6. Control library attributes (when a reference has a platform id)
  7. Validate and report quality score
```

**Incremental persistence rationale:** An agent that reaches its turn limit is cut off by the harness, so the agent is told to stop after a complete boundary when its turns run short and to list the boundaries left; the skill then starts it again for those. Because the skill writes each boundary's controls as soon as the operator confirms them, the confirmed boundaries are already persisted if the pass stops early. A later run handles resumption (Section 8, "Re-run behavior"): previously declared controls appear as "currently assigned", and only the boundaries still without enforcement controls are handed to the agent.

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

The accounting is against the agent's limit of 40 turns on Claude Code (40 steps on OpenCode); the plugin sets no turn limit on Codex. The agent's part of the pass fits that limit; the skill's questions and writes are its own. At B=6 brownfield, the pass uses 22 of 40 turns — leaving 18 turns for error recovery and `rank` failures (which fall back to greenfield prompts, saving 1 turn per failed boundary). **Tiered prompts for B>6 are part of the pass**, not a deferred enhancement. For B>6, collapsing to crown-jewel boundaries first reduces the effective B to 3-4 while preserving coverage for the highest-value elements.

**Skip behavior:** If the user answers "none" to any step, it takes one word to skip. Skipped controls leave `controls[]` empty; the quality score reflects this, and `/dethereal:surface` catches gaps post-analysis.

**Re-run behavior:** On re-run, the agent reads the existing `controls[]` from local JSON, and the skill hands it only the boundaries still without enforcement controls. A boundary or component that already has controls is skipped unless the operator asks to change it; then its controls are shown first as "currently assigned", and the skill asks `Add more controls or modify? (add / modify / skip)`. New control references are additive: an existing one is never removed silently, only when the operator asks for its removal.

**Turn budget exhaustion:** The agent writes nothing, so running out of turns loses no file state. When its turns run short, it returns after a complete boundary with the boundaries left, and the skill starts it again for those. With incremental persistence, the skill writes each boundary's controls as soon as the operator confirms them, so every confirmed boundary is already saved if the pass stops early. A later run hands the agent only the boundaries still without enforcement controls, and the agent reads the existing controls (see "Re-run behavior" above).

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

| Tier | Components | With Controls | Without Controls |
|------|------------|---------------|------------------|
| 1 — Internet-facing | 2 | 2 (100%) | — |
| 2 — Crown jewel or restricted | 4 | 2 (50%) | payment-db, auth-svc |
| 3 — Internal | 6 | 1 (17%) | scheduler, batch-worker, config-svc, msg-queue, +1 more |
| **Total** | **12** | **5 (42%)** | **7 components without formal controls** |
| Crown jewels (label — overlaps the tiers, not added to them) | 3 | 2 (67%) | payment-db |
| Cross-boundary (label — overlaps the tiers, not added to them) | 4 | 1 (25%) | auth-svc, msg-queue, batch-worker |

Formal coverage required for: SOC2 CC6.1, ISO 27001 A.8, PCI-DSS 6.x.
Run /dethereal:enrich --focus controls to assign controls.
```

The tiers are the three the gates use, and each classified component is in exactly one of them; external entities are not counted. Crown jewels and cross-boundary components (outside Tier 1, talking across a boundary) are labels that overlap the tiers and are never added to them.

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

## 10. What Shipped

Every item of this design is built. The table records what each item does, where it lives, and where it shipped differently from the design.

> The plugin's prompts live in a single workflow source that is generated into each harness's bundle: skills are under `oss/apps/dethereal/workflow/skills/`, agents under `oss/apps/dethereal/workflow/agents/`, and shared instructions under `oss/apps/dethereal/workflow/shared/`. See [PLUGIN_ARCHITECTURE.md §2](PLUGIN_ARCHITECTURE.md#2-plugin-structure). Plugin paths in the table are relative to `oss/apps/dethereal/`.

| What it does | Where | Status |
|---|---|---|
| The quality score derives `control_coverage_rate` from enrichment attributes ([mapping table below](#quality-score-from-attributes)) and from `controls[]` references, with boundary inheritance (§6.5), instead of a hardcoded `0` | `src/tools/validate-model.tool.ts` | Shipped |
| `/dethereal:enrich --focus controls` runs the three-step control pass (Section 8) | `workflow/skills/enrich/SKILL.md`, `workflow/skills/enrich-controls/SKILL.md` | Shipped differently: the enrich skill hands `--focus controls` over to the `enrich-controls` companion skill, which runs the pass |
| Control assignment instructions for the control pass, in their own file rather than in the base enrichment instructions | `workflow/shared/controls-enrichment.md` | Shipped |
| The security-enricher's control-pass mode: it gathers evidence, ranks, and returns proposal tables, and writes nothing | `workflow/agents/security-enricher.md` | Shipped differently: the design kept the control instructions out of the agent and referenced them from the enrich skill only. The agent carries them inline, with the other shared protocols; the instructions open with a self-gate that makes every other enrichment ignore them, and the main conversation's regular enrichment never loads them ([§6.2](#62-workflow-placement)) |
| `rank`: calls the `controlCandidatesForType` query, scores with the Section 6.3 formula (`compatible` + `configured`; no local element context), and returns the top N | `src/tools/manage-controls.tool.ts`, `src/tools/query-security.tool.ts` | Shipped: implemented in the `manage_controls` tool; MCP clients call it as `query_controls` `rank`, which forwards only `element_types`, `module_id` and `top_n` |
| The `controlCandidatesForType` query: controls with at least one compatible class, the fit of every class, and the assigned elements ([specification below](#the-controlcandidatesfortype-query)) | `oss/apps/dt-ws/schema/schema.graphql`, `oss/apps/dt-ws/src/gql/resolver-services/control-candidates-resolver.service.ts` | Shipped differently: declared with `@authentication` and no `@cypher` directive, and served by a custom resolver, `ControlCandidatesResolverService` (Section 11) |
| The update pipeline resolves every element's `controls` list (strictly, on a push) and writes it ([below](#control-writes-in-the-update-pipeline)) | `oss/packages/dt-core/src/dt-update/dt-update.ts` | Shipped |
| `manage_controls` `assign`: takes `control_id` + `element_ids[]` and creates the SUPPORTS edges ([§12.4](#124-no-batch-assignment-api--resolved)) | `src/tools/manage-controls.tool.ts` | Shipped |
| `findControls()` in dt-core: the `controlIdsByElements` query for an element-based lookup, the auto-generated GraphQL for the other filters | `oss/packages/dt-core/src/dt-control/dt-control.ts` | Shipped |
| `assignControlToElements()` in dt-core: an append-only connect through the four typed relationships (`supportedComponents`, `supportedBoundaries`, `supportedDataFlows`, `supportedData`), not the polymorphic `elements` field, whose selection is correct on Memgraph only with the platform's patched `@neo4j/graphql`. It reads the attached IDs first and connects the difference, because `connect` compiles to a bare relationship CREATE rather than a MERGE, so it is idempotent across sequential calls only; two concurrent callers can still append a parallel edge | `oss/packages/dt-core/src/dt-control/dt-control.ts` | Shipped |
| Unresolved control references at push | `workflow/skills/sync/SKILL.md`, `workflow/shared/control-resolution.md`, `oss/packages/dt-core/src/dt-control-resolution/dt-control-resolution.ts` | Shipped differently, stricter than designed: the design passed an unresolved reference through as a warning. The push refuses before anything is written and asks the operator to decide each entry. After a successful push, the server writes the id of each control it linked by name back into the local files ([§12.1](#121-supports-edge-idempotency-on-re-sync--resolved)) |

Together these close the import-export round-trip for controls: controls survive a re-sync, post-analysis gap-filling through `/dethereal:surface` works end to end, and two-tier reporting has both inferred and formal coverage.

### Quality score from attributes

The quality score derives `control_coverage_rate` from existing enrichment attributes (Category 1 auto-inference), with no change to the workflow, and from the `controls[]` references the control pass writes.

**Scope limitation:** this is the score the plugin reports, not the platform's analysis. The analysis still does not use the full set of enrichment attributes when it weighs attack paths (§3.5); what it receives of the declared controls is the SUPPORTS edges a push writes.

**Positive attribute mapping table** (used by the quality score computation):

| Attribute | Counts as "control present" when | Does NOT count |
|-----------|----------------------------------|----------------|
| `encryption_in_transit` | The value names encryption (e.g. `TLS 1.3`, `mTLS`, `HTTPS`, `IPsec`, `WireGuard`), or is a plain `yes` / `true` / `enabled` | A negation or deprecated protocol as the whole value (`none`, `no`, `disabled`, `plaintext`, `cleartext`, `unencrypted`, `http`, `SSLv2`, `SSLv3`, `TLS 1.0`, `TLS 1.1`), a placeholder, "not applicable", or a value that names no encryption |
| `encryption_at_rest` | The value names encryption (e.g. `AES-256`, `KMS`, `TDE`, `LUKS`, `BitLocker`), or is a plain `yes` / `true` / `enabled` | The same negations, plus a broken cipher alone (`DES`, `3DES`, `RC4`); placeholders and "not applicable" |
| `authentication_type` | The value names an authentication method; `basic` and `digest` count only when `encryption_in_transit` names encryption (credentials over cleartext or deprecated TLS are a vulnerability per PCI-DSS 4.0 §4.2.1, not a control) | A negation (`none` and the like), a placeholder; `basic` / `digest` without encryption |
| `monitoring_tools` | The array lists at least one real tool | `[]`, absent, or only placeholders such as `none` or `n/a` |
| `implicit_deny_enabled` | `true` | `false`, `null`, absent |

Placeholders (`unknown`, an empty string and the like) count as absent everywhere.

A classified component counts toward `control_coverage_rate` when it has **at least one positive security attribute** from this table, or a `controls[]` reference of its own or on an enclosing boundary. The metric is: covered classified components / total classified components.

**Quality threshold rationale:** A model where every component uses `TLS 1.0` and `basic` auth should not score 100% on control coverage — that is a false confidence signal. The thresholds exclude deprecated protocols and cleartext-credential combinations that a security team would flag as findings, not credit as controls.

### The `controlCandidatesForType` query

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
  compatible: Boolean!          # supportedTypes includes a queried element type, or the class sets none
  countermeasureCount: Int!     # >0 means configured (OPA generated countermeasures)
}

type Query {
  controlCandidatesForType(
    elementTypes: [ComponentType!]!
    moduleIds: [ID!]
  ): [ControlCandidate!]!
    @authentication
}
```

`ControlCandidatesResolverService` checks authorization, rejects an empty `elementTypes` list or one longer than 20, defaults an omitted `moduleIds` to `[]`, and runs this Cypher:

```cypher
// Two-pass: prune to eligible controls first, THEN collect ALL of each
// eligible control's classes. Filtering classes by supportedTypes before
// the collect would make `compatible` tautologically true and the
// incompatible-configured penalty (the score formula above) unreachable.
// An absent supportedTypes list = every element type; an explicit list
// (empty included) is read strictly. IS NULL comes first because Memgraph
// raises on membership against a null list.
MATCH (ctrl:Control)-[:IS_INSTANCE_OF]->(cc0:ControlClass)<-[:HAS_CLASS]-(m0:Module)
WHERE (cc0.supportedTypes IS NULL OR ANY(et IN $elementTypes WHERE et IN cc0.supportedTypes))
  AND (size($moduleIds) = 0 OR m0.id IN $moduleIds)
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
       compatible: cc.supportedTypes IS NULL OR ANY(et IN $elementTypes WHERE et IN cc.supportedTypes),
       countermeasureCount: cmCount
     }) AS classes,
     sum(cmCount) AS totalCm
OPTIONAL MATCH (ctrl)-[:SUPPORTS]->(elem)
WITH ctrl, classes, totalCm, collect(DISTINCT elem.id) AS assignedIds
RETURN ctrl.id AS controlId, ctrl.name AS controlName,
       classes, totalCm AS totalCountermeasures, assignedIds AS assignedElementIds
```

Note: `elementTypes` is an array — the MCP `rank` action forwards whatever element types its caller gives (the control pass passes the types present in the boundary), and the Cypher returns controls compatible with any of them. The `compatible` field per class tells the MCP tool which specific classes match which types, enabling per-class scoring without additional queries.

### Control writes in the update pipeline

The import pipeline's `associateControlsDirectly` (in `dt-import.ts`) sets `dataItems: []` when it links controls, with the comment "Will be set later during data item association" — safe on a first import, where data items are linked in a later pass. The update pipeline works on elements that already have relationships, so it does not use that pattern: it writes `controls` through each element's update mutation (`dt-component.ts`, `dt-boundary.ts`, `dt-dataflow.ts`), which handles every link list on its own and leaves the other relationships untouched.

- An element whose `controls` key is absent (`undefined`) keeps its controls: the key is left out of the mutation.
- A present list replaces the association: the mutation disconnects every existing SUPPORTS edge of the element, then connects the list. (Given a baseline of what the list held before, the same mutation writes only the difference; the update pipeline passes none.)
- When the control catalog cannot be fetched, the update preserves the existing controls and reports the step as failed rather than clearing them.
- A data item's controls go through the data item's own update mutation (`dt-dataitem.ts`) and follow their own push rule: a list in `data-items.json` (including `[]`) replaces the item's controls, and an absent key leaves them as they are, where for a boundary, component or data flow the push sends an absent key as an empty list, which clears them. A data item the push creates gets its resolved controls connected at create. See [IMPORT_EXPORT.md — Data Item Controls](../dt-core/IMPORT_EXPORT.md#data-item-controls).

---

## 11. Implementation Architecture

### Backend delegation strategy

Three operations should be implemented as server-side computations exposed through MCP tools, rather than multi-step agent orchestrations. The agent's turn limit is 40 turns on Claude Code and 40 steps on OpenCode (the plugin sets none on Codex); these operations would consume 24+ turns if done client-side. As backend tools, they each take 1 turn.

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
Input:  { model_id: string, top_n?: number (1–20, default 3), limit?: number (1–200, default 50) }
Output: {
  "unmitigatedExposures": [{
    "elementId": "<id>", "elementName": "payment-db",
    "exposureId": "<id>", "exposureName": "SQL injection",
    "attackTechniques": [{ "id": "T1190", "name": "Exploit Public-Facing Application" }],
    "recommendedMitigations": [{ "id": "M1050", "name": "Exploit Protection" }]  // addressable ones only
  }],
  "unaddressableExposures": [{
    "elementId": "<id>", "elementName": "payment-db",
    "exposureId": "<id>", "exposureName": "Weak or trust authentication",
    "attackTechniques": [{ "id": "T1078", "name": "Valid Accounts" }],
    "mitreMitigations": [{ "id": "M1032", "name": "Multi-factor Authentication" }]  // all known; may be []
  }],
  "recommendedControls": [{
    "controlId": "<id>", "controlName": "WAF Protection (AWS)",
    "controlClassId": "<id>", "controlClassName": "Web Application Firewall Rules",
    "d3fendTechniques": [{ "id": "D3-ITF", "name": "Inbound Traffic Filtering" }],
    "addressesCount": 1,                                     // distinct gap techniques it addresses
    "elementsAffected": [{ "id": "<id>", "name": "api-gateway" }]  // model elements it supports, directly or via their boundary
  }],
  "coverageSummary": {
    "totalExposures": 12,
    "mitigated": 7, "configuredCoverage": 2, "noMitreChain": 1,
    "unmitigated": 1, "unaddressable": 1,
    "coveragePct": 58.33                                     // mitigated / totalExposures × 100
  }
}
```

The tool passes the platform's `controlGaps` result through unchanged, so the fields are camelCase; every object in it also carries GraphQL's `__typename`, left out above. When `totalExposures` is 0, the result also carries a top-level `warnings` entry asking for an exposure analysis first.

Every exposure lands in exactly one of five buckets, checked in this order. The five counts are disjoint and sum to `totalExposures`:

| Bucket | The exposure… | Listed in |
|--------|---------------|-----------|
| `noMitreChain` | has no ATT&CK technique (`EXPLOITED_BY`), whatever controls its element has | count only |
| `mitigated` | has a control on its element, or on the boundary that element directly belongs to (one `BELONGS_TO` hop), with a countermeasure that `RESPONDS_WITH` an ATT&CK mitigation defending against one of its techniques | count only |
| `configuredCoverage` | has a control assigned (`SUPPORTS`) to its element or to that direct parent boundary, but none of those controls has such a countermeasure | count only |
| `unmitigated` | has no control on its element or that boundary, and at least one of its mitigations is addressable: a countermeasure of an installed module's control class responds with it | `unmitigatedExposures` |
| `unaddressable` | has no control on its element or that boundary, and none of its mitigations is addressable, or MITRE lists no mitigation for its techniques | `unaddressableExposures` |

`coveragePct` is `mitigated / totalExposures × 100`, rounded to two decimals, so `noMitreChain` exposures count in the denominator. `limit` caps each exposure list; the counts are never capped. `recommendedControls` holds existing controls with a countermeasure that responds with a mitigation of a gap technique. Gap techniques come from every `unmitigated` exposure (before `limit`) and from the `configuredCoverage` exposures that have an addressable mitigation. Each entry is one control–class pair, and the class must list one of the model's element types in its `supportedTypes`, or set no `supportedTypes` at all. Entries are ordered by `addressesCount`, highest first, and the first `top_n` are returned. The schema types `controlId` and `controlName` as nullable, but the resolver always fills them.

Implementation: the `controlGaps` resolver runs three read queries (scope and gaps, mitigation addressability, recommended controls) and does the bucketing between them. The graph engine handles this in milliseconds. The callers only present the result: the surface report lists it read-only, and Step 11 of the guided workflow (the `threat-model` skill, in the main conversation) shows the exposures as a linking table and asks the operator before it links any exposure to a countermeasure.

#### Control matching — three-layer architecture

Control candidate ranking is split across three layers, the last of them shared by the agent and the skill (see Section 6.3 for details):

| Layer | Component | Responsibility | Why here |
|-------|-----------|---------------|----------|
| **GraphQL query** (custom resolver) | `controlCandidatesForType` query, served by `ControlCandidatesResolverService` | Return controls with at least one compatible class, every class with its `compatible` flag and countermeasure count, and assigned elements | One two-pass Cypher query behind the platform's GraphQL API, usable by any client; the resolver checks authorization and validates the input |
| **MCP tool** | `query_controls` `rank` action | Take `element_types` (required; 1–10 of `PROCESS`, `EXTERNAL_ENTITY`, `STORE`, `BOUNDARY`), an optional `module_id` and `top_n` (1–50, default 5); score each candidate from its classes' `compatible` flag and countermeasure counts (Section 6.3), sort, return the top N with score, relevance label, per-class fit and countermeasure counts | Keeps the schema query data-only; the scoring formula and labels are tool policy. It reads no local file data (element class context is not implemented; see the Section 6.3 implementation status) |
| **Agent** (security-enricher) | Proposal | Build the proposal table from the pre-ranked candidates and return it — never ask the operator; recommend a new control if all candidates are weak | Judgment: only whether to create new vs assign existing |
| **Skill** (`enrich-controls`, main conversation) | Presentation + confirmation | Show each returned table, ask its question, write the confirmed control references | The operator can only be asked in the main conversation |

This replaces the previous design where the agent performed the entire evaluation loop (~10-15 reasoning turns) with a single MCP tool call (1 turn). The scoring formula is deterministic (Section 6.3).

#### `validate_model_json` `coverage` action — reporting

Designed as a separate `compute_control_coverage(directory_path, model_id?)` tool; shipped as the `coverage` action of `validate_model_json`. Replaces multi-step coverage computation (~4 agent turns → 1 tool call). Hybrid local/online:

- **Offline** (`directory_path` only): reads the local model and attribute files. It computes inferred coverage with the positive attribute mapping table, formal coverage by tier from `controls[]` references (with boundary inheritance), and the source breakdown. Its summary measures **assignment**, not mitigation — a control with no countermeasures still counts — so the result carries `coverage_kind: "assignment-heuristic"` and a warning not to report it as exposures mitigated.
- **Online** (`model_id`, signed in): the summary is the platform's `controlGaps` result (the five buckets above), and `details` holds that result whole; with a readable `directory_path` it adds the local inferred, formal and source breakdowns.

```
Input:  { action: 'coverage', directory_path?: string, model_id?: string }
Output: {
  mode: 'online' | 'offline',
  coverage_kind?: 'assignment-heuristic',            // offline only
  coverage_summary: { total_exposures, mitigated, unmitigated, unaddressable,
                      configured_coverage?, no_mitre_chain?, coverage_pct },  // the last two online only
  inferred_coverage?: { authentication, encryption_transit, encryption_at_rest, monitoring },
                                                     // each { covered, total, missing: string[] }
  formal_coverage?: {
    tier_1_internet_facing, tier_2_crown_jewel_or_restricted, tier_3_internal,
                                                     // each { total, with_controls, gaps, gaps_total, unclassified }
    labels: { crown_jewels, cross_boundary },        // same shape; overlap the tiers
    cross_boundary_flows, cross_boundary_flows_total, externals_excluded, tier_3_unzoned
  },
  source_breakdown?: { discovered, declared, both }, // when any reference carries a source
  details?: <the controlGaps result>                 // online only
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

The MCP `rank` action on `query_controls` (Section 6.3) is the largest single improvement — it replaces an unbounded agent reasoning loop (evaluate every candidate control's class profile) with a single deterministic tool call. Combined with the backend delegation, these 4 tool calls replace what was previously impossible to fit within the agent's 40-turn limit on Claude Code.

See Section 8 "Turn Budget Breakdown" for the full control pass turn accounting.

### Agent instruction strategy

Control assignment instructions are factored into a separate file ([`workflow/shared/controls-enrichment.md`](../../../apps/dethereal/workflow/shared/controls-enrichment.md)), read on demand by the `enrich-controls` companion skill that runs the `--focus controls` pass, so non-control enrichment flows never load it. The security-enricher agent ([`workflow/agents/security-enricher.md`](../../../apps/dethereal/workflow/agents/security-enricher.md)) includes it, with the other shared protocols, for its proposal-only control-pass mode.

### Enhancement architecture — three-layer split

New enhancements are split across three layers based on what each layer has access to:

#### Layer 1: Graph queries (graph data, no app logic)

Queries that are single Cypher traversals with no multi-phase orchestration. The design put them in `schema.graphql` as `@cypher` directives with `@authentication`, following existing `@cypher` operations (`getExposuresForElement`, `addElementsToIssue`, `removeElementFromIssue`, etc.). Both control queries below shipped differently: each is declared in the schema with `@authentication` and no `@cypher` directive, and served by a custom resolver service.

| Query | Purpose | Cypher |
|-------|---------|--------|
| `controlCandidatesForType(elementTypes, moduleIds)` | Return controls with at least one compatible class, every class of each with its `compatible` flag and countermeasure count, and assigned element IDs. Shipped as a custom resolver (`ControlCandidatesResolverService`), not a `@cypher` directive — see [its specification](#the-controlcandidatesfortype-query) | Two-pass: prune with `cc0.supportedTypes IS NULL OR ANY(et IN $elementTypes WHERE et IN cc0.supportedTypes)` (plus the optional module filter), then collect all classes of each eligible control with the same test as the per-class `compatible` flag |
| `controlIdsByElements(elementIds)` | Control IDs by SUPPORTS edges | A custom resolver in `ControlGapsResolverService`; the design marked it a candidate for simplification to `@cypher` |

**Why the design preferred `@cypher`:** These are pure data retrieval — no multi-phase orchestration, no application-level partitioning, no complex output assembly. A `@cypher` directive provides auth via `@authentication`, avoids ~60 lines of resolver boilerplate per query, and is simpler to maintain; custom resolvers were reserved for operations that need multi-phase Cypher orchestration with application logic between phases (like `controlGaps` and `matchClasses`). As shipped, both queries above are resolver services, which also check authorization and validate their inputs (for `controlCandidatesForType`: at least one and at most 20 element types).

#### Layer 2: Custom resolver enhancements (existing resolvers, multi-phase logic)

Modifications to existing custom resolvers that already need application logic:

| Enhancement | Resolver | Change |
|-------------|----------|--------|
| Type-compatible gap recommendations | `ControlGapsResolverService` | The resolver's recommended-controls Cypher (its third phase) filters with `WHERE cc.supportedTypes IS NULL OR ANY(et IN $elementTypes WHERE et IN cc.supportedTypes)`; `$elementTypes` is the distinct element types of the model's elements that carry exposures, not only those with gaps. An absent list matches every element type, as in `controlCandidatesForType` |
| Configured coverage metric | `ControlGapsResolverService` | **Shipped.** `configuredCoverage` in `CoverageSummary` counts **exposures**, not controls: exposures with at least one ATT&CK technique whose element has a Control assigned — on the element itself or on the boundary it directly belongs to — although no such Control has a countermeasure responding to a mitigation of those techniques (assigned, but addressing other techniques). `noMitreChain` counts the exposures with no technique. The five counts — `mitigated`, `configuredCoverage`, `unmitigated`, `unaddressable`, `noMitreChain` — are disjoint and sum to `totalExposures`. A configured-coverage exposure appears in neither exposure list, but when one of its mitigations is addressable its techniques still feed the recommended controls. |

#### Layer 3: MCP tool functions (local data + compose from backend)

Deterministic logic composed in the MCP tools from backend results, using local file context (element classData, activeModules) where a function needs it:

| Function | Tool | What it does |
|----------|------|-------------|
| Control candidate ranking | `query_controls` `rank` action | Takes `element_types` (required; 1–10 of `PROCESS`, `EXTERNAL_ENTITY`, `STORE`, `BOUNDARY`), optional `module_id` and optional `top_n` (1–50, default 5); no element class id. Calls `controlCandidatesForType`, scores each candidate with the Section 6.3 formula (`compatible` + `configured` only; the class-module match is not implemented), returns the top `top_n` as `{ candidates, total }` |
| Match result ordering | Post-process `match_classes` | Re-order same-confidence candidates by `activeModules` priority (user-set order from `scope.json`) |
| Attribute quality thresholds | `validate_model_json` `quality` action | Exclude deprecated protocols (TLS 1.0, basic-over-cleartext) from positive attribute table |

### MCP tool changes (existing tools)

**`manage_controls` tool** (`src/tools/manage-controls.tool.ts`):
- `assign` action — **Done.** Accepts `control_id` + `element_ids[]`, creates SUPPORTS edges via `assignControlToElements`.
- `rank` action — **Done.** It is implemented here, but MCP clients call it as `query_controls` `rank`; `manage_controls` does not accept it. It takes `element_types` (required: `PROCESS`, `EXTERNAL_ENTITY`, `STORE`, `BOUNDARY`) and an optional `module_id` and `top_n` (1–50, default 5). It calls the `controlCandidatesForType` query and scores per the Section 6.3 formula (`compatible` + `configured`). It returns `{ candidates, total }`: the top N controls, each with `score`, `relevance` (strong/good/weak), per-class fit (`classes`), `totalCountermeasures` and `assignedElementIds`. `total` counts the returned candidates.

### Quality score computation

The `computeQuality` method (`validate-model.tool.ts`) reads all attribute files via `readAttributes()` and the model structure files. Both data sources needed for the two-tier `control_coverage_rate` computation are loaded there — no additional I/O required. It computes the rate from them, in place of the former hardcoded `controlCoverageRate = 0`.

### Plugin configuration

No changes needed to:
- Plugin manifest (`.claude-plugin/plugin.json`, generated) — new backend tools are additional actions on existing tools or new tools registered in the MCP server
- Hook definitions (`bundles/claude/hooks/hooks.json`, generated) — the post-write hook does not inspect file contents
- Plugin user configuration (`userConfig`) — no new configuration surfaces

---

## 12. Known Gaps and Risks

### 12.1 SUPPORTS edge idempotency on re-sync — Resolved

Name-only control references (`{ id: null, name: "WAF" }`) were once matched case-insensitively and then by partial name, so "WAF" could link "WAF Protection" or "Cloud WAF Gateway", and repeated syncs could flip between them. The push now links a name-only reference only to a Control with exactly the same name, and refuses the whole push when none or several match (see [SYNC_AND_SOURCE_OF_TRUTH.md §12](SYNC_AND_SOURCE_OF_TRUTH.md#push-flow)). After a push, the server writes each name-only reference back into the model files with the id the push linked, so later pushes link by id (a greenfield temporary id is not linked by the model push at all: the control-library push creates that Control and rewrites the id, see [CONTROL_LIBRARY.md §7](CONTROL_LIBRARY.md#push--greenfield-controls-idempotent)); with the settlement on, the registration of that controls list follows it, with nothing for the operator to confirm (see [SYNC_AND_SOURCE_OF_TRUTH.md §12](SYNC_AND_SOURCE_OF_TRUTH.md#push-flow)).

dt-core's default `'lenient'` resolution, which Dethereal does not use, no longer matches partial names either: it attaches by id, by exact name, or by a name a single control matches when case and surrounding spaces are ignored, and reports a reference that matches none or several in `unresolvedControls` instead of attaching one (see [Control Resolution](../dt-core/IMPORT_EXPORT.md#control-resolution)).

### 12.2 Control deletion between syncs — Resolved

A reference whose Control was deleted on the platform was once skipped with a warning, leaving the stale reference in local JSON. The push now refuses with `control_id_not_found` and pushes nothing until the operator links another Control, creates one, or removes the entry (see [SYNC_AND_SOURCE_OF_TRUTH.md §12](SYNC_AND_SOURCE_OF_TRUTH.md#push-flow)).

### 12.3 Import pipeline `dataItems` side effect

The import pipeline's `associateControlsDirectly` (in `dt-import.ts`) sets `dataItems: []` when associating controls. This is safe during initial import (data items are associated in a later pass) but would be destructive if naively copied to the update pipeline, which operates on elements with existing data item relationships.

**Mitigation:** The update pipeline must use the update mutation's disconnect/connect semantics, operating on `controls` independently of `dataItems`. The `dt-component.ts` mutation supports this — it only touches controls when `data.controls` is explicitly set. If `data.controls` is `undefined`, it skips the operation. The update pipeline does this; see [Control writes in the update pipeline](#control-writes-in-the-update-pipeline).

### 12.4 No batch assignment API — Resolved

Resolved by the `assign` action on `manage_controls`. It accepts `control_id` + an `element_ids[]` array and calls `assignControlToElements`, which creates the SUPPORTS edges. The method reads the control's currently-attached elements first and connects only the missing ones — a repeat call on an already-attached set issues no mutation at all, and a partially overlapping call connects just the difference. This is **not** MERGE semantics: GraphQL `connect` compiles to a bare relationship CREATE, and no engine-level constraint prevents parallel edges, so the read is what makes repeat calls safe. Idempotent across sequential calls; two concurrent callers that both read "not attached" will both connect.

### 12.5 Category 1 auto-inference boundary — Resolved

The quality score derives `control_coverage_rate` from enrichment attributes, using the positive attribute mapping table defined in [Section 10](#quality-score-from-attributes).

### 12.6 Zero-boundary models

A model with no boundaries (flat architecture) produces zero Step 1 (enforcement) prompts. Enforcement controls are silently skipped entirely. The quality score does not flag the gap.

**Mitigation:** When the boundary count is zero, collapse Step 1 (enforcement) into a single global prompt: "What enforcement controls protect this system? (Firewalls, WAFs, IDS/IPS, network access controls, or "none")". Assign declared controls to the model root or to individual components.

### 12.7 Re-running enrichment

The document says "re-running enrich is additive" for state transitions but does not specify control behavior on re-run. If the user enriches, declares a WAF, then re-runs enrichment — does Step 1 (enforcement) show the previously declared WAF? Does it re-ask for boundaries that already have controls?

**Mitigation:** On re-run, the agent reads the existing `controls[]` from local JSON, and the `enrich-controls` skill hands it only the boundaries still without enforcement controls; a boundary or component that already has controls is skipped unless the operator asks to change it. Then its controls are shown first as "currently assigned", and the skill asks whether to add more or modify. New control references are additive — an existing one is never removed silently, only when the operator asks. See Section 8, "Re-run behavior".

### 12.8 Large models (20+ boundaries)

At B=20, Step 1 alone produces 20 prompts (60 turns brownfield). Combined with user fatigue from main enrichment, this creates a prompt fatigue cliff where users answer "none" to skip — degrading control coverage without a conscious decision.

**Mitigation (part of the control pass, not deferred):** For models with B > 6 boundaries without enforcement controls, the `enrich-controls` skill first asks a staged question: "N boundaries have no enforcement controls. Review: (1) crown-jewel boundaries only, (2) all boundaries, (3) skip." Crown-jewel boundaries are those containing a component with `crownJewel: true` in `structure.json`; after them, the skill offers to continue with the rest. This follows the crown-jewels-first enrichment priority (D43). The component tiers and the enrichment worklist are defined by no agent: the server computes them and reports them with every Gate 3 result (`validate_model_json` `action: 'gates'`), and enrichment takes its worklist snapshot from that report (see [Component Tiers](../../user/dethereal/DISCOVERY_AND_ENRICHMENT.md#component-tiers)). Crown-jewel boundaries first reduces the effective B to 3-4 while preserving coverage for the highest-value elements.

### 12.9 Compensating controls

Compensating controls — temporary mitigations that exist because a primary control cannot be implemented (e.g., enhanced monitoring when patching is delayed) — do not have a clear home in the four-category taxonomy. They straddle Categories 2/3/4.

**Proposed mitigation (not implemented):** Handle compensating controls as regular Category 2 or 3 controls with a `source: "declared"` tag and an optional `compensating` field in the local JSON. `ControlReference` today is `{ id, name?, source? }`; nothing writes or reads a `compensating` field. The proposed shape:

```json
{
  "id": null,
  "name": "Enhanced Monitoring (compensating for delayed patching)",
  "source": "declared",
  "compensating": {
    "expires": "2026-06-30",
    "primary_control": "Automated Patch Management",
    "original_requirement": "PCI-DSS 6.3.3",
    "risk_acceptance": "<risk acceptance reference>"
  }
}
```

The `compensating` field would be local-only (no platform schema change) and would preserve the audit trail required by PCI-DSS v4.0 Appendix B (Compensating Controls Worksheet): expiration date, primary control being compensated for, the original requirement not being met, and risk acceptance reference. SOC2 CC6.1 has similar documentation requirements. Without it, compensating controls become permanent parts of the threat model. The field would be optional — non-compensating controls would omit it.

### 12.10 Post-analysis recommendation noise — Resolved

Addressed by the `get_control_gaps` backend tool (Section 11). The backend ranks recommendations by exposure coverage and returns `top_n` (default 3) candidates. The surface report lists the pre-ranked results, not an exhaustive mapping. The MITRE framework chain provides framework-grounded justifications rather than LLM-generated reasoning.

---

## Related Documents

- [THREAT_MODELING_WORKFLOW.md](THREAT_MODELING_WORKFLOW.md) — Section 6: Exposure and Control Mapping
- [SYNC_AND_SOURCE_OF_TRUTH.md](SYNC_AND_SOURCE_OF_TRUTH.md) — Publish/pull architecture and control-reference linking at push (§12)
- [PLUGIN_ARCHITECTURE.md](PLUGIN_ARCHITECTURE.md) — Section 10: Quality scoring and control coverage
- [OPERATIONAL_REQUIREMENTS.md](OPERATIONAL_REQUIREMENTS.md) — Section 5: Compliance-driven control checklists
- [BACKEND_DELEGATION.md](BACKEND_DELEGATION.md) — Backend delegation strategy (prerequisite — generalizes the backend tools proposed in Section 11)
- [DECISIONS.md](DECISIONS.md) — D28 (countermeasure schema scope), D31 (surface skill scope)
