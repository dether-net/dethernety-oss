---
title: 'Agents, Tools, and Hooks'
description: 'How the 4 AI agents, 20 MCP tools, and 3 lifecycle hooks work together'
category: 'documentation'
position: 9
navigation: true
tags: ['dethereal', 'agents', 'mcp', 'tools', 'hooks', 'architecture']
---

# Agents, Tools, and Hooks

Under the hood, Dethereal uses 4 specialized AI agents, 20 MCP tools for platform communication, and 3 lifecycle hooks for workflow automation. You don't need to know these details to use the plugin — this page is for users who want to understand what's happening behind the scenes.

---

## The 4 AI Agents

Each agent has a specific role, tool access, and constraints. Slash commands invoke agents automatically — you don't select them manually.

### threat-modeler (Orchestrator)

The primary agent for creating and editing threat models. Orchestrates the 11-step guided workflow by delegating to sub-agents for specialized tasks.

| Property | Value |
|----------|-------|
| **Effort** | High |
| **Max turns** | 60 |
| **Tools** | Read, Write, Edit, Glob, Grep, Bash, all MCP tools |
| **Delegates to** | infrastructure-scout, security-enricher, model-reviewer |

**Used by commands:** create, discover, add, remove, threat-model, sync

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

### security-enricher (Attributes and Classification)

Populates security attributes, handles classification, and integrates MITRE ATT&CK data. This is the only sub-agent with write access to attribute files.

| Property | Value |
|----------|-------|
| **Effort** | High |
| **Max turns** | 40 |
| **Tools** | Read, Write, Edit, all MCP tools |
| **Constraint** | Never generates MITRE IDs from memory |

**Used by commands:** classify, enrich, threat-model (Steps 6, 8)

**Key behaviors:**
- Two-pass classification: deterministic matching first, LLM-assisted for ambiguous cases
- Crown jewel tagging with fuzzy matching from scope definition
- MITRE ATT&CK 3-step verification: search platform → validate ID format → persist
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

**Used by commands:** review, surface, view, threat-model (Step 9)

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

The MCP (Model Context Protocol) server exposes 20 tools for platform communication. These tools are used by agents internally — you interact with them through slash commands, not directly.

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
| `get_classes` | Queries available classes from installed modules, with deterministic classification suggestions |
| `update_attributes` | Incremental attribute updates without full model push |
| `generate_attribute_stubs` | Deterministically writes class template attribute stubs to disk for classified elements |

### MITRE Integration (2 tools)

| Tool | Purpose |
|------|---------|
| `search_mitre_attack` | Query ATT&CK techniques, tactics, and mitigations |
| `get_mitre_defend` | Browse D3FEND defensive techniques |

All MITRE data comes from the platform's graph database — the plugin never generates technique IDs from memory.

### Security Elements (3 tools)

| Tool | Purpose |
|------|---------|
| `manage_exposures` | Read platform-computed exposures (list/get only — exposures are computed by the analysis engine, not created by users) |
| `manage_controls` | CRUD operations on security controls |
| `manage_countermeasures` | Link security controls to exposures |

### Analysis (1 tool)

| Tool | Purpose |
|------|---------|
| `manage_analyses` | List analysis classes, create/run/poll/get analysis results |

---

## Lifecycle Hooks

Three hooks automate workflow tasks at key moments:

### SessionStart — First-Session Orientation

**When:** A new Claude Code session starts with the plugin loaded.

**What it does:** Checks if any local models exist. If this is the user's first session (no `.dethernety/models.json`), shows a welcome message with quick-start commands. If models exist, shows a brief status summary.

### PostToolUse — Auto-Validate After Edits

**When:** After the Write or Edit tool modifies a model file.

**What it does:** Automatically calls `validate_model_json` to check structural validity. If validation finds errors (broken references, schema violations), they surface immediately — before you move on to the next step.

### PreCompact — Context Preservation

**When:** Before Claude Code compresses conversation context (approaching context limits).

**What it does:** Generates a summary of the current model state, workflow position, and recent actions. This summary is preserved in the compressed context so the conversation can continue coherently after compaction.

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
