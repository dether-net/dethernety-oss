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
  token?: string;
  jwt?: string; // Neo4j GraphQL expects this field for authentication
  driver: any; // Neo4j driver - could be typed more specifically
  user?: any;
  sessionConfig?: { database: string }; // Database name for Neo4j/Memgraph sessions
  cypherQueryOptions?: { addVersionPrefix: boolean }; // Memgraph compatibility option
}

export interface SchemaService {
  getSchema(): Promise<any>;
  validateSchema(): Promise<boolean>;
}
