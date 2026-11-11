# Trust Zoning & Conduits

How the plugin models **boundary trust zones**, **operational planes**, **business domains**, and **approved
channels (conduits)** — the data it produces in `structure.json`, the determination the `validate_model_json`
tool computes over it, and where the guided workflow ratifies it.

> **Declared intent, not enforcement.** Zoning records how trust *is meant to* flow. It is **not** a verified or
> enforced verdict — the platform does not compute conduit legality or prove isolation. Whether the real flows
> match the declared intent is the job of **security analysis**, which reads zoning as the baseline. See the
> user guide [BOUNDARY_TRUST_ZONES.md](../../user/BOUNDARY_TRUST_ZONES.md) and the persisted graph contract in
> [backend/LLD/SCHEMA.md](../backend/LLD/SCHEMA.md) (§ Zoning) / [GRAPHQL_API_REFERENCE.md](../backend/GRAPHQL_API_REFERENCE.md).

---

## 1. Data model (in `structure.json`)

Each boundary in `structure.json` may carry four zoning fields, alongside its hierarchy:

| Field | Shape | Meaning |
|-------|-------|---------|
| `zone` | `Zone \| null` | Trust/exposure tier. **`null` = inherit** from the nearest declaring ancestor (default `INTERNAL`). |
| `planes` | `Plane[]` | Operational planes, e.g. `WORKLOAD` / `MANAGEMENT`. A management plane resolving to an exposed tier is a finding. |
| `domains` | `string[]` | Free-text business-function tags (e.g. `"payments"`, `"identity"`). Advisory grouping — not an input to the tier *cascade*, but the `cross-tier-domain` finding reads them (§2.4). |
| `conduits` | `Conduit[]` | Declared **approved channels** to peer boundaries — a directional, flattened list; peers referenced by `peerId`. |

**`Zone`** is the exposure gradient `UNTRUSTED → PUBLIC → EXPOSED → INTERNAL → RESTRICTED`, plus `VENDOR`
(trusted-external). **Zone is a property of a trust *segment* (a leaf), not of a structural container** — see §2.

**`Conduit`** shape (on the source boundary): `{ peerId, direction: 'OUTBOUND' | 'INBOUND', justification?, controlRefs? }`.
Conduits are written **OUTBOUND-canonical** — a crossing is recorded once, as `OUTBOUND` on the source; the inbound
view is re-derived on read. The plugin authors only `justification` (declared intent); it does **not** populate
`controlRefs` (enforcement is an analysis-time concern). A conduit's `peerId` is a boundary id and is remapped
through the platform id-mapping on import/update alongside every other id.

---

## 2. Determination — `validate_model_json(action: 'zoning')`

The tool computes, over the local files, a per-boundary trust proposal and a set of advisory findings
(`packages/dt-core/src/dt-boundary/zone-determination.ts`). The plugin **computes; it never asks the LLM to
walk the tree**.

### 2.1 The cascade (first match wins — the order is the dependency order)

1. **External entity** → `UNTRUSTED` (open/unknown) or `VENDOR` (vetted partner).
2. **Reachable from an external source** → `PUBLIC` (directly, the front door) or `EXPOSED` (one hop behind a
   public edge, the DMZ). **Exposure outranks asset pull** — a crown jewel sitting in a DMZ stays `EXPOSED`
   (a *misplacement* finding), never silently re-labelled.
3. **High-value asset + ingress only from directly-connected `INTERNAL`/`RESTRICTED` peers** → `RESTRICTED`.
4. Otherwise → `INTERNAL` (the residual).

**Inheritance** (`resolveEffectiveZone`): a boundary with `zone: null` resolves to the nearest ancestor that
declares one; nothing up the chain → default `INTERNAL`. A structural container with `null` is transparent —
inheritance keeps walking through it.

### 2.2 Structural-container abstention (nested models)

A boundary that **nests child boundaries** (a VPC, a Kubernetes cluster, a cloud account) usually spans several
tiers at once, so it has **no well-defined single zone**. The engine marks such a boundary `structural: true` and
it **abstains**: it is proposed no zone, its false `unclassified` finding is suppressed, and it stays in scope via
its planes + controls. Trust classification lives at the **leaves** — exposure *sinks to the deepest modeled
boundary*, so an external flow into a pod lands on that pod's namespace, not the enclosing cluster.

Asset findings run at the **direct** holder, not rolled-up ancestors: a purely structural wrapper above a crown
jewel is not falsely flagged `under-protected`, while a crown jewel held *directly* in a container still
promotes/flags. The determinant is **structure + computed tiers**, not any boundary type/category taxonomy.

