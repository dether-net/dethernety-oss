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
    if (depthRule) rules.push(depthRule);
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
