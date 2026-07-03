---
title: 'Getting Started with the Threat Report'
description: 'Generate, open, refresh, and export a threat report over a model'
category: 'documentation'
position: 2
navigation: true
tags: ['threat-report', 'reporting', 'getting-started', 'analysis']
---

# Getting Started with the Threat Report

The **Threat Report** is a read-only, point-in-time view of the residual risk in one of your threat models. You generate it from a model's **Analysis** tab, read it across a handful of tabs, drill into any element, and export it as a JSON file or a printable HTML page you can save as a PDF. This guide walks you through that first run end to end — from creating the report to sharing it.

---

## What the Threat Report Is

Think of the Threat Report as a snapshot of where your model stands right now: which findings are still open, which have been reviewed, where your MITRE ATT&CK coverage is, which crown jewels are reachable, and where flows cross your security boundaries. It is a **reporting** view, not an analysis engine — it reads your existing model and presents it. It never changes the model, and it never invents findings.

Use it when you want to:

- **Review residual risk** across an entire model in one place, instead of clicking element by element on the canvas.
- **Brief a stakeholder** with a single self-contained page.
- **Track a point in time** — a snapshot you can compare against a later one as the model evolves.
- **Filter and drill** from a high-level roll-up down to a single component's findings.

> **It is a snapshot, not a live scan.** The report describes the *modeled* posture as of the moment you generate it — not a deployed-state scan. Findings are not collapsed into a single risk score, and no coverage percentage is implied. Those same honest caveats travel with every export.

---

## Prerequisites

Before you can generate a useful report, you need:

| Prerequisite | Why |
|---|---|
| **A threat model with elements** | The report reads your components, data flows, security boundaries, and data. An empty model produces an empty report. |
| **Permission to run an analysis** | Creating and running the report is part of the platform's normal analysis workflow. Viewing is read-only. |
| **The Coverage Tools module (optional)** | Powers the **Coverage & Gaps** tab (MITRE ATT&CK coverage). Without it, the report works exactly as described — the coverage tab simply doesn't show coverage data; nothing else is affected. |

> **Tip:** To get the most from the **Reachability** tab, mark your most valuable components as crown jewels in the model. The report assesses reachability against those; if none are marked, the tab tells you so rather than guessing.

---

## Creating and Running the Report

The Threat Report appears as an analysis class named **Threat Report** in any model's **Analysis** tab. Creating it follows the same flow as any other analysis, with one extra step: you **run** it to compute the snapshot.

1. **Open your model.** Right-click the model in the Browser, or click its name in the editor, to open the model dialog.
2. **Go to the Analysis tab.** Select the **Analysis** tab in the model dialog.
3. **Create the report.** From the **New Analysis** menu, choose the **Threat Report** class. This creates a standing report instance attached to your model. At this point no snapshot exists yet.
4. **Open the results.** In the report's row, open **Results** (the right-arrow action). The report opens on its scope-and-freshness banner, which reads `No snapshot has been generated yet.` and shows a **Generate** button.
5. **Generate the snapshot.** Click **Generate**. The banner switches to `Generating snapshot…` while the report reads your model and stores a point-in-time snapshot. When it finishes, the report renders.

When the snapshot lands, you'll see the banner change to read `Reflects the model as of <date and time>` with a green **Fresh** marker, and a summary line such as `12 components · 4 boundaries`. That's your confirmation the report generated successfully.

> **Note:** Generating reads the model but never modifies it. If generation fails, any previous snapshot is left untouched and the banner explains what happened.

---

## Reading the Report

The report renders entirely over the stored snapshot, so every tab is mutually consistent — they all describe the same model, as of the same moment. You move between tabs with the segmented control at the top; clicking a tab is a plain view switch and never reloads the page.

There are five tabs, plus a per-element drill-down:

| Tab | What it's for |
|---|---|
| **Posture** | The default landing view — a roll-up of the whole model's residual risk, with stats you can click to jump into a filtered view. |
| **Coverage & Gaps** | Your MITRE ATT&CK coverage and where the gaps are (requires the Coverage Tools module). |
| **Reachability** | Which crown jewels can be reached over modeled flow routes, and what lies on those routes. |
| **Boundary Crossings** | Where flows cross security boundaries, what they carry, and how each crossing reads against your declared-zone data-flow policy. |
| **Residual Risk** | The findings ledger — every finding, open or reviewed, that you can filter and act on. |

