/**
 * Contract 2: each candidate's explanation (its ordered parts, the facts with their effects, the reasons beside its
 * tier), the rules' rationale, the limits, and the size trim. Contract 1's answers are pinned in contract1.test.
 */
import { describe, expect, it } from 'vitest';
import shipped from '../src/edge-kinds.json';
import { answerOf, MAX_PARTS } from '../src/answer';
import { readKindClasses } from '../src/classes';
import { tableHash } from '../src/contract';
import { boundCandidates, explainPart, factValue, matchCandidates, orderCandidates } from '../src/generate';
import { absentFacts } from '../src/kg';
import { validateTable } from '../src/table';
import { answerFor, SNAPSHOT_MODELS } from './contract1-models';
import { model } from './model-builder';
import path from 'node:path';

const table = validateTable(shipped);
const classes = readKindClasses(path.resolve(__dirname, '..', 'data'));
const entry = (name: string) => SNAPSHOT_MODELS.find((m) => m.name === name)!;
const two = async (name: string) => (await answerFor(entry(name), 2)).answer;
const cand = (a: any, kind: string, source: string, target: string) => a.candidates.find((c: any) => c.kind === kind && c.source === source && c.target === target);
const effects = (part: any) => part.facts.map((f: any) => [f.at.join('+'), f.value, f.effect]);

/** The answer for a built model, with the listed candidates given (all, by default). */
async function answerOfModel(b: ReturnType<typeof model>, opts: { sizeLimit?: number; list?: (all: any[]) => any[] } = {}) {
  const m = b.fold();
  const matched = await matchCandidates(m, table, { include_pending: true, explain: true });
  const chosen = orderCandidates(boundCandidates(matched.candidates, m, matched.counts), m);
  const candidates = opts.list ? opts.list(chosen) : chosen;
  return answerOf(
    { contract: 2, model: m, table, tableHash: tableHash(shipped), classes, matched, candidates, regime: { kg: 'kg_absent', reason: 'unavailable' }, classesCapped: 0 },
    opts.sizeLimit === undefined ? {} : { sizeLimit: opts.sizeLimit },
  ) as any;
}

describe('the contract-2 envelope', () => {
  it('adds mode, the rationale of the rows it uses and the limits to contract 1’s keys, and explain to each candidate', async () => {
    const a = await two('segment');
    expect(Object.keys(a)).toEqual(['contract', 'module', 'version', 'table_hash', 'regime', 'mode', 'candidates', 'counts', 'rationale', 'limits']);
    expect([a.contract, a.mode]).toEqual([2, 'candidates']);
    const used = new Set(a.candidates.flatMap((c: any) => c.rows));
    expect(Object.keys(a.rationale).sort()).toEqual([...used].sort());
    for (const [id, text] of Object.entries(a.rationale)) expect(text).toBe(shipped.rows.find((r) => r.id === id)!.provenance);
    expect(Object.keys(a.limits)).toEqual(['per_kind_budget', 'max_peers', 'by_kind', 'explain_trimmed', 'remedies_skipped']);
    expect(Object.keys(a.limits.by_kind)).toEqual(['remote-service', 'credential-reuse', 'credential-capture', 'host-escape']);
    for (const c of a.candidates) expect(Object.keys(c.explain)).toEqual(['parts', 'parts_total', 'crown_jewel', 'remedies', 'remedies_total']);
  });

  it('keeps contract 1’s candidates and counts as they are', async () => {
    for (const e of SNAPSHOT_MODELS) {
      const one = (await answerFor(e, 1)).answer;
      const two = (await answerFor(e, 2)).answer;
      expect(two.candidates.map(({ explain: _x, ...c }: any) => c)).toEqual(one.candidates);
      expect(two.counts).toEqual(one.counts);
    }
  });
});

