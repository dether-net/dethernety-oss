# Guided workflow — publish (Steps 10–11)

{{include shared/model-file-reads.md}}

{{include shared/tool-loading.md}}

## Step 10: Sync

Publish the model as the Push Flow below says, guided-workflow consent included. On a quick model, the consent's state line also says that it is a quick model, that Gate 3 was not run, and that {{cmd:threat-model}} with `--full` on the same path deepens it. A sign-in `skip` goes on to the README and the final footer without sync next steps; a consent `skip`, with `{{cmd:sync}} push` as the next step.

**Push consent**, asked where the Push Flow says: after Resolve and validate, before Routing. In the guided workflow, reaching the sync step is not consent to publish, and neither is a successful sign-in. Show, as markdown:

- the platform URL, and whether this creates a new platform model or updates the existing one (its `manifest.model.id`);
- the state as {{tool:model_state}} `get` reports it (`display_state`, with its waivers and a stale review) and the latest Gate 3 verdict — a model whose Gate 3 was skipped is **not** REVIEWED, and say so;
- the counts: boundaries, components, data flows, data items;
- that the model's asset context publishes too — scope, crown jewels, data sensitivity and regulatory flags — with REPLACE semantics: a value cleared locally is cleared on the platform.

Then ask:

{{#ask id=push-consent}}Model passed Gate 2 and is ready to publish to <platformUrl>. Push to platform now? (push / skip){{/ask}}

On `skip`, go on to README generation and the final footer, with `{{cmd:sync}} push` as the next step.

**After the push — the control library.** Call {{tool:workspace_status}} with `directory_path`. If its `controlLibrary` counts `pendingEdits` or `unpushed` controls, the model is published but its control library is not: say so, with the counts, and hand the control library over: load {{skill:sync-controls}} with `push`, the directory, the model id and this push's counts, and follow it to its footer — the model is already pushed, so never run {{cmd:sync push}} again for it. A `pull` answer at `push-conflict` hands over instead of pushing: load {{skill:sync-pull}} with the directory, the model id and `backup`, and follow it; push nothing. If a skill cannot be loaded, stop and tell the operator.

Then read the model files again (the server ids are now in them) and show the push summary:

```
Pushed "<model-name>" to platform.
  <N> boundaries, <M> components, <K> flows, <J> data items.
  Platform model ID: <id>

Server IDs written to local files.
Commit these changes to preserve sync state.
```

## Step 11: Post-Sync Linking

Link local countermeasures to the platform-computed exposures, so defense coverage credits existing controls.

1. If no element carries a control, say "No countermeasures defined. After analysis completes, run {{cmd:surface}} to see control gaps and exposure distribution." and go to the README.
2. Call {{tool:get_control_gaps}} with the `model_id` for the model's exposures — never {{tool:query_exposures}} `list`, which needs an `element_id` and refuses a model-wide call.
3. No exposures: "Analysis results not available yet. Linking will be possible after the analysis engine processes this model." An error is not that: show it — the call was malformed or the platform unreachable.
4. With exposures, show the table — exposure, component, candidate countermeasure, link — then ask:

   {{#ask id=linking}}Link these exposures to the candidate countermeasures now, change specific rows, or defer? (yes / modify / defer){{/ask}}

   `yes`: create the links with {{tool:manage_countermeasures}}. Linking an existing countermeasure is an `update` with `exposure_ids`, and `update`, like `delete`, works only on a USER countermeasure: the tool refuses a SYSTEM one (derived from its control's class). For a SYSTEM one, tell the operator to supersede it into an editable copy in the platform (**Customize as an editable copy**), then link the copy. `modify`: take the rows the operator drops or changes, show the table again and ask again; a link is created only for a row they confirmed — a wrong link credits a control that does not mitigate the exposure. `defer`: say that the analysis undercounts the defenses until exposures are linked to countermeasures.

## README and footer

Generate `README.md` (README Generation Protocol), also when the sync was skipped. On a quick model, show the Top Findings block Step 9 relayed again, verbatim, when it is in this conversation; otherwise say it is in the review of Step 9. Then:

```
[done] Threat model "<name>" complete. Quality: X/100 (<label>). State: <display_state>.
[next] When you're ready: run analysis on the platform, then {{cmd:surface}} (review attack surface)
```

After a consent `skip`, the next step is `{{cmd:sync}} push (publish to platform for analysis)`; after a sign-in `skip`, the footer names no sync step. On a quick model, the footer's next step also names deepening: {{cmd:threat-model}} with `--full` on the same path runs the full enrichment from Step 8, then the review.

{{include shared/push-flow.md}}

{{include shared/push-flow-reference.md}}

{{include shared/control-resolution.md}}

{{include shared/readme.md}}
