# 🔧 Comprehensive Configuration Guide

This guide covers all environment variables and configuration options for the Dethernety API application.

---

## 📋 **Quick Start Templates**

### **Development (.env)**
```bash
# Application Settings
NODE_ENV=development
PORT=3003
LOG_LEVEL=debug

# Neo4j Database
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=neo4j
NEO4J_DATABASE=neo4j
NEO4J_ENCRYPTED=false
NEO4J_TRUST_CERT=true

# GraphQL
GQL_ENABLE_SUBSCRIPTIONS=true

# Module Registry
CUSTOM_MODULES_PATH=custom_modules
ALLOWED_MODULES=dethermine-module,dt-built-in-module
ENABLE_MODULE_HOT_RELOAD=true
```

### **Production (.env.production)**
```bash
# Application Settings
NODE_ENV=production
PORT=3000
LOG_LEVEL=log
ALLOWED_ORIGINS=https://yourdomain.com,https://api.yourdomain.com

# Neo4j Database (Production)
NEO4J_URI=neo4j+s://your-cluster.neo4j.io:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=${NEO4J_PASSWORD}
NEO4J_DATABASE=production
NEO4J_ENCRYPTED=true
NEO4J_TRUST_CERT=false
NEO4J_MAX_POOL_SIZE=100

# Authentication
OIDC_JKWS_URI=https://your-auth-provider.com/.well-known/jwks.json

# GraphQL Security
GQL_QUERY_DEPTH_LIMIT=10
GQL_QUERY_COMPLEXITY_LIMIT=1000

# Module Registry (Production)
ALLOWED_MODULES=dethermine-module,dt-built-in-module
ENABLE_MODULE_HOT_RELOAD=false
```

---

## 🏗️ **Application Settings**

### **Core Application**

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `NODE_ENV` | String | `development` | Environment mode (`development`, `production`, `test`) | No |
| `PORT` | Number | `3003` | Port number for the application (1-65535) | No |
| `LOG_LEVEL` | String | `log` | Logging level (`error`, `warn`, `log`, `debug`, `verbose`) | No |

### **Security & CORS**

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `ALLOWED_ORIGINS` | String | - | Comma-separated list of allowed CORS origins | Production |

**Examples:**
```bash
# Development - Allow all origins
# ALLOWED_ORIGINS not set (allows all)

# Production - Specific domains only
ALLOWED_ORIGINS=https://app.yourdomain.com,https://admin.yourdomain.com
```

---

## 🗄️ **Neo4j Database Configuration**

### **Connection Settings**

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `NEO4J_URI` | String | `bolt://localhost:7687` | Neo4j connection URI | Yes |
| `NEO4J_USERNAME` | String | `neo4j` | Database username | Yes |
| `NEO4J_PASSWORD` | String | - | Database password | Yes |
| `NEO4J_DATABASE` | String | `neo4j` | Database name | No |

**URI Examples:**
```bash
# Local development
NEO4J_URI=bolt://localhost:7687

# Docker container
NEO4J_URI=bolt://neo4j-container:7687

# Neo4j Aura (Cloud)
NEO4J_URI=neo4j+s://your-cluster.databases.neo4j.io:7687

# Self-hosted with TLS
NEO4J_URI=neo4j+s://your-server.com:7687
```

### **Connection Pool Settings**

| Variable | Type | Default | Description | Range |
|----------|------|---------|-------------|-------|
| `NEO4J_MAX_POOL_SIZE` | Number | `50` | Maximum connection pool size | 1-1000 |
| `NEO4J_CONNECTION_TIMEOUT` | Number | `30000` | Connection timeout (ms) | 1000+ |
| `NEO4J_CONNECT_TIMEOUT` | Number | `5000` | Initial connect timeout (ms) | 1000+ |
| `NEO4J_MAX_CONNECTION_LIFETIME` | Number | `3600000` | Max connection lifetime (ms) | 1000+ |
| `NEO4J_MAX_RETRY_TIME` | Number | `30000` | Max transaction retry time (ms) | 1000+ |

**Production Recommendations:**
```bash
# High-traffic production
NEO4J_MAX_POOL_SIZE=100
NEO4J_CONNECTION_TIMEOUT=60000
NEO4J_MAX_CONNECTION_LIFETIME=7200000  # 2 hours

# Development
NEO4J_MAX_POOL_SIZE=10
NEO4J_CONNECTION_TIMEOUT=30000
NEO4J_MAX_CONNECTION_LIFETIME=3600000  # 1 hour
```

