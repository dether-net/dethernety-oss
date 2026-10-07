// The production schema.graphql, composed in-process the way SchemaService composes it, for
// integration specs that must test the real API surface rather than a probe SDL.
//
// `auth` keeps @authentication (authorization configured with a JWKS URL that is never
// contacted: specs on this variant stop at validation); `noauth` strips it with the
// generator the deployments use, and executes against the given driver.
import * as fs from 'fs';
import * as path from 'path';
import { Neo4jGraphQL } from '@neo4j/graphql';
import { GraphQLSchema } from 'graphql';
import { populateAuthoredByOnCreate, stampCreatedByUserOnCreate } from '../../src/gql/populated-by/authored-by';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { stripAuthentication } = require('../../../../scripts/generate-noauth-schema.js');

export const PRODUCTION_SDL = fs.readFileSync(path.join(__dirname, '..', '..', 'schema', 'schema.graphql'), 'utf8');

export async function buildProductionSchema(variant: 'auth' | 'noauth', driver?: unknown): Promise<GraphQLSchema> {
  const features: Record<string, unknown> = {
    populatedBy: { callbacks: { populateAuthoredByOnCreate, stampCreatedByUserOnCreate } },
  };
  if (variant === 'auth') {
    features.authorization = { key: { url: 'https://jwks.invalid/.well-known/jwks.json' } };
  }
  const typeDefs = variant === 'auth' ? PRODUCTION_SDL : stripAuthentication(PRODUCTION_SDL);
  const warn = console.warn;
  console.warn = () => undefined; // "Custom resolver … has not been provided": the specs need none
  try {
    return await new Neo4jGraphQL({ typeDefs, features, driver: driver as never }).getSchema();
  } finally {
    console.warn = warn;
  }
}

/** Context for executing against Memgraph without auth. */
export const MEMGRAPH_CONTEXT = { cypherQueryOptions: { addVersionPrefix: false }, sessionConfig: { database: 'memgraph' } };
