---
title: 'Boundary Trust Zones'
description: 'Record each security boundary''s trust zone, business domains, operational role, and approved channels to document how your system is meant to be segmented.'
category: 'modeling'
position: 9
navigation: true
tags: ['intermediate', 'guide', 'boundaries', 'trust-zones', 'zoning', 'segmentation', 'conduits', 'practical']
---

# Boundary Trust Zones

*Record each security boundary's trust zone, business domains, operational role, and approved channels to document how your system is meant to be segmented.*

Boundary zoning lets you place every security boundary on a **trust gradient** and declare which boundaries are *supposed* to talk to each other. It captures your **design intent** — the segmentation you meant to build — so later security analysis can judge the model against it.

> **What this does, and what it does not do.** Zoning and approved channels are *declared design intent*. The platform records them; it does **not** verify or enforce them in this version. Setting a zone does not block traffic, and declaring an approved channel does not validate that the channel exists. Enforcement and validation are left to security analysis. See [What zoning does and does not do](#what-zoning-does-and-does-not-do).

## Prerequisites

Before you start:

- A model open in the **Data Flow Editor** with at least one **security boundary** other than the default root boundary. To create boundaries, see [Building Your First Model](BUILDING_YOUR_FIRST_MODEL.md#set-up-security-boundaries).
- Editing rights on the model (the editor is in **Edit mode**, not **View mode**).

The **Zoning** tab is available on every boundary *except* the default root boundary.

## Terms

| Term | Meaning |
|------|---------|
| **Trust zone** | The tier you place a boundary on, from a fixed list (Internet-facing through Restricted, plus two external tiers). It describes who can reach the boundary. |
| **Zone inheritance** | A boundary with no zone set here takes the zone of its nearest ancestor boundary that has one. |
| **Unclassified boundary** | A boundary with no zone set anywhere up its parent chain. It falls back to the default **Internal** tier and is flagged for attention. |
| **Domain** | A free-text tag naming a business function the boundary serves (for example `payments`, `erp`). |
| **Role (plane)** | Whether the boundary runs application **Workload**, **Management** (admin / control) infrastructure, or both. |
| **Approved channel (conduit)** | A peer boundary you intend this boundary to communicate with, in a chosen direction, with an optional justification. |

## Trust zones and the inheritance model

A **trust zone** answers one question: *who can reach this boundary?* You pick one from the **Trust zone** dropdown. The zones, grouped as **Your tiers** and **Outside**, are:

**Your tiers** (ordered outermost-first by exposure):

| Zone | Reachable by |
|------|--------------|
| **Internet-facing** | Reachable directly from the internet |
| **Behind the front door (DMZ)** | Reachable only through a public edge |
| **Internal** | Reachable only from trusted zones — no untrusted ingress |
| **Restricted** | CDE, secrets, domain controllers, regulated-data stores |

**Outside:**

| Zone | Reachable by |
|------|--------------|
| **Open internet** | Anonymous, hostile — the open internet |
| **Trusted external** | Vetted vendor / partner |

### Inheritance

You do not have to set a zone on every boundary. A boundary with no zone of its own **inherits** the zone of its nearest ancestor boundary that has one:

```
Edge Network        →  Internet-facing      (set here — "declared")
└── App Tier        →  Internal             (set here — "declared")
    └── Cache       →  Internal             (no zone set — inherited from App Tier)
        └── Worker  →  Internal             (no zone set — inherited from App Tier)
```

If nothing up the chain is set, the boundary is **unclassified**: it falls back to the default **Internal** tier and is flagged so you can review it later. In the dropdown, an unset boundary shows a muted, italic placeholder naming the value it would resolve to — for example *Internal (inherited from App Tier)* or *Internal (default)*.

### How zones appear on the canvas

Each boundary can show a small **pill** with its zone word (`Internet-facing` shows as **Public**, `Behind the front door (DMZ)` as **DMZ**, and so on):

- **Solid pill** — the zone is **declared** on this boundary.
- **Dimmed / outlined pill** — the zone is **inherited** from an ancestor.
- **No pill** — the boundary is **unclassified** (no zone anywhere in its chain). Unclassified boundaries stay uncluttered rather than carrying a default pill everywhere.

## Set a boundary's trust zone

1. In the **Data Flow Editor**, double-click the boundary to open its settings.
2. Click the **Zoning** tab (the shield icon) in the left tab rail.
3. Open the **Trust zone** dropdown and pick a tier. Each option shows its *reachable by* hint as a subtitle.
4. Read the consequence line directly under the field — it restates the *reachable by* meaning of your choice.
5. Click **Save**.

**Result:** the boundary now shows a solid zone pill on the canvas, and any child boundary without its own zone inherits this one.

To **clear** a zone and fall back to inheritance, use the clear (✕) control on the field. The boundary then shows the inherited (or default) value as a muted placeholder.

> **Tip — overriding an inherited zone.** When a boundary is inheriting a zone, the tab names the source ("Inherited from App Tier. Set it here if this boundary differs."). Set a zone explicitly whenever a child is genuinely stricter than its parent — for example a **Restricted** data store nested inside an **Internal** app tier. Leaving it to inherit a coarser parent zone can understate the boundary's true exposure.

## Add domains and a role

Domains and role are optional tags that describe *what* a boundary is for, separate from *who can reach it*.

1. On the **Zoning** tab, click **+ Add tags**. (The tags row opens automatically if either field is already set.)
2. In **Business function**, type one or more domain tags and press Enter after each — for example `payments`, `erp`. These are free-text; use whatever names your organization uses for business functions.
3. In **Role**, choose the boundary's operational plane:
   - **Undecided** — not yet classified (the default; distinct from an affirmative "just workload").
   - **Workload** — runs application workload only.
   - **Management (admin / control)** — runs admin / control-plane infrastructure.
   - **Workload + Management** — runs both. The dropdown shows this option with a ⚠ marker, because mixing planes on one boundary is worth a second look (see the Tip below).
4. Click **Save**.

> **Tip.** Treat **Workload** as the default and reserve **Management** for boundaries that genuinely run admin or control infrastructure. Mixing both (**Workload + Management**) on one boundary is worth a second look — it often signals an admin plane that should be segmented out.

## Declare approved channels

An **approved channel** (also called a *conduit*) records that this boundary is *meant* to communicate with a peer boundary, in a chosen direction, with an optional reason. You author channels from the boundary picker.

1. On the **Zoning** tab, expand **Approved channels** and click **Add**. The **Add approved channel** drawer opens from the right.
2. Find the peer boundary. Browse the hierarchy or use **Search boundaries** to filter by name. The current boundary is marked **this boundary** and cannot be selected. A peer that already has a channel is marked **Added**, and each row shows the peer's resolved zone pill.
3. Click the peer to select it. A preview of the peer appears below the list.
4. Choose one or both **directions** — you can author a two-way channel in a single step:
   - **Outbound (this → peer)** — this boundary initiates to the peer.
   - **Inbound (peer → this)** — the peer initiates to this boundary.

   A direction that is already approved shows checked and read-only with an **Added** chip; you cannot re-add it here.
5. (Optional) In **Why**, add a short justification — for example *card-data flow to the payments store*. If you ticked both directions, the same reason is recorded on each.
6. Click **Add channel**.

**Result:** the channel rows appear under **Approved channels** on the tab, each showing a direction arrow (→ out, ← in), the peer name, and your reason. Remove a row with its ✕ button. Click **Save** to commit.

If **Add channel** is disabled, the drawer states why — for example *Pick a peer boundary first*, *A boundary can't connect to itself*, or *Both directions already approved*.

### The nesting warning

If you pick a peer that **contains**, or is **contained by**, the current boundary, the drawer shows a non-blocking advisory. It never stops you from adding the channel — it only flags that the channel may be redundant:

- Connecting a **child to a containing parent** (or to a peer that resolves to the **same trust zone**) is *likely redundant with inheritance*. The warning suggests you approve it only if this boundary overrides to a different tier.
- Connecting a **parent to a nested child** models *controlled ingress*; the advisory suggests modeling the ingress source as its own sibling boundary for a cleaner picture.

The warning advises — it never blocks.

## Use the Zoning overview

The **Zoning overview** is a model-wide companion to the per-boundary tab. It shows every boundary, its resolved zone, and lets you edit zones inline or in bulk.

1. On the **Data Flow Editor** canvas toolbar, click the **shield** button (tooltip **Zoning overview**).
2. The overview opens as a tree of every boundary, nested by containment. Each row shows the **Boundary** name, its **Trust zone** (with a caption reading **Declared**, *Inherited from …*, or *Unset → default Internal*), its **Role**, and its **Channels** count.

**Edit one zone inline.** Change the **Trust zone** dropdown in any row. The change is saved immediately.

**Set a zone on many boundaries at once:**

1. Tick the checkbox on each boundary you want to change.
2. Click **Set zone for N selected** and pick a zone (or **Clear (inherit)**).
3. The change is applied to every selected boundary immediately.
4. A toast confirms the result with an **Undo** button — click it to revert the whole batch.

**Find the gaps.** The toolbar shows an **N unclassified** count. Turn on **Show only unclassified** to filter the list down to boundaries that have no zone anywhere in their chain, so you can work through them. A collapsed parent in the tree carries a roll-up badge ("N unclassified inside") so a fold never hides outstanding work. Use **Expand all** / **Collapse all** to navigate large models.

## Worked example: a three-tier web application

Suppose your model has an edge, an application tier, and a data tier, nested like this:

```
Edge Network                Internet-facing   (declared)
└── Application Tier        Internal          (declared)
    └── Data Tier           Restricted        (declared)
        └── Backup Store    Restricted        (inherited from Data Tier)
```

To build this out:

1. **Edge Network** — open its **Zoning** tab and set **Trust zone** to **Internet-facing**. It faces the public internet.
2. **Application Tier** — set **Trust zone** to **Internal**. It is reachable only from trusted zones, never directly from the internet.
3. **Data Tier** — set **Trust zone** to **Restricted**. It holds regulated data, so it is stricter than its **Internal** parent. Setting it explicitly is what keeps the data tier from silently inheriting the coarser **Internal** zone.
4. **Backup Store** (nested in Data Tier) — leave its zone unset. It **inherits Restricted** from the Data Tier, which is correct, so there is nothing to declare.

Then declare the channels you intend:

- On **Application Tier**, add an **Outbound** approved channel to **Data Tier**, with the reason *application reads/writes regulated records*.
- On **Edge Network**, add an **Outbound** approved channel to **Application Tier**, with the reason *front-end forwards requests to the app tier*.

Open the **Zoning overview** to confirm the tree resolves as expected: three declared rows, one inherited row, and **0 unclassified**.

## What zoning does and does not do

**Zoning records declared design intent.** It documents how you *meant* to segment the system:

- Trust zones say which exposure tier each boundary belongs to.
- Domains and role say what each boundary is for.
- Approved channels say which boundaries are *supposed* to communicate, and why.

**Zoning does not verify or enforce anything in this version:**

- Setting a zone does **not** block, filter, or shape traffic.
- Declaring an approved channel does **not** confirm that the channel exists, nor does the absence of a channel prevent a flow from being modeled or analyzed.
- The nesting warning **advises**; it never blocks an action.

That judgement — whether the real or modeled flows match your declared intent — is the job of **security analysis**, which reads your zoning as the baseline of how things are *meant* to be. Keep your zones honest: an over-broad parent zone inherited by a sensitive child can understate risk in later analysis.

## Best practices

- **Declare the outer tiers first, then let the inside inherit.** Set zones on the boundaries that face the world (Internet-facing, DMZ) and on each tier where the trust level genuinely changes. Leave boundaries that share their parent's trust level unset and let inheritance do the work.
- **Always override when a child is stricter.** A Restricted store inside an Internal tier must be declared Restricted — inheritance would otherwise understate it.
- **Drive the unclassified count to zero.** Use the Zoning overview's **Show only unclassified** filter as a worklist.
- **Write a reason on every approved channel.** The *Why* is what makes the declared intent reviewable later.
- **Heed, but don't fear, the nesting warning.** A flagged channel is usually redundant with inheritance — but it is allowed when a child genuinely overrides to a different tier.

## Next steps

- **[Building Your First Model](BUILDING_YOUR_FIRST_MODEL.md)** — create the boundaries you zone here.
- **[Security Analysis Workflow](SECURITY_ANALYSIS_WORKFLOW.md)** — run analysis that reads your declared zoning as its baseline.
- **[Component Configuration Guide](COMPONENT_CONFIGURATION_GUIDE.md)** — configure the components that live inside each boundary.
- **[Managing Findings](MANAGING_FINDINGS.md)** — record decisions on the exposures analysis surfaces.