describe('the parts', () => {
  it('each part starts at the candidate’s source and reaches its target, rests on one of its findings, and names its row', async () => {
    for (const e of SNAPSHOT_MODELS) {
      const { answer } = await answerFor(e, 2);
      for (const c of answer.candidates) {
        expect(c.explain.parts.length).toBeGreaterThan(0);
        for (const p of c.explain.parts) {
          expect([p.foothold, p.reached]).toEqual([c.source, c.target]);
          expect(c.rows).toContain(p.row);
          expect(c.technique_ids).toContain(p.path);
          if (c.totals.exposure_ids <= 50) expect(c.exposure_ids).toContain(p.exposure);
        }
      }
    }
  });

  it('judges each part again to the tier the walk gave it', async () => {
    for (const e of SNAPSHOT_MODELS) {
      const { answer } = await answerFor(e, 2);
      for (const c of answer.candidates) {
        for (const p of c.explain.parts) {
          // a candidate the knowledge graph lowered is one step below its parts
          const step = c.kg === 'lowered' ? 1 : 0;
          expect(['low', 'medium', 'high'].indexOf(p.tier) - step, `${e.name} ${c.id}`).toBe(['low', 'medium', 'high'].indexOf(c.tier));
        }
      }
    }
  });

  it('judges every kept part, shown or not, to the tier the walk gave it', async () => {
    for (const e of SNAPSHOT_MODELS) {
      const m = e.build().fold();
      const matched = await matchCandidates(m, table, { ...e.options, explain: true });
      for (const parts of matched.parts!.values()) {
        for (const p of parts) expect(explainPart(matched.topology!, p, m.exposures.get(p.exposures[0])!).tier, `${e.name} ${p.row.id}`).toBe(p.tier);
      }
    }
  });

  it('keeps no parts and no topology for contract 1', async () => {
    const matched = await matchCandidates(entry('segment').build().fold(), table, {});
    expect([matched.parts, matched.topology]).toEqual([undefined, undefined]);
  });

  it('orders the parts confirmed first, keeps three, and says how many there were', async () => {
    const a = await two('fanout');
    const c = a.candidates[0];
    expect(c.explain.parts_total).toBeGreaterThan(MAX_PARTS);
    expect(c.explain.parts).toHaveLength(MAX_PARTS);
    const ids = c.explain.parts.map((p: any) => p.exposure);
    expect(ids).toEqual([...ids].sort());
    // pending findings come after every confirmed one
    const segment = await two('segment');
    const ua = cand(segment, 'remote-service', 'U', 'A');
    expect(ua.explain.parts[0].exposure).toBe('x');
    expect(ua.explain.parts.map((p: any) => p.exposure)).toContain('z');
  });

  it('names the flow, the item, the shared element and the anchored end where the relation has them', async () => {
    const capture = cand(await two('capture'), 'credential-capture', 'W', 'I');
    expect(capture.explain.parts[0]).toMatchObject({ relation: 'capture-footholds', role: 'capture', flow: 'f', shared: 'SEG', anchor: 'f', low: null });
    const reuse = cand(await two('credential'), 'credential-reuse', 'A', 'D2');
    expect(reuse.explain.parts[0]).toMatchObject({ relation: 'shared-credential', item: 'K', flow: 'f2' });
    const kerberos = cand(await two('segment'), 'credential-reuse', 'B', 'A');
    expect(kerberos.explain.parts[0]).toMatchObject({ relation: 'kerberos-realm', flow: 'k1', anchored_end: 'A' });
  });

  it('gives a low relation its reason', async () => {
    expect(cand(await two('segment'), 'remote-service', 'V', 'E2').explain.parts[0].low).toBe('perimeter_only');
    expect(cand(await two('escape'), 'host-escape', 'E', 'N').explain.parts[0].low).toBe('managed_runtime');
    expect(cand(await two('capture'), 'credential-capture', 'F', 'I').explain.parts[0].low).toBe('managed_runtime');
    expect(cand(await two('credential'), 'credential-reuse', 'g0', 'X').explain.parts[0].low).toBe('generic_item');
  });

  it('says which end is a crown jewel', async () => {
    expect(cand(await two('segment'), 'remote-service', 'A', 'B').explain.crown_jewel).toEqual({ source: false, target: true });
  });
});

