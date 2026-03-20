# Dethernety Module Package System

## Overview

This document describes the design of Dethernety's module package system - a standardized way to distribute, install, and manage modules across deployments.

A module package is a **deployment unit** that can contain multiple components:
- Dethernety backend modules (JavaScript)
- Analysis graphs (Python)
- Database ingestion data (Cypher)
- Lifecycle scripts (shell)
- Arbitrary files

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Package format | `tar.gz` | Handle packages as atomic units; simple, compressed |
| Versioning | SemVer | Industry standard; `modules/{name}/{version}/package.tar.gz` |
| Graph runtime | Graph runtime server | Self-hosted, no vendor lock-in, config-driven graph loading |
| Shared code | Base modules | Modules can depend on other modules |
| Version coexistence | Replace only | No multiple versions of the same module |
| Installation trigger | Module management service | Host-resident service pulls and installs modules |
| Entitlement | Application-level | Pre-signed URLs with entitlement check (future) |
| Failure handling | Rollback | Atomic installation with rollback on failure |
| Script execution | Isolated container | Lifecycle scripts run in Podman container with no network, limited mounts |
| Package signing | Sigstore/cosign | Keyless OIDC signing (CI: workflow identity, manual: personal identity) |

## Package Structure

```
{module-name}-{version}.tar.gz
│
├── manifest.json                 # Required: metadata, version, dependencies
│
├── dethernety/                   # Backend modules (JavaScript) - optional
│   └── {module-name}/            # One directory per module (can have multiple)
│       ├── {ModuleName}Module.js # Main module entry point (must end with Module.js)
│       ├── *.js                  # Supporting files
│       ├── schema.graphql        # Optional GraphQL schema extension (SDL)
│       └── frontend/             # Optional UI components
│           └── bundle.js         # Vite-bundled Vue.js
│
├── langgraph/                    # Analysis graphs (Python) - optional
│   ├── graphs.json               # Graph registration fragment
│   └── {graph_name}/             # One directory per graph
│       ├── graph.py              # Main graph definition
│       ├── nodes.py              # Node implementations
│       ├── state.py              # State definitions
│       ├── requirements.txt      # Python dependencies (optional)
│       └── prompts/              # Prompt templates
│
├── data/                         # Database ingestion - optional
│   ├── *.cypher                  # Cypher scripts (executed alphabetically by module management service)
│   └── *.csv                     # Data files for LOAD CSV queries
│
├── scripts/                      # Lifecycle hooks - optional
│   ├── pre-install.sh            # Run before installation
│   ├── post-install.sh           # Run after installation
│   ├── pre-remove.sh             # Run before uninstallation
│   ├── post-remove.sh            # Run after uninstallation
│   └── rollback.sh               # Rollback handler
│
└── files/                        # Arbitrary files - optional (not installed, available to scripts)
    └── ...
```

## Manifest Schema

### manifest.json

```json
{
  "name": "mitre-attack-analysis",
  "version": "1.2.0",
  "displayName": "MITRE ATT&CK Analysis",
  "description": "AI-powered MITRE ATT&CK mapping and analysis",
  "tags": ["security", "mitre", "analysis"],

  "dependencies": [
    { "name": "analysis-utils", "version": ">=1.0.0" }
  ],

  "lifecycle": {
    "preInstall": "scripts/pre-install.sh",
    "postInstall": "scripts/post-install.sh",
    "preRemove": "scripts/pre-remove.sh",
    "postRemove": "scripts/post-remove.sh",
    "rollback": "scripts/rollback.sh"
  },

  "restarts": ["analysis-build.service", "analysis.service", "dethernety.service"]
}
```

### Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique module identifier (lowercase, hyphens) |
| `version` | string | Yes | SemVer version (e.g., "1.2.0") |
| `displayName` | string | Yes | Human-readable name |
| `description` | string | No | Module description |
| `tags` | array | No | Categorization tags (auto-synced to registry) |
| `dependencies` | array | No | List of required modules with version constraints |
| `lifecycle` | object | No | Paths to lifecycle hook scripts |
| `restarts` | array | No | Systemd units to restart (full unit names, executed in order). Used for both install and remove operations - restarts occur after components change but before post-* hooks. |

## Module Dependencies

Modules can depend on other modules. Dependencies are resolved recursively during installation - if module A depends on module B, B is installed first.

