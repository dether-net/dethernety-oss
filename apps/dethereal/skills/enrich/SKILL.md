---
name: enrich
description: Populate security attributes, MITRE ATT&CK references, credentials, and monitoring tools
agent: security-enricher
argument-hint: "[tier1|all|pick] [--focus credentials|monitoring|compliance|controls] [--pick <element-id>]"
---

@../../docs/controls-enrichment.md

Enrich a Dethernety threat model with security attributes, credential topology, MITRE ATT&CK technique references, compliance-driven data classification, and monitoring tool coverage.

## Implementation Discipline

Use built-in tools and the Dethereal MCP tools — do NOT shell out to inspect or aggregate model state. The model directory is a normal JSON tree; reading it through Bash with `cat`/`head`/`tail` or `for` loops loses structure (truncated JSON), bypasses the validator, and produces a fragmentary picture of one slice instead of an authoritative pass/fail across the model.

| Operation | Tool to use |
|-----------|-------------|
| Inspect a single attribute file | `Read` (one call per file; multiple Reads in parallel) |
| Search for a field across attribute files | `Grep` with the field name and `attributes/` path |
| Aggregate model-readiness score (NOT a per-field breakdown) | `mcp__plugin_dethereal_dethereal__validate_model_json(action: 'quality', directory_path)` |
| Aggregate control coverage / gaps | `mcp__plugin_dethereal_dethereal__validate_model_json(action: 'coverage', directory_path)` |
| Schema validation | `mcp__plugin_dethereal_dethereal__validate_model_json(action: 'validate', directory_path)` |
| Discover the template schema for a class | `mcp__plugin_dethereal_dethereal__get_classes(class_id, fields: ['attributes', 'guide'])` (or `.dethereal/class-cache/<class-id>.json` if present) |
| Write enrichment results | `Write` (full file) or `Edit` (targeted change) |
| Match elements to classes | `mcp__plugin_dethereal_dethereal__match_classes` |

**Do not:**
- Run `for f in attributes/...; do head -N "$f"; done` to "check progress" — `head -N` truncates JSON arbitrarily, so a field below the cutoff is indistinguishable from an absent one. Use `Read` on the whole file, or `Grep` across `attributes/`. Note that `validate_model_json(action: 'quality')` will NOT answer this: it returns an aggregate score and weighted factors, never a per-element or per-field list. The unresolved-field checklist is the null fields in the attribute file itself (Step 4.1).
- Sample attribute files via `cat`/`head`/`tail` to assess what's filled in — `Read` returns the entire file, and `Grep` answers presence questions across the tree without truncation.
- Write Python or shell scripts to walk `attributes/` — the validator already does this and returns a structured result.

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
- `--pick <element-id>` — target a single element by id, skipping the interactive selector. Used by the drift orchestrator after a CHANGED-substrate or CHANGED-attribute-only delta item; functionally equivalent to `pick` followed by selecting `<element-id>`. If the id does not resolve in the model, surface "element <id> not found" and stop. **Combined forms:** if the user passes both `pick` (positional) and `--pick <id>` (flag), the flag wins and the interactive selector is skipped — they're not contradictory, the flag just makes the selection explicit. If the user passes `tier1` or `all` together with `--pick <id>`, the flag wins (the targeted form has higher specificity than the scope keyword).

**Focus** (which enrichment sub-workflow to run):
- `credentials` — credential inventory and mapping only
- `monitoring` — monitoring tools capture only
- `compliance` — compliance-driven prompts only
- `controls` — control assignment pass only (3-step: enforcement → detection → governance)
- No focus flag → run all enrichment sub-workflows (excluding controls — controls require explicit `--focus controls`)

### 2. Check Stale Elements

Read `state.json.staleElements[]`. If non-empty, these are elements added since the last enrichment (via `/dethereal:add` while in ENRICHING state). Prioritize stale elements by inserting them at the top of their respective tiers during tier computation.

Show: "N elements added since last enrichment. These will be enriched first."

After enrichment of stale elements is confirmed and written, remove their IDs from `staleElements[]` in `state.json`.

