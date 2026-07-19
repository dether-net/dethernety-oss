import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CustomResolverModule } from './custom-resolver.module';
import { GQL_SCHEMA } from './resolvers.constants';
import { DatabaseModule } from '../database/database.module';
import { SchemaModule } from './schema.module';
import { GqlHealthService } from './health/gql-health.service';
import { GraphQLSseController } from './sse/graphql-sse.controller';
import gqlConfig, { GqlConfig } from './gql.config';
import { Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { createGraphQLContextFactory } from './utils/graphql-context.factory';
import {
  assertComplexityWithinLimit,
  buildValidationRules,
} from './utils/query-guards';

@Module({
  imports: [
    ConfigModule.forFeature(gqlConfig),
    DatabaseModule,
    CustomResolverModule,
    SchemaModule,
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      // The schema itself is built ONCE by SchemaModule's GQL_SCHEMA
      // provider (modules + fragments + resolvers) and shared with the SSE
      // transport and the health probe — this factory only wires Apollo
      // config around it.
      imports: [ConfigModule, SchemaModule],
      inject: [ConfigService, GQL_SCHEMA, 'NEO4J_DRIVER'],
      useFactory: async (
        configService: ConfigService,
        schema: any,
        neo4jDriver: any,
      ) => {
        // Instantiate JwtAuthGuard here rather than injecting it: GraphQLModule
        // .forRootAsync has its own DI scope (see `imports:` above), and
        // exposing the guard there would require wrapping it in a module just
        // for that purpose. The guard's only constructor dep is ConfigService.
        const jwtAuthGuard = new JwtAuthGuard(configService);
        const logger = new Logger('GqlModule');
        const config = configService.get<GqlConfig>('gql')!;

        try {
          logger.log('Initializing GraphQL module...');

          // Security rules — shared with the SSE transport (query-guards).
          const validationRules = buildValidationRules(config);

          const useWebSocket = config.subscriptionTransport === 'ws';

          logger.log('GraphQL module initialized successfully', {
            playground: config.playground,
            introspection: config.introspection,
            subscriptions: useWebSocket ? 'WebSocket (graphql-ws)' : 'SSE (via /graphql/stream)',
            queryLimits: {
              depth: config.queryDepthLimit,
              complexity: config.queryComplexityLimit,
            },
          });

          // Query complexity plugin — runs per-request with variables available.
          // Using a static validation rule (createComplexityRule) fails because
          // the validation phase doesn't have access to request variables yet.
          // The check itself is the shared query-guards implementation.
          const complexityPlugin = config.queryComplexityLimit > 0
            ? {
                async requestDidStart() {
                  return {
                    async didResolveOperation(requestContext: any) {
                      const { request, document } = requestContext;
                      assertComplexityWithinLimit({
                        schema,
                        operationName: request.operationName,
                        document,
                        variables: request.variables,
                        limit: config.queryComplexityLimit,
                      });
                    },
                  };
                },
              }
            : null;

          return {
            schema,
            playground: config.playground,
            introspection: config.introspection,
            validationRules,
            plugins: complexityPlugin ? [complexityPlugin] : [],
            // WebSocket subscriptions - only enabled when SUBSCRIPTION_TRANSPORT=ws
            // SSE is always available via /graphql/stream endpoint
            subscriptions: useWebSocket && config.enableSubscriptions
              ? {
                  'graphql-ws': true,
                }
              : undefined,
            context: createGraphQLContextFactory({ configService, jwtAuthGuard, neo4jDriver }),
            formatError: (error: any) => {
              logger.error('GraphQL Error:', {
                message: error.message,
                path: error.path,
                extensions: error.extensions,
              });
              
              // Don't expose internal errors in production
              if (process.env.NODE_ENV === 'production') {
                return {
                  message: 'Internal server error',
                  extensions: {
                    code: error.extensions?.code || 'INTERNAL_ERROR',
                  },
                };
              }
              return error;
            },
          };
        } catch (error) {
          logger.error('Failed to initialize GraphQL module:', error);
          throw error;
        }
      },
    }),
  ],
  controllers: [
    GraphQLSseController, // SSE endpoint for GraphQL subscriptions
  ],
  providers: [
    GqlHealthService,
  ],
  exports: [
    SchemaModule, // Re-exports SchemaService + GQL_SCHEMA
    GqlHealthService,
    CustomResolverModule, // Re-export all services from CustomResolverModule
  ],
})
export class GqlModule {}