Example: `analysis-utils` (a shared utility module)
```
analysis-utils-1.0.0.tar.gz
├── manifest.json
│   {
│     "name": "analysis-utils",
│     "version": "1.0.0"
│   }
│
└── langgraph/
    └── shared_utils/
        ├── __init__.py
        ├── graph_helpers.py
        ├── data_utils.py
        └── db_connection.py
```

Modules that depend on `analysis-utils` can import from it:

```python
# In my-analysis-module/langgraph/graph.py
from shared_utils import db_connection, data_utils
from shared_utils.graph_helpers import build_context
```

## Artifact Storage Layout

Module packages are stored in an artifact repository (e.g., an object store, HTTP file server, or OCI registry):

```
artifacts/{environment}/
│
├── frontend/                     # Frontend builds (existing)
│   └── {git-tag}/
│       └── ...
│
└── modules/                      # Module packages
    │
    ├── registry.json             # Index of all available modules
    │
    ├── analysis-utils/
    │   └── 1.0.0/
    │       ├── manifest.json          # Extracted from package for quick access
    │       ├── package.tar.gz         # Contains manifest.json + all components
    │       ├── package.tar.gz.bundle  # Sigstore bundle (signature + certificate)
    │       ├── package.tar.gz.sig     # Cosign signature (legacy compatibility)
    │       └── package.tar.gz.pem     # Cosign certificate (legacy compatibility)
    │
    ├── analysis-core/
    │   └── 1.0.0/
    │       ├── manifest.json
    │       ├── package.tar.gz
    │       ├── package.tar.gz.bundle
    │       ├── package.tar.gz.sig
    │       └── package.tar.gz.pem
    │
    └── mitre-attack-analysis/
        ├── 1.0.0/
        │   ├── manifest.json
        │   ├── package.tar.gz
        │   ├── package.tar.gz.bundle
        │   ├── package.tar.gz.sig
        │   └── package.tar.gz.pem
        └── 1.2.0/
            ├── manifest.json
            ├── package.tar.gz
            ├── package.tar.gz.bundle
            ├── package.tar.gz.sig
            └── package.tar.gz.pem
```

**Release process**: The GitHub Actions release workflow:
1. Builds and signs the module package (`build-module.sh`)
   - Creates `package.tar.gz` and signs with cosign (keyless OIDC)
   - Outputs `.bundle`, `.sig`, `.pem` files
2. Uploads to artifact storage and updates registry (`upload-module.sh`)
   - Extracts `manifest.json` from package
   - Uploads all files to artifact storage
   - Updates `registry.json`

This allows the module management service to read manifests and verify integrity/authenticity without downloading full packages.

### registry.json

```json
{
  "version": "1",
  "updated": "2024-12-18T10:00:00Z",
  "modules": {
    "analysis-utils": {
      "displayName": "Analysis Utilities",
      "versions": ["1.0.0"],
      "latest": "1.0.0",
      "tags": ["analysis", "utilities", "shared"]
    },
    "mitre-attack-analysis": {
      "displayName": "MITRE ATT&CK Analysis",
      "versions": ["1.0.0", "1.2.0"],
      "latest": "1.2.0",
      "tags": ["security", "mitre", "analysis"]
    }
  }
}
```

**Note**: Entitlement information is managed separately from the registry. This allows access policies to change without modifying technical artifacts.

## Host Installation Layout

### Data Volume Structure

```
/var/data/dethernety/
│
├── modules/                      # Dethernety backend modules
│   └── {module-name}/
│       ├── {ModuleName}Module.js
│       └── *.js
│
├── analysis/                     # Analysis backend data
│   ├── graphs.config.json        # Merged graph configuration (graph runtime config)
│   └── graphs/                   # Analysis graph code (Python)
│       ├── shared_utils/         # From analysis-utils module
│       └── {graph_name}/         # From extension modules
│
├── data/                         # Ingested data files (CSVs for LOAD CSV queries)
│   └── {module-name}/
│       └── *.csv
│
├── staging/                      # Temporary extraction area (created by module management service)
│   └── {module-name}/
│
├── manifests/                    # Backup of installed module manifests (for uninstall)
│   └── {module-name}.json
│
└── installed-modules.json        # Installation state tracking
```

### installed-modules.json

```json
{
  "analysis-utils": {
    "version": "1.0.0",
    "installedAt": "2024-12-18T10:00:00Z",
    "components": ["langgraph"]
  },
  "mitre-attack-analysis": {
    "version": "1.2.0",
    "installedAt": "2024-12-18T10:30:00Z",
    "components": ["dethernety", "langgraph", "data"]
  }
}
```

## Container Volume Mounts

