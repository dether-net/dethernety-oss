import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { GqlConfig } from '../../gql/gql.config';

/**
 * How the Content-Security-Policy is delivered.
 *
 * `off` and `report-only` exist because a bad policy breaks the product in a
 * way no server-side signal reveals — the browser refuses a script and the page
 * renders empty. Installs without an update channel would otherwise need a full
 * image rebuild to recover, so the policy stays adjustable at runtime.
 * Only the CSP is affected; the other headers are unconditional.
 */
export type CspMode = 'enforce' | 'report-only' | 'off';

const GRAPHQL_PATH = '/graphql';

export function resolveCspMode(raw: string | undefined, logger?: Logger): CspMode {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '' || value === 'enforce') return 'enforce';
  if (value === 'report-only' || value === 'report_only') return 'report-only';
  if (value === 'off') return 'off';
  // Fail towards protection: an unrecognised value must not silently disable
  // the policy, which is the failure mode a typo would otherwise produce.
  logger?.warn(
    `SECURITY_HEADERS_CSP="${raw}" is not one of enforce|report-only|off. Falling back to enforce.`,
  );
  return 'enforce';
}

export interface CspEnv {
  oidcIssuer?: string;
  oidcDomain?: string;
}

export function buildContentSecurityPolicy(env: CspEnv): string {
  // connect-src is widened to the identity provider's origin only, so the SPA
  // can complete the OIDC token exchange without opening the policy generally.
  const connectSrcParts = ["'self'"];
  if (env.oidcIssuer) {
    try {
      connectSrcParts.push(new URL(env.oidcIssuer).origin);
    } catch {
      /* invalid URL, skip */
    }
  }
  if (env.oidcDomain) {
    const sanitizedDomain = env.oidcDomain.replace(/[^a-zA-Z0-9.\-:]/g, '');
    connectSrcParts.push(`https://${sanitizedDomain}`);
  }

  return [
    "default-src 'self'",
    // Two concessions in script-src, both load-bearing rather than convenience:
    //
    // `blob:` — the frontend loads every module bundle by importing a blob URL,
    // and 'self' does not cover blob:. The durable fix is serving bundles from
    // a same-origin URL, which needs the bundle route to stop requiring a
    // bearer token that a bare import() cannot send.
    //
    // 'unsafe-eval' — the form layer (JSON Schema driven) compiles validators
    // with the Function constructor at runtime, including when it builds its
    // own meta-schema, so a form fails while being constructed rather than on
    // input. Schemas arrive from modules at runtime, so they cannot be
    // precompiled at build time, and the validator is not pluggable.
    //
    // Both are documented in docs/SECURITY_MODEL.md. Everything else in this
    // policy still applies: no external script hosts, no inline <script>, no
    // objects, no framing, no off-origin form posts.
    "script-src 'self' blob: 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connectSrcParts.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    // form-action does NOT fall back to default-src, so without it there is no
    // restriction on where a form may submit.
    "form-action 'self'",
    // worker-src does fall back to script-src, which would inherit blob: and
    // permit blob-backed workers. The app uses none, so deny them outright.
    "worker-src 'none'",
  ].join('; ');
}

/**
 * The GraphQL playground page ships a nonce-less inline script and loads its
 * bundle from a CDN. A response-header CSP could admit it only by allowing
 * 'unsafe-inline' and that CDN host on every route, so this page is served
 * without the CSP header instead; the other headers still apply.
 *
 * Matched as a prefix, not an exact path: the GraphQL middleware is mounted
 * with app.use(), so `/graphql/` and deeper paths render the same page.
 * `Accept` is client-chosen, which is only safe because the page is static and
 * this branch is reachable exclusively when the playground is enabled.
 */
function isPlaygroundPage(req: Request, playgroundEnabled: boolean): boolean {
  if (!playgroundEnabled) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const path = req.path;
  if (path !== GRAPHQL_PATH && !path.startsWith(`${GRAPHQL_PATH}/`)) return false;
  return (req.headers.accept || '').includes('text/html');
}

/**
 * Security headers for every response, in every environment.
 *
 * HSTS is the sole exception and stays production-only: asserting it from a
 * deployment reachable over plain HTTP achieves nothing and pins the hostname
 * if that host later gets TLS.
 */
export function buildSecurityHeaders(configService?: ConfigService): RequestHandler {
  const logger = new Logger('SecurityHeaders');
  const isProduction = process.env.NODE_ENV === 'production';
  const cspMode = resolveCspMode(process.env.SECURITY_HEADERS_CSP, logger);
  const csp = buildContentSecurityPolicy({
    oidcIssuer: process.env.OIDC_ISSUER,
    oidcDomain: process.env.OIDC_DOMAIN,
  });

  // Read the playground flag from the config that actually drives Apollo rather
  // than re-deriving it from NODE_ENV, so the exemption cannot outlive the page
  // it exists for.
  const playgroundEnabled = configService?.get<GqlConfig>('gql')?.playground ?? !isProduction;

  const cspHeader =
    cspMode === 'report-only' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';

  if (cspMode !== 'enforce') {
    logger.warn(`Content-Security-Policy is ${cspMode} (SECURITY_HEADERS_CSP).`);
  }

  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    if (isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    if (cspMode !== 'off' && !isPlaygroundPage(req, playgroundEnabled)) {
      res.setHeader(cspHeader, csp);
    }
    next();
  };
}
