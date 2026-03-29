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

**Authentication failure paths.** Not just whether authentication is enabled, but what happens when it fails. For each authenticated cross-boundary flow, the plugin must capture: Does the system deny by default? Fall back to weaker authentication? Fail open? The failure mode is often the exploit vector — expired JWT tokens that produce stack traces, fallback to basic auth, or silent pass-through on auth service timeout. The plugin should flag "fallback" or "fail-open" responses as high-priority for enrichment. Captured as structured attribute: `auth_failure_mode: "deny" | "fallback" | "fail_open" | "unknown"` on each data flow. Flows with `fail_open` or `fallback` are flagged during enrichment as high-priority items for security review.

> **Known Gap (D48):** `auth_failure_mode` is captured for model enrichment and human review, but the Analysis Engine V2 does not currently incorporate it into edge weight computation (`auth_strength` is derived from `authType` only). This means a `fail_open` flow with `authType: "OAuth2"` receives a high auth_strength score when the effective strength is 0. Flows marked `fail_open` or `fallback` may appear more secure than they are in analysis results. Human reviewers should treat these flows as high-priority regardless of the engine's computed risk score. Engine integration is planned (see THREAT_MODELING_WORKFLOW.md Phase 5 engine integration note).

**Credential storage and distribution.** Which components share the same credential material? Service accounts, shared secrets, and API keys must be modeled as data items flowing between components. The plugin must ask: "Which components share credentials or service accounts?"

**Network segmentation fidelity.** Whether segmentation is enforced (firewall rules, NACLs) versus logical (VLANs, VPCs without deny rules). The boundary class templates include `implicit_deny_enabled` and `allow_any_inbound` attributes for this.

The plugin should surface segmentation enforcement early in the workflow — during architecture modeling, not deferred to enrichment. For each boundary, prompt: "Is this boundary enforced by network controls? (Yes — firewall/NACLs/security groups with explicit deny | Partially — security groups exist but allow broad access | No — logical grouping only)." Flag unenforced boundaries during review: "This boundary provides no network isolation. Components within are reachable from adjacent boundaries."

### Systematic Blind Spots

Auto-discovery from code systematically misses these elements. The plugin must explicitly prompt for each:

| Blind Spot | Why Missed | Impact | Plugin Response |
|-----------|-----------|--------|----------------|
| Shared infrastructure (IdP, DNS, CA, log aggregator) | Outside application codebase | SolarWinds-style attacks target shared services | Ask: "What shared infrastructure does this system depend on?" |
| Side-channel data flows (logging, metrics, DNS, backups) | Not visible in application code | Attacker C2 via DNS, data exfiltration via logs | Ask: "What supporting data flows exist?" |
| Deployment pipeline (CI/CD, registries, artifact stores) | Not application code | Supply chain attack vector | Note as known gap in model |
| Third-party SaaS (OAuth, webhooks, payments, CDN) | Configured outside code | Organizational boundary crossings | Ask: "What external service dependencies exist?" |
| Human actors with privileged access | Not in code | Insider threat, social engineering | Ask: "Who has admin access and how?" |

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

For exposure detection to work, the plugin must prioritize these six attributes:

1. **Authentication** (enabled/disabled, method, SSO/federation)
2. **Encryption in transit** (TLS version, certificate validation, pinning)
3. **Encryption at rest** (algorithm, key management)
4. **Logging** (access logging, audit logging, centralized)
5. **Access control** (authorization model, least privilege, service accounts)
6. **Log telemetry** (log destination component, centralization status, query capability)

For detection engineering, also capture `monitoring_tools: string[]` per component (see Monitoring Coverage below). This is not a quality gate input but informs analysis-side detection feasibility scoring.

Knowing that logging is "enabled" is insufficient for detection engineering. What matters is where logs go and whether they are searchable. A component with `enable_access_logging: true` but logs going to local disk that nobody monitors is invisible to the SOC. The plugin should prompt: "Where do logs from [component] go? (SIEM, CloudWatch, local disk, none)."

