---
name: enrich
description: Populate security attributes, MITRE ATT&CK references, credentials, and monitoring tools
agent: security-enricher
argument-hint: "[tier1|all|pick] [--focus credentials|monitoring|compliance]"
---

Enrich a Dethernety threat model with security attributes, credential topology, MITRE ATT&CK technique references, compliance-driven data classification, and monitoring tool coverage.

## Prerequisites

1. **Resolve model path** using the Model Resolution Protocol
2. If no model exists, suggest `/dethereal:create` first and stop
3. Read model files from disk: `structure.json`, `dataflows.json`, `data-items.json`
4. Read all existing attribute files from `attributes/` directory
5. Read `.dethereal/scope.json` for crown jewels and compliance drivers
6. Read `.dethereal/state.json` for current workflow state
7. **Classification check**: Compute classification rate from model files. If < 80% overall OR any STORE elements are unclassified, suggest `/dethereal:classify` first (advisory, not blocking). Unclassified STOREs are the highest-impact gap — data sensitivity analysis depends on STORE classification

## Steps

### 1. Parse Arguments

**Scope** (which components to enrich):
- `tier1` — crown jewels only (fastest, highest-value enrichment)
- `all` — all components in tier order (default if no argument)
- `pick` — present full component list for manual selection

**Focus** (which enrichment sub-workflow to run):
- `credentials` — credential inventory and mapping only
- `monitoring` — monitoring tools capture only
- `compliance` — compliance-driven prompts only
- No focus flag → run all enrichment sub-workflows

### 2. Check Stale Elements

Read `state.json.staleElements[]`. If non-empty, these are elements added since the last enrichment (via `/dethereal:add` while in ENRICHING state). Prioritize stale elements by inserting them at the top of their respective tiers during tier computation.

Show: "N elements added since last enrichment. These will be enriched first."

After enrichment of stale elements is confirmed and written, remove their IDs from `staleElements[]` in `state.json`.

### 3. Compute Enrichment Tiers (D43)

Analyze model structure to assign each component to a tier:

- **Tier 1**: Components with `crown_jewel: true` in attributes
- **Tier 2**: Components participating in cross-boundary data flows (source or target in a different boundary than the component)
- **Tier 3**: Components in DMZ or internet-facing boundaries (boundaries containing flows from EXTERNAL_ENTITY sources)
- **Tier 4**: All remaining internal-only components

Assign each component to its **highest-priority** (lowest-numbered) matching tier. A crown jewel that is also cross-boundary is Tier 1, not Tier 2.

Present tier summary:
```
Enrichment scope: N components
  Tier 1 (crown jewels):    2 — payment-db, user-db
  Tier 2 (cross-boundary):  5 — api-gateway, auth-service, ...
  Tier 3 (internet-facing): 2 — web-server, cdn
  Tier 4 (internal):        4 — worker, scheduler, ...

Processing: all tiers in order. Confirm? (yes / tier1 only / pick)
```

### 4. Class-Template-Driven Attribute Enrichment

For each classified component in scope (batched by tier):

1. **Read existing attribute file** — the stub created by `generate_attribute_stubs` during classification contains template field names with null values (or schema defaults). These null fields ARE the enrichment checklist — every null field must be resolved to a concrete value
2. **Read class guide from cache** — read `.dethereal/class-cache/<class-id>.json` (populated by `generate_attribute_stubs` during classification). The cache contains the JSON Schema `template` and configuration `guide`. If the cache file is missing for a class, fall back to `mcp__dethereal__get_classes(class_id: '<class-id>', fields: ['attributes', 'guide'])`
3. **Discover attribute values using the guide** — the guide's `how_to_obtain` entries tell you where to find each value:
   - Search code, IaC, and config files for attribute values (e.g., `postgresql.conf` for `ssl = on`, Terraform for `tls_enabled`)
   - Use grep/read tools to find concrete evidence
   - Record the source of each discovered value for the rationale column
4. **Ask the user for undiscoverable attributes** — for attributes not found in code, ask targeted class-specific questions using the guide's `option_description` and `security_impact`:
   - Group questions by component to minimize round-trips
   - Use the guide's suggested values where available
5. **Set all template attributes** — every field defined by the class template must have a value. No template field left as `null` after enrichment
6. **Merge** discovered values into the existing attribute file — preserve plugin-enrichment fields (`crown_jewel`, `credential_scope`, `mitre_attack_techniques`, `monitoring_tools`)

