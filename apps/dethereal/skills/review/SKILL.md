---
name: review
description: Quality dashboard with score breakdown, gap analysis, and readiness assessment
agent: model-reviewer
context: fork
argument-hint: "[directory-path] [--structure-only]"
---

Evaluate a Dethernety threat model's completeness, correctness, and readiness for platform analysis. This skill does not modify model data files. Quality results are displayed but not cached to disk — invoke via the guided workflow (`/dethereal:threat-model`) for persistent quality tracking.

## Prerequisites

1. **Resolve model path** using the Model Resolution Protocol
2. If no model exists, suggest `/dethereal:create` first and stop
3. Read model files from disk: `manifest.json`, `structure.json`, `dataflows.json`, `data-items.json`
4. Read `.dethereal/state.json` for current workflow phase
5. Read `.dethereal/quality.json` if it exists (previous quality cache)

## Parse Arguments

If `$ARGUMENTS` contains `--structure-only`, route to **Structure-Only Mode**.

Otherwise, proceed with **Full Review Mode**.

---

## Full Review Mode

### 1. Run Validation and Quality

1. Call `mcp__dethereal__validate_model_json(action: 'validate')` for structural checks
2. Call `mcp__dethereal__validate_model_json(action: 'quality')` for the 7-factor quality assessment

### 2. Display Quality Score

Show the quality score with label:
- 0–39: Starting
- 40–69: In Progress
- 70–89: Good
- 90–100: Comprehensive

The quality score measures **model completeness**, not system security posture. A model with 95/100 quality could describe a system with critical vulnerabilities — the score reflects how thoroughly the model captures the system, not how secure the system is.

### 3. Factor Breakdown

Display all 7 factors in a table:

```
### Factor Breakdown
| Factor | Score | Weight | Contribution |
|--------|-------|--------|-------------|
| Component classification | 60% | 25 | 15.0 |
| Attribute completion | 40% | 20 | 8.0 |
| Boundary hierarchy | 100% | 15 | 15.0 |
| Data flow coverage | 80% | 15 | 12.0 |
| Data classification | 50% | 10 | 5.0 |
| Control coverage | 0% | 10 | 0.0 |
| Credential coverage | 0% | 5 | 0.0 |
```

### 4. Quality Gate Evaluation

Evaluate all three gates and display pass/fail with details:

```
### Quality Gates
Gate 1 (Creation):    PASS — all advisory checks clear
Gate 2 (Sync):        PASS — structure valid, references intact
Gate 3 (Analysis):    FAIL — 2 components unclassified, attribute completion at 40%
```

**Gate 1 (Creation, advisory):**
- Missing classifications on components
- Unnamed data flows (empty description)
- Single-component boundaries
- External entities placed inside internal-component boundaries
- Cross-boundary flows without security controls

**Gate 2 (Sync, blocking):**
- Manifest completeness (name, description, module references)
- Structure validity: ≥1 boundary, ≥1 component, ≥1 data flow
- Reference integrity: all flow source/target IDs exist in structure.json
- No orphaned attribute files

**Gate 3 (Analysis, blocking):**
- 100% of components classified
- ≥80% of components have attribute files with content
- All trust boundary crossings reviewed
- Data items classified for sensitive flows
- ≥1 cross-boundary data flow exists

### 5. Common Gaps Checklist

Check the model for frequently missing elements:

```
### Common Gaps
- [x] Administrative access paths
- [ ] Monitoring/logging flows
- [ ] Backup/recovery flows
- [x] Trust boundary crossings have data flows
- [ ] External dependencies (CDN, DNS, CA, registries)
- [x] Human actors (developers, operators, support)
- [ ] Bidirectional flows (request + response)
- [ ] Error/fallback paths
```

Determine presence by scanning structure.json and dataflows.json for relevant patterns. These checks are heuristic — results may vary between runs. Detection guidance per item:

1. **Admin access**: flows with "SSH", "RDP", "admin", "management", "console" in name/description
2. **Monitoring/logging**: flows with "monitor", "log", "SIEM", "metric" in name/description
3. **Backup/recovery**: flows with "backup", "snapshot", "dump", "replicate" in name/description
4. **Boundary crossings**: every pair of adjacent boundaries has ≥1 connecting flow
5. **External deps**: EXTERNAL_ENTITY components for CDN, DNS, CA, registry services
6. **Human actors**: EXTERNAL_ENTITY components with "developer", "operator", "admin", "support" in name
7. **Bidirectional flows**: component pairs with flows in both directions
8. **Error/fallback**: flows with "error", "retry", "fallback", "circuit-breaker", "dead-letter" in name

