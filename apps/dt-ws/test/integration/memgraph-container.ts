// Memgraph testcontainer harness for dt-ws integration tests.
//
// Per-suite ephemeral container, no auth (default Memgraph image),
// TCP-port wait plus a defensive Bolt-handshake retry — `Wait.forListeningPorts()`
// returns when TCP accepts connections, which is a few hundred ms before
// Bolt finishes its handshake.

import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import neo4j, { Driver } from 'neo4j-driver';

export interface MemgraphHandle {
  container: StartedTestContainer;
  driver: Driver;
  uri: string;
  stop: () => Promise<void>;
}

const IMAGE = 'memgraph/memgraph-mage:3.8.1';
const BOLT_PORT = 7687;

export async function startMemgraph(): Promise<MemgraphHandle> {
  const container = await new GenericContainer(IMAGE)
    .withExposedPorts(BOLT_PORT)
    .withWaitStrategy(Wait.forListeningPorts())
    .withStartupTimeout(60_000)
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
