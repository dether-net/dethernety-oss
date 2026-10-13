/**
 * Weight acquisition against a fake hub: only listed files are fetched, each is verified before it
 * takes its final name, redirects stay on HTTPS, the token goes only to the hub, and paths cannot
 * leave the models directory.
 */

import { createHash } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import * as fsp from 'fs/promises';
import { chmod, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Pass-through, so a test can count the reads that hash a file.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) };
});

// Pass-through, so a test can make one call fail at a chosen moment.
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, lstat: vi.fn(actual.lstat), open: vi.fn(actual.open) };
});

import type { EmbeddingProfile } from '@dethernety/dt-module/embedding';

import {
  ensureWeights,
  ensureWeightsWithRetry,
  forgetVerifiedFiles,
  profileRoot,
  removeStaleTemporaries,
  type FetchLike,
  verifyWeights,
  WeightFileError,
} from '../acquire';

const REVISION = 'a'.repeat(40);
const CONTENT: Record<string, string> = {
  'config.json': '{"model":"tiny"}',
  'onnx/model.onnx': 'graph-bytes',
  'tokenizer.json': '{"tokens":[]}',
};
/** A whole-second time long past, for a stale mtime. */
const T_PAST = 1_700_000_000;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function profile(files = Object.keys(CONTENT)): EmbeddingProfile {
  return {
    schemaVersion: 1,
    id: 'tiny-test-v1',
    label: 'tiny',
    source: {
      hub: 'https://hub.example',
      repo: 'org/tiny',
      revision: REVISION,
      gated: false,
      files: files.map((path) => ({ path, bytes: Buffer.byteLength(CONTENT[path] ?? 'x'), sha256: sha(CONTENT[path] ?? 'x') })),
    },
    licence: { name: 'test' },
    runtime: { engine: 'onnx', dimensions: 4 },
    prompts: { query: '{text}', document: '{text}', title: 'none' },
    thresholds: { classes: null, mitre: null, components: null },
    calibration: { set: 'x', date: '2026-01-01', rule: 'x' },
  };
}

interface Call {
  url: string;
  headers: Record<string, string>;
}

/** A hub that serves CONTENT, optionally behind a CDN redirect, recording every request. */
function fakeHub(opts: { cdn?: string; serve?: (path: string) => string | undefined; fail?: boolean } = {}) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers });
    if (opts.fail) throw new Error('network down');
    const u = new URL(url);
    if (u.origin === 'https://hub.example' && opts.cdn) {
      return { status: 302, headers: { get: (n) => (n === 'location' ? `${opts.cdn}${u.pathname}?sig=secret` : null) }, body: null };
    }
    const path = decodeURIComponent(u.pathname).split(`/resolve/${REVISION}/`)[1];
    const body = opts.serve ? opts.serve(path) : CONTENT[path];
    if (body === undefined) return { status: 404, headers: { get: () => null }, body: null };
    return { status: 200, headers: { get: () => null }, body: (async function* () { yield Buffer.from(body); })() };
  };
  return { fetch, calls };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'embedder-acquire-'));
  forgetVerifiedFiles();
  vi.mocked(createReadStream).mockClear();
});
afterEach(async () => {
  vi.mocked(fsp.lstat).mockReset();
  vi.mocked(fsp.open).mockReset();
  await rm(dir, { recursive: true, force: true });
});

const listFiles = async (root: string): Promise<string[]> => {
  const out: string[] = [];
  const walk = async (d: string, prefix = ''): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.isDirectory()) await walk(join(d, e.name), `${prefix}${e.name}/`);
      else out.push(`${prefix}${e.name}`);
    }
  };
  await walk(root);
  return out.sort();
};

