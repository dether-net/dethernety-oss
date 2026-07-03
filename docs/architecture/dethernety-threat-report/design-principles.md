# Threat Report — Design Principles

> Why the report is built to under-claim: the accuracy and honesty contracts behind every surface.

A security report is read for reassurance, and that is exactly its danger. A clean-looking screen is taken as "we are safe" when the truth is often "we did not analyze the risky parts" or "coverage is not assessable here." The Dethernety Threat Report is engineered against that failure mode. It renders over a point-in-time snapshot of a threat model held in a Bolt/Cypher graph (Neo4j or Memgraph), and at every step it prefers an honest gap to a flattering aggregate. This document is the *why* companion to the structural docs: where [`./architecture.md`](./architecture.md), [`./backend.md`](./backend.md), [`./frontend.md`](./frontend.md), and [`./data-model.md`](./data-model.md) describe how the report is assembled and shaped, this one names the calibration contracts those shapes exist to serve — and shows the concrete code that enforces each one.

**What this document covers:** twelve named honesty principles, each stated as the rule, why it matters for a security reader, and how the code makes it true (which surface and which library). It closes with a principle-to-enforcement map. The principles are intentionally redundant with each other at the edges — calibration is defended in depth, not at a single chokepoint.

---

## The reader the report is calibrated for

Two people read this report. A **practitioner** wants a worklist: what is exposed, what is uncovered, what to fund next. A **reviewer or auditor** wants to know whether the report can be trusted as a statement about the system — and, crucially, what it does *not* assert. Every principle below protects the second reader from a report that quietly over-promises, without slowing down the first.

The unifying stance: **the report describes the model, not the running system, and it never lets the absence of a finding read as the presence of safety.** A blank cell, an unreachable asset, an unclassified data flow — each is a statement about modeling completeness, not a clean bill of health.

---

## Principle 1 — Snapshot-faithful, with explicit staleness

**The principle.** The report shows the model exactly as it stood when the snapshot was generated. It never silently mixes a stale snapshot with live data, and it never presents a stale report as fresh. Staleness is detected structurally and surfaced, not guessed at from a clock.

**Why it matters.** A report that quietly folds in live changes — or hides that the model has moved on since generation — is worse than a stale one, because the reader cannot tell which world they are looking at. Reproducibility is part of honesty: the same snapshot must read the same way every time it is opened.

**How the code enforces it.** Every analytical surface computes purely over the persisted snapshot document (its `ledger` and `modelGraph`). The one live signal the report fetches is a **structural fingerprint** of the model's current report-relevant content — a digest of element ids plus disposition, sensitivity, and data-handling signatures. The header (`ScopeBanner.vue`) compares the live fingerprint to the fingerprint baked into the snapshot and renders one of `fresh` / `stale` / `never` / `generating`. When the two differ, the banner reads "Stale — the model changed since" rather than continuing to imply freshness. The freshness line only ever states the snapshot's own `generatedAt`, and `generatedAtLabel` falls back to the raw value rather than fabricating a date it cannot parse. Because the fingerprint folds in disposition and sensitivity changes — not just element add/remove — a re-triage or re-classification correctly flips the report to stale, while a no-op save leaves it fresh.

---

## Principle 2 — No false aggregate

**The principle.** There is no single risk score, no coverage percentage, and no single "Covered: N" total anywhere in the report. The Posture Summary is the only roll-up surface, and even it segregates its numbers rather than blending them into one verdict.

**Why it matters.** A single number invites a single judgment ("87% covered — good enough"). It collapses distinctions that matter — a directly-mitigated technique and a broadly-inferred one are not the same coverage, and averaging them manufactures false confidence. Security posture is not a scalar.

**How the code enforces it.** The aggregation library (`aggregateLedger.js`) produces partitioned totals — by score band, by provenance, by disposition kind — and never a composite. Its `scoreBand` is documented as a sort/group aid, not a verdict, and a missing score becomes `unknown`, never silently `low`. The Posture Summary library (`postureSummary.js`) is pure composition over the per-view engines; it emits live bands, disposition counts, boundary-crossing counts, defense-in-depth, and top residuals as **separate fields**, with no cross-field rollup. The coverage library (`coverageMatrix.js`) returns tier-segregated bucket counts (`directPrevent`, `directDetect`, `mitigation`, `d3fend`, `detectOnly`, `uncovered`, `soft`) and the `coverageSummaryLines` helper renders them as distinct lines — never a percentage, never a sum.

