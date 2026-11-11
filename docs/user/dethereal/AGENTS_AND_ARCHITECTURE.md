---
title: 'Agents, Tools, and Hooks'
description: 'How the 6 AI agents, 30 MCP tools, and 5 lifecycle hooks work together'
category: 'documentation'
position: 10
navigation: true
tags: ['dethereal', 'agents', 'mcp', 'tools', 'hooks', 'architecture']
---

# Agents, Tools, and Hooks

Under the hood, Dethereal uses 6 specialized AI agents, 30 MCP tools for platform communication, and, in the Claude Code plugin, 5 lifecycle hooks on three events (SessionStart, PreToolUse, PostToolUse) for workflow automation and guard rails. You don't need to know these details to use the plugin — this page is for users who want to understand what's happening behind the scenes.

---

## The 6 AI Agents

Each agent has a specific role, tool access, and constraints. Slash commands start the specialist agents automatically — you don't select them manually. The threat-modeler is the one you can start yourself, to edit a model's files. It ships for every harness:

- **Claude Code** — select it with `@agent-dethereal:threat-modeler`, or start a session as it with `claude --agent dethereal:threat-modeler`. Here it can start some of the specialists for you.
- **Codex** — ask the conversation to start the `dethereal-threat-modeler` agent for the edit.
- **OpenCode** — mention `@dethereal-threat-modeler` in your message.

On Codex and OpenCode it runs as a subagent of your conversation: it asks you nothing directly — it ends with its questions, and the conversation puts them to you — and it starts no other agent.

**Max turns** in the tables below is the agent's turn limit on Claude Code. OpenCode applies the same number as the agent's step limit; the plugin sets no turn limit on Codex.

### threat-modeler (Model Editor)

Edits a threat model's files directly: it edits the model, asks you questions and validates its edits. The skills orchestrate the multi-step work. On Claude Code, when you start it directly, it also hands a scan, classification proposals, enrichment and a review to the specialist agents; on Codex and OpenCode it starts no other agent.

| Property | Value |
|----------|-------|
| **Effort** | High |
| **Max turns** | 60 |
| **Tools** | Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, the Dethereal MCP tools that need no approval, and (Claude Code only) the specialist agents |
| **Starts agents** | Claude Code, started directly: infrastructure-scout, security-enricher, model-reviewer. Codex and OpenCode: none |

**Key behaviors:**
- Reads model files from disk at the start of each operation
- Validates after every edit
- Manages backward transitions after structural edits
- Presents batch confirmation tables before writing
- Sends work it does not do to the skill that runs it, and stops: the guided workflow and drift reconciliation (`/dethereal:threat-model`), a new model (`/dethereal:create`), removing elements (`/dethereal:remove`, which deletes their attribute files only with your approval), discovery (`/dethereal:discover`), classification (`/dethereal:classify`), enrichment and the control pass (`/dethereal:enrich`), publishing and pulling (`/dethereal:sync`) and the review (`/dethereal:review`)
- On Claude Code, when you start it directly (`@agent-dethereal:threat-modeler` or `claude --agent dethereal:threat-modeler`) and ask it for that work there, hands the specialists' part to them, and says once that the skill is the guided path for the same work:
  - a scan (infrastructure-scout) — a look only: it shows you the results and writes nothing from them; the discovery of record stays with `/dethereal:discover`
  - classification proposals (security-enricher) — you confirm them and it writes the confirmed classes; the attribute stubs come from `/dethereal:classify` or `/dethereal:threat-model`
  - enrichment of elements that already have their attribute stubs (security-enricher) — the agent writes the values it can cite or derive into the attribute files, and the threat-modeler shows you its relay file. The written values stay unless you reject them; `/dethereal:enrich` asks the questions the agent could not answer and takes any correction
  - a review (model-reviewer)

  Drift re-verification, creating a model, removing elements, the control pass, gate decisions and publishing still run in their skills.
