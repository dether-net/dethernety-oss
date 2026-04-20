---
name: status
description: Show Dethernety connection status, auth state, and local model summary
argument-hint: "[show models <controlId>]"
---

Show a status overview of the Dethereal plugin. Read all data from local files — do not call MCP tools.

## Parse Arguments

- No arguments → full status (default flow below)
- `show models <controlId>` → `show models` sub-verb (see §Show Models) — reads the cached `platformState.assignedModelIds` from the local `controls/<controlId>.json` with the V1 limitation note

## Steps

1. **Platform URL**: Read the `DETHERNETY_URL` environment variable. If unset, default to `http://localhost:3003`.

2. **Auth status**: Read the token store at `~/.dethernety/tokens.json`. Find the entry keyed by the platform URL.
   - If tokens exist and not expired: show "Authenticated" with the user email (decode the JWT payload — it's base64url, the `email` claim) and time remaining (compute from `expiresAt` minus current timestamp)
   - If tokens exist but expired: show "Token expired — run /dethereal:login to re-authenticate"
   - If no tokens: show "Not authenticated — run /dethereal:login"

3. **Local models**: Read `.dethernety/models.json` from the current working directory.
   - If file doesn't exist or has no models: show "No local models. Run /dethereal:create to get started."
   - For each model, read:
     - `<model-path>/manifest.json` for the model name
     - `<model-path>/.dethereal/state.json` for the current state
     - `<model-path>/.dethereal/quality.json` for the quality score
     - `<model-path>/.dethereal/sync.json` for last sync timestamps

4. **Control library aggregation** (per model, read-only):

   For each model, if `<model-path>/controls/` exists, enumerate `*.json` files under it. For each file, parse and collect:
   - `lifecycle` (greenfield / partially-pushed / brownfield / tombstoned)
   - Whether any `classes[].pendingEdit` block is populated (and which)
   - `platformState.lastSyncedAt`, `platformState.lastPushedAt`
   - Per class entry: drift flag — apply the same predicate the `validate-model` tool uses (Sprint 4 F-12 single-source-of-truth: `isClassDrifted` from `@dethernety/dt-core/dt-control-library/drift-detector`). The predicate is: `lifecycle ∈ {brownfield, partially-pushed} AND platformAttributes populated AND pendingEdit absent AND attributes !== platformAttributes`. Both this skill and `validate-model` MUST behave identically — if you find divergence, that's the bug, fix the helper not the consumer. **Note (Sprint 6 Tier-3 carryover):** the same predicate is also rendered by `/dethereal:enrich --focus controls` Step 4's defensive post-edit drift sweep (Sprint 6 F-36 closure). All three consumers (status, validate-model, enrich) read the SAME `isClassDrifted` helper; an operator who sees a drift hint in any one of them sees the same set of Controls in the other two.
   - Cross-reference against the model's `structure.json` / `dataflows.json` `controls[]` arrays to flag orphan files

5. **Format output** as:

```
Dethernety Connection Status
─────────────────────────────────────────
Platform URL:  https://demo.dethernety.io
Auth status:   Authenticated (user@example.com, 59 min remaining)
─────────────────────────────────────────

Local Models:
  Production Stack  ./threat-models/prod  56/100 (ENRICHING)  synced 2h ago
  Dev Environment   ./threat-models/dev   23/100 (DISCOVERED) never synced

Control library (Production Stack):
  Lifecycle:      greenfield: 0 | partially-pushed: 0 | brownfield: 12 | tombstoned: 1

  Pending edits:  2 controls queued for push
    - Azure Firewall (MCE/MCETest Hub) [Firewall Policy]: 5 keys edited by agent at 2026-04-18T10:30Z
    - NSG Least-Privilege Ingress [Network Access Control]: 2 keys edited by operator at 2026-04-18T11:05Z

  Drift warnings: 1 control has asymmetric state (external edit suspected)
    - TLS 1.3 (API Gateway) [TLS Config]: attributes differ from platformAttributes with no pendingEdit.
      Recovery: /dethereal:sync promote-external-edit <controlId> <classId>

  Stale-sync:     1 control last synced > 15 min ago
    - Vault KMS Rotation: last synced 3h ago — consider /dethereal:enrich --focus controls

  Orphan files:   1 control file not referenced by structure or dataflows
    - ctrl-abc-123.json — remove with manual cleanup or re-link via /dethereal:enrich

Run /dethereal:help for available commands.
```

Omit any of the six Control library rows (`Lifecycle`, `Pending edits`, `Drift warnings`, `Stale-sync`, `Orphan files`) when its set is empty; omit the entire Control library section for models that have no `controls/` directory. Multi-model projects render one `Control library (<model-name>):` block per model.

**Soft caps for scale.** When `Pending edits` enumerates more than 10 controls, render the first 5 and a footer:

```
  Pending edits:  17 controls queued for push
    - <name1> [<className>]: ...
    - <name2> [<className>]: ...
    - <name3> [<className>]: ...
    - <name4> [<className>]: ...
    - <name5> [<className>]: ...
    (12 more — run /dethereal:enrich --focus controls or inspect controls/ directly)
```

Same treatment for `Drift warnings` (cap at 5 with `(N more — see ...)` footer). `Lifecycle` is a single summary line and is never truncated. `Orphan files` rarely scales but apply the same cap if it ever exceeds 10.

If no models exist, omit the "Local Models" section entirely and add:
```
No local models found. Run /dethereal:create to get started.
```

---

## Show Models Sub-Verb

> `/dethereal:status show models <controlId>` — list the models assigned to a specific Control per the last-pull cache.

1. Resolve the model directory via the Model Resolution Protocol (or use `directory-path` from argument if provided).
2. Read `<modelDir>/controls/<controlId>.json`. If missing, render `Control <controlId> not pulled locally. Run /dethereal:enrich --focus controls first.` and stop.
3. Render:
   ```
   Models assigned to "<controlName>" (<M> total, cached from last pull):
     - <modelId1>
     - <modelId2>
     ...
     (model freshness/ownership not shown — V1 limitation)

   For history of this control's local edits:
     git log --follow controls/<controlId>.json

   For the audit-log entries this control has driven:
     jq 'select(.controlId == "<controlId>")' .dethereal/control-audit.log
   ```
4. Do NOT issue a fresh platform query. This sub-verb is local-only by design; freshness happens at push time (the `/dethereal:sync` P7 flow re-issues `pull-controls` before rendering the batched review screen).

The `--follow` flag is critical because `controls/` files get renamed when class IDs change (greenfield → brownfield WAL id rewrite); without it, the operator sees an empty log and concludes the file is fresh.

**V1 limitation** (per CL §6): `Model.lastModifiedAt` and `Model.owner` are not yet on the platform schema. Until both land, this sub-verb displays model ids only.
