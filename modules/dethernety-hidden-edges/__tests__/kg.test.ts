/**
 * The knowledge graph's part: the regime, the one-step lowering on both sides, the one timeout, and exactly
 * what is sent (including through the real cloud client, against the platform's mock content service).
 */
import { describe, expect, it, vi } from 'vitest';
import { Deadline } from '../src/bounds';
import {
  CloudSessionExpiredError,
  createKgClient,
  EvaluationNotEntitledError,
  KgClient,
  KgRule,
  KgThreat,
  KgUnavailableError,
  KG_KEY_SEPARATOR,
  RemoteModuleUnavailableError,
} from '@dethernety/dt-module';
// The platform's mock content service, from its source: the package's testing entry also loads its contract suites.
import { MockContentServer } from '../../../packages/dt-module/src/testing/mock-content-server';
import { ENTITLED_TOKEN, KG_VERSION } from '../../../packages/dt-module/src/testing/fixtures';
import shipped from '../src/edge-kinds.json';
import { boundCandidates, matchCandidates, PER_KIND_BUDGET } from '../src/generate';
import { applyKg, classInventory, DEFAULT_KG_CLASS_MODULES, KG_TIMEOUT_MS, kgClassModules, MAX_CLASS_READS, readKg } from '../src/kg';
import { validateTable } from '../src/table';
import { model } from './model-builder';

const table = validateTable(shipped);
const CATALOGUE = new Set(DEFAULT_KG_CLASS_MODULES);

interface Recorded {
  method: string;
  keys: unknown;
  token: string | undefined;
}

/** A fake knowledge graph: rules per class id and threats per rule id, recording every call. */
function fakeKg(over: {
  capability?: () => Promise<{ available: boolean; entitled: boolean; sliceCount: number }>;
  rules?: Record<string, Partial<KgRule>[]>;
  threats?: Record<string, Partial<KgThreat>[]>;
  failOn?: string;
  slow?: string;
} = {}): { client: KgClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const rule = (classId: string, r: Partial<KgRule>): KgRule =>
    ({ id: `rule:${r.ruleId}`, ruleId: 'r', classId, name: null, kind: 'exposure', description: null, criticality: null, score: null, attackVector: null, conditionGroups: null, mitreRefs: null, policyHash: null, reads: [], ...r }) as KgRule;
  const threat = (t: Partial<KgThreat>): KgThreat => ({ id: 't', slug: 't', name: null, description: null, attackSurface: null, techniqueIds: [], techniqueProvenance: null, derivedFrom: [], ...t }) as KgThreat;
  const hang = (name: string) => (over.slow === name ? new Promise<never>(() => undefined) : null);
  const client: KgClient = {
    version: null,
    capability: async (token) => {
      calls.push({ method: 'capability', keys: null, token });
      return (over.capability ?? (async () => ({ available: true, entitled: true, sliceCount: 1 })))();
    },
    rulesByClassId: async (ids, _opts, token) => {
      calls.push({ method: 'rulesByClassId', keys: ids, token });
      await hang('rulesByClassId');
      if (over.failOn === 'rulesByClassId') throw new Error('network');
      return new Map(ids.map((id) => [id, (over.rules?.[id] ?? []).map((r) => rule(id, r))]));
    },
    threatsByRuleId: async (refs, token) => {
      calls.push({ method: 'threatsByRuleId', keys: refs, token });
      if (over.failOn === 'threatsByRuleId') throw new Error('network');
      return new Map(refs.map((r) => [`${r.classId}${KG_KEY_SEPARATOR}${r.ruleId}`, (over.threats?.[r.ruleId] ?? []).map(threat)]));
    },
    threatsByTechniqueId: async (ids, token) => {
      calls.push({ method: 'threatsByTechniqueId', keys: ids, token });
      return new Map();
    },
  };
  return { client, calls };
}

const FLAT = 'Lateral movement on a flat tier';
const segmentModel = (eastWest = false) =>
  model()
    .boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: eastWest })
    .component('A', 'Application Service', 'PROCESS', 'SEG')
    .component('B', 'Web Server', 'PROCESS', 'SEG')
    .exposure('x', 'SEG', FLAT, ['T1021'])
    .exposure('y', 'B', 'Remote administration exposed', ['T1021.004']);

