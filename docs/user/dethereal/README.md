---
title: 'Dethereal — Claude Code Plugin for Threat Modeling'
description: 'Comprehensive documentation for the Dethereal threat modeling plugin'
category: 'documentation'
position: 1
navigation: true
tags: ['dethereal', 'plugin', 'claude-code', 'threat-modeling', 'overview']
---

# Dethereal — Claude Code Plugin for Threat Modeling

Dethereal is a Claude Code plugin that guides you through building structured threat models using conversational AI. You describe your system in natural language, and the plugin discovers infrastructure, maps trust boundaries and data flows, enriches security attributes, and publishes the model to the Dethernety platform for analysis.

The plugin provides 14 slash commands, 4 specialized AI agents, and an 11-step guided workflow that takes you from a system description to a fully enriched, analysis-ready threat model.

---

## Documentation

| Guide | Description |
|-------|-------------|
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

1. **[Getting Started](GETTING_STARTED.md)** — Install the plugin, connect to your platform, create your first model
2. **[Guided Workflow](GUIDED_WORKFLOW.md)** — Run `/dethereal:threat-model` to walk through all 11 steps
3. **[Model Concepts](MODEL_CONCEPTS.md)** — Understand what the model contains and how quality scoring works

---

## Prerequisites

- **Claude Code** — CLI (`claude`), VS Code extension, or JetBrains plugin
- **Node.js 18+** and **pnpm** — for running the MCP server
- **Dethernety platform** — a running instance for sync and analysis (local or hosted)

---

## Relationship to Platform Documentation

These docs cover the **Claude Code plugin experience** — working with threat models through conversational AI in your terminal or IDE.

For the **platform GUI experience** (web-based diagram editor, analysis dashboard, issue tracking), see the [platform user documentation](../README.md):

- [Building Your First Model](../BUILDING_YOUR_FIRST_MODEL.md) — GUI-based tutorial
- [Security Analysis Workflow](../SECURITY_ANALYSIS_WORKFLOW.md) — Running analysis on the platform
- [Working with Security Controls](../WORKING_WITH_SECURITY_CONTROLS.md) — Creating controls in the GUI
- [Component Configuration Guide](../COMPONENT_CONFIGURATION_GUIDE.md) — Component setup in the GUI

Both workflows produce the same threat model format. You can create a model with Dethereal, push it to the platform, and continue editing in the GUI — or pull a GUI-created model and enrich it locally.

---

**Next:** [Getting Started](GETTING_STARTED.md) — install the plugin and create your first model
