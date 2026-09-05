---
title: 'Reading the Report'
description: 'Navigating the report, the shared visual language, and the Posture and Boundary Crossings views'
category: 'documentation'
position: 3
navigation: true
tags: ['threat-report', 'reporting', 'navigation', 'posture', 'boundary-crossings']
---

# Reading the Report

The Threat Report turns a generated snapshot of your model into a set of focused views you switch between in place — no page reloads, no navigating away. This guide shows you how the report is laid out, how to move around it, and the shared visual language (severity, data sensitivity, the model map, ATT&CK chips) that every view reuses. It then walks the two views you'll start in most often: **Posture** and **Boundary Crossings**. Coverage, Reachability, and the findings ledger each have their own guide, linked at the end.

> **Prerequisite.** You need a generated snapshot. If the report greets you with *"No snapshot has been generated for this report yet,"* generate one first — see [Getting Started](./GETTING_STARTED.md).

## The layout at a glance

The report is a single screen titled **Threat Report**. From top to bottom:

1. **The scope banner.** Pinned above everything else. It carries model-wide honesty flags — a stale snapshot, missing boundaries, under-analyzed high-value elements, unclassified data — and the **Generate** / **Recreate** action. You read the caveats here *before* you read any numbers.
2. **The model summary line + export.** A small line reads `N components · M boundaries`, with **Export JSON** and **Export HTML** buttons on the right.
3. **The tab strip** (a segmented control). One click switches the view below it. The tabs are:

   | Tab | What it answers |
   |-----|-----------------|
   | **Posture** | What's my overall exposure right now? (the default landing view) |
   | **Coverage & Gaps** | Which attack techniques do my controls actually address? |
   | **Reachability** | Can an attacker reach my crown jewels from outside? |
   | **Boundary Crossings** | Where does data leave or enter a security boundary? |
   | **Residual Risk** | The full ledger of open and dispositioned findings. |

4. **The breadcrumb / filter row.** Appears only when one or more filters are active. Each filter shows as a removable chip.
5. **The active view.** The single scrolling region for the tab you're on.

