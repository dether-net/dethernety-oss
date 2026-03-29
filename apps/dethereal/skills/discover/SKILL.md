---
name: discover
description: Auto-discover infrastructure components from codebase using the infrastructure-scout agent
agent: threat-modeler
argument-hint: "[scope] [path]"
---

Scan the current codebase for infrastructure components, trust boundaries, and data flows using automated discovery.

Note: This skill uses `agent: threat-modeler` (not infrastructure-scout) because discovery requires writing model files. The threat-modeler delegates scanning to `Agent(infrastructure-scout)` and handles all file writes per the subagent write convention.

## Prerequisites

1. **Resolve model path** using the Model Resolution Protocol
2. If no model exists, suggest `/dethereal:create` first and stop
3. Read `.dethereal/scope.json` if it exists — use scope context to guide discovery focus

## Steps

### 1. Check Discovery Cache

If `.dethernety/discovery-cache.json` exists:
- Check if this model is part of a decomposition plan (`.dethernety/decomposition-plan.json`)
- If yes, filter out components already assigned to other models using the `assignedTo` map
- Show: "Using cached discovery results. N components pre-filtered for other models."
- Offer option to force a fresh scan if the cache is stale

### 2. Delegate to Infrastructure Scout

Delegate scanning to `Agent(infrastructure-scout)`:
- Pass the model directory path and scope summary (system name, crown jewels, exclusions)
- The scout scans 10 source categories and returns a compact discovery report
- The scout does NOT write files — it returns structured data only

### 3. Process Discovery Results

From the scout's report:
- The scout has already performed pre-classification using its IaC mapping table — do not re-run the mapping logic
- Validate pre-classified components: confirm suggested class names still exist on the platform via `mcp__dethereal__get_classes`
- Flag any components the scout could not pre-classify for manual review during the confirmation step

### 4. Present Sources-Checked Summary

Show which source categories were checked and results:

```
Sources checked: Code (3), IaC/Terraform (12), Containers (3), K8s (—), API defs (1), Network (—), CI/CD (2), DB schemas (—), Env files (1), Diagrams (—), Docs (2)
```

### 5. Present Batch Confirmation Table

Show a single confirmation table for all discovered elements:

```
| # | Name | Type | Class | Confidence | Include? |
|---|------|------|-------|------------|---------|
| 1 | API Gateway | PROCESS | API Gateway | high | Y |
| 2 | PostgreSQL | STORE | Database | high | Y |
| 3 | Redis | STORE | Key-Value Store | high | Y |
| 4 | Auth Service | PROCESS | — | medium | Y |
| 5 | CloudWatch | EXTERNAL_ENTITY | — | low | ? |

Also found 4 boundaries and 8 data flows (shown below).

Are any components missing? Should any be removed or reclassified?
Respond with changes or "looks good" to confirm.
```

Also present suggested boundaries and inferred data flows for confirmation.

### 6. Post-Discovery Interview

After user confirms the component list, run the **consolidated blind spots prompt** (one question, not five sequential ones):

```
Discovery found [confirmed list]. Code analysis systematically misses certain elements.
Are any of these relevant to your system?

1. Shared infrastructure — IdP, DNS, CA, log aggregator, SIEM, secret manager
2. Side-channel data flows — Logging pipelines, metrics, DNS resolution, backups
3. Deployment pipeline — CI/CD platform, container registries, artifact stores
4. Third-party SaaS — OAuth providers, payment processors, CDN, email/SMS
5. Human actors with privileged access — System admins, DBA, on-call engineers
6. Shared credentials — Service accounts used by multiple components, shared API keys,
   database credentials reused across services

List anything else I missed, or say "none" to continue.
```

Add any user-provided elements to the confirmed list.

### 7. Complexity Check

After final confirmation, check if the validated inventory exceeds decomposition thresholds:
- 21+ components → recommend decomposition
- 9+ trust boundaries → recommend decomposition
- 36+ data flows → recommend decomposition
- 19+ cross-boundary flows → recommend decomposition

If exceeded, follow the Decomposition Protocol in the threat-modeler agent:
- Default: recommend scope narrowing (start with highest-risk subsystem)
- Multi-system: offer decomposition plan

The recommendation is advisory — the user can proceed with a large model.

### 8. Write Discovery Output

Write full discovery provenance to `<model-path>/.dethereal/discovery.json` with a top-level envelope:

```json
{
  "version": 1,
  "timestamp": "ISO-8601",
  "sourcesChecked": { "code": 3, "iac": 12, "containers": 3, "kubernetes": 0, ... },
  "blindSpotsAsked": true,
  "userAddedElements": ["Log Aggregator", "Admin Portal"],
  "elements": [ /* per-element DiscoveredElement objects */ ]
}
```

Write or update model files with confirmed elements:
- `structure.json` — confirmed components and boundaries with coordinates (use layout guidelines from guidelines-layout.md)
- `dataflows.json` — confirmed data flows

If this is the first discovery in the project, write `.dethernety/discovery-cache.json` with the full raw inventory for potential multi-model reuse.

### 9. Update State

Update `<model-path>/.dethereal/state.json`:
- `currentState`: `DISCOVERED`
- `completedStates`: add `DISCOVERED`
- `lastModified`: current timestamp

### 10. Validate and Footer

Call `mcp__dethereal__validate_model_json` to check structural validity.

```
[done] Discovery complete. N components, M boundaries, K data flows confirmed. Quality: X/100.
[next] /dethereal:add (refine model structure) or /dethereal:classify (assign classes to components)
```
