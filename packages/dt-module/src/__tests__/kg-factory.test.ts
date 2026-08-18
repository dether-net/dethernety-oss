/**
 * Mode selection.
 *
 * The negative cases carry the weight: a deployment pointed at a service without a usable pin must
 * go inert rather than guess a version, and it must not reach the network to find that out.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createKgClient } from '../kg/factory';
import { CloudKgClient } from '../kg/cloud-client';
import { LocalKgClient } from '../kg/local-client';
import { UnavailableKgClient } from '../kg/unavailable-client';
import { KgUnavailableError } from '../kg/unavailable-client';
import { KG_VERSION } from '../testing/fixtures';
import { makeKgDriver, probeRow } from './kg-driver-fake';

const BASE_URL = 'https://kg.example.invalid';
/** The mock's published version, deliberately reused: the factory's digest check is the only
 * thing in the package that validates it, so sharing the constant makes this suite the guard. */
const PIN = KG_VERSION;

/** A logger shaped like the one a module is handed. */
function logger() {
  return { warn: vi.fn(), log: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createKgClient — a configured service', () => {
  it('builds the remote client when the pin is a digest', () => {
    const fake = makeKgDriver(() => [probeRow]);
    const client = createKgClient({ driver: fake.driver }, { baseUrl: BASE_URL, version: PIN });
    expect(client).toBeInstanceOf(CloudKgClient);
    // Remote mode never consults the deployment's own graph, not even to decide.
    expect(fake.sessions()).toBe(0);
  });

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['not a digest', 'latest'],
    ['the wrong algorithm', 'sha512:' + 'a'.repeat(64)],
    ['too short', 'sha256:' + 'a'.repeat(63)],
    ['upper case', 'sha256:' + 'A'.repeat(64)],
  ])('goes inert when the pin is %s, and warns once', (_label, version) => {
    // Never "latest". The service publishes a newest version, and taking it would advance the
    // knowledge graph under a deployment that pinned on purpose.
    const fake = makeKgDriver(() => [probeRow]);
    const log = logger();
    const client = createKgClient({ driver: fake.driver, logger: log }, { baseUrl: BASE_URL, version });
    expect(client).toBeInstanceOf(UnavailableKgClient);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(fake.sessions()).toBe(0);
  });

  it('issues no request from the inert state', async () => {
    // A fetch spy that must not be called: the half-configured deployment must not discover its
    // own misconfiguration by asking a host what version it should have been pinned to.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const client = createKgClient({ driver: makeKgDriver(() => []).driver }, { baseUrl: BASE_URL });
    await expect(client.rulesByClassId(['a'])).rejects.toBeInstanceOf(KgUnavailableError);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('createKgClient — no configured service', () => {
  it('builds the local client', async () => {
    const fake = makeKgDriver(() => [probeRow]);
    const client = createKgClient({ driver: fake.driver });
    expect(client).toBeInstanceOf(LocalKgClient);
    expect(await client.capability()).toEqual({ available: true, entitled: true, sliceCount: 0 });
  });

  it('reports unavailable — not empty — when the graph holds no knowledge-graph nodes', async () => {
    // The state the specification calls the one that matters: a plain deployment has neither a
    // service nor the nodes. It cannot be a branch in this function, because deciding it means
    // asking the database and this call is synchronous; the local client carries the probe.
    const client = createKgClient({ driver: makeKgDriver(() => []).driver });
    expect(await client.capability()).toEqual({ available: false, entitled: true, sliceCount: 0 });
    await expect(client.rulesByClassId(['a'])).rejects.toBeInstanceOf(KgUnavailableError);
  });

  it('never reaches the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const client = createKgClient({ driver: makeKgDriver(() => [probeRow]).driver });
    await client.capability();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('createKgClient — configuration comes from the environment', () => {
  it('reads both variables when nothing is injected', () => {
    vi.stubEnv('MODULE_KG_BASE_URL', BASE_URL);
    vi.stubEnv('MODULE_KG_VERSION', PIN);
    expect(createKgClient({ driver: makeKgDriver(() => []).driver })).toBeInstanceOf(CloudKgClient);
  });

  it('has no baked default — an unset base URL stays local, never a host', () => {
    vi.stubEnv('MODULE_KG_BASE_URL', '');
    vi.stubEnv('MODULE_KG_VERSION', PIN);
    // A pin without a service is not half a configuration; it is a local deployment with a stray
    // variable, and it must not become a request to anywhere.
    expect(createKgClient({ driver: makeKgDriver(() => []).driver })).toBeInstanceOf(LocalKgClient);
  });
});
