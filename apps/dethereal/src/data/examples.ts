/**
 * Example Threat Model Templates
 *
 * Provides example models for different system architectures.
 * These examples use the split-file schema format.
 */

export type ExampleType = 'simple' | 'web_app' | 'api_service' | 'database' | 'microservices'

export interface ExampleModel {
  manifest: any
  structure: any
  dataflows: any
  dataItems: any
  attributes: any
}

/**
 * Simple system - basic threat model template
 */
export const simpleExample: ExampleModel = {
  manifest: {
    schemaVersion: '2.0.0',
    name: 'Simple System',
    description: 'Basic threat model template',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  structure: {
    defaultBoundary: {
      id: 'boundary-default',
      name: 'System Boundary',
      description: 'Main system boundary',
      position: { x: 0, y: 0 },
      dimensions: { width: 400, height: 300 },
      components: [
        {
          id: 'component-1',
          name: 'Application',
          description: 'Main application component',
          type: 'PROCESS',
          position: { x: 50, y: 50 }
        }
      ],
      boundaries: []
    }
  },
  dataflows: {
    dataFlows: []
  },
  dataItems: {
    dataItems: []
  },
  attributes: {
    version: '1.0.0',
    storageMode: 'consolidated',
    boundaries: {},
    components: {},
    dataFlows: {},
    dataItems: {}
  }
}

/**
 * Web application - standard web app with frontend and backend
 */
export const webAppExample: ExampleModel = {
  manifest: {
    schemaVersion: '2.0.0',
    name: 'Web Application',
    description: 'Standard web application with frontend and backend',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  structure: {
    defaultBoundary: {
      id: 'boundary-default',
      name: 'System Boundary',
      description: 'Web application system boundary',
      position: { x: 0, y: 0 },
      dimensions: { width: 800, height: 600 },
      boundaries: [
        {
          id: 'boundary-dmz',
          name: 'DMZ',
          description: 'Public-facing components',
          position: { x: 50, y: 50 },
          dimensions: { width: 300, height: 200 },
          components: [
            {
              id: 'component-webserver',
              name: 'Web Server',
              description: 'Frontend web server',
              type: 'PROCESS',
              position: { x: 75, y: 25 }
            }
          ]
        },
        {
          id: 'boundary-internal',
          name: 'Internal Network',
          description: 'Backend services',
          position: { x: 400, y: 50 },
          dimensions: { width: 350, height: 200 },
          components: [
            {
              id: 'component-appserver',
              name: 'Application Server',
              description: 'Business logic server',
              type: 'PROCESS',
              position: { x: 25, y: 25 }
            },
            {
              id: 'component-database',
              name: 'Database',
              description: 'Data storage',
              type: 'STORE',
              position: { x: 175, y: 25 }
            }
          ]
        }
      ],
      components: [
        {
          id: 'component-users',
          name: 'Users',
          description: 'External users',
          type: 'EXTERNAL_ENTITY',
          position: { x: 50, y: 350 }
        }
      ]
    }
  },
  dataflows: {
    dataFlows: [
      {
        id: 'flow-1',
        name: 'User Requests',
        description: 'HTTP requests from users',
        source: { id: 'component-users' },
        target: { id: 'component-webserver' }
      },
      {
        id: 'flow-2',
        name: 'Web to App Server',
        description: 'Frontend to backend communication',
        source: { id: 'component-webserver' },
        target: { id: 'component-appserver' }
      },
      {
        id: 'flow-3',
        name: 'Database Queries',
        description: 'Application to database',
        source: { id: 'component-appserver' },
        target: { id: 'component-database' }
      }
    ]
  },
  dataItems: {
    dataItems: [
      {
        id: 'data-1',
        name: 'User Data',
        description: 'User authentication and profile information'
      }
    ]
  },
  attributes: {
    version: '1.0.0',
    storageMode: 'consolidated',
    boundaries: {},
    components: {},
    dataFlows: {},
    dataItems: {}
  }
}

/**
 * API service - RESTful API with database backend
 */
export const apiServiceExample: ExampleModel = {
  manifest: {
    schemaVersion: '2.0.0',
    name: 'API Service',
    description: 'RESTful API service with database backend',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  structure: {
    defaultBoundary: {
      id: 'boundary-default',
      name: 'API Service Boundary',
      description: 'API service system boundary',
      position: { x: 0, y: 0 },
      dimensions: { width: 600, height: 400 },
      components: [
        {
          id: 'component-gateway',
          name: 'API Gateway',
          description: 'API endpoint handler',
          type: 'PROCESS',
          position: { x: 50, y: 50 }
        }
      ],
      boundaries: [
        {
          id: 'boundary-internal',
          name: 'Internal',
          description: 'Internal services',
          position: { x: 300, y: 50 },
          dimensions: { width: 250, height: 150 },
          components: [
            {
              id: 'component-database',
              name: 'Database',
              description: 'Data persistence layer',
              type: 'STORE',
              position: { x: 75, y: 25 }
            }
          ]
        }
      ]
    }
  },
  dataflows: {
    dataFlows: [
      {
        id: 'flow-1',
        name: 'Database Queries',
        description: 'API to database communication',
        source: { id: 'component-gateway' },
        target: { id: 'component-database' }
      }
    ]
  },
  dataItems: {
    dataItems: [
      {
        id: 'data-1',
        name: 'API Data',
        description: 'Request and response data'
      }
    ]
  },
  attributes: {
    version: '1.0.0',
    storageMode: 'consolidated',
    boundaries: {},
    components: {},
    dataFlows: {},
    dataItems: {}
  }
}

/**
 * Database system - focused on data storage
 */
export const databaseExample: ExampleModel = {
  manifest: {
    schemaVersion: '2.0.0',
    name: 'Database System',
    description: 'Database-focused threat model',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  structure: {
    defaultBoundary: {
      id: 'boundary-default',
      name: 'Database Boundary',
      description: 'Database system boundary',
      position: { x: 0, y: 0 },
      dimensions: { width: 400, height: 300 },
      components: [
        {
          id: 'component-database',
          name: 'Database Server',
          description: 'Primary database instance',
          type: 'STORE',
          position: { x: 200, y: 100 }
        },
        {
          id: 'component-admin',
          name: 'Database Admin',
          description: 'Database administrator access',
          type: 'EXTERNAL_ENTITY',
          position: { x: 50, y: 100 }
        }
      ],
      boundaries: []
    }
  },
  dataflows: {
    dataFlows: [
      {
        id: 'flow-1',
        name: 'Admin Access',
        description: 'Administrative database operations',
        source: { id: 'component-admin' },
        target: { id: 'component-database' }
      }
    ]
  },
  dataItems: {
    dataItems: [
      {
        id: 'data-1',
        name: 'Sensitive Data',
        description: 'Confidential business data'
      }
    ]
  },
  attributes: {
    version: '1.0.0',
    storageMode: 'consolidated',
    boundaries: {},
    components: {},
    dataFlows: {},
    dataItems: {}
  }
}

/**
 * Microservices architecture
 */
export const microservicesExample: ExampleModel = {
  manifest: {
    schemaVersion: '2.0.0',
    name: 'Microservices Architecture',
    description: 'Container-based microservices system',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  structure: {
    defaultBoundary: {
      id: 'boundary-default',
      name: 'Microservices Platform',
      description: 'Container orchestration platform',
      position: { x: 0, y: 0 },
      dimensions: { width: 1000, height: 700 },
      boundaries: [
        {
          id: 'boundary-public',
          name: 'Public Zone',
          description: 'External-facing services',
          position: { x: 50, y: 50 },
          dimensions: { width: 250, height: 200 },
          components: [
            {
              id: 'component-gateway',
              name: 'API Gateway',
              description: 'External API gateway',
              type: 'PROCESS',
              position: { x: 50, y: 25 }
            }
          ]
        },
        {
          id: 'boundary-mesh',
          name: 'Service Mesh',
          description: 'Internal microservices',
          position: { x: 350, y: 50 },
          dimensions: { width: 300, height: 200 },
          components: [
            {
              id: 'component-user-svc',
              name: 'User Service',
              description: 'User management service',
              type: 'PROCESS',
              position: { x: 25, y: 25 }
            },
            {
              id: 'component-order-svc',
              name: 'Order Service',
              description: 'Order processing service',
              type: 'PROCESS',
              position: { x: 175, y: 25 }
            }
          ]
        },
        {
          id: 'boundary-data',
          name: 'Data Layer',
          description: 'Persistent data storage',
          position: { x: 700, y: 50 },
          dimensions: { width: 250, height: 200 },
          components: [
            {
              id: 'component-db-cluster',
              name: 'Database Cluster',
              description: 'Distributed database',
              type: 'STORE',
              position: { x: 50, y: 25 }
            }
          ]
        }
      ],
      components: []
    }
  },
  dataflows: {
    dataFlows: [
      {
        id: 'flow-1',
        name: 'Service Requests',
        description: 'API gateway to services',
        source: { id: 'component-gateway' },
        target: { id: 'component-user-svc' }
      },
      {
        id: 'flow-2',
        name: 'Order Processing',
        description: 'User to order service',
        source: { id: 'component-user-svc' },
        target: { id: 'component-order-svc' }
      },
      {
        id: 'flow-3',
        name: 'Data Access',
        description: 'Services to database',
        source: { id: 'component-user-svc' },
        target: { id: 'component-db-cluster' }
      }
    ]
  },
  dataItems: {
    dataItems: [
      {
        id: 'data-1',
        name: 'Service Communication Data',
        description: 'Inter-service message data'
      }
    ]
  },
  attributes: {
    version: '1.0.0',
    storageMode: 'consolidated',
    boundaries: {},
    components: {},
    dataFlows: {},
    dataItems: {}
  }
}

/**
 * Get example model by type
 */
export function getExample(type: ExampleType): ExampleModel {
  switch (type) {
    case 'simple':
      return simpleExample
    case 'web_app':
      return webAppExample
    case 'api_service':
      return apiServiceExample
    case 'database':
      return databaseExample
    case 'microservices':
      return microservicesExample
    default:
      return simpleExample
  }
}

/**
 * Get all available example types
 */
export function getExampleTypes(): ExampleType[] {
  return ['simple', 'web_app', 'api_service', 'database', 'microservices']
}