Clicking any element — in any tab — opens its **Component Profile** as an overlay dialog: that element's findings, supporting controls, the data it handles, links to its neighbors, and — for a security boundary — its declared **trust zoning** (zone, planes, domains, and conduits). Close the dialog (press **Esc**, click the scrim, or use the close button) and you return to exactly where you were.

> **Banner first.** A scope-and-freshness banner sits above every tab. It surfaces freshness and any completeness flags — for example `No security boundaries modeled` — *before* you read a reassuring count. Read it first; it tells you what the report can and cannot speak to.

Each tab has a dedicated guide. Start with [Reading the Report](./READING_THE_REPORT.md) for the shared visual language, the **Posture** roll-up, and **Boundary Crossings**; then move on to the surface that matters for your task.

---

## Snapshots and Freshness

The report does not query your model live — it reads the snapshot it stored when you generated it. That's deliberate: it keeps every tab consistent with every other. The trade-off is that the report does **not** auto-update. If you edit the model after generating, the report still shows the older snapshot until you regenerate.

The report detects this for you. When the underlying model has changed since the snapshot was taken, the freshness banner switches from green **Fresh** to an amber `Stale — the model changed since` marker, and a `Snapshot is stale — Recreate to refresh` flag appears. The **Generate** button becomes a **Recreate** button.

**Regenerate when the banner reads stale** — typically after you:

- add, remove, or rewire components, flows, boundaries, or data;
- record a decision on a finding (a triage / disposition);
- reclassify data sensitivity or change which element handles which data.

To refresh, click **Recreate**. The report recomputes a fresh snapshot over the current model and the banner returns to **Fresh**. A routine save that changes nothing report-relevant will *not* mark the report stale, so you won't be nagged for no reason.

> **Tip:** Recording a decision on a finding opens the platform's own triage dialog and changes the model — which is exactly the kind of change that marks the report stale. Recreate afterward to fold your decision into a fresh snapshot. See [Working with Findings](./WORKING_WITH_FINDINGS.md).

---

## Exporting and Sharing

You can export the current snapshot in two formats from the action row at the top of the report:

| Action | Format | Use it for |
|---|---|---|
| **Export JSON** | Machine-readable JSON | Feeding the report into other tools, diffing snapshots over time, or archiving the raw data. |
| **Export HTML** | Self-contained printable HTML | Sharing a readable report. Open the file in any browser and use **Print → Save as PDF**. |

Both exports carry the report's substance, not just the ledger: the MITRE coverage facts, the crown-jewel reachability rollup, the **Boundary Crossings** data-flow policy (the per-flow declared-zone verdicts, the conduit-error and dead-conduit surfaces), and the residual-risk ledger — each section appears when its inputs are present. The boundary-crossings section keeps the same honesty framing as the on-screen view: a verdict flags an illegal crossing *as drawn* (declared intent, never verified enforcement), and allowed crossings stay silent.

The HTML export is fully self-contained — no external assets — so you can open it anywhere and print it. Both exports carry the same honest caveats shown on screen: they state that the report is a point-in-time snapshot of the *modeled* posture (not a live or deployed-state scan), that findings are not rolled into a single risk number, and that no coverage percentage is implied. In the HTML report, each affirmed finding carries a **"Confirmed"** tag, so a reader can see which risks you reviewed and confirmed.

> **Export is disabled while you have pending live edits.** If you've affirmed or disposed findings since the snapshot was generated, those decisions aren't yet in the snapshot — so the export buttons are disabled to stop you sharing stale numbers. Click **Recreate** to fold your decisions into a fresh snapshot, then export.

> **Note:** An export reflects the snapshot it was taken from. If the on-screen banner reads stale, **Recreate** before exporting so you share current numbers.

---

## Next Steps

- **[Reading the Report](./READING_THE_REPORT.md)** — the shared visual language, the **Posture** roll-up, and **Boundary Crossings**.
- **[Understanding Coverage](./UNDERSTANDING_COVERAGE.md)** — the **Coverage & Gaps** MITRE ATT&CK matrix.
- **[Reachability](./REACHABILITY.md)** — flow-route reachability for your crown jewels.
- **[Working with Findings](./WORKING_WITH_FINDINGS.md)** — the **Residual Risk** ledger, recording decisions, and the **Component Profile**.
- **[Guide Index](./README.md)** — the full Threat Report documentation set.
