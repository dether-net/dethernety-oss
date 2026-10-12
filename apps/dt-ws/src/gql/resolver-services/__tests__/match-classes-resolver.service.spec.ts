import { MatchClassesResolverService } from '../match-classes-resolver.service';

/**
 * Unit pins for the matchClasses componentType filter.
 *
 * A ComponentClass carries exactly one ComponentType, and changeElementBinding
 * refuses a cross-type bind — so every tier of the cascade must honour the
 * componentType filter, or the picker offers candidates the user cannot accept.
 *
 * Priority 2 (substring / `fuzzy_name`) used to skip the filter deliberately.
 * Because each tier `continue`s on a hit, an unfiltered substring match did not
 * merely add noise: it SUPPRESSED the type-filtered Priority 4 fallback that
 * would have answered correctly.
 *
 * These drive the real cascade (executeMatchClasses) over a faked class
 * catalogue, so the tier wiring is pinned alongside the helpers themselves.
 * Vector search is disabled here, so the name tiers and the heuristic answer alone.
 */

const rec = (row: Record<string, any>) => ({ get: (k: string) => row[k] });

const CLASSES = [
  { classId: 'p1', className: 'Data Processor', description: null, category: null, type: 'PROCESS', moduleId: 'm1', moduleName: 'mod' },
  { classId: 'p2', className: 'Payment Processor', description: null, category: null, type: 'PROCESS', moduleId: 'm1', moduleName: 'mod' },
  { classId: 's1', className: 'Data Warehouse', description: null, category: null, type: 'STORE', moduleId: 'm1', moduleName: 'mod' },
  { classId: 'e1', className: 'Data Broker', description: null, category: null, type: 'EXTERNAL_ENTITY', moduleId: 'm1', moduleName: 'mod' },
];

function makeService(classes = CLASSES, opts: { embedding?: any; vectorSearch?: any } = {}) {
  const session = {
    executeRead: async (cb: any) =>
      cb({ run: async () => ({ records: classes.map((c) => rec(c)) }) }),
    close: async () => undefined,
  };
  return new MatchClassesResolverService(
    { session: () => session } as any,
    { get: () => 'neo4j' } as any,
    {} as any,
    {} as any,
    opts.embedding ?? ({ isEnabled: () => false } as any),
    opts.vectorSearch ?? ({ healthy: async () => false } as any),
  );
}

const run = (svc: MatchClassesResolverService, input: any) =>
  (svc as any).executeMatchClasses(input);

const typesOf = (result: any) =>
  result.matches[0].candidates.map((c: any) => c.classType);

const idsOf = (result: any) =>
  result.matches[0].candidates.map((c: any) => c.classId);

describe('matchClasses — componentType filter across tiers', () => {
  it('substring tier returns only classes of the requested type', async () => {
    const svc = makeService();

    // "Data" substring-matches a PROCESS, a STORE and an EXTERNAL_ENTITY class.
    const result = await run(svc, {
      elements: [{ name: 'Data' }],
      classLabel: 'COMPONENT',
      componentType: 'STORE',
      fields: ['type'],
    });

    expect(idsOf(result)).toEqual(['s1']);
    expect(typesOf(result).every((t: string) => t === 'STORE')).toBe(true);
  });

  it('substring tier is unfiltered when no componentType is given', async () => {
    const svc = makeService();

    const result = await run(svc, {
      elements: [{ name: 'Data' }],
      classLabel: 'COMPONENT',
      fields: ['type'],
    });

    expect(idsOf(result).sort()).toEqual(['e1', 'p1', 's1']);
  });

  it('a cross-type substring hit no longer suppresses the Priority 4 fallback', async () => {
    // "Processor" substring-matches PROCESS classes only. For a STORE element
    // that tier must now yield nothing, so the cascade falls through to the
    // type-filtered heuristic and answers with the STORE class.
    const svc = makeService();

    const result = await run(svc, {
      elements: [{ name: 'Processor' }],
      classLabel: 'COMPONENT',
      componentType: 'STORE',
      fields: ['type'],
    });

    expect(idsOf(result)).toEqual(['s1']);
    expect(result.matches[0].candidates[0].matchType).toBe('type_match');
  });

  it('exact-name tier still honours the filter', async () => {
    const svc = makeService();

    const result = await run(svc, {
      elements: [{ name: 'Data Warehouse' }],
      classLabel: 'COMPONENT',
      componentType: 'STORE',
      fields: ['type'],
    });

    expect(idsOf(result)).toEqual(['s1']);
    expect(result.matches[0].candidates[0].matchType).toBe('exact_name');
  });

  it('an exact name of the wrong type does not match', async () => {
    const svc = makeService();

    // Exact name is a PROCESS class; a STORE element must not receive it, and
    // falls through to the type-filtered fallback instead.
    const result = await run(svc, {
      elements: [{ name: 'Payment Processor' }],
      classLabel: 'COMPONENT',
      componentType: 'STORE',
      fields: ['type'],
    });

    expect(idsOf(result)).toEqual(['s1']);
    expect(result.matches[0].candidates[0].matchType).toBe('type_match');
  });

  it('reports unmatched when no class of the requested type exists', async () => {
    const svc = makeService([CLASSES[0], CLASSES[1]]); // PROCESS only

    const result = await run(svc, {
      elements: [{ name: 'Data' }],
      classLabel: 'COMPONENT',
      componentType: 'STORE',
      fields: ['type'],
    });

    expect(result.matches).toEqual([]);
    expect(result.unmatched).toEqual(['Data']);
  });
});

