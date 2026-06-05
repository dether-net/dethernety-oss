---
title: 'Working with Findings'
description: 'The Residual Risk ledger, triaging findings, filtering, and the per-element Component Profile'
category: 'documentation'
position: 6
navigation: true
tags: ['threat-report', 'residual-risk', 'findings', 'dispositions', 'component-profile']
---

# Working with Findings

The **Residual Risk** tab is the Threat Report's findings ledger. It lists every model element that carries findings, groups the findings under the element they belong to, and separates what's still open from what's already been reviewed. This is where you triage: read a finding, decide what to do about it, record that decision, and move on. From any element here you can open its **Component Profile** to investigate it in depth.

This guide assumes you've already generated a report and know how to move between tabs. If not, start with [Getting Started with the Threat Report](./GETTING_STARTED.md). The shared visual language — score bands, sensitivity chips, the freshness banner — is explained in [Reading the Report](./READING_THE_REPORT.md).

> **The ledger never hides anything.** A reviewed finding is set aside into a muted partition with its decision attached — it is never dropped. The counts you see always describe the whole model.

---

## The Residual Risk Ledger

Open the **Residual Risk** tab. At the top you'll see a summary line such as:

```
37 findings · 28 open · 9 reviewed · 2 stale
```

Below it, findings are organized **per element**. Each element with at least one finding gets its own group, headed by the element's name (a dotted link — click it to open the **Component Profile**), its type, and a per-element count such as `5 open · 2 reviewed`. Elements with open findings are sorted to the top, worst score band first, so the work that needs attention rises.

### Open versus reviewed

Within each group, findings sit in one of two partitions:

| Partition | What it means |
|---|---|
| **Open** | No decision has been recorded yet. These are shown as a full table — they are the live work. |
| **Reviewed** | A decision has been recorded. These move into a muted, collapsible block labeled with the count (for example `2 reviewed`). Expand it to see them. |

A finding is **open** purely because it has no recorded disposition. Recording one moves it to the reviewed partition; it is set aside and counted, never deleted.

### How to read a finding row

Each row in the open table has these columns:

| Column | What it tells you |
|---|---|
| **Band** | The score band — `Critical`, `High`, `Medium`, `Low`, or `Unknown` — shown as an outlined chip. This is a triage sort-aid, not a risk verdict. |
| **Score** | The numeric score (0–10). When no score is recorded the cell reads `—` and the band reads **Unknown** — it is never silently treated as low. |
| **Finding** | The finding's name, with its mapped MITRE ATT&CK technique chips on a sub-line beneath it (see below). |
| **Vector** | The attack vector, when one is modeled (otherwise `—`). |
| **Source** | The finding's provenance — `USER` (authored by a person) or `SYSTEM` (produced by analysis, or legacy data). |

> **The band is a sort-aid, not a rating.** The report deliberately uses thin outlined chips, never solid stoplight blocks, and never rolls findings into a single overall risk number. The band orders findings for triage; it does not grade your model.

### Technique chips

When a finding maps to one or more MITRE ATT&CK techniques, you'll see small monospace chips (such as `T1190`) beneath the finding name. Click any chip to open a dialog that resolves the technique ID to its ATT&CK name, tactics, and description.

The chips are an identity and a launcher — nothing more. They are **not** tinted by coverage, and their absence does not assert "no techniques." To see how a finding's techniques relate to your overall coverage, use the **Coverage & Gaps** tab; see [Understanding Coverage](./UNDERSTANDING_COVERAGE.md).

---

## Triaging Findings

Triage means recording a decision about a finding. The ledger doesn't run its own triage workflow — it hands off to the platform's disposition dialog, the same one you'd use anywhere else, so your decisions live with the model rather than only inside the report.

### Recording a decision

1. Find the open finding you want to act on.
2. Click **Review →** at the right end of its row. The platform's disposition dialog opens.
3. Choose a disposition kind, add a reason, and confirm.
4. The finding moves into that element's **reviewed** partition, tagged with the decision, who recorded it, and when.

