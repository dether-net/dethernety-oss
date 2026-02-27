# ModuleRegistryService Quick Reference

## 🚀 Quick Start

### Environment Setup
```bash
# Required
NODE_ENV=production
ALLOWED_MODULES=dethermine-module,dt-built-in-module
ENABLE_MODULE_HOT_RELOAD=false

# Optional
CUSTOM_MODULES_PATH=custom_modules
MODULE_LOAD_TIMEOUT=30000
```

### Basic Usage
```typescript
// Get a module
const module = moduleRegistry.getModuleByName('dethermine-module');

// Check health
const health = await moduleRegistry.getModuleHealth();

// Get statistics
const stats = moduleRegistry.getModuleStatistics();
```

## 📋 API Quick Reference

| Method | Purpose | Returns |
|--------|---------|---------|
| `getModuleByName(name)` | Get module instance | `DTModule \| undefined` |
| `getAllModules()` | Get all healthy modules | `Map<string, DTModule>` |
| `getModuleHealth()` | Full health check | `Promise<ModuleHealthStatus>` |
| `checkModuleHealth(name)` | Single module health | `Promise<ModuleHealth>` |
| `reloadModule(name)` | Hot reload module | `Promise<DTModule \| null>` |
| `getModuleStatistics()` | Performance stats | `Statistics object` |

## 🔒 Security Checklist

- [ ] `ALLOWED_MODULES` configured
- [ ] `ENABLE_MODULE_HOT_RELOAD=false` in production
- [ ] Module files have correct permissions (644)
- [ ] Security validation enabled (`NODE_ENV=production`)

## 📊 Health Check Endpoints

```typescript
// All modules health
GET /health/modules

// Specific module health
GET /health/modules/:name

// Module statistics
GET /admin/modules/stats
```

## 🚨 Common Error Codes

| Error | Cause | Solution |
|-------|-------|----------|
| `Module not in allowed list` | Security whitelist | Add to `ALLOWED_MODULES` |
| `Module load timeout` | Slow loading | Increase `MODULE_LOAD_TIMEOUT` |
| `Security validation failed` | File permissions | Fix file permissions |
| `Interface validation failed` | Invalid module | Check DTModule implementation |

## 🔧 Troubleshooting Commands

```bash
# Check module files
ls -la custom_modules/*/

# View module logs
grep "Module" logs/app.log

# Test specific module
curl http://localhost:3000/health/modules/dethermine-module
```

## 📈 Monitoring Queries

```typescript
// Health status
const health = await moduleRegistry.getModuleHealth();
console.log(`${health.healthyModules}/${health.totalModules} healthy`);

// Performance metrics
const stats = moduleRegistry.getModuleStatistics();
console.log(`Avg load attempts: ${stats.totalLoadAttempts / stats.totalModules}`);

// Module versions
stats.modulesByVersion.forEach((count, version) => {
  console.log(`Version ${version}: ${count} modules`);
});
```

## 🎯 Production Configuration

### Secure Production Setup
```bash
NODE_ENV=production
ALLOWED_MODULES=dethermine-module,dt-built-in-module
ENABLE_MODULE_HOT_RELOAD=false
MODULE_LOAD_TIMEOUT=30000
LOG_LEVEL=info
```

### Development Setup
```bash
NODE_ENV=development
ALLOWED_MODULES=  # Empty = allow all
ENABLE_MODULE_HOT_RELOAD=true
MODULE_LOAD_TIMEOUT=10000
LOG_LEVEL=debug
```

## 🔄 Module Lifecycle

```
1. Discovery (scan custom_modules/)
2. Security Validation (whitelist, permissions)
3. Loading (import, instantiate)
4. Interface Validation (DTModule compliance)
5. Registration (add to registry)
6. Health Monitoring (ongoing)
```

## 📝 Logging Examples

```bash
# Successful load
[LOG] Module loaded successfully: dethermine-module v1.0.0

# Security warning
[WARN] Module security warnings: file is old (400 days)

# Load failure
[ERROR] Failed to load module: Security validation failed

# Health check
[DEBUG] Module health check passed: dethermine-module
```

## 🎪 Integration Examples

### Health Controller
```typescript
@Get('health/modules')
async getModuleHealth() {
  return await this.moduleRegistry.getModuleHealth();
}
```

### Template Resolver
```typescript
async getModuleTemplate(moduleName: string): Promise<string> {
  const module = this.moduleRegistry.getModuleByName(moduleName);
  return module ? await module.getModuleTemplate() : '';
}
```

### Monitoring Service
```typescript
@Cron('0 */5 * * * *')
async checkModuleHealth() {
  const health = await this.moduleRegistry.getModuleHealth();
  if (health.unhealthyModules > 0) {
    await this.alertService.alert('Unhealthy modules detected');
  }
}
```
