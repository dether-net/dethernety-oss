# Dethernety Demo

Quick-start demo running Dethernety with Memgraph. Authentication is
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
6. Starts Docker Compose (memgraph + ollama + dethernety)
7. Waits for services to be healthy
8. Builds and installs the dethernety-general module (core component classes and data)
9. Builds and installs mitre-frameworks (ATT&CK + D3FEND — requires Python 3)
10. Restarts Dethernety to load the installed modules

Steps 2–5 are skipped if the Docker image already exists.
Steps 8–10 are skipped if modules are already installed.

## Services

| Service       | Port | Description                    |
| ------------- | ---- | ------------------------------ |
| memgraph      | 7687 | Graph database (Bolt protocol) |
| ollama        | —    | Embedding model server (internal) |
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

## Embedding-model swap

The demo defaults to Google's `embeddinggemma` (768-dim) for both the MITRE
picker's vector tier and the class-suggestion engine. The model is
configurable via the host environment — `docker-compose` interpolates the
value when the stack comes up, so `EMBEDDING_MODEL` controls **which model
Ollama pulls AND which model the dethernety service queries**.

```bash
# Default (embeddinggemma, 768-dim, threshold 0.40)
./demo.sh

# Override — e.g. nomic-embed-text for a smaller host
EMBEDDING_MODEL=nomic-embed-text EMBEDDING_SIMILARITY_THRESHOLD=0.75 ./demo.sh
```

After switching the model, the **pre-computed vectors must be regenerated**
against the new model — otherwise the runtime precheck reports
`MODEL_MISMATCH` and disables the vector tier. Two re-builds are needed:

```bash
# 1. MITRE corpus (mitre-frameworks module)
cd ../modules/mitre-frameworks
EMBEDDING_PROVIDER=ollama \
EMBEDDING_MODEL=<your-model> \
OLLAMA_URL=http://localhost:11434/api/embed \
  python3 scripts/export_embeddings_to_cypher.py
# → regenerates data/05-mitre-embeddings.cypher with the new vectors.
# Re-install the module against the demo stack to push the new corpus.

# 2. dethernety-module class embeddings (per-class .json next to each
#    class definition). Uses the same EMBEDDING_MODEL/EMBEDDING_URL.
cd ../dethernety-module
EMBEDDING_MODEL=<your-model> \
EMBEDDING_URL=http://localhost:11434/api/embed \
  pnpm embed
```

Threshold tuning is model-specific (the cosine-space topology differs):

| Model | Suggested `EMBEDDING_SIMILARITY_THRESHOLD` |
|---|---|
| `embeddinggemma` (default) | `0.40` (empirically measured on MITRE corpus — top hits cluster 0.45–0.66; 0.40 admits the long-tail useful matches) |
| `nomic-embed-text` | `0.75` |
| `text-embedding-3-small` (OpenAI) | `0.50` |
| `mxbai-embed-large` / `bge-large-en-v1.5` | `0.55` (estimate — measure before relying on it) |

Both the build- and query-side embed raw text — no model-family-specific
task prefixes. nomic-embed-text users running through Ollama trade a small
amount of recall (the model is trained with `search_document: ` /
`search_query: ` prefixes) for byte-aligned build and query inputs. The
hard-pinned sentence-transformers provider in the MITRE build pipeline
still applies the nomic prefix, since it is the documented trust boundary
for that provider.

## AI-assisted modeling (Dethereal Plugin)

The demo supports the [Dethereal](../docs/user/dethereal/README.md) plugin out of
the box — no login needed. Build it once, then load the full plugin (skills,
agents, hooks, and MCP server) in Claude Code.

```bash
# Build the plugin (from the oss/ directory)
cd apps/dethereal && pnpm build && cd -

# Start Claude Code with the plugin loaded
DETHERNETY_URL=http://localhost:3003 claude --plugin-dir apps/dethereal
```

Authentication is skipped automatically — the plugin detects `authDisabled` from
the demo backend and creates an unauthenticated client.

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
