import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RESOLVER_SERVICES } from './resolvers.constants';
import { BootstrapModule } from '../bootstrap/bootstrap.module';
import { TemplateResolverService } from './resolver-services/template-resolver.service';
import { ModuleRegistryService } from './module-management-services/module-registry.service';
import { ModuleManagementService } from './module-management-services/module-management.service';
import { ClassReconciler } from './module-management-services/class-reconciler.service';
import { ClassIdentityEventLog } from './module-management-services/class-identity-event-log.service';
import { ClassIdentityMigrationService } from './module-management-services/class-identity-migration.service';
import { ModuleManagementResolverService } from './resolver-services/module-management-resolver.service';
import { SetInstantiationAttributesService } from './resolver-services/set-instantiation-attributes.service';
import { AnalysisResolverService } from './resolver-services/analysis-resolver.service';
import { IssueResolverService } from './resolver-services/issue-resolver.service';
import { MatchClassesResolverService } from './resolver-services/match-classes-resolver.service';
import { ListClassesResolverService } from './resolver-services/list-classes-resolver.service';
import { ControlGapsResolverService } from './resolver-services/control-gaps-resolver.service';
import { ControlCandidatesResolverService } from './resolver-services/control-candidates-resolver.service';
import { ClassIdentityResolverService } from './resolver-services/class-identity-resolver.service';
import { AuthorizationService } from './services/authorization.service';
import { MonitoringService } from './services/monitoring.service';
import { TemplateCacheService } from './services/template-cache.service';
import { AnalysisCacheService } from './services/analysis-cache.service';
import { EmbeddingService } from './services/embedding.service';
import gqlConfig from './gql.config';
const resolverServiceClasses = [
  TemplateResolverService,
  ModuleManagementResolverService,
  SetInstantiationAttributesService,
  AnalysisResolverService,
  IssueResolverService,
  MatchClassesResolverService,
  ListClassesResolverService,
  ControlGapsResolverService,
  ControlCandidatesResolverService,
  // Admin GraphQL surface for class-identity (events + admin mutations).
  ClassIdentityResolverService,
];

@Module({
  imports: [
    ConfigModule.forFeature(gqlConfig),
    // BootstrapModule exports EnsureConstraintsService so the admin
    // surface's `Module.constraintsHealthy` resolver can read the
    // singleton bootstrap result.
    BootstrapModule,
  ],
  providers: [
    // Core services
    ModuleRegistryService,
    ModuleManagementService,
    ClassReconciler,
    ClassIdentityEventLog,
    ClassIdentityMigrationService,

    // Shared services
    AuthorizationService,
    MonitoringService,
    TemplateCacheService,
    AnalysisCacheService,
    EmbeddingService,

    // Resolver services
    AnalysisResolverService,
    IssueResolverService,
    ...resolverServiceClasses,

    // Resolver services provider
    {
      provide: RESOLVER_SERVICES,
      useFactory: (...services) => services,
      inject: resolverServiceClasses,
    },
  ],
  exports: [
    // Core services
    ModuleRegistryService,
    ModuleManagementService,
    ClassReconciler,
    ClassIdentityEventLog,
    ClassIdentityMigrationService,

    // Shared services
    AuthorizationService,
    MonitoringService,
    TemplateCacheService,
    AnalysisCacheService,
    EmbeddingService,

    // Resolver services
    ...resolverServiceClasses,
    RESOLVER_SERVICES
  ],
})
export class CustomResolverModule {}