Present as a batch confirmation table per tier:
```
## Proposed Enrichment — Tier 1 (Crown Jewels)

| # | Component | Class | Attribute | Current | Proposed | Source |
|---|-----------|-------|-----------|---------|----------|--------|
| 1 | payment-db | Database | ssl_enabled | null | true | postgresql.conf |
| 2 | payment-db | Database | password_encryption | null | scram-sha-256 | pg_hba.conf |
| 3 | payment-db | Database | log_connections | null | true | postgresql.conf |
| ...

Apply these changes? (yes / modify / skip)
```

Write confirmed attributes to `attributes/components/<id>.json` using read → merge → write.

**For unclassified components:** If a component has no assigned class (classification was skipped or no suitable class exists), skip template-driven enrichment for that component. Note it in the summary: "N components skipped — unclassified (no class template available)."

### 5. Credential Enrichment (D22, D62)

Follow the batch-first credential protocol:

**Step 4a — Credential inventory prompt:**
```
What credentials and service accounts does your system use?
List all: service accounts, API keys, database credentials, certificates, shared secrets.

Example format:
- db-admin-account (PostgreSQL service account, used by API Server and Worker)
- api-gateway-key (API key for external gateway)
- tls-cert-internal (mTLS certificate for service-to-service)
```

**Step 4b — Map credentials to flows:**
For each credential, identify which data flows use it. Present mapping as batch table:

```
## Credential Mapping

| # | Credential | Type | Flow(s) | Shared? |
|---|-----------|------|---------|---------|
| 1 | db-admin-account | service_account | API Server → PostgreSQL, Worker → PostgreSQL | YES (2 flows) |
| 2 | api-gateway-key | api_key | Client → API Gateway | no |

Apply mapping? (yes / modify)
```

Write to `attributes/dataFlows/<id>.json`:
- `required_credentials: ["db-admin-account"]` — **this is the engine key (D62)**
- `credential_name: "PostgreSQL service account"` — human-readable label
- `credential_type: "service_account"` — category

**Step 4c — STORE credential scope:**
For each STORE component, if it holds credentials:
- Write `stores_credentials: true`
- Write `credential_scope: ["credential-id-1", "credential-id-2"]` — identifiers must match `required_credentials` values on flows

**Step 4d — K8s Secret analysis (SO-4):**
If `.dethereal/discovery.json` shows K8s sources were scanned, check for shared Secrets:
- Identify Secrets mounted in multiple workloads
- Pre-populate credential inventory with shared credentials
- Flag: "SECRET 'db-credentials' is mounted in 3 workloads: api-server, worker, migration-job"

### 6. Data Item Classification

For each boundary-crossing flow without classified data items:

1. Prompt: "What data types flow across [flow name]? (PII, credentials, financial, health, session, none)"
2. Apply regulatory-to-sensitivity mapping:
   - PHI (HIPAA) → `restricted`
   - PCI cardholder → `restricted`
   - GDPR personal data → `confidential`
   - PII (general) → `confidential`
3. Create data items in `data-items.json` with `sensitivity` and `regulatory_flags` fields
4. Link to flows via `dataItemIds`

**Quality gate**: Every flow carrying sensitive data crossing a trust boundary must have at least one classified data item. Crown jewel data stores must have classified data items.

If the quality gate fails:
```
Data item gap: N boundary-crossing flows and M crown jewel stores lack classified data items.
  - Flow: "API Server → Database" (crosses Internal → Data Tier boundary)
  - Store: "payment-db" (crown jewel, no data items)
Classify now or skip? (classify / skip)
```
If the user skips, proceed with a warning but do not block.

### 7. Compliance-Driven Enrichment Prompts (D52)

Read `compliance_drivers` from `.dethereal/scope.json`:

**Tier 1 (SOC2, ISO 27001)** — Framework-specific attribute prompts:
- SOC2: CC6.1 (access control), CC6.7 (encryption in transit), CC7.2 (monitoring)
- ISO 27001: A.8.2 (asset classification), A.10.1 (crypto controls), A.12.4 (logging)

**Tier 2 (PCI-DSS, HIPAA, GDPR)** — Data classification prompts only:
- PCI-DSS: "Does [component] process, store, or transmit cardholder data?"
- HIPAA: "Does [component] handle protected health information (PHI)?"
- GDPR: "Does [component] process personal data of EU residents?"

