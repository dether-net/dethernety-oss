# Hidden Edges — Query Contract

The `hiddenEdgeCandidates` field returns a JSON-encoded answer: the hidden-edge candidates for one model, or a refusal. This document is the field-by-field reference for that answer, the options a caller passes, the counts, the refusals and errors, and the checks a client must apply before it acts on a candidate. It is the contract a client codes against. For how the candidates are produced, see [architecture.md](./architecture.md).

**What this document covers:** the field and its arguments; the options; the answer envelope and its `contract` version; each candidate field by field; the counts; refusals and GraphQL errors; contract 2's additions (each candidate's explanation and remedies, the envelope's rationale and limits) and its recheck mode; the validation a client must apply; and `table_hash`.

The module answers in two contracts. **Contract 1** is the answer a caller gets when it asks for none: the shape the module has answered in since 0.1.2. **Contract 2**, from module 0.2.0, is asked for with `"contract": 2` in the options: it adds an explanation to each candidate, or, with `recheck`, judges edges already decided instead of proposing candidates.

---

## The field

```graphql
extend type Query {
  hiddenEdgeCandidates(modelId: ID!, options: String): String
}
```

| Argument | Meaning |
|---|---|
| `modelId` | The id of an existing model. A value that is not a string of 1 to 128 characters, or names no model, is refused as `model_not_found`. |
| `options` | A JSON string, or absent or `null` for the defaults. See [The options](#the-options). |

The return is a `String`: `JSON.stringify` of the answer below. A client requests the field as a scalar and parses it. The call is read-only, authenticated by the platform as any query is, and adds no authorization of its own: any verified user can query any model id the platform's own queries would let them read.

---

## The options

`options` is a JSON object with **exact keys**: a key the contract does not read refuses the call, so a newer client's option is never silently dropped.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `excluded` | `string[]`, at most 2,000 | none | Candidate ids the caller has already decided on (accepted or rejected). A pair with one of these ids is skipped and counted in `excluded_by_decision`. Each entry must be a candidate id (`he:` and 16 lowercase hex characters). Ids are directional: excluding A → B does not hide B → A. |
| `include_pending` | `boolean` | `true` | Whether pending (unconfirmed) exposures feed candidates. A candidate that rests only on pending exposures is never above medium. |
| `contract` | `1` \| `2` | `1` | The contract the answer is in. See [`contract`](#contract). |
| `recheck` | `object[]`, 1 to 200 | none | Contract 2 only: the edges to judge again, instead of proposing candidates. Not allowed beside `excluded` or `include_pending`. See [The recheck](#the-recheck-contract-2). |

The whole string may be at most 128 KiB; the size is checked first. A refusal names the offending key, never its value: its `detail` is `options` (not a string, too large, not JSON, or not an object), `options has an unknown key`, `excluded`, `include_pending`, `contract` (a value other than `1` or `2`) or `recheck` (malformed, asked without `"contract": 2`, or beside `excluded` or `include_pending`).

```json
{ "excluded": ["he:3f0a9c2e71b4d580"], "include_pending": false, "contract": 2 }
```

**An older module refuses `contract`.** A module before 0.2.0 reads only `excluded` and `include_pending`, so it answers `options_invalid` (`options has an unknown key`) to a call that names `contract`. A client that wants contract 2 where it can get it asks once with `"contract": 2` and, on `options_invalid`, once more without it. `options_invalid` is always answered in contract 1, since the module cannot know the contract asked before the options parse.

---

## The answer

Every answer, a refusal too, carries `contract`, which a client checks **before it reads anything else**.

### A successful answer

| Field | Type | Meaning |
|---|---|---|
| `contract` | `1` | The answer contract version: `1` here; see [A contract-2 answer](#a-contract-2-answer) for `2`. |
| `module` | `"dethernety-hidden-edges"` | The module that answered. |
| `version` | `string` | The module's version (for example `"0.2.0"`). |
| `table_hash` | `string` | 64 lowercase hex characters: SHA-256 of the edge-kind table as compiled into the module. See [`table_hash`](#table_hash). |
| `regime` | `{ "kg": "kg_present" }` or `{ "kg": "kg_absent", "reason": … }` | Whether the knowledge graph was applied; `reason` is one of `no_data`, `not_entitled`, `no_session`, `unavailable`, `failed`. See [the knowledge-graph regime](./architecture.md#11-the-knowledge-graph-regime). |
| `candidates` | `Candidate[]`, at most 200 | The candidates, ordered by tier (high first), then whether the target is a crown jewel, then id. |
| `counts` | `object` | What each exclusion, cap and fold step left out, and the model's size. See [The counts](#the-counts). |

### A contract-2 answer

A contract-2 answer to a call without `recheck` has contract 1's keys and three more, in this order: `contract` (`2`), `module`, `version`, `table_hash`, `regime`, `mode`, `candidates`, `counts`, `rationale`, `limits`.

| Field | Type | Meaning |
|---|---|---|
| `mode` | `"candidates"` | The answer proposes candidates. A recheck answers `"recheck"` (see [The recheck](#the-recheck-contract-2)). |
| `candidates` | `Candidate[]`, at most 200 | The same candidates, in the same order, as contract 1 gives for the same call, each with one more key, `explain` (see [`explain`](#explain-contract-2)). |
| `rationale` | `{ [row id]: string }` | Why each rule the listed candidates use exists: the row's `provenance` from the edge-kind table, 1 to 500 printable ASCII characters, naming the ATT&CK technique and the mitigations it rests on. Only the rows the listed candidates name. |
| `limits` | `object` | Where the module's caps left the answer short (below). |

`limits`:

| Key | Meaning |
|---|---|
| `per_kind_budget` | The candidates kept per kind: 50 |
| `max_peers` | The pairs kept per (exposure, row): 20 |
| `by_kind` | Per kind: `listed` (in this answer), `not_listed` (matched, but past the kind's budget), `pairs_capped` (pairs past the peer cap) and `anchors_over_budget` (selections that stopped at their pair budget). A client that sees `not_listed` above 0 knows the list is incomplete for that kind; one that sees the other two above 0 knows the walk stopped early, so removing the paths it listed may leave others. |
| `explain_trimmed` | Candidates whose explanation was cut to its primary part, or left out, for size |
| `remedies_skipped` | Candidates shown with an explanation but no remedies (`remedies: null`), for time |

**Size.** A contract-2 answer is held under 900 KiB, counted in UTF-16 units, the unit clients read in. Over it, each candidate keeps only its primary part; still over, explanations are replaced by `{ "omitted": "size" }` from the last candidate up. The answer is never refused for its size, and contract 1 is never trimmed.

### A refusal

```json
{ "contract": 1, "module": "dethernety-hidden-edges", "version": "0.2.0",
  "refusal": { "code": "model_too_large", "detail": "exposures" } }
```

A refusal carries the contract the caller asked for once the options parse, and contract 1 before: `options_invalid` is always contract 1.

| `refusal.code` | When | `detail` |
|---|---|---|
| `model_not_found` | `modelId` is not a string of 1 to 128 characters, or no model has that id | none |
| `options_invalid` | `options` fails its checks | The offending key, as above |
| `busy` | The same caller already has a call in flight on this process (keyed on the verified user's subject; one shared key when authentication is off) | none |
| `model_too_large` | A read returned more rows than its cap, the attribute data passed 32 MiB, or the matching passed 200,000 judged pairs | The read's name, `attributeBytes`, or `matching` |
| `deadline` | The module's 25 s deadline passed | none |

A refusal is answered in-band, as the JSON string, because the platform replaces every error a module resolver throws with one generic code in production. A refused call produces no candidates; the module never answers in part.

---

## Candidate

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | `he:` and the first 16 hex characters of SHA-256 over the kind, source id and target id joined by NUL (U+0000), UTF-8. The same pair always has the same id; a client recomputes it. |
| `kind` | `string` | One of `remote-service`, `credential-reuse`, `credential-capture`, `host-escape`. |
| `class` | `{ id, name }` | The class an accepted edge of this kind is written with: the kind's data flow class as the module's class file `data/dethernety-hidden-edges/dataFlow/<kind>/class.json` holds it. The module reads the four files once when it loads; the class ids live only there. |
| `source` | `string` | The foothold: a component id of the model. |
| `target` | `string` | The reached end: a component id of the model, never the source, and never an external entity when the source is one. |
| `technique_ids` | `string[]`, sorted | The **path techniques**: what an accepted flow carries in its `technique_ids`, one exposure each. |
| `cited_techniques` | `string[]`, sorted, at most 50 | The cited exposures' techniques that selected the rows. |
| `exposure_ids` | `string[]`, sorted, at most 50 | The exposures the candidate rests on: the anchoring exposures and, for a zone anchor, the reached component's own confirmed exposure of the same technique family whenever there is one. It lifts the zone anchor's cap from medium; the part may still end low or medium. |
| `rows` | `string[]`, sorted | The edge-kind table rows that produced it (`<kind>/<name>`). |
| `tier` | `"high"` \| `"medium"` \| `"low"` | How firmly the model's facts support the path. Confidence, not impact. |
| `defaults` | `object` | The base-field defaults from the table row, never from an element's attribute value: `required_capability` (`opportunistic` \| `targeted` \| `advanced`), `required_privilege` and `granted_privilege` (`none` \| `user` \| `admin` \| `system`). |
| `fields` | `object` | Kind-specific fields the module set from stated facts (below). Never a base field or a field a client writes. Empty for `remote-service`. |
| `facts` | `string[]`, sorted, at most 50 | Locators of the facts behind the tier (below). |
| `totals` | `{ exposure_ids, facts, cited_techniques }` | The full lengths of those three lists before they were capped. |
| `kg` | `"lowered"`, optional | Present when the knowledge graph lowered the tier by one step. Absent otherwise. |

All parts of a candidate come from the parts of its matching that gave it its tier; a lower-tier part's techniques, exposures and defaults never appear (see [the merge](./architecture.md#9-the-merge)).

### `fields`

| Kind | Field | Values | Set from |
|---|---|---|---|
| `credential-reuse` | `credential_basis` | `shared_item`, `default_account`, `instance_role`, `kerberos_realm` | The relation that found the pair: a credential item two components share, a default account in a segment, an instance role on a host, a Kerberos realm |
| `credential-capture` | `transport_state` | `cleartext`, `tls_unverified`, `unstated` | The captured flow's transport attributes: one explicitly `false` gives `cleartext`; one `true` with `server_certificate_validated` explicitly `false` gives `tls_unverified` |
| `credential-capture` | `capture_side` | `initiator_segment`, `responder_segment`, `both` | Which ends of the flow share the foothold's segment |
| `host-escape` | `escape_vector` | `configuration`, `kernel_or_runtime`, `unstated` | The container's configuration attributes, then its kernel and runtime attributes, any explicitly `false` |

### `facts`

| Locator | Meaning |
|---|---|
| `attributes:<element id>#<attribute>` | An attribute a breaker read on that element |
| `control:<control id>` | A control a breaker counted |
| `exposure:<exposure id>` | For a zone anchor, the reached component's own confirmed exposure of the same technique family, cited whenever there is one. It lifts the zone anchor's cap from medium; the part may still end low or medium |
| `kg:<rule id>` | A knowledge-graph rule whose check failed (with `kg: "lowered"`) |
| `kg-class:<class id>` | A reached class the knowledge graph covers with no threat of the kind (with `kg: "lowered"`) |

### Example

```json
{
  "id": "he:9c41e07a2b6d3f18",
  "kind": "remote-service",
  "class": { "id": "<id from dataFlow/remote-service/class.json>", "name": "Hidden Edge: Remote Service" },
  "source": "c-workstation",
  "target": "c-file-server",
  "technique_ids": ["T1210"],
  "cited_techniques": ["T1210"],
  "exposure_ids": ["x-file-server-smb"],
  "rows": ["remote-service/rs-3"],
  "tier": "high",
  "defaults": { "required_capability": "targeted", "required_privilege": "user", "granted_privilege": "user" },
  "fields": {},
  "facts": ["attributes:b-app-segment#east_west_within_segment_restricted"],
  "totals": { "exposure_ids": 1, "facts": 1, "cited_techniques": 1 }
}
```

---

## `explain` (contract 2)

In a contract-2 answer each candidate carries `explain`: the **parts** that give it its tier, each a way into the edge (one exposure through one row), with the facts the module weighed and the reasons beside its tier; and the **remedies**, what change in the model would remove or lower the edge. The explanation is worked out after the matching, for the listed candidates only, so asking for contract 1 costs what it always did.

```json
{ "parts": [ … ], "parts_total": 4, "crown_jewel": { "source": false, "target": true },
  "remedies": [ … ], "remedies_total": 2 }
```

| Field | Meaning |
|---|---|
| `parts` | At most 3 parts, from the parts at the candidate's tier (before the knowledge graph), confirmed findings first, then by exposure id, row id and credential item. The first is the **primary part**. |
| `parts_total` | How many parts give the candidate its tier |
| `crown_jewel` | Whether the source and the target are marked crown jewels |
| `remedies` | At most 5 [remedies](#remedies), the strongest first; `null` when the remedies' budget ran out before this candidate |
| `remedies_total` | How many remedies were found |

`explain` is `{ "omitted": "size" }` instead when the answer's size trim left it out (see [A contract-2 answer](#a-contract-2-answer)).

### A part

| Field | Meaning |
|---|---|
| `row` | The edge-kind table row (`<kind>/<name>`); one of the candidate's `rows` |
| `role`, `relation` | The row's role (`target`, `source`, `capture`, `credential`) and peer relation (see [Roles and peer relations](./architecture.md#roles-and-peer-relations)) |
| `exposure`, `anchor` | The anchoring exposure and the element it sits on |
| `matched` | The cited techniques that selected the row |
| `path` | The path technique this part gives; one of the candidate's `technique_ids` |
| `foothold`, `reached` | The candidate's `source` and `target` |
| `anchored_end` | For a flow anchor: the flow's end the row anchors on; otherwise `null` |
| `shared` | The boundary the relation was computed under (a segment, a zone, a host), or `null` |
| `flow` | The captured flow, the anchoring flow, or a flow carrying the credential item to the reached end; or `null` |
| `item` | The credential item of a credential or capture part, or `null` |
| `low` | Why the relation alone holds the part at low: `perimeter_only`, `managed_runtime` or `generic_item`; or `null` |
| `tier` | The part's tier. It is the candidate's tier, or one step above when the knowledge graph lowered the candidate |
| `basis` | The reasons beside the tier (below) |
| `facts` | At most 12 [facts](#a-fact) the module weighed for this part |
| `facts_total` | How many facts there were |

Every id in a part names an element of the model the module read.

**`basis`** says why the part has its tier:

| Key | Meaning |
|---|---|
| `confirmed` | Whether the anchoring exposure is confirmed (otherwise pending) |
| `gates`, `gates_stated` | How many breakers gate the high tier for this part, and how many of them the model states false (all of them are needed for high) |
| `raises`, `lowers` | How many facts raised the tier one step, and how many lowered it |
| `high_reachable` | `false` when no statement in the model could make this part high: the row's or the technique's cap, a weak relation, or no gating breaker |
| `caps` | What holds the part below high: `pending`, `row_cap`, `technique_cap`, `low_relation`, `zone_without_own_finding`, `no_gate` |

### A fact

`{ "at": [<locator>, …], "value": …, "effect": …, "gate"?: <n> }`. `at` holds one or more locators of [the `facts` grammar](#facts). `value` is the stated attribute value for a single attribute (a boolean, a finite number, or a string of at most 64 characters with unshowable characters replaced), else `null`. `gate` is the index of the gating breaker the fact belongs to.

| `effect` | Meaning |
|---|---|
| `meets_gate` | Stated false: meets one of the conditions high needs |
| `gate_unanswered` | Not stated: high needs it (or, for a group, one of them) stated false |
| `context` | Stated in a group whose condition another member decides |
| `misses_gate` | Stated true: contradicts a condition, which keeps the part below high |
| `lowers`, `raises` | An attribute group or a control that moved the tier one step |
| `own_target_finding` | The reached component's own confirmed finding, which lifts a zone anchor's cap (`exposure:<id>`) |
| `kg_lowered` | The knowledge graph's evidence for the step it took, on the primary part only, at most 2 (`kg:` and `kg-class:` locators) |

### Remedies

A remedy is one change to the model, judged again over **every** part of the edge, those the peer cap set aside included, on a model that states that one thing more. A breaker on one part says nothing about the edge, so a remedy is reported only for what it does to the whole edge:

| `outcome` | Meaning |
|---|---|
| `removes` | Every way into the edge goes |
| `lowers_to:low`, `lowers_to:medium` | The edge stays, at a lower tier |
| `this_path_only` | Some ways in close, but the tier stays |

The outcome compares against the candidate's tier as its parts give it, before the knowledge graph. A change on the one flow a part names closes only that way in when another credential-bearing flow carries the same credential to the reached end.

A remedy has one of two shapes:

```json
{ "set": [{ "at": "attributes:b-app-segment#east_west_within_segment_restricted" }], "outcome": "removes",
  "clears_finding": "x-segment-flat" }
{ "control_classes": ["Multi-Factor Authentication"], "attributes_true": ["mfa_enforced_for_admin"], "item_classes": ["User Credentials"],
  "on": "c-file-server", "outcome": "lowers_to:low" }
```

- **`set`**: state these attributes `true` on one element (every locator names the same element). `clears_finding`, when present, is a finding on that element that fires only on these attributes being absent or false, so it clears too (the table row's breaker lists it under `clears`).
- **A control**: a control of one of `control_classes` supporting the element `on`, with one of `attributes_true` true when it names any, protecting one of `item_classes` when it names any.

Remedies are ordered `removes`, `lowers_to:low`, `lowers_to:medium`, `this_path_only`. They have their own budget beside the call's deadline: at most 100,000 pairs judged again per call, and none once less than 5 seconds of the deadline is left (reading the ways in for their changes included). Past either, the candidates left get `remedies: null`, counted in `limits.remedies_skipped`, and the answer still arrives.

---

## The counts

`counts` is one flat object. Every entry is a non-negative integer except `boundaryDepthCut`, which is a boolean.

| Group | Key | Meaning |
|---|---|---|
| Model size (after the fold) | `boundaries`, `components`, `flows`, `dataItems`, `exposures`, `controls` | What the matching worked on |
| Fold | `elementsWithoutClass`, `elementsWithSeveralClasses` | Elements left out for having no class or several (a boundary stays in the forest unclassified) |
| | `boundariesWithSeveralParents` | Boundaries with more than one parent |
| | `boundaryDepthCut` | `true` when the boundary walk stopped at 50 levels with boundaries left |
| | `flowsWithSeveralEnds`, `exposuresOnSeveralElements` | Malformed flows and exposures left out |
| | `danglingReferences` | References the fold could not resolve, left out |
| | `attributeKeysDropped` | Attribute keys that could not be rebuilt from the platform's flat keys |
| Matching | `exposures_read` | Exposures folded |
| | `exposures_feeding` | Exposures that produced at least one kept pair |
| | `exposures_without_row` | Feeding-eligible exposures whose techniques select no table row |
| | `hidden_edge_anchors_skipped` | Exposures on hidden-edge flows, which never anchor |
| | `anchors_without_segment`, `anchors_without_host`, `containers_without_host`, `landings_without_segment` | Anchors whose relation found no segment or host |
| | `flows_not_credential_bearing`, `items_not_credential` | Flows and data items a credential or capture row could not use |
| | `pairs_over_anchor_budget` | (Exposure, row) selections that stopped at 1,000 considered pairs, or at 10,000 distinct pairs drawn |
| | `excluded_foothold_type` | Pairs skipped because their foothold is of a component type the row cannot act from (see [Footholds](./architecture.md#footholds-the-types-a-row-acts-from-and-managed-footholds)); they spend no pair budget. A pair whose foothold is not a component of the model is dropped without a count |
| | `excluded_external_pair`, `excluded_reached_type`, `excluded_declared_flow`, `excluded_by_breaker`, `excluded_by_decision` | Pairs each exclusion dropped, in that order |
| | `peers_capped` | Pairs past the 20 kept per (exposure, row) |
| | `kind_budget_dropped` | Candidates past the per-kind budgets |
| Knowledge graph | `kg_classes_capped` | Classes of the model's inventory past the 250 sent |

A client should show what it uses of these and keep the rest; nothing in the contract requires a client to read a count. New counts are added under the same pattern (lower-case letters and `_`, an integer value), so a client that keeps only such entries keeps them too.

---

## The recheck (contract 2)

A **recheck** asks whether edges already decided still hold: an edge a person accepted, rejected, or accepted and took back. A missing candidate cannot answer that, since a budget, a cap or an exclusion may each leave an edge out of a candidates answer. So the recheck walks the rechecked kinds' rows again over every exposure that is not disposed (pending ones included), with no peer cap, no kind budget, no exclusions and no knowledge graph, and keeps only the pairs of the edges it was asked about.

```json
{ "contract": 2, "recheck": [
  { "kind": "remote-service", "source": "c-workstation", "target": "c-file-server", "exposure_ids": ["x-file-server-smb"] } ] }
```

Each entry has exactly the keys `kind` (one of the four kinds), `source` and `target` (ids of 1 to 128 letters, digits, `_` or `-`) and `exposure_ids` (at most 50 such ids: the findings the edge was shown resting on, possibly none). At most 200 entries per call; a client batches past that. An edge asked twice is judged once, on every finding given for it.

The answer has no `regime` and no `counts`:

```json
{ "contract": 2, "module": "dethernety-hidden-edges", "version": "0.2.0", "table_hash": "…",
  "mode": "recheck", "candidates": [],
  "recheck": [ { "id": "he:9c41e07a2b6d3f18", "verdict": "holds", "tier": "high", "pending_only": false,
                 "in_given": true, "parts": [ { "row": "remote-service/rs-3", "exposure": "x-file-server-smb", "reason": "kept" } ] } ] }
```

One result per edge, in the order first asked:

| Field | Meaning |
|---|---|
| `id` | The candidate id of the edge's kind and ends |
| `verdict` | The first that matches, in the order of the table below |
| `tier` | With `holds`: the highest tier of a kept way in, from the model's facts only |
| `pending_only` | With `holds`: whether only pending findings carry the kept ways in |
| `in_given` | With `holds`, when `exposure_ids` was not empty: whether a kept way in rests on one of them |
| `parts` | At most 10 ways in, each `{ row, exposure, reason }` with `reason` one of `kept`, `removed`, `end_type`, `declared_flow`: kept ones first, then taken in turn from each reason, so a cut list still shows every reason behind the verdict |
| `facts` | With `removed`: at most 12 locators of the facts that removed it |

| `verdict` | When |
|---|---|
| `end_gone` | An end is no longer a component of the model |
| `declared_flow` | A declared flow now runs from the source to the target (a hidden-edge flow is not a declared flow) |
| `holds` | Some way in is kept |
| `removed` | Every way in found was removed by a breaker or a control |
| `end_type` | Every way in found failed a type check: the reached end's, the foothold's, or a target row's anchor's |
| `mixed` | Ways in were found and none kept, for different reasons (the `parts` say which) |
| `grounds_disposed` | No way in; a finding the edge was shown with is still in the model and disposed, and every other given finding is disposed or gone |
| `not_derived` | No way in at all, and none of the above: among others, every finding it was shown with is gone (it stopped firing) |

A recheck draws its pairs against the call's pair budget (200,000; over it, `model_too_large` with `matching`) and the module's deadline, as a candidates call does.

---

## Errors outside the answer

| What the client sees | Meaning |
|---|---|
| A GraphQL validation error naming the field | The platform has no hidden-edges module loaded |
| `UNAUTHENTICATED` | The caller's session was refused |
| `MODULE_RESOLVER_TIMEOUT` | The platform's 30 s resolver timeout passed (the module's own 25 s deadline normally answers `deadline` first) |
| `MODULE_RESOLVER_ERROR` | A fault in the module; the module logs it without the query, its parameters or its message |

A client should allow somewhat more than 30 seconds before it gives up on a call.

---

## The validation a client must apply

The answer is **untrusted input**. A client that acts on a candidate (shows it for review, or records it in a model) checks the answer first. The checks below are the contract's; a client may add its own.

**The envelope, or the whole answer is refused:**

1. It parses as a JSON object.
2. `contract` is a version the client knows. Check this before anything else, a refusal included.
3. A `refusal` is handled as such: its `code` is one of the five codes, and no candidate is read.
4. Otherwise the keys are exactly `contract`, `module`, `version`, `table_hash`, `regime`, `candidates` and `counts`, each an own key (an inherited or `__proto__` key refuses the answer); `version` and `table_hash` match their patterns; `regime` has exactly the keys and values above; `candidates` is an array of at most 200; every candidate's `id` is a string; no two kinds name the same class, and no kind names two classes.

**Each candidate, or that candidate is dropped (and counted by the client):**

1. Exactly the keys above, `kg` optional and only `"lowered"`.
2. `id` matches `^he:[0-9a-f]{16}$` and equals the id the client recomputes from `kind`, `source` and `target`.
3. `kind` is one of the four kinds, and `class` has exactly the keys `id` and `name`, naming one of the hidden-edges module's data flow classes in category `Hidden Edge` as the platform holds them. A client writes an accepted edge with that class, not one it holds itself.
4. `source` and `target` are distinct components of the model the client holds, not both external entities. A client working on a local copy checks that both ends exist there too, and that its copy matches the platform state the module read.
5. `technique_ids` is non-empty and every entry, like every `cited_techniques` entry, is a well-formed ATT&CK id (`^T\d{4}(\.\d{3})?$`). The hidden-edge classes keep at most ten path techniques.
6. Every `exposure_ids` entry is an exposure the client has read, not disposed (a risk-accepted or compensating-control disposition is not disposed here), and not on a hidden-edge flow.
7. `tier` is one of the three tiers; `defaults` has exactly the three base fields with their allowed values; `totals` holds three non-negative integers.
8. `fields` names kind-specific fields only, with enumerated values; a base field or a field the client writes refuses the candidate.
9. Every `facts` entry matches one of the locator patterns, and an `exposure:` fact names an exposure the client has read.

**Contract 2's additions.** In a candidates answer the envelope also has `mode` (`"candidates"`), `rationale` and `limits`, with exactly the keys above, and every candidate has `explain`; a malformed `mode` or `limits` refuses the answer. A `rationale` entry is a row id and 1 to 500 printable ASCII characters; one that is not is dropped, and the answer stands. A candidate whose `explain` fails any of these checks is dropped:

1. It is `{ "omitted": "size" }`, or has exactly `parts` (1 to 3), `parts_total`, `crown_jewel`, `remedies` (`null` or at most 5) and `remedies_total`.
2. Each part has exactly the keys above; its `row` is one of the candidate's `rows`, its `path` one of its `technique_ids`, its `foothold` and `reached` its `source` and `target`; its `exposure` is one the client read, not disposed and not on a hidden-edge flow, and one of the candidate's `exposure_ids` when that list was not cut; its `anchor` is that exposure's element, and its `matched` techniques that exposure's own.
3. A part's `tier` is the candidate's, or one step above when the candidate is `kg: "lowered"`; its `basis` agrees with the exposure the client read (`confirmed`, the `pending` cap) and with the part (`low_relation` exactly when `low` is set, `no_gate` exactly when `gates` is 0); a pending part is never high, and one with a `low` reason is low.
4. Every id in a part, a fact or a remedy names an element the client read; every vocabulary (roles, relations, effects, caps, low reasons, outcomes) is closed; a `kg_lowered` fact appears only on a lowered candidate's primary part; an `own_target_finding` names a confirmed exposure on the target; a remedy's `lowers_to:` tier is below the parts' tier, and its `clears_finding` sits on the element its `set` names.
5. Every string the module passes on (a fact's `value`, a class name, a rationale) is shown as data, never followed.

A recheck answer has exactly the keys `contract`, `module`, `version`, `table_hash`, `mode` (`"recheck"`), `candidates` (empty) and `recheck`.

**What a client never does with an answer:** copy free text from it into the model, build candidates from an earlier answer, or treat a candidate whose exposures are all pending as reviewed. A refused answer, or a module that is not loaded or fails, produces nothing.

---

## `table_hash`

`table_hash` is the SHA-256 of the edge-kind table as compiled into the module. Two answers with the same `table_hash` came from the same table; a client that records which table proposed an accepted edge keeps it beside the module's `version`. The table changes only with a module release.

---

## `contract`

The module answers in **contract 1** unless the options ask for **contract 2** (`"contract": 2`). A change to the answer's shape that an existing client would misread raises the number; a client refuses an answer whose contract it does not know rather than guessing.

| | Contract 1 | Contract 2 |
|---|---|---|
| Asked with | No `contract`, or `"contract": 1` | `"contract": 2`, module 0.2.0 or later |
| Envelope | `contract`, `module`, `version`, `table_hash`, `regime`, `candidates`, `counts` | The same, with `mode`, `rationale` and `limits`; or, with `recheck`, the [recheck answer](#the-recheck-contract-2) |
| Candidate | The keys of [Candidate](#candidate) | The same, with [`explain`](#explain-contract-2) |
| Size | At most 200 candidates | The same, held under 900 KiB by trimming explanations |

**A contract-1 caller gets the 0.1.2 answer shape unchanged:** the same envelope keys and candidate keys. Module 0.2.0 adds one count, `excluded_foothold_type`, under the pattern a client keeps counts by, and its candidates differ where the table changed (footholds a row cannot act from are no longer proposed, and a managed foothold caps some rows at low; see [architecture.md](./architecture.md#footholds-the-types-a-row-acts-from-and-managed-footholds)). Those are changes in what is proposed, not in how the answer reads.

---

## Related documentation

| Topic | Document |
|-------|----------|
| How candidates are produced | [architecture.md](./architecture.md) |
| What analyses see of an accepted edge | [analysis-contract.md](./analysis-contract.md) |
| Module index, build and test | [README.md](./README.md) |
| The Dethereal review flow that consumes this query | [../dethereal/README.md](../dethereal/README.md) |