### **Security Settings**

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `NEO4J_ENCRYPTED` | Boolean | `true` | Enable TLS encryption | No |
| `NEO4J_TRUST_CERT` | Boolean | `false` | Trust self-signed certificates | No |

**Security Configurations:**
```bash
# Production (secure)
NEO4J_ENCRYPTED=true
NEO4J_TRUST_CERT=false

# Development with self-signed certs
NEO4J_ENCRYPTED=false
NEO4J_TRUST_CERT=true

# Local Docker development
NEO4J_ENCRYPTED=false
NEO4J_TRUST_CERT=true
```

### **Monitoring Settings**

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `NEO4J_ENABLE_METRICS` | Boolean | `true` | Enable performance metrics |
| `NEO4J_ENABLE_LOGGING` | Boolean | `true` | Enable database operation logging |
| `NEO4J_HEALTH_CHECK_INTERVAL` | Number | `60000` | Health check interval (ms) |
| `NEO4J_DEBUG` | Boolean | `false` | Enable debug logging |

---

## 🚀 **GraphQL Configuration**

### **Schema & API Settings**

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `GQL_ENABLE_SUBSCRIPTIONS` | Boolean | `true` | Enable GraphQL subscriptions | No |

### **Security & Limits**

| Variable | Type | Default | Description | Range |
|----------|------|---------|-------------|-------|
| `GQL_QUERY_DEPTH_LIMIT` | Number | `10` | Maximum query depth | 1-50 |
| `GQL_QUERY_COMPLEXITY_LIMIT` | Number | `1000` | Maximum query complexity | 100-10000 |

**Security Examples:**
```bash
# Restrictive (high security)
GQL_QUERY_DEPTH_LIMIT=5
GQL_QUERY_COMPLEXITY_LIMIT=500

# Moderate (balanced)
GQL_QUERY_DEPTH_LIMIT=10
GQL_QUERY_COMPLEXITY_LIMIT=1000

# Permissive (development)
GQL_QUERY_DEPTH_LIMIT=20
GQL_QUERY_COMPLEXITY_LIMIT=5000
```

### **Authentication**

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `OIDC_JKWS_URI` | URL | - | OIDC JSON Web Key Set URI | Production |

**Authentication Examples:**
```bash
# Zitadel
OIDC_JKWS_URI=https://your-zitadel.com/.well-known/jwks.json

# Auth0
OIDC_JKWS_URI=https://your-domain.auth0.com/.well-known/jwks.json

# Keycloak
OIDC_JKWS_URI=https://keycloak.com/auth/realms/your-realm/protocol/openid-connect/certs
```

---

## 📦 **Module Registry Configuration**

### **Core Settings**

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `CUSTOM_MODULES_PATH` | String | `custom_modules` | Path to custom modules directory | No |
| `ALLOWED_MODULES` | String | - | Comma-separated list of allowed modules | Production |
| `ENABLE_MODULE_HOT_RELOAD` | Boolean | `true` | Enable hot reloading of modules | No |
| `MODULE_LOAD_TIMEOUT` | Number | `30000` | Module loading timeout (ms) | No |

**Security Examples:**
```bash
# Production (strict whitelist)
ALLOWED_MODULES=dethermine-module,dt-built-in-module,analytics-module
ENABLE_MODULE_HOT_RELOAD=false

# Development (permissive)
ALLOWED_MODULES=dethermine-module,dt-built-in-module,test-module,dev-module
ENABLE_MODULE_HOT_RELOAD=true

# Testing (specific modules)
ALLOWED_MODULES=test-module
ENABLE_MODULE_HOT_RELOAD=true
```

---

## 🗂️ **Caching Configuration**

### **Template Cache**

| Variable | Type | Default | Description | Range |
|----------|------|---------|-------------|-------|
| `TEMPLATE_CACHE_SIZE` | Number | `100` | Maximum cached templates | 10-1000 |
| `TEMPLATE_CACHE_TTL_MS` | Number | `300000` | Template cache TTL (5 min) | 60000-3600000 |

### **Analysis Cache**

| Variable | Type | Default | Description | Range |
|----------|------|---------|-------------|-------|
| `ANALYSIS_CACHE_SIZE` | Number | `50` | Maximum cached analyses | 10-500 |
| `ANALYSIS_CACHE_TTL_MS` | Number | `600000` | Analysis cache TTL (10 min) | 60000-3600000 |