**Adversary-driven prompt gating.** Read `adversary_classes` and `trust_assumptions` from `.dethereal/scope.json`. These scope inputs change which prompts are skippable in this run:
- `insider` declared → the admin-access-path prompts and the shared-credential questions (Step 5) are REQUIRED — do not let the user skip them; an insider review without admin/credential coverage is mislabeled.
- `supply_chain` declared → the CI/CD pipeline and dependency/registry prompts are REQUIRED.
- Echo `trust_assumptions` once at the start of enrichment ("Per scope, trusting: …") so deliberately-excluded areas are visible in the session record.

### 3. Compute Enrichment Tiers (D43)

Analyze model structure to assign each component to a tier:

- **Tier 1**: Components with `crownJewel: true` in `structure.json`
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

For each classified component **and classified data item** in scope (batched by tier — a data item inherits the highest tier of the elements that handle it):

1. **Read existing attribute file** — the stub created by `generate_attribute_stubs` during classification contains every template field name with a `null` value — schema `default`s are deliberately NOT seeded, because a default is authoring metadata rather than an observation about this element. These null fields ARE the enrichment checklist — every null field must be resolved to a concrete value
2. **Read class guide from cache** — read `.dethereal/class-cache/<class-id>.json` (populated by `generate_attribute_stubs` during classification). The cache contains the JSON Schema `template` and configuration `guide`. If the cache file is missing for a class, fall back to `mcp__plugin_dethereal_dethereal__get_classes(class_id: '<class-id>', fields: ['attributes', 'guide'])`
3. **Discover attribute values using the guide** — the guide's `how_to_obtain` entries tell you where to find each value:
   - Search code, IaC, and config files for attribute values (e.g., `postgresql.conf` for `ssl = on`, Terraform for `tls_enabled`)
   - Use grep/read tools to find concrete evidence
   - Record the source of each discovered value for the rationale column
4. **Ask the user for undiscoverable attributes** — for attributes not found in code, ask targeted class-specific questions using the guide's `option_description` and `security_impact`:
   - Group questions by component to minimize round-trips
   - Use the guide's suggested values where available
5. **Set all template attributes** — every field defined by the class template must have a value. No template field left as `null` after enrichment
6. **Merge** discovered values into the existing attribute file — preserve plugin-enrichment fields (`credential_scope`, `monitoring_tools`, and `crown_jewel` on **non-component** elements only: data items, boundaries and data flows have no first-class `crownJewel` in `structure.json`, so the attribute-file key is their real home. On components it is a derived copy — `structure.json` `crownJewel` is authoritative there.)

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

Write confirmed attributes to `attributes/components/<id>.json` (or `attributes/dataItems/<id>.json` for data items) using read → merge → write.

**Per-tier persistence (crash boundary):** write each tier's confirmed attributes to disk before starting the next tier — never batch all tiers into one terminal write. If this run is interrupted, completed tiers survive and a resumed pass picks up from the null fields that remain.

**Declined fields:** when the user explicitly declines to answer a field, write the template's documented unknown/default value instead of leaving `null` — a resumed pass treats `null` as "not yet asked" and would re-prompt.

**Offline fallback:** if both the class-cache read and the `get_classes` fallback fail (platform down, no cache), skip template-driven enrichment for that class and note it in the summary: "platform-unreachable — template unavailable" (same disposition as unclassified).

**Six-attribute floor:** after template-driven enrichment, verify the Six Key Attributes are set on every in-scope component regardless of what its class template covers. For any the template did not cover, prompt for it. Surface reports (encryption/auth coverage) assume these are universally captured — a template that omits one must not silently produce a blind spot.

| # | Concept | Attribute key | Written on | Value the scorer accepts |
|---|---------|---------------|------------|--------------------------|
| 1 | Authentication | `authentication_type` | component | **string** — e.g. `oauth2`, `mtls`, `sso`. `"none"` does not count. `basic`/`digest` count only when `encryption_in_transit` is a non-deprecated string |
| 2 | Encryption in transit | `encryption_in_transit` | **data flow** (and component where meaningful) | **string** — e.g. `TLS 1.3`. Rejected: `none`, `sslv3`, `ssl v3`, `tls 1.0`, `tls1.0` |
| 3 | Encryption at rest | `encryption_at_rest` | component | **string** — e.g. `AES-256`. Rejected: `none`, `des`, `3des`, `triple-des`, `rc4` |
| 4 | Logging | *(no scored key)* | — | Capture per the class template; nothing reads a floor-level key for this one |
| 5 | Access control | `implicit_deny_enabled` | component (boundaries too, but only the component value is scored) | **boolean `true`** |
| 6 | Log telemetry | `monitoring_tools` | component | **`string[]`**, non-empty after discarding `none`/`n/a`. Never `["None"]` — use `[]` |

