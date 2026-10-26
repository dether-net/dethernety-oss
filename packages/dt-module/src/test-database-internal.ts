/**
 * The guard and the reset behind `@dethernety/dt-module/test-database` (see test-database.ts). Not a subpath of its
 * own: the reset is reachable only through openExternalTestDatabase, after the URI, the worker and the server have
 * been checked. Imports nothing.
 */

export type TestEngine = 'memgraph' | 'neo4j';

/** The server name a test Memgraph is started with (`--bolt-server-name-for-init`). */
export const TEST_MEMGRAPH_SERVER_NAME = 'dt-test-memgraph';
/** The database the suites use on either engine; a test Neo4j is started with it as its default. */
export const TEST_DATABASE = 'memgraph';
/** The port a deployment's database listens on; never a test target. */
export const DEPLOYMENT_BOLT_PORT = 7687;

export const URI_VARIABLE: Record<TestEngine, string> = { memgraph: 'MEMGRAPH_TEST_URI', neo4j: 'NEO4J_TEST_URI' };
const BOLT_URI = /^bolt:\/\/[A-Za-z0-9.-]+:([1-9]\d{0,4})$/;

/** The parts of a neo4j-driver Driver used here, so this package needs no driver dependency. */
export interface TestRecord {
  get(key: string): unknown;
  keys?: ReadonlyArray<PropertyKey>;
}
export interface TestSession {
  run(cypher: string, params?: Record<string, unknown>): PromiseLike<{ records: ReadonlyArray<TestRecord> }>;
  close(): PromiseLike<void>;
}
export interface TestDriver {
  session(config?: { database?: string }): TestSession;
  getServerInfo(): PromiseLike<{ agent?: string }>;
  close(): PromiseLike<void>;
}

export type Env = Record<string, string | undefined>;

/**
 * The external target for `engine`, or undefined when the run names none (the harness then starts a container). A
 * run that names a target for the other engine only is refused: it is meant to start no container.
 */
export function externalTestUri(engine: TestEngine, env: Env = process.env): string | undefined {
  const own = env[URI_VARIABLE[engine]];
  if (own) return own;
  const other: TestEngine = engine === 'memgraph' ? 'neo4j' : 'memgraph';
  if (env[URI_VARIABLE[other]]) {
    throw new Error(
      `${URI_VARIABLE[other]} is set but ${URI_VARIABLE[engine]} is not: an external run names a database for every ` +
        `engine it uses and starts no container (unset ${URI_VARIABLE[other]} to start containers)`,
    );
  }
  return undefined;
}

/** Whether a run is external at all (it then starts no container). */
export function isExternalTestRun(env: Env = process.env): boolean {
  return Boolean(env.MEMGRAPH_TEST_URI || env.NEO4J_TEST_URI);
}

/**
 * A URI as it may be printed: anything that could carry credentials is masked, from the first `//` to the last `@`
 * after it (user info) and from the first `?` to the end (a query). A value with a line break is no URI and is printed
 * as `***`. Index slicing rather than a regex: the URI comes from the environment, and a pattern like `//.*@`
 * backtracks in polynomial time on a long run of `//`.
 */
function printable(uri: string): string {
  if (/[\n\r\u2028\u2029]/.test(uri)) return '***';
  let masked = uri;
  const slashes = masked.indexOf('//');
  const userInfoEnd = masked.lastIndexOf('@');
  if (slashes !== -1 && userInfoEnd >= slashes + 2) {
    masked = `${masked.slice(0, slashes)}//***@${masked.slice(userInfoEnd + 1)}`;
  }
  const query = masked.indexOf('?');
  return query === -1 ? masked : `${masked.slice(0, query)}?***`;
}

/** Throws unless `uri` is a plain bolt URI, not on the deployment port, and listed in DT_TEST_EXTERNAL_WIPE. */
export function checkExternalTestUri(uri: string, env: Env = process.env): void {
  const match = BOLT_URI.exec(uri);
  const port = match ? Number(match[1]) : NaN;
  if (!match || port > 65535) {
    throw new Error(`an external test database must be a bolt://host:port URI, got "${printable(uri)}"`);
  }
  if (port === DEPLOYMENT_BOLT_PORT) {
    throw new Error(`refusing ${uri}: port ${DEPLOYMENT_BOLT_PORT} is a deployment's database port, never a test target`);
  }
  const allowed = (env.DT_TEST_EXTERNAL_WIPE ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!allowed.includes(uri)) {
    throw new Error(`refusing ${uri}: the suites wipe it, so it must be listed in DT_TEST_EXTERNAL_WIPE`);
  }
}

