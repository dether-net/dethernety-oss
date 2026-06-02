// Integration coverage for countermeasure → MITRE verb edges.
//
// Strategy: construct SetInstantiationAttributesService directly against a real
// Memgraph testcontainer with stub Config/Auth/Monitoring (mirrors
// set-attributes-staleness.e2e-spec), seed MITRE fixture nodes via Cypher, then
// drive the public upsertCountermeasuresInTx / upsertExposuresInTx through a real
// write transaction and assert the created edges + their `justification` property.
//
// Covers: verb-edge creation, edge justification, responds_with stability +
// attribution, exposure parity, closed-set drop of unknown verbs, idempotency +
// append-only durability (at edge and property level), and missing-target tolerance.

import { ConfigService } from '@nestjs/config';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { SetInstantiationAttributesService } from '../../src/gql/resolver-services/set-instantiation-attributes.service';

jest.setTimeout(120_000);

function makeStubConfigService(): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'database.name') return 'memgraph';
      if (key === 'gql') {
        return {
          maxQueryDepth: 10,
          maxQueryComplexity: 1000,
          queryTimeout: 30000,
          enableIntrospection: false,
          enableAuthentication: true,
        };
      }
      return undefined;
    },
  } as unknown as ConfigService;
}

function makeStubAuthService(): any {
  return {
    extractAuthContext: (ctx: any) => ({ user: ctx?.user, token: ctx?.token }),
    checkAuthorization: async () => ({ allowed: true }),
  };
}

function makeStubMonitoringService(): any {
  return { recordOperation: () => {} };
}

// A ref to a MITRE node, optionally carrying edge provenance.
function techRef(attackId: string, justification?: string) {
  return {
    label: 'MitreAttackTechnique',
    property: 'attack_id',
    value: attackId,
    ...(justification ? { attributes: { justification } } : {}),
  };
}
function mitigationRef(attackId: string, justification?: string) {
  return {
    label: 'MitreAttackMitigation',
    property: 'attack_id',
    value: attackId,
    ...(justification ? { attributes: { justification } } : {}),
  };
}
function defendRef(d3fendId: string, justification?: string) {
  return {
    label: 'MitreDefendTechnique',
    property: 'd3fendId',
    value: d3fendId,
    ...(justification ? { attributes: { justification } } : {}),
  };
}

