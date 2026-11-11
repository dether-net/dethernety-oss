---
name: review
description: Review a threat model — gates, quality breakdown, gaps and readiness for analysis; read-only
argument-hint: "[directory-path] [--structure-only]"
---

Use the `spawn_agent` tool with `agent_type: "dethereal-model-reviewer"`, `fork_turns: "none"` and this message: “Read and follow the task file `task.md` at <the absolute path of the task.md next to this SKILL.md>. The operator's text: <the text the operator supplied with the skill invocation, verbatim, or "none">.” Then wait for its final answer with `wait_agent`, and once you have it close the agent with `close_agent` — a finished agent counts against the session's agent limit until it is closed; if you have no `close_agent` tool, go on, and if a later `spawn_agent` fails on the agent limit, stop and tell the operator. Then show its final answer to the operator in full. If the agent cannot be started, or it returns without doing the work, stop and tell the operator; do not do its work yourself.