describe('ensureWeights', () => {
  it('fetches exactly the listed files into <dir>/<repo>/<revision>', async () => {
    const hub = fakeHub();
    await ensureWeights(profile(), dir, { fetch: hub.fetch });
    expect(profileRoot(profile(), dir)).toBe(join(dir, 'org', 'tiny', REVISION));
    expect(await listFiles(profileRoot(profile(), dir))).toEqual(Object.keys(CONTENT).sort());
    expect(hub.calls.map((c) => new URL(c.url).pathname)).toEqual(
      Object.keys(CONTENT).map((p) => `/org/tiny/resolve/${REVISION}/${p}`),
    );
    await expect(verifyWeights(profile(), dir)).resolves.toBeUndefined();
  });

  it('builds the same file URLs when the hub address ends in slashes', async () => {
    const hub = fakeHub();
    const p = profile(['config.json']);
    p.source!.hub = 'https://hub.example///';
    await ensureWeights(p, dir, { fetch: hub.fetch });
    expect(hub.calls.map((c) => c.url)).toEqual([`https://hub.example/org/tiny/resolve/${REVISION}/config.json`]);
  });

  it('fetches nothing when every file is present and verified (offline placement)', async () => {
    await ensureWeights(profile(), dir, { fetch: fakeHub().fetch });
    const hub = fakeHub({ fail: true });
    await ensureWeights(profile(), dir, { fetch: hub.fetch });
    expect(hub.calls).toEqual([]);
  });

  it('replaces a present file that does not match', async () => {
    await ensureWeights(profile(), dir, { fetch: fakeHub().fetch });
    const target = join(profileRoot(profile(), dir), 'config.json');
    await writeFile(target, '{"tampered":true}');
    const hub = fakeHub();
    await ensureWeights(profile(), dir, { fetch: hub.fetch });
    expect(hub.calls).toHaveLength(1);
    expect(await readFile(target, 'utf-8')).toBe(CONTENT['config.json']);
  });

  it('rejects a sha256 mismatch and leaves no file under the final name or a temporary', async () => {
    const hub = fakeHub({ serve: (p) => (p === 'config.json' ? '{"model":"tinx"}' : CONTENT[p]) });
    await expect(ensureWeights(profile(), dir, { fetch: hub.fetch })).rejects.toThrow(/config\.json: sha256 differs/);
    expect(existsSync(join(profileRoot(profile(), dir), 'config.json'))).toBe(false);
    expect((await listFiles(dir)).filter((f) => f.includes('.part-'))).toEqual([]);
  });

  it('rejects a size mismatch', async () => {
    const hub = fakeHub({ serve: (p) => (p === 'config.json' ? '{}' : CONTENT[p]) });
    await expect(ensureWeights(profile(), dir, { fetch: hub.fetch })).rejects.toThrow(/config\.json: size 2 differs/);
  });

  it('stops a response longer than the listed size', async () => {
    const hub = fakeHub({ serve: (p) => (p === 'config.json' ? `${CONTENT[p]}----` : CONTENT[p]) });
    await expect(ensureWeights(profile(), dir, { fetch: hub.fetch })).rejects.toThrow(/larger than the listed/);
  });

  it('leaves no file under the final name when the download breaks off', async () => {
    const fetch: FetchLike = async () => ({
      status: 200,
      headers: { get: () => null },
      body: (async function* () {
        yield Buffer.from('{"mo');
        throw new Error('connection reset');
      })(),
    });
    await expect(ensureWeights(profile(['config.json']), dir, { fetch })).rejects.toThrow(/connection reset/);
    expect(await listFiles(dir).catch(() => [])).toEqual([]);
  });

  it('removes stale temporaries at start, and keeps one another process may still be writing', async () => {
    const root = profileRoot(profile(), dir);
    await mkdir(join(root, 'onnx'), { recursive: true });
    const hourAgo = (Date.now() - 2 * 60 * 60_000) / 1000;
    await writeFile(join(root, 'onnx', 'model.onnx.part-abc123'), 'half');
    await utimes(join(root, 'onnx', 'model.onnx.part-abc123'), hourAgo, hourAgo);
    await writeFile(join(root, 'tokenizer.json.part-live99'), 'in progress');
    const logs: string[] = [];
    await ensureWeights(profile(), dir, { fetch: fakeHub().fetch, log: (m) => logs.push(m) });
    expect((await listFiles(root)).filter((f) => f.includes('.part-'))).toEqual(['tokenizer.json.part-live99']);
    expect(logs).toContain('removed stale temporary weight files');
  });

  it('passes over a temporary that is gone by the time it is looked at', async () => {
    const root = profileRoot(profile(), dir);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'config.json.part-placed'), 'done');
    const real = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    vi.mocked(fsp.lstat).mockImplementation((async (path: string) => {
      if (String(path).endsWith('.part-placed')) throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
      return real.lstat(path);
    }) as typeof fsp.lstat);
    await expect(removeStaleTemporaries(profile(), dir)).resolves.toBe(0);
    expect(fsp.lstat).toHaveBeenCalledWith(join(root, 'config.json.part-placed'));
  });

  it('waits while another process holds the lock on a file, and takes the file it placed without fetching it', async () => {
    const root = profileRoot(profile(), dir);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'config.json.lock'), '{"pid":1}');
    const hub = fakeHub();
    const logs: string[] = [];
    const run = ensureWeights(profile(['config.json']), dir, { fetch: hub.fetch, lockPollMs: 5, log: (m) => logs.push(m) });
    await new Promise((r) => setTimeout(r, 30));
    // The other process finishes: the file is in place and its lock gone.
    await writeFile(join(root, 'config.json'), CONTENT['config.json']);
    await rm(join(root, 'config.json.lock'));
    await run;
    expect(hub.calls).toEqual([]);
    expect(logs).toContain('waiting for another process to place a weight file');
  });

  it('takes over a lock left by a process that died', async () => {
    const root = profileRoot(profile(), dir);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'config.json.lock'), '{"pid":1}');
    const tenMinutesAgo = (Date.now() - 10 * 60_000) / 1000;
    await utimes(join(root, 'config.json.lock'), tenMinutesAgo, tenMinutesAgo);
    const hub = fakeHub();
    await ensureWeights(profile(['config.json']), dir, { fetch: hub.fetch, lockPollMs: 5 });
    expect(hub.calls).toHaveLength(1);
    expect(await listFiles(root)).toEqual(['config.json']);
  });

  it('fails on a stale lock it may not remove, instead of trying again at once', async () => {
    const root = profileRoot(profile(), dir);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'config.json.lock'), '{"pid":1}');
    const tenMinutesAgo = (Date.now() - 10 * 60_000) / 1000;
    await utimes(join(root, 'config.json.lock'), tenMinutesAgo, tenMinutesAgo);
    await chmod(root, 0o555);
    try {
      const hub = fakeHub();
      await expect(ensureWeights(profile(['config.json']), dir, { fetch: hub.fetch, lockPollMs: 5 })).rejects.toMatchObject({ code: 'EACCES' });
      expect(hub.calls).toEqual([]);
    } finally {
      await chmod(root, 0o755);
    }
  });

  it('closes and removes a lock it could not write, and fails', async () => {
    const real = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    const closed: string[] = [];
    vi.mocked(fsp.open).mockImplementation((async (path: string, flags?: string) => {
      const handle = await real.open(path, flags);
      if (!String(path).endsWith('.lock')) return handle;
      const close = handle.close.bind(handle);
      return Object.assign(handle, {
        writeFile: async () => {
          throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
        },
        close: async () => {
          closed.push(String(path));
          return close();
        },
      });
    }) as typeof fsp.open);
    const hub = fakeHub();
    await expect(ensureWeights(profile(['config.json']), dir, { fetch: hub.fetch })).rejects.toMatchObject({ code: 'ENOSPC' });
    const lock = join(profileRoot(profile(), dir), 'config.json.lock');
    expect(closed).toEqual([lock]);
    expect(existsSync(lock)).toBe(false);
    expect(hub.calls).toEqual([]);
  });

  it('releases its lock after a download, and after a failed one', async () => {
    const root = profileRoot(profile(), dir);
    await ensureWeights(profile(['config.json']), dir, { fetch: fakeHub().fetch });
    expect(existsSync(join(root, 'config.json.lock'))).toBe(false);
    await expect(ensureWeights(profile(['tokenizer.json']), dir, { fetch: fakeHub({ fail: true }).fetch })).rejects.toThrow(/network down/);
    expect(existsSync(join(root, 'tokenizer.json.lock'))).toBe(false);
  });

  it('follows a redirect to an HTTPS CDN and sends the token only to the hub', async () => {
    const hub = fakeHub({ cdn: 'https://cdn.example' });
    await ensureWeights(profile(['config.json']), dir, { fetch: hub.fetch, token: 'hf_secret' });
    expect(hub.calls).toHaveLength(2);
    expect(new URL(hub.calls[0].url).origin).toBe('https://hub.example');
    expect(hub.calls[0].headers.Authorization).toBe('Bearer hf_secret');
    expect(new URL(hub.calls[1].url).origin).toBe('https://cdn.example');
    expect(hub.calls[1].headers.Authorization).toBeUndefined();
  });

  it('aborts the request of a redirect, whose body it does not read, and not the one it downloads', async () => {
    const hub = fakeHub({ cdn: 'https://cdn.example' });
    const signals: Array<[string, AbortSignal]> = [];
    const fetch: FetchLike = (url, init) => {
      signals.push([new URL(url).origin, init.signal]);
      return hub.fetch(url, init);
    };
    await ensureWeights(profile(['config.json']), dir, { fetch });
    expect(signals.map(([origin, signal]) => [origin, signal.aborted])).toEqual([
      ['https://hub.example', true],
      ['https://cdn.example', false],
    ]);
  });

  it('refuses a redirect off HTTPS', async () => {
    const hub = fakeHub({ cdn: 'http://cdn.example' });
    await expect(ensureWeights(profile(['config.json']), dir, { fetch: hub.fetch })).rejects.toThrow(/left HTTPS/);
  });

  it('refuses an endless redirect loop', async () => {
    const fetch: FetchLike = async (url) => ({ status: 302, headers: { get: () => url }, body: null });
    await expect(ensureWeights(profile(['config.json']), dir, { fetch })).rejects.toThrow(/more than 5 redirects/);
  });

  it('never logs a URL or a header', async () => {
    const logs: string[] = [];
    const hub = fakeHub({ cdn: 'https://cdn.example' });
    await ensureWeights(profile(), dir, { fetch: hub.fetch, token: 'hf_secret', log: (m, d) => logs.push(`${m} ${JSON.stringify(d)}`) });
    expect(logs.join('\n')).not.toMatch(/https?:|sig=|hf_secret|Bearer/);
  });

  it('refuses a symbolic link on the path below the models directory', async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), 'embedder-elsewhere-'));
    try {
      await mkdir(join(dir, 'org'), { recursive: true });
      await symlink(elsewhere, join(dir, 'org', 'tiny'));
      await expect(ensureWeights(profile(), dir, { fetch: fakeHub().fetch })).rejects.toThrow(WeightFileError);
      expect(await listFiles(elsewhere)).toEqual([]);
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it('accepts a models directory that is itself a symbolic link', async () => {
    const real = await mkdtemp(join(tmpdir(), 'embedder-real-'));
    const link = join(dir, 'models');
    try {
      await symlink(real, link);
      await ensureWeights(profile(), link, { fetch: fakeHub().fetch });
      await expect(verifyWeights(profile(), link)).resolves.toBeUndefined();
    } finally {
      await rm(real, { recursive: true, force: true });
    }
  });
});

