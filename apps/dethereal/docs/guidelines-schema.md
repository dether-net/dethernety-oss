<!-- Loaded by threat-modeler agent and editing skills. Defines the exact file format for split-file models. -->

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
| `modules` | ModuleReference[] | Yes | Modules providing class definitions. Use `get_classes` to discover |

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
| `classData` | ClassReference \| null | No | Class assignment (enables attributes). Explicit `null` unassigns on the next `update_model` push (the platform deletes the class's auto-generated exposures, keeping user-authored ones); an absent key leaves the binding untouched |
| `zone` | `"UNTRUSTED"` `"PUBLIC"` `"EXPOSED"` `"INTERNAL"` `"RESTRICTED"` `"VENDOR"` \| `null` | No | Trust zone. `null` or absent = inherit from the nearest declaring ancestor. Operator-facing display names in guidelines-core.md |
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
| `regulatory_flags` | string[] | No | Free-text regulatory scopes, e.g. `["PCI cardholder", "PHI"]`. **REPLACE on push** — an absent key clears the platform list |

`sensitivity` and `regulatory_flags` are first-class fields on the data item in `data-items.json` — never attribute-file keys. Together with component `crownJewel` they are the asset signals `validate_model_json(action: 'zoning')` joins on to propose a `RESTRICTED` zone.

## attributes/{type}/{elementId}.json

Per-element attribute files in the structured `ElementAttributes` format. `{type}` is the subdirectory `boundaries`, `components`, `dataFlows`, or `dataItems`; `{elementId}` is the element's `id`.

`generate_attribute_stubs` writes each file during **classification** — before any platform import — seeding every class-template field as `null`. Edit that stub in place; do not author a flat key-value file over it (see [Legacy flat format](#legacy-flat-format-read-only)).

**Merge principle:** Always read the existing attribute file before writing. Merge new values into the existing content — never overwrite the entire file. Attribute files contain a union of two vocabularies that must coexist:

1. **Class-template fields** — defined by the element's assigned class (e.g., `requirepass_present`, `tls_enabled`). Evaluated by OPA policies to produce exposures and countermeasures.
2. **Plugin-enrichment fields** — added by the agent (e.g., `credential_scope`, `monitoring_tools`, and `crown_jewel` on boundaries, data flows and data items only — a **component's** crown-jewel flag is the first-class `crownJewel` field in `structure.json`). Used by the Analysis Engine and local analysis. MITRE ATT&CK techniques are **not** a plugin-enrichment field — tactic coverage is derived server-side from `Exposure.exploitedBy` (see `/dethereal:surface` §5).

Both are stored on the same IS_INSTANCE_OF relationship in the graph. OPA evaluates the fields it knows about (template-defined); extra fields are harmlessly ignored.

### Discovering class-template fields

Call `get_classes(class_id: '<uuid>', fields: ['attributes', 'guide'])` to retrieve:

- **`attributes`** — JSON Schema defining the exact fields and types the class template expects. Resolve **all** fields to concrete values for OPA policies to fire correctly — a field left `null` is not populated (see [`null` means "not yet resolved"](#null-means-not-yet-resolved)).
- **`guide`** — Configuration guide with per-attribute entries:
  - `option_name` — the field name
  - `option_description` — what it means
  - `security_impact` — why it matters for security
  - `how_to_obtain` — where to find the value (config files, CLI commands, IaC keys)

Use the guide's `how_to_obtain` instructions to systematically discover attribute values from code, IaC, and configuration files. For attributes not discoverable from code, ask the user targeted class-specific questions.

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
    "monitoring_tools": ["None"]
  },
  "modifiedAt": "2026-03-27T14:30:00Z"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `elementId` | ID | Yes | Work-name before import (e.g. `c-redis`); UUID after. **This — not the filename — is what the loader keys on**; `generate_attribute_stubs` writes the file as `<elementId>.json`, so keep the two equal or one element ends up with two files |
| `elementType` | `"boundary"` `"component"` `"dataFlow"` `"dataItem"` | Yes | Singular — note it differs from the `{type}` directory name |
| `elementName` | string | No | Human-readable (for debugging) |
| `classData` | ClassReference | No | Class that defines the attribute schema. Written by `generate_attribute_stubs` from the element's `classData`; absent only on an unclassified element |
| `attributes` | Record<string, unknown> | Yes | Class-template fields + plugin fields merged |
| `modifiedAt` | ISO 8601 string | No | Last modification timestamp |

### `null` means "not yet resolved"

A `null` attribute value is the enrichment checklist marker — "this class-template field exists and nobody has answered it yet". It is **not** "not applicable", "unknown", or "clear this value". Three consequences follow:

- `update_attributes` **withholds** null-valued keys from the push (counted as `withheld_unresolved`) — they never reach the platform. The push cannot clear a platform-side attribute; dropping a key leaves the platform value untouched.
- `attribute_completion_rate` counts a null as unresolved, and the field is listed in `attribute_residual.top_unresolved` (see guidelines-core.md).
- Reclassifying an element deletes its still-`null` template fields; non-null values are preserved.

Resolve every field to a concrete value. `false`, `"none"`, and `[]` are resolutions; `null` is not.

### Legacy flat format (read-only)

Older models may contain flat key-value files with a type-specific ID field (`componentId`, `boundaryId`, `flowId`, `dataItemId`) instead of `attributes`. These are still **read** — normalized on load into `ElementAttributes` — but must not be written:

- The element is resolved by `{elementType}:{name}` lookup against the structure, not by id, so a renamed element falls back to the work-name id.
- `classData` is recovered only if that name lookup hits; `modifiedAt` is never recovered.

When you encounter one, let `generate_attribute_stubs` rewrite it into the structured format rather than extending it.

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

`validate_model_json` raises **errors** (not warnings) on three shapes:

- **Self-conduit** — `peerId` equals the declaring boundary's own `id`.
- **Unknown peer** — `peerId` matches no boundary in `structure.json`.
- **Lone inbound** — an `INBOUND` conduit whose peer declares no matching `OUTBOUND` conduit back. Each edge is persisted once from its `OUTBOUND` side, so an unmatched `INBOUND` would be dropped on write. A lone `OUTBOUND` is fine — the inbound view is re-derived on read.
