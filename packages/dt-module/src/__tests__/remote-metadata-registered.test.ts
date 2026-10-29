/**
 * getMetadata once a remote module has registered. The platform health-probes
 * getMetadata against a short timeout, so a registered module answers at once
 * from what it registered, and leaves pinning the portal origin and fetching an
 * uncached pin to a background refresh. A module that has not registered yet
 * waits, as before, and a failed registration is not retried for a minute.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Logger } from '@nestjs/common';
import { DtRemoteModule } from '../dt-remote-module';
import { MockContentServer } from '../testing/mock-content-server';
import { CLASS_ID, MODULE_KEY, PIN, moduleDocument } from '../testing/fixtures';

const BUMPED_PIN = 'sha256:bumped-during-outage';
const mock = new MockContentServer();
let cacheDir: string;

function makeModule(pin = PIN) {
  const warn = vi.fn();
  const logger = { warn, log: vi.fn(), debug: vi.fn(), error: vi.fn(), verbose: vi.fn() } as unknown as Logger;
  const module = new DtRemoteModule({ moduleKey: MODULE_KEY, pin }, {}, logger, {
    fetchImpl: mock.fetch,
    baseUrl: 'https://mock.local',
    cacheDir,
  });
  return { module, warn };
}

/** Whether the promise has settled yet. */
const settled = (promise: Promise<unknown>) => {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true),
  );
  return () => done;
};

/** Let background work started by the last call record its requests. Only Date
 * is faked where this runs. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const metaRequests = () => mock.requests.filter((r) => r.path === '/meta').length;
/** Fetches of the module document at one pin, not its embeddings. */
const documentRequests = (pin: string) =>
  mock.requests.filter((r) => r.path === `/v1/catalog/modules/${MODULE_KEY}/versions/${encodeURIComponent(pin)}`)
    .length;

/** A module configured at BUMPED_PIN that registered offline from the fixture
 * pin's cached entry. */
async function registeredFromAnotherPin() {
  await makeModule().module.getMetadata(); // a good entry at the fixture pin
  mock.setFailureMode('network');
  const made = makeModule(BUMPED_PIN);
  await made.module.getMetadata(); // registers from the newest cached entry
  return made;
}

beforeEach(() => {
  mock.reset();
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtremote-registered-'));
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

describe('DtRemoteModule getMetadata once registered', () => {
  it('answers at once while the content service hangs, and tries to pin the portal origin in the background', async () => {
    await makeModule().module.getMetadata(); // caches the document at the pin
    mock.setFailureMode('network');
    const { module } = makeModule();
    await module.getMetadata(); // registers from the cache; the portal origin stays unpinned
    mock.setFailureMode('none');
    mock.setHang(true);
    vi.useFakeTimers();
    const metaBefore = metaRequests();

    const answer = module.getMetadata();
    const done = settled(answer);
    await vi.advanceTimersByTimeAsync(1);

    expect(done()).toBe(true);
    expect((await answer).componentClasses?.[0]?.id).toBe(CLASS_ID);
    expect(metaRequests()).toBe(metaBefore + 1);
    await vi.advanceTimersByTimeAsync(15_000); // let the hanging background call time out
  });

  it('a module that has not registered yet still waits for the content service', async () => {
    mock.setHang(true);
    vi.useFakeTimers();

    const done = settled(makeModule().module.getMetadata());
    await vi.advanceTimersByTimeAsync(1);

    expect(done()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000); // let the hanging /meta and document calls (15 s each) time out
  });

  it('concurrent first calls share one registration', async () => {
    const { module } = makeModule();

    await Promise.all([module.getMetadata(), module.getMetadata(), module.getMetadata()]);

    expect(documentRequests(PIN)).toBe(1);
    expect(metaRequests()).toBe(1);
  });

  it('a failed registration is answered again without the network for a minute', async () => {
    mock.setFailureMode('network'); // nothing cached: the first registration fails
    const { module } = makeModule();
    await expect(module.getMetadata()).rejects.toBeInstanceOf(Error);
    vi.useFakeTimers({ toFake: ['Date'] });
    const before = mock.requests.length;

    await expect(module.getMetadata()).rejects.toBeInstanceOf(Error);
    expect(mock.requests.length).toBe(before);

    mock.setFailureMode('none');
    vi.setSystemTime(Date.now() + 60_000);
    expect((await module.getMetadata()).componentClasses?.[0]?.id).toBe(CLASS_ID);
  });

  it('registered from another pin, it serves that entry and then takes its own pin once fetched', async () => {
    const { module } = await registeredFromAnotherPin();
    const before = documentRequests(BUMPED_PIN); // the registration's own failed attempt
    mock.setFailureMode('none');
    mock.setModuleDocument({ ...moduleDocument, module: { ...moduleDocument.module, description: 'At the bumped pin' } });

    const first = await module.getMetadata();
    expect(first.description).toBe(moduleDocument.module.description);
    await vi.waitFor(async () => expect((await module.getMetadata()).description).toBe('At the bumped pin'));

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60_000);
    const metaBefore = metaRequests();
    await module.getMetadata(); // registered at its own pin, origin pinned: nothing left to refresh
    await flush();
    expect(documentRequests(BUMPED_PIN)).toBe(before + 1);
    expect(metaRequests()).toBe(metaBefore);
  });

  it('retries at most once a minute while the service keeps failing, and logs each failure', async () => {
    const { module, warn } = await registeredFromAnotherPin();
    vi.useFakeTimers({ toFake: ['Date'] });
    const before = documentRequests(BUMPED_PIN); // the registration's own failed attempt

    await module.getMetadata();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    const metaBefore = metaRequests();
    await module.getMetadata(); // within the minute: no refresh
    await flush();
    expect(metaRequests()).toBe(metaBefore);
    expect(documentRequests(BUMPED_PIN)).toBe(before + 1);

    vi.setSystemTime(Date.now() + 60_000);
    await module.getMetadata();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
    expect(documentRequests(BUMPED_PIN)).toBe(before + 2);
    expect(warn.mock.calls[0][1]).toEqual({ moduleKey: MODULE_KEY, pin: BUMPED_PIN, error: 'RemoteModuleUnavailableError' });
  });

  it('keeps the registered entry, and caches nothing, when the fetched document has no module name', async () => {
    const { module, warn } = await registeredFromAnotherPin();
    mock.setFailureMode('none');
    mock.setModuleDocument({ ...moduleDocument, module: { ...moduleDocument.module, name: '' } });

    await module.getMetadata();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));

    expect((await module.getMetadata()).name).toBe(MODULE_KEY);
    mock.setFailureMode('network');
    // The bad document was not cached: a fresh module at that pin still registers from the older entry.
    expect((await makeModule(BUMPED_PIN).module.getMetadata()).name).toBe(MODULE_KEY);
  });
});
