---
name: dethereal-audit
description: Audit the fixture model read-only and report the reviewer's findings.
---

Use the `task` tool with `subagent_type: "dethereal-reviewer"`, a 3–5 word `description`, and this prompt: “Read and follow the task file `task.md` in <this skill's base directory, shown when the skill was loaded>. The operator's text: <the arguments given with the command, verbatim, or "none">.” Wait for its result. Then show its final answer to the operator in full. If the agent cannot be started, or it returns without doing the work, stop and tell the operator; do not do its work yourself.
