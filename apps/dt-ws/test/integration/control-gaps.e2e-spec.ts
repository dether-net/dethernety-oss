// Integration coverage for ControlGapsResolverService (controlGaps query).
//
// Strategy: construct the resolver service directly against a real Memgraph
// testcontainer (mirrors mitre-verb-edges.e2e-spec) and drive
// executeControlGaps. The headline case is the float-LIMIT regression: Phase 3's
// LIMIT param used to be a plain JS number, which Bolt packs as Float64 and
// Memgraph rejects ("Limit on number of returned elements must be an
// integer.") — i.e. controlGaps threw on ANY model with a real gap. The
// other cases live-prove the Model-anchored scope (boundary-less models
// analyze their Data) and guard the rewrite against over-reporting on the
// mitigated path.

import { ConfigService } from '@nestjs/config';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { ControlGapsResolverService } from '../../src/gql/resolver-services/control-gaps-resolver.service';

jest.setTimeout(120_000);

function makeStubConfigService(): ConfigService {
  return {
    get: (key: string) => (key === 'database.name' ? 'memgraph' : undefined),
  } as unknown as ConfigService;
}

describe('ControlGapsResolverService — live Memgraph (e2e)', () => {
  let mg: MemgraphHandle;
  let svc: ControlGapsResolverService;

  beforeAll(async () => {
    mg = await startMemgraph();
    svc = new ControlGapsResolverService(
      mg.driver as any,
      makeStubConfigService(),
      {} as any, // authorizationService — unused on the direct path
      { recordOperation: () => {} } as any,
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

  const gaps = (modelId: string) =>
    (svc as any).executeControlGaps({ modelId });

  const sumOf = (s: any) =>
    s.mitigated + s.configuredCoverage + s.noMitreChain + s.unmitigated + s.unaddressable;

  it('Phase 3 returns recommendations instead of throwing on the float LIMIT (live regression)', async () => {
    // Unmitigated exposure with a full addressable MITRE chain and a
    // recommendable control — exactly the state where Phase 3 (and its
    // LIMIT) must run. Pre-fix: Memgraph "Limit ... must be an integer".
    // The ControlClass carries NO supportedTypes — also live-proves the
    // ratified lenient null semantic (null = compatible with everything).
    await runWrite(`
      CREATE (m:Model {id: 'model-1', name: 'M'})
      CREATE (b:SecurityBoundary {id: 'b-1', name: 'B'})
      CREATE (m)-[:CONTAINS]->(b)
      CREATE (c:Component {id: 'comp-1', name: 'C', type: 'server'})
      CREATE (c)-[:BELONGS_TO]->(b)
      CREATE (e:Exposure {id: 'exp-1', name: 'SQLi'})
      CREATE (c)-[:HAS_EXPOSURE]->(e)
      CREATE (t:MitreAttackTechnique {id: 'tech-1', attack_id: 'T1190', name: 'Exploit Public-Facing Application'})
      CREATE (e)-[:EXPLOITED_BY]->(t)
      CREATE (mit:MitreAttackMitigation {id: 'mit-1', attack_id: 'M1050', name: 'Exploit Protection'})
      CREATE (mit)-[:MITIGATION_DEFENDS_AGAINST_TECHNIQUE]->(t)
      CREATE (cm:Countermeasure {id: 'cm-1', name: 'WAF'})
      CREATE (cm)-[:RESPONDS_WITH]->(mit)
      CREATE (cc:ControlClass {id: 'cc-1', name: 'WAF Class'})
      CREATE (cm)-[:IS_COUNTERMEASURE_OF]->(cc)
      CREATE (mod:Module {id: 'mod-1-id', name: 'mod-1'})
      CREATE (mod)-[:HAS_CLASS]->(cc)
      CREATE (ctrl:Control {id: 'ctrl-1', name: 'WAF Control'})
      CREATE (ctrl)-[:HAS_COUNTERMEASURE]->(cm)
      CREATE (ctrl)-[:IS_INSTANCE_OF]->(cc)
    `);

    const result = await gaps('model-1');

    const s = result.coverageSummary;
    expect(s.totalExposures).toBe(1);
    expect(s.unmitigated).toBe(1);
    expect(sumOf(s)).toBe(s.totalExposures);

    expect(result.unmitigatedExposures).toHaveLength(1);
    expect(result.unmitigatedExposures[0].exposureId).toBe('exp-1');
    expect(result.unmitigatedExposures[0].recommendedMitigations).toEqual([
      { id: 'M1050', name: 'Exploit Protection' },
    ]);

    expect(result.recommendedControls).toHaveLength(1);
    expect(result.recommendedControls[0].controlId).toBe('ctrl-1');
    expect(result.recommendedControls[0].controlClassId).toBe('cc-1');
    expect(result.recommendedControls[0].addressesCount).toBe(1);
    expect(result.recommendedControls[0].d3fendTechniques).toEqual([]);
    expect(result.recommendedControls[0].elementsAffected).toEqual([]);
  });

  it('nested boundary, flow, boundary exposure, and configuredCoverage all resolve live', async () => {
    // Live-proves the scope legs the headline case does not touch — the
    // BELONGS_TO*0..50 nesting rewrite, the FLOWS leg, a boundary's own
    // exposure — plus the configuredCoverage bucket end-to-end: ctrl-x
    // SUPPORTS the component but responds to an unrelated mitigation, so
    // exp-cc is configuredCoverage (not mitigated, not listed), while its
    // technique still reaches Phase 3 through the addressability union and
    // ctrl-rec gets recommended. Mutating the Phase-2b union or the
    // nesting walk turns this red.
    await runWrite(`
      CREATE (m:Model {id: 'model-4', name: 'M4'})
      CREATE (bt:SecurityBoundary {id: 'b-top', name: 'Top'})
      CREATE (m)-[:CONTAINS]->(bt)
      CREATE (bn:SecurityBoundary {id: 'b-nested', name: 'Nested'})
      CREATE (bn)-[:BELONGS_TO]->(bt)
      CREATE (c:Component {id: 'comp-4', name: 'C4', type: 'server'})
      CREATE (c)-[:BELONGS_TO]->(bn)
      CREATE (f:DataFlow {id: 'flow-4', name: 'F4'})
      CREATE (c)-[:FLOWS]->(f)

      // exp-cc: technique T-A, addressable mitigation M-A; ctrl-x supports
      // the component but responds to the unrelated M-Z -> configuredCoverage.
      CREATE (ecc:Exposure {id: 'exp-cc', name: 'Covered wrong'})
      CREATE (c)-[:HAS_EXPOSURE]->(ecc)
      CREATE (ta:MitreAttackTechnique {id: 't-a', attack_id: 'T1078', name: 'Valid Accounts'})
      CREATE (ecc)-[:EXPLOITED_BY]->(ta)
      CREATE (ma:MitreAttackMitigation {id: 'm-a', attack_id: 'M1032', name: 'MFA'})
      CREATE (ma)-[:MITIGATION_DEFENDS_AGAINST_TECHNIQUE]->(ta)
      CREATE (cma:Countermeasure {id: 'cm-a', name: 'MFA cm'})
      CREATE (cma)-[:RESPONDS_WITH]->(ma)
      CREATE (cca:ControlClass {id: 'cc-a', name: 'MFA Class'})
      CREATE (cma)-[:IS_COUNTERMEASURE_OF]->(cca)
      CREATE (mod:Module {id: 'mod-4-id', name: 'mod-4'})
      CREATE (mod)-[:HAS_CLASS]->(cca)
      CREATE (mz:MitreAttackMitigation {id: 'm-z', attack_id: 'M1050', name: 'Unrelated'})
      CREATE (cmz:Countermeasure {id: 'cm-z', name: 'Unrelated cm'})
      CREATE (cmz)-[:RESPONDS_WITH]->(mz)
      CREATE (ctrlx:Control {id: 'ctrl-x', name: 'Wrong-technique control'})
      CREATE (ctrlx)-[:HAS_COUNTERMEASURE]->(cmz)
      CREATE (ctrlx)-[:SUPPORTS]->(c)

      // ctrl-rec addresses T-A and is recommendable.
      CREATE (ctrlrec:Control {id: 'ctrl-rec', name: 'MFA control'})
      CREATE (ctrlrec)-[:HAS_COUNTERMEASURE]->(cma)
      CREATE (ctrlrec)-[:IS_INSTANCE_OF]->(cca)

      // exp-flow on the DataFlow, exp-bnd on the nested boundary — both
      // technique-linked with no known mitigation -> unaddressable.
      CREATE (ef:Exposure {id: 'exp-flow', name: 'Cleartext'})
      CREATE (f)-[:HAS_EXPOSURE]->(ef)
      CREATE (tb:MitreAttackTechnique {id: 't-b', attack_id: 'T1040', name: 'Sniffing'})
      CREATE (ef)-[:EXPLOITED_BY]->(tb)
      CREATE (eb:Exposure {id: 'exp-bnd', name: 'Flat segment'})
      CREATE (bn)-[:HAS_EXPOSURE]->(eb)
      CREATE (tc:MitreAttackTechnique {id: 't-c', attack_id: 'T1021', name: 'Remote Services'})
      CREATE (eb)-[:EXPLOITED_BY]->(tc)
    `);

    const result = await gaps('model-4');

    const s = result.coverageSummary;
    expect(s.totalExposures).toBe(3); // nested-boundary comp + flow + boundary all in scope
    expect(s.configuredCoverage).toBe(1);
    expect(s.unaddressable).toBe(2);
    expect(s.unmitigated).toBe(0);
    expect(s.mitigated).toBe(0);
    expect(sumOf(s)).toBe(s.totalExposures);

    // The configuredCoverage exposure is listed nowhere...
    expect(
      [...result.unmitigatedExposures, ...result.unaddressableExposures].map(
        (e: any) => e.exposureId,
      ).sort(),
    ).toEqual(['exp-bnd', 'exp-flow']);
    // ...but its technique still drives a recommendation (Phase-2b union).
    expect(result.recommendedControls).toHaveLength(1);
    expect(result.recommendedControls[0].controlId).toBe('ctrl-rec');
  });

  it('a boundary-less model analyzes its Data exposures instead of reporting "no gaps"', async () => {
    // Pre-fix, the scope query hard-MATCHed a SecurityBoundary, so this
    // model returned totalExposures 0 — dishonest "no gaps".
    await runWrite(`
      CREATE (m:Model {id: 'model-2', name: 'M2'})
      CREATE (d:Data {id: 'data-1', name: 'PII store'})
      CREATE (m)-[:CONTAINS]->(d)
      CREATE (e:Exposure {id: 'exp-2', name: 'Unencrypted at rest'})
      CREATE (d)-[:HAS_EXPOSURE]->(e)
      CREATE (t:MitreAttackTechnique {id: 'tech-2', attack_id: 'T1530', name: 'Data from Cloud Storage'})
      CREATE (e)-[:EXPLOITED_BY]->(t)
    `);

    const result = await gaps('model-2');

    const s = result.coverageSummary;
    expect(s.totalExposures).toBe(1);
    // No known mitigation → the exposure surfaces as unaddressable with an
    // empty mitigations list (the disjoint-bucket fold), not invisibly.
    expect(s.unaddressable).toBe(1);
    expect(sumOf(s)).toBe(s.totalExposures);
    expect(result.unaddressableExposures).toHaveLength(1);
    expect(result.unaddressableExposures[0].exposureId).toBe('exp-2');
    expect(result.unaddressableExposures[0].mitreMitigations).toEqual([]);
  });

  it('mitigated path: a control covering the technique yields mitigated=1 and empty lists', async () => {
    await runWrite(`
      CREATE (m:Model {id: 'model-3', name: 'M3'})
      CREATE (b:SecurityBoundary {id: 'b-3', name: 'B3'})
      CREATE (m)-[:CONTAINS]->(b)
      CREATE (c:Component {id: 'comp-3', name: 'C3', type: 'server'})
      CREATE (c)-[:BELONGS_TO]->(b)
      CREATE (e:Exposure {id: 'exp-3', name: 'Brute force'})
      CREATE (c)-[:HAS_EXPOSURE]->(e)
      CREATE (t:MitreAttackTechnique {id: 'tech-3', attack_id: 'T1110', name: 'Brute Force'})
      CREATE (e)-[:EXPLOITED_BY]->(t)
      CREATE (mit:MitreAttackMitigation {id: 'mit-3', attack_id: 'M1032', name: 'Multi-factor Authentication'})
      CREATE (mit)-[:MITIGATION_DEFENDS_AGAINST_TECHNIQUE]->(t)
      CREATE (cm:Countermeasure {id: 'cm-3', name: 'MFA'})
      CREATE (cm)-[:RESPONDS_WITH]->(mit)
      CREATE (ctrl:Control {id: 'ctrl-3', name: 'MFA Control'})
      CREATE (ctrl)-[:HAS_COUNTERMEASURE]->(cm)
      CREATE (ctrl)-[:SUPPORTS]->(c)
    `);

    const result = await gaps('model-3');

    const s = result.coverageSummary;
    expect(s.totalExposures).toBe(1);
    expect(s.mitigated).toBe(1);
    expect(sumOf(s)).toBe(s.totalExposures);
    expect(result.unmitigatedExposures).toEqual([]);
    expect(result.unaddressableExposures).toEqual([]);
    expect(result.recommendedControls).toEqual([]);
    expect(s.coveragePct).toBe(100);
  });
});