### 6. Top Issues

List the top 3 issues by severity:

```
### Top Issues
1. **[Critical]** 3 components have no class assigned (Web Server, Cache, Worker)
2. **[Warning]** Database component has no attribute file — security properties unknown
3. **[Info]** No data items defined — data sensitivity cannot be assessed
```

### 7. Recommendations

Suggest next actions based on the gaps found:
- Which skill to run next (`/dethereal:classify`, `/dethereal:enrich`, `/dethereal:add`)
- Which specific elements need attention

### 8. Analysis Readiness

Assess readiness with three states:
- **PASS** (quality ≥ 70, all Gate 3 criteria met): "Ready for platform analysis."
- **PARTIAL** (quality 40–69, or ≥ 70 with Gate 3 failures): "Analysis possible but results will have gaps."
- **FAIL** (quality < 40 or Gate 2 failures): "Not ready — structural issues must be resolved first."

```
### Analysis Readiness
PARTIAL — Quality 72/100 but 2 components unclassified (Gate 3 requires 100%)
```

**Readiness caveat (PASS with missing credentials/controls):** If quality ≥ 70 and Gate 3 passes but `control_coverage_rate` = 0 AND `credential_coverage_rate` = 0:

> Your model is structurally ready for analysis, but analysis quality will improve significantly with credentials (for lateral movement paths) and controls (for defense coverage gaps).

### 9. Discovery Basis

If `.dethereal/discovery.json` exists, read it to determine model provenance and display a one-line discovery basis:

```
Model based on: code analysis (10 components) + manual (2). Known gaps: 3.
```

Add the runtime validation recommendation:

> Runtime Validation Recommended: This model reflects code-time infrastructure. Cross-reference with cloud asset inventory, DNS logs, or network flow data to identify shadow infrastructure not visible in code.

If `discovery.json` does not exist (model created manually or pulled from platform), omit the discovery basis but still show the runtime validation recommendation.

### 10. Cross-Model Gap Detection

Check `structure.json` for components or boundaries with `representedModel` references. If found, display the cross-model gap warning per the model-reviewer's Cross-Model Gap Detection protocol.

### 11. Footer

```
[done] Review complete. Quality: X/100 (<label>).
[next] /dethereal:enrich (fill gaps) or /dethereal:sync push (publish)
```

---

## Structure-Only Mode

A lightweight structural validation without quality scoring. Useful for catching errors before enrichment.

### Checks

Run each check and display as `[PASS]`, `[FAIL]`, or `[WARN]`:

1. **Required fields** — manifest.json has `name` and `description`; structure.json has `boundaries` array; dataflows.json has `dataFlows` array
2. **ID uniqueness** — no duplicate IDs across components, boundaries, data flows, and data items
3. **Reference integrity** — all data flow `sourceId` and `targetId` values exist in structure.json (as component or external entity IDs)
4. **Orphaned components** — components with no inbound or outbound data flows (warning, not failure)
5. **Empty boundaries** — boundaries with no child components or sub-boundaries (warning)
6. **Orphaned attribute files** — attribute files in `attributes/` whose element ID no longer exists in model files (warning)
7. **Schema compliance** — call `mcp__dethereal__validate_model_json(action: 'validate')` for full schema validation

### Output

```
## Structural Validation: <Model Name>

Checks:
  [PASS] Required fields present
  [PASS] ID uniqueness (N elements, 0 duplicates)
  [FAIL] Reference integrity: 2 flows reference missing components
    - Flow "user-login" references source "auth-proxy" (not found)
    - Flow "cache-read" references target "old-redis" (not found)
  [WARN] 1 orphaned component: "Legacy Gateway" (no data flows)
  [PASS] No empty boundaries
  [PASS] No orphaned attribute files
  [PASS] Schema validation passed

Result: 1 failure, 1 warning. Fix reference integrity before sync.
```

### Footer

```
[done] Structural validation complete. N checks passed, M failed, K warnings.
[next] Fix reported issues, then /dethereal:review (full quality assessment)
```
