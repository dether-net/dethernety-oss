# Dethernety Threat Model — File Format Reference

Schema version: `2.0.0`. Format: `split` (one file per concern).

**ID convention:** All `id` fields accept either a **work-name** (e.g., `b-system`, `c-postgres`, `f-api-db`) or a **UUID**. During initial model creation, use descriptive work-names with type prefixes (`b-` boundary, `c-` component, `f-` flow, `di-` data item). After platform import, the server replaces these with permanent UUIDs. IDs must be unique within the model and contain only `[a-zA-Z0-9_-]`.

## manifest.json

```json
{
  "schemaVersion": "2.0.0",
  "format": "split",
  "model": {
    "id": null,
    "name": "Model Name",
    "description": "Optional description",
    "defaultBoundaryId": "<id-of-root-boundary>"
  },
  "files": {
    "structure": "structure.json",
    "dataFlows": "dataflows.json",
    "dataItems": "data-items.json",
    "attributes": "attributes"
  },
  "modules": [
    { "id": "<module-uuid>", "name": "dethernety" }
  ]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `schemaVersion` | `"2.0.0"` | Yes | Fixed literal |
| `format` | `"split"` | Yes | Always `"split"` for directory-based models |
| `model.id` | ID or `null` | Yes | `null` for new models; server assigns on import |
| `model.name` | string | Yes | Human-readable model name |
| `model.description` | string | No | |
| `model.defaultBoundaryId` | ID | Yes | Must match the `id` of `structure.defaultBoundary` |
| `files` | object | No | File path references (always the same literals for split format) |
| `modules` | ModuleReference[] | Yes | Modules providing class definitions. Derived by the server (the entries listed here, the scope's `activeModules`, and the modules of the classes the model uses); a push writes it. `[]` for a new model |

## structure.json

Top-level has a single `defaultBoundary` field containing the root boundary. Boundaries nest recursively — child boundaries and components are embedded **inline** within their parent boundary:

```
defaultBoundary (root)
├── boundaries[]           ← child boundaries, each containing their own:
│   ├── components[]       ← components inside this child boundary
│   └── boundaries[]       ← nested boundaries (recursive)
│       ├── components[]
│       └── boundaries[]   ← ...and so on
└── components[]           ← components directly in the root boundary
```

Each boundary's `boundaries` and `components` arrays hold the full objects, not references. This means the entire model hierarchy is a single nested tree rooted at `defaultBoundary`.

### StructureBoundary

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | ID | Yes | Work-name during creation (e.g., `b-dmz`); UUID after import |
| `name` | string | Yes | |
| `description` | string | No | |
| `positionX` | number | No | Pixels, relative to parent boundary (0,0 = top-left) |
| `positionY` | number | No | |
| `dimensionsWidth` | number | No | Width in pixels |
| `dimensionsHeight` | number | No | Height in pixels |
| `dimensionsMinWidth` | number | No | Minimum width constraint |
| `dimensionsMinHeight` | number | No | Minimum height constraint |
| `parentBoundary` | `{ id: ID }` | No | Omit for root boundary |
| `classData` | ClassReference \| null | No | Class assignment (enables attributes). Explicit `null` unassigns on the next `dethereal_update_model` push (the platform deletes the class's auto-generated exposures, keeping user-authored ones); an absent key leaves the binding untouched |
| `zone` | `"UNTRUSTED"` `"PUBLIC"` `"EXPOSED"` `"INTERNAL"` `"RESTRICTED"` `"VENDOR"` \| `null` | No | Trust zone. `null` or absent = inherit from the nearest declaring ancestor. Operator-facing display names in the trust-zone table of the core guidelines |
| `domains` | string[] | No | Free-text business domain tags (max 16, max 64 chars each), e.g. `["payments"]` |
| `planes` | `("WORKLOAD" \| "MANAGEMENT")[]` | No | Operational planes. Absent = Undecided (not Workload) |
| `conduits` | Conduit[] | No | Declared boundary-crossing channels — see [Conduit](#conduit). A present array (including `[]`) is reconciled on push; an absent key leaves platform conduits untouched |
| `boundaries` | StructureBoundary[] | No | Nested child boundaries |
| `components` | StructureComponent[] | No | Components inside this boundary |
| `controls` | `{ id, name? }[]` | No | Security controls applied |
| `dataItemIds` | ID[] | No | Data items scoped to this boundary |

### StructureComponent

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | ID | Yes | Work-name during creation (e.g., `c-api`); UUID after import |
| `name` | string | Yes | |
| `description` | string | No | |
| `type` | `"PROCESS"` `"EXTERNAL_ENTITY"` `"STORE"` | Yes | DFD element type |
| `positionX` | number | Yes | Relative to parent boundary |
| `positionY` | number | Yes | |
| `parentBoundary` | `{ id: ID }` | No | Reference to containing boundary |
| `classData` | ClassReference \| null | No | Explicit `null` unassigns on update; absent = untouched |
| `controls` | `{ id, name? }[]` | No | |
| `dataItemIds` | ID[] | No | Data items this component originates, processes, or stores (data at rest / in use). Valid for all component types — `STORE`, `PROCESS`, and `EXTERNAL_ENTITY` (e.g. user-originated data) |
| `crownJewel` | boolean | No | Author flag: high-value asset. **REPLACE on push** — the push always sends a definite boolean, so omitting the key or setting `false` CLEARS the flag on the platform. Carry it through whenever you rewrite `structure.json` |

## dataflows.json

Wrapper object with a `dataFlows` array:

```json
{ "dataFlows": [ ... ] }
```

### DataFlow

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | ID | Yes | Work-name during creation (e.g., `f-api-db`); UUID after import |
| `name` | string | Yes | Descriptive label (e.g., "User login request") |
| `description` | string | No | |
| `source` | `{ id: ID }` | Yes | Source component reference |
| `target` | `{ id: ID }` | Yes | Target component reference |
| `sourceHandle` | `"top"` `"right"` `"bottom"` `"left"` | No | Connection point on source |
| `targetHandle` | `"top"` `"right"` `"bottom"` `"left"` | No | Connection point on target |
| `classData` | ClassReference \| null | No | Explicit `null` unassigns on update; absent = untouched |
| `controls` | `{ id, name? }[]` | No | |
| `dataItemIds` | ID[] | No | Data items carried by this flow |

**Constraint:** `source.id` must differ from `target.id` (no self-loops).

## data-items.json

Wrapper object with a `dataItems` array:

```json
{ "dataItems": [ ... ] }
```

### DataItem

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | ID | Yes | Work-name during creation (e.g., `di-user-pii`); UUID after import |
| `name` | string | Yes | e.g., "User Credentials", "Payment Information" |
| `description` | string | No | |
| `classData` | ClassReference \| null | No | Data classification class. Explicit `null` unassigns on update; absent = untouched |
| `sensitivity` | `"public"` `"internal"` `"confidential"` `"restricted"` | No | Author-asserted sensitivity, lowercase. **REPLACE on push** — an absent key clears the platform value |
| `regulatory_flags` | string[] | No | Free-text regulatory scopes, e.g. `["PCI cardholder", "PHI"]`, in the operator's words. Never rewrite a value already written (no silent normalisation); to suggest another form, propose it in a question. **REPLACE on push** — an absent key clears the platform list |
| `origin` | `"authenticated_first_party"` `"curated_internal"` `"agent_relayed"` `"model_generated"` `"third_party"` `"arbitrary_public"` `"not_assessed"` | No | Who can write the item's content, most to least trusted; the last three are untrusted, and the least-trusted source wins. Absent = unanswered, never a guess. **REPLACE on push** |
| `is_credential` | boolean | No | The item is a credential (password, token, key, secret, certificate). `false` is an answer and is published as such; absent = unanswered. **REPLACE on push** |
| `controls` | `{ id, name? }[]` | No | Security controls applied. On push a present list (including `[]`) **replaces** the item's controls, and an **absent key leaves them as they are** — unlike a boundary, component or flow, where an absent key clears. Remove a control by writing the list without it (or `[]`), never by deleting the key |

`sensitivity` and `regulatory_flags` are first-class fields on the data item in `data-items.json` — never attribute-file keys. Together with component `crownJewel` they are the asset signals `dethereal_validate_model_json` (`action: 'zoning'`) joins on to propose a `RESTRICTED` zone. `origin` and `is_credential` are first-class fields too, never attribute-file keys.

## attributes/{type}/{elementId}.json

Per-element attribute files in the structured `ElementAttributes` format. `{type}` is the subdirectory `boundaries`, `components`, `dataFlows`, or `dataItems`; `{elementId}` is the element's `id`.

`dethereal_generate_attribute_stubs` writes each file during **classification** — before any platform import — seeding every class-template field as `null`. Edit that stub in place; do not author a flat key-value file over it (see [Legacy flat format](#legacy-flat-format-read-only)).

**Merge principle:** Always read the existing attribute file before writing. Merge new values into the existing content — never overwrite the entire file. Attribute files contain a union of two vocabularies that must coexist:

1. **Class-template fields** — defined by the element's assigned class (e.g., `requirepass_present`, `tls_enabled`). Evaluated by OPA policies to produce exposures and countermeasures.
2. **Plugin-enrichment fields** — added by the agent (e.g., `credential_scope`, `monitoring_tools`, and `crown_jewel` on boundaries, data flows and data items only — a **component's** crown-jewel flag is the first-class `crownJewel` field in `structure.json`). Used by the platform's analysis and local analysis. MITRE ATT&CK techniques are **not** a plugin-enrichment field — tactic coverage is derived server-side from `Exposure.exploitedBy` (see the tactic-coverage section of `/dethereal-surface`).

Both are stored on the same IS_INSTANCE_OF relationship in the graph. OPA evaluates the fields it knows about (template-defined); extra fields are harmlessly ignored.

### Discovering class-template fields

Call `dethereal_get_classes` (`class_id: '<uuid>', fields: ['id', 'name', 'enrich']`) for the fields the class template expects, in order, each with:

- `name`, `value_type`, `typical_values` and `enum` — the field and the values it takes;
- `description` — what it means: its definition, precondition and secure value;
- `how_to_obtain` — where to find the value (config files, IaC keys, a command to turn into a question).

A class bigger than one page comes with `enrich_next_offset` (the Enrichment Protocol's Template-driven attributes says how to page). Resolve every field you can to a concrete value — from evidence or the operator's answer — for OPA policies to fire correctly; a field left `null` is not populated (see [`null` means "not yet resolved"](#null-means-not-yet-resolved)). Use each field's `how_to_obtain` steps to discover attribute values from code, IaC, and configuration files. For attributes not discoverable from code, the enrichment protocol asks the operator (its `enrich-questions` question); never ask outside it.

### File format

```json
{
  "elementId": "c-redis",
  "elementType": "component",
  "elementName": "Redis",
  "classData": { "id": "<class-uuid>", "name": "Key-Value Store" },
  "attributes": {
    "requirepass_present": false,
    "tls_enabled": null,
    "acl_enabled": null,
    "bind_addresses": ["0.0.0.0"],
    "credential_scope": ["session-jwt-tokens"],
    "monitoring_tools": []
  },
  "modifiedAt": "2026-03-27T14:30:00Z"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `elementId` | ID | Yes | Work-name before import (e.g. `c-redis`); UUID after. **This — not the filename — is what the loader keys on**; `dethereal_generate_attribute_stubs` writes the file as `<elementId>.json`, so keep the two equal or one element ends up with two files |
| `elementType` | `"boundary"` `"component"` `"dataFlow"` `"dataItem"` | Yes | Singular — note it differs from the `{type}` directory name |
| `elementName` | string | No | Human-readable (for debugging) |
| `classData` | ClassReference | No | Class that defines the attribute schema. Written by `dethereal_generate_attribute_stubs` from the element's `classData`; absent only on an unclassified element |
| `attributes` | Record<string, unknown> | Yes | Class-template fields + plugin fields merged |
| `modifiedAt` | ISO 8601 string | No | Last modification timestamp |

### `null` means "not yet resolved"

A `null` attribute value is the enrichment checklist marker — "this class-template field exists and has no answer yet". It stays `null` while nobody has answered it, and also when the value could not be found or the operator declined it after being asked. It is **not** "not applicable" and **not** "clear this value". Three consequences follow:

- `dethereal_update_attributes` **withholds** null-valued keys from the push (counted as `withheld_unresolved`) — they never reach the platform. The push cannot clear a platform-side attribute; dropping a key leaves the platform value untouched.
- `attribute_completion_rate` counts a null as unresolved, and the field is listed in `attribute_residual.top_unresolved` (see the core guidelines).
- Reclassifying an element deletes its still-`null` template fields; non-null values are preserved.

Resolve every field you can to a concrete value from evidence or the operator's answer; otherwise leave it `null` for the enrichment protocol to ask (its `enrich-attributes` question). `false`, `"none"`, and `[]` are resolutions; `null` is not.

Never write a **stand-in** for a value you could not find or the operator declined: `"unknown"` in any case, an empty or whitespace-only string, an array of stand-ins such as `["unknown"]`, or a class template's unknown/declined sentinel. A stand-in fails Gate 3 (C2, C3, C8) with a `placeholder:` detail and can never be waived. Leave the field `null`. If the gap makes a Gate 3 criterion fail and the operator accepts it, it is recorded as a per-element waiver with the operator's reason — never as a value. Record an insecure value as observed (`false`, `"none"`, `[]`) — that is an answer, not a gap. No monitoring is `monitoring_tools: []`, never `["None"]` (the validator warns about it).

### Legacy flat format (read-only)

Older models may contain flat key-value files with a type-specific ID field (`componentId`, `boundaryId`, `flowId`, `dataItemId`) instead of `attributes`. These are still **read** — normalized on load into `ElementAttributes` — but must not be written:

- The element is resolved by `{elementType}:{name}` lookup against the structure, not by id, so a renamed element falls back to the work-name id.
- `classData` is recovered only if that name lookup hits; `modifiedAt` is never recovered.

When you encounter one, let `dethereal_generate_attribute_stubs` rewrite it into the structured format rather than extending it.

## Shared Types

### ClassReference

```json
{ "id": "<uuid>", "name": "Web Server" }
```

Optional additional fields: `description`, `type`, `category`, `module`.

### ModuleReference

```json
{ "id": "<uuid>", "name": "dethernety" }
```

### ElementReference

```json
{ "id": "<uuid>" }
```

Used for `parentBoundary`, `source`, `target` relationships.

### Conduit

A declared channel across a boundary edge, carried on `StructureBoundary.conduits`:

```json
{
  "peerId": "b-dmz",
  "peerName": "DMZ",
  "direction": "OUTBOUND",
  "justification": "Payment callbacks",
  "controlRefs": ["ctrl-mtls"]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `peerId` | ID | Yes | The boundary on the other end. Must be another boundary in this model |
| `peerName` | string | No | Denormalized for display; the peer boundary is the source of truth |
| `direction` | `"OUTBOUND"` `"INBOUND"` | Yes | Which side of the edge this boundary sits on |
| `justification` | string | No | Why the channel is approved |
| `controlRefs` | string[] | No | Control ids protecting the channel |

`dethereal_validate_model_json` raises **errors** (not warnings) on three shapes:

- **Self-conduit** — `peerId` equals the declaring boundary's own `id`.
- **Unknown peer** — `peerId` matches no boundary in `structure.json`.
- **Lone inbound** — an `INBOUND` conduit whose peer declares no matching `OUTBOUND` conduit back. Each edge is persisted once from its `OUTBOUND` side, so an unmatched `INBOUND` would be dropped on write. A lone `OUTBOUND` is fine — the inbound view is re-derived on read.

## Metadata files

The plugin keeps its own metadata next to the model files. The formats below are for reading those files; workflow state (`.dethereal/state.json`) is never read or written directly — use `dethereal_model_state`.

**`.dethernety/models.json`** — Model registry (project root), written by the tools that create, import or pull a model; never by hand

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

**`<model-path>/.dethereal/quality.json`** — Quality score cache, recorded by `dethereal_validate_model_json` (`action: 'quality'`); never written by hand. Its shape:

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
    "unclassified_open": 2,
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

**`<model-path>/.dethereal/scope.json`** — Scope definition. `crown_jewel_elements` maps each `crown_jewels` entry, verbatim, to the element ids the operator confirmed for it; it is written at the crown-jewel confirmation and stays local (never pushed); the push remaps the element ids in its values to platform ids, while the keys stay verbatim. A freshly pulled model has no map until the operator re-confirms its crown jewels.

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
  "crown_jewel_elements": {
    "User PII": ["c-db"],
    "Payment data": ["c-db", "b-payments"]
  },
  "activeModules": [
    { "id": "module-uuid", "name": "dethernety-general" }
  ]
}
```

`activeModules` is optional. If absent, classification searches all installed modules (backward compatible). The baseline module (`dethernety-general`) is always included and non-removable. Populated by the module selection step after discovery — the agent recommends modules based on discovered IaC source patterns, the user confirms.
