# Security Model

This document describes how Dethernety protects itself and user data. It covers the security architecture, defaults, and known trade-offs. For reporting vulnerabilities, see [SECURITY.md](../SECURITY.md).

---

## Overview

Dethernety uses a defense-in-depth approach with four independent layers: authentication, API protection, module security, and data protection. Each layer operates independently -- a bypass in one layer is caught by the next. This is an intentional design choice documented in [ADR-006](architecture/decisions/006-defense-in-depth-security.md).

---

## Authentication

The platform delegates authentication to an external OIDC identity provider. It does not store passwords or manage user accounts.

**How it works:**

1. The frontend initiates an OAuth2 Authorization Code flow with PKCE (RFC 7636). PKCE is used because the frontend is a public SPA that cannot securely store client secrets.
2. The identity provider authenticates the user and returns an authorization code.
3. The frontend exchanges the code for JWT tokens (ID token + access token).
4. Every request to the backend includes the JWT in the `Authorization` header.
5. The backend validates the JWT signature against the provider's JWKS endpoint using RS256.

**Provider support:** Cognito, Keycloak, Auth0, Zitadel, and any generic OIDC-compliant provider. Provider presets auto-configure endpoint paths and token claim names. See the [Configuration guide](CONFIGURATION_GUIDE.md) for setup.

**JWKS caching:** The backend caches JWKS keys and refreshes them on a rate-limited schedule to avoid overwhelming the identity provider during key rotation.

**Development mode:** OIDC can be disabled for local development. In production, the environment validation (`environment.validation.ts`) requires all OIDC variables to be configured.

---

## Authorization

All GraphQL types, queries, and mutations in the schema carry the `@authentication` directive, which rejects requests without a valid JWT at the schema level.

Separately, the NestJS `JwtAuthGuard` protects HTTP-level endpoints -- the SSE subscription controller and any non-GraphQL routes. This means authentication is enforced at two layers: the GraphQL schema and the HTTP controller.

In production, the environment validation enforces OIDC configuration. When OIDC is not configured (development mode), `@authentication` directives have no effect and the guard is not active.

---

## Deployment access control

Beyond authenticating users, a deployment can restrict *which* authenticated users it serves. This matters when several deployments share one multi-tenant identity provider: every user in the pool holds a signature-valid token, but a given deployment should serve only its own users.

