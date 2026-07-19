import 'reflect-metadata'; // class-transformer decorators need the shim under Jest
import { validateEnvironment } from '../environment.validation';

/**
 * Pin: NEO4J_DATABASE has NO default anywhere. Unset means "the server's
 * default database" — the only value valid on both engines (Memgraph rejects
 * sessions naming a database it doesn't have → boot loop). DatabaseConfig
 * reads process.env directly (pinned in database-config.spec); this pins the
 * ConfigModule-validated env object so a future reader of
 * configService.get('NEO4J_DATABASE') can't resurrect the 'neo4j' default.
 */
describe('EnvironmentVariables — NEO4J_DATABASE', () => {
  const baseEnv = { NEO4J_PASSWORD: 'secret' };

  it('stays undefined when unset (no engine-specific default)', () => {
    const validated = validateEnvironment({ ...baseEnv });
    expect(validated.NEO4J_DATABASE).toBeUndefined();
  });

  it('passes an explicit value through', () => {
    const validated = validateEnvironment({ ...baseEnv, NEO4J_DATABASE: 'memgraph' });
    expect(validated.NEO4J_DATABASE).toBe('memgraph');
  });
});
