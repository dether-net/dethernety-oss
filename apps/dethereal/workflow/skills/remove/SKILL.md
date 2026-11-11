---
name: remove
description: Remove elements from a threat model with dependency checking
argument-hint: "[element reference]"
---

Remove elements from a Dethernety threat model, with its dependencies checked first. Arguments: {{args}}.

{{include shared/core-rules.md}}

**Secret Files** (the core rules point to them) — read the file below before any configuration is read; if it cannot be read, stop:

{{include shared/secret-files.md as-file}}

{{include shared/model-resolution.md}}

## Steps

1. **The model.** Resolve it (Model Resolution Protocol; none → suggest {{cmd:create}} and stop); read `structure.json`, `dataflows.json` and `data-items.json`; {{tool:model_state}} `get`.
2. **The element**, from the arguments or the conversation, matched by name (ignoring case) or id. With several matches, show them as a numbered list — type, name, boundary — then ask:

   {{#ask id=remove-select text}}Which one do you want to remove? Give its number.{{/ask}}

3. **Crown jewel first.** An element is a crown jewel when its id is mapped in the scope's `crown_jewel_elements` (a mapped data item included), when it is the only store holding a mapped data item, when it is a component with `crownJewel: true` in `structure.json`, or another element with `crown_jewel: true` in its attribute file (top level or under `attributes`). For one, say that removing it means the analysis no longer treats it as a security-critical asset, then ask:

   {{#ask id=remove-crown-jewel}}"<name>" is tagged as a CROWN JEWEL. Remove it only if the asset has genuinely been retired or relocated, not because it became inconvenient to model. Proceed? (yes / no){{/ask}}

   On `no` — or a reply that picks no choice — stop: remove nothing, show no dependencies. On `yes`, go on — the dependency check still applies.
4. **Dependencies:**
   - **component** — the data flows it starts or ends, `attributes/components/<id>.json`;
   - **boundary** — its child components and sub-boundaries, the data flows that cross it;
   - **data flow** — `attributes/dataFlows/<id>.json`;
   - **data item** — `attributes/dataItems/<id>.json`, and every `dataItemIds` that lists it.

   A data item is modelled once and shared: it is a dependent to remove only when no remaining element lists it in `dataItemIds`. A dependent that is a crown jewel (step 3's test) is asked about as step 3 says, before the confirmation below; `no` stops the whole removal.
5. **Confirm.** With dependencies, show them as a table — what is removed with the element, what is left orphaned, which attribute files are deleted with it (after the operator approves the deletion) — then ask:

   {{#ask id=remove-confirm}}Remove the element and everything listed, keep everything, or (for a component) remove only the component and leave its flows flagged for review? (yes / no / component only){{/ask}}

   On `component only`, list its flows: they now miss an endpoint and fail validation until they are reconnected ({{cmd:add}}) or removed.

   With none:

   {{#ask id=remove-simple}}Remove [<TYPE>] "<name>" from <boundary>? (yes / no){{/ask}}

   Nothing is written before the reply. `no` removes nothing, and so does a reply that picks none of the choices — "no more information, continue" included: say that nothing was removed.
6. **Remove** what was confirmed from its file — `structure.json`, `dataflows.json`, `data-items.json`. A removed data item's id leaves every `dataItemIds`; a removed element's id leaves the scope's `crown_jewel_elements`, and a crown jewel left with no element must be mapped again (the classify skill, or the guided workflow). A removed boundary's child components move to its parent boundary, never deleted with it.
7. **Prune** the removed elements' attribute files — you never delete a file yourself: call {{tool:model_state_prune}} with `directory_path` and `files` = those files (`attributes/<group>/<id>.json`, at most 50 a call) — the files the operator confirmed in the table above; that table is the display. Then:
   - `deleted`, with `remaining` — the next page is `next_files`. When every file in it was in the confirmed table, call again with exactly `next_files`; otherwise show `next_files` and `not_deleted` as a table and ask `prune-confirm` below. (A result without `next_files`: a call with the files you expect is refused with `files_differ`, which lists the page.)
   - `files_differ` — the server's orphaned set is not the one named (older orphans, or files it will not delete). Show `orphaned_files` and `not_deleted` (with each reason) as a table, then ask:

     {{#ask id=prune-confirm}}Delete exactly these orphaned attribute files? The files listed as not deleted stay: remove or fix them by hand in your own terminal. (delete / keep){{/ask}}

     On `delete`, call again with `orphaned_files`; on `keep`, or a reply that picks neither, delete nothing — Gate 2 names them. With no `orphaned_files` (none, or an empty list), there is nothing to delete: show `not_deleted`, ask nothing and call nothing again.
   - `attribute_issues` — its `files` cannot be read as element attributes (a flat or broken file): nothing was deleted. Name them; the operator fixes them, or removes them by hand in their own terminal, before a prune.
   - Any other refusal — show its message and code; delete nothing another way.

   A file listed under `not_deleted` is the operator's to handle by hand; Gate 2 names any left behind.
8. **State.** At ENRICHING or REVIEWED, apply the Backward Transition Protocol: `add` the ids of the elements that were changed and still exist (reconnected flows, moved components); removed ids come back as `rejected_ids`, which is expected.
9. **Validate and footer.** Call {{tool:validate_model_json}}, then:

   ```
   [done] Removed [<TYPE>] "<name>" and N dependent elements. Quality: X/100.
   [next] When you're ready: {{cmd:view}} (review the updated model) or {{cmd:add}} (add replacements)
   ```

{{include shared/backward-transition.md}}

**Undo.** When the operator asks to undo or revert changes, read the file below and follow it; if it cannot be read, suggest no command:

{{include shared/git-undo.md as-file}}
