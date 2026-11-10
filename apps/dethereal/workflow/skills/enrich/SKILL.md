---
name: enrich
description: Populate security attributes, credentials, data items, and monitoring tools
argument-hint: "[all|priority|pick] [--focus credentials|monitoring|compliance|controls] [--pick <element-id>]"
---

Enrich a Dethernety threat model with security attributes, credential topology, compliance-driven data classification, and monitoring tool coverage.

{{include shared/core-rules.md}}

{{include shared/enrichment-invariants.md}}

**Secret files.** Read their full list next to this skill before any configuration, and again after any compaction; if it cannot be read, read no configuration and stop:

{{include shared/secret-files.md as-file}}

## How this skill runs

The enrichment protocol runs here, in the main conversation: ask the operator directly, and write a batch only after they confirm it. The delegation rule does not apply.

**Arguments:** {{args}} — scope (`all`, `priority` or its alias `tier1`, `pick`, `--pick <element-id>`) and focus (the protocol's Worklist and order).

**`--focus controls`** runs the control pass, a separate skill: load {{skill:enrich-controls}} with the same arguments, follow it, and do nothing else here; if it cannot be loaded, stop and tell the operator.

**Otherwise,** read the procedure next to this skill, again after any compaction; if it cannot be read, stop and tell the operator — never enrich from memory:

{{include shared/enrichment-protocol.md as-file}}

{{include shared/model-resolution.md}}

{{include shared/model-file-writes.md}}

## Steps

1. **Prerequisites.** Resolve the model path (Model Resolution Protocol; none → suggest {{cmd:create}} and stop); read the model and the scope; {{tool:model_state}} `get`.
2. **Worklist:** the snapshot, shown; `enrich-scope` unless the arguments set it (`enrich-pick` on `pick`).
3. **Adversary-driven questions**, when their class is declared.
4. **Per batch:** discover; `claim-confirm` once per document with claims; the Open fields table and `enrich-questions`; the divergence table, red flags and proposed values; `enrich-attributes`; write what was confirmed to the attribute files (Writing and validating); validate.
5. **Data items:** `data-item-handlers`; classify the proposed items and run the lifecycle checks (Before the table); `data-items-confirm`; create with their `classData`, stub, fill, link; then, as backstops, `sensitivity-floor`, `flag-spelling` and `data-item-gap`.
6. **Credentials**, after the data items so that a flow carrying a credential item has its row: the Credentials table, `credential-flows`; the Credential mapping, `credential-mapping`.
7. **Boundaries:** the Boundary enforcement table, `boundary-enforcement`.
8. **State**, as the protocol's last section says.
9. **Validate and footer.** Call {{tool:validate_model_json}}, then again with `action: 'gates'`, `detail: 'summary'` (data items change C4 and C7), then:

   ```
   [done] Enriched N elements (M attributes, K credentials mapped, J data items classified). Quality: X/100. State: <display_state>.
         Template coverage: A of B classified elements complete, C partial, D not started; E unclassified (skipped).
         Open: F fields left empty for the operator; G proposed defaults not written.
         Gate 3: <verdict> (failing: <criteria>).
         (Gate 3 NOT_COMPUTED: "Gate 3: not computed — a loop back is open (N untouched); Step 9 of the guided workflow ends it.")
   [next] When you're ready: {{cmd:review}} (gate verdicts) or {{cmd:enrich}} --focus credentials (continue a part)
   ```

**The Enrichment Questions** — every question above, with the tables it shows first — are in the file below. Read it before the first question, and again after any compaction; if it cannot be read, stop:

{{include shared/enrichment-gates.md as-file}}

This skill's own questions — the scope, each table's question and the confirm of inline values — are in the file below; read it with them:

{{include shared/enrich-skill-asks.md as-file}}

**Relay** — the table kinds, folding, `details` and the stable row ids those questions use — is in the file below. Read it with the Enrichment Questions:

{{include shared/relay.md as-file}}