describe('the facts, attribute by attribute', () => {
  it('a gating attribute stated false meets its condition; the zone target’s own finding is said', async () => {
    const p = cand(await two('segment'), 'remote-service', 'A', 'B').explain.parts[0];
    expect(effects(p)).toContainEqual(['attributes:SEG#east_west_within_segment_restricted', false, 'meets_gate']);
    expect(effects(p)).toContainEqual(['exposure:y', null, 'own_target_finding']);
    expect(p.facts.find((f: any) => f.effect === 'meets_gate').gate).toBeTypeOf('number');
  });

  it('numbers each gating breaker of a part on its own', async () => {
    const p = cand(await two('segment'), 'remote-service', 'A', 'B').explain.parts[0];
    const gates = p.facts.filter((f: any) => f.gate !== undefined).map((f: any) => f.gate);
    expect(new Set(gates).size).toBe(p.basis.gates);
    expect(p.facts_total).toBe(p.facts.length);
  });

  it('a value that is not a boolean answers no condition', async () => {
    const all = await answerOfModel(
      model()
        .boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: 'false' })
        .component('A', 'Application Service', 'PROCESS', 'SEG')
        .component('B', 'Web Server', 'PROCESS', 'SEG')
        .exposure('x', 'SEG', 'Lateral movement on a flat tier', ['T1021']),
    );
    expect(effects(all.candidates[0].explain.parts[0])).toContainEqual(['attributes:SEG#east_west_within_segment_restricted', 'false', 'gate_unanswered']);
    const group = await answerOfModel(
      model()
        .boundary('H', 'Operating System / Host')
        .boundary('C1', 'Container', 'H', {
          container_privileged_mode_disabled: true,
          container_capabilities_dropped_to_minimal: true,
          container_host_namespaces_not_shared: true,
          container_no_sensitive_host_mounts: 'no',
        })
        .component('A', 'Application Service', 'PROCESS', 'C1')
        .component('D', 'Relational Database', 'STORE', 'H')
        .exposure('x', 'C1', 'Privileged mode / excessive capabilities', ['T1611']),
    );
    const facts = group.candidates[0].explain.parts[0].facts;
    // every stated value of a group is context with its value; only absent ones are left open, and none is
    expect(facts.filter((f: any) => f.effect === 'context').map((f: any) => f.value)).toEqual([true, true, true, 'no']);
    expect(facts.some((f: any) => f.effect === 'gate_unanswered')).toBe(false);
  });

  it('a gating attribute not stated is unanswered', async () => {
    const r = await answerOfModel(
      model()
        .boundary('SEG', 'Network Segment')
        .component('A', 'Application Service', 'PROCESS', 'SEG')
        .component('B', 'Web Server', 'PROCESS', 'SEG')
        .exposure('x', 'SEG', 'Lateral movement on a flat tier', ['T1021']),
    );
    const p = r.candidates[0].explain.parts[0];
    expect(effects(p)).toContainEqual(['attributes:SEG#east_west_within_segment_restricted', null, 'gate_unanswered']);
    expect(p.basis.high_reachable).toBe(true);
  });

  it('a group meets its condition on one attribute stated false, once; its true attributes are context', async () => {
    const p = cand(await two('escape'), 'host-escape', 'A', 'B').explain.parts[0];
    expect(effects(p)).toContainEqual(['attributes:C1#container_privileged_mode_disabled', false, 'meets_gate']);
    expect(effects(p)).toContainEqual(['attributes:C1#container_capabilities_dropped_to_minimal', true, 'context']);
    expect(p.basis.gates).toBe(1);
    expect(p.basis.gates_stated).toBe(1);
  });

  it('a group with none stated false and some absent is one unanswered condition, listing the absent attributes', async () => {
    const r = await answerOfModel(
      model()
        .boundary('H', 'Operating System / Host')
        .boundary('C1', 'Container', 'H', { container_privileged_mode_disabled: true })
        .component('A', 'Application Service', 'PROCESS', 'C1')
        .component('D', 'Relational Database', 'STORE', 'H')
        .exposure('x', 'C1', 'Privileged mode / excessive capabilities', ['T1611']),
    );
    const facts = r.candidates[0].explain.parts[0].facts;
    const unanswered = facts.filter((f: any) => f.effect === 'gate_unanswered');
    expect(unanswered).toHaveLength(1);
    expect(unanswered[0].at).toEqual([
      'attributes:C1#container_capabilities_dropped_to_minimal',
      'attributes:C1#container_host_namespaces_not_shared',
      'attributes:C1#container_no_sensitive_host_mounts',
    ]);
    expect(facts).toContainEqual({ at: ['attributes:C1#container_privileged_mode_disabled'], value: true, effect: 'context', gate: 0 });
  });

  it('a gating attribute stated true misses its condition', async () => {
    const p = cand(await two('stated'), 'remote-service', 'A', 'B').explain.parts[0];
    expect(effects(p)).toContainEqual(['attributes:SEG#east_west_within_segment_restricted', true, 'misses_gate']);
  });

  it('a group that lowers one step is one fact, with every attribute in it', async () => {
    const r = await answerOfModel(
      model()
        .boundary('H', 'Operating System / Host', null, { mandatory_access_control_enforcing: true, unprivileged_user_namespaces_restricted: true, host_patch_level_current: true })
        .boundary('C1', 'Container', 'H', { container_privileged_mode_disabled: false })
        .component('A', 'Application Service', 'PROCESS', 'C1')
        .component('D', 'Relational Database', 'STORE', 'H')
        .exposure('x', 'C1', 'Privileged mode / excessive capabilities', ['T1611']),
    );
    const p = r.candidates[0].explain.parts[0];
    const lowering = p.facts.filter((f: any) => f.effect === 'lowers');
    expect(lowering).toEqual([
      { at: ['attributes:H#mandatory_access_control_enforcing', 'attributes:H#unprivileged_user_namespaces_restricted', 'attributes:H#host_patch_level_current'], value: null, effect: 'lowers' },
    ]);
    expect(lowering.length).toBe(p.basis.lowers);
  });

  it('a lowering attribute lowers, an enabling one raises, a control lowers', async () => {
    const credential = await two('credential');
    expect(effects(cand(credential, 'credential-reuse', 'A', 'D2').explain.parts[0])).toContainEqual(['attributes:f2#per_workload_db_identity_used', true, 'lowers']);
    expect(effects(cand(credential, 'credential-reuse', 'A', 'Z').explain.parts[0])).toContainEqual(['attributes:AL#shared_service_credentials_used', true, 'raises']);
    const capture = await two('capture');
    const lowered = capture.candidates.filter((c: any) => c.explain.parts.some((p: any) => effects(p).some((f: any) => f[0] === 'control:k')));
    expect(lowered.length).toBeGreaterThan(0);
    expect(lowered[0].explain.parts[0].facts.find((f: any) => f.at[0] === 'control:k')).toEqual({ at: ['control:k'], value: null, effect: 'lowers' });
  });

  it('the knowledge graph’s lowering is said once, on the primary part, after the model’s facts', async () => {
    const c = cand(await two('lowered'), 'remote-service', 'A', 'B');
    expect(c.kg).toBe('lowered');
    const facts = c.explain.parts[0].facts;
    expect(facts[facts.length - 1]).toEqual({ at: ['kg:rule:flat'], value: null, effect: 'kg_lowered' });
    for (const e of SNAPSHOT_MODELS) {
      for (const x of (await answerFor(e, 2)).answer.candidates) {
        for (const p of x.explain.parts.slice(1)) expect(p.facts.some((f: any) => f.effect === 'kg_lowered')).toBe(false);
      }
    }
  });

  it('cuts a stated string by characters, never inside one, and replaces what cannot be shown', () => {
    expect([...(factValue('\u{1F600}'.repeat(70)) as string)]).toHaveLength(64);
    expect(factValue('a\ud800b\u2028c\u{e0041}d')).toBe('a?b?c?d');
    // format, variation-selector and private-use characters too
    expect(factValue('a\u0600b\ufe0fc\ue000d\u{e0080}e')).toBe('a?b?c?d?e');
    expect([factValue(Number.NaN), factValue({}), factValue([1])]).toEqual([null, null, null]);
  });

  it('carries a stated value as it is, a string cut to 64 characters without control characters', async () => {
    const r = await answerOfModel(
      model()
        .boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: `no‮${'x'.repeat(100)}` })
        .component('A', 'Application Service', 'PROCESS', 'SEG')
        .component('B', 'Web Server', 'PROCESS', 'SEG')
        .exposure('x', 'SEG', 'Lateral movement on a flat tier', ['T1021']),
    );
    const f = r.candidates[0].explain.parts[0].facts.find((x: any) => x.at[0].endsWith('#east_west_within_segment_restricted'));
    expect(f.value).toHaveLength(64);
    expect(f.value.startsWith('no?x')).toBe(true);
  });
});

