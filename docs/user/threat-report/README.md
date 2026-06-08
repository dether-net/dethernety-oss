---
title: 'Threat Report'
description: 'Read, filter, drill into, and export a residual-risk report over a threat model'
category: 'documentation'
position: 1
navigation: true
tags: ['threat-report', 'reporting', 'index', 'overview']
---

# Threat Report

The **Threat Report** is a read-only, point-in-time snapshot of the residual risk in one of your threat models. You generate it from a model's **Analysis** tab, then read it across five tabs, drill into any element, filter it down to what matters, and export it as machine-readable JSON or a self-contained printable HTML page. It reads your existing model and presents it — it never changes the model and never invents findings. Every tab renders over the same stored snapshot, so the whole report stays internally consistent as you move around it.

This page is the index for the Threat Report documentation set. New to the report? Jump straight to **[Getting Started](./GETTING_STARTED.md)**.

---

## What it tells you

- **Live findings** — every finding (an exposure) in the model, grouped per element, ordered by severity band for triage. A finding stays **live** while it is untriaged or **affirmed** (a confirmed risk); a dispositioned finding is either *live* (affirmed) or *muted* (any of the other disposition kinds).
- **MITRE ATT&CK coverage by tier** — which techniques your modeled exposures map to, and how strongly each is countered (DIRECT, Mitigation, or D3FEND), where the **Coverage Tools** module is present.
- **Flow routes to key assets** — which crown jewels are reachable over your modeled data flows, how many hops away, and what threats sit on the way.
- **Boundary crossings** — where data flows leave or enter a security boundary, and the sensitivity each crossing carries.
- **Residual risk per element** — the findings ledger and a per-element **Component Profile** that synthesizes one element's risk in depth.

## What it does NOT tell you

- **No single risk score and no coverage percentage.** The report deliberately segregates signals rather than blending them into one flattering number.
- **No proof a control works.** Coverage is *modeled / design-asserted* — it reflects controls wired up in your model, not telemetry from a running system.
- **No attacker model.** Reachability shows **flow routes, not attack paths** — it models how data flows connect, never attacker effort, credential reuse, or exploit chaining. A hop count is proximity, not difficulty.
- **Not a live view.** The report is a snapshot as of the moment you generated it. If you edit the model afterward, the report flags itself stale until you recreate it — it does not auto-update.

> Read the scope-and-freshness banner at the top of the report first, every time. It surfaces honesty flags — a stale snapshot, missing boundaries, unclassified data — *before* you read any reassuring count.

---

## Documentation map

| Guide | What it covers |
|---|---|
| [Getting Started](./GETTING_STARTED.md) | Generate, open, refresh, and export a report end to end. Prerequisites and the snapshot/freshness model. **Start here.** |
| [Reading the Report](./READING_THE_REPORT.md) | The layout, how to move around, the shared visual language (severity bands, data sensitivity, the model minimap, ATT&CK chips), and the **Posture** and **Boundary Crossings** views. |
| [Understanding Coverage](./UNDERSTANDING_COVERAGE.md) | The **Coverage & Gaps** MITRE ATT&CK matrix: tiers, prevent vs detect, the off-grid notes, and what coverage does and does not claim. |
| [Reachability](./REACHABILITY.md) | The **Reachability** tab: flow routes to crown jewels and between any two elements — and the firm line between flow routes and attack paths. |
| [Working with Findings](./WORKING_WITH_FINDINGS.md) | The **Residual Risk** ledger, recording decisions (dispositions), filtering, and the per-element **Component Profile**. |

---

## Suggested reading order

1. **[Getting Started](./GETTING_STARTED.md)** — create your first report and learn the snapshot/freshness model.
2. **[Reading the Report](./READING_THE_REPORT.md)** — the navigation and the shared visual language every other surface reuses.
3. Then read the per-surface guide for the task in front of you:
   - Auditing control coverage → **[Understanding Coverage](./UNDERSTANDING_COVERAGE.md)**
   - Validating segmentation or tracing routes to crown jewels → **[Reachability](./REACHABILITY.md)**
   - Triaging and recording decisions on findings → **[Working with Findings](./WORKING_WITH_FINDINGS.md)**

---

## Prerequisites

- **A threat model with elements.** The report reads your components, data flows, security boundaries, and data. An empty model produces an empty report.
- **Permission to run an analysis** to generate or recreate a snapshot. Viewing is read-only; recording decisions on findings needs the appropriate permission.
- **The Coverage Tools module (optional).** It powers the **Coverage & Gaps** tab. When it is not present, that tab simply does not appear and nothing else in the report is affected.

See [Getting Started](./GETTING_STARTED.md) for the full setup walkthrough.

---

## For developers

For the system design — the snapshot lifecycle, the backend/frontend split, the data contracts, and the honesty principles behind each surface — see the [Threat Report architecture documentation](../../architecture/dethernety-threat-report/README.md).
