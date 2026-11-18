# Custom Resolver Services - Quick Reference

## Service Overview

| Service | Purpose | Key Features | Caching | Neo4j v5 |
|---------|---------|--------------|---------|----------|
| ModuleManagementResolverService | Module operations | Install, reset, health monitoring | No | Yes |
| TemplateResolverService | Template generation | Module/class templates with caching | Yes | Yes |
| IssueResolverService | Issue synchronization | Real-time sync with external systems | No | Yes |
| AnalysisResolverService | AI analysis operations | Long-running sessions, subscriptions | Yes* | Yes |
| SetInstantiationAttributesService | Component attributes | Batch processing, concurrency control | No | Yes |
| ClassIdentityResolverService | Class-identity admin surface | Admin gate + audit log; rebind conflicts, orphan reconciliation, identity migration | No | Yes |
| ReportDetailsResolverService | Analysis report details | Read, set and suggest the client, author, project and custom fields a report prints; one locked write transaction | No | Yes |

*\* Caching only for Neo4j database operations, not module responses*

---

## Quick Start

### GraphQL Operations

```graphql
# Module Management
mutation { resetModule(input: {moduleName: "scanner"}) }

# Template Generation
query { getModuleTemplate(moduleName: "scanner") { template metadata } }

# Issue Synchronization
query {
  issue(id: "ISSUE-123") {
    syncedAttributes { attributes _metadata }
  }
}

# Analysis Operations
mutation { runAnalysis(input: {analysisId: "analysis-456", scope: "security"}) }
subscription { analysisUpdates(analysisId: "analysis-456") }

# Report Details
query { reportDetails(analysisId: "analysis-456") { client author project customFields { label value } updated } }
mutation { setReportDetails(analysisId: "analysis-456", details: {client: "Example Corp", customFields: [{label: "Reference", value: "TM-7"}]}) { client customFields { label value } updated } }

# Component Attributes
mutation { setAttributes(input: {componentId: "comp-789", attributes: {}}) }
```

---

## Core Functions

### ModuleManagementResolverService

```typescript
// Main Operations
resetModule(input: ResetModuleInput): Promise<boolean>
getModules(): Promise<ModuleInfo[]>
getModuleHealth(): Promise<ModuleHealthStatus[]>

// Monitoring
getStatistics(): ResolverStatistics
resetStatistics(): void
getHealthStatus(): HealthStatus
```

### TemplateResolverService

```typescript
// Template Operations
getModuleTemplate(moduleName: string): Promise<TemplateResponse>
getClassTemplate(moduleName: string, className: string): Promise<TemplateResponse>
getClassGuide(moduleName: string, className: string): Promise<TemplateResponse>

// Cache Management
getCacheStatistics(): CacheStatistics
invalidateModuleCache(moduleName: string): void
getHealthStatus(): HealthStatus
```

### IssueResolverService

```typescript
// Field Resolver
Issue.syncedAttributes: Promise<SyncedAttributesResponse>

// Core Operations (Internal)
getUpdatedIssue(issueId, attributes, moduleName, lastSyncAt): Promise<SyncResult>
setSyncedDate(issueId: string): Promise<DatabaseOperationResult<string>>
parseAttributes(attributesJson: string): IssueAttributes

// Monitoring
getStatistics(): IssueOperationStatistics
resetStatistics(): void
getHealthStatus(): HealthStatus
```

### AnalysisResolverService

```typescript
// Query Operations
getAnalysisStatus(analysisId: string): Promise<AnalysisStatusResult>
getAnalysisValueKeys(analysisId: string): Promise<string[]>
getAnalysisValues(analysisId: string, keys: string[]): Promise<any>

// Mutation Operations
runAnalysis(input: AnalysisRequest): Promise<AnalysisOperationResult>
startChat(input: ChatAnalysisRequest): Promise<AnalysisOperationResult>
resumeAnalysis(input: ResumeAnalysisRequest): Promise<AnalysisOperationResult>
deleteAnalysis(analysisId: string): Promise<boolean>

// Subscription
analysisUpdates(analysisId?: string, scope?: string): AsyncIterator

// Monitoring
getStatistics(): AnalysisOperationStatistics
resetStatistics(): void
getHealthStatus(): HealthStatus
```

### SetInstantiationAttributesService

