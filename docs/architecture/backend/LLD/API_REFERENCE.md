# GraphQL Module API Reference

## GqlModule

### Overview
Main NestJS module that provides GraphQL API functionality with Neo4j integration.

### Dependencies
- `@nestjs/graphql` - GraphQL integration for NestJS
- `@neo4j/graphql` - Neo4j GraphQL library
- `apollo-server-express` - Apollo GraphQL server

### Module Configuration
```typescript
@Module({
  imports: [
    ConfigModule.forFeature(gqlConfig),
    DatabaseModule,
    CustomResolverModule,
    GraphQLModule.forRootAsync<ApolloDriverConfig>({...})
  ],
  providers: [],
  exports: []
})
```

### Environment Variables
| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `NODE_ENV` | string | development | Application environment |
| `NEO4J_URI` | string | required | Neo4j database connection URI |
| `NEO4J_USERNAME` | string | required | Neo4j username |
| `NEO4J_PASSWORD` | string | required | Neo4j password |
| `OIDC_JKWS_URI` | string | optional | OIDC JWKS endpoint for JWT validation |
| `GQL_SCHEMA_PATH` | string | schema/schema.graphql | Path to GraphQL schema file |
| `GQL_QUERY_DEPTH_LIMIT` | number | 10 | Maximum query nesting depth |
| `GQL_QUERY_COMPLEXITY_LIMIT` | number | 1000 | Maximum query complexity score |
| `GQL_ENABLE_SUBSCRIPTIONS` | boolean | true | Enable GraphQL subscriptions |

---

## GqlConfig

### Overview
Configuration class with validation for GraphQL module settings.

### Properties
```typescript
class GqlConfig {
  schemaPath: string;           // Path to GraphQL schema file
  playground: boolean;          // Enable GraphQL Playground
  introspection: boolean;       // Enable schema introspection
  oidcJwksUri?: string;        // OIDC JWKS URI for JWT validation
  queryDepthLimit: number;      // Maximum query depth
  queryComplexityLimit: number; // Maximum query complexity
  enableSubscriptions: boolean; // Enable WebSocket subscriptions
}
```

### Methods
```typescript
// Factory function that creates and validates configuration
export default registerAs('gql', () => GqlConfig)
```

### Validation Rules
- `schemaPath` must be a non-empty string
- `playground` and `introspection` must be booleans
- `oidcJwksUri` must be a valid string if provided
- `queryDepthLimit` must be a positive number
- `queryComplexityLimit` must be a positive number
- `enableSubscriptions` must be a boolean

---

## SchemaService

### Overview
Service responsible for GraphQL schema creation, validation, and resolver integration.

### Constructor
```typescript
constructor(
  private readonly configService: ConfigService,
  @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any
)
```

### Methods

#### `buildSchemaWithResolvers(customResolvers: ResolverMap): Promise<any>`
Creates a complete GraphQL schema with custom resolvers integrated.

**Parameters:**
- `customResolvers: ResolverMap` - Map of custom resolver functions

**Returns:** `Promise<any>` - Executable GraphQL schema

**Process:**
1. Loads GraphQL schema from file
2. Validates Neo4j connection
3. Creates Neo4j GraphQL instance with resolvers
4. Returns executable schema

**Throws:**
- `Error` - If schema file not found or invalid
- `Error` - If Neo4j connection fails
- `Error` - If schema compilation fails

#### `getSchema(): Promise<any>`
Gets cached schema or builds new one without custom resolvers.

**Returns:** `Promise<any>` - Executable GraphQL schema

**Note:** Uses empty resolver map `{}` for basic schema

#### `validateSchema(): Promise<boolean>`
Validates schema without building it completely.

**Returns:** `Promise<boolean>` - True if schema is valid

**Use Cases:**
- Health checks
- Configuration validation
- Startup verification

#### `mergeResolvers(resolverServices: ResolverService[]): ResolverMap`
Combines multiple resolver services into a single resolver map.

**Parameters:**
- `resolverServices: ResolverService[]` - Array of resolver services

**Returns:** `ResolverMap` - Combined resolver map

**Features:**
- Detects and warns about resolver conflicts
- Continues processing if individual services fail
- Provides detailed error logging

### Private Methods

#### `loadSchemaFile(): Promise<string>`
Loads GraphQL schema from configured file path.

**Returns:** `Promise<string>` - GraphQL schema definition

**Error Handling:**
- `ENOENT` errors converted to "Schema file not found"
- Empty file detection
- Detailed error messages

#### `validateNeo4jConnection(): Promise<void>`
Validates Neo4j database connectivity.

**Process:**
1. Creates database session
2. Executes test query (`RETURN 1`)
3. Closes session properly

