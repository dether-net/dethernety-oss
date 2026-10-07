// Integration coverage for references the instantiation writer cannot link.
//
// A class may declare a reference whose node is not in the loaded MITRE data, or
// one that is not an allowed target for its field. The save must still succeed:
// the attributes are written, every resolvable reference is linked (with its
// justification), and the misses are recorded on the finding as
// `unresolvedReferences` and returned. An unresolved RegulatoryRequirement is
// tolerated and not recorded. A re-save once the data catches up clears the marker.
//
// Drives the real services against a Memgraph testcontainer: setAttributes for a
// Component and a Control, changeElementBinding for a Component, and the
// production GraphQL schema for the read-only field.

import { ConfigService } from '@nestjs/config';
import { graphql, GraphQLInputObjectType, GraphQLObjectType, GraphQLSchema } from 'graphql';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { buildProductionSchema, MEMGRAPH_CONTEXT } from './production-schema';
import { SetInstantiationAttributesService } from '../../src/gql/resolver-services/set-instantiation-attributes.service';
import { ElementBindingService } from '../../src/gql/resolver-services/element-binding.service';

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

// Module `mod-1` serves whatever findings the test sets for a class id.
class FakeModuleRegistry {
  exposures = new Map<string, any[]>();
  countermeasures = new Map<string, any[]>();

  getModuleByName(name: string): any | undefined {
    if (name !== 'mod-1') return undefined;
    return {
      getExposures: async (_elementId: string, classId: string) => this.exposures.get(classId) ?? [],
      getCountermeasures: async (_elementId: string, classId: string) => this.countermeasures.get(classId) ?? [],
    };
  }
}

const ref = (label: string, property: string, value: string, justification?: string) => ({
  label,
  property,
  value,
  ...(justification ? { attributes: { justification } } : {}),
});

