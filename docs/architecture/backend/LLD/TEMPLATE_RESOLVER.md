# TemplateResolverService

## Overview

The `TemplateResolverService` is a template fetching service with caching, monitoring, error handling, and shared service architecture.

- Structured logging with error context
- LRU caching with TTL
- Input validation for all parameters
- Performance monitoring and metrics
- Full type safety with typed interfaces
- Safe array handling with validation
- Authorization framework ready for future enhancement
- Graceful error handling with fallback mechanisms
- Timeout protection for all module calls
- Module health monitoring with caching

## Shared Services Architecture

Reusable services shared across all resolvers:

### AuthorizationService
```typescript
@Injectable()
export class AuthorizationService {
  // Future-ready authorization with pass-through for schema-level auth
  async checkAuthorization(context: AuthorizationContext, operation: OperationContext)
  validateContext(context: AuthorizationContext): boolean
  extractAuthContext(graphqlContext: any): AuthorizationContext
}
```

### MonitoringService
```typescript
@Injectable()
export class MonitoringService {
  // Metrics and monitoring
  recordOperation(metrics: OperationMetrics): void
  getStatistics(): ServiceStatistics
  getOperationStatistics(operationName: string)
  getHealthStatus()
}
```

### TemplateCacheService
```typescript
@Injectable()
export class TemplateCacheService {
  // LRU cache with TTL
  get(type: 'template' | 'guide', moduleName: string, id?: string): string | null
  set(type: 'template' | 'guide', moduleName: string, value: string, id?: string): void
  invalidateModule(moduleName: string): void
  getStatistics(): CacheStatistics
}
```

## Key Features

### Caching
```typescript
// LRU cache with 15-minute TTL
// Automatic cleanup every 5 minutes
// Per-module and per-template/guide caching
// Cache statistics and health monitoring

const cached = this.templateCache.get('template', moduleName, id);
if (cached) {
  return {
    success: true,
    content: cached,
    cached: true,
    source: 'cache',
  };
}
```

### Error Handling
```typescript
// Timeout protection for all module calls
const template = await Promise.race([
  moduleInstance.getModuleTemplate(),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Template fetch timeout')), this.operationTimeout)
  ),
]);

// Graceful fallback mechanisms
if (!moduleInfo.hasTemplate) {
  return {
    success: true,
    content: '',
    source: 'fallback',
  };
}
```

### Module Health Monitoring
```typescript
// Cached health checks (5-minute TTL)
private async checkModuleHealth(moduleName: string): Promise<ModuleTemplateInfo> {
  const moduleInstance = this.moduleRegistry.getModuleByName(moduleName);
  const info: ModuleTemplateInfo = {
    moduleName,
    available: !!moduleInstance,
    hasTemplate: typeof moduleInstance?.getModuleTemplate === 'function',
    hasGuide: typeof moduleInstance?.getClassGuide === 'function',
    lastChecked: new Date(),
  };

  this.moduleHealthCache.set(moduleName, info);
  return info;
}
```

### Input Validation
```typescript
private validateTemplateRequest(request: TemplateRequest): TemplateValidationResult {
  const errors: string[] = [];

  if (!request.moduleName || typeof request.moduleName !== 'string') {
    errors.push('Module name is required and must be a string');
  }

  if (request.moduleName && !/^[a-zA-Z0-9_.-]+$/.test(request.moduleName)) {
    warnings.push('Module name contains special characters');
  }

  return { isValid: errors.length === 0, errors, warnings };
}
```

### Performance Monitoring
```typescript
// Operation timing and success rates
this.monitoringService.recordOperation({
  operationName: 'getModuleTemplate',
  duration,
  success: true,
  timestamp: new Date(),
  metadata: { moduleName, cached: false, contentLength: content.length },
});

// Slow operation detection
if (duration > 5000) {
  this.logger.warn('Slow operation detected', { operationName, duration });
}
```

### Authorization Framework
```typescript
// Ready for future enhancement, currently passes through
const authResult = await this.authorizationService.checkAuthorization(context, {
  operationType: 'query',
  operationName: 'getModuleTemplate',
  resourceType: 'template',
  resourceId: moduleName,
});
```

## Monitoring and Observability

### Service Statistics
```typescript
interface ServiceStatistics {
  operationCount: number;
  successCount: number;
  errorCount: number;
  averageResponseTime: number;
  lastOperationAt?: Date;
  operationsByName: Map<string, OperationStats>;
}
```

### Cache Statistics
```typescript
interface CacheStatistics {
  totalEntries: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  totalSize: number;
  oldestEntry?: Date;
  newestEntry?: Date;
}
```

### Health Monitoring
```typescript
getHealthStatus() {
  return {
    healthy: monitoringHealth.healthy && cacheHealth.healthy,
    monitoring: {
      successRate: 95.2,
      averageResponseTime: 145,
      totalOperations: 1247,
    },
    cache: {
      hitRate: 78.5,
      totalEntries: 156,
      cacheUtilization: 15.6,
    },
    moduleHealth: [
      { moduleName: 'aws-module', available: true, hasTemplate: true },
      // ...
    ],
  };
}
```

## API

### Method Signatures
```typescript
async getModuleTemplate(
  moduleName: string,
  context?: AuthorizationContext
): Promise<TemplateOperationResult>

// Legacy compatibility maintained
async getModuleTemplateLegacy(moduleName: string): Promise<string>
```

### Response Objects
```typescript
interface TemplateOperationResult {
  success: boolean;
  content: string;
  cached: boolean;
  duration: number;
  source: 'cache' | 'module' | 'fallback';
  error?: string;
}
```

### GraphQL Resolver Integration
```typescript
getResolvers() {
  return {
    Module: {
      template: async ({ name }: { name: string }, context?: any) => {
        const authContext = this.authorizationService.extractAuthContext(context);

        this.logger.debug('Module template resolver called', {
          name,
          userId: authContext.user?.id
        });

        return await this.getModuleTemplateLegacy(name);
      },
    },
    // ... all other resolvers with consistent logging and auth context
  };
}
```

## Performance Optimizations

### Caching
- **15-minute TTL** for templates and guides
- **LRU eviction** when cache reaches 1000 entries
- **Automatic cleanup** every 5 minutes
- **Per-module invalidation** when modules are updated

### Module Health Caching
- **5-minute TTL** for module health checks
- **Prevents repeated module availability checks**
- **Cached capability detection** (hasTemplate, hasGuide)

### Operation Timeouts
- **10-second timeout** for all module operations
- **Prevents hanging requests**
- **Graceful fallback** to empty content

### Efficient Monitoring
- **Minimal overhead** operation tracking
- **Aggregated statistics** by operation type
- **Automatic slow operation detection**
