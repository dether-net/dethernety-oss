# Guided workflow — review (Step 9)

**Model files, once per step.** Read a model file once in a step and keep it: after your own write succeeds, the file holds what you wrote — do not read it again. Read it again only after a failed write or validate, a compaction or summary, or a write you did not make with your edit tool: an agent's (any model file) or a push (every model file). Nothing else rewrites a model file: `dethereal_validate_model_json` never does, and `dethereal_generate_attribute_stubs` writes only attribute files — read one again after it before you edit it. After any such write, read the file again before a whole-file write of it. The same holds for `.dethereal/discovery.json` and `.dethereal/scope.json`: never read a file to see what you wrote — your write is the file, and your edit tool edits it without a read first.

**Model-file writes, one message per answer.** Everything one operator answer changes in `structure.json`, `dataflows.json`, `data-items.json`, `.dethereal/discovery.json` and the attribute files (in the enrich skill, as Writing and validating says) goes in one message: every edit to every one of those files, as parallel calls; one edit per element is fine. A read those edits need goes in the message before. Validate in the message after, once every edit has succeeded. Never spread one answer's edits over two messages; only a failed edit is redone, after reading its file again. A whole-file write replaces a file's edits only when it is shorter.



## Step 9: Validation

This file is the full model's; a quick model reads its own.

1. Delegate the review:

   Use the `task` tool with `subagent_type: "dethereal-model-reviewer"`, a 3–5 word `description`, and this prompt: “Review the model at `<model-path>`. Return: the quality score with its label and factor breakdown, the top issues, the zoning coherence findings, and the red flags. Leave out the gate verdicts (this conversation calls the gates itself) and the recommendations (the loop-back question covers them). Write nothing.” Wait for its result. If the agent cannot be started, or it returns without doing the work, stop and tell the operator; do not do its work yourself.

2. Call `dethereal_validate_model_json` with `action: 'validate'`, `include: ['gates']` (core rule 6) and show the verdicts once (Gate Verdicts below), the reviewer's Red Flags block right after them in the same message and before any question, then what the reviewer returned, by table kind (Relay):
   - the quality score and label in the verdict line; the factor table waits for `details quality`;
   - the red flags — the reviewer's Red Flags block verbatim, its heading with the count and every line: one flag per line with element, field and value, never re-worded, grouped into a sentence or folded. On every showing, all of them again, the new ones marked. With none, "No red flags" — never a heading or a list with nothing in it;
   - the top issues that a failing criterion does not already show — with none, say so in one line, never an empty bullet;
   - the zoning coherence findings — advisory, never blocking a push: each Warning kind on one line with its count and up to three names; the Info findings in one line, their names behind `details zoning`. Their "N unclassified" count is the one Step 4 forward-references. A structural container shows its roll-up: `— structural · spans <min>…<max>`, with `· contains crown jewels`, `· includes a vendor enclave` or `· N descendant segments still unclassified` from the payload's `summary`.
