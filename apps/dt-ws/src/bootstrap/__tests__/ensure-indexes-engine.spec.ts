import { EnsureIndexesService } from '../ensure-indexes.service';

/**
 * Engine-branch pins for the index bootstrap: Memgraph keeps the shipped
 * legacy statements for the FULL list; Neo4j gets named `IF NOT EXISTS FOR`
 * forms with the uniqueness-constraint-covered pairs filtered out (a plain index
 * on a covered pair would block the constraint creation — and the constraint
 * creates its own backing index anyway).
 */

function makeMockDb(engine: 'neo4j' | 'memgraph') {
  return {
    getEngineInfo: jest.fn().mockResolvedValue({ engine, edition: 'community', version: null }),
    executeSchemaWrite: jest.fn().mockResolvedValue({ records: [] }),
  };
}

/** A constraint pass that has already finished. */
const constraintsDone = { whenBootstrapped: () => Promise.resolve() };

describe('EnsureIndexesService — engine branch', () => {
  it('Memgraph: full list, exact legacy form, no IF NOT EXISTS', async () => {
    const db = makeMockDb('memgraph');
    await new EnsureIndexesService(db as any, constraintsDone as any).onApplicationBootstrap();

    const statements = db.executeSchemaWrite.mock.calls.map((call) => String(call[0]));
    expect(statements).toContain('CREATE INDEX ON :Control(id)');
    // Constraint-covered pairs are NOT filtered on Memgraph (indexes and
    // constraints are independent there — shipped behavior).
    expect(statements).toContain('CREATE INDEX ON :ControlClass(id)');
    expect(statements).toContain('CREATE INDEX ON :Module(name)');
    expect(statements.some((s) => s.includes('IF NOT EXISTS'))).toBe(false);
  });

  it('Neo4j: named IF NOT EXISTS FOR form, constraint-covered pairs absent', async () => {
    const db = makeMockDb('neo4j');
    await new EnsureIndexesService(db as any, constraintsDone as any).onApplicationBootstrap();

    const statements = db.executeSchemaWrite.mock.calls.map((call) => String(call[0]));
    expect(statements.length).toBeGreaterThan(0);
    for (const stmt of statements) {
      expect(stmt).toMatch(/^CREATE INDEX dt_idx__\w+ IF NOT EXISTS FOR /);
    }
    // Non-covered pairs present…
    expect(statements).toContain('CREATE INDEX dt_idx__Control__id IF NOT EXISTS FOR (n:Control) ON (n.id)');
    expect(statements).toContain(
      'CREATE INDEX dt_idx__ControlClass__name IF NOT EXISTS FOR (n:ControlClass) ON (n.name)',
    );
    expect(statements).toContain('CREATE INDEX dt_idx__Module__id IF NOT EXISTS FOR (n:Module) ON (n.id)');
    // …covered pairs filtered (would block the uniqueness constraints).
    expect(statements.some((s) => s.includes('(n:ControlClass) ON (n.id)'))).toBe(false);
    expect(statements.some((s) => s.includes('(n:Analysis) ON (n.id)'))).toBe(false);
    expect(statements.some((s) => s.includes('(n:Module) ON (n.name)'))).toBe(false);
  });

  it('a DDL failure never rejects the hook (main.ts exits on hook rejection)', async () => {
    const db = makeMockDb('memgraph');
    db.executeSchemaWrite.mockRejectedValue(new Error('boom'));
    await expect(
      new EnsureIndexesService(db as any, constraintsDone as any).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
  });
});

/**
 * The index pass starts only once the constraint pass has finished: run side by side on Neo4j, an index and a
 * uniqueness constraint on one label (:Module(id), :Module(name)) can deadlock.
 */
describe('EnsureIndexesService — after the constraint pass', () => {
  it('waits for a constraint pass whose hook starts after its own (provider order does not matter)', async () => {
    const order: string[] = [];
    const constraintsHook: { started?: Promise<void> } = {};
    const constraints = { whenBootstrapped: () => constraintsHook.started ?? Promise.resolve() };
    const db = makeMockDb('neo4j');
    db.executeSchemaWrite.mockImplementation(async () => {
      order.push('index');
      return { records: [] };
    });
    // The index hook is called first; the constraint hook starts in the same synchronous pass, after it.
    const pending = new EnsureIndexesService(db as any, constraints as any).onApplicationBootstrap();
    constraintsHook.started = new Promise<void>((resolve) => setTimeout(() => { order.push('constraints'); resolve(); }, 10));
    await pending;
    expect(order[0]).toBe('constraints');
    expect(order).toContain('index');
  });
});
