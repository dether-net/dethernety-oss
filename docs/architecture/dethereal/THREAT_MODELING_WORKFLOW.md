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

**Tier 1 (built-in): STRIDE-per-element.** Default for all new threat models. The plugin walks each component, boundary crossing, and data flow, systematically evaluating spoofing, tampering, repudiation, information disclosure, denial of service, and elevation of privilege.

| STRIDE Category | Platform Mapping |
|----------------|-----------------|
| Spoofing | Exposure (query: credential use, token manipulation, identity spoofing) |
| Tampering | Exposure (query: data manipulation, supply chain compromise, stored data modification) |
| Repudiation | Exposure (query: indicator removal, log tampering, defense evasion) |
| Information Disclosure | Exposure + DataItem classification (query: data collection, credential access, network sniffing) |
| Denial of Service | Exposure (query: network DoS, endpoint DoS, resource hijacking) |
| Elevation of Privilege | Exposure (query: exploitation for privilege escalation, abuse elevation mechanisms, access token manipulation) |

> This table serves as reference context for user-initiated MITRE ATT&CK browsing. The plugin does not systematically evaluate STRIDE-to-ATT&CK mappings for every component during enrichment — that systematic mapping is performed by analysis modules. During enrichment, users can browse techniques on demand via `search_mitre_attack`.

> Specific ATT&CK technique IDs are intentionally omitted from this table. The `security-enricher` agent must query the platform's `search_mitre_attack` tool using these semantic descriptions, ensuring all technique references are verified against the platform's graph database.

**Query result handling:** When `search_mitre_attack` returns more than 10 results for a broad query, the agent refines by adding component context (component type, protocol, boundary position). Present the top 5 most relevant matches with one-line descriptions. State how many additional matches exist and offer to narrow the search. The agent must never select MITRE techniques without user confirmation.

**Tier 2 (guided): PASTA.** The DFD creation workflow supports PASTA stages 2 (Technical Scope Definition) and 4 (Threat Analysis). Full PASTA orchestration — including business impact analysis (stage 1), abuse case modeling (stage 3), vulnerability analysis (stage 5), and quantitative risk assessment (stage 7) — is a future capability requiring additional data structures and external integrations.

**Tier 3 (extensible): Attack trees and VAST.** Documented as possible but not built into the initial plugin.

### Methodology State Machine

```
States: INITIALIZED → SCOPE_DEFINED → DISCOVERED → STRUCTURE_COMPLETE
        → ENRICHING → REVIEWED

Transitions:
- Forward: any state → next state (quality gate pass + user confirmation)
- Backward (manual): any state → any earlier state (explicit user request)
- Backward (automatic): structural changes at ENRICHING or later → STRUCTURE_COMPLETE
  (user warned with impact summary; enrichment on existing elements preserved, new elements flagged as unenriched)
- On any backward transition: invalidate `.dethereal/quality.json` (delete or mark stale) and clear `model_signed_off` in state.json if set (D64)
```

> D45: CLASSIFIED, DATA_ITEMS_MAPPED, and ENRICHED collapsed into a single ENRICHING state. Sub-progress within enrichment (classification rate, attribute completion, data item coverage) is tracked by the quality score formula (0-100), making discrete enrichment sub-states redundant for UX purposes. The quality score provides continuous progress visibility.

Users can leave and resume at any state. The state is tracked in `<model-path>/.dethereal/state.json`:

```json
{
  "currentState": "ENRICHING",
  "completedStates": ["INITIALIZED", "SCOPE_DEFINED", "DISCOVERED", "STRUCTURE_COMPLETE", "ENRICHING"],
  "lastModified": "2026-03-25T14:30:00Z",
  "staleElements": []
}
```

`staleElements` tracks element IDs added after the ENRICHING state was entered that have not yet been enriched. Populated by the backward transition rule (D29): when structural changes occur at ENRICHING or later, the state reverts to STRUCTURE_COMPLETE and newly added elements are added to `staleElements`. The enrichment skill prioritizes stale elements first.

### Phase-to-Step Mapping

The 7 methodology phases above describe the analytical framework. The guided workflow skill (`/dethereal:threat-model`) adds user confirmation and sync steps, producing 11 UX-level steps. The state machine tracks 6 maturity states. **This table is the canonical step label reference** — PLUGIN_ARCHITECTURE.md and USER_EXPERIENCE.md must use these exact labels.