/**
 * Throws when this process is one of several test workers of one run: they would wipe each other's shared database.
 * Two runs at once (two packages against the same database) are not detected; run one package at a time.
 */
export function checkSingleTestWorker(env: Env = process.env): void {
  for (const variable of ['JEST_WORKER_ID', 'VITEST_POOL_ID']) {
    const id = env[variable];
    if (id !== undefined && id !== '1') {
      throw new Error(
        `refusing a shared test database in test worker ${variable}=${id}: run the suites one at a time ` +
          `(jest --runInBand, vitest --no-file-parallelism)`,
      );
    }
  }
}

/** Every statement runs in its own auto-commit transaction: schema commands cannot share one with each other or with writes. */
async function query(driver: TestDriver, cypher: string, database = TEST_DATABASE): Promise<ReadonlyArray<TestRecord>> {
  const session = driver.session({ database });
  try {
    return (await session.run(cypher)).records;
  } finally {
    await session.close();
  }
}

/**
 * Throws unless the server identifies itself as a test database of `engine`. On Memgraph that is a name the server
 * was started with for this purpose. On Neo4j it is weaker: a default database named `memgraph`, together with the
 * login an empty user name passes (no auth). That second half holds because every harness connects with empty
 * credentials; a caller that passes real ones is left with the default-database check alone.
 */
export async function assertTestTarget(driver: TestDriver, engine: TestEngine): Promise<void> {
  if (engine === 'memgraph') {
    const { agent } = await driver.getServerInfo();
    if (agent !== TEST_MEMGRAPH_SERVER_NAME) {
      throw new Error(
        `refusing the target: it reports the server name ${JSON.stringify(agent)}, not "${TEST_MEMGRAPH_SERVER_NAME}" ` +
          `(start the test Memgraph with --bolt-server-name-for-init=${TEST_MEMGRAPH_SERVER_NAME})`,
      );
    }
    return;
  }
  let names: unknown[];
  try {
    names = (await query(driver, 'SHOW DEFAULT DATABASE YIELD name', 'system')).map((record) => record.get('name'));
  } catch (error) {
    throw new Error(`refusing the target: its default database could not be read (${(error as Error).message})`, {
      cause: error,
    });
  }
  if (names.length !== 1 || names[0] !== TEST_DATABASE) {
    throw new Error(
      `refusing the target: its default database is ${JSON.stringify(names)}, not "${TEST_DATABASE}" ` +
        `(start the test Neo4j with NEO4J_initial_dbms_default__database=${TEST_DATABASE})`,
    );
  }
}

/** The names the suites create: a name outside them is refused before anything is dropped. */
const PLAIN_NAME = /^[A-Za-z0-9_.:-]+$/;

function quote(name: unknown): string {
  const text = String(name);
  if (!PLAIN_NAME.test(text)) throw new Error(`refusing to reset: unexpected name ${JSON.stringify(text)}`);
  return `\`${text}\``;
}

function column(record: TestRecord, key: string): unknown {
  if (record.keys && !record.keys.includes(key)) {
    throw new Error(`unexpected listing: no "${key}" column in ${JSON.stringify(record.keys)}`);
  }
  return record.get(key);
}

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);

/** The DROP statement for one `SHOW INDEX INFO` row of Memgraph. */
export function memgraphDropIndex(record: TestRecord): string {
  const kind = column(record, 'index type');
  const label = quote(column(record, 'label'));
  switch (kind) {
    case 'label':
      return `DROP INDEX ON :${label}`;
    case 'label+property':
      return `DROP INDEX ON :${label}(${asList(column(record, 'property')).map(quote).join(', ')})`;
    case 'edge-type':
      return `DROP EDGE INDEX ON :${label}`;
    case 'edge-type+property':
      return `DROP EDGE INDEX ON :${label}(${asList(column(record, 'property')).map(quote).join(', ')})`;
    default:
      throw new Error(`refusing to reset: unexpected index kind ${JSON.stringify(kind)} on ${label}`);
  }
}

/** The DROP statement for one `SHOW CONSTRAINT INFO` row of Memgraph. */
export function memgraphDropConstraint(record: TestRecord): string {
  const kind = column(record, 'constraint type');
  const label = quote(column(record, 'label'));
  const properties = asList(column(record, 'properties')).map((p) => `n.${quote(p)}`);
  switch (kind) {
    case 'unique':
      return `DROP CONSTRAINT ON (n:${label}) ASSERT ${properties.join(', ')} IS UNIQUE`;
    case 'exists':
      return `DROP CONSTRAINT ON (n:${label}) ASSERT EXISTS (${properties.join(', ')})`;
    default:
      throw new Error(`refusing to reset: unexpected constraint kind ${JSON.stringify(kind)} on ${label}`);
  }
}

