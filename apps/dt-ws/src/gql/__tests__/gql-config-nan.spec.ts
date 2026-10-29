import gqlConfigFactory from '../gql.config';

/**
 * Pin the rejection of invalid env values in the GraphQL config. NaN: `parseInt` of a non-numeric
 * env var yields NaN, which is `typeof 'number'` and compares false against
 * any bound — before this guard, GQL_QUERY_DEPTH_LIMIT=abc silently DISABLED
 * the depth limit and a NaN moduleLoadTimeout reached setTimeout(fn, NaN)
 * (fires immediately → every module load "times out"). Also pin
 * TEMPLATE_OPERATION_TIMEOUT_MS outside 5000 to 300000, which the environment
 * validation can let through.
 */
describe('gql config — invalid env rejection', () => {
  const TOUCHED = [
    'GQL_QUERY_DEPTH_LIMIT',
    'GQL_QUERY_COMPLEXITY_LIMIT',
    'MODULE_LOAD_TIMEOUT',
    'TEMPLATE_OPERATION_TIMEOUT_MS',
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of TOUCHED) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of TOUCHED) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it.each(TOUCHED)('%s=abc fails at boot naming the setting', (key) => {
    process.env[key] = 'abc';
    expect(() => gqlConfigFactory()).toThrow(/GraphQL configuration validation failed/);
  });

  it('valid numeric env parses and unset falls back to defaults', () => {
    process.env.GQL_QUERY_DEPTH_LIMIT = '15';
    process.env.TEMPLATE_OPERATION_TIMEOUT_MS = '45000';
    const config = gqlConfigFactory() as any;
    expect(config.queryDepthLimit).toBe(15);
    expect(config.queryComplexityLimit).toBe(1000);
    expect(config.moduleLoadTimeout).toBe(30000);
    expect(config.templateOperationTimeout).toBe(45000);
    delete process.env.TEMPLATE_OPERATION_TIMEOUT_MS;
    expect((gqlConfigFactory() as any).templateOperationTimeout).toBe(30000);
  });

  // The environment validation's own range check can miss a value parseInt still reads, such as '400000ms'.
  it.each(['400000', '400000ms', '4000'])('TEMPLATE_OPERATION_TIMEOUT_MS=%s outside 5000 to 300000 fails at boot', (value) => {
    process.env.TEMPLATE_OPERATION_TIMEOUT_MS = value;
    expect(() => gqlConfigFactory()).toThrow(/templateOperationTimeout/);
  });
});
