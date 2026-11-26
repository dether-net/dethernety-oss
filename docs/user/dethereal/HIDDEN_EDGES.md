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

When the platform has the Hidden edges workspace, you can instead publish the review there, with the analyst's arguments, for a person to decide in the browser; nothing is then written here (see [Publishing to the Hidden Edges Workspace](#publishing-to-the-hidden-edges-workspace)).

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
- **The fuller explanations need module 0.2.0.** With `dethernety-hidden-edges` 0.2.0 or later, each row says how the attacker moves and why its evidence is what it is, and `show <n>` adds the other ways in, the facts weighed, what would remove or lower the edge and the rule's rationale (see [Showing a Candidate](#showing-a-candidate)). With an older module the review works as before, without them; the run asks the module for the fuller answer and falls back on its own. Numbering a candidate's findings, and affirming them with `accept <n> affirm <k>`, works with either.
- **You are signed in** to the platform (`/dethereal:login`). If you are not, the run asks you to sign in first; if the platform refuses your session later, it asks again and carries on.
- **The model is pushed, with no local changes.** The module reads the platform's copy of the model, so that copy must be what your files say. A model with local changes is refused with `push_first`: run `/dethereal:sync push`, then run hidden edges again. A model never pushed to this platform is refused (`not_synced`, `other_platform`), and one whose sync state does not show it in sync, with `sync_first`.
- **The platform model has no changes since your last pull or push.** A run is refused with `pull_first` when the platform model changed since then: an element added, changed or removed in the platform's editor, or an edge a person accepted in the [Hidden edges workspace](#an-edge-accepted-in-the-workspace). Pull (`/dethereal:sync pull`), then run hidden edges again. This applies after any change made on the platform, not only after accepts. When the platform model cannot be read for this check, the run is refused with `platform_unread`: try again.
- **This machine can keep a record of the platform model.** Without one, hidden edges cannot tell whether the platform changed, and a pull does not help: the run is refused with `baseline_unavailable`, and the message names the cause: the home directory is not an absolute path, no project root was found, this machine's key folder, in the home directory, lies inside the project or the model directory, or this machine's key file is a symbolic link, readable by others, or not a key. Fix the cause, then pull.
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
- with module 0.2.0, the **limits** lines, when the module's caps left something out (see below);
- any notes, such as the suggestion to triage first.

**The limits lines** say where the list is short, so an edge missing from it is not taken for an edge that does not exist:

| Line | What it means |
|------|---------------|
| `The list is incomplete: <kind> <n> listed, <m> not; …. The module lists at most 50 edges of a kind; decide some, then run hidden edges again, to see the rest.` | The module found more edges of a kind than it lists. Deciding some lets the next run show others. |
| `The module walked a limited number of starting points (at most 20 peers each): <kind> <n> pair(s) past the cap, <m> finding(s) past their budget; …. A change that removes the paths it walked may leave others.` | The module stopped some walks early. A fix that removes every path listed may not close the way in. |
| `The module left out <n> edge explanation(s), for size.` | The answer was too large to explain every edge in full: those edges show only their main way in, or have no `path` at all. |
| `The module left out what removes <n> edge(s), for time.` | The module ran out of time for remedies; `show` says so for those edges. |

With no candidates, the run says so and ends. A long table comes in pages; the run shows every page.

### The Review Table

One row per candidate, numbered `1..N`:

