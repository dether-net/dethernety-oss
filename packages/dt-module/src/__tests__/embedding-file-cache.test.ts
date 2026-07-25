/**
 * EmbeddingFileCache — content-hash staleness binding, backward-compat, copy-on-get, norm-0.
 *
 * Uses a real temp dir (the established harness style) rather than mocking fs: the cache walks
 * a module-data tree of class.json + embeddings/{model}.json files.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { EmbeddingFileCache } from '../embedding-file-cache';
import { classEmbeddingText, hashEmbeddingText } from '../embedding-text';

const MODEL = 'test-model';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-fc-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Write a component class def + its vector file (bare array or {vector, contentHash}). */
function writeClass(
  slug: string,
  def: { name: string; description?: string; category?: string; type?: string },
  vectorBody: unknown,
): void {
  const classDir = path.join(root, 'component', slug);
  fs.mkdirSync(path.join(classDir, 'embeddings'), { recursive: true });
  fs.writeFileSync(path.join(classDir, 'class.json'), JSON.stringify(def));
  fs.writeFileSync(
    path.join(classDir, 'embeddings', `${MODEL}.json`),
    JSON.stringify(vectorBody),
  );
}

function makeCache(): EmbeddingFileCache {
  return new EmbeddingFileCache({
    moduleDataDir: root,
    classTypeDirs: ['component'],
    classDefinitionFile: 'class.json',
  });
}

const DEF = { name: 'App Server', description: 'runs the app', category: 'Compute', type: 'process' };
const hashFor = (d: typeof DEF) => hashEmbeddingText(classEmbeddingText(d, 'component'));

describe('EmbeddingFileCache — content-hash binding', () => {
  it('serves a wrapper vector whose content-hash matches the current class text', () => {
    writeClass('app', DEF, { vector: [0.1, 0.2, 0.3], contentHash: hashFor(DEF) });
    expect(makeCache().get('App Server', MODEL)).toEqual([0.1, 0.2, 0.3]);
  });

  it('treats a wrapper vector with a stale (mismatched) hash as a cache miss', () => {
    // Stamp a hash for the OLD description, then change the class description on disk.
    writeClass(
      'app',
      { ...DEF, description: 'stale old text' },
      { vector: [0.1, 0.2, 0.3], contentHash: hashFor({ ...DEF, description: 'stale old text' }) },
    );
    // Rewrite the class def with a new description — the stored hash no longer matches.
    fs.writeFileSync(
      path.join(root, 'component', 'app', 'class.json'),
      JSON.stringify({ ...DEF, description: 'brand new text' }),
    );
    expect(makeCache().get('App Server', MODEL)).toBeNull();
  });

  it('serves a legacy bare-array vector unchanged (no hash to verify)', () => {
    writeClass('app', DEF, [0.4, 0.5, 0.6]);
    expect(makeCache().get('App Server', MODEL)).toEqual([0.4, 0.5, 0.6]);
  });

  it('rejects a wrapper file with a missing or malformed contentHash (corrupted, not legacy)', () => {
    // The writer always stamps a sha256 — a wrapper without a valid one is corrupted and
    // must be a miss, not silently downgraded to unverified serving.
    writeClass('a1', { ...DEF, name: 'A1' }, { vector: [0.1, 0.2], contentHash: '' });
    writeClass('a2', { ...DEF, name: 'A2' }, { vector: [0.1, 0.2], contentHash: 123 });
    writeClass('a3', { ...DEF, name: 'A3' }, { vector: [0.1, 0.2] });
    const cache = makeCache();
    expect(cache.get('A1', MODEL)).toBeNull();
    expect(cache.get('A2', MODEL)).toBeNull();
    expect(cache.get('A3', MODEL)).toBeNull();
  });

  it('does not permanently miss when a class field is non-string (writer/reader coerce alike)', () => {
    // The CLI writer feeds the RAW class.json into the composer; a non-string field (e.g. a
    // numeric category) is stringified. The reader must coerce identically, or the recomputed
    // hash diverges and the vector is rejected on every load.
    const rawDef: any = { name: 'App Server', description: 5, category: 7, type: 'process' };
    const hash = hashEmbeddingText(classEmbeddingText(rawDef, 'component'));
    writeClass('app', rawDef, { vector: [0.1, 0.2, 0.3], contentHash: hash });
    expect(makeCache().get('App Server', MODEL)).toEqual([0.1, 0.2, 0.3]);
  });
});

describe('EmbeddingFileCache — robustness', () => {
  it('returns a copy so an in-place mutation cannot corrupt the cache', () => {
    writeClass('app', DEF, [0.1, 0.2, 0.3]);
    const cache = makeCache();
    const first = cache.get('App Server', MODEL)!;
    first[0] = 999; // mutate the returned array
    expect(cache.get('App Server', MODEL)).toEqual([0.1, 0.2, 0.3]); // cache intact
  });

  it('rejects a zero-magnitude vector (would give degenerate cosine similarity)', () => {
    writeClass('app', DEF, [0, 0, 0]);
    expect(makeCache().get('App Server', MODEL)).toBeNull();
  });

  it('returns null (never throws) for a malformed vector file', () => {
    const classDir = path.join(root, 'component', 'app');
    fs.mkdirSync(path.join(classDir, 'embeddings'), { recursive: true });
    fs.writeFileSync(path.join(classDir, 'class.json'), JSON.stringify(DEF));
    fs.writeFileSync(path.join(classDir, 'embeddings', `${MODEL}.json`), '{ not valid json');
    expect(makeCache().get('App Server', MODEL)).toBeNull();
  });
});
