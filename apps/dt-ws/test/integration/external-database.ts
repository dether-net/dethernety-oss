// An external, shared test database for the integration suites, in place of a per-suite container: MEMGRAPH_TEST_URI
// names a test Memgraph, NEO4J_TEST_URI a test Neo4j (see @dethernety/dt-module/test-database for the guard and the
// reset). For a machine where containers cannot run. The suites run one at a time against it (jest --runInBand), and
// each resets it when it connects; a suite that needs container operations is skipped (describeContainerOnly).

import neo4j, { Driver } from 'neo4j-driver';
import { externalContainerStandIn, openExternalTestDatabase } from '@dethernety/dt-module/test-database';
import type { StartedTestContainer } from 'testcontainers';

import { serverFailureLogging, type TestEngine } from './test-engine';

export interface ExternalHandle {
  container: StartedTestContainer;
  driver: Driver;
  uri: string;
  stop: () => Promise<void>;
}

export async function connectExternal(engine: TestEngine, uri: string): Promise<ExternalHandle> {
  // A test database runs without auth, so any credentials are accepted; empty ones are what a deployment refuses.
  const driver = await openExternalTestDatabase(engine, uri, (target) =>
    neo4j.driver(target, neo4j.auth.basic('', ''), { logging: serverFailureLogging() }),
  );
  console.log(`[test-db] reset the external test ${engine} at ${uri}; using it`);
  return { container: externalContainerStandIn<StartedTestContainer>(), driver, uri, stop: async () => driver.close() };
}
