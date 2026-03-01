# AnalysisResolverService

## Overview

The `AnalysisResolverService` is specifically designed to work with analysis modules that can execute complex multi-node analysis workflows.

## Key Features

### Long-Running Operation Support
- **No Timeouts on Module Operations**: Supports 15+ minute AI analysis sessions
- **AI Workflow Support**: Designed for complex multi-node AI workflows (10+ nodes)
- **Real-time Progress Tracking**: WebSocket subscriptions for live analysis updates
- **Parallel Session Management**: Multiple users can run concurrent analyses with different scopes

### Neo4j v5 Transaction Management
- **Native Neo4j Implementation**: Uses `executeRead()`/`executeWrite()` methods as per [Neo4j JavaScript Driver documentation](https://neo4j.com/docs/javascript-manual/current/transactions/)
- **Deprecated Method Replacement**: Replaced `writeTransaction()` and direct `session.run()` with modern patterns
- **Proper Session Management**: Guaranteed session cleanup with database configuration
- **Transaction Safety**: Complete transaction management using native Neo4j patterns

### Caching Strategy
- **Neo4j Database Caching**: Analysis metadata queries are cached to reduce database load
- **Module Response Exclusion**: Never caches module responses, so analysis data is always fresh
- **Cache Invalidation**: Automatic cleanup and targeted invalidation
- **Performance Metrics**: Cache hit rates and performance monitoring

### Architecture
- **Structured Logging**: NestJS Logger is used for logging with support of multiple log levels
- **Error Handling**: Fallback behavior and detailed error context
- **Input Validation**: Thorough parameter validation with detailed error messages
- **Type Safety**: Complete TypeScript interfaces replacing all `any` types
- **Resource Management**: Proper database session lifecycle and cleanup

## Design Decisions

### Caching Strategy
```typescript
// CACHED: Neo4j database operations (metadata queries)
const metadata = await this.getAnalysisMetadataWithCache(analysisId);

// NEVER CACHED: Module responses (real-time AI data)
const status = await moduleInstance.getAnalysisStatus(id); // Always fresh
```

### Neo4j v5 Transaction Patterns
```typescript
// Modern: Using executeRead/executeWrite as per Neo4j documentation
const session = this.neo4jDriver.session({
  database: this.configService.get('database.name') || 'neo4j',
});

const result = await session.executeRead(async (tx: DatabaseTransaction) => {
  return await tx.run(query, parameters);
});

// Deprecated pattern (replaced):
// await session.writeTransaction(async (tx: any) => { ... });
```

### Timeout Handling
```typescript
// No timeouts on module operations (supports 15+ minutes)
const session = await moduleInstance.runAnalysis(...);

// Timeout protection only for database operations
const result = await Promise.race([dbQuery, timeout]);
```

### Parallel Session Support
```typescript
// Track multiple concurrent analyses
private readonly longRunningAnalyses = new Map<string, LongRunningAnalysis>();

// Support for parallel execution with different scopes
if (this.longRunningAnalyses.size >= this.config.maxParallelAnalyses) {
  throw new Error('Maximum parallel analyses limit reached');
}
```

## Monitoring and Observability

### Metrics
- **Operation Statistics**: Success rates, response times, operation counts
- **Long-Running Analysis Tracking**: Active analyses, session durations, progress monitoring
- **Subscription Management**: Active subscriptions, user activity, cleanup metrics
- **Cache Performance**: Hit rates, memory usage, invalidation statistics

### Health Monitoring
```typescript
interface AnalysisOperationStatistics {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageResponseTime: number;
  longestOperation: number;
  shortestOperation: number;
  activeAnalyses: number;
  parallelSessions: number;
  operationsByType: {
    runAnalysis: number;
    startChat: number;
    resumeAnalysis: number;
    deleteAnalysis: number;
    getStatus: number;
    getValues: number;
    getDocument: number;
  };
}
```

## Core Service Methods

### Analysis Operations
- `getAnalysisStatus()` - Get real-time analysis status (never cached)
- `getAnalysisValueKeys()` - Retrieve analysis value keys from module
- `getAnalysisValues()` - Get analysis values for specific keys
- `runAnalysis()` - Start long-running analysis operation
- `startChat()` - Begin interactive chat analysis
- `resumeAnalysis()` - Resume paused analysis with user input
- `deleteAnalysis()` - Clean up analysis data (database + module)
- `getDocument()` - Retrieve analysis documents

### Management Operations
- `getStatistics()` - Operation statistics
- `resetStatistics()` - Reset metrics for monitoring systems
- `getHealthStatus()` - Complete health check with issue detection

## Security and Authorization

### Authorization Framework
```typescript
// Blank authorization implementation (as per user request)
// Authorization handled by GraphQL schema directives
private async checkAuthorization(
  context: AuthorizationContext | undefined,
  operation: string,
  resource: Record<string, any>,
): Promise<void> {
  // Schema-level authorization via @authentication directive
  return;
}
```

### Input Validation
- **Parameter validation**: All inputs validated before processing
- **Type Safety**: Strong typing throughout the service
- **Error Context**: Detailed validation error messages
- **Resource Limits**: Configurable limits for parallel analyses and subscriptions

## Subscription Management

### Real-Time Streaming
- **WebSocket Support**: GraphQL subscriptions for real-time analysis updates
- **Session Tracking**: Monitor active subscriptions and user activity
- **Memory Management**: Automatic cleanup of inactive subscriptions
- **Parallel Support**: Users can join/leave multiple analysis streams

### PubSub Configuration
```typescript
// Optimized for high-concurrency subscriptions
private configurePubSub(): void {
  (this.pubSub as any).ee?.setMaxListeners?.(this.config.pubSubMaxListeners);
}

// Subscription activity tracking
private updateSubscriptionActivity(sessionId: string): void {
  const session = this.subscriptionSessions.get(sessionId);
  if (session) {
    session.lastActivity = Date.now();
  }
}
```

## Database and Cache Management

### Analysis Cache Service
- **Specialized Caching**: Only for Neo4j database queries (analysis metadata)
- **LRU with TTL**: Efficient memory usage with automatic expiration
- **Targeted Invalidation**: Module-specific and analysis-specific cache clearing
- **Health Monitoring**: Cache performance and memory usage tracking

### Database Session Management
```typescript
// Proper session lifecycle management
const session = this.neo4jDriver.session();
try {
  const result = await session.run(query, parameters);
  // Process result
} finally {
  await session.close(); // Always cleanup
}
```

## Error Handling and Resilience

### Structured Error Types
```typescript
type AnalysisErrorType =
  | 'ANALYSIS_NOT_FOUND'
  | 'MODULE_NOT_FOUND'
  | 'MODULE_ERROR'
  | 'DATABASE_ERROR'
  | 'VALIDATION_ERROR'
  | 'SUBSCRIPTION_ERROR'
  | 'RESOURCE_EXHAUSTED'
  | 'UNKNOWN_ERROR';
```

### Fallback Behavior
- **Fallback Responses**: Return structured error responses instead of throwing
- **Partial Success Handling**: Continue operations when possible
- **Resource Cleanup**: Automatic cleanup of failed operations
- **Context Preservation**: Maintain operation context through error chains

## Performance Optimizations

### Efficient Resource Usage
- **Connection Pooling**: Proper Neo4j session management
- **Memory Management**: Automatic cleanup of long-running analysis tracking
- **Subscription Cleanup**: Regular cleanup of inactive subscriptions
- **Cache Optimization**: LRU eviction and TTL-based expiration

### Monitoring Integration
- **Operation Timing**: Track response times for all operations
- **Success Rate Monitoring**: Monitor failure rates and trends
- **Resource Usage Tracking**: Memory usage, active connections, cache statistics
- **Alert Thresholds**: Configurable thresholds for health monitoring

## Configuration

### Analysis Resolver Configuration
```typescript
interface AnalysisResolverConfig {
  // Cache settings (Neo4j operations only)
  cacheEnabled: boolean;
  cacheTtl: number;
  maxCacheSize: number;

  // Operation settings
  maxParallelAnalyses: number;
  cleanupInterval: number;

  // Subscription settings
  maxSubscriptionsPerUser: number;
  subscriptionCleanupInterval: number;

  // Monitoring settings
  enableDetailedMetrics: boolean;
  metricsRetentionPeriod: number;

  // PubSub settings
  pubSubMaxListeners: number;
  pubSubMemoryThreshold: number;
}
```

## Integration with Shared Services

### Shared Service Architecture
- **AuthorizationService**: Centralized authorization context extraction
- **MonitoringService**: Unified operation metrics and health monitoring
- **AnalysisCacheService**: Specialized caching for analysis metadata

### Service Reusability
The AnalysisResolverService integrates with the shared service architecture established in other resolvers.
