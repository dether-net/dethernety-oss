---
name: classify
description: Assign classes to unclassified components, boundaries, data flows, and data items
agent: security-enricher
argument-hint: "[--type components|flows|boundaries|data-items]"
---

Classify elements in a Dethernety threat model using platform module classes.

## Prerequisites

1. **Resolve model path** using the Model Resolution Protocol
2. If no model exists, suggest `/dethereal:create` first and stop
3. Read model files from disk: `structure.json`, `dataflows.json`, `data-items.json`
4. Read `.dethereal/scope.json` for crown jewel names (needed for crown jewel tagging)
5. Read `.dethereal/state.json` to understand current workflow phase

## Steps

### 1. Parse Arguments

If `$ARGUMENTS` contains `--type`, filter classification to that element type only:
- `components` — classify components only
- `flows` — classify data flows only
- `boundaries` — classify boundaries only
- `data-items` — classify data items only

If no arguments, classify all unclassified elements.

### 2. Inventory Unclassified Elements

Scan model files for elements without `classData`:
- Components in `structure.json` (recursively through boundary hierarchy)
- Data flows in `dataflows.json`
- Data items in `data-items.json`
- Boundaries in `structure.json`

Show summary: "Found N unclassified elements: X components, Y flows, Z boundaries, W data items."

If all elements are already classified, show:
```
All elements are classified. Quality: X/100.
[next] /dethereal:enrich (populate security attributes)
```

### 3. Pass 1 — Deterministic Classification (D51)

1. Call `mcp__dethereal__get_classes` to fetch all available class types from the platform
2. For each unclassified element, match by name, type, and description against available classes
3. If the element was discovered from IaC (check `.dethereal/discovery.json` for `sources`), use the pre-classification from the infrastructure-scout's IaC mapping table — these were already validated against `get_classes` during discovery
4. Mark high-confidence matches as pre-classified

If the platform is offline, skip Pass 1 entirely and do everything in Pass 2.

### 4. Pass 2 — LLM-Assisted Classification

For remaining unclassified elements:
1. Use boundary context — which boundary contains the element, what other elements share that boundary
2. Consider connected data flows — what protocols, what data types
3. Consider peer components — if sibling components in the same boundary are all classified as "Microservice", an unclassified sibling is likely similar
4. Propose the closest available class — never fabricate class IDs
5. If no suitable class exists, mark as "unclassified" with a gap note

### 5. Crown Jewel Tagging (D21/D41)

Match free-text crown jewel names from `scope.json` to actual components:

1. For each entry in `scope.json.crown_jewels[]`, fuzzy-match against component names
2. Present matches for confirmation:
   ```
   Crown jewel mapping:
   | Scope Declaration | Matched Component | Type | Confirm? |
   |-------------------|-------------------|------|----------|
   | "Payment Database" | payment-db | STORE | Y |
   | "User PII" | user-service | PROCESS | ? |
   ```
3. Set `crown_jewel: true` on confirmed component attribute files
4. If a crown jewel declaration doesn't match any component, flag it: "Crown jewel 'X' does not match any discovered component. Add it with `/dethereal:add`?"

This is the lightweight Phase 3 tagging. Full `asset_criticality` enrichment happens during `/dethereal:enrich`.

### 6. Present Batch Confirmation Table

Show a single confirmation table for all classification proposals:

```
## Classification Proposal

| # | Element | Type | Current Class | Proposed Class | Confidence | Crown Jewel |
|---|---------|------|---------------|----------------|------------|-------------|
| 1 | Redis | STORE | — | Key-Value Store | high (IaC) | — |
| 2 | PostgreSQL | STORE | — | Database | high (IaC) | yes |
| 3 | Auth0 | EXTERNAL_ENTITY | — | Identity Provider | medium (LLM) | — |
| 4 | API Server | PROCESS | — | Web Application | medium (LLM) | — |

Apply all? (yes / modify / skip)
```

Allow the user to modify individual rows or accept the batch.

### 7. Quality Gate Check

After user confirmation, validate classification coverage:

- **100% of STORE elements must be classified** — STOREs drive data sensitivity analysis; unclassified STOREs block meaningful enrichment
- **80% of all elements must be classified** for overall pass

If the gate fails:
```
Classification gap: 2 STOREs unclassified (payment-cache, session-store).
STOREs must be 100% classified for effective analysis.
Classify now or skip? (classify / skip)
```

If the user skips, proceed with a warning but do not block.

### 8. Write Changes

- Update `classData` on elements in `structure.json`
- Call `mcp__dethereal__generate_attribute_stubs(directory_path: '<model-path>')` to deterministically write class template attribute stubs for all newly classified elements. The tool auto-scans `structure.json`, deduplicates classes, fetches templates via GraphQL, and merges template fields into existing attribute files (existing values preserved). This replaces manual template fetching — one tool call instead of per-element schema extraction.
- Write `crown_jewel: true` to attribute files for confirmed crown jewel components

### 9. State — No Transition

Classification does NOT change `currentState` in `.dethereal/state.json`. The model stays at its current state (DISCOVERED or STRUCTURE_COMPLETE). The quality score's `component_classification_rate` factor (25% weight) tracks classification progress continuously via `mcp__dethereal__validate_model_json`.

### 10. Validate and Footer

Call `mcp__dethereal__validate_model_json` to check structural validity.

```
[done] Classified N/M elements (X% classified, Y STOREs at 100%). Crown jewels tagged: Z. Quality: X/100.
[next] /dethereal:enrich (populate security attributes) or /dethereal:classify --type flows (classify remaining types)
```
