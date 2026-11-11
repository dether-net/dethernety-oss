# Guided workflow — build (Steps 1–5)

The model is built on disk here and published only at Step 10. Create each file with one call of your file-write tool, and read or edit it with your file tools — no scaffolding scripts, no heredocs, no shell loops over files. Check progress and coverage with `mcp__plugin_dethereal_dethereal__validate_model_json` (`action: 'quality'` with `detail: 'summary'`, `'coverage'`), never by sampling files.

Never call `mcp__plugin_dethereal_dethereal__get_model_schema` or `mcp__plugin_dethereal_dethereal__get_example_models`: the File Format and the Model Guidelines you read are the schema and the guidance.

**Model files, once per step.** Read a model file once in a step and keep it: after your own write succeeds, the file holds what you wrote — do not read it again. Read it again only after a failed write or validate, a compaction or summary, or a write you did not make with your edit tool: an agent's (any model file) or a push (every model file). Nothing else rewrites a model file: `mcp__plugin_dethereal_dethereal__validate_model_json` never does, and `mcp__plugin_dethereal_dethereal__generate_attribute_stubs` writes only attribute files — read one again after it before you edit it. After any such write, read the file again before a whole-file write of it. The same holds for `.dethereal/discovery.json` and `.dethereal/scope.json`: never read a file to see what you wrote — your write is the file, and your edit tool edits it without a read first.

**Model-file writes, one message per answer.** Everything one operator answer changes in `structure.json`, `dataflows.json`, `data-items.json`, `.dethereal/discovery.json` and the attribute files (in the enrich skill, as Writing and validating says) goes in one message: every edit to every one of those files, as parallel calls; one edit per element is fine. A read those edits need goes in the message before. Validate in the message after, once every edit has succeeded. Never spread one answer's edits over two messages; only a failed edit is redone, after reading its file again. A whole-file write replaces a file's edits only when it is shorter.

**Tools, once per phase.** Dethereal's tools load on demand. At this phase's entry, load every tool this file names that is not loaded yet with one `ToolSearch` call — `select:` and all their names, comma-separated — never one call per tool, and never a call for a tool already loaded.

## Step 1: Scope Definition

Collect the scope in conversation, not as a form; take what the operator already said and ask only for the rest:

| Field | Required | Default | Guidance |
|-------|----------|---------|----------|
| `system_name` | yes | — | From the description, or ask |
| `description` | yes | — | 1–2 sentence architecture summary |
| `depth` | no | `architecture` | architecture, design, implementation |
| `modeling_intent` | no | `initial` | initial, security_review, compliance, incident_response |
| `compliance_drivers` | no | `[]` | Any compliance requirements? |
| `crown_jewels` | yes (≥ 1) | — | The most valuable assets |
| `exclusions` | no | `[]` | Anything explicitly out of scope. An exclusion removes what a provider runs inside a service, never the service the system uses: a managed database, cluster or queue the system stores in or runs on stays a component, in scope; only its provider-side internals are out of scope. When an exclusion could mean either, keep the service and say so. |
| `trust_assumptions` | no | `[]` | What is explicitly trusted |
| `adversary_classes` | no | — | Asked for every intent; the enrichment questions depend on them. Write the ids `external`, `insider`, `supply_chain`, and others as the operator names them |

`[prompt: scope]` To scope the model: the system's name and a one-line description, if you have not given them. What are the most valuable assets in this system (crown jewels)? What do you explicitly trust? Which adversary classes should it consider (external, insider, supply_chain, others)? Anything out of scope? Any compliance requirements, and the depth and intent if not the defaults? — a plain message; end your turn.

Then scaffold the model at `./threat-models/<kebab-case-name>/` unless the operator named a path:

| File | Content |
|------|---------|
| `manifest.json` (first: the state is kept only inside a model directory) | `{ schemaVersion, format: "split", model: { id: null, name, description, defaultBoundaryId }, files: { structure, dataFlows, dataItems, attributes }, modules: [] }` per the File Format — `modules` stays `[]`: the server fills it from the active modules and the classes used (in memory for the gates; a push writes it), so never write or ask for module references |
| `structure.json` | the default boundary, no children yet |
| `dataflows.json` | `[]` |
| `data-items.json` | `[]` |
| `.dethereal/scope.json` | the scope from this step |

Then `mcp__plugin_dethereal_dethereal__model_state` `get` and `action: 'transition'`, `to: 'SCOPE_DEFINED'`: this first transition also registers the model in `.dethernety/models.json`. Never write the registry by hand; when the result says `registered: false`, show its warning and go on. Never call `mcp__plugin_dethereal_dethereal__create_threat_model` here: publishing needs the platform and happens when the model is pushed.

