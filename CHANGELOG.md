# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **`@dether.net/dethereal` dependency updates** (`@apollo/client` 4.3.8, `graphql` 16.15.0, one
  copy in the bundle); they ship with 0.6.0.
- **`@dether.net/dethereal` updates `smol-toml` to 1.9.1**, which closes advisory
  GHSA-r4xh-jqrq-34v2; smol-toml 1.9.x returns parsed TOML tables as null-prototype objects, so
  the plugin's Codex configuration reader now returns ordinary objects, keeping the installer's
  doctor (which compares the configuration against the expected one) working unchanged. It ships
  with 0.6.0.

## [0.16.0] - 2026-11-12

The threat report 2.2.0 resolves and freezes who runs each component and boundary when a report is
generated. `dethernety-general` 1.1.0 adds two boundary classes, SaaS Tenant and Managed Runtime.
On a component or boundary, the operation category comes first on the Attributes tab. The operator
console gains a News tab, off by default. dt-ui reads the zone the model's root boundary declares.
dt-core: opt-in strict control resolution on import and update, and external-ingress findings
through load balancers and proxies.

**Upgrading:** from 0.14.0 or 0.15.0, `./byodt upgrade` does it (see the operator guide's
Operations, *Upgrade with `./byodt upgrade`*). A 0.13.0 or 0.12.x deployment upgrades once with this
release's installer, naming the deployment's folder (see Operations, *Upgrading from 0.13.0* and
*Upgrading from 0.12.x*):

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://github.com/dether-net/dethernety-oss/releases/download/v0.16.0/get-byodt.sh \
  | sh -s -- --upgrade --dir /path/to/your/deployment
```

A deployment that skips releases reads the notes at the head of each skipped release in this
changelog, so 0.13.0 to 0.16.0 also reads 0.14.0's and 0.15.0's, and 0.12.x to 0.16.0 those of
0.13.0, 0.14.0 and 0.15.0. After the upgrade, a model may
have an `external-ingress` finding it did not have before, and every existing threat-report
snapshot of a model with components reads stale once; regenerate the report to clear it (see
*Changed*, the `external-ingress` entry).

**Operators:** the console's News tab makes no news fetch until a category is switched on. When one
is, allow `dether.net` through the deployment's outbound proxy: the console's daemon fetches the
feed, not the browser (see *Added*). On a deployment connected to the cloud whose knowledge-graph
version was pinned before the two new boundary classes were published, those classes evaluate as
usual. The knowledge-graph reasoning that modules add for them appears once an administrator
updates the knowledge graph in the console and the platform is restarted (see the operator guide's
Cloud, *Update the knowledge graph*).

**Module authors:** `@dethernety/dt-module` is 0.16.0. A module whose manifest declares
`compatibility.dtModule` must move it to `^0.16.0` to be packaged against it: a caret on a 0.x
version pins the minor, so `scripts/package-module.js` refuses `^0.15.0`. In
`@dethernety/dt-module/testing`, `runContractSuite` expects a served template's operation category
first. A served component or boundary template keeps only plain uischema scopes, and in
`DtFileOpaModule` a template that parses but cannot be extended now fails the read. dt-core gains
opt-in strict control resolution on import and update (`controlResolution: 'strict'`). See *Added*
and *Changed*.

**API callers:** `controlCandidates` now reads a control class without `supportedTypes` as
compatible with every element type, so the ranking includes it and its `compatible` is true (see
*Changed*).

**Dethereal users:** Dethereal 0.5.2: one plugin for Claude Code, Codex and OpenCode (Claude Code
Stable, Codex Experimental, OpenCode Preview); a new threat model is quick by default; on Claude
Code, a guard hook that fails blocks the call, which needs Claude Code 2.1.295 or later. Dethereal
is published separately from this release.

### Added

- **`dt-core`: opt-in strict control resolution for import and update.** `ImportOptions`,
  `UpdateOptions` and their Split variants take `controlResolution: 'lenient' | 'strict'`. The
  default, `'lenient'`, attaches a reference by its id, its exact name, or a name a single control
  matches when case and surrounding spaces are ignored, with no partial match (see Fixed in
  0.12.0); a
  reference it cannot resolve is listed under `unresolvedControls` and named in a warning, and the
  rest is written. `'strict'` links a reference only by its id, or by
  a name exactly one catalog control has (compared after NFC normalisation, zero-width removal and
  trimming; case matters). Every controls list is resolved against one catalog snapshot before the
  first write, and any reference that does not resolve refuses the whole push with a code
  (`control_id_not_found`, `control_name_not_found`, `control_name_ambiguous`,
  `control_entry_invalid`, `control_catalog_unavailable`), the list's ref and the entry's index.
  Strict mode also refuses duplicate element ids, defers greenfield control-library entries to the
  control library's own push, treats a failed control write as an error, and returns the controls
  it linked as `resolvedControls`. See the import/export architecture reference.
- **`@dether.net/dethereal` 0.5.0 was published on 2026-11-10 and withdrawn the same day; 0.5.1
  was never published.** 0.5.2 is the first 0.5 release of the plugin to ship; it fixes a check
  in the Codex hook that a crafted `sed` script could stall.
- **`@dether.net/dethereal` 0.5.2: Claude Code is Stable, Codex Experimental, OpenCode
  Preview.** Besides Claude Code, the plugin installs on Codex and OpenCode with `dethereal
  install`. Each status says how far the harness is tested. Claude Code is the main target; the
  full workflow is tested on every release. Codex runs the workflow end to end in our tests;
  expect rough edges. OpenCode runs end to end, but in our tests the model can skip a checkpoint
  question (seen at the data-items step), write a value different from the one confirmed (seen
  with a boundary's trust zone), or stop enrichment early on some components. Codex and OpenCode
  lack the Claude Code-only features, such as asking some questions together and the
  threat-modeler starting the specialist agents. See the Dethereal Getting Started guide,
  *Codex and OpenCode*.
- **`@dether.net/dethereal` 0.5.2: the server keeps the workflow state and computes the gates; five
  tools are new.** In 0.4.x the skills edited `.dethereal/state.json` themselves, ran a script
  through the shell to find drift, and judged the quality gates from their own reading of the
  model. `model_state` now reads and changes a model's workflow state, and the workflow changes it
  only through this tool (`get`, `transition`, `set_baseline`, `stale`, `merge_pulled`,
  `loop_back`, `mode`): a move to REVIEWED needs Gates 2 and 3 to pass and no queued stale
  element, and a move back removes the quality cache, clears the review's sign-off and queues the
  stale ids. `validate_model_json` gains the `gates` action, which computes Gates 1 to 3 (Gate 3's
  criteria C1 to C9) with the failing elements, and a push (`create_threat_model`,
  `import_model`, `update_model`, `update_attributes`) is refused before anything reaches the
  platform while Gate 2 fails. `model_state_waive` waives one Gate 3 criterion for up to five
  named elements with your reason, or revokes such a waiver; some gaps can never be waived, a
  criterion stops passing when more than a quarter of what it assesses is waived, and a waiver
  lapses when its element changes. `model_state_prune` deletes the attribute files of elements
  the model no longer has, once you approve the list (at most 50 a call; a refused call deletes
  nothing). `workspace_status` reports the registered models with their state and quality, and for
  one model its sync record and local control library; `/dethereal:status` and `/dethereal:help`
  read it. `detect_drift` lists the files discovery reads that changed since the model's drift
  baseline, as git sees them, in place of the 0.4.x script. The five work on local files only and
  never contact the platform; `model_state_waive` and `model_state_prune` always ask for approval.
- **`@dether.net/dethereal` 0.5.2: the hooks run as `dethereal hook`, and three are new.** 0.4.x
  ran three bash scripts as Claude Code hooks: a note at session start, a validation hint after a
  model file was written, and a model summary before a compaction. On Claude Code every hook now
  runs `node` on the plugin's own server file (`dethereal hook <name>`), with no shell; Codex runs
  the plugin's `bin/hook.mjs`, which starts the installed runtime once its check passes, and
  OpenCode's plugin starts the runtime copy itself. The session note and the validation hint
  stay; the model summary now comes from a `SessionStart` hook once the compaction is done, since
  a `PreCompact` hook's output never reaches the model. New: the **config guard** refuses an
  agent's edit of a harness's settings that would widen what runs without asking you, and the
  **secret guard** keeps an agent's reads, searches and shell commands away from secret files and
  sign-ins (both under Security); on Claude Code, the **approve hook** approves the 16 plugin
  tools that only read or whose every change the server validates, so Claude Code asks for them no
  more than Codex or OpenCode do. The other tools still ask, and your own deny and ask rules still
  apply. The guards and the validation hint run on Codex (once you trust the plugin's hooks) and
  OpenCode too.
- **`@dether.net/dethereal` 0.5.2: the settlement is reserved, and off by default.** The
  settlement holds each value in the model files to the operator's registrations. It is on only
  when the server's environment sets `DETHEREAL_SETTLEMENT` to exactly `on`; unset, empty or any
  other value is off. With it off, `model_state_settle` is not served, and `model_state` does not
  offer its settlement-only inputs (`include`, `pending_from`, `pending_limit`, `pending_render`;
  a call that names one is refused as an unknown input). A pull or a push registers nothing (an
  import still writes the control ids it linked into the files). Neither pending enrichment nor a
  value the operator has not confirmed holds back REVIEWED or a push: Gate 2 alone decides a push.
  The Claude Code approve hook approves no settle action. Gates 1 to 3, the Gate 3 waivers, the
  orphaned-file prune and the secret guard stay in both modes. When the variable is set
  to anything but `on`, the server says once at startup that the settlement is off, and the
  session's orientation adds one fixed line; neither shows the value, since a repository's own
  settings can set it. A model whose `.dethereal/` holds settlement records is flagged `settled
  with the settlement on, which is now off`, and the config guard refuses an agent's change to the
  variable. The entries below on registering values on pull and push, on `model_state_settle`
  (`set`, the echo, the rule that decides what can be registered, `prepare` and `commit`) and
  on the approve hook's `prepare` describe the settlement switched on. See the MCP server
  architecture, *Settlement Switch*.
- **`@dether.net/dethereal` 0.5.2: pulling and pushing register the values they bring in.** A pull
  (`export_model`) registers the platform's values, as written, for that platform model. An import
  (`import_model`) registers the controls lists it pinned (see Changed: `import_model` resolves
  controls strictly). A local control created on the platform (`manage_controls`
  `push-greenfield`, or a replay of its recovery journal) carries its registrations to its new id;
  a carry that fails never fails the action, and leaves a warning to confirm the new id with
  `model_state_settle`. Results report the outcome as `settlement_registration` when something was
  registered or the registration failed; `registered` still means the project's model registry. In
  `dt-core`, `applyPendingRewrites` and `pushGreenfieldControl` take an `afterOperation` callback,
  awaited after each operation's id rewrite with `{ tempId, serverId }`; a throw keeps the journal
  for the next replay, so the callback must be idempotent.
- **`@dether.net/dethereal` 0.5.2: settling can write a confirmed value, and every settle reports
  what it registered.** `model_state_settle` takes a `set` decision: a value the operator confirmed
  in the chat is written and registered in one approved call. Each `set` item names the element's
  current name (`name_mismatch` otherwise). An attribute value is held to the rule every decision
  shares (below); an element with no attribute file is refused `no_attribute_file`. Record values
  are settable only on their own group — `zone`, `domains` and `planes` on boundaries, `crownJewel`
  on components, `sensitivity`, `regulatory_flags`, `origin` and `is_credential` on data items —
  and are written to `structure.json` or `data-items.json` (`changed` if the field moved since the
  call was planned); `classData`, `placement`, `controls`, `conduits` and `dataItemIds` are
  refused `record_field`. `absent: true` removes a field, and a field with a pending row is refused
  `duplicate_pending`. Every settle result carries `echo`, one entry per registration for every
  decision, with the value, the value it replaced (`{value}`, `{absent: true}`, or
  `{undisplayable: true, sha256}` for text that cannot be shown safely) and how that one was
  registered, plus `revision`, the baseline revision the call signed; a call whose result would
  exceed 24,000 characters is refused `echo_too_large` before anything is written. An undo is an
  ordinary `set` batch built from the echo's previous values; a value that was unregistered comes
  back registered, which the echo shows so the operator can decline it.

  **Every decision holds a value to the same rule.** `set`, `confirm`, `accept` and
  `modify` register an attribute value only when its field is a field of the element's class
  template and the value fits the template's schema, or when the field is a key the gates read or
  the workflow asks for on that kind of element (such as `stores_credentials` on a component,
  `egress_filtering` on a boundary, `auth_failure_mode` on a data flow, `crown_jewel` on any
  element) and the value has that key's type. A field the class declares is judged by the class's
  schema. Refusals are `off_template_field` (the class has a template, and neither it nor the
  workflow's keys have the field), `no_template` (the element is unclassified, its class is not
  cached, or its cache entry cannot be used; only the workflow's keys register) and
  `invalid_value`; `unlisted_field` is a field name with characters other than letters, digits,
  `_` or `-`. `confirm` and `accept` hold `zone`, `domains`, `planes`, `crownJewel`, `sensitivity`
  (any case), `regulatory_flags`, `origin` and `is_credential` to the values `set` takes. Removing
  a value never needs the rule: `set` with `absent: true` drops a field no decision could register,
  `confirm` with `removed: true` registers a removal, and `reject` answers a pending row even on a
  field that can no longer be registered. A retried call for a value already registered is
  reported in `already_settled`. `model_state` `get` codes each unregistered value no decision
  could register as it stands (`off_template_field`, `no_template`, `invalid_value`) and gives it
  no `key`; a value already registered is never listed again, so a pulled model lists nothing to
  register until a value changes locally. What a pull, a push or a greenfield control push
  registers is not held to this rule.

  **The approval dialog is not a trusted display on every harness.** As measured on 2026-09-28,
  Claude Code 2.1.283's shows every value of a settle call and its reply; Codex 0.158.0's cuts each
  argument to one line and does not show the reply; OpenCode 1.18.33's shows the reply but omits
  `items` entirely. Later versions may differ. On Codex and OpenCode — for `set` and for every
  other settle call — the protection is the confirmation table in the chat and the echo. The
  operator reads the model's rendering of the echo: it catches an honest model's mistakes, not a
  dishonest model that also fakes the table. See the MCP server architecture and the sync user
  guide.
- **`@dether.net/dethereal` 0.5.2: settling can be prepared, then committed, and a range of pending
  rows accepted as shown.** `model_state_settle` `prepare` checks a call as `settle` would, records
  nothing in the model, and returns a `plan_id` and server-rendered `lines` to show the operator; `commit`
  `{ plan_id, lines, reply }` records that plan once, with the operator's reply. `lines` must be the
  plan's lines exactly as `prepare` returned them, so the approval dialog shows what is recorded;
  anything else is refused `lines_differ`, and the plan stays committable. A plan lives only in the
  server's memory, expires after 30 minutes, and is refused `plan_stale` when the model changed
  since `prepare`; zone, planes, conduits and crown-jewel decisions are never prepared
  (`trust_field`). A second commit says how the plan ended (`plan_used`, `plan_stale` or
  `plan_failed`), one sent while the first is still running is refused `busy`, and a commit refused
  on this machine's own state leaves the plan committable.
  `accept_rows { from, to, digest, except }` accepts one range of the pending file by the row
  numbers of a table page the server rendered (`rows_not_rendered` otherwise), bound to the file's
  digest; every row of a field goes the same way, and each
  row counts against the 250-decision limit. `model_state` `get` with `pending_render: 'table'`
  gives `pending_table`, a printable table of the pending rows (up to `pending_limit` 250), every
  cell neutralised and a `Note` on each row that cannot be accepted as shown, judged as the range
  is (`unknown_field` for a field the element's file, its class template and the workflow's keys
  all lack). Orphaned registrations
  carry a `cause` (`removed`, `moved`, `reclassified`, `re-pointed` or `changed`; a rename reads as
  `removed`). A `set` of a record without `record: true` is refused `record_flag` with the `fix` to
  send, a name an attribute or class template shares with a record is refused `ambiguous_field`, and
  a differing placement confirm gives the `expected` value. Accepts of unchanged values on
  unregistered fields are counted in `accepted_unchanged` instead of listed in
  `registered_unchanged`. See the MCP server architecture.
- **`@dether.net/dethereal` 0.5.2: `get_classes` gives compact views for enriching and for telling
  classes apart.** `fields`
  takes `enrich`: each template field, in the template's order, with its `value_type`,
  `typical_values`, `enum`, `description` (the guide's full option description, else the schema's)
  and `how_to_obtain`, whose steps keep only `type`, `instruction`, `file_path`, `navigation` and
  `source` (a plain-text step is kept as `{ instruction }`). The guide's commands, expected outputs
  and security impact are left out, as is a guide entry for a field the template lacks; a field
  without a guide entry keeps its type and allowed values. A guide entry names its field by
  `attribute_name` where it has one, else by `option_name`, and the first entry for a field counts.
  Like `attributes` and `guide`, it needs `class_id`, `name` or `category`; it is never part of the
  default all-fields listing, and is refused together with `attributes` or `guide`, as it is the
  compact view of them. Each entry carries `enrich_total`, the template fields in all. A class whose
  view is larger than a page comes back alone, with as many fields as fit and `enrich_next_offset`,
  and the page's note names the call for the rest (`class_id` and `enrich_offset`); `next_offset`
  still goes on to the next class. `enrich_offset` is refused without `class_id` and `enrich`, when
  the `class_id` matches more than one class, or past the class's fields. A single field larger
  than a page is sent alone as `oversized`. For the median shipped `dethernety-general` class
  the view is about a third of the template plus guide; large classes page. `fields: ['id',
  'name', 'template_keys']` with a `class_id` gives the template's field names alone, to tell close
  classes apart; it is refused without `class_id`, beside `attributes`, `guide` or `enrich`, and
  is not part of the default listing either. See the MCP server architecture.
- **`@dether.net/dethereal` 0.5.2: a state move can record the mode and the drift baseline, and a
  validate can return the gates and the zoning.** `model_state` `transition` (see above)
  also takes `mode`, `quick_through` and `commit` (`'HEAD'`, or a full commit id that is an
  ancestor of HEAD, recorded as the drift baseline) and records them with the move in one write:
  each is checked against the state after the transition before anything is written, and a refusal
  refuses the whole call. A transition to the state the model holds records them alone, and
  `quick_through: 8` also returns the quick model's `priority_gaps`. `validate_model_json`
  `validate` with a `directory_path` takes `include: ['gates']`, `['zoning']` or both, and returns
  each part as its own action returns it (`detail` applies to the gates, `assets` to the zoning); a
  part that cannot be computed comes back as `gates_unavailable` or `zoning_unavailable` with its
  reason while the rest still comes, and `include` on any other call is refused `include_scope`.
  The guided workflow uses both.
- **`@dether.net/dethereal` 0.5.2: a review goes stale when any control link changes.** The review
  hash, which REVIEWED records and `model_state` compares to tell a stale review, covers the
  controls on every element, data items included, and those linked to the model and to its root
  boundary. It reads each control by its name, compared as strict control resolution compares names
  (after NFC normalisation, zero-width removal and trimming; case kept), each distinct name once,
  and never by its id, which a push may change. So a push that writes back the platform's spelling
  of a name, or a control listed twice, leaves a review standing, while a case-only rename moves it.
  Each entry with no usable name counts on its own; an absent or empty list reads as no controls.
- **`@dether.net/dethereal` 0.5.2: a quick model's review shows its top findings.** The model
  reviewer composes up to five attack chains through the model (the entry, each hop by its existing
  flow id, the target) and ranks them: a chain that reaches a crown jewel first, then by entry zone,
  then by the number of controls not in force on the chain. Each finding states its facts as fields
  and values read from the model files, with no ATT&CK, CWE or CAPEC ids and no numeric severity. A
  quick run shows them at Step 9 and again after the push.
- **`@dether.net/dethereal` 0.5.2: a quick run skips the second classification pass when nothing
  is left to classify.** `validate_model_json`'s quality result gains
  `attribute_residual.unclassified_open`: the unclassified elements still open to classification,
  leaving out the model's root boundary and the elements `.dethereal/discovery.json` lists as
  `left_unclassified` (a missing or unreadable file leaves none out); `elements_unclassified`, the
  completion ratio and the quality score are unchanged. On a quick model, Step 6 runs no pass when
  `unclassified_open` is 0 and Step 3 dropped no class from a module that is not active: the class
  confirmation, the module step and the class write are skipped, and the crown-jewel mapping is
  still proposed and confirmed. A full model always runs the pass. Step 3 records each element left
  unclassified as `{ id, words }` (your words, verbatim) and each class it dropped from an inactive
  module in `dropped_classes` as `{ id, class, module }`, so a compaction or resume before Step 6
  keeps the pass. Deepening a quick model (a run with `--full`) runs Step 6's pass in its
  own phase before taking up Step 7 or a later step, so the skipped look is made up; one that takes
  up Step 6 or earlier runs its own pass, neither skipped nor doubled.

- **Two boundary classes in `dethernety-general` 1.1.0.** **SaaS Tenant** is the organization's own
  tenant of a vendor-run SaaS service, and **Managed Runtime** is a vendor-run environment that the
  organization deploys its own code, containers or agents into. The module now has 83 classes (77
  classes and 6 issue classes).
- **The threat report freezes who runs each element.** `dethernety-threat-report` 2.2.0 resolves
  who runs each component and boundary when a report is generated: what is declared and how it was
  decided (declared, read from the Vendor zone, not declared, or not valid), the product, a
  component's hosting boundary with that boundary's own declaration, and, for a boundary declared
  as a vendor's, the number of components drawn directly in it. The component profile, the exposure
  detail and the HTML export show them, and the JSON export carries them through the snapshot
  (`snapshot.operation`). The version is not read. A report from before 2.2.0 asks to be recreated.
  When the rules cannot load or zoning failed, the report is still written, and says who runs it
  could not be worked out instead of showing a default. The fingerprint now also takes each
  component's class (for an unclassified component, its name and type), so a report from before
  2.2.0 reads stale once after the upgrade, on every model with components, whether or not it
  declares an operator. After that, changing an operator, a product or a component's class makes a
  report stale, and a version edit does not. See the threat report's *Reading the Report*, *Who
  runs an element*.
- **The operator console has a News tab.** It shows the project's blog posts and release notes,
  read from `https://dether.net/feed.json`, in two sections, Posts and Releases. It is off until a
  category is switched on, so a fresh deployment makes no news fetch. The console's daemon fetches
  the feed through the deployment's outbound proxy, not the browser. The categories apply to the
  whole deployment and are saved in `mode/news.json`; in cloud mode only an administrator can
  change them. A platform release newer than the deployment is marked as such. See the operator
  guide's Operations, *News*.

### Changed

- **`controlCandidates` reads a control class without `supportedTypes` as compatible with every
  element type.** Before, it read such a class as supporting none: the class was left out of the
  ranking, and `compatible` was false. Now the ranking includes it and its `compatible` is true.
  An explicit list, an empty one included, is still read strictly. Control gaps already read an
  absent list this way.
- **`dt-core`: `external-ingress` sees through load balancers and proxies.** The finding used to fire
  only when a flow ran straight from an external (`UNTRUSTED` or `VENDOR`) boundary into a tier
  resolving to `INTERNAL` or `RESTRICTED`. It now also fires when the external boundary reaches that
  tier only through one or more forwarders, each hop a modelled flow in direction. A forwarder is a
  component of the stock Load Balancer, Reverse Proxy / WAF Appliance, VPN Gateway, Firewall or
  Network Router class (by class id, or by that exact class name under another id), or an
  unclassified process named as a load balancer or proxy (`LB`, `ALB`, `NLB`, `ELB`, `WAF`, load
  balancer, reverse proxy, ingress controller, as whole words); an API gateway or a web server
  terminates the request and is not one, and a classified component is judged by its class, never
  its name. Each forwarder sits in a tier that is not external, not the source, not the model's root
  and not trusted — a forwarder inside a trusted tier is already a direct ingress onto it. There is
  one finding per external boundary and tier reached, with `boundaryId` and `peerId` as for a direct
  crossing plus `via` and `viaIds`, the forwarders in order along the shortest path; its detail
  names the hops and the remedies: ratify a conduit to the tier, route through an approved path, or
  declare the tier Exposed. A direct flow between the two still gives only the direct finding. Only
  a conduit from the external boundary to the tier behind the forwarders ratifies the crossing — one
  to the forwarder's tier does not — and such a conduit is no longer reported as dead intent. The
  forwarder tier's own crossing into an asset-bearing tier still raises its own `flow-channel`
  finding. `@dether.net/dethereal`'s `validate_model_json` `zoning` action reports these findings in
  both the skeleton and full phases, and the threat-report module now passes each component's class
  id and name to the engine, so the report's zoning findings recognise forwarders by class. See the
  trust-zoning architecture reference.

  **Upgrading:** a model that had no `external-ingress` finding may now have one. Ratify a conduit
  from the external boundary to the tier behind the forwarder, or declare that tier Exposed. Every
  existing threat-report snapshot of a model with components also reads as stale once after the
  upgrade, even with no change to the model: the report's staleness fingerprint now includes each
  component's class (for an unclassified component, its name and type). Regenerate the report to
  clear it. See the threat-report 2.2.0 entry under Added.
- **`@dether.net/dethereal` 0.5.2: the plugin runs its own server with `node`; there is no `npx`
  launch.** 0.4.x started the server with `npx @dether.net/dethereal@0.4.20`. The server is now
  built into the plugin, with every runtime dependency bundled, and Claude Code starts it with
  `node ${CLAUDE_PLUGIN_ROOT}/dist/index.js`, so the plugin and its server are always the same
  version and starting it fetches nothing. The same file is the `dethereal` command: the server
  with no arguments, and the installer with `install`, `uninstall` or `doctor`. Codex and OpenCode
  run the server from a copy the installer keeps in `~/.dethernety/runtime/`.

  **Upgrading from 0.4.x:** check your Node.js version and platform URL first (see the two entries
  below). Then update with `npx @dether.net/dethereal install --harness claude --scope user`, which
  needs Claude Code 2.1.295 or later, or run `claude plugin marketplace update dether.net` and then
  `claude plugin update dethereal@dether.net --scope user`, and start a new session. A model made
  with 0.4.x records no mode, so it continues as a full model. A model 0.4.x left at REVIEWED stays
  REVIEWED only when the server's Gates 2 and 3 pass and no stale element is queued, and then reads
  as a stale review, since 0.4.x recorded no review hash; otherwise it reads as ENRICHING. Either
  way, the next `/dethereal:threat-model` run takes it up again. See the Dethereal Getting Started
  guide, [*Upgrading from 0.4.x*](docs/user/dethereal/GETTING_STARTED.md#upgrading-from-04x).
- **`@dether.net/dethereal` 0.5.2: Node.js 20.11.1 or later.** 0.4.x asked for Node.js 20.0.0. On
  an older Node, the `dethereal` command — the server, the installer and every hook but the two
  guards — prints "Dethereal needs Node.js 20.11.1 or newer (running <version>)" (on Node 14.8 or
  later; an older Node cannot load Dethereal at all) and exits without starting; the two guards
  block the call (below). Claude Code starts the server and the hooks with the `node` on its
  `PATH`.

  **The secret and config guards block a call they cannot check.** On Claude Code 2.1.295 or
  later, both guard hooks block the call whenever they cannot answer: no usable Node, the guard
  process crashes or times out, or it prints invalid JSON output. On any Claude Code version they
  also block it on a Node from 14.8 up to 20.11.0, with the Node message: "Dethereal needs Node.js
  20.11.1 or newer (found <version>), so its secret-guard can't check this call and blocks it.
  Update Node, or turn the Dethereal plugin off with /plugin." (`config-guard` for the config
  guard). On such a Node every guarded call (Read, Grep, Bash and every file write) is blocked
  until Node is updated or the plugin is turned off. Older Claude Code versions ignore the setting
  that makes a guard's failure block, so before 2.1.295 a guard that cannot start, crashes or
  times out, or a Node older than 14.8, still lets the call through: Claude Code 2.1.295 or later
  is required. On Codex and OpenCode a guard that fails refuses the call. When Codex's hook
  runner finds Dethereal's runtime unusable (tampered, missing or unverifiable), it judges a shell
  command by name; OpenCode does so when the guard cannot start at all, and then refuses a read, a
  search or a write (see the two guard entries under Security).
- **`@dether.net/dethereal` 0.5.2: the platform URL is a plugin setting, and its default is now
  `http://127.0.0.1:3000`.** 0.4.x read `DETHERNETY_URL` and otherwise used
  `http://localhost:3003`. On Claude Code the plugin now has a `platform_url` option, which Claude
  Code keeps in its settings for every project of the user and passes to the server; it defaults
  to `http://127.0.0.1:3000`, and the installer sets it with `--platform-url`. On Codex and
  OpenCode the installer writes the URL into the server's configuration. A `DETHERNETY_URL` set in
  the environment still wins everywhere. `auth_status` says where the URL came from (`env`,
  `user_config` or `default`). Plain `http://` is still accepted only for `localhost`,
  `127.0.0.1` and `::1`. Sign-ins are still kept per platform address (scheme, host and port), so
  if the address the server now uses is not the one you signed in to, `localhost` and `127.0.0.1`
  counting as different, sign in again with `/dethereal:login`.
- **`@dether.net/dethereal` 0.5.2: `logout` also revokes the session at the identity provider.**
  0.4.x deleted only the local copy of the session, which stayed valid until its refresh token
  expired. `logout` now removes the local session first, then revokes its refresh token at the
  identity provider of the session's own platform, and reports each session in `revocation` as
  `revoked`, `skipped` or `failed`, with the reason. It skips the revocation, and says so, when the
  platform's configuration cannot be fetched, or when the server's configuration or runtime cannot
  be trusted with the session. A revocation call that is refused or fails is reported as `failed`,
  and the session stays valid at the provider until it expires.
- **`@dether.net/dethereal` 0.5.2: `import_model` resolves controls strictly.** A push used to
  link a control reference to a loose name match — case-insensitive or partial — or drop a
  reference it could not resolve with only a warning. It now links a reference only by its id or by
  a name exactly one catalog control has, and otherwise refuses the push before anything is
  written: the error reads "Control references could not be resolved; nothing was pushed" (or
  "Element ids must be unique in the model; nothing was pushed"), with `codes` and up to 100
  `control_errors` naming each entry. A successful push returns `resolved_controls`, the controls
  linked to each element. `create_threat_model` and `update_model` push the same way. `import_model`
  then writes the ids it linked into each controls list the files still hold as pushed; nothing is
  pinned when the files keep their reference ids or the id write-back failed.

  **Upgrading:** a model that pushed before may now be refused. Give an ambiguous or loosely named
  reference the control's id, or its exact catalog name, and push again.
- **`@dether.net/dethereal` 0.5.2: reading security data has its own read-only tools.**
  `query_controls` (`list`, `get`, `rank`), `query_exposures` (`list`, `get`) and
  `query_countermeasures` (`list`, `get`) never change the platform, so they run without an
  approval prompt. `manage_exposures` is removed; `manage_controls` no longer takes `list`, `get`
  or `rank`, and `manage_countermeasures` no longer takes `list` or `get`. Their write actions are
  unchanged and still ask for approval.

  **Upgrading:** the plugin's own skills and agents already use the new tools. Another MCP client
  that called a removed action should call the matching `query_*` tool with the same inputs; the query tools check ids and filters more strictly and reject unknown fields. Each
  `list` also takes an optional `limit` (default 100, at most 500), reports the full count as
  `total`, and sets `truncated` when it cut the list.
- **`@dether.net/dethereal` 0.5.2: `get_classes` answers in pages, and `match_classes` no longer
  counts a match by type alone.** `get_classes` used to return every matching class at once. It now
  returns a page of at most `limit` classes (default 100, at most 200), which also stops at 24,000
  characters, in a stable order, with `total`, `truncated`, `next_offset` and `listing`, a short
  hash of the matching class ids that changes when the catalogue does; call again with `offset` set
  to `next_offset`. A truncated page also gives `remaining_modules`, the modules the later pages
  hold classes of, and a `note` naming them (up to ten) with the call for the rest. A class larger
  than a page comes alone, marked `oversized`. `attributes` and `guide`, asked for or implied by
  leaving out `fields`, need `class_id`, `name` or `category`; `view: 'modules'` lists the installed
  modules with their class counts per type; and `PROCESS`, `EXTERNAL_ENTITY` or `STORE` as
  `class_type` selects component classes of that type. In `match_classes`, an element whose only
  candidates are classes of its type is listed in `unmatched` and, with the `class_type` to list
  its candidates by, in `unmatched_type_only`, beside a `hint` to choose among the module's classes
  or leave the element unclassified; `matched_count` no longer counts it. Each candidate's
  description is cut to its first sentence, and the module is said once at the top when every
  candidate shares it.

  **Upgrading:** another MCP client that read every class in one call should follow `next_offset`
  until `truncated` is false, and fetch `attributes` or `guide` by `class_id`.
- **`@dether.net/dethereal` 0.5.2: the server derives `manifest.json`'s `modules`.** The list is
  the modules `manifest.json` already lists, the scope's `activeModules`, and the module of every
  class the model uses, deduplicated by id. Derivation only adds: a module leaves the list only when
  it is edited out, and an update push sets the platform model's modules to exactly this list. A
  class's module comes from its class-cache entry, which `generate_attribute_stubs` now records as
  `module: { id, name }`, else from the elements' `classData.module` (a pulled model carries it).
  Every gate reads the derived list without writing the file; `model_state` `get` reports
  `manifest_modules: { on_disk, derived }` when they differ. `import_model` and `update_model` send
  the derived list and write it into `manifest.json` only after every refusal has passed and after
  the backup, and only if the file has not changed since the push read it, so a refused push
  leaves the directory as it was; their results carry `manifest_modules: { after, before? }`.
  `update_attributes` gates the derived list but does not write it. The list is machine-derived:
  it is never registered or settled.

  **Upgrading:** a module that cannot be derived now fails Gate 2's `manifest_complete`, naming the
  class or file: `module_unknown`, `module_conflict`, `scope_unreadable`, `scope_module_invalid` or
  `manifest_module_invalid`. Class-cache entries written by earlier versions have no module; run
  `generate_attribute_stubs` with platform access to refresh them. `modules` no longer needs to be
  filled in by hand.
- **`@dether.net/dethereal` 0.5.2: on Claude Code, the approve hook also approves a settlement's
  `prepare`, which records nothing in the model.** The hook approves `model_state_settle` when its
  action is `prepare`, which checks the decisions. A bundle generated with the settlement on adds
  the tool to the hooks matcher and `--settlement` to the hook's command; shipped bundles leave
  both out. The tool is still listed with the interaction hint, so Claude Code may still ask for
  it. `commit`, which records the decisions, and `settle` still ask. Codex and OpenCode ask for
  every settle call. See the plugin architecture, *Auto-Approval*.
