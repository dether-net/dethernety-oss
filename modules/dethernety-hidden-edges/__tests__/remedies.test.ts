/**
 * Contract 2's remedies: each change a part's breakers suggest, judged again over every way into the edge, gives
 * `removes`, `lowers_to:<tier>` or `this_path_only`; the strongest five, with their total; their own budget.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import shipped from '../src/edge-kinds.json';
import { answerOf } from '../src/answer';
import { Deadline } from '../src/bounds';
import { readKindClasses } from '../src/classes';
import { boundCandidates, explainPart, matchCandidates, orderCandidates } from '../src/generate';
import { MAX_REMEDIES, REMEDY_YIELD_EVERY, RemedyBudget, remediesFor } from '../src/remedies';
import { validateTable } from '../src/table';
import { answerFor, SNAPSHOT_MODELS } from './contract1-models';
import { model } from './model-builder';

const table = validateTable(shipped);
const classes = readKindClasses(path.resolve(__dirname, '..', 'data'));
const entry = (name: string) => SNAPSHOT_MODELS.find((m) => m.name === name)!;
const two = async (name: string) => (await answerFor(entry(name), 2)).answer;
const cand = (a: any, kind: string, source: string, target: string) => a.candidates.find((c: any) => c.kind === kind && c.source === source && c.target === target);
const setOf = (r: any) => (r.set ? r.set.map((x: any) => x.at).join('+') : `control ${r.control_classes.join('/')} on ${r.on}`);

async function answerOfModel(b: ReturnType<typeof model>, over: { remedyJudges?: number; deadline?: Deadline } = {}) {
  const m = b.fold();
  const matched = await matchCandidates(m, table, { include_pending: true, explain: true });
  const candidates = orderCandidates(boundCandidates(matched.candidates, m, matched.counts), m);
  return answerOf({ contract: 2, model: m, table, tableHash: 'h', classes, matched, candidates, regime: { kg: 'kg_absent', reason: 'unavailable' }, classesCapped: 0, ...over }) as any;
}

/** A credential sent over internal service traffic stated without mutual TLS, intercepted from a segment peer. */
const intercepted = () =>
  model()
    .boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false })
    .component('A', 'Application Service', 'PROCESS', 'SEG')
    .component('B', 'Application Service', 'PROCESS', 'SEG')
    .component('W', 'Web Server', 'PROCESS', 'SEG')
    .data('K', 'User Credentials', true)
    .flow('isc', 'Internal Service Communication', 'A', 'B', { service_to_service_mtls_enforced: false }, ['K'])
    .exposure('x', 'isc', 'Missing service-to-service mutual TLS', ['T1557']);

