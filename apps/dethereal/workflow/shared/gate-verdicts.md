## Gate Verdicts

The three gates are computed by the server. Call {{tool:validate_model_json}} with `action: 'gates'` and report what it returns — never compute a verdict yourself, never infer one from the quality score, and never apply a score threshold. The quality score is reported as a label; it gates nothing.

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

A `NOT_COMPUTED` Gate 3 is neither a pass nor a fail: its criteria are unknown. The verdict line reads `Gate 3 NOT COMPUTED (loop back open: N untouched)`, then the untouched elements by name; Step 9 of {{cmd:threat-model}} ends the open loop.

**Shown again** (after a loop-back or a waiver): compare this gates result with the previous one **you called in this conversation** whose Gate 3 was computed, criterion by criterion — newly failing elements in full, never folded; resolved ones ✓ by name; still failing as a count (names when 5 or fewer); lapsed waivers in full with the tool's reason; each verdict as `before → now`; only the report numbers that changed; and the `limit` sentence. Never compare with a result you remember: after a compaction, or without the previous result in view, show the full form above.

Tiers come from the tool's report only — see Component Tiers. Never assign a component to a tier yourself.
