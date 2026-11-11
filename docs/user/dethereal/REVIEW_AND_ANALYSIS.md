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

Score labels: **Starting** (0-39), **In Progress** (40-69), **Good** (70-89), **Comprehensive** (90-100). The score is a label: it gates nothing, and analysis readiness comes from the gate verdicts (see [Analysis Readiness](#analysis-readiness)).

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

Three progressive gates, computed by the server, shown on one verdict line:

```
Gate 1 WARN (2) · Gate 2 PASS · Gate 3 FAIL · Quality 78/100 Good
```

Gate 1 is `PASS` or `WARN`, Gates 2 and 3 `PASS` or `FAIL`. When waivers change Gate 3's verdict, the line adds the verdict without them, e.g. `Gate 3 PASS (without waivers: FAIL)`. Under the line, each failing Gate 2 and Gate 3 criterion is listed with its value, up to five failing elements, and its remedy. In this example Gate 3 fails on C2: only 60% of the template fields on the Tier 1–2 components are answered, and C2 needs 80%.

**Gate 1 (Creation, advisory):** Flags issues without blocking — missing classifications, unnamed flows, single-child boundaries, external entities inside internal boundaries, cross-boundary flows without security controls, and components in no declared or inherited zone.

**Gate 2 (Sync, blocking):** Must pass before `/dethereal:sync push` — manifest completeness (including module references the server can derive; see [Gate 2 Pre-Flight](SYNC_AND_VERSION_CONTROL.md#gate-2-pre-flight) for the module gaps and their remedies), structure validity (at least one boundary besides the default boundary, one component, one data flow), reference integrity, no orphaned attribute files, every attribute file readable, no `controls` key in an attribute file, and no validation errors.

**Gate 3 (Analysis, blocking):** Must pass for meaningful analysis. It has nine criteria, C1–C9. "Tier 1–2" means the internet-facing components, and those that hold a crown jewel or sit in a `RESTRICTED` zone (the server computes the tiers; see [Component Tiers](DISCOVERY_AND_ENRICHMENT.md#component-tiers)):

- **C1** — every non-external component is classified
- **C2** — ≥ 80% of template fields answered on Tier 1–2 components
- **C3** — every cross-boundary flow is reviewed: encryption in transit, credentials required, and the authentication failure mode when the flow authenticates
- **C4** — sensitive flows carry a classified data item with a sensitivity
- **C5** — at least one cross-boundary flow
- **C6** — crown jewels resolve through the persisted map: the crown-jewel map in `.dethereal/scope.json`
- **C7** — sensitivity at or above its floor, for every data item that has one
- **C8** — the literal six-attribute floor on Tier 1–2: `authentication_type`, `encryption_in_transit`, `encryption_at_rest`, `implicit_deny_enabled` and `monitoring_tools` on each component, and `encryption_in_transit` on its flows
- **C9** — no dangling `credential_scope` id: every id is required by some flow

A field gap of C2, C3, or C8 is listed by its fields rather than a one-line detail: `missing` (still empty) and `placeholder` (holding a stand-in value such as `unknown`, `TBD`, or `n/a`). The gate list and the waiver table both show them. A failure with a `placeholder` field can never be waived: replace the stand-in with a real value, or clear it, first.

In the guided workflow you can waive a Gate 3 failure for named elements, only through the waiver questions at Step 9; a waiver counts only on the machine that granted it — see [Waiving a Gate 3 gap](GUIDED_WORKFLOW.md#waiving-a-gate-3-gap). A [quick model](GUIDED_WORKFLOW.md#quick-mode) skips that Gate 3 review and is never REVIEWED; running the guided workflow on it with `--full` deepens it and runs the review.

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

Detection is heuristic, and fixed so the list is the same for an unchanged model: most items search flow names and descriptions for words such as "SSH", "admin", "backup" or "monitor"; external dependencies and human actors search the names of external entities; boundary crossings and two-way flows are read from the structure.

#### Top Issues

The 3 most impactful gaps, ranked by severity:

```
Top Issues
1. [Critical] 2 components have no class assigned (Cache, Worker)
2. [Warning]  Database has no attribute file — security properties unknown
3. [Info]     No data items defined — data sensitivity cannot be assessed
```

Top Issues also lists **data-item assertions** as `[Info]` items. They are advisory: they never affect a gate or the quality score.

- **Unanswered credential flag** — a data item bound to a credential-like class whose [credential flag](DISCOVERY_AND_ENRICHMENT.md#origin-and-credential-flag) is still unanswered. Confirm it with `/dethereal:enrich`. An item you answered **no** never appears.
- **Unknown origin** — a data item without an origin that flows into an external entity, or into a component that runs a model or an agent: who can write it decides whether that input is trusted. Up to 3 items are named, then `+N more`.

#### Red Flags

Red flags are listed whatever the score. The review names:

- **Every insecure fact recorded in your attribute files**, one line per element and field, with the element's name and id, the field and its value, under a heading that carries the count;
- **flows that fail open or fall back** (`auth_failure_mode` `fail_open` or `fallback`) — they look authenticated but guarantee nothing on failure;
- **crown jewels with no control**;
- **controls whose class binding is empty** — no `attributes` and no `platformAttributes`, so the module derives no countermeasure from it;
- **on a synced model, controls with no countermeasure** after analysis.

```
Red Flags (3)
- Orders API → Orders DB (f-api-db): encryption_in_transit = none (plaintext to the database)
- Payment webhook (f-webhook): auth_failure_mode = fail_open
- db-admin-account: shared by 3 flows (f-api-db, f-worker-db, f-migrate-db)
```

A value is an insecure fact when the class guide's security impact marks it insecure, in either direction: `none` or `false` on a security posture (encryption, authentication, TLS, MFA, logging), and `true` on a permissive or exposed setting (`permit_any_*`, `allow_any_*`, `*_exposed`, a legacy or weak `*_enabled`, `*_hardcoded_*`). Unenforced boundaries (`implicit_deny_enabled: false`, `allow_any_inbound: true`), a credential shared by several flows, secrets in configuration or source, and an internet-exposed administrative interface count too. The reviewer finds them with one search across `attributes/` that matches field names by part of the name — `encryption`, `auth`, `tls`, `mfa`, `permit_any`, `allow_any`, `exposed`, `hardcoded`, `fail` or `implicit_deny` — reads them from the files, not from memory, and writes "none recorded" when there are none.

#### Analysis Readiness

Readiness comes from the server, never from the quality score: the review reports the readiness the server computes for the model and never judges it by hand.

| State | Criteria |
|-------|----------|
| **Ready** | Gates 2 and 3 pass, and none of the reasons below applies |
| **Not Ready** | Anything else — the review names each reason in words |

The reasons a model is Not Ready:

| Reason | Meaning |
|--------|---------|
| Gate 2 fails | The platform refuses the push until the structural failures are fixed |
| Gate 3 fails | A push is possible, but analysis would have gaps; the review names the failing criteria. While a loop back is open, Gate 3 is not computed — neither a pass nor a fail — until Step 9 of `/dethereal:threat-model` ends it |
| Pending enrichment | Only with the server's [settlement](SYNC_AND_VERSION_CONTROL.md#the-settlement-switch) switched on (off by default): enrichment values it holds as not yet confirmed |
| Pending file unreadable | Only with the settlement on: its pending-enrichment file cannot be read |
| Unregistered values | Only with the settlement on: values it holds as not registered as yours |
| Model unavailable | The model could not be assessed |

**A REVIEWED model.** When the model's state file claims REVIEWED, the review's state line says whether that still holds. If it does not, it says "REVIEWED no longer holds:" and names each reason — any of those above, plus two that apply only to a review: elements changed since the review are still queued as stale, or the model is a [quick model](GUIDED_WORKFLOW.md#quick-mode), which is never reviewed. If the review still holds but the model changed since, it says "REVIEWED is stale: the model changed since the review."

If the model is Ready but control and credential coverage are both 0%:

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

The full review rolls up your model's [trust zoning](MODEL_CONCEPTS.md#trust-zones-planes-domains-and-conduits) as **zoning coherence** — a set of advisory findings that check whether your declared segmentation hangs together. They are **always advisory**: they inform you and **never** block a sync or fail a quality gate.

The findings are rolled up by kind, one line each, `[Warning]` kinds before `[Info]` ones, naming up to three boundaries and then `+N more`. A scope note follows once, even when there are no findings:

```
Zoning Coherence (advisory — does not block sync)
- [Warning] 2 boundaries hold high-value assets but aren't Restricted: payment-db (reached from a DMZ), secrets-vault, +1 more
- [Warning] 1 external-tier boundary reaches a trusted tier without an approved channel: Vendor API → App Tier
- [Info] 3 boundaries unclassified — fall back to Internal: Logging, Cache, Queue

Zoning asserts network-reachability tiers only. Shared-identity blast radius and node co-tenancy are not evaluated from topology; where you hand-author matching domains tags, a heuristic flags a tag that couples an exposed and a protected tier — but a clean or tag-free result does not imply cross-tier isolation.
```

`under-protected`, `external-ingress`, `mgmt-plane` and the undeclared paths of `flow-channel` are warnings; dead or unreviewable channels, `cross-tier-domain` and `unclassified` are informational. A structural container (a boundary that nests other boundaries) is never counted as unclassified; the review shows the range of tiers it spans instead.

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

7 structural checks, each reported as `[PASS]`, `[FAIL]`, or `[WARN]`:

```
## Structure check: Payment API
  [PASS] Required fields present
  [FAIL] References: 2 flows name missing components
    - "user-login" → source "auth-proxy" not found
  [WARN] 1 unconnected component: "Legacy Gateway"
Result: 1 failure, 1 warning. Fix the references before a push.

[done] Structure check complete. 5 passed, 1 failed, 1 warning.
```

1. **Required fields** — `manifest.json` has a name and a description, `structure.json` has its default boundary, `dataflows.json` has its `dataFlows` list
2. **Unique IDs** — no ID used twice across components, boundaries, flows and data items
3. **References** — every flow's source and target is a component or boundary in `structure.json` (a failure, listing each flow and the missing ID)
4. **Unconnected components** — components with no inbound or outbound data flows (warning)
5. **Empty boundaries** — boundaries with no child components or sub-boundaries (warning)
6. **Orphaned attribute files** — attribute files whose element no longer exists (warning)
7. **Schema** — full schema validation, the same validation `/dethereal:review` runs

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

The crossing flows come from the server: flows whose endpoints sit in different boundaries, or with exactly one endpoint that is an external entity. They are grouped by the boundaries of their source and target, with encryption, authentication and enforcement:

```
Trust Boundary Crossings (6 flows)
| From → To       | Flows | Encrypted | Authenticated | Declares none | Undeclared | Enforcement  |
|-----------------|-------|-----------|---------------|---------------|------------|--------------|
| External → DMZ  | 2     | 2/2       | 1             | 0             | 1          | enforced     |
| DMZ → Internal  | 2     | 2/2       | 2             | 0             | 0          | enforced     |
| Internal → Data | 2     | 1/2       | 1             | 1             | 0          | logical only |
```

Authentication comes from what each flow declares: **Authenticated** (it declares an authentication), **Declares none** (it declares that it needs none), or **Undeclared** (it declares nothing). Flows with `auth_failure_mode: fail_open` are annotated — they appear authenticated but provide no security guarantee on failure. Boundary enforcement is "enforced" (implicit deny on the target boundary, egress filtering on the source boundary) or "logical only." If the server reports more crossing flows than it lists, the report adds "+N more crossing flows not listed".

Unencrypted, declares-none, undeclared and fail-open crossings are the priority gaps, listed by name.

### 3. Exposures and MITRE-Grounded Gaps

**Requires a platform sync.** The exposure counts and the gap analysis come from the platform, so on a model that has never been pushed this section shows only:

```
Model not synced — push it with /dethereal:sync push for exposure and gap analysis.
```

If the model has been pushed to the platform and analysis has run, the section starts with the exposure counts:

```
Exposures
  12 exposures across 5 components.
  Top affected: payment-db (4 exposures)
```

#### MITRE-grounded gap analysis

The gap analysis walks the platform's `Exposure → ATT&CK Technique → ATT&CK Mitigation → Countermeasure → Control` chain, and there are no platform exposures to walk from until you sync.

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

If the platform call fails — expired auth, network error — the report says so and goes on with the parts it reads from your local files, the control coverage in section 4 among them.

### 4. Control Coverage

This is the longest section of the report, and it is deliberately not a single number. Coverage is reported in up to four parts, because "covered" means different things depending on where the evidence came from.

The two you always get are **inferred** coverage — read from the security attributes you set during enrichment — and **formal** coverage — read from the controls actually assigned to elements. Two further parts appear only when you have the data they describe. The MITRE-grounded gap analysis, which needs a synced model, is in [section 3](#3-exposures-and-mitre-grounded-gaps).

#### 4a. Inferred coverage (from enrichment attributes)

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

#### 4b. Formal control coverage (from assigned controls)

The same question asked of *assigned controls* rather than attributes, broken down by component tier:

```
### Formal Control Coverage (from assigned controls)

| Tier | Components | With Controls | Without Controls |
|------|------------|---------------|------------------|
| 1 — Internet-facing | 2 | 2 (100%) | — |
| 2 — Crown jewel or restricted | 4 | 2 (50%) | payment-db, auth-svc |
| 3 — Internal | 6 | 1 (17%) | scheduler, batch-worker, config-svc, +2 more |
| Crown jewels (label) | 3 | 2 (67%) | payment-db |
| Cross-boundary (label) | 3 | 0 (0%) | auth-svc, msg-queue, worker |
```

The tiers are the [component tiers](DISCOVERY_AND_ENRICHMENT.md#component-tiers) the gates use, computed by the server: each component is in exactly one tier, and external entities are never counted. **Crown jewels** and **cross-boundary** pivots (components outside Tier 1 that talk across a boundary to another component) are labels: they overlap the tiers and are never added to them. The report also says how many components a tier leaves out because they have no class, and how many Tier 3 components sit in no declared zone.

This is the coverage figure that stands up as evidence: it counts controls actually assigned, not attributes you asserted. Close a gap with `/dethereal:enrich --focus controls`; with no control assigned at all, the report says "No formal controls assigned. Run /dethereal:enrich --focus controls."

#### 4c. Control source breakdown

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

#### 4d. Governance controls

Appears only when you declared governance controls during the enrichment control pass — the organizational measures that protect the system without living in any one component:

```
### Governance Controls (declared)
  - Patch management: monthly patching cycle
  - Access reviews: quarterly
  - Change control: CAB approval required for production
```

These are listed, not scored. They have no element to attach to, so they contribute nothing to 4a or 4b — the section exists so a reviewer sees them rather than assuming they don't exist.

### 5. MITRE ATT&CK Coverage

**This section requires a platform sync and a completed analysis.** Tactic coverage is derived from the techniques the analysis engine attaches to exposures — the plugin does not maintain its own client-side technique annotation, so enriching components alone produces no coverage here.

When exposures are available, their techniques are aggregated and deduplicated to show which of the 15 Enterprise ATT&CK tactics are covered:

```
MITRE ATT&CK Coverage (platform-derived)
  Techniques mapped: 12
  Tactics covered (5/15): Initial Access, Credential Access, Lateral Movement,
    Collection, Exfiltration
  Tactics not covered: Reconnaissance, Resource Development, Execution, Persistence,
    Privilege Escalation, Stealth, Defense Impairment, Discovery, Command and Control,
    Impact
```

Two cases produce no coverage instead:

- **Model not synced:** "Push with /dethereal:sync push, then run an analysis, for tactic coverage."
- **Synced, but no exposures yet:** "No exposures yet — run an analysis on the platform (create, run, then read its results), or install a module whose policies cover these components." Either the analysis has not run, or no installed module has policies covering this model's components.

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
  2 components stand for other models; attack paths through them are
  outside this model's analysis.
```

If a `credential_scope` value is also used in another model registered in the project, the part warns about cross-model credential reuse. With neither, the part is left out.

---

## Local vs. Platform Analysis

Understanding which analysis requires platform sync:

| Analysis | Source | Requires Platform Sync? |
|----------|--------|------------------------|
| Quality score, structural validation | Local (`/dethereal:review`) | No |
| Boundary crossing matrix, credential topology, detection coverage | Local (`/dethereal:surface`) | No |
| Inferred and formal control coverage (`/dethereal:surface` §4a, §4b) | Local (`/dethereal:surface`) | No |
| MITRE-grounded gap analysis (`/dethereal:surface` §3) | Platform analysis engine | Yes |
| MITRE ATT&CK tactic coverage (`/dethereal:surface` §5) | Platform analysis engine | Yes |
| Exposures, attack paths | Platform analysis engine | Yes |
| Countermeasure coverage, defense gaps | Platform analysis engine | Yes |

Local analysis runs entirely from model files — you can review quality and most of the attack surface without a platform connection. `/dethereal:surface` still runs offline, but three of its parts come from the platform and are reported as unavailable until you push and run an analysis: exposure counts and MITRE-grounded gap analysis (both §3), and MITRE tactic coverage (§5).

**"Control gaps" is not one thing.** The tier gap table in §4b is computed from your local files and needs no sync. The MITRE-grounded gap analysis in §3 — the one that names techniques, mitigations, and recommended controls — needs one. If you run `/dethereal:surface` offline and see tier gaps but no MITRE chain, that is the reason.

### Prioritization Guidance

When reviewing results, prioritize remediation in this order:

1. **Internet-facing components** — directly reachable from external sources
2. **Data stores** — especially those holding credentials or regulated data
3. **Authentication paths** — flows where `auth_failure_mode` is `fail_open` or `fallback`
4. **Cross-boundary flows** — data moving between trust zones
5. **Administrative access paths** — management and maintenance interfaces

This order reflects the rationale behind the component tiers: the highest-exposure surfaces get attention first.

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
