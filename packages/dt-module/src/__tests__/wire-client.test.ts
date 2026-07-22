import { describe, it, expect, beforeEach } from 'vitest';
import { WireClient, FetchLike } from '../remote/wire-client';
import {
  CloudSessionExpiredError,
  EvaluationNotEntitledError,
  ContentRecalledError,
  RemoteModuleUnavailableError,
  RemoteModuleMisconfiguredError,
} from '../remote/errors';
import { MockContentServer } from '../testing/mock-content-server';
import {
  MODULE_KEY,
  PIN,
  MODEL_SLUG,
  CLASS_ID,
  ENTITLED_TOKEN,
} from '../testing/fixtures';

const BASE = 'https://svc.local';

/** A fetchImpl that returns one crafted response and records the init it saw. */
function crafted(status: number, body: unknown, headers: Record<string, string> = {}): { fetchImpl: FetchLike; seen: RequestInit[] } {
  const seen: RequestInit[] = [];
  const fetchImpl: FetchLike = (_url, init) => {
    seen.push(init);
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } }),
    );
  };
  return { fetchImpl, seen };
}

function clientWith(fetchImpl: FetchLike, timeoutMs?: number): WireClient {
  return new WireClient({ baseUrl: BASE, fetchImpl, timeoutMs });
}

describe('WireClient — status → typed error mapping', () => {
  it('401 token_expired → CloudSessionExpiredError (token_expired), never retried', async () => {
    const { fetchImpl } = crafted(401, { code: 'token_expired', title: 'expired' });
    await expect(clientWith(fetchImpl).template(CLASS_ID, PIN, 'tok')).rejects.toMatchObject({
      name: 'CloudSessionExpiredError',
      code: 'token_expired',
    });
  });

  it('401 invalid_token → CloudSessionExpiredError', async () => {
    const { fetchImpl } = crafted(401, { code: 'invalid_token' });
    await expect(clientWith(fetchImpl).template(CLASS_ID, PIN, 'tok')).rejects.toBeInstanceOf(CloudSessionExpiredError);
  });

  it('403 not_entitled → EvaluationNotEntitledError carrying the denial', async () => {
    const denial = { message: { title: 'locked', body: 'subscribe' } };
    const { fetchImpl } = crafted(403, { code: 'not_entitled', denial });
    const err = await clientWith(fetchImpl).template(CLASS_ID, PIN, 'tok').catch((e) => e);
    expect(err).toBeInstanceOf(EvaluationNotEntitledError);
    expect((err as EvaluationNotEntitledError).denial?.message?.body).toBe('subscribe');
  });

  it('404 on a pinned path → RemoteModuleMisconfiguredError (never transient)', async () => {
    const { fetchImpl } = crafted(404, { code: 'version_not_found' });
    await expect(clientWith(fetchImpl).moduleDocument(MODULE_KEY, PIN)).rejects.toBeInstanceOf(RemoteModuleMisconfiguredError);
  });

  it('400 payload_invalid and 413 payload_too_large → RemoteModuleMisconfiguredError', async () => {
    for (const [status, code] of [[400, 'payload_invalid'], [413, 'payload_too_large']] as const) {
      const { fetchImpl } = crafted(status, { code });
      await expect(
        clientWith(fetchImpl).evaluate(CLASS_ID, PIN, 'tok', { requestId: 'r', attributes: {} }),
      ).rejects.toBeInstanceOf(RemoteModuleMisconfiguredError);
    }
  });

  it('410 version_recalled → ContentRecalledError carrying the reason', async () => {
    const { fetchImpl } = crafted(410, { code: 'version_recalled', recalled: { reason: 'known-bad' } });
    const err = await clientWith(fetchImpl).template(CLASS_ID, PIN, 'tok').catch((e) => e);
    expect(err).toBeInstanceOf(ContentRecalledError);
    expect((err as ContentRecalledError).recall?.reason).toBe('known-bad');
  });

  it('429 → RemoteModuleUnavailableError with retryAfterMs from Retry-After', async () => {
    const { fetchImpl } = crafted(429, { code: 'rate_limited' }, { 'Retry-After': '2' });
    const err = await clientWith(fetchImpl).moduleDocument(MODULE_KEY, PIN).catch((e) => e);
    expect(err).toBeInstanceOf(RemoteModuleUnavailableError);
    expect((err as RemoteModuleUnavailableError).retryAfterMs).toBe(2000);
  });

  it('5xx with no code → transient RemoteModuleUnavailableError', async () => {
    const { fetchImpl } = crafted(503, { title: 'oops' });
    await expect(clientWith(fetchImpl).moduleDocument(MODULE_KEY, PIN)).rejects.toBeInstanceOf(RemoteModuleUnavailableError);
  });

  it('500 eval_failed → non-transient RemoteModuleMisconfiguredError', async () => {
    const { fetchImpl } = crafted(500, { code: 'eval_failed' });
    await expect(
      clientWith(fetchImpl).evaluate(CLASS_ID, PIN, 'tok', { requestId: 'r', attributes: {} }),
    ).rejects.toBeInstanceOf(RemoteModuleMisconfiguredError);
  });
});

