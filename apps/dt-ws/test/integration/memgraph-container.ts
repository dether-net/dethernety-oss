// Memgraph testcontainer harness for dt-ws integration tests.
//
// Per-suite ephemeral container, no auth (default Memgraph image),
// TCP-port wait plus a defensive Bolt-handshake retry — `Wait.forListeningPorts()`
// returns when TCP accepts connections, which is a few hundred ms before
// Bolt finishes its handshake.

import { StartedTestContainer, Wait } from 'testcontainers';
import neo4j, { Driver } from 'neo4j-driver';

import { LOOPBACK_HOST, LoopbackContainer } from './loopback-container';

export interface MemgraphHandle {
  container: StartedTestContainer;
  driver: Driver;
  uri: string;
  stop: () => Promise<void>;
}

// MEMGRAPH_TEST_IMAGE runs every suite on another image, e.g. the plain `memgraph/memgraph` tag a
// deployment pins.
const IMAGE = process.env.MEMGRAPH_TEST_IMAGE ?? 'memgraph/memgraph-mage:3.13.2';

export interface StartMemgraphOptions {
  /** Defaults to the MAGE image; pass the plain `memgraph/memgraph` tag a deployment pins to test against it. */
  image?: string;
  /** Extra Memgraph flags, e.g. the snapshot settings a restart test needs. */
  command?: string[];
}
const BOLT_PORT = 7687;

// MEMGRAPH_TEST_URI points the suites at an existing, throwaway Memgraph instead of starting a container:
// for a machine where containers cannot run locally. Every suite wipes the graph between tests, so the
// target must hold nothing worth keeping. Only a plain bolt:// URI is accepted, and the target is printed.
// A suite that needs container operations (its own image or flags, a restart, archive copies) cannot run
// this way and is refused.
const EXTERNAL_URI = process.env.MEMGRAPH_TEST_URI;
const BOLT_URI = /^bolt:\/\/[A-Za-z0-9.-]+:\d{1,5}$/;

async function connectExternal(uri: string, options: StartMemgraphOptions): Promise<MemgraphHandle> {
  if (!BOLT_URI.test(uri)) {
    throw new Error(`MEMGRAPH_TEST_URI must be a bolt://host:port URI, got "${uri}"`);
  }
  if (options.image !== undefined || options.command !== undefined) {
    throw new Error('MEMGRAPH_TEST_URI cannot serve a suite that needs its own image or flags');
  }
  console.log(`[memgraph-container] using the external Memgraph at ${uri} (MEMGRAPH_TEST_URI)`);
  const driver = neo4j.driver(uri, neo4j.auth.basic('', ''));
  await waitForBolt(driver);
  const container = new Proxy({} as StartedTestContainer, {
    get: (_target, property) => {
      throw new Error(`container.${String(property)} is not available with MEMGRAPH_TEST_URI`);
    },
  });
  return { container, driver, uri, stop: async () => driver.close() };
}

export async function startMemgraph(options: StartMemgraphOptions = {}): Promise<MemgraphHandle> {
  if (EXTERNAL_URI) return connectExternal(EXTERNAL_URI, options);
  const container = await new LoopbackContainer(options.image ?? IMAGE)
    .withCommand(options.command ?? [])
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

  const port = container.getMappedPort(BOLT_PORT);
  const uri = `bolt://${LOOPBACK_HOST}:${port}`;

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
        throw new Error('Memgraph Bolt handshake never settled');
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