describe('what a remedy says', () => {
  it('a finding that fires on other conditions too is not cleared: the edge only drops', async () => {
    // the cleartext bind finding also fires on ldap_tls_required and starttls_downgrade_prevented
    const r = cand(await two('capture'), 'credential-capture', 'W', 'I').explain.remedies.find((x: any) => setOf(x) === 'attributes:f#encryption_in_transit_enabled');
    expect(r).toEqual({ set: [{ at: 'attributes:f#encryption_in_transit_enabled' }], outcome: 'lowers_to:medium' });
  });

  it('a finding that fires only on the attributes clears, and the edge on it goes', async () => {
    const r = cand(await two('escape'), 'host-escape', 'A', 'B').explain.remedies[0];
    expect(r).toMatchObject({ outcome: 'removes', clears_finding: 'x' });
    expect(r.set.map((x: any) => x.at)).toContain('attributes:C1#container_privileged_mode_disabled');
  });

  it('closes one way in only, when another part keeps the tier', async () => {
    const c = cand(await two('capture'), 'credential-capture', 'F', 'I');
    expect(c.explain.parts_total).toBe(2);
    expect(c.explain.remedies.find((r: any) => setOf(r) === 'attributes:I#tls_only_transport').outcome).toBe('this_path_only');
  });

  it('a gating breaker that lowers keeps the edge below high', async () => {
    const a = await answerOfModel(intercepted());
    const c = a.candidates.find((x: any) => x.kind === 'credential-capture' && x.source === 'W');
    expect(c.tier).toBe('high');
    expect(c.explain.remedies).toContainEqual({ set: [{ at: 'attributes:isc#service_to_service_mtls_enforced' }], outcome: 'lowers_to:medium' });
  });

  it('a control remedy names its classes, its attributes, the item classes it protects and where it goes', async () => {
    const credential = await two('credential');
    expect(cand(credential, 'credential-reuse', 'A', 'X').explain.remedies).toEqual([
      { control_classes: ['Multi-Factor Authentication'], attributes_true: ['mfa_enforced_for_admin'], item_classes: ['User Credentials'], on: 'X', outcome: 'lowers_to:low' },
    ]);
    // multi-factor authentication protects a person's password, not a token
    const token = cand(credential, 'credential-reuse', 'A', 'Z');
    expect(token.explain.remedies.some((r: any) => r.control_classes?.includes('Multi-Factor Authentication'))).toBe(false);
  });

  it('never offers what the model already states', async () => {
    const c = cand(await two('stated'), 'remote-service', 'A', 'B');
    expect(c.explain.remedies.some((r: any) => setOf(r) === 'attributes:SEG#east_west_within_segment_restricted')).toBe(false);
  });

  it('keeps the strongest five, removals first, with how many there were', async () => {
    for (const e of SNAPSHOT_MODELS) {
      for (const c of (await answerFor(e, 2)).answer.candidates) {
        const { remedies, remedies_total } = c.explain;
        expect(remedies.length).toBeLessThanOrEqual(MAX_REMEDIES);
        expect(remedies_total).toBeGreaterThanOrEqual(remedies.length);
        const ranks = remedies.map((r: any) => ['removes', 'lowers_to:low', 'lowers_to:medium', 'this_path_only'].indexOf(r.outcome));
        expect(ranks).toEqual([...ranks].sort((x: number, y: number) => x - y));
        expect(ranks.every((x: number) => x >= 0)).toBe(true);
      }
    }
    const c = cand(await two('segment'), 'remote-service', 'U', 'B');
    expect(c.explain.remedies).toHaveLength(MAX_REMEDIES);
  });

  it('a candidate the knowledge graph lowered is judged on its parts’ own evidence', async () => {
    const c = cand(await two('lowered'), 'remote-service', 'A', 'B');
    expect([c.kg, c.tier, c.explain.parts[0].tier]).toEqual(['lowered', 'medium', 'high']);
    // a change that only fails the high gate lowers the parts' high to medium, said against the parts, not the shown tier
    expect(c.explain.remedies).toContainEqual({ control_classes: ['Multi-Factor Authentication'], attributes_true: ['mfa_enforced_for_admin'], item_classes: [], on: 'B', outcome: 'lowers_to:medium' });
  });

  it('clears every finding the change makes untrue, whichever part names it first', async () => {
    const build = (first: [string, string, string[]], second: [string, string, string[]]) =>
      model()
        .boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false })
        .component('A', 'Application Service', 'PROCESS', 'SEG')
        .component('B', 'Application Service', 'PROCESS', 'SEG')
        .component('W', 'Web Server', 'PROCESS', 'SEG')
        .data('K', 'User Credentials', true)
        .flow('isc', 'Internal Service Communication', 'A', 'B', { service_to_service_mtls_enforced: false }, ['K'])
        .exposure(first[0], 'isc', first[1], first[2])
        .exposure(second[0], 'isc', second[1], second[2]);
    const plaintext = 'Plaintext east-west traffic (no mTLS)';
    const remedyOf = async (b: ReturnType<typeof build>) =>
      (await answerOfModel(b)).candidates.find((x: any) => x.source === 'W').explain.remedies.find((r: any) => setOf(r) === 'attributes:isc#service_to_service_mtls_enforced');
    const one = await remedyOf(build(['a', 'Missing service-to-service mutual TLS', ['T1557']], ['b', plaintext, ['T1040']]));
    const swapped = await remedyOf(build(['a', plaintext, ['T1040']], ['b', 'Missing service-to-service mutual TLS', ['T1557']]));
    expect(one.clears_finding).toBe('b');
    expect(swapped.clears_finding).toBe('a');
    expect(swapped.outcome).toBe(one.outcome);
  });
});

