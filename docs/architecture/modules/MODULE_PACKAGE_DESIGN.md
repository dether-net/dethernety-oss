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
| Versioning | SemVer | Industry standard; `{name}-{version}.tar.gz` |
| Graph runtime | Graph runtime server | Self-hosted, no vendor lock-in, config-driven graph loading |
| Shared code | Base modules | Modules can depend on other modules |
| Version coexistence | Replace only | No multiple versions of the same module |
| Failure handling | Rollback | Atomic installation with rollback on failure |
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
│   ├── *.cypher                  # Cypher scripts (executed alphabetically at install)
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
| `tags` | array | No | Categorization tags |
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

## Distribution

The open-source modules are distributed as signed GitHub release assets attached to the platform's own `v*` release tag. Each asset carries a single Sigstore `.bundle`, verified against an **exact** signer identity (never a glob), and a signed `modules.json` index lists the set for that release. The signing identity is `https://github.com/dether-net/dethernety-oss/.github/workflows/release.yml@refs/tags/v<version>`.

How a particular deployment fetches, installs, and manages modules on a host is deployment-specific and out of scope for this document, which defines the package format and its integrity guarantees.

## Security Considerations

### Package Integrity

- **Sigstore/cosign signature**: Required. Keyless OIDC signing; the current preference is a single Sigstore `.bundle` (signature + certificate + Rekor inclusion proof). The `.sig` + `.pem` pair is retained only for legacy compatibility.
- **Allowed identities**: an allowlist of trusted signer identities (a CI workflow identity, and any configured personal identities for manual releases). Verification extracts the identity from the certificate and checks it against the allowlist.
- **Verification flow**:
  1. Download the package and its signature material (`.bundle`, or the legacy `.sig` + `.pem`).
  2. Verify the cosign signature, **chaining the certificate to the Fulcio root and checking the Rekor inclusion proof** — never against the public key embedded in the bundle's own certificate. Use a maintained sigstore implementation (`sigstore-go`, or the `cosign` binary); a hand-rolled bundle parser that reads the identity out of a certificate and then verifies against that same certificate's key proves nothing, because a self-signed certificate carrying an allowlisted identity would pass.
  3. Match the signer identity against the allowlist. **cosign's `--certificate-identity` matches the SAN exactly — `*` is a literal, not a glob.** To accept a family of tags, use `--certificate-identity-regexp` with an anchored pattern; to pin one release, use `--certificate-identity` with the concrete tag:
     ```bash
     # Pattern (regexp — note the flag): any tagged release of this workflow
     cosign verify-blob \
       --bundle package.tar.gz.bundle \
       --certificate-identity-regexp '^https://github\.com/<org>/<repo>/\.github/workflows/<workflow>\.yml@refs/tags/v' \
       --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
       package.tar.gz

     # Exact pin (preferred when the release version is known — no pattern surface):
     cosign verify-blob \
       --bundle package.tar.gz.bundle \
       --certificate-identity "https://github.com/<org>/<repo>/.github/workflows/<workflow>.yml@refs/tags/v<version>" \
       --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
       package.tar.gz
     ```
  4. Proceed with installation only if verification passes.
- **Identity allowlist**: verification checks the signer identity against a list of trusted identities (a CI workflow identity, and any configured personal identities).
- **No key management**: Signatures are identity-based, not key-based. No rotation needed.
- **Transparency log**: All signatures are recorded in Sigstore's public Rekor transparency log for auditability.

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

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [README.md](./README.md) | Module system architecture overview |
| [DT_MODULE_INTERFACE.md](./DT_MODULE_INTERFACE.md) | Core DTModule contract and all metadata interfaces |
| [BASE_CLASSES.md](./BASE_CLASSES.md) | Base class implementations (Rego, LangGraph) |
| [UTILITY_CLASSES.md](./UTILITY_CLASSES.md) | Helper classes (DbOps, LangGraph ops) |
| [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md) | Module development guide |
