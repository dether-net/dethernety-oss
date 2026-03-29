---
name: help
description: Show available Dethereal commands with context-aware suggestions
---

Show context-aware help for the Dethereal threat modeling plugin.

## Steps

1. **Get context-aware suggestions**: Run the helper script to detect current model state:
   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/help-context.js"
   ```
   Parse the JSON output to get `context_line` and `suggestions[]`.

2. **Check for specific command help**: If `$ARGUMENTS` is provided (e.g., the user ran `/dethereal:help create`), show detailed usage for that specific command instead of the full help. Use the command reference below.

3. **Format full help output**:

```
Dethereal — Threat Modeling for Claude Code

Suggested now (<context_line from script>):
  /dethereal:<cmd1>     <reason1>
  /dethereal:<cmd2>     <reason2>
  /dethereal:<cmd3>     <reason3>

Available commands:
  Getting Started:    status, login, help
  Model Viewing:      view
  Modeling:           create, discover, add, remove
  Enrichment:         classify, enrich
  Review & Analysis:  review, surface
  Sync:               sync

Full Workflow:
  /dethereal:threat-model   Guided 11-step process (recommended for new models)

Type /dethereal:help <command> for detailed usage.
```

If the helper script fails or produces no output, omit the "Suggested now" section and show only the command list.

## Command Reference

| Command | Description | Arguments |
|---------|-------------|-----------|
| `status` | Connection status, auth state, local model summary | -- |
| `login` | Authenticate with the Dethernety platform | -- |
| `help` | This help text | `[command]` |
| `view` | Display model summary | `[model-path] [--format yaml\|json\|tree]` |
| `create` | Create a new threat model | `[description or template]` |
| `discover` | Auto-discover infrastructure from codebase | `[scope] [path]` |
| `add` | Add components, boundaries, flows, or data items | `[element description]` |
| `remove` | Remove elements with dependency checking | `[element reference]` |
| `classify` | Assign classes to unclassified elements with crown jewel tagging | `[--type components\|flows\|boundaries\|data-items]` |
| `enrich` | Populate security attributes, credentials, and monitoring tools | `[tier1\|all\|pick] [--focus credentials\|monitoring\|compliance]` |
| `review` | Quality dashboard with score breakdown, gap analysis, and readiness assessment | `[directory-path] [--structure-only]` |
| `surface` | Attack surface summary with component breakdown, trust boundary crossings, and control gap analysis | `[directory-path]` |
| `sync` | Push/pull model to/from platform, sync status | `push\|pull\|status [directory-path]` |
| `threat-model` | Guided end-to-end threat modeling workflow — scope through validation and sync | `[system description or model path]` |
