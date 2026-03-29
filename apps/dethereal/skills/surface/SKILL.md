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

**If synced:** Call `mcp__dethereal__manage_exposures(action: 'list')` with the model ID. Group exposures by component. Display:
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

### 4. Control Gap Analysis

For each classified component, check if it has associated security controls in its attribute file (non-empty `controls` array or linked countermeasures). Components without controls are gaps.

Group gaps by enrichment tier. Assign each component to its **highest-priority matching tier only** (a crown jewel that is also cross-boundary appears only in Tier 1):
- **Tier 1:** Crown jewels (`crown_jewel: true` in attribute file) — highest priority
- **Tier 2:** Cross-boundary components (source or target of cross-boundary flows from Step 2)
- **Tier 3:** Internet-facing components (connected to EXTERNAL_ENTITY via data flow)
- **Tier 4:** Internal-only components

```
### Control Gaps
  Components without controls:
    Tier 1: payment-db (crown jewel — high priority)
    Tier 2: api-gateway (cross-boundary)
    Tier 3: web-frontend (internet-facing)
    Tier 4: scheduler (internal)
```

If all components have controls: "No control gaps — all classified components have controls."

### 5. MITRE ATT&CK Coverage

Scan attribute files for `mitre_attack_techniques` references. Collect all mapped technique IDs and determine which of the 14 Enterprise ATT&CK tactics are covered:

1. Reconnaissance, 2. Resource Development, 3. Initial Access, 4. Execution, 5. Persistence, 6. Privilege Escalation, 7. Defense Evasion, 8. Credential Access, 9. Discovery, 10. Lateral Movement, 11. Collection, 12. Exfiltration, 13. Command and Control, 14. Impact

Derive tactic names from technique IDs (e.g., T1566 → Initial Access). Display covered vs. not covered:

```
### MITRE ATT&CK Coverage
  Techniques mapped: N
  Tactics covered (M/14): Initial Access, Lateral Movement, Credential Access
  Tactics not covered: Reconnaissance, Resource Development, Execution, Persistence,
    Privilege Escalation, Defense Evasion, Discovery, Collection, Exfiltration,
    Command and Control, Impact
```

If components have no MITRE mappings because they are unenriched (no attribute files or empty `mitre_attack_techniques`), note: "N components unenriched — tactic coverage may be incomplete. Run `/dethereal:enrich` to add technique mappings."

If no MITRE mappings at all: "No MITRE ATT&CK techniques mapped. Run `/dethereal:enrich` to add technique mappings."

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
