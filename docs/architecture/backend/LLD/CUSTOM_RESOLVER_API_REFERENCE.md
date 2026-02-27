# Custom Resolver Services - API Reference

## 📖 **API Overview**

This document provides detailed API specifications for all custom resolver services, including function signatures, input/output types, and usage examples.

---

## 1. ModuleManagementResolverService

### **GraphQL Schema**

```graphql
type Mutation {
  resetModule(input: ResetModuleInput!): Boolean!
}

type Query {
  moduleHealth: [ModuleHealthStatus!]!
  moduleStatistics: ResolverStatistics!
}

input ResetModuleInput {
  moduleName: String!
}

type ModuleHealthStatus {
  id: String!
  name: String!
  healthy: Boolean!
  lastChecked: String!
  responseTime: Float
  error: String
}

type ResolverStatistics {
  totalOperations: Int!
  successfulOperations: Int!
  failedOperations: Int!
  averageOperationTime: Float!
  operationsByType: JSON!
  lastOperationAt: String
}
```

### **TypeScript API**

```typescript
class ModuleManagementResolverService {
  // Main Operations
  async resetModule(input: ResetModuleInput, context?: any): Promise<boolean>
  async getModules(): Promise<ModuleInfo[]>
  async getModuleHealth(): Promise<ModuleHealthStatus[]>

  // Legacy Operations (backward compatibility)
  async resetModuleLegacy(moduleName: string): Promise<boolean>

  // Statistics & Monitoring
  getStatistics(): ResolverStatistics
  resetStatistics(): void
  getHealthStatus(): HealthStatus

  // Internal Methods
  private validateResetModuleInput(input: ResetModuleInput): ValidationResult
  private checkAuthorization(context: AuthorizationContext, operation: OperationContext): Promise<AuthorizationResult>
  private recordOperation(operationName: string, duration: number, metadata?: any): void
}
```

### **Interfaces**

```typescript
interface ResetModuleInput {
  moduleName: string;
}

interface ModuleInfo {
  id: string;
  name: string;
  version?: string;
  description?: string;
}

interface ModuleHealthStatus {
  id: string;
  name: string;
  healthy: boolean;
  lastChecked: Date;
  responseTime?: number;
  error?: string;
}

interface ResolverStatistics {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageOperationTime: number;
  operationsByType: Map<string, number>;
  lastOperationAt?: Date;
}

interface ModuleOperationResult {
  success: boolean;
  moduleName: string;
  duration: number;
  error?: string;
}
```

---

## 2. TemplateResolverService

### **GraphQL Schema**

```graphql
type Query {
  getModuleTemplate(moduleName: String!): TemplateResponse!
  getClassTemplate(moduleName: String!, className: String!): TemplateResponse!
  getClassGuide(moduleName: String!, className: String!): TemplateResponse!
}

type TemplateResponse {
  template: String!
  metadata: TemplateMetadata!
}

type TemplateMetadata {
  moduleName: String!
  className: String
  type: TemplateType!
  version: String
  generatedAt: String!
  cached: Boolean!
  cacheHit: Boolean!
}

enum TemplateType {
  MODULE
  CLASS
  GUIDE
}
```

### **TypeScript API**

```typescript
class TemplateResolverService {
  // Template Operations
  async getModuleTemplate(moduleName: string, context?: any): Promise<TemplateResponse>
  async getClassTemplate(moduleName: string, className: string, context?: any): Promise<TemplateResponse>
  async getClassGuide(moduleName: string, className: string, context?: any): Promise<TemplateResponse>

  // Legacy Operations (backward compatibility)
  async getModuleTemplateLegacy(moduleName: string): Promise<string>
  async getClassTemplateLegacy(moduleName: string, className: string): Promise<string>
  async getClassGuideLegacy(moduleName: string, className: string): Promise<string>

  // Cache Management
  getCacheStatistics(): CacheStatistics
  invalidateModuleCache(moduleName: string): void

  // Statistics & Monitoring
  getStatistics(): TemplateOperationStatistics
  resetStatistics(): void
  getHealthStatus(): HealthStatus

  // Internal Methods
  private validateTemplateRequest(request: TemplateRequest): TemplateValidationResult
  private checkModuleHealth(moduleName: string): Promise<boolean>
  private checkAuthorization(context: AuthorizationContext, operation: OperationContext): Promise<AuthorizationResult>
  private recordOperation(operationName: string, duration: number, metadata?: any): void
}
```

