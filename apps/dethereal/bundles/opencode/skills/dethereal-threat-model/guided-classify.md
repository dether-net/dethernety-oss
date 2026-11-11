# Guided workflow — classify (Steps 6–7)

**Model files, once per step.** Read a model file once in a step and keep it: after your own write succeeds, the file holds what you wrote — do not read it again. Read it again only after a failed write or validate, a compaction or summary, or a write you did not make with your edit tool: an agent's (any model file) or a push (every model file). Nothing else rewrites a model file: `dethereal_validate_model_json` never does, and `dethereal_generate_attribute_stubs` writes only attribute files — read one again after it before you edit it. After any such write, read the file again before a whole-file write of it. The same holds for `.dethereal/discovery.json` and `.dethereal/scope.json`: never read a file to see what you wrote — your write is the file, and your edit tool edits it without a read first.

**Model-file writes, one message per answer.** Everything one operator answer changes in `structure.json`, `dataflows.json`, `data-items.json`, `.dethereal/discovery.json` and the attribute files (in the enrich skill, as Writing and validating says) goes in one message: every edit to every one of those files, as parallel calls; one edit per element is fine. A read those edits need goes in the message before. Validate in the message after, once every edit has succeeded. Never spread one answer's edits over two messages; only a failed edit is redone, after reading its file again. A whole-file write replaces a file's edits only when it is shorter.



## Step 6: Classification

1. List the unclassified elements — components, data flows, boundaries (never the root `defaultBoundary`), data items — leaving out those `.dethereal/discovery.json` lists as `left_unclassified` (the operator chose that at Step 3), and read `activeModules` from the scope. On a quick model, call `dethereal_validate_model_json` `action: 'quality'`, `detail: 'summary'`.
2. Delegate the second classification pass — also when item 1 lists nothing: the agent then checks the classes already set and maps the crown jewels — except on a quick model whose `attribute_residual.unclassified_open` is 0, and whose `.dethereal/discovery.json` lists no `dropped_classes` entry whose module is not in `activeModules`: it runs no pass; skip items 2–5.

   Use the `task` tool with `subagent_type: "dethereal-security-enricher"`, a 3–5 word `description`, and this prompt: “Classification mode. Model directory: `<model-path>`. Run the Classification Protocol on these unclassified elements: <the list from item 1, or none — then check the classes already set> — boundary context, connected flows, peer inference; proposals from the active modules only — and return its proposals: each element's class with its module and confidence, the mapping of the scope's crown jewels to elements, reclassification candidates — only where cited evidence contradicts the current class, otherwise none — and the classification checks; and, apart, its other-module list (Classes from inactive modules). Write nothing.” Wait for its result. If the agent cannot be started, or it returns without doing the work, stop and tell the operator; do not do its work yourself.

3. Show what it returned, whole (Relay) — it wrote nothing, so the model files you read stand — less any row for an element left unclassified at Step 3. When the pass proposes nothing — no class and no class change; an `exact_name` row is a proposal too — say so in one line and skip `classification-confirm`: there is nothing to confirm or write. The same holds for its second ask after a module is added. The other-module list, the crown jewels and the classification gate still follow. Otherwise ask:

   Show a class change — a classified element the agent proposes to reclassify — as its own row, with its current and proposed class. A `yes` covers only the rows shown; never a change that was not a row. It never adds a module: the other-module list is shown apart, and is not a row.

   `[prompt: classification-confirm]` Confirm these classes, or modify rows? (yes / modify / skip) — table first, the `question` tool, header `classification-confirm`; unanswered → ask again.

4. **Modules.** When the other-module list is not empty:

When a match comes from a module that is not active, the class is never a row of the confirm table: show the elements and the modules that would classify them as a table — element, current class (if any), module, class — then ask:

`[prompt: classify-add-module]` Add these modules to the active modules and classify the elements with them? (add / skip) — table first, the `question` tool, header `classify-add-module`; unanswered → ask again.

