import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { GqlConfig } from '../../gql/gql.config';
import { extractBearerToken } from '../utils/extract-bearer-token';
import * as jwt from 'jsonwebtoken';
import * as jwksClient from 'jwks-rsa';
import { createJwksFetcher } from './jwks-fetcher';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private readonly config: GqlConfig;
  private jwksClientInstance: jwksClient.JwksClient | null = null;

  constructor(private readonly configService: ConfigService) {
    this.config = this.configService.get<GqlConfig>('gql')!;

    this.logger.log('JWT Guard initialized', {
      oidcJwksUri: this.config.oidcJwksUri,
      hasOidcConfig: !!this.config.oidcJwksUri,
      nodeEnv: process.env.NODE_ENV,
    });

    // Initialize JWKS client if OIDC is configured
    if (this.config.oidcJwksUri) {
      const jwksOptions: jwksClient.Options = {
        jwksUri: this.config.oidcJwksUri,
        cache: true,
        cacheMaxAge: 600000, // 10 minutes
        rateLimit: true,
        jwksRequestsPerMinute: 5,
      };

      // Node adds NODE_EXTRA_CA_CERTS to its default roots at start, and global fetch uses them.
      jwksOptions.fetcher = createJwksFetcher();

      this.jwksClientInstance = jwksClient(jwksOptions);
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const request = context.switchToHttp().getRequest<Request>();
      const token = this.extractTokenFromHeader(request);

      this.logger.debug('JWT Guard canActivate called', {
        hasToken: !!token,
        hasOidcConfig: !!this.config?.oidcJwksUri,
        nodeEnv: process.env.NODE_ENV || 'undefined'
      });

      // If no OIDC is configured, handle based on environment
      if (!this.config?.oidcJwksUri) {
        if (process.env.NODE_ENV === 'production') {
          this.logger.error(
            'SECURITY: No OIDC configuration in production mode. ' +
            'Rejecting request. Set OIDC_JWKS_URI to enable JWT validation.'
          );
          throw new UnauthorizedException(
            'Authentication service not configured. Contact your administrator.'
          );
        }
        this.logger.log('JWT validation bypassed - no OIDC configuration (development mode)');

        // Add mock user info to request (development only).
        // The dev mock user carries `roles: ['admin']` so admin-gated
        // GraphQL operations are reachable from local / single-user deployments
        // without an IdP. Production paths flow through the JWT validation
        // branch and never touch this mock.
        request['user'] = { sub: 'dev-user', email: 'dev@example.com', roles: ['admin'], permissions: [] };
        request['token'] = token || 'dev-token';

        return true;
      }

      if (!token) {
        throw new UnauthorizedException('No token provided');
      }

      const payload = await this.validateToken(token);

      // Deployment allowlist. Same 401 as an invalid token — no oracle
      // revealing that a valid-but-unlisted token is genuine.
      if (!this.assertAllowlisted(payload)) {
        throw new UnauthorizedException('Invalid token');
      }

      // Add user info to request for potential future use
      request['user'] = payload;
      request['token'] = token;
      
      return true;
    } catch (error) {
      this.logger.error('JWT validation failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      
      throw new UnauthorizedException('Invalid token');
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    return extractBearerToken(request.headers.authorization);
  }

  /**
   * Decode the JWT user payload from an Authorization header without throwing.
   *
   * Used by the GraphQL HTTP context factory, which runs outside Nest's guard
   * chain (Apollo handles POST /graphql directly, no @UseGuards available).
   * Mirrors canActivate's branching:
   *   - no-auth (no OIDC, non-prod) → mock user with `roles: ['admin']`
   *   - prod / OIDC configured → validateToken (full JWKS signature check)
   *   - invalid / missing token → undefined (resolver-side gates handle it)
   */
  async decodeUserFromAuthHeader(authHeader: string | undefined): Promise<any | undefined> {
    const token = extractBearerToken(authHeader);

    if (!this.config?.oidcJwksUri) {
      if (process.env.NODE_ENV === 'production') return undefined;
      return { sub: 'dev-user', email: 'dev@example.com', roles: ['admin'], permissions: [] };
    }

    if (!token) return undefined;

    try {
      return await this.validateToken(token);
    } catch (err) {
      this.logger.debug('GraphQL context: JWT decode failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }

  /**
   * Deployment access allowlist. Returns true when the caller's `sub` is
   * permitted on THIS deployment. An empty/unset allowlist means unrestricted.
   * Keys on the `sub` claim ONLY (never email or any other claim).
   *
   * Public because the GraphQL context factory calls it directly: it runs outside
   * Nest's guard chain and must apply the same gate on the HTTP/WS soft path.
   */
  assertAllowlisted(payload: Record<string, any>): boolean {
    const list = this.config?.accessAllowlist;
    if (!list || list.length === 0) return true;
    return list.includes(payload?.sub);
  }

  private async validateToken(token: string): Promise<any> {
    // If no OIDC configuration, handle based on environment
    if (!this.config.oidcJwksUri || !this.jwksClientInstance) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error('SECURITY: validateToken called without OIDC configuration in production');
        throw new UnauthorizedException(
          'Authentication service not configured. Contact your administrator.'
        );
      }
      this.logger.warn('JWT validation skipped - no OIDC configuration (development mode)');
      // Dev mock user gets admin role; see canActivate() comment.
      return { sub: 'dev-user', email: 'dev@example.com', roles: ['admin'], permissions: [] };
    }

    return new Promise((resolve, reject) => {
      // Decode token to get header
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || !decoded.header || !decoded.header.kid) {
        return reject(new Error('Invalid token format'));
      }

      // Get signing key
      this.jwksClientInstance!.getSigningKey(decoded.header.kid, (err, key) => {
        if (err) {
          return reject(new Error(`Failed to get signing key: ${err.message}`));
        }

        const signingKey = key.getPublicKey();

        // Verify token with optional issuer validation
        // Note: audience is validated manually after verification because
        // Cognito access tokens use `client_id` instead of `aud`.
        const verifyOptions: jwt.VerifyOptions = {
          algorithms: ['RS256'],
        };
        if (this.config.oidcIssuer) {
          verifyOptions.issuer = this.config.oidcIssuer;
        }
        jwt.verify(token, signingKey, verifyOptions, (verifyErr, payload: any) => {
          if (verifyErr) {
            return reject(new Error(`Token verification failed: ${verifyErr.message}`));
          }
          // Validate audience: check `aud` (ID tokens) or `client_id` (access tokens)
          if (this.config.oidcAudience) {
            const tokenAudience = payload.aud || payload.client_id;
            if (tokenAudience !== this.config.oidcAudience) {
              return reject(new Error(
                `Token audience mismatch: got ${tokenAudience}, expected ${this.config.oidcAudience}`
              ));
            }
          }
          resolve(payload);
        });
      });
    });
  }
}
