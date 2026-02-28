import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RESOLVER_SERVICES } from './resolvers.constants';
import { TemplateResolverService } from './resolver-services/template-resolver.service';
import { ModuleRegistryService } from './module-management-services/module-registry.service';
import { ModuleManagementService } from './module-management-services/module-management.service';
import { ModuleManagementResolverService } from './resolver-services/module-management-resolver.service';
import { SetInstantiationAttributesService } from './resolver-services/set-instantiation-attributes.service';
import { AnalysisResolverService } from './resolver-services/analysis-resolver.service';
import { IssueResolverService } from './resolver-services/issue-resolver.service';
import { AuthorizationService } from './services/authorization.service';
import { MonitoringService } from './services/monitoring.service';
import { TemplateCacheService } from './services/template-cache.service';
import { AnalysisCacheService } from './services/analysis-cache.service';
import gqlConfig from './gql.config';
const resolverServiceClasses = [
  TemplateResolverService,
  ModuleManagementResolverService,
  SetInstantiationAttributesService,
  AnalysisResolverService,
  IssueResolverService,
];

@Module({
  imports: [
    ConfigModule.forFeature(gqlConfig),
  ],
  providers: [
    // Core services
    ModuleRegistryService,
    ModuleManagementService,
    
    // Shared services
    AuthorizationService,
    MonitoringService,
    TemplateCacheService,
    AnalysisCacheService,
    
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
    
    // Shared services
    AuthorizationService,
    MonitoringService,
    TemplateCacheService,
    AnalysisCacheService,
    
    // Resolver services
    ...resolverServiceClasses, 
    RESOLVER_SERVICES
  ],
})
export class CustomResolverModule {}