Unless the run that started this model has `--full` — a `--phase` re-entry keeps that run's choice — that first transition marks the model in the same call: `mode: 'quick'` with it.

## Step 2: Discovery

**Group `discovery`** (Question groups). Ask `discovery-confirm`, `blind-spots` and `module-select` as one group: the discovery report, the blind-spot categories with their pre-fills and the module table (Module selection, items 1–4), in one message, then the dialog — `blind-spots` naming the list above in place of the confirmed one, so a change at `discovery-confirm` does not ask it again. Apply them in that order: the list's changes and the blind-spot additions, a `discovery-confirm` with changes asked again, alone, until it is confirmed; the Decomposition Protocol; then the modules (Module selection, item 5), with `module-select` asked again, alone, when an element added in any round maps to a module the answer did not include.

## Discovery Orchestration Protocol

When running discovery (`/dethereal:discover` or Step 2 of the guided workflow):

1. Resolve model path using the Model Resolution Protocol
2. Read `.dethereal/scope.json` if it exists — pass scope context to the scout
3. Check for discovery cache at `.dethernety/discovery-cache.json`:
   - If a cache exists and a decomposition plan is active, the scan's results are filtered by the cache's `assignedTo` map: show "N components pre-filtered for other models." The cache never replaces the scan below — only the scout reports secret files, modules and the sources checked
4. Delegate scanning — the scout is read-only, all file writes happen here, not in the scout:

   Invoke the `Agent` tool with `subagent_type: "dethereal:infrastructure-scout"` and this prompt: “Scan <the directory or file the operator named, else the whole codebase> for infrastructure components, trust boundaries and data flows for the model at `<model-path>`. Scope summary: <system name, description, crown jewels, exclusions>. Return the full discovery report with the sources-checked summary, the discovered elements in the discovery output schema, `recommendedModules`, and `unreadSecretFiles` — every secret file you found and never opened. List names first; open only paths you have classified with Secret Files.” Wait for its result. If the agent cannot be started, or it returns without doing the work, stop and tell the operator; do not do its work yourself.

5. Receive the discovery report (sources checked, element counts, confidence distribution, the tables and the elements). The scout has pre-classified from its IaC mapping — do not map again — but check each suggested class by its id with `mcp__plugin_dethereal_dethereal__get_classes` (`class_id`) — a class that no longer exists is dropped from the proposal, never replaced by another, and at discovery a class that exists is never swapped for another module's: show any other candidate beside it (at classification, Step 3 item 2 governs) — and mark the ones it could not pre-classify for the operator's review in the confirmation table.
6. **Persist the proposal as provenance, not as a decision.** Scan every returned description, and every `unreadSecretFiles` `secretNames` and `referencedBy` entry, for credential material and redact it (see Relay). Write the elements, with `confirmed: false` on each, `recommendedModules` and `unreadSecretFiles` to `<model-path>/.dethereal/discovery.json`, in its envelope: `version: 1`, `timestamp`, `sourcesChecked` (per source category), `blindSpotsAsked`, `userAddedElements`, `elements` — keeping every key an earlier run wrote outside it (`left_unclassified`, `dropped_classes`, `shared_credentials`, `privilege_transitions`). Each `unreadSecretFiles` entry is `{ file, class, tracked, referencedBy, secretNames? }` as the scout returned it — `tracked` is true when git tracks the file, never under another key name. Nothing goes into the model files before the operator answers: no element in `structure.json` or `dataflows.json`, and no zone (RESTRICTED included), plane, conduit, class or `crownJewel` field. Until then the proposal lives only in the `.dethereal/` sidecar.
7. Render the discovery report as markdown — sources-checked summary, components, suggested boundaries with proposed zones, inferred flows, and the unread secret files (a file git tracks is a finding in its own right: credentials in source control) — then ask:

   `[prompt: discovery-confirm]` I found N components, M boundaries, and K data flows. Review the table above:
      - Are any components missing? (shared infrastructure, third-party services, admin tools)
      - Should any be removed? (false positives, out-of-scope)
      - Are the suggested types and classes correct?

      Respond with changes or "looks good" to confirm. — the table, then the question with its choices numbered, in one message; end your turn.

   Apply the operator's changes to the proposal in `discovery.json` — all of one reply in one message (Model-file writes): an element the operator removes leaves `elements`, one they add enters with `sources: [{ type: 'manual' }]`, `existenceConfidence: 'high'` and `confirmed: true`, and is listed in `userAddedElements` — then re-render the changed table and ask again until they confirm.
