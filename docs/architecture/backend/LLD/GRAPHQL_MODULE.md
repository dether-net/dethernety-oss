# GraphQL Module Documentation

## Overview

The GraphQL module (`GqlModule`) provides a GraphQL API layer for the Dethernety application. It combines Neo4j's auto-generated GraphQL capabilities with custom business logic resolvers, error handling, security features, and monitoring capabilities.

## Architecture

The GraphQL module follows a layered architecture with clear separation of concerns. For an architecture overview with diagrams and detailed component interactions, see [ARCHITECTURE.md](./ARCHITECTURE.md).

### Directory Structure
```
src/gql/
├── gql.module.ts              # Main GraphQL module
├── gql.config.ts              # Configuration management
├── custom-resolver.module.ts   # Custom resolver providers
├── resolvers.constants.ts      # Constants for DI
├── interfaces/
│   └── resolver.interface.ts   # TypeScript interfaces
├── services/
│   └── schema.service.ts       # Schema management service
├── health/
│   └── gql-health.service.ts   # Health monitoring service
├── resolver-services/          # Custom resolver implementations
│   ├── template-resolver.service.ts
│   ├── module-management-resolver.service.ts
│   ├── analysis-resolver.service.ts
│   ├── issue-resolver.service.ts
│   └── set-instantiation-attributes.service.ts
├── README.md                   # Main documentation (this file)
├── ARCHITECTURE.md             # Detailed architecture overview
├── API_REFERENCE.md            # Complete API documentation
└── EXAMPLES.md                 # Implementation examples
```

## Core Components

### 1. GqlModule (`gql.module.ts`)

The main NestJS module that orchestrates the GraphQL setup.

#### Key Features
- **Neo4j Integration**: Automatic CRUD operations from GraphQL schema
- **Custom Resolvers**: Business logic resolvers for specialized functionality
- **Security**: Query depth/complexity limiting, error sanitization
- **Authentication**: OIDC JWT integration
- **Real-time**: GraphQL subscriptions support
- **Environment-based Configuration**: Different settings per environment

#### Configuration
```typescript
// Environment variables
NODE_ENV=production                    // Enables production security
NEO4J_URI=bolt://localhost:7687       // Neo4j connection
NEO4J_USERNAME=neo4j                  // Database username
NEO4J_PASSWORD=password               // Database password
OIDC_JKWS_URI=https://auth/.../jwks   // JWT validation endpoint
GQL_QUERY_DEPTH_LIMIT=10              // Max query nesting depth
GQL_QUERY_COMPLEXITY_LIMIT=1000       // Max query complexity score
```

#### Module Structure
```typescript
@Module({
  imports: [
    ConfigModule.forFeature(gqlConfig),    // Configuration
    DatabaseModule,                        // Neo4j connection
    CustomResolverModule,                  // Custom resolvers
    GraphQLModule.forRootAsync({          // Apollo GraphQL
      // Schema creation with error handling
      // Security validation rules
      // Context management
      // Error formatting
    })
  ]
})
```

### 2. Configuration Service (`gql.config.ts`)

Centralized configuration management with validation.

#### Configuration Class
```typescript
export class GqlConfig {
  schemaPath: string;           // Path to GraphQL schema file
  playground: boolean;          // GraphQL Playground (dev only)
  introspection: boolean;       // Schema introspection (dev only)
  oidcJwksUri?: string;        // JWT validation endpoint
  queryDepthLimit: number;      // Max query depth (security)
  queryComplexityLimit: number; // Max query complexity (security)
  enableSubscriptions: boolean; // WebSocket subscriptions
}
```

#### Features
- **Environment-based**: Automatic dev/production settings
- **Validation**: Runtime configuration validation
- **Type Safety**: Full TypeScript support
- **Defaults**: Sensible fallback values

### 3. Schema Service (`services/schema.service.ts`)

Manages GraphQL schema creation, validation, and resolver integration.

#### Core Methods

##### `buildSchemaWithResolvers(customResolvers: ResolverMap): Promise<any>`
Creates the complete GraphQL schema with custom resolvers.

```typescript
// Usage
const customResolvers = schemaService.mergeResolvers(resolverServices);
const schema = await schemaService.buildSchemaWithResolvers(customResolvers);
```

**Features:**
- Loads GraphQL schema from file
- Validates Neo4j connection
- Integrates custom resolvers
- Handles authentication setup
- Error handling with structured logging

##### `mergeResolvers(resolverServices: ResolverService[]): ResolverMap`
Combines multiple resolver services into a single resolver map.

```typescript
// Resolver structure
{
  TypeName: {
    fieldName: resolverFunction,
    anotherField: anotherResolver
  }
}
```