### dethernety.container.tpl

```ini
[Container]
# ... existing config ...

# Module volume mount
Volume=/var/data/dethernety/modules:/app/custom_modules:ro
```

### analysis.container.tpl

```ini
[Container]
# ... existing config ...

# Analysis graphs volume mount (executed by graph runtime server)
Volume=/var/data/dethernety/analysis/graphs:/app/graphs:ro
Volume=/var/data/dethernety/analysis/graphs.config.json:/app/graphs.config.json:ro
```

### memgraph.container.tpl

```ini
[Container]
# ... existing config ...

# Module data files (for LOAD CSV queries during data ingestion)
Volume=/var/data/dethernety/data:/var/lib/memgraph/import:ro
```

Cypher scripts use `LOAD CSV FROM '/var/lib/memgraph/import/{module-name}/file.csv'` to access module data files.

## Installation Flow

### Overview

Module installation runs asynchronously. The client receives an immediate response with a job ID and polls for completion.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        MODULE INSTALLATION FLOW (ASYNC)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Deployment service triggers installation                                │
│     └── POST /api/modules { name, version }                                 │
│                                                                             │
│  2. Module management service creates job, returns immediately (HTTP 202)   │
│     └── Response: { "jobId": "abc123", "message": "Installation started" }  │
│                                                                             │
│  3. Background goroutine starts installation                                │
│     └── Progress reported at each step via job store                        │
│                                                                             │
│  ─────────────────── BACKGROUND INSTALLATION ───────────────────            │
│                                                                             │
│  4. Download package + signature from artifact storage             [5-25%]   │
│     └── package.tar.gz, package.tar.gz.bundle                               │
│                                                                             │
│  5. Verify signature                                              [25-35%]  │
│     └── cosign verify-blob against allowed identities                       │
│                                                                             │
│  6. Extract to staging                                            [35-45%]  │
│     └── /var/data/dethernety/staging/{module}/                              │
│                                                                             │
│  7. Parse and validate manifest.json                              [45-50%]  │
│     └── Validate schema, check dependencies                                 │
│                                                                             │
│  8. Resolve dependencies                                          [50-55%]  │
│     └── If missing → Install dependencies first (recursive)                 │
│                                                                             │
│  9. Run pre-install.sh (if exists)                                [55-60%]  │
│                                                                             │
│ 10. Install components                                            [60-75%]  │
│     ├── dethernety/*/ → /var/data/dethernety/modules/ (each subdir)         │
│     ├── langgraph/*/ → /var/data/dethernety/analysis/graphs/ (each graph)  │
│     ├── langgraph/graphs.json → merge into graphs.config.json               │
│     └── data/*.csv → /var/data/dethernety/data/{module}/                    │
│                                                                             │
│ 11. Backup manifest                                                         │
│     └── Copy manifest.json → /var/data/dethernety/manifests/{name}.json     │
│                                                                             │
│ 12. Run data ingestion (if data/*.cypher exists)                  [75-85%]  │
│     └── Module management service executes *.cypher against database via Bolt│
│     └── Executes *.sql against PostgreSQL (pgvector data)                   │
│                                                                             │
│ 13. Restart affected units (sequentially, in array order)         [85-90%]  │
│     └── analysis-build.service rebuilds image with new requirements.txt     │
│     └── Other units in manifest.restarts[] executed in order                │
│                                                                             │
│ 14. Run post-install.sh (if exists)                               [90-95%]  │
│                                                                             │
│ 15. Update installed-modules.json                                           │
│                                                                             │
│ 16. Clean up staging directory                                              │
│                                                                             │
│ 17. Mark job as completed                                         [100%]    │
│                                                                             │
│  ────────────────────────────────────────────────────────────────           │
│                                                                             │
│  Client polls GET /api/modules/jobs/{id} until status=completed/failed      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Upgrade Flow

Upgrade is an atomic replace operation:

1. Download and verify new version
2. Create backup of current installation:
   - Copy installed components (modules/, graphs/)
   - Save current manifest from manifests/{name}.json
3. Run pre-remove.sh (if exists) - allows graceful shutdown
4. Remove current version components (skip post-remove hooks)
5. Install new version (full install flow from step 8)
6. On failure: restore components from backup, keep old manifest

### Rollback Handling (Install/Upgrade Only)

If any step fails during installation or upgrade:

1. Run `rollback.sh` (if exists) - module-specific undo logic
2. Remove partially installed components
3. Restore previous version from backup (if upgrade)
4. Clean up staging directory
5. Report failure to the deployment service

**Note**: Rollback does not apply to removal failures. If removal fails:
- The module management service logs the error and reports partial removal
- Manual intervention may be required to clean up
- The module remains in `installed-modules.json` with a `status: "failed"` flag

### Uninstallation Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       MODULE UNINSTALLATION FLOW                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Deployment service triggers uninstallation                              │
│     └── DELETE /api/modules/{name}                                          │
│                                                                             │
│  2. Module management service receives request                              │
│                                                                             │
│  3. Check for dependent modules                                             │
│     └── If dependents exist → Fail with "module in use" error               │
│                                                                             │
│  4. Load installed manifest                                                 │
│     └── Read from /var/data/dethernety/manifests/{name}.json                │
│                                                                             │
│  5. Run pre-remove.sh (if exists)                                           │
│     └── Graceful shutdown, data export, external resource cleanup           │
│                                                                             │
│  6. Remove installed components                                             │
│     ├── dethernety/*/ → remove from /var/data/dethernety/modules/           │
│     ├── langgraph/*/ → remove from /var/data/dethernety/analysis/graphs/    │
│     ├── langgraph/graphs.json → remove entries from graphs.config.json      │
│     └── data/ → remove from /var/data/dethernety/data/{module}/             │
│                                                                             │
│  7. Restart affected units (sequentially, in array order)                   │
│     └── analysis-build.service rebuilds image without removed deps          │
│     └── Other units in manifest.restarts[] executed in order                │
│                                                                             │
│  8. Run post-remove.sh (if exists)                                          │
│     └── Final cleanup, notifications, verification                          │
│                                                                             │
│  9. Update installed-modules.json (remove entry)                            │
│                                                                             │
│ 10. Remove manifest backup                                                  │
│     └── Delete /var/data/dethernety/manifests/{name}.json                   │
│                                                                             │
│ 11. Report success to deployment service                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

The removal scripts handle module-specific cleanup:

**pre-remove.sh** (before component removal):
- Graceful shutdown of module services
- Export data that needs to be preserved
- Revoke external API keys, webhooks, etc.
- Clean up external resources while module code is still available

**post-remove.sh** (after component removal):
- Final verification that removal succeeded
- Send notifications (email, Slack, etc.)
- Clean up any remaining temporary files
- Log removal completion for audit

## Analysis Backend Integration

### Runtime Configuration

The graph runtime server uses `graphs.config.json` to discover and load graphs. The init script creates a default empty configuration:

```json
{
  "dependencies": ["./graphs"],
  "graphs": {}
}
```

When modules are installed, graph entries are merged in:

```json
{
  "dependencies": ["./graphs"],
  "graphs": {
    "threat_analysis": "./graphs/threat_analysis/graph.py:graph",
    "attack_scenarios": "./graphs/attack_scenarios/graph.py:graph",
    "mitre_mapping": "./graphs/mitre_mapping/graph.py:graph"
  }
}
```

### Graph Fragment Merging

Each module provides a `graphs.json` fragment in its `langgraph/` directory:

```json
// mitre-attack-analysis/langgraph/graphs.json
{
  "graphs": {
    "mitre_mapping": "./graphs/mitre_mapping/graph.py:graph"
  }
}
```

Paths in `graphs.json` are relative to the `graphs.config.json` location (`/var/data/dethernety/analysis/`). The module management service merges all fragments into the main `graphs.config.json` configuration file.

## Entitlement (Future)

### Phase 1: Direct Download (Current)

- Direct download from artifact storage with authentication
- No entitlement checking
- All modules accessible to all deployments

### Phase 2: Entitlement API

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ENTITLEMENT FLOW                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Module management service requests module                               │
│     └── GET /api/artifacts/modules/{name}/{version}                         │
│         Header: Authorization: Bearer {jwt}                                 │
│                                                                             │
│  2. Artifact API checks entitlement                                         │
│     └── deployment_id ∈ entitled_deployments(module, version)?              │
│                                                                             │
│  3. If entitled → Generate time-limited download URL                        │
│     If not → 403 Forbidden                                                  │
│                                                                             │
│  4. Module management service downloads using provided URL                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Repository Structure

Modules are developed in the monorepo under a top-level `modules/` directory:

```
dethernety/
├── apps/                         # Platform applications
│   ├── dt-ui/
│   ├── dt-ws/
│   ├── analysis/
│   └── script-runner/            # Lifecycle script container
│
├── packages/                     # Shared packages
│   └── dt-core/
│
├── modules/                      # Module packages (independently released)
│   ├── analysis-utils/
│   │   ├── manifest.json
│   │   ├── package.json
│   │   └── src/
│   │
│   └── mitre-attack-analysis/
│       ├── manifest.json
│       ├── package.json
│       └── src/
│           ├── dethernety/
│           ├── langgraph/
│           └── data/
│
└── build-n-deploy/
    └── scripts/
        └── modules/              # Build scripts
```

Each module has its own `package.json` for build tooling but is released independently from the platform.

## Build and Upload Process

Module releases are independent from platform releases. Reusable scripts enable both manual and CI/CD workflows.

### Script Structure

```
build-n-deploy/scripts/modules/
├── build-module.sh           # Build and sign a module package
├── upload-module.sh          # Upload to artifact storage and sync registry
└── sync-registry.sh          # Rebuild registry from artifact storage contents
```

### build-module.sh

Builds and signs a module package.

**Usage:**
```bash
./build-module.sh [--no-sign] <module-name> [output-dir]
```

**Arguments:**
| Argument | Description |
|----------|-------------|
| `--no-sign` | Skip signing (for local testing) |
| `module-name` | Module directory name in `modules/` or path to module |
| `output-dir` | Optional output directory for the package |

**What it does:**
1. Runs the module's build process (`pnpm build`) if `package.json` exists
2. Creates a `<module>-<version>.tar.gz` archive
3. Signs with cosign keyless OIDC (opens browser for authentication)
4. Outputs `.bundle`, `.sig`, and `.pem` files

**Prerequisites:**
- `cosign` installed (https://docs.sigstore.dev/cosign/installation/)
- OIDC provider configured (GitHub, Google, or Microsoft)

### upload-module.sh

Uploads a signed module package to artifact storage and syncs the registry.

**Usage:**
```bash
./upload-module.sh [--no-sync-registry] <module-name|package.tar.gz> [storage-path]
```

**Arguments:**
| Argument | Description |
|----------|-------------|
| `--no-sync-registry` | Skip registry sync after upload |
| `module-name` | Module name (finds package in `modules/<name>/dist/`) |
| `package.tar.gz` | Or direct path to a package file |
| `storage-path` | Optional artifact storage location (default: `$ARTIFACTS_STORAGE` or `dethernety-artifacts`) |

**What it does:**
1. Extracts `manifest.json` from the package
2. Uploads to artifact storage: `manifest.json`, `package.tar.gz`, `.bundle`, `.sig`, `.pem`
3. Calls `sync-registry.sh` to rebuild the registry (unless `--no-sync-registry`)

**Prerequisites:**
- Artifact storage credentials configured
- Package must be signed (run `build-module.sh` first)

### sync-registry.sh

Rebuilds `registry.json` by scanning artifact storage for all deployed modules. Called automatically by `upload-module.sh` after each upload. Also useful for:
- Recovering from registry corruption
- Validating registry consistency
- Re-syncing after manual storage changes

**Usage:**
```bash
./sync-registry.sh [storage-path]
```

**Arguments:**
| Argument | Description |
|----------|-------------|
| `storage-path` | Optional artifact storage location (default: `$ARTIFACTS_STORAGE` or `dethernety-artifacts`) |

**What it does:**
1. Lists all `manifest.json` files in artifact storage under `modules/`
2. Parses each manifest to extract module metadata
3. Rebuilds registry with all discovered versions
4. Uploads the rebuilt `registry.json`

**Prerequisites:**
- Artifact storage credentials configured
- `jq` installed for JSON processing

### GitHub Actions Workflow

```yaml
# .github/workflows/release-module.yml
name: Release Module

on:
  push:
    tags:
      - 'module/*/v*'