describe('the reasons beside the tier', () => {
  it('names each cap that keeps a pair below high, and whether high is in reach', async () => {
    const segment = await two('segment');
    expect(cand(segment, 'remote-service', 'V', 'E2').explain.parts[0].basis).toMatchObject({ caps: expect.arrayContaining(['low_relation']), high_reachable: false });
    expect(cand(segment, 'remote-service', 'U', 'A').explain.parts[0].basis.caps).toContain('zone_without_own_finding');
    expect(cand(segment, 'credential-reuse', 'B', 'A').explain.parts[0].basis.caps).toContain('row_cap');
    const pending = cand(await two('escape'), 'host-escape', 'E', 'N').explain.parts[0].basis;
    expect(pending.caps).toContain('pending');
    expect(pending.confirmed).toBe(false);
    const high = cand(segment, 'remote-service', 'A', 'B').explain.parts[0].basis;
    expect(high).toMatchObject({ confirmed: true, caps: [], high_reachable: true });
    expect(high.gates_stated).toBe(high.gates);
  });

  it('puts high out of reach where the rule has no condition to state on the pair, or its technique allows less', async () => {
    const reuse = cand(await two('credential'), 'credential-reuse', 'A', 'X').explain.parts[0].basis;
    expect(reuse.gates).toBe(0);
    expect(reuse).toMatchObject({ high_reachable: false });
    expect(reuse.caps).toContain('no_gate');
    expect(reuse.caps).toContain('technique_cap');
  });
});

