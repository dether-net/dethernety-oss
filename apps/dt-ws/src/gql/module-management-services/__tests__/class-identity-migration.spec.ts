import { ClassIdentityMigrationService } from '../class-identity-migration.service';

/**
 * Unit pins for the class-identity dedup semantics:
 *   - cross-module same-name classes are NEVER merged (per-(module,name)
 *     bucketing — the old name-only grouping destroyed one module's class)
 *   - a bound and an unbound same-name node are NOT merged (separate buckets)
 *   - two UNBOUND same-name nodes DO merge (the genuine drift population —
 *     the tool's core purpose), canonical = lowest internal id fallback
 *   - same-module drift IS merged, with every statement of the group merge
 *     (redirects + guard + delete, in that order) inside ONE managed tx
 *   - canonical preference: the HAS_CLASS-bound node survives even when it has
 *     the higher internal id (regression for the module-unbound-survivor wedge)
 *   - dry-run purity: apply=false never opens a session / writes, and it
 *     previews guard skips honestly ("would SKIP")
 *   - leftover-edge guard: an unexpected remaining edge type blocks the delete
 *     and is NOT counted as an action (report converges to 0, never lies)
 *   - a node bound to >1 module is pathological: excluded + reported, and the
 *     rest of its bucket still merges
 *   - one failing group's tx is isolated: recorded in details, run continues
 *
 * The fake DB is STRICT: any query it does not recognize throws, so a query
 * refactor in the service can never silently starve the fixtures and turn the
 * negative (no-merge) pins vacuously green.
 *
 * End-to-end DB execution (real Memgraph) lives in
 * test/integration/admin-surface.e2e-spec.ts.
 */

const rec = (obj: Record<string, unknown>) => ({ get: (k: string) => obj[k] });

/** One row of the per-node grouping read. */
const nodeRow = (
  name: string,
  internalId: number,
  owners: string[],
  bindingTypes: string[],
) => rec({ name, internalId, owners, bindingTypes });

interface FakeDbOptions {
  /** Grouping rows returned for a given label (others return []). */
  rowsByLabel?: Record<string, ReturnType<typeof rec>[]>;
  /** Dry-run redirectable-edge count per non-canonical id. */
  dryEdgeCounts?: Record<number, number>;
  /** Dry-run guard predictor per non-canonical id (default clean). */
  dryBlocked?: Record<number, { n: number; types: string[] }>;
  /** Apply-mode leftover-guard response per non-canonical id (default clean). */
  leftover?: Record<number, { n: number; types: string[] }>;
  /** Throw from the tx for these canonical ids (group-failure isolation). */
  failTxForCanonical?: number[];
}

function makeFakeDb(opts: FakeDbOptions = {}) {
  const txRuns: Array<{ query: string; params: any }> = [];

  const tx = {
    run: jest.fn(async (query: string, params?: any) => {
      txRuns.push({ query, params });
      if (query.includes('MERGE (a)-[r2:')) {
        if (opts.failTxForCanonical?.includes(params?.canonicalId)) {
          throw new Error('tx poisoned');
        }
        return { records: [rec({ moved: 1 })] };
      }
      if (query.includes('NOT type(r) IN')) {
        const cfg = opts.leftover?.[params?.ncId] ?? { n: 0, types: [] };
        return { records: [rec({ n: cfg.n, types: cfg.types })] };
      }
      if (query.includes('DETACH DELETE')) {
        return { records: [] };
      }
      throw new Error(`fake tx: unrecognized query: ${query}`);
    }),
  };
  const session = {
    executeWrite: jest.fn(async (cb: (tx: any) => Promise<void>) => cb(tx)),
    close: jest.fn(async () => {}),
  };
  const db = {
    executeRead: jest.fn(async (query: string, params?: any) => {
      if (query.includes('OPTIONAL MATCH (m:Module)')) {
        const label = /\(c:(\w+)\)/.exec(query)?.[1] ?? '';
        return { records: opts.rowsByLabel?.[label] ?? [] };
      }
      if (query.includes('IS_INSTANCE_OF|IS_EXPOSURE_OF|IS_COUNTERMEASURE_OF')) {
        return { records: [rec({ n: opts.dryEdgeCounts?.[params?.ncId] ?? 0 })] };
      }
      if (query.includes('NOT type(r) IN')) {
        const cfg = opts.dryBlocked?.[params?.ncId] ?? { n: 0, types: [] };
        return { records: [rec({ n: cfg.n, types: cfg.types })] };
      }
      if (query.includes('edgeIds')) {
        return { records: [] }; // dedupAnalysisInstanceEdges — no edge dupes here
      }
      throw new Error(`fake db: unrecognized read query: ${query}`);
    }),
    executeWrite: jest.fn(async () => ({ records: [] })),
    getSession: jest.fn(() => session),
  };
  return { db, session, tx, txRuns };
}

function makeService(db: any): ClassIdentityMigrationService {
  const svc = new ClassIdentityMigrationService(db);
  jest.spyOn((svc as any).logger, 'log').mockImplementation(() => {});
  jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});
  jest.spyOn((svc as any).logger, 'error').mockImplementation(() => {});
  return svc;
}

