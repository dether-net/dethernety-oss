// Neo4j 5 testcontainer harness for dt-ws integration tests.
//
// Community edition (`neo4j:5.26-community`, the LTS line the platform targets), auth disabled via
// NEO4J_AUTH=none (avoids the image's 8-character-minimum password rule). The default database is named
// `memgraph`, as the suites name it (most open `{ database: 'memgraph' }`, the platform's default name), so a
// suite runs unchanged on either engine. Heap and page cache are capped: suites run in parallel. APOC Core is
// loaded as the deployment loads it (oss/deploy/compose/compose.neo4j.yaml): the plugins directory points at the
// image's own labs/, and the allowlist loads only the two functions the GraphQL layer calls.
// Unlike the Memgraph harness, the wait strategy is the "Started." log line
// with a generous timeout — Neo4j's JVM cold start plus first-boot
// provisioning takes tens of seconds, and Bolt accepts TCP well before the
// DBMS is available — plus a defensive Bolt-handshake retry.

import { StartedTestContainer, Wait } from 'testcontainers';
import neo4j, { Driver } from 'neo4j-driver';

import { externalTestUri } from '@dethernety/dt-module/test-database';

import { connectExternal } from './external-database';
import { LOOPBACK_HOST, LoopbackContainer } from './loopback-container';
import { serverFailureLogging } from './test-engine';

export interface Neo4jHandle {
  container: StartedTestContainer;
  driver: Driver;
  uri: string;
  stop: () => Promise<void>;
}

const IMAGE = 'neo4j:5.26-community';
const BOLT_PORT = 7687;

export async function startNeo4j(): Promise<Neo4jHandle> {
  const external = externalTestUri('neo4j');
  if (external) return connectExternal('neo4j', external);
  const container = await new LoopbackContainer(IMAGE)
    .withExposedPorts(BOLT_PORT)
    .withEnvironment({
      NEO4J_AUTH: 'none',
      NEO4J_initial_dbms_default__database: 'memgraph',
      NEO4J_server_memory_heap_max__size: '512m',
      NEO4J_server_memory_pagecache_size: '256m',
      NEO4J_server_directories_plugins: '/var/lib/neo4j/labs',
      NEO4J_dbms_security_procedures_allowlist: 'apoc.date.convertFormat,apoc.util.validatePredicate',
    })
    .withWaitStrategy(Wait.forLogMessage(/Started\./))
    .withStartupTimeout(120_000)
    .start();

  const port = container.getMappedPort(BOLT_PORT);
  const uri = `bolt://${LOOPBACK_HOST}:${port}`;

  const driver = neo4j.driver(uri, neo4j.auth.basic('', ''), { logging: serverFailureLogging() });
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
