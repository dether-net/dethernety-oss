# ADR-014: Triage in the open-source workflow, with a shared condition-group evaluator

**Status:** Accepted
**Date:** 2026-11-12

**Related:** [ADR-007: Finding disposition lifecycle](007-finding-disposition-lifecycle.md), [ADR-010: Finding affirmation lifecycle](010-finding-affirmation-lifecycle.md), [ADR-004: Executable module system](004-executable-module-system.md)

## Context

The platform derives exposures from policies, and the operator decides about each one with a disposition ([ADR-007](007-finding-disposition-lifecycle.md)) or an affirmation ([ADR-010](010-finding-affirmation-lifecycle.md)). A pushed model can carry many exposures. Deciding them one by one in the web UI is slow, and the evidence for each decision sits in the repository the model was built from, which the platform does not see.

**Triage** is the Dethereal workflow for that review: grouped, evidence-grounded proposals that the operator reviews, and dispositions written only after the operator approves them. It needs three things:

- **A condition-group evaluator.** To say why a rule tripped on an element, and what would make it stop, triage evaluates the knowledge-graph rule's `conditionGroups` (an OR of AND groups of `{ attribute, operator, value? }` predicates) against the element's attributes. The rules are compiled to Rego, so the evaluator must give each operator the meaning of its compiled Rego expression. The detail that decides most answers is absence: a Rego `not …` succeeds on a missing attribute, and every other operator fails on one.
- **One honesty rule for remediation copy.** Triage's remediation task list may say what a change *would* change, never that it fixes, closes or reduces a finding.
- **A gate on its writes.** A disposition changes what the platform shows as live risk, so the operator must see exactly what is written before it is.

More than one consumer needs the same evaluator. Triage's `get_kg_chain` `evaluate` is one. Any other tool that explains a knowledge-graph rule against an element, whether a module, a platform service or a third-party client, must give the same answer for the same element; two copies would drift on the absence rule and disagree about one finding. The same holds for the honesty rule: every writer of remediation copy must refuse the same terms.

The knowledge graph itself is optional: a deployment may have no knowledge-graph module loaded, or one that holds no data yet.

## Decision

### Triage's tools join Dethereal's one MCP server

Triage is a skill of the Dethereal workflow (`triage`) with two read-only agents (`triage-analyst`, `kg-cross-examiner`). Its tools are part of the one Dethereal server, under its one tool manifest:

| Tool | Approval | Role |
|------|----------|------|
| `triage_review` | `auto`, main session only | The operator's review: each reply read as one command, recorded before it takes effect |
| `manage_dispositions` | `prompt`, `requiresUser` | `prepare` and `commit`: the two-phase write gate |
| `get_kg_chain` | `auto` | Knowledge-graph evidence: `probe`, `chain`, `evaluate` |
| `get_class_guide` | `auto` | A class's authored guidance for the attributes asked about |

`search_mitre_attack` gains `lookup` and `match`, and `query_exposures` gains `list_model` and `evidence`. Triage therefore shares the server's path confinement, session handling, redaction and per-harness approval configuration, and needs no install step of its own.

Every write passes the two-phase gate: `prepare` checks a closed review against the platform and returns the lines the operator is shown; `commit` takes those lines back exactly, records the operator's `yes` first, reads the targets again, and writes only if none changed. See [MCP_ARCHITECTURE.md → The two-phase gate](../dethereal/MCP_ARCHITECTURE.md#the-two-phase-gate).

### The evaluator and the honesty rule become pure dt-module subpaths

`@dethernety/dt-module/condition-groups` holds the operator vocabulary and the evaluator; `@dethernety/dt-module/remediation-honesty` holds the forbidden terms, the citation line and the lint. Each imports nothing outside its own files and does no I/O, so any consumer can bundle one without taking dt-module's other dependencies, and neither is exported from the package root. See [UTILITY_CLASSES.md → Pure subpaths](../modules/UTILITY_CLASSES.md#pure-subpaths-condition-groups-and-remediation-honesty).

### The workflow is generated for three harnesses

