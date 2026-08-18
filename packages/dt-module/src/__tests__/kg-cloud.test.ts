/**
 * What the remote implementation does that the local one has no equivalent for.
 *
 * The shared behaviour is proved in `kg-parity.test.ts` against both. This file is the rest: which
 * calls carry a credential, how a key set too wide for the service is handled, and — the one worth
 * reading closely — that a cached answer can never reach a caller it was not computed for.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockContentServer } from '../testing/mock-content-server';
import {
  ENTITLED_TOKEN,
  EXPIRED_TOKEN,
  KG_CLASS_ID,
  KG_NARROWED_TOKEN,
  KG_OTHER_CLASS_ID,
  KG_TECHNIQUE_ID,
  KG_VERSION,
  UNENTITLED_TOKEN,
  kgRegistry,
} from '../testing/fixtures';
import { CloudKgClient } from '../kg/cloud-client';
import {
  CloudSessionExpiredError,
  ContentRecalledError,
  EvaluationNotEntitledError,
  RemoteModuleMisconfiguredError,
  RemoteModuleUnavailableError,
} from '../remote/errors';

const mock = new MockContentServer();

function client() {
  return new CloudKgClient({ baseUrl: 'https://mock.local', version: KG_VERSION, fetchImpl: mock.fetch });
}

/** The query calls only — the registry fetch is not one of them. */
function queryRequests() {
  return mock.requests.filter((r) => r.method === 'POST');
}

beforeEach(() => {
  mock.reset();
});

describe('credentials', () => {
  it('carries the bearer on the entitled routes', async () => {
    await client().rulesByClassId([KG_CLASS_ID], undefined, ENTITLED_TOKEN);
    await client().capability(ENTITLED_TOKEN);
    const entitled = mock.requests.filter((r) => r.path.includes('/query/') || r.path.endsWith('/capability'));
    expect(entitled.length).toBe(2);
    expect(entitled.every((r) => r.token === ENTITLED_TOKEN)).toBe(true);
  });

  it('sends no credential to the registry', async () => {
    // Its response is publicly cacheable, so a bearer on it ends up in intermediary logs having
    // bought nothing. Asserted on what was sent, not on what came back — a service that ignored
    // the header would make a response-level check pass while the token still left the process.
    await client().rulesByClassId([KG_CLASS_ID], undefined, ENTITLED_TOKEN);
    const registry = mock.requests.filter((r) => r.path === '/v1/kg/queries');
    expect(registry).toHaveLength(1);
    expect(registry[0].token).toBeUndefined();
  });

  it('refuses a call with no token before making one', async () => {
    // Not an empty map. An empty map is indistinguishable at the call site from a knowledge graph
    // that genuinely holds no matches, which is the confusion this whole seam exists to prevent.
    await expect(client().rulesByClassId([KG_CLASS_ID])).rejects.toBeInstanceOf(CloudSessionExpiredError);
    await expect(client().capability()).rejects.toBeInstanceOf(CloudSessionExpiredError);
    expect(mock.requests).toHaveLength(0);
  });
});

describe('chunking', () => {
  const wide = Array.from({ length: 250 }, (_, i) => `acme-compute.class-${i}`);
  /** Read from the fixture registry, because the published bound is sized by what one response may
   *  weigh — it has moved once already, and a hard-coded chunk count would break on the next change
   *  while proving nothing about chunking. */
  const publishedBound = kgRegistry.queries.find((q) => q.name === 'rulesByClassId')!.parameters.classIds.maxItems;

  it('splits a key set wider than the published bound and merges the answers', async () => {
    const map = await client().rulesByClassId(wide, undefined, ENTITLED_TOKEN);
    expect(queryRequests()).toHaveLength(Math.ceil(wide.length / publishedBound));
    // Every key present, in the order asked — a caller cannot tell this took two calls.
    expect([...map.keys()]).toEqual(wide);
  });

  it('honours a bound the service tightened, rather than the one shipped here', async () => {
    // The reason the registry is fetched at all. A client assuming the bound it shipped with, against
    // a service that has since tightened it, would send too many keys and hand its caller a rejection
    // for asking a wide question.
    mock.setKgRegistry({
      ...kgRegistry,
      queries: kgRegistry.queries.map((q) => ({
        ...q,
        parameters: { classIds: { type: 'array', items: 'string', maxItems: 50 } },
      })),
    });
    const map = await client().rulesByClassId(wide, undefined, ENTITLED_TOKEN);
    expect(queryRequests()).toHaveLength(5);
    expect([...map.keys()]).toEqual(wide);
  });

  it('makes one call when the key set fits', async () => {
    await client().rulesByClassId([KG_CLASS_ID, KG_OTHER_CLASS_ID], undefined, ENTITLED_TOKEN);
    expect(queryRequests()).toHaveLength(1);
  });
});