### Monitoring Coverage (Enrichment Phase)

During enrichment, the plugin should prompt for monitoring tool coverage per component:

> "What monitoring tools cover [component]?"
> Options: SIEM, EDR, NDR, APM, Cloud-native (CloudTrail/VPC Flow Logs), None

Stored as a component attribute: `monitoring_tools: string[]`. This enables the Analysis Engine to compute detection feasibility:
- "available" if the required data source matches a deployed monitoring tool
- "requires_config" if a monitoring tool exists but may not collect this specific data
- "not_possible" if no monitoring tool covers this component

> **Note:** `monitoring_tools` captures deployed tool *categories*, not confirmed log ingestion per data source. Detection engineering requires validating specific log source ingestion (e.g., "pg_audit forwarded to SIEM") before writing detections. This attribute is a starting point for detection feasibility, not a confirmed telemetry inventory.

**Detection feasibility mapping (D66 — V1: human review only):** The mapping below documents the intended relationship between `monitoring_tools` and `coverage_layer`. In V1, neither `monitoring_tools` nor `coverage_layer` is consumed by the Analysis Engine — no engine integration point exists. The plugin captures `monitoring_tools` as a component attribute for human review in the threat model output. Engine integration is a future capability.

| `monitoring_tools` value | Covers `coverage_layer` | Caveat |
|---|---|---|
| SIEM | network, application, identity | Only if specific log sources are ingested |
| EDR | endpoint | Requires agent deployment on host |
| NDR | network | Encrypted traffic may limit visibility |
| APM | application | Limited to instrumented services |
| Cloud-native | network, identity | Varies by cloud provider config |

Detection feasibility output ("available", "requires_config", "not_possible") is a coverage-category match, not a confirmed detection capability. SOC teams should validate that the specific data source is ingested and queryable before writing detections.

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

**Asset criticality.** The plugin must capture business impact if a component is compromised. Even a simple High/Medium/Low tag is better than nothing. This should be a component attribute.

**Control implementation status.** Not just whether a control exists, but whether it is currently deployed and verified. A control on paper provides zero risk reduction.

### Prioritization Guidance

The plugin should guide users to model in priority order based on real-world incident patterns:

1. Internet-facing components and immediate backend connections
2. Data stores containing sensitive data
3. Authentication and authorization paths
4. Cross-boundary data flows
5. Administrative access paths

### "Good Enough" by Use Case

See THREAT_MODELING_WORKFLOW.md Section 10 (Minimum Viable Models) for the canonical use case table and the 5-element minimum model. The plugin presents the appropriate completeness checklist based on the `modeling_intent` declared in scope.

> Note: `asset_criticality` is a V1 attribute. `control_implementation_status` is deferred to post-V1 (see "Improve Later" in Priority Matrix below).

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

### Compliance-Driven Data Classification (D52: Tiered Support)

The plugin provides tiered compliance framework support to match V1 capabilities honestly:

**Tier 1 — Full prompt support (SOC2, ISO 27001):** These frameworks map cleanly to the six security attributes already captured. The plugin generates framework-specific enrichment prompts (access controls, audit logging, encryption requirements).

**Tier 2 — Data classification only (PCI-DSS, HIPAA, GDPR):** These frameworks require data classification prompts but not full framework mapping:
- **PCI-DSS**: Flag cardholder data
- **HIPAA**: Flag any medical/health data as PHI
- **GDPR**: Flag personal data of EU residents

**Tier 3 — Declared, not prompted (NIST CSF 2.0, NIS2, DORA):** Recorded in scope as compliance drivers but no framework-specific prompts in V1. These frameworks require deep domain expertise to map correctly — getting them wrong creates false compliance confidence, which is worse than not supporting them.

> The regulatory-to-sensitivity mapping (HIPAA PHI → restricted, PCI cardholder → restricted, GDPR personal data → confidential minimum) is a static lookup table, not LLM-derived. It should be embedded as a configuration file (`docs/compliance_mappings.json`) imported by the security-enricher agent.

