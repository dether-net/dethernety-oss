## Backward Transition Protocol

When a structural change (add/remove element) occurs at ENRICHING or REVIEWED state:

1. Call {{tool:model_state}} with `action: 'transition'`, `to: 'STRUCTURE_COMPLETE'`, and `add` = the ids of the new or changed elements that still exist. A removed element has no id left to track: the tool returns it under `rejected_ids`, which is expected.
2. The server applies the side effects: it deletes `.dethereal/quality.json` (forcing recomputation) and clears the sign-off and the review.
3. Warn the operator: "Adding or removing elements reverted state from [previous] to STRUCTURE_COMPLETE. Enrichment on existing elements is preserved. New or changed elements are tracked as stale and will be enriched next." Say that REVIEWED is cleared and that waivers lapse on the elements that changed, and show the result's `loop_back_note` when it carries one.
4. If a removed element was mapped to a crown jewel (`crown_jewel_elements` in `.dethereal/scope.json`), tell the operator the crown-jewel mapping must be confirmed again before the model can be reviewed.
5. An armed loop back (from {{tool:model_state}} `action: 'loop_back'`) survives this transition: a removed element counts as touched, every other element stays armed, and Gate 3 stays `NOT_COMPUTED` until each is touched, or dropped with the operator's words (When Gate 3 is not computed, at Step 9).

In the guided workflow context, re-position the step cursor to Step 4 (Boundary Refinement) and show the updated progress table with re-opened steps.

The stale list is consumed by the enrichment skill — stale elements are prioritized first during the next enrichment pass. After enrichment processes a stale element, remove its id with {{tool:model_state}} `action: 'stale'`, `remove`.
