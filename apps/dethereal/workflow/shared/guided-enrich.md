# Guided workflow — enrich (Step 8)

{{include shared/model-file-reads.md}}

{{include shared/tool-loading.md}}

## Step 8: Enrichment

A quick model (`get` shows `mode: 'quick'`) enriches the `priority` set only: say so in one line, and ask no scope question; a full run enriches the whole worklist.

The work runs in agents, each started fresh, never resumed: this conversation starts them, shows the relay they write and asks once. In this step it reads no attribute file, and writes no model file but through the data-item questions and a transition. Data items asked here follow Step 7's Data items section, in the `classify` phase's file: read it first when it is not in your context.
{{#harness claude}}
Each agent answers in a notification: never read its output file.
{{/harness}}

After a loop back from `gate3-loopback`, `--phase enrich` takes up Step 8 at once: after the reads and the state, your next call is Step 8's delegation to the {{agent:security-enricher}} agent with the last gates report's `gate3.loopback` as its worklist — never a gates call first, unless that report is no longer in view (after a compaction): then one gates call, whose `gate3.loop_back.untouched` is the worklist. Delegate even when you think nothing more can be answered: the agent decides that from the source, and each field it cannot settle is asked in the relay. In the worklist the last gates report's `gate3.loopback` (with Gate 3 `NOT_COMPUTED`, its `gate3.loop_back.untouched`, the same shape) comes first: each of its `elements` with exactly its `fields` (one with no `fields` needs a data item and its link: ask the data-item questions for it as Step 7 does); name its `not_enrichable` entries and their reasons to the operator, never send them to the agent.

1. **The enrichment runs.** Call {{tool:model_state}} `get` once, then delegate:

   {{#delegate security-enricher}}Enrichment mode. Model directory: `<model-path>`. Worklist: <after a loop back, its elements first, each with exactly its fields>, then the snapshot — take it yourself (Worklist and order), in these words, never a tier or element list — or, for a later run, in order: <the remaining worklist the last run returned>. Enrich at most 12 of its elements in this run: a store takes the worklist's flows that touch it into the same run, past 12 if need be but never past 20; return the rest as the remaining worklist. Scope: <all, or priority on a quick model>. On a quick model, data items, each in the batch of the store that persists it: <the data items mapped to a crown jewel or carrying a regulatory flag, by id>. Stale elements: <for the first run, `stale_elements` from the `get`; for a later run, those of them in its worklist>. Declined fields — never propose or ask them: <each `declined_fields` row from the `get`, when it has them, and each field the operator rejected or left empty in this conversation: element, field; or none>. The operator's answers in this conversation since the last pass — written; use them as given, never ask them again: <each: element, field, value, or none>. The earlier runs' relay files, in run order — read them first, and carry on from them: <their paths, or none>. <After a cut-off: An earlier run on this worklist was cut off.> Relay folder: `<model-path>/.dethereal/relay/`. Run the Enrichment Protocol in its specialist mode: write cited and derived values to the attribute files, and write your return to the relay folder.{{/delegate}}

   While a run returns a remaining worklist, start the next run with it, once the last one has returned. A run that returns empty or cut off is started once more, fresh, with its own worklist and the cut-off line. Cut off again, or not started: relay the completed runs' files as the Enrichment Relay says, naming above the question the cut-off run's elements — values on them were written but not shown — then stop and tell the operator to run `{{cmd:enrich}} --pick <their ids>`, which shows those values to keep, reject or change — never enrich from memory here.
2. **The relay and the answers**, once the last run has returned, as the Enrichment Relay says.
3. **Close**, before anything else writes the model: remove each enriched stale element ({{tool:model_state}} `action: 'stale'`, `remove`), when the `get` listed any. The state stays ENRICHING.

   On a quick model, record the step with {{tool:model_state}} `action: 'transition'`, `to: 'ENRICHING'`, `quick_through: 8` — a transition to the state it holds records the step alone. Its `priority_gaps` — Gate 3's C2 and C8 still open on the priority set — were asked in the relay: show in one line C2's `rate` against its `floor` and the fields left, and ask no more. With `priority_gaps_unavailable` in its place, say so in one line with its reason; never read it as passing. Then say in one line that the control pass is deferred — `{{cmd:enrich}} --focus controls` runs it — and enter `review` in the same turn, with no control-pass offer and no footer. In a full run, when `get` still shows a `quick_through`, clear it (`action: 'transition'`, `to: 'ENRICHING'`, `quick_through: null`) before the offer.

### Control pass offer

Take N = B + 2 from the boundary count B (an enforcement question per boundary, one for detection, one for governance; 3 with no boundaries). Show `Enrichment complete. Quality: X/100.`, then ask:

{{#ask id=control-pass-offer}}Run the control assignment pass now (about N questions), or later? (continue / later){{/ask}}

- **continue** — load {{skill:enrich-controls}} with `--focus controls <model-path>` and follow it to its footer: it runs the control pass, relays each proposal table and asks its questions. If it cannot be loaded, stop and tell the operator. Its footer is not yours to stop on: read the model files and `controls/` again, and enter `review` in the same turn.
- **later** — say `To resume: {{cmd:enrich}} --focus controls` (the enrichment is saved; controls can be assigned at any time), then enter `review` in the same turn; the quality score's `control_coverage_rate` shows the gap.

{{include shared/enrichment-relay.md}}
