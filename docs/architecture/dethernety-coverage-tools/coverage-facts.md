# Coverage Facts — Output Contract

The `gradedCoverage` field returns a JSON-encoded `CoverageResult`: the complete, raw coverage picture for one model. This document is the field-by-field reference for that payload — every interface, every enum, the soft and uncovered semantics, how a consumer joins the facts to its own findings, and exactly what a consumer must add on top. It is the contract a consumer codes against.

**What this document covers:** the `gradedCoverage` field and its JSON-string return; the full `CoverageResult` structure with a table per nested interface; the tier and function enumerations; soft and uncovered semantics; the consumer join model; and the explicit list of interpretation steps the primitive deliberately omits. For how these facts are produced from the graph, see [architecture.md](./architecture.md).

---

## The field

```graphql
extend type Query {
  gradedCoverage(modelId: ID!): String
}
```

- **Argument** — `modelId: ID!`, the id of the model to compute coverage for.
- **Return** — a `String`. An empty `modelId` returns `null`; otherwise the string is `JSON.stringify(result)` of a `CoverageResult`. Parse it client-side to obtain the object documented below.

The payload is returned as a JSON string rather than a typed GraphQL object so the schema layer does not treat the coverage shape as a graph node. A consumer requests the field as a scalar and parses the result.

---

## `CoverageResult` (top level)

| Field | Type | Description |
|-------|------|-------------|
| `modelId` | `string` | The model the facts were computed for (echoes the argument). |
| `generatedAt` | `string` | ISO-8601 timestamp of when the result was assembled. |
| `exposures` | `ExposureCoverage[]` | One entry per distinct exposure on the model's elements, sorted by `exposureId`. |
| `techniques` | `Record<attackId, TechniqueInfo>` | Human-readable name and description per technique, deduped across all exposures. The key is the ATT&CK id (for example `"T1190"`). |
| `meta` | `CoverageMeta` | Aggregate counts (see below). |

The `techniques` map is deduped on purpose: a technique that appears under many exposures still carries its full name and description only once, here, rather than repeated inside every exposure.

---

## `ExposureCoverage`

One per distinct exposure.

