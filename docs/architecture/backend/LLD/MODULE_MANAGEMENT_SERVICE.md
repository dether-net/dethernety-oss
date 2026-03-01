# ModuleManagementService

## Overview

The `ModuleManagementService` provides security, monitoring, error handling, and type safety for managing the external modules of the application.

Features:
- Modern Neo4j v5 transactions with `executeRead()`/`executeWrite()` patterns
- Error handling with structured logging
- Input validation for all operations
- Full TypeScript type safety
- Security hardening and injection prevention
- Performance monitoring and statistics
- Configuration management integration

## Neo4j v5 Transaction Management

### Database Session Configuration
```typescript
const session = this.neo4jDriver.session({
  database: this.configService.get('database.name') || 'neo4j',
});
```

### Read Operations
```typescript
// Using executeRead for query operations
const result = await session.executeRead(async (tx: DatabaseTransaction) => {
  return await tx.run(query, parameters);
});
```

### Write Operations
```typescript
// Using executeWrite for mutation operations
await session.executeWrite(async (tx: DatabaseTransaction) => {
  return await tx.run(query, parameters);
});
```

## Security

### Cypher Injection Prevention
```typescript
// Secure with whitelist validation
private readonly ALLOWED_CLASS_LABELS = new Set([
  'ComponentClass', 'DataFlowClass', 'SecurityBoundaryClass', ...
]);

private validateClassLabel(classLabel: string): void {
  if (!ALLOWED_CLASS_LABELS.has(classLabel)) {
    throw new Error(`Invalid class label: ${classLabel}`);
  }
}
```

### Input Validation
```typescript
private validateMetadata(metadata: DTMetadata): ModuleValidationResult {
  const errors: ValidationError[] = [];

  // Required field validation
  if (!metadata.name || typeof metadata.name !== 'string') {
    errors.push({
      field: 'name',
      message: 'Module name is required and must be a string',
      value: metadata.name
    });
  }

  // Length validation
  if (metadata.name && metadata.name.length > 100) {
    errors.push({
      field: 'name',
      message: 'Module name must be less than 100 characters'
    });
  }

  return { isValid: errors.length === 0, errors, warnings };
}
```

### Data Sanitization
```typescript
sanitizePropertyKeys(obj: any): FlattenedProperties {
  const sanitizedObj: any = {};
  for (const key in obj) {
    // Sanitize keys to prevent injection
    const sanitizedKey = key.replace(/[^a-zA-Z0-9_.]/g, '_');
    // ... secure processing
  }
}
```

## Monitoring and Observability

### Structured Logging
```typescript
this.logger.log('Module upsert completed successfully', {
  moduleName: installedModuleName,
  moduleId,
  classesProcessed,
  duration,
  version: metadata.version,
});

this.logger.error('Module upsert failed', {
  moduleName: metadata?.name,
  error: error.message,
  stack: error.stack,
  duration,
  classesProcessed,
});
```

### Performance Metrics
```typescript
interface ModuleStatistics {
  totalModules: number;
  totalClasses: number;
  operationCount: number;
  averageOperationTime: number;
  lastOperationAt?: Date;
}

private recordOperation(operationName: string, duration: number, metadata?: any): void {
  this.statistics.operationCount++;
  const totalTime = this.statistics.averageOperationTime * (this.statistics.operationCount - 1) + duration;
  this.statistics.averageOperationTime = totalTime / this.statistics.operationCount;
  this.statistics.lastOperationAt = new Date();
}
```

### Operation Tracking
```typescript
async upsertModule(tx: DatabaseTransaction, metadata: DTMetadata): Promise<UpsertResult> {
  const startTime = Date.now();
  let classesProcessed = 0;

  try {
    // ... operation logic

    const duration = Date.now() - startTime;
    return {
      moduleId,
      moduleName: installedModuleName,
      classesProcessed,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    this.logger.error('Operation failed', { duration, error: error.message });
    throw error;
  }
}
```

## Error Handling

### Error Handling Pattern
```typescript
try {
  const result = await tx.run(query, parameters);
  this.recordOperation('operationName', duration, metadata);
  this.logger.debug('Operation successful', { operationDetails });
} catch (error) {
  this.logger.error('Operation failed', {
    operation: 'operationName',
    error: error.message,
    stack: error.stack,
    parameters,
    duration: Date.now() - startTime,
  });
  throw new Error(`Operation failed: ${error.message}`);
}
```