describe('Instantiation writer — unresolved references (e2e)', () => {
  let mg: MemgraphHandle;
  let registry: FakeModuleRegistry;
  let svc: SetInstantiationAttributesService;
  let binding: ElementBindingService;

  beforeAll(async () => {
    mg = await startMemgraph();
    registry = new FakeModuleRegistry();
    const config = makeStubConfigService();
    const auth = makeStubAuthService();
    svc = new SetInstantiationAttributesService(
      mg.driver as any,
      config,
      registry as any,
      auth,
      { recordOperation: () => {} } as any,
    );
    binding = new ElementBindingService(mg.driver as any, config, registry as any, auth, svc);
  }, 90_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
    registry.exposures.clear();
    registry.countermeasures.clear();
    await run(`
      CREATE (m:Module {id: 'mod-1-id', name: 'mod-1'})
      CREATE (m)-[:HAS_CLASS]->(:ComponentClass {id: 'cls-1', name: 'cls-1'})
      CREATE (m)-[:HAS_CLASS]->(:ControlClass {id: 'ccls-1', name: 'ccls-1'})
      CREATE (:MitreAttackTechnique {id: 'tech-T1078', attack_id: 'T1078', name: 'Valid Accounts'})
      CREATE (:MitreAttackTechnique {id: 'tech-T1021', attack_id: 'T1021', name: 'Remote Services'})
      CREATE (:MitreAtlasTechnique {id: 'atlas-T0051', atlas_id: 'AML.T0051', name: 'LLM Prompt Injection'})
      CREATE (:MitreAttackMitigation {id: 'mit-M1037', attack_id: 'M1037', name: 'Filter Network Traffic'})
      CREATE (:RegulatoryRequirement {id: 'iso:A.8.20', name: 'Networks security'})
    `);
  });

  async function run(cypher: string, params: Record<string, unknown> = {}): Promise<any[]> {
    const session = mg.driver.session();
    try {
      return (await session.run(cypher, params)).records.map((r: any) => r.toObject());
    } finally {
      await session.close();
    }
  }

  const findingOf = async (elementId: string, rel: 'HAS_EXPOSURE' | 'HAS_COUNTERMEASURE') => {
    const [row] = await run(
      `MATCH ({id: $elementId})-[:${rel}]->(f) RETURN f.unresolvedReferences AS marker, keys(f) AS keys`,
      { elementId },
    );
    return row;
  };

  const edgesOf = async (elementId: string, rel: 'HAS_EXPOSURE' | 'HAS_COUNTERMEASURE') =>
    (
      await run(
        `MATCH ({id: $elementId})-[:${rel}]->(f)-[r]->(t)
         WHERE NOT type(r) IN ['IS_EXPOSURE_OF', 'IS_COUNTERMEASURE_OF']
         RETURN type(r) AS type, coalesce(t.attack_id, t.atlas_id, t.id) AS target, r.justification AS justification
         ORDER BY type, target`,
        { elementId },
      )
    ).map(e => [e.type, e.target, e.justification]);

  const exposureRefs = (withOutOfSet = true) => [
    ref('MitreAttackTechnique', 'attack_id', 'T1078', 'valid accounts'),
    ref('MitreAtlasTechnique', 'atlas_id', 'AML.T0051', 'prompt injection'),
    'T9999',
    ...(withOutOfSet ? [ref('MitreAttackTechnique', 'attack_iexposured', 'T1078')] : []),
  ];

  it('setAttributes on a Component: saves, links what resolves, records and returns the rest', async () => {
    await run(`MATCH (k:ComponentClass {id: 'cls-1'}) CREATE (:Component {id: 'cmp-1'})-[:IS_INSTANCE_OF]->(k)`);
    registry.exposures.set('cls-1', [{ name: 'Exposed', exploitedBy: exposureRefs() }]);

    const result = await svc.setAttributes({ componentId: 'cmp-1', classId: 'cls-1', attributes: { tier: 'web' } });

    expect(result.success).toBe(true);
    expect(result.unresolvedReferences).toEqual(['T9999', 'MitreAttackTechnique.attack_iexposured=T1078']);
    const [attrs] = await run(`MATCH (:Component {id: 'cmp-1'})-[r:IS_INSTANCE_OF]->() RETURN r.tier AS tier`);
    expect(attrs.tier).toBe('web');
    expect(await edgesOf('cmp-1', 'HAS_EXPOSURE')).toEqual([
      ['EXPLOITED_BY', 'AML.T0051', 'prompt injection'],
      ['EXPLOITED_BY', 'T1078', 'valid accounts'],
    ]);
    expect((await findingOf('cmp-1', 'HAS_EXPOSURE')).marker).toEqual([
      'T9999',
      'MitreAttackTechnique.attack_iexposured=T1078',
    ]);

    // The MITRE data catches up: the edge appears and only the disallowed ref stays.
    await run(`CREATE (:MitreAttackTechnique {id: 'tech-T9999', attack_id: 'T9999', name: 'Late'})`);
    const second = await svc.setAttributes({ componentId: 'cmp-1', classId: 'cls-1', attributes: { tier: 'app' } });
    expect(second.unresolvedReferences).toEqual(['MitreAttackTechnique.attack_iexposured=T1078']);
    expect((await edgesOf('cmp-1', 'HAS_EXPOSURE')).map(e => e[1])).toEqual(['AML.T0051', 'T1078', 'T9999']);

    // The class content is fixed: the marker is gone, not left as an empty list.
    registry.exposures.set('cls-1', [{ name: 'Exposed', exploitedBy: exposureRefs(false) }]);
    const third = await svc.setAttributes({ componentId: 'cmp-1', classId: 'cls-1', attributes: { tier: 'db' } });
    expect(third.success).toBe(true);
    expect(third.unresolvedReferences).toBeUndefined();
    const finding = await findingOf('cmp-1', 'HAS_EXPOSURE');
    expect(finding.marker).toBeNull();
    expect(finding.keys).not.toContain('unresolvedReferences');
  });

  it('setAttributes on a Control: a missing requirement is tolerated, MITRE misses are recorded', async () => {
    await run(`MATCH (k:ControlClass {id: 'ccls-1'}) CREATE (:Control {id: 'ctl-1'})-[:IS_INSTANCE_OF]->(k)`);
    registry.countermeasures.set('ccls-1', [
      {
        name: 'Segmentation',
        respondsWith: [
          ref('MitreAttackMitigation', 'attack_id', 'M1037', 'filters traffic'),
          ref('RegulatoryRequirement', 'id', 'iso:A.8.20', 'author-asserted'),
          ref('RegulatoryRequirement', 'id', 'iso:A.9.99'),
          'AML.M0099',
        ],
        mitigates: [ref('MitreAttackTechnique', 'attack_id', 'T1021', 'blocks lateral movement'), 'T1562.010'],
      },
    ]);

    const result = await svc.setAttributes({ componentId: 'ctl-1', classId: 'ccls-1', attributes: { enabled: true } });

    expect(result.success).toBe(true);
    expect(result.unresolvedReferences).toEqual(['AML.M0099', 'T1562.010']);
    expect(await edgesOf('ctl-1', 'HAS_COUNTERMEASURE')).toEqual([
      ['COUNTERMEASURE_MITIGATES', 'T1021', 'blocks lateral movement'],
      ['RESPONDS_WITH', 'M1037', 'filters traffic'],
      ['RESPONDS_WITH', 'iso:A.8.20', 'author-asserted'],
    ]);
    expect((await findingOf('ctl-1', 'HAS_COUNTERMEASURE')).marker).toEqual(['AML.M0099', 'T1562.010']);
  });

  it('changeElementBinding records the marker through the same writer', async () => {
    await run(`CREATE (:Component {id: 'cmp-2'})`);
    registry.exposures.set('cls-1', [{ name: 'Exposed', exploitedBy: exposureRefs() }]);

    const result = await binding.changeElementBinding(
      { elementId: 'cmp-2', target: { kind: 'CLASS', classIds: ['cls-1'] } },
      { user: { sub: 'tester' } } as any,
    );

    expect(result.success).toBe(true);
    expect(result.deltas.instantiatedDerivedExposures).toBe(1);
    expect((await edgesOf('cmp-2', 'HAS_EXPOSURE')).map(e => e[1])).toEqual(['AML.T0051', 'T1078']);
    expect((await findingOf('cmp-2', 'HAS_EXPOSURE')).marker).toEqual([
      'T9999',
      'MitreAttackTechnique.attack_iexposured=T1078',
    ]);
  });

  describe('GraphQL', () => {
    let schema: GraphQLSchema;

    beforeAll(async () => {
      schema = await buildProductionSchema('noauth', mg.driver);
    });

    it('reads the marker and offers no way to write it', async () => {
      for (const type of ['Exposure', 'Countermeasure']) {
        expect(Object.keys((schema.getType(type) as GraphQLObjectType).getFields())).toContain('unresolvedReferences');
        for (const input of [`${type}CreateInput`, `${type}UpdateInput`]) {
          expect(Object.keys((schema.getType(input) as GraphQLInputObjectType).getFields())).not.toContain(
            'unresolvedReferences',
          );
        }
      }
      const result = schema.getType('SetInstantiationAttributesResult') as GraphQLObjectType;
      expect(Object.keys(result.getFields())).toContain('unresolvedReferences');

      await run(`MATCH (k:ComponentClass {id: 'cls-1'}) CREATE (:Component {id: 'cmp-3'})-[:IS_INSTANCE_OF]->(k)`);
      registry.exposures.set('cls-1', [{ name: 'Exposed', exploitedBy: ['T1078', 'T9999'] }]);
      await svc.setAttributes({ componentId: 'cmp-3', classId: 'cls-1', attributes: { tier: 'web' } });

      const read = await graphql({
        schema,
        source: `{ exposures(where: { name: { eq: "Exposed" } }) { name unresolvedReferences } }`,
        contextValue: MEMGRAPH_CONTEXT,
      });
      expect(read.errors).toBeUndefined();
      expect(read.data).toEqual({ exposures: [{ name: 'Exposed', unresolvedReferences: ['T9999'] }] });
    });
  });
});
