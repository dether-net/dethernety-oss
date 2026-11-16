# Triage: the review, the apply gate, the summary

## The proposals table

Shown in full before the first review question; it takes the place of the analysts' own tables, which are not relayed. It numbers groups `1..N` only: a dispatch id is never shown where the operator decides by number. Sections, in order:

1. **High confidence** — `# | Exposure (group) | Elements | Verdict | Kind | Confidence | Reason (first line) | Evidence`; Evidence summarises the provenance tags. A supersede row also shows its technique change (`+T1078.001 −T1071.005`), the material fields, a note when the original has `unresolved_references` (the copy does not carry them), and — knowledge graph present — `[breaks KG linkage: <corpus ids>]`.
2. **Medium confidence** — the same columns.
3. **High-severity mutes** — marked **per-row only: `accept-all` skips these; name each one you accept**.
4. **Needs human** — each group with its one-sentence ambiguity; a compensating-control proposal with the analyst's reason and named control; a supersede or a kind the analyst may not propose, with the analyst's view; a cross-examiner objection with **both views**, attributed.
5. **Run notes** — platform-evidence-only members, custom-copy markers, downgrades, reconciliation and cross-examination notes, proposals the platform would refuse, the latch note, sources not read.

In the absent tier — no knowledge graph, a failed probe, a group read after the latch, or a class whose chain could not be read — each such row's Evidence cell carries the `marker` of the answer that put it there (the probe's answer, the failed probe's error data, the latched answer, or the `kg_chain_unread` error), exactly as returned. A source not read shows on its row as "`<file>`: secret file, not read" or "`<file>`: outside the project, not read". Compact mode as the run constants say.

## Open

{{tool:triage_review}} `open` with `directory_path`, `mode: 'review'` and the groups, each `{group, exposure_ids, proposal?, needs_human?, per_row_only?}`:

- an affirm → `proposal: {op: dispose, kind: AFFIRMED, reason}`; a dispose → its kind (`NOT_APPLICABLE` or `FALSE_POSITIVE`) and reason;
- a supersede → `{op: supersede, modifications, verified_technique_ids}`. `modifications` holds only the fields the analyst's `modifications` changes, out of `name`, `description`, `score` (a number, 0–10), `attackVector` and `category`, plus `techniques: {add, remove}` from its `techniqueDelta`: each add is the technique's `platformId`, the `id` its `lookup` returned; each remove is the exposure's own `exploited_by` (or `exploited_by_atlas`) `id`. `verified_technique_ids` lists the add ids. Nothing else is sent — no `materialFields`, no display ids;
- a needs-human group → `needs_human: true`, with a `proposal` only when the analyst's surviving one is a dispose of `AFFIRMED`, `NOT_APPLICABLE` or `FALSE_POSITIVE`. A supersede, a `COMPENSATING_CONTROL`, `RISK_ACCEPTED` or `SUPERSEDED` proposal is never passed — it is in the table only, and the operator decides with an edit naming a kind, or skips;
- a high-severity mute → `per_row_only: true`.

Open holds at most 200 exposures: a larger review runs **in parts** of at most 200, whole groups in group order — each part opened, reviewed, prepared and applied before the next is opened, each with its own table and apply question. `echo_too_large` or `review_too_long`: halve the part and open it again; a single group too large alone: show the refusal, and stop.

A group left with no exposures is dropped; when no group is left to open, say "Nothing left to review." and stop.

A refusal at open:

- `review_open`: an earlier review of this directory is still open. Call {{tool:triage_review}} `get` with its `review_id`; show its groups and decisions, saying they come from an earlier review and that `done` closes it, skipping every undecided group, with nothing written before its own apply question. Run the loop, prepare and apply on it, with the hint for its mode — a cancel there ends that review only. Then walk {{tool:query_exposures}} `list_model` view `groups` again (with `--stale`, view `rows`, `select: 'stale'`), with `element_id` with `--element`, drop from this run's groups every exposure not in it, show this run's table again, and open it.
- a refusal whose data lists `exposures`, each with its `group` and `code` (the platform would refuse those proposals): in a review, each group named there becomes needs-human without a proposal; in a stale sweep, it is left out; either way its code and why go in the run notes. Show the table again and open once more; that open refused again, other than in parts, show it, and stop.
- `not_in_model` or `target_changed`: the model changed since it was listed. Show it, say to run triage again, and stop.
- any other refusal: show it, and stop.

## The review loop

Before the first review question, show this hint:

```
Commands — one per reply:
  accept <n> [<n> …]                     skip <n> [<n> …]          show <n>
  edit <n> rationale: <text>
  edit <n> kind: <KIND> [rationale: <text>]
      KIND: AFFIRMED · NOT_APPLICABLE · FALSE_POSITIVE · COMPENSATING_CONTROL · RISK_ACCEPTED
  accept-all (closes the review)         done (closes the review)
```

