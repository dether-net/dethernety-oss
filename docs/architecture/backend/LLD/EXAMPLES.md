# GraphQL Module Examples

## Basic Setup

### 1. Environment Configuration
```bash
# .env.production
NODE_ENV=production
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-secure-password
OIDC_JKWS_URI=https://your-auth-provider.com/.well-known/jwks.json
GQL_SCHEMA_PATH=schema/schema.graphql
GQL_QUERY_DEPTH_LIMIT=10
GQL_QUERY_COMPLEXITY_LIMIT=1000
GQL_ENABLE_SUBSCRIPTIONS=true
```

### 2. Module Import
```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { GqlModule } from './gql/gql.module';

@Module({
  imports: [
    GqlModule,
    // ... other modules
  ],
})
export class AppModule {}
```

## Custom Resolver Implementation

### 1. Basic Resolver Service
```typescript
// my-resolver.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { ResolverService, ResolverMap } from '../interfaces/resolver.interface';

@Injectable()
export class MyResolverService implements ResolverService {
  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
  ) {}

  getResolvers(): ResolverMap {
    return {
      User: {
        // Computed field resolver
        fullName: (user) => {
          return `${user.firstName} ${user.lastName}`;
        },

        // Database query resolver
        posts: async (user, args, context) => {
          const session = this.neo4jDriver.session();
          try {
            const result = await session.run(
              'MATCH (u:User {id: $userId})-[:AUTHORED]->(p:Post) RETURN p',
              { userId: user.id }
            );
            return result.records.map(record => record.get('p').properties);
          } finally {
            await session.close();
          }
        },

        // Authenticated resolver
        privateData: async (user, args, context) => {
          if (!context.user) {
            throw new Error('Authentication required');
          }
          
          if (context.user.id !== user.id) {
            throw new Error('Access denied');
          }
          
          return user.privateData;
        }
      }
    };
  }
}
```

### 2. Register Custom Resolver
```typescript
// custom-resolver.module.ts
import { Module } from '@nestjs/common';
import { MyResolverService } from './my-resolver.service';
import { RESOLVER_SERVICES } from './resolvers.constants';

const resolverServiceClasses = [
  MyResolverService,
  // ... other resolver services
];

@Module({
  providers: [
    ...resolverServiceClasses,
    {
      provide: RESOLVER_SERVICES,
      useFactory: (...services) => services,
      inject: resolverServiceClasses,
    },
  ],
  exports: [...resolverServiceClasses, RESOLVER_SERVICES],
})
export class CustomResolverModule {}
```

## Advanced Resolver Patterns

### 1. Pagination Resolver
```typescript
@Injectable()
export class PaginationResolverService implements ResolverService {
  getResolvers(): ResolverMap {
    return {
      Query: {
        paginatedUsers: async (parent, args, context) => {
          const { page = 1, limit = 10, filter } = args;
          const skip = (page - 1) * limit;
          
          const session = context.driver.session();
          try {
            // Count total records
            const countResult = await session.run(
              'MATCH (u:User) WHERE u.name CONTAINS $filter RETURN count(u) as total',
              { filter: filter || '' }
            );
            const total = countResult.records[0].get('total').toNumber();
            
            // Get paginated data
            const dataResult = await session.run(
              `MATCH (u:User) WHERE u.name CONTAINS $filter 
               RETURN u ORDER BY u.createdAt DESC SKIP $skip LIMIT $limit`,
              { filter: filter || '', skip, limit }
            );
            
            const users = dataResult.records.map(record => 
              record.get('u').properties
            );
            
            return {
              users,
              pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
                hasNext: page * limit < total,
                hasPrev: page > 1
              }
            };
          } finally {
            await session.close();
          }
        }
      }
    };
  }
}
```

