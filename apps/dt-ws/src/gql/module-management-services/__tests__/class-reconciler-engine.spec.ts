import { ClassReconciler } from '../class-reconciler.service';

/**
 * The MAGE probe per engine. `CALL mg.procedures()` exists only on Memgraph,
 * so a Neo4j answer from the engine probe settles the rename path without
 * asking for it. A failed engine probe decides nothing: the MAGE probe still
 * runs.
 */

function makeDriver(mageCount: number) {
  const run = jest.fn(async (_cypher: string) => ({ records: [{ get: () => mageCount }] }));
  const driver = { session: jest.fn(() => ({ run, close: jest.fn(async () => {}) })) };
  return { driver, run };
}

function makeTx() {
  const run = jest.fn(async (_cypher: string, _params?: unknown) => ({ records: [] }));
  return { tx: { run } as any, run };
}

function engine(answer: () => Promise<{ engine: 'neo4j' | 'memgraph' }>) {
  return { getEngineInfoStrict: jest.fn(answer) } as any;
}

const events = {} as any;
const statements = (run: jest.Mock) => run.mock.calls.map(([c]) => String(c));

describe('ClassReconciler — MAGE probe per engine', () => {
  it('Neo4j: never calls mg.procedures(), renames with DELETE+CREATE, and asks the engine once', async () => {
    const { driver, run } = makeDriver(1);
    const db = engine(async () => ({ engine: 'neo4j' }));
    const reconciler = new ClassReconciler(driver, events, db);
    const { tx, run: txRun } = makeTx();

    await reconciler.orphanClass(tx, 'm', 'ComponentClass', 'c1');
    await reconciler.reviveClass(tx, 'm', 'ComponentClass', 'c1');

    expect(run).not.toHaveBeenCalled();
    expect(db.getEngineInfoStrict).toHaveBeenCalledTimes(1);
    expect(statements(txRun).some((s) => s.includes('refactor.rename_type'))).toBe(false);
    expect(statements(txRun).filter((s) => s.includes('DELETE r'))).toHaveLength(2);
  });

  it('Memgraph: probes mg.procedures() and uses MAGE when present', async () => {
    const { driver, run } = makeDriver(1);
    const reconciler = new ClassReconciler(driver, events, engine(async () => ({ engine: 'memgraph' })));
    const { tx, run: txRun } = makeTx();

    await reconciler.orphanClass(tx, 'm', 'ComponentClass', 'c1');

    expect(statements(run).some((s) => s.includes('mg.procedures'))).toBe(true);
    expect(statements(txRun).some((s) => s.includes('refactor.rename_type'))).toBe(true);
  });

  it('a failed engine probe still lets a MAGE-equipped Memgraph use MAGE', async () => {
    const { driver, run } = makeDriver(1);
    const db = engine(async () => {
      throw new Error('db unreachable');
    });
    const reconciler = new ClassReconciler(driver, events, db);
    const { tx, run: txRun } = makeTx();

    await reconciler.orphanClass(tx, 'm', 'ComponentClass', 'c1');

    expect(statements(run).some((s) => s.includes('mg.procedures'))).toBe(true);
    expect(statements(txRun).some((s) => s.includes('refactor.rename_type'))).toBe(true);
  });
});