describe('the registry', () => {
  it('is fetched once per client, however many queries follow', async () => {
    const c = client();
    await c.rulesByClassId([KG_CLASS_ID], undefined, ENTITLED_TOKEN);
    await c.threatsByTechniqueId([KG_TECHNIQUE_ID], ENTITLED_TOKEN);
    expect(mock.requests.filter((r) => r.path === '/v1/kg/queries')).toHaveLength(1);
  });

  it('still answers when it cannot be read, and does not remember the failure', async () => {
    // Public and unrelated to entitlement, so its absence must not fail a query the caller may
    // well be entitled to — the service's own rejection stays the backstop for a too-wide set.
    mock.setKgRegistry(null);
    const c = client();
    const map = await c.rulesByClassId([KG_CLASS_ID], undefined, ENTITLED_TOKEN);
    expect(map.get(KG_CLASS_ID)!.length).toBeGreaterThan(0);

    mock.setKgRegistry(kgRegistry);
    await c.rulesByClassId([KG_OTHER_CLASS_ID], undefined, ENTITLED_TOKEN);
    expect(mock.requests.filter((r) => r.path === '/v1/kg/queries')).toHaveLength(2);
  });
});

describe('the cache is scoped to the caller', () => {
  it('answers a repeated question without asking again', async () => {
    const c = client();
    await c.rulesByClassId([KG_CLASS_ID], undefined, ENTITLED_TOKEN);
    await c.rulesByClassId([KG_CLASS_ID], undefined, ENTITLED_TOKEN);
    expect(queryRequests()).toHaveLength(1);
  });

  it('gives two entitled callers their own answers, cold and warm', async () => {
    // The failure this prevents, stated plainly: both callers are entitled, but to different
    // slices, so the same query at the same version has two correct answers. A cache keyed only by
    // content hands the second caller the first one's — and if the first held more, the second is
    // quietly shown data they never bought; if the first held less, the second is quietly shown a
    // thinner answer than they paid for. The second is the one nobody reports.
    const c = client();
    const full = await c.rulesByClassId([KG_OTHER_CLASS_ID], undefined, ENTITLED_TOKEN);
    const narrowed = await c.rulesByClassId([KG_OTHER_CLASS_ID], undefined, KG_NARROWED_TOKEN);
    expect(full.get(KG_OTHER_CLASS_ID)!.length).toBeGreaterThan(0);
    expect(narrowed.get(KG_OTHER_CLASS_ID)).toEqual([]);
    expect(queryRequests()).toHaveLength(2);

    // And warm: each caller still gets its own, from its own entry.
    const fullAgain = await c.rulesByClassId([KG_OTHER_CLASS_ID], undefined, ENTITLED_TOKEN);
    const narrowedAgain = await c.rulesByClassId([KG_OTHER_CLASS_ID], undefined, KG_NARROWED_TOKEN);
    expect(fullAgain).toEqual(full);
    expect(narrowedAgain).toEqual(narrowed);
    expect(queryRequests()).toHaveLength(2);
  });

  it('drops a refused caller’s entries and leaves everyone else’s alone', async () => {
    const c = client();
    await c.rulesByClassId([KG_CLASS_ID], undefined, ENTITLED_TOKEN);
    await c.rulesByClassId([KG_CLASS_ID], undefined, KG_NARROWED_TOKEN);
    expect(queryRequests()).toHaveLength(2);

    // The narrowed caller is refused on some other question — their entitlement has changed, so
    // nothing they were previously told they may see can still be trusted.
    await expect(c.threatsByTechniqueId([KG_TECHNIQUE_ID], UNENTITLED_TOKEN)).rejects.toBeInstanceOf(
      EvaluationNotEntitledError,
    );

    // The entitled caller's entry survives — it was computed against their own entitlements.
    await c.rulesByClassId([KG_CLASS_ID], undefined, ENTITLED_TOKEN);
    expect(queryRequests()).toHaveLength(3);
  });

  it('caches nothing from a truncated response', async () => {
    mock.setKgTruncated(true);
    const c = client();
    await expect(c.rulesByClassId([KG_CLASS_ID], undefined, ENTITLED_TOKEN)).rejects.toBeInstanceOf(
      RemoteModuleMisconfiguredError,
    );
    mock.setKgTruncated(false);
    const map = await c.rulesByClassId([KG_CLASS_ID], undefined, ENTITLED_TOKEN);
    expect(map.get(KG_CLASS_ID)!.length).toBeGreaterThan(0);
  });
});

