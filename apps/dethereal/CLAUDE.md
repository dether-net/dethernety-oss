# CLAUDE.md — Dethereal (MCP Server + Claude Code Plugin)

TypeScript MCP server and Claude Code plugin for AI-integrated threat modeling via the Dethernety platform. ESM-only. Architecture docs: `docs/architecture/dethereal/`.

The package is both: the npm package `@dether.net/dethereal` ships the MCP server (`dist/`) and, at its root, the Claude Code plugin that runs it.

## Development

```bash
pnpm dev             # Development mode (MCP server)
pnpm build           # Build
pnpm test            # Vitest (src/**/*.test.ts)
pnpm golden:update   # Regenerate the generator goldens AND the committed Claude plugin at the package root
```

Bin entry: `dethereal`. With no arguments it is the MCP server; `dethereal hook …` and `dethereal workspace-status --json` are the CLI the plugin's hooks run (`src/cli/`). `dethereal install|uninstall --harness <claude,codex,opencode>` is the installer (`src/installer/`): Claude Code gets the plugin through its own `claude plugin` CLI; Codex and OpenCode run the server from a runtime the installer copies to `~/.dethernety/runtime/` and activates once per run. `~/.dethernety/installs.json` records what it did, so uninstall undoes exactly that. Each harness is reported on its own; one that failed is retried alone with the same command and just that `--harness`.

### Workflow source and generated bundles

The skills, agents and hooks are **generated** — never edit them at the package root or under `bundles/`.

- **Source:** `workflow/` — `skills/`, `agents/`, `shared/` (fragments included by skills and agents, and the `prompts.yaml` prompt registry) and `harness/*.yaml` (per-harness settings, such as the Claude manifest fields and `userConfig`).
- **Generator:** `src/generator/` (run with tsx) renders `workflow/` into bundles for Claude Code, Codex and OpenCode.
- **Committed Claude plugin:** `.claude-plugin/plugin.json` and `bundles/claude/**` at the package root. `src/generator/__tests__/package-root.test.ts` keeps them byte-equal to the generator's output.

After editing `workflow/`, run `pnpm golden:update`; `tsx src/generator/cli.ts --package-root` regenerates the package root alone. Both refuse while any of `skills/`, `commands/`, `agents/`, `hooks/`, `.mcp.json` or `settings.json` exists at the package root: Claude Code loads those default paths on top of the manifest, so a root `hooks/hooks.json` would run every hook twice.

**Release discipline:** the plugin's prompts and the MCP server ship together in one npm package, and the plugin runs the server from its own `dist/` — there is no separate server version to pin. The manifest version must equal `package.json`'s (enforced by the package-root test), so a version bump needs `pnpm golden:update` before publishing. The published file list is checked by `src/__tests__/packaging.test.ts` (`npm pack --dry-run`): `files` = `dist`, `.claude-plugin`, `bundles/claude`, `bundles/codex`, `bundles/opencode`, `src/utils/source-globs.v1.json`; the installer copies `dist` and `bundles` into its runtime, where the Codex and OpenCode writers read their bundles. `prepack` regenerates the package root (`--package-root`) before the build, so a packed tarball always carries the plugin at the package's version.

### Plugin Testing

```bash
pnpm build
claude --plugin-dir oss/apps/dethereal    # This checkout's workflow bundle and its local dist/ server, with your real HOME
/reload-plugins                            # Reload after changes (inside session)
```

`--plugin-dir oss/apps/dethereal` loads the committed bundle, so run `pnpm golden:update` after a workflow change, and `pnpm build` after a server change. To keep the server's session store and model registry away from your own, generate a sandboxed plugin root (developer tooling, not published):

```bash
node dev/dev-plugin-root.mjs --out <dir outside the repo> --sandbox-home <dir> [--url <platform>]
claude --plugin-dir <out dir>
```

It generates the Claude bundle from `workflow/` with the MCP server and hooks running `node <checkout>/dist/index.js`, the server with `HOME` set to the sandbox. The bundle is written, not linked — re-run the script after changing the workflow.

### Debugging the server

At startup the server checks whether its Node runtime can be trusted with the session's bearer (`src/utils/runtime-trust.ts`, joined into `configProblem()` in `src/config.ts`). If not, every tool that would reach the platform returns a configuration error naming the variable or option and the fix; `logout` still works (it clears the local session and sends the token nowhere), and `workspace_status` reports `untrusted_runtime`. There is no bypass flag.

