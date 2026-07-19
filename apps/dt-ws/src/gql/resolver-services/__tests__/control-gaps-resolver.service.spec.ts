import neo4j from 'neo4j-driver';
import { ControlGapsResolverService } from '../control-gaps-resolver.service';

/**
 * Unit pins for ControlGapsResolverService:
 *   - the Phase-3 LIMIT param is a graph Integer, not a JS number (Memgraph
 *     rejects a Bolt Float64 LIMIT — the release-relevant regression);
 *   - the five coverage buckets are DISJOINT and sum exactly to
 *     totalExposures (configuredCoverage no longer double-counts into the
 *     unmitigated/unaddressable lists; the techniques-without-mitigations
 *     case lands in unaddressable instead of vanishing);
 *   - configuredCoverage techniques still feed Phase 3 recommendations;
 *   - an empty scope short-circuits without running Phase 2b/3.
 *
 * The fake sessions are STRICT: unrecognized queries throw, so a query
 * refactor can never silently starve a fixture. Live-graph proof runs in
 * test/integration/control-gaps.e2e-spec.ts.
 */

type Row = Record<string, any>;
const rec = (row: Row) => ({ get: (k: string) => row[k] });

// A scope-query row. techniques/mitigations are {id,name}[]; control
// presence via controlIds/anyControlIds.
function scopeRow(over: Row): Row {
  return {
    elementId: 'el-1',
    elementName: 'Element',
    elementType: 'server',
    exposureId: 'exp-?',
    exposureName: 'Exposure',
    techniques: [],
    mitigations: [],
    controlIds: [],
    anyControlIds: [],
    ...over,
  };
}

function makeService(fixture: {
  scopeRows: Row[];
  addressableIds: string[];
}) {
  const queries: Array<{ query: string; params: any }> = [];

  const tx = {
    run: async (query: string, params: any) => {
      queries.push({ query, params });
      if (query.includes('UNWIND allElements AS element')) {
        return { records: fixture.scopeRows.map(rec) };
      }
      if (query.includes('addressableMitigationId')) {
        return {
          records: fixture.addressableIds.map((id) =>
            rec({ addressableMitigationId: id }),
          ),
        };
      }
      if (query.includes('addressesCount')) {
        return { records: [] };
      }
      throw new Error(`unrecognized query: ${query}`);
    },
  };

  const session = {
    executeRead: async (cb: any) => cb(tx),
    close: async () => {},
  };
  const driver = { session: () => session };

  const service = new ControlGapsResolverService(
    driver as any,
    { get: () => 'neo4j' } as any,
    {} as any,
    { recordOperation: () => {} } as any,
  );

  return { service, queries };
}

const run = (service: ControlGapsResolverService, input: any) =>
  (service as any).executeControlGaps(input);

// The five-bucket fixture: one exposure per bucket, plus the two
// historically-broken cases (double-count trap + no-mitigations gap).
const FIVE_BUCKET_ROWS: Row[] = [
  scopeRow({
    exposureId: 'exp-mitigated',
    techniques: [{ id: 'T1', name: 't1' }],
    mitigations: [{ id: 'M1', name: 'm1' }],
    controlIds: ['ctrl-1'],
    anyControlIds: ['ctrl-1'],
  }),
  // The old double-count trap: control assigned but off-technique, WITH
  // addressable mitigations — must count ONLY as configuredCoverage.
  scopeRow({
    exposureId: 'exp-configured',
    techniques: [{ id: 'T2', name: 't2' }],
    mitigations: [{ id: 'M2', name: 'm2' }],
    anyControlIds: ['ctrl-2'],
  }),
  scopeRow({
    exposureId: 'exp-unmitigated',
    techniques: [{ id: 'T3', name: 't3' }],
    mitigations: [{ id: 'M3', name: 'm3' }],
  }),
  scopeRow({
    exposureId: 'exp-unaddressable',
    techniques: [{ id: 'T4', name: 't4' }],
    mitigations: [{ id: 'M4', name: 'm4' }], // not addressable
  }),
  // The old vanishing case: techniques but NO known mitigations — must
  // land in unaddressable (mitreMitigations: []), not in no bucket.
  scopeRow({
    exposureId: 'exp-nomitigations',
    techniques: [{ id: 'T5', name: 't5' }],
  }),
  scopeRow({ exposureId: 'exp-nochain' }),
];

