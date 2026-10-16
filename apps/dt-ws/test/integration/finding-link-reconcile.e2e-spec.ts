// Integration coverage for the link reconcile of class-derived findings: after a save, each
// SYSTEM exposure or countermeasure is linked to exactly the references its class policy
// emits now.
//
// Strategy: SetInstantiationAttributesService (and ElementBindingService for the binding path)
// constructed directly against a real Memgraph testcontainer with stub Config/Auth/Monitoring
// and a fake module registry whose module returns the findings a test sets per class (mirrors
// set-attributes-staleness and element-binding e2e specs). Saves go through the public
// setAttributes with no attribute changes, so a stale flip seen here comes from a link change
// alone, never from the attribute-change flip.
//
// Covers: a partial drop of EXPLOITED_BY references; a partial drop across RESPONDS_WITH and
// the verb edges; what a save never touches (USER findings, a supersede copy, another class's
// finding, edges to non-reference nodes); a hand-added link removed by the next save; the
// dispositionStale flip on a link change; a binding change that keeps a class; and two
// concurrent saves of one element.

import { ConfigService } from '@nestjs/config';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { SetInstantiationAttributesService } from '../../src/gql/resolver-services/set-instantiation-attributes.service';
import { ElementBindingService } from '../../src/gql/resolver-services/element-binding.service';

jest.setTimeout(120_000);

const MODULE_NAME = 'mod-1';

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

// The module returns, per class, whatever the test set last: switching the set between two
// saves is a class policy change.
type ClassPolicy = { exposures?: any[]; countermeasures?: any[] };

class FakeModuleRegistry {
  private byClass = new Map<string, ClassPolicy>();

  setPolicy(classId: string, policy: ClassPolicy): void {
    this.byClass.set(classId, policy);
  }

  reset(): void {
    this.byClass.clear();
  }

  getModuleByName(name: string): any | undefined {
    if (name !== MODULE_NAME) return undefined;
    const byClass = this.byClass;
    return {
      getExposures: async (_elementId: string, classId: string) => byClass.get(classId)?.exposures ?? [],
      getCountermeasures: async (_elementId: string, classId: string) => byClass.get(classId)?.countermeasures ?? [],
    };
  }
}

// References, as a module's policy names them.
const technique = (attackId: string, justification?: string) => ({
  label: 'MitreAttackTechnique',
  property: 'attack_id',
  value: attackId,
  ...(justification ? { attributes: { justification } } : {}),
});
const atlasTechnique = (atlasId: string) => ({ label: 'MitreAtlasTechnique', property: 'atlas_id', value: atlasId });
const mitigation = (attackId: string) => ({ label: 'MitreAttackMitigation', property: 'attack_id', value: attackId });
const defend = (d3fendId: string) => ({ label: 'MitreDefendTechnique', property: 'd3fendId', value: d3fendId });
const requirement = (id: string) => ({ label: 'RegulatoryRequirement', property: 'id', value: id });

function num(v: any): number {
  return typeof v?.toNumber === 'function' ? v.toNumber() : Number(v);
}