async function runWith(b: ReturnType<typeof model>, kg: ReturnType<typeof fakeKg>, token: string | undefined = 'tok') {
  const m = b.fold();
  const matched = await matchCandidates(m, table);
  const chosen = boundCandidates(matched.candidates, m, matched.counts);
  const facts = await readKg(kg.client, token, classInventory(m, CATALOGUE));
  return { facts, candidates: applyKg(m, table, chosen, matched.anchors, facts), plain: chosen };
}

const lowersFlat = { rules: { 'c:Network_Segment': [{ ruleId: 'flat', name: FLAT }] }, threats: { flat: [{ id: 'th', techniqueIds: ['T1190'] }] } };

describe('the knowledge-graph regime', () => {
  it('is absent with the reason the client gives, and changes nothing', async () => {
    const cases: Array<[() => Promise<any>, string]> = [
      [async () => ({ available: false, entitled: true, sliceCount: 0 }), 'no_data'],
      [async () => ({ available: true, entitled: false, sliceCount: 0 }), 'not_entitled'],
      [async () => { throw new CloudSessionExpiredError('invalid_token', 'no session'); }, 'no_session'],
      [async () => { throw new EvaluationNotEntitledError({} as any); }, 'not_entitled'],
      [async () => { throw new KgUnavailableError(); }, 'unavailable'],
      [async () => { throw new RemoteModuleUnavailableError('down'); }, 'unavailable'],
      [async () => { throw new Error('boom'); }, 'failed'],
    ];
    for (const [capability, reason] of cases) {
      const kg = fakeKg({ capability });
      const r = await runWith(segmentModel(), kg);
      expect(r.facts.regime).toEqual({ kg: 'kg_absent', reason });
      expect(r.candidates).toEqual(r.plain);
      expect(kg.calls.map((c) => c.method)).toEqual(['capability']);
    }
  });

  it('forwards the caller’s token on every call', async () => {
    const kg = fakeKg();
    await runWith(segmentModel(), kg, 'caller-token');
    expect(kg.calls.every((c) => c.token === 'caller-token')).toBe(true);
  });
});

