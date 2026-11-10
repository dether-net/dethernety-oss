---
name: orchestrate
description: Walk the two-step fixture workflow — survey through a specialist agent, then confirm with the operator.
argument-hint: "[subject]"
---

# Orchestrate

Subject: the text the operator supplied with the skill invocation, or the arguments a skill that handed over to this one named. Check the session first with `mcp__dethereal__auth_status`; carry on whatever it reports.

## Handoff Protocol

Agents cannot talk to the operator. Render what an agent returns — its table, list or marker line — in the conversation before the next question.

**The asking rule.** A line tagged `[prompt: <id>]` is a question: show what it refers to first, start the question with its tag, and write nothing it decides until the operator answers. **A dismissed question is not answered.** An empty or dismissed reply decides nothing; ask again.

Include marker: copper-lantern

## Step 1 — Survey

1. Use the `spawn_agent` tool with `agent_type: "dethereal-scout"`, `fork_turns: "none"` and this message: “Survey the fixture and reply with your marker line exactly as your instructions give it.” Then wait for its final answer with `wait_agent`, and once you have it close the agent with `close_agent` — a finished agent counts against the session's agent limit until it is closed; if you have no `close_agent` tool, go on, and if a later `spawn_agent` fails on the agent limit, stop and tell the operator. If the agent cannot be started, or it returns without doing the work, stop and tell the operator; do not do its work yourself.
2. Report the scout's marker line and the include marker from the steps above, per the Handoff Protocol.

## Step 2 — Confirm

Offer the two choices below as a numbered list.

`[prompt: survey-confirm]` Keep the survey as reported? (keep / redo) — table first, a numbered list; end your turn.

`[prompt: survey-notes]` Anything the survey missed? Say "none" to finish. — a plain message; end your turn.

When both answers are in, suggest `$dethereal:audit`, which runs the `dethereal-reviewer` agent. An example invocation: `$dethereal:audit ./model`.