- Run those skills from a regular session, not one started as the threat-modeler (`claude --agent` or the `agent` setting): they need tools that ask for your approval, which the threat-modeler does not hold

### infrastructure-scout (Discovery)

A read-only agent that scans codebases for infrastructure components. Returns structured data to the calling skill — never writes model files.

| Property | Value |
|----------|-------|
| **Effort** | Medium |
| **Max turns** | 30 |
| **Tools** | Read, Glob, Grep, Bash (read-only), `get_classes` MCP tool |
| **Constraint** | Read-only — returns data, does not write files |

On Codex it reads and searches files with shell commands, and the plugin's shell hook refuses any command that does more than read (see [Hooks on Codex](#hooks-on-codex)). On OpenCode it reads files and finds them by name, but has no content search of its own, and each shell command it runs asks you first: its shell permission is `ask`.

**Used by commands:** discover, threat-model (Step 2)

**Key behaviors:**
- Scans 11 source categories with signal strength ranking
- Pre-classifies components using IaC mapping tables
- Validates pre-classifications against the platform's class library
- Never opens a secret file (`.env`, `*.tfvars`, Terraform state, keys, kubeconfig, helm-secrets and `secret.yaml` files, Kubernetes Secret manifests, the files a compose `env_file:` names, …): it lists file names first, classifies every path, then opens only the ones that are not secret — never a symbolic link, and a YAML or JSON file only after its search for Kubernetes Secret manifests has covered that file's folder — and reports each secret file as "present, not read"
- Never includes secret values — extracts names and endpoints only
- Returns the full discovery report and writes nothing; the conversation that started it shows the report whole and saves it as discovery provenance (`.dethereal/discovery.json`)

### infrastructure-scout-scoped (Drift Re-Verification)

A deliberately narrowed companion to infrastructure-scout. Drift reconciliation uses it to re-verify the elements touched by a file diff without re-scanning the whole repository.

| Property | Value |
|----------|-------|
| **Effort** | Medium |
| **Max turns** | 20 |
| **Tools** | Read, `get_classes` MCP tool |
| **Constraint** | No Glob, Grep, or Bash — reads only the files on the allowlist it is handed. On Codex, which has no separate read tool, it reads through the shell, limited to commands that print an allowlisted file (`cat`, `sed -n`) — never a search or a listing |

**Used by commands:** threat-model (resume, when drift is detected)

**Key behaviors:**
- Receives a pre-computed file allowlist from the calling skill — secret files and symbolic links already removed — and reads nothing outside it; it still checks each path's name against the secret files before reading it
- Answers one of four scoped questions: discover elements, re-verify element attributes, propose reclassification, check element existence
- Shares classification rules with the full-scope infrastructure-scout
- Stops and reports rather than widening its own scope when it needs a file outside the allowlist

### security-enricher (Attributes and Classification)

