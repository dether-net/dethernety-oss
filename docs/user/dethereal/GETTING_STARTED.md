---
title: 'Getting Started with Dethereal'
description: 'Install the plugin, authenticate, and create your first threat model'
category: 'documentation'
position: 2
navigation: true
tags: ['dethereal', 'getting-started', 'installation', 'tutorial']
---

# Getting Started with Dethereal

This guide walks you through installing the Dethereal plugin, connecting to the Dethernety platform, and creating your first threat model.

---

## Prerequisites

- **Claude Code** — the Anthropic CLI (`claude`), VS Code extension, or JetBrains plugin
- **Node.js 18+** and **pnpm** — for running the MCP server
- **A Dethernety platform instance** — local (`http://localhost:3003`) or hosted

---

## Installation

### From the Plugin Marketplace (Recommended)

Add the Dethernety marketplace and install the plugin:

```
/plugin marketplace add dether-net/claude-plugins
/plugin install dethereal@dether.net
```

Or via CLI:

```bash
claude plugin install dethereal@dether.net
```

Set the platform URL as an environment variable:

```bash
export DETHERNETY_URL=https://your-instance.dethernety.io
```

### For Team Projects

Add to your project's `.claude/settings.json` so the plugin is available to all team members:

```json
{
  "extraKnownMarketplaces": {
    "dether.net": {
      "source": { "source": "github", "repo": "dether-net/claude-plugins" }
    }
  },
  "enabledPlugins": {
    "dethereal@dether.net": true
  }
}
```

Team members get prompted to install when they trust the project folder.

### From Source (Contributors)

If you're developing from the Dethernety repository:

```bash
# Build the plugin
cd oss/apps/dethereal && pnpm build

# Load it locally
claude --plugin-dir oss/apps/dethereal
```

### Configuration

| Environment Variable | Default | Purpose |
|---------------------|---------|---------|
| `DETHERNETY_URL` | `http://localhost:3003` | Platform URL |

For development/demo mode, the platform can run with authentication disabled (`ENABLE_NOAUTH=true`), and Dethereal detects this automatically.

---

## Your First Session

When you start Claude Code with the plugin loaded for the first time, you'll see an orientation message:

```
Welcome to Dethereal — threat modeling for Claude Code.

Quick start:
  /dethereal:create    Create a new threat model
  /dethereal:status    Check connection and auth
  /dethereal:help      See all commands
```

### Checking Connection Status

Run `/dethereal:status` to verify everything is connected:

```
Dethernety Connection Status
─────────────────────────────────────────
Platform URL:  https://demo.dethernety.io
Auth status:   Not authenticated — run /dethereal:login
─────────────────────────────────────────

No local models found. Run /dethereal:create to get started.
```

---

## Authentication

Run `/dethereal:login` to authenticate with the platform. This opens your browser to the login page:

```
> /dethereal:login

Opening browser for authentication...

Authenticated successfully.
Platform:     https://demo.dethernety.io
User:         user@example.com
Token valid:  60 minutes remaining
```

### How Authentication Works

- **OAuth 2.0 with PKCE** — secure browser-based login, no passwords in the terminal
- **Token caching** — tokens are stored at `~/.dethernety/tokens.json`, keyed by platform URL
- **Auto-refresh** — expired tokens are refreshed transparently when a valid refresh token exists
- **Auth-disabled mode** — if the platform has auth disabled (development/demo), all tools work without login

### Token Security

- Never commit `~/.dethernety/` to version control
- Tokens are specific to each platform URL — switching instances requires separate auth
- Use `/dethereal:login` to re-authenticate if your session expires

---

## Creating Your First Model

There are four ways to create a model. For your first time, describing your system in natural language is the easiest:

### Option 1: Describe Your System (Recommended)

```
> /dethereal:create a web application with a React frontend served by nginx,
  a Node.js API backend, a PostgreSQL database, and user authentication via OAuth
```

The plugin will:
1. Ask about your most valuable assets (crown jewels)
2. Ask about compliance requirements
3. Identify components and trust boundaries from your description
4. Present everything for your confirmation before writing files

### Option 2: Start From a Template

```
> /dethereal:create template web_app
```

Available templates: `web_app`, `api_service`, `microservices`.

### Option 3: Import From Infrastructure Files

```
> /dethereal:create from ./infrastructure/
```

Point it at a directory containing Terraform, Kubernetes manifests, Dockerfiles, or other infrastructure definitions. The plugin's discovery agent scans the files and builds a model from what it finds.

### Option 4: Pull From the Platform

```
> /dethereal:create pull
```

