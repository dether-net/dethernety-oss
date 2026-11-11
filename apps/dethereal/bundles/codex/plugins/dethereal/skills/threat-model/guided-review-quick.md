# Guided workflow — review, quick model (Step 9)

**Model files, once per step.** Read a model file once in a step and keep it: after your own write succeeds, the file holds what you wrote — do not read it again. Read it again only after a failed write or validate, a compaction or summary, or a write you did not make with your edit tool: an agent's (any model file) or a push (every model file). Nothing else rewrites a model file: `mcp__dethereal__validate_model_json` never does, and `mcp__dethereal__generate_attribute_stubs` writes only attribute files — read one again after it before you edit it. After any such write, read the file again before a whole-file write of it. The same holds for `.dethereal/discovery.json` and `.dethereal/scope.json`: never read a file to see what you wrote — your write is the file, and your edit tool edits it without a read first.

**Model-file writes, one message per answer.** Everything one operator answer changes in `structure.json`, `dataflows.json`, `data-items.json`, `.dethereal/discovery.json` and the attribute files (in the enrich skill, as Writing and validating says) goes in one message: every edit to every one of those files, as parallel calls; one edit per element is fine. A read those edits need goes in the message before. Validate in the message after, once every edit has succeeded. Never spread one answer's edits over two messages; only a failed edit is redone, after reading its file again. A whole-file write replaces a file's edits only when it is shorter.
With `apply_patch`, that message is one call: one patch, a section per file, a hunk per change.



## Step 9: Validation of a quick model

A quick model gets a read-only pass, and is never REVIEWED (the server refuses it, `quick_mode`).

1. Delegate the review:

   Use the `spawn_agent` tool with `agent_type: "dethereal-model-reviewer"`, `fork_turns: "none"` and this message: “Review the model at `<model-path>`. Return: the quality score with its label, the red flags, and the top findings, ranked. Leave out the gate verdicts, the zoning findings and the recommendations. Write nothing.” Then wait for its final answer with `wait_agent`, and once you have it close the agent with `close_agent` — a finished agent counts against the session's agent limit until it is closed; if you have no `close_agent` tool, go on, and if a later `spawn_agent` fails on the agent limit, stop and tell the operator. If the agent cannot be started, or it returns without doing the work, stop and tell the operator; do not do its work yourself.

2. Relay what the reviewer returned (Relay): the quality score with its label, then its Red Flags block verbatim — its heading with the count and one flag per line with element, field and value, never re-worded or folded; with none, "No red flags". Then its Top Findings block verbatim, in its order. Show no gates verdict, and ask neither `gate3-loopback`, a waiver question nor `review-record`.
3. Say in one line that Gate 3 was not run and that `$dethereal:threat-model` with `--full` on the same path deepens the model from Step 8, then enter `publish` in the same turn, with no footer: its first call is your next action — the turn never ends on the relay.
