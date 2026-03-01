# ADR-006: Defense-in-depth security

**Status:** Accepted
**Date:** 2025-01-15

## Context

Dethernety is a security tool. Users will evaluate its own security posture before trusting it with their threat models and architecture data. A single authentication layer is not sufficient -- if the OIDC provider is misconfigured or a JWT validation bug is introduced, the entire application would be exposed.

The platform accepts user-supplied content (model names, descriptions, component attributes), loads executable modules at runtime, and runs queries against a graph database. Each of these is an attack surface.

## Decision

Implement four layered security controls, each independent of the others:

**Layer 1 -- Authentication:** OIDC/JWT with RS256 signature verification against the provider's JWKS endpoint. PKCE flow for public clients. The `@authentication` directive on all GraphQL types ensures schema-level enforcement. The `JwtAuthGuard` on NestJS controllers provides a second check at the HTTP layer. In production, the environment validation requires OIDC configuration.

**Layer 2 -- API protection:** GraphQL query depth limiting (default 10), query complexity scoring (default 1,000), request body size limits (1MB), and a global validation pipe with whitelist mode. HTTP security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy).

**Layer 3 -- Module security:** Module loading restricted to an allowlist (`ALLOWED_MODULES`). File permission checks reject world-writable module files. 10MB size limit per module. Configurable load timeout (default 30s). Interface validation before registration.

**Layer 4 -- Data protection:** Per-resolver input validation. UUID format validation for element IDs. Path confinement for file operations (model export/import). Production error masking (no stack traces or internal paths in responses).

## Consequences

**Positive:**
- No single vulnerability compromises the entire system. A bypass in one layer is caught by another. For example, if `@authentication` is bypassed, `JwtAuthGuard` still protects the HTTP layer.
- Each layer can be tested independently. API protection works regardless of whether authentication is configured.
- The approach is auditable -- the 12-iteration pre-release security assessment verified each layer independently.

**Negative:**
- Four security layers add complexity. Developers working on resolvers need to understand which layer handles what (schema directive vs. guard vs. validation pipe).
- Some protections overlap deliberately (authentication at both schema and HTTP level). This redundancy is intentional but can confuse contributors who see it as duplication.
- Default limits (depth 10, complexity 1,000) may be too restrictive for some deployments. Operators need to tune these based on their module complexity.

## References

- [Security model](../../SECURITY_MODEL.md)
- [Configuration guide](../../CONFIGURATION_GUIDE.md) -- GraphQL and module settings
- [Platform architecture](../README.md) -- Security Architecture section