- **Access allowlist.** `DEPLOYMENT_ALLOWLIST` is a set of token `sub` values the deployment serves (empty/unset = unrestricted, the default — existing deployments are unaffected). A validated-but-unlisted user is rejected on every transport: the GraphQL context factory withholds the credential on the HTTP/WS path, and the `JwtAuthGuard` throws the same `401` as an invalid token on the SSE/REST path — so rejection is indistinguishable from an invalid token (no oracle). Because the schema-layer `@authentication` re-verifies a raw bearer by signature alone as a fallback, the factory clears the raw token, not just the decoded user.
- **Fail-closed bootstrap.** A deployment declared against a shared / multi-tenant IdP (`OIDC_SHARED_POOL=true`) refuses to start if it is network-reachable (`DEPLOYMENT_EXPOSURE=network`) with an empty allowlist, or if `OIDC_AUDIENCE` is unset (without an audience, token validation is signature-only and cannot reject a token minted for another deployment). A loopback-only or auth-disabled development deployment is exempt. See the [Configuration guide](CONFIGURATION_GUIDE.md#deployment-access-multi-tenant-idp).

---

## API protection

### Query limits

GraphQL's flexibility is also an attack vector -- a deeply nested or computationally expensive query can exhaust server resources. The platform enforces:

| Protection | Default | Configurable |
|------------|---------|--------------|
| Query depth limit | 10 | `GQL_QUERY_DEPTH_LIMIT` (1--50) |
| Query complexity limit | 1,000 | `GQL_QUERY_COMPLEXITY_LIMIT` (100--10,000) |
| Request body size | 1 MB | NestJS body parser config |

These defaults are conservative. Deployments with complex modules may need to increase the complexity limit.

### Input validation

A global NestJS validation pipe runs on all incoming requests with `whitelist: true`, stripping unexpected properties. Individual resolvers validate parameters (UUID format for IDs, string length limits, enum membership).

### HTTP security headers

The backend sets the following headers, in every environment:

| Header | Value | Applies |
|--------|-------|---------|
| Content-Security-Policy | `default-src 'self'; script-src 'self' blob: 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' <OIDC origins>; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; worker-src 'none'` | always, except the GraphQL playground page (see below) |
| X-Frame-Options | `DENY` | always |
| X-Content-Type-Options | `nosniff` | always |
| Referrer-Policy | `strict-origin-when-cross-origin` | always |
| Permissions-Policy | `geolocation=(), microphone=(), camera=()` | always |
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` | production only |

`connect-src` is assembled at startup from `OIDC_ISSUER` and `OIDC_DOMAIN`, so the
identity provider's origin is permitted without widening the policy for anything else.

**HSTS is deliberately production-only.** Asserting it from a deployment reachable over
plain HTTP achieves nothing, and pins the hostname if that host later gets TLS. Every
other header applies everywhere, including single-host and self-hosted installs.

**Known trade-offs.** Three directives are wider than they look, each for a concrete
reason:

- `'unsafe-inline'` in `style-src`, because Vuetify injects inline styles at runtime.
  Removing it would need a Vuetify configuration change or a nonce-based policy.
- `blob:` in `script-src`, because the frontend loads each module's UI bundle by
  importing a blob URL. This is a real weakening — the application executes
  server-supplied JavaScript by design — and the durable fix is to serve bundles from a
  same-origin URL, which requires the bundle route to stop requiring a bearer token.
  Without `blob:` the application loads with no module UIs at all.
- `'unsafe-eval'` in `script-src`, because the dynamic-form layer compiles JSON Schema
  validators with the `Function` constructor at runtime. Schemas arrive from modules at
  runtime, so they cannot be precompiled during the build, and the validator is not
  pluggable. Without it, every schema-driven form — element attributes, module
  configuration, issue detail — fails while being constructed and renders empty.

What the policy still buys with those three in place: no external script hosts, no
inline `<script>`, no plugins or objects, no framing, no off-origin form submission, and
network access restricted to the application's own origin plus the identity provider.

`worker-src 'none'` is explicit because `worker-src` falls back to `script-src`, which
would otherwise inherit `blob:` and permit blob-backed workers. The application uses
none.

**The GraphQL playground page**, served only when the playground is enabled, is exempt
from the CSP header alone. It ships a nonce-less inline script and loads its bundle from
a CDN, so admitting it would require `'unsafe-inline'` on every other route. The
remaining headers still apply to it. The exemption follows the playground's own
configuration flag, so it cannot outlive the page it exists for.

**`SECURITY_HEADERS_CSP`** controls delivery of the CSP only: `enforce` (default),
`report-only` (send `Content-Security-Policy-Report-Only` instead, so violations are
visible in the browser console without blocking), or `off`. It exists because a policy
that blocks a needed script produces an empty page with no server-side signal, and an
install without an update channel would otherwise need a full image rebuild to recover.
An unrecognised value falls back to `enforce`. The other headers are unconditional.

---

## Module security

Modules are executable code loaded into the server process. The following controls constrain what gets loaded:

- **Allowlist:** The `ALLOWED_MODULES` environment variable specifies which modules can be loaded. Supports exact names, prefix patterns (`mitre-*`), or `*` (wildcard, not recommended in production). Required in production.
- **File permission checks:** The module loader rejects world-writable module files.
- **Size limit:** 10 MB per module.
- **Load timeout:** Configurable (default 30s, `MODULE_LOAD_TIMEOUT`). Modules that take longer to initialize are rejected.
- **Interface validation:** Loaded modules must implement the `DTModule` interface. The registry validates method signatures before registration.

Modules run in the same Node.js process as the server. There is no process-level sandboxing. The allowlist and file checks are the primary defense -- only load modules you trust.

---

## Input validation and data protection

### Path confinement

File operations (model export, model import, MCP file tools) validate that paths resolve within allowed directories. Path traversal attempts (`../`) are rejected.

### Element ID validation

Element IDs are validated as UUID format before use in Cypher queries. This prevents injection through ID parameters.

### Error handling in production

In production (`NODE_ENV=production`), error responses are masked:
- Error messages are replaced with "Internal server error"
- Stack traces are not included
- Internal file paths are not exposed
- Extension codes are included for client-side error handling

In development, full error details are returned to aid debugging.

---

## CI/CD security

The GitHub repository runs automated security checks on every pull request:

- **CodeQL analysis** -- Static analysis for common vulnerability patterns (injection, XSS, unsafe deserialization)
- **Dependency auditing** -- `pnpm audit` checks for known vulnerabilities in dependencies
- **Security review workflow** -- Automated review triggered on PRs that touch security-relevant files (guards, auth, validation, environment config)

---

## Pre-release security assessment

Before the initial OSS release, the codebase went through 12 iterations of security assessment covering authentication, GraphQL API, MCP/file operations, frontend, module system, and infrastructure configuration. These assessments identified and fixed 67+ issues across severity levels.

The assessment process combined pattern-based scanning (secret detection, static analysis) with targeted code review of each security layer. Assessment reports are maintained internally and inform ongoing security improvements.

---

## Reporting vulnerabilities

See [SECURITY.md](../SECURITY.md) for how to report vulnerabilities, response timelines, and scope.
