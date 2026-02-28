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
import * as https from 'https';
import * as fs from 'fs';

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

      // If NODE_EXTRA_CA_CERTS is set, create a custom HTTPS agent
      // that includes the extra CA certificates (e.g., for self-signed Zitadel).
      // NODE_EXTRA_CA_CERTS may point to a server cert; we also look for the
      // root CA in the same directory (root.crt) and load all certs found.
      const extraCaCertsPath = process.env.NODE_EXTRA_CA_CERTS;
      if (extraCaCertsPath) {
        try {
          const caCerts: Buffer[] = [];
          const certDir = require('path').dirname(extraCaCertsPath);

          // Load the configured cert
          caCerts.push(fs.readFileSync(extraCaCertsPath));

          // Also load root.crt from the same directory if it exists
          const rootCertPath = require('path').join(certDir, 'root.crt');
          if (rootCertPath !== extraCaCertsPath && fs.existsSync(rootCertPath)) {
            caCerts.push(fs.readFileSync(rootCertPath));
            this.logger.log('JWKS client loaded root CA', { path: rootCertPath });
          }

          jwksOptions.requestAgent = new https.Agent({ ca: caCerts });
          this.logger.log('JWKS client using extra CA certificates', { path: extraCaCertsPath, totalCerts: caCerts.length });
        } catch (err) {
          this.logger.warn('Failed to load extra CA certificates for JWKS client', {
            path: extraCaCertsPath,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

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
            'Rejecting request. Set OIDC_JKWS_URI to enable JWT validation.'
          );
          throw new UnauthorizedException(
            'Authentication service not configured. Contact your administrator.'
          );
        }
        this.logger.log('JWT validation bypassed - no OIDC configuration (development mode)');

        // Add mock user info to request (development only)
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
    return extractBearerToken(request.headers.authorization);
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