describe('Countermeasure → MITRE verb edges (e2e)', () => {
  let mg: MemgraphHandle;
  let svc: SetInstantiationAttributesService;

  const CTRL = 'ctrl-1';
  const CLS = 'ccls-1';

  beforeAll(async () => {
    mg = await startMemgraph();
    svc = new SetInstantiationAttributesService(
      mg.driver,
      makeStubConfigService(),
      {} as any, // moduleRegistry — unused by the direct upsert path
      makeStubAuthService(),
      makeStubMonitoringService(),
    );
  }, 90_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
  });

  async function runWrite(cypher: string, params: any = {}): Promise<any> {
    const session = mg.driver.session();
    try {
      return await session.run(cypher, params);
    } finally {
      await session.close();
    }
  }

  async function seedControlAndClass(): Promise<void> {
    await runWrite(
      `CREATE (:Control {id: $ctrl})
       CREATE (:ControlClass {id: $cls, name: 'TestControlClass'})`,
      { ctrl: CTRL, cls: CLS },
    );
  }

  async function seedTechnique(attackId: string): Promise<void> {
    await runWrite(
      `CREATE (:MitreAttackTechnique { attack_id: $id, id: $nid, name: $id, description: $id })`,
      { id: attackId, nid: `tech-${attackId}` },
    );
  }
  async function seedMitigation(attackId: string): Promise<void> {
    await runWrite(
      `CREATE (:MitreAttackMitigation { attack_id: $id, id: $nid, name: $id })`,
      { id: attackId, nid: `mit-${attackId}` },
    );
  }
  async function seedDefend(d3fendId: string): Promise<void> {
    await runWrite(
      `CREATE (:MitreDefendTechnique { d3fendId: $id, id: $nid, name: $id })`,
      { id: d3fendId, nid: `def-${d3fendId}` },
    );
  }

  async function upsertCountermeasure(cm: any): Promise<void> {
    const session = mg.driver.session();
    try {
      await session.executeWrite((tx) =>
        svc.upsertCountermeasuresInTx(tx as any, {
          componentId: CTRL,
          classId: CLS,
          countermeasures: [cm],
        }),
      );
    } finally {
      await session.close();
    }
  }

  async function upsertExposure(exp: any): Promise<void> {
    const session = mg.driver.session();
    try {
      await session.executeWrite((tx) =>
        svc.upsertExposuresInTx(tx as any, {
          componentId: CTRL,
          classId: CLS,
          exposures: [exp],
        }),
      );
    } finally {
      await session.close();
    }
  }

  // Returns the target id + justification for every edge of `relType` leaving the
  // named origin finding. relType is a test-controlled constant (safe to interpolate).
  async function edges(
    originName: string,
    relType: string,
  ): Promise<Array<{ target: string; justification: string | null }>> {
    const r = await runWrite(
      `MATCH (e {name: $originName})-[rel:${relType}]->(t)
       RETURN coalesce(t.attack_id, t.d3fendId) AS target, rel.justification AS justification
       ORDER BY target`,
      { originName },
    );
    return r.records.map((rec: any) => ({
      target: rec.get('target'),
      justification: rec.get('justification') ?? null,
    }));
  }

  it('writes COUNTERMEASURE_<VERB> edges to the named techniques', async () => {
    await seedControlAndClass();
    await seedTechnique('T1078');
    await seedTechnique('T1110');

    await upsertCountermeasure({
      name: 'MFA',
      type: 'CONTROL',
      category: 'identity',
      mitigates: [techRef('T1078')],
      detects: [techRef('T1110')],
    });

    expect(await edges('MFA', 'COUNTERMEASURE_MITIGATES')).toEqual([{ target: 'T1078', justification: null }]);
    expect(await edges('MFA', 'COUNTERMEASURE_DETECTS')).toEqual([{ target: 'T1110', justification: null }]);
  });

  it('carries justification on the edge when the ref provides it; bare ref ⇒ no property', async () => {
    await seedControlAndClass();
    await seedTechnique('T1078');
    await seedTechnique('T1110');

    await upsertCountermeasure({
      name: 'MFA',
      type: 'CONTROL',
      category: 'identity',
      mitigates: [techRef('T1078', 'a second factor stops stolen passwords'), techRef('T1110')],
    });

    const m = await edges('MFA', 'COUNTERMEASURE_MITIGATES');
    expect(m).toEqual([
      { target: 'T1078', justification: 'a second factor stops stolen passwords' },
      { target: 'T1110', justification: null },
    ]);
  });

  it('keeps RESPONDS_WITH edges (Mitigation + D3FEND) and now carries justification', async () => {
    await seedControlAndClass();
    await seedMitigation('M1032');
    await seedDefend('D3-MFA');

    await upsertCountermeasure({
      name: 'MFA',
      type: 'CONTROL',
      category: 'identity',
      respondsWith: [mitigationRef('M1032', 'catalog identity of this control'), defendRef('D3-MFA')],
    });

    expect(await edges('MFA', 'RESPONDS_WITH')).toEqual([
      { target: 'D3-MFA', justification: null },
      { target: 'M1032', justification: 'catalog identity of this control' },
    ]);
  });

  it('exposure parity: EXPLOITED_BY edge carries justification', async () => {
    await seedControlAndClass();
    await seedTechnique('T1078');

    await upsertExposure({
      name: 'Weak auth',
      type: 'EXPOSURE',
      category: 'identity',
      exploitedBy: [techRef('T1078', 'valid-accounts abuse')],
    });

    expect(await edges('Weak auth', 'EXPLOITED_BY')).toEqual([
      { target: 'T1078', justification: 'valid-accounts abuse' },
    ]);
  });

  it('drops unknown verb keys (closed set) with no edge and no error', async () => {
    await seedControlAndClass();
    await seedTechnique('T1078');
    await seedTechnique('T1190');

    await upsertCountermeasure({
      name: 'MFA',
      type: 'CONTROL',
      category: 'identity',
      mitigates: [techRef('T1078')],
      // Not part of the closed verb set — must never produce an edge.
      degrades: [techRef('T1190')],
    } as any);

    expect(await edges('MFA', 'COUNTERMEASURE_MITIGATES')).toEqual([{ target: 'T1078', justification: null }]);
    // No DEGRADES-style edge of any naming exists.
    const all = await runWrite(
      `MATCH (:Countermeasure {name: 'MFA'})-[rel]->(:MitreAttackTechnique)
       RETURN collect(DISTINCT type(rel)) AS types`,
    );
    expect(all.records[0].get('types')).toEqual(['COUNTERMEASURE_MITIGATES']);
  });

  it('is idempotent and append-only: re-run is stable; dropping a ref leaves the old edge', async () => {
    await seedControlAndClass();
    await seedTechnique('T1078');
    await seedTechnique('T1110');

    const withBoth = {
      name: 'MFA',
      type: 'CONTROL',
      category: 'identity',
      mitigates: [techRef('T1078')],
      detects: [techRef('T1110')],
    };

    await upsertCountermeasure(withBoth);
    await upsertCountermeasure(withBoth); // re-run ⇒ MERGE, no duplicates

    // Same countermeasure, `detects` ref removed.
    await upsertCountermeasure({
      name: 'MFA',
      type: 'CONTROL',
      category: 'identity',
      mitigates: [techRef('T1078')],
    });

    // MERGE kept edge counts at 1; the dropped-ref DETECTS edge still survives (no pruning).
    expect(await edges('MFA', 'COUNTERMEASURE_MITIGATES')).toEqual([{ target: 'T1078', justification: null }]);
    expect(await edges('MFA', 'COUNTERMEASURE_DETECTS')).toEqual([{ target: 'T1110', justification: null }]);
  });

  it('tolerates a ref to a missing technique: no edge, no throw', async () => {
    await seedControlAndClass();
    // T9999 is intentionally not seeded.

    await expect(
      upsertCountermeasure({
        name: 'MFA',
        type: 'CONTROL',
        category: 'identity',
        mitigates: [techRef('T9999', 'targets a technique that does not exist')],
      }),
    ).resolves.toBeUndefined();

    expect(await edges('MFA', 'COUNTERMEASURE_MITIGATES')).toEqual([]);
  });

  // Append-only at the PROPERTY level (the idempotency test above covers the edge level).
  // `SET rel += $attributes` merges, it does not replace, so a later run that drops
  // the justification (empty attribute map) must NOT clobber the earlier value.
  it('append-only justification: a later bare ref does not clobber an earlier justification', async () => {
    await seedControlAndClass();
    await seedTechnique('T1078');

    // First run records a justification on the edge.
    await upsertCountermeasure({
      name: 'MFA',
      type: 'CONTROL',
      category: 'identity',
      mitigates: [techRef('T1078', 'a second factor stops stolen passwords')],
    });

    // Second run supplies the same ref WITHOUT justification (empty attribute map).
    await upsertCountermeasure({
      name: 'MFA',
      type: 'CONTROL',
      category: 'identity',
      mitigates: [techRef('T1078')],
    });

    // The earlier justification survives the bare re-run.
    expect(await edges('MFA', 'COUNTERMEASURE_MITIGATES')).toEqual([
      { target: 'T1078', justification: 'a second factor stops stolen passwords' },
    ]);
  });

  // Every schema-wired verb routes to its own COUNTERMEASURE_<VERB> edge type.
  // Defends the naming isomorphism on the write side across all four production verbs
  // (the creation test above only exercised mitigates + detects). A typo in a
  // COUNTERMEASURE_VERB_EDGES map value (e.g. detects → 'COUNTERMEASURE_DETECT')
  // fails exactly its own row here.
  it('routes each wired verb field to its own edge type', async () => {
    await seedControlAndClass();
    const wired = [
      { field: 'mitigates', edge: 'COUNTERMEASURE_MITIGATES', tech: 'T1078' },
      { field: 'protectsAgainst', edge: 'COUNTERMEASURE_PROTECTS_AGAINST', tech: 'T1110' },
      { field: 'detects', edge: 'COUNTERMEASURE_DETECTS', tech: 'T1190' },
      { field: 'isolates', edge: 'COUNTERMEASURE_ISOLATES', tech: 'T1021' },
    ];
    for (const w of wired) await seedTechnique(w.tech);

    // One countermeasure carrying all four wired verbs at once.
    await upsertCountermeasure({
      name: 'MFA',
      type: 'CONTROL',
      category: 'identity',
      ...Object.fromEntries(wired.map((w) => [w.field, [techRef(w.tech)]])),
    });

    for (const w of wired) {
      expect(await edges('MFA', w.edge)).toEqual([{ target: w.tech, justification: null }]);
    }
  });
});
