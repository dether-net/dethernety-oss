/**
 * `@dethernety/dt-module/test-database` — an external test database for integration suites: a throwaway Memgraph or
 * Neo4j that the suites share instead of each starting its own container, for a machine where containers cannot run.
 * Dev/test only; nothing in the package's main entry imports it, and it imports nothing but its own guard.
 *
 * Every suite wipes the database it is given, so the target is checked before anything runs against it:
 * - The URI must be a plain `bolt://host:port`, must not use port 7687 (the port a deployment's database listens on),
 *   and must be listed exactly in DT_TEST_EXTERNAL_WIPE (comma-separated).
 * - Only one test worker may use it (jest `--runInBand`, vitest `--no-file-parallelism`). Two runs at once, such as
 *   two packages against the same database, are not detected: run one package at a time.
 * - The server must identify itself as a test database. A test Memgraph is started with
 *   `--bolt-server-name-for-init=dt-test-memgraph` and reports that name as its agent. A test Neo4j runs without auth
 *   and with its default database named `memgraph`, where a deployment's is `neo4j`; that is the weaker of the two
 *   checks, and its no-auth half rests on the caller's empty credentials, as every harness passes. Nothing is read
 *   from the graph itself, so the check adds nothing a suite could count.
 * Anything that cannot be confirmed is refused.
 *
 * The target is then reset to what a fresh container holds: no node, index or constraint (on Neo4j, the two token
 * lookup indexes stay). Every kind is listed and checked before the first drop, so a database holding something the
 * suites never create is refused untouched.
 *
 * MEMGRAPH_TEST_URI names the Memgraph, NEO4J_TEST_URI the Neo4j. With neither set, the harness starts its own
 * container.
 */

export { externalContainerStandIn, externalTestUri, isExternalTestRun, openExternalTestDatabase } from './test-database-internal';
export type { TestDriver, TestEngine, TestRecord, TestSession } from './test-database-internal';

/*
 * openExternalTestDatabase(engine, uri, makeDriver): checks the URI and the worker, connects with the driver
 * `makeDriver` builds (the caller chooses auth and logging), waits for the database, confirms it is a test database
 * of `engine` and resets it. On any failure the driver is closed, and the error names the variable (MEMGRAPH_TEST_URI
 * or NEO4J_TEST_URI).
 *
 * externalContainerStandIn(): stands in for a container handle in external mode; any use of it throws, naming what
 * was asked for.
 */