describe('matchClasses — the name tier matches whole words', () => {
  // A class name hits the name tier only as a whole-word sequence inside the element name, or
  // the element name inside the class name: "microservice" does not contain the word "Service".
  const NAMED = [
    { classId: 'svc', className: 'Service', description: null, category: null, type: 'PROCESS', moduleId: 'm1', moduleName: 'mod' },
    { classId: 'app', className: 'Application Service', description: null, category: null, type: 'PROCESS', moduleId: 'm1', moduleName: 'mod' },
    { classId: 'pg', className: 'PostgreSQL', description: null, category: null, type: 'STORE', moduleId: 'm1', moduleName: 'mod' },
    { classId: 'os', className: 'Elasticsearch / OpenSearch', description: null, category: null, type: 'STORE', moduleId: 'm1', moduleName: 'mod' },
  ];
  const fuzzyIds = async (name: string) => {
    const result = await run(makeService(NAMED), { elements: [{ name }], classLabel: 'COMPONENT', fields: ['type'] });
    return result.matches[0].candidates.filter((c: any) => c.matchType === 'fuzzy_name').map((c: any) => c.classId);
  };

  it('a word inside a longer word is not a hit', async () => {
    expect(await fuzzyIds('Go microservice')).toEqual([]);
    expect(await fuzzyIds('Postgresqlish store')).toEqual([]);
  });

  it('a whole-word class name inside the element name is a hit', async () => {
    expect(await fuzzyIds('Order service')).toEqual(['svc']);
    expect(await fuzzyIds('Production PostgreSQL')).toEqual(['pg']);
    expect(await fuzzyIds('postgresql-primary')).toEqual(['pg']);
  });

  it('the element name as whole words inside a class name is a hit', async () => {
    expect(await fuzzyIds('OpenSearch')).toEqual(['os']);
    expect(await fuzzyIds('Application')).toEqual(['app']);
  });

  it('ranks hits by overlap ratio, as before', async () => {
    const result = await run(makeService(NAMED), { elements: [{ name: 'Application Service' }], classLabel: 'COMPONENT', fields: ['type'] });
    // exact match wins first; a near-name ranks by ratio within the tier
    expect(result.matches[0].candidates[0]).toMatchObject({ classId: 'app', matchType: 'exact_name' });
    const near = await run(makeService(NAMED), { elements: [{ name: 'Billing Application Service' }], classLabel: 'COMPONENT', fields: ['type'] });
    expect(near.matches[0].candidates.map((c: any) => c.classId)).toEqual(['app', 'svc']);
  });
});

