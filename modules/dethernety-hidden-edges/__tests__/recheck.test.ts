/**
 * The recheck (contract 2): whether accepted, rejected or taken-back edges still hold, with a positive reason when
 * they do not; the walk it runs, with no cap, budget or exclusion, keeping only the rechecked edges; its options.
 */
import { describe, expect, it } from 'vitest';
import shipped from '../src/edge-kinds.json';
import DethernetyHiddenEdgesModule from '../src/DethernetyHiddenEdgesModule';
import { candidateId, generateCandidates, MatchingOverBudget, RecheckEntry, recheckWalk } from '../src/generate';
import { MAX_RECHECK, parseOptions } from '../src/options';
import { verdictOf } from '../src/recheck';
import { validateTable } from '../src/table';
import { answerFor, SNAPSHOT_MODELS } from './contract1-models';
import { fakeDriver } from './fixtures';
import { model } from './model-builder';

const table = validateTable(shipped);
const FLAT = 'Lateral movement on a flat tier';
const entry = (kind: string, source: string, target: string, exposure_ids: string[] = []): RecheckEntry => ({ kind, source, target, exposure_ids });

/** The verdicts for some edges on a built model, as the resolver answers them. */
async function recheck(b: ReturnType<typeof model>, entries: RecheckEntry[]) {
  const m = b.fold();
  const { parts, topology } = await recheckWalk(m, table, entries);
  return entries.map((x) => verdictOf(m, (s, t) => topology.hasDeclaredFlow(s, t), x, parts.get(candidateId(x.kind, x.source, x.target)) ?? []));
}

/** A segment with two services and a web server, a database and an outside device; the flat-tier finding and B's own. */
const segment = (attrs: Record<string, unknown> = { east_west_within_segment_restricted: false }) =>
  model()
    .boundary('SEG', 'Network Segment', null, attrs)
    .component('A', 'Application Service', 'PROCESS', 'SEG')
    .component('B', 'Web Server', 'PROCESS', 'SEG')
    .component('D', 'Relational Database', 'STORE', 'SEG')
    .component('U', 'End User', 'EXTERNAL_ENTITY', 'SEG')
    .exposure('x', 'SEG', FLAT, ['T1021'])
    .exposure('y', 'B', 'Remote administration exposed', ['T1021.004']);

