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
4. **Harvest control-implying attribute evidence** — before prompting each boundary, Grep `attributes/` for evidence the main enrichment already captured (`tls_enabled`, `encryption_at_rest`, `encryption_in_transit`, `implicit_deny_enabled`, `authentication_type`, `waf_*`, …) and pre-populate that boundary's proposal table with `source: "discovered"` rows. This is the same pattern Step 2 uses for `monitoring_tools` — evidence gathered during enrichment must not be re-asked or thrown away at control time.
5. Check platform connectivity: attempt `mcp__plugin_dethereal_dethereal__manage_controls(action: 'list')`. If it succeeds, use the **brownfield** path. If it fails, use the **greenfield** path.

## Step 1: Enforcement Controls (Category 2)

Enforcement controls protect boundaries and their components. Process **one boundary at a time** with incremental persistence.

### Path Selection

Three factors determine the path: **platform reachability**, **`rank` outcome**, and **whether the element has an assigned class**.

| Platform reachable? | `rank` outcome | Element has assigned class? | Path |
|---|---|---|---|
| no | n/a | n/a | **Path 3** (name-only `{id: null}`) — defer Control creation to next online sync |
| yes | ≥1 candidate | n/a | **Path 1** (brownfield) — use the candidate's `controlId` |
| yes | empty | **yes** | **Path 2** (file-first greenfield) — write `controls/<temp-id>.json` with `lifecycle: "greenfield"` and a `classes[]` binding; let `/dethereal:sync push` create the platform Control |
| yes | empty | no | **Path 3** (name-only `{id: null}`) |

**Why row 3 matters.** The empty-`rank` case used to fall through to Path 3 by default, which silently dropped the ControlClass binding required for countermeasure derivation. For class-bound elements, Path 2 (file-first) is the correct default — it preserves the binding while letting the operator iterate on attributes locally before commit.

**Path 1 procedure (brownfield):**
1. For each boundary, collect all element types within it (PROCESS, STORE, EXTERNAL_ENTITY, etc.)
2. Call `mcp__plugin_dethereal_dethereal__manage_controls(action: 'rank', element_types: [...], module_id: '<active-module-id>')`
3. Present the pre-ranked batch table (see format below). User confirms, modifies, or adds additional controls.
4. If all candidates are `weak`, recommend creating a new control rather than reusing a poor match — drop into Path 2 for that boundary.