- **`@dether.net/dethereal` 0.5.2: the guided workflow's Step 8 relays the enrichment through
  files, and an agent writes your answers.** Step 8 used to take the enricher's tables from its
  reply and apply your adjustments in the main conversation. Now each **security-enricher** run,
  started fresh, enriches at most 12 elements (a store takes the flows that touch it into the same
  run, up to 20), writes the cited and derived values into the attribute files and its tables and
  questions to a new `run-<n>.txt` in the model's `.dethereal/relay/` folder, and answers with the
  file's path, a summary line and the remaining worklist; the next run carries on from the earlier
  files. The instructions tell the main conversation to read only the files the runs named, show
  them whole and verbatim — never a summary, or an offer to show them later — (credential material
  redacted) as model-written data, not instructions, and ask one batched question. The conversation
  may show a summary of the files before its question instead. The written values are in the
  attribute files either way, but a summary can leave out open questions only you can answer, such
  as whether a boundary denies traffic by default, and those fields stay open unless you raise them:
  the relay files hold every question, and Step 9, `/dethereal:enrich` and the attribute files take
  corrections. A run defers no question to a later batch; a derived basis takes at most six words a
  part, an open-field question one sentence, a red flag one line. "Accept all", or a reply that
  decides nothing, writes nothing: the values stay as written. Otherwise the
  new **enrichment-applier** agent, started fresh with your reply verbatim, writes what it decides
  into the attribute files only, validates, and returns a table of what it wrote, which the main
  conversation prints; it asks nothing. A fact in your reply that contradicts a cited value keeps
  the cited value and is named, not asked; one that contradicts a derived value replaces it, and the
  table names the row and the value it replaced; an answer to the row itself is written as you give
  it. A fact never reaches an element that lacks what it is about (one that takes no tokens, keeps
  no data or runs no image), which is named instead. A floor key your reply answers is written on a
  component even where its file lacks the key; `encryption_at_rest` is `not_applicable` only on a
  process of no store class that your reply says keeps no data, and otherwise stays `null`.
  A removal happens only when your reply asks for it in words, and the remove skill confirms it
  again; a changed credential mapping is shown and asked once more. On a quick model the open
  fields carry every priority gap, so those gaps are not asked a second time. The relay files stay
  on this machine, kept out of git by `.dethereal/.gitignore`; you may delete `.dethereal/relay/`
  by hand whenever no Step 8 is running.
- **`@dether.net/dethereal` 0.5.2: on Claude Code, the guided workflow asks independent questions
  together.** A guided run used to ask about 23 questions one at a time. Questions whose answers do
  not depend on each other now come as one dialog, with every member's table shown first:
  discovery's list confirmation, blind spots and module selection; review's model confirmation,
  boundary hierarchy and operational flows; a data-item gap with its gap-fill confirmation; and
  documentation claims, three documents to a dialog, each document's answer registered on its own. A
  dialog that would exceed 800 characters a question or 2,400 in all is asked one question at a
  time. The answers apply in order: an unanswered member stops the rest and is asked again alone, a
  dismissed dialog is asked again one question at a time, and a member whose table or question an
  earlier answer changes is asked again alone. The trust, crown-jewel, approved-channel and
  restricted questions are never grouped. A dialog's question is the workflow's question text word
  for word, never shortened, and is not repeated in the message. Codex and OpenCode still ask one
  question at a time.
- **`@dether.net/dethereal` 0.5.2: a new threat model is a quick model by default.** A model
  that a `/dethereal:threat-model` run starts (from a system description or with no model at all),
  or that `/dethereal:create` makes by describing, from a template or by import, is a quick model
  unless the run has `--full`; a model pulled from the platform is a full model. A quick model is a
  first pass you deepen later: Steps 1–7 of the guided workflow run in full, Step 8 enriches only
  the priority set with the control pass deferred, and Step 9 is read-only, with no Gate 3 verdict.
  It is marked quick (its state reads, for example, `ENRICHING (quick)`), is never REVIEWED, and
  can be pushed; its README opens with a "Quick model, not reviewed" banner. `--full`, on either
  command, gives the full run from the start; `/dethereal:create` now takes it, and on a quick
  model its footer adds an `[info]` line naming `/dethereal:threat-model` to continue it and
  `--full` to build it in full. On a quick model, `/dethereal:threat-model --full` deepens it: the
  mark is cleared and, once the quick run has passed Step 7, the run resumes at Step 8 with the
  full scope, then the full review; a quick run stopped before that resumes where it stopped. When
  the step it takes up is Step 7 or later, a Step 6 classification pass runs first. A
  run without a mode flag on an existing model keeps its mode, so a quick model, created or paused,
  continues as a quick run, and an earlier full model continues as a full run.
  `/dethereal:threat-model --quick` makes a quick model explicitly, also by marking an existing
  model when the run starts; on a REVIEWED model it is refused. `--full-scan`, a full discovery in
  place of the drift check, is a separate flag.

  **Upgrading:** add `--full` to start a model with the full run, whether with
  `/dethereal:threat-model` or `/dethereal:create`, or to deepen a quick model.

- **The operation category comes first on the Attributes tab.** On a component or boundary,
  **Operation & version** or **Operation** now comes first on the **Attributes** tab rather than
  last: the first panel, closed, in the default view, and the first tab, open by default, when the
  form is switched to tabs. For module authors, `runContractSuite` in
  `@dethernety/dt-module/testing` now expects a served template to have the category first. Guide
  entries stay appended after the class's own.

- **A served component or boundary template keeps only plain uischema scopes.** For module authors:
  `withOperationFields` now keeps a uischema element with a `scope` only when the scope is a plain
  chain of `#/properties/<key>` with no key under the reserved `dethernety_` prefix. Any other
  element with a scope no longer appears in a served component or boundary template, whatever its
  type: one with a combinator, brackets, a root scope or a reserved key. This holds at any depth
  under `elements` and in any option whose value is an object, such as `options.detail`. An element
  whose `elements` is not a list goes as well, and so does a layout or category left empty. An
  option left empty is removed while its element stays. A template without `schema.properties` or
  without a root `Categorization` gets no operation fields, and is held to the same rule. In
  `DtFileOpaModule`, a template that parses but cannot be extended now fails the read rather than
  being served unread; text that does not parse is still returned as it is.

### Removed

- **`@dether.net/dethereal` 0.5.2: the `merge-from-file` verb is gone from the `/dethereal:sync`
  control-library review.** Reading a staged file into the session could bring key material or
  other secrets into it, and the checks on that file could not be done safely without a shell. The
  `.dethereal/merge-staging/` folder is no longer used; if you created one, you can delete it and
  its `.gitignore` entry.

  **Instead:** give a long value with `merge <n>.<key> = <json>`, pasted as one JSON literal; a
  multi-line paste carries it whole.

### Fixed

- **`@dether.net/dethereal` 0.5.2: enrichment keeps to its evidence rules, and a quick run reads
  less.** A control is written as not in force only when the condition it guards occurs on the
  element and the complete enforcement point for the path (the plugin list, the middleware, the
  handler with its exception branches) was read without the check. A check another component on the
  path may hold, such as a gateway or a sidecar, stays `null` until that component is read too; a
  check that some path skips is not in force, with the bypass cited; a search that found nothing
  proves nothing. A data item is enriched with the store that persists it, reading the code that
  writes it. A volume's encryption (`encrypted_at_rest`) and the item's own unreadability (such as
  `pan_rendered_unreadable`) are separate fields: card numbers kept as plaintext in an encrypted
  database are encrypted at rest and not rendered unreadable. Across several stores the weakest
  wins, and a store whose value is unknown leaves the item's value `null`. The priority set includes
  every data item with a regulatory flag, and a quick run's worklist names the data items mapped to
  a crown jewel or carrying one. Two opposite values read from the same cited line are a divergence,
  and neither is written. A component split out of a process, such as a second listener, an admin
  interface or a worker, gets the outbound calls its own code makes as its flows, and Step 5 lists
  every process with inbound flows and no outbound flow. A manifest outside its kustomization's
  `resources`, or commented out, is not modelled. On a full model, Step 6's classification pass runs
  also when every element is classified (a quick model may skip it, see Added), and proposes a
  reclassification only where cited evidence contradicts the current class. Step 6 never lists the
  model's root boundary, and asks the classification-gap question only for elements other than it
  and those left unclassified at Step 3. A discovery re-run keeps the keys an earlier run wrote to
  `.dethereal/discovery.json` beside its own (`left_unclassified`, `dropped_classes`,
  `shared_credentials`, `privilege_transitions`). A log or metrics destination, or a log-watching
  tool, the source configures for a component is written to `monitoring_tools` as the source names
  it, cited, and whether anyone watches it is not asked. The enricher reads a class's fields from
  `get_classes`' `enrich` view instead of the class cache. A quick model's build reads no worked
  examples, and a phase re-entry reads a model file again only after a compaction, a write the edit
  tool did not make, or a fix made by hand. At a question that removes, deletes or publishes, a
  reply that picks no choice, a dismissal included, now declines it and is not asked again.

- **dt-ui reads the zone the model's root boundary declares.** `DtModel.dumpModelData` left the
  root boundary's `zone` out of what it returned, so when dt-ui loaded a model, every boundary
  inheriting from the root read the default `INTERNAL`: no zone pill on the canvas, and *Unset →
  default Internal* in the boundary zoning overview. The threat report read the root's declared
  zone, so the two disagreed. These boundaries now read what the root declares. A root that declares
  nothing still reads the default.

- **`@dether.net/dethereal` 0.4.21.** A version-only release that carries the dt-core fix above
  into the plugin, which bundles dt-core. No plugin change.

### Security

- **`@dether.net/dethereal` 0.5.2: the control audit log no longer records attribute values, and
  is no longer committed.** `.dethereal/control-audit.log` used to record the Control attribute
  values a shared-ownership push touched verbatim, and was meant to be committed — so a secret
  written as a Control attribute ended up in the repository's history. Each entry now keeps a tag in
  place of every value: an HMAC-SHA256 under a key that exists only on this machine, which tells
  "changed / same value as that entry" there and nothing anywhere else. Entries carry
  `schemaVersion: 2`; with no usable machine key the values are left out and the push goes ahead.
  The entries a push returns as `auditEntries` are the same tagged entries. The log now stays on the
  machine, ignored like the other per-machine files in `.dethereal/`; the platform keeps the
  authoritative record of a cross-model write. The Control files (`controls/<id>.json`) still hold
  the attribute values, as part of the model.

  **An older `.dethereal/control-audit.log` may hold values verbatim** (entries without
  `schemaVersion`); they are never rewritten. Delete or rotate it. If it was committed, untrack it
  with `git rm --cached .dethereal/control-audit.log` — an ignore rule does not untrack a file that
  is already committed — and note that the old values remain in the repository's history.
- **`@dether.net/dethereal` 0.5.2: the control audit log no longer records your git email or local
  user name.** Each `.dethereal/control-audit.log` entry, and each entry a push returns as
  `auditEntries`, used to carry an `operator` field: the model repository's `git config user.email`,
  or `<user>@unknown` from the local user name when none was set. The log stays on your machine, so
  that self-asserted identity added nothing over the platform login; the only attribution now is
  `authnOperator`, the platform login's email (or subject), or `unauthenticated` when there was no
  usable token. The plugin no longer reads git's `user.email` at all. In `dt-core`,
  `getOperatorEmail` is no longer exported and `pushBrownfieldControl` no longer takes `operator`.
  Older entries are not rewritten and may still carry `operator`; `schemaVersion` stays `2`.
- **`@dether.net/dethereal` 0.5.2: a new config guard keeps an agent from widening what runs, git's
  configuration included.** 0.4.x had no such hook. On every harness, an agent's write, edit or
  patch of a harness's configuration (Claude Code's settings, Codex's `config.toml`, OpenCode's
  `opencode.json`), at project and user level, is denied when it adds a Dethereal or wildcard
  allow rule or a bypass mode, weakens a deny or ask rule, changes the hooks or the MCP servers, or
  disables the plugin. A skill, command or agent definition under `.claude/`, `.codex/` or
  `.opencode/` that would grant a Dethereal tool or a wildcard of tools is denied, and so is any
  write into OpenCode's plugin folders. Claude Code's settings (`settings.json`,
  `settings.local.json`, and the per-project settings in `.claude.json`) are held further: an edit
  is also denied when it changes anything in `env`, which every process Claude Code starts reads,
  the plugin's server and hooks among them (a change to `DETHEREAL_SETTLEMENT`, in any spelling,
  gets its own refusal); changes a setting that runs a command or decides what runs
  (`statusLine`, `apiKeyHelper`, `otelHeadersHelper`, `awsAuthRefresh`, `awsCredentialExport`,
  `fileSuggestion`, `sandbox`, `extraKnownMarketplaces`); adds an allow rule for Bash in any form,
  `Bash(npm test)` included (rules already in the file stay); enables a plugin, or changes whether
  the Dethereal plugin is enabled; changes the Dethereal plugin's options in `pluginConfigs`, its
  platform URL among them; or sets the permission mode `auto`, `bypassPermissions`, `acceptEdits`
  or `dontAsk`. Claude Code's plugin cache (`.claude/plugins/`, and `plugins/` under
  `CLAUDE_CONFIG_DIR`) is denied by path, whatever the file. On every harness, so is git's
  configuration: below a `.git` folder, `config`,
  `config.worktree`, `commondir`, `gitdir`, anything under `hooks` and `info/attributes` (a
  submodule's and a work tree's too), a `.git` file itself, and the user's `~/.gitconfig` and
  `git/config` and `git/attributes` in XDG's configuration folder; `.gitattributes` and the
  project's own files are not affected. Paths are judged as written and through links, with letter
  case folded as macOS and Windows disks fold it. Beside it, the secret guard refuses a shell
  command whose `git` sets a key that makes git run a program, now or when the operator next runs
  it: a `git -c` or `--config-env`, a `git config` write or `--edit`, `--exec-path`, an `init` or
  `clone` with `--template`, or an environment equivalent such as `GIT_PAGER`, `GIT_EDITOR` or
  `GIT_SSH_COMMAND`, for keys such as `core.pager`, `core.fsmonitor`, `core.hooksPath`,
  `diff.external`, `filter.*`, `credential.helper` and an `alias.*` that runs a shell (`!…`). A
  read or a removal of a key passes, and so does a value that runs nothing
  (`git -c core.pager=cat log`). See the plugin architecture, *Config Guard* and *Secret Guard*.
- **`@dether.net/dethereal` 0.5.2: a new secret guard keeps an agent away from secret files, the
  sign-ins and the macOS keychain.** 0.4.x had no such hook. On every harness, the guard denies a
  file read, a search or a shell command that reaches one of the project's secret files (a listed
  name in any case, a `kind: Secret` manifest, or a file a kustomization `secretGenerator` or a
  compose file names as a secret source); the file is reported by name only. It also denies one
  that reaches `~/.dethernety`, the server's own folder, which holds its sign-in, or a
  harness's own sign-in: Claude Code's `.credentials.json` (in `~/.claude` and an absolute
  `CLAUDE_CONFIG_DIR`), Codex's `auth.json` and `.credentials.json` (in `~/.codex` and an absolute
  `CODEX_HOME`), and OpenCode's `auth.json` and `mcp-auth.json` in its data folder. It holds
  outside any project too. A shell command reaches them through the home in any spelling (`~`,
  `~user`, `$HOME`, in full), a link, a `cd` or `pushd` (also where `CDPATH` leads), a `sh -c`
  script, a glob, brace sequence or zsh pattern that spells them, or a second path to the same
  folder, such as macOS's data volume (compared by identity); an assignment before the command
  hides none of these, and after a `cd` the guard cannot follow, later relative paths are judged by
  their text. A folder that holds one, such as the home directory, is open only to commands that
  list names (`ls`, `stat`, `du`, `find` without an action): a content search, copy, archive or
  link of it, or a command that reads what another prints (`ls ~ | xargs cat`), is denied, and so
  is a Grep over it in every output mode, names-only included, since a names-only search's
  patterns can spell out a file's content. The guard also denies a shell command that runs macOS's
  `security` in a way that can print a secret or runs what it is sent: `find-generic-password` or
  `find-internet-password` with `-w` or `-g`, interactive mode, a subcommand the shell builds, and
  every subcommand but those that find or verify certificates and identities, list or show
  keychains, or print help. On OpenCode, when the guard cannot be started at all, a read, a search
  or a write is refused, and a shell command is judged by name inside OpenCode's own process: one
  that names `dethernety`, a guarded folder or a secret file, or that can build such a name with a
  glob or brace near the home, is refused. The project's own `.dethernety/` registry is unaffected.
  The guards judge a shell command by the names it spells; they are not a sandbox: an interpreter,
  a variable, `$(…)` or a file of names can reach a file by a name the guard never sees. See the
  plugin architecture, *Secret Guard* and *OpenCode Plugin*.
- **`@dether.net/dethereal` 0.5.2: on OpenCode, a file a delegation names with `@` is checked like
  any other read.** OpenCode reads each file a delegation's prompt names with `@` itself, when the
  subagent starts, and that read does not pass through a tool the guards see. The plugin checks
  each such file as a read of it would be: the project's secret files, the server's own folder, the
  harnesses' homes, OpenCode's data folder and anything outside the project are refused. A
  delegation that names such a file is not run, and neither is one that names more files than can
  be checked. See the plugin architecture, *OpenCode Plugin*.

## [0.15.0] - 2026-11-04

Elements bound to a remote module's classes are stamped with the class policy at their next save,
when the module's catalog serves a policy hash file for its version. Existing elements are stamped
only when they are saved again: the background re-evaluation after a policy change does not
evaluate a remote module's elements. Component and security-boundary classes gain operation fields:
who operates a component's own software or the environment a boundary hosts, the product, and a
component's version.

A 0.12.x deployment can upgrade straight to this release. An element's stored attribute answers are
rebuilt within fixed limits, and a save now replaces an answer stored in another shape, where before
that answer could make the save be ignored. A dt-ui production build reads its configuration only
from `GET /config`, and does not start when that cannot be read. On a fresh clone, the root `pnpm
dev` no longer fails on the operator console's UI, and `pnpm m-ingest` and `pnpm m-cleanup` always
run.

**Upgrading:** from 0.14.0, `./byodt upgrade` does it (see the operator guide's Operations, *Upgrade
with `./byodt upgrade`*). A 0.13.0 or 0.12.x deployment cannot upgrade itself: there, `./byodt
upgrade` is another name for `update`, and stays on the old release. Upgrade it once with this
release's installer, naming the deployment's folder (see Operations, *Upgrading from 0.13.0* and
*Upgrading from 0.12.x*):

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://github.com/dether-net/dethernety-oss/releases/download/v0.15.0/get-byodt.sh \
  | sh -s -- --upgrade --dir /path/to/your/deployment
```

From then on, `./byodt upgrade` does the next upgrade. **From 0.12.x**, `byodt` cannot tell which
shipped files you edited: it replaces an edited one without asking and keeps it in the upgrade's
backup, so move local changes into `compose.override.yaml` first. A deployment that skips releases
reads the notes at the head of each skipped release in this changelog (*Upgrading*, *Operators* and
the others), so 0.13.0 to 0.15.0 also reads 0.14.0's, and 0.12.x to 0.15.0 those of 0.13.0 and
0.14.0. **On Memgraph with `podman-compose`**, the graph backup of an upgrade from 0.13.0 or 0.12.x
is taken by the old release's `byodt`, and it fails there: take the snapshot by hand and add
`--skip-graph-backup` to the installer command above (see Operations, *Upgrading on Podman*).

**Module authors:** `@dethernety/dt-module` is 0.15.0. A module whose manifest declares
`compatibility.dtModule` must move it to `^0.15.0` to be packaged against it: a caret on a 0.x
version pins the minor, so `scripts/package-module.js` refuses `^0.14.0`. `@dethernety/dt-module`
gains the `./policy-hash` export, the optional `DTModule` method `evaluatesWithCallerTokenOnly()`,
the knowledge-graph fields `KgAttribute.side`, `KgRule.policyHash` and `KgClient.version`, the
operation-field constants and helpers, and the flat-key functions at its root;
`@dethernety/dt-core` gains the `./operation-determination` and `./flat-keys` exports (see *Added*).
`DbOps` now rebuilds an element's attributes within the flat-key limits (see *Fixed*). An
implementation of the knowledge-graph client must now return both new payload fields and declare
`version`. A class must not define attributes under the reserved prefix `dethernety_`: the platform
drops any it finds and serves its own. In `@dethernety/dt-module/testing`, the template and guide
fixtures change shape, `guideResponse.guide` is typed `unknown`, and `runContractSuite` expects the
operation fields on a served template and guide (see *Changed*).

**API callers:** `setInstantiationAttributes` now refuses, with `VALIDATION_ERROR`, a key the
rebuild would leave out, on its own or merged into the stored answers, or one not in its plain form
(see *Fixed*).

**Dethereal users:** `@dether.net/dethereal` 0.4.20 has no changes of its own. It bundles dt-core,
so its model export rebuilds attributes within the new limits (see *Fixed*). Dethereal is published
separately from this release.

**Building from source:** use Node.js 22.12 or later; `pnpm install` now stops on an older one (see
*Changed*). If you copied dt-ui's `env.template` to `.env.local` before, copy it again, or add the
`VITE_` prefix to your keys: the old template's keys had no `VITE_` prefix, so the dev server read
none of them (see *Fixed*).

### Added

- **`@dethernety/dt-module/policy-hash`, also exported from the package root.**
  `policySourceHash(fileText)` computes the `policyHash` a file-backed module reports for a class:
  the sha256 hex of its `policies.rego` text with surrounding whitespace trimmed, decoded first when
  it is base64-encoded. `decodePolicySource(value)` is that decoding step. `NO_POLICY_HASH` is the
  hash of the empty source, which a class with no policy reports. `POLICY_HASH_ALGORITHM`
  (`policy-source-sha256/1`) names the computation wherever its values are served. The module
  depends on `node:crypto` only. `DtFileOpaModule` uses it.
- **A remote module reports its classes' `policyHash`.** `DtRemoteModule` reads the policy hash
  file of its pinned version from the catalog
  (`GET /v1/catalog/modules/{key}/versions/{pin}/policy-hashes`) together with the module document,
  and keeps it in its cache beside the document. `getMetadata` and `getPolicyHash` report a class's
  hash only while the module is registered from its configured pin, the version it evaluates with;
  a module serving another pin's cached document reports none. A missing file (`403` or `404`), an
  outage, a timeout, or a file that names another module, version or algorithm or holds a malformed
  hash all count as no hashes: the classes report none, and their elements are left without a stamp
  at their next save. None of these is cached, so a file published later is read at the next start.
  A cached file that fails these checks is removed and the file is fetched again. The module waits
  at most 3 s for the file, on a live fetch as on registration from a cached document. A
  `policyHash` the module document carries itself, in any class array, is not reported.
- **`evaluatesWithCallerTokenOnly?(): boolean` on `DTModule`.** Optional, `false` when absent. A
  module returns `true` when `getExposures` and `getCountermeasures` need the caller's token and
  refuse a call made without one. `DtRemoteModule` returns `true`.
- **`KgAttribute.side` and `KgRule.policyHash` in the knowledge-graph client**, in local and remote
  mode and in `KG_REMOTE_SDL`. `side` is `'runtime'` (the environment the element runs in),
  `'build'` (the element's own software) or `null` (not marked, read as configuration); any other
  stored value reads as `null`. `policyHash` is the `policyHash` of the class policy the rule was
  derived from, or `null` when the rule was recorded without one. Both keys are always present.
- **`KgClient.version` in the knowledge-graph client.** `readonly version: string | null` names
  the knowledge-graph version the client is pinned to, so a consumer can say which version
  answered. In remote mode it is the `sha256:` content digest from `MODULE_KG_VERSION`. In local
  mode it is `null`: the graph is the deployment's own, so nothing is pinned. When a service is
  configured with an absent or malformed pin, no knowledge graph is reached and the client reports
  `null`; a rejected value is never echoed. An implementation of the knowledge-graph client must
  now declare the field. A consumer that may run against an older `@dethernety/dt-module` reads it
  defensively and treats a missing `version` as `null`.
- **Policy hash fixtures in `@dethernety/dt-module/testing`.** `POLICY_HASH_GOLDEN_POLICY` and
  `POLICY_HASH_GOLDEN_HEX` are a `policies.rego` text and the hash every producer of a `policyHash`
  must compute for it. `policyHashesResponse`, `MockContentServer.setPolicyHashes(mode)` and the
  `PolicyHashesMode` type drive the mock's policy hash route. `runKgContractSuite` and
  `runKgClientSuite` check `side` and `policyHash`, with the fixtures `KG_POLICY_HASH` and
  `KG_UNMARKED_READ`.
- **Component and security-boundary classes gain operation fields.** The Attributes tab ends
  with an **Operation & version** panel on a component and an **Operation** panel on a boundary.
  **Operated by** (`CUSTOMER` or `VENDOR`, no default) says who builds or runs a component's own
  software, or who runs the execution environment of what is drawn directly in a boundary.
  **Product** (up to 200 characters) names the vendor and product. **Version** (up to 64
  characters) is on components only and is hidden while the operator is `VENDOR`. The values are
  stored like any class attribute and are removed with the class. Class policies do not read them,
  and a remote module does not send them to its content service. The fields come with the module
  implementations in `@dethernety/dt-module`, so no module needs a change or a rebuild. See the
  component configuration guide, *Operation & version*.
- **Operation-field exports from the root of `@dethernety/dt-module`.** `OPERATION_OPERATOR_KEY`
  (`dethernety_operated_by`), `OPERATION_PRODUCT_KEY` (`dethernety_product`) and
  `OPERATION_VERSION_KEY` (`dethernety_product_version`) are the field keys, and
  `RESERVED_ATTRIBUTE_PREFIX` (`dethernety_`, exact case) is the prefix reserved for them.
  `OPERATOR_VALUES` is `['CUSTOMER', 'VENDOR']`, `OPERATION_FIELD_KEYS` the keys served per class
  type (`component`, `securityBoundary`, the type `OperatedClassType`), and
  `OPERATION_CATEGORY_LABEL` the panel label per class type. The constants are frozen.
  `withOperationFields(template, classType)` and `withOperationGuide(guide, classType)` return a
  parsed template or guide without its own reserved entries and with the class type's fields
  added, or the input unchanged. `withoutReservedAttributes(attributes)` returns the attributes
  without any reserved key. `DtFileOpaModule` and `DtRemoteModule` use them.
- **`@dethernety/dt-core/operation-determination`, also exported from the package root.** A module
  with no I/O that holds the same constants and resolves who runs an element from the attribute
  bags of its class edges. Its types are `OperatorValue`, `OperatorReading`, `OperatorSource`,
  `OperatorResolution`, `HostingParent`, `HostingResolution`, `OperationAttributeBag`,
  `OperationSide` and `OperationParty`.
  - `readOperator(bags)` returns the operator the bags declare, `null` when none answers, or
    `CUSTOMER` with source `invalid` for a value outside `OPERATOR_VALUES`, a list or object value,
    or bags that disagree.
  - `operatorOf({ bags, effectiveZone })` returns the element's own operator, else `VENDOR` when
    its effective zone is `VENDOR`, else `CUSTOMER`.
  - `hostingOf(parent)` returns the operator a classed direct parent boundary declares, with its
    `boundaryId`, else `CUSTOMER` with source `undeclared`. The model's default boundary never
    hosts.
  - `resolveFlowOperator(ends)` returns `VENDOR` when a flow has ends and every end resolves
    `VENDOR`, else `CUSTOMER`, with the weakest source among its ends.
  - `sideHolder({ kind, operator, hosting, side })` returns `customer` or `vendor`: who holds the
    `configuration`, `build` or `runtime` side of an element.
- **Template and guide overrides in `MockContentServer`.** `setTemplate(template)` and
  `setGuide(guide)` set the template or guide every class is served, for a module's own tests.
  Called without an argument, or after `reset()`, the mock serves the fixtures again. The shared
  contract suite does not call them.
- **`@dethernety/dt-core/flat-keys`, also exported from the package root, and the same exports from
  the root of `@dethernety/dt-module`.** `unflattenFlatKeys(flat, { padLists, leaf })` rebuilds flat
  attribute keys (`name`, `name.part`, `name[3]`) into a nested value within fixed limits (see
  *Fixed*) and returns `{ value, dropped }`; `dropped` lists each key left out, with the reason.
  `flatKeySegments(key)` returns a key's parts as the rebuild reads them, or why the rebuild leaves
  the key out on its own. `FLAT_KEY_MAX_INDEX`, `FLAT_KEY_MAX_LIST_SLOTS` and
  `FLAT_KEY_MAX_SEGMENTS` are the limits. The types are `FlatKeyProblem`, `DroppedFlatKey`,
  `UnflattenOptions` and `FlatKeySegment`. `@dethernety/dt-module` has no `./flat-keys` subpath. It
  is CommonJS and holds its own copy of the code, since it cannot load the ESM-only dt-core at run
  time.

### Changed

- **The `@dethernety/dt-module/testing` fixtures and contract suite carry the operation fields.**
  The `templateResponse` fixture's `uischema` root is a `Categorization` holding one `Category`,
  where it was a `VerticalLayout`. `guideResponse.guide` is a list of
  `{ option_name, option_description }` entries, where it was an object keyed by attribute. The
  `guide` field of its type, `GuideResponse`, is `unknown` instead of `Record<string, unknown>`, so
  TypeScript code that indexes `guideResponse.guide` needs a cast. `runContractSuite` now expects a
  served template to be the fixture with a component's operation fields added (the fields after
  its own properties, one category last), a served guide to be the fixture with one entry per field
  appended, and the fallback for an unentitled caller not to contain `dethernety_`.

- **The background re-evaluation after a class policy change skips more bindings.** It leaves out
  the bindings of a module whose `evaluatesWithCallerTokenOnly()` returns `true`, since it runs
  with no caller, and the bindings of a module that is not loaded. Both count as `skipped` in the
  sweep's summary line; a binding whose module is not loaded was counted as `failed` before. The
  elements of a module that evaluates only with a caller's token are stamped at their next save.
- **A save or binding change whose evaluation the module cannot tie to the class's current policy
  now removes the element's earlier policy stamp for that class**, instead of keeping it, so an
  earlier stamp does not go on vouching for findings evaluated under another policy. This covers a
  class with no `policyHash`, and a module whose `getPolicyHash` answers another hash, none, or
  throws. Only the stamp is removed: findings and their dispositions are not touched, an element
  with no stamp for the class is not written, and Issues are neither stamped nor unstamped. The
  background re-evaluation picks up such a binding when its class has a `policyHash`; a binding of
  a module that evaluates only with a caller's token is stamped at its next save the module
  vouches for.
- **A remote module whose version serves a policy hash file is installed once more at the first
  start after the upgrade.** Its class nodes do not yet hold the hashes it now reports, so the
  class policy hash check installs it in full.
- **The Node.js floor is 22.12.** The root `package.json` declares `engines.node` as `>=22.12.0`,
  where it declared `>=18`: vite 8 and its Vue plugin need `^20.19 || >=22.12`. pnpm enforces the
  root project's engines on install, so a setup on an older Node.js now stops at `pnpm install`.
  Some dependencies declare a higher floor (`@babel/types` 8, which `vue-router` 5 pulls in,
  `^22.18 || >=24.11`; `eslint` `^22.13`; `testcontainers` `>=22.22`). The root floor does not
  follow them: on install they only print an engine warning, and a higher root floor would refuse
  a setup that builds and runs. A current release of Node.js 22, 24 or 26 LTS is recommended, and
  running the test suite needs 22.22.2+ or 24.15+. The README, CONTRIBUTING, the dt-ws README and
  the backend architecture page state the same floor.

### Fixed

- **`DtFileOpaModule` reports one hash for a policy registered on first use.** When a class's
  policy was not registered at load, evaluation registers it from the file; it now trims the file
  as `getMetadata` does, so `getPolicyHash` agrees with the metadata's `policyHash`. Before, a
  policy file ending in a newline registered this way reported another hash, and the element was
  not stamped at its save.
- **An upgrade from 0.12.x no longer stops at its database check.** A 0.12.x deployment keeps the
  `db` service in `compose.yaml` and has no `compose.memgraph.yaml`, and the new release's `byodt`
  could not read that layout before its own files moved in. The installer's upgrade then stopped
  with `The database is not running, so the graph cannot be backed up first`, although the
  database was running, and pointed to `--skip-graph-backup`. With a `compose.override.yaml`, it
  also warned that it could not read that file. `byodt` now reads a 0.12.x folder as 0.12.x laid
  it out until the move: 0.12.x's own `byodt` backs up the graph, the files move in,
  `DB_ENGINE=memgraph` is recorded in `.env`, and the printed rollback steps bring 0.12.x back. A
  compose file missing for any other reason still stops the command, and the file is named: the
  upgrade's check says, for example, `compose.memgraph.yaml is missing here, so the upgrade cannot
  check the database`, and no longer points to `--skip-graph-backup`. 0.14.0's installer still
  stops at the database check on 0.12.x: upgrade a 0.12.x deployment with this release's installer
  or a later one's.
- **A fresh clone's root `pnpm dev` no longer fails on the operator console's UI.** The UI under
  `apps/byodt-console/ui` is a self-contained package with its own lockfile, outside the workspace,
  so the root `pnpm install` does not install it, and the console's `dev` script failed the whole
  `pnpm dev`. The script is now `dev:ui`, which the root `pnpm dev` does not run. The console
  architecture page gives the two commands that install the UI and start its dev server on its own.
- **`pnpm m-ingest` and `pnpm m-cleanup` are no longer cached by turbo.** Both act on a database
  turbo cannot see and declared no outputs, so a second run replayed a cached success: MITRE data
  was silently not loaded into a new, empty database. They now run every time, and the README's
  from-source section drops its `pnpm m-ingest --force` workaround.
- **A dt-ui production build no longer falls back to build-time values when `GET /config` fails.**
  It fell back to its build-time `VITE_` values, so a build with `VITE_ENABLE_NOAUTH=true` and no
  `VITE_OIDC_ISSUER` baked in switched the UI's sign-in off whenever `GET /config` could not be
  read. It now reads its configuration only from `GET /config`. When that cannot be read (request
  failure, non-OK status, non-JSON body), the UI reads it once more about a second later. If that
  also fails, the UI does not start and shows a "The platform's configuration is unavailable"
  screen. **Try again** reloads the page that was opened. See the configuration guide, *Frontend
  Configuration (dt-ui)*.
- **dt-ui's `env.template` names the `VITE_`-prefixed keys the dev server reads.** Its header says
  to copy it to `.env.local`, but its keys had no prefix, and the dev server reads only `VITE_`
  keys, so a copy did nothing. The keys are now the ones the development configuration reads.
  `VITE_ENABLE_NOAUTH` is among them, commented out, with the note to comment out `VITE_OIDC_ISSUER`
  when you enable it. The header now says that a production build reads its configuration only from
  the backend's `GET /config` at run time, and that the UI stops on the configuration-unavailable
  screen when that cannot be read. Keys the application reads but does not use yet are marked, and
  `VITE_BASE_PATH`, for a subdirectory base path, is set in the build's shell environment, not in
  the file.
- **`module-manager.sh install`'s help names its defaults correctly, and the module development
  guide installs into the platform.** `--target` and `--state-file` default to `custom_modules/` and
  `installed-modules.json` in the current directory. The help said "next to this script" and named
  no state-file default, and the TypeScript CLI's help named `neo4j` as the default database user,
  where it is `dethernety`. The guide ran the install from the module's folder without `--target`,
  so it installed the module into its own folder; its install step now gives `--target` and
  `--state-file` for `apps/dt-ws/custom_modules`, as the README's from-source setup does.
  `installed-modules.json` is now ignored by git wherever it is written.
- **Flat attribute keys are rebuilt within fixed limits.** An element's answers are stored as flat
  keys (`name`, `name.part`, `name[3]`) and rebuilt into the policy input on every evaluation, into
  the model export, and in the attribute editors. Before, a list index had no limit. The rebuild now
  allows a list index of at most 10000, at most 100000 list entries per rebuild, and at most 32
  parts per key. It takes keys in sorted order, writes only into containers it created, and reads
  own properties only. A key that breaks a limit, has `__proto__`, `constructor` or `prototype` as a
  part, or disagrees with an earlier key is left out whole, so it reads as unanswered. When
  `DbOps.getInstantiationAttributes` leaves keys out, it logs how many, and why.
- **`setInstantiationAttributes` refuses a key the rebuild would leave out.** The request fails with
  `VALIDATION_ERROR` and nothing is written. The message gives one short reason per key and the
  list-total reason once, and stops after 20 reasons with "and N more". A key not in its plain form
  is refused too, naming that form (`a[x]` is read as `a.x`, `l[01]` as `l[1]`), and so is a key
  that starts with a list index. A key sent as `null` is still accepted, so it can be cleared.
- **A save's own shape wins over the keys already stored.** A list can be stored in two shapes: an
  import writes a whole list (`tags`), model and attribute updates write entries (`tags[0]`), and
  neither cleared the other. With both stored, the rebuild keeps the first in sorted order, so an
  update after an import would be ignored. A request that writes a value now locks the element,
  reads the stored answers, and clears in the same write every stored key whose place disagrees with
  a place the request writes, at any depth (a whole list against entries, `p[0]` against `p[0].x`, a
  list against a group). An element holding both shapes heals on its next write. The merge is then
  checked with the rebuild's limits: one that would still leave out a key the request writes, or a
  stored key that was kept before this request (a list total pushed over), fails with
  `VALIDATION_ERROR` and nothing is written. Moving an answer to the other shape with the same
  values flips no disposition stale. A request that writes nothing (an empty one, or one that only
  clears) skips all of this and is never refused.
- **The attribute editors clear the stored keys they no longer send, and a late save leaves the next
  element alone.** The attributes panel, the data dialog and the control dialog keep the stored keys
  as loaded, and each save sends `null` for every stored key it does not send. So an answer the form
  cannot show (a list stored in the other shape by another writer, or a key the rebuild leaves out)
  does not outlive the save. A key named like a built-in (`toString`, `constructor`) is cleared too.
  A save's result becomes the form's baseline only if the same element and class are still shown; in
  the control dialog, only if no class load has started since.
- **A control's attribute saves go one at a time, and a reopen reads what was saved.** The form
  stays dirty until a save returns, so a second save of a class could start while the first was in
  flight, and both worked out what to clear from the answers before either. A class's saves are now
  sent one at a time, each to the control it was made for, and each clears from the answers the
  previous one left: what it saved, or, if it failed, what it was made from. A class reopened during
  a save reads its answers only once every save of that class has settled, and reads them from the
  server, so it does not bring back the answers a save replaced. A class load that returns after a
  later one changes nothing. **Save & Close** closes the form it saved, not one opened since. A save
  that never returns holds back the later saves and a reopen of its class.
- **The navigation drawer shows the email when the identity provider sends no name.** With neither
  `name` nor `preferred_username` in the user info, it showed "Unknown" for a signed-in user. The
  display name now falls back from `name` to `preferred_username` to the email address, and only
  then to "Unknown". A claim that is missing, empty, whitespace-only or not a string counts as
  absent, and the value used is trimmed.

### Documentation

- **A 0.12.x deployment upgrades the same way as one on 0.13.0**: once, with the installer of this
  release or a later one and `--upgrade`, with no need to step through 0.13.0 or 0.14.0 (0.14.0's
  installer stops at the database check; see *Fixed*). 0.12.x keeps no record of the files it
  shipped, so `byodt` cannot tell whether they were edited: it warns, replaces an edited shipped
  file without asking, and keeps it in the backup. On Memgraph with `podman-compose`, take the
  snapshot by hand and add `--skip-graph-backup`, as from 0.13.0. Read the notes at the head of
  0.13.0 and of every later release too (*Upgrading*, *Operators* and the others): an upgrade from
  0.12.x skips them, and nothing checks most of the steps they ask for. See Operations, *Upgrading
  from 0.12.x*.
- **CONTRIBUTING's setup and running steps follow the from-source setup.** Getting Started names
  what a working local setup needs beyond `pnpm install` (the backend and frontend environment
  files, a database, the MITRE data load, and the modules built and installed) and links to the
  README's *From source* section. Running Locally starts the backend and the frontend with
  `pnpm dev --filter dt-ws --filter dt-ui`, and says that the unfiltered `pnpm dev` also starts the
  packages' watch builds.
- **File paths in the public docs are relative to the repository root.** Several pages gave file
  paths that do not exist in the repository: the configuration guide, the module development guide,
  the pre-computed embeddings specification, the class and control resolver specification, the
  module custom resolvers design, the Dethereal architecture pages, and the coverage-tools and
  threat-report pages. Relative links on those pages that pointed one level short, or at a sibling
  folder's files, now resolve.
- **A Quick Start guide, and install docs that say what each way needs.** The Quick Start guide goes
  from install to a first threat finding. The README, the installation guide, the BYODt guide's
  overview and the npm package's README present npx first, recommended where Node.js is already
  installed, with `get-byodt.sh` as the way without it. Their install commands, and the Quick Start
  guide's, name the current release, and `deploy/tests/docs-release-version.sh` keeps them on it in
  CI and in the release workflow. The README's *From source* section gives the steps a fresh clone
  needs. The container requirement is Docker with the Compose plugin, or Podman 4.1+; Docker Desktop
  is one VM-backed runtime.


## [0.14.0] - 2026-11-02

The compose bundle can reach the internet through an outbound HTTPS proxy. Each release now
publishes a signed installer, `get-byodt.sh`, and `get-byodt.sh` from the release is the way to
install. The npm package `@dether.net/byodt` is the same installer, once it is published to npm.
`./byodt setup` is the first run of a new bundle, and `./byodt upgrade` moves a deployment to a
newer release in place. `byodt` and the installer show a third-party notice before the first
download. byodt is 1.4.0.

A control can be applied to a Data element: in the API, in dt-core, in the data dialog and in
Dethereal 0.4.19. The threat report lists a Data element's own controls. A slow remote module now
serves its read-only fallback and stays in service. The settings window no longer saves the wrong
values, drops a class change or shows old attribute values when a save and a load overlap. Database
logins on Memgraph are fast.

**Upgrading:** this is the first release with `get-byodt.sh` and `./byodt upgrade`. A 0.13.0
deployment cannot upgrade itself: 0.13.0's `./byodt upgrade` is another name for `update`, ignores
the version and stays on 0.13.0. Upgrade it once with this release's installer, naming the
deployment's folder, or by hand as before (see the operator guide's Operations, *Upgrading from
0.13.0* and *Upgrading by hand*):

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://github.com/dether-net/dethernety-oss/releases/download/v0.14.0/get-byodt.sh \
  | sh -s -- --upgrade --dir /path/to/your/deployment
```