describe('matchClasses — the vector tier', () => {
  const embedding = {
    isEnabled: () => true,
    getModel: () => 'embeddinggemma-300m-retrieval-v1',
    getThreshold: (corpus: string) => (corpus === 'classes' ? 0.35 : 0.3),
    composeElementText: (e: any) => `${e.name}. ${e.description}.`,
    embedBatch: async () => [[0.6, 0.8]],
  };

  function vectorSearch(present: boolean, rows: any[] = []) {
    const calls: any[] = [];
    return {
      calls,
      stub: {
        healthy: async () => true,
        read: async (_cypher: string, params: any) => {
          calls.push({ read: params });
          return [rec({ present })];
        },
        rank: async (request: any) => {
          calls.push({ rank: request });
          return rows;
        },
      },
    };
  }

  it('ranks with the active profile, the class threshold and the module scope', async () => {
    const vs = vectorSearch(true, [
      { id: 'p9', name: 'Queue Worker', description: 'd', category: null, type: 'PROCESS', moduleId: 'm2', moduleName: 'other', score: 0.71 },
    ]);
    const svc = makeService(CLASSES, { embedding, vectorSearch: vs.stub });
    const result = await run(svc, {
      elements: [{ name: 'Zz', description: 'consumes jobs' }],
      classLabel: 'COMPONENT',
      componentType: 'PROCESS',
      moduleIds: ['m2'],
      topN: 4,
    });
    expect(result.vectorAvailable).toBe(true);
    expect(vs.calls[0].read).toEqual({ profileId: 'embeddinggemma-300m-retrieval-v1', moduleIds: ['m2'] });
    expect(vs.calls[1].rank).toMatchObject({
      corpus: 'classes',
      label: 'ComponentClass',
      vector: [0.6, 0.8],
      profileId: 'embeddinggemma-300m-retrieval-v1',
      k: 4,
      threshold: 0.35,
      componentType: 'PROCESS',
      moduleIds: ['m2'],
    });
    expect(result.matches[0].candidates[0]).toMatchObject({ classId: 'p9', matchType: 'vector_similarity', similarityScore: 0.71 });
  });

  it('reports the tier unavailable when no class in scope has a vector of the active profile', async () => {
    const vs = vectorSearch(false);
    const svc = makeService(CLASSES, { embedding, vectorSearch: vs.stub });
    const result = await run(svc, { elements: [{ name: 'Zz', description: 'x' }], classLabel: 'COMPONENT' });
    expect(result.vectorAvailable).toBe(false);
    expect(vs.calls.filter((c) => c.rank)).toEqual([]);
  });

  it('reports the tier unavailable when the engine self-test fails', async () => {
    const svc = makeService(CLASSES, { embedding, vectorSearch: { healthy: async () => false } });
    const result = await run(svc, { elements: [{ name: 'Zz', description: 'x' }], classLabel: 'COMPONENT' });
    expect(result.vectorAvailable).toBe(false);
  });
});

describe('matchClasses — the vector availability check is cached', () => {
  const TTL = 10 * 60 * 1000;
  let profile = 'embeddinggemma-300m-retrieval-v1';
  const embedding = {
    isEnabled: () => true,
    getModel: () => profile,
    getThreshold: () => 0.35,
    composeElementText: (e: any) => `${e.name}. ${e.description}.`,
    embedBatch: async () => [[0.6, 0.8]],
  };
  const presence = (answers: Array<boolean | Error>) => {
    const reads: any[] = [];
    return {
      reads,
      stub: {
        healthy: async () => true,
        read: async (_cypher: string, params: any) => {
          reads.push(params);
          const a = answers[Math.min(reads.length - 1, answers.length - 1)];
          if (a instanceof Error) throw a;
          return [rec({ present: a })];
        },
        rank: async () => [],
      },
    };
  };
  const ask = (svc: MatchClassesResolverService, moduleIds?: string[]) =>
    run(svc, { elements: [{ name: 'Zz', description: 'x' }], classLabel: 'COMPONENT', moduleIds });

  let now = 1_000_000;
  beforeEach(() => {
    profile = 'embeddinggemma-300m-retrieval-v1';
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());

  it('reads once within the TTL and again after it', async () => {
    const vs = presence([true]);
    const svc = makeService(CLASSES, { embedding, vectorSearch: vs.stub });
    await ask(svc);
    now += TTL - 1;
    expect((await ask(svc)).vectorAvailable).toBe(true);
    expect(vs.reads).toHaveLength(1);
    now += 2;
    await ask(svc);
    expect(vs.reads).toHaveLength(2);
  });

  it('keeps one answer per label, module scope and profile; the scope\'s order does not matter', async () => {
    const vs = presence([true]);
    const svc = makeService(CLASSES, { embedding, vectorSearch: vs.stub });
    await ask(svc, ['m2', 'm1']);
    await ask(svc, ['m1', 'm2']);
    expect(vs.reads).toHaveLength(1);
    await ask(svc, ['m3']);
    await ask(svc);
    profile = 'embeddinggemma-2-text-retrieval-v1';
    await ask(svc);
    expect(vs.reads).toHaveLength(4);
  });

  it('shares one read between concurrent requests', async () => {
    const vs = presence([true]);
    const svc = makeService(CLASSES, { embedding, vectorSearch: vs.stub });
    await Promise.all([ask(svc), ask(svc), ask(svc)]);
    expect(vs.reads).toHaveLength(1);
  });

  it('warns once per key that no class has a vector, not on every request', async () => {
    const vs = presence([false]);
    const svc = makeService(CLASSES, { embedding, vectorSearch: vs.stub });
    const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});
    await ask(svc);
    now += TTL + 1;
    await ask(svc);
    expect(vs.reads).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
    await ask(svc, ['m9']);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('does not keep a failed read: the next request reads again', async () => {
    const vs = presence([new Error('engine busy'), true]);
    const svc = makeService(CLASSES, { embedding, vectorSearch: vs.stub });
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});
    expect((await ask(svc)).vectorAvailable).toBe(false);
    expect((await ask(svc)).vectorAvailable).toBe(true);
    expect(vs.reads).toHaveLength(2);
  });

  it('reads nothing while embedding is off', async () => {
    const vs = presence([true]);
    const svc = makeService(CLASSES, { embedding: { ...embedding, isEnabled: () => false }, vectorSearch: vs.stub });
    expect((await ask(svc)).vectorAvailable).toBe(false);
    expect(vs.reads).toHaveLength(0);
  });
});

