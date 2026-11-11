## Component Tiers

Tiers rank a model's components for enrichment depth, gate coverage and review. The server computes them — every Gate 3 result from {{tool:validate_model_json}} `action: 'gates'` reports the tier sizes — and this is the definition it applies. Never assign a tier by hand or by another rule.

External entities are never tiered. Every other component gets the **first** tier it qualifies for:

| Tier | A component is in this tier when |
|------|----------------------------------|
| **Tier 1** — internet-facing | it is an endpoint of a cross-boundary flow **and** either its zone is PUBLIC or EXPOSED, or it has a flow with an external entity whose zone is not VENDOR |
| **Tier 2** — crown-jewel-bearing or restricted | it has `crownJewel: true`; or its zone is RESTRICTED; or one of its `dataItemIds` is a mapped crown-jewel data item; or it sits inside a mapped crown-jewel boundary, at any depth |
| **Tier 3** — everything else | every other non-external component, unzoned ones included |

The terms in the table:

- **Zone of a component** — the declared or inherited zone of the boundary it sits in (the boundary's own zone, or the nearest ancestor's that declares one). A component with neither is **unzoned**. Zones proposed by {{tool:validate_model_json}} `action: 'zoning'` never count until the operator declares them.
- **Cross-boundary flow** — a flow whose two endpoints sit in different boundaries, or where exactly one endpoint is an external entity (so a flow between an external entity and a component in the same boundary crosses too). An endpoint that is a boundary sits in itself. A flow whose endpoint does not resolve is ignored.
- **Zone of an external entity** — VENDOR when its boundary's declared or inherited zone is VENDOR, otherwise UNTRUSTED, wherever it is drawn. This is why declaring every boundary INTERNAL cannot empty Tier 1: only a vetted vendor zone (declared or inherited VENDOR) stops an external entity from making its peers internet-facing.
- **Mapped crown jewels** — the element ids the operator confirmed for each `crown_jewels` entry of the scope, kept as `crown_jewel_elements` in `.dethereal/scope.json`.

Unzoned components are counted and reported with every Gate 3 result, and Gate 1 warns about each one. Tier 1 and Tier 2 are the components Gate 3 holds to the attribute and six-attribute floors (C2, C8).

### Numbering

Older guidance numbered internet-facing components **Tier 3**. They are **Tier 1** now. When reading older notes or models, translate a tier by what it meant, never by its number.

Compliance "tiers" are a different thing and are called **depth levels**.