To change a decision you've already made, expand the **reviewed** block and click **Edit →** on the finding — this reopens the same dialog.

> **Permission required.** Recording decisions needs the appropriate permission. Without it the report is read-only: the **Review →** and **Edit →** actions simply don't appear, so you can read and filter the ledger but not change it. This is intentional, not a missing button.

> **Recording a decision changes the model.** Because the report reads a stored snapshot, a new disposition won't appear until you regenerate. After triaging, **Recreate** the report to fold your decisions into a fresh snapshot — see [Getting Started](./GETTING_STARTED.md#snapshots-and-freshness).

### The disposition kinds

The dialog offers six dispositions. Choose the one that matches your actual reasoning — the label travels with the finding and is what a later reviewer will read.

| Disposition | Use it when |
|---|---|
| **Not Applicable** | The finding doesn't apply to this element as modeled — the condition it describes isn't present here. |
| **False Positive** | The finding was raised in error. It is not a real exposure for this element. |
| **Compensating Control** | A real exposure, but another control already mitigates it to your satisfaction. State which control in the reason. |
| **Risk Accepted** | A real, unmitigated exposure that the business has consciously decided to accept. Record who accepted it and why. |
| **Waived** | Deliberately set aside for now — typically out of scope, deferred, or handled outside this model. |
| **Superseded** | No longer the right finding — replaced by a newer or more accurate one, or made moot by a model change. |

> **A consistency check, not coverage math.** If you mark a finding **Compensating Control** on an element that has *no* control present in the model, the ledger flags that as an auditable inconsistency — a claim with nothing backing it. It doesn't block you; it surfaces the gap so you can reconcile the model.

---

## Stale Dispositions

A recorded decision can be flagged **stale**. You'll see a `⚠ stale` marker on the reviewed finding, and the count of stale dispositions appears in the summary line at the top of the tab.

**Stale means the underlying finding changed after the decision was recorded.** The attributes the decision was based on are no longer the attributes in front of you, so the decision may no longer hold. The flag is a prompt to revisit: re-read the finding, confirm the disposition still applies, and re-record it (via **Edit →**) if needed. Don't trust a stale call at face value.

> **Why this matters.** A "Risk Accepted" or "Compensating Control" decision made against an earlier version of a finding can quietly stop reflecting reality. Surfacing staleness keeps an out-of-date decision from silently guarding a live exposure.

---

## Filtering and Focusing

When the ledger is large, the filter bar narrows it to what you care about. It sits just under the summary line and offers three groups of facets plus a clear control.

| Facet group | Choices |
|---|---|
| **Severity** | `Critical`, `High`, `Medium`, `Low` (each chip shows its whole-model count) |
| **Source** | `User`, `System` |
| **Element type** | `Component`, `Data`, `Boundary`, `Data Flow` (only the types present in the model appear) |

Each facet you turn on appears as a removable breadcrumb chip, and facets across different groups **combine** — for example, `severity: High` plus `source: System` plus `type: Component` shows only high-band system findings on components. Click a chip again, or use the **✕ clear** control, to remove a filter. When a filter matches nothing, the ledger says `No findings match the current filter` rather than appearing empty.

> **The counts stay whole-model.** The numbers on the facet chips and in the summary line always describe the entire model. The filter changes what's *displayed*, not what's *counted* — so a narrow view never misleads you about the totals.

### Arriving pre-filtered

You can also reach this view already filtered. On the **Posture** tab, clicking a roll-up statistic (for example a band count) jumps you straight to **Residual Risk** with the matching filter applied and shown as a breadcrumb. Clear it to see everything again. See [Reading the Report](./READING_THE_REPORT.md) for the Posture roll-up.

---

## Investigating an Element: the Component Profile

When a single finding row isn't enough context, open the element's **Component Profile**. Click the element's name in the ledger (or any element link anywhere in the report). The profile opens as an overlay; close it with **Esc**, the scrim, or its close button, and you return exactly where you were.

The profile *synthesizes* one element's residual risk — it is not a re-skin of the canvas inspector. It works for a **Component**, a **Security Boundary**, a **Data** element, or a **Data Flow**, adapting its sections to the element's type.