describe('matchClasses — exact name merged with the vector tier', () => {
  const embedding = {
    isEnabled: () => true,
    getModel: () => 'p1-profile',
    getThreshold: () => 0.35,
    composeElementText: (e: any) => `${e.name}. ${e.description}.`,
    embedBatch: async () => [[0.6, 0.8]],
  };
  const row = (id: string, name: string, score: number) => ({
    id, name, description: null, category: null, type: 'PROCESS', moduleId: 'm1', moduleName: 'mod', score,
  });
  const vectorSearch = (rows: any[]) => ({
    healthy: async () => true,
    read: async () => [rec({ present: true })],
    rank: async () => rows,
  });
  const svcWith = (rows: any[]) => makeService(CLASSES, { embedding, vectorSearch: vectorSearch(rows) });

  it('puts the exact-name hit first, then the vector hits, each class once', async () => {
    const result = await run(svcWith([row('p1', 'Data Processor', 0.9), row('p9', 'Queue Worker', 0.7)]), {
      elements: [{ name: 'Data Processor', description: 'transforms records' }],
      classLabel: 'COMPONENT',
      topN: 5,
    });
    expect(result.matches[0].candidates.map((c: any) => [c.classId, c.matchType])).toEqual([
      ['p1', 'exact_name'],
      ['p9', 'vector_similarity'],
    ]);
  });

  it('does not let name containment short-circuit the vector tier', async () => {
    const result = await run(svcWith([row('p9', 'Queue Worker', 0.7)]), {
      elements: [{ name: 'Data', description: 'transforms records' }],
      classLabel: 'COMPONENT',
      componentType: 'PROCESS',
    });
    expect(result.matches[0].candidates.map((c: any) => [c.classId, c.matchType])).toEqual([['p9', 'vector_similarity']]);
  });

  it('falls back to containment when the vector tier returns nothing', async () => {
    const result = await run(svcWith([]), {
      elements: [{ name: 'Data', description: 'transforms records' }],
      classLabel: 'COMPONENT',
      componentType: 'PROCESS',
    });
    expect(result.matches[0].candidates.map((c: any) => c.matchType)).toEqual(['fuzzy_name']);
    expect(idsOf(result)).toEqual(['p1']);
  });

  it('falls back to containment when an element has no description', async () => {
    const result = await run(svcWith([row('p9', 'Queue Worker', 0.7)]), {
      elements: [{ name: 'Data' }],
      classLabel: 'COMPONENT',
      componentType: 'PROCESS',
    });
    expect(result.matches[0].candidates.map((c: any) => c.matchType)).toEqual(['fuzzy_name']);
  });

  it('cuts the merged list to topN', async () => {
    const result = await run(svcWith([row('p9', 'A', 0.9), row('p8', 'B', 0.8), row('p7', 'C', 0.7)]), {
      elements: [{ name: 'Data Processor', description: 'x' }],
      classLabel: 'COMPONENT',
      topN: 2,
    });
    expect(idsOf(result)).toEqual(['p1', 'p9']);
  });
});
