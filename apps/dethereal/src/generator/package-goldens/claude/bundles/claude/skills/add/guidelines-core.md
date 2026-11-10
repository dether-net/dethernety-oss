# Dethernety Threat Model Guidelines — Core

## Component Types

| Type | Description | Data Flow Handles |
|------|-------------|-------------------|
| PROCESS | Internal system processes (APIs, services, workers) | top, right, bottom, left |
| EXTERNAL_ENTITY | External actors or systems outside trust boundary | top, right, bottom, left |
| STORE | Data storage (databases, files, caches, queues) | **left, right only** |

## Boundary Hierarchy

Boundaries represent **trust zones** and must reflect the actual architecture. Do NOT flatten the model by placing all components directly under the default boundary.

**BAD** (flat structure — loses security context):
```
defaultBoundary/
├── User (EXTERNAL_ENTITY)
├── Web Server (PROCESS)
├── API Server (PROCESS)
├── Database (STORE)
└── Cache (STORE)
```

**GOOD** (hierarchical — represents trust boundaries):
```
defaultBoundary/
├── Internet Zone/
│   └── User (EXTERNAL_ENTITY)
├── DMZ/
│   └── Web Server (PROCESS)
└── Internal Network/
    ├── Application Tier/
    │   └── API Server (PROCESS)
    └── Data Tier/
        ├── Database (STORE)
        └── Cache (STORE)
```

**Why hierarchy matters:**
- Security analysis uses boundary crossings to identify threats
- Flat models cannot detect trust boundary violations
- Network zones, cloud VPCs, containers should be separate boundaries
- External entities should ALWAYS be in a separate boundary from internal systems

### Trust zones, planes, domains

A boundary can carry a trust `zone`, operational `planes`, and free-text `domains`. **Raw enums live only in on-disk JSON; operator-facing copy always uses the display names below** (this table is the single source for that mapping):

| On-disk `zone` | Display name |
|---|---|
| `UNTRUSTED` | Open internet |
| `PUBLIC` | Internet-facing |
| `EXPOSED` | DMZ |
| `INTERNAL` | Internal |
| `RESTRICTED` | Restricted |
| `VENDOR` | Trusted external |
| _conduit_ | approved channel |

- `planes`: `WORKLOAD` / `MANAGEMENT` — affirmative default **Undecided** (distinct from Workload).
- `domains`: free-text business tags (e.g. "payments", "identity").
- Zones **inherit** down the tree to the nearest declaring ancestor; unclassified resolves to **Internal** for display, but counts as **unzoned** for tiers.
- **Which zone a boundary _should_ be in is computed by `mcp__plugin_dethereal_dethereal__validate_model_json` `action:'zoning'`** — don't reason the determination cascade inline; call the tool and render its result. Proposed zones are advice: only a declared or inherited zone counts for component tiers (see Component Tiers).

## ID Handling

- When creating new models, use **temporary reference IDs** (e.g., UUIDs you generate)
- These IDs link elements together (e.g., data flow source/target references)
- After import to the platform, the server assigns **permanent IDs** which are written back to your files
- The original temporary IDs become obsolete after import

## Best Practices

1. **Group related components** within the same boundary
2. **Name data flows** descriptively (e.g., "User credentials", "API response", "Database query")
3. **Assign classes** to elements to enable security analysis — use `mcp__plugin_dethereal_dethereal__get_classes` (a `class_type`, `fields: ['id', 'name']`) to find classes
4. **Use data items** to classify sensitive data types (PII, credentials, API keys)
5. **Flow direction** typically left-to-right or top-to-bottom for readability
6. **Size boundaries** to contain all child elements with padding (min 50px)

## Modules and Classes

- Models reference **modules** that provide class definitions
- Classes define element types with attribute schemas:
  - Component classes (e.g., "Web Server", "Database", "User")
  - Boundary classes (e.g., "Trust Boundary", "Network Zone")
  - Data flow classes (e.g., "HTTPS", "SQL Query")
  - Data item classes (e.g., "PII", "Credentials", "API Key")
- `mcp__plugin_dethereal_dethereal__get_classes` `view: 'modules'` lists installed modules

## Model Directory Structure

