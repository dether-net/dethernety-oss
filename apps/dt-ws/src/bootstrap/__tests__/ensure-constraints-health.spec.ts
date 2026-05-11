import { EnsureConstraintsService } from '../ensure-constraints.service';

/**
 * Pin the `isHealthy()` getter that backs `Module.constraintsHealthy`.
 * The full bootstrap flow (Memgraph DDL, dirty-data pre-flight) is tested
 * end-to-end in the integration suite; here we just assert the getter
 * returns the right value across the three relevant lifecycle states:
 *  - pre-bootstrap (test-safe default)
 *  - post-clean-bootstrap
 *  - post-dirty-bootstrap (label was skipped)
 */

function makeMockDb(opts: {
  preflightDirty?: boolean;
  ddlError?: boolean;
}) {
  return {
    executeRead: jest.fn().mockImplementation((query: string) => {
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
