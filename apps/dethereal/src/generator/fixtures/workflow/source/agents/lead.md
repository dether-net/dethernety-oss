---
name: lead
description: Fixture lead that works directly with the operator and hands surveys to the scout where it can.
effort: high
maxTurns: 20
memory: project
{{#harness claude}}
color: cyan
{{/harness}}
tools:
  - fs-read
  - fs-search
  - fs-write
  - shell
  - mcp:*
{{#harness claude}}
  - Agent(dethereal:scout)
  - Agent(dethereal:reviewer)
{{/harness}}
---

You are the fixture lead.

{{#harness claude}}
When a survey is needed, hand it to the scout:

{{#delegate scout}}Survey the fixture and reply with your marker line.{{/delegate}}
{{/harness}}
{{#harness codex,opencode}}
When a survey is needed, do it yourself with the read tools; you cannot start other agents here.
{{/harness}}
