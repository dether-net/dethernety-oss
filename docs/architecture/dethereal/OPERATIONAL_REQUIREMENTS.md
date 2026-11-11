# Dethereal Plugin -- Operational Requirements

> Requirements for ensuring the plugin produces operationally useful and executive-presentable threat models.

## Table of Contents

- [1. Attack Surface Accuracy](#1-attack-surface-accuracy)
- [2. Detection-Ready Models](#2-detection-ready-models)
- [3. Lateral Movement Modeling](#3-lateral-movement-modeling)
- [4. Risk Quantification Support](#4-risk-quantification-support)
- [5. Compliance Readiness](#5-compliance-readiness)
- [6. Output Trustworthiness](#6-output-trustworthiness)
- [7. ROI and Competitive Position](#7-roi-and-competitive-position)
- [8. Model Lifecycle and CI/CD](#8-model-lifecycle-and-cicd)
- [9. Priority Matrix](#9-priority-matrix)

---

## 1. Attack Surface Accuracy

### What the Model Must Capture

Beyond basic components and data flows, realistic threat assessments require:

**Authentication flow topology.** Not just "authentication_enabled: true" on a component, but *where* authentication is validated, *what credentials flow where*, and *what happens after auth failure*. The plugin must prompt users to identify auth decision points when data flows cross trust boundaries.

**Authentication failure paths.** Not just whether authentication is enabled, but what happens when it fails. For each authenticated cross-boundary flow, the plugin must capture: Does the system deny by default? Fall back to weaker authentication? Fail open? The failure mode is often the exploit vector — expired JWT tokens that produce stack traces, fallback to basic auth, or silent pass-through on auth service timeout. The plugin should flag "fallback" or "fail-open" responses as high-priority for enrichment. Captured as structured attribute: `auth_failure_mode: "deny" | "fallback" | "fail_open"` on each authenticated cross-boundary data flow, asked as a column of the credential table. "Not sure" leaves it `null`; there is no `"unknown"` value. Flows with `fail_open` or `fallback` get an inline warning during enrichment as high-priority items for security review.

> **Known Gap (D48):** `auth_failure_mode` is captured for model enrichment and human review; security analysis does not currently take it into account. Flows marked `fail_open` or `fallback` may therefore appear more secure in analysis results than they are, and human reviewers should treat them as high-priority. The plugin shows this caveat once per session during enrichment. See the known-gap note under [THREAT_MODELING_WORKFLOW.md §Phase 5](THREAT_MODELING_WORKFLOW.md#phase-5-data-flow-mapping).

**Credential storage and distribution.** Which components share the same credential material? The credential that authenticates a flow (a password, an SSH key, a token) is modeled as a data item on that flow. Shared credentials are asked about as item 6 of the blind-spot question (below); the answers are recorded in `.dethereal/discovery.json` as `shared_credentials`, so enrichment's credential capture starts from them.

**Network segmentation fidelity.** Whether segmentation is enforced (firewall rules, NACLs) versus logical (VLANs, VPCs without deny rules). The plugin records this on each boundary as `implicit_deny_enabled`, `allow_any_inbound` and `egress_filtering` — keys the workflow asks for whether or not the boundary's class template declares them.

The plugin surfaces segmentation enforcement early in the workflow — during architecture modeling, not deferred to enrichment. At Step 4 (Boundary Refinement), the same batched question that ratifies the trust classification (`boundary-trust`, accept all / adjust) carries an **Enforcement posture** table: per boundary, `implicit_deny_enabled` (blocks traffic by default), `allow_any_inbound` (allows unrestricted inbound) and `egress_filtering` (`deny_all`, `allow_list`, `allow_all`), each proposed value with its source, blank where no source shows one. Only accepted rows are written. At review, the model-reviewer shows each boundary's enforcement as "enforced" (implicit deny plus egress filtering) or "logical only".

### Systematic Blind Spots

Auto-discovery from code systematically misses these elements. After the discovered component list is confirmed, the plugin asks about all six categories in **one consolidated question** (`blind-spots`, free text), and the operator lists what applies or says "none":

| Blind Spot | Why Missed | Impact | How the answer is recorded |
|-----------|-----------|--------|----------------|
| Shared infrastructure (IdP, DNS, CA, log aggregator, SIEM, secret manager) | Outside application codebase | SolarWinds-style attacks target shared services | Each named element joins the discovery proposal as a manual source |
| Side-channel data flows (logging pipelines, metrics, DNS resolution, backup/replication, health checks) | Not visible in application code | Attacker C2 via DNS, data exfiltration via logs | As above; a backup destination enters as a component (STORE or EXTERNAL_ENTITY), never a bare flow |
| Deployment pipeline (CI/CD platform, container registries, artifact stores, deployment agents) | Not application code | Supply chain attack vector | As above; registries and artifact stores enter as components (STORE or EXTERNAL_ENTITY), never bare flows (see §8 CI/CD Integration Pattern) |
| Third-party SaaS (OAuth, payments, CDN, email/SMS, webhook consumers) | Configured outside code | Organizational boundary crossings | Each named element joins the discovery proposal as a manual source |
| Human actors with privileged access | Not in code | Insider threat, social engineering | Each named element joins the proposal; the question is pre-filled with the actors the source shows behind each remote-access entry point |
| Shared credentials (service accounts used by several components, shared API keys, reused database credentials) | Secret files are never read | Lateral movement through a shared principal | Not elements: recorded in `.dethereal/discovery.json` as `shared_credentials`; the question is pre-filled with candidates the unread secret files show by reference only |

The plugin must call out known blind spots: "This model was built from code analysis. The following are NOT captured: [list]."

---

## 2. Detection-Ready Models

### Model Attributes for Detection Engineering

For the model to feed useful detection work downstream:

**Protocol specificity on data flows.** Encourage specific protocol class selection (HTTP/2, gRPC-over-HTTP/2, PostgreSQL wire protocol) rather than generic "Network Traffic." Protocol determines available telemetry.

**Encryption and authentication state per data flow.** TLS configuration, certificate pinning, mTLS. A flow marked `tls_enabled: true, certificate_pinning: true` tells a detection engineer they cannot use TLS inspection.

**Logging coverage per component.** `enable_access_logging`, `audit_logging_enabled`, `centralized_logging` attributes directly inform detection capability gaps.

**Data classification on all cross-boundary flows.** Classification determines detection priority and regulatory monitoring requirements.

### Six Key Attributes Per Component

For exposure detection to work, the plugin prioritizes these six attributes. Enrichment checks them on every in-scope component, whatever its class template covers, under these exact keys:

| # | Concept | Attribute key |
|---|---------|---------------|
| 1 | Authentication | `authentication_type` |
| 2 | Encryption in transit | `encryption_in_transit` (on data flows and components) |
| 3 | Encryption at rest | `encryption_at_rest` |
| 4 | Logging | no floor key — captured through the class template's own logging fields |
| 5 | Access control | `implicit_deny_enabled` |
| 6 | Log telemetry | `monitoring_tools: string[]` (see Monitoring Coverage below) |

The five keyed attributes are Gate 3's C8 floor: each must be answered on every Tier 1–2 component (see [THREAT_MODELING_WORKFLOW.md §Three-Tier Quality Gates](THREAT_MODELING_WORKFLOW.md#three-tier-quality-gates)). A semantically equivalent key a class template happens to use does not satisfy the floor.

Knowing that logging is "enabled" is insufficient for detection engineering. What matters is where logs go and whether they are searchable. A component with `enable_access_logging: true` but logs going to local disk that nobody monitors is invisible to the SOC. The plugin asks this through the monitoring-tools question below; there is no separate log-destination question.

### Monitoring Coverage (Enrichment Phase)

During enrichment, the plugin should prompt for monitoring tool coverage per component:

> "What monitoring tools cover [component]?"
> Options: SIEM, EDR, NDR, APM, Cloud-native (CloudTrail/VPC Flow Logs), None

Stored as a component attribute: `monitoring_tools: string[]`. An answer of "None" is recorded as `[]`, never `["None"]` — coverage counts a non-empty array as monitored, so a `["None"]` sentinel would report a blind component as covered. A log or metrics destination, or a log-watching tool, that the source configures for the component (a log platform, CloudWatch Logs, pgaudit, fail2ban) is written to `monitoring_tools` from the source before anything is asked, as the source names it and cited. A repository without monitoring configuration is a question for the operator, not `[]`.

The intended use (planned, not implemented — see below) is for analysis to compute detection feasibility from it:
- "available" if the required data source matches a deployed monitoring tool
- "requires_config" if a monitoring tool exists but may not collect this specific data
- "not_possible" if no monitoring tool covers this component

> **Note:** `monitoring_tools` captures deployed tool *categories*, not confirmed log ingestion per data source. Detection engineering requires validating specific log source ingestion (e.g., "pg_audit forwarded to SIEM") before writing detections. This attribute is a starting point for detection feasibility, not a confirmed telemetry inventory.

**Detection feasibility mapping (D66 — human review only):** The mapping below documents the intended relationship between `monitoring_tools` and `coverage_layer`. It is not implemented: security analysis does not read `monitoring_tools` for detection feasibility, and no integration point exists. The plugin captures `monitoring_tools` for human review in the threat model output, and Gate 3's C8 requires an answer on Tier 1–2 components. Analysis integration is planned.

| `monitoring_tools` value | Covers `coverage_layer` | Caveat |
|---|---|---|
| SIEM | network, application, identity | Only if specific log sources are ingested |
| EDR | endpoint | Requires agent deployment on host |
| NDR | network | Encrypted traffic may limit visibility |
| APM | application | Limited to instrumented services |
| Cloud-native | network, identity | Varies by cloud provider config |

Once implemented, detection feasibility output ("available", "requires_config", "not_possible") would be a coverage-category match, not a confirmed detection capability. SOC teams should validate that the specific data source is ingested and queryable before writing detections.

---

## 3. Lateral Movement Modeling

### Critical Data Flow Attributes

**Credential scope per data flow.** When component A connects to component B using a service account, that account may also access components C, D, E. The plugin must capture: "What credential is used for this data flow?" and "What else can that credential access?"

**Privileged access paths.** Admin interfaces, SSH/RDP, K8s API server, cloud management consoles -- these are lateral movement highways. The plugin must identify and flag privileged access flows.

**Shared infrastructure dependencies.** DNS, Active Directory, certificate stores, secrets vaults. When compromised, lateral movement becomes trivial. Part of the shared infrastructure prompt.

### Graph-Native Analysis Support

The platform's Cypher query capability enables lateral movement analysis:
- "Find all paths from internet-facing components to PII stores through unencrypted flows"
- "Show all components reachable from a compromised service account"

The plugin's job is to ensure the model has sufficient data for these queries to work accurately.

---

## 4. Risk Quantification Support

### Required Model Attributes

**Asset criticality.** The plugin must capture business impact if a component is compromised. Even a simple High/Medium/Low tag is better than nothing. Implemented for crown jewels: for each component with `crownJewel: true`, enrichment proposes `asset_criticality: "high" | "medium" | "low"` as a pre-filled row, written to the component's attribute file only after the operator answers it. Other components are not asked.

**Control implementation status.** Not just whether a control exists, but whether it is currently deployed and verified. A control on paper provides zero risk reduction.

### Prioritization Guidance

The plugin should guide users to model in priority order based on real-world incident patterns:

1. Internet-facing components and immediate backend connections
2. Data stores containing sensitive data
3. Authentication and authorization paths
4. Cross-boundary data flows
5. Administrative access paths

### "Good Enough" by Use Case

See [THREAT_MODELING_WORKFLOW.md §10 (Minimum Viable Models)](THREAT_MODELING_WORKFLOW.md#10-minimum-viable-models) for the canonical use case table and the 5-element minimum model. A completeness checklist chosen by the `modeling_intent` declared in scope is **not implemented**: the scope interview records `modeling_intent` and it syncs with the scope, but no workflow step reads it.

> Note: `asset_criticality` is implemented (for crown jewels, above). `control_implementation_status` is not implemented (see "Improve Later" in Priority Matrix below).

---

## 5. Compliance Readiness

### Regulatory-Relevant Component Metadata

| Metadata | Regulatory Driver | Priority |
|----------|------------------|----------|
| Data classification (PII/PCI/PHI) | All frameworks | Must have |
| Encryption at rest | PCI 3.4, SOC2 CC6.1 | Must have |
| Encryption in transit | PCI 4.1, SOC2 CC6.7 | Must have |
| Access control mechanism | All frameworks | Must have |
| Logging enabled | SOC2 CC7.2, PCI 10.x | Must have |
| Deployment region | GDPR Art. 44-49 | Must have |
| Retention policy | GDPR Art. 5(1)(e) | Improve later |
| Backup configuration | SOC2 A1.2 | Improve later |

### Compliance-Driven Data Classification (D52: Depth Levels)

The plugin supports compliance frameworks at three **depth levels**, chosen from the scope's `compliance_drivers`, so that it claims only what it does. (These are not the component tiers — Tier 1, 2 and 3 — that rank components for enrichment and Gate 3.)

**Full attribute questions (SOC2, ISO 27001):** These frameworks map cleanly to the six security attributes already captured. The plugin asks framework-specific enrichment questions, for the value in the floor's shape, not yes/no — SOC2: CC6.1 access control, CC6.7 encryption in transit, CC7.2 monitoring; ISO 27001: A.8.2 asset classification, A.10.1 cryptographic controls, A.12.4 logging.

**Data classification questions (PCI-DSS, HIPAA, GDPR):** These frameworks require data classification prompts but not full framework mapping:
- **PCI-DSS**: Flag cardholder data
- **HIPAA**: Flag any medical/health data as PHI
- **GDPR**: Flag personal data of EU residents

**Declared only (NIST CSF 2.0, NIS2, DORA):** Recorded in scope as compliance drivers, with no framework-specific questions; the plugin says so once. These frameworks require deep domain expertise to map correctly — getting them wrong creates false compliance confidence, which is worse than not supporting them.

> The regulatory-to-sensitivity mapping (`PHI` → restricted, `PCI cardholder` → restricted, `GDPR personal` → confidential minimum) is a static lookup table, not LLM-derived. Flags use the [canonical vocabulary](THREAT_MODELING_WORKFLOW.md#canonical-sensitivity-and-regulatory-flag-vocabulary); the table is part of the enrichment protocol the plugin's prompts follow.

### Control-to-Requirement Mapping

The platform's control system supports MITRE D3FEND mapping. For compliance, this also needs mapping to specific requirements (SOC2 CC6.1, ISO 27001 A.8.2, PCI-DSS 3.4). This is a module extension concern -- a compliance module could provide control classes with regulatory mappings.

> **Limitation:** The plugin supports evidence of controls and data flow documentation for compliance audits. Control-to-requirement traceability (e.g., which specific controls satisfy PCI-DSS 3.4) is not implemented in the plugin; it requires a compliance mapping module. The compliance audit use case is partially supported: models show *what exists* but not *which specific requirements are satisfied*.

---

## 6. Output Trustworthiness

### Trust Builders

1. **Explicit assumptions.** Every assumption stated and reviewable: "I assumed this server is internet-facing because it does not bind to localhost. If incorrect, please modify."
2. **Known gaps disclosure.** "This model was built from code analysis only. Not captured: network topology, WAF config, CDN config, DNS config."
3. **Traceability.** Every model element traceable to its source (file, line, conversation turn).
4. **Industry-standard terminology.** STRIDE, MITRE ATT&CK, OWASP categories enable cross-referencing with existing frameworks.

### Trust Destroyers

1. **Hallucinated components.** Never add components not evidenced in code without marking as suggestions. If the AI adds a "Redis cache" that does not exist, all trust is lost.
2. **Inconsistent severity ratings.** The OPA/Rego policy engine provides consistency. The plugin should not layer its own severity judgments on top.
3. **False precision.** Never present "73.2% probability" when based on incomplete data. Use qualitative assessments: "High probability based on internet-exposed surface with default credentials."

### Trust Model for Local Model Files

Model files at user-chosen paths (e.g., `./threat-models/production-stack/`) and committed to version control are treated as untrusted input when read by the plugin:

- **Element ID validation**: All element IDs validated against `^[\w-]+$` before filesystem operations (`validateElementId()` in the MCP server's `src/utils/directory-utils.ts`)
- **Path confinement**: All `directory_path` parameters are validated against directory traversal attacks (existing `validatePathConfinement()`)
- **Platform validation**: Imported models are validated by the platform backend (schema validation on GraphQL mutations)
- **Tamper detection**: With the settlement on (`DETHEREAL_SETTLEMENT=on`; it is off by default, see [MCP_ARCHITECTURE.md → Settlement Switch](MCP_ARCHITECTURE.md#settlement-switch)), a value in the model files that the operator did not register as theirs — written by hand, by another tool or by someone else — is surfaced as an unregistered value (on a `/dethereal:threat-model` resume and in `workspace_status`) and blocks a push until the operator confirms or adjusts it. The record of registered values is kept on this machine and integrity-checked. With the settlement off, values are not registered and nothing is surfaced or blocked for them. A warning keyed on git authorship or file timestamps is not implemented
- **Provenance separation**: Per-model metadata (`<model-path>/.dethereal/`) is separate from model data. The files that describe the model — including `state.json` and `discovery.json` (drift detection reads it) — are committed, and are read as untrusted input like the model files: a Gate 3 waiver in `state.json` counts only where this machine granted it (see [THREAT_MODELING_WORKFLOW.md §Three-Tier Quality Gates](THREAT_MODELING_WORKFLOW.md#three-tier-quality-gates)). This machine's records (`settlement-baseline.json`, `settlements.json`, `sync.json`) are kept out of git by the server. The control-library audit log (`.dethereal/control-audit.log`) is not committed either: it stays on the machine that wrote it, and its entries record per-machine tags in place of attribute values (see [CONTROL_LIBRARY.md §6 Audit log](CONTROL_LIBRARY.md#audit-log))

### Model Confidence Summary

**Implemented:** Whenever `.dethereal/discovery.json` exists, `/dethereal:review` adds a one-line discovery basis: `Model based on: code analysis (10 components) + manual (2). Known gaps: 3.` This is the minimum information needed to understand what the model covers.

**Planned, not implemented (D53):** Full confidence summary with discovery method breakdown, component counts by confidence level, model freshness (`model_age_days`), freshness categories (CURRENT/AGING/STALE), and a board-ready statement with editorial workflow. Deferred because: (a) freshness tracking depends on sync metadata (deferred per D40), (b) the board-ready statement requires validation against actual executive communication workflows, and (c) `commits_since_update` requires shell access that the model-reviewer agent does not have.

Models created by the plugin reflect code-time (design-time) infrastructure. The review output always includes a runtime validation recommendation: 'Runtime Validation Recommended: This model reflects code-time infrastructure. Cross-reference with cloud asset inventory, DNS logs, or network flow data to identify shadow infrastructure not visible in code.'

### Audit Trail (Review Record)

For the compliance audit use case, auditors expect evidence that the model was reviewed by someone with authority. The plugin's minimum is the **review record**: at the end of the guided workflow (Step 9), the operator is shown the gate verdicts and every waiver in use, then asked `review-record` (record / not now). On `record`, the plugin asks the server to transition the model to `REVIEWED`. The state is granted by the server, never claimed: the server refuses unless Gates 2 and 3 pass, no queued stale element still exists, every model file can be read, and the model is not a quick model. With the settlement on, it also refuses while a pending enrichment value or an unregistered value is left.

The server records the grant in `.dethereal/state.json` as the `REVIEWED` state with `reviewedAt` (when) and `reviewHash` (a hash of the model content the review covered). A later change to the model content marks the review stale (`reviewed_stale` in `model_state get`), so the record never describes a model it did not cover. A data item's controls count once the item has any, so a `REVIEWED` model whose data items gain controls reads as stale once. A `model_signed_off` key in an older `state.json` is legacy and not honoured.

Not implemented: a separate `audit_trail.json`, the reviewer's identity on the record, per-element confirmation tracking, and review history. The planned shape of that file, kept for reference — nothing writes or reads it, and its `model_signed_off` is not the `REVIEWED` record above:

```json
// <model-path>/.dethereal/audit_trail.json — planned, not implemented
{
  "scope_summary": "E-Commerce Platform — design-level security review, PCI-DSS + SOC2",
  "scope_confirmed_at": "2026-03-25T14:30:00Z",
  "scope_confirmed_by": "user@example.com",
  "model_signed_off": false,
  "sign_off_by": null,
  "sign_off_at": null,
  "discovery_method": "code_analysis + manual",
  "review_method": "guided_review"
}
```

The model files' git history is the record of who changed what. Periodic review tracking for SOC2 Type II and ISO 27001 surveillance audits depends on the platform's scheduled review workflow and is planned.

### Human-in-the-Loop Checkpoints (Non-Negotiable)

1. **After auto-discovery, before import**: User reviews and confirms the discovered model
2. **Data classification**: User confirms sensitivity classifications -- never auto-classify as non-sensitive
3. **Trust boundary placement**: Plugin can suggest but not decide
4. **Control effectiveness**: User confirms whether controls are actually deployed
5. **Model sign-off**: The operator records the review (`review-record`), and the server grants `REVIEWED`. Sign-off does not gate a push or analysis: a push is gated by Gate 2 (and, with the settlement on, by the operator's confirmation of pending and unregistered values), never by `REVIEWED`, so a model can be published un-REVIEWED

### Deterministic Output

**Deterministic output** is a design goal. Given the same codebase and user inputs, the plugin produces structurally consistent models. Discovery is grounded in file-based code analysis (deterministic). MITRE data is cached from the platform database (not generated by the LLM). Enrichment prompts follow a fixed sequence. Non-deterministic elements (LLM classification suggestions, confidence scores) are always presented for human confirmation, never auto-applied.

---

## 7. ROI and Competitive Position

### Value by Audience

| Audience | Value | Competitor Gap |
|----------|-------|---------------|
| Developers | Threat model without leaving IDE; model from actual code context | Microsoft TMT requires manual diagramming; Threat Dragon has no code awareness |
| Security engineers | Models pre-populated from code reduce the "blank page" problem (estimate: 60-70%, not measured) | IriusRisk requires manual component creation |
| Security architects | Graph-native Cypher queries enable attack path analysis impossible with document-based tools | No competitor offers queryable threat models |
| CISOs | Continuous threat modeling tied to code changes, not annual exercises | Every competitor treats threat modeling as point-in-time |

### Unique Capabilities

1. **Contextual code understanding.** AI reads code and suggests components with accurate descriptions, protocols, and data classifications.
2. **Iterative refinement.** "Add the Redis cache we use for session storage" -- AI understands component type, data classification, and data flow pattern.
3. **Class selection assistance.** AI matches code patterns to the right class with the right Rego policies, improving model quality.
4. **Guided enrichment.** Systematic prompting for manual enrichment items in natural conversation, replacing the "200-field spreadsheet" approach.

### Efficiency Estimate

| Approach | Time for Initial Model |
|----------|----------------------|
| Traditional workshop | 4-8 hours, 4-6 participants |
| Microsoft TMT / Threat Dragon | 2-4 hours diagram, 2-4 hours analysis |
| Dethereal plugin | 30-60 min creation, 30-60 min enrichment (projected) |

Estimates are projections based on typical web application architecture (5-15 components). Actual times vary by system complexity and user expertise. No validated benchmarks exist yet; they are planned, from real usage data.

---

## 8. Model Lifecycle and CI/CD

### Model Storage Strategy

Models stored at user-chosen visible paths (e.g., `./threat-models/production-stack/`), committed to version control:
- Code review includes model changes
- Git history tracks model evolution
- Branch-based model variants

### Update Triggers

The plugin-side triggers are detected by [drift detection](DRIFT_DETECTION.md) when `/dethereal:threat-model` resumes a model that has a drift baseline: the changed source files are re-verified and the differences are proposed as a delta for the operator to resolve.

| Trigger | Detection | Response |
|---------|----------|----------|
| New API endpoint | Code diff | Plugin suggests adding component |
| Dependency added/removed | package.json diff | Plugin suggests updating external entities |
| Environment variable added | `.env.example` / `.env.template` / `.env.sample` diff (a `.env` file itself is a secret file and is never read) | Plugin suggests checking new dependencies |
| Security boundary change | IaC diff | Plugin suggests boundary review |
| MITRE technique published | Module data update | Analysis modules re-evaluate |

### CI/CD Integration Pattern

A target pattern, not implemented: the plugin ships no CI job. Today the operator runs the equivalent steps by hand — reconciles drift with `/dethereal:threat-model` before opening the PR, commits the model files with the code, and publishes with `/dethereal:sync push`.

1. On PR: export current model to split files in repo
2. Plugin analyzes code diff and suggests model changes
3. Developer reviews and approves
4. Updated model committed alongside code
5. On merge: model imported to platform for analysis

---

## 9. Priority Matrix

### Must Have

| Item | Rationale |
|------|-----------|
| Structured discovery interview (shared infra, external services, credential flows) | Without these, models miss a large share of the real attack surface (estimate: 60-70%, not measured) |
| Confidence level tagging on discovered elements | Prevents hallucination distrust |
| Data classification prompting on every cross-boundary flow | Required for detection engineering and compliance |
| Explicit assumptions and known gaps disclosure | Non-negotiable for CISO trust |
| Human-in-the-loop review before model import | Prevents garbage-in-garbage-out |
| Goal-based modeling guidance (compliance, security review, incident prep) | Prevents over/under-modeling |
| Credential and service account flow capture | Core of lateral movement modeling |
| Six key security attributes per component | Minimum for exposure detection |
| Asset criticality tag (High/Medium/Low) | Minimum for risk quantification |
| Class selection assistance from code context | Key differentiator vs competitors |
| CI/CD pipeline as lightweight components | Asked in the blind-spot question; registries and artifact stores enter as components (STORE or EXTERNAL_ENTITY) with basic data flows (pipeline → registry → runtime), never as bare flows. Supply chain attacks (SolarWinds, XZ Utils) are the dominant threat trend; a model that excludes them entirely will be criticized by security teams |

### Improve Later

| Item | Rationale |
|------|-----------|
| Control implementation status tracking | Operational concern, not modeling |
| Regulatory requirement mapping on controls | Module extension territory |
| Log destination modeling | Can be STORE components but adds complexity |
| Evidence of control effectiveness | Issue tracker integration territory |
| Time-to-model metrics | Nice for ROI reporting |
