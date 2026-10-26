import { DropLegacyVectorIndexesService, LEGACY_VECTOR_INDEXES } from '../drop-legacy-vector-indexes.service';

/**
 * The bootstrap drop of the class vector indexes nothing reads any more: on
 * Memgraph only the ones the database reports are dropped, after the index and
 * constraint bootstrap has finished; MITRE indexes are never touched; Neo4j is
 * left alone; and no failure rejects the hook (main.ts exits on a rejected hook).
 */

function makeDb(opts: { engine?: 'memgraph' | 'neo4j' | Error; present?: string[]; showFails?: boolean; dropFails?: string[] }) {
  return {
    getEngineInfoStrict: jest.fn(async () => {
      if (opts.engine instanceof Error) throw opts.engine;
      return { engine: opts.engine ?? 'memgraph', edition: null, version: null };
    }),
    executeRead: jest.fn(async () => {
      if (opts.showFails) throw new Error('There is no procedure named vector_search.show_index_info');
      return { records: (opts.present ?? []).map((name) => ({ get: (key: string) => (key === 'index_name' ? name : undefined) })) };
    }),
    executeSchemaWrite: jest.fn(async (cypher: string) => {
      if ((opts.dropFails ?? []).some((name) => cypher.includes(name))) throw new Error('boom');
      return { records: [] };
    }),
  };
}

const done = { whenBootstrapped: async () => {} };

function make(db: ReturnType<typeof makeDb>, indexes: any = done, constraints: any = done) {
  const service = new DropLegacyVectorIndexesService(db as any, indexes, constraints);
  const logger = (service as any).logger;
  for (const level of ['log', 'warn', 'debug'] as const) jest.spyOn(logger, level).mockImplementation(() => {});
  return { service, logger };
}

async function run(db: ReturnType<typeof makeDb>) {
  await make(db).service.onApplicationBootstrap();
  return db.executeSchemaWrite.mock.calls.map(([c]) => String(c));
}

describe('DropLegacyVectorIndexesService', () => {
  it('drops exactly the legacy indexes Memgraph reports, auto-commit', async () => {
    const db = makeDb({ present: ['mitre_attack_technique_embeddings', 'component_class_embeddings', 'someone_elses_index'] });
    await expect(run(db)).resolves.toEqual(['DROP VECTOR INDEX component_class_embeddings']);
  });

  it('drops all five when all are present, never a MITRE index, and nothing when none is', async () => {
    expect(LEGACY_VECTOR_INDEXES.some((name) => name.startsWith('mitre_'))).toBe(false);
    await expect(run(makeDb({ present: [...LEGACY_VECTOR_INDEXES] }))).resolves.toHaveLength(5);
    await expect(run(makeDb({ present: [] }))).resolves.toEqual([]);
  });

  it('starts only after the index and constraint bootstrap has finished', async () => {
    const order: string[] = [];
    let finishIndexes!: () => void;
    const indexes = { whenBootstrapped: () => new Promise<void>((resolve) => (finishIndexes = () => { order.push('indexes'); resolve(); })) };
    const db = makeDb({ present: ['component_class_embeddings'] });
    db.executeRead.mockImplementation(async () => {
      order.push('show');
      return { records: [{ get: () => 'component_class_embeddings' }] };
    });
    const pending = make(db, indexes).service.onApplicationBootstrap();
    await new Promise((r) => setImmediate(r));
    expect(order).toEqual([]);
    finishIndexes();
    await pending;
    expect(order).toEqual(['indexes', 'show']);
  });

  it('waits for passes whose hooks start after its own (provider order does not matter)', async () => {
    const order: string[] = [];
    const indexesHook: { started?: Promise<void> } = {};
    const indexes = { whenBootstrapped: () => indexesHook.started ?? Promise.resolve() };
    const db = makeDb({ present: ['component_class_embeddings'] });
    db.executeRead.mockImplementation(async () => {
      order.push('show');
      return { records: [{ get: () => 'component_class_embeddings' }] };
    });
    // The drop hook is called first; the index hook starts in the same synchronous pass, after it.
    const pending = make(db, indexes).service.onApplicationBootstrap();
    indexesHook.started = new Promise<void>((resolve) => setTimeout(() => { order.push('indexes'); resolve(); }, 10));
    await pending;
    expect(order).toEqual(['indexes', 'show']);
  });

  it('leaves Neo4j alone without asking it for vector indexes', async () => {
    const db = makeDb({ engine: 'neo4j', present: [...LEGACY_VECTOR_INDEXES] });
    await expect(run(db)).resolves.toEqual([]);
    expect(db.executeRead).not.toHaveBeenCalled();
  });

  it('does nothing, and does not reject, when the engine cannot be determined', async () => {
    const db = makeDb({ engine: new Error('db unreachable'), present: [...LEGACY_VECTOR_INDEXES] });
    await expect(run(db)).resolves.toEqual([]);
  });

  it('treats a database without vector_search as having nothing to drop, quietly', async () => {
    const db = makeDb({ showFails: true });
    const { service, logger } = make(db);
    await service.onApplicationBootstrap();
    expect(db.executeSchemaWrite).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns when the listing fails for another reason, and drops nothing', async () => {
    const db = makeDb({});
    db.executeRead.mockRejectedValue(new Error('connection reset'));
    const { service, logger } = make(db);
    await service.onApplicationBootstrap();
    expect(db.executeSchemaWrite).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('connection reset'));
  });

  it('a failed drop is logged as a warning and the others still go', async () => {
    const db = makeDb({ present: [...LEGACY_VECTOR_INDEXES], dropFails: ['dataflow_class_embeddings'] });
    const { service, logger } = make(db);
    await service.onApplicationBootstrap();
    expect(db.executeSchemaWrite).toHaveBeenCalledTimes(5);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('dataflow_class_embeddings'));
    expect(logger.log).toHaveBeenCalledWith('Dropped 4 of 5 unused vector indexes');
  });
});
