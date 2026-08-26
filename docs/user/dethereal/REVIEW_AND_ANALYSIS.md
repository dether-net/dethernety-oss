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

### 4. Control Gap Analysis

Components without security controls, grouped by enrichment tier:

```
Control Gaps
  Components without controls:
    Tier 1: payment-db (crown jewel — high priority)
    Tier 2: api-gateway (cross-boundary)
    Tier 3: web-frontend (internet-facing)
    Tier 4: scheduler (internal)
```

Each component appears in its **highest-priority tier only** — a crown jewel that is also cross-boundary appears only in Tier 1.

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
| Boundary crossing matrix, control gaps, credential topology | Local (`/dethereal:surface`) | No |
| MITRE ATT&CK tactic coverage (`/dethereal:surface` §5) | Platform analysis engine | Yes |
| Exposures, attack paths | Platform analysis engine | Yes |
| Countermeasure coverage, defense gaps | Platform analysis engine | Yes |

Local analysis runs entirely from model files — you can review quality and most of the attack surface without a platform connection. `/dethereal:surface` still runs offline, but its exposure counts (§3) and MITRE tactic coverage (§5) come from the platform and are reported as unavailable until you push and run an analysis.

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
