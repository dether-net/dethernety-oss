<!-- Loaded by the enrich skill via @docs/controls-enrichment.md. Self-gating: only active when --focus controls is specified. -->

# Control Enrichment Instructions

> **Self-gating:** If `--focus controls` was NOT specified in the current invocation, IGNORE the rest of this file entirely. These instructions apply only to the control assignment pass.

## Overview

The control pass assigns security controls to model elements in three steps, ordered by control category. It runs as a **separate Agent(security-enricher) invocation** with its own 40-turn budget — it does NOT share the main enrichment session's budget.

**Three-step sequence:**
1. Enforcement controls (Category 2) — batched per boundary
2. Detection controls (Category 3) — one global prompt
3. Governance placeholder (Category 4) — single prompt

## Prerequisites

Before starting the control pass:

1. Read `structure.json` — count boundaries (B), extract element types per boundary
2. Read existing `controls[]` arrays on boundaries, components, and data flows
3. Read component attribute files — collect `monitoring_tools` values (seeds detection controls)
4. Check platform connectivity: attempt `mcp__dethereal__manage_controls(action: 'list')`. If it succeeds, use the **brownfield** path. If it fails, use the **greenfield** path.

## Step 1: Enforcement Controls (Category 2)

Enforcement controls protect boundaries and their components. Process **one boundary at a time** with incremental persistence.

### Path Selection

**Brownfield (platform reachable):**
1. For each boundary, collect all element types within it (PROCESS, STORE, EXTERNAL_ENTITY, etc.)
2. Call `mcp__dethereal__manage_controls(action: 'rank', element_types: [...], module_id: '<active-module-id>')`
3. If `rank` succeeds, present the pre-ranked batch table (see format below)
4. User confirms, modifies, or adds additional controls
5. If all candidates are `weak`, recommend creating a new control rather than reusing a poor match

**Greenfield (platform unreachable or `rank` fails):**
1. Present the greenfield prompt (see format below)
2. User describes controls as free-text
3. Write as `{ id: null, name: "...", source: "declared" }`

**Error recovery:** If `rank` fails for a boundary (network error, auth expired), fall back to greenfield prompts for that boundary. Do not retry or stall. Log: "Platform unreachable — switching to name-only control entry for this boundary."

### Boundary Count Handling

**Zero boundaries (B=0):**
Present a single global enforcement prompt:
```
What enforcement controls protect this system?
(Firewalls, WAFs, IDS/IPS, network access controls, or "none")
```
Assign controls to the model root or individual components.

**Standard (1 <= B <= 6):**
One prompt per boundary, sequential. Write controls after each boundary confirmation.

**Large models (B > 6):**
Present tiered options:
```
N boundaries have no enforcement controls.
Review: (1) crown-jewel boundaries only, (2) all boundaries, (3) skip.
```
If option 1: identify crown-jewel boundaries (those containing components with `crown_jewel: true`). Process these first (reduces effective B to ~3-4). After completing crown-jewel boundaries, offer to continue with remaining boundaries.

### Brownfield Batch Table Format

```
## Control Assignment — [Boundary Name]

Components: [list component names and types in this boundary]

Existing controls from your library:

| # | Suggested Control | Relevance | Classes (relevant / total) | Countermeasures | Assign? |
|---|-------------------|-----------|---------------------------|-----------------|---------|
| 1 | DB Encryption (PG) | strong | 3/3 (Encryption-at-Rest, PG-TDE, KMS) | 12 | Y |
| 2 | WAF Protection (AWS) | good | 2/3 (WAF, CloudFront; Azure N/A) | 8 | Y |
| 3 | WAF Protection (Generic) | weak | 1/2 (WAF; Azure-FrontDoor N/A) | 3 | ? |

Additional controls not in your library? (describe or "none")
```

### Greenfield Prompt

