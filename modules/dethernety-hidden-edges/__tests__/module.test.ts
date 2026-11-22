import { describe, expect, it, vi } from 'vitest';
import DethernetyHiddenEdgesModule from '../src/DethernetyHiddenEdgesModule';
import { CAPS, Deadline } from '../src/bounds';
import { CONTRACT_VERSION, MODULE_NAME, tableHash } from '../src/contract';
import shipped from '../src/edge-kinds.json';
import { classFiles, fakeDriver, SECRET, smallModelRows } from './fixtures';

const logger = () => ({ error: vi.fn(), warn: vi.fn(), log: vi.fn() }) as any;
const code = (answer: object) => (answer as any).refusal?.code;

describe('hiddenEdgeCandidates', () => {
  it('declares one read-only query field, and serves its classes as a file-policy module', async () => {
    const mod = new DethernetyHiddenEdgesModule({}, logger());
    expect(mod.getSchemaExtension()).toMatch(/hiddenEdgeCandidates\(modelId: ID!, options: String\): String/);
    const meta = await mod.getMetadata();
    expect(meta.name).toBe(MODULE_NAME);
    expect((meta.dataFlowClasses ?? []).map((c: any) => c.id).sort()).toEqual(Object.values(classFiles()).map((c) => c.id).sort());
    expect(Object.keys(mod.getResolvers({ driver: {}, logger: logger() }).Query)).toEqual(['hiddenEdgeCandidates']);
  });

  it('answers the contract with what it read, in a read session it closes', async () => {
    const { driver, sessions } = fakeDriver();
    const mod = new DethernetyHiddenEdgesModule(driver, logger());
    mod.useKgClient({ version: null, capability: async () => ({ available: false, entitled: true, sliceCount: 0 }) } as any);
    const resolvers: any = mod.getResolvers({ driver, logger: logger(), databaseName: 'memgraph' });
    const answer: any = JSON.parse(await resolvers.Query.hiddenEdgeCandidates(null, { modelId: 'm' }, { user: { sub: 'u1' } }));
    expect(answer).toMatchObject({ contract: CONTRACT_VERSION, module: MODULE_NAME, regime: { kg: 'kg_absent', reason: 'no_data' } });
    expect(Array.isArray(answer.candidates)).toBe(true);
    expect(answer.counts).toMatchObject({ boundaries: 2, components: 2, flows: 1, dataItems: 1, exposures: 3, controls: 1 });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].config).toEqual({ database: 'memgraph', defaultAccessMode: 'READ' });
    expect(sessions[0].closed).toBe(true);
    expect(sessions[0].txConfig.timeout).toBeGreaterThan(0);
  });

  it('refuses in the answer, not by throwing', async () => {
    const mod = new DethernetyHiddenEdgesModule(fakeDriver().driver, logger());
    const of = async (args: any) => code(await mod.candidates(args));
    expect(await of({})).toBe('model_not_found');
    expect(await of({ modelId: '' })).toBe('model_not_found');
    expect(await of({ modelId: 'x'.repeat(129) })).toBe('model_not_found');
    expect(await of({ modelId: 'm', options: 'not json' })).toBe('options_invalid');
    expect(await of({ modelId: 'm', options: '[1]' })).toBe('options_invalid');
    expect(await of({ modelId: 'm', options: 7 })).toBe('options_invalid');
    expect(await of({ modelId: 'm', options: JSON.stringify({ excluded: [], pad: 'x'.repeat(128 * 1024) }) })).toBe('options_invalid');
    expect(await of({ modelId: 'm', options: '{}' })).toBeUndefined();
    expect(await of({ modelId: 'm', options: JSON.stringify({ include_pending: true }) })).toBeUndefined();
    expect(await new DethernetyHiddenEdgesModule(fakeDriver({ missing: true }).driver, logger()).candidates({ modelId: 'm' })).toMatchObject({ refusal: { code: 'model_not_found' } });
  });

  it('says which table answered, by the hash of its source', async () => {
    const mod = new DethernetyHiddenEdgesModule(fakeDriver().driver, logger());
    const answer: any = await mod.candidates({ modelId: 'm' });
    expect(Object.keys(answer)).toEqual(['contract', 'module', 'version', 'table_hash', 'regime', 'candidates', 'counts']);
    expect(answer.table_hash).toBe(tableHash(shipped));
  });

  it('frees the caller after every answer, a refusal or a fault too', async () => {
    const runs: Array<[any, (m: DethernetyHiddenEdgesModule) => Promise<unknown>]> = [
      [fakeDriver({ missing: true }).driver, (m) => m.candidates({ modelId: 'm' }, { caller: 'u1' })],
      [fakeDriver({ rows: { flows: Array.from({ length: CAPS.flows + 1 }, (_, i) => ({ id: `f${i}`, sourceId: 'web', targetId: 'db' })) } }).driver, (m) => m.candidates({ modelId: 'm' }, { caller: 'u1' })],
      [fakeDriver().driver, (m) => m.candidates({ modelId: 'm' }, { caller: 'u1', deadline: new Deadline(0) })],
      [fakeDriver({ throwOn: 'flows', throwError: new Error('boom') }).driver, (m) => m.candidates({ modelId: 'm' }, { caller: 'u1' }).catch(() => undefined)],
    ];
    for (const [driver, call] of runs) {
      const mod = new DethernetyHiddenEdgesModule(driver, logger());
      await call(mod);
      // the same caller again: whatever the answer, not busy (the faulty driver still faults)
      const again = await mod.candidates({ modelId: 'm' }, { caller: 'u1' }).catch(() => ({ fault: true }));
      expect(code(again)).not.toBe('busy');
    }
  });

  it('passes the options to the matching: an excluded pair is gone, and counted', async () => {
    const mod = new DethernetyHiddenEdgesModule(fakeDriver().driver, logger());
    const all: any = await mod.candidates({ modelId: 'm' });
    expect(all.candidates.length).toBeGreaterThan(0);
    const first = all.candidates[0];
    const without: any = await mod.candidates({ modelId: 'm', options: JSON.stringify({ excluded: [first.id] }) });
    expect(without.candidates.map((c: any) => c.id)).not.toContain(first.id);
    expect(without.counts.excluded_by_decision).toBeGreaterThan(0);
  });

  it('refuses an option it does not read, so a newer client never has one dropped silently', async () => {
    const mod = new DethernetyHiddenEdgesModule(fakeDriver().driver, logger());
    expect(code(await mod.candidates({ modelId: 'm', options: JSON.stringify({ unknown: 1 }) }))).toBe('options_invalid');
    expect(code(await mod.candidates({ modelId: 'm', options: JSON.stringify({ excluded: ['he:1'] }) }))).toBe('options_invalid');
    expect(code(await mod.candidates({ modelId: 'm', options: JSON.stringify({ caps: { max_candidates: 1 } }) }))).toBe('options_invalid');
  });

  it('refuses a model over a cap, naming the read, and closes the session', async () => {
    const big = Array.from({ length: CAPS.flows + 1 }, (_, i) => ({ id: `f${i}`, sourceId: 'web', targetId: 'db' }));
    const { driver, sessions } = fakeDriver({ rows: { flows: big } });
    expect(await new DethernetyHiddenEdgesModule(driver, logger()).candidates({ modelId: 'm' })).toMatchObject({ refusal: { code: 'model_too_large', detail: 'flows' } });
    expect(sessions[0].closed).toBe(true);
  });

  it('refuses between reads once the deadline has passed', async () => {
    const { driver, sessions } = fakeDriver();
    let now = 0;
    const deadline = new Deadline(10, () => (now += 5));
    expect(code(await new DethernetyHiddenEdgesModule(driver, logger()).candidates({ modelId: 'm' }, { deadline }))).toBe('deadline');
    expect(sessions[0].closed).toBe(true);
  });

  it('reads a server-side transaction timeout as the deadline, not a fault', async () => {
    const { driver } = fakeDriver({ throwOn: 'flows', throwError: Object.assign(new Error('timed out'), { code: 'Neo.ClientError.Transaction.TransactionTimedOutClientConfiguration' }) });
    expect(code(await new DethernetyHiddenEdgesModule(driver, logger()).candidates({ modelId: 'm' }))).toBe('deadline');
  });

  it('allows one call in flight per caller, and any number across callers', async () => {
    const fake = fakeDriver({ hangOn: 'flows' });
    const mod = new DethernetyHiddenEdgesModule(fake.driver, logger());
    const running = ['u0', 'u1', 'u2'].map((caller) => mod.candidates({ modelId: 'm' }, { caller }));
    expect(code(await mod.candidates({ modelId: 'm' }, { caller: 'u0' }))).toBe('busy');
    fake.release();
    for (const answer of await Promise.all(running)) expect(code(answer)).toBeUndefined();
    expect(code(await mod.candidates({ modelId: 'm' }, { caller: 'u0' }))).toBeUndefined();
  });

  it('keys the in-flight limit on the verified user, with one shared key when auth is off', async () => {
    const fake = fakeDriver({ hangOn: 'flows' });
    const mod = new DethernetyHiddenEdgesModule(fake.driver, logger());
    const q: any = mod.getResolvers({ driver: fake.driver, logger: logger() }).Query;
    const first = q.hiddenEdgeCandidates(null, { modelId: 'm' }, {});
    expect(JSON.parse(await q.hiddenEdgeCandidates(null, { modelId: 'm' }, { user: {} })).refusal.code).toBe('busy');
    const other = q.hiddenEdgeCandidates(null, { modelId: 'm' }, { user: { sub: 'u9' } });
    fake.release();
    expect(JSON.parse(await first).refusal).toBeUndefined();
    expect(JSON.parse(await other).refusal).toBeUndefined();
  });

  it('runs no Cypher but its declared reads', async () => {
    const tx = { run: vi.fn(async () => ({ records: [] })) };
    const driver = { session: () => ({ executeRead: async (work: any) => work(tx), close: async () => undefined }) };
    const reads = await import('../src/reads');
    const spy = vi.spyOn(reads, 'readModel').mockImplementation(async (run) => {
      await run('MATCH (n) DETACH DELETE n', {});
      return null;
    });
    try {
      await expect(new DethernetyHiddenEdgesModule(driver, logger()).candidates({ modelId: 'm' })).rejects.toThrow('hidden-edge candidates could not be read');
      expect(tx.run).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('throws a fault without echoing the query, its parameters or the cause, and closes the session', async () => {
    const { driver, sessions } = fakeDriver({ throwOn: 'flows' });
    const log = logger();
    let message = '';
    await new DethernetyHiddenEdgesModule(driver, log).candidates({ modelId: 'm' }).catch((e: Error) => (message = e.message));
    expect(message).toBe('hidden-edge candidates could not be read');
    expect(JSON.stringify(log.error.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(log.error.mock.calls)).not.toMatch(/MATCH|UNWIND/);
    expect(sessions[0].closed).toBe(true);
  });

  it('keeps its answer when closing the session fails, and logs no detail of it', async () => {
    const log = logger();
    const answer: any = await new DethernetyHiddenEdgesModule(fakeDriver({ closeThrows: true }).driver, log).candidates({ modelId: 'm' });
    expect(answer.contract).toBe(CONTRACT_VERSION);
    expect(JSON.stringify(log.error.mock.calls)).not.toContain(SECRET);
  });

  it('puts no attribute value into the answer', async () => {
    const m = smallModelRows();
    const web = { ...m.instances.find((r) => r.elementId === 'web')!, attributes: { api_key_hint: SECRET } };
    const { driver } = fakeDriver({ rows: { instancesComponents: [web, ...m.instances.filter((r) => r.kind === 'component' && r.elementId !== 'web')] } });
    expect(JSON.stringify(await new DethernetyHiddenEdgesModule(driver, logger()).candidates({ modelId: 'm' }))).not.toContain(SECRET);
  });
});
