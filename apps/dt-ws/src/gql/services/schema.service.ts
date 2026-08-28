import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Neo4jGraphQL } from '@neo4j/graphql';
import { parse, GraphQLError } from 'graphql';
import * as fs from 'fs/promises';
import { accessSync } from 'fs';
import * as path from 'path';
import { ResolverService, ResolverMap, ResolverFunction, SchemaService as ISchemaService } from '../interfaces/resolver.interface';
import { GqlConfig } from '../gql.config';
import { populateAuthoredByOnCreate, stampCreatedByUserOnCreate } from '../populated-by/authored-by';

/**
 * Upstream refusal codes a module may surface, and the GraphQL code each maps to.
 *
 * Keyed on the error's `code` rather than on its class. These are values of the
 * remote-module wire vocabulary (see `@dethernety/dt-module`'s remote errors) —
 * a documented protocol constant — so the wrapper stays coupled to a contract
 * rather than to a class graph it cannot import safely. A mounted module is
 * loaded from the modules directory and may resolve its own copy of the module
 * library, which would make `instanceof` fail silently with nothing to catch it.
 *
 * A Map rather than an object literal, deliberately: `code` arrives from module
 * code, and a plain-object lookup on `'constructor'` or `'toString'` returns a
 * truthy prototype member and would map a nonsense code to a real one.
 *
 * Deliberately narrow. An entitlement refusal, an unreachable service and a bad
 * pin are operator problems, not credential problems, and stay MODULE_RESOLVER_ERROR.
 */
const UPSTREAM_REFUSAL_CODES = new Map<string, string>([
  ['invalid_token', 'UNAUTHENTICATED'],
  ['token_expired', 'UNAUTHENTICATED'],
]);

@Injectable()
export class SchemaService implements ISchemaService {
  private readonly logger = new Logger(SchemaService.name);
  private schema: any;
  private readonly config: GqlConfig;
  private moduleSchemaFragments: string[] = [];
  // True when the served schema is the base-only composition fallback
  // (module contributions present but uncomposable). Read by the health
  // probe so the degradation is observable, not silent.
  private degradedToBaseSchema = false;
  private readonly MODULE_RESOLVER_TIMEOUT_MS = 30_000;
  
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

