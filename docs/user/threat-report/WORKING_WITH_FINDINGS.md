---
title: 'Working with Findings'
description: 'The Residual Risk ledger, triaging findings, filtering, and the per-element Component Profile'
category: 'documentation'
position: 6
navigation: true
tags: ['threat-report', 'residual-risk', 'findings', 'dispositions', 'component-profile']
---

# Working with Findings

The **Residual Risk** tab is the Threat Report's findings ledger. It lists every model element that carries findings, groups the findings under the element they belong to, and separates what's still open from what you've already **dispositioned**. This is where you triage: read a finding, decide what to do about it, record that decision, and move on. From any element here you can open its **Component Profile** to investigate it in depth.

This guide assumes you've already generated a report and know how to move between tabs. If not, start with [Getting Started with the Threat Report](./GETTING_STARTED.md). The shared visual language — score bands, sensitivity chips, the freshness banner — is explained in [Reading the Report](./READING_THE_REPORT.md).

> **The ledger never hides anything.** A dispositioned finding keeps its decision attached — who, when, and why — and is never dropped. A finding you've **affirmed** stays in the live, open set: it's a confirmed risk, not a muted one; only the muting decisions move it aside. The counts you see always describe the whole model.

---

## The Residual Risk Ledger

Open the **Residual Risk** tab. At the top you'll see a summary line such as:

```
37 findings · 28 open · 9 dispositioned · 2 stale
```

Two parts of that line are conditional. Before you record your first decision it spells the situation out — `28 open · 0 dispositioned — none dispositioned yet` — and the `· N stale` segment appears only when at least one recorded decision has gone stale.

Below it, findings are organized **per element**. Each element with at least one finding gets its own group, headed by the element's name (a dotted link — click it to open the **Component Profile**), its type, and a per-element count such as `5 open · 2 dispositioned`. Elements with open findings are sorted to the top, worst score band first, so the work that needs attention rises.

