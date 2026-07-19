import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CustomResolverModule } from './custom-resolver.module';
import { SchemaService } from './services/schema.service';
import { ModuleRegistryService } from './module-management-services/module-registry.service';
import { ResolverService } from './interfaces/resolver.interface';
import { GQL_SCHEMA, RESOLVER_SERVICES } from './resolvers.constants';
import gqlConfig from './gql.config';

/**
 * Owns THE executable GraphQL schema. The GQL_SCHEMA async provider builds
 * it exactly once — modules loaded, module fragments + module resolvers
 * merged behind the platform resolvers — and every transport (Apollo, SSE)
 * plus the health probe consumes the same instance. Before this module
 * existed, Apollo built on a privately-constructed SchemaService while SSE
 * and health used the DI instance without module contributions: three
 * builds, two different schemas.
 */
/**
 * The GQL_SCHEMA build recipe — exported as a named function so the
 * ordering (modules loaded → fragments set → platform resolvers merged →
 * module resolvers passed to the build) is unit-pinnable; this seam IS the
 * original bug (the SSE/health paths built without these steps).
 */
export const gqlSchemaFactory = async (
  schemaService: SchemaService,
  resolverServices: ResolverService[],
  moduleRegistry: ModuleRegistryService,
) => {
  // Idempotent — the registry's own onModuleInit reuses this load.
  await moduleRegistry.loadModules();
  schemaService.setModuleSchemaFragments(moduleRegistry.getSchemaFragments());
  const customResolvers = schemaService.mergeResolvers(resolverServices);
  return schemaService.buildSchemaWithResolvers(
    customResolvers,
    moduleRegistry.getModuleResolvers(),
  );
};

@Module({
  imports: [ConfigModule.forFeature(gqlConfig), CustomResolverModule],
  providers: [
    SchemaService,
    {
      provide: GQL_SCHEMA,
      inject: [SchemaService, RESOLVER_SERVICES, ModuleRegistryService],
      useFactory: gqlSchemaFactory,
    },
  ],
  exports: [SchemaService, GQL_SCHEMA],
})
export class SchemaModule {}
