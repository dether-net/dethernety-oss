---
title: 'Dethereal — Threat Modeling Plugin for Claude Code, Codex and OpenCode'
description: 'Comprehensive documentation for the Dethereal threat modeling plugin'
category: 'documentation'
position: 1
navigation: true
tags: ['dethereal', 'plugin', 'claude-code', 'threat-modeling', 'overview']
---

# Dethereal — Threat Modeling Plugin for Claude Code, Codex and OpenCode

Dethereal is a threat modeling plugin for Claude Code, Codex and OpenCode that guides you through building structured threat models using conversational AI. You describe your system in natural language, and the plugin discovers infrastructure, maps trust boundaries and data flows, places each boundary on a trust gradient with approved channels (see [Boundary Trust Zones](../BOUNDARY_TRUST_ZONES.md)), enriches security attributes, and publishes the model to the Dethernety platform for analysis.

The plugin provides 14 slash commands, 6 specialized AI agents, 30 MCP tools, and an 11-step guided workflow that takes you from a system description to an analysis-ready threat model: a quick first pass by default, fully enriched once you deepen it. A per-Control library mirrors the platform's reusable security controls into local files (`controls/<id>.json`) with shared-ownership safety prompts on push — see [Sync and Version Control](SYNC_AND_VERSION_CONTROL.md#shared-ownership-prompts).

**Harnesses:** each status says how far the harness is tested. **Claude Code — Stable:** the main target; the full workflow is tested on every release. **Codex — Experimental:** runs the workflow end to end in our tests; expect rough edges. **OpenCode — Preview:** runs end to end, but in our tests the model can skip a checkpoint question or write a value different from the one you confirmed (see [Known Issues on OpenCode](#known-issues-on-opencode)). Claude Code installs the plugin from the Dethernety marketplace; Codex and OpenCode install it with `dethereal install` — see [Installation](GETTING_STARTED.md#installation). These guides show commands in the Claude Code form (`/dethereal:<command>`); see [Command Reference](COMMAND_REFERENCE.md#slash-command-syntax) for the Codex and OpenCode forms.

---

## Known Issues on OpenCode

OpenCode is in Preview. These issues were seen in our tests; each has a workaround:

- **A checkpoint question can be skipped.** The model can skip a checkpoint question; seen at the data-items step. *Workaround:* if the data-items question or its confirmation never appeared, run `/dethereal-enrich`: its data-items step asks again for each boundary-crossing flow that still has no data item.
- **A confirmed value can be written differently.** A value you confirmed can be written to the model files as a different one; seen with a boundary's trust zone. *Workaround:* check each boundary's zone with `/dethereal-view --format yaml` before you push, and correct any that differ.
- **Enrichment can stop early.** Enrichment can stop before it reaches some components, leaving them without security attributes. *Workaround:* run `/dethereal-enrich` again for those components (`/dethereal-enrich --pick <element-id>` for one).

---

## Documentation

| Guide | Description |
|-------|-------------|
| [Quick Start](QUICK_START.md) | From install to your first threat model, in about 15 minutes |
| [Getting Started](GETTING_STARTED.md) | Installation, authentication, and creating your first model |
| [Guided Workflow](GUIDED_WORKFLOW.md) | The 11-step threat modeling process from scope to sync |
| [Command Reference](COMMAND_REFERENCE.md) | All 14 slash commands with syntax, arguments, and examples |
| [Model Concepts](MODEL_CONCEPTS.md) | Components, boundaries, data flows, classes, quality scoring |
| [Discovery and Enrichment](DISCOVERY_AND_ENRICHMENT.md) | Infrastructure scanning, security attributes, MITRE, credentials |
| [Sync and Version Control](SYNC_AND_VERSION_CONTROL.md) | Push/pull, conflict handling, git integration |
| [Review and Analysis](REVIEW_AND_ANALYSIS.md) | Quality review, attack surface analysis |
| [Agents, Tools, and Hooks](AGENTS_AND_ARCHITECTURE.md) | AI agents, MCP tools, hooks, state machine |
| [Glossary](GLOSSARY.md) | Plugin-specific terminology |

---

## Quick Start

1. **[Quick Start](QUICK_START.md)** — install, sign in, and build your first model in about 15 minutes
2. **[Getting Started](GETTING_STARTED.md)** — Install the plugin, connect to your platform, create your first model
3. **[Guided Workflow](GUIDED_WORKFLOW.md)** — Run `/dethereal:threat-model` to continue your model; a new model is a quick first pass (priority-set enrichment, no Gate 3 review) that you deepen later with `--full`; add `--full` for the full run
4. **[Model Concepts](MODEL_CONCEPTS.md)** — Understand what the model contains and how quality scoring works

Coming from Dethereal 0.4.x? See [Upgrading from 0.4.x](GETTING_STARTED.md#upgrading-from-04x).

---

## Prerequisites

- **A harness** — Claude Code (Stable; CLI, VS Code extension, or JetBrains plugin), Codex (Experimental) or OpenCode (Preview), at the versions listed in [Harness Versions](GETTING_STARTED.md#harness-versions): the installer refuses an OpenCode newer than the ones Dethereal is checked with unless you allow it
- **Node.js 20.11.1 or later** — for running the MCP server; the plugin will not install or start on an older Node. **pnpm** as well, if you build from source
- **Dethernety platform** — a running instance you operate, for sync and analysis (on this machine or another host)

---

## Relationship to Platform Documentation

These docs cover the **Dethereal plugin experience** — working with threat models through conversational AI in your terminal or IDE.

For the **platform GUI experience** (web-based diagram editor, analysis dashboard, issue tracking), see the [platform user documentation](../README.md):

- [Building Your First Model](../BUILDING_YOUR_FIRST_MODEL.md) — GUI-based tutorial
- [Security Analysis Workflow](../SECURITY_ANALYSIS_WORKFLOW.md) — Running analysis on the platform
- [Working with Security Controls](../WORKING_WITH_SECURITY_CONTROLS.md) — Creating controls in the GUI
- [Component Configuration Guide](../COMPONENT_CONFIGURATION_GUIDE.md) — Component setup in the GUI
- [Boundary Trust Zones](../BOUNDARY_TRUST_ZONES.md) — Zoning boundaries and declaring approved channels (conduits) in the GUI

Both workflows produce the same threat model format. You can create a model with Dethereal, push it to the platform, and continue editing in the GUI — or pull a GUI-created model and enrich it locally.

---

**Next:** [Getting Started](GETTING_STARTED.md) — install the plugin and create your first model
