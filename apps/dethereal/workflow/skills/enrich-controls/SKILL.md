---
name: enrich-controls
description: The control pass of enrich — start it with enrich --focus controls
argument-hint: "[--focus controls] [directory-path]"
{{#harness claude}}
user-invocable: false
{{/harness}}
---

The control pass of enrich: enforcement, detection and governance controls, then the control library's attributes. Started by `{{cmd:enrich}} --focus controls`; its arguments: {{args}}.

{{include shared/core-rules.md}}

**Every value you write** — control attributes included — has a cited source or the operator's answer: an unknown or declined value stays `null`, a default is proposed and never written unconfirmed, and a field a question decides is written only after its answer.

**Reference.** Read the four files next to this skill now and again after any compaction — Secret Files before any configuration, the Enrichment Invariants before any write; if one cannot be read, stop and tell the operator, and read or write nothing:

{{include shared/secret-files.md as-file}}

{{include shared/enrichment-invariants.md as-file}}

{{include shared/controls-enrichment.md as-file}}

{{include shared/control-library.md as-file}}

{{include shared/model-resolution.md}}

**Relay** — the table kinds, folding, `details` and the stable row ids — is in the file below. Read it before the first table:

{{include shared/relay.md as-file}}

## Steps

1. **Prerequisites.** Resolve the model path (Model Resolution Protocol; none → suggest {{cmd:create}} and stop); read `structure.json`, `dataflows.json`, the scope; {{tool:model_state}} `get`.
2. **Which boundaries.** Count the boundaries without enforcement controls; with more than six, ask `controls-large-model` first. Pass the chosen ones to the agent, crown-jewel boundaries first:

   {{#delegate security-enricher}}Control-pass mode. Model directory: `<model-path>`. Boundaries, in order: <the chosen boundaries>. Run the control pass for them — enforcement, then detection and governance — and return every proposal table in its format, with, per element, the ControlClasses you bound and the candidates you did not, and why. Write nothing. If your turns run short, stop after a complete boundary and list the ones left.{{/delegate}}

3. **Each table it returns** is a proposal: show it whole (never a count), credential material as `[REDACTED]`; ask its question below, then write the boundary's confirmed controls (Persistence). Start it again for boundaries it left, or the rest after `controls-continue`. Controls the operator adds: Path Selection. No state transition.
4. **The control library**, when a `controls[]` entry has a platform id: pull and find the sparse classes (Control Library Attribute Enrichment, steps 1–2), then the coverage table:

   {{#ask id=control-library-sparse}}Enrich the sparse attributes of these Controls now? (yes / pick / skip){{/ask}}

   On `pick`:

   {{#ask id=control-library-pick text}}Which Controls? Give their names or numbers.{{/ask}}

   For each chosen Control, a table of every proposed key (value and `path:line`, or "ask") and its `assignedModelCount` — an edit changes every model using it:

   {{#ask id=control-library-edits text}}Give the values for the "ask" rows and confirm or correct the proposed ones, by row; say "not sure" for a row you cannot answer — it stays empty.{{/ask}}

   Apply each change through the engine action; then annotate, sweep for drift, check integrity (steps 3–4).
5. **Validate and footer.** Call {{tool:validate_model_json}} and render the footer from the Control Enrichment Instructions' Footer section.

{{include shared/controls-gates.md}}
