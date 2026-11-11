---
name: add
description: Add components, boundaries, data flows, or data items to a threat model
argument-hint: "[element description]"
---

Add elements to an existing Dethernety threat model, described in plain words. Arguments: {{args}}.

{{include shared/core-rules.md}}

**Reference.** Read these files next to this skill before any model file is written, and again after any compaction; if one cannot be read, write no model file and stop:

{{include shared/secret-files.md as-file}}

{{include shared/guidelines-core.md as-file}}

{{include shared/guidelines-schema.md as-file}}

{{include shared/guidelines-layout.md as-file}}

{{include shared/model-resolution.md}}

## Steps

1. **The model.** Resolve it (Model Resolution Protocol; none → suggest {{cmd:create}} and stop); read `structure.json`, `dataflows.json` and `data-items.json`; {{tool:model_state}} `get`.
2. **What to add**, from the arguments or the conversation: a component ("a Redis cache in the data tier"), a boundary ("a DMZ for internet-facing services"), a data flow ("a flow from API Server to Redis for session lookups") or a data item ("PII on the user registration flow"). When the element type, its place, or a flow's ends are unclear, ask:

   {{#ask id=add-element text}}What do you want to add, and where? Give the element type, its name, and its boundary — or, for a data flow, its source and target.{{/ask}}

3. **Its details:**
   - **component** — name; type (PROCESS, STORE or EXTERNAL_ENTITY); parent boundary, from the request or asked; a position relative to the parent (Layout); a proposed class from {{tool:match_classes}} when the platform answers — `classLabel: 'COMPONENT'` with `componentType` set to its type, never a class of another type — confirmed with the change; a new id (a UUID).
   - **boundary** — name and parent; a proposed class as for a component, with `classLabel: 'SECURITY_BOUNDARY'`; position and size to contain its children with at least 50px padding; `dimensionsMinWidth` and `dimensionsMinHeight` so it cannot collapse.
   - **data flow** — source and target matched by name, ignoring case; a proposed class with `classLabel: 'DATA_FLOW'`; source and target handles from the ends' relative position (Layout), never a handle pair already used between the same two components; description and protocol.
   - **data item** — name and description; a proposed class with `classLabel: 'DATA'`; the elements that handle it; a sensitivity only when the operator gives it.
4. **Show what will change** as a table — each element with its type, where it goes (boundary, position, or the flow's ends and handles) and its class — then ask:

   {{#ask id=add-confirm}}Add these elements as shown, or adjust specific rows? (add / adjust){{/ask}}

5. **Write only what was confirmed**: `structure.json` (components, boundaries), `dataflows.json`, `data-items.json` (and `dataItemIds` on the elements that handle a new data item). For a classified element, call {{tool:generate_attribute_stubs}} with `directory_path`.
6. **State.** At DISCOVERED or STRUCTURE_COMPLETE the state does not change. At ENRICHING or REVIEWED, apply the Backward Transition Protocol with the new element ids.
7. **Validate and footer.** Call {{tool:validate_model_json}}, then:

   ```
   [done] Added [<TYPE>] "<name>" to <boundary>. Quality: X/100.
   [next] When you're ready: {{cmd:add}} (continue adding) or {{cmd:discover}} (scan for more components)
   ```

{{include shared/backward-transition.md}}

**Undo.** When the operator asks to undo or revert changes, read the file below and follow it; if it cannot be read, suggest no command:

{{include shared/git-undo.md as-file}}