- the **kind** and the **edge**, as `<source> → <target>`;
- the **tier** (`high`, `medium` or `low`), with `kg: lowered` when the knowledge graph lowered it;
- with module 0.2.0, the **path**: how the attacker moves, in words, from where to what and with which assumption. For example: `From Workstation (User Workstation / Endpoint), in the same "App Segment" as File Server, an attacker uses T1210 against File Server, where "Vulnerable SMB service" was found, with user rights on Workstation (rule assumption).`
- with module 0.2.0, **evidence_why**: why the tier is what it is. For example: `Evidence: Medium. The finding is pending (Medium at most); 0 of the 1 condition High needs are met.` It names what holds the edge below High: a pending finding, a condition not stated, a rule or technique that never reaches High, a starting point reached only across the perimeter or running on a managed runtime, a credential carried by many flows, or the knowledge graph's step;
- with module 0.2.0, **removes_if**, when the module knows one: the first change in the model that would remove or lower the edge, in the words `show` uses for [remedies](#showing-a-candidate);
- the ATT&CK **techniques** of the path, and the **exposures** it rests on;
- the **base values**: the attacker capability the path needs (`opportunistic`, `targeted` or `advanced`), the privilege it needs on the source and the privilege it grants on the target (`none`, `user`, `admin` or `system`);
- any other **fields** the module set for this kind, and the **facts** the module cites;
- whether the candidate is in `accept-all`;
- the analyst's **stance**: `for`, `against` or `unclear`, with its one-line reason. The stance is an argument, not a decision. The server holds the arguments, so the table shows them again after the conversation is compacted.

---

## The Review

Before the first question, the run shows the commands:

```
accept <n>[,<n>…] · accept <n> affirm <k>[,<k>…] [note: <text>] · skip <n>… · reject <n>… · show <n> · show rejected · edit <n> capability: <v> | required: <v> | granted: <v> | <field>: <v> | rationale: <text> · accept-all · done
```

Then it asks, again after every reply, until the review closes:

```
Your command? One command per reply: accept, skip, reject, edit, show, accept-all or done, as the hint above shows.
```

| Command | What it does |
|---------|--------------|
| `accept <n> [<n> …]` | Accepts each candidate named. It affirms **no** finding. |
| `accept <n> affirm <k>[,<k>…] [note: <text>]` | Accepts one candidate and **affirms** the findings you name by the numbers `show <n>` gives them, with your note as their reason (see [Affirming the Findings an Edge Rests On](#affirming-the-findings-an-edge-rests-on)). |
| `skip <n> [<n> …]` | Leaves each candidate undecided: nothing is written for it, and a later run proposes it again. |
| `reject <n> [<n> …]` | Rejects each candidate named: it is not proposed again. |
| `show <n>` | Shows one candidate in full, with its findings numbered (see [Showing a Candidate](#showing-a-candidate)). |
| `show rejected` | Lists the rejected decisions in the model's decisions file. |
| `edit <n> capability: <v>` | Changes the capability the path needs: `opportunistic`, `targeted` or `advanced`. |
| `edit <n> required: <v>` · `edit <n> granted: <v>` | Changes the privilege the path needs or grants: `none`, `user`, `admin` or `system`. |
| `edit <n> <field>: <v>` | Changes another field the module set for this candidate; the value is lower-case letters, digits, `_` and `-`. |
| `edit <n> rationale: <text>` | Adds your reason, at most 1000 characters, written with the edge. |
| `accept-all` | Accepts every undecided candidate that is in `accept-all`, and closes the review. It affirms nothing. |
| `done` | Closes the review; every undecided candidate is skipped. |

The rules:

- **One command per reply.** A later decision on a candidate replaces an earlier one, and with it the findings an earlier `accept <n> affirm <k>` named. Skip is the default: nothing is accepted silently.
- **Only `affirm` affirms.** A finding is affirmed only when you name it in `accept <n> affirm <k>`. A plain `accept`, and `accept-all`, affirm nothing.
- **An edit does not accept.** After an edit, accept the candidate with `accept <n>`.
- **`accept-all` takes only the candidates marked for it.** A candidate that rests on pending findings only (a compensated finding counts as pending), or one you edited, is left out: accept it with its own `accept <n>`, before `accept-all`.
- **A refused reply changes nothing.** The run shows the refusal as the server gave it, then asks the question again.

Each reply goes to the server exactly as you typed it, and is recorded in the [hidden-edge record](#on-this-machine) before it takes effect. A reply that holds this session's credentials is recorded only by its hash, with its start redacted.

A short review might go:

```
> show 1
> accept 1 affirm 1 note: confirmed with the platform team; the password is shared
> edit 3 granted: user
> accept 3
> reject 2
> done
```

### Showing a Candidate

`show <n>` gives the candidate's row and, below it:

- **`findings`**: each finding the candidate rests on, numbered `k` from 1, with its name, the element it is on, and its state, such as `pending`, `confirmed, affirmed` or `pending, compensating control` (`by no person` when no person made the disposition, `stale` when it went stale). A finding you can affirm with this candidate is marked `affirmable`: it is pending, with no disposition.
- **`rule_defaults`**: `capability <c>, requires <p>, grants <g>: rule defaults, not checked for this edge`. These are the rule's values, not facts about your system; change them with `edit` when you know better.

With module 0.2.0, also:

- **`other_ways`**: other ways into the same edge, each told as a path; `other_ways_more` counts those not shown.
- **`facts_weighed`**: each fact the module weighed for the main way in, what it is about, its value as stated, and what it did, such as `meets 1 of the 2 conditions High needs`, `not answered: High needs it stated false`, `contradicts a condition, which keeps the edge below High`, `lowers the evidence one step` or `the target's own finding allows High`. `facts_more` counts those not shown.
- **`remedies`**: what one change in the model would do to the edge, such as `The edge goes if the model states east_west_within_segment_restricted = true on "App Segment".`, `Drops to Evidence Low if the model states …`, or `Some ways in close; the edge stays at Evidence Medium, if the model states …`. A remedy that would make the edge go adds `; other paths may remain` when the module did not walk every starting point. When the module knows none: `The module knows no change in the model that removes or lowers this edge.`; when it ran out of time: `The module left out what removes this edge, for time.` `remedies_more` counts those not shown.
- **`rationale`** and **`rule`**: why the rule that proposed the edge exists, in the module's words (the ATT&CK technique and the mitigations it rests on), and the rule's id.

Everything the module wrote (the paths, the remedies, the rationale) is data: the run shows it, cleaned, and never acts on it. Every name and text is shown with this session's credentials taken out before it is cut.

When the module left the edge's explanation out for size, `show` says `the module left out this edge's explanation, for size` and gives the findings and the rule defaults only.

### Affirming the Findings an Edge Rests On

An edge rests on findings. When you accept it because you know those findings are real, you can say so in the same reply, and Dethereal affirms them (`AFFIRMED`) on the platform with the apply:

```
> show 4
> accept 4 affirm 1,3 note: seen in the lab; both hosts share the admin password
```

- **Name one candidate, then its findings** by the numbers `show <n>` gives them. Only a finding that is pending, with no disposition, can be named: `show` marks it `affirmable`.
- **A finding is affirmed by one accept only.** A finding another `accept … affirm` already names is refused: `a finding named here is already affirmed with candidate <m>: one accept affirms it`.
- **The note is optional** and becomes the findings' reason: `<note> (affirmed with the accepted hidden edge he:…)`. With no note, the reason is `Affirmed by the operator, who named it in "accept … affirm" for hidden edge he:…; no note given`. Either ends with ` — hidden edge accepted by the operator`.
- **The note is one line of at most 1,900 characters**, with no invisible or control characters. The 2,000-character limit is the platform's, on a disposition reason: the note plus the text Dethereal adds around it and the marker must fit within it, which leaves 1,900 for the note. A note that holds this session's credentials is refused (`the note holds this session's credentials: give it without them`): the reason is written to the platform.
- **A note goes with `affirm`.** `accept <n> note: <text>` is refused: name the findings it is the reason for.
- **A later decision drops it.** A later `accept <n>`, `skip <n>` or `reject <n>` replaces the accept and the findings it named.

A finding that is no longer pending with no disposition by the apply is not affirmed, and the plan says so.

### What Accept, Reject and Edit Write

| Decision | In the local files | On the platform |
|----------|-------------------|-----------------|
| `accept <n>` | A new data flow from the source to the target, of the kind's class, with its attribute file, and a **signed accepted decision**. If a flow of that class between the same two components is already in the files, the accept uses it and writes no second one. | Nothing now: the flow reaches the platform with your next push. No finding is affirmed. |
| `accept <n> affirm <k>…` | The same flow and decision. | Each finding you named that is still pending with no disposition is affirmed (`AFFIRMED`), with your note, or the default text, as its reason, ending with ` — hidden edge accepted by the operator`. |
| `accept-all` | The same flow and decision for each candidate it takes. | Nothing: an accept-all affirms no finding. |
| `reject <n>` | A rejected decision only. | Nothing. A finding the candidate rests on keeps its disposition; dispose it in [`/dethereal:triage`](TRIAGE.md) if you want to. |
| `edit` | Changes what an accept writes: the base values or fields you changed, your rationale, and `proposed_by: operator` in place of `rule`. | -- |

Only a finding you named, still pending with no disposition, is affirmed. An accepted edge's flow is named `<Kind>: <source> → <target>`, for example `Credential reuse: Orders Service → Payments DB`. Its description lists the techniques, the exposures, the module's facts and the analyst's evidence locators, and its attribute file records the kind, the tier, the techniques and the exposures it rests on.

---

## The Apply Question

When the review closes with at least one accept or reject, the run prepares the writes and shows the plan's lines, unchanged. For each accept that affirms, the plan shows the reason its findings are written with, in full, once, before you answer. For example, the plan of a smaller review that accepted candidate 1 with `accept 1 affirm 1 note: confirmed with the platform team` and rejected candidate 2:

```
Platform model "Payment API" (6b1f0c52-9e2d-4c1a-8f3e-2a7d5e4b9c10)
1 hidden edge(s) to add to the local files, 1 to reject, 1 exposure(s) to affirm on the platform
+ [1] Credential reuse: Orders Service → Payments DB (high, T1078; class Hidden Edge: Credential Reuse) as flow he-3f9c2a1b7d4e5f60
    capability targeted, requires user, grants admin
- [2] reject Remote service: Partner Gateway → Admin API: not proposed again (a finding it rests on is triaged in /dethereal:triage)
  Affirmed with [1], reason: confirmed with the platform team (affirmed with the accepted hidden edge he:3f9c2a1b7d4e5f60) — hidden edge accepted by the operator
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

**A changed platform model means pull first.** When the review accepts at least one edge, prepare and commit check the platform model for changes since your last pull or push again, as open does (a review that only rejects writes no flow, and is never refused for this): an edge a person accepted in the Hidden edges workspace after the review opened would otherwise become a second flow. A change found is `pull_first`, and nothing is written: pull, then run hidden edges again.

**A changed model means prepare again.** Before writing, Dethereal reads the files and the platform again. If anything the plan rests on changed (`plan_stale`), or the plan is more than 30 minutes old (`plan_expired`), nothing is written, and the run prepares again.

**The order of the writes.** With your `yes`, Dethereal writes the new flows' attribute files, then `dataflows.json`, then the decisions, each only if it is still as it was read; then the affirmations on the platform. An accepted decision is signed with your machine's key: if that key cannot be used (`key_unavailable`), nothing is written. The run then shows the outcome: the flows written, the count written and failed, and one line per affirmation.

The run ends with:

```
[done] Hidden edges: <a> accepted, <r> rejected, <k> skipped.
[next] When you're ready: /dethereal:sync push (to put the accepted edges on the platform)
```

**Push next.** The accepted edges are in your files only. Until you push, the model has local changes, so a new hidden-edges run is refused with `push_first`.

---

## Publishing to the Hidden Edges Workspace

When the platform has the `dethermine-review` module, its **Hidden edges workspace** is where a person decides a model's candidate edges in the browser. Instead of deciding a review here, you can publish it there: the edges go with the analyst's arguments, and a person accepts or rejects each one in the workspace. **A publish writes nothing here**: no flow, no decision, no affirmation. It stores the edges on the model's Hidden edges analysis, under your name.

### The Workspace Line

After the review opens, the run header shows one line about the workspace:

| Line | What it means |
|------|---------------|
| `Hidden edges workspace: available (dethermine-review <version>) — the edges can be published for a person to decide.` | The module is on the platform; the review can be published. When the workspace already holds some of these edges, the line adds `<n> of these are in the platform model already; <n> were rejected there.` |
| `Hidden edges workspace: not found on this platform.` | The platform has no `dethermine-review` module with a Hidden edges workspace: decide the review here |
| `Hidden edges workspace: not checked (<detail>).` | The platform could not be asked; the detail says why |

At open, Dethereal asks the platform whether the workspace is there, finds the model's Hidden edges analysis if one exists, and reads each candidate's state there: its fingerprint, whether the model holds it as a flow, and whether it was rejected. Open never creates an analysis.

### Here or Publish

When the workspace is available, the run asks this after the review table, in place of the review question:

```
Decide these edges here, or publish them to the platform's Hidden edges workspace for a person to decide there? Here: you decide edge by edge, and what you accept is written to the local files after an apply question. Publish: nothing is written here; the edges and the analyst's arguments go to the Hidden edges workspace under your name, and this review closes here. Either way you see everything before it is written or sent. (here / publish)
```

It is asked once per run, and again after a cancelled publish. `here` goes on with [The Review](#the-review). `publish` goes on below. A review that already has a reply here cannot be published (`review_has_replies`): finish it here, or open a new review to publish.

The analyst's arguments are held by the server, not only in the conversation, so the table can show them again after the conversation is compacted. The analyst's reason is cleaned to one line of at most 300 characters. A reason that holds this session's own credentials, before or after cleaning, is refused (`reason_invalid`), and is never stored or sent: the run sends that candidate's argument again without its reason, so its stance and locators are still held.

### What the Publish Plan Shows

The run prepares the publish before any reply, and shows its lines unchanged, in one block:

```
Publish 2 edges to the Hidden edges workspace of "Payment API", under your name, with the stances and reasons as Dethereal's analyst drafted them, for a person to decide there. Edges: 1 proposes accepting · 1 proposes rejecting · 0 left to a person.
Edge 1: Credential reuse, "Orders Service" → "Payments DB" — the analyst proposes accepting it
  Reason: "The orders service reads the payments DB password from the same vault path"
  Locators: source:deploy/orders/values.yaml:41, attributes:attributes/components/orders-service.json#secret_store
Edge 3: Remote service, "Partner Gateway" → "Admin API" — the analyst proposes rejecting it
  Reason: "A network policy lets only the ingress controller reach the admin API"
  Locators: source:deploy/network-policy.yaml:12
1 locator left out: a secret file, or a source file discovery did not read, never leaves this machine.
Not sent (1 edge):
  Edge 2: it is in the model already as a flow
To the model's Hidden edges analysis 7d0e4b2a-5c19-4f3e-8a61-0b9d2c7e4f15.
Sent with each: the analyst's stance, its reason as drafted, its locators (file and line places, no repository text), the findings the edge rests on, and the state it was judged on. Nothing is written to the model or the local files.
```

The lines name:

- the count, the model, and how many edges the analyst proposes to accept, to reject, or leaves to a person;
- every edge: its kind, its two ends and the analyst's stance, then its reason and its locators;
- the locators left out: one naming a secret file, or a source file discovery did not read, never leaves this machine;
- `Not sent (<n> edges):`, then one line per reason, each reason once: `Edge 8: <why>` for a single edge, or `Edges 4–7, 9 (5), each: <why>` for several, the edge numbers in ranges. The reasons: the analyst returned no argument for it (decide it here); a finding it rests on changed since the review (open a new review to judge it again); it is in the model already as a flow; a person rejected it in the Hidden edges workspace; or an end or a finding it rests on is no longer in the model;
- where they go: the model's Hidden edges analysis, or `Creates the model's Hidden edges analysis on the platform (none exists yet).`

Every text is in double quotes, with a `"` or `\` inside it escaped. Prepare refuses, and the review goes on here, with `Nothing was sent; this review is still open here.`, when:

| Code | Why |
|------|-----|
| `review_has_replies` | The review has a reply here already |
| `nothing_to_publish` | No edge can be sent: every one is left out (the `not_sent` list says why) |
| `module_not_loaded` | The platform has no Hidden edges workspace, or its review module is too old for one |
| `workspace_unavailable` | The workspace, the model's Hidden edges analysis or the edges' state there could not be read |
| `review_late` | More than 30 minutes have passed since the review opened, and the edges' state was not read at open (see [The Window After Open](#the-window-after-open)) |
| `echo_too_large` | The publish is too large to show whole. A review with more than about 50 argued edges is past what one plan can show, so decide it here, in the chat |

### What Is Sent, and What Is Never Sent

For each edge, the workspace gets:

- the edge: its kind, its two ends, and the ids of the findings it rests on;
- the analyst's **stance**, `for`, `against` or `unclear`, and its **reason as drafted**;
- the analyst's **locators**, places only: `source:<file>:<line>`, `attributes:<file>#<key>`, `platform:<id>` and `kg:<id>`;
- the edge's **fingerprint**, the platform's digest of the facts it was judged on.

The publish also carries the **review id**. The workspace derives what it shows from the stance: `for` proposes accepting the edge, `against` proposes rejecting it, and `unclear` leaves it to a person.

**Never sent:** Dethereal sends no file content, and no text it has not shown you. A locator names a place; it never quotes it. A locator to a secret file, or to a source file discovery did not read, is left out, and the plan counts it. A reason that holds this session's credentials is never stored, so it cannot be sent.

### Approving and Answering a Publish

Your harness asks you to approve the prepare_publish call and then the publish call: **approve each prompt on its own, never with an "always" choice**, as for the apply question. Then:

```
Publish 2 edge(s) to the Hidden edges workspace? Type yes or cancel.
```

- `yes` sends the plan, after checking it still holds (below). It finds the model's Hidden edges analysis (the one with the id every machine and harness derives the same way, else the oldest), or creates it with that id, so two publishes of one model meet in one analysis.
- `cancel`: nothing is sent, and the run asks the here-or-publish question once more.
- Anything else sends nothing, and the question is asked again.

**A plan that no longer holds sends nothing** (`plan_stale`): a reply was given to the review here since prepare (an accept, reject, skip or edit), the review was published since, or the model's Hidden edges analysis changed. The review is checked once more as the edges are sent, and closes in that same step, so a reply that arrives while the publish is under way finds it closed; it opens again only if the workspace refuses the publish or your session. A plan more than 30 minutes old is `plan_expired`. Either way the run prepares again and asks again.

### Publish Outcomes

The workspace answers per edge:

| Result | What it means |
|--------|---------------|
| `stored` | The edge waits in the workspace with the analyst's argument |
| `stored_stale` | Stored, but the edge's facts changed since the review: the workspace shows it on changed facts |
| `rejected` | Not stored: a person rejected this edge in the workspace, and a rejection is not overwritten |
| `in_model` | Not stored: the edge is in the model already as a flow |
| `not_found` | Not stored: an end or a finding it rests on is no longer in the model |

The run ends with no apply question:

```
[done] Hidden edges: <stored> of <N> edges published to the Hidden edges workspace; <n> not stored, see above; nothing written here.
[next] When you're ready: decide them in the platform's Hidden edges workspace, then ask me what became of them.
```

`<stored>` counts `stored` and `stored_stale`, and `<N>` the edges sent. Before it, the run shows each edge not stored with why, and each edge left out at the publish itself, with why: the workspace now holds it as a flow, a person rejected it there, or it is gone.

- **`write_error`**: the publish was sent but no answer came, and the workspace may hold the edges. The run reads back what it holds first (below); when it holds nothing from this publish, prepare_publish again sends it once more, safely: each edge's entry is replaced, never doubled. When that is refused too, the run ends: `The publish was not confirmed and the workspace cannot be reached. Nothing was written here. Ask me later what became of it.`
- **`session_refused`**: the platform refused your session. Nothing was sent, and the plan stands: after the sign-in question, the run makes the same publish call again. A retried publish accepts the analysis an earlier attempt created, the one with the id the plan named.
- **`publish_refused`**: the workspace refused the publish, and nothing was stored. The first time, naming no field, the run prepares again and asks again. Naming a field, a second time, or any other refusal: `Nothing was sent; this review is still open here.`, and the review goes on here.

**A published review is never applied here.** It is decided in the workspace, and a prepare or commit of it is refused `review_published`. One review can be published at most 5 times. Each publish is recorded in the [hidden-edge record](#on-this-machine).

### What Became of Them

Ask the run what became of the edges (`hidden_edges` `published`). It shows the counts, then, for each edge this machine published, what the workspace holds now, sorted by what needs action first:

| Status | What the run says |
|--------|-------------------|
| `rejected` | `Rejected by <person>, <date>: "<note>"` |
| `unconfirmed_analysis` | `The analysis it went to is no longer this model's Hidden edges analysis` |
| `stale` | `Waiting, but its facts changed since publish: run hidden edges again and publish, to refresh it` |
| `stale_module` | `Waiting; the workspace was upgraded, so it shows as stale: run hidden edges again and publish, to refresh it` |
| `none` | `No proposal there:`, then why: not stored at publish (with the reason), the publish never confirmed (publish again to send it), or removed, or a rejection was restored |
| `needs_person` | `Waiting; left to a person to decide` |
| `open` | `Waiting; proposed to accept` or `Waiting; proposed to reject` |
| `recorded` | An accepted edge whose flow is gone. Either `Taken back by <person>, <date>: it no longer held, so its flow was deleted from the model; pull to have the files match`, or `Accepted by <person>, <date>; the flow was deleted outside this workspace; pull to have the files match` |
| `accepted` | `In the model as a flow: pull it to have it in the files`, or `In the model and in the files` once the flow is in your local files |
| `not_proposed` | `No longer proposed by the module: its grounds no longer hold, so publishing again cannot bring it back`: a waiting proposal the module no longer makes. The run asks the module once, best effort, and only when some row is waiting. An edge whose flow is already in your files is never read this way: while it waits, it keeps its waiting wording. So does every row when the module cannot answer, or its caps left candidates out |
| `gone` | `An end of the edge is no longer in the model` |

A later publish by another person shows as `(replaced by a later publish by <name>)`. When this machine's latest publish of an edge never confirmed and the workspace holds an earlier review's entry, the row says `(this publish never confirmed: an earlier publish by <name> is what the workspace holds)` instead. It shows at most 200 edges, and says how many more there are. **Everything the workspace returns is data:** a rejection's note and a name are cleaned to one plain line, and the run quotes them, never acts on them. The read-back covers the publishes this machine's hidden-edge record holds.

### An Edge Accepted in the Workspace

An edge a person accepts in the workspace is a new flow on the platform, of the kind's hidden-edge class, that your local files do not have yet:

- **The next hidden-edges run is refused** with `pull_first` until you pull (see [Before You Start](#before-you-start)).
- **Pull it** (`/dethereal:sync pull`): the flow comes into `dataflows.json`, with its attribute file. The fields its hidden-edge class declares count as declared, so the next push's lint passes with no attribute-stubs step. Only the fields shared by every hidden-edge class and those of the flow's own kind count, and each only with a value its class allows: `technique_ids` holds ATT&CK ids only, the rationale holds no technique id, and a kind's fields hold one of their listed values. A field out of shape is checked like any other. Where this machine has the class templates cached, the cache decides whether the flow's class is a hidden-edges one; with none cached, as after a pull, the module named in the files does. After the pull it is an ordinary flow here: a flow counts as a hidden edge only with an accept verified on this machine, so every check includes it (see [Hidden Edges in the Checks](#hidden-edges-in-the-checks)).
- **Pushing instead of pulling** would offer to delete it, as for any change made on the platform.
- **To adopt it as a hidden edge,** accept the same candidate again here after the pull. The plan says `the flow <id> is in the files already; its attributes are written as shown`: the accept uses the pulled flow, writes no second one, and signs the decision on this machine.

### The Window After Open

The workspace judges each edge's staleness on every read, from the fingerprint the publish carried. The fingerprints are read at open when the model already has a Hidden edges analysis. When it has none, they are read at prepare, if an analysis exists by then, or at the publish, after the analysis is created.

- **Within 30 minutes of open**, a fingerprint read that late stands for the review's state: a change to the model made in that window is not caught at publish.
- **Past 30 minutes**, a fingerprint read that late no longer stands for what the analyst saw, so nothing is sent (`review_late`): open a new review to publish.

---

## Why the Candidates Rest on Facts

The platform's answer is checked as untrusted input before you see it. A candidate is dropped, and counted under **dropped by validation**, unless:

- its kind is one of the four above, the class it names is one of the hidden-edges module's classes on your platform, and its id is the one its kind and its two ends give;
- both ends are components of this model, in your files and on the platform, two different ones, and not both external entities;
- every exposure it rests on is in this model's current exposures, is pending, affirmed, risk-accepted or compensated (not disposed otherwise), and is not itself on a hidden edge (an inferred path never anchors another);
- every fact it cites names a place: an element's attribute (`attributes:<element>#<key>`), a control (`control:<id>`), one of this model's exposures (`exposure:<id>`), or a knowledge-graph entry (`kg:<id>`, `kg-class:<id>`);
- with module 0.2.0, its explanation holds to the candidate and to what this run read: every way in starts at the candidate's source and reaches its target, rests on one of its findings, and has its tier; every element, finding and remedy it names is one this run read. Every text the module wrote is cleaned before you see it.

A candidate a decision already covers is not shown either: it is counted under **excluded by decision**.

**The analyst argues; it adds nothing.** With module 0.2.0, it argues about the row's `path`: whether code can run at the starting point, whether the credential can be read or intercepted there, whether the target accepts it, and whether one of the rule's assumptions fails here; a remedy the module names is a place it looks for a stop. The hidden-edge-analyst reads the model's files and the project's source and configuration files that bear on a candidate's two ends, and looks first for what would prove the path wrong: a network policy, a firewall rule, credential scoping. `for` and `against` need positive evidence; anything less is `unclear`. It cites evidence as **locators only** (`source:<file>:<line>`, `attributes:<file>#<key>`, `platform:<id>`, `kg:<id>`), never a quoted value, and never opens a secret file. It cannot write, and it never proposes an edge, a direction or a kind of its own.

---

## Working With Teammates

`.dethereal/hidden-edges-decisions.json` is committed with the model, so the decisions travel through your repository.

- **A teammate's reject stands for you too.** A rejected decision is not signed: it only keeps a candidate out of a review, so it counts on every machine.
- **A teammate's accept is not verified on your machine.** An accepted decision is signed with the key of the machine that made it. The run header counts it as `not_verified_here`. On your machine its flow counts as an ordinary flow, in every check (see [Hidden Edges in the Checks](#hidden-edges-in-the-checks)), and the platform may propose the same edge to you again. Accept it to make it yours: the accept uses the flow already in the files and adds your own signed decision.
- **The latest decision stands.** For each edge, the latest of the accepts verified here, the rejects and the releases counts; when the latest is a release, no decision stands, and the edge can be proposed again. A teammate's later reject or release takes your accept back: the flow then counts as an ordinary flow in your checks, and stays in the files until someone removes it. A release is not signed either, so it counts on every machine that knows it (see [Taking an Edge Back](#taking-an-edge-back) for Dethereal 0.7.0).
- **A push keeps your decisions.** A push gives new flows their platform ids; Dethereal moves the accepted decisions this machine signed onto the new ids. A decision it cannot verify is left as it is, with a warning.

On the platform, a flow of a hidden-edge class is an inferred path for everyone, whoever accepted it.

---

## Taking an Edge Back

To take an accepted edge back, remove its flow:

```
> /dethereal:remove Credential reuse: Orders Service → Payments DB
```

Before anything is removed, the remove command asks how to take the edge back. It shows the plan's lines, for example:

```
Platform model "Payment API" (6b1f0c52-9e2d-4c1a-8f3e-2a7d5e4b9c10)
Taking back the hidden edge Credential reuse he:3f9c2a1b7d4e5f60, flow 9e4c2b17-3a5d-4f80-b6e1-7c2d9a0f5b38: the flow is removed only after a reject or a release is recorded
  reject: the edge was never real; it is kept as a reject, and is not proposed again
  release: it was fixed, or is no longer wanted; it is not kept out, and if its grounds return the module proposes it again
  cancel: nothing is recorded, and the flow stays, accepted
1 exposure(s) it cites are affirmed; if the edge was their only ground, clear them in /dethereal:triage:
  "Shared Database Credentials" (Orders Service)
```

Then it asks:

```
Take back this hidden edge? Type reject (it was never real), release (it was fixed, or is no longer wanted) or cancel (the flow stays).
```

| Answer | What is recorded | The flow |
|--------|------------------|----------|
| `reject` | A rejected decision: the edge is kept out, and is not proposed again. | Removed, after the decision is written |
| `release` | A released decision: your accept is dropped, nothing keeps the edge out, and the module proposes it again while the findings it rests on still hold. Use it when the path was fixed, or you no longer want the edge in the model. | Removed, after the decision is written |
| `cancel` | Nothing. | Stays, still accepted |

Anything else records nothing, and the question is asked again. **A take-back needs no sign-in.** Signed out, or with the platform unreachable, the plan cannot list the findings the edge affirmed, and says so instead: `The findings this edge affirmed could not be listed (not signed in); check them in /dethereal:triage` (or `(the platform could not be reached)`). A `reject` or `release` is still recorded, and the remove goes on. **The decision is written before the flow is removed**, so an accept never stands without its flow: if the commit is refused, nothing is removed. Then push, so the platform drops the flow too.

**An older Dethereal does not know a release.** `released` is a new decision in the same decisions file (version 1). Dethereal 0.7.0 counts it as malformed and reads the rest of the file, so where the earlier accept verifies under 0.7.0, it still stands: that machine keeps the edge accepted until it is upgraded.

The plan lists only the findings this edge's own accept affirmed (a finding affirmed in triage is not the edge's to mention). They stay affirmed: clear them in [`/dethereal:triage`](TRIAGE.md) if the edge was their only ground. Removing a hidden edge never makes a REVIEWED model stale.

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
| `dataflows.json`, `attributes/dataFlows/<id>.json` | Each accepted edge's flow and its attribute file, and, after a pull, each flow accepted in the Hidden edges workspace. Committed with the model. |
| `.dethereal/hidden-edges-decisions.json` | The **decisions file**: every accept (signed with this machine's key), reject and release. Committed with the model, so teammates share it. At most 1500 decisions. |

### On This Machine

| Path | What it holds |
|------|---------------|
| `.dethereal/hidden-edges-log.json` | The **hidden-edge record**, this machine's own: every reply each review received and every answer to the apply question, recorded before it takes effect, and each publish to the Hidden edges workspace (what was sent, where, and the answer). A reply that holds this session's credentials, is over 2,000 characters or holds invisible characters is kept only as its first 200 characters (credentials redacted), its length and its hash. Kept out of git: Dethereal lists it in the model's own `.dethereal/.gitignore`. It keeps the last 20 unpublished reviews and stays under 896 KiB, dropping the oldest unpublished reviews first. A published review is never dropped, and the count of 20 does not apply to it, since it is the record of what left this machine. When the record is over its size with only published reviews left to drop, the newest 5 published reviews stay whole, and older ones are compacted to their ids, their time stamps, their publishes and the answers behind those publishes (their replies, other answers, and refused or cancelled answers are dropped). One review records at most 70 replies and 40 apply answers. |

An **open review** is not on disk: it lives only in the server's memory. At most 20 are held, one unused for 2 hours expires, and a restart of the server forgets it.

---

## Troubleshooting

| Code | What happened | What to do |
|------|---------------|------------|
| `push_first` | The model has local changes the platform does not have. | Push (`/dethereal:sync push`), then run hidden edges again. |
| `pull_first` | The platform model changed since your last pull or push: in the editor, or an edge accepted in the Hidden edges workspace. Checked at open, and again at prepare and at commit when the review accepts an edge. Nothing was written. | Pull (`/dethereal:sync pull`), then run hidden edges again. |
| `platform_unread` | The platform model could not be read to check it for changes. | Try again. |
| `baseline_unavailable` | This machine cannot keep a record of the platform model; the message names the cause. A pull does not help. | Fix the cause the message names (the home directory, the project root, where this machine's key folder lies, or a key file that is a symbolic link, readable by others, or not a key), then pull. |
| `reason_invalid` | An analyst's reason holds this session's credentials, before or after cleaning, or is longer than 300 characters. The reason is never stored or sent. | Nothing: the run sends that return's arguments again with that candidate's reason left out, so its stance and locators are still held. |
| `review_has_replies`, `nothing_to_publish`, `review_late`, `echo_too_large` (publish) | The review cannot be published: it has a reply here, no edge can be sent, it opened more than 30 minutes ago without the edges' state, or the publish is too large to show whole. Nothing was sent. | Decide the review here, or open a new review to publish. |
| `session_refused` (publish) | The platform refused your session. Nothing was sent; the plan stands. | Sign in when asked: the run makes the same publish call again. |
| `module_not_loaded`, `workspace_unavailable` (publish) | The platform has no Hidden edges workspace, or it could not be read. Nothing was sent. | Decide the review here, or try again later. |
| `write_error` (publish) | The publish was sent but not confirmed. | The run reads back what the workspace holds, and prepares the publish once more when it holds nothing. |
| `publish_refused` | The workspace refused the publish. Nothing was stored. | The run prepares again once; otherwise decide the review here. |
| `review_published` | The review was published to the Hidden edges workspace, where it is decided. | Ask what became of it, or open a new review. |
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
| `record_full` | The review has recorded 70 replies, and takes only `done` or `accept-all`; or 40 apply answers, and takes none. Or the record is still over its size after its older published reviews were compacted. | Close the review; run again for the rest. When the record is at its size: copy `.dethereal/hidden-edges-log.json` elsewhere to keep it, then move it aside and try again. |
| `record_too_large` | The review's record has grown too large to write. Nothing was taken. | Run hidden edges again: an open review is let go at once, so a new one can open. |
| `record_unwritable` | `.dethereal/hidden-edges-log.json` cannot be read or written. Nothing was taken. | Move the file aside, then run again. |
| `plan_not_found`, `plan_used`, `busy`, `lines_differ`, `other_model`, `plan_other_model` | The plan is not held, was already used, is being committed, or was made for another model; or the lines passed back are not the ones shown. Nothing was written. | Run hidden edges again. |
| `reply_not_answer` | The answer to the apply question was neither `yes` nor `cancel`. Nothing was written. | Answer `yes` or `cancel`. |
| `argument_invalid` (`accept … affirm`) | A finding number the candidate does not cite, a finding that is not pending with no disposition, one another accept already affirms, or a note that is empty, more than one line, over 1,900 characters, or holds this session's credentials. Nothing changed. | Run `show <n>` for the numbers and the `affirmable` marks, then reply again. |

---

**Next:** [Triaging Platform Findings](TRIAGE.md) — review the findings a hidden edge rests on
