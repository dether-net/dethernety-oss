# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.13.0] - Unreleased

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
`dethernety-threat-report` ships its manifest. **A CDN or reverse proxy in front of dt-ws** must
honour `Cache-Control: private` on `/module-bundles/` and must not cache it by path (see
*Security*). **Dethereal users:** builds before the next Dethereal release send a filter the
platform now refuses, so listing analyses from them fails until you update Dethereal, and they send
one operand per element when they assign a control, so assigning one to some 200 elements or more in
one call is refused too; Dethereal 0.4.17 bundles the fixed dt-core and carries the updated data
layer: dt-core's module queries gain `getFrontendModuleManifest` and lose
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
  checks run on both engines. Neo4j support is unreleased, so no released version is affected by the
  Neo4j failure. **API callers:** a query that used `single` on such a relationship is now refused
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

  **Still open, for 0.5.0:** the `npx` launch can pick up a copy of the package in the project's own
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