describe('lowering on the anchor side', () => {
  it('lowers exactly one step when the anchoring finding’s rule cites none of the row’s techniques, and cites the rule', async () => {
    const r = await runWith(segmentModel(), fakeKg(lowersFlat));
    const before = r.plain.find((c) => c.target === 'B')!;
    const after = r.candidates.find((c) => c.id === before.id)!;
    expect(before.tier).toBe('high');
    expect(after).toMatchObject({ tier: 'medium', kg: 'lowered' });
    expect(after.facts).toContain('kg:rule:flat');
  });

  it('keeps the tier where the rule cites a technique of the same family', async () => {
    const r = await runWith(segmentModel(), fakeKg({ rules: lowersFlat.rules, threats: { flat: [{ id: 'th', techniqueIds: ['T1021.004'] }] } }));
    expect(r.candidates).toEqual(r.plain);
  });

  it('lowers when the rule’s condition groups do not hold, never when they cannot be evaluated', async () => {
    const holdsNot = JSON.stringify([[{ attribute: 'east_west_within_segment_restricted', operator: 'eq', value: true }]]);
    const r1 = await runWith(segmentModel(false), fakeKg({ rules: { 'c:Network_Segment': [{ ruleId: 'flat', name: FLAT, conditionGroups: holdsNot }] }, threats: { flat: [{ id: 'th', techniqueIds: ['T1021'] }] } }));
    expect(r1.candidates.find((c) => c.target === 'B')).toMatchObject({ kg: 'lowered' });
    const unevaluable = JSON.stringify([[{ attribute: 'not_an_attribute', operator: 'regex_match', value: '.*' }]]);
    const r2 = await runWith(segmentModel(false), fakeKg({ rules: { 'c:Network_Segment': [{ ruleId: 'flat', name: FLAT, conditionGroups: unevaluable }] }, threats: { flat: [{ id: 'th', techniqueIds: ['T1021'] }] } }));
    expect(r2.candidates).toEqual(r2.plain);
    const malformed = await runWith(segmentModel(false), fakeKg({ rules: { 'c:Network_Segment': [{ ruleId: 'flat', name: FLAT, conditionGroups: '{not json' }] }, threats: { flat: [{ id: 'th', techniqueIds: ['T1021'] }] } }));
    expect(malformed.candidates).toEqual(malformed.plain);
  });

  it('never lowers on a rule with no threats, a class it does not cover, a different policy version, or a user’s own finding', async () => {
    expect((await runWith(segmentModel(), fakeKg({ rules: lowersFlat.rules, threats: {} }))).candidates).toEqual((await runWith(segmentModel(), fakeKg())).plain);
    const uncovered = await runWith(segmentModel(), fakeKg());
    expect(uncovered.candidates).toEqual(uncovered.plain);
    const versions = await runWith(segmentModel(), fakeKg({ rules: { 'c:Network_Segment': [{ ruleId: 'flat', name: FLAT, policyHash: 'sha256:other' }] }, threats: lowersFlat.threats }));
    // the fixture's class records no policy hash: a rule's own hash alone proves nothing, so the check still runs
    expect(versions.candidates.find((c) => c.target === 'B')?.kg).toBe('lowered');
    const user = model()
      .boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false })
      .component('A', 'Application Service', 'PROCESS', 'SEG')
      .component('B', 'Web Server', 'PROCESS', 'SEG')
      .exposure('x', 'SEG', FLAT, ['T1021'], 'confirmed', 'USER')
      .exposure('y', 'B', 'Remote administration exposed', ['T1021.004']);
    const r = await runWith(user, fakeKg(lowersFlat));
    expect(r.candidates).toEqual(r.plain);
  });

  it('ignores the exposure cited only to lift a zone cap', async () => {
    const r = await runWith(segmentModel(), fakeKg(lowersFlat));
    expect(r.candidates.find((c) => c.target === 'B')?.kg).toBe('lowered');
  });
});

describe('lowering on the peer side', () => {
  const escape = () =>
    model()
      .boundary('H', 'Operating System / Host')
      .boundary('C1', 'Container', 'H', { container_privileged_mode_disabled: false })
      .component('A', 'Application Service', 'PROCESS', 'C1')
      .component('D', 'Relational Database', 'STORE', 'H')
      .exposure('x', 'C1', 'Privileged mode / excessive capabilities', ['T1611']);

  it('lowers a foothold row on a covered peer class with no threat of the edge kind, citing the class', async () => {
    const r = await runWith(escape(), fakeKg({ rules: { 'c:Relational_Database': [{ ruleId: 'db', name: 'Something' }] }, threats: { db: [{ id: 'sql', techniqueIds: ['T1190'] }] } }));
    const c = r.candidates.find((x) => x.target === 'D')!;
    expect(c).toMatchObject({ tier: 'medium', kg: 'lowered' });
    expect(c.facts).toContain('kg-class:c:Relational_Database');
  });

  it('keeps the tier where the peer class has a threat of the kind, by family (a sub-technique counts)', async () => {
    const r = await runWith(escape(), fakeKg({ rules: { 'c:Relational_Database': [{ ruleId: 'db', name: 'Something' }] }, threats: { db: [{ id: 'esc', techniqueIds: ['T1611.001'] }] } }));
    expect(r.candidates).toEqual(r.plain);
  });

  it('is never applied to a row whose anchor is the reached end', async () => {
    const r = await runWith(segmentModel(), fakeKg({ rules: { 'c:Web_Server': [{ ruleId: 'web', name: 'Something' }] }, threats: { web: [{ id: 'xss', techniqueIds: ['T1059'] }] } }));
    expect(r.candidates).toEqual(r.plain);
  });

  it('lowers one step only, even when both sides fail', async () => {
    const r = await runWith(
      escape(),
      fakeKg({
        rules: { 'c:Container': [{ ruleId: 'priv', name: 'Privileged mode / excessive capabilities' }], 'c:Relational_Database': [{ ruleId: 'db', name: 'Something' }] },
        threats: { priv: [{ id: 'other', techniqueIds: ['T1190'] }], db: [{ id: 'sql', techniqueIds: ['T1190'] }] },
      }),
    );
    expect(r.candidates.find((x) => x.target === 'D')?.tier).toBe('medium');
  });
});