Write the exact key names above. `control_coverage_rate` (20% of the quality score) and the surface report's encryption/auth coverage read these literal keys and no others, so a semantically-equivalent name a class template happens to use (`transit_encryption_enforced`, `tls_enabled`, …) does NOT satisfy the floor. Types are strict: a boolean `true` for `encryption_at_rest` scores as absent — these want the concrete algorithm/version string.


**For unclassified components and data items:** If an element has no assigned class (classification was skipped or no suitable class exists), skip template-driven enrichment for that element (the six-attribute floor above still applies to unclassified components). Note it in the summary: "N elements skipped — unclassified (no class template available)."

### 5. Credential Enrichment (D22, D62)

Follow the flow-anchored credential protocol. Credentials are the single highest-impact enrichment for analysis quality (`required_credentials` drives `can_traverse()`), and a cold "list all your credentials" brain-dump reliably misses the shared service accounts that ARE the lateral-movement story — so anchor the questions to the flows.

**Step 4a — Flow-anchored credential capture:**
Enumerate the cross-boundary flows (already computed during tiering) and ask per flow, batched in one table:
```
For each of these cross-boundary flows: what credential authenticates it,
and what ELSE does that credential reach?

| # | Flow | Credential (id or "none"/"unknown") | Also used by |
|---|------|--------------------------------------|--------------|
| 1 | API Server → PostgreSQL | db-admin-account | Worker → PostgreSQL |
| 2 | Client → API Gateway | api-gateway-key | — |
```
Then sweep for credentials no flow surfaced: "Any service accounts, API keys, certificates, or shared secrets not tied to the flows above? (e.g. break-glass accounts, CI deploy keys)"

**Step 4b — Map credentials to flows:**
Consolidate the per-flow answers into the credential → flows mapping. Present as batch table:

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

A data item is a *type* of data (PII, credentials, card data, session tokens …), not a per-location copy. Model each one **once** in `data-items.json`, then link it via `dataItemIds` to **every element that handles it across its lifecycle** — not just the flows that carry it:

- **Origin / sink** — the `EXTERNAL_ENTITY` (or `PROCESS`) where the data enters or leaves the system (e.g. user-originated PII on the `User` external entity).
- **In transit** — the `DATA_FLOW`s that carry it across boundaries.
- **In use** — the `PROCESS` components that read, transform, or cache it.
- **At rest** — the `STORE` components that persist it (databases, caches, object stores, queues).
- **In scope** — the `SECURITY_BOUNDARY`s that contain or handle it (e.g. an OS host or namespace processing the data).

For each sensitive data type not yet classified and fully linked:

1. Identify the elements that handle it across the lifecycle above. Prompt: "Which elements originate, carry, process, store, or contain [data type]? (PII, credentials, financial, health, session, none)"
2. Apply the canonical regulatory flag → sensitivity-floor mapping. Emit the flags **exactly as written** — the platform's `dataInRegulatoryScope` query matches case-sensitively, and the canonical set is maintained in `THREAT_MODELING_WORKFLOW.md`:
   - `PCI cardholder` → `restricted`
   - `PHI` → `restricted`
   - `GDPR personal` → `confidential` (special-category data → `restricted`)
   - `PII` → `confidential`
   - `SOX financial` → `confidential`
   - `CCPA personal` → `confidential`
