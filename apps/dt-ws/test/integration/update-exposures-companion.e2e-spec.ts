// Integration coverage for the USER-copy-delete companion Cypher.
//
// Backend regression test ONLY. A later step will wire the dt-core
// orchestration in `dtExposure.deleteExposure` to issue the actual
// `updateExposures` GraphQL mutation. This test exercises the underlying
// Cypher semantics directly via the Memgraph driver — proving the backend
// supports the companion contract before the wrapper exists.
//
// Coverage:
//   - Positive: SUPERSEDED exposure with reason matching "'<deletedName>'"
//     bracket pattern → dispositionStale flipped.
//   - Negative: SUPERSEDED exposure with different name in reason → unchanged.
//   - Bracket disambiguator: SUPERSEDED exposure whose reason mentions the
//     name WITHOUT the single-quote brackets → unchanged (proves the
//     single-quote bracketing prevents false-positive substring matches).

import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';

jest.setTimeout(120_000);

async function runWrite(driver: any, cypher: string, params: any = {}): Promise<any> {
  const session = driver.session();
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

async function readStale(driver: any, exposureId: string): Promise<boolean | null> {
  const session = driver.session();
  try {
    const r = await session.run(
      `MATCH (e:Exposure {id: $id}) RETURN e.dispositionStale AS s`,
      { id: exposureId },
    );
    if (r.records.length === 0) return null;
    return r.records[0].get('s');
  } finally {
    await session.close();
  }
}

// The companion Cypher, run verbatim against the driver to mimic the eventual
// dt-core orchestration that will issue it via the auto-generated
// `updateExposures` GraphQL mutation.
async function runCompanionFlip(driver: any, deletedName: string): Promise<number> {
  const session = driver.session();
  try {
    const r = await session.executeWrite(async (tx: any) => {
      return tx.run(
        `
        MATCH (e:Exposure)
        WHERE e.dispositionKind = 'SUPERSEDED'
          AND e.dispositionReason CONTAINS ("'" + $deletedName + "'")
        SET e.dispositionStale = true
        RETURN count(e) AS flipped
        `,
        { deletedName },
      );
    });
    const raw = r.records[0].get('flipped');
    return typeof raw === 'number' ? raw : typeof raw.toNumber === 'function' ? raw.toNumber() : Number(raw);
  } finally {
    await session.close();
  }
}

describe('USER-copy-delete companion Cypher (e2e)', () => {
  let mg: MemgraphHandle;

  beforeAll(async () => {
    mg = await startMemgraph();
  }, 90_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
  });

  it('flips dispositionStale on a SUPERSEDED exposure when the deleted-name matches the bracketed reason', async () => {
    // e1 is SUPERSEDED with the canonical reason format (single quotes around the name).
    // e2 is undispositioned — should not be touched.
    await runWrite(
      mg.driver,
      `CREATE (:Exposure {
        id: 'e1', name: 'SYSTEM SQL Injection',
        dispositionKind: 'SUPERSEDED',
        dispositionReason: "Superseded by user-authored exposure 'Custom SQL Injection'",
        dispositionedBy: 'auth0|prior',
        dispositionedAt: '2026-01-01T00:00:00.000Z',
        dispositionStale: false
      })`,
    );
    await runWrite(
      mg.driver,
      `CREATE (:Exposure { id: 'e2', name: 'Unrelated' })`,
    );

    const flipped = await runCompanionFlip(mg.driver, 'Custom SQL Injection');
    expect(flipped).toBe(1);

    expect(await readStale(mg.driver, 'e1')).toBe(true);
    // e2 is undispositioned — its dispositionStale property is null/absent;
    // Memgraph returns null for missing scalar properties.
    expect(await readStale(mg.driver, 'e2')).toBeNull();
  });

  it('does not flip when the deleted-name does not match the bracketed reason', async () => {
    await runWrite(
      mg.driver,
      `CREATE (:Exposure {
        id: 'e1', name: 'SYSTEM SQL Injection',
        dispositionKind: 'SUPERSEDED',
        dispositionReason: "Superseded by user-authored exposure 'Custom SQL Injection'",
        dispositionedBy: 'auth0|prior',
        dispositionedAt: '2026-01-01T00:00:00.000Z',
        dispositionStale: false
      })`,
    );

    const flipped = await runCompanionFlip(mg.driver, 'Different Name');
    expect(flipped).toBe(0);
    expect(await readStale(mg.driver, 'e1')).toBe(false);
  });

  it('bracket disambiguator: substring match WITHOUT the single-quote brackets does NOT trigger the flip', async () => {
    // e1 has the canonical bracketed reason → should flip.
    // e3 has the name in unrelated prose without single-quote brackets → must NOT flip.
    await runWrite(
      mg.driver,
      `CREATE (:Exposure {
        id: 'e1', name: 'SYSTEM SQL Injection',
        dispositionKind: 'SUPERSEDED',
        dispositionReason: "Superseded by user-authored exposure 'Custom SQL Injection'",
        dispositionedBy: 'auth0|prior',
        dispositionedAt: '2026-01-01T00:00:00.000Z',
        dispositionStale: false
      })`,
    );
    await runWrite(
      mg.driver,
      `CREATE (:Exposure {
        id: 'e3', name: 'Other SUPERSEDED',
        dispositionKind: 'SUPERSEDED',
        dispositionReason: "Mentions Custom SQL Injection in unrelated prose without bracket disambiguators",
        dispositionedBy: 'auth0|prior',
        dispositionedAt: '2026-01-01T00:00:00.000Z',
        dispositionStale: false
      })`,
    );

    const flipped = await runCompanionFlip(mg.driver, 'Custom SQL Injection');
    expect(flipped).toBe(1);
    expect(await readStale(mg.driver, 'e1')).toBe(true);
    expect(await readStale(mg.driver, 'e3')).toBe(false);
  });
});
