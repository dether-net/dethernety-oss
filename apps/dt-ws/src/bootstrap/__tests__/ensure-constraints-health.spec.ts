import { EnsureConstraintsService } from '../ensure-constraints.service';

/**
 * Pin the `isHealthy()` getter that backs `Module.constraintsHealthy`, plus
 * the engine-branch and pre-flight-guard behavior of the bootstrap hook.
 * The full bootstrap flow (real DDL, dirty-data pre-flight) is tested
 * end-to-end in the integration suites (Memgraph AND Neo4j 5 containers);
 * here we assert lifecycle states and the statements the hook issues:
 *  - pre-bootstrap (test-safe default)
 *  - post-clean-bootstrap
 *  - post-dirty-bootstrap (label was skipped)
 *  - engine branch: Neo4j gets REQUIRE forms, never legacy ASSERT
 *  - community edition skips existence constraints without failing health
 *  - a pre-flight read failure skips the label and NEVER rejects the hook
 *    (main.ts exits the process on a rejected bootstrap hook)
 */

function makeMockDb(opts: {
  preflightDirty?: boolean;
  ddlError?: boolean;
  engine?: 'neo4j' | 'memgraph';
  edition?: string;
  preflightError?: boolean;
}) {
  return {
    getEngineInfo: jest.fn().mockResolvedValue({
      engine: opts.engine ?? 'memgraph',
      edition: opts.edition ?? 'community',
      version: null,
    }),
    executeRead: jest.fn().mockImplementation((query: string) => {
      if (opts.preflightError) {
        return Promise.reject(new Error('transient read failure'));
      }
      // Pre-flight queries return the dup_groups / null-id counts.
      const dirty = opts.preflightDirty ? 1 : 0;
      const records = [
        {
          get: (key: string) => ({
            toNumber: () => (key === 'n' || key === 'dup_groups' ? dirty : 0),
          }),
        },
      ];
      return Promise.resolve({ records });
    }),
    executeImplicitWrite: jest.fn().mockImplementation(() => {
      if (opts.ddlError) return Promise.reject(new Error('CREATE CONSTRAINT failed'));
      return Promise.resolve({ records: [] });
    }),
  };
}

describe('EnsureConstraintsService.isHealthy()', () => {
  it('returns false before bootstrap completes', () => {
    const svc = new EnsureConstraintsService(makeMockDb({}) as any);
    expect(svc.isHealthy()).toBe(false);
    expect(svc.getSkippedLabels()).toEqual([]);
  });

  it('returns true after a clean bootstrap', async () => {
    const db = makeMockDb({ preflightDirty: false, ddlError: false });
    const svc = new EnsureConstraintsService(db as any);
    await svc.onApplicationBootstrap();
    expect(svc.isHealthy()).toBe(true);
    expect(svc.getSkippedLabels()).toEqual([]);
  });

  it('returns false after bootstrap with dirty pre-flight (any label skipped)', async () => {
    const db = makeMockDb({ preflightDirty: true });
    const svc = new EnsureConstraintsService(db as any);
    await svc.onApplicationBootstrap();
    expect(svc.isHealthy()).toBe(false);
    expect(svc.getSkippedLabels().length).toBeGreaterThan(0);
  });

  it('returns false after bootstrap with DDL failure (failed > 0)', async () => {
    const db = makeMockDb({ preflightDirty: false, ddlError: true });
    const svc = new EnsureConstraintsService(db as any);
    await svc.onApplicationBootstrap();
    expect(svc.isHealthy()).toBe(false);
  });

  it('re-bootstrap clears prior skipped state', async () => {
    const dirtyDb = makeMockDb({ preflightDirty: true });
    const svc = new EnsureConstraintsService(dirtyDb as any);
    await svc.onApplicationBootstrap();
    expect(svc.isHealthy()).toBe(false);

    // Replace the db reference's behaviour to clean for a re-bootstrap. The
    // service holds the mock by reference, so mutating its impls is enough.
    dirtyDb.executeRead.mockImplementation(() => {
      const records = [
        { get: () => ({ toNumber: () => 0 }) },
      ];
      return Promise.resolve({ records });
    });
    await svc.onApplicationBootstrap();
    expect(svc.isHealthy()).toBe(true);
    expect(svc.getSkippedLabels()).toEqual([]);
  });
});

describe('EnsureConstraintsService — engine branch', () => {
  it('on Neo4j every issued statement is a REQUIRE form; no legacy ASSERT reaches the engine', async () => {
    const db = makeMockDb({ engine: 'neo4j', edition: 'enterprise' });
    const svc = new EnsureConstraintsService(db as any);
    await svc.onApplicationBootstrap();

    const statements = db.executeImplicitWrite.mock.calls.map((call) => String(call[0]));
    expect(statements.length).toBeGreaterThan(0);
    for (const stmt of statements) {
      expect(stmt).toContain('CREATE CONSTRAINT IF NOT EXISTS FOR');
      expect(stmt).not.toContain('ASSERT');
    }
    // Enterprise gets the existence constraints too (7 exists + 8 unique + Module.name).
    expect(statements.filter((s) => s.includes('IS NOT NULL'))).toHaveLength(7);
    expect(svc.isHealthy()).toBe(true);
  });

  it('on Neo4j community the existence constraints are skipped without failing health', async () => {
    const db = makeMockDb({ engine: 'neo4j', edition: 'community' });
    const svc = new EnsureConstraintsService(db as any);
    await svc.onApplicationBootstrap();

    const statements = db.executeImplicitWrite.mock.calls.map((call) => String(call[0]));
    // Only uniques: 7 *Class + Analysis + Module(name) = 9. No IS NOT NULL.
    expect(statements.filter((s) => s.includes('IS NOT NULL'))).toHaveLength(0);
    expect(statements.filter((s) => s.includes('IS UNIQUE'))).toHaveLength(9);
    // Structurally-unavailable kinds are NOT a health failure.
    expect(svc.isHealthy()).toBe(true);
    expect(svc.getSkippedLabels()).toEqual([]);
  });

  it('on Memgraph the shipped legacy statements are unchanged', async () => {
    const db = makeMockDb({ engine: 'memgraph' });
    const svc = new EnsureConstraintsService(db as any);
    await svc.onApplicationBootstrap();

    const statements = db.executeImplicitWrite.mock.calls.map((call) => String(call[0]));
    expect(statements).toContain('CREATE CONSTRAINT ON (n:Module) ASSERT n.name IS UNIQUE');
    expect(statements).toContain('CREATE CONSTRAINT ON (n:ControlClass) ASSERT n.id IS UNIQUE');
    expect(statements).toContain('CREATE CONSTRAINT ON (n:ControlClass) ASSERT EXISTS (n.id)');
    expect(statements.some((s) => s.includes('IF NOT EXISTS'))).toBe(false);
  });
});

describe('EnsureConstraintsService — pre-flight guard', () => {
  it('a failing pre-flight read skips the labels, resolves the hook, and reports unhealthy', async () => {
    const db = makeMockDb({ preflightError: true });
    const svc = new EnsureConstraintsService(db as any);

    // Load-bearing: the hook must RESOLVE — a rejection would make main.ts
    // process.exit(1) and crash-loop the app on a transient DB hiccup.
    await expect(svc.onApplicationBootstrap()).resolves.toBeUndefined();

    // Every label (and Module(name)) skipped, nothing created.
    expect(db.executeImplicitWrite).not.toHaveBeenCalled();
    expect(svc.isHealthy()).toBe(false);
    expect(svc.getSkippedLabels()).toContain('Module(name)');
    expect(svc.getSkippedLabels().length).toBeGreaterThan(1);
  });
});