/** The constraint and index types the suites create on Neo4j (5.x names both spellings of uniqueness). */
const NEO4J_CONSTRAINT_TYPES = new Set(['UNIQUENESS', 'NODE_PROPERTY_UNIQUENESS']);
const NEO4J_INDEX_TYPES = new Set(['RANGE']);

export const MEMGRAPH_VECTOR_INDEXES = 'CALL vector_search.show_index_info() YIELD index_name RETURN index_name';
export const NEO4J_CONSTRAINTS = 'SHOW CONSTRAINTS YIELD name, type';
export const NEO4J_INDEXES = 'SHOW INDEXES YIELD name, type, owningConstraint';
/** Deletes in batches, so a large graph is never one transaction; repeated until it deletes nothing. */
export const DELETE_BATCH = 'MATCH (n) WITH n LIMIT 10000 DETACH DELETE n RETURN count(*) AS deleted';
const NODE_COUNT = 'MATCH (n) RETURN count(n) AS c';
const toNumber = (value: unknown): number =>
  typeof value === 'object' && value !== null && 'toNumber' in value ? (value as { toNumber(): number }).toNumber() : Number(value);
const counted = (n: number, what: string): string => `${n} ${what}${n === 1 ? '' : 's'}`;

async function deleteAllNodes(driver: TestDriver): Promise<void> {
  for (;;) {
    const [row] = await query(driver, DELETE_BATCH);
    if (!row || toNumber(row.get('deleted')) === 0) return;
  }
}

async function nodeCount(driver: TestDriver): Promise<number> {
  const [row] = await query(driver, NODE_COUNT);
  return toNumber(row?.get('c'));
}

async function memgraphLeftovers(driver: TestDriver): Promise<string[]> {
  const left: string[] = [];
  const triggers = await query(driver, 'SHOW TRIGGERS');
  if (triggers.length) left.push(counted(triggers.length, 'trigger'));
  const vectors = await query(driver, MEMGRAPH_VECTOR_INDEXES);
  if (vectors.length) left.push(`vector indexes ${JSON.stringify(vectors.map((r) => r.get('index_name')))}`);
  const indexes = await query(driver, 'SHOW INDEX INFO');
  if (indexes.length) left.push(counted(indexes.length, 'index'));
  const constraints = await query(driver, 'SHOW CONSTRAINT INFO');
  if (constraints.length) left.push(counted(constraints.length, 'constraint'));
  const nodes = await nodeCount(driver);
  if (nodes !== 0) left.push(counted(nodes, 'node'));
  return left;
}

function isVectorRow(record: TestRecord): boolean {
  const kind = record.keys && !record.keys.includes('index type') ? undefined : record.get('index type');
  return typeof kind === 'string' && kind.includes('vector');
}

async function resetMemgraph(driver: TestDriver): Promise<void> {
  if ((await query(driver, 'SHOW TRIGGERS')).length) throw new Error('refusing to reset: the target has triggers');
  const vectorNames = (await query(driver, MEMGRAPH_VECTOR_INDEXES)).map((record) => record.get('index_name'));
  // A vector index may also be listed by SHOW INDEX INFO, under its own kind; it goes with DROP VECTOR INDEX.
  const indexRows = (await query(driver, 'SHOW INDEX INFO')).filter((record) => !isVectorRow(record));
  const drops = [
    ...vectorNames.map((name) => `DROP VECTOR INDEX ${quote(name)}`),
    ...indexRows.map(memgraphDropIndex),
    ...(await query(driver, 'SHOW CONSTRAINT INFO')).map(memgraphDropConstraint),
  ];
  for (const statement of drops) await query(driver, statement);
  await deleteAllNodes(driver);
  const left = await memgraphLeftovers(driver);
  if (left.length) throw new Error(`the reset left ${left.join(', ')}`);
}