permissions:
  contents: read
  id-token: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - name: Parse tag
        id: parse
        run: |
          TAG="${GITHUB_REF#refs/tags/}"
          echo "module_name=$(echo "$TAG" | cut -d'/' -f2)" >> $GITHUB_OUTPUT
          echo "version=$(echo "$TAG" | cut -d'/' -f3 | sed 's/^v//')" >> $GITHUB_OUTPUT

      - uses: actions/checkout@v4
      - uses: sigstore/cosign-installer@v3

      # Configure artifact storage credentials (implementation-specific)
      # - name: Configure credentials
      #   ...

      - name: Build, sign, and upload
        env:
          MODULE: ${{ steps.parse.outputs.module_name }}
          CI: true
        run: |
          ./build-n-deploy/scripts/modules/build-module.sh "$MODULE"
          ./build-n-deploy/scripts/modules/upload-module.sh "$MODULE"
```

### Manual Release

```bash
# Build and sign (opens browser for OIDC authentication)
./build-n-deploy/scripts/modules/build-module.sh mitre-attack-analysis

# Upload and update registry
./build-n-deploy/scripts/modules/upload-module.sh mitre-attack-analysis

# Or build without signing (for local testing)
./build-n-deploy/scripts/modules/build-module.sh --no-sign mitre-attack-analysis
```

Both CI and manual releases produce signed packages. The difference is the identity in the certificate:
- **CI**: `https://github.com/dether-net/dethernety/.github/workflows/release-module.yml@refs/tags/*`
- **Manual**: Personal identity (e.g., `user@example.com` via Google/GitHub/Microsoft OIDC)