describe('the verdicts', () => {
  it('holds: its tier from the model’s facts, whether pending findings alone carry it, and whether it rests on the findings it was shown with', async () => {
    const [shown, other, none] = await recheck(segment(), [
      entry('remote-service', 'A', 'B', ['x', 'y']),
      entry('remote-service', 'A', 'B', ['gone']),
      entry('remote-service', 'A', 'B', []),
    ]);
    expect(shown).toMatchObject({ verdict: 'holds', tier: 'high', pending_only: false, in_given: true });
    expect(other).toMatchObject({ verdict: 'holds', in_given: false });
    // with no findings given, nothing to compare: it says neither
    expect(none.verdict).toBe('holds');
    expect('in_given' in none).toBe(false);
    const pending = await recheck(
      model()
        .boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false })
        .component('A', 'Application Service', 'PROCESS', 'SEG')
        .component('B', 'Web Server', 'PROCESS', 'SEG')
        .exposure('x', 'SEG', FLAT, ['T1021'], 'pending'),
      [entry('remote-service', 'A', 'B', ['x'])],
    );
    expect(pending[0]).toMatchObject({ verdict: 'holds', tier: 'medium', pending_only: true });
  });

  it('holds when the only flow on the pair is the accepted edge’s own', async () => {
    const [r] = await recheck(segment().flow('he', 'Hidden Edge Test', 'A', 'B'), [entry('remote-service', 'A', 'B', ['x'])]);
    expect(r.verdict).toBe('holds');
  });

  it('declared_flow: the path is drawn as an ordinary flow', async () => {
    const [r] = await recheck(segment().flow('f', 'API Call', 'A', 'B'), [entry('remote-service', 'A', 'B', ['x'])]);
    expect(r.verdict).toBe('declared_flow');
  });

  it('end_gone: an end is no longer a component', async () => {
    const [r] = await recheck(segment(), [entry('remote-service', 'A', 'nowhere', ['x'])]);
    expect(r).toEqual({ id: candidateId('remote-service', 'A', 'nowhere'), verdict: 'end_gone', parts: [] });
  });

  it('removed: a breaker now stated removes every way in, with the facts that did', async () => {
    const [r] = await recheck(
      model()
        .boundary('SEG', 'Network Segment', null, { segment_boundary_enforced: false, east_west_within_segment_restricted: true })
        .component('A', 'Application Service', 'PROCESS', 'SEG')
        .component('B', 'Web Server', 'PROCESS', 'SEG')
        .exposure('z', 'SEG', 'Drawn-but-not-enforced segmentation', ['T1021']),
      [entry('remote-service', 'A', 'B', ['z'])],
    );
    expect(r.verdict).toBe('removed');
    // only what removed it: not the facts that met a gate or lowered it
    expect(r.facts).toEqual(['attributes:SEG#east_west_within_segment_restricted']);
    expect(r.parts.every((p) => p.reason === 'removed')).toBe(true);
  });

  it('end_type: a starting point that cannot act, or a reached end of a type the rule does not reach', async () => {
    const [store, target] = await recheck(segment(), [entry('remote-service', 'D', 'A', ['x']), entry('remote-service', 'A', 'D', ['x'])]);
    expect(store).toMatchObject({ verdict: 'end_type', parts: [{ reason: 'end_type' }] });
    // the candidate walk never offers a reached end of the wrong type; the recheck does, to name it
    expect(target.verdict).toBe('end_type');
  });

  it('end_type on a target row’s own anchor of a type the row does not reach', async () => {
    const [r] = await recheck(
      model()
        .boundary('SEG', 'Network Segment')
        .component('A', 'Application Service', 'PROCESS', 'SEG')
        .component('K', 'Cache / In-Memory Store', 'EXTERNAL_ENTITY', 'SEG')
        .exposure('y', 'K', 'Exploitable cache service', ['T1210']),
      [entry('remote-service', 'A', 'K', ['y'])],
    );
    expect(r).toMatchObject({ verdict: 'end_type', parts: [{ row: 'remote-service/rs-3', exposure: 'y', reason: 'end_type' }] });
  });

  it('lists every reason behind a verdict, once per way in, even when the list is cut', () => {
    const m = segment().fold();
    const found = [
      ...Array.from({ length: 12 }, (_, i) => ({ row: 'remote-service/rs-1', exposure: `a${String(i).padStart(2, '0')}`, reason: 'removed' as const })),
      { row: 'remote-service/rs-1', exposure: 'a00', reason: 'removed' as const },
      { row: 'remote-service/rs-3', exposure: 'z', reason: 'end_type' as const },
    ];
    const r = verdictOf(m, () => false, entry('remote-service', 'A', 'B'), found);
    expect(r.verdict).toBe('mixed');
    expect(r.parts).toHaveLength(10);
    expect(new Set(r.parts.map((p) => p.reason))).toEqual(new Set(['removed', 'end_type']));
    expect(new Set(r.parts.map((p) => `${p.row} ${p.exposure} ${p.reason}`)).size).toBe(10);
  });

  it('mixed: ways in found, none kept, for different reasons', () => {
    const m = segment().fold();
    const r = verdictOf(m, () => false, entry('remote-service', 'A', 'B'), [
      { row: 'remote-service/rs-1', exposure: 'x', reason: 'removed', facts: ['attributes:SEG#a'] },
      { row: 'remote-service/rs-3', exposure: 'y', reason: 'end_type' },
    ]);
    expect(r.verdict).toBe('mixed');
    expect(r.parts.map((p) => p.reason).sort()).toEqual(['end_type', 'removed']);
  });

  it('grounds_disposed: no way in, a finding it was shown with disposed, and every other disposed or gone', async () => {
    const b = segment();
    (b as any).rows.exposures.push({ elementId: 'SEG', id: 'd', name: 'Lateral movement on a flat tier', dispositionKind: 'NOT_APPLICABLE', dispositionedBy: 'someone', createdBy: 'SYSTEM' });
    (b as any).rows.exposureTechniques.push({ exposureId: 'd', techniqueId: 'T1021' });
    const [r] = await recheck(b, [entry('credential-capture', 'A', 'B', ['d', 'deleted'])]);
    expect(r.verdict).toBe('grounds_disposed');
  });

  it('not_derived when every finding it was shown with is gone: it stopped firing, and no one dismissed it', async () => {
    const [r] = await recheck(segment(), [entry('credential-capture', 'A', 'B', ['deleted', 'also-deleted'])]);
    expect(r.verdict).toBe('not_derived');
  });

  it('not_derived: no way in at all; an edge shown with no findings always lands here', async () => {
    const [none, empty] = await recheck(segment(), [entry('credential-capture', 'A', 'B', ['x']), entry('host-escape', 'A', 'B', [])]);
    expect(none.verdict).toBe('not_derived');
    expect(empty.verdict).toBe('not_derived');
  });
});