describe('ClassIdentityMigrationService — per-(module,name) dedup semantics', () => {
  it('never merges same-name classes owned by different modules', async () => {
    const { db } = makeFakeDb({
      rowsByLabel: {
        ComponentClass: [
          nodeRow('Firewall', 1, ['mod-a'], ['HAS_CLASS']),
          nodeRow('Firewall', 2, ['mod-b'], ['HAS_CLASS']),
        ],
      },
    });
    const svc = makeService(db);

    const report = await svc.run({ apply: true });

    expect(report.totalActions).toBe(0);
    expect(db.getSession).not.toHaveBeenCalled();
    expect(db.executeWrite).not.toHaveBeenCalled();
  });

  it('does not merge a bound node with an unbound same-name node (separate buckets)', async () => {
    const { db } = makeFakeDb({
      rowsByLabel: {
        ComponentClass: [
          nodeRow('X', 1, ['mod-a'], ['HAS_CLASS']),
          nodeRow('X', 2, [], []),
        ],
      },
    });
    const svc = makeService(db);

    const report = await svc.run({ apply: true });

    expect(report.totalActions).toBe(0);
    expect(db.getSession).not.toHaveBeenCalled();
  });

  it('merges two UNBOUND same-name nodes — the genuine drift case (lowest-id fallback)', async () => {
    const { db, txRuns } = makeFakeDb({
      rowsByLabel: {
        ComponentClass: [
          nodeRow('X', 5, [], []),
          nodeRow('X', 8, [], []),
        ],
      },
    });
    const svc = makeService(db);

    const report = await svc.run({ apply: true });

    expect(report.totalActions).toBe(1);
    // Neither node is actively bound → canonical falls back to lowest id.
    const deletes = txRuns.filter((r) => r.query.includes('DETACH DELETE'));
    expect(deletes).toHaveLength(1);
    expect(deletes[0].params).toEqual({ ncId: 8 });
    const redirect = txRuns.find((r) => r.query.includes('MERGE (a)-[r2:'));
    expect(redirect?.params).toEqual({ ncId: 8, canonicalId: 5 });
  });

  it('merges same-module drift atomically — redirects, guard, then delete in ONE tx', async () => {
    const { db, session, txRuns } = makeFakeDb({
      rowsByLabel: {
        ComponentClass: [
          nodeRow('X', 1, ['mod-a'], ['HAS_CLASS']),
          nodeRow('X', 2, ['mod-a'], ['HAS_CLASS']),
        ],
      },
    });
    const svc = makeService(db);

    const report = await svc.run({ apply: true });

    expect(report.totalActions).toBe(1); // 1 non-canonical deleted
    // The whole group merge ran through a single managed transaction.
    expect(db.getSession).toHaveBeenCalledTimes(1);
    expect(session.executeWrite).toHaveBeenCalledTimes(1);
    expect(session.close).toHaveBeenCalledTimes(1);
    // Inside it: one redirect per data-edge type, the leftover guard, the delete.
    const redirects = txRuns.filter((r) => r.query.includes('MERGE (a)-[r2:'));
    expect(redirects.map((r) => /r2:(\w+)\]/.exec(r.query)?.[1]).sort()).toEqual([
      'IS_COUNTERMEASURE_OF',
      'IS_EXPOSURE_OF',
      'IS_INSTANCE_OF',
    ]);
    const guardIdx = txRuns.findIndex((r) => r.query.includes('NOT type(r) IN'));
    const deleteIdx = txRuns.findIndex((r) => r.query.includes('DETACH DELETE'));
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeGreaterThan(guardIdx); // guard runs BEFORE the delete
    const deletes = txRuns.filter((r) => r.query.includes('DETACH DELETE'));
    expect(deletes).toHaveLength(1);
    // Canonical = lowest id (both actively bound): keep 1, delete 2.
    expect(deletes[0].params).toEqual({ ncId: 2 });
    expect(redirects[0].params).toEqual({ ncId: 2, canonicalId: 1 });
  });

  it('prefers the HAS_CLASS-bound node as canonical even at a higher internal id', async () => {
    const { db, txRuns } = makeFakeDb({
      rowsByLabel: {
        ControlClass: [
          nodeRow('X', 3, ['mod-a'], ['HAS_ORPHANED_CLASS']),
          nodeRow('X', 9, ['mod-a'], ['HAS_CLASS']),
        ],
      },
    });
    const svc = makeService(db);

    await svc.run({ apply: true });

    // The old rule (lowest internal id) would have deleted 9 and wedged future
    // installs on a module-unbound survivor. The actively-bound node survives.
    const deletes = txRuns.filter((r) => r.query.includes('DETACH DELETE'));
    expect(deletes).toHaveLength(1);
    expect(deletes[0].params).toEqual({ ncId: 3 });
    const redirect = txRuns.find((r) => r.query.includes('MERGE (a)-[r2:'));
    expect(redirect?.params).toEqual({ ncId: 3, canonicalId: 9 });
  });

  it('dry-run is pure: counts planned actions without opening a session or writing', async () => {
    const { db, session } = makeFakeDb({
      rowsByLabel: {
        ComponentClass: [
          nodeRow('X', 1, ['mod-a'], ['HAS_CLASS']),
          nodeRow('X', 2, ['mod-a'], ['HAS_CLASS']),
        ],
      },
      dryEdgeCounts: { 2: 4 },
    });
    const svc = makeService(db);

    const report = await svc.run({ apply: false });

    expect(report.dryRun).toBe(true);
    expect(report.totalActions).toBe(1);
    expect(report.details.join('\n')).toContain('would redirect 4 edge(s)');
    expect(db.getSession).not.toHaveBeenCalled();
    expect(db.executeWrite).not.toHaveBeenCalled();
    expect(session.executeWrite).not.toHaveBeenCalled();
  });

  it('dry-run previews a guard skip ("would SKIP") and does not count it', async () => {
    const { db } = makeFakeDb({
      rowsByLabel: {
        ComponentClass: [
          nodeRow('X', 1, ['mod-a'], ['HAS_CLASS']),
          nodeRow('X', 2, ['mod-a'], ['HAS_CLASS']),
        ],
      },
      dryBlocked: { 2: { n: 1, types: ['WEIRD_EDGE'] } },
    });
    const svc = makeService(db);

    const report = await svc.run({ apply: false });

    // Parity with apply: a delete the guard would refuse is not an action.
    expect(report.totalActions).toBe(0);
    expect(report.details.join('\n')).toContain('would SKIP delete of internalId(2)');
    expect(report.details.join('\n')).toContain('WEIRD_EDGE');
    expect(db.getSession).not.toHaveBeenCalled();
  });

  it('leftover-edge guard: refuses to delete a node carrying an unknown edge type — not counted', async () => {
    const { db, txRuns } = makeFakeDb({
      rowsByLabel: {
        ComponentClass: [
          nodeRow('X', 1, ['mod-a'], ['HAS_CLASS']),
          nodeRow('X', 2, ['mod-a'], ['HAS_CLASS']),
        ],
      },
      leftover: { 2: { n: 1, types: ['WEIRD_EDGE'] } },
    });
    const svc = makeService(db);

    const report = await svc.run({ apply: true });

    expect(txRuns.filter((r) => r.query.includes('DETACH DELETE'))).toHaveLength(0);
    expect(report.details.join('\n')).toContain('SKIPPED delete of internalId(2)');
    expect(report.details.join('\n')).toContain('WEIRD_EDGE');
    // A skip is not a mutation: the report must converge to 0, not claim
    // phantom work on every run forever.
    expect(report.totalActions).toBe(0);
  });

  it('excludes a multi-owner node but still merges the rest of its bucket', async () => {
    const { db, txRuns } = makeFakeDb({
      rowsByLabel: {
        ComponentClass: [
          nodeRow('X', 1, ['mod-a', 'mod-b'], ['HAS_CLASS', 'HAS_CLASS']),
          nodeRow('X', 2, ['mod-a'], ['HAS_CLASS']),
          nodeRow('X', 3, ['mod-a'], ['HAS_CLASS']),
        ],
      },
    });
    const svc = makeService(db);

    const report = await svc.run({ apply: true });

    expect(report.details.join('\n')).toContain('bound to 2 modules');
    // The pathological node (1) is untouched; the (mod-a, X) pair 2+3 merges.
    expect(report.totalActions).toBe(1);
    const deletes = txRuns.filter((r) => r.query.includes('DETACH DELETE'));
    expect(deletes).toHaveLength(1);
    expect(deletes[0].params).toEqual({ ncId: 3 });
    expect(txRuns.some((r) => r.params?.ncId === 1)).toBe(false);
  });

  it('isolates a failing group: records FAILED in details and continues with other groups', async () => {
    const { db, txRuns } = makeFakeDb({
      rowsByLabel: {
        ComponentClass: [
          // Group A (canonical 1) — its tx is poisoned.
          nodeRow('A', 1, ['mod-a'], ['HAS_CLASS']),
          nodeRow('A', 2, ['mod-a'], ['HAS_CLASS']),
          // Group B (canonical 5) — must still merge.
          nodeRow('B', 5, ['mod-a'], ['HAS_CLASS']),
          nodeRow('B', 6, ['mod-a'], ['HAS_CLASS']),
        ],
      },
      failTxForCanonical: [1],
    });
    const svc = makeService(db);

    const report = await svc.run({ apply: true });

    expect(report.details.join('\n')).toContain('FAILED merge of :ComponentClass "A"');
    // Group B completed despite group A's failure.
    expect(report.totalActions).toBe(1);
    const deletes = txRuns.filter((r) => r.query.includes('DETACH DELETE'));
    expect(deletes).toHaveLength(1);
    expect(deletes[0].params).toEqual({ ncId: 6 });
  });
});