- `accept` is not open to a needs-human group: decide it with `edit <n> kind: <KIND> rationale: <text>` — the operator's own rationale, in this edit or an earlier one; without it the reply is refused with `needs_operator_decision` — or leave it with `skip`. `COMPENSATING_CONTROL` and `RISK_ACCEPTED` need a rationale; for a compensating control, the rationale names the control.
- A supersede is accepted or skipped, never edited.
- `accept-all` accepts every pending group except the needs-human and per-row-only ones, and closes the review; `done` closes it, every undecided group skipped. Skip is the default: nothing is accepted silently.

Each reply goes to {{tool:triage_review}} `reply`, verbatim. Then show, in one short block, the command as parsed and each group whose decision changed; for `show`, the group as the tool returns it plus what this run holds on it — the dossier facts, evidence, citations and, knowledge graph present, the corpus citations.

**The question comes from the tool.** Every answer after which the operator is asked next carries `ask`: the question, its tag first, as registered. End your message with it exactly as returned — every character, nothing added, shortened or merged — as its own last paragraph, then end your turn. A refusal: its `error` as returned, then its `ask`; nothing changed. No `ask` in the answer: ask nothing, and go on as this file says. After a compaction during the review: `get`, then its `ask`. Except:

- `review_not_found`, `not_model_dir`, `record_unwritable` or `record_too_large`: show it, say nothing was written, and stop.
- `record_full`: the review has recorded as many replies as it can; only `done` — and in a review, `accept-all` — is still taken. Say so, then its `ask`.

## Prepare and apply

Before the first {{tool:manage_dispositions}} call, say once: each of its calls — prepare and commit — asks for approval; approve each on its own, never with an "always" choice, since one standing approval would let a write through without the apply question.

{{tool:manage_dispositions}} `prepare` with `directory_path` and the `review_id`; the operations come from the closed review — add, drop or reorder nothing. Show its result before anything else: the count of ready operations, every operation (the rejected ones apart, with their code; the lines give the why), and the `lines` unchanged, one per line, in one fenced block whose fence is longer than any run of backticks in them. How the lines read, to explain them when asked: every text is in double quotes, a `\"` inside it a quote of the text; each exposure is `"<name>" on "<element>" #<id>`, a long id shortened to its tail, `#…<tail>`; a supersede says `create "<copy>" on "<element>"`, the element the copy is created on, each changed description, score, attack vector or category as old → new, and a new name and the techniques added or removed as they are. No ready operation: say nothing will be written, and do not ask the apply question. A refusal from prepare: show it, and stop.

Then the apply question: its `ask`, as the review loop says. **Commit** with {{tool:manage_dispositions}} `commit`: the `plan_id` and `lines` from prepare, unchanged, and the reply as given — never reworded, never turned into another word.

- `cancelled`: "Cancelled. Nothing was written." — in a run in parts, "nothing more", the earlier parts standing. Stop — except at an earlier review's apply (see Open), after which this run's review follows.
- `reply_not_answer`, or `record_full` with an `ask` (yes and cancel are still taken): nothing was written; its `error` as returned, then its `ask`.
- `plan_stale` or `plan_expired`: nothing was written; show it. That plan id is never committed again: prepare once more from the same review, show the new result, then its `ask`.
- `plan_not_found`, `plan_used`, `busy`, `lines_differ`, `record_too_large`, or any other refusal: show it, and stop.

## Outcomes and summary

One line per operation, from the commit's `outcomes`:

- `applied`;
- `failed`, with the server's code and message (it never stops the rest). With a `clone_id`: "the copy '<clone_id>' was created but is incomplete; the original is untouched — delete the copy in the platform UI before triaging this finding again.";
- `partial` with `kind: SUPERSEDED`: the copy exists and the original is marked SUPERSEDED, but the copy lacks the source's content — show its error, which says what to add to the copy in the platform UI;
- `partial` without a `kind`, with the copy's `clone_id`: "the copy '<clone_id>' exists; the original may still be live — check it, and dispose it as SUPERSEDED in the platform UI if it is. Do not run triage on this finding until then: a new proposal would make a second copy.";
- a content warning on its row.

Then the summary: counts — affirmed, disposed by kind, superseded, skipped, needs-human left, rejected, failed; one fresh {{tool:query_exposures}} `list_model` partition for the new partition, shown as returned. When a write failed, add once: "'failed' means not confirmed applied — a lost response may have applied server-side; re-running triage is safe (only still-pending findings re-enter)."