describe('the limits', () => {
  it('counts per kind what is listed and what is not', async () => {
    const b = model().boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false });
    for (let i = 0; i < 6; i++) b.component(`c${i}`, 'Application Service', 'PROCESS', 'SEG');
    const r = await answerOfModel(b.exposure('x', 'SEG', 'Lateral movement on a flat tier', ['T1021']), { list: (all) => all.slice(0, 4) });
    // 6 × 5 pairs, 20 kept by the peer cap, 4 listed
    expect(r.limits.by_kind['remote-service']).toMatchObject({ listed: 4, not_listed: 16 });
    expect(r.limits.by_kind['host-escape']).toEqual({ listed: 0, not_listed: 0, pairs_capped: 0, anchors_over_budget: 0 });
  });

  it('does not count a decided pair as one not listed', async () => {
    const a = await two('segment');
    expect(a.counts.excluded_by_decision).toBeGreaterThan(0);
    expect(a.limits.by_kind['remote-service'].not_listed).toBe(0);
  });

  it('counts the anchors cut at their pair budget, per kind', async () => {
    const b = model().boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false });
    for (let i = 0; i < 1_100; i++) b.component(`c${String(i).padStart(4, '0')}`, 'Application Service', 'PROCESS', 'SEG');
    const r = await answerOfModel(b.exposure('x', 'SEG', 'Lateral movement on a flat tier', ['T1021']));
    expect(r.limits.by_kind['remote-service'].anchors_over_budget).toBe(r.counts.pairs_over_anchor_budget);
    expect(r.limits.by_kind['remote-service'].anchors_over_budget).toBe(1);
  });

  it('counts the pairs past the peer cap, per kind', async () => {
    const b = model().boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false });
    for (let i = 0; i < 30; i++) b.component(`c${String(i).padStart(2, '0')}`, 'Application Service', 'PROCESS', 'SEG');
    b.component('V', 'VPN Gateway', 'PROCESS', 'SEG').flow('f', 'Secure Remote Access', 'V', 'c00').exposure('x', 'V', 'Flat internal access after admission', ['T1021']);
    const r = await answerOfModel(b);
    expect(r.limits.by_kind['remote-service'].pairs_capped).toBe(r.counts.peers_capped);
    expect(r.limits.by_kind['remote-service'].pairs_capped).toBeGreaterThan(0);
  });

  it('counts the reached ends a zone egress cuts before the walk', async () => {
    const b = model()
      .boundary('OFF', 'Endpoint / Office Environment', null, { user_segment_isolated_from_production_tiers: false })
      .boundary('PROD', 'Network Segment')
      .component('W', 'User Workstation / Endpoint', 'PROCESS', 'OFF');
    for (let i = 0; i < 25; i++) b.component(`p${String(i).padStart(2, '0')}`, 'Application Service', 'PROCESS', 'PROD');
    const r = await answerOfModel(b.exposure('x', 'OFF', 'Flat office network reaches production', ['T1021']));
    expect(r.candidates.length).toBe(20);
    expect(r.limits.by_kind['remote-service'].pairs_capped).toBe(5);
    // contract 1's counts are unchanged by it
    expect(r.counts.peers_capped).toBe(0);
  });
});