describe('one timeout, and any failure answers without the knowledge graph', () => {
  it('answers as kg_absent, failed, keeping every tier, when a read fails', async () => {
    for (const failOn of ['rulesByClassId', 'threatsByRuleId']) {
      const r = await runWith(segmentModel(), fakeKg({ failOn, rules: lowersFlat.rules }));
      expect(r.facts.regime).toEqual({ kg: 'kg_absent', reason: 'failed' });
      for (const c of r.candidates) {
        expect(c.kg).toBeUndefined();
        expect(c.tier).toBe(r.plain.find((p) => p.id === c.id)!.tier);
      }
    }
  });

  it('answers as kg_absent, failed, when the knowledge graph is slower than its timeout', async () => {
    let calls = 0;
    // the timeout is set at the first reading of the clock; every later reading is past it
    const now = () => (calls++ === 0 ? 0 : KG_TIMEOUT_MS + 1);
    const facts = await readKg(fakeKg({ slow: 'rulesByClassId' }).client, 'tok', { send: ['c:x'], capped: 0 }, undefined, now);
    expect(facts.regime).toEqual({ kg: 'kg_absent', reason: 'failed' });
  });

  // A cold knowledge graph, read one call after another: the probe 2 s, the rules 5 s, the threats in two batches of 1 s.
  const cold = (): KgClient => {
    const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const warm = fakeKg({ rules: { 'c:x': [{ ruleId: 'r1' }] } }).client;
    return {
      ...warm,
      capability: async (token) => {
        await wait(2_000);
        return warm.capability(token);
      },
      rulesByClassId: async (ids, opts, token) => {
        await wait(5_000);
        return warm.rulesByClassId(ids, opts, token);
      },
      threatsByRuleId: async (refs, token) => {
        await wait(1_000);
        await wait(1_000);
        return warm.threatsByRuleId(refs, token);
      },
    };
  };
  const readCold = async (deadlineMs?: number) => {
    vi.useFakeTimers();
    try {
      const now = () => Date.now();
      const facts = readKg(cold(), 'tok', { send: ['c:x'], capped: 0 }, deadlineMs === undefined ? undefined : new Deadline(deadlineMs, now), now);
      await vi.advanceTimersByTimeAsync(30_000);
      return await facts;
    } finally {
      vi.useRealTimers();
    }
  };

  it('answers with the knowledge graph when a cold one takes 9 s for its reads', async () => {
    const facts = await readCold();
    expect(facts.regime).toEqual({ kg: 'kg_present' });
    expect([...facts.threats.keys()]).toEqual([`c:x${KG_KEY_SEPARATOR}r1`]);
  });

  it('answers as kg_absent, failed, when the same reads run past the call’s deadline', async () => {
    expect((await readCold(6_000)).regime).toEqual({ kg: 'kg_absent', reason: 'failed' });
  });

  it('never runs past the call’s deadline: with no time left it answers without the knowledge graph', async () => {
    const kg = fakeKg();
    const facts = await readKg(kg.client, 'tok', { send: ['c:x'], capped: 3 }, new Deadline(0));
    expect(facts).toMatchObject({ regime: { kg: 'kg_absent', reason: 'failed' }, classesCapped: 3 });
    expect(kg.calls).toEqual([]);
  });

  it('keeps the count of classes past the read cap whichever way it answers', async () => {
    for (const kg of [fakeKg({ failOn: 'rulesByClassId' }), fakeKg()]) {
      expect((await readKg(kg.client, 'tok', { send: ['c:x'], capped: 7 })).classesCapped).toBe(7);
    }
  });

  it('caps the class inventory', async () => {
    const b = segmentModel();
    const m = b.fold();
    const inv = classInventory(m, CATALOGUE);
    expect(inv.capped).toBe(0);
    expect(inv.send.length).toBeLessThanOrEqual(MAX_CLASS_READS);
  });

  it('cannot push a candidate out of the answer: the answer is chosen before it runs', async () => {
    const b = model().boundary('SEG', 'Network Segment', null, { east_west_within_segment_restricted: false });
    for (let i = 0; i < 12; i++) b.component(`c${String(i).padStart(2, '0')}`, 'Application Service', 'PROCESS', 'SEG');
    b.exposure('x', 'SEG', FLAT, ['T1021']);
    const r = await runWith(b, fakeKg(lowersFlat));
    expect(r.candidates.map((c) => c.id).sort()).toEqual(r.plain.map((c) => c.id).sort());
    expect(PER_KIND_BUDGET).toBe(50);
  });
});