### Control-to-Requirement Mapping

The platform's control system supports MITRE D3FEND mapping. For compliance, this also needs mapping to specific requirements (SOC2 CC6.1, ISO 27001 A.8.2, PCI-DSS 3.4). This is a module extension concern -- a compliance module could provide control classes with regulatory mappings.

> **V1 limitation:** V1 supports evidence of controls and data flow documentation for compliance audits. Control-to-requirement traceability (e.g., which specific controls satisfy PCI-DSS 3.4) requires the compliance mapping module (post-V1). The compliance audit use case is partially supported: models show *what exists* but not *which specific requirements are satisfied*.

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

- **Element ID validation**: All element IDs validated against `^[\w-]+$` before filesystem operations (existing `validateElementId()` in dt-core)
- **Path confinement**: All `directory_path` parameters are validated against directory traversal attacks (existing `validatePathConfinement()`)
- **Platform validation**: Imported models are validated by the platform backend (schema validation on GraphQL mutations)
- **Tamper detection**: The plugin should warn users when importing a model modified by someone else since last sync (compare git blame or file modification timestamps against last known sync time)
- **Provenance separation**: Per-model metadata (`<model-path>/.dethereal/discovery.json`, `state.json`, etc.) is separate from model data and should not be committed to version control

### Model Confidence Summary

**V1:** When the model reaches analysis readiness, `/dethereal:review` adds a one-line discovery basis: `Model based on: code analysis (10 components) + manual (2). Known gaps: 3.` This is the minimum information needed to understand what the model covers.

**V1.1 (D53):** Full confidence summary with discovery method breakdown, component counts by confidence level, model freshness (`model_age_days`), freshness categories (CURRENT/AGING/STALE), board-ready statement with editorial workflow, and runtime validation recommendations. Deferred because: (a) freshness tracking depends on sync metadata (deferred per D40), (b) the board-ready statement requires validation against actual executive communication workflows, and (c) `commits_since_update` requires Bash access that the model-reviewer agent does not have.

Models created by the plugin reflect code-time (design-time) infrastructure. The review output includes: 'Runtime Validation Recommended: This model reflects code-time infrastructure. Cross-reference with cloud asset inventory, DNS logs, or network flow data to identify shadow infrastructure not visible in code.'

### Audit Trail (V1: Sign-Off Only)

For the compliance audit use case, auditors expect evidence that the model was reviewed by someone with authority. V1 captures model sign-off as a minimum:

```json
// <model-path>/.dethereal/audit_trail.json
{
  "scope_summary": "E-Commerce Platform — design-level security review, PCI-DSS + SOC2",
  "scope_confirmed_at": "2026-03-25T14:30:00Z",
  "scope_confirmed_by": "levente@dether.net",
  "model_signed_off": false,
  "sign_off_by": null,
  "sign_off_at": null,
  "discovery_method": "code_analysis + manual",
  "review_method": "guided_review"
}
```

