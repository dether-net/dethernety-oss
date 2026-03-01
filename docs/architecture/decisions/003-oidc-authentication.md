# ADR-003: OIDC authentication with multi-provider support

**Status:** Accepted
**Date:** 2025-01-15

## Context

The platform needs authentication for both hosted and self-hosted deployments. Users self-hosting may already have an identity provider (Keycloak, Auth0, Zitadel, AWS Cognito) and won't want to create accounts in yet another system. A built-in user database would mean we need to handle password storage, MFA, account recovery, and session management -- all areas where getting it wrong has direct security consequences.

The frontend is a public SPA (single-page application), so it cannot securely store client secrets.

## Decision

Use OpenID Connect (OIDC) for authentication, with PKCE (Proof Key for Code Exchange) for the authorization flow. The platform does not manage user credentials -- it delegates to an external identity provider.

Support multiple providers through provider presets that auto-configure OAuth2 endpoint paths and token claim names. Currently supported: Cognito, Keycloak, Auth0, Zitadel, and a generic OIDC preset. The backend validates JWTs against the provider's JWKS endpoint on every request using RS256 signature verification.

In development, OIDC can be disabled entirely. In production, the environment validation enforces that OIDC variables are configured.

## Consequences

**Positive:**
- No password storage, MFA implementation, or account recovery logic in the platform. The identity provider handles all of this.
- Self-hosted users connect their existing identity provider. No vendor lock-in.
- PKCE eliminates the need for client secrets in the SPA, which is the recommended approach for public clients per RFC 7636.
- Adding a new provider is a configuration change (preset mapping), not a code change.

**Negative:**
- The platform cannot function without an external OIDC provider. This adds a deployment dependency.
- Different providers have different token claim formats and endpoint conventions. The provider preset system handles this, but edge cases require testing per provider.
- JWKS key rotation must be handled correctly. The backend caches JWKS keys with rate-limited refresh to avoid hammering the provider endpoint.

## References

- [Frontend authentication](../frontend/LLD/AUTHENTICATION.md) -- OIDC/PKCE flow
- [Configuration guide](../../CONFIGURATION_GUIDE.md) -- OIDC settings
- [Security model](../../SECURITY_MODEL.md) -- Authentication layer
