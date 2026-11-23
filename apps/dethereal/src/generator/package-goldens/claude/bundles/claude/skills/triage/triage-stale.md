# Triage: the stale sweep (`--stale`)

The sweep replaces the proposals and the review of a default run; the apply gate and the summary are the review file's. It dispatches no analyst, writes no scratch, and has no task list.

1. **The sweep set**: `mcp__plugin_dethereal_dethereal__query_exposures` `list_model` view `rows`, `select: 'stale'`, with `element_id` with `--element`, every page in turn: follow `next_offset`, passing `listing` back, until `truncated` is false; `listing_changed`: start again from offset 0, once; a second one: show it, and stop. Every stale disposition, any lifecycle. **Each exposure is its own group** — its disposition's kind, reason and author are its own — numbered `1..N` in the order the rows come; at most 999 rows a sweep, the rest waiting for the next one; past 999, the summary says "<N> stale; the first 999 reviewed", N being the rows view's `total`.
2. **Two sections**, each `# | Exposure | Element | Kind | Reason (first line) | By | At` (the disposition's kind, reason, author and date):
   - **Stale dispositions** — every row whose kind is not `SUPERSEDED`.
   - **SUPERSEDED-stale** — its own section, never mixed in. Open it with: the copy that replaced these originals was deleted, and the platform marked each original stale. These rows take only `clear` or `skip` — re-affirming a superseded original makes no sense — and every row carries, verbatim: *clearing un-mutes the original that your deleted copy replaced*.
3. Say once that no analyst runs in the sweep: each row is for human review against the current evidence; there is no bulk re-affirmation.
4. **Open** with `mcp__plugin_dethereal_dethereal__triage_review` `open`, `mode: 'stale'`, each group with its `group`, its `exposure_ids` and `proposal: {op: reaffirm}` — a SUPERSEDED-stale row `proposal: {op: clear}` — and nothing more: the server reads which rows were superseded from the model, and keeps each disposition's kind. The reaffirm's reason is composed by the server at prepare. Parts, refusals and the Triage workspace at open as the review file says.
5. Show this hint, then the question — the `ask` each answer returns, as the review file says:

   ```
   Commands — one per reply:
     reaffirm <n> [<n> …]    clear <n> [<n> …]    skip <n> [<n> …]    show <n>    done (closes the review)
   ```

   `[prompt: triage-stale-review]` Your command? One command per reply: reaffirm, clear, skip, show or done, as the hint above shows. — the tag first, then a plain message; end your turn.

   Each reply goes to `mcp__plugin_dethereal_dethereal__triage_review` `reply`, verbatim; the result and any refusal as the review file says. `clear` on an ordinary row returns the finding to pending; on a SUPERSEDED-stale row it un-mutes the original. `show <n>`: the group as the tool returns it, plus — when attribute files exist — the element's current attribute values, as evidence of now only (no earlier values are stored, so no difference is claimed).
6. **Apply and summary** as the review file says. The counts are reaffirmed, cleared and skipped.
