import 'reflect-metadata'; // class-transformer decorators need the shim under Jest
import { validateEnvironment } from '../environment.validation';

/**
 * Fail-closed bootstrap gate. A deployment against a shared / multi-tenant
 * IdP must refuse to start when it is network-reachable with an empty access
 * allowlist (every pool user holds a signature-valid token → an empty list would
 * serve everyone), and must require OIDC_AUDIENCE (else validation is
 * signature-only and cross-deployment rejection never happens).
 *
 * The gate lives in validateEnvironment (a thrown Error there fails ConfigModule's
 * synchronous `validate` hook → NestFactory.create rejects → process.exit(1)).
 * These are pure config-validation tests — no guard import, so no jose/ESM issue.
 *
 * Two deliberate asymmetries pinned below:
 *  - The ALLOWLIST throw is exempt for dev + ENABLE_NOAUTH (mock admin, dev-only).
 *  - The AUDIENCE throw is NOT exempt — it fires whenever shared + audience-unset.
 *
 * NODE_ENV is 'test' (non-production) in the base env so the production-only
 * block is skipped and each case exercises the shared-pool gate in isolation.
 * Every override is the STRING form as process.env delivers it; the boolEnv
 * transform reads the raw source case-insensitively, so 'true'/'TRUE' both arm
 * the gate and 'false' disarms it.
 */
describe('EnvironmentVariables — shared-pool fail-closed gate', () => {
  const baseEnv = { NEO4J_PASSWORD: 'secret', NODE_ENV: 'test' };

  it('shared + network + empty allowlist → refuses (allowlist)', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        OIDC_SHARED_POOL: 'true',
        DEPLOYMENT_EXPOSURE: 'network',
        OIDC_AUDIENCE: 'aud', // set → only the allowlist throw fires
      }),
    ).toThrow(/non-empty DEPLOYMENT_ALLOWLIST/);
  });

  it('shared + loopback + empty allowlist → serves (exempt)', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        OIDC_SHARED_POOL: 'true',
        DEPLOYMENT_EXPOSURE: 'loopback',
        OIDC_AUDIENCE: 'aud',
      }),
    ).not.toThrow();
  });

  it('shared + network + populated allowlist → serves', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        OIDC_SHARED_POOL: 'true',
        DEPLOYMENT_EXPOSURE: 'network',
        DEPLOYMENT_ALLOWLIST: 'sub-A',
        OIDC_AUDIENCE: 'aud',
      }),
    ).not.toThrow();
  });

  it('shared + audience unset → refuses (audience)', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        OIDC_SHARED_POOL: 'true',
        DEPLOYMENT_EXPOSURE: 'loopback', // loopback + set list → only the audience throw fires
        DEPLOYMENT_ALLOWLIST: 'sub-A',
      }),
    ).toThrow(/OIDC_AUDIENCE/);
  });

  it('private IdP (OIDC_SHARED_POOL unset) → serves unrestricted (unchanged)', () => {
    expect(() => validateEnvironment({ ...baseEnv })).not.toThrow();
  });

  it('dev + NOAUTH + shared + network + empty → serves (allowlist exemption)', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        NODE_ENV: 'development',
        OIDC_SHARED_POOL: 'true',
        DEPLOYMENT_EXPOSURE: 'network',
        ENABLE_NOAUTH: 'true',
        OIDC_AUDIENCE: 'aud', // audience set so the un-exempted audience throw doesn't confound this
      }),
    ).not.toThrow();
  });

  it('dev + NOAUTH + shared + audience unset → STILL refuses (audience has no exemption)', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        NODE_ENV: 'development',
        OIDC_SHARED_POOL: 'true',
        DEPLOYMENT_EXPOSURE: 'loopback',
        DEPLOYMENT_ALLOWLIST: 'sub-A',
        ENABLE_NOAUTH: 'true',
      }),
    ).toThrow(/OIDC_AUDIENCE/);
  });

  it("OIDC_SHARED_POOL='false' + network + empty → serves (disarmed; pins the raw-value parse)", () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        OIDC_SHARED_POOL: 'false',
        DEPLOYMENT_EXPOSURE: 'network',
      }),
    ).not.toThrow();
  });

  it("OIDC_SHARED_POOL='TRUE' (uppercase) + network + empty → refuses (case-insensitive parse)", () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        OIDC_SHARED_POOL: 'TRUE',
        DEPLOYMENT_EXPOSURE: 'network',
        OIDC_AUDIENCE: 'aud',
      }),
    ).toThrow(/non-empty DEPLOYMENT_ALLOWLIST/);
  });

  it('shared + network + whitespace/comma-only allowlist → refuses (treated empty)', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnv,
        OIDC_SHARED_POOL: 'true',
        DEPLOYMENT_EXPOSURE: 'network',
        DEPLOYMENT_ALLOWLIST: ' , ',
        OIDC_AUDIENCE: 'aud',
      }),
    ).toThrow(/non-empty DEPLOYMENT_ALLOWLIST/);
  });
});
