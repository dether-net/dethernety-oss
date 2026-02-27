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
import * as jwt from 'jsonwebtoken';
import * as jwksClient from 'jwks-rsa';

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
      this.jwksClientInstance = jwksClient({
        jwksUri: this.config.oidcJwksUri,
        cache: true,
        cacheMaxAge: 600000, // 10 minutes
        rateLimit: true,
        jwksRequestsPerMinute: 5,
      });
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

      // If no OIDC is configured, bypass JWT validation (development mode)
      if (!this.config?.oidcJwksUri) {
        if (process.env.NODE_ENV === 'production') {
          this.logger.error(
            'SECURITY WARNING: No OIDC configuration provided in production mode. ' +
            'All requests will be unauthenticated. Set OIDC_JKWS_URI to enable JWT validation.'
          );
        }
        this.logger.log('JWT validation bypassed - no OIDC configuration (development mode)');

        // Add mock user info to request
        request['user'] = { sub: 'dev-user', email: 'dev@example.com', roles: [], permissions: [] };
        request['token'] = token || 'dev-token';

        return true;
      }

      if (!token) {
        throw new UnauthorizedException('No token provided');
      }

      const payload = await this.validateToken(token);
      
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
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }

  private async validateToken(token: string): Promise<any> {
    // If no OIDC configuration, skip validation (development mode)
    if (!this.config.oidcJwksUri || !this.jwksClientInstance) {
      this.logger.warn('JWT validation skipped - no OIDC configuration', { token: token.substring(0, 10) + '...' });
      return { sub: 'dev-user', email: 'dev@example.com', roles: [], permissions: [] };
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

        // Verify token with optional issuer/audience validation
        const verifyOptions: jwt.VerifyOptions = {
          algorithms: ['RS256'],
        };
        if (this.config.oidcIssuer) {
          verifyOptions.issuer = this.config.oidcIssuer;
        }
        if (this.config.oidcAudience) {
          verifyOptions.audience = this.config.oidcAudience;
        }
        jwt.verify(token, signingKey, verifyOptions, (verifyErr, payload) => {
          if (verifyErr) {
            return reject(new Error(`Token verification failed: ${verifyErr.message}`));
          }
          resolve(payload);
        });
      });
    });
  }
}
