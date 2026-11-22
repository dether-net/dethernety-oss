---
title: 'Reviewing Hidden Edges'
description: 'Review the inferred attack paths the platform proposes for a synced model, decide each one, and add the accepted ones to the model as flows'
category: 'documentation'
position: 12
navigation: true
tags: ['dethereal', 'hidden-edges', 'attack-paths', 'exposures', 'analysis']
---

# Reviewing Hidden Edges

A threat model shows the flows its authors declared. An attacker is not limited to them: a credential found on one host may open another, a remote service may answer from a place no flow names. A **hidden edge** is such a path: an attack path between two of the model's components that no declared flow shows. `/dethereal:hidden-edges` asks the platform for the hidden edges it can infer from your model, has an AI agent argue for and against each one from your project's sources, and puts every candidate to you. The ones you accept are added to the model as flows, after you answer the apply question.

This page shows the Claude Code form of the command; see [Running a Review](#running-a-review) for the Codex and OpenCode forms.

---

## What It Does

**The platform proposes; you decide.** Every candidate comes from the platform's hidden-edges module. Dethereal's agent argues about the candidates it is given and never adds one of its own. Nothing is written before you answer `yes` to the apply question.

A run:

1. Asks the platform's hidden-edges module for candidates. The module reads the model's **exposures** and the ATT&CK techniques they carry, and the model's structure, and proposes the paths those findings make possible.
2. Checks every candidate before showing it (see [Why the Candidates Rest on Facts](#why-the-candidates-rest-on-facts)).
3. Has the **hidden-edge-analyst** agent argue for and against each candidate from your project's sources.
4. Shows you the candidates and takes your decisions, one command per reply.
5. Prepares the writes, shows you what each one does, and asks whether to apply them.

The open-source hidden-edges module proposes four kinds of edge:

| Kind | The path |
|------|----------|
| **Remote service** | An attacker who holds the source reaches a remote service on the target. |
| **Credential reuse** | A credential the source holds is accepted by the target. |
| **Credential capture** | An attacker positioned at the source captures a credential a flow carries and uses it at that flow's responder. |
| **Host escape** | An attacker in a container breaks out to its host and reaches what runs there outside the container. |

An accepted edge becomes a **data flow** of its kind's class (for example *Hidden Edge: Credential Reuse*) in your local files. The next push takes it to the platform, which reads it as an inferred path, not as a flow of the system (see [What the Threat Report Shows](#what-the-threat-report-shows)).

---

## Before You Start

- **The platform carries the hidden-edges module.** Candidates come from the `dethernety-hidden-edges` module, which ships with the platform from the release that introduced it. On an older platform the run header says `module_not_loaded`, and the run ends with nothing to review.
- **You are signed in** to the platform (`/dethereal:login`). If you are not, the run asks you to sign in first; if the platform refuses your session later, it asks again and carries on.
- **The model is pushed, with no local changes.** The module reads the platform's copy of the model, so that copy must be what your files say. A model with local changes is refused with `push_first`: run `/dethereal:sync push`, then run hidden edges again. A model never pushed to this platform is refused (`not_synced`, `other_platform`), and one whose sync state does not show it in sync, with `sync_first`.
- **The model has exposures.** Every candidate rests on at least one of the model's exposures, so a model the platform has not analysed has no candidates.

**Triage first gives firmer candidates.** A candidate may rest on findings no one has reviewed yet. When none of the model's exposures is confirmed, the run header says so and suggests [`/dethereal:triage`](TRIAGE.md) first.

**Some triage decisions do not hide a finding.** A finding you mark `RISK_ACCEPTED` still feeds candidates, like a confirmed one: the weakness is still there. A finding you mark `COMPENSATING_CONTROL` still feeds, at a lower tier (never above medium), and a candidate that rests only on such findings is left out of `accept-all`. Findings you mark `NOT_APPLICABLE` or `FALSE_POSITIVE` never feed candidates.

**The knowledge graph is optional.** When the platform serves it, the module uses it to check each candidate, and it may lower a candidate's tier; it never raises one or adds one. Without it, the run header carries the same notice triage shows (see [Triage With and Without the Knowledge Graph](TRIAGE_AND_THE_KNOWLEDGE_GRAPH.md)), and every row carries its marker.

---

## Running a Review

| Harness | Command |
|---------|---------|
| Claude Code | `/dethereal:hidden-edges` |
| Codex | `$dethereal:hidden-edges` |
| OpenCode | `/dethereal-hidden-edges` |

```
> /dethereal:hidden-edges [directory-path]
```

Without `directory-path`, the run uses the working directory when it holds `manifest.json` and `.dethereal/sync.json`; otherwise it finds the model as other commands do (a single model is used; with several, you choose).

### The Run Header

The first message after the platform answers is the run header. It names:

- the model's name and id;
- the module's status and version: `answered`, or why there is no answer (`module_not_loaded`, `module_failed`, or the reason the answer was refused);
- the knowledge-graph line, when the graph was not used;
- four counts: the **candidates** to review, those **dropped by caps** (the module's own limits), those **excluded by decision** (a decision already stands for them), and those **dropped by validation** (they failed Dethereal's checks);
- the decisions that stand: how many accepted, how many rejected, and how many were accepted on another machine but are **not verified here** (see [Working With Teammates](#working-with-teammates));
- any notes, such as the suggestion to triage first.

With no candidates, the run says so and ends. A long table comes in pages; the run shows every page.

### The Review Table

One row per candidate, numbered `1..N`:

- the **kind** and the **edge**, as `<source> → <target>`;
- the **tier** (`high`, `medium` or `low`), with `kg: lowered` when the knowledge graph lowered it;
- the ATT&CK **techniques** of the path, and the **exposures** it rests on;
- the **base values**: the attacker capability the path needs (`opportunistic`, `targeted` or `advanced`), the privilege it needs on the source and the privilege it grants on the target (`none`, `user`, `admin` or `system`);
- any other **fields** the module set for this kind, and the **facts** the module cites;
- whether the candidate is in `accept-all`;
- the analyst's **stance**: `for`, `against` or `unclear`, with its one-line reason. The stance is an argument, not a decision.

---

## The Review

Before the first question, the run shows the commands:

```
accept <n>[,<n>…] · skip <n>… · reject <n>… · show <n> · show rejected · edit <n> capability: <v> | required: <v> | granted: <v> | <field>: <v> | rationale: <text> · accept-all · done
```

Then it asks, again after every reply, until the review closes:

```
Your command? One command per reply: accept, skip, reject, edit, show, accept-all or done, as the hint above shows.
```

| Command | What it does |
|---------|--------------|
| `accept <n> [<n> …]` | Accepts each candidate named. It also **affirms** the pending findings with no disposition that the candidate rests on (see [What Accept, Reject and Edit Write](#what-accept-reject-and-edit-write)). |
| `skip <n> [<n> …]` | Leaves each candidate undecided: nothing is written for it, and a later run proposes it again. |
| `reject <n> [<n> …]` | Rejects each candidate named: it is not proposed again. |
| `show <n>` | Shows one candidate in full. |
| `show rejected` | Lists the rejected decisions in the model's decisions file. |
| `edit <n> capability: <v>` | Changes the capability the path needs: `opportunistic`, `targeted` or `advanced`. |
| `edit <n> required: <v>` · `edit <n> granted: <v>` | Changes the privilege the path needs or grants: `none`, `user`, `admin` or `system`. |
| `edit <n> <field>: <v>` | Changes another field the module set for this candidate; the value is lower-case letters, digits, `_` and `-`. |
| `edit <n> rationale: <text>` | Adds your reason, at most 1000 characters, written with the edge. |
| `accept-all` | Accepts every undecided candidate that is in `accept-all`, and closes the review. It affirms nothing. |
| `done` | Closes the review; every undecided candidate is skipped. |

The rules:

- **One command per reply.** A later decision on a candidate replaces an earlier one. Skip is the default: nothing is accepted silently.
- **An edit does not accept.** After an edit, accept the candidate with `accept <n>`.
- **`accept-all` takes only the candidates marked for it.** A candidate that rests on pending findings only (a compensated finding counts as pending), or one you edited, is left out: accept it with its own `accept <n>`, before `accept-all`.
- **A refused reply changes nothing.** The run shows the refusal as the server gave it, then asks the question again.

Each reply goes to the server exactly as you typed it, and is recorded in the [hidden-edge record](#on-this-machine) before it takes effect.

A short review might go:

```
> accept 1
> edit 3 granted: user
> accept 3
> reject 2
> done
```

### What Accept, Reject and Edit Write

| Decision | In the local files | On the platform |
|----------|-------------------|-----------------|
| `accept <n>` | A new data flow from the source to the target, of the kind's class, with its attribute file, and a **signed accepted decision**. If a flow of that class between the same two components is already in the files, the accept uses it and writes no second one. | Each pending finding with no disposition that the candidate rests on is affirmed (`AFFIRMED`), with a reason that names the edge and ends with ` — hidden edge accepted by the operator`. The flow itself reaches the platform with your next push. |
| `accept-all` | The same flow and decision for each candidate it takes. | Nothing: an accept-all affirms no finding. |
| `reject <n>` | A rejected decision only. | Nothing. A finding the candidate rests on keeps its disposition; dispose it in [`/dethereal:triage`](TRIAGE.md) if you want to. |
| `edit` | Changes what an accept writes: the base values or fields you changed, your rationale, and `proposed_by: operator` in place of `rule`. | -- |

Only a finding that is still pending, with no disposition, is affirmed. An accepted edge's flow is named `<Kind>: <source> → <target>`, for example `Credential reuse: Orders Service → Payments DB`. Its description lists the techniques, the exposures, the module's facts and the analyst's evidence locators, and its attribute file records the kind, the tier, the techniques and the exposures it rests on.

---

## The Apply Question

When the review closes with at least one accept or reject, the run prepares the writes and shows the plan's lines, unchanged. For example, the plan of a smaller review that accepted candidate 1 and rejected candidate 2:

```
Platform model "Payment API" (6b1f0c52-9e2d-4c1a-8f3e-2a7d5e4b9c10)
1 hidden edge(s) to add to the local files, 1 to reject, 1 exposure(s) to affirm on the platform
+ [1] Credential reuse: Orders Service → Payments DB (high, T1078; class Hidden Edge: Credential Reuse) as flow he-3f9c2a1b7d4e5f60
    capability targeted, requires user, grants admin
- [2] reject Remote service: Partner Gateway → Admin API: not proposed again (a finding it rests on is triaged in /dethereal:triage)
  AFFIRMED on the platform: "Shared Database Credentials" (Orders Service)
The new flows reach the platform with the next push (/dethereal:sync push).
```

A flow id that starts with `he-` is local: the push replaces it with the platform's id. Then:

```
Apply N hidden-edge change(s)? Type yes or cancel.
```

- `yes` writes the plan.
- `cancel` writes nothing.
- Anything else writes nothing, and the question is asked again.

**Approve each tool prompt on its own.** Your harness asks you to approve the prepare call and then the commit call. Never approve them with an "always" choice: one standing approval would let a later write through without the apply question.

**A changed model means prepare again.** Before writing, Dethereal reads the files and the platform again. If anything the plan rests on changed (`plan_stale`), or the plan is more than 30 minutes old (`plan_expired`), nothing is written, and the run prepares again.

**The order of the writes.** With your `yes`, Dethereal writes the new flows' attribute files, then `dataflows.json`, then the decisions, each only if it is still as it was read; then the affirmations on the platform. An accepted decision is signed with your machine's key: if that key cannot be used (`key_unavailable`), nothing is written. The run then shows the outcome: the flows written, the count written and failed, and one line per affirmation.

The run ends with:

```
[done] Hidden edges: <a> accepted, <r> rejected, <k> skipped.
[next] When you're ready: /dethereal:sync push (to put the accepted edges on the platform)
```

**Push next.** The accepted edges are in your files only. Until you push, the model has local changes, so a new hidden-edges run is refused with `push_first`.

---

## Why the Candidates Rest on Facts

The platform's answer is checked as untrusted input before you see it. A candidate is dropped, and counted under **dropped by validation**, unless:

- its kind is one of the four above, the class it names is one of the hidden-edges module's classes on your platform, and its id is the one its kind and its two ends give;
- both ends are components of this model, in your files and on the platform, two different ones, and not both external entities;
- every exposure it rests on is in this model's current exposures, is pending, affirmed, risk-accepted or compensated (not disposed otherwise), and is not itself on a hidden edge (an inferred path never anchors another);
- every fact it cites names a place: an element's attribute (`attributes:<element>#<key>`), a control (`control:<id>`), one of this model's exposures (`exposure:<id>`), or a knowledge-graph entry (`kg:<id>`, `kg-class:<id>`).

A candidate a decision already covers is not shown either: it is counted under **excluded by decision**.

**The analyst argues; it adds nothing.** The hidden-edge-analyst reads the model's files and the project's source and configuration files that bear on a candidate's two ends, and looks first for what would prove the path wrong: a network policy, a firewall rule, credential scoping. `for` and `against` need positive evidence; anything less is `unclear`. It cites evidence as **locators only** (`source:<file>:<line>`, `attributes:<file>#<key>`, `platform:<id>`, `kg:<id>`), never a quoted value, and never opens a secret file. It cannot write, and it never proposes an edge, a direction or a kind of its own.

---

## Working With Teammates

`.dethereal/hidden-edges-decisions.json` is committed with the model, so the decisions travel through your repository.

- **A teammate's reject stands for you too.** A rejected decision is not signed: it only keeps a candidate out of a review, so it counts on every machine.
- **A teammate's accept is not verified on your machine.** An accepted decision is signed with the key of the machine that made it. The run header counts it as `not_verified_here`. On your machine its flow counts as an ordinary flow, in every check (see [Hidden Edges in the Checks](#hidden-edges-in-the-checks)), and the platform may propose the same edge to you again. Accept it to make it yours: the accept uses the flow already in the files and adds your own signed decision.
- **The latest decision stands.** For each edge, the latest of the accepts verified here and the rejects counts. A teammate's later reject takes your accept back: the flow then counts as an ordinary flow in your checks, and stays in the files until someone removes it.
- **A push keeps your decisions.** A push gives new flows their platform ids; Dethereal moves the accepted decisions this machine signed onto the new ids. A decision it cannot verify is left as it is, with a warning.

On the platform, a flow of a hidden-edge class is an inferred path for everyone, whoever accepted it.

---

## Taking an Edge Back

To take an accepted edge back, remove its flow:

```
> /dethereal:remove Credential reuse: Orders Service → Payments DB
```

Before the flow is removed, the remove command records the edge as rejected. It shows the plan's lines, for example:

```
Platform model "Payment API" (6b1f0c52-9e2d-4c1a-8f3e-2a7d5e4b9c10)
The hidden edge Credential reuse he:3f9c2a1b7d4e5f60 is recorded as rejected: it is not proposed again
1 exposure(s) it cites are affirmed; if the edge was their only ground, clear them in /dethereal:triage:
  "Shared Database Credentials" (Orders Service)
```

and asks the same apply question. `yes` records the reject. `cancel` records nothing: the edge stays accepted, so the next run still does not propose it. The flow is removed either way. Then push, so the platform drops the flow too.

The findings the edge affirmed stay affirmed: clear them in [`/dethereal:triage`](TRIAGE.md) if the edge was their only ground. Removing a hidden edge never makes a REVIEWED model stale.

A flow with no decision of yours behind it (a teammate's accept not verified here, for example) is removed as an ordinary flow, and nothing is recorded.

---

## Hidden Edges in the Checks

An accepted edge records an inferred path, not a flow of the system. On the machine that accepted it, its flow is **left out** of the quality gates, the lints, the quality score, the control coverage, the trust zoning, the settlement's drift and the review hash, and counted on its own (`hidden_edge_flows`). Adding or removing one is therefore no structural change: a REVIEWED model stays REVIEWED. The structure checks still read it, so its attribute file is never an orphan.

A hidden-edge class is never the class of an ordinary element: class matching never offers one, and the class listing shows one only when it is asked for by its module or its id.

---

## What the Threat Report Shows

After the push, the platform evaluates each accepted edge like any flow, and its class gives it its own findings: one in category **Inferred Path** per technique of the path. The threat report and the platform's coverage tools treat them apart:

- **Reachability** keeps the inferred edges as routes and labels every use: `via inferred edge (<tier>, grants <privilege>)`. A crown jewel reached only through inferred edges is counted on its own, and a declared choke point an inferred edge goes around is named as bypassed. See [Reachability and Flow Routes](../threat-report/REACHABILITY.md).
- **Totals.** An Inferred Path finding on a hidden edge is set apart from every total, posture and coverage count, with one count of its own (`N inferred-path findings set apart`). The same category on any other element counts as usual.
- **Flow hygiene.** Zoning and boundary crossings leave hidden edges out, and name the ones they set apart: an inferred path is never a crossing.

For how the platform computes candidates, see the [hidden-edges module architecture](../../architecture/dethernety-hidden-edges/README.md).

---

## What Is Written and Where

### In the Model Directory

| Path | What it holds |
|------|---------------|
| `dataflows.json`, `attributes/dataFlows/<id>.json` | Each accepted edge's flow and its attribute file. Committed with the model. |
| `.dethereal/hidden-edges-decisions.json` | The **decisions file**: every accept (signed with this machine's key) and reject. Committed with the model, so teammates share it. At most 1500 decisions. |

### On This Machine

| Path | What it holds |
|------|---------------|
| `.dethereal/hidden-edges-log.json` | The **hidden-edge record**, this machine's own: every reply each review received and every answer to the apply question, recorded before it takes effect. Kept out of git: Dethereal lists it in the model's own `.dethereal/.gitignore`. It keeps the last 20 reviews and stays under 896 KiB; one review records at most 70 replies and 40 apply answers. |

An **open review** is not on disk: it lives only in the server's memory. At most 20 are held, one unused for 2 hours expires, and a restart of the server forgets it.

---

## Troubleshooting

| Code | What happened | What to do |
|------|---------------|------------|
| `push_first` | The model has local changes the platform does not have. | Push (`/dethereal:sync push`), then run hidden edges again. |
| `sync_first` | The model is not in sync with the platform, or was never synced. | Sync it (`/dethereal:sync`), then run again. |
| `not_synced`, `other_platform` | The model was never pushed, or was synced with another platform than the one Dethereal is configured for. | As in [triage](TRIAGE.md#troubleshooting). |
| `module_not_loaded` (header) | The platform has no hidden-edges module. | Upgrade the platform to a release that carries it. |
| `module_failed`, `contract_mismatch` (header) | The module did not answer, the hidden-edge classes could not be read from the platform, or its answer is of a contract this Dethereal does not read. | Run again later; for `contract_mismatch`, update Dethereal or the platform. |
| `decisions_unreadable` | `.dethereal/hidden-edges-decisions.json` cannot be read. | Move the file aside, then run again. |
| `review_not_found` | The review is no longer held (a restart, or 2 hours unused). Nothing was written. | Run hidden edges again. |
| `review_stale` | The files, the decisions or a finding a candidate rests on changed since the review was opened. Nothing was written. | Run hidden edges again. |
| `plan_expired`, `plan_stale` | The plan is more than 30 minutes old, or what it rests on changed. Nothing was written. | The run prepares again and asks the apply question again. |
| `key_unavailable` | This machine's signing key cannot be used. Nothing was written: an accept is never written unsigned. | Fix what the message names, then run again. |
| `echo_too_large` | The plan is too large to show whole. | Decide fewer candidates in one review. |
| `record_full` | The review has recorded 70 replies, and takes only `done` or `accept-all`; or 40 apply answers, and takes none. | Close the review; run again for the rest. |
| `record_too_large` | The review's record has grown too large to write. Nothing was taken. | Run hidden edges again: an open review is let go at once, so a new one can open. |
| `record_unwritable` | `.dethereal/hidden-edges-log.json` cannot be read or written. Nothing was taken. | Move the file aside, then run again. |
| `plan_not_found`, `plan_used`, `busy`, `lines_differ`, `other_model`, `plan_other_model` | The plan is not held, was already used, is being committed, or was made for another model; or the lines passed back are not the ones shown. Nothing was written. | Run hidden edges again. |
| `reply_not_answer` | The answer to the apply question was neither `yes` nor `cancel`. Nothing was written. | Answer `yes` or `cancel`. |

---

**Next:** [Triaging Platform Findings](TRIAGE.md) — review the findings a hidden edge rests on