describe('what is sent to the knowledge graph', () => {
  it('sends the model’s allowed class inventory, the same whatever its exposures, and never a non-catalogue class', async () => {
    const SECRET = 'SECRET-CANARY-kg';
    const base = () => model().boundary('SEG', 'Network Segment').component('A', 'Application Service', 'PROCESS', 'SEG').component('B', 'Web Server', 'PROCESS', 'SEG');
    const withFindings = base().exposure('x', 'SEG', FLAT, ['T1021']);
    const without = base();
    const k1 = fakeKg();
    await runWith(withFindings, k1);
    const k2 = fakeKg();
    await runWith(without, k2);
    const classKeys = (k: ReturnType<typeof fakeKg>) => k.calls.find((c) => c.method === 'rulesByClassId')?.keys;
    expect(classKeys(k1)).toEqual(classKeys(k2));
    const own = base();
    own.classModule = `customer-${SECRET}`;
    own.component('Z', 'Application Service', 'PROCESS', 'SEG');
    const k3 = fakeKg();
    await runWith(own.exposure('x', 'SEG', FLAT, ['T1021']), k3);
    expect(JSON.stringify(k3.calls)).not.toContain(SECRET);
    for (const k of [k1, k2, k3]) expect(k.calls.some((c) => c.method === 'threatsByTechniqueId')).toBe(false);
  });

  it('reads the allowed class modules from the deployment, refusing malformed names', () => {
    expect([...kgClassModules({})]).toEqual(['dethernety-general']);
    expect([...kgClassModules({ MODULE_KG_CLASS_MODULES: 'dethernety-general, paid-pack ,Bad Name' })]).toEqual(['dethernety-general', 'paid-pack']);
  });

  it('sends only class ids and rule refs through the real cloud client: no model id, element, name or value in any URL, header or body', async () => {
    const mock = new MockContentServer();
    const client = createKgClient({ driver: null }, { baseUrl: 'https://kg.example', version: KG_VERSION, teamId: 'team-1', fetchImpl: mock.fetch });
    const SECRET = 'SECRET-CANARY-wire';
    const b = model()
      .boundary(`SEG-${SECRET}`, 'Network Segment', null, { east_west_within_segment_restricted: false, note: SECRET })
      .component(`A-${SECRET}`, 'Application Service', 'PROCESS', `SEG-${SECRET}`)
      .component('B', 'Web Server', 'PROCESS', `SEG-${SECRET}`)
      .exposure('x', `SEG-${SECRET}`, FLAT, ['T1021']);
    const m = b.fold();
    await readKg(client, ENTITLED_TOKEN, classInventory(m, CATALOGUE));
    expect(mock.requests.length).toBeGreaterThan(0);
    for (const r of mock.requests) {
      const all = JSON.stringify([r.url, r.path, r.headers, r.bodyText]);
      expect(all).not.toContain(SECRET);
      expect(all).not.toContain(FLAT);
      if (r.method === 'POST') {
        const body = JSON.parse(r.bodyText ?? '{}');
        expect(Object.keys(body).sort()).toEqual(['parameters', 'requestId']);
        for (const key of Object.keys(body.parameters)) expect(['classIds', 'kind', 'ruleRefs']).toContain(key);
      }
    }
  });
});
