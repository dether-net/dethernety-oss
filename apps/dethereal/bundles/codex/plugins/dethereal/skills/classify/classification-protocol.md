## Classification Protocol

Two-pass classification for assigning platform module classes to model elements. It produces **proposals**: the class of an element, a crown-jewel mapping and a reclassification are written only after the operator confirms them in the main conversation. The specialist agent never writes `classData` or `crownJewel` itself.

### Pass 1 — Deterministic Classification

1. Read `activeModules` from `.dethereal/scope.json`
2. Extract `moduleIds` from `activeModules` (order matters — see tiebreaking). If `activeModules` is absent, omit `moduleIds` from `mcp__dethereal__match_classes` calls (backward compatibility — searches all installed modules)
3. Group the unclassified elements by class label — components `COMPONENT`, boundaries `SECURITY_BOUNDARY`, flows `DATA_FLOW`, data items `DATA` — and the components again by type (`PROCESS`, `STORE`, `EXTERNAL_ENTITY`). For each group, call `mcp__dethereal__match_classes` with `elements: [{name, type?, description?}, ...]`, `classLabel: <label>`, `moduleIds: [...]`, `topN: 3`, `fields: ['description', 'category', 'type']`, and for components `componentType: <type>`, one call per type: it is the only hard type filter (a `type` on an element only ranks), and a class assigned across types evaluates a policy written for another kind of thing
4. Cross-module tiebreaking: Candidates at the same confidence from different modules — or a provider's class against the class of the engine it runs (a managed database service's class against the database's) — are told apart by how much of the element's attack surface each template covers: the provider's class wins only when its template also covers the engine's concerns (queries, roles, credentials, host access), not only the provider's control plane; otherwise the engine's class. When the template keys cannot be fetched, or do not settle it, propose the engine's class, with the provider's beside it for the operator. A full tie goes to the module listed earlier in `activeModules`. On a real tie — candidates from different modules at the same confidence, or a provider's class against its engine's — fetch each tied class's template keys, `mcp__dethereal__get_classes` with `class_id`, its `module_name` and `fields: ['id', 'name', 'template_keys']`, one class a call and once per class in a run (a third class only when it is in the tie too), and compare them; never for an `exact_name` pick with no rival, and never in a listing.
5. For IaC-discovered elements, check `discovery.json` — if pre-classification matches a `mcp__dethereal__match_classes` candidate, boost confidence to `high (IaC)`; if they differ, show both in the proposal table for the operator to choose — when the pre-classification's module is active; otherwise it goes on the other-module list (Classes from inactive modules)
6. Mark `exact_name` matches (high confidence) as accepted in the proposal table; list `fuzzy_name`/`vector_similarity` matches for the operator to confirm; a type match never comes back in `matches`. An element `mcp__dethereal__match_classes` lists in `unmatched_type_only` — every candidate it had was a type match, so it has none — is never given a type-match pick: list its `class_type` — or, with none, the call's `classLabel` type — by module with `mcp__dethereal__get_classes` (`module_name`, `fields: ['id', 'name']`, once for all such elements of that type), as its `hint` says; while a page is `truncated`, call again with its `next_offset`, and choose only from the pages fetched. A class that fits an element only in part is proposed only when no class of the element's type in the active modules, the baseline's included, fits it whole, and its row carries `partial fit: <what differs>`. The operator's confirmation of the table applies both

**Offline fallback chain:**
1. Call `mcp__dethereal__match_classes` as above
2. If the result contains `{ success: false }` or an error → fall back to `mcp__dethereal__get_classes` per module and per `class_type` (with `fields: ['id', 'name', 'description']`, following `next_offset` until `truncated` is false (a changed `listing` starts it over))
3. If that listing also errors → skip Pass 1, all classification in Pass 2
4. Warning: "Platform connectivity issues — classification running in LLM-only mode."

### Pass 2 — LLM-Assisted Classification

For remaining unclassified elements:
1. Use boundary context (which boundary contains the element, what flows connect to it)
2. Consider connected flows and peer components for contextual inference
3. Use the closest available class from active modules — never fabricate class IDs
4. A cloud provider's managed service — the provider operates it and the system only calls its API (key management, a secret manager, managed log groups, a managed certificate service) — that no active-module class made for that service fits is the baseline module's External Cloud Service, an `EXTERNAL_ENTITY`: propose one re-type row — type and class together (current → proposed), with its move to the provider's external boundary when it sits in an internal one (a new boundary, zoned Trusted external, when none exists) — never leave it an unclassified internal store. Still run step 5 for it, so an inactive module's class for that service goes on the other-module list. A flow from it into the system that the service does not initiate is proposed reversed, as its own row. A store the system deploys and runs itself — Kubernetes Secrets in its own cluster, a vault on its own pods or VMs — stays internal; a provider's key vault is a managed service
5. If no suitable class exists in active modules, broaden the search: call `mcp__dethereal__match_classes` with the unclassified elements and `classLabel`, `topN: 3`, without `moduleIds`. For each candidate, its module is the candidate's `moduleName`, or the reply's `module` when all candidates share one. If a match is found in an inactive module, it goes on the other-module list (below), never in the proposal table
6. If still no match, leave unclassified and note the gap — for a component, boundary or flow. A data item takes the closest data class by what the data is about — data describing a person (payment and account data included) the personal-data class, a secret the credentials or token class, signing material and configuration the configuration class, commands an operator issues the user-input class — noting a partial fit; it stays unclassified only when every class would misstate it, and never a secret as personal data