### **Interfaces**

```typescript
interface TemplateRequest {
  moduleName: string;
  className?: string;
  type: 'module' | 'class' | 'guide';
}

interface TemplateResponse {
  template: string;
  metadata: TemplateMetadata;
}

interface TemplateMetadata {
  moduleName: string;
  className?: string;
  type: 'module' | 'class' | 'guide';
  version?: string;
  generatedAt: string;
  cached: boolean;
  cacheHit: boolean;
}

interface TemplateOperationResult {
  success: boolean;
  template?: string;
  metadata?: TemplateMetadata;
  duration: number;
  error?: string;
}

interface TemplateValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

interface ModuleTemplateInfo {
  moduleName: string;
  available: boolean;
  healthy: boolean;
  lastChecked: Date;
  error?: string;
}

interface TemplateOperationStatistics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  cacheHitRate: number;
  requestsByModule: Map<string, number>;
  requestsByType: Map<string, number>;
  timeoutCount: number;
  lastRequestAt?: Date;
}
```

---

## 3. IssueResolverService

### **GraphQL Schema**

```graphql
type Issue {
  # ... other Issue fields
  syncedAttributes: SyncedAttributesResponse!
}

type SyncedAttributesResponse {
  attributes: JSON!
  _metadata: SyncMetadata!
}

type SyncMetadata {
  lastSyncAt: String!
  syncedAt: String!
  synced: Boolean!
  message: String
}
```

### **TypeScript API**

```typescript
class IssueResolverService {
  // Main Resolver (attached to Issue type)
  getResolvers(): ResolverMap

  // Statistics & Monitoring
  getStatistics(): IssueOperationStatistics
  resetStatistics(): void
  getHealthStatus(): HealthStatus

  // Internal Methods
  private getUpdatedIssue(issueId: string, attributes: string | null, moduleName: string, lastSyncAt: string | null, context?: AuthorizationContext): Promise<SyncResult>
  private setSyncedDate(issueId: string): Promise<DatabaseOperationResult<string>>
  private parseAttributes(attributesJson: string | null): IssueAttributes
  private validateSyncRequest(request: SyncRequest): SyncValidationResult
  private validateResolverInput(input: IssueResolverInput): SyncValidationResult
  private recordSyncOperation(moduleName: string, success: boolean, duration: number): void
  private performSyncWithFallback(issueId: string, attributes: string | null, moduleName: string, lastSyncAt: string | null, authContext: AuthorizationContext): Promise<SyncedAttributesResponse>
}
```

### **Interfaces**

```typescript
interface IssueResolverInput {
  id: string;
  attributes: string | null;
  issueClass: Array<{
    module: Array<{
      name: string;
    }>;
  }>;
  lastSyncAt: string | null;
}

interface SyncedAttributesResponse {
  attributes: IssueAttributes;
  _metadata: SyncMetadata;
}

interface SyncMetadata {
  lastSyncAt: string;
  syncedAt: string;
  synced: boolean;
  message: string | null;
}

interface IssueAttributes {
  [key: string]: any;
}

interface SyncRequest {
  issueId: string;
  attributes: string | null;
  moduleName: string;
  lastSyncAt: string | null;
}

interface SyncResult {
  success: boolean;
  attributes: IssueAttributes;
  metadata: SyncMetadata;
  duration: number;
  error?: string;
}

interface SyncValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

interface DatabaseOperationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  duration: number;
}

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
```

---

## 4. AnalysisResolverService

### **GraphQL Schema**