async function runWrite(driver: any, cypher: string, params: any = {}): Promise<any> {
  const session = driver.session();
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

async function seedModule(driver: any): Promise<void> {
  await runWrite(driver, `CREATE (:Module {id: 'mod-1-id', name: $name})`, { name: MODULE_NAME });
}

async function seedClass(driver: any, label: string, classId: string): Promise<void> {
  await runWrite(
    driver,
    `MATCH (m:Module {name: $name}) CREATE (m)-[:HAS_CLASS]->(:${label} {id: $classId, name: $classId})`,
    { name: MODULE_NAME, classId },
  );
}

async function seedElement(driver: any, label: string, elementId: string, classIds: string[]): Promise<void> {
  await runWrite(driver, `CREATE (:${label} {id: $elementId, name: $elementId})`, { elementId });
  for (const classId of classIds) {
    await runWrite(
      driver,
      `MATCH (c {id: $elementId}), (k {id: $classId}) MERGE (c)-[:IS_INSTANCE_OF]->(k)`,
      { elementId, classId },
    );
  }
}

// The reference nodes every test can link to: one of each of the six reference labels, and
// more ATT&CK techniques.
async function seedReferences(driver: any): Promise<void> {
  await runWrite(
    driver,
    `UNWIND ['T1078', 'T1110', 'T1190', 'T1021'] AS id
     CREATE (:MitreAttackTechnique {attack_id: id, id: 'tech-' + id, name: id})`,
  );
  await runWrite(driver, `CREATE (:MitreAtlasTechnique {atlas_id: 'AML.T0051', id: 'atlas-AML.T0051', name: 'AML.T0051'})`);
  await runWrite(
    driver,
    `UNWIND ['M1032', 'M1026'] AS id CREATE (:MitreAttackMitigation {attack_id: id, id: 'mit-' + id, name: id})`,
  );
  await runWrite(driver, `CREATE (:MitreDefendTechnique {d3fendId: 'D3-MFA', id: 'def-D3-MFA', name: 'D3-MFA'})`);
  await runWrite(driver, `CREATE (:RegulatoryRequirement {id: 'REQ-1', name: 'REQ-1'})`);
}

interface FindingRow {
  id: string;
  name: string;
  createdBy: string | null;
  classId: string | null;
  dispositionKind: string | null;
  dispositionStale: boolean | null;
  links: string[];
}

// Every finding of the element, with each outgoing edge other than its class edge as
// "<TYPE> <target label> <target key>", sorted. Duplicated edges show twice.
async function readFindings(driver: any, elementId: string): Promise<FindingRow[]> {
  const r = await runWrite(
    driver,
    `MATCH (c {id: $elementId})-[:HAS_EXPOSURE|HAS_COUNTERMEASURE]->(f)
     OPTIONAL MATCH (f)-[:IS_EXPOSURE_OF|IS_COUNTERMEASURE_OF]->(k)
     WITH f, k
     OPTIONAL MATCH (f)-[r]->(t)
     WHERE NOT type(r) IN ['IS_EXPOSURE_OF', 'IS_COUNTERMEASURE_OF']
     WITH f, k, CASE WHEN r IS NULL THEN null
                ELSE type(r) + ' ' + labels(t)[0] + ' ' + coalesce(t.attack_id, t.atlas_id, t.d3fendId, t.id) END AS link
     RETURN f.id AS id, f.name AS name, f.createdBy AS createdBy, k.id AS classId,
            f.dispositionKind AS dispositionKind, f.dispositionStale AS dispositionStale,
            collect(link) AS links`,
    { elementId },
  );
  return r.records
    .map((rec: any) => ({
      id: rec.get('id'),
      name: rec.get('name'),
      createdBy: rec.get('createdBy') ?? null,
      classId: rec.get('classId') ?? null,
      dispositionKind: rec.get('dispositionKind') ?? null,
      dispositionStale: rec.get('dispositionStale') ?? null,
      links: (rec.get('links') as Array<string | null>).filter((l): l is string => l !== null).sort(),
    }))
    .sort((a: FindingRow, b: FindingRow) => {
      // Plain code-unit order, so the expected lists do not depend on the locale.
      const ka = `${a.name}|${a.createdBy}|${a.classId}`;
      const kb = `${b.name}|${b.createdBy}|${b.classId}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
}

function only(rows: FindingRow[], name: string, createdBy: string, classId: string | null): FindingRow {
  const matches = rows.filter(r => r.name === name && r.createdBy === createdBy && r.classId === classId);
  expect(matches).toHaveLength(1);
  return matches[0];
}

async function justification(driver: any, elementId: string, name: string, type: string, targetKey: string): Promise<any> {
  const r = await runWrite(
    driver,
    `MATCH (c {id: $elementId})-[:HAS_EXPOSURE|HAS_COUNTERMEASURE]->(f {name: $name, createdBy: 'SYSTEM'})-[rel]->(t)
     WHERE type(rel) = $type AND coalesce(t.attack_id, t.atlas_id, t.d3fendId, t.id) = $targetKey
     RETURN rel.justification AS justification`,
    { elementId, name, type, targetKey },
  );
  expect(r.records).toHaveLength(1);
  return r.records[0].get('justification') ?? null;
}

// Dispose a finding by hand, as the disposition resolver leaves it.
async function dispose(
  driver: any,
  elementId: string,
  name: string,
  kind: string,
  stale: boolean | null,
): Promise<void> {
  await runWrite(
    driver,
    `MATCH (c {id: $elementId})-[:HAS_EXPOSURE|HAS_COUNTERMEASURE]->(f {name: $name, createdBy: 'SYSTEM'})
     SET f.dispositionKind = $kind, f.dispositionReason = 'Reviewed', f.dispositionedBy = 'auth0|prior',
         f.dispositionedAt = '2026-01-01T00:00:00.000Z', f.dispositionStale = $stale`,
    { elementId, name, kind, stale },
  );
}

describe('Finding links follow the class policy (e2e)', () => {
  let mg: MemgraphHandle;
  let registry: FakeModuleRegistry;
  let svc: SetInstantiationAttributesService;
  let binding: ElementBindingService;

  beforeAll(async () => {
    mg = await startMemgraph();
    registry = new FakeModuleRegistry();
    const config = makeStubConfigService();
    const auth = makeStubAuthService();
    // onModuleInit is not run, so no cleanup interval outlives the suite.
    svc = new SetInstantiationAttributesService(mg.driver, config, registry as any, auth, makeStubMonitoringService());
    binding = new ElementBindingService(mg.driver as any, config, registry as any, auth as any, svc);
  }, 90_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
    registry.reset();
    await seedModule(mg.driver);
    await seedReferences(mg.driver);
  });

  const save = async (elementId: string, classId: string) => {
    const result = await svc.setAttributes({ componentId: elementId, classId, attributes: {} });
    expect(result.success).toBe(true);
    return result;
  };

  describe('a policy that drops references', () => {
    it('exposure: dropping one EXPLOITED_BY reference deletes only that edge', async () => {
      await seedClass(mg.driver, 'ComponentClass', 'cc-A');
      await seedElement(mg.driver, 'Component', 'cmp-1', ['cc-A']);

      registry.setPolicy('cc-A', {
        exposures: [
          {
            name: 'Weak auth',
            exploitedBy: [technique('T1078', 'valid accounts'), technique('T1110'), atlasTechnique('AML.T0051')],
          },
        ],
      });
      await save('cmp-1', 'cc-A');
      expect(only(await readFindings(mg.driver, 'cmp-1'), 'Weak auth', 'SYSTEM', 'cc-A').links).toEqual([
        'EXPLOITED_BY MitreAtlasTechnique AML.T0051',
        'EXPLOITED_BY MitreAttackTechnique T1078',
        'EXPLOITED_BY MitreAttackTechnique T1110',
      ]);
      const before = only(await readFindings(mg.driver, 'cmp-1'), 'Weak auth', 'SYSTEM', 'cc-A');

      registry.setPolicy('cc-A', {
        exposures: [
          { name: 'Weak auth', exploitedBy: [technique('T1078', 'valid accounts'), atlasTechnique('AML.T0051')] },
        ],
      });
      const result = await save('cmp-1', 'cc-A');

      const after = only(await readFindings(mg.driver, 'cmp-1'), 'Weak auth', 'SYSTEM', 'cc-A');
      // The same finding node, minus the one edge.
      expect(after.id).toBe(before.id);
      expect(after.links).toEqual([
        'EXPLOITED_BY MitreAtlasTechnique AML.T0051',
        'EXPLOITED_BY MitreAttackTechnique T1078',
      ]);
      expect(await justification(mg.driver, 'cmp-1', 'Weak auth', 'EXPLOITED_BY', 'T1078')).toBe('valid accounts');
      // The edge goes, the technique stays.
      const techniques = await runWrite(mg.driver, `MATCH (t:MitreAttackTechnique {attack_id: 'T1110'}) RETURN count(t) AS n`);
      expect(num(techniques.records[0].get('n'))).toBe(1);
      expect(result.staleFlippedCount).toBe(0);
    });

    it('exposure: a reference kept without its justification has the justification cleared', async () => {
      await seedClass(mg.driver, 'ComponentClass', 'cc-A');
      await seedElement(mg.driver, 'Component', 'cmp-1', ['cc-A']);
      registry.setPolicy('cc-A', { exposures: [{ name: 'Weak auth', exploitedBy: [technique('T1078', 'valid accounts')] }] });
      await save('cmp-1', 'cc-A');

      registry.setPolicy('cc-A', { exposures: [{ name: 'Weak auth', exploitedBy: [technique('T1078')] }] });
      await save('cmp-1', 'cc-A');

      expect(only(await readFindings(mg.driver, 'cmp-1'), 'Weak auth', 'SYSTEM', 'cc-A').links).toEqual([
        'EXPLOITED_BY MitreAttackTechnique T1078',
      ]);
      expect(await justification(mg.driver, 'cmp-1', 'Weak auth', 'EXPLOITED_BY', 'T1078')).toBeNull();
    });

    it('countermeasure: a partial drop across RESPONDS_WITH and the verb edges deletes only the dropped links', async () => {
      await seedClass(mg.driver, 'ControlClass', 'ccls-A');
      await seedElement(mg.driver, 'Control', 'ctrl-1', ['ccls-A']);

      registry.setPolicy('ccls-A', {
        countermeasures: [
          {
            name: 'MFA',
            type: 'CONTROL',
            category: 'identity',
            respondsWith: [mitigation('M1032'), defend('D3-MFA'), requirement('REQ-1')],
            mitigates: [technique('T1078'), technique('T1110')],
            detects: [technique('T1078'), technique('T1190')],
          },
        ],
      });
      await save('ctrl-1', 'ccls-A');
      expect(only(await readFindings(mg.driver, 'ctrl-1'), 'MFA', 'SYSTEM', 'ccls-A').links).toEqual([
        'COUNTERMEASURE_DETECTS MitreAttackTechnique T1078',
        'COUNTERMEASURE_DETECTS MitreAttackTechnique T1190',
        'COUNTERMEASURE_MITIGATES MitreAttackTechnique T1078',
        'COUNTERMEASURE_MITIGATES MitreAttackTechnique T1110',
        'RESPONDS_WITH MitreAttackMitigation M1032',
        'RESPONDS_WITH MitreDefendTechnique D3-MFA',
        'RESPONDS_WITH RegulatoryRequirement REQ-1',
      ]);

      // D3-MFA leaves respondsWith, T1110 leaves mitigates, and T1078 leaves detects while it
      // stays under mitigates: the same target under another type is another link.
      registry.setPolicy('ccls-A', {
        countermeasures: [
          {
            name: 'MFA',
            type: 'CONTROL',
            category: 'identity',
            respondsWith: [mitigation('M1032'), requirement('REQ-1')],
            mitigates: [technique('T1078')],
            detects: [technique('T1190')],
          },
        ],
      });
      const result = await save('ctrl-1', 'ccls-A');

      expect(only(await readFindings(mg.driver, 'ctrl-1'), 'MFA', 'SYSTEM', 'ccls-A').links).toEqual([
        'COUNTERMEASURE_DETECTS MitreAttackTechnique T1190',
        'COUNTERMEASURE_MITIGATES MitreAttackTechnique T1078',
        'RESPONDS_WITH MitreAttackMitigation M1032',
        'RESPONDS_WITH RegulatoryRequirement REQ-1',
      ]);
      expect(result.staleFlippedCount).toBe(0);
    });

    it('countermeasure: a policy that names no reference any more leaves the finding with no links', async () => {
      await seedClass(mg.driver, 'ControlClass', 'ccls-A');
      await seedElement(mg.driver, 'Control', 'ctrl-1', ['ccls-A']);
      registry.setPolicy('ccls-A', {
        countermeasures: [
          { name: 'MFA', type: 'CONTROL', category: 'identity', respondsWith: [mitigation('M1032')], isolates: [technique('T1021')] },
        ],
      });
      await save('ctrl-1', 'ccls-A');

      registry.setPolicy('ccls-A', { countermeasures: [{ name: 'MFA', type: 'CONTROL', category: 'identity' }] });
      await save('ctrl-1', 'ccls-A');

      expect(only(await readFindings(mg.driver, 'ctrl-1'), 'MFA', 'SYSTEM', 'ccls-A').links).toEqual([]);
    });
  });

  describe('what a save never touches', () => {
    it("keeps the links of USER findings, a supersede copy, another class's finding and edges to non-reference nodes", async () => {
      await seedClass(mg.driver, 'ControlClass', 'ccls-A');
      await seedClass(mg.driver, 'ControlClass', 'ccls-B');
      await seedElement(mg.driver, 'Control', 'ctrl-1', ['ccls-A', 'ccls-B']);

      const both = {
        name: 'MFA',
        type: 'CONTROL',
        category: 'identity',
        respondsWith: [mitigation('M1032')],
        mitigates: [technique('T1078'), technique('T1110')],
      };
      registry.setPolicy('ccls-A', { countermeasures: [both] });
      registry.setPolicy('ccls-B', { countermeasures: [both] });
      await save('ctrl-1', 'ccls-A');
      await save('ctrl-1', 'ccls-B');

      // A same-named USER countermeasure bound to class A, with links of every owned type.
      await runWrite(
        mg.driver,
        `MATCH (c {id: 'ctrl-1'}), (k {id: 'ccls-A'}),
               (t1:MitreAttackTechnique {attack_id: 'T1078'}), (t2:MitreAttackTechnique {attack_id: 'T1110'}),
               (m:MitreAttackMitigation {attack_id: 'M1032'})
         CREATE (c)-[:HAS_COUNTERMEASURE]->(u:Countermeasure {id: 'user-cm-1', name: 'MFA', createdBy: 'USER', authoredBy: 'analyst-7'})
                  -[:IS_COUNTERMEASURE_OF]->(k)
         CREATE (u)-[:COUNTERMEASURE_MITIGATES]->(t1), (u)-[:COUNTERMEASURE_MITIGATES]->(t2), (u)-[:RESPONDS_WITH]->(m)`,
      );
      // A supersede copy, as the Supersede flow leaves it: a USER clone with no class edge,
      // carrying the original's links, and the SYSTEM original disposed as SUPERSEDED.
      await runWrite(
        mg.driver,
        `MATCH (c {id: 'ctrl-1'}), (t2:MitreAttackTechnique {attack_id: 'T1110'}), (m:MitreAttackMitigation {attack_id: 'M1032'})
         CREATE (c)-[:HAS_COUNTERMEASURE]->(s:Countermeasure {
           id: 'user-cm-copy', name: 'MFA (custom)', description: "(custom of 'MFA')",
           createdBy: 'USER', authoredBy: 'analyst-7'
         })
         CREATE (s)-[:COUNTERMEASURE_MITIGATES]->(t2), (s)-[:RESPONDS_WITH]->(m)`,
      );
      await runWrite(
        mg.driver,
        `MATCH (:Control {id: 'ctrl-1'})-[:HAS_COUNTERMEASURE]->(f:Countermeasure {name: 'MFA', createdBy: 'SYSTEM'})
                 -[:IS_COUNTERMEASURE_OF]->({id: 'ccls-A'})
         SET f.dispositionKind = 'SUPERSEDED',
             f.dispositionReason = "Superseded by user-authored countermeasure 'MFA (custom)'",
             f.dispositionedBy = 'auth0|prior', f.dispositionedAt = '2026-01-01T00:00:00.000Z',
             f.dispositionStale = false`,
      );
      // Edges from class A's SYSTEM finding to nodes outside the reference labels: one of an
      // owned type, one of another type.
      await runWrite(
        mg.driver,
        `MATCH (:Control {id: 'ctrl-1'})-[:HAS_COUNTERMEASURE]->(f:Countermeasure {name: 'MFA', createdBy: 'SYSTEM'})
                 -[:IS_COUNTERMEASURE_OF]->({id: 'ccls-A'})
         CREATE (f)-[:COUNTERMEASURE_MITIGATES]->(:Note {id: 'note-1'})
         CREATE (f)-[:HAS_ISSUE]->(:Issue {id: 'issue-1', name: 'Follow up'})`,
      );

      // Class A's policy drops T1110 and M1032.
      registry.setPolicy('ccls-A', {
        countermeasures: [{ name: 'MFA', type: 'CONTROL', category: 'identity', mitigates: [technique('T1078')] }],
      });
      await save('ctrl-1', 'ccls-A');

      const rows = await readFindings(mg.driver, 'ctrl-1');
      expect(rows).toHaveLength(4);
      const systemA = only(rows, 'MFA', 'SYSTEM', 'ccls-A');
      expect(systemA.links).toEqual([
        'COUNTERMEASURE_MITIGATES MitreAttackTechnique T1078',
        'COUNTERMEASURE_MITIGATES Note note-1',
        'HAS_ISSUE Issue issue-1',
      ]);
      // The superseded original is still a dispositioned SYSTEM finding whose links changed.
      expect(systemA.dispositionKind).toBe('SUPERSEDED');
      expect(systemA.dispositionStale).toBe(true);
      expect(only(rows, 'MFA', 'SYSTEM', 'ccls-B').links).toEqual([
        'COUNTERMEASURE_MITIGATES MitreAttackTechnique T1078',
        'COUNTERMEASURE_MITIGATES MitreAttackTechnique T1110',
        'RESPONDS_WITH MitreAttackMitigation M1032',
      ]);
      expect(only(rows, 'MFA', 'USER', 'ccls-A').links).toEqual([
        'COUNTERMEASURE_MITIGATES MitreAttackTechnique T1078',
        'COUNTERMEASURE_MITIGATES MitreAttackTechnique T1110',
        'RESPONDS_WITH MitreAttackMitigation M1032',
      ]);
      expect(only(rows, 'MFA (custom)', 'USER', null).links).toEqual([
        'COUNTERMEASURE_MITIGATES MitreAttackTechnique T1110',
        'RESPONDS_WITH MitreAttackMitigation M1032',
      ]);
    });

    it('keeps the EXPLOITED_BY links of a USER exposure and a supersede copy on a component', async () => {
      await seedClass(mg.driver, 'ComponentClass', 'cc-A');
      await seedElement(mg.driver, 'Component', 'cmp-1', ['cc-A']);
      registry.setPolicy('cc-A', { exposures: [{ name: 'Weak auth', exploitedBy: [technique('T1078'), technique('T1110')] }] });
      await save('cmp-1', 'cc-A');

      await runWrite(
        mg.driver,
        `MATCH (c {id: 'cmp-1'}), (t1:MitreAttackTechnique {attack_id: 'T1078'}), (t2:MitreAttackTechnique {attack_id: 'T1110'})
         CREATE (c)-[:HAS_EXPOSURE]->(u:Exposure {id: 'user-exp-1', name: 'Weak auth', createdBy: 'USER', authoredBy: 'analyst-7'})
         CREATE (u)-[:EXPLOITED_BY]->(t1), (u)-[:EXPLOITED_BY]->(t2)
         CREATE (c)-[:HAS_EXPOSURE]->(s:Exposure {
           id: 'user-exp-copy', name: 'Weak auth (custom)', description: "(custom of 'Weak auth')",
           createdBy: 'USER', authoredBy: 'analyst-7'
         })
         CREATE (s)-[:EXPLOITED_BY]->(t2)`,
      );

      registry.setPolicy('cc-A', { exposures: [{ name: 'Weak auth', exploitedBy: [technique('T1078')] }] });
      await save('cmp-1', 'cc-A');

      const rows = await readFindings(mg.driver, 'cmp-1');
      expect(only(rows, 'Weak auth', 'SYSTEM', 'cc-A').links).toEqual(['EXPLOITED_BY MitreAttackTechnique T1078']);
      expect(only(rows, 'Weak auth', 'USER', null).links).toEqual([
        'EXPLOITED_BY MitreAttackTechnique T1078',
        'EXPLOITED_BY MitreAttackTechnique T1110',
      ]);
      expect(only(rows, 'Weak auth (custom)', 'USER', null).links).toEqual(['EXPLOITED_BY MitreAttackTechnique T1110']);
    });
  });

  describe('a link added by hand', () => {
    it("is removed from a SYSTEM exposure by the next save under the same policy", async () => {
      await seedClass(mg.driver, 'ComponentClass', 'cc-A');
      await seedElement(mg.driver, 'Component', 'cmp-1', ['cc-A']);
      registry.setPolicy('cc-A', { exposures: [{ name: 'Weak auth', exploitedBy: [technique('T1078')] }] });
      await save('cmp-1', 'cc-A');

      // As a GraphQL connect on the finding would write them.
      await runWrite(
        mg.driver,
        `MATCH (:Component {id: 'cmp-1'})-[:HAS_EXPOSURE]->(e:Exposure {name: 'Weak auth', createdBy: 'SYSTEM'}),
               (t:MitreAttackTechnique {attack_id: 'T1110'}), (a:MitreAtlasTechnique {atlas_id: 'AML.T0051'})
         CREATE (e)-[:EXPLOITED_BY {justification: 'added by hand'}]->(t), (e)-[:EXPLOITED_BY]->(a)`,
      );
      expect(only(await readFindings(mg.driver, 'cmp-1'), 'Weak auth', 'SYSTEM', 'cc-A').links).toHaveLength(3);

      await save('cmp-1', 'cc-A');

      expect(only(await readFindings(mg.driver, 'cmp-1'), 'Weak auth', 'SYSTEM', 'cc-A').links).toEqual([
        'EXPLOITED_BY MitreAttackTechnique T1078',
      ]);
    });

    it('is removed from a SYSTEM countermeasure, of any owned type, by the next save', async () => {
      await seedClass(mg.driver, 'ControlClass', 'ccls-A');
      await seedElement(mg.driver, 'Control', 'ctrl-1', ['ccls-A']);
      registry.setPolicy('ccls-A', {
        countermeasures: [{ name: 'MFA', type: 'CONTROL', category: 'identity', mitigates: [technique('T1078')] }],
      });
      await save('ctrl-1', 'ccls-A');

      await runWrite(
        mg.driver,
        `MATCH (:Control {id: 'ctrl-1'})-[:HAS_COUNTERMEASURE]->(f:Countermeasure {name: 'MFA', createdBy: 'SYSTEM'}),
               (t:MitreAttackTechnique {attack_id: 'T1021'}), (d:MitreDefendTechnique {d3fendId: 'D3-MFA'}),
               (q:RegulatoryRequirement {id: 'REQ-1'}), (m:MitreAttackMitigation {attack_id: 'M1026'})
         CREATE (f)-[:COUNTERMEASURE_ISOLATES]->(t), (f)-[:COUNTERMEASURE_RESPONDS_TO]->(t),
                (f)-[:RESPONDS_WITH]->(d), (f)-[:RESPONDS_WITH]->(q), (f)-[:RESPONDS_WITH]->(m)`,
      );

      await save('ctrl-1', 'ccls-A');

      expect(only(await readFindings(mg.driver, 'ctrl-1'), 'MFA', 'SYSTEM', 'ccls-A').links).toEqual([
        'COUNTERMEASURE_MITIGATES MitreAttackTechnique T1078',
      ]);
    });

    it('flags a dispositioned SYSTEM finding stale when the next save removes it', async () => {
      await seedClass(mg.driver, 'ComponentClass', 'cc-A');
      await seedElement(mg.driver, 'Component', 'cmp-1', ['cc-A']);
      registry.setPolicy('cc-A', { exposures: [{ name: 'Weak auth', exploitedBy: [technique('T1078')] }] });
      await save('cmp-1', 'cc-A');
      await dispose(mg.driver, 'cmp-1', 'Weak auth', 'AFFIRMED', false);
      await runWrite(
        mg.driver,
        `MATCH (:Component {id: 'cmp-1'})-[:HAS_EXPOSURE]->(e:Exposure {name: 'Weak auth', createdBy: 'SYSTEM'}),
               (t:MitreAttackTechnique {attack_id: 'T1110'})
         CREATE (e)-[:EXPLOITED_BY]->(t)`,
      );

      const result = await save('cmp-1', 'cc-A');

      const row = only(await readFindings(mg.driver, 'cmp-1'), 'Weak auth', 'SYSTEM', 'cc-A');
      expect(row.links).toEqual(['EXPLOITED_BY MitreAttackTechnique T1078']);
      expect(row.dispositionStale).toBe(true);
      expect(result.staleFlippedCount).toBe(1);
    });
  });

  describe('dispositionStale on a link change', () => {
    it('flips a dispositioned, not-yet-stale exposure whose links changed, and nothing else', async () => {
      await seedClass(mg.driver, 'ComponentClass', 'cc-A');
      await seedElement(mg.driver, 'Component', 'cmp-1', ['cc-A']);
      const two = [technique('T1078'), technique('T1110')];
      registry.setPolicy('cc-A', {
        exposures: [
          { name: 'Dropped', exploitedBy: two },
          { name: 'Swapped', exploitedBy: two },
          { name: 'Unchanged', exploitedBy: [technique('T1078')] },
          { name: 'Undispositioned', exploitedBy: two },
          { name: 'Already stale', exploitedBy: two },
        ],
      });
      await save('cmp-1', 'cc-A');
      await dispose(mg.driver, 'cmp-1', 'Dropped', 'NOT_APPLICABLE', false);
      // A disposition written before staleness existed carries no dispositionStale at all.
      await dispose(mg.driver, 'cmp-1', 'Swapped', 'WAIVED', null);
      await dispose(mg.driver, 'cmp-1', 'Unchanged', 'AFFIRMED', false);
      await dispose(mg.driver, 'cmp-1', 'Already stale', 'FALSE_POSITIVE', true);

      registry.setPolicy('cc-A', {
        exposures: [
          { name: 'Dropped', exploitedBy: [technique('T1078')] },
          // Same count, another target.
          { name: 'Swapped', exploitedBy: [technique('T1078'), technique('T1190')] },
          { name: 'Unchanged', exploitedBy: [technique('T1078')] },
          { name: 'Undispositioned', exploitedBy: [technique('T1078')] },
          { name: 'Already stale', exploitedBy: [technique('T1078')] },
        ],
      });
      const result = await save('cmp-1', 'cc-A');

      const rows = await readFindings(mg.driver, 'cmp-1');
      const stale = (name: string) => only(rows, name, 'SYSTEM', 'cc-A').dispositionStale;
      expect(stale('Dropped')).toBe(true);
      expect(stale('Swapped')).toBe(true);
      expect(stale('Unchanged')).toBe(false);
      expect(stale('Undispositioned')).toBeNull();
      expect(only(rows, 'Undispositioned', 'SYSTEM', 'cc-A').dispositionKind).toBeNull();
      expect(stale('Already stale')).toBe(true);
      // Only the two newly flagged count.
      expect(result.staleFlippedCount).toBe(2);
      expect(only(rows, 'Swapped', 'SYSTEM', 'cc-A').links).toEqual([
        'EXPLOITED_BY MitreAttackTechnique T1078',
        'EXPLOITED_BY MitreAttackTechnique T1190',
      ]);
    });

    it('flips a dispositioned countermeasure whose verb links changed, not one whose links did not', async () => {
      await seedClass(mg.driver, 'ControlClass', 'ccls-A');
      await seedElement(mg.driver, 'Control', 'ctrl-1', ['ccls-A']);
      registry.setPolicy('ccls-A', {
        countermeasures: [
          { name: 'MFA', type: 'CONTROL', category: 'identity', mitigates: [technique('T1078')], respondsWith: [mitigation('M1032')] },
          { name: 'Lockout', type: 'CONTROL', category: 'identity', mitigates: [technique('T1110')] },
        ],
      });
      await save('ctrl-1', 'ccls-A');
      await dispose(mg.driver, 'ctrl-1', 'MFA', 'WAIVED', false);
      await dispose(mg.driver, 'ctrl-1', 'Lockout', 'WAIVED', false);

      registry.setPolicy('ccls-A', {
        countermeasures: [
          // The same target, now under another verb.
          { name: 'MFA', type: 'CONTROL', category: 'identity', detects: [technique('T1078')], respondsWith: [mitigation('M1032')] },
          { name: 'Lockout', type: 'CONTROL', category: 'identity', mitigates: [technique('T1110')] },
        ],
      });
      const result = await save('ctrl-1', 'ccls-A');

      const rows = await readFindings(mg.driver, 'ctrl-1');
      expect(only(rows, 'MFA', 'SYSTEM', 'ccls-A').dispositionStale).toBe(true);
      expect(only(rows, 'MFA', 'SYSTEM', 'ccls-A').links).toEqual([
        'COUNTERMEASURE_DETECTS MitreAttackTechnique T1078',
        'RESPONDS_WITH MitreAttackMitigation M1032',
      ]);
      expect(only(rows, 'Lockout', 'SYSTEM', 'ccls-A').dispositionStale).toBe(false);
      expect(result.staleFlippedCount).toBe(1);
    });
  });

  describe('the binding change', () => {
    async function seedControlOnTwoClasses(): Promise<void> {
      await seedClass(mg.driver, 'ControlClass', 'ccls-A');
      await seedClass(mg.driver, 'ControlClass', 'ccls-B');
      await seedClass(mg.driver, 'ControlClass', 'ccls-C');
      await seedElement(mg.driver, 'Control', 'ctrl-1', ['ccls-A', 'ccls-B']);
      registry.setPolicy('ccls-A', {
        countermeasures: [
          { name: 'Keep', type: 'CONTROL', category: 'identity', mitigates: [technique('T1078'), technique('T1110')] },
          { name: 'Gone', type: 'CONTROL', category: 'identity', mitigates: [technique('T1190')] },
        ],
      });
      registry.setPolicy('ccls-B', {
        countermeasures: [{ name: 'B only', type: 'CONTROL', category: 'identity', mitigates: [technique('T1078')] }],
      });
      registry.setPolicy('ccls-C', {
        countermeasures: [{ name: 'C only', type: 'CONTROL', category: 'identity', mitigates: [technique('T1021')] }],
      });
      await save('ctrl-1', 'ccls-A');
      await save('ctrl-1', 'ccls-B');
      await runWrite(
        mg.driver,
        `MATCH (c {id: 'ctrl-1'}), (k {id: 'ccls-A'})
         CREATE (c)-[:HAS_COUNTERMEASURE]->(:Countermeasure {id: 'user-cm-1', name: 'Gone', createdBy: 'USER', authoredBy: 'analyst-7'})
                  -[:IS_COUNTERMEASURE_OF]->(k)`,
      );
      // Class A's policy changes: it drops 'Gone' and the T1110 link of 'Keep'.
      registry.setPolicy('ccls-A', {
        countermeasures: [{ name: 'Keep', type: 'CONTROL', category: 'identity', mitigates: [technique('T1078')] }],
      });
    }

    it("deletes a kept class's finding its policy no longer emits when a Control drops another class", async () => {
      await seedControlOnTwoClasses();

      const result = await binding.changeElementBinding(
        { elementId: 'ctrl-1', target: { kind: 'CLASS', classIds: ['ccls-A'] } },
        { user: { sub: 'test-user' } },
      );
      expect(result.success).toBe(true);
      // 'B only' by the sweep of the removed class, 'Gone' by the kept class's cleanup.
      expect(result.deltas.deletedDerivedCountermeasures).toBe(2);

      const rows = await readFindings(mg.driver, 'ctrl-1');
      expect(rows.map(r => `${r.name}|${r.createdBy}|${r.classId}`)).toEqual(['Gone|USER|ccls-A', 'Keep|SYSTEM|ccls-A']);
      expect(only(rows, 'Keep', 'SYSTEM', 'ccls-A').links).toEqual(['COUNTERMEASURE_MITIGATES MitreAttackTechnique T1078']);
    });

    it("deletes a kept class's finding its policy no longer emits when a Control adds a class", async () => {
      await seedControlOnTwoClasses();

      const result = await binding.changeElementBinding(
        { elementId: 'ctrl-1', target: { kind: 'CLASS', classIds: ['ccls-A', 'ccls-B', 'ccls-C'] } },
        { user: { sub: 'test-user' } },
      );
      expect(result.success).toBe(true);
      expect(result.deltas.deletedDerivedCountermeasures).toBe(1);

      const rows = await readFindings(mg.driver, 'ctrl-1');
      expect(rows.map(r => `${r.name}|${r.createdBy}|${r.classId}`)).toEqual([
        'B only|SYSTEM|ccls-B',
        'C only|SYSTEM|ccls-C',
        'Gone|USER|ccls-A',
        'Keep|SYSTEM|ccls-A',
      ]);
      expect(only(rows, 'Keep', 'SYSTEM', 'ccls-A').links).toEqual(['COUNTERMEASURE_MITIGATES MitreAttackTechnique T1078']);
      expect(only(rows, 'B only', 'SYSTEM', 'ccls-B').links).toEqual(['COUNTERMEASURE_MITIGATES MitreAttackTechnique T1078']);
    });
  });

  describe('concurrent saves of one element', () => {
    it('two saves under the element lock leave exactly the policy link set, with no duplicates', async () => {
      await seedClass(mg.driver, 'ComponentClass', 'cc-A');
      await seedElement(mg.driver, 'Component', 'cmp-1', ['cc-A']);
      registry.setPolicy('cc-A', { exposures: [{ name: 'Weak auth', exploitedBy: [technique('T1078'), technique('T1110')] }] });
      await save('cmp-1', 'cc-A');

      registry.setPolicy('cc-A', {
        exposures: [
          { name: 'Weak auth', exploitedBy: [technique('T1078'), technique('T1190')] },
          { name: 'Open port', exploitedBy: [technique('T1021')] },
        ],
      });
      const exclusiveSave = () =>
        svc.runExclusive('cmp-1', 'setAttributes', () =>
          svc.setAttributes({ componentId: 'cmp-1', classId: 'cc-A', attributes: {} }),
        );
      const results = await Promise.all([exclusiveSave(), exclusiveSave()]);
      expect(results.map(r => r.success)).toEqual([true, true]);

      const rows = await readFindings(mg.driver, 'cmp-1');
      expect(rows.map(r => r.name)).toEqual(['Open port', 'Weak auth']);
      expect(only(rows, 'Weak auth', 'SYSTEM', 'cc-A').links).toEqual([
        'EXPLOITED_BY MitreAttackTechnique T1078',
        'EXPLOITED_BY MitreAttackTechnique T1190',
      ]);
      expect(only(rows, 'Open port', 'SYSTEM', 'cc-A').links).toEqual(['EXPLOITED_BY MitreAttackTechnique T1021']);
    });

    it('two saves through the GraphQL resolver leave exactly the policy link set, with no duplicates', async () => {
      await seedClass(mg.driver, 'ControlClass', 'ccls-A');
      await seedElement(mg.driver, 'Control', 'ctrl-1', ['ccls-A']);
      registry.setPolicy('ccls-A', {
        countermeasures: [
          { name: 'MFA', type: 'CONTROL', category: 'identity', mitigates: [technique('T1078'), technique('T1110')], respondsWith: [mitigation('M1032')] },
        ],
      });
      await save('ctrl-1', 'ccls-A');

      registry.setPolicy('ccls-A', {
        countermeasures: [
          { name: 'MFA', type: 'CONTROL', category: 'identity', mitigates: [technique('T1078')], respondsWith: [mitigation('M1026'), defend('D3-MFA')] },
        ],
      });
      const mutation = svc.getResolvers().Mutation.setInstantiationAttributes;
      const resolverSave = () =>
        mutation(null, { componentId: 'ctrl-1', classId: 'ccls-A', attributes: {} }, { user: { sub: 'test-user' } });
      const results = await Promise.all([resolverSave(), resolverSave()]);
      expect(results.map(r => r.success)).toEqual([true, true]);

      const rows = await readFindings(mg.driver, 'ctrl-1');
      expect(rows).toHaveLength(1);
      expect(only(rows, 'MFA', 'SYSTEM', 'ccls-A').links).toEqual([
        'COUNTERMEASURE_MITIGATES MitreAttackTechnique T1078',
        'RESPONDS_WITH MitreAttackMitigation M1026',
        'RESPONDS_WITH MitreDefendTechnique D3-MFA',
      ]);
    });
  });
});
