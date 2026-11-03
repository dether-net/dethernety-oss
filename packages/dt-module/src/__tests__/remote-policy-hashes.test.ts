/**
 * The policy hashes of a remote module's classes, served per pin beside the module document.
 *
 * The platform stamps an evaluation as following its class's stored hash only when the module's
 * answer agrees, so the module answers a hash only for the pin it evaluates at, only from a set that
 * checks out against that pin and its document, and treats every other outcome as "no hashes":
 * the classes then report none, which leaves their elements unstamped rather than wrongly stamped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Logger } from '@nestjs/common';
import { DtRemoteModule } from '../dt-remote-module';
import { MockContentServer } from '../testing/mock-content-server';
import {
  CLASS_ID,
  MODULE_KEY,
  PIN,
  POLICY_HASH_GOLDEN_HEX,
  moduleDocument,
  policyHashesResponse,
} from '../testing/fixtures';
import { POLICY_HASH_ALGORITHM } from '../policy-hash';
import { DEPLOYMENT_TEAM_HEADER } from '../remote/team-id';

const OTHER_PIN = 'sha256:other-pin';
const OTHER_HASH = 'a'.repeat(64);
const mock = new MockContentServer();
let cacheDir: string;

function makeModule(pin = PIN, teamId?: string) {
  const warn = vi.fn();
  const debug = vi.fn();
  const logger = { warn, log: vi.fn(), debug, error: vi.fn(), verbose: vi.fn() } as unknown as Logger;
  const module = new DtRemoteModule({ moduleKey: MODULE_KEY, pin }, {}, logger, {
    fetchImpl: mock.fetch,
    baseUrl: 'https://mock.local',
    cacheDir,
    teamId,
  });
  return { module, warn, debug };
}

const hashesPath = (pin: string) =>
  `/v1/catalog/modules/${MODULE_KEY}/versions/${encodeURIComponent(pin)}/policy-hashes`;
const hashesRequests = (pin = PIN) => mock.requests.filter((r) => r.path === hashesPath(pin));
/** The stored policy hashes file of a pin, beside its cache entry. */
const storedFile = (pin = PIN) =>
  path.join(cacheDir, MODULE_KEY, `${pin.replace(/[^A-Za-z0-9_-]/g, '_')}.policy-hashes.json`);