| Methodology Phase | Guided Workflow Step | State Machine State |
|---|---|---|
| Phase 1: Scope Definition | 1. Scope Definition | SCOPE_DEFINED |
| Phase 2: Discovery & Inventory | 2. Discovery | DISCOVERED |
| — (UX confirmation) | 3. Model Review (discovery confirmation) | — |
| Phase 4: Architecture Modeling | 4. Boundary Refinement | STRUCTURE_COMPLETE |
| Phase 5: Data Flow Mapping | 5. Data Flow Mapping | ENRICHING |
| Phase 3: Component Classification | 6. Classification | ENRICHING |
| Phase 6: Data Item Classification | 7. Data Item Classification | ENRICHING |
| Phase 7: Enrichment | 8. Enrichment | ENRICHING |
| Model Validation | 9. Validation | REVIEWED |
| — (UX action) | 10. Sync | — |
| — (UX action) | 11. Post-sync linking (R6/F3) | — |

> Note: Classification (Phase 3/Step 6) occurs after boundary placement (Phase 4/Step 4) in the guided workflow because LLM-assisted class selection (ambiguous cases) benefits from seeing the component in its boundary context. However, deterministic classification (high-confidence fuzzy matches) runs early at Step 3 to pre-fill the discovery confirmation table (R6/F6). The methodology phases define the logical dependencies; the guided workflow optimizes for user experience. Steps 5-8 all operate within the ENRICHING state — sub-progress is tracked by the quality score.
>
> Step 11 (post-sync linking) only applies when the model has countermeasures. After sync, platform-computed exposures are read back and linked to countermeasures in a batch table. Without linking, the Analysis Engine's defense coverage analysis will not credit existing controls (R6/F3).

---

### Phase 1: Scope Definition

**Outputs:** Scope document with system name, description, modeling depth, compliance context, inclusions/exclusions, and crown jewels.

**User decisions:**
- What system is being modeled?
- What is the modeling intent? (initial, security review, compliance, incident response)
- What depth? (architecture-level, design-level, implementation-level)
- Regulatory drivers? Tiered support (D52): Tier 1 (full prompts): SOC2, ISO 27001. Tier 2 (data classification only): PCI-DSS, HIPAA, GDPR. Tier 3 (declared, not prompted): NIST CSF, NIS2, DORA.
- What is explicitly out of scope?
- What do you explicitly trust and choose not to model? (D49: trust assumptions — distinct from exclusions)
- Adversary classes? (optional, prompted for "security_review" and "incident_response" intents only)
  - `external` -- internet-based attackers
  - `insider` -- employees, contractors with internal access (triggers admin path and credential flow prompts)
  - `supply_chain` -- vendor/dependency compromise (triggers CI/CD and dependency chain prompts)

**Scope template** (`<model-path>/.dethereal/scope.json`):

```typescript
interface ScopeDefinition {
  system_name: string
  description: string
  depth: 'architecture' | 'design' | 'implementation'
  modeling_intent: 'initial' | 'security_review' | 'compliance' | 'incident_response'
  compliance_drivers: string[]       // e.g., ["PCI-DSS", "SOC2", "ISO 27001"]
  crown_jewels: string[]             // free-text, mapped to components during enrichment
  exclusions: string[]
  trust_assumptions: string[]        // D49: e.g., ["AWS control plane is trusted", "Physical security is out of scope"]
  adversary_classes?: string[]       // D20: for security_review/incident_response intents
}
```

**Automation:** Infer scope from working directory structure (package.json, Dockerfile, terraform/, k8s/). Propose an initial scope statement. Ask one confirming question.

**Quality gate:** Scope must name at least one asset worth protecting (crown jewel) and at least one external actor or entry point.

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
9. Architecture diagrams (screenshots via Claude vision)
10. Documentation (README, ADRs)

**Sources-checked summary (D65):** Before presenting results, show which source categories were checked and what was found or skipped. This makes omissions visible without requiring a formal error contract:

```
Sources checked: IaC/Terraform (12), Containers (3), K8s (—), CI/CD (2), Code (5), API defs (1)
```