**Path 2 procedure (file-first greenfield with class binding):**
1. Pick a temporary local id: `greenfield-<short-uuid>`.
2. Discover candidate ControlClasses. An element's own class assignment is a **ComponentClass**, NOT a ControlClass — never write it into `classes[]`. Instead, use the control idea (and the element's class/type/category as context) as search input: call `mcp__plugin_dethereal_dethereal__match_classes(elements: [{name: "<control idea>", description: "<mechanism / what it protects>"}], classLabel: 'CONTROL', moduleIds: [...], topN: 3)`. Fallback when matching is unavailable: browse `mcp__plugin_dethereal_dethereal__get_classes(class_type: 'CONTROL')` for the active modules.
3. Write `controls/<temp-id>.json` with `lifecycle: "greenfield"`, **one `classes[]` entry per applicable ControlClass**, and `attributes` populated from observed code/IaC (empty `{}` is valid). When several ControlClasses describe the same real-world mechanism (e.g. Encryption-at-Rest + PG-TDE + KMS for one database encryption setup), create ONE Control with one `classes[]` entry per class — never one Control per class.
4. Write `{ id: "<temp-id>", name: "...", source: "declared" }` to the element's `controls[]` in `structure.json` / `dataflows.json`.
5. Full layout in [Per-Control Configuration Files](#per-control-configuration-files-controlsidjson) below.

**Path 3 procedure (name-only):**
1. Present the greenfield prompt (see format below). User describes controls as free-text.
2. Write `{ id: null, name: "...", source: "declared" }` to the element's `controls[]`.
3. The platform creates a Control by name on next sync but it will NOT be bound to any ControlClass.

**Error recovery:** If `rank` fails for a boundary (network error, auth expired), treat the platform as unreachable — fall back to Path 3 for that boundary. Do not retry or stall. Log: "Platform unreachable — switching to local control entry for this boundary."

**Offline ≠ blocked.** "Platform unreachable" only means `rank` cannot pre-suggest matches and `push` cannot persist right now. Path 2 (file-first) remains achievable offline — author the `controls/<temp-id>.json` locally and the `mcp__plugin_dethereal_dethereal__manage_controls(action: 'create', …)` call happens at the next online `/dethereal:sync push`, atomically as part of the WAL-backed greenfield-promotion flow (CL Appendix A.5). Choose Path 2 whenever attributes matter and the element has a class; choose Path 3 only when no class binding is desired.

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
If option 1: identify crown-jewel boundaries (those containing components with `crownJewel: true` in `structure.json`). Process these first (reduces effective B to ~3-4). After completing crown-jewel boundaries, offer to continue with remaining boundaries.

**Crown-jewel component sweep.** After the per-boundary enforcement pass, for each `crownJewel: true` component confirm at least one **component-scoped** control beyond the controls inherited from its boundary, or record (one line) why boundary-level protection suffices. The surface report measures coverage per component per tier — a crown jewel that merely inherits the boundary firewall otherwise looks "covered" without anything protecting it specifically.

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

### Control ID vs ControlClass ID — Critical

The `id` in a `controls[]` entry is a **Control ID** (instance from the org's control library), never a **ControlClass ID** (abstract type defined by a module). Mixing them up causes `resolveControls()` to fail with "Could not resolve control" on sync.

| Path | What you have | What to write to `controls[]` |
|------|---------------|-------------------------------|
| Path 1 — Brownfield (`rank` returned candidates) | `controlId` from a candidate row | `{ id: "<controlId>", name: "<controlName>", source: "declared" }` |
| Path 2 — Greenfield with class binding (`rank` empty AND element has assigned class) | `controlClassId`s discovered via `match_classes(classLabel: 'CONTROL')` (the element's own class is a ComponentClass — never valid here) | **Default:** use the file-first path documented in [Per-Control Configuration Files](#per-control-configuration-files-controlsidjson) — write `controls/<temp-id>.json` with `lifecycle: "greenfield"`, one `classes[]` entry per applicable ControlClass, and let `/dethereal:sync push` create the platform Control. **Legacy alternative:** call `mcp__plugin_dethereal_dethereal__manage_controls(action: 'create', name: "<descriptive name>", class_ids: ["<controlClassId-1>", "<controlClassId-2>"], element_ids: ["<element-id>"])` first; the tool returns `{ control: { id, name } }`; THEN write `{ id: "<new-control-id>", name: "<descriptive name>", source: "declared" }` to `structure.json`. The legacy path skips the file-first benefits (local iteration on attributes before commit) but works for non-attribute use cases. |
| Path 3 — Greenfield name-only (`rank` empty AND element has no class, OR platform unreachable) | Nothing | `{ id: null, name: "<descriptive name>", source: "declared" }`. Platform creates a Control by name on next sync but it will not be bound to any ControlClass. |

**Never** write `{ id: "<controlClassId>", name: "..." }` — the ID lookup will fail.

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
- Walk the `defaultBoundary` tree to find the target boundary or component by id
- Merge new control references into the **boundary's or component's `controls[]` field on the structural object itself** (not into a nested `attributes` field)
- Write updated `structure.json`

This ensures partial progress survives if the agent hits its turn limit.

**Critical — controls do NOT go in attribute files:** Other enrichment data (encryption_in_transit, monitoring_tools, auth_failure_mode, etc.) is written to `attributes/boundaries/<id>.json` or `attributes/components/<id>.json`. Controls are different — they go in `structure.json` as a top-level field on the element. The sync pipeline only reads `controls[]` from `structure.json` (boundaries and components) and `dataflows.json` (data flows). Controls written to attribute files are silently ignored at sync time and never become Control relationships on the platform.

Example — correct placement in `structure.json`:
```json
{
  "defaultBoundary": {
    "id": "root",
    "boundaries": [
      {
        "id": "dmz-uuid",
        "name": "DMZ",
        "controls": [                                       // ← HERE
          { "id": null, "name": "WAF", "source": "declared" }
        ],
        "components": [
          {
            "id": "api-uuid",
            "name": "API Server",
            "controls": [                                   // ← OR HERE
              { "id": "ctrl-encryption", "name": "TLS 1.3", "source": "discovered" }
            ]
          }
        ]
      }
    ]
  }
}
```

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
5. Write detection controls to the appropriate element's `controls[]` field in `structure.json` (boundary or component) or `dataflows.json` (data flow). Same destination as enforcement controls — see the Persistence note in Step 1. Detection controls do NOT go in `attributes/<...>/<id>.json`.
6. **Class binding:** apply the same Path Selection as Step 1 — when a matching ControlClass exists in active modules (e.g. a SIEM/monitoring/EDR class, discovered via `match_classes(classLabel: 'CONTROL')`), bind the detection Control via Path 1/Path 2 so the platform can derive countermeasures. Fall back to name-only (`{ id: null, ... }`) only when no class matches — a name-only detection Control generates no countermeasures.

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

## Per-Control Configuration Files (`controls/<id>.json`)

Per-instance ControlClass attributes (the values on each `IS_INSTANCE_OF` edge between a Control and its ControlClass) do **not** go inline in `structure.json` / `dataflows.json`. They live in a separate `controls/<control-id>.json` file per Control. The `controls[]` arrays in `structure.json` / `dataflows.json` continue to carry only the minimal `{ id, name, source }` reference shape.

See [CONTROL_LIBRARY.md §3](../../../docs/architecture/dethereal/CONTROL_LIBRARY.md#3-proposed-layout--controls-folder) for the full layout and [§4](../../../docs/architecture/dethereal/CONTROL_LIBRARY.md#4-per-control-file-schema) for the complete file schema.

### Greenfield Controls (local-authored, not yet on platform)

When you need a Control that does not exist in the org's control library and that you want bound to one or more ControlClasses (so the platform auto-generates countermeasures):

**Grouping rule.** A Control models one real-world mechanism, and one mechanism is often described by several ControlClasses. When multiple ControlClasses apply to the same mechanism (e.g. Encryption-at-Rest + PG-TDE + KMS for one database encryption setup, or WAF + Rate Limiting for one edge policy), create **ONE Control with one `classes[]` entry per class — never one Control per class**. Discover the candidate classes via `match_classes(classLabel: 'CONTROL')` as described in Path 2 above.

1. Choose a temporary local id: `greenfield-<short-uuid>`.
2. Write `controls/<temp-id>.json`:
   ```json
   {
     "id": "greenfield-abc",
     "name": "Customer WAF Policy",
     "source": "declared",
     "lifecycle": "greenfield",
     "classes": [
       {
         "classId": "<controlClass-uuid-1>",
         "className": "Web Application Firewall",
         "moduleId": "<module-uuid>",
         "attributes": {
           "inbound_firewall_enabled": true,
           "default_inbound_policy": "log_only"
         }
       },
       {
         "classId": "<controlClass-uuid-2>",
         "className": "Rate Limiting",
         "moduleId": "<module-uuid>",
         "attributes": {
           "rate_limit_enabled": true
         }
       }
     ]
   }
   ```
3. Write `{ "id": "greenfield-abc", "name": "Customer WAF Policy", "source": "declared" }` to the element's `controls[]` in `structure.json` (or `dataflows.json`).
4. Populate `attributes` from observed code/IaC evidence; empty object `{}` is valid if nothing is observed yet.

**On the next `/dethereal:sync push`**, the pipeline creates the Control on the platform, sets attributes per class, assigns SUPPORTS edges, writes the server-generated id back into both the file and all `controls[]` references, and flips `lifecycle: "brownfield"`.

**Atomic ID rebinding.** A naive implementation of the above leaves the operator's local `controls/greenfield-abc.json` file orphaned — the platform issues `ctrl-uuid-123`, the structure is repointed to `ctrl-uuid-123`, but the *file* is still named `greenfield-abc.json`. The WAL rename (CL Appendix A.9 + the `pending-id-rewrite.json` journal) closes this seam: the engine writes a journal entry **before** invoking `createControl`, then rewrites `structure.json` / `dataflows.json` references AND renames `controls/greenfield-abc.json → controls/ctrl-uuid-123.json` as a single atomic operation. A crash mid-operation leaves the journal on disk; the next push (or `/dethereal:sync repair-wal`) replays it. The operator never sees an orphaned greenfield file.

**Supersedes the old eager-create path.** The previous pattern — calling `mcp__plugin_dethereal_dethereal__manage_controls(action: 'create', class_ids: [...])` during the control pass and writing the returned id — is retained only for non-attribute-binding use cases. For greenfield Controls **with** class bindings, use the file-first path above; it lets you iterate on attributes locally before committing to the platform.

### Brownfield Controls (platform-authoritative)

When you assign an existing platform Control to a model element, the auto-pull at the start of `/dethereal:enrich --focus controls` populates `controls/<id>.json` with the platform's current state. Treat this file as a **read-only cache by default**.

**Do not modify `classes[].attributes` unless the user explicitly asks.** Controls are reusable entities — the same `ctrl-waf-123` may be assigned to five other models. Your local edit will trigger a platform mutation that changes the Control for every model that references it.

If the user asks to update attributes (e.g. "the firewall's default policy is actually `log_only`, not `deny`"):

1. Read the current `classes[<idx>].attributes` values for the keys you're about to change.
2. Populate `classes[<idx>].pendingEdit`:
   ```json
   {
     "editedBy": "agent",
     "editedAt": "<iso-timestamp>",
     "previousAttributes": {
       "default_inbound_policy": "deny"
     }
   }
   ```
   The `previousAttributes` block is keyed by the changed attribute name only (NOT the full payload) — on push, this key set determines which keys are sent to the platform (partial payload).
3. Update `classes[<idx>].attributes` with the new values.
4. Bump `classes[<idx>].localEditedAt` to the current ISO timestamp.
5. Warn the user: "This edit will trigger the shared-ownership safety prompt at sync time. Push-anyway writes to every model that references this Control."

**Two-write rule.** If `pendingEdit` already exists on a class entry and you're making a second edit to the *same* key, **do not overwrite** `pendingEdit.previousAttributes[k]` — the original pre-edit value is the operator's intent baseline. Only add entries for keys not already recorded.

### Sync-Owned Fields (Never Touch Directly)

The agent **must not** directly mutate these fields on `controls/<id>.json`:

| Field | Owned by |
|---|---|
| `classes[].pushedAt` | Push path (set on successful `setInstantiationAttributes`) |
| `classes[].platformAttributes` | Pull path (snapshot of last-known-server payload) |
| `platformState.lastPushedAt` | Push path |
| `platformState.lastSyncedAt` | Pull path (never bumped by push) |
| `platformState.assignedModelIds` / `assignedModelCount` | Pull path (cached; never used as source of truth by the safety check) |
| `lifecycle` | Sync state machine (transitions documented in [CONTROL_LIBRARY.md §5](../../../docs/architecture/dethereal/CONTROL_LIBRARY.md#5-lifecycle-greenfield--brownfield)) |

Touching these fields directly breaks the drift-detection and shared-ownership-safety guarantees the sync pipeline depends on.

### File Discovery

- `controls/<id>.json` exists for every Control (greenfield or brownfield) that any element in this model references.
- If a `controls[]` entry in `structure.json` / `dataflows.json` has an `id` but no corresponding `controls/<id>.json` file, the sync pipeline will materialise one on the next pull (for brownfield) or reject the push (for greenfield — a greenfield reference without a config file means the operator hand-edited a reference without creating the attributes).
- Orphan `controls/<id>.json` files (no element references the id) produce a validator warning, not an error — they're kept for operator-driven recovery.

### Division of Labour: `/dethereal:sync pull` vs `/dethereal:enrich --focus controls`

The per-Control file lifecycle is owned jointly by two skills:

| Skill | When | What it does to `controls/` |
|---|---|---|
| `/dethereal:sync pull` (L4.5) | Every pull | Calls `pull-controls` for every Control id discovered in the freshly-pulled `structure.json` + `dataflows.json`. The local `controls/` directory ends self-consistent with the platform state. |
| `/dethereal:enrich --focus controls` (Step 1) | Operator-initiated enrichment pass | Calls `pull-controls` for the same id set as a defensive refresh, then iterates classes for sparse-attribute prompts. The pull is largely a no-op when `enrich` runs immediately after a fresh `sync pull`. |
| `/dethereal:sync push` (P7.1) | Every push | Auto-detects local edits / external drift / partial-pushed state. Uses local `controls/<id>.json` as authoritative; never re-pulls implicitly. |

This division guards against a silent-drift class: without the L4.5 step, `sync pull` would refresh structure/dataflows but leave `controls/` stale, so the operator's local view would diverge from the platform until the next `enrich --focus controls`. With it, `sync pull` returns a self-consistent directory.

## Multi-Class Control Evaluation

When the `rank` action returns candidates, the scoring is pre-computed:

- `score = (compatible_configured / total_classes) - (incompatible_configured / total_classes)`
- **strong** (score >= 0.8 AND zero incompatible configured): all relevant classes fit, no wrong countermeasures
- **good** (score >= 0.5): majority of classes fit, minor gaps
- **weak** (score < 0.5): more noise than signal — recommend creating a new control

Present relevance labels in the batch table. The user can always override by choosing a `weak` candidate or rejecting a `strong` one.

## Turn Budget (control pass only)

This table budgets ONLY the `--focus controls` invocation. The main enrichment flow (enrich Steps 4-14) is a SEPARATE `Agent(security-enricher)` invocation with its own 40-turn budget, whose dominant cost is `tiers × (read + evidence + confirm + write)` — do not read this table as covering the full enrichment run.

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
