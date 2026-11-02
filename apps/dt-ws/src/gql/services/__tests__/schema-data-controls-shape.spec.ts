/**
 * Controls on Data elements — the generated API surface.
 *
 * A Control attaches to a Data element by the same SUPPORTS edge it uses for every other element, read from either
 * end: `Data.controls` and `Control.supportedData`. Both offer connect and disconnect only. The default nested
 * operations would also let `updateData { controls: { delete } }` remove library Controls and
 * `updateControls { supportedData: { create } }` mint a Data element that no model contains.
 *
 * Asserted on the schema the platform serves, built in-process with no database, in both variants: the no-auth one is
 * produced by the generator the deployments use, which must pass the new fields through.
 */

import { GraphQLInputObjectType, GraphQLObjectType, GraphQLSchema, getNamedType } from 'graphql';
import { buildProductionSchema } from '../../../../test/integration/production-schema';

const fieldNames = (schema: GraphQLSchema, typeName: string): string[] => {
  const type = schema.getType(typeName);
  if (!(type instanceof GraphQLObjectType) && !(type instanceof GraphQLInputObjectType)) {
    throw new Error(`${typeName} is not an object or input type`);
  }
  return Object.keys(type.getFields()).sort();
};

/** The input fields offered under `typeName.field`, e.g. the nested operations of a relationship update. */
const nestedOperations = (schema: GraphQLSchema, typeName: string, field: string): string[] => {
  const type = schema.getType(typeName) as GraphQLInputObjectType;
  const named = getNamedType(type.getFields()[field].type);
  if (!(named instanceof GraphQLInputObjectType)) throw new Error(`${typeName}.${field} is not an input object`);
  return Object.keys(named.getFields()).sort();
};

describe.each(['auth', 'noauth'] as const)('schema.graphql (%s) — controls on Data elements', (variant) => {
  let schema: GraphQLSchema;

  beforeAll(async () => {
    schema = await buildProductionSchema(variant);
  }, 60_000);

  it('reads the edge from both ends', () => {
    expect(fieldNames(schema, 'Data')).toContain('controls');
    expect(fieldNames(schema, 'Control')).toContain('supportedData');
    expect(getNamedType((schema.getType('Data') as GraphQLObjectType).getFields().controls.type).name).toBe('Control');
    expect(getNamedType((schema.getType('Control') as GraphQLObjectType).getFields().supportedData.type).name).toBe('Data');
  });

  it('writes the edge from both ends, by connect and disconnect only', () => {
    expect(nestedOperations(schema, 'DataUpdateInput', 'controls')).toEqual(['connect', 'disconnect']);
    expect(nestedOperations(schema, 'ControlUpdateInput', 'supportedData')).toEqual(['connect', 'disconnect']);
    expect(nestedOperations(schema, 'DataCreateInput', 'controls')).toEqual(['connect']);
    expect(nestedOperations(schema, 'ControlCreateInput', 'supportedData')).toEqual(['connect']);
  });

  it('keeps the element types the edge already served', () => {
    for (const field of ['supportedComponents', 'supportedBoundaries', 'supportedDataFlows', 'elements']) {
      expect(fieldNames(schema, 'Control')).toContain(field);
    }
  });
});
