# ADR-007: Finding disposition lifecycle

**Status:** Accepted
**Date:** 2026-05-20

## Context

Modules generate findings automatically: **Exposures** (security weaknesses on a component or data flow) and **Countermeasures** (defensive controls derived from a control's class). These SYSTEM-generated findings are re-derived every time the relevant element's class binding or instantiation attributes change.

Users frequently disagree with a specific finding for a specific instantiation — "this exposure doesn't apply to an internal-only admin tool", "we've decided not to implement MFA on this host", "the template fired this incorrectly for this kind of element". Before this change the only options were to leave the finding visible despite it not applying, or to delete it via direct GraphQL — where the next re-derivation cycle simply recreates it. Neither records *why* the decision was made, and neither survives re-derivation.

We needed a way to record a structured decision against a finding that (a) persists across re-derivation, (b) captures a justification and forensic attribution, and (c) signals when the decision may no longer hold because the model changed underneath it.

## Decision

Add a **disposition** to both finding types. A disposition is five fields on the `Exposure` and `Countermeasure` nodes — `dispositionKind`, `dispositionReason`, `dispositionedBy`, `dispositionedAt`, `dispositionStale` — written through a small set of structured mutations. Four decisions shape the design:

**1. Asymmetric SYSTEM/USER authoring.** SYSTEM findings (module-derived, carrying the class edge `IS_EXPOSURE_OF` / `IS_COUNTERMEASURE_OF`) cannot be edited or deleted from the UI — they are managed via *disposition*. USER findings (hand-authored, no class edge) are freely editable and deletable but cannot be dispositioned. To "take over" a SYSTEM finding a user **Supersedes** it: an orchestrator clones it into a USER copy (keeping the element/Control edge, dropping the class edge so the re-derivation sweep preserves it) and disposes the original as `SUPERSEDED`. This keeps the SYSTEM finding's provenance intact while giving the user a finding they own.

**2. Lean backend; the GUI dialog is the guard.** The disposition write path validates input (kind ∈ the per-type pickable set, non-empty reason ≤ 2000 chars, actor present) and stamps `dispositionedBy` (from the JWT `sub`) and `dispositionedAt` server-side. The forensic-attribution fields keep `@settable(onCreate:false, onUpdate:false)` so the generated `update*` mutations cannot spoof them. But `dispositionStale` is deliberately **left settable** — it is a self-affecting "needs review" flag, not attribution, and the staleness companion (below) flips it through the generated `updateExposures`/`updateCountermeasures` mutation. We do not guard `dispositionStale` against direct GraphQL: a power user with direct API access can already delete the entire model, so guarding a review flag would be theatre. The approval dialogs in the GUI are the product guard; the backend stays minimal.

**3. Attribute-driven staleness.** A disposition flips `dispositionStale = true` only when an **instantiation attribute** of the finding's element actually changes (the existing `setInstantiationAttributes` write path, gated on a real value change). Adding or removing an edge — an ATT&CK technique on an exposure, a D3FEND technique on a countermeasure — does **not** flip staleness. Edge-driven triggers are deferred until user feedback shows they are needed; they can be added later without a schema change. A stale disposition is never silently dropped — the user re-affirms it (which re-stamps and clears the flag) or clears it.

**4. Parallel resolvers, not a polymorphic one.** `disposeExposure` / `clearDisposition` and `disposeCountermeasure` / `clearCountermeasureDisposition` are separate mutations that delegate to a shared private helper (`_applyDisposition(label, …)` / `_clearDisposition(label, …)`), where the only difference is a hard-coded node label and the per-type pickable-kind set. We rejected a polymorphic `disposeFinding(findingType, …)` with a `FindingType` enum: two finding types do not justify a type hierarchy, and the polymorphic form would have forced a rename of the shared `DispositionMutationResult.exposureId` field (it carries the countermeasure id in that path) and fragmented every existing caller. If a third disposition-bearing finding type ever lands, generalise then.

The disposition kinds are a controlled vocabulary: `NOT_APPLICABLE` and `FALSE_POSITIVE` apply to both finding types; `COMPENSATING_CONTROL` and `RISK_ACCEPTED` are exposure-only; `WAIVED` is countermeasure-only (a GRC control-waiver); `SUPERSEDED` is set only by the Supersede orchestrator.

## Consequences

**Positive:**
- A SYSTEM finding that doesn't apply can be recorded as such, with a reason and an author, and the decision survives re-derivation.
- The shared helper keeps the Exposure and Countermeasure write paths from drifting, with no polymorphic mutation surface and no result-type churn.
- The lean `@settable` posture fixed a latent bug: the staleness companion flips `dispositionStale` through the generated `update*` mutation, which a blanket `@settable` lock would have silently broken (and did, on the exposure side, until this change).
- Staleness gives users a trustworthy signal that a past decision should be revisited, without nagging on every unrelated edit.

**Negative:**
- The shared `DispositionMutationResult.exposureId` field carries a countermeasure id in the countermeasure path — mildly imprecise. We accept the imprecision rather than fragment callers; a `nodeId` alias can be added later if it grates.
- The Supersede flow is two backend mutations (clone + dispose) orchestrated client-side, so it has a partial-failure window (clone succeeds, dispose fails). The UI surfaces this with a Retry affordance rather than rolling back — the USER copy is a legitimate artefact even if its disposition follow-up failed.
- The `dispositionReason CONTAINS '<name>'` match used by the USER-copy-delete companion can over-match when two SYSTEM findings share a name. We accept this (symmetric for both finding types); a structured backreference is the deferred fix. The companion's `where` carries no model/tenant filter, so the match is database-wide; this is safe under the deployment invariant that **each tenant/model has its own database** (a name collision cannot bleed across models). A shared-database deployment would need the filter scoped to the deleted copy's element, which pairs naturally with the structured-backreference fix.
- SYSTEM findings can no longer be edited/deleted directly from the GUI — a deliberate behaviour change. Direct GraphQL remains available for power users.

## References

- [ADR-002: GraphQL API layer](002-graphql-api-layer.md)
- [ADR-005: Shared data access layer (dt-core)](005-shared-data-access-layer.md)
- [ADR-006: Defense-in-depth security](006-defense-in-depth-security.md) — the `@settable` posture is scoped against that layered model
- [Backend GraphQL API reference](../backend/GRAPHQL_API_REFERENCE.md) — the disposition mutations
- [Managing Findings](../../user/MANAGING_FINDINGS.md) — the user-facing workflow