const never = <T>() => new Promise<T>(() => undefined);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A 200 response whose body yields the file in pieces, waiting `gaps[i]` ms before piece i; `Infinity` never yields it. */
const pieces = (path: string, gaps: number[]) => {
  const text = CONTENT[path];
  const size = Math.ceil(text.length / gaps.length);
  return {
    status: 200,
    headers: { get: () => null },
    body: (async function* () {
      for (let i = 0; i < gaps.length; i++) {
        if (gaps[i] === Infinity) await never();
        else await sleep(gaps[i]);
        yield Buffer.from(text.slice(i * size, (i + 1) * size));
      }
    })(),
  };
};

describe('download timeouts', () => {

  it('fails a request that does not answer within the connect timeout, aborts it, and leaves nothing behind', async () => {
    const signals: AbortSignal[] = [];
    const fetch: FetchLike = (_url, init) => {
      signals.push(init.signal);
      return never();
    };
    const root = profileRoot(profile(), dir);
    await expect(ensureWeights(profile(['config.json']), dir, { fetch, connectTimeoutMs: 30 })).rejects.toThrow(
      'config.json: no response within 0 s',
    );
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(true);
    expect(await listFiles(root).catch(() => [])).toEqual([]);
  });

  it('bounds every redirect hop, not only the first', async () => {
    const hub = fakeHub({ cdn: 'https://cdn.example' });
    const fetch: FetchLike = (url, init) => (new URL(url).host === 'cdn.example' ? never() : hub.fetch(url, init));
    await expect(ensureWeights(profile(['config.json']), dir, { fetch, connectTimeoutMs: 30 })).rejects.toThrow(/no response within/);
  });

  it('fails a body that sends nothing for the idle timeout, and leaves no temporary or final file', async () => {
    let signal: AbortSignal | undefined;
    const fetch: FetchLike = async (_url, init) => {
      signal = init.signal;
      return pieces('config.json', [0, Infinity]);
    };
    const root = profileRoot(profile(), dir);
    await expect(ensureWeights(profile(['config.json']), dir, { fetch, idleTimeoutMs: 30 })).rejects.toThrow(
      'config.json: no data for 0 s',
    );
    expect(signal?.aborted).toBe(true);
    expect(await listFiles(root)).toEqual([]);
  });

  it('lets a slow body finish that keeps sending within the idle timeout, however long it takes in all', async () => {
    const fetch: FetchLike = async () => pieces('config.json', [20, 20, 20, 20, 20]);
    await ensureWeights(profile(['config.json']), dir, { fetch, idleTimeoutMs: 60 });
    expect(await readFile(join(profileRoot(profile(), dir), 'config.json'), 'utf-8')).toBe(CONTENT['config.json']);
  });

  it('retries a stalled download on the retry schedule, which then succeeds', async () => {
    let n = 0;
    const ok = fakeHub();
    const fetch: FetchLike = async (url, init) => (n++ === 0 ? pieces('config.json', [Infinity]) : ok.fetch(url, init));
    const slept: number[] = [];
    await ensureWeightsWithRetry(profile(['config.json']), dir, {
      fetch,
      idleTimeoutMs: 30,
      delaysMs: [1, 2],
      sleep: async (ms) => void slept.push(ms),
    });
    expect(slept).toEqual([1]);
    expect(existsSync(join(profileRoot(profile(), dir), 'config.json.lock'))).toBe(false);
  });
});