```typescript
// Mutation Operations
linkToExternalObject(input: LinkExternalObjectRequest): Promise<boolean>
deleteObsoleteExternalObjects(input: DeleteObsoleteExternalObjectsRequest): Promise<boolean>
upsertExposure(input: UpsertExposureRequest): Promise<boolean>
upsertCountermeasures(input: UpsertCountermeasuresRequest): Promise<boolean>
setAttributes(input: SetAttributesRequest): Promise<boolean>

// Monitoring
getStatistics(): SetInstantiationAttributesOperationStatistics
resetStatistics(): void
getHealthStatus(): HealthStatus
```

GraphQL mutation: `setInstantiationAttributes(componentId, classId, attributes): SetInstantiationAttributesResult` returns `{ success, staleFlippedCount, unresolvedReferences, errorCode, errorMessage }`. `unresolvedReferences` lists the class-derived finding references that could not be linked. They do not fail the save, and each is also recorded on its finding as `unresolvedReferences`. See [Reference resolution](./SET_INSTANTIATION_ATTRIBUTES.md#reference-resolution).

### ClassIdentityResolverService

```typescript
// Field resolvers (Module)
Module.rebindConflicts: Promise<RebindConflictDetail[]>   // joins lastInstallClassIds vs DB
Module.constraintsHealthy: boolean

// Query (admin-gated)
classIdentityEvents(kind?, moduleName?, since?): ClassIdentityEvent[]

// Mutations (admin-gated — every call goes through requireAdmin(ctx))
migrateClassId({moduleName, className, classKind, newId}): Promise<boolean>
reviveOrphanedClass({classId, classKind}): Promise<boolean>
deleteOrphanedClass({classId, classKind, cascade}): Promise<boolean>      // capped at 1000 incidents
runIdentityMigration({dryRun}): Promise<IdentityMigrationReport>
```

Authz: every operation gated by `requireAdmin(ctx)` at resolver entry — see [`is-admin.ts`](../../../../apps/dt-ws/src/common/guards/is-admin.ts). Every mutation emits a `Logger.warn` audit entry before doing the work.

### ReportDetailsResolverService

```typescript
// Queries
reportDetails(analysisId): Promise<ReportDetails | null>          // newest binding's value; null when unknown or unbound
suggestReportDetails(analysisId): Promise<ReportDetails | null>   // newest details among the element's other analyses

// Mutation
setReportDetails(analysisId, details): Promise<ReportDetails>     // merge by key, stamp `updated`, write to every binding
```

Stored as one JSON string, `metadata`, on every `ANALYZED_BY` edge into the analysis; not reachable through generated queries. A key given is written, null clears it, a key left out stays; `customFields` is one key, replaced whole, and null or `[]` removes it. `client`, `author` and `project` are trimmed, at most 120 characters, with no control or text-direction character. At most 10 custom fields; a label is at most 40 characters with a visible letter or digit, a value at most 120, and labels are unique as a reader sees them, ignoring case. The stored JSON is at most 4 KiB. A read drops a stored value a set would refuse. Refusals carry their own `extensions.code`: `REPORT_DETAILS_CLIENT_TOO_LONG`, `REPORT_DETAILS_CLIENT_CHARACTERS`, `REPORT_DETAILS_AUTHOR_TOO_LONG`, `REPORT_DETAILS_AUTHOR_CHARACTERS`, `REPORT_DETAILS_PROJECT_TOO_LONG`, `REPORT_DETAILS_PROJECT_CHARACTERS`, `REPORT_DETAILS_FIELD_TOO_LONG`, `REPORT_DETAILS_FIELD_CHARACTERS`, `REPORT_DETAILS_FIELD_INCOMPLETE`, `REPORT_DETAILS_FIELD_DUPLICATE`, `REPORT_DETAILS_TOO_MANY_FIELDS`, `REPORT_DETAILS_TOO_LARGE`, `ANALYSIS_NOT_FOUND`, `ANALYSIS_NOT_BOUND`. Authz: the resolver checks for a verified user itself, then calls `AuthorizationService` for the requested analysis only; the suggestion also reads the element's other analyses. A module reads report details only through these fields, never from `getDocument`. See [ReportDetailsResolverService](./CUSTOM_RESOLVER_SERVICES_DOCUMENTATION.md#10-reportdetailsresolverservice).

---

## Shared Services

### AuthorizationService
```typescript
checkAuthorization(context: AuthorizationContext, operation: OperationContext): Promise<AuthorizationResult>
extractAuthContext(context: any): AuthorizationContext
```

### MonitoringService
```typescript
recordOperation(metrics: OperationMetrics): void
getStatistics(): MonitoringStatistics
resetStatistics(): void
getHealthStatus(): HealthStatus
```

### TemplateCacheService
```typescript
get(key: string): CachedItem | null
set(key: string, value: any): void
invalidateModule(moduleName: string): void
getStatistics(): CacheStatistics
getHealthStatus(): HealthStatus
```

### AnalysisCacheService
```typescript
getAnalysisMetadata(analysisId: string): AnalysisMetadata | null
setAnalysisMetadata(analysisId: string, metadata: AnalysisMetadata): void
invalidateAnalysis(analysisId: string): void
getStatistics(): CacheStatistics
getHealthStatus(): HealthStatus
```

---

## Key Design Patterns

### 1. Neo4j v5 Transactions
```typescript
// Read Operations
const result = await session.executeRead(async (tx: DatabaseTransaction) => {
  return await tx.run(query, parameters);
});

// Write Operations
await session.executeWrite(async (tx: DatabaseTransaction) => {
  return await tx.run(query, parameters);
});
```

### 2. Concurrency Control
```typescript
// Mutex pattern for single-resource operations
private readonly syncMutex = new Map<string, Promise<any>>();

if (this.syncMutex.has(resourceId)) {
  return await this.syncMutex.get(resourceId)!;
}

const operation = this.performOperation(resourceId);
this.syncMutex.set(resourceId, operation);

try {
  return await operation;
} finally {
  this.syncMutex.delete(resourceId);
}
```

### 3. Input Validation
```typescript
private validateInput(input: RequestInput): ValidationResult {
  const errors: string[] = [];

  if (!input.id || typeof input.id !== 'string') {
    errors.push('ID is required and must be a string');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings: [],
  };
}
```

### 4. Authorization Pattern
```typescript
// Extract authorization context
const authContext = this.authorizationService.extractAuthContext(context);

// Check authorization
const authResult = await this.authorizationService.checkAuthorization(authContext, {
  operationType: 'mutation',
  operationName: 'operationName',
  resourceType: 'resourceType',
  resourceId: 'resourceId',
});

if (!authResult.allowed) {
  throw new Error(`Authorization failed: ${authResult.reason}`);
}
```

### 5. Monitoring Pattern
```typescript
const startTime = Date.now();

try {
  // Perform operation
  const result = await this.performOperation();

  // Record success
  this.monitoringService.recordOperation({
    operationName: 'operationName',
    duration: Date.now() - startTime,
    success: true,
    timestamp: new Date(),
    metadata: { /* operation metadata */ },
  });

  return result;
} catch (error) {
  // Record failure
  this.monitoringService.recordOperation({
    operationName: 'operationName',
    duration: Date.now() - startTime,
    success: false,
    timestamp: new Date(),
    metadata: { error: error.message },
  });

  throw error;
}
```

### 6. Caching Strategy
```typescript
// Check cache first
const cacheKey = `${type}:${id}`;
const cached = this.cache.get(cacheKey);
if (cached) {
  return cached;
}

// Perform operation
const result = await this.performOperation();

// Cache result
this.cache.set(cacheKey, result);
return result;
```

### 7. Batch Processing with Debouncing
```typescript
private readonly debouncedOperations = new Map<string, NodeJS.Timeout>();

private async debouncedOperation(key: string, operation: () => Promise<any>): Promise<any> {
  // Clear existing timeout
  if (this.debouncedOperations.has(key)) {
    clearTimeout(this.debouncedOperations.get(key)!);
  }

  // Set new timeout
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(async () => {
      try {
        const result = await operation();
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        this.debouncedOperations.delete(key);
      }
    }, this.debounceMs);

    this.debouncedOperations.set(key, timeout);
  });
}
```

---

## Troubleshooting

### Common Issues

| Issue | Service | Solution |
|-------|---------|----------|
| Module not found | ModuleManagement | Check module registry and whitelist |
| Template timeout | Template | Increase `TEMPLATE_OPERATION_TIMEOUT_MS` |
| Sync not working | Issue | Verify external system connectivity |
| Analysis stuck | Analysis | Check long-running analysis tracking |
| Attribute conflicts | SetAttributes | Review concurrency control settings |

### Health Check Commands

```typescript
// Check individual service health
const health = await service.getHealthStatus();
console.log(`${service.constructor.name}: ${health.healthy ? 'OK' : 'FAILED'}`);

// Check all services
const services = [
  moduleManagementResolver,
  templateResolver,
  issueResolver,
  analysisResolver,
  setInstantiationAttributesService,
];

const healthStatuses = await Promise.all(
  services.map(async (service) => ({
    name: service.constructor.name,
    health: await service.getHealthStatus(),
  }))
);

const overallHealthy = healthStatuses.every(s => s.health.healthy);
console.log(`Overall System Health: ${overallHealthy ? 'OK' : 'DEGRADED'}`);
```

### Performance Monitoring

```typescript
// Get service statistics
const stats = service.getStatistics();
console.log(`Operations: ${stats.totalOperations}`);
console.log(`Success Rate: ${(stats.successfulOperations / stats.totalOperations * 100).toFixed(2)}%`);
console.log(`Avg Response Time: ${stats.averageOperationTime}ms`);

// Cache performance (for services with caching)
const cacheStats = service.getCacheStatistics();
console.log(`Cache Hit Rate: ${(cacheStats.hits / (cacheStats.hits + cacheStats.misses) * 100).toFixed(2)}%`);
```

---

## Configuration Quick Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TEMPLATE_CACHE_SIZE` | 100 | Template cache max items |
| `TEMPLATE_CACHE_TTL_MS` | 300000 | Template cache TTL (5 min) |
| `ANALYSIS_CACHE_SIZE` | 50 | Analysis cache max items |
| `TEMPLATE_OPERATION_TIMEOUT_MS` | 30000 | Template and guide timeout; a value below 20000 is raised to 20000 |
| `ISSUE_SYNC_TIMEOUT_MS` | 30000 | Issue sync timeout |
| `ANALYSIS_NO_TIMEOUT` | true | Disable analysis timeouts |
| `BATCH_PROCESSING_DEBOUNCE_MS` | 1000 | Batch processing debounce |
| `MONITORING_ENABLED` | true | Enable monitoring |

### Service Dependencies

```typescript
// Required injections for each service
ModuleManagementResolverService: [
  NEO4J_DRIVER, ModuleRegistryService, ModuleManagementService,
  ConfigService, AuthorizationService, MonitoringService
]

TemplateResolverService: [
  NEO4J_DRIVER, ModuleRegistryService, ConfigService,
  AuthorizationService, MonitoringService, TemplateCacheService
]

IssueResolverService: [
  NEO4J_DRIVER, ModuleRegistryService, ConfigService,
  AuthorizationService, MonitoringService
]

AnalysisResolverService: [
  NEO4J_DRIVER, ModuleRegistryService, ConfigService,
  AuthorizationService, MonitoringService, AnalysisCacheService
]

SetInstantiationAttributesService: [
  NEO4J_DRIVER, ConfigService,
  AuthorizationService, MonitoringService
]

ReportDetailsResolverService: [
  NEO4J_DRIVER, ConfigService, AuthorizationService
]
```

---

## Best Practices

### Development
- Always validate inputs before processing
- Use authorization checks for all operations
- Record operation metrics for monitoring
- Implement proper error handling with fallbacks
- Use Neo4j v5 transaction patterns

### Performance
- Implement caching where appropriate (not for real-time data)
- Use batch processing for frequent operations
- Apply concurrency control for single-resource operations
- Set appropriate timeouts for external calls
- Monitor and optimize slow operations

### Deployment
- Enable logging
- Set up health checks and monitoring
- Configure appropriate cache sizes and TTLs
- Use environment-specific configurations
- Implement fallback strategies

---

## Related Documentation

- [Full Custom Resolver Services Documentation](./CUSTOM_RESOLVER_SERVICES_DOCUMENTATION.md)
- [GraphQL Module Architecture](./ARCHITECTURE.md)
- [API Reference](./CUSTOM_RESOLVER_API_REFERENCE.md)
