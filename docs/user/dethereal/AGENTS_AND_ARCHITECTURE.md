---
title: 'Agents, Tools, and Hooks'
description: 'How the 5 AI agents, 22 MCP tools, and 3 lifecycle hooks work together'
category: 'documentation'
position: 9
navigation: true
tags: ['dethereal', 'agents', 'mcp', 'tools', 'hooks', 'architecture']
---

# Agents, Tools, and Hooks

Under the hood, Dethereal uses 5 specialized AI agents, 22 MCP tools for platform communication, and 3 lifecycle hooks for workflow automation. You don't need to know these details to use the plugin — this page is for users who want to understand what's happening behind the scenes.

---

## The 5 AI Agents

Each agent has a specific role, tool access, and constraints. Slash commands invoke agents automatically — you don't select them manually.

### threat-modeler (Orchestrator)

The primary agent for creating and editing threat models. Orchestrates the 11-step guided workflow by delegating to sub-agents for specialized tasks.

| Property | Value |
|----------|-------|
| **Effort** | High |
| **Max turns** | 60 |
| **Tools** | Read, Write, Edit, Glob, Grep, Bash, all MCP tools |
| **Delegates to** | infrastructure-scout, infrastructure-scout-scoped, security-enricher, model-reviewer |

**Used by commands:** create, discover, add, remove, threat-model

**Key behaviors:**
- Reads model files from disk at the start of each operation
- Handles all file writes for discovery (the scout is read-only)
- Manages state transitions and backward transitions
- Presents batch confirmation tables before writing
- Never modifies security attributes (that's the security-enricher's domain)

### infrastructure-scout (Discovery)

A read-only agent that scans codebases for infrastructure components. Returns structured data to the calling skill — never writes model files.

| Property | Value |
|----------|-------|
| **Effort** | Medium |
| **Max turns** | 30 |
| **Tools** | Read, Glob, Grep, Bash (read-only), `get_classes` MCP tool |
| **Constraint** | Read-only — returns data, does not write files |

**Used by commands:** discover, threat-model (Step 2)

**Key behaviors:**
- Scans 10 source categories with signal strength ranking
- Pre-classifies components using IaC mapping tables
- Validates pre-classifications against the platform's class library
- Never includes secret values — extracts names and endpoints only
- Returns a compact discovery report; full provenance is read from disk

### infrastructure-scout-scoped (Drift Re-Verification)

A deliberately narrowed companion to infrastructure-scout. Drift reconciliation uses it to re-verify the elements touched by a file diff without re-scanning the whole repository.

| Property | Value |
|----------|-------|
| **Effort** | Medium |
| **Max turns** | 20 |
| **Tools** | Read, `get_classes` MCP tool |
| **Constraint** | No Glob, Grep, or Bash — reads only the files on the allowlist it is handed |

**Used by commands:** threat-model (resume, when drift is detected)

**Key behaviors:**
- Receives a pre-computed file allowlist from the calling skill and reads nothing outside it
- Answers one of four scoped questions: discover elements, re-verify element attributes, propose reclassification, check element existence
- Shares classification rules with the full-scope infrastructure-scout
- Stops and reports rather than widening its own scope when it needs a file outside the allowlist

### security-enricher (Attributes and Classification)

Populates security attributes, handles classification, and identifies security controls. This is the only sub-agent with write access to attribute files.

| Property | Value |
|----------|-------|
| **Effort** | High |
| **Max turns** | 40 |
| **Tools** | Read, Write, Edit, Glob, Grep, all MCP tools |
| **Constraint** | Does not annotate MITRE techniques on attribute files — tactic coverage is derived platform-side from analysis exposures |

**Used by commands:** classify, enrich, threat-model (Steps 6, 8)

**Key behaviors:**
- Two-pass classification: deterministic matching first, LLM-assisted for ambiguous cases
- Crown jewel tagging with fuzzy matching from scope definition
- Looks MITRE techniques up against the platform when explaining an exposure — never generates technique IDs from memory
- Credential enrichment in 4 phases: inventory → flow mapping → STORE scope → shared analysis
- Compliance-driven prompts based on scope compliance drivers
- Presents all proposals in batch confirmation tables