describe('one flow named of several', () => {
  it('a capture stays when another cleartext flow carries a credential to the same receiver', async () => {
    const two = (encrypted: boolean) =>
      model()
        .boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false })
        .component('A', 'Application Service', 'PROCESS', 'SEG')
        .component('C', 'Application Service', 'PROCESS', 'SEG')
        .component('I', 'Identity Provider', 'PROCESS', 'SEG')
        .component('W', 'Web Server', 'PROCESS', 'SEG')
        .data('K', 'User Credentials', true)
        .flow('f1', 'Database Query', 'A', 'I', { flow_tls_encrypted: false }, ['K'])
        .flow('f2', 'Database Query', 'C', 'I', { flow_tls_encrypted: encrypted }, ['K'])
        .exposure('x', 'f1', 'Cleartext database protocol', ['T1040']);
    const remedyOf = async (encrypted: boolean) =>
      (await answerOfModel(two(encrypted))).candidates.find((x: any) => x.source === 'W' && x.target === 'I').explain.remedies.find((r: any) => setOf(r) === 'attributes:f1#flow_tls_encrypted');
    expect((await remedyOf(false)).outcome).toBe('this_path_only');
    // with the other flow encrypted, the named one is the only way in left: stating it encrypted lowers the edge
    expect((await remedyOf(true)).outcome).not.toBe('this_path_only');
  });

  it('a capture stays when the credential reaches its end over another flow than the one whose response carried it', async () => {
    const a = await answerOfModel(
      model()
        .boundary('SEG1', 'Network Segment', null, { east_west_within_segment_restricted: false })
        .boundary('SEG2', 'Network Segment', null, { east_west_within_segment_restricted: false })
        .component('C', 'Application Service', 'PROCESS', 'SEG1')
        .component('Y', 'Application Service', 'PROCESS', 'SEG1')
        .component('V', 'Identity Provider', 'PROCESS', 'SEG1')
        .component('A', 'Application Service', 'PROCESS', 'SEG2')
        .component('T', 'Relational Database', 'STORE', 'SEG2')
        .data('K', 'User Credentials', true)
        .flow('fa', 'Secret Retrieval', 'Y', 'V', { encryption_in_transit_enabled: false }, ['K'])
        .flow('fb', 'Database Query', 'Y', 'T', { flow_tls_encrypted: false }, ['K'])
        .exposure('x', 'Y', 'Credentials captured in transit', ['T1040']),
    );
    const c = a.candidates.find((x: any) => x.kind === 'credential-capture' && x.source === 'C' && x.target === 'T');
    expect(c.explain.parts.some((p: any) => p.flow === 'fa')).toBe(true);
    const r = c.explain.remedies.find((x: any) => setOf(x) === 'attributes:fa#encryption_in_transit_enabled');
    expect(r?.outcome).not.toBe('removes');
  });

  it('a credential reuse stays when another flow carries the same credential into the acceptor', async () => {
    const reuse = () =>
      model()
        .boundary('SEG', 'Network Segment')
        .component('H', 'Application Service', 'PROCESS', 'SEG')
        .component('Z', 'Application Service', 'PROCESS', 'SEG')
        .component('A', 'Application Service', 'PROCESS', 'SEG')
        .component('B', 'Application Service', 'PROCESS', 'SEG')
        .component('T', 'Relational Database', 'STORE', 'SEG')
        .data('K', 'User Credentials', true)
        .flow('h', 'API Call', 'H', 'Z', {}, ['K'])
        .flow('f1', 'Database Query', 'A', 'T', {}, ['K'])
        .flow('f2', 'API Call', 'B', 'T', {}, ['K'])
        .exposure('x', 'H', 'Hardcoded / leaked secrets & over-privileged service identity', ['T1078', 'T1552', 'T1552.001']);
    const c = (await answerOfModel(reuse())).candidates.find((x: any) => x.source === 'H' && x.target === 'T');
    expect(c.explain.parts[0].flow).toBe('f1');
    const r = c.explain.remedies.find((x: any) => setOf(x) === 'attributes:f1#per_workload_db_identity_used');
    expect(r.outcome).toBe('this_path_only');
  });
});