On `add`, look up each module's id with `dethereal_get_classes` (`view: 'modules'`, `module_name`), then update `activeModules` in the scope and classify those elements again: the modules are written, as `{id, name}`, before anything is classified. The new proposals — a class, or a change from the current class — go through the confirm question the elements came from, for those rows only; the rows confirmed before are kept. On `skip`, the elements keep their classes or stay unclassified, the gap on record. The question is asked once per run: an element still unclassified after `add` goes to the gap question. Only this answer adds a module; with no `activeModules` in the scope, every installed module is already active and the question never arises.

   Here, classifying those elements again is one more delegation, for them only, once `activeModules` is written; then ask `classification-confirm` again for the returned rows only:

   Use the `task` tool with `subagent_type: "dethereal-security-enricher"`, a 3–5 word `description`, and this prompt: “Classification mode. Model directory: `<model-path>`. The modules <names> were just added to `activeModules`. Run the Classification Protocol on these elements: <elements>, and its Late Module Addition check on the elements already classified; return the proposals — each element's class with its module and confidence, and each class change with the current and proposed class. Write nothing.” Wait for its result. If the agent cannot be started, or it returns without doing the work, stop and tell the operator; do not do its work yourself.

5. Write the confirmed `classData` to each element's home file, for the rows confirmed at both asks — `structure.json` (components, boundaries), `dataflows.json`, `data-items.json`, the writes in one message (Model-file writes) — then `dethereal_generate_attribute_stubs` with `directory_path`. A confirmed re-type row also writes the element's `type` and its move into the provider's boundary — created when needed with `zone: VENDOR`, the confirmed row ratifying it; a confirmed flow reversal swaps `source` and `target`.
6. **Crown jewels**, once the classification answers are written, or none was asked. With the agent's mapping, or your own when no pass ran, as the proposal, confirm them as the skill's Crown jewels section says. An unresolved crown jewel is a blocking question, not a note: unmapped, it fails Gate 3 (C6) and drops out of every priority set downstream.
7. **The classification gate** is Gate 3's C1 — every non-external component classified — read from `dethereal_validate_model_json` `action: 'validate'`, `include: ['gates']`, `detail: 'summary'` (core rule 6), never counted by you. A `NOT_COMPUTED` Gate 3 is neither a pass nor a fail: a loop back is open and its criteria are unknown — classify every new or changed element (the stale list) and go on; Gate 3 is read again at Step 9, where the loop ends. If it fails, or data flows or boundaries other than the root are still unclassified (advisory), show them by name, STOREs first, with any module that would classify them — an element left unclassified at Step 3 is named in one line as the operator's choice, never asked again — then, when an element other than those is listed, ask:

   `[prompt: classification-gap]` Classify these elements now, or skip with the gap on record? (classify / skip) — table first, the `question` tool, header `classification-gap`; unanswered → ask again.

   `classify` runs this step again for them.

The state does not change.

## Step 7: Data Item Classification

Model each sensitive data type once, and link it to every element that handles it across its lifecycle: where it originates (an external entity or process), the flows that carry it, the components that process or store it, and the boundaries that contain it — `dataItemIds` is valid on components, data flows and boundaries.

**Data items.** The boundary-crossing flows without a data item, and the sensitive data types found:

`[prompt: data-item-handlers]` What data crosses each of these flows? Which elements originate, carry, process, store or contain each data type (PII, credentials, financial, health, session, or none)? Say "not sure" where you do not know. — a plain message; end your turn; unanswered → ask again.

**Before the table.** Classify the proposed items — in the guided workflow as Step 7 says, in the enrich skill as the Enrichment Protocol's DATA class step says. Then run the four advisory lifecycle checks on the classified proposal — every crown-jewel store has classified data items; every origin, every process that reads, transforms or caches a sensitive item, and the boundary containing a crown-jewel item reference it — and add what they find to it, as items or links marked as gap fills; a gap-fill item is classified like the rest.

