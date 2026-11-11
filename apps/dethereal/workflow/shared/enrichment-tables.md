**Open fields** — `| Q# | element | field | question | allowed values |`, the field by its exact template key: pre-filled proposals shown, the field's description behind `details Q#` (template and floor fields, monitoring, `asset_criticality`, compliance).

**Credentials** — `| F# | flow | credential | also reaches | on failure |`: a row for every cross-boundary flow, every flow recorded as a privilege transition, and every flow whose `dataItemIds` hold a credential item (`is_credential: true`, or a credential-like class) — a sibling flow to the same target is checked, never inferred from the others. Pre-filled cells are marked `(src)`, their source behind `details F#`, and a cell the agent wrote shows its `(R#)`; `on failure` is deny, fallback, fail_open or not sure. Flows with nothing known fold into one line that keeps their ids and names (Relay). At most 15 flows per showing: crown-jewel flows, flows Gate 3's C9 lists and fail-open pre-fills first.

**Credential mapping** — `| S# | credential | type | flows | stores that yield it | shared |`, a confirm table pivoted by credential, the stores taking `credential_scope` with `stores_credentials: true` — and every `credential_name` it writes: say which flows take the id itself as their label, and list the others.

**Boundary enforcement** — `| boundary | implicit_deny_enabled | allow_any_inbound | egress_filtering | basis |`: the enforcement table for the boundaries that lack it; boundaries with no evidence for any of the three fold into one line, `no evidence: <names>`, and stay empty unless the operator gives values.

A pre-fill the operator confirms is an answer, written with the rest; a cell left empty stays empty.
