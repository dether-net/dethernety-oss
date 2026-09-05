---
title: 'Review and Attack Surface Analysis'
description: 'Quality review, attack surface summary, and platform analysis integration'
category: 'documentation'
position: 8
navigation: true
tags: ['dethereal', 'review', 'quality', 'attack-surface', 'analysis']
---

# Review and Attack Surface Analysis

Two read-only commands help you assess your model's completeness and your system's security posture. Neither modifies model files.

---

## Quality Review (`/dethereal:review`)

The review command produces a quality dashboard showing how complete your model is and what gaps remain.

### Full Review Mode

```
> /dethereal:review
```

#### Quality Score

The headline number is a 0-100 score measuring model completeness (not system security):

```
Quality: 78/100 (Good)
```

Score labels: **Starting** (0-39), **In Progress** (40-69), **Good** (70-89), **Comprehensive** (90-100). Analysis readiness requires 70+.

#### Factor Breakdown

All 7 factors with their weights and contributions:

```
Factor Breakdown
| Factor                    | Score | Weight | Contribution |
|---------------------------|-------|--------|-------------|
| Component classification  | 100%  | 25     | 25.0        |
| Attribute completion      |  80%  | 20     | 16.0        |
| Boundary hierarchy        | 100%  | 15     | 15.0        |
| Data flow coverage        |  90%  | 15     | 13.5        |
| Data classification       |  60%  | 10     |  6.0        |
| Control coverage          |  20%  | 10     |  2.0        |
| Credential coverage       |  10%  |  5     |  0.5        |
```

#### Quality Gate Evaluation

Three progressive gates:

```
Quality Gates
  Gate 1 (Creation):  PASS — all advisory checks clear
  Gate 2 (Sync):      PASS — structure valid, references intact
  Gate 3 (Analysis):  FAIL — attribute completion at 60% (requires 80%)
```

**Gate 1 (Creation, advisory):** Flags issues without blocking — missing classifications, unnamed flows, single-component boundaries, external entities inside internal boundaries, cross-boundary flows without security controls.

**Gate 2 (Sync, blocking):** Must pass before `/dethereal:sync push` — manifest completeness, structure validity (>= 1 boundary, 1 component, 1 data flow), reference integrity, no orphaned attribute files.

**Gate 3 (Analysis, blocking):** Must pass for meaningful analysis — 100% component classification, >= 80% attribute completion, all trust boundary crossings reviewed, data items classified for sensitive flows, >= 1 cross-boundary data flow.

#### Common Gaps Checklist

Eight frequently missing elements, checked against your model:

```
Common Gaps
- [x] Administrative access paths
- [ ] Monitoring/logging flows
- [ ] Backup/recovery flows
- [x] Trust boundary crossings have data flows
- [ ] External dependencies (CDN, DNS, CA, registries)
- [x] Human actors (developers, operators, support)
- [ ] Bidirectional flows (request + response)
- [ ] Error/fallback paths
```

Detection is heuristic — the plugin scans flow names and descriptions for relevant patterns (e.g., "SSH", "admin", "backup", "monitor").

#### Top Issues

The 3 most impactful gaps, ranked by severity:

```
Top Issues
1. [Critical] 2 components have no class assigned (Cache, Worker)
2. [Warning]  Database has no attribute file — security properties unknown
3. [Info]     No data items defined — data sensitivity cannot be assessed
```

#### Analysis Readiness

Three assessment states:

| State | Criteria | Meaning |
|-------|----------|---------|
| **PASS** | Quality >= 70, all Gate 3 criteria met | Ready for platform analysis |
| **PARTIAL** | Quality 40-69, or >= 70 with Gate 3 failures | Analysis possible but results will have gaps |
| **FAIL** | Quality < 40 or Gate 2 failures | Structural issues must be resolved first |

If quality is >= 70 and Gate 3 passes but control and credential coverage are both 0%:

> Your model is structurally ready for analysis, but analysis quality will improve significantly with credentials (for lateral movement paths) and controls (for defense coverage gaps).

#### Discovery Basis

If the model was created through discovery, a one-line provenance summary:

```
Model based on: code analysis (10 components) + manual (2). Known gaps: 3.
```

Plus a standing recommendation:

