# Control Enrichment Instructions

> **Self-gating:** These instructions apply only to the control assignment pass — the `/dethereal-enrich-controls` skill, which `/dethereal-enrich --focus controls` starts, and the `dethereal-security-enricher` agent's control-pass mode. In any other enrichment, IGNORE the rest of this file entirely.

## Overview

The control pass assigns security controls to model elements in three steps, ordered by control category. It runs as a **separate `dethereal-security-enricher` invocation** with its own 40-turn budget — it does NOT share the main enrichment session's budget.

**Two roles.** The `dethereal-security-enricher` agent does the work — evidence, `rank`, and the proposal tables in the formats below — and returns every table; it never asks the operator. The orchestrating skill renders each table, asks the Control Pass questions, and writes the confirmed controls (see Persistence). The agent writes nothing in this pass: every write below — control references, `controls/<temp-id>.json` files, the governance list — happens only after the operator has confirmed it, and is done by the orchestrating skill.

**Three-step sequence:**
1. Enforcement controls (Category 2) — batched per boundary
2. Detection controls (Category 3) — one global prompt
3. Governance placeholder (Category 4) — single prompt

## Prerequisites

Before starting the control pass:

1. Read `structure.json` — count boundaries (B), extract element types per boundary
2. Read existing `controls[]` arrays on boundaries, components, data flows, and data items
3. Read component attribute files — collect `monitoring_tools` values (seeds detection controls)
4. **Harvest control-implying attribute evidence** — before prompting each boundary, search `attributes/` for evidence the main enrichment already captured (`tls_enabled`, `encryption_at_rest`, `encryption_in_transit`, `implicit_deny_enabled`, `authentication_type`, `waf_*`, …) and pre-populate that boundary's proposal table with `source: "discovered"` rows. This is the same pattern Step 2 uses for `monitoring_tools` — evidence gathered during enrichment must not be re-asked or thrown away at control time.
5. Check platform connectivity: attempt `dethereal_query_controls(action: 'list')`. If it succeeds, use the **brownfield** path. If it fails, use the **greenfield** path. **If that tool is not among your tools**, you cannot see the control library — which does not mean the platform is offline: build greenfield tables, mark each `library not checked`, and return them. The main conversation then matches each proposed control against the library with `rank` (Path 1) before it asks the table's question, so no library control is proposed as a new one.

## Step 1: Enforcement Controls (Category 2)

Enforcement controls protect boundaries and their components. Process **one boundary at a time** with incremental persistence.

### Path Selection

Three factors determine the path: **platform reachability**, **`rank` outcome**, and **whether the element has an assigned class**.

**Controls the operator adds** in a free-text answer are never written from that text: resolve each through this table, add it with its proposed ControlClass bindings to the boundary's greenfield table, show the table and ask `controls-boundary-bindings` again. Write it with `source: "declared"`, and its attribute values only through `control-library-edits`.

| Platform reachable? | `rank` outcome | Element has assigned class? | Path |
|---|---|---|---|
| no | n/a | n/a | **Path 3** (name-only `{id: null}`) — records nothing on the platform; must be promoted to Path 1/2 when online |
| yes | ≥1 candidate | n/a | **Path 1** (brownfield) — use the candidate's `controlId` |
| yes | empty | **yes** | **Path 2** (file-first greenfield) — write `controls/<temp-id>.json` with `lifecycle: "greenfield"` and a `classes[]` binding; let `/dethereal-sync push` create the platform Control |
| yes | empty | no | **Path 3** (name-only `{id: null}`) |

**Why row 3 matters.** The empty-`rank` case used to fall through to Path 3 by default, which silently dropped the ControlClass binding required for countermeasure derivation. For class-bound elements, Path 2 (file-first) is the correct default — it preserves the binding while letting the operator iterate on attributes locally before commit.

**Path 1 procedure (brownfield):**
1. For each boundary, collect all element types within it (PROCESS, STORE, EXTERNAL_ENTITY, etc.)
2. Call `dethereal_query_controls(action: 'rank', element_types: [...], module_id: '<active-module-id>')`
3. Build the pre-ranked batch table (see format below) and return it. The operator confirms, modifies, or adds additional controls through the orchestrating skill.
4. If all candidates are `weak`, recommend creating a new control rather than reusing a poor match — drop into Path 2 for that boundary.