3. Create data items in `data-items.json` with `sensitivity` and `regulatory_flags` fields
4. **Classify the data items against platform DATA classes** — for every new or still-unclassified data item, call `mcp__plugin_dethereal_dethereal__match_classes(elements: [{name, description}, ...], classLabel: 'DATA', moduleIds: [...], topN: 3)`. Auto-accept `exact_name` matches; present `fuzzy`/`vector`/`type` matches for confirmation. Write confirmed `classData` onto the items in `data-items.json`. If no suitable DATA class exists in active modules, leave the item unclassified and note it in the summary
5. **Generate attribute stubs** — call `mcp__plugin_dethereal_dethereal__generate_attribute_stubs(directory_path)`. It writes `attributes/dataItems/<id>.json` template stubs for the newly classified data items. Step 4 has already run by this point, so fill these new stubs **now**, applying the same template-driven loop (class guide from cache or `get_classes`, discover from code, ask for the rest, no `null` left) — do not defer them to a future enrich run
6. Link each data item via `dataItemIds` on **every** handling element — its origin external entity/process, the flows that carry it, the components that process or store it, and the boundaries that contain it. `dataItemIds` is valid on components (all types), data flows, and boundaries.

**Quality gate**: Every flow carrying sensitive data crossing a trust boundary must have at least one classified data item; every crown jewel data store must have classified data items; every data origin (the external entity or process where sensitive data enters the system) must reference its data item; every PROCESS that reads, transforms, or caches a sensitive data item must reference it via `dataItemIds`; and the boundary containing a crown-jewel data item must reference it. The gate covers all five lifecycle stages — under time pressure the "in use" process links are the first to drop, and an unlinked process carries no sensitivity signal for information-disclosure analysis.

If the quality gate fails:
```
Data item gap: N boundary-crossing flows, M crown jewel stores, and P data origins lack classified data items.
  - Flow: "API Server → Database" (crosses Internal → Data Tier boundary)
  - Store: "payment-db" (crown jewel, no data items)
  - Origin: "User" (external entity, originates PII — no data items)
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
"What monitoring tools cover [component]? (SIEM, EDR, NDR, APM, Cloud-native — or none)"

Write `monitoring_tools: string[]` to component attribute files. **No monitoring → empty array `[]`; never the string `"None"`** — coverage treats a non-empty array as "monitored", so a `["None"]` sentinel masks a blind component.

```
V1: monitoring_tools captured for human review only. No engine integration.
```

### 10. Crown Jewel Full Enrichment (D21, D41)

For components with `crownJewel: true` in **`structure.json`** (tagged during classification):

> Spelled `crownJewel` deliberately: `/dethereal:classify` writes it to `structure.json` and declares that the single source of truth. The snake_case `crown_jewel` that may sit in an attribute file is a derived/legacy copy classification does not write — on a correctly-classified model it is absent, so selecting on it would match nothing. This is the same set Step 3 computes as Tier 1.

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

1. **Search** — use `mcp__plugin_dethereal_dethereal__search_mitre_attack` with descriptive queries (e.g., "credential theft", "lateral movement"). Never guess IDs.
2. **Validate** — confirm each candidate with `mcp__plugin_dethereal_dethereal__search_mitre_attack(action: 'technique', attack_id: '...')`. Regex: `^T\d{4}(\.\d{3})?$`. Drop any ID that fails validation.
3. **Persist** — only write verified IDs to the model. For each technique, check D3FEND countermeasures via `mcp__plugin_dethereal_dethereal__get_mitre_defend`.

Present techniques in batch table for confirmation before persisting.

**Offline:** if `search_mitre_attack` is unreachable, skip technique annotation silently and continue — it is optional (D30), and tactic coverage is derived server-side from analysis exposures.

### 13. State Transition

After the first confirmed enrichment batch is written to attribute files:

Update `.dethereal/state.json`:
- `currentState`: `ENRICHING`
- `completedStates`: add `STRUCTURE_COMPLETE` (include current state in completed list)
- `lastModified`: current timestamp

If already in `ENRICHING`, stay there — re-running enrich is additive.

### 14. Validate and Footer

Call `mcp__plugin_dethereal_dethereal__validate_model_json` to check structural validity.

```
[done] Enriched N components (M attributes, K credentials mapped, J data items classified). Quality: X/100.
      Template coverage: A/B classified components fully enriched (100% template fields set), C partially enriched, D unenriched. E unclassified (skipped).
