import { DatabaseService } from '../database.service';

/**
 * Pin the URL-vs-config encryption rule in createDriver: neo4j-driver throws
 * "Encryption/trust can only be configured either through URL or config, not
 * both" when a `+s`/`+ssc` URI scheme is paired with encrypted/trust keys in
 * the driver config — their mere PRESENCE conflicts, whatever the value. The
 * shipped production templates pair neo4j+s:// with NEO4J_ENCRYPTED=true, so
 * the config keys must be omitted entirely for those schemes (URL wins).
 */

const mockDriverFn = jest.fn(() => ({ close: async () => {} }));
jest.mock('neo4j-driver', () => ({
  __esModule: true,
  default: {
    driver: (...args: any[]) => mockDriverFn(...(args as [])),
    auth: { basic: () => ({}) },
  },
}));

function makeService(uri: string, encrypted: boolean) {
  return new DatabaseService({
    get: () => ({ uri, username: 'u', password: 'p', encrypted, trustSelfSignedCerts: false }),
  } as any);
}

async function driverConfigFor(uri: string, encrypted: boolean): Promise<any> {
  mockDriverFn.mockClear();
  await (makeService(uri, encrypted) as any).createDriver();
  expect(mockDriverFn).toHaveBeenCalledTimes(1);
  return (mockDriverFn.mock.calls[0] as any)[2];
}

describe('createDriver — encryption config vs URI scheme', () => {
  it.each(['neo4j+s://host:7687', 'neo4j+ssc://host:7687', 'bolt+s://host:7687', 'bolt+ssc://host:7687'])(
    '%s: encrypted/trust keys are OMITTED (URL wins; keys would make the driver throw)',
    async (uri) => {
      const config = await driverConfigFor(uri, true);
      expect('encrypted' in config).toBe(false);
      expect('trust' in config).toBe(false);
    },
  );

  it('plain bolt:// keeps the config-driven encryption keys', async () => {
    const config = await driverConfigFor('bolt://host:7687', true);
    expect(config.encrypted).toBe('ENCRYPTION_ON');
    expect(config.trust).toBe('TRUST_SYSTEM_CA_SIGNED_CERTIFICATES');
  });

  it('plain neo4j:// with encryption off passes ENCRYPTION_OFF', async () => {
    const config = await driverConfigFor('neo4j://host:7687', false);
    expect(config.encrypted).toBe('ENCRYPTION_OFF');
  });
});