## Module Management Architecture

Module operations are triggered through a secure request flow that connects the external API to the host-resident module management service.

### Request Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       MODULE MANAGEMENT                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Client (Frontend / CLI)                                                    │
│      │                                                                      │
│      │ POST /api/modules { name, version }                                  │
│      │ Header: Authorization: Bearer <JWT>                                  │
│      ▼                                                                      │
│  ┌──────────────────────┐                                                   │
│  │   API Gateway /      │  ← JWT validation                                 │
│  │   Reverse Proxy      │  ← SSL termination                                │
│  └──────────┬───────────┘                                                   │
│             │                                                               │
│             │ HTTP (internal)                                               │
│             ▼                                                               │
│  ┌──────────────────────┐                                                   │
│  │  module-management   │  ← Executes module operations                     │
│  │  service (Go, :8080) │                                                   │
│  └──────────────────────┘                                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Security Layers

| Layer | Security Control | Purpose |
|-------|-----------------|---------|
| API Gateway / Reverse Proxy | JWT authorizer | Authenticate users, reject invalid tokens |
| Reverse Proxy | SSL termination | Encrypt traffic in transit |
| Reverse Proxy → service | localhost / internal network only | Module management service not publicly exposed |

## Module Management Service API

The module management service runs on the host and handles local module operations. Available modules listing and entitlement checking are handled by the deployment service.

