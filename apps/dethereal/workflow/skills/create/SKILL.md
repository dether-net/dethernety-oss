---
name: create
description: Create a new threat model from description, template, import, or platform pull
argument-hint: "[description or template] [--full]"
---

Create a new Dethernety threat model. It is built on disk now and published later with {{cmd:sync push}}. Arguments: {{args}}.

{{include shared/core-rules.md}}

**Reference.** Read these files next to this skill before any model file is written, and again after any compaction; if one cannot be read, write no model file and stop. Secret Files before any configuration is read:

{{include shared/secret-files.md as-file}}

{{include shared/guidelines-core.md as-file}}

{{include shared/guidelines-schema.md as-file}}

{{include shared/guidelines-layout.md as-file}}

{{include shared/guidelines-examples.md as-file}}

Create each file with one call of your file-write tool — no scaffolding scripts, no heredocs.

## Entry points

The arguments decide the way in: a description of the system → **Describe**; a path to IaC, configuration or architecture documents → **Import**; "template" or a template name → **Template**; "pull" or a platform model → **Pull**. `--full` is a flag, never part of a description, path or template name; with no other arguments, show the four:

1. **Describe** — tell me about your system and I'll build the model.
2. **Template** — start from a template: web application, API service, or microservices.
3. **Import** — point to Terraform, Kubernetes manifests or architecture documents.
4. **Pull** — fetch an existing platform model into local files.

{{#ask id=create-mode}}How do you want to start the model? (describe / template / import / pull){{/ask}}

- **Import** is discovery: after the scope below (so the model exists), load {{skill:discover}} with the new model's path and `--scan <the path the operator gave>`, follow it, then write the README; discover's footer ends the run, followed on a quick model by the Footer step's `[info]` line. A single document: `--scan` that file.
- **Pull** is the sync skill's: load {{skill:sync}} with `pull` and follow it; it lists the platform models, pulls the chosen one and sets up its local state.

If a skill cannot be loaded, stop and tell the operator.

**A first model.** When `.dethernety/models.json` lists no model yet, this is the operator's first: say in a sentence or two what a threat model captures, and guide a little more at each step.

## Steps

### 1. Scope

{{include shared/scope-interview.md}}

Unless the run has `--full`, that first transition marks the model in the same call: `mode: 'quick'` with it.

### 2. Structure (Describe, Template)

From the description, or the template, propose the components, the trust boundaries and the data flows. Nest the boundaries as the Model Guidelines' boundary hierarchy says — never a flat set. Show them as a table: components (type, name, boundary), boundaries (with their parents) and data flows (source → target: what it carries), then ask:

{{#ask id=create-structure}}Confirm this structure, or adjust specific rows? (confirm / adjust){{/ask}}

Apply the changes and show the table again until the operator confirms. Then write the confirmed elements: `structure.json` (the boundaries and components, with coordinates from the Layout guidelines — boundaries apart with 50px padding, components 150×150 relative to their boundary, flows left to right or top to bottom) and `dataflows.json`. Call {{tool:validate_model_json}}.

### 3. README

{{include shared/readme.md}}

### 4. Footer

```
[done] Model "<name>" created with N components, M data flows. Quality: X/100.
[next] When you're ready: {{cmd:discover}} (scan the codebase for more infrastructure)
```

On a quick model ({{tool:model_state}} `get` shows `mode: 'quick'`), add: `[info] Quick model: {{cmd:threat-model}} continues it; with --full it builds it in full.`

For a first model, add: `Run {{cmd:help}} to see all available commands.`
