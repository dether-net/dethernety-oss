import { MatchClassesResolverService } from '../match-classes-resolver.service';

/**
 * reindexClassEmbeddings re-embeds every class with the active embedder and records that embedder on each Module
 * node whose classes all got a vector, as an install does, so the next start's skip gate does not reinstall those
 * modules only to embed them again. A module with a class left without a vector keeps its old record.
 */
const rec = (row: Record<string, unknown>) => ({ get: (k: string) => row[k] });

const ROWS: Record<string, Array<Record<string, unknown>>> = {
  ComponentClass: [
    { classId: 'c1', name: 'Web Server', description: null, category: null, type: 'PROCESS', moduleName: 'mod-a' },
    { classId: 'c2', name: 'Database', description: null, category: null, type: 'STORE', moduleName: 'mod-b' },
  ],
  ControlClass: [
    { classId: 'k1', name: 'Firewall', description: null, category: null, type: null, moduleName: 'mod-c' },
    { classId: 'k2', name: 'Logging', description: null, category: null, type: null, moduleName: 'mod-a' },
  ],
};

function makeService(embedBatch: (texts: string[]) => Promise<number[][] | null>) {
  const writes: Array<{ cypher: string; params: any }> = [];
  const session = {
    executeRead: async (cb: any) =>
      cb({
        run: async (cypher: string) => {
          const label = Object.keys(ROWS).find((l) => cypher.includes(`:${l}`));
          return { records: (label ? ROWS[label] : []).map(rec) };
        },
      }),
    executeWrite: async (cb: any) =>
      cb({
        run: async (cypher: string, params: any) => {
          writes.push({ cypher, params });
          return { records: [] };
        },
      }),
    close: async () => undefined,
  };
  const embedding = {
    isEnabled: () => true,
    getModel: () => 'embeddinggemma-300m-retrieval-v1',
    getDimensions: () => 2,
    composeClassText: (c: any) => c.name,
    embedBatch: jest.fn(embedBatch),
  };
  const svc = new MatchClassesResolverService(
    { session: () => session } as any,
    { get: () => 'neo4j' } as any,
    {} as any,
    {} as any,
    embedding as any,
    {} as any,
  );
  const stamps = () => writes.filter((w) => w.cypher.includes('SET m.embeddingProfile'));
  return { svc, stamps };
}

const reindex = (svc: MatchClassesResolverService) => (svc as any).executeReindexClassEmbeddings();

describe('reindexClassEmbeddings — the embedder recorded on the Module nodes', () => {
  it('records the active embedder on every module whose classes were all re-embedded', async () => {
    const { svc, stamps } = makeService(async (texts) => texts.map(() => [0.6, 0.8]));
    const result = await reindex(svc);
    expect(result.reindexedCount).toBe(4);
    expect(stamps()).toEqual([
      {
        cypher: expect.stringContaining('WHERE m.name IN $names'),
        params: { names: ['mod-a', 'mod-b', 'mod-c'], profile: 'embeddinggemma-300m-retrieval-v1/2' },
      },
    ]);
  });

  it('leaves out a module with a class whose vector could not be stored', async () => {
    const { svc, stamps } = makeService(async (texts) => texts.map((t) => (t === 'Database' ? [0.6] : [0.6, 0.8])));
    await reindex(svc);
    expect(stamps()[0].params.names).toEqual(['mod-a', 'mod-c']);
  });

  it('leaves out the modules of a label that got no vectors, and records nothing when no module is complete', async () => {
    const partial = makeService(async (texts) => (texts.includes('Firewall') ? null : texts.map(() => [0.6, 0.8])));
    await reindex(partial.svc);
    // mod-a has a component class (re-embedded) and a control class (not): it is left out too.
    expect(partial.stamps()[0].params.names).toEqual(['mod-b']);

    const none = makeService(async () => null);
    await reindex(none.svc);
    expect(none.stamps()).toEqual([]);
  });

  it('records nothing when the reindex fails', async () => {
    const { svc, stamps } = makeService(async () => {
      throw new Error('embedder down');
    });
    await expect(reindex(svc)).rejects.toThrow('embedder down');
    expect(stamps()).toEqual([]);
  });
});
