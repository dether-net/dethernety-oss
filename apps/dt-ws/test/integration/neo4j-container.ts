// Neo4j 5 testcontainer harness for dt-ws integration tests.
//
// Community edition (the default `neo4j:5` image), auth disabled via
// NEO4J_AUTH=none (avoids the image's 8-character-minimum password rule).
// Unlike the Memgraph harness, the wait strategy is the "Started." log line
// with a generous timeout — Neo4j's JVM cold start plus first-boot
// provisioning takes tens of seconds, and Bolt accepts TCP well before the
// DBMS is available — plus a defensive Bolt-handshake retry.

import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import neo4j, { Driver } from 'neo4j-driver';

export interface Neo4jHandle {
  container: StartedTestContainer;
  driver: Driver;
  uri: string;
  stop: () => Promise<void>;
}

const IMAGE = 'neo4j:5';
const BOLT_PORT = 7687;

export async function startNeo4j(): Promise<Neo4jHandle> {
  const container = await new GenericContainer(IMAGE)
    .withExposedPorts(BOLT_PORT)
    .withEnvironment({ NEO4J_AUTH: 'none' })
    .withWaitStrategy(Wait.forLogMessage(/Started\./))
    .withStartupTimeout(120_000)
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

async function waitForBolt(driver: Driver, attempts = 60, delayMs = 500): Promise<void> {
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
        throw new Error('Neo4j Bolt handshake never settled');
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
