## Enrichment Protocol

One enrichment procedure, run in one of two modes:

- **Inline** — the enrich skill runs it in the main conversation. It asks the operator directly and writes a batch only after the operator confirms it.
- **Specialist** — the `dethereal-security-enricher` agent runs it for the guided workflow. It cannot ask anyone: it writes cited and derived values into the attribute files, validates, and writes its tables and questions to a relay file for the main conversation to show (Specialist mode below).

Both modes hold the Enrichment Invariants on every write.

### Inspecting the model

Read the model the way the validator does, never in fragments:

- Read each attribute file **whole**. Never sample JSON with `head`/`tail` or a byte range: a field below the cut-off is indistinguishable from an absent one.
- Ask presence questions ("which files set `encryption_at_rest`?") with a search across `attributes/`, not a shell loop over the files.
- Aggregate with the validator: `mcp__dethereal__validate_model_json` `action: 'quality'` for the score and `attribute_residual` (the elements carrying the most unresolved template fields, `top_unresolved[]` with the field names, and `blocked[]` for the elements it could not measure, usually for a missing class template — both lists capped, so they are the top of the queue, not all of it); `action: 'coverage'` for control gaps; `action: 'gates'` for the gate verdicts; `action: 'validate'` for the schema.
- Never write scripts to walk `attributes/` — the validator already does this and returns a structured result.

Read the model files (`structure.json`, `dataflows.json`, `data-items.json`), the attribute files, and `.dethereal/scope.json` (crown jewels, compliance drivers, adversary classes, trust assumptions) at the start.

**Classification check:** if Gate 3's C1 lists unclassified components (STOREs first), suggest `$dethereal:classify` first (advisory, not blocking). Unclassified STOREs are the highest-impact gap — data sensitivity analysis depends on STORE classification.

### Worklist and order

The server decides which elements Gate 3 holds to its floors; the worklist comes from it, never from a tier you assign yourself.

1. At the start of the run, call `mcp__dethereal__validate_model_json` with `action: 'gates'` once and take a **snapshot**: the elements that Gate 3 criteria C2 and C8 list as failing (the Tier 1–2 components that still lack values), plus every component with `crownJewel: true`, every element mapped in `crown_jewel_elements`, every data item with a regulatory flag, and the east-west pivots the report labels `tier_members.labels.cross_boundary` (components outside Tier 1 at one end of a boundary-crossing flow). If a list reports a larger total (`failing_total`, `cross_boundary_total`) than it shows, run the gates again after each batch and add the newly listed elements until the snapshot is complete — adding, never removing. **Hold the snapshot for the whole run** — a criterion turning green does not take an element off the list. When Gate 3 comes back `NOT_COMPUTED` (a loop back is open), the snapshot is its `gate3.loop_back.untouched` elements with their listed fields, and the tier report waits for a computed result; the open loop is ended at Step 9 of `$dethereal:threat-model`, never here.
2. Stale elements (`stale_elements` from `mcp__dethereal__model_state` `get`; in specialist mode, from your task message, with the declined fields) go to the top of the worklist. For a stale or picked element, check every field the evidence covers again — not only the null ones — so a setting that changed or disappeared shows as a change to an existing value; in the enrich skill, a picked element's values your evidence does not give join the confirm table as rows to keep, reject or change. Show: "N elements changed since the last enrichment. These will be enriched first." **Declined fields:** a field in `declined_fields` from the same `get` (by group, element and field) is answered: the operator left it empty. Never ask it again unprompted. When the operator gives its value later — in an answer, with a loop back, or as a note ("I checked with the platform team: …") — write it to the element's attribute file: the value ends the declined state. While it stays declined and sits on a Gate 3 floor (C2, C3 or C8 lists it), say so and point to Gate 3's waiver questions, Step 9 of `$dethereal:threat-model` — never offer a waiver here, and never a new question for the value (in specialist mode, list it as declined).
3. Order: crown jewels and their mapped elements first, then the rest of the snapshot, then the flows C3 lists as failing, then every other in-scope element. A data item joins the batch of the store that persists it — the first such store in the worklist — and the code that writes it there is read; one no store persists joins the batch of the first element that handles it. A data item whose store is outside the worklist joins the batch of the first element on it that handles it. Stored in more than one place, its at-rest values are those of the weakest store — and a store whose value is unknown leaves the item's value `null`, as a question. C4 and C7 failures drive the data-item step, C9 failures the credential step.
4. Report the tier sizes from the Gate 3 report once, next to the worklist counts, and the cross-boundary count on its own line — the label overlaps the tiers and never adds to a tier's size.

**Scope keywords:** `priority` (alias `tier1`) — the snapshot only, the fastest, highest-value set; `all` — every in-scope element, snapshot first (the default); `pick` — the operator picks from the full element list; `--pick <element-id>` — a single element, no selector (if the id does not resolve, say "element <id> not found" and stop). A `--pick <id>` flag wins over `pick`, `priority` or `all` given with it.

**Focus:** `credentials`, `monitoring`, `compliance` — only that part; no focus — every part below. The control pass runs only on an explicit `--focus controls`.

### Template-driven attributes

For each classified component **and classified data item** in the batch:

1. **Read the existing attribute file.** The stub written by `mcp__dethereal__generate_attribute_stubs` holds every template field name with a `null` value — schema defaults are deliberately not seeded, because a default is authoring metadata, not an observation about this element. These null fields are the checklist.
2. **Read the class's fields** with `mcp__dethereal__get_classes`: `class_id: '<class-id>'`, `fields: ['id', 'name', 'enrich']` — each template field in order, with its type, typical values, `enum`, `description` (its definition, precondition and secure value) and `how_to_obtain` steps. A class bigger than one page comes with `enrich_next_offset`: call again with the same `class_id` and `fields` and `enrich_offset` set to it, until it is absent. Never read `.dethereal/class-cache/*.json`: it holds the same fields at about three times the size.
3. **Discover values from the source** using each field's `how_to_obtain` steps — effective configuration and code (e.g. `postgresql.conf` for `ssl = on`, Terraform for `tls_enabled`). Record `path:line` for each value. `how_to_obtain` names one place to look: the same setting stated anywhere on the deployed path — a Terraform parameter or parameter group, a Helm value, a container argument, a driver option — is the same evidence. For each setting in a file you read on the deployed path, find the null field it settles — one pass per file read, not one search per field. A count or list field is answered by counting or listing what the element's own configuration states. Where `how_to_obtain` names a command (`kubectl …`, `SHOW ssl`), never run it against a live system: turn it into a question about the setting it would show ("is SSL required on the database?"), never a request to paste the command's output.
4. **Keep the precision you observed.** `tls_enabled: true` with no version seen is `"TLS"`, never an assumed `"TLS 1.3"`; encryption at rest switched on with no algorithm seen is `"encrypted (algorithm not observed)"`. A setting plus the documented behaviour of the software that reads it (e.g. a storage-encryption flag on a managed database) is written as rule (i)(a) says, with its `[derived: …]` basis; a value under rule (i)(c) is a proposed default.
5. **Ask for the rest** — for fields the source does not settle, prepare targeted questions from each field's `description`, grouped by element, floor keys first, at most 15 per batch inline, the rest deferred to the next batch; in specialist mode none is deferred.
6. **Merge, never overwrite blindly** — read the file before writing; preserve the plugin fields (`credential_scope`, `monitoring_tools`, and `crown_jewel` on **non-component** elements only: data items, boundaries and data flows have no first-class `crownJewel`, so the attribute-file key is their real home; on components `structure.json` is authoritative).

**Unclassified elements:** skip template-driven enrichment (the six-attribute floor still applies to unclassified components) and note it: "N elements skipped — unclassified (no class template available)."

**Offline fallback:** if `mcp__dethereal__get_classes` (`class_id`) fails, skip template-driven enrichment for that class and note "platform-unreachable — template unavailable" (the same disposition as unclassified).

### Six-attribute floor

After the template fields, check the six key attributes on **every in-scope component**, whatever its class template covers, and ask for any the template omitted. Use these EXACT keys and value shapes — Gate 3 and the scorer match literal names, not concepts. An observed insecure value (`"none"`, `false`, `[]`) passes Gate 3 but earns no quality credit; a placeholder (`unknown`, `TBD`, `n/a`, `?`, …) passes neither, and "any string" below means any string but a placeholder:

| # | Concept | Attribute key | Written on | Gate 3 (C8) accepts | Quality score credits |
|---|---------|---------------|------------|---------------------|-----------------------|
| 1 | Authentication | `authentication_type` | component | any string, `"none"` included | a mechanism — `oauth2`, `mtls`, `sso`; not `"none"`; `basic`/`digest` only with a non-deprecated `encryption_in_transit` |
| 2 | Encryption in transit | `encryption_in_transit` | **data flow** and component | any string, `"none"` included — on every Tier 1–2 component and every flow with a Tier 1–2 end, under this key only | a protocol — `TLS 1.3`, `"TLS"`; not `none`, `sslv3`, `ssl v3`, `tls 1.0`, `tls1.0` |
| 3 | Encryption at rest | `encryption_at_rest` | component | any string, `"none"` included; `"not_applicable"` as below | an algorithm — `AES-256`, `"encrypted (algorithm not observed)"`; not `none`, `des`, `3des`, `triple-des`, `rc4` |
| 4 | Logging | *(no scored key)* | — | — | Capture per the class template; nothing reads a floor-level key for this one |
| 5 | Access control | `implicit_deny_enabled` | component (boundaries too, but only the component value is scored) | `true` or `false` | `true` only |
| 6 | Log telemetry | `monitoring_tools` | component | a list of strings, `[]` included | a non-empty list after discarding `none`/`n/a`. Never `["None"]` — use `[]` |

Write the exact key names above. Gate 3's C8, `control_coverage_rate` and the surface report's encryption/auth coverage read these literal keys and no others, so a semantically-equivalent name a class template happens to use (`transit_encryption_enforced`, `tls_enabled`, …) does NOT satisfy the floor; a flow class's own transit field satisfies C3 only. Types are strict: a boolean `true` for `encryption_at_rest` scores as absent — these want the concrete algorithm/version string.

**A component's own `encryption_in_transit`** comes from its own listener configuration — the TLS settings of the port it serves — never from its flows. A component with no listener leaves it `null`; if C8 then fails on it, it can be waived at Gate 3's waiver questions, Step 9 of `$dethereal:threat-model` (C8, basis `not_applicable`) — never offer a waiver here; remember that C2 and C8 are never both waived on one element.

