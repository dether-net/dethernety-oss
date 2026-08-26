# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
