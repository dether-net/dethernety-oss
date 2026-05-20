---
title: 'Managing Findings'
description: 'Record decisions on system-generated exposures and countermeasures — not applicable, false positive, waived, or superseded — instead of deleting them.'
category: 'analysis'
position: 7
navigation: true
tags: ['intermediate', 'guide', 'findings', 'exposures', 'countermeasures', 'disposition', 'workflow']
---

# Managing Findings

*Record decisions on system-generated findings instead of deleting them.*

## Overview

Modules generate findings for you automatically:

- **Exposures** — security weaknesses detected on a component or data flow.
- **Countermeasures** — defensive controls derived from a control's class.

These are *system-generated*: the platform re-derives them whenever the element's class or attributes change. Often you'll disagree with a specific finding for a specific situation — an exposure that doesn't apply to an internal-only tool, a control you've consciously decided not to implement, a finding the template raised by mistake. Deleting it doesn't help: the next time the model changes, the platform recreates it.

A **disposition** records your decision *on* the finding — a kind plus a written reason — so the finding stays visible but clearly marked, the decision survives re-derivation, and your reasoning is captured for the next reviewer.

### System-generated vs. your own findings

| | System-generated | Your own (user-authored) |
|---|---|---|
| Created by | A module, automatically | You |
| Edit / delete directly | No | Yes |
| Disposition | Yes — record a decision | No — just edit or delete it |
| Survives re-derivation | Yes | Yes |

To take over a system-generated finding and edit it freely, **Fork** it (see [Superseding a finding](#superseding-forking-a-finding)).

## Disposition kinds

Pick the kind that matches your reasoning. Every disposition requires a reason.

| Kind | Applies to | Meaning |
|------|------------|---------|
| **Not Applicable** | Exposures, Countermeasures | The finding cannot or does not apply to this instantiation. |
| **False Positive** | Exposures, Countermeasures | The template raised this finding incorrectly for this kind of element. |
| **Compensating Control** | Exposures | Another control — not formally linked — already mitigates this. |
| **Risk Accepted** | Exposures | The threat is real and unmitigated, and you accept the residual risk. |
| **Waived** | Countermeasures | You have decided not to implement this control. |
| **Superseded** | Both (set automatically) | The finding was replaced by your own copy via Fork. |

There is no severity colour-coding on dispositions — the kind and reason carry the meaning.

## Disposing an exposure

Exposures live on the component or data flow they were detected on.

1. Select the element and open its **settings panel**, then the **Exposures** tab.
2. On a system-generated exposure, click the **dispose** action (the shield icon) in the row.
3. Choose a kind, enter a reason explaining the decision, and **Save**.

The row now shows a disposition chip under the exposure name and sorts to the bottom of the list. To change the decision, open the dispose dialog again; to remove it, use **Remove disposition** in the dialog.

## Disposing a countermeasure

Countermeasures live on the **control** they were derived from.

1. Open the **Control** dialog and select the **Countermeasures** tab.
2. On a system-generated countermeasure, click the **dispose** action (the shield icon).
3. Choose a kind (**Not Applicable**, **False Positive**, or **Waived**), enter a reason, and **Save**.

The countermeasure shows a disposition chip under its name. The **Countermeasures** tab shows a count badge — `Countermeasures (N)` — when one or more of its countermeasures need review (see below).

## When a disposition goes stale

A disposition reflects the model as it was when you set it. If you later change an **instantiation attribute** of the element — the kind of change that drives what findings the module derives — the platform flags the affected dispositions as **stale**: the row gets a yellow marker and the dispose action becomes a **Review** button.

Stale means "the model changed underneath this decision — confirm it still holds." Click **Review** to:

- **Re-affirm** the disposition (the reason and decision still apply) — this clears the stale flag and re-stamps the decision, or
- **Change** the kind or reason, or
- **Remove** the disposition entirely.

Adding or removing a MITRE technique on a finding does *not* make its disposition stale — only instantiation-attribute changes do.

## Superseding (forking) a finding

When you want your own editable version of a system-generated finding — to adjust its content, references, or techniques — **Fork** it:

1. On a system-generated finding with no disposition, click the **Fork as editable copy** action (the duplicate icon).
2. The platform creates a user-authored copy (named `… (custom)`) attached to the same element, and marks the original as **Superseded** with a reason that references your copy.
3. Edit the copy freely. The original stays visible, marked Superseded, as a record of where the copy came from.

If creating the copy succeeds but marking the original as superseded fails, you'll see a notice with a **Retry** option — your copy is already saved; retry only re-attempts the disposition.

Deleting your forked copy later flags the superseded original as **stale**, prompting you to decide what to do with it now that the copy is gone.

## What you can't do

- You can't delete or edit a system-generated finding directly from the UI — dispose it, or Fork it and edit the copy.
- You can't dispose a user-authored finding — edit or delete it directly instead.

## See also

- [Security Analysis Workflow](SECURITY_ANALYSIS_WORKFLOW.md) — running analysis and interpreting findings.
- [Working with Security Controls](WORKING_WITH_SECURITY_CONTROLS.md) — creating controls and attaching MITRE techniques.
- [Issue Management Guide](ISSUE_MANAGEMENT_GUIDE.md) — turning findings into tracked work.