**Features:**
- Conflict detection and warnings
- Service-level error isolation
- Type-safe resolver mapping

##### `validateSchema(): Promise<boolean>`
Validates the GraphQL schema without building it.

**Use Cases:**
- Health checks
- Startup validation
- Configuration testing

#### Error Handling
- **Schema File Errors**: Missing files, empty files, permission issues
- **Neo4j Errors**: Connection failures, authentication issues
- **Resolver Errors**: Service failures, conflicts, invalid resolvers
- **Build Errors**: Schema compilation, validation failures

### 4. Health Service (`health/gql-health.service.ts`)

Provides health monitoring for the GraphQL system.

#### Health Status Interface
```typescript
interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  details: {
    neo4j: 'connected' | 'disconnected' | 'error';
    schema: 'valid' | 'invalid' | 'error';
    services: string[];
  };
  errors?: string[];
}
```

#### Key Methods

##### `getHealthStatus(): Promise<HealthStatus>`
Health check including:
- Neo4j connectivity test
- Schema validation
- Service availability
- Error aggregation

##### `isHealthy(): Promise<boolean>`
Simple boolean health check for load balancers.

#### Monitoring Features
- **Neo4j Connection**: Database connectivity and query execution
- **Schema Validation**: GraphQL schema compilation and structure
- **Error Tracking**: Detailed error messages and stack traces
- **Timestamp Tracking**: Health check timing information

### 5. Type Definitions (`interfaces/resolver.interface.ts`)

TypeScript interfaces for type-safe resolver development.

#### Core Interfaces

##### `ResolverService`
Interface for custom resolver service implementations.
```typescript
interface ResolverService {
  getResolvers(): ResolverMap;
}
```

##### `ResolverMap`
Structure for organizing GraphQL resolvers.
```typescript
interface ResolverMap {
  [typeName: string]: {
    [fieldName: string]: ResolverFunction;
  };
}
```

##### `GraphQLContext`
Context object passed to all resolvers.
```typescript
interface GraphQLContext {
  token?: string;    // JWT token from Authorization header
  driver: any;       // Neo4j driver instance
  user?: any;        // Decoded user information
}
```

##### `ResolverFunction`
Type definition for resolver functions.
```typescript
interface ResolverFunction {
  (parent: any, args: any, context: GraphQLContext, info: any): any;
}
```

## Security Features

### Production Security
- **Playground Disabled**: GraphQL Playground automatically disabled in production
- **Introspection Disabled**: Schema introspection disabled in production
- **Error Sanitization**: Internal errors hidden from clients
- **Query Limiting**: Depth and complexity limits prevent DoS attacks

### Authentication
- **OIDC Integration**: JWT token validation via JWKS endpoint
- **Context Propagation**: User information available in all resolvers
- **Token Extraction**: Automatic Bearer token parsing

### Query Protection
```typescript
// Depth limiting (prevents deeply nested queries)
query {
  user {
    posts {
      comments {
        replies {  // <- Depth limit prevents excessive nesting
          // ...
        }
      }
    }
  }
}

// Complexity limiting (prevents expensive operations)
// Each field has a complexity score, total must be under limit
```

## Error Handling

### Schema-Level Errors
- **File Not Found**: Clear error when schema file is missing
- **Empty Schema**: Validation for empty or invalid schema files
- **Parse Errors**: GraphQL syntax error reporting

### Runtime Errors
- **Neo4j Failures**: Database connection and query errors
- **Resolver Errors**: Custom resolver exception handling
- **Authentication Errors**: JWT validation and OIDC failures

### Error Formatting
```typescript
// Development - Full error details
{
  message: "Detailed error message",
  extensions: {
    code: "SPECIFIC_ERROR_CODE",
    stackTrace: "...",
    // ... additional debug info
  }
}

// Production - Sanitized errors
{
  message: "Internal server error",
  extensions: {
    code: "INTERNAL_ERROR"
  }
}
```

## Logging

### Structured Logging
All services use NestJS Logger with structured data:

```typescript
logger.log('GraphQL module initialized successfully', {
  playground: config.playground,
  introspection: config.introspection,
  subscriptions: config.enableSubscriptions,
  queryLimits: {
    depth: config.queryDepthLimit,
    complexity: config.queryComplexityLimit,
  },
});
```

### Log Levels
- **LOG**: Normal operations, initialization, success states
- **WARN**: Configuration issues, resolver conflicts, non-critical errors
- **ERROR**: Failed operations, connection issues, critical errors
- **DEBUG**: Detailed operation information (subscriptions, context creation)

## Performance Considerations

### Schema Caching
- Schema is built once and cached in memory
- Rebuilds only on application restart
- Validation separate from schema building