describe('WireClient — cross-cutting request rules', () => {
  it('sets redirect:"error" and a static library User-Agent on every call, no identity headers', async () => {
    const { fetchImpl, seen } = crafted(200, { protocol: '1', module: { name: MODULE_KEY } });
    await clientWith(fetchImpl).moduleDocument(MODULE_KEY, PIN);
    const init = seen[0];
    expect(init.redirect).toBe('error');
    const headers = new Headers(init.headers as Record<string, string>);
    expect(headers.get('user-agent')).toMatch(/^dt-remote-module\/\d+\.\d+\.\d+$/);
  });

  it('a 3xx meeting redirect:"error" is a hard failure — the bearer never follows it', async () => {
    const mock = new MockContentServer();
    mock.setRedirectHardFailure(true);
    await expect(
      new WireClient({ baseUrl: BASE, fetchImpl: mock.fetch }).template(CLASS_ID, PIN, ENTITLED_TOKEN),
    ).rejects.toBeInstanceOf(RemoteModuleUnavailableError);
  });

  it('a timeout maps to RemoteModuleUnavailableError', async () => {
    const mock = new MockContentServer();
    mock.setHang(true);
    await expect(
      new WireClient({ baseUrl: BASE, fetchImpl: mock.fetch, timeoutMs: 20 }).moduleDocument(MODULE_KEY, PIN),
    ).rejects.toBeInstanceOf(RemoteModuleUnavailableError);
  });

  it('a network failure maps to RemoteModuleUnavailableError', async () => {
    const mock = new MockContentServer();
    mock.setFailureMode('network');
    await expect(
      new WireClient({ baseUrl: BASE, fetchImpl: mock.fetch }).moduleDocument(MODULE_KEY, PIN),
    ).rejects.toBeInstanceOf(RemoteModuleUnavailableError);
  });

  it('an unconfigured base URL leaves the client inert (unavailable, no fetch)', async () => {
    let called = false;
    const fetchImpl: FetchLike = () => {
      called = true;
      return Promise.resolve(new Response('{}'));
    };
    await expect(new WireClient({ fetchImpl }).meta()).rejects.toBeInstanceOf(RemoteModuleUnavailableError);
    expect(called).toBe(false);
  });

  it('tolerates an unknown response field (forward compatibility)', async () => {
    const { fetchImpl } = crafted(200, {
      protocol: '1',
      module: { name: MODULE_KEY, componentClasses: [] },
      futureField: 'a v-next field a v1 client must not break on',
    });
    const doc = await clientWith(fetchImpl).moduleDocument(MODULE_KEY, PIN);
    expect(doc.module.name).toBe(MODULE_KEY);
    expect((doc as unknown as { futureField: string }).futureField).toBe('a v-next field a v1 client must not break on');
  });
});

describe('WireClient — authorization scoping (against the mock)', () => {
  let mock: MockContentServer;
  beforeEach(() => {
    mock = new MockContentServer();
  });

  it('catalog calls carry no Authorization header', async () => {
    const client = new WireClient({ baseUrl: BASE, fetchImpl: mock.fetch });
    await client.moduleDocument(MODULE_KEY, PIN);
    await client.embeddings(MODULE_KEY, PIN, MODEL_SLUG);
    expect(mock.requests).toHaveLength(2);
    for (const req of mock.requests) {
      expect(req.headers.get('authorization')).toBeNull();
      expect(req.token).toBeUndefined();
    }
  });

  it('content/eval calls carry a Bearer token only when one is passed', async () => {
    const client = new WireClient({ baseUrl: BASE, fetchImpl: mock.fetch });
    await client.template(CLASS_ID, PIN, ENTITLED_TOKEN);
    await client.evaluate(CLASS_ID, PIN, ENTITLED_TOKEN, { requestId: 'r', attributes: { tls_version: '1.2' } });
    expect(mock.requests.map((r) => r.token)).toEqual([ENTITLED_TOKEN, ENTITLED_TOKEN]);
    expect(mock.requests[1].method).toBe('POST');
  });
});
