import { canonicalJson, computedContentHash, embedderFingerprint } from '../module-content-hash';

const metadata = () => ({
  name: 'code-module',
  version: '1.0.0',
  analysisClasses: [{ id: 'a1', name: 'Report', type: 'model_analysis', description: 'One report', category: 'Reports' }],
});
const codeModule = {};
const PLATFORM = '0.11.0';

describe('computedContentHash — the hash of a module that ships none', () => {
  it('is a sha256 that does not depend on key order', () => {
    const a = computedContentHash(metadata(), codeModule, PLATFORM);
    const reordered = { analysisClasses: [{ category: 'Reports', description: 'One report', type: 'model_analysis', name: 'Report', id: 'a1' }], version: '1.0.0', name: 'code-module' };
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(computedContentHash(reordered, codeModule, PLATFORM)).toBe(a);
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
    expect(computedContentHash(changed, codeModule, PLATFORM)).not.toBe(computedContentHash(metadata(), codeModule, PLATFORM));
  });


  it('changes with the platform version, whose install code writes the metadata', () => {
    expect(computedContentHash(metadata(), codeModule, '0.11.1')).not.toBe(computedContentHash(metadata(), codeModule, PLATFORM));
  });

  it('ignores a contentHash field in the metadata', () => {
    expect(computedContentHash({ ...metadata(), contentHash: 'sha256:x' }, codeModule, PLATFORM)).toBe(
      computedContentHash(metadata(), codeModule, PLATFORM),
    );
  });

  it('is null for a module that hands the install pre-computed vectors, which the metadata does not show', () => {
    expect(computedContentHash(metadata(), { getEmbedding: () => null }, PLATFORM)).toBeNull();
  });
});

describe('embedderFingerprint — the embedder an install stamps and the skip gate compares', () => {
  const embedder = (over: Partial<{ enabled: boolean; pending: boolean; model: string; dims: number }> = {}) => {
    const s = { enabled: true, pending: false, model: 'embeddinggemma', dims: 768, ...over };
    return { isEnabled: () => s.enabled, isPending: () => s.pending, getModel: () => s.model, getDimensions: () => s.dims };
  };

  it('is the model and dimensions while embedding is on, and off otherwise', () => {
    expect(embedderFingerprint(embedder())).toBe('embeddinggemma/768');
    expect(embedderFingerprint(embedder({ model: 'embeddinggemma-300m-retrieval-v1' }))).toBe('embeddinggemma-300m-retrieval-v1/768');
    expect(embedderFingerprint(embedder({ dims: 384 }))).toBe('embeddinggemma/384');
    expect(embedderFingerprint(embedder({ enabled: false }))).toBe('off');
  });

  it('counts a pending embedder as on, so it does not change while the model loads', () => {
    expect(embedderFingerprint(embedder({ enabled: false, pending: true }))).toBe('embeddinggemma/768');
  });
});

describe('canonicalJson', () => {
  it('sorts keys at every depth and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
  });
});
