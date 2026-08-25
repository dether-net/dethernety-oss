---
name: surface
description: Attack surface summary with component breakdown, trust boundary crossings, and control gap analysis
agent: model-reviewer
context: fork
argument-hint: "[directory-path]"
---

Produce a structured attack surface summary for a Dethernety threat model. This is a read-only skill — no model files are modified. Shows structural data, control gaps, and platform-computed exposures if the model is synced.

## Prerequisites

1. **Resolve model path** using the Model Resolution Protocol
2. If no model exists, suggest `/dethereal:create` first and stop
3. Read model files from disk: `manifest.json`, `structure.json`, `dataflows.json`, `data-items.json`
4. **Empty model guard**: If `structure.json` has 0 components, show: "Model has no components. Run `/dethereal:discover` or `/dethereal:add` to populate the model first." Stop.
4. Read attribute files from `attributes/` directory (components, dataFlows, boundaries)
5. Read `.dethereal/state.json` for current workflow phase

## Steps

Render every section below as a markdown table/tree in the conversation — the attack-surface summary is the deliverable, not a preamble to a modal. Information that lands only inside an `AskUserQuestion` label cannot be reviewed or scrolled back to.

### 1. Component Breakdown

Read `structure.json` and recursively traverse the boundary hierarchy. Count components by type (PROCESS, STORE, EXTERNAL_ENTITY) per boundary.

```
### Components (N total)
| Boundary | PROCESS | STORE | EXTERNAL_ENTITY | Total |
|----------|---------|-------|-----------------|-------|
| DMZ | 2 | 0 | 0 | 2 |
| Internal | 3 | 2 | 0 | 5 |
| External | 0 | 0 | 2 | 2 |
```

### 2. Trust Boundary Crossings

Identify all data flows where source and target are in different boundaries. For each crossing:
- Determine the source and target boundary names
- Read attribute files for `encryption_in_transit`, `authentication`, and `auth_failure_mode` status
- Read boundary attribute files for enforcement posture (`implicit_deny_enabled`, `egress_filtering`)
- Count encrypted vs. total and authenticated vs. total per boundary pair

```
### Trust Boundary Crossings (K flows)
| From → To | Flow Count | Encrypted | Authenticated | Enforcement |
|-----------|------------|-----------|---------------|-------------|
| External → DMZ | 2 | 2/2 TLS | 1/2 | enforced |
| DMZ → Internal | 3 | 3/3 mTLS | 3/3 | enforced |
| Internal → Data | 2 | 1/2 | 2/2 | logical only |
```

Annotate flows where `auth_failure_mode` is `fail_open` — these appear authenticated but provide no security guarantee on failure. Display boundary enforcement as "enforced" (implicit_deny + egress filtering) or "logical only."

Highlight any unencrypted, unauthenticated, or fail-open cross-boundary flows — these are high-priority control gaps.

### 3. Exposure Counts

Check `manifest.model.id` to determine if the model has been synced to the platform.

**If synced:** Call `mcp__plugin_dethereal_dethereal__get_control_gaps(model_id: '<id>')` — that is the only model-wide exposure route. `manage_exposures(action: 'list')` **requires** an `element_id` and rejects a call without one (it has no model-id parameter at all), so it can only be used for per-element drill-down after this call identifies which elements to inspect. Group the returned exposures by component. Display:
```
### Exposures
  N exposures across M components.
  Top affected: <component-name> (K exposures)
```

**If not synced:**
```
### Exposures
  Model not synced — push to platform for exposure analysis.
  Run /dethereal:sync push to publish.
```

### 4. Control Coverage & Gap Analysis

This step produces a two-tier coverage report: inferred coverage (from enrichment attributes) and formal coverage (from assigned controls). When the model is synced, it additionally integrates MITRE-chain-grounded gap analysis from the platform.

#### 4a. MITRE-Grounded Gap Analysis (synced models)

**If model is synced** (`manifest.model.id` is set and non-null):

