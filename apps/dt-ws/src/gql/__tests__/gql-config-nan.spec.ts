import gqlConfigFactory from '../gql.config';

/**
 * Pin the NaN rejection in the GraphQL config: `parseInt` of a non-numeric
 * env var yields NaN, which is `typeof 'number'` and compares false against
 * any bound — before this guard, GQL_QUERY_DEPTH_LIMIT=abc silently DISABLED
 * the depth limit and a NaN moduleLoadTimeout reached setTimeout(fn, NaN)
 * (fires immediately → every module load "times out").
 */
describe('gql config — NaN env rejection', () => {
  const TOUCHED = [
    'GQL_QUERY_DEPTH_LIMIT',
    'GQL_QUERY_COMPLEXITY_LIMIT',
    'MODULE_LOAD_TIMEOUT',
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
    const config = gqlConfigFactory() as any;
    expect(config.queryDepthLimit).toBe(15);
    expect(config.queryComplexityLimit).toBe(1000);
    expect(config.moduleLoadTimeout).toBe(30000);
  });
});