8. After the component list is confirmed, run the blind-spot interview as one consolidated question. Pre-fill item 5 with the actors the source shows behind each remote-access entry point (SSH or RDP reachable from outside, a bastion, a runbook's on-call or admin role), cited. Pre-fill item 6 with the shared-credential candidates the unread secret files show without being read — an `env_file:` target used by two or more services, a Secret referenced by two or more workloads — and list any Secret manifest that nothing in the repository references, asking which component uses it:

   Show the categories code analysis misses, each with its pre-fills, then ask:

   1. **Shared infrastructure** — Identity provider (IdP), DNS, certificate authority (CA), log aggregator, SIEM, secret manager
   2. **Side-channel data flows** — Logging pipelines, metrics collection, DNS resolution, backup/replication, health checks
   3. **Deployment pipeline** — CI/CD platform, container registries, artifact stores, deployment agents
   4. **Third-party SaaS** — OAuth providers, payment processors, CDN, email/SMS services, webhook consumers
   5. **Human actors with privileged access** — System admins, database admins, on-call engineers, third-party support
   6. **Shared credentials** — Service accounts used by multiple components, shared API keys, database credentials reused across services, shared secrets

   `[prompt: blind-spots]` Discovery found [the confirmed list]. Code analysis systematically misses certain elements — Shared infrastructure, Side-channel data flows, Deployment pipeline, Third-party SaaS, Human actors with privileged access, Shared credentials: the list above. Are any of these relevant to your system? List anything else I missed, or say "none" to continue. — a plain message; end your turn.

   Add each element the operator names to the proposal with `sources: [{ type: 'manual' }]`, `existenceConfidence: 'high'` and `confirmed: true`, and list it in `userAddedElements`; set `blindSpotsAsked: true` — all of this answer in one message to `discovery.json` (Model-file writes). Backup destinations and CI/CD registries or artifact stores enter as **components** (STORE or EXTERNAL_ENTITY), never as bare flows: a backup holds the same crown-jewel data at rest, often with weaker controls, and needs its own data-item links (those of the store it copies) and enrichment. Shared-credential answers are not elements: record them in `discovery.json` as `shared_credentials` (the credential name, the elements the operator named, the answer verbatim), so enrichment's credential capture starts from them even in a later session.
9. Run the Decomposition Protocol on the confirmed proposal in `discovery.json`. If the operator narrows the scope or decomposes, the next step writes only the elements they confirmed at `decomposition-scope`: the chosen subsystem, or this model's share of the plan.
10. After the operator's confirmation, write the confirmed elements to the model files below and mark them `confirmed: true` in `discovery.json`, all in one message (Model-file writes). When every element is confirmed, the marking is one edit that sets each `"confirmed": false` to `true` (every occurrence at once); otherwise one write of the whole file, each confirmed element marked, the removed ones gone and the added ones present with `confirmed: true`. When no question separates step 7's or step 8's change from this one, it joins this message: on the every-occurrence branch as its own edit, sent first, its old text never holding a `"confirmed"` flag; on the whole-file branch inside that one write, with no separate edit. The model files:
   - `structure.json` (components + boundaries with coordinates; a proposed zone or plane stays in `discovery.json` as `suggestedZone` / `suggestedPlane` until the operator ratifies it — guided Step 4 — never in `structure.json`'s `zone` or `planes`: proposed is not set)
   - `dataflows.json` (confirmed flows)
11. Write `.dethernety/discovery-cache.json` after the first discovery in the project, and update it in a multi-model project
12. Call `mcp__plugin_dethereal_dethereal__validate_model_json` to check structural validity
13. Record the state with `mcp__plugin_dethereal_dethereal__model_state` (`action: 'get'` first), one step forward at a time:
    - at SCOPE_DEFINED: `action: 'transition'`, `to: 'DISCOVERED'`, `commit: 'HEAD'` — the transition sets the drift baseline in the same call;
    - at INITIALIZED: only if `.dethereal/scope.json` exists, transition to `SCOPE_DEFINED`, then to `DISCOVERED` with `commit: 'HEAD'`. Without a scope, record no state: say that the scope is not defined yet and point to Step 1 (Scope Definition) of `/dethereal:threat-model`. If the server refuses a transition for a reason other than a git refusal (below), show its reason and stop;
    - at DISCOVERED or later (a re-run): no transition. If the re-run added or removed elements at ENRICHING or REVIEWED, apply the Backward Transition Protocol.

    With no transition (a re-run), set the drift baseline alone: `mcp__plugin_dethereal_dethereal__model_state` `action: 'set_baseline'` with no `commit` — the server records HEAD. When the baseline is refused — on the transition, or by `set_baseline` — with `not_a_git_repo`, `no_commits`, `git_unavailable`, `unsupported_repository`, `git_failure`, `unknown_commit` or `not_ancestor`, the whole call is refused: make the transition again with no `commit` (a `set_baseline` is simply skipped), say in one line that no drift baseline was set, and never retry through a shell — drift detection is skipped on resume until the operator re-runs `/dethereal:discover` in a git repo. Re-running discovery on an existing model sets a new baseline the same way; that is the explicit re-baseline path (e.g., after a history rewrite or a `--full-scan` cycle).
14. Say which files git keeps. This machine's records (below) the server keeps out of git itself. Recommend `.gitignore` entries for the files that are transient or local — a teammate cannot use them: `.dethereal/pending-id-rewrite.json`, `.dethereal/control-audit.log`, the lock and temporary files in `.dethereal/` (`*.lock`, `*.tmp.*`, `*.breaking`), `.dethernety/.models.lock` and `.dethernety/discovery-cache.json`. The model files, `attributes/`, `controls/`, `.dethereal/state.json`, `.dethereal/scope.json`, `.dethereal/discovery.json` (drift reads it), `.dethereal/class-cache/`, `.dethereal/template-fields/`, `.dethereal/quality.json`, `.dethernety/models.json` and a decomposition plan are the model: they are committed.
15. In the discover skill, show its footer. In the guided workflow, show none: go on to Module selection in the same turn.

**This machine's records.** `.dethereal/sync.json` and the enrichment relay files in `.dethereal/relay/` belong to this machine; the server keeps them out of git with `.dethereal/.gitignore`. If the repository already tracks one of them, the operator runs `git rm --cached -- <file>` once, in their own terminal — never you. A warning that `.dethereal/.gitignore` could not be written is shown, for the operator to keep those files out of git by hand. The relay files of finished passes are read again by nothing: the operator may delete `.dethereal/relay/` by hand, in their own terminal, whenever no Step 8 is running — never you.

**Picking up after an answer.** If you stopped at one of the questions above and are started again with the operator's `[answer: <id>]`, apply that answer to the proposal already in `discovery.json` — do not scan again — and continue with the next step. The same holds at each question in turn: `discovery-confirm`, `blind-spots`, then the Decomposition Protocol's `decomposition` and `decomposition-scope`.

## Backward Transition Protocol

When a structural change (add/remove element) occurs at ENRICHING or REVIEWED state:

1. Call `mcp__plugin_dethereal_dethereal__model_state` with `action: 'transition'`, `to: 'STRUCTURE_COMPLETE'`, and `add` = the ids of the new or changed elements that still exist. A removed element has no id left to track: the tool returns it under `rejected_ids`, which is expected.
2. The server applies the side effects: it deletes `.dethereal/quality.json` (forcing recomputation) and clears the sign-off and the review.
3. Warn the operator: "Adding or removing elements reverted state from [previous] to STRUCTURE_COMPLETE. Enrichment on existing elements is preserved. New or changed elements are tracked as stale and will be enriched next." Say that REVIEWED is cleared and that waivers lapse on the elements that changed, and show the result's `loop_back_note` when it carries one.
4. If a removed element was mapped to a crown jewel (`crown_jewel_elements` in `.dethereal/scope.json`), tell the operator the crown-jewel mapping must be confirmed again before the model can be reviewed.
5. An armed loop back (from `mcp__plugin_dethereal_dethereal__model_state` `action: 'loop_back'`) survives this transition: a removed element counts as touched, every other element stays armed, and Gate 3 stays `NOT_COMPUTED` until each is touched, or dropped with the operator's words (When Gate 3 is not computed, at Step 9).

In the guided workflow context, re-position the step cursor to Step 4 (Boundary Refinement) and show the updated progress table with re-opened steps.

The stale list is consumed by the enrichment skill — stale elements are prioritized first during the next enrichment pass. After enrichment processes a stale element, remove its id with `mcp__plugin_dethereal_dethereal__model_state` `action: 'stale'`, `remove`.

## Decomposition Protocol

After discovery confirmation — on the confirmed proposal, before anything is written to the model files — check if the validated inventory exceeds complexity thresholds:

| Dimension | Recommend Decomposition |
|-----------|------------------------|
| Components | 21+ |
| Trust boundaries | 9+ |
| Data flows | 36+ |
| Cross-boundary flows | 19+ |

If any threshold is exceeded:

1. **Default recommendation: scope narrowing** — start with the highest-risk subsystem (containing crown jewels). This produces one complete, analysis-ready model first and gets to value faster.
2. **If the operator described multiple systems:** offer a decomposition plan instead. Plan models upfront, track in `.dethernety/decomposition-plan.json`:
   ```json
   {
     "created_at": "ISO timestamp",
     "source_scope": "system name",
     "source_discovery": ".dethernety/discovery-cache.json",
     "models": [
       { "name": "Model Name", "path": "./threat-models/model-name", "status": "planned|in_progress|complete", "quality": null }
     ],
     "cross_model_links": [
       { "from_model": "Model A", "to_model": "Model B", "description": "API call" }
     ]
   }
   ```
3. When starting a subsequent model in the plan, pre-create stub components with `representedModel` links to referenced models. Unresolved references (model not yet synced) are warnings, not errors.

The recommendation is **advisory only** — the operator can proceed with a large model if they choose. Show the thresholds the inventory exceeds, then ask:

`[prompt: decomposition]` The model exceeds the complexity thresholds shown. Narrow the scope, plan a decomposition, or continue with one model? (narrow / decompose / continue) — table first, then AskUserQuestion, the tag first in its question text.

On `narrow` or `decompose`, propose the split and show it as a table before anything is written — for `narrow`, the elements of the subsystem this model keeps (and what it leaves out); for `decompose`, each planned model with its elements and the cross-model links — then ask:

`[prompt: decomposition-scope]` Is this the split you want? (confirm / change) — the table, then the question with its choices numbered, in one message; end your turn.

Apply the operator's changes and show the table again until they confirm. Only then write the model files for this model's elements and, for a plan, `.dethernety/decomposition-plan.json`.

## Discovery Cache Protocol

File: `.dethernety/discovery-cache.json` (project level, shared across models)

- Written after the first discovery in a project
- Contains full raw inventory: all discovered elements with sources and confidence scores
- Does NOT contain model-specific decisions (scope, classification, enrichment)
- Subsequent `/dethereal:discover` runs check cache freshness (file mtime vs codebase changes)
- When creating a new model in a decomposition plan, filter the cache to exclude components already assigned to other models via the `assignedTo` map
- The operator can force a re-scan at any time — the cache is a convenience, not authoritative

If the model was described rather than built from code, discovery still scans the codebase for corroboration. With no codebase, the described structure is the proposal: write it to `discovery.json` as the protocol's step 6 says, confirm it with `discovery-confirm` and `blind-spots`, run the Decomposition Protocol on it, then write it and go to Step 3.

### Module selection

Choose the platform modules that provide classes for classification and enrichment:

1. Take `recommendedModules` and the source types from `.dethereal/discovery.json`.
2. List the installed modules: `mcp__plugin_dethereal_dethereal__get_classes` with `view: 'modules'` — each module with its class counts per type.
3. Recommend the modules `recommendedModules` names — the scout mapped the source types to them — only where a source pattern the scout's module mapping lists for it was detected (a provider block, the provider's resource types, its manifests, SQL migrations), each with the resources behind it; a module reached only through a class-name hit goes under available, never recommended. `dethernety-general` is always included and cannot be removed.
4. Show the table — module, reason, include — with the available but not recommended modules below it, then ask:

   `[prompt: module-select]` Use these modules for classification? (yes / modify) — the table, then the question with its choices numbered, in one message; end your turn.

   A reply that lists the modules to use is the selection: exactly those, with `dethernety-general`; one that adds or drops a module changes the recommended set by that module only. A later reply, at any question, that restricts the modules updates `activeModules` the same way, and every row whose class came from a dropped module is proposed again from the modules left.

5. Write the confirmed modules to the scope as `activeModules` (`[{ "id", "name" }]`), in the table's order with `dethernety-general` last. Then show, once, the module list the model will carry: `manifest_modules.derived` from `mcp__plugin_dethereal_dethereal__model_state` `get` — the server keeps `manifest.json`'s `modules` from it; never write them yourself. When `get` has no `manifest_modules`, the manifest already holds that list: show `manifest.json`'s `modules` — the absence never means "no modules".

With no discovery (a described model), skip the recommendation: classification searches every installed module. The state stays DISCOVERED.

## Step 3: Model Review

**Group `review`** (Question groups), always one dialog. Before the review table is shown, run Step 4's hierarchy check (its items 1–2) and Step 5's item 1; never ask `model-review-confirm` before them, or alone while another member has rows. A member with no rows is left out of the dialog, never asked later on its own — except as the re-check after the class write below, and Step 5's, says. Question groups' size and dismissal rules still hold. Ask `model-review-confirm`, `boundary-hierarchy` — when Step 4's hierarchy check (its items 1–2) finds rows — and Step 5's `operational-flows` as one group: the review table, the boundary tree with its hierarchy rows, and Step 5's list (its item 1), in one message, then the dialog. Write the classes first (item 4), then run the hierarchy check again: rows that differ from the ones shown — a re-typed or removed element's included — are asked with `boundary-hierarchy` again, alone; otherwise apply its answer (Step 4, item 2). `boundary-trust` follows alone, as Step 4 says; the flows are written at Step 5 (its item 3).

1. Classify deterministically — components, boundaries **and data flows**, each with its own `classLabel`: `mcp__plugin_dethereal_dethereal__match_classes` with the elements' names, types and descriptions, `moduleIds` from `activeModules` (all modules when it is absent), and components one call per type (`PROCESS`, `STORE`, `EXTERNAL_ENTITY`), each with `componentType` — never one mixed call: it is the only hard type filter. An `exact_name` match is accepted in the table; the others are listed to confirm. A row's confidence reads `exact name` only when `mcp__plugin_dethereal_dethereal__match_classes` returned `exact_name` for it. An element in its `unmatched_type_only` is never given a type-match pick: list its `class_type` — or, with none, the call's `classLabel` type — by module with `mcp__plugin_dethereal_dethereal__get_classes` (`module_name`, `fields: ['id', 'name']`, once for all such elements of that type), as its `hint` says — while a page is `truncated`, call again with its `next_offset` — and propose from what that finds, the scout's class, when it differs, beside it. Candidates at the same confidence from different modules — or a provider's class against the class of the engine it runs (a managed database service's class against the database's) — are told apart by how much of the element's attack surface each template covers: the provider's class wins only when its template also covers the engine's concerns (queries, roles, credentials, host access), not only the provider's control plane; otherwise the engine's class. When the template keys cannot be fetched, or do not settle it, propose the engine's class, with the provider's beside it for the operator. A full tie goes to the module listed earlier in `activeModules`. On a real tie — candidates from different modules at the same confidence, or a provider's class against its engine's — fetch each tied class's template keys, `mcp__plugin_dethereal_dethereal__get_classes` with `class_id`, its `module_name` and `fields: ['id', 'name', 'template_keys']`, one class a call and once per class in a run (a third class only when it is in the tie too), and compare them; never for an `exact_name` pick with no rival, and never in a listing. If the call fails, fall back to `mcp__plugin_dethereal_dethereal__get_classes` per module and per `class_type` with `fields: ['id', 'name', 'type', 'category', 'module']`, following `next_offset` until `truncated` is false (a changed `listing` starts it over), then to matching by name alone; otherwise classification lists classes only as this item says.
2. Match what is left by name, type and description against the active modules' classes. An element discovered from IaC keeps its IaC pre-classification only when that class's module is active — look it up with `mcp__plugin_dethereal_dethereal__get_classes` (`class_id`, `fields: ['module']`); otherwise propose a class from the active modules, and name the dropped class and its module in the table's note, so the operator can add that module at classification. A class made for another element type (a PROCESS class on an EXTERNAL_ENTITY) is never kept: propose the best class of the element's own type in its place. A cloud provider's managed service — the provider operates it and the system only calls its API (key management, a secret manager, managed log groups, a managed certificate service) — is an `EXTERNAL_ENTITY` with the baseline module's External Cloud Service class, unless an active-module class made for that service fits: match it against that class's type too, and then that class and its type win. Its row proposes the type and the class together, never an unclassified internal store; Step 4's hierarchy check moves it to the provider's external boundary. A flow from it into the system that the service does not initiate is proposed reversed, as its own row. A store the system deploys and runs itself — Kubernetes Secrets in its own cluster, a vault on its own pods or VMs — stays internal; a provider's key vault is a managed service.
3. Show the table — element, type, boundary, proposed class, confidence, and a `partial fit: <what differs>` note where the class fits only in part — then ask:

   `[prompt: model-review-confirm]` Confirm these classes, or modify rows? (yes / modify / skip) — the table, then the question with its choices numbered, in one message; end your turn.

4. Write the confirmed `classData` to `structure.json` (components, boundaries) and `dataflows.json` (flows) — for a re-type row also the element's `type`, for a reversed flow its `source` and `target` swapped — then `mcp__plugin_dethereal_dethereal__generate_attribute_stubs` with `directory_path` for the classified elements. The writes go in one message (Model-file writes). An element the operator asks to leave unclassified is recorded in `.dethereal/discovery.json`'s `left_unclassified` as `{ "id": "<element id>", "words": "<the operator's words, verbatim>" }`, so Step 6 never proposes it again, in a later session too; and each class item 2 dropped, whatever the answer, in its `dropped_classes` as `{ "id": "<element id>", "class": "<class name>", "module": "<module id>" }`.
5. An element the operator asks to remove here is a handover: load the `/dethereal:remove` skill with the element and follow it to its footer — its `remove-confirm` asks again what the operator already asked for; then go on with this step.

The state stays DISCOVERED.

## Step 4: Boundary Refinement

Refine the boundary hierarchy first, then ratify the trust skeleton (zone and plane) and the enforcement posture of the hierarchy that results, in one batched question — never boundary by boundary.

1. Show the boundary hierarchy as a tree.
2. Check it: single-component boundaries (merge?), a flat hierarchy (sub-boundaries?), external entities inside internal boundaries (move to an external one — a cloud provider's managed service to the provider's boundary). Each finding becomes a row — never dropped because you judge the change unwise. Its Change column is the recommended action: a merge, a move or a new sub-boundary, with the elements it moves, why, and — for a merge — the zone the merged boundary keeps; or **keep as is**, with the alternative change and why you do not recommend it. `apply all` applies the recommended actions, so a keep row changes nothing; `adjust` takes a row's alternative. A `boundary_hierarchy_quality` below 1.0 always yields at least one row. With no finding, say so in one line. With findings, show them as a table, then ask:

   `[prompt: boundary-hierarchy]` Apply these hierarchy changes, or adjust specific rows? (apply all / adjust) — the table, then the question with its choices numbered, in one message; end your turn.

   Write only the accepted changes to `structure.json`: item 3's call validates them.
3. Compute the skeleton on the hierarchy as it now stands: `mcp__plugin_dethereal_dethereal__validate_model_json` `action: 'validate'`, `include: ['zoning']`, `assets: 'skeleton'` (core rule 6) — external and exposure tiers and the `INTERNAL` default only. RESTRICTED waits for Step 7; never propose it here.
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

   `[prompt: boundary-trust]` Accept the trust classification and the Enforcement posture as proposed, or adjust specific rows? (accept all / adjust) — the table, then the question with its choices numbered, in one message; end your turn.

5. Only the accepted rows — proposed is not written: write the boundary's `zone`, `planes` and `domains` to `structure.json` and its enforcement attributes to its attribute file — a boundary with none gets `attributes/boundaries/<id>.json` holding only the confirmed keys — every edit of this answer in one message (Model-file writes). A boundary left unconfirmed gets no zone: it stays `—`, counted as unclassified at Step 9 unless it is a structural container.

**Auto-skip** only when the `boundary_hierarchy_quality` factor is 1.0 (depth ≥ 2, no single-child boundaries, no external entities in internal ones) **and** no zone proposal is pending **and** the skeleton reports no `unclassified` finding: say "Boundary hierarchy is well-structured (quality factor: 1.0), no zone proposals pending. Skipping refinement." and mark it `[auto-skip]`. A perfect hierarchy with proposals still shows the trust table.

Then `mcp__plugin_dethereal_dethereal__model_state` `action: 'transition'`, `to: 'STRUCTURE_COMPLETE'`.

## Step 5: Data Flow Mapping

When Step 3's group `review` asked `operational-flows`, its answer is item 2's — once item 1 is run again on the model as it now is: a list that differs from the one shown is asked with `operational-flows` again, alone.

1. Review the flows from discovery and list the components without any flow, and every PROCESS with inbound flows and no outbound flow — with the call sites the scout reported for it. A flow a source shows — the scout's rows included — is proposed in that list with its evidence, never asked whether it exists; a path through a jump host or relay is one flow per hop, through that host. What the scope excludes is never a component or a flow: an excluded service's internals are attributes of the element that uses it — never the service itself, which stays a component.
2. Show them with the operational flows code analysis misses, then ask:

   `[prompt: operational-flows]` Which of these flows exist? Administrative access paths (SSH, RDP, consoles), monitoring and logging flows (to log aggregators, SIEM), backup and recovery flows, and privilege or auth transitions — a caller and callee at different authorization levels inside one zone. Also: what connects the components listed without a flow, and where do the listed processes send their calls? Say "none" for a category that does not apply. — a plain message; end your turn.

3. For each new flow, choose the source and target handles from the relative positions (Layout), avoid handle conflicts with existing flows, and set the description and protocol. Write the flows to `dataflows.json`: the next check validates them.
4. **A privilege or auth transition** the operator confirmed is a candidate sub-boundary, or a `Management` plane when the callee's segment really is management. Propose it as Step 4 does — `boundary-hierarchy`, the write, the skeleton again, `boundary-trust` for the new rows — before the approved channels; nothing moves before the answers. If the operator declines both, the transition stays a flow: record it in `.dethereal/discovery.json` as `privilege_transitions` (the flow id, the caller, the callee, the operator's answer verbatim), so the credential step asks about that flow and its callee even in a later session.
5. **Approved channels.** Call `mcp__plugin_dethereal_dethereal__validate_model_json` `action: 'validate'`, `include: ['zoning']`, `assets: 'skeleton'` (core rule 6). Its `external-ingress` findings are the risk-bearing crossings: an external-tier boundary with a flow into a trusted tier and no approved channel, `boundaryId` the source and `peerId` the target — never re-walk the flow graph. Only these are asked: in-zone and child↔parent crossings are implied by inheritance and never surfaced. With none, skip this. For each, draft a justification from the crossing flow's description; skip a crossing whose source boundary already has a conduit to that peer (read its `conduits[]` first). Show the table — channel (source → peer, display names), draft justification — then ask:

   `[prompt: approved-channels]` Ratify these crossings as approved channels — declared intent, not enforcement — or adjust specific rows? (ratify all / adjust) — the table, then the question with its choices numbered, in one message; end your turn.

   For each ratified row, append to the **source** boundary's `conduits[]` in `structure.json` one outbound conduit, `{ "peerId": "<target boundary id>", "direction": "OUTBOUND", "justification": "<non-empty>" }` — never an inbound mirror (the read path derives it; a lone inbound conduit is rejected), and never `controlRefs`. A crossing not ratified stays a plain flow and returns at Step 9 as an advisory `external-ingress` finding, as do crossings into asset-bearing boundaries, which cannot be classified before Step 7.
