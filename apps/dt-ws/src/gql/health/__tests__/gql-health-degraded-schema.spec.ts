import { GqlHealthService } from '../gql-health.service';

/**
 * Pin for the schema-degradation surfacing: when the composition fallback
 * fired at boot (base-only schema served, module surface missing), /health
 * must say so — a fully-green report while module types are absent would
 * hide the degradation exactly when an operator needs to see it.
 */
function makeService(opts: { degraded: boolean }) {
  const driver: any = {
    session: () => ({
      run: async () => ({ records: [{}] }),
      close: async () => {},
    }),
  };
  const schemaService: any = {
    validateSchema: async () => true,
    isSchemaDegraded: () => opts.degraded,
  };
  return new GqlHealthService(schemaService, driver);
}

describe('GqlHealthService — degraded-schema surfacing', () => {
  it('reports degraded (with the reason) when the fallback schema is being served', async () => {
    const health = await makeService({ degraded: true }).getHealthStatus();

    expect(health.status).toBe('degraded');
    expect(health.details.schema).toBe('degraded');
    expect(health.errors?.join(' ')).toContain('without module types');
  });

  it('reports healthy when the full schema composed', async () => {
    const health = await makeService({ degraded: false }).getHealthStatus();

    expect(health.status).toBe('healthy');
    expect(health.details.schema).toBe('valid');
  });
});
