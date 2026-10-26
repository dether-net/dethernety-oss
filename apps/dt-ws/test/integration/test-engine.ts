// The graph engine the integration suites run against: DT_TEST_ENGINE=memgraph (the default) or neo4j.
//
// The suites start their database through startMemgraph() whichever engine it is; on neo4j that starts a Neo4j
// container instead (memgraph-container.ts). A suite or test that exercises Memgraph alone (vector_search, SHOW
// INDEX INFO, its own image or flags) is declared with describeMemgraphOnly / itMemgraphOnly and is skipped on the
// Neo4j leg rather than run against the wrong engine. Against an external test database (external-database.ts), a
// suite that needs its own container is declared with describeContainerOnly, and one that starts Neo4j itself with
// describeWithNeo4j; both are skipped, with the reason printed, when the run cannot serve them.

import type { Config } from 'neo4j-driver';
import { isExternalTestRun } from '@dethernety/dt-module/test-database';

export type TestEngine = 'memgraph' | 'neo4j';

/** Reads a DT_TEST_ENGINE value; anything but memgraph or neo4j is refused, so a typo never silently runs Memgraph. */
export function readTestEngine(value: string | undefined): TestEngine {
  if (value === undefined || value === '' || value === 'memgraph') return 'memgraph';
  if (value === 'neo4j') return 'neo4j';
  throw new Error(`DT_TEST_ENGINE must be memgraph or neo4j, got "${value}"`);
}

export const TEST_ENGINE: TestEngine = readTestEngine(process.env.DT_TEST_ENGINE);

export const describeMemgraphOnly: jest.Describe = TEST_ENGINE === 'neo4j' ? describe.skip : describe;
export const itMemgraphOnly: jest.It = TEST_ENGINE === 'neo4j' ? it.skip : it;
/** For what holds on Neo4j alone (its facts, the APOC functions it loads): skipped on the Memgraph leg. */
export const describeNeo4jOnly: jest.Describe = TEST_ENGINE === 'neo4j' ? describe : describe.skip;
export const itNeo4jOnly: jest.It = TEST_ENGINE === 'neo4j' ? it : it.skip;

/** A suite declaration: these markers take a name and a body only (no .each or .only). */
export type SuiteMarker = (name: string, fn: () => void) => void;

/** A marker that skips its suite and says why, so a skipped suite is visible in the run's log. */
function skippedBecause(reason: string): SuiteMarker {
  return (name, fn) => {
    console.log(`[test-db] skipped "${name}": ${reason}`);
    describe.skip(name, fn);
  };
}

/** Whether this is an external run (MEMGRAPH_TEST_URI / NEO4J_TEST_URI) that names no Neo4j, so nothing may start one. */
export const EXTERNAL_RUN_WITHOUT_NEO4J = isExternalTestRun() && !process.env.NEO4J_TEST_URI;

/** For a suite that starts Neo4j itself, whatever the engine: skipped when an external run names no Neo4j. */
export const describeWithNeo4j: SuiteMarker = EXTERNAL_RUN_WITHOUT_NEO4J
  ? skippedBecause('the external run names no Neo4j (NEO4J_TEST_URI)')
  : describe;

/** For a suite that needs container operations (its own image or flags, a restart): skipped in an external run. */
export const describeContainerOnly: SuiteMarker = isExternalTestRun()
  ? skippedBecause('it needs its own container, and an external run starts none')
  : describe;

/** For a Memgraph-only suite that also needs its own container: skipped on the Neo4j leg and in an external run. */
export const describeMemgraphContainerOnly: SuiteMarker = TEST_ENGINE === 'neo4j' ? describeMemgraphOnly : describeContainerOnly;

/** The marker the Neo4j leg's log gate looks for: a server FAILURE seen by a test driver. */
export const SERVER_FAILURE_MARK = '[test-db server failure]';

/**
 * Driver logging for a test Neo4j: every FAILURE the server answers is written to stderr with its code, marked. The
 * driver logs the server's failure message at debug level before any caller sees the error, so a failure the code
 * under test catches and swallows still reaches the log the Neo4j leg's gate reads.
 */
export function serverFailureLogging(): NonNullable<Config['logging']> {
  return {
    level: 'debug',
    logger: (_level, message) => {
      if (message.includes('S: FAILURE')) process.stderr.write(`${SERVER_FAILURE_MARK} ${message}\n`);
    },
  };
}
