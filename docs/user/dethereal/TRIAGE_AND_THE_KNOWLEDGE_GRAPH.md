---
title: 'Triage With and Without the Knowledge Graph'
description: 'What the knowledge graph adds to a triage run, and the notices triage shows when the graph cannot be used'
category: 'documentation'
position: 11
navigation: true
tags: ['dethereal', 'triage', 'knowledge-graph', 'evidence', 'notices']
---

# Triage With and Without the Knowledge Graph

[Triage](TRIAGE.md) works on every Dethernety platform. When the platform also serves the Dethernety **knowledge graph**, triage reads each finding's reasoning chain from it: the rule that raised the finding, the conditions that rule checks, and the threats and sources behind it. Without the graph, triage works from the platform's findings and your source files only, and says so in the run header.

For what the knowledge graph is, see [dether.net/modules](https://dether.net/modules).

---

## What Each Regime Gives

| | With the knowledge graph | Without it |
|---|---|---|
| **Evidence** | The platform's record, your local attributes and source files and, per class, the rule's condition groups, the attributes they read, and an evaluation of the rule against each element's attribute values, as of this run | The platform's record, your local attributes and source files |
| **Cross-examination** | The kg-cross-examiner agent challenges every proposal to dispose or supersede a finding the graph covers; an objection makes the group needs-human, with both views shown | None |
| **Remediation task list** | Offered when the run applied at least one affirm, and at least one affirmed group's graph evidence was read before the graph stopped answering (if it did) | Not offered |
| **The marker** | Only on a row the graph could not be read for: see [The Marker](#the-marker) | Every row carries `[no knowledge-graph evidence]` in its Evidence cell |

With the graph, a supersede row also shows `[breaks KG linkage: <corpus ids>]`, and `show <n>` gives the corpus citations of a group.

---

## The Check at the Start of a Run

A default run checks the knowledge graph once, before anything else is read from it. The answer sets the regime for the whole run, and the run header carries its line once; nothing later repeats or rewrites it. A stale sweep (`--stale`) makes no check and has no knowledge-graph line.

### Not available here

When the platform has no knowledge-graph module loaded, or this deployment is not entitled to it, the header shows one line for both:

```
Knowledge graph: not available here. Triage works from the platform's findings and the source files only, so its proposals are less precise, with no cross-examination and no remediation task list. The Dethernety knowledge graph, part of the subscription, adds the reasoning chains behind each finding.
```

### Installed, with no data yet

```
Knowledge graph: installed, but it holds no data yet. This run works from the platform's findings and the source files only.
```

### The status could not be checked

When the check itself fails, the header shows the cause in place of `<cause>`, on one line, with any secret redacted:

```
Knowledge graph: its status could not be checked, so this run does not use it. Cause: <cause>.
```

**An unknown state is never read as absent.** The run goes on without graph evidence, but the notice says the state could not be checked; it does not say the graph is missing. The next run checks again.

### Available

When the graph can be used, the header has no knowledge-graph line.

---

## The Marker

A row carries this mark in its Evidence cell, exactly as written, when the knowledge graph could not be used or read for it:

```
[no knowledge-graph evidence]
```

A row gets it in four cases:

- the graph is not available here, or holds no data yet;
- the check at the start of the run failed;
- the graph stopped answering before the row's group was read;
- the chain of the row's class could not be read.

A graph that answers with nothing for a finding is none of these. A class the graph has no rules for, or a finding whose rule the class does not have, shows no graph evidence and no marker. When such a finding is affirmed, the remediation task list names it under **not derivable**, with the findings affirmed without knowledge-graph coverage.

---

## When the Graph Stops Answering

If a read of the graph fails during a run, triage shows this once, at the point it happens:

```
Knowledge graph: it stopped answering during this run; the rest of the run works from the platform's findings and the source files only.
```

From then on, the run makes no more graph reads:

- the groups read before keep their evidence;
- every group not yet read carries the marker;
- cross-examination and the task list cover only what was read before, and are skipped entirely when the very first read was the one that failed;
- a run note says the graph became **unreadable**, not absent, and the header is not rewritten.

The next run checks the graph again.

A platform that refuses your session during a read has not lost the graph: triage asks you to sign in, then makes the same read again.

---

## A Class Whose Chain Could Not Be Read

A single read can come back with no answer about a class at all. Then the class's coverage is **unknown**, not uncovered, and the run is not stopped:

- that class's groups carry the marker, and a run note names the class;
- other classes are read as usual.

When one element's evaluation cannot be read this way, only that element carries the marker, as a group of its own.

---

## What Each Agent Sees

- **The triage-analyst** gets the rule's condition groups, the attributes they read and the evaluation. It never gets the graph's authored content: threats, technique provenance and sources.
- **The kg-cross-examiner** gets that authored content, with its `kg:<node-id>` ids, and defends the finding: for each proposal it returns an objection grounded in the graph, or concurs. A concurrence never raises a proposal's confidence. When the cross-examiner cannot run, or its return cannot be read, each group of its batch becomes needs-human, with a run note.
- **You** see the authored content as cited external content: its kind, id, canonical URL and a one-line synthesis.

---

**Next:** [Agents, Tools, and Hooks](AGENTS_AND_ARCHITECTURE.md) — how the plugin works under the hood