[next] /dethereal:review (quality assessment) or /dethereal:enrich --focus credentials (continue specific enrichment)
```

---

### Control Pass (`--focus controls`)

> This section activates ONLY when `--focus controls` is specified. Skip entirely otherwise.
> Full instructions are in `@docs/controls-enrichment.md`.

The control pass is a **separate agent invocation** with its own 40-turn budget. It does NOT run as part of the default enrichment flow. Users must explicitly request it.

**Invocation:** Spawn `Agent(security-enricher)` with control-pass context.

**Three-step sequence:**

1. **Enforcement controls (Category 2)** — batched per boundary:
   - Platform reachable: call `mcp__plugin_dethereal_dethereal__manage_controls(action: 'rank', element_types: [...])`, present pre-ranked table, user confirms
   - Platform unreachable: greenfield prompts, `{ id: null, name: "..." }` format
   - B=0: single global enforcement prompt
   - B>6: tiered prompt — crown-jewel boundaries first
   - Write to `structure.json` after each boundary (incremental persistence)

2. **Detection controls (Category 3)** — one global prompt:
   - Pre-populate from `monitoring_tools` attribute data
   - Source: `discovered` for pre-populated, `declared` for user-added

3. **Governance placeholder (Category 4)** — single prompt:
   - Free-text to `.dethereal/scope.json` as `declared_governance_controls`

**Incremental persistence:** Write to `structure.json` after each boundary. If the agent hits its turn limit, partial progress is preserved.

**State:** No state transition — the control pass operates within the existing `ENRICHING` state.

**Footer:**
```
[done] Control pass complete. N enforcement, M detection, K governance controls assigned. Quality: X/100.
[next] /dethereal:review (quality assessment) or /dethereal:sync push (publish to platform)
```

---

### Control Library Attribute Enrichment (`--focus controls`, continuation)

> Runs AFTER the three-step control pass above. Pulls per-Control state from the platform into `controls/<id>.json` files, identifies classes with sparse per-instance attributes, and queues operator-confirmed edits via the engine's two-write rule (CL §8).

This step only executes when there is at least one `controls[]` entry with a non-null `id` (controls that exist on the platform). Name-only refs (`id: null`) are deferred to `/dethereal:sync push` where `manage_controls(action: 'list', name)` resolves them.

> **Boundary note.** `/dethereal:sync pull` (L4.5) auto-materialises `controls/<id>.json` for every Control referenced in the freshly-pulled structure/dataflows. So when this step runs immediately after a fresh pull, the `pull-controls` call below is largely a no-op (engine returns early per-id when the local file matches platform state). The pull-controls call is still required because `--focus controls` enrichment may run *after* operator edits, where the local files may have diverged from platform state and need reconciliation.

#### Step 1 — Pull

Enumerate the non-null control IDs referenced in `structure.json` (boundaries, components) and `dataflows.json` (flows). Collapse duplicates.

```
mcp__plugin_dethereal_dethereal__manage_controls(
  action: 'pull-controls',
  directory_path: <modelDir>,
  control_ids: [ <id1>, <id2>, ... ]
)
```

The engine performs three batched GraphQL calls in parallel (`getControlsByIds` + `getControlInstantiationAttributes` + `getControlsAssignedModels`) and writes `<modelDir>/controls/<id>.json` for each. Each file materialises with `lifecycle: 'brownfield'`, `attributes == platformAttributes`, and `pendingEdit` absent.

Surface one status line: `Pulled N controls into controls/`.

#### Step 2 — Identify Sparse Classes

For each `controls/<id>.json`, iterate `classes[]`. For every class entry:

1. Fetch the ControlClass template via `mcp__plugin_dethereal_dethereal__get_classes(class_id: '<classId>', fields: ['attributes', 'guide'])` (reuse `.dethereal/class-cache/<classId>.json` when present — the template rarely changes).
2. Compute `sparse_keys = template.properties.keys() - Object.keys(entry.attributes)`.
3. Record the per-Control summary.

Render one row per Control (not per class — consolidate when a Control has multiple classes):

```
Control library attribute coverage:

  Control                              Class (N entries)                     Status
  ───────────────────────────────────  ────────────────────────────────────  ──────────────
  Azure Firewall (MCE/MCETest Hub)     Firewall Policy (1)                   5 sparse keys
  NSG Least-Privilege Ingress          Network Access Control (2)            0 sparse keys  (skip)
  TLS 1.3 (API Gateway)                TLS Config (1)                        3 sparse keys

