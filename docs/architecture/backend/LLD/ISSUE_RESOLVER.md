# IssueResolverService

## Overview

The `IssueResolverService` is a synchronization service with error handling, monitoring, validation, and shared service integration.

- Structured logging with error context
- Input validation for all parameters and GraphQL inputs
- Neo4j v5 transactions with `executeWrite()` patterns
- Safe database operations with proper session management
- Performance monitoring and sync statistics
- Full type safety with typed interfaces
- Safe array handling with validation
- Authorization framework ready for future enhancement
- Graceful error handling with detailed fallback mechanisms
- Timeout protection for external sync operations (30s)
- JSON parsing with validation and error recovery

## No Caching by Design

This service intentionally does not implement caching because:

- **Real-time Sync**: Must always fetch fresh data from external issue tracking systems
- **Data Consistency**: Synchronized attributes reflect current external system state
- **Business Logic**: Modules contain complex business logic that must execute on each sync
- **Audit Trail**: Every sync operation needs to be tracked and logged
- **External Dependencies**: Issue tracking systems (Jira, GitHub, etc.) are the source of truth

Every `syncedAttributes` call performs a fresh synchronization with the external system via the module's business logic.

## Shared Services Integration

Leverages the established shared services architecture:

### AuthorizationService
```typescript
// Future-ready authorization (currently pass-through to schema @authentication)
const authResult = await this.authorizationService.checkAuthorization(context, {
  operationType: 'query',
  operationName: 'syncIssueAttributes',
  resourceType: 'issue',
  resourceId: issueId,
});
```

### MonitoringService
```typescript
this.monitoringService.recordOperation({
  operationName: 'syncIssueAttributes',
  duration,
  success: true,
  metadata: { issueId, moduleName, attributeCount: Object.keys(attributes).length },
});
```

## Key Features

### Neo4j v5 Transaction Management
```typescript
// Using executeWrite as per Neo4j documentation
const session = this.neo4jDriver.session({
  database: this.configService.get('database.name') || 'neo4j',
});

const result = await session.executeWrite(async (tx: any) => {
  return await tx.run(query, parameters);
});
```

### Input Validation
```typescript
private validateSyncRequest(request: SyncRequest): SyncValidationResult {
  const errors: string[] = [];

  if (!request.issueId || typeof request.issueId !== 'string') {
    errors.push('Issue ID is required and must be a string');
  }

  if (request.issueId && request.issueId.length > 200) {
    errors.push('Issue ID too long (max 200 characters)');
  }

  // Module name validation
  if (request.moduleName && !/^[a-zA-Z0-9_.-]+$/.test(request.moduleName)) {
    warnings.push('Module name contains special characters');
  }

  return { isValid: errors.length === 0, errors, warnings };
}
```

### Safe Database Operations
```typescript
private async setSyncedDate(issueId: string): Promise<DatabaseOperationResult<string>> {
  const session = this.neo4jDriver.session();
  try {
    const result = await session.run(
      'MATCH (i:Issue {id: $issueId}) SET i.lastSyncAt = $syncedAt RETURN i.lastSyncAt',
      { issueId, syncedAt: new Date().toISOString() }
    );

    return {
      success: true,
      data: result.records[0]?.get('lastSyncAt'),
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      duration: Date.now() - startTime,
    };
  } finally {
    await session.close();
  }
}
```

### Timeout Protection for External Sync
```typescript
// 30-second timeout for external system synchronization
const syncedAttributes = await Promise.race([
  moduleInstance.getSyncedIssueAttributes(issueId, attributes, lastSyncAt),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Sync operation timeout')), this.operationTimeout)
  ),
]);
```

### JSON Parsing
```typescript
private parseAttributes(attributesJson: string | null): IssueAttributes {
  if (!attributesJson) return {};

  if (typeof attributesJson !== 'string') {
    this.logger.warn('Attributes is not a string, returning empty object');
    return {};
  }

  try {
    const parsed = JSON.parse(attributesJson);

    // Ensure parsed result is a valid object
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      this.logger.warn('Parsed attributes is not a valid object');
      return {};
    }

    return parsed;
  } catch (error) {
    this.logger.error('Failed to parse attributes JSON', {
      error: error.message,
      attributesJson: attributesJson?.substring(0, 200),
    });
    return {};
  }
}
```

### Sync Statistics
```typescript
interface IssueOperationStatistics {
  totalSyncRequests: number;
  successfulSyncs: number;
  failedSyncs: number;
  averageSyncTime: number;
  syncsByModule: Map<string, {
    requests: number;
    successes: number;
    failures: number;
    averageTime: number;
  }>;
}

// Track statistics per module and overall
private recordSyncOperation(moduleName: string, success: boolean, duration: number): void {
  this.statistics.totalSyncRequests++;

  // Update module-specific statistics
  const moduleStats = this.statistics.syncsByModule.get(moduleName) || {
    requests: 0, successes: 0, failures: 0, averageTime: 0,
  };

  moduleStats.requests++;
  if (success) moduleStats.successes++; else moduleStats.failures++;

  const moduleTime = moduleStats.averageTime * (moduleStats.requests - 1) + duration;
  moduleStats.averageTime = moduleTime / moduleStats.requests;

  this.statistics.syncsByModule.set(moduleName, moduleStats);
}
```

