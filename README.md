<p align="center">
  <img src="docs/assets/DT.png" alt="Dethernety" width="120">
</p>

<h1 align="center">Dethernety</h1>

<p align="center">
  Open-source, graph-native threat modeling platform
  <br>
  <a href="https://dether.net">Website</a> · <a href="docs/user/BUILDING_YOUR_FIRST_MODEL.md">Getting started</a> · <a href="docs/user/">Documentation</a> · <a href="https://www.youtube.com/@dether-net">Videos</a> · <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License">
</p>

---

## Overview

Dethernety is a graph-native threat modeling tool. Your models are stored as actual graph structures (Neo4j or Memgraph) -- components, data flows, boundaries, and controls are nodes and relationships, not rows in a table. This is what makes attack path traversal, impact analysis, and dependency mapping across your architecture possible. You build models visually with a drag-and-drop editor, then run security analysis to surface findings mapped to MITRE ATT&CK techniques and D3FEND countermeasures.

Everything domain-specific -- component types, analysis logic, security controls, issue types -- is provided by executable JavaScript modules. The platform ships with four: the Dethernety General module, which supplies every class you can pick from; a MITRE ATT&CK, ATLAS and D3FEND data pack; the Threat Report, which contributes the one analysis type in a stock deployment; and Coverage Tools, the backend module whose coverage facts that report reads. See [Module system](#module-system) for how to build your own.

## Quick start

There are four ways to run Dethernety. Ways 1–3 install the same signed BYODt
deployment and differ only in how you fetch and set it up. Way 4 builds the
platform from source, for development.

| Way | Use it when | Needs |
|-----|-------------|-------|
| [1. With npx](#1-with-npx) (recommended) | Node.js is already installed (for example, because you run [Dethereal](docs/user/dethereal/GETTING_STARTED.md)), or you are happy to install it | A container engine, what `get-byodt.sh` needs, and Node.js 18+ to run the installer only — not needed by the deployment |
| [2. With `get-byodt.sh`](#2-with-get-byodtsh) | You would rather not have Node.js | A container engine, `sh`, `tar`, `curl` or `wget` |
| [3. With the release tarball](#3-with-the-release-tarball) | You want to download and verify every file yourself | A container engine, `curl`, `tar`; [cosign](https://github.com/sigstore/cosign) to verify |
| [4. From source](#4-from-source) | You are developing Dethernety | Node.js 22.12+, pnpm 9.13+, Neo4j (with APOC Core) or Memgraph, Python 3 for the MITRE loader; see [the prerequisites](#4-from-source) |

### The BYODt deployment (ways 1–3)

The BYODt deployment runs the whole stack from published, signed images — a graph
database, the platform (which embeds in process), an operator console, and a front-door
proxy. No source checkout and no build toolchain: a container engine is all you need.

Prerequisites: Docker with the Compose plugin, or Podman 4.1+ with a Compose provider,
and `sha256sum` or `shasum`. See
[Requirements](docs/user/byodt/INSTALLATION.md#requirements) for disk, memory, and
network access.

The commands below use the current release; newer releases are listed on the
[releases page](https://github.com/dether-net/dethernety-oss/releases).

Once it is running, open **<http://127.0.0.1:3000>**. The first run generates the
database password, pulls the images, fetches and verifies the signed modules, downloads
the embedding model, and ingests the MITRE ATT&CK, ATLAS and D3FEND corpus, so it takes
noticeably longer than later runs. The operator console lives at `/console/` on the
same address.

Full instructions, configuration reference, and day-to-day operations are in the
[BYODt deployment guide](docs/user/byodt/README.md); the design is described in the
[architecture set](docs/architecture/byodt/README.md).

### 1. With npx

The recommended way if Node.js 18 or later is installed, or you are happy to install
it. Node.js runs the installer only: the deployment itself never needs it. It is the
natural fit if you will run the Dethereal plugin (for Claude Code, Codex or OpenCode) on
the same machine: its MCP server runs on Node.js 20.11.1 or later, so a machine set up for
Dethereal already meets the installer's need (see
[Getting started with Dethereal](docs/user/dethereal/GETTING_STARTED.md#prerequisites)).
Without Node.js, use [way 2](#2-with-get-byodtsh).

The npm package `@dether.net/byodt` carries a release's own `get-byodt.sh` and runs it,
so it takes the same options and asks the same questions as way 2. Each package version
is the release of the same version:

```bash
npx @dether.net/byodt@0.15.0
```

Name the version: without `@X.Y.Z`, `npx` runs the latest release. A release reaches
npm separately from GitHub; if yours is not there yet, use `get-byodt.sh`. See
[Installation → With npx](docs/user/byodt/INSTALLATION.md#with-npx).

### 2. With `get-byodt.sh`

Each release publishes a signed installer, `get-byodt.sh`. It downloads that release's
bundle, checks its SHA-256 and, when cosign is installed, its signature, unpacks it into
`./byodt`, and asks a few setup questions. It runs on Linux or macOS (on Windows,
inside WSL).

```bash
VERSION=0.15.0
curl --proto '=https' --tlsv1.2 -fsSL "https://github.com/dether-net/dethernety-oss/releases/download/v${VERSION}/get-byodt.sh" | sh
```

To verify the installer itself before you run it, download it with its signature:

```bash
BASE="https://github.com/dether-net/dethernety-oss/releases/download/v${VERSION}"
curl --proto '=https' --tlsv1.2 -fsSLO "${BASE}/get-byodt.sh"
curl --proto '=https' --tlsv1.2 -fsSLO "${BASE}/get-byodt.sh.bundle"
cosign verify-blob get-byodt.sh \
  --bundle get-byodt.sh.bundle \
  --certificate-identity "https://github.com/dether-net/dethernety-oss/.github/workflows/release.yml@refs/tags/v${VERSION}" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
sh get-byodt.sh
```

Setup asks `Start the stack now? [y/N]`. If you answer `n`, start it later with
`./byodt up` in the folder it installed into (`./byodt` unless you gave `--dir`).
Options such as `--dir` go after `sh -s --`; see
[Installation → Install with the installer](docs/user/byodt/INSTALLATION.md#install-with-the-installer).

### 3. With the release tarball

Download `byodt-0.15.0.tar.gz` from the release, extract it somewhere durable — the
directory becomes the deployment — and start the stack:

```bash
VERSION=0.15.0
curl -fsSLO "https://github.com/dether-net/dethernety-oss/releases/download/v${VERSION}/byodt-${VERSION}.tar.gz"
tar xzf "byodt-${VERSION}.tar.gz"
cd "byodt-${VERSION}"
./byodt up
```

To verify the bundle's signature with cosign before you extract it, see
[Installation → Get the bundle](docs/user/byodt/INSTALLATION.md#get-the-bundle).

### 4. From source

Prerequisites:

- Node.js 22.12+ and pnpm 9.13+; a current Node.js LTS (22, 24 or 26) is recommended, and
  running the test suite needs 22.22.2+ or 24.15+ (see
  [CONTRIBUTING](CONTRIBUTING.md#prerequisites))
- A running Neo4j or Memgraph instance; on Neo4j, APOC Core is required (see
  [Database](docs/CONFIGURATION_GUIDE.md#database-boltcypher))
- Python 3 with its `venv` module, for the MITRE loader
- Network access for the MITRE loader: its setup installs the Python packages in
  `modules/mitre-frameworks/requirements.txt` from PyPI (not version-pinned; they
  include PyTorch, a large download), and the loader downloads the pinned ATT&CK,
  ATLAS and D3FEND releases
- An OIDC provider, or run single-user without authentication

Configuration files (examples in the [Quick Start](docs/CONFIGURATION_GUIDE.md#quick-start)):

- **Backend**: `apps/dt-ws/.env`, not the repository root. `env.production.template`
  is for production; do not use it for development.
- **Frontend dev server**: `apps/dt-ui/.env.local` (see
  [Development](docs/CONFIGURATION_GUIDE.md#development)). Without authentication, set
  `VITE_ENABLE_NOAUTH=true` and leave `VITE_OIDC_ISSUER` unset.

Without authentication, anyone who can reach the backend has full access, and the dev
servers listen on all network interfaces. Use it only on a single-user machine on a
trusted network, or block ports 3003 and 3005 at the host firewall (see
[Auth-disabled mode](docs/CONFIGURATION_GUIDE.md#auth-disabled-mode-single-user--development)).

```bash
git clone https://github.com/dether-net/dethernety-oss.git
cd dethernety-oss
pnpm install

# Create apps/dt-ws/.env and apps/dt-ui/.env.local (see above)
grep -E '^NEO4J_(URI|USERNAME|PASSWORD)=' apps/dt-ws/.env > .env   # Database settings for the MITRE loader

# Start Neo4j or Memgraph
pnpm --filter mitre-frameworks run setup     # Once: the MITRE loader's Python environment
pnpm m-ingest                                # Load MITRE framework data

# Compile the backend, the frontend and the packages they use; package the modules
pnpm build --filter dt-ws --filter dt-ui --filter dethernety-general \
  --filter dethernety-coverage-tools --filter dethernety-threat-report

# Install the modules: the classes (general) and the Threat Report analysis
for m in dethernety-general dethernety-coverage-tools dethernety-threat-report; do
  ./scripts/module-manager.sh install modules/$m/dist/$m-*.tar.gz \
    --target apps/dt-ws/custom_modules \
    --state-file apps/dt-ws/custom_modules/installed-modules.json
done

pnpm dev --filter dt-ws --filter dt-ui       # Start the backend and frontend
```

`pnpm m-ingest` is never cached: it runs every time, so it also loads a new, empty
database.

Frontend: `http://localhost:3005` | GraphQL API: `http://localhost:3003/graphql`

**Production.** Running a source build in production requires configuring
authentication (OIDC), database, policy engine, and module installation. See the
[Configuration Guide](docs/CONFIGURATION_GUIDE.md) for the full setup.

## Features

- **Visual modeling** -- Drag-and-drop data flow editor with components, boundaries, and trust zones
- **Graph-native storage** -- Models stored as graph structures, enabling attack path traversal and impact analysis
- **Executable module system** -- Component classes, analysis logic, controls, issue types, and analysis types are all provided by JavaScript modules loaded at runtime
- **MITRE ATT&CK / D3FEND** -- Exposure-to-technique mapping and defensive countermeasure recommendations
- **File-based persistence** -- Export models as JSON files you can version-control alongside your code, edit offline, and re-import
- **Issue tracking** -- Create issues from findings with automatic element association, filtering, and merge
- **Dethereal — plugin for Claude Code, Codex and OpenCode** -- 14 commands, 6 specialized AI agents, 30 MCP tools, and an 11-step guided workflow for AI-assisted threat modeling. Includes a per-Control library mirrored to local files (`controls/<id>.json`) with shared-ownership safety prompts on push, an append-only control-decision audit log, and a WAL-protected ID-rebinding mechanism for crash-safe greenfield Controls. See [Dethereal Plugin docs](docs/user/dethereal/README.md).

## Architecture

```
┌─────────────┐     GraphQL/WS     ┌─────────────┐    Bolt/Cypher    ┌─────────────┐
│   dt-ui     │ <────────────────> │             │ <───────────────> │  Neo4j /    │
│  (Vue 3)    │                    │             │                   │  Memgraph   │
└─────────────┘                    │   dt-ws     │                   └─────────────┘
                                   │  (NestJS)   │
┌─────────────┐      GraphQL       │             │
│  dethereal  │ <────────────────> │             │
│  (plugin)   │                    └─────────────┘
└─────────────┘                           │
                                     Module System
                                          │
                                    ┌─────┴──────┐
                                    │  Modules   │
                                    │ (dt-module)│
                                    └────────────┘
```

Two complementary frontends share the same GraphQL backend: `dt-ui` for visual modeling in the browser, and `dethereal` (a plugin for Claude Code, Codex and OpenCode) for AI-assisted modeling driven from your terminal or IDE. The plugin stores models as version-controlled JSON next to the code, fitting a DevSecOps shift-left workflow — threat models reviewed in PRs, evolved with the system, kept honest by the same source-control discipline that gates application code.

Built with Vue 3, NestJS, Neo4j/Memgraph, GraphQL, OPA/Rego, and TypeScript MCP. OIDC authentication end-to-end.

## Documentation

### User guides

| Guide | Description |
|-------|-------------|
| [Building Your First Model](docs/user/BUILDING_YOUR_FIRST_MODEL.md) | Step-by-step tutorial for creating a threat model |
| [Component Configuration](docs/user/COMPONENT_CONFIGURATION_GUIDE.md) | Component setup, class assignment, and attributes |
| [Security Analysis](docs/user/SECURITY_ANALYSIS_WORKFLOW.md) | Running analysis and interpreting results |
| [Security Controls](docs/user/WORKING_WITH_SECURITY_CONTROLS.md) | Creating, configuring, and assigning controls |
| [Modules](docs/user/UNDERSTANDING_MODULES.md) | How the module system works |
| [Issue Management](docs/user/ISSUE_MANAGEMENT_GUIDE.md) | Issue creation, element association, filtering, and merging |
| [Dethereal Plugin](docs/user/dethereal/README.md) | AI-assisted threat modeling with the plugin for Claude Code, Codex and OpenCode |

### Architecture

| Document | Description |
|----------|-------------|
| [Backend](docs/architecture/backend/BACKEND_ARCHITECTURE.md) | NestJS backend, GraphQL API, module registry |
| [Frontend](docs/architecture/frontend/FRONTEND_ARCHITECTURE.md) | Vue.js frontend, stores, data flow editor |
| [Module System](docs/architecture/modules/README.md) | Module interfaces, base classes, packaging |
| [Data Access Layer](docs/architecture/dt-core/README.md) | Shared TypeScript interfaces and graph operations |
| [Dethereal](docs/architecture/dethereal/README.md) | Plugin architecture for Claude Code, Codex and OpenCode — skills, agents, MCP tools, control library, sync/publish model |
| [Architecture Decision Records](docs/architecture/decisions/) | Rationale behind major technical decisions |
| [Configuration](docs/CONFIGURATION_GUIDE.md) | Environment variables and deployment settings |
| [Security Model](docs/SECURITY_MODEL.md) | Security architecture and protections |
| [Glossary](docs/GLOSSARY.md) | Domain terminology reference |

## Module system

Modules are executable JavaScript/TypeScript code, not static configuration or templates. A module can define component classes for threat modeling, implement analysis logic, provide security controls, create issue types, or integrate with external systems. Because they're real code, there's no hard limit on what a module can do -- anything you can write in JS is fair game.

You don't have to start from scratch. The platform ships with a base class library ([dt-module](packages/dt-module/)) that handles registration, schema definition, and lifecycle management. For analysis, modules can use built-in OPA/Rego policy evaluation to write detection rules declaratively, or implement their own logic. The included [Dethernety General](modules/dethernety-general/) is a working reference implementation.

See the [development guide](docs/architecture/modules/DEVELOPMENT_GUIDE.md) for building your own.

## Project structure

```
dethernety-oss/
├── apps/
│   ├── dt-ui/                     Vue 3 frontend (Vuetify + Vue Flow)
│   ├── dt-ws/                     NestJS backend (GraphQL + Bolt/Cypher)
│   ├── dethereal/                 Plugin for Claude Code, Codex and OpenCode (skills, agents, MCP server) for AI-assisted threat modeling
│   └── byodt-console/             Operator console for the BYODt deployment (Go + Vue 3)
├── packages/
│   ├── dt-core/                   Shared TypeScript interfaces and utilities
│   ├── dt-module/                 Module system base classes
│   ├── eslint-config/             Shared ESLint configuration
│   └── typescript-config/         Shared TypeScript configuration
├── modules/
│   ├── dethernety-general/        Default threat modeling module -- the only module contributing classes
│   ├── mitre-frameworks/          MITRE ATT&CK, ATLAS and D3FEND data pack (no runtime code)
│   ├── dethernety-threat-report/  The "Threat Report" analysis type and the report it renders
│   └── dethernety-coverage-tools/ Backend-only; the coverage facts the Threat Report reads
├── docs/                          Documentation
├── deploy/compose/                The BYODt deployment bundle (compose + control script)
├── pkg/                           Shared Go packages (module verification, extraction)
└── scripts/                       Build scripts and module-manager CLI
```

## Contributing

We welcome contributions. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting pull requests. By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

All contributors must sign the [Contributor License Agreement](CLA.md).

## Security

To report vulnerabilities, see [SECURITY.md](SECURITY.md). Do not open public issues for security reports.

## License

[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only).

Copyright 2025-2026 dether-net.
