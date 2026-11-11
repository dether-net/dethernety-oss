---
name: discover
description: Auto-discover infrastructure components from codebase using the infrastructure-scout agent
argument-hint: "[model path] [--scan <directory or file>]"
---

Scan the codebase for infrastructure components, trust boundaries and data flows, and add what the operator confirms to a threat model. Arguments: {{args}} — a model path, or none (Model Resolution Protocol), and `--scan <directory or file>` to scan only that; a directory without `--scan` is the model's.

{{include shared/core-rules.md}}

**Reference.** Read these files next to this skill before any model file is written, and again after any compaction; if one cannot be read, write no model file and stop. Secret Files before any configuration is read:

{{include shared/secret-files.md as-file}}

{{include shared/guidelines-core.md as-file}}

{{include shared/guidelines-schema.md as-file}}

{{include shared/guidelines-layout.md as-file}}

**Decomposition.** The Decomposition Protocol, which the discovery protocol runs on the confirmed proposal, is in the file next to this skill: read it with the others.

{{include shared/decomposition.md as-file}}

**Delegation** — what the scout is given and what it returns — is in the file next to this skill too: read it with the others.

{{include shared/delegation.md as-file}}

{{include shared/model-resolution.md}}

{{include shared/model-file-writes.md}}

## Steps

1. **Prerequisites.** Resolve the model (Model Resolution Protocol; none → suggest {{cmd:create}} and stop); read `.dethereal/scope.json` if it exists; {{tool:model_state}} `get`.
2. **Discovery.** Run the Discovery Orchestration Protocol: the cache (a decomposition plan's filter, never a replacement for the scan), the scout, the report, `discovery-confirm`, `blind-spots`, the Decomposition Protocol, the writes (coordinates from the Layout guidelines), the state and the drift baseline. Nothing reaches the model files before the operator's answers.
3. **Validate and footer.**

   ```
   [done] Discovery complete. N components, M boundaries, K data flows confirmed. Quality: X/100.
   [next] When you're ready: {{cmd:add}} (refine the structure) or {{cmd:classify}} (assign classes)
   ```


{{include shared/relay.md}}

**The Discovery Orchestration Protocol** is in the file below. Read it before step 2, and again after any compaction; if it cannot be read, stop — never discover from memory:

{{include shared/discovery-protocol.md as-file}}
