/**
 * Weight acquisition against a fake hub: only listed files are fetched, each is verified before it
 * takes its final name, redirects stay on HTTPS, the token goes only to the hub, and paths cannot
 * leave the models directory.
 */

import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { EmbeddingProfile } from '@dethernety/dt-module/embedding';

import {
  ensureWeights,
  ensureWeightsWithRetry,
  profileRoot,
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
});
afterEach(async () => {
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

  it('removes stale temporaries at start', async () => {
    const root = profileRoot(profile(), dir);
    await mkdir(join(root, 'onnx'), { recursive: true });
    await writeFile(join(root, 'onnx', 'model.onnx.part-abc123'), 'half');
    const logs: string[] = [];
    await ensureWeights(profile(), dir, { fetch: fakeHub().fetch, log: (m) => logs.push(m) });
    expect((await listFiles(root)).filter((f) => f.includes('.part-'))).toEqual([]);
    expect(logs).toContain('removed stale temporary weight files');
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

describe('verifyWeights', () => {
  it('names the first missing or wrong file', async () => {
    await expect(verifyWeights(profile(), dir)).rejects.toThrow(/config\.json: missing or does not match/);
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
