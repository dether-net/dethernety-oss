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

- **A harness** — Claude Code (Stable; the CLI `claude`, VS Code extension, or JetBrains plugin), Codex (Experimental) or OpenCode (Preview); see [Codex and OpenCode](#codex-and-opencode) for what each status means. The Dethereal installer checks each harness's version (see [Harness Versions](#harness-versions))
- **Node.js 20.11.1 or later** — required for the MCP server; the plugin will not install or start on an older Node. **pnpm** as well, if you build from source
- **A Dethernety platform instance** — on this machine (`http://127.0.0.1:3000`) or on another host reachable over HTTPS

### Harness Versions

| Harness | Oldest version | What the installer does |
|---------|----------------|-------------------------|
| Claude Code | 2.1.287 | Refuses an older one (`dethereal install` and `uninstall` with `--harness claude`); `dethereal doctor` reports it as a failure for an install made with the installer |
| Codex | 0.157.0 | Refuses an older one, and a pre-release of 0.157.0 |
| OpenCode | 1.18.32 | Refuses an older one. Dethereal is checked with OpenCode **1.18.32, 1.18.33 and 1.18.34**; a newer OpenCode is refused too, unless you add `--allow-unverified-opencode` (see [Codex and OpenCode](#codex-and-opencode)) |

For Claude Code, **2.1.295 or later is recommended**; 2.1.287 stays the minimum. Only from 2.1.295 does a Dethereal secret or config guard that crashes, times out or cannot start block the call; on an older Claude Code such a call goes through (an old Node is the exception, below).

OpenCode updates itself, so the OpenCode you have may be newer than 1.18.34 by the time you install. If the installer refuses it, either install with `--allow-unverified-opencode`, or use a checked version.

**Because the guards block a call they cannot check, a missing or old Node blocks your file and shell tools.** Dethereal's guards block every Read, Grep, Bash, Write, Edit, MultiEdit and NotebookEdit call, in each project where the plugin is enabled (in every project, if you installed it for your user), when:

- Claude Code runs a Node from 14.8 up to 20.11.0, on any Claude Code version. Claude Code passes the guard's reason to the assistant: `Dethereal needs Node.js 20.11.1 or newer (found <version>), so its secret-guard can't check this call and blocks it. Update Node, or turn the Dethereal plugin off with /plugin.` (`config-guard` for a file write).
- On Claude Code 2.1.295 or later, Claude Code finds no usable `node` on its `PATH`, or only a Node older than 14.8.

To get your tools back, do one of these:

- Update Node to 20.11.1 or later, then restart Claude Code from a shell where `node --version` shows the new version.
- Make sure `node` is on the `PATH` Claude Code runs with. Check this in particular when you installed Node through nvm and start Claude Code from the desktop rather than from a terminal: nvm adds `node` to the `PATH` in your shell's startup files, which a Claude Code started from the desktop may not read.
- Turn the Dethereal plugin off with `/plugin`, then start a new session (or run `/reload-plugins`); turn it on again once Node is fixed.

---

## Installation

### Claude Code: From the Plugin Marketplace (Recommended)

Add the Dethernety marketplace and install the plugin:

```
/plugin marketplace add dether-net/claude-plugins
/plugin install dethereal@dether.net
```

Or via CLI:

```bash
claude plugin install dethereal@dether.net
```

Point the plugin at your own Dethernety platform; without a URL it uses `http://127.0.0.1:3000`:

```bash
export DETHERNETY_URL=https://dethernety.example.com
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

### Codex and OpenCode

Each harness's status says how far it is tested:

- **Claude Code — Stable.** The main target; the full workflow is tested on every release.
- **Codex — Experimental.** Runs the workflow end to end in our tests; expect rough edges.
- **OpenCode — Preview.** Runs the workflow end to end, but in our tests the model can skip a checkpoint question or write a value different from the one you confirmed.

Codex and OpenCode also lack some features only Claude Code has — on Claude Code, some questions come together in one dialog, and the threat-modeler can start the specialist agents itself (see [Agents, Tools, and Hooks](AGENTS_AND_ARCHITECTURE.md)).

Before you use OpenCode, read its [known issues and their workarounds](README.md#known-issues-on-opencode).

Install with the Dethereal installer. Run it as your own user: it refuses to run as root, and on Windows.

```bash
npx @dether.net/dethereal install --harness codex,opencode --scope user
```

- **`--harness`** takes `claude`, `codex`, `opencode`, or a comma list. `claude` installs the Claude Code plugin through Claude Code's own plugin command.
- **`--scope user`** installs for every project of your user; **`--scope project --project <dir>`** for one project. On Codex, a project install needs a project Codex trusts; otherwise the installer installs for your user instead and says so.
- **`--platform-url <url>`** sets the platform URL the install records. Without it, off a terminal or with `--yes`, a re-install keeps the URL already recorded, and a first install uses `http://127.0.0.1:3000`. On a terminal, the installer asks for the URL; pressing Enter takes the one Claude Code already has for the plugin, else the one an earlier install recorded, else `http://127.0.0.1:3000`.
- **`--allow-unverified-opencode`** installs for an OpenCode newer than the versions Dethereal is checked with (see [Harness Versions](#harness-versions)). Without it, the installer refuses that OpenCode, writes nothing for it, and names the flag. The Dethereal plugin relies on OpenCode hooks that OpenCode marks experimental, so a newer OpenCode may have changed them. `dethereal doctor` then warns about the unverified version until OpenCode is a checked one again. It also warns that the install allowed an unverified OpenCode, and that warning stays until you install again without needing the flag.
- **`--yes`** asks nothing: the installer does not prompt, so `--harness` and `--scope` (and `--project`, for a project) must be given. Off a terminal, or with `CI` set, it never prompts either.
- On a terminal, the installer asks for what you leave out. Before it changes anything, it shows what it will add and what each harness may run without asking.
- Codex and OpenCode run the MCP server from a runtime the installer copies to `~/.dethernety/runtime/`. Codex asks you to trust the plugin's hooks before they run.
- Each harness is reported on its own. If one fails, run the same command again with just that `--harness`.

**A project install is per machine.** On Codex and OpenCode, `--scope project` writes this machine's absolute paths — its Node binary and the Dethereal runtime under your home directory — into project files: `.codex/config.toml` for Codex, and the `dethereal*` files under `.opencode/` and the Dethereal entries in `opencode.json` for OpenCode. The installer adds no ignore rule for them, so keep them out of version control yourself, and have each team member run the installer on their own machine rather than commit those files. On Claude Code, the [settings.json entries above](#for-team-projects) are the way to share the plugin with a team.

Start a new session in the harness after installing.

**Checking and removing an install:**

- `npx @dether.net/dethereal doctor` checks an install. **`--harness`** limits it to some harnesses, **`--project <dir>`** checks a project's install, and **`--json`** prints the checks as JSON, with the tools that run without asking and the ones that ask, by name. **`--live-opencode`** also runs OpenCode to check that it loads the Dethereal plugin and applies the approval rules as installed. That run loads OpenCode's plugins — your own and, in a project, the project's own, which may install their dependencies and start their MCP servers — so use it only where you trust them.
- `npx @dether.net/dethereal uninstall --harness <names> --scope <user|project>` removes what the installer added. **`--forget-missing-project`** forgets a project install whose folder no longer exists; without it, uninstall refuses that entry and keeps it recorded. **`--purge-backups`** also deletes the backups the installer kept of the files it changed, but only once nothing is installed any more; while another install remains they are kept, since they are the way back to your files as they were. **`--yes`** asks nothing, as with install.
- When the last install is gone, uninstall on a terminal offers to remove the runtime in `~/.dethernety/runtime/`; it never touches your sign-ins beside it. Otherwise, `npx @dether.net/dethereal gc` removes runtimes no install uses any more (with `--yes` off a terminal).

### From Source (Contributors)

If you're developing from a clone of [dether-net/dethernety-oss](https://github.com/dether-net/dethernety-oss), run these from the repository root:

```bash
# Install dependencies and build the plugin (and the packages it depends on)
pnpm install
pnpm build --filter=@dether.net/dethereal

# Load it locally in Claude Code
claude --plugin-dir apps/dethereal
```

### Configuration

| Setting | Default | Purpose |
|---------|---------|---------|
| `DETHERNETY_URL` (environment variable) | — | Platform URL. Set in your shell, it wins over every other setting |
| The plugin's platform URL (`platform_url` in Claude Code; `--platform-url` with the installer) | `http://127.0.0.1:3000` | Platform URL, used when `DETHERNETY_URL` is not set |

Sign-ins are stored per platform address. If you come from 0.4.x, whose default address was `http://localhost:3003`, see [Upgrading from 0.4.x](#upgrading-from-04x).

**The platform URL must use HTTPS unless the host is `localhost`, `127.0.0.1`, or `::1`.** Plain `http://` to any other host — a self-hosted instance on an internal address, for example — is rejected with a configuration error that names the setting the URL came from, for example:

> DETHERNETY_URL must use HTTPS for non-localhost connections. HTTP is only permitted for localhost, 127.0.0.1, and ::1.

The MCP server still starts, and its tools stay listed, but every tool that would reach the platform returns this error instead. The session's orientation message says so too: *The platform URL is not usable (it must use HTTPS unless it is local); platform tools will report why.* If platform calls fail this way, check the scheme first. Put a TLS-terminating proxy in front of a remote instance, or reach it over an SSH tunnel to `localhost`.

In no-auth mode the platform runs with authentication disabled (`ENABLE_NOAUTH=true`), and Dethereal detects this automatically.

---

## Upgrading from 0.4.x

Dethereal 0.4.x was a Claude Code plugin only; Codex and OpenCode are new in 0.5.0. If you used 0.4.x in Claude Code, these changes reach you:

- **Node.js 20.11.1 or later.** 0.4.x accepted Node 20.0.0. On an older Node, 0.5.0's server and installer stop at once with `Dethereal needs Node.js 20.11.1 or newer (running <version>).` (on Node 14.8 or later; an older Node cannot load Dethereal at all). Update Node first.
  - **On an older Node, the guards block your tools.** On a Node from 14.8 up to 20.11.0, Dethereal's secret and config guards block every Read, Grep, Bash, Write, Edit, MultiEdit and NotebookEdit call in each project where the plugin is enabled, on any Claude Code version, until you update Node or turn the plugin off with `/plugin`; on Claude Code 2.1.295 or later, so does a missing `node`. See [Harness Versions](#harness-versions) for the fixes.
  - **If you update through Claude Code itself** (`/plugin`, `claude plugin update` or the marketplace's auto-update) on a Node older than 20.11.1, update Node first. The installer stops on an older Node before it changes anything, but an update through Claude Code does not, and the guards then block your tools from the next session on.
- **The server ships inside the plugin.** 0.4.x started its MCP server with `npx @dether.net/dethereal@<version>`, fetched from npm. 0.5.0 runs it with `node` from the plugin's own files, so the plugin and its server are always the same version and nothing is fetched when a session starts. `node` must be on the `PATH` Claude Code runs with.
- **The platform URL is a plugin setting.** 0.4.x read only `DETHERNETY_URL`, and without it used `http://localhost:3003`. 0.5.0 adds the plugin's platform URL setting (`platform_url`), whose default is `http://127.0.0.1:3000`; a `DETHERNETY_URL` set in your shell still wins over it.
  - **You export `DETHERNETY_URL`:** nothing changes. The plugin talks to the same platform, and your sign-in carries over.
  - **You relied on the old default:** the plugin now talks to `http://127.0.0.1:3000`. Point it at your platform (with `--platform-url` when you update with the installer, below, or with `DETHERNETY_URL`). Sign-ins are stored per platform address, so unless you give exactly the address you used before, run `/dethereal:login` again.
- **Your models stay full models.** A model made with 0.4.x records no mode, so it counts as a full model: `/dethereal:threat-model` on it continues as a full run, as before. Only a new model is a quick model by default; add `--full` when you create one to build it in full (see [Quick Mode](GUIDED_WORKFLOW.md#quick-mode)).

**To update**, run the installer for Claude Code (it needs Claude Code 2.1.287 or later; add `--scope project --project <dir>` in place of `--scope user` if you installed the plugin for one project):

```bash
npx @dether.net/dethereal install --harness claude --scope user --platform-url https://dethernety.example.com
```

It updates the `dether.net` marketplace (`claude plugin marketplace update`), then the plugin (`claude plugin update`), sets the platform URL you give, and checks that Claude Code now lists the plugin enabled at the installer's version. Leave out `--platform-url` on a terminal and it asks for the URL. The plugin was installed before the installer ran, so a later `dethereal uninstall` leaves it installed.

Restart any Claude Code session that was open: it keeps running 0.4.x until then. Then run `/dethereal:status` to check the platform address and your sign-in.

For the other changes in 0.5.0, see the [CHANGELOG](../../../CHANGELOG.md) and its *Upgrading* notes.

---

## Your First Session

When you start a session with the plugin loaded and no models tracked yet, the plugin gives the assistant an orientation note. The assistant may show it to you or summarise it; it is not printed word for word.

The note comes from a session-start hook, so not every harness gives it:

- **Claude Code** — always.
- **Codex** — only once you have trusted the plugin's hooks; until then, Codex runs none of them. Without hook trust, run `$dethereal:status` or `$dethereal:help` instead.
- **OpenCode** — never: the OpenCode plugin has no session-start hook. Run `/dethereal-status` to check the connection and your sign-in, or `/dethereal-help` for the commands.

The note reads:

```
Dethereal threat modeling is active.

  /dethereal:create   -- Create or import your first threat model
  /dethereal:status   -- Check connection and sign-in
  /dethereal:help     -- See all available commands

  Or describe your system in plain language, for example:
  "a React frontend talking to a Go API with a PostgreSQL database"
```

The commands appear in your harness's own form (see [Slash Command Syntax](COMMAND_REFERENCE.md#slash-command-syntax)).

That last block is not decoration. You do not have to start with a command — describing your system in plain language is a first-class entry point, and the plugin turns the description into a model.

If no platform URL is configured at all, one more line follows:

```
  Platform URL not set; using the local default. Sign in with /dethereal:login when needed.
```

The plugin does not contact the platform to show this line; it only notes that neither `DETHERNETY_URL` nor the plugin's platform URL setting is set. It is a hint, not a blocker — you can create and enrich a model entirely offline, and connect later. A URL that is set but cannot be used gets its own line instead (see [Configuration](#configuration)).

Once you have models, this orientation is replaced by a short resume hint. With a single model it names the model, its workflow state, its quality score, and any stale elements, then lists up to three suggested next commands under `Suggested next:`; with several it gives the count and points you at `/dethereal:status`.

### Checking Connection Status

Run `/dethereal:status` to verify everything is connected:

```
Dethernety status
─────────────────────────────────────────
Platform:   https://dethernety.example.com
Sign-in:    Not signed in — run /dethereal:login
─────────────────────────────────────────

No local models. Run /dethereal:create to get started.

/dethereal:help lists the commands.
```

---

## Authentication

Run `/dethereal:login` to sign in to the platform. It starts a sign-in in your browser:

```
> /dethereal:login

Signed in (signed in).
Platform:     https://dethernety.example.com
Account:      user@example.com
Valid for:    60 minutes
```

The first line says `already signed in` when your session was still valid, and `session renewed` when an expired one was refreshed. Use `/dethereal:login --new` to start a fresh sign-in even when a session exists — for example, to switch accounts.

If the sign-in has not finished when the command returns, you see instead:

```
Not signed in yet. Open <sign-in URL> in your browser and sign in, then run /dethereal:login again.
```

Open the URL, sign in, and run the command again (or tell the assistant you have signed in); it picks up the pending sign-in.

### How Authentication Works

- **OAuth 2.0 with PKCE** — secure browser-based login, no passwords in the terminal
- **Local session** — the plugin's MCP server keeps your session under `~/.dethernety/` in your home directory, keyed by platform URL. The tokens stay inside the server: no tool returns them, and the commands check your session through the server rather than by reading that directory
- **Auto-refresh** — an expired session is refreshed transparently on the next command when a valid refresh token exists
- **Browser on the plugin's machine** — sign-in tries to open your browser on the machine the plugin runs on. If no browser can be opened, or the sign-in has not finished within about 30 seconds, the command returns a local sign-in URL (`http://127.0.0.1:<port>/start`) for you to open yourself, then run `/dethereal:login` again. That URL is served on the plugin's machine and expires after a few minutes, so open it in a browser there
- **Auth-disabled mode** — if the platform has auth disabled (no-auth), all tools work without login

### Token Security

- Never commit `~/.dethernety/` to version control, and never copy its token file between machines by hand — sign in on each machine instead
- Tokens are specific to each platform URL — switching instances requires separate auth
- Use `/dethereal:login` to re-authenticate if your session expires
- To sign out, ask the assistant to log you out. The plugin deletes the local session first, so signing out never depends on the network, then revokes the session's refresh token at the platform's identity provider and reports the provider's answer. If the platform cannot be reached, or the plugin's configuration or runtime cannot be trusted with the session, the revocation is skipped and reported; if the identity provider refuses it or cannot be reached, it is reported as failed. Either way, the session stays valid at the identity provider until its refresh token expires, unless an identity-provider administrator revokes it. An access token already issued is not revoked by the plugin and can stay valid until it expires. Signing out of the platform's web interface does not necessarily end the plugin's session

---

## Creating Your First Model

There are four ways to create a model. A model you describe, start from a template or import is a **quick model** unless you add `--full`; a model pulled from the platform is a full model (see [What to Do Next](#what-to-do-next)). For your first time, describing your system in natural language is the easiest:

### Option 1: Describe Your System (Recommended)

```
> /dethereal:create a web application with a React frontend served by nginx,
  a Node.js API backend, a PostgreSQL database, and user authentication via OAuth
```

The plugin will:
1. Ask one scoping question: your most valuable assets (crown jewels), what you trust, the adversary classes to consider, anything out of scope, and compliance requirements
2. Create the model directory with its scope as soon as you answer
3. Identify components, trust boundaries, and data flows from your description
4. Present them for your confirmation before writing the structure

### Option 2: Start From a Template

```
> /dethereal:create template web_app
```

Available templates: `web_app`, `api_service`, `microservices`.

Two further example models exist — `simple` (the tool's default) and `database` — but `/dethereal:create` deliberately offers only the three above. Those two are minimal, one- and two-component skeletons; they are reachable through the `get_example_models` tool and are useful as schema references, not as a starting point for a real model.

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
│   ├── scope.json         # Scope definition (crown jewels, compliance)
│   └── control-audit.log  # Append-only ledger of shared-ownership decisions
│                          # (created on the first audit-logged push; stays on this machine, gitignore)
├── attributes/            # Security attributes (populated during enrichment)
│   ├── boundaries/
│   ├── components/
│   ├── dataFlows/
│   └── dataItems/
└── controls/              # Per-Control library files (created when first Control
    └── ...                # is referenced by an element; one file per Control)
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

- **state.json** — where you are in the modeling process (6 states from INITIALIZED to REVIEWED); committed with the model
- **scope.json** — what you said about the system's crown jewels, compliance requirements, and trust assumptions
- **quality.json** — quality score cache (created after first quality check)
- **sync.json** — sync metadata (created after first platform push/pull); this machine's own, and kept out of git by the server

---

## Example Walkthrough

Here's a complete first-model session:

```
> /dethereal:create I have a React SPA, a Node.js API, and PostgreSQL

I'll create a threat model for your system. To scope the model: what are the most
valuable assets in this system (crown jewels)? What do you explicitly trust? Which
adversary classes should it consider (external, insider, supply_chain, others)?
Anything out of scope? Any compliance requirements?

> Crown jewels: user account data and session tokens. We trust the AWS
  infrastructure. Consider external attackers and insiders. Nothing out of scope.
  SOC2.

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

Confirm this structure, or adjust specific rows? (confirm / adjust)

> confirm

[done] Model "My Web App" created with 4 components, 3 data flows. Quality: 28/100.
[next] When you're ready: /dethereal:discover (scan the codebase for more infrastructure)
[info] Quick model: /dethereal:threat-model continues it; with --full it builds it in full.
Run /dethereal:help to see all available commands.
```

---

## What to Do Next

After creating your model, you have two paths:

### The Guided Workflow (Recommended)

Run `/dethereal:threat-model` on your model to continue through the 11 steps — from discovery and classification through enrichment, validation, and platform sync. A model you created is a quick model unless you created it with `--full`, and the run keeps that mode: a quick model gets a shorter first pass, which enriches only the priority set and is not reviewed (no Gate 3 review) until you deepen it with `--full`. Add `--full` for the full run, the most thorough approach. A model pulled from the platform is a full model and continues as a full run. See [The 11-Step Guided Workflow](GUIDED_WORKFLOW.md).

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

**What to gitignore:** the control audit log, a few transient working files, and backups. Copy the full list from [What to Commit](SYNC_AND_VERSION_CONTROL.md#what-to-commit) — and use its per-file rules rather than ignoring the whole `.dethereal/` directory.

This machine's records — `.dethereal/sync.json` and the enrichment relay files in `.dethereal/relay/` — need no entry: the Dethereal server lists them in the model's own `.dethereal/.gitignore`.

Token storage (`~/.dethernety/`) is in your home directory, outside the repository — no gitignore entry needed.

See [Sync and Version Control](SYNC_AND_VERSION_CONTROL.md) for the full version control workflow.

---

**Next:** [The 11-Step Guided Workflow](GUIDED_WORKFLOW.md) — walk through the complete modeling process