### model-reviewer (Validation)

A read-only auditor that assesses model quality and produces analysis reports. Cannot modify any files.

| Property | Value |
|----------|-------|
| **Effort** | Medium |
| **Max turns** | 15 |
| **Tools** | Read, Glob, Grep, MCP tools (read-only subset) |
| **Constraint** | Strictly read-only — no file modifications |

**Used by commands:** review, surface, threat-model (Step 9)

**Key behaviors:**
- Computes quality score with 7-factor breakdown
- Evaluates 3 quality gates (creation, sync, analysis)
- Produces attack surface analysis across 8 dimensions
- Detects cross-model gaps and credential blast radius
- Cannot write quality.json — the threat-modeler handles persistence after validation

---

## Agent Delegation

The threat-modeler orchestrates complex workflows by delegating to sub-agents:

```
threat-modeler
├── delegates to infrastructure-scout (discovery scanning)
│   └── returns: compact report (element counts, sources, confidence)
├── delegates to infrastructure-scout-scoped (drift re-verification)
│   └── returns: re-verified elements for an allowlisted file diff
├── delegates to security-enricher (enrichment)
│   └── returns: enriched element count + quality delta
└── delegates to model-reviewer (validation)
    └── returns: quality score + top 3 issues
```

**How it works:**
1. The threat-modeler passes the model directory path to the sub-agent
2. The sub-agent reads current model state from disk independently
3. The sub-agent does its work and returns a compact summary
4. The threat-modeler reads the full output from disk

This file-based communication pattern keeps sub-agent responses compact and avoids passing large serialized model content between agents.

---

## MCP Tools

The MCP (Model Context Protocol) server exposes 22 tools for platform communication. These tools are used by agents internally — you interact with them through slash commands, not directly.

### Authentication (3 tools)

| Tool | Purpose |
|------|---------|
| `login` | Browser-based OAuth authentication with PKCE |
| `logout` | Clear cached authentication tokens |
| `refresh_token` | Refresh expired access tokens |

Tokens are cached at `~/.dethernety/tokens.json`, keyed by platform URL. Refresh is automatic and transparent.

### Reference (2 tools)

| Tool | Purpose |
|------|---------|
| `get_model_schema` | Returns the complete JSON schema for threat model files |
| `get_example_models` | Provides example model templates (web app, API service, microservices) |

### Validation (1 tool)

| Tool | Purpose |
|------|---------|
| `validate_model_json` | Structural validation + quality score computation |

### Model CRUD (5 tools)

| Tool | Purpose |
|------|---------|
| `create_threat_model` | Create a new empty model on the platform |
| `import_model` | Import a local model directory to the platform |
| `export_model` | Export a platform model to a local directory |
| `update_model` | Update an existing platform model from local files |
| `list_models` | List models available on the platform |

### Elements (3 tools)

| Tool | Purpose |
|------|---------|
| `get_classes` | Queries available classes from installed modules. Used for browsing/exploration ("what classes exist?"). Classification workflow uses `match_classes` instead. |
| `update_attributes` | Incremental attribute updates without full model push. Attribute keys whose local value is still `null` are withheld rather than sent — the tool reports the withheld count, and a locally nulled key does not clear the value the platform already holds. |
| `generate_attribute_stubs` | Deterministically writes class template attribute stubs to disk for classified elements |

### Classification (1 tool)

| Tool | Purpose |
|------|---------|
| `match_classes` | Server-side batch class matching. Replaces the per-module `get_classes` loop with a single call that returns ranked candidates per element. Multi-priority pipeline: exact-name → fuzzy-name → vector similarity → type heuristic. Used by the classify skill (Pass 1) and the security-enricher's classification protocol. |

### MITRE Integration (2 tools)

| Tool | Purpose |
|------|---------|
| `search_mitre_attack` | Query ATT&CK techniques, tactics, and mitigations |
| `get_mitre_defend` | Browse D3FEND defensive techniques |

All MITRE data comes from the platform's graph database — the plugin never generates technique IDs from memory.

### Security Elements (4 tools)