### 2. Subscription Resolver
```typescript
@Injectable()
export class SubscriptionResolverService implements ResolverService {
  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
  ) {}

  getResolvers(): ResolverMap {
    return {
      Subscription: {
        userUpdated: {
          // Subscription resolver with filtering
          subscribe: (parent, args, context) => {
            // Return async iterator for real-time updates
            return pubSub.asyncIterator(['USER_UPDATED']);
          },
          resolve: (payload, args) => {
            // Filter updates based on subscription arguments
            if (args.userId && payload.userId !== args.userId) {
              return null; // Skip this update
            }
            return payload.user;
          }
        }
      },
      
      Mutation: {
        updateUser: async (parent, args, context) => {
          const session = this.neo4jDriver.session();
          try {
            const result = await session.run(
              'MATCH (u:User {id: $id}) SET u += $data RETURN u',
              { id: args.id, data: args.input }
            );
            
            const updatedUser = result.records[0].get('u').properties;
            
            // Publish to subscribers
            pubSub.publish('USER_UPDATED', {
              userId: updatedUser.id,
              user: updatedUser
            });
            
            return updatedUser;
          } finally {
            await session.close();
          }
        }
      }
    };
  }
}
```

### 3. Error Handling Resolver
```typescript
@Injectable()
export class ErrorHandlingResolverService implements ResolverService {
  private readonly logger = new Logger(ErrorHandlingResolverService.name);

  getResolvers(): ResolverMap {
    return {
      Query: {
        riskyOperation: async (parent, args, context) => {
          try {
            // Validate input
            if (!args.id) {
              throw new UserInputError('ID is required');
            }
            
            // Check authentication
            if (!context.user) {
              throw new AuthenticationError('Authentication required');
            }
            
            // Check authorization
            if (!this.hasPermission(context.user, 'READ_SENSITIVE_DATA')) {
              throw new ForbiddenError('Insufficient permissions');
            }
            
            const session = context.driver.session();
            try {
              const result = await session.run(
                'MATCH (n {id: $id}) RETURN n',
                { id: args.id }
              );
              
              if (result.records.length === 0) {
                throw new UserInputError(`Record not found: ${args.id}`);
              }
              
              return result.records[0].get('n').properties;
              
            } catch (dbError) {
              this.logger.error('Database operation failed', {
                operation: 'riskyOperation',
                args,
                error: dbError.message,
                userId: context.user?.id
              });
              
              // Don't expose internal database errors
              throw new Error('Internal server error');
            } finally {
              await session.close();
            }
            
          } catch (error) {
            // Log all errors for monitoring
            this.logger.error('Resolver error', {
              resolver: 'riskyOperation',
              error: error.message,
              stack: error.stack
            });
            
            // Re-throw to let GraphQL handle error formatting
            throw error;
          }
        }
      }
    };
  }
  
  private hasPermission(user: any, permission: string): boolean {
    return user.permissions?.includes(permission) || user.role === 'admin';
  }
}
```

## Health Check Integration

### 1. HTTP Health Endpoint
```typescript
// health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { GqlHealthService } from '../gql/health/gql-health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly gqlHealth: GqlHealthService) {}

  @Get('gql')
  async getGraphQLHealth() {
    return await this.gqlHealth.getHealthStatus();
  }

  @Get('gql/simple')
  async isGraphQLHealthy() {
    const isHealthy = await this.gqlHealth.isHealthy();
    return { healthy: isHealthy };
  }
}
```

### 2. Kubernetes Health Probes
```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
      - name: app
        livenessProbe:
          httpGet:
            path: /health/gql/simple
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health/gql
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

## Testing Examples

### 1. Unit Testing Resolvers
```typescript
// my-resolver.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { MyResolverService } from './my-resolver.service';