3. **Gate 3 passes** (the server's verdict): record the review as Gate 3 Decisions says (`review-record`); the server grants REVIEWED. Then enter `publish` in the same turn: its first call is your next action — the turn never ends on the record. On `not now`, the state stays ENRICHING and `publish` follows as after `skip to sync anyway`.
4. **Gate 3 fails:** the state stays ENRICHING; follow When Gate 3 fails. `loop back` enters `enrich` with the gates report's `gate3.loopback` as its worklist; `skip to sync anyway` enters `publish` in the same turn, saying the analysis may be incomplete.

Nothing here writes `.dethereal/quality.json` or the state directly: the server computes both.

## Gate Verdicts

The three gates are computed by the server. Call `dethereal_validate_model_json` with `action: 'gates'` and report what it returns — never compute a verdict yourself, never infer one from the quality score, and never apply a score threshold. The quality score is reported as a label; it gates nothing.

**Summary or full.** A progress check — a step's gates or quality call before Step 9, a skill's quick view — passes `detail: 'summary'`: each check is its verdict, or `{verdict, failing_total, failing}` with the failing ids only; the Gate 3 report whole; `loopback.elements_total`; `lints_total`; for quality, the score, its factors and the five elements with the most unresolved fields, without their fields. Step 9, a loop back and its re-check, a push and a review call it without (`'full'`, the default): every failing element with its fields, the loop-back worklist and `attribute_residual.top_unresolved` in full.

**What the tool returns:**

- `gate1` — `PASS` or `WARN`, with its `checks`. Advisory: shown inline, never blocks.
- `gate2` — `PASS` or `FAIL`, with its `checks`. The platform refuses a push while Gate 2 fails.
- `gate3` — `verdict` and `verdict_without_waivers` (each `PASS` or `FAIL`), `criteria` C1–C9, `waived_total`, `waivers`, `report`, and `limit`; after a loop back, `loop_back_round`. While a loop back is open and some of its elements are untouched, `gate3` is `verdict: 'NOT_COMPUTED'` instead, with a `code`, its `message` and `loop_back` (`untouched`, each element with its `criteria` and `fields`; `untouched_total`, `touched_total`, `dropped_total`); Gates 1 and 2 are computed as usual.

A passing check with nothing waived is just `{verdict, value}`. Any other carries `verdict`, `value`, `failing` (`{id, name, detail}`, at most 100 listed; a field gap of C2, C3 or C8 gives its fields in `missing` and `placeholder` instead of `detail`), `failing_total`, a `remedy` when it fails, and — in Gate 3 — `waived`, the failures a waiver currently covers; each Gate 3 failure also says whether it is `waivable` (with an `unwaivable_reason` when not), and each criterion its `waiver_headroom`.

**How to render them** — once per showing, from your own call (never from an agent's retelling), as markdown, before any question about them:

1. **One verdict line:** `Gate 1 WARN (2) · Gate 2 PASS · Gate 3 FAIL (without waivers: FAIL) · Quality 61/100 In Progress` — Gate 3's `verdict_without_waivers` whenever it differs.
2. **What blocks:** each failing Gate 2 and Gate 3 criterion — its name and `value`, up to 5 failing elements by name with their `detail`, or a field gap's `missing` and `placeholder` fields, then `+N more — details <criterion>` from `failing_total`; how many are `waivable` and its `waiver_headroom.remaining`; its `remedy` — a remedy that mentions a waiver points to Step 9: never act on it earlier. A `placeholder` field names a stand-in value (`"unknown"`, `TBD`, `TBC`, `?`, "not specified", an n/a spelling, an empty string, a template sentinel, a list entry that names nothing such as `["None"]`): that failure can never be waived — replace them with `null`, or with a real value the operator confirms, first. One with only `missing` fields is a gap. Gate 1's checks wait for `details gate1`.
3. **Waived failures:** one line per criterion with their count; they are listed in full where a question signs them (`review-record`, `waiver-select`). Inherited waivers — `unverified` in `waivers`, counted by `get` as `waivers_inherited` — get one line with their count: they do not count here until granted on this machine.
4. **The report, one line:** any `crown_jewel_map` entries (always), and only the numbers that are non-zero or out of line — `zone_disagreements`, `floored_data_outside_tier12`, `declared_unauthenticated`, the stand-in and type-default shares, the unzoned count. The rest (tier counts, `data_items_at_floor_or_public`) waits for `details report`.
5. **The `limit` sentence**, verbatim: Gate 3 certifies that the recorded answers are complete and consistent, not that they are true.

A `NOT_COMPUTED` Gate 3 is neither a pass nor a fail: its criteria are unknown. The verdict line reads `Gate 3 NOT COMPUTED (loop back open: N untouched)`, then the untouched elements by name; Step 9 of `/dethereal-threat-model` ends the open loop.

**Shown again** (after a loop-back or a waiver): compare this gates result with the previous one **you called in this conversation** whose Gate 3 was computed, criterion by criterion — newly failing elements in full, never folded; resolved ones ✓ by name; still failing as a count (names when 5 or fewer); lapsed waivers in full with the tool's reason; each verdict as `before → now`; only the report numbers that changed; and the `limit` sentence. Never compare with a result you remember: after a compaction, or without the previous result in view, show the full form above.

Tiers come from the tool's report only — see Component Tiers. Never assign a component to a tier yourself.

## Gate 3 Decisions

**State shown with the verdicts.** Take it from `dethereal_model_state` `action: 'get'`: show `display_state` as given — it carries the waivers (e.g. `REVIEWED (3 waivers: C3×2, C8×1)`) and marks a review that went stale. When `reviewed_stale` is true, say the model changed after it was reviewed and that the review no longer describes it — unless `reviewed_stale_reason` is present: then show that reason instead, since a review hash that could not be taken is not a change.

### Recording a review

REVIEWED is granted by the server, never claimed. Record it only when `dethereal_model_state` `get` shows every precondition met — Gates 2 and 3 pass, and no stale element is left to resolve.

A model already REVIEWED whose `reviewed_stale` is false needs no new record: the review still describes it. When `reviewed_stale` is true, show what changed since `reviewed_at` (the model files' git history since then) before anything else; with a `reviewed_stale_reason`, show that reason and the files `content_hash_unavailable` names instead — nothing is known to have changed.

Call `dethereal_validate_model_json` with `action: 'gates'` now, and show from it what the operator signs, as markdown: `verdict` beside `verdict_without_waivers`; every waiver in use — criterion and element, its `basis`, `reason` and `waived_at` date — with the `accepted_risk` ones listed apart as risk acceptances; the number of Tier 3 components with no zone (`tier_members.tier3_unzoned`: they escape the Tier 1–2 floors only because they are unzoned); `floored_data_outside_tier12`; `data_items_at_floor_or_public`; the four value shares from `report.values`; and the `limit` sentence. Then ask:

`[prompt: review-record]` Record this model as REVIEWED — the answers are complete and consistent (Gates 2 and 3), not proven true, and the waivers shown stay on record? (record / not now) — table first, the `question` tool, header `review-record`; unanswered → ask again.

On `record`, call `dethereal_model_state` with `action: 'transition'`, `to: 'REVIEWED'` straight away — write nothing between the answer and the call. If the server refuses, show its message and `codes`, each entry of `failing_criteria`, and leave the state as it is. `review_hash_unavailable` means a file the review hash needs could not be read: show the files it names, for the operator to fix; never retry the transition until they are.

### When Gate 3 fails

The verdicts come first, once (Gate Verdicts): the verdict line, what blocks, the waived count, the report line and the `limit` sentence — or, shown again, what changed in the verdicts (never in the red flags, which are shown in full every time). Waiving is possible only for a failure whose `waivable` is true, on a criterion whose `waiver_headroom.remaining` is above 0; if none qualifies, say why (each `unwaivable_reason`, or the criterion's `waiver_headroom.reason` when `remaining` is 0) with the question, and that `waive` would be refused; on `waive` then, ask the question again. Then the red flags in full, the new ones marked, and then ask:

A `content_hash` that is `null` is never "unchanged": show `content_hash_unavailable` — its `code` and the files it names (`files_total` past the list) — for the operator to fix, and do not loop back on it. When a loop-back is shown again and nothing changed since its last showing — `loop_back_round.nothing_changed` is true, or, with no round, the same non-null `content_hash` from `dethereal_model_state` `get` and no new answer from the operator — say so first: another loop-back cannot change the result; only new answers can (give them in Step 8), or waive, or skip.

`[prompt: gate3-loopback]` Gate 3 did not pass. Skip to sync anyway, loop back to Step 8 to fill the gaps, or waive named elements? Skipping leaves the model un-REVIEWED (ENRICHING). (skip to sync anyway / loop back / waive) — what it follows, then the question with its choices numbered, in one message, not the `question` tool; end your turn; unanswered → ask again.

- **skip to sync anyway** — the state stays ENRICHING; never transition to REVIEWED. Everything that shows the state from here on shows it un-REVIEWED.
- **loop back** — first, before any write or Skill call, call `dethereal_model_state` with only `action: 'loop_back'`: it opens the loop on Gate 3's failing elements, and only a change made after it counts. Then a value the operator gives with it, for a declined or empty field, is an answer: write it to the file that holds the field — its attribute file, or `data-items.json` for a data item's `sensitivity`, `regulatory_flags`, `origin` or `is_credential` — with your edit tool, on every element it names — failing or not; the loop's worklist does not limit it. Write only a key the element's attribute file or class template lists, or a floor key: a fact no field holds is said in one line, never a key made up for it. Then enter `enrich` at once (Enter a phase, in the skill), before any other call, with the gates report's `gate3.loopback` as its worklist; the gates run again only when that phase reaches Step 9.
- **waive** — follow Waiving a Gap below, then run the gates again.

### When Gate 3 is not computed

`gate3.verdict` is `NOT_COMPUTED` while a loop back is open and some of its elements are untouched: `gate3.loop_back` lists them (the guard's list — not `gate3.loopback`, the worklist a computed failure carries). Never open the loop again here, and never ask `review-record`, `gate3-loopback` or a waiver question: there are no criteria to sign or waive.

1. Show the verdict line (`Gate 3 NOT COMPUTED`), the untouched elements — each by name with its listed fields, `+N more` from `untouched_total` — and the red flags as When Gate 3 fails says.
2. Ask their open fields, one row each — unless this loop's enrich phase already asked exactly these rows: then that reply stands, and nothing is asked again.

   `[prompt: enrich-questions]` Answer the rows you can, by row number; "not sure" leaves a row empty, never a guess. — a plain message; end your turn; unanswered → ask again.

3. Write every value the reply gives to the file that holds the field — its attribute file, or `data-items.json` for a data item's `sensitivity`, `regulatory_flags`, `origin` or `is_credential` — with your edit tool, the files' edits in one message. Write only a key the element's attribute file or class template lists, or a floor key: a fact no field holds is said in one line, never a key made up for it. A field counts once it holds a real value — never `unknown` or another stand-in; the enricher's sourced values counted as soon as it wrote them.
4. Drop each row that this question, or the reply it reuses, left unanswered or answered "not sure" — never a row from an earlier round's declines — with `dethereal_model_state` `action: 'loop_back'`, `drop: [{ element_id, reason }]` (at most 50 a call). The reason is the operator's reply in its own words: verbatim, cut only when it is over 500 characters, as an excerpt with `[…]` where text was cut. Never write a reason yourself, and never drop to get past this. A refused drop — `loop_back_not_armed`, `loop_back_unknown_element`, or `reason_invalid` — is never fixed by rewording: show the refusal and ask that row again. `loop_back_unreadable`: open the loop again with only `action: 'loop_back'` (it lists every failing element again).
5. If the operator chooses here to skip to sync, end the loop first with `action: 'loop_back'`, `drop_remaining: { reason }`, the reason their reply as given; then enter `publish` as after `skip to sync anyway`.
6. Run the gates again. Gate 3 is computed now, and a dropped element still fails it: a drop is not a waiver. Show `loop_back_round` once, right after the verdict line — each element and how it left (`changed`, `removed`, `not_listed` — no longer on Gate 3's list, so now passing — `waived` or `dropped`), and `nothing_changed` when it is set — never folded; then follow When Gate 3 fails. When every remaining element was dropped, say so: `waive` is open now, and another `loop back` opens the loop on the full list again, the dropped elements included.

### Waiving a gap

A waiver is the operator's decision that one criterion's failure is accepted for named elements, with their reason on record. Never offer or ask about a waiver outside these questions; if the operator asks for one elsewhere, point to Step 9. Consent is only `waive` at `waiver-accept`, and the reason only the reply to `waiver-reason`: a reply to any other question — "not sure", "record the rest as unknown" — is neither, and such a field stays `null` (declined). A **lapsed** waiver is granted again only on a new `waiver-accept` and a new reason; an inherited one follows Waivers on record.

1. Show the failures that can be waived, by row: criterion, element (name, id), `detail` — for a field gap, its `missing` and `placeholder` fields — the criterion's `remedy`, and per criterion its `waiver_headroom` (`in_use` of `cap`, `remaining`, and its `reason` when `remaining` is 0). List the failures that cannot, apart, each with its `unwaivable_reason`.
2. Say what a waiver does, one line each — the rules that decide which failures qualify are already applied through `waivable` (say `details rules` to list them):
   - at most 5 elements per call, and one refused element refuses the whole call;
   - going over a criterion's cap (a quarter of what it assesses, rounded down; under 4, none) voids all of that criterion's waivers;
   - a waiver applies only while its element fails the same way — a changed `detail` or field list, even progress, lapses it;
   - it holds only where this machine granted it: elsewhere — a teammate's machine, a copy of the model — it reads as inherited (`unverified`) and does not count until it is granted there.

   On `details rules`: never waived — C5 and C6; C1 on a Tier 1–2 component; any failure marked `waivable: false`, such as a floor set by a data class or a regulatory flag (a C7 floor set only by the item's own sensitivity pattern can be waived when no regulatory flag reaches it); no C2 waiver takes effect while any Tier 1–2 component is unclassified or has no cached template, and no C4 waiver while the model has no data items; C2 and C8 are never both waived on one element; C2 keeps at least one crown-jewel Tier 1–2 component measured (if every one is waived, all their C2 waivers stop applying); at most 200 waivers on a model.
3. Ask whether to waive at all:

   `[prompt: waiver-accept]` Waive any of the failures listed? (waive / no) — table first, the `question` tool, header `waiver-accept`; unanswered → ask again.

4. On `waive`, ask which:

   Take at most `remaining` elements per criterion: one element over the cap refuses the whole call.

   `[prompt: waiver-select]` Which failures do you want to waive? Give their row numbers. — a plain message; end your turn; unanswered → ask again.

5. Show the four bases — `not_applicable`: the requirement does not apply; `not_observable`: the value cannot be observed; `accepted_risk`: the operator accepts the gap; `platform_limitation`: the platform cannot record it — then ask:

   `[prompt: waiver-basis]` On which basis? (not applicable / not observable / accepted risk / platform limitation) — table first, the `question` tool, header `waiver-basis`; unanswered → ask again.

6. Ask for the reason:

   `[prompt: waiver-reason]` In one sentence, in your own words: why is this gap accepted? For an accepted risk, name who accepts it and until when. — a plain message; end your turn; unanswered → ask again.

7. Only with the answers to these questions in this conversation (an inherited waiver's "use the same reason" is the `waiver-reason` answer), call `dethereal_model_state_waive` per criterion, at most 5 elements a call, with `criterion`, the `element_ids`, `reason` = the operator's sentence exactly as given — never shortened, reworded or cleaned — and `basis`. If the tool refuses, show its message and each refused element with the reason it gives; a refused reason (its length, or characters it does not accept) goes back to the operator with `waiver-reason`. `no_waiver_key` — this machine has no usable waiver key; `waiver_grants_unavailable` — this machine's grants file beside the key cannot be used: nothing is granted, show the message for the operator to fix it. `waiver_grants_full` — this machine holds as many grants for this model as it can: revoke waivers no longer used first.
8. Run the gates again, then `dethereal_model_state` `get`, and show the new `display_state`.

On `no`, go back to the `gate3-loopback` question.

### Waivers on record

Render `waivers[]` by status — `in_use`, `lapsed`, `resolved`, `unwaivable`, `unverified` — each with its criterion and element, its `basis` and `waived_at`, its `reason` when in use, and its `why` verbatim. An `unverified` waiver is inherited (`get` counts them as `waivers_inherited`): granted by another machine, a copy, or before waivers were bound to one machine; it does not count here. To use one, grant it here with the questions above, for the same criterion and elements, its `basis` shown as on record. At `waiver-reason`, show its `recorded_reason` first, labelled "recorded by another machine, not verified"; the operator confirms it or gives their own. Pass the recorded text as the `reason` only when the operator confirms it ("use the same reason"), exactly as recorded; an `{undisplayable}` one cannot be reused, so the operator gives their own. Waiving again otherwise always runs the questions above with a fresh reason. To withdraw waivers, show them by row, then ask:

`[prompt: waiver-revoke]` Which waivers do you want to revoke? Give their row numbers, or say "none". — a plain message; end your turn; unanswered → ask again.

For each, call `dethereal_model_state_waive` with `revoke: true`, its `criterion` and `element_ids`.

## Component Tiers

Tiers rank a model's components for enrichment depth, gate coverage and review. The server computes them — every Gate 3 result from `dethereal_validate_model_json` `action: 'gates'` reports the tier sizes — and this is the definition it applies. Never assign a tier by hand or by another rule.

External entities are never tiered. Every other component gets the **first** tier it qualifies for:

| Tier | A component is in this tier when |
|------|----------------------------------|
| **Tier 1** — internet-facing | it is an endpoint of a cross-boundary flow **and** either its zone is PUBLIC or EXPOSED, or it has a flow with an external entity whose zone is not VENDOR |
| **Tier 2** — crown-jewel-bearing or restricted | it has `crownJewel: true`; or its zone is RESTRICTED; or one of its `dataItemIds` is a mapped crown-jewel data item; or it sits inside a mapped crown-jewel boundary, at any depth |
| **Tier 3** — everything else | every other non-external component, unzoned ones included |

The terms in the table:

- **Zone of a component** — the declared or inherited zone of the boundary it sits in (the boundary's own zone, or the nearest ancestor's that declares one). A component with neither is **unzoned**. Zones proposed by `dethereal_validate_model_json` `action: 'zoning'` never count until the operator declares them.
- **Cross-boundary flow** — a flow whose two endpoints sit in different boundaries, or where exactly one endpoint is an external entity (so a flow between an external entity and a component in the same boundary crosses too). An endpoint that is a boundary sits in itself. A flow whose endpoint does not resolve is ignored.
- **Zone of an external entity** — VENDOR when its boundary's declared or inherited zone is VENDOR, otherwise UNTRUSTED, wherever it is drawn. This is why declaring every boundary INTERNAL cannot empty Tier 1: only a vetted vendor zone (declared or inherited VENDOR) stops an external entity from making its peers internet-facing.
- **Mapped crown jewels** — the element ids the operator confirmed for each `crown_jewels` entry of the scope, kept as `crown_jewel_elements` in `.dethereal/scope.json`.

Unzoned components are counted and reported with every Gate 3 result, and Gate 1 warns about each one. Tier 1 and Tier 2 are the components Gate 3 holds to the attribute and six-attribute floors (C2, C8).

### Numbering

Older guidance numbered internet-facing components **Tier 3**. They are **Tier 1** now. When reading older notes or models, translate a tier by what it meant, never by its number.

Compliance "tiers" are a different thing and are called **depth levels**.
