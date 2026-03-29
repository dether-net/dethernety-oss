import { Logger } from '@nestjs/common';

/**
 * Context passed to a module's getResolvers() at startup.
 * Use this to construct resolver functions that close over shared resources.
 *
 * This is NOT a per-request context. Per-request data (auth token, user)
 * arrives in the standard resolver function signature: (parent, args, context, info).
 */
export interface ModuleResolverContext {
  /** Neo4j/Memgraph driver -- same driver the module received at construction time */
  driver: any;
  /** Logger scoped to the module */
  logger: Logger;
  /** Database name for session creation */
  databaseName: string;
}

/**
 * Map of GraphQL type names to field resolver functions.
 *
 * Example:
 *   {
 *     Query: { myField: resolverFn },
 *     Mutation: { doThing: resolverFn },
 *     MyCustomType: { computedField: resolverFn }
 *   }
 */
export interface ResolverMap {
  [typeName: string]: {
    [fieldName: string]: ResolverFunction;
  };
}

/**
 * Standard GraphQL resolver function signature.
 * The context parameter is the per-request GraphQL context (token, driver, etc.).
 */
export interface ResolverFunction {
  (parent: any, args: any, context: any, info: any): any;
}
