# Threat Modeling Workflow Specification

> How the Dethereal plugin guides users through professional threat modeling.

## Table of Contents

- [1. Workflow Phases](#1-workflow-phases)
- [2. Conversational Threat Modeling](#2-conversational-threat-modeling)
- [3. Auto-Discovery](#3-auto-discovery)
- [4. Component Classification](#4-component-classification)
- [5. Data Flow Analysis](#5-data-flow-analysis)
- [6. Exposure and Control Mapping](#6-exposure-and-control-mapping)
- [7. MITRE Integration](#7-mitre-integration)
- [8. Model Quality and Completeness](#8-model-quality-and-completeness)
- [9. Multi-System and Incremental Modeling](#9-multi-system-and-incremental-modeling)
- [10. Minimum Viable Models](#10-minimum-viable-models)

---

## 1. Workflow Phases

### Phase Overview

```
Phase 1: Scope Definition
    |
Phase 2: Discovery & Inventory
    |
Phase 3: Component Classification
    |
Phase 4: Architecture Modeling (Boundaries + Components)
    |
Phase 5: Data Flow Mapping
    |
Phase 6: Data Item & Sensitivity Classification
    |
Phase 7: Enrichment & Parameterization (Attributes + Controls)
    |
    v
[Model Validation & Readiness Assessment]
```

### Methodology Framework

The plugin is methodology-agnostic. The underlying data model supports multiple methodologies as interpretive overlays:

**Built-in: STRIDE-per-element.** Default for all new threat models. The plugin walks each component, boundary crossing, and data flow, systematically evaluating spoofing, tampering, repudiation, information disclosure, denial of service, and elevation of privilege.

| STRIDE Category | Platform Mapping |
|----------------|-----------------|
| Spoofing | Exposure (query: credential use, token manipulation, identity spoofing) |
| Tampering | Exposure (query: data manipulation, supply chain compromise, stored data modification) |
| Repudiation | Exposure (query: indicator removal, log tampering, defense evasion) |
| Information Disclosure | Exposure + DataItem classification (query: data collection, credential access, network sniffing) |
| Denial of Service | Exposure (query: network DoS, endpoint DoS, resource hijacking) |
| Elevation of Privilege | Exposure (query: exploitation for privilege escalation, abuse elevation mechanisms, access token manipulation) |

> This table serves as reference context for user-initiated MITRE ATT&CK browsing. The plugin does not systematically evaluate STRIDE-to-ATT&CK mappings for every component during enrichment — that systematic mapping is performed by analysis modules. During enrichment, users can browse techniques on demand via `search_mitre_attack`.

> Specific ATT&CK technique IDs are intentionally omitted from this table. Any technique the plugin names is looked up with the platform's `search_mitre_attack` tool using these semantic descriptions, so every reference is verified against the platform's graph database; none is written to the model (see [MITRE Integration](#7-mitre-integration)).

**Query result handling:** When `search_mitre_attack` returns more than 10 results for a broad query, the agent refines by adding component context (component type, protocol, boundary position). Present the top 5 most relevant matches with one-line descriptions. State how many additional matches exist and offer to narrow the search. The agent must never select MITRE techniques without user confirmation.

**Guided: PASTA.** The DFD creation workflow supports PASTA stages 2 (Technical Scope Definition) and 4 (Threat Analysis). Full PASTA orchestration — including business impact analysis (stage 1), abuse case modeling (stage 3), vulnerability analysis (stage 5), and quantitative risk assessment (stage 7) — is a future capability requiring additional data structures and external integrations.

**Extensible: Attack trees and VAST.** Documented as possible but not built into the initial plugin.

### Methodology State Machine

```
States: INITIALIZED → SCOPE_DEFINED → DISCOVERED → STRUCTURE_COMPLETE
        → ENRICHING → REVIEWED

Transitions (every one through model_state action 'transition'):
- Forward: one step at a time. SCOPE_DEFINED → STRUCTURE_COMPLETE may skip DISCOVERED
  (a described model). From STRUCTURE_COMPLETE on, the model must hold components
  and data flows. Only REVIEWED is gated (see "Reaching REVIEWED" below).
- Backward: any state → any earlier state; always applies.
- Backward Transition Protocol: a structural change (add/remove) at ENRICHING or REVIEWED
  → STRUCTURE_COMPLETE, with the changed elements that still exist queued as stale
  (operator warned with an impact summary; enrichment on existing elements preserved)
- On any backward transition the server deletes `.dethereal/quality.json`, drops the
  recorded review (`reviewHash`, `reviewedAt`) and the quick-run progress (`quickThrough`),
  and keeps an armed loop back (D64)
```

The workflow drives the forward steps after each step's confirmations; the server decides only whether a transition is allowed. `model_signed_off` is a legacy key: `get` reports it as present but `honoured: false`, and it signs nothing off.

#### Reaching REVIEWED

REVIEWED is granted by the server, never claimed. A transition to REVIEWED is refused unless all of these hold, and the refusal names each failing one (`codes`, `failing_criteria`):

- the model is at ENRICHING (or already REVIEWED) and is not a [quick model](#quick-mode);
- the model files can be read and the review hash can be taken;
- Gate 2 and Gate 3 pass;
- no queued stale element still exists;
- no enrichment value awaits the operator's confirmation (`.dethereal/enrichment-pending.json`);
- every value in the model files is registered as the operator's (settlement).

The last two conditions apply only with the settlement switched on. The settlement is off by default and reserved: it is on only when `DETHEREAL_SETTLEMENT` is exactly `on`, and turning it on holds back REVIEWED and every push, because this version's workflow registers none of the values the operator confirms (only a pull registers what it pulled) — see [MCP_ARCHITECTURE.md → Settlement Switch](MCP_ARCHITECTURE.md#settlement-switch).

A granted review stores `reviewHash` (a hash of the content the gates passed) and `reviewedAt`. The state is read the same way afterwards: a state file that claims REVIEWED reads as ENRICHING wherever the state is shown (`model_state` `get`, `workspace_status`) once any of these conditions stops holding, and a review whose content changed since is reported as stale. With the settlement off, the workflow writes what the operator confirms into the model files with its edit tool and registers nothing. See [Workflow State Tools](MCP_ARCHITECTURE.md#workflow-state-tools-client-free) for the tools.

> D45: CLASSIFIED, DATA_ITEMS_MAPPED, and ENRICHED collapsed into a single ENRICHING state. Sub-progress within enrichment (classification rate, attribute completion, data item coverage) is tracked by the quality score formula (0-100), making discrete enrichment sub-states redundant for UX purposes. The quality score provides continuous progress visibility.

Users can leave and resume at any state. The state is kept in `<model-path>/.dethereal/state.json`, which only the server reads and writes (`model_state`):

```json
{
  "currentState": "ENRICHING",
  "completedStates": ["INITIALIZED", "SCOPE_DEFINED", "DISCOVERED", "STRUCTURE_COMPLETE"],
  "lastModified": "2026-03-25T14:30:00Z",
  "staleElements": []
}
```

`completedStates` holds milestones: ENRICHING is work in progress and joins the list only when the model moves on to REVIEWED. Other keys appear as the workflow uses them — `lastReconcileCommit` (the drift baseline), `mode` and `quickThrough` (a quick model), `reviewHash` and `reviewedAt` (a granted review), `waivers`, `revision`. Every write keeps the keys it does not change.

`staleElements` is the re-enrichment queue: element IDs that need enrichment attention before the model is trustworthy again. Populated by the Backward Transition Protocol (D29): when structural changes occur at ENRICHING or later, the state reverts to STRUCTURE_COMPLETE and the affected elements are queued. The enrichment skill prioritizes stale elements first and removes their IDs once enrichment is confirmed and written.

Two properties of the queue are easy to get wrong when writing a `state.json` handler:

- **It is not additions-only.** `/dethereal:remove` queues the elements it changed as a side effect — flows reconnected around a deleted component, child components relocated to a parent boundary — through the Backward Transition Protocol. Those elements were never added; their enrichment is stale because their context changed. An entry that does not correspond to a recent addition is not corruption. A removed element cannot be queued: its id comes back as `rejected_ids`, and `get` reports only the queued ids that still resolve to an element (`stale_unresolved` counts the rest).
- **The MCP server re-keys it.** Element IDs change on disk whenever a push mints platform IDs for locally created elements, and no workflow step runs at that moment. The server rewrites `staleElements[]` onto the new IDs — on the `update_model` re-export path as well as the first create/import push — preserving every other key in the file. `.dethereal/template-fields/<element-id>.json` is renamed in the same operation ([TEMPLATE_STUB_GENERATION.md §Template Field Manifest](TEMPLATE_STUB_GENERATION.md#template-field-manifest)). IDs with no mapping are left alone. Without this, the queue holds pre-push IDs that resolve to no element and the next enrichment pass silently drops exactly the elements that were flagged as needing attention.

> No step rewrites `state.json` wholesale. A pull reconciles the state through `model_state` `action: 'merge_pulled'`: a model with no state gets one inferred from the pulled content; otherwise the claimed state stays, the queue is kept, and the result notes when the pulled content supports a later or earlier state.

#### Resume and phase re-entry

On a resume, `/dethereal:threat-model` reads the state with `model_state` `get` and works in this order before it asks where to continue:

1. A model at REVIEWED whose review is not stale is complete: the run says so and stops.
2. **Drift**, only when `get` shows a drift baseline (see [DRIFT_DETECTION.md](DRIFT_DETECTION.md)).
3. **Crown jewels**, at ENRICHING or later, when Gate 3's C6 fails: the mapping is confirmed again.
4. **The cursor**, the first step not done: Steps 1–5 by the state they end in, Step 6 when Gate 3's C1 passes, Step 7 when a quick run passed it; an open loop back puts the cursor at Step 9. The progress table is shown, then `resume-cursor` (continue / a step number).

A run re-enters a phase with `--phase <phase> <model-path>`: at the start, on each move into the next phase, on a jump, on a loop back, on a backward transition to Step 4, and after any context compaction. Re-entry reads the state and the files again and takes up the step they show; it runs no drift check and asks no progress question. The user-facing view is in [Resuming an Existing Model](../../user/dethereal/GUIDED_WORKFLOW.md#resuming-an-existing-model).

### Phase-to-Step Mapping

The 7 methodology phases above describe the analytical framework. The guided workflow skill (`/dethereal:threat-model`) adds user confirmation and sync steps, producing 11 UX-level steps. The state machine tracks 6 maturity states. **This table is the canonical step label reference** — PLUGIN_ARCHITECTURE.md and USER_EXPERIENCE.md must use these exact labels.

| Methodology Phase | Guided Workflow Step | State Machine State |
|---|---|---|
| Phase 1: Scope Definition | 1. Scope Definition | SCOPE_DEFINED |
| Phase 2: Discovery & Inventory | 2. Discovery | DISCOVERED |
| Phase 3: Component Classification (Pass 1, class confirmation) | 3. Model Review | — (stays DISCOVERED) |
| Phase 4: Architecture Modeling | 4. Boundary Refinement | STRUCTURE_COMPLETE |
| Phase 5: Data Flow Mapping | 5. Data Flow Mapping | ENRICHING |
| Phase 3: Component Classification (Pass 2) | 6. Classification | ENRICHING |
| Phase 6: Data Item Classification | 7. Data Item Classification | ENRICHING |
| Phase 7: Enrichment | 8. Enrichment | ENRICHING |
| Model Validation | 9. Validation | REVIEWED, when the server grants it |
| — (UX action) | 10. Sync | — |
| — (UX action) | 11. Post-sync linking | — |

> Note: The discovered components are confirmed in Step 2 (`discovery-confirm`, then the `blind-spots` question). Step 3 is class confirmation: deterministic classification (`match_classes`) runs there and fills the Model Review table (`model-review-confirm`). The context-dependent classification of what is left (Phase 3, Pass 2) runs at Step 6, after boundary placement (Phase 4/Step 4), because ambiguous cases benefit from seeing the component in its boundary context. The methodology phases define the logical dependencies; the guided workflow optimizes for user experience. Steps 5-8 all operate within the ENRICHING state — sub-progress is tracked by the quality score.
>
> Step 11 (post-sync linking) only applies when the model has countermeasures. After sync, platform-computed exposures are read back and linked to countermeasures in a batch table. Without linking, the platform's defense coverage analysis will not credit existing controls.

### Quick Mode

A new model, whether this workflow starts it or `/dethereal:create` makes it (describe, template or import), is a quick model unless that run has `--full` (`/dethereal:threat-model --quick` asks for the default explicitly; a `--phase` re-entry keeps the starting run's choice); either marks it in its first transition, the move to SCOPE_DEFINED (`model_state` `transition` with `mode: 'quick'`), and only an explicit `--quick` on an existing model marks it at entry (`action: 'mode'`, `mode: 'quick'`). A model pulled from the platform carries no mark, so it is a full model. A quick run builds the same model structure but trims the two most expensive phases, for a first pass that is deepened later:

| Steps | In a quick run |
|---|---|
| 1–7 | Run in full. Step 6 calls `validate_model_json` `action: 'quality'`, and when `attribute_residual.unclassified_open` = 0 (only elements left unclassified at Step 3 remain) and `.dethereal/discovery.json` lists no `dropped_classes` entry from a module still inactive (Step 3 records there each IaC class it dropped, as the element id, the class name and the module id, whatever the operator answers) it runs no second classification pass — no delegation, and neither `classification-confirm` nor the module question is asked; the assistant proposes the crown-jewel mapping itself, and the operator still confirms it; Step 7 records `quick_through: 7` |
| 8 | Enriches the priority set only, with no scope question; records `quick_through: 8`; the control pass is deferred to `/dethereal:enrich --focus controls` |
| 9 | Read-only: the quality score, the reviewer's red flags and its Top Findings (at most five ranked attack chains), each relayed verbatim; after the README, the publish phase shows the Top Findings again, or points to Step 9's review when they are no longer in the conversation. No gates verdict, loop back, waiver or `review-record` |
| 10–11 | As in a full run: a quick model can be pushed |

A quick model is never REVIEWED: the server refuses the transition (`quick_mode`), and a state file that claims REVIEWED on a quick model reads as ENRICHING. Its displayed state carries the mark (`ENRICHING (quick)`). The push consent, the generated README (its first line is a "Quick model, not reviewed" banner) and the final footer all say it is quick and that it can be deepened. A model already REVIEWED refuses the mark, so a quick run never downgrades a review. A backward transition clears `quickThrough` and keeps the mark.

**Deepening.** On an existing model, a run without a mode flag keeps the mode `get` shows and resumes, so a paused quick run stays quick; `--full` on a full model just resumes it. A run with `--full` on a quick model clears the mark (`mode: 'full'`). After `resume-cursor`, when the step taken up — the cursor, or the step the operator jumps to — is Step 7 or later, it enters the classify phase and runs Step 6 items 1–5 and 7 (the unclassified list, the classification pass, which a quick run may have skipped, and its writes, then the classification gate with its gap question), then enters that step's phase. The cursor is Step 8 with the full scope once `quickThrough` is set, since Steps 1–7 then count as done, and the full Step 8 clears it before the control-pass offer. When the step taken up is Step 6 or earlier, that Step 6 runs the pass, now in full mode, so there is no extra pass. Step 9 then runs with Gate 3. The operator-facing description is [Quick Mode](../../user/dethereal/GUIDED_WORKFLOW.md#quick-mode).

---

### Phase 1: Scope Definition

**Outputs:** Scope document with system name, description, modeling depth, compliance context, inclusions/exclusions, and crown jewels.

**User decisions:**
- What system is being modeled?
- What is the modeling intent? (initial, security review, compliance, incident response)
- What depth? (architecture-level, design-level, implementation-level)
- Regulatory drivers? Supported by depth level (D52) — not to be confused with the [component tiers](../../user/dethereal/DISCOVERY_AND_ENRICHMENT.md#component-tiers): full attribute questions: SOC2, ISO 27001; data classification questions only: PCI-DSS, HIPAA, GDPR; declared only, no framework-specific questions: NIST CSF, NIS2, DORA.
- What is explicitly out of scope?
- What do you explicitly trust and choose not to model? (D49: trust assumptions — distinct from exclusions)
- Adversary classes? (optional; asked for every intent, because the enrichment questions depend on them)
  - `external` -- internet-based attackers
  - `insider` -- employees, contractors with internal access (triggers admin path and credential flow prompts)
  - `supply_chain` -- vendor/dependency compromise (triggers CI/CD and dependency chain prompts)

The compliance-driver vocabulary above (the D52 depth levels) is the **single source of truth** and is mirrored in code by the `RECOMMENDED_COMPLIANCE_DRIVERS` constant in dt-core (`packages/dt-core/src/schemas/asset-context-map.ts`), whose `tier` field holds the depth level (1 full, 2 data classification, 3 declared only), and which feeds the GUI's compliance-driver suggestions in the model dialog. `complianceDrivers` is free-text and extensible, but this doc remains the source of truth for the recommended set; the constant is its code mirror, and **the two must be kept in sync** — adding or renaming a driver here requires the same change there (and vice versa).

**Scope template** (`<model-path>/.dethereal/scope.json`):

```typescript
interface ScopeDefinition {
  system_name: string
  description: string
  depth: 'architecture' | 'design' | 'implementation'
  modeling_intent: 'initial' | 'security_review' | 'compliance' | 'incident_response'
  compliance_drivers: string[]       // e.g., ["PCI-DSS", "SOC2", "ISO 27001"]
  crown_jewels: string[]             // free-text, at least one; mapped to elements at Step 6
  exclusions: string[]
  trust_assumptions: string[]        // D49: e.g., ["AWS control plane is trusted", "Physical security is out of scope"]
  adversary_classes?: string[]       // D20: asked for every intent; external, insider, supply_chain, or others
  crown_jewel_elements?: Record<string, string[]>  // written at Step 6: each crown_jewels entry, verbatim → its element ids
  activeModules?: Array<{ id: string; name: string }>  // written at Step 2 (module selection)
}
```

**Interview:** One free-text `scope` question collects what the operator has not already said — name and description, crown jewels, trust assumptions, adversary classes, exclusions, compliance drivers, and depth and intent when they differ from the defaults. The model is then scaffolded on disk and moves to SCOPE_DEFINED; there is no separate confirmation.

**Required:** `system_name`, `description`, and at least one `crown_jewels` entry. Nothing checks for an entry point. Gate 3's C6 later requires every crown jewel to be mapped to existing elements through `crown_jewel_elements`, at least one of them a non-external component.

---

### Phase 2: Discovery & Inventory

**Outputs:** Raw inventory list with component name, type, discovery source, and confidence level.

**Discovery sources analyzed:**
1. Code structure (package.json, go.mod, monorepo configs)
2. Infrastructure-as-Code (Terraform, CloudFormation, Pulumi, CDK)
3. Container orchestration (Docker, Kubernetes, Helm)
4. API definitions (OpenAPI, GraphQL schemas, gRPC .proto)
5. Network configuration (Nginx, HAProxy, service mesh, firewall)
6. CI/CD pipelines (GitHub Actions, GitLab CI)
7. Database schemas (SQL migrations, ORM models, Prisma)
8. Environment files (.env.example, config maps)
9. Architecture diagrams (screenshots and other images, read as images where the harness and model can read them)
10. Documentation (README, ADRs)

**Sources-checked summary (D65):** Before presenting results, show which source categories were checked and what was found or skipped. This makes omissions visible without requiring a formal error contract:

```
Sources checked: IaC/Terraform (12), Containers (3), K8s (—), CI/CD (2), Code (5), API defs (1)
```

A `(—)` indicates the source was checked but no matching files were found. If a source fails to parse (e.g., invalid HCL syntax), show: `IaC/Terraform (⚠ parse error in main.tf — 0 resources)`. The agent can explain failures in conversation.

**Confirmation model:** Present all discovered components in a single batch table, then ask `discovery-confirm`: "I found N components, M boundaries, and K data flows. Are any components missing? Should any be removed? Are the suggested types and classes correct?" One round-trip, not N individual confirmations. Until the operator confirms, the proposal lives only in `.dethereal/discovery.json`; nothing is written to the model files.

**Post-discovery interview:** After batch confirmation, the plugin consolidates blind spot coverage into a single `blind-spots` question rather than sequential questions. The confirmed elements are listed, not re-asked, and the question names six categories code analysis systematically misses:

1. **Shared infrastructure** — identity provider, DNS, certificate authority, log aggregator, SIEM, secret manager
2. **Side-channel data flows** — logging pipelines, metrics, DNS resolution, backup and replication, health checks
3. **Deployment pipeline** — CI/CD platform, container registries, artifact stores, deployment agents
4. **Third-party SaaS** — OAuth providers, payment processors, CDN, email and SMS services, webhook consumers
5. **Human actors with privileged access** — system and database admins, on-call engineers, third-party support (pre-filled from the remote-access entry points the source shows)
6. **Shared credentials** — service accounts, API keys or database credentials reused across components (pre-filled from secret files referenced by several services, never opened)

Elements the operator names join the proposal as manual entries; shared-credential answers are recorded as `shared_credentials` in `discovery.json` for the credential step. One question replaces a series of sequential turns. See OPERATIONAL_REQUIREMENTS.md Section 1 for the full blind spots taxonomy.

---

### Phase 3: Component Classification

**Process:**
1. Take the active modules (`activeModules`, chosen at Step 2)
2. Match discovered elements to their classes by name, description, and type (`match_classes`, with `get_classes` as the fallback)
3. Present proposed classifications as a batch table
4. For unmatched components: use closest available class and document the gap

**When no class exists:** The plugin logs a recommendation that a custom module class be created. It never fabricates class IDs. Components without classes appear in the model but will not generate exposure detections (OPA/Rego policies evaluate against class-specific attributes).

**Quality gate:** The classification gate is Gate 3's C1 — every non-external component classified — read from `validate_model_json` `action: 'gates'`, never counted by the workflow. Step 6 is done only when C1 passes; until then a `classification-gap` question lists the unclassified elements, STOREs first, with any module that would classify them (classify / skip). Unclassified data flows and boundaries are listed too, as advisory.

**Crown jewel mapping (D21, D41):** Crown jewel operationalization is split across two phases:
- **Phase 3 (Step 6, Classification):** The mapping is proposed — each crown jewel to the elements that hold it, starting from components already marked `crownJewel: true`, then matching names — and confirmed by the operator (`crown-jewel-confirm`), one row per crown jewel, an unmatched one included. Only confirmed rows are written: `crownJewel: true` on each mapped component in `structure.json`, and the scope's `crown_jewel_elements` map. Step 7 maps again any jewel still unmapped that a newly classified element matches; a resume confirms the mapping again when C6 fails.
- **Phase 7 (Enrichment):** `asset_criticality: high|medium|low` is proposed as a pre-filled row for each crown-jewel component (e.g. "'payment-db' is a crown jewel — proposed asset_criticality: high") and written only after the operator answers that row.

The `crownJewel` boolean (a first-class `structure.json` field) and the `asset_criticality` attribute are component-level properties. The platform's analysis computes crown-jewel results from these inputs — the plugin provides raw signals, not the computation.

---

### Phase 4: Architecture Modeling

**Trust boundary placement heuristics:**
1. Network boundary crossing (different segments, VPCs, subnets)
2. Authentication boundary (unauthenticated to authenticated)
3. Privilege boundary (different authorization levels)
4. Organizational boundary (different teams, vendors, organizations)
5. Deployment boundary (different cloud accounts, containers, pods)
6. Data classification boundary (different sensitivity levels)

**Boundary enforcement (early enrichment exception):** Step 4 shows an **Enforcement posture** table beside the trust classification, under the same `boundary-trust` question (accept all / adjust): per boundary, `implicit_deny_enabled` (blocks traffic by default; `true`/`false`), `allow_any_inbound` (allows unrestricted inbound; `true`/`false`) and `egress_filtering` (`deny_all`, `allow_list` or `allow_all`) (D50). Each value is proposed with its source; one no source shows stays blank, and "not sure" leaves it `null` — never `"unknown"`. Only accepted rows are written. This is captured during architecture modeling (not deferred to enrichment) because boundary enforcement and egress filtering affect data flow analysis prioritization in Phase 5 and data exfiltration path analysis.

**Trust skeleton (zone + plane).** Beyond enforcement, Phase 4 ratifies each *leaf* boundary's **trust zone** (`UNTRUSTED`/`PUBLIC`/`EXPOSED`/`INTERNAL`/`RESTRICTED`/`VENDOR`; `null` = inherit) and **operational plane** (`WORKLOAD`/`MANAGEMENT`) in one batched gate, computed by `validate_model_json(action: 'zoning', assets: 'skeleton')` (`RESTRICTED` is deferred to the close of Step 7, Data Item Classification). A boundary that only *nests other boundaries* is a **structural container** — it has no single well-defined zone and abstains (rendered `— structural`, not proposed a zone). Identity / compute-node / location / business-function grouping belongs in `domains`/`planes` **tags**, not zone-bearing boundaries. Conduits (approved channels) are ratified in Phase 5 (Step 5); the `RESTRICTED` promotion lands at the close of Step 7 (`restricted-promotion`), and the advisory zoning-coherence findings at Step 9. Full mechanics: [TRUST_ZONING.md](TRUST_ZONING.md).

**Key constraint from the platform:** "DO NOT flatten the model. Boundaries represent trust zones and should reflect the actual architecture." Flat models cannot detect trust boundary violations.

**Layout rules:**
- Left-to-right flow (external entities on left, data stores on right)
- Boundaries sized to contain children with 50px padding minimum
- Components are 150x150 pixels (fixed)
- No overlapping components within a boundary
- External entities must be in a separate boundary from internal systems

---

### Phase 5: Data Flow Mapping

**Identification methods:**
1. Static code analysis (HTTP clients, database drivers, queue producers/consumers)
2. API specification parsing (OpenAPI paths, GraphQL operations)
3. Infrastructure configuration (load balancer upstreams, service mesh routes)
4. Manual prompting for operational flows (monitoring, backup, admin access, DNS)

**Data flow attributes:**

| Attribute | Security Relevance | Discovery Source |
|-----------|-------------------|-----------------|
| Protocol | Determines encryption/interception risk | Code, configs |
| Encryption (TLS/mTLS/none) | Direct exposure indicator | Configs |
| Authentication method | Access control assessment | Code, API specs |
| Data classification | Impact assessment | Manual + heuristic |
| Direction | Attack path analysis | Code, API specs |
| Credential type | Lateral movement vector | Manual (enrichment) |
| Credential name | Credential blast radius | Manual (enrichment) |
| Credential scope | What else this credential accesses | Manual (enrichment) |
| Auth failure mode | Fail-open vs deny behavior | Manual (enrichment) |

**Auth failure mode:** `auth_failure_mode: "deny" | "fallback" | "fail_open"`, asked for each authenticated cross-boundary flow as a column of the credential table: "When authentication fails on this flow, does the system deny access, fall back to weaker authentication, or fail open?" "Not sure" leaves it `null`; there is no `"unknown"` value.

> **Known gap (D48; the fix is D63):** `auth_failure_mode` is captured by the plugin for enrichment and human review, but the platform's analysis does not currently incorporate it into risk scoring. A flow with `authType: "OAuth2"` and `auth_failure_mode: "fail_open"` receives full authentication credit, although its effective authentication strength on failure is zero. Until the analysis accounts for this attribute, its results for `fail_open` and `fallback` flows may look more secure than the system is, so reviewers should treat those flows as high-priority regardless of the computed score. The intended handling: `fail_open` counts as no authentication regardless of `authType`; `fallback` counts as weakened authentication; a `null` (unanswered) mode is flagged for user clarification.

**Credential attributes (D22):** For cross-boundary flows, the enrichment phase captures credential topology as data flow attributes:
- `required_credentials: string[]` (the credential ids the flow carries to authenticate, at this hop or a later hop it is forwarded to)
- `credential_type: "service_account" | "api_key" | "oauth_token" | "ssh_key" | "certificate" | "password" | "none"`
- `credential_name: string` (label, e.g., "db-service-account")

For STORE components identified as credential repositories, capture `stores_credentials: boolean` and `credential_scope: string[]` (the credential ids an attacker acquires by compromising the store). `credential_scope` is never a flow attribute.

Credential ids come from the cited secret or variable **name** (a Kubernetes Secret name, `DATABASE_URL`), never from a value, and stay identical on every flow and store that names them — that is how shared credentials across flows are detected.

Without these attributes, the platform's lateral movement analysis cannot gate traversal on credentials — all paths appear equally traversable. Credential attributes are the single highest-impact enrichment for analysis quality.

**Integration mapping (D62):** The plugin writes attributes using the engine's property names directly — there is no intermediate translation layer at import time. The attribute key in the JSON file must match the engine's expected property name exactly.

| Attribute Key Written by Plugin | Value | Written On | Use in Analysis |
|---|---|---|---|
| `required_credentials` | `[credential_name_value]` (array of credential identifier strings) | Data flow edges | Credential gating for lateral movement across the flow |
| `credential_scope` | `[credential_id, ...]` (array of credential identifiers yielded on compromise) | STORE nodes | Credentials an attacker acquires by compromising the store |
| `credential_type` | `"service_account"` \| `"api_key"` \| ... | Data flow edges | (not used in analysis — human review only) |
| `credential_name` | `"db-service-account"` (human-readable label) | Data flow edges | (not used in analysis — human review only) |

> **Critical (D62):** The plugin must write `required_credentials` (not `credential_name`) as the attribute key on data flow edges. The platform's analysis takes credential gating from `required_credentials` only. If the plugin writes `credential_name` instead, credential gating never fires and every lateral-movement path appears equally traversable. `credential_name` is a human-readable label stored alongside for display purposes only.

> **Semantic distinction for `credential_scope`:** On data flows, `credential_scope` is not used — flows carry `required_credentials` (what you need to traverse). On STORE nodes, `credential_scope` is a list of credential *identifiers* that an attacker acquires upon compromising that store. These identifiers must match the `required_credentials` values on flows. Example: if `payment-db` STORE has `credential_scope: ["db-admin-account"]` and a flow has `required_credentials: ["db-admin-account"]`, compromising the store enables traversal of that flow.

**Batch credential enrichment:** Credential capture is anchored to the flows, because a cold "list all your credentials" reliably misses the shared service accounts that are the lateral-movement story. One **Credentials** table lists the cross-boundary flows, the flows recorded as `privilege_transitions` at Step 5, and the flows carrying a credential data item: for each, which credential authenticates it, what else that credential reaches, and its auth failure mode. Rows are pre-filled from the source and from the `shared_credentials` the operator named at discovery. A sweep then asks for credentials no flow surfaced (service accounts, API keys, certificates, break-glass accounts, CI deploy keys). The **Credential mapping** table pivots the answers by credential (type, flows, stores that yield it, shared) before any credential key is written. In the guided workflow both tables are part of Step 8's one relay turn (see [The Step 8 relay](#the-step-8-relay)).

**Handle selection:** STORE components support only left/right handles. Other components support all four. The plugin must prevent handle conflicts on bidirectional flows (different handle pairs for each direction).

**Quality gate:** Every component should have at least one data flow. External entities should have flows crossing at least one boundary.

---

### Phase 6: Data Item & Sensitivity Classification

**Data item sources:**
- API specs: request/response bodies, auth headers
- Database schemas: table structures, PII columns
- Code: JWT payloads, session data, cached values
- Regulatory requirements: HIPAA -> PHI flows, PCI-DSS -> cardholder data

**Assignment:** A data item is a *type* of data, modelled once and linked via `dataItemIds` to **every element that handles it across its lifecycle** — its origin (the `EXTERNAL_ENTITY` or `PROCESS` where it enters/leaves), the `DATA_FLOW`s that carry it in transit, the `PROCESS` components that use it, the `STORE` components that persist it at rest, and the `SECURITY_BOUNDARY`s that contain it. `dataItemIds` is valid on components (all types), data flows, and boundaries.

**One table (Step 7).** The proposed items are classified (`match_classes` with `classLabel: 'DATA'`, then the active modules' DATA classes listed with `get_classes`) and checked for lifecycle gaps before anything is shown. The operator then confirms one table, `data-items-confirm` (accept all / adjust): one row per data item with its sensitivity, regulatory flags, every handling element grouped by role, its DATA class (or `none suitable (N listed)`), and an origin and a credential column. Only the confirmed rows are written.

#### Canonical sensitivity and regulatory-flag vocabulary

This subsection is the **single source of truth** for the data-sensitivity scale and the recommended regulatory-flag set. Other docs, the `/dethereal:enrich` skill, and the `dataInRegulatoryScope` resolver reference it rather than restating the list, so the vocabulary cannot fork.

The recommended regulatory-flag table below is also mirrored in code by the `RECOMMENDED_REGULATORY_FLAGS` constant in dt-core (`packages/dt-core/src/schemas/asset-context-map.ts`), which feeds the GUI's regulatory-flag suggestions. This doc remains the source of truth for the vocabulary; the constant is its code mirror, and **the two must be kept in sync** — adding or renaming a flag here requires the same change there (and vice versa).

**Sensitivity** — data items use the platform's four-level scale, lowest to highest: `public`, `internal`, `confidential`, `restricted`.

**Regulatory flags** are captured separately from sensitivity, as free-text labels on the data item (an item may carry several at once). The platform does not enumerate them — the set is extensible — but `dataInRegulatoryScope(flag)` matches **exactly and case-sensitively**, so producers must emit the canonical casing below or a query will silently miss the data. Recommended canonical set (case as written):

| Flag | Framework | Sensitivity floor |
|------|-----------|-------------------|
| `PCI cardholder` | PCI-DSS | `restricted` |
| `PHI` | HIPAA | `restricted` |
| `GDPR personal` | GDPR | `confidential` (special-category data is `restricted`) |
| `PII` | general | `confidential` |
| `SOX financial` | SOX | `confidential` |
| `CCPA personal` | CCPA | `confidential` |

A data item may carry multiple flags. Its sensitivity floor is the higher of two floors: the **maximum** of the floors of all flags it carries, and the floor its **DATA class** sets. The stock classes have fixed floors (User Credentials and Authentication Tokens → `restricted`; Customer & Personal Data → `confidential`); any other class sets one by a whole word in its catalog name: credentials, tokens, secrets, passwords, private, signing, encryption or API keys, sessions, cookies, JWTs, payments, cards, cardholders, health, medical or PHI → `restricted`; personal, customer or PII → `confidential`. For example, a patient billing record with `regulatory_flags: ["PHI", "PCI cardholder"]` is `restricted`, and so is an item bound to a "User Credentials" class whatever its flags. Gate 3's C7 holds every item at or above its floor; a floor a DATA class or a regulatory flag sets cannot be waived. Unknown/free-text flags outside this set are tolerated by the analysis layer but are not matched by the recommended-set tooling. The compliance-driven control checklist (OPERATIONAL_REQUIREMENTS.md Section 5) evaluates each flag independently.

#### Canonical data origin and credential vocabulary

This subsection is the **single source of truth** for the two other author-asserted fields of a data item: `origin` and `is_credential`. The dt-core schema, the platform's data dialog and the module interface reference it rather than restating the meanings.

Both are first-class fields of the data item in `data-items.json`, never attribute-file keys, and both are optional: **absent means unanswered**, never a guess. The workflow proposes them and writes only what the operator confirms in the data-item table (Step 7) or the enrichment questions. A push sends them with REPLACE semantics: an absent field clears the platform value.

**`origin`** — who can write the item's content. It is not the element where the data enters the system; that is the item's origin *element*, linked through `dataItemIds`. Seven tokens, most to least trusted:

| Token | Meaning | Trusted? |
|-------|---------|----------|
| `authenticated_first_party` | Written only by the operator's own authenticated users or systems | yes |
| `curated_internal` | Internal content that passed a review or curation step | yes |
| `agent_relayed` | Produced or forwarded by another agent (at most this trusted) | yes |
| `model_generated` | Written by a model and later read as input (at most this trusted) | yes |
| `third_party` | Written by a known external party under an agreement | **untrusted** |
| `arbitrary_public` | Anyone can write it: web pages, inbound email, public issues, public forms | **untrusted** |
| `not_assessed` | Answered as not established | **untrusted** |

- **Least-trusted rule.** An item's origin is the least-trusted origin of what it holds: one public source makes the whole item `arbitrary_public`.
- **`not_assessed` is an answer.** It records that the operator looked and could not establish the origin, and it counts as untrusted. An absent `origin` is no answer at all.
- **Ask only where the source of the content is known.** Otherwise the field stays absent.
- **Validation.** Any other value fails the validator's data-item schema (with the settlement on, registering it is also refused, `invalid_value`), and an `origin` or `is_credential` key inside a data item's attribute file draws a validator warning: it belongs on the item.
- **Code mirror.** The order and the untrusted set are dt-core's `ORIGIN_LEVELS` and `UNTRUSTED_ORIGINS` (`packages/dt-core/src/schemas/asset-context-map.ts`); the platform enum uses the same tokens in upper case. Keep the table above and the constants in sync.

**`is_credential`** — the item is a credential: a password, token, key, secret or certificate. A boolean:

- `true` marks the item as a credential. The data-item table proposes it in its credential column for every item bound to a credential-like DATA class (exact or near match), but never sets it from the class alone.
- `false` **is an answer**: it is kept, published as such, and never proposed again.
- Absent is unanswered. After the write, `validate_model_json` `action: 'quality'` lists every item bound to a credential-like class whose flag is still unanswered in `credential_hints` (`id`, `name`, `class`, `reason`); the workflow proposes the flag for those items at Step 8. The hint does not affect the quality score.

**Quality gate:** Gate 3's C4 — every sensitive flow carries a classified data item with a sensitivity. A flow counts as sensitive when one of its endpoints is a STORE or a crown-jewel component, when it carries a mapped crown-jewel data item, when it enters a `RESTRICTED` zone from outside it, or when it crosses between zones with one end in an exposed zone (`PUBLIC`, `EXPOSED`, `UNTRUSTED` or `VENDOR`). C4 fails outright while the model has no data items. Four lifecycle checks are **advisory**, not a gate: every crown-jewel store has classified data items; every data origin references its data item; every process that reads, transforms or caches a sensitive item references it; and the boundary containing a crown-jewel item references it. Their gaps are added to the Step 7 table as gap-fill rows.

---

## 2. Conversational Threat Modeling

### Interaction Modes

**Mode 1: Natural Language (default).** User describes what they want; plugin interprets, proposes, acts.

```
User: Add a Redis cache between the API and the database

Plugin: Adding Redis cache to your model...
  Added: "Redis Cache" (STORE) in Private VPC boundary
  Added data flows: API -> Redis Cache, Redis Cache -> Database
  Removed: direct API -> Database flow (replaced by cache-mediated path)
```

**Mode 2: Guided Workflow (via skills).** Structured step-by-step process for complex operations.

**Mode 3: Direct Tool Invocation.** Power users invoke specific MCP tools with exact parameters.

### Handling Ambiguity

The plugin follows a **biased-assumption** strategy:

1. State the assumption explicitly: "I'm assuming this Redis instance is used as a cache, not a primary data store. Correct?"
2. Read conservatively in what is proposed, flagged and ranked (unencrypted until proven encrypted, unauthenticated until proven authenticated). The conservative reading never writes a value: a written value needs evidence or the operator's answer, and absence of evidence is not an observation — the field stays `null` as a question
3. Never silently assume -- every assumption is stated, and a value neither the source nor the operator gave stays unresolved
4. Batch assumptions: present 3-5 at once for confirmation

### Never Auto-Classify Data Sensitivity

Data sensitivity classification is always a human decision. The plugin may suggest ("this looks like PII based on the field names") but never auto-classifies. Misclassified data leads to wrong threat mappings.

### Questions by Phase

**Scope:** What system? Who uses it? What is the most valuable data/capability? Regulatory requirements? Out-of-scope items?

**Discovery:** "Are any components missing from this list?" "External services not visible in code?" "Human actors to model?"

**Classification:** Batch presentation: "I've mapped components to these classes. Adjustments needed?"

**Boundaries:** "Do these trust zones match your deployment architecture?"

**Data Flows:** "Am I missing any connections?" "How does admin access work?" "Monitoring or logging flows?"

**Data Items:** "Are any data items misclassified?" "Sensitive data I haven't identified?"

**Enrichment:** "These attributes need your input." "Are these controls already in place?"

---

## 3. Auto-Discovery

### Discovery Pipeline

```
Code Analysis ─────┐
                    ├─> Raw Inventory -> Deduplication -> Type Inference -> Confidence Scoring -> User Review
IaC Analysis  ─────┤
                    │
API Spec Analysis ──┤
                    │
Config Analysis ────┘
```

### IaC Discovery Mappings

| Source Pattern | Component Type | Dethernety Class |
|---------------|---------------|-----------------|
| `aws_instance`, `aws_ecs_service` | PROCESS | Varies by workload |
| `aws_rds_instance`, `aws_dynamodb_table` | STORE | Database, Key-Value Store |
| `aws_lb`, `aws_cloudfront_distribution` | PROCESS | Load Balancer, CDN |
| `aws_vpc`, `aws_subnet` | Boundary | Network Zone |
| `aws_security_group` | Boundary + Control | Network Zone + Firewall |
| `aws_api_gateway_rest_api` | PROCESS | API Gateway |
| `aws_s3_bucket` | STORE | Object Storage |
| `aws_lambda_function` | PROCESS | Function |
| `aws_cognito_user_pool` | EXTERNAL_ENTITY | Identity Provider |
| `aws_kms_key`, `aws_secretsmanager_secret`, `aws_cloudwatch_log_group`, `aws_acm_certificate` | EXTERNAL_ENTITY | External Cloud Service |
| K8s Deployment/StatefulSet | PROCESS/STORE | Based on container image |
| K8s Namespace | Boundary | Namespace |
| K8s NetworkPolicy | Control | Network Policy |
| K8s Ingress | PROCESS + boundary crossing | API Gateway/Load Balancer |

### Application Code Discovery

| Source Pattern | Produces | Mapping |
|---------------|----------|---------|
| OpenAPI/Swagger specs | Components + flows | API endpoints as components |
| gRPC proto files | Data flows | DTDataFlowClass: gRPC |
| Auth middleware (JWT, OAuth) | Controls | DTControlClass: Authentication |
| Database connection strings | Flows + stores | STORE + connection flow |
| Message queue producers/consumers (Kafka, RabbitMQ, SQS) | Components + flows | Broker as PROCESS/STORE; producer/consumer edges as data flows |
| Service mesh configs | Controls + flows | mTLS, service routes |

### Architecture Diagram Discovery

The infrastructure scout reads screenshots and other images of architecture diagrams as images. Its instructions are the same on Claude Code, Codex and OpenCode; whether an image can be read depends on the harness and the model behind it:
- Extract components, connections, and zone boundaries from diagrams
- Map visual elements to Dethernety primitives
- These discoveries always have "low" confidence and require explicit confirmation

### Confidence Model

**Confidence Model:**

| Dimension | High | Medium | Low |
|-----------|------|--------|-----|
| Existence | Explicit declaration (K8s Service, Terraform resource, OpenAPI endpoint) | Strong inference (Docker image, import statement, env var with service URL) | Weak inference (string literal, comment, config reference) |
| Classification | Unambiguous type mapping (aws_rds_instance -> STORE/Database) | Probable type (Docker image name suggests purpose) | Ambiguous (custom module, generic service name) |

When two sources identify the same element:
1. Existence confidence = max of both sources
2. Classification confidence = max of both sources
3. Prefer the source with higher classification confidence for type/class assignment
4. Store all sources in provenance for auditability

### What Auto-Discovery Cannot Find

| Missing Element | Why | Plugin Response |
|----------------|-----|----------------|
| Network topology / segmentation | Not in application code | Prompt: "What are your network zones?" |
| Shared credentials / secret rotation | In vaults, not code | Prompt: "Which components share credentials?" |
| Load balancer / WAF config | Infrastructure layer | Prompt: "What sits in front of your services?" |
| Third-party SaaS admin config | Out-of-band | Prompt: "External services not in code?" |
| Backup and DR flows | Ops concern | Prompt: "How is data backed up?" |
| Runtime service mesh | Deployed config | Prompt: "Using service mesh?" |

The plugin must explicitly call out these known blind spots: "This model was built from code analysis. The following are NOT captured: [list]. Consider adding these manually."

### Discovery Output

Each discovered element includes provenance:

```typescript
interface DiscoveredElement {
  suggestedType: 'component' | 'boundary' | 'dataFlow' | 'dataItem' | 'control'
  suggestedName: string
  suggestedDescription: string
  suggestedComponentType?: 'PROCESS' | 'STORE' | 'EXTERNAL_ENTITY'  // DFD substrate when suggestedType === 'component'; drives reclassification on substrate flips
  suggestedClass?: { id: string; name: string }
  existenceConfidence: 'high' | 'medium' | 'low'
  classificationConfidence: 'high' | 'medium' | 'low'
  sources: Array<{
    type: 'terraform' | 'kubernetes' | 'dockerfile' | 'openapi' | 'code' | 'diagram' | 'manual'
    file: string
    line?: number
    resource?: string
  }>
  confirmed: boolean  // set true once the user accepts the element in batch confirmation
}
```

Persisted in `<model-path>/.dethereal/discovery.json` for review and incremental re-runs.

**Provenance Sanitization:** Discovery output must never include actual secret values from environment variables, connection strings, or config files. Record only variable names and file references:
- Good: "Discovered from environment variable `REDIS_URL` in `.env.example`"
- Bad: "Discovered from `REDIS_URL=redis://prod-cache.internal:6379`"

Commit `.dethereal/discovery.json` with the model files — drift detection reads it. The sanitization above keeps secret values out of it.

---

## 4. Component Classification

### Classification Flow

Classification uses a two-pass approach:

**Pass 1 — Deterministic (at Step 3, Model Review):**
1. Classify components, boundaries and data flows, each with its own `classLabel`: `match_classes` with `{ elements: [{ name, type, description }], classLabel, moduleIds: [activeModules] }` (all installed modules when `activeModules` is absent). The tool ranks candidates for each element through a fixed pipeline — exact name and vector similarity first; a fuzzy (containment) name match, then the classes of the given component type, only when neither finds one — and returns each with its match type (`exact_name`, `vector_similarity`, `fuzzy_name`, `type_match`) and confidence (D51). An `exact_name` match is accepted in the table; the others are listed for the operator to confirm. A specialised module's class is preferred to the baseline module's when both match.
2. The proposals fill the Model Review table (`model-review-confirm`: yes / modify / skip), so users see *"Redis Cache (STORE / Key-Value Store)"* rather than *"Redis Cache (STORE / unclassified)"*. The confirmed classes are written, and their attribute stubs generated. A class made for another element type (a PROCESS class on an `EXTERNAL_ENTITY`) is never kept: the best class of the element's own type is proposed in its place. an IaC-discovered element keeps its IaC pre-classification only when that class's module is in `activeModules`. The module is looked up with `get_classes` (`class_id`, `fields: ['module']`). Otherwise a class from the active modules is proposed, and the table's note names the dropped class and its module. At Step 6 the element goes on the other-module list, so the operator can add that module through the module question (item 5). A cloud provider's managed service consumed as a dependency (key management, a secret manager, managed log groups, a managed certificate service) that no active-module class fits as an internal component is proposed as an `EXTERNAL_ENTITY` with the baseline module's External Cloud Service class, the type and class change in one row, never left an unclassified internal store. It sits in the provider's external boundary (zoned `VENDOR` at Step 4), and a flow to it runs from the calling component, never from the service unless the service initiates the call. A store the system runs itself (Secrets inside its own cluster, a self-hosted vault) stays internal. Pass 2 applies the same rule to any such service still unclassified.

> **`componentType` is an optional filter the workflow does not pass.** It is a single top-level filter, not per-element, so a mixed batch cannot be type-constrained, and the guided workflow sends one call per class label with every component in it. It is the only type constraint the tool offers — the type-filtered stage reads this filter, and the per-element `type` field does not constrain the result — so nothing in the tool stops a STORE being offered a PROCESS class. The workflow instead rejects a cross-type class when it builds the table (above). A cross-type binding is a real defect rather than a cosmetic one, because the class's Rego policy is written for the type the class declares and would then evaluate against a thing it does not describe. `validate_model_json(action: 'validate')` warns on the mismatch after the fact, comparing the component's type against the `componentType` persisted in `.dethereal/class-cache/` — a warning, not an error, since the cache can be stale and only the platform is authoritative about the binding.

**Pass 2 — LLM-assisted (at Step 6, after boundary refinement):**
3. The unclassified elements — components, data flows, boundaries, data items — go to the `security-enricher` agent in classification mode, which uses their context (boundary position, connected flows, peer inference) to propose classes, the crown-jewel mapping and reclassification candidates. It writes nothing.
4. Present batch table of remaining unclassified + any user-adjusted items. User confirms or adjusts. The proposals come from the active modules only, and confirming the table never adds a module.
5. A class from a module not in `activeModules` is never a row of that table. This covers an IaC pre-classification, a match from searching all installed modules, and a reclassification candidate. It goes on a separate other-module list, which becomes one module question, `classify-add-module` (`add` / `skip`), asked once per run. Only `add` changes `activeModules`: the modules are written first, then the listed elements are classified again, and their new rows are confirmed separately, for those rows only. On `skip`, the elements keep their classes or stay unclassified, with the gap on record. Data item classes at Step 7 follow the same rule. See [Fallback Broadening](PLUGIN_ARCHITECTURE.md#fallback-broadening).

> D51: Batch classification via `match_classes` reduces tool calls from 15-100 (per-module `get_classes` loops) to 1-5 batch calls, saving significant token overhead. Running Pass 1 at Step 3 (instead of deferring everything to Step 6) additionally improves boundary refinement decisions because component classifications are visible during Step 4. If the `match_classes` call fails, Step 3 falls back to `get_classes` per module and per class type (paging until the listing is complete), and then to matching by name alone.

### Class Inventory (from dethernety-general)

| Class Type | Graph Label | Examples |
|-----------|-------------|----------|
| Component | `DTComponentClass` | Web Server, Database, API Gateway, Container, Function |
| Control | `DTControlClass` | Authentication, Encryption, Firewall, Logging |
| Data Flow | `DTDataFlowClass` | HTTPS, SQL Query, gRPC, WebSocket |
| Security Boundary | `DTSecurityBoundaryClass` | Trust Boundary, Network Zone, DMZ |
| Data | `DTDataClass` | PII, Credentials, Financial Data |
| Issue | `DTIssueClass` | Threat Vector (with STRIDE), Vulnerability, Config Error |

Each class carries:
- `template`: JSON Schema for class-specific attributes
- `configurationOptionsGuide`: Guidance for attribute configuration
- `regoPolicies`: OPA/Rego policies for exposure/countermeasure evaluation

### Handling Missing Classes

1. Use closest available class with a gap note in the component description
2. Log recommendation for custom module class creation
3. Never fabricate class IDs
4. Communicate the trade-off: "Component X has no matching class. It will appear in the model but won't generate security exposures until a class is assigned."

---

## 5. Data Flow Analysis

### Trust Boundary Crossing Detection

A data flow crosses a trust boundary when its two endpoints sit in different boundaries, or when exactly one endpoint is an external entity (so a flow between an external entity and a component in the same boundary crosses too). An endpoint that is a boundary sits in itself. The server computes this from the structure (see [Component Tiers](../../user/dethereal/DISCOVERY_AND_ENRICHMENT.md#component-tiers)):

```
Cross-boundary flows (3):
  End Users -> Web Frontend          one endpoint is an external entity
  Web Frontend -> Orders API         DMZ -> Application Tier
  Orders API -> Payment Provider     one endpoint is an external entity
```

Every cross-boundary flow is held by Gate 3's C3 (reviewed), and C5 needs at least one. The number of boundaries a flow crosses plays no part in the enrichment order. Enrichment works through a worklist taken from Gate 3: crown jewels and their mapped elements first, then the rest of the Gate 3 snapshot (the Tier 1–2 elements still missing values and the cross-boundary pivots), then the flows Gate 3's C3 lists as failing, then every other in-scope element; stale elements go to the top. See [Enrichment Order and the Priority Set](../../user/dethereal/DISCOVERY_AND_ENRICHMENT.md#enrichment-order-and-the-priority-set).

### Credential and Service Account Flows

The plugin explicitly asks about credential flows because they drive lateral movement analysis. The questions are anchored to the flows, in one table (see [Batch credential enrichment](#phase-5-data-flow-mapping)):

- "Which credential authenticates this flow?"
- "What else does that credential reach?"
- "On an authentication failure, does it deny, fall back or fail open?"

### Operational Flows Often Missed

Step 5 asks one `operational-flows` question about the flows code analysis misses:
- Administrative access paths (SSH, RDP, consoles)
- Monitoring and logging flows (to log aggregators, SIEM)
- Backup and recovery flows
- Privilege or auth transitions — a caller and callee at different authorization levels inside one zone

A confirmed privilege transition is proposed as a sub-boundary or a `Management` plane; declined, it stays a flow and is recorded as `privilege_transitions` for the credential step. DNS, certificate authorities and CI/CD are covered earlier, by the discovery `blind-spots` question.

---

## 6. Exposure and Control Mapping

### How Exposures Work

Exposures are **computed by the platform**, not by the plugin:

1. Component has a class assigned and attributes set
2. Module's OPA/Rego policies evaluate attributes
3. Matching exposures are generated with MITRE ATT&CK `exploitedBy` references
4. Exposures are linked to components via `HAS_EXPOSURE` graph relationships

### How Countermeasures Work

1. Control (with ControlClass) assigned to a component
2. Module computes countermeasure nodes
3. Countermeasures link to MITRE D3FEND via `RESPONDS_WITH`
4. Countermeasures reference `addressedExposures`

### Plugin's Role

The plugin creates models with correct attributes so the platform produces accurate results. It does NOT:
- Generate its own exposure lists
- Fabricate MITRE ATT&CK technique IDs
- Compute countermeasures outside the platform

The plugin DOES:
- Ensure attributes are filled correctly (Rego policies evaluate against them)
- Suggest Controls from available ControlClass inventory
- After model import, recommend running analysis
- Explain how exposures/countermeasures will be generated

---

## 7. MITRE Integration

### Data Architecture

MITRE data lives natively in the graph database (populated by `mitre-frameworks` module):
- ATT&CK Enterprise Tactics (15, Stealth and Defense Impairment among them — the list `/dethereal:surface` reports coverage against), Techniques (~600+), Mitigations
- D3FEND Tactics and Techniques
- Graph relationships: `TACTIC_INCLUDES_TECHNIQUE`, `MITIGATION_DEFENDS_AGAINST_TECHNIQUE`, `ENABLES`
- Model relationships: `Exposure -[EXPLOITED_BY]-> MitreAttackTechnique`, `Countermeasure -[RESPONDS_WITH]-> MitreDefendTechnique`

### Preventing Hallucinated References

1. **Never generate technique IDs from memory.** Use `search_mitre_attack` / `get_mitre_defend` MCP tools to query the platform's graph database.
2. **Canonical ID validation.** ATT&CK: `^T\d{4}(\.\d{3})?$`, Tactics: `^TA\d{4}$`, Mitigations: `^M\d{4}$`, D3FEND: `^D3-[A-Z]{2,}$`
3. **Platform verification.** Before persisting any MITRE reference, confirm it exists in the database. For ATT&CK: use `search_mitre_attack(action: 'technique', attack_id: '...')`. For D3FEND: use `get_mitre_defend(action: 'technique', d3fend_id: '...')`. The same three-step guardrail applies to both frameworks.
4. **Disclosure.** Indicate whether references are verified or pending verification.

### Lookup Flow

```
Plugin identifies threat category (STRIDE mapping)
  -> Query platform: search_mitre_attack(keywords)
  -> Platform returns matching techniques from graph DB
  -> Plugin ranks by relevance to component/context
  -> Plugin presents top 3-5 techniques with descriptions
  -> User confirms/modifies selection
  -> Plugin cites the verified technique in the conversation
```

The plugin never writes a technique onto a model element or an exposure: the validator rejects technique fields in attribute files, and an exposure's `exploitedBy` references come from the module's policies when the platform computes it. The lookup explains a technique an exposure names, or one the user asks about.

**ID validation short-circuit:** When the user provides a specific technique ID (matching `^T\d{4}(\.\d{3})?$`), skip search and ranking — use `search_mitre_attack(action: 'technique', attack_id: '...')` directly. Present the technique details for confirmation. This saves one MCP tool call and one ranking reasoning pass per direct ID reference. Direct ID references are common in security_review and incident_response contexts where the user already knows the relevant techniques.

---

## 8. Model Quality and Completeness

### Three-Tier Quality Gates

**Gate 1: During Creation (advisory)**

Inline warnings during conversational modeling:
- Non-external component without class assignment
- Data flow without a name or description
- Boundary with a single child (component or boundary)
- External entity in same boundary as internal components
- Cross-boundary data flow without a recorded security control or security attribute
- Non-external component in no declared or inherited trust zone (unzoned)

**Gate 2: Before Sync (blocking for sync)**

Must pass before `import_model`, `create_threat_model`, `update_model` or `update_attributes`: each of them refuses the push, before any backup or platform call, while Gate 2 fails. Gate 2 checks:
- Manifest completeness (name, description, module references). The server derives the module references; a class or entry whose module cannot be derived fails here ([MCP_ARCHITECTURE.md §Manifest Modules](MCP_ARCHITECTURE.md#manifest-modules))
- Structure validity (at least one boundary, one component)
- Reference integrity (all data flow source/target IDs exist)
- At least one data flow exists
- No orphaned attribute files
- Every attribute file can be read
- No attribute file carries a `controls` key (controls are managed with the controls tools)
- No validation lint at error level

With the settlement on (off by default), a push that passes Gate 2 is still refused, in this order, while an enrichment value awaits the operator's confirmation (`.dethereal/enrichment-pending.json`), and while a value in the pushed model is not registered as the operator's. With it off, Gate 2 alone gates a push. Gate 3 and REVIEWED do not block a push.

**Gate 3: Before REVIEWED (blocking the review)**

Gate 3 blocks REVIEWED, not the push or the analysis: a model whose Gate 3 fails can still be pushed and analyzed, and its readiness reads Not Ready with the failing criteria named, because the analysis would have gaps. The criteria, as `validate_model_json(action: 'gates')` computes them:
- **C1** — every non-external component is classified
- **C2** — ≥ 80 % of template fields answered on Tier 1–2 (measured over the template fields of the Tier 1–2 components, not over elements)
- **C3** — every cross-boundary flow is reviewed (`encryption_in_transit`, `auth_failure_mode` for a flow that authenticates, `required_credentials`)
- **C4** — sensitive flows carry a classified data item with a sensitivity
- **C5** — at least one cross-boundary flow (ensures analysis has something to evaluate)
- **C6** — crown jewels resolve through the persisted map (`crown_jewel_elements` in `scope.json`)
- **C7** — sensitivity at or above its floor
- **C8** — the literal six-attribute floor on Tier 1–2 (`authentication_type`, `encryption_in_transit`, `encryption_at_rest`, `implicit_deny_enabled`, `monitoring_tools` on each Tier 1–2 component, and `encryption_in_transit` on their flows)
- **C9** — no dangling `credential_scope` id (every id is in some flow's `required_credentials`)

**Gate 3 waivers are bound to one machine.** A waiver record lives in `.dethereal/state.json`, but it counts only where this machine granted it for this model directory: `model_state_waive` records the grant beside the waiver key the server keeps in the user's home, not in the model's state. A record granted on another machine, copied from another directory, written by hand, or written before waivers were bound to one machine resolves as `unverified` (inherited): it is listed but never applied, and `model_state` `get` counts it as `waivers_inherited`. Granting it again with `model_state_waive`, for the same criterion and elements, makes it count; the record's `recorded_reason` is shown labelled "recorded by another machine, not verified" and passed as the new `reason` only when the operator confirms it. A grant is refused with `no_waiver_key`, `waiver_grants_unavailable`, or `waiver_grants_full` (revoke unused waivers first). Since nothing in `state.json` can make a waiver count, the file is committed with the model. The workflow offers a waiver only through Gate 3's four waiver questions at Step 9 (`waiver-accept`, `waiver-select`, `waiver-basis`, `waiver-reason`): consent is only `waive` at `waiver-accept`, and the reason only the reply to `waiver-reason` — a reply to any other question leaves the field `null` (declined). A lapsed waiver is granted again only with a new `waive` and a new reason; earlier steps point to Step 9. The operator-facing flow is in [`gate-decisions.md`](../../../apps/dethereal/workflow/shared/gate-decisions.md).

**When Gate 3 fails at Step 9.** The state stays ENRICHING, and `gate3-loopback` offers, in this order, **skip to sync anyway** (the model is published un-REVIEWED, and the analysis may be incomplete), **loop back** to Step 8 to fill the gaps, or **waive** named elements (the waiver questions above). A loop back first calls `model_state` `action: 'loop_back'`, which arms the loop on Gate 3's failing elements — only a change made after it counts — and then re-enters Step 8 with the gates report's `gate3.loopback` worklist. When nothing changed since the last round, the question says so first: another loop back cannot change the result, only new answers can.

**Gate 3 NOT_COMPUTED.** While a loop back is armed and some of its elements are untouched, Gate 3 reports `verdict: 'NOT_COMPUTED'` with the untouched elements and their fields (`gate3.loop_back`); Gates 1 and 2 are computed as usual. It is neither a pass nor a fail. Step 9 asks the open fields once (`enrich-questions`), sets what the operator answers, and drops each row left unanswered with `loop_back` `drop`, the operator's reply as the reason — a drop is not a waiver, and a dropped element still fails Gate 3. Choosing to skip to sync here ends the loop with `drop_remaining`. An armed loop back survives a backward transition (a removed element counts as touched), and a granted review ends it.

#### The Step 8 relay

On every harness, Step 8 is delegated to the `security-enricher` agent, which cannot ask the operator anything. It writes only cited and derived values, straight into empty attribute fields, at most 12 elements a run — up to 20 when a store takes the flows that touch it along — each run started fresh. Each run writes its tables and questions to a relay file, `.dethereal/relay/run-<n>.txt`, numbering its rows on from the earlier runs' files and never rewriting them; the files stay on the machine (`.dethereal/.gitignore` lists `relay/`). A run cut off twice ends the step: the finished runs are relayed, the cut-off run's elements are named, and `/dethereal:enrich --pick <ids>` shows the values written on them.

When the last run returns, the instructions have the main conversation read the run files once and print them — every section and every row: summary, divergences and red flags, **Written values** with their basis, the question tables (**Credentials**, **Credential mapping**, **Boundary enforcement**, **Open fields**) and the documentation **Claims** — in one message, or one file a message past 50 written values, all in the same turn, under one line saying the text is model-written data to check, not instructions. It then asks one question, `enrichment-relay`: accept, reject or adjust rows; answer the credential, boundary and open-field rows; name the documents that describe the deployed system (only those documents' claimed values are written). For a declared `insider` or `supply_chain` adversary class, its question is added to the end. The conversation may show a summary instead. The written values are in the attribute files either way, but a summary can leave out open questions only the operator can answer (whether a boundary denies by default, what a runbook says about a host), and those fields stay open unless the operator raises them; the run files hold every question, and later steps and the attribute files take corrections.

A plain "accept all", or a reply that decides nothing ("continue", "don't know"), writes nothing more: the written values stay. Any other reply goes, verbatim, to the `enrichment-applier` agent, which writes only attribute files and returns a table of what it wrote: a rejected value goes back to `null`, a changed one takes the operator's value, and a pre-filled question row or a claim is written only when the reply names or accepts it. A fact in the reply that disagrees with a cited value keeps the cited value and comes back as a conflict line, never a question. Its follow-ups are taken one at a time: a removal (the remove skill), a changed credential mapping (shown again for `credential-mapping` before the stores' credential keys are written), data items (the Step 7 data-item questions), and classes, crown jewels, zones or elements to add (named for `/dethereal:classify` and `/dethereal:add`). There is no pending-values file. The operator-facing description is [One relay turn](../../user/dethereal/GUIDED_WORKFLOW.md#one-relay-turn).

> Threat identification is an output of analysis, not an input prerequisite. After analysis completes, validate: if zero threats were found, review model completeness — analysis modules may not have enough data to evaluate.

### Quality Score (0-100)

```
score = (
    component_classification_rate * 25 +
    attribute_completion_rate * 20 +
    boundary_hierarchy_quality * 15 +
    data_flow_coverage * 15 +
    data_classification_rate * 10 +
    control_coverage_rate * 10 +
    credential_coverage_rate * 5
)
```

All factors are normalized to the range 0.0-1.0 before multiplication. Rate factors (`component_classification_rate`, etc.) are computed as ratios (e.g., classified_components / total_components). When a denominator is zero (e.g., `total_components = 0` during early scope definition, or `total_cross_boundary_flows = 0` for models without trust boundaries), the rate is 0.0 — not NaN or undefined. `attribute_completion_rate` is the exception: a zero denominator routes it to a fallback basis rather than to 0.0 (see below).

`attribute_completion_rate`: **the units are class template FIELDS, not elements.** It is `resolved / declared`, where `declared` sums the template field count of every scored element and `resolved` counts the fields that carry a value. A field is unresolved when it is absent from the attribute bag, `null`, or `undefined`; presence is tested with `hasOwnProperty`, so a template field named `toString` or `constructor` does not score as resolved on every element.

The population is every element in the model — boundaries, components, data flows, data items — read from the structural files (`structure.json`, `dataflows.json`, `data-items.json`), not from the attribute tree. Reading the attribute tree instead would drop exactly the classified-but-unenriched elements that carry the largest residual, and produce a completion rate that climbs as enrichment gets worse. The class binding likewise comes from the structure, never from the `classData` copy embedded in the attribute file, which is written at stub time and is the stale one after a reclassification.

Templates come from `.dethereal/class-cache/`, keyed by CLASS id. Two groups are excluded from **both** sides of the ratio rather than scored either way:

| Excluded | Counter | Why |
|---|---|---|
| No class binding | `elements_unclassified` | Already penalized by `component_classification_rate` and `data_classification_rate` |
| Classified, but the class is not in the cache | `elements_without_template` | Counting them complete overstates readiness; counting them incomplete punishes a model for a cache miss |

Whenever either exclusion is non-empty, the factor carries a `note` naming the counts, so the ratio is honest about what it measured. Because the class cache is keyed by class id it survives the local-id → platform-id remap on push, which is why enrichment is measured from it rather than from the element-keyed `.dethereal/template-fields/` manifests.

**Fallback basis.** If no element resolves to a cached template at all — `declared` is 0, meaning the model was never stubbed or predates the cache — the factor falls back to the pre-existing file-presence heuristic: `(component attribute files + data item attribute files) / (total components + total data items)`, capped at 1.0. This is a materially different measure: it counts one entry per element, so a stub whose every field is `null` scores identically to a fully enriched element. The payload labels which one ran (`attribute_residual.basis` is `'template'` or `'file-presence'`) and the factor's `note` says *"No cached class templates — measuring attribute-file presence, not resolved fields. Run generate_attribute_stubs."* **The same model can therefore score differently before and after `generate_attribute_stubs` runs**, and the label is the only way to tell which number is in hand.

**`attribute_residual`.** The quality payload carries the worklist behind this one number, because a number cannot tell an operator what to go and answer:

```typescript
attribute_residual: {
  declared: number                    // template fields across all scored elements
  resolved: number                    // of those, fields carrying a value
  unresolved: number                  // declared - resolved
  elements_scored: number             // classified, with a cached template — the ratio's population
  elements_unclassified: number       // excluded from the ratio
  unclassified_open: number           // unclassified, less the root container and those left unclassified
  elements_without_template: number   // excluded from the ratio
  basis: 'template' | 'file-presence'
  blocked: Array<{ element: string; class_id: string }>
  top_unresolved: Array<{
    element: string; class: string
    unresolved: number; declared: number
    fields: string[]                  // the unresolved field names
  }>
}
```

`blocked[]` names the classified elements the ratio could not measure — the fix is almost always to run `generate_attribute_stubs` so the class template is cached. `top_unresolved[]` is sorted by unresolved count descending. Both arrays cap at 25 entries and each entry's `fields` caps at 12, so treat them as the top of the queue rather than the whole of it; the complete checklist is still the `null` fields in the attribute files. On the file-presence fallback, `elements_scored` and `blocked[]` are zeroed rather than left holding a partial tally from a pass that did not complete.

`unclassified_open` counts the unclassified elements still open to classification: every element counted in `elements_unclassified` except the model's root container (the default boundary, which is never a classified segment) and those `.dethereal/discovery.json` lists in `left_unclassified` (an element id, or an object naming it as `id` or `element_id`). `elements_unclassified` still counts the root container when it has no class. A missing or unreadable `discovery.json`, or an entry that names no element, excludes nothing beyond the root container, so the count errs high, never low. It changes neither `elements_unclassified`, the ratio nor `quality_score`, and is kept in both `detail` levels.

`control_coverage_rate`: two-tier metric. *Inferred tier* (offline): percentage of classified components with at least one positive security attribute per the mapping table in [CONTROL_INTEGRATION.md §10](CONTROL_INTEGRATION.md#quality-score-from-attributes). *Formal tier* (post-sync): percentage of classified components with at least one control reference in `controls[]` (directly or boundary-inherited). The quality score uses the maximum of the two tiers per element.

`credential_coverage_rate`: share of cross-boundary data flows (the set Gate 3's C3 uses) whose credential question is answered — `required_credentials` recorded as a list, `[]` (no credential) included, with no placeholder entry. It measures that the question was answered, not how strong the credential is; the factor's note gives how many answered flows record `[]`.

**boundary_hierarchy_quality** is computed as a continuous score. Three conditions sum to 1.0 (the third carries the rounding remainder, and the total is capped at 1.0):
- Hierarchy depth >= 2: +0.33
- No boundary contains only one child: +0.33 (also granted when the model has no boundaries at all)
- No boundary mixes an EXTERNAL_ENTITY with internal components: +0.34

The third condition compares **direct children only**, recursively: a boundary fails if it directly contains both an `EXTERNAL_ENTITY` and at least one component of another type. A nested boundary is its own zone, which is the shape the modeling guidelines recommend — putting the external actor in its own Internet Zone rather than flattening it in beside the web server.

> That third condition was previously awarded unconditionally, on the reasoning that external entities could not be distinguished offline. They can — the same tool already walks for them when computing coverage — and the free 0.34 made the factor unable to report the one modeling error it names. It is now evaluated. A model that flattens an external actor in with internal components loses 5.1 points (0.34 × 15) that it used to be given.

> Previous ternary scoring (10/5/0) was ambiguous ("which two-of-three combinations yield 5?") and created a 7.5-point cliff effect that penalized valid architectures (e.g., a DMZ containing only a WAF is architecturally correct but scored 0 on the single-child condition).

| Score Range | Label | Meaning |
|------------|-------|---------|
| 0-39 | Starting | Model creation in early stages |
| 40-69 | In Progress | Model taking shape, continue enrichment |
| 70-89 | Good | Largely complete |
| 90-100 | Comprehensive | Full coverage |

The score is a label; it gates nothing. Analysis readiness comes from the server (`workspace_status` `readiness`, built on the gate verdicts of `validate_model_json(action: 'gates')`) and reads **Ready** or **Not Ready**: Ready when Gates 2 and 3 pass (and, with the settlement on, no attribute value awaits the operator's confirmation or registration); otherwise Not Ready, with each blocker named (`gate2`, `gate3`, `unavailable`, and, with the settlement on only, `pending`, `pending_unreadable`, `settlement`). There is no score threshold. Gate 3's criteria (trust boundary crossing review, cross-boundary data flow existence, and the rest) are pass/fail requirements independent of the numeric score.

**Quality computation:** The quality score is computed deterministically by the MCP server via `validate_model_json(action: 'quality')`. The `model-reviewer` agent calls this tool and receives the structured score breakdown, then presents and interprets the results. This keeps the computation deterministic (not LLM-dependent) and the agent's role limited to presentation. The final score is rounded to two decimal places.

**Unreadable attribute files lower the score, and say so.** Every factor that reads `attributes/` treats a file it cannot parse as unenriched, so a single corrupt file drags the score down for a reason that looks exactly like unfinished enrichment. The quality payload therefore emits a `warnings[]` entry naming the file and the read failure, and states that the next push may overwrite it. The file itself is protected: a read failure marks it so that no write path — the attribute write, the id-remap rename, or the stale-file cleanup — may write over it, rename over it, or unlink it. Restoring the file and re-running `quality` is the fix; the score should recover on its own.

**Post-action footer:** Mutating skills compute only the "after" score (absolute, not delta), with the state as `model_state` `get` reports it (`display_state`, which carries waivers, a stale review and the quick mark): `[done] Action complete. State: <display_state>. Quality: X/100.`, then `[next] When you're ready: <command> (reason)`. The cached score from `.dethereal/quality.json` provides the "before" reference if needed. This halves MCP tool calls per mutation compared to computing both before/after scores.

**Mapping vs. Analysis Quality (D23):** The plugin's quality score and the platform's analysis-readiness score measure different things: the plugin measures structural completeness (mapping concern), while the analysis measures readiness (includes dimensions, such as exposure coverage, that the plugin cannot compute). These scores should be displayed side-by-side, not merged. The table above shows approximate alignment — the platform's analysis performs its own readiness assessment at analysis launch time.

### Common Gaps Checklist

The model-reviewer agent checks for these commonly missed elements:

- [ ] Administrative access paths modeled
- [ ] Monitoring/logging flows modeled
- [ ] Backup/recovery flows modeled
- [ ] All trust boundary crossings have data flows
- [ ] External dependencies identified (CDN, DNS, CA, package registries)
- [ ] Human actors modeled (developers, operators, support staff)
- [ ] Bidirectional flows modeled (not just requests, but responses too)
- [ ] Error/fallback paths modeled

### Readiness Report Format

`/dethereal:review` runs the `model-reviewer` agent, which changes nothing and renders the server's results. Its full review has these parts: the gates (every verdict, failing check, waiver, the Gate 3 report and its `limit` sentence), the quality score with its label and factor table, the red flags, the zoning-coherence findings (advisory, with a scope disclaimer), the common-gaps checklist, the top three issues, recommendations, the state, the readiness and, when discovery ran, a one-line discovery basis. `--structure-only` runs only a structural check, with no gates and no score. An abridged example:

```
## Model Review: E-Commerce Platform

### Gates
Gate 1: WARN · Gate 2: PASS · Gate 3: FAIL
  C3 — 4/6 cross-boundary flows reviewed: Orders API → Payments DB (missing: required_credentials), +1 more
  Gate 3 certifies that the recorded answers are complete and consistent, not that they are true.

### Quality Score: 72/100 (Good)
| Factor | Score | Weight | Contribution |
|--------|-------|--------|-------------|
| Component classification | 100% | 25 | 25.0 |
| ... | ... | ... | ... |

### Red Flags (2)
- **Orders API → Payments DB** (`f-api-db`): `encryption_in_transit` = `none`
- **Payment webhook** (`f-webhook`): `auth_failure_mode` = `fail_open`

### Zoning Coherence (advisory — does not block sync)
- **[Warning]** 1 external-tier boundary reaches a trusted tier without an approved channel: Vendor API → App Tier

### Top Issues
1. **[Critical]** 2 cross-boundary flows have no recorded credential (Orders API → Payments DB, Worker → Queue)

### Analysis Readiness
Not Ready for platform analysis — Gate 2: PASS · Gate 3: FAIL
  Gate 3 fails — a push is possible, but analysis would have gaps (C3)
```

Readiness is the server's `workspace_status` `readiness` (Ready / Not Ready, with its blockers), never a score threshold or the reviewer's judgement. In the guided workflow, Step 9 delegates the same review without the gate verdicts and recommendations, calls the gates itself, and shows the verdicts, then the reviewer's red flags, top issues and zoning findings; on a quick model it shows only the score and the red flags.

---

## 9. Multi-System and Incremental Modeling

### Model Storage

Models are stored at user-chosen visible paths (e.g., `./threat-models/production-stack/`), committed to version control alongside code. `.dethernety/` at the project root is reserved for plugin metadata only. Per-model metadata (state, discovery, quality) lives in `<model-path>/.dethereal/`. This enables:
- Code review includes model changes
- Git history tracks model evolution
- Branch-based model variants for different environments

Multi-model projects use one folder per model as parallel siblings:

```
./threat-models/
  payment-processing/
    manifest.json, structure.json, dataflows.json, ...
    .dethereal/
  user-platform/
    manifest.json, structure.json, dataflows.json, ...
    .dethereal/
.dethernety/
  models.json                # Registry of all local models
  discovery-cache.json       # Shared discovery results (see below)
  decomposition-plan.json    # Optional: planned models + progress
```

### Change Detection

```
1. Export current model from platform
2. Run discovery against current codebase
3. Diff discovered components against model components
4. Present change summary to user
5. Apply approved changes
```

### Model Decomposition for Complex Systems

#### When to Decompose

In Step 2, after the discovered components are confirmed and the `blind-spots` question is answered — and before anything is written to the model files — the plugin checks the confirmed inventory against complexity thresholds and, if one is exceeded, recommends decomposition (the Decomposition Protocol). The recommendation is **advisory, never blocking**: `decomposition` offers narrow / decompose / continue, and on narrow or decompose, `decomposition-scope` (confirm / change) shows the split before this model's elements are written.

**Complexity signals** (quantitative):

| Dimension | Comfortable | Manageable | Recommend decomposition |
|-----------|:-----------:|:----------:|:-----------------------:|
| Components | 8-12 | 13-20 | 21+ |
| Trust boundaries | 3-5 | 6-8 | 9+ |
| Data flows | 12-20 | 21-35 | 36+ |
| Cross-boundary flows | 6-10 | 11-18 | 19+ |

**Complexity signals** (qualitative -- often more important than counts):

- **Multiple crown jewels with independent attack surfaces.** If the model has a payment database AND a PII store AND an authentication service, each with distinct trust boundaries and threat actors, the model is really three models.
- **Different team ownership.** When different teams own different parts of the model, review sessions become political negotiations. Decompose along team boundaries.
- **Mixed compliance regimes.** PCI-DSS scope and HIPAA/GDPR scope within a single model create confusion about which controls are required where.
- **Heterogeneous depth requirements.** If the API gateway needs architecture-level modeling but the payment service needs implementation-level modeling, a single model forces the entire system to the deeper level.

A quality score where `attribute_completion_rate` drops below 0.6 on a model with 20+ components is an indirect complexity signal -- the model is too large for comprehensive enrichment in a reasonable session.

#### Default: Scope Narrowing First

**Scope narrowing is the recommended default over upfront decomposition.** Start with the highest-risk subsystem (the one containing crown jewels), produce a complete analysis-ready model, then expand to adjacent models later. This:

- Gets to value faster (one complete model vs. N partially planned models)
- Is less overwhelming for the user
- Produces the most important analysis output first
- Is naturally iterative -- adjacent models are created in subsequent sessions

**Upfront decomposition planning** is appropriate when the user explicitly described multiple systems in their scope definition (e.g., "model our entire platform").

#### Decomposition Strategy

**Primary axis: trust boundary alignment.** Decompose along boundaries that minimize cross-model data flows. In practice:
1. Network perimeter boundaries (DMZ / internal / backend)
2. Authentication domain boundaries (systems sharing the same IdP and session context)
3. Data classification boundaries (PCI cardholder data environment as its own model)

**Secondary axis: team ownership.** After trust boundaries, team ownership is the next strongest signal.

**Avoid decomposing by technology stack.** "The React model" and "the Go model" is wrong. Technology is not a trust boundary. A frontend-backend-database chain is a single trust traversal path and must be modeled together.

**The parent-child pattern:**

```
Parent model: "E-Commerce Platform" (architecture-level)
  Component: "Payment Service" → representedModel → child model
  Component: "User Service" → representedModel → child model
  Component: "API Gateway" (no ref -- simple enough inline)
  External: "Payment Processor"
  External: "Identity Provider"

Child model: "Payment Service" (design-level, PCI focus)
  Full DFD of payment service internals
  Deeper attribute enrichment

Child model: "User Service" (design-level, GDPR focus)
  Full DFD of user service internals
```

The parent model captures the system-of-systems topology. Child models capture service internals at appropriate depth.

#### Cross-Model Analysis Gap

> **Important:** The platform's graph-based analysis (attack paths, blast radius, crown-jewel reachability) operates within a single model's graph. It does NOT traverse `REPRESENTS_MODEL` edges, so cross-model attack paths are invisible to it.

**Implications for decomposition:**

- Each model should contain at least one entry point (external entity) AND at least one crown jewel, or path analysis is trivially empty.
- Shared infrastructure components (IdP, DNS, logging) should be duplicated as external entities in each model that depends on them.
- The review phase flags: *"N components reference external models. Attack paths through these components are not included in this model's analysis."*

**Longer-term platform fix (not plugin scope):** The platform's analysis could support a cross-model mode that constructs a unified graph by following `REPRESENTS_MODEL` edges. The data is in the graph database; the query needs to follow the edge. This is a platform concern, not a plugin concern.

#### Discovery Cache

Discovery results are written to `.dethernety/discovery-cache.json` after the first discovery in a project and updated in a multi-model project. The cache never replaces the scan: every discovery still delegates the scan, because only the scout reports secret files, modules and the sources checked. When a decomposition plan is active, the cache's `assignedTo` map filters the scan's results, so components already assigned to other models are left out ("N components pre-filtered for other models").

The cache contains the full raw inventory (components, boundaries, IaC sources, confidence scores) but NOT model-specific decisions (scope, classification, enrichment).

#### Decomposition Plan

When the user accepts a decomposition recommendation, the plugin writes `.dethernety/decomposition-plan.json`:

```json
{
  "created_at": "2026-03-26T10:00:00Z",
  "source_scope": "E-Commerce Platform",
  "source_discovery": ".dethernety/discovery-cache.json",
  "models": [
    { "name": "Payment Processing", "path": "./threat-models/payment-processing", "status": "complete", "quality": 74 },
    { "name": "User Platform", "path": "./threat-models/user-platform", "status": "planned", "quality": null },
    { "name": "Data Pipeline", "path": "./threat-models/data-pipeline", "status": "planned", "quality": null }
  ],
  "cross_model_links": [
    { "from_model": "User Platform", "to_model": "Payment Processing", "description": "payment API call" },
    { "from_model": "User Platform", "to_model": "Data Pipeline", "description": "event publishing" }
  ]
}
```

`/dethereal:status` reads this file and displays progress: *"Decomposition plan: 1 of 3 models complete. Remaining: User Platform, Data Pipeline."*

The plan is a reminder, not a commitment. Users may complete only the most critical model and never return to the others -- this is explicitly acceptable.

#### Session Architecture

Multi-model creation uses the **iterative approach**: each model is a standard `/dethereal:threat-model` invocation in its own session (or after a session break). This aligns with D18 (one system per session with cross-refs).

1. Complete model 1 (full 11-step workflow), push to platform
2. Start model 2 in a new session. When a subsequent model of the plan is started, the plugin pre-creates stub components with `representedModel` links to the models it references; a reference to a model not yet synced is a warning, not an error.
3. Repeat for model N.

**Token economics:** For systems above ~20-25 components, multi-model is cheaper in practice because single-model sessions hit context window degradation. The break-even point: a 30-component system costs roughly the same total tokens as 1 or 3 models (~275-410K), but multi-model keeps each session within the proven 150-200K ceiling.

### Cross-System References

The `representedModel` field on components and boundaries enables composite modeling:
- A component in System A's model references System B's model via `REPRESENTS_MODEL` relationship
- The decomposition plan's stub components carry these links when a planned model is started; the guided workflow has no separate prompt for them
- The review flags every component or boundary with `representedModel`: attack paths through it are outside this model's analysis

**Trust assumptions at model boundaries.** When setting `representedModel`, the plugin should capture:
- Whether this model trusts the referenced model's authentication decisions
- Whether the connection crosses a trust boundary in the originating model's terms
- The data sensitivity level of flows crossing the model reference

These are captured as component attributes or scope trust assumptions (D49), enabling human review even though the engine cannot yet consume them algorithmically.

### Incremental Updates

The plugin uses `update_model` and `update_attributes` for incremental changes:
1. Create initial model with structural elements
2. Import to platform
3. Enrich incrementally via `update_attributes`
4. Export, modify, re-import via `export_model` -> edits -> `update_model`

---

## 10. Minimum Viable Models

### By Use Case

| Use Case | Minimum Model | Key Metric |
|----------|---------------|------------|
| Compliance audit | All data stores, external flows, auth mechanisms, control mapping | Every regulated data flow documented |
| Security review | Internet-facing attack surface, auth flows, data classification | Every cross-boundary flow classified |
| Incident preparedness | All network-exposed components, credential flows, admin paths | Can trace entry point to crown jewels |
| Quick triage | Components + boundaries + data flows (no attributes) | Structural model exists |

### The 5-Element Minimum

The absolute minimum model:

```
Boundary: External Zone
  EXTERNAL_ENTITY: Client/User
Boundary: Internal Zone
  PROCESS: Application Server (with class + key attributes)
  STORE: Database (with class + key attributes)
DataFlow: Client -> Application (with protocol class + TLS state)
DataFlow: Application -> Database (with protocol class + auth method)
DataItem: User Data (with data classification)
```

The 5-element model demonstrates the plugin's workflow and familiarizes new users with model creation mechanics. It is insufficient for security review, compliance, or incident response. For production use, see the Minimum Viable Model table by use case above.

### Six Key Attributes Per Component

The enrichment phase checks the six-attribute floor on every in-scope component, whatever its class template covers, under exact keys: `authentication_type`, `encryption_in_transit` (on the component and on its flows), `encryption_at_rest`, `implicit_deny_enabled`, and `monitoring_tools` (Log telemetry); Logging has no floor-level key and is captured per the class template. Gate 3's C8 requires these keys on Tier 1–2 components and `encryption_in_transit` on their flows. The keys and the values each one accepts are in the [Six-Attribute Floor](../../user/dethereal/DISCOVERY_AND_ENRICHMENT.md#the-six-attribute-floor); OPERATIONAL_REQUIREMENTS.md Section 2 keeps the rationale.

**Batch enrichment per component:** The six attributes are asked as one table per component rather than one question each, which reduces 6 prompt-response cycles to 1 per component (72 total cycles to 12 for a 12-component model). Only evidence fills a cell: absence of evidence is not an observation, so a field nothing settles stays `null` and becomes a question, and an insecure value (`"none"`, `false`, `[]`) is written only from positive evidence or the operator's answer. A default no source states is proposed, never written, until the operator accepts it. Example:

```
Redis Cache — cited values to accept, reject or change; the rest need your answer:

| Attribute             | Value      | Basis                                   |
|-----------------------|------------|-----------------------------------------|
| authentication_type   | "password" | [cited] deploy/redis.conf:12            |
| encryption_in_transit | "none"     | [cited] app/cache.ts:8 (redis:// URL)   |
| encryption_at_rest    | ?          | not in the source — question            |
| implicit_deny_enabled | ?          | not in the source — question            |
| monitoring_tools      | ?          | not in the repository — question        |
```

`monitoring_tools: string[]` is the Log telemetry floor key: Gate 3's C8 requires it on Tier 1–2 components. A component nothing monitors is `[]`, never `["None"]`, and in practice `[]` comes from the operator's answer, since monitoring agents usually live outside the repository. A log or metrics destination, or a log-watching tool, that the source configures for the component (a log platform, CloudWatch Logs, pgaudit, fail2ban) is written from the source as it names it, cited, never as a guessed product, and whether anyone watches it is not asked.