A `(—)` indicates the source was checked but no matching files were found. If a source fails to parse (e.g., invalid HCL syntax), show: `IaC/Terraform (⚠ parse error in main.tf — 0 resources)`. The agent can explain failures in conversation.

**Confirmation model:** Present all discovered components in a single batch table. Ask: "I found N components. Are any missing? Should any be removed?" One round-trip, not N individual confirmations.

**Post-discovery interview:** After batch confirmation, the plugin consolidates blind spot coverage into a single prompt rather than sequential questions. Items already discovered (e.g., identity providers, message queues) are listed as confirmed, not re-asked:

> "Discovery found [confirmed list]. Common elements NOT found in code: network segmentation, admin access paths, backup flows, shared infrastructure (IdP, DNS, CA), external SaaS integrations, secrets management. Are any of these relevant to your system? List anything else I missed."

This reduces 4 sequential question-answer turns to 1, saving ~3 LLM round-trips. See OPERATIONAL_REQUIREMENTS.md Section 1 for the full blind spots taxonomy.

---

### Phase 3: Component Classification

**Process:**
1. Query `get_classes` for all class types from the connected platform
2. Match discovered components to available classes by name, description, and type
3. Present proposed classifications as a batch table
4. For unmatched components: use closest available class and document the gap

**When no class exists:** The plugin logs a recommendation that a custom module class be created. It never fabricates class IDs. Components without classes appear in the model but will not generate exposure detections (OPA/Rego policies evaluate against class-specific attributes).

**Quality gate:** At Step 6 exit (classification step in the guided workflow): 100% of STORE components classified and 80% overall classification rate. Crown jewel-candidate components (those matching scope-declared crown jewel names) must be tagged with `crown_jewel: true` via lightweight name matching. After classification, flag any STORE components touched by cross-boundary flows that remain unclassified — these should be classified before proceeding to enrichment.

**Crown jewel mapping (D21, D41):** Crown jewel operationalization is split across two phases:
- **Phase 3 (Classification):** Lightweight tagging — match scope-declared crown jewel names to discovered components, set `crown_jewel: true`. This enables quality gate evaluation at classification time.
- **Phase 7 (Enrichment):** Full enrichment — set `asset_criticality: high|medium|low`, confirm/adjust mappings: "You named 'Payment Database' as a crown jewel. I found component 'payment-db'. Confirming mapping and setting `asset_criticality: high`."

The `crown_jewel` boolean and `asset_criticality` attribute are component-level properties. The Analysis Engine computes full crown jewel scoring (PageRank, data sensitivity, control density) from these inputs -- the plugin provides raw signals, not the computation.

---

### Phase 4: Architecture Modeling

**Trust boundary placement heuristics:**
1. Network boundary crossing (different segments, VPCs, subnets)
2. Authentication boundary (unauthenticated to authenticated)
3. Privilege boundary (different authorization levels)
4. Organizational boundary (different teams, vendors, organizations)
5. Deployment boundary (different cloud accounts, containers, pods)
6. Data classification boundary (different sensitivity levels)

**Boundary enforcement (early enrichment exception):** For each boundary, prompt for enforcement status: "Is this boundary enforced by network controls? (Yes — explicit deny via firewall/NACLs/security groups | Partial — security groups exist but broad access | No — logical grouping only)." Store as boundary attributes `implicit_deny_enabled` and `allow_any_inbound`. Additionally, prompt for egress controls: "Does this boundary filter outbound traffic? (deny_all — explicit deny | allow_list — specific destinations allowed | allow_all — no egress filtering | unknown)." Store as `egress_filtering: "deny_all" | "allow_list" | "allow_all" | "unknown"` (D50). This is captured during architecture modeling (not deferred to enrichment) because boundary enforcement and egress filtering affect data flow analysis prioritization in Phase 5 and data exfiltration path analysis.

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

**Auth failure mode:** `auth_failure_mode: "deny" | "fallback" | "fail_open" | "unknown"`. Enrichment prompt: "When authentication fails on this flow, does the system deny access, fall back to weaker authentication, or fail open?"

