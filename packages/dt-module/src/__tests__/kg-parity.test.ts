/**
 * One suite, run twice — the interface's central claim, made executable.
 *
 * The same questions are put to both implementations over the same fixture set, and the answers
 * must match. A consumer sits above `KgClient` and is told nothing about which one it holds, so
 * any difference visible here is one that eventually reaches whoever reads the output.
 *
 * **Read the reporter, not just the exit code.** A green run that collected one parameterisation
 * is not this proof; both labels have to appear.
 *
 * What it does and does not settle. The row mapping is *shared* by the two clients, so field-level
 * drift is prevented by construction rather than caught here — what this exercises is everything
 * they do differently: envelope handling, keyed-map assembly, deduplication, key ordering, the
 * composite key, and chunk merging. And the local half answers from a fixture-backed bolt fake,
 * because this package carries no driver: the statements themselves were verified against a live
 * engine when they were written, and get their graph-backed run where a graph exists.
 */
import { beforeEach } from 'vitest';
import { runKgClientSuite } from '../testing/contract/kg-client.contract';
import { MockContentServer } from '../testing/mock-content-server';
import { ENTITLED_TOKEN, KG_VERSION } from '../testing/fixtures';
import { CloudKgClient } from '../kg/cloud-client';
import { LocalKgClient } from '../kg/local-client';
import { makeFixtureDriver } from './kg-driver-fake';

const mock = new MockContentServer();

beforeEach(() => {
  mock.reset();
});

runKgClientSuite({
  label: 'local graph',
  makeClient: () => new LocalKgClient({ driver: makeFixtureDriver().driver }),
});

runKgClientSuite({
  label: 'remote service',
  token: ENTITLED_TOKEN,
  // A fresh client per test, so no assertion is answered from the previous one's cache.
  makeClient: () =>
    new CloudKgClient({ baseUrl: 'https://mock.local', version: KG_VERSION, fetchImpl: mock.fetch }),
});
