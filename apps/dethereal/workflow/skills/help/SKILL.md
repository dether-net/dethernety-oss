---
name: help
description: List the Dethereal commands, with suggestions that fit the current model
argument-hint: "[command]"
---

Help for the Dethereal threat-modeling commands. Arguments: {{args}}

{{include shared/core-rules.md}}

## A named command

With a command name in the arguments (`create`, `sync`, …), show only its row from the command list below — its description and arguments — and stop.

## The full help

1. Call {{tool:workspace_status}} (no arguments). It returns `contextLine` (a one-line summary of the first model, or null) and up to three `suggestions`, each a `command` name and a `reason`. If the call fails or returns no suggestions, leave the "Suggested now" block out.
2. Show:

```
Dethereal — threat modeling

Suggested now (<contextLine>):
  <command 1>   <reason 1>
  <command 2>   <reason 2>
  <command 3>   <reason 3>

Getting started:    {{cmd:status}}, {{cmd:login}}, {{cmd:help}}
Viewing:            {{cmd:view}}
Modeling:           {{cmd:create}}, {{cmd:discover}}, {{cmd:add}}, {{cmd:remove}}
Enrichment:         {{cmd:classify}}, {{cmd:enrich}} (controls: {{cmd:enrich}} --focus controls)
Review & analysis:  {{cmd:review}}, {{cmd:surface}}
Sync:               {{cmd:sync}}

Full workflow:      {{cmd:threat-model}} — the guided process, recommended for a new model

{{cmd:help}} <command> shows one command's details.
```

Write each suggestion's `command` the way the command list spells that command.

## Command list

| Command | What it does | Arguments |
|---|---|---|
| {{cmd:status}} | Connection, sign-in and the local models | `[show models <control id> [directory-path]]` |
| {{cmd:login}} | Sign in to the Dethernety platform | `[--new]` |
| {{cmd:help}} | This help | `[command]` |
| {{cmd:view}} | Show a model: boundaries, components, flows, data items | `[model-path] [--format tree\|json\|yaml]` |
| {{cmd:create}} | Create a new threat model | `[description or template] [--full]` |
| {{cmd:discover}} | Discover infrastructure from the codebase | `[model path] [--scan <directory or file>]` |
| {{cmd:add}} | Add components, boundaries, flows or data items | `[element description]` |
| {{cmd:remove}} | Remove elements, checking what depends on them | `[element reference]` |
| {{cmd:classify}} | Assign classes, with crown-jewel tagging | `[--type components\|flows\|boundaries\|data-items]` |
| {{cmd:enrich}} | Security attributes, credentials, monitoring — and controls with `--focus controls` | `[all\|priority\|pick] [--focus credentials\|monitoring\|compliance\|controls] [--pick <element-id>]` |
| {{cmd:review}} | Gates, quality breakdown, gaps and readiness (read-only) | `[directory-path] [--structure-only]` |
| {{cmd:surface}} | Attack surface: components, boundary crossings, control coverage (read-only) | `[directory-path]` |
| {{cmd:sync}} | Push to or pull from the platform, sync status, control-library recovery | `push\|pull\|status\|promote-external-edit\|tombstone\|repair-wal [directory-path]` |
| {{cmd:threat-model}} | The guided end-to-end workflow, from scope to sync | `[system description or model path] [--full-scan] [--full\|--quick]` |
