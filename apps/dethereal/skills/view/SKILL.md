---
name: view
description: Display model summary with tree view of boundaries, components, data flows, and quality score
argument-hint: "[model-path] [--format yaml|json|tree]"
---

Display a read-only summary of a Dethernety threat model.

## Steps

1. **Resolve model path**:
   - If `$ARGUMENTS` contains a path, use it
   - Otherwise, read `.dethernety/models.json`:
     - Single model → use it implicitly
     - Multiple models → list them and ask the user to specify
     - No models → show "No models found. Run /dethereal:create to get started." and stop

2. **Parse format argument**: Check `$ARGUMENTS` for `--format yaml|json|tree`. Default is `tree`.

3. **Read model files** from the resolved path:
   - `manifest.json` — model name, description, modules
   - `structure.json` — boundary and component hierarchy
   - `dataflows.json` — data flow connections
   - `data-items.json` — data classification items
   - `.dethereal/quality.json` — quality score (if exists)
   - `.dethereal/state.json` — current state (if exists)
   - `.dethereal/sync.json` — sync status (if exists)

4. **Format output** based on the `--format` argument:

### Tree format (default)

Use the model name from `manifest.json` as the tree header, not the internal "defaultBoundary" label. Render the default boundary's children as top-level entries.

```
Production Stack (56/100 quality, ENRICHING)

├── Internet Zone
│   └── [EXTERNAL_ENTITY] End Users
├── DMZ
│   └── [PROCESS] Web Server (classified: Web Application)
└── Internal Network
    ├── Application Tier
    │   └── [PROCESS] API Server (classified: REST API)
    └── Data Tier
        ├── [STORE] Database (classified: PostgreSQL)
        └── [STORE] Cache (classified: Redis)

Data Flows (5):
  1. End Users → Web Server: HTTP requests
  2. Web Server → API Server: API calls (HTTPS)
  3. API Server → Database: SQL queries
  4. API Server → Cache: Cache lookups
  5. Database → API Server: Query results

Data Items (2):
  • User Credentials (classified: PII)
  • Session Tokens (classified: Credentials)

Quality: 56/100 (In Progress)
  Component classification:  60%  (3/5 classified)
  Attribute completion:      40%  (2/5 with attributes)
  Boundary hierarchy:       100%  (depth ≥ 2, no issues)
  Data flow coverage:        80%  (4/5 connected)
  Data classification:       50%  (1/2 classified)

Sync: last pushed 2h ago | Platform model ID: abc123
```

Show `[type]` prefix for components. Show class name in parentheses if classified. Recursively render nested boundaries with tree-drawing characters.

### JSON format

Output the raw model data as formatted JSON, combining manifest, structure, dataflows, and data-items into a single object.

### YAML format

Convert the combined model data to YAML-style output. Since JSON is the canonical format (D8), this is a display convenience only.