describe('the size trim', () => {
  it('keeps every explanation under the limit, the primary part first, then leaves explanations out from the last candidate up', async () => {
    const full = (await answerFor(entry('fanout'), 2)).answer;
    const size = JSON.stringify(full).length;
    expect(full.limits.explain_trimmed).toBe(0);
    // just under the full size: each candidate keeps its primary part only
    const primary = (await answerFor(entry('fanout'), 2, size - 1)).answer;
    expect(JSON.stringify(primary).length).toBeLessThanOrEqual(size - 1);
    expect(primary.candidates.every((c: any) => c.explain.parts.length === 1 && c.explain.parts_total > 1)).toBe(true);
    expect(primary.limits.explain_trimmed).toBe(2);
    // far under: the last candidate's explanation is left out first, never the answer
    const limit = JSON.stringify(primary).length - 50;
    const tight = (await answerFor(entry('fanout'), 2, limit)).answer;
    expect(tight.candidates.map((c: any) => 'omitted' in c.explain)).toEqual([false, true]);
    expect(JSON.stringify(tight).length).toBeLessThanOrEqual(limit);
    expect(tight.limits.explain_trimmed).toBe(2);
    const none = (await answerFor(entry('fanout'), 2, 10)).answer;
    expect(none.candidates.every((c: any) => c.explain.omitted === 'size')).toBe(true);
    expect(none.candidates).toHaveLength(full.candidates.length);
    expect(none.limits.explain_trimmed).toBe(full.candidates.length);
  });
});

describe('determinism', () => {
  it('explains the same whatever order the table’s rows come in', async () => {
    const reversedTable = validateTable({ ...shipped, rows: [...shipped.rows].reverse() });
    const run = async (t: typeof table) => {
      const m = entry('segment').build().fold();
      const matched = await matchCandidates(m, t, { ...entry('segment').options, explain: true });
      const candidates = orderCandidates(boundCandidates(matched.candidates, m, matched.counts), m);
      return answerOf({ contract: 2, model: m, table: t, tableHash: 'h', classes, matched, candidates, regime: { kg: 'kg_absent', reason: 'unavailable' }, classesCapped: 0 });
    };
    expect(await run(reversedTable)).toEqual(await run(table));
  });

  it('explains the same whatever order the rows come in', async () => {
    const a = (await answerFor(entry('segment'), 2)).answer;
    const reversed = {
      ...entry('segment'),
      build: () => {
        const b = entry('segment').build();
        const rows = (b as any).rows;
        for (const k of Object.keys(rows)) if (Array.isArray(rows[k])) rows[k].reverse();
        return b;
      },
    };
    expect((await answerFor(reversed, 2)).answer).toEqual(a);
  });
});