```graphql
type Query {
  getAnalysisStatus(analysisId: String!): AnalysisStatusResult!
  getAnalysisValueKeys(analysisId: String!): [String!]!
  getAnalysisValues(analysisId: String!, keys: [String!]!): JSON!
  getDocument(analysisId: String!, documentId: String!): DocumentResult!
}

type Mutation {
  runAnalysis(input: AnalysisRequest!): AnalysisOperationResult!
  startChat(input: ChatAnalysisRequest!): AnalysisOperationResult!
  resumeAnalysis(input: ResumeAnalysisRequest!): AnalysisOperationResult!
  deleteAnalysis(analysisId: String!): Boolean!
}

type Subscription {
  analysisUpdates(analysisId: String, scope: String): AnalysisStatusResult!
}

input AnalysisRequest {
  analysisId: String!
  scope: String
  parameters: JSON
}

input ChatAnalysisRequest {
  analysisId: String!
  message: String!
  context: JSON
}

input ResumeAnalysisRequest {
  analysisId: String!
  fromStep: String
  parameters: JSON
}

type AnalysisOperationResult {
  success: Boolean!
  analysisId: String!
  message: String!
  metadata: JSON
}

type AnalysisStatusResult {
  analysisId: String!
  status: AnalysisStatus!
  progress: Float
  results: JSON
  error: String
  startedAt: String
  completedAt: String
}

type DocumentResult {
  documentId: String!
  content: String!
  metadata: JSON!
}

enum AnalysisStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}
```

### **TypeScript API**

```typescript
class AnalysisResolverService implements OnModuleInit, OnModuleDestroy {
  // Lifecycle
  onModuleInit(): Promise<void>
  onModuleDestroy(): Promise<void>

  // Query Operations
  async getAnalysisStatus(analysisId: string, context?: any): Promise<AnalysisStatusResult>
  async getAnalysisValueKeys(analysisId: string, context?: any): Promise<string[]>
  async getAnalysisValues(analysisId: string, keys: string[], context?: any): Promise<any>
  async getDocument(analysisId: string, documentId: string, context?: any): Promise<DocumentResult>

  // Mutation Operations
  async runAnalysis(input: AnalysisRequest, context?: any): Promise<AnalysisOperationResult>
  async startChat(input: ChatAnalysisRequest, context?: any): Promise<AnalysisOperationResult>
  async resumeAnalysis(input: ResumeAnalysisRequest, context?: any): Promise<AnalysisOperationResult>
  async deleteAnalysis(analysisId: string, context?: any): Promise<boolean>

  // Statistics & Monitoring
  getStatistics(): AnalysisOperationStatistics
  resetStatistics(): void
  getHealthStatus(): HealthStatus
  getPubSubHealth(): PubSubHealthStatus

  // Internal Methods
  private getAnalysisMetadataWithCache(analysisId: string): Promise<AnalysisMetadata | null>
  private getAnalysisClassAndModule(analysisId: string): Promise<AnalysisMetadata | null>
  private deleteAnalysisNode(id: string): Promise<boolean>
  private validateAnalysisRequest(input: AnalysisRequest): AnalysisValidationResult
  private validateChatAnalysisRequest(input: ChatAnalysisRequest): AnalysisValidationResult
  private validateResumeAnalysisRequest(input: ResumeAnalysisRequest): AnalysisValidationResult
  private validateDocumentRequest(input: DocumentRequest): AnalysisValidationResult
  private validateAnalysisValuesRequest(input: AnalysisValuesRequest): AnalysisValidationResult
  private checkAuthorization(context: AuthorizationContext, operation: OperationContext): Promise<AuthorizationResult>
  private recordOperation(operationName: string, duration: number, metadata?: any): void
  private configurePubSub(): void
  private trackSubscriptionSession(analysisId: string, scope?: string): void
  private cleanupInactiveAnalyses(): void
  private cleanupInactiveSubscriptions(): void
}
```

### **Interfaces**