describe('truncation is a fault, not data', () => {
  it('raises rather than returning a short map', async () => {
    // The protocol caps nothing, so this can only be a service that capped an answer without
    // saying it would. A short map and a complete one look identical at the call site.
    mock.setKgTruncated(true);
    await expect(client().rulesByClassId([KG_CLASS_ID], undefined, ENTITLED_TOKEN)).rejects.toThrow(/truncated/i);
  });
});

describe('the failure taxonomy', () => {
  it('turns a refusal into a denial carrying a knowledge-graph subject', async () => {
    const err = await client()
      .rulesByClassId([KG_CLASS_ID], undefined, UNENTITLED_TOKEN)
      .catch((e) => e);
    expect(err).toBeInstanceOf(EvaluationNotEntitledError);
    expect(err.denial?.subject?.kind).toBe('kg');
  });

  it('surfaces an expired session as re-authentication, not as a denial', async () => {
    await expect(client().capability(EXPIRED_TOKEN)).rejects.toBeInstanceOf(CloudSessionExpiredError);
  });

  it('surfaces a recalled version as recalled, even to a caller who is not entitled', async () => {
    // Recall precedes entitlement: a withdrawn version is withdrawn for everyone, and a caller
    // owed "this version is known-bad" must never be told "you may not ask" instead.
    mock.recallKgVersion(KG_VERSION);
    const err = await client()
      .capability(UNENTITLED_TOKEN)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ContentRecalledError);
  });

  it.each([
    ['a transient outage', '5xx' as const],
    ['a network failure', 'network' as const],
    ['a rate limit', 'rate_limited' as const],
  ])('degrades %s to unavailable', async (_label, mode) => {
    mock.setFailureMode(mode);
    await expect(client().capability(ENTITLED_TOKEN)).rejects.toBeInstanceOf(RemoteModuleUnavailableError);
  });

  it('treats a query the service does not recognise as a misconfiguration', async () => {
    // The client never names a query its own interface lacks, so this can only arise from the two
    // sides disagreeing about the query set — an operator problem, not something to retry.
    mock.setKgRegistry({ ...kgRegistry, queries: [] });
    await expect(client().rulesByClassId([KG_CLASS_ID], undefined, ENTITLED_TOKEN)).rejects.toBeInstanceOf(
      RemoteModuleMisconfiguredError,
    );
  });
});

describe('capability', () => {
  it('maps the wire field to the interface one', async () => {
    const capability = await client().capability(ENTITLED_TOKEN);
    expect(capability).toEqual({ available: true, entitled: true, sliceCount: 2 });
  });

  it('reports the narrowed caller’s smaller entitled set', async () => {
    expect(await client().capability(KG_NARROWED_TOKEN)).toEqual({
      available: true,
      entitled: true,
      sliceCount: 1,
    });
  });
});
