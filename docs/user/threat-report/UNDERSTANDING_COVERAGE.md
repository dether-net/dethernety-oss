---
title: 'Understanding Coverage and Gaps'
description: 'Reading the MITRE ATT&CK coverage matrix: tiers, prevent vs detect, off-grid notes, and what coverage does and does not mean'
category: 'documentation'
position: 4
navigation: true
tags: ['threat-report', 'coverage', 'mitre', 'attack', 'gaps']
---

# Understanding Coverage and Gaps

The **Coverage & Gaps** tab is the deepest surface in the Threat Report. It answers one question for a security analyst: *for my model's live threats, which MITRE ATT&CK techniques are countered, how strongly, and where are the gaps?* This guide helps you read the matrix correctly — and, just as importantly, helps you avoid over-claiming what it shows.

The tab is powered by the **Coverage Tools** module. If that module is not deployed for your instance, the tab tells you so (`Coverage facts are unavailable…`) and the rest of the report is unaffected. See [Getting Started](./GETTING_STARTED.md) for the prerequisite. For the shared visual language and the technique dialog this tab reuses, see [Reading the Report](./READING_THE_REPORT.md).

---

## What the Matrix Shows — and What It Does Not

The matrix charts your model's **live** (untriaged **or** affirmed) exposures against the MITRE ATT&CK techniques they map to. Each **row** is a technique that one or more of your exposures actually exploits; each **column** is a tactic those techniques reach. An **affirmed** exposure is a reviewed-and-confirmed risk, so it stays on the live grid; only the muting dispositions take an exposure off it.

> **This is not the full ATT&CK matrix.** It shows only the techniques your model's exposures map to — never the entire framework. A technique you don't see is one your model doesn't currently expose, not a silent gap. Gaps that the model *does* expose appear as uncovered cells; gaps it can't chart appear in the off-grid notes below the controls.

What the matrix deliberately does **not** claim:

- **No coverage percentage.** There is no "73% covered" number anywhere on this surface, by design.
- **No single "Covered: N" total.** Coverage is shown tier by tier and function by function, never rolled into one headline figure.
- **No proof of effectiveness.** The data is *modeled / design-asserted* coverage, not deployed telemetry. "Covered" means a real control supports the exposed element and counters the technique — it does **not** prove that control works in production.

