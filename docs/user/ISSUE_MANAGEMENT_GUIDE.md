---
title: 'Issue Management Guide'
description: 'Issue tracking, filtering, and management in Dethernety.'
category: 'issues'
position: 8
navigation: true
tags: ['intermediate', 'guide', 'detailed', 'issues', 'filtering', 'clipboard-workflow', 'merging', 'practical']
---

# Issue Management Guide

*Track remediation work in Dethernety: raising issues from context, filtering the board, and consolidating duplicates.*

## Issues Overview

An **issue** is a unit of tracked work. It carries a name, a description, a set of module-defined attributes, a comment thread, and links to the model elements it concerns.

Three things are worth knowing before you start:

- **Issues live in Dethernety.** They are created, filtered, edited, and closed entirely on the platform. Nothing is pushed to an external tracker — see [External system integration](#external-system-integration).
- **An issue's substance comes from its class**, and classes come from modules. The class decides which attributes the issue has.
- **Status is binary.** Every issue is either **open** or **closed**. Richer lifecycle states, where they exist, are *attributes* the class defines — a different field. See [Status: two different things](#status-two-different-things).

### Where issue classes come from

Issue classes are supplied by **modules**, the same way component and control classes are. The OSS `dethernety-general` module ships six:

| Class | What it records |
|-------|-----------------|
| **Architecture anti-pattern** | A structural design flaw and the technical debt it carries |
| **Configuration Error** | A misconfiguration, its environment, and its root cause |
| **Missing Security Control** | A control that should exist but doesn't, and the plan to add it |
| **Threat Vector** | A STRIDE-categorised threat, its likelihood, and the actor behind it |
| **Vulnerability** | A software flaw, with CVE id and CVSS score |
| **Other** | Anything the five above don't describe |

This is **not a closed list** — a deployment with additional modules installed will offer their issue classes too, everywhere issue classes are offered. If none of the available classes fits, the answer is a module that supplies one; see [Understanding Modules](UNDERSTANDING_MODULES.md).

All six shipped classes define a **severity** (`critical` / `high` / `medium` / `low`) and a **status** attribute. The status *values* differ per class — a Vulnerability moves `new → confirmed → in-progress → fixed → verified → closed`, while a Threat Vector moves `identified → analyzing → mitigating → monitored → resolved → accepted`. Threat Vector additionally carries **likelihood**; Vulnerability additionally carries **cveId** and **cvssScore**.

## Creating Issues

Creation always works the same way: you pick an **issue class**, and the issue is created immediately. There is no dialog that asks for a name and a type before the issue exists — you name it afterwards.

### From the Issues page

1. Click **Issues** in the main navigation.
2. Click the **+** button at the top right of the issue list. Its tooltip reads *New issue*.
3. The button expands into **one button per issue class**. Click the class you want.
4. The issue is created straight away, named `New <Class> Issue`, and its card expands in the list.
5. Rename it on the **General** tab, fill in the **Attributes** tab, and save.

An issue raised this way starts with **no associated elements**. Add them from the **Associated Elements** tab, or raise the issue from context instead.

### From an element

Open a component, security boundary, or data flow's **settings panel** (double-click the node or the flow arrow on the canvas). At the bottom of the panel, next to the delete button, is a round **alert-plus** button. Click it and a sheet opens with:

- **Add to Issue** — copies this element to the clipboard for adding to an *existing* issue. See [Adding elements to an existing issue](#adding-elements-to-an-existing-issue).
- **One button per issue class** — creates a new issue of that class, already linked to this element.

The same sheet appears on the **Exposures** tab of an element (and in the maximized Exposures dialog), on each exposure row. An issue raised from an exposure is pre-named *`<Exposure> Issue on <element>`* with the description *`Exposure: <exposure description>`* — the only creation path that pre-fills a name.

### From the Model dialog

Right-click a model card in the Browser, or click the **Model settings** icon on the card or on the editor's canvas toolbar. The dialog's footer has an **Add Issue** section holding the same alert-plus button, with the same two options.

### From a finding in an analysis result

A module's results view can hand a finding to the platform's issue workflow. The dialog that opens is titled **Raise an issue from this finding** and offers:

- **Add to Issue board** — the clipboard path, described below.
- **Or create an issue:** — one button per issue class.

### What actually gets associated

Raising an issue from context links a **small, specific** set of elements — not everything visible on screen. This matters when you later filter by `elementIds`, or navigate from the issue back to its sources.

| Raised from | Elements linked |
|-------------|-----------------|
| The Issues page **+** button | Nothing |
| An element's settings panel | The element, the model it lives in, and — if the element represents a model — that represented model |
| An exposure row | The exposure, its host element, and the model |
| A finding in a module's results view | The finding, the element it was raised on, and the model |
| The Model dialog | The model, and nothing else |

Two consequences are easy to get wrong:

- **A model-raised issue is linked to the model only.** It is *not* linked to the components, data flows, boundaries, or controls inside that model.
- **The analysis run is never linked automatically.** An issue raised from a finding records the finding, the element, and the model — not the analysis that produced it. If you want the run on the issue, add it by hand from the **Associated Elements** tab.

## Adding elements to an existing issue

The **Add to Issue** button copies the current element to an internal clipboard and sends you to the Issues page, where you paste it into an existing issue.

1. **Copy.** From an element's settings panel, an exposure row, the Model dialog, or a finding's dialog, click **Add to Issue** (**Add to Issue board** on the finding dialog). Dethernety navigates you to the Issues page.
2. **Find the target issue.** Filter or search for it, then click its row to expand the card.
3. **Paste.** Click **Add from clipboard** (paste icon) in the left column of the card. The elements are linked, and a **timestamped comment** recording what was added is prepended to the comment thread.
4. **Go back.** A **Return to `<page>`** button appears on the card, taking you to where the copy started.

**The clipboard holds one item.** Copying a second element overwrites the first — there is no queue. To attach three findings to one issue, copy and paste them one at a time: copy → paste → return → copy the next.

The **Add from clipboard** button only exists while something is on the clipboard. It disappears once you have pasted, and the clipboard **expires 30 minutes** after the copy. If the button isn't there, make the copy again.

### The Associated Elements tab

The tab lists every linked element with its type, and for an exposure, the component it was found on. Per row you can:

- **Open the analysis results** (chart icon) — shown only for a linked analysis.
- **Open the model** in the data flow editor (polyline icon).
- **Unlink** the element from the issue (broken-link icon).

The **+** button at the top of the table adds **models** to the issue. Elements other than models are added through the clipboard workflow above, or by raising the issue from that element in the first place.

## Filtering and Search

The Issues page combines **server-side** filtering (narrows what is fetched) with **client-side** filtering (narrows what is rendered). The search box, the filter menus, and the chip row are three views of one query — the menus write into the same query the box parses.

By default the page shows **open issues**.

### Filter menus

| Menu | Kind | Values |
|------|------|--------|
| **Class** | Server-side | All Classes, or one issue class |
| **Issue Status** | Server-side | All Issues / Open Issues / Closed Issues |
| **Status** | Client-side | `identified`, `analyzing`, `mitigating`, `monitored`, `resolved`, `accepted` |
| **Severity** | Client-side | `critical`, `high`, `medium`, `low` |
| **Likelihood** | Client-side | `very-high`, `high`, `medium`, `low`, `very-low` |

Each selection adds a closable **chip** below the search box; the **filter-remove** button clears them all. Menus combine with AND across dimensions and OR within one.

**The Status and Likelihood menus offer one class's vocabulary.** Their fixed value lists are the Threat Vector class's `status` and `likelihood` enums. They will not match a Vulnerability whose status is `confirmed`, or any class that has no likelihood at all. **Severity** is the only attribute filter every shipped class answers to. To filter another class's status, type the condition yourself: `(status:"confirmed")`.

### Query syntax

**Server-side — bare `key:value`:**

```
issueStatus:open
classType:Vulnerability
```

Accepted keys: `name`, `issueId`, `classId`, `elementIds`, `classType`, `moduleId`, `moduleName`, `issueStatus`.

Every server-side key is an **exact, case-sensitive match** — not a search. `name:'Payment Security'` finds an issue named exactly *Payment Security* and nothing else; for a partial name use the client-side form below. `classType:vulnerability` matches nothing, because the class's type is `Vulnerability`. Quote a value that contains spaces. Only `elementIds` takes a list (comma-separated). `issueStatus` accepts only `open` and `closed`; any other value is dropped.

**Client-side — parenthesized groups:**

```
(severity:high OR severity:critical)
(class.name:"Threat Vector" AND severity:critical)
(status:confirmed)
```

Keys: `id`, `name`, `description`, `type`, `category`, `attributes`, `comments`, `createdAt`, `updatedAt`, `lastSyncAt`, plus `class.name` / `class.type`, plus any attribute the issue's class defines.

Client-side matching ignores case. An **unquoted** value substring-matches; a **quoted** value matches the whole field. So `(name:payment)` finds *Payment Security* while `(name:"payment")` does not. Attribute lookups accept either the direct path or the bare key — `(attributes.severity:high)` and `(severity:high)` both work; the bare form searches the issue's attributes recursively, a few levels deep.

**Combining both:**

```
issueStatus:open (severity:high)
classType:Vulnerability (name:SQL OR description:injection)
```

A bare `key:value` that isn't a server-side key is dropped with an advisory hint under the box — the usual cause is a client-side condition written without parentheses (`severity:high` instead of `(severity:high)`).

## Working with an Issue

### The list row

A collapsed row carries a **selection checkbox**, the issue **name**, a **severity** chip (only when the issue's `severity` attribute is set), and its **class** chip. Clicking the row expands the issue card. The row itself has no other actions — status and delete live in the card.

### The issue card

The card has a left column of actions and four tabs:

| Tab | What you do there |
|-----|-------------------|
| **General** | Edit the name and description |
| **Attributes** | Fill in the attributes the issue's class defines |
| **Associated Elements** | Review, navigate to, add, and unlink elements |
| **Comments** | Read and add comments |

The left column holds the class chip, the **Close Issue** / **Open Issue** toggle, the **delete** button (trash icon, with a confirmation), and — when something is on the clipboard — **Add from clipboard**.

### Status: two different things

Two fields are both called "status", and they are unrelated:

- **The issue's open/closed status** is the platform's own field, flipped by the **Close Issue** / **Open Issue** button and filtered by the **Issue Status** menu. It only ever holds `open` or `closed`.
- **A class's `status` attribute** is module-defined, lives on the **Attributes** tab, and has whatever values the class declares (`confirmed`, `mitigating`, `verified`, …). Setting it does not close the issue, and closing the issue does not change it.

Keep both current: the attribute records where the work stands, the open/closed flag records whether it is still on the board.

## Merging Issues

Merging creates **one new issue** from several and closes the originals. It is useful for duplicate reports of the same problem, or for consolidating fragmented tracking of one root cause.

### How to merge

1. **Select** two or more issues with the row checkboxes. The **merge** button (link icon, top right of the list) stays disabled below two.
2. **Click merge** and pick the **class** for the new issue from the buttons that appear.
3. **Confirm.** A dialog states the consequence — *Close N issues and create one merged `<Class>` issue. The originals are closed, not deleted, and remain available under the Closed filter.* — and, if the Open filter is active, warns that the originals will leave the view. Click **Merge & close** to proceed.
4. **Read the result.** A snackbar names the merged issue. If some originals could not be closed, or the merged issue could not be created after closing them, the snackbar says so and names the count to review by hand.

If any selected issue's detail fails to load, the merge is cancelled before anything is written, rather than silently dropping that issue's elements.

### What the merged issue actually carries

| Carried over | Not carried over |
|--------------|------------------|
| **Associated elements** from every source issue, combined | **Attributes** — see the warning below |
| **Comments** from every source issue, each block prefixed *Comments from `<issue name>`* | **Descriptions** — only the source issues' *names* are recorded |
| | **Provenance** — no "created by merge" field is written |

The merged issue is named `New <Class> Issue from N issues` and its description is a list of the names it was built from:

```
Merged issues:
- Unencrypted payment channel
 - Missing TLS on checkout flow
```

> **Merging discards attributes.** The merged issue is created with **empty attributes**. Severity, status, CVE id, CVSS score, likelihood, remediation notes — everything on the Attributes tab of every source issue — is not copied, and you are not warned at the time. The originals keep their attributes (they are closed, not deleted), so the data is recoverable, but you have to go and read it off them.
>
> **Before merging**, copy anything you need from the sources' Attributes tabs, and re-enter it on the merged issue afterwards. If the source descriptions matter, copy those too — only the names survive.

Closing the originals writes **nothing else**: no closure comment, no back-reference to the merged issue, no audit record of the merge. The link back is the merged issue's description, which names them.

## External system integration

> **No integration module ships with Dethernety.** Issues are created, tracked, and closed entirely on the platform. Nothing you do here reaches Jira, ServiceNow, GitHub, or any other tracker unless someone writes a module that makes it so.

The platform provides one **seam** a module can implement: a hook that reads an issue's attributes from an external system. Where a module implements it:

- The values it returns surface as the issue's **synced attributes** — searchable alongside the issue's own fields, and the source of the **severity** chip on issue rows.
- The platform records the time of the last successful sync on the issue.
- A timeout guards the call, so a slow or unreachable external system cannot stall the page.

Three properties of that seam are worth stating plainly, because they bound what any integration module can do without changing the platform:

- **It is inbound only.** The module reads; the platform never writes back. Creating, closing, or commenting on an issue in Dethernety changes nothing outside it.
- **It is pull-on-read.** The hook runs when an issue is read, not on a schedule. There is no background sync, no interval, and no retry queue.
- **It is a fallback, not a requirement.** When no module implements the hook — which is the case for every module shipped today — the issue's own attributes are returned unchanged, with the sync marked unsuccessful. This is why severity chips and attribute filters work perfectly well with no integration at all: they are reading the attributes you entered.

Anything richer — pushing issues outward, mirroring status both ways, field mapping, escalation — is the module's own business and is not something the platform supplies or configures.

Writing such a module is covered in the [Module Development Guide](../architecture/modules/DEVELOPMENT_GUIDE.md).

## Best Practices

### Filtering

- **Narrow server-side first** (Class, Issue Status) on a large board, then refine client-side.
- **Remember exact-match.** For a partial name, use the client-side form `(name:payment)`, not the server-side `name:payment`.
- **Prefer the chips** to reading the query string — they show what is actually applied, and each one removes independently.
- Filter state is **not** in the URL, so a filtered view can't be bookmarked or shared. Rebuild it from the menus, which takes a few clicks.

### Creating issues

- **Raise from context** wherever you can. An issue raised from an element or an exposure arrives already linked; one raised from the Issues page arrives empty.
- **Rename immediately.** `New Vulnerability Issue` is not a name anyone can triage.
- **Fill severity first.** It is the one attribute the list row surfaces and the one filter every class answers to.
- **Add the analysis by hand** if traceability to a specific run matters — nothing links it for you.

### Tracking

- **Use both status fields**: the class's `status` attribute for where the work stands, open/closed for whether it is still on the board.
- **Use comments** for the investigation trail; the clipboard workflow already writes one every time an element is attached.
- **Merge deliberately.** Copy the attributes you need off the sources first.

---

**Next Steps:**
- **[Security Analysis Workflow](SECURITY_ANALYSIS_WORKFLOW.md)**: Run analysis and raise issues from its findings
- **[Managing Findings](MANAGING_FINDINGS.md)**: Affirm, dispose, and customize exposures and countermeasures
- **[Working with Security Controls](WORKING_WITH_SECURITY_CONTROLS.md)**: Understand how controls relate to issue resolution
- **[Understanding Modules](UNDERSTANDING_MODULES.md)**: Where issue classes come from