const entryFile = (pin = PIN) => path.join(cacheDir, MODULE_KEY, `${pin.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);

/** What getMetadata reports for the fixture class. */
async function reportedHash(module: DtRemoteModule): Promise<string | undefined> {
  return (await module.getMetadata()).componentClasses?.find((c) => c.id === CLASS_ID)?.policyHash;
}

/** A set for the fixture pin, with `over` laid on top. */
const setWith = (over: Record<string, unknown>) => ({ ...policyHashesResponse, ...over });

beforeEach(() => {
  mock.reset();
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtremote-policy-hashes-'));
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

describe('DtRemoteModule policy hashes — served', () => {
  it("reports the pin's hash in getMetadata's class entries and from getPolicyHash", async () => {
    const { module } = makeModule();

    expect(await reportedHash(module)).toBe(POLICY_HASH_GOLDEN_HEX);
    expect(await module.getPolicyHash(CLASS_ID)).toBe(POLICY_HASH_GOLDEN_HEX);
    expect(await module.getPolicyHash('acme-compute.not-served')).toBeUndefined();
  });

  it('never writes the hash into the cached document, or into the document it was served', async () => {
    const { module } = makeModule();
    await module.getMetadata();

    expect(fs.readFileSync(entryFile(), 'utf8')).not.toContain('policyHash');
    expect(moduleDocument.module.componentClasses?.[0]).not.toHaveProperty('policyHash');
    // A warm boot reads the entry back without it, and still reports the hash from the stored set.
    mock.setFailureMode('network');
    const warm = makeModule().module;
    expect(await reportedHash(warm)).toBe(POLICY_HASH_GOLDEN_HEX);
    expect((warm as any).cache.get(MODULE_KEY, PIN).document.module.componentClasses[0]).not.toHaveProperty('policyHash');
  });

  it('builds the reported metadata once per adopted entry', async () => {
    const { module } = makeModule();
    const first = await module.getMetadata();
    expect(await module.getMetadata()).toBe(first);
  });

  it('fetches the set without a credential or a team, like every catalog call', async () => {
    const { module } = makeModule(PIN, 'team-1');
    await module.getMetadata();

    const [request] = hashesRequests();
    expect(request).toBeDefined();
    expect(request.headers.get('authorization')).toBeNull();
    expect(request.token).toBeUndefined();
    expect(request.headers.get(DEPLOYMENT_TEAM_HEADER)).toBeNull();
  });

  it('reports no hash a served document carried itself', async () => {
    mock.setModuleDocument({
      ...moduleDocument,
      module: {
        ...moduleDocument.module,
        componentClasses: [{ ...moduleDocument.module.componentClasses![0], policyHash: OTHER_HASH }],
      },
    });
    mock.setPolicyHashes({ kind: 'status', status: 404 });
    const { module } = makeModule();

    expect(await reportedHash(module)).toBeUndefined();
    expect(await module.getPolicyHash(CLASS_ID)).toBeUndefined();
  });

  it('evaluates only with a caller token, and says so', () => {
    expect(makeModule().module.evaluatesWithCallerTokenOnly()).toBe(true);
  });
});

describe('DtRemoteModule policy hashes — the cache', () => {
  it('stores a good set once, as its own file beside the entry', async () => {
    await makeModule().module.getMetadata();

    expect(JSON.parse(fs.readFileSync(storedFile(), 'utf8'))).toEqual({
      moduleKey: MODULE_KEY,
      version: PIN,
      algorithm: POLICY_HASH_ALGORITHM,
      policyHashes: { [CLASS_ID]: POLICY_HASH_GOLDEN_HEX },
    });
  });

  it('answers a cache hit from the stored set, without asking again', async () => {
    await makeModule().module.getMetadata();
    mock.setPolicyHashes({ kind: 'body', body: setWith({ policyHashes: { [CLASS_ID]: OTHER_HASH } }) });
    const before = hashesRequests().length;

    expect(await reportedHash(makeModule().module)).toBe(POLICY_HASH_GOLDEN_HEX);
    expect(hashesRequests().length).toBe(before);
  });

  it('never replaces a stored set, and says so at debug only', async () => {
    const { module, warn, debug } = makeModule();
    await module.getMetadata();
    const stored = fs.readFileSync(storedFile(), 'utf8');

    (module as any).cache.putPolicyHashes(MODULE_KEY, PIN, setWith({ policyHashes: { [CLASS_ID]: OTHER_HASH } }));

    expect(fs.readFileSync(storedFile(), 'utf8')).toBe(stored);
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('already stored'), { moduleKey: MODULE_KEY, pin: PIN });
    expect(warn).not.toHaveBeenCalled();
    expect(fs.readdirSync(path.dirname(storedFile())).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('fetches the set on a cache hit that has none stored, and stores it', async () => {
    mock.setPolicyHashes({ kind: 'status', status: 404 });
    await makeModule().module.getMetadata(); // the entry is cached; the pin has no set yet
    expect(fs.existsSync(storedFile())).toBe(false);
    mock.setPolicyHashes({ kind: 'served' }); // published since
    mock.setFailureMode('none');
    const before = hashesRequests().length;

    const { module } = makeModule();
    expect(await reportedHash(module)).toBe(POLICY_HASH_GOLDEN_HEX);
    expect(hashesRequests().length).toBe(before + 1);
    expect(fs.existsSync(storedFile())).toBe(true);
  });

  it('waits only briefly for the set on a cache hit, and registers without it', async () => {
    mock.setPolicyHashes({ kind: 'status', status: 404 });
    await makeModule().module.getMetadata();
    mock.setPolicyHashes({ kind: 'hang' });
    vi.useFakeTimers();

    const { module } = makeModule();
    const answer = module.getMetadata();
    await vi.advanceTimersByTimeAsync(3_000);

    expect((await answer).componentClasses?.[0]?.policyHash).toBeUndefined();
    expect(await module.getPolicyHash(CLASS_ID)).toBeUndefined();
    expect(fs.existsSync(storedFile())).toBe(false);
  });

  it('fetches the set again for another pin', async () => {
    await makeModule().module.getMetadata();
    mock.setPolicyHashes({ kind: 'body', body: setWith({ version: OTHER_PIN, policyHashes: { [CLASS_ID]: OTHER_HASH } }) });

    const { module } = makeModule(OTHER_PIN);
    expect(await module.getPolicyHash(CLASS_ID)).toBeUndefined(); // not registered yet
    expect(await reportedHash(module)).toBe(OTHER_HASH);
    expect(hashesRequests(OTHER_PIN)).toHaveLength(1);
    expect(fs.existsSync(storedFile(OTHER_PIN))).toBe(true);
  });
});

describe('DtRemoteModule policy hashes — none, and never a failure', () => {
  // Each leaves the classes without a hash, registers the module all the same, and stores nothing,
  // so a set published later is still fetched at the next start.
  it.each([
    ['a 404 (the pin has no set)', { kind: 'status', status: 404 } as const],
    ['a 403 (how a catalog store answers a missing object)', { kind: 'status', status: 403 } as const],
    ['a 5xx', { kind: 'status', status: 503 } as const],
  ])('%s', async (_label, mode) => {
    mock.setPolicyHashes(mode);
    const { module } = makeModule();

    expect((await module.getMetadata()).componentClasses?.[0]?.id).toBe(CLASS_ID);
    expect(await reportedHash(module)).toBeUndefined();
    expect(await module.getPolicyHash(CLASS_ID)).toBeUndefined();
    expect(fs.existsSync(storedFile())).toBe(false);
    expect(fs.existsSync(entryFile())).toBe(true);
  });

  it('a 403 or 404 logs nothing; a failed fetch logs without the server text', async () => {
    mock.setPolicyHashes({ kind: 'status', status: 403 });
    const quiet = makeModule();
    await quiet.module.getMetadata();
    expect(quiet.warn).not.toHaveBeenCalled();

    fs.rmSync(cacheDir, { recursive: true, force: true });
    mock.setPolicyHashes({ kind: 'status', status: 503 });
    const loud = makeModule();
    await loud.module.getMetadata();
    expect(loud.warn).toHaveBeenCalledTimes(1);
    expect(loud.warn.mock.calls[0][1]).toEqual({ moduleKey: MODULE_KEY, pin: PIN, error: expect.any(String) });
  });

  it('a timeout, which holds a live registration up for the short bound and no longer', async () => {
    mock.setPolicyHashes({ kind: 'hang' });
    vi.useFakeTimers();
    const { module } = makeModule();

    let done = false;
    const answer = module.getMetadata().finally(() => (done = true));
    await vi.advanceTimersByTimeAsync(2_900);
    expect(done).toBe(false); // the document and embeddings are in; only the hashes are outstanding
    await vi.advanceTimersByTimeAsync(100);

    expect(done).toBe(true);
    expect((await answer).componentClasses?.[0]?.id).toBe(CLASS_ID);
    expect(await module.getPolicyHash(CLASS_ID)).toBeUndefined();
    expect(fs.existsSync(storedFile())).toBe(false);
    expect(fs.existsSync(entryFile())).toBe(true);
  });

  const protoKeyed = JSON.parse(
    `{"moduleKey":"${MODULE_KEY}","version":"${PIN}","algorithm":"${POLICY_HASH_ALGORITHM}",` +
      `"policyHashes":{"__proto__":"${OTHER_HASH}","${CLASS_ID}":"${POLICY_HASH_GOLDEN_HEX}"}}`,
  );

  it.each([
    ['not an object', null],
    ['a list', [policyHashesResponse]],
    ['another module', setWith({ moduleKey: 'acme-other' })],
    ['another pin', setWith({ version: OTHER_PIN })],
    ['another algorithm', setWith({ algorithm: 'policy-source-sha256/2' })],
    ['no algorithm', setWith({ algorithm: undefined })],
    ['hashes that are not a map', setWith({ policyHashes: [POLICY_HASH_GOLDEN_HEX] })],
    ['an upper-case hash', setWith({ policyHashes: { [CLASS_ID]: POLICY_HASH_GOLDEN_HEX.toUpperCase() } })],
    ['a short hash', setWith({ policyHashes: { [CLASS_ID]: 'abc' } })],
    ['a hash that is not a string', setWith({ policyHashes: { [CLASS_ID]: 7 } })],
    ['a __proto__ key', protoKeyed],
  ])('a set that is %s is discarded whole, and not stored', async (_label, body) => {
    mock.setPolicyHashes({ kind: 'body', body });
    const { module, warn } = makeModule();

    expect(await reportedHash(module)).toBeUndefined();
    expect(await module.getPolicyHash(CLASS_ID)).toBeUndefined();
    expect(fs.existsSync(storedFile())).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('malformed policy hashes'), { moduleKey: MODULE_KEY, pin: PIN });
  });

  it('keeps no hash for a class the document does not serve, and keeps the rest', async () => {
    mock.setPolicyHashes({
      kind: 'body',
      body: setWith({ policyHashes: { [CLASS_ID]: POLICY_HASH_GOLDEN_HEX, 'acme-compute.not-served': OTHER_HASH } }),
    });
    const { module } = makeModule();

    expect(await reportedHash(module)).toBe(POLICY_HASH_GOLDEN_HEX);
    expect(await module.getPolicyHash('acme-compute.not-served')).toBeUndefined();
    expect(JSON.parse(fs.readFileSync(storedFile(), 'utf8')).policyHashes).toEqual({ [CLASS_ID]: POLICY_HASH_GOLDEN_HEX });
  });

  it('a stored set that does not check out is not used, and is removed', async () => {
    await makeModule().module.getMetadata();
    fs.writeFileSync(storedFile(), JSON.stringify(setWith({ version: OTHER_PIN })));
    mock.setFailureMode('network');

    expect(await reportedHash(makeModule().module)).toBeUndefined();
    expect(fs.existsSync(storedFile())).toBe(false);
  });

  it.each([
    ['does not check out', JSON.stringify(setWith({ policyHashes: { [CLASS_ID]: 'not-a-hash' } }))],
    ['cannot be parsed', '{ not json'],
  ])('a stored set that %s is removed before the refetch, so the fetched one is stored in its place', async (_label, text) => {
    await makeModule().module.getMetadata();
    fs.writeFileSync(storedFile(), text);
    const before = hashesRequests().length;

    expect(await reportedHash(makeModule().module)).toBe(POLICY_HASH_GOLDEN_HEX);
    expect(hashesRequests().length).toBe(before + 1);
    expect(JSON.parse(fs.readFileSync(storedFile(), 'utf8')).policyHashes).toEqual({ [CLASS_ID]: POLICY_HASH_GOLDEN_HEX });
  });
});

describe('DtRemoteModule policy hashes — what a document carries itself', () => {
  it('is stripped from every class array, and the pin\'s hashes go only on the served ones', async () => {
    const carried = { policyHash: OTHER_HASH };
    mock.setModuleDocument({
      ...moduleDocument,
      module: {
        ...moduleDocument.module,
        componentClasses: [{ ...moduleDocument.module.componentClasses![0], ...carried }],
        issueClasses: [{ id: 'acme-compute.issue', name: 'Issue', ...carried } as any],
        analysisClasses: [{ id: 'acme-compute.analysis', name: 'Analysis', ...carried } as any],
      },
    });
    mock.setPolicyHashes({
      kind: 'body',
      body: setWith({
        policyHashes: {
          [CLASS_ID]: POLICY_HASH_GOLDEN_HEX,
          'acme-compute.issue': OTHER_HASH,
          'acme-compute.analysis': OTHER_HASH,
        },
      }),
    });
    const { module } = makeModule();

    const metadata = await module.getMetadata();

    expect(metadata.componentClasses?.[0]?.policyHash).toBe(POLICY_HASH_GOLDEN_HEX);
    expect(metadata.issueClasses?.[0]).not.toHaveProperty('policyHash');
    expect(metadata.analysisClasses?.[0]).not.toHaveProperty('policyHash');
    expect(metadata.issueClasses?.[0]?.id).toBe('acme-compute.issue');
    expect(await module.getPolicyHash('acme-compute.issue')).toBeUndefined();
    // The cached document still holds what it was served: only the copy is changed.
    expect((module as any).cache.get(MODULE_KEY, PIN).document.module.issueClasses[0].policyHash).toBe(OTHER_HASH);
  });
});

describe('DtRemoteModule policy hashes — only for the pin it evaluates at', () => {
  const BUMPED_PIN = 'sha256:bumped-during-outage';

  it('registered from another pin, it reports no hash; once its own pin is adopted, the hash appears', async () => {
    await makeModule().module.getMetadata(); // the fixture pin, with its set stored
    mock.setFailureMode('network');
    const { module } = makeModule(BUMPED_PIN);

    // Serving the fixture pin's entry while evaluating at the bumped pin: its stored hash is the
    // wrong policy's, so nothing is reported and nothing can be stamped.
    const served = await module.getMetadata();
    expect(served.componentClasses?.[0]?.id).toBe(CLASS_ID);
    expect(served.componentClasses?.[0]?.policyHash).toBeUndefined();
    expect(await module.getPolicyHash(CLASS_ID)).toBeUndefined();

    mock.setFailureMode('none');
    mock.setPolicyHashes({ kind: 'body', body: setWith({ version: BUMPED_PIN, policyHashes: { [CLASS_ID]: OTHER_HASH } }) });
    await module.getMetadata(); // starts the background fetch of its own pin
    await vi.waitFor(async () => expect(await module.getPolicyHash(CLASS_ID)).toBe(OTHER_HASH));
    expect(await reportedHash(module)).toBe(OTHER_HASH);
  });
});
