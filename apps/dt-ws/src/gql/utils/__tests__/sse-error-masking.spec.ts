import { buildSchema, parse } from 'graphql';
import {
  buildMaskedExecutors,
  maskExecutionResultErrors,
  maskOperationResult,
} from '../sse-error-masking';

/**
 * Pins for the SSE production error-masking (the graphql-sse counterpart
 * of Apollo's formatError): raw resolver/driver internals never reach
 * clients over /graphql/stream in production; dev keeps full detail.
 */
describe('maskExecutionResultErrors', () => {
  const leaky = {
    data: null,
    errors: [
      {
        message: 'Neo.ClientError.Schema.ConstraintValidationFailed: node (…)',
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      },
    ],
  };

  it('production: replaces the message, keeps the extensions code', () => {
    const masked = maskExecutionResultErrors(leaky as any, true);
    expect(masked.errors![0].message).toBe('Internal server error');
    expect((masked.errors![0] as any).extensions.code).toBe('INTERNAL_SERVER_ERROR');
    expect(String(JSON.stringify(masked))).not.toContain('Neo.ClientError');
  });

  it('non-production and error-free results pass through untouched', () => {
    expect(maskExecutionResultErrors(leaky as any, false)).toBe(leaky);
    const clean = { data: { ok: 1 } };
    expect(maskExecutionResultErrors(clean as any, true)).toBe(clean);
  });
});

describe('maskOperationResult (stream shape)', () => {
  it('masks every payload of an async-iterable stream in production', async () => {
    async function* stream() {
      yield { data: { a: 1 } };
      yield { data: null, errors: [{ message: 'raw driver detail' }] };
    }

    const masked = maskOperationResult(stream(), true);
    const payloads: any[] = [];
    for await (const p of masked) payloads.push(p);

    expect(payloads[0]).toEqual({ data: { a: 1 } });
    expect(payloads[1].errors[0].message).toBe('Internal server error');
  });
});

describe('buildMaskedExecutors (end-to-end through graphql execute)', () => {
  const schema = buildSchema('type Query { boom: String }');
  const rootValue = {
    boom: () => {
      throw new Error('secret internal detail');
    },
  };

  it('production: a throwing resolver surfaces as a masked error', async () => {
    const { execute } = buildMaskedExecutors(true);
    const result = await execute({
      schema,
      document: parse('{ boom }'),
      rootValue,
    });
    expect(result.errors![0].message).toBe('Internal server error');
  });

  it('development: the real message is preserved', async () => {
    const { execute } = buildMaskedExecutors(false);
    const result = await execute({
      schema,
      document: parse('{ boom }'),
      rootValue,
    });
    expect(result.errors![0].message).toContain('secret internal detail');
  });
});