describe('MyResolverService', () => {
  let service: MyResolverService;
  let mockNeo4jDriver: any;

  beforeEach(async () => {
    mockNeo4jDriver = {
      session: jest.fn(() => ({
        run: jest.fn(),
        close: jest.fn()
      }))
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MyResolverService,
        {
          provide: 'NEO4J_DRIVER',
          useValue: mockNeo4jDriver
        }
      ],
    }).compile();

    service = module.get<MyResolverService>(MyResolverService);
  });

  it('should return user full name', () => {
    const resolvers = service.getResolvers();
    const user = { firstName: 'John', lastName: 'Doe' };
    
    const result = resolvers.User.fullName(user);
    expect(result).toBe('John Doe');
  });

  it('should fetch user posts from database', async () => {
    const mockSession = {
      run: jest.fn().mockResolvedValue({
        records: [
          { get: jest.fn().mockReturnValue({ properties: { title: 'Post 1' } }) }
        ]
      }),
      close: jest.fn()
    };
    
    mockNeo4jDriver.session.mockReturnValue(mockSession);
    
    const resolvers = service.getResolvers();
    const user = { id: 'user-123' };
    const context = { driver: mockNeo4jDriver };
    
    const result = await resolvers.User.posts(user, {}, context);
    
    expect(result).toEqual([{ title: 'Post 1' }]);
    expect(mockSession.close).toHaveBeenCalled();
  });
});
```

### 2. Integration Testing
```typescript
// gql.module.integration.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { GraphQLModule } from '@nestjs/graphql';
import { GqlModule } from './gql.module';
import { DatabaseModule } from '../database/database.module';

describe('GqlModule Integration', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        GqlModule,
        DatabaseModule
      ],
    }).compile();
  });

  it('should compile successfully', () => {
    expect(module).toBeDefined();
  });

  it('should have GraphQL schema', async () => {
    const schemaService = module.get(SchemaService);
    const isValid = await schemaService.validateSchema();
    expect(isValid).toBe(true);
  });
});
```

## Configuration Examples

### 1. Development Configuration
```typescript
// config/development.ts
export default {
  gql: {
    playground: true,
    introspection: true,
    queryDepthLimit: 15, // More relaxed for development
    queryComplexityLimit: 2000,
    enableSubscriptions: true
  }
};
```

### 2. Production Configuration
```typescript
// config/production.ts
export default {
  gql: {
    playground: false,
    introspection: false,
    queryDepthLimit: 8, // Stricter for production
    queryComplexityLimit: 500,
    enableSubscriptions: true
  }
};
```

### 3. Testing Configuration
```typescript
// config/test.ts
export default {
  gql: {
    playground: false,
    introspection: true, // Useful for test schema validation
    queryDepthLimit: 20, // Relaxed for complex test queries
    queryComplexityLimit: 5000,
    enableSubscriptions: false // Disable for faster tests
  }
};
```

## Monitoring and Logging

### 1. Custom Logger Integration
```typescript
// custom-logger.service.ts
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class GraphQLLogger extends Logger {
  logQuery(query: string, variables: any, context: any) {
    this.log('GraphQL Query Executed', {
      query: query.replace(/\s+/g, ' ').trim(),
      variables,
      user: context.user?.id,
      timestamp: new Date().toISOString()
    });
  }

  logError(error: any, query: string, variables: any) {
    this.error('GraphQL Error', {
      message: error.message,
      query: query.replace(/\s+/g, ' ').trim(),
      variables,
      stack: error.stack
    });
  }
}
```

### 2. Metrics Collection
```typescript
// metrics.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class GraphQLMetrics {
  private queryCount = 0;
  private errorCount = 0;
  private queryTimes: number[] = [];

  recordQuery(duration: number) {
    this.queryCount++;
    this.queryTimes.push(duration);
    
    // Keep only last 1000 query times
    if (this.queryTimes.length > 1000) {
      this.queryTimes.shift();
    }
  }

  recordError() {
    this.errorCount++;
  }

  getMetrics() {
    return {
      totalQueries: this.queryCount,
      totalErrors: this.errorCount,
      errorRate: this.queryCount > 0 ? this.errorCount / this.queryCount : 0,
      averageQueryTime: this.queryTimes.length > 0 
        ? this.queryTimes.reduce((a, b) => a + b, 0) / this.queryTimes.length 
        : 0
    };
  }
}
```
