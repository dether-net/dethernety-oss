# Guided workflow — review, quick model (Step 9)

{{include shared/model-file-reads.md}}

{{include shared/tool-loading.md}}

## Step 9: Validation of a quick model

A quick model gets a read-only pass, and is never REVIEWED (the server refuses it, `quick_mode`).

1. Delegate the review:

   {{#delegate model-reviewer}}Review the model at `<model-path>`. Return: the quality score with its label, the red flags, and the top findings, ranked. Leave out the gate verdicts, the zoning findings and the recommendations. Write nothing.{{/delegate}}

2. Relay what the reviewer returned (Relay): the quality score with its label, then its Red Flags block verbatim — its heading with the count and one flag per line with element, field and value, never re-worded or folded; with none, "No red flags". Then its Top Findings block verbatim, in its order. Show no gates verdict, and ask neither `gate3-loopback`, a waiver question nor `review-record`.
3. Say in one line that Gate 3 was not run and that {{cmd:threat-model}} with `--full` on the same path deepens the model from Step 8, then enter `publish` in the same turn, with no footer: its first call is your next action — the turn never ends on the relay.