Lists models on the platform and exports one to local files for enrichment.

---

## What Gets Created

After creating a model, you'll have a directory structure like this:

```
./threat-models/my-web-app/
├── manifest.json          # Model metadata (name, description, modules)
├── structure.json         # Boundary and component hierarchy
├── dataflows.json         # Data flow connections
├── data-items.json        # Data classifications (empty initially)
├── README.md              # Auto-generated summary
├── .dethereal/            # Workflow metadata (per-model)
│   ├── state.json         # Current workflow state
│   └── scope.json         # Scope definition (crown jewels, compliance)
└── attributes/            # Security attributes (populated during enrichment)
    ├── boundaries/
    ├── components/
    ├── dataFlows/
    └── dataItems/
```

The plugin also creates a project-level registry at `.dethernety/models.json` that tracks all local models.

### The Model Files

- **manifest.json** — model metadata: name, description, which modules it uses
- **structure.json** — the hierarchy of trust boundaries and components with visual coordinates
- **dataflows.json** — directed connections between components (who talks to whom)
- **data-items.json** — what sensitive data flows carry (PII, credentials, etc.)
- **attributes/** — per-element security properties (authentication, encryption, logging, etc.)

These are plain JSON files that work well with git — you can diff them, review them in PRs, and track changes over time.

### The Metadata Directory

The `.dethereal/` directory inside each model holds workflow state:

- **state.json** — where you are in the modeling process (6 states from INITIALIZED to REVIEWED)
- **scope.json** — what you said about the system's crown jewels, compliance requirements, and trust assumptions
- **quality.json** — quality score cache (created after first quality check)
- **sync.json** — sync metadata (created after first platform push/pull)

---

## Example Walkthrough

Here's a complete first-model session:

```
> /dethereal:create I have a React SPA, a Node.js API, and PostgreSQL

I'll create a threat model for your system. Let me ask a few questions first.

What are the most valuable assets in this system? (These are your "crown jewels"
— the data or capabilities an attacker would target.)

> User account data and session tokens

Any compliance requirements? (e.g., SOC2, HIPAA, GDPR, PCI-DSS)

> SOC2

What do you explicitly trust? (e.g., cloud provider infrastructure, corporate VPN)

> AWS infrastructure

Here's what I've identified:

Components:
  1. [PROCESS] React SPA — in DMZ
  2. [PROCESS] Node.js API — in Internal Network
  3. [STORE] PostgreSQL — in Data Tier
  4. [EXTERNAL_ENTITY] End Users — in Internet Zone

Boundaries:
  Internet Zone / DMZ / Internal Network / Data Tier

Data Flows:
  1. End Users → React SPA: HTTPS requests
  2. React SPA → Node.js API: Internal API calls
  3. Node.js API → PostgreSQL: SQL queries

Confirm or adjust?

> confirm

[done] Model "My Web App" created with 4 components, 3 data flows. Quality: 28/100.
[next] /dethereal:discover (scan codebase for additional infrastructure)
```

---

## What to Do Next

After creating your model, you have two paths:

### The Guided Workflow (Recommended)

Run `/dethereal:threat-model` to walk through all 11 steps — from discovery and classification through enrichment, validation, and platform sync. This is the most thorough approach and is recommended for new models. See [The 11-Step Guided Workflow](GUIDED_WORKFLOW.md).

### Individual Commands

Use individual commands to work on specific aspects:

- `/dethereal:discover` — scan your codebase for infrastructure components the description missed
- `/dethereal:classify` — assign classes to components (enables security analysis)
- `/dethereal:enrich` — add security attributes (authentication, encryption, logging)
- `/dethereal:review` — check model quality and get recommendations

See the [Command Reference](COMMAND_REFERENCE.md) for all available commands, or run `/dethereal:help` for context-aware suggestions.

---

## Version Control

Since threat models are plain JSON files, commit them alongside your source code:

```bash
git add threat-models/ .dethernety/models.json
git commit -m "feat: initial threat model for web application"
```

**What to gitignore:**

```gitignore
# Per-user sync state (different per developer)
**/.dethereal/sync.json

# Discovery provenance (may contain infrastructure details)
**/.dethereal/discovery.json

# Discovery cache (transient)
.dethernety/discovery-cache.json
```

Token storage (`~/.dethernety/`) is in your home directory, outside the repository — no gitignore entry needed.

See [Sync and Version Control](SYNC_AND_VERSION_CONTROL.md) for the full version control workflow.

---

**Next:** [The 11-Step Guided Workflow](GUIDED_WORKFLOW.md) — walk through the complete modeling process