**Display roll-up.** So a container's abstention is legible rather than silent, the full-phase payload carries an
optional `summary` on each structural boundary — a **display-only view-model**, never written to `zone` and never
read by the cascade/resolver/finding emission (`computeContainerSummary` in dt-core). It reports the exposure
`range` (`min`…`max`) and `maxExposure` across the container's leaf segments, `containsAssets` / `containsVendor` /
`reachesExternal` presence flags, and `unclassifiedDescendants` (leaf segments still resolving to the default zone
— the coverage prompt). The model-reviewer renders it as `— structural · spans <min>…<max>` with the presence
suffixes. Two deliberate properties: it is built from **computed** tiers (`determineZoneTier` per leaf), so it is
*self-correcting against trust-level mislabels* — a child mislabelled `INTERNAL`/`RESTRICTED`/`PUBLIC`/`EXPOSED`
can't inflate it (it is **not** self-correcting against `UNTRUSTED`/`VENDOR`, which are declaration-driven
externality inputs the engine treats as authoritative); and `VENDOR` is kept **off the exposure gradient** — a
vetted-partner enclave surfaces as `containsVendor`, never as a range endpoint. The roll-up is emitted only in the
full phase; the Step-4 skeleton shows the bare `— structural` glyph.

### 2.3 Phasing (default-then-promote)

`RESTRICTED` needs the flow graph and asset classification, which don't exist at boundary-refinement time. So the
tool runs in two phases via the `assets` parameter: `assets: 'skeleton'` (Step 4) sets external + exposure tiers +
the `INTERNAL` default and **defers `RESTRICTED`**; the full pass (close of Step 7) **proposes** promoting a
boundary once assets exist — only where the computed tier is `RESTRICTED` and the declared zone is `null` or
`INTERNAL` — and the workflow writes only the rows the operator confirms.

### 2.4 Findings (advisory, never sync-blocking)

`unclassified` (no zone in the chain), `under-protected` (a direct asset holder looser than `RESTRICTED`),
`mgmt-plane` (a `MANAGEMENT` plane resolving to an exposed tier), `external-ingress` (an external-tier boundary
reaching a trusted tier with no approved channel, directly or through forwarders), `flow-channel` (a risk-bearing crossing vs. its declared
conduit — undeclared path, dead intent, or unreviewable declaration), and `cross-tier-domain` (a hand-authored
`domains` tag shared by two boundaries that couples an externally-reachable segment with a protected one — the
blast-radius / co-tenancy shape). All are advisory: they inform the operator and never block a sync.

**`external-ingress` sees through forwarders.** An external boundary E (declared `UNTRUSTED`/`VENDOR`) often
reaches a trusted tier T only through a relaying hop — the load balancer or proxy in front of the service — so no
single flow runs from E into T. The finding also fires for that masked crossing: E reaches a T whose resolved zone
is `INTERNAL`/`RESTRICTED` only through one or more **forwarders**, each hop a modelled flow in direction. A
forwarder is a component of the stock Load Balancer, Reverse Proxy / WAF Appliance, VPN Gateway, Firewall or
Network Router class (by class id, or by that exact class name under another id), or an unclassified `PROCESS`
named as a load balancer or proxy (`LB`/`ALB`/`NLB`/`ELB`/`WAF`, *load balancer*, *reverse proxy*, *ingress
controller*, as whole words). An API gateway or a web server terminates the request and is not a forwarder; a
classified component is judged by its class, never its name. Each forwarder must sit in a boundary that is not
external, not E, not the root, and not a trusted tier — a forwarder inside a trusted tier is already a direct
ingress onto that tier, which the direct rule reports. T is never external, E, the root, a structural container,
or a forwarder's own boundary; E and T nested in one another are excluded as for the direct rule. The engine
reports one finding per (E, T), with `boundaryId` E and `peerId` T as for a direct crossing, plus `via` (the
forwarder names in order, from the shortest path, ties broken by name then id) and `viaIds`; the detail names the
hops and the remedies — ratify a conduit to T, route it through an approved path, or declare T `EXPOSED`. There
is no hop bound, the result does not depend on flow order, and it needs no asset, so it fires in the skeleton
phase too. The direct rule is unchanged and wins: when E→T is itself a flow edge, only the direct finding appears.

**The approved channel for a masked crossing is E→T.** A conduit `OUTBOUND` on E to T (or its `INBOUND` mirror on
T) ratifies it; a conduit to the forwarder's tier does not ratify the crossing behind it. The forwarder tier's own
crossing into an asset-bearing tier is a separate channel and still raises its own `flow-channel` finding. For
dead intent, a conduit E→T has a matching flow whenever a forwarder chain connects E and T, whatever the tiers'
zones — declaring the forwarder's tier trusted later does not turn a ratified conduit dormant.

**`cross-tier-domain` makes `domains` load-bearing.** `domains` are otherwise free-text advisory tags the engine
never reads. This finding reads them: it groups non-structural boundaries by shared tag (case-folded) and fires
`info` when a tag couples an **external-tier** member (`UNTRUSTED`/`PUBLIC`/`EXPOSED`/`VENDOR`, computed) with a
**protected** member (a `directAssetIds` holder or a declared `RESTRICTED`) — i.e. owning the exposed member may
reach the protected one via a shared identity/principal or compute co-tenancy. It anchors `boundaryId` on the
protected (at-risk) member and names the exposed source in `peerId`. It deliberately fires only on the
external↔protected coupling (not on any ≥2-tier span), so a benign business-domain tag does not generate noise;
pure-internal co-tenancy and a dedicated tag namespace are out of scope for now. Because nothing auto-populates
`domains` today, the finding is **dormant until an operator tags boundaries** — it gives the "model identity /
compute as tags" guidance teeth.