> Runtime Validation Recommended: This model reflects code-time infrastructure. Cross-reference with cloud asset inventory, DNS logs, or network flow data to identify shadow infrastructure not visible in code.

#### Cross-Model Gap Detection

If the model references external models (via `representedModel` links), a warning:

```
2 components reference external models. Attack paths through these
components are not included in this model's analysis.
```

If the same credential appears in multiple local models:

```
Credential "db-admin" is used in both "API Layer" and "Data Platform".
Lateral movement analysis cannot trace credential reuse across model boundaries.
```

#### Zoning Coherence (Advisory)

If your model carries [trust zoning](MODEL_CONCEPTS.md#trust-zones-planes-domains-and-conduits), the review rolls up its **zoning coherence** — a set of advisory findings that check whether your declared segmentation hangs together. They are **always advisory**: they inform you and **never** block a sync or fail a quality gate.

```
Zoning Coherence (advisory)
  [info] external-ingress: DMZ reaches Data Tier with no approved channel
  [info] unclassified:      "Legacy Gateway" has no zone (defaults to INTERNAL)
  [info] under-protected:   Data Tier holds an asset but resolves INTERNAL
```

The six findings:

| Finding | Meaning | Typical fix |
|---------|---------|-------------|
| `unclassified` | A boundary has no zone anywhere up its chain and falls back to the default `INTERNAL`. | Set its zone (or a declaring ancestor's) at Step 4. |
| `under-protected` | A boundary holding an asset directly resolves looser than `RESTRICTED`. | Declare it `RESTRICTED`, or confirm the asset placement is intended. |
| `mgmt-plane` | A `MANAGEMENT` plane resolves to an exposed tier — an admin surface sitting where the internet can reach it. | Segment the management plane behind a stricter boundary. |
| `external-ingress` | An external-tier boundary reaches a trusted tier with no approved channel declared. | Ratify the crossing as an approved channel, or remove the flow. |
| `flow-channel` | A risk-bearing crossing diverges from its declared conduit (undeclared path, dead intent, or an unreviewable declaration). | Reconcile the flow and its approved channel — declare, remove, or add a justification. |
| `cross-tier-domain` | A shared `domains` tag couples an externally-reachable boundary with a protected one — a co-tenancy / blast-radius shape. Fires only when you hand-author matching tags. | Review whether the exposed and protected segments should share that domain. |

Zoning records *declared design intent* — the platform records it but does not verify or enforce it. These findings surface where the modeled reality diverges from what you declared. For setting zones and approved channels, see the platform guide [Boundary Trust Zones](../BOUNDARY_TRUST_ZONES.md); for where zoning is ratified during modeling, see the [Guided Workflow](GUIDED_WORKFLOW.md).

---

### Structure-Only Mode

```
> /dethereal:review --structure-only
```

A lightweight validation without quality scoring. Useful for catching errors before enrichment.

#### What It Checks

8 structural checks, each reported as `[PASS]`, `[FAIL]`, or `[WARN]`:

```
Structural Validation: Payment API

Checks:
  [PASS] Required fields present
  [PASS] ID uniqueness (14 elements, 0 duplicates)
  [FAIL] Reference integrity: 1 flow references missing component
    - Flow "cache-read" references target "old-redis" (not found)
  [WARN] 1 orphaned component: "Legacy Gateway" (no data flows)
  [PASS] No empty boundaries
  [PASS] No orphaned attribute files
  [PASS] No component/class type mismatches
  [PASS] Schema validation passed

Result: 1 failure, 1 warning. Fix reference integrity before sync.
```

1. **Required fields** — manifest has name and description, structure has boundaries, dataflows has flows
2. **ID uniqueness** — no duplicate IDs across all model files
3. **Reference integrity** — all data flow source/target IDs exist in structure.json
4. **Orphaned components** — components with no inbound or outbound data flows (warning)
5. **Empty boundaries** — boundaries with no child components or sub-boundaries (warning)
6. **Orphaned attribute files** — attribute files whose element ID no longer exists (warning)
7. **Component/class type mismatch** — a component whose `type` disagrees with the component type its assigned class describes, e.g. a `STORE` bound to a class written for a `PROCESS` (warning). This is a real defect, not a cosmetic one: the class's policy evaluates against a thing it does not describe. Fix it by correcting either the component type or the class assignment. The check needs a cached class template, so it is skipped for classes not present in `.dethereal/class-cache/`
8. **Schema compliance** — full schema validation against the platform schema

---

## Attack Surface Analysis (`/dethereal:surface`)

The surface command produces a structured overview of your system's attack surface — where the security boundaries are, what's exposed, and where controls are missing.

```
> /dethereal:surface
```

### 1. Component Breakdown

Components grouped by boundary and type:

```
Components (9 total)
| Boundary        | PROCESS | STORE | EXTERNAL_ENTITY | Total |
|-----------------|---------|-------|-----------------|-------|
| External        | 0       | 0     | 2               | 2     |
| DMZ             | 2       | 0     | 0               | 2     |
| Internal        | 3       | 0     | 0               | 3     |
| Data Tier       | 0       | 2     | 0               | 2     |
```

### 2. Trust Boundary Crossings

Flows where source and target are in different boundaries, with encryption and authentication status:

```
Trust Boundary Crossings (6 flows)
| From → To          | Flow Count | Encrypted   | Authenticated | Enforcement  |
|---------------------|-----------|-------------|---------------|-------------|
| External → DMZ      | 2         | 2/2 TLS     | 1/2           | enforced    |
| DMZ → Internal      | 2         | 2/2 mTLS    | 2/2           | enforced    |
| Internal → Data     | 2         | 1/2         | 2/2           | logical only |
```

Flows with `auth_failure_mode: fail_open` are annotated — they appear authenticated but provide no security guarantee on failure. Boundary enforcement is "enforced" (implicit deny + egress filtering) or "logical only."

Unencrypted, unauthenticated, or fail-open cross-boundary flows are highlighted as high-priority control gaps.

### 3. Exposure Counts

If the model has been pushed to the platform and analysis has run:

```
Exposures
  12 exposures across 5 components.
  Top affected: payment-db (4 exposures)
```

If not synced:

```
Exposures
  Model not synced — push to platform for exposure analysis.
  Run /dethereal:sync push to publish.
```

### 4. Control Coverage and Gap Analysis

This is the longest section of the report, and it is deliberately not a single number. Coverage is reported in up to five parts, because "covered" means different things depending on where the evidence came from.

The two you always get are **inferred** coverage — read from the security attributes you set during enrichment — and **formal** coverage — read from the controls actually assigned to elements. A synced model adds MITRE-grounded gap analysis on top; two further parts appear only when you have the data they describe.

#### 4a. MITRE-grounded gap analysis

**Requires a platform sync.** This part is skipped entirely on a model that has never been pushed — the analysis walks the platform's `Exposure → ATT&CK Technique → ATT&CK Mitigation → Countermeasure → Control` chain, and there are no platform exposures to walk from until you sync.

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

Read the three counts as three different problems:

| Bucket | What it means | What to do |
|---|---|---|
| **Unmitigated (addressable)** | A real gap you can close today — an ATT&CK mitigation exists, and an installed module provides a control class that implements it. | Assign the recommended control. |
| **Unaddressable (module gap)** | The mitigation exists in ATT&CK, but no installed module supplies a control class for it. | Install a module that covers it, or handle it outside the platform. |
| **No MITRE chain** | The exposure carries no ATT&CK technique mapping, so it cannot be traced through the framework chain at all. | Judge it manually — the framework has nothing to say about it. |

Two more numbers appear alongside them. **Configured but non-matching** counts controls that *are* assigned to an element but address different techniques — coverage that looks reassuring on the element and does nothing for that exposure. **Recommended controls** are type-compatible candidates, each with its D3FEND links and the number of techniques it would address.

> **Recommendations are per control class, not per control.** Several recommended rows naming related classes for the same mechanism are often satisfied by **one** control carrying several classes — not one control per row. See [Working with Security Controls](../WORKING_WITH_SECURITY_CONTROLS.md).

If the platform call fails — expired auth, network error — the report falls back to what it can read from your local files (4c below).

#### 4b. Inferred coverage (from enrichment attributes)

Computed locally from the attributes you set during enrichment, broken down by protection category:

```
### Inferred Coverage (from enrichment attributes)

| Protection | Coverage | Missing |
|------------|----------|---------|
| Authentication | 10/12 (83%) | scheduler, batch-worker |
| Encryption in transit | 8/10 cross-boundary flows (80%) | internal→data-tier, worker→queue |
| Encryption at rest | 3/4 stores (75%) | session-cache |
| Monitoring | 6/12 (50%) | scheduler, batch-worker, config-svc, ... |
```

The report labels this honestly, and so should you: it is **sufficient for a security posture review, insufficient as compliance evidence**. An `authentication: oauth2` attribute is your assertion that the component authenticates — it is not a control anyone has assigned, reviewed, or verified. Run `/dethereal:enrich` to fill the gaps it names.

#### 4c. Formal control coverage (from assigned controls)

The same question asked of *assigned controls* rather than attributes, broken down by enrichment tier:

```
### Formal Control Coverage (from assigned controls)

| Tier | Components | With Controls | Gap |
|------|------------|---------------|-----|
| 1 — Crown Jewels | 3 | 2 (67%) | payment-db |
| 2 — Cross-boundary | 4 | 1 (25%) | api-gw, auth-svc, msg-queue |
| 3 — Internet-facing | 2 | 2 (100%) | — |
| 4 — Internal | 3 | 0 (0%) | scheduler, batch-worker, config-svc |
| **Total** | **12** | **5 (42%)** | **7 components without formal controls** |
```

The four tiers are:

| Tier | Definition |
|---|---|
| **1 — Crown jewels** | Components you tagged `crownJewel` during classification. |
| **2 — Cross-boundary** | Source or target of a flow that crosses a trust boundary. |
| **3 — Internet-facing** | Connected to an external entity by a data flow. |
| **4 — Internal** | Everything else. |

Each component appears in its **highest-priority tier only** — a crown jewel that is also cross-boundary appears in Tier 1 and nowhere else, so the tier totals add up to your component count.

This is the coverage figure that stands up as evidence, which is why the report names the frameworks it serves (SOC 2 CC6.1, ISO 27001 A.8, PCI-DSS 6.x). Close a gap with `/dethereal:enrich --focus controls`.

#### 4d. Control source breakdown

Appears only when your controls carry a `source` field. It separates controls the plugin found evidence for during discovery from controls you asserted yourself:

```
### Control Verification Status

| Source | Controls | Note |
|--------|----------|------|
| Discovered (verified in code/IaC) | 8 | Full confidence — implementation confirmed |
| Declared (user-asserted) | 5 | Assumed effective, unverified |
| Both (discovered + declared) | 2 | Highest confidence — governed and verified |
```

A control that is both discovered and declared is the strongest statement available: someone wrote the policy down, and the implementation was found.

#### 4e. Governance controls

Appears only when you declared governance controls during the enrichment control pass — the organizational measures that protect the system without living in any one component:

```
### Governance Controls (declared)
  - Patch management: monthly patching cycle
  - Access reviews: quarterly
  - Change control: CAB approval required for production
```

These are listed, not scored. They have no element to attach to, so they contribute nothing to 4b or 4c — the section exists so a reviewer sees them rather than assuming they don't exist.

### 5. MITRE ATT&CK Coverage

**This section requires a platform sync and a completed analysis.** Tactic coverage is derived from the techniques the analysis engine attaches to exposures — the plugin does not maintain its own client-side technique annotation, so enriching components alone produces no coverage here.

When exposures are available, their techniques are aggregated and deduplicated to show which of the 14 Enterprise ATT&CK tactics are covered:

```
MITRE ATT&CK Coverage (platform-derived)
  Techniques mapped: 12
  Tactics covered (5/14): Initial Access, Credential Access, Lateral Movement,
    Collection, Exfiltration
  Tactics not covered: Reconnaissance, Resource Development, Execution, Persistence,
    Privilege Escalation, Defense Evasion, Discovery, Command and Control, Impact
```

Two cases produce no coverage instead:

- **Model not synced:** "Model not synced — push to platform and run an analysis for MITRE tactic coverage." Run `/dethereal:sync push`, then start an analysis.
- **Synced, but no exposures yet:** "No exposures — analysis has not produced technique mappings yet." Either the analysis has not run, or no installed module has policies covering this model's components.

### 6. Credential Topology

Credential usage across the model:

```
Credential Topology
  8 flows with credentials, 2 shared credentials
  Credential blast radius: db-admin (used by 3 flows across 2 boundaries)
  Credential stores: PostgreSQL, Redis (stores_credentials: true)
```

Shared credentials (same credential on multiple flows) flag the blast radius of a credential compromise.

### 7. Detection Coverage

Monitoring tool presence across components:

```
Detection Coverage
  Monitored: 6 components (SIEM: 4, EDR: 3, NDR: 1)
  Blind spots: worker, scheduler (no monitoring tools configured)
```

Components without any monitoring tools are SOC blind spots — security events on those components are invisible to detection and response.

### 8. Cross-Model Analysis Boundaries

If the model references external models:

```
Cross-Model Analysis Boundaries
  2 components reference external models. Attack paths through these
  components are not included in this model's analysis.
```

---

## Local vs. Platform Analysis

Understanding which analysis requires platform sync:

| Analysis | Source | Requires Platform Sync? |
|----------|--------|------------------------|
| Quality score, structural validation | Local (`/dethereal:review`) | No |
| Boundary crossing matrix, credential topology, detection coverage | Local (`/dethereal:surface`) | No |
| Inferred and formal control coverage (`/dethereal:surface` §4b, §4c) | Local (`/dethereal:surface`) | No |
| MITRE-grounded gap analysis (`/dethereal:surface` §4a) | Platform analysis engine | Yes |
| MITRE ATT&CK tactic coverage (`/dethereal:surface` §5) | Platform analysis engine | Yes |
| Exposures, attack paths | Platform analysis engine | Yes |
| Countermeasure coverage, defense gaps | Platform analysis engine | Yes |

Local analysis runs entirely from model files — you can review quality and most of the attack surface without a platform connection. `/dethereal:surface` still runs offline, but three of its parts come from the platform and are reported as unavailable until you push and run an analysis: exposure counts (§3), MITRE-grounded gap analysis (§4a), and MITRE tactic coverage (§5).

**"Control gaps" is not one thing.** The tier gap table in §4c is computed from your local files and needs no sync. The MITRE-grounded gap analysis in §4a — the one that names techniques, mitigations, and recommended controls — needs one. If you run `/dethereal:surface` offline and see tier gaps but no MITRE chain, that is the reason.

### Prioritization Guidance

When reviewing results, prioritize remediation in this order:

1. **Internet-facing components** — directly reachable from external sources
2. **Data stores** — especially those holding credentials or regulated data
3. **Authentication paths** — flows where `auth_failure_mode` is `fail_open` or `fallback`
4. **Cross-boundary flows** — data moving between trust zones
5. **Administrative access paths** — management and maintenance interfaces

This order reflects the enrichment tier rationale: the highest-exposure surfaces get attention first.

## Understanding Platform Analysis

After pushing your model (`/dethereal:sync push`), the platform runs its analysis engine, which computes:

- **Exposures** — potential vulnerabilities specific to your model's structure and attributes
- **Countermeasures** — links between your security controls and the exposures they address
- **Attack paths** — how an attacker could move through your system (graph traversal)

These computed artifacts live on the platform, not in your local files. Run `/dethereal:surface` after analysis to see the results. For details on interpreting analysis output, see the platform's [Security Analysis Workflow](../SECURITY_ANALYSIS_WORKFLOW.md) guide.

## What Happens After Analysis

After platform analysis completes:

1. **Review findings** — run `/dethereal:surface` to see exposures and control gaps
2. **Create controls** — add security controls through the platform GUI to address identified exposures
3. **Link countermeasures** — connect controls to exposures so defense coverage analysis credits existing defenses
4. **Track remediation** — use the platform's issue management to create, assign, and track resolution of findings
5. **Iterate** — refine the model locally, re-publish, and re-analyze as your system evolves

For managing security controls and issues discovered through analysis, see:
- [Working with Security Controls](../WORKING_WITH_SECURITY_CONTROLS.md)
- [Issue Management Guide](../ISSUE_MANAGEMENT_GUIDE.md)

---

**Next:** [Agents, Tools, and Hooks](AGENTS_AND_ARCHITECTURE.md) — how the plugin works under the hood
