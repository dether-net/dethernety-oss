---
title: 'Dethernety User Documentation'
description: 'User guide for the Dethernety threat modeling platform'
category: 'documentation'
position: 1
navigation: true
tags: ['overview', 'index', 'navigation', 'reference']
---

# Dethernety User Documentation

For platform overview, installation, and architecture, see the [main README](../../README.md).

---

## Modeling and Analysis

| Guide | Description |
|-------|-------------|
| [Building Your First Model](BUILDING_YOUR_FIRST_MODEL.md) | Step-by-step tutorial for creating a threat model |
| [Component Configuration Guide](COMPONENT_CONFIGURATION_GUIDE.md) | Component setup, class assignment, and attribute configuration |
| [Security Analysis Workflow](SECURITY_ANALYSIS_WORKFLOW.md) | Running analysis and interpreting results |

## Security Controls and Modules

| Guide | Description |
|-------|-------------|
| [Working with Security Controls](WORKING_WITH_SECURITY_CONTROLS.md) | Creating, configuring, and assigning security controls |
| [Understanding Modules](UNDERSTANDING_MODULES.md) | How the module system extends modeling and analysis |

## Issue Tracking

| Guide | Description |
|-------|-------------|
| [Issue Management Guide](ISSUE_MANAGEMENT_GUIDE.md) | Issue creation, filtering, merging, and external integration |

## AI and Automation — Dethereal (Claude Code Plugin)

For comprehensive documentation on the Dethereal threat modeling plugin, see the [Dethereal documentation](dethereal/README.md):

| Guide | Description |
|-------|-------------|
| [Getting Started](dethereal/GETTING_STARTED.md) | Installation, authentication, first model |
| [Guided Workflow](dethereal/GUIDED_WORKFLOW.md) | The 11-step threat modeling process |
| [Command Reference](dethereal/COMMAND_REFERENCE.md) | All 14 slash commands |
| [Model Concepts](dethereal/MODEL_CONCEPTS.md) | Components, boundaries, flows, quality scoring |
| [Discovery and Enrichment](dethereal/DISCOVERY_AND_ENRICHMENT.md) | Infrastructure scanning, security attributes, MITRE |
| [Sync and Version Control](dethereal/SYNC_AND_VERSION_CONTROL.md) | Push/pull, git integration, conflict handling |
| [Review and Analysis](dethereal/REVIEW_AND_ANALYSIS.md) | Quality review, attack surface analysis |
| [Agents and Architecture](dethereal/AGENTS_AND_ARCHITECTURE.md) | AI agents, MCP tools, lifecycle hooks |
| [Glossary](dethereal/GLOSSARY.md) | Plugin-specific terminology |

---

## Suggested reading order

**Platform (GUI):** [Building Your First Model](BUILDING_YOUR_FIRST_MODEL.md) -- then [Security Analysis Workflow](SECURITY_ANALYSIS_WORKFLOW.md) to run and interpret analysis.

**Dethereal (Claude Code plugin):**
1. [Getting Started](dethereal/GETTING_STARTED.md) -- install and create your first model
2. [Guided Workflow](dethereal/GUIDED_WORKFLOW.md) -- the complete 11-step process
3. [Command Reference](dethereal/COMMAND_REFERENCE.md) -- all available commands

**Going deeper:**
1. [Working with Security Controls](WORKING_WITH_SECURITY_CONTROLS.md) -- create and assign controls
2. [Issue Management Guide](ISSUE_MANAGEMENT_GUIDE.md) -- track findings and coordinate remediation
3. [Component Configuration Guide](COMPONENT_CONFIGURATION_GUIDE.md) -- advanced component setup

**Modules:**
1. [Understanding Modules](UNDERSTANDING_MODULES.md) -- module system and extensibility
