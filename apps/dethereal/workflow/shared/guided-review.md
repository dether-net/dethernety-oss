# Guided workflow — review (Step 9)

{{include shared/model-file-reads.md}}

{{include shared/tool-loading.md}}

## Step 9: Validation

This file is the full model's; a quick model reads its own.

1. Delegate the review:

{{include shared/review-delegation.md}}

2. Call {{tool:validate_model_json}} with `action: 'validate'`, `include: ['gates']` (core rule 6) and show the verdicts once (Gate Verdicts below), the reviewer's Red Flags block right after them in the same message and before any question, then what the reviewer returned, by table kind (Relay):
   - the quality score and label in the verdict line; the factor table waits for `details quality`;
   - the red flags — the reviewer's Red Flags block verbatim, its heading with the count and every line: one flag per line with element, field and value, never re-worded, grouped into a sentence or folded. On every showing, all of them again, the new ones marked. With none, "No red flags" — never a heading or a list with nothing in it;
   - the top issues that a failing criterion does not already show — with none, say so in one line, never an empty bullet;
   - the zoning coherence findings — advisory, never blocking a push: each Warning kind on one line with its count and up to three names; the Info findings in one line, their names behind `details zoning`. Their "N unclassified" count is the one Step 4 forward-references. A structural container shows its roll-up: `— structural · spans <min>…<max>`, with `· contains crown jewels`, `· includes a vendor enclave` or `· N descendant segments still unclassified` from the payload's `summary`.
3. **Gate 3 passes** (the server's verdict): record the review as Gate 3 Decisions says (`review-record`); the server grants REVIEWED. Then enter `publish` in the same turn: its first call is your next action — the turn never ends on the record. On `not now`, the state stays ENRICHING and `publish` follows as after `skip to sync anyway`.
4. **Gate 3 fails:** the state stays ENRICHING; follow When Gate 3 fails. `loop back` enters `enrich` with the gates report's `gate3.loopback` as its worklist; `skip to sync anyway` enters `publish` in the same turn, saying the analysis may be incomplete.

Nothing here writes `.dethereal/quality.json` or the state directly: the server computes both.

{{include shared/gate-verdicts.md}}

{{include shared/gate-decisions.md}}

{{include shared/tiers.md}}
