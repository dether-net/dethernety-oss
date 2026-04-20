---
name: create
description: Create a new threat model from description, template, import, or platform pull
agent: threat-modeler
argument-hint: "[description or template]"
---

@../../docs/guidelines-layout.md
@../../docs/guidelines-schema.md
@../../docs/guidelines-examples.md

Create a new Dethernety threat model.

## Implementation Discipline

This skill is local-first: model files are created on disk now and synced to the platform later (via `/dethereal:sync`). Use built-in tools directly — do NOT invent scaffolding scripts, chained shell heredocs, or wrapper utilities.

| Operation | Tool to use |
|-----------|-------------|
| Create a directory | `Bash` with `mkdir -p <path>` |
| Write a JSON/Markdown file | `Write` tool, one call per file |
| Read an existing file | `Read` tool |
| Edit an existing file | `Edit` tool |
| Pull a model from platform (Pull mode only) | `mcp__dethereal__list_models` then `mcp__dethereal__export_model` |
| Validate the result | `mcp__dethereal__validate_model_json` |

**Do not:**
- Write a shell or Python script to scaffold the model — call `Write` once per file
- Use heredocs (`cat <<EOF > file.json`) — use `Write`, which produces a reviewable diff
- Call `mcp__dethereal__create_threat_model` from this skill — that tool requires platform auth and is invoked by `/dethereal:sync push` once the model is ready to publish

## Entry Points

If `$ARGUMENTS` is provided, infer the entry point from the content:
- Natural language description → **Describe** mode
- Path to IaC/config files → **Import** mode
- "template" or template name → **Template** mode
- "pull" or platform model reference → **Pull** mode

If no arguments, present all 4 options:

1. **Describe** — "Tell me about your system and I'll build the model"
2. **Template** — Start from a template (web application, API service, microservices)
3. **Import existing** — Point to Terraform, K8s manifests, or architecture docs
4. **Pull from platform** — Export an existing platform model to local files

## Onboarding Mode

If `.dethernety/models.json` does not exist or has no models, this is the user's first model. Use a welcoming tone, explain what a threat model captures, and provide extra guidance at each step.

## Steps

### 1. Scope Definition

Collect scope information through conversation. Ask naturally — don't present a form.

| Field | Required | Default | Guidance |
|-------|----------|---------|----------|
| `system_name` | yes | — | From description or ask |
| `description` | yes | — | 1-2 sentence architecture summary |
| `depth` | no | `architecture` | Options: architecture, design, implementation |
| `modeling_intent` | no | `initial` | Options: initial, security_review, compliance, incident_response |
| `compliance_drivers` | no | `[]` | Ask if not mentioned: "Any compliance requirements?" |
| `crown_jewels` | yes (≥1) | — | Ask: "What are the most valuable assets in this system?" |
| `exclusions` | no | `[]` | Ask if multi-system: "Anything explicitly out of scope?" |
| `trust_assumptions` | no | `[]` | Ask: "What do you explicitly trust? (e.g., cloud provider control plane, corporate network)" |
| `adversary_classes` | no | — | Only for security_review or incident_response intent |

Write scope to `<model-path>/.dethereal/scope.json`.

### 2. Build Model Structure

Based on entry point:

**Describe / Template:**
- Parse the description to identify components, trust boundaries, and data flows
- Apply boundary hierarchy rules from guidelines-core.md (never flatten)
- Present a confirmation table:
  ```
  Components:
    1. [PROCESS] API Server — in Internal Network
    2. [STORE] PostgreSQL — in Data Tier
    3. [EXTERNAL_ENTITY] End Users — in Internet Zone

  Boundaries:
    Internet Zone / DMZ / Internal Network / Data Tier

  Data Flows:
    1. End Users → API Gateway: HTTP requests
    2. API Gateway → API Server: Internal API calls
    3. API Server → PostgreSQL: SQL queries

  Confirm or adjust?
  ```

**Import existing:**
- Read IaC/config files from the specified path
- For complex codebases, delegate to `Agent(infrastructure-scout)` for thorough scanning
- Present discovered components for confirmation

**Pull from platform:**
- Call `mcp__dethereal__list_models` to show available platform models
- After user selection, call `mcp__dethereal__export_model` to pull the model
- Register locally and bootstrap state (see Sync skill for state inference)

### 3. Write Model Files

Default path: `./threat-models/<kebab-case-name>/`.

1. Create the directory tree with one Bash call:
   ```
   Bash: mkdir -p <model-path>/.dethereal
   ```
2. Write each file individually with the `Write` tool — one tool call per file. No heredocs. No scaffolding scripts.

| File | Content |
|------|---------|
| `<model-path>/manifest.json` | Model metadata: name, description, module references, files map |
| `<model-path>/structure.json` | Boundary and component hierarchy with coordinates |
| `<model-path>/dataflows.json` | Data flow connections array |
| `<model-path>/data-items.json` | `[]` initially |
| `<model-path>/.dethereal/scope.json` | Scope definition from Step 1 |
| `<model-path>/.dethereal/state.json` | `{ "currentState": "SCOPE_DEFINED", "completedStates": ["INITIALIZED", "SCOPE_DEFINED"], "lastModified": "<ISO 8601>", "staleElements": [] }` |

Use layout guidelines (imported above) for coordinate placement:
- Position boundaries to avoid overlap with 50px padding
- Components are 150x150px, positioned relative to parent boundary
- Primary flow direction: left-to-right or top-to-bottom

### 4. Register Model

Use `Read` to load `.dethernety/models.json` at the project root if it exists, then `Write` an updated version. If it does not exist, `Write` a new file:

```json
{
  "version": 1,
  "models": [
    { "name": "Model Name", "path": "./threat-models/model-name", "createdAt": "ISO timestamp" }
  ]
}
```

Append the new model entry to the existing `models` array (preserve existing entries).

### 5. Validate

Call `mcp__dethereal__validate_model_json` to check structural validity.

### 6. Generate README

Write `README.md` in the model directory per the threat-modeler's README Generation Protocol:

- `# <Model Name>` with `> Auto-generated by Dethereal. Do not edit.`
- Tree view of model structure (boundaries → components hierarchy)
- Data flow list (source → target: description)
- Quality status: `Quality: X/100 (Label)`
- Generated timestamp

At create time, the README reflects the initial structure. It will be regenerated with richer content when the guided workflow (`/dethereal:threat-model`) completes.

### 7. Post-Action Footer

```
[done] Model "System Name" created with N components, M data flows. Quality: X/100.
[next] /dethereal:discover (scan codebase for additional infrastructure)
```

If this is the user's first model, add:
```
Run /dethereal:help to see all available commands.
```
