Summarise the attack surface of the threat model named in the arguments (the operator's text quoted in your task message). You change nothing. Return the summary as your final answer; the conversation that started you shows it. Every part below is a markdown table or list in that answer — the summary is the deliverable.

Gather in as few turns as you can: make independent reads and tool calls together in one turn — the model files at once, `mcp__dethereal__query_exposures` for every element at once, every technique lookup at once. Keep turns for the answer: after about 25 turns of gathering, stop and write the summary from what you have, and mark each part you did not finish "not checked" — never as clean or as having no gaps.

## The model

Use the directory path in the arguments. Without one, read `.dethernety/models.json`: exactly one model → that model; none → return "No local models. Run `$dethereal:create` first." and stop; several → return them as a numbered list (name, path) with "Run `$dethereal:surface` again with the model's path." and stop.

Read `manifest.json`, `structure.json`, `dataflows.json`, `data-items.json` and the files under `attributes/` from disk. No components: return "The model has no components. Run `$dethereal:discover` or `$dethereal:add` first." and stop. The model is **synced** when `manifest.model.id` is set.

**Encryption at rest:** `not_applicable` is the answer for a component that stores nothing. Show it as "n/a (stores nothing)" — never as "none" or "unencrypted" — and never count it as a gap.

## 1. Components

Walk the boundary hierarchy; count PROCESS, STORE and EXTERNAL_ENTITY per boundary:

| Boundary | PROCESS | STORE | EXTERNAL_ENTITY | Total |
|---|---|---|---|---|

## 2. Trust-boundary crossings

The crossing flows are the server's: `mcp__dethereal__validate_model_json` with `action: 'coverage'` and `directory_path` (the call part 4 uses; make it once) gives `formal_coverage.cross_boundary_flows` — each crossing flow's `id`, `name` and `authentication` — and `formal_coverage.cross_boundary_flows_total`. Never decide by hand which flows cross: a flow between an external entity and a component in the same boundary crosses too. Group them by the boundaries of their source and target (from `structure.json`; "within <boundary>" when both sit in one). Per group: the flow count; encrypted (the flow's `encryption_in_transit`) out of the count; authentication from the server's `authentication` — `declared`, `declared_none` (the flow declares it needs none), `undeclared`; and enforcement — "enforced" when the target boundary has `implicit_deny_enabled` and the source boundary `egress_filtering`, otherwise "logical only":

| From → To | Flows | Encrypted | Authenticated | Declares none | Undeclared | Enforcement |
|---|---|---|---|---|---|---|

When `cross_boundary_flows_total` is larger than the list: "+N more crossing flows not listed". Mark a flow whose `auth_failure_mode` is `fail_open`: it looks authenticated but guarantees nothing on failure. Unencrypted, `declared_none`, `undeclared` and fail-open crossings are the priority gaps; list them by name.

## 3. Exposures and MITRE-grounded gaps

**Synced:** `mcp__dethereal__get_control_gaps` with the model id — the only model-wide route (`mcp__dethereal__query_exposures` `list` needs an `element_id`: per-element drill-down only). Show:
- exposures by element: the total, and the most affected element;
- **unmitigated** — addressable: an ATT&CK mitigation exists and an installed control class matches (e.g. "api-server: SQL Injection (T1190 → M1016)");
- **unaddressable** — no installed control class covers the mitigation (a module gap);
- **recommended controls** — with their D3FEND links and `addressesCount`. Several rows naming related control classes for one mechanism can be one control with one class entry each, not one control per row;
- `configuredCoverage` — controls assigned to the element but addressing other techniques;
- `noMitreChain` — "N exposures have no ATT&CK technique mapping and cannot be analysed through the framework chain".

If the call fails (sign-in, network), say so and go on with the local parts. **Not synced:** "Model not synced — push it with `$dethereal:sync` push for exposure and gap analysis."

## 4. Control coverage

Call `mcp__dethereal__validate_model_json` with `action: 'coverage'` and `directory_path`. An error (a model the gates cannot read) — show its message and skip 4a–4b. A `warnings` entry saying the local model could not be read — show it and say formal coverage needs the local model.

**4a. Inferred coverage** (from attributes; `inferred_coverage`): one row each for authentication, encryption in transit (cross-boundary flows), encryption at rest (stores) and monitoring — `covered/total (%)` and the `missing` names. Note under it: inferred from attributes — enough for a posture review, not compliance evidence; `$dethereal:enrich` fills the gaps.

**4b. Formal coverage** (from assigned controls; `formal_coverage`), by the gates' tiers — each component in exactly one tier:

| Tier | Components | With controls | Without controls |
|---|---|---|---|
| 1 — Internet-facing | `total` | `with_controls` (%) | the `gaps` names, then "+N more" from `gaps_total` |
| 2 — Crown jewel or restricted | | | |
| 3 — Internal | | | |
| Crown jewels (label — overlaps the tiers, not added to them) | | | |
| Cross-boundary (label — overlaps the tiers, not added to them) | `formal_coverage.labels.cross_boundary` | | |

- Each tier's `unclassified`: components left out of `total` because they have no class — say how many.
- `externals_excluded`: external entities, never counted.
- `tier_3_unzoned`: Tier 3 components in no declared zone — name the count.
- The cross-boundary label: components outside Tier 1 that talk across a boundary to another component (east-west pivots). Like crown jewels it is a label, never summed into the tiers.
- No component with a control: "No formal controls assigned. Run `$dethereal:enrich` --focus controls."

**4c. Control sources** (`source_breakdown`, when present): discovered (verified in code or IaC — full confidence), declared (asserted, unverified), both (highest confidence).

**4d. Governance controls:** `declared_governance_controls` from `.dethereal/scope.json`, listed; left out when empty.

## 5. MITRE ATT&CK coverage

Tactics come from the exposures' `exploitedBy[].attack_id` (the platform's analysis), never from the local model.
- **Synced, with exposures:** collect and deduplicate the technique ids; resolve every one to its tactic with `mcp__dethereal__search_mitre_attack` (`action: 'technique'`) — never from memory. Show the techniques mapped, and the tactics covered and not covered out of the 15 Enterprise tactics: Reconnaissance, Resource Development, Initial Access, Execution, Persistence, Privilege Escalation, Stealth, Defense Impairment, Credential Access, Discovery, Lateral Movement, Collection, Command and Control, Exfiltration, Impact.
- **Synced, no exposures:** "No exposures yet — run an analysis on the platform (create, run, then read its results), or install a module whose policies cover these components."
- **Not synced:** "Push with `$dethereal:sync` push, then run an analysis, for tactic coverage."

## 6. Credential topology

Crossing flows (part 2's set) with `required_credentials`; stores with `stores_credentials: true`; one credential on several flows — its blast radius (flows and boundaries). None: "No credential mappings. Run `$dethereal:enrich` --focus credentials."

## 7. Detection coverage

Components by `monitoring_tools` (SIEM, EDR, NDR counts); components with none are blind spots — name them. No data: "No monitoring data. Run `$dethereal:enrich`."

## 8. Cross-model boundaries

Components or boundaries with `representedModel`: "N components stand for other models; attack paths through them are outside this model's analysis." A `credential_scope` value also used in another model registered in `.dethernety/models.json`: warn about cross-model credential reuse. Neither: leave this part out.

## Footer

```
[done] Attack surface: <N> components, <K> boundary crossings, <J> control gaps.
[next] When you're ready: $dethereal:enrich (fill control gaps) or $dethereal:sync push (publish for exposure analysis)
```
