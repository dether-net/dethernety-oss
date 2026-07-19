import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { extractBearerToken } from '../../common/utils/extract-bearer-token';
import { GraphQLContext } from '../interfaces/resolver.interface';

export interface GraphQLContextFactoryDeps {
  configService: ConfigService;
  jwtAuthGuard: JwtAuthGuard;
  neo4jDriver: any;
}

/**
 * Builds the per-request GraphQL context for the HTTP (query/mutation) and
 * WebSocket (subscription) transports served by the Apollo driver.
 *
 * SECURITY INVARIANT — `context.jwt` must only ever carry VERIFIED claims.
 * @neo4j/graphql treats a truthy `context.jwt` as already-verified and marks
 * the request authenticated without any further signature check. The raw,
 * unverified bearer string therefore lives ONLY in `context.token`. When
 * `context.jwt` is falsy the library falls back to `context.token` and checks
 * its signature + expiry against JWKS — note this fallback does NOT enforce
 * audience/issuer, so it is weaker than `decodeUserFromAuthHeader` (which
 * does); prefer gating on `context.user`. `context.jwt` and `context.user`
 * both hold the payload returned by `decodeUserFromAuthHeader` — `undefined`
 * for an invalid/absent token, and the mock admin in the no-OIDC non-prod dev
 * mode.
 */
export function createGraphQLContextFactory(
  deps: GraphQLContextFactoryDeps,
): (args: { req?: any; connection?: any }) => Promise<GraphQLContext> {
  const { configService, jwtAuthGuard, neo4jDriver } = deps;

  return async ({ req, connection }): Promise<GraphQLContext> => {
    const databaseName = configService.get('database.name');

    // WebSocket connection (subscription via graphql-ws)
    if (connection) {
      const token = extractBearerToken(connection.context?.Authorization);
      const user = await jwtAuthGuard.decodeUserFromAuthHeader(connection.context?.Authorization);
      return {
        token,
        jwt: user, // VERIFIED claims only — never the raw bearer string
        user,
        driver: neo4jDriver,
        sessionConfig: { database: databaseName },
        cypherQueryOptions: { addVersionPrefix: false },
      };
    }

    // HTTP request (query/mutation, or SSE subscription).
    // Apollo handles POST /graphql directly — Nest's JwtAuthGuard
    // never runs here — so we decode the JWT inline to populate
    // ctx.user for resolver-side gates like requireAdmin().
    if (req) {
      const token = extractBearerToken(req.headers?.authorization);
      const user = await jwtAuthGuard.decodeUserFromAuthHeader(req.headers?.authorization);
      return {
        token,
        jwt: user, // VERIFIED claims only — never the raw bearer string
        user,
        driver: neo4jDriver,
        sessionConfig: { database: databaseName },
        cypherQueryOptions: { addVersionPrefix: false },
      };
    }

    // Fallback
    return {
      driver: neo4jDriver,
      sessionConfig: { database: databaseName },
      cypherQueryOptions: { addVersionPrefix: false },
    };
  };
}
