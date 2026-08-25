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
 * Vector search is disabled, which routes Priority 3 straight to Priority 4.
 */

const rec = (row: Record<string, any>) => ({ get: (k: string) => row[k] });

const CLASSES = [
  { classId: 'p1', className: 'Data Processor', description: null, category: null, type: 'PROCESS', moduleId: 'm1', moduleName: 'mod' },
  { classId: 'p2', className: 'Payment Processor', description: null, category: null, type: 'PROCESS', moduleId: 'm1', moduleName: 'mod' },
  { classId: 's1', className: 'Data Warehouse', description: null, category: null, type: 'STORE', moduleId: 'm1', moduleName: 'mod' },
  { classId: 'e1', className: 'Data Broker', description: null, category: null, type: 'EXTERNAL_ENTITY', moduleId: 'm1', moduleName: 'mod' },
];

function makeService(classes = CLASSES) {
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
    { isEnabled: () => false } as any,
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