From 0.14.0 on, `./byodt upgrade` does the next upgrade. **On Memgraph with `podman-compose`**, the
graph backup of an upgrade from 0.13.0 is taken by 0.13.0's own `byodt`, and it fails there: take
the snapshot by hand and add `--skip-graph-backup` to the installer command above (see Operations,
*Upgrading on Podman*). **Signatures:** without a terminal, an upgrade needs `--yes`. Without
cosign, an upgrade given `--yes` or run without a terminal refuses the release unless you add
`--allow-unsigned`; at a terminal, without `--yes`, it asks first. A signature cosign rejects always
stops the upgrade. Install cosign to have the signature checked. To make a missing signature stop
every upgrade, `--allow-unsigned` included, set `UPGRADE_REQUIRE_SIGNATURE=true` in `.env`.

**Operators:** a proxy that reached the containers from your shell under Podman, or from the Docker
client's `~/.docker/config.json`, no longer reaches them; if the stack needs one, set `HTTPS_PROXY`
in `.env` (see *Changed*). The JWT guard no longer builds an HTTPS agent of its own or loads a
`root.crt` from beside the file `NODE_EXTRA_CA_CERTS` names (see *Changed*). If that variable named
your identity provider's server certificate and its private CA was in the `root.crt` beside it, the
guard no longer trusts that CA: point `NODE_EXTRA_CA_CERTS` at the CA itself. In the compose bundle,
add the CA to `proxy-ca/proxy-ca.pem`, beside any proxy CA already in that file; console-init, the
platform and the console then trust it for all their outbound HTTPS (see *Added*, the proxy CA
entry). A `NODE_EXTRA_CA_CERTS` that already named the CA itself is unaffected.

**`TEMPLATE_OPERATION_TIMEOUT_MS`:** the compose bundle does not pass it to the platform, so this
concerns dt-ws run outside the bundle, or given the variable through `compose.override.yaml`.
0.13.0 checked its range but did not use it. dt-ws now waits that long for a module's template or
guide, and raises a value below 20000 to 20000 (see *Fixed*). Before upgrading, check that the
value is how long you want dt-ws to wait, or remove it to get the default, 30000.

**Moved folders:** if you moved a deployment's folder to a new path, run `./byodt down --take-over`
once in the new folder before you start it: `byodt` now refuses to act on another folder's
deployment (see *Changed*). **Memgraph:** `./byodt up` and `./byodt update`, the upgrade's own apply
included, set a password of the generated shape again to move it to the faster hash; with the
generated password there is nothing to do (see *Fixed*). A password of another shape (anything but
lowercase hex of 32 characters or more) keeps the slower hash until you set it again in the
database (see *How Memgraph stores it* in the BYODt configuration guide).

**Module authors:** `@dethernety/dt-module` is 0.14.0. A module whose manifest declares
`compatibility.dtModule` must declare `^0.14.0` to be packaged against it (see *Changed*).
`dethernety-threat-report` is 2.1.0. **API callers:** `Data.controls` and `Control.supportedData`
are new (see *Added*). **Dethereal users:** Dethereal 0.4.19 needs this platform: it checks for
`Data.controls` and stops on an older platform (see *Changed*). Upgrade the platform first.
Dethereal is published separately from this release.

### Added

- **`REMOTE_MODULE_CALL_TIMEOUT_MS` in `@dethernety/dt-module`** (15000): how long a remote module
  waits for one call to its content service before it gives up and serves its read-only fallback. A
  host that limits how long it waits for a remote module's template or guide must allow longer.
- **A remote module logs the read-only fallbacks it serves.** The warning `Serving the read-only
  fallback` names the module, the class, whether it was the template or the guide, and the reason:
  `no-credential`, `denied` or `unavailable` (a call that timed out is `unavailable`). It is logged
  at most once a minute for each reason, with the count of fallbacks not logged since the last
  warning.
- **The compose bundle can reach the internet through an outbound HTTPS proxy.** Set
  `HTTPS_PROXY=http://host:port` in `.env`, and `NO_PROXY` for extra hosts to reach directly. Only
  console-init, the platform and the console get the proxy; the database and the front door get the
  proxy variables set empty. The platform's Node uses the proxy (`NODE_USE_ENV_PROXY=1`) only when
  one is set, for `fetch` and the core HTTPS agent alike.
- **`./byodt` reads the proxy from `.env` only, and checks it.** A different `HTTPS_PROXY` in your
  shell gets a notice and is not used. `HTTP_PROXY` is not used, and `./byodt` warns when `.env`
  sets it. `./byodt` refuses a proxy URL that carries a login, has no numeric port, names a loopback
  address, or names one of the stack's own services.
- **A proxy login goes in `.env.secrets`.** Set `HTTPS_PROXY_USERINFO=user:password`, with the user
  name and the password percent-encoded, and any character outside ASCII as its UTF-8 bytes. Over
  `http://` the login crosses the network in clear; use `https://` if the proxy offers it. It is
  checked strictly too, and `./byodt` masks it in its messages. `docker inspect`, `podman inspect`
  and `./byodt compose config` show it, as they show the database password, and under
  `podman-compose` so does the host's process list while containers are created. console-init, the
  console and the platform mask it as `://***@` only where they report a failed fetch: a module
  download, a call to the cloud content service or to the platform, the sign-in keys and the model
  download. Other error text is not masked. In tests, Node's own proxy errors left the login out,
  and no service log carried it.
- **`NO_PROXY` takes exact host names or addresses.** Each may have an optional `:port`, and they
  are separated by commas; CIDR, ranges, wildcards and a leading dot are refused. Do not rely on an
  entry to cover its subdomains: the platform's core HTTPS agent matches the exact name only, so
  list every host, `login.example.com` and not `example.com`. `./byodt` adds loopback and the
  stack's own service names, including any service in `compose.override.yaml`.
- **A TLS-inspecting proxy's CA goes in `proxy-ca/proxy-ca.pem`.** It must be the only file in
  `proxy-ca/`: owned by you, readable by every account (`chmod 0644`), not writable by group or
  others, and not a symbolic link. After replacing it, run `./byodt restart platform console`.
  Trusting that CA lets whoever holds its key read and change everything the stack sends over TLS,
  including the signing keys sign-ins are checked against, so it can sign anyone in. Prefer asking
  for the identity provider and the content service to pass through the proxy uninspected.
- **Image pulls use the Docker daemon's own proxy setting, not `.env`.** `./byodt up` and
  `./byodt update` warn before they pull when `.env` sets a proxy and the daemon has none. A failed
  embedding-model download names the host that failed, never the path or query of its URL.
- **Setup warns about a database volume an earlier deployment left.** When
  `dethernety_memgraph-data` or `dethernety_neo4j-data`, a volume an earlier deployment of the
  bundle left, exists, setup names it and says whether this deployment would mount it or not. If
  it would, its first start would be refused; setting `DB_DATA` or `NEO4J_DATA` to a folder avoids
  that. If not, the old graph may still be in it: start the deployment it belongs to again, with
  this one stopped, to use it. The warning gives the `volume rm` command to run if that graph is
  no longer needed. Nothing is removed for you.
- **Each release publishes an installer, `get-byodt.sh`, signed like the bundle.** Run with
  `curl --proto '=https' --tlsv1.2 -fsSL https://github.com/dether-net/dethernety-oss/releases/download/vX.Y.Z/get-byodt.sh | sh`,
  it downloads that release's bundle over HTTPS (at most 50 MiB), checks the SHA-256 the release
  wrote into the installer and, with cosign installed, the release workflow's signature at that
  exact tag, unpacks it into a new folder (`./byodt`, or `--dir`), and runs `./byodt setup`. It
  refuses an existing folder, never installs over a deployment, and upgrades one with `--upgrade`.
  Options: `--dir`, `--upgrade`, `--yes`, `--https-proxy`, `--tarball`, `--require-signature`,
  `--allow-unsigned`; any other option goes to setup or upgrade. Without a terminal it needs
  `--yes`. A proxy login comes only from `HTTPS_PROXY` or `https_proxy` in the environment:
  `--https-proxy` refuses one.
- **An npm package that wraps the same installer, `@dether.net/byodt`.** Each package version is
  the release of the same version and carries its `get-byodt.sh`, which it runs with `/bin/sh`
  (`npx <package>@X.Y.Z`). It has no dependencies and no install scripts, and stops on Windows (use
  WSL). Publishing it to npm is switched on separately; until then, and after, `get-byodt.sh` from
  the release is the primary way to install.
- **`./byodt setup`, the first run of a bundle.** It asks for the database, the data storage (on
  Docker Desktop or a Podman machine), the bind address, the port, the outbound proxy (its hosts,
  login and CA), and whether to start, and writes `.env` (and `.env.secrets` only for a proxy
  login). Every question has a flag; `--yes` takes the defaults. Without a terminal and without
  `--yes` it refuses, and a refusal leaves the folder as it was.
- **A third-party notice before the first download.** `byodt` and the installer show which
  third-party software the deployment runs (the database image, nginx, the embedding model), where
  the machine downloads it from, and its licence, and ask you to confirm that you have read it and
  are responsible for using that software under its licence. It is not a licence agreement. Each
  confirmation is a line in `third-party-acknowledgement.log`; the notice is asked for again only
  for a new text, another database image, or another model. `./byodt notice [--all]` prints it,
  `./byodt acknowledge` records it. `./byodt compose …` never shows it.
- **`./byodt upgrade [VERSION]` moves a deployment to a newer release.** The new release's own
  `byodt` checks first (edited shipped files, the `.env` changes, free disk, a running database),
  asks every question at once, backs up into `backups/upgrade-<from>-to-<to>-<time>/` (the graph,
  `.env`, the shipped files), moves the new files in, updates `.env`, applies the release, waits
  until it is healthy, and prints the rollback steps. An interrupted upgrade resumes with
  `./byodt upgrade`, or is dropped with `--abandon`; one interrupted before it changed anything
  starts over, with the options it was given and any given now. Options: `--yes`, `--move-db`,
  `--replace-edited`, `--skip-graph-backup`, `--require-signature`, `--allow-unsigned`,
  `--health-timeout`. A signature cosign rejects always stops the upgrade. Without cosign, an
  upgrade given `--yes` or run without a terminal refuses the release unless `--allow-unsigned` is
  given, and `--yes` never implies it; at a terminal, without `--yes`, it asks first.
- **`UPGRADE_REQUIRE_SIGNATURE=true` in `.env`** makes every upgrade of the deployment require a
  verified signature. An upgrade given `--allow-unsigned` is refused before anything is
  downloaded. `false`, in any case, or an empty value leaves it to the flags; any other value, such
  as `yes` or `1`, stops the upgrade before anything is downloaded. An upgrade by an account that
  cannot read `.env` stops.
- **`.byodt-release` records the release a deployment runs** and the SHA-256 of every file it
  shipped. The next upgrade checks local edits against it.
- **A control can be applied to a Data element.** `Data.controls` and `Control.supportedData` read
  and write the `SUPPORTS` edge from a Control to a Data element. Both fields allow only a nested
  `connect` and `disconnect`; a nested create or delete is not offered.
- **A data item's controls are edited in its data dialog.** The dialog has a Controls tab once the
  data item exists, with the same picker as an element's Controls tab: a pick is saved at once, and
  unticking a control asks before it is removed. In control gaps, a control on a data item counts
  for that data item's own exposures only: not for the elements that handle it, nor theirs for it.
- **Dethereal 0.4.19 reads and writes a data item's controls.** Each item in `data-items.json` may
  carry `controls`, the same `{ id, name }` references boundaries, components and data flows carry.
  Pull writes them, push applies them, `get_model_schema` and `validate_model_json` know the field,
  and a reference the push could not attach is written back to the item. On push a present list
  (including `[]`) replaces the item's controls, and an absent key leaves them as they are; on a
  boundary, component or data flow an absent key clears them. To remove a control from a data
  item, write the list without it, or `[]`; never delete the key. `manage_controls assign` attaches
  data items too.
- **The threat report lists a Data element's own controls.** In `dethernety-threat-report` 2.1.0,
  the off-grid Data disclosure in Coverage & Gaps names the controls applied to each Data element,
  as assigned and without a coverage grade. Data exposures stay off the coverage grid.

### Changed

- **`HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` from your shell under Podman, or from the Docker
  client's `config.json`, no longer reach the containers.** Podman copies them from the environment
  it runs in into every container that does not set them (`http_proxy = true` in `containers.conf`,
  its default), and the Docker client does the same with the `proxies` in `~/.docker/config.json`.
  So console-init and the console used to follow such a proxy. The bundle now sets these variables
  for every service, from `.env` or empty. If the stack needs a proxy, set `HTTPS_PROXY` in `.env`.
- **The platform's JWT guard fetches the OIDC signing keys (JWKS) with `fetch`, so with a proxy
  set they go through it like the platform's other calls.** The JWKS URI must be `https://`
  (`http://` only on a loopback host), a redirect is refused, and the fetch fails after 30 s or once
  the answer passes 1 MiB. The GraphQL layer fetches the same keys on its own, on Node's core HTTPS
  agent, and goes through the proxy too. The guard no longer builds an HTTPS agent of its own when
  `NODE_EXTRA_CA_CERTS` is set, and no longer loads a `root.crt` from the directory that variable
  points into. If your identity provider's certificate is signed by a private CA, add that CA to
  `proxy-ca/proxy-ca.pem` in the compose bundle; elsewhere, point `NODE_EXTRA_CA_CERTS` at it.
- **`./byodt` now refuses to act on another folder's deployment.** `up`, `update`, `restart`,
  `down`, `stop`, `destroy`, `backup`, `restore`, `upgrade`, and `setup` when it starts the stack
  (`--start`, or a yes at its question), refuse when the deployment's compose project (all bundles
  share the project name `dethernety`) is running, or ran, from another folder, and they name that
  folder. Before, `up` in a leftover folder took over another folder's containers, and `down` or
  `destroy` there stopped its running deployment. If you moved a deployment's folder to a new path,
  run `./byodt down --take-over` (or `destroy --take-over`) once in the new folder before you start
  it: it removes the containers the old path started.
- **The first `./byodt up` refuses to mount a database volume an earlier deployment left.** When the
  database would use the named volume `dethernety_memgraph-data` or `dethernety_neo4j-data` and that
  volume already exists, the first `up` of a folder stops, and so does `setup` when it starts the
  stack: that graph's database users were made with another password, so the platform would be
  locked out. Setting `DB_DATA` or `NEO4J_DATA` to a folder avoids it (`--db-data bind` in setup);
  the message gives the `volume rm` command for a graph you no longer need.
- **`./byodt upgrade` is a command of its own.** It was another name for `update`. Release 0.13.0's
  `byodt` keeps the old meaning: upgrade a 0.13.0 deployment with the new release's installer and
  `--upgrade`.
- **The first start of a bundle shows the third-party notice and waits for a confirmation.**
  `./byodt up`, `update`, `restart` and `models pull` on a deployment that has not run yet stop
  without a terminal unless `--yes` is given. On a deployment that has run, a due notice is asked
  for at a terminal, where `n` stops the command; with no terminal and no `--yes`, it is printed
  with a warning and never stops a command.
- **`byodt` names itself in its messages the way it was run**, `./byodt up` rather than `byodt up`,
  so a suggested command works as printed.
- **`byodt` records the notice only in a folder no other account can change.** A group-writable
  folder counts as one other accounts can change, unless the group is the operator's own private
  group.
- **Dethereal 0.4.19 needs a platform with controls on data elements, which this release adds.**
  Before `export_model`, `import_model`, `update_model`, `create_threat_model`,
  `update_attributes`, and the `list`, `assign` and `push-greenfield` actions of `manage_controls`,
  it checks that the platform has `Data.controls`, and remembers a platform that has it. On an
  older platform those calls stop with "Platform too old for this Dethereal version" and a message
  that names the platform. Upgrade the platform first.
- **`@dethernety/dt-module` is 0.14.0, and its one API change is additive:** the new export
  `REMOTE_MODULE_CALL_TIMEOUT_MS` (see *Added*). The changes in behaviour are in `DtRemoteModule`:
  once registered, `getMetadata` answers from the entry it registered (see *Fixed*), a served
  read-only fallback is logged (see *Added*), and an error from the content service masks the login
  of a URL in its message as `://***@`. Declaring `compatibility.dtModule` in `manifest.json` is
  optional; a module that declares it must declare `"compatibility": { "dtModule": "^0.14.0" }` to
  be packaged against dt-module 0.14.0. For a 0.x version a caret range pins the minor version, so
  `scripts/package-module.js` refuses a manifest that still declares `^0.13.0` against dt-module
  0.14.0, and produces no package. `dethernety-general`, `dethernety-coverage-tools` and
  `dethernety-threat-report` declare `^0.14.0`.

### Fixed

- **A slow remote module's class template or guide now shows the module's read-only fallback.**
  dt-ws stopped waiting for a template or guide after 10 s, before a remote module's own 15 s call
  timeout let it answer with its fallback, so the settings window showed no attribute form, only
  the warning "Form could not be rendered due to missing or invalid schema". dt-ws now reads
  `TEMPLATE_OPERATION_TIMEOUT_MS` (default 30000, for local and remote modules alike), which was
  documented but never read. A value outside 5000 to 300000 stops dt-ws at boot, and one below 20000
  is raised to 20000. The template and guide failure logs now name the module and carry `timedOut`,
  true when dt-ws stopped waiting.
- **The settings window no longer shows or saves the previous element's attributes while a new one
  loads.** After a change of selection, the Attributes tab kept the previous element's form until
  the new element's class arrived, and an attribute save in that time sent the previous element's
  class for the new element. The tab now shows a progress bar until the new class has loaded, saves
  no attributes before then, and ignores a class or attributes answer that arrives for an earlier
  selection. The class picker is disabled until the class has loaded.
- **A save while the settings window loads no longer writes empty fields or the previous
  element's links.** Until the element's class arrived, the window held empty name and description
  fields and the previous element's controls and zoning, so a crown-jewel toggle, an added control
  or a zoning save in that time wrote them to the new element. It now fills them from the element at
  once and keeps an edit made while the class loads. A save of the General tab no longer drops an
  unsaved zoning edit before the zoning save that follows it.
- **A slow content service no longer takes a registered remote module out of service.** The detailed
  health check (`GET /health`) gives each module's `getMetadata` 5 s. A `DtRemoteModule`
  (`@dethernety/dt-module`) whose portal origin was not pinned at boot, or whose pin was not cached,
  called its content service on every `getMetadata` call, with a 15 s timeout, so a slow service
  failed the check. The platform then stopped using the module (its templates, guides, evaluation
  and frontend) until a later check passed. Once registered, a remote module now answers
  `getMetadata` at once from the entry it registered, and pins the portal origin and fetches the
  document at its pin in the background, at most once a minute; a failed document fetch is logged
  without server text. Concurrent calls share one registration, a failed registration is answered
  again for a minute without the network, and a live module document with no name is refused before
  it is cached. A module registered from another pin during an outage keeps serving that entry until
  the background fetch of its own pin succeeds; the next install after that, at the latest the next
  start, installs its own pin's classes.
- **"Commit & change" no longer removes an element's class instead of changing it.** With unsaved
  General edits, picking a new class or model and choosing "Commit & change" saved the edits first,
  and the form reload that save started cleared the pick before the change ran: a class change
  became a class removal, and a model pick was dropped. The pick is now taken before the edits are
  saved, and the change is cancelled, with a message, if another element was selected or a new edit
  was made while they were saved. Cancelling a class or model change now puts back only the pick,
  instead of also discarding the other unsaved edits.
- **Saving General and Attributes together no longer shows old attribute values.** The General
  save's form reload ran during the attribute save and read the attributes before that save had
  committed, so the form showed the old values over the new baseline and the next save sent them
  back. The settings window now reloads the form once, after all of its saves, and only when no edit
  is left unsaved. A failed save, or an edit made while a save was in flight, keeps its edit, as
  does an unsaved attribute edit when a link is added or the crown jewel is toggled.
- **Database logins on Memgraph are fast, so a burst of new connections no longer stalls the
  database.** Memgraph's default password hash, bcrypt, holds a lock for each login. The compose
  bundle now starts Memgraph with `--password-encryption-algorithm=sha256-multiple`. `./byodt up`
  and `./byodt update` set the database password again to the value it already has, when it has
  the generated shape, so an existing deployment moves to the new hash too; `.env.secrets` is
  unchanged, and a failure only warns. Neo4j is unaffected. If you set your own password, use a
  long random value, which the faster hash relies on: on Memgraph, `byodt` warns when it is
  shorter than 32 characters. See *How Memgraph stores it* in the BYODt configuration guide.
- **`./byodt backup` and `./byodt restore` now work on Podman with podman-compose for a Memgraph
  database.** They copied the graph snapshot with `compose cp`, which podman-compose does not have,
  so they failed with "Failed to copy the snapshot out of the db container." (backup) or "Could not
  copy the snapshot into the db container." (restore). An upgrade backs up the graph first, so an
  upgrade on such a deployment stopped there, with nothing changed. `byodt` now copies the snapshot
  with the container engine's own `cp` (`docker cp` or `podman cp`) on the project's database
  container, which both engines have. Neo4j deployments were not affected. The snapshot a manual
  `./byodt backup` writes is now readable by its owner only (it kept the container file's mode
  before). An upgrade from 0.13.0 on Podman still runs 0.13.0's own backup and fails there; take a
  snapshot of the graph by hand with `podman cp` and upgrade with `--skip-graph-backup`.
- **`getControlsAssignedModels` now counts a control applied to a Data element or to a whole
  model.** It reached a Model only through the components, boundaries and data flows the control
  is applied to, so a control applied only to a Data element or to a Model read as assigned to no
  model. It now also reaches the Model that contains the Data element, and the Model the control
  is applied to directly.

### Security

- **The image workflow no longer leaves its token in the checkout.** Every job in `docker.yml`
  checks out with `persist-credentials: false`, so the `GITHUB_TOKEN` of a job that can push images
  is no longer stored in `.git/config`, where any code the job runs, a dependency's install script
  included, could read it.
- **The verify command in the image workflow's summary names the exact signer.** It printed
  `--certificate-identity-regexp '^https://github.com/<repository>/'`, which a signature from any
  workflow run of the repository would pass. It now prints `--certificate-identity` with the
  workflow file and the ref of the run that signed the image.

## [0.13.0] - 2026-10-27

The platform runs on Neo4j 5 as well as Memgraph. The compose bundle picks the database with
`DB_ENGINE` (Memgraph stays the default), dt-ws builds its schema in each engine's dialect, and the
Cypher statements Neo4j refused now run on both engines. `@dethernety/dt-module` gains the engine,
schema and write-lock helpers modules need to do the same. byodt is 1.3.0.

dt-ui no longer fetches every module frontend before it mounts. A module frontend is now a bundle
and a manifest naming the component keys it registers, and dt-ui fetches a module's bundle the first
time one of those keys is needed, from a content-addressed URL the browser caches. dt-ws reads each
bundle once, when it loads the module, and serves it from memory.

**Upgrading:** an existing deployment stays on Memgraph: the first `byodt` command that runs the
stack records `DB_ENGINE=memgraph` in `.env`. **Run the stack through `byodt` only:** `compose.yaml`
no longer holds the `db` service, so a bare `docker compose up` does not start the stack. Local
compose changes are read from `compose.override.yaml` only; rename a `compose.override.yml` or
`docker-compose.override.*`. **API callers and module authors:** a list property value that holds
null is now refused (see *Changed*), and so are a `single` filter on a relationship to an interface
or union and requests past the new request limits (see *Security*); `getAvailableFrontendModules`
and `getModuleFrontendBundle` are removed (see *Removed*). **Module authors:** a module frontend
without `frontend/frontend-manifest.json` is no longer loaded (see *Changed*);
`dethernety-threat-report` 2.0.1 ships its manifest. **Operators:** update each installed module
that has a frontend to a version that ships `frontend/frontend-manifest.json`, before you upgrade
the platform or right after it: 0.13.0 no longer loads a module frontend without its manifest.
Reload any browser tab left open across the upgrade: an old tab still runs the old dt-ui, which
calls the removed frontend queries. **A CDN or reverse proxy in front of dt-ws** must honour
`Cache-Control: private` on `/module-bundles/` and must not cache it by
path (see *Security*). **Dethereal users:** builds before the next Dethereal release send a filter
the platform now refuses, so listing analyses from them fails until you update Dethereal, and they
send one operand per element when they assign a control, so assigning one to some 200 elements or
more in one call is refused too; Dethereal 0.4.17 bundles the fixed dt-core and carries the updated
data layer: dt-core's module queries gain `getFrontendModuleManifest` and lose
`getAvailableFrontendModules` and `getModuleFrontendBundle`. 0.4.16 was never published: its changes
ship in 0.4.17.

### Added

- **Neo4j 5 as the bundle's database.** Set `DB_ENGINE=neo4j` in `.env` before the first start, or
  run `DB_ENGINE=neo4j ./byodt up` once, to run Neo4j 5.26 Community instead of Memgraph. `byodt`
  records the engine in `.env` on the first run, and `NEO4J_IMAGE` on the first Neo4j run; an
  exported `DB_ENGINE` overrides `.env` for one command. New optional settings: `NEO4J_HEAP_SIZE`
  (default `2G`), `NEO4J_PAGECACHE_SIZE` (default `1G`) and `NEO4J_DATA` (`./data/neo4j`, or the
  `neo4j-data` named volume). On Neo4j the platform connects as user `neo4j` to database `neo4j`;
  `NEO4J_USERNAME` and `NEO4J_DATABASE` in `.env` apply to Memgraph only. See the deploy README,
  *Choosing the database*.
- **Each engine keeps its own data.** Nothing converts one engine's graph into the other. `byodt`
  refuses to start an engine whose bind-mounted store is empty while the other engine's store holds
  data, and runs the same check before a backup or a restore. A refused start leaves `.env` and
  `data/` as they were. A store in a named volume is not checked.
- **Backup and restore on Neo4j.** Neo4j Community dumps and loads an offline database only, so
  `./byodt backup` and `./byodt restore` stop `db`, run `neo4j-admin` in a one-off container through
  a private (`0700`) working directory in the bundle, and start `db` again, also when the dump or load
  fails. The platform loses its database connection meanwhile. Each engine refuses the other
  engine's backup file. A failed Neo4j load may leave the graph empty: restore again from a backup
  you know is good.
- **Engine detection in `@dethernety/dt-module`.** `probeEngine(driver, databaseName?)` reads
  `dbms.components()` and returns an `EngineInfo` (`engine`: `'memgraph' | 'neo4j'`, `edition`,
  `version`). It throws `EngineProbeError` for a component that names neither engine, rather than
  guessing. `resolveEngine(context)` returns a module resolver context's engine: through
  `getEngine` when the platform supplies it, otherwise through one probe of the context's driver,
  kept per driver. It always rejects on failure, never throws synchronously.