describe('the walk', () => {
  it('finds every candidate the answer lists still holding, on the findings it was listed with, at its tier before the knowledge graph', async () => {
    for (const e of SNAPSHOT_MODELS) {
      const { answer, model: m } = await answerFor(e, 1);
      const entries = answer.candidates.map((c: any) => entry(c.kind, c.source, c.target, c.exposure_ids));
      if (entries.length === 0) continue;
      const { parts, topology } = await recheckWalk(m, table, entries);
      answer.candidates.forEach((c: any, i: number) => {
        const v = verdictOf(m, (s, t) => topology.hasDeclaredFlow(s, t), entries[i], parts.get(c.id) ?? []);
        const before = ['low', 'medium', 'high'][['low', 'medium', 'high'].indexOf(c.tier) + (c.kg === 'lowered' ? 1 : 0)];
        expect([e.name, c.id, v.verdict, v.in_given], `${e.name} ${c.kind} ${c.source}->${c.target}`).toEqual([e.name, c.id, 'holds', true]);
        // the walk keeps every way in, those the candidate's cap set aside too: never weaker than the answer said
        expect(['low', 'medium', 'high'].indexOf(v.tier!)).toBeGreaterThanOrEqual(['low', 'medium', 'high'].indexOf(before));
      });
    }
  });

  it('names a zone-egress starting point that is no process', async () => {
    const b = model()
      .boundary('OFF', 'Endpoint / Office Environment', null, { user_segment_isolated_from_production_tiers: false })
      .boundary('PROD', 'Network Segment')
      .component('W', 'Object Storage', 'STORE', 'OFF')
      .component('P', 'Application Service', 'PROCESS', 'PROD')
      .exposure('x', 'OFF', 'Flat office network reaches production', ['T1021']);
    const [r] = await recheck(b, [entry('remote-service', 'W', 'P', ['x'])]);
    expect(r.verdict).toBe('end_type');
  });

  it('finds an edge past the peer cap and the anchor budget the candidates never list', async () => {
    const b = model().boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false });
    for (let i = 0; i < 60; i++) b.component(`c${String(i).padStart(2, '0')}`, 'Application Service', 'PROCESS', 'SEG');
    b.exposure('x', 'SEG', FLAT, ['T1021']);
    const listed = (await generateCandidates(b.fold(), table)).candidates.map((c) => `${c.source}->${c.target}`);
    expect(listed).not.toContain('c58->c59');
    const [r] = await recheck(b, [entry('remote-service', 'c58', 'c59', ['x'])]);
    expect(r).toMatchObject({ verdict: 'holds', in_given: true });
  });

  it('finds a zone-egress end past the twenty the candidates keep', async () => {
    const b = model()
      .boundary('OFF', 'Endpoint / Office Environment', null, { user_segment_isolated_from_production_tiers: false })
      .boundary('PROD', 'Network Segment')
      .component('W', 'User Workstation / Endpoint', 'PROCESS', 'OFF');
    for (let i = 0; i < 25; i++) b.component(`p${String(i).padStart(2, '0')}`, 'Application Service', 'PROCESS', 'PROD');
    b.exposure('x', 'OFF', 'Flat office network reaches production', ['T1021']);
    const [r] = await recheck(b, [entry('remote-service', 'W', 'p24', ['x'])]);
    expect(r.verdict).toBe('holds');
  });

  it('draws only the rechecked pairs: a dense segment stays well inside the call’s budget', async () => {
    const b = model().boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false });
    for (let i = 0; i < 1_100; i++) b.component(`c${String(i).padStart(4, '0')}`, 'Application Service', 'PROCESS', 'SEG');
    for (let i = 0; i < 20; i++) b.exposure(`x${i}`, 'SEG', FLAT, ['T1021']);
    const entries = Array.from({ length: MAX_RECHECK }, (_, i) => entry('remote-service', `c${String(i).padStart(4, '0')}`, `c${String(i + 500).padStart(4, '0')}`, ['x0']));
    const started = Date.now();
    const verdicts = await recheck(b, entries);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(verdicts.every((v) => v.verdict === 'holds')).toBe(true);
  });

  it('refuses a call over the pair budget, never answering in part', async () => {
    const b = model().boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false });
    for (let i = 0; i < 201; i++) b.component(`c${String(i).padStart(3, '0')}`, 'Application Service', 'PROCESS', 'SEG');
    // 200 pairs, each offered by every one of 1,100 findings: 220,000 draws
    for (let i = 0; i < 1_100; i++) b.exposure(`x${String(i).padStart(4, '0')}`, 'SEG', FLAT, ['T1021']);
    const entries = Array.from({ length: 200 }, (_, i) => entry('remote-service', `c${String(i).padStart(3, '0')}`, `c${String(i + 1).padStart(3, '0')}`, []));
    await expect(recheckWalk(b.fold(), table, entries)).rejects.toBeInstanceOf(MatchingOverBudget);
    // the draws before the refusal take seconds; a loaded CI runner passes the 5 s default
  }, 60_000);
});