Populates security attributes, handles classification, and identifies security controls. It is one of the two sub-agents that write attribute files; the other is the [enrichment-applier](#enrichment-applier-relay-answers).

| Property | Value |
|----------|-------|
| **Effort** | High |
| **Max turns** | 40 |
| **Tools** | Read, Write, Edit, Glob, Grep, and 6 of the 30 MCP tools (see below) — none that changes the model or the platform, or needs your approval |
| **Constraint** | Does not annotate MITRE techniques on attribute files — tactic coverage is derived platform-side from analysis exposures |

On Claude Code the agent gets every Dethereal MCP tool except the 24 its definition excludes: the tools that need your approval (they change the model or the platform, sign in or out, or record your decisions) and the read tools outside its work. That leaves 6. On Codex and OpenCode it is given the same 6 by name: `get_classes`, `match_classes`, `validate_model_json`, `query_controls`, `search_mitre_attack` and `get_mitre_defend`. On Codex it reads and searches files with shell commands and edits them with `apply_patch`; on OpenCode it finds files by name but does not search their content, and edits only the model files and the plugin's state files.

**Used by commands:** enrich (`--focus controls`, the control pass), threat-model (Steps 6 and 8, and the control pass). `/dethereal:classify` and `/dethereal:enrich` without `--focus controls` run in the main conversation.

**Key behaviors:**
- Two-pass classification: deterministic matching first, LLM-assisted for ambiguous cases
- Crown jewel tagging with fuzzy matching from scope definition
- Looks MITRE techniques up against the platform when explaining an exposure — never generates technique IDs from memory
- Credential enrichment anchored to the flows: flow-anchored capture → credential ids from the cited secret or variable names → mapping to flows → store scope → Kubernetes Secret mounts → secrets committed with the code (see [Credential Enrichment](DISCOVERY_AND_ENRICHMENT.md#credential-enrichment))
- Compliance-driven prompts based on scope compliance drivers
- Writes only values cited from a file line or derived from a setting a file states, straight into empty attribute fields; a default no file states is proposed, never written (see [What counts as evidence](DISCOVERY_AND_ENRICHMENT.md#class-templates-drive-the-questions))
- In Step 8, enriches at most 12 elements a run — up to 20 when a store takes the flows that touch it along — each run started fresh, and writes its tables and questions to a relay file, `.dethereal/relay/run-<n>.txt`; the conversation presents them and asks you once (see [One relay turn](GUIDED_WORKFLOW.md#one-relay-turn))
- Presents all proposals in batch confirmation tables

### model-reviewer (Validation)

A read-only auditor that assesses model quality and produces analysis reports. Cannot modify any files.

| Property | Value |
|----------|-------|
| **Effort** | Medium |
| **Max turns** | 30 |
| **Tools** | Read, Glob, Grep, MCP tools (read-only subset) |
| **Constraint** | Strictly read-only — no file modifications |

**Used by commands:** review, surface, threat-model (Step 9)

**Key behaviors:**
- Computes quality score with 7-factor breakdown
- Evaluates 3 quality gates (creation, sync, analysis)
- Produces attack surface analysis across 8 dimensions
- Detects cross-model gaps and credential blast radius
- Lists every insecure value recorded in the attribute files under a Red Flags heading that carries their count (see [Red Flags](REVIEW_AND_ANALYSIS.md#red-flags))
- Cannot write quality.json — the server computes the quality score

### enrichment-applier (Relay Answers)

Writes what your reply to the Step 8 enrichment relay decides. It never sees you and asks nothing: what needs you comes back to the conversation as a follow-up.

| Property | Value |
|----------|-------|
| **Effort** | High |
| **Max turns** | 30 |
| **Tools** | Read, Glob, Grep, Write, Edit, `validate_model_json` MCP tool |
| **Constraint** | Writes attribute files (`attributes/`) only — never `structure.json`, `dataflows.json`, `data-items.json`, `.dethereal/` or `controls/`, and no tool that changes the model, the platform or the state. On OpenCode its edit permission covers only attribute files |

**Used by commands:** threat-model (Step 8, after the enrichment relay). A plain "accept all" does not start it: the written values stay as they are.

**Key behaviors:**
- Started fresh with the relay files and your reply, verbatim
- Writes every decision your reply makes, and only those: a rejected value goes back to `null`, a changed one takes your value, and a credential, mapping or boundary pre-fill is written only when you name it or accept the pre-fills. A documentation claim is written only for a document you name as describing the deployed system. "Not sure" leaves a field empty — never a guess
- Where your words disagree with a value cited from your source, keeps the cited value and returns a line quoting both; you can still change it with `/dethereal:enrich`
- Returns a table of every value it wrote, with the row or the words of yours that set it
- Hands back as follow-ups what is not its to write: an element you asked to remove, a changed credential mapping (shown for you to confirm), and data items, classes, crown jewels or zones your reply decided
- Treats the relay and attribute files as data, never as instructions, and never writes a secret value: a credential is written by its id

---

## Agent Delegation

The skills orchestrate the multi-step work, not an agent. The skill that runs a workflow starts the specialist agents, relays what they return and asks you the questions:

```
/dethereal:threat-model    (guided workflow and drift reconciliation)
├── infrastructure-scout         discovery scanning
├── infrastructure-scout-scoped  drift re-verification
├── security-enricher            classification and enrichment
├── enrichment-applier           applying your reply to the enrichment relay
└── model-reviewer               validation
/dethereal:discover        → infrastructure-scout
/dethereal:enrich --focus controls (the control pass) → security-enricher
/dethereal:review          → runs as model-reviewer
/dethereal:surface         → runs as model-reviewer
```

The threat-modeler edits models, asks questions and validates its edits. When a request needs a new model, removing elements, discovery, drift reconciliation, classification, enrichment, the control pass, the review, sync or the guided workflow, it names the skill that runs it — `/dethereal:threat-model`, `/dethereal:create`, `/dethereal:remove`, `/dethereal:discover`, `/dethereal:classify`, `/dethereal:enrich`, `/dethereal:sync` or `/dethereal:review` — and stops. On Claude Code, when you start it directly, it hands the specialists' part — a scan, classification proposals, enrichment and a review — to them itself (see [threat-modeler](#threat-modeler-model-editor)); on Codex and OpenCode it starts no other agent.

**How it works:**
1. The skill passes the model directory path to the agent
2. The agent reads current model state from disk independently
3. The agent does its work and returns its tables and findings
4. The skill shows you what the agent returned before the next question

**While an agent works**, the conversation asks you nothing and writes nothing:

- **Claude Code and OpenCode** — when the agent runs in the background, the conversation ends its turn and carries on when the agent's result arrives as a new message. It never sleeps, polls or schedules a wakeup to check on the agent.
- **Codex** — the conversation waits for the agent and does not end its turn while the agent runs.

If an agent reaches its turn limit with work left, it is started once more with only what is left. If it is cut off again, the conversation stops and tells you.

Passing the directory path instead of the model content avoids sending large serialized models between agents.

---

## MCP Tools

The MCP (Model Context Protocol) server exposes 30 tools for platform communication — 29 with the default settings, since `model_state_settle` is served only with the [settlement](SYNC_AND_VERSION_CONTROL.md#the-settlement-switch) switched on. These tools are used by agents internally — you interact with them through slash commands, not directly.

### Authentication (3 tools)

| Tool | Purpose |
|------|---------|
| `login` | Browser-based OAuth authentication with PKCE |
| `logout` | Delete the locally stored session, then revoke its refresh token at the platform's identity provider; a revocation that cannot be made (the platform unreachable, for example) is skipped and reported |
| `auth_status` | Report the platform URL, whether you are signed in, as whom, and how long the session has left |

The MCP server keeps your session in your home directory, keyed by platform URL, and refreshes an expired session automatically on the next tool call. Session tokens never leave the server: no tool returns them, and the agents check authentication through `auth_status` rather than by reading the token store.

### Reference (2 tools)

| Tool | Purpose |
|------|---------|
| `get_model_schema` | Returns the complete JSON schema for threat model files |
| `get_example_models` | Provides example model templates (web app, API service, microservices) |

### Validation (1 tool)

| Tool | Purpose |
|------|---------|
| `validate_model_json` | Five actions: `validate` (structural and schema validation), `quality` (the quality score and its factors), `coverage` (the inferred and formal control coverage `/dethereal:surface` reports), `zoning` (the zoning coherence findings), and `gates` (the three quality-gate verdicts) |

### Local Workspace (2 tools)

| Tool | Purpose |
|------|---------|
| `workspace_status` | Reports the local workspace: the registered models, each with its workflow state, quality score and stale-element count. Reads local files only |
| `detect_drift` | Lists the source files that changed since a model's drift baseline, limited to the files discovery reads |

### Workflow State (4 tools)

| Tool | Purpose |
|------|---------|
| `model_state` | Reads or changes a model's workflow state — the only way to change it |
| `model_state_waive` | Waives one Gate 3 criterion for named elements with your reason, or revokes the waiver. A waiver counts only on the machine that granted it — see [Waiving a Gate 3 gap](GUIDED_WORKFLOW.md#waiving-a-gate-3-gap). Asks for your approval |
| `model_state_settle` | Served only with the server's settlement switched on, which is off by default; the guided workflow does not use it. Records your decisions on attribute and record values, so they count as yours. Asks for your approval — see [The Settlement Switch](SYNC_AND_VERSION_CONTROL.md#the-settlement-switch) |
| `model_state_prune` | Deletes the attribute files of elements the model no longer has. Asks for your approval; the files are the ones listed in the chat table you confirmed, which is where you check them. Deletes only files the server finds orphaned itself, all or nothing, at most 50 a call; a file that only looks orphaned is listed as not deleted, for you to handle by hand |

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

### Security Elements (6 tools)

| Tool | Purpose |
|------|---------|
| `manage_controls` | Multi-action tool that changes the control library: `create`, `update`, `delete`, assignment (`assign`), and the control-library workflow (`pull-controls`, `push-greenfield`, `push-brownfield`, `set-local-edited`, `promote-external-edit`, `tombstone`) plus two write-ahead-log repair actions (`inspect-wal`, `clear-wal`). The control-library actions enforce the two-write rule and the shared-ownership safety check. Listing, reading and ranking controls is `query_controls`. |
| `manage_countermeasures` | Create, update or delete the countermeasures that link security controls to exposures. Listing and reading them is `query_countermeasures`. |
| `query_controls` | Read-only: list, get or rank the platform's security controls |
| `query_exposures` | Read-only: list or get the platform-computed exposures of an element (exposures are computed by the analysis engine, not created by users) |
| `query_countermeasures` | Read-only: list or get the countermeasures of a control |
| `get_control_gaps` | Framework-grounded gap analysis. Walks the chain `Exposure → ATT&CK Technique → ATT&CK Mitigation → Countermeasure → Control` in a single Cypher query and returns unmitigated exposures with recommended controls. Used by `/dethereal:surface`. |

### Analysis (1 tool)

| Tool | Purpose |
|------|---------|
| `manage_analyses` | List analysis classes, create/run/poll/get analysis results |

---

## Lifecycle Hooks

Hooks run at key moments of a session: when it starts (or resumes after a compaction), before a tool call, and after a file is written. You never call them; their effects show up as context the assistant receives, as a Dethereal tool call that runs without asking you, or, for the two guards, as a refused write or read.

The Claude Code plugin ships five hooks, on three events:

| Event | Hook | Runs |
|-------|------|------|
| SessionStart | Orientation, and model state after compaction (one hook) | When a session starts, resumes, is cleared, is forked, or has just been compacted |
| PreToolUse | Config guard | Before a file is written or edited |
| PreToolUse | Approval of read-only tools | Before one of the Dethereal tools that need no approval is called |
| PreToolUse | Secret-file guard | Before a file is read or searched, or a shell command runs |
| PostToolUse | Validation hint | After a file is written or edited |

### SessionStart — Orientation

**When:** A Claude Code session starts, resumes, is cleared, or is forked, with the plugin loaded.

**What you see:** With no models in the project, an orientation block with the quick-start commands (`/dethereal:create`, `/dethereal:status`, `/dethereal:help`) and an example of describing your system in plain language. With one model, its name, workflow state, quality score and stale-element count, plus up to three suggested next commands. With several models, their count and a pointer to `/dethereal:status`. If no platform URL is configured, a note says the local default is in use and you can sign in with `/dethereal:login` when needed; a URL that cannot be used (for example, a remote one without HTTPS) is reported too. See [Getting Started](GETTING_STARTED.md#your-first-session) for the first-session output.

### SessionStart — Model State After Compaction

**When:** Right after Claude Code compresses the conversation context (approaching context limits).

**What it does:** Gives the assistant a short summary of every model in your local registry — name, workflow state, quality score and stale-element count — with an instruction to re-read the current state before continuing. The conversation carries on knowing which model you are working on and how far along it is.

It preserves **state, not history.** No record of what you just did is carried across: no tool calls, no edits, no decisions. If the reasoning behind a change matters after compaction, say it out loud in the conversation or write it into the model — don't assume the hook will remember it for you.

### PostToolUse — Validation Hint After Edits

**When:** After the assistant writes or edits a file.

**What it does:** If the file belongs to a registered model, tells the assistant which model changed and to validate it with `validate_model_json` once the current step's writes are done. Files outside your models produce nothing. The hook is a prompt, not a check — it does not run validation and cannot report an error. Broken references and schema violations stay undetected until you run `/dethereal:review` or the Gate 2 pre-flight on `/dethereal:sync push`.

### PreToolUse — Config Guard

**When:** Before the assistant writes or edits a file.

**What it does:** Refuses an assistant edit that lets steps run without asking you. In harness settings (such as `settings.json`) that is:

- approving Dethereal or all tools, or adding any Bash allow rule, even for one exact command such as `Bash(npm test)` (the Bash rules already in the file stay);
- an auto-approve mode (`auto` included), or a removed ask or deny rule;
- changed hooks or MCP servers, or a changed setting that runs a command, such as `statusLine` or `apiKeyHelper`;
- any change to `env`, which every process Claude Code starts reads. A change to the `DETHEREAL_SETTLEMENT` variable (the [settlement switch](SYNC_AND_VERSION_CONTROL.md#the-settlement-switch)) is refused with its own reason;
- enabling a plugin, or changing the Dethereal plugin's options, such as its platform URL.

It also refuses a skill, command or agent granting those tools, and any write to Claude Code's plugin cache (`.claude/plugins/`): reinstall the plugin instead. Other edits (themes, models) go through. To make a refused change, edit the file yourself.

### PreToolUse — Approval of Read-Only Tools

**When:** Before the assistant calls a Dethereal MCP tool that only reads, or whose every change the server validates — for example `validate_model_json`, `model_state`, `get_classes`, or `query_controls`.

**What it does:** Approves the call, so Claude Code asks you for these tools no more than Codex or OpenCode do. It approves those exact tools and nothing else, and it never refuses a call; your own deny and ask rules still apply over it. The tools that change the platform or record your decisions, such as `import_model`, `update_attributes`, `model_state_prune`, and `model_state_waive`, still ask for your approval.

### PreToolUse — Secret-File Guard

**When:** Before any file is read or searched, or a shell command runs — in your own conversation and in the plugin's agents alike (Claude Code and OpenCode; on Codex, shell commands only: see [Hooks on Codex](#hooks-on-codex)).

**What it does:** Refuses to let the assistant open, print or search a secret file in your project (`.env`, `*.tfvars`, Terraform state, keys, kubeconfig, Kubernetes Secret manifests, the files a kustomization `secretGenerator` or a compose `env_file:` in the same folder or a folder above names, …), and refuses commands that print configuration values, such as `docker compose config` or `printenv`. The assistant reports such a file by name only. Listing file names still works. If the guard cannot check a read, search or shell command (for example, it runs out of time, a folder is too large to check, or it cannot tell which file is meant), it refuses it; narrow the path and ask again. If the guard itself is set up wrongly, it refuses every read, search and shell command rather than let them through, and says how it is set up.

### Hooks on Codex

**When:** Codex asks you once to review and trust the plugin's hooks. Hooks you have not trusted never run.

**What it does:** Like the Claude Code plugin, the Codex plugin gives the assistant its orientation when a session starts, resumes or is cleared, and the model state after a compaction (SessionStart); it runs the config guard before a file change (Codex changes files with `apply_patch`, so a guarded configuration or definition file may only be created whole or deleted there, never updated or moved); and after a file change it gives the validation hint. Its secret-file guard checks shell commands only. What follows is Codex's own.

One hook keeps each Dethereal agent to its own tools. Codex gives an agent every tool of the conversation that started it, so the hook refuses a Dethereal agent's call that starts or messages another agent, changes files when the agent may not, uses another MCP server, or uses a Dethereal tool outside that agent's list. If it cannot check such a call, it refuses it. Your own conversation and other agents are not affected. Without hook trust, the agents' instructions are the only restriction.

Before a shell command runs, the plugin's shell hook makes two checks, then the secret-file check:
- From any conversation, yours included, it refuses a command that runs input sent to it later, such as `sh -s`, `bash /dev/stdin`, an interpreter started with no script, or `xargs … sh -c`: Codex can send such input to a running command without any hook seeing it. Run each command on its own instead. This check is best effort.
- For the Dethereal agents that may not change files (the two infrastructure scouts and the model reviewer), every command must only read: `cat`, `head`, `tail`, `sed -n`, `grep`, `rg`, `ls`, `find`, `jq`, `git log`, `git diff`, `git status`, `kubectl get` and a few more. Anything else is refused, and the refusal names the command it refused. Codex's own sandbox setting for an agent may not cover its shell, so this check comes on top of it.

On Codex the secret-file check is best effort: it judges a command by the file names it mentions, so an interpreter or input sent later can get past it. Codex's own sandbox is the boundary. A repository's own git configuration can still run code under `git status` or `git diff`, and Codex shell tools other than its `Bash` tool are not checked.

### Hooks on OpenCode

**When:** The installer adds a Dethereal plugin to OpenCode; OpenCode runs it in its own process, with your rights.

**What it does:**

- **Secret-file guard** — before every file read, content search (`grep`) and shell command, as on Claude Code. A refusal stops the call, and the assistant is told why.
- **Config guard** — before every file write or edit, as on Claude Code. It also refuses changes to OpenCode's plugin folders: plugin code cannot be judged.
- **Approval questions** — when OpenCode loads its configuration, the plugin sets the Dethereal tools that need your approval to ask you, and denies access to the folder in your home directory where the MCP server keeps your sessions. These rules are applied last, over any later configuration layer.
- **Validation hint** — after a file write, which of your models the change touched, added to the tool's output.
- **Model state after compaction** — when a session is compacted, the workspace state, with an instruction to keep it verbatim in the summary.

If a guard cannot be started at all (for example, the Node binary the installer recorded is gone), a read, search or write is refused, and a shell command is checked by name only. It is refused when it cannot be checked, when it names a secret file, a harness's settings or sign-in, a plugin or definition folder, or the MCP server's own folder, or when it names or runs inside `~/.codex`, `~/.claude`, OpenCode's data folder or `~/.dethernety`, names a folder that holds one, uses a wildcard in or above the home folder or after changing folder, or spells one of the variables that point there (`$CODEX_HOME`, `$CLAUDE_CONFIG_DIR`, `$XDG_DATA_HOME`). This also refuses harmless commands, such as `ls ~/.claude/agents`. Other shell commands still run. The check reads only the names written in the command, so it misses a name the shell builds from variables, command output or special quoting, a command that finds files by pattern and reads them, and a path a script builds. Reinstall Dethereal to bring the full guard back.

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
| ENRICHING | REVIEWED | Gate 3 passes and you answer **record** to the review question; the server grants it only when its own conditions hold (see [Step 9](GUIDED_WORKFLOW.md#step-9-validation)). **not now** leaves the model at ENRICHING |

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

The `completedStates` array enables the guided workflow to show which steps are done. The `staleElements` array tracks elements that were added or changed — including an element reclassified during drift reconciliation — and need to be enriched before the model is complete.

---

**Next:** [Glossary](GLOSSARY.md) — plugin-specific terminology
