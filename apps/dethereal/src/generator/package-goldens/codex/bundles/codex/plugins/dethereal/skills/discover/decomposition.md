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

`[prompt: decomposition]` The model exceeds the complexity thresholds shown. Narrow the scope, plan a decomposition, or continue with one model? (narrow / decompose / continue) — table first, a numbered list; end your turn.

On `narrow` or `decompose`, propose the split and show it as a table before anything is written — for `narrow`, the elements of the subsystem this model keeps (and what it leaves out); for `decompose`, each planned model with its elements and the cross-model links — then ask:

`[prompt: decomposition-scope]` Is this the split you want? (confirm / change) — table first, a numbered list; end your turn.

Apply the operator's changes and show the table again until they confirm. Only then write the model files for this model's elements and, for a plan, `.dethernety/decomposition-plan.json`.

## Discovery Cache Protocol

File: `.dethernety/discovery-cache.json` (project level, shared across models)

- Written after the first discovery in a project
- Contains full raw inventory: all discovered elements with sources and confidence scores
- Does NOT contain model-specific decisions (scope, classification, enrichment)
- Subsequent `$dethereal:discover` runs check cache freshness (file mtime vs codebase changes)
- When creating a new model in a decomposition plan, filter the cache to exclude components already assigned to other models via the `assignedTo` map
- The operator can force a re-scan at any time — the cache is a convenience, not authoritative