1. Call `mcp__plugin_dethereal_dethereal__get_control_gaps(model_id)` for MITRE-chain-grounded gap analysis
2. If the call succeeds, present:
   - **Unmitigated exposures** grouped by element — addressable gaps where MITRE ATT&CK Mitigations exist and installed modules have matching ControlClasses
   - **Unaddressable exposures** — no installed ControlClass covers these MITRE mitigations (module gap)
   - **Recommended controls** — type-compatible candidates with D3FEND technique links and `addressesCount`
   - **Configured but non-matching** — `configuredCoverage` count: controls assigned to the element but addressing different techniques
   - **No MITRE chain** — `noMitreChain` count: "N exposures have no ATT&CK technique mapping and cannot be analyzed through the framework chain"
3. If the call fails (auth expired, network error): fall back to local file inspection in 4c below

```
### MITRE-Grounded Gap Analysis
  N unmitigated exposures (addressable), M unaddressable (module gap), K with no MITRE chain.

  Unmitigated:
    api-server: SQL Injection (T1190 → M1016 Vulnerability Scanning)
    payment-db: Data Manipulation (T1565 → M1041 Encrypt Sensitive Info)

  Recommended Controls:
    1. WAF Protection — addresses 3 techniques, D3FEND: D3-WSAA
    2. DB Encryption (PG) — addresses 2 techniques, D3FEND: D3-DENCR

  Unaddressable (module gap — no installed ControlClass):
    scheduler: Resource Hijacking (T1496 → M1047)
```

**If model is not synced:**
Skip this section. Gap analysis requires platform exposure data.

#### 4b. Inferred Coverage (from enrichment attributes)

Call `mcp__plugin_dethereal_dethereal__validate_model_json(action: 'coverage', directory_path: <model-path>)` to compute the per-category inferred coverage breakdown.

```
### Inferred Coverage (from enrichment attributes)

| Protection | Coverage | Missing |
|------------|----------|---------|
| Authentication | 10/12 (83%) | scheduler, batch-worker |
| Encryption in transit | 8/10 cross-boundary flows (80%) | internal→data-tier, worker→queue |
| Encryption at rest | 3/4 stores (75%) | session-cache |
| Monitoring | 6/12 (50%) | scheduler, batch-worker, config-svc, ... |

Note: Inferred from component attributes. Sufficient for security posture review;
insufficient for compliance evidence. Run /dethereal:enrich to fill gaps.
```

#### 4c. Formal Control Coverage (from assigned controls)

Present the per-tier breakdown from the coverage tool output. Each component is assigned to its **highest-priority matching tier only** (a crown jewel that is also cross-boundary appears only in Tier 1):

- **Tier 1:** Crown jewels (`crownJewel: true` in `structure.json`)
- **Tier 2:** Cross-boundary components (source or target of cross-boundary flows)
- **Tier 3:** Internet-facing components (connected to EXTERNAL_ENTITY via data flow)
- **Tier 4:** Internal-only components

```
### Formal Control Coverage (from assigned controls)

| Tier | Components | With Controls | Gap |
|------|------------|---------------|-----|
| 1 — Crown Jewels | 3 | 2 (67%) | payment-db |
| 2 — Cross-boundary | 4 | 1 (25%) | api-gw, auth-svc, msg-queue |
| 3 — Internet-facing | 2 | 2 (100%) | — |
| 4 — Internal | 3 | 0 (0%) | scheduler, batch-worker, config-svc |
| **Total** | **12** | **5 (42%)** | **7 components without formal controls** |

Formal coverage required for: SOC2 CC6.1, ISO 27001 A.8, PCI-DSS 6.x.
Run /dethereal:enrich --focus controls to assign controls.
```

If no classified components have controls: "No formal controls assigned. Run `/dethereal:enrich --focus controls` to assign controls."

When presenting gap recommendations (from `get_control_gaps`): the rows are per-(Control, ControlClass) — multiple rows naming related ControlClasses for the same mechanism may be satisfied by ONE multi-class Control (one `classes[]` entry per class), not one Control per row. See the grouping rule in controls-enrichment.md.

#### 4d. Control Source Breakdown (when populated)

If any controls have a `source` field, present the verification status:

```
### Control Verification Status

| Source | Controls | Note |
|--------|----------|------|
| Discovered (verified in code/IaC) | 8 | Full confidence — implementation confirmed |
| Declared (user-asserted) | 5 | Assumed effective, unverified |
| Both (discovered + declared) | 2 | Highest confidence — governed and verified |
```

Omit this section if no controls have `source` field.

