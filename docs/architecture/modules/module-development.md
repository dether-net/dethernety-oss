# Dethernety Module Development Guide

This comprehensive guide provides practical instructions for developing custom modules for the Dethernety threat modeling framework. Modules extend the framework's capabilities by providing specialized component classes, security controls, analysis capabilities, and exposure detection rules.

## Table of Contents

1. [Module System Overview](#module-system-overview)
2. [Module Types and Architecture](#module-types-and-architecture)
3. [Getting Started](#getting-started)
4. [Module Implementation Patterns](#module-implementation-patterns)
5. [Working Examples](#working-examples)
6. [Custom Module Integration](#custom-module-integration)
7. [Advanced Features](#advanced-features)
8. [Testing and Debugging](#testing-and-debugging)
9. [Best Practices](#best-practices)

## Module System Overview

### What is a Dethernety Module?

A Dethernety module is a TypeScript/JavaScript package that implements the `DTModule` interface to extend the framework's capabilities. Modules can provide:

- **Component Classes**: Define specialized types of system components
- **Data Flow Classes**: Define types of data flows between components  
- **Security Boundary Classes**: Define types of security boundaries
- **Control Classes**: Define security controls for mitigating exposures
- **Data Classes**: Define types of data that can be handled by components
- **Issue Classes**: Define types of security issues and threats
- **Analysis Classes**: Define AI-powered analysis capabilities
- **Exposure Detection Rules**: Define rules for detecting security exposures using OPA/Rego policies
- **Configuration Templates**: Define JSON schemas and forms for component configuration

### Module Integration Points

1. **Backend Loading**: Modules are loaded by the `ModuleRegistryService` at startup
2. **Database Storage**: Module metadata and classes are stored in the graph database (Bolt/Cypher compatible)
3. **Policy Evaluation**: Exposure and countermeasure rules are evaluated using OPA (Open Policy Agent)
4. **GraphQL API**: Module data is exposed through GraphQL resolvers
5. **Frontend Rendering**: Module templates and forms are rendered in the UI

## Module Types and Architecture

### Core Module Interface

All modules must implement the `DTModule` interface:

```typescript
interface DTModule {
  getMetadata(): DTMetadata | Promise<DTMetadata>;
  getModuleTemplate?(): Promise<string>;
  getClassTemplate?(id: string): Promise<string>;
  getClassGuide?(id: string): Promise<string>;
  getExposures?(id: string, classId: string): Promise<Exposure[]>;
  getCountermeasures?(id: string, classId: string): Promise<Countermeasure[]>;
  
  // Analysis capabilities (optional)
  runAnalysis?(id: string, analysisClassId: string, scope: string, pubSub: ExtendedPubSubEngine, additionalParams?: object): Promise<AnalysisSession>;
  startChat?(id: string, analysisClassId: string, scope: string, userQuestion: string, pubSub: ExtendedPubSubEngine, additionalParams?: object): Promise<AnalysisSession>;
  resumeAnalysis?(id: string, analysisClassId: string, input: any, pubSub: ExtendedPubSubEngine): Promise<AnalysisSession>;
  getAnalysisStatus?(id: string): Promise<AnalysisStatus>;
  getAnalysisValueKeys?(id: string): Promise<string[]>;
  getAnalysisValues?(id: string, valueKey: string): Promise<object>;
  
  // Issue management (optional)
  getSyncedIssueAttributes?(issueId: string, attributes: string, lastSyncAt: string): Promise<string>;
}
```

### DTModule Interface Methods

#### Core Module Definition

**`getMetadata()`** - **Required**
- **Purpose**: Defines what your module provides to the Dethernety framework
- **Returns**: Module identity, version info, and catalogs of available component classes, analysis capabilities, etc.
- **When Called**: During module registration and when the UI needs to display available components
- **Key Concept**: This is your module's "business card" - it tells the system what capabilities you're offering

#### User Interface & Configuration

**`getModuleTemplate()`** - *Optional*
- **Purpose**: Provides configuration forms for module-wide settings
- **Returns**: JSON schema defining module configuration options (API keys, server URLs, etc.)
- **When Called**: When users configure the module in system settings
- **Key Concept**: Think of this as your module's "settings panel"

**`getClassTemplate(id)`** - *Optional*
- **Purpose**: Provides configuration forms for individual component instances
- **Returns**: JSON schema for configuring specific components (e.g., database connection string, security settings)
- **When Called**: When users create or configure components of your classes
- **Key Concept**: This is the "properties panel" users see when configuring your components

**`getClassGuide(id)`** - *Optional*
- **Purpose**: Provides contextual help and best practices for configuring components
- **Returns**: Documentation, tips, and guidance for proper component setup
- **When Called**: When users need help configuring your components
- **Key Concept**: This is your "built-in documentation" that helps users use your components correctly

#### Security Assessment

**`getExposures(id, classId)`** - *Optional*
- **Purpose**: Analyzes component configurations to identify security vulnerabilities and risks
- **Returns**: List of detected security exposures with severity levels and descriptions
- **When Called**: During threat modeling to assess component security posture
- **Key Concept**: This is your "security scanner" that finds problems in how components are configured or deployed

**`getCountermeasures(id, classId)`** - *Optional*
- **Purpose**: Recommends specific actions to mitigate identified security exposures
- **Returns**: List of actionable security controls and mitigation strategies
- **When Called**: After exposures are identified, to provide remediation guidance
- **Key Concept**: This is your "security advisor" that tells users how to fix problems

#### AI-Powered Analysis

**`runAnalysis(analysisId, analysisClassId, scope, pubSub)`** - *Optional*
- **Purpose**: Executes intelligent, automated security analysis using AI or specialized algorithms
- **Returns**: Analysis session that can run asynchronously and provide real-time updates
- **When Called**: When users request deep security analysis of their system models
- **Key Concept**: This is your "AI security expert" that can perform complex reasoning about security

**`startChat(analysisId, analysisClassId, scope, userQuestion, pubSub)`** - *Optional*
- **Purpose**: Enables interactive conversations about security analysis results
- **Returns**: Chat session where users can ask follow-up questions about findings
- **When Called**: When users want to explore analysis results through natural language interaction
- **Key Concept**: This is your "security consultant" that users can discuss findings with

**`resumeAnalysis(analysisId, analysisClassId, input, pubSub)`** - *Optional*
- **Purpose**: Continues interrupted analysis sessions or processes user feedback
- **Returns**: Resumed analysis session with updated state
- **When Called**: When analysis needs to continue from a previous state or incorporate new input
- **Key Concept**: This allows for "multi-step analysis" where users can guide the analysis process

#### Analysis State Management

**`getAnalysisStatus(id)`** - *Optional*
- **Purpose**: Reports current state of running analysis (progress, completion status, errors)
- **Returns**: Status information including progress percentage and current phase
- **When Called**: To monitor long-running analysis operations
- **Key Concept**: This is your "progress tracker" for complex analysis operations

**`getAnalysisValueKeys(id)`** - *Optional*
- **Purpose**: Lists available data keys/categories from completed analysis
- **Returns**: Array of data keys that can be retrieved from analysis results
- **When Called**: To discover what data is available from an analysis
- **Key Concept**: This is like a "table of contents" for your analysis results

**`getAnalysisValues(id, valueKey)`** - *Optional*
- **Purpose**: Retrieves specific data from analysis results
- **Returns**: Structured data for the requested analysis aspect
- **When Called**: To fetch specific analysis findings or metrics
- **Key Concept**: This is your "data accessor" for retrieving specific analysis insights

#### Integration & Synchronization

**`getSyncedIssueAttributes(issueId, attributes, lastSyncAt)`** - *Optional*
- **Purpose**: Synchronizes issue data with external systems (bug trackers, ticketing systems, etc.)
- **Returns**: Updated issue attributes from external sources
- **When Called**: During issue synchronization with external tools
- **Key Concept**: This is your "integration bridge" to external issue management systems

### Available Base Classes

The `@dethernety/dt-module` package provides several base classes:

#### 1. DtNeo4jOpaModule (Recommended)

The most feature-complete base class that stores data in the graph database and uses OPA/Rego for policy evaluation:

```typescript
import { DtNeo4jOpaModule } from "@dethernety/dt-module";
import { Logger } from '@nestjs/common';

class MyModule extends DtNeo4jOpaModule {
  constructor(driver: any, logger: Logger) {
    const moduleName = 'my-custom-module';
    super(moduleName, driver, logger);
  }
}
```

**Features:**
- Automatic metadata retrieval from graph database
- OPA/Rego policy evaluation for exposures and countermeasures
- Built-in database operations
- Proper logging integration
- Policy management and installation

#### 2. Direct DTModule Implementation

For modules that need full control or have different storage/evaluation needs:

```typescript
import { DTModule } from "@dethernety/dt-module";

class MyModule implements DTModule {
  async getMetadata() {
    return {
      name: 'my-module',
      description: 'Custom module implementation',
      version: '1.0.0',
      // ... other metadata
    };
  }
  
  // Implement other required methods
}
```

## Getting Started

### 1. Project Setup

Create a new module in the `apps` directory:

```bash
mkdir -p apps/my-custom-module
cd apps/my-custom-module
pnpm init
```

**package.json**:
```json
{
  "name": "my-custom-module",
  "version": "1.0.0",
  "main": "dist/MyModule.js",
  "types": "dist/MyModule.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc -w"
  },
  "dependencies": {
    "@dethernety/dt-module": "workspace:*",
    "@nestjs/common": "^10.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

**tsconfig.json**:
```json
{
  "extends": "../../packages/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### 2. Basic Module Structure

```
my-custom-module/
├── src/
│   ├── MyModule.ts          # Main module class
│   └── rego-policies/       # OPA/Rego policy files
│       ├── components/
│       ├── dataflows/
│       └── controls/
├── package.json
├── tsconfig.json
└── dist/                    # Compiled output
```

## Module Implementation Patterns

### Pattern 1: Database-Backed Module with OPA Policies

This is the recommended pattern for most modules:

```typescript
// src/MyModule.ts
import { DtNeo4jOpaModule } from "@dethernety/dt-module";
import { Logger } from '@nestjs/common';

export default class MyCustomModule extends DtNeo4jOpaModule {
  constructor(driver: any, logger: Logger) {
    const moduleName = 'my-custom-module';
    super(moduleName, driver, logger);
  }

  async getMetadata() {
    // Ensure module exists in Neo4j
    await this.ensureModuleExists();
    // Use parent implementation to fetch from Neo4j
    return super.getMetadata();
  }

  private async ensureModuleExists() {
    const session = this.driver.session();
    try {
      await session.run(`
        MERGE (module:DTModule {name: $name})
        ON CREATE SET
          module.description = $description,
          module.version = $version,
          module.author = $author,
          module.icon = $icon,
          module.createdAt = datetime()
        ON MATCH SET
          module.description = $description,
          module.version = $version,
          module.author = $author,
          module.icon = $icon,
          module.updatedAt = datetime()
      `, {
        name: 'my-custom-module',
        description: 'My custom security module',
        version: '1.0.0',
        author: 'Your Name',
        icon: 'shield'
      });
    } finally {
      session.close();
    }
  }
}
```

### Pattern 2: Analysis-Focused Module

For modules that primarily provide AI analysis capabilities:

```typescript
// src/AnalysisModule.ts
import { DTModule, AnalysisClassMetadata } from "@dethernety/dt-module";
import { Logger } from '@nestjs/common';

export default class MyAnalysisModule implements DTModule {
  constructor(
    private readonly driver: any,
    private readonly logger: Logger
  ) {}

  async getMetadata() {
    return {
      name: 'my-analysis-module',
      description: 'Custom analysis capabilities',
      version: '1.0.0',
      author: 'Your Name',
      icon: 'analytics',
      analysisClasses: [
        {
          id: 'security-scan',
          name: 'Security Scan',
          description: 'Comprehensive security analysis',
          type: 'security',
          category: 'vulnerability-assessment'
        }
      ]
    };
  }

  async runAnalysis(
    analysisId: string,
    analysisClassId: string,
    scope: string,
    pubSub: ExtendedPubSubEngine,
    additionalParams?: object
  ): Promise<AnalysisSession> {
    this.logger.log(`Starting analysis: ${analysisClassId} for scope: ${scope}`);
    
    // Publish progress updates
    pubSub.publish(`analysis.${analysisId}.progress`, {
      message: 'Analysis started',
      progress: 0
    });

    // Implement your analysis logic here
    // This could involve:
    // 1. Querying Neo4j for component data
    // 2. Running AI/LLM analysis
    // 3. Calling external services
    // 4. Publishing incremental results

    return {
      sessionId: `session-${analysisId}-${Date.now()}`
    };
  }

  async getAnalysisStatus(analysisId: string): Promise<AnalysisStatus> {
    // Return current status of the analysis
    return {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'running',
      interrupts: null,
      messages: [],
      metadata: {}
    };
  }
}
```

## Working Examples

### Example 1: Container Security Module

Based on the existing `dethernety-module` pattern:

```typescript
// apps/container-security-module/src/ContainerModule.ts
import { DtNeo4jOpaModule } from "@dethernety/dt-module";
import { Logger } from '@nestjs/common';

export default class ContainerSecurityModule extends DtNeo4jOpaModule {
  constructor(driver: any, logger: Logger) {
    super('container-security', driver, logger);
  }

  async getMetadata() {
    await this.createModuleData();
    return super.getMetadata();
  }

  private async createModuleData() {
    const session = this.driver.session();
    try {
      // Create module node
      await session.run(`
        MERGE (module:DTModule {name: 'container-security'})
        SET module.description = 'Container and Kubernetes security components',
            module.version = '1.0.0',
            module.author = 'Security Team',
            module.icon = 'container'
      `);

      // Create component classes
      await session.run(`
        MATCH (module:DTModule {name: 'container-security'})
        MERGE (module)-[:MODULE_PROVIDES_CLASS]->(cc:DTComponentClass {
          id: 'kubernetes-pod',
          name: 'Kubernetes Pod',
          type: 'PROCESS',
          category: 'Container',
          description: 'A Kubernetes Pod containing one or more containers',
          properties: $properties,
          regoPolicies: $regoPolicies
        })
      `, {
        properties: JSON.stringify({
          type: 'object',
          properties: {
            image: { type: 'string', title: 'Container Image' },
            privileged: { type: 'boolean', title: 'Privileged Mode' },
            securityContext: { type: 'object', title: 'Security Context' }
          }
        }),
        regoPolicies: `
          package container.security.kubernetes_pod

          exposures[exposure] {
            input.privileged == true
            exposure := {
              "name": "Privileged Container",
              "description": "Container running in privileged mode",
              "criticality": "high",
              "type": "misconfiguration",
              "category": "container-security",
              "exploited_by": ["T1611"]
            }
          }

          countermeasures[countermeasure] {
            input.privileged == true
            countermeasure := {
              "name": "Remove Privileged Mode",
              "description": "Configure container to run without privileged access",
              "criticality": "high",
              "type": "configuration",
              "category": "container-hardening",
              "responds_with": ["D3-SCA"]
            }
          }
        `
      });

    } finally {
      session.close();
    }
  }
}
```

### Example 2: AI Analysis Module

Based on the existing `dethermine` pattern:

```typescript
// apps/threat-intelligence-module/src/ThreatIntelModule.ts
import { DTModule } from "@dethernety/dt-module";
import { Logger } from '@nestjs/common';

export default class ThreatIntelligenceModule implements DTModule {
  constructor(
    private readonly driver: any,
    private readonly logger: Logger
  ) {}

  async getMetadata() {
    return {
      name: 'threat-intelligence',
      description: 'AI-powered threat intelligence analysis',
      version: '1.0.0',
      author: 'Security Team',
      icon: 'intelligence',
      analysisClasses: [
        {
          id: 'threat-landscape-analysis',
          name: 'Threat Landscape Analysis',
          description: 'Analyze current threat landscape for the system',
          type: 'intelligence',
          category: 'threat-analysis'
        },
        {
          id: 'attack-path-discovery',
          name: 'Attack Path Discovery',
          description: 'Discover potential attack paths through the system',
          type: 'pathfinding',
          category: 'attack-simulation'
        }
      ]
    };
  }

  async runAnalysis(
    analysisId: string,
    analysisClassId: string,
    scope: string,
    pubSub: ExtendedPubSubEngine
  ): Promise<AnalysisSession> {
    
    switch (analysisClassId) {
      case 'threat-landscape-analysis':
        return this.runThreatLandscapeAnalysis(analysisId, scope, pubSub);
      case 'attack-path-discovery':
        return this.runAttackPathDiscovery(analysisId, scope, pubSub);
      default:
        throw new Error(`Unknown analysis class: ${analysisClassId}`);
    }
  }

  private async runThreatLandscapeAnalysis(
    analysisId: string,
    scope: string,
    pubSub: ExtendedPubSubEngine
  ): Promise<AnalysisSession> {
    
    // Query system components in scope
    const session = this.driver.session();
    try {
      const result = await session.run(`
        MATCH (c:Component)
        WHERE c.id STARTS WITH $scope
        RETURN c.id, c.type, c.attributes
      `, { scope });

      const components = result.records.map(record => ({
        id: record.get('c.id'),
        type: record.get('c.type'),
        attributes: record.get('c.attributes')
      }));

      // Publish initial findings
      pubSub.publish(`analysis.${analysisId}.progress`, {
        message: `Found ${components.length} components to analyze`,
        progress: 25
      });

      // Run threat intelligence analysis
      // (This would integrate with your AI/LLM service)
      
      return {
        sessionId: `threat-intel-${Date.now()}`
      };

    } finally {
      session.close();
    }
  }

  private async runAttackPathDiscovery(
    analysisId: string,
    scope: string,
    pubSub: ExtendedPubSubEngine
  ): Promise<AnalysisSession> {
    
    // Implementation for attack path discovery
    pubSub.publish(`analysis.${analysisId}.progress`, {
      message: 'Discovering potential attack paths...',
      progress: 0
    });

    // Your attack path analysis logic here
    
    return {
      sessionId: `attack-path-${Date.now()}`
    };
  }
}
```

## Custom Module Integration

### Overview

For maximum flexibility, you can create completely custom modules that implement only the `DTModule` interface without using any of the provided base classes. This approach is ideal when you need:

- **External System Integration**: Connect to monitoring systems, threat intelligence feeds, cloud APIs, etc.
- **Custom Business Logic**: Implement proprietary algorithms or specialized security assessments
- **Legacy System Integration**: Bridge existing security tools and databases
- **Real-time Data Processing**: Stream and process live security events
- **Custom Protocols**: Support non-standard data formats or communication protocols

### Use Cases for Custom Modules

#### 1. Cloud Discovery and Security Assessment

Integrate with cloud providers to automatically discover and assess resources:

```typescript
// apps/aws-discovery-module/src/AwsDiscoveryModule.ts
import { DTModule, DTMetadata, Exposure, Countermeasure } from "@dethernety/dt-module";
import { Logger } from '@nestjs/common';
import { EC2Client, DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { S3Client, GetBucketPolicyStatusCommand } from "@aws-sdk/client-s3";

export default class AwsDiscoveryModule implements DTModule {
  private ec2Client: EC2Client;
  private s3Client: S3Client;

  constructor(
    private readonly driver: any,
    private readonly logger: Logger
  ) {
    this.ec2Client = new EC2Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
      }
    });
    
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
      }
    });
  }

  async getMetadata(): Promise<DTMetadata> {
    return {
      name: 'aws-discovery',
      description: 'AWS Cloud Discovery and Security Assessment',
      version: '1.0.0',
      author: 'Cloud Security Team',
      icon: 'aws',
      componentClasses: [
        {
          id: 'aws-ec2-instance',
          name: 'AWS EC2 Instance',
          description: 'Amazon Elastic Compute Cloud instance',
          type: 'PROCESS',
          category: 'Cloud Compute',
          properties: {
            type: 'object',
            properties: {
              instanceId: { type: 'string', title: 'Instance ID' },
              instanceType: { type: 'string', title: 'Instance Type' },
              publicIp: { type: 'string', title: 'Public IP Address' },
              securityGroups: { type: 'array', title: 'Security Groups' },
              subnetId: { type: 'string', title: 'Subnet ID' },
              iamRole: { type: 'string', title: 'IAM Role' }
            }
          }
        },
        {
          id: 'aws-s3-bucket',
          name: 'AWS S3 Bucket',
          description: 'Amazon Simple Storage Service bucket',
          type: 'DATA_STORE',
          category: 'Cloud Storage',
          properties: {
            type: 'object',
            properties: {
              bucketName: { type: 'string', title: 'Bucket Name' },
              region: { type: 'string', title: 'Region' },
              versioning: { type: 'boolean', title: 'Versioning Enabled' },
              encryption: { type: 'string', title: 'Encryption Type' },
              publicAccess: { type: 'boolean', title: 'Public Access Blocked' }
            }
          }
        }
      ],
      analysisClasses: [
        {
          id: 'aws-resource-discovery',
          name: 'AWS Resource Discovery',
          description: 'Discover and catalog AWS resources',
          type: 'discovery',
          category: 'cloud-assessment'
        }
      ]
    };
  }

  async getClassTemplate(id: string): Promise<string> {
    const templates = {
      'aws-ec2-instance': JSON.stringify({
        schema: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', title: 'Instance ID' },
            instanceType: { 
              type: 'string', 
              title: 'Instance Type',
              enum: ['t2.micro', 't2.small', 't2.medium', 'm5.large', 'c5.large']
            },
            publicIp: { type: 'string', title: 'Public IP Address' },
            securityGroups: { 
              type: 'array', 
              title: 'Security Groups',
              items: { type: 'string' }
            },
            keyPairName: { type: 'string', title: 'Key Pair Name' },
            userData: { type: 'string', title: 'User Data Script' }
          },
          required: ['instanceId', 'instanceType']
        },
        uischema: {
          type: 'VerticalLayout',
          elements: [
            { type: 'Control', scope: '#/properties/instanceId' },
            { type: 'Control', scope: '#/properties/instanceType' },
            { type: 'Control', scope: '#/properties/publicIp' },
            { type: 'Control', scope: '#/properties/securityGroups' }
          ]
        }
      }),
      
      'aws-s3-bucket': JSON.stringify({
        schema: {
          type: 'object',
          properties: {
            bucketName: { type: 'string', title: 'Bucket Name' },
            versioning: { type: 'boolean', title: 'Versioning Enabled' },
            mfaDelete: { type: 'boolean', title: 'MFA Delete Required' },
            serverSideEncryption: {
              type: 'string',
              title: 'Server-Side Encryption',
              enum: ['None', 'AES256', 'aws:kms']
            },
            publicReadBlocked: { type: 'boolean', title: 'Block Public Read' },
            publicWriteBlocked: { type: 'boolean', title: 'Block Public Write' }
          },
          required: ['bucketName']
        },
        uischema: {
          type: 'VerticalLayout',
          elements: [
            { type: 'Control', scope: '#/properties/bucketName' },
            { type: 'Control', scope: '#/properties/versioning' },
            { type: 'Control', scope: '#/properties/serverSideEncryption' },
            { type: 'Control', scope: '#/properties/publicReadBlocked' },
            { type: 'Control', scope: '#/properties/publicWriteBlocked' }
          ]
        }
      })
    };

    return templates[id] || '{}';
  }

  async getExposures(id: string, classId: string): Promise<Exposure[]> {
    const exposures: Exposure[] = [];
    
    // Get component attributes from Neo4j
    const session = this.driver.session();
    try {
      const result = await session.run(`
        MATCH (c:Component {id: $id})
        RETURN c.attributes as attributes
      `, { id });
      
      if (result.records.length === 0) {
        return exposures;
      }

      const attributes = result.records[0].get('attributes');
      
      // Custom logic for different component types
      switch (classId) {
        case 'aws-ec2-instance':
          exposures.push(...await this.assessEC2Exposures(attributes));
          break;
        case 'aws-s3-bucket':
          exposures.push(...await this.assessS3Exposures(attributes));
          break;
      }

    } finally {
      session.close();
    }

    return exposures;
  }

  private async assessEC2Exposures(attributes: any): Promise<Exposure[]> {
    const exposures: Exposure[] = [];

    // Check for public IP exposure
    if (attributes.publicIp) {
      // Query AWS to get actual security group rules
      try {
        const instanceData = await this.getEC2InstanceDetails(attributes.instanceId);
        
        if (this.hasOpenSecurityGroups(instanceData.securityGroups)) {
          exposures.push({
            name: 'Public EC2 Instance with Open Security Groups',
            description: 'EC2 instance is publicly accessible with overly permissive security group rules',
            criticality: 'high',
            type: 'network-exposure',
            category: 'cloud-security',
            exploitedBy: ['T1190', 'T1133']
          });
        }
        
        if (!instanceData.iamRole) {
          exposures.push({
            name: 'EC2 Instance Without IAM Role',
            description: 'EC2 instance running without an IAM role for secure API access',
            criticality: 'medium',
            type: 'access-control',
            category: 'cloud-security',
            exploitedBy: ['T1078']
          });
        }

      } catch (error) {
        this.logger.warn(`Failed to assess EC2 instance ${attributes.instanceId}:`, error);
      }
    }

    return exposures;
  }

  private async assessS3Exposures(attributes: any): Promise<Exposure[]> {
    const exposures: Exposure[] = [];

    try {
      const bucketStatus = await this.getS3BucketStatus(attributes.bucketName);
      
      if (!bucketStatus.publicAccessBlocked) {
        exposures.push({
          name: 'S3 Bucket Public Access Not Blocked',
          description: 'S3 bucket allows public access which may lead to data exposure',
          criticality: 'high',
          type: 'data-exposure',
          category: 'cloud-security',
          exploitedBy: ['T1530']
        });
      }

      if (bucketStatus.encryption === 'None') {
        exposures.push({
          name: 'Unencrypted S3 Bucket',
          description: 'S3 bucket data is not encrypted at rest',
          criticality: 'medium',
          type: 'encryption',
          category: 'cloud-security',
          exploitedBy: ['T1005']
        });
      }

      if (!bucketStatus.versioning) {
        exposures.push({
          name: 'S3 Bucket Versioning Disabled',
          description: 'S3 bucket versioning is disabled, preventing recovery from data corruption',
          criticality: 'low',
          type: 'data-protection',
          category: 'cloud-security'
        });
      }

    } catch (error) {
      this.logger.warn(`Failed to assess S3 bucket ${attributes.bucketName}:`, error);
    }

    return exposures;
  }

  async getCountermeasures(id: string, classId: string): Promise<Countermeasure[]> {
    const countermeasures: Countermeasure[] = [];
    
    // Get exposures first to determine appropriate countermeasures
    const exposures = await this.getExposures(id, classId);
    
    for (const exposure of exposures) {
      switch (exposure.name) {
        case 'Public EC2 Instance with Open Security Groups':
          countermeasures.push({
            name: 'Restrict Security Group Rules',
            description: 'Update security group rules to allow only necessary traffic from trusted sources',
            criticality: 'high',
            type: 'network-control',
            category: 'cloud-security',
            respondsWith: ['D3-NTA', 'D3-ACM']
          });
          break;

        case 'S3 Bucket Public Access Not Blocked':
          countermeasures.push({
            name: 'Enable S3 Block Public Access',
            description: 'Enable S3 Block Public Access settings to prevent accidental public exposure',
            criticality: 'high',
            type: 'access-control',
            category: 'cloud-security',
            respondsWith: ['D3-ACM']
          });
          break;

        case 'Unencrypted S3 Bucket':
          countermeasures.push({
            name: 'Enable S3 Server-Side Encryption',
            description: 'Configure server-side encryption using AWS KMS or AES-256',
            criticality: 'medium',
            type: 'encryption',
            category: 'cloud-security',
            respondsWith: ['D3-SYSC']
          });
          break;
      }
    }

    return countermeasures;
  }

  // Helper methods for AWS API integration
  private async getEC2InstanceDetails(instanceId: string) {
    const command = new DescribeInstancesCommand({
      InstanceIds: [instanceId]
    });
    
    const response = await this.ec2Client.send(command);
    const instance = response.Reservations?.[0]?.Instances?.[0];
    
    return {
      securityGroups: instance?.SecurityGroups || [],
      iamRole: instance?.IamInstanceProfile?.Arn,
      publicIp: instance?.PublicIpAddress
    };
  }

  private hasOpenSecurityGroups(securityGroups: any[]): boolean {
    return securityGroups.some(sg => 
      sg.IpPermissions?.some((rule: any) => 
        rule.IpRanges?.some((range: any) => range.CidrIp === '0.0.0.0/0')
      )
    );
  }

  private async getS3BucketStatus(bucketName: string) {
    try {
      const command = new GetBucketPolicyStatusCommand({ Bucket: bucketName });
      const response = await this.s3Client.send(command);
      
      return {
        publicAccessBlocked: !response.PolicyStatus?.IsPublic,
        encryption: 'AES256', // Would need additional API calls to determine actual encryption
        versioning: false // Would need additional API calls to determine versioning status
      };
    } catch (error) {
      this.logger.warn(`Failed to get S3 bucket status for ${bucketName}:`, error);
      return {
        publicAccessBlocked: false,
        encryption: 'None',
        versioning: false
      };
    }
  }

  async runAnalysis(
    analysisId: string,
    analysisClassId: string,
    scope: string,
    pubSub: ExtendedPubSubEngine
  ): Promise<AnalysisSession> {
    
    if (analysisClassId === 'aws-resource-discovery') {
      return this.runResourceDiscovery(analysisId, scope, pubSub);
    }
    
    throw new Error(`Unknown analysis class: ${analysisClassId}`);
  }

  private async runResourceDiscovery(
    analysisId: string,
    scope: string,
    pubSub: ExtendedPubSubEngine
  ): Promise<AnalysisSession> {
    
    pubSub.publish(`analysis.${analysisId}.progress`, {
      message: 'Starting AWS resource discovery...',
      progress: 0
    });

    try {
      // Discover EC2 instances
      const ec2Instances = await this.discoverEC2Instances();
      pubSub.publish(`analysis.${analysisId}.progress`, {
        message: `Found ${ec2Instances.length} EC2 instances`,
        progress: 50
      });

      // Create components in Neo4j for discovered resources
      const session = this.driver.session();
      try {
        for (const instance of ec2Instances) {
          await session.run(`
            MERGE (c:Component {id: $id})
            SET c.name = $name,
                c.type = 'PROCESS',
                c.dt_class_id = 'aws-ec2-instance',
                c.attributes = $attributes,
                c.discoveredAt = datetime()
          `, {
            id: `aws-ec2-${instance.InstanceId}`,
            name: `EC2 Instance ${instance.InstanceId}`,
            attributes: {
              instanceId: instance.InstanceId,
              instanceType: instance.InstanceType,
              publicIp: instance.PublicIpAddress,
              privateIp: instance.PrivateIpAddress,
              state: instance.State?.Name
            }
          });
        }
      } finally {
        session.close();
      }

      pubSub.publish(`analysis.${analysisId}.progress`, {
        message: 'AWS resource discovery completed',
        progress: 100
      });

    } catch (error) {
      this.logger.error('AWS resource discovery failed:', error);
      pubSub.publish(`analysis.${analysisId}.error`, {
        message: `Discovery failed: ${error.message}`
      });
    }

    return {
      sessionId: `aws-discovery-${Date.now()}`
    };
  }

  private async discoverEC2Instances() {
    const command = new DescribeInstancesCommand({});
    const response = await this.ec2Client.send(command);
    
    const instances = [];
    for (const reservation of response.Reservations || []) {
      instances.push(...(reservation.Instances || []));
    }
    
    return instances;
  }
}
```

#### 2. SIEM Integration Module

Connect to Security Information and Event Management systems for real-time threat detection:

```typescript
// apps/siem-integration-module/src/SiemIntegrationModule.ts
import { DTModule, DTMetadata, Exposure } from "@dethernety/dt-module";
import { Logger } from '@nestjs/common';
import axios from 'axios';

export default class SiemIntegrationModule implements DTModule {
  private siemApiUrl: string;
  private siemApiKey: string;

  constructor(
    private readonly driver: any,
    private readonly logger: Logger
  ) {
    this.siemApiUrl = process.env.SIEM_API_URL || 'https://siem.example.com/api/v1';
    this.siemApiKey = process.env.SIEM_API_KEY!;
  }

  async getMetadata(): Promise<DTMetadata> {
    return {
      name: 'siem-integration',
      description: 'SIEM Integration for Real-time Threat Detection',
      version: '1.0.0',
      author: 'Security Operations Team',
      icon: 'monitor',
      componentClasses: [
        {
          id: 'monitored-component',
          name: 'Monitored Component',
          description: 'A system component with SIEM monitoring',
          type: 'PROCESS',
          category: 'Monitored Systems',
          properties: {
            type: 'object',
            properties: {
              siemSourceId: { type: 'string', title: 'SIEM Source ID' },
              logSources: { type: 'array', title: 'Log Sources' },
              alertThresholds: { type: 'object', title: 'Alert Thresholds' },
              monitoringEnabled: { type: 'boolean', title: 'Monitoring Enabled' }
            }
          }
        }
      ],
      analysisClasses: [
        {
          id: 'threat-correlation',
          name: 'Threat Correlation Analysis',
          description: 'Correlate threats across SIEM data',
          type: 'correlation',
          category: 'threat-detection'
        }
      ]
    };
  }

  async getExposures(id: string, classId: string): Promise<Exposure[]> {
    const exposures: Exposure[] = [];
    
    // Get component attributes
    const session = this.driver.session();
    try {
      const result = await session.run(`
        MATCH (c:Component {id: $id})
        RETURN c.attributes as attributes
      `, { id });
      
      if (result.records.length === 0) {
        return exposures;
      }

      const attributes = result.records[0].get('attributes');
      
      // Query SIEM for real-time threat indicators
      const threats = await this.queryRealtimeThreats(attributes.siemSourceId);
      
      for (const threat of threats) {
        exposures.push({
          name: threat.name,
          description: threat.description,
          criticality: threat.severity,
          type: 'runtime-threat',
          category: 'active-threat',
          exploitedBy: threat.techniques || []
        });
      }

    } catch (error) {
      this.logger.error('Failed to query SIEM for threats:', error);
    } finally {
      session.close();
    }

    return exposures;
  }

  private async queryRealtimeThreats(sourceId: string) {
    try {
      const response = await axios.get(`${this.siemApiUrl}/threats/active`, {
        headers: {
          'Authorization': `Bearer ${this.siemApiKey}`,
          'Content-Type': 'application/json'
        },
        params: {
          sourceId: sourceId,
          timeWindow: '1h',
          minSeverity: 'medium'
        }
      });

      return response.data.threats || [];
    } catch (error) {
      this.logger.warn(`Failed to query SIEM threats for source ${sourceId}:`, error);
      return [];
    }
  }
}
```

#### 3. Vulnerability Scanner Integration

Integrate with vulnerability scanners for automated security assessments:

```typescript
// apps/vuln-scanner-module/src/VulnScannerModule.ts
import { DTModule, DTMetadata, Exposure, Countermeasure } from "@dethernety/dt-module";
import { Logger } from '@nestjs/common';
import axios from 'axios';

export default class VulnScannerModule implements DTModule {
  constructor(
    private readonly driver: any,
    private readonly logger: Logger
  ) {}

  async getMetadata(): Promise<DTMetadata> {
    return {
      name: 'vulnerability-scanner',
      description: 'Integration with vulnerability scanning tools',
      version: '1.0.0',
      author: 'Vulnerability Management Team',
      icon: 'bug-report',
      componentClasses: [
        {
          id: 'scannable-host',
          name: 'Scannable Host',
          description: 'A host or service that can be vulnerability scanned',
          type: 'PROCESS',
          category: 'Infrastructure',
          properties: {
            type: 'object',
            properties: {
              ipAddress: { type: 'string', title: 'IP Address' },
              hostname: { type: 'string', title: 'Hostname' },
              operatingSystem: { type: 'string', title: 'Operating System' },
              services: { type: 'array', title: 'Running Services' },
              lastScanDate: { type: 'string', format: 'date-time', title: 'Last Scan Date' },
              scanProfile: { 
                type: 'string', 
                enum: ['basic', 'comprehensive', 'compliance'], 
                title: 'Scan Profile' 
              }
            }
          }
        }
      ],
      analysisClasses: [
        {
          id: 'vulnerability-assessment',
          name: 'Vulnerability Assessment',
          description: 'Automated vulnerability scanning and assessment',
          type: 'security-scan',
          category: 'vulnerability-management'
        }
      ]
    };
  }

  async getExposures(id: string, classId: string): Promise<Exposure[]> {
    const exposures: Exposure[] = [];
    
    if (classId !== 'scannable-host') {
      return exposures;
    }

    // Get host attributes
    const session = this.driver.session();
    try {
      const result = await session.run(`
        MATCH (c:Component {id: $id})
        RETURN c.attributes as attributes
      `, { id });
      
      if (result.records.length === 0) {
        return exposures;
      }

      const attributes = result.records[0].get('attributes');
      
      // Get latest scan results from vulnerability database
      const vulnerabilities = await this.getVulnerabilities(attributes.ipAddress || attributes.hostname);
      
      for (const vuln of vulnerabilities) {
        exposures.push({
          name: `${vuln.title} (${vuln.cve})`,
          description: `${vuln.description}. CVSS Score: ${vuln.cvssScore}`,
          criticality: this.mapCvssToSeverity(vuln.cvssScore),
          type: 'vulnerability',
          category: 'software-vulnerability',
          exploitedBy: vuln.attackTechniques || []
        });
      }

    } finally {
      session.close();
    }

    return exposures;
  }

  async getCountermeasures(id: string, classId: string): Promise<Countermeasure[]> {
    const countermeasures: Countermeasure[] = [];
    
    // Get vulnerabilities first
    const exposures = await this.getExposures(id, classId);
    
    // Get component attributes for context
    const session = this.driver.session();
    try {
      const result = await session.run(`
        MATCH (c:Component {id: $id})
        RETURN c.attributes as attributes
      `, { id });
      
      if (result.records.length === 0) {
        return countermeasures;
      }

      const attributes = result.records[0].get('attributes');
      
      // Get remediation recommendations from vulnerability database
      const remediations = await this.getRemediationRecommendations(
        attributes.ipAddress || attributes.hostname,
        exposures.map(e => this.extractCVE(e.name))
      );

      for (const remediation of remediations) {
        countermeasures.push({
          name: remediation.title,
          description: remediation.description,
          criticality: remediation.priority,
          type: 'remediation',
          category: 'vulnerability-management',
          respondsWith: remediation.defenseControls || []
        });
      }

    } finally {
      session.close();
    }

    return countermeasures;
  }

  private async getVulnerabilities(hostIdentifier: string) {
    try {
      // This would integrate with your vulnerability scanner API
      // Examples: Nessus, OpenVAS, Qualys, Rapid7, etc.
      
      const response = await axios.get(`${process.env.VULN_SCANNER_API}/hosts/${hostIdentifier}/vulnerabilities`, {
        headers: {
          'X-API-KEY': process.env.VULN_SCANNER_API_KEY
        },
        params: {
          severity: 'medium,high,critical',
          status: 'open'
        }
      });

      return response.data.vulnerabilities.map((vuln: any) => ({
        cve: vuln.cve_id,
        title: vuln.name,
        description: vuln.description,
        cvssScore: vuln.cvss_base_score,
        solution: vuln.solution,
        attackTechniques: this.mapVulnToAttackTechniques(vuln)
      }));

    } catch (error) {
      this.logger.warn(`Failed to get vulnerabilities for ${hostIdentifier}:`, error);
      return [];
    }
  }

  private async getRemediationRecommendations(hostIdentifier: string, cveList: string[]) {
    try {
      const response = await axios.post(`${process.env.VULN_SCANNER_API}/remediation`, {
        host: hostIdentifier,
        cves: cveList
      }, {
        headers: {
          'X-API-KEY': process.env.VULN_SCANNER_API_KEY
        }
      });

      return response.data.remediations || [];
    } catch (error) {
      this.logger.warn(`Failed to get remediation recommendations for ${hostIdentifier}:`, error);
      return [];
    }
  }

  private mapCvssToSeverity(cvssScore: number): string {
    if (cvssScore >= 9.0) return 'critical';
    if (cvssScore >= 7.0) return 'high';
    if (cvssScore >= 4.0) return 'medium';
    return 'low';
  }

  private mapVulnToAttackTechniques(vuln: any): string[] {
    // Map vulnerability types to MITRE ATT&CK techniques
    const mappings: { [key: string]: string[] } = {
      'remote_code_execution': ['T1203', 'T1210'],
      'privilege_escalation': ['T1068', 'T1078'],
      'information_disclosure': ['T1005', 'T1083'],
      'denial_of_service': ['T1499'],
      'sql_injection': ['T1190'],
      'cross_site_scripting': ['T1190']
    };

    for (const [vulnType, techniques] of Object.entries(mappings)) {
      if (vuln.description.toLowerCase().includes(vulnType.replace('_', ' '))) {
        return techniques;
      }
    }

    return ['T1190']; // Default to initial access
  }

  private extractCVE(exposureName: string): string {
    const cveMatch = exposureName.match(/\(CVE-\d{4}-\d+\)/);
    return cveMatch ? cveMatch[0].slice(1, -1) : '';
  }
}
```

#### 4. Threat Intelligence Feed Integration

Connect to external threat intelligence sources:

```typescript
// apps/threat-intel-feed-module/src/ThreatIntelFeedModule.ts
import { DTModule, DTMetadata, Exposure } from "@dethernety/dt-module";
import { Logger } from '@nestjs/common';
import axios from 'axios';

export default class ThreatIntelFeedModule implements DTModule {
  private readonly threatFeeds = [
    {
      name: 'AlienVault OTX',
      url: 'https://otx.alienvault.com/api/v1',
      apiKey: process.env.ALIENVAULT_API_KEY
    },
    {
      name: 'VirusTotal',
      url: 'https://www.virustotal.com/vtapi/v2',
      apiKey: process.env.VIRUSTOTAL_API_KEY
    }
  ];

  constructor(
    private readonly driver: any,
    private readonly logger: Logger
  ) {}

  async getMetadata(): Promise<DTMetadata> {
    return {
      name: 'threat-intelligence-feeds',
      description: 'Integration with external threat intelligence feeds',
      version: '1.0.0',
      author: 'Threat Intelligence Team',
      icon: 'threat-intel',
      componentClasses: [
        {
          id: 'internet-facing-service',
          name: 'Internet-Facing Service',
          description: 'A service exposed to the internet that can be checked against threat intelligence',
          type: 'PROCESS',
          category: 'Public Services',
          properties: {
            type: 'object',
            properties: {
              publicIp: { type: 'string', title: 'Public IP Address' },
              domain: { type: 'string', title: 'Domain Name' },
              ports: { type: 'array', title: 'Open Ports' },
              serviceFingerprint: { type: 'string', title: 'Service Fingerprint' },
              sslCertificate: { type: 'object', title: 'SSL Certificate Info' }
            }
          }
        }
      ]
    };
  }

  async getExposures(id: string, classId: string): Promise<Exposure[]> {
    const exposures: Exposure[] = [];
    
    if (classId !== 'internet-facing-service') {
      return exposures;
    }

    const session = this.driver.session();
    try {
      const result = await session.run(`
        MATCH (c:Component {id: $id})
        RETURN c.attributes as attributes
      `, { id });
      
      if (result.records.length === 0) {
        return exposures;
      }

      const attributes = result.records[0].get('attributes');
      
      // Check IP reputation
      if (attributes.publicIp) {
        const ipThreats = await this.checkIpReputation(attributes.publicIp);
        exposures.push(...ipThreats);
      }

      // Check domain reputation
      if (attributes.domain) {
        const domainThreats = await this.checkDomainReputation(attributes.domain);
        exposures.push(...domainThreats);
      }

      // Check for known attack patterns
      if (attributes.serviceFingerprint) {
        const serviceThreats = await this.checkServiceThreats(attributes.serviceFingerprint);
        exposures.push(...serviceThreats);
      }

    } finally {
      session.close();
    }

    return exposures;
  }

  private async checkIpReputation(ipAddress: string): Promise<Exposure[]> {
    const exposures: Exposure[] = [];
    
    try {
      // Check multiple threat intelligence sources
      const otxResults = await this.queryOTX('IPv4', ipAddress);
      const vtResults = await this.queryVirusTotal('ip-address', ipAddress);

      // Process OTX results
      if (otxResults.pulse_info?.count > 0) {
        for (const pulse of otxResults.pulse_info.pulses.slice(0, 5)) {
          exposures.push({
            name: `Threat Intelligence Alert: ${pulse.name}`,
            description: `IP address ${ipAddress} associated with threat: ${pulse.description}`,
            criticality: this.mapThreatSeverity(pulse.tags),
            type: 'threat-intelligence',
            category: 'reputation',
            exploitedBy: this.mapTagsToTechniques(pulse.tags)
          });
        }
      }

      // Process VirusTotal results
      if (vtResults.detected_communicating_samples?.length > 0) {
        exposures.push({
          name: 'Malware Communication Detected',
          description: `IP address ${ipAddress} has communicated with ${vtResults.detected_communicating_samples.length} malware samples`,
          criticality: 'high',
          type: 'malware-communication',
          category: 'reputation',
          exploitedBy: ['T1071', 'T1105']
        });
      }

    } catch (error) {
      this.logger.warn(`Failed to check IP reputation for ${ipAddress}:`, error);
    }

    return exposures;
  }

  private async checkDomainReputation(domain: string): Promise<Exposure[]> {
    const exposures: Exposure[] = [];
    
    try {
      const otxResults = await this.queryOTX('domain', domain);
      
      if (otxResults.pulse_info?.count > 0) {
        for (const pulse of otxResults.pulse_info.pulses.slice(0, 3)) {
          exposures.push({
            name: `Malicious Domain: ${pulse.name}`,
            description: `Domain ${domain} flagged in threat intelligence: ${pulse.description}`,
            criticality: 'high',
            type: 'malicious-domain',
            category: 'reputation',
            exploitedBy: ['T1071', 'T1566']
          });
        }
      }

    } catch (error) {
      this.logger.warn(`Failed to check domain reputation for ${domain}:`, error);
    }

    return exposures;
  }

  private async checkServiceThreats(serviceFingerprint: string): Promise<Exposure[]> {
    const exposures: Exposure[] = [];
    
    try {
      // Query threat intelligence for known vulnerable service signatures
      const threatResults = await this.queryServiceThreats(serviceFingerprint);
      
      for (const threat of threatResults) {
        exposures.push({
          name: `Vulnerable Service Signature: ${threat.name}`,
          description: `Service fingerprint matches known vulnerable configuration: ${threat.description}`,
          criticality: threat.severity,
          type: 'service-vulnerability',
          category: 'threat-intelligence',
          exploitedBy: threat.techniques
        });
      }

    } catch (error) {
      this.logger.warn(`Failed to check service threats for fingerprint:`, error);
    }

    return exposures;
  }

  private async queryOTX(indicatorType: string, indicator: string) {
    try {
      const response = await axios.get(
        `${this.threatFeeds[0].url}/${indicatorType}/${indicator}/general`,
        {
          headers: {
            'X-OTX-API-KEY': this.threatFeeds[0].apiKey
          }
        }
      );
      return response.data;
    } catch (error) {
      this.logger.debug(`OTX query failed for ${indicator}:`, error.message);
      return {};
    }
  }

  private async queryVirusTotal(resource: string, indicator: string) {
    try {
      const response = await axios.get(`${this.threatFeeds[1].url}/ip-address/report`, {
        params: {
          apikey: this.threatFeeds[1].apiKey,
          ip: indicator
        }
      });
      return response.data;
    } catch (error) {
      this.logger.debug(`VirusTotal query failed for ${indicator}:`, error.message);
      return {};
    }
  }

  private mapThreatSeverity(tags: string[]): string {
    const highSeverityTags = ['apt', 'malware', 'botnet', 'ransomware'];
    const mediumSeverityTags = ['suspicious', 'phishing', 'spam'];
    
    if (tags.some(tag => highSeverityTags.includes(tag.toLowerCase()))) {
      return 'high';
    }
    if (tags.some(tag => mediumSeverityTags.includes(tag.toLowerCase()))) {
      return 'medium';
    }
    return 'low';
  }

  private mapTagsToTechniques(tags: string[]): string[] {
    const mappings: { [key: string]: string[] } = {
      'malware': ['T1105', 'T1071'],
      'phishing': ['T1566'],
      'botnet': ['T1071', 'T1573'],
      'apt': ['T1190', 'T1566', 'T1203'],
      'ransomware': ['T1486', 'T1490']
    };

    const techniques = new Set<string>();
    for (const tag of tags) {
      const tagTechniques = mappings[tag.toLowerCase()];
      if (tagTechniques) {
        tagTechniques.forEach(t => techniques.add(t));
      }
    }

    return Array.from(techniques);
  }
}
```

### Key Benefits of Custom Modules

1. **Real-time Integration**: Connect to live systems for current threat status
2. **Proprietary Logic**: Implement custom algorithms and business rules
3. **External Data Sources**: Leverage existing security tools and databases
4. **Flexible Assessment**: Create custom exposure and risk assessment logic
5. **Technology-Specific**: Support unique protocols and data formats
6. **Scalable Architecture**: Handle high-volume data processing and analysis

### Development Considerations

**Performance**: Custom modules should implement proper caching and rate limiting when integrating with external APIs.

**Error Handling**: Always implement comprehensive error handling since external systems may be unreliable.

**Security**: Securely handle API keys and credentials using environment variables.

**Testing**: Mock external dependencies for reliable unit testing.

**Documentation**: Provide clear configuration guides for external system integration.

### Frontend Module Development

Analysis modules can provide a custom presentation layer for their analysis results. These frontend modules are loaded dynamically into the Vue/Vuetify SPA during application startup.

#### Frontend Module Architecture

Frontend modules are JavaScript bundles that the backend GraphQL interface provides to the frontend. The bundles contain Vue components that integrate seamlessly with the host application.

#### Available Host Dependencies

The host application exposes the following dependencies to frontend modules:

```javascript
window.__HOST_DEPENDENCIES__ = {
  useHostContext: function, // Main composable providing access to all host services
  services: {
    componentRegistry: ComponentRegistry // Service for registering dynamic components
  },
  __VUE__: VueRuntime, // Vue runtime for creating components
  __APP_CONTEXT__: AppContext // Application context
}
```

#### Host Context Variables

The `useHostContext()` composable provides access to:

**Router & Navigation:**
```javascript
const { router, route } = useHostContext()
// router - Vue Router instance for navigation
// route - Current route information
```

**Stores (State Management):**
```javascript
const { stores } = useHostContext()
// stores.analysisStore - Analysis state management
// stores.issueStore - Issue state management
```

**Services:**
```javascript
const { services } = useHostContext()
// services.componentRegistry - Dynamic component registration
```

**Vue Composition API:**
```javascript
const { vue } = useHostContext()
const { ref, reactive, computed, watch, onMounted, onUnmounted } = vue
// Complete access to Vue composition API
```

**Utilities:**
```javascript
const { utils } = useHostContext()
// utils.resolveComponent - Safe component resolution
// utils.getPageDisplayName - Display name utilities
```

#### Creating a Frontend Module

**1. Module Structure:**
```
apps/my-analysis-module/frontend/
├── index.js                 # Module entry point
├── components/              # Vue components
│   ├── AnalysisResults.vue
│   └── CustomChart.vue
├── vite.config.js          # Build configuration
└── dist/                   # Built bundle
    └── bundle.js
```

**2. Module Entry Point (`index.js`):**
```javascript
import AnalysisResults from './components/AnalysisResults.vue'
import CustomChart from './components/CustomChart.vue'

export default {
  id: "my-analysis-module",
  
  async install(hostDependencies) {
    if (!hostDependencies?.services?.componentRegistry) {
      console.error('Component registry not available')
      return
    }

    const { componentRegistry } = hostDependencies.services

    // Register components for use in the host application
    const components = [
      { key: "analysis_results", component: AnalysisResults },
      { key: "custom_chart", component: CustomChart }
    ]

    components.forEach(({ key, component }) => {
      try {
        componentRegistry.register(key, component, "my-analysis-module")
        console.log(`✅ Registered component: ${key}`)
      } catch (error) {
        console.error(`❌ Failed to register component ${key}:`, error)
      }
    })
  },

  uninstall() {
    const deps = window.__HOST_DEPENDENCIES__
    if (deps?.services?.componentRegistry) {
      deps.services.componentRegistry.unregisterModule('my-analysis-module')
    }
  }
}
```

**3. Vue Component Example (`components/AnalysisResults.vue`):**
```vue
<template>
  <v-card class="analysis-results" elevation="2">
    <v-card-title>Analysis Results</v-card-title>
    <v-card-text>
      <v-progress-linear 
        v-if="isLoading" 
        indeterminate 
        color="primary"
      />
      
      <div v-else>
        <v-alert 
          v-for="finding in findings" 
          :key="finding.id"
          :type="getSeverityType(finding.severity)"
          class="mb-2"
        >
          <v-alert-title>{{ finding.title }}</v-alert-title>
          {{ finding.description }}
        </v-alert>
      </div>
      
      <v-btn 
        @click="runAnalysis" 
        color="primary"
        :loading="isLoading"
      >
        Refresh Analysis
      </v-btn>
    </v-card-text>
  </v-card>
</template>

<script setup>
// Access host context for services and state
const { useHostContext } = window.__HOST_DEPENDENCIES__
const { stores, vue, router } = useHostContext()
const { ref, computed, onMounted } = vue
const { analysisStore } = stores

// Component props
const props = defineProps({
  analysisId: {
    type: String,
    required: true
  },
  scope: {
    type: String,
    default: 'component'
  }
})

// Reactive state
const isLoading = ref(false)
const findings = ref([])

// Computed properties using host store
const analysisResults = computed(() => 
  analysisStore.getAnalysisResults(props.analysisId)
)

// Methods
const runAnalysis = async () => {
  isLoading.value = true
  try {
    await analysisStore.runAnalysis({
      analysisId: props.analysisId,
      analysisClassId: 'security-scan',
      scope: props.scope
    })
    findings.value = analysisResults.value?.findings || []
  } catch (error) {
    console.error('Analysis failed:', error)
  } finally {
    isLoading.value = false
  }
}

const getSeverityType = (severity) => {
  const types = {
    'critical': 'error',
    'high': 'warning', 
    'medium': 'info',
    'low': 'success'
  }
  return types[severity] || 'info'
}

// Lifecycle
onMounted(() => {
  if (analysisResults.value) {
    findings.value = analysisResults.value.findings || []
  }
})
</script>

<style scoped>
.analysis-results {
  max-width: 800px;
  margin: 0 auto;
}
</style>
```

**4. Build Configuration (`vite.config.js`):**
```javascript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: 'index.js',
      name: 'MyAnalysisModule',
      fileName: 'bundle',
      formats: ['umd']
    },
    rollupOptions: {
      external: ['vue'],
      output: {
        globals: {
          vue: 'Vue'
        }
      }
    },
    outDir: 'dist'
  },
  define: {
    'process.env.NODE_ENV': '"production"'
  }
})
```

#### Backend Integration

The frontend bundle loading is automatically handled by the Dethernety framework. You simply need to:

**1. Build your frontend bundle:**
```bash
cd apps/my-analysis-module/frontend
npm run build  # Creates dist/bundle.js
```

**2. Ensure the bundle exists at the expected location:**
```
apps/my-analysis-module/frontend/dist/bundle.js
```

The framework automatically:
- Detects modules with frontend bundles
- Serves bundles via GraphQL API
- Loads bundles dynamically in the frontend
- Handles component registration and lifecycle

No additional backend code is required for bundle serving.

#### Component Selection Mechanism

The framework automatically selects which frontend component to display based on the analysis document structure:

**1. Analysis Document Structure:**
```json
{
  "metadata.analysisId": "12345",
  "metadata.timestamp": "2024-01-01T00:00:00Z",
  "metadata.status": "completed",
  "attack_scenario_summary": {
    "findings": [...],
    "recommendations": [...]
  }
}
```

**2. Component Key Selection:**
The system finds the first key in the document that **does not** start with `metadata.` prefix:

```javascript
// From analysisresults.vue
const key = Object.keys(indexDocument.value ?? {}).find(key => !key.startsWith('metadata.')) || null
indexPage.value = key
```

**3. Component Resolution:**
```javascript
// The key is used to get the registered component
const Comp = componentRegistry.getComponent(key) // Gets component for "attack_scenario_summary"
```

**4. Dynamic Rendering:**
```vue
<component
  v-if="dynamicComponent"
  :is="dynamicComponent"
  :analysis-id="analysisId"
  :content="indexDocument"
  :scope-id="analysisStore.currentAnalysis?.element?.id"
  @redirect:issue="redirectToIssue"
  @update:content="updateIndexDocument"
/>
```

**Example Workflow:**
1. Analysis completes and returns document with key `attack_scenario_summary`
2. Framework looks up `attack_scenario_summary` in component registry
3. Finds the Vue component registered by the threat-analysis-module
4. Renders the component with analysis data as props

**Best Practices for Component Keys:**
- Use descriptive, snake_case keys: `vulnerability_report`, `threat_analysis`, `security_scan`
- Ensure the key matches your component registration:
  ```javascript
  componentRegistry.register("vulnerability_report", VulnerabilityReportComponent, moduleId)
  ```
- The analysis backend should return documents with consistent key naming

#### Context Passing Best Practices

**1. Use Host Context Consistently:**
```javascript
// Always access host dependencies at the top level
const { useHostContext } = window.__HOST_DEPENDENCIES__
const { stores, vue, services } = useHostContext()
```

**2. Leverage Host State Management:**
```javascript
// Use host stores for consistent state
const { analysisStore, issueStore } = stores

// Access reactive data from host stores
const analysisResults = computed(() => 
  analysisStore.getAnalysisResults(props.analysisId)
)
```

**3. Component Registration:**
```javascript
// Register components with meaningful keys
componentRegistry.register("my_analysis_chart", ChartComponent, moduleId)

// Components can then be used in host templates
<component :is="componentRegistry.getComponent('my_analysis_chart')" />
```

**4. Navigation Integration:**
```javascript
// Use host router for navigation
const { router } = useHostContext()

const navigateToResults = () => {
  router.push(`/analysis/${analysisId}/results`)
}
```

#### Frontend Module Loading Process

1. **App Initialization**: Host app starts and exposes dependencies
2. **Module Discovery**: Backend provides list of available frontend modules
3. **Bundle Fetching**: Frontend requests module bundles from GraphQL API
4. **Dynamic Loading**: Modules are loaded as JavaScript blobs and executed
5. **Component Registration**: Modules register their components with the host
6. **Runtime Usage**: Host application can render module components

#### Development Workflow

**1. Development Setup:**
```bash
cd apps/my-analysis-module/frontend
npm install
npm run dev  # Watch mode for development
```

**2. Building for Production:**
```bash
npm run build  # Creates dist/bundle.js
```

**3. Testing Integration:**
- Start the full Dethernety application
- Navigate to analysis views that use your components
- Verify components load and function correctly
- Check browser console for any loading errors

## Advanced Features

### OPA/Rego Policy Development

Rego policies are used for exposure and countermeasure evaluation. Here's how to structure them:

```rego
# Component exposure detection
package my_module.components.web_server

# Detect unencrypted HTTP traffic
exposures[exposure] {
    input.protocol == "http"
    input.port != 80  # Allow HTTP on standard port for redirects
    exposure := {
        "name": "Unencrypted Web Traffic",
        "description": "Web server accepting unencrypted HTTP connections",
        "criticality": "medium",
        "type": "protocol-security",
        "category": "encryption",
        "exploited_by": ["T1040", "T1557"]
    }
}

# Detect missing security headers
exposures[exposure] {
    not input.security_headers.hsts
    exposure := {
        "name": "Missing HSTS Header",
        "description": "Web server not enforcing HTTPS with HSTS",
        "criticality": "low",
        "type": "header-security",
        "category": "web-security",
        "exploited_by": ["T1557"]
    }
}

# Recommend security controls
countermeasures[countermeasure] {
    input.protocol == "http"
    countermeasure := {
        "name": "Enable HTTPS",
        "description": "Configure TLS encryption for web traffic",
        "criticality": "high",
        "type": "protocol-upgrade",
        "category": "encryption",
        "responds_with": ["D3-TTE"]
    }
}

# Recommend security headers
countermeasures[countermeasure] {
    not input.security_headers.hsts
    countermeasure := {
        "name": "Configure HSTS",
        "description": "Add HTTP Strict Transport Security header",
        "criticality": "medium",
        "type": "header-configuration",
        "category": "web-security",
        "responds_with": ["D3-SPP"]
    }
}
```

### Module Templates and Guides

Modules can provide configuration templates and guides:

```typescript
async getModuleTemplate(): Promise<string> {
  return JSON.stringify({
    schema: {
      type: 'object',
      properties: {
        apiKey: {
          type: 'string',
          format: 'password',
          title: 'API Key',
          description: 'API key for external threat intelligence service'
        },
        region: {
          type: 'string',
          enum: ['us-east-1', 'eu-west-1', 'ap-southeast-1'],
          title: 'Service Region'
        }
      },
      required: ['apiKey']
    },
    uischema: {
      type: 'VerticalLayout',
      elements: [
        {
          type: 'Control',
          scope: '#/properties/apiKey'
        },
        {
          type: 'Control',
          scope: '#/properties/region'
        }
      ]
    }
  });
}

async getClassGuide(id: string): Promise<string> {
  // Provide context-specific guidance for configuring components
  return `
    # Configuration Guide for ${id}

    ## Security Considerations
    - Always enable HTTPS in production
    - Configure proper authentication
    - Use least privilege access controls

    ## Best Practices
    - Regular security updates
    - Monitor for suspicious activity
    - Implement proper logging
  `;
}
```

### Database Operations

The `DtNeo4jOpaModule` provides built-in database operations through `DbOps`:

```typescript
// In your module methods
async getCustomData(componentId: string) {
  // Get component attributes
  const attributes = await this.dbOps.getInstantiationAttributes(componentId, 'component-class-id');
  
  // Get specific attribute
  const securityLevel = await this.dbOps.getAttribute(componentId, 'securityLevel');
  
  // Execute custom queries
  const session = this.driver.session();
  try {
    const result = await session.run(`
      MATCH (c:Component {id: $id})-[:CONNECTS_TO]->(target)
      RETURN count(target) as connectionCount
    `, { id: componentId });
    
    return result.records[0].get('connectionCount');
  } finally {
    session.close();
  }
}
```

## Testing and Debugging

### Unit Testing

```typescript
// tests/MyModule.test.ts
import MyCustomModule from '../src/MyModule';
import { createMockDriver, createMockLogger } from '@dethernety/test-utils';

describe('MyCustomModule', () => {
  let module: MyCustomModule;
  let mockDriver: any;
  let mockLogger: any;

  beforeEach(() => {
    mockDriver = createMockDriver();
    mockLogger = createMockLogger();
    module = new MyCustomModule(mockDriver, mockLogger);
  });

  it('should return correct metadata', async () => {
    const metadata = await module.getMetadata();
    
    expect(metadata.name).toBe('my-custom-module');
    expect(metadata.version).toBe('1.0.0');
    expect(metadata.componentClasses).toBeDefined();
  });

  it('should detect exposures correctly', async () => {
    const exposures = await module.getExposures('component-id', 'class-id');
    
    expect(exposures).toBeInstanceOf(Array);
    // Add specific exposure tests
  });
});
```

### Integration Testing

```typescript
// tests/integration/ModuleIntegration.test.ts
describe('Module Integration', () => {
  let app: INestApplication;
  let moduleRegistry: ModuleRegistryService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    moduleRegistry = app.get<ModuleRegistryService>(ModuleRegistryService);
    await app.init();
  });

  it('should load custom module', async () => {
    const module = moduleRegistry.getModuleByName('my-custom-module');
    expect(module).toBeDefined();
    
    const metadata = await module.getMetadata();
    expect(metadata.name).toBe('my-custom-module');
  });

  afterAll(async () => {
    await app.close();
  });
});
```

### Debugging Tips

1. **Enable Debug Logging**:
   ```typescript
   constructor(driver: any, logger: Logger) {
     super('my-module', driver, logger);
     logger.setLogLevels(['debug', 'log', 'error', 'warn']);
   }
   ```

2. **Test OPA Policies**:
   ```bash
   # Test Rego policies independently
   opa eval -d policy.rego "data.my_module.exposures" -i input.json
   ```

3. **Module Health Monitoring**:
   ```typescript
   // Check module health via API
   GET /api/modules/health
   ```

## Best Practices

### Security
- **Always validate input data** before processing
- **Use parameterized queries** for database operations
- **Implement proper error handling** to avoid information leakage
- **Follow least privilege principles** in database access
- **Log security-relevant events** for audit trails

### Performance
- **Cache expensive operations** when possible
- **Use async/await** for I/O operations
- **Limit database query complexity** to avoid performance issues
- **Implement timeouts** for external service calls
- **Monitor resource usage** and implement limits

### Maintainability
- **Follow TypeScript best practices** with strict type checking
- **Write comprehensive tests** for all module functionality
- **Document configuration options** and usage examples
- **Use semantic versioning** for module releases
- **Provide clear error messages** and debugging information

### Module Design
- **Keep modules focused** on specific domains or capabilities
- **Design for extensibility** with clear interfaces
- **Minimize dependencies** to reduce coupling
- **Support graceful degradation** when external services are unavailable
- **Implement proper logging** using the provided Logger instance

### Deployment
- **Build modules before deployment**: `pnpm build`
- **Test in staging environment** before production
- **Monitor module health** after deployment
- **Have rollback procedures** for problematic updates
- **Follow the deployment checklist** in production documentation

---

This guide provides a comprehensive foundation for developing Dethernety modules. For specific implementation details, refer to the existing modules in the `modules/` directory as working examples (e.g., `modules/dethernety-module`, `modules/dethermine-attack-scenario-analysis`).

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [OVERVIEW.md](./OVERVIEW.md) | Module system architecture overview |
| [DT_MODULE_INTERFACE.md](./DT_MODULE_INTERFACE.md) | Core DTModule contract and all metadata interfaces |
| [BASE_CLASSES.md](./BASE_CLASSES.md) | Base class implementations (OPA, JSON Logic, LangGraph) |
| [UTILITY_CLASSES.md](./UTILITY_CLASSES.md) | Helper classes (DbOps, OpaOps, LangGraph ops) |
| [MODULE_PACKAGE_DESIGN.md](./MODULE_PACKAGE_DESIGN.md) | Cloud deployment and packaging system |