6. `mcp__plugin_dethereal_dethereal__model_state` `action: 'transition'`, `to: 'ENRICHING'` (Steps 5–8 all run at ENRICHING), then one line: `Data flows mapped. Quality: X/100.` — no footer.

Then the session break below — a quick model goes on to Step 6, entering `classify` in the same turn, without it. If the operator continues, enter `classify` in the same turn; on `later`, show `To resume: /dethereal:threat-model <model-path>` and that progress is saved and the run resumes at Step 6, and stop.

### Session break

After Step 5 of a full run, insert a size-calibrated checkpoint. A quick model (`get` shows `mode: 'quick'`) goes on to Step 6 — `classify` in the same turn — without it: the break is for a long full run, whose fresh session saves context. For models with 15 or more components, recommend starting enrichment in a fresh session (saves ~25–40% token cost). Suggest `git commit` here — the operator runs it, not you. Then ask:

`[prompt: session-break]` Your model structure is complete and saved. Consider committing it before enrichment (clean revert point). Continue now? (yes / later) — table first, then AskUserQuestion, the tag first in its question text.

If the operator continues, proceed without asking again.

# Dethernety Threat Model Guidelines — Layout & Coordinates

## Coordinate System

- All position coordinates (`positionX`, `positionY`) are **relative to the parent boundary**
- Origin (0,0) is at the **top-left** of the parent boundary
- Components have a fixed visual size of **150×150 pixels**
- Position boundaries to avoid overlapping child elements
- Leave padding around boundaries for visual clarity (minimum 50px)