The [next section on talking to stakeholders](#talking-about-coverage-honestly) explains why these omissions are features, not gaps.

---

## How to Read a Cell

The grid is **monochrome** on purpose. Color is reserved for severity elsewhere in the report; here, color would invite a "traffic-light" misreading. Each cell carries at most two signals:

- The **fill** encodes the coverage **tier** — how specific the strongest covering control is.
- A single **glyph** encodes the security **function** — whether you can prevent the technique or only detect it.

Turn on the **Legend** toggle (the `▸ Legend` button in the controls row) to see this encoding inline at any time. It expands to:

| Cell | Tier / state | Reading |
|---|---|---|
| Full solid fill | `DIRECT` | Author-asserted coverage — the strongest, most specific tier. |
| Mid fill | **Mitigation** | Coverage via a catalogue-precise ATT&CK mitigation. |
| Hatch texture | **D3FEND** | Broad, inferred coverage via a shared defensive artifact. |
| Empty dotted cell | `UNCOVERED` | The technique is exploited here, but no covering control supports the element. |
| `⛉` glyph | prevent | At least one preventive control survives at some tier. |
| `◎` glyph | detect | The technique is covered, but **detect-only** — no preventive edge anywhere. |

So a full-fill cell with a `⛉` reads "DIRECT, preventive — your strongest result." A hatched cell with a `◎` reads "broad inferred coverage, and you can only see the technique, not stop it." An empty dotted cell with no glyph is a true gap.

> **Detect-only is a reduction, not an oversight.** A `◎` with no `⛉` means: a control covers this technique, but every covering edge is detective. You can *see it, but not stop it.* Treat detect-only the same way you treat an uncovered cell when you prioritize work — both belong on the worklist.

Hover any cell, technique id, or **Best** label for a one-line summary in the tooltip — for example `T1059 · Command and Scripting Interpreter — DIRECT-prevent · covered for 3 of 4 element(s) · 1 UNCOVERED`. The rightmost **Best** column states each technique's strongest result in words, so you can read the row without decoding the cell.

---

## The Three Tiers — and Why They Are Never Blended

A technique is **covered for an exposure** only when a real countermeasure's parent control actually supports the exposed element. All three tiers are real coverage; they differ in *specificity*, not in whether the control exists.

| Tier | What it means for you |
|---|---|
| `DIRECT` | The control's author asserted, explicitly, that it counters this technique. The most trustworthy, most specific signal. |
| **Mitigation** | The control maps to an ATT&CK mitigation that defends against this technique. Catalogue-precise, one inference removed from DIRECT. |
| **D3FEND** | The control shares a defensive artifact with the technique. Broad and inferred — useful as a signal, weak as a guarantee. |

The matrix **never blends these into one number**, and the broad D3FEND tier is drawn as a distinct **hatch texture** rather than a fainter shade of the same fill. That choice is deliberate: a fainter shade would let "broad, inferred" masquerade as "a little bit covered" and quietly inflate a glance-read of the grid. The hatch keeps D3FEND visually separate so you always know when a cell rests on the weakest tier.

> **When you cite coverage, name the tier.** "DIRECT-prevent on the auth service" is a defensible claim. "Covered" — unqualified — flattens a DIRECT result and a broad D3FEND inference into the same word. The matrix refuses to do that, and so should you.

---

## Filtering and Focusing

The controls row above the grid, plus the clickable tactic headers, let you narrow the matrix to exactly what you're working on. The filters **compose** — a tier filter, the worklist toggle, and a tactic column filter all apply together.

### The Tier filter

The **Tier** dropdown partitions the rows by each technique's *best* tier, so the options sum to the whole grid:

- `all` — every charted technique.
- `DIRECT only` — techniques whose strongest coverage is DIRECT.
- `Mitigation only` — best tier is Mitigation.
- `D3FEND only` — best tier is the broad D3FEND tier. **Scan this list when auditing** — these techniques rest on the weakest inference.
- `uncovered` — techniques with no covering control at all.

### The uncovered + detect-only worklist

The **uncovered + detect-only** toggle is your "fund a control" worklist. It reduces the grid to techniques that are either uncovered or detect-only — every technique where you currently cannot *prevent* the attack. This is the shortlist to act on.

> If this toggle empties the grid, you'll see `No uncovered or detect-only techniques on the live grid — every charted technique has a preventive control.` Read it precisely: it speaks only to the **charted** grid. The off-grid items below — unmapped exposures, Data, and structural gaps — still apply. A clean grid is not an all-clear.

### Clickable tactic columns

Each **tactic column header** is a toggle. Click a header (for example **Initial Access**) to filter the rows to techniques in that tactic; the header shows a `✕` and clicking it again clears the filter. Use this to ask "where do my gaps cluster by attacker objective?" — combine it with the worklist toggle to see, say, every detect-only technique under **Lateral Movement**.

### Expanding a technique's elements

Each row names the **element(s)** the technique impacts:

- A **single-element** technique shows that element inline as a drill link. A leading `✓` marks it covered.
- A **multi-element** technique collapses to a count, such as `4 elements · 3 covered`. Click the row's caret (or the count) to expand the full list. Uncovered elements are listed first, so the actionable ones lead; covered elements are muted.

Every element name is a link to its **Component Profile** — click it to drill into that element's findings and supporting controls. See [Working with Findings](./WORKING_WITH_FINDINGS.md) for the profile.

### The technique dialog

A bare technique id like `T1078` is opaque. Click the **ⓘ** next to any technique id to open the shared technique dialog, which shows the technique's **name**, its **tactics**, and a cleaned ATT&CK **description**. It's the same dialog used elsewhere in the report, so the affordance is identical everywhere.

---

## Reading the Off-Grid Notes Honestly

Below the controls sits an **Off-grid** summary line. Its counts are **always visible** — they are the honesty signal that keeps the grid from reading as a false all-clear. Click the line to expand the detail. There are four categories, and each exists because charting it as "covered" or "uncovered" would mislead you.

| Off-grid category | What it means | How to treat it |
|---|---|---|
| **unmapped** (soft) | Live exposures with no ATT&CK mapping. | Coverage **can't be assessed** for them. They are neither a covered win nor a grid gap — just unchartable. |
| **Data-mapped** | Exposures on **Data** elements. | Kept off the grid because controls attach to the *handling* element, never to the Data node — so data-level coverage isn't assessable. Their techniques are still disclosed (see below). |
| **structural gap** | An element class with zero supporting controls anywhere in the model. | One honest completeness line — for example `No control in this model supports any component` — not a flood of per-technique cells. A maturity gap, not a single missing control. |
| **excluded** | **Muted** exposures — those given a muting disposition. | Excluded from the live grid but **counted**, never silently dropped. They still appear in the **Residual Risk** ledger. **Affirmed** findings are *not* excluded — they stay live and remain charted on the grid; only the muting dispositions land here. |

### Data exposures: off the grid, but disclosed

Data exposures are charted nowhere on the grid — but their ATT&CK mapping is a real fact about the exposure, so the report still discloses it. Expand the **Data-mapped** line to reveal one row per Data element, each with its technique chips. The element name drills to its profile; each chip opens the technique dialog.

> **A Data chip is identity, not coverage.** Because these techniques are off-grid, the chips carry no tier fill and no glyph. A chip tells you *which* technique the Data exposure maps to — never that it is covered or uncovered. Don't read a present chip as a win.

> **Why off-grid matters.** If you only read the grid, you'd miss live threats that simply can't be charted. The off-grid counts force those into view: an exposure with no mapping, or on Data, is still a live exposure in your model. The grid is honest precisely because it admits what it can't chart.

---

## Talking About Coverage Honestly

The most important thing this surface does is refuse to produce a flattering aggregate. Keep these caveats with you whenever you report coverage results. The **ⓘ Modeled coverage** toggle in the controls row spells them out on screen, and the same wording rides into every export footer.

- **Coverage is modeled, not measured.** It reflects controls *asserted in your model*, not telemetry from a running system. "Covered" means a control is wired to counter the technique at some tier — it is a design claim, not evidence of effectiveness.
- **There is no percentage and no single total.** This is intentional. A percentage invites a screenshot that says "we're 80% covered," which blends DIRECT certainty with broad D3FEND inference and hides detect-only gaps. The tier-by-tier, function-by-function presentation can't be flattened into that one number.
- **Name the tier and the function.** Report "DIRECT-prevent for 3 of 4 elements on technique T1059," not "T1059 is covered." The qualified statement is the honest one.
- **Off-grid items are part of the story.** When you brief, mention the unmapped, Data, and structural-gap counts. They are exposures your coverage view *can't* speak to, and omitting them recreates the false all-clear the design works to prevent.

> **A clean grid is not a clean model.** An empty worklist means every *charted* technique has a preventive control. It says nothing about unmapped exposures, Data-level threats, structural gaps, or whether any of those controls actually function in production. Always read the off-grid line alongside the grid.

---

## Acting on Gaps

Use the matrix to decide *where to invest in controls*, in this order:

1. **Turn on the uncovered + detect-only worklist.** This is your prevention shortlist — every technique you cannot currently stop.
2. **Sort by attacker objective.** Click the tactic headers to see where gaps cluster. A wall of uncovered cells under **Impact** or **Exfiltration** is a different conversation than scattered gaps under **Discovery**.
3. **Drill to the element.** Expand a technique and click an uncovered element to open its **Component Profile**, where you can see what controls it already has and what's missing.
4. **Audit your weakest wins.** Switch the Tier filter to `D3FEND only`. These are "covered" only by broad inference — candidates to reinforce with a more specific control.
5. **Close structural gaps deliberately.** A structural-gap line means an entire element class has no controls anywhere. That's a maturity decision, not a single fix — plan it as program work.

Adding or mapping a control changes the model, which makes the report **stale**. Add or adjust the control through the normal controls workflow, then **Recreate** the snapshot to fold the change into a fresh coverage view. For recording decisions on findings (and how disposition removes an exposure from the live grid while keeping it in Residual Risk), see [Working with Findings](./WORKING_WITH_FINDINGS.md).

---

## Related Guides

- **[Getting Started](./GETTING_STARTED.md)** — generating, refreshing, and exporting the report; the Coverage Tools prerequisite.
- **[Reading the Report](./READING_THE_REPORT.md)** — the shared visual language and the technique dialog.
- **[Reachability](./REACHABILITY.md)** — which crown jewels attackers can reach over modeled routes.
- **[Working with Findings](./WORKING_WITH_FINDINGS.md)** — the Residual Risk ledger, recording decisions, and the Component Profile.
- **[Guide Index](./README.md)** — the full Threat Report documentation set.