```
## Enforcement Controls — [Boundary Name]

Components: [list component names and types]

What enforcement controls protect components in this boundary?
(Firewalls, WAFs, API gateways with security rules, IDS/IPS, network access controls)

| # | Control | Protects | Type |
|---|---------|----------|------|
| ? | ?       | all / specific components | firewall / WAF / IDS / other |

Enter controls or "none" to skip.
```

### Assignment Level

Decide where to write control references based on what the control protects:

| Control type | Write to | Rationale |
|-------------|----------|-----------|
| Firewall, WAF, IDS/IPS | Boundary `controls[]` in `structure.json` | Protects the entire zone |
| Database encryption, application auth | Component `controls[]` in `structure.json` | Specific to the element |
| TLS, mTLS | Data flow `controls[]` in `dataflows.json` | Protects a communication path |
| SIEM, monitoring | Boundary or component | Depends on coverage scope |

For boundary-scoped controls, write to the boundary's `controls[]` — not to each component individually. This avoids stale fan-out when components are added later.

### Persistence

After each boundary confirmation, write controls immediately:
- Read current `structure.json`
- Merge new control references into the appropriate boundary/component `controls[]` arrays
- Write updated `structure.json`

This ensures partial progress survives if the agent hits its turn limit.

## Step 2: Detection Controls (Category 3)

One global prompt. Pre-populate from `monitoring_tools` attribute data captured during main enrichment.

1. Read all component attribute files and collect `monitoring_tools` values
2. Build a pre-populated table of detection controls:

```
## Detection & Response Coverage

Monitoring tools captured during enrichment:

| # | Tool | Components Covered | Detection Scope | Assign as Control? |
|---|------|-------------------|-----------------|-------------------|
| 1 | SIEM | api-server, db    | network, auth   | Y/N |
| 2 | EDR  | api-server        | endpoint        | Y/N |

Additional detection controls? (SOC monitoring, NDR, automated response, or "none")
```

3. For confirmed tools from attribute files: `source: "discovered"`
4. For user-added detection tools: `source: "declared"`
5. Write detection controls to the appropriate element `controls[]` arrays

## Step 3: Governance Placeholder (Category 4)

Single prompt, free-text. No graph entities created — documentation only.

```
Any governance controls to record for this system?
(Patch management, access review policies, change control, incident response procedures)

Enter descriptions or "none" to skip.
```

Write responses to `.dethereal/scope.json` as `declared_governance_controls: string[]`.

## Re-Run Behavior

When controls already exist on model elements:

1. Read existing `controls[]` from all boundaries, components, and data flows
2. Present as "currently assigned" before prompting for changes:
   ```
   Currently assigned controls for [Boundary Name]:
   - WAF Protection (declared)
   - Perimeter Firewall (declared)

   Add more controls or modify? (add / modify / skip)
   ```
3. New controls are additive — never remove existing controls silently
4. Skip boundaries/components that already have controls unless the user requests modification

## Multi-Class Control Evaluation

When the `rank` action returns candidates, the scoring is pre-computed:

- `score = (compatible_configured / total_classes) - (incompatible_configured / total_classes)`
- **strong** (score >= 0.8 AND zero incompatible configured): all relevant classes fit, no wrong countermeasures
- **good** (score >= 0.5): majority of classes fit, minor gaps
- **weak** (score < 0.5): more noise than signal — recommend creating a new control

Present relevance labels in the batch table. The user can always override by choosing a `weak` candidate or rejecting a `strong` one.

## Turn Budget

The control pass runs within a 40-turn agent budget:

| Step | Greenfield | Brownfield |
|------|------------|------------|
| Context loading (read model, attributes, scope) | 3 | 3 |
| Enforcement per boundary (B boundaries) | B x 2 (prompt + write) | B x 3 (rank + prompt + write) |
| Detection controls | 2 (prompt + write) | 3 (rank + prompt + write) |
| Governance placeholder | 1 | 1 |
| Validation | 1 | 1 |
| **Total (B=4)** | **12** | **16** |
| **Total (B=6)** | **16** | **22** |

For B > 6: use tiered prompts (crown-jewel boundaries first) to keep effective B at 3-4.
