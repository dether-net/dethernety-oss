---
name: orchestrate
description: Walk the two-step fixture workflow — survey through a specialist agent, then confirm with the operator.
argument-hint: "[subject]"
---

# Orchestrate

Subject: $ARGUMENTS. Check the session first with `mcp__plugin_dethereal_dethereal__auth_status`; carry on whatever it reports.

## Handoff Protocol

Agents cannot talk to the operator. Render what an agent returns — its table, list or marker line — in the conversation before the next question.

**The asking rule.** A line tagged `[prompt: <id>]` is a question: show what it refers to first, start the question with its tag, and write nothing it decides until the operator answers. **A dismissed question is not answered.** An empty or dismissed reply decides nothing; ask again.

Include marker: copper-lantern

## Step 1 — Survey

1. Invoke the `Agent` tool with `subagent_type: "dethereal:scout"` and this prompt: “Survey the fixture and reply with your marker line exactly as your instructions give it.” Wait for its result. If the agent cannot be started, or it returns without doing the work, stop and tell the operator; do not do its work yourself.
2. Report the scout's marker line and the include marker from the steps above, per the Handoff Protocol.

## Step 2 — Confirm

The dialog keeps the answer structured; offer the two choices below.

`[prompt: survey-confirm]` Keep the survey as reported? (keep / redo) — table first, then AskUserQuestion, the tag first in its question text.

`[prompt: survey-notes]` Anything the survey missed? Say "none" to finish. — a plain message; end your turn.

When both answers are in, suggest `/dethereal:audit`, which runs the `dethereal:reviewer` agent. An example invocation: `/dethereal:audit ./model`.
