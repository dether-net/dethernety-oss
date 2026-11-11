Review the threat model named in the arguments (the operator's text quoted in your task prompt) for completeness, correctness and readiness for platform analysis. You change nothing: no model file, no file under `.dethereal/`, no workflow state. Return the review as your final answer, in markdown; the conversation that started you shows it.

Gather in as few turns as you can: make independent reads and tool calls together in one turn — the model files at once, then every other call that does not need an earlier result. Keep turns for the answer: after about 25 turns of gathering, stop and write the review from what you have, and mark each part you did not finish "not checked" — never as passing or clean.

## The model

Use the directory path in the arguments. Without one, read `.dethernety/models.json`: exactly one model → that model; none → return "No local models. Run `/dethereal-create` first." and stop; several → return them as a numbered list (name, path) with "Run `/dethereal-review` again with the model's path." and stop. You cannot ask which one.

Read `manifest.json`, `structure.json`, `dataflows.json` and `data-items.json` from disk. With `--structure-only` in the arguments, do the structure check below and nothing else; otherwise the full review.

## Full review

Render every part below as markdown in your answer — a table stays a table, never a count or a one-line summary. Run the tools in this order: `dethereal_validate_model_json` with `action: 'validate'`, then `'gates'`, then `'quality'`, then `'zoning'` (each with `directory_path`), then `dethereal_workspace_status` with `directory_path` for the model's state and readiness.

1. **Gates** — render them exactly as Gate Verdicts says: every verdict, failing check, waiver and the Gate 3 report and `limit` sentence come from the tool, never from you.
2. **Quality** — `quality_score` with its `label` (Starting, In Progress, Good, Comprehensive), then one table row per factor:

   | Factor | Score | Weight | Contribution |
   |---|---|---|---|
   | Component classification | 60% | 25 | 15.0 |

   Say once: the score measures how completely the model describes the system, not how secure the system is — a 95/100 model can describe a system with critical weaknesses. The score is a label; it gates nothing.
3. **Red flags** — named always, whatever the score:
   - every insecure fact recorded in the attribute files, as your Red Flags rule says — one search across `attributes/` matching field names by substring, read from the files, one line per element and field;
   - flows with `auth_failure_mode` `fail_open` or `fallback` (they look authenticated but guarantee nothing on failure);
   - crown jewels with no control — `crownJewel: true`, and any the gates report maps as one (`crown_jewel_map`);
   - controls whose class binding has empty `attributes` and empty `platformAttributes` (assigned, but the module derives no countermeasure from an empty binding);
   - on a synced model, controls with no countermeasure after analysis (`dethereal_query_countermeasures` `list`).
4. **Zoning coherence** — the `action: 'zoning'` findings, rendered as your Zoning Coherence rules say: advisory, per boundary, with the scope disclaimer once; it never blocks a push.
5. **Common gaps** — one checklist line each, `[x]` found or `[ ]` not found, decided only by these tests on names and descriptions (case-insensitive) so the list is the same for an unchanged model:
   1. Administrative access paths — a flow naming SSH, RDP, admin, management or console;
   2. Monitoring and logging — a flow naming monitor, log, SIEM or metric;
   3. Backup and recovery — a flow naming backup, snapshot, dump or replicate;
   4. Trust-boundary crossings — every pair of adjacent boundaries has at least one flow between them;
   5. External dependencies — an EXTERNAL_ENTITY for a CDN, DNS, certificate authority or registry;
   6. Human actors — an EXTERNAL_ENTITY naming developer, operator, admin or support;
   7. Two-way flows — a component pair with flows in both directions;
   8. Error and fallback paths — a flow naming error, retry, fallback, circuit-breaker or dead-letter.
6. **Top issues** — the three most severe, each tagged `[Critical]`, `[Warning]` or `[Info]`, naming the elements (e.g. "3 components have no class: Web Server, Cache, Worker").
7. **Recommendations** — which command to run next (`/dethereal-classify`, `/dethereal-enrich`, `/dethereal-add`) and for which elements.
8. **State** — the model's `displayState` from `dethereal_workspace_status`, as given (e.g. "ENRICHING"). When its `review` is present (the state file claims REVIEWED):
   - `holds` false: "REVIEWED no longer holds: <each of `review.blockers` in words>" — the words are in the table under Readiness;
   - `holds` true and `stale` true: "REVIEWED is stale: the model changed since the review."
9. **Readiness for analysis** — the model's `readiness` from `dethereal_workspace_status`, never from the score and never judged by hand:
   - **Ready** — `ready` true: "Ready for platform analysis."
   - **Not Ready** — `ready` false: "Not Ready for platform analysis:", then each of its `blockers` in words:

     | Blocker | Words |
     |---|---|
     | `gate2` | Gate 2 fails — the platform refuses the push until the structural failures are fixed |
     | `gate3` | Gate 3 fails — a push is possible, but analysis would have gaps; name the failing criteria. `NOT_COMPUTED`: a loop back is open, neither a pass nor a fail; Step 9 of `/dethereal-threat-model` ends it |
     | `pending` | only with the server's settlement turned on: enrichment values it holds as not yet confirmed |
     | `pending_unreadable` | only with the server's settlement turned on: its pending-enrichment file cannot be read |
     | `settlement` | only with the server's settlement turned on: values it holds as not registered as the operator's |
     | `unavailable` | the model could not be assessed |
     | `stale_queue` (review only) | elements changed since the review are still queued as stale |
     | `quick_mode` (review only) | a quick model is never reviewed; `/dethereal-threat-model` with `--full` deepens and reviews it |

   When Ready but the quality factors `control_coverage_rate` and `credential_coverage_rate` are both 0, add: the model is ready, but analysis improves markedly with credentials (lateral-movement paths) and controls (defense coverage gaps).
10. **Discovery basis** — when `.dethereal/discovery.json` exists, one line from it: "Model based on: code analysis (<n> components) + manual (<m>). Known gaps: <k>." Always add: runtime validation recommended — this model reflects what the code shows; compare it with a cloud asset inventory, DNS logs or network flow data to find infrastructure the code does not show.
11. **Cross-model gaps** — components or boundaries with `representedModel`: say that attack paths through them are outside this model's analysis (see Cross-Model Gap Detection).
12. **Footer:**
    ```
    [done] Review complete. Gates: G1 <v> · G2 <v> · G3 <v>. Quality <score>/100 (<label>).
    [next] When you're ready: `/dethereal-enrich` (fill the gaps) or `/dethereal-sync` push (publish)
    ```

## Structure check (`--structure-only`)

Structural checks only, no gates and no score. Each line `[PASS]`, `[FAIL]` or `[WARN]`:

1. Required fields — `manifest.json` has a name and a description; `structure.json` has its default boundary; `dataflows.json` has its `dataFlows` list.
2. Unique ids — no id used twice across components, boundaries, flows and data items.
3. References — every flow's source and target is a component or boundary in `structure.json` (FAIL, listing each flow and missing id).
4. Unconnected components — no flow in or out (WARN).
5. Empty boundaries — no component and no child boundary (WARN).
6. Orphaned attribute files — a file in `attributes/` whose element no longer exists (WARN).
7. Schema — the full schema validation: `dethereal_validate_model_json` with `action: 'validate'`.

```
## Structure check: <model name>
  [PASS] Required fields present
  [FAIL] References: 2 flows name missing components
    - "user-login" → source "auth-proxy" not found
  [WARN] 1 unconnected component: "Legacy Gateway"
Result: 1 failure, 1 warning. Fix the references before a push.

[done] Structure check complete. <n> passed, <m> failed, <k> warnings.
[next] When you're ready: fix what is reported, then /dethereal-review for the full review.
```