**Cache Sizing Examples:**
```bash
# High-traffic production
TEMPLATE_CACHE_SIZE=500
TEMPLATE_CACHE_TTL_MS=600000
ANALYSIS_CACHE_SIZE=200
ANALYSIS_CACHE_TTL_MS=1200000

# Development
TEMPLATE_CACHE_SIZE=50
TEMPLATE_CACHE_TTL_MS=300000
ANALYSIS_CACHE_SIZE=25
ANALYSIS_CACHE_TTL_MS=600000
```

---

## ⏱️ **Operation Timeouts**

### **Service Timeouts**

| Variable | Type | Default | Description | Range |
|----------|------|---------|-------------|-------|
| `TEMPLATE_OPERATION_TIMEOUT_MS` | Number | `30000` | Template operation timeout | 5000-300000 |
| `ISSUE_SYNC_TIMEOUT_MS` | Number | `30000` | Issue sync timeout | 5000-300000 |

**Note:** Analysis operations intentionally have NO timeout as they can run for 15+ minutes.

### **Batch Processing**

| Variable | Type | Default | Description | Range |
|----------|------|---------|-------------|-------|
| `BATCH_PROCESSING_DEBOUNCE_MS` | Number | `1000` | Debounce delay for batch operations | 100-10000 |
| `BATCH_PROCESSING_MAX_SIZE` | Number | `50` | Maximum batch size | 1-1000 |
| `BATCH_PROCESSING_TIMEOUT_MS` | Number | `5000` | Batch processing timeout | 1000-60000 |

**Batch Processing Examples:**
```bash
# High-frequency updates (auto-save)
BATCH_PROCESSING_DEBOUNCE_MS=500
BATCH_PROCESSING_MAX_SIZE=100
BATCH_PROCESSING_TIMEOUT_MS=3000

# Standard processing
BATCH_PROCESSING_DEBOUNCE_MS=1000
BATCH_PROCESSING_MAX_SIZE=50
BATCH_PROCESSING_TIMEOUT_MS=5000
```

---

## 📊 **Monitoring & Health**

### **Monitoring Settings**

| Variable | Type | Default | Description | Range |
|----------|------|---------|-------------|-------|
| `MONITORING_ENABLED` | Boolean | `true` | Enable performance monitoring | - |
| `HEALTH_CHECK_INTERVAL_MS` | Number | `60000` | Health check interval | 10000-300000 |
| `STATISTICS_RETENTION_HOURS` | Number | `24` | How long to keep statistics | 1-168 |

**Monitoring Examples:**
```bash
# Production monitoring
MONITORING_ENABLED=true
HEALTH_CHECK_INTERVAL_MS=30000
STATISTICS_RETENTION_HOURS=48

# Development
MONITORING_ENABLED=true
HEALTH_CHECK_INTERVAL_MS=60000
STATISTICS_RETENTION_HOURS=24
```

---

## 🌍 **Environment-Specific Configurations**

### **Development Environment**
```bash
NODE_ENV=development
PORT=3003
LOG_LEVEL=debug

# Local Neo4j
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=bitnami1
NEO4J_ENCRYPTED=false
NEO4J_TRUST_CERT=true

# Permissive settings
ENABLE_MODULE_HOT_RELOAD=true
GQL_QUERY_DEPTH_LIMIT=20
GQL_QUERY_COMPLEXITY_LIMIT=5000

# Smaller caches
TEMPLATE_CACHE_SIZE=50
ANALYSIS_CACHE_SIZE=25
```

### **Staging Environment**
```bash
NODE_ENV=production
PORT=3000
LOG_LEVEL=log
ALLOWED_ORIGINS=https://staging.yourdomain.com

# Staging database
NEO4J_URI=neo4j+s://staging-cluster.neo4j.io:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=${NEO4J_PASSWORD}
NEO4J_ENCRYPTED=true
NEO4J_TRUST_CERT=false

# Production-like security
OIDC_JKWS_URI=https://staging-auth.yourdomain.com/.well-known/jwks.json
ALLOWED_MODULES=dethermine-module,dt-built-in-module
ENABLE_MODULE_HOT_RELOAD=false

# Moderate limits
GQL_QUERY_DEPTH_LIMIT=10
GQL_QUERY_COMPLEXITY_LIMIT=1000
```

