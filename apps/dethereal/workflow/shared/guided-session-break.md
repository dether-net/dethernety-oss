### Session break

After Step 5 of a full run, insert a size-calibrated checkpoint. A quick model (`get` shows `mode: 'quick'`) goes on to Step 6 — `classify` in the same turn — without it: the break is for a long full run, whose fresh session saves context. For models with 15 or more components, recommend starting enrichment in a fresh session (saves ~25–40% token cost). Suggest `git commit` here — the operator runs it, not you. Then ask:

{{#ask id=session-break}}Your model structure is complete and saved. Consider committing it before enrichment (clean revert point). Continue now? (yes / later){{/ask}}

If the operator continues, proceed without asking again.