## Data Flow Handle Selection

Choose `sourceHandle` and `targetHandle` based on the **relative positions** of components:

| Target Position | Source Handle | Target Handle |
|-----------------|---------------|---------------|
| To the right    | right         | left          |
| Below           | bottom        | top           |
| To the left     | left          | right         |
| Above           | top           | bottom        |

**Important for STORE components:** They only have `left` and `right` handles — ignore the table above for STORE connections. Always use `left`/`right` regardless of relative position. Use horizontal connections only.

## Avoiding Handle Conflicts

Do NOT create flows between the same two components using the same handle pair. When bidirectional communication exists, use **different handle pairs** for each direction.

**BAD** (overlapping lines):
- Flow 1: A[right] → B[left]
- Flow 2: B[left] → A[right]

**GOOD** (clear separation):
- Flow 1: A[right] → B[left]
- Flow 2: B[bottom] → A[top]

## Boundary Sizing

- Size boundaries to contain all child elements with padding
- Minimum padding: 50px on each side
- Set `dimensionsMinWidth` and `dimensionsMinHeight` to prevent collapse
- Nested boundaries should fit within their parent with clearance

## Flow Direction Conventions

- Primary flow direction: **left-to-right** or **top-to-bottom** for readability
- External entities typically on the left or top
- Data stores typically on the right or bottom
- Group flows logically — request/response pairs should use consistent handle patterns