**A component that stores nothing.** `encryption_at_rest` may be `"not_applicable"` only on a component whose type is PROCESS and whose class is not a store class, and only on positive evidence from a complete specification of what runs in production: for example a Kubernetes container with `readOnlyRootFilesystem: true` and no writable volume (no emptyDir, hostPath or PVC), or a compose service with `read_only: true` and no volumes — or the operator's answer. A missing volume alone is not evidence, and a serverless function still writes to its `/tmp`: ask. It is never a default, never on a STORE, and no other floor key has such a value. Show it in the divergence table as "n/a (stores nothing)" with its basis (`path:line` or the answer). Any other floor key that does not apply stays `null` with the operator's reason; if Gate 3 then fails on it, it can be waived for that element at Gate 3's waiver questions, Step 9 of `$dethereal:threat-model` (basis `not_applicable`) — never offer a waiver here.

### Contradictory pairs

After each batch, check that every pair describing one property agrees:

| Template field (boolean) | Floor field (string) | Agreement |
|---|---|---|
| `encrypted_at_rest`, `storage_encrypted` | `encryption_at_rest` | `false` ↔ `"none"`; `true` ↔ the observed algorithm, or `"encrypted (algorithm not observed)"` |
| `tls_enabled`, `ssl_enabled`, `https_only`, `flow_tls_encrypted`, `encryption_in_transit_enabled`, `data_tier_transit_encrypted`, `registry_pull_over_tls` | `encryption_in_transit` | `false` ↔ `"none"`; `true` ↔ the observed protocol and version, or `"TLS"` |
| `tls_only_transport`, `service_to_service_mtls_enforced` | `encryption_in_transit` | `true` ↔ the observed protocol, or `"TLS"`; `false` says nothing about it |
| `auth_required`, `authentication_enabled` | `authentication_type` | `false` ↔ `"none"`; `true` ↔ the observed mechanism |

Gate 3's C8 and the quality score read only the floor field. Whenever a template field in this table is written — by the enrichment agent, by the `dethereal-enrichment-applier` agent after the relay, or by the enrich skill after `claim-confirm` or a question — and its floor field is `null`, write the floor field beside it in the same write, as the Agreement column says, from the same evidence or answer. A floor field that already holds a differing value is a divergence row: write neither side. The evidence decides both fields. If it settles neither, both stay `null` and the pair goes to the top of the divergence table. The validator reports a pair that disagrees as `contradictory_fields`, a value outside the class template's schema as `value_off_schema`, an `auth_failure_mode` on a flow without authentication as `auth_failure_mode_without_auth`, and a word mixing Latin letters with Cyrillic or Greek look-alikes as `mixed_script_value` (retype it in one script from what the source shows): settle each before the batch closes. The same holds for any other template field that restates a floor key.

### Credentials

Credentials are the single highest-impact enrichment for analysis quality: `required_credentials` on a flow gates lateral movement in the analysis engine. A cold "list all your credentials" reliably misses the shared service accounts that ARE the lateral-movement story — so the questions are anchored to the flows.

