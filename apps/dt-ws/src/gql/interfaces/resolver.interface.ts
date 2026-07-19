export interface ResolverService {
  getResolvers(): ResolverMap;
}

export interface ResolverMap {
  [typeName: string]: {
    [fieldName: string]: ResolverFunction;
  };
}

export interface ResolverFunction {
  (parent: any, args: any, context: GraphQLContext, info: any): any;
}

export interface GraphQLContext {
  token?: string; // Raw, unverified bearer string. @neo4j/graphql re-verifies it against JWKS.
  jwt?: Record<string, unknown>; // VERIFIED JWT claims only. @neo4j/graphql trusts a truthy
                                 // context.jwt as pre-verified — this must NEVER hold the raw string.
  driver: any; // Neo4j driver - could be typed more specifically
  user?: any;
  sessionConfig?: { database: string }; // Database name for Neo4j/Memgraph sessions
  cypherQueryOptions?: { addVersionPrefix: boolean }; // Memgraph compatibility option
}

export interface SchemaService {
  getSchema(): Promise<any>;
  validateSchema(): Promise<boolean>;
}
