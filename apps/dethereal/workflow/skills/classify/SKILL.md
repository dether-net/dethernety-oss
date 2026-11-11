---
name: classify
description: Assign classes to unclassified components, boundaries, data flows, and data items
argument-hint: "[--type components|flows|boundaries|data-items]"
---

Classify the elements of a Dethernety threat model with platform module classes. Arguments: {{args}}.

{{include shared/core-rules.md}}

**Procedure.** The Classification Protocol is in the file next to this skill: read it at the start, and again after any compaction; if it cannot be read, stop — never classify from memory. It runs here, in the main conversation: its proposals go to the operator directly, and nothing is written before their answer.

{{include shared/classification-protocol.md as-file}}

**Secret Files**, before any configuration is read:

{{include shared/secret-files.md as-file}}

{{include shared/model-resolution.md}}

{{include shared/model-file-writes.md}}

## Steps

1. **Prerequisites.** Resolve the model (Model Resolution Protocol; none → suggest {{cmd:create}} and stop); read `structure.json`, `dataflows.json`, `data-items.json` and `.dethereal/scope.json` (crown jewels, `activeModules`); {{tool:model_state}} `get`.
2. **Which elements.** `--type components`, `flows`, `boundaries` or `data-items` limits the run to that type; otherwise every unclassified element. List the elements without `classData` — components through the whole boundary hierarchy, boundaries, data flows, data items — as "N unclassified: X components, Y flows, Z boundaries, W data items". With none, say "All elements are classified. Quality: X/100." with `[next] When you're ready: {{cmd:enrich}}`, and stop.
3. **Pass 1 and Pass 2**, as the Classification Protocol says: one {{tool:match_classes}} call per class label and component type, cross-module tie-breaking by `activeModules` order, the IaC pre-classification check, `exact_name` accepted, the offline fallback, then boundary context, flows and peers for the rest — never an invented class id.
4. **Crown jewels.** Map the scope's crown jewels as Crown jewels (below) says, before anything is written. An unresolved crown jewel drops out of every priority set, so it is never skipped without the operator's decision: the table lists it, and it stays unmapped until its element is added.
5. **Confirm.** Show one table — element, type, proposed class, module, confidence, match, crown jewel — then ask:

   {{#ask id=classification-confirm}}Apply these classes, or modify rows? (yes / modify / skip){{/ask}}

6. **Modules** — the protocol's other-module list (Classes from inactive modules). Classifying again means Pass 1 and Pass 2 for those elements, with the new modules:

{{include shared/module-add.md}}

7. **Write** the confirmed classes to each element's home file, as the protocol's Classification Output says (`classData: null` to remove a pushed class), then {{tool:generate_attribute_stubs}} with `directory_path`.
8. **The gate** is Gate 3's C1, read from {{tool:validate_model_json}} `action: 'gates'`, `detail: 'summary'`, with C6 for the crown jewels. A `NOT_COMPUTED` Gate 3 is neither a pass nor a fail: say a loop back is open, and that Step 9 of {{cmd:threat-model}} ends it. If C1 fails, or data flows, boundaries or data items are still unclassified, show them by name, STOREs first, then ask:

   If C6 fails, map the crown jewels again (Crown jewels) before anything else — unless it fails only on jewels already shown as unmatched: then name them, point to {{cmd:add}}, and go on.

   {{#ask id=classification-gap}}Classify these elements now, or skip with the gap on record? (classify / skip){{/ask}}

   A module added after the elements were classified may have more specific classes: show those elements and their proposed classes, then ask:

   {{#ask id=reclassify-late-module}}Reclassify these elements with the new module's classes? (reclassify / skip){{/ask}}

9. **State.** Classification changes no workflow state.
10. **Validate and footer.** Call {{tool:validate_model_json}}, then:

    ```
    [done] Classified N of M elements (C1: <verdict>). Crown jewels mapped: Z. Quality: X/100.
    [next] When you're ready: {{cmd:enrich}} (populate security attributes) or {{cmd:classify}} --type flows (classify remaining types)
    ```

### Crown jewels

{{include shared/crown-jewels.md}}
