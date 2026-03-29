---
name: remove
description: Remove elements from a threat model with dependency checking
agent: threat-modeler
argument-hint: "[element reference]"
---

Remove elements from a Dethernety threat model with dependency checking.

## Steps

### 1. Resolve Model

Use the Model Resolution Protocol to identify the target model. Read current model files from disk (structure.json, dataflows.json, data-items.json).

### 2. Identify Element

From `$ARGUMENTS` or conversation, identify the element to remove. Match by name (case-insensitive) or by ID.

If ambiguous (e.g., multiple components named "API Server"), list all matches and ask the user to specify:

```
Found 2 matches for "API Server":
  1. [PROCESS] API Server — in DMZ boundary
  2. [PROCESS] API Server — in Internal Network boundary
Which one? (1 or 2)
```

### 3. Check Dependencies

Before removal, scan for elements that depend on the target:

**Component dependencies:**
- Data flows where this component is source or target
- Data items associated with those flows
- Attribute file at `attributes/components/<id>.json`

**Boundary dependencies:**
- Child components within this boundary
- Child sub-boundaries
- Data flows that cross this boundary

**Data flow dependencies:**
- Data items attached to this flow
- Attribute file at `attributes/dataFlows/<id>.json`

**Data item dependencies:**
- Attribute file at `attributes/dataItems/<id>.json`

### 4. Show Dependencies and Confirm

If dependencies exist, show them before proceeding:

```
Removing [PROCESS] "API Server" will also affect:

  Data flows (will be removed):
    - "Client → API Server" (HTTP requests)
    - "API Server → Database" (SQL queries)
    - "API Server → Redis" (Cache lookups)

  Data items (orphaned — flows removed):
    - "User Credentials" on "Client → API Server"

  Attribute files (will be deleted):
    - attributes/components/abc123.json

Proceed? (yes / no / remove component only)
```

- **yes** — remove the element and all dependent elements
- **no** — cancel
- **remove component only** — remove the component but leave flows (they become orphaned and are flagged for review)

If no dependencies exist, confirm with a simpler prompt:
```
Remove [STORE] "Redis Cache" from Data Tier? (yes / no)
```

### 5. Remove Element

Remove from the appropriate model file:
- `structure.json` for components and boundaries
- `dataflows.json` for data flows
- `data-items.json` for data items

Delete associated attribute files from the `attributes/` directory.

If removing a boundary, relocate orphaned child components to the parent boundary (don't delete them silently).

### 6. Handle State Regression

If the model is at ENRICHING or later state, a structural change triggers backward transition:

1. Revert `currentState` to `STRUCTURE_COMPLETE` in `.dethereal/state.json`
2. Delete `.dethereal/quality.json` (forces recomputation)
3. Clear `model_signed_off` from `state.json` if present
4. Remove deleted element IDs from `staleElements[]` if present. If dependent elements were modified (e.g., orphaned flows reconnected, child components relocated), add those modified element IDs to `staleElements[]`
5. Warn the user: "Removing elements reverted state from [previous] to STRUCTURE_COMPLETE."

### 7. Validate and Footer

Call `mcp__dethereal__validate_model_json` to check structural validity after removal.

```
[done] Removed [PROCESS] "API Server" and 3 dependent data flows. Quality: X/100.
[next] /dethereal:view (review updated model) or /dethereal:add (add replacements)
```
