import { describe, it, expect } from 'vitest';
import {
  aggregateCoverage,
  AggregateInput,
  CoverageResult,
} from '../src/aggregateCoverage';

const base = (over: Partial<AggregateInput> = {}): AggregateInput => ({
  modelId: 'm1',
  generatedAt: '2026-06-04T00:00:00.000Z',
  baseRows: [],
  directRows: [],
  mitigationRows: [],
  d3fendRows: [],
  ...over,
});

const exp = (r: CoverageResult, id: string) =>
  r.exposures.find((e) => e.exposureId === id)!;
const tech = (r: CoverageResult, eid: string, tid: string) =>
  exp(r, eid).techniques.find((t) => t.techniqueId === tid)!;

describe('aggregateCoverage — partitions', () => {
  it('soft exposure (no EXPLOITED_BY technique) is flagged, with no techniques', () => {
    const r = aggregateCoverage(
      base({ baseRows: [{ elementId: 'c1', elementKind: 'Component', exposureId: 'e1', techniqueIds: [] }] }),
    );
    expect(exp(r, 'e1').soft).toBe(true);
    expect(exp(r, 'e1').techniques).toEqual([]);
    expect(r.meta.softExposureCount).toBe(1);
  });

  it('exposure with a technique but no covering edge → covered:false, empty tiers', () => {
    const r = aggregateCoverage(
      base({ baseRows: [{ elementId: 'c1', elementKind: 'Component', exposureId: 'e1', techniqueIds: ['T1190'] }] }),
    );
    expect(exp(r, 'e1').soft).toBe(false);
    expect(tech(r, 'e1', 'T1190')).toMatchObject({ covered: false, tiers: [] });
  });

  it('preserves element identity (id + kind) on the raw facts', () => {
    const r = aggregateCoverage(
      base({ baseRows: [{ elementId: 'b9', elementKind: 'SecurityBoundary', exposureId: 'e1', techniqueIds: ['T1190'] }] }),
    );
    expect(exp(r, 'e1')).toMatchObject({ elementId: 'b9', elementKind: 'SecurityBoundary' });
  });
});