---

## Principle 3 — Dispositions are never dropped

**The principle.** A finding that has been triaged (dispositioned — marked Not Applicable, Risk Accepted, False Positive, and so on) never disappears. It moves to a muted, still-counted partition. "Live" means precisely one thing: no disposition. A disposition that may no longer hold is flagged stale.

**Why it matters.** Dropping triaged findings would let a model launder its risk: accept everything, and the report goes green. Keeping them counted-but-muted preserves the audit trail — a reviewer can always see what was decided away, by whom implicitly, and whether the decision has gone stale under model change.

**How the code enforces it.** `isLive(finding)` is the single definition: `dispositionKind == null`. `aggregateLedger` splits each element's findings into a `live` list and a `dispositioned` list, increments `totals.dispositioned` and `totals.byKind`, and tracks `totals.stale` — the dispositioned set is sorted and retained, never discarded, so the Residual Risk surface can render it muted. The coverage layer applies the same filter to the *live* grid but counts what it excludes: `dispositionedExcluded` is surfaced as an off-grid note ("still listed in Residual Risk — never silently dropped"). The report also runs an integrity check that does not exist to compute coverage: a `COMPENSATING_CONTROL` disposition on an element with zero supporting controls (`compensatingClaimNoControl`) is a claim with nothing behind it, surfaced for the reviewer and counted on the Posture Summary as `compensatingNoControl`. The disposition lifecycle itself is platform behavior; see [ADR-007](../decisions/007-finding-disposition-lifecycle.md).

---

## Principle 4 — Coverage is tier-segregated and function-classified

**The principle.** Coverage is never one number. Author-asserted direct mitigation, catalogue-precise mitigation, and broadly-inferred D3FEND coverage are kept in separate tiers. Preventive and detective coverage are distinguished. A technique that is seen but not stopped is called out as **detect-only**. The broad inferred tier is rendered as a distinct texture so it cannot visually pass for strong coverage.

**Why it matters.** "Covered" means very different things: a control explicitly asserted to stop a technique is not equivalent to a technique inferred to be addressed because a control touches a shared artifact. Blending them — or worse, drawing the weak tier as a fainter shade of the strong one — manufactures confidence the model does not support. And a detective-only control that watches an attack it cannot prevent must never be read as prevention.

**How the code enforces it.** `reduceTiers` in `coverageMatrix.js` collapses a technique's facts to a best tier plus a status of `PREVENT` / `DETECT_ONLY` / `UNCOVERED`, and it deliberately defaults any covered-but-non-preventive pair to `DETECT_ONLY` rather than ever returning the impossible "covered + uncovered" state — it never over-claims prevention. The tier ranking (`DIRECT` > `INDIRECT_MITIGATION` > `INDIRECT_D3FEND`) keeps the strongest surviving tier without flattening the rest, and `filterByTier` partitions rows by best tier so the per-tier selections sum to "all" without a blended bucket. In `CoverageMatrix.vue` the encoding makes the segregation visual: D3FEND is drawn as a 45-degree hatch **texture** (`cov-INDIRECT_D3FEND`), explicitly not a lighter shade of the monochrome ramp, "so the broad tier can't masquerade as 'a little covered'." The `coverageSummaryLines` helper tags the D3FEND line `broad/inferred`, and `bestLabel` appends "(broad)" to any D3FEND verdict.

---

## Principle 5 — Off-grid accounting: never a green grid by omission

**The principle.** A blank coverage grid is never allowed to imply safety. Three categories that cannot be charted are surfaced as explicit off-grid notes instead of being silently omitted: live exposures with no technique mapping (soft/unmapped), Data exposures, and element classes that have no supporting controls anywhere in the model (structural gaps).