- **`ModuleResolverContext.getEngine`** (optional). dt-ws now supplies it to every module's
  `getResolvers()`, backed by the platform's single engine probe. It rejects when the engine cannot
  be determined. Call `resolveEngine(context)` to also work on a platform that predates it.
- **Per-engine schema DDL builders in `@dethernety/dt-module`.** `buildIndexDdl`,
  `buildDropIndexDdl`, `buildRelationshipIndexDdl`, `buildDropRelationshipIndexDdl`,
  `buildConstraintDdl` (single or composite uniqueness, or existence) and `buildDropConstraintDdl`
  return the statement for the given `EngineInfo`. Every Neo4j index and constraint gets a
  deterministic name (`indexName`, `relationshipIndexName`, `constraintName`), because Neo4j 5
  drops schema objects by name only. Labels and properties must be plain identifiers. An unknown
  constraint kind throws. An existence constraint builds as `null` on Neo4j editions other than
  Enterprise.
- **`ensureSchema(run, engineInfo, plan)` and `dropSchemaObject(run, engineInfo, target)`** apply
  and drop a module's declared indexes, relationship indexes and constraints on either engine, and
  return a `SchemaReport` (`applied`, `existed`, `skipped`, `failed`). `ensureSchema` checks every
  spec before it runs anything. On Memgraph "already exists" counts as present. On Neo4j a plain
  index that a uniqueness constraint or node key covers is skipped, and one in the way of a declared
  constraint is dropped first and put back if the constraint fails. Before each uniqueness
  constraint it counts duplicate key values and nodes missing the key; with duplicates the
  constraint is not attempted and is reported as failed with both counts. Applying the same plan
  twice changes nothing. On Neo4j `dropSchemaObject` looks up every matching object with
  `SHOW INDEXES` / `SHOW CONSTRAINTS` and drops it by its actual name, so unnamed objects from
  earlier versions go too; a name that is not a plain word is refused and reported, not quoted.
- **`writeLockClause(variable)`** in `@dethernety/dt-module` returns `SET v._lock = true REMOVE
  v._lock`. Put it right after the `MATCH` of a node that a statement reads and then writes: on
  Neo4j a concurrent writer waits and then reads the committed state; on Memgraph it conflicts, and
  a driver-managed write transaction retries it. Nothing is left on the node.