describe('aggregateCoverage — tiers & functions', () => {
  const baseRows = [
    { elementId: 'c1', elementKind: 'Component', exposureId: 'e1', techniqueIds: ['T1190'] },
  ];

  it('DIRECT: _DETECTS ⇒ DETECT, the other three ⇒ PREVENT', () => {
    const r = aggregateCoverage(
      base({
        baseRows,
        directRows: [
          { exposureId: 'e1', techniqueId: 'T1190', cmId: 'cmA', relType: 'COUNTERMEASURE_DETECTS' },
          { exposureId: 'e1', techniqueId: 'T1190', cmId: 'cmB', relType: 'COUNTERMEASURE_MITIGATES' },
          { exposureId: 'e1', techniqueId: 'T1190', cmId: 'cmC', relType: 'COUNTERMEASURE_ISOLATES' },
        ],
      }),
    );
    const facts = tech(r, 'e1', 'T1190').tiers.filter((t) => t.tier === 'DIRECT');
    const prevent = facts.find((f) => f.function === 'PREVENT')!;
    const detect = facts.find((f) => f.function === 'DETECT')!;
    expect(detect.countermeasureIds).toEqual(['cmA']);
    expect(prevent.countermeasureIds).toEqual(['cmB', 'cmC']); // sorted, merged
  });

  it('INDIRECT-Mitigation is always PREVENT', () => {
    const r = aggregateCoverage(
      base({ baseRows, mitigationRows: [{ exposureId: 'e1', techniqueId: 'T1190', cmId: 'cmM' }] }),
    );
    const facts = tech(r, 'e1', 'T1190').tiers;
    expect(facts).toEqual([{ tier: 'INDIRECT_MITIGATION', function: 'PREVENT', countermeasureIds: ['cmM'] }]);
  });

  it('D3FEND: Detect tactic ⇒ DETECT; Harden/Isolate ⇒ PREVENT; tactic-less ⇒ PREVENT', () => {
    const r = aggregateCoverage(
      base({
        baseRows: [
          { elementId: 'c1', elementKind: 'Component', exposureId: 'e1', techniqueIds: ['T1'] },
          { elementId: 'c1', elementKind: 'Component', exposureId: 'e2', techniqueIds: ['T2'] },
          { elementId: 'c1', elementKind: 'Component', exposureId: 'e3', techniqueIds: ['T3'] },
        ],
        d3fendRows: [
          { exposureId: 'e1', techniqueId: 'T1', cmId: 'cm1', tactics: ['Detect'] },
          { exposureId: 'e2', techniqueId: 'T2', cmId: 'cm2', tactics: ['Harden'] },
          { exposureId: 'e3', techniqueId: 'T3', cmId: 'cm3', tactics: [] },
        ],
      }),
    );
    expect(tech(r, 'e1', 'T1').tiers[0].function).toBe('DETECT');
    expect(tech(r, 'e2', 'T2').tiers[0].function).toBe('PREVENT');
    expect(tech(r, 'e3', 'T3').tiers[0].function).toBe('PREVENT');
  });

  it('D3FEND spanning Detect + Harden emits BOTH functions (report does the detect-only reduction)', () => {
    const r = aggregateCoverage(
      base({
        baseRows: [{ elementId: 'c1', elementKind: 'Component', exposureId: 'e1', techniqueIds: ['T1'] }],
        d3fendRows: [{ exposureId: 'e1', techniqueId: 'T1', cmId: 'cm1', tactics: ['Detect', 'Harden'] }],
      }),
    );
    const fns = tech(r, 'e1', 'T1').tiers.map((t) => t.function).sort();
    expect(fns).toEqual(['DETECT', 'PREVENT']);
  });

  it('a technique covered at multiple tiers keeps all tiers (no collapse to best)', () => {
    const r = aggregateCoverage(
      base({
        baseRows: [{ elementId: 'c1', elementKind: 'Component', exposureId: 'e1', techniqueIds: ['T1190'] }],
        directRows: [{ exposureId: 'e1', techniqueId: 'T1190', cmId: 'cmA', relType: 'COUNTERMEASURE_MITIGATES' }],
        mitigationRows: [{ exposureId: 'e1', techniqueId: 'T1190', cmId: 'cmB' }],
        d3fendRows: [{ exposureId: 'e1', techniqueId: 'T1190', cmId: 'cmC', tactics: ['Detect'] }],
      }),
    );
    const tiers = tech(r, 'e1', 'T1190').tiers.map((t) => t.tier);
    expect(tiers).toEqual(['DIRECT', 'INDIRECT_MITIGATION', 'INDIRECT_D3FEND']);
    expect(tech(r, 'e1', 'T1190').covered).toBe(true);
  });
});

describe('aggregateCoverage — meta (per-tier counts)', () => {
  it('countermeasuresByTier counts distinct covering cms per tier (0 DIRECT / N Mitigation / M D3FEND)', () => {
    const baseRows = [
      { elementId: 'c1', elementKind: 'Component', exposureId: 'e1', techniqueIds: ['T1'] },
      { elementId: 'c1', elementKind: 'Component', exposureId: 'e2', techniqueIds: ['T2'] },
    ];
    const r = aggregateCoverage(
      base({
        baseRows,
        // 0 DIRECT, 2 distinct Mitigation cms, 3 distinct D3FEND cms
        mitigationRows: [
          { exposureId: 'e1', techniqueId: 'T1', cmId: 'm1' },
          { exposureId: 'e2', techniqueId: 'T2', cmId: 'm2' },
          { exposureId: 'e2', techniqueId: 'T2', cmId: 'm1' }, // dup cm
        ],
        d3fendRows: [
          { exposureId: 'e1', techniqueId: 'T1', cmId: 'd1', tactics: ['Detect'] },
          { exposureId: 'e1', techniqueId: 'T1', cmId: 'd2', tactics: ['Harden'] },
          { exposureId: 'e2', techniqueId: 'T2', cmId: 'd3', tactics: ['Isolate'] },
        ],
      }),
    );
    expect(r.meta.countermeasuresByTier).toEqual({ DIRECT: 0, INDIRECT_MITIGATION: 2, INDIRECT_D3FEND: 3 });
    expect(r.meta.coveredPairsByTier.INDIRECT_MITIGATION).toBe(2); // (e1,T1) + (e2,T2)
  });

  it('emits no percentage / no single "covered" aggregate field', () => {
    const r = aggregateCoverage(
      base({ baseRows: [{ elementId: 'c1', elementKind: 'Component', exposureId: 'e1', techniqueIds: ['T1'] }] }),
    );
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/coveragePct|percent|"covered":\s*\d/i);
  });
});
