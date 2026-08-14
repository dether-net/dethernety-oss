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

Everything domain-specific -- component types, analysis logic, security controls, issue types -- is provided by executable JavaScript modules. The platform ships with two: a default Dethernety Module and a MITRE frameworks module. See [Module system](#module-system) for how to build your own.

## Quick start

### Run a deployment (recommended)

The BYODt deployment runs the whole stack from published, signed images — a graph
database, an embedding server, the platform, an operator console, and a front-door
proxy. No source checkout and no build toolchain: a container engine is all you need.

Prerequisites: Docker with the Compose plugin, or Podman 4.1+ with a Compose provider.

Download `byodt-<version>.tar.gz` from the
[latest release](https://github.com/dether-net/dethernety-oss/releases/latest),
extract it, and start the stack:

```bash
tar xzf byodt-<version>.tar.gz
cd byodt-<version>
./byodt up
```

Open **<http://127.0.0.1:3000>**. The first run generates the database password,
pulls the images, fetches and verifies the signed modules, and ingests the MITRE
ATT&CK and D3FEND corpus, so it takes noticeably longer than later runs. The
operator console lives at `/console/` on the same address.

Full instructions, configuration reference, and day-to-day operations are in the
[BYODt deployment guide](docs/user/byodt/README.md); the design is described in the
[architecture set](docs/architecture/byodt/README.md).

### From source

Prerequisites: Node.js 18+, pnpm 9.13+, Neo4j or Memgraph, an OIDC provider.

```bash
git clone https://github.com/dether-net/dethernety-oss.git
cd dethernety-oss

pnpm install

cp env.production.template .env
# Edit .env with your database and OIDC settings

pnpm m-ingest    # Load MITRE framework data
pnpm dev         # Start development servers
```

Frontend: `http://localhost:3005` | GraphQL API: `http://localhost:3003/graphql`

### Production

Production deployment requires configuring authentication (OIDC), database,
policy engine, and module installation. See the
[Configuration Guide](docs/CONFIGURATION_GUIDE.md) for the full setup.

## Features

- **Visual modeling** -- Drag-and-drop data flow editor with components, boundaries, and trust zones
- **Graph-native storage** -- Models stored as graph structures, enabling attack path traversal and impact analysis
- **Executable module system** -- Component classes, analysis logic, controls, and integrations are all provided by JavaScript modules loaded at runtime
- **MITRE ATT&CK / D3FEND** -- Exposure-to-technique mapping and defensive countermeasure recommendations
- **File-based persistence** -- Export models as JSON files you can version-control alongside your code, edit offline, and re-import
- **Issue tracking** -- Create issues from findings with automatic element association, filtering, and merge
- **Dethereal — Claude Code plugin** -- 14 slash commands, 4 specialized AI agents, 22 MCP tools, and an 11-step guided workflow for AI-assisted threat modeling. Includes a per-Control library mirrored to local files (`controls/<id>.json`) with shared-ownership safety prompts on push, an append-only control-decision audit log, and a WAL-protected ID-rebinding mechanism for crash-safe greenfield Controls. See [Dethereal Plugin docs](docs/user/dethereal/README.md).

## Architecture

```
┌─────────────┐     GraphQL/WS     ┌─────────────┐    Bolt/Cypher    ┌─────────────┐
│   dt-ui     │ <────────────────> │             │ <───────────────> │  Neo4j /    │
│  (Vue 3)    │                    │             │                   │  Memgraph   │
└─────────────┘                    │   dt-ws     │                   └─────────────┘
                                   │  (NestJS)   │
┌─────────────┐      GraphQL       │             │
│  dethereal  │ <────────────────> │             │
│ (CC plugin) │                    └─────────────┘
└─────────────┘                           │
                                     Module System
                                          │
                                    ┌─────┴──────┐
                                    │  Modules   │
                                    │ (dt-module)│
                                    └────────────┘
```

Two complementary frontends share the same GraphQL backend: `dt-ui` for visual modeling in the browser, and `dethereal` (a Claude Code plugin) for AI-assisted modeling driven from your terminal or IDE. The plugin stores models as version-controlled JSON next to the code, fitting a DevSecOps shift-left workflow — threat models reviewed in PRs, evolved with the system, kept honest by the same source-control discipline that gates application code.

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
| [Issue Management](docs/user/ISSUE_MANAGEMENT_GUIDE.md) | Issue creation, filtering, merging, and integration |
| [Dethereal Plugin](docs/user/dethereal/README.md) | AI-assisted threat modeling with the Claude Code plugin |

### Architecture

| Document | Description |
|----------|-------------|
| [Backend](docs/architecture/backend/BACKEND_ARCHITECTURE.md) | NestJS backend, GraphQL API, module registry |
| [Frontend](docs/architecture/frontend/FRONTEND_ARCHITECTURE.md) | Vue.js frontend, stores, data flow editor |
| [Module System](docs/architecture/modules/README.md) | Module interfaces, base classes, packaging |
| [Data Access Layer](docs/architecture/dt-core/README.md) | Shared TypeScript interfaces and graph operations |
| [Dethereal](docs/architecture/dethereal/README.md) | Claude Code plugin architecture — skills, agents, MCP tools, control library, sync/publish model |
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
│   ├── dt-ui/              Vue 3 frontend (Vuetify + Vue Flow)
│   ├── dt-ws/              NestJS backend (GraphQL + Bolt/Cypher)
│   ├── dethereal/          Claude Code plugin (skills, agents, MCP server) for AI-assisted threat modeling
│   └── byodt-console/      Operator console for the BYODt deployment (Go + Vue 3)
├── packages/
│   ├── dt-core/            Shared TypeScript interfaces and utilities
│   ├── dt-module/          Module system base classes
│   ├── eslint-config/      Shared ESLint configuration
│   └── typescript-config/  Shared TypeScript configuration
├── modules/
│   ├── dethernety-general/ Default threat modeling module
│   └── mitre-frameworks/   MITRE ATT&CK and D3FEND data
├── docs/                   Documentation
├── deploy/compose/         The BYODt deployment bundle (compose + control script)
├── pkg/                    Shared Go packages (module verification, extraction)
└── scripts/                Build scripts and module-manager CLI
```

## Contributing

We welcome contributions. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting pull requests. By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

All contributors must sign the [Contributor License Agreement](CLA.md).

## Security

To report vulnerabilities, see [SECURITY.md](SECURITY.md). Do not open public issues for security reports.

## License

[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only).

Copyright 2025-2026 dether-net.