> **Scope disclaimer (surfaced to the ratifier).** Zoning asserts network-reachability tiers only. Shared-identity
> blast radius and node co-tenancy are not evaluated from topology; where you hand-author matching `domains`
> tags, a heuristic flags a tag that couples an exposed and a protected tier — but a clean or tag-free result does
> not imply cross-tier isolation.

---

## 3. In the guided workflow

Zoning is ratified — never silently set — at Steps 4–7 of `/dethereal:threat-model`, and reviewed at Step 9
(`oss/apps/dethereal/workflow/skills/threat-model/SKILL.md`, with its step prose in `workflow/shared/guided-*.md`):

- **Step 4 — trust skeleton.** One batched accept-all / adjust question (`boundary-trust`) proposes each *leaf*
  boundary's `zone` + `plane` (skeleton phase; `RESTRICTED` deferred), alongside its enforcement posture
  (`implicit_deny_enabled`, `allow_any_inbound`, `egress_filtering`). The proposed zone is discovery's, from a topology signal or from a
  boundary whose members are all external entities (`UNTRUSTED`; `VENDOR` only for a partner named as vetted, which
  includes a cloud provider whose managed services the system consumes; low confidence when membership is the only
  evidence). A non-structural leaf discovery left unproposed whose components are all `EXTERNAL_ENTITY` is proposed
  the same way at Step 4, marked `[lo]` with its reason in a Note column; a leaf
  mixing external entities with other components gets no external zone, only the hierarchy check's move finding. A
  leaf with no proposal that resolves to the default renders **needs a zone**, never a blank, and the step
  auto-skips only when the skeleton reports no `unclassified` finding. Structural containers render
  `— structural` and are not nagged. Accepted rows are written to `structure.json`; identity / compute-node /
  location / business grouping is steered to `domains`/`planes` **tags**, not zone-bearing boundaries.
- **Step 5 — conduit ratification.** The risk-bearing crossings (external → trusted) are surfaced; the operator
  ratifies the few that are legitimate as **approved channels**, appending `OUTBOUND` conduits to `structure.json`.
  An un-ratified crossing stays a plain flow and re-surfaces at Step 9 — that divergence is the design working.
  Before that, a privilege or auth transition the operator confirms (a caller and callee at different authorization
  levels inside one zone) is proposed as a sub-boundary, or as a `Management` plane, through the Step-4 questions —
  `boundary-hierarchy`, then `boundary-trust` for the new rows.
- **Step 6 — provider boundary.** A confirmed re-type of a cloud provider's managed service moves it into the
  provider's boundary, created when needed with `zone: VENDOR`; the confirmed row ratifies that zone.
- **Step 7 — promotion.** After the data items are classified, the full determination re-derives and the workflow
  asks its own `restricted-promotion` question (promote all / adjust) at the end of the step. Only a boundary whose
  computed tier is `RESTRICTED`, that does not already resolve to `RESTRICTED`, and whose declared zone is `null` or
  `INTERNAL` is offered; a boundary declared
  `PUBLIC`, `EXPOSED`, `VENDOR` or `UNTRUSTED` never is. The change only tightens, and nothing is written unless the
  operator confirms the row.
- **Step 9 — validation.** The model-reviewer rolls up the zoning findings as an advisory block.

---

## 4. Persistence & round-trip

`zone`/`domains`/`planes`/`conduits` live first-class in `structure.json` and round-trip through the platform:
`import_model`/`update_model` push them (conduits written OUTBOUND-canonical; server-side reconcile is idempotent —
a re-sync adds no duplicate edges), and `export_model` pulls them back unchanged. A **zoneless** model imports and
exports cleanly — every boundary resolves to `INTERNAL`/default with no spurious zoning written and no clobber of
existing fields (partial-update semantics emit a field only when present). The persisted graph shape (the
`SecurityBoundary.zone` field and the `CONDUIT` relationship with `ConduitProperties`) is defined in
[backend/LLD/SCHEMA.md](../backend/LLD/SCHEMA.md).

---

## Related

- [BOUNDARY_TRUST_ZONES.md](../../user/BOUNDARY_TRUST_ZONES.md) — end-user guide (setting zones, inheritance, the Zoning overview).
- [THREAT_MODELING_WORKFLOW.md](THREAT_MODELING_WORKFLOW.md) — the surrounding guided workflow.
- [SYNC_AND_SOURCE_OF_TRUTH.md](SYNC_AND_SOURCE_OF_TRUTH.md) — publish/pull architecture.
- [backend/LLD/SCHEMA.md](../backend/LLD/SCHEMA.md), [backend/GRAPHQL_API_REFERENCE.md](../backend/GRAPHQL_API_REFERENCE.md) — the persisted graph/GraphQL contract.
