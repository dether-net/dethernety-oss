# Dethereal Claude Code Plugin -- Architecture Specification

> Target architecture for the Dethereal plugin: a comprehensive Claude Code plugin for professional Dethernety threat modeling.

## Table of Contents

- [1. Vision and Scope](#1-vision-and-scope)
- [2. Plugin Structure](#2-plugin-structure)
- [3. Skills (Slash Commands)](#3-skills-slash-commands)
- [4. Subagent Architecture](#4-subagent-architecture)
- [5. MCP Server](#5-mcp-server)
- [6. Hooks](#6-hooks)
- [7. Settings and Configuration](#7-settings-and-configuration)
- [8. Architecture Decision: MCP vs Skills for Documentation](#8-architecture-decision-mcp-vs-skills-for-documentation)
- [9. Implementation Phases](#9-implementation-phases)

---

## 1. Vision and Scope

### What It Is

The Dethereal plugin transforms Claude Code into a professional threat modeling workstation. Users install the plugin into their Claude project and gain:

- **Skills** (slash commands) for guided and ad-hoc threat modeling workflows
- **Subagents** specialized for discovery, modeling, enrichment, and review
- **MCP server** for authenticated communication with the Dethernety platform
- **Hooks** for auto-validation, context preservation, and workflow automation

### What It Does

The plugin assists users to perform the full data flow model creation lifecycle:

1. **Discover** infrastructure components from IaC, code, configs, and architecture diagrams
2. **Model** data flow diagrams with components, trust boundaries, and data flows
3. **Classify** components using module-provided classes from the Dethernety platform
4. **Enrich** with security attributes, MITRE ATT&CK technique mappings, and controls
5. **Validate** model completeness and quality
6. **Sync** local filesystem models with the Dethernety platform

### What It Does Not Do

- **Analysis** -- The plugin creates data flow models; analysis is performed by platform modules (attack scenario analysis, copilot, etc.). The plugin may trigger analysis but does not implement analysis logic.
- **Replace the web UI** -- The Dethernety web UI provides visual DFD editing and analysis dashboards. The plugin complements it for code-aware, CLI-first workflows.

### Design Principles

| Principle | Rationale |
|-----------|-----------|
| **Efficiency first** | Minimize tool calls, embed static knowledge in agent prompts, batch user confirmations |
| **Human-in-the-loop** | Never auto-import models. Present discovered elements for review. Never auto-classify data sensitivity. |
| **Grounded, not hallucinated** | MITRE references come from the platform's graph database, not LLM memory. Every model element must be evidenced. |
| **Methodology as lens** | The underlying data model is methodology-agnostic. Methodologies (STRIDE, PASTA) are interpretive overlays. |
| **Offline-capable** | Support local model creation without a platform connection. Class definitions cached locally. Sync when ready. |

---

## 2. Plugin Structure

### Directory Layout

```
oss/apps/dethereal/
├── .claude-plugin/
│   └── plugin.json                    # Plugin manifest
├── agents/
│   ├── threat-modeler.md              # Primary modeling agent
│   ├── infrastructure-scout.md        # Discovery/recon agent
│   ├── security-enricher.md           # MITRE/exposure/control agent
│   └── model-reviewer.md             # Validation and review agent
├── skills/
│   ├── status/
│   │   └── SKILL.md                   # /dethereal:status
│   ├── login/
│   │   └── SKILL.md                   # /dethereal:login
│   ├── help/
│   │   └── SKILL.md                   # /dethereal:help
│   ├── create/
│   │   └── SKILL.md                   # /dethereal:create (+ onboarding for first model)
│   ├── discover/
│   │   └── SKILL.md                   # /dethereal:discover
│   ├── add/
│   │   └── SKILL.md                   # /dethereal:add
│   ├── remove/
│   │   └── SKILL.md                   # /dethereal:remove
│   ├── enrich/
│   │   └── SKILL.md                   # /dethereal:enrich
│   ├── classify/
│   │   └── SKILL.md                   # /dethereal:classify
│   ├── sync/
│   │   └── SKILL.md                   # /dethereal:sync (push|pull|status)
│   ├── review/
│   │   └── SKILL.md                   # /dethereal:review (+ structural validation)
│   ├── threat-model/
│   │   ├── SKILL.md                   # /dethereal:threat-model (guided workflow)
│   │   └── template.md               # Step-by-step process template
│   ├── view/
│   │   └── SKILL.md                   # /dethereal:view
│   └── surface/
│       └── SKILL.md                   # /dethereal:surface
├── hooks/
│   └── hooks.json                    # Hook definitions (SessionStart, PostToolUse, PreCompact)
├── scripts/
│   ├── first-session-check.sh        # Conditional first-session orientation
│   ├── post-write-validate.sh        # Auto-validate after model file edits
│   └── pre-compact-summary.sh        # Model state summary for context preservation
├── docs/
│   ├── guidelines-core.md            # Core modeling rules (component types, structure, boundaries) — always loaded
│   └── guidelines-layout.md          # Layout/coordinate rules (pixel dimensions, handles) — loaded only during editing
├── .mcp.json                          # MCP server configuration
├── settings.json                      # Plugin settings
├── src/                               # MCP server source (existing + new tools)
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

### Model Storage

Models are stored at user-chosen visible paths (e.g., `./threat-models/production-stack/`). The SplitModel format (`manifest.json`, `structure.json`, etc.) lives at the user-chosen model path.

**`.dethernety/`** at the project root is plugin metadata only:
- `models.json` -- registry of model paths
- `config.json` -- plugin configuration
- `discovery-cache.json` -- shared discovery results across models in multi-model projects (D55). Saves 15-25K tokens per subsequent model.
- `decomposition-plan.json` -- optional: planned models, completion status, cross-model links (D58). Written when user accepts a decomposition recommendation.

**Per-model metadata** in `<model-path>/.dethereal/`:
- `state.json` -- current model state
- `discovery.json` -- discovery provenance
- `quality.json` -- quality scores
- `scope.json` -- scope definition
- `audit_trail.json` -- change history

> **Naming distinction:** `.dethernety/` (project root) = plugin-level metadata (model registry, config). `.dethereal/` (per-model) = per-model workflow metadata (state, discovery, quality). The names differ intentionally — `.dethernety/` relates to the platform, `.dethereal/` relates to the plugin.

### Plugin Manifest (`.claude-plugin/plugin.json`)

```json
{
  "name": "dethereal",
  "version": "1.0.0",
  "description": "Professional threat modeling for Claude Code. Discover infrastructure, build data flow diagrams, enrich with MITRE ATT&CK, and sync with the Dethernety platform.",
  "author": {
    "name": "Dether Labs",
    "url": "https://dethernety.io"
  },
  "homepage": "https://github.com/dether-net/dethernety-oss",
  "repository": "https://github.com/dether-net/dethernety-oss",
  "license": "Apache-2.0",
  "keywords": [
    "threat-modeling",
    "cybersecurity",
    "mitre-attack",
    "data-flow-diagram",
    "security-analysis"
  ]
}
```

### MCP Server Configuration (`.mcp.json`)

```json
{
  "mcpServers": {
    "dethereal": {
      "type": "stdio",
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/index.js"],
      "env": {
        "DETHERNETY_URL": "${DETHERNETY_URL}",
        "CLAUDE_PLUGIN_DATA": "${CLAUDE_PLUGIN_DATA}"
      }
    }
  }
}
```

> `DETHERNETY_URL` is inherited from the user's shell environment. The MCP server falls back to `http://localhost:3003` internally if unset.

---

## 3. Skills (Slash Commands)

### Skill Categories

#### Getting Started

| Skill | Description | Arguments |
|-------|-------------|-----------|
| `/dethereal:status` | Connection status, auth state, local model summary | -- |
| `/dethereal:login` | Authenticate with the Dethernety platform | -- |
| `/dethereal:help` | List all skills with descriptions | -- |

#### Model Lifecycle

| Skill | Description | Arguments |
|-------|-------------|-----------|
| `/dethereal:create` | Create a new threat model (includes onboarding for first model) | `[description or template name]` |
| `/dethereal:sync` | Push local model to platform or pull platform model to local | `push\|pull\|status [directory-path]` |
| `/dethereal:view` | Render model summary or YAML view | `[model-path] [--format yaml\|json\|tree]` |

> D44: `/dethereal:start` merged into `/dethereal:create` (onboarding mode detected when no models exist). `/dethereal:import` and `/dethereal:export` merged into `/dethereal:sync push` and `/dethereal:sync pull`. `/dethereal:validate` merged into `/dethereal:review --structure-only`.

#### Model Editing

| Skill | Description | Arguments |
|-------|-------------|-----------|
| `/dethereal:discover` | Auto-discover infrastructure from codebase | `[scope: terraform\|k8s\|docker\|code\|diagram\|auto] [path]` |
| `/dethereal:add` | Add components, boundaries, flows, or data items | `[element description]` |
| `/dethereal:remove` | Remove elements with dependency checking | `[element reference]` |
| `/dethereal:enrich` | Add real configuration data to components | `[classify\|expose\|control\|mitre\|auto]` |
| `/dethereal:classify` | Apply classes to unclassified elements | `[--type components\|flows\|boundaries]` |

#### Analysis and Review

| Skill | Description | Arguments |
|-------|-------------|-----------|
| `/dethereal:review` | Model completeness, quality dashboard, and structural validation | `[directory-path] [--structure-only]` |
| `/dethereal:surface` | Attack surface summary with control gap analysis | `[directory-path]` |
| `/dethereal:threat-model` | Full guided workflow (scope through validation) | `[system description]` |

### Skill Design Principles

1. **Every skill works with zero arguments** -- invokes an interactive guided mode
2. **Arguments are shortcuts**, not requirements
3. **Skills present batch confirmations** -- "I found N items, review this table" rather than N individual prompts
4. **Skills suggest next steps** after completing an action
5. **Skills delegate to agents** for complex multi-turn operations
6. **Model resolution:** When multiple models exist, skills resolve the target model: (1) if `directory-path` argument provided, use it; (2) if `.dethernety/models.json` lists exactly one model, use it implicitly; (3) if multiple models exist, prompt the user to select from a numbered list; (4) if no models exist, suggest `/dethereal:create`
7. **Skills read from disk at invocation** -- never rely on in-conversation memory of model content. Always read current model state from files at the start of execution

### Skill Frontmatter Summary

| Skill | `user-invocable` | `agent` | `context` | `argument-hint` | Notes |
|-------|:-:|---------|---------|-----------------|-------|
| `status` | yes | -- | -- | -- | Reads files and calls MCP tools |
| `login` | yes | -- | -- | -- | Calls `mcp__dethereal__login` |
| `help` | yes | -- | -- | -- | Runs `help-context.js` helper |
| `create` | yes | threat-modeler | -- | `[description or template]` | Onboarding mode when no models exist |
| `discover` | yes | threat-modeler | -- | `[scope] [path]` | Delegates scanning to Agent(infrastructure-scout); threat-modeler handles file writes per subagent write convention |
| `add` | yes | threat-modeler | -- | `[element description]` | |
| `remove` | yes | threat-modeler | -- | `[element reference]` | |
| `enrich` | yes | security-enricher | -- | `[classify\|expose\|control\|mitre\|auto]` | |
| `classify` | yes | security-enricher | -- | `[--type components\|flows\|boundaries]` | |
| `sync` | yes | -- | -- | `push\|pull\|status [directory-path]` | `disable-model-invocation: true` |
| `review` | yes | model-reviewer | fork | `[directory-path] [--structure-only]` | Includes structural validation |
| `surface` | yes | model-reviewer | fork | `[directory-path]` | |
| `threat-model` | yes | threat-modeler | -- | `[system description]` | Primary guided workflow |
| `view` | yes | -- | -- | `[model-path] [--format]` | Reads model files and formats output |

> Skills with `context: fork` run in a forked context and do not pollute the main conversation. Skills with `disable-model-invocation: true` (currently only `sync`) are scripted operations that do not need LLM reasoning. Most skills (status, login, help, view, etc.) need LLM processing to read files, call MCP tools, and format output — they do NOT use `disable-model-invocation`. Skills with `agent` delegate to the named subagent for complex multi-turn operations. The `effort` field is set on agents, not on skills — the agent's `effort` governs reasoning depth when the skill delegates to it (D44: removed redundant `effort` from skill frontmatter).

> D44: `sync` uses `disable-model-invocation: true` because push/pull are scripted MCP tool operations that do not need LLM reasoning or the threat-modeler agent's modeling context.

### Key Skill: `/dethereal:threat-model` (Guided Workflow)

This is the "golden path" -- a template-driven skill that orchestrates the full threat modeling process:

1. **Scope Definition** -- System description, modeling intent, compliance drivers, crown jewels
2. **Discovery** -- Delegates to `infrastructure-scout` agent for auto-discovery
3. **Model Review** -- Presents discovered components for confirmation. Runs `get_classes(action: 'classify_components')` to pre-fill high-confidence classifications in the confirmation table (R6/F6: deterministic pass only, saves 3-5K tokens at Step 6). **After confirmation, if validated inventory exceeds complexity thresholds (D55/D56), presents decomposition recommendation** — scope narrowing (default) or decomposition plan, per D57. See THREAT_MODELING_WORKFLOW.md Section 9.
4. **Boundary Refinement** -- Identifies and organizes trust boundaries. For each boundary, prompts for enforcement status: "Is this boundary enforced by network controls?" Captures `implicit_deny_enabled` and `allow_any_inbound` attributes (see OPERATIONAL_REQUIREMENTS.md Section 1). If platform models exist and user is connected, prompts for `representedModel` links using `getNotRepreseningModels(modelId)` (D59).
5. **Data Flow Mapping** -- Connects components with data flows. Data flow attributes include `auth_failure_mode: "deny" | "fallback" | "fail_open" | "unknown"`. Flows with `fail_open` or `fallback` generate an inline warning during enrichment.
6. **Classification** -- Assigns classes from platform modules. High-confidence matches are pre-filled from Step 3; this step handles low-confidence and ambiguous cases using boundary context (R6/F6)
7. **Data Item Classification** -- Classifies data sensitivity on flows
8. **Enrichment** -- Populates security-relevant attributes. Components are prioritized by security impact: crown jewels first, then cross-boundary components, then internet-facing, then internal-only. Users can choose to enrich tier 1 only (crown jewels) for a quick analysis pass.
9. **Validation** -- Quality gate check
10. **Sync** -- Push to platform
11. **Post-sync linking** -- If countermeasures exist, read back platform-computed exposures and present a batch linking table. If the user defers, warn that unlinked controls will not be credited in analysis defense coverage (R6/F3)

The skill uses `agent: threat-modeler` in its frontmatter so the specialized modeling agent handles the conversation.

> **Session break at STRUCTURE_COMPLETE (D65):** After Steps 4-5, the guided workflow presents a checkpoint. The behavior is calibrated to model size:
>
> - **Small models (< 15 components):** Suggest break but allow continuation without warning: *"Your model structure is complete and saved. You can continue enrichment now or resume later — your progress is saved."*
> - **Large models (15+ components):** Warn about quality degradation: *"Your model structure is complete and saved. For models this size, starting enrichment in a fresh session produces better results (the enrichment phase reads model files from disk and doesn't need the discovery context). Continue now? (yes / later)"*
>
> If the user chooses to continue on a large model, proceed without re-asking. The warning is informational, not blocking. This avoids carrying 50-80K tokens of scope/discovery/boundary conversation history into the enrichment phase. For 15+ component models, enrichment in a fresh session saves ~25-40% of cumulative token cost. The plugin should also recommend a git commit at this checkpoint: *"Consider committing your model before enrichment — this gives you a clean revert point."* (D65)

### `/dethereal:help` Output

The help output is **state-aware** — it shows a "Suggested now" section based on current model state, reducing cognitive load from 14 commands to 2-3 relevant ones. This saves LLM tokens by preempting "what should I do next?" follow-ups. The state detection uses `disable-model-invocation: true` — the logic is implemented in a helper script (`scripts/help-context.js`) invoked via `` !`command` `` shell substitution.

```
Dethereal -- Threat Modeling for Claude Code

Suggested now (model "Production Stack" at 41/100 quality):
  /dethereal:classify     2 unclassified components (biggest quality gain)
  /dethereal:enrich       Fill security attributes
  /dethereal:review       See full quality breakdown

All commands:
  Getting Started:    status, login, help
  Modeling:           create, discover, add, remove
  Enrichment:         classify, enrich
  Review and Sync:    review, sync, surface, view

Full Workflow:
  /dethereal:threat-model   Guided end-to-end process

Type /dethereal:help <command> for detailed usage.
```

When no model exists, "Suggested now" shows only `create` and `discover`. When no platform connection, it omits sync-related suggestions. The state detection reads `.dethernety/models.json` and `<model-path>/.dethereal/quality.json`.

---

## 4. Subagent Architecture

### Agent Definitions

#### `threat-modeler` -- Primary Modeling Agent

**Purpose:** Creates and edits Dethernety threat models through conversation.

**Tools:** Read, Write, Edit, Glob, Grep, Bash, Agent(infrastructure-scout), Agent(security-enricher), Agent(model-reviewer), `mcp__dethereal__*`

**Frontmatter:**

```yaml
---
name: threat-modeler
description: Creates and edits Dethernety threat models through guided conversation
model: inherit
effort: high
memory: project
tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - Agent(infrastructure-scout)
  - Agent(security-enricher)
  - Agent(model-reviewer)
  - mcp__dethereal__*
---
```

**Key characteristics:**
- Embeds core modeling guidelines from `docs/guidelines-core.md` via `@` import (component types, model structure, boundary constraints). Layout guidelines (`docs/guidelines-layout.md`) are loaded only by editing skills (`/dethereal:create`, `/dethereal:add`, `/dethereal:threat-model`) via skill body `@` import (D47).
- **Do not call `get_model_schema`** — modeling guidelines are already loaded in context via `@` import. Calling the tool would duplicate ~15KB of content.
- Validates after every model modification
- Defaults to the conservative security interpretation (unencrypted until proven encrypted)
- States assumptions explicitly and never silently modifies user decisions

**Subagent write convention:** The `infrastructure-scout` returns structured data (discovery report); the calling skill/orchestrator writes model files. The `security-enricher` writes directly to model attribute files (it has Write/Edit access). The `model-reviewer` is read-only.

#### `infrastructure-scout` -- Discovery Agent

**Purpose:** Scans codebases for infrastructure components, identifies trust boundaries, and produces draft model skeletons.

**Tools:** Read, Glob, Grep, Bash, `mcp__dethereal__get_classes`
Bash is permitted for read-only inspection commands (listing containers, parsing configs, checking service versions) but must not modify files or project state.
**Disallowed tools:** Write, Edit (read-only -- the calling skill handles file writing)

**Frontmatter:**

```yaml
---
name: infrastructure-scout
description: Scans codebases for infrastructure components and produces draft model skeletons
model: inherit
effort: medium
maxTurns: 30
tools:
  - Read
  - Glob
  - Grep
  - Bash
  - mcp__dethereal__get_classes
---
```

> `get_model_schema` is intentionally excluded — the scout discovers components, it does not create model files. Component type information (PROCESS, STORE, EXTERNAL_ENTITY) needed for discovery is embedded in the scout's agent prompt body. This avoids a ~4,000-token tool response per discovery session.

**Security constraint:** When scanning `.env` files, config maps, or connection strings, the agent must extract only variable NAMES and endpoint information (hostnames, ports, protocols). It must NEVER include secret VALUES (passwords, API keys, tokens, private keys) in discovery output or conversation context.

**Discovery sources:**
- IaC: Terraform, CloudFormation, Pulumi, CDK
- Containers: Docker, Kubernetes, Helm
- Application code: API definitions, service mesh configs, auth middleware, database connections
- Architecture diagrams: Screenshots analyzed via Claude vision
- Configs: `.env` files, environment variable references, CI/CD pipelines

**Output:** Structured discovery report with confidence levels (high/medium/low) and source provenance for each discovered element.

#### `security-enricher` -- MITRE / Security Agent

**Purpose:** Enriches threat models with MITRE ATT&CK techniques, D3FEND countermeasures, security controls, and exposure identification.

**Tools:** Read, Write, Edit, `mcp__dethereal__*`

**Frontmatter:**

```yaml
---
name: security-enricher
description: Enriches threat models with security attributes, MITRE ATT&CK/D3FEND references, and control identification
model: inherit
effort: high
maxTurns: 40
tools:
  - Read
  - Write
  - Edit
  - mcp__dethereal__*
---
```

> R6/F7: `maxTurns: 40` bounds enrichment sessions. Enrichment is proportional to component count (6 attributes per component + credential topology), not open-ended. For a 20-component model, 40 turns provides sufficient headroom while preventing runaway sessions.

**Key characteristics:**
- Never generates MITRE technique IDs from memory -- always queries the platform's graph database
- Presents enrichment suggestions in batches for user confirmation
- Prioritizes security-critical attributes (auth, TLS, encryption at rest, logging, access control)

#### `model-reviewer` -- Validation Agent

**Purpose:** Audits threat models for completeness, correctness, and security coverage. Produces quality reports.

**Tools:** Read, Glob, Grep, `mcp__dethereal__validate_model_json`, `mcp__dethereal__get_classes`, `mcp__dethereal__manage_exposures`, `mcp__dethereal__manage_countermeasures`
**Disallowed tools:** Write, Edit, Bash (read-only reviewer)

**Frontmatter:**

```yaml
---
name: model-reviewer
description: Read-only auditor producing quality reports and readiness assessments
model: inherit
effort: medium
maxTurns: 15
tools:
  - Read
  - Glob
  - Grep
  - mcp__dethereal__validate_model_json
  - mcp__dethereal__get_classes
  - mcp__dethereal__manage_exposures
  - mcp__dethereal__manage_countermeasures
---
```

> `manage_countermeasures` and `manage_exposures` are action-based tools that include both read and write actions (list/get/create/update/delete). The reviewer only needs read access (list/get). This is a **known soft constraint (R8)**: the read-only mandate is enforced by the agent prompt, not by tool-level access control. Claude Code's `tools` allowlist controls tool-level access, not action-level access. Splitting these into separate read-only tools was considered but rejected — it adds 4 more tool schemas (~2K tokens) to every context for a low-probability risk. The reviewer's focused prompt and `maxTurns: 15` make prompt-violation unlikely in practice.

**Checks performed:**
- Structural validity (pass/fail)
- Component classification rate
- Attribute completion rate
- Trust boundary hierarchy quality
- Data flow coverage (orphaned components)
- Data classification on sensitive flows
- Common gap detection (missing admin access, monitoring, backup flows)

### Agent Interaction Pattern

```
User
  |
  v
/dethereal:threat-model (skill, agent: threat-modeler)
  |
  v
threat-modeler (orchestrator for full workflow)
  |
  +--> Agent(infrastructure-scout)       -- discovery phase
  |       Passes: model directory path
  |       Returns: element count summary + file path written (compact)
  |
  |    threat-modeler handles directly   -- refinement phase
  |       Reads: discovery output from disk
  |       Returns: complete model files
  |
  +--> Agent(security-enricher)          -- enrichment phase
  |       Passes: model directory path
  |       Returns: count of enriched elements + quality delta (compact)
  |
  +--> Agent(model-reviewer)             -- validation phase
          Passes: model directory path
          Returns: quality score + top 3 issues (compact)
```

**Subagent return contracts:** Subagent delegations pass the model directory path, not serialized model content. Each subagent reads current state from disk. Return payloads are compact summaries — the orchestrator reads files for details. This prevents 2,000-8,000 tokens of redundant model content in delegation round-trips.

The `threat-modeler` is the orchestrating agent (set via skill `agent` frontmatter). It delegates to the other three agents via `Agent()` tool calls and handles the refinement phase directly. Individual skills (`/dethereal:discover`, `/dethereal:enrich`, etc.) invoke their respective agent directly via skill `agent` frontmatter.

### Platform Feature Adoption

| Feature | Usage | Priority | Phase |
|---------|-------|----------|-------|
| `effort` | Reasoning depth per agent -- `medium` for bounded tasks, `high` for complex modeling | High | V1 |
| `maxTurns` | Safety bounds on subagent operations -- prevents runaway loops | High | V1 |
| `context: fork` | Read-only skills (`review`, `surface`) run in forked context, don't pollute main conversation | Medium | V1 |
| `memory: project` | Cross-session learning for `threat-modeler` agent preferences | Medium | V1 |
| `background` | Async discovery on large codebases via `infrastructure-scout`. Add `background: true` to `infrastructure-scout` frontmatter when supported. | Medium | V1.1 |
| `Notification` hook | Desktop alert when long operations (sync, discovery) complete | Low | V1.1 |
| Elicitation capability | Structured input forms for scope definition, classification choices (observed via `Elicitation`/`ElicitationResult` hooks) | Low | V2 |
| Plugin channels | Platform webhook push events (analysis complete, new exposures) into Claude Code sessions | Low | V2 |

> `/dethereal:review` and `/dethereal:surface` should use `context: fork` in their skill frontmatter. `/dethereal:status` uses `disable-model-invocation: true` (no LLM context to fork).

---

## 5. MCP Server

> **Detailed MCP server architecture:** See [MCP_ARCHITECTURE.md](MCP_ARCHITECTURE.md) for the full target architecture — tool execution flow, class hierarchy, auth flow diagrams, dt-core integration, data flow diagrams, security model, configuration, and migration plan. This section summarizes the tool inventory and key design decisions.

### Existing Tools (Retained)

| Tool | Auth | Purpose |
|------|------|---------|
| `login` | No | Browser-based OAuth PKCE authentication |
| `logout` | No | Clear cached tokens |
| `refresh_token` | No | Refresh expired tokens |
| `get_model_schema` | No | Schema + modeling guidelines |
| `get_example_models` | No | Example model templates |
| `validate_model_json` | No | Offline structural validation + quality score computation. Input: `{ action: 'validate'\|'quality', directory_path: string }`. `validate` = structural checks, `quality` = quality score computation |
| `get_classes` | Yes | Query available classes from installed modules |
| `create_threat_model` | Yes | Import local model to platform |
| `import_model` | Yes | Import model from directory |
| `export_model` | Yes | Export platform model to directory |
| `update_model` | Yes | Update existing model structure |
| `update_attributes` | Yes | Update element attributes only |

### New Tools

#### MITRE Framework Tools

**`search_mitre_attack`** -- Search and browse ATT&CK techniques, tactics, and mitigations (D26).

Input: `{ action: 'search'|'tactics'|'techniques_by_tactic'|'technique'|'mitigations'|'mitigation', search?: string, tactic_id?: string, attack_id?: string }`

| Action | API Method | Notes |
|--------|-----------|-------|
| `search` | `findMitreAttackTechniques` | Free-text `search` string translated to GraphQL name filter. Results capped at 20. |
| `tactics` | `getMitreAttackTactics` | No params, returns all tactics. |
| `techniques_by_tactic` | `getMitreAttackTechniquesByTactic` | Requires `tactic_id` (e.g., "TA0001"). |
| `technique` | `getMitreAttackTechnique` | Requires `attack_id` (e.g., "T1190"). Used for ID validation. |
| `mitigations` | `getMitreAttackMitigations` | No params, returns all mitigations. |
| `mitigation` | `getMitreAttackMitigation` | Requires `attack_id` (e.g., "M1036"). |

Wraps `DtMitreAttack` dt-core class methods. The `search` action translates free-text to a GraphQL name filter internally — agents use natural language queries (e.g., "credential theft") and the MCP tool handles the translation. The `technique` action with `attack_id` enables ID validation (confirm a technique exists before annotating), serving as the anti-hallucination guardrail. Note: `name` filtering is applied client-side; if search returns more than 20 results, the agent should refine the query with component-specific context.

> The plugin provides `search_mitre_attack` for user-initiated reference browsing. Systematic technique-to-component mapping (STRIDE-to-ATT&CK evaluation) is performed by analysis modules, not the plugin.

**`get_mitre_defend`** -- Browse D3FEND defensive techniques (D24).

Input: `{ action: 'tactics' | 'techniques_by_tactic' | 'technique', tactic_id?: string, d3fend_id?: string }`

Wraps `DtMitreDefend` dt-core class methods. Renamed from `search_mitre_defend` because the underlying `DtMitreDefend` class has no text search capability — only tactic listing, technique-by-tactic browsing, and technique lookup by ID. The Analysis Engine V2 provides semantic D3FEND search via its own `search_defend_techniques` tool (backed by PostgreSQL pgvector). Adding `findMitreDefendTechniques` to dt-core (matching the ATT&CK pattern) is a worthwhile fast-follow.

#### Security Element Tools

**`manage_exposures`** -- Read-only access to platform-computed exposures (D25).

Input: `{ action: 'list'|'get', element_id?: string, exposure_id?: string }`

Wraps `DtExposure` dt-core class. **Create/update/delete are analysis module features**, not plugin capabilities. Exposures are computed by OPA/Rego policy evaluation on the platform — plugin-created exposures would pollute the analysis engine's evidence chain (`Component → HAS_EXPOSURE → Exposure → EXPLOITED_BY → Technique`) with unverified claims.

After model import, the plugin reads back computed exposures: "12 exposures found on your model. Run analysis for full findings and remediation roadmaps." Manual exposure entry (pentest findings) belongs in a dedicated import module with explicit `source: "manual"` provenance.

**`manage_controls`** -- CRUD for security controls.

Input: `{ action: 'list'|'get'|'create'|'update'|'delete', control_id?: string, control?: {...}, class_ids?: string[] }`

`class_ids` behavior per action: for `list`, filters controls by class IDs; for `create`/`update`, assigns `DTControlClass` class IDs to the control instance. Use `get_classes(type: 'DTControlClass')` to retrieve available control class definitions.

Wraps `DtControl` dt-core class.

**`manage_countermeasures`** -- Link controls to exposures via countermeasures.

Input:
```
{
  action: 'list' | 'get' | 'create' | 'update' | 'delete',
  element_id?: string,           // required for 'list'
  countermeasure_id?: string,    // required for 'get', 'update', 'delete'
  countermeasure?: {             // required for 'create', optional for 'update'
    name: string,
    type: string,                // "preventive" | "detective" | "corrective"
    category: string,            // e.g., "access-control", "encryption", "monitoring"
    description?: string,
    score?: number,              // effectiveness 0-100, defaults to 50
    exposure_ids?: string[],     // links to addressed exposures
    defend_technique_ids?: string[],
    mitigations?: string[],      // ATT&CK mitigation references
    references?: string[]
  }
}
```

Note that `type` and `category` are required for creation; `score` defaults to 50.

Wraps `DtCountermeasure` dt-core class. Critical for the enrichment workflow connecting controls to exposures.

> **Temporal dependency (R6/F3):** Countermeasures created before model import will not have `exposure_ids` (no exposures exist yet). Without linking, the Analysis Engine's defense coverage gap analysis (Strategy C) will not credit these controls — a well-controlled system appears under-protected. The guided workflow handles this in Step 11: after sync, if the model has countermeasures, read back platform-computed exposures via `manage_exposures(action: 'list')` and present a batch linking table: "The platform found N exposures. I'll match them to your existing controls. Please confirm." If the user defers, warn: "Your controls exist but are not linked to specific exposures. Analysis will undercount your defenses."

#### Model Discovery Tool

**`list_models`** -- List threat models on the platform.

Input: `{ folder_id?: string, name?: string }`

Wraps `DtModel.getModels()`. Currently missing from the tool set -- there is no way to discover what models exist on the platform.

Note: `name` filtering is applied client-side after fetching. The backend API (`DtModel.getModels`) only supports `folderId` filtering.

#### Analysis Tools

**`manage_analyses`** -- List analysis classes, create/run analyses, get results.

Input: `{ action: 'list_classes'|'list'|'create'|'run'|'status'|'results'|'delete', model_id?: string, analysis_id?: string }`

Wraps `DtAnalysis` dt-core class. Note: streaming/subscription-based result delivery cannot work through stateless MCP tool calls -- the `run` action returns a session ID for polling.

**Polling contract:**
- `action: 'run'` returns `{ session_id, status: 'started' }`
- `action: 'status'` with `{ analysis_id }` returns `{ status: 'running'|'completed'|'failed', progress?: { completed_tasks: number, total_tasks: number, current_phase: string } }`
- `action: 'results'` with `{ analysis_id }` returns results when complete, otherwise `{ status: 'running', retry_after_seconds: 5 }`

### Tool Count Summary

| Category | Tools | Count |
|----------|-------|-------|
| Auth | `login`, `logout`, `refresh_token` | 3 |
| Reference | `get_model_schema`, `get_example_models` | 2 |
| Validation | `validate_model_json` | 1 |
| Model CRUD | `create_threat_model`, `import_model`, `export_model`, `update_model`, `list_models` | 5 |
| Element Management | `get_classes`, `update_attributes`, `generate_attribute_stubs` | 3 |
| MITRE | `search_mitre_attack`, `get_mitre_defend` | 2 |
| Security | `manage_exposures`, `manage_controls`, `manage_countermeasures` | 3 |
| Analysis | `manage_analyses` | 1 |
| **Total** | | **20** |

> **Output size constraint:** MCP tool output is limited to ~10,000 tokens. Tools returning large payloads (e.g., `get_model_schema`, `export_model`) should paginate, summarize, or write to disk and return a file path. The hybrid approach of embedding guidelines in agent prompts (rather than returning them from tools) mitigates this for schema tools.

> **Quality ceiling without controls/credentials:** A model with zero controls and zero credentials can score at most 85/100 (the `control_coverage_rate` 10% and `credential_coverage_rate` 5% factors are zero). This exceeds the analysis readiness threshold of 70. The `/dethereal:review` improvement suggestions should not recommend adding controls until the other 5 factors are maximized.
>
> **Analysis readiness caveat (R6/F8):** The plugin quality score measures structural completeness. The Analysis Engine evaluates additional dimensions — without credential data, lateral movement traversal degenerates to BFS (D22); without controls, defense coverage gap analysis produces no results. When quality exceeds 70 but `control_coverage_rate` = 0 and `credential_coverage_rate` = 0, `/dethereal:review` should add: *"Your model is structurally ready for analysis, but analysis quality will improve significantly with credentials (for lateral movement paths) and controls (for defense coverage gaps)."* When connected to the platform post-sync, display both plugin and engine scores side-by-side per D23.

### Error Propagation

MCP tool errors propagate to the agent via `ToolResult`. Agent prompts should include handling instructions:

- **Auth errors** ("Authentication required"): Agent suggests `/dethereal:login` and retries
- **Validation errors**: Agent presents errors to user with suggested fixes
- **Network errors**: Agent retries once after 5 seconds, then reports to user
- **Platform errors (500)**: Agent reports to user without retry

### Plugin Security Model

The OAuth PKCE flow starts a localhost HTTP server on a fixed port (9876) to receive the authorization callback. Security considerations:

- **PKCE mitigation**: The code_verifier/code_challenge exchange prevents code interception from being useful for token exchange
- **Server lifetime**: The callback server auto-closes after receiving the callback or after a 2-minute timeout
- **Port predictability**: Fixed port is required by most OIDC providers that restrict redirect URIs. The server only listens for the expected redirect path
- **Token storage**: Tokens stored at `~/.dethernety/tokens.json` with `0600` permissions. The MCP server should verify file permissions on read and warn if permissions are too broad

---

## 6. Hooks

Hooks are defined in `hooks/hooks.json` and registered by the plugin at install time.

### Hook Definitions (`hooks/hooks.json`)

```json
{
  "SessionStart": [{
    "type": "command",
    "command": "${CLAUDE_PLUGIN_ROOT}/scripts/first-session-check.sh"
  }],
  "PostToolUse": [{
    "type": "command",
    "matcher": "Write|Edit",
    "command": "${CLAUDE_PLUGIN_ROOT}/scripts/post-write-validate.sh"
  }],
  "PreCompact": [{
    "type": "command",
    "command": "${CLAUDE_PLUGIN_ROOT}/scripts/pre-compact-summary.sh"
  }]
}
```

### First-Session Orientation

**Event:** `SessionStart`
**Type:** `command`

A shell script (`scripts/first-session-check.sh`) checks for `.dethernety/models.json` in the workspace:
- **No models:** Outputs orientation text showing entry commands (`/dethereal:create`, `/dethereal:status`, `/dethereal:help`) and a natural language prompt suggestion.
- **Models exist:** Outputs a one-line resume hint: `Dethereal active. "Production Stack" at 56/100 quality (CLASSIFIED). Try /dethereal:enrich or /dethereal:threat-model to continue.` Reads model name and state from `state.json`, quality from `quality.json`.
- **DETHERNETY_URL unset and localhost unreachable:** Adds: `Platform URL not configured. Set DETHERNETY_URL or run /dethereal:login to connect.`

### Auto-Validate After Model Edits

**Event:** `PostToolUse` (matcher: `Write|Edit`)
**Type:** `command`

A shell script (`scripts/post-write-validate.sh`) checks if the written file is inside a model directory tracked by `.dethernety/models.json`. If not, exits immediately (exit 0, no output). If yes, outputs a validation reminder for the main agent. The script must be fast on the non-model path (sub-100ms) because it fires on every Write/Edit in the session. Multiple reminders during rapid multi-file writes are harmless — the agent batches them naturally.

> **Performance:** The matcher `Write|Edit` fires for ALL file writes in the session. The script performs a fast path check against `.dethernety/models.json` and exits silently for non-model files. If model path lookup adds latency, cache model paths in an environment variable at SessionStart.

> **Note:** Model changes made via MCP tools (e.g., `update_model`, `export_model`) that write files internally do not trigger this hook because the file writes happen inside the MCP server process, not via Claude Code's Write/Edit tools.

### Preserve Model Context on Compaction

**Event:** `PreCompact`
**Type:** `command`

A shell script (`scripts/pre-compact-summary.sh`) reads `.dethernety/models.json` to find active model paths, then reads `<model-path>/.dethereal/state.json` and `<model-path>/.dethereal/quality.json` for each model and outputs a structured JSON summary that survives compaction. This ensures long threat modeling sessions maintain continuity across context window resets.

### Hooks NOT Included

- **Auto-sync after edits** -- Too aggressive. Sync should be an explicit user action.
- **Pre-commit validation** -- Conflicts with the project's existing commit discipline in CLAUDE.md.

---

## 7. Settings and Configuration

### Plugin Settings (`settings.json`)

```json
{}
```

No default agent is set (D64). Users invoke threat modeling via skills (`/dethereal:threat-model`, `/dethereal:discover`, etc.) or by explicitly selecting an agent (`@dethereal:threat-modeler`). This keeps non-threat-modeling conversations in the same project clean — no ~3KB of modeling guidelines loaded into context for unrelated work. Skills that require the threat-modeler agent specify it in their frontmatter (`agent: threat-modeler`).

### Authentication

Authentication works through the existing mechanism:

1. **`DETHERNETY_URL`** environment variable set in `.mcp.json` env config
2. **OAuth PKCE flow** triggered by `login` MCP tool (opens browser)
3. **Tokens cached** at `~/.dethernety/tokens.json` (mode 0600)
4. **Auto-refresh** handled internally by the MCP server
5. **Auth-disabled mode** supported for demo/development instances

### Persistent Plugin Data

Uses `${CLAUDE_PLUGIN_DATA}` for:
- Class definition cache (TTL: 24 hours)
- MITRE tactic name cache (for conversational reference, not model data)
- User profile (session count, expertise signals for UX adaptation)

---

## 8. Architecture Decision: MCP vs Skills for Documentation

### Context

The current MCP server has `get_model_schema` (15KB of schema + guidelines) and `get_example_models` (examples for 5 architecture types). These serve as documentation/reference for the LLM.

### Decision: Hybrid Approach

**Keep MCP tools** for protocol compatibility and external clients. **Additionally embed guidelines in agent prompts** via `@` file imports for zero-tool-call access.

| Content Type | MCP Tool | Skill/Agent Context |
|-------------|----------|-------------------|
| Core guidelines (component types, structure, boundaries) ~3KB | `get_model_schema` | `@../docs/guidelines-core.md` in `threat-modeler` agent |
| Layout guidelines (coordinate system, handle rules, pixels) ~12KB | `get_model_schema` | `@../docs/guidelines-layout.md` in editing skill bodies only |
| Example templates | `get_example_models` | Referenced by `/dethereal:create` skill |
| Available classes (dynamic, varies by instance) | `get_classes` | MCP tool call only (dynamic data) |

**Implementation (D47: Guidelines Splitting):**
1. Extract guidelines from `get-schema.tool.ts` into two files: `docs/guidelines-core.md` (~3KB: component types, model structure rules, boundary hierarchy constraints) and `docs/guidelines-layout.md` (~12KB: coordinate system, handle rules, pixel dimensions, layout algorithms)
2. `threat-modeler` agent imports `@../docs/guidelines-core.md` — always loaded
3. Editing skills (`create`, `add`, `threat-model`) include `@../docs/guidelines-layout.md` in their skill body — loaded only when needed
4. MCP tools remain for backward compatibility and external MCP clients
5. Agent prompts include: "Do not call `get_model_schema` — guidelines are already loaded in your context"
6. Static content = agent context; dynamic content = MCP tool call

---

## 9. Implementation Phases

### Phase 1 -- Foundation

Makes the plugin installable and minimally functional.

- Plugin manifest (`.claude-plugin/plugin.json`)
- MCP server config (`.mcp.json`)
- `threat-modeler` agent with embedded `guidelines-core.md`
- `/dethereal:help`, `/dethereal:status`, `/dethereal:login` skills
- `/dethereal:create` skill (natural language model creation, includes onboarding mode)
- `/dethereal:sync` skill (push/pull via `disable-model-invocation: true`)
- SessionStart hook for first-session orientation + returning-user resume hint
- `context: fork` on read-only skills (`review`, `surface`)
- `memory: project` on `threat-modeler` agent
- State-aware `/dethereal:help` output (shows "Suggested now" based on model state)
- Universal post-action status footer on mutating skills (absolute quality score + next-step suggestion). The footer calls `validate_model_json(action: 'quality')` directly from within the skill/agent flow — the PostToolUse auto-validate hook (Phase 4) is not required for footer quality computation

### Phase 2 -- Discovery

Adds auto-discovery from codebases.

- `infrastructure-scout` agent
- `/dethereal:discover` skill
- New MCP tool: `list_models`

### Phase 3 -- Enrichment

Adds security classification and MITRE integration.

- `security-enricher` agent
- `/dethereal:enrich` and `/dethereal:classify` skills
- New MCP tools: `search_mitre_attack`, `get_mitre_defend`, `manage_exposures`, `manage_controls`, `manage_countermeasures`
- `validate_model_json(action: 'quality')` for quality score computation

### Phase 4 -- Guided Workflow and Analysis

Adds the golden-path workflow and platform analysis integration.

- `model-reviewer` agent
- `/dethereal:threat-model` guided workflow skill
- `/dethereal:review` (includes `--structure-only` validation) and `/dethereal:surface` skills
- New MCP tool: `manage_analyses`
- PostToolUse auto-validate hook (complements in-flow quality computation from Phase 1)
- PreCompact hook
