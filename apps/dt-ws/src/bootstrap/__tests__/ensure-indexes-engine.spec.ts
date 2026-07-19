import { EnsureIndexesService } from '../ensure-indexes.service';

/**
 * Engine-branch pins for the index bootstrap: Memgraph keeps the shipped
 * legacy statements for the FULL list; Neo4j gets `IF NOT EXISTS FOR` forms
 * with the uniqueness-constraint-covered pairs filtered out (a plain index
 * on a covered pair would block the constraint creation — and the constraint
 * creates its own backing index anyway).
 */

function makeMockDb(engine: 'neo4j' | 'memgraph') {
  return {
    getEngineInfo: jest.fn().mockResolvedValue({ engine, edition: 'community', version: null }),
    executeImplicitWrite: jest.fn().mockResolvedValue({ records: [] }),
  };
}

describe('EnsureIndexesService — engine branch', () => {
  it('Memgraph: full list, exact legacy form, no IF NOT EXISTS', async () => {
    const db = makeMockDb('memgraph');
    await new EnsureIndexesService(db as any).onApplicationBootstrap();

    const statements = db.executeImplicitWrite.mock.calls.map((call) => String(call[0]));
    expect(statements).toContain('CREATE INDEX ON :Control(id)');
    // Constraint-covered pairs are NOT filtered on Memgraph (indexes and
    // constraints are independent there — shipped behavior).
    expect(statements).toContain('CREATE INDEX ON :ControlClass(id)');
    expect(statements).toContain('CREATE INDEX ON :Module(name)');
    expect(statements.some((s) => s.includes('IF NOT EXISTS'))).toBe(false);
  });

  it('Neo4j: IF NOT EXISTS FOR form, constraint-covered pairs absent', async () => {
    const db = makeMockDb('neo4j');
    await new EnsureIndexesService(db as any).onApplicationBootstrap();

    const statements = db.executeImplicitWrite.mock.calls.map((call) => String(call[0]));
    expect(statements.length).toBeGreaterThan(0);
    for (const stmt of statements) {
      expect(stmt).toContain('CREATE INDEX IF NOT EXISTS FOR');
    }
    // Non-covered pairs present…
    expect(statements).toContain('CREATE INDEX IF NOT EXISTS FOR (n:Control) ON (n.id)');
    expect(statements).toContain('CREATE INDEX IF NOT EXISTS FOR (n:ControlClass) ON (n.name)');
    expect(statements).toContain('CREATE INDEX IF NOT EXISTS FOR (n:Module) ON (n.id)');
    // …covered pairs filtered (would block the uniqueness constraints).
    expect(statements.some((s) => s.includes('(n:ControlClass) ON (n.id)'))).toBe(false);
    expect(statements.some((s) => s.includes('(n:Analysis) ON (n.id)'))).toBe(false);
    expect(statements.some((s) => s.includes('(n:Module) ON (n.name)'))).toBe(false);
  });

  it('a DDL failure never rejects the hook (main.ts exits on hook rejection)', async () => {
    const db = makeMockDb('memgraph');
    db.executeImplicitWrite.mockRejectedValue(new Error('boom'));
    await expect(
      new EnsureIndexesService(db as any).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
  });
});