**Tier 3 (NIST CSF 2.0, NIS2, DORA)** — Declared only, no specific prompts:
```
NIST CSF / NIS2 / DORA declared as compliance driver. V1 does not generate framework-specific
prompts for these frameworks. Recorded in scope for documentation purposes.
```

### 8. Auth Failure Mode (D48, D63)

For each authenticated cross-boundary flow, prompt:
"When authentication fails on this flow, does the system: **deny**, **fallback** (weaker auth), **fail_open**, or **unknown**?"

Write `auth_failure_mode` to `attributes/dataFlows/<id>.json`.

**Inline warnings** for dangerous modes:
```
WARNING: Flow "API Server → Database" has auth_failure_mode: fail_open.
This path may be exploitable when the auth service is unavailable.
```
```
WARNING: Flow "Auth Service → API Server" has auth_failure_mode: fallback.
This path degrades to weaker authentication when the primary auth mechanism fails.
```

**Known Gap callout** (show once per session):
```
Known Gap: auth_failure_mode is captured for enrichment and human review, but the Analysis
Engine V2 does not currently incorporate it into edge weight computation. Flows marked
fail_open or fallback may appear more secure than they are in analysis results (D63).
```

### 9. Monitoring Tools (D66)

For each component, prompt:
"What monitoring tools cover [component]? (SIEM, EDR, NDR, APM, Cloud-native, None)"

Write `monitoring_tools: string[]` to component attribute files.

```
V1: monitoring_tools captured for human review only. No engine integration.
```

### 10. Crown Jewel Full Enrichment (D21, D41)

For components with `crown_jewel: true` (tagged during classification):
1. Prompt for `asset_criticality: "high" | "medium" | "low"`
2. Confirm: "Component 'payment-db' tagged as crown jewel. Confirming asset_criticality: high. Adjust?"
3. Write `asset_criticality` to component attribute file

### 11. Boundary Enforcement (D50)

Check existing `attributes/boundaries/<id>.json` files. For boundaries **missing** enforcement attributes (not captured during architecture modeling or the guided workflow), prompt for them. Skip boundaries that already have these attributes populated.

```
## Boundary Enforcement

| # | Boundary | Implicit Deny? | Any Inbound? | Egress Filtering |
|---|----------|---------------|-------------|-----------------|
| 1 | DMZ | yes | no | allow_list |
| 2 | Internal Network | no | yes | allow_all |
| 3 | Data Tier | yes | no | deny_all |

Confirm? (yes / modify)
```

Write to `attributes/boundaries/<id>.json`:
- `implicit_deny_enabled: boolean`
- `allow_any_inbound: boolean`
- `egress_filtering: "deny_all" | "allow_list" | "allow_all" | "unknown"`

Flag unenforced boundaries:
```
WARNING: Boundary "Internal Network" has no implicit deny and allows any inbound.
Components within are reachable from adjacent boundaries.
```

### 12. MITRE ATT&CK Integration (D30)

During enrichment, identify relevant ATT&CK techniques for components based on type and boundary position. Follow the **3-step verification protocol** — never generate technique IDs from memory:

1. **Search** — use `mcp__dethereal__search_mitre_attack` with descriptive queries (e.g., "credential theft", "lateral movement"). Never guess IDs.
2. **Validate** — confirm each candidate with `mcp__dethereal__search_mitre_attack(action: 'technique', attack_id: '...')`. Regex: `^T\d{4}(\.\d{3})?$`. Drop any ID that fails validation.
3. **Persist** — only write verified IDs to the model. For each technique, check D3FEND countermeasures via `mcp__dethereal__get_mitre_defend`.

Present techniques in batch table for confirmation before persisting.

### 13. State Transition

After the first confirmed enrichment batch is written to attribute files:

Update `.dethereal/state.json`:
- `currentState`: `ENRICHING`
- `completedStates`: add `STRUCTURE_COMPLETE` (include current state in completed list)
- `lastModified`: current timestamp

If already in `ENRICHING`, stay there — re-running enrich is additive.

### 14. Validate and Footer

Call `mcp__dethereal__validate_model_json` to check structural validity.

```
[done] Enriched N components (M attributes, K credentials mapped, J data items classified). Quality: X/100.
      Template coverage: A/B classified components fully enriched (100% template fields set), C partially enriched, D unenriched. E unclassified (skipped).
[next] /dethereal:review (quality assessment) or /dethereal:enrich --focus credentials (continue specific enrichment)
```
