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
