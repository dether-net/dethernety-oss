# Dethereal Plugin -- Architecture for Claude Code, Codex and OpenCode

> Architecture of the Dethereal plugin for professional Dethernety threat modeling: one workflow, rendered into a bundle for each of Claude Code, Codex and OpenCode, with the MCP server it ships.

## Table of Contents

- [1. Vision and Scope](#1-vision-and-scope)
- [2. Plugin Structure](#2-plugin-structure)
- [3. Skills (Slash Commands)](#3-skills-slash-commands)
- [4. Subagent Architecture](#4-subagent-architecture)
- [5. MCP Server](#5-mcp-server)
- [6. Hooks](#6-hooks)
- [7. Settings and Configuration](#7-settings-and-configuration)
- [8. Multi-Module Selection](#8-multi-module-selection)
- [9. Architecture Decision: MCP vs Skills for Documentation](#9-architecture-decision-mcp-vs-skills-for-documentation-d47)

---

## 1. Vision and Scope

### What It Is

> **Harness status.** Each status says how far the harness is tested. Claude Code is **Stable**: the main target, with the full workflow tested on every release. Codex is **Experimental**: it runs the workflow end to end in our tests, with rough edges to expect. OpenCode is **Preview**: it runs end to end, but in our tests the model can skip a checkpoint question or write a value different from the one the operator confirmed; see its [known issues](../../user/dethereal/README.md#known-issues-on-opencode). Codex and OpenCode run the same workflow without the Claude Code-only parts, such as asking some questions together and the threat-modeler's hand-off to the specialist agents (see [Agent Interaction Pattern](#agent-interaction-pattern)).

The Dethereal plugin turns an AI coding assistant — Claude Code, Codex or OpenCode — into a professional threat modeling workstation. Users install it for their harness with `dethereal install` (see [Installer and Runtime](#installer-and-runtime)) and gain:

- **Skills** (slash commands) for guided and ad-hoc threat modeling workflows
- **Subagents** specialized for discovery, modeling, enrichment, and review
- **MCP server** for authenticated communication with the Dethernety platform
- **Hooks** for session orientation, context preservation after compaction, post-write validation hints, a guard on harness permission configuration, a guard against agent reads of secret files, and (Claude Code) auto-approval of the Dethereal tools that need no operator approval — five hook commands, wired per harness (see [Hooks](#6-hooks))

### What It Does

The plugin assists users to perform the full data flow model creation lifecycle:

1. **Discover** infrastructure components from IaC, code, configs, and architecture diagrams
2. **Model** data flow diagrams with components, trust boundaries, and data flows
3. **Classify** components using module-provided classes from the Dethernety platform
4. **Enrich** with security attributes, MITRE ATT&CK technique mappings, and controls
5. **Validate** model completeness and quality
6. **Sync** local filesystem models with the Dethernety platform

### What It Does Not Do

- **Analysis** -- The plugin creates data flow models; analysis is performed by the platform's analysis modules. The plugin may trigger analysis but does not implement analysis logic.
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

The package `oss/apps/dethereal` is both the npm package `@dether.net/dethereal` (the MCP server, the hook commands and the installer) and the Claude Code plugin: the plugin root is the package root. The Codex and OpenCode bundles ship in the same package.

```
apps/dethereal/
├── .claude-plugin/
│   └── plugin.json                    # Claude Code plugin manifest (generated)
├── bundles/                           # Generated bundles, one per harness (committed, published)
│   ├── claude/
│   │   ├── .mcp.json                  # MCP server registration: node ${CLAUDE_PLUGIN_ROOT}/dist/index.js
│   │   ├── hooks/hooks.json           # SessionStart, PreToolUse, PostToolUse hooks
│   │   ├── agents/                    # 6 agents: threat-modeler, infrastructure-scout,
│   │   │                              #   infrastructure-scout-scoped, security-enricher, model-reviewer,
│   │   │                              #   enrichment-applier
│   │   ├── skills/<name>/SKILL.md     # 17 skills: 14 slash commands + 3 companions,
│   │   │                              #   each with the reference files it reads on demand
│   │   └── bundle.json                # File list and hashes of the bundle
│   ├── codex/
│   │   ├── .agents/plugins/marketplace.json   # Local marketplace for Codex's plugin CLI
│   │   ├── plugins/dethereal/         # Codex plugin: .codex-plugin/plugin.json, skills/,
│   │   │                              #   hooks/hooks.json and the hook scripts in bin/
│   │   ├── agents/dethereal-*.toml    # The 6 agents as Codex agent files
│   │   ├── config.fragment.toml       # [mcp_servers.dethereal] with per-tool approval modes
│   │   └── bundle.json
│   └── opencode/
│       ├── skills/dethereal-<name>/   # The 17 skills, named dethereal-<name>
│       ├── agents/dethereal-*.md      # The 6 agents, with their OpenCode permissions
│       ├── commands/                  # dethereal-review, dethereal-surface (run as the model-reviewer)
│       ├── plugins/dethereal.ts       # OpenCode plugin: guards, post-write hint, compaction reminder
│       ├── mcp.fragment.json          # MCP server entry and the ask rules
│       └── bundle.json
├── workflow/                          # Single source of skills and agents
│   ├── skills/<name>/SKILL.md
│   ├── agents/*.md
│   ├── shared/                        # Fragments (protocols, guidelines-*.md, controls-enrichment.md, …)
│   │   └── prompts.yaml               # Prompt registry: every question the workflow asks
│   └── harness/{claude,codex,opencode}.yaml   # Per-harness settings (manifest fields, userConfig, …)
├── src/
│   ├── index.ts                       # Entry: the MCP server without arguments, the CLI with arguments
│   ├── server.ts                      # MCP server
│   ├── tools/                         # The 30 tools; manifest.ts holds each tool's approval class
│   ├── auth/, client/, utils/         # Sign-in and session store, platform client, model files and state
│   ├── cli/                           # Hook commands (session-start, post-write, config-guard, approve, secret-guard)
│   ├── installer/                     # dethereal install | uninstall | doctor | gc
│   ├── generator/                     # Renders workflow/ into the harness bundles (run with tsx)
│   └── packaging/                     # Build-time checks that the shipped bundle is self-contained
├── dist/                              # Compiled server + CLI; bundles every runtime dependency
├── dev/                               # Developer tooling (not published)
├── scripts/                           # Release tooling (not published)
├── package.json
└── CLAUDE.md                          # Development guide (not published)
```

### Single Source and Generated Bundles

Skills and agents are written once, in [`workflow/`](../../../apps/dethereal/workflow/), and never by hand in a bundle. The generator ([`src/generator/`](../../../apps/dethereal/src/generator/)) renders them into a bundle per harness — Claude Code, Codex and OpenCode — resolving `{{include shared/…}}` fragments, tool and command names, and harness-specific blocks. The hooks are not in `workflow/`: each harness target of the generator emits its own wiring (`hooksConfig` in `targets/claude/index.ts`, the hook scripts in `targets/codex/assets/`, the plugin in `targets/opencode/plugin.ts`), and the hook logic is the package CLI's `hook` commands ([`src/cli/`](../../../apps/dethereal/src/cli/)):

- A plain include is inlined; an `as-file` include is emitted as a file next to the skill's `SKILL.md` and read on demand, which keeps each skill within its instruction budget.
- All three bundles are generated, committed and published: `.claude-plugin/plugin.json` and `bundles/claude/**` (Claude's plugin root is the package root), `bundles/codex/**` and `bundles/opencode/**`, which the installer copies into its runtime. A test (`src/generator/__tests__/package-root.test.ts`) keeps them byte-equal to the generator's output, each at the package version.
- `pnpm golden:update` regenerates the generator goldens and the package root; `tsx src/generator/cli.ts --package-root` regenerates the package root alone.
- Both refuse while `skills/`, `commands/`, `agents/`, `hooks/`, `.mcp.json` or `settings.json` exists at the package root. Claude Code loads those default paths **on top of** the manifest, so a root `hooks/hooks.json` next to the manifest's hooks path would run every hook twice.

The published file list is `dist`, `.claude-plugin`, `bundles/claude`, `bundles/codex`, `bundles/opencode` and `src/utils/source-globs.v1.json`. `CLAUDE.md` is not shipped: `package.json` is the only file published at the package root (checked by `src/__tests__/packaging.test.ts`).

### Generator: Lints, Prompt Registry, Rule Ledger, Per-Harness Output

Rendering is only part of what the generator does; a generation with any finding fails, listing every finding:

- **Lints** ([`lint.ts`](../../../apps/dethereal/src/generator/lint.ts)). Source rules read the harness-neutral workflow — for example, no literal Claude tool names, MCP tool names, `/dethereal:` commands or `$ARGUMENTS` outside a Claude-only block, and no reference to the session token store. Output rules read what one harness's rendering produced.
- **Prompt registry** ([`registry.ts`](../../../apps/dethereal/src/generator/registry.ts), `workflow/shared/prompts.yaml`). Every question the workflow asks (`{{#ask id=…}}`) is registered with its owning skill, whether it is mandatory, its trigger, what is shown before it, what the answer decides and its closed set of options; the lint holds the workflow to the registry.
- **Rule ledger** ([`ledger.ts`](../../../apps/dethereal/src/generator/ledger.ts), `src/generator/ledger/`), checked separately rather than by a generation. Every rule extracted from the prose a workflow was migrated from is either placed — its anchor phrase present in every consumer's generated output, for every harness — or dropped with a recorded reason; `--ledger-check` fails on anything else.
- **Per-harness output.** Tool names take each harness's prefix (`mcp__plugin_dethereal_dethereal__<tool>` on Claude Code, `mcp__dethereal__<tool>` on Codex, `dethereal_<tool>` on OpenCode); commands are `/dethereal:<name>`, `$dethereal:<name>` and `/dethereal-<name>`. Codex agents are TOML files; OpenCode skills and agents carry a `dethereal-` prefix. On Codex a delegation becomes `spawn_agent` / `wait_agent` / `close_agent`, and `review` and `surface` hand their work to the model-reviewer as a `task.md` beside the skill; on OpenCode they also ship as commands that run as the model-reviewer.

### Model Storage

Models are stored at user-chosen visible paths (e.g., `./threat-models/production-stack/`). The SplitModel format (`manifest.json`, `structure.json`, etc.) lives at the user-chosen model path.

**`.dethernety/`** at the project root is plugin metadata only:
- `models.json` -- registry of model paths
- `discovery-cache.json` -- shared discovery results across models in multi-model projects (D55). Saves 15-25K tokens per subsequent model.
- `decomposition-plan.json` -- optional: planned models, completion status, cross-model links (D58). Written when user accepts a decomposition recommendation.

**Per-model metadata** in `<model-path>/.dethereal/`, written by the MCP server unless noted:
- `state.json` -- workflow state (with `state.lock`, the lock the server takes while it changes the state)
- `scope.json` -- scope definition (written by the workflow)
- `discovery.json` -- discovery provenance (written by the workflow)
- `quality.json` -- the last quality result, read by status and help
- `enrichment-pending.json` -- read only with the settlement on: enrichment values awaiting the operator's confirmation. The guided workflow writes none
- `loop-back.json` -- an open loop back from the review step
- `class-cache/` -- class definitions cached by `generate_attribute_stubs`
- `template-fields/` -- per element, the class template fields `generate_attribute_stubs` added
- `control-audit.log`, `pending-id-rewrite.json` -- the control library's audit log and recovery journal, local to this machine
- `settlement-baseline.json`, `settlements.json`, `sync.json` -- **this machine's records**: the operator's registered values (written only with the settlement on; see [MCP_ARCHITECTURE.md → Settlement Switch](MCP_ARCHITECTURE.md#settlement-switch)) and the sync record. The server keeps them out of git with `.dethereal/.gitignore`, which also lists `control-audit.log` and `relay/`.
- `relay/` -- the enrichment relay files, `run-<n>.txt`, one per `security-enricher` enrichment run: in Step 8, where the main conversation and the `enrichment-applier` read them, or in an enrichment the `threat-modeler` hands to the `security-enricher` directly ([`workflow/agents/threat-modeler.md`](../../../apps/dethereal/workflow/agents/threat-modeler.md)), where the `threat-modeler` shows the file. Local to this machine and listed in `.dethereal/.gitignore`. The server never deletes them: the workflow reads them only by the exact paths its current runs name, so files from earlier passes stay, and the operator may delete `.dethereal/relay/` by hand when no enrichment is running.

Discovery tells the operator which files git keeps: `state.json`, `scope.json`, `discovery.json`, `quality.json`, `class-cache/` and `template-fields/` are committed with the model; it recommends `.gitignore` entries for the control library's two files, the lock and temporary files in `.dethereal/`, and the project's `discovery-cache.json`.

> **Naming distinction:** `.dethernety/` (project root) = plugin-level metadata (model registry, shared discovery, decomposition plan). `.dethereal/` (per-model) = per-model workflow metadata (state, discovery, quality). The names differ intentionally — `.dethernety/` relates to the platform, `.dethereal/` relates to the plugin.

### Plugin Manifest (`.claude-plugin/plugin.json`)

Generated from `workflow/harness/claude.yaml` and the package's `package.json`:

```json
{
  "name": "dethereal",
  "version": "<package.json version>",
  "description": "Professional threat modeling for Claude Code. Discover infrastructure, build data flow diagrams, enrich with security attributes, and sync with the Dethernety platform.",
  "author": { "name": "dether.net", "url": "https://dether.net" },
  "homepage": "https://github.com/dether-net/dethernety-oss",
  "repository": "https://github.com/dether-net/dethernety-oss",
  "license": "AGPL-3.0",
  "keywords": ["threat-modeling", "cybersecurity", "mitre-attack", "data-flow-diagram", "security-analysis"],
  "skills": ["./bundles/claude/skills/"],
  "agents": [
    "./bundles/claude/agents/enrichment-applier.md",
    "./bundles/claude/agents/infrastructure-scout-scoped.md",
    "./bundles/claude/agents/infrastructure-scout.md",
    "./bundles/claude/agents/model-reviewer.md",
    "./bundles/claude/agents/security-enricher.md",
    "./bundles/claude/agents/threat-modeler.md"
  ],
  "hooks": "./bundles/claude/hooks/hooks.json",
  "mcpServers": "./bundles/claude/.mcp.json",
  "userConfig": {
    "platform_url": {
      "type": "string",
      "title": "Dethernety platform URL",
      "description": "Base URL of the Dethernety platform. A DETHERNETY_URL set in your shell takes precedence.",
      "default": "http://127.0.0.1:3000",
      "sensitive": false
    }
  }
}
```

The version always equals `package.json`'s — it names the installed plugin directory, and a test enforces it. `prepack` regenerates the package root, so a packed release always carries the package version; after a version bump the committed copy must be regenerated too (`pnpm golden:update`), or the package-root test fails.

### MCP Server Configuration (`bundles/claude/.mcp.json`)

```json
{
  "mcpServers": {
    "dethereal": {
      "type": "stdio",
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/index.js"],
      "env": {
        "DETHERNETY_PLATFORM_URL": "${user_config.platform_url}"
      }
    }
  }
}
```

**The plugin runs the server it ships.** `${CLAUDE_PLUGIN_ROOT}` is the installed package, and `dist/` bundles every runtime dependency, so there is no install step and no `npx`. The skills and agents and the MCP tools they call are always the same version, because they are the same package.

The platform URL comes from the `platform_url` user config, passed as `DETHERNETY_PLATFORM_URL`. A `DETHERNETY_URL` exported in the shell still wins; with neither, the server uses `http://127.0.0.1:3000`. Hooks run without this env block and receive the same user config as `CLAUDE_PLUGIN_OPTION_PLATFORM_URL`. See [MCP_ARCHITECTURE.md §10](MCP_ARCHITECTURE.md#10-configuration).

**On Codex** the installer writes the server into Codex's `config.toml` as `[mcp_servers.dethereal]`. The URL given at install, or the package default, goes into its `env` as `DETHERNETY_PLATFORM_URL`, and its `env_vars` lists `DETHERNETY_URL`, so a `DETHERNETY_URL` in the environment Codex starts with reaches the server and wins, as on Claude Code; a re-run of install without a URL keeps the previous install's URL while the installer's part of the config is untouched. Two Codex behaviours limit this: Codex reads `env_vars` from the process that starts the server, so a long-lived Codex app-server keeps the value it started with until it is restarted; and Codex merges a server's `env` across configuration layers key by key, so an older user-level install that still pins `DETHERNETY_URL` overrides a project install's URL — a project install says so and asks to reinstall for the user.

**On OpenCode** the installer merges the server into `opencode.json` (or `opencode.jsonc`) with the same `DETHERNETY_PLATFORM_URL` in its `environment`. OpenCode starts a local server with its own environment and lays that entry over it, so a `DETHERNETY_URL` in the environment OpenCode starts with wins here too. The plugin passes the install URL to its hook processes the same way, with the shell value still winning.

The installer writes to a project's `.codex/` only when Codex would load that folder, by Codex's own trust rule: the folder's own `projects` trust setting decides; without one, that of the project root (the nearest folder above holding `.git`); for a linked git worktree without either, that of its main checkout. A setting on any other folder above does not count; otherwise the install goes user-wide and says so.

### Installer and Runtime

`dethereal install`, `uninstall`, `doctor` and `gc` ([`src/installer/`](../../../apps/dethereal/src/installer/)) install the plugin per harness (`--harness claude,codex,opencode`, `--scope user|project`). Before it changes anything, `install` prints what it is about to add; each harness then succeeds or fails on its own, and a failed harness is retried alone.

- **Claude Code** runs the plugin from its own copy. The installer goes through Claude's own CLI (`claude plugin …`) — marketplace, plugin and platform URL — and writes no Claude file itself.
- **Codex and OpenCode** run the server from the installer's **runtime**: a read-only copy of the package's `dist/` and `bundles/` under `~/.dethernety/runtime/<version>/`, launched with the recorded Node binary. `runtime/current.json` names the active runtime, its Node binary and a hash of its whole file set; it is written last.
  - **Codex** — the `[mcp_servers.dethereal]` block in `config.toml`, the agent files into `agents/` beside it, then, through Codex's CLI, a local marketplace (the runtime's `bundles/codex`) and the plugin (skills and hooks) from it.
  - **OpenCode** — the skills, agents, commands and the plugin file into the OpenCode config folder (`<project>/.opencode/`, or the user's), then the MCP server, the ask rules and the denies on `~/.dethernety` in that scope's `opencode.json`. OpenCode has no install command, so every file goes through the installer's own recorded writes.
- **`doctor`** checks what is installed the way each harness will use it, writing nothing; `doctor --json` includes the `tool approvals` check (see [Tools by Approval](#tools-by-approval)).
- **`gc`** removes installed runtimes nothing uses any more.

### Installer Internals

What a contributor needs before changing [`src/installer/`](../../../apps/dethereal/src/installer/).

**Who may run it.** Only a normal user on a POSIX system: `assertSupported` ([`core/paths.ts`](../../../apps/dethereal/src/installer/core/paths.ts)) refuses an effective uid of 0 (`running_as_root`) and Windows. Every root the installer writes under (the home, `CODEX_HOME`, the XDG config home, a project) is resolved with `realpath` once and must be a directory the user owns that is not group- or world-writable. Every write goes through the path-safe writer ([`core/safe-write.ts`](../../../apps/dethereal/src/installer/core/safe-write.ts)): only targets matching the caller's allowed templates, no symbolic link followed below a root, and a file replaced through a no-follow temporary file in the same folder.

**The state root.** `~/.dethernety/` is created at mode 0700; a symlink, another owner, or group or world write access is refused, and a folder others can only read is tightened to 0700. Beside the server's sign-in store (`tokens.json`) and `waiver.key`, it holds:

| Path | What it is |
|------|------------|
| `installs.json` | The install manifest ([`core/manifest.ts`](../../../apps/dethereal/src/installer/core/manifest.ts)): one entry per harness and scope (`codex:user`, `opencode:project:<realpath>`, …), each listing the files written, with the sha256 of what each held before (`pre`, or `absent`) and of what was written (`post`), the backup id, and who wrote it (the installer, or a harness CLI it ran). Its paths are checked against the allowed templates before anything is restored or removed: the manifest is data, not authority |
| `installs.lock` | The install lock: one cross-process lock, held across a harness's whole install or uninstall and taken around every manifest change |
| `backups/` | Backups of the files the installer changes, named by id and content hash, never by the user's path; `backups/index.json` keeps each file's first backup for good and its three most recent ([`core/backup.ts`](../../../apps/dethereal/src/installer/core/backup.ts)) |
| `runtime/<version>/`, `runtime/current.json` | The Codex and OpenCode runtime (see [Installer and Runtime](#installer-and-runtime)): written to a temporary folder, renamed into place and made read-only; `current.json` is written last ([`core/runtime.ts`](../../../apps/dethereal/src/installer/core/runtime.ts)) |

**One file change, one transaction** ([`core/transaction.ts`](../../../apps/dethereal/src/installer/core/transaction.ts)). Under the install lock, `applyFileChange` re-reads the target, which must still hold what the caller planned against (every prompt comes before); backs up its current content, if it has any; records a `pending` entry; writes the file atomically; then marks the record `committed`. A write that never landed drops its record. An interruption leaves:

- at the backup step: no record, only a backup nothing references;
- after the record is saved: a `pending` record. An uninstall, or an OpenCode re-install, settles it through `revertFile`: a file still holding its `pre` drops the record, one holding its `post` is restored from its backup (or deleted, if the installer created it), and one edited since keeps only the user's part, or is left and reported. A Codex re-install's pre-check ([`writers/codex/index.ts`](../../../apps/dethereal/src/installer/writers/codex/index.ts)) refuses an agent file that does not hold what was written, or a `config.toml` whose Dethereal part cannot be taken out, until an uninstall settles it; a missing file's record is dropped.

On Claude Code, a file Claude's CLI wrote is recorded without a backup and undone through `claude plugin`. Codex's CLI steps, the marketplace and the plugin, are recorded as state in the manifest (the entry's `cli` and the shared Codex record), not as files, and are undone through Codex's CLI when the last Codex entry is uninstalled. A Codex install that fails part way rolls back what it wrote; an OpenCode upgrade stops before it touches anything when a file of the previous install was changed since, and never overwrites a file it did not write.

**Version gates.** Each harness is refused below the version it was checked against (`CLAUDE_FLOOR` in `writers/claude/index.ts`, `CODEX_FLOOR` in `writers/codex/cli.ts`, `OPENCODE_FLOOR` in `writers/opencode/rules.ts`, `NODE_FLOOR` in `core/runtime.ts`); OpenCode is also refused above its checked list, `OPENCODE_VERIFIED` in `rules.ts`, unless `--allow-unverified-opencode` is given, and a version joins that list only after the OpenCode smoke run passes against it (the comment in `rules.ts` gives the steps).

The versions, and the `uninstall` and `doctor` flags, are documented for operators in [Harness Versions](../../user/dethereal/GETTING_STARTED.md#harness-versions) and under "Checking and removing an install" in [Codex and OpenCode](../../user/dethereal/GETTING_STARTED.md#codex-and-opencode).

---

## 3. Skills (Slash Commands)

### Skill Categories

#### Getting Started

| Skill | Description | Arguments |
|-------|-------------|-----------|
| `/dethereal:status` | Connection status, auth state, local model summary | `[show models <control id> [directory-path]]` |
| `/dethereal:login` | Authenticate with the Dethernety platform | `[--new]` |
| `/dethereal:help` | List all skills with descriptions | `[command]` |

#### Model Lifecycle

| Skill | Description | Arguments |
|-------|-------------|-----------|
| `/dethereal:create` | Create a new threat model (includes onboarding for first model); a quick model unless `--full` is given, except a pull | `[description or template] [--full]` |
| `/dethereal:sync` | Push local model to platform or pull platform model to local | `push\|pull\|status\|promote-external-edit\|tombstone\|repair-wal [directory-path]` |
| `/dethereal:view` | Render model summary or YAML view | `[model-path] [--format tree\|json\|yaml]` |

> D44: `/dethereal:start` merged into `/dethereal:create` (onboarding mode detected when no models exist). `/dethereal:import` and `/dethereal:export` merged into `/dethereal:sync push` and `/dethereal:sync pull`. `/dethereal:validate` merged into `/dethereal:review --structure-only`.

#### Model Editing

| Skill | Description | Arguments |
|-------|-------------|-----------|
| `/dethereal:discover` | Auto-discover infrastructure from codebase | `[model path] [--scan <directory or file>]` |
| `/dethereal:add` | Add components, boundaries, flows, or data items | `[element description]` |
| `/dethereal:remove` | Remove elements with dependency checking | `[element reference]` |
| `/dethereal:enrich` | Add real configuration data to components | `[all\|priority\|pick] [--focus credentials\|monitoring\|compliance\|controls] [--pick <element-id>]` |
| `/dethereal:classify` | Apply classes to unclassified elements | `[--type components\|flows\|boundaries\|data-items]` |

#### Analysis and Review

| Skill | Description | Arguments |
|-------|-------------|-----------|
| `/dethereal:review` | Model completeness, quality dashboard, and structural validation | `[directory-path] [--structure-only]` |
| `/dethereal:surface` | Attack surface summary with control gap analysis | `[directory-path]` |
| `/dethereal:threat-model` | Guided workflow (scope through publishing); a new model is a quick model unless `--full` is given | `[system description or model path] [--full-scan] [--full\|--quick]` |

#### Companion Skills (not user-invocable)

A parent skill hands over to these; they do not appear as slash commands.

| Skill | Started by | Purpose |
|-------|-----------|---------|
| `dethereal:enrich-controls` | `/dethereal:enrich --focus controls` | The control pass: enforcement, detection and governance controls, then the control library's attributes |
| `dethereal:sync-controls` | `/dethereal:sync push`, `promote-external-edit`, `tombstone`, `repair-wal` | The control library of sync |
| `dethereal:sync-pull` | `/dethereal:sync pull` | Import a platform model into local files |

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
| `status` | yes | -- | -- | `[show models <control id> [directory-path]]` | Reads files and calls MCP tools |
| `login` | yes | -- | -- | `[--new]` | Calls `mcp__plugin_dethereal_dethereal__login` |
| `help` | yes | -- | -- | `[command]` | Calls the `workspace_status` MCP tool for suggestions |
| `create` | yes | -- | -- | `[description or template] [--full]` | Onboarding mode when no models exist |
| `discover` | yes | -- | -- | `[model path] [--scan <directory or file>]` | Delegates scanning to Agent(infrastructure-scout), which writes nothing; the skill writes what the operator confirms |
| `add` | yes | -- | -- | `[element description]` | |
| `remove` | yes | -- | -- | `[element reference]` | |
| `enrich` | yes | -- | -- | `[all\|priority\|pick] [--focus credentials\|monitoring\|compliance\|controls] [--pick <element-id>]` | `--focus controls` hands over to `enrich-controls`, which starts Agent(security-enricher) |
| `classify` | yes | -- | -- | `[--type components\|flows\|boundaries\|data-items]` | |
| `sync` | yes | -- | -- | `push\|pull\|status\|promote-external-edit\|tombstone\|repair-wal [directory-path]` | Hands over to `sync-pull` and `sync-controls` |
| `review` | yes | model-reviewer | fork | `[directory-path] [--structure-only]` | Includes structural validation |
| `surface` | yes | model-reviewer | fork | `[directory-path]` | |
| `threat-model` | yes | -- | -- | `[system description or model path] [--full-scan] [--full\|--quick]` | Primary guided workflow; starts all five specialist agents |
| `view` | yes | -- | -- | `[model-path] [--format tree\|json\|yaml]` | Reads model files and formats output |

> Skills with `context: fork` run in a forked context and do not pollute the main conversation. No skill uses `disable-model-invocation`: every skill, `sync` included, needs LLM processing to read files, call MCP tools, ask the operator and format output. Only `review` and `surface` set `agent`: they run as the model-reviewer, with `background: false` so the review runs in the foreground. Every other skill runs in the main conversation and starts the specialist agents it needs via `Agent()` calls. The `effort` field is set on agents, not on skills — the agent's `effort` governs reasoning depth when the skill delegates to it (D44: removed redundant `effort` from skill frontmatter).

### Key Skill: `/dethereal:threat-model` (Guided Workflow)

This is the "golden path" -- a template-driven skill that orchestrates the full threat modeling process:

1. **Scope Definition** -- System description, modeling intent, compliance drivers, crown jewels
2. **Discovery** -- Delegates to `infrastructure-scout` agent for auto-discovery
3. **Model Review** -- Presents discovered components for confirmation. Runs `match_classes` with the active modules' `moduleIds` — one call per `classLabel`, and for components one call per `componentType` (`PROCESS`, `STORE`, `EXTERNAL_ENTITY`), the only hard type filter — to pre-fill the confirmation table: an `exact_name` match is accepted, `fuzzy_name`, `vector_similarity` and `type_match` candidates are listed to confirm; if the call fails, it falls back to `get_classes` per module and class type (deterministic pass only, saves 3-5K tokens at Step 6). **After confirmation, if validated inventory exceeds complexity thresholds (D55/D56), presents decomposition recommendation** — scope narrowing (default) or decomposition plan, per D57. See THREAT_MODELING_WORKFLOW.md Section 9.
4. **Boundary Refinement** -- Refines the boundary hierarchy first (merge, move or new sub-boundary rows, one `apply all`/`adjust` question), then proposes each leaf boundary's **trust skeleton** (`zone` + `plane`) via `validate_model_json(action: 'zoning', assets: 'skeleton')` together with each boundary's **enforcement posture** — `implicit_deny_enabled`, `allow_any_inbound`, `egress_filtering` (see OPERATIONAL_REQUIREMENTS.md Section 1) — as two tables under one batched `accept all`/`adjust` question, never boundary by boundary. Structural containers abstain and are not nagged (see [TRUST_ZONING.md](TRUST_ZONING.md)). Only accepted rows are written.
5. **Data Flow Mapping** -- Connects components with data flows. Data flow attributes include `auth_failure_mode: "deny" | "fallback" | "fail_open" | "unknown"`. Flows with `fail_open` or `fallback` generate an inline warning during enrichment. Risk-bearing crossings (external → trusted) are surfaced for the operator to ratify as **approved channels (conduits)**, appended OUTBOUND-canonical to `structure.json`; an un-ratified crossing stays a plain flow and re-surfaces as a zoning finding at validation.
6. **Classification** -- Assigns classes from platform modules. High-confidence matches are pre-filled from Step 3; this step handles low-confidence and ambiguous cases using boundary context
7. **Data Item Classification** -- Classifies data sensitivity on flows
8. **Enrichment** -- Populates security-relevant attributes. The worklist comes from the server's Gate 3 snapshot (the Tier 1–2 components that still lack values, crown jewels and cross-boundary pivots): stale elements first, then crown jewels and their mapped elements, the rest of the snapshot, the failing flows, then everything else. The operator can choose `priority` — the snapshot only — for a faster pass. On every harness the `security-enricher` writes cited and derived values at most 12 elements a run — up to 20 when a store takes the flows that touch it along — each run started fresh and writing its tables and questions to `.dethereal/relay/run-<n>.txt`; the main conversation is told to print the run files (it may show a summary instead) and asks one question (`enrichment-relay`). A plain "accept all", or a reply that decides nothing ("continue", "don't know"), writes nothing more; any other reply goes to the `enrichment-applier`. See [One relay turn](../../user/dethereal/GUIDED_WORKFLOW.md#one-relay-turn).
9. **Validation** -- Gates 1–3 (the quality score is a label, never a gate); the model-reviewer also rolls up the advisory **zoning-coherence findings** (full-phase determination, with qualifying boundaries promoted to `RESTRICTED`) as a non-blocking block. See [TRUST_ZONING.md](TRUST_ZONING.md).
10. **Sync** -- Push to platform
11. **Post-sync linking** -- If countermeasures exist, read back platform-computed exposures and present a batch linking table. If the user defers, warn that unlinked controls will not be credited in analysis defense coverage

The skill has no `agent` frontmatter: it runs in the main conversation, asks the operator the questions and starts the specialist agents itself.

**Quick model (the default; `--full` for the full run).** A new model is marked quick (`mode: 'quick'` with Step 1's transition, or with `create`'s first one) unless the run that starts it has `--full`; a pulled model is never marked; `--quick` on an existing model marks it at entry (`model_state` `action: 'mode'`). Step 8 enriches the `priority` set only and defers the control pass. Step 9 is a read-only pass: the review's quality score, red flags and Top Findings (at most five ranked attack chains through the model), no gates verdict, no loop-back, waiver or review-record question, and the model is never REVIEWED — the server refuses it (`quick_mode`). Step 10's consent says it is a quick model and that Gate 3 was not run, and the model's README marks it as not reviewed (after writing the README, the publish phase shows the Top Findings again, or says they are in Step 9's review when they are no longer in the conversation). A later run without a mode flag keeps the model's mode and resumes; a later run with `--full` on the same path clears the mark and deepens the model, from Step 8 once the quick run has passed Step 7 (from where it stopped before that). When the step taken up is Step 7 or later, a Step 6 classification pass runs first — the pass a quick run may have skipped, with its classification gate — and then that step; a deepening that takes up Step 6 or earlier runs the pass in that Step 6. See [Quick Mode](THREAT_MODELING_WORKFLOW.md#quick-mode). `--full` is not `--full-scan`, which runs a full discovery in place of the drift check.

> **Session break after Step 5 (D65):** After Step 5 of a full run the guided workflow presents one checkpoint for every model size; a quick run skips it and goes on to Step 6 in the same turn. For models with 15 or more components it recommends starting enrichment in a fresh session — the enrichment phase reads model files from disk and doesn't need the discovery context, and for those models a fresh session saves ~25-40% of cumulative token cost. It suggests a git commit (the operator runs it) and asks one question, `session-break`: *"Your model structure is complete and saved. Consider committing it before enrichment (clean revert point). Continue now? (yes / later)"*. If the operator continues, the workflow proceeds without asking again; on `later`, it shows how to resume, and the run resumes at Step 6.

### `/dethereal:help` Output

The help output is **state-aware** — it shows a "Suggested now" section based on current model state, reducing cognitive load from 14 commands to 2-3 relevant ones. This saves LLM tokens by preempting "what should I do next?" follow-ups. The state detection is the `workspace_status` MCP tool, which returns a one-line context and up to three suggested commands.

```
Dethereal — threat modeling

Suggested now (model "Production Stack" — ENRICHING at 41/100 quality):
  /dethereal:enrich       Continue adding security attributes
  /dethereal:review       See full quality breakdown

Getting started:    /dethereal:status, /dethereal:login, /dethereal:help
Viewing:            /dethereal:view
Modeling:           /dethereal:create, /dethereal:discover, /dethereal:add, /dethereal:remove
Enrichment:         /dethereal:classify, /dethereal:enrich (controls: /dethereal:enrich --focus controls)
Review & analysis:  /dethereal:review, /dethereal:surface
Sync:               /dethereal:sync

Full workflow:      /dethereal:threat-model — the guided process, recommended for a new model

/dethereal:help <command> shows one command's details.
```

The suggestions follow the first registered model's state. With no model registry yet, "Suggested now" shows `create` and `login`; with a registry that lists no model, `create` and `discover`; for a model at INITIALIZED, `create` and `discover`. When no platform URL is configured, it drops the sync suggestions and offers `login`. The state detection reads `.dethernety/models.json`, each model's `.dethereal/state.json` and `quality.json`, and the server's own reading of the model state.

---

## 4. Subagent Architecture

### Agent Definitions

#### `threat-modeler` -- Primary Modeling Agent

**Purpose:** Edits a Dethernety threat model's files directly. The guided workflow, model creation, removing elements, discovery, drift reconciliation, classification, enrichment, the control pass, the review and sync run in the skills it names. On Claude Code, started directly, it also hands a scan, classification proposals, enrichment and a review to the specialist agents.

**Tools:** Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, the Dethereal MCP tools that need no operator approval — `disallowedTools` removes the approval-required ones, listed in the frontmatter below — and `Agent(...)` for the four specialists: `infrastructure-scout`, `infrastructure-scout-scoped`, `security-enricher` and `model-reviewer`. The Codex and OpenCode agents hold the same subset but no `Agent(...)`: there it starts no other agent.

**Frontmatter:**

```yaml
---
name: threat-modeler
description: Edits a Dethernety threat model's files directly and hands discovery scans, classification, enrichment and reviews to the specialist agents; the guided workflow, creating, removing and sync run in the Dethereal skills it names
model: inherit
effort: high
maxTurns: 60
disallowedTools:
  - mcp__plugin_dethereal_dethereal__create_threat_model
  - mcp__plugin_dethereal_dethereal__export_model
  - mcp__plugin_dethereal_dethereal__generate_attribute_stubs
  - mcp__plugin_dethereal_dethereal__import_model
  - mcp__plugin_dethereal_dethereal__login
  - mcp__plugin_dethereal_dethereal__logout
  - mcp__plugin_dethereal_dethereal__manage_analyses
  - mcp__plugin_dethereal_dethereal__manage_controls
  - mcp__plugin_dethereal_dethereal__manage_countermeasures
  - mcp__plugin_dethereal_dethereal__model_state_prune
  - mcp__plugin_dethereal_dethereal__model_state_settle
  - mcp__plugin_dethereal_dethereal__model_state_waive
  - mcp__plugin_dethereal_dethereal__update_attributes
  - mcp__plugin_dethereal_dethereal__update_model
tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - AskUserQuestion
  - Agent(dethereal:infrastructure-scout)
  - Agent(dethereal:infrastructure-scout-scoped)
  - Agent(dethereal:security-enricher)
  - Agent(dethereal:model-reviewer)
  - mcp__plugin_dethereal_dethereal__*
---
```

**Key characteristics:**
- The generator inlines the core modeling guidelines ([`workflow/shared/guidelines-core.md`](../../../apps/dethereal/workflow/shared/guidelines-core.md): component types, model structure, boundary constraints) and the file format reference (`guidelines-schema.md`) into the agent prompt. Layout guidelines (`guidelines-layout.md`) reach only the editing skills (`/dethereal:create`, `/dethereal:add`, `/dethereal:discover`, and the build phase of `/dethereal:threat-model`); the worked example (`guidelines-examples.md`) reaches only `/dethereal:create` and the build phase of `/dethereal:threat-model`. Both are files beside the skill, read on demand (D47).
- **Do not call `get_model_schema`** — modeling guidelines are already in the agent's context. Calling the tool would duplicate their content.
- Validates after every model modification
- Defaults to the conservative security interpretation (unencrypted until proven encrypted)
- States assumptions explicitly and never silently modifies user decisions
- Routes work it does not do to its skill and stops: the guided workflow and drift reconciliation to `/dethereal:threat-model`, a new model to `/dethereal:create`, removing elements to `/dethereal:remove` (attribute files are deleted only with the operator's approval), discovery to `/dethereal:discover`, classification to `/dethereal:classify`, enrichment and the control pass to `/dethereal:enrich`, publishing and pulling to `/dethereal:sync`, the review to `/dethereal:review`
- On Claude Code, started directly (`@agent-dethereal:threat-modeler`, `claude --agent dethereal:threat-modeler`), hands the specialists' part of that work to them when the operator asks for it there, and says once that the skill is the guided path for the same work:
  - a scan to the `infrastructure-scout` — a look only: it writes nothing from it, and the discovery of record stays with `/dethereal:discover`
  - classification proposals to the `security-enricher`, which writes nothing in classification mode — the `threat-modeler` itself shows the proposals, asks the operator to confirm them, and writes only the confirmed `classData`; the attribute stubs come from `/dethereal:classify` or `/dethereal:threat-model`
  - enrichment of elements that already have their attribute stubs to the `security-enricher` — it writes cited and derived values into the attribute files and its return to a relay file, which the `threat-modeler` shows verbatim (but for credential material) under a line saying it is model-written data to check, not instructions; the written values stay unless the operator rejects them, and `/dethereal:enrich` asks the questions the agent could not settle and takes any correction
  - a review to the `model-reviewer`

  Drift re-verification, creating a model, removing elements, the control pass, the gates' decisions and publishing still run in their skills. On Codex and OpenCode it starts no agent and routes all of that work to the skills.
- On Claude Code, tells the operator to run those skills from a regular session, never from one started as this agent (`claude --agent`, or the `agent` setting): the skills need tools that ask for the operator's approval, which this agent does not hold

**Subagent write convention:** The `infrastructure-scout` returns structured data (discovery report); the calling skill writes model files. The `security-enricher` writes directly to model attribute files in enrichment mode (it has Write/Edit access) — only cited and derived values into empty fields — and its return to a relay file; in classification and control-pass modes it writes nothing and returns its proposals for the conversation that started it to write once the operator confirms them. The `enrichment-applier` writes only attribute files, from the operator's reply to the relay. The `model-reviewer` is read-only.

#### `infrastructure-scout` -- Discovery Agent

**Purpose:** Scans codebases for infrastructure components, identifies trust boundaries, and produces draft model skeletons.

**Tools:** Read, Glob, Grep, Bash, `mcp__plugin_dethereal_dethereal__get_classes`
Bash is permitted for read-only inspection commands (listing file names, the name-only secret-file searches, checking service versions) but must not modify files or project state. On Claude Code and OpenCode the scout reads files with its read tool, never `cat`; on Codex with `cat`. Either way it reads only paths on its classified list, and a YAML or JSON file only after the Secret-manifest search covered its folder.
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
  - mcp__plugin_dethereal_dethereal__get_classes
---
```

> `get_model_schema` is intentionally excluded — the scout discovers components, it does not create model files. Component type information (PROCESS, STORE, EXTERNAL_ENTITY) needed for discovery is embedded in the scout's agent prompt body. This avoids a ~4,000-token tool response per discovery session.

**Security constraint:** The scout never opens a secret file — `.env` and `.env.*` (not the `.env.example`-style templates), Terraform state and `*.tfvars`, keys and certificates (`id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`, `*.pem`, …), cloud and registry credentials, kubeconfig files (`.kube/config`), helm-secrets files (`secrets*.yaml`/`.yml`, `values*secret*.yaml`/`.yml`), `secret.yaml` and `secret.yml`, decrypted sops or helm-secrets output (`*.dec`), Kubernetes `kind: Secret` manifests, and whatever files a compose `env_file:` or `secrets: … file:`, or a kustomize `secretGenerator`, names. It reports each as "`<file>` present, not read" in `unreadSecretFiles`. The full list is in [`workflow/shared/secret-files.md`](../../../apps/dethereal/workflow/shared/secret-files.md). On Claude Code the [secret guard](#secret-guard) hook refuses a Read, Grep or shell command that would open one. The scout works in a fixed order — list, classify, then open:

1. **List** file names only (`find -type f`, never following symbolic links, skipping `.git` and `node_modules`; never `git ls-files`, which hides untracked secret files).
2. **Classify** every path by the secret names and the name-only Secret-manifest search. The search covers a YAML or JSON file's folder before that file is opened — one search over the scanned root covers every folder in it. The compose and kustomization files are opened first, alone; every file their `env_file:`, `secrets: … file:` or `secretGenerator` names joins the secret list.
3. **Open** the rest — only paths on the classified list, in parallel batches if wanted, and never a symbolic link.

The plugin's own files — the model files, `attributes/`, `controls/`, `.dethereal/` and `.dethernety/` — are never secret files. From the files it does read, the agent must extract only variable NAMES and endpoint information (hostnames, ports, protocols): a compose `environment:` value or a kustomize `secretGenerator.literals` entry is reported by name only, and a multi-document YAML file that holds a Secret is a Secret manifest as a whole. It must NEVER include secret VALUES (passwords, API keys, tokens, private keys) in discovery output or conversation context.

**Discovery sources:**
- IaC: Terraform, CloudFormation, Pulumi, CDK
- Containers: Docker, Kubernetes, Helm
- Application code: API definitions, service mesh configs, auth middleware, database connections
- Architecture diagrams: screenshots or other images, read as images — the scout's instructions are the same on every harness; whether an image can be read depends on the harness and the model behind it. Always low confidence, confirmed by the operator
- Configs: `.env.example`-style templates, environment variable references, CI/CD pipelines

**Output:** Structured discovery report with confidence levels (high/medium/low) and source provenance for each discovered element.

#### `infrastructure-scout-scoped` -- Drift Re-verification Agent

**Purpose:** Re-verifies the model elements behind the files that changed since the drift baseline, reading only a pre-computed file allowlist — it does not enumerate the repository, and it checks each path's name against the secret files before reading it. The Drift Orchestration Protocol delegates to it; see [DRIFT_DETECTION.md](DRIFT_DETECTION.md).

**Tools:** Read, `mcp__plugin_dethereal_dethereal__get_classes` — no search, no file listing, no shell, no writes. Source: [`workflow/agents/infrastructure-scout-scoped.md`](../../../apps/dethereal/workflow/agents/infrastructure-scout-scoped.md).

#### `security-enricher` -- Security Enricher Agent

**Purpose:** Enriches threat models with security attributes, credential topology, and control identification, in one of three modes: enrichment, classification proposals, and the control pass. MITRE ATT&CK technique coverage is derived platform-side from analysis exposures, not annotated by the agent.

**Tools:** Read, Glob, Grep, Write, Edit, and the Dethereal MCP tools minus the 24 that `disallowedTools` removes — every tool that needs the operator's approval (the ones that change the model or the platform, sign in or out, or record the operator's decisions) and the read tools outside its work — which leaves six of the 30: `get_classes`, `match_classes`, `validate_model_json`, `query_controls`, `search_mitre_attack` and `get_mitre_defend`. The Codex agent's instructions name the same six, and it reads and searches with the shell (no command that changes anything) and changes files with `apply_patch`. The OpenCode agent's `permission` allows the same six, reading files, finding them by name (no content search), and editing only the model files and the plugin's state files.

**Frontmatter:**

```yaml
---
name: security-enricher
description: Enriches threat models with security attributes, credential topology, and control identification. MITRE ATT&CK technique coverage is derived platform-side from analysis exposures.
model: inherit
effort: high
maxTurns: 40
disallowedTools:
  - mcp__plugin_dethereal_dethereal__auth_status
  - mcp__plugin_dethereal_dethereal__create_threat_model
  - mcp__plugin_dethereal_dethereal__detect_drift
  - mcp__plugin_dethereal_dethereal__export_model
  - mcp__plugin_dethereal_dethereal__generate_attribute_stubs
  - mcp__plugin_dethereal_dethereal__get_control_gaps
  - mcp__plugin_dethereal_dethereal__get_example_models
  - mcp__plugin_dethereal_dethereal__get_model_schema
  - mcp__plugin_dethereal_dethereal__import_model
  - mcp__plugin_dethereal_dethereal__list_models
  - mcp__plugin_dethereal_dethereal__login
  - mcp__plugin_dethereal_dethereal__logout
  - mcp__plugin_dethereal_dethereal__manage_analyses
  - mcp__plugin_dethereal_dethereal__manage_controls
  - mcp__plugin_dethereal_dethereal__manage_countermeasures
  - mcp__plugin_dethereal_dethereal__model_state
  - mcp__plugin_dethereal_dethereal__model_state_settle
  - mcp__plugin_dethereal_dethereal__model_state_prune
  - mcp__plugin_dethereal_dethereal__model_state_waive
  - mcp__plugin_dethereal_dethereal__query_countermeasures
  - mcp__plugin_dethereal_dethereal__query_exposures
  - mcp__plugin_dethereal_dethereal__update_attributes
  - mcp__plugin_dethereal_dethereal__update_model
  - mcp__plugin_dethereal_dethereal__workspace_status
tools:
  - Read
  - Glob
  - Grep
  - Write
  - Edit
  - mcp__plugin_dethereal_dethereal__*
---
```

> `maxTurns: 40` bounds enrichment sessions on Claude Code. The OpenCode agent carries the same limit as `steps: 40`; the Codex agent has no turn limit set by the plugin. Enrichment is proportional to component count (6 attributes per component + credential topology), not open-ended. For a 20-component model, 40 turns provides sufficient headroom while preventing runaway sessions.

**Key characteristics:**
- Never generates MITRE technique IDs from memory -- always queries the platform's graph database
- Presents enrichment suggestions in batches for user confirmation
- Writes only values a file on the deployed path states (basis `[cited] <path:line>`) and values derived from a setting such a file states, read with the meaning the reading software's own reference documents (basis `[derived: <setting> → <behaviour>] <path:line>`), into empty fields only; the enrichment relay file lists every one, and the operator's reply keeps, rejects or changes it. A value resting on a setting no file states is a proposed default, never written. See [Discovery and Enrichment](../../user/dethereal/DISCOVERY_AND_ENRICHMENT.md#class-templates-drive-the-questions)
- Prioritizes security-critical attributes (auth, TLS, encryption at rest, logging, access control)

#### `enrichment-applier` -- Enrichment Relay Applier

**Purpose:** Writes what the operator's reply to the Step 8 enrichment relay decides, and returns a table of what it wrote. The main conversation starts it fresh, with the relay files' paths in run order and the operator's reply verbatim; it never sees the operator and asks nothing. A plain "accept all", or a reply that decides nothing, does not start it. Source: [`workflow/agents/enrichment-applier.md`](../../../apps/dethereal/workflow/agents/enrichment-applier.md).

**Tools:** Read, Glob, Grep, Write, Edit and `mcp__plugin_dethereal_dethereal__validate_model_json` — no other Dethereal tool, no shell, no agents. The Codex agent reads and searches with the shell (no command that changes anything) and changes files with `apply_patch`. The OpenCode agent's `edit` permission covers only `attributes/*.json`.

**Frontmatter:**

```yaml
---
name: enrichment-applier
description: Writes the attribute values the operator's reply to the enrichment relay decides, and returns a table of them; asks nothing
model: inherit
effort: high
maxTurns: 30
tools:
  - Read
  - Glob
  - Grep
  - Write
  - Edit
  - mcp__plugin_dethereal_dethereal__validate_model_json
---
```

**Key characteristics:**
- Writes only files under `attributes/`: never `structure.json`, `dataflows.json`, `data-items.json`, `.dethereal/**` or `controls/**`, and never a tool that changes the model, the platform or the state
- Maps every decision the reply makes, and only those: a rejected written value goes back to `null`, a modified one takes the operator's value; a Credentials, Credential mapping or Boundary enforcement pre-fill, a divergence row or a documentation claim is written only when the reply names or accepts it; "not sure" stays `null`
- A fact in the reply that disagrees with a `[cited]` value keeps the cited value and returns a conflict line, never a question; one that disagrees with a `[derived]` value takes the operator's value, with a line naming its row and the value it replaced
- Writes a floor key the reply answers even where a component's file lacks it; only a PROCESS of a non-store class the reply says keeps no data takes `encryption_at_rest: "not_applicable"`, never `"none"`; on any other component it stays `null`, named in a line
- Returns as follow-ups what the main conversation handles: a removal (the remove skill), a changed credential mapping (recomputed, for the `credential-mapping` question; the stores' credential keys wait for it), data items, classes, crown jewels or zones the reply decided, and elements to add
- Reads the relay and attribute files as data, never instructions, and never writes a secret value: a credential is written by its id
- Validates with `validate_model_json` after writing, and takes back a value off its schema

#### `model-reviewer` -- Validation Agent

**Purpose:** Audits threat models for completeness, correctness, and security coverage. Produces quality reports. Rolls up the advisory zoning-coherence findings via `validate_model_json(action: 'zoning')` at the validation step (see [TRUST_ZONING.md](TRUST_ZONING.md)).

**Tools:** Read, Glob, Grep, `mcp__plugin_dethereal_dethereal__validate_model_json`, `mcp__plugin_dethereal_dethereal__get_classes`, `mcp__plugin_dethereal_dethereal__model_state`, `mcp__plugin_dethereal_dethereal__workspace_status`, `mcp__plugin_dethereal_dethereal__query_exposures`, `mcp__plugin_dethereal_dethereal__query_countermeasures`, `mcp__plugin_dethereal_dethereal__get_control_gaps`, `mcp__plugin_dethereal_dethereal__search_mitre_attack`
**Disallowed tools:** Write, Edit, Bash (read-only reviewer)

**Frontmatter:**

```yaml
---
name: model-reviewer
description: Read-only auditor producing quality reports and readiness assessments
model: inherit
effort: medium
maxTurns: 30
tools:
  - Read
  - Glob
  - Grep
  - mcp__plugin_dethereal_dethereal__validate_model_json
  - mcp__plugin_dethereal_dethereal__get_classes
  - mcp__plugin_dethereal_dethereal__model_state
  - mcp__plugin_dethereal_dethereal__workspace_status
  - mcp__plugin_dethereal_dethereal__query_exposures
  - mcp__plugin_dethereal_dethereal__query_countermeasures
  - mcp__plugin_dethereal_dethereal__get_control_gaps
  - mcp__plugin_dethereal_dethereal__search_mitre_attack
---
```

> The reviewer reads the platform through the read-only `query_exposures` and `query_countermeasures` tools, which accept only `list` and `get` and change nothing. Its prompt limits `model_state` to `action: 'get'` — the one part of the read-only mandate that rests on the prompt, because the `tools` allowlist grants whole tools, not single actions. Every platform write is out of the reviewer's reach: `manage_countermeasures` is not on its allowlist, and `manage_exposures` is retired.

**Checks performed:**
- Structural validity (pass/fail)
- Component classification rate
- Attribute completion rate
- Trust boundary hierarchy quality
- Data flow coverage (orphaned components)
- Data classification on sensitive flows
- Common gap detection (missing admin access, monitoring, backup flows)
- Red flags: every insecure value recorded in the attribute files — a value the class guide's security impact marks insecure in either polarity, `fail_open` or `fallback` failure modes, unenforced boundaries, shared credentials — found with one search across `attributes/` and returned under a `### Red Flags (N)` heading, which the guided workflow shows verbatim
- Top Findings, only when the task asks for them (the quick Step 9 does): at most five attack chains through the model — entry, each hop by its flow id, then the target, a hop the source shows but the model lacks marked `(not modelled)` — ranked by whether the chain reaches a crown jewel, the entry zone, the number of controls not in force on it and a shared credential; each finding's facts are read from the model files, with no ATT&CK, CWE or CAPEC ids and no numeric severity. Returned under `### Top Findings`, which the quick Step 9 relays verbatim, in its order ([`workflow/agents/model-reviewer.md`](../../../apps/dethereal/workflow/agents/model-reviewer.md))

### Agent Interaction Pattern

```
User
  |
  v
/dethereal:threat-model (skill, runs in the main conversation)
  |
  +--> Agent(infrastructure-scout)         -- discovery phase
  |       Passes: model directory path + scope summary
  |       Returns: discovery report; writes nothing
  |
  |    the skill handles directly          -- confirmation and model writes
  |
  +--> Agent(infrastructure-scout-scoped)  -- drift re-verification (resume)
  |
  +--> Agent(security-enricher)            -- classification and enrichment
  |       Passes: model directory path + mode
  |       Returns: tables and questions to relay
  |                (Step 8: a relay file per run, .dethereal/relay/run-<n>.txt)
  |
  +--> Agent(enrichment-applier)           -- Step 8, after the relay question
  |       Passes: model directory path + relay file paths + the operator's reply
  |       Returns: table of the values written, and follow-ups
  |
  +--> Agent(model-reviewer)               -- validation phase
          Passes: model directory path
          Returns: review (gate verdicts, top issues); writes nothing
```

**Subagent return contracts:** Subagent delegations pass the model directory path, not serialized model content. Each subagent reads current state from disk and returns its tables and findings; the skill relays them to the operator before the next question. This avoids 2,000-8,000 tokens of redundant model content in delegation round-trips.

**While a specialist runs**, the skill asks nothing and writes nothing ([`core-rules.md`](../../../apps/dethereal/workflow/shared/core-rules.md) rule 4). On Claude Code and OpenCode, when the specialist runs in the background — started or resumed — the conversation ends its turn and the result arrives as a new message; it never sleeps, polls, or schedules a wakeup or loop for it. Codex waits with `wait_agent` (below). A specialist cut off by its turn limit with work left is started once more with only what is left — a fresh start or a resume; cut off again, the skill stops and tells the operator.

The skills are the orchestrators: they carry the protocols and the operator's questions, and they start the specialist agents via `Agent()` calls — `/dethereal:threat-model` all five, `/dethereal:discover` the infrastructure-scout, and the control pass the security-enricher. `/dethereal:review` and `/dethereal:surface` run as the model-reviewer through their `agent` frontmatter. The `threat-modeler` edits models, asks questions (`AskUserQuestion` when it runs as the main conversation) and validates its edits. When a request needs a new model, removing elements, discovery, drift reconciliation, classification, enrichment, the control pass, the review, sync or the guided workflow, it names the skill that runs it and stops. On Claude Code, started directly, it hands the specialists' part — a scan, classification proposals, enrichment and a review — to the `infrastructure-scout`, `security-enricher` and `model-reviewer` via `Agent()` calls (see [`threat-modeler`](#threat-modeler----primary-modeling-agent)); on Codex and OpenCode it starts no other agent.

On Codex a skill starts an agent with `spawn_agent` (`agent_type: "dethereal-<agent>"`, `fork_turns: "none"`), waits for its final answer with `wait_agent` — again while it is still running, never ending its turn while it runs — and then closes it with `close_agent`, because a finished agent counts against the session's agent limit until it is closed. If no `close_agent` tool is available, the skill carries on; if a later `spawn_agent` then fails on the agent limit, it stops and tells the operator. `/dethereal:review` and `/dethereal:surface` hand their work to the model-reviewer the same way, as a task file next to the skill. Every Codex agent is a leaf: it never starts or messages another agent, and the plugin's agent-tool hook keeps it to its own tools (see [Codex Hooks](#codex-hooks)).

### Platform Feature Adoption

| Feature | Usage | Status |
|---------|-------|--------|
| `effort` | Reasoning depth per agent -- `medium` for bounded tasks, `high` for complex modeling | Used |
| `maxTurns` | Safety bounds on subagent operations -- prevents runaway loops | Used |
| `context: fork` | Read-only skills (`review`, `surface`) run in forked context, don't pollute main conversation | Used |
| `memory: project` | Not used: the model files and the server state are the only record, and agent memory would write `.claude/agent-memory/` into the user's repository | Not used |
| `background` | `review` and `surface` set `background: false`, so the forked review runs in the foreground. No agent sets `background`; when a specialist does run in the background, the skill ends its turn and the result arrives as a new message (see [Agent Interaction Pattern](#agent-interaction-pattern)) | Used (`false`) |
| `Notification` hook | Desktop alert when long operations (sync, discovery) complete | Candidate |
| Elicitation capability | Structured input forms for scope definition, classification choices (observed via `Elicitation`/`ElicitationResult` hooks) | Candidate |
| Plugin channels | Platform webhook push events (analysis complete, new exposures) into Claude Code sessions | Candidate |

---

## 5. MCP Server

> **Detailed MCP server architecture:** See [MCP_ARCHITECTURE.md](MCP_ARCHITECTURE.md) for the full architecture — tool execution flow, class hierarchy, auth flow diagrams, dt-core integration, data flow diagrams, security model and configuration. This section summarizes the tool inventory and key design decisions.

### Core Tools

| Tool | Auth | Purpose |
|------|------|---------|
| `login` | No | Browser-based OAuth PKCE authentication |
| `logout` | No | Remove the locally stored session, then revoke it at the identity provider (`clear_all`: every platform's session) |
| `auth_status` | No | Report platform URL, sign-in state, user and time left; `verify: true` refreshes an expired session. Never returns token material. Replaced `refresh_token` (D69) |
| `get_model_schema` | No | Schema + modeling guidelines |
| `get_example_models` | No | Example model templates |
| `validate_model_json` | No | Offline structural validation, quality score, control-coverage, boundary trust zoning, and the quality gates. Input: `{ action: 'validate'\|'quality'\|'coverage'\|'zoning'\|'gates', directory_path: string, assets?: 'full'\|'skeleton' }`. `gates` computes Gates 1–3 (Gate 3 criteria C1–C9) with per-element failures. `zoning` computes per-boundary trust determination + advisory findings offline (skeleton/full phases) — see [TRUST_ZONING.md](TRUST_ZONING.md) |
| `get_classes` | Yes | Query available classes from installed modules |
| `create_threat_model` | Yes | Import local model to platform |
| `import_model` | Yes | Import model from directory |
| `export_model` | Yes | Export platform model to directory |
| `update_model` | Yes | Update existing model structure |
| `update_attributes` | Yes | Update element attributes only |

### MITRE, Security and Analysis Tools

#### MITRE Framework Tools

**`search_mitre_attack`** -- Search and browse ATT&CK techniques, tactics, and mitigations (D26).

Input: `{ action: 'search'|'tactics'|'techniques_by_tactic'|'technique'|'mitigations'|'mitigation', query?: string, tactic_id?: string, attack_id?: string }`

| Action | API Method | Notes |
|--------|-----------|-------|
| `search` | `findMitreAttackTechniques` | Requires `query`, translated to a GraphQL name filter. Results capped at 20. |
| `tactics` | `getMitreAttackTactics` | No params, returns all tactics. |
| `techniques_by_tactic` | `getMitreAttackTechniquesByTactic` | Requires `tactic_id` (e.g., "TA0001"). |
| `technique` | `getMitreAttackTechnique` | Requires `attack_id` (e.g., "T1190"). Used for ID validation. |
| `mitigations` | `getMitreAttackMitigations` | No params, returns all mitigations. |
| `mitigation` | `getMitreAttackMitigation` | Requires `attack_id` (e.g., "M1036"). |

Wraps `DtMitreAttack` dt-core class methods. The `search` action passes `query` to the platform as a name-contains filter (`name: { contains: query }`), so a query matches technique names, not descriptions. The `technique` action with `attack_id` enables ID validation (confirm a technique exists before annotating), serving as the anti-hallucination guardrail. A search returns at most 20 techniques with the full `total` and a `truncated` flag; when it is truncated, the agent should refine the query.

> The plugin provides `search_mitre_attack` for user-initiated reference browsing. Systematic technique-to-component mapping (STRIDE-to-ATT&CK evaluation) is performed by analysis modules, not the plugin.

**`get_mitre_defend`** -- Browse D3FEND defensive techniques (D24).

Input: `{ action: 'tactics' | 'techniques_by_tactic' | 'technique', tactic_id?: string, d3fend_id?: string }`

Wraps `DtMitreDefend` dt-core class methods. Renamed from `search_mitre_defend` because the underlying `DtMitreDefend` class has no text search capability — only tactic listing, technique-by-tactic browsing, and technique lookup by ID. The D3FEND data comes from the mitre-frameworks module, which ingests a pinned D3FEND release into the graph database. For free-text lookup the plugin offers only `search_mitre_attack`, which searches ATT&CK techniques by name; D3FEND techniques are found by tactic browsing or by ID with `get_mitre_defend`. dt-core has no D3FEND counterpart to `findMitreAttackTechniques`.

#### Security Element Tools

**`query_exposures`** -- Read-only access to platform-computed exposures (D25). It replaced `manage_exposures`, which is retired and no longer registered.

Input: `{ action: 'list'|'get', element_id?: string, exposure_id?: string, limit?: number }`

Wraps `DtExposure` dt-core class. **Create/update/delete are analysis module features**, not plugin capabilities. Exposures are computed by OPA/Rego policy evaluation on the platform — plugin-created exposures would pollute the analysis evidence chain (`Component → HAS_EXPOSURE → Exposure → EXPLOITED_BY → Technique`) with unverified claims.

After model import, the plugin reads back computed exposures: "12 exposures found on your model. Run analysis for full findings and remediation roadmaps." Manual exposure entry (pentest findings) belongs in a dedicated import module with explicit `source: "manual"` provenance.

**`query_controls`** -- Read-only access to the platform's security controls.

Input: `{ action: 'list'|'get'|'rank', control_id?: string, folder_id?: string, class_ids?: string[], name?: string, class_type?: string, element_ids?: string[], module_id?: string, module_name?: string, element_types?: string[], top_n?: number, limit?: number }`

`list` filters controls (by class IDs, name substring, class type, supported elements, module); `get` reads one by `control_id`; `rank` scores candidate controls for the given `element_types` and returns the top `top_n` (default 5). `limit` caps a `list` result (default 100). Runs without an approval prompt.

**`manage_controls`** -- Create, update, delete and assign security controls, plus the control-library sync actions.

Input: `{ action: 'create'|'update'|'delete'|'assign'|'pull-controls'|'push-greenfield'|'push-brownfield'|'tombstone'|'set-local-edited'|'promote-external-edit'|'inspect-wal'|'clear-wal', control_id?: string, name?: string, description?: string, class_ids?: string[], element_ids?: string[], directory_path?: string, ... }`

`class_ids` on `create`/`update` assigns control class IDs to the control instance (on `update`, the list replaces the current bindings). Use `get_classes(class_type: 'CONTROL')` to retrieve available control class definitions. Listing, reading and ranking controls is `query_controls`; `manage_controls` accepts only the write actions and always asks for approval.

Wraps `DtControl` dt-core class.

**`query_countermeasures`** -- Read-only access to a control's countermeasures.

Input: `{ action: 'list'|'get', control_id?: string, countermeasure_id?: string, limit?: number }`

`list` reads the countermeasures of `control_id`; `get` reads one by `countermeasure_id`. Runs without an approval prompt.

**`manage_countermeasures`** -- Link controls to exposures via countermeasures.

Input:
```
{
  action: 'create' | 'update' | 'delete',
  control_id?: string,           // required for 'create'
  countermeasure_id?: string,    // required for 'update', 'delete'
  name?: string,                 // required for 'create'
  type?: 'preventive' | 'detective' | 'corrective',
  category?: string,             // e.g., "access-control", "encryption", "monitoring"
  description?: string,
  score?: number,                // effectiveness 0-100, defaults to 50 on create
  exposure_ids?: string[],       // links to addressed exposures
  defend_technique_ids?: string[],
  mitigations?: { id: string }[], // ATT&CK mitigation references
  references?: string
}
```

On `update`, an omitted field stays unchanged, and a provided `exposure_ids`, `defend_technique_ids` or `mitigations` list replaces the current links. Listing and reading countermeasures is `query_countermeasures`.

`update` applies only to USER countermeasures. A SYSTEM countermeasure (or one with no `createdBy`) is rewritten from its control's class policy on each save of the control, so the tool refuses any update of one; supersede it into a USER copy (in the platform, **Customize as an editable copy**) and update the copy. `delete` is refused for the same countermeasures, since the next save re-creates one while its policy still derives it; change the control's attribute answers instead, or supersede it.

Wraps `DtCountermeasure` dt-core class. Critical for the enrichment workflow connecting controls to exposures.

> **Temporal dependency:** Countermeasures created before model import will not have `exposure_ids` (no exposures exist yet). Without linking, the platform's defense coverage analysis will not credit these controls — a well-controlled system appears under-protected. The guided workflow handles this in Step 11: after sync, if the model has countermeasures, read back platform-computed exposures via `query_exposures(action: 'list')` and present a batch linking table: "The platform found N exposures. I'll match them to your existing controls. Please confirm." If the user defers, warn: "Your controls exist but are not linked to specific exposures. Analysis will undercount your defenses."

#### Model Discovery Tool

**`list_models`** -- List threat models on the platform.

Input: `{ folder_id?: string, name?: string }`

Wraps `DtModel.getModels()`.

Note: `name` filtering is applied client-side after fetching. The backend API (`DtModel.getModels`) only supports `folderId` filtering.

#### Analysis Tools

**`manage_analyses`** -- List analysis classes, create/run analyses, get results.

Input: `{ action: 'list_classes'|'list'|'create'|'run'|'status'|'results'|'delete', element_id?: string, analysis_id?: string, analysis_class_id?: string, name?: string, description?: string }`

`list` and `create` take `element_id` (the model element the analysis is attached to); `create` also needs `name` and `analysis_class_id`; `run`, `status`, `results` and `delete` take `analysis_id`. Wraps `DtAnalysis` dt-core class. Note: streaming/subscription-based result delivery cannot work through stateless MCP tool calls -- the `run` action returns a session ID for polling.

**Polling contract** (see [MCP_ARCHITECTURE.md §6](MCP_ARCHITECTURE.md#6-tool-reference)):
- `action: 'run'` returns `{ session_id, status: 'started' }`
- `action: 'status'` returns the analysis's `status` value
- `action: 'results'` returns the results once there are any, otherwise `{ status: 'no_results' }` with a message to check `status` first

There is no progress report and no retry hint; the caller polls `status` until it completes.

### Tool Count Summary

The registered tools, by category. The sections above describe a subset; [MCP_ARCHITECTURE.md §3 Tool Categories](MCP_ARCHITECTURE.md#tool-categories) and [§6 Tool Reference](MCP_ARCHITECTURE.md#6-tool-reference) are the full reference.

| Category | Tools | Count |
|----------|-------|-------|
| Authentication | `login`, `logout`, `auth_status` | 3 |
| Reference | `get_model_schema`, `get_example_models` | 2 |
| Validation | `validate_model_json` | 1 |
| Local Workspace | `workspace_status`, `detect_drift` | 2 |
| Workflow State | `model_state`, `model_state_settle`, `model_state_waive`, `model_state_prune` | 4 |
| Model CRUD | `create_threat_model`, `import_model`, `export_model`, `update_model`, `list_models` | 5 |
| Element Management | `get_classes`, `match_classes`, `update_attributes`, `generate_attribute_stubs` | 4 |
| MITRE Frameworks | `search_mitre_attack`, `get_mitre_defend` | 2 |
| Security Elements | `manage_controls`, `manage_countermeasures`, `get_control_gaps`, `query_controls`, `query_exposures`, `query_countermeasures` | 6 |
| Analysis | `manage_analyses` | 1 |
| **Total** | | **30** |

With the settlement off, the default, the server lists 29: `model_state_settle` is not served (see [MCP_ARCHITECTURE.md → Settlement Switch](MCP_ARCHITECTURE.md#settlement-switch)).

> **Output size constraint:** MCP tool output is limited to ~10,000 tokens. Tools returning large payloads (e.g., `get_model_schema`, `export_model`) should paginate, summarize, or write to disk and return a file path. The hybrid approach of embedding guidelines in agent prompts (rather than returning them from tools) mitigates this for schema tools.

> **Quality ceiling without controls/credentials:** A model with zero controls and zero credentials can score at most 85/100 (the `control_coverage_rate` 10% and `credential_coverage_rate` 5% factors are zero). The score is a label — 70 and above reads "Good" — never a gate: whether a model is ready for analysis is decided by Gates 2 and 3 (and, with the settlement on, by no values awaiting the operator's confirmation or registration), reported as `readiness` by `workspace_status`.
>
> **Analysis readiness caveat:** The plugin quality score measures structural completeness. The platform's analysis evaluates additional dimensions — without credential data it has no credential reach to follow for lateral movement (D22); without controls, defense coverage gap analysis produces no results. When the model is ready but `control_coverage_rate` = 0 and `credential_coverage_rate` = 0, the model-reviewer adds: *"Your model is structurally ready for analysis, but analysis quality will improve significantly with credentials (for lateral movement paths) and controls (for defense coverage gaps)."*

### Tools by Approval

Every tool has an approval class in the tool manifest ([`manifest.ts`](../../../apps/dethereal/src/tools/manifest.ts), the `approval` field). The bundles for every harness are generated from it, so the split is the same everywhere:

| Approval | Count | Tools |
|----------|-------|-------|
| Run without asking | 16 | `auth_status`, `detect_drift`, `get_classes`, `get_control_gaps`, `get_example_models`, `get_mitre_defend`, `get_model_schema`, `list_models`, `match_classes`, `model_state`, `query_controls`, `query_countermeasures`, `query_exposures`, `search_mitre_attack`, `validate_model_json`, `workspace_status` |
| Ask first | 14 | `create_threat_model`, `export_model`, `generate_attribute_stubs`, `import_model`, `login`, `logout`, `manage_analyses`, `manage_controls`, `manage_countermeasures`, `model_state_prune`, `model_state_settle`, `model_state_waive`, `update_attributes`, `update_model` |

How each harness applies it:

- **Claude Code** — the plugin's `approve` hook (see [Auto-Approval](#auto-approval)) approves the 16, and, with the settlement on, also approves `model_state_settle` when its action is `prepare`, which records nothing in the model (the tool still carries the interaction hint, so Claude Code may still ask for it); your own deny and ask rules still apply, and the other 14 (`model_state_settle` `settle` and `commit` included) ask as your settings say.
- **Codex** — the server entry sets `default_tools_approval_mode = "prompt"` and `approval_mode = "approve"` for each of the 16.
- **OpenCode** — the 14 get an `ask` permission rule.

Before it changes anything, the installer's summary says, per harness, which kinds of tools run without asking and how many others ask first; it does not list them by name. `dethereal doctor --json` prints both lists from the installed version, as the `tool approvals` check.

### Error Propagation

MCP tool errors propagate to the agent via `ToolResult`. The workflow handles them as follows:

- **Auth errors**: the `auth-missing` question — sign in with `/dethereal:login`, then check again and retry; or skip the step, leaving it undone and saying so
- **Validation errors**: presented to the operator with suggested fixes
- **Platform and network errors**: reported to the operator. A step with an offline path takes it instead of retrying — class matching falls back to `get_classes`, then to matching by name; control ranking falls back to the offline control path — and a control-library refusal is never retried or worked around

### Plugin Security Model

The OAuth PKCE flow starts a localhost HTTP server on a fixed port (9876) to receive the authorization callback. Security considerations:

- **PKCE mitigation**: The code_verifier/code_challenge exchange prevents code interception from being useful for token exchange
- **Non-blocking sign-in**: `login` reuses a valid stored session or refreshes an expired one; otherwise it starts a browser sign-in and returns within `wait` seconds (default 30, at most 45) — signed in, or `pending` with a local `openUrl` for the user to open. The callback listener lives 5 minutes from its start and closes after the callback
- **Port predictability**: Fixed port is required by most OIDC providers that restrict redirect URIs. The server answers only `/start` (a redirect to the pending authorization URL) and `/callback`, requires the bound port's `Host`, and settles the sign-in only with the expected `state`
- **Token storage**: Tokens stored at `~/.dethernety/tokens.json`. The store directory is refused when another user owns it and is tightened to `0700` before every change; the file is written `0600` through an exclusive temporary file and a rename
- **Credentials stay in the server**: only the MCP server reads the token store. Skills check the session with `auth_status` and never read `~/.dethernety/`; no tool takes a credential as input or returns one, and session tokens are redacted from tool results and stderr (D69)

---

## 6. Hooks

The package's CLI ([`src/cli/`](../../../apps/dethereal/src/cli/)) has five hook commands. Each harness wires them its own way:

| Hook command | Claude Code | Codex | OpenCode |
|--------------|-------------|-------|----------|
| `session-start` (orientation) | `SessionStart` on `startup`, `resume`, `clear`, `fork` | `SessionStart` on `startup`, `resume`, `clear` | — |
| `session-start --source compact` (state after compaction) | `SessionStart` on `compact` | `SessionStart` on `compact` | `experimental.session.compacting` |
| `post-write` | `PostToolUse` | `PostToolUse` | `tool.execute.after` |
| `config-guard` | `PreToolUse` on file writes | `PreToolUse` on `apply_patch` | `tool.execute.before` on file writes |
| `secret-guard` | `PreToolUse` on `Read`, `Grep`, `Bash` | `PreToolUse` on `Bash` | `tool.execute.before` on `read`, `grep`, `bash` |
| `approve` | `PreToolUse` on the auto-approved Dethereal tools, and on `model_state_settle` with the settlement on | — (the server entry's approval modes) | — (the ask rules) |

Codex adds an agent-tool hook of its own (see [Codex Hooks](#codex-hooks)); OpenCode runs the commands through its plugin (see [OpenCode Plugin](#opencode-plugin)).

The generator's Claude target emits the hooks into `bundles/claude/hooks/hooks.json`, which the manifest names. Every hook runs the package's own CLI in exec form (argv, never a shell): `node ${CLAUDE_PLUGIN_ROOT}/dist/index.js hook <command> … --harness claude` ([`src/cli/`](../../../apps/dethereal/src/cli/)). Apart from the two guards (below), a hook never blocks a session: an unusable invocation exits 1 with a one-line reason on stderr. On a wrong `--harness` the secret guard fails closed on any Claude Code version: it denies the call, with a reason that names the wiring (see [Secret Guard](#secret-guard)). The two guards (`config-guard`, `secret-guard`) carry `"onFailure": "block"`: on Claude Code 2.1.295 or later, a guard that cannot answer — it fails to start, times out, exits with a code other than 0 or 2, or prints invalid JSON output — blocks the tool call. Older Claude Code versions ignore the key and load the hooks file as before (2.1.289 verified), so there a guard that cannot start, crashes or times out, or runs on a Node older than 14.8, lets the call run. Independently of the Claude Code version, on a Node from 14.8 up to 20.11.0 the entry stops a guard with exit code 2, which Claude Code reads as a block, and the reason `Dethereal needs Node.js 20.11.1 or newer (found <version>), so its <guard> can't check this call and blocks it. Update Node, or turn the Dethereal plugin off with /plugin.`; on such a Node every Read, Grep, Bash, Write, Edit, MultiEdit and NotebookEdit call is blocked until Node is updated or the plugin is turned off. On such a Node every other Dethereal command stops with exit 1 and the plain message ([`src/node-floor.ts`](../../../apps/dethereal/src/node-floor.ts)); an older Node cannot load the entry at all. Hooks have no platform session and never contact the platform. The Codex bundle ships its own hook scripts; see [Codex Hooks](#codex-hooks).

### Hook Definitions (`bundles/claude/hooks/hooks.json`)

| Event | Matcher | Command | Timeout |
|-------|---------|---------|---------|
| `SessionStart` | `startup`, `resume`, `clear` | `hook session-start --source <same> --harness claude` | 15 s |
| `SessionStart` | `fork` | `hook session-start --source resume --harness claude` | 15 s |
| `SessionStart` | `compact` | `hook session-start --source compact --harness claude` | 15 s |
| `PreToolUse` | `Write\|Edit\|MultiEdit\|NotebookEdit` | `hook config-guard --harness claude` | 10 s |
| `PreToolUse` | `^mcp__plugin_dethereal_dethereal__(<auto-approved tools>\|model_state_settle)$` | `hook approve --harness claude` | 10 s |
| `PreToolUse` | `^(Read\|Grep\|Bash)$` | `hook secret-guard --harness claude` | 10 s |
| `PostToolUse` | `Write\|Edit\|MultiEdit` | `hook post-write --harness claude` | 15 s |

The approve matcher is the anchored list of the tools the tool manifest marks `auto` (listed in [Tools by Approval](#tools-by-approval)), followed, in a bundle generated with the settlement on, by the tools with an auto-approved action (`model_state_settle`); that hook approves those exact names, and of `model_state_settle` only its `prepare`, and never denies. Shipped bundles have the settlement off, so their matcher ends with the `auto` tools. The three `PreToolUse` matchers are disjoint, so their order decides nothing.

An abbreviated entry:

```json
{
  "hooks": {
    "SessionStart": [{
      "matcher": "startup",
      "hooks": [{
        "type": "command",
        "command": "node",
        "args": ["${CLAUDE_PLUGIN_ROOT}/dist/index.js", "hook", "session-start", "--source", "startup", "--harness", "claude"],
        "timeout": 15
      }]
    }]
  }
}
```

### Session Orientation

**Event:** `SessionStart` (`startup`, `resume`, `clear`, `fork`)

`hook session-start` reads the workspace the way the `workspace_status` tool does — the model registry (`.dethernety/models.json`) and each model's state and quality — and adds orientation text to the model's context:
- **No models:** the entry commands (`/dethereal:create`, `/dethereal:status`, `/dethereal:help`) and a plain-language prompt suggestion.
- **One model:** its name, state, quality score and stale-element count, with up to three suggested next commands.
- **Several models:** the count, and a pointer to `/dethereal:status`.
- **Platform URL not set:** a note that the local default is used, and `/dethereal:login` when needed; an unusable URL is reported as such.
- **Settlement on:** one more line, `Settlement on: values the operator has not confirmed hold back REVIEWED and a push.`
- **Switch set, but not on:** when `DETHEREAL_SETTLEMENT` is set to anything but exactly `on` (an empty value included), one more line, ``Settlement off: DETHEREAL_SETTLEMENT is set, but not to `on`.`` The line is fixed text and never shows the value, since a repository's own settings can set it; `workspace_status` likewise carries only a boolean, `settlementSwitchNotOn`. A hook whose command carries `--settlement` does not read the environment, so it never prints this line.

With the switch unset, the default, the text says nothing about the settlement. With the settlement off, a model's state shows none of the settlement's qualifiers (pending enrichment, unregistered values, values from a pull). One exception: a model whose `.dethereal/` holds settlement records (`settlement-baseline.json` or `settlements.json`) gets `settled with the settlement on, which is now off` on its line. At startup that line shows only when the project has one model (with several, startup shows only a count); after compaction it shows on each model listed. This way a switch from on to off made outside the guarded configuration is still seen. Only the files' presence is checked; nothing in them is read. The hook reads the mode as the server does, or from `--settlement` on its command (see [MCP_ARCHITECTURE.md → Settlement Switch](MCP_ARCHITECTURE.md#settlement-switch)).

Everything taken from the repository is reduced to enums, counts and names cut to a safe character set, so a model name cannot inject instructions.

### Model State After Compaction

**Event:** `SessionStart` (`compact`)

After a compaction, `hook session-start --source compact` injects a reminder to re-read the state (`workspace_status`, then `model_state` `get` for the model in use) and a one-line summary of up to 10 registered models, followed by the same settlement line as at startup (settlement on, or switch set but not on). This is a `SessionStart` hook rather than a `PreCompact` hook because a `PreCompact` hook's output never reaches the model.

### Validation Hint After Model Edits

**Event:** `PostToolUse` (matcher: `Write|Edit|MultiEdit`)

`hook post-write` reads the event from stdin, finds which registered threat models the written files belong to, and, if any, tells the model to validate them with `validate_model_json`. It prints nothing for a file outside every model, and must stay fast because it fires on every file write in the session.

> **Note:** Model changes made via MCP tools (e.g., `update_model`, `export_model`) that write files internally do not trigger this hook because the file writes happen inside the MCP server process, not via Claude Code's Write/Edit tools.

### Config Guard

**Event:** `PreToolUse` (matcher: `Write|Edit|MultiEdit|NotebookEdit`)

`hook config-guard` ([`config-guard.ts`](../../../apps/dethereal/src/cli/config-guard.ts), [`config-content.ts`](../../../apps/dethereal/src/cli/config-content.ts)) keeps an agent from widening what runs without asking the operator. At project and user level:
- **Configuration** (Claude Code `settings.json`, `settings.local.json`, `.claude.json`; Codex `config.toml`; OpenCode `opencode.json(c)`) — the file is compared before and after the edit, and denied only by the rules below. The reason names the rule.
- **Claude Code's plugin cache** (`.claude/plugins/**`, and `$CLAUDE_CONFIG_DIR/plugins/**`) — denied by path, whatever the file and whatever it holds, through a write, an edit or a patch. The cached servers, hooks and skills run as installed; the operator reinstalls the plugin instead.
- **git's configuration, hooks and attributes** — denied by path on every harness, through a write, an edit or a patch: below a `.git` folder, `config`, `config.worktree`, `commondir` and `gitdir` (a submodule's under `modules/…` and a work tree's under `worktrees/…` too), anything under `hooks` (`.git/hooks/…`, and a submodule's or work tree's), and `info/attributes`; a `.git` file itself, which names the folder git reads in a linked work tree or a submodule; and the user's own `~/.gitconfig`, and `git/config` and `git/attributes` in XDG's configuration folder (`~/.config`, and `XDG_CONFIG_HOME` when set as an absolute path). Each can make git run a program when the operator next runs it; the operator edits them by hand. `.gitattributes`, `.git/HEAD`, a branch named `hooks` (`.git/refs/heads/hooks`) and the project's own files are not affected.
- **OpenCode plugin directories** — denied by path.
- **Skill, command and agent definitions** — denied when their text would grant a Dethereal tool or a wildcard.

**Claude Code settings.** In every scope, the per-project settings in `.claude.json` (`projects.<path>`) included, an edit is denied when it:
- adds an allow rule for a Dethereal tool or a wildcard of tools;
- adds an allow rule for Bash, in any form, `Bash(npm test)` included. The guard does not read shell commands, and even an exact command runs whatever an unguarded file says. Rules already in the file are left as they are;
- removes a deny or ask rule, or a `disallowedTools` entry, for a Dethereal tool or a wildcard of tools;
- sets the permission mode `bypassPermissions`, `acceptEdits`, `dontAsk` or `auto`, or skips the bypass-mode confirmation;
- changes `hooks`, `disableAllHooks`, the MCP server keys (`mcpServers`, `enabledMcpjsonServers`, `disabledMcpjsonServers`, `enableAllProjectMcpServers`, `allowedMcpServers`, `deniedMcpServers`), or a setting that runs a command or decides what runs: `statusLine`, `apiKeyHelper`, `otelHeadersHelper`, `awsAuthRefresh`, `awsCredentialExport`, `fileSuggestion`, `sandbox`, `extraKnownMarketplaces`;
- adds, changes or removes anything in `env`, since every process Claude Code starts reads it, the plugin's server and hooks among them;
- changes whether the Dethereal plugin is enabled, or enables any plugin (an `enabledPlugins` entry newly `true`);
- changes the Dethereal plugin's own options in `pluginConfigs`, which include its platform URL.

**Codex and OpenCode settings.** On Codex, an edit is denied when it sets an `approval_policy` to `never`, or changes `mcp_servers`, hooks or a project trust level. On OpenCode, when it widens or changes a permission for a Dethereal tool or a wildcard, removes one that was not `allow`, or changes `mcp` or `plugin`.

**The settlement switch.** A change to `DETHEREAL_SETTLEMENT` in a Claude Code `env`, in any spelling (upper or lower case, since the environment ignores case on Windows), gets its own refusal: the edit "changes whether the settlement is on, which changes what the server holds back and refuses". Any other `env` change is refused by the general rule. On Codex and OpenCode the variable lives in Dethereal's server entry, and any change to that entry is already denied.

Every path is judged as written and through links; on macOS and Windows, after folding letter case in full as the disk does: lower case, plus the long s (`ſ` read as `s`), the sharp s (`ß` as `ss`) and the Latin ligatures (`ﬁ` as `fi`, and `ﬀ`, `ﬂ`, `ﬃ` and `ﬄ` likewise, `ﬅ` and `ﬆ` as `st`), so `.GIT/Config` and `.git/conﬁg` are both `.git/config`; no other character is folded.

It fails closed on guarded paths only, when it cannot judge (unreadable event or file, ambiguous edit, unparseable content); every other write is allowed.

**Residual risks:** configuration written through a shell command, and MCP write tools of other plugins, are not seen by this hook. For git's configuration, the [Secret Guard](#secret-guard) refuses a `git` command that sets a key that runs a program, and Codex's shell guard a command that changes it (see [Codex Hooks](#codex-hooks)); on Claude Code and OpenCode, plain shell that writes it (`echo … >> .git/config`, `cp x .git/hooks/pre-commit`, a `git config --file` aimed at an existing hook, which rewrites it) is not refused (on Claude Code, Bash asks for the operator's approval), and a `.git` file is not followed to the folder it names. This hook knows git's files by a `.git` folder in their path, so a repository folder named otherwise (`git init --separate-git-dir`) is followed only by Codex's shell guard. A repository that already holds such configuration when the session starts runs it. Not judged on any harness: keys off the Secret Guard's list (`protocol.*.allow` with an `ext::` URL, `submodule.*.update=!…`, `trailer.*.command`, `core.alternateRefsCommand`); `git --git-dir`, `GIT_DIR` or `GIT_WORK_TREE` pointing at a folder the agent wrote; and a program a command runs only during that one command (`rebase --exec`, `fetch --upload-pack`, `submodule foreach`, `LESSOPEN`, `SSH_ASKPASS`), since the agent could run it directly. A hook folder the operator set (such as `.husky`) is project content.

### Auto-Approval

**Event:** `PreToolUse` (matcher: `^mcp__plugin_dethereal_dethereal__(<auto-approved tools>|model_state_settle)$`, `model_state_settle` with the settlement on) — Claude Code only

`hook approve` ([`approve.ts`](../../../apps/dethereal/src/cli/approve.ts)) approves the 16 Dethereal tools the tool manifest marks `auto` — tools that only read, or whose every change the server validates — so Claude Code asks for them no more than Codex or OpenCode do (see [Tools by Approval](#tools-by-approval)). A skill's `allowed-tools` would approve them only until the operator's next message. For one of those exact tool names it answers `permissionDecision: allow`. With the settlement on, it also approves one action of a tool that otherwise asks, listed in `AUTO_ACTIONS`: `model_state_settle` with `action: 'prepare'`, which checks a settlement and records nothing in the model (see [MCP_ARCHITECTURE.md](MCP_ARCHITECTURE.md#model_state_settle)). With the settlement off, that tool is not served, and the hook approves nothing of it. The hook counts the settlement as on when its command carries `--settlement`, which a bundle generated with the settlement on adds, or when its environment has `DETHEREAL_SETTLEMENT` exactly `on` (see [MCP_ARCHITECTURE.md → Settlement Switch](MCP_ARCHITECTURE.md#settlement-switch)). `model_state_settle` is still listed with the interaction hint (`anthropic/requiresUserInteraction`, see [MCP_ARCHITECTURE.md](MCP_ARCHITECTURE.md#tool-manifest-and-listing)), so Claude Code may still ask for a `prepare` the hook approved. The hook never approves `commit`, which records the prepared decisions, or `settle`, nor a call whose `action` is missing or is not exactly `prepare`. For any other tool or action, a malformed event or an error it prints nothing, and Claude Code asks as usual. It never denies and never asks, and the operator's own deny and ask rules still apply over it. The generator builds the matcher from the same two lists the hook reads — the tool manifest's `auto` tools and `AUTO_ACTIONS` — so the matcher and the hook cannot disagree. It accepts only `--harness claude`.

### Secret Guard

**Event:** `PreToolUse` (matcher: `^(Read|Grep|Bash)$`)

`hook secret-guard` ([`secret-guard.ts`](../../../apps/dethereal/src/cli/secret-guard.ts)) holds the workflow's secret-file rule when an agent does not follow it. A secret file is a file in the project named by the shared list in [`secret-paths.ts`](../../../apps/dethereal/src/utils/secret-paths.ts) (in any letter case; the OpenCode target builds its read rules from the same list), a `.yaml`, `.yml` or `.json` file holding a `kind: Secret` line, or a file that a kustomization (`secretGenerator` `envs`, `files`, `env`) or compose file (`env_file`, the top-level `secrets: <name>: file:`) names as a secret source; the denial names the file that references it. Those kustomization and compose files are looked for only in the target's own folder and its ancestors up to the project root, so the cost follows the folder depth, not the repository. A registered model's own files (`attributes/*.json`, `controls/*.json`, and everything under its `.dethereal/` and `.dethernety/`) are never secret; files outside the project are not judged as secret files, though the server's own folder and the harnesses' sign-ins are guarded wherever they are reached from (below). Other secrets in the home directory, such as `~/.aws/credentials`, stay out of the guard's scope by design. The guard denies (`permissionDecision: deny`, always exit 0):
- **Read** of a secret file.
- **Grep** of a secret file in any output mode, and a `content` or `count` search over a folder holding one; a names-only search (`files_with_matches`) is allowed, except over a folder that holds the server's own folder or a harness's sign-in. On Claude Code 2.1.286 the main conversation has no Grep or Glob tool; the plugin's agents have them through their tool definitions, so these checks apply to the agents' calls.
- **Bash** naming a secret file (braces expanded, a glob in any path segment expanded within the project, `cd` and `pushd` followed), a recursive content search (`grep -r`, `rg`, `ugrep`/`ug`, `git grep`, …) over a folder holding one, a `find` that runs a content reader on what it finds (`-exec`, `-execdir`, `-ok`, `-okdir`, or an `xargs` in the same command line) from such a folder, or a command that prints configuration values (`docker compose config`, `terraform show`/`output`, `printenv`, …). In a command line where `xargs` runs a content reader, every folder the line names is read in full, and `xargs`'s own operands are judged with `{}` taken as `*`: `ls deploy/orders | xargs -I{} cat deploy/orders/{}` is denied. `echo` and `printf` read no file, so their words are judged only when they feed such an `xargs` (`echo .env | xargs cat` is denied). A listing (`find <dir> -type f`) and names-only readers (`ls`, `stat`, `wc -c`, `grep -l`) stay allowed. A search's names-only flags are each tool's own: `--count-matches` and `--files-without-matches` count, and `-L` lists the files without a match for `grep`, `git grep`, `ugrep`, `ag` and `ack`, but makes `rg` follow links, so `rg -L` is a content search (`rg -L -uu API_KEY .` over a project holding `.env` is denied). A short option group ends at a letter that takes a value, so `-eclient` is a pattern, not `-c` (`grep -rn -eclient .` is a content search); for `rg`, `-r` (replace) and `-E` (encoding) take one too (`rg -rl '^' .` is a content search). The workflow's three name-only searches are recognised as written, and as agents commonly write them (bare safe paths, continued lines, an `echo` before); a near miss is denied with what differs (quote each path, one Secret name per command, the exact flags or format).

**The server's own folder.** Whatever the project, the guard denies every call that reaches `~/.dethernety`, the server's own folder in the home directory, which holds the sign-in, as the Codex and OpenCode guards do. This check runs before the project's checks, so it holds outside any project too:
- **Bash** reaching it: the home written as `~`, `~user`, `$HOME`, `${HOME}` or in full, after `cd` and `pushd`, through links, inside a `sh -c` script, or spelt with a brace sequence (`~/.dethernet{x..z}`, read as the glob it matches); a link made to it or to a folder holding it; or any command but one that lists names on a folder holding it (a content search, copy or archive included; see **A folder holding what no command may read**, below). An assignment before the command hides none of these (`X=1 ln -s ~ link` is denied). Listing it is denied too.
- **Read** of a file inside it, by its path or through a link.
- **Grep** inside it, by its path or through a link, and a Grep over a folder that holds it, such as the home directory, in every output mode. A names-only search is denied there too, because its patterns can spell out a file's content. A Grep with no path is judged by its working directory.

**The same folder under another path.** A path that starts with macOS's data volume is also read with the `/System/Volumes/Data` prefix removed, globs included: `/System/Volumes/Data/Users/*/.dethernety` is read as `/Users/*/.dethernety`. Where no text or link resolution matches, a path is also compared with the folder, and with the folders holding it, by identity (device and inode). So the folder reached under a second path is denied as the folder itself, for Bash, Read and Grep alike.

**Patterns in a path.** A path segment is matched against the folder as zsh reads it: globs, `(a|b)` groups (`~/(.)dethernety`, `~/.dethernet(y)`), the extended globs `?(…)`, `*(…)`, `+(…)`, `@(…)` and `!(…)`, each read as anything, and a trailing glob qualifier at the end of a word, matched with it and with it dropped (`~/.dethernety(/)`). A segment holding zsh's extended-glob operators (`#`, `^`, a `~` after the first character, `(#…)` flags) matches anything, whether or not the command turns `extendedglob` on: startup files often set it, and an inner `zsh -o extendedglob -c` would hide it. So `cat ~/.dethernet#y/tokens.json`, `ls ~/.dethernet?~q` and `cat ~/(#i).DETHERNETY/tokens.json` are denied. The cost: a file whose name holds `#`, `^` or a `~` after the first character matches the folder's name when it stands in the folder's place, so `cat ~/notes~` is denied, while `cat src/notes~` stays allowed. A pattern the guard cannot read, such as a range out of order (`[z-a]`), counts as a match. A path the guard can place is matched without the shell's dot rule, so `ls ~/*` is denied; the dot rule applies only to paths from an unknown folder (below).

**`cd` and the folder stack.** A `cd` or `pushd` into the folder is denied; one into a folder holding it is not, so `cd -` and `popd` are judged from every folder held before (below), and `~-`, `~N` and `$OLDPWD` are read as an unknown folder (see **A folder holding what no command may read**). `builtin cd`, `command cd`, `\cd` and `'cd'` are followed as `cd` is. A `cd` in a pipeline or in the background runs in a subshell and may leave the folder as it was, so later paths are judged from the folders held before it as well (`cd ~ && cd /tmp | true; cat .dethernety/tokens.json` is denied). A redirect on a `cd` is no operand of it, so `cd ~/.codex 2>/dev/null && cat auth.json` is followed, and denied. Its target is still judged as any written path (`cd . > ~/.dethernety/tokens.json` is denied); only the operands decide where the `cd` goes. A folder a command is told to work in (`-C <dir>`, as `git`, `make` and `tar` take it, `--directory`, `--chdir`, `--git-dir`, `--work-tree`) is one its other relative words are read from too: `git -C ~/.codex/sessions diff --no-index ../auth.json /dev/null` is denied. The option's own value, told apart by its place among the words, is read from where the command runs, so `git -C .. status` and `pnpm -C ../.. build` pass in a project; an operand spelled the same is read from the folder the option names as well (`tar -C .. -cf - ..` archives the folder above that one).

**`cd` through `CDPATH`.** A bare relative operand (`cd src`; not `.`, `..`, `./…`, `../…`, `-`, or one starting with `/` or `~`) is looked up through `CDPATH` when the guard knows it: from the hook's environment, which the shell inherits; set earlier in the command (`CDPATH=…;`, `export CDPATH=…`); or as an assignment before the `cd` (`CDPATH=~ pushd …`), which is also judged as a path. Every folder the `cd` may land in (each entry joined with the operand; an empty entry is the current folder) is judged as a `cd` target, so landing in the folder is denied, and is kept as a folder the rest of the command may run in, besides the operand taken from the current folder. With no `CDPATH` known, the operand is taken from the current folder alone. So `export CDPATH=~; cd .dethernety` and `CDPATH=~; cd work && cat ../.dethernety/tokens.json` are denied, while `cd .dethernety` with no `CDPATH` enters the project's own registry. Known limit: a `CDPATH` set only in the shell's startup files and not exported is not seen.

**A `cd` the guard cannot follow.** After one, the working folder is unknown for the rest of the command. Such a `cd` is:
- an operand the shell builds, holding `$` or a backtick (`cd $D`, `cd "$(printf %s ~)"`);
- a bare relative operand looked up through a `CDPATH` entry the shell builds (`CDPATH=$X cd work`);
- zsh's two-operand `cd old new`, which swaps text in the folder's path. Its operands are judged by their text too;
- a `cd`, `pushd` or `popd` word the guard does not find at the head of a command, such as one inside a function body (`f(){ cd ~; }`) or after an assignment and a wrapper (`X=1 builtin cd /tmp`);
- any segment the guard cannot parse into words.

`cd -`, `popd` and a bare `pushd` land in a folder held before: what runs there is judged by its text and from every folder the command held before, not as from a lost folder (`pushd packages/web && npm run build && popd && npx tsc -p .` passes).

**Paths from an unknown folder.** With the folder unknown, every later relative path is also judged by its text, segment by segment, read as in **Patterns in a path** above. It is denied when a segment:
- is named `.dethernety`;
- is a pattern matching that name: `.dether*`, `.dethernet?`, `(.)dethernety` and `@(.dethernety)` are denied. A pattern starting with `*`, `?` or `[` reaches the dot name only when the command turns dot matching on (`shopt -s dotglob`, setting `GLOBIGNORE`, zsh's `setopt globdots` or `GLOB_DOTS` in any spelling, `set -4`, or a word carrying a zsh glob qualifier that holds `D`, such as `*/*(D)` or `(.D)`), so `cat *ethernety/tokens.json` is denied only after such a setting, and `ls *` and `rm -rf dist/*` stay allowed. A setting made in a command holds inside a `sh -c` or `zsh -c` script it runs: `zsh -o globdots -c 'cd -; cat *ethernety/tokens.json'` is denied. Known limit: a dot-matching setting made only in the shell's startup files is not seen;
- is built by the shell and contains the name (`$P.dethernety`).

A content search, copy, archive or link of a relative path (an operand of a recursive search, of a `find` that runs a reader, of `tar`, `zip`, `cp`, `rsync`, `scp`, `ditto` or `cpio`, or a link source of `ln`) is denied too, since the folder may hold `~/.dethernety`: after `cd "$D"`, `grep -r foo .`, `tar czf /tmp/x.tgz .` and `ln -s . /tmp/h` are denied, while `cd src && grep -r foo .` is allowed. A listing (`find . -type f`) stays allowed; a names-only search (`grep -rl`) is denied as well, since it still reads every file (see **A folder holding what no command may read**, below).

So `D=~; cd $D && cat .dethernety/tokens.json` is denied. The known cost: after such a `cd`, a path through a folder named `.dethernety` is denied even when it is the project's own registry (`cd "$D" && cat .dethernety/models.json`). With `CDPATH` known, the same holds for a path that reaches a `.dethernety` from a folder the `cd` may have landed in (`CDPATH=~ cd src && cat ../.dethernety/models.json`).

**A segment the guard cannot parse.** Its braces are expanded and `$'…'` is decoded before the text check. A word it can then place is judged as a path, from every folder the command may run in; a word the shell builds is judged by its text, as above.

A Bash command whose words this check cannot place is denied as unchecked; it is never passed on to the project's checks. A Read or Grep path that starts with `~` (`~` alone or `~/…`) is judged as the home directory it names.

The project's own `.dethernety/` registry (`.dethernety/models.json` and the rest of the plugin metadata) is a different folder and is not affected. A denial names `.dethernety` and the sign-in, and never quotes file content.

**The harnesses' sign-ins.** Right after the server's folder, and outside any project too, the guard keeps every tool from each harness's own sign-in: Claude Code's `.credentials.json` in `~/.claude` and in a `CLAUDE_CONFIG_DIR` set as an absolute path; Codex's `auth.json`, and `.credentials.json` (where Codex keeps its MCP servers' tokens when it stores them in a file), in `~/.codex` and in a `CODEX_HOME` set as an absolute path; and OpenCode's `auth.json` and `mcp-auth.json` in its data folder, `~/.local/share/opencode` and `opencode` under an `XDG_DATA_HOME` set as an absolute path. It denies a Read or Grep of one, by its path or through a link, and a Grep over a folder holding one, in every output mode, names-only included. It denies a Bash command reaching one, read as a command reaching the server's folder is (the home's spellings, links, patterns, `cd`, a folder holding it), with `$CODEX_HOME`, `$CLAUDE_CONFIG_DIR` and `$XDG_DATA_HOME` each read as its value only when the environment sets it as an absolute path; unset, the shell writes it as nothing, so the word is left as written and judged by its text (`cat $XDG_DATA_HOME$HOME/.codex/auth.json` is denied). One reason names them all: the call "reaches a harness's own sign-in". The OpenCode guard and Codex's shell guard run the same check. A `.credentials.json` inside a project is a secret file of the project, as the shared list names it.

**A folder holding what no command may read.** On every harness, a Bash command that names a folder holding the server's folder or a harness's sign-in (on Codex also Codex's `config.toml` and Claude Code's `.claude.json`; see [Codex Hooks](#codex-hooks)) is refused unless it only lists names: `ls`, `stat`, `file`, `du`, `basename`, `dirname`, `realpath`, `readlink`, `echo`, `printf`, `test`, `[`, `true`, `pwd`, `tree`, `which`, `type`, `command -v`, and `find` without `-exec`, `-ok`, `-delete` or an `-fprint`/`-fls` output file. So `diff -r ~/.claude /tmp/empty`, `grep -d recurse '' ~/.claude` and `pax -w ~/.claude` are denied, while `ls -la ~/.codex`, `du -sh ~` and `cat ~/.claude/settings.json` (a file beside the sign-in, not a folder holding it) are allowed. In a line that feeds what one part prints to another, every part counts, names-only ones included: `ls ~ | xargs cat` is denied, `ls ~ | sort` is not. Such a line has an `xargs` or `parallel` running more than a names-only command; a loop or a read (`while`, `until`, `for`, `select`, `read`, `mapfile`, `readarray`); a copier taking names from its input (`cpio`, `tar -T`, `zip -@`, `rsync --files-from`, `pax -w` naming no file, or any command given a list of names from a file or its input: `--files0-from`, `--stdin-paths`, `xz` or `zstd --files`); a command or process substitution (`$(…)`, backticks, `<(…)`, `>(…)`), piped or not; or, in a piped line, `source` or `.`, a shell or interpreter reading its input, or a part the guard cannot read word by word. There a word the shell builds is judged as a path as well as by its text (`echo "$(ls ~/.codex)" | xargs cat`), and so is the folder a `cd` goes to (`cd ~/.claude && ls -A | xargs cat` is denied). The folder a part runs in, which a command naming no folder lists, is judged only for a part that reads what another prints: an `xargs` or `parallel` running more than a names-only command, a loop or a read, `source` or `.`, a copier taking names from its input, or a shell or interpreter reading its input. So `du -a | cut -f2 | xargs cat` is denied in a session started in the home folder, while `cd "$(git rev-parse --show-toplevel)" && npm test` is allowed. A word a command substitution builds is also judged with that part read as anything (`cat ~/.codex/$(…)`). After a change of folder the guard could not follow (`cd "$D"`, `cd "$(…)"`), a command that does more than list names is denied when it names `.`, `..`, or a relative path whose segments (each `..` taking the one before it) read as a run of the path of something no command may read: `auth.json`, `../auth.json`, `.codex`, a glob such as `a*` (one starting with a wildcard reaches a dot name only with dot matching on, as in **Paths from an unknown folder**), as `D=~; cd $D && diff -rN .claude /tmp/e` is. `~+` and `$PWD` are read as the folder the guard holds, or there as that unknown folder (`cat ~+/auth.json`, `cat "$PWD/auth.json"`). `~-`, `~N` and `$OLDPWD` are always read as an unknown folder, since the guard keeps no previous folder or folder stack, and a change into a folder holding such a file is allowed: `cd ~/.codex && cd /tmp && cat ~-/auth.json` is denied. `$PWD` and `$OLDPWD` are read so only where the part's command does more than list names and is not a change of folder: `echo $OLDPWD` and `cd "$OLDPWD"` pass, while `cat "$OLDPWD/auth.json"` reads as from an unknown folder. In a line that feeds one part to another, every part counts as doing more, and a part that reads what another prints is denied whatever it names. An assignment on its own is not a command: `D=~` alone is not denied.

**Known over-refusals.** A folder holding the server's folder or a sign-in cannot be told from one a command will read through, so these are refused, by design:
- a command that does more than list names, given `~`, `$HOME`, `/`, a folder above the home folder, or `~/.claude`, `~/.codex` or `~/.local/share/opencode`: `chmod 700 ~`, `cat /`, `df -h /`, `tr / _`, `python3 x.py ~`, `git -C ~ status`, `cp notes.txt ~`;
- in a session started in the home folder, a bare `.` (jq's `.` filter included) and every part of a fed line that reads what another prints;
- after a change of folder that could not be followed, `.`, `..`, or a name a protected file's path holds (a lone `*` included, which matches one of its folders), a change to the repository root or the current folder by a substitution or `$PWD` included, since a command can set `PWD` or git's variables first: `cd "$(git rev-parse --show-toplevel)" && git diff .`, `cd "$PWD" && git diff .`;
- the same after a later change to a folder named in full, which does not restore the folder, since a `cd` in a pipeline or in the background would not move the shell (`cd "$X"; cd /tmp && npm test -- .`);
- a command that does more than list names reading through `$OLDPWD`, judged as from an unknown folder whatever the previous folder was (`cd src && cat "$OLDPWD/auth.json"`);
- a search that lists names (`grep -rl`) over a folder holding the server's folder or a sign-in, since it still reads every file.

**The macOS keychain.** On every harness, wherever the command runs, the guard denies a Bash command that runs macOS's `security` in a way that can print a secret from a keychain, or runs what it is sent: every subcommand but `find-certificate`, `find-identity`, `list-keychains`, `default-keychain`, `show-keychain-info`, `verify-cert` and `help`; `find-generic-password` and `find-internet-password` only with `-w` or `-g` (without, they print an item's attributes); interactive mode (`-i`, and `-p`, which implies it), which reads what to run from its input; and a subcommand the shell builds (`$X`, `"$1"`, `$(…)`), which may be any. The rule is read from the command's words, where `security` is the command a simple command runs: after wrappers with their options (`env`, `sudo -u root`, `xcrun`, `caffeinate -i`, `arch -arm64`, `script -q /dev/null`, `watch`), keywords (`then`, `do`), `eval`, `coproc` and assignments; after `find`'s `-exec` or `-ok`; or at the start of a function body, a group, a `case` label's `)`, a `sh -c` script, a substitution or a backtick; the check by name also starts a command after `;`, `&`, `|` and a newline. There it is matched under any path (`/usr/bin/security`), in any letter case (`SECURITY`), as a glob (`securit?`, `s[!x]curity`; a word that is no valid pattern, such as `[` or `[[`, is not taken for it, so `[ $? -eq 0 ]` passes), inside a brace group the shell writes out (`{security,dump-keychain}`), or in a variable assigned it (`S=security; $S dump-keychain`). `security` takes any unique start of a subcommand's name (`dump-k`, `find-g`), so the rule reads a start as every subcommand it may stand for: quiet only when each of them is, and decided by `-w` or `-g` when it may stand for `find-generic-password` or `find-internet-password` (`security list-k` passes; `security dump` and `security find-g -ws x` are denied). Its own options are only `-h`, `-i`, `-l`, `-q`, `-v` and `-p`, and `--` ends them (`security -- dump-keychain` is denied); it counts as a call of `security` only when what follows them starts one of `security`'s own subcommands or is a word the shell builds, or, when an `xargs` or `parallel` comes earlier in the same simple command, anything, since their input may supply the subcommand (`echo dump-keychain | xargs security`). So `echo security`, `git add security auth`, `ls security error`, `grep -rn security -il src` and `git commit -m "fix security issue"` pass. The full guards and the check by name ([below](#codex-hooks)) run this one rule. The full guards read each part's words as the shell does, so a quoted text is one word and `git commit -m "fix (security export)"` passes; a part they cannot read word by word is read from its text, as the check by name reads every command, which therefore refuses that commit.

**git's configuration.** On every harness, wherever the command runs, the guard denies a Bash command whose `git` sets a configuration key that makes git run a program, now or when the operator next runs it: before the subcommand, a `-c` or `--config-env` (`git -c core.pager=less log`), or `--exec-path=<dir>`, which takes git's own programs from that folder; a `git config` write of such a key, which is any word naming one followed by another word, so every mode, scope, file and abbreviated option reads alike (`git config --fil .git/config core.pager x`); `git config --edit` and its abbreviations (`--edi`, `-e`); a `rename-section` into a section holding such keys; `git init` or `git clone` with `--template` (or an abbreviation), whose hooks it copies; and a `git clone -c` or `--config` of such a key. A read or a removal of one key passes (`git config --get core.pager`, `git config --unset core.pager`). The keys, in any letter case, are `core.fsmonitor`, `core.pager`, `core.sshCommand`, `core.hooksPath`, `core.editor`, `core.askPass`, `core.gitProxy`, `diff.external`, `diff.*.textconv`, `diff.*.command`, `filter.*.clean`, `filter.*.smudge`, `filter.*.process`, `merge.*.driver`, `credential.helper` and `credential.*.helper`, `sequence.editor`, `pager.*`, `gpg.program` and `gpg.*.program`, `interactive.diffFilter`, `include.path` and `includeIf.*.path`, `remote.*.uploadpack` and `remote.*.receivepack`, `uploadpack.packObjectsHook`, `hook.*.command`, `difftool.*.cmd` and `mergetool.*.cmd`, and `init.templateDir`; a key the shell fills in (`$K`, a backquote) counts too. An `alias.*` counts when its value starts with `!` or with an option (`-c …`), uses `config`, or holds `$` or a backquote. A value that runs nothing passes: the pager `cat` or an empty one, the editor `true` or `:`, and `pager.<command>` set to a boolean (`git -c core.pager=cat log`, `GIT_EDITOR=true git rebase --continue`, `git -c pager.log=false log`). git is found where a simple command runs it (after wrappers and assignments, under any path); behind `xargs`, whose added words count as a value (`echo /tmp/x | xargs git config core.fsmonitor`); after `find`'s `-exec`; behind `xcrun`; dashed (`git-config`); and in a script the command runs (`sh -c "git config core.pager x"`). Also denied: the environment's equivalents, set anywhere in a command that runs git, a script inside it included (`GIT_EDITOR=/tmp/x sh -c "git commit"`) — `GIT_CONFIG_PARAMETERS`, a `GIT_CONFIG_KEY_<n>` naming such a key, `GIT_EXTERNAL_DIFF`, `GIT_PAGER`, `GIT_EDITOR`, `GIT_SEQUENCE_EDITOR`, `GIT_SSH`, `GIT_SSH_COMMAND`, `GIT_ASKPASS`, `GIT_PROXY_COMMAND`, `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` (both pass as `/dev/null`), `GIT_CONFIG`, `GIT_EXEC_PATH`, `GIT_TEMPLATE_DIR`, `PAGER`, `EDITOR` and `VISUAL`, a pager or editor that runs nothing passing as above. A variable counts when set before the command or between the wrappers on the way to git, layer by layer (`nice env GIT_PAGER=x git log`, `sudo GIT_PAGER=x git log`), behind `find -exec` and `xargs` too, or as an argument of `export`, `declare`, `typeset`, `local`, `readonly` or `env`, `+=` included (`GIT_EDITOR+=/tmp/x git commit`); a `NAME=` elsewhere in the line does not (`grep -rn 'EDITOR=' src && git status` passes). A part the guard cannot read word by word is read as pieces of words, a quoted text kept whole, and each piece's git run is judged by the same rules. That part is also refused when it names git, a way to set configuration (`config`, `-c`, `--config…`, `--template…`) and such a key anywhere in it, which is what a substitution hides (`$(which git) config core.pager x`); its words are read as written and with their quotes taken out (`$(echo git) "co"nfig core.pager x`), but for a quoted text holding a line end, as a here-document commit message does, and here-document bodies are not read for that. There a value cut short by a quote counts as unknown, so no pager or editor exemption applies to it (`git config core.editor 'true ; x' $X` is refused). The here-document commit form (`git commit -m "$(cat <<'EOF' … EOF)"`) passes whatever its message says, but for a line that reads as a git command (below). So `git config user.name "A B"`, `git config alias.st status` and git's ordinary work pass, and so do the undo workflow's commands (`git diff`, `git checkout -- <file>`, `git stash push -- <file>`, `git revert`, `git commit`). The [config guard](#config-guard) keeps an agent's writes from the same files by path.

**Known over-refusals.** The rule reads words, not git's full grammar, so these are refused, by design:
- `GIT_SSH_COMMAND` and `core.sshCommand`, whatever their value;
- a `git config` read with a value pattern on such a key (`git config --get core.pager x`);
- a `git config` whose `--file` or other word is a shell variable followed by a key, since the variable may name a key (`git config --file "$F" user.name x`);
- a here-document body line that itself reads as a git command setting such a key (the shell's own line splitting reads it as a command);
- a part the guard cannot read word by word that names git, `config` or `-c`, and such a key anywhere, even as a message or a file name outside a here-document;
- on Codex, a command naming `.git/config` or `.git/hooks` as a word, git's own included (`git log -p -- .git/config`; see [Codex Hooks](#codex-hooks)).

Glob lists names only and is not matched. Read and Grep fail closed: an event that cannot be read (its tool or file unknown), an unplaceable path, an unscannable file, an internal error or the 6 s deadline (under the 10 s hook timeout) deny the call. A Grep with no path searches the working directory; a Grep from an event that could not be read whole, with no output mode recovered, is taken as a content search. Bash is denied when it names a secret file, reads a folder holding one in full, or cannot be checked (a glob or folder past the bound or deadline, a file it cannot scan); a fault before any check (no project root) denies it only if its text names a secret file, and an internal error only if its text names a secret file or guarded configuration, or runs `security` as the keychain rule refuses (the same check as [the Codex fallback](#codex-hooks), with Codex's home and Claude Code's configuration directory read from the environment), so a guard fault never blocks every shell command. The 6 s deadline bounds the whole decision, from its start: the checks on the server's folder, the sign-ins and Codex's shell roots count against it as much as the project's checks, and a call not judged by then is denied on every harness, the reason saying the check ran out of time. After a `cd` the guard cannot follow (`cd -`, `popd`), the rest of the command is judged by its text. A wrong `--harness` denies every call, Bash included: the denial goes to stdout with exit 0, its reason naming the `--harness` the guard was wired with, where another hook would exit 1 and let the call run. A denial starts with `dethereal-secret-guard:` and never quotes file content.

**Residual risks:** a shell is not a sandbox — an interpreter, a variable, `$(…)`, a file of names, an `xargs` fed by a command that names no folder (`ls | xargs cat`, `git ls-files | xargs cat`), or an encoding reaches a file by a name the hook never sees. The check by name (see [Codex Hooks](#codex-hooks)) misses more: a name built while the command runs, a hard link, and a link an earlier call made. A secret source named only by a kustomization or compose file outside the target's folder chain (a sibling overlay's `../x/y.env`) stays with the workflow's rule. Of the keychain's clients only `security` is refused; another (Python's `keyring`, `osascript`) is not. OpenCode's history in its data folder (`opencode.db`, `storage`) is not a sign-in and is not guarded. `jq` reads `~/.jq`, when it is a file, into every program, so a `jq` counted as a read runs what it holds; and a `jq` filter can print the environment (`env`, `$ENV`), which is not refused as `printenv` is. The full guard does not follow a folder held in a variable assigned earlier in the line (`D=~/.codex; cat $D/auth.json`). The guard's own 6 s deadline fails closed for everything but a single blocking system call; on Claude Code before 2.1.295 (2.1.289 verified), a guard killed at its 10 s hook timeout lets the call run (fails open), as does one that cannot start, crashes, or runs on a Node older than 14.8; on 2.1.295 or later the guard's `onFailure: "block"` blocks the call, and the Codex runner and the OpenCode plugin refuse it. Codex has no file deny; there the guard judges shell commands only, through the hook runner (see [Codex Hooks](#codex-hooks)). On Codex the guard is best effort: it judges a command by the file names it mentions, so an interpreter, or a session fed input later, can get past it; Codex's own sandbox is the boundary. The shell checks (see [Codex Hooks](#codex-hooks)) share two limits: git configuration a repository already holds (`diff.external`, a `textconv` driver, `core.pager`, `core.fsmonitor`) runs code when git reads, under `git status`, `git diff`, `git show` or `git log` (the git configuration guard's limits are under [Config Guard](#config-guard)); and Codex shell tools other than `Bash` are not seen by these hooks.

### Codex Hooks

The Codex target ships its hooks in `plugins/dethereal/hooks/hooks.json` at the plugin root. Each command runs a script in the plugin's `bin/` with Node: `node "${PLUGIN_ROOT}/bin/<script>" …`. Codex trusts a hook by a hash of its definition, and `${PLUGIN_ROOT}` is substituted after that hash, so every entry is present in a fixed order with commands that do not change between versions. Codex asks the operator to review and trust the plugin's hooks once; an untrusted hook never runs.

| Event | Matcher | Command | Timeout | In this version |
|-------|---------|---------|---------|-----------------|
| `SessionStart` | `startup` | `bin/hook.mjs session-start --source startup --harness codex` | 15 s | Session orientation, through the runner |
| `SessionStart` | `resume` | `bin/hook.mjs session-start --source resume --harness codex` | 15 s | Session orientation, through the runner |
| `SessionStart` | `clear` | `bin/hook.mjs session-start --source clear --harness codex` | 15 s | Session orientation, through the runner |
| `SessionStart` | `compact` | `bin/hook.mjs session-start --source compact --harness codex` | 15 s | Compaction reminder, through the runner |
| `PreToolUse` | `^mcp__\|(spawn_agent\|send_message\|followup_task\|wait_agent\|close_agent\|resume_agent\|list_agents\|interrupt_agent\|apply_patch)$` | `bin/pre-tool-use.mjs` | 10 s | Agent-tool restriction |
| `PreToolUse` | `^Bash$` | `bin/hook.mjs secret-guard --harness codex` | 10 s | Shell checks, then the secret-file guard for shell commands, through the runner |
| `PreToolUse` | `^apply_patch$` | `bin/hook.mjs config-guard --harness codex` | 10 s | Config guard for patches, through the runner |
| `PostToolUse` | `Edit\|Write` | `bin/hook.mjs post-write --harness codex` | 15 s | Post-write hint, through the runner |

**Agent-tool restriction.** Codex gives a spawned agent every tool its parent has and ignores the tool lists in agent files, so `bin/pre-tool-use.mjs` enforces each Dethereal agent's tools from `bin/leaf-allowlist.json` (generated per agent: its Dethereal MCP tools, and whether it may change files). For a call from a thread whose `agent_type` starts with `dethereal-`, it denies:
- any collaboration tool (`spawn_agent`, `send_message`, `followup_task`, `wait_agent`, `close_agent`, `resume_agent`, `list_agents`, `interrupt_agent`): an agent never starts, messages or interrupts another
- `apply_patch`, unless the agent may write
- a tool of any MCP server other than Dethereal
- a Dethereal tool outside the agent's list

A call from any other thread passes untouched, with nothing printed. For a Dethereal agent the hook fails closed: input it cannot parse is scanned for the agent type, and an unknown `dethereal-…` agent, a call naming no tool, a missing or unreadable list and an internal error deny the call, and so does the 6 s deadline when the caller is, or may be, a Dethereal agent. The script uses only Node built-ins, so it runs without the MCP server. Without hook trust, the agent's instructions are the only restriction.

**The hook runner.** `bin/hook.mjs` runs session start, post-write and the two guards in the installed runtime. It uses only Node built-ins, and runs a hook only after checking the runtime with `bin/runtime-check.mjs`, a byte-for-byte copy of the installer's own check:
- `~/.dethernety/runtime/current.json` and the directories above it are real, owned by the user and not group- or world-writable.
- The record names `runtime/<version>`, and the runtime's whole file set hashes to the recorded value.
- The recorded Node binary is a regular executable owned by the user or root and not group- or world-writable.

If the recorded Node binary is gone (for example after a Homebrew or nvm upgrade), the runner uses the Node it runs on, if that passes the same checks and the minimum version; session start then says the MCP server will not start until Dethereal is reinstalled.

The runner starts the runtime's `dethereal hook <event>` with the event on stdin, `NODE_OPTIONS` and `NODE_PATH` removed, output capped at 64 KiB, and a deadline 2 s below the hook's timeout, read from `bin/hook-deadlines.json` (generated from the same table as `hooks.json`). It passes the output on only when the runtime exits 0, and for the two guards only when it is empty or one well-formed deny. When the runtime is sound but a guard fails — it crashes, runs past the deadline, prints too much or answers malformed — the call is refused, with a reason that says it could not be checked for secret files and asks the agent to report this to the operator and not to reach the file another way; a guard that can be made to stall must not fall back to the weaker check by name. A guard event that cannot be read whole within 3 s, or is over 32 MiB, is refused.

**Shell checks.** For a `Bash` call, the runner first runs two checks from `bin/shell-check.mjs`, a copy of [`shell-check.mjs`](../../../apps/dethereal/src/utils/shell-check.mjs). They use only Node built-ins and need no runtime. They run inside the existing secret-guard entry, so no hook was added and hook trust is unchanged.
- **Input sent later** — for every caller, the main conversation included. A command that runs input sent to it later is refused: a shell reading its script from input (`sh -s`, `bash /dev/stdin`, a shell or interpreter started with no script), `source /dev/stdin`, `read` combined with `eval` or a variable as the command, `xargs … sh -c`. Codex sends later input to a running command (`write_stdin`) without any hook seeing it. Best effort: a line the check cannot read is left to the secret guard.
- **Read-only agents** — for a Dethereal agent that may not change files (both infrastructure scouts and the model-reviewer: no `write: true` in `leaf-allowlist.json`). Every command in the line, those a `sh -c`, an `eval`, a `$( )` or a backtick runs included, must be one that only reads, from an allowlist: `cat`, `head`, `tail`, `wc`, `sed -n` printing scripts, `grep`, `rg`, `ls`, `find` without `-delete` or `-exec`, `jq`, `git log`/`show`/`diff`/`status`/`ls-files`/…, `kubectl get`/`describe` and a few more. Anything else is refused, and so is anything the check cannot read (an expansion in a command name, a loop or branch, a heredoc, a redirect other than to `/dev/null`); the reason names the first command or construct refused. For a Dethereal caller the check fails closed: an unreadable event, agent list or check refuses the command. Codex's sandbox setting for an agent may not cover its shell (with Codex 0.161 it did not); these agents keep `sandbox_mode = "read-only"` as defence in depth.

**The shell guard.** In the runtime, `secret-guard --harness codex` judges a `Bash` call (its command, run in the event's `cwd`, or in `workdir` when the call carries one) before the [Secret Guard](#secret-guard)'s checks, and fails closed: an event it cannot read, or one carrying no command, is refused. It refuses a patch run through the shell (`*** Begin Patch`; Codex would apply it past the config guard, so the reason points to `apply_patch`), a shell or interpreter left waiting for input, and a command reaching one of these roots, read as the Secret Guard reads a command reaching the server's folder:
- the server's own folder, `~/.dethernety`;
- Codex's `config.toml` and its sign-in `auth.json`, in `~/.codex` and in a `CODEX_HOME` set as an absolute path, both looked at whichever the session uses, with `$CODEX_HOME` read as Codex's home (the absolute one set, else `~/.codex`). The sign-in gets the Secret Guard's sign-in reason. Neither is read, and a folder holding one is refused to any command that does more than list names, as a folder holding the server's (see [Secret Guard](#secret-guard));
- Codex's plugin folders (`plugins` in those homes, and `.codex/plugins` in the folder the command runs in). A command that only reads may reach them, inside them or through a folder holding them, so `rg foo .` and `grep -rn foo .` search a project; not through a folder that also holds something no command may read (`rg foo ~`), nor through a path that reaches both, which counts as the former (`grep -R foo .` in a project holding a link to `~/.codex`), and the Secret Guard's checks for the project's secret files still apply to every path. Only reading means a plain reader such as `cat`, `ls` or `grep`; `rg` without `--pre`; `sed -n` printing a line range; `find` without an action; or `jq` with no filter file (`-f`/`--from-file`), no module loaded (`import`, `include`, `-L`/`--library-path`), `-f` and `-L` counted in a group of short options too (`-rf`), and no variable set in the segment — each with no output redirect. git does not count, since it reads its repository, wherever that is, and not only the files it names; nor do `less` and `more`. Any other command, one that changes, copies, links, archives or runs a file there, is refused, since a hook script changed through the shell keeps the trust its `hooks.json` was given.

Checked only after those, so it only adds refusals: what the [config guard](#config-guard) keeps from an agent's writes in Claude Code's configuration — `settings.json`, `settings.local.json` and the `plugins`, `skills`, `commands` and `agents` folders, in `~/.claude`, in the project's `.claude` (in the folder the command runs in) and in a `CLAUDE_CONFIG_DIR` set as an absolute path (which `$CLAUDE_CONFIG_DIR` is then read as). A command that only reads may reach them, as it may the plugin folders; any other, one that changes, copies or links them, is refused, and so is a search, copy, archive or link of a folder holding them by a command that does not only read. Claude Code's `.claude.json`, in the home directory and in that `CLAUDE_CONFIG_DIR`, is not even read, as `config.toml` is not: it can hold the user's MCP servers and their keys, so `cat ~/.claude.json` and `jq . ~/.claude.json` are refused. This refusal is Codex's shell's own, and its reason says so: Claude Code's and OpenCode's guards still let `.claude.json` be read. A third pass, after that one, covers git's configuration, read as Claude Code's configuration is: `config`, `config.worktree`, `hooks`, `info/attributes`, `commondir` and `gitdir`, and the `worktrees` and `modules` folders whole (at any depth), in the `.git` of the folder the command runs in and of the nearest folder above holding one; where that `.git` is a file, as in a linked work tree or a submodule, also the file itself, and the same in the folder it names and in that folder's `commondir` (the repository's own `.git`); and the user's `~/.gitconfig`, and `git/config` and `git/attributes` in `~/.config` and in an `XDG_CONFIG_HOME` set as an absolute path. A command that only reads may reach them (`cat .git/config`, `ls .git/hooks`); one that changes, copies or links them is refused (`echo x >> .git/config`, `cp x .git/hooks/pre-commit`, `cp ~/.gitconfig /tmp/g`, and in a linked work tree `echo x >> ../main/.git/config` and `echo gitdir: /tmp/x > .git`). git's own commands (`git add`, `git commit`, `git init`) write objects and the index and name none of them, so they pass. Every other command goes on to the Secret Guard's checks.

**The platform URL at session start.** Codex gives hooks the session's environment, not the server's, so the URL set at install reaches only the server. Before session start, and never for the guards or post-write, the runner therefore asks Codex which URL variables it gives Dethereal's server from the session's folder (`codex mcp list --json`, every trusted configuration layer merged) and gives the hook the same `DETHERNETY_PLATFORM_URL` and `DETHERNETY_URL`, so the orientation and the server agree; the time this takes counts against the hook's deadline. The `codex` binary is taken only from an absolute `PATH` entry outside the session's project and the temp folders, never from a `node_modules` folder, and runs in its own process group with a 5 s limit and a 1 MiB output cap. If Codex is not found, fails, times out or answers unexpectedly, the hook runs with the session's environment as before. A `-p` profile, `-c` overrides and managed configuration are not seen from a hook.

**When the runtime cannot be used.** A tampered runtime is never run. When the runtime is tampered, missing or unverifiable, the guards still judge the call by name with `bin/secret-fallback.mjs`, the package's shared list of secret file names and guarded configuration paths. The secret guard refuses a shell command that names a secret file or guarded configuration (Codex's config, its sign-in files `auth.json` and `.credentials.json` and its plugin folders, Claude Code's sign-in file `.credentials.json` wherever it is, as a secret file, OpenCode's sign-ins as any path ending in `opencode/auth.json` or `opencode/mcp-auth.json`, Claude Code's `.claude.json`, Claude Code's plugin cache, Dethereal's state directory; with `CLAUDE_CONFIG_DIR` set, also its settings files and its plugin, skill, command and agent folders; `CODEX_HOME` and `CLAUDE_CONFIG_DIR` are read as the full guards read them, counting only when absolute, resolved as text with no link followed, and a relative `CODEX_HOME` is kept as written beside `~/.codex`, since Codex may still use it), a plain read of a plugin file included, since by name alone a read cannot be told from a write. It also refuses a command that runs macOS's `security` as the [Secret Guard](#secret-guard)'s keychain rule refuses: the same rule, on the words read as below. A command's words are read as written; again with `$CODEX_HOME`, `$CLAUDE_CONFIG_DIR`, `$XDG_DATA_HOME` and any `${…}` form of them written as their value when set and not empty (braces read both to the matching one and to the first); and again with the word of any variable's `${NAME:-word}` form (`-`, `=`, `+`, `?`, with or without `:`) in its place, two rounds deep, so a word holding another form is read too; a word quoted in part (`"$HOME"/x`) is read whole as well. Each reading only adds words. The config guard refuses a patch that touches a secret file or guarded configuration. Both refuse a call they cannot read. Everything else goes through. When the runtime check fails, session start says the runtime is degraded and how to fix it (reinstall, or remove the plugin); post-write does nothing.

**Trust.** Codex skips a plugin hook, without notice, until the operator has reviewed and trusted it. Before that, none of these hooks runs, the guards included.

### OpenCode Plugin

OpenCode has no hook file: the OpenCode bundle ships a plugin, [`plugins/dethereal.ts`](../../../apps/dethereal/bundles/opencode/plugins/dethereal.ts), which the installer writes into the OpenCode config folder with the Node binary and the runtime entry filled in. OpenCode runs it in its own process, with the operator's rights; it starts only Node with the Dethereal CLI (`hook <command> --harness opencode`), never a shell, and sends each hook only the fields it needs.

- **`tool.execute.before`** — the secret guard before `read`, `grep` and `bash`; the config guard before every file write (`write`, `edit`, `multiedit`, `patch`, `apply_patch`). A denial throws, so OpenCode refuses the call and the model reads why. A call runs only when the guard ran and allowed it: a guard that fails, times out or answers unreadably refuses it, and so does a missing runtime entry, since Node still starts and the guard fails. When the guard cannot be started at all (no Node, or none that may be run, at the path the installer wrote), a read, a search or a write is refused, and a shell command is judged by name only, inside OpenCode's own process. The command is refused when:
  - it cannot be judged: it has no command text, a `workdir` that is present but not text, a command and `workdir` longer than 8 KiB together (the name check grows with the square of the length), or a run of 64 or more slashes or backslashes in either (the fallback's name check is slow on one);
  - any of its arguments holds `dethernety` in any letter case, or the check [Codex's runner](#codex-hooks) uses when its runtime cannot be used (`secret-fallback.mjs`) refuses its command or its `workdir`: a secret file or guarded configuration (the harnesses' settings and sign-ins, such as `~/.claude/.credentials.json` and `~/.codex/auth.json`, `opencode.json` and `opencode.jsonc`, and plugin and definition folders), with `$CODEX_HOME` and `$CLAUDE_CONFIG_DIR` read as their values;
  - it spells `$CODEX_HOME`, `$CLAUDE_CONFIG_DIR` or `$XDG_DATA_HOME` at all, set or not;
  - it holds a glob or brace character (`*`, `?`, `[`, `{`) where the shell can build a name the check never reads: beside a home spelling (`~`, `$HOME`, `${HOME}` or the home path itself), in a command that runs at or above the home, has a word that resolves at or above the home, has a glob word that can reach there (its fixed folders before the first glob component, then up one folder for each later `..` and for each glob component that starts with a dot, such as `.?`, `.[.]` or `.*`, which an older shell matches to `..`; folders it goes down first offset the climb), or changes folder at all (`cd`, `pushd` or `popd`, in any form). This refuses `cat ~/.cl*/.cred*`, `cat ~/.{codex,x}/auth.json`, `cd && cat .cod?x/auth.json`, `cat .cod?x/auth.json` with the home as `workdir`, `cat ../.cod?x/auth.json`, `cat */../../.cod?x/config.toml` and `ls .?/.cod?x` from a project directly in the home, `cat /U*/u/.cod?x/auth.json`, and also `cd src && ls *.ts`, while `ls src/*.ts`, `cat ../lib/*.ts` and `cat src/*/../lib/*.ts` from inside a project run;
  - the folder it runs in (its `workdir`, resolved from the session folder, else the session folder) lies inside a guarded folder; or
  - a word of the command, resolved from the folder it runs in, lies inside a guarded folder or names a folder that holds one, below the home (or below the root, for a guarded folder outside the home), or names a part of OpenCode's data folder that reaches it in steps (`.local` or `.local/share` ending a path, or a `share/opencode` segment), or the command or its `workdir` has a `.codex`, `.claude`, `.dethernety` or `.local/share/opencode` path segment, as written or where the path lands once resolved. This refuses `cd ~/.codex && cat auth.json`, `cd ~/.local/share && cat opencode/auth.json`, `cd ~ && cd .local/share && cat opencode/auth.json`, `cat ~/.local/share/opencode/auth.json`, and a link to a guarded folder made in the same command, while `ls ~/.local/bin` runs. The segment check reads a path inside the session folder by its place there, so a session folder whose own path holds `.claude` (such as a git worktree under a project's `.claude/worktrees/`) does not refuse every absolute path inside it; a `.claude` segment within the project is still refused, and so is a climb out of the session folder that lands in one, such as `cat ../../settings.json` from a worktree under `<repo>/.claude/worktrees/x`.

  Folders and words are read as text: quotes dropped, a leading `~`, `$HOME` or `${HOME}` read as the home directory, `$HOME` also read as `~` wherever it stands in the command (so a home whose own path holds a blank still reads as one word), paths normalised, compared in any letter case. The guarded folders are `~/.codex` and an absolute `CODEX_HOME`; `~/.claude` and an absolute `CLAUDE_CONFIG_DIR`; OpenCode's data folder, `~/.local/share/opencode`, and `$XDG_DATA_HOME/opencode` when `XDG_DATA_HOME` is absolute; and `~/.dethernety`. A folder that reads as the root, or a relative home, is not taken as guarded.

  Other commands run. This mode is strict: read and search are already refused, and it also refuses harmless commands that touch a guarded folder, such as `ls ~/.claude/agents`. Reinstalling restores the full guard. As with Codex's fallback, nothing is opened and no link is followed, and three cases are not covered: a name the shell builds (`$'…'` quoting, or a variable or command output that makes up part of a name), a command that finds and reads files by pattern, such as `find ~ -name … -exec cat`, and an interpreter that builds a path. The generator writes `secret-fallback.mjs` into the plugin in place of its import, so the installed plugin is still one file that imports only Node built-ins. `glob` and `list` read names only and are not guarded; a tool the plugin does not know is refused when its arguments reach for the server's folder from outside the project.

  OpenCode's own text-only tools (`task`, `todowrite`, `question`, `plan_exit`, `invalid`), in their exact argument shape, are not judged by the unknown-tool check of the server's folder: a delegation's subagent sends every call through this hook again. A tool of one of those names in another shape is judged as a tool the plugin does not know, and so are `skill`, `lsp`, `webfetch`, `websearch`, the MCP resource tools, every MCP server's tools and any custom tool. But OpenCode reads each file a delegation's prompt names with `@` itself, when the subagent starts, past this hook and its permission rules; so each mention is judged as a `read` of the same path would be, whatever else the call holds. A mention is resolved as OpenCode resolves it (`~/` from the home, anything else from the project's root) and judged as written and at its real path. In a project that is no git checkout, OpenCode resolves mentions from `/`, so a relative mention there is normally refused as outside the project. It is refused in a harness's home, OpenCode's data folder or the server's folder (or such a folder within the project), outside the project (where a read would ask first, and a mention is read without asking), or when spelled with `%`, `\`, `#` or `?`; then the secret guard judges it, and a guard that cannot be started refuses it. A delegation that mentions more than 32 files is refused unchecked. The prose around the mentions is never judged, so a prompt may name a module or the product beside a path. A mention is judged when the call is made and read by OpenCode later, so a file changed between the two is not seen.
- **`tool.execute.after`** — after a file write, `post-write`'s hint is appended to the tool's output.
- **`experimental.session.compacting`** — `session-start --source compact` adds the workspace state to the compaction context, with an instruction to the summariser to keep it verbatim.
- **`config`** — when OpenCode builds its configuration, the plugin sets the `ask` rules for the 14 tools that need the operator, and the denies on `~/.dethernety`, again, last, over any later layer; it also denies the Dethereal tools to OpenCode's built-in `explore` agent.

There is no session orientation at startup and no approve hook on OpenCode: the 16 auto tools run without asking because only the other 14 have `ask` rules.

### Hooks NOT Included

- **Auto-sync after edits** -- Too aggressive. Sync should be an explicit user action.
- **Pre-commit validation** -- Conflicts with the project's existing commit discipline in CLAUDE.md.

---

## 7. Settings and Configuration

### Default Agent

The plugin sets no default agent (D64) and ships no `settings.json`. Users invoke threat modeling via skills (`/dethereal:threat-model`, `/dethereal:discover`, etc.) or by explicitly selecting an agent (`@agent-dethereal:threat-modeler`). Run the skills from a regular session, not one started as the threat-modeler (`claude --agent` or the `agent` setting): they need tools that ask for the operator's approval, which the agent does not hold. This keeps non-threat-modeling conversations in the same project clean — no modeling guidelines loaded into context for unrelated work. A session started as the threat-modeler still reaches the specialists: the agent hands a scan, classification proposals, enrichment and a review to them itself (see [`threat-modeler`](#threat-modeler----primary-modeling-agent)).

### User Configuration

The manifest declares one user config value, `platform_url` (default `http://127.0.0.1:3000`). The MCP server receives it as `DETHERNETY_PLATFORM_URL` and hooks as `CLAUDE_PLUGIN_OPTION_PLATFORM_URL`; a `DETHERNETY_URL` exported in the shell takes precedence over both.

### Authentication

Authentication works through the existing mechanism:

1. **Platform URL** from the `platform_url` user config, or `DETHERNETY_URL` in the shell (see §User Configuration)
2. **OAuth PKCE flow** triggered by `login` MCP tool (opens browser)
3. **Tokens cached** at `~/.dethernety/tokens.json` (mode 0600), read by the MCP server only
4. **Auto-refresh** handled internally by the MCP server
5. **Session checks** through the `auth_status` tool — skills never read the token store
6. **Auth-disabled mode** supported for no-auth deployments

### Persistent Plugin Data

> **Not implemented.** `${CLAUDE_PLUGIN_DATA}` is not read anywhere in the MCP server, and none of the three caches below exist on disk. The one cache that shipped is per-model rather than plugin-global: `<model-path>/.dethereal/class-cache/<classId>.json`, written by `generate_attribute_stubs` with a 7-day advisory staleness threshold ([TEMPLATE_STUB_GENERATION.md §Class Cache](TEMPLATE_STUB_GENERATION.md#class-cache)). Auth tokens are the only plugin-global state, and they live at `~/.dethernety/tokens.json` (see §Authentication above). The list below is the original design intent, retained as the shape a future implementation would take.

Would use `${CLAUDE_PLUGIN_DATA}` for:
- Class definition cache (TTL: 24 hours)
- MITRE tactic name cache (for conversational reference, not model data)
- User profile (session count, expertise signals for UX adaptation)

---

## 8. Multi-Module Selection

### Problem

The platform supports multiple modules: the baseline `dethernety-general`, specialized modules (for example Kubernetes, AWS, Azure or databases) and custom modules. Each module provides classes with attribute templates (JSON Schema, 30-100 fields per class). Without module scoping, `get_classes()` returns all classes from all installed modules — hundreds of classes to search through, most irrelevant for any given model.

### Design

Module selection happens **post-discovery, before classification**. Discovery output (`discovery.json`) contains IaC source patterns that deterministically map to relevant modules. The agent recommends modules based on these patterns, the user confirms.

**Scope storage:** `activeModules` field in `.dethereal/scope.json`:
```json
"activeModules": [
  { "id": "module-uuid", "name": "dethernety-general" },
  { "id": "module-uuid", "name": "Kubernetes" }
]
```

**Baseline module:** The `dethernety-general` module — the platform's technology-agnostic baseline — is always included and non-removable. Identified by name match: `dethernety-general`.

**Source-type → module mapping** (maintained in infrastructure-scout agent):

| Discovery Source Pattern | Recommended Module |
|--------------------------|-------------------|
| `terraform` with `aws_*` resources | AWS |
| `terraform` with `azurerm_*` resources | Azure |
| `terraform` with `google_*` resources | GCP |
| `kubernetes`, `helm` charts | Kubernetes |
| `database` (SQL, ORM) | Databases |

### Classification Precedence

When multiple modules offer a matching class:
1. **The stronger match wins** — an `exact_name` match is accepted; `fuzzy_name`, `vector_similarity` and `type_match` candidates are listed for the operator to confirm.
2. **Specialized over baseline** — at the guided Step 3, a specialized module's class is preferred to the baseline module's (`dethernety-general`) when both match: its attribute schema is more targeted.
3. **`activeModules` order** — between same-confidence matches from different modules, the Classification Protocol prefers the module listed earlier in `activeModules`.
4. **Inactive modules** — never a proposed class; a match there becomes the module question (see Fallback Broadening)

### Fallback Broadening

When no class in the active modules fits an element, or the classification gate finds elements still unclassified, the plugin searches all installed modules for them. A match found only in an inactive module is never a row of the classification confirm table. It goes on a separate **other-module list**: element, current class (if any), module, class. The list also holds IaC pre-classifications and reclassification candidates from inactive modules, including those of elements that are already classified.

The workflow turns the list into one module question, `classify-add-module` (`add` / `skip`), asked once per run:

- **`add`** — the module ids are looked up (`get_classes`, `view: 'modules'`), `activeModules` is written first, then the listed elements are classified again. Their new rows (a class, or a change from the current class) go through the same confirm question, for those rows only. Rows confirmed earlier are kept.
- **`skip`** — the elements keep their classes or stay unclassified, with the gap on record.

Only the operator's `add` changes `activeModules` during classification. Confirming the classification table never adds a module. With `activeModules` absent, every installed module is active and the list stays empty. The guided workflow's data item classification (Step 7) applies the same rule to `DATA` classes.

### Late Module Addition

When a module is added to `activeModules` after initial classification (the module question's `add`; during classification, no other answer adds a module):
- Existing elements are NOT auto-reclassified
- Elements with baseline-module classes that have a more specific equivalent in the new module are flagged as reclassification candidates
- User confirms before reclassification proceeds (`reclassify-late-module`: `reclassify` / `skip`)
- `generate_attribute_stubs` handles the reclassification (unenriched old fields removed, new class fields added)

### Backward Compatibility

If `activeModules` is absent from `scope.json`, classification searches all installed modules — identical to pre-module-selection behavior. No existing models break.

### Manifest Modules

`manifest.json`'s `modules` is derived by the MCP server, never written by the workflow. The server derives it from the entries already listed there, the scope's `activeModules`, and the modules of the classes the model uses. It derives the list in memory for the quality gates, and a push writes it to the file. A new model starts with `modules: []`. The workflow never asks the operator for module references. After module selection it shows the derived list once. `model_state` `get` returns `manifest_modules: { on_disk, derived }` only when `manifest.json`'s list differs from the derived one, and the workflow shows `manifest_modules.derived`. When `manifest_modules` is absent, the manifest already holds the derived list, and the workflow shows `manifest.json`'s `modules`; the absence never means the model has no modules. A Gate 2 module gap is fixed by the remedy the gate reports, never by editing `manifest.json`. For an unknown module, that remedy is to run `generate_attribute_stubs` with platform access for the listed elements.

### Module Selection Integration

The `match_classes` MCP tool is the batch classification entry point. It takes up to 100 elements (`name`, optional `type` and `description`), a `classLabel` (`COMPONENT`, `SECURITY_BOUNDARY`, `DATA_FLOW`, `DATA` or `CONTROL`), an optional `componentType` (`PROCESS`, `STORE`, `EXTERNAL_ENTITY` — the only hard type filter; an element's `type` only ranks), optional `moduleIds`, `topN` (1–10, default 3) and optional `fields`. It returns ranked candidates per element, each with its `moduleName`, a `confidence` and a `matchType` — `exact_name`, `fuzzy_name`, `vector_similarity` or `type_match`:

1. **scope.json → classification:** `activeModules` IDs from `scope.json` flow into `match_classes` as `moduleIds`. This scopes the search to modules the user confirmed during the module selection step.
2. **Fallback broadening:** If no matches are found within active modules, the classify skill broadens the search by calling `match_classes` without `moduleIds` (all installed modules). The `moduleName` on each candidate names its module; a candidate from an inactive module goes on the other-module list, never into the proposals.
3. **Late module addition:** If the user adds a module after classification (by answering `add` to the module question), existing classifications are preserved. The listed elements are classified again against the updated module set, and already-classified elements with a more specific class in the new module are offered for reclassification.

### Control Integration Architecture

Control assignment is a separate enrichment sub-workflow invoked via `/dethereal:enrich --focus controls`. It runs as a new `Agent(security-enricher)` instance with its own turn limit: 40 turns on Claude Code (`maxTurns: 40`) and 40 steps on OpenCode (`steps: 40`); the plugin sets none on Codex.

**Three-layer ranking architecture:**
1. **Platform candidates** — `controlCandidatesForType` backend query returns controls whose `ControlClass.supportedTypes` include the target element types, with countermeasure counts and D3FEND technique links
2. **Local context scoring** — the `query_controls(action: 'rank')` MCP tool counts, per candidate, its compatible and incompatible classes that have countermeasures configured, keeps its assigned elements, and computes a deterministic score: `score = compatible_configured / total - incompatible_configured / total`
3. **Relevance labels** — strong (>= 0.8, zero incompatible), good (>= 0.5), weak (< 0.5)

**Two-tier quality scoring:**
- *Inferred* (offline): percentage of classified components with at least one positive security attribute (encryption, authentication, monitoring) per the mapping table in CONTROL_INTEGRATION.md §10
- *Formal* (post-sync): percentage of classified components with `controls[]` entries (directly or boundary-inherited). The quality score uses the maximum of the two tiers per element.

**Control pass 3-step sequence:** enforcement controls (Category 2, per-boundary) → detection controls (Category 3, one global prompt pre-populated from `monitoring_tools`) → governance placeholder (Category 4, free-text to `scope.json`).

---

## 9. Architecture Decision: MCP vs Skills for Documentation (D47)

### Context

The current MCP server has `get_model_schema` (15KB of schema + guidelines) and `get_example_models` (examples for 5 architecture types). These serve as documentation/reference for the LLM.

### Decision: Hybrid Approach

**Keep MCP tools** for protocol compatibility and external clients. **Additionally embed guidelines in agent and skill prompts** — the generator includes them from `workflow/shared/` — for zero-tool-call access.

| Content Type | MCP Tool | Skill/Agent Context |
|-------------|----------|-------------------|
| Core guidelines (component types, structure, boundaries) | `get_model_schema` | `guidelines-core.md` inlined into the `threat-modeler` and `infrastructure-scout` agents; a file beside the editing skills |
| File format reference | `get_model_schema` | `guidelines-schema.md` inlined into the `threat-modeler` and `security-enricher` agents; a file beside the editing skills |
| Layout guidelines (coordinate system, handle rules, pixels) | `get_model_schema` | `guidelines-layout.md`, a file beside the editing skills only |
| Example templates | `get_example_models` | `guidelines-examples.md` (a worked example), a file beside `/dethereal:create` and in the build phase of `/dethereal:threat-model`; agents and the guided workflow never call `get_example_models` |
| Available classes (dynamic, varies by instance) | `get_classes` | MCP tool call only (dynamic data) |

**Implementation (D47: Guidelines Splitting):**
1. Guidelines were extracted from `get-schema.tool.ts` into separate files, now under `workflow/shared/`: `guidelines-core.md` (component types, model structure rules, boundary hierarchy constraints), `guidelines-layout.md` (coordinate system, handle rules, pixel dimensions), and since then `guidelines-schema.md` (file formats) and `guidelines-examples.md` (a worked example)
2. The generator inlines `guidelines-core.md` into the `threat-modeler` agent — always loaded when the agent runs
3. Editing skills (`create`, `add`, `discover`, `threat-model`) carry the guidelines as files beside their `SKILL.md` (`as-file` includes), read only when needed
4. MCP tools remain for backward compatibility and external MCP clients
5. Agent prompts include: "Do not call `get_model_schema` — guidelines are already loaded in your context"
6. Static content = agent context; dynamic content = MCP tool call