Enrich 8 sparse attributes across 2 Controls? (yes / pick / skip)
```

Controls with zero sparse keys are skipped automatically — no further prompts.

#### Step 3 — Edit

For each Control-class pair with sparse keys, apply the same evidence → ask pattern used by the main enrichment flow:

1. Search code / IaC for evidence using the template `guide.how_to_obtain` entries.
2. For remaining undiscoverable keys, ask the operator in a batched table (group by Control, not by key).
3. For each operator-confirmed change, call:

   ```
   mcp__plugin_dethereal_dethereal__manage_controls(
     action: 'set-local-edited',
     directory_path: <modelDir>,
     control_id: <controlId>,
     class_idx: <index into classes[] — 0-based>,
     new_attributes: { <key>: <value>, ... },   // only the changed keys
     edited_by: 'agent'
   )
   ```

**Do NOT edit `controls/<id>.json` directly with `Write`/`Edit`.** The MCP action enforces the §4 two-write rule: `pendingEdit.previousAttributes` captures the FIRST pre-edit value and is never overwritten by subsequent edits within the same pending-edit lifecycle. Bypassing the engine corrupts the intent baseline that `/dethereal:sync` push uses for conflict detection.

#### Step 4 — Annotate

After all edits are written, read every `controls/<id>.json` that now has a `pendingEdit` block and identify which ones will be shared at push time (`platformState.assignedModelCount > 1`). Emit a passive annotation — NOT a blocking prompt (per CL §8):

```
[!] Pending shared-edits: 2 controls will trigger a shared-ownership prompt at
    /dethereal:sync push: Azure Firewall (MCE/MCETest Hub) [Firewall Policy],
    NSG Least-Privilege Ingress [Network Access Control].
```

If no shared-ownership prompts will fire, skip the annotation entirely.

##### Post-edit drift sweep (defensive)

Belt-and-braces check: re-read every `controls/<id>.json` touched in this pass. For each `classes[idx]`, if `JSON.stringify(attributes) !== JSON.stringify(platformAttributes)` AND `pendingEdit` is absent, the file is in an "external-edit-like" state — `attributes` diverges from the platform snapshot but no engine-recorded baseline exists. The Step 3 flow should never produce this state (`set-local-edited` always populates `pendingEdit.previousAttributes`); detection here means either an out-of-band write happened mid-pass or a pre-existing drift survived from before the enrich invocation.

Emit the same hint the status skill renders, parallel wording:

```
[!] Drift detected on 1 control after enrichment:
    Azure Firewall (MCE/MCETest Hub) [Firewall Policy] — local attributes diverge
    from platformAttributes with no pendingEdit baseline.
    Recover with: /dethereal:sync promote-external-edit <controlId> <classId>
```

Do not auto-correct or block; the operator decides whether to promote the divergence as a real external edit (`promote-external-edit`) or hand-revert the file. Skip silently when no drift is detected.

##### Pre-footer integrity check

If platform reachability was confirmed during this pass (any `manage_controls` action returned successfully), count the `controls[]` entries written by this pass with `id: null` versus entries with a non-null `id`. If the null count exceeds the non-null count AND any element with a `null` entry has an assigned class, surface a warning before the footer:

```
[warn] N control references written as {id: null} despite the platform being reachable
       and elements having assigned classes. These will be created as name-only Controls
       (no ControlClass binding) on the next /dethereal:sync push, and the analysis engine
       cannot derive countermeasures from them. To bind them to ControlClasses, use the
       file-first greenfield path: write controls/<temp-id>.json with lifecycle: "greenfield"
       and one classes[] entry per applicable ControlClass id.
```

This is advisory, not blocking — the operator may have legitimate reasons (e.g. a control without a matching ControlClass in any active module). Skip silently when the count condition is not met.

#### Footer (when attribute enrichment ran)

```
[done] Control pass complete. N enforcement, M detection, K governance controls assigned.
       Attribute enrichment: P controls updated, Q keys edited across R classes.
[next] /dethereal:sync push (publish edits; operator will be prompted for shared controls)
       /dethereal:status (inspect pending edits and lifecycle distribution)
```