```typescript
interface AnalysisMetadata {
  analysisClassId: string;
  moduleName: string;
  elementId: string;
}

interface AnalysisRequest {
  analysisId: string;
  scope?: string;
  parameters?: any;
}

interface ChatAnalysisRequest {
  analysisId: string;
  message: string;
  context?: any;
}

interface ResumeAnalysisRequest {
  analysisId: string;
  fromStep?: string;
  parameters?: any;
}

interface DocumentRequest {
  analysisId: string;
  documentId: string;
}

interface AnalysisValuesRequest {
  analysisId: string;
  keys: string[];
}

interface AnalysisOperationResult {
  success: boolean;
  analysisId: string;
  message: string;
  metadata?: any;
}

interface AnalysisSessionResult {
  analysisId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  results?: any;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

interface AnalysisStatusResult extends AnalysisSessionResult {}

interface DocumentResult {
  documentId: string;
  content: string;
  metadata: any;
}

interface AnalysisValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

interface DatabaseQueryResult {
  success: boolean;
  data?: any;
  error?: string;
  duration: number;
}

interface DatabaseTransaction {
  run(query: string, parameters?: any): Promise<any>;
}

interface AnalysisOperationStatistics {
  totalAnalyses: number;
  activeAnalyses: number;
  completedAnalyses: number;
  failedAnalyses: number;
  averageAnalysisTime: number;
  analysesByModule: Map<string, number>;
  analysesByStatus: Map<string, number>;
  subscriptionCount: number;
  cacheHitRate: number;
  lastAnalysisAt?: Date;
}

interface LongRunningAnalysis {
  analysisId: string;
  startedAt: Date;
  promise: Promise<any>;
  scope?: string;
}

interface SubscriptionSession {
  analysisId?: string;
  scope?: string;
  startedAt: Date;
  lastActivity: Date;
}

interface PubSubHealthStatus {
  healthy: boolean;
  activeSubscriptions: number;
  maxListeners: number;
  memoryUsage: number;
  error?: string;
}

interface AnalysisModuleHealth {
  moduleName: string;
  healthy: boolean;
  responseTime?: number;
  lastChecked: Date;
  error?: string;
}

enum AnalysisErrorType {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  MODULE_ERROR = 'MODULE_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

interface AnalysisError {
  type: AnalysisErrorType;
  message: string;
  analysisId?: string;
  moduleName?: string;
  stack?: string;
  timestamp: Date;
}

interface AnalysisResolverConfig {
  cacheSize: number;
  cacheTtlMs: number;
  pubSubMaxListeners: number;
  cleanupIntervalMs: number;
  subscriptionTimeoutMs: number;
  analysisTimeoutMs: number; // 0 = no timeout
}
```

---

## 5. SetInstantiationAttributesService

### **GraphQL Schema**

```graphql
type Mutation {
  linkToExternalObject(input: LinkExternalObjectRequest!): Boolean!
  deleteObsoleteExternalObjects(input: DeleteObsoleteExternalObjectsRequest!): Boolean!
  upsertExposure(input: UpsertExposureRequest!): Boolean!
  upsertCountermeasures(input: UpsertCountermeasuresRequest!): Boolean!
  setAttributes(input: SetAttributesRequest!): Boolean!
}

input LinkExternalObjectRequest {
  componentId: String!
  externalObjectId: String!
  objectType: String!
  metadata: JSON
}

input DeleteObsoleteExternalObjectsRequest {
  componentId: String!
  validObjectIds: [String!]!
  objectType: String!
}

input UpsertExposureRequest {
  componentId: String!
  exposureData: JSON!
  metadata: JSON
}

input UpsertCountermeasuresRequest {
  componentId: String!
  countermeasures: [JSON!]!
  metadata: JSON
}

input SetAttributesRequest {
  componentId: String!
  attributes: JSON!
  metadata: JSON
}
```

### **TypeScript API**

```typescript
class SetInstantiationAttributesService implements OnModuleInit, OnModuleDestroy {
  // Lifecycle
  onModuleInit(): Promise<void>
  onModuleDestroy(): Promise<void>

  // Mutation Operations
  async linkToExternalObject(input: LinkExternalObjectRequest, context?: any): Promise<boolean>
  async deleteObsoleteExternalObjects(input: DeleteObsoleteExternalObjectsRequest, context?: any): Promise<boolean>
  async upsertExposure(input: UpsertExposureRequest, context?: any): Promise<boolean>
  async upsertCountermeasures(input: UpsertCountermeasuresRequest, context?: any): Promise<boolean>
  async setAttributes(input: SetAttributesRequest, context?: any): Promise<boolean>

  // Statistics & Monitoring
  getStatistics(): SetInstantiationAttributesOperationStatistics
  resetStatistics(): void
  getHealthStatus(): HealthStatus

  // Internal Methods
  private validateLinkExternalObjectRequest(input: LinkExternalObjectRequest): SetAttributesValidationResult
  private validateDeleteObsoleteExternalObjectsRequest(input: DeleteObsoleteExternalObjectsRequest): SetAttributesValidationResult
  private validateUpsertExposureRequest(input: UpsertExposureRequest): SetAttributesValidationResult
  private validateUpsertCountermeasuresRequest(input: UpsertCountermeasuresRequest): SetAttributesValidationResult
  private validateSetAttributesRequest(input: SetAttributesRequest): SetAttributesValidationResult
  private checkAuthorization(context: AuthorizationContext, operation: OperationContext): Promise<AuthorizationResult>
  private recordOperation(operationName: string, duration: number, metadata?: any): void
  private executeWithConcurrencyControl<T>(resourceId: string, operation: () => Promise<T>): Promise<T>
  private debouncedSetAttributes(input: SetAttributesRequest): Promise<SetAttributesResult>
  private performDatabaseOperation(componentId: string, attributes: any): Promise<DatabaseOperationResult>
  private getBatchProcessingMetrics(): BatchProcessingMetrics
  private getConcurrencyControlMetrics(): ConcurrencyControlMetrics
}
```

