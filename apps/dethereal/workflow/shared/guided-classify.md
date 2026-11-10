# Guided workflow — classify (Steps 6–7)

{{include shared/model-file-reads.md}}

{{include shared/tool-loading.md}}

## Step 6: Classification

1. List the unclassified elements — components, data flows, boundaries (never the root `defaultBoundary`), data items — leaving out those `.dethereal/discovery.json` lists as `left_unclassified` (the operator chose that at Step 3), and read `activeModules` from the scope. On a quick model, call {{tool:validate_model_json}} `action: 'quality'`, `detail: 'summary'`.
2. Delegate the second classification pass — also when item 1 lists nothing: the agent then checks the classes already set and maps the crown jewels — except on a quick model whose `attribute_residual.unclassified_open` is 0, and whose `.dethereal/discovery.json` lists no `dropped_classes` entry whose module is not in `activeModules`: it runs no pass; skip items 2–5.

   {{#delegate security-enricher}}Classification mode. Model directory: `<model-path>`. Run the Classification Protocol on these unclassified elements: <the list from item 1, or none — then check the classes already set> — boundary context, connected flows, peer inference; proposals from the active modules only — and return its proposals: each element's class with its module and confidence, the mapping of the scope's crown jewels to elements, reclassification candidates — only where cited evidence contradicts the current class, otherwise none — and the classification checks; and, apart, its other-module list (Classes from inactive modules). Write nothing.{{/delegate}}

3. Show what it returned, whole (Relay) — it wrote nothing, so the model files you read stand — less any row for an element left unclassified at Step 3. When the pass proposes nothing — no class and no class change; an `exact_name` row is a proposal too — say so in one line and skip `classification-confirm`: there is nothing to confirm or write. The same holds for its second ask after a module is added. The other-module list, the crown jewels and the classification gate still follow. Otherwise ask:

   Show a class change — a classified element the agent proposes to reclassify — as its own row, with its current and proposed class. A `yes` covers only the rows shown; never a change that was not a row. It never adds a module: the other-module list is shown apart, and is not a row.

   {{#ask id=classification-confirm}}Confirm these classes, or modify rows? (yes / modify / skip){{/ask}}

4. **Modules.** When the other-module list is not empty:

{{include shared/module-add.md}}

   Here, classifying those elements again is one more delegation, for them only, once `activeModules` is written; then ask `classification-confirm` again for the returned rows only:

   {{#delegate security-enricher}}Classification mode. Model directory: `<model-path>`. The modules <names> were just added to `activeModules`. Run the Classification Protocol on these elements: <elements>, and its Late Module Addition check on the elements already classified; return the proposals — each element's class with its module and confidence, and each class change with the current and proposed class. Write nothing.{{/delegate}}

5. Write the confirmed `classData` to each element's home file, for the rows confirmed at both asks — `structure.json` (components, boundaries), `dataflows.json`, `data-items.json`, the writes in one message (Model-file writes) — then {{tool:generate_attribute_stubs}} with `directory_path`. A confirmed re-type row also writes the element's `type` and its move into the provider's boundary — created when needed with `zone: VENDOR`, the confirmed row ratifying it; a confirmed flow reversal swaps `source` and `target`.
6. **Crown jewels**, once the classification answers are written, or none was asked. With the agent's mapping, or your own when no pass ran, as the proposal, confirm them as the skill's Crown jewels section says. An unresolved crown jewel is a blocking question, not a note: unmapped, it fails Gate 3 (C6) and drops out of every priority set downstream.
7. **The classification gate** is Gate 3's C1 — every non-external component classified — read from {{tool:validate_model_json}} `action: 'validate'`, `include: ['gates']`, `detail: 'summary'` (core rule 6), never counted by you. A `NOT_COMPUTED` Gate 3 is neither a pass nor a fail: a loop back is open and its criteria are unknown — classify every new or changed element (the stale list) and go on; Gate 3 is read again at Step 9, where the loop ends. If it fails, or data flows or boundaries other than the root are still unclassified (advisory), show them by name, STOREs first, with any module that would classify them — an element left unclassified at Step 3 is named in one line as the operator's choice, never asked again — then, when an element other than those is listed, ask:

   {{#ask id=classification-gap}}Classify these elements now, or skip with the gap on record? (classify / skip){{/ask}}

   `classify` runs this step again for them.

The state does not change.

## Step 7: Data Item Classification

{{#harness claude}}
**Group `data-items`** (Question groups), asking only the members that have rows. First, build the proposal before any question — items 2–3 from the source, Before the table and C4 before the table — then show the flows the handlers question names and the confirm table in one message, and ask `data-item-handlers` and `data-items-confirm` as one dialog. In it, `none` to `data-item-handlers` means nothing to add to the proposal. An answer to `data-item-handlers` that adds or changes data items has those rows classified again and `data-items-confirm` asked again, alone, before anything is written (Phase tail). When item 6 asks `data-item-gap`, first propose the gap-fill items from the active modules (items 2–3, for them; a module question waits for `classify`), then ask `data-item-gap` and their `data-items-confirm` as one dialog: the gaps and the proposals' confirm table, in one message. `skip` voids the confirm; `classify` writes what it confirms (item 5) — and a class the module question then changes is shown and confirmed again, with `data-items-confirm` alone, before it is written.

{{/harness}}
Model each sensitive data type once, and link it to every element that handles it across its lifecycle: where it originates (an external entity or process), the flows that carry it, the components that process or store it, and the boundaries that contain it — `dataItemIds` is valid on components, data flows and boundaries.

{{include shared/data-item-gates.md}}

1. Find the elements that handle sensitive data without a classified data item — origins, cross-boundary flows, processing and storing components, containing boundaries — and ask `data-item-handlers`. The credential that authenticates a flow (a password, an SSH key, a token) is a data item on that flow too.
2. Propose each data item and its handling elements: map the scope's `compliance_drivers` to regulatory flags with exactly these labels — card data → `PCI cardholder`; health data → `PHI`; personal data → `PII`, plus `GDPR personal` when GDPR is a driver — never the driver's own name (`PCI-DSS`, `GDPR`), and set `sensitivity` on the four-level scale — `restricted`, `confidential`, `internal`, `public` — at no less than its flags' floor (PCI cardholder data or PHI → restricted; PII or GDPR personal data → confidential). Regulatory labels go in `regulatory_flags`, never in `sensitivity`. Where the source of the content is known, ask for `origin` — who can write it, most to least trusted: `authenticated_first_party` | `curated_internal` | `agent_relayed` | `model_generated` | `third_party` | `arbitrary_public` | `not_assessed` (the last three are untrusted; one public source makes the item `arbitrary_public`). Leave it absent when unknown.
3. Classify the proposed items before showing them, in this order, then run the lifecycle checks (Data items, Before the table), and raise each item's sensitivity to its class's floor (Data items) where that is higher:
   1. {{tool:match_classes}} with `elements: [{name, description}]`, `classLabel: 'DATA'`, the active `moduleIds`, `topN: 3`. Accept an `exact_name` match.
   2. For the items left, list the active modules' DATA classes with {{tool:get_classes}} (`class_type: 'DATA'`, `fields: ['id', 'name', 'description']`, following `next_offset` until `truncated` is false (a changed `listing` starts it over)) and check each against the item — the top three matches are not the catalog, and the count you report comes from that listing, never from memory.
   3. For the items still without a suitable class, when `activeModules` is set: {{tool:match_classes}} with the same `elements`, `classLabel: 'DATA'`, `topN: 3`, without `moduleIds`; for each candidate, its module is the candidate's `moduleName`, or the reply's `module` when all candidates share one. A class found only this way is never a row of the confirm table: ask the module question, as Step 6's Modules step says; on `add`, match those items again with the new `moduleIds`.
4. Show the proposals as a confirm table — one row per data item: sensitivity, regulatory flags and **every** handling element, grouped by role (origin, transit, use, rest, scope; never `+N more` — these links are written); why each element handles it behind `details`; the item's `origin`, or blank when unknown; its DATA class, exact or near — or `none suitable (N listed)` — the other candidates and their scores behind `details`; and the credential column, proposing `is_credential: true` for every item whose class, near or exact, is credential-like — and ask `data-items-confirm`.
5. Write the confirmed items to `data-items.json` and link each through `dataItemIds` on every handling element, with their confirmed `classData` and the values Data items says, then {{tool:generate_attribute_stubs}}, so their attribute files exist before Step 8. After that, {{tool:validate_model_json}} `action: 'quality'`, `detail: 'summary'`, lists in `credential_hints` any item still unanswered (an item bound to a credential-like DATA class with `is_credential` unanswered); it waits for Step 8's credential flag. An answered `false` stays — never set either field silently. An item confirmed as `none suitable` stays unclassified; say so.
6. Check the data items: Gate 3's C4, read from {{tool:validate_model_json}} `action: 'validate'`, `include: ['gates', 'zoning']`, `assets: 'full'` (core rule 6) — its zoning serves item 8 — and the four lifecycle checks again. If C4 still fails, or a check finds a gap that was not offered as a gap-fill row, list the gaps by element and ask `data-item-gap`. With Gate 3 `NOT_COMPUTED`, C4 is unknown, neither a pass nor a fail: run the four checks, and C4 is read again at Step 9.
7. **Crown jewels again.** Only when a `crown_jewels` entry still has no element in the scope's `crown_jewel_elements` and an element classified at Steps 6–7 matches it: run the mapping again (Crown jewels), its table holding only those jewels. With every crown jewel mapped, it is not asked again.
8. **Restricted promotion** completes the trust skeleton deferred at Step 4, now that the flows and the data sensitivity exist. Read the zoning from item 6's call; only when items 6–7 wrote since, call {{tool:validate_model_json}} `action: 'validate'`, `include: ['zoning']`, `assets: 'full'` again (core rule 6). Offer a row only when all three hold: `proposedTier` is `RESTRICTED`, `resolvedZone` is not `RESTRICTED`, and `declaredZone` is `null` or `INTERNAL` — never a boundary declared Public, Exposed, Vendor or Untrusted. Show it as completion, not reversal, in a confirm table: the boundaries, their zone now → Restricted, and why in a few words (e.g. "card data, app-tier ingress only"); a tighten-only change, never loosening or overwriting a declared zone. Name, in one line, the boundaries holding assets that cannot be Restricted yet (reachable from a DMZ, or vendor-touched): they stay Internal and are flagged at Step 9. Then ask:

   {{#ask id=restricted-promotion}}Promote these boundaries to Restricted, or adjust specific rows? (promote all / adjust){{/ask}}

   Write `zone: RESTRICTED` to `structure.json`, in one message, only for the rows confirmed now. A boundary the operator declared Internal is offered, never overwritten unasked.

On a quick model (`get` shows `mode: 'quick'`), record the step: {{tool:model_state}} `action: 'transition'`, `to: 'ENRICHING'`, `quick_through: 7` — a transition to the state it holds records the step alone. The state does not change. Then enter `enrich` in the same turn, with no footer.
