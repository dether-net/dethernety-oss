# Dethernety Coverage Tools

Dethernety Coverage Tools is a small, backend-only [`DTModule`](../modules/DT_MODULE_INTERFACE.md) that answers one question about a threat model: **for every exposure on the model's elements, which MITRE ATT&CK techniques are countered, by what kind of defensive control, and graded by how specific the evidence is.** It contributes a single GraphQL query field, runs read-only against the graph, and returns raw coverage facts as a JSON-encoded string. It deliberately produces no scores, no buckets, and no percentages — it computes the facts and leaves interpretation to whatever surface consumes them.

**What this document covers:** what the module is and is not, the one field it adds, who consumes it and why it stands alone, how to build and test it, and a map to the rest of this documentation set.

---

## Module at a glance

| | |
|---|---|
| **Kind** | Backend-only query primitive (a plain `DTModule`, not built on an OPA or analysis base class) |
| **Surface** | One GraphQL query field: `gradedCoverage(modelId: ID!): String` |
| **Output** | A JSON-encoded `CoverageResult` — raw, element-scoped, disposition-agnostic coverage facts |
| **Data access** | Read-only Cypher over the secure, session-scoped graph driver |
| **Authorization** | None of its own — the platform's JWT guard and per-session database scoping own access |
| **Frameworks used** | MITRE ATT&CK (techniques, tactics, mitigations) and MITRE D3FEND (defensive techniques, tactics, OWL-derived artifacts) |
| **Database** | Bolt/Cypher — portable across Neo4j and Memgraph |
| **Dependencies** | None on other modules; assumes ATT&CK/D3FEND data is present in the graph |

### What it is

- A **reusable graph query primitive**. It walks the model's exposures, resolves the ATT&CK techniques each exposure is `EXPLOITED_BY`, and reports which element-supporting countermeasures counter those techniques across three graded tiers.
- **Element-scoped by construction.** A technique counts as covered for an exposure only when the covering countermeasure's parent `Control` supports the exposed element (or the boundary it belongs to). Coverage on some other element does not leak in.
- **Pure at its core.** Four small Cypher reads feed a single pure aggregation function, which makes the merge, classification, and partitioning logic unit-testable against fixtures.

### What it is not

- **Not a threat-modeling module.** It declares no component, data-flow, boundary, data, or control classes; it adds nothing to the diagram and nothing to the class registry.
- **Not an analysis module.** It declares no `AnalysisClass`, runs no AI, starts no chat, and stores no analysis state. It contributes a query field and nothing else.
- **Not a presentation layer.** It emits no percentage, no single "covered" count, no tier bucketing, no disposition filtering, and no detect-only reduction. Those are consumer concerns (see [Raw-facts contract](#the-raw-facts-contract)).
- **Not an authorization boundary.** It neither adds nor broadens scope; it runs only what the session-scoped driver already permits.

---

## The single GraphQL field

The module extends the root `Query` type with exactly one field:

```graphql
extend type Query {
  """Graded, element-scoped, disposition-agnostic MITRE coverage facts for a model, as a JSON-encoded string."""
  gradedCoverage(modelId: ID!): String
}
```

The returned `String` is JSON. Parsing it yields a `CoverageResult` object: every exposure on the model's elements, the ATT&CK technique set each exposure is exploited by, and per technique which **tiers** cover it, by which **function** (prevent or detect), and which countermeasures and parent controls supplied the evidence. The full shape is documented field by field in [coverage-facts.md](./coverage-facts.md).

The field is returned as a JSON string (rather than a declared GraphQL object type) on purpose: it keeps the coverage payload from being interpreted as a graph node by the schema layer, and it matches the convention the consuming report surface already uses for its own custom field.

---

## The three coverage tiers

All three tiers count as real coverage — they differ only in the *specificity* of the evidence, not in whether the control exists. Each is element-scoped before the tier hop runs.

| Tier | Path from countermeasure to the exposed technique | Character |
|------|---------------------------------------------------|-----------|
| **DIRECT** | `Countermeasure -[:COUNTERMEASURE_MITIGATES \| _PROTECTS_AGAINST \| _DETECTS \| _ISOLATES]-> MitreAttackTechnique` | Author-asserted; the optional enrichment most controls lack, so this tier is often empty |
| **INDIRECT — Mitigation** | `Countermeasure -[:RESPONDS_WITH]-> MitreAttackMitigation -[:MITIGATION_DEFENDS_AGAINST_TECHNIQUE]-> MitreAttackTechnique` | Catalogue-precise; always preventive |
| **INDIRECT — D3FEND** | `Countermeasure -[:RESPONDS_WITH]-> MitreDefendTechnique → (shared MitreDefend*Entity artifact) ← MitreAttackTechnique` | Broad / low-specificity; bridged through an OWL-derived, untyped artifact link |

The mechanics of each tier, the prevent/detect classification rules, and why the broad D3FEND bridge stays bounded are documented in [architecture.md](./architecture.md).

---

## Who consumes it, and why it stands alone

Coverage facts are genuinely multi-consumer, which is why this logic lives in its own module rather than being inlined into any single tool. The element-support join and the DIRECT/Mitigation reasoning mirror the platform's own control-gap analysis; this module generalizes that into a standalone, gradable primitive and adds the DIRECT and D3FEND tiers.

The primary consumer today is the **Dethernety Threat Report** module, whose Coverage & Gaps surface reads these raw facts and then applies its own live-only disposition filter, its tier-segregated presentation, the detect-only reduction, and any percentage it chooses to show. See the [Dethernety Threat Report architecture](../dethernety-threat-report/README.md).

Keeping coverage as a primitive means each consumer applies its own interpretation policy over one consistent set of facts, instead of every consumer re-deriving the graph traversal.

---

## Build and test

```bash
cd oss/modules/dethernety-coverage-tools

pnpm build        # tsc compile + package into dist/{name}-{version}.tar.gz
pnpm test         # vitest — exercises the pure aggregator against fixtures
pnpm dev          # tsc -w (watch compile)
pnpm clean        # remove dist/
```

The test suite targets the pure aggregator (`aggregateCoverage`), which assembles the final `CoverageResult` from flat Cypher rows. Because that function is pure, its tier merge, soft/uncovered partition, and prevent/detect mapping are verified deterministically against fixtures; the *graph* correctness of the four Cypher reads is verified against a live graph.

---

## Documentation map

| Document | What it covers |
|----------|----------------|
| **README.md** (this file) | Orientation, the single field, the tiers at a glance, consumers, build/test |
| [architecture.md](./architecture.md) | Design and mechanics: the pure-module shape, the resolver and scoped driver, the three-tier graded bridge, element scoping, prevent/detect rules, anchor-first query design, the four-query + pure-aggregator structure, the raw-facts contract, and database portability |
| [coverage-facts.md](./coverage-facts.md) | The output contract: the `gradedCoverage` field, field-by-field tables for every interface in `CoverageResult`, the tier/function enums, soft/uncovered semantics, and exactly what a consumer must add |

---

## Source

The module source lives at [`oss/modules/dethernety-coverage-tools/`](../../../modules/dethernety-coverage-tools/):

| File | Role |
|------|------|
| `src/DethernetyCoverageToolsModule.ts` | The module shell: metadata, the schema extension, the resolver, the scoped session, and the four Cypher reads |
| `src/aggregateCoverage.ts` | The pure aggregator and every exported result interface |
| `manifest.json` / `package.json` | Module manifest and package definition |
