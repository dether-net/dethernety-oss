/**
 * Runs the knowledge-graph contract suite against the in-process mock — no network, no
 * credentials. This file lives under `__tests__/` so it is excluded from the built package; the
 * reusable suite it invokes ships from `./testing`.
 *
 * The suite is a separate function from the module-content one because it is parameterized
 * differently: that suite drives a client, this one drives a transport, since the knowledge-graph
 * client implementations do not exist yet.
 */
import { beforeEach } from 'vitest';
import { MockContentServer } from '../testing/mock-content-server';
import { runKgContractSuite } from '../testing/contract/kg.contract';

const mock = new MockContentServer();

beforeEach(() => {
  mock.reset();
});

runKgContractSuite({ mock, fetch: mock.fetch });
