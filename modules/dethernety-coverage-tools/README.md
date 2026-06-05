# dethernety-coverage-tools

A shared, backend-only **`DTModule`** that provides **graded, element-scoped,
disposition-agnostic MITRE coverage facts** as a single GraphQL query field. No
frontend, no threat-modelling classes, no AI/analysis — just a reusable graph
query primitive. It exists as its own module (rather than inlined in any one
consumer) because coverage is genuinely multi-consumer.

## What it provides

```graphql
extend type Query {
  """Graded, element-scoped, disposition-agnostic MITRE coverage facts, JSON-encoded."""
  gradedCoverage(modelId: ID!): String
}
```

The returned string is JSON: for every exposure on the model's elements, its
`EXPLOITED_BY` ATT&CK technique set, and per technique which **tiers** cover it,
by which **function** (prevent/detect) and which countermeasures.

## The three coverage tiers

A technique is **covered for an exposure** only when the covering countermeasure's
parent `Control` `SUPPORTS` the exposed element (or its boundary) — element scope
is a correctness property, not a feature. All three tiers count; they differ in
*specificity*, not in whether the control is real:

| Tier | Path to the technique |
|------|-----------------------|
| **DIRECT** | `Countermeasure -[:COUNTERMEASURE_MITIGATES\|_PROTECTS_AGAINST\|_DETECTS\|_ISOLATES]-> MitreAttackTechnique` (author-asserted) |
| **INDIRECT — Mitigation** | `Countermeasure -[:RESPONDS_WITH]-> MitreAttackMitigation -[:MITIGATION_DEFENDS_AGAINST_TECHNIQUE]-> Technique` |
| **INDIRECT — D3FEND** | `Countermeasure -[:RESPONDS_WITH]-> MitreDefendTechnique → (shared MitreDefend\*Entity artifact) ← Technique` (broad / low-specificity) |

`detect` vs `prevent` is read from `MitreDefendTechnique -[:SUB_TECHNIQUE_OF|ENABLES*0..]-> MitreDefendTactic`
(Detect ⇒ detective; Harden / Isolate ⇒ preventive) and from the DIRECT relationship
type (`_DETECTS` ⇒ detective).

## Raw-facts contract

The output is deliberately **raw**: no disposition filter, no tier bucketing, **no
percentage, no single "Covered: N"**, and no detect-only reduction. A consuming
surface applies its own live-only disposition filter, presentation, and the
"detective-only iff no preventive edge survives at any tier" reduction.

## Design notes

- **Anchor-first**: each tier query pins the element-support join + the exposure's
  exploited technique *before* the tier hop, so the broad D3FEND artifact bridge
  is a bounded existence test to a pinned technique — never an enumeration. No
  explicit fan-out cap is needed.
- The DIRECT/Mitigation tiers + the element-support join mirror the platform's
  `control-gaps-resolver`; this module adds the DIRECT and D3FEND tiers and emits
  **no coverage percentage**.
- Read-only; uses only the secure session-scoped driver; adds no authz.

## Build

```bash
pnpm build        # tsc + package (dist/{name}-{version}.tar.gz)
pnpm test         # vitest — the pure aggregator over fixtures
```