**Why it matters.** The cheapest way to fake an all-clear is to leave the risky parts off the chart. An exposure with no ATT&CK mapping is *unprovable* coverage, not *good* coverage. Data nodes cannot carry controls at all, so charting them would either invent a false catastrophe (everything permanently uncovered) or a false calm — both lies. An element class with zero controls is a structural maturity gap that a per-cell view would scatter into noise.

**How the code enforces it.** `buildCoverageView` accumulates each off-grid category explicitly. Unmapped live exposures increment `softCount`. **Data exposures are taken off the grid by design** — because a control's `SUPPORTS` edge can never attach to a Data node, coverage there is not assessable; coverage is instead attributed to the *handling* element, and the report still **discloses** each Data element's ATT&CK mappings (`dataMapped`) as identity chips with no tier encoding, "never a coverage claim, just the mapping." Structural gaps are computed model-wide: an element class that *has* elements but *has no* supporting control becomes a single completeness line (`structuralGaps`), "not N per-technique UNCOVERED cells." `CoverageMatrix.vue` keeps the off-grid *counts* always visible (the `offGridParts` summary line) even when the verbose prose is collapsed — "Never hide the counts" — and when no technique reaches the grid it renders an explicit "this is a modeling/coverage state, not an all-clear" message instead of a clean matrix.

---

## Principle 6 — Flow routes, not attack paths

**The principle.** The reachability engine reports **flow routes** through the modeled topology and the threats sitting on them — never "attack paths." It is explicitly topological: hop count is proximity, not attacker effort. It does not model credential reuse or token theft. An asset that no modeled flow reaches is reported as "no modeled flow route" — a modeling gap — never "segmented" or "safe."

**Why it matters.** Calling a topological route an "attack path" implies the tool reasons about exploitability, which it does not. The most dangerous misread is the inverse one: treating an *unreachable* crown jewel as *protected*. Absence of a modeled edge is far more often an incomplete model than a real air gap, and labeling it "safe" would turn the report's biggest blind spot into its most reassuring claim.

**How the code enforces it.** `reachability.js` projects the component-flow graph into a directed adjacency and enumerates **simple** routes with a TypeScript visited-set, bounding hops, collected routes, total count, and edge-expansions independently so that "showing X of N" stays honest and a dense graph trips an explicit `ceilingHit` ("more exist") rather than emitting a silent number. In `modeAReachability`, an unreachable crown jewel is returned with `reachable: false` and `minHops: null`; the surface renders this as "no modeled flow route," tied to the completeness banner, with no "safe" framing anywhere in the library. Hop count is carried as `minHops` — proximity — and the module documents that it is "not attacker effort." Nothing in the engine models credential or token movement; on-route posture is reused from the same ledger lens the other surfaces use, so the route shows the *threats present*, not an exploit narrative.

---

## Principle 7 — Structural, not trust-based

**The principle.** The *structural* boundary-crossing layer is derived purely from boundary nesting (`EXIT`/`ENTER`) and reachability origins from external entities or a chosen assumed-breach origin — never from an *inferred* trust gradient. The numeric per-boundary *trust level* remains intentionally dormant, so nothing ranks on that unpopulated field. What does rank the crossing worklist is the operator's **declared-zone** policy verdict — a populated, administrative signal, kept distinct from the dormant gradient (its authority is Principle 12) — with the data carried across a boundary and the crossed boundary's own posture as the remaining signals. Unclassified data is a flagged modeling gap, never treated as low sensitivity.

**Why it matters.** Ranking crossings by an *inferred* trust level that the model does not actually populate would produce confident-looking orderings built on nothing. The declared zone is different: it is a fact the operator asserted, so ranking on its policy verdict is honest. And coercing unclassified data to "low" is the quiet over-claim that hides the riskiest case of all — sensitive data moving across a boundary that nobody has classified yet.

