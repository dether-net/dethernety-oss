# Hidden Edges — Query Contract

The `hiddenEdgeCandidates` field returns a JSON-encoded answer: the hidden-edge candidates for one model, or a refusal. This document is the field-by-field reference for that answer, the options a caller passes, the counts, the refusals and errors, and the checks a client must apply before it acts on a candidate. It is the contract a client codes against. For how the candidates are produced, see [architecture.md](./architecture.md).

**What this document covers:** the field and its arguments; the options; the answer envelope and its `contract` version; each candidate field by field; the counts; refusals and GraphQL errors; the validation a client must apply; and `table_hash`.

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

The whole string may be at most 128 KiB; the size is checked first. A refusal names the offending key, never its value: its `detail` is `options` (not a string, too large, not JSON, or not an object), `options has an unknown key`, `excluded` or `include_pending`.

```json
{ "excluded": ["he:3f0a9c2e71b4d580"], "include_pending": false }
```

---

## The answer

Every answer, a refusal too, carries `contract`, which a client checks **before it reads anything else**.

### A successful answer

| Field | Type | Meaning |
|---|---|---|
| `contract` | `1` | The answer contract version. This document describes contract 1. |
| `module` | `"dethernety-hidden-edges"` | The module that answered. |
| `version` | `string` | The module's version (for example `"0.1.2"`). |
| `table_hash` | `string` | 64 lowercase hex characters: SHA-256 of the edge-kind table as compiled into the module. See [`table_hash`](#table_hash). |
| `regime` | `{ "kg": "kg_present" }` or `{ "kg": "kg_absent", "reason": … }` | Whether the knowledge graph was applied; `reason` is one of `no_data`, `not_entitled`, `no_session`, `unavailable`, `failed`. See [the knowledge-graph regime](./architecture.md#11-the-knowledge-graph-regime). |
| `candidates` | `Candidate[]`, at most 200 | The candidates, ordered by tier (high first), then whether the target is a crown jewel, then id. |
| `counts` | `object` | What each exclusion, cap and fold step left out, and the model's size. See [The counts](#the-counts). |

### A refusal

```json
{ "contract": 1, "module": "dethernety-hidden-edges", "version": "0.1.2",
  "refusal": { "code": "model_too_large", "detail": "exposures" } }
```

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
| | `pairs_over_anchor_budget` | (Exposure, row) selections that stopped at 1,000 considered pairs |
| | `excluded_external_pair`, `excluded_reached_type`, `excluded_declared_flow`, `excluded_by_breaker`, `excluded_by_decision` | Pairs each exclusion dropped, in that order |
| | `peers_capped` | Pairs past the 20 kept per (exposure, row) |
| | `kind_budget_dropped` | Candidates past the per-kind budgets |
| Knowledge graph | `kg_classes_capped` | Classes of the model's inventory past the 250 sent |

A client should show what it uses of these and keep the rest; nothing in the contract requires a client to read a count.

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

**What a client never does with an answer:** copy free text from it into the model, build candidates from an earlier answer, or treat a candidate whose exposures are all pending as reviewed. A refused answer, or a module that is not loaded or fails, produces nothing.

---

## `table_hash`

`table_hash` is the SHA-256 of the edge-kind table as compiled into the module. Two answers with the same `table_hash` came from the same table; a client that records which table proposed an accepted edge keeps it beside the module's `version`. The table changes only with a module release.

---

## `contract`

This document describes **contract 1**. A change to the answer's shape that an existing client would misread raises the number; a client refuses an answer whose contract it does not know rather than guessing.

---

## Related documentation

| Topic | Document |
|-------|----------|
| How candidates are produced | [architecture.md](./architecture.md) |
| What analyses see of an accepted edge | [analysis-contract.md](./analysis-contract.md) |
| Module index, build and test | [README.md](./README.md) |
| The Dethereal review flow that consumes this query | [../dethereal/README.md](../dethereal/README.md) |