> **Engine integration required (D63):** `auth_failure_mode` is captured by the plugin but the Analysis Engine V2's `_derive_auth_strength()` only reads `authType`, not `auth_failure_mode`. This creates a false-security gap: a flow with `authType: "OAuth2"` and `auth_failure_mode: "fail_open"` gets `auth_strength = 3.0` (near max) when the effective strength is zero. **This must be fixed in the engine** before analysis results on models with `auth_failure_mode` data are trustworthy. Required engine change in `_derive_auth_strength()`: `fail_open` → return `0.0` regardless of `authType`; `fallback` → halve `auth_strength`; `unknown` → flag for user clarification. Tracked as a separate engine PR against the analysis engine module.

**Credential attributes (D22):** For cross-boundary flows, the enrichment phase captures credential topology as data flow attributes:
- `credential_type: "service_account" | "api_key" | "oauth_token" | "ssh_key" | "certificate" | "password" | "none"`
- `credential_name: string` (label, e.g., "db-service-account")
- `credential_scope: string[]` (machine-comparable identifiers of other resources this credential accesses, e.g., `["db-service-account", "internal-api-key"]`)

For STORE components identified as credential repositories, capture `stores_credentials: boolean` and `credential_scope: string[]`.

Prompt: "What other resources can this credential access? List each as a short identifier so the analysis engine can detect shared credentials across flows."

Without these attributes, the Analysis Engine's lateral movement analysis degenerates to undifferentiated BFS — all paths appear equally traversable. Credential attributes are the single highest-impact enrichment for analysis quality.

**Integration mapping (D62):** The plugin writes attributes using the engine's property names directly — there is no intermediate translation layer at import time. The attribute key in the JSON file must match the engine's expected property name exactly.

| Attribute Key Written by Plugin | Value | Written On | Engine Function |
|---|---|---|---|
| `required_credentials` | `[credential_name_value]` (array of credential identifier strings) | Data flow edges | `can_traverse()` credential gating |
| `credential_scope` | `[credential_id, ...]` (array of credential identifiers yielded on compromise) | STORE nodes | `acquire_credentials()` set |
| `credential_type` | `"service_account"` \| `"api_key"` \| ... | Data flow edges | (not consumed by engine — human review only) |
| `credential_name` | `"db-service-account"` (human-readable label) | Data flow edges | (not consumed by engine — human review only) |

> **Critical (D62):** The plugin must write `required_credentials` (not `credential_name`) as the attribute key on data flow edges. The engine's `can_traverse()` reads `edge_data.get("required_credentials", [])`. If the plugin writes `credential_name` instead, credential gating never fires and lateral movement analysis degenerates to undifferentiated BFS. `credential_name` is a human-readable label stored alongside for display purposes only.

> **Semantic distinction for `credential_scope`:** On data flows, `credential_scope` is not used — flows carry `required_credentials` (what you need to traverse). On STORE nodes, `credential_scope` is a list of credential *identifiers* that an attacker acquires upon compromising that store. These identifiers must match the `required_credentials` values on flows. Example: if `payment-db` STORE has `credential_scope: ["db-admin-account"]` and a flow has `required_credentials: ["db-admin-account"]`, compromising the store enables traversal of that flow.

**Batch credential enrichment:** Credential enrichment uses a batch-first approach: present all cross-boundary flows in a table, ask the user to list their system's credentials and service accounts, then map credentials to flows automatically. This reduces round-trips from N-per-flow to 1-2 total and naturally surfaces shared credentials. Example: "What credentials or service accounts does your system use? I'll map them to flows and check for shared credentials automatically."

**Handle selection:** STORE components support only left/right handles. Other components support all four. The plugin must prevent handle conflicts on bidirectional flows (different handle pairs for each direction).

**Quality gate:** Every component should have at least one data flow. External entities should have flows crossing at least one boundary.

---

### Phase 6: Data Item & Sensitivity Classification

**Data item sources:**
- API specs: request/response bodies, auth headers
- Database schemas: table structures, PII columns
- Code: JWT payloads, session data, cached values
- Regulatory requirements: HIPAA -> PHI flows, PCI-DSS -> cardholder data

**Assignment:** Data items link to flows and components via `dataItemIds`. Each item can span multiple flows, representing the data lifecycle through the system.