| Tool | Purpose |
|------|---------|
| `manage_exposures` | Read platform-computed exposures (list/get only — exposures are computed by the analysis engine, not created by users) |
| `manage_controls` | Multi-action tool for the control library: CRUD (`list`, `get`, `create`, `update`, `delete`), assignment (`assign`), ranking (`rank`), and the control-library workflow (`pull-controls`, `push-greenfield`, `push-brownfield`, `set-local-edited`, `promote-external-edit`, `tombstone`) plus two write-ahead-log repair actions (`inspect-wal`, `clear-wal`). The control-library actions enforce the two-write rule and the shared-ownership safety check. |
| `manage_countermeasures` | Link security controls to exposures |
| `get_control_gaps` | Framework-grounded gap analysis. Walks the chain `Exposure → ATT&CK Technique → ATT&CK Mitigation → Countermeasure → Control` in a single Cypher query and returns unmitigated exposures with recommended controls. Used by `/dethereal:surface`. |

### Analysis (1 tool)

| Tool | Purpose |
|------|---------|
| `manage_analyses` | List analysis classes, create/run/poll/get analysis results |

---

## Lifecycle Hooks

Three hooks automate workflow tasks at key moments:

### SessionStart — First-Session Orientation

**When:** A new Claude Code session starts with the plugin loaded.

**What it does:** Counts the models in `.dethernety/models.json`. With none — whether the file is missing or simply empty — it prints the orientation block with quick-start commands. With models present it prints a resume hint instead. Either way, if `DETHERNETY_URL` is unset and nothing answers on `http://localhost:3003`, it appends a *Platform: not connected* line. See [Getting Started](GETTING_STARTED.md#your-first-session) for the exact output.

### PostToolUse — Auto-Validate After Edits

**When:** After the Write or Edit tool modifies a model file.

**What it does:** Checks whether the written path belongs to a registered model directory, and if so prints a one-line reminder to run `validate_model_json`. The hook is a prompt, not a check — it does not run validation and cannot report an error. Broken references and schema violations stay undetected until you run `/dethereal:review` or the Gate 2 pre-flight on `/dethereal:sync push`.

### PreCompact — Context Preservation

**When:** Before Claude Code compresses conversation context (approaching context limits).

**What it does:** Writes a structured snapshot of every model in your local registry — its name, path, workflow state, stale-element count, and quality score with its label. That snapshot survives compaction, so the conversation can carry on knowing which model you are working on and how far along it is.

It preserves **state, not history.** No record of what you just did is carried across: no tool calls, no edits, no decisions. If the reasoning behind a change matters after compaction, say it out loud in the conversation or write it into the model — don't assume the hook will remember it for you.

---

## The State Machine

Models progress through 6 workflow states:

```
INITIALIZED → SCOPE_DEFINED → DISCOVERED → STRUCTURE_COMPLETE → ENRICHING → REVIEWED
```

### Forward Transitions

| From | To | Trigger |
|------|----|----|
| INITIALIZED | SCOPE_DEFINED | Scope definition complete |
| SCOPE_DEFINED | DISCOVERED | Discovery confirmed |
| DISCOVERED | STRUCTURE_COMPLETE | Boundaries refined |
| STRUCTURE_COMPLETE | ENRICHING | Data flow mapping complete |
| ENRICHING | REVIEWED | Validation passes Gate 3 |

### Backward Transitions

Adding or removing elements at ENRICHING or REVIEWED reverts the state to STRUCTURE_COMPLETE. Existing enrichment is preserved; new elements are tracked as stale. See [Backward Transitions](GUIDED_WORKFLOW.md#backward-transitions) for the full explanation.

### State Storage

State is tracked in `<model-path>/.dethereal/state.json`:

```json
{
  "currentState": "ENRICHING",
  "completedStates": ["INITIALIZED", "SCOPE_DEFINED", "DISCOVERED", "STRUCTURE_COMPLETE"],
  "lastModified": "2026-03-27T14:30:00Z",
  "staleElements": []
}
```

The `completedStates` array enables the guided workflow to show which steps are done. The `staleElements` array tracks elements that were added during enrichment and need to be enriched before the model is complete.

---

**Next:** [Glossary](GLOSSARY.md) — plugin-specific terminology
