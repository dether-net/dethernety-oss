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

The backend sets the following headers on all responses:

| Header | Value |
|--------|-------|
| Content-Security-Policy | `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'` |
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` |
| X-Frame-Options | `DENY` |
| X-Content-Type-Options | `nosniff` |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| Permissions-Policy | `camera=(), microphone=(), geolocation=()` |

**Known trade-off:** The CSP includes `'unsafe-inline'` for `style-src` because Vuetify (the UI framework) injects inline styles at runtime. Removing this would require a Vuetify configuration change or a nonce-based CSP approach.

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