**How the code enforces it.** In `boundaryCrossings.js`, the structural crossing is the symmetric difference of the two endpoints' ancestor-boundary stacks (`makeStackResolver`), with direction reported structurally as `EXIT`/`ENTER` — pure containment. The numeric `trustLevel` remains a dormant placeholder, absent from the ranking tuple `flowRankKey`. But the tuple now **leads with `verdictRank`** — the declared-zone policy severity (`violation` > `warning` > `advisory` > `allowed`/none) from `zoningPolicy.js` — so a policy violation on an otherwise signal-free flow surfaces to the top rather than sinking; the remaining tuple terms are the same real fields as before: carried sensitivity, on-flow live band, crossed-boundary live exposure, and control absence. Sensitivity uses `SENSITIVITY_RANK`, where a null/absent level maps to rank 0 and labels as **"unknown" — never "low"** (`sensitivityLabel`). A flow carrying unclassified data in motion raises the `unclassified-in-motion` completeness flag ("a modeling gap, not a safe crossing") and stays in the worklist rather than dropping to the muted tail. The same library guards against self-deception in ordering: when no flow in the worklist carries any rankable signal — no verdict, no known sensitivity, no exposure, no control — `worklistUnranked` is set so the view drops the misleading "ranked" framing and states the order is merely alphabetical. Reachability reuses these exact structural primitives — its origin set is external entities or an explicit assumed-breach node, "never a trust comparison."

---

## Principle 8 — No silent green: scope honesty surfaced first

**The principle.** Model-wide completeness gaps are surfaced banner-first, so a reviewer learns what was *not* analyzed before reading any reassuring count.

**Why it matters.** Reading order is part of honesty. A reviewer who sees "0 critical findings" before learning that the crown jewels carry no modeled exposures has already formed a false impression. The gaps must arrive first.