**Data sensitivity vocabulary:** Data items use the platform's four-level sensitivity scale: `public`, `internal`, `confidential`, `restricted`. Regulatory labels (PII, PHI, PCI cardholder data) are captured as separate regulatory flags on the data item, not as sensitivity levels. Default regulatory-to-sensitivity mapping: HIPAA PHI → `restricted`, PCI cardholder data → `restricted`, GDPR personal data → `confidential` minimum, SOX financial data → `confidential` minimum.

Data items may carry multiple regulatory flags simultaneously. The sensitivity level is the maximum of all applicable regulatory mappings. For example, a patient billing record may carry both `regulatory_flags: ['PHI', 'PCI_cardholder']` with sensitivity `restricted`. The compliance-driven control checklist (OPERATIONAL_REQUIREMENTS.md Section 5) evaluates each flag independently.

**Quality gate:** Every flow carrying sensitive data that crosses a trust boundary must have at least one classified data item. Crown jewel data stores must have classified data items.

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
2. Default to the more conservative security interpretation (unencrypted until proven encrypted, unauthenticated until proven authenticated)
3. Never silently assume -- every assumption is stated and documented
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
| Service mesh configs | Controls + flows | mTLS, service routes |

### Architecture Diagram Discovery

The plugin uses Claude's multimodal capabilities to analyze screenshots of architecture diagrams:
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
  suggestedClass?: { id: string; name: string }
  existenceConfidence: 'high' | 'medium' | 'low'
  classificationConfidence: 'high' | 'medium' | 'low'
  sources: Array<{
    type: 'terraform' | 'kubernetes' | 'dockerfile' | 'openapi' | 'code' | 'diagram' | 'manual'
    file: string
    line?: number
    resource?: string
  }>
}
```

Persisted in `<model-path>/.dethereal/discovery.json` for review and incremental re-runs.

**Provenance Sanitization:** Discovery output must never include actual secret values from environment variables, connection strings, or config files. Record only variable names and file references:
- Good: "Discovered from environment variable `REDIS_URL` in `.env.example`"
- Bad: "Discovered from `REDIS_URL=redis://prod-cache.internal:6379`"

Add `.dethereal/discovery.json` to the suggested `.gitignore` — provenance metadata should not be committed to version control. Only the confirmed model files should be versioned.

---

## 4. Component Classification

### Classification Flow

Classification uses a two-pass approach (R6/F6):

**Pass 1 — Deterministic (at Step 3, during discovery confirmation):**
1. Query `get_classes(action: 'classify_components')` with `{ name, type, description, discovery_source }`. The MCP tool performs deterministic fuzzy matching against the IaC mapping table and class definitions, returning `{ component_name, suggested_class_id, confidence, alternatives[] }` (D51).
2. High-confidence matches (exact IaC mapping or unambiguous type match) are pre-filled in the discovery confirmation table, so users see *"Redis Cache (STORE / Key-Value Store)"* rather than *"Redis Cache (STORE / unclassified)"* when confirming discovered components.

**Pass 2 — LLM-assisted (at Step 6, after boundary refinement):**
3. Low-confidence and unmatched items are flagged for LLM-assisted reasoning — the agent uses component context (boundary position, connected flows) to propose classifications.
4. Present batch table of remaining unclassified + any user-adjusted items. User confirms or adjusts.

> D51: Deterministic classification saves 3,000-5,000 tokens per classification run by eliminating LLM reasoning over ~300 comparisons (12 components x 25 classes). Running Pass 1 at Step 3 (instead of deferring everything to Step 6) additionally improves boundary refinement decisions because component classifications are visible during Step 4. If `get_classes` requires platform connectivity and the platform is offline, Pass 1 is skipped and all classification happens at Step 6.

### Class Inventory (from dethernety-module)

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

A data flow crosses a trust boundary when source and target are in different boundaries. The plugin computes this from the structure:

```
Data flow "User Request" crosses 2 boundaries:
  Internet Zone -> DMZ -> Application Tier
This is a high-priority flow for security analysis.
```

Flows crossing zero boundaries = lower priority for security annotation.
Flows crossing 2+ boundaries = highest priority.

### Credential and Service Account Flows

The plugin explicitly prompts for credential flows because they drive lateral movement analysis:

- "What credential is used for this data flow?"
- "What else can that credential access?"
- "Which components share the same service account?"

### Operational Flows Often Missed