describe('every way into the edge', () => {
  it('a way in past the peer cap that survives a change keeps the edge', async () => {
    const e = entry('capture');
    const m = e.build().fold();
    const matched = await matchCandidates(m, table, { ...e.options, explain: true });
    const id = (await answerFor(e, 2)).answer.candidates.find((c: any) => c.source === 'F' && c.target === 'I').id;
    const [sniff, intercept] = [...matched.parts!.get(id)!].sort((a, b) => (a.row.id < b.row.id ? -1 : 1));
    const outcome = async (kept: any[], pastCap: any[]) =>
      (await remediesFor(matched.topology!, m, kept, pastCap, new RemedyBudget()))!.remedies.find((r: any) => setOf(r) === 'attributes:I#tls_only_transport')?.outcome;
    // stating TLS-only at the receiver removes the sniffing way in and leaves the interception one
    expect(await outcome([sniff], [])).toBe('removes');
    expect(await outcome([sniff], [intercept])).not.toBe('removes');
  });

  it('a removal past a way in the zone egress cut is said with that cut beside it, for its kind', async () => {
    // V sits in the office zone Z1 and reaches every segmented process outside it: 26 ends, of which the zone egress
    // keeps 20 (p00..p19) and cuts the rest, p24 among them. V's own landing in Z2 reaches p24 again, walked.
    const b = model()
      .boundary('Z1', 'Endpoint / Office Environment', null, { user_segment_isolated_from_production_tiers: false })
      .boundary('Z2', 'Network Segment', null, { east_west_within_segment_restricted: false })
      .boundary('Z3', 'Network Segment')
      .component('V', 'VPN Gateway', 'PROCESS', 'Z1')
      .component('q0', 'Application Service', 'PROCESS', 'Z2')
      .component('p24', 'Application Service', 'PROCESS', 'Z2');
    for (let i = 0; i < 24; i++) b.component(`p${String(i).padStart(2, '0')}`, 'Application Service', 'PROCESS', 'Z3');
    b.flow('land', 'Secure Remote Access', 'V', 'q0')
      .exposure('x', 'Z1', 'Flat office network reaches production', ['T1021'])
      .exposure('v', 'V', 'Flat internal access after admission', ['T1021']);
    const a = await answerOfModel(b);
    // the cut dropped the zone egress's way into V→p24; only the landing's way in was walked and judged
    expect(cand(a, 'remote-service', 'V', 'p20')).toBeUndefined();
    const c = cand(a, 'remote-service', 'V', 'p24');
    expect(c.rows).toEqual(['remote-service/rs-4v']);
    expect(c.explain.parts_total).toBe(1);
    expect(c.explain.remedies).toContainEqual({ set: [{ at: 'attributes:V#vpn_pool_to_trust_segmentation_enforced' }], outcome: 'removes' });
    // so the kind's limits carry the cut (one starting point, six ends), and a client says other paths may remain
    // beside the removal
    expect(a.limits.by_kind['remote-service'].pairs_capped).toBe(6);
  });

  it('keeps the parts past the cap only for keys it may list, without their facts, and only for contract 2', async () => {
    const b = model().boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false });
    for (let i = 0; i < 30; i++) b.component(`c${String(i).padStart(2, '0')}`, 'Application Service', 'PROCESS', 'SEG');
    b.component('V', 'VPN Gateway', 'PROCESS', 'SEG').flow('f', 'Secure Remote Access', 'V', 'c00').exposure('x', 'V', 'Flat internal access after admission', ['T1021']);
    const m = b.fold();
    const matched = await matchCandidates(m, table, { include_pending: true, explain: true });
    for (const [id, parts] of matched.pastCap!) {
      expect(matched.parts!.has(id)).toBe(true);
      expect(parts.every((p) => p.facts.length === 0)).toBe(true);
    }
    expect((await matchCandidates(m, table, { include_pending: true })).pastCap).toBeUndefined();
  });

  it('states its changes on a copy: the model judges the same after the remedies', async () => {
    const e = entry('capture');
    const m = e.build().fold();
    const matched = await matchCandidates(m, table, { ...e.options, explain: true });
    const candidates = orderCandidates(boundCandidates(matched.candidates, m, matched.counts), m);
    const before = [...matched.parts!.values()].flat().map((p) => explainPart(matched.topology!, p, m.exposures.get(p.exposures[0])!));
    await answerOf({ contract: 2, model: m, table, tableHash: 'h', classes, matched, candidates, regime: { kg: 'kg_absent', reason: 'unavailable' }, classesCapped: 0 });
    const after = [...matched.parts!.values()].flat().map((p) => explainPart(matched.topology!, p, m.exposures.get(p.exposures[0])!));
    expect(after).toEqual(before);
  });
});