#### 4e. Governance Controls (when declared)

Read `.dethereal/scope.json`. If `declared_governance_controls` is populated, list them:

```
### Governance Controls (declared)
  - Patch management: monthly patching cycle
  - Access reviews: quarterly
  - Change control: CAB approval required for production
```

Omit this section entirely if `declared_governance_controls` is empty or absent.

### 5. MITRE ATT&CK Coverage

Tactic coverage is derived from `Exposure.exploitedBy` — MITRE techniques populated by OPA policies during platform analysis. The plugin does not maintain a separate client-side technique annotation (see [BACKEND_DELEGATION §3](../../../../docs/architecture/dethereal/BACKEND_DELEGATION.md#mitre-tactic-coverage-derivation)).

**If synced and exposures returned by §3:** Aggregate the `exploitedBy[].attack_id` values across every exposure fetched in §3. Deduplicate. Determine which of the 14 Enterprise ATT&CK tactics are covered:

1. Reconnaissance, 2. Resource Development, 3. Initial Access, 4. Execution, 5. Persistence, 6. Privilege Escalation, 7. Defense Evasion, 8. Credential Access, 9. Discovery, 10. Lateral Movement, 11. Collection, 12. Exfiltration, 13. Command and Control, 14. Impact

Derive tactic names from technique IDs (e.g., T1566 → Initial Access). If a mapping is uncertain, resolve it via `mcp__plugin_dethereal_dethereal__search_mitre_attack(action: 'technique', attack_id)`. Display covered vs. not covered:

```
### MITRE ATT&CK Coverage (platform-derived)
  Techniques mapped: N (from M exposures across K elements)
  Tactics covered (X/14): Initial Access, Lateral Movement, Credential Access
  Tactics not covered: Reconnaissance, Resource Development, Execution, Persistence,
    Privilege Escalation, Defense Evasion, Discovery, Collection, Exfiltration,
    Command and Control, Impact
```

**If synced but no exposures returned** (analysis has not run, or modules emit no exposures for this model):
```
### MITRE ATT&CK Coverage
  No exposures — analysis has not produced technique mappings yet.
  Run an analysis to generate exposures (or install a module with policies
  that cover this model's components).
```
To run one: `manage_analyses` follows a create → run → status (poll) → results contract.
```
```

**If not synced:**
```
### MITRE ATT&CK Coverage
  Model not synced — push to platform and run an analysis for MITRE tactic coverage.
  Run /dethereal:sync push, then an analysis via `manage_analyses`
  (create → run → status → results).
```

### 6. Credential Topology

Summarize credential usage across the model:
- Cross-boundary flows with `required_credentials` attributes
- STORE components with `stores_credentials: true`
- Shared credentials: same credential value appearing on multiple flows (flag credential blast radius)

```
### Credential Topology
  K flows with credentials, J shared credentials
  Credential blast radius: db-admin (used by 3 flows across 2 boundaries)
  Credential stores: PostgreSQL, Redis (stores_credentials: true)
```

If no credential data: "No credential mappings. Run `/dethereal:enrich --focus credentials` to map credential topology."

### 7. Detection Coverage

Check attribute files for `monitoring_tools` data. List components where `monitoring_tools` is empty or unset — these are SOC blind spots with no SIEM/EDR/NDR visibility.

```
### Detection Coverage
  Monitored: N components (SIEM: K, EDR: J, NDR: M)
  Blind spots: <component-1>, <component-2> (no monitoring tools configured)
```

If no components have `monitoring_tools` data: "No monitoring data. Run `/dethereal:enrich` to configure monitoring tools per component."

### 8. Cross-Model Gap Detection

Check `structure.json` for components or boundaries with `representedModel` references. If found, display the cross-model gap warning:

```
### Cross-Model Analysis Boundaries
  N components reference external models. Attack paths through these
  components are not included in this model's analysis.
```

If `credential_scope` values in attribute files reference credentials that also appear in other locally available models (check `.dethernety/models.json`), warn about cross-model credential reuse.

If no cross-model references, omit this section.

### 9. Footer

```
[done] Surface analysis complete. <N> components, <K> boundary crossings, <J> control gaps.
[next] /dethereal:enrich (fill control gaps) or /dethereal:sync push (publish for exposure analysis)
```