### GraphQL Resolver
```typescript
getResolvers() {
  return {
    Issue: {
      syncedAttributes: async (
        { id, attributes, issueClass, lastSyncAt }: IssueResolverInput,
        context?: any
      ): Promise<SyncedAttributesResponse> => {
        // Extract authorization context
        const authContext = this.authorizationService.extractAuthContext(context);

        // Input validation
        const validation = this.validateResolverInput({ id, attributes, issueClass, lastSyncAt });
        if (!validation.isValid) {
          return {
            attributes: this.parseAttributes(attributes),
            _metadata: {
              lastSyncAt: lastSyncAt || '',
              syncedAt: new Date().toISOString(),
              synced: false,
              message: `Validation failed: ${validation.errors.join(', ')}`,
            },
          };
        }

        // Mutex handling for concurrent requests
        if (this.syncMutex.has(id)) {
          return await this.syncMutex.get(id)!;
        }

        // Safe module name extraction
        const moduleName = issueClass[0]?.module[0]?.name;
        if (!moduleName) {
          this.logger.warn('No module name found, returning local attributes');
          return fallbackResponse;
        }

        // Perform sync with error handling
        const syncPromise = this.performSyncWithFallback(
          id, attributes, moduleName, lastSyncAt, authContext
        );

        this.syncMutex.set(id, syncPromise);
        try {
          return await syncPromise;
        } finally {
          this.syncMutex.delete(id);
        }
      },
    },
  };
}
```

## Monitoring and Observability

### Sync Statistics Example
```typescript
{
  totalSyncRequests: 1247,
  successfulSyncs: 1189,
  failedSyncs: 58,
  averageSyncTime: 2340, // milliseconds
  syncsByModule: {
    "jira-module": {
      requests: 856,
      successes: 834,
      failures: 22,
      averageTime: 2100
    },
    "github-module": {
      requests: 391,
      successes: 355,
      failures: 36,
      averageTime: 2800
    }
  }
}
```

### Health Monitoring
```typescript
getHealthStatus() {
  return {
    healthy: successRate >= 85, // 85%+ success rate threshold
    syncStatistics: {
      successRate: 95.3,
      averageSyncTime: 2340,
      totalSyncRequests: 1247,
      activeModules: 2,
    },
    monitoring: {
      healthy: true,
      averageResponseTime: 145,
      totalOperations: 3521,
    },
  };
}
```

### Structured Logging
```typescript
// Successful sync
this.logger.log('Issue synchronization completed successfully', {
  issueId,
  moduleName,
  duration: 2340,
  attributeCount: 15,
  syncedAt: '2024-01-15T10:30:45.123Z',
  userId: 'user-123',
});

// Failed sync with fallback
this.logger.error('Issue synchronization failed', {
  issueId,
  moduleName,
  error: 'Connection timeout to external system',
  stack: error.stack,
  duration: 30000,
  fallbackUsed: true,
  userId: 'user-123',
});
```

## Error Handling and Resilience

### Fallback Behavior
```typescript
// Always returns a valid response, even on complete failure
return {
  attributes: this.parseAttributes(attributes), // Local fallback
  _metadata: {
    lastSyncAt: lastSyncAt || '',
    syncedAt: new Date().toISOString(),
    synced: false,
    message: 'Sync failed: External system unavailable',
  },
};
```

### Validation Layers
- **GraphQL Input Validation**: Validates resolver parameters
- **Sync Request Validation**: Validates sync operation parameters
- **JSON Parsing Validation**: Validates attribute structure
- **Database Operation Validation**: Handles database errors gracefully

### Error Context
```typescript
this.logger.error('Issue synchronization failed', {
  issueId: 'ISSUE-123',
  moduleName: 'jira-module',
  error: 'HTTP 503: Service Unavailable',
  stack: error.stack,
  duration: 15000,
  retryAttempt: 1,
  externalSystemStatus: 'DOWN',
  userId: 'user-456',
  timestamp: '2024-01-15T10:30:45.123Z',
});
```

## Type Safety

### Interface Definitions
```typescript
interface IssueResolverInput {
  id: string;
  attributes: string | null;
  issueClass: Array<{ module: Array<{ name: string; }>; }>;
  lastSyncAt: string | null;
}

interface SyncResult {
  success: boolean;
  attributes: IssueAttributes;
  metadata: SyncMetadata;
  duration: number;
  error?: string;
}

interface DatabaseOperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  duration: number;
}
```

## External System Integration

### Real-time Synchronization
- **No Caching**: Always fetches fresh data from external systems
- **Module Business Logic**: Leverages complex sync logic in modules
- **Timeout Protection**: 30-second limit prevents hanging operations
- **Fallback Strategy**: Returns local attributes when external systems fail

### Supported External Systems
- **Jira**: Issue tracking and project management
- **GitHub Issues**: Development issue tracking
- **Azure DevOps**: Work item tracking
- **ServiceNow**: IT service management
- **Custom Systems**: Via module business logic

### Sync Metadata Tracking
```typescript
{
  lastSyncAt: "2024-01-15T10:25:30.000Z",    // Previous sync timestamp
  syncedAt: "2024-01-15T10:30:45.123Z",      // Current sync timestamp
  synced: true,                               // Sync success status
  message: null                               // Error message if failed
}
```
