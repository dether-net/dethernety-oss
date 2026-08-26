# Template Stub Generation

The `generate_attribute_stubs` MCP tool deterministically writes class template attribute stubs to disk for classified elements. It bridges classification (assigning a platform class to an element) and enrichment (populating security attribute values) by ensuring attribute files contain the exact field names that OPA policies evaluate.

## Motivation

Attribute files are a union of two field sources:

1. **Class template fields** — defined by the platform module's JSON Schema (e.g., `ssl_enabled`, `requirepass_present`). OPA policies evaluate these fields to compute exposures.
2. **Plugin-enrichment fields** — written by the security-enricher agent (e.g., `crown_jewel`, `credential_scope`, `monitoring_tools`). The Analysis Engine reads these for graph algorithms. MITRE ATT&CK tactic coverage is **not** a plugin-enrichment field — it is derived server-side from `Exposure.exploitedBy` after analysis (see [BACKEND_DELEGATION.md §3](BACKEND_DELEGATION.md#mitre-tactic-coverage-derivation)).

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
   b. Collect the field NAMES from the class schema's properties
      → seed every one as null (schema `default`s are deliberately not read)
   c. Read existing attribute file, normalize if flat format
   d. Merge: existing values win, absent template fields added as null
   e. Write in structured ElementAttributes format
   f. Write template field manifest to .dethereal/template-fields/<elementId>.json

5. Return summary counts
```

## Merge Semantics

**Existing values always win.** The merge is an additive overlay, and every field it adds is seeded `null`:

```typescript
const templateFieldSeeds: Record<string, unknown> = {}
for (const key of Object.keys(templateProps)) {
  templateFieldSeeds[key] = null
}

const mergedAttributes = { ...existingAttributes }
for (const [key, seedValue] of Object.entries(templateFieldSeeds)) {
  if (!(key in mergedAttributes)) {
    mergedAttributes[key] = seedValue
  }
}
```

**Schema `default`s are never seeded.** Only `Object.keys()` of the class schema's `properties` is read; the property values, defaults included, are not. A `default` is authoring-time metadata — "what this attribute usually is" — not an observation about *this* element, and nothing downstream of the attribute file (sync → graph edge → policy input) records where a value came from. Writing a default would make an assumption indistinguishable from a discovered fact.

It would also silently shrink the enrichment checklist. The enricher's contract is that **null fields are the work list**; a field pre-filled from its default is not null, so it is skipped by construction and ships as an assertion nobody made. The default is not lost — the full class template is written to the class cache, so the enricher can still consult it as a suggestion.

Consequences:
- First run: every template field added as `null`
- After partial enrichment: only unenriched fields remain `null`
- Idempotent: running twice produces identical output
- Plugin fields (`crown_jewel`, `credential_scope`, etc.) are never overwritten
- Reclassification cleanup can safely equate `=== null` with "unenriched" (see §Reclassification)

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
  "componentType": "STORE",
  "cachedAt": "2026-03-28T20:00:00Z",
  "template": { "schema": { "properties": { ... } } },
  "guide": [{ "option_name": "bind_addresses", "how_to_obtain": "..." }]
}
```

| Concern | Detail |
|---------|--------|
| **Written by** | `generate_attribute_stubs` (side-effect of template fetching) |
| **Read by** | Enrichment agent (guide from disk instead of re-calling `get_classes`), stub generation (offline fallback), `validate_model_json` for both `attribute_completion_rate` and the component-type check below |
| **Staleness** | >7 days produces advisory warning. Stale cache still usable — template JSON is small and changes only on module version bumps. |
| **Keyed by** | CLASS id, which survives the local-id → platform-id remap on push. This is why the quality score measures enrichment from the cache rather than from the element-keyed template-field manifests. |

`componentType` is written whenever the fetched class reports a `type`, and omitted otherwise. For a component class it is the declared `PROCESS | STORE | EXTERNAL_ENTITY` — distinct from `classType` above, which is the element category (`component`, `boundary`, `dataflow`, `data`). Only components consume it. Nothing else on disk carries it, so persisting it is what lets `validate_model_json(action: 'validate')` warn offline when a component's own type disagrees with the type its assigned class describes. That mismatch matters because the class's Rego policy is written for the type it declares — see [THREAT_MODELING_WORKFLOW.md §4](THREAT_MODELING_WORKFLOW.md#classification-flow) for the `componentType` filter that prevents it at classification time.

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

**The manifest is keyed by ELEMENT id, so it is re-keyed whenever ids change on disk.** A push mints platform ids for locally created elements; the manifests are renamed onto the new ids in the same operation, on both the create/import path and the `update_model` re-export path. Without that rename the lookup by the element's *current* id always misses, and reclassification cleanup silently stops pruning the previous class's fields. The rename is best-effort — losing a manifest costs one reclassification cleanup, never model data, so it never fails a push that already succeeded platform-side. `.dethereal/state.json`'s `staleElements[]` is re-keyed alongside it; see [THREAT_MODELING_WORKFLOW.md §1](THREAT_MODELING_WORKFLOW.md#methodology-state-machine).

## Reclassification

When an element changes from Class A to Class B:

1. Read manifest → identify Class A's template fields
2. For each old template field:
   - Value is `null` → remove (unenriched, safe to delete)
   - Value is non-null → keep (enrichment work preserved)
3. Add Class B template fields as `null`
4. Update manifest with Class B fields

Plugin fields (`crown_jewel`, `credential_scope`, `monitoring_tools`) are never in any manifest's `templateFields`, so they are never candidates for removal.

**Shared field names** (e.g., both MySQL and PostgreSQL have `max_connections`): if the enriched value is non-null, it survives reclassification. If unenriched it is `null`, so it is removed in step 2 and re-seeded `null` in step 3 — indistinguishable from having been left alone, which is the point.

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
- Tests: `src/tools/__tests__/generate-attribute-stubs.tool.test.ts` (25 test cases)
- Registration: `src/tools/index.ts` (tool #20, in `allTools[]` and `clientDependentTools[]`)