The plugin prompts for these commonly missed flows:
- Administrative access (SSH, RDP, web console)
- Monitoring and logging (SIEM, metrics, tracing)
- Backup and disaster recovery
- DNS resolution
- Certificate management
- CI/CD pipeline access

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
- ATT&CK Tactics (14), Techniques (~600+), Mitigations
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
  -> Plugin writes exploitedBy references to exposure
```

**ID validation short-circuit:** When the user provides a specific technique ID (matching `^T\d{4}(\.\d{3})?$`), skip search and ranking — use `search_mitre_attack(action: 'technique', attack_id: '...')` directly. Present the technique details for confirmation. This saves one MCP tool call and one ranking reasoning pass per direct ID reference. Direct ID references are common in security_review and incident_response contexts where the user already knows the relevant techniques.

---

## 8. Model Quality and Completeness

### Three-Tier Quality Gates

**Gate 1: During Creation (advisory)**

Inline warnings during conversational modeling:
- Component without class assignment
- Data flow without name
- Boundary containing only one component
- External entity in same boundary as internal components
- Data flow crossing trust boundaries without security controls

**Gate 2: Before Sync (blocking for sync)**

Must pass before `import_model` or `create_threat_model`:
- Manifest completeness (name, description, module references)
- Structure validity (at least one boundary, one component)
- Reference integrity (all data flow source/target IDs exist)
- At least one data flow exists
- No orphaned attribute files

**Gate 3: Before Analysis (blocking)**

Must pass before submitting for AI analysis:
- All components have class assignments
- At least 80% of components have attributes set
- All trust boundary crossings reviewed
- Data items classified for sensitive data flows
- At least one cross-boundary data flow exists (ensures analysis has something to evaluate)

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

All factors are normalized to the range 0.0-1.0 before multiplication. Rate factors (`component_classification_rate`, etc.) are computed as ratios (e.g., classified_components / total_components). When a denominator is zero (e.g., `total_components = 0` during early scope definition, or `total_cross_boundary_flows = 0` for models without trust boundaries), the rate is 0.0 — not NaN or undefined.

`control_coverage_rate`: percentage of classified components that have at least one DTControlClass control assigned via the platform.

`credential_coverage_rate`: percentage of cross-boundary data flows with `credential_type` set (not `"none"`).

**boundary_hierarchy_quality** is computed as a continuous score. Each of three conditions contributes 0.33 to the factor, summing to 1.0:
- Hierarchy depth >= 2: +0.33
- No boundary contains only one child: +0.33
- No external entities share a boundary with internal components: +0.33

> Previous ternary scoring (10/5/0) was ambiguous ("which two-of-three combinations yield 5?") and created a 7.5-point cliff effect that penalized valid architectures (e.g., a DMZ containing only a WAF is architecturally correct but scored 0 on the single-child condition).

| Score Range | Label | Meaning |
|------------|-------|---------|
| 0-39 | Starting | Model creation in early stages |
| 40-69 | In Progress | Model taking shape, continue enrichment |
| 70-89 | Good | Suitable for analysis |
| 90-100 | Comprehensive | Full coverage |

Analysis readiness: minimum 70 required. Quality score >= 70 is necessary but not sufficient for analysis readiness. Gate 3 includes structural checks (trust boundary crossing review, cross-boundary data flow existence) that are pass/fail requirements independent of the numeric score.

**Quality computation:** The quality score is computed deterministically by the MCP server via `validate_model_json(action: 'quality')`. The `model-reviewer` agent calls this tool and receives the structured score breakdown, then presents and interprets the results. This keeps the computation deterministic (not LLM-dependent) and the agent's role limited to presentation.

**Post-action footer:** Mutating skills compute only the "after" score (absolute, not delta): `[done] Classification complete. Quality: 56/100.` The cached score from `.dethereal/quality.json` provides the "before" reference if needed. This halves MCP tool calls per mutation compared to computing both before/after scores.

**Mapping vs. Analysis Quality (D23):** The plugin's quality score and the Analysis Engine's `model_completeness` score measure different things: the plugin measures structural completeness (mapping concern), while the engine measures analysis readiness (includes dimensions like `components_with_exposures` that the plugin cannot compute). These scores should be displayed side-by-side, not merged. The table above shows approximate alignment — the engine's scope confirmation phase performs its own readiness assessment at analysis launch time.

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

```
Model Readiness Report: "E-Commerce Platform"
===============================================

