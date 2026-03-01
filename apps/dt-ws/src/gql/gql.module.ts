import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CustomResolverModule } from './custom-resolver.module';
import { RESOLVER_SERVICES } from './resolvers.constants';
import { DatabaseModule } from '../database/database.module';
import { SchemaService } from './services/schema.service';
import { GqlHealthService } from './health/gql-health.service';
import { GraphQLSseController } from './sse/graphql-sse.controller';
import { ResolverService, GraphQLContext } from './interfaces/resolver.interface';
import gqlConfig, { GqlConfig } from './gql.config';
import { Logger } from '@nestjs/common';
import { extractBearerToken } from '../common/utils/extract-bearer-token';
import * as _depthLimitModule from 'graphql-depth-limit';
const depthLimit = (_depthLimitModule as any).default || _depthLimitModule;
import { getComplexity, simpleEstimator } from 'graphql-query-complexity';

@Module({
  imports: [
    ConfigModule.forFeature(gqlConfig),
    DatabaseModule,
    CustomResolverModule,
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [ConfigModule, CustomResolverModule],
      inject: [ConfigService, RESOLVER_SERVICES, 'NEO4J_DRIVER'],
      useFactory: async (
        configService: ConfigService,
        resolverServices: ResolverService[],
        neo4jDriver: any,
      ) => {
        const logger = new Logger('GqlModule');
        const config = configService.get<GqlConfig>('gql')!;

        try {
          logger.log('Initializing GraphQL module...');

          // Create schema service instance
          const schemaService = new SchemaService(configService, neo4jDriver);

          // Merge custom resolvers
          const customResolvers = schemaService.mergeResolvers(resolverServices);

          // Get the schema with custom resolvers
          const schema = await schemaService.buildSchemaWithResolvers(customResolvers);

          // Security rules for production
          const validationRules = [];
          if (config.queryDepthLimit > 0) {
            const depthRule = depthLimit(config.queryDepthLimit);
            if (depthRule) validationRules.push(depthRule);
          }

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
          const complexityPlugin = config.queryComplexityLimit > 0
            ? {
                async requestDidStart() {
                  return {
                    async didResolveOperation(requestContext: any) {
                      const { request, document } = requestContext;
                      const complexity = getComplexity({
                        schema,
                        operationName: request.operationName,
                        query: document,
                        variables: request.variables || {},
                        estimators: [simpleEstimator({ defaultComplexity: 1 })],
                      });
                      if (complexity > config.queryComplexityLimit) {
                        throw new Error(
                          `Query too complex: ${complexity}. Maximum allowed: ${config.queryComplexityLimit}`,
                        );
                      }
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
            context: ({ req, connection }): GraphQLContext => {
              const databaseName = configService.get('database.name') || 'neo4j';

              // WebSocket connection (subscription via graphql-ws)
              if (connection) {
                const token = extractBearerToken(connection.context?.Authorization);
                return {
                  token,
                  jwt: token,
                  driver: neo4jDriver,
                  sessionConfig: { database: databaseName },
                  cypherQueryOptions: { addVersionPrefix: false },
                };
              }

              // HTTP request (query/mutation, or SSE subscription)
              if (req) {
                const token = extractBearerToken(req.headers?.authorization);
                return {
                  token,
                  jwt: token, // Neo4j GraphQL expects 'jwt' field
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
            },
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
    SchemaService,
    GqlHealthService,
  ],
  exports: [
    SchemaService,
    GqlHealthService,
    CustomResolverModule, // Re-export all services from CustomResolverModule
  ],
})
export class GqlModule {}
