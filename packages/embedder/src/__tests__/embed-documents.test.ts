/**
 * The document helper's protocol, with a fake embedder: the ready line, one reply per request in order, the items
 * embedded as documents with their titles, the session released at the end, and every failure ending the process with
 * a message and nothing more on stdout.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { getProfile, type EmbeddingProfile, type ProfileKind } from '@dethernety/dt-module/embedding';

import { verifyWeights } from '../acquire';
import type { EmbedItem, Embedder } from '../embedder';
import { parseHelperArgs, runEmbedDocuments, type HelperDeps } from '../embed-documents';

const EG1 = 'embeddinggemma-300m-retrieval-v1';
const BASE = ['--profile', EG1, '--models-dir', '/models'];

async function* linesOf(lines: string[]): AsyncIterable<string> {
  for (const line of lines) yield line;
}

function fakeEmbedder(embed?: (kind: ProfileKind, items: EmbedItem[]) => Promise<number[][]>) {
  const calls: Array<{ kind: ProfileKind; items: EmbedItem[] }> = [];
  const release = vi.fn(async () => undefined);
  const embedder: Embedder = {
    profileId: EG1,
    dimensions: 3,
    embed: async (kind, items) => {
      calls.push({ kind, items });
      return embed ? embed(kind, items) : items.map((it, i) => [it.text.length, i, calls.length]);
    },
    release,
  };
  return { embedder, calls, release };
}

function deps(embedder: Embedder, over: Partial<HelperDeps> = {}) {
  const d = {
    getProfile,
    verifyWeights: vi.fn(async () => undefined),
    ensureWeights: vi.fn(async () => undefined),
    open: vi.fn(async (_p: EmbeddingProfile, _dir: string, _o: unknown) => embedder),
    ...over,
  };
  return d;
}

async function run(argv: string[], input: string[], d: HelperDeps) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runEmbedDocuments(argv, { lines: linesOf(input), out: (l) => out.push(l), err: (m) => err.push(m) }, d);
  return { code, out, err: err.join('\n') };
}

describe('embed-documents', () => {
  it('says what embeds, answers each request in order as documents with titles, and releases at the end', async () => {
    const { embedder, calls, release } = fakeEmbedder();
    const d = deps(embedder);
    const r = await run(
      [...BASE, '--threads', '2'],
      [
        JSON.stringify({ items: [{ title: 'Phishing', text: 'Phishing. Sends mail.' }, { title: 'Valid Accounts', text: 'Valid Accounts.' }] }),
        '',
        JSON.stringify({ items: [{ title: 'Audit', text: 'Audit.' }] }),
      ],
      d,
    );
    expect(r.code).toBe(0);
    expect(r.err).toBe('');
    const profile = getProfile(EG1);
    expect(JSON.parse(r.out[0])).toEqual({
      profile: EG1,
      dimensions: 3,
      repo: profile.source!.repo,
      revision: profile.source!.revision,
      dtype: profile.runtime.dtype,
      documentTitle: 'name',
    });
    expect(r.out.slice(1).map((l) => JSON.parse(l))).toEqual([
      { vectors: [[21, 0, 1], [15, 1, 1]] },
      { vectors: [[6, 0, 2]] },
    ]);
    expect(calls).toEqual([
      { kind: 'document', items: [{ title: 'Phishing', text: 'Phishing. Sends mail.' }, { title: 'Valid Accounts', text: 'Valid Accounts.' }] },
      { kind: 'document', items: [{ title: 'Audit', text: 'Audit.' }] },
    ]);
    expect(d.verifyWeights).toHaveBeenCalledWith(profile, '/models');
    expect(d.ensureWeights).not.toHaveBeenCalled();
    expect(d.open).toHaveBeenCalledWith(profile, '/models', { threads: 2 });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('downloads the weights first with --download, instead of only verifying them', async () => {
    const { embedder } = fakeEmbedder();
    const d = deps(embedder);
    expect((await run([...BASE, '--download'], [], d)).code).toBe(0);
    expect(d.ensureWeights).toHaveBeenCalledTimes(1);
    expect(d.verifyWeights).not.toHaveBeenCalled();
  });

  it('passes an item without a title on without one', async () => {
    const { embedder, calls } = fakeEmbedder();
    await run(BASE, [JSON.stringify({ items: [{ text: 'a' }, { title: null, text: 'b' }] })], deps(embedder));
    expect(calls[0].items).toEqual([{ text: 'a' }, { text: 'b' }]);
  });

  it('refuses an unknown profile, naming the valid ids, before anything loads', async () => {
    const { embedder } = fakeEmbedder();
    const d = deps(embedder);
    const r = await run(['--profile', 'nope', '--models-dir', '/m'], [], d);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Unknown EMBEDDING_MODEL "nope"\. Valid profile ids: .*embeddinggemma-300m-retrieval-v1/);
    expect(r.out).toEqual([]);
    expect(d.open).not.toHaveBeenCalled();
  });

  it('refuses the legacy http profile as not an onnx one', async () => {
    const { embedder } = fakeEmbedder();
    const d = deps(embedder);
    const r = await run(['--profile', 'embeddinggemma', '--models-dir', '/m'], [], d);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/profile "embeddinggemma" is not an onnx profile/);
    expect(r.out).toEqual([]);
    expect(d.verifyWeights).not.toHaveBeenCalled();
  });

  it('refuses a profile whose engine is not onnx, even one that lists weights', async () => {
    const { embedder } = fakeEmbedder();
    const eg1 = getProfile(EG1);
    const httpWithWeights: EmbeddingProfile = { ...eg1, id: 'http-with-weights', runtime: { ...eg1.runtime, engine: 'http' } };
    const d = deps(embedder, { getProfile: () => httpWithWeights });
    const r = await run(BASE, [], d);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/profile "http-with-weights" is not an onnx profile/);
    expect(d.verifyWeights).not.toHaveBeenCalled();
  });

  describe('missing weights', () => {
    const empty = mkdtempSync(join(tmpdir(), 'embed-documents-'));
    afterAll(() => rmSync(empty, { recursive: true, force: true }));

    it('end the start without --download, naming the file', async () => {
      const { embedder } = fakeEmbedder();
      const d = deps(embedder, { verifyWeights });
      const r = await run(['--profile', EG1, '--models-dir', empty], [], d);
      expect(r.code).toBe(1);
      expect(r.err).toBe('config.json: missing or does not match the profile');
      expect(r.out).toEqual([]);
      expect(d.open).not.toHaveBeenCalled();
    });
  });

  it('ends on a malformed request line with a message and nothing more on stdout, and still releases', async () => {
    for (const bad of ['not json', '{"texts": []}', '{"items": [{"title": "t"}]}', '{"items": [{"text": "a", "title": 3}]}']) {
      const { embedder, release } = fakeEmbedder();
      const r = await run(BASE, [JSON.stringify({ items: [{ text: 'ok' }] }), bad, JSON.stringify({ items: [{ text: 'never' }] })], deps(embedder));
      expect(r.code).toBe(1);
      expect(r.out).toHaveLength(2);
      expect(r.err).not.toBe('');
      expect(release).toHaveBeenCalledTimes(1);
    }
  });

  it('ends when the embedder fails, or returns the wrong number of vectors', async () => {
    for (const embed of [
      async () => {
        throw new Error('session run failed');
      },
      async () => [[1, 2, 3]],
    ]) {
      const { embedder, release } = fakeEmbedder(embed);
      const r = await run(BASE, [JSON.stringify({ items: [{ text: 'a' }, { text: 'b' }] })], deps(embedder));
      expect(r.code).toBe(1);
      expect(r.out).toHaveLength(1);
      expect(r.err).toMatch(/session run failed|returned 1 vectors for 2 items/);
      expect(release).toHaveBeenCalledTimes(1);
    }
  });

  it('ends when the session cannot open, with nothing on stdout', async () => {
    const { embedder } = fakeEmbedder();
    const r = await run(BASE, [], deps(embedder, { open: async () => Promise.reject(new Error('bad graph')) }));
    expect(r).toMatchObject({ code: 1, out: [], err: 'bad graph' });
  });
});

describe('parseHelperArgs', () => {
  it('reads the flags', () => {
    expect(parseHelperArgs([...BASE, '--threads', '3', '--download'])).toEqual({ profile: EG1, modelsDir: '/models', threads: 3, download: true });
  });

  it.each([
    [['--models-dir', '/m'], /--profile is required/],
    [['--profile', EG1], /--models-dir is required/],
    [[...BASE, '--threads', '0'], /--threads must be a positive integer/],
    [[...BASE, '--threads', '2x'], /--threads must be a positive integer/],
    [[...BASE, '--threads'], /--threads needs a value/],
    [['--profile', '--models-dir', '/m'], /--profile needs a value/],
    [[...BASE, '--verbose'], /unknown argument "--verbose"/],
  ])('refuses %j', (argv, message) => {
    expect(() => parseHelperArgs(argv)).toThrow(message);
  });

  it('is a usage error (exit 2) with the usage line', async () => {
    const { embedder } = fakeEmbedder();
    const r = await run(['--profile', EG1], [], deps(embedder));
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/usage: embed-documents --profile <id> --models-dir <dir>/);
    expect(r.out).toEqual([]);
  });
});
