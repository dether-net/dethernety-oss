<!-- Imported by threat-modeler agent. See also guidelines-layout.md for coordinate/layout rules (loaded only during editing). -->

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
- Zones **inherit** down the tree to the nearest declaring ancestor; unclassified resolves to **Internal**.
- **Which tier a boundary _should_ be is computed by `validate_model_json` `action:'zoning'`** — don't reason the determination cascade inline; call the tool and render its result.

## ID Handling

- When creating new models, use **temporary reference IDs** (e.g., UUIDs you generate)
- These IDs link elements together (e.g., data flow source/target references)
- After import to the platform, the server assigns **permanent IDs** which are written back to your files
- The original temporary IDs become obsolete after import

## Best Practices

1. **Group related components** within the same boundary
2. **Name data flows** descriptively (e.g., "User credentials", "API response", "Database query")
3. **Assign classes** to elements to enable security analysis — use `get_classes` to discover available classes
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
- Use `get_classes` tool to discover available classes from installed modules

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

**Transitions:**
- **Forward**: Quality gate pass + user confirmation
- **Backward (manual)**: Explicit user request to return to an earlier state
- **Backward (automatic)**: Structural changes (adding/removing components, boundaries, flows) at ENRICHING or later → revert to STRUCTURE_COMPLETE

**On backward transition:**
- Delete `.dethereal/quality.json` (forces recomputation)
- Clear `model_signed_off` from `state.json` if present
- Add modified element IDs to `staleElements[]`

### Metadata Files

**`.dethernety/models.json`** — Model registry (project root)

```json
{
  "version": 1,
  "models": [
    {
      "name": "Production Stack",
      "path": "./threat-models/production-stack",
      "createdAt": "2026-03-27T10:00:00Z"
    }
  ]
}
```

**`<model-path>/.dethereal/state.json`** — Workflow state

```json
{
  "currentState": "ENRICHING",
  "completedStates": ["INITIALIZED", "SCOPE_DEFINED", "DISCOVERED", "STRUCTURE_COMPLETE"],
  "lastModified": "2026-03-27T14:30:00Z",
  "staleElements": [],
  "lastReconcileCommit": "abc1234..."
}
```

`lastReconcileCommit` is optional — set by `/dethereal:discover` at the end of discovery (initial baseline) and advanced by the `/dethereal:threat-model` resume path at the end of a successful drift-loop reconcile (subsequent baselines). Used as the baseline for the next `git diff`. Omitted when the project is not a git repo. See [`docs/architecture/dethereal/DRIFT_DETECTION.md`](../../../docs/architecture/dethereal/DRIFT_DETECTION.md).

**`<model-path>/.dethereal/quality.json`** — Quality score cache. Written verbatim from the `validate_model_json(action: 'quality')` payload.

```json
{
  "quality_score": 56.25,
  "label": "In Progress",
  "factors": {
    "component_classification_rate": { "value": 0.6, "weight": 25 },
    "attribute_completion_rate": { "value": 0.4, "weight": 20, "note": "Measured over 6 element(s); excluded 2 unclassified" },
    "boundary_hierarchy_quality": { "value": 1.0, "weight": 15 },
    "data_flow_coverage": { "value": 0.8, "weight": 15 },
    "data_classification_rate": { "value": 0.0, "weight": 10 },
    "control_coverage_rate": { "value": 0.0, "weight": 10 },
    "credential_coverage_rate": { "value": 0.0, "weight": 5 }
  },
  "element_counts": {
    "boundaries": 5,
    "components": 8,
    "data_flows": 12,
    "data_items": 3
  },
  "attribute_residual": {
    "declared": 40,
    "resolved": 16,
    "unresolved": 24,
    "elements_scored": 6,
    "elements_unclassified": 2,
    "elements_without_template": 0,
    "basis": "template",
    "blocked": [],
    "top_unresolved": [
      { "element": "PostgreSQL", "class": "Database", "unresolved": 9, "declared": 14, "fields": ["ssl_enabled", "log_connections"] }
    ]
  },
  "model_name": "Production Stack"
}
```

`factors[*].note` and a top-level `warnings: string[]` are present only when the tool emits them.

`attribute_residual` is the enrichment worklist behind `attribute_completion_rate` — render it, never collapse it to the single number:

- `top_unresolved` names the elements and the exact fields still unresolved (capped at 25 elements, 12 fields each). Those are the questions to go and answer.
- `blocked` lists classified elements the ratio could NOT measure, each with its `class_id` — normally because no class template is cached. Fix by running `generate_attribute_stubs`, not by re-scoring.
- `basis: "file-presence"` means no class template was cached for anything, so the factor measured whether an attribute *file* exists rather than whether fields are resolved. In that mode `elements_scored` is 0 and `blocked` is empty, and the factor carries the note "No cached class templates — measuring attribute-file presence, not resolved fields. Run generate_attribute_stubs."

Quality labels: >= 90 "Comprehensive", 70-89 "Good", 40-69 "In Progress", < 40 "Starting". Analysis readiness threshold: 70/100.

**`<model-path>/.dethereal/scope.json`** — Scope definition

```json
{
  "system_name": "Production Stack",
  "description": "React frontend, Go API, PostgreSQL database",
  "depth": "architecture",
  "modeling_intent": "initial",
  "compliance_drivers": [],
  "crown_jewels": ["User PII", "Payment data"],
  "exclusions": [],
  "trust_assumptions": [],
  "adversary_classes": [],
  "activeModules": [
    { "id": "module-uuid", "name": "dethernety-general" }
  ]
}
```

`activeModules` is optional. If absent, classification searches all installed modules (backward compatible). The baseline module (`dethernety-general`) is always included and non-removable. Populated by the module selection step after discovery — the agent recommends modules based on discovered IaC source patterns, the user confirms.

### Naming Convention

- **`.dethernety/`** (project root) — plugin-level metadata: model registry, config
- **`.dethereal/`** (per-model) — per-model workflow metadata: state, discovery, quality, scope, sync
  - `.dethereal/class-cache/<class-id>.json` and `.dethereal/template-fields/<element-id>.json` are written by `generate_attribute_stubs`. The class cache is what `attribute_completion_rate` measures against — without it the factor degrades to `basis: "file-presence"`.
