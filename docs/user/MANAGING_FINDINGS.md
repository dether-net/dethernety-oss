---
title: 'Managing Findings'
description: 'Record decisions on system-generated exposures and countermeasures — affirm them as confirmed live risk, or mute them as not applicable, false positive, waived, or superseded — instead of deleting them.'
category: 'analysis'
position: 7
navigation: true
tags: ['intermediate', 'guide', 'findings', 'exposures', 'countermeasures', 'disposition', 'workflow']
---

# Managing Findings

*Record decisions on system-generated findings instead of deleting them.*

## Overview

Modules generate findings for you automatically:

- **Exposures** — security weaknesses detected on a component, security boundary, data flow, or data item.
- **Countermeasures** — defensive controls derived from a control's class.

These are *system-generated*: the platform re-derives them whenever the element's class or attributes change. Often you'll disagree with a specific finding for a specific situation — an exposure that doesn't apply to an internal-only tool, a control you've consciously decided not to implement, a finding the template raised by mistake. Deleting it doesn't help: the next time the model changes, the platform recreates it.

A **disposition** records your decision *on* the finding — a kind plus a written reason — so the finding stays visible but clearly marked, the decision survives re-derivation, and your reasoning is captured for the next reviewer.

A disposition does one of two things. Most kinds **mute** the finding: they record that it doesn't apply, isn't real, or has been waived, and the finding drops out of your live risk. One kind — **Affirm** — does the opposite: it records that the finding *is* real and you've confirmed it, and the finding **stays live**. See [Affirming a finding](#affirming-a-finding-confirmed-live-risk) and [The finding lifecycle](#the-finding-lifecycle).

### System-generated vs. your own findings

| | System-generated | Your own (user-authored) |
|---|---|---|
| Created by | A module, automatically | You |
| Edit / delete directly | No | Yes |
| Disposition | Yes — record a decision | No — just edit or delete it |
| Survives re-derivation | Yes | Yes |