describe('the remedies’ own budget', () => {
  it('past its count, the candidates left get none, counted, and the answer still arrives whole', async () => {
    const full = await answerOfModel(intercepted());
    const short = await answerOfModel(intercepted(), { remedyJudges: 1 });
    expect(short.candidates.map((c: any) => c.id)).toEqual(full.candidates.map((c: any) => c.id));
    expect(short.candidates.some((c: any) => c.explain.remedies === null)).toBe(true);
    expect(short.limits.remedies_skipped).toBe(short.candidates.filter((c: any) => c.explain.remedies === null).length);
    expect(full.limits.remedies_skipped).toBe(0);
  });

  it('gives no remedies once the budget is spent, without spending more', async () => {
    const e = entry('capture');
    const m = e.build().fold();
    const matched = await matchCandidates(m, table, { ...e.options, explain: true });
    const parts = [...matched.parts!.values()][0];
    const budget = new RemedyBudget(undefined, 0);
    expect(await remediesFor(matched.topology!, m, parts, [], budget)).toBeNull();
    expect(budget.judged).toBe(0);
  });

  it('leaves the call’s last seconds to the answer', async () => {
    let now = 0;
    const deadline = new Deadline(25_000, () => now);
    now = 21_000;
    const a = await answerOfModel(intercepted(), { deadline });
    expect(a.candidates.every((c: any) => c.explain.remedies === null)).toBe(true);
    expect(a.limits.remedies_skipped).toBe(a.candidates.length);
  });

  /** The parts of the capture model's first candidate, with `copies` more of its first part past the cap. */
  async function manyParts(copies: number) {
    const e = entry('capture');
    const m = e.build().fold();
    const matched = await matchCandidates(m, table, { ...e.options, explain: true });
    const parts = [...matched.parts!.values()][0];
    return { t: matched.topology!, m, parts, pastCap: Array.from({ length: copies }, () => parts[0]) };
  }

  it('counts reading the parts against the call’s deadline, before judging any', async () => {
    const { t, m, parts, pastCap } = await manyParts(30_000);
    // every reading of the clock moves it on a millisecond: the reserve is reached while the parts are read
    let now = 0;
    const budget = new RemedyBudget(new Deadline(25_000, () => (now += 1)));
    expect(await remediesFor(t, m, parts, pastCap, budget)).toBeNull();
    expect(budget.judged).toBe(0);
  });

  it('gives the event loop turns while it works', async () => {
    const { t, m, parts, pastCap } = await manyParts(REMEDY_YIELD_EVERY * 2);
    let turns = 0;
    let on = true;
    const tick = () => {
      turns += 1;
      if (on) setImmediate(tick);
    };
    setImmediate(tick);
    const r = await remediesFor(t, m, parts, pastCap, new RemedyBudget());
    on = false;
    expect(r).not.toBeNull();
    expect(turns).toBeGreaterThan(1);
  });
});