describe('the recheck options and answer', () => {
  const ok = { kind: 'remote-service', source: 'A', target: 'B', exposure_ids: ['x'] };
  const refused = (o: unknown) => {
    const r = parseOptions(JSON.stringify(o));
    return r.ok ? null : r.detail;
  };

  it('takes 1 to 200 edges under contract 2 only, with nothing beside it that would shape the walk', () => {
    expect(parseOptions(JSON.stringify({ contract: 2, recheck: [ok] }))).toMatchObject({ ok: true, options: { recheck: [ok] } });
    expect(refused({ recheck: [ok] })).toBe('recheck');
    expect(refused({ contract: 1, recheck: [ok] })).toBe('recheck');
    expect(refused({ contract: 2, recheck: [] })).toBe('recheck');
    expect(refused({ contract: 2, recheck: Array.from({ length: MAX_RECHECK + 1 }, () => ok) })).toBe('recheck');
    expect(refused({ contract: 2, recheck: [ok], excluded: [] })).toBe('recheck');
    expect(refused({ contract: 2, recheck: [ok], include_pending: true })).toBe('recheck');
  });

  it('refuses a malformed edge', () => {
    for (const bad of [{ ...ok, kind: 'other' }, { ...ok, source: '' }, { ...ok, extra: 1 }, { ...ok, exposure_ids: 'x' }, { ...ok, target: 'a b' }]) {
      expect(refused({ contract: 2, recheck: [bad] })).toBe('recheck');
    }
  });

  it('answers mode recheck, no candidates, one verdict per edge asked, in order', async () => {
    const mod = new DethernetyHiddenEdgesModule(fakeDriver().driver, { error() {}, warn() {}, log() {} } as any);
    const edges = [
      { kind: 'remote-service', source: 'web', target: 'app', exposure_ids: ['other'] },
      { kind: 'host-escape', source: 'app', target: 'web', exposure_ids: [] },
      { kind: 'remote-service', source: 'web', target: 'app', exposure_ids: ['x1'] },
    ];
    const a: any = await mod.candidates({ modelId: 'm', options: JSON.stringify({ contract: 2, recheck: edges }) });
    expect(Object.keys(a)).toEqual(['contract', 'module', 'version', 'table_hash', 'mode', 'candidates', 'recheck']);
    expect([a.contract, a.mode, a.candidates]).toEqual([2, 'recheck', []]);
    expect(a.recheck.map((r: any) => r.id)).toEqual([candidateId('remote-service', 'web', 'app'), candidateId('host-escape', 'app', 'web')]);
    expect(a.recheck[1].verdict).toBe('not_derived');
    // an edge asked twice is judged once, on every finding given for it
    expect(a.recheck[0]).toMatchObject({ verdict: 'holds', in_given: true });
  });
});