### Classes from inactive modules

A class from a module that is not in `activeModules` is never a proposal row — not an IaC pre-classification, a broadening match or a reclassification candidate. Return each apart, on the other-module list: element, current class (if any), module, class. An element already classified whose `discovery.json` pre-classification belongs to an inactive module (look it up with `mcp__dethereal__get_classes`, `class_id`, `fields: ['module']`) is on the list too, with its current class. The main conversation turns the list into its module question; only the operator's `add` makes a module active. With `activeModules` absent, every installed module is active and the list stays empty.

### Late Module Addition

When a module is added to `activeModules` after initial classification:
- Do NOT auto-reclassify existing elements
- Flag elements whose baseline-module class has a more specific equivalent in the newly added module
- Propose them as a table: "Module 'Kubernetes' added. 3 elements may benefit from reclassification: [list]." The operator decides, through the main conversation's `reclassify-late-module` question; a confirmed reclassification goes through `mcp__dethereal__generate_attribute_stubs` (unenriched fields from the old class removed, new class fields added)

### Crown Jewel Mapping

During classification, match the free-text crown jewels of `.dethereal/scope.json` to model elements, as a proposal:
1. Fuzzy-match `crown_jewels[]` entries from scope against component names; on no match, also against data-item names (crown jewels are often data — a data item stands for the components that store or process it through `dataItemIds`)
2. Present each match for confirmation: "You declared 'Payment Database' as a crown jewel. Matching element: 'payment-db' [STORE]."
3. Once the operator confirms, the main conversation writes `crownJewel: true` on the matched components in `structure.json` — the **single source of truth** read by the tiers, the surface report and the control-pass sweep (a snake_case `crown_jewel` in a component's attribute file is a derived/legacy copy only) — **and** the scope map `crown_jewel_elements` in `.dethereal/scope.json`: each `crown_jewels` entry, verbatim, mapped to the confirmed element ids. A data-item match maps to the data item's own id; the server derives the elements that bear it — and the proposal also names the stores that hold that data item, so the operator can confirm them as crown jewels too.
4. An unresolved crown-jewel declaration is a blocking confirmation, not an advisory: unmatched, it fails Gate 3 (C6) and the crown jewel is missing from every priority set downstream. The confirmed mapping as a whole must name at least one non-external component, and every component it maps gets `crownJewel: true`.
5. The guided workflow offers the mapping again at the close of its Step 7, since the elements classified there may be the crown jewels.

Full `asset_criticality` enrichment happens later, during enrichment.

### Classification checks

The gate is Gate 3's C1 — every non-external component is classified. Read its failing list from the gates output, never count it yourself, and list the failures STOREs first: STOREs drive data sensitivity analysis. A `NOT_COMPUTED` Gate 3 is neither a pass nor a fail: a loop back is open and its criteria are unknown — classify every new or changed element, and say that Step 9 of `$dethereal:threat-model` ends the loop. Unclassified data flows, boundaries and data items are an advisory list by name, not a gate.

If C1 fails or the advisory list is not empty, the main conversation shows the elements and asks its `classification-gap` question: classify them now, or leave them with the gap on record.

If unclassified elements exist and `activeModules` is set, check if broadening would help: call `mcp__dethereal__match_classes` with the unclassified elements, `classLabel`, `topN: 3`, without `moduleIds`. For each candidate, its module is the candidate's `moduleName`, or the reply's `module` when all candidates share one: that is the module to suggest adding. These candidates go on the other-module list, never in the proposal table.

### Classification Output

Once the operator has confirmed, the main conversation:
- Updates `classData` on elements in their home files — `structure.json` (components/boundaries), `dataflows.json` (data flows), `data-items.json` (data items). To remove a wrong or out-of-scope class from an element already pushed, it sets `classData: null` — an absent key leaves the platform binding in place; the next push unassigns the class, and the platform drops its generated exposures, keeping authored ones
- Calls `mcp__dethereal__generate_attribute_stubs` with the model's `directory_path` to write class template attribute stubs for all newly classified elements. The tool scans `structure.json`, `dataflows.json` and `data-items.json`, deduplicates classes, fetches templates, and merges template fields into existing attribute files (existing values preserved)
- Writes the confirmed crown-jewel mapping (`crownJewel: true` and `crown_jewel_elements`)
- For a confirmed re-type row, writes the element's `type` in `structure.json` and its move into the provider's boundary — created when needed with `zone: VENDOR`, the confirmed row being the operator's ratification; a confirmed flow reversal swaps `source` and `target` in `dataflows.json`

Classification does not change the workflow state.