### **Production Environment**
```bash
NODE_ENV=production
PORT=3000
LOG_LEVEL=log
ALLOWED_ORIGINS=https://app.yourdomain.com,https://api.yourdomain.com

# Production database
NEO4J_URI=neo4j+s://prod-cluster.neo4j.io:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=${NEO4J_PASSWORD}
NEO4J_DATABASE=production
NEO4J_ENCRYPTED=true
NEO4J_TRUST_CERT=false
NEO4J_MAX_POOL_SIZE=100

# Authentication required
OIDC_JKWS_URI=https://auth.yourdomain.com/.well-known/jwks.json

# Strict security
ALLOWED_MODULES=dethermine-module,dt-built-in-module
ENABLE_MODULE_HOT_RELOAD=false
GQL_QUERY_DEPTH_LIMIT=10
GQL_QUERY_COMPLEXITY_LIMIT=1000

# Optimized caching
TEMPLATE_CACHE_SIZE=500
TEMPLATE_CACHE_TTL_MS=600000
ANALYSIS_CACHE_SIZE=200
ANALYSIS_CACHE_TTL_MS=1200000

# Enhanced monitoring
HEALTH_CHECK_INTERVAL_MS=30000
STATISTICS_RETENTION_HOURS=48
```

---

## 🔧 **Configuration Validation**

The application automatically validates all environment variables at startup:

### **Validation Rules:**
- **Type checking**: Numbers, booleans, strings, URLs
- **Range validation**: Min/max values for numbers
- **Required fields**: Critical settings must be present
- **Production checks**: Additional validation in production mode

### **Production-Specific Validations:**
```bash
# These are REQUIRED in production:
NEO4J_PASSWORD=your-secure-password
OIDC_JKWS_URI=https://your-auth-provider.com/.well-known/jwks.json
ALLOWED_MODULES=module1,module2
ALLOWED_ORIGINS=https://yourdomain.com

# These must be secure in production:
ENABLE_MODULE_HOT_RELOAD=false
NEO4J_TRUST_CERT=false
```

---

## 🚀 **Quick Configuration Commands**

### **Check Current Configuration:**
```bash
# View environment variables
env | grep -E "NEO4J|GQL|MODULE|OIDC" | sort

# Test configuration validation
node -e "require('./dist/config/environment.validation').validateEnvironment(process.env)"
```

### **Set Development Environment:**
```bash
export NODE_ENV=development
export NEO4J_URI=bolt://localhost:7687
export NEO4J_USERNAME=neo4j
export NEO4J_PASSWORD=bitnami1
export NEO4J_ENCRYPTED=false
export NEO4J_TRUST_CERT=true
```

### **Test Database Connection:**
```bash
# Test Neo4j connection
curl -u neo4j:bitnami1 http://localhost:7474/db/data/

# Test application health
curl http://localhost:3003/health/simple
```

---

## 📋 **Configuration Checklist**

### **Before First Run:**
- [ ] Set `NEO4J_PASSWORD` to your database password
- [ ] Configure `ALLOWED_MODULES` for your modules
- [ ] Set appropriate `LOG_LEVEL` for your environment
- [ ] Configure `ALLOWED_ORIGINS` for production

### **Production Deployment:**
- [ ] `NODE_ENV=production`
- [ ] `OIDC_JKWS_URI` configured for authentication
- [ ] `ALLOWED_MODULES` whitelist configured
- [ ] `ENABLE_MODULE_HOT_RELOAD=false`
- [ ] `NEO4J_ENCRYPTED=true` for secure connections
- [ ] `ALLOWED_ORIGINS` restricted to your domains
- [ ] Connection pool sized appropriately
- [ ] Monitoring and health checks configured

### **Security Checklist:**
- [ ] Database password is secure and not hardcoded
- [ ] TLS encryption enabled for Neo4j in production
- [ ] Module hot reload disabled in production
- [ ] Query limits configured to prevent abuse
- [ ] CORS origins restricted to known domains
- [ ] Authentication provider configured

---

## 🆘 **Troubleshooting Configuration**

### **Common Issues:**

**Application won't start:**
```bash
# Check environment validation
node -e "require('./dist/config/environment.validation').validateEnvironment(process.env)"
```

**Database connection fails:**
```bash
# Check Neo4j connectivity
curl -u ${NEO4J_USERNAME}:${NEO4J_PASSWORD} http://localhost:7474/db/data/
```

**Module loading fails:**
```bash
# Check module permissions
ls -la custom_modules/*/

# Verify module whitelist
echo $ALLOWED_MODULES
```

**Performance issues:**
```bash
# Check health endpoint
curl http://localhost:3003/health

# Monitor database metrics
# Review connection pool settings
```

---

## 🎨 **Frontend Configuration (dt-ui)**

The frontend application uses standard environment variables that are injected at build time using a professional configuration system.