**Async Installation**: Module installation runs asynchronously. The `POST /modules` endpoint returns immediately with a job ID, and clients poll for status.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/modules` | List installed modules |
| `GET` | `/api/modules/{name}` | Get module status |
| `POST` | `/api/modules` | Install a module (async, returns job ID) |
| `PUT` | `/api/modules/{name}` | Upgrade a module |
| `DELETE` | `/api/modules/{name}` | Uninstall a module |
| `GET` | `/api/modules/jobs` | List all installation jobs |
| `GET` | `/api/modules/jobs/{id}` | Get job status and progress |

### Install Request

```json
POST /api/modules
{
  "name": "mitre-attack-analysis",
  "version": "1.2.0"
}
```

### Install Response (HTTP 202 Accepted)

```json
{
  "jobId": "a1b2c3d4e5f6g7h8",
  "message": "Installation of module 'mitre-attack-analysis' started"
}
```

### Poll Job Status

```json
GET /api/modules/jobs/a1b2c3d4e5f6g7h8

{
  "id": "a1b2c3d4e5f6g7h8",
  "moduleName": "mitre-attack-analysis",
  "version": "1.2.0",
  "status": "running",
  "progress": 75,
  "currentStep": "data_ingestion",
  "stepDetail": "Starting data ingestion",
  "createdAt": "2024-12-18T10:30:00Z",
  "startedAt": "2024-12-18T10:30:01Z"
}
```

### Job Status Values

| Status | Description |
|--------|-------------|
| `pending` | Job created, waiting to start |
| `running` | Installation in progress |
| `completed` | Installation successful |
| `failed` | Installation failed (check `error` field) |

### Progress Steps

| Step | Progress | Description |
|------|----------|-------------|
| `download` | 5-25% | Downloading package from artifact storage |
| `verify` | 25-35% | Verifying Sigstore signature |
| `extract` | 35-45% | Extracting package |
| `validate` | 45-50% | Validating manifest |
| `dependencies` | 50-55% | Resolving dependencies |
| `pre_install` | 55-60% | Running pre-install script |
| `install` | 60-75% | Installing components |
| `data_ingestion` | 75-85% | Executing Cypher/SQL scripts |
| `restart` | 85-90% | Restarting services |
| `post_install` | 90-95% | Running post-install script |
| `complete` | 100% | Installation complete |

### Completed Job Response

```json
{
  "id": "a1b2c3d4e5f6g7h8",
  "moduleName": "mitre-attack-analysis",
  "version": "1.2.0",
  "status": "completed",
  "progress": 100,
  "currentStep": "complete",
  "stepDetail": "Installation complete",
  "createdAt": "2024-12-18T10:30:00Z",
  "startedAt": "2024-12-18T10:30:01Z",
  "completedAt": "2024-12-18T10:35:30Z",
  "result": {
    "moduleName": "mitre-attack-analysis",
    "version": "1.2.0",
    "installedPath": "/var/data/dethernety/modules/mitre-attack-analysis"
  }
}
```

Jobs are automatically cleaned up after 1 hour (configurable via `DefaultJobTTL`).

## Implementation Notes

### Module Management Service Responsibilities

The module management service (Go) extends its existing patterns to handle module operations:

| Responsibility | Approach |
|---------------|----------|
| Async installation | In-memory job store with goroutines |
| Progress tracking | `ProgressReporter` interface with job updates |
| Package verification | Sigstore cosign SDK (not CLI) |
| Package extraction | Go `archive/tar` + `compress/gzip` |
| Config merging | Go `encoding/json` with atomic writes |
| Lifecycle hooks | SSH → `podman run` on host |
| Service restarts | Existing SSH → `systemctl` pattern |
| State tracking | `installed-modules.json` (atomic writes) |

### New Components

| Component | Purpose |
|-----------|---------|
| `internal/module/` | Module installation, verification, config merging |
| `internal/job/` | Async job store with progress tracking |
| `internal/handler/modules.go` | HTTP endpoints for module CRUD and job status |
| `apps/script-runner/` | Container image for isolated lifecycle script execution |

### Script Runner Container

A minimal container image for executing lifecycle scripts in isolation:

| Property | Value |
|----------|-------|
| Base image | `alpine:3.x` |
| Default tools | BusyBox (`sed`, `awk`, `grep`, `ash`, etc.) |
| Added packages | `bash`, `jq` |
| User | Non-root (UID 1000) |
| Build | Part of CI/CD build pipeline (`dethernety-script-runner`) |

The container is invoked via `podman run` with security constraints (see Execution Safety).

### Sudoers Extension

The `mgmt-restart` user needs additional permissions for module operations. These should be added to the butane sudoers configuration:

```
# Existing permissions (already in butane)
mgmt-restart ALL=(root) NOPASSWD: /usr/bin/systemctl restart dethernety.service
mgmt-restart ALL=(root) NOPASSWD: /usr/bin/systemctl restart analysis.service
mgmt-restart ALL=(root) NOPASSWD: /usr/bin/systemctl status dethernety.service
mgmt-restart ALL=(root) NOPASSWD: /usr/bin/systemctl status analysis.service
mgmt-restart ALL=(root) NOPASSWD: /usr/bin/systemctl is-active dethernety.service
mgmt-restart ALL=(root) NOPASSWD: /usr/bin/systemctl is-active analysis.service