### **Interfaces**

```typescript
interface LinkExternalObjectRequest {
  componentId: string;
  externalObjectId: string;
  objectType: string;
  metadata?: any;
}

interface DeleteObsoleteExternalObjectsRequest {
  componentId: string;
  validObjectIds: string[];
  objectType: string;
}

interface UpsertExposureRequest {
  componentId: string;
  exposureData: any;
  metadata?: any;
}

interface UpsertCountermeasuresRequest {
  componentId: string;
  countermeasures: any[];
  metadata?: any;
}

interface SetAttributesRequest {
  componentId: string;
  attributes: any;
  metadata?: any;
}

interface SetAttributesResult {
  success: boolean;
  componentId: string;
  attributesSet: number;
  duration: number;
  error?: string;
}

interface SetAttributesValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

interface DatabaseOperationResult {
  success: boolean;
  data?: any;
  error?: string;
  duration: number;
}

interface BatchRequest {
  componentId: string;
  attributes: any;
  metadata?: any;
  timestamp: Date;
}

interface BatchProcessingMetrics {
  totalBatches: number;
  averageBatchSize: number;
  averageProcessingTime: number;
  debouncedOperations: number;
  immediateOperations: number;
  lastBatchAt?: Date;
}

interface ConcurrencyControlMetrics {
  activeOperations: number;
  queuedOperations: number;
  averageWaitTime: number;
  concurrentOperationAttempts: number;
  maxConcurrentOperations: number;
}

interface SetInstantiationAttributesConfig {
  debounceMs: number;
  maxBatchSize: number;
  batchTimeoutMs: number;
  concurrencyLimit: number;
}

interface SetInstantiationAttributesOperationStatistics {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageOperationTime: number;
  operationsByType: Map<string, number>;
  batchProcessingMetrics: BatchProcessingMetrics;
  concurrencyControlMetrics: ConcurrencyControlMetrics;
  lastOperationAt?: Date;
}

enum SetInstantiationAttributesErrorType {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  CONCURRENCY_ERROR = 'CONCURRENCY_ERROR',
  BATCH_PROCESSING_ERROR = 'BATCH_PROCESSING_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

interface SetInstantiationAttributesError {
  type: SetInstantiationAttributesErrorType;
  message: string;
  componentId?: string;
  operation?: string;
  stack?: string;
  timestamp: Date;
}
```

---

## 6. Shared Services API

### **AuthorizationService**

```typescript
class AuthorizationService {
  async checkAuthorization(
    context: AuthorizationContext, 
    operation: OperationContext
  ): Promise<AuthorizationResult>
  
  extractAuthContext(context: any): AuthorizationContext
}

interface AuthorizationContext {
  user?: {
    id: string;
    roles: string[];
    permissions: string[];
  };
  request?: {
    ip: string;
    userAgent: string;
  };
}

interface OperationContext {
  operationType: 'query' | 'mutation' | 'subscription';
  operationName: string;
  resourceType: string;
  resourceId?: string;
}

interface AuthorizationResult {
  allowed: boolean;
  reason?: string;
  level: 'ALLOW' | 'DENY' | 'CONDITIONAL';
}
```

### **MonitoringService**

```typescript
class MonitoringService {
  recordOperation(metrics: OperationMetrics): void
  getStatistics(): MonitoringStatistics
  resetStatistics(): void
  getHealthStatus(): HealthStatus
}

interface OperationMetrics {
  operationName: string;
  duration: number;
  success: boolean;
  timestamp: Date;
  metadata?: Record<string, any>;
}

interface MonitoringStatistics {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageOperationTime: number;
  operationsByName: Map<string, number>;
  operationsByStatus: Map<string, number>;
  lastOperationAt?: Date;
}

interface HealthStatus {
  healthy: boolean;
  uptime: number;
  memoryUsage: number;
  cpuUsage?: number;
  error?: string;
  lastChecked: Date;
}
```

