import {
  execute as graphqlExecute,
  subscribe as graphqlSubscribe,
  ExecutionArgs,
  GraphQLError,
} from 'graphql';

/**
 * Production error-masking for the SSE transport — the graphql-sse
 * counterpart of Apollo's formatError (gql.module.ts): execution errors are
 * replaced with a generic message (the extensions code survives) so raw
 * resolver/driver internals (e.g. Neo4j constraint messages) never reach
 * clients over /graphql/stream.
 *
 * Scope note: this wraps EXECUTION results only. Pre-execution rejections —
 * validation (depth) and the complexity gate — keep their messages on both
 * transports' SSE side; they are client-input errors whose text is safe and
 * actionable by design.
 */

function maskError(error: any): GraphQLError {
  return new GraphQLError('Internal server error', {
    extensions: { code: error?.extensions?.code || 'INTERNAL_ERROR' },
  });
}

export function maskExecutionResultErrors<T extends { errors?: readonly any[] }>(
  result: T,
  isProduction: boolean,
): T {
  if (!isProduction || !result?.errors?.length) return result;
  return { ...result, errors: result.errors.map(maskError) };
}

function isAsyncIterable(value: any): value is AsyncIterable<any> {
  return typeof value?.[Symbol.asyncIterator] === 'function';
}

/** Masks a graphql-sse OperationResult — single result or stream. */
export function maskOperationResult(result: any, isProduction: boolean): any {
  if (!isProduction) return result;
  if (isAsyncIterable(result)) {
    return (async function* masked() {
      for await (const payload of result) {
        yield maskExecutionResultErrors(payload, isProduction);
      }
    })();
  }
  return maskExecutionResultErrors(result, isProduction);
}

/**
 * execute/subscribe pair for graphql-sse's createHandler that masks
 * execution errors in production. Non-production passes results through
 * untouched (dev keeps full error detail, matching Apollo's behavior).
 */
export function buildMaskedExecutors(isProduction: boolean): {
  execute: (args: ExecutionArgs) => any;
  subscribe: (args: ExecutionArgs) => any;
} {
  return {
    execute: async (args: ExecutionArgs) =>
      maskOperationResult(await graphqlExecute(args), isProduction),
    subscribe: async (args: ExecutionArgs) =>
      maskOperationResult(await graphqlSubscribe(args), isProduction),
  };
}
