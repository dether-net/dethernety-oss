# Dethernety Demo

Quick-start demo running Dethernety with Memgraph and OPA. Authentication is
disabled so you can explore the platform without setting up an OIDC provider.

## Prerequisites

- **Node.js 18+** and **pnpm 9+**
- **Docker** (with Compose v2)
- **Python 3** with `venv` (optional — needed for MITRE ATT&CK/D3FEND data)

## Quick start

```bash
# From the oss/ directory
cd demo
./demo.sh   # builds, starts, and installs modules
```

Open **http://localhost:3003** — no login required.

Subsequent runs skip the build and just start the services.

## What `demo.sh` does

1. Checks prerequisites (node, pnpm, docker)
2. Installs dependencies and builds workspace packages (skipped if already built)
3. Deploys the frontend build to the backend public directory
4. Generates the auth-less schema (`schema-noauth.graphql`)
5. Builds the Docker image (`dethernety:demo`)
6. Starts Docker Compose (memgraph + opa + dethernety)
7. Waits for services to be healthy
8. Builds and installs the dethernety-module (core component classes and data)
9. Builds and installs mitre-frameworks (ATT&CK + D3FEND — requires Python 3)
10. Restarts Dethernety to load the installed modules

Steps 2–5 are skipped if the Docker image already exists.
Steps 8–10 are skipped if modules are already installed.

## Services

| Service       | Port | Description                    |
| ------------- | ---- | ------------------------------ |
| memgraph      | 7687 | Graph database (Bolt protocol) |
| opa           | 8181 | Open Policy Agent              |
| dethernety    | 3003 | Application UI + GraphQL API   |
| memgraph-lab* | 3030 | Graph explorer UI              |

\* Optional — started with `--tools`.

## Commands

```bash
./demo.sh              # start (builds on first run)
./demo.sh --rebuild    # force a full rebuild
./demo.sh --tools      # also start Memgraph Lab (graph explorer on port 3030)
./demo.sh --down       # stop and remove containers
./demo.sh --reset      # stop, remove containers, and wipe all data
```

Flags can be combined, e.g. `./demo.sh --rebuild --tools`.

## Module management

The `scripts/module-manager.sh` tool (in the parent `oss/` directory) can be
used to build, install, and manage modules:

```bash
# Build a module from source
../scripts/module-manager.sh build ../modules/dethernety-module

# Install a packaged module
../scripts/module-manager.sh install ../modules/dethernety-module/dist/dethernety-1.0.0.tar.gz \
  --target ./modules \
  --import-dir ./data/memgraph_data/import \
  --db-uri bolt://localhost:7687 \
  --db-user dethernety \
  --db-pass demo

# List installed modules
../scripts/module-manager.sh list --state-file ./installed-modules.json
```

After installing or removing modules, restart the Dethernety container to
pick up changes:

```bash
docker restart demo-dethernety
```

## AI-assisted modeling (MCP)

The demo supports the [Dethereal](../docs/user/MCP_SERVER_GUIDE.md) MCP server out of
the box — no login needed. Build it once, then point your AI assistant at the
running demo.

```bash
# Build the MCP server (from the oss/ directory)
cd apps/dethereal && pnpm build && cd -
```

**Claude Code:**

```bash
claude mcp add dethereal \
  --env DETHERNETY_URL=http://localhost:3003 \
  -- node /path/to/oss/apps/dethereal/dist/index.js
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "dethereal": {
      "command": "node",
      "args": ["/path/to/oss/apps/dethereal/dist/index.js"],
      "env": {
        "DETHERNETY_URL": "http://localhost:3003"
      }
    }
  }
}
```

Replace `/path/to/oss` with the actual path to your checkout. Authentication is
skipped automatically — the MCP server detects `authDisabled` from the demo
backend and creates an unauthenticated client.

## Troubleshooting

**mitre-frameworks build fails**: The MITRE module requires Python 3 with `venv`
and starts a temporary Memgraph container on port 17687. If the build fails, check
for stale containers (`docker ps -a | grep mitre`) and remove them. You can build
and install it manually:

```bash
../scripts/module-manager.sh build ../modules/mitre-frameworks
../scripts/module-manager.sh install ../modules/mitre-frameworks/dist/mitre-frameworks-1.0.0.tar.gz \
  --target ./modules \
  --import-dir ./data/memgraph_data/import \
  --db-uri bolt://localhost:7687 \
  --db-user dethernety \
  --db-pass demo \
  --state-file ./installed-modules.json
docker restart demo-dethernety
```

**Modules not loading**: Check the container logs (`docker logs demo-dethernety`) for
`ModuleRegistryService` output. Modules are loaded at startup — a container
restart is needed after installing new modules.

## Production deployment

This demo runs **without authentication** and is for local evaluation only.
For production, deploy with an OIDC provider (Zitadel, Cognito, Auth0, Keycloak)
and use the production Docker image. See the main project documentation for details.
