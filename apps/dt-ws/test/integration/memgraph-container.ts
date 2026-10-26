// The test database harness for dt-ws integration tests: Memgraph, or Neo4j when DT_TEST_ENGINE=neo4j.
//
// The name is historical, kept so the suites' imports stay as they are. On the Neo4j leg startMemgraph() starts a
// Neo4j container (neo4j-container.ts) and returns the same handle; whatever only Memgraph has (its own image or
// flags, MEMGRAPH_TEST_IMAGE) is refused there, so a Memgraph-only suite that lacks its describeMemgraphOnly marker
// fails rather than run against the wrong engine. MEMGRAPH_TEST_URI / NEO4J_TEST_URI name an external test database
// instead of a container (external-database.ts).
//
// Memgraph: per-suite ephemeral container, no auth (default Memgraph image),
// TCP-port wait plus a defensive Bolt-handshake retry — `Wait.forListeningPorts()`
// returns when TCP accepts connections, which is a few hundred ms before
// Bolt finishes its handshake.

import { StartedTestContainer, Wait } from 'testcontainers';
import neo4j, { Driver } from 'neo4j-driver';

import { externalTestUri } from '@dethernety/dt-module/test-database';

import { connectExternal } from './external-database';
import { LOOPBACK_HOST, LoopbackContainer } from './loopback-container';
import { startNeo4j } from './neo4j-container';
import { TEST_ENGINE } from './test-engine';

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

/** What an external test database cannot honour, or undefined: a suite that needs its own image or flags. */
export function externalRefusal(options: StartMemgraphOptions, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (options.image !== undefined || options.command !== undefined) {
    return 'a suite that needs its own image or flags runs only in a container: declare it with describeContainerOnly';
  }
  if (env.MEMGRAPH_TEST_IMAGE) return 'MEMGRAPH_TEST_IMAGE names an image; unset it for an external run';
  return undefined;
}

/** What the Neo4j leg cannot honour, or undefined. */
export function neo4jRefusal(options: StartMemgraphOptions, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (options.image !== undefined || options.command !== undefined) {
    return 'a suite that needs its own Memgraph image or flags is Memgraph-only: declare it with describeMemgraphOnly';
  }
  if (env.MEMGRAPH_TEST_IMAGE) return 'MEMGRAPH_TEST_IMAGE names a Memgraph image; unset it for DT_TEST_ENGINE=neo4j';
  return undefined;
}

export async function startMemgraph(options: StartMemgraphOptions = {}): Promise<MemgraphHandle> {
  if (TEST_ENGINE === 'neo4j') {
    const refusal = neo4jRefusal(options);
    if (refusal) throw new Error(`DT_TEST_ENGINE=neo4j: ${refusal}`);
    return startNeo4j();
  }
  const external = externalTestUri('memgraph');
  if (external) {
    const refusal = externalRefusal(options);
    if (refusal) throw new Error(`MEMGRAPH_TEST_URI: ${refusal}`);
    return connectExternal('memgraph', external);
  }
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