### Identity

The header shows the element's name, its type, and — where relevant — a `★ crown jewel` badge for an author-flagged high-value asset and, for a **Data** element, its sensitivity chip (`Public`, `Internal`, `Confidential`, `Restricted`, or `unknown` when none is set — never "low").

### Boundary context

For a Component or a Security Boundary, the **Boundary context** section lists the nesting stack from innermost to outer. Each boundary is itself drillable, and carries its own posture inline: `⚠ N live` exposures (with the worst band), `✓ control present`, or `· no modeled posture`. This tells you what surrounds the element you're investigating — a weak boundary above a sound component is still a path in.

### Exposures

The **Exposures** section shows the element's own findings, partitioned exactly like the ledger: an open table and a collapsible **reviewed** block, each finding carrying its band, score, vector, source, and ATT&CK technique chips. An open finding on an element with no supporting control is flagged `⛉ uncovered`. You can triage right here — the **Review →** and **Edit →** actions behave identically to the ledger (and obey the same permission rule).

### Data relations, in both directions

The profile shows data relationships from whichever side you're standing on:

- **Data handled** — appears on a *handler* (a Component, Boundary, or Data Flow). It lists each data item the element touches, with that item's sensitivity and its own exposure counts. Every data item is drillable.
- **Handled by** — appears on a *Data* element. It is the inverse: the components, data flows, and security boundaries that touch this data, each with its own posture (`⚠ N live`, `✓ control present`, or `· no modeled posture`) and each drillable.

> **Coverage follows the handler, not the data.** Exposure coverage is attributed to the element that handles a data item, never to the data node itself — so the "Data handled" block is explicit that the posture you see there belongs to the handler.

### Controls present

The **Controls present** section lists the element's controls as **defense-in-depth context** — and labels itself that way. It is deliberately *not* a coverage claim. See the next section.

### Connected components and the minimap

**Connected components** lists the element's 1-hop flow neighbors, each tagged with direction (inbound / outbound, or source / target for a Data Flow), the flow that connects them, and the carried sensitivity. Each neighbor is drillable. Alongside, a **minimap** highlights the element (or, for a Data Flow, its two endpoints and the edge between them) on the model so you can place it spatially.

### Navigating and triaging in place

Every related element in the profile — boundaries, data items, handlers, neighbors — is a drillable link, so you can walk the graph from element to element without leaving the overlay. An element that no longer exists in the snapshot is shown as plain, non-clickable text rather than a dead link. And because the **Exposures** section carries the same triage actions as the ledger, you can record decisions while you investigate, not only from the main tab.

---

## Reading Controls Honestly

Controls appear in two places — the per-group line in the ledger and the **Controls present** section of the profile — and in both they are **context, not coverage**.

The report has no control-to-exposure mapping, so it never claims a control "covers" a given finding. The honest consequence is spelled out on screen: where an element has both a control *and* open exposures, the profile states that the control's relevance to those exposures is **not assessed**. The absence of an `⛉ uncovered` flag does **not** mean "covered" — it means the relationship simply hasn't been evaluated.

> **Why the report is careful here.** A false sense of coverage is worse than none. Treat a listed control as something present in the model worth knowing about — then judge for yourself, in the disposition reason, whether it actually mitigates the open exposure.

For how techniques map to genuine coverage analysis, see [Understanding Coverage](./UNDERSTANDING_COVERAGE.md).

---

## Next Steps

- **[Reading the Report](./READING_THE_REPORT.md)** — the shared visual language, the **Posture** roll-up, and **Boundary Crossings**.
- **[Understanding Coverage](./UNDERSTANDING_COVERAGE.md)** — how a finding's techniques relate to your MITRE ATT&CK coverage.
- **[Reachability](./REACHABILITY.md)** — which crown jewels are reachable, and what sits on the route.
- **[Getting Started](./GETTING_STARTED.md)** — generating, refreshing, and exporting the report.
- **[Guide Index](./README.md)** — the full Threat Report documentation set.
