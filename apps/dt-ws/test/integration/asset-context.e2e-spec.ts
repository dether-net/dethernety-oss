// Asset-context schema additions — regression contracts for the new
// user-asserted threat-model fields (model scope, Component.crownJewel,
// Data.sensitivity / Data.regulatoryFlags) and the dataInRegulatoryScope
// query.
//
// Two halves:
//   1. `additive` — pure SDL parse of the real schema.graphql (no container):
//      existing fields untouched + the new fields/query/enums present with the
//      right nullability.
//   2. `@cypher / nullable contract` — a minimal Neo4jGraphQL schema against a
//      real Memgraph (mirrors cypher-mutation-canary.e2e-spec.ts): proves the
//      dataInRegulatoryScope @cypher query, that un-set nodes read the new
//      fields as null without GraphQL non-null errors, and that
//      the dt-core push `{ set }` / `{ set: null }` / `{ set: [] }` wire shapes
//      are accepted on the generated *UpdateInput (the v7 list-update behaviour).

import * as fs from 'fs';
import * as path from 'path';
import {
  parse,
  print,
  graphql,
  GraphQLSchema,
  DocumentNode,
  ObjectTypeDefinitionNode,
  EnumTypeDefinitionNode,
  FieldDefinitionNode,
} from 'graphql';
import { Neo4jGraphQL } from '@neo4j/graphql';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';

jest.setTimeout(120_000);

// ── Half 1: SDL additivity — no database ─────────────────────────────────────
describe('asset-context schema additions are additive', () => {
  let doc: DocumentNode;

  beforeAll(() => {
    // jest-e2e runs with cwd = the dt-ws package root, so this resolves the
    // committed production schema.
    const sdl = fs.readFileSync(path.join(process.cwd(), 'schema', 'schema.graphql'), 'utf8');
    doc = parse(sdl);
  });

  const obj = (name: string): ObjectTypeDefinitionNode =>
    doc.definitions.find(
      (d): d is ObjectTypeDefinitionNode => d.kind === 'ObjectTypeDefinition' && d.name.value === name,
    )!;
  const enm = (name: string): EnumTypeDefinitionNode =>
    doc.definitions.find(
      (d): d is EnumTypeDefinitionNode => d.kind === 'EnumTypeDefinition' && d.name.value === name,
    )!;
  const field = (t: ObjectTypeDefinitionNode, f: string): FieldDefinitionNode =>
    (t.fields ?? []).find((x) => x.name.value === f)!;
  const fieldNames = (t: ObjectTypeDefinitionNode): Set<string> =>
    new Set((t.fields ?? []).map((x) => x.name.value));

  it('Model keeps its existing fields and gains the five nullable scope fields', () => {
    const model = obj('Model');
    const names = fieldNames(model);
    for (const existing of ['id', 'name', 'description', 'defaultBoundary', 'dataItems', 'folder']) {
      expect(names.has(existing)).toBe(true);
    }
    expect(print(field(model, 'depth').type)).toBe('ModelingDepth');
    expect(print(field(model, 'modelingIntent').type)).toBe('ModelingIntent');
    expect(print(field(model, 'complianceDrivers').type)).toBe('[String!]');
    expect(print(field(model, 'exclusions').type)).toBe('[String!]');
    expect(print(field(model, 'trustAssumptions').type)).toBe('[String!]');
  });

  it('Component keeps `type` and gains a nullable crownJewel', () => {
    const component = obj('Component');
    expect(fieldNames(component).has('type')).toBe(true);
    expect(print(field(component, 'crownJewel').type)).toBe('Boolean');
  });

  it('Data gains nullable sensitivity and regulatoryFlags', () => {
    const data = obj('Data');
    expect(print(field(data, 'sensitivity').type)).toBe('SensitivityLevel');
    expect(print(field(data, 'regulatoryFlags').type)).toBe('[String!]');
  });

  it('Query exposes dataInRegulatoryScope(flag: String!): [Data!]!', () => {
    const f = field(obj('Query'), 'dataInRegulatoryScope');
    expect(f).toBeDefined();
    expect(print(f.type)).toBe('[Data!]!');
    expect((f.arguments ?? []).map((a) => `${a.name.value}: ${print(a.type)}`)).toEqual(['flag: String!']);
  });

  it('the three new enums carry the exact members', () => {
    expect(enm('ModelingDepth').values?.map((v) => v.name.value)).toEqual([
      'ARCHITECTURE',
      'DESIGN',
      'IMPLEMENTATION',
    ]);
    expect(enm('ModelingIntent').values?.map((v) => v.name.value)).toEqual([
      'INITIAL',
      'SECURITY_REVIEW',
      'COMPLIANCE',
      'INCIDENT_RESPONSE',
    ]);
    expect(enm('SensitivityLevel').values?.map((v) => v.name.value)).toEqual([
      'PUBLIC',
      'INTERNAL',
      'CONFIDENTIAL',
      'RESTRICTED',
    ]);
  });
});

