import { canonicalJson, computedContentHash } from '../module-content-hash';

const metadata = () => ({
  name: 'code-module',
  version: '1.0.0',
  analysisClasses: [{ id: 'a1', name: 'Report', type: 'model_analysis', description: 'One report', category: 'Reports' }],
});
const codeModule = {};
const EMBEDDER = 'embeddinggemma/768';
const PLATFORM = '0.11.0';

describe('computedContentHash — the hash of a module that ships none', () => {
  it('is a sha256 that does not depend on key order', () => {
    const a = computedContentHash(metadata(), codeModule, EMBEDDER, PLATFORM);
    const reordered = { analysisClasses: [{ category: 'Reports', description: 'One report', type: 'model_analysis', name: 'Report', id: 'a1' }], version: '1.0.0', name: 'code-module' };
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(computedContentHash(reordered, codeModule, EMBEDDER, PLATFORM)).toBe(a);
  });

  it.each([
    ['a class description', (m: any) => (m.analysisClasses[0].description = 'Another report')],
    ['a class id', (m: any) => (m.analysisClasses[0].id = 'a2')],
    ['an added class', (m: any) => m.analysisClasses.push({ id: 'a2', name: 'Sheet', type: 'model_analysis' })],
    ['the module version', (m: any) => (m.version = '1.0.1')],
    ['the rebind policy', (m: any) => (m.idRebindPolicy = 'strict')],
  ])('changes with %s', (_what, change) => {
    const changed = metadata();
    change(changed);
    expect(computedContentHash(changed, codeModule, EMBEDDER, PLATFORM)).not.toBe(computedContentHash(metadata(), codeModule, EMBEDDER, PLATFORM));
  });

  it('changes with the embedder that makes the class vectors, an input that is not in the metadata', () => {
    const base = computedContentHash(metadata(), codeModule, EMBEDDER, PLATFORM);
    expect(computedContentHash(metadata(), codeModule, 'nomic-embed-text/768', PLATFORM)).not.toBe(base);
    expect(computedContentHash(metadata(), codeModule, 'embeddinggemma/384', PLATFORM)).not.toBe(base);
    expect(computedContentHash(metadata(), codeModule, 'off', PLATFORM)).not.toBe(base);
  });

  it('changes with the platform version, whose install code writes the metadata', () => {
    expect(computedContentHash(metadata(), codeModule, EMBEDDER, '0.11.1')).not.toBe(computedContentHash(metadata(), codeModule, EMBEDDER, PLATFORM));
  });

  it('ignores a contentHash field in the metadata', () => {
    expect(computedContentHash({ ...metadata(), contentHash: 'sha256:x' }, codeModule, EMBEDDER, PLATFORM)).toBe(
      computedContentHash(metadata(), codeModule, EMBEDDER, PLATFORM),
    );
  });

  it('is null for a module that hands the install pre-computed vectors, which the metadata does not show', () => {
    expect(computedContentHash(metadata(), { getEmbedding: () => null }, EMBEDDER, PLATFORM)).toBeNull();
  });
});

describe('canonicalJson', () => {
  it('sorts keys at every depth and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
  });
});