Structural Completeness: PASS
  Components: 12/12 connected
  Data flows: 18 (no orphans)
  Boundaries: 4 (hierarchical, no empty)

Analysis Readiness: PARTIAL (72%)
  Classified components: 10/12 (83%) -- PASS
  Attributes populated: 8/10 (80%) -- WARNING
  Crown jewels classified: 3/3 -- PASS
  Data items on sensitive flows: 6/8 -- WARNING

Recommended Next Steps:
  1. Classify "Legacy API Gateway"
  2. Fill attributes for "Payment Service"
  3. Add data items to "User Session" flow
  4. Consider adding admin access flows (none modeled)
```

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

After discovery confirmation (Step 3), if the validated inventory exceeds complexity thresholds, the plugin recommends decomposition. The recommendation is **advisory, never blocking**.

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

> **Important:** The platform's graph-based analysis algorithms (PageRank, weighted shortest path, dominator trees, blast radius, crown jewel scoring) operate within a single model's graph. They do NOT traverse `REPRESENTS_MODEL` edges. Cross-model attack paths are invisible to graph algorithms. The copilot module has partial cross-model awareness (reads findings from referenced model analyses as LLM context), but this is LLM-mediated reasoning, not graph-traversal analysis.

**Implications for decomposition:**

- Each model should contain at least one entry point (external entity) AND at least one crown jewel, or path analysis is trivially empty.
- Shared infrastructure components (IdP, DNS, logging) should be duplicated as external entities in each model that depends on them.
- The review phase flags: *"N components reference external models. Attack paths through these components are not included in this model's analysis."*

**Longer-term platform fix (not plugin scope):** The Analysis Engine could support a `cross_model_analysis` mode that constructs a unified graph by following `REPRESENTS_MODEL` edges. The data is in the graph database; the query needs to follow the edge. This is a platform concern, not a plugin concern.

#### Discovery Cache

Discovery results are written to `.dethernety/discovery-cache.json` after the first model creation. Subsequent `/dethereal:discover` invocations check cache freshness (file mtime vs. codebase changes) and reuse the cached inventory when current. This saves 15-25K tokens per subsequent model in a multi-model project.

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
2. Start model 2 in a new session. During Step 4 (boundary refinement), the plugin prompts for `representedModel` links to existing platform models using `getNotRepreseningModels(modelId)`.
3. Repeat for model N.

**Token economics:** For systems above ~20-25 components, multi-model is cheaper in practice because single-model sessions hit context window degradation. The break-even point: a 30-component system costs roughly the same total tokens as 1 or 3 models (~275-410K), but multi-model keeps each session within the proven 150-200K ceiling.

### Cross-System References

The `representedModel` field on components and boundaries enables composite modeling:
- A component in System A's model references System B's model via `REPRESENTS_MODEL` relationship
- The platform resolves cross-references for the copilot's composite model awareness
- During Step 4 (boundary refinement), the plugin prompts: "Does this system interact with any existing platform models?" and lists linkable models

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

See OPERATIONAL_REQUIREMENTS.md Section 2, "Six Key Attributes Per Component" for the canonical attribute list with sub-detail (SSO/federation, certificate pinning, centralized logging, service accounts). The enrichment phase uses that list as its prompt source.

**Batch enrichment per component:** Present all six attributes as a pre-filled table per component with conservative defaults, and ask the user to confirm or correct in one round. This reduces 6 prompt-response cycles to 1 per component (72 total cycles to 12 for a 12-component model). Example:

```
For Redis Cache, I've set conservative defaults. Please correct any inaccuracies:

| Attribute            | Default         | Notes                    |
|----------------------|-----------------|--------------------------|
| Authentication       | password        | Inferred from config     |
| Encryption in transit| none            | No TLS config found      |
| Encryption at rest   | none            |                          |
| Logging              | none            |                          |
| Access control       | shared password |                          |
| Log telemetry        | none            |                          |

Confirm or correct? (yes / correct 2,3 to update specific rows)
```

Additionally, `monitoring_tools: string[]` may be captured per component (see OPERATIONAL_REQUIREMENTS.md Section 2, Monitoring Coverage). This is not a V1 quality gate input but informs analysis-side detection feasibility scoring.