| Field | Type | Description |
|-------|------|-------------|
| `exposureId` | `string` | The exposure's id. This is the join key to a consumer's own finding/exposure record (see [Consumer join model](#consumer-join-model)). |
| `elementId` | `string` | The id of the element the exposure sits on. |
| `elementKind` | `'Component' \| 'DataFlow' \| 'SecurityBoundary' \| 'Data' \| null` | The element's kind, read from its graph label; `null` if none of the four labels apply. |
| `soft` | `boolean` | `true` when the exposure has no `EXPLOITED_BY` technique at all (see [Soft and uncovered semantics](#soft-and-uncovered-semantics)). |
| `techniques` | `TechniqueCoverage[]` | One entry per ATT&CK technique this exposure is exploited by, sorted by `techniqueId`. Empty when `soft` is `true`. |

---

## `TechniqueCoverage`

One per `(exposure, technique)` — a single cell of the consuming coverage matrix.

| Field | Type | Description |
|-------|------|-------------|
| `techniqueId` | `string` | The ATT&CK id of the technique (the matrix row). |
| `tactics` | `string[]` | The ATT&CK tactic name(s) this technique fills — the matrix columns. Includes tactics inherited from a parent technique via the sub-technique hierarchy. |
| `covered` | `boolean` | `true` when at least one `TierFact` exists for this technique; `false` for an uncovered technique. |
| `tiers` | `TierFact[]` | The covering evidence, one entry per `(tier, function)` that has at least one contributing countermeasure. Empty when `covered` is `false`. |

`tiers` is ordered deterministically: tier order is DIRECT, then INDIRECT_MITIGATION, then INDIRECT_D3FEND; within a tier, PREVENT before DETECT.

---

## `TierFact`

One per `(tier, function)` for a covered technique.

| Field | Type | Description |
|-------|------|-------------|
| `tier` | `CoverageTier` | Which evidence tier (see [enums](#enumerations)). |
| `function` | `CoverageFunction` | `PREVENT` or `DETECT` for this tier's contribution. |
| `countermeasureIds` | `string[]` | Distinct ids of the countermeasures that contributed a covering edge at this tier and function, sorted. |
| `controlIds` | `string[]` | Distinct parent `Control` ids of those countermeasures, sorted. |

`controlIds` is the parent-control provenance of the covering evidence. A consumer uses it to detect a **supporting control that covers none of an element's gaps**: by comparing the controls credited here against the controls it knows support the element, a consumer can surface a control that is attached but contributes no coverage to any of the element's exposed techniques.

---

## `TechniqueInfo`

The deduped per-technique descriptor, keyed by ATT&CK id in `CoverageResult.techniques`.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string \| null` | Human-readable ATT&CK technique name (for example `"Exploit Public-Facing Application"`), or `null` if absent in the graph. |
| `description` | `string \| null` | Full ATT&CK description, or `null` if absent. |

---

## `CoverageMeta`

| Field | Type | Description |
|-------|------|-------------|
| `exposureCount` | `number` | Total number of `ExposureCoverage` entries. |
| `softExposureCount` | `number` | How many of those are soft (no technique). |
| `coveredPairsByTier` | `Record<CoverageTier, number>` | Distinct `(exposure, technique)` pairs covered at each tier. |
| `countermeasuresByTier` | `Record<CoverageTier, number>` | Distinct countermeasures contributing a covering edge at each tier. |

Both per-tier maps always carry all three tier keys, defaulting to `0`. These counts are aggregate facts, not a score — they do not net out across tiers (a single pair covered at two tiers counts once under each), and the module computes no percentage from them.

---

## Enumerations

### `CoverageTier`

| Value | Meaning |
|-------|---------|
| `DIRECT` | Author-asserted edge from the countermeasure to the technique. |
| `INDIRECT_MITIGATION` | The countermeasure responds with an ATT&CK mitigation that defends against the technique. |
| `INDIRECT_D3FEND` | The countermeasure's D3FEND technique shares a defensive artifact with the technique. |

### `CoverageFunction`

| Value | Meaning |
|-------|---------|
| `PREVENT` | Preventive coverage. |
| `DETECT` | Detective coverage. |

How each tier maps evidence to a function is documented in [architecture.md §5](./architecture.md#5-prevent-vs-detect-classification). In summary: DIRECT reads the relationship type (only `COUNTERMEASURE_DETECTS` is detective); Mitigation is always `PREVENT`; D3FEND derives from the D3FEND tactic (a `Detect` tactic yields `DETECT`, `Harden`/`Isolate` or a tactic-less bridge yields `PREVENT`, and a technique spanning both yields both).

---

## Soft and uncovered semantics

Two distinct "nothing here" cases must not be conflated:

| Case | Where it shows | Meaning |
|------|----------------|---------|
| **Soft exposure** | `ExposureCoverage.soft === true`, `techniques` empty | The exposure has no `EXPLOITED_BY` ATT&CK technique at all, so it cannot enter the coverage bridge. It is reported, but with an empty technique set; it is counted in `meta.softExposureCount`. |
| **Uncovered technique** | `TechniqueCoverage.covered === false`, `tiers` empty | The exposure does map to this technique, but no element-supporting countermeasure covers it at any tier. |

A soft exposure is *unmappable* (no technique to cover); an uncovered technique is *mapped but unmet*. A consumer that wants a gap list keys on the second; a consumer reporting unmapped findings keys on the first.

---

## Consumer join model

Every `ExposureCoverage.exposureId` is the same id the rest of the platform uses for that exposure. A consumer joins these facts to its own finding/exposure records on that id:

```
consumer finding/exposure id  ===  ExposureCoverage.exposureId
```

From there:

- `elementId` / `elementKind` locate the finding on the model.
- `techniques[].techniqueId` is the matrix row; `techniques[].tactics` are the columns.
- `techniques[].tiers[].countermeasureIds` and `.controlIds` give the provenance to render and to cross-check against the consumer's own record of which controls support the element.
- `CoverageResult.techniques[techniqueId]` supplies the technique's name and description for display.

---

## What a consumer must add

The primitive emits raw facts. A consuming surface owns interpretation. Concretely, a consumer is responsible for **all** of the following — the primitive provides none of them:

1. **Disposition filter.** Decide whether a recorded disposition on a finding (not applicable, false positive, risk accepted, waived, superseded, and so on) excludes it from the consumer's view. The primitive reports every exposure and every covering countermeasure regardless of disposition.
2. **Tier bucketing and presentation.** Decide how to group and display the three tiers — and whether to weight the broad D3FEND tier differently from the precise tiers.
3. **Detect-only reduction.** Apply the honesty rule "a technique is detective-only iff no preventive edge survives at any tier," if the consumer wants it. The primitive records both functions wherever the evidence exists and performs no such collapse.
4. **Any percentage or score.** Compute a coverage percentage or rollup from the raw pairs and counts, if the consumer chooses to show one. The primitive emits **no** percentage and **no** single "Covered: N."

This division is intentional and present-tense: one set of facts, computed once, interpreted independently by each consumer. The primary consumer is the [Dethernety Threat Report](../dethernety-threat-report/README.md) module's Coverage & Gaps surface, which applies its own live-only disposition filter, tier presentation, detect-only reduction, and an honest no-percentage view.

---

## Related documentation

| Topic | Document |
|-------|----------|
| How the facts are produced | [architecture.md](./architecture.md) |
| Module index and build/test | [README.md](./README.md) |
| Primary consumer | [../dethernety-threat-report/README.md](../dethernety-threat-report/README.md) |
| `DTModule` interface | [../modules/DT_MODULE_INTERFACE.md](../modules/DT_MODULE_INTERFACE.md) |
| Glossary (Exposure, Countermeasure, Control, Technique, Tactic, Mitigation) | [../../GLOSSARY.md](../../GLOSSARY.md) |