**Path 2 procedure (file-first greenfield with class binding):**
1. Pick a temporary local id of the form `greenfield-<short-uuid>` and put it in the proposal. The id shape is mandatory and the **filename must equal the id** — the file is written as `controls/<id>.json` after confirmation (so a `greenfield-<suffix>` id lives at `controls/greenfield-<suffix>.json`). The validator rejects any other shape (e.g. `ctrl-tmp-*`), and a file written under a wrong name cannot be deleted to undo it — choose the right one up front rather than leaving stale stubs to clean up.
2. Discover candidate ControlClasses. An element's own class assignment is a **ComponentClass**, NOT a ControlClass — never write it into `classes[]`. Instead, use the control idea (and the element's class/type/category as context) as search input: call `dethereal_match_classes(elements: [{name: "<control idea>", description: "<mechanism / what it protects>"}], classLabel: 'CONTROL', moduleIds: [...], topN: 3)`. Fallback when matching is unavailable: browse `dethereal_get_classes(class_type: 'CONTROL', module_id, fields: ['id', 'name', 'type', 'category', 'module'])` for each active module, following `next_offset` until `truncated` is false (a changed `listing` starts it over); fetch a chosen class's template by `class_id`.
3. Return the proposal in the greenfield table: the candidate ControlClasses to bind, the attributes observed for each, and the candidates considered but not bound (see the class-selection audit below).
4. After confirmation, write `controls/<temp-id>.json` with `lifecycle: "greenfield"`, **one `classes[]` entry per applicable ControlClass**, and `attributes` populated from observed code/IaC (empty `{}` is valid). When several ControlClasses describe the same real-world mechanism (e.g. Encryption-at-Rest + PG-TDE + KMS for one database encryption setup), create ONE Control with one `classes[]` entry per class — never one Control per class.
5. Then write `{ id: "<temp-id>", name: "...", source: "declared" }` to the element's `controls[]` in `structure.json` / `dataflows.json` / `data-items.json`.
6. Full layout in [Per-Control Configuration Files](#per-control-configuration-files-controlsidjson) below.

**Path 3 procedure (name-only):**
1. Return the greenfield table (see format below). The operator describes controls as free-text through the orchestrating skill.
2. After confirmation, write `{ id: null, name: "...", source: "declared" }` to the element's `controls[]`.
3. **No Control is created by this.** On the next push the entry must link to a Control of the org's **existing** library with exactly this name — the same after Unicode normalisation (NFC), with invisible default-ignorable characters removed and spaces trimmed; never a case-insensitive or partial match. No such Control, or several, refuses the whole push until the operator decides the entry (Control references). A link binds no ControlClass, so no countermeasures are derived.
4. So use the library's exact name when you know it, and prefer Path 1 whenever `rank` can supply the `controlId`.
5. Treat Path 3 as a **deferral, not a record**. Report these entries as "captured locally, not yet on the platform", and once the platform is reachable promote each one to Path 1 (bind the ranked `controlId`) or Path 2 (author `controls/<temp-id>.json`, then `push-greenfield`).

**Error recovery:** If `rank` fails for a boundary (network error, auth expired), treat the platform as unreachable — fall back to Path 3 for that boundary. Do not retry or stall. Log: "Platform unreachable — switching to local control entry for this boundary."

**Offline ≠ blocked.** "Platform unreachable" only means `rank` cannot pre-suggest matches and `push` cannot persist right now. Offline, a boundary's controls are recorded by name (Path 3, as the table says) and promoted to Path 1 or 2 when the control pass runs online again. Online, choose Path 2 (file-first) whenever attributes matter and the element has a class: the `controls/<temp-id>.json` is authored locally and the platform Control is created at the next `/dethereal-sync push`, as part of the journal-backed greenfield promotion of the control library. Choose Path 3 only when the element has no class **and** you expect a Control of that exact name to already exist in the library — Path 3 creates nothing.

**Offline coverage is assignment, not mitigation.** `dethereal_validate_model_json` (`action: 'coverage'`) run offline reports **assignment coverage** — which exposures have a control assigned to their element — and tags the result `coverage_kind: "assignment-heuristic"`. A control with zero countermeasures still counts. Never report an offline "N/N, 100%" result as "N exposures mitigated"; label it "assignment coverage (offline heuristic)". Real mitigation coverage requires the platform's MITRE-chain analysis (`model_id` + auth).

**Push-failure recovery (sanctioned path).** A `push-greenfield` that fails at the per-class `setInstantiationAttributes` step leaves the control at `lifecycle: "partially-pushed"` — the local file is preserved, with the instantiation attributes intact, precisely so the push can be resumed. Recover in one of two ways, never by deleting and recreating:

1. **Fix the cause, then re-run `push-greenfield` with the SAME control id.** The pipeline resumes from `partially-pushed`, re-attempting only the unpushed class entries (idempotent). The most common cause is a wrong-kind class binding — the failure message now names it ("class … is a ComponentClass — a Control can only bind ControlClass"). Re-bind to a real CONTROL class via `dethereal_match_classes` (`classLabel: 'CONTROL'`), **fetch that class's template with `dethereal_get_classes` (`class_id`, `fields: ['attributes', 'guide']`) and fill its instantiation attributes**, then resume.
2. If the control already exists on the platform and only its local state is wrong, use `set-local-edited` + `push-brownfield` rather than a fresh create.

**Never** recover with bare `dethereal_manage_controls` (`action: 'create'`) + `assign`: that orphans the `partially-pushed` file and, because no `setInstantiationAttributes` runs, leaves every class binding with empty attributes — the module then emits **no countermeasures** for the control. After any class re-bind, the binding's instantiation attributes must be re-populated from the new class's template before the work is considered done.

### Boundary Count Handling

**Zero boundaries (B=0):**
Return a single global enforcement proposal; the operator is asked which enforcement controls protect the whole system. Assign controls to the model root or individual components.

**Standard (1 <= B <= 6):**
One prompt per boundary, sequential. Write controls after each boundary confirmation.

**Large models (B > 6):**
Offer staged options — (1) crown-jewel boundaries only, (2) all boundaries, (3) skip — which the orchestrating skill puts to the operator. If option 1: identify crown-jewel boundaries (those containing components with `crownJewel: true` in `structure.json`). Process these first (reduces effective B to ~3-4). After completing crown-jewel boundaries, the orchestrating skill offers to continue with the remaining boundaries.

**Crown-jewel component sweep.** After the per-boundary enforcement pass, for each `crownJewel: true` component propose at least one **component-scoped** control beyond the controls inherited from its boundary, or a one-line reason why boundary-level protection suffices; the operator confirms either through the orchestrating skill. The surface report measures coverage per component per tier — a crown jewel that merely inherits the boundary firewall otherwise looks "covered" without anything protecting it specifically.

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
```

### Control ID vs ControlClass ID — Critical

The `id` in a `controls[]` entry is a **Control ID** (instance from the org's control library), never a **ControlClass ID** (abstract type defined by a module). Mixing them up refuses the push with `control_id_not_found` (Control references).

| Path | What you have | What to write to `controls[]` |
|------|---------------|-------------------------------|
| Path 1 — Brownfield (`rank` returned candidates) | `controlId` from a candidate row | `{ id: "<controlId>", name: "<controlName>", source: "declared" }` |
| Path 2 — Greenfield with class binding (`rank` empty AND element has assigned class) | `controlClassId`s discovered via `dethereal_match_classes` (`classLabel: 'CONTROL'`) (the element's own class is a ComponentClass — never valid here) | **Default:** use the file-first path documented in [Per-Control Configuration Files](#per-control-configuration-files-controlsidjson) — write `controls/<temp-id>.json` with `lifecycle: "greenfield"`, one `classes[]` entry per applicable ControlClass, and let `/dethereal-sync push` create the platform Control. **Legacy alternative:** call `dethereal_manage_controls(action: 'create', name: "<descriptive name>", class_ids: ["<controlClassId-1>", "<controlClassId-2>"], element_ids: ["<element-id>"])` first; the tool returns `{ control: { id, name } }`; THEN write `{ id: "<new-control-id>", name: "<descriptive name>", source: "declared" }` to `structure.json`. The legacy path skips the file-first benefits (local iteration on attributes before commit) but works for non-attribute use cases. |
| Path 3 — Greenfield name-only (`rank` empty AND element has no class, OR platform unreachable) | Nothing | `{ id: null, name: "<descriptive name>", source: "declared" }`. Creates nothing: the push links it only to a library Control of exactly this name, and otherwise is refused until the operator decides it. No ControlClass is bound. Promote to Path 1 or Path 2 when the platform is reachable. |

**Never** write `{ id: "<controlClassId>", name: "..." }` — the ID lookup will fail.

### Source Field

Every `controls[]` entry carries a `source` field on its ControlReference:

| Source | Meaning | When to Set |
|--------|---------|-------------|
| `discovered` | Inferred from IaC/code attributes | Attribute evidence: `encryption_in_transit`, `authentication_type`, `implicit_deny_enabled`, `tls_enabled`, etc. |
| `declared` | Operator stated during the control pass | The operator typed or confirmed it during the questions |
| `both` | Code evidence corroborates the operator's declaration | The operator confirmed a control that code/IaC also supports |

**Rules:**
- Default to `declared` for controls added during the operator's questions
- Set `discovered` only when code evidence directly implies the control (e.g., `tls_enabled: true` implies a TLS control)
- Upgrade to `both` when the operator confirms a control that was also found in code
- The `source` field is informational — the analysis engine does not currently differentiate by source

### Assignment Level

Decide where to write control references based on what the control protects:

| Control type | Write to | Rationale |
|-------------|----------|-----------|
| Firewall, WAF, IDS/IPS | Boundary `controls[]` in `structure.json` | Protects the entire zone |
| Database encryption, application auth | Component `controls[]` in `structure.json` | Specific to the element |
| TLS, mTLS | Data flow `controls[]` in `dataflows.json` | Protects a communication path |
| Field-level encryption, tokenisation, masking | Data item `controls[]` in `data-items.json` | Applies to the data itself, not to one element that handles it |
| SIEM, monitoring | Boundary or component | Depends on coverage scope |

For boundary-scoped controls, write to the boundary's `controls[]` — not to each component individually. This avoids stale fan-out when components are added later.

A data item's `controls[]` follows a different push rule from an element's: a present list (including `[]`) replaces the item's controls, and an absent key leaves them as they are. Remove a data-item control by writing the list without it, never by deleting the key.

### Persistence

After each boundary confirmation, write controls immediately:
- Read current `structure.json`
- Walk the `defaultBoundary` tree to find the target boundary or component by id
- Merge new control references into the **boundary's or component's `controls[]` field on the structural object itself** (not into a nested `attributes` field)
- Write updated `structure.json`

Writing each boundary as soon as its answers are in keeps the confirmed controls if the pass stops early; the agent returns after a complete boundary when its turns run short, and the skill starts it again for the boundaries left.

**Critical — controls do NOT go in attribute files:** Other enrichment data (encryption_in_transit, monitoring_tools, auth_failure_mode, etc.) is written to `attributes/boundaries/<id>.json` or `attributes/components/<id>.json`. Controls are different — they go in `structure.json` as a top-level field on the element. The sync pipeline only reads `controls[]` from `structure.json` (boundaries and components), `dataflows.json` (data flows) and `data-items.json` (data items). Controls written to attribute files are silently ignored at sync time and never become Control relationships on the platform.

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
```

3. For confirmed tools from attribute files: `source: "discovered"`
4. For user-added detection tools: `source: "declared"`
5. After confirmation, write detection controls to the appropriate element's `controls[]` field in `structure.json` (boundary or component), `dataflows.json` (data flow) or `data-items.json` (data item). Same destination as enforcement controls — see the Persistence note in Step 1. Detection controls do NOT go in `attributes/<...>/<id>.json`.
6. **Class binding:** apply the same Path Selection as Step 1 — when a matching ControlClass exists in active modules (e.g. a SIEM/monitoring/EDR class, discovered via `dethereal_match_classes` (`classLabel: 'CONTROL'`)), bind the detection Control via Path 1/Path 2 so the platform can derive countermeasures. Fall back to name-only (`{ id: null, ... }`) only when no class matches — a name-only entry binds no ControlClass and generates no countermeasures, and a push refuses it until the operator decides it (`control-resolve`), unless a library Control has exactly that name.

## Step 3: Governance Placeholder (Category 4)

Single prompt, free-text, asked by the orchestrating skill. No graph entities created — documentation only.

After the answer, write the responses to `.dethereal/scope.json` as `declared_governance_controls: string[]`.

## Re-Run Behavior

When controls already exist on model elements:

1. Read existing `controls[]` from all boundaries, components, data flows, and data items
2. Present as "currently assigned" before prompting for changes:
   ```
   Currently assigned controls for [Boundary Name]:
   - WAF Protection (declared)
   - Perimeter Firewall (declared)
   ```
3. New controls are additive — never remove existing controls silently
4. Skip boundaries/components that already have controls unless the user requests modification

## Per-Control Configuration Files (`controls/<id>.json`)

Per-instance ControlClass attributes (the values on each `IS_INSTANCE_OF` edge between a Control and its ControlClass) do **not** go inline in `structure.json` / `dataflows.json` / `data-items.json`. They live in a separate `controls/<control-id>.json` file per Control. The `controls[]` arrays in `structure.json` / `dataflows.json` / `data-items.json` continue to carry only the minimal `{ id, name, source }` reference shape.

The full layout is in the Dethereal architecture document `CONTROL_LIBRARY.md` §3, and the complete file schema in `CONTROL_LIBRARY.md` §4.

### Greenfield Controls (local-authored, not yet on platform)

When you need a Control that does not exist in the org's control library and that you want bound to one or more ControlClasses (so the platform auto-generates countermeasures):

**Grouping rule.** A Control models one real-world mechanism, and one mechanism is often described by several ControlClasses. When multiple ControlClasses apply to the same mechanism (e.g. Encryption-at-Rest + PG-TDE + KMS for one database encryption setup, or WAF + Rate Limiting for one edge policy), create **ONE Control with one `classes[]` entry per class — never one Control per class**. Discover the candidate classes via `dethereal_match_classes` (`classLabel: 'CONTROL'`) as described in Path 2 above.

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
3. Write `{ "id": "greenfield-abc", "name": "Customer WAF Policy", "source": "declared" }` to the element's `controls[]` in `structure.json` (or `dataflows.json` / `data-items.json`).
4. Populate `attributes` from observed code/IaC evidence; empty object `{}` is valid if nothing is observed yet.

**On the next `/dethereal-sync push`**, the pipeline creates the Control on the platform, sets attributes per class, assigns SUPPORTS edges, writes the server-generated id back into both the file and all `controls[]` references, and flips `lifecycle: "brownfield"`.

**Atomic ID rebinding.** A naive implementation of the above leaves the operator's local `controls/greenfield-abc.json` file orphaned — the platform issues `ctrl-uuid-123`, the structure is repointed to `ctrl-uuid-123`, but the *file* is still named `greenfield-abc.json`. The WAL rename (the `pending-id-rewrite.json` journal) closes this seam: the engine invokes `createControl`, then writes a journal entry and applies it: it rewrites `structure.json` / `dataflows.json` / `data-items.json` references AND renames `controls/greenfield-abc.json → controls/ctrl-uuid-123.json` as one recoverable operation. A crash after the journal is written leaves it on disk; the next push (or `/dethereal-sync repair-wal`) replays it. One gap remains: a crash between `createControl` returning and the journal being written leaves no journal and the temporary id, so the next push creates the Control again — check the library for a duplicate of that name after such a crash.

**Supersedes the old eager-create path.** The previous pattern — calling `dethereal_manage_controls(action: 'create', class_ids: [...])` during the control pass and writing the returned id — is retained only for non-attribute-binding use cases. For greenfield Controls **with** class bindings, use the file-first path above; it lets you iterate on attributes locally before committing to the platform.

### Brownfield Controls (platform-authoritative)

When you assign an existing platform Control to a model element, the control-library pull that follows the three-step pass of `/dethereal-enrich --focus controls` populates `controls/<id>.json` with the platform's current state. Treat this file as a **read-only cache by default**.

**Do not modify `classes[].attributes` unless the user explicitly asks.** Controls are reusable entities — the same `ctrl-waf-123` may be assigned to five other models. Your local edit will trigger a platform mutation that changes the Control for every model that references it.

If the user asks to update attributes (e.g. "the firewall's default policy is actually `log_only`, not `deny`"), **never hand-edit `controls/<id>.json`.** Apply the edit through the tool:

```
dethereal_manage_controls(
  action: 'set-local-edited',
  directory_path: '<model-dir>',
  control_id: '<control-id>',
  class_idx: <index into classes[]>,
  new_attributes: { "default_inbound_policy": "log_only" },
  edited_by: 'agent'
)
```

The tool owns `classes[<idx>].attributes`, `classes[<idx>].localEditedAt`, and `classes[<idx>].pendingEdit`. Then warn the user: "This edit will trigger the shared-ownership safety prompt at sync time. Push-anyway writes to every model that references this Control."

**Why the tool and not the file.** The push payload is keyed by `pendingEdit.previousAttributes` keys **plus** `pendingEdit.firstWriteKeys`. A key with no prior value on disk cannot go in `previousAttributes` — its pre-edit value is `undefined` and JSON drops it — so it belongs in `firstWriteKeys`, which only `set-local-edited` computes. Hand-write the block and such a key lands in neither array: the local file shows the new value and the push silently never sends it. The two arrays are mutually exclusive, and the validator rejects overlap.

The resulting block (written by the tool, shown here so you can read the file):
```json
{
  "editedBy": "agent",
  "editedAt": "<iso-timestamp>",
  "previousAttributes": { "default_inbound_policy": "deny" },
  "firstWriteKeys": ["rate_limit_enabled"]
}
```
`firstWriteKeys` is present only when non-empty.

**Two-write rule.** Within one `pendingEdit` lifecycle, a key already pinned in `previousAttributes` or `firstWriteKeys` is never re-recorded — the FIRST pre-edit value is the operator's intent baseline. `set-local-edited` enforces this; do not reimplement it.

### Sync-Owned Fields (Never Touch Directly)

The agent **must not** directly mutate these fields on `controls/<id>.json`:

| Field | Owned by |
|---|---|
| `classes[].attributes` on an **existing** file | `set-local-edited` (the only path that keeps `pendingEdit` in step). Authoring a new greenfield `controls/<temp-id>.json` is exempt — `push-greenfield` sends `classes[].attributes` as written |
| `classes[].localEditedAt` | `set-local-edited` |
| `classes[].pendingEdit` | `set-local-edited` (and `promote-external-edit` for the recovery case) |
| `classes[].pushedAt` | Push path (set on successful `setInstantiationAttributes`) |
| `classes[].platformAttributes` | Pull path (snapshot of last-known-server payload) |
| `platformState.lastPushedAt` | Push path |
| `platformState.lastSyncedAt` | Pull path (never bumped by push) |
| `platformState.assignedModelIds` / `assignedModelCount` | Pull path (cached; never used as source of truth by the safety check) |
| `lifecycle` | Sync state machine (transitions documented in `CONTROL_LIBRARY.md` §5) |

Touching these fields directly breaks the drift-detection and shared-ownership-safety guarantees the sync pipeline depends on. In particular, **never hand-edit `lifecycle` or `platformState`** to "fix" a control after a platform-side change — guessing a value (e.g. `lifecycle: "pushed"`, which is not a valid state) only produces validation friction. Run `manage_controls pull-controls` to regenerate canonical files instead; it is the only sanctioned way to reconcile local state with the platform.

### File Discovery

- `controls/<id>.json` exists for every Control (greenfield or brownfield) that any element in this model references.
- If a `controls[]` entry in `structure.json` / `dataflows.json` / `data-items.json` has an `id` but no corresponding `controls/<id>.json` file, the sync pipeline will materialise one on the next pull (for brownfield) or reject the push (for greenfield — a greenfield reference without a config file means the operator hand-edited a reference without creating the attributes).
- Orphan `controls/<id>.json` files (no element references the id) produce a validator warning, not an error — they're kept for operator-driven recovery.

### Division of Labour: `/dethereal-sync pull` vs `/dethereal-enrich --focus controls`

The per-Control file lifecycle is owned jointly by two skills:

| Skill | When | What it does to `controls/` |
|---|---|---|
| `/dethereal-sync pull` (its controls-refresh step) | Every pull | Calls `pull-controls` for every Control id discovered in the freshly-pulled `structure.json` + `dataflows.json` + `data-items.json`. The local `controls/` directory ends self-consistent with the platform state. |
| `/dethereal-enrich --focus controls` (its control-library step, after the three-step pass) | Operator-initiated enrichment pass | Calls `pull-controls` for the same id set as a defensive refresh, then iterates classes for sparse-attribute prompts. The pull is largely a no-op when `enrich` runs immediately after a fresh `sync pull`. |
| `/dethereal-sync push` (its controls step) | Every push | Auto-detects local edits / external drift / partial-pushed state. Uses local `controls/<id>.json` as authoritative; never re-pulls implicitly. |

This division guards against a silent-drift class: without the controls-refresh step, `sync pull` would refresh structure/dataflows but leave `controls/` stale, so the operator's local view would diverge from the platform until the next `enrich --focus controls`. With it, `sync pull` returns a self-consistent directory.

## Multi-Class Control Evaluation

When the `rank` action returns candidates, the scoring is pre-computed:

- `score = (compatible_configured / total_classes) - (incompatible_configured / total_classes)`
- **strong** (score >= 0.8 AND zero incompatible configured): all relevant classes fit, no wrong countermeasures
- **good** (score >= 0.5): majority of classes fit, minor gaps
- **weak** (score < 0.5): more noise than signal — recommend creating a new control

Present relevance labels in the batch table. The user can always override by choosing a `weak` candidate or rejecting a `strong` one.

**Class-selection audit (report contract).** A Control binding exactly one class is legitimate (one mechanism, one good-fit class), but the *reasoning* must be observable. For each control, the control-pass report (and the relay table the orchestrator renders before confirmation) names the **other candidate ControlClasses considered and why they were not bound** — e.g. "bound Identity & Access Management; considered MFA Enforcement and RBAC but the evidence shows neither mechanism". This keeps the multi-class grouping rule auditable without changing behavior: a single-class binding made after weighing alternatives reads differently from one made by never looking.

## Turn Budget (control pass only)

This table budgets ONLY the control pass. The main attribute enrichment runs separately (inline in the enrich skill, or in its own agent run for the guided workflow) — do not read this table as covering it.

The agent's part of the control pass fits its 40-turn budget; the orchestrating skill's questions and writes are its own:

| Step | Greenfield | Brownfield |
|------|------------|------------|
| Context loading (read model, attributes, scope) | 3 | 3 |
| Enforcement per boundary (B boundaries) | B x 2 (prompt + write) | B x 3 (rank + prompt + write) |
| Detection controls | 2 (prompt + write) | 3 (rank + prompt + write) |
| Governance placeholder | 1 | 1 |
| Validation | 1 | 1 |
| **Total (B=4)** | **12** | **16** |
| **Total (B=6)** | **16** | **22** |

For B > 6: use staged prompts (crown-jewel boundaries first) to keep effective B at 3-4.

## Footer

At the end of the control pass in the enrich-controls skill:

```
[done] Control pass complete. N enforcement, M detection, K governance controls assigned. Quality: X/100. State: <display_state>.
       Attribute enrichment: P controls updated, Q keys edited across R classes.
[next] When you're ready: /dethereal-sync push (publish; shared controls ask for confirmation there)
       /dethereal-status (inspect pending edits and lifecycle distribution)
```

Omit the attribute line if the control library step did not run.
