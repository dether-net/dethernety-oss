import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  resolveCspMode,
} from '../security-headers';

/**
 * The CSP is only ever exercised by a browser loading a document, and in the
 * dev loop the document comes from the frontend dev server rather than this
 * app — so a broken policy reaches a built image before anyone sees it. These
 * tests pin the directives the application actually depends on.
 */

function runMiddleware(
  req: any,
  configService?: any,
): { headers: Record<string, string>; nextCalled: boolean } {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
  };
  let nextCalled = false;
  buildSecurityHeaders(configService)(req, res as any, () => {
    nextCalled = true;
  });
  return { headers, nextCalled };
}

const htmlGet = (path: string) => ({
  method: 'GET',
  path,
  headers: { accept: 'text/html,application/xhtml+xml' },
});

describe('buildContentSecurityPolicy', () => {
  const csp = buildContentSecurityPolicy({});

  it.each([
    // Module bundles are imported from blob: URLs; 'self' does not cover blob:.
    ["script-src blob:", "script-src 'self' blob: 'unsafe-eval'"],
    // The form layer compiles JSON Schema validators with the Function
    // constructor, including its own meta-schema, so a form throws while being
    // constructed. Removing 'unsafe-eval' renders every form empty.
    ["script-src 'unsafe-eval'", "script-src 'self' blob: 'unsafe-eval'"],
    // form-action does not fall back to default-src.
    ['form-action', "form-action 'self'"],
    // worker-src DOES fall back to script-src, which would inherit blob:.
    ['worker-src', "worker-src 'none'"],
    ['object-src', "object-src 'none'"],
    ['base-uri', "base-uri 'self'"],
    ['frame-ancestors', "frame-ancestors 'none'"],
    ['default-src', "default-src 'self'"],
  ])('carries %s', (_label, directive) => {
    expect(csp).toContain(directive);
  });

  it('does not admit inline scripts or external script hosts', () => {
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain('http');
  });

  it('widens connect-src to the OIDC issuer origin only, not its path', () => {
    const withIssuer = buildContentSecurityPolicy({
      oidcIssuer: 'https://id.example.com/realms/app',
    });
    expect(withIssuer).toContain("connect-src 'self' https://id.example.com;");
  });

  it('ignores an unparseable OIDC issuer rather than emitting a broken directive', () => {
    expect(buildContentSecurityPolicy({ oidcIssuer: 'not a url' })).toContain(
      "connect-src 'self';",
    );
  });

  it('strips characters that could inject a directive via OIDC_DOMAIN', () => {
    const csp = buildContentSecurityPolicy({ oidcDomain: 'evil.com; script-src *' });
    expect(csp).toContain('connect-src');
    expect(csp).not.toContain('script-src *');
  });
});

describe('resolveCspMode', () => {
  it.each([
    [undefined, 'enforce'],
    ['', 'enforce'],
    ['enforce', 'enforce'],
    ['report-only', 'report-only'],
    ['REPORT-ONLY', 'report-only'],
    ['off', 'off'],
    [' Off ', 'off'],
  ])('maps %s to %s', (raw, expected) => {
    expect(resolveCspMode(raw as any)).toBe(expected);
  });

  it('falls back to enforce on an unrecognised value, so a typo cannot disable the policy', () => {
    expect(resolveCspMode('disabled')).toBe('enforce');
    expect(resolveCspMode('true')).toBe('enforce');
  });
});

describe('buildSecurityHeaders', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.NODE_ENV;
    delete process.env.SECURITY_HEADERS_CSP;
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('sets the non-HSTS headers outside production and always calls next', () => {
    const { headers, nextCalled } = runMiddleware({ method: 'GET', path: '/', headers: {} });

    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Permissions-Policy']).toBeDefined();
    expect(headers['Content-Security-Policy']).toBeDefined();
    expect(headers['Strict-Transport-Security']).toBeUndefined();
    expect(nextCalled).toBe(true);
  });

  it('adds HSTS only in production', () => {
    process.env.NODE_ENV = 'production';
    const { headers } = runMiddleware({ method: 'GET', path: '/', headers: {} });
    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
  });

  it('switches to the report-only header without changing the policy', () => {
    process.env.SECURITY_HEADERS_CSP = 'report-only';
    const { headers } = runMiddleware({ method: 'GET', path: '/', headers: {} });

    expect(headers['Content-Security-Policy']).toBeUndefined();
    expect(headers['Content-Security-Policy-Report-Only']).toBe(buildContentSecurityPolicy({}));
  });

  it('drops the CSP entirely when off, but keeps every other header', () => {
    process.env.SECURITY_HEADERS_CSP = 'off';
    const { headers } = runMiddleware({ method: 'GET', path: '/', headers: {} });

    expect(headers['Content-Security-Policy']).toBeUndefined();
    expect(headers['Content-Security-Policy-Report-Only']).toBeUndefined();
    expect(headers['X-Frame-Options']).toBe('DENY');
  });

  describe('playground exemption', () => {
    const playgroundOn = { get: () => ({ playground: true }) };
    const playgroundOff = { get: () => ({ playground: false }) };

    it.each(['/graphql', '/graphql/'])(
      'skips the CSP for the playground page at %s (the GraphQL route is a prefix, not an exact path)',
      (path) => {
        const { headers } = runMiddleware(htmlGet(path), playgroundOn);
        expect(headers['Content-Security-Policy']).toBeUndefined();
        // The remaining headers still apply to that page.
        expect(headers['X-Frame-Options']).toBe('DENY');
      },
    );

    it('keeps the CSP on the SPA document', () => {
      const { headers } = runMiddleware(htmlGet('/'), playgroundOn);
      expect(headers['Content-Security-Policy']).toBeDefined();
    });

    it('keeps the CSP on a non-HTML GraphQL request', () => {
      const { headers } = runMiddleware(
        { method: 'POST', path: '/graphql', headers: { accept: 'application/json' } },
        playgroundOn,
      );
      expect(headers['Content-Security-Policy']).toBeDefined();
    });

    it('keeps the CSP on /graphql when the playground is disabled', () => {
      const { headers } = runMiddleware(htmlGet('/graphql'), playgroundOff);
      expect(headers['Content-Security-Policy']).toBeDefined();
    });

    it('follows the GraphQL config rather than re-deriving from NODE_ENV', () => {
      // Playground off while NODE_ENV is unset: deriving from NODE_ENV would
      // exempt a page that is no longer the playground.
      const { headers } = runMiddleware(htmlGet('/graphql'), playgroundOff);
      expect(headers['Content-Security-Policy']).toBeDefined();
    });
  });
});
