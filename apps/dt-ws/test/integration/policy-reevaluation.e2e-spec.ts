// Integration coverage for FindingReevaluationService: after a class policy changes, the
// elements bound to the class are re-saved, so their findings and links follow the new policy.
//
// Strategy: the real FindingReevaluationService, constructed directly against a real Memgraph
// testcontainer with the real SetInstantiationAttributesService, a stub ModuleManagementService
// (only onModulesInstalled) and a fake module registry whose module returns, per class, the
// findings a test sets: switching them is the policy change, writing the class's policyHash is
// what an install of that change does. The last describe drives the real
// ModuleManagementService install instead (mirrors skip-gate.e2e-spec), so the hash comes from
// the module metadata and the sweep from the install notification.
//
// Covers: a sweep after a policy change (findings created and deleted, links reconciled,
// dispositions flagged, elements stamped with the new hash); current stamps left alone; a
// never-stamped element; findings of other sources and other classes untouched; classes with
// no hash, issue and analysis bindings never selected; a save racing a sweep; and the install
// path end to end.

import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import type { DTMetadata, DTModule } from '@dethernety/dt-module';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { SetInstantiationAttributesService } from '../../src/gql/resolver-services/set-instantiation-attributes.service';
import { FindingReevaluationService } from '../../src/gql/resolver-services/finding-reevaluation.service';
import { ModuleManagementService } from '../../src/gql/module-management-services/module-management.service';
import { ClassReconciler } from '../../src/gql/module-management-services/class-reconciler.service';
import { ClassIdentityEventLog } from '../../src/gql/module-management-services/class-identity-event-log.service';
import { engineSource } from './engine-source';

jest.setTimeout(120_000);

const MODULE_NAME = 'mod-1';

// A stamp is "<classId><unit separator><policyHash>".
const UNIT_SEPARATOR = String.fromCharCode(31);
const stamp = (classId: string, policyHash: string) => `${classId}${UNIT_SEPARATOR}${policyHash}`;

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

// Embedding disabled: an install computes no vectors.
const embeddingStub: any = {
  isEnabled: () => false,
  isPending: () => false,
  whenStartupChecked: async () => undefined,
  onReady: () => () => undefined,
  getModel: () => '',
  getDimensions: () => 0,
  composeClassText: () => '',
  embedBatch: async () => null,
};

type ClassPolicy = { exposures?: any[]; countermeasures?: any[] };

// The module evaluates each class to whatever the test set last, and records each evaluation.
class FakeModuleRegistry {
  private byClass = new Map<string, ClassPolicy>();
  readonly modules = new Set<string>([MODULE_NAME]);
  calls: Array<{ elementId: string; classId: string }> = [];

  setPolicy(classId: string, policy: ClassPolicy): void {
    this.byClass.set(classId, policy);
  }

  reset(): void {
    this.byClass.clear();
    this.calls = [];
  }

  callsFor(elementId: string): string[] {
    return this.calls.filter(c => c.elementId === elementId).map(c => c.classId);
  }

  getModuleByName(name: string): any | undefined {
    if (!this.modules.has(name)) return undefined;
    return {
      getExposures: async (elementId: string, classId: string) => {
        this.calls.push({ elementId, classId });
        return this.byClass.get(classId)?.exposures ?? [];
      },
      getCountermeasures: async (elementId: string, classId: string) => {
        this.calls.push({ elementId, classId });
        return this.byClass.get(classId)?.countermeasures ?? [];
      },
    };
  }
}

const technique = (attackId: string) => ({ label: 'MitreAttackTechnique', property: 'attack_id', value: attackId });
const mitigation = (attackId: string) => ({ label: 'MitreAttackMitigation', property: 'attack_id', value: attackId });
const countermeasure = (name: string, refs: Record<string, any[]>) => ({ name, type: 'CONTROL', category: 'identity', ...refs });