### **OIDC Authentication**

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `OIDC_ISSUER` | URL | - | OIDC provider issuer URL | Yes |
| `OIDC_CLIENT_ID` | String | - | OIDC client identifier | Yes |
| `OIDC_REDIRECT_URI` | URL | - | OAuth callback URL | Yes |
| `APP_URL` | URL | auto-detect | Application base URL | No |

**OIDC Coordination Examples:**
```bash
# Backend configuration
OIDC_JKWS_URI=https://auth.yourdomain.com/.well-known/jwks.json

# Frontend configuration (must match)
OIDC_ISSUER=https://auth.yourdomain.com
OIDC_CLIENT_ID=your-client-id
OIDC_REDIRECT_URI=https://yourdomain.com/auth/callback
```

### **API Configuration**

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `GRAPHQL_URL` | URL | auto-detect | GraphQL endpoint URL | No |
| `GRAPHQL_WS_URL` | URL | auto-detect | GraphQL WebSocket URL | No |
| `API_BASE_URL` | URL | auto-detect | Base API URL | No |

**API Configuration Examples:**
```bash
# Development (explicit URLs)
GRAPHQL_URL=http://localhost:3003/graphql
GRAPHQL_WS_URL=ws://localhost:3003/graphql
API_BASE_URL=http://localhost:3003

# Production (relative URLs - served by same backend)
GRAPHQL_URL=/graphql
GRAPHQL_WS_URL=  # Auto-detected (wss://yourdomain.com/graphql)
API_BASE_URL=
```

### **Application Configuration**

| Variable | Type | Default | Description | Required |
|----------|------|---------|-------------|----------|
| `APP_BASE_URL` | String | `/` | Base path for routing | No |
| `DEBUG_AUTH` | Boolean | `false` | Enable auth debug logging | No |
| `ENABLE_DEV_TOOLS` | Boolean | `false` | Enable development tools | No |

### **Environment Templates**

**Development (.env.local):**
```bash
# OIDC Configuration
OIDC_ISSUER=http://localhost:8080
OIDC_CLIENT_ID=dev-client-id
OIDC_REDIRECT_URI=http://localhost:3005/auth/callback

# API Configuration
GRAPHQL_URL=http://localhost:3003/graphql
GRAPHQL_WS_URL=ws://localhost:3003/graphql
API_BASE_URL=http://localhost:3003

# Debug Features
DEBUG_AUTH=true
ENABLE_DEV_TOOLS=true
```

**Production (build-time environment):**
```bash
# OIDC Configuration (must align with backend)
OIDC_ISSUER=https://auth.yourdomain.com
OIDC_CLIENT_ID=prod-client-id
OIDC_REDIRECT_URI=https://yourdomain.com/auth/callback

# API Configuration (relative URLs)
GRAPHQL_URL=/graphql
GRAPHQL_WS_URL=  # Auto-detected
API_BASE_URL=

# Production Settings
DEBUG_AUTH=false
ENABLE_DEV_TOOLS=false
```

---

## 🔄 **Frontend-Backend Configuration Alignment**

### **Critical Alignments**

1. **OIDC Provider Coordination:**
   ```bash
   # Backend validates tokens from this provider
   OIDC_JKWS_URI=https://auth.yourdomain.com/.well-known/jwks.json
   
   # Frontend authenticates with same provider
   OIDC_ISSUER=https://auth.yourdomain.com
   ```

2. **CORS and Redirect URIs:**
   ```bash
   # Backend allows requests from these origins
   ALLOWED_ORIGINS=https://yourdomain.com
   
   # Frontend redirects must be in allowed origins
   OIDC_REDIRECT_URI=https://yourdomain.com/auth/callback
   ```

3. **URL Consistency:**
   ```bash
   # Production: Frontend served by backend (same domain)
   GRAPHQL_URL=/graphql  # Relative URL
   
   # Development: Frontend on different port
   GRAPHQL_URL=http://localhost:3003/graphql  # Absolute URL
   ```

### **Configuration Validation**

**Check Backend Configuration:**
```bash
# Validate backend environment
node -e "require('./apps/dt-ws/dist/config/environment.validation').validateEnvironment(process.env)"
```

**Check Frontend Build Configuration:**
```bash
# Check build-time environment variables
cd apps/dt-ui
echo "OIDC Issuer: $OIDC_ISSUER"
echo "GraphQL URL: $GRAPHQL_URL"
echo "Redirect URI: $OIDC_REDIRECT_URI"
```

---

This configuration guide covers all available settings for your production-ready Dethernety application! 🚀
