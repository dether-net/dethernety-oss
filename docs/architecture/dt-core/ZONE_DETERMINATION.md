# Zone Determination Engine

## Table of Contents
- [Overview](#overview)
- [Module Shape and Exports](#module-shape-and-exports)
- [The Zoning Context](#the-zoning-context)
- [Inheritance Resolver](#inheritance-resolver)
- [The Trust Cascade](#the-trust-cascade)
- [Structural Containers](#structural-containers)
- [Coherence Findings](#coherence-findings)
- [Container Display Summary](#container-display-summary)
- [Context Builder — model to context](#context-builder--model-to-context)
- [Framing](#framing)
- [Related Documentation](#related-documentation)

## Overview

The zone determination engine computes a per-boundary **trust tier** and a set of **advisory coherence findings** over a threat model's boundary hierarchy, flows, and data classification. It is a **pure, no-I/O leaf module**: no Apollo, no Vue-Flow, no graph calls — it reads a plain [`ZoningContext`](#the-zoning-context) and returns plain results. Building that context from a model is a separate, explicitly-marked concern in the same file.

**Source:** `packages/dt-core/src/dt-boundary/zone-determination.ts`

Because it must stay free of the Vue-Flow / Apollo surface that the rest of `dt-boundary` carries, the engine is exported from the package root **directly** rather than through [`DtBoundary`](./GRAPHQL_OPERATIONS.md#dtboundary):

```typescript
import { buildZoningContext, computeZoningFindings, determineZoneTier } from 'dt-core'
```

Its consumer is the model-validation surface — the analysis tooling computes tiers and findings over the local model files and never asks an LLM to walk the tree.

> **This document is the dt-core engine/module view.** The trust-model *semantics* — what each tier means, why the cascade is ordered the way it is, the default-then-promote phasing, and how the guided workflow ratifies zoning — are canonically documented in [dethereal/TRUST_ZONING.md](../dethereal/TRUST_ZONING.md). This document does not restate them; it describes the engine's API surface, the context contract, and the model → context projection. Where the two overlap, TRUST_ZONING.md is authoritative on meaning.

---

## Module Shape and Exports

The engine splits into a **pure determination core** (a deterministic function of a given context) and a **context builder** (the model → context projection, the genuinely higher-risk join, kept separate from the proven core).

| Export | Kind | Role |
|--------|------|------|
| `resolveEffectiveZone` | function | Walk the nesting chain to a boundary's effective zone (declared / inherited / default). |
| `determineZoneTier` | function | The 4-rule trust cascade — a boundary's intrinsic tier. |
| `isStructuralContainer` | function | Predicate: does this boundary nest child boundaries? |
| `computeZoningFindings` | function | The advisory coherence findings over a whole context. |
| `computeContainerSummary` | function | The display-only roll-up for a structural container. |
| `buildZoningContext` | function | Project a model (structure + flows + data items) into a `ZoningContext`. |
| `buildBoundaryAdjacency` | function | The component→component to boundary→boundary flow projection. |
| `DEFAULT_ZONE` | const | The residual zone (`INTERNAL`) when nothing in the chain declares one. |
| `EXPOSURE_RANK` | const | Exposure ordering used by the display roll-up (`VENDOR` is off the gradient). |
| `ZoningContext`, `EffectiveZone`, `ZoneTierResult`, `ZoningFinding`, `ContainerSummary` | types | The engine's contract types. |

The `Zone`, `Plane`, and `Conduit` types the engine reasons over are defined in the [Domain Model](./DOMAIN_MODEL.md#boundary-zoning); the boundary hierarchy type (`StructureBoundary` / `ModelStructure`) is defined in `schemas/structure.schema.ts` (see [Import/Export — Schema Package](./IMPORT_EXPORT.md#schema-package)).

---

## The Zoning Context

`ZoningContext` is the sole input to the determination core. Everything the cascade and findings need is pre-projected onto it, so the core never touches a model, a flow list, or a graph.

```typescript
interface ZoningContext {
  boundariesById: Map<string, StructureBoundary>
  defaultBoundaryId: string
  // Boundary→boundary one-hop reachability (intra-boundary edges dropped, default root excluded).
  adjacency: { in: Map<string, Set<string>>; out: Map<string, Set<string>> }
  assetIds: Set<string>        // boundaries bearing a high-value asset descendant (rolled up to every ancestor)
  directAssetIds: Set<string>  // boundaries that DIRECTLY hold a high-value asset (no ancestor rollup) — subset of assetIds
  externalIds: Set<string>     // boundaries declared UNTRUSTED (open/unknown external)
  vendorIds: Set<string>       // boundaries declared VENDOR (vetted-partner external)
}
```

Two distinctions carry weight:

- **`assetIds` vs `directAssetIds`.** The rollup (`assetIds`) drives display presence flags; the direct set (`directAssetIds`) gates the `RESTRICTED` promotion and the `under-protected` finding, so a purely structural ancestor sitting above an asset abstains instead of being flagged.
- **`assetIds` emptiness is the phase.** An empty asset set (assets not yet classified) can never reach the cascade's asset rule, so the engine yields the skeleton tiering; a populated set lets the promotion fire. Default-then-promote falls out of the core reading a fuller context — it is **not** a second code path. See [TRUST_ZONING.md §2.3](../dethereal/TRUST_ZONING.md).

Externality (`externalIds` / `vendorIds`) comes from each boundary's **own declared** `zone` — externality is an explicit declaration, never inherited.

---

## Inheritance Resolver

```typescript
resolveEffectiveZone(
  boundaryId: string,
  boundariesById: Map<string, StructureBoundary>,
  defaultBoundaryId: string,
): EffectiveZone   // { zone, source: 'declared' | 'inherited' | 'default', from? }
```

Walks `parentBoundary` upward to the nearest boundary declaring a non-null `zone`. A boundary that declares its own zone resolves `declared`; one that inherits from an ancestor resolves `inherited` (with `from` naming that ancestor); exhaustion, a cycle, or a missing ancestor resolves to `DEFAULT_ZONE` (`INTERNAL`) with source `default`. The walk is cycle-guarded and bounded by a depth ceiling (50) mirroring the server-side / dt-ui traversal ceiling. A structural container with a null zone is transparent — inheritance keeps walking through it.

---

## The Trust Cascade

```typescript
determineZoneTier(boundary: StructureBoundary, ctx: ZoningContext): ZoneTierResult
// { tier: Zone, reason: string, blockedBy?: 'exposure' | 'vendor' | 'no-ingress' | 'no-asset' }
```

Computes a boundary's intrinsic trust tier by a four-rule cascade — **first match wins, and the order is the dependency order** (exposure is resolved before the asset rule's ingress test reads it):

1. **External entity** → `VENDOR` (vetted partner) or `UNTRUSTED` (open/unknown), from the declared externality sets.
2. **Reachable from an external source** → `PUBLIC` (directly, the front door) or `EXPOSED` (one hop behind a public edge, the DMZ). Exposure **outranks** the asset pull below.
3. **Direct high-value asset with positive internal-only ingress** → `RESTRICTED`. Gated on `directAssetIds`; a boundary with no modelled ingress, or ingress from an exposing source, stays `INTERNAL` with `blockedBy` recording why (this drives the `under-protected` finding).
4. **Residual** → `INTERNAL`.

`reason` is a human-readable "why this tier" string; `blockedBy` explains, for an asset-bearing boundary that did **not** reach `RESTRICTED`, what disqualified it. The full semantics of each rule — the one-hop exposure rule, why exposure outranks asset pull, and the phasing — are in [TRUST_ZONING.md §2.1](../dethereal/TRUST_ZONING.md). This engine is the implementation those semantics describe.

---

## Structural Containers

```typescript
isStructuralContainer(b: StructureBoundary): boolean   // b nests one or more child boundaries
```

A boundary that nests child boundaries (a VPC, a Kubernetes cluster, a cloud account) usually spans several tiers at once, so it has **no well-defined single zone**. Such a boundary **abstains**: it is proposed no zone, it is transparent to inheritance (the resolver keeps walking through its null zone), and its false `unclassified` finding is suppressed. Trust classification lives at the **leaves**. Asset findings still run at the **direct** holder (`directAssetIds`), so a crown jewel held *directly* by a container is not exempted. The determinant is **structure + computed tiers**, never any boundary type/category taxonomy. See [TRUST_ZONING.md §2.2](../dethereal/TRUST_ZONING.md).

---

## Coherence Findings

```typescript
computeZoningFindings(ctx: ZoningContext): ZoningFinding[]

interface ZoningFinding {
  kind: 'unclassified' | 'under-protected' | 'mgmt-plane'
      | 'external-ingress' | 'flow-channel' | 'cross-tier-domain'
  boundaryId: string
  detail: string
  severity: 'info' | 'warning'
  peerId?: string   // the crossing/channel peer, for the conduit- and domain-dependent kinds
}
```

Deterministic findings about intent completeness/coherence — **never correctness, never enforcement**. All six kinds are advisory; nothing they report blocks a write. For the conduit- and domain-dependent kinds, `peerId` names the other end so a caller can author a conduit on `boundaryId` without re-deriving the boundary graph.

| `kind` | Severity | Fires when |
|--------|----------|-----------|
| `unclassified` | info | No zone declared anywhere in a leaf boundary's inheritance chain (falls back to Internal). Suppressed on structural containers. |
| `under-protected` | warning | A **direct** asset holder resolves looser than `RESTRICTED` (misplaced in an exposed segment, under-segmented, or unverifiable ingress). |
| `mgmt-plane` | warning | A `MANAGEMENT`-plane boundary resolves to an externally-reachable tier (`PUBLIC`/`EXPOSED`). |
| `external-ingress` | warning | An external-tier boundary has a modelled flow into a declared-trusted tier with no approved conduit. |
| `flow-channel` | warning / info | A risk-bearing crossing vs. its declared conduit: an undeclared path (warning), a declared-but-dormant channel, or a channel with no justification (info). |
| `cross-tier-domain` | info | A hand-authored `domains` tag couples an externally-reachable member with a protected one (direct asset holder or declared `RESTRICTED`) — the blast-radius / co-tenancy shape. |

The `external-ingress` and `flow-channel` kinds read the boundaries' declared conduits (see [Domain Model — Boundary Zoning](./DOMAIN_MODEL.md#boundary-zoning)) against the flow `adjacency`; conduits are matched OUTBOUND-canonically. `cross-tier-domain` is what makes the otherwise free-text `domains` field **load-bearing** — the engine reads `domains` nowhere else. The per-kind rationale (why `cross-tier-domain` fires only on the external↔protected coupling, the scope disclaimer) is in [TRUST_ZONING.md §2.4](../dethereal/TRUST_ZONING.md).

---

## Container Display Summary

```typescript
computeContainerSummary(boundary: StructureBoundary, ctx: ZoningContext): ContainerSummary | null

interface ContainerSummary {
  range?: { min: Zone; max: Zone }   // exposure span across leaf segments (VENDOR excluded); omitted when no gradient member
  maxExposure?: Zone                 // the most-exposed gradient member (== range.min)
  containsAssets: boolean
  containsVendor: boolean            // a vetted-vendor enclave lives inside (off the exposure gradient)
  reachesExternal: boolean
  unclassifiedDescendants: number    // leaf descendants still resolving to the default zone (the coverage prompt)
}
```

A **display-only view-model** so a container's abstention is legible rather than silent. It is **never written to `zone`** and **never read by** the cascade, resolver, or finding emission. Returns `null` for a non-structural boundary or an empty signature.

Two deliberate properties:

- **Self-correcting against trust-level mislabels.** The summary is built from *computed* tiers (`determineZoneTier` per leaf), so a child mislabelled `INTERNAL`/`RESTRICTED`/`PUBLIC`/`EXPOSED` cannot inflate it. It is **not** self-correcting against `UNTRUSTED`/`VENDOR`, which are declaration-driven externality inputs the engine treats as authoritative.
- **`VENDOR` is kept off the exposure gradient** (`EXPOSURE_RANK` covers only the five gradient zones). A vetted-partner enclave surfaces as `containsVendor`, never as a range endpoint — rendering "Vendor…Internal" as a contiguous span would be a truth error.

---

## Context Builder — model to context

The determination core reasons about **boundary→boundary** ingress, but a model's flows are **component→component** (`DataFlow.source`/`target` are component ids). The builder bridges that gap and runs the asset join — the genuinely higher-risk work, deliberately kept separate from the proven core above.

```typescript
buildZoningContext(structure: ModelStructure, flows: DataFlow[], dataItems: DataItem[]): ZoningContext
buildBoundaryAdjacency(structure: ModelStructure, flows: DataFlow[]): { in: ...; out: ... }
```

**`buildZoningContext`** assembles the full context:

- **Nesting-derived parents.** On-disk structure is nesting-only and commonly omits `parentBoundary` back-refs, so `boundariesById` is normalized to carry a `parentBoundary` derived from the authoritative nesting projection (`flattenStructure`'s `parentMap`). Without this, the inheritance resolver — the sole reader of `parentBoundary` — would skip every nesting ancestor.
- **Externality from declared zone.** A boundary lands in `externalIds` / `vendorIds` from its own declared `UNTRUSTED` / `VENDOR` zone; the default root is never external.
- **Asset join.** A boundary is asset-bearing when a descendant is a high-value asset: a `crownJewel === true` component, or a data item with `sensitivity === 'restricted'` or a non-empty `regulatory_flags`. Each asset marks its direct holder (`directAssetIds`) and — for the rollup — every ancestor up to but excluding the default root (`assetIds`).

**`buildBoundaryAdjacency`** projects each flow's two component endpoints up to their containing boundaries via `parentMap` and keeps an edge only when both endpoints resolve, the two boundaries differ (intra-boundary edges are dropped), and neither is the default root (the root contributes **no phantom ingress**, so it cannot satisfy the asset rule's positive-ingress test). The map is directional — the asset rule reads the `in` map; egress is not a classifier.

---

## Framing

The determination engine computes an **advisory** proposal, not an enforced verdict. It records how trust is *meant to* flow — tiers, coherence findings, and a display roll-up — and never proves isolation, never computes conduit legality, and never blocks a write. Whether the real flows match the declared intent is the job of security analysis, which reads zoning as its baseline.

The engine is also strictly **read-side computation**: it consumes a context and returns results. The write side — persisting declared `zone`/`domains`/`planes`/`conduits` and reconciling conduit edges — lives in the [Boundary Zoning Utilities](./DATA_ACCESS_LAYER.md#boundary-zoning-utilities) and threads through [import/export](./IMPORT_EXPORT.md#boundary-zoning-and-conduits). The two never share state.

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [dethereal/TRUST_ZONING.md](../dethereal/TRUST_ZONING.md) | **Canonical** trust-model semantics — cascade meaning, phasing, per-finding rationale, workflow ratification |
| [DOMAIN_MODEL.md — Boundary Zoning](./DOMAIN_MODEL.md#boundary-zoning) | The `Zone` / `Plane` / `Conduit` types the engine reasons over |
| [DATA_ACCESS_LAYER.md — Boundary Zoning Utilities](./DATA_ACCESS_LAYER.md#boundary-zoning-utilities) | The write-side sanitizers and conduit reconcile |
| [IMPORT_EXPORT.md — Boundary Zoning and Conduits](./IMPORT_EXPORT.md#boundary-zoning-and-conduits) | How zoning + conduits round-trip through import/export |
| [GRAPHQL_OPERATIONS.md — DtBoundary](./GRAPHQL_OPERATIONS.md#dtboundary) | The boundary write path that persists these fields |