- **`@dethernety/dt-module/cypher-lint`** (dev and test tooling): a text-based check for the one
  aggregation rule Neo4j 5 enforces and Memgraph does not ("Aggregation column contains implicit
  grouping expressions"). It exports `aggregationKeyViolations`, `aggregationKeyViolationsInFiles`,
  `cypherStringsInSource`, `cypherStatementsInSchema`, `cypherLintFiles`, `cypherProjections` and
  `formatAggregationKeyViolation`. The dt-ws, threat-report and coverage-tools lint tests run it
  over their sources and schema `@cypher` statements.
- **The integration suites run on Neo4j.** `DT_TEST_ENGINE=memgraph|neo4j` picks the engine of the
  test database for the dt-ws and threat-report suites; any other value is refused. On `neo4j` the
  suites start Neo4j 5.26 Community, skip the Memgraph-only suites with their reason, and write
  every server failure to stderr. See the backend LLD architecture, *Running the suites on Neo4j*.
- **CI: a Neo4j test leg, run by hand.** The `neo4j-leg` workflow (`workflow_dispatch` only) runs
  the dt-ws and threat-report suites on Memgraph and on Neo4j. Its log gate
  (`.github/scripts/neo4j-log-gate.sh`) fails the leg when a suite's output is missing, shows no
  passed test, or holds a `Neo.ClientError.Statement`, `.Procedure` or `.Schema` code that no line
  of `.github/neo4j-log-gate-allow.txt` allows. The gate's own fixture test runs on every pull
  request, and the bundle job now checks the compose configuration under both engines.
- **Integration suites can run against an external test database.** On a machine where containers
  cannot run, the dt-ws and threat-report integration suites share one throwaway database instead of
  starting a container per suite: `MEMGRAPH_TEST_URI` names a test Memgraph, `NEO4J_TEST_URI` a test
  Neo4j (with `DT_TEST_ENGINE=neo4j`). The check and the reset live in the new
  `@dethernety/dt-module/test-database` subpath (dev/test only; nothing in the package's main entry
  imports it). Each suite resets the database when it connects, so run the suites one at a time (jest
  `--runInBand`, vitest `--no-file-parallelism`) and one package at a time. See the backend LLD
  architecture, *Running the suites against an external test database*.
- **A guard runs before anything is wiped.** The URI must be a plain `bolt://host:port`, must not use
  port 7687 (always refused) and must be listed exactly in `DT_TEST_EXTERNAL_WIPE`. The server must
  identify itself as a test database: a Memgraph by the server name it was started with, a Neo4j
  (the weaker check) by running without auth and with its default database named `memgraph`. A
  database holding an index or constraint kind the suites never create is refused untouched.
- **Every dt-core GraphQL document is checked against the schema.**
  `apps/dt-ws/src/gql/__tests__/dt-core-documents.spec.ts` validates each document dt-core exports
  against the schema the platform serves, built in process with no database, and checks the `where`
  shapes dt-core's filter builders produce with the same variable coercion a request goes through.
  A field or argument the schema does not have fails the test instead of the request.
- **The module frontend manifest.** `frontend/frontend-manifest.json`, beside `frontend/bundle.js`:
  `manifestVersion` (`1`), `components` (the component keys `install()` registers, exactly: 1 to 256
  unique keys matching `^[A-Za-z][A-Za-z0-9_-]{0,127}$`) and `hostApi` (`{ min, max }`, integers
  from 1 to 1000, `min` ≤ `max`: the host dependency versions the bundle works with). The host's
  version is 1. `@dethernety/dt-module` exports `validateFrontendManifest`, `parseFrontendManifest`,
  `FrontendManifestError` and the JSON schema (`@dethernety/dt-module/frontend-manifest.schema.json`).
- **`assertFrontendManifest`**, on `@dethernety/dt-module/frontend-manifest`: the contract test for a
  module frontend. It runs `install()` against a recording registry and throws unless it registers
  exactly the manifest's keys, each once. It works under any test runner. The threat report
  module's suite runs it in CI.
- **`getFrontendModuleManifest`** (`@authentication`): per module on the module allow-list with a
  frontend, sorted by name, its `name`, `version`, `available`, `hash` (sha256 of the bundle), `size`,
  `url`, `components` and `hostApi`. No bundle text. dt-core: `DtModule.getFrontendModuleManifest()`
  and the `FrontendModuleManifest` type; `AnalysisClass.module` is unwrapped like the class.
- **`GET /module-bundles/:name/:hash/bundle.js`**: a module's bundle, behind `JwtAuthGuard`. `404`
  for an unknown module, one without a frontend or one not on the module allow-list; `503` while the
  module is unhealthy; `404` when `:hash` is not the current bundle's sha256; otherwise `200` with `Cache-Control: private,
  max-age=31536000, immutable`, `Vary: Accept-Encoding` and an ETag per encoding (brotli, gzip or
  none), and `304` on a matching `If-None-Match`. The dt-ui dev server proxies `/module-bundles` to
  dt-ws.
- **User Timing marks in dt-ui.** `dt:mount` (from `dt:boot` to `dt:mounted`), `dt:module:<name>` for
  each module frontend load, and `dt:view:<key>` from an analysis result's fetch to its module
  component rendering it. Each measure carries `detail.ok`, `false` for a failed load. Read them with
  `performance.getEntriesByType('measure')`.

### Changed

- **The bundle's database sends no usage data to its vendor.** `compose.memgraph.yaml` starts
  Memgraph with `--telemetry-enabled=false`, and `compose.neo4j.yaml` sets Neo4j's
  `dbms.usage_report.enabled` to `false`; both images report usage by default. `./byodt restart db`
  applies it to a running deployment.
- **Breaking (API callers and module authors): a list property value may not hold null.** Neo4j
  refuses such a list and Memgraph stores it, so dt-ws now refuses it on every write path, before the
  database sees it. A list element that is `null`, `undefined` or an array hole is refused; an empty
  list, an empty string in a list, and a top-level `null` (which clears the attribute) are still
  accepted.
  - `setInstantiationAttributes` fails with `VALIDATION_ERROR`, naming the attribute and the element:
    `Invalid request: attributes.<key>: list element <i> is null; remove the empty entry (a list
    cannot hold null)`. Nothing is written.
  - A module finding's attribute holding such a list is dropped with a warning and the finding is
    still written; a finding whose name cannot be stored is skipped. The same goes for a MITRE
    edge attribute.
  - At module install, a class whose properties hold such a list fails, which leaves the install
    partial as any class failure does; module metadata holding one fails the install.
- **Breaking (operators who run compose directly or keep another override file name): the bundle's
  `db` service moved out of `compose.yaml`** into `compose.memgraph.yaml` and `compose.neo4j.yaml`,
  under the same service name. `byodt` passes `compose.yaml`, the engine's file, then
  `compose.override.yaml` when there is one, last. A bare `docker compose up` on `compose.yaml` no
  longer starts the stack: use `./byodt compose …` for anything `byodt` has no command for.
  `compose.override.yml` and `docker-compose.override.*` are no longer loaded; `byodt` warns when it
  finds one.
- **The tested Neo4j image names its patch release: `docker.io/library/neo4j:5.26.32-community`.**
  The first Neo4j run records it as `NEO4J_IMAGE` in `.env`, where `byodt` used to record the
  floating `docker.io/library/neo4j:5.26-community`. A deployment that recorded the floating tag
  keeps it: `./byodt up` and `./byodt update` warn that it differs from the tested image, and start
  as before. Moving is your call: back up first (`./byodt backup`; there is no downgrade), set
  `NEO4J_IMAGE`, then run `./byodt update`.
- **The platform asks the database once which engine it is.** dt-ws's `DatabaseService` holds the
  only engine probe, now dt-module's `probeEngine`; the module registry, the class reconciler and
  the schema bootstrap share it. A `dbms.components()` answer that names neither engine is now an
  error, where it used to be taken for Neo4j: `getEngine` rejects, and the schema bootstrap, as on
  any failed probe, assumes Memgraph and logs the error. On Neo4j the class reconciler no longer
  calls `mg.procedures()`.
- **Bootstrap schema statements come from dt-module's builders.** dt-ws's index and constraint
  bootstrap builds each statement with the dt-module DDL builders, so every index and constraint it
  creates on Neo4j now carries its deterministic `dt_…` name. A builder error counts against that
  statement, and the rest of the bootstrap still runs.
- **Bootstrap drops the old class vector indexes on Memgraph.** Earlier versions kept a vector index
  on each class label (`component_`, `control_`, `dataflow_`, `boundary_` and
  `data_class_embeddings`). Class matching is an exact scan and reads none of them; they only held
  memory and slowed every class write. Those that `vector_search.show_index_info()` lists are dropped
  once the index and constraint bootstrap has finished. A MITRE vector index is never touched. A
  failed listing or drop is a warning and never stops startup; Neo4j never had these indexes.
- **The MITRE vector-index upkeep says when it skips.** It runs on Memgraph only, as before; on
  another engine it now logs that it is skipped, once per process.
- **The console indexes the reference-data keys before the ingest.** `console-init` probes the
  engine and creates an index on every label and key the MITRE corpus is looked up by, in that
  engine's dialect and, on Neo4j, under the name the platform gives the same index, so the ingest's
  writes no longer scan whole labels. A failed index, or an engine it cannot tell, never fails the
  ingest; it is noted in the ingest state's detail. The MITRE embeddings build's loader
  (`modules/mitre-frameworks/scripts/load_committed_data.py`) creates its key indexes per engine the
  same way.
- **The console names a Neo4j memory failure as one.** Neo4j's out-of-memory codes (heap,
  transaction pool, transaction limit) are terminal and not retried, like Memgraph's memory-limit
  error, and the hint names the setting to raise on the engine the ingest ran against
  (`NEO4J_HEAP_SIZE` on Neo4j).
- **Breaking (anyone using `MEMGRAPH_TEST_URI`):** the variable now also needs the URI listed in
  `DT_TEST_EXTERNAL_WIPE`, a port other than 7687, and a Memgraph started with
  `--bolt-server-name-for-init=dt-test-memgraph`. A target that does not meet all three is refused.
- **Breaking (module authors): a module frontend needs `frontend/frontend-manifest.json`.** Without
  a valid manifest, dt-ws does not load the frontend and logs `Module frontend not loaded` with the
  module name and the reason; the module itself still loads. To add one, list the keys your
  `install()` passes to `componentRegistry.register()`:

  ```json
  {
    "manifestVersion": 1,
    "components": ["my_component"],
    "hostApi": { "min": 1, "max": 1 }
  }
  ```

  Then add a test that calls `assertFrontendManifest(frontend, manifest)`, and repackage.
  `scripts/package-module.js` now refuses, and produces no package for, a `frontend/` that is not a
  directory (a symlink), lacks either file, holds a symlink in their place, or has a manifest that is
  not valid JSON or not a JSON object. It copies
  the manifest into the package before the identity stamp, so `payloadDigest` covers it.
- **dt-ui loads module frontends on first use.** `ModuleLoader.ensure(key)` reads the manifest on
  first use, then fetches the owning module's bundle once. A `401` refreshes the token and retries
  once; a `404` (a stale hash) rereads the manifest once; a `503` or `available: false` is reported
  as unavailable; a module whose `hostApi` range excludes the host's version is refused. A failed
  load is forgotten, so Retry starts again.
- **Each module's `install()` receives a component registry scoped to the keys its manifest
  declares.** Registering any other key is refused and logged. A key two modules declare belongs to
  neither, and the view that needs it fails with an error. Component registry lookups are reactive.
- **The analysis results page** starts loading the analysis class's module frontend alongside the
  index document, shows *Loading analysis view…* until the component is registered, and on a
  failure shows an error with **Retry**.
- **dt-ws reads module frontends once**, when it loads or reloads a module, and holds the bytes,
  their sha256 and gzip and brotli copies in memory. Files are opened without following symlinks
  and capped at 64 KiB (manifest) and 32 MiB (bundle).
- **`@dethernety/dt-module` is 0.13.0, and every API change in it is additive.** The new parts are
  the frontend-manifest helpers and subpaths, the engine probe, the schema and write-lock helpers,
  and the `./test-database` and `./cypher-lint` dev/test subpaths (see *Added*). The one change in
  behaviour is the knowledge-graph read order (see *Fixed*). A module that uses the new helpers
  needs platform 0.13.0 and should declare `"compatibility": { "dtModule": "^0.13.0" }` in
  `manifest.json`. For a 0.x version a caret range pins the minor version, so
  `scripts/package-module.js` refuses a manifest that still declares `^0.12.0` against dt-module
  0.13.0, and produces no package. `dethernety-general`, `dethernety-coverage-tools` and
  `dethernety-threat-report` declare `^0.13.0`.

### Removed

- **Two unused dt-core GraphQL documents:** `SUBSCRIBE_ANALYSIS_CHAT` and `GET_DUMP_MODEL_DATA`.
  Both queried fields the schema does not have, and nothing used them.
- **Breaking: the `getAvailableFrontendModules` and `getModuleFrontendBundle` queries.** Use
  `getFrontendModuleManifest` and the bundle route. dt-core's `DtModule.getAvailableFrontendModules()`
  and `DtModule.getModuleFrontendBundle()`, and the `GET_AVAILABLE_FRONTEND_MODULES` and
  `GET_MODULE_FRONTEND_BUNDLE` documents, are removed with them.

### Fixed

- **Statements Neo4j refused now run on both engines.** Neo4j 5 refuses an aggregating column that
  reads a variable its clause does not also project as a key; Memgraph runs it. Model deletion
  (`deleteModel`'s analysis lookup), `controlGaps`, `getControlsAssignedModels` and the threat
  report's ledger had that shape and failed on Neo4j. Each now collects in one `WITH` and adds the
  lists in the next, with the same rows on both engines.
- **Concurrent finding writes for one element no longer duplicate a finding or a binding.** Within
  one platform process these writes were already serialised per element; across processes, two
  writers could both find a finding absent and create it twice, or both rewire the same class
  binding. The exposure and countermeasure upserts and the class rebind now take the element's
  database lock (`writeLockClause`) before they read. On Neo4j the second writer waits and reads
  what the first committed; on Memgraph it conflicts and its write transaction is retried.
- **A threat report snapshot write retries a conflict.** Two runs of one analysis write the report
  snapshot to the same Analysis node. On Memgraph the second met a transient conflict and failed,
  because it ran as an auto-commit. It now runs in a write transaction: the conflict is retried and
  the last run to commit wins. A missing Analysis node still fails loudly.
- **Knowledge-graph answers are the same on both engines.** Each engine returned a rule's reads
  (`KgRule.reads`) and a threat's sources (`KgThreat.derivedFrom`) in an order of its own.
  dt-module's knowledge-graph normalisation now orders reads by name and sources by id, in
  code-unit order, so the local and remote clients answer alike on either engine.
- **The control dialog no longer saves a list with an empty row.** Clearing a row of a list in the
  control dialog's attribute form left a hole that reached the server as null, which the server now
  refuses. The dialog drops emptied entries from every list before it saves, so a list stored
  earlier with a null heals on its next save. An empty string stays: it is a value.
- **`byodt version` lists `NEO4J_IMAGE`.** Its pattern for the image lines in `.env` missed a name
  with a digit in it, so a Neo4j deployment's `version` did not show the image it runs.
- **On Neo4j a bootstrap index could go missing until the next restart.** dt-ws ran its index
  bootstrap and its constraint bootstrap side by side, and on Neo4j an index and a uniqueness
  constraint on the same label (`:Module(id)` and `:Module(name)`) could deadlock; the index lost
  that way stayed missing, and the lookups it serves scanned the label. The index bootstrap now
  starts once the constraint bootstrap has finished, on either engine.
- **On Neo4j, GraphQL queries that select a DateTime field no longer fail.** The GraphQL layer reads
  every DateTime field through `apoc.date.convertFormat` and writes `apoc.util.validatePredicate` into
  the checks of some mutations, and the bundle's Neo4j loaded no APOC, so such a query failed with
  `Unknown function 'apoc.date.convertFormat'`. `compose.neo4j.yaml` now sets
  `NEO4J_server_directories_plugins` to `/var/lib/neo4j/labs`, where the image ships the APOC Core
  jar, and `NEO4J_dbms_security_procedures_allowlist` to the two functions. Only those two load: no
  other APOC procedure or function can be called, none is granted unrestricted access, and nothing is
  copied, written or downloaded. At startup on Neo4j, dt-ws now lists both functions and, when both
  are listed, calls each once. It logs one error naming the missing functions, or saying they are
  listed but cannot run, and starts either way. A Neo4j you run yourself needs APOC Core loaded and
  both functions in `dbms.security.procedures.allowlist` (see the configuration guide, *Database
  (Bolt/Cypher)*).
- **Bootstrap schema statements run again after a transient error.** The new
  `DatabaseService.executeSchemaWrite` runs a schema statement as an auto-commit write and, when the
  engine answers with a transient code (`Neo.TransientError.*` or `Memgraph.TransientError.*`),
  runs it again: three attempts in all, pausing 200 ms and then 400 ms. Each retry logs a warning;
  only the last failure is logged as an error and thrown. Every schema statement of the index,
  constraint and old vector-index bootstrap goes through it. Any other error, including a lost
  connection or a database that cannot be reached, fails at once. `executeImplicitWrite` is
  unchanged: one attempt, no retry.
- **On Neo4j, opening a model no longer hangs.** Opening a model runs dt-core's `findAnalyses`,
  which filtered the analysed element with `single`. `element` points at the `Element` interface,
  and on Neo4j `@neo4j/graphql` renders `single` there as a XOR of one predicate per member type;
  with `Element`'s 28 member types, Neo4j ran out of heap while it was still planning the query, and
  the database answered nothing until it was restarted. `findAnalyses` now filters with `some`.
  Element ids are unique, so it finds the same analyses, on either engine.
- **dt-core's issue search by element or by module works.** `findIssues` filtered the model link
  and the module with fields the schema does not have (`model`, `module`), so a search by element
  or by module failed. It now filters the model link with `models`, and the module through the
  issue class, since an issue has no module link of its own.
- **dt-core's analyses lookup by module works.** `findAnalyses` filtered the module with a `module`
  field the schema does not have, so a lookup by module failed. It now filters the module through
  the analysis class.
- **Dethereal's control-class suggestion works.** When a control's `class_ids` names a class that is
  not a CONTROL class, the error lists the CONTROL classes of the same module. The lookup behind it
  filtered the module by a bare id instead of `{ eq: <id> }`, so it failed and the error came
  without the list.

### Security

- **One GraphQL request could exhaust a Neo4j database's memory, or stall dt-ws on either engine;
  dt-ws now refuses it.** A `single` filter on a relationship to an interface or union type renders
  on Neo4j as a XOR of one predicate per member type, and Neo4j's planner rewrites a XOR chain into
  a form that grows exponentially with its length. On a relationship to `Element`, one such request
  exhausted the database's heap while the query was still being planned, and the database answered
  nothing until a restart. With authentication off, anyone who could reach the API could send it;
  with authentication on, any signed-in user could. Every GraphQL transport now refuses, per
  request, any `single` filter, or deprecated `<field>_SINGLE` / `<field>Connection_SINGLE` field,
  on a relationship to an interface or union, with an error that names the filter's path and says to
  use `some`. `some`, `all` and `none` render as one predicate per member type joined by OR or AND,
  which grows linearly, and stay allowed, within new limits on what a request can make dt-ws
  translate and the database plan:
  - a **filter budget of 300**: each relationship or connection filter quantifier (`some`, `all`,
    `none`, and their deprecated `_SOME` … forms) costs the number of types it can match (28 on
    `Element`, 1 on a concrete type), and `all` costs twice that; an aggregate filter costs what a
    `some` on the same relationship does; a filter on a `@cypher` field costs 2, or 10 when the
    field's statement walks a variable-length path; a condition on a stored property, `in` lists
    included, costs nothing. The largest any platform client sends is 58;
  - at most **2,500 input objects** in all of a request's arguments, and **1,000** in its `where`
    arguments. A platform client's request grows only with links that carry a justification (a
    countermeasure create reaches 2,500 at 495 technique links), and sends at most 42 in `where`;
  - at most **640 relationship operands** in a request's mutation inputs: each item of a connect,
    disconnect, create, update or delete under a relationship counts once per type its target can be
    (28 on `Element`). A platform client's operands grow only with the same justified links;
  - at most **4,000,000 characters** of scalar values: a string counts its length, any other scalar
    one, a list or JSON value its entries summed;
  - input nested at most **64 levels** deep;
  - at most **10,000 selections** once fragments are expanded.

  dt-ws translates GraphQL into Cypher on its event loop, which is single-threaded, on either
  engine, and the statement grows with the request's arguments: one mutation with 24,000
  relationship operands held the event loop for 58 seconds, and dt-ws answered no other request
  meanwhile. This affects released versions on both engines; the input-object, operand and
  scalar-size limits bound what one request makes dt-ws translate. dt-core sends a link write that
  carries nothing but its target (`assignControlToElements`, an element's controls and data items, a
  model's modules and controls, the technique-link updates of exposures and countermeasures) as one
  operand per relationship with the ids in an `in` list, so the write stays the same size however
  long the list is.

  The limits count an input as often as `@neo4j/graphql` renders it: everything under a filter or an
  operand on an interface or union counts once per member type (28 times on `Element`), and under
  `all` twice that; a value counts once for every place it is used, as the library writes a value
  into a Cypher parameter of its own each time a variable is referenced, so one large list
  referenced from hundreds of places counts hundreds of times. A fragment counts once for every
  place it is spread, the filters are checked whether they are written in the query or sent in its
  variables, and a variable's default value is checked as execution applies it.

  On `/graphql` a refusal is a GraphQL error with code `BAD_USER_INPUT` and HTTP status 400, and so
  is a complexity-limit refusal, which was an internal error with HTTP status 500; on the
  `/graphql/stream` SSE endpoint it is a 400 whose error names the refusal; on the WebSocket
  transport it is GraphQL errors, sent with nothing run. In production `/graphql` replaces the
  message with "Internal server error", as for every error, and keeps the `BAD_USER_INPUT` code. The
  checks run on both engines. Neo4j support is new in this release, so no earlier release is affected
  by the Neo4j failure. **API callers:** a query that used `single` on such a relationship is now refused
  on Memgraph too; use `some` (a filter on a unique `id` matches the same nodes).
- **The WebSocket transport runs the query guards.** With `SUBSCRIPTION_TRANSPORT=ws`, the opt-in
  graphql-ws transport carries queries and mutations as well as subscriptions, and it ran none of
  the query guards: no depth limit, no complexity limit. It now runs the depth rules, the
  relationship-filter limits and the complexity limit for every operation, as `/graphql` and
  `/graphql/stream` do, and answers a refusal with GraphQL errors without running anything. This
  affects released versions on a deployment that set `SUBSCRIPTION_TRANSPORT=ws`; the default,
  `sse`, is unchanged.
- **Deeply nested fragment spreads could stall request validation.** The query-depth rule came from
  the `graphql-depth-limit` package, which re-measured a fragment at every place it was spread, so a
  small document of fragments that spread one another took exponential time to validate, and any
  client could send one. dt-ws now enforces the depth limit with its own rule, which measures each
  fragment once. The limit (`GQL_QUERY_DEPTH_LIMIT`, default 10), the way depth is counted and the
  refusal text are unchanged, and the `graphql-depth-limit` dependency is removed. This affects
  released versions.
- **Request guards are stricter and ordered the same on every transport.** The relationship-filter
  check refuses, with `BAD_USER_INPUT` and HTTP status 400, a value that is not an object where an
  input object is expected and a field the input type does not define, as variable coercion does; a
  null entry in a list of input objects counts as one input object. The check reads only the
  operation the request runs, selected by `operationName` as execution selects it, with only the
  variables that operation declares; a request that selects no single operation, because it holds
  several operations and no `operationName` or because no operation has the `operationName` it
  names, is refused with `BAD_USER_INPUT` and HTTP status 400. `/graphql/stream` validates the
  operation before the per-request guards run, as `/graphql` and the WebSocket transport do.
- **The bundle route's authentication** is `JwtAuthGuard` (a valid JWT, then `DEPLOYMENT_ALLOWLIST`),
  then the module allow-list (`ALLOWED_MODULES`). Without OIDC and with `NODE_ENV` other than
  `production`, the guard's development bypass leaves the route open, as it leaves every guarded route.
- **The bearer token stays on the API origin.** dt-ui fetches a bundle only from the API server's
  origin under `/module-bundles/`, and refuses redirects.
- **Bundle integrity.** dt-ui checks the bytes against the manifest's sha256 where `crypto.subtle`
  exists. It does not exist over plain HTTP on a host other than `localhost` or a loopback address,
  and there the check is skipped.
- **Caching limits.** The `private`, immutable cache is per browser profile: fine while bundles are
  deployment-wide, but it would bypass any future per-user authorization of bundles. Logout or
  revocation does not purge cached bundles, and a cached URL is served without a token. A CDN or
  reverse proxy in front of dt-ws must honour `private` and must not cache by path.
- **`blob:` stays in `script-src`.** The bundle is fetched with the bearer token and imported from a
  blob URL. Dropping `blob:` needs a same-origin bundle route that does not use a bearer token.
- Module frontends remain trusted code with full page privilege; the scoped registry prevents
  accidental key collisions and is not isolation. See `docs/SECURITY_MODEL.md`, *Module frontends*.

### Documentation

- The frontend module system, the frontend architecture's loading flow and host dependencies, the
  DTModule interface (a *Module frontend* section), the module package design, the threat report's
  frontend, the security model, and the GraphQL, schema, dt-core and module registry references
  describe manifest-based, on-demand loading.

## [0.12.1] - 2026-10-16

Modules ship their class vectors for the platform's default embedding profile, so a module install no
longer embeds its classes. This is a patch release: no API, schema or `.env` change beyond
`PLATFORM_VERSION`.

**Upgrading:** set `PLATFORM_VERSION` and run `./byodt update`; nothing else is needed. The first
start installs the bundled `dethernety-general` module once more (its files changed) and takes its
shipped vectors: no class is embedded, and the finding re-evaluation that follows the install finds
nothing to redo, since no class policy changed. A fresh deployment still downloads the model on its
first start (the platform embeds queries with it); the bundled module's install completes once the
model is ready. Dethereal, `byodt` (1.2.0), `mitre-frameworks` (1.2.0) and `@dethernety/dt-module`
(0.12.0) are unchanged.

### Changed

- **Modules ship class vectors for `embeddinggemma-300m-retrieval-v1`.** Each class carries
  `embeddings/embeddinggemma-300m-retrieval-v1.json` with `{profile, revision, contentHash, vector}`;
  the platform reads `vector` and `contentHash`. `dethernety-general` ships 81 (75 classes and 6 issue
  classes), so its install embeds nothing. In 0.12.0 every class was embedded at install, because the
  shipped files were for the old model names.
- **`module-manager embed` embeds with the platform's own embedder.** `pnpm embed` in a module (or
  `scripts/module-manager.sh embed <module-path>`) embeds in process with the same profile, document
  prompt, title, truncation and normalisation as the platform's install. It takes `--models-dir`
  (or `EMBEDDING_MODEL_DIR`), `--profile` (default: the platform's default), `--download` (fetch
  missing weights at the profile's pinned revision, verified by sha256) and `--batch-size`. A class
  whose file is already current is left alone. The new `module-manager.sh embed-all <modules-root>...
  [--exclude <module-path>]...` does every module in one embedder session. Build the embedder package
  first: `pnpm --filter @dethernety/embedder... build`. See the module development guide's
  *Pre-computed Embeddings*.
- **CI checks the shipped class vectors.** `scripts/check-module-embeddings.mjs` fails when a class
  has no vector file, the file is for another profile or weights revision, the vector is not 768
  finite unit-norm values, its `contentHash` no longer matches the class text (the class was edited
  without running `pnpm embed`), or another embeddings file exists.

### Removed

- **Breaking (module authors): `module-manager embed --model`, `--url` and `--api-key`.** An HTTP
  endpoint cannot reproduce the profile's prompt or model, so its vectors would rank wrongly. The
  producer no longer reads the retired JSON (`metadata.json`) class layout.
- **The `embeddings/embeddinggemma.json` and `embeddings/nomic-embed-text.json` files**, from every
  module: no supported profile reads them.

## [0.12.0] - 2026-10-16

**Upgrading:** this release removes the bundle's `ollama` service; the platform embeds in process.
Back up (`./byodt backup`), save `.env` (`cp .env .env.before-<version>`), keep the previous bundle
tarball, and make room on disk for the model (about 1.26 GB) and the new images: `data/ollama` can
only go once the upgrade has worked. Take the new bundle and set `PLATFORM_VERSION`. **In `.env`,
remove (or comment out) the `EMBEDDING_MODEL=embeddinggemma`, `EMBEDDING_SIMILARITY_THRESHOLD` and
`OLLAMA_IMAGE` lines:** `byodt` refuses the first and notes the others. Optionally run
`./byodt models pull` to download the model ahead, then `./byodt update`. Once the new start works,
`sudo rm -rf data/ollama` reclaims 0.6–1 GB; `byodt` never deletes it. **The first start after the
upgrade** re-ingests the MITRE data once (about a minute, with the platform down meanwhile),
downloads the model once (about 1.26 GB, unless `models pull` placed it), and **embeds every class
once, at about 0.2 s per class on a 4-vCPU host: seconds for the bundled modules (about 80 classes,
15–20 s), a few minutes with cloud content packages (about 1,200 classes); matching uses names
meanwhile.** **It then re-evaluates every element's findings once, in the background while the
platform serves, because no element records yet which class policy its findings came from:
findings the current class policies no longer emit are deleted with their dispositions** (see
*Fixed*, *A module update re-evaluates the findings of the classes it changed*). **Memory:** the
platform uses about 0.8–0.9 GiB more, which the removed `ollama` container used before, so the
host's total is about the same. To roll back, unpack the previous bundle tarball over the bundle,
restore the saved `.env`, then run `./byodt update`, `./byodt restore <backup>` and
`./byodt restart platform`; anything created since the upgrade is lost. See the operator guide's
Operations, *Upgrading from a release with the `ollama` service*. **Dethereal:** 0.4.15 is published
after the platform; it also works with 0.11.1. 0.4.14 was never published: its changes ship in 0.4.15.

### Added

- **`byodt models pull`** (byodt 1.2.0) downloads and verifies the embedding model's weights into
  `data/models` ahead of the first start. It runs the platform's own code in a one-off platform
  container, with no database, selects the model with the platform's rule (a refused
  `EMBEDDING_MODEL` is refused there too), and states the model's licence. `Ctrl-C` stops it without
  keeping a partial file. The platform image carries it as `dist/scripts/models-pull.js`, which exits
  0 when the weights are in place, 1 on a refusal or failure, 130 when stopped.
- **`byodt up`, `byodt update` and `byodt models pull` check `.env` before anything starts.**
  `EMBEDDING_MODEL=embeddinggemma`, however it is quoted, exported or followed by a comment, is refused
  with an instruction to remove the line. `OLLAMA_*`, `EMBEDDING_URL` and
  `EMBEDDING_SIMILARITY_THRESHOLD` lines get a "no longer used, you can remove the line" notice. A
  leftover `data/ollama` is reported with its size and `sudo rm -rf data/ollama` once the new start
  has worked; a `data/ollama` that is a symbolic link is reported as one, without naming or measuring
  its target. `byodt` never edits `.env` and never deletes `data/ollama`.
- **`console-init` checks the platform's embedding model.** Before the schema and the ingest, it
  refuses a platform model (`EMBEDDING_MODEL`, else the platform's default) other than the one the
  release's MITRE data was embedded with, and the platform then does not start. `byodt up` and
  `byodt update` report a start that `console-init` stopped with `'byodt logs console-init' says
  why`, under podman-compose too, whose `up -d` exits 0 when a dependency failed.
- **The platform logs the model's licence before a download.** EmbeddingGemma is licensed under the
  [Gemma Terms of Use](https://ai.google.dev/gemma/terms); the platform logs what it downloads, how big
  it is and under which licence, once, before the download.
- **New embedder query settings.** `EMBEDDING_QUERY_BACKLOG` (an integer, 100 to 100000, default 200)
  caps the query texts that may wait on the embedder. `EMBEDDING_QUERY_TIMEOUT_MS` (1 to 600000,
  default 10000) and `EMBEDDING_QUERY_TIMEOUT_PER_ITEM_MS` (0 to 60000, default 250) set a match's
  query-embed time limit: the base plus the per-text allowance for each text. A value outside its
  range stops the platform from starting. See *Security*, *Query embeds are bounded*.
- **`VectorDisabledReason` gains `EMBEDDER_BUSY`.** `matchMitreTechniques` reports it when the
  embedder was too busy to embed the request's queries in time; the deterministic tiers answered. The
  technique picker's caption for it reads *Semantic search is busy right now — showing name-based
  matches. Try again in a moment.* dt-core's `VectorDisabledReason` type includes it.
- **`ReindexResult.alreadyRunning`.** True when another `reindexClassEmbeddings` was already running:
  the call returned at once and re-embedded nothing.
- **`/health` counts embedder overloads.** The `embedder` block now carries `queryTimeouts` (query
  embeds that ran past their time limit) and `queryRefusals` (query embeds refused because the
  backlog was full), counted since the start. They do not change the overall status.

### Changed

- **Breaking: the platform embeds in process by default.** `EMBEDDING_MODEL` now defaults to
  `embeddinggemma-300m-retrieval-v1` (EmbeddingGemma 300m, Google), which runs inside the platform:
  its weights, about 1.26 GB, are downloaded once from Hugging Face into `EMBEDDING_MODEL_DIR` and
  verified by sha256. Leave `EMBEDDING_MODEL` unset.
- **Breaking: refused embedding models.** With `EMBEDDING_ENABLED=true` the platform refuses to start,
  before it connects to the database, on `EMBEDDING_MODEL=embeddinggemma` (the old HTTP model: remove
  the line), on `embeddinggemma-2-text-retrieval-v1` (not available in this release: its MITRE vectors
  are not published yet), and on any unknown id. With embedding off nothing is refused.
  `EMBEDDING_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_DIMENSIONS` and `EMBEDDING_SIMILARITY_THRESHOLD`
  are ignored, with one warning each; they never stop a start. `EMBEDDING_THRESHOLD_CLASSES`,
  `_MITRE` and `_COMPONENTS`, `EMBEDDING_MODEL_DIR` and `HF_TOKEN` are unchanged.
- **The bundle keeps the model's weights on the host.** The platform gets `EMBEDDING_MODEL_DIR=/models`,
  bound to `./data/models`, so a recreate does not download them again. `byodt` creates `data/models`
  on `up`, `update` and `restart`, with the sticky bit, and refuses a `data/*` runtime directory that
  another local account owns, a link or a plain directory. The platform refuses a weight file when
  anything on its path below the models directory is a symbolic link, is owned by an account other
  than its own, root or the models directory's owner, or is writable by accounts other than its owner
  (a sticky directory excepted). No other local account can then swap the model between its sha256
  check and its load, or plant a directory before a download, except root and, under rootful Docker,
  a host account with the platform's uid (1001). Weights copied in for an offline host are copied as
  the account that runs `./byodt`: files copied as root pass only under rootful Docker, and rootless
  Podman refuses them. The bundle also passes `EMBEDDING_THREADS` (default 4) to the platform.
- **A shutdown during the model download stops at once.** The platform aborts a download in flight,
  or its retry wait, removes the partial file, and loads nothing once the shutdown has begun.
- **The shipped MITRE vectors are made with the platform's built-in profile.** The MITRE ATT&CK,
  D3FEND and ATLAS vectors are now embedded with `embeddinggemma-300m-retrieval-v1`, and the
  `mitre-frameworks` module is now version 1.2.0. Its embeddings exporter defaults to the manifest's
  profile and never skips: without a provider, or on any failure, it exits non-zero and writes nothing.
- **Dethereal's `manage_countermeasures` no longer updates or deletes a SYSTEM countermeasure** (Dethereal 0.4.15). A
  SYSTEM countermeasure (or one with no `createdBy`) is derived from its control's class policy, and
  the platform rewrites it from that policy on each save of the control. `update` now refuses any
  update of one: links, `exposure_ids` and plain fields alike. The error names the countermeasure and
  says to supersede it into a USER copy (in the platform, **Customize as an editable copy** on the
  countermeasure) and update the copy. `delete` refuses one too, since the next save would re-create
  it; the error says to change the control's attribute answers so the policy no longer derives it, or
  to supersede it into a USER copy. USER countermeasures update and delete as before; `create`,
  `get` and `list` are unchanged.

### Removed

- **Breaking: the HTTP (Ollama- or OpenAI-compatible) embedder.** The platform no longer calls an
  external embedding endpoint.
- **Breaking: the bundle's `ollama` service.** `byodt` 1.2.0 removes the old `ollama` container on
  `up`, `update`, `restart`, `down` and `destroy`, found by its compose project and service labels;
  its image and `data/ollama` are kept. `byodt version` no longer lists `OLLAMA_IMAGE`.

### Fixed

- **A control reference no longer attaches a control by part of its name.** Import and model update
  attached a control whose name only contained, or was contained in, the name a model file gave, so
  a reference to "Encryption at rest for S3 buckets" could attach a control called "Encryption", and
  "Firewall" whichever firewall control came first. A control is now attached by its id, by its
  exact name, or by a name that matches a single control when case and surrounding spaces are
  ignored. A name that matches no control, or that several controls share, attaches nothing: the
  import or update result lists it under `unresolvedControls`, and a warning names it, with the ids
  of the controls a shared name matched so the reference can be pinned to one. Each entry under
  `unresolvedControls` names, as `owner`, the model or element the reference came from. Dethereal
  users get this fix with Dethereal 0.4.15.
  **Check your model files:** a control that a name-only reference attached only by part of its name
  ("Firewall" for a control called "Perimeter Firewall") is detached from its element on the next
  model update. Dethereal keeps the reference in the model files and warns about it; give it the
  control's id or its full name to attach the control again.
- **A model update no longer removes a control because its name is shared.** When a name in the
  model file matches several controls and the element already has one of them, the update keeps it
  and warns, where it used to replace the element's controls without it.
- **An import attaches a control by name only against the full control catalog.** When the
  catalog of controls in folders cannot be fetched, a name could look unique among the controls
  outside folders and attach the wrong one; such a reference is now reported as unresolved, and only
  an id attaches.
- **Dethereal keeps an unresolved control reference in the local model files.** A push rewrites
  the files from the platform, which dropped any control reference the platform could not attach,
  including a name several controls share. The reference now stays where it was written, so it can
  be pinned to a control id, and the next push reports it again.
- **A malformed answer from a remote knowledge-graph service is no longer read as an empty graph.**
  An answer without a result list, with a malformed entry, or missing one of the keys it was asked
  for was taken to mean the graph held nothing for those keys, and was cached as such. It is now a
  service fault, like a truncated answer: the query fails and nothing is cached.
- **"Add to Issue board" from a module's finding links what it names.** A finding raised on a model
  with no element put an empty id on the issue board's clipboard, so adding it to an issue failed
  and linked nothing, without a word. Only the ids given are carried now, and the issue card says
  when elements could not be linked.
- **A module's own finding description is the issue's description.** An issue raised from a module
  finding that carries a description was described as "Exposure: <description>". The description
  is now used as given; a finding passed by name only is still described as "Exposure: <name>".
- **Changing the embedding model re-embeds the installed classes.** At start the platform skipped a
  module whose content hash matched its last complete install. Only modules written in code, which
  ship no hash, noticed a change of embedding model; every file module and every published package
  module was skipped, its classes kept vectors from the old model, and the class vector tier stayed
  off. Each install now records the embedding model its class vectors are made with, and a change of
  model, of dimensions, or switching embedding on or off reinstalls every module at the next start
  so its classes are embedded again. The start also checks the classes' own vectors: a module whose
  searchable classes hold vectors of another model, or none, is installed again even when its record
  matches, for example after an older platform version installed it again. **The first start after
  the upgrade reinstalls every module once**, because no module has that record yet; later starts
  skip them again while they are unchanged. With the embedding model unchanged, that reinstall
  reuses the vectors the modules ship for it and embeds only classes that have none; it takes as
  long as a full install of the modules. A manual `reindexClassEmbeddings` records the model too, so
  the next start does not reinstall those modules.
- **Classes are embedded when the embedder becomes ready, without a restart.** A module installed
  before the embedder was ready kept its stored class vectors and was marked partial, and only the
  next start installed it again. That happened when an in-process model finished its download or load
  after the module install. When the embedder becomes ready, the platform now installs the waiting
  modules again, with vectors; modules already embedded with the active model are skipped. The module
  install at start also waits up to 60 seconds for an in-process model whose files are already in
  place; a download is never waited for. Module installs and module resets now run one at a time.
- **A save keeps a finding's links in line with its class policy.** A SYSTEM exposure or
  countermeasure that the class policy still emits kept every link an earlier save wrote, so a
  technique, mitigation or D3FEND reference the policy had dropped stayed linked. A save now deletes
  every link of the writer's own types (`EXPLOITED_BY` on exposures; `RESPONDS_WITH` and the eight
  `COUNTERMEASURE_<VERB>` types on countermeasures) to a MITRE or regulatory node that is not among
  the finding's resolved references in that save. A link added by hand to a SYSTEM finding is
  removed too. A link the policy keeps stays once: its parallel copies are deleted. An edge to a
  MITRE or regulatory node that lacks the property it is keyed by is left alone. USER findings,
  including copies made with **Customize**, are never touched. A `justification` the policy no
  longer gives is cleared from the edge, where it used to stay. A
  target named twice under one link type is written once, and the mention with a justification
  wins. A dispositioned SYSTEM finding whose links change is flagged stale, as an attribute change
  flags it, and the save's `staleFlippedCount` includes it.
  **Upgrading:** the first start re-evaluates every element once in the background (see *A module
  update re-evaluates the findings of the classes it changed*), which brings its links in line. An
  element of a remote module, or of a class without a `policyHash`, is not re-evaluated and keeps its
  old links until it is saved again; saving it with no changes (`setInstantiationAttributes` with
  `{}`) is enough. That first re-evaluation or save can mark as stale any saved result that
  fingerprints the removed links. USER copies made before this release keep the links they were
  copied with.
- **A binding change removes the findings a kept class no longer emits.** `changeElementBinding`
  deleted only the findings of the classes it removed, so a Control that kept a class while its
  class set changed also kept that class's countermeasures, even ones the class no longer emits.
  After the upsert of each class the element is bound to, the binding change now runs that class's
  obsolete-finding cleanup, the same one a save runs, and counts what it deletes in
  `deletedDerivedCountermeasures` / `deletedDerivedExposures`.
- **A module update re-evaluates the findings of the classes it changed.** An element's findings
  followed the class policy of its last save, so after a module update it kept findings the new
  policy no longer emits, lacked the ones it now emits, and kept old links until someone saved it.
  Each class's metadata now carries `policyHash`, the sha256 of the policy source its evaluation
  compiles (the hash of the empty source for a class with no policy; none for an issue class or a
  policy that failed to register), and the install writes it on the class node; dt-module's class
  metadata types declare it. Every save (`setInstantiationAttributes`, and so import) and every
  `changeElementBinding` records on the element the class's `policyHash` as read before the
  evaluation, in an internal property that is not in the GraphQL schema or in exports. It records
  it only when the module that evaluated reports the same hash through the new optional
  `DTModule.getPolicyHash` (a module without it is taken at the stored hash), so an instance still
  holding an older policy leaves the binding unrecorded, and a later sweep re-evaluates it. After an
  install that wrote at least one module (start-up, catch-up or module reset), and once in the
  background after start, the platform finds the
  bindings whose record differs from their class's `policyHash`, or that have none, and saves each
  again with no attribute changes, through the save's own path and under the element's lock. New
  findings are created, findings the policy no longer emits are deleted with their dispositions,
  and links are reconciled, with `dispositionStale` set on a link change, exactly as on a save. USER
  findings, including copies made with **Customize**, and findings from other sources are not
  touched. One sweep runs at a time; any number of installs during a sweep add one more after it.
  The sweep and the element lock are per platform instance: run one platform instance (the bundle
  does). Several instances each sweep, which is safe for the records but repeats the work.
  An element that fails keeps its findings, is retried once at the end of the sweep, and is tried
  again by the next sweep; a sweep never fails an install. Bindings of a class without a
  `policyHash` are skipped and counted; a remote module's classes carry none, so its bindings, which
  evaluate only with a caller's token, are skipped as such.
  Each sweep that found anything logs one summary line (`Re-evaluated findings after a class policy
  change`, a warning when an element failed) with the counts and up to three ids each of the failed
  and the skipped elements.
  **Upgrading:** no element has a record yet, so the first start re-evaluates every element once in
  the background after start. Findings the current class policies no longer emit are deleted then,
  with their dispositions. A USER copy made with **Customize** is kept, even when its original is
  deleted. A module whose content did not change is still reinstalled once when its classes'
  `policyHash` is not recorded on their class nodes, so that re-evaluation covers its elements too.

### Security

- **Query embeds are bounded, so a flood of matches cannot stall the embedder.** The in-process
  embedder serves one request at a time, and any signed-in client could queue unbounded query work
  behind it through `matchClasses` and `matchMitreTechniques`, so every match waited on it. The
  embedder now counts the query texts posted to it and not yet answered, and refuses at once a query
  embed that would take the count past `EMBEDDING_QUERY_BACKLOG` (default 200). A match's query embed
  also has a time limit: `EMBEDDING_QUERY_TIMEOUT_MS` (default 10 s) plus
  `EMBEDDING_QUERY_TIMEOUT_PER_ITEM_MS` (default 250 ms) per text. The model cannot be stopped
  mid-run, so a timed-out embed keeps its place in the count until the model finishes it, and its
  result is dropped. On a refusal or a timeout the match answers from the name tiers with
  `vectorAvailable: false`, and `matchMitreTechniques` reports `vectorDisabledReason: EMBEDDER_BUSY`.
  Neither is retried text by text, and the text-by-text fallback after a failed batch stops at the
  first one. Document embeds (module install, catch-up, `reindexClassEmbeddings`) are neither counted
  nor timed. The warm-up is a query embed of one text: it is counted, has no time limit, and runs
  before any match can reach the embedder. `matchClasses` cuts each element's composed query text
  to 2,000 characters. A second `reindexClassEmbeddings` while one runs returns at once with
  `alreadyRunning: true` and embeds nothing. Each refusal or timeout logs one warning per request,
  with counts and no query text, and `/health` counts both (see *Added*).
- **The MITRE embeddings build refuses headers and statements outside the shape it writes.** The
  `05` and `09` embeddings files open with `//` header comments that carry the weights' repository,
  revision and dtype from the embedder helper's ready line, so a value holding a line break could
  end its comment and put a statement into the file. The exporter now refuses a ready line whose
  `repo`, `revision` or `dtype` does not fully match its plain ASCII format (a trailing newline
  fails it), and refuses a header line that is not printable before it opens the file. dt-module's
  `validateProfile` refuses a `runtime.dtype` outside `[a-z0-9]+`. Both embeddings file checks (the
  module's packaging check and the platform's CI test) now match each statement, with its comments
  dropped, against the exact shape the exporter writes: the `UNWIND` of the rows, one `MATCH` and
  one `SET` of `embedding` and `embeddingModel`, so a statement with a clause before its `UNWIND`,
  between its rows and its `MATCH`, or after its `SET` is refused. The shipped files pass both.

## [0.11.1] - 2026-10-13

The bundle's embedding server now keeps its model loaded, so the first search after a quiet period
no longer waits for the model to load again. The HTTP embedder is reported ready only once its
endpoint answers; when it does not, the detailed `/health` response gives the reason. Class matching
and MITRE technique search make one embedding call per request instead of one per text. `/health`
reports the release version. The embedding settings are checked at start, and a blank one means
unset. Modules written in code are no longer reinstalled on every start. A model update tolerates a
class the platform does not have; Dethereal users get this with Dethereal 0.4.13. This is a patch
release: no API, schema or data change. Compared against the previous tag, `v0.11.0`.

**Upgrading:** take the new bundle and follow the operator guide's upgrade procedure — back up,
unpack, set `PLATFORM_VERSION`, `./byodt update`. The only line of `.env.example` that changed is
`PLATFORM_VERSION`. Take the new bundle's `compose.yaml`: it sets `OLLAMA_KEEP_ALIVE=-1` on the
`ollama` service. **No other `.env` change is needed.** **The embedding model stays in memory.**
With `OLLAMA_KEEP_ALIVE=-1` the model stays resident in the `ollama` container for as long as it
runs, instead of unloading after 5 minutes idle, so that memory is now held the whole time. **A
non-numeric `EMBEDDING_SIMILARITY_THRESHOLD` now stops the start.** A value that is not a number, or
one outside -1 to 1, stops the backend with a message that names the variable; earlier releases
accepted it silently. If the setting was changed from the bundle's `0.40`, check it before
upgrading. An empty or blank value now means unset. **The first start after the upgrade waits
briefly for the embedding server:** the start-up check makes up to three attempts, at most about
half a minute. That start also reinstalls the modules written in code once, because the platform
version is part of their computed hash; later starts skip them while they are unchanged. **Dethereal
0.4.13** carries the model-update fix to plugin users. It is published after the platform, and it
also works with platform 0.11.0, since this release changes no API. **Do not select an in-process
ONNX embedding profile yet.** As with 0.11.0, keep `EMBEDDING_MODEL` on an HTTP model, such as the
bundle's `embeddinggemma`.

### Changed

- **The bundle's embedding server keeps its model loaded.** By default Ollama unloads a model after
  5 minutes without a request, so the first search after a quiet period waited for the model to load
  again. The bundle's `compose.yaml` now sets `OLLAMA_KEEP_ALIVE` to `-1` on the `ollama` service:
  the model stays resident for as long as the server runs instead of unloading after 5 minutes idle,
  and the backend's start-up check of the HTTP embedder loads it when the platform starts. The cost
  is memory — the embedding model stays in the `ollama` container's memory the whole time. To
  upgrade, take the new bundle's `compose.yaml`; no `.env` change is needed.
- **Class matching and MITRE technique search embed a request's texts in one call.** Class
  matching embedded each element's description with its own request to the embedding model, one
  after another, and MITRE technique search did the same for each query that matching by ID, name
  and description left unanswered, so a request with many elements or queries made as many
  embedding calls in a row. Each request now embeds all of those texts in one call, then searches
  per element or query; the results are the same. This cuts the round trips to the embedding server,
  where every Ollama request carries a fixed cost, and lets the in-process embedder batch the texts.
  If the embedding server answers the batch with an error, each text is embedded on its own, in one
  attempt without further retries, so a text that cannot be embedded still skips only its own vector
  search, with the same logged warning as before. If the server cannot be reached, the request's
  texts skip their vector search at once, without a further attempt per text.

### Fixed

- **`/health` reports the platform release version.** The detailed response's `version` read
  `0.0.1` on every deployment of the platform image. It now carries the release version, such as
  `0.11.0`, or `unknown` when the backend cannot determine it. The production response still carries
  only the overall status.
- **`EMBEDDING_SIMILARITY_THRESHOLD` is checked at startup.** The backend accepted any value, so a
  setting such as `high` or `NaN` silently disabled or broke the similarity floor for class matching
  and MITRE technique search. It is now checked like the per-corpus `EMBEDDING_THRESHOLD_*`
  settings: a value that is not a number, or one outside -1 to 1, stops the backend from starting
  with a message that names the variable. The bundle's default of `0.40` is unaffected.
- **An empty similarity floor now means unset.** A line such as `EMBEDDING_THRESHOLD_CLASSES=` in
  `.env` was read as a floor of 0. An empty or blank `EMBEDDING_THRESHOLD_CLASSES`,
  `EMBEDDING_THRESHOLD_MITRE`, `EMBEDDING_THRESHOLD_COMPONENTS` or `EMBEDDING_SIMILARITY_THRESHOLD`
  now counts as unset, the same as leaving the line out, so the next setting in line or the
  embedding profile's value applies. An empty or blank `EMBEDDING_THREADS` likewise means the
  default of 4 threads; it used to stop the backend from starting.
- **The HTTP embedder is ready only after its endpoint answers.** The backend reported the HTTP
  embedder as ready at start without contacting `EMBEDDING_URL`, so a wrong URL, an unreachable
  server or a model with the wrong dimensions showed as ready in `/health` and searches then failed
  one by one. At start the backend now embeds one short text and expects a vector of the configured
  dimensions. If that fails, the embedder is `failed`, the detailed `/health` response gives the
  reason, and the backend checks the endpoint again every minute until it answers, then becomes
  ready without a restart. The module install at start waits for the check, at most about half a
  minute, so the class vectors are embedded on the first start; if the check failed, the modules are
  marked partial and a later start embeds them.
- **Modules written in code are no longer reinstalled on every start.** The backend skips installing
  an unchanged module by comparing its content hash, but only file modules shipped one, so modules
  written in code, such as the Threat Report (`dethernety-threat-report`) and
  `dethernety-coverage-tools`, were fully reinstalled at every start. The backend now computes a
  hash for a module that ships none, from its metadata, the active embedding model and the platform
  version. Such a module is reinstalled when its metadata changes (a class, a class field, the
  module version), when the embedding model or its dimensions change, or when the platform is
  upgraded (once per upgrade), and skipped otherwise. A module that serves its own pre-computed
  vectors and ships no hash is still installed on every start. `MODULE_LOAD_FORCE=1` still
  reinstalls every module.
- **A model update tolerates a class the platform does not have.** An update of an existing model,
  such as Dethereal's `update_model`, used each element's class id exactly as the model files gave
  it. A class the platform did not have, for example because its module is not installed there,
  made the update report failure with a message that named neither the element nor the class, even
  though the rest of the update had already been written. Update now finds classes as import does:
  by id, then by module and class name, so a class with a different id on this platform is still
  found. An element whose class the platform does not have keeps its current class and answers, the
  update adds a warning that names the element, and the update carries on. The errors that remain,
  such as a class binding or an answer write the platform refuses, now name the element and give
  the platform's reason. After the push, Dethereal keeps that element's class and answers in the
  local model files, so they still show the class you chose. Dethereal users get this fix with
  Dethereal 0.4.13.

### Documentation

- **The embedding configuration references describe the start-up check.** The configuration guide
  states that an empty or blank similarity floor counts as unset, and that a non-numeric or
  out-of-range `EMBEDDING_SIMILARITY_THRESHOLD` stops the backend like the per-corpus floors. It
  describes the HTTP embedder's start-up check: up to three attempts and at most 34 seconds,
  `loading` while it runs, `failed` with the reason in the detailed `/health` response, and a new
  check every minute until the endpoint answers. It also states that the start-up module install
  waits for that check, and that `/health` reports the release version or `unknown`. The BYODt
  configuration page explains that the bundle sets `OLLAMA_KEEP_ALIVE` to `-1`, so the embedding
  model stays loaded and its memory stays held.
- **The embedding service references follow readiness and batched embedding.** The custom resolver
  services reference states that the embedding service is enabled only when configured and ready,
  documents its pending state, its state values and its wait for the start-up check, and drops the
  per-session disable; the pre-computed embeddings specification drops it too. The class and
  control resolver architecture describes class matching embedding a request's elements in one
  call, and each text on its own when the batch fails.
- **The module install references describe the content-hash skip.** The module management service
  reference describes the install phases — the wait for the embedder check, vectors made outside
  any transaction, one write transaction per module, then the obsolescence sweep and the
  post-commit hooks — and the skip gate, with the hash computed for a module written in code from
  its metadata, the active embedding model and the platform version. The module development guide
  gains a section on what each kind of module needs for an unchanged install to be skipped.
- **The model update references describe class resolution.** The data-access library's
  import/export notes describe the class resolver that import and update now share, and what each
  does with a class it cannot find; its operations notes state that update reads the platform's
  reason for a refused answer write. The Dethereal sync notes gain a section on class resolution on
  push: the warnings, the local files keeping the chosen class, and the errors that remain. The
  sync user guide gains a section on classes the platform does not have.

## [0.11.0] - 2026-10-12

A data item can now record who can write its content and whether it is a credential. Both fields
are optional, editable in the data-item dialog, and carried through import, update, export and the
Dethereal plugin. Search by meaning — class matching and MITRE technique matching — is now an exact
cosine search in the database. There is no class vector index left to keep healthy, and the search
runs on Neo4j as well as Memgraph. Class matching now runs the exact-name and vector tiers together,
so a name hit no longer hides closer matches by meaning. An element bound to a class but carrying no
attribute answers now gets that class's exposures when a model is imported or updated. The embedding
setting now names an embedding profile, and the platform image moves to a glibc base.
Compared against the previous tag, `v0.10.1`.

**Upgrading:** take the new bundle and follow the operator guide's upgrade procedure — back up,
unpack, set `PLATFORM_VERSION`, `./byodt update`. The only line of `.env.example` that changed is
`PLATFORM_VERSION`. **No other `.env` change is needed:** the bundle keeps Ollama, and its
`EMBEDDING_MODEL=embeddinggemma` is now the built-in legacy HTTP embedding profile, so the platform
embeds as before and `EMBEDDING_SIMILARITY_THRESHOLD` still applies. A deployment that set
`EMBEDDING_MODEL` to another model keeps the HTTP embedder with that model and logs a warning at
start. **Class vector indexes are no longer used.** Class matching is an exact cosine search, so the
platform no longer creates, checks or rebuilds a class vector index. It does not drop the ones an
earlier version created either: they stay in the database, unused. The `Vector index … rebuilt`
lines for class indexes no longer appear at start, and the stored class vectors are used as they
are. The MITRE technique vector indexes are kept: on Memgraph the platform still creates and repairs
them in the background, so `MITRE vector index … rebuilt` can still appear. **The new data-item
fields need no migration:** `origin` and `isCredential` are optional, and existing data items read
them as null. **Dethereal needs this platform:** Dethereal 0.4.12, built from this code, reads
`Data.origin` and `Data.isCredential`, which older platforms do not have, so it needs platform 0.11.0
or later. It is
published after the platform; upgrade the platform first. **Do not select an in-process ONNX
embedding profile yet.** The two ONNX profiles exist, but module install does not wait for the
embedder to load, so classes installed while it loads get no vectors. Keep `EMBEDDING_MODEL` on an
HTTP model, such as the bundle's `embeddinggemma`. **The platform image runs on a glibc base:** `node:26-trixie-slim` replaces
`node:26-alpine`. The app user keeps uid and gid 1001, so directory ownership on existing
deployments is unchanged. The linux/amd64 image is 1.14 GB. API clients should
read *Changed* for a removed enum value and a removed argument.

### Added

- **Data items record the origin of their content.** `Data.origin` takes a `DataOrigin` value that
  says who can write the item's content. The seven members run from most to least trusted:
  `AUTHENTICATED_FIRST_PARTY`, `CURATED_INTERNAL`, `AGENT_RELAYED`, `MODEL_GENERATED`, `THIRD_PARTY`,
  `ARBITRARY_PUBLIC` and `NOT_ASSESSED`. The last three are untrusted. Null means unclassified. The
  value is the model author's assertion; the API generates the filters and update inputs for it.
- **Data items record whether they are a credential.** `Data.isCredential` is a Boolean. Null means
  unknown, and `false` is an answer. Filters and update inputs are generated as for `origin`.
- **The data-item dialog edits origin and the credential flag.** The **Origin** select lists the
  members in trust order, each with a one-line meaning, and marks the three untrusted ones with an
  **untrusted** chip. The **Credential** select offers yes, no or unknown. Both behave like
  sensitivity: they are sent only when edited, and a cleared value is sent as an explicit null.
- **The data-access library carries origin and the credential flag.** The local split format gains
  `origin`, a lowercase token, and `is_credential`, next to `sensitivity` and `regulatory_flags`.
  `ORIGIN_LEVELS` (the ordered tokens) and `UNTRUSTED_ORIGINS` are exported from the package root. An
  unknown origin is dropped with a warning. Import sets both fields on create. The model update push
  is a full sync, so a file that omits them clears them. Export writes `is_credential` including
  `false`; a null on the platform writes no key.
- **Dethereal 0.4.12 validates and hints at the new fields.** `validate_model_json` accepts `origin`
  (one of the `ORIGIN_LEVELS` tokens) and `is_credential` (a boolean); any other value is a
  validation error. `get_model_schema` documents both, and the `sensitivity` and `regulatory_flags`
  fields it was missing. The quality check reports items bound to a credential-like data class whose
  `is_credential` is unanswered as `credential_hints`. It is a hint only: it never sets the field, an
  answered `false` is kept, and the quality score does not depend on it.
- **Dethereal 0.4.12 asks for data origin and confirms credential flags.** The security enricher, the
  enrich skill and the threat-model workflow ask for a data item's origin where the source of its
  content is known, with the least-trusted source winning. They propose `is_credential: true` from the
  credential hints in one batch that the user confirms; nothing is set silently. Review and the model
  reviewer surface the hints, and items without an origin on flows into external entities or agent
  components, as Info only. Sync pushes and pulls both fields.
- **Embedding profiles.** `EMBEDDING_MODEL` now names an embedding profile, which sets the prompts,
  the vector dimensions and the similarity threshold for each corpus. There are three built-in
  profiles: `embeddinggemma`, the HTTP embedder without prompts that the bundle uses, and two
  in-process ONNX profiles, `embeddinggemma-300m-retrieval-v1` and
  `embeddinggemma-2-text-retrieval-v1`, with retrieval prompts. A value that is not a built-in profile
  keeps the HTTP embedder with that model name and the `embeddinggemma` thresholds. The module base
  library's `./embedding` entry exports the profile API and the vector search query builder, and
  still exports the embedding-text helpers.
- **An in-process ONNX embedder.** The new `@dethernety/embedder` package runs an ONNX profile inside
  the platform. It fetches only the files the profile lists into `EMBEDDING_MODEL_DIR`, checks each
  file's size and sha256 before use, and does not fetch a file that is already present and verified,
  so weights can be placed offline. It follows redirects over HTTPS only, sends a token only to the
  profile's hub, never logs URLs or headers, and refuses symbolic links or paths outside the models
  directory. It sets `ORT_DISABLE_TELEMETRY=1` before onnxruntime loads, overriding the environment,
  so onnxruntime sends no usage telemetry; the platform image sets it too. Selecting an ONNX profile
  is not supported yet (see **Upgrading**).
- **New embedding settings.** `EMBEDDING_MODEL_DIR` holds in-process weights. `EMBEDDING_THREADS` (1
  to 64, default 4) sets the ONNX thread count. `EMBEDDING_THRESHOLD_CLASSES`,
  `EMBEDDING_THRESHOLD_MITRE` and `EMBEDDING_THRESHOLD_COMPONENTS` set a cosine floor per corpus and
  take precedence over `EMBEDDING_SIMILARITY_THRESHOLD` and the profile; a value outside -1 to 1 stops
  the platform from starting. `HF_TOKEN` is a token for a gated weight source. Under an ONNX profile,
  `EMBEDDING_SIMILARITY_THRESHOLD` is ignored with a warning that names the per-corpus settings.
- **`/health` reports the embedder.** When embedding is enabled, the response includes an `embedder`
  block with its state, runtime, profile and any error. An enabled embedder that is not ready makes
  the status `degraded`, still with HTTP 200. The HTTP embedder is ready from the start.
- **Search by meaning runs on Neo4j.** Class matching and MITRE technique matching rank with each
  engine's own cosine function, so the vector tier now runs on Neo4j as well as Memgraph.

### Changed

- **Search by meaning is an exact cosine search.** Class matching and MITRE technique matching score
  every candidate that carries a vector of the active embedding model, of the right length, with the
  database's cosine function, and keep the top results. A self-test on first use checks that
  orthogonal vectors score 0 and opposite vectors score -1; if it fails, the vector tier stays off and
  the test is retried. Class matching uses no vector index, and module install no longer touches
  indexes. The MITRE vector indexes are still kept on Memgraph, in the background, for consumers that
  search them by name; their upkeep never affects whether the vector tier is available. A MITRE index
  with the wrong dimension is rebuilt instead of turning vector search off for the whole process.
- **Class matching runs the exact-name and vector tiers together.** Before, an exact-name or a name
  containment hit ended the cascade, which could hide better matches by meaning. Now exact-name hits
  come first, followed by the vector hits not already listed, cut to `topN`. Name containment and the
  type heuristic run only when neither tier answers. The class picker focuses an exact-name top hit
  even when vector hits follow it.
- **The vector availability check is cached.** Class matching used to count, on every request,
  whether any class in scope has a vector of the active profile, and logged a warning each time. The
  answer is now kept for ten minutes per label, module scope and profile; concurrent requests share
  one read, and the warning is logged once per key. A failed read is not kept.
- **Similarity scores are cosines, and two API items are removed.** `similarityScore` is now the
  cosine similarity, from -1 to 1. `VectorDisabledReason` loses `NO_INDEX_MODULE`; `EMBEDDING_DISABLED`
  now also covers an embedder that is not ready and a database that cannot run vector search.
  `reindexClassEmbeddings` loses its unused `capacity` argument, so a client that still sends it gets
  an error. `vectorAvailable` means the embedder is ready, the database runs vector search, and at
  least one class in scope has a vector of the active embedding model.
- **`reindexClassEmbeddings` writes only valid vectors.** It skips a vector that is not of the right
  length, finite and non-zero, and its count includes only the vectors it wrote.
- **A module install keeps class vectors while the embedder is not ready.** When embedding is enabled
  but the embedder is still downloading, loading or has failed, an install keeps the stored class
  vectors and is marked partial, so a later install embeds. One warning per start names the embedder
  state. With embedding disabled, an install still removes class vectors, as before.
- **`setInstantiationAttributes` accepts an empty object.** It writes nothing and evaluates the
  element against the answers already on its binding. Arrays, non-objects and nested values are still
  rejected.
- **Import and update write attributes four at a time.** The writes are queued while elements are
  created, then run four at a time once every element exists, before data items and controls are
  associated and before orphans are deleted. The result is the same; a large import no longer waits
  for the platform's write debounce once per element.
- **The platform image runs on a glibc base.** `node:26-trixie-slim` replaces `node:26-alpine`. The
  app user keeps uid and gid 1001, and curl stays for the health check. The image bundles the
  embedder, keeps only the onnxruntime binaries for its own platform, and drops the pnpm store from the
  install layer, which keeps it at 1.14 GB on linux/amd64 (1.87 GB without that pruning).
- **Integration suites can use an existing Memgraph.** `MEMGRAPH_TEST_URI`, a plain
  `bolt://host:port` URI, points the backend's integration suites at an existing Memgraph instead of
  starting a container. Every suite wipes the graph, so the target must hold nothing worth keeping;
  a suite that needs its own image, flags or container operations refuses to run against it. Test
  containers now publish their ports on 127.0.0.1 only, and the Neo4j harness runs
  `neo4j:5.26-community`.

### Fixed

- **An element bound to a class with no answers gets that class's exposures.** The attribute write is
  what evaluates an element's class, and import and update skipped it when the file carried no
  answers. They now send an empty write for components, boundaries, data flows and data items on
  create, and on update when re-binding the same class changes nothing.
- **Update and push write data-item attributes.** A data item created by an update now gets its
  attributes written, which that path used to drop. A push that updates an existing data item now
  writes its attributes too, so edited answers are kept and a class bound with no answers is
  evaluated.
- **Module archives built on macOS leave out AppleDouble files.** macOS `tar` can add `._*` entries
  next to files with extended metadata, and the module loader would try to load them as module code.
  The archive step now sets `COPYFILE_DISABLE`. This is preventive.
- **Writing several elements of one class at once no longer fails an exposure update.** On Memgraph,
  writing several elements of the same class at the same time, as an import does, could fail one
  element's exposure update with a database error. The exposure and countermeasure writes now start
  from the element, and transient write conflicts are retried.

### Documentation

- **Data origin and the credential flag are documented.** The glossary, the backend schema notes,
  the GraphQL API reference, the data-access library's domain model and operations, the module
  interface's asset-context fields, the Dethereal workflow and sync notes, and the user guides for
  the data-item dialog and for enrichment describe each value, the trust order, what null means, the
  update and round-trip rules, and that enrichment proposes and never sets.
- **The vector tier references describe exact cosine search.** The class and control resolver
  architecture and specification, the custom resolver services reference, the module management
  service reference, the pre-computed embeddings specification and the backend delegation design
  drop class vector indexes, probes and the index heal, and keep the MITRE indexes for index-based
  consumers. ADR-008 gets an update note.
- **The class matching references describe the merged cascade.** They state that the exact-name and
  vector tiers run together with containment as the fallback, correct the containment example to the
  whole-word rule, and correct the match-type names in the threat-modeling workflow.

## [0.10.1] - 2026-10-10

Search by meaning — class matching and MITRE technique matching — could stop finding classes and
techniques written after the database restarted, and fell back to name and type matches without a
word. Deployments now repair their vector indexes themselves: class indexes are checked on every
platform start, after a module reset and at the 10-minute vector-search check; MITRE indexes on the
first MITRE match after start and at the same check. Search by meaning works again after the upgrade.
The bundle now ships Memgraph 3.13.2; moving an existing deployment to it is optional. Compared
against the previous tag, `v0.10.0`.

**Upgrading:** take the new bundle and follow the operator guide's upgrade procedure — back up,
unpack, set `PLATFORM_VERSION`, `./byodt update`. That procedure changes only `PLATFORM_VERSION`: an
existing deployment keeps the `DB_IMAGE` in its `.env`, and the only other line of `.env.example` that
changed is `DB_IMAGE`. **The repair works on Memgraph 3.8.1 as it is**, so a deployment that stays on
3.8.1 is repaired by this release alone, and bumping `DB_IMAGE` is optional. **To move to Memgraph
3.13.2**, back up `data/memgraph` first — there is no downgrade — then set
`DB_IMAGE=docker.io/memgraph/memgraph:3.13.2` in `.env` **in the same change as `PLATFORM_VERSION`**,
so the first start on 3.13.2 is also the first start on 0.10.1 and repairs any index carried over
from 3.8.1. `./byodt up` and `./byodt update` now warn when `.env`'s `DB_IMAGE` differs from the
image the bundle was tested with; the warning never blocks. The reference-data ingest is skipped,
since the corpus did not change. The general module's content hash was restamped for a corrected
load-balancer rule (see *Fixed*), so the platform's load-time skip gate reinstalls it; an existing
finding picks up the correction the next time its element's attributes or class binding are written.
On the first start the platform logs `Vector index … rebuilt: holds N of N embedded … classes` for
each class index it rebuilds, and the first MITRE technique match logs `MITRE vector index … rebuilt`
for each MITRE index; a deployment whose indexes are already correct logs nothing. No saved recipe
needs regenerating.

### Changed

- **The bundle ships Memgraph 3.13.2.** `.env.example` and `NOTICE` name
  `memgraph/memgraph:3.13.2` (still under the Business Source License 1.1). Unlike the 3.8 releases,
  3.13.2 does not re-key a vector index when it recovers from a snapshot. Existing deployments keep
  their `DB_IMAGE` (see **Upgrading**).
- **`byodt` says when the database is not the tested one.** `byodt` 1.1.0's `up` and `update` print a
  warning, with the backup-first steps to move, when `.env`'s `DB_IMAGE` differs from the image the
  bundle was tested with. The comparison is on the image's `name:tag` only, so a reference to the same
  image through a registry mirror does not warn. They never block.
- **A module whose metadata cannot be read at boot still registers its API.** A module whose
  `getMetadata()` throws — for example because its backing service is unreachable — now registers its
  schema and resolvers under its directory name, with one warning and no retries, and is flagged
  `metadataUnavailable`. Its classes are installed on a later boot that reads the metadata. Modules
  without `getMetadata()` or without a name are still rejected.

### Fixed

- **Search by meaning finds every class and technique again.** Memgraph 3.8.x can recover a vector
  index from a snapshot under a different label or property than it was created on; writes then miss
  the index, so classes installed, and MITRE nodes written, after such a restart were missing from
  class matching and MITRE technique matching. The platform now checks the class vector indexes on
  every start — even when no module changed — and after a single-module reset, and checks the MITRE
  vector indexes on the first MITRE match after start. An index keyed on another label or property,
  or holding fewer entries than there are embedded nodes, is dropped and created again. While the
  platform runs, the first match after the 10-minute vector-search check expires repeats the check,
  so a restart of the database alone is repaired without restarting the platform. A snapshot written
  while an index was mis-keyed keeps the wrong key on a later Memgraph too, so the repair is needed
  on any database version.
- **Deleting a class or a MITRE node no longer breaks search by meaning on the newer database.** On
  Memgraph 3.13.2 a node deleted after it was indexed is still returned by vector search until the
  database's garbage collection runs — every five minutes with the bundle's settings — and reading it
  failed the match. Every vector hit is now matched again by its internal id, which skips deleted
  nodes, in class matching, MITRE technique matching and the class index check. Memgraph 3.8.1
  already skipped such nodes.
- **A class match restricted to modules finds those modules' classes.** With `moduleIds`, class
  matching searched three times `topN` nearest neighbours and then applied the module filter, so it
  returned nothing whenever other modules' classes were nearer. It now searches every embedded class
  of the label before filtering.
- **A control can be created without a control class or a folder.** The data-access library sent an
  empty class link and an empty folder link with such a create, and the API rejects a link input
  with nothing to connect; it now leaves them out. The plugin bundles the library, so
  `@dether.net/dethereal` 0.4.11 carries the fix.
- **A failed request is reported as an error, not as missing data.** With `errorPolicy` `all` or
  `ignore`, the data-access library returned no data and callers failed with "Cannot read properties
  of undefined". `performQuery` and `performMutation` now throw a `DtRequestError` that carries the
  server's message alone, capped at 1000 characters. GraphQL errors and 4xx responses are not
  retried; 5xx responses and transport failures are, as before. Partial data with errors passes
  through, and clients on `errorPolicy` `none` are unaffected.
- **The load balancer's weak TLS termination rule fires.** One arm of the general module's
  load-balancer "weak / legacy TLS termination" rule compared `min_tls_version` with values outside
  its enum, so it never fired; it now reads the enum's weak value. The module content hash is
  restamped (see **Upgrading**).

### Documentation

- **The backend references describe vector index health.** The class and control resolver
  specification, the custom resolver services reference, the module management service reference and
  the backend delegation design describe the re-keyed index, when the platform verifies and rebuilds
  class and MITRE indexes, the module-scoped search limit, and the re-match by internal id that skips
  deleted nodes. The MITRE vector tier reference also
  drops HNSW parameters the platform does not set, and states that one unhealthy MITRE kind no longer
  turns off the others.
- **The upgrade guide no longer moves the database with every release.** The operator guide's
  upgrade section now describes the database move as optional, one-way and backup-first, instead of
  asking to take every `DB_IMAGE` change together with the release.

## [0.10.0] - 2026-10-07

MITRE ATLAS — MITRE's knowledge base of attacks on AI-enabled systems — joins ATT&CK and D3FEND as
a third framework in the reference data, readable through the API and shown on the findings that
link to it. MITRE reference data stops being writable through the API: every model shares it, and
only its data module should write it. And a technique a class names but the platform cannot link
is no longer dropped without a word: it is recorded on the finding and shown in the interface.
Compared against the previous tag, `v0.9.2`.

**Upgrading:** take the new bundle and follow the operator guide's upgrade procedure — back up,
unpack, set `PLATFORM_VERSION`, `./byodt update`. The only line of `.env.example` that changed is
`PLATFORM_VERSION`, and no saved recipe needs regenerating. **The reference-data ingest runs on
this upgrade rather than being skipped**: the `mitre-frameworks` data module moves to 1.1.0 and
adds MITRE ATLAS v2026.09 beside ATT&CK v19.2 and D3FEND 1.6.0, so the corpus content hash changed
and the one-shot takes longer than on an upgrade that only moves code. Let it finish. The ingest is
an idempotent merge and the ATT&CK and D3FEND files did not change, so what it adds is ATLAS. ATLAS
ships under the Apache License 2.0, and both the module's `NOTICE` and the bundle's `NOTICE` list
it. The general module's content hash was restamped for corrected technique references (see
*Changed*), so the platform's load-time skip gate reinstalls it; an existing finding picks up the
correction the next time its element's attributes or class binding are written. Four changes can
need you to act, and one changes what a save reports. **MITRE types are read-only in the GraphQL
API**: every ATT&CK, ATLAS and D3FEND type has lost its generated create, update and delete
mutations, so a client that wrote MITRE nodes through the API must stop. Links from exposures and
countermeasures to MITRE nodes are still written through the exposure and countermeasure
mutations, as connect and disconnect. **The embedding similarity threshold defaults to 0.40**, not
0.75, matching the bundled embedding model (embeddinggemma); one threshold serves both class
matching and MITRE technique matching. The compose bundle already passed 0.40, and a deployment that
sets `EMBEDDING_SIMILARITY_THRESHOLD` keeps its value; a backend run outside the bundle without it
now gets 0.40 rather than 0.75. **Threat Report 2.0.0 needs Coverage Tools 2.0.0**: coverage tools
now emits each technique's tactics as `{ id, name, order }`, so upgrade `dethernety-threat-report`
and `dethernety-coverage-tools` together — this release ships both. The manifest dependency names
the module but not its version, so the installer does not catch a mismatch; against 1.x coverage
facts the report's Coverage & Gaps matrix shows a message telling you to upgrade both modules
together instead of a grid. **The plugin needs this platform**: `@dether.net/dethereal` 0.4.10, the
version that ships alongside this release, bundles a data layer that reads fields only 0.10.0
serves (ATLAS links and `unresolvedReferences`), so it fails against an older platform. Update the
platform first, then the plugin; 0.4.9 was not published. Finally, **a class reference that cannot
be linked is recorded instead of disappearing**: when the platform instantiates a class's exposures
and countermeasures, a MITRE reference missing from the loaded data, or any reference that is not
an allowed target for its field, is not written, but the save still succeeds — the reference is
logged, recorded on the finding's new `unresolvedReferences` field, and returned in the save
result's `unresolvedReferences`. Nothing needs doing, but a script that reads save results can now
see what did not link.

### Added

- **MITRE ATLAS is loaded as a third framework.** The reference data now carries ATLAS v2026.09:
  208 techniques, 16 tactics, 40 mitigations and 73 case studies with their structure, and 44 links
  from ATLAS techniques to the ATT&CK techniques they cite. Those citations are resolved through
  ATT&CK's revocations, so one naming a technique ATT&CK has since replaced points at the
  replacement. ATLAS is its own framework — its own node types, keyed on `atlas_id` — rather than
  ATT&CK nodes with another prefix. Its tactics carry their matrix position as ATT&CK's do, and its
  techniques and mitigations ship with embeddings made by the same model as the rest of the corpus.
- **ATLAS is readable through the API, and findings can link to it.** New read-only types
  `MitreAtlasTechnique`, `MitreAtlasTactic` (with `matrix_order`), `MitreAtlasMitigation` and
  `MitreAtlasCaseStudy` carry the crosswalk in both directions (`MitreAtlasTechnique.attackTechniques`,
  `MitreAttackTechnique.atlasTechniques`) and reverse links to exposures and countermeasures.
  Findings link to ATLAS through sibling fields beside the ATT&CK ones, named with an `Atlas`
  suffix: `Exposure.exploitedByAtlas`, `Countermeasure.mitigationsAtlas`, and the eight verb fields
  from `mitigatesAtlas` to `respondsToAtlas`. A class policy can cite an ATLAS technique (`AML.T…`)
  or mitigation (`AML.M…`) and the platform links it. `matchMitreTechniques` gains the
  `ATLAS_TECHNIQUE` and `ATLAS_MITIGATION` kinds, searched through their own vector indexes, and
  every candidate now carries `tacticOrder`; `MitreAttackTactic` exposes `matrix_order`. The
  data-access library gains `DtMitreAtlas`.
- **The interface shows ATLAS links.** Exposures show the ATLAS techniques that exploit them and
  countermeasures the ATLAS mitigations they implement, beside the ATT&CK and D3FEND chips, each
  linking to its page on atlas.mitre.org. They are display-only: the exposure and countermeasure
  dialogs do not edit them, saving a dialog leaves them as they are, and the technique picker does
  not offer ATLAS yet. Coverage facts, the Threat Report's coverage view and control gaps still
  read ATT&CK only and skip ATLAS links; an exposure linked to both is counted through its ATT&CK
  technique.
- **A finding shows the references its class names but the platform could not link.** An exposure
  or countermeasure whose class cites an id that is not in the loaded MITRE data, or a kind of node
  its field does not allow, now carries a small **N unlinked** warning chip next to its technique
  chips, with the references in a tooltip — in the exposures table and detail view and in the
  control dialog's countermeasure rows. Nothing is shown when every reference linked. The marker is
  the finding's read-only `unresolvedReferences` field, set on every save of a class-derived
  finding and cleared by a later save in which the references resolve. An unresolved
  regulatory-requirement reference is still only logged, since a compliance pack may load its
  requirements after the classes that cite them.
- **The API exposes every technique link a countermeasure can carry, with its justification.** The
  instantiation writer creates eight verb links, each with an optional justification, but the API
  exposed four verbs and no link property. `deceives`, `evicts`, `restores` and `respondsTo` join
  `mitigates`, `protectsAgainst`, `detects` and `isolates`, and a `TechniqueLinkProperties` link
  type carries `justification` on `exploitedBy`, `mitigations`, `defendedTechniques` and every verb
  field. The justification is nullable, so a connect without link properties stays valid.

### Changed

- **Editing a finding's technique links writes only the difference.** The data-access library's
  exposure and countermeasure updates used to disconnect every link and reconnect the list, which
  dropped the justification on links the user had kept. They now read the current links and write
  the delta, so a kept link keeps its edge and its justification. A list the caller does not pass
  is left as it is rather than cleared. The replace shape that earlier published clients send still
  works and touches only its own field.
- **The embedding threshold follows the model, and the production template documents it.**
  `EMBEDDING_SIMILARITY_THRESHOLD` defaults to 0.40 in the backend (see **Upgrading**). The old
  0.75 was tuned for an earlier model; embeddinggemma's best MITRE matches score well below it, so
  a backend run without the variable silently got no vector matches for classes or techniques.
  `env.production.template` gains the `EMBEDDING_*` settings, with the note that the threshold is
  per model and that the MITRE data is embedded with embeddinggemma.
- **Tactic order comes from the data, and an old corpus says so.** The data-access library's tactic
  listings and the coverage facts order tactics by the matrix position the ingest stamps on each
  ATT&CK and ATLAS tactic, so a new ATT&CK release reorders them without a code change. Data
  ingested before that stamp existed sorts its tactics last, by id, and logs a warning that the
  MITRE data should be re-ingested.
- **MITRE key indexes are created at startup, on both engines.** The technique picker used to
  create its lookup indexes lazily and on Memgraph only. They are now part of the startup schema on
  Neo4j and Memgraph alike, extended to every MITRE lookup key: ATT&CK technique and mitigation
  `attack_id`, D3FEND technique `d3fendId`, and ATLAS technique and mitigation `atlas_id`. Vector
  indexes are created only for the kinds that have nodes.
- **The general module's technique references are corrected in nine classes.** Email server: the
  STARTTLS-stripping exposure drops T1040, since an active downgrade is T1557, already cited.
  Authentication exchange: the reverse-proxy MFA bypass cites T1539 instead of T1598.003, and SAML
  signature wrapping drops T1550.001. DNS server: cache poisoning cites T1557 instead of T1565.002.
  Identity provider: SAML assertion forgery cites T1606.002 instead of T1550.001 and T1606. Network
  router drops T1133, Kerberos authentication T1550.003, LDAP directory access T1087, and the
  container boundary T1554; SNMP monitoring drops T1110 and cites T1565 instead of T1685 for spoofed
  traps. The module content hash is restamped.
- **Shipped module references are checked against the pinned MITRE data.** For contributors; this
  changes nothing for an operator. Because the platform now records an unlinkable reference rather
  than failing on it, a new CI check reads every module policy and checks each MITRE reference
  against the node keys in the data module, applying the platform's own rules for which kinds each
  field accepts. It is what keeps such references out of a release.

### Fixed

- **The Coverage & Gaps matrix follows the ATT&CK matrix again.** Its columns were sorted against a
  built-in tactic list from before ATT&CK v19, so Stealth (TA0005) and Defense Impairment (TA0112)
  fell to the end, alphabetically. Coverage tools now emits each technique's tactics as
  `{ id, name, order }`, and the report keys its columns by id, labels them by name and orders them
  by matrix position, with no built-in list. The JSON export carries the same objects. Both modules
  move to 2.0.0 for the changed shape (see **Upgrading**).
- **The technique picker's tactic facets are in matrix order.** They sorted against the same
  pre-v19 list, which had no place for Stealth or Defense Impairment. ATT&CK and ATLAS facets now
  order by each technique's earliest tactic in the matrix; D3FEND keeps its own fixed order.
- **Superseding a finding keeps every technique link and its justification.** A superseded
  countermeasure's copy kept only its mitigations and D3FEND techniques, losing all eight verb
  links and every justification; a superseded exposure's copy lost its justifications. Both copies
  now carry every link, ATLAS links included, with its justification. Superseding a finding that no
  longer exists now fails before anything is created.
- **One unhealthy MITRE kind no longer turns off vector search for every kind.** A kind whose nodes
  are loaded but whose embeddings are missing or made with another model — ATLAS loaded without its
  embeddings, for example — switched the technique picker's vector search off for ATT&CK and D3FEND
  too. Each kind now stands on its own and reports its own reason (`NO_VECTORS` or
  `MODEL_MISMATCH`); a kind with no nodes at all is skipped with a log line. Vector search is off
  for everyone only when no loaded kind is healthy, or on a fault that affects all of them.
- **Class name matching matches whole words.** The name step of class matching accepted any
  substring, so "Go microservice" matched the class "Service" before vector matching could propose
  Application Service. A hit is now a run of whole words, in either direction, with words split on
  anything that is not a letter or digit: "Production PostgreSQL" and "postgresql-primary" still
  hit, but "microservice" no longer contains "Service".
- **The class picker's similarity meter starts at the threshold.** It lit its first dot at 0.70, a
  value left from the earlier model, so class matches between 0.40 and 0.70 showed no dots. The
  class and technique pickers now share one meter: one dot from 0.40, two from 0.55, three from
  0.70.
- **A malformed remote embedding vector no longer breaks class matching at every start.** A
  cloud-delivered module that served a class's vector wrapped in an object rather than as a bare
  array made every lookup throw on every start. Vectors are now unwrapped and validated once; an
  unusable one is dropped with a single warning, and that class is embedded on the fly.
- **`@dether.net/dethereal` 0.4.10: enrichment keeps ATLAS technique ids.** The enrich skill checked
  every technique id against the ATT&CK pattern and dropped any that failed, so an ATLAS id
  (`AML.T…`) on the model or given by the user was discarded without a word. ATT&CK ids are still
  confirmed through the MITRE search and dropped when unconfirmed. ATLAS ids are kept when the user
  supplied them or the model already carries them, marked as not verified by the plugin, since its
  search covers ATT&CK only; the skill never produces one.

### Security

- **`@dether.net/dethereal` 0.4.8: discovery is instructed never to read secret values.** The
  discovery scout could run `docker compose config`, which prints values from `.env` and `env_file:`
  files, and could open `.env` files and committed Kubernetes Secret manifests, so secret values could
  reach the model provider. The scout is now told never to open secret files (env files, Terraform state
  and variables, keys and certificates, cloud and registry credentials, Kubernetes Secret manifests and
  similar), to take names from examples, references and code instead, and never to run commands that
  print secret values. This is an instruction to the model, not an enforced control. **Upgrading:**
  update the plugin; its `.mcp.json` pins the server to 0.4.8.

- **`@dether.net/dethereal` 0.4.7: session tokens no longer reach the model.** Earlier versions told
  the model to read the local token store to check the sign-in, so the session's access, identity
  and refresh tokens could be sent to the model provider; the `refresh_token` tool also took a raw
  refresh token as model input. Skills now call a read-only `auth_status` tool that reports the
  platform, the user and the time left and never returns token material; `refresh_token` is removed
  (refresh stays automatic); `login` and `logout` no longer return the token store's path; and no
  error carries a sign-in URL, token or file path. Session tokens are also redacted from every tool
  result and from the server's log output.

  **If you used an earlier version, treat that session as exposed.** `logout` deletes the local copy
  but does not revoke it, and signing out of the platform's web interface revokes the browser's own
  session, not necessarily the plugin's. The session stays valid until its refresh token expires —
  about a day on the hosted service, otherwise the lifetime your identity provider sets — unless an
  identity-provider administrator revokes the user's sessions sooner.

  **Still open:** the `npx` launch can pick up a copy of the package in the project's own
  `node_modules` ahead of the registry one; a local request to the sign-in callback port can cancel a
  pending login; two servers writing the token store at once can lose a session; and login needs a
  desktop browser on the same machine, with no fallback yet. Never copy the token store between
  machines by hand — sign in on each one.

  **Upgrading:** update the plugin. Its `.mcp.json` pins the exact server version, so the update is
  what moves the server to 0.4.7.

  0.4.6 was withdrawn: it was published with a server build from before this change, so its skills
  called a tool its server did not have. Packing and publishing now always build the server, and the data-access layer bundled into it, first.

- **Shared MITRE reference data can no longer be written through the API.** Every model reads the
  same MITRE nodes, and only the data module should write them, but any signed-in client could
  create, update or delete them through the generated mutations, through nested operations under
  every field that points at them, and through the `Element` interface fields — and a nested
  disconnect run through a MITRE node could remove other models' links to it. The MITRE types now
  have no generated mutations, their own relationship fields allow no nested operation, and every
  field that points at a MITRE type or at `Element` allows only connect and disconnect. Every write
  the platform's own clients make keeps working (see **Upgrading**).
- **The instantiation writer takes link targets only from its own table.** The node label and key
  interpolated into the statements that resolve and link a class's references used to come from
  module data, checked as an identifier but otherwise open. They now come only from the writer's
  closed table of allowed targets per field.
- **Ten advisories cleared across seven dependencies.** Overrides move `proxy-addr` to 2.0.8 (a
  critical IP spoofing advisory, transitive through the server's HTTP framework), `dompurify` to
  3.4.16, `brace-expansion` to 1.1.21, 2.1.7 and 5.0.12 on its three lines, `fast-uri` to 3.1.8,
  `source-map-js` to 1.2.2, the 12.x copy of `@graphql-tools/utils` to 12.0.3, and `katex` to
  0.18.2. The `katex` override deliberately crosses the range its only consumer, `mermaid`,
  declares; rendering with `mermaid`'s options was checked under it. The console's interface
  project, whose lockfile the workspace update does not reach, was refreshed too, lifting
  `brace-expansion` and `source-map-js` there and `@vue/server-renderer` to 3.5.43. Eight overrides
  that no longer did any work were dropped after a clean resolve without each: `webpack`,
  `express-rate-limit`, `file-type`, `@babel/core`, `form-data`, `@grpc/grpc-js`, the 8.x `ws` entry
  and a `js-yaml` entry. Two of them had been forcing majors their consumers never declared.

### Documentation

- **ATLAS is documented where the data, the API and the interface are.** A new decision record,
  ADR-012, sets out ATLAS as a third framework — its own node types and key, the crosswalk to
  ATT&CK, read-only MITRE types — with a dated amendment describing how the writer records rather
  than fails on an unlinkable reference. The MITRE data module's README covers the ATLAS data, the
  file layout, ATLAS-only rebuilds and the module reference check. The schema, resolver,
  instantiation, data-access and frontend references describe the ATLAS types and sibling fields,
  the read-only MITRE types, link justifications, the picker's ATLAS kinds, the startup key
  indexes, delta updates and the `unresolvedReferences` marker; the GraphQL API reference is
  regenerated, which also picks up earlier schema text it had missed. ADR-008 gains a dated update
  note.
- **The user and operator guides follow.** The modules guide lists ATLAS among the reference data
  and says it is not yet offered in the technique picker. The deployment configuration guide says
  the similarity threshold also governs MITRE technique matching, and the installation guide says
  the console ingests ATLAS beside ATT&CK and D3FEND. The Threat Report's README states
  that 2.x needs Coverage Tools 2.x. The cloud guide's walkthrough headings drop their step numbers,
  which clashed with the console's own numbered sections.

## [0.9.2] - 2026-09-18

A person whose sign-in has simply expired is now signed in again, not told that the deployment
does not admit them. Compared against the previous tag, `v0.9.1`.

**Upgrading:** take the new bundle and follow the operator guide's upgrade procedure — back up,
unpack, set `PLATFORM_VERSION`, `./byodt update`. The only line of `.env.example` that changed is
`PLATFORM_VERSION`. The change is confined to the platform's web interface: the console, the
backend's API and the configuration are as they were. No module, corpus or class policy moved, so
no content hash changed and the reference-data ingest is skipped. `./byodt update` pulls the
console image as well as the platform's, as usual, because the console follows `PLATFORM_VERSION`
unless your `.env` pins `CONSOLE_IMAGE`; nothing regenerates and no saved recipe is invalidated. A
browser that already has the interface open picks up the new one on its next page load after the
update. The plugin does not move: `@dether.net/dethereal` stays at 0.4.5.

### Changed

- **The not-admitted page's buttons are readable.** **Check again** and **Sign out** on **This
  deployment does not admit your account** used the dark theme's banner colour, which sits close
  to the page background and left them barely visible. They now use the same teal as every other
  control on a dark surface.

### Fixed

- **An expired sign-in no longer reads as a refusal.** Someone whose session had lapsed could be
  shown **This deployment does not admit your account**, and pressing **Check again** then let
  them straight in. The interface decided that page from its own belief that the token was
  current — the token's expiry against the browser's clock — and at the expiry boundary that
  belief can be wrong: a skewed clock, a tab that slept through its scheduled refresh, a request
  sent just before a refresh landed. A refusal of a token the interface believes current now
  triggers a forced token refresh from the identity provider and one retry of the request. A
  refresh that fails is a session that has ended, and gets the ordinary sign-in; a retry that
  succeeds shows nothing; only a freshly issued token that is refused again shows the not-admitted
  page. Refusals that arrive together share one refresh, and a retry is never retried. The API is
  unchanged: every refused credential still gets the same `UNAUTHENTICATED` code, so no oracle is
  opened.

### Documentation

- **The refresh-and-retry is described where the refusal is.** The frontend references for the
  Apollo error link, authentication and the frontend architecture describe the mechanism; the
  security model and the configuration guide's `DEPLOYMENT_ALLOWLIST` notes, and the cloud and
  troubleshooting guides, now say that an expired sign-in is renewed and does not reach the
  not-admitted page.

## [0.9.1] - 2026-09-17

An administrator now chooses who may sign in to a connected deployment from the team itself, on
the deployment, without disconnecting it. The previous release made the access list writable on a
running deployment, but only by pasting it from the portal; the console now lists the team's
members with a tick beside each, names the people who have left the team and can still sign in,
and removes them in one click. On the platform's side, a person the list does not admit is told so
— until now that refusal reached the browser as an internal error, and the interface could only
suggest trying again. Compared against the previous tag, `v0.9.0`.

**Upgrading:** take the new bundle and follow the operator guide's upgrade procedure — back up,
unpack, set `PLATFORM_VERSION`, `./byodt update`. The only line of `.env.example` that changed is
`PLATFORM_VERSION`, so a `diff .env .env.example` should show you that line and your own values
and nothing else. No module, corpus or class policy moved in this release: no content hash changed,
so the reference-data ingest is skipped on this upgrade and the platform's load-time skip gate
keeps every module it already has — the one-shot is as short as it gets. `./byodt update` pulls the
console image as well as the platform's, because the console follows `PLATFORM_VERSION` unless
your `.env` pins `CONSOLE_IMAGE`, so the new card and the new page arrive together and need nothing
beyond the update itself: no saved recipe is invalidated, nothing regenerates, and no restart beyond
the one the update performs. One caveat carries over from 0.9.0. The card lists the team only on a
deployment whose recipe names one; on a deployment connected with an older recipe, section **3 ·
Who may sign in** shows a sentence saying so and the paste box from 0.9.0 beneath it, and the paste
box keeps working exactly as it did. Getting the card means reconnecting with a fresh recipe, and
what that costs is in the cloud guide under `docs/user/byodt/`. The plugin does not move:
`@dether.net/dethereal` stays at 0.4.5.

### Added

- **Who may sign in is chosen on the deployment, from the team.** The Cloud tab of a connected
  deployment gains a third numbered section, **3 · Who may sign in**: every current member of the
  team with a tick beside those the deployment admits today, the operator's own row always ticked
  and disabled — the one list the console will always refuse is one that leaves its submitter out,
  and keeping the row ticked means that refusal is never reached from the card — and **Apply**,
  which writes exactly the ticks. Selecting is not inviting: adding and removing people, and
  changing roles, stay in the portal, and a colleague who joined since the card was fetched appears
  only on **Refresh**, unticked. The console asks the cloud for the team's members on the
  operator's behalf, through the operator's own cloud credential, and relays exactly two fields per
  member — identifier and address — which are held in the tab while the card is open and nowhere
  else: not on the deployment's disk, not in its configuration, not in a log line. Both the member
  list and the read of the current access list are gated on the administrator role, for what they
  reveal rather than what they change; a member who is not one reads the same sentence that
  disables the other administrator-only controls, and nothing of the team. The writer of the access
  list is unchanged and still refuses an empty list, unprintable characters, and any list that
  would lock the submitter out; its two paste-path refusals now name the recipe's own
  `DEPLOYMENT_ALLOWLIST` line as the place to re-copy from, since the portal no longer keeps a
  separate list. A selection in progress survives the cloud sign-in redirect as identifiers only,
  and is put back over a freshly fetched team when the tab returns.
- **People who have left the team are named, and removed in one click.** Leaving a team ends a
  person's subscription; it does not stop them signing in to a deployment that still lists them,
  and a signed-in person can read that client's models. The card now lists every admitted account
  that belongs to nobody on the team, by identifier — the address of someone who has left is kept
  nowhere, so there is nothing else to show — under a count such as "2 people who have left the
  team can still sign in." **Remove people who have left** writes the current list less those
  accounts — never the ticks — and leaves everything else as it was, including ticks changed but
  not yet applied. While an administrator is signed in to the cloud in the tab, the console's
  overview carries the same count as a banner, **People who have left the team can still sign
  in**, worked out afresh on every load and never remembered.
- **The console says the restart is still owed.** The platform reads the access list once, when it
  starts, so a written change is inert until the platform is recreated — and whoever was just
  removed can still sign in until it is. After any successful write, a banner reading **Restart
  required to apply your changes** stays at the top of the section for as long as the page is open,
  naming `byodt restart platform`, in the same shape as the reminder the Content tab shows after a
  mount. A refused write raises none, since nothing was written.

### Changed

- **Disconnect is the last thing on the Cloud tab, and unnumbered.** It is not a step of setting a
  deployment up — it is the undoing of step 2 — and until now an operator looking for "change who
  has access" found it before anything that would have served them. A destructive control belongs
  at the foot of the page, after everything an operator might have come for instead. The
  administrator refusal now names both things the role covers — changing the deployment, and
  seeing who may sign in to it.
- **The plugin's republish guard reads the source it bundles, not only the ranges it declares.**
  For contributors; this changes nothing for an operator. The check that decides whether a change
  to `@dether.net/dethereal` needs a new published version compared dependency declarations and
  excluded development dependencies, which is right for a range and wrong for a bundle: the
  platform's data-access layer is a development dependency compiled into the plugin's artifact, so
  the previous release's rewrite of that layer's write path passed the guard with a clean report.
  The guard now reads the bundle list from the build configuration and diffs each bundled package's
  source against the base, excluding tests and prose, and CI runs its own test. The 0.9.0 entry
  below was corrected at the same time to say what 0.4.5 actually carries, and that it is the first
  version published since 0.4.3.

### Fixed

- **A person the deployment does not admit is now told so.** In production both transports keep
  only an error's code and replace its message, and the schema library's authentication refusal
  carried no code — so a deployment refusing a caller answered as `INTERNAL_SERVER_ERROR`,
  byte-identical to a crash, and the interface showed "Failed to load models. Please try again." The
  masked code is now classified rather than copied: the library's refusals become `UNAUTHENTICATED`
  and `FORBIDDEN`, the codes the platform's own resolvers already use, on both transports, and
  every other error keeps what it had. No oracle is opened — a missing, invalid, expired and
  unlisted credential all reach the same refusal and get the same code. The interface tells the
  cases apart from the token's own expiry: a refusal of a current token now lands on its own page,
  **This deployment does not admit your account**, which says the sign-in worked, names the account
  it worked as, says who can change the list and that the change takes effect when the platform is
  restarted, and offers **Check again** and **Sign out** — not a sign-in prompt, because the
  sign-in is not the problem. A stale token gets the ordinary sign-in. A deployment running without
  authentication is untouched.

### Documentation

- **The operator guides cover the card, the departed, and the refused.** The cloud guide's
  *Changing who may sign in* section is rewritten around the ticks: prerequisites, the card step by
  step, people who have left the team, what survives a sign-in redirect, the paste box as the
  fallback for a deployment that names no team, what the console will and will not accept, and a
  new *Someone the list does not admit* section that says what a refused colleague sees and what to
  do about it. The troubleshooting guide gains entries for the sentences the card can show and for
  the colleague who reports the new page, and the configuration guide's table of what each console
  control writes names the three writes that share the access-list line. The security model states
  the code a refusal now carries on the GraphQL transports, and the console and security
  architecture documents, the backend and frontend references for error masking, the Apollo error
  link and the authentication routes describe the mechanism.

## [0.9.0] - 2026-09-15

Two people can now edit one model without undoing each other. Until this release every
interactive save sent back the whole object the client had loaded when the dialog opened, so
whoever saved second overwrote fields the first had just changed — and both were told it had
worked. A save now carries only what the user actually edited, and a relationship edit is written
as the difference against what that client last saw rather than as a whole-list replace. Alongside
it, the reference data moves to ATT&CK v19.2 with the tactic ordering and the class policies that
release forces, a connected deployment's destructive controls move behind an administrator of its
team, and changing who may sign in stops costing the deployment its modules. Compared against the
previous tag, `v0.8.0`.

**Upgrading:** take the new bundle and follow the operator guide's upgrade procedure — back up,
unpack, set `PLATFORM_VERSION`, `./byodt update`. Nothing in `.env.example` changed in this
release, so a `diff .env .env.example` should show you only your own values, and no saved recipe
needs regenerating to take the upgrade. **The reference-data ingest runs on this upgrade rather
than being skipped**, because the corpus content hash changed — so the one-shot takes longer here
than on an upgrade that only moves code. Let it finish; the platform is held back until it does.
That ingest is additive: every statement is a `MERGE` and nothing in the corpus deletes, so the
v19.2 nodes are created, the properties of nodes that survived are updated in place — `TA0005`
picks up its new name, every tactic gains its matrix position — and **the nodes for the 17
techniques ATT&CK v19 revoked stay in your graph**, together with the relationships the previous
export gave them. Findings link to a technique by an `EXPLOITED_BY` edge matched on `attack_id`,
so a finding raised against one of those techniques before the upgrade keeps resolving; it points
at a technique ATT&CK no longer publishes. The corrected class policies arrive on their own — the
module content hash was restamped, which is what gets the platform's load-time skip gate to
reinstall rather than keep the copy it already has — but nothing re-derives findings that already
exist, so an element's findings pick up the corrected technique references the next time its
attributes or its class binding are written. Two more things need you to act. If you use the
plugin, move to `@dether.net/dethereal` 0.4.5. And the administrator gate on a connected
deployment **is inert until the deployment knows which team it belongs to**: it switches on when
the deployment is next connected with a recipe that names one, which means getting a fresh recipe
from the portal, disconnecting, applying it and connecting again — read what disconnecting costs
first. Until you do that, every console control behaves exactly as it did in 0.8.0.


### Added

- **A deployment can name the team it belongs to.** A person who belongs to two teams was served
  the union of both teams' content on either team's deployment — one team's content reaching
  another team's deployment. Closing that needs the request to say which team it is for, and
  the deployment is the only party that knows. `DEPLOYMENT_TEAM_ID` is an optional recipe value; a
  recipe carrying it now applies, and a recipe without it still applies. On its own this changes no
  deployment's behaviour, which is the point — the name has to be accepted in the field before
  anything can be built on it. The rule the senders keep is a coupling rather than a list of
  routes: the team header is set **if and only if** a bearer token is. That buys three things at
  once — the credential-free catalog calls provably never carry it, which matters because their
  responses are publicly cacheable and may be logged by intermediaries; no entitled route added
  later can forget it; and no public one can acquire it by accident. The value is checked where it
  is written and again where it is read, because the configuration layer is a file on the
  operator's host rather than console-private state, and an identifier the console rejects is now
  logged on both sides — the operator who mistyped it is the only person who can undo it, and
  previously one of the two senders dropped it in silence. An unset value stays silent on purpose:
  that is the ordinary state of every deployment predating the name, and warning on it would teach
  operators to ignore the message that matters. A deployment that has not been told its team is now
  told exactly that, rather than being shown "subscriptions could not be checked just now —
  Refresh to try again", which is the sentence for a transient hiccup on a deployment that would
  answer the same way forever; the sign-in offer is withheld with it, because signing in cannot
  supply a team identifier.
- **Changing a connected deployment requires an administrator of its team.** The console is served
  on the same origin as the platform and was gated on nothing but a valid session, so any member of
  a team could reach it and disconnect the deployment — removing every cloud-provided module and,
  at the next platform start, the classes those modules declare and every link into them. Six
  routes are now gated: disconnect, mount, unmount, install, remove, and the access-list write
  below. Connect is not, and cannot usefully be — it is the pre-cloud paste path with no
  authenticated subject, and it is already refused on a connected deployment. Every read stays
  open: a member who cannot see what their deployment holds is worse served than one who cannot
  change it. Nothing is cached — the gate asks on every gated request and never honours an earlier
  answer, because a decision honoured while the authority cannot be reached is an unbounded grant
  to whoever can interrupt the network. There was no latency to trade for it either; these are
  occasional operator clicks. Refusals use four statuses, because each remedy wants a different
  control: 403 you are not an administrator, 503 the check could not be made, 412 this tab holds no
  credential to ask with, 409 this deployment can never make the check. Never 401 — the interface
  answers any 401 by clearing the session, so a refusal returned as one would sign an operator out
  for not being an administrator. Controls are disabled and explained, never hidden, and only an
  explicit answer disables one; undetermined means the console could not ask, which is the ordinary
  state of a reloaded tab. Disconnect is disabled at the click rather than refused after its
  confirmation, so the refusal does not arrive after the operator has read four bullet points about
  permanent deletion and agreed to them. Disconnect alone is still allowed on a deployment whose
  configuration can never make the check, because disconnect is what an operator reaches for to fix
  a bad configuration.
- **Changing who may sign in no longer costs the deployment its modules.** Who may sign in is a
  list of subjects in the deployment's configuration, read once when the platform starts. The only
  console path to change it was disconnect-and-reconnect — so the discoverable path destroyed graph
  data, and the path that destroys nothing, editing the file on the host, was nowhere in the
  console's vocabulary. **Apply access list** on the Cloud tab now rewrites that one value on a
  running deployment and preserves every other. It applies; it does not ask — the roster lives
  behind a credential this console's token is the wrong audience for, so the operator copies the
  list from the portal, where they are already signed in with one that works. It refuses a list
  that does not name the operator applying it, which would lock them out of their own deployment at
  the next start. It refuses an empty list on its own terms rather than as a missing field: the
  platform reads an empty list as *no restriction* rather than as nobody, and on a
  network-reachable deployment it then refuses to start at all — the console can predict neither
  outcome, so it refuses either way. It takes effect at the next platform start and says so both
  before and after you submit, and it says *which* restart: this one removes no module, so it
  carries none of the consequences of a start that finds one missing. A change the operator
  believes has already happened is the failure this whole route exists to prevent, because the
  control they would reach for next is the destructive one.

### Changed

- **The ATT&CK corpus is v19.2, and D3FEND is pinned.** Techniques go 691 → 697 and tactics 14 →
  15: v19 split Defense Evasion, renaming `TA0005` to Stealth and adding `TA0112` Defense
  Impairment, which carries 56 techniques. Seventeen techniques the previous export carried live
  were revoked, so the corpus is regenerated by a clean re-ingest into a throwaway graph rather
  than merged into the existing one — a merge lets a revoked node survive by simply not being
  mentioned. D3FEND was previously fetched from an unversioned URL, which is why its version was
  recorded as "unknown" and why re-running the ingest months apart pulled a different D3FEND into
  what was meant to be an ATT&CK-only change; it is pinned at 1.6.0, and both halves of the corpus
  are now reproducible from a pinned source. Tactics also carry their matrix position now, stamped
  at ingest from the bundle's own ordered tactic references. The sequence was always present in the
  source and always lost, so every consumer needing kill-chain order carried its own copy — and v19
  changed the sequence by inserting a tactic mid-matrix. That stamp fixes a second-order problem
  worth stating, because it changes what the product shows. A technique's displayed tactic used to
  be picked from its tactics by **name** order, which was always arbitrary and which v19 made
  visible: renaming Defense Evasion moves the alphabetical pick for 185 of 674 techniques, and for
  66 of them the new pick is an unrelated tactic — Privilege Escalation, Execution, Persistence —
  selected by nothing but spelling. The exporter and the runtime resolver now order by matrix
  position, so the tactic shown is the earliest kill-chain stage the technique belongs to, which is
  a real property of it; on this corpus that changes the pick for 33 of 145 multi-tactic
  techniques. A corpus ingested before the stamp existed falls back to name order, preserving the
  previous behaviour. D3FEND keeps name order, since its tactics carry no matrix position and v19
  did not restructure it.
- **The general module's technique references follow the corpus.** Fifty-eight class policy files
  change the techniques they cite, and the shipped policies now carry **no retired technique ids in
  structured references**. One hundred and one prose mentions of retired ids remain in guide and
  description text, pending a guide regeneration — they are read by people rather than resolved
  against the graph, so they misinform rather than misbehave. The module content hash is restamped,
  which is what gets the platform's load-time skip gate to reinstall the corrected module rather
  than keep the copy it already has.
- **`@dether.net/dethereal` 0.4.5.** The plugin compiles the platform's data-access layer into its
  own artifact, so it carries the write-path change above as well: a push from the plugin now
  writes a model's scope lists the way the platform does — an explicitly empty list in `scope.json`
  clears the platform's list, where it used to be silently ignored — and every other write goes
  through the same presence-gated writers the interface uses. Alongside that, the reviewer fix
  under *Fixed* and refreshed dependency ranges. This is the first version published since 0.4.3:
  0.4.4 was declared in the previous release and never reached the registry, so an operator who
  followed that instruction found nothing to install. 0.4.5 is where both land.
- **CI tests on Node 22 and 26; the platform image and the release build move to 26.** Node 20 left
  support in April 2026, and the platform image runs Node 26 — a version no job exercised.
  Packages still declaring `engines.node >= 20` now claim a floor CI does not test, and a comment
  beside each matrix says so. Separately, the Docker build used to write its layer cache from every
  pull request; a cache entry serves only the ref that wrote it, so those entries helped nothing but
  re-pushes of the same pull request while growing to most of the repository's quota and evicting
  the caches `main` depends on. The cache is written only by publishing runs now; pull requests
  still read it.
- **The platform test suites run on every pull request, and can fail one.** `dt-core`, `dt-ui` and
  `dt-ws` carry around two thousand assertions that run in about a hundred seconds, and none of
  them ran on a pull request. What existed was a step inside the build job, filtered to the server
  and marked continue-on-error — a check that existed without running, and one that reached neither
  of the other two packages. The replacement is blocking and names each suite as its own step, so a
  failure names the tree it is in. The end-to-end suite runs too, with the container reaper
  disabled because the harness disposes its own: that suite skips silently where Docker is absent,
  which makes a skipped integration run look exactly like a passing one.

### Fixed

- **Two people editing one model used to revert each other, silently.** Every interactive save sent
  the element as this client last loaded it, so editing a description rewrote the name, the
  position, the parent and the associations along with it — and dragged the node back to wherever
  this client last thought it was. Neither party saw an error: the writer was told to set those
  fields and did, and both screens said the item had been updated. A save now carries only the
  fields the edit names. This is less a new behaviour than an existing one finished — zoning,
  conduits, controls and data items were already sent only when the element defined them, and the
  object naming what the user touched has always existed and has always been discarded before the
  payload was built. Narrowing also *heals*, which is worth saying because it reads as merely
  defensive: the response carries the whole element back and the client re-pins from it, so a
  client that omits a name receives the other person's name and converges onto it. Three surfaces
  change: the settings panel, the model dialog, and the data-item dialog. The model dialog was the
  larger half of its own defect — it seeds itself once when it opens and then saves on *every* act,
  including on the way out when a model is opened or exported, so merely opening a model from the
  dialog destroyed a control somebody else had just attached. Its module list is gone entirely: the
  dialog has no module editor, so the only thing a module list it sent could ever do was overwrite
  somebody else's assignment with a load-time copy. The dialog's form now follows the server's
  answer for every field the user has not touched and never for one they have — losing typing is
  the worse error — and it refuses to start a second write while one is in flight, since a folder
  move and a Save overlap by construction and would otherwise each emit the same relationship
  connect, leaving a parallel edge that reads collapse and no later save heals.
- **Attaching a control no longer detaches somebody else's.** A control or data-item list was
  written by disconnecting every edge and connecting the list the client held — right for a caller
  asserting the whole list, such as an import or a bulk push, and destructive for two people
  editing one element, because the second save carries a list assembled from a view taken before
  the first landed. The client now tells the writer what it believed the list to be *before* the
  edit, and the writer sends the difference; an id this client never saw is in neither side of it,
  so nothing disconnects it. The baseline has to be read before the optimistic merge, and it is
  only correct while nothing else writes to the element out of band — the settings panel used to do
  exactly that, assigning the new list onto the selection so the whole-element send would carry it,
  which would have made the baseline equal the value just written and the difference empty. Those
  assignments are gone, and a data-flow save became optimistic to replace what they were doing for
  the rendered checkbox. One cost is taken deliberately rather than hidden: a delta cannot collapse
  a duplicate edge the way disconnect-everything incidentally did, so two people adding the *same*
  control at the same moment now each connect. A duplicate is additive and invisible on read; a
  destroyed attachment is neither.
- **A save can no longer be built from an id it cannot use.** Relationship writes filter on an
  equality against an id, and an equality whose value is missing serialises away — leaving a filter
  with no condition, which does not match nothing but matches *everything* carrying that label.
  Measured rather than reasoned: a connect built that way attaches the element to every control in
  the deployment, and a disconnect built that way clears every link of that type the element has.
  Neither reports an error, and a read collapses parallel edges, so neither is visible from the
  interface afterwards. What makes this a class rather than a list of sites is that the schema's
  non-null discipline stops at the input-object boundary: top-level ids are declared non-null and
  rejected before the server sees them, but every member of an input object is nullable, and these
  filters are built inside input objects. There are two answers, because the situations differ. An
  entry in a list names one item among many, so it is dropped and the rest of the write stands —
  refusing the whole save would block someone out of an edit they have no way to repair. A scalar
  *is* the edit, so it refuses. An empty parent is an edit rather than an absence: it means "put me
  at the root", which is what dragging a node onto the canvas sends. It can only be written once
  the root is known, so a save made before it resolves now refuses and the caller keeps what it had
  — previously that combination left the element with no parent at all and reported success.
- **Clearing a field now works, and an absence now means "leave it alone".** Two of the data-item
  writer's fields were worse than ungated: an absent sensitivity or regulatory-flag list did not
  merely get re-sent, it *cleared* the stored value. That is what a full sync means by an absence
  and the exact opposite of what an interactive save means by one, and both callers share the
  method — so the only way for the dialog to avoid wiping a classification was to send one, from a
  snapshot taken when it opened, reverting whatever anybody else had set in the meantime. A clear
  is still reachable and now has to be stated: a supplied null sensitivity, or a supplied empty
  flag list. The push path says its clears out loud rather than arriving at them by omission. The
  same distinction closes a smaller defect in the model dialog: emptying the last compliance driver
  wrote nothing and reported that it had, because the helper that prepares a scope treated an empty
  list and an absent one alike — which is the right reading of the stored form, where both mean
  unset, and the wrong thing to say back to it. An absent key says nothing; an empty list is an
  instruction.
- **An element's lock is released by the operation that took it.** The only mutual exclusion the
  platform has on an element could release a lock that was still being held, and then let the
  holder release somebody else's. Each record was minted with an operation identifier that nothing
  ever compared, and three paths deleted by key alone — the damaging one being a budget timer that
  freed the key while the operation it named was still writing. A runs long and its own timer frees
  the key; B arrives, finds nothing, registers; A finishes and deletes B's record; B's timer is now
  armed and unowned and fires into C's life. Nothing went red. The timer no longer releases — it
  warns. An operation outliving its budget is a thing to look at, not a lock to break, and aborting
  it is not honestly available: nothing here can cancel a transaction in flight, so the work would
  carry on and commit while its caller was told it had timed out. The five-minute sweep beside it
  is deleted rather than repaired: it was unreachable while the timer always got there first, and
  the only thing it could do once the timer stopped deleting was reintroduce the same bug on a
  longer fuse. Every time-based release is the defect, whatever its interval.
- **Rebinding an element's class takes the same lock as writing its attributes.** Two mutations
  write an element's derived findings through the same helpers, and only one of them held a lock —
  so an attribute write and a class rebind on one element were excluded from each other by nothing
  at all, and neither had any idea the other was running. The lock is taken on the element id, so
  the two now exclude each other rather than each only itself, and it wraps the whole call rather
  than the write transaction: the part a database cannot arbitrate is what happens before any
  transaction opens — the preflight read, and the module calls whose findings the transaction then
  writes. Engine-level conflict detection gives a transaction atomicity; it does not give two
  callers the absence of overlapping read-decide-write work across separate sessions.
- **The guard that refuses to affirm a superseded finding now reads inside the transaction it
  guards.** Affirming a superseded finding resurrects a retired row into a second live finding for
  one risk. The guard read in one session and wrote in another, so a supersede landing between the
  two passed a guard that had already decided — and the retry made that window *worse* rather than
  narrower. With the competing supersede still uncommitted, the guard's read saw the pre-supersede
  state and passed; the write then conflict-aborted, and the driver's managed retry re-ran the
  write alone, because the read sat outside the callback and was never repeated. So the retry
  landed the affirmation on top of a supersede that had committed in the meantime: the guard did
  not merely fail to fire, the retry machinery carried the affirmation over it. The read now
  happens inside the write's own transaction, so a retry re-reads, and the refusal is thrown rather
  than returned so that the rollback is the refusal's own mechanism — returning a sentinel would
  have committed the lock the refused call took in order to read under.
- **A document read can no longer be pointed outside the scope of the call that asked for it.** The
  read took a scope and never consulted it: its multi-key mode read the address straight out of the
  caller's filter, which arrives as JSON that nothing validates, so naming another scope's address
  read another scope's documents. The address must now name the call's own scope. The type check is
  part of the fix rather than tidiness beside it — the address is assigned out of unvalidated JSON,
  so it can arrive as a string, and on a string a membership test is substring matching, which
  defeats a scope check written without the guard.
- **The plugin's reviewer was missing two tools its own skill calls.** The surface skill runs as the
  read-only reviewer agent, whose frontmatter enumerates a tool allowlist; naming that list makes
  those the only tools available, and neither of the two the skill instructs it to call was on it.
  The skill describes one of them as the only model-wide exposure route, so the exposure counts and
  the whole of the MITRE-grounded gap analysis could not run. Both are reads, and the read-only
  mandate is prompt-enforced and unchanged by this: the allowlist never was the control that kept
  the reviewer from writing. A create-and-run tool that appears twice in the skill is deliberately
  not added — both appearances are inside fenced blocks telling the reader how to run an analysis,
  so it is printed text rather than a call.
- **A tactic an ATT&CK release renames no longer sorts to the front of the matrix.** The client
  sorts the server's tactic list against a hardcoded matrix order, and that sort compared bare
  lookup results — which yield −1 for any name the list does not carry, placing an unrecognised
  tactic first rather than treating it as unplaced. An unknown name now sorts last and is still
  returned, since dropping it would lose a tactic the caller asked for, and unknown names tie so
  their relative order is left as the server returned it. A dataset ingested before v19 still
  reports the retired name, so a transitional alias maps it onto the slot Stealth now occupies.

### Security

- **Nine advisories cleared across four dependencies.** `multer` floored at 2.3.0 for four
  advisories — the previous floor admitted 2.2.0 as a legal resolution and the lockfile was pinned
  exactly there, so a frozen install would have held a vulnerable resolution indefinitely, and one
  of the four names that single version as its whole vulnerable range. One caveat is worth stating
  plainly: 2.3.0 does not fully close the field-array advisory, whose guard is opt-in and defaults
  to unbounded. That is inert here, because `multer` arrives only as a transitive of the Express
  adapter and nothing instantiates it — but anyone adding a multipart upload endpoint must set that
  limit explicitly. `hono` moves to 4.13.5 for three advisories, from a lockfile resolving 4.13.1,
  inside the range of all three. `vitest` moves to 4.1.11 in the console's interface project, whose
  own lockfile the workspace-wide update does not reach; no override was needed, the declared range
  already admitted the fix and the lockfile was simply stale. And `google.golang.org/grpc` 1.83.2
  for a panic reachable on an xDS-configured server — not reachable here, where gRPC is indirect
  and the only listening socket is a plain HTTP server, and taken because it is cheap.
- **Three dependency overrides were dropped after checking whether each still did any work.** The
  check is a resolution probe with the override removed rather than a version comparison, because
  the lockfile records ranges rewritten to mirror the active override and so cannot answer the
  question on its own. An `ajv` floor bought no margin, since the minimum resolution without it is
  already the patched version. A `minimatch` entry was forcing two dependents onto a major neither
  declared, because an override key's qualifier matches a dependent's *declared* range rather than
  its resolution. A `zod` pin rested on a peer requirement the SDK does not actually state, and had
  begun forcing a version outside the plugin's own declared range. A `lodash` override that looks
  inert is kept and bounded below the next major: without it a second copy resolves through a
  transitive that pins an older version exactly, and an open-ended override resolves to the highest
  satisfying version fleet-wide, which is how a future major gets hoisted across consumers that
  only ever declared the old one.

### Documentation

- **The user guides describe the product that ships.** A second audit against the source found the
  same class of drift the previous pass removed, spread across most of the guide set: interface
  affordances that exist in no component, invented example output, deprecated concepts taught as
  current, and integrations described as shipping when nothing implements them. Module assignment
  is retired — the class catalogue is deployment-wide, and the guides now explain where classes
  come from and how to get more rather than how to assign a module to a model. A bidirectional
  issue-tracker sync section is gone; the real seam is one optional, inbound-only, pull-on-read
  hook that no shipped module implements. Retired AI class generation is gone from four guides that
  still told readers to click an icon no settings surface carries, replaced with the class picker
  and browse drawer that do exist. A merged issue is created with an empty attribute string, so
  severity and scoring are dropped — documented with a warning rather than left implied. Analysis
  status renders as Ready, Working, Paused, Done or Failed and never "idle"; re-running replaces a
  row's result rather than accumulating history; and the distribution's shipped analysis type runs
  no AI, so the module-dependent hedge on progress and clarifying questions is restored. The
  countermeasure documentation now names which relations are actually exposed and emitted and which
  are reserved, and states that a countermeasure derives from the control's own classes and is
  identical wherever assigned — assignment decides coverage, scoped to the element or its immediate
  parent boundary.
- **The operator guides cover the administrator gate and the access list.** New sections state who
  can change a connected deployment, which controls need the role, what each of the four refusals
  means, and that a deployment connected with a recipe naming no team is not checked at all. Two
  documents said disconnecting never contacts the cloud and is always available; neither has been
  true since the gate shipped, and the correction names the two narrower guarantees that do hold —
  a session you already hold keeps the ability to revert while the *platform* is down, since the
  check asks a different dependency, and a deployment whose configuration can never obtain the
  credential is not locked in.
- **The flow-store document describes the write the platform now makes.** Its two save listings
  sent the whole merged element, and the word *delta* appeared nowhere in 848 lines — a reader
  following it would have built exactly the caller the platform has just stopped accepting. A new
  section carries the mechanism end to end: why narrowing exists at all, what a call site must
  supply and why the object naming the user's edit is the only part that states intent, the
  merge-then-project order and why the baselines are taken before the merge, the four rules the
  projection keeps with the real case behind each, and the replace-versus-delta decision table —
  including the duplicate-edge trade taken deliberately. Ten further drifts were found while
  verifying it, none of them in the brief: four listings did not match the code they claimed to
  show, two more were earlier implementations, a deduplication window was stated as five seconds
  and is fifteen, and a retry section implied mutations retry when they deliberately do not. Source
  citations are symbols now rather than line ranges, every one of which had drifted onto a closing
  brace or a blank line.
- **The operations reference describes the methods that exist.** Six writer signatures were wrong,
  two of them with worked examples that would not have run. The audit past those six is where the
  value is: every one of the eight MITRE methods documented on the two framework classes is absent
  from the code, two analysis methods resolve an identifier rather than a session, a subscription
  example a reader would copy calls a signature that takes no callback, and two documented read
  methods exist nowhere in the package. Alongside the corrections it now states the two contracts
  every writer obeys, from the writer's side — a field the element does not define is not written,
  and a link list is a delta when the caller can say what it held before and a replace when it
  cannot.

## [0.8.0] - 2026-09-03

Two things an operator does often get shorter. A deployment now reads its subscription from the
cloud on every catalog load rather than from a value frozen into its configuration when it
connected, so a package bought today reaches a running deployment with a **Refresh** instead of a
reconnect. And analyses open from a button on the canvas rather than from a tab buried in the model
dialog. Alongside them: two corrections to numbers the product reports, a plugin that could not
authenticate against anything sitting behind the platform, and a content mount that could report
itself current while the platform served something else. Compared against the previous tag,
`v0.7.0`.

**Upgrading:** take the new bundle, and if you use the plugin, move to `@dether.net/dethereal`
0.4.4. Nothing in an existing `.env` needs an edit, and no saved recipe needs regenerating — the
retired `DEPLOYMENT_PACKAGES` value is accepted on paste and dropped, so a recipe you already hold
keeps applying. One case does need you to act: if the **Content** tab reports that subscriptions
cannot be checked on this deployment, that deployment's configuration predates the permission the
check needs, and only a fresh recipe fixes it — read what disconnecting costs before you apply one.
Reports and counts produced before this release may be inflated; see the first two items under
*Fixed*.

### Added

- **A deployment reads its subscription from the cloud, not from its own configuration.** The
  console used to learn which content packages a deployment was entitled to from a value written
  into its configuration at the moment it connected, and gated the **Content** tab on that copy. A
  subscription is not a fixed fact. Buying a package stayed invisible until the operator regenerated
  the recipe and reconnected — and a disconnect removes every cloud-provided module, after which the
  platform deletes the classes those modules contributed along with every link into them, including
  links from analyses already run. The cheapest way to see a new package cost the graph.
  `GET /api/packages` now asks the content service on every catalog load, carrying the operator's own
  access token on a header of its own; the public catalog half of the same call still carries no
  credential. Subscribe, come back, click **Refresh** at the top of the tab, and the package is
  mountable straight away. A lapsed subscription arrives the same way. Not being able to ask
  restricts nothing: no token — the ordinary state of a reloaded tab, since the browser holds it in
  memory only — a timeout, a refusal, a malformed answer, or a content service that predates the
  surface all leave the subscription undetermined, under a line saying which of them happened. An
  unreachable service must never make a subscriber look unsubscribed. An empty list is different:
  that is an answer, and it means entitled to nothing. A deployment whose configured scope cannot ask
  at all is told exactly that, rather than invited to retry something that will never work.
- **Analyses open from the canvas, not from a tab in the model dialog.** They are now the fourth
  button on the data flow editor's toolbar — **Analyses**, the sparkle icon, beside **Model
  settings**. Analyses are the loop you return to while modelling (run, wait, answer, view) and were
  sitting two clicks behind two tabs you edit once; worse, that tab lived inside the form whose
  submit saves the model, so pressing Enter while renaming an analysis saved the model and closed the
  dialog out from under you. The "needs your input" badge moves onto the new button, where a run
  paused at a human-in-the-loop interrupt is visible on the canvas without opening anything — it
  never lit before, because it matched on a field the platform returns as a list. There is no route
  to analyses from the model browser any more: the tile opens the canvas, and the dialog behind
  right-click carries General and Controls, so the guides route through the editor. The canvas polls
  every 20 seconds and idles while the tab is hidden, refetching when you come back, in place of the
  dialog's unconditional 5. Every toolbar button is now keyboard reachable and carries a real
  tooltip; the lock button had neither.

### Fixed

- **Three write paths were appending duplicate relationship edges, and counts read off them were
  wrong.** Saving a component, a boundary or a data flow re-created every control and data-item
  association it already had — one extra edge per element per save, including a save that changed
  nothing but a position on the canvas. Assigning a control to elements it was already assigned to
  did the same, and passing one element twice in a single call produced two edges from it. The MITRE
  pack exporter put export wall-clock inside the relationship `MERGE` pattern, which made the
  timestamp part of the edge's identity, so every regeneration matched nothing and duplicated the
  whole set: measured across one regenerate-and-re-ingest cycle, 22,895 edges became 42,972. Nothing
  underneath deduplicates — neither supported engine can express an endpoint-pair uniqueness
  constraint on a relationship, and the GraphQL `connect` compiles to a bare `CREATE` — so these
  accumulated until a downstream aggregation exhausted memory. Element saves are now replace
  semantics, which is what the comment above each of them already claimed, and they are self-healing:
  an ordinary save collapses duplicates already on disk for that element. Control assignment reads
  what is attached and connects only the difference. A second pack ingest is now a no-op, all 123
  relationship types at a ratio of 1.00. Nothing here sweeps the database, though — edges outside
  those healing paths stay where they are, and any figure you read off them before this release was
  too high.
- **The threat report's ledger over-counted, by a lot.** It reported roughly 7.7× the true element
  rows, 8.0× the finding entries and 5.8× the supporting-control entries. Three defects in one query,
  all of them the same underlying thing: the engine's aggregation silently declines to collapse
  certain shapes and returns plausible-but-wrong data rather than failing. Deduplicating a collection
  of maps stops working the moment any value in the map is null, and most exposure fields are null on
  an active finding; a list-valued column was carried as a grouping key, which multiplied the element
  rows themselves; and the duplicate `SUPPORTS` edges above rode through unchecked, which is where
  the control count came from. The obvious remedy is worse than the bug — re-projecting from
  collected nodes gives the right count of the wrong data, where a two-finding element reads as its
  first finding twice and the second is silently dropped. The shape that shipped deduplicates on a
  scalar tuple and re-projects by index, which also preserves nulls rather than turning "not scored"
  into a placeholder score. If you acted on a report produced before this release, its totals were
  inflated; the duplicate edges behind part of that are still on disk, and the query no longer counts
  them. The query is now pinned against a real engine rather than against inference, with every
  assertion comparing identities rather than lengths — the first version of that suite asserted
  lengths and passed against a ledger reporting one finding twice in place of two.
- **The plugin could not authenticate against anything behind the platform.** Two refusals, both live
  at once, and either alone was enough. It presented the OIDC identity token as its bearer; the
  platform's own guard accepts that, because it validates a signature and an audience rather than a
  token's use, so nothing looked wrong locally — while a resource server behind the platform does
  check, refuses anything that is not an access token, and the refusal arrives as an opaque server
  error. The bearer is the access token now, on both the stored-token and the transparent-refresh
  path; the second fails an hour later and is the one an edit misses. And the login hardcoded
  `openid profile email`, so no token it could mint carried a resource-server scope even after the
  swap. It now requests what the platform advertises, falling back to those base scopes where a
  platform advertises none, which is what keeps existing stored sessions valid. Requesting more is not
  enough on its own: a refresh grant carries no scope parameter, so a session minted under the old
  scope can never widen by refreshing. The plugin records what was actually granted and falls through
  to a fresh authorization instead of refreshing an under-scoped token forever. Keeping the bearer and
  the identity token apart is also what keeps audit attribution honest, since only the identity token
  carries an email address. Separately, a module resolver refused upstream now reports
  `UNAUTHENTICATED` rather than a generic module failure, which had been sending operators to
  investigate a platform that was fine.
- **A content mount could report itself up to date while the platform served the previous version.**
  The console writes a mount's marker before its module file, deliberately: the other order can leave
  a loadable module in a directory that both mount and unmount then refuse. The cost landed on a
  re-mount. A module-file write that failed afterwards — or an abrupt death between the two writes,
  which no error return can report — left the marker at the new pin and a valid module file at the
  old one, and the currency check only asked whether that file existed. The row rendered `up to date`
  while the platform went on serving the previous pin's classes, schemas, guides and evaluation. The
  check now reads the file back and asks whether it names the pin the marker records. A mismatch gets
  its own state — **module file mismatched**, rendered in the fault tone rather than the warning tone
  used for a merely outdated mount — and the row offers **Repair**, which mounts again at the pin
  already recorded rather than quietly substituting a different version. Publishing a module file now
  writes a temporary file and renames it into place, closing that window for every failure the
  temporary write catches.
- **Icons went missing on the load after signing in.** Coming back from the identity provider
  rendered every icon as an empty square until a cache-bypassing reload. Icons are a webfont, and the
  callback page paints one — starting the font download — then navigates away, cancelling it
  mid-flight and leaving the next document to render without it. That page's two glyphs are inline
  SVG now, and the font is preloaded from the emitted bundle, which also fixes slow icons on any cold
  load rather than only after a login.
- **The settings panel opened on whichever tab the last selection left it on.** Dropping a component
  or drawing a data flow landed you on Exposures or Controls — two empty tables for an element that
  has just been created — hiding the name and description you came there to fill in. A newly created
  element now opens on General, and the panel stays put if you are part-way through editing a
  different one.

### Changed

- **`@dether.net/dethereal` 0.4.4.** The plugin is versioned and published on its own line; this
  version carries the authentication fix above and its refreshed dependency ranges. *Correction:*
  0.4.4 was declared here and never published — the registry stayed at 0.4.3. The authentication fix
  first reaches an installed plugin in 0.4.5, under the 0.9.0 release.
- **The browser tab reads "Dethernety | Threat Modeling".** The previous title was a strained
  portmanteau matching nothing else in the product. A tab, a bookmark and a history entry all read
  from it, so the brand leads and the rest survives truncation.

### Security

- **The bundle's runtime layout is harder to redirect.** `data/` carries the sticky bit, so a
  non-owner can no longer replace one of its children between runs — the directories under it are
  world-writable by necessity, and permissioning each by name follows a symlink planted in place of
  one. The bit is deliberately not applied to the modules, schema and mode directories, whose entries
  are written by containers and legitimately replaced under a different user than installed them.
  Separately, the mode file is refused outright if it is a symlink: an existence test dereferences,
  so a dangling link there would have had the bundle create the operator's file wherever the link
  pointed — holding a configuration layer that turns authentication off.
- **URL-shaped recipe values are refused if they carry userinfo.** A `user@host` prefix is lifted out
  of the host during parsing, so a value could name one host, pass every other check, and resolve to
  another. The redirect the console writes, and derives its allowed origins from, is now validated
  where it is written rather than left to its caller.
- **Six advisories cleared across three dependencies**, each of which resolved below its fix in this
  workspace's lockfile: `fast-uri` floored at 3.1.6, `qs` at 6.16.0, and `browserslist` newly pinned
  at 4.28.7. The `browserslist` pin matters more than the version suggests — the lockfile held three
  distinct copies, so clearing the advisory on the highest would have left two in range. Also
  `google.golang.org/grpc` 1.83.1 for a heap-exhaustion advisory reachable by fragmenting HTTP/2 data
  frames; it is an indirect dependency and nothing here serves gRPC.

### Documentation

- **The guides route through the editor, and drop a click target that never existed.** Every
  walkthrough that said to open the model dialog and click the Analysis tab now stops at a step the
  reader cannot perform — worst of them the threat report's getting-started page, where it was step
  2 of a shipped module's onboarding. Four documents also told you to open the model dialog by
  clicking the model's name on the canvas; that name plate has never had a click handler, and it is
  the **Model settings** button beside it that opens the dialog. Two more sent readers hunting for a
  star icon to start a run, which analysis rows have not carried since they gained labelled buttons.
- **The operator guide said a disconnect costs nothing, above an operation that deletes data.** It
  now states what a disconnect removes — every cloud-provided module, and at the next restart the
  classes those modules contributed together with every link to them, including links in analyses
  already run — and the console asks you to accept the same list before it proceeds. That correction
  was owed before this release and would be owed without it.
- **Two false claims in the architecture set were corrected, and four shipped designs stopped calling
  themselves drafts.** One document described an append-only method as using a
  disconnect-and-reconnect pattern it must not use; the other cited a test file that exists nowhere
  in the repository, above a table formatted as an inventory that was really a pre-implementation
  plan. The plan is now labelled as one, beside a dated as-built table with measured counts.

## [0.7.0] - 2026-08-26

Entitled code arrives on the deployment. The console could already mount content packages, whose
bytes the platform fetches per request; it can now install a signed **artifact** — code delivered
once, verified before it is placed, loaded from disk thereafter. Alongside it: a knowledge-graph
access contract that answers identically from a local graph or a remote service, a batch of
correctness fixes in the plugin and the editor, and a deployment fix without which the bundle does
not start on a bind mount at all. Compared against the previous tag, `v0.6.1`.

**Upgrading:** take the new bundle. If your database never started — the container exiting
immediately, or restarting forever on a permission error naming its log file — that is the first
item under *Fixed* and it is why. The new bundle adds one directory beside your data
(`data/memgraph-log`); nothing else requires an edit to an existing `.env`.

### Added

- **The console installs, reports and removes signed artifacts.** `POST /api/artifacts` fetches a
  descriptor and an archive from the content service carrying the operator's own access token on its
  own header — the console holds no credential of its own for this and keeps nothing between
  requests. The archive is verified against an identity **derived from the key and version that were
  requested**, never from anything the service returned, and the stamp inside the payload must name
  the same two. Signing is keyless: there is no key to distribute, nothing to rotate, and no
  override. A tampered archive, an unverifiable one, or one carrying another version's valid
  signature is refused and nothing is placed. What is installed is discovered by scanning the
  modules directory rather than tracked in a ledger, so a scan cannot disagree with the disk.
- **A knowledge-graph access contract with two implementations.** `KgClient` is a closed set of
  named, keyed, batch-shaped queries — never raw Cypher, never an unkeyed enumeration — and a
  consumer cannot tell whether it is being answered from the deployment's own graph or from an HTTP
  service. One contract suite runs against both to prove they answer alike. `createKgClient` selects
  from configuration rather than introspection: a base URL with a valid digest gives the remote
  implementation, a base URL with a missing or malformed one reports unavailable and logs the
  misconfiguration once, and no base URL at all gives the local implementation.
- **Disconnecting from the cloud now asks first, and takes the cloud's modules with it.** A
  deployment the console reports as pure open-source while it still serves cloud-provided modules is
  not one. The disconnect removes every module the console placed — content mounts, installed
  artifacts, the knowledge-graph connection — each identified by the marker file written beside it,
  and never touches a directory it did not write. The console deletes files and issues no database
  command; what the platform does with a module it no longer finds is stated in the confirmation
  before anything is removed.

### Fixed

- **The database would not start on a bind mount — on any host, for one of two reasons.** Two
  independent faults shared a single symptom, and each platform showed only one of them.

  The first is **ownership**. The database refuses a data directory it does not own — an ownership
  comparison, not a permission one — and the control script answered that question from the
  container engine's *name*: the operator's own uid under Docker. That holds for Docker Engine on
  Linux, where uids pass through to a bind mount, and is false on Docker Desktop, whose file-sharing
  layer presents every bind mount as root-owned. On macOS and Windows the database was handed a uid
  that could never match. The script now asks the engine directly, with a short-lived container that
  reports the owner as the container sees it, so there is nothing left to infer.

  The second is **the log directory**, and it is why the first was so hard to read. The image ships
  `/var/log/memgraph` writable only by its own user, so a container running as anyone else dies on
  its first log line — reporting a permission error that names the log file while the ownership
  fault it was really failing on goes unmentioned. On macOS the corrected uid is root, which can
  write anywhere, so fixing ownership alone appeared to fix everything; on Linux the corrected uid
  is the operator, and the database still could not start. The log directory now comes from the
  host, created world-writable, which satisfies the image's own user in named-volume mode and the
  operator in bind mode. A named volume would not do: the engine seeds one from the image,
  ownership included.

  Verified on four combinations — Docker Desktop and Podman on macOS, Docker Engine and rootless
  Podman on Linux — each starting healthy and writing its log where the operator can read it.
- **The console told operators their callback URLs were already registered.** The text sat directly
  beneath a box containing two callback URLs and said local development addresses are always
  accepted and not listed there — wrong twice over, since the reader is looking at exactly the thing
  it claims is not shown, and only specific host, port and path combinations are registered. A
  reader who believed it skipped the step; the failure then lands at the identity provider, where
  nothing in the operator's own logs explains it. It now says to paste both and save, without
  exception. The same sentence has been corrected in the connect procedure of the documentation.
- **A second delete never opened its dialog.** Deleting a second component from the data-flow
  settings panel silently did nothing until a page reload. The panel raised its own flag while the
  confirm dialog closed itself internally, leaving flag and visible state disagreeing; the next
  delete then assigned `true` to a ref already holding `true`, which is not a reactive change, so
  nothing remounted and no watcher fired.
- **Class binding ignored component type.** A component class is bound to exactly one component
  type, but a PROCESS component could be offered — and successfully assigned — a STORE class. The
  exposures and countermeasures instantiated from that class then described something the element is
  not. Both directions of the hole are closed, and the error taxonomy documents the constraint.
- **The plugin reported success for work that did not happen.** An audit surfaced a recurring shape
  — an operation claiming to have done something it had not, or a metric measuring a proxy rather
  than the thing it is named after — and the confirmed instances are fixed. Attribute stubs were
  seeded with each field's schema default instead of null, so the enrichment checklist skipped them
  by construction and shipped an assertion nobody had made. A follow-up guards every path that can
  destroy an attribute file, not just the one the first pass covered.
- **Every URL-shaped recipe value is held to its contract.** The scheme check constrains scheme
  alone — https, or http only on loopback — and never the destination, which is the product rather
  than a defect: a recipe names the cloud service a deployment talks to. Refusing redirects is the
  control that matters when the host is caller-nameable by design, and the comments on that path now
  say so rather than asserting a property the code does not have.
- **The signer refusal named only one spelling of a workflow file.** The pattern accepts both
  extensions; the message mentioned one, sending an operator to check a value that was already
  correct.

### Documentation

- The console's public documentation describes the artifact install, its routes and its second
  credential — the previous set described a daemon with three responsibilities and listed eleven of
  its sixteen routes, and the credential inventory predated both a second credential and an outbound
  trust boundary.
- The plugin's nineteen documents were audited against source; eighty-four discrepancies were
  raised, seventeen refuted as design records or misreadings, and the rest applied — each
  re-verified before it was written.

## [0.6.1] - 2026-08-14

A deployment fix. The bundle shipped in 0.6.0 does not start under Podman when Podman's own
compose provider is the one installed — `./byodt up` fails on unusable image references. Docker
deployments are unaffected. Compared against the previous tag, `v0.6.0`.

**Upgrading:** take the new bundle. If you keep your existing `.env`, add the registry to the
three third-party image keys (`docker.io/…`, as in `.env.example`) — that one edit is what an
existing file is missing.

### Fixed

- **Only the last `--env-file` was being read.** The control script passed two — the readable
  configuration and the generated secret — which Docker Compose merges and Podman's compose
  provider does not: it keeps the last and drops the other. Every value interpolated from the
  configuration then resolved empty, so the deployment came up with no images, no published port
  and no database user. What disguised it as an image problem is that the values carrying a
  default in `compose.yaml` fell back and looked healthy; only those without one appeared blank.
  The script now passes one file and hands the secret to Compose through the environment, which
  also keeps it out of any file beside the readable configuration.
- **The console image reference was built by nesting one variable inside another's default.**
  Podman's compose provider does not expand that, so the reference reached the engine as a
  literal `…:${PLATFORM_VERSION}`. The control script now derives the value itself, which keeps
  `PLATFORM_VERSION` the single version knob without depending on nested expansion. An explicit
  `CONSOLE_IMAGE` still wins, so a mirror stays repointable.
- **The third-party images were named without a registry.** Docker quietly assumes Docker Hub;
  Podman refuses an unqualified name unless the host has configured a search registry, which a
  default installation has not. They are fully qualified now.
- **The database would not start on its own data directory.** Memgraph requires the directory to
  be *owned* by the user it runs as — an ownership check, which no permission bits satisfy — and
  which host user that corresponds to inside the container depends on the engine. On the default
  host bind mount it never matched, so the database exited immediately and was restarted forever,
  logging only its banner. The control script now runs the database as the user that owns the
  directory, derived from the engine it resolved. The data stays owned by, and readable by, the
  operator, which is the whole reason to choose a bind mount; chowning the directory to the
  image's own user would have started the database but left its data unreadable from the host.
  A named volume is unaffected either way — the engine creates it owned correctly.
- **A first run could wedge itself on the schema file.** One file is bind-mounted into the
  platform, and a container engine handed a bind source that does not exist creates a *directory*
  in its place. The one-shot whose job is to write that file then failed with "is a directory", on
  every retry, until someone removed it by hand. The ordering that should have prevented it — the
  platform waiting for the one-shot to finish — is honoured by Docker Compose but not reliably by
  Podman's provider. The control script now creates the file itself before anything mounts it, and
  clears the stray directory if a previous run left one. It refuses outright if that path is a
  symbolic link, and creates the file carrying its mode rather than adjusting the mode afterwards:
  the directory has to be world-writable for the one-shot to write there, so following a link
  planted in it would let anything with local access redirect a file the operator creates.

### Added

- **Continuous integration resolves the bundle under both compose providers**, and fails on an
  image reference that is empty, untagged, unexpanded or unqualified — the four shapes the
  defects above took. The Podman leg pins the provider explicitly: left to choose, Podman prefers
  Docker's provider when it is installed, which is precisely why every check run before the
  release agreed with Docker and none of this surfaced.

## [0.6.0] - 2026-08-14

The release that makes the platform self-hostable: a signed deployment you download and run,
and an operator console that sets it up and reports on it — in place of assembling a stack by
hand. Compared against the previous tag, `v0.5.0`.

**Upgrading:** nothing in the platform itself changes. The `demo/` directory is gone — see
*Removed* — and the deployment bundle replaces it as the supported way to run Dethernety. In the
bundle, `PLATFORM_VERSION` is the single version knob: it selects the platform image and the
console image together, so upgrading is a one-line change.

### Added

- **A complete deployment, published as a signed release asset.** `byodt-<version>.tar.gz`
  carries a compose stack — graph database, embedding server, platform, operator console and an
  nginx front door — plus `byodt`, a wrapper over Docker **or** Podman that carries the two
  environment files every command needs, so the database password stays out of the readable
  layer. `./byodt up` seeds the configuration, generates that password, creates the runtime
  directories and starts the stack. One published port serves the platform and the console on the
  same origin, bound to loopback by default.
- **An operator console**, served through the front door at `/console/`. It runs twice, in two
  forms. Before the platform starts, a one-shot places the schema, fetches and verifies the
  signed modules, and ingests the MITRE corpus; a version or schema problem stops the start,
  while a module or ingest problem is recorded and the stack still comes up, so the deployment is
  diagnosable rather than silently empty. Then a daemon serves the console itself: per-service
  status, the failure states worth acting on, and the configuration changes the operator owns.
  Published as a multi-architecture image (`linux/amd64`, `linux/arm64`), cosign-signed against
  the release workflow's own identity with build provenance attested.
- **Verified module installation.** The console resolves the release by `PLATFORM_VERSION` and
  never picks a version of its own; it verifies each payload against the signed `modules.json`
  index with the certificate identity pinned to the exact release workflow, and extracts under
  hardened tar limits.
- **Operational commands** in the bundle: `status`, `logs`, `restart`, `update`, `down`,
  `destroy`, and snapshot-based `backup` / `restore` — a hot, consistent graph snapshot copied
  out of the stack, restorable onto any deployment of the same version. Automatic in-place
  snapshots are configurable for crash recovery, and the database's storage can be a host bind
  mount or a named volume, which is the difference between an inspectable data directory and one
  that survives a VM-backed runtime's file-sharing layer.
- **TLS at the front door**, terminating for the whole deployment — platform, console and API
  behind one endpoint — from a generated self-signed certificate or your own.
- **An optional cloud-connected posture.** A deployment stays local and calls out to nothing
  unless an operator pastes a deployment login recipe into the console, which writes it into a
  configuration layer the platform reads on the next recreate. The console copies out only a
  closed set of variable names and refuses the whole paste if the recipe carries anything else,
  so the recipe cannot reach the variables that would turn authentication off or load code at
  boot. Disconnecting rewrites the same file with the local values and contacts nothing, so the
  recovery path never depends on the thing it recovers from.
- **Content mounts.** On a cloud-connected deployment the console can mount content-backed
  modules — a small stub naming a module key and an immutable pin, not a download — and report
  when a newer version of a mounted package exists.
- **Deployment documentation**: an architecture set covering the deployment, the console, the
  supply chain and the security model, and a user set covering installation, configuration,
  operations, the cloud connection and troubleshooting.

### Changed

- **`@dether.net/dethereal` 0.3.5.** The plugin is versioned and published on its own line; this
  version carries its refreshed dependency ranges.
- **The documentation names the deployment rather than a demo.** The README, the configuration
  guide and the glossary describe a deployment you run, with the auth-disabled mode named for
  what it is — single-user and development — rather than for a demonstration.

### Removed

- **The `demo/` directory.** It existed to stand a stack up before there was a supported way to
  run one; the deployment bundle is that way now, and keeping a second, differently-configured
  stack in the tree only invited running the wrong one.

### Security

- **`nanoid` floored at 3.3.18** (`GHSA-2v37-7h3g-55p8`, CVSS 8.2 — custom generators can loop
  indefinitely at size zero). It arrives transitively through `postcss`, so it is pinned by
  override rather than lifted; the upper bound is load-bearing, because an unbounded floor
  resolves an ESM-only major into a consumer that cannot take it.

## [0.5.0] - 2026-08-07

A release that removes a service from the deployment, adds security boundary zoning to the
model, and hardens the platform across four libraries. Compared against the previous tag,
`v0.4.0`.

**Upgrading:** the OPA server is no longer part of any deployment — see *Removed*. Container
images are now published, so a deployment no longer has to build one.

### Added

- **Security boundary zoning** — trust zones, domains, roles and approved channels on
  boundaries, with conduits between them. Declared zone policy surfaces in the Threat Report,
  and Boundary Crossings appear in the export alongside the data-flow policy. The Dethereal
  plugin models and pushes zoning as well, so it is authorable from either surface.
- **Published container images.** Releases now publish a multi-architecture image
  (`linux/amd64`, `linux/arm64`) to the GitHub Container Registry, signed with cosign against
  the release workflow's own identity — so verification needs no key from us — with build
  provenance attested alongside. The run summary prints the `cosign verify` invocation.
- **`DtRemoteModule`** in `@dethernety/dt-module`: a sibling of `DtFileOpaModule` that serves
  class metadata, templates, guides, embeddings and evaluation from an HTTP content service
  instead of a local data directory. Every difference — network, caching, unavailability — is
  expressed through the existing `DTModule` contract, so the platform stays unaware that a
  module is remote.
- **`afterInstall` module lifecycle hook**, invoked post-commit, with documentation.
- **Class unassignment** — a remove-class action in the UI, and explicit-null `classData` on
  model push so the removal survives a round trip.
- **Read-only `dt-core` accessors exposed to module bundles**, plus disposition-reason prefill.
- **Optional per-request token on the four content methods** (`getClassTemplate`,
  `getClassGuide`, `getExposures`, `getCountermeasures`), a deployment access allowlist, and a
  configurable OIDC scope — all backward compatible with existing modules.
- **Rego finding mappers as a reusable subpath export** of `@dethernety/dt-module`.
- **A signed module release channel.** The open-source code modules are published as
  cosign-signed release assets alongside a signed `modules.json` index, which carries the release
  tag so an older index cannot be replayed as a current one. Payloads are stamped with the
  identity of the release that produced them. The release workflow is split in two so the signing
  token is never present while any dependency's install scripts run. *(Recorded after the fact:
  this landed between the entry below being written and the tag being cut, so it shipped in
  0.5.0 — its assets are this release's assets — without appearing here.)*

### Changed

- **Rego evaluates in process.** Both the runtime and authoring paths now use
  `@dethernety/regorus-wasm`, a vendored WebAssembly build of Regorus, instead of calling out to
  a policy server.
- **`@dethernety/dt-module` is versioned independently of the platform** from this release. It
  moves with its own interface rather than with the application.
- **`@dether.net/dethereal` 0.3.4** — the plugin is versioned and published on its own line, not
  with the platform. This version carries its refreshed dependency ranges; a package whose
  declared dependencies move has to be republished for the change to reach anyone installing it,
  and the repository had moved ahead of the published copy.
- **The default MITRE embedding corpus** is committed rather than regenerated per build.

### Removed

- **The OPA server.** It is gone from the compose stack, the configuration guide and the
  documentation, and nothing in the platform contacts a policy server. Deployments running one
  for this platform can decommission it; no configuration replaces it.

### Fixed

- **`OIDC_JWKS_URI` was read as `OIDC_JKWS_URI`.** The transposition was internally consistent,
  so nothing appeared broken — but an operator who spelled the variable correctly got
  schema-level authentication silently un-enforced outside production, and a boot failure
  naming a variable they had not set inside it.
- **The production container image probed the wrong port.** It declared `EXPOSE 3000` and
  health-checked `localhost:3000` while the server listens on 3003, so the container reported
  `unhealthy` for its whole life and anything gating on health waited for a condition that
  could not arrive. `docker:run` published the same wrong port.
- Node labels are drawn above connection handles in the diagram editor.
- **Dethereal drift detection** sees source files outside the model directory, so a model whose
  sources live elsewhere in the repository no longer reports as drift-free when it is not.
- MITRE technique mappings in `dethernety-general` re-synced after a corrected export.
- **Four remediation sweeps** across the backend, the frontend, the data-access layer and the
  module base library, covering concurrency, correctness, crash safety, the analysis lifecycle,
  module-installer safety, class-identity migration, cross-engine DDL, and honest health
  reporting.

### Security

- **Only verified JWT claims reach the GraphQL auth context.** The context factories previously
  placed the unverified `Authorization` bearer into `context.jwt`, which the schema layer treats
  as authenticated.
- **Fail-closed query depth guard**, and security headers in every environment rather than only
  in production.
- **Deployment access allowlist**, fail-closed for a network-reachable deployment on a shared
  identity provider.
- **A tag name could execute in the release workflow.** A release step built its program text by
  string concatenation around the tag, so the name a release is cut from was executable rather
  than data. It is passed as a variable and matched literally now. *(Also recorded after the
  fact — same window as the module channel above.)*
- Dependency sweeps with security override floor bumps.

## [0.4.0] - 2026-06-24

A feature release expanding the Threat Report's reachability analysis, redesigning
the analysis-run experience, and overhauling the issue-management surface — closed
out with a full dependency-security pass. Compared against the previous tag, `v0.3.0`.

### Added

- **Threat Report — Blast Radius analysis**: a reachability mode tracing how far an
  attacker can reach from a node, Pick-Two choke-point identification with first-hop
  flow, and a "view strip" that jumps from a Blast Radius node into the Pick-Two view.
- **Analysis dialog redesign**: a `hasDocument` completion signal threaded through
  `AnalysisStatus`, a status-derived run phase, two-button + overflow row actions
  driven by that phase, and an Analysis-tab badge when a run needs input.
- **Maximizable master-detail exposures view** in the diagram UI.
- **Loading states** across the dataflow editor and model browser.
- **embeddinggemma** as the default MITRE-framework embedding model, with the
  generated corpus committed so it no longer regenerates on every build.

### Changed

- **Issue-management surface** (the `/issues` list and editor) substantially reworked
  for correctness, performance, UX, and accessibility: a summary/detail split with
  lazy-loaded detail, severity surfaced on collapsed rows, decoupled search and
  filter inputs, legible loading/empty/error states, a confirmed-and-explained merge
  flow, accessible selection and filter menus, and coalesced auto-save with a
  save-state indicator.
- **Faster module boot** — unchanged modules are no longer re-installed on startup;
  installation is skipped via a module content hash.
- **Module bundles share the host JSONForms engine** (via `__HOST_DEPENDENCIES__`)
  instead of bundling their own copy.
- **Module packaging** copies external `.graphql` schema fragments into the bundle.

### Fixed

- **dethereal control pipeline**: wrong-kind bindings, push diagnostics, subagent
  relay, and consent handling.
- **dethereal enrichment quality**: data-item handling, multi-class Controls, rank
  scoring, and general hardening.
- **mitre-frameworks** ships committed framework data instead of regenerating it on
  every build.
- **dt-ui** generates UUIDs without requiring a secure (HTTPS) context.
- **dt-module** keeps analysis runs alive across a stream disconnect.

### Security

- **Dependency maintenance and residual-CVE remediation.** A maintenance sweep plus a
  follow-up pass raised `pnpm.overrides` floors and eliminated vulnerable transitive
  versions across `hono`, `@hono/node-server`, `multer`, `dompurify`, `protobufjs`,
  `@grpc/grpc-js`, `ws`, `esbuild`, `form-data`, `@babel/core`, `undici` (by bumping
  its sole consumer `testcontainers` from 10 to 12), and `js-yaml` (a scoped override
  that drops the legacy 3.x copy pulled by coverage tooling). Every advisory was
  closed by a genuine version fix.

## [0.3.0] - 2026-06-08

A feature release centred on residual-risk reporting, the finding disposition
lifecycle, and a substantially expanded default module. Releases 0.1.1 through
0.2.1 were published as GitHub releases without changelog entries; this entry
resumes the changelog and compares against the previous tag, `v0.2.1`.

### Added

- **Threat Report module** — query-based residual-risk and disposition reporting:
  graded MITRE coverage matrix, flow-route reachability analysis, crown-jewel
  tile with killer-route cross-references, per-component profiles, posture
  summary, a structural boundary-crossing ledger with a faithful minimap,
  snapshot lifecycle with staleness detection, and JSON/HTML export.
- **coverage-tools module** — graded, element-scoped MITRE coverage primitive
  consumed by the Threat Report.
- **Finding disposition lifecycle** — pending / confirmed / disposed states with
  lifecycle badges, one-click affirm, and an affirm-edit dialog. The new
  **AFFIRMED** disposition keeps a finding live across the ledger, coverage
  metrics, and exports.
- **MITRE technique picker** for assigning ATT&CK techniques to findings.
- **MITRE verb edges** — countermeasure→technique verb relationships surfaced in
  GraphQL with allowlisted edge provenance and append-only justification
  durability.
- **Asset-context sync** — user-asserted threat-model context (crown jewels,
  data-item sensitivity and regulatory flags, compliance drivers) promoted to
  first-class platform fields and surfaced in the diagram editor and model dialog.
- **Data-item lifecycle association** — data items can be associated across the
  full element lifecycle.
- **Atomic class-change mutation** and a redesigned class-picker family backed by
  a `listClasses` query.
- **Cascade-delete orphan prevention** — atomic `deleteModel`, lifecycle hooks,
  and an admin orphan sweep.
- **dethernety-general** default module expanded to 75 component classes,
  including container and operating-system-host boundaries and file-based issue
  classes (replaces the former dethernety-module as the default).

### Changed

- `Exposure.score` and `Countermeasure.score` widened to `Float`.
- MITRE search aligned to the Memgraph tier with an updated default embedding
  model.

### Fixed

- `createAnalysis` null-return and Memgraph constraint fallback.
- `elementsWithExtendedInfo` model resolution bounded to prevent a Memgraph
  timeout on large models.
- Numerous dt-ui disposition and exposure UX corrections, including readable
  control-dialog theming, terse pending badges that fit the tab rail, and a
  dirty-guard on the control editor.

## [0.2.1] - 2026-04-22

Two-commit follow-up to v0.2.0. One architectural simplification in Dethereal's
enrichment flow, one TypeScript strict-mode cleanup. No breaking changes.

### Dethereal

- **MITRE tactic coverage now platform-derived.** `/dethereal:surface` now
  aggregates `Exposure.exploitedBy` across analysed elements instead of reading a
  hand-maintained `mitre_attack_techniques` field on component attributes. The
  security-enricher agent's 3-step MITRE anti-hallucination protocol
  (`search_mitre_attack` → validate → persist) is removed — the platform graph is
  now the single source of truth for technique mappings. Module policies already
  declare `exploited_by: [T...]` on every exposure; removing the duplicate
  client-side list eliminates a two-source-of-truth drift risk. Escape hatch for
  uncovered techniques is a module policy addition, not a hand annotation. (#106)
- **TypeScript strict-mode fixes in three tools.** `generate-attribute-stubs`,
  `manage-controls`, and `validate-model` now pass `noUncheckedIndexedAccess`
  cleanly — replaces ad-hoc structural parameter types with dt-core types,
  narrows `apolloClient` once at the action-dispatch site, and adds a JWT
  payload-segment guard. No behaviour change. (#109)

## [0.2.0] - 2026-04-20

This release introduces **Dethereal**, a Claude Code plugin that brings
AI-assisted threat modeling and DevSecOps shift-left into the developer's editor,
plus a per-Control library with crash-safe write-ahead logging and
shared-ownership safety. It also lands the **file-based v2 module architecture**,
**pre-computed class embeddings** for offline install, a CVSS v3.1-aligned
**`AttackVector`** field on Exposures, and a **chunked archive upload** transport
for multi-megabyte module imports.

### Dethereal Plugin (new)

A Claude Code plugin for AI-assisted threat modeling against the Dethernety
platform.

- **14 slash commands**, **4 specialized AI agents**, **22 MCP tools**,
  **11-step guided workflow** (#65, #97)
- **Class matching, control gap analysis, embedding pipeline** (#84)
- **Multi-module selection** in the classification workflow (#82)
- **Control integration** — classification, coverage analysis, two-tier
  reporting (#88)
- Full user docs: getting started, guided workflow, glossary, command reference,
  sync & version control, model concepts, agents & architecture

### Control Library (new)

Per-Control file mirror (`controls/<id>.json`) with platform sync, crash-safe
greenfield ID rebinding, and append-only audit log (#104).

- **Two-Write Rule** — every Control change writes to both the per-Control file
  and the platform; the audit log captures every decision
- **WAL-protected ID rebinding** — atomic rename of `greenfield-*` → server UUID
  survives mid-write crashes
- **Shared-ownership safety prompts** on push when a Control is referenced by
  multiple model elements
- **Recovery verbs**: `repair-wal`, `promote-external-edit`, `tombstone`,
  `merge-from-file`
- **Path-traversal hardening** — `validatePathConfinement`, `assertSafeRelPath`,
  `assertSafeControlId` defence-in-depth at every boundary
- **Coarse model-dir lock** with PID-aware stale-lock recovery serialises
  concurrent `manage_controls` invocations

### Modules — File-Based v2 Architecture

- **File-based v2 modules** — module manifest, classes, exposures, countermeasures
  live as files; loader unifies install paths (#85, #91)
- **Module custom resolvers** — DTModules can register GraphQL resolver functions;
  module workspace receives structured interrupts (#67, #61)
- **Module schema extensions, SSE auth, analysis flow navigation** (#58)
- **Pre-computed class embeddings** ship with the catalog for offline install —
  no embed-on-install latency (#97)
- **`AttackVector` on Exposure** (CVSS v3.1-aligned: `network` / `adjacent` /
  `local` / `physical`); backfilled across the dethernety-module catalog
  (#89, #90)

### Platform — Chunked Archive Upload

- **Chunked archive upload backend** on the GraphQL API — `UploadSessionManager`
  (in-memory per-user session, 5-min TTL, sweeper) + reusable `importFromTarball`
  helper enables multi-megabyte module imports without raising the platform
  body-parser limit. Includes a `module-manager.sh export` subcommand to produce
  importable tarballs, plus `value_type` backfill on 32 guide entries (#99)

### Demo & Build

- Demo: clean up straggler containers and surface real MITRE ingest build
  errors (#98)

### Security & Dependencies

- Resolve `@apollo/federation-internals` prototype pollution (#80)
- Resolve remaining transitive dependency vulnerabilities (#75, #77, #78)
- Tighten `ajv` overrides; bump 33 dependencies (#74)
- Bump `hono` override to ≥4.12.7 (prototype pollution fix) (#55)
- Remove dead `apollo-server-express` (#75)
- `noauth` gate in module resolver wrapper; pass `configurable` to LangGraph (#72)
- Routine dependency sync — 2026-04-16 (#101)
- Bump safe minor/patch dependencies (#79)

## [0.1.3] - 2026-03-13

### Security

- Resolve 6 transitive dependency vulnerabilities via `pnpm.overrides`:
  - **serialize-javascript** (HIGH: RCE) — eliminated by upgrading webpack to
    >=5.105.4
  - **express-rate-limit** (HIGH: IPv4-mapped IPv6 rate-limit bypass) — bumped to
    >=8.2.2
  - **hono** (MEDIUM: prototype pollution) — bumped to >=4.12.7
  - **dompurify** (MEDIUM: XSS) — bumped to >=3.3.2
  - **file-type** (MEDIUM: infinite loop in ASF parser) — bumped to >=21.3.1
  - **ajv** (MEDIUM: ReDoS) — bumped to >=6.14.0

### Improvements

- Bump TypeScript target from ES2021 to ES2023 across all packages (dt-ws,
  dt-core, dt-module, dethernety-module)
- Add `{ cause: error }` to all catch-rethrow sites in dt-ws services for proper
  error cause chaining
- Re-enable ESLint 10 `preserve-caught-error` rule in dt-ws

### Dependencies

- Bump `vue-tsc` to 3.2.5
- Bump `@eslint/js` from 9.39.2 to 10.0.1
- Bump `@types/node` from 22.19.0 to 25.5.0

## [0.1.2] - 2026-03-13

### Apollo Client 4 Migration

- Upgrade `@apollo/client` from v3 to v4 across dt-ui, dt-core (22 data access
  classes), and dethereal
- Replace `onError` with `ErrorLink` class and `CombinedGraphQLErrors.is()`
  pattern
- Remove `NormalizedCacheObject` generic parameter (no longer needed in v4)
- Replace `@vue/apollo-composable` with minimal local shim (`apolloComposable.ts`)

### Remove Deprecated Plugins

- Remove `unplugin-vue-router`, `vite-plugin-pages`, `vite-plugin-vue-layouts`,
  `@types/vue`
- Replace with explicit route definitions in `router/index.ts` using
  `DefaultLayout` wrapper
- Update `unplugin-auto-import` to use `vue-router` instead of `vue-router/auto`

### UI Polish

- Add pointer cursor to clickable model name overlay on dataflow canvas
- Add pointer cursor to app bar logo/title

### Breaking Changes

- `dt-core` data access classes now accept `Apollo.ApolloClient` instead of
  `ApolloClient<NormalizedCacheObject>`

## [0.1.1] - 2026-03-04

### Added

- **Auth-less mode** — run Dethernety without an OIDC provider for local
  evaluation and demos
- **Demo environment** — one-command `demo.sh` script with Docker Compose
  (Memgraph + OPA + Dethernety)
- **Module manager CLI** — install, list, and remove modules from the command
  line
- **ZIP-based export/import** — export and import complete threat models as ZIP
  archives
- **Testing foundation** — test setup and initial test suites for dt-ui, dt-ws,
  and dethereal

### Fixed

- Exposure dialog compatibility with Neo4j GraphQL v7
- Model export/import round-trip bugs
- Analysis button now hidden when no analysis classes are available

### Changed

- Upgraded OPA SDK
- Removed automated Claude security review workflow
- Updated CLAUDE.md with corrected documentation references

## [0.1.0] - 2026-02-27

### Added

- **dt-ui**: Interactive threat modeling frontend with Vue 3, Vuetify, and Vue Flow
- **dt-ws**: NestJS backend with GraphQL API and graph database integration
- **dethereal**: Supplementary application
- **dt-core**: Shared TypeScript data access layer and core interfaces
- **dt-module**: Base classes and utilities for the extensible module system
- **dethernety-general**: Default threat modeling module with component classes, controls, and exposures
- **mitre-frameworks**: MITRE ATT&CK and D3FEND framework data and ingestion tooling
- **demo**: Docker Compose environment for quick local evaluation
- **Dockerfile.production**: Production-ready container image
- MITRE ATT&CK technique and mitigation mapping
- MITRE D3FEND defensive technique integration
- Drag-and-drop data flow diagram editor
- Security boundary and trust level modeling
- Exposure detection and risk scoring
- Control and countermeasure management
- Module-based extensibility system
- GraphQL API with real-time subscriptions
- OIDC/JWT authentication support

[0.16.0]: https://github.com/dether-net/dethernety-oss/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/dether-net/dethernety-oss/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/dether-net/dethernety-oss/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/dether-net/dethernety-oss/compare/v0.12.1...v0.13.0
[0.12.1]: https://github.com/dether-net/dethernety-oss/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/dether-net/dethernety-oss/compare/v0.11.1...v0.12.0
[0.11.1]: https://github.com/dether-net/dethernety-oss/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/dether-net/dethernety-oss/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/dether-net/dethernety-oss/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/dether-net/dethernety-oss/compare/v0.9.2...v0.10.0
[0.9.2]: https://github.com/dether-net/dethernety-oss/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/dether-net/dethernety-oss/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/dether-net/dethernety-oss/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/dether-net/dethernety-oss/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/dether-net/dethernety-oss/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/dether-net/dethernety-oss/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/dether-net/dethernety-oss/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/dether-net/dethernety-oss/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/dether-net/dethernety-oss/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/dether-net/dethernety-oss/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/dether-net/dethernety-oss/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/dether-net/dethernety-oss/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/dether-net/dethernety-oss/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/dether-net/dethernety-oss/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/dether-net/dethernety-oss/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/dether-net/dethernety-oss/releases/tag/v0.1.0
