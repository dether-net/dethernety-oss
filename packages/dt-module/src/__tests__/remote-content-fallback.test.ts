/**
 * A template or guide served as the read-only fallback: what it costs on the wire, and what it logs. A host
 * records a served fallback as a successful call, so the module's own warn is what keeps an outage or a denial
 * visible; and a host's timeout is sized on the assumption that one call is one request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Logger } from '@nestjs/common';
import { DtRemoteModule } from '../dt-remote-module';
import { REMOTE_MODULE_CALL_TIMEOUT_MS } from '../index';
import { MockContentServer } from '../testing/mock-content-server';
import { CLASS_ID, ENTITLED_TOKEN, MODULE_KEY, PIN, UNENTITLED_TOKEN } from '../testing/fixtures';

const mock = new MockContentServer();
let cacheDir: string;
let warn: ReturnType<typeof vi.fn>;

function makeModule(fetchImpl: (url: string, init: RequestInit) => Promise<Response> = mock.fetch) {
  warn = vi.fn();
  const logger = { warn, log: vi.fn(), debug: vi.fn(), error: vi.fn(), verbose: vi.fn() } as unknown as Logger;
  return new DtRemoteModule({ moduleKey: MODULE_KEY, pin: PIN }, {}, logger, {
    fetchImpl,
    baseUrl: 'https://mock.local',
    cacheDir,
  });
}

/** The fallback warns, and nothing else the module logs at warn. */
const fallbackWarns = () => warn.mock.calls.filter(([message]) => message === 'Serving the read-only fallback');

beforeEach(() => {
  mock.reset();
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtremote-fallback-'));
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

describe('DtRemoteModule content fallback', () => {
  it('exports the per-call timeout a host must outlast', () => {
    expect(REMOTE_MODULE_CALL_TIMEOUT_MS).toBe(15_000);
  });

  it('a content call that fails issues exactly one request and returns the fallback', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const module = makeModule(fetchImpl);

    const template = JSON.parse(await module.getClassTemplate(CLASS_ID, ENTITLED_TOKEN));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(template.schema).toEqual({ type: 'object', properties: {} });
    expect(JSON.stringify(template)).toContain('Content unavailable');
  });

  it('warns once with the reason, and never the token or the server text', async () => {
    const module = makeModule(async () => {
      throw new TypeError('fetch failed: secret upstream detail');
    });

    await module.getClassTemplate(CLASS_ID, ENTITLED_TOKEN);

    expect(fallbackWarns()).toHaveLength(1);
    const [, context] = fallbackWarns()[0];
    expect(context).toEqual({ moduleKey: MODULE_KEY, kind: 'template', id: CLASS_ID, reason: 'unavailable', unloggedSinceLastWarn: 0 });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(ENTITLED_TOKEN);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret upstream detail');
  });

  it('names a denial and a missing credential as their own reasons', async () => {
    const module = makeModule();

    await module.getClassGuide(CLASS_ID, UNENTITLED_TOKEN);
    await module.getClassTemplate(CLASS_ID);

    expect(fallbackWarns().map(([, context]) => [context.kind, context.reason])).toEqual([
      ['guide', 'denied'],
      ['template', 'no-credential'],
    ]);
  });

  it('logs a burst once per reason per minute, then the count it held back', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const module = makeModule(async () => {
      throw new TypeError('fetch failed');
    });

    for (let i = 0; i < 5; i++) await module.getClassTemplate(`${CLASS_ID}-${i}`, ENTITLED_TOKEN);
    expect(fallbackWarns()).toHaveLength(1);

    vi.setSystemTime(Date.now() + 60_000);
    await module.getClassTemplate(CLASS_ID, ENTITLED_TOKEN);

    expect(fallbackWarns()).toHaveLength(2);
    expect(fallbackWarns()[1][1].unloggedSinceLastWarn).toBe(4);
  });

  it('logs nothing for content it serves', async () => {
    const module = makeModule();

    await module.getClassTemplate(CLASS_ID, ENTITLED_TOKEN);

    expect(fallbackWarns()).toHaveLength(0);
  });
});