# Additional permissions for module operations (to be added)
mgmt-restart ALL=(root) NOPASSWD: /usr/bin/systemctl restart analysis-build.service
mgmt-restart ALL=(root) NOPASSWD: /usr/bin/systemctl status analysis-build.service
mgmt-restart ALL=(root) NOPASSWD: /usr/bin/systemctl is-active analysis-build.service

# Script runner execution (lifecycle hooks)
mgmt-restart ALL=(root) NOPASSWD: /usr/bin/podman run --rm --network=none --read-only --cap-drop=ALL *
```

### Dependencies

Add to `go.mod`:
- `github.com/sigstore/cosign/v2` - Package signature verification
- Artifact storage SDK (implementation-specific, e.g., cloud object storage or HTTP client)

## Security Considerations

### Package Integrity

- **Sigstore/cosign signature**: Required. Both CI and manual releases use keyless OIDC signing, generating `package.tar.gz.sig` (signature) and `package.tar.gz.pem` (certificate with signer identity).
- **Allowed identities**:
  - **CI workflow**: `https://github.com/dether-net/dethernety/.github/workflows/release-module.yml@refs/tags/*` (issuer: `token.actions.githubusercontent.com`)
  - **Manual releases**: Configured personal identities (e.g., `admin@example.com`) (issuer: `accounts.google.com`, `github.com`, etc.)
