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

1. Read `activeModules` from `.dethereal/scope.json`
2. Extract `moduleIds` from `activeModules` (order matters — see tiebreaking below). If `activeModules` is absent from scope.json, omit `moduleIds` from `match_classes` calls (backward compatibility — searches all installed modules)
3. Group unclassified elements by class label: components (`COMPONENT`), boundaries (`SECURITY_BOUNDARY`), flows (`DATA_FLOW`), data items (`DATA`)
4. For each label with unclassified elements, call:
   `mcp__plugin_dethereal_dethereal__match_classes(elements: [{name, type?, description?}, ...], classLabel: <label>, moduleIds: [...], topN: 3, fields: ['description', 'category', 'type'])`
5. Cross-module tiebreaking: when multiple modules return same-confidence matches for the same element, prefer the module listed earlier in `activeModules` (user-set priority order). Specialized modules should precede baseline (dethernety-module)
6. For IaC-discovered elements, check `.dethereal/discovery.json` for `sources` — if pre-classification exists and matches a `match_classes` candidate, boost confidence to `high (IaC)`. If they differ, present both options in the confirmation table
7. Auto-accept `exact_name` matches (high confidence)
8. Present `fuzzy`/`vector`/`type` matches for confirmation

**Offline fallback chain:**
1. Call `match_classes(...)` as above
2. If the result contains `{ success: false }` or an error → fall back to `mcp__plugin_dethereal_dethereal__get_classes` per module (legacy behavior)
3. If `get_classes` also returns errors → skip Pass 1 entirely, all classification in Pass 2
4. Warning: "Platform connectivity issues — classification running in LLM-only mode. Re-run with platform access for server-side matching."

### 4. Pass 2 — LLM-Assisted Classification

For remaining unclassified elements:
1. Use boundary context — which boundary contains the element, what other elements share that boundary
2. Consider connected data flows — what protocols, what data types
3. Consider peer components — if sibling components in the same boundary are all classified as "Microservice", an unclassified sibling is likely similar
4. Propose the closest available class from active modules — never fabricate class IDs
5. If no suitable class exists in active modules, broaden the search: call `mcp__plugin_dethereal_dethereal__match_classes(elements: [...unclassified...], classLabel: <label>, topN: 3)` without `moduleIds`. The `moduleName` field on each candidate identifies which module to suggest. If a match is found in an inactive module, flag it: "Element 'X' matched class 'Y' from module 'Z' (not in active modules). Add module 'Z'? (yes / skip)"
6. If still no match, mark as "unclassified" with a gap note

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

| # | Element | Type | Proposed Class | Module | Confidence | Match | Crown Jewel |
|---|---------|------|----------------|--------|------------|-------|-------------|
| 1 | Redis | STORE | Key-Value Store | dethernety-module | high (IaC) | exact | — |
| 2 | PostgreSQL | STORE | Database | Databases | high (IaC) | exact | yes |
| 3 | Auth0 | EXTERNAL_ENTITY | Identity Provider | dethernety-module | medium | fuzzy | — |
| 4 | API Server | PROCESS | Web Application | dethernety-module | medium | vector | — |
| 5 | gRPC Handler | PROCESS | — | — | — | unmatched | — |

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

If unclassified elements exist and `activeModules` is set, check if broadening to additional modules would help: call `mcp__plugin_dethereal_dethereal__match_classes(elements: [...unclassified...], classLabel: <label>, topN: 3)` without `moduleIds`. The `moduleName` field on each candidate identifies which inactive module would resolve the gap. If matches found:
```
Adding modules [Databases, Azure] would classify 2 more elements. Add? (yes / skip)
```
If confirmed, update `activeModules` in scope.json and re-run classification for affected elements.

If the user skips, proceed with a warning but do not block.

### 8. Write Changes

- Update `classData` on elements in `structure.json`
- Call `mcp__plugin_dethereal_dethereal__generate_attribute_stubs(directory_path: '<model-path>')` to deterministically write class template attribute stubs for all newly classified elements. The tool auto-scans `structure.json`, deduplicates classes, fetches templates via GraphQL, and merges template fields into existing attribute files (existing values preserved). This replaces manual template fetching — one tool call instead of per-element schema extraction.
- Write `crown_jewel: true` to attribute files for confirmed crown jewel components

### 9. State — No Transition

Classification does NOT change `currentState` in `.dethereal/state.json`. The model stays at its current state (DISCOVERED or STRUCTURE_COMPLETE). The quality score's `component_classification_rate` factor (25% weight) tracks classification progress continuously via `mcp__plugin_dethereal_dethereal__validate_model_json`.

### 10. Validate and Footer

Call `mcp__plugin_dethereal_dethereal__validate_model_json` to check structural validity.

```
[done] Classified N/M elements (X% classified, Y STOREs at 100%). Crown jewels tagged: Z. Quality: X/100.
[next] /dethereal:enrich (populate security attributes) or /dethereal:classify --type flows (classify remaining types)
```
