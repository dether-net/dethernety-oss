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
| `classData` | ClassReference | No | Class assignment (enables attributes) |
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
| `classData` | ClassReference | No | |
| `controls` | `{ id, name? }[]` | No | |
| `dataItemIds` | ID[] | No | |

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
| `classData` | ClassReference | No | |
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
| `classData` | ClassReference | No | Data classification class |

## attributes/{type}/{elementId}.json

Per-element attribute files. Written during enrichment in flat format (agent authoring); normalized to structured format after platform import.

**Merge principle:** Always read the existing attribute file before writing. Merge new values into the existing content — never overwrite the entire file. Attribute files contain a union of two vocabularies that must coexist:

1. **Class-template fields** — defined by the element's assigned class (e.g., `requirepass_present`, `tls_enabled`). Evaluated by OPA policies to produce exposures and countermeasures.
2. **Plugin-enrichment fields** — added by the agent (e.g., `crown_jewel`, `credential_scope`, `mitre_attack_techniques`, `monitoring_tools`). Used by the Analysis Engine and local analysis.

Both are stored on the same IS_INSTANCE_OF relationship in the graph. OPA evaluates the fields it knows about (template-defined); extra fields are harmlessly ignored.

### Discovering class-template fields

Call `get_classes(class_id: '<uuid>', fields: ['attributes', 'guide'])` to retrieve:

- **`attributes`** — JSON Schema defining the exact fields and types the class template expects. Populate **all** fields for OPA policies to fire correctly.
- **`guide`** — Configuration guide with per-attribute entries:
  - `option_name` — the field name
  - `option_description` — what it means
  - `security_impact` — why it matters for security
  - `how_to_obtain` — where to find the value (config files, CLI commands, IaC keys)

Use the guide's `how_to_obtain` instructions to systematically discover attribute values from code, IaC, and configuration files. For attributes not discoverable from code, ask the user targeted class-specific questions.

### Agent authoring format (pre-import)

Agents write flat key-value files with a type-specific ID field. The file contains both class-template fields and plugin-enrichment fields:

```json
{
  "componentId": "c-redis",
  "name": "Redis",
  "type": "STORE",
  "requirepass_present": false,
  "protected_mode": false,
  "acl_enabled": false,
  "tls_enabled": false,
  "bind_addresses": ["0.0.0.0"],
  "network_policy_enabled": true,
  "persistence_enabled": true,
  "persistence_unencrypted": true,
  "monitoring_enabled": false,
  "crown_jewel": false,
  "credential_scope": ["session-jwt-tokens"],
  "stores_credentials": true,
  "mitre_attack_techniques": [
    { "id": "T1078", "name": "Valid Accounts", "rationale": "No authentication required" }
  ],
  "monitoring_tools": ["None"]
}
```

ID fields by type: `componentId`, `boundaryId`, `flowId`, `dataItemId`.

### Platform format (post-import)

After import, files are normalized to the `ElementAttributes` structure:

```json
{
  "elementId": "<server-uuid>",
  "elementType": "component",
  "elementName": "Redis",
  "classData": { "id": "<class-uuid>", "name": "Key-Value Store" },
  "attributes": {
    "requirepass_present": false,
    "tls_enabled": false,
    "acl_enabled": false,
    "crown_jewel": false,
    "credential_scope": ["session-jwt-tokens"]
  }
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `elementId` | UUID | Yes | Server-assigned after import |
| `elementType` | `"boundary"` `"component"` `"dataFlow"` `"dataItem"` | Yes | |
| `elementName` | string | No | Human-readable (for debugging) |
| `classData` | ClassReference | Yes | Class that defines the attribute schema |
| `attributes` | Record<string, unknown> | Yes | Class-template fields + plugin fields merged |
| `modifiedAt` | ISO 8601 string | No | Last modification timestamp |

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