- **Verification flow**:
  1. Download `package.tar.gz.sig`, `package.tar.gz.pem`, and `package.tar.gz`
  2. Extract identity from certificate and verify against allowlist
  3. Verify cosign signature:
     ```bash
     # CI release verification
     cosign verify-blob \
       --certificate-identity "https://github.com/dether-net/dethernety/.github/workflows/release-module.yml@refs/tags/*" \
       --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
       --certificate package.tar.gz.pem \
       --signature package.tar.gz.sig \
       package.tar.gz

     # Manual release verification (personal identity)
     cosign verify-blob \
       --certificate-identity "admin@example.com" \
       --certificate-oidc-issuer "https://accounts.google.com" \
       --certificate package.tar.gz.pem \
       --signature package.tar.gz.sig \
       package.tar.gz
     ```
  4. Proceed with installation only if verification passes
- **Identity allowlist**: The module management service maintains a list of trusted signer identities (workflow + personal). Configured via environment or config file.
- **No key management**: Signatures are identity-based, not key-based. No rotation needed.
- **Transparency log**: All signatures are recorded in Sigstore's public Rekor transparency log for auditability.

### Execution Safety

Lifecycle scripts run in an isolated Podman container for security:

- **Container isolation**: Scripts execute in a dedicated `dethernety-script-runner` container image
- **Limited mounts**: Only necessary directories are mounted:
  - `/var/data/dethernety/staging/{module}` (read-only) - extracted package
  - `/var/data/dethernety/modules` - dethernety modules (for install/remove)
  - `/var/data/dethernety/analysis/graphs` - langgraph graphs (for install/remove)
- **No network access**: Container runs with `--network=none`
- **Timeout enforcement**: 60s default, configurable per-script
- **Non-root execution**: Scripts run as unprivileged user inside container
- **Read-only root filesystem**: Container runs with `--read-only`
- **No capabilities**: Container runs with `--cap-drop=ALL`

### Access Control

- Artifact storage access policy restricts write access to CI/CD
- Read access via authenticated requests or time-limited URLs
- Entitlement checking at artifact API level

## Migration Path

### From Docker-Baked Modules

1. Build existing modules into package format
2. Upload to artifact storage
3. Update container images to not include modules
4. Install modules via module management service on first boot

### Existing Deployments

1. Module management service checks for modules on startup
2. If `installed-modules.json` missing, assume fresh install
3. Install default/required modules for the deployment

## Appendix

### A. Example Modules

#### analysis-core (Base)
Contains shared utilities for all analysis graphs.

#### mitre-attack-analysis (Extension)
MITRE ATT&CK framework integration and analysis.

#### jira-integration (Extension)
JIRA issue tracking integration.

### B. Version Constraint Syntax

Uses npm-style semver constraints:
- `"1.2.0"` - Exact version
- `">=1.0.0"` - Minimum version
- `"^1.2.0"` - Compatible with 1.x.x
- `"~1.2.0"` - Patch-level changes only
- `"*"` - Any version

### C. Environment Variables

#### Dethernety / Analysis

| Variable | Description | Default |
|----------|-------------|---------|
| `CUSTOM_MODULES_PATH` | Dethernety modules directory | `custom_modules` |
| `GRAPHS_CONFIG_PATH` | Graph runtime configuration file | `/app/graphs.config.json` |
| `LANGGRAPH_GRAPHS_PATH` | Analysis graphs directory | `/app/graphs` |

#### Module Management Service

| Variable | Description | Default |
|----------|-------------|---------|
| `MODULES_STAGING_PATH` | Staging directory | `/var/data/dethernety/staging` |
| `MODULES_DATA_PATH` | Data files directory (for LOAD CSV) | `/var/data/dethernety/data` |
| `MODULES_MANIFESTS_PATH` | Manifest backups directory | `/var/data/dethernety/manifests` |
| `ARTIFACTS_STORAGE` | Artifact storage location for module packages | `dethernety-artifacts` |
| `ALLOWED_SIGNER_IDENTITIES` | JSON array of trusted OIDC identities | (required) |

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [README.md](./README.md) | Module system architecture overview |
| [DT_MODULE_INTERFACE.md](./DT_MODULE_INTERFACE.md) | Core DTModule contract and all metadata interfaces |
| [BASE_CLASSES.md](./BASE_CLASSES.md) | Base class implementations (OPA, JSON Logic, LangGraph) |
| [UTILITY_CLASSES.md](./UTILITY_CLASSES.md) | Helper classes (DbOps, OpaOps, LangGraph ops) |
| [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md) | Module development guide |
