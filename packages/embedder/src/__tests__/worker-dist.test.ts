/**
 * The built package's worker: `createWorkerEmbedder` from dist starts dist/worker.js by its default path, the worker
 * resolves its imports and loads, and a load that cannot verify the weights fails the start with the worker's reason.
 * And the document helper's command, bin/embed-documents.mjs, over dist.
 * Builds the package first (tsc -b), so it checks what the image ships.
 */

import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getProfile } from '@dethernety/dt-module/embedding';

import { createOnnxEmbedder } from '../embedder';

const ROOT = join(__dirname, '..', '..');

let emptyDir: string;

beforeAll(() => {
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-b', 'tsconfig.build.json'], { cwd: ROOT, stdio: 'pipe' });
  emptyDir = mkdtempSync(join(tmpdir(), 'embedder-worker-'));
}, 120_000);

afterAll(() => rmSync(emptyDir, { recursive: true, force: true }));

describe('dist/worker.js', () => {

  it('starts by its default path and reports a load that cannot verify the weights as the start failing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createWorkerEmbedder } = require(join(ROOT, 'dist', 'index.js')) as typeof import('../index');
    await expect(createWorkerEmbedder(getProfile('embeddinggemma-300m-retrieval-v1'), emptyDir, { loadTimeoutMs: 60_000 })).rejects.toThrow(/missing or does not match/);
  }, 90_000);

  it.skipIf(!process.env.EMBEDDER_TEST_MODEL_DIR)('gives the same vectors as the embedder on the calling thread (real weights)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createWorkerEmbedder } = require(join(ROOT, 'dist', 'index.js')) as typeof import('../index');
    const profile = getProfile('embeddinggemma-300m-retrieval-v1');
    const dir = process.env.EMBEDDER_TEST_MODEL_DIR!;
    const items = [{ text: 'OS credential dumping from LSASS memory', title: 'OS Credential Dumping' }, { text: 'Redis cache', title: 'Redis' }];
    const inWorker = await createWorkerEmbedder(profile, dir, { threads: 4 });
    const inThread = await createOnnxEmbedder(profile, dir, { threads: 4 });
    try {
      for (const kind of ['query', 'document'] as const) {
        const [a, b] = [await inWorker.embed(kind, items), await inThread.embed(kind, items)];
        a.forEach((v, i) => expect(v.reduce((s, x, d) => s + x * b[i][d], 0)).toBeGreaterThan(1 - 1e-6));
      }
    } finally {
      await inWorker.release();
      await inThread.release();
    }
  }, 180_000);
});

describe('bin/embed-documents.mjs', () => {
  const helper = (args: string[], input = '') =>
    spawnSync(process.execPath, [join(ROOT, 'bin', 'embed-documents.mjs'), ...args], { input, encoding: 'utf-8', timeout: 60_000 });

  it('runs over dist and ends a start whose weights do not verify, with nothing on stdout', () => {
    const r = helper(['--profile', 'embeddinggemma-300m-retrieval-v1', '--models-dir', emptyDir]);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('embed-documents: config.json: missing or does not match the profile\n');
  });

  it('exits 2 on a usage error', () => {
    const r = helper(['--profile', 'embeddinggemma-300m-retrieval-v1']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--models-dir is required\nusage: embed-documents/);
  });

  it.skipIf(!process.env.EMBEDDER_TEST_MODEL_DIR)('gives the vectors the embedder gives, as documents with titles (real weights)', async () => {
    const profile = getProfile('embeddinggemma-300m-retrieval-v1');
    const dir = process.env.EMBEDDER_TEST_MODEL_DIR!;
    const items = [{ text: 'OS Credential Dumping. Adversaries dump credentials.', title: 'OS Credential Dumping' }, { text: 'Redis cache', title: 'Redis' }];
    const r = helper(['--profile', profile.id, '--models-dir', dir, '--threads', '4'], `${JSON.stringify({ items })}\n`);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const [ready, reply] = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
    expect(ready).toMatchObject({ profile: profile.id, dimensions: 768, revision: profile.source!.revision });
    const direct = await createOnnxEmbedder(profile, dir, { threads: 4 });
    try {
      const want = await direct.embed('document', items);
      (reply.vectors as number[][]).forEach((v, i) => expect(v).toEqual(want[i]));
    } finally {
      await direct.release();
    }
  }, 180_000);
});