**How the code enforces it.** `completenessFlags.js` computes model-wide guards over the snapshot and emits them in the same flag shape the header consumes, so they fold into `ScopeBanner.vue` above every surface. Two guards are central. A **high-value-but-unanalyzed** guard flags any crown-jewel component or classified Data node that carries *zero* modeled exposures — named explicitly as "under-analyzed, not an all-clear," because that is exactly the case where a green report misleads. An **orphan-components** guard flags components outside any boundary, whose crossings the boundary analysis structurally cannot place. These run alongside the per-view guards (the boundary engine's own `no-boundaries`, `unclassified-in-motion`, and nesting-corruption flags) so the banner aggregates scope honesty from every layer.

---

## Principle 9 — Controls are context, not coverage

**The principle.** Supporting controls are shown as defense-in-depth context, never as a coverage claim. Where an element carries both a control and live exposures, the report states the relationship is **not assessed** — it never implies "covered."

**Why it matters.** A control attached to an element is evidence of effort, not proof of mitigation. Reading "has a control" as "is covered" is precisely the conflation that lets a model look defended while its modeled threats go unaddressed. The honest statement is often "a control is present, but we cannot say it addresses this threat."

**How the code enforces it.** Throughout the ledger, supporting controls are gathered as muted "controls present" context, "never as a coverage claim." `aggregateLedger` carries `supportingControls` per element without folding them into any verdict. The Posture Summary computes **defense-in-depth** as a separate positive line — distinct supporting controls on elements with no live exposure — and the comment is explicit that this is "NEVER folded into a coverage number." The coverage layer surfaces the unassessed-relationship case directly: a control that supports an element but covers none of its modeled threats is reported per element as `mismatchByElement`, and model-wide as `defenseInDepth` (controls that cover nothing on the grid). Crucially, a control contributing *any* covering edge — even detective-only — is treated as covering, so a real control is never mislabeled a "mismatch"; the prevent/detect distinction is preserved where it belongs (the tier facts and the detect-only reduction), not smuggled into the mismatch flag.

---

## Principle 10 — One encoding legend (visual discipline)

**The principle.** The coverage grid is monochrome: tier strength is conveyed by ink, not hue. Each cell carries exactly one fill and at most one function glyph. Color is reserved for severity and staleness, never for coverage. Technique chips are neutral identity launchers, never coverage-tinted.

**Why it matters.** A "traffic-light buffet" — where green, color shades, glyphs, and tints all compete to mean different things — destroys legibility and invites misreading. Reserving color exclusively for severity/staleness means a colored thing on screen always means "pay attention here," consistently. And a coverage-tinted technique chip would let an identity label double as a silent coverage claim.

**How the code enforces it.** In `CoverageMatrix.vue` the encoding is stated as a single contract: tier is the **fill** (a monochrome ramp plus the one D3FEND hatch texture), function is the **glyph** (`⛉` prevent, `◎` detect; detect-only is `◎` with no `⛉`), with a hard budget of one fill and at most one glyph per cell. Provenance and disposition are explicitly barred from entering a cell. The fills are built from the theme's on-surface ink at graded alpha so "more ink = stronger tier" reads on both light and dark themes, and the grid stays greyscale so "tier strength never shares a channel with severity." `TechniqueChips.vue` renders each chip as a plain monospace identity-and-launcher button, documented as "deliberately NOT tinted by coverage tier — coverage encoding lives only in the [coverage] matrix, so a chip never doubles as a coverage claim," and a chip's *absence* is explicitly not a "no techniques" assertion.

---

## Principle 11 — A pure, testable honesty layer

**The principle.** The calibration rules live in pure, unit-tested compute libraries, not scattered through view components. The components encode; the libraries decide.

**Why it matters.** An honesty contract that lives in markup is unverifiable and drifts on every UI change. Concentrating the rules in pure functions makes them assertable in tests — "a dispositioned finding is excluded from the live grid but counted," "an unmapped exposure goes off-grid," "an unreachable jewel reports no route" become test cases, not hopes.

**How the code enforces it.** Every analytical rule above resolves to a pure function over the snapshot: `aggregateLedger`, `buildCoverageView` / `reduceTiers` / `filterByTier`, `computeCrossings`, `evaluateDataFlowPolicy`, `modeAReachability` / `enumerateRoutes`, `computePostureSummary`, and `computeCompletenessFlags` take plain snapshot data and return plain view models — no Vue, no network, no Cypher. The simple-path invariant in reachability is enforced in TypeScript (a visited-set), not delegated to engine-specific traversal semantics, so its behavior is deterministic and testable regardless of database. The components (`CoverageMatrix.vue`, `ScopeBanner.vue`, `TechniqueChips.vue`) consume those view models and add only encoding. This separation is what lets the report claim its honesty is *verified* rather than merely *intended*. It also pairs with the backend's own portability discipline — application-side hashing and scalar-only queries — so the calibrated presentation rests on the same point-in-time snapshot on either supported database (see [`./backend.md`](./backend.md)).

---

## Principle 12 — Declared zones are authoritative; a cross-zone link is a policy question, not a re-classification

**The principle.** Trust zones (and their planes, domains, and conduits) are the **operator's declared, administrative** classification of the model. The report reads them; it never recomputes or overrides them. When a flow crosses from one declared zone into another in a way the policy disallows, that is a **data-flow-policy verdict to flag** — "the model as drawn encodes an illegal crossing" — **not** a signal to re-classify either endpoint. Conduits are *declared intent*, not proven enforcement: a declared conduit records that a channel was approved, never that it is implemented or that isolation was verified. And the report deliberately surfaces the **declared effective zone**, never the engine's separate topological zone-tier *proposal*.

**Why it matters.** A reporting surface that silently "corrects" a boundary's zone — promoting it because it holds an asset, or demoting it because a flow reaches it — would launder the operator's own declaration and hide the very thing worth seeing: a link the declared design forbids. The honest move on an illegal crossing is to name it as a policy violation and leave the declaration standing, so the operator either fixes the model or ratifies the exception. Reading a conduit as *enforcement* would be the same over-claim in another place: an approved channel on paper is not a proven control. And displaying a computed zone *proposal* as if it were the model's zone would quietly overwrite an administrative fact with a suggestion.

**How the code enforces it.** The snapshot's per-boundary map is the **declared effective zone** from dt-core's `resolveEffectiveZone` (`declared` / `inherited` / `default`), assembled by the zoning adapter — explicitly **not** the topological `determineZoneTier` proposal, which the report never calls (see [`./backend.md`](./backend.md)). Over that declared map, `evaluateDataFlowPolicy` in `zoningPolicy.js` classifies each crossing flow and returns a *verdict* (`violation` / `warning` / `advisory` / `allowed`) — it changes no zone. A verdict is documented as meaning "the model as drawn encodes an illegal crossing," never "we verified the flow cannot occur." Conduits are treated fail-closed and as declared intent only: a declared conduit **never legalizes** an otherwise-illegal crossing (one that authorizes a violation is itself surfaced as a conduit *error*), and a conduit with no matching modeled flow is surfaced as muted *dead intent* rather than as coverage. In the Component Profile, the SecurityBoundary trust-zoning block labels its conduits plainly as declared intent, not an enforced permission. Because the declaration is never mutated, the report and the modeling side always agree on what a boundary's zone *is*.

---

## Principle-to-enforcement map

| Principle | Enforcing surface | Enforcing library / function |
|---|---|---|
| 1 — Snapshot-faithful, explicit staleness | Posture Summary header | `ScopeBanner.vue`; live structural fingerprint vs. stored fingerprint |
| 2 — No false aggregate | Posture Summary, Coverage & Gaps | `aggregateLedger` (partitioned totals); `computePostureSummary`; `coverageSummaryLines` |
| 3 — Dispositions never dropped | Residual Risk, Coverage & Gaps | `isLive`, `aggregateLedger` (`live`/`dispositioned` split, `byKind`, `stale`); `dispositionedExcluded` |
| 4 — Tier-segregated, function-classified coverage | Coverage & Gaps | `reduceTiers`, `filterByTier`, `TIER_RANK`; D3FEND hatch in `CoverageMatrix.vue` |
| 5 — Off-grid accounting | Coverage & Gaps | `buildCoverageView` (`softCount`, `dataMapped`, `structuralGaps`); always-visible counts in `CoverageMatrix.vue` |
| 6 — Flow routes, not attack paths | Reachability | `enumerateRoutes`, `modeAReachability` ("no modeled flow route", `minHops`) |
| 7 — Structural, not trust-based | Boundary Crossings, Reachability | `makeStackResolver`, `flowRankKey` (`verdictRank`-first), `SENSITIVITY_RANK`, `worklistUnranked`; dormant numeric `trustLevel`; structural origin set |
| 8 — No silent green, scope-first | Posture Summary header (all surfaces) | `computeCompletenessFlags`; flag scaffold in `ScopeBanner.vue` |
| 9 — Controls are context, not coverage | Posture Summary, Component Profile, Coverage & Gaps | defense-in-depth in `computePostureSummary`; `mismatchByElement`, `defenseInDepth` |
| 10 — One encoding legend | Coverage & Gaps | `CoverageMatrix.vue` (one fill + one glyph; greyscale); `TechniqueChips.vue` (untinted) |
| 11 — Pure, testable honesty layer | (all) | every `lib/*.js` compute module; TypeScript-enforced simple-path invariant |
| 12 — Declared zones authoritative; cross-zone link is a policy question | Boundary Crossings, Component Profile, Residual Risk | `resolveEffectiveZone` (not `determineZoneTier`); `evaluateDataFlowPolicy` (verdicts, conduit errors, dead conduits); `zoningAdvisories` |

---

## Related documentation

| Document | Description |
|---|---|
| [`./README.md`](./README.md) | Threat Report documentation index |
| [`./architecture.md`](./architecture.md) | System overview and the snapshot lifecycle at a glance |
| [`./backend.md`](./backend.md) | How the snapshot is gathered and served |
| [`./frontend.md`](./frontend.md) | How the rendered surfaces consume the snapshot |
| [`./data-model.md`](./data-model.md) | Snapshot and coverage payload contracts (field-level) |
| [ADR-007: Finding disposition lifecycle](../decisions/007-finding-disposition-lifecycle.md) | The platform disposition model the live/reviewed split builds on |
| [ADR-008: Embedding-based MITRE technique matching](../decisions/008-embedding-technique-matching.md) | How exposures acquire the technique mappings coverage joins on |
| [Platform Architecture](../README.md) | Graph-native platform overview |
