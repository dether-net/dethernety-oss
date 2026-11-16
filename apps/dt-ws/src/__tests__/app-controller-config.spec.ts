import { AppController } from '../app.controller';

/**
 * The OIDC scope the SPA requests at login is deployment configuration,
 * delivered through the existing GET /config runtime-config channel. dt-ws is a
 * courier: it emits OIDC_SCOPE (defaulted) and never reads or branches on it.
 *
 * getFrontendConfig() touches none of the injected services, so a bare
 * controller instance suffices (mirrors app-controller-health-codes.spec).
 */
describe('GET /config — oidcScope (courier)', () => {
  const controller = new AppController(undefined as any, undefined as any, undefined as any);

  const originalScope = process.env.OIDC_SCOPE;
  afterEach(() => {
    if (originalScope === undefined) delete process.env.OIDC_SCOPE;
    else process.env.OIDC_SCOPE = originalScope;
  });

  it('defaults to the base scopes when OIDC_SCOPE is unset (byte-identical to today)', () => {
    delete process.env.OIDC_SCOPE;
    const config = controller.getFrontendConfig();
    expect(config.oidcScope).toBe('openid profile email');
  });

  it('emits OIDC_SCOPE verbatim when set', () => {
    process.env.OIDC_SCOPE = 'openid profile email api.read';
    const config = controller.getFrontendConfig();
    expect(config.oidcScope).toBe('openid profile email api.read');
  });
});

describe('GET /config — branding', () => {
  it('is null when the installation is unbranded (or the branding service is absent)', () => {
    const bare = new AppController(undefined as any, undefined as any, undefined as any);
    expect(bare.getFrontendConfig().branding).toBeNull();
    const unbranded = new AppController(undefined as any, undefined as any, undefined as any, undefined, {
      publicConfig: () => null,
    } as any);
    expect(unbranded.getFrontendConfig().branding).toBeNull();
  });

  it('carries the public config of the branding service', () => {
    const branding = { name: 'Example', logoUrl: `/branding/logo/${'a'.repeat(64)}`, logoWidth: 10, logoHeight: 10 };
    const branded = new AppController(undefined as any, undefined as any, undefined as any, undefined, {
      publicConfig: () => branding,
    } as any);
    expect(branded.getFrontendConfig().branding).toEqual(branding);
  });
});