The `triage` skill and its agents are written once in Dethereal's harness-neutral workflow and rendered for Claude Code, Codex and OpenCode, like every other skill. The generator gained a batch form of delegation for the agents' batches, and a main-session-only list that keeps `triage_review` out of every agent's grant. See [PLUGIN_ARCHITECTURE.md → Main-Session-Only Tools](../dethereal/PLUGIN_ARCHITECTURE.md#main-session-only-tools).

### Triage works without the knowledge graph, and says so

`get_kg_chain` `probe` reports the graph present, absent (`module_not_loaded`, `not_entitled`, `no_data`) or, when it cannot tell, a failure: an unknown state is never read as absent. Without the graph, triage works from the platform's findings and the source files, with no cross-examination and no remediation task list. The marker `[no knowledge-graph evidence]` comes on every answer that leaves a proposal without graph evidence because the graph could not be used or read: `kg_absent`, a failed probe, a latched answer and `kg_chain_unread`. A class with no rules (`covered: false`) and a rule the class lacks (`rule_found: false`) carry no marker. The texts the operator is shown about the graph are fixed in one file. A graph that stops answering during a run latches the server process until the next probe. See [MCP_ARCHITECTURE.md → The knowledge-graph latch](../dethereal/MCP_ARCHITECTURE.md#the-knowledge-graph-latch).

## Consequences

**Positive:**
- **One answer per rule and element.** Every consumer of the subpaths evaluates a rule as the compiled Rego does, and refuses the same remediation terms.
- **Triage comes with the workflow.** Updating Dethereal brings the `triage` command and its two agents on every harness, with each harness's approvals written from the same tool manifest as the other tools'.
- **No write without the operator's view of it.** The plan's lines are the display, `commit` must pass them back unchanged, and a model that moved since `prepare` writes nothing.
- **Honest without the graph.** A deployment without the knowledge graph gets triage, labelled as such, instead of no triage or a silent gap.

**Negative:**
- **New public API in dt-module.** The subpaths must stay faithful to the compiled Rego, a contract their tests hold. `regex_match` is not evaluated: a group that uses it is unevaluable.
- **A larger tool surface.** The server lists 33 tools by default, 34 with the settlement on; every listed tool costs its description on every request.
- **The server cannot tell who answered.** The operator's `yes` and the model's look the same to the server; the harness's approval prompt for `commit` is the gate.
- **Built-in sub-agents.** A harness's own sub-agents, which are not Dethereal's agents, can reach `triage_review`. They write nothing without the `commit` prompt.
- **No cross-process lock.** Two server processes committing to one model do not hold each other back; each re-reads the model before writing.
- **A capable model is assumed.** Triage's proposals are only as good as the model that makes them; nothing pins one.

## Rejected options

| Option | Why rejected |
|---|---|
| Keep the evaluator inside Dethereal only | Every other consumer would carry its own copy, and the copies would drift on the absence rule and on alias handling. A pure subpath costs one package export and gives one answer everywhere |
| Deliver triage as an optional add-on | Its writes need the approval manifest, path confinement and per-harness install path the Dethereal server already has; an add-on would duplicate them, and triage would not be part of the open-source workflow |

## References

- [MCP_ARCHITECTURE.md → Triage Tools](../dethereal/MCP_ARCHITECTURE.md#triage-tools) — the tools, the gate, the record and the latch
- [PLUGIN_ARCHITECTURE.md → Agent Definitions](../dethereal/PLUGIN_ARCHITECTURE.md#agent-definitions) — the `triage-analyst` and `kg-cross-examiner` agents
- [UTILITY_CLASSES.md → Pure subpaths](../modules/UTILITY_CLASSES.md#pure-subpaths-condition-groups-and-remediation-honesty) — the evaluator and the honesty rule
- [Glossary → Finding disposition](../../GLOSSARY.md#finding-disposition) — dispositions, their kinds, stale dispositions and supersede
- [Managing Findings](../../user/MANAGING_FINDINGS.md) — what dispositions mean in the platform