```
model-directory/
├── manifest.json           # Model metadata, modules, file references
├── structure.json          # Boundary and component hierarchy
├── dataflows.json          # Array of data flow connections
├── data-items.json         # Array of data classification items
└── attributes/             # Per-element attribute files
    ├── boundaries/
    │   └── {boundary-id}.json
    ├── components/
    │   └── {component-id}.json
    ├── dataFlows/
    │   └── {dataflow-id}.json
    └── dataItems/
        └── {dataitem-id}.json
```

| File | Required | Purpose |
|------|----------|---------|
| manifest.json | Yes | Entry point with model metadata and module references |
| structure.json | Yes | Visual hierarchy of boundaries and components |
| dataflows.json | No | Connections between elements (can be empty array) |
| data-items.json | No | Data classifications (can be empty array) |
| attributes/ | No | Class-specific attributes for elements |

## State Management

### Workflow States

Models progress through 6 states:

```
INITIALIZED → SCOPE_DEFINED → DISCOVERED → STRUCTURE_COMPLETE → ENRICHING → REVIEWED
```

The state lives in `.dethereal/state.json` and belongs to the server: read it (`action: 'get'`) and change it only through `mcp__plugin_dethereal_dethereal__model_state` — never edit the file.

**Transitions:**
- **Forward**: the step's gate passes + user confirmation — `action: 'transition'` with `to`. `REVIEWED` is accepted only when Gates 2 and 3 pass (`action: 'gates'`). A failing criterion can be covered only by a per-element waiver through `mcp__plugin_dethereal_dethereal__model_state_waive`, and only through Gate 3's tagged waiver questions (Step 9); it shows as `REVIEWED (N waivers)`.
- **Backward (manual)**: Explicit user request to return to an earlier state
- **Backward (automatic)**: Structural changes (adding/removing components, boundaries, flows) at ENRICHING or later → revert to STRUCTURE_COMPLETE

**On backward transition:** `action: 'transition'` to the earlier state. The server clears the sign-off and deletes `.dethereal/quality.json` (forcing recomputation); record the modified element IDs with `action: 'stale'`, `add`.

`get` also reports `reviewed_stale` (changed since REVIEWED) and the waivers; show both wherever the state is shown.

**Drift baseline:** the commit the next `git diff` starts from — set by the DISCOVERED transition's `commit: 'HEAD'`, or `set_baseline` with no `commit`, in `/dethereal:discover` and after a complete drift reconcile on a `/dethereal:threat-model` resume. None outside a git repo.

### Metadata Files

Examples of the registry (`.dethernety/models.json`), the quality cache and the scope are in the File Format Reference.

**`<model-path>/.dethereal/quality.json`** — Quality score cache, recorded by `mcp__plugin_dethereal_dethereal__validate_model_json` `action: 'quality'` itself, never by hand (on `quality_recorded: false`, show its warning). Score and label are reported, never a gate.

`attribute_residual` is the enrichment worklist behind `attribute_completion_rate` — render it, never collapse it to the single number:

- `top_unresolved` names the elements and the exact fields still unresolved (capped at 25 elements, 12 fields each; a summary call: 5, no fields). Those are the questions to go and answer.
- `blocked` lists classified elements the ratio could NOT measure, each with its `class_id` — normally because no class template is cached. Fix with `mcp__plugin_dethereal_dethereal__generate_attribute_stubs`, not by re-scoring.
- `basis: "file-presence"` means no class template was cached for anything, so the factor measured whether an attribute *file* exists rather than whether fields are resolved. In that mode `elements_scored` is 0 and `blocked` is empty, and the factor carries the note "No cached class templates — measuring attribute-file presence, not resolved fields. Run generate_attribute_stubs."

Quality labels: >= 90 "Comprehensive", 70-89 "Good", 40-69 "In Progress", < 40 "Starting".

**`<model-path>/.dethereal/scope.json`** — Scope definition. `activeModules` is optional. If absent, classification searches all installed modules (backward compatible). The baseline module (`dethernety-general`) is always included and non-removable. Populated by the module selection step after discovery — the agent recommends modules based on discovered IaC source patterns, the user confirms.

### Naming Convention

- **`.dethernety/`** (project root) — plugin-level metadata: model registry, config
- **`.dethereal/`** (per-model) — per-model workflow metadata: state, discovery, quality, scope, sync
  - `.dethereal/class-cache/<class-id>.json` and `.dethereal/template-fields/<element-id>.json` are written by `mcp__plugin_dethereal_dethereal__generate_attribute_stubs`. The class cache is what `attribute_completion_rate` measures against — without it the factor degrades to `basis: "file-presence"`.