async function resetNeo4j(driver: TestDriver): Promise<void> {
  const constraints = await query(driver, NEO4J_CONSTRAINTS);
  const indexes = await query(driver, NEO4J_INDEXES);
  for (const record of constraints) {
    if (!NEO4J_CONSTRAINT_TYPES.has(String(column(record, 'type')))) {
      throw new Error(`refusing to reset: unexpected constraint type ${JSON.stringify(record.get('type'))}`);
    }
  }
  // A token lookup index is part of a fresh database and stays; an index a constraint owns goes with the constraint.
  const ownIndexes = indexes.filter((r) => column(r, 'type') !== 'LOOKUP' && column(r, 'owningConstraint') == null);
  for (const record of ownIndexes) {
    if (!NEO4J_INDEX_TYPES.has(String(record.get('type')))) {
      throw new Error(`refusing to reset: unexpected index type ${JSON.stringify(record.get('type'))}`);
    }
  }
  const drops = [
    ...constraints.map((r) => `DROP CONSTRAINT ${quote(r.get('name'))}`),
    ...ownIndexes.map((r) => `DROP INDEX ${quote(r.get('name'))}`),
  ];
  for (const statement of drops) await query(driver, statement);
  await deleteAllNodes(driver);
  const left: string[] = [];
  const constraintsLeft = await query(driver, NEO4J_CONSTRAINTS);
  if (constraintsLeft.length) left.push(counted(constraintsLeft.length, 'constraint'));
  const indexesLeft = await query(driver, NEO4J_INDEXES);
  const lookups = indexesLeft.filter((r) => r.get('type') === 'LOOKUP').length;
  if (indexesLeft.length !== lookups) left.push(counted(indexesLeft.length - lookups, 'index'));
  if (lookups !== 2) left.push(`${counted(lookups, 'token lookup index')}, where a fresh database has 2`);
  const nodes = await nodeCount(driver);
  if (nodes !== 0) left.push(counted(nodes, 'node'));
  if (left.length) throw new Error(`the reset left ${left.join(', ')}`);
}

/**
 * Puts a confirmed test database in the state a fresh container has: no node, index or constraint (on Neo4j, the two
 * token lookup indexes every database has stay). The server is identified first, and every kind is listed and checked
 * before the first drop, so a target that is not a test database, or holds anything the suites never create, is
 * refused untouched.
 */
export async function resetTestDatabase(driver: TestDriver, engine: TestEngine): Promise<void> {
  await assertTestTarget(driver, engine);
  await (engine === 'memgraph' ? resetMemgraph(driver) : resetNeo4j(driver));
}

const isAuthError = (error: unknown): boolean => {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && /^(Neo|Memgraph)\.ClientError\.Security\./.test(code);
};

async function waitForDatabase(driver: TestDriver, attempts: number, delayMs: number): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await query(driver, 'RETURN 1 AS ok');
      return;
    } catch (error) {
      // A refused login is not a database still starting: a test database takes any credentials.
      if (isAuthError(error)) {
        throw new Error(`refusing the target: it refused the login (${(error as Error).message})`, { cause: error });
      }
      // Nor is a missing database: a test Neo4j is started with it as its default.
      if ((error as { code?: unknown })?.code === 'Neo.ClientError.Database.DatabaseNotFound') {
        throw new Error(`refusing the target: it has no database "${TEST_DATABASE}"`, { cause: error });
      }
      if (i >= attempts - 1) {
        throw new Error(`the external test database never answered (${(error as Error).message})`, { cause: error });
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/** See test-database.ts. */
export async function openExternalTestDatabase<D extends TestDriver>(
  engine: TestEngine,
  uri: string,
  makeDriver: (uri: string) => D,
  options: { env?: Env; attempts?: number; delayMs?: number } = {},
): Promise<D> {
  const named = (error: unknown): Error =>
    new Error(`${URI_VARIABLE[engine]}: ${(error as Error).message}`, { cause: error });
  const env = options.env ?? process.env;
  try {
    checkExternalTestUri(uri, env);
    checkSingleTestWorker(env);
  } catch (error) {
    throw named(error);
  }
  const driver = makeDriver(uri);
  try {
    await waitForDatabase(driver, options.attempts ?? 60, options.delayMs ?? 500);
    await resetTestDatabase(driver, engine);
    return driver;
  } catch (error) {
    await driver.close();
    throw named(error);
  }
}

/** What printing a value inspects (JSON, console, a test runner's diff); the stand-in answers as a plain object. */
const PRINTING_PROBES = new Set(['then', 'toJSON', 'constructor', '$$typeof', 'nodeType', 'asymmetricMatch', 'inspect']);

/** See test-database.ts. */
export function externalContainerStandIn<T extends object>(): T {
  return new Proxy({} as T, {
    get: (_target, property) => {
      if (typeof property === 'symbol' || PRINTING_PROBES.has(property)) return undefined;
      throw new Error(`container.${String(property)} is not available against an external test database`);
    },
  });
}
