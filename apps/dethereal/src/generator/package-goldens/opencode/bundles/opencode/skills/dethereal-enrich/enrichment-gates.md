## Enrichment Questions

**Adversary-driven questions.** Echo the trust assumptions once. When `insider` is declared (never skipped):

`[prompt: admin-access-paths]` For each element: who can reach it administratively, and how (SSH, RDP, bastion, console, break-glass account)? Say "none" where there is no such path. — a plain message; end your turn; unanswered → ask again.

When `supply_chain` is declared (never skipped):

`[prompt: supply-chain]` Which CI/CD system builds and deploys this, with which credentials, and which registries does it use — and who can push to them? — a plain message; end your turn; unanswered → ask again.

**The question tables.** What the operator still has to answer is shown as tables, each under its heading, with its header written exactly as below; a table with no rows is left out. Each table has its own question (this skill's own questions). An open cell of the Credentials or Boundary enforcement table is asked there, never again as an Open fields row; so a batch's Open fields leave out the credential keys, `auth_failure_mode` and the boundary enforcement keys, which come after the data items. At most 15 subjects per table in one showing (Relay); the rest go on the next page.

**Open fields** — `| Q# | element | field | question | allowed values |`, the field by its exact template key: pre-filled proposals shown, the field's description behind `details Q#` (template and floor fields, monitoring, `asset_criticality`, compliance).

**Credentials** — `| F# | flow | credential | also reaches | on failure |`: a row for every cross-boundary flow, every flow recorded as a privilege transition, and every flow whose `dataItemIds` hold a credential item (`is_credential: true`, or a credential-like class) — a sibling flow to the same target is checked, never inferred from the others. Pre-filled cells are marked `(src)`, their source behind `details F#`, and a cell the agent wrote shows its `(R#)`; `on failure` is deny, fallback, fail_open or not sure. Flows with nothing known fold into one line that keeps their ids and names (Relay). At most 15 flows per showing: crown-jewel flows, flows Gate 3's C9 lists and fail-open pre-fills first.

**Credential mapping** — `| S# | credential | type | flows | stores that yield it | shared |`, a confirm table pivoted by credential, the stores taking `credential_scope` with `stores_credentials: true` — and every `credential_name` it writes: say which flows take the id itself as their label, and list the others.

**Boundary enforcement** — `| boundary | implicit_deny_enabled | allow_any_inbound | egress_filtering | basis |`: the enforcement table for the boundaries that lack it; boundaries with no evidence for any of the three fold into one line, `no evidence: <names>`, and stay empty unless the operator gives values.

A pre-fill the operator confirms is an answer, written with the rest; a cell left empty stays empty.

**The Credential mapping question.** The mapping follows the credential answers:

`[prompt: credential-mapping]` Apply this credential mapping? (apply / modify) — table first, the `question` tool, header `credential-mapping`; unanswered → ask again.

**Documentation claims.** Per document with claims, show its rows — element, field by its exact template key, value, line — then ask:

`[prompt: claim-confirm]` Does this document describe the deployed system? On yes, the values shown are written citing it; on no, they stay unknown. (yes / no / some rows) — table first, the `question` tool, header `claim-confirm`; unanswered → ask again.

On `yes`, write the rows with your edit tool, citing the document; on `some rows`, only the rows the operator names; on `no`, nothing.

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
