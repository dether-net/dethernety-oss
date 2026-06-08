# ADR-010: Finding affirmation lifecycle

**Status:** Accepted
**Date:** 2026-06-08

## Context

[ADR-007](007-finding-disposition-lifecycle.md) gave both finding types — **Exposures** and **Countermeasures** — a structured disposition that survives re-derivation. But every kind it defined *mutes* the finding: `NOT_APPLICABLE`, `FALSE_POSITIVE`, `COMPENSATING_CONTROL`, `RISK_ACCEPTED`, `WAIVED`, and `SUPERSEDED` all record a reason the finding should be treated as *not actionable*. There was no way to record the opposite — positive **agreement**: "I reviewed this SYSTEM finding and it IS a real, live risk" (for an exposure) or "I confirmed this control is in place" (for a countermeasure) — in a form that persists across re-derivation.

That gap had a second cost: **no triage legibility**. A freshly generated model offers no signal at all. Every SYSTEM finding looks identical, so an un-triaged finding is indistinguishable from one a human has reviewed and confirmed. The only way to mark a SYSTEM finding as "reviewed and kept" was to Supersede it into a USER copy — a heavy move that fragments provenance for what is really just a confirmation.

Users needed two things: (a) a one-click way to confirm a finding as live without taking it over, and (b) a lifecycle that makes triage state — *un-reviewed* versus *reviewed* versus *dispositioned-away* — visible at a glance, in both the model UI and the threat report.

Note this is distinct from the pre-existing **re-affirm** action from ADR-007, which re-stamps *any* disposition to clear the `dispositionStale` flag. That is about staleness; the affirmation lifecycle here is about confirming a finding is a live risk.

## Decision

Add an `AFFIRMED` disposition kind — the one kind that keeps a finding **live** — and a **derived** finding lifecycle (`pending | confirmed | disposed`) layered over it. Five decisions shape the design.

**1. `AFFIRMED` reuses the existing write path — no new surface.** `AFFIRMED` is a new value on the `DispositionKind` enum, set through the same `disposeExposure` / `disposeCountermeasure` mutations as every other kind. The disposition resolver service accepts it into the per-type pickable-kind set; nothing else on the schema changes. There is no `affirmFinding` mutation, no new result type, no new node field — affirming a finding *is* dispositioning it, with the one kind that does not mute. This keeps ADR-007's forensic-attribution guarantees (server-stamped `dispositionedBy` / `dispositionedAt`) for free.

**2. The lifecycle is derived, never stored.** `pending | confirmed | disposed` is recomputed at view time from `dispositionKind` plus the finding's provenance — there is no schema field for it. The rules:

- `AFFIRMED` + an attributed actor (`dispositionedBy` set) → **confirmed**
- no disposition + a USER-authored finding → **confirmed**
- no disposition + a SYSTEM-authored (or unattributed) finding → **pending**
- any other (muting) kind → **disposed**

A finding is **live** when `dispositionKind` is null *or* equals `AFFIRMED`; everything else is dispositioned-away. Deriving rather than storing means there is no lifecycle field to keep consistent with the disposition on every write, and no migration when the rules evolve. The trade-off is that every consumer must replicate the derivation. It therefore lives in exactly one place per surface: the dt-ui `composables/useFindingDisposition.ts` composable, mirrored in the threat-report module's `frontend/lib/aggregateLedger.js`. These two copies are the deliberate, bounded cost of the derived-not-stored choice and are kept in lock-step.

**3. A forensic guard on unattributed affirmations.** An `AFFIRMED` write whose actor is null derives **pending**, not **confirmed**. A real confirmation is a human act, and the human is recorded in the server-stamped `dispositionedBy`. An `AFFIRMED` row with no attribution — for example, a finding spoofed through direct GraphQL rather than confirmed through the dialog — is not treated as a genuine confirmation. It still reads as un-reviewed (`pending`) until a real, attributed affirmation lands. This keeps the "confirmed" badge meaning *a person stood behind this finding*, consistent with ADR-007's posture that the structured write path stamps attribution server-side and the GUI dialog is the product guard.

