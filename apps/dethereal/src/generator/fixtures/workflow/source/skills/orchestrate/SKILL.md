---
name: orchestrate
description: Walk the two-step fixture workflow — survey through a specialist agent, then confirm with the operator.
argument-hint: "[subject]"
---

# Orchestrate

Subject: {{args}}. Check the session first with {{tool:auth_status}}; carry on whatever it reports.

{{include shared/protocols.md}}

## Step 1 — Survey

1. {{#delegate scout}}Survey the fixture and reply with your marker line exactly as your instructions give it.{{/delegate}}
2. Report the scout's marker line and the include marker from the steps above, per the Handoff Protocol.

## Step 2 — Confirm

{{#harness claude}}
The dialog keeps the answer structured; offer the two choices below.
{{/harness}}
{{#harness codex,opencode}}
Offer the two choices below as a numbered list.
{{/harness}}

{{#ask id=survey-confirm}}Keep the survey as reported? (keep / redo){{/ask}}

{{#ask id=survey-notes text}}Anything the survey missed? Say "none" to finish.{{/ask}}

When both answers are in, suggest {{cmd:audit}}, which runs the {{agent:reviewer}} agent. An example invocation: `{{cmd:audit}} ./model`.