### **TemplateCacheService**

```typescript
class TemplateCacheService {
  get(key: string): CachedItem | null
  set(key: string, value: any): void
  invalidateModule(moduleName: string): void
  getStatistics(): CacheStatistics
  getHealthStatus(): HealthStatus
}

interface CachedItem {
  value: any;
  timestamp: Date;
  ttl: number;
  hits: number;
}

interface CacheStatistics {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
  memoryUsage: number;
}
```

### **AnalysisCacheService**

```typescript
class AnalysisCacheService {
  getAnalysisMetadata(analysisId: string): AnalysisMetadata | null
  setAnalysisMetadata(analysisId: string, metadata: AnalysisMetadata): void
  invalidateAnalysis(analysisId: string): void
  getStatistics(): CacheStatistics
  getHealthStatus(): HealthStatus
}
```

---

## 📋 **Common Patterns**

### **Error Response Format**

All services follow a consistent error response format:

```typescript
interface ErrorResponse {
  success: false;
  error: {
    type: string;
    message: string;
    code?: string;
    details?: any;
  };
  timestamp: string;
}
```

### **Success Response Format**

```typescript
interface SuccessResponse<T = any> {
  success: true;
  data: T;
  metadata?: {
    duration: number;
    cached?: boolean;
    timestamp: string;
  };
}
```

### **Validation Result Format**

```typescript
interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}
```

### **Database Operation Result Format**

```typescript
interface DatabaseOperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  duration: number;
}
```

### **Statistics Format**

```typescript
interface ServiceStatistics {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageOperationTime: number;
  lastOperationAt?: Date;
}
```

### **Health Status Format**

```typescript
interface HealthStatus {
  healthy: boolean;
  uptime?: number;
  memoryUsage?: number;
  error?: string;
  lastChecked: Date;
  details?: Record<string, any>;
}
```

---

## 🔧 **Usage Examples**

### **Module Management**

```typescript
// Reset a module
const result = await moduleManagementResolver.resetModule({
  moduleName: "security-scanner"
});

// Get module health
const health = await moduleManagementResolver.getModuleHealth();
console.log(`Healthy modules: ${health.filter(h => h.healthy).length}`);
```

### **Template Generation**

```typescript
// Get module template
const template = await templateResolver.getModuleTemplate("scanner");
console.log(`Template cached: ${template.metadata.cached}`);

// Get class guide
const guide = await templateResolver.getClassGuide("scanner", "VulnerabilityClass");
```

### **Issue Synchronization**

```typescript
// The resolver is automatically called by GraphQL
// when accessing Issue.syncedAttributes field
const query = `
  query GetIssue($id: ID!) {
    issue(id: $id) {
      id
      title
      syncedAttributes {
        attributes
        _metadata {
          synced
          syncedAt
          message
        }
      }
    }
  }
`;
```

### **Analysis Operations**

```typescript
// Start analysis
const analysis = await analysisResolver.runAnalysis({
  analysisId: "analysis-123",
  scope: "security",
  parameters: { depth: 5 }
});

// Subscribe to updates
const subscription = `
  subscription AnalysisUpdates($analysisId: String!) {
    analysisUpdates(analysisId: $analysisId) {
      status
      progress
      results
    }
  }
`;
```

### **Set Attributes**

```typescript
// Set component attributes
const success = await setAttributesService.setAttributes({
  componentId: "comp-456",
  attributes: {
    exposureLevel: "HIGH",
    countermeasures: ["firewall", "encryption"]
  },
  metadata: {
    updatedBy: "user-123"
  }
});
```

---

## 📚 **Related Documentation**

- [Custom Resolver Services Documentation](./CUSTOM_RESOLVER_SERVICES_DOCUMENTATION.md)
- [Quick Reference Guide](./CUSTOM_RESOLVER_SERVICES_QUICK_REFERENCE.md)
- [GraphQL Schema Documentation](./schema/schema.graphql)
- [Module Integration Guide](../MODULE_REGISTRY_DOCUMENTATION.md)