> **The tab strip carries no counts.** The five tabs across the top are plain labels — **Posture**, **Coverage & Gaps**, **Reachability**, **Boundary Crossings**, **Residual Risk** — with no badge or backlog number on any of them. To size your triage backlog, use the **Not reviewed** filter chip inside this view; see [Filtering and focusing](#filtering-and-focusing).

### Zoning advisories

Above the scored findings, a collapsed **zoning advisories** block may appear — per-boundary notes about your trust-zoning declarations. They are **un-scored**: no band, no score, no coverage claim, and they order nothing. They sit apart from the findings ledger deliberately, because they describe a *boundary's* declaration rather than a scored exposure on an element. Expand the block to read them; each note names the boundary (drillable to its **Component Profile**) with a short detail.

The advisories cover four things:

| Advisory | What it flags |
|---|---|
| **Unclassified boundaries** | A boundary with no declared zone — a modeling gap, so declare its exposure position. |
| **Under-protected asset holders** | A boundary holding sensitive assets at a lower trust tier than they warrant. |
| **Management plane on an exposed tier** | A control-plane (management) boundary sitting on an externally exposed tier. |
| **Shared-domain cross-tier coupling** | Boundaries in the same domain wired across trust tiers in a way worth a second look. |

> **These are prompts, not failures.** A zoning advisory says "review how you've zoned this boundary," never "this is a violation." Per-flow policy verdicts — the things that can *fail* your data-flow policy — live in **Boundary Crossings**, not here. See [Reading the Report](./READING_THE_REPORT.md#the-boundary-crossings-view).

### Open versus dispositioned

Within each group, findings sit in one of two partitions:

| Partition | What it means |
|---|---|
| **Open** | Live work — shown as a full table. A finding is open when no decision has been recorded yet, **or** when you've **affirmed** it as a confirmed risk. Affirmed findings carry a **Confirmed** marker but stay here, because they are still live residual risk. |
| **Dispositioned** | A *muting* decision has been recorded (any kind other than Affirm). These move into a muted, collapsible block labeled with the count — `2 dispositioned`. Expand it to see them, each with its kind, who set it, when, and the reason they wrote. |

Recording a muting decision moves a finding into the dispositioned partition; it is set aside and counted, never deleted. **Affirming** a finding records a decision too, but keeps it in the open set with a **Confirmed** marker — affirming says "I've reviewed this and it's a real, live risk," not "mute it."

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

Triage means deciding what to do about a finding. Each finding row carries its own **action set** — a compact 2×2 grid of glyph buttons — so you can act without leaving the ledger. Most of these hand off to the platform's own disposition dialog, the same one you'd use on the canvas, so your decisions live with the model rather than only inside the report.

### The action set

The actions are compact glyph buttons at the right of the row. Hover one to read its label in a tooltip (screen readers get the same label).

**The set is not the same on every row.** Which actions you get is decided by two things: where the finding came from (you or the analysis) and where it is in its lifecycle.

| The finding is… | Actions offered |
|---|---|
| **Yours** — source `USER` | **Delete**, **Issue** |
| **System**, no decision recorded yet | **Affirm**, **Dispose**, **Customize**, **Issue** |
| **System**, affirmed | **Add note**, **Customize**, **Issue** |
| **System**, dispositioned (muted) | **Edit disposition**, **Issue** |
| **System**, decision has gone **stale** | **Review**, **Issue** |

Stale wins over everything else in that table: whatever a system finding's lifecycle, a stale decision collapses its set to **Review** and **Issue** until you re-record the decision.

Two consequences are worth naming, because they surprise people:

- **You cannot affirm or dispose your own findings.** A finding you authored is yours to edit on the canvas or delete — the triage actions are for findings the analysis produced.
- **An affirmed finding has no Dispose action.** To convert a confirmation into a mute, open **Add note**, use **Remove disposition** in that dialog to clear the affirmation, then **Dispose** the finding once it is back to untriaged.

Here is what each action does:

| Action | Glyph | What it does |
|---|---|---|
| **Affirm** | `✓` | Confirm the finding as a **live risk** — "I've reviewed this and it's real." One click, no dialog: the row picks up a **Confirmed** marker immediately and a snackbar offers **Undo**. It is *not* muted. |
| **Dispose** | `⊘` | Mute the finding with a reason. Opens the disposition dialog, where you pick a muting kind (see [the disposition kinds](#the-disposition-kinds) below) and write why. The finding moves to the **dispositioned** partition. |
| **Customize** | `⧉` | Take over a system finding with your own editable copy — use it when the system's finding is close but not quite right. The original is set aside as **Superseded**; your copy is created on the model. Because the copy is a *new* finding, the report can't show it until you **Recreate** — the confirmation message says so. |
| **Add note** | `✎` | Revisit an affirmation. Opens the same dialog with the kind locked to **Affirmed** (titled *Re-affirm Exposure*), so you can adjust the note without any risk of converting a confirmation into a disposal. |
| **Edit disposition** | `✎` | Reopen a recorded disposition with its kind and reason loaded, to change either — or to lift it entirely with **Remove disposition** (a two-tap confirm). |
| **Review** | `⟳` | The single action a stale decision offers. It reopens the right dialog for the decision you made — the re-affirm dialog for a confirmed finding, the dispose dialog for a muted one — so you can re-record it and clear the stale flag. |
| **Issue** | `⚑` | Raise an issue from the finding. Opens a picker to copy it to an issue board or create a new issue against the element, so the finding becomes tracked work. |
| **Delete** | `🗑` | Remove a finding you authored. It is a two-step confirm in place: the first click arms the button (it turns red), the second deletes. System findings are never deletable — customize or dispose them instead. |

Every dialog on this path demands a **reason** (up to 2000 characters). It travels with the finding and is what a later reviewer reads, so write for them.

> **If the actions aren't there at all.** The action cluster renders only when the host application exposes the finding-action services to the report. On a deployment whose platform build predates them, no row shows actions and the report is a pure read surface — you can read, filter, and export, but not triage. That is a version mismatch, not a per-user setting.

> **Your decisions show up immediately — the snapshot does not change.** A decision you record here is patched onto the rows in front of you at once (the marker appears, the row moves partition), and a note above the tabs counts them: *Reflecting N changes made since this snapshot was generated.* The stored snapshot itself still describes the model as of generation, which is why **exports are disabled** while those changes are pending. Click **Recreate** — in that note or in the banner — to fold them into a fresh snapshot and refresh the derived views. See [Getting Started](./GETTING_STARTED.md#snapshots-and-freshness).

### The disposition kinds

Every finding in this ledger is an **exposure**, and when you **Dispose** one the dialog offers exactly four muting kinds. Choose the one that matches your actual reasoning — the label travels with the finding and is what a later reviewer will read. (To keep a finding live instead of muting it, use **Affirm**, not one of these.)

| Disposition | Use it when |
|---|---|
| **Not Applicable** | The finding doesn't apply to this element as modeled — the condition it describes isn't present here. |
| **False Positive** | The finding was raised in error. It is not a real exposure for this element. |
| **Compensating Control** | A real exposure, but another control already mitigates it to your satisfaction. State which control in the reason. |
| **Risk Accepted** | A real, unmitigated exposure that the business has consciously decided to accept. Record who accepted it and why. |

Two further kinds exist in the platform, and neither is offered here:

- **Superseded** is never something you pick. It is what the **Customize** action sets on the original when it creates your editable copy.
- **Waived** is a *countermeasure* kind — a decision not to implement a control. Countermeasures are triaged on the control, not in this report; see [Managing Findings](../MANAGING_FINDINGS.md).

> **A consistency check, not coverage math.** If you mark a finding **Compensating Control** on an element that has *no* control present in the model, the ledger flags that as an auditable inconsistency — a claim with nothing backing it. It doesn't block you; it surfaces the gap so you can reconcile the model.

---

## Stale Dispositions

A recorded decision can be flagged **stale**. In the dispositioned block the finding's row picks up an amber left edge and its decision line carries a `⚠ stale` marker; in the open table a stale *affirmation* carries no marker of its own — what tells you is the row's action set, which has collapsed to **Review**. Either way, the count of stale decisions appears in the summary line at the top of the tab.

**Stale means the underlying finding changed after the decision was recorded.** The attributes the decision was based on are no longer the attributes in front of you, so the decision may no longer hold. The flag is a prompt to revisit — and the row makes that the only thing you can do: a stale finding's action set collapses to **Review** and **Issue**.

Click **Review**. It opens the dialog that matches the decision you originally made — the re-affirm dialog for a confirmed finding, the dispose dialog for a muted one — with a warning at the top: *Model attributes changed since this disposition was set. Review and re-affirm if it still applies.* Re-read the finding, adjust the reason if your reasoning has moved, and save with **Re-affirm**. That re-stamps the decision with your name and the current time, and clears the flag. Don't trust a stale call at face value.

> **Why this matters.** A "Risk Accepted" or "Compensating Control" decision made against an earlier version of a finding can quietly stop reflecting reality. Surfacing staleness keeps an out-of-date decision from silently guarding a live exposure.

---

## Filtering and Focusing

When the ledger is large, the filter bar narrows it to what you care about. It sits just under the summary line (labelled **Filter**, and shown only when the model has findings at all) and offers four groups of facets plus a clear control.

| Facet group | Choices |
|---|---|
| **Band** | `Critical`, `High`, `Medium`, `Low`, `Unknown` — only the bands actually present in the model get a chip |
| **Source** | `User`, `System` |
| **Status** | `Not reviewed`, `Confirmed` |
| **Element type** | `Component`, `Data`, `Boundary`, `Data Flow` — only the types present in the model appear |

Every chip carries its whole-model count. **Status** is the one to reach for when you want to size your triage backlog: `Not reviewed` selects the live findings nobody has decided on yet, `Confirmed` the live ones you have affirmed. Both are *live* states, so selecting either empties the dispositioned block — a muted finding is neither.

Each facet you turn on appears as a removable breadcrumb chip above the view, labelled with its group: `band: High`, `source: System`, `status: Not reviewed`, `type: Component`. One choice per group, and the groups **combine** — `band: High` plus `source: System` plus `type: Component` shows only high-band system findings on components. Click a chip again, or use the **✕ clear** control, to remove a filter. When a filter matches nothing, the ledger says `No findings match the current filter.` rather than appearing empty.

> **A selector, not a recount.** Turning a facet on changes what is *displayed*. The counts on the chips and in the summary line never move — they always describe the whole model.

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

Each boundary in the stack also carries its **declared trust-zoning tags**, when they're set:

- Its **zone chip** — the boundary's declared exposure position (`UNTRUSTED`, `PUBLIC`, `EXPOSED`, `INTERNAL`, `RESTRICTED`, or `VENDOR`). This is the *effective* zone, which a boundary may inherit from a parent or fall back to a default; hover the chip to see which. A boundary shows no chip on a snapshot generated before zoning was modeled.
- Its declared **planes** (for example `management`) and **domains** — muted context tags, not a verdict.

These are the operator's **declaration**, never recomputed by the report. A chip is an exposure position, not a safety rating — `RESTRICTED` means "declared most sensitive," not "protected."

### Trust zoning

When the element you're drilled into *is* a **Security Boundary**, a dedicated **Trust zoning** block spells out its declared zoning in full. It's labelled *declared intent, not enforcement* — the report reads what you declared, it never proves the boundary is enforced.

The block shows:

- **Zone** — the boundary's effective zone chip and where it comes from: `declared` (set on this boundary), `inherited from <boundary>` (taken from an ancestor), or `default (no zone declared)`. If the snapshot has no zoning, it reads `— (no zoning computed)`.
- **Planes** and **Domains** — the boundary's own declared tags, when set.
- **Conduits out** — the declared **conduits** (approved channels) from this boundary to a peer. A conduit is a *declared* intended channel — declared intent, not proven enforcement. Each peer is drillable; each carries its justification, or `no justification` where none was recorded.
- **Conduits in** — the mirror: peers that declared a conduit reaching *this* boundary. Also drillable, also with justification.

> **A conduit is a declaration, not a permission.** The block records channels you said are approved; it does not verify they're enforced, and it never issues a per-flow verdict. Whether an individual flow through a boundary is legal is judged crossing by crossing in **Boundary Crossings** — see [Reading the Report](./READING_THE_REPORT.md#the-boundary-crossings-view).

### Exposures

The **Exposures** section shows the element's own findings, partitioned exactly like the ledger: an open table (including affirmed, **Confirmed**-marked findings) and a collapsible `N dispositioned` block, each finding carrying its band, score, vector, source, and ATT&CK technique chips. An open finding on an element with no supporting control is flagged `⛉ uncovered`. You can triage right here — each row carries the same provenance-and-lifecycle action set as the ledger, and every action behaves identically.

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

Controls appear in two places — the `Controls present (N):` line at the head of each ledger group, and the **Controls present** section of the profile — and in neither does listing a control claim it covers a particular finding.

The profile is explicit about it: its section header reads *defense-in-depth context — not a coverage claim*. There is no control-to-finding mapping behind that list, so the absence of an `⛉ uncovered` flag does **not** mean "covered" — it means the relationship hasn't been evaluated at the level of an individual finding.

### The `⚠ mismatched` flag

One control signal in the ledger *is* derived from coverage facts, and only appears when the **Coverage Tools** module is deployed. A control on an element that contributes nothing — neither prevention nor detection — against **any** of that element's modeled techniques is tagged `⚠ mismatched` and sorted to the front of the group's control line, with a note:

```
⚠ 2 control(s) here are configured-but-mismatched — present on this element but
pointed at threats it doesn't model, while real gaps stay open.
```

Read it precisely. It is an element-level statement, not a per-finding one: an *unflagged* control covers at least one of the element's modeled techniques — which is not the same as covering the finding in front of you. And a mismatched control is not a broken control; it may be defending against something this model doesn't describe. What the flag is good for is spotting a control credited on paper while the element's actual modeled gaps stay open.

> **Why the report is careful here.** A false sense of coverage is worse than none. Treat a listed control as something present in the model worth knowing about — then judge for yourself, in the disposition reason, whether it actually mitigates the open exposure.

For how techniques map to genuine coverage analysis, see [Understanding Coverage](./UNDERSTANDING_COVERAGE.md).

---

## Next Steps

- **[Reading the Report](./READING_THE_REPORT.md)** — the shared visual language, the **Posture** roll-up, and **Boundary Crossings**.
- **[Understanding Coverage](./UNDERSTANDING_COVERAGE.md)** — how a finding's techniques relate to your MITRE ATT&CK coverage.
- **[Reachability](./REACHABILITY.md)** — which crown jewels are reachable, and what sits on the route.
- **[Getting Started](./GETTING_STARTED.md)** — generating, refreshing, and exporting the report.
- **[Guide Index](./README.md)** — the full Threat Report documentation set.
