## Enrichment Questions — the enrich skill's own

The question tables are in the Enrichment Questions; in the enrich skill each has its own question, asked as follows.

**Scope.** Show the worklist by name (crown jewels, the rest of the snapshot, flows, others; stale first) and the Gate 3 tier sizes:

{{#ask id=enrich-scope}}Enrich the whole worklist, only the priority set (what Gate 3 holds to its floors), or pick elements? (all / priority / pick){{/ask}}

On `pick`, show the full element list:

{{#ask id=enrich-pick text}}Which elements? Give their numbers or names.{{/ask}}

**Open fields**, each batch's:

{{#ask id=enrich-questions text}}Answer the rows you can, by row number; "not sure" leaves a row empty, never a guess.{{/ask}}

**Credentials**, after the data items:

{{#ask id=credential-flows text}}For each flow: which credential authenticates it, what else does that credential reach, and on an auth failure does it deny, fall back or fail open? Say "none" only for a flow that is unauthenticated, "not sure" otherwise. Other service accounts, keys or shared secrets (break-glass, CI deploy keys)?{{/ask}}

**Boundary enforcement**, after the credentials:

{{#ask id=boundary-enforcement}}Confirm this boundary enforcement, or modify rows? (confirm / modify){{/ask}}

**Inline enrichment.** The divergence table and the red flags, in full, then the proposed values and defaults as a confirm table — one line per element, every value with its row number and basis (`[cited]`, `[default]`, `[answer]`), the `path:line` behind `details`, in pages of at most 50 rows:

{{#ask id=enrich-attributes text}}Which of these values do you accept, reject or change? Give row numbers — "accept all" covers this page. An accepted default is written and counts in the type-default share; a row you reject or leave out is not written.{{/ask}}
