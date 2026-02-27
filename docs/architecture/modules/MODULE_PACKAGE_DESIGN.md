# Dethernety Module Package System

## Overview

This document describes the design of Dethernety's module package system - a standardized way to distribute, install, and manage modules across customer deployments.

A module package is a **deployment unit** that can contain multiple components:
- Dethernety backend modules (JavaScript)
- LangGraph analysis graphs (Python)
- Database ingestion data (Cypher)
- Lifecycle scripts (shell)
- Arbitrary files

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Package format | `tar.gz` | Handle packages as atomic units; simple, compressed |
| Versioning | SemVer | Industry standard; `modules/{name}/{version}/package.tar.gz` |
| Graph runtime | Aegra (or LangGraph Studio) | Self-hosted, no vendor lock-in, config-driven graph loading |
| Shared code | Base modules | Modules can depend on other modules |
| Version coexistence | Replace only | No multiple versions of the same module |
| Installation trigger | Management service | EC2-resident service pulls and installs modules |
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
│       └── frontend/             # Optional UI components
│           └── bundle.js         # Vite-bundled Vue.js
│
├── langgraph/                    # LangGraph graphs (Python) - optional
│   ├── graphs.json               # Graph registration fragment
│   └── {graph_name}/             # One directory per graph
│       ├── graph.py              # Main graph definition
│       ├── nodes.py              # Node implementations
│       ├── state.py              # State definitions
│       ├── requirements.txt      # Python dependencies (optional)
│       └── prompts/              # Prompt templates
│
├── data/                         # Database ingestion - optional
│   ├── *.cypher                  # Cypher scripts (executed alphabetically by mgmt service)
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
    { "name": "langgraph-shared-utils", "version": ">=1.0.0" }
  ],

  "lifecycle": {
    "preInstall": "scripts/pre-install.sh",
    "postInstall": "scripts/post-install.sh",
    "preRemove": "scripts/pre-remove.sh",
    "postRemove": "scripts/post-remove.sh",
    "rollback": "scripts/rollback.sh"
  },

  "restarts": ["dethermine-build.service", "dethermine.service", "dethernety.service"]
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

Example: `langgraph-shared-utils` (a utility module)
```
langgraph-shared-utils-1.0.0.tar.gz
├── manifest.json
│   {
│     "name": "langgraph-shared-utils",
│     "version": "1.0.0"
│   }
│
└── langgraph/
    └── shared_utils/
        ├── __init__.py
        ├── llm_response_utils.py
        ├── mermaid_utils.py
        └── neo4j_helper.py
```

Modules that depend on `langgraph-shared-utils` can import from it:

```python
# In mitre-attack-analysis/langgraph/graph.py
from shared_utils import safe_yaml_load_with_validation, Neo4jConnection
from shared_utils.mermaid_utils import generate_mermaid_chart
```

## S3 Storage Layout