To take over a system-generated finding and edit it freely, **Customize** it (see [Customizing a finding](#customizing-a-finding-editable-copy)).

## Disposition kinds

Pick the kind that matches your reasoning. Every disposition requires a reason.

| Kind | Applies to | Keeps finding live? | Meaning |
|------|------------|:---:|---------|
| **Affirmed** | Exposures, Countermeasures | **Yes** | You reviewed the finding and confirmed it: a real, live risk (Exposure) / a control that is confirmed in place (Countermeasure). |
| **Not Applicable** | Exposures, Countermeasures | No | The finding cannot or does not apply to this instantiation. |
| **False Positive** | Exposures, Countermeasures | No | The template raised this finding incorrectly for this kind of element. |
| **Compensating Control** | Exposures | No | Another control — not formally linked — already mitigates this. |
| **Risk Accepted** | Exposures | No | The threat is real and unmitigated, and you accept the residual risk. |
| **Waived** | Countermeasures | No | You have decided not to implement this control. |
| **Superseded** | Both (set automatically) | No | The finding was replaced by your own copy via Customize. |

**Affirmed** is the exception. Every other kind **mutes** the finding — it stops counting toward your live, residual risk. Affirming a finding keeps it **live** while still marking it as triaged: it's the difference between "this doesn't apply" (mute) and "yes, this is real, and I've confirmed it" (keep live, now clearly reviewed). See [Affirming a finding](#affirming-a-finding-confirmed-live-risk).

Dispositions carry no severity colour-coding — the kind and the reason carry the meaning, and a disposed row keeps the quiet outlined chip whatever kind it holds. The **Affirm** action button is info-blue for both finding types. What it *produces* is colour-coded, and deliberately not the same for both — see [Reading the lifecycle badges](#reading-the-lifecycle-badges).

## Disposing an exposure

Exposures live on the element they were detected on — a component, a security boundary, a data flow, or a data item.

1. Select the element and open its **settings panel**, then the **Exposures** tab. For a data item, open the **Data** dialog instead; it hosts the same panel.
2. On a system-generated exposure, click the **dispose** action (the shield icon) in the row.
3. Choose a kind, enter a reason explaining the decision, and **Save**.

The row now shows a disposition chip under the exposure name and sorts to the bottom of the list. To change the decision, open the dispose dialog again; to remove it, use **Remove disposition** in the dialog.

## Disposing a countermeasure

Countermeasures live on the **control** they were derived from.

1. Open the **Control** dialog and select the **Countermeasures** tab.
2. On a system-generated countermeasure, click the **dispose** action (the shield icon).
3. Choose a kind (**Not Applicable**, **False Positive**, or **Waived**), enter a reason, and **Save**.

The countermeasure shows a disposition chip under its name. The **Countermeasures** tab shows a count badge — `Countermeasures (N)` — when one or more of its countermeasures need review (see below).

## Affirming a finding (confirmed live risk)

Sometimes the right answer isn't to mute a finding — it's to confirm it. You've looked at the exposure, agree it's a real risk for this element, and want that decision on the record without making the finding disappear. **Affirm** is the one-click action for exactly that.

Affirm appears alongside the other finding actions (in the **Exposures** tab, the Data panel, and the **Control** dialog). Click it on a system-generated finding to record it as:

- **Confirmed live risk** — for an exposure you've reviewed and accept as a genuine, unmitigated risk, or
- **Confirmed in place** — for a countermeasure you've verified is actually implemented.

An affirmed finding **stays live**. Unlike the muting kinds, it still counts toward your residual risk — it's just now clearly triaged rather than unreviewed. You'll see a lifecycle cue on the row: a filled **Confirmed risk** badge on affirmed exposures, or a filled **In place** badge on affirmed countermeasures. They are toned differently on purpose — see [Reading the lifecycle badges](#reading-the-lifecycle-badges).

### Add a note or review an affirmation

To revisit an affirmation — to refine the reason you recorded, or simply re-read it — open its **Add note** / **Review** action. This opens the affirm-edit dialog, where **only the reason is editable**. Editing the note never converts the finding into a muting disposition; an affirmed finding stays affirmed and live until you explicitly choose a different kind through the dispose action.

> **Affirm is not "re-affirm."** *Affirm* is a decision kind that confirms a finding as a live risk. *Re-affirm* is a separate action that re-stamps an **existing** disposition of any kind to clear a stale flag. They are different — see [When a disposition goes stale](#when-a-disposition-goes-stale).

## The finding lifecycle

Every finding sits in one of three lifecycle states. You don't set this state directly — the platform derives it from the finding's disposition and who recorded it, so the same rules apply everywhere a finding is shown.

| State | What it means | How a finding gets here |
|-------|---------------|-------------------------|
| **Pending** | A system-generated finding awaiting your review. | A module derived it and no one has acted on it yet. |
| **Confirmed** | A reviewed, live finding. | You **affirmed** it, or you authored it yourself. |
| **Disposed** | A muted finding that no longer counts as live risk. | You gave it any muting kind (Not Applicable, False Positive, Compensating Control, Risk Accepted, Waived, or Superseded). |

Both **pending** and **confirmed** findings are live — they count toward your residual risk. The difference is review status: pending means "nobody has looked at this yet," confirmed means "someone reviewed it and stands behind it." Only **disposed** findings drop out of your live risk.

Each tab shows a **pending count** — for example `Countermeasures (N)` — so you can see at a glance how many findings still need a first look.

### Reading the lifecycle badges

The lifecycle state is shown on the row as a badge. There are three cases, and the middle one is deliberately *not* the same for the two finding types:

| State | Exposure | Countermeasure |
|---|---|---|
| **Pending** | No badge | No badge |
| **Confirmed** | Filled **Confirmed risk** badge, in the error/red tone | Filled **In place** badge, in the success/green tone |
| **Disposed** | Quiet outlined badge naming the kind | Quiet outlined badge naming the kind |

Three things are worth understanding here.

**Pending shows no badge on purpose.** A model that has just been analyzed is *all* pending. Badging every row would make an untouched model look alarming when nothing is wrong yet. The backlog is surfaced once, as the per-tab pending count, rather than on every row.

**Confirmed is green for countermeasures and red for exposures**, and this asymmetry is the point. Both mean "reviewed and confirmed", but they confirm opposite things: a countermeasure you've verified is in place is *good news*, and an exposure you've confirmed as a live risk is *bad news*. A single neutral colour would flatten that distinction — the one place green is right in this UI is a control you have confirmed exists.

**A confirmed exposure is red, not yellow.** Yellow is reserved for the [stale marker and the **Review** button](#when-a-disposition-goes-stale), so a confirmed risk never reads as "this needs your attention again."

Disposed rows keep the quiet outlined chip whatever kind they carry — that is where the "no severity colour-coding" rule holds. It applies to *dispositions*, not to the lifecycle badge.

> **Subtlety:** an affirmation only counts as **confirmed** when it carries an attributed author. An affirmation with no recorded author is treated as **pending**, not confirmed — a safeguard so that an unattributed affirmation is never mistaken for a reviewed decision.

## When a disposition goes stale

A disposition reflects the model as it was when you set it. If you later change an **instantiation attribute** of the element — the kind of change that drives what findings the module derives — the platform flags the affected dispositions as **stale**: the row gets a yellow marker and the dispose action becomes a **Review** button.

Stale means "the model changed underneath this decision — confirm it still holds." Click **Review** to:

- **Re-affirm** the disposition (the reason and decision still apply) — this clears the stale flag and re-stamps the *existing* decision, whatever kind it is. (This is **not** the same as [Affirm](#affirming-a-finding-confirmed-live-risk), which records a finding as a confirmed live risk; re-affirm only refreshes a disposition you already set.) Or
- **Change** the kind or reason, or
- **Remove** the disposition entirely.

Adding or removing a MITRE technique on a finding does *not* make its disposition stale — only instantiation-attribute changes do.

## Customizing a finding (editable copy)

When you want your own editable version of a system-generated finding — to adjust its content, references, or techniques — **Customize** it:

1. On any **live** system-generated finding, click the **Customize as an editable copy** action (the duplicate icon).
2. The platform creates a user-authored copy (named `… (custom)`) attached to the same element, and marks the original as **Superseded** with a reason that references your copy.
3. Edit the copy freely. The original stays visible, marked Superseded, as a record of where the copy came from.

**Live** means pending *or* affirmed. An affirmed finding carries a disposition and still offers Customize — confirming a finding as real is exactly the moment you may want your own version of it. Only **disposed** findings hide the action: a muted finding has already been ruled out, so there is nothing to supersede.

If creating the copy succeeds but marking the original as superseded fails, you'll see a notice with a **Retry** option — your copy is already saved; retry only re-attempts the disposition.

Deleting your customized copy later flags the superseded original as **stale**, prompting you to decide what to do with it now that the copy is gone.

## What you can't do

- You can't delete or edit a system-generated finding directly from the UI — dispose it, or Customize it and edit the copy.
- You can't dispose a user-authored finding — edit or delete it directly instead.

## See also

- [Security Analysis Workflow](SECURITY_ANALYSIS_WORKFLOW.md) — running analysis and interpreting findings.
- [Working with Security Controls](WORKING_WITH_SECURITY_CONTROLS.md) — creating controls and attaching MITRE techniques.
- [Issue Management Guide](ISSUE_MANAGEMENT_GUIDE.md) — turning findings into tracked work.