### Fallback Behavior
```typescript
// Continue processing other modules even if one fails
for (const [moduleName, moduleInstance] of modules) {
  try {
    await this.upsertModule(tx, metadata, options);
    processedCount++;
  } catch (error) {
    errorCount++;
    this.logger.error('Failed to process module', { moduleName, error: error.message });
    // Continue with other modules instead of failing completely
  }
}
```

### Validation with Detailed Errors
```typescript
interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

interface ModuleValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: string[];
}
```

## Type Safety

### Interfaces
```typescript
async upsertModule(
  tx: DatabaseTransaction,
  metadata: DTMetadata,
  options: ModuleOperationOptions = {}
): Promise<UpsertResult>
```

### Type-Safe Results
```typescript
interface UpsertResult {
  moduleId: string;
  moduleName: string;
  classesProcessed: number;
  duration: number;
}

interface ModuleOperationOptions {
  skipValidation?: boolean;
  timeout?: number;
  retryCount?: number;
}
```

### Security Constants
```typescript
export const ALLOWED_CLASS_LABELS = new Set([
  'ComponentClass',
  'DataFlowClass',
  'SecurityBoundaryClass',
  'ControlClass',
  'DataClass',
  'AnalysisClass',
  'IssueClass',
]);

export const MODULE_CLASS_CONFIGS: ModuleClassDefinition[] = [
  { key: 'componentClasses', label: 'ComponentClass' },
  { key: 'dataFlowClasses', label: 'DataFlowClass' },
  // ...
];
```

## Performance Optimizations

### Efficient Error Handling
- Continue processing on individual failures
- Detailed performance tracking
- Operation-level timeout support

### Resource Management
```typescript
// Proper session management
const session = this.neo4jDriver.session();
try {
  await session.writeTransaction(async (tx) => {
    // Operations
  });
} finally {
  await session.close(); // Always close sessions
}
```

### Statistics Tracking
```typescript
getStatistics(): ModuleStatistics {
  return { ...this.statistics };
}

resetStatistics(): void {
  this.statistics = {
    totalModules: 0,
    totalClasses: 0,
    operationCount: 0,
    averageOperationTime: 0,
  };
}
```

## Configuration Integration

### Service Configuration
```typescript
constructor(
  @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
  private readonly configService: ConfigService,
) {
  this.config = this.configService.get<GqlConfig>('gql')!;

  this.logger.log('ModuleManagementService initialized', {
    allowedClassLabels: Array.from(ALLOWED_CLASS_LABELS),
    moduleClassConfigs: MODULE_CLASS_CONFIGS.length,
  });
}
```

### Operation Options
```typescript
interface ModuleOperationOptions {
  skipValidation?: boolean;    // Skip metadata validation
  timeout?: number;           // Operation timeout
  retryCount?: number;        // Retry attempts
}
```

## Bulk Operations
```typescript
async updateAllModules(modules: Map<string, DTModule>): Promise<void> {
  // Process multiple modules efficiently
  // Track success/failure rates
  // Continue on individual failures
  // Logging and metrics
}
```

## Health Monitoring
```typescript
getStatistics(): ModuleStatistics {
  return {
    totalModules: this.statistics.totalModules,
    totalClasses: this.statistics.totalClasses,
    operationCount: this.statistics.operationCount,
    averageOperationTime: this.statistics.averageOperationTime,
    lastOperationAt: this.statistics.lastOperationAt,
  };
}
```

## Audit Trail
- Every operation logged with context
- Performance metrics tracked
- Error details preserved
- Success/failure rates monitored

## API Reference

### Method Signatures
```typescript
async upsertModule(
  tx: DatabaseTransaction,
  metadata: DTMetadata,
  options: ModuleOperationOptions = {}
): Promise<UpsertResult>
```

### Backward Compatibility
- All existing method signatures maintained
- Return types enhanced but compatible
- Optional parameters for new features

### Other Capabilities
```typescript
// Statistics and monitoring
getStatistics(): ModuleStatistics
resetStatistics(): void

// Validation
validateMetadata(metadata: DTMetadata): ModuleValidationResult
validateClassLabel(classLabel: string): void
validateClassObject(cls: any, classLabel: string): void
```
