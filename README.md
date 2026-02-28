# Dethernety

AI-integrated cybersecurity threat modeling framework. Model your systems, identify exposures, and map security controls — all backed by graph-based analysis and MITRE ATT&CK/D3FEND integration.

## Overview

Dethernety helps security teams and developers identify potential security issues early in the development lifecycle. It combines interactive data flow diagram modeling with an extensible module system, graph database storage, and optional AI-powered analysis.

### Key Features

- **Interactive Threat Modeling** — Drag-and-drop data flow diagram editor built with Vue Flow
- **Graph-Native Data Model** — Threat models stored as graph structures (Neo4j or Memgraph)
- **MITRE ATT&CK Integration** — Map exposures to ATT&CK techniques and mitigations
- **MITRE D3FEND Integration** — Link controls to D3FEND defensive techniques
- **Extensible Module System** — Add custom component classes, controls, exposures, and analysis types
- **Security Boundaries** — Define trust levels and model boundary crossings
- **Exposure Detection** — Identify and score potential vulnerabilities
- **Control Management** — Track security countermeasures and their effectiveness
- **GraphQL API** — Full API with real-time subscriptions via WebSocket/SSE
- **OIDC Authentication** — Integrate with any OpenID Connect provider

## Architecture

```
┌─────────────┐     GraphQL/WS     ┌─────────────┐     Bolt/Cypher    ┌─────────────┐
│   dt-ui     │ ◄────────────────► │   dt-ws     │ ◄────────────────► │  Neo4j /    │
│  (Vue 3)    │                    │  (NestJS)   │                    │  Memgraph   │
└─────────────┘                    └─────────────┘                    └─────────────┘
                                         │
                                    Module System
                                         │
                                   ┌─────┴──────┐
                                   │  Modules   │
                                   │ (dt-module)│
                                   └────────────┘
```

## Quick Start

### Using Docker Compose (recommended)

The fastest way to try Dethernety locally:

```bash
cd demo
cp .env.example .env    # Edit with your settings
docker compose up -d
```

This starts Dethernety with Memgraph and a pre-configured environment. See [demo/README.md](demo/README.md) for details.

### From Source

Prerequisites: Node.js 18+, pnpm 9.13+, a Bolt/Cypher-compatible database (Neo4j or Memgraph).

```bash
# Clone the repository
git clone https://github.com/dether-net/dethernety-oss.git
cd dethernety-oss

# Install dependencies
pnpm install

# Configure environment
cp env.production.template .env
# Edit .env with your database and auth settings

# Ingest MITRE framework data
pnpm m-ingest

# Start development servers
pnpm dev
```

The frontend will be available at `http://localhost:5173` and the GraphQL API at `http://localhost:3000/graphql`.

### Production Build

```bash
# Build everything
pnpm build

# Or use the build script
./scripts/build.sh

# Build Docker image
pnpm docker:build

# Run
pnpm docker:run
```

## Project Structure

```
dethernety-oss/
├── apps/
│   ├── dt-ui/              Vue 3 frontend (Vuetify + Vue Flow)
│   ├── dt-ws/              NestJS backend (GraphQL + Bolt/Cypher)
│   └── dethereal/          Supplementary application
├── packages/
│   ├── dt-core/            Shared TypeScript interfaces and utilities
│   ├── dt-module/          Module system base classes
│   ├── eslint-config/      Shared ESLint configuration
│   └── typescript-config/  Shared TypeScript configuration
├── modules/
│   ├── dethernety-module/  Default threat modeling module
│   └── mitre-frameworks/   MITRE ATT&CK and D3FEND data
├── docs/                   Schema reference and technical docs
├── demo/                   Docker Compose demo environment
└── scripts/                Build and utility scripts
```

## Documentation

- [Schema Reference](docs/schema.md) — Neo4j graph schema documentation
- [Export/Import Schema](docs/export-import-schema.json) — Model export/import format

Full documentation including architecture guides, configuration reference, and user guides is being prepared for release.

## Module System

Dethernety's module system lets you extend the platform with custom:

- **Component Classes** — New types of system components for modeling
- **Control Classes** — Security control definitions with countermeasures
- **Exposure Rules** — Custom vulnerability detection logic
- **Data Flow Classes** — Specialized data flow types
- **Analysis Classes** — Custom analysis workflows

See [packages/dt-module/](packages/dt-module/) for the base classes and [modules/dethernety-module/](modules/dethernety-module/) for a reference implementation.

## Contributing

We welcome contributions. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting pull requests.

All contributors must sign the [Contributor License Agreement](CLA.md).

## Security

To report security vulnerabilities, please see [SECURITY.md](SECURITY.md). Do not open public issues for security reports.

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only).

Copyright 2025-2026 dether-net.