describe('the lock on a target file', () => {
  const lockOf = (path: string) => join(profileRoot(profile(), dir), `${path}.lock`);
  const tokenIn = async (lock: string) => JSON.parse(await readFile(lock, 'utf-8')).token as string;

  it('is refreshed while a download runs', async () => {
    const lock = lockOf('config.json');
    let refreshed = 0;
    const fetch: FetchLike = async () => {
      const response = pieces('config.json', [0, 20, 20]);
      const body = response.body;
      return {
        ...response,
        body: (async function* () {
          for await (const chunk of body) {
            // Each piece is written and the lock refreshed before the body is asked for the next one.
            await utimes(lock, T_PAST, T_PAST);
            yield chunk;
            if ((await stat(lock)).mtimeMs > T_PAST * 1000) refreshed++;
          }
        })(),
      };
    };
    await ensureWeights(profile(['config.json']), dir, { fetch, lockTouchMs: 1 });
    expect(refreshed).toBeGreaterThanOrEqual(2);
  });

  it('fails a download whose lock another process took over, and leaves that process its lock', async () => {
    const lock = lockOf('config.json');
    const fetch: FetchLike = async () => {
      const response = pieces('config.json', [0, 20]);
      const body = response.body;
      return {
        ...response,
        body: (async function* () {
          let first = true;
          for await (const chunk of body) {
            if (first) await writeFile(lock, JSON.stringify({ pid: 2, token: 'other' }));
            first = false;
            yield chunk;
          }
        })(),
      };
    };
    await expect(ensureWeights(profile(['config.json']), dir, { fetch, lockTouchMs: 1 })).rejects.toThrow(
      'config.json: another process took over its lock',
    );
    expect(await tokenIn(lock)).toBe('other');
    expect(existsSync(join(profileRoot(profile(), dir), 'config.json'))).toBe(false);
  });

  it('takes a stale lock as gone when another process sweeps it away after it was moved aside', async () => {
    const root = profileRoot(profile(), dir);
    const lock = lockOf('config.json');
    await mkdir(root, { recursive: true });
    await writeFile(lock, JSON.stringify({ pid: 1, token: 'dead' }));
    await utimes(lock, T_PAST, T_PAST);
    const real = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    let swept = 0;
    vi.mocked(fsp.lstat).mockImplementation((async (path: string) => {
      if (String(path).startsWith(`${lock}.part-`)) {
        // The other process's sweep removes the moved-aside lock just before it is looked at.
        await real.unlink(path);
        swept++;
      }
      return real.lstat(path);
    }) as typeof fsp.lstat);
    const hub = fakeHub();
    await ensureWeights(profile(['config.json']), dir, { fetch: hub.fetch, lockPollMs: 5 });
    expect(swept).toBe(1);
    expect(hub.calls).toHaveLength(1);
    expect(await listFiles(root)).toEqual(['config.json']);
  });

  it('does not place its file once its lock was taken over, even after the last refresh', async () => {
    const root = profileRoot(profile(), dir);
    const lock = lockOf('config.json');
    const fetch: FetchLike = async () => {
      const response = pieces('config.json', [0]);
      const body = response.body;
      return {
        ...response,
        body: (async function* () {
          yield* body;
          // Taken over after the last piece; the default refresh interval has not come round.
          await writeFile(lock, JSON.stringify({ pid: 2, token: 'other' }));
        })(),
      };
    };
    await expect(ensureWeights(profile(['config.json']), dir, { fetch })).rejects.toThrow('config.json: another process took over its lock');
    expect(await listFiles(root)).toEqual(['config.json.lock']);
    expect(await tokenIn(lock)).toBe('other');
  });

  it('keeps a wrong file in place until the verified one replaces it', async () => {
    const root = profileRoot(profile(), dir);
    const target = join(root, 'config.json');
    await mkdir(root, { recursive: true });
    const wrong = 'X'.repeat(Buffer.byteLength(CONTENT['config.json']));
    await writeFile(target, wrong);
    const during: string[] = [];
    const fetch: FetchLike = async () => {
      const response = pieces('config.json', [0, 0]);
      const body = response.body;
      return {
        ...response,
        body: (async function* () {
          for await (const chunk of body) {
            during.push(await readFile(target, 'utf-8'));
            yield chunk;
          }
        })(),
      };
    };
    await ensureWeights(profile(['config.json']), dir, { fetch });
    expect(during).toEqual([wrong, wrong]);
    expect(await readFile(target, 'utf-8')).toBe(CONTENT['config.json']);
  });

  it('puts back a fresh lock another waiter created after the stale one was seen, and waits for it', async () => {
    const root = profileRoot(profile(), dir);
    const lock = lockOf('config.json');
    await mkdir(root, { recursive: true });
    await writeFile(lock, JSON.stringify({ pid: 1, token: 'dead' }));
    await utimes(lock, T_PAST, T_PAST);
    const hub = fakeHub();
    let probed = 0;
    const run = ensureWeights(profile(['config.json']), dir, {
      fetch: hub.fetch,
      lockPollMs: 5,
      // Between seeing the stale lock and taking it over, another waiter takes it over first.
      onStaleLock: async () => {
        if (probed++ > 0) return;
        await rm(lock);
        await writeFile(lock, JSON.stringify({ pid: 2, token: 'other' }));
      },
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(probed).toBe(1);
    expect(await tokenIn(lock)).toBe('other');
    expect(hub.calls).toEqual([]);
    // The other waiter places the file and releases its lock.
    await writeFile(join(root, 'config.json'), CONTENT['config.json']);
    await rm(lock);
    await run;
    expect(hub.calls).toEqual([]);
    expect(await listFiles(root)).toEqual(['config.json']);
  });
});

describe('verifyWeights', () => {
  it('names the first missing or wrong file', async () => {
    await expect(verifyWeights(profile(), dir)).rejects.toThrow(/config\.json: missing or does not match/);
  });

  /** How many times a file was read to be hashed. */
  const reads = (path: string) => vi.mocked(createReadStream).mock.calls.filter(([p]) => String(p) === path).length;
  /** A whole-second mtime, which utimes can put back exactly. */
  const T = 1_800_000_000;
  /** Lets the clock move on, so a ctime set now differs from one set just before. */
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const placed = async () => {
    await ensureWeights(profile(), dir, { fetch: fakeHub().fetch });
    return join(profileRoot(profile(), dir), 'onnx', 'model.onnx');
  };

  it('does not read again a file this process verified and that still has the same stat', async () => {
    const target = await placed();
    // A download is hashed as it streams in, so loading it next reads nothing.
    await verifyWeights(profile(), dir);
    expect(reads(target)).toBe(0);
    forgetVerifiedFiles();
    await verifyWeights(profile(), dir);
    await verifyWeights(profile(), dir);
    expect(reads(target)).toBe(1);
  });

  it('reads again a file whose mtime changed since it was verified', async () => {
    await ensureWeights(profile(), dir, { fetch: fakeHub().fetch });
    const target = join(profileRoot(profile(), dir), 'config.json');
    await writeFile(target, 'X'.repeat(Buffer.byteLength(CONTENT['config.json'])));
    await utimes(target, new Date(), new Date(Date.now() + 5_000));
    await expect(verifyWeights(profile(), dir)).rejects.toThrow(/config\.json: missing or does not match/);
  });

  it('reads again a file whose ctime alone changed, so a rewrite with its mtime set back is caught', async () => {
    const target = await placed();
    await utimes(target, T, T);
    await verifyWeights(profile(), dir);
    const before = reads(target);
    await tick();
    await utimes(target, T, T);
    await verifyWeights(profile(), dir);
    expect(reads(target)).toBe(before + 1);

    await tick();
    await writeFile(target, 'X'.repeat(Buffer.byteLength(CONTENT['onnx/model.onnx'])));
    await utimes(target, T, T);
    await expect(verifyWeights(profile(), dir)).rejects.toThrow(/onnx\/model\.onnx: missing or does not match/);
  });

  it('reads again a file replaced by another inode with the same bytes and mtime', async () => {
    const target = await placed();
    await utimes(target, T, T);
    await verifyWeights(profile(), dir);
    const before = reads(target);
    const ino = (await stat(target)).ino;
    await writeFile(`${target}.new`, CONTENT['onnx/model.onnx']);
    await utimes(`${target}.new`, T, T);
    await rename(`${target}.new`, target);
    expect((await stat(target)).ino).not.toBe(ino);
    await verifyWeights(profile(), dir);
    expect(reads(target)).toBe(before + 1);
  });

  it('records a file placed by hand once it has been hashed, so the next check reads it no more', async () => {
    const root = profileRoot(profile(), dir);
    for (const [path, body] of Object.entries(CONTENT)) {
      await mkdir(join(root, path, '..'), { recursive: true });
      await writeFile(join(root, path), body);
    }
    await verifyWeights(profile(), dir);
    await verifyWeights(profile(), dir);
    for (const path of Object.keys(CONTENT)) expect(reads(join(root, path))).toBe(1);
  });
});

describe('ensureWeightsWithRetry', () => {
  it('retries once per delay and then gives up with the last error', async () => {
    const hub = fakeHub({ fail: true });
    const slept: number[] = [];
    await expect(
      ensureWeightsWithRetry(profile(['config.json']), dir, { fetch: hub.fetch, delaysMs: [1, 2], sleep: async (ms) => void slept.push(ms) }),
    ).rejects.toThrow(/network down/);
    expect(slept).toEqual([1, 2]);
    expect(hub.calls).toHaveLength(3);
  });

  it('stops retrying once an attempt succeeds', async () => {
    let n = 0;
    const ok = fakeHub();
    const fetch: FetchLike = async (url, init) => {
      if (n++ === 0) throw new Error('flaky');
      return ok.fetch(url, init);
    };
    const slept: number[] = [];
    await ensureWeightsWithRetry(profile(['config.json']), dir, { fetch, delaysMs: [1, 2], sleep: async (ms) => void slept.push(ms) });
    expect(slept).toEqual([1]);
  });
});