  /** True when serving the base-only fallback (module surface dropped). */
  isSchemaDegraded(): boolean {
    return this.degradedToBaseSchema;
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

  /**
   * Builds the executable schema. When `moduleResolvers` are supplied they
   * are merged behind the platform resolvers (which win on conflict).
   *
   * Composition is fragment-tolerant: if the module-augmented type defs
   * fail to compose (a fragment that parses but collides at composition —
   * e.g. an unfiltered duplicate directive usage), the build falls back to
   * the BASE schema with platform resolvers only — module resolvers must
   * drop together with their types, or they would reference undefined
   * types. One pathological module degrades the module surface; it never
   * kills boot. A base-only failure is genuine and still throws.
   *
   * The successful schema is cached on the instance so getSchema() /
   * validateSchema() (the health probe) reuse the REAL served schema
   * instead of triggering a fragment-less rebuild.
   */
  async buildSchemaWithResolvers(
    customResolvers: ResolverMap,
    moduleResolvers: Array<{ moduleName: string; resolvers: ResolverMap }> = [],
  ): Promise<any> {
    try {
      this.logger.log('Building GraphQL schema with custom resolvers...');

      // Load and validate schema file, merge module fragments
      const baseTypeDefs = await this.loadSchemaFile();
      const typeDefs = this.mergeModuleSchemas(baseTypeDefs);

      // Validate Neo4j connection
      await this.validateNeo4jConnection();

      const hasModuleContributions =
        typeDefs !== baseTypeDefs || moduleResolvers.length > 0;
      const allResolvers = this.mergeModuleResolvers(
        customResolvers,
        moduleResolvers,
      );

      // Security-relevant warning — log once per build, not per compose
      // attempt (the fallback path composes twice).
      if (!this.config.oidcJwksUri) {
        this.logger.warn(
          'OIDC JWKS URI not configured — @authentication directives in the schema will not be enforced. ' +
          'Set OIDC_JWKS_URI to enable schema-level authentication.',
        );
      }

      try {
        this.schema = await this.composeSchema(typeDefs, allResolvers);
        this.degradedToBaseSchema = false;
      } catch (error) {
        if (!hasModuleContributions) throw error;
        this.logger.error(
          'Module-contributed schema failed to compose — falling back to the base schema without module types/resolvers',
          { error: error?.message },
        );
        this.schema = await this.composeSchema(baseTypeDefs, customResolvers);
        // Surfaced through the health probe — a fully-green /health while
        // the whole module surface is missing would hide the degradation.
        this.degradedToBaseSchema = true;
      }

      this.logger.log('GraphQL schema built successfully with custom resolvers');
      return this.schema;
    } catch (error) {
      this.logger.error('Failed to build GraphQL schema', {
        error: error?.message || error,
        stack: error?.stack,
        fullError: error,
      });
      throw new Error(`Schema build failed: ${error?.message || JSON.stringify(error)}`, { cause: error });
    }
  }

  /** Assembles Neo4jGraphQL features and composes the executable schema. */
  private async composeSchema(
    typeDefs: string,
    resolvers: ResolverMap,
  ): Promise<any> {
    const features: any = {};

      // NOTE: Neo4j GraphQL v7's CDC-based subscriptions are disabled for Memgraph compatibility
      // Custom subscription resolvers (like streamResponse) still work via PubSub and Apollo Server WebSockets
      // Memgraph doesn't support CDC (db.cdc.current procedure) required by features.subscriptions
      // DO NOT enable this unless using Neo4j Enterprise with CDC enabled in FULL mode
      // if (this.config.enableSubscriptions) {
      //   features.subscriptions = true;
      // }

      // @populatedBy callbacks for context-derived fields on Exposure /
      // Countermeasure CREATE:
      //   - populateAuthoredByOnCreate: stamps `authoredBy = context.user.sub`
      //     (the JWT subject claim); null when no auth context.
      //   - stampCreatedByUserOnCreate: stamps `createdBy = 'USER'`
      //     unconditionally. Replaces `@default(value: USER)` because
      //     `@default + @settable(onCreate: false)` is broken in
      //     @neo4j/graphql v7 — the default doesn't fire when the field
      //     is unsettable on create. See authored-by.ts docblock for the
      //     library-behaviour explanation.
      features.populatedBy = {
        callbacks: {
          populateAuthoredByOnCreate,
          stampCreatedByUserOnCreate,
        },
      };

      // (The not-configured warning is logged once in
      // buildSchemaWithResolvers — this may run twice on the fallback path.)
      if (this.config.oidcJwksUri) {
        features.authorization = {
          key: {
            url: this.config.oidcJwksUri,
          }
        };
      }

    const neoSchema = new Neo4jGraphQL({
      typeDefs,
      resolvers,
      driver: this.neo4jDriver,
      features,
    });

    return neoSchema.getSchema();
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
        throw new Error(`Schema file not found: ${schemaRelPath}`, { cause: error });
      }
      throw new Error(`Failed to load schema file: ${error.message}`, { cause: error });
    }
  }

  /**
   * Sets module-contributed schema fragments to be merged with the base schema.
   * Call this before buildSchemaWithResolvers().
   */
  setModuleSchemaFragments(fragments: string[]): void {
    this.moduleSchemaFragments = fragments;
    if (fragments.length > 0) {
      this.logger.log(`Received ${fragments.length} module schema fragment(s) for merging`);
    }
  }

  /**
   * Merges module schema fragments with the base schema.
   *
   * Two per-fragment gates, both log-and-skip (one bad module must never
   * take the platform surface down):
   *   1. graphql.parse() — syntactically invalid fragments are skipped;
   *   2. duplicate-definition check — a fragment that REDEFINES a type
   *      name already owned by the base schema or an earlier accepted
   *      fragment is skipped. Do NOT weaken this to conflicting-redefs
   *      only: a CONFLICTING redefinition throws at composition (boot
   *      death without the fallback), but a COMPATIBLE one silently
   *      MERGES in @neo4j/graphql — mutating a platform type without any
   *      error. The filter prevents both. `extend type ...` extensions
   *      are the supported augmentation form and pass untouched.
   */
  private mergeModuleSchemas(baseSchema: string): string {
    if (this.moduleSchemaFragments.length === 0) return baseSchema;

    const takenNames = this.collectDefinitionNames(parse(baseSchema));

    const validFragments: string[] = [];
    for (const fragment of this.moduleSchemaFragments) {
      let doc;
      try {
        doc = parse(fragment);
      } catch (error) {
        this.logger.warn('Skipping invalid module schema fragment', {
          error: error?.message,
          fragmentPreview: fragment.substring(0, 200),
        });
        continue;
      }

      const fragmentNames = this.collectDefinitionNames(doc);
      const collisions = [...fragmentNames].filter((n) => takenNames.has(n));
      if (collisions.length > 0) {
        this.logger.warn(
          'Skipping module schema fragment that redefines existing type(s) — use `extend type` to augment',
          {
            collisions,
            fragmentPreview: fragment.substring(0, 200),
          },
        );
        continue;
      }

      fragmentNames.forEach((n) => takenNames.add(n));
      validFragments.push(fragment);
    }

    if (validFragments.length === 0) return baseSchema;

    this.logger.log(`Merging ${validFragments.length} valid module schema fragment(s) with base schema`);
    return [baseSchema, ...validFragments].join('\n\n');
  }

  /**
   * Top-level type-system DEFINITION names in a parsed document. Extensions
   * (`extend type ...`, kind suffix `...TypeExtension`) are deliberately
   * excluded — extending an existing type is legal composition.
   */
  private collectDefinitionNames(doc: ReturnType<typeof parse>): Set<string> {
    const names = new Set<string>();
    for (const def of doc.definitions) {
      switch (def.kind) {
        case 'ObjectTypeDefinition':
        case 'InterfaceTypeDefinition':
        case 'EnumTypeDefinition':
        case 'ScalarTypeDefinition':
        case 'UnionTypeDefinition':
        case 'InputObjectTypeDefinition':
        case 'DirectiveDefinition':
          names.add(def.name.value);
          break;
        default:
          break;
      }
    }
    return names;
  }

  private async validateNeo4jConnection(): Promise<void> {
    const session = this.neo4jDriver.session();
    try {
      await session.run('RETURN 1');
      this.logger.log('Neo4j connection validated');
    } catch (error) {
      throw new Error(`Neo4j connection failed: ${error.message}`, { cause: error });
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

  /**
   * Merges module-contributed resolvers into the resolver map.
   * Each module resolver is wrapped with auth, timeout, logging, and error handling.
   *
   * @param existingResolvers - Resolver map from hardcoded services (these take precedence)
   * @param moduleResolvers - Resolver maps from modules (sorted by module name)
   * @returns Merged resolver map ready for Neo4jGraphQL
   */
  mergeModuleResolvers(
    existingResolvers: ResolverMap,
    moduleResolvers: Array<{ moduleName: string; resolvers: ResolverMap }>,
  ): ResolverMap {
    const merged: ResolverMap = {};

    // Deep-copy top-level type entries so we don't mutate the input
    for (const [typeName, fields] of Object.entries(existingResolvers)) {
      merged[typeName] = { ...fields };
    }

    for (const { moduleName, resolvers } of moduleResolvers) {
      for (const [typeName, fields] of Object.entries(resolvers)) {
        if (!merged[typeName]) {
          merged[typeName] = {};
        }

        for (const [fieldName, resolverFn] of Object.entries(fields)) {
          // Hardcoded resolvers and earlier modules win
          if (merged[typeName][fieldName]) {
            this.logger.warn(
              `Module "${moduleName}" resolver for ${typeName}.${fieldName} ` +
              `conflicts with existing resolver -- skipped`,
            );
            continue;
          }

          merged[typeName][fieldName] = this.wrapModuleResolver(
            moduleName, typeName, fieldName, resolverFn,
          );
        }
      }
    }

    return merged;
  }

  /**
   * Wraps a module resolver with auth enforcement, timeout, logging,
   * and error sanitization.
   */
  private wrapModuleResolver(
    moduleName: string,
    typeName: string,
    fieldName: string,
    resolverFn: ResolverFunction,
  ): ResolverFunction {
    const logger = this.logger;
    const timeoutMs = this.MODULE_RESOLVER_TIMEOUT_MS;
    const isProduction = process.env.NODE_ENV === 'production';
    const oidcConfigured = !!this.config.oidcJwksUri;
    const noauthEnabled = !!this.config.enableNoauth;
    // noauth only effective in non-production without OIDC — mirrors resolveSchemaPath()
    const authRequired = isProduction || oidcConfigured || !noauthEnabled;
    const fieldPath = `${moduleName}:${typeName}.${fieldName}`;

    return async (parent, args, context, info) => {
      const start = Date.now();

      // Auth enforcement -- defense-in-depth: even if the module's SDL
      // lacks @authentication, module resolvers require a verified identity.
      // Gate on context.user (the JWKS-verified payload from the context
      // factory), NOT on token/jwt presence: context.token still carries the
      // raw, unverified bearer string, so gating on it would let any
      // "Bearer <anything>" through. context.user is undefined for an
      // invalid/absent token; in the no-OIDC non-prod dev mode it holds the
      // mock admin.
      // The gate itself is skipped ONLY when all three conditions are met:
      //   1. NODE_ENV is NOT 'production'
      //   2. OIDC is NOT configured
      //   3. ENABLE_NOAUTH is explicitly 'true'
      if (authRequired && !context?.user) {
        logger.warn(`Module resolver ${fieldPath} called without authentication`);
        throw new GraphQLError('Authentication required', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      // Invoke with timeout
      let timeoutId: ReturnType<typeof setTimeout>;
      try {
        const result = await Promise.race([
          resolverFn(parent, args, context, info),
          new Promise((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error(`Module resolver timeout after ${timeoutMs}ms`)),
              timeoutMs,
            );
          }),
        ]);

        clearTimeout(timeoutId!);
        logger.debug(`Module resolver ${fieldPath} completed`, {
          duration: Date.now() - start,
        });

        return result;
      } catch (error: any) {
        clearTimeout(timeoutId!);
        const duration = Date.now() - start;

        // A module that reaches out to a service of its own can be refused for
        // a reason the caller could actually act on. Flattening that to
        // "the module failed" tells an operator to investigate the platform
        // when what they need to do is re-authenticate — and in production the
        // code is the ONLY field that survives formatError, so the code is the
        // entire message.
        //
        // Checked BEFORE isTimeout: that is a substring test on a message the
        // upstream service controls, so a refusal whose text happened to
        // mention a timeout would otherwise be reported as our own.
        const refusalCode =
          typeof error?.code === 'string'
            ? UPSTREAM_REFUSAL_CODES.get(error.code)
            : undefined;
        const isTimeout = !refusalCode && error?.message?.includes('timeout');

        logger.error(`Module resolver ${fieldPath} failed`, {
          error: error?.message,
          duration,
          isTimeout,
          refusalCode,
        });

        // Wrap module errors in a GraphQLError with a safe message.
        // In production, formatError will further sanitize.
        throw new GraphQLError(
          refusalCode
            ? 'Authentication required'
            : isTimeout
              ? 'Operation timed out'
              : `Module operation failed: ${moduleName}`,
          {
            extensions: {
              code:
                refusalCode ??
                (isTimeout ? 'MODULE_RESOLVER_TIMEOUT' : 'MODULE_RESOLVER_ERROR'),
              moduleName,
              ...(process.env.NODE_ENV !== 'production' && {
                originalMessage: error?.message,
              }),
            },
          },
        );
      }
    };
  }
}