async function runWrite(driver: any, cypher: string, params: any = {}): Promise<any> {
  const session = driver.session();
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

async function seedModule(driver: any, name = MODULE_NAME): Promise<void> {
  await runWrite(driver, `CREATE (:Module {id: $id, name: $name})`, { id: `${name}-id`, name });
}

async function seedClass(driver: any, label: string, classId: string, policyHash: string | null): Promise<void> {
  await runWrite(
    driver,
    `MATCH (m:Module {name: $name})
     CREATE (m)-[:HAS_CLASS]->(k:${label} {id: $classId, name: $classId})
     SET k.policyHash = $policyHash`,
    { name: MODULE_NAME, classId, policyHash },
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

async function seedReferences(driver: any): Promise<void> {
  await runWrite(
    driver,
    `UNWIND ['T1078', 'T1110', 'T1190', 'T1021'] AS id
     CREATE (:MitreAttackTechnique {attack_id: id, id: 'tech-' + id, name: id})`,
  );
  await runWrite(
    driver,
    `UNWIND ['M1032', 'M1026'] AS id CREATE (:MitreAttackMitigation {attack_id: id, id: 'mit-' + id, name: id})`,
  );
}

// What an install of a changed policy writes on the class node.
async function setPolicyHash(driver: any, classId: string, policyHash: string | null): Promise<void> {
  await runWrite(driver, `MATCH (k {id: $classId}) SET k.policyHash = $policyHash`, { classId, policyHash });
}

async function readStamps(driver: any, elementId: string): Promise<string[] | null> {
  const r = await runWrite(driver, `MATCH (c {id: $elementId}) RETURN c.classPolicyStamps AS stamps`, { elementId });
  const stamps = r.records[0]?.get('stamps');
  return stamps == null ? null : [...(stamps as string[])].sort();
}

interface FindingRow {
  name: string;
  createdBy: string | null;
  classId: string | null;
  dispositionKind: string | null;
  dispositionStale: boolean | null;
  links: string[];
}

// Every finding of the element, with each outgoing edge other than its class edge as
// "<TYPE> <target key>", sorted.
async function readFindings(driver: any, elementId: string): Promise<FindingRow[]> {
  const r = await runWrite(
    driver,
    `MATCH (c {id: $elementId})-[:HAS_EXPOSURE|HAS_COUNTERMEASURE]->(f)
     OPTIONAL MATCH (f)-[:IS_EXPOSURE_OF|IS_COUNTERMEASURE_OF]->(k)
     WITH f, k
     OPTIONAL MATCH (f)-[r]->(t)
     WHERE NOT type(r) IN ['IS_EXPOSURE_OF', 'IS_COUNTERMEASURE_OF']
     WITH f, k, CASE WHEN r IS NULL THEN null ELSE type(r) + ' ' + coalesce(t.attack_id, t.id) END AS link
     RETURN f.name AS name, f.createdBy AS createdBy, k.id AS classId,
            f.dispositionKind AS dispositionKind, f.dispositionStale AS dispositionStale,
            collect(link) AS links`,
    { elementId },
  );
  return r.records
    .map((rec: any) => ({
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

const summary = (rows: FindingRow[]) => rows.map(r => `${r.name}|${r.createdBy}|${r.classId}`);

async function dispose(driver: any, elementId: string, name: string, kind: string): Promise<void> {
  await runWrite(
    driver,
    `MATCH (c {id: $elementId})-[:HAS_EXPOSURE|HAS_COUNTERMEASURE]->(f {name: $name, createdBy: 'SYSTEM'})
     SET f.dispositionKind = $kind, f.dispositionReason = 'Reviewed', f.dispositionedBy = 'auth0|prior',
         f.dispositionedAt = '2026-01-01T00:00:00.000Z', f.dispositionStale = false`,
    { elementId, name, kind },
  );
}

describe('FindingReevaluationService — re-evaluation after a class policy change (e2e)', () => {
  let mg: MemgraphHandle;
  let registry: FakeModuleRegistry;
  let svc: SetInstantiationAttributesService;
  let reeval: FindingReevaluationService;
  let warn: jest.SpyInstance;

  beforeAll(async () => {
    mg = await startMemgraph();
    registry = new FakeModuleRegistry();
    // onModuleInit is not run, so no cleanup interval outlives the suite.
    svc = new SetInstantiationAttributesService(
      mg.driver,
      makeStubConfigService(),
      registry as any,
      makeStubAuthService(),
      makeStubMonitoringService(),
    );
  }, 90_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
    registry.reset();
    await seedReferences(mg.driver);
    reeval = new FindingReevaluationService(
      mg.driver,
      makeStubConfigService(),
      { onModulesInstalled: jest.fn() } as any,
      svc,
    );
    jest.spyOn((reeval as any).logger, 'log').mockImplementation(() => {});
    // A sweep in which an element failed reports at warn.
    warn = jest.spyOn((reeval as any).logger, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    await reeval.onModuleDestroy();
    jest.restoreAllMocks();
  });

  const save = async (elementId: string, classId: string) => {
    const result = await svc.setAttributes({ componentId: elementId, classId, attributes: {} });
    expect(result.success).toBe(true);
  };

  it('re-evaluates the elements of a class whose policy changed and stamps them with the new hash', async () => {
    await seedModule(mg.driver);
    await seedClass(mg.driver, 'ComponentClass', 'cc-web', 'h1');
    await seedClass(mg.driver, 'ControlClass', 'ccls-mfa', 'h1');
    await seedElement(mg.driver, 'Component', 'cmp-1', ['cc-web']);
    await seedElement(mg.driver, 'Component', 'cmp-2', ['cc-web']);
    await seedElement(mg.driver, 'Control', 'ctrl-1', ['ccls-mfa']);

    // Saved under the old policy.
    registry.setPolicy('cc-web', {
      exposures: [
        { name: 'Weak auth', exploitedBy: [technique('T1078'), technique('T1110')] },
        { name: 'Dropped', exploitedBy: [technique('T1190')] },
        { name: 'Reviewed', exploitedBy: [technique('T1078'), technique('T1110')] },
      ],
    });
    registry.setPolicy('ccls-mfa', {
      countermeasures: [
        countermeasure('MFA', { mitigates: [technique('T1078'), technique('T1110')], respondsWith: [mitigation('M1032')] }),
        countermeasure('Retired', { mitigates: [technique('T1021')] }),
      ],
    });
    for (const elementId of ['cmp-1', 'cmp-2']) await save(elementId, 'cc-web');
    await save('ctrl-1', 'ccls-mfa');
    expect(await readStamps(mg.driver, 'cmp-1')).toEqual([stamp('cc-web', 'h1')]);
    expect(await readStamps(mg.driver, 'ctrl-1')).toEqual([stamp('ccls-mfa', 'h1')]);
    await dispose(mg.driver, 'cmp-1', 'Reviewed', 'AFFIRMED');
    await dispose(mg.driver, 'ctrl-1', 'MFA', 'WAIVED');

    // The module now carries the new policy, and the install wrote its hash.
    registry.setPolicy('cc-web', {
      exposures: [
        { name: 'Weak auth', exploitedBy: [technique('T1078')] },
        { name: 'Reviewed', exploitedBy: [technique('T1078'), technique('T1190')] },
        { name: 'New', exploitedBy: [technique('T1021')] },
      ],
    });
    registry.setPolicy('ccls-mfa', {
      countermeasures: [
        countermeasure('MFA', { mitigates: [technique('T1078')], respondsWith: [mitigation('M1032')] }),
        countermeasure('Added', { detects: [technique('T1190')] }),
      ],
    });
    await setPolicyHash(mg.driver, 'cc-web', 'h2');
    await setPolicyHash(mg.driver, 'ccls-mfa', 'h2');
    registry.calls = [];

    await reeval.request();

    for (const elementId of ['cmp-1', 'cmp-2']) {
      const rows = await readFindings(mg.driver, elementId);
      expect(summary(rows)).toEqual(['New|SYSTEM|cc-web', 'Reviewed|SYSTEM|cc-web', 'Weak auth|SYSTEM|cc-web']);
      expect(only(rows, 'Weak auth', 'SYSTEM', 'cc-web').links).toEqual(['EXPLOITED_BY T1078']);
      expect(only(rows, 'Reviewed', 'SYSTEM', 'cc-web').links).toEqual(['EXPLOITED_BY T1078', 'EXPLOITED_BY T1190']);
      expect(only(rows, 'New', 'SYSTEM', 'cc-web').links).toEqual(['EXPLOITED_BY T1021']);
      expect(await readStamps(mg.driver, elementId)).toEqual([stamp('cc-web', 'h2')]);
      expect(registry.callsFor(elementId)).toEqual(['cc-web']);
    }
    // The dispositioned finding whose links changed is flagged; the undispositioned twin is not.
    expect(only(await readFindings(mg.driver, 'cmp-1'), 'Reviewed', 'SYSTEM', 'cc-web').dispositionStale).toBe(true);
    expect(only(await readFindings(mg.driver, 'cmp-2'), 'Reviewed', 'SYSTEM', 'cc-web').dispositionStale).toBeNull();

    const control = await readFindings(mg.driver, 'ctrl-1');
    expect(summary(control)).toEqual(['Added|SYSTEM|ccls-mfa', 'MFA|SYSTEM|ccls-mfa']);
    expect(only(control, 'MFA', 'SYSTEM', 'ccls-mfa').links).toEqual(['COUNTERMEASURE_MITIGATES T1078', 'RESPONDS_WITH M1032']);
    expect(only(control, 'MFA', 'SYSTEM', 'ccls-mfa').dispositionStale).toBe(true);
    expect(only(control, 'Added', 'SYSTEM', 'ccls-mfa').links).toEqual(['COUNTERMEASURE_DETECTS T1190']);
    expect(await readStamps(mg.driver, 'ctrl-1')).toEqual([stamp('ccls-mfa', 'h2')]);
    expect(warn).not.toHaveBeenCalled();

    // Every stamp is current now: the next sweep evaluates nothing.
    registry.calls = [];
    await reeval.request();
    expect(registry.calls).toEqual([]);
  });

  it('leaves an element whose stamp is already the current hash alone', async () => {
    await seedModule(mg.driver);
    await seedClass(mg.driver, 'ComponentClass', 'cc-web', 'h1');
    await seedElement(mg.driver, 'Component', 'cmp-current', ['cc-web']);
    await seedElement(mg.driver, 'Component', 'cmp-old', ['cc-web']);
    registry.setPolicy('cc-web', { exposures: [{ name: 'Old', exploitedBy: [technique('T1078')] }] });
    await save('cmp-current', 'cc-web');
    await save('cmp-old', 'cc-web');

    // The policy changes, and one element is saved under it before any sweep.
    await setPolicyHash(mg.driver, 'cc-web', 'h2');
    registry.setPolicy('cc-web', { exposures: [{ name: 'Current', exploitedBy: [technique('T1110')] }] });
    await save('cmp-current', 'cc-web');
    const before = await readFindings(mg.driver, 'cmp-current');
    expect(summary(before)).toEqual(['Current|SYSTEM|cc-web']);

    // Had the sweep re-saved the current element, it would show this policy's finding.
    registry.setPolicy('cc-web', { exposures: [{ name: 'Sentinel', exploitedBy: [technique('T1190')] }] });
    registry.calls = [];

    await reeval.request();

    expect(registry.callsFor('cmp-current')).toEqual([]);
    expect(await readFindings(mg.driver, 'cmp-current')).toEqual(before);
    expect(await readStamps(mg.driver, 'cmp-current')).toEqual([stamp('cc-web', 'h2')]);
    expect(registry.callsFor('cmp-old')).toEqual(['cc-web']);
    expect(summary(await readFindings(mg.driver, 'cmp-old'))).toEqual(['Sentinel|SYSTEM|cc-web']);
    expect(await readStamps(mg.driver, 'cmp-old')).toEqual([stamp('cc-web', 'h2')]);
  });

  it('re-evaluates an element never stamped, legacy findings included', async () => {
    await seedModule(mg.driver);
    await seedClass(mg.driver, 'ComponentClass', 'cc-web', 'h1');
    await seedElement(mg.driver, 'Component', 'cmp-1', ['cc-web']);
    // Findings written before provenance existed: no createdBy, no stamp on the element.
    await runWrite(
      mg.driver,
      `MATCH (c {id: 'cmp-1'}), (k {id: 'cc-web'}), (t:MitreAttackTechnique {attack_id: 'T1110'})
       CREATE (c)-[:HAS_EXPOSURE]->(e:Exposure {id: 'legacy-1', name: 'Legacy'})-[:IS_EXPOSURE_OF]->(k)
       CREATE (e)-[:EXPLOITED_BY]->(t)
       CREATE (c)-[:HAS_EXPOSURE]->(:Exposure {id: 'legacy-2', name: 'Long gone'})-[:IS_EXPOSURE_OF]->(k)`,
    );
    expect(await readStamps(mg.driver, 'cmp-1')).toBeNull();
    registry.setPolicy('cc-web', {
      exposures: [
        { name: 'Legacy', exploitedBy: [technique('T1078')] },
        { name: 'Weak auth', exploitedBy: [technique('T1078')] },
      ],
    });

    await reeval.request();

    const rows = await readFindings(mg.driver, 'cmp-1');
    expect(summary(rows)).toEqual(['Legacy|SYSTEM|cc-web', 'Weak auth|SYSTEM|cc-web']);
    expect(only(rows, 'Legacy', 'SYSTEM', 'cc-web').links).toEqual(['EXPLOITED_BY T1078']);
    expect(await readStamps(mg.driver, 'cmp-1')).toEqual([stamp('cc-web', 'h1')]);
  });

  it("keeps USER findings, a supersede copy, an issue-linked finding and another class's findings", async () => {
    await seedModule(mg.driver);
    await seedClass(mg.driver, 'ControlClass', 'ccls-A', 'h1');
    await seedClass(mg.driver, 'ControlClass', 'ccls-B', 'h1');
    await seedClass(mg.driver, 'IssueClass', 'ic-1', null);
    await seedElement(mg.driver, 'Control', 'ctrl-1', ['ccls-A', 'ccls-B']);
    const mfa = countermeasure('MFA', { mitigates: [technique('T1078'), technique('T1110')], respondsWith: [mitigation('M1032')] });
    registry.setPolicy('ccls-A', { countermeasures: [mfa, countermeasure('Retired', { mitigates: [technique('T1021')] })] });
    registry.setPolicy('ccls-B', { countermeasures: [mfa] });
    await save('ctrl-1', 'ccls-A');
    await save('ctrl-1', 'ccls-B');

    // A hand-authored countermeasure, and one a user created to track an issue.
    await runWrite(
      mg.driver,
      `MATCH (c {id: 'ctrl-1'}), (t:MitreAttackTechnique {attack_id: 'T1110'}), (m:MitreAttackMitigation {attack_id: 'M1026'}),
             (ic {id: 'ic-1'})
       CREATE (c)-[:HAS_COUNTERMEASURE]->(u:Countermeasure {id: 'user-cm', name: 'Retired', createdBy: 'USER', authoredBy: 'analyst-7'})
       CREATE (u)-[:COUNTERMEASURE_MITIGATES]->(t), (u)-[:RESPONDS_WITH]->(m)
       CREATE (c)-[:HAS_COUNTERMEASURE]->(i:Countermeasure {id: 'issue-cm', name: 'Patch window', createdBy: 'USER', authoredBy: 'analyst-7'})
       CREATE (i)-[:COUNTERMEASURE_MITIGATES]->(t)
       CREATE (i)-[:HAS_ISSUE]->(issue:Issue {id: 'issue-1', name: 'Track patching'})-[:IS_INSTANCE_OF]->(ic)`,
    );
    // A supersede copy of class A's MFA, and the original disposed as SUPERSEDED.
    await runWrite(
      mg.driver,
      `MATCH (c {id: 'ctrl-1'}), (t:MitreAttackTechnique {attack_id: 'T1110'})
       CREATE (c)-[:HAS_COUNTERMEASURE]->(s:Countermeasure {
         id: 'user-cm-copy', name: 'MFA (custom)', description: "(custom of 'MFA')", createdBy: 'USER', authoredBy: 'analyst-7'
       })
       CREATE (s)-[:COUNTERMEASURE_MITIGATES]->(t)`,
    );
    await runWrite(
      mg.driver,
      `MATCH (:Control {id: 'ctrl-1'})-[:HAS_COUNTERMEASURE]->(f:Countermeasure {name: 'MFA', createdBy: 'SYSTEM'})
               -[:IS_COUNTERMEASURE_OF]->({id: 'ccls-A'})
       SET f.dispositionKind = 'SUPERSEDED', f.dispositionReason = "Superseded by user-authored countermeasure 'MFA (custom)'",
           f.dispositionedBy = 'auth0|prior', f.dispositionedAt = '2026-01-01T00:00:00.000Z', f.dispositionStale = false`,
    );

    // Only class A's policy changes: MFA loses T1110, Retired goes.
    registry.setPolicy('ccls-A', {
      countermeasures: [countermeasure('MFA', { mitigates: [technique('T1078')], respondsWith: [mitigation('M1032')] })],
    });
    await setPolicyHash(mg.driver, 'ccls-A', 'h2');
    registry.calls = [];

    await reeval.request();

    expect(registry.callsFor('ctrl-1')).toEqual(['ccls-A']);
    const rows = await readFindings(mg.driver, 'ctrl-1');
    // Class A's Retired is gone; the USER one of the same name stays.
    expect(summary(rows)).toEqual([
      'MFA (custom)|USER|null',
      'MFA|SYSTEM|ccls-A',
      'MFA|SYSTEM|ccls-B',
      'Patch window|USER|null',
      'Retired|USER|null',
    ]);
    expect(only(rows, 'MFA', 'SYSTEM', 'ccls-A').links).toEqual(['COUNTERMEASURE_MITIGATES T1078', 'RESPONDS_WITH M1032']);
    expect(only(rows, 'MFA', 'SYSTEM', 'ccls-A').dispositionStale).toBe(true);
    expect(only(rows, 'MFA', 'SYSTEM', 'ccls-B').links).toEqual([
      'COUNTERMEASURE_MITIGATES T1078',
      'COUNTERMEASURE_MITIGATES T1110',
      'RESPONDS_WITH M1032',
    ]);
    expect(only(rows, 'Retired', 'USER', null).links).toEqual(['COUNTERMEASURE_MITIGATES T1110', 'RESPONDS_WITH M1026']);
    expect(only(rows, 'MFA (custom)', 'USER', null).links).toEqual(['COUNTERMEASURE_MITIGATES T1110']);
    expect(only(rows, 'Patch window', 'USER', null).links).toEqual(['COUNTERMEASURE_MITIGATES T1110', 'HAS_ISSUE issue-1']);
    // Class B's stamp is untouched; class A's moves to the new hash.
    expect(await readStamps(mg.driver, 'ctrl-1')).toEqual([stamp('ccls-A', 'h2'), stamp('ccls-B', 'h1')].sort());
  });

  it('skips the bindings of a class with no policy hash', async () => {
    await seedModule(mg.driver);
    await seedClass(mg.driver, 'ComponentClass', 'cc-unhashed', null);
    await seedElement(mg.driver, 'Component', 'cmp-1', ['cc-unhashed']);
    await runWrite(
      mg.driver,
      `MATCH (c {id: 'cmp-1'}), (k {id: 'cc-unhashed'}), (t:MitreAttackTechnique {attack_id: 'T1110'})
       CREATE (c)-[:HAS_EXPOSURE]->(e:Exposure {id: 'exp-1', name: 'Kept', createdBy: 'SYSTEM'})-[:IS_EXPOSURE_OF]->(k)
       CREATE (e)-[:EXPLOITED_BY]->(t)`,
    );
    const before = await readFindings(mg.driver, 'cmp-1');
    registry.setPolicy('cc-unhashed', { exposures: [{ name: 'Other', exploitedBy: [technique('T1078')] }] });
    const setAttributes = jest.spyOn(svc, 'setAttributes');

    await reeval.request();

    expect(setAttributes).not.toHaveBeenCalled();
    expect(registry.calls).toEqual([]);
    expect(await readFindings(mg.driver, 'cmp-1')).toEqual(before);
    expect(await readStamps(mg.driver, 'cmp-1')).toBeNull();
  });

  it('never selects an issue or analysis binding, even when its class carries a hash', async () => {
    await seedModule(mg.driver);
    await seedClass(mg.driver, 'IssueClass', 'ic-1', 'h1');
    await seedClass(mg.driver, 'AnalysisClass', 'ac-1', 'h1');
    await seedClass(mg.driver, 'ComponentClass', 'cc-web', 'h1');
    await seedElement(mg.driver, 'Issue', 'issue-1', ['ic-1']);
    await seedElement(mg.driver, 'Analysis', 'analysis-1', ['ac-1']);
    await seedElement(mg.driver, 'Component', 'cmp-1', ['cc-web']);
    registry.setPolicy('cc-web', { exposures: [{ name: 'Weak auth', exploitedBy: [technique('T1078')] }] });
    const setAttributes = jest.spyOn(svc, 'setAttributes');

    await reeval.request();

    expect(setAttributes.mock.calls.map(([request]) => `${request.componentId}|${request.classId}`)).toEqual(['cmp-1|cc-web']);
    expect(await readStamps(mg.driver, 'issue-1')).toBeNull();
    expect(await readStamps(mg.driver, 'analysis-1')).toBeNull();
    expect(await readStamps(mg.driver, 'cmp-1')).toEqual([stamp('cc-web', 'h1')]);
  });

  it('a save racing the sweep leaves exactly the new policy, once', async () => {
    await seedModule(mg.driver);
    await seedClass(mg.driver, 'ComponentClass', 'cc-web', 'h1');
    await seedElement(mg.driver, 'Component', 'cmp-1', ['cc-web']);
    registry.setPolicy('cc-web', { exposures: [{ name: 'Weak auth', exploitedBy: [technique('T1078'), technique('T1110')] }] });
    await save('cmp-1', 'cc-web');

    registry.setPolicy('cc-web', { exposures: [{ name: 'Weak auth', exploitedBy: [technique('T1078'), technique('T1190')] }] });
    await setPolicyHash(mg.driver, 'cc-web', 'h2');

    // As the resolver saves: under the element lock the sweep takes too.
    await Promise.all([
      reeval.request(),
      svc.runExclusive('cmp-1', 'setAttributes', () =>
        svc.setAttributes({ componentId: 'cmp-1', classId: 'cc-web', attributes: {} }),
      ),
    ]);

    const rows = await readFindings(mg.driver, 'cmp-1');
    expect(summary(rows)).toEqual(['Weak auth|SYSTEM|cc-web']);
    expect(rows[0].links).toEqual(['EXPLOITED_BY T1078', 'EXPLOITED_BY T1190']);
    expect(await readStamps(mg.driver, 'cmp-1')).toEqual([stamp('cc-web', 'h2')]);
    expect(warn).not.toHaveBeenCalled();
  });

  describe('through a module install', () => {
    const INSTALLED = 'mod-installed';
    let modules: ModuleManagementService;

    // A module whose metadata reports each class's policy hash, as the file module does.
    const installable = (contentHash: string, webHash: string): DTModule =>
      ({
        getMetadata: async (): Promise<DTMetadata> =>
          ({
            name: INSTALLED,
            version: '1.0.0',
            description: '',
            contentHash,
            componentClasses: [{ id: 'cc-web', name: 'Web server', policyHash: webHash }],
            controlClasses: [{ id: 'ccls-mfa', name: 'MFA control', policyHash: 'hc1' }],
            issueClasses: [{ id: 'ic-1', name: 'Tracked issue' }],
          }) as unknown as DTMetadata,
      }) as unknown as DTModule;

    const install = (contentHash: string, webHash: string) =>
      modules.updateAllModules(new Map([[INSTALLED, installable(contentHash, webHash)]]));

    beforeEach(() => {
      registry.modules.add(INSTALLED);
      const log = new ClassIdentityEventLog();
      jest.spyOn((log as any).logger, 'warn').mockImplementation(() => {});
      const reconciler = new ClassReconciler(mg.driver, log, engineSource(mg.driver));
      reconciler.setMageAvailableForTesting(null);
      modules = new ModuleManagementService(mg.driver, makeStubConfigService(), embeddingStub, reconciler, log);
      jest.spyOn((modules as any).logger, 'log').mockImplementation(() => {});
      jest.spyOn((modules as any).logger, 'debug').mockImplementation(() => {});
      reeval = new FindingReevaluationService(mg.driver, makeStubConfigService(), modules, svc);
      jest.spyOn((reeval as any).logger, 'log').mockImplementation(() => {});
      warn = jest.spyOn((reeval as any).logger, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      registry.modules.delete(INSTALLED);
    });

    it('writes each class policy hash, sweeps after an install that changed one, and stamps the elements', async () => {
      await install('sha256:v1', 'hw1');
      const hashes = await runWrite(
        mg.driver,
        `MATCH (:Module {name: $name})-[:HAS_CLASS]->(k) RETURN k.id AS id, k.policyHash AS policyHash ORDER BY id`,
        { name: INSTALLED },
      );
      expect(hashes.records.map((r: any) => [r.get('id'), r.get('policyHash') ?? null])).toEqual([
        ['cc-web', 'hw1'],
        ['ccls-mfa', 'hc1'],
        ['ic-1', null],
      ]);

      await seedElement(mg.driver, 'Component', 'cmp-1', ['cc-web']);
      await seedElement(mg.driver, 'Control', 'ctrl-1', ['ccls-mfa']);
      registry.setPolicy('cc-web', { exposures: [{ name: 'Weak auth', exploitedBy: [technique('T1078'), technique('T1110')] }] });
      registry.setPolicy('ccls-mfa', { countermeasures: [countermeasure('MFA', { mitigates: [technique('T1078')] })] });

      // At start: listen for installs, and sweep the never-stamped elements.
      reeval.onApplicationBootstrap();
      await reeval.request();
      expect(await readStamps(mg.driver, 'cmp-1')).toEqual([stamp('cc-web', 'hw1')]);
      expect(await readStamps(mg.driver, 'ctrl-1')).toEqual([stamp('ccls-mfa', 'hc1')]);
      expect(only(await readFindings(mg.driver, 'cmp-1'), 'Weak auth', 'SYSTEM', 'cc-web').links).toEqual([
        'EXPLOITED_BY T1078',
        'EXPLOITED_BY T1110',
      ]);

      // An install that changes the web class's policy: the install notification sweeps.
      registry.setPolicy('cc-web', { exposures: [{ name: 'Weak auth', exploitedBy: [technique('T1078')] }] });
      registry.calls = [];
      await install('sha256:v2', 'hw2');
      await reeval.request();
      expect(registry.callsFor('cmp-1')).toEqual(['cc-web']);
      expect(registry.callsFor('ctrl-1')).toEqual([]);
      expect(only(await readFindings(mg.driver, 'cmp-1'), 'Weak auth', 'SYSTEM', 'cc-web').links).toEqual([
        'EXPLOITED_BY T1078',
      ]);
      expect(await readStamps(mg.driver, 'cmp-1')).toEqual([stamp('cc-web', 'hw2')]);
      expect(await readStamps(mg.driver, 'ctrl-1')).toEqual([stamp('ccls-mfa', 'hc1')]);

      // A reinstall that changes other content but no policy leaves every stamp current.
      registry.calls = [];
      await install('sha256:v3', 'hw2');
      await reeval.request();
      expect(registry.calls).toEqual([]);
      expect(await readStamps(mg.driver, 'cmp-1')).toEqual([stamp('cc-web', 'hw2')]);
      expect(warn).not.toHaveBeenCalled();
    });

    it('keeps the stamps on the element node only, never in the GraphQL schema', async () => {
      await install('sha256:v1', 'hw1');
      await seedElement(mg.driver, 'Component', 'cmp-1', ['cc-web']);
      registry.setPolicy('cc-web', { exposures: [] });

      await reeval.request();

      expect(await readStamps(mg.driver, 'cmp-1')).toEqual([stamp('cc-web', 'hw1')]);
      const schema = fs.readFileSync(path.join(__dirname, '..', '..', 'schema', 'schema.graphql'), 'utf8');
      expect(schema).not.toContain('classPolicyStamps');
    });
  });
});
