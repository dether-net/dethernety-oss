---
title: 'Triaging Platform Findings'
description: 'Review the exposures of an analysed model with AI-assisted proposals, decide each group, and apply your decisions as dispositions'
category: 'documentation'
position: 10
navigation: true
tags: ['dethereal', 'triage', 'exposures', 'dispositions', 'analysis']
---

# Triaging Platform Findings

After the platform analyses your model, its elements carry **exposures**: findings a module derived from each element's class and attributes. Triage works through the ones still waiting for review. It groups them, gathers the evidence for each group, has an AI agent propose a disposition, and puts every proposal to you. You decide, and Dethereal writes only what you approved, after you answer the apply question.

This page shows the Claude Code form of the command; see [Running Triage](#running-triage) for the Codex and OpenCode forms.

---

## What Triage Does

**The run proposes; you decide.** Triage never writes a disposition on its own. Every write takes two steps: Dethereal prepares a plan and shows you what each write does, then writes it only if you answer `yes` to the apply question. Nothing is written before that question.

A triage run:

1. Reads the model's exposures from the platform and groups the **pending** ones by finding definition.
2. Builds an evidence dossier for each group: the exposure's platform record, the element's local attributes, the source files discovery found the element in and, when the platform serves the knowledge graph, the rule that raised the finding.
3. Has the **triage-analyst** agent propose a disposition for each group, with a confidence level and citations. When the knowledge graph is available, the **kg-cross-examiner** agent then argues against each proposal that would mute or rewrite a finding the graph covers.
4. Shows you the proposals and takes your decisions, one command per reply.
5. Prepares the writes, shows you what each one does, and asks whether to apply them.

Both agents only read; neither writes anything.

A proposal is one of:

- **Affirm** (`AFFIRMED`): the finding is real; it stays live, now marked as reviewed.
- **Dispose** as `NOT_APPLICABLE` or `FALSE_POSITIVE`: the finding is muted.
- **Supersede**: the finding is replaced by an edited copy (a different name, description, score, attack vector, category or technique list), and the original is marked `SUPERSEDED`.

`COMPENSATING_CONTROL` and `RISK_ACCEPTED` are never proposed: only you choose them, with your own rationale. For what each disposition kind means on the platform, see [Managing Findings](../MANAGING_FINDINGS.md).

**Triage's verdicts assume a capable model.** Dethereal pins no model: the triage agents run on the model your harness gives them, so the proposals are only as good as that model.

---

## Before You Start

- **You are signed in** to the platform (`/dethereal:login`). If you are not, triage asks you to sign in first; if the platform refuses your session later in the run, it asks again and then carries on.
- **The model is synced.** Triage reads the exposures of the platform model the directory was pushed as (see [Sync and Version Control](SYNC_AND_VERSION_CONTROL.md)). A model that was never synced is refused, and the run stops.
- **A platform analysis has run** on that model. Without one there are no exposures, and triage stops with:

  ```
  No exposures found — the platform analysis has not run for this model. Run an analysis on the platform, then retry.
  ```

**Local sources give full evidence.** Triage's strongest evidence needs `structure.json`, `attributes/` and `.dethereal/discovery.json` in the model directory, as a model built or discovered with Dethereal has. If any of them is missing, triage names the missing ones and asks:

```
Local sources not found — triage will use platform data only (weaker evidence; confidence is capped at medium). Continue? (continue / stop)
```

`stop` ends the run with nothing changed. `continue` makes the run **platform-only**: the run header says so, and no proposal is above medium confidence.

In a full run, a single member whose attribute file, discovery entry or sources cannot be found is **platform-evidence-only**: it is capped at medium and named in the run notes.

**Secret files are never read.** A dossier lists source paths with line numbers, never excerpts; the triage-analyst reads the files it cites. A source in a secret file is listed as "secret file, not read", and a path outside the project as "outside the project, not read"; neither is opened, and no proposal may rest on them.

---

## Running Triage

| Harness | Command |
|---------|---------|
| Claude Code | `/dethereal:triage` |
| Codex | `$dethereal:triage` |
| OpenCode | `/dethereal-triage` |

```
> /dethereal:triage [directory-path] [--stale] [--element <id>]
```

| Argument | Effect |
|----------|--------|
| `directory-path` | The model directory. Without it, triage uses the working directory when it holds `manifest.json` and `.dethereal/sync.json`; otherwise it finds the model as other commands do (a single model is used; with several, you choose). |
| `--stale` | Reviews stale dispositions instead of pending findings: see [Reviewing Stale Dispositions](#reviewing-stale-dispositions). |
| `--element <id>` | Triages only that element's findings; the partition table still counts the whole model. An id that names no element stops the run: `No element <id> in this model.` |

When nothing is pending, triage shows the partition table and stops:

```
Nothing pending to triage. <N> stale dispositions exist — run /dethereal:triage --stale to review them.
```

The second sentence appears only when stale dispositions exist.

---

## The Run

### The Run Header

The run header is the next message after the knowledge-graph check, with nothing before it. It names:

- the model's name and id;
- the evidence mode: `full` or `platform-only (confidence capped at medium)`;
- how many findings are triaged, and the `--element` scope when you gave one;
- the **knowledge-graph line**: the notice the check returned, exactly as written. When the graph is available, there is no line. See [Triage With and Without the Knowledge Graph](TRIAGE_AND_THE_KNOWLEDGE_GRAPH.md) for each notice.

The header carries the knowledge-graph line once; nothing later in the run repeats or rewrites it.

Then comes the **partition table**: the model's findings counted as pending, confirmed and disposed, the stale ones among them, and who created them (`SYSTEM` or `USER`). Your own (USER-created) pending findings are listed by name and element; triage never dispositions them. A last line counts the elements with no exposures, and names them when there are ten or fewer.

### The Proposals Table

The table is shown in full before the first review question. It numbers the groups `1..N`, and the numbers never change once shown. Its sections, in order:

1. **High confidence**: `# | Exposure (group) | Elements | Verdict | Kind | Confidence | Reason (first line) | Evidence`. The Evidence cell summarises where each fact came from. A supersede row also shows its technique change (for example `+T1078.001 −T1071.005`), the fields it changes, a note when the original has references the copy will not carry and, with the knowledge graph, `[breaks KG linkage: <corpus ids>]`.
2. **Medium confidence**: the same columns.
3. **High-severity mutes**: proposals that would mute a finding scoring 7.0 or more, and supersedes that take a score from 7.0 or more to below it. They are capped at medium and marked **per-row only: no bulk verb takes these**: `accept-all` skips them, and `accept <n>` takes them one by one.
4. **Needs human**: the groups only you can decide, each with its one-sentence ambiguity. They include low-confidence proposals, a compensating-control proposal (with the analyst's reason and the control it names), a kind the analyst may not propose (with the analyst's view), a cross-examiner's objection (with **both views**, each attributed), and a member with a customized copy from an earlier supersede, which is recovered in the platform UI rather than superseded again.
5. **Run notes**: platform-evidence-only members, customized-copy markers, downgraded proposals, notes on the agents' returns, proposals the platform would refuse, the knowledge-graph notes, and sources not read.

A row the knowledge graph could not be used or read for carries `[no knowledge-graph evidence]` in its Evidence cell. A class the graph has no rules for, or a finding whose rule the class does not have, shows no graph evidence and no marker. See [The Marker](TRIAGE_AND_THE_KNOWLEDGE_GRAPH.md#the-marker) for the four cases.

**Large runs.** From 5 groups or 25 exposures, the table is compact: reasons shrink to their first line and member lists to counts; `show <n>` always shows a group in full. A run holds at most 999 groups (the rest wait for the next run, and the summary says how many). A review holds at most 200 exposures: a larger one runs **in parts**, each with its own table, review and apply question.

---

## The Review

Before the first question, triage shows the commands:

```
Commands — one per reply:
  accept <n> [<n> …]                     skip <n> [<n> …]          show <n>
  edit <n> rationale: <text>
  edit <n> kind: <KIND> [rationale: <text>]
      KIND: AFFIRMED · NOT_APPLICABLE · FALSE_POSITIVE · COMPENSATING_CONTROL · RISK_ACCEPTED
  accept-all (closes the review)         done (closes the review)
```

Then it asks, again after every reply, until the review closes:

```
Your command? One command per reply: accept, skip, show, edit, accept-all or done, as the hint above shows.
```

| Command | What it does |
|---------|--------------|
| `accept <n> [<n> …]` | Accepts the proposal of each group named. Not open to a needs-human group. |
| `skip <n> [<n> …]` | Leaves each group named undecided: nothing is written for it. |
| `show <n>` | Shows one group in full: its decision so far, the dossier's facts, the evidence and citations and, with the knowledge graph, the corpus citations. |
| `edit <n> rationale: <text>` | Replaces the group's reason with your own. |
| `edit <n> kind: <KIND> [rationale: <text>]` | Changes the group's kind, and its reason when you give one. |
| `accept-all` | Accepts every undecided group except the needs-human and per-row-only ones, and closes the review. |
| `done` | Closes the review; every undecided group is skipped. |

The rules:

- **One command per reply.** A later decision on a group replaces an earlier one. Skip is the default: nothing is accepted silently.
- **A rationale is needed** for `COMPENSATING_CONTROL` and `RISK_ACCEPTED` (for a compensating control, the rationale names the control), and for any edit that decides a needs-human group. Decide such a group with `edit <n> kind: <KIND> rationale: <text>`; the rationale may come from an earlier edit of the same group. `kind:` comes before `rationale:`.
- **A rationale is one line**, of at most 1800 characters.
- **A supersede is accepted or skipped**, never edited.
- **A refused reply changes nothing.** Triage shows the refusal as the server gave it, then asks the question again. Most refusals restate the commands, ending with the ones that close the review.

Each reply goes to the server exactly as you typed it, and is recorded in the [triage record](#on-this-machine) before it takes effect. After each reply, triage shows the command as it was read and each group whose decision changed.

A short review might go:

```
> accept 1 2 4
> edit 3 kind: COMPENSATING_CONTROL rationale: The edge WAF rule set blocks this path (control "Edge WAF")
> skip 5
> done
```

---

## The Apply Question

When the review closes, triage prepares the writes and shows you the result before anything else.

### What Prepare Shows

- the number of operations ready to write;
- every operation, with the rejected ones set apart and their codes;
- the **lines**, unchanged, in one block: what each write does, and why a rejected one is not applied.

For example, the plan of a different, smaller review, one that accepted group 1 and decided group 3 with an edit:

```
Platform model "Payment API" (6b1f0c52-9e2d-4c1a-8f3e-2a7d5e4b9c10)
2 write(s): 2 dispose, 0 supersede, 0 clear, 0 reaffirm; 0 replace a disposition; 1 set COMPENSATING_CONTROL or RISK_ACCEPTED; 0 not applied
Group 1: dispose as AFFIRMED with "Admin API is reachable from the partner network — AI-assisted triage, operator-approved": "Unauthenticated Admin Endpoint" on "Admin API" #…41c2e9a7
Group 3: dispose as COMPENSATING_CONTROL with "The edge WAF rule set blocks this path (control \"Edge WAF\") — AI-assisted triage, operator-edited": "SQL Injection" on "Orders Service" #…b83d0f16
```

How to read the lines:

- Every text is in double quotes; a `\"` inside one is a quote within the text.
- Each exposure reads `"<name>" on "<element>" #<id>`; a long id is shortened to its tail, `#…<tail>`.
- A finding's name, an element's name, a replaced reason and a value a supersede replaces are each cut to 160 characters, ending with `…`.
- A write that replaces a disposition adds `(replacing <KIND>: "<reason>")`.
- A supersede reads `create "<copy>" on "<element>"`, the element the copy is created on, then each changed description, score, attack vector or category as old → new, and a new name and the techniques added or removed as they are.
- A rejected operation is on a line of its own: `Not applied (<code>): <why>: …`.

When no operation is ready, triage says nothing will be written, and does not ask the apply question.

### Approving the Tool Prompts

Your harness asks you to approve the prepare call and then the commit call. **Approve each prompt on its own, never with an "always" choice**: one standing approval would let a later write through without the apply question.

### Answering

```
Apply N dispositions? Type yes or cancel.
```

Your reply goes to the server as you typed it:

- `yes` writes the plan.
- `cancel` writes nothing: `Cancelled. Nothing was written.` In a run in parts, nothing more is written, and the earlier parts stand.
- Anything else writes nothing, and the question is asked again.

**A changed model means prepare again.** Before writing, Dethereal reads the model again. If any finding in the plan changed since prepare (`plan_stale`), or the plan is more than 30 minutes old (`plan_expired`), nothing is written: triage prepares again from the same review, shows you the new result, and asks the apply question again.

### Outcomes

Triage shows one line per operation:

| Outcome | What it means | What to do |
|---------|---------------|------------|
| `applied` | The write is done. | Nothing. |
| `failed` | Not confirmed applied, with the server's code and message. A failure never stops the other writes. | Run triage again: only findings still pending come back. If the line names a copy that was created but is incomplete, delete that copy in the platform UI first; the original is untouched. |
| `partial`, kind `SUPERSEDED` | The copy exists and the original is marked `SUPERSEDED`, but the copy lacks the original's content. | Add what the error names to the copy in the platform UI. |
| `partial`, no kind | The copy exists; the original may still be live. | Check the original, and dispose it as `SUPERSEDED` in the platform UI if it is live. Do not run triage on that finding until then: a new proposal would make a second copy. |

A row can also carry a content warning. Then comes the summary, with the counts (affirmed, disposed by kind, superseded, skipped, needs-human left, rejected, failed) and a fresh partition of the model. When a write failed, triage adds once: "'failed' means not confirmed applied — a lost response may have applied server-side; re-running triage is safe (only still-pending findings re-enter)."

The run ends with:

```
[done] Triage: <a> affirmed, <d> disposed, <s> superseded, <k> skipped, <h> needs-human left.
[next] When you're ready: /dethereal:triage (to continue with what is still pending)
```

---

## Publishing to the Triage Workspace

When the platform has the `dethermine-review` module, its **Triage workspace** is where a person decides a model's findings in the browser. Instead of deciding a review here, you can publish its proposals there: a person accepts, edits or rejects each one in the workspace, and the platform writes the decision. **A publish writes no disposition.** It stores the proposals on the model's Triage analysis, under your name.

### The Workspace Line

After the review opens, triage shows one line about the workspace:

| Line | What it means |
|------|---------------|
| `Triage workspace: available (dethermine-review <version>) — proposals can be published for a person to decide.` | The module is on the platform; the review can be published. When proposals from an earlier publish still wait there, the line adds `<n> proposal(s) from an earlier publish are still waiting there.` |
| `Triage workspace: not found on this platform (no dethermine-review module, or one too old for publishing).` | The platform has no `dethermine-review` module that can take a publish: decide the review here |
| `Triage workspace: not checked (<detail>).` | The platform could not be asked; the detail says why |

At open, Dethereal asks the platform whether the module is there, finds the model's Triage analysis if one exists, and reads the findings' fingerprints and any proposals still waiting from an earlier publish. Open never creates an analysis.

### Here or Publish

When the workspace is available and the review has no reply yet, triage asks this in place of the review question:

```
Decide these proposals here, or publish them to the platform's Triage workspace for a person to decide there? Here: you decide group by group, and what you accept is written as dispositions after an apply question. Publish: no disposition is written; the proposals go to the Triage workspace under your name, and this review closes here. Either way you see everything before it is written or sent. (here / publish)
```

It is asked once per run (for a run in parts, before the first part, and the answer carries to every part), and again after a cancelled publish. `here` goes on with [The Review](#the-review): the commands, then the review question. `publish` goes on below.

### What the Publish Plan Shows

Triage prepares the publish before any reply, and shows its lines unchanged, in one block:

```
Publish 2 groups (5 findings) to the Triage workspace of "Payment API", under your name, with the reasons as Dethereal's analysts drafted them. Findings: 3 proposes Not applicable · 2 proposes an edited copy.
It replaces 1 proposal still waiting there from an earlier publish (yours or another person's).
Group 1: proposes Not applicable — "TLS Disabled" on "Orders DB" #…7c2e41a9; "TLS Disabled" on "Ledger DB" #…0b83d16f; "TLS Disabled" on "Audit DB" #…e91f4c20
  Reason: "The flows to these stores run inside the cluster network only"
  Analyst confidence: high (an AI estimate, not a verdict)
  Citations: attributes:attributes/orders-db.json, source:deploy/network-policy.yaml:12-30
Group 2: proposes an edited copy — "Weak Password Policy" on "Admin API" #…5d2a7e13; "Weak Password Policy" on "Partner API" #…a46c90b2
  The copy: score 7.5 → 5; techniques added 3f1c9e2a-6b7d-4e08-9c51-2d8f0a7b4e66
  Analyst confidence: medium (an AI estimate, not a verdict)
To the model's Triage analysis 3f6c2a10-8e4b-4d17-9a52-7b0e1c9d4f38.
Sent with each: the reason as drafted, the analyst's confidence, the objection and what to weigh, an edited copy's fields, the citations (file and line locators, no repository text), and the state it was judged on. No disposition is written.
```

The lines name:

- the count, the model, and what the findings propose, by kind;
- `It replaces <n> proposal(s) still waiting there …`, second, when there are any; the publish question then says so too. When the waiting proposals cannot be counted, the line is `The proposals still waiting there could not be counted; this publish replaces any that are.`, and the question says it replaces any;
- `More than 30 minutes have passed since the review opened: every proposal goes flagged for a person, so the workspace shows no Accept and each is decided with Edit or Reject; no edited copy is sent. To avoid this, cancel and run triage again.`, when that applies (see [The Window After Open](#the-window-after-open));
- every group: what it proposes (`proposes <kind>`, `proposes to reaffirm the decision`, `proposes to clear the decision`, `proposes an edited copy`, or `no proposal, for a person to decide`), `, flagged for a person` and `, one at a time` when they apply, and its findings;
- each group's reason, an edited copy's values (old → new, and the technique ids added or removed), the analyst's confidence, the objection, what a person must weigh, and the citations;
- `Not sent (<n> items):`, then one line per group or finding left out, and why: changed since the review (judge it again), a current decision the workspace cannot carry, a reaffirm of a decision no person picked, a clear with no decision to clear, an edited copy past the window after open, a superseded finding in a stale sweep, or a finding no longer in the model;
- where they go: the model's Triage analysis, or `Creates the model's Triage analysis on the platform (none exists yet).`

Every text is in double quotes, with a `"` or `\` inside it escaped; a long name is cut to 160 characters. When nothing in the review can be sent, prepare refuses `nothing_to_publish`, and the review goes on here.

### What Is Sent, and What Is Never Sent

For each group, the workspace gets:

- the proposal: a dispose's kind and its **reason as drafted** (the triage marker is not part of it; the workspace adds it when a person accepts), or a supersede's edits (the changed fields, and the techniques added and removed), or a reaffirm or clear with no kind or reason;
- the analyst's **confidence**;
- a second reviewer's **objection**, and the **ambiguity**, what a person must weigh;
- the **citations**, as locators only: `platform:<field>`, `kg:<id>`, `attributes:<path>` and `source:<path>:<line>[-<line>]`;
- whether a person must decide it, and whether it goes one finding at a time;
- each finding's id, its **base** (the disposition kind and time it was judged on) and its **fingerprint**, the platform's digest of the facts it was judged on.

The publish also carries the **review id**, so the workspace can group the proposals as you saw them.

**Never sent:** Dethereal sends no file content; the texts it drafted are shown to you verbatim before you confirm. A citation names a file and lines; it never quotes them, and a secret file's content is never read into a proposal. Open refuses a citation that is not a locator, one to a secret file or outside the project, and a `source:` file that discovery did not read (`citation_invalid`).

### Approving and Answering a Publish

Your harness asks you to approve the prepare_publish call and then the publish call: **approve each prompt on its own, never with an "always" choice**, as for a commit. Then:

```
Publish 2 groups (5 findings) to the Triage workspace? It replaces 1 proposal still waiting there. Type yes or cancel.
```

The middle sentence appears only when the publish replaces waiting proposals; when they cannot be counted, it says `It replaces any proposals still waiting there, which could not be counted.`

- `yes` sends the plan, after checking it still holds (below). It finds the model's Triage analysis, or creates it, with an id every machine and harness derives the same way, so two publishes of one model meet in one analysis.
- `cancel`: `Cancelled. Nothing was sent.` Triage asks the here-or-publish question once more.
- Anything else sends nothing, and the question is asked again.

**A plan that no longer holds sends nothing** (`plan_stale`): a reply was given to the review here since prepare, the review was published since, the model's Triage analysis changed, a finding changed, or 30 minutes passed since the review opened with the fingerprints still to read (checked before any analysis is created). A plan more than 30 minutes old is `plan_expired`. Either way triage prepares again and asks again.

### Publish Outcomes

The workspace answers per finding:

| Result | What it means |
|--------|---------------|
| `stored` | The proposal waits in the workspace |
| `stored_stale` | Stored, but the finding changed since the review: the workspace shows it stale |
| `already_decided` | Not stored: a person already decided it |
| `rejected` | Not stored: a person rejected this proposal, and the finding has not changed since |
| `changed_since_review` | Not stored: someone decided it after the review (in the platform or the workspace), so the proposal no longer applies |
| `finding_not_found` | Not stored: it is no longer in the model |

The run ends with no apply question and no task list:

```
[done] Triage: <stored> of <F> findings (<G> groups) published to the Triage workspace; <n> not stored, see above; nothing written as a disposition.
[next] When you're ready: decide them in the platform's Triage workspace, then ask me what became of them.
```

`<stored>` counts `stored` and `stored_stale`. With nothing stored, it ends instead:

```
[done] Triage: nothing stored in the Triage workspace; <n> not stored, see above; nothing written as a disposition.
[next] When you're ready: run triage again to decide here, or ask me what became of the earlier proposals.
```

- **`write_error`**: the publish was sent but no answer came, and the workspace may hold the proposals. Triage reads back what it holds first (below); when it holds nothing from this publish, prepare_publish again sends it once more, safely. When the read-back or that prepare is refused too, the run ends: `The publish was not confirmed and the workspace cannot be reached. No disposition was written. Ask me later what became of it, or run triage again to decide here.`
- **`publish_refused`**: the workspace refused the publish, and nothing was stored. The first time, naming no field, triage prepares again and asks again. Naming a field (the workspace module and this Dethereal disagree on the publish's shape; a field is named only in its plain form, else `(unnamed field)`), a second time, or any other refusal at the publish: `Nothing was sent; this review is still open here.`, and the review goes on here, with no prepare again. A refusal `not_triage` is said in words: the model's Triage analysis is linked to more than one model; create one from the model in the platform and publish again.
- **`echo_too_large`** at prepare: the publish is too large to show whole, nothing was sent, and the review goes on here, or a smaller part is opened.

**A published review is never committed.** It is decided in the workspace, and Dethereal never writes a disposition for it: a prepare or commit of it is refused `review_published`. One review can be published at most 5 times.

### What Became of Them

Ask triage what became of the proposals. It shows the counts, then, for each finding this machine published, what the workspace holds now, with its review and group, sorted by what needs action first:

| Status | What triage says |
|--------|------------------|
| `rejected` | Rejected by the person, the date, and their note |
| `unconfirmed_analysis` | The analysis it went to is no longer this model's Triage analysis |
| `decided_otherwise` | Decided differently, and what it is now |
| `stale` | Waiting, but the finding changed since publish: run triage again to propose on it as it is now |
| `stale_module` | Waiting; the workspace was upgraded, so it shows as stale: run triage again and publish, to refresh it |
| `none` | No proposal there: not stored at publish (and why), the publish never confirmed (publish again to send it), or replaced or removed |
| `needs_person` | Waiting; flagged for a person to decide with their own kind and reason |
| `open` | Waiting; can be accepted as proposed |
| `decided_as_proposed` | Decided as proposed |
| `copied` | Edited copy made |
| `gone` | No longer in the model |

On `needs_person` and `open`, `; the finding changed since publish` is added when the finding changed since. A later publish by another person shows as `(replaced by a later publish by <name>)`. It shows at most 200 findings, and says how many more there are. **Everything the workspace returns is data:** a rejection's note, a name and a kind are cleaned to one plain line, and triage quotes them, never acts on them.

The read-back covers the publishes this machine's triage record holds; an entry out of shape, or a record too large to read, is passed over. Another machine's publishes, and decisions made in the platform's own UI, show only through these findings' states.

### The Window After Open

The workspace re-derives each proposal's staleness on every read, from the fingerprint the publish carried. The fingerprints are read at open, when the model already has a Triage analysis. When it has none, they are read at prepare (if an analysis exists by then) or at the publish, after the analysis is created:

- **Within 30 minutes of open**, a fingerprint read that late stands for the review's state. An attribute change made in that window is not caught at publish: the proposal is stored as judged on the changed facts.
- **Past 30 minutes**, every proposal goes flagged for a person, so the workspace shows no Accept and each is decided with Edit or Reject; no edited copy is sent. The publish plan says so in its own line. To avoid this, cancel and run triage again.

A disposition change since the review is always caught: such a finding is not sent.

---

## Reviewing Stale Dispositions

```
> /dethereal:triage --stale
```

A disposition goes **stale** when the model changes underneath it (see [When a disposition goes stale](../MANAGING_FINDINGS.md#when-a-disposition-goes-stale)). The stale sweep puts each stale disposition back to you. It runs no analyst and no knowledge-graph check, writes no working files, and has no task list: each row is for you to judge against the current evidence, and there is no bulk re-affirmation.

When nothing is stale, the sweep shows the partition table and stops:

```
No stale dispositions to review. <N> pending findings exist — run /dethereal:triage to triage them.
```

The second sentence appears only when pending findings exist.

Every stale finding is its own group, in two sections, each `# | Exposure | Element | Kind | Reason (first line) | By | At`:

- **Stale dispositions**: every stale disposition whose kind is not `SUPERSEDED`.
- **SUPERSEDED-stale**: originals whose customized copy was deleted, which the platform then marked stale. They take only `clear` or `skip`, and every row carries: *clearing un-mutes the original that your deleted copy replaced*.

The commands:

```
Commands — one per reply:
  reaffirm <n> [<n> …]    clear <n> [<n> …]    skip <n> [<n> …]    show <n>    done (closes the review)
```

| Command | What it does |
|---------|--------------|
| `reaffirm <n> [<n> …]` | Keeps the disposition's kind and renews its reason, which becomes `<reason> [re-affirmed <YYYY-MM-DD> after model change] — AI-assisted triage, operator-approved`: the current reason, without an earlier triage marker or renewal note, then the date, in UTC. |
| `clear <n> [<n> …]` | Removes the disposition: an ordinary finding returns to pending; a SUPERSEDED-stale original is un-muted. |
| `skip <n> [<n> …]` | Leaves the disposition as it is. |
| `show <n>` | Shows the group in full and, when attribute files exist, the element's current attribute values. These are evidence of now only: no earlier values are stored, so no difference is claimed. |
| `done` | Closes the sweep; every undecided row is skipped. |

There is no `accept-all` in a sweep. The apply question, the outcomes and the summary are the same as above; the sweep ends with `[done] Stale sweep: <r> reaffirmed, <c> cleared, <k> skipped.`

---

## The Remediation Task List

Triage offers a task list only when the knowledge graph was available, the run applied at least one affirm, and at least one affirmed group's knowledge-graph evidence was read before the graph stopped answering (if it did):

```
Write the remediation task list for the findings this run affirmed? (yes / no)
```

`no` writes nothing. With `yes`, triage composes the list from what the run already holds; it runs no new analysis. The list opens with these two lines:

```
Task list derived from the threat model's attributes as of <date>; applying changes alters the model — re-run analysis and triage to confirm.
Citations reflect how the underlying exposure was authored, not the strength, severity, or priority of the finding. Absence of a citation is not absence of basis.
```

Then, per element:

- the attribute changes that would change each affirmed finding's trigger, as of this run, with `insufficient alone — condition group <N> also holds` where one change is not enough;
- where in the repository: the element's source files and the analyst's citations;
- how to verify: the class guide's steps and typical values, quoted as written, each whole on its own line;
- **candidate** controls, found by the attributes they share with those changes, never by technique match: *mitigate* and *detect* candidates, with an empty side said so;
- the finding's corpus citations.

Two closing lists name the findings affirmed in earlier runs, and those this run affirmed without knowledge-graph coverage. Nothing is dropped silently.

**The honesty rule.** The task list never claims that a change settles a finding. Triage hands the composed list to Dethereal, which checks it and writes it in one step. The check looks for these terms: addresses, closes, fixes, reduces, resolves, mitigates, lowers risk, moves to residual, planned-fixed, remediated, scheduled. The list is written only if none is found. Triage never writes the list, or a draft of it, any other way, and never edits the text to get past the check.

**Quoted guide text.** A line that quotes, whole, a class guide's step, its expected output or a typical value (at least 24 characters) is the guide's words, not the list's, and is not checked. Dethereal reads the guide itself to tell. A quote inside a longer sentence, or one that is cut or changed, is checked like any other line.

**Where it goes.** The list is written to `remediation-tasks-<YYYY-MM-DD>.md` in the run's folder (see [On This Machine](#on-this-machine)); the date is the run's own, from the folder name. The file is readable by you only. Dethereal never replaces a file; a file already there counts as written only when it is a plain file holding exactly this list, never a link. The run's last message names its path, so you can copy it out of `.dethereal/`.

**When it is not written.** The run's last message says `Remediation task list: not written (<why>)`:

- **Terms found.** Triage quotes the terms. A term in the composed text is a fault of the composition; a quoted source or a platform name can hold one too.
- **A file is already there.** Another file is at the path. Triage says this run neither wrote nor checked it: do not take it for the task list. The file is left as it is, and triage shows the list in the conversation.
- **Characters the list may not hold**, such as emoji, tabs or invisible characters: Dethereal names them, and triage composes the list once more without them. If that is refused too, it is handled like any other refusal.
- **Any other refusal**, such as a class guide that could not be read or a file that could not be written: triage shows the refusal, then the list in the conversation.

In each case the platform writes are already done, and they stand.

---

## What Is Written and Where

### On the Platform

Only the commit writes dispositions, and only after your `yes`. A publish writes none: after its own `yes`, it stores the proposals in the `dethermine-review` module's Triage workspace, on the model's Triage analysis, and creates that analysis when the model has none (see [Publishing to the Triage Workspace](#publishing-to-the-triage-workspace)). The commit writes:

| Operation | What the platform gets |
|-----------|------------------------|
| Affirm or dispose | The kind and the reason, with a **triage marker** appended: ` — AI-assisted triage, operator-approved` when the reason is the proposal's, or ` — AI-assisted triage, operator-edited` when it is your own rationale. A reason holds at most 2000 characters, marker included. |
| Supersede | A new, user-authored copy named `<name> (custom)` on the finding's element, `<name>` being the new name when the supersede changes it, with the proposal's changes. Its description ends with `(custom of '<original name>')`; the original's references, mitigations, detections and tags are copied; its techniques are the original's, with the additions and removals. The original is marked `SUPERSEDED` with the reason `Superseded by user-authored exposure '<copy name>'`. |
| Reaffirm | The same kind, with the renewed reason shown under [Reviewing Stale Dispositions](#reviewing-stale-dispositions). |
| Clear | The disposition is removed. |

### On This Machine

Triage keeps two things in the model's `.dethereal/` directory. Both are kept out of git: Dethereal lists them in the model's own `.dethereal/.gitignore`.

| Path | What it holds |
|------|---------------|
| `.dethereal/triage-log.json` | The **triage record**, this machine's own: every reply each review received, with what it did, and every answer to the apply question or the publish question. A reply takes effect only once it is recorded; if the record cannot be written, the reply is not taken. A reply of up to 2000 characters of plain text is kept verbatim; a longer one, or one with invisible or control characters, by its first 200 characters, its length and its sha256. A published review also keeps `published`: for each publish, when it was sent, the analysis it went to, its findings and their groups, the workspace's answer per finding, and when the fingerprints were read (at open, at prepare or at the publish). A publish whose answer never came is marked unconfirmed. This is what the read-back reads. |
| `.dethereal/triage-run/run-<YYYYMMDD-HHMMSS>/` | The run's working files: the evidence dossiers (`batch-<n>.md`), the cross-examination files (`xbatch-<n>.md`) and the remediation task list. Each run gets a new folder (a stale sweep writes none), and Dethereal never deletes them. |

**The record's caps.** The record keeps the last 20 reviews and stays under 896 KiB; the oldest reviews are dropped first, the active review is never dropped, and a published review never is, since it is the record of what left this machine: a record that holds only published reviews refuses a new one (`record_full`), and the message asks you to move `.dethereal/triage-log.json` aside to keep it. One review records at most 70 replies, 20 refused apply answers, 40 apply answers in all, and 5 publishes.

An **open review** is not on disk: it lives only in the server's memory (see [Troubleshooting](#troubleshooting)).

---

## Known Limits

- the server can't tell the operator's yes from the model's: the harness approval prompt is the gate;
- built-in sub-agents can reach `triage_review`, but they write nothing to the platform without the commit prompt;
- two harness sessions committing to one model don't hold each other back (each re-reads the model before writing);
- a Secret manifest under an ordinary file name relies on the secret guard when an agent reads it;
- the Codex main session's web search is the user's own setting; Dethereal's agent files turn it off;
- a publish whose fingerprints were read after open (no Triage analysis existed at open) does not catch an attribute change made in the 30 minutes after open; past 30 minutes every proposal goes flagged for a person (see [The Window After Open](#the-window-after-open));
- the read-back covers this machine's publishes only; another machine's publishes, and decisions made in the platform's own UI, show only through the findings' states;
- a publish replaces the proposals still waiting on its findings, yours or another person's, with no history.

One of these in more detail:

- **Secret manifests.** A Kubernetes Secret manifest under an ordinary file name is not caught by its name, so it relies on the [Secret-File Guard](AGENTS_AND_ARCHITECTURE.md#pretooluse--secret-file-guard).

---

## Troubleshooting

| Code | What happened | What to do |
|------|---------------|------------|
| `review_not_found` | An open review lives only in the server's memory: at most 20 are held, one unused for 2 hours expires, and a restart of the server forgets it. Nothing was written. | Open it again: run triage again. |
| `plan_expired` | The plan is more than 30 minutes old. Nothing was written. | Triage prepares again and asks the apply question again. |
| `plan_stale` | The model changed since prepare. Nothing was written. For a publish, also: a reply here since prepare, another publish of the review, a changed Triage analysis, or 30 minutes passed with the fingerprints still to read; nothing was sent. | Triage prepares again and asks the apply question (or the publish question) again. If the model directory now names another platform model, run triage again. |
| `echo_too_large` | The plan is too large to show whole: over the size the lines may take or, for a publish, over 400 lines. Nothing was written or sent. | Open a review of fewer groups. For a publish, decide the review here, or open a smaller part. |
| `record_full` | The review's record holds as many replies or answers as it can. During the review: it has recorded 70 replies, and from then on takes only `done` and, in a review, `accept-all`. At the apply question: it has recorded 20 refused answers, and from then on takes only `yes` and `cancel`; or it has recorded 40 answers in all, and takes none. Or the record is full (20 reviews, or its size) and every other review in it is published: a published review is never dropped, so the record refuses. | During the review: close it with `done` (or `accept-all` in a review); your decisions so far still go to the apply question. Run triage again for the rest. After 20 refused answers: answer `yes` or `cancel`. After 40 answers: the run stops; run triage again. When the record holds only published reviews: move `.dethereal/triage-log.json` aside to keep it, then try again. |
| `record_too_large` | The review's record has grown too large to write. Nothing was taken, not even `done`, and the run stops. An open review is let go at once; a closed review is kept for prepare. | Run triage again: a new review can be opened at once. |
| `record_unwritable` | `.dethereal/triage-log.json` cannot be read or written. Nothing was taken. | Move the file aside, then run triage again. |
| `plan_not_found`, `plan_used`, `busy`, `lines_differ`, `other_model`, `plan_other_model` | Prepare or the commit was refused: the plan is not held by the server (for example after a restart), it was already used, a commit of it is running, the lines passed back are not the ones prepare showed, or the review or plan was made for another model directory or platform model. Nothing was written. | Run triage again. |
| `not_synced` | The model directory has not been pushed to the platform, or its sync record names no model. Nothing was written. | Push the model to this platform first (see [Pushing to the Platform](SYNC_AND_VERSION_CONTROL.md#pushing-to-the-platform)), then run triage again. |
| `other_platform` | The model was synced with another platform than the one Dethereal is configured for; the message names both. Nothing was written. | Set the platform URL to the one the model was synced with (see [Configuration](GETTING_STARTED.md#configuration)), then run triage again. |
| `needs_operator_decision` | You used `accept` on a needs-human group, or an edit that decides one without a kind or a rationale. | Use `edit <n> kind: <KIND> rationale: <text>`, or `skip <n>`. |
| `reply_not_answer` | The answer to the apply question was neither `yes` nor `cancel`. Nothing was written. | Answer `yes` or `cancel`. |
| `module_not_loaded` | The platform has no `dethermine-review` module, so there is no Triage workspace. Nothing was sent. | Decide the review here. |
| `workspace_unavailable` | The Triage workspace could not be asked: the module did not answer, the model's Triage analysis could not be looked up or created, or the findings' state could not be read. Nothing was sent. | Decide the review here, or try the publish again later. |
| `review_has_replies` | The review already has decisions made here, so it is no longer publishable. Nothing was sent. | Finish it here, or open a new review to publish. |
| `nothing_to_publish` | Nothing in the review can go to the Triage workspace: every group or finding is left out (the plan's `Not sent` lines say why). Nothing was sent. | Decide the review here. |
| `review_published` | The review was published to the Triage workspace, where a person decides it: nothing is written here, and it is not published again unless its last publish was never confirmed (`write_error`). A commit refused for a publish never confirmed says so. | Read back whether it landed, or run triage again to decide here. |
| `plan_kind` | A disposition plan was passed to the publish, or a publish plan to the commit. Nothing was written or sent. | Use the plan as its prepare made it, or prepare the other kind. |
| `publish_refused` | The workspace refused the publish. Nothing was stored. A refusal that names a field (or `(unnamed field)`) means the workspace module and this Dethereal disagree on the publish's shape; `not_triage` means the model's Triage analysis is linked to more than one model. | The first time, naming no field, triage prepares again and asks again; a second time, or with a field named, the review goes on here. For `not_triage`, create a Triage analysis from the model in the platform and publish again. |
| `write_error` | The publish was sent but no answer came: the workspace may hold the proposals. | Read back what it holds first. When it holds nothing from this publish, prepare_publish again sends it once more, safely. |
| `payload_too_large` | The proposals are too large for one publish. Nothing was sent. | Open a review of fewer groups. |
| `citation_invalid` | A proposal cites something that is not a locator, a secret file, a path outside the project, or a source file discovery did not read. The review was not opened. | Triage drops that citation, notes it in the run notes, and opens the review again. |
| `review_open` | An earlier review of this model directory is still open. | Triage shows it, with its decisions so far; finish it (`done` closes it, skipping every undecided group), and this run's review follows. |
| `not_in_model`, `target_changed` | The model changed between the listing and the review: an exposure is gone, or no longer one triage reviews (it was decided since it was listed, or it is user-authored), or, in a stale sweep, no longer stale. Nothing was written. | Run triage again. |

For the knowledge-graph notices in the run header, see [Triage With and Without the Knowledge Graph](TRIAGE_AND_THE_KNOWLEDGE_GRAPH.md).

---

**Next:** [Triage With and Without the Knowledge Graph](TRIAGE_AND_THE_KNOWLEDGE_GRAPH.md) — what the knowledge graph adds to a run, and the notices you may see
