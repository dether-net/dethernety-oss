import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Neo4jGraphQL } from '@neo4j/graphql';
import * as fs from 'fs/promises';
import { accessSync } from 'fs';
import * as path from 'path';
import { ResolverService, ResolverMap, SchemaService as ISchemaService } from '../interfaces/resolver.interface';
import { GqlConfig } from '../gql.config';

@Injectable()
export class SchemaService implements ISchemaService {
  private readonly logger = new Logger(SchemaService.name);
  private schema: any;
  private readonly config: GqlConfig;
  
  // Build-time constants — schema files are part of the application codebase
  private readonly SCHEMA_PATH = 'schema/schema.graphql';
  private readonly SCHEMA_NOAUTH_PATH = 'schema/schema-noauth.graphql';

  constructor(
    private readonly configService: ConfigService,
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
  ) {
    this.config = this.configService.get<GqlConfig>('gql')!;
  }

  async getSchema(): Promise<any> {
    if (!this.schema) {
      this.schema = await this.buildSchemaWithResolvers({});
    }
    return this.schema;
  }

  async validateSchema(): Promise<boolean> {
    try {
      await this.getSchema();
      return true;
    } catch (error) {
      this.logger.error('Schema validation failed', error);
      return false;
    }
  }

  async buildSchemaWithResolvers(customResolvers: ResolverMap): Promise<any> {
    try {
      this.logger.log('Building GraphQL schema with custom resolvers...');
      
      // Load and validate schema file
      const typeDefs = await this.loadSchemaFile();
      
      // Validate Neo4j connection
      await this.validateNeo4jConnection();

      const features: any = {};

      // NOTE: Neo4j GraphQL v7's CDC-based subscriptions are disabled for Memgraph compatibility
      // Custom subscription resolvers (like streamResponse) still work via PubSub and Apollo Server WebSockets
      // Memgraph doesn't support CDC (db.cdc.current procedure) required by features.subscriptions
      // DO NOT enable this unless using Neo4j Enterprise with CDC enabled in FULL mode
      // if (this.config.enableSubscriptions) {
      //   features.subscriptions = true;
      // }

      // Add authorization if OIDC is configured
      if (this.config.oidcJwksUri) {
        features.authorization = {
          key: {
            url: this.config.oidcJwksUri,
          }
        };
      } else {
        this.logger.warn(
          'OIDC JWKS URI not configured — @authentication directives in the schema will not be enforced. ' +
          'Set OIDC_JWKS_URI to enable schema-level authentication.',
        );
      }

      const neoSchema = new Neo4jGraphQL({
        typeDefs,
        resolvers: customResolvers,
        driver: this.neo4jDriver,
        features,
      });

      const schema = await neoSchema.getSchema();
      this.logger.log('GraphQL schema built successfully with custom resolvers');
      return schema;

    } catch (error) {
      this.logger.error('Failed to build GraphQL schema', {
        error: error?.message || error,
        stack: error?.stack,
        fullError: error,
      });
      throw new Error(`Schema build failed: ${error?.message || JSON.stringify(error)}`);
    }
  }

  /**
   * Resolve which schema file to load.
   *
   * Uses schema-noauth.graphql (no @authentication directives) ONLY when
   * all three conditions are met:
   *   1. NODE_ENV is NOT 'production'
   *   2. OIDC is NOT configured
   *   3. ENABLE_NOAUTH is explicitly set to 'true'
   *
   * The platform is secure by default — disabling auth requires deliberate
   * opt-in via ENABLE_NOAUTH=true.
   */
  private resolveSchemaPath(): string {
    const isProduction = process.env.NODE_ENV === 'production';
    const oidcConfigured = !!this.config.oidcJwksUri;
    const noauthEnabled = !!this.config.enableNoauth;

    if (!isProduction && !oidcConfigured && noauthEnabled) {
      const noauthAbsolute = path.join(process.cwd(), this.SCHEMA_NOAUTH_PATH);
      try {
        // Synchronous existence check — runs once at startup
        accessSync(noauthAbsolute);
        this.logger.warn(
          'ENABLE_NOAUTH is set — using schema-noauth.graphql (authentication disabled)',
        );
        return this.SCHEMA_NOAUTH_PATH;
      } catch {
        this.logger.warn(
          'ENABLE_NOAUTH is set but schema-noauth.graphql not found — falling back to schema.graphql. ' +
          'Run "node scripts/generate-noauth-schema.js" to generate it.',
        );
      }
    }

    return this.SCHEMA_PATH;
  }

  private async loadSchemaFile(): Promise<string> {
    const schemaRelPath = this.resolveSchemaPath();
    try {
      const schemaPath = path.join(process.cwd(), schemaRelPath);
      const typeDefs = await fs.readFile(schemaPath, 'utf8');

      if (!typeDefs.trim()) {
        throw new Error('Schema file is empty');
      }

      this.logger.log(`Schema loaded from: ${schemaPath}`);
      return typeDefs;
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Schema file not found: ${schemaRelPath}`);
      }
      throw new Error(`Failed to load schema file: ${error.message}`);
    }
  }

  private async validateNeo4jConnection(): Promise<void> {
    const session = this.neo4jDriver.session();
    try {
      await session.run('RETURN 1');
      this.logger.log('Neo4j connection validated');
    } catch (error) {
      throw new Error(`Neo4j connection failed: ${error.message}`);
    } finally {
      await session.close();
    }
  }

  mergeResolvers(resolverServices: ResolverService[]): ResolverMap {
    const customResolvers: ResolverMap = {};

    for (const service of resolverServices) {
      try {
        const serviceResolvers = service.getResolvers();

        for (const [typeName, resolverFields] of Object.entries(serviceResolvers)) {
          if (!customResolvers[typeName]) {
            customResolvers[typeName] = {};
          }
          
          // Check for resolver conflicts
          const conflicts = Object.keys(resolverFields).filter(
            field => customResolvers[typeName][field]
          );
          
          if (conflicts.length > 0) {
            this.logger.warn(`Resolver conflicts detected for ${typeName}:`, conflicts);
          }

          customResolvers[typeName] = {
            ...customResolvers[typeName],
            ...resolverFields,
          };
        }
      } catch (error) {
        this.logger.error(`Failed to merge resolvers from service:`, {
          service: service.constructor.name,
          error: error.message,
        });
        // Continue with other services rather than failing completely
      }
    }

    return customResolvers;
  }
}