**Throws:**
- `Error` - If connection fails or query fails

---

## GqlHealthService

### Overview
Comprehensive health monitoring service for GraphQL system components.

### Constructor
```typescript
constructor(
  private readonly schemaService: SchemaService,
  @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any
)
```

### Methods

#### `getHealthStatus(): Promise<HealthStatus>`
Performs comprehensive health check of all system components.

**Returns:** `Promise<HealthStatus>` - Detailed health status

**Health Checks:**
1. **Neo4j Connection**: Tests database connectivity and query execution
2. **Schema Validation**: Validates GraphQL schema compilation
3. **Service Availability**: Checks service registration

**Status Levels:**
- `healthy` - All systems operational
- `degraded` - Some non-critical issues detected
- `unhealthy` - Critical systems failing

#### `isHealthy(): Promise<boolean>`
Simple boolean health check for load balancers and monitoring.

**Returns:** `Promise<boolean>` - True if system is healthy

**Use Cases:**
- Load balancer health checks
- Kubernetes liveness probes
- Simple monitoring alerts

### Health Status Interface
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

---

## Type Interfaces

### ResolverService
Interface that all custom resolver services must implement.

```typescript
interface ResolverService {
  getResolvers(): ResolverMap;
}
```

**Implementation Example:**
```typescript
@Injectable()
export class MyResolverService implements ResolverService {
  getResolvers(): ResolverMap {
    return {
      MyType: {
        myField: async (parent, args, context) => {
          // Resolver logic
          return result;
        }
      }
    };
  }
}
```

### ResolverMap
Structure for organizing GraphQL field resolvers by type.

```typescript
interface ResolverMap {
  [typeName: string]: {
    [fieldName: string]: ResolverFunction;
  };
}
```

**Example:**
```typescript
const resolvers: ResolverMap = {
  User: {
    fullName: (user) => `${user.firstName} ${user.lastName}`,
    posts: (user, args, { driver }) => {
      // Database query logic
    }
  },
  Post: {
    author: (post, args, { driver }) => {
      // Fetch author from database
    }
  }
};
```

### GraphQLContext
Context object available in all GraphQL resolvers.

```typescript
interface GraphQLContext {
  token?: string;    // JWT token from Authorization header
  driver: any;       // Neo4j driver instance
  user?: any;        // Decoded user information (if authenticated)
}
```

**Usage in Resolvers:**
```typescript
const resolver = async (parent, args, context: GraphQLContext) => {
  const { token, driver, user } = context;
  
  if (!user) {
    throw new Error('Authentication required');
  }
  
  const session = driver.session();
  // Use session for database operations
  await session.close();
};
```

### ResolverFunction
Type definition for GraphQL resolver functions.

```typescript
interface ResolverFunction {
  (
    parent: any,              // Parent object (from parent resolver)
    args: any,                // GraphQL field arguments
    context: GraphQLContext,  // Request context
    info: any                 // GraphQL execution info
  ): any;                     // Return value (can be Promise)
}
```

---

## Error Types

### Schema Errors
- **Schema File Not Found**: `Schema file not found: {path}`
- **Empty Schema**: `Schema file is empty`
- **Parse Error**: `Failed to load schema file: {error}`

### Connection Errors
- **Neo4j Connection**: `Neo4j connection failed: {error}`
- **Database Query**: `Neo4j query execution failed: {error}`

### Resolver Errors
- **Service Error**: `Failed to merge resolvers from service: {service}`
- **Conflict Warning**: `Resolver conflicts detected for {type}: {fields}`

### Configuration Errors
- **Validation Error**: `GraphQL configuration validation failed: {errors}`
- **Missing Environment**: `Required environment variable not set: {variable}`

---

## Security Features

### Query Protection
```typescript
// Depth limiting prevents deeply nested queries
const depthRule = depthLimit(10);

// Complexity limiting prevents expensive operations
const complexityRule = createComplexityLimitRule(1000);
```

### Authentication Integration
```typescript
// OIDC JWT validation
authorization: {
  key: {
    url: process.env.OIDC_JKWS_URI
  }
}
```

### Error Sanitization
```typescript
// Production error formatting
formatError: (error) => {
  if (process.env.NODE_ENV === 'production') {
    return {
      message: 'Internal server error',
      extensions: { code: 'INTERNAL_ERROR' }
    };
  }
  return error; // Full details in development
}
```

### Context Security
```typescript
// Automatic token extraction and validation
context: ({ req, connection }): GraphQLContext => {
  return {
    token: req.headers?.authorization?.replace('Bearer ', ''),
    driver: neo4jDriver,
    // User populated by authentication middleware
  };
}
```