// ── Half 2: @cypher query + nullable contract — Memgraph ─────────────────────
//
// Minimal schema: the same `dataInRegulatoryScope` @cypher statement that ships
// in production, plus the auto-generated CRUD for Model/Data/Component (the
// asset-context fields). @authentication is intentionally omitted (matching
// cypher-mutation-canary) — it is identical to 28 existing uses and out of scope
// for this behavioural test.
const typeDefs = `
  enum SensitivityLevel { PUBLIC INTERNAL CONFIDENTIAL RESTRICTED }
  enum ModelingDepth { ARCHITECTURE DESIGN IMPLEMENTATION }
  enum ModelingIntent { INITIAL SECURITY_REVIEW COMPLIANCE INCIDENT_RESPONSE }

  type Model @node {
    id: ID!
    name: String!
    depth: ModelingDepth
    modelingIntent: ModelingIntent
    complianceDrivers: [String!]
    exclusions: [String!]
    trustAssumptions: [String!]
  }

  type Data @node {
    id: ID!
    name: String!
    sensitivity: SensitivityLevel
    regulatoryFlags: [String!]
  }

  type Component @node {
    id: ID!
    name: String!
    crownJewel: Boolean
  }

  type Query {
    dataInRegulatoryScope(flag: String!): [Data!]!
      @cypher(
        statement: """
        MATCH (d:Data) WHERE $flag IN COALESCE(d.regulatoryFlags, [])
        RETURN d
        """
        columnName: "d"
      )
  }
`;

// Memgraph's database is `memgraph` (not the @neo4j/graphql default `neo4j`);
// addVersionPrefix:false drops the `CYPHER 5` prefix Memgraph rejects.
// Mirrors gql.module.ts and the canary harness.
const ctx = {
  cypherQueryOptions: { addVersionPrefix: false },
  sessionConfig: { database: 'memgraph' },
};

