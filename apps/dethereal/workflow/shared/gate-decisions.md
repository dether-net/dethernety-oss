## Gate 3 Decisions

**State shown with the verdicts.** Take it from {{tool:model_state}} `action: 'get'`: show `display_state` as given — it carries the waivers (e.g. `REVIEWED (3 waivers: C3×2, C8×1)`) and marks a review that went stale. When `reviewed_stale` is true, say the model changed after it was reviewed and that the review no longer describes it — unless `reviewed_stale_reason` is present: then show that reason instead, since a review hash that could not be taken is not a change.

### Recording a review

REVIEWED is granted by the server, never claimed. Record it only when {{tool:model_state}} `get` shows every precondition met — Gates 2 and 3 pass, and no stale element is left to resolve.

A model already REVIEWED whose `reviewed_stale` is false needs no new record: the review still describes it. When `reviewed_stale` is true, show what changed since `reviewed_at` (the model files' git history since then) before anything else; with a `reviewed_stale_reason`, show that reason and the files `content_hash_unavailable` names instead — nothing is known to have changed.

Call {{tool:validate_model_json}} with `action: 'gates'` now, and show from it what the operator signs, as markdown: `verdict` beside `verdict_without_waivers`; every waiver in use — criterion and element, its `basis`, `reason` and `waived_at` date — with the `accepted_risk` ones listed apart as risk acceptances; the number of Tier 3 components with no zone (`tier_members.tier3_unzoned`: they escape the Tier 1–2 floors only because they are unzoned); `floored_data_outside_tier12`; `data_items_at_floor_or_public`; the four value shares from `report.values`; and the `limit` sentence. Then ask:

{{#ask id=review-record}}Record this model as REVIEWED — the answers are complete and consistent (Gates 2 and 3), not proven true, and the waivers shown stay on record? (record / not now){{/ask}}

On `record`, call {{tool:model_state}} with `action: 'transition'`, `to: 'REVIEWED'` straight away — write nothing between the answer and the call. If the server refuses, show its message and `codes`, each entry of `failing_criteria`, and leave the state as it is. `review_hash_unavailable` means a file the review hash needs could not be read: show the files it names, for the operator to fix; never retry the transition until they are.

### When Gate 3 fails

The verdicts come first, once (Gate Verdicts): the verdict line, what blocks, the waived count, the report line and the `limit` sentence — or, shown again, what changed in the verdicts (never in the red flags, which are shown in full every time). Waiving is possible only for a failure whose `waivable` is true, on a criterion whose `waiver_headroom.remaining` is above 0; if none qualifies, say why (each `unwaivable_reason`, or the criterion's `waiver_headroom.reason` when `remaining` is 0) with the question, and that `waive` would be refused; on `waive` then, ask the question again. Then the red flags in full, the new ones marked, and then ask:

A `content_hash` that is `null` is never "unchanged": show `content_hash_unavailable` — its `code` and the files it names (`files_total` past the list) — for the operator to fix, and do not loop back on it. When a loop-back is shown again and nothing changed since its last showing — `loop_back_round.nothing_changed` is true, or, with no round, the same non-null `content_hash` from {{tool:model_state}} `get` and no new answer from the operator — say so first: another loop-back cannot change the result; only new answers can (give them in Step 8), or waive, or skip.

{{#ask id=gate3-loopback}}Gate 3 did not pass. Skip to sync anyway, loop back to Step 8 to fill the gaps, or waive named elements? Skipping leaves the model un-REVIEWED (ENRICHING). (skip to sync anyway / loop back / waive){{/ask}}

- **skip to sync anyway** — the state stays ENRICHING; never transition to REVIEWED. Everything that shows the state from here on shows it un-REVIEWED.
- **loop back** — first, before any write or Skill call, call {{tool:model_state}} with only `action: 'loop_back'`: it opens the loop on Gate 3's failing elements, and only a change made after it counts. Then a value the operator gives with it, for a declined or empty field, is an answer: write it to the file that holds the field — its attribute file, or `data-items.json` for a data item's `sensitivity`, `regulatory_flags`, `origin` or `is_credential` — with your edit tool, on every element it names — failing or not; the loop's worklist does not limit it. Write only a key the element's attribute file or class template lists, or a floor key: a fact no field holds is said in one line, never a key made up for it. Then enter `enrich` at once (Enter a phase, in the skill), before any other call, with the gates report's `gate3.loopback` as its worklist; the gates run again only when that phase reaches Step 9.
- **waive** — follow Waiving a Gap below, then run the gates again.

### When Gate 3 is not computed

`gate3.verdict` is `NOT_COMPUTED` while a loop back is open and some of its elements are untouched: `gate3.loop_back` lists them (the guard's list — not `gate3.loopback`, the worklist a computed failure carries). Never open the loop again here, and never ask `review-record`, `gate3-loopback` or a waiver question: there are no criteria to sign or waive.

1. Show the verdict line (`Gate 3 NOT COMPUTED`), the untouched elements — each by name with its listed fields, `+N more` from `untouched_total` — and the red flags as When Gate 3 fails says.
2. Ask their open fields, one row each — unless this loop's enrich phase already asked exactly these rows: then that reply stands, and nothing is asked again.

   {{#ask id=enrich-questions text}}Answer the rows you can, by row number; "not sure" leaves a row empty, never a guess.{{/ask}}

3. Write every value the reply gives to the file that holds the field — its attribute file, or `data-items.json` for a data item's `sensitivity`, `regulatory_flags`, `origin` or `is_credential` — with your edit tool, the files' edits in one message. Write only a key the element's attribute file or class template lists, or a floor key: a fact no field holds is said in one line, never a key made up for it. A field counts once it holds a real value — never `unknown` or another stand-in; the enricher's sourced values counted as soon as it wrote them.
4. Drop each row that this question, or the reply it reuses, left unanswered or answered "not sure" — never a row from an earlier round's declines — with {{tool:model_state}} `action: 'loop_back'`, `drop: [{ element_id, reason }]` (at most 50 a call). The reason is the operator's reply in its own words: verbatim, cut only when it is over 500 characters, as an excerpt with `[…]` where text was cut. Never write a reason yourself, and never drop to get past this. A refused drop — `loop_back_not_armed`, `loop_back_unknown_element`, or `reason_invalid` — is never fixed by rewording: show the refusal and ask that row again. `loop_back_unreadable`: open the loop again with only `action: 'loop_back'` (it lists every failing element again).
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

   {{#ask id=waiver-accept}}Waive any of the failures listed? (waive / no){{/ask}}

4. On `waive`, ask which:

   Take at most `remaining` elements per criterion: one element over the cap refuses the whole call.

   {{#ask id=waiver-select text}}Which failures do you want to waive? Give their row numbers.{{/ask}}

5. Show the four bases — `not_applicable`: the requirement does not apply; `not_observable`: the value cannot be observed; `accepted_risk`: the operator accepts the gap; `platform_limitation`: the platform cannot record it — then ask:

   {{#ask id=waiver-basis}}On which basis? (not applicable / not observable / accepted risk / platform limitation){{/ask}}

6. Ask for the reason:

   {{#ask id=waiver-reason text}}In one sentence, in your own words: why is this gap accepted? For an accepted risk, name who accepts it and until when.{{/ask}}

7. Only with the answers to these questions in this conversation (an inherited waiver's "use the same reason" is the `waiver-reason` answer), call {{tool:model_state_waive}} per criterion, at most 5 elements a call, with `criterion`, the `element_ids`, `reason` = the operator's sentence exactly as given — never shortened, reworded or cleaned — and `basis`. If the tool refuses, show its message and each refused element with the reason it gives; a refused reason (its length, or characters it does not accept) goes back to the operator with `waiver-reason`. `no_waiver_key` — this machine has no usable waiver key; `waiver_grants_unavailable` — this machine's grants file beside the key cannot be used: nothing is granted, show the message for the operator to fix it. `waiver_grants_full` — this machine holds as many grants for this model as it can: revoke waivers no longer used first.
8. Run the gates again, then {{tool:model_state}} `get`, and show the new `display_state`.

On `no`, go back to the `gate3-loopback` question.

### Waivers on record

Render `waivers[]` by status — `in_use`, `lapsed`, `resolved`, `unwaivable`, `unverified` — each with its criterion and element, its `basis` and `waived_at`, its `reason` when in use, and its `why` verbatim. An `unverified` waiver is inherited (`get` counts them as `waivers_inherited`): granted by another machine, a copy, or before waivers were bound to one machine; it does not count here. To use one, grant it here with the questions above, for the same criterion and elements, its `basis` shown as on record. At `waiver-reason`, show its `recorded_reason` first, labelled "recorded by another machine, not verified"; the operator confirms it or gives their own. Pass the recorded text as the `reason` only when the operator confirms it ("use the same reason"), exactly as recorded; an `{undisplayable}` one cannot be reused, so the operator gives their own. Waiving again otherwise always runs the questions above with a fresh reason. To withdraw waivers, show them by row, then ask:

{{#ask id=waiver-revoke text}}Which waivers do you want to revoke? Give their row numbers, or say "none".{{/ask}}

For each, call {{tool:model_state_waive}} with `revoke: true`, its `criterion` and `element_ids`.
