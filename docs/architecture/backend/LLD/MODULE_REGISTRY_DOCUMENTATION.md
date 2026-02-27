# ModuleRegistryService Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Configuration](#configuration)
4. [API Reference](#api-reference)
5. [Security Features](#security-features)
6. [Health Monitoring](#health-monitoring)
7. [Error Handling](#error-handling)
8. [Usage Examples](#usage-examples)
9. [Production Deployment](#production-deployment)
10. [Troubleshooting](#troubleshooting)

## Overview

The `ModuleRegistryService` is a production-ready service that dynamically loads, manages, and monitors external JavaScript modules that implement the `DTModule` interface. It provides comprehensive security, error handling, health monitoring, and observability features for enterprise deployments.

### Key Features
- **🔒 Security**: Module whitelisting, file validation, secure driver wrapping
- **🛡️ Resilience**: Retry logic, timeout protection, graceful degradation
- **📊 Monitoring**: Health checks, performance metrics, structured logging
- **⚙️ Configuration**: Environment-based settings with validation
- **🔄 Hot Reload**: Runtime module updates (configurable)
- **🎯 Type Safety**: Full TypeScript support with comprehensive interfaces

## Architecture

### Service Dependencies
```typescript
ModuleRegistryService
├── ConfigService (Configuration management)
├── Neo4j Driver (Database connection)
├── ModuleManagementService (Database operations)
└── Logger (Structured logging)
```

### Module Lifecycle
```
Discovery → Security Validation → Loading → Interface Validation → Registration → Health Monitoring
```

### Data Flow
```
File System → Module Loading → Validation → Registration → Resolver Integration → Health Tracking
```

## Configuration

### Environment Variables

#### Required
```bash
NODE_ENV=production  # Enables security features
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-password
```

#### Module Registry Specific
```bash
# Module Security (CRITICAL for production)
ALLOWED_MODULES=dethermine-module,dt-built-in-module  # Comma-separated whitelist
ENABLE_MODULE_HOT_RELOAD=false  # Disable in production

# Module Loading Configuration
CUSTOM_MODULES_PATH=custom_modules  # Path to modules directory
MODULE_LOAD_TIMEOUT=30000  # Timeout in milliseconds

# Note: enableModuleSecurityValidation is automatically true when NODE_ENV=production
```

### Configuration Class
```typescript
class GqlConfig {
  // Module Registry Configuration
  customModulesPath: string = 'custom_modules';
  allowedModules: string[] = [];
  enableModuleHotReload: boolean = true;
  moduleLoadTimeout: number = 30000;
  enableModuleSecurityValidation: boolean = true;
}
```

## API Reference

### Core Methods

#### `onModuleInit(): Promise<void>`
**Description**: Initializes the module registry during application startup.

**Process**:
1. Loads all modules from the custom modules directory
2. Validates security and interface compliance
3. Registers healthy modules with the database
4. Logs comprehensive initialization results

**Example**:
```typescript
// Called automatically by NestJS during application startup
await moduleRegistry.onModuleInit();
```

#### `getModuleByName(name: string): DTModule | undefined`
**Description**: Retrieves a healthy module instance by name.

**Parameters**:
- `name: string` - The name of the module to retrieve

**Returns**: 
- `DTModule | undefined` - Module instance if healthy, undefined otherwise

**Example**:
```typescript
const templateModule = moduleRegistry.getModuleByName('dethermine-module');
if (templateModule) {
  const template = await templateModule.getModuleTemplate();
}
```

#### `getAllModules(): Map<string, DTModule>`
**Description**: Returns all healthy module instances (backward compatibility).

**Returns**: `Map<string, DTModule>` - Map of module names to instances

**Example**:
```typescript
const allModules = moduleRegistry.getAllModules();
console.log(`Loaded ${allModules.size} healthy modules`);
```

#### `getAllModuleEntries(): Map<string, ModuleEntry>`
**Description**: Returns detailed information about all modules including metadata.

**Returns**: `Map<string, ModuleEntry>` - Complete module entries with metadata

**Example**:
```typescript
const entries = moduleRegistry.getAllModuleEntries();
for (const [name, entry] of entries) {
  console.log(`${name}: ${entry.isHealthy ? 'Healthy' : 'Unhealthy'}`);
}
```

### Health Monitoring

#### `getModuleHealth(): Promise<ModuleHealthStatus>`
**Description**: Performs comprehensive health check on all modules.

**Returns**: `Promise<ModuleHealthStatus>` - Detailed health status

**Example**:
```typescript
const health = await moduleRegistry.getModuleHealth();
console.log(`${health.healthyModules}/${health.totalModules} modules healthy`);
```

**Response Structure**:
```typescript
interface ModuleHealthStatus {
  totalModules: number;
  healthyModules: number;
  unhealthyModules: number;
  lastCheckAt: Date;
  modules: ModuleHealth[];
}
```

#### `checkModuleHealth(moduleName: string): Promise<ModuleHealth>`
**Description**: Performs health check on a specific module.

**Parameters**:
- `moduleName: string` - Name of the module to check

**Returns**: `Promise<ModuleHealth>` - Health status of the specific module

**Example**:
```typescript
const health = await moduleRegistry.checkModuleHealth('dethermine-module');
if (health.status === 'unhealthy') {
  console.error(`Module unhealthy: ${health.error}`);
}
```

#### `getModuleStatistics()`
**Description**: Returns comprehensive statistics for monitoring and analytics.

**Returns**: Statistics object with performance and usage metrics

**Example**:
```typescript
const stats = moduleRegistry.getModuleStatistics();
console.log(`Average load attempts: ${stats.totalLoadAttempts / stats.totalModules}`);
```

### Module Management

#### `reloadModule(moduleName: string): Promise<DTModule | null>`
**Description**: Hot reloads a specific module (if enabled).

**Parameters**:
- `moduleName: string` - Name of the module to reload

**Returns**: `Promise<DTModule | null>` - Reloaded module instance or null

**Security**: Only works if `enableModuleHotReload` is true

**Example**:
```typescript
const reloadedModule = await moduleRegistry.reloadModule('dethermine-module');
if (reloadedModule) {
  console.log('Module reloaded successfully');
} else {
  console.log('Module reload failed or disabled');
}
```

#### `resetModuleById(moduleId: string): Promise<boolean>`
**Description**: Resets a module by database ID.

**Parameters**:
- `moduleId: string` - Database ID of the module

**Returns**: `Promise<boolean>` - Success status

**Example**:
```typescript
const success = await moduleRegistry.resetModuleById('module-uuid');
if (success) {
  console.log('Module reset successfully');
}
```

## Security Features

### Module Whitelisting
```typescript
// Only these modules can be loaded
ALLOWED_MODULES=dethermine-module,dt-built-in-module
```

**Benefits**:
- Prevents unauthorized code execution
- Explicit control over loaded modules
- Audit trail of approved modules

### File Security Validation
```typescript
private async validateModuleSecurity(filePath: string, moduleName: string): Promise<ModuleSecurityValidation>
```

**Checks Performed**:
- ✅ Module name in whitelist
- ✅ File permissions (prevents world-writable files)
- ✅ File size limits (max 10MB)
- ✅ File age warnings (alerts for old files)

### Interface Validation
```typescript
private async validateModuleInterface(moduleInstance: DTModule): Promise<boolean>
```

**Validates**:
- ✅ Required `getMetadata()` method exists
- ✅ Metadata structure is valid
- ✅ Module name is properly defined

### Secure Driver Wrapper
```typescript
private createSecureDriver(): any
```

**Features**:
- 🔍 Logs all database access attempts
- 🛡️ Foundation for future access restrictions
- 📊 Audit trail for compliance

## Health Monitoring

### Real-time Health Checks
```typescript
// Automatic health validation with timeout
const metadata = await Promise.race([
  Promise.resolve(entry.instance.getMetadata()),
  new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error('Health check timeout')), 5000)
  )
]) as DTMetadata;
```

### Health Status Levels
- **`healthy`**: Module functioning normally
- **`unhealthy`**: Module has issues but is loaded
- **`loading`**: Module currently being checked
- **`failed`**: Module not found or completely broken

### Monitoring Integration
```typescript
// Example health check endpoint
@Get('health/modules')
async getModuleHealth() {
  return await this.moduleRegistry.getModuleHealth();
}
```

## Error Handling

### Retry Logic with Exponential Backoff
```typescript
private async loadModuleWithRetry(filePath: string, options: ModuleLoadOptions = {}): Promise<ModuleLoadResult>
```

**Features**:
- 🔄 Up to 3 retry attempts
- ⏱️ Exponential backoff (1s, 2s, 4s, max 10s)
- ⏰ Configurable timeout protection
- 🛡️ Graceful degradation on failure

### Error Classification
1. **Security Errors**: Whitelist violations, permission issues
2. **Loading Errors**: File not found, import failures, timeout
3. **Validation Errors**: Interface compliance, metadata issues
4. **Runtime Errors**: Module execution failures

### Structured Error Logging
```typescript
this.logger.error('Failed to load module', {
  filePath,
  error: error.message,
  stack: error.stack,
  loadTime: result.loadTime,
  attempt: currentAttempt,
});
```

## Usage Examples

### Basic Module Access
```typescript
@Injectable()
export class MyService {
  constructor(private moduleRegistry: ModuleRegistryService) {}

  async getTemplate(moduleName: string): Promise<string> {
    const module = this.moduleRegistry.getModuleByName(moduleName);
    if (!module) {
      throw new Error(`Module ${moduleName} not available`);
    }
    return await module.getModuleTemplate();
  }
}
```

### Health Check Integration
```typescript
@Controller('health')
export class HealthController {
  constructor(private moduleRegistry: ModuleRegistryService) {}

  @Get('modules')
  async getModuleHealth() {
    const health = await this.moduleRegistry.getModuleHealth();
    return {
      status: health.unhealthyModules === 0 ? 'healthy' : 'degraded',
      details: health
    };
  }

  @Get('modules/:name')
  async getSpecificModuleHealth(@Param('name') name: string) {
    return await this.moduleRegistry.checkModuleHealth(name);
  }
}
```

### Module Statistics for Monitoring
```typescript
@Injectable()
export class MonitoringService {
  constructor(private moduleRegistry: ModuleRegistryService) {}

  @Cron('0 */5 * * * *') // Every 5 minutes
  async collectModuleMetrics() {
    const stats = this.moduleRegistry.getModuleStatistics();
    
    // Send to monitoring system
    await this.metricsService.gauge('modules.total', stats.totalModules);
    await this.metricsService.gauge('modules.healthy', stats.healthyModules);
    await this.metricsService.gauge('modules.unhealthy', stats.unhealthyModules);
    
    if (stats.unhealthyModules > 0) {
      await this.alertService.sendAlert('Unhealthy modules detected', stats);
    }
  }
}
```

### Custom Resolver Integration
```typescript
@Injectable()
export class TemplateResolverService implements ResolverService {
  constructor(private moduleRegistry: ModuleRegistryService) {}

  async getModuleTemplate(moduleName: string): Promise<string> {
    const module = this.moduleRegistry.getModuleByName(moduleName);
    if (!module) {
      this.logger.warn(`Module not found: ${moduleName}`);
      return '';
    }

    try {
      return await module.getModuleTemplate();
    } catch (error) {
      this.logger.error(`Template fetch failed: ${moduleName}`, error);
      return '';
    }
  }

  getResolvers() {
    return {
      Module: {
        template: async ({ name }) => this.getModuleTemplate(name),
      },
    };
  }
}
```

## Module Implementation Guide

### Module Constructor

External modules are instantiated with both a secure Neo4j driver and a NestJS logger:

```typescript
import { Logger } from '@nestjs/common';
import { DTModule, DTMetadata } from '@dethernety/dt-module';

export default class MyCustomModule implements DTModule {
  constructor(
    private readonly driver: any,
    private readonly logger: Logger
  ) {
    this.logger.log('Module initialized successfully', {
      moduleName: 'MyCustomModule',
      timestamp: new Date().toISOString(),
    });
  }

  async getMetadata(): Promise<DTMetadata> {
    this.logger.debug('Metadata requested');
    
    return {
      name: 'my-custom-module',
      version: '1.0.0',
      description: 'Custom module with logging support',
      // ... other metadata
    };
  }

  async performOperation(data: any): Promise<any> {
    this.logger.log('Starting operation', {
      operation: 'performOperation',
      dataSize: JSON.stringify(data).length,
    });

    try {
      // Use Neo4j driver for database operations
      const session = this.driver.session();
      try {
        const result = await session.executeRead(async (tx: any) => {
          return await tx.run('MATCH (n) RETURN count(n) as count');
        });

        this.logger.debug('Database query completed', {
          recordCount: result.records.length,
        });

        return result.records;
      } finally {
        await session.close();
      }
    } catch (error) {
      this.logger.error('Operation failed', {
        operation: 'performOperation',
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }
}
```

### Logger Benefits

#### **Consistent Formatting**
All module logs follow the same structured format as the main application:
```typescript
this.logger.log('Message', { contextData: 'value' });
// Output: [Nest] 12345 - 2024/01/01, 12:00:00 LOG [Module:MyCustomModule] Message {"contextData":"value"}
```

#### **Context Awareness**
Each module gets a logger with its own context (`Module:ModuleName`):
- Easy filtering in log aggregation systems
- Clear identification of log source
- Consistent naming patterns

#### **Configuration Inheritance**
Modules inherit all logging configuration from the main application:
- Log levels (debug, info, warn, error)
- Output transports (console, file, external services)
- Formatting rules and timestamps
- Environment-specific settings

#### **Production Monitoring**
Structured logging enables:
- **Log Aggregation**: All logs collected in centralized systems
- **Alerting**: Set up alerts on module error patterns
- **Debugging**: Trace issues across application and modules
- **Metrics**: Extract performance metrics from logs

### Best Practices for Module Logging

#### **Use Appropriate Log Levels**
```typescript
// Debug: Detailed information for development
this.logger.debug('Processing item', { itemId, step: 'validation' });

// Info: General information about operations
this.logger.log('Operation completed', { duration: 150, itemsProcessed: 42 });

// Warn: Potentially harmful situations
this.logger.warn('Deprecated API used', { apiVersion: '1.0', caller: 'getTemplate' });

// Error: Error events but application continues
this.logger.error('External service failed', { service: 'GitLab', error: error.message });
```

#### **Include Context Information**
```typescript
// Good: Structured context data
this.logger.log('Analysis completed', {
  analysisId: 'analysis-123',
  duration: 45000,
  nodesAnalyzed: 156,
  threatsFound: 3,
});

// Avoid: Unstructured strings
this.logger.log('Analysis analysis-123 completed in 45s with 156 nodes and 3 threats');
```

#### **Error Handling with Logging**
```typescript
async performComplexOperation(input: any): Promise<any> {
  const operationId = `op-${Date.now()}`;
  
  try {
    this.logger.log('Starting complex operation', {
      operationId,
      inputSize: Object.keys(input).length,
    });

    const result = await this.processData(input);
    
    this.logger.log('Complex operation completed', {
      operationId,
      success: true,
      resultSize: result.length,
    });

    return result;
  } catch (error) {
    this.logger.error('Complex operation failed', {
      operationId,
      error: error.message,
      stack: error.stack,
      input: JSON.stringify(input).substring(0, 200), // Truncate for safety
    });
    
    throw error; // Re-throw for proper error handling
  }
}
```

#### **Performance Monitoring**
```typescript
async performTimedOperation(): Promise<any> {
  const startTime = Date.now();
  const operationId = `timed-${startTime}`;

  try {
    this.logger.debug('Operation started', { operationId });

    const result = await this.heavyComputation();
    
    const duration = Date.now() - startTime;
    this.logger.log('Operation completed', {
      operationId,
      duration,
      performance: duration > 5000 ? 'slow' : 'fast',
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    this.logger.error('Operation failed', {
      operationId,
      duration,
      error: error.message,
    });
    throw error;
  }
}
```

## Production Deployment

### Pre-Deployment Checklist
- [ ] Configure `ALLOWED_MODULES` environment variable
- [ ] Set `ENABLE_MODULE_HOT_RELOAD=false` in production
- [ ] Verify module file permissions are secure
- [ ] Set up log aggregation for module events
- [ ] Configure health check endpoints
- [ ] Set up alerting for module failures

### Security Configuration
```bash
# Production environment
NODE_ENV=production
ALLOWED_MODULES=dethermine-module,dt-built-in-module
ENABLE_MODULE_HOT_RELOAD=false
MODULE_LOAD_TIMEOUT=30000
```

### Monitoring Setup
```typescript
// Kubernetes health probe
livenessProbe:
  httpGet:
    path: /health/modules
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /health/modules
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
```

### Log Analysis
```bash
# Find module loading issues
kubectl logs -f deployment/app | grep "Module.*failed"

# Monitor module health
kubectl logs -f deployment/app | grep "Module health"

# Security events
kubectl logs -f deployment/app | grep "Security validation"
```

## Troubleshooting

### Common Issues

#### Module Not Loading
**Symptoms**: Module not found in registry
**Causes**:
- Module not in `ALLOWED_MODULES` list
- File permission issues
- Module file not found
- Interface validation failure

**Solutions**:
```bash
# Check if module is whitelisted
echo $ALLOWED_MODULES

# Verify file exists and permissions
ls -la custom_modules/*/

# Check application logs
grep "Failed to load module" logs/app.log
```

#### Security Validation Failures
**Symptoms**: "Security validation failed" errors
**Causes**:
- Module not in whitelist
- World-writable files
- File too large

**Solutions**:
```bash
# Fix file permissions
chmod 644 custom_modules/*/*.js

# Add module to whitelist
export ALLOWED_MODULES="dethermine-module,dt-built-in-module,new-module"
```

#### Health Check Failures
**Symptoms**: Modules marked as unhealthy
**Causes**:
- Module `getMetadata()` method failing
- Timeout during health check
- Module internal errors

**Solutions**:
```typescript
// Check specific module health
const health = await moduleRegistry.checkModuleHealth('module-name');
console.log(health);

// Reload problematic module
await moduleRegistry.reloadModule('module-name');
```

#### Performance Issues
**Symptoms**: Slow module loading, high load times
**Causes**:
- Large module files
- Network issues (if modules are remote)
- Database connection issues

**Solutions**:
```bash
# Increase timeout
export MODULE_LOAD_TIMEOUT=60000

# Check module file sizes
du -h custom_modules/*/*.js

# Monitor load times
grep "loadTime" logs/app.log
```

### Debug Mode
```bash
# Enable debug logging
export LOG_LEVEL=debug

# Module-specific debugging
export DEBUG=module-registry:*
```

### Logging Levels
- **ERROR**: Critical failures, security violations
- **WARN**: Non-critical issues, performance warnings
- **LOG**: Normal operations, successful loads
- **DEBUG**: Detailed operation information

### Performance Monitoring
```typescript
// Monitor module load performance
const stats = moduleRegistry.getModuleStatistics();
console.log(`Average load time: ${stats.averageLoadTime}ms`);

// Track module usage
const entries = moduleRegistry.getAllModuleEntries();
for (const [name, entry] of entries) {
  console.log(`${name}: ${entry.loadAttempts} attempts`);
}
```

## Best Practices

### Security
1. **Always use whitelisting** in production
2. **Disable hot reload** in production environments
3. **Monitor file permissions** regularly
4. **Set up security alerts** for validation failures

### Performance
1. **Use appropriate timeouts** for your environment
2. **Monitor module load times** and set alerts
3. **Keep modules small** (under 1MB recommended)
4. **Use async operations** for module loading

### Monitoring
1. **Set up comprehensive health checks**
2. **Monitor module statistics** regularly
3. **Use structured logging** for better analysis
4. **Set up alerts** for critical failures

### Development
1. **Test modules thoroughly** before production
2. **Use version control** for module deployments
3. **Document module interfaces** clearly
4. **Follow DTModule interface** strictly

The `ModuleRegistryService` provides a robust, secure, and production-ready foundation for dynamic module management in enterprise environments.
