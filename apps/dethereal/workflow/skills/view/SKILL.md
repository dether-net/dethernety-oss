---
name: view
description: Show a threat model — its boundaries, components, data flows and data items, with its state and quality
argument-hint: "[model-path] [--format tree|json|yaml]"
---

Show a threat model, read-only. Arguments: {{args}}

{{include shared/core-rules.md}}

{{include shared/model-resolution.md}}

## Show the model

1. **The model:** a path in the arguments, or the Model Resolution Protocol above.
2. **The format:** `--format tree`, `json` or `yaml` from the arguments; `tree` when none is given.
3. **Read** `manifest.json` (name, description, modules), `structure.json` (boundaries and components), `dataflows.json` and `data-items.json` from disk.
4. **State, quality and sync** come from the tools, never from the files under `.dethereal/`:
   - {{tool:workspace_status}} with `directory_path`: `model.displayState` (or `state`), `model.qualityScore`, and `sync` (`platformModelId`, `lastPushAt`, `lastPullAt`, `status`);
   - for the tree's quality lines, {{tool:validate_model_json}} with `action: 'quality'`, `detail: 'summary'` and the directory: `quality_score`, `label` and each factor's value and weight.

   What a tool cannot tell, the view leaves out; nothing is guessed.

### Tree (the default)

The model name from `manifest.json` heads the tree — never the internal "default boundary" label; the default boundary's children are the top-level entries. Nested boundaries use tree-drawing characters. Each component shows its type in brackets and its class name in parentheses when it has one:

```
Production Stack (56/100 quality, ENRICHING)

├── Internet Zone
│   └── [EXTERNAL_ENTITY] End Users
├── DMZ
│   └── [PROCESS] Web Server (classified: Web Application)
└── Internal Network
    └── Data Tier
        ├── [STORE] Database (classified: PostgreSQL)
        └── [STORE] Cache (classified: Redis)

Data flows (3):
  1. End Users → Web Server: HTTP requests
  2. Web Server → Database: SQL queries
  3. Web Server → Cache: cache lookups

Data items (2):
  • User Credentials (classified: PII)
  • Session Tokens (classified: Credentials)

Quality: 56/100 (In Progress) — how complete the model is, not how secure the system is
  Component classification   60%
  Attribute completion       40%
  …one line per factor

Sync: last pushed 2h ago | platform model id <id>   (or: never synced)
```

### JSON

The model as one formatted JSON object: `manifest`, `structure`, `dataFlows` and `dataItems` as read from the files.

### YAML

The same object as YAML. JSON stays the stored format; YAML is a display convenience only.