```
s3://dethernety-artifacts-{environment}/
│
├── frontend/                     # Frontend builds (existing)
│   └── {git-tag}/
│       └── ...
│
└── modules/                      # Module packages
    │
    ├── registry.json             # Index of all available modules
    │
    ├── langgraph-shared-utils/
    │   └── 1.0.0/
    │       ├── manifest.json          # Extracted from package for quick access
    │       ├── package.tar.gz         # Contains manifest.json + all components
    │       ├── package.tar.gz.bundle  # Sigstore bundle (signature + certificate)
    │       ├── package.tar.gz.sig     # Cosign signature (legacy compatibility)
    │       └── package.tar.gz.pem     # Cosign certificate (legacy compatibility)
    │
    ├── dethermine-core/
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
2. Uploads to S3 and updates registry (`upload-module.sh`)
   - Extracts `manifest.json` from package
   - Uploads all files to S3
   - Updates `registry.json`

This allows the management service to read manifests and verify integrity/authenticity without downloading full packages.

### registry.json

```json
{
  "version": "1",
  "updated": "2024-12-18T10:00:00Z",
  "modules": {
    "langgraph-shared-utils": {
      "displayName": "LangGraph Shared Utilities",
      "versions": ["1.0.0"],
      "latest": "1.0.0",
      "tags": ["langgraph", "utilities", "shared"]
    },
    "mitre-attack-analysis": {
      "displayName": "MITRE ATT&CK Analysis",
      "versions": ["1.0.0", "1.2.0"],
      "latest": "1.2.0",
      "tags": ["security", "mitre", "analysis", "langgraph"]
    }
  }
}
```

**Note**: Pricing and tier information are managed in the billing/entitlement system, not in the registry. This allows business rules to change without modifying technical artifacts.

## EC2 Installation Layout

### EBS Volume Structure

```
/var/data/dethernety/
│
├── modules/                      # Dethernety backend modules
│   └── {module-name}/
│       ├── {ModuleName}Module.js
│       └── *.js
│
├── dethermine/                   # Dethermine/LangGraph data
│   ├── aegra.json                # Merged graph configuration (Aegra runtime config)
│   └── graphs/                   # LangGraph graph code (Python)
│       ├── shared_utils/         # From langgraph-shared-utils module
│       └── {graph_name}/         # From extension modules
│
├── data/                         # Ingested data files (CSVs for LOAD CSV queries)
│   └── {module-name}/
│       └── *.csv
│
├── staging/                      # Temporary extraction area (created by mgmt service)
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
  "langgraph-shared-utils": {
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

### dethermine.container.tpl

```ini
[Container]
# ... existing config ...

# LangGraph graphs volume mount (executed by Aegra runtime)
Volume=/var/data/dethernety/dethermine/graphs:/app/graphs:ro
Volume=/var/data/dethernety/dethermine/aegra.json:/app/aegra.json:ro
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

Module installation runs asynchronously to avoid Lambda/API Gateway timeout constraints. The client receives an immediate response with a job ID and polls for completion.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        MODULE INSTALLATION FLOW (ASYNC)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Management Plane triggers installation                                  │
│     └── POST /api/modules { name, version }                                 │
│                                                                             │
│  2. Management Service creates job, returns immediately (HTTP 202)          │
│     └── Response: { "jobId": "abc123", "message": "Installation started" }  │
│                                                                             │
│  3. Background goroutine starts installation                                │
│     └── Progress reported at each step via job store                        │
│                                                                             │
│  ─────────────────── BACKGROUND INSTALLATION ───────────────────            │
│                                                                             │
│  4. Download package + signature from S3                          [5-25%]   │
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
│     ├── langgraph/*/ → /var/data/dethernety/dethermine/graphs/ (each graph) │
│     ├── langgraph/graphs.json → merge into aegra.json                       │
│     └── data/*.csv → /var/data/dethernety/data/{module}/                    │
│                                                                             │
│ 11. Backup manifest                                                         │
│     └── Copy manifest.json → /var/data/dethernety/manifests/{name}.json     │
│                                                                             │
│ 12. Run data ingestion (if data/*.cypher exists)                  [75-85%]  │
│     └── Management service executes *.cypher against Memgraph via Bolt      │
│     └── Executes *.sql against PostgreSQL (pgvector data)                   │
│                                                                             │
│ 13. Restart affected units (sequentially, in array order)         [85-90%]  │
│     └── dethermine-build.service rebuilds image with new requirements.txt   │
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
5. Report failure to management plane

**Note**: Rollback does not apply to removal failures. If removal fails:
- The management service logs the error and reports partial removal
- Manual intervention may be required to clean up
- The module remains in `installed-modules.json` with a `status: "failed"` flag

### Uninstallation Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       MODULE UNINSTALLATION FLOW                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Management Plane triggers uninstallation                                │
│     └── DELETE /api/modules/{name}                                          │
│                                                                             │
│  2. Management Service (on EC2) receives request                            │
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
│     ├── langgraph/*/ → remove from /var/data/dethernety/dethermine/graphs/  │
│     ├── langgraph/graphs.json → remove entries from aegra.json              │
│     └── data/ → remove from /var/data/dethernety/data/{module}/             │
│                                                                             │
│  7. Restart affected units (sequentially, in array order)                   │
│     └── dethermine-build.service rebuilds image without removed deps        │
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
│ 11. Report success to management plane                                      │
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

## LangGraph Integration

### Runtime Configuration

Aegra uses `aegra.json` to discover and load graphs. The init script creates a default empty configuration:

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

Paths in `graphs.json` are relative to the `aegra.json` location (`/var/data/dethernety/dethermine/`). The management service merges all fragments into the main `aegra.json` configuration file.

## Entitlement (Future)

### Phase 1: Simple S3 Download (Current)

- Direct S3 download with IAM authentication
- No entitlement checking
- All modules accessible to all customers

### Phase 2: Entitlement API

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ENTITLEMENT FLOW                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Management Service requests module                                      │
│     └── GET /api/artifacts/modules/{name}/{version}                         │
│         Header: Authorization: Bearer {customer-jwt}                        │
│                                                                             │
│  2. Artifact API checks entitlement                                         │
│     └── customer_id ∈ entitled_customers(module, version)?                  │
│                                                                             │
│  3. If entitled → Generate pre-signed S3 URL (5 min TTL)                    │
│     If not → 403 Forbidden                                                  │
│                                                                             │
│  4. Management Service downloads using pre-signed URL                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Entitlement Database Schema

```sql
CREATE TABLE module_entitlements (
  customer_id       VARCHAR(64) NOT NULL,
  module_name       VARCHAR(128) NOT NULL,
  version_constraint VARCHAR(32) DEFAULT '*',
  expires_at        TIMESTAMP,
  granted_at        TIMESTAMP DEFAULT NOW(),
  granted_by        VARCHAR(128),
  PRIMARY KEY (customer_id, module_name)
);
```

## Repository Structure

Modules are developed in the monorepo under a top-level `modules/` directory:

```
dethernety/
├── apps/                         # Platform applications
│   ├── dt-ui/
│   ├── dt-ws/
│   ├── dethermine/
│   ├── management-service/
│   └── script-runner/            # Lifecycle script container
│
├── packages/                     # Shared packages
│   └── dt-core/
│
├── modules/                      # Module packages (independently released)
│   ├── langgraph-shared-utils/
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
├── upload-module.sh          # Upload to S3 and sync registry
└── sync-registry.sh          # Rebuild registry from S3 contents
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

Uploads a signed module package to S3 and syncs the registry.

**Usage:**
```bash
./upload-module.sh [--no-sync-registry] <module-name|package.tar.gz> [bucket-name]
```

**Arguments:**
| Argument | Description |
|----------|-------------|
| `--no-sync-registry` | Skip registry sync after upload |
| `module-name` | Module name (finds package in `modules/<name>/dist/`) |
| `package.tar.gz` | Or direct path to a package file |
| `bucket-name` | Optional S3 bucket (default: `$S3_ARTIFACTS_BUCKET` or `dethernety-artifacts`) |

**What it does:**
1. Extracts `manifest.json` from the package
2. Uploads to S3: `manifest.json`, `package.tar.gz`, `.bundle`, `.sig`, `.pem`
3. Calls `sync-registry.sh` to rebuild the registry (unless `--no-sync-registry`)

**Prerequisites:**
- AWS credentials configured (`AWS_PROFILE` or environment variables)
- Package must be signed (run `build-module.sh` first)

### sync-registry.sh

Rebuilds `registry.json` by scanning S3 for all deployed modules. Called automatically by `upload-module.sh` after each upload. Also useful for:
- Recovering from registry corruption
- Validating registry consistency
- Re-syncing after manual S3 changes

**Usage:**
```bash
./sync-registry.sh [bucket-name]
```

**Arguments:**
| Argument | Description |
|----------|-------------|
| `bucket-name` | Optional S3 bucket (default: `$S3_ARTIFACTS_BUCKET` or `dethernety-artifacts`) |

**What it does:**
1. Lists all `manifest.json` files in S3 under `modules/`
2. Parses each manifest to extract module metadata
3. Rebuilds registry with all discovered versions
4. Uploads the rebuilt `registry.json`

**Prerequisites:**
- AWS credentials configured (`AWS_PROFILE` or environment variables)
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
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: eu-central-1

      - name: Build, sign, and upload
        env:
          MODULE: ${{ steps.parse.outputs.module_name }}
          ARTIFACTS_BUCKET: ${{ vars.ARTIFACTS_BUCKET }}
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

## Management Plane Architecture

Module operations are triggered through a secure multi-layer request flow that connects the external API to the EC2-resident management service.

### Request Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          MANAGEMENT PLANE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Client (Frontend)                                                          │
│      │                                                                      │
│      │ POST /api/modules { name, version }                                  │
│      │ Header: Authorization: Bearer <JWT>                                  │
│      ▼                                                                      │
│  ┌──────────────────────┐                                                   │
│  │   API Gateway        │  ← JWT validation (Cognito authorizer)            │
│  │   (Regional)         │                                                   │
│  └──────────┬───────────┘                                                   │
│             │                                                               │
│             │ Lambda proxy integration                                      │
│             ▼                                                               │
│  ┌──────────────────────┐                                                   │
│  │  management-api-     │  ← VPC-attached Lambda                            │
│  │  handler Lambda      │  ← Adds X-Lambda-Secret header                    │
│  └──────────┬───────────┘                                                   │
│             │                                                               │
│             │ HTTPS (VPC internal)                                          │
│             ▼                                                               │
│  ┌──────────────────────┐                                                   │
│  │   nginx (EC2)        │  ← Validates X-Lambda-Secret                      │
│  │   :443 → :8080       │  ← SSL termination                                │
│  └──────────┬───────────┘                                                   │
│             │                                                               │
│             │ HTTP (localhost)                                              │
│             ▼                                                               │
│  ┌──────────────────────┐                                                   │
│  │  management-service  │  ← Executes module operations                     │
│  │  (Go, port 8080)     │                                                   │
│  └──────────────────────┘                                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Security Layers

| Layer | Security Control | Purpose |
|-------|-----------------|---------|
| API Gateway | Cognito JWT authorizer | Authenticate users, reject invalid tokens |
| Lambda | VPC attachment | No public internet exposure |
| Lambda → nginx | X-Lambda-Secret header | Verify request came from Lambda (not direct) |
| nginx | Secret validation | Reject requests without valid secret |
| nginx → service | localhost only | Management service not network-exposed |

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `management-api-handler` | `apps/management-api-handler/` | Lambda proxy that forwards authenticated requests to EC2 |
| `management-service` | `apps/management-service/` | EC2-resident service that executes module operations |

The Lambda acts as a secure bridge between the public API Gateway and the private EC2 instance. It:
1. Receives pre-authenticated requests from API Gateway (JWT already validated)
2. Adds a shared secret header for nginx validation
3. Forwards the request to the EC2 instance via VPC networking
4. Returns the response to the client

**Note**: The Lambda is a generic HTTP proxy using the `ANY /mgmt/{proxy+}` route pattern. New API endpoints (like module operations) are automatically available without Lambda changes.

## Management Service API

The management service runs on EC2 and handles local module operations. Available modules listing and entitlement checking are handled by the management plane.

**Async Installation**: Module installation runs asynchronously to avoid Lambda/API Gateway timeout issues (~30 seconds). The `POST /modules` endpoint returns immediately with a job ID, and clients poll for status.

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
| `download` | 5-25% | Downloading package from S3 |
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

### Management Service Responsibilities

The management service (Go) extends its existing patterns to handle module operations:

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
| Build | Part of ECR build pipeline (`dethernety-script-runner`) |

The container is invoked via `podman run` with security constraints (see Execution Safety).

### Sudoers Extension

The `mgmt-restart` user needs additional permissions for module operations. These should be added to the butane sudoers configuration:

```
# Existing permissions (already in butane)
mgmt-restart ALL=(root) NOPASSWD: /usr/bin/systemctl restart dethernety.service
mgmt-restart ALL=(root) NOPASSWD: /usr/bin/systemctl restart dethermine.service
mgmt-restart ALL=(root) NOPASSWD: /usr/bin/systemctl status dethernety.service
mgmt-restart ALL=(root) NOPASSWD: /usr/bin/systemctl status dethermine.service
mgmt-restart ALL=(root) NOPASSWD: /usr/bin/systemctl is-active dethernety.service
mgmt-restart ALL=(root) NOPASSWD: /usr/bin/systemctl is-active dethermine.service

# Additional permissions for module operations (to be added)
mgmt-restart ALL=(root) NOPASSWD: /usr/bin/systemctl restart dethermine-build.service
mgmt-restart ALL=(root) NOPASSWD: /usr/bin/systemctl status dethermine-build.service
mgmt-restart ALL=(root) NOPASSWD: /usr/bin/systemctl is-active dethermine-build.service

# Script runner execution (lifecycle hooks)
mgmt-restart ALL=(root) NOPASSWD: /usr/bin/podman run --rm --network=none --read-only --cap-drop=ALL *
```

### Dependencies

Add to `go.mod`:
- `github.com/sigstore/cosign/v2` - Package signature verification
- `github.com/aws/aws-sdk-go-v2` - S3 package download

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
- **Identity allowlist**: Management service maintains a list of trusted signer identities (workflow + personal). Configured via environment or config file.
- **No key management**: Signatures are identity-based, not key-based. No rotation needed.
- **Transparency log**: All signatures are recorded in Sigstore's public Rekor transparency log for auditability.

### Execution Safety

Lifecycle scripts run in an isolated Podman container for security:

- **Container isolation**: Scripts execute in a dedicated `dethernety-script-runner` container image
- **Limited mounts**: Only necessary directories are mounted:
  - `/var/data/dethernety/staging/{module}` (read-only) - extracted package
  - `/var/data/dethernety/modules` - dethernety modules (for install/remove)
  - `/var/data/dethernety/dethermine/graphs` - langgraph graphs (for install/remove)
- **No network access**: Container runs with `--network=none`
- **Timeout enforcement**: 60s default, configurable per-script
- **Non-root execution**: Scripts run as unprivileged user inside container
- **Read-only root filesystem**: Container runs with `--read-only`
- **No capabilities**: Container runs with `--cap-drop=ALL`

### Access Control

- S3 bucket policy restricts write access to CI/CD
- Read access via IAM or pre-signed URLs
- Entitlement checking at artifact API level

## Migration Path

### From Docker-Baked Modules

1. Build existing modules into package format
2. Upload to S3 artifacts bucket
3. Update container images to not include modules
4. Install modules via management service on first boot

### Existing Deployments

1. Management service checks for modules on startup
2. If `installed-modules.json` missing, assume fresh install
3. Install default/required modules based on customer tier

## Appendix

### A. Example Modules

#### dethermine-core (Base)
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

#### Dethernety / Dethermine

| Variable | Description | Default |
|----------|-------------|---------|
| `CUSTOM_MODULES_PATH` | Dethernety modules directory | `custom_modules` |
| `AEGRA_CONFIG_PATH` | Aegra runtime configuration file | `/app/aegra.json` |
| `LANGGRAPH_GRAPHS_PATH` | LangGraph graphs directory | `/app/graphs` |

#### Management Service

| Variable | Description | Default |
|----------|-------------|---------|
| `MODULES_STAGING_PATH` | Staging directory | `/var/data/dethernety/staging` |
| `MODULES_DATA_PATH` | Data files directory (for LOAD CSV) | `/var/data/dethernety/data` |
| `MODULES_MANIFESTS_PATH` | Manifest backups directory | `/var/data/dethernety/manifests` |
| `S3_ARTIFACTS_BUCKET` | S3 bucket for module packages | `dethernety-artifacts` |
| `ALLOWED_SIGNER_IDENTITIES` | JSON array of trusted OIDC identities | (required) |

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [OVERVIEW.md](./OVERVIEW.md) | Module system architecture overview |
| [DT_MODULE_INTERFACE.md](./DT_MODULE_INTERFACE.md) | Core DTModule contract and all metadata interfaces |
| [BASE_CLASSES.md](./BASE_CLASSES.md) | Base class implementations (OPA, JSON Logic, LangGraph) |
| [UTILITY_CLASSES.md](./UTILITY_CLASSES.md) | Helper classes (DbOps, OpaOps, LangGraph ops) |
| [module-development.md](./module-development.md) | Module development guide |
