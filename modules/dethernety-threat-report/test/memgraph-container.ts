// Test-database harness for this module's ledger e2e: Memgraph, or Neo4j 5.26 with DT_TEST_ENGINE=neo4j (see below).
//
// Deliberately a local copy of dt-ws's `test/integration/memgraph-container.ts` rather than
// an import: a published module must not take a test-time dependency on an app's internals,
// and the two runners differ (vitest here, jest there). The file is runner-agnostic — testcontainers, the driver
// and dt-module's test-database guard — so the copy carries no framework coupling.
//
// Memgraph: per-suite ephemeral container, no auth (default Memgraph image),
// TCP-port wait plus a defensive Bolt-handshake retry — `Wait.forListeningPorts()`
// returns when TCP accepts connections, which is a few hundred ms before
// Bolt finishes its handshake.

import { randomBytes } from 'node:crypto';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import neo4j, { type Config, Driver } from 'neo4j-driver';
import { externalContainerStandIn, externalTestUri, openExternalTestDatabase } from '@dethernety/dt-module/test-database';

export interface MemgraphHandle {
  container: StartedTestContainer;
  driver: Driver;
  uri: string;
  stop: () => Promise<void>;
}

const IMAGE = 'memgraph/memgraph-mage:3.13.2';
const BOLT_PORT = 7687;

// DT_TEST_ENGINE=neo4j runs the suites on Neo4j 5.26 Community instead of Memgraph (the default); anything else is
// refused, so a typo never silently runs Memgraph. startMemgraph() then returns the same handle on Neo4j. Its default
// database is named `memgraph`, the platform's default name, so a suite that opens it runs unchanged; it gets a fresh
// random password, since the published port is not bound to loopback; and the driver writes every FAILURE the server
// answers to stderr, code included, for the Neo4j leg's log gate, even when the code under test swallows the error.
export const TEST_ENGINE = readTestEngine(process.env.DT_TEST_ENGINE);
const NEO4J_REF = 'neo4j:5.26-community';

function readTestEngine(value: string | undefined): 'memgraph' | 'neo4j' {
  if (value === undefined || value === '' || value === 'memgraph') return 'memgraph';
  if (value === 'neo4j') return 'neo4j';
  throw new Error(`DT_TEST_ENGINE must be memgraph or neo4j, got "${value}"`);
}

const failureLogging: NonNullable<Config['logging']> = {
  level: 'debug',
  logger: (_level, message) => {
    if (message.includes('S: FAILURE')) process.stderr.write(`[test-db server failure] ${message}\n`);
  },
};

// MEMGRAPH_TEST_URI / NEO4J_TEST_URI name an external test database instead of a container, for a machine where
// containers cannot run: @dethernety/dt-module/test-database checks that it is one and resets it, and the suites run
// one file at a time (vitest --no-file-parallelism). Its driver writes every server FAILURE to stderr too.
async function connectExternal(engine: 'memgraph' | 'neo4j', uri: string): Promise<MemgraphHandle> {
  const driver = await openExternalTestDatabase(engine, uri, (target) =>
    neo4j.driver(target, neo4j.auth.basic('', ''), { logging: failureLogging }),
  );
  console.log(`[test-db] using the external test ${engine} at ${uri}, reset`);
  return { container: externalContainerStandIn<StartedTestContainer>(), driver, uri, stop: async () => driver.close() };
}

async function startNeo4j(): Promise<MemgraphHandle> {
  const password = randomBytes(16).toString('hex');
  const container = await new GenericContainer(NEO4J_REF)
    .withExposedPorts(BOLT_PORT)
    .withEnvironment({
      NEO4J_AUTH: `neo4j/${password}`,
      NEO4J_initial_dbms_default__database: 'memgraph',
      NEO4J_server_memory_heap_max__size: '512m',
      NEO4J_server_memory_pagecache_size: '256m',
    })
    // Bolt accepts TCP well before the DBMS is available, so wait for its own "Started." line.
    .withWaitStrategy(Wait.forLogMessage(/Started\./))
    .withStartupTimeout(180_000)
    .start();

  const uri = `bolt://${container.getHost()}:${container.getMappedPort(BOLT_PORT)}`;
  const driver = neo4j.driver(uri, neo4j.auth.basic('neo4j', password), { logging: failureLogging });
  await waitForBolt(driver, 60, 500);

  return {
    container,
    driver,
    uri,
    stop: async () => {
      await driver.close();
      await container.stop();
    },
  };
}

export async function startMemgraph(): Promise<MemgraphHandle> {
  const external = externalTestUri(TEST_ENGINE);
  if (external) return connectExternal(TEST_ENGINE, external);
  if (TEST_ENGINE === 'neo4j') return startNeo4j();
  const container = await new GenericContainer(IMAGE)
    .withExposedPorts(BOLT_PORT)
    .withWaitStrategy(Wait.forListeningPorts())
    // 180s, not 60s. The container itself is ready in well under a second --
    // measured at 0.2-0.4s even with eight starting at once. This budget is
    // wall-clock, so what exhausts it is the Node process being starved when
    // the whole repo's test tasks run in parallel, not the database being slow.
    // A 60s ceiling turned that starvation into a hard failure; a larger one
    // costs nothing on the happy path, which still returns immediately.
    .withStartupTimeout(180_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(BOLT_PORT);
  const uri = `bolt://${host}:${port}`;

  const driver = neo4j.driver(uri, neo4j.auth.basic('', ''));
  await waitForBolt(driver);

  return {
    container,
    driver,
    uri,
    stop: async () => {
      await driver.close();
      await container.stop();
    },
  };
}

// Wait.forListeningPorts() returns when TCP accepts connections, which is
// a few hundred ms before Bolt finishes its handshake. Without this retry,
// the first session.run() in a test occasionally throws ServiceUnavailable.
async function waitForBolt(driver: Driver, attempts = 20, delayMs = 250): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const session = driver.session();
      try {
        await session.run('RETURN 1 AS ok');
        return;
      } finally {
        await session.close();
      }
    } catch {
      if (i === attempts - 1) {
        throw new Error('Bolt handshake never settled');
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export async function clearGraph(driver: Driver): Promise<void> {
  const session = driver.session();
  try {
    await session.run('MATCH (n) DETACH DELETE n');
  } finally {
    await session.close();
  }
}
