import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// Import directly from source rather than the package barrel — the barrel
// re-exports dt-lg-module which transitively loads ESM-only langgraph-sdk
// dependencies that jest's default CJS transform cannot handle. These
// helpers have no such transitive deps, so a direct source import is safe.
import { EmbeddingFileCache } from '../../../../../../packages/dt-module/src/embedding-file-cache';
import {
  composeClassText,
  composeElementText,
  parseEmbeddingResponse,
  slugifyModelName,
} from '../../../../../../packages/dt-module/src/embedding-text';

describe('embedding-text helpers', () => {
  describe('composeClassText', () => {
    it('pins the canonical format', () => {
      const text = composeClassText({
        name: 'PostgreSQL database',
        description: 'Relational datastore',
        category: 'Storage',
        type: 'STORE',
      });
      expect(text).toBe(
        'PostgreSQL database. Relational datastore. Category: Storage. Type: STORE.',
      );
    });

    it('fills defaults for missing fields', () => {
      expect(composeClassText({ name: 'X' })).toBe(
        'X. . Category: General. Type: Unknown.',
      );
    });
  });

  describe('composeElementText', () => {
    it('composes element text', () => {
      expect(composeElementText({ name: 'UserAuth', description: 'handles auth', type: 'PROCESS' })).toBe(
        'UserAuth. handles auth. Type: PROCESS.',
      );
    });
  });

  describe('parseEmbeddingResponse', () => {
    it('parses OpenAI format', () => {
      const vectors = parseEmbeddingResponse(
        { data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }] },
        2,
      );
      expect(vectors).toEqual([
        [0.1, 0.2],
        [0.3, 0.4],
      ]);
    });

    it('parses Ollama /api/embed format', () => {
      const vectors = parseEmbeddingResponse(
        { embeddings: [[1, 2], [3, 4]] },
        2,
      );
      expect(vectors).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });

    it('parses Ollama legacy single-embedding format', () => {
      expect(parseEmbeddingResponse({ embedding: [9, 8, 7] }, 1)).toEqual([[9, 8, 7]]);
    });

    it('throws on unknown format', () => {
      expect(() => parseEmbeddingResponse({ foo: 'bar' }, 1)).toThrow(/Unexpected embedding API response/);
    });
  });

  describe('slugifyModelName', () => {
    it('replaces slashes and whitespace', () => {
      expect(slugifyModelName('sentence-transformers/all-MiniLM-L6-v2')).toBe(
        'sentence-transformers-all-MiniLM-L6-v2',
      );
      expect(slugifyModelName('foo bar\\baz')).toBe('foo-bar-baz');
    });

    it('leaves safe names untouched', () => {
      expect(slugifyModelName('nomic-embed-text')).toBe('nomic-embed-text');
    });
  });
});

