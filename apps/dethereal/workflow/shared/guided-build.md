# Guided workflow — build (Steps 1–5)

The model is built on disk here and published only at Step 10. Create each file with one call of your file-write tool, and read or edit it with your file tools — no scaffolding scripts, no heredocs, no shell loops over files. Check progress and coverage with {{tool:validate_model_json}} (`action: 'quality'` with `detail: 'summary'`, `'coverage'`), never by sampling files.

Never call {{tool:get_model_schema}} or {{tool:get_example_models}}: the File Format and the Model Guidelines you read are the schema and the guidance.

{{include shared/model-file-reads.md}}

{{include shared/tool-loading.md}}

## Step 1: Scope Definition

{{include shared/scope-interview.md}}

Unless the run that started this model has `--full` — a `--phase` re-entry keeps that run's choice — that first transition marks the model in the same call: `mode: 'quick'` with it.

## Step 2: Discovery

{{#harness claude}}
**Group `discovery`** (Question groups). Ask `discovery-confirm`, `blind-spots` and `module-select` as one group: the discovery report, the blind-spot categories with their pre-fills and the module table (Module selection, items 1–4), in one message, then the dialog — `blind-spots` naming the list above in place of the confirmed one, so a change at `discovery-confirm` does not ask it again. Apply them in that order: the list's changes and the blind-spot additions, a `discovery-confirm` with changes asked again, alone, until it is confirmed; the Decomposition Protocol; then the modules (Module selection, item 5), with `module-select` asked again, alone, when an element added in any round maps to a module the answer did not include.

{{/harness}}
{{include shared/discovery-protocol.md}}

{{include shared/backward-transition.md}}

{{include shared/decomposition.md}}

If the model was described rather than built from code, discovery still scans the codebase for corroboration. With no codebase, the described structure is the proposal: write it to `discovery.json` as the protocol's step 6 says, confirm it with `discovery-confirm` and `blind-spots`, run the Decomposition Protocol on it, then write it and go to Step 3.

### Module selection

Choose the platform modules that provide classes for classification and enrichment:

1. Take `recommendedModules` and the source types from `.dethereal/discovery.json`.
2. List the installed modules: {{tool:get_classes}} with `view: 'modules'` — each module with its class counts per type.
3. Recommend the modules `recommendedModules` names — the scout mapped the source types to them — only where a source pattern the scout's module mapping lists for it was detected (a provider block, the provider's resource types, its manifests, SQL migrations), each with the resources behind it; a module reached only through a class-name hit goes under available, never recommended. `dethernety-general` is always included and cannot be removed.
4. Show the table — module, reason, include — with the available but not recommended modules below it, then ask:

   {{#ask id=module-select}}Use these modules for classification? (yes / modify){{/ask}}

   A reply that lists the modules to use is the selection: exactly those, with `dethernety-general`; one that adds or drops a module changes the recommended set by that module only. A later reply, at any question, that restricts the modules updates `activeModules` the same way, and every row whose class came from a dropped module is proposed again from the modules left.

5. Write the confirmed modules to the scope as `activeModules` (`[{ "id", "name" }]`), in the table's order with `dethernety-general` last. Then show, once, the module list the model will carry: `manifest_modules.derived` from {{tool:model_state}} `get` — the server keeps `manifest.json`'s `modules` from it; never write them yourself. When `get` has no `manifest_modules`, the manifest already holds that list: show `manifest.json`'s `modules` — the absence never means "no modules".

With no discovery (a described model), skip the recommendation: classification searches every installed module. The state stays DISCOVERED.

## Step 3: Model Review

{{#harness claude}}
**Group `review`** (Question groups), always one dialog. Before the review table is shown, run Step 4's hierarchy check (its items 1–2) and Step 5's item 1; never ask `model-review-confirm` before them, or alone while another member has rows. A member with no rows is left out of the dialog, never asked later on its own — except as the re-check after the class write below, and Step 5's, says. Question groups' size and dismissal rules still hold. Ask `model-review-confirm`, `boundary-hierarchy` — when Step 4's hierarchy check (its items 1–2) finds rows — and Step 5's `operational-flows` as one group: the review table, the boundary tree with its hierarchy rows, and Step 5's list (its item 1), in one message, then the dialog. Write the classes first (item 4), then run the hierarchy check again: rows that differ from the ones shown — a re-typed or removed element's included — are asked with `boundary-hierarchy` again, alone; otherwise apply its answer (Step 4, item 2). `boundary-trust` follows alone, as Step 4 says; the flows are written at Step 5 (its item 3).

{{/harness}}
1. Classify deterministically — components, boundaries **and data flows**, each with its own `classLabel`: {{tool:match_classes}} with the elements' names, types and descriptions, `moduleIds` from `activeModules` (all modules when it is absent), and components one call per type (`PROCESS`, `STORE`, `EXTERNAL_ENTITY`), each with `componentType` — never one mixed call: it is the only hard type filter. An `exact_name` match is accepted in the table; the others are listed to confirm. A row's confidence reads `exact name` only when {{tool:match_classes}} returned `exact_name` for it. An element in its `unmatched_type_only` is never given a type-match pick: list its `class_type` — or, with none, the call's `classLabel` type — by module with {{tool:get_classes}} (`module_name`, `fields: ['id', 'name']`, once for all such elements of that type), as its `hint` says — while a page is `truncated`, call again with its `next_offset` — and propose from what that finds, the scout's class, when it differs, beside it. Candidates at the same confidence from different modules — or a provider's class against the class of the engine it runs (a managed database service's class against the database's) — are told apart by how much of the element's attack surface each template covers: the provider's class wins only when its template also covers the engine's concerns (queries, roles, credentials, host access), not only the provider's control plane; otherwise the engine's class. When the template keys cannot be fetched, or do not settle it, propose the engine's class, with the provider's beside it for the operator. A full tie goes to the module listed earlier in `activeModules`. On a real tie — candidates from different modules at the same confidence, or a provider's class against its engine's — fetch each tied class's template keys, {{tool:get_classes}} with `class_id`, its `module_name` and `fields: ['id', 'name', 'template_keys']`, one class a call and once per class in a run (a third class only when it is in the tie too), and compare them; never for an `exact_name` pick with no rival, and never in a listing. If the call fails, fall back to {{tool:get_classes}} per module and per `class_type` with `fields: ['id', 'name', 'type', 'category', 'module']`, following `next_offset` until `truncated` is false (a changed `listing` starts it over), then to matching by name alone; otherwise classification lists classes only as this item says.
2. Match what is left by name, type and description against the active modules' classes. An element discovered from IaC keeps its IaC pre-classification only when that class's module is active — look it up with {{tool:get_classes}} (`class_id`, `fields: ['module']`); otherwise propose a class from the active modules, and name the dropped class and its module in the table's note, so the operator can add that module at classification. A class made for another element type (a PROCESS class on an EXTERNAL_ENTITY) is never kept: propose the best class of the element's own type in its place. A cloud provider's managed service — the provider operates it and the system only calls its API (key management, a secret manager, managed log groups, a managed certificate service) — is an `EXTERNAL_ENTITY` with the baseline module's External Cloud Service class, unless an active-module class made for that service fits: match it against that class's type too, and then that class and its type win. Its row proposes the type and the class together, never an unclassified internal store; Step 4's hierarchy check moves it to the provider's external boundary. A flow from it into the system that the service does not initiate is proposed reversed, as its own row. A store the system deploys and runs itself — Kubernetes Secrets in its own cluster, a vault on its own pods or VMs — stays internal; a provider's key vault is a managed service.
3. Show the table — element, type, boundary, proposed class, confidence, and a `partial fit: <what differs>` note where the class fits only in part — then ask:

   {{#ask id=model-review-confirm}}Confirm these classes, or modify rows? (yes / modify / skip){{/ask}}

4. Write the confirmed `classData` to `structure.json` (components, boundaries) and `dataflows.json` (flows) — for a re-type row also the element's `type`, for a reversed flow its `source` and `target` swapped — then {{tool:generate_attribute_stubs}} with `directory_path` for the classified elements. The writes go in one message (Model-file writes). An element the operator asks to leave unclassified is recorded in `.dethereal/discovery.json`'s `left_unclassified` as `{ "id": "<element id>", "words": "<the operator's words, verbatim>" }`, so Step 6 never proposes it again, in a later session too; and each class item 2 dropped, whatever the answer, in its `dropped_classes` as `{ "id": "<element id>", "class": "<class name>", "module": "<module id>" }`.
5. An element the operator asks to remove here is a handover: load {{skill:remove}} with the element and follow it to its footer — its `remove-confirm` asks again what the operator already asked for; then go on with this step.

The state stays DISCOVERED.

## Step 4: Boundary Refinement

Refine the boundary hierarchy first, then ratify the trust skeleton (zone and plane) and the enforcement posture of the hierarchy that results, in one batched question — never boundary by boundary.

1. Show the boundary hierarchy as a tree.
2. Check it: single-component boundaries (merge?), a flat hierarchy (sub-boundaries?), external entities inside internal boundaries (move to an external one — a cloud provider's managed service to the provider's boundary). Each finding becomes a row — never dropped because you judge the change unwise. Its Change column is the recommended action: a merge, a move or a new sub-boundary, with the elements it moves, why, and — for a merge — the zone the merged boundary keeps; or **keep as is**, with the alternative change and why you do not recommend it. `apply all` applies the recommended actions, so a keep row changes nothing; `adjust` takes a row's alternative. A `boundary_hierarchy_quality` below 1.0 always yields at least one row. With no finding, say so in one line. With findings, show them as a table, then ask:

   {{#ask id=boundary-hierarchy}}Apply these hierarchy changes, or adjust specific rows? (apply all / adjust){{/ask}}

   Write only the accepted changes to `structure.json`: item 3's call validates them.
3. Compute the skeleton on the hierarchy as it now stands: {{tool:validate_model_json}} `action: 'validate'`, `include: ['zoning']`, `assets: 'skeleton'` (core rule 6) — external and exposure tiers and the `INTERNAL` default only. RESTRICTED waits for Step 7; never propose it here.
4. Show two tables under one question, in the display names of the Model Guidelines, never raw enums:
   - **Trust classification** — boundary, zone, role (plane), resolved:
     - **Zone** — the scout's `suggestedZone` from `discovery.json`, with its `classificationConfidence` as `[hi]`, `[med]` or `[lo]` (blank without a topology signal; never the payload's own `confidence`). The skeleton payload is authoritative for the resolved column.
     - **A leaf of external entities.** A non-structural leaf with no `suggestedZone` whose directly held components are **all** `EXTERNAL_ENTITY` (their `type` in `structure.json`) gets a proposed zone: Open internet, or Trusted external only when the source or the operator names it a vetted partner — a cloud provider whose managed services the system consumes is one — marked `[lo]`. A leaf that mixes an untrusted actor with vetted partners is proposed as Open internet, with the note "mixes untrusted and partner entities: split it". Its reason ("holds only external entities: <names>") goes in a column headed `Note`, never in the Zone cell — an exception to the reason-on-adjust rule below. A leaf that also holds other components keeps its move finding (2) and gets no external zone.
     - **needs a zone** — the Zone cell of a leaf the payload reports as `resolvedSource: 'default'` with no proposal: never a blank.
     - **Resolved** — from the payload's `resolvedSource` / `resolvedFrom`, never by walking the tree: `⬆` declared and stricter than its parent (the one the operator must catch); a zone name, declared; `· inherited · <ancestor>`; `—` unclassified (counted at Step 9); `— structural` for a container of child boundaries, which proposes no zone and is not counted.
     - **Role (plane)** — `Workload` or `Management` from `suggestedPlane`; otherwise **Undecided**. A boundary with both carries ⚠.
     - Zones are proposed for leaf segments only: a container stays unzoned unless the operator declares one for inheritance. Boundaries model network containment; identity, compute node, location and business domain are `domains` or `planes` tags, not zone-bearing boundaries — a `domains` tag shared by an exposed and a protected segment surfaces at Step 9 as `cross-tier-domain`. Prefer a logical (Kubernetes-first) view of workloads.
     - A row the payload reports as `resolvedSource: 'declared'` is ratified: show it as declared and never propose over it, on a resume or after drift too. The one-line reason for a proposal ("public subnet, IGW → Internet-facing") appears only when the operator adjusts that row.
   - **Enforcement posture** — boundary, `implicit_deny_enabled` (blocks traffic by default), `allow_any_inbound` (allows unrestricted inbound), `egress_filtering` (`deny_all`, `allow_list`, `allow_all`): each proposed value with its source; one no source shows stays blank. A rule that opens one port to everyone is an allow rule, not the absence of a default deny: `implicit_deny_enabled: false` needs a source showing that traffic no rule names gets in.

   {{#ask id=boundary-trust}}Accept the trust classification and the Enforcement posture as proposed, or adjust specific rows? (accept all / adjust){{/ask}}

5. Only the accepted rows — proposed is not written: write the boundary's `zone`, `planes` and `domains` to `structure.json` and its enforcement attributes to its attribute file — a boundary with none gets `attributes/boundaries/<id>.json` holding only the confirmed keys — every edit of this answer in one message (Model-file writes). A boundary left unconfirmed gets no zone: it stays `—`, counted as unclassified at Step 9 unless it is a structural container.

**Auto-skip** only when the `boundary_hierarchy_quality` factor is 1.0 (depth ≥ 2, no single-child boundaries, no external entities in internal ones) **and** no zone proposal is pending **and** the skeleton reports no `unclassified` finding: say "Boundary hierarchy is well-structured (quality factor: 1.0), no zone proposals pending. Skipping refinement." and mark it `[auto-skip]`. A perfect hierarchy with proposals still shows the trust table.

Then {{tool:model_state}} `action: 'transition'`, `to: 'STRUCTURE_COMPLETE'`.

## Step 5: Data Flow Mapping

{{#harness claude}}
When Step 3's group `review` asked `operational-flows`, its answer is item 2's — once item 1 is run again on the model as it now is: a list that differs from the one shown is asked with `operational-flows` again, alone.

{{/harness}}
1. Review the flows from discovery and list the components without any flow, and every PROCESS with inbound flows and no outbound flow — with the call sites the scout reported for it. A flow a source shows — the scout's rows included — is proposed in that list with its evidence, never asked whether it exists; a path through a jump host or relay is one flow per hop, through that host. What the scope excludes is never a component or a flow: an excluded service's internals are attributes of the element that uses it — never the service itself, which stays a component.
2. Show them with the operational flows code analysis misses, then ask:

   {{#ask id=operational-flows text}}Which of these flows exist? Administrative access paths (SSH, RDP, consoles), monitoring and logging flows (to log aggregators, SIEM), backup and recovery flows, and privilege or auth transitions — a caller and callee at different authorization levels inside one zone. Also: what connects the components listed without a flow, and where do the listed processes send their calls? Say "none" for a category that does not apply.{{/ask}}

3. For each new flow, choose the source and target handles from the relative positions (Layout), avoid handle conflicts with existing flows, and set the description and protocol. Write the flows to `dataflows.json`: the next check validates them.
4. **A privilege or auth transition** the operator confirmed is a candidate sub-boundary, or a `Management` plane when the callee's segment really is management. Propose it as Step 4 does — `boundary-hierarchy`, the write, the skeleton again, `boundary-trust` for the new rows — before the approved channels; nothing moves before the answers. If the operator declines both, the transition stays a flow: record it in `.dethereal/discovery.json` as `privilege_transitions` (the flow id, the caller, the callee, the operator's answer verbatim), so the credential step asks about that flow and its callee even in a later session.
5. **Approved channels.** Call {{tool:validate_model_json}} `action: 'validate'`, `include: ['zoning']`, `assets: 'skeleton'` (core rule 6). Its `external-ingress` findings are the risk-bearing crossings: an external-tier boundary with a flow into a trusted tier and no approved channel, `boundaryId` the source and `peerId` the target — never re-walk the flow graph. Only these are asked: in-zone and child↔parent crossings are implied by inheritance and never surfaced. With none, skip this. For each, draft a justification from the crossing flow's description; skip a crossing whose source boundary already has a conduit to that peer (read its `conduits[]` first). Show the table — channel (source → peer, display names), draft justification — then ask:

   {{#ask id=approved-channels}}Ratify these crossings as approved channels — declared intent, not enforcement — or adjust specific rows? (ratify all / adjust){{/ask}}

   For each ratified row, append to the **source** boundary's `conduits[]` in `structure.json` one outbound conduit, `{ "peerId": "<target boundary id>", "direction": "OUTBOUND", "justification": "<non-empty>" }` — never an inbound mirror (the read path derives it; a lone inbound conduit is rejected), and never `controlRefs`. A crossing not ratified stays a plain flow and returns at Step 9 as an advisory `external-ingress` finding, as do crossings into asset-bearing boundaries, which cannot be classified before Step 7.
6. {{tool:model_state}} `action: 'transition'`, `to: 'ENRICHING'` (Steps 5–8 all run at ENRICHING), then one line: `Data flows mapped. Quality: X/100.` — no footer.

Then the session break below — a quick model goes on to Step 6, entering `classify` in the same turn, without it. If the operator continues, enter `classify` in the same turn; on `later`, show `To resume: {{cmd:threat-model}} <model-path>` and that progress is saved and the run resumes at Step 6, and stop.

{{include shared/guided-session-break.md}}

{{include shared/guidelines-layout.md}}