`scope_summary` copies `system_name` and `description` from `scope.json` at sign-off time, making the audit trail self-contained (auditors should not need to cross-reference separate files). `review_method` distinguishes between `"manual_review"` (human walked through the model), `"guided_review"` (used the plugin's guided workflow), and `"auto_generated"` (model was auto-discovered and signed off without step-by-step review).

Full audit trail (review history, per-element confirmation tracking) is deferred to post-V1. Without at least sign-off metadata, models cannot be used as evidence in SOC2/PCI assessments — one of the four stated use cases.

V1 audit trail supports point-in-time assessments: model creation timestamp, scope confirmation, component sign-off. This is sufficient for SOC2 Type I and ISO 27001 initial certification evidence. SOC2 Type II and ISO 27001 surveillance audit evidence requires periodic review tracking, which depends on the platform's scheduled review workflow and is planned for V2.

### Human-in-the-Loop Checkpoints (Non-Negotiable)

1. **After auto-discovery, before import**: User reviews and confirms the discovered model
2. **Data classification**: User confirms sensitivity classifications -- never auto-classify as non-sensitive
3. **Trust boundary placement**: Plugin can suggest but not decide
4. **Control effectiveness**: User confirms whether controls are actually deployed
5. **Model sign-off**: Before analysis, user explicitly approves model as "ready"

### Deterministic Output

**Deterministic output** is a design goal. Given the same codebase and user inputs, the plugin produces structurally consistent models. Discovery is grounded in file-based code analysis (deterministic). MITRE data is cached from the platform database (not generated by the LLM). Enrichment prompts follow a fixed sequence. Non-deterministic elements (LLM classification suggestions, confidence scores) are always presented for human confirmation, never auto-applied.

---

## 7. ROI and Competitive Position

### Value by Audience

| Audience | Value | Competitor Gap |
|----------|-------|---------------|
| Developers | Threat model without leaving IDE; model from actual code context | Microsoft TMT requires manual diagramming; Threat Dragon has no code awareness |
| Security engineers | Models pre-populated from code reduce "blank page" problem by 60-70% | IriusRisk requires manual component creation |
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

Estimates are projections based on typical web application architecture (5-15 components). Actual times vary by system complexity and user expertise. Validated benchmarks will be published after V1 launch with real usage data.

---

## 8. Model Lifecycle and CI/CD

### Model Storage Strategy

Models stored at user-chosen visible paths (e.g., `./threat-models/production-stack/`), committed to version control:
- Code review includes model changes
- Git history tracks model evolution
- Branch-based model variants

### Update Triggers

| Trigger | Detection | Response |
|---------|----------|----------|
| New API endpoint | Code diff | Plugin suggests adding component |
| Dependency added/removed | package.json diff | Plugin suggests updating external entities |
| Environment variable added | .env diff | Plugin suggests checking new dependencies |
| Security boundary change | IaC diff | Plugin suggests boundary review |
| MITRE technique published | Module data update | Analysis modules re-evaluate |

### CI/CD Integration Pattern

1. On PR: export current model to split files in repo
2. Plugin analyzes code diff and suggests model changes
3. Developer reviews and approves
4. Updated model committed alongside code
5. On merge: model imported to platform for analysis

---

## 9. Priority Matrix

### Must Have for V1

| Item | Rationale |
|------|-----------|
| Structured discovery interview (shared infra, external services, credential flows) | Without these, models miss 60-70% of real attack surface |
| Confidence level tagging on discovered elements | Prevents hallucination distrust |
| Data classification prompting on every cross-boundary flow | Required for detection engineering and compliance |
| Explicit assumptions and known gaps disclosure | Non-negotiable for CISO trust |
| Human-in-the-loop review before model import | Prevents garbage-in-garbage-out |
| Goal-based modeling guidance (compliance, security review, incident prep) | Prevents over/under-modeling |
| Credential and service account flow capture | Core of lateral movement modeling |
| Six key security attributes per component | Minimum for exposure detection |
| Asset criticality tag (High/Medium/Low) | Minimum for risk quantification |
| Class selection assistance from code context | Key differentiator vs competitors |
| CI/CD pipeline as lightweight external entities | When CI/CD configs are discovered, model the pipeline as EXTERNAL_ENTITY components with basic data flows (pipeline → registry → runtime). No deep attribute enrichment required. Supply chain attacks (SolarWinds, XZ Utils) are the dominant threat trend; a V1 that excludes them entirely will be criticized by security teams |

### Improve Later

| Item | Rationale |
|------|-----------|
| Control implementation status tracking | Operational concern, not modeling |
| Regulatory requirement mapping on controls | Module extension territory |
| Log destination modeling | Can be STORE components but adds complexity |
| Evidence of control effectiveness | Issue tracker integration territory |
| Time-to-model metrics | Nice for ROI reporting |