- **Refused wherever the file is:** `NODE_TLS_REJECT_UNAUTHORIZED=0`, `SSLKEYLOGFILE` and `--tls-keylog`, `--inspect` / `--inspect-brk` / `--inspect-wait` / `--inspect-port`, and `--require` / `--import` / `--loader` of a `data:` or `http(s):` URL.
- **Refused when the path is in the project or a temporary directory** (`/tmp`, `/var/tmp`, `$TMPDIR`, the OS temp dir, `/dev/shm` — a sandboxed agent may write there): `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE` / `SSL_CERT_DIR`, `OPENSSL_CONF` / `OPENSSL_MODULES` / `OPENSSL_ENGINES` / `--openssl-config`, preloads (`--require` / `-r`, `--import`, `--loader` / `--experimental-loader`, `--env-file*`; a dependency's own file under `node_modules` is accepted), the output directory of heap snapshots and diagnostic reports when one is asked for (the cwd by default), `NODE_COMPILE_CACHE`, `--snapshot-blob`, `LD_PRELOAD` / `DYLD_INSERT_LIBRARIES` entries, and Node itself.

Under an inspector or a TLS key log, platform calls stay refused wherever the server runs; local tools keep working. Attach a debugger only to a sandboxed dev plugin root (`dev/dev-plugin-root.mjs`, above) with a throwaway sign-in on a local platform, never to a process holding a real session. To trace platform calls, set `DEBUG=true` (the server logs to stderr) instead. A corporate CA bundle is fine where it normally lives (under `/etc` or your home directory); if yours is inside the project or a temp directory, move it out and point `NODE_EXTRA_CA_CERTS` at the new place.

## Plugin Structure

```
oss/apps/dethereal/
├── .claude-plugin/plugin.json    # Plugin manifest (generated)
├── bundles/claude/               # Generated Claude bundle (committed)
│   ├── .mcp.json                 # MCP server: node ${CLAUDE_PLUGIN_ROOT}/dist/index.js
│   ├── hooks/hooks.json          # Lifecycle hooks
│   ├── skills/                   # 17 skills (14 slash commands + 3 companions)
│   ├── agents/                   # 6 agents
│   └── bundle.json               # File list and hashes of the generated bundle
├── workflow/                     # Source of skills, agents, shared fragments, harness settings
├── src/                          # MCP server, hook CLI (src/cli/), generator (src/generator/)
├── dev/                          # Developer tooling (not published)
├── scripts/                      # Release tooling (not published)
└── dist/                         # Compiled output (bundles every runtime dependency)
```

The manifest points at `bundles/claude/` for skills, agents, hooks and the MCP server, and declares `userConfig.platform_url`; the server receives it as `DETHERNETY_PLATFORM_URL`, and a `DETHERNETY_URL` exported in the shell still wins. Hooks, which run without the server's env block, get it as `CLAUDE_PLUGIN_OPTION_PLATFORM_URL`.

## Agents

| Agent | Purpose | Effort |
|-------|---------|--------|
| `threat-modeler` | Primary modeling — creates/edits threat models | high |
| `infrastructure-scout` | Read-only codebase discovery | medium |
| `infrastructure-scout-scoped` | Read-only re-verification of a drift allowlist | medium |
| `security-enricher` | MITRE ATT&CK/D3FEND enrichment, security attributes | high |
| `model-reviewer` | Read-only quality auditing and readiness assessment | medium |
| `enrichment-applier` | Applies the operator's reply to the enrichment relay: writes attribute files only | high |

No default agent (D64). Users invoke via skills or `@agent-dethereal:<agent-name>`.

## Skills (Slash Commands)

### Foundation 
| Skill | Description |
|-------|-------------|
| `/dethereal:status` | Connection status, auth state, local model summary |
| `/dethereal:login` | Browser-based OAuth authentication |
| `/dethereal:help` | Context-aware command list with suggestions |
| `/dethereal:view` | Model summary (tree/json/yaml format) |

### Modeling
| Skill | Description |
|-------|-------------|
| `/dethereal:create` | Create or import a new threat model |
| `/dethereal:discover` | Auto-discover infrastructure from codebase |
| `/dethereal:add` | Add components, boundaries, flows incrementally |
| `/dethereal:remove` | Remove elements with dependency checking |

### Classification & Enrichment
| Skill | Description |
|-------|-------------|
| `/dethereal:classify` | Assign classes with two-pass classification and crown jewel tagging |
| `/dethereal:enrich` | Security attributes, MITRE ATT&CK, credentials, monitoring tools |

### Sync
| Skill | Description |
|-------|-------------|
| `/dethereal:sync` | Push/pull model to/from platform, sync status |

### Review & Integration
| Skill | Description |
|-------|-------------|
| `/dethereal:review` | Quality dashboard, structural validation, readiness assessment |
| `/dethereal:surface` | Attack surface summary with control gap analysis |
| `/dethereal:threat-model` | Guided end-to-end threat modeling workflow |

### Companions (not user-invocable)
| Skill | Description |
|-------|-------------|
| `dethereal:enrich-controls` | The control pass of enrich — started by `/dethereal:enrich --focus controls` |
| `dethereal:sync-controls` | The control library of sync — push, promote-external-edit, tombstone, repair-wal |
| `dethereal:sync-pull` | The pull of sync — import a platform model into local files |

## Hooks

Defined in `bundles/claude/hooks/hooks.json`, emitted by the generator's Claude target (`src/generator/targets/claude/`). Every hook runs `node ${CLAUDE_PLUGIN_ROOT}/dist/index.js hook <command> … --harness claude` in exec form (no shell). The two guards (`config-guard`, `secret-guard`) also carry `"onFailure": "block"` (`hooksConfig` in the Claude target): on Claude Code 2.1.295 or later a guard that cannot answer (fails to start, times out, exits with neither 0 nor 2, prints invalid JSON) blocks the call; older versions ignore the key, so there a guard that cannot start, crashes or times out, or runs on a Node older than 14.8, lets the call run. On any version, on a Node from 14.8 up to 20.11.0 the entry stops a guard with exit 2 (a block) and the message `Dethereal needs Node.js 20.11.1 or newer (found <version>), so its <guard> can't check this call and blocks it. Update Node, or turn the Dethereal plugin off with /plugin.`, so every Read, Grep, Bash, Write, Edit, MultiEdit and NotebookEdit call is blocked until Node is updated or the plugin is off; every other command exits 1 with the plain floor message (`src/node-floor.ts`).

| Hook | Event | Command |
|------|-------|---------|
| Session orientation | `SessionStart` (`startup`, `resume`, `clear`; `fork` reports as `resume`) | `session-start --source <source>` |
| Model state after compaction | `SessionStart` (`compact`) | `session-start --source compact` |
| Validation hint after a model-file write | `PostToolUse` (Write\|Edit\|MultiEdit) | `post-write` |
| Config guard | `PreToolUse` (Write\|Edit\|MultiEdit\|NotebookEdit) | `config-guard` |
| Read-only tool approval | `PreToolUse` (the plugin's read-only MCP tools) | `approve` |
| Secret-file guard | `PreToolUse` (Read\|Grep\|Bash) | `secret-guard` |

The compaction reminder is a `SessionStart` hook because a `PreCompact` hook's output never reaches the model. The config guard (`src/cli/config-guard.ts`, `config-content.ts`) diffs an agent edit to harness config (Claude settings / `.claude.json`, Codex `config.toml`, OpenCode `opencode.json(c)`; project, user) and denies only one that widens what runs unasked: Dethereal or wildcard allow, bypass mode, weakened deny/ask, hooks, MCP, trust, plugin off; in Claude settings (every scope) also any new Bash allow (exact commands included; existing rules untouched), the `auto` mode, any `env` change (`DETHEREAL_SETTLEMENT` gets its own refusal), the command-running keys (`statusLine`, `apiKeyHelper`, `otelHeadersHelper`, `awsAuthRefresh`, `awsCredentialExport`, `fileSuggestion`, `sandbox`, `extraKnownMarketplaces`), a plugin newly enabled, and the Dethereal plugin's `pluginConfigs`. Denied outright: Claude Code's plugin cache (`.claude/plugins/**`, `$CLAUDE_CONFIG_DIR/plugins/**`), OpenCode plugin dirs, and definitions granting a Dethereal tool or wildcard. Fails closed only on a guarded path it cannot judge. Not covered: shell-written config, other plugins' MCP write tools. The secret-file guard (`src/cli/secret-guard.ts`; names from `src/utils/secret-paths.ts`, shared with OpenCode's read rules) denies a Read or Grep of a project secret file (a listed name in any case, a `kind: Secret` manifest, or a file a kustomization `secretGenerator` or compose `env_file` / top-level `secrets: … file:` in its folder chain names as a secret source), a content/count Grep over a folder holding one, and a Bash command naming one (braces, globs in any segment, `cd`/`pushd` followed), printing config values or content-searching such a folder (`grep -r`, `rg`, `ug`, `git grep`, `find` running a reader via `-exec`/`-ok` or `xargs`, or a folder named in a line where `xargs` runs a reader, `xargs`'s `{}` judged as `*`). The workflow's name-only searches are recognised as written, and as agents commonly write them (bare safe paths, continued lines, an echo before); a near miss is denied with what differs. Glob is not matched; on Claude Code 2.1.286 only the plugin's agents have Grep, so the Grep checks apply to their calls. Read and Grep fail closed: an event that cannot be read (its tool or file unknown), an unplaceable path, an unscannable file, an internal error or the 6 s deadline deny the call. Bash is denied when it names a secret file, reads a folder holding one in full, or cannot be checked (a glob or folder past the bound or deadline, a file it cannot scan); a fault before any check, or an internal error, denies it only if its text names a secret file; after `cd -` or `popd` the rest is judged by its text. A wrong `--harness` denies every call, naming the wiring (deny on stdout, exit 0; other hooks exit 1). Not covered: a name the shell builds (variables, interpreters, a file of names), an `xargs` fed by a command naming no folder (`ls | xargs cat`), a secret source named only from outside the folder chain. Codex: the plugin's `secret-guard --harness codex` hook on Bash (in `plugins/dethereal/hooks/hooks.json`) goes through the runner `bin/hook.mjs`, which runs the guard in the installed runtime only after `bin/runtime-check.mjs` (the installer's check) passes; when the runtime is tampered, missing or unverifiable, the runner refuses a command that names a secret file or guarded configuration (Codex's config and plugins, Dethereal's state), by name only (`bin/secret-fallback.mjs`); when the runtime is sound but the guard fails or misses its deadline, the runner refuses the call; an untrusted hook never runs (the guard accepts `--harness claude|codex|opencode`). OpenCode: the plugin's `tool.execute.before` (`plugins/dethereal.ts`) runs the guard before `read`, `grep` and `bash`; a denial throws, and a call goes through only when the guard ran and allowed it — when the guard cannot be started, a shell command is judged by name only and a read or search is refused; the Dethereal agents' `read` deny rules (name patterns, case-sensitive) apply as well.

## MCP Server Architecture

- Entry: `src/index.ts` — Stdio transport; the server reports the package version (`serverVersion()` in `src/server.ts`)
- Config: `src/config.ts` — validation, HTTPS enforcement, debug mode

### Tools (`src/tools/`) — 30 total

The registered tools are `TOOL_MANIFEST` in `src/tools/manifest.ts`; this table lists each once. Settlement — registering the operator's confirmed values — is off by default (`src/utils/settlement-switch.ts`); with it off `model_state_settle` is not served (it is served only with `DETHEREAL_SETTLEMENT=on`), and nothing blocks a review or a push on unregistered or pending values.

| Category | Tools |
|----------|-------|
| Authentication (3) | login, logout, auth_status |
| Reference (2) | get_model_schema, get_example_models |
| Validation (1) | validate_model_json |
| Local Workspace (2) | workspace_status, detect_drift |
| Workflow State (4) | model_state, model_state_settle, model_state_waive, model_state_prune |
| Model CRUD (5) | create_threat_model, import_model, export_model, update_model, list_models |
| Element Management (4) | get_classes, match_classes, update_attributes, generate_attribute_stubs |
| MITRE Frameworks (2) | search_mitre_attack, get_mitre_defend |
| Security Elements (6) | manage_controls, manage_countermeasures, get_control_gaps, query_controls, query_exposures, query_countermeasures |
| Analysis (1) | manage_analyses |

`validate_model_json` covers validation, quality score, coverage, zoning and gates. The `query_*` tools are read-only; every security write goes through `manage_controls` and `manage_countermeasures`.

### Auth (`src/auth/`)

OAuth 2.0 PKCE flow. Auth strategy: stored-token → transparent-refresh → auth-disabled fallback.

Session credentials never reach the model (D69): prompts check the session with `auth_status` and never read the server's session store in the home directory; no tool takes a credential as input or returns one; `src/auth/redact.ts` scrubs registered session tokens from tool results and stderr. `src/__tests__/token-guard.test.ts` enforces this for everything the package ships, and for this file, which does not ship.

### GraphQL Client

`src/client/apollo-client.ts` — Apollo Client with auth headers for communicating with dt-ws.

## Guidelines

Modeling guidelines live in `workflow/shared/` (split per D47):
- `guidelines-core.md` — component types, boundary hierarchy, state management schemas. Inlined into the `threat-modeler` and `infrastructure-scout` agents.
- `guidelines-schema.md` — model file format reference. Inlined into `threat-modeler` and `security-enricher`.
- `guidelines-layout.md` — coordinates, handles, sizing; `guidelines-examples.md` — worked examples. Only the editing skills carry these.

Skills (`create`, `add`, `discover`, `threat-model`) ship the guidelines they need as sibling files read on demand (`{{include … as-file}}`), not inlined. Control-pass instructions: `workflow/shared/controls-enrichment.md` (sibling of `enrich-controls`, inlined into `security-enricher`).

The MCP tool `get_model_schema` retains its own copy for backward compatibility with external clients.

## State Management

- **`.dethernety/`** (project root) — model registry (`models.json`), plugin config
- **`.dethereal/`** (per-model) — workflow state (`state.json`), quality cache (`quality.json`), scope (`scope.json`), sync metadata (`sync.json`)
- 6 workflow states: INITIALIZED → SCOPE_DEFINED → DISCOVERED → STRUCTURE_COMPLETE → ENRICHING → REVIEWED
