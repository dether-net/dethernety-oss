---
title: 'Reachability and Flow Routes'
description: 'Exploring flow routes to crown-jewel assets and between any two elements — and what the analysis does and does not model'
category: 'documentation'
position: 5
navigation: true
tags: ['threat-report', 'reachability', 'flow-routes', 'crown-jewels']
---

# Reachability and Flow Routes

The **Reachability** tab helps you see how data moves through your model toward the things you care about most, and which threats sit along the way. Pick an origin and the tab traces the **flow routes** — directed paths that follow your modeled data flows — to your crown jewels, or between any two elements you choose. For each route it shows you how many hops it takes, where it crosses a security boundary, what data sensitivity it carries, and the worst live threat sitting on it.

Before you read any of that, read this once: **these are flow routes, not attack paths.** The tab models your topology — how flows connect — and nothing about how hard a real attacker would work to traverse them. Used with that framing, it is a sharp tool for validating your segmentation intent and spotting surprises. Used as an attack-path predictor, it will mislead you and anyone you brief. The whole of [How to Read This Correctly](#how-to-read-this-correctly) exists to keep you on the right side of that line, and the same caveat is printed at the top of the tab itself.

---

## Three Ways to Trace

The tab opens on a short caveat line and a three-button toggle:

| Mode | Button | Use it to |
|---|---|---|
| **Crown-jewel reachability** | `Crown-jewel reachability` | Rank your crown jewels by whether — and how directly — they can be reached from a chosen origin. |
| **Pick two** | `Pick two` | Trace and read the individual flow routes between any two elements you select. |
| **Blast radius** | `Blast radius` | Pick one node and see *everything* it can reach by modeled flows — the containment question: "if this were compromised, how far does it spread?" |

A faithful minimap of your model sits alongside all three modes. It paints the active route — or, in **Blast radius**, the whole reachable cone — so you can see it in the shape of your real diagram, and in **Pick two** it doubles as a way to choose your endpoints by clicking nodes.

> **Crown jewels come first.** A crown jewel is a component you have flagged as a high-value asset (the crown toggle on a component's settings). If no component in the model is flagged, **Crown-jewel reachability** has nothing to rank — it tells you so and points you to **Pick two**, which traces routes between any elements regardless of flagging.

---

## Crown-Jewel Reachability

This mode answers one question for every crown jewel in the model: starting from a chosen origin, is there a modeled flow route to it — and if so, how direct is it?

### Choosing the origin

The **From** selector sets where routes start. It defaults to the model's external entry-points and lets you choose any single node instead.

| Origin | What it means |
|---|---|
| **External entry-points** (default) | Every external entity in the model becomes a starting point at once. This is the structural "from outside the model" view. |
| **A single node** (assumed-breach) | You pick one component and ask: if this node were the starting point, which crown jewels could be reached onward from it? The label reads `assuming <node> is breached`. |

> **"Assumed-breach" is a structural premise, not a verdict.** Choosing a node as the origin does not say that node is weak, untrusted, or compromised. It is simply a what-if: *start the trace here.* The tab never makes a trust judgment about any node.

If the model has no external entities, the default origin has nothing to start from. The tab says so and invites you to pick a specific node as an assumed-breach origin instead.

### Reading the per-jewel results

A summary line reports how many of your crown jewels are reachable from the chosen origin — for example `3 of 5 crown jewels reachable from external entry`. Below it, each crown jewel appears as a row:

| You see | It means |
|---|---|
| A filled dot and **reachable** | A modeled flow route exists from the origin to this jewel. |
| `shortest route N hops · M crossings` | The fewest data-flow steps to reach it, and how many boundary crossings that shortest route makes. |
| `worst on any route: <band>` | The most severe live threat sitting on *any* route to this jewel (this may be a longer route than the shortest one). |
| An open dot and **no modeled flow route** | No directed flow route from the origin reaches this jewel in the model. |

A jewel name is clickable — it opens that element's **Component Profile**. Reachable jewels also offer **view strip** (open the shortest route as a readable strip in **Pick two**) and **show on map** (paint the route on the minimap).

> **Read "no modeled flow route" as exactly that — a statement about the model, not a guarantee.** It means the diagram contains no directed chain of data flows from the origin to this jewel. It does **not** mean the asset is segmented, isolated, or safe. The most common cause is an incomplete model. When a count reads `0 reachable`, the tab deliberately labels it a modeled-topology gap and points you to the report's scope banner — never a reassuring green.

### Tracing onward, step by step

Each node on a route carries an **onward** action. Clicking it re-anchors the origin to that node and recomputes the crown-jewel list from there. This lets you explore a model one step at a time — "starting from here, what's reachable next; and from there, what next" — without typing in new endpoints each time. It is a navigation aid for following the topology, nothing more.

---

## Pick Two

**Pick two** enumerates the flow routes between any two elements you choose and renders one of them as a readable strip.

### Choosing the endpoints

You have two ways to set the **Origin** and **Target**, and they stay in sync:

- **The autocompletes.** Type into the `Origin` and `Target` fields and choose from the list. Each is clearable.
- **The minimap.** Enlarge the map with its expand button (top-left corner), then click nodes directly: your first click sets the origin (it shows a dashed outline as a pending pick), the second sets the target, and a third click starts over. A **reset selection** link clears both.

The map hint below the minimap tells you which endpoint it's waiting for next.

### Reading the route strip

Once both endpoints are set, the tab lists the routes it found, shortest first. Selecting a route draws it as a linear strip — like a transit line — that reads left to right from origin to target:

| Strip element | What it tells you |
|---|---|
| A node glyph and name | A component on the route. A crown jewel uses a distinct hexagon glyph. The name opens its **Component Profile**. |
| An italic flow name between nodes | The data flow making that hop. Click it to open the flow's profile. |
| A sensitivity chip on a hop | The highest data **sensitivity** that flow carries (for example `Restricted`). `unclassified` means the flow carries data with no sensitivity set, which is not the same as Public. |
| `◂ EXIT <boundary>` / `▸ ENTER <boundary>` | A security-boundary crossing on that hop. The flow leaves one boundary (EXIT) or enters another (ENTER). Click it to open the boundary. |
| A colored dot | The worst live threat on that node or flow, by severity band (critical, high, medium, low). |

Each node also carries the same **onward** action as crown-jewel mode, so you can pivot from any point on a strip into a fresh trace.

### When there are many routes — or none

Route enumeration is **bounded**: routes are simple paths (no node is visited twice), capped in length and in how many are collected. The tab is always honest about that boundary:

| You see | It means |
|---|---|
| `N flow routes found` | The full set fit within the limits — this is all of them. |
| `Showing X of N routes.` | More routes exist than are shown; X are displayed out of N counted. |
| `Showing X routes — enumeration capped; more exist.` | The model is dense enough that enumeration stopped early. The exact total is not claimed. |
| `No modeled flow route connects <origin> → <target>` | No directed route within the hop limit, respecting flow direction. The tab adds that this reflects the modeled topology, not a segmentation assessment. |

This banner is persistent — it stays on screen and travels into exports. The tab never silently truncates a route list.

---

## Blast Radius

Where the first two modes ask *"can the attacker reach a specific target?"*, **Blast radius** asks the **containment** question: *if this one node were compromised, how much of the model is exposed?* You pick a node — its assumed-breach origin — and the tab shows every component reachable from it by following modeled flows downstream.

### Choosing the node and the scope

The **Assume breached** selector picks the origin node. A two-button toggle sets how far the radius extends:

| Scope | What it shows |
|---|---|
| **Full radius** (default) | Every component transitively reachable downstream — the complete blast radius. Each node is labelled with how many hops away it is. |
| **Direct (1-hop)** | Only the immediate downstream neighbours — the nodes one flow away. |

The radius is **forward only**: it follows flow direction outward from the node (where an attacker could pivot *to*), never backward toward it.

### Reading the radius

A summary line reports the reach — for example `Storefront reaches 5 of 6 other components · ⬢ 3 crown jewels in radius · worst on reachable: Critical`. Below it, each reachable node is a row, ordered nearest-first:

| You see | It means |
|---|---|
| `⬢` before the name | This reachable node is a crown jewel — a high-value asset caught in the radius. |
| `N hops · M crossings` | The fewest flow steps to reach it from the origin, and how many security boundaries that shortest path crosses. |
| A severity dot + band | The worst live threat sitting on that reachable node. |
| A sensitivity chip | Sensitive data that node handles. |
| `▸ set as origin` | Re-anchor the radius to *that* node — trace its own blast radius, step by step outward. |

The whole reachable cone is painted on the minimap at once, so you can see the spread in the shape of your real diagram.

> **An empty radius is a containment result, not a clean bill of health.** If a node reaches nothing downstream, the tab says so plainly — and immediately adds that this is **not** a proof of isolation. Unmodeled flows, shared credentials, and non-flow vectors are all outside what this view can see. Read it as "no *modeled flow* spreads from here," never as "this node is safely contained." The blast radius is a reachability count, never a risk score.

---

## The Minimap and the Route Legend

The minimap is a small, faithful copy of your hand-laid diagram — it uses your real layout, not an auto-generated one. It serves both modes:

- **Crown jewels** are drawn in red and **external entry-points** in amber, so you can spot them at a glance.
- The **active route** is painted in cyan — both the nodes and the exact flow edges along it — so you can see the route in the context of the whole model.
- The expand button opens a larger, labeled view. In **Pick two** that enlarged map is the primary place to click your two endpoints.

A **Route legend** appears beneath the minimap in **Pick two**, decoding the strip's glyphs: the component and crown-jewel markers, the flow-name connector, the `EXIT`/`ENTER` crossing signs, the worst-threat dots from critical to low, and the data-sensitivity chips. The legend reuses the strip's own colors, so what you see in the legend matches the strip exactly. The shared minimap and sensitivity vocabulary are described once in [Reading the Report](./READING_THE_REPORT.md).

---

## How to Read This Correctly

This is the part to internalize before you brief anyone. The tab is a **topological** view. It tells you how your modeled data flows connect — and deliberately models nothing about attacker behavior.

### Flow routes are not attack paths

A route here is a chain of *modeled data flows*, traced in the direction those flows run. It is not a sequence of exploits, and it makes no claim that an attacker could actually walk it. Two systems that exchange data are connected by a flow route whether or not that connection is exploitable.

### A hop count is proximity, not effort

`3 hops` means three data-flow steps along the diagram. It does **not** mean three steps of attacker work, three vulnerabilities, or "easy." A three-hop route across hardened, well-controlled systems is harder to abuse than a one-hop route across an unpatched one — and the tab cannot tell the difference, because effort is not what it measures.

### What the analysis does not model

The trace is purely structural. It does **not** account for:

- **Credential reuse or token theft** — moving by stealing an identity rather than by following a flow.
- **Exploit chaining** — stringing vulnerabilities together to pivot.
- **Controls as obstacles** — a route's hop count is unchanged by how well each node is defended.
- **Trust levels** — the origin set is external entities or a node you chose, never an "untrusted" classification.

The threat dots on a route tell you which *modeled findings* sit on those elements; they do not turn the route into an exploitability estimate.

### "No modeled flow route" is not "safe"

This is the easiest claim to get wrong. An unreachable crown jewel means the *model* contains no directed flow chain to it — most often because the model is incomplete, not because the asset is isolated. Always check the report's scope banner alongside it. Never report an unreachable jewel as "segmented" or "protected."

### Language to use with stakeholders

> **Say this:** "In our model, customer records are reachable from external entry in two flow hops, crossing one boundary, with a high-severity finding on the route." This is precise and defensible.
>
> **Not this:** "An attacker can reach customer records in two steps." That over-claims — it converts a modeling statement into an attack prediction the tool never made.

---

## Common Uses

Within those limits, the tab earns its place in a review:

- **Validate segmentation intent.** You believe a sensitive store should only be reachable through a gateway. Set the store as a **Pick two** target (or check it in crown-jewel mode) and confirm every route passes through the boundary and node you expect. A route that skips them is a modeling finding worth investigating — either the model is wrong, or your segmentation is.
- **Spot unexpectedly short routes to crown jewels.** A crown jewel reachable from external entry in one hop is worth a second look. The hop count won't tell you it's exploitable, but a surprisingly direct *modeled* connection is exactly the kind of thing a design review should question.
- **Find sensitive data crossing boundaries.** Read the sensitivity chips and `EXIT`/`ENTER` signs along a route to see where `Restricted` or `Confidential` data leaves one boundary and enters another. That tells you where to focus controls and where to look harder in [Boundary Crossings](./READING_THE_REPORT.md).
- **Walk an assumed-breach what-if.** Pick a node as the origin and use **onward** to step through what the topology connects to from there — a structured way to explore reach *in the model*, framed honestly as topology rather than prediction.
- **Size a node's blast radius.** Use **Blast radius** to ask the containment question directly: if this node fell, how many components — and which crown jewels — does a modeled flow reach from it? A surprisingly wide radius is a segmentation prompt; a narrow one is a containment signal (not a safety guarantee). Use **set as origin** to walk the spread node by node.

---

## Next Steps

- **[Reading the Report](./READING_THE_REPORT.md)** — the shared minimap and data-sensitivity language, plus **Boundary Crossings**.
- **[Working with Findings](./WORKING_WITH_FINDINGS.md)** — the **Residual Risk** ledger and the **Component Profile** that route elements drill into.
- **[Understanding Coverage](./UNDERSTANDING_COVERAGE.md)** — the **Coverage & Gaps** MITRE ATT&CK matrix.
- **[Getting Started](./GETTING_STARTED.md)** — generate, refresh, and export the report.
- **[Guide Index](./README.md)** — the full Threat Report documentation set.