describe('ControlGapsResolverService — LIMIT integer + bucket accounting', () => {
  it('binds the Phase-3 LIMIT as a graph Integer, never a JS number', async () => {
    const { service, queries } = makeService({
      scopeRows: FIVE_BUCKET_ROWS,
      addressableIds: ['M2', 'M3'],
    });

    await run(service, { modelId: 'model-1', topN: 3 });

    const phase3 = queries.find((q) => q.query.includes('addressesCount'));
    expect(phase3).toBeDefined();
    expect(neo4j.isInt(phase3!.params.topN)).toBe(true);
    expect(typeof phase3!.params.topN).not.toBe('number');
    expect(neo4j.integer.toNumber(phase3!.params.topN)).toBe(3);
  });

  // NOTE: on THIS fixture the pre-fix code coincidentally also summed to 6
  // (its two bugs cancel: +1 double-counted unmitigated, -1 vanished
  // no-mitigations). The per-bucket exact asserts below are what
  // discriminate — never loosen them on the theory that the sum backstops.
  it('buckets are disjoint and sum exactly to totalExposures', async () => {
    const { service } = makeService({
      scopeRows: FIVE_BUCKET_ROWS,
      addressableIds: ['M2', 'M3'],
    });

    const result = await run(service, { modelId: 'model-1' });
    const s = result.coverageSummary;

    expect(s.totalExposures).toBe(6);
    expect(s.mitigated).toBe(1);
    expect(s.configuredCoverage).toBe(1);
    expect(s.noMitreChain).toBe(1);
    expect(s.unmitigated).toBe(1);
    expect(s.unaddressable).toBe(2); // exp-unaddressable + exp-nomitigations
    expect(
      s.mitigated +
        s.configuredCoverage +
        s.noMitreChain +
        s.unmitigated +
        s.unaddressable,
    ).toBe(s.totalExposures);

    // Disjointness: the configuredCoverage exposure is in NEITHER list.
    const listedIds = [
      ...result.unmitigatedExposures,
      ...result.unaddressableExposures,
    ].map((e: any) => e.exposureId);
    expect(listedIds).not.toContain('exp-configured');
    expect(result.unmitigatedExposures.map((e: any) => e.exposureId)).toEqual([
      'exp-unmitigated',
    ]);
    expect(
      result.unaddressableExposures.map((e: any) => e.exposureId).sort(),
    ).toEqual(['exp-nomitigations', 'exp-unaddressable']);

    // The no-mitigations exposure surfaces honestly with an empty list.
    const noMit = result.unaddressableExposures.find(
      (e: any) => e.exposureId === 'exp-nomitigations',
    );
    expect(noMit.mitreMitigations).toEqual([]);
  });

  it('configuredCoverage techniques still feed the Phase-3 recommendation pool', async () => {
    const { service, queries } = makeService({
      scopeRows: FIVE_BUCKET_ROWS,
      addressableIds: ['M2', 'M3'],
    });

    await run(service, { modelId: 'model-1' });

    // The Phase-2b addressability input must union BOTH candidate pools —
    // dropping the configuredCoverage pool would silently strip T2 from
    // Phase 3 (the mutation this pin exists to catch).
    const phase2b = queries.find((q) =>
      q.query.includes('addressableMitigationId'),
    );
    expect((phase2b!.params.mitigationIds as string[]).sort()).toEqual([
      'M2',
      'M3',
      'M4',
    ]);

    const phase3 = queries.find((q) => q.query.includes('addressesCount'));
    const ids = phase3!.params.techniqueIds as string[];
    expect(ids).toContain('T3'); // unmitigated exposure
    expect(ids).toContain('T2'); // configuredCoverage w/ addressable mitigation
    expect(ids).not.toContain('T4'); // unaddressable
    expect(ids).not.toContain('T5'); // no known mitigations
  });

  it('empty scope returns emptyResult without running Phase 2b/3', async () => {
    const { service, queries } = makeService({
      scopeRows: [],
      addressableIds: [],
    });

    const result = await run(service, { modelId: 'model-1' });

    expect(result.coverageSummary.totalExposures).toBe(0);
    expect(result.recommendedControls).toEqual([]);
    expect(queries).toHaveLength(1); // scope query only
  });
});
