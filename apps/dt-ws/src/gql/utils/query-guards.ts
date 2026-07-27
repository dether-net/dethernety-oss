import {
  DocumentNode,
  GraphQLSchema,
  specifiedRules,
  validate as graphqlValidate,
  ValidationRule,
} from 'graphql';
import { getComplexity, simpleEstimator } from 'graphql-query-complexity';
import * as _depthLimitModule from 'graphql-depth-limit';
const depthLimit = (_depthLimitModule as any).default || _depthLimitModule;

/**
 * Shared query-guard logic for BOTH GraphQL transports (Apollo on /graphql
 * and graphql-sse on /graphql/stream). One implementation so the limits can
 * never drift apart again: a query rejected on one transport is rejected on
 * the other.
 */

export interface QueryGuardConfig {
  queryDepthLimit: number;
  queryComplexityLimit: number;
}

/** Depth-limit validation rules (empty when the limit is disabled). */
export function buildValidationRules(config: QueryGuardConfig): ValidationRule[] {
  const rules: ValidationRule[] = [];
  if (config.queryDepthLimit > 0) {
    const depthRule = depthLimit(config.queryDepthLimit);
    // Fail closed. Silently skipping the rule would leave the server accepting
    // arbitrarily deep queries while gql.module.ts still logged the configured
    // depth — a disabled guard indistinguishable from a configured one. Both
    // callers run at construction time (the GraphQL useFactory and the SSE
    // controller's onModuleInit), so this aborts boot rather than failing
    // requests; no request can reach it. The two abort differently, though:
    // the useFactory throw is handled by Nest's initialisation error path,
    // while the onModuleInit throw surfaces through main.ts's own catch.
    // A non-positive limit skips this branch entirely; note that
    // GQL_QUERY_DEPTH_LIMIT itself is validated as 1-50, so that is an
    // internal path rather than a supported way to turn the guard off.
    if (typeof depthRule !== 'function') {
      throw new Error(
        `graphql-depth-limit did not return a validation rule (got ${typeof depthRule}). ` +
          'Refusing to start without the query-depth guard.',
      );
    }
    rules.push(depthRule);
  }
  return rules;
}

/**
 * A graphql `validate` drop-in that appends the depth rules to the spec
 * rules — the shape graphql-sse's `validate` handler option expects.
 */
export function buildGuardedValidate(config: QueryGuardConfig): typeof graphqlValidate {
  const extraRules = buildValidationRules(config);
  return ((schema, documentAST, rules, options) =>
    graphqlValidate(
      schema,
      documentAST,
      [...(rules ?? specifiedRules), ...extraRules],
      options,
    )) as typeof graphqlValidate;
}

/**
 * Complexity gate — needs request variables, so it runs post-parse
 * (Apollo: didResolveOperation plugin hook; SSE: onSubscribe). Throws when
 * the computed complexity exceeds the limit; no-op when disabled.
 */
export function assertComplexityWithinLimit(args: {
  schema: GraphQLSchema;
  operationName?: string | null;
  document: DocumentNode;
  variables?: Record<string, unknown> | null;
  limit: number;
}): void {
  if (args.limit <= 0) return;
  const complexity = getComplexity({
    schema: args.schema,
    operationName: args.operationName ?? undefined,
    query: args.document,
    variables: args.variables || {},
    estimators: [simpleEstimator({ defaultComplexity: 1 })],
  });
  if (complexity > args.limit) {
    throw new Error(
      `Query too complex: ${complexity}. Maximum allowed: ${args.limit}`,
    );
  }
}
