/**
 * Runs the shared contract suite against the in-process mock — no network, no
 * credentials. This file lives under `__tests__/` so it is excluded from the
 * built package; the reusable suite it invokes ships from `./testing`.
 */
import { beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DtRemoteModule } from '../dt-remote-module';
import { MockContentServer } from '../testing/mock-content-server';
import { runContractSuite } from '../testing/contract/suite';
import { MODULE_KEY, PIN } from '../testing/fixtures';

const mock = new MockContentServer();
let cacheDir: string;

beforeEach(() => {
  mock.reset();
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtremote-contract-'));
});

afterEach(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

runContractSuite({
  mock,
  makeClient: (pin?: string, driver?: unknown) =>
    new DtRemoteModule({ moduleKey: MODULE_KEY, pin: pin ?? PIN }, driver ?? {}, undefined, {
      fetchImpl: mock.fetch,
      baseUrl: 'https://mock.local',
      cacheDir,
    }),
});