**4. The host exposes narrow finding-action services, not the store.** Module bundles drive the same lifecycle as the model UI through a small set of action functions handed across the host trust boundary via `composables/useHostContext.ts` (`window.__HOST_DEPENDENCIES__`): `affirmFinding`, `clearFindingDisposition`, `supersedeFinding`, `deleteFinding`, `openFindingIssueSelector`, and an `openDispositionDialog` that now supports an affirm mode. Each is a thin wrapper over the canonical `flowStore` → dt-core mutation path. The Pinia store itself is **never** handed to a module — this is the security/trust model, following the `openDispositionDialog` precedent already established for dispositions. The threat report can therefore affirm, dispose, supersede, and issue findings through the *exact same* code path the model UI uses, with no second implementation to drift.

**5. The threat report treats `AFFIRMED` as residual risk and gates export on a clean snapshot.** In the report's ledger, coverage matrix, and HTML export, an `AFFIRMED` finding counts as **live** — it is confirmed residual risk, not a finding that was reasoned away. The report carries a `byLifecycle` totals breakdown and tags affirmed findings as "Confirmed" in the export. Because a report is a point-in-time snapshot, **HTML export is disabled while there are pending live edits**: the user clicks **Recreate** to fold their affirm/dispose/supersede decisions into a fresh snapshot, then exports. This keeps an exported report internally consistent with the decisions it claims to reflect.

## Consequences

**Positive:**
- **Triage legibility.** A model now distinguishes an un-reviewed finding (`pending`) from one a human confirmed (`confirmed`) from one reasoned away (`disposed`), surfaced through per-tab pending counts and lifecycle cues without any new stored state.
- **Confirmation survives re-derivation without a USER copy.** A SYSTEM finding can be marked "reviewed, real, keep it" via `AFFIRMED` and that decision persists across re-derivation — no need to Supersede into a USER copy just to record agreement, so provenance stays intact.
- **Report/model parity.** The threat report drives affirm/dispose/supersede/issue through the same host services as the model UI, so the two surfaces cannot diverge in behaviour.
- **No backend surface growth.** Affirmation rides ADR-007's existing mutations, resolver, and attribution guarantees — the only backend change is one enum value in the pickable set.

**Negative:**
- **The derived lifecycle is duplicated.** Deriving rather than storing means the derivation exists twice — the dt-ui composable and the module's `aggregateLedger.js`. The two must not drift; a change to the rules has to land in both. This is the accepted price of not storing (and migrating) a lifecycle field.
- **The forensic guard introduces a surprising `pending`.** An `AFFIRMED` row with no actor reads as `pending`, not `confirmed`. For a finding affirmed through the GUI this never happens (the actor is always stamped), but a finding affirmed out-of-band through direct GraphQL without attribution will show as un-reviewed despite carrying `AFFIRMED` — intended, but a possible source of "why is this still pending?" confusion.
- **Export-gating adds a step.** Pending live edits block HTML export until the user clicks **Recreate** to refresh the snapshot. This prevents an export that disagrees with its own underlying decisions, at the cost of an extra explicit action before each export.

## References

- [ADR-007: Finding disposition lifecycle](007-finding-disposition-lifecycle.md) — the disposition model this extends; `AFFIRMED` is a new kind on its `DispositionKind` vocabulary, set through its existing mutations
- [ADR-004: Executable module system](004-executable-module-system.md) — the module trust boundary the host finding-action services cross
- [ADR-006: Defense-in-depth security](006-defense-in-depth-security.md) — the layered model the forensic guard and host-service boundary sit within
- [Backend GraphQL API reference](../backend/GRAPHQL_API_REFERENCE.md) — the disposition mutations `AFFIRMED` rides on
- [Managing Findings](../../user/MANAGING_FINDINGS.md) — the user-facing affirm/dispose/supersede/issue workflow