describe('dataInRegulatoryScope @cypher + nullable contract (Memgraph)', () => {
  let mg: MemgraphHandle;
  let schema: GraphQLSchema;

  const run = (source: string) => graphql({ schema, source, contextValue: ctx });

  beforeAll(async () => {
    mg = await startMemgraph();
    schema = await new Neo4jGraphQL({ typeDefs, driver: mg.driver }).getSchema();
  }, 120_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
  });

  // dataInRegulatoryScope @cypher query
  it('returns exactly the Data carrying the flag', async () => {
    const seed = await run(`
      mutation {
        createData(input: [
          { id: "d-pci",  name: "Cardholder", regulatoryFlags: ["PCI cardholder"] }
          { id: "d-phi",  name: "Patient",    regulatoryFlags: ["PHI"] }
          { id: "d-none", name: "Logs" }
        ]) { data { id } }
      }
    `);
    expect(seed.errors).toBeUndefined();

    const r = await run(`query { dataInRegulatoryScope(flag: "PCI cardholder") { id name regulatoryFlags } }`);
    expect(r.errors).toBeUndefined();
    expect((r.data as any).dataInRegulatoryScope).toEqual([
      { id: 'd-pci', name: 'Cardholder', regulatoryFlags: ['PCI cardholder'] },
    ]);
  });

  // case-sensitivity footgun: a wrong-case flag silently returns [], not an error.
  it('is case-sensitive (wrong case yields [], not an error)', async () => {
    await run(`mutation { createData(input: [{ id: "d-pci", name: "x", regulatoryFlags: ["PCI cardholder"] }]) { data { id } } }`);
    const r = await run(`query { dataInRegulatoryScope(flag: "pci cardholder") { id } }`);
    expect(r.errors).toBeUndefined();
    expect((r.data as any).dataInRegulatoryScope).toEqual([]);
  });

  // COALESCE: a Data with no regulatoryFlags property must not error the scan.
  it('COALESCE handles Data with no regulatoryFlags without erroring', async () => {
    await run(`mutation { createData(input: [{ id: "d-none", name: "x" }]) { data { id } } }`);
    const r = await run(`query { dataInRegulatoryScope(flag: "PHI") { id } }`);
    expect(r.errors).toBeUndefined();
    expect((r.data as any).dataInRegulatoryScope).toEqual([]);
  });

  // read half — un-set Data reads the new fields as null, no non-null error.
  it('un-set Data reads sensitivity & regulatoryFlags as null', async () => {
    const created = await run(`mutation { createData(input: [{ id: "d1", name: "x" }]) { data { id sensitivity regulatoryFlags } } }`);
    expect(created.errors).toBeUndefined();
    expect((created.data as any).createData.data[0]).toEqual({
      id: 'd1',
      sensitivity: null,
      regulatoryFlags: null,
    });

    const read = await run(`query { data(where: { id: { eq: "d1" } }) { sensitivity regulatoryFlags } }`);
    expect(read.errors).toBeUndefined();
    expect((read.data as any).data[0]).toEqual({ sensitivity: null, regulatoryFlags: null });
  });

  // read half — un-set Component reads crownJewel as null.
  it('un-set Component reads crownJewel as null', async () => {
    await run(`mutation { createComponents(input: [{ id: "c1", name: "x" }]) { components { id } } }`);
    const read = await run(`query { components(where: { id: { eq: "c1" } }) { crownJewel } }`);
    expect(read.errors).toBeUndefined();
    expect((read.data as any).components[0]).toEqual({ crownJewel: null });
  });

  // ── Push { set } wire shapes — the v7 list-update behaviour ─────────────────
  //
  // The dt-core push builders emit `{ set: value }`, `{ set: null }` and
  // `{ set: [] }` for the asset-context fields (REPLACE semantics). The only
  // thing not provable by reading dt-core is whether @neo4j/graphql 7.2.0 on
  // Memgraph ACCEPTS those exact shapes on the generated *UpdateInput. These
  // tests run the real update mutations and read back, closing that gap.
  //
  // Note: an empty-list `{ set: [] }` round-trips as `[]` in the mutation
  // projection response here (not null) — the point of these tests is that the
  // `{ set }` / `{ set: null }` / `{ set: [] }` shapes are ACCEPTED, which they are.
  describe('push { set } wire shapes (replace)', () => {
    it('updateModels applies { set } for enum + list scope fields, then clears', async () => {
      await run(`mutation { createModels(input: [{ id: "m1", name: "M" }]) { models { id } } }`);

      const set = await run(`
        mutation {
          updateModels(
            where: { id: { eq: "m1" } }
            update: {
              depth: { set: DESIGN }
              modelingIntent: { set: SECURITY_REVIEW }
              complianceDrivers: { set: ["PCI cardholder"] }
              exclusions: { set: [] }
            }
          ) { models { depth modelingIntent complianceDrivers exclusions } }
        }
      `);
      expect(set.errors).toBeUndefined();
      expect((set.data as any).updateModels.models[0]).toEqual({
        depth: 'DESIGN',
        modelingIntent: 'SECURITY_REVIEW',
        complianceDrivers: ['PCI cardholder'],
        exclusions: [], // { set: [] } accepted; round-trips as []
      });

      // REPLACE clear: { set: null } for the enum, { set: [] } for the list.
      const clear = await run(`
        mutation {
          updateModels(
            where: { id: { eq: "m1" } }
            update: { depth: { set: null }, complianceDrivers: { set: [] } }
          ) { models { depth complianceDrivers } }
        }
      `);
      expect(clear.errors).toBeUndefined();
      expect((clear.data as any).updateModels.models[0]).toEqual({
        depth: null,
        complianceDrivers: [], // { set: [] } accepted; round-trips as []
      });
    });

    it('updateComponents applies crownJewel { set: true } then { set: false }', async () => {
      await run(`mutation { createComponents(input: [{ id: "c1", name: "x" }]) { components { id } } }`);

      const on = await run(`mutation { updateComponents(where: { id: { eq: "c1" } } update: { crownJewel: { set: true } }) { components { crownJewel } } }`);
      expect(on.errors).toBeUndefined();
      expect((on.data as any).updateComponents.components[0]).toEqual({ crownJewel: true });

      const off = await run(`mutation { updateComponents(where: { id: { eq: "c1" } } update: { crownJewel: { set: false } }) { components { crownJewel } } }`);
      expect(off.errors).toBeUndefined();
      expect((off.data as any).updateComponents.components[0]).toEqual({ crownJewel: false });
    });

    it('updateData applies sensitivity + regulatoryFlags { set }, then clears', async () => {
      await run(`mutation { createData(input: [{ id: "d1", name: "x" }]) { data { id } } }`);

      const set = await run(`
        mutation {
          updateData(
            where: { id: { eq: "d1" } }
            update: { sensitivity: { set: RESTRICTED }, regulatoryFlags: { set: ["PCI cardholder"] } }
          ) { data { sensitivity regulatoryFlags } }
        }
      `);
      expect(set.errors).toBeUndefined();
      expect((set.data as any).updateData.data[0]).toEqual({
        sensitivity: 'RESTRICTED',
        regulatoryFlags: ['PCI cardholder'],
      });

      const clear = await run(`
        mutation {
          updateData(
            where: { id: { eq: "d1" } }
            update: { sensitivity: { set: null }, regulatoryFlags: { set: [] } }
          ) { data { sensitivity regulatoryFlags } }
        }
      `);
      expect(clear.errors).toBeUndefined();
      expect((clear.data as any).updateData.data[0]).toEqual({
        sensitivity: null,
        regulatoryFlags: [], // { set: [] } accepted; round-trips as []
      });
    });
  });
});