### Connection Management
- Neo4j driver connection pooling
- Session management for health checks
- Proper connection cleanup

### Resolver Efficiency
- Service-level error isolation
- Conflict detection without failure
- Lazy schema building

## Development vs Production

| Feature | Development | Production |
|---------|-------------|------------|
| GraphQL Playground | Enabled | Disabled |
| Schema Introspection | Enabled | Disabled |
| Error Details | Full Stack Traces | Sanitized |
| Query Limits | Relaxed | Strict |
| Logging Level | Debug | Info |

## Best Practices

### Configuration
1. **Use Environment Variables**: Never hardcode sensitive values
2. **Validate Configuration**: Fail fast on invalid config
3. **Environment-Specific Defaults**: Different settings per environment

### Error Handling
1. **Fallback Behavior**: Continue operation when possible
2. **Detailed Logging**: Log errors with context for debugging
3. **User-Friendly Messages**: Don't expose internal details

### Security
1. **Query Limits**: Always set depth and complexity limits
2. **Authentication**: Validate JWTs properly
3. **Error Sanitization**: Hide internal errors in production

### Monitoring
1. **Health Checks**: Implement health endpoints
2. **Metrics**: Track query performance and error rates
3. **Alerting**: Set up alerts for critical failures

## Troubleshooting

### Common Issues

#### "Custom resolver for X has not been provided"
**Cause**: Resolvers not passed to Neo4j GraphQL schema
**Solution**: Ensure `buildSchemaWithResolvers()` is called with merged resolvers

#### "Schema file not found"
**Cause**: Incorrect schema path or missing file
**Solution**: Verify `GQL_SCHEMA_PATH` environment variable and file existence

#### "Neo4j connection failed"
**Cause**: Database connection issues
**Solution**: Check `NEO4J_URI`, credentials, and network connectivity

#### "UnknownDependenciesException"
**Cause**: Circular dependencies in NestJS modules
**Solution**: Ensure proper module imports and provider registration

### Debugging Tips
1. **Enable Debug Logging**: Set log level to debug for detailed information
2. **Check Health Endpoint**: Use health service to diagnose issues
3. **Validate Configuration**: Ensure all required environment variables are set
4. **Test Schema Separately**: Use `validateSchema()` to isolate schema issues

## Migration Guide

### From Legacy Implementation
1. **Install Dependencies**: Add new security and validation packages
2. **Update Configuration**: Migrate to new config system
3. **Update Imports**: Use new service interfaces
4. **Test Resolvers**: Verify custom resolvers work with new system
5. **Configure Security**: Set production security settings

### Breaking Changes
- Global variables removed (`generatedSchema`, `neo4jDriver`)
- Schema service now requires explicit resolver passing
- Configuration validation is now strict
- Error formatting changed in production mode

---

## Additional Documentation

### Core Documentation
- [Architecture Overview](./ARCHITECTURE.md) - Detailed architecture and component relationships
- [API Reference](./API_REFERENCE.md) - Complete API documentation with examples
- [Usage Examples](./EXAMPLES.md) - Practical usage examples and best practices

### Custom Resolver Services
- [Custom Resolver Services Documentation](./CUSTOM_RESOLVER_SERVICES_DOCUMENTATION.md) - Guide to all custom resolver services
- [Custom Resolver Services Quick Reference](./CUSTOM_RESOLVER_SERVICES_QUICK_REFERENCE.md) - Quick reference for developers
- [Custom Resolver API Reference](./CUSTOM_RESOLVER_API_REFERENCE.md) - Detailed API specifications and interfaces

### Service-Specific Documentation
- [Module Registry Service](./MODULE_REGISTRY_DOCUMENTATION.md) - External module loading and management
- [Module Management Service](./MODULE_MANAGEMENT_SERVICE.md) - Database operations and module lifecycle
- [Issue Resolver](./ISSUE_RESOLVER.md) - Issue synchronization service details
- [Analysis Resolver](./ANALYSIS_RESOLVER.md) - AI analysis service documentation
- [Set Instantiation Attributes](./SET_INSTANTIATION_ATTRIBUTES.md) - Component attribute management

---

## Summary

The GraphQL module provides a GraphQL API with:

- **Performance**: LRU caching with TTL, query optimization, and modern Neo4j v5 patterns
- **Security**: OIDC authentication, query limiting, and input validation
- **Monitoring**: Health checks, metrics collection, and structured logging
- **Extensibility**: Custom resolver framework for business logic
- **Reliability**: Error handling, fallback behavior, and resource management

The module handles all GraphQL operations, both auto-generated CRUD from the Neo4j schema and custom business logic from the resolver services.
