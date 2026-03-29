---
name: add
description: Add components, boundaries, data flows, or data items to a threat model
agent: threat-modeler
argument-hint: "[element description]"
---

@../../docs/guidelines-layout.md
@../../docs/guidelines-schema.md

Add elements to an existing Dethernety threat model using natural language.

## Steps

### 1. Resolve Model

Use the Model Resolution Protocol to identify the target model. Read current model files from disk (structure.json, dataflows.json, data-items.json).

### 2. Parse User Input

From `$ARGUMENTS` or conversation, determine what to add:

| Input Example | Element Type |
|--------------|-------------|
| "add a Redis cache in the data tier" | Component (STORE) |
| "add a DMZ boundary for internet-facing services" | Boundary |
| "add a flow from API Server to Redis for session lookups" | Data flow |
| "add PII data item on the user registration flow" | Data item |

If ambiguous, ask the user to clarify the element type.

### 3. Determine Element Details

**For components:**
- Name and type (PROCESS, STORE, or EXTERNAL_ENTITY)
- Parent boundary — infer from context or ask
- Position coordinates relative to parent boundary (using layout guidelines)
- Suggested class — call `mcp__dethereal__get_classes` if platform is connected
- Generate a temporary reference ID (UUID)

**For boundaries:**
- Name and parent boundary
- Position and dimensions — size to contain children with minimum 50px padding
- Set `dimensionsMinWidth` and `dimensionsMinHeight` to prevent collapse

**For data flows:**
- Source and target components (match by name, case-insensitive)
- Source and target handles based on relative position of components (see layout guidelines)
- Description and protocol
- Avoid handle conflicts with existing flows — if a handle pair is already used between two components, pick a different pair

**For data items:**
- Name and description
- Associated flow(s)
- Sensitivity classification if known

### 4. Show What Will Change

Present the addition before writing:

```
Adding to "Production Stack":
  Component: "Redis Cache" (STORE) in Data Tier boundary
    Position: (200, 100) relative to Data Tier

  New data flows:
    API Server → Redis Cache: "Cache read/write" (right → left)
    Redis Cache → API Server: "Cache response" (bottom → top)

Confirm? (yes / adjust)
```

### 5. Write Changes

Update the relevant model file(s):
- `structure.json` for components and boundaries
- `dataflows.json` for data flows
- `data-items.json` for data items
- Create attribute file stubs in `attributes/` if the element is classified

### 6. Handle State Transition

**At DISCOVERED or STRUCTURE_COMPLETE:** Addition proceeds normally, state is unchanged. The model stays at its current state.

**At ENRICHING or later:** A structural change triggers backward transition:

1. Revert `currentState` to `STRUCTURE_COMPLETE` in `.dethereal/state.json`
2. Delete `.dethereal/quality.json` (forces recomputation)
3. Clear `model_signed_off` from `state.json` if present
4. Add the new element's ID to `staleElements[]`
5. Warn the user: "Adding elements reverted state from [previous] to STRUCTURE_COMPLETE. Enrichment on existing elements is preserved."

### 7. Validate and Footer

Call `mcp__dethereal__validate_model_json` to check structural validity.

```
[done] Added [STORE] "Redis Cache" to Data Tier. Quality: X/100.
[next] /dethereal:add (continue adding) or /dethereal:discover (scan for more components)
```