1. **Flow-anchored capture.** Enumerate the cross-boundary flows, and the flows recorded as `privilege_transitions` in `.dethereal/discovery.json` (a caller and callee at different authorization levels, the callee's authentication asked with them), and the flows whose `dataItemIds` hold a credential item, then prepare one table: for each flow, what credential authenticates it, and what ELSE does that credential reach? Pre-fill rows from the source (a Secret mounted by both ends, a connection-string variable) and from the shared credentials the operator named during discovery (`shared_credentials` in `.dethereal/discovery.json`).

   ```
   | # | Flow | Credential (id, or "none" when unauthenticated) | Also used by |
   |---|------|--------------------------------------------------|--------------|
   | 1 | API Server → PostgreSQL | db-admin-account | Worker → PostgreSQL |
   | 2 | Client → API Gateway | api-gateway-key | — |
   ```

   Then sweep for credentials no flow surfaced: service accounts, API keys, certificates, shared secrets, break-glass accounts, CI deploy keys.
2. **Credential ids** name one credential per account, cited at the reference: a database login is its account at the store (`<store>:<user>`) when the source names the user, the Secret that holds it being where it is stored; otherwise the referenced Secret's name and its secret-bearing key (`<secret>/<key>`; a username key is not a credential), namespace-qualified when the source shows more than one namespace; an external secret's provider path; a dynamic credential's role path; a workload identity's cloud role. With none of these, the store path the source reads it from; else the id is a question. Never an environment variable's name — two `DB_PASSWORD`s from different stores would merge into a false shared credential — and never a value. An id already on a flow is kept, and reused in the mapping. Ids stay identical across every flow and every `credential_scope` that names them. A workload identity, a cloud IAM role or a client certificate is a credential too: its id comes from the service account, role or certificate name the source cites, and a flow it authenticates is not unauthenticated.
3. **Map credentials to flows** as a table (credential, type, flows, shared?), then write to `attributes/dataFlows/<id>.json`:
   - `required_credentials: ["db-admin-account"]` — **the engine key**; writing only `credential_name` silently breaks lateral-movement analysis;
   - `credential_name` — a human-readable label only;
   - `credential_type` — `service_account`, `api_key`, `oauth_token`, `ssh_key`, `certificate`, `password`, `none`.

   `required_credentials` is never written without `credential_name`. A credential is cited at the call site that sends it on this flow — the header it sets, the driver it connects with — never at an environment variable or a mount alone; for a receiver in the repository, its verification point must check it, or the row is a question. A credential's presence on a flow is evidence for `required_credentials`, never for `auth_failure_mode`.

   A flow's credentials include what it carries to authenticate at this hop **or at any later hop it is forwarded to** — a bearer token a gateway passes on to the service that checks it belongs on the gateway's flow too. `required_credentials: []` only when the flow carries none, as invariant 4 allows (a cited source or the operator, confirmed before it is written); when nobody knows, leave the key out.
4. **Store credential scope.** For each STORE that holds credential material (a secrets vault, a config store, a database with credential tables, or a database whose migrations or IaC create login roles — it holds their verifiers): `stores_credentials: true` and `credential_scope: [...]` — the credential ids an attacker acquires by compromising it. Every id must match a `required_credentials` value on a flow; that is how the engine links a store compromise to flow traversal.
5. **Kubernetes Secret mounts.** If discovery scanned Kubernetes sources, find the Secrets mounted in several workloads and flag them: "Secret 'db-credentials' is mounted in 3 workloads: api-server, worker, migration-job."
6. **Secrets committed with the code.** When `.dethereal/discovery.json` lists a Secret manifest in `unreadSecretFiles` with `tracked: true`, and its `secretNames` holds a name a workload references (`referencedBy`), that workload's credential sits in a file git tracks. Never open the manifest. Cite the reference's `path:line` and the discovery record — the tracking is the evidence, the name match only ties it to the element. Each only where the element's template has the field:
   - `secrets_hardcoded_in_config_or_iac: true` on the consuming components, and `db_credentials_not_in_code_or_repo: false` on the database whose credential it is — `[cited]` written values; their row names what the scan cannot see: a SOPS-encrypted file, Helm-templated data, or placeholder or empty data;
   - `db_credentials_in_secret_manager` — a question, never a value: "Where do <db>'s credentials come from in production?", citing the manifest (a tracked base Secret is often a development placeholder that another source replaces).

| Location | Attribute | Type | Purpose |
|----------|-----------|------|---------|
| Data flow | `required_credentials` | `string[]` | Credentials the flow carries to authenticate at this hop or any later hop it is forwarded to (engine key) |
| Data flow | `credential_name` | `string` | Human-readable label |
| Data flow | `credential_type` | `string` | Category |
| STORE component | `stores_credentials` | `boolean` | Whether the store holds credential material |
| STORE component | `credential_scope` | `string[]` | Credential ids yielded on compromise |

### Data items

A data item is a *type* of data (PII, credentials, card data, session tokens …), not a per-location copy. It is modelled **once** in `data-items.json` and linked through `dataItemIds` to **every element that handles it across its lifecycle**:

- **Origin / sink** — the external entity (or process) where the data enters or leaves the system;
- **In transit** — the data flows that carry it across boundaries;
- **In use** — the processes that read, transform or cache it;
- **At rest** — the stores that persist it;
- **In scope** — the boundaries that contain or handle it.

**At rest, two fields.** The volume's encryption (`encrypted_at_rest`) and the item's own unreadability (the class's field for it, such as `pan_rendered_unreadable`) are separate fields: card numbers kept as plaintext in a column of an encrypted database are encrypted at rest and not rendered unreadable. Read each from what states it — the store's configuration for the first, the code that writes the item for the second.

Start from the flows: list each boundary-crossing flow without a data item, propose at least one item for it from what the source shows it carries (a request or event body, a sign-in), and ask what data crosses it. A log, trace or audit stream is a data item too: it takes the flags and sensitivity of the fields the code writes into it (cite the logging line), and its template's field for keeping personal data out of logs is false when the code logs a personal field. Then, for each sensitive data type not yet classified and fully linked, propose:

1. the elements that originate, carry, process, store or contain it;
2. its regulatory flags and the sensitivity they imply — a static lookup, never an estimate. Emit the flags **exactly as written** (the platform matches them case-sensitively); an item with several flags takes the highest sensitivity:

   | Regulatory flag | Sensitivity | Framework |
   |----------------|-------------|-----------|
   | `PCI cardholder` | restricted | PCI-DSS |
   | `PHI` | restricted | HIPAA |
   | `GDPR personal` | confidential (special-category data → restricted) | GDPR |
   | `PII` | confidential | General |
   | `SOX financial` | confidential | SOX |
   | `CCPA personal` | confidential | CCPA |

   Sensitivity uses four levels: `public`, `internal`, `confidential`, `restricted`. Regulatory labels are `regulatory_flags`, never sensitivity levels;
3. its DATA class: call `mcp__dethereal__match_classes` with `elements: [{name, description}, ...]`, `classLabel: 'DATA'`, the active `moduleIds`, `topN: 3`. Mark `exact_name` matches accepted. For the items left, list the active modules' DATA classes with `mcp__dethereal__get_classes` (`class_type: 'DATA'`, `fields: ['id', 'name', 'description']`, following `next_offset` until `truncated` is false) and check each against the item. Every item's class, exact or near, is a column of the one data-items table (Data items), beside its credential column; with no suitable class in that listing, `none suitable (N listed)`. A class from a module that is not active is never proposed here: name it in a note, and point to `$dethereal:classify`. In the main conversation, the lifecycle checks below run on the classified proposal before the table, their gaps added as gap-fill rows (Data items).

Only after the operator confirms: create the items with `sensitivity` and `regulatory_flags`, and `origin` where the source of the content is known (Origin and credential flag, below), write the confirmed `classData`, call `mcp__dethereal__generate_attribute_stubs` and fill the new data-item stubs **in the same run** with the template-driven loop above, and link each item through `dataItemIds` on every handling element (valid on components of every type, data flows and boundaries).

**Data-item checks.** The gate is Gate 3's C4 — every flow it counts as sensitive carries a classified data item with a sensitivity; read its failing list, never compute it. Four lifecycle checks are advisory, not a gate: every crown-jewel store has classified data items; every data origin references its data item; every process that reads, transforms or caches a sensitive data item references it; and the boundary containing a crown-jewel data item references it. Under time pressure the "in use" links are the first to drop, and an unlinked process carries no sensitivity signal for information-disclosure analysis. List every gap by element.

#### Origin and credential flag

Two more author-asserted fields sit beside `sensitivity` on a data item. Both are optional; absent means unanswered. Never set either silently — propose, and write only what the operator confirms.

**`origin`** — who can write the item's content (not the element where it enters the system). Ask for it where the source of the content is known; leave it absent otherwise. Tokens, most to least trusted:

| Token | Meaning |
|-------|---------|
| `authenticated_first_party` | Written only by the operator's own authenticated users or systems |
| `curated_internal` | Internal content that passed a review or curation step |
| `agent_relayed` | Produced or forwarded by another agent (at most this trusted) |
| `model_generated` | Written by a model and later read as input (at most this trusted) |
| `third_party` | Written by a known external party under an agreement — **untrusted** |
| `arbitrary_public` | Anyone can write it (web pages, inbound email, public issues, public forms) — **untrusted** |
| `not_assessed` | Answered as not established — **untrusted** |

Origin is the least-trusted origin of what the item holds: one public source makes it `arbitrary_public`. Where the source of the content is known, ask for `origin` in the data-item table's origin column; leave it absent when unknown.

**`is_credential`** — the item is a credential (password, token, key, secret, certificate). `mcp__dethereal__validate_model_json` `action: 'quality'` returns `credential_hints: [{ id, name, class, reason }]` for items bound to a credential-like DATA class whose `is_credential` is unanswered. **Credential flag:** the data-items table proposes it from the class, in its credential column, before anything is written. After the write, read `credential_hints` — the items still unanswered — and propose `is_credential: true` for each hint in the batch table, its credential column; write it only on confirmation. An answered `false` is respected and never re-proposed. The hint does not affect the quality score.

### Compliance-driven questions

From `compliance_drivers` in `.dethereal/scope.json`, by depth level:

- **Full attribute questions (SOC2, ISO 27001)** — ask for the value in the floor's shape (protocol and version, mechanism, tool names), not yes/no. SOC2: CC6.1 access control, CC6.7 encryption in transit, CC7.2 monitoring. ISO 27001: A.8.2 asset classification, A.10.1 cryptographic controls, A.12.4 logging.
- **Data classification questions (PCI-DSS, HIPAA, GDPR)** — "Does [component] process, store, or transmit cardholder data (PAN, CVV, expiry)?", "Does [component] handle protected health information (PHI)?", "Does [component] process personal data of EU residents?"
- **Declared only (NIST CSF 2.0, NIS2, DORA)** — no framework-specific questions. Show once: "NIST CSF / NIS2 / DORA declared as compliance driver. No framework-specific questions are generated for these frameworks (it requires deep domain expertise — incorrect mappings create false compliance confidence). Recorded in scope for documentation purposes."

### Auth failure mode

For each authenticated cross-boundary flow: when authentication fails, does the system **deny** (block the request), **fallback** (weaker auth), or **fail_open** (allow through)? It is a column of the flow table of the credential step, since only then is it known which flows authenticate. "Not sure" leaves it `null`. Write `auth_failure_mode` to `attributes/dataFlows/<id>.json`.

**From the source.** The verification point is the whole chain a request passes, from the first authentication layer to the handler: the middleware, the route guard, decorator or dependency, and the handler's own identity check. `deny` is written only after that chain is read — every except, catch and fallback branch included — and only when every branch, on every route the flow carries, rejects: the request never reaches the protected handler with an identity. An exception that leaves the chain is followed to the handler that catches it — a registered global handler, else the framework's default — and rejects only when that handler ends the request without calling the next stage; a catch-all you cannot trace leaves the value `null`. `fail_open` is a branch reached when a credential was presented and could not be verified — invalid, unverifiable, its key or identity provider unreachable — and the request goes on; `fallback` is one that degrades to a weaker check, or a client that retries with another credential, or a cache served past expiry while its source is down. Either is cited at that branch and wins over any rejecting line. A missing credential that goes on is followed to the route's own check: with no later check rejecting it, the routes are mixed — a note and a question, never `deny`. A branch gated by a setting (an environment name, an `AUTH_ENABLED` flag) is decided by that setting's value on the deployed path, cited; an unstated value is a question. `deny` also needs the verify call's options read — a disabled signature, expiry, audience or issuer check, or no pinned algorithm, is a note and a question — and a key with no default value in the source. A gateway, mesh or library option that admits a missing or failed credential is `fail_open` at that line (for example Envoy `ext_authz` with `failure_mode_allow: true`, express-jwt with `credentialsRequired: false` and no route check, NGINX `satisfy any`); a `deny` from a proxy or library needs every option of its authentication configuration read, and one left at an unstated default keeps it `null` (invariant (i)(c)). A derived `deny` comes only from configuration on the deployed path, read whole — for example an sshd configuration, every included file and `Match` block read, with `AuthenticationMethods publickey`, or a `pg_hba.conf`, its included files read, whose first line matching this flow's source and user is not `trust` — never from a runbook, whose lines are claims. Never evidence for it: a password-hashing setting, an authentication method switched off, a managed platform's default (invariant (i)(c): proposed, never written), a credential's presence, or a code comment or docstring.

On a `fail_open` or `fallback` path the source shows, follow it to where it takes the caller's identity — a header, a parameter, a default or shared account — and record what that sets on the receiving component, its authentication and authorization fields, citing the line.

Warnings for dangerous modes, inline:

```
WARNING: Flow "API Server → Database" has auth_failure_mode: fail_open.
This path may be exploitable when the auth service is unavailable.
```
```
WARNING: Flow "Auth Service → API Server" has auth_failure_mode: fallback.
This path degrades to weaker authentication when the primary auth mechanism fails.
```

Known gap (show once per session): "auth_failure_mode is captured for enrichment and human review, but the platform's analysis does not currently take it into account when it weighs attack paths. Flows marked fail_open or fallback may appear more secure than they are in analysis results."

### Monitoring tools

For each component: which monitoring tools cover it (SIEM, EDR, NDR, APM, cloud-native)? Write `monitoring_tools: string[]`. **Nothing covers it → `[]`, never `["None"]`** — coverage counts a non-empty array as "monitored", so a `["None"]` sentinel reports a blind component as covered. Agents and log shippers usually live outside the repository: a repository without monitoring configuration is a question, not `[]` — in practice `[]` comes from the operator's answer. Logging disabled in configuration is evidence for the template's logging field, not for `monitoring_tools`. A log or metrics destination, or a log-watching tool, that the source configures for the element (a log platform, CloudWatch Logs, pgaudit, fail2ban) is written to `monitoring_tools` as the source names it, cited — never a guessed product; whether anyone watches it is not asked. Captured for human review; the engine does not score detection coverage.

### Crown-jewel asset criticality

For components with `crownJewel: true` in `structure.json` (the single source of truth — the snake_case `crown_jewel` in an attribute file is a derived copy): propose `asset_criticality: "high" | "medium" | "low"` as a pre-filled row of the Enrichment Questions (`enrich-questions`), e.g. "'payment-db' is a crown jewel — proposed asset_criticality: high". It is written to the component's attribute file only after the operator answers that row. The platform's analysis draws its own conclusions from these signals; the plugin provides the signals, not the computation.

### Boundary enforcement

For boundaries whose `attributes/boundaries/<id>.json` lacks them, capture:

| Attribute | Question | Values |
|-----------|----------|--------|
| `implicit_deny_enabled` | Does this boundary enforce implicit deny (firewall, NACLs, security groups)? | true, false |
| `allow_any_inbound` | Does this boundary allow any inbound traffic without restriction? | true, false |
| `egress_filtering` | Does this boundary filter outbound traffic? | deny_all, allow_list, allow_all |

"Not sure" leaves the field `null`. Enforcement is the counterpart of a boundary's trust zone: an unenforced boundary in an Internal or Restricted zone is a coherence gap the review surfaces — capture these even while the zone is undecided. Flag unenforced boundaries:

```
WARNING: Boundary "Internal Network" has no implicit deny and allows any inbound.
Components within are reachable from adjacent boundaries.
```

### Adversary-driven questions

Read `adversary_classes` and `trust_assumptions` from `.dethereal/scope.json`. Echo the trust assumptions once at the start ("Per scope, trusting: …") so deliberately excluded areas are visible in the record.

- **`insider`** declared → the administrative access paths (SSH, RDP, bastions, management consoles, break-glass accounts — per element: who can reach it and how) and the shared-credential questions cannot be skipped; an insider review without them is mislabelled.
- **`supply_chain`** declared → the CI/CD pipeline and the dependency and registry questions (build system, deploy credentials, image and package registries, who can push) cannot be skipped.

They are asked in every run without a focus and in `--focus credentials`. Their answers are kept: an administrative, break-glass or CI deploy credential becomes a row of the credential step (so it reaches `required_credentials` and `credential_scope`); an access path, pipeline or registry the model lacks becomes a proposal to add it with `$dethereal:add`.

### MITRE ATT&CK

Do not annotate ATT&CK techniques on any attribute file. Technique coverage is derived on the platform from the exposures of an analysis run, and the validator rejects technique fields. If an exposure you expect is missing, the fix is a module policy — never a technique field on the element. The lookup tools (`mcp__dethereal__search_mitre_attack`, `mcp__dethereal__get_mitre_defend`) remain for explaining a technique an exposure names.

### Writing and validating

- **A batch** is the elements whose questions fit one question table (at most 15 questions), taken in worklist order; a data item goes with its store, as Worklist and order says. In specialist mode, a batch is one worklist element with the flows listed right after it, at most 6 of them.
- **Per-batch persistence.** Write each batch to disk before starting the next — never all batches in one terminal write. In specialist mode, read a batch's files in parallel, then write the batch as soon as you have its values — each element's file: never hold more than one batch unwritten, and never compose the values of the whole worklist in one reply. An interrupted run keeps its completed batches, and a resumed pass picks up from the null fields that remain.
- Write attribute values to `attributes/components/<id>.json`, `attributes/dataItems/<id>.json`, `attributes/dataFlows/<id>.json` and `attributes/boundaries/<id>.json`: read, merge, write.
- After each batch, call `mcp__dethereal__validate_model_json` (`action: 'validate'`) and keep its warning counts for the summary. Fix what it reports as an error before the next batch; a warning that names a missing value becomes a question, never an invented value.
- **A write that failed** (specialist mode) is made once more, after reading the file again; a value whose write did not succeed is never a Written values row.

### The divergence table

Every enrichment result — an inline batch or a specialist's return — starts with the rows that do **not** come straight from a cited source line or an operator answer, crown jewels sorted first, each row with its id (`D#`, numbered in order), element, field, value and why it is here:

1. **Contradictions** — pairs the evidence does not settle; they block writing both values.
2. **Claim vs evidence** — an operator answer, a trust assumption, a proposed zone or a document that the code contradicts.
3. **Source vs source** — two effective sources that disagree (compose vs Kubernetes, dev vs prod), and two opposite values read from the same cited line: neither is written.
4. **Changes to existing values** — a differing observation on a field that already holds a value: written only when the operator accepts it; the specialist never overwrites.
5. **Proposed defaults** — values no source states, **not written**.
6. **Open fields** — fields left `null`, each with the question that would settle it. Say once that a policy evaluated with fields left empty may report exposures inaccurately, so these are worth answering.

Then a separate **Red flags** block, one line a flag, no code block: the insecure facts recorded, `fail_open` / `fallback` flows, unenforced boundaries. Each red flag names the element by name and id and the template field that records it (`**<name>** (\`<id>\`): <field> = <value>`), and an insecure fact the code shows is written to that field before it is reported — never only in words — when the field's own meaning covers the fact: `implicit_deny_enabled` is a network or filtering deny-by-default, never authentication — a rule that opens an element's own serving port to everyone never makes it `false` (that needs a source showing that traffic no rule names gets in), and a boundary's value never carries over to its components; a conditional field (`…_where_multitenant`) is written only when a source shows its condition. One a document alone states is a claim row, and one no template field means says so, as a note. Then the table of what was written: every value, with its row (`R#`, numbered in the order written) and its basis — `[cited] <path:line>`, `[derived: <setting> → <behaviour>] <path:line>` or `[env: dev | unknown]`. These are findings and confirm tables (Relay): they never fold.

### Specialist mode

When you run as the `dethereal-security-enricher` agent, nobody can answer you. Then:

1. **Your worklist and scope come from your task message**; work through it in order.
2. **Write only keys that are `null` or absent** in `attributes/**`, only with values rule (i) of the invariants allows, and never a key a question decides — `crown_jewel`, `asset_criticality`, `stores_credentials`, `credential_scope`, an empty `required_credentials` and boundary enforcement (`implicit_deny_enabled`, `allow_any_inbound`, `egress_filtering`): return those as pre-filled rows of their tables, with `path:line`. A flow's `auth_failure_mode` and its credential keys — `required_credentials` (never `[]`), `credential_name` and `credential_type` — are written from the source as Auth failure mode and Credentials say, each a Written values row; its Credentials row shows them with their `R#`. An element whose class guide you find fits it only in part (a class made for a neighbouring kind of element): a field whose class-guide definition names no protocol is written only when the evidence meets that definition word for word; a protocol-specific field is a not-applicable question, never a mapped value; and no field is left `null` without a word. Flag the element `partial fit: <what differs>` in your summary. A differing observation on a key that holds a value is a divergence row (a change to an existing value), never a write; so is an observation that would contradict the other side of a pair that already holds a value — write neither side.
3. **Restarted after a cut-off.** When your task message says an earlier run on your worklist was cut off, the values it wrote were never shown: list as Written values every value your elements' files hold but the operator's answers your task message names — with its basis, or `[unverified]` when your evidence does not give it — and write nothing over them.
4. **Never write** `structure.json`, `dataflows.json`, `data-items.json`, `.dethereal/scope.json` or `controls/**`, and never call a tool that changes the model, the platform or the state (`mcp__dethereal__generate_attribute_stubs`, `mcp__dethereal__manage_controls` changes, `mcp__dethereal__update_attributes`, `mcp__dethereal__update_model`, `mcp__dethereal__import_model`, `mcp__dethereal__model_state` changes, `mcp__dethereal__model_state_waive`). Classes, data items, sensitivity, regulatory flags, `dataItemIds`, `controls[]`, `crownJewel` and zones are proposals for the main conversation's questions.
5. **Validate after each batch** (`mcp__dethereal__validate_model_json` `action: 'validate'`), not the gates. The run that leaves no remaining worklist then calls `mcp__dethereal__validate_model_json` `action: 'gates'`, `detail: 'full'` once, for the summary's shares and the open gaps.
6. **Return early rather than run out of turns.** If the worklist will not fit, stop after a complete batch and return what remains.
7. **Your return is the relay text** — markdown the main conversation prints verbatim — under these headings, in this order; a section with no rows is left out:
   - `### Summary` — one line: how many values you wrote, on how many elements (how many cited, how many derived), how many fields are still open, the stand-in and type-default shares from the gates call (a NOT_COMPUTED Gate 3 has none: say a loop back is open, with its `untouched_total`; a run that made no gates call leaves them out) and the validator's warning count.
   - `### Divergences` and `### Red flags` — as The divergence table says.
   - `### Written values` — `| R# | element | field | value | basis |`: every value you wrote, numbered in the order written, its basis `[cited] <path:line>`, `[derived: <setting> → <behaviour>] <path:line>`, setting and behaviour each in at most six words, or `[env: dev | unknown]`. Values in the secure direction, whatever their basis — `deny`, a control `true`, a non-empty `required_credentials` — come first, under their own heading, `### Written values — secure direction`, so an accept-all is read with them in view; R# runs on across both tables.
   - The question tables, each header exactly as The question tables write it: **Credentials** — every cross-boundary flow, every flow recorded as a privilege transition and every flow whose `dataItemIds` hold a credential item: credential id, also reaches, on failure — the on-failure cell always filled, a value with its basis or `not sure` — pre-fills with `path:line`, open cells marked; **Credential mapping** — the mapping those imply (credential, type, flows, the stores that yield it, shared); **Boundary enforcement**; **Open fields** — the questions you could not settle, each in one short sentence, grouped as template and floor fields by element, monitoring, `asset_criticality`, data items, compliance and adversary-driven questions, with every C2 `null_fields` and C8 `missing` entry the gates call lists on your scope: one the element's class makes inapplicable is marked so, with the reason, and an element marked `no_template` is one line with its remedy (classify it, or generate its stubs), not a row. Every row goes in this one showing: the caps per showing (Relay) do not apply, and a fold keeps every id and name.
   - `### Claims` — the documentation claims, values only a README, runbook or other document states, never written: one table, `| C# | Element | Field | Value | Line |`, the field by its exact key in the element's class template; each document's rows come under a row of its own, `| Document: <path> | | | | |`, the path as the repository names it; a claim no template field holds is a note line under the table. A document that states a floor key's fact gets a claim row for that floor key, and one that describes a flow gets rows for its `required_credentials` and `credential_type` — and for its `auth_failure_mode` only when it states what happens when authentication fails. A template field whose class-guide definition names no protocol — MFA, authentication source, lockout, admin IP restriction, authentication events logged — is mapped by its function, with the line; a protocol-specific key stays a note.
   - `### Remaining worklist` — the elements left, in order, or `none`.
8. **The relay file.** Replace any credential material in the text — `password=`, base64 blocks, token-shaped strings, key prefixes — with `[REDACTED]`, then write it with your file-write tool to a new file in the relay folder your task message names: `run-<n>.txt`, `n` the lowest number not yet taken there (list the folder first, for the number only: the folder can hold an earlier pass's files, and you read none but those your task message names). When your task message names earlier runs' files, your file carries on from them, and never rewrites them: read them before your first batch; number your R#, D#, F#, S#, Q# and C# rows on from their last; leave out a Credentials or Boundary enforcement row an earlier file already holds — a value that differs from it is a divergence row; a credential they name keeps its id. Answer with only the file's path, the summary line and the remaining worklist.

A file's **environment** is `dev` only when it is explicitly dev-scoped (`*.dev.*`, `docker-compose.override.yml`, `environments/dev/`, a local-only setup); a value from a dev file is a source-vs-source row, not a write. A file of unknown environment is a source, recorded as `(environment: unknown)` in the entry's `source`.

Never mark anything confirmed, never transition the state, and never substitute your judgement for the operator's answer.

### Applying the answers

What the operator decides about a written value: **accept** keeps it, with nothing to write; **reject** writes the field back to `null`; **modify** writes their value. A question row is written as its answer gives it; "not sure", or a row the answer leaves out, stays `null` — never a guess. An answer to a row that contradicts a cited observation is written as the operator gives it, and its divergence row stays. After the guided workflow's relay the `dethereal-enrichment-applier` agent writes them. In the enrich skill, once the operator has confirmed a batch or answered its questions: write their answers to the attribute files as Writing and validating says, and validate. Write only a key the element's attribute file or class template lists, or a floor key: a fact no field holds is said in one line, never a key made up for it. Then:

- remove each enriched stale element with `mcp__dethereal__model_state` `action: 'stale'`, `remove`;
- after the first confirmed batch, if the state is STRUCTURE_COMPLETE, call `mcp__dethereal__model_state` with `action: 'transition'`, `to: 'ENRICHING'`. At ENRICHING or REVIEWED make no transition — re-running enrichment is additive.