> **The Component Profile is not a tab.** It opens as an overlay dialog whenever you click an element link anywhere in the report (a finding's element, a flow, a boundary). Closing it returns you to exactly where you were. See [Moving around](#moving-around-the-report) below.

### Exporting

**Export JSON** downloads the snapshot as structured data; **Export HTML** downloads a self-contained page you can share or archive. Both export the snapshot you're currently viewing — generate or recreate first if the banner says it's stale.

## Moving around the report

### Switching views

Click any tab in the strip. The view swaps in place; your scroll position in the new view starts at the top. A manual tab click is always an *unfiltered* view — switching tabs clears any active filter chips, so you never carry one view's filter into another by accident.

### The Component Profile overlay

Most things in the report are clickable: a finding's element name, a flow, a crossed boundary, a ranked residual risk. Clicking one opens the **Component Profile** as a dialog over the current view, labelled with a small `Component Profile` eyebrow and the element's name.

- The view underneath stays mounted, so when you close the dialog you land back exactly where you were — same scroll position, same expanded rows, same selections.
- Close it with the **✕** in the dialog header, by pressing **Esc**, or by clicking outside it.
- A link to a neighbouring element *inside* the profile re-targets the same dialog rather than stacking a second one.

For what the profile shows, see [Working with Findings](./WORKING_WITH_FINDINGS.md).

### Filters and breadcrumb chips

When a filter is active, it appears as a chip in the breadcrumb row beneath the tab strip, showing the current view's name and each chip (for example `band: High` or `open only`). Remove a filter by clicking the **✕** on its chip.

Two rules govern how filters combine:

- **Same kind is single-select.** Picking a second value of the same kind (for example a different severity band) replaces the first.
- **Different kinds combine with AND.** A band filter and an "open only" filter together narrow to *open findings in that band*.

### Deep-linking from Posture

Every statistic on the **Posture** view is a link. Clicking one jumps you to the right detailed view *already filtered*. Click a **high** exposure tile, for example, and you land in **Residual Risk** filtered to the high band, with that filter shown as a removable chip. This is the fastest way to move from "something looks off" to "here are the exact findings."

## The shared visual language

These four building blocks mean the same thing in every view. Learn them once.

### Severity bands

Findings are sorted into five bands by their exposure score (a 0–10, CVSS-like number used purely for triage ordering — *not* a risk rating). Colour carries the band.

| Band | Score | Reading |
|------|-------|---------|
| **critical** | 9–10 | Highest-priority exposures. |
| **high** | 7–8.9 | |
| **medium** | 4–6.9 | |
| **low** | below 4 | |
| **unknown** | no score | A finding with no score reads **unknown** — never "low". |

> **Why "unknown" matters.** An unscored finding is not a safe one — it's an unmeasured one. The report never quietly files it under "low".

### Data sensitivity

Data carried by a flow is labelled with its classification. The report orders these by sensitivity but, like severity, never blends them into a single number.

| Label | Reading |
|-------|---------|
| **Restricted** | Most sensitive. |
| **Confidential** | |
| **Internal** | |
| **Public** | Least sensitive. |
| **unclassified data** | Data is in motion but not classified — a **modeling gap**, surfaced as a flag, not a safe state. |
| **no data** | The flow carries no data items. |

> Unclassified data crossing a boundary reads **unknown / unclassified**, never "low". It's flagged so you classify it, not so you can ignore it.

### The model minimap

A small, faithful map of your model — it uses your real diagram layout, not an auto-layout — that appears as a building block inside several views (it is not a view of its own). On it:

- **Shapes encode type.** Processes and most nodes render as dots/circles; external entities as rectangles; data stores in the two-line store convention.
- **Highlights show focus.** The element(s) or route currently in focus are highlighted in cyan and drawn slightly larger; a highlighted route also lights up the connecting flow line. Crown jewels show in red, entry points in amber.
- **It enlarges.** A compact map sits in a side pane with hover tooltips for labels; the **expand** button (top-left of the map) opens a larger **Model overview** dialog with full shapes and always-on labels.
- **It can be interactive.** In some views, clicking a node on the map selects it.

### ATT&CK technique chips

Next to findings you'll see small monospace chips like `T1190`. Each is a MITRE ATT&CK technique identifier and a launcher — nothing more.

- Click a chip to open the shared **technique dialog**, which shows the technique's id and **name**, its **Tactics**, and a cleaned-up **description**.
- A chip is deliberately *not* shaded by coverage. It tells you *which* technique a finding maps to, never whether you're defended against it — that accounting lives only in **Coverage & Gaps**.

## The Posture view

**Posture** is the default landing view and the only one that aggregates. It rolls everything up at a glance — but it deliberately shows **no single risk score and no coverage percentage**. It segregates signals rather than blending them, so nothing flattering hides behind an average.

What you'll see, top to bottom:

- **A caveat line.** Stating that this is modeled / design-asserted posture as of generation — not live telemetry or a scan — and that findings are not rolled into one score.
- **Live exposures** — outlined tiles, one per severity band that has live exposures, showing the count. A finding is **live** when it is untriaged **or** affirmed — an affirmed finding (shown with a **"Confirmed"** tag) is a reviewed-and-confirmed risk, so it still counts as live residual risk. Only the muting dispositions drop a finding from this count. Click a tile to open **Residual Risk** filtered to that band. If there are none, the view says so honestly (distinguishing "all findings dispositioned" from "nothing is modeled").
- **Coverage** (when the coverage data is available) — tier-segregated lines (`DIRECT-prevent`, `DIRECT-detect`, `Mitigation`, `D3FEND (broad/inferred)`, `uncovered`, `soft/unmapped`). Never a percentage, never a "Covered: N". Each line links to the **Coverage & Gaps** matrix.
- **Open / dispositioned / boundary-crossing counts** — clickable stats (`N open`, `N dispositioned`, `N boundary crossings carrying data or posture`) that deep-link into their views. Clicking `N open` opens **Residual Risk** filtered to `open only`. Warning markers ride alongside when they apply: `⚠ N stale`, `· none dispositioned yet`, and `⚠ N compensating-control claims with no control present`.
- **Crown-jewel reachability** (when reachability is available) — for example *"2 of 5 crown jewels reachable from external entry."* Click to open **Reachability**. If no crown jewels or no external entry are modeled, it says so plainly rather than showing a flattering "0 reachable".
- **Defense-in-depth** — a separate positive line counting controls present on elements with no live exposure. It is explicitly *not* folded into any coverage measure.
- **Top residual risks** — the ranked open findings, each row showing its severity band, name, the element it sits on, and an `⛉ uncovered` flag where no supporting control is present. Click a row to open that element's Component Profile.

Use Posture as a launchpad: scan the tiles and stats, then click straight through to the view that holds the detail.

## The Boundary Crossings view

**Boundary Crossings** lists every place a data flow crosses a security boundary. Each crossing carries **two layers**:

- A **declared policy line** — the flow's declared source-zone `↦` target-zone, checked against your data-flow policy. Zones are the ones you **declared** (an administrative decision the report never recomputes); a verdict says the model *as drawn* encodes an illegal crossing — **declared intent, not verified enforcement**, and never a claim the flow cannot happen.
- The **structural membranes** below it — described as **EXIT** (data leaves a boundary) or **ENTER** (data enters one). This is containment, not a trust comparison.

The view has two panes:

- **A pinned minimap** on the left that stays visible while the list scrolls. Click any crossing in the list to highlight its flow's endpoints and route on the map; use **clear** to deselect.
- **The crossing list** on the right.

### Reading a crossing

Each crossing is grouped by flow so its full containment story stays intact. For each one you'll see:

- **The flow name and its endpoints** (`source → target`). All three are links that open the relevant Component Profile.
- **The declared policy line** — `declared [SOURCE-ZONE] ↦ [TARGET-ZONE]`, with the domain relationship (`same-domain` / `cross-domain`) and, for control-plane flows, `management plane`. **Allowed crossings stay silent** — just the muted zone-pair, never a green "pass". A crossing that breaks policy gets a left accent bar and one word:
  - **VIOLATION** — an illegal crossing (e.g. an EXPOSED boundary reaching directly into a RESTRICTED one, or a cross-domain hop into RESTRICTED).
  - **WARNING** — a valid crossing that is missing a declared conduit (`conduit: missing`): required for cross-domain and external/partner *ingress*, recommended for management-plane (control-plane) flows. Outbound data *leaving* to the internet is judged as data-out: through a declared conduit it stays a warning (the report asks you to confirm the egress is intended); with no approved channel it is a **violation**.
  - **ADVISORY** — a soft "review this" (e.g. a below-RESTRICTED control-plane service writing into a RESTRICTED workload, or a RESTRICTED workload initiating an outbound flow). A plain workload calling a RESTRICTED management service (an app fetching from a secrets manager, shipping logs to a SIEM) is the expected hub-and-spoke shape and is *not* flagged.
  - A `conduit: error` token marks a declared conduit that authorizes an illegal crossing — a conduit never legalizes a violation.
  - Conduits are **zone-level**: a conduit declared from one boundary to another also covers crossings between their child boundaries (it inherits down the tree, on both the source and the peer side), so you don't declare one per pod. Inheritance is downward only — a conduit on a child never covers its parent's crossings.
- **A sensitivity chip** — the highest classification the flow carries (**Restricted** … **Public**), or **unclassified data**, or **no data**.
- **The membranes pierced** — one line per crossed boundary, tagged **EXIT** or **ENTER**, with the boundary name (also a link). Against each boundary, two muted context markers may appear:
  - **⚠ live on boundary** — the crossed boundary has live exposures (a *weakening* signal: the crossing is easier).
  - **✓ boundary control** — the crossed boundary has a covering control (a *hardening* signal: the crossing is costlier).
- **On-flow posture** — `flow: N live` and `flow control present` where the flow itself carries exposures or a control.

> The membrane markers are context, never a red/green verdict and never coverage. The policy verdict is about the model *as drawn* — a declared-intent check, not proof the flow is (or isn't) enforced.

A **conduit-error** panel appears above the list when any declared conduit authorizes an illegal crossing (including *dead* conduits with no matching flow). Legally-declared conduits with no matching modeled flow appear in a muted **dead intent** list at the bottom (with their justification; a blank one reads *unreviewable*) — worth a review, never a failure. A collapsed **zone-tiers legend** near the top explains the chips. Crossings are ranked **verdict-severity first** — a violation surfaces to the top even when the flow carries no classified data.

### Honest empty and under-modeled states

Boundary Crossings never shows a reassuring blank. If no boundaries or no flows are modeled, it says the analysis isn't applicable. Crossings that are **allowed and carry no data, no exposures, and no controls** collapse into a single muted **"under-modeled"** tail — present, never dropped, never counted as a clean result. A summary line at the top reads `N flows pierce membranes · N violations · N warnings · N under-modeled`.

> **Where zoning advisories go.** Per-boundary zoning notes (an unclassified boundary, an under-protected asset holder, a management plane on an exposed tier, shared-domain cross-tier coupling) are *not* per-crossing, so they don't clutter this view — they appear as a compact, un-scored **zoning advisories** block in the **Residual Risk** ledger. See [Working with Findings](./WORKING_WITH_FINDINGS.md#zoning-advisories).

## Where to go next

- [Understanding Coverage](./UNDERSTANDING_COVERAGE.md) — read the **Coverage & Gaps** matrix and what each tier really claims.
- [Reachability](./REACHABILITY.md) — trace flow routes from external entry to your crown jewels.
- [Working with Findings](./WORKING_WITH_FINDINGS.md) — the **Residual Risk** ledger and the **Component Profile** in depth.
- [Threat Report overview](./README.md) · [Getting Started](./GETTING_STARTED.md) — generating and refreshing the snapshot.