**C4 before the table.** The proposal also covers Gate 3's C4 before it is shown: each flow in C4's failing list (`dethereal_validate_model_json` `action: 'gates'`) whose data a source shows gets a gap-fill link to a proposed item, or a gap-fill item of its own; a flow nothing shows stays a gap, never a guessed item. With Gate 3 `NOT_COMPUTED`, skip this. `data-item-gap` is then left with only what the confirmed write leaves failing (item 6 of Step 7, or the enrich skill's backstops).

The proposed data items, matched to their DATA classes, as one confirm table — sensitivity, regulatory flags, handling elements, an origin column, the DATA class (exact or near; `none suitable (N listed)` when the full list has none) and a credential column:
- **Origin:** where the source of the content is known, ask for `origin` — who can write it, one of the File Format's seven tokens, the least-trusted source winning; leave it absent when unknown.
- **Credential:** binding a data item to a credential-like DATA class (e.g. User Credentials, Authentication Tokens) makes it a credential candidate — propose `is_credential: true` for it, never set it from the class alone; an answered `false` stays.
- **Sensitivity:** propose it at no less than its floor, the higher of its flags' and its class's. Flags: PCI cardholder or PHI → restricted; PII, GDPR personal, SOX financial or CCPA personal → confidential. Class: a whole word in the class's catalog name, whatever the name means — credentials, tokens, secrets, passwords, private keys, signing keys, encryption keys, API keys, sessions, cookies, JWTs, payments, cards, cardholders, health, medical or PHI → restricted; personal, customer or PII → confidential.

`[prompt: data-items-confirm]` Confirm these data items, their handling elements, their DATA class, their origin column and their credential column, or adjust specific rows? (accept all / adjust) — table first, the `question` tool, header `data-items-confirm`; unanswered → ask again.

An adjust that adds or renames an item, or changes its class, classifies those rows again (Before the table, the module question included where the skill asks it), recomputes their floor and credential column, and shows them again with `data-items-confirm` before anything is written.

Write only what was confirmed — the items in `data-items.json` with their `classData`, and the `dataItemIds` of their handling elements, with your edit tool: all of this answer's changes to `data-items.json`, `structure.json` and `dataflows.json` in one message (Model-file writes), each item with its `sensitivity` and `regulatory_flags`, its `origin` where one was confirmed, and `is_credential` on the rows the operator confirmed in the credential column. An item confirmed as `none suitable` stays unclassified. A credential candidate left unanswered stays in `dethereal_validate_model_json` `action: 'quality'`'s `credential_hints` (`detail: 'summary'` keeps them) until `is_credential` is answered.

If C4 still fails after that write, or a lifecycle check finds a gap that was not offered as a gap-fill row (a display table, Relay): C4's failing flows first, by name, at most 10 then `+N more`; then one line per advisory check with its count and up to three names:

`[prompt: data-item-gap]` Classify the missing data items now, or skip with the gap on record? (classify / skip) — table first, the `question` tool, header `data-item-gap`; unanswered → ask again.

`skip` leaves C4 failing; it is not a waiver — waivers are offered only at Gate 3 (Step 9).

`classify` proposes a class for **every** item listed, never only enough to pass the gate, as rows of a new `data-items-confirm` table.

If C7 fails — a data item's sensitivity below the floor its data class or a regulatory flag sets: an adjusted row, or an item written before — show those items: item, sensitivity, floor, and what sets the floor:

`[prompt: sensitivity-floor]` Raise these data items to their floor sensitivity? A floor set by a data class or a regulatory flag cannot be waived: kept below it, Gate 3 keeps failing and the model cannot be recorded as REVIEWED. (raise / keep) — table first, the `question` tool, header `sensitivity-floor`; unanswered → ask again.

On `raise`, write the floor sensitivity to `data-items.json` for the items the operator confirmed.

When the validator suggests other spellings for regulatory flags (advisory; nothing is blocked), show them: item, the flag as written, the suggested spelling:

`[prompt: flag-spelling]` Replace these regulatory flags with the suggested spellings, or keep them as written? Nothing is blocked either way. (replace / keep) — table first, the `question` tool, header `flag-spelling`; unanswered → ask again.

On `replace`, write the new spellings to `data-items.json`; on `keep`, never change them.

1. Find the elements that handle sensitive data without a classified data item — origins, cross-boundary flows, processing and storing components, containing boundaries — and ask `data-item-handlers`. The credential that authenticates a flow (a password, an SSH key, a token) is a data item on that flow too.
2. Propose each data item and its handling elements: map the scope's `compliance_drivers` to regulatory flags with exactly these labels — card data → `PCI cardholder`; health data → `PHI`; personal data → `PII`, plus `GDPR personal` when GDPR is a driver — never the driver's own name (`PCI-DSS`, `GDPR`), and set `sensitivity` on the four-level scale — `restricted`, `confidential`, `internal`, `public` — at no less than its flags' floor (PCI cardholder data or PHI → restricted; PII or GDPR personal data → confidential). Regulatory labels go in `regulatory_flags`, never in `sensitivity`. Where the source of the content is known, ask for `origin` — who can write it, most to least trusted: `authenticated_first_party` | `curated_internal` | `agent_relayed` | `model_generated` | `third_party` | `arbitrary_public` | `not_assessed` (the last three are untrusted; one public source makes the item `arbitrary_public`). Leave it absent when unknown.
3. Classify the proposed items before showing them, in this order, then run the lifecycle checks (Data items, Before the table), and raise each item's sensitivity to its class's floor (Data items) where that is higher:
   1. `dethereal_match_classes` with `elements: [{name, description}]`, `classLabel: 'DATA'`, the active `moduleIds`, `topN: 3`. Accept an `exact_name` match.
   2. For the items left, list the active modules' DATA classes with `dethereal_get_classes` (`class_type: 'DATA'`, `fields: ['id', 'name', 'description']`, following `next_offset` until `truncated` is false (a changed `listing` starts it over)) and check each against the item — the top three matches are not the catalog, and the count you report comes from that listing, never from memory.
   3. For the items still without a suitable class, when `activeModules` is set: `dethereal_match_classes` with the same `elements`, `classLabel: 'DATA'`, `topN: 3`, without `moduleIds`; for each candidate, its module is the candidate's `moduleName`, or the reply's `module` when all candidates share one. A class found only this way is never a row of the confirm table: ask the module question, as Step 6's Modules step says; on `add`, match those items again with the new `moduleIds`.
4. Show the proposals as a confirm table — one row per data item: sensitivity, regulatory flags and **every** handling element, grouped by role (origin, transit, use, rest, scope; never `+N more` — these links are written); why each element handles it behind `details`; the item's `origin`, or blank when unknown; its DATA class, exact or near — or `none suitable (N listed)` — the other candidates and their scores behind `details`; and the credential column, proposing `is_credential: true` for every item whose class, near or exact, is credential-like — and ask `data-items-confirm`.
5. Write the confirmed items to `data-items.json` and link each through `dataItemIds` on every handling element, with their confirmed `classData` and the values Data items says, then `dethereal_generate_attribute_stubs`, so their attribute files exist before Step 8. After that, `dethereal_validate_model_json` `action: 'quality'`, `detail: 'summary'`, lists in `credential_hints` any item still unanswered (an item bound to a credential-like DATA class with `is_credential` unanswered); it waits for Step 8's credential flag. An answered `false` stays — never set either field silently. An item confirmed as `none suitable` stays unclassified; say so.
6. Check the data items: Gate 3's C4, read from `dethereal_validate_model_json` `action: 'validate'`, `include: ['gates', 'zoning']`, `assets: 'full'` (core rule 6) — its zoning serves item 8 — and the four lifecycle checks again. If C4 still fails, or a check finds a gap that was not offered as a gap-fill row, list the gaps by element and ask `data-item-gap`. With Gate 3 `NOT_COMPUTED`, C4 is unknown, neither a pass nor a fail: run the four checks, and C4 is read again at Step 9.
7. **Crown jewels again.** Only when a `crown_jewels` entry still has no element in the scope's `crown_jewel_elements` and an element classified at Steps 6–7 matches it: run the mapping again (Crown jewels), its table holding only those jewels. With every crown jewel mapped, it is not asked again.
8. **Restricted promotion** completes the trust skeleton deferred at Step 4, now that the flows and the data sensitivity exist. Read the zoning from item 6's call; only when items 6–7 wrote since, call `dethereal_validate_model_json` `action: 'validate'`, `include: ['zoning']`, `assets: 'full'` again (core rule 6). Offer a row only when all three hold: `proposedTier` is `RESTRICTED`, `resolvedZone` is not `RESTRICTED`, and `declaredZone` is `null` or `INTERNAL` — never a boundary declared Public, Exposed, Vendor or Untrusted. Show it as completion, not reversal, in a confirm table: the boundaries, their zone now → Restricted, and why in a few words (e.g. "card data, app-tier ingress only"); a tighten-only change, never loosening or overwriting a declared zone. Name, in one line, the boundaries holding assets that cannot be Restricted yet (reachable from a DMZ, or vendor-touched): they stay Internal and are flagged at Step 9. Then ask:

   `[prompt: restricted-promotion]` Promote these boundaries to Restricted, or adjust specific rows? (promote all / adjust) — table first, the `question` tool, header `restricted-promotion`; unanswered → ask again.

   Write `zone: RESTRICTED` to `structure.json`, in one message, only for the rows confirmed now. A boundary the operator declared Internal is offered, never overwritten unasked.

On a quick model (`get` shows `mode: 'quick'`), record the step: `dethereal_model_state` `action: 'transition'`, `to: 'ENRICHING'`, `quick_through: 7` — a transition to the state it holds records the step alone. The state does not change. Then enter `enrich` in the same turn, with no footer.
