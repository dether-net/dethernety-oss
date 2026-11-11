---
name: threat-model
description: Guided end-to-end threat modeling workflow — scope through validation and sync
argument-hint: "[system description or model path] [--full-scan] [--full|--quick]"
---

The guided threat-modeling workflow: eleven steps from scope to publishing, in five phases. The server keeps the state, so a run can stop and resume. Arguments: {{args}}.

{{include shared/core-rules.md}}

## Phases

Each phase's steps, questions and procedures are in its own file next to this skill. **Enter a phase** at the start, when a step moves into the next phase, on a jump from `resume-cursor`, on a loop back from `gate3-loopback`, on a backward transition to Step 4, into and out of a deepening run's Step 6, and after any compaction or summary:

{{#harness claude}}
1. After any compaction or summary, invoke this skill again: the `Skill` tool with `skill: "dethereal:threat-model"` and `args: "--phase <phase> <model-path>"`. Then — and at the start, in the turn whose invocation started the run — before any message, read Secret Files, the Model Guidelines, the File Format, Relay and the phase's file.
2. Any other entry: read the phase's file only — the others are still in your context. If that read is refused, invoke the skill again as in 1 and read at once.
{{/harness}}
{{#harness codex,opencode}}
Read Secret Files, the Model Guidelines, the File Format, Relay and the phase's file, in full, before anything else in the phase. They stay in your context: never search the skill's files for what they say.
{{/harness}}

If a file cannot be read, stop and tell the operator — never run a phase from memory. Then take up the step the state and the files show, and ask again any question still unanswered.

**Between steps** your turn goes on — no footer, no summary, no "ready when you are". It ends only at a question, a named stop, a running agent (rule 4) or the final footer; a handed-over skill's footer is not yours: go on as the handover says.

**Secret Files**, before any configuration is read:

{{include shared/secret-files.md as-file}}

**Model Guidelines** and **File Format**, before any model file is written:

{{include shared/guidelines-core.md as-file}}

{{include shared/guidelines-schema.md as-file}}

**Relay** and delegation:

{{include shared/phase-tail.md as-file}}

A phase reads only its own file, on entry — never the others ahead of time.

`build` (Steps 1–5), on entry:

{{include shared/guided-build.md as-file}}

With it on a full run — never on a quick model — the worked examples:

{{include shared/guidelines-examples.md as-file}}

`classify` (Steps 6–7):

{{include shared/guided-classify.md as-file}}

`enrich` (Step 8):

{{include shared/guided-enrich.md as-file}}

`review` (Step 9: a full run reads only the first file, a quick model only the second):

{{include shared/guided-review.md as-file}}

{{include shared/guided-review-quick.md as-file}}

`publish` (Steps 10–11):

{{include shared/guided-publish.md as-file}}

`drift` (on a resume):

{{include shared/drift-protocol.md as-file}}

## Entry and resume

**Arguments.** `--phase <phase> <model-path>` re-enters a phase within a run: `get` the state, read the files (Phases) — a model file again only after a compaction, a write your edit tool did not make, or a fix the operator was sent to make by hand — and take up the step — no drift check, no progress question. After a loop back from `gate3-loopback`, `--phase enrich` takes up Step 8 at once: after the reads and the state, your next call is Step 8's delegation (its item 1) — even when you think nothing more can be answered. A `--phase` re-entry takes the mode from `get`, never from its arguments. Otherwise a system description starts a new model at Step 1; a model path or name, or none, resolves the model (Model Resolution Protocol) — with no model at all, this workflow creates one instead of suggesting a command: ask the operator to describe their system and start at Step 1. `--full-scan` runs a full discovery (Step 2) in place of the drift check, with or without a drift baseline; it is not `--full`. A new model is a quick model, as the phase files say, unless the run has `--full`. On an existing model, a run without a mode flag keeps the mode `get` shows; `--full` on a quick model deepens it (below), and on a full model resumes it; `--quick` marks it at entry ({{tool:model_state}} `action: 'mode'`, `mode: 'quick'`) — a `reviewed_model` refusal ends the run in one line.

**Resuming a model.** At REVIEWED with `reviewed_stale` false, say the workflow is complete and point to {{cmd:sync push}} (publish) and {{cmd:surface}} (attack surface); stop. Otherwise resume as Guided Workflow Orchestration says — `drift` is its Drift Orchestration Protocol, entered only when `get` shows a `baseline_commit` — with a check between the drift and the cursor, the crown jewels (below); a model still REVIEWED and not stale after it is complete: say so and stop. A run with `--full` on a model whose `get` shows `mode: 'quick'` deepens it: clear the mark first (`action: 'mode'`, `mode: 'full'`); after `resume-cursor`, when the step taken up is Step 7 or later, enter `classify` and run Step 6 items 1–5 and 7 — a `classify` answer at item 7 runs them again for those elements — then take up that step, entering its phase unless it is Step 7. The cursor is the first step not done: Steps 1–5 by the state they end in (the step map), Step 6 when Gate 3's C1 passes; Steps 7–9 are never skipped on their own. Step 7 is done when `get` shows a `quick_through`. A Gate 3 that is `NOT_COMPUTED` (a loop back is open) puts the cursor at Step 9. Before `resume-cursor`, show the progress table in your reply — the operator has no other view of where the model stands: `Progress: "<name>" (Quality: X/100)`, then a markdown table with one row per step — step, name, and `[done]`, `[auto-skip]` (Step 4, when its auto-skip holds), `[>>>>]` the cursor or `[    ]` not reached — with the active modules on Step 2.

### Crown jewels

Only at ENRICHING or REVIEWED (Step 6 onward; earlier, Step 6 maps them): when Gate 3 ({{tool:validate_model_json}} `action: 'gates'`) fails C6 — the scope names no crown jewels (a pulled model keeps none), a jewel is not mapped, or its elements no longer exist — confirm them again before anything else:

{{include shared/crown-jewels.md}}

Steps 6 and 7 run this mapping too.

{{include shared/model-resolution.md}}

{{include shared/guided-workflow.md}}

{{include shared/guided-resume.md}}

**Undo.** When the operator asks to undo or revert changes, read the file below and follow it; if it cannot be read, suggest no command:

{{include shared/git-undo.md as-file}}