describe('EmbeddingFileCache', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-cache-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeClass(
    classTypeDir: string,
    classDirName: string,
    defFile: 'class.json' | 'metadata.json',
    className: string,
    vectorFile?: { model: string; body: string },
  ) {
    const classDir = path.join(tmpDir, classTypeDir, classDirName);
    fs.mkdirSync(classDir, { recursive: true });
    fs.writeFileSync(path.join(classDir, defFile), JSON.stringify({ name: className }));
    if (vectorFile) {
      const embDir = path.join(classDir, 'embeddings');
      fs.mkdirSync(embDir, { recursive: true });
      fs.writeFileSync(path.join(embDir, `${vectorFile.model}.json`), vectorFile.body);
    }
  }

  function v2Cache() {
    return new EmbeddingFileCache({
      moduleDataDir: tmpDir,
      classTypeDirs: ['component', 'dataFlow', 'securityBoundary', 'control', 'data'],
      classDefinitionFile: 'class.json',
    });
  }

  it('returns the vector when present (V2/OPA layout)', () => {
    writeClass('component', 'postgresql-database', 'class.json', 'PostgreSQL database', {
      model: 'nomic-embed-text',
      body: JSON.stringify([0.1, 0.2, 0.3]),
    });
    const cache = v2Cache();
    expect(cache.get('PostgreSQL database', 'nomic-embed-text')).toEqual([0.1, 0.2, 0.3]);
  });

  it('returns null when the model file is missing', () => {
    writeClass('component', 'postgresql-database', 'class.json', 'PostgreSQL database');
    expect(v2Cache().get('PostgreSQL database', 'nomic-embed-text')).toBeNull();
  });

  it('returns null for unknown class names', () => {
    writeClass('component', 'postgresql-database', 'class.json', 'PostgreSQL database', {
      model: 'nomic-embed-text',
      body: JSON.stringify([0.1]),
    });
    expect(v2Cache().get('Mystery class', 'nomic-embed-text')).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    writeClass('component', 'x', 'class.json', 'X', { model: 'm', body: '{not valid' });
    expect(v2Cache().get('X', 'm')).toBeNull();
  });

  it('rejects non-array top level', () => {
    writeClass('component', 'x', 'class.json', 'X', {
      model: 'm',
      body: JSON.stringify({ embedding: [0.1] }),
    });
    expect(v2Cache().get('X', 'm')).toBeNull();
  });

  it('rejects non-finite or non-numeric entries', () => {
    writeClass('component', 'x', 'class.json', 'X', {
      model: 'm',
      body: JSON.stringify([0.1, 'bad', 0.3]),
    });
    expect(v2Cache().get('X', 'm')).toBeNull();
  });

  it('rejects oversized vectors', () => {
    writeClass('component', 'x', 'class.json', 'X', {
      model: 'm',
      body: JSON.stringify(new Array(9000).fill(0.1)),
    });
    expect(v2Cache().get('X', 'm')).toBeNull();
  });

  it('caches loaded model files — second lookup does not re-read disk', () => {
    writeClass('component', 'x', 'class.json', 'X', {
      model: 'nomic-embed-text',
      body: JSON.stringify([0.1]),
    });
    const cache = v2Cache();
    expect(cache.get('X', 'nomic-embed-text')).toEqual([0.1]);

    // Mutate the underlying file; cache should still return the original.
    const vectorPath = path.join(
      tmpDir,
      'component',
      'x',
      'embeddings',
      'nomic-embed-text.json',
    );
    fs.writeFileSync(vectorPath, JSON.stringify([9.9]));
    expect(cache.get('X', 'nomic-embed-text')).toEqual([0.1]);
  });

  it('walks JSON layout (PascalCase + metadata.json)', () => {
    writeClass('ComponentClasses', 'user-auth', 'metadata.json', 'UserAuth', {
      model: 'nomic-embed-text',
      body: JSON.stringify([1, 2, 3]),
    });
    const cache = new EmbeddingFileCache({
      moduleDataDir: tmpDir,
      classTypeDirs: [
        'ComponentClasses',
        'DataFlowClasses',
        'SecurityBoundaryClasses',
        'ControlClasses',
        'DataClasses',
      ],
      classDefinitionFile: 'metadata.json',
    });
    expect(cache.get('UserAuth', 'nomic-embed-text')).toEqual([1, 2, 3]);
  });

  it('looks up by slugified model name — "org/name" resolves to "org-name.json"', () => {
    writeClass('component', 'x', 'class.json', 'X', {
      model: 'sentence-transformers-all-MiniLM-L6-v2',
      body: JSON.stringify([0.5]),
    });
    expect(
      v2Cache().get('X', 'sentence-transformers/all-MiniLM-L6-v2'),
    ).toEqual([0.5]);
  });

  it('returns null when the embedding model is empty', () => {
    writeClass('component', 'x', 'class.json', 'X', { model: 'm', body: JSON.stringify([0.1]) });
    expect(v2Cache().get('X', '')).toBeNull();
  });

  it('ignores class directories without a class-definition file', () => {
    const dir = path.join(tmpDir, 'component', 'orphan');
    fs.mkdirSync(path.join(dir, 'embeddings'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'embeddings', 'm.json'), JSON.stringify([0.1]));
    // No class.json written — entry must be ignored.
    expect(v2Cache().get('Orphan', 'm')).toBeNull();
  });

  it('returns null when the module data dir does not exist', () => {
    const cache = new EmbeddingFileCache({
      moduleDataDir: path.join(tmpDir, 'does-not-exist'),
      classTypeDirs: ['component'],
      classDefinitionFile: 'class.json',
    });
    expect(cache.get('X', 'm')).toBeNull();
  });

  it('never interpolates className into a path (security invariant)', () => {
    // A hostile className must not affect disk reads.
    writeClass('component', 'legit', 'class.json', '../../../etc/passwd', {
      model: 'm',
      body: JSON.stringify([0.1]),
    });
    const cache = v2Cache();
    // The vector is still reachable under its (hostile but controlled) key,
    // because the class directory on disk is 'legit' — className is only a Map key.
    expect(cache.get('../../../etc/passwd', 'm')).toEqual([0.1]);
    // And an entirely made-up traversal-style key finds nothing.
    expect(cache.get('../../../../etc/hosts', 'm')).toBeNull();
  });
});
