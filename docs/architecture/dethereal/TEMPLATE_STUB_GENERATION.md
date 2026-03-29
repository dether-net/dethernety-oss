# Template Stub Generation

The `generate_attribute_stubs` MCP tool deterministically writes class template attribute stubs to disk for classified elements. It bridges classification (assigning a platform class to an element) and enrichment (populating security attribute values) by ensuring attribute files contain the exact field names that OPA policies evaluate.

## Motivation

Attribute files are a union of two field sources:

1. **Class template fields** — defined by the platform module's JSON Schema (e.g., `ssl_enabled`, `requirepass_present`). OPA policies evaluate these fields to compute exposures.
2. **Plugin-enrichment fields** — written by the security-enricher agent (e.g., `crown_jewel`, `credential_scope`, `mitre_attack_techniques`). The Analysis Engine reads these for graph algorithms.

Without template fields on disk, OPA never fires and no exposures are created. The `generate_attribute_stubs` tool closes this gap with a single deterministic call after classification.

### Why a dedicated tool

| Alternative | Why rejected |
|-------------|-------------|
| Side-effect in `update_model` | Couples structural editing to template materialization. Classification happens locally long before any `update_model` call. |
| Hook on Write/Edit | Hooks run as shell scripts — cannot access the Apollo client for GraphQL. Cannot distinguish `classData` changes from name edits without parsing JSON diffs. |
| Enhancement to `get_classes` | `get_classes` is a read-only query tool. Writing files is a different concern. |
| Agent instructions | A 5-step instruction sequence (fetch → extract → read → merge → write) is fragile — may be skipped, produce hallucinated field names, or lose context mid-sequence. |

## Tool Interface

### Input

```typescript
z.object({
  directory_path: z.string(),
  element_ids: z.array(z.string()).optional(),
})
```

When `element_ids` is omitted, the tool auto-scans all classified elements. Safe to call unconditionally — existing enriched values are never overwritten.

### Output

```typescript
interface GenerateStubsResult {
  generated: number        // elements with new stubs written
  skipped: number          // elements already fully stubbed
  reclassified: number     // elements that changed class (old unenriched fields removed)
  cached_classes: number   // unique class templates cached
  failed: Array<{ element_id: string; reason: string }>
  warnings: string[]
}
```

## Processing Pipeline

```
1. Read structure.json, dataflows.json, data-items.json
   → collect all elements with classData (or filter by element_ids)

2. Deduplicate classIds → K unique classes from N elements

3. For each unique class:
   ┌─ Try DtClass.getClassById() via GraphQL
   │  ├─ Success → cache to .dethereal/class-cache/<classId>.json
   │  └─ Failure ─┐
   │              ▼
   │  Try .dethereal/class-cache/<classId>.json fallback
   │  ├─ Cache hit → use cached template (warn if stale >7 days)
   │  └─ Cache miss → add affected elements to failed[]
   └──────────────────────────────────────────────────────

4. For each element:
   a. Check for reclassification (manifest classId ≠ current classData.id)
      → remove unenriched (null) old template fields, keep enriched values
   b. Extract template defaults from schema properties (default ?? null)
   c. Read existing attribute file, normalize if flat format
   d. Merge: existing values win, new template fields added with defaults
   e. Write in structured ElementAttributes format
   f. Write template field manifest to .dethereal/template-fields/<elementId>.json

5. Return summary counts
```

## Merge Semantics

**Existing values always win.** The merge is an additive overlay:

```typescript
for (const [key, defaultValue] of Object.entries(templateDefaults)) {
  if (!(key in existingAttributes)) {
    existingAttributes[key] = defaultValue
  }
}
```

Consequences:
- First run: all template fields added with schema defaults or `null`
- After partial enrichment: only unenriched fields remain at defaults
- Idempotent: running twice produces identical output
- Plugin fields (`crown_jewel`, `credential_scope`, etc.) are never overwritten

### Attribute File Format

The tool always writes **structured format** (`ElementAttributes`):

```json
{
  "elementId": "uuid-abc",
  "elementType": "component",
  "elementName": "Redis",
  "classData": { "id": "class-uuid", "name": "Redis" },
  "attributes": {
    "crown_jewel": true,
    "requirepass_present": null,
    "tls_enabled": null,
    "acl_enabled": null
  }
}
```

Pre-import flat-format files are normalized via `normalizeFlatAttribute()` before merging.

## Class Cache

Location: `.dethereal/class-cache/<classId>.json`

```json
{
  "classId": "92e72e32-...",
  "className": "Redis",
  "classType": "component",
  "cachedAt": "2026-03-28T20:00:00Z",
  "template": { "schema": { "properties": { ... } } },
  "guide": [{ "option_name": "bind_addresses", "how_to_obtain": "..." }]
}
```

| Concern | Detail |
|---------|--------|
| **Written by** | `generate_attribute_stubs` (side-effect of template fetching) |
| **Read by** | Enrichment agent (guide from disk instead of re-calling `get_classes`), stub generation (offline fallback) |
| **Staleness** | >7 days produces advisory warning. Stale cache still usable — template JSON is small and changes only on module version bumps. |

## Template Field Manifest

Location: `.dethereal/template-fields/<elementId>.json`

```json
{
  "classId": "92e72e32-...",
  "className": "Redis",
  "templateFields": ["bind_addresses", "protected_mode", "requirepass_present", "tls_enabled"],
  "generatedAt": "2026-03-28T20:00:00Z"
}
```

The manifest enables clean reclassification by distinguishing template fields from plugin fields. Without it, the tool cannot know which fields to remove when an element's class changes.

## Reclassification

When an element changes from Class A to Class B:

1. Read manifest → identify Class A's template fields
2. For each old template field:
   - Value is `null` → remove (unenriched, safe to delete)
   - Value is non-null → keep (enrichment work preserved)
3. Add Class B template fields with new defaults
4. Update manifest with Class B fields

Plugin fields (`crown_jewel`, `credential_scope`, `mitre_attack_techniques`, `monitoring_tools`) are never in any manifest's `templateFields`, so they are never candidates for removal.

**Shared field names** (e.g., both MySQL and PostgreSQL have `max_connections`): if the enriched value is non-null, it survives reclassification. If unenriched, it gets the new class's default.

## Element Type Mapping

The tool handles all element types, not just components:

| Element Type | Attribute Subdir | classType (for `getClassById`) |
|-------------|-----------------|-------------------------------|
| Component (PROCESS, STORE, EXTERNAL_ENTITY) | `attributes/components/` | `component` |
| Boundary | `attributes/boundaries/` | `boundary` |
| Data Flow | `attributes/dataFlows/` | `dataflow` |
| Data Item | `attributes/dataItems/` | `data` |

## Class Deduplication

N elements with K unique classes result in K GraphQL fetches, not N. The tool builds a `Map<classId, Class>` before iterating elements, avoiding redundant network calls.

## Workflow Integration

The tool is called at two points in the threat modeling workflow:

1. **Step 3 (Model Review)** — after deterministic classification confirms class assignments
2. **Step 6 (Classification Pass 2)** — after LLM-assisted classification of remaining elements

The enrichment workflow (Step 8) then reads the template stubs as its checklist: null fields are the values to discover. The enricher reads class guides from the cache rather than re-fetching via `get_classes`.

## Implementation

- Tool: `src/tools/generate-attribute-stubs.tool.ts` (extends `ClientDependentTool`)
- Tests: `src/tools/__tests__/generate-attribute-stubs.tool.test.ts` (22 test cases)
- Registration: `src/tools/index.ts` (tool #20, in `allTools[]` and `clientDependentTools[]`)
