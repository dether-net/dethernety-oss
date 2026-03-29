# Module Development Guide

## Table of Contents
- [Overview](#overview)
- [Project Setup](#project-setup)
- [Implementation Patterns](#implementation-patterns)
- [Module Registration](#module-registration)
- [Writing Rego Policies](#writing-rego-policies)
- [Writing JSON Logic Rules](#writing-json-logic-rules)
- [Configuration Templates](#configuration-templates)
- [Analysis Modules](#analysis-modules)
- [Schema Extensions](#schema-extensions)
- [Custom Resolvers](#custom-resolvers)
- [Testing and Debugging](#testing-and-debugging)

## Overview

A Dethernety module is a TypeScript/JavaScript package that implements the `DTModule` interface. Modules extend the platform by providing component classes, security controls, exposure detection rules, configuration templates, and analysis capabilities.

For the full interface reference, see [DT_MODULE_INTERFACE.md](./DT_MODULE_INTERFACE.md). For base class details, see [BASE_CLASSES.md](./BASE_CLASSES.md).

---

## Project Setup

### Directory Structure

Create a new module under the `modules/` directory:

```
modules/my-module/
├── src/
│   └── MyModule.ts          # Main module class (must export default)
├── data/                     # Cypher ingestion scripts (optional)
│   ├── 01-module.cypher      # Module node creation
│   └── 02-classes.cypher     # Class definitions
├── package.json
├── tsconfig.json
└── dist/                     # Compiled output
    └── my-module/
        └── MyModule.js
```

### package.json

```json
{
  "name": "my-module",
  "version": "1.0.0",
  "main": "dist/my-module/MyModule.js",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@dethernety/dt-module": "workspace:*",
    "@nestjs/common": "^11.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "commonjs",
    "target": "ES2020",
    "declaration": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Build and Deploy

After building, copy the compiled output to the backend's `custom_modules/` directory:

```bash
pnpm build
cp -r dist/my-module/ apps/dt-ws/custom_modules/my-module/
```

The `ModuleRegistryService` discovers modules in `custom_modules/` at startup. Each subdirectory must contain a file ending in `Module.js` with a default export that implements `DTModule`.

---

## Implementation Patterns

### Pattern 1: Database-Backed Module (Recommended)

Extend `DtNeo4jOpaModule` for modules that store class definitions in the graph database and use OPA/Rego for policy evaluation. This is the pattern used by the built-in `dethernety-module`.

```typescript
import { DtNeo4jOpaModule } from '@dethernety/dt-module';
import { Logger } from '@nestjs/common';

class MyModule extends DtNeo4jOpaModule {
  constructor(driver: any, logger: Logger) {
    super('my-module', driver, logger);
  }
}

export default MyModule;
```

With this pattern, `getMetadata()`, `getClassTemplate()`, `getExposures()`, and `getCountermeasures()` are all implemented by the base class. You only need to ensure the module and class data exists in the graph database (via Cypher ingestion scripts or programmatic creation).

### Pattern 2: File-Based Module

Extend `DtFileOpaModule` or `DtFileJsonModule` for modules that store class definitions on the file system.

```typescript
import { DtFileOpaModule } from '@dethernety/dt-module';

class MyModule extends DtFileOpaModule {
  constructor(driver: any) {
    super('./custom_modules', 'my-module', driver);
  }
}

export default MyModule;
```

File-based modules read class metadata from a directory structure:

```
custom_modules/my-module/
├── metadata.json
├── ComponentClasses/
│   └── WebServer/
│       ├── metadata.json
│       ├── template.json
│       └── policies.rego        # For OPA modules
│       └── exposure-rules.json  # For JSON Logic modules
└── DataFlowClasses/
    └── HTTPFlow/
        ├── metadata.json
        └── template.json
```

### Pattern 3: Direct Implementation

For full control, implement `DTModule` directly:

```typescript
import { DTModule, DTMetadata, Exposure } from '@dethernety/dt-module';
import { Logger } from '@nestjs/common';

class MyModule implements DTModule {
  constructor(
    private readonly driver: any,
    private readonly logger: Logger
  ) {}

  async getMetadata(): Promise<DTMetadata> {
    return {
      name: 'my-module',
      description: 'Custom module',
      version: '1.0.0',
      componentClasses: [
        {
          name: 'Custom Component',
          type: 'PROCESS',
          category: 'Custom'
        }
      ]
    };
  }

  async getExposures(id: string, classId: string): Promise<Exposure[]> {
    // Custom exposure evaluation logic
    return [];
  }
}

export default MyModule;
```

### Constructor Signature

The `ModuleRegistryService` instantiates modules with two arguments:

```typescript
const module = new ModuleClass(driver, logger);
```

- `driver` — Bolt/Cypher compatible driver instance (Neo4j or Memgraph)
- `logger` — NestJS `Logger` instance

All module constructors must accept these two parameters.

---

## Module Registration

### Cypher Ingestion Scripts

For database-backed modules, class definitions are stored in the graph database. The recommended approach is to use Cypher scripts that run during module installation:

**data/01-module.cypher** — Create the module node:

```cypher
MERGE (module:DTModule {name: 'my-module'})
SET module.description = 'My custom module',
    module.version = '1.0.0',
    module.author = 'My Team',
    module.icon = 'shield';
```

**data/02-classes.cypher** — Create class definitions:

```cypher
MATCH (module:DTModule {name: 'my-module'})

MERGE (module)-[:MODULE_PROVIDES_CLASS]->(cc:DTComponentClass {id: 'my-web-server'})
SET cc.name = 'Web Server',
    cc.type = 'PROCESS',
    cc.category = 'Web',
    cc.description = 'A web server component',
    cc.template = $template,
    cc.regoPolicies = $regoPolicies;
```

### Graph Database Schema

The module system uses these graph relationships:

```
(DTModule {name}) -[:MODULE_PROVIDES_CLASS]-> (DTComponentClass)
(DTModule {name}) -[:MODULE_PROVIDES_CLASS]-> (DTDataFlowClass)
(DTModule {name}) -[:MODULE_PROVIDES_CLASS]-> (DTSecurityBoundaryClass)
(DTModule {name}) -[:MODULE_PROVIDES_CLASS]-> (DTControlClass)
(DTModule {name}) -[:MODULE_PROVIDES_CLASS]-> (DTDataClass)
(DTModule {name}) -[:MODULE_PROVIDES_CLASS]-> (DTIssueClass)
(DTModule {name}) -[:MODULE_PROVIDES_CLASS]-> (AnalysisClass)
```

Each class node stores its metadata, templates, and policies as properties.

---

## Writing Rego Policies

OPA/Rego policies evaluate element attributes to determine exposures and countermeasures.

### Policy Structure

```rego
package mymodule.webserver

# Exposures: conditions that indicate security weaknesses
exposures[exposure] {
  not input.authentication_enabled
  exposure := {
    "name": "Missing Authentication",
    "description": "Authentication is not enabled on the web server",
    "criticality": "high",
    "type": "vulnerability",
    "category": "access_control",
    "exploited_by": ["T1078"]
  }
}

exposures[exposure] {
  not input.tls_enabled
  exposure := {
    "name": "Unencrypted Communication",
    "description": "TLS is not enabled",
    "criticality": "high",
    "type": "vulnerability",
    "category": "data_protection",
    "exploited_by": ["T1557"]
  }
}

# Countermeasures: conditions that indicate security controls in place
countermeasures[countermeasure] {
  input.tls_enabled
  countermeasure := {
    "name": "TLS Encryption",
    "description": "Transport layer security is enabled",
    "criticality": "medium",
    "type": "encryption",
    "category": "data_protection",
    "responds_with": ["D3-NI"]
  }
}
```

### How Policies Are Evaluated

1. When `getExposures(id, classId)` is called, the base class retrieves the element's attributes from the `IS_INSTANCE_OF` relationship
2. The Rego package name is extracted from the policy (e.g., `mymodule.webserver`)
3. The policy path is constructed: `mymodule/webserver/exposures`
4. OPA evaluates the policy with the attributes as `input`
5. Matching rules produce `Exposure[]` or `Countermeasure[]` results

### MITRE Framework Mapping

Exposures can reference MITRE ATT&CK techniques via `exploited_by`, and countermeasures can reference MITRE D3FEND techniques via `responds_with`. These are rendered in the UI when the MITRE frameworks module is installed.

---

## Writing JSON Logic Rules

For modules that use `DtFileJsonModule` or `DtNeo4jJsonModule`, rules are expressed as JSON Logic instead of Rego.

### exposure-rules.json

```json
{
  "exposures": [
    {
      "condition": {
        "!": { "var": "authentication_enabled" }
      },
      "exposureTemplate": {
        "name": "Missing Authentication",
        "description": "Authentication is not enabled",
        "type": "vulnerability",
        "category": "access_control",
        "score": 8,
        "exploitedBy": ["T1078"]
      }
    }
  ]
}
```

### countermeasure-rules.json

```json
{
  "countermeasures": [
    {
      "condition": {
        "var": "tls_enabled"
      },
      "countermeasureTemplate": {
        "name": "TLS Encryption",
        "description": "Transport layer security is enabled",
        "type": "encryption",
        "category": "data_protection",
        "score": 8,
        "respondsWith": ["D3-NI"]
      }
    }
  ]
}
```

The `condition` field uses [JSON Logic](https://jsonlogic.com/) syntax. The `score` field can also be a JSON Logic expression for dynamic scoring based on attributes.

---

## Configuration Templates

Modules provide JSON Schema templates that the frontend renders as configuration forms using JSONForms.

### Module Template

Returned by `getModuleTemplate()`. Defines module-wide settings:

```json
{
  "schema": {
    "type": "object",
    "properties": {
      "opa_compile_server_url": {
        "type": "string",
        "format": "uri",
        "title": "OPA Server URL"
      }
    }
  },
  "uischema": {
    "type": "VerticalLayout",
    "elements": [
      {
        "type": "Control",
        "scope": "#/properties/opa_compile_server_url"
      }
    ]
  }
}
```

### Class Template

Returned by `getClassTemplate(id)`. Defines per-instance configuration for a class. For database-backed modules, this is stored as the `template` property on the class node.

```json
{
  "schema": {
    "type": "object",
    "properties": {
      "authentication_enabled": {
        "type": "boolean",
        "title": "Authentication Enabled"
      },
      "tls_enabled": {
        "type": "boolean",
        "title": "TLS Enabled"
      },
      "tls_version": {
        "type": "string",
        "title": "TLS Version",
        "enum": ["1.2", "1.3"]
      }
    }
  },
  "uischema": {
    "type": "VerticalLayout",
    "elements": [
      { "type": "Control", "scope": "#/properties/authentication_enabled" },
      { "type": "Control", "scope": "#/properties/tls_enabled" },
      { "type": "Control", "scope": "#/properties/tls_version" }
    ]
  }
}
```

When users configure component instances in the UI, attribute values are stored on the `IS_INSTANCE_OF` relationship between the element and its class. These attributes are what Rego policies and JSON Logic rules evaluate.

---

## Analysis Modules

Modules can provide AI-powered analysis capabilities by extending `DtLgModule` or implementing the analysis methods of `DTModule` directly.

### Using DtLgModule

`DtLgModule` is one way to implement analysis -- it integrates with an external LangGraph server to run analysis workflows. For the engine-agnostic approach, see [Direct Analysis Implementation](#direct-analysis-implementation) below.

`DtLgModule` connects to a LangGraph server to run analysis workflows:

```typescript
import { DtLgModule, LgAnalysisConfig } from '@dethernety/dt-module';
import { Logger } from '@nestjs/common';

const analysisConfig: LgAnalysisConfig = {
  graphs: {
    'threat_analysis': {
      description: 'Threat analysis for system models',
      type: 'model_analysis',
      category: 'threat',
      input: async (scope, analysisId, driver) => {
        // Query model data and build input payload
        return { model_id: scope };
      }
    }
  }
};

class MyAnalysisModule extends DtLgModule {
  constructor(driver: any, logger: Logger) {
    super('my-analysis', driver, logger, {
      analysisConfig,
      metadata: {
        description: 'Custom threat analysis',
        version: '1.0.0',
        author: 'My Team'
      }
    });
  }
}

export default MyAnalysisModule;
```

For details on `LgAnalysisConfig`, `DtLgAnalysisOps`, and `DtLgDocumentOps`, see [BASE_CLASSES.md](./BASE_CLASSES.md) and [UTILITY_CLASSES.md](./UTILITY_CLASSES.md).

### Analysis Lifecycle

1. **Registration**: At startup, `getMetadata()` returns `analysisClasses`. For `DtLgModule`, these are derived from LangGraph assistants.
2. **Creation**: Users create an `Analysis` object scoped to a model element via the GraphQL API
3. **Execution**: `runAnalysis()` starts the analysis workflow, streaming results via `pubSub`. `DtLgModule` delegates this to the LangGraph server.
4. **Interaction**: Users can chat via `startChat()` or resume interrupted analyses via `resumeAnalysis()`
5. **Results**: Streamed to clients via GraphQL subscriptions (`streamResponse`)

For direct implementations, the same lifecycle applies but the module handles execution and storage itself.

### Direct Analysis Implementation

You can implement the analysis methods directly on `DTModule` for full control over execution and storage:

```typescript
import { DTModule, DTMetadata, ExtendedPubSubEngine } from '@dethernety/dt-module';
import { AnalysisSession, AnalysisStatus } from '@dethernety/dt-core';

class MyAnalysisModule implements DTModule {
  constructor(private driver: any, private logger: any) {}

  async getMetadata(): Promise<DTMetadata> {
    return {
      name: 'my-analysis',
      version: '1.0.0',
      analysisClasses: [{
        name: 'Custom Analysis',
        type: 'security',
        category: 'threat'
      }]
    };
  }

  async runAnalysis(
    id: string,
    analysisClassId: string,
    scope: string,
    pubSub: ExtendedPubSubEngine,
    additionalParams?: object
  ): Promise<AnalysisSession> {
    // Implement analysis logic
    // Stream results via pubSub.publish('streamResponse', ...)
    return { sessionId: id };
  }

  async getAnalysisStatus(id: string): Promise<AnalysisStatus> {
    return {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'idle',
      interrupts: null,
      messages: [],
      metadata: {}
    };
  }
}

export default MyAnalysisModule;
```

---

## Schema Extensions

Modules can extend the platform's GraphQL schema by providing a `schema.graphql` file. At startup, `ModuleRegistryService` calls `getSchemaExtension()` on each module, and `SchemaService` merges all valid fragments into the base schema.

### Creating a Schema Extension

Place a `schema.graphql` file in your module's root directory (next to `manifest.json`):

```
modules/my-module/
├── src/
│   └── MyModule.ts
├── schema.graphql          # GraphQL schema extension
├── manifest.json
└── package.json
```

The packaging script copies `schema.graphql` into the compiled output directory alongside the `.Module.js` file.

### Writing schema.graphql

Define new types using standard GraphQL SDL:

```graphql
type ThreatIntel {
  id: ID!
  name: String!
  severity: String
  source: String
  discoveredAt: DateTime
}

type ComplianceMapping {
  id: ID!
  framework: String!
  controlId: String!
  description: String
}
```

**Rules:**
- Define new types only. You **must not** redefine existing platform types (see `apps/dt-ws/schema/schema.graphql` for the base schema).
- Each fragment is validated with `graphql.parse()` at startup. Invalid fragments are skipped with a warning logged to the console.

### How It Works

1. `DtLgModule` provides a default `getSchemaExtension()` that reads `schema.graphql` from the compiled module directory using the `readSchemaExtension(__dirname)` utility.
2. For other base classes or direct implementations, implement `getSchemaExtension()` on your module class:

```typescript
import { readSchemaExtension } from '@dethernety/dt-module';

class MyModule implements DTModule {
  getSchemaExtension(): string | undefined {
    return readSchemaExtension(__dirname);
  }

  // ... other methods
}
```

3. `ModuleRegistryService` stores the returned SDL string in `ModuleEntry.schemaFragment`.
4. `SchemaService` merges the base schema with all module fragments and passes the combined schema to `Neo4jGraphQL`.

### Verifying Schema Extensions

After the backend starts, you can introspect the schema to confirm your types are available:

```graphql
{
  __type(name: "ThreatIntel") {
    name
    fields {
      name
      type { name }
    }
  }
}
```

If the type does not appear, check the backend logs for schema validation warnings.

---

## Custom Resolvers

Schema extensions (above) add new types to the GraphQL schema, and Neo4j GraphQL auto-generates Cypher-backed resolvers for them. But some operations cannot be expressed as Cypher queries — external API calls, procedural logic, policy evaluation, etc. Custom resolvers let modules provide the resolver functions to back those fields.

### Prerequisites

Your module must implement `getSchemaExtension()` (see above). Custom resolvers are only collected for modules that have a non-empty schema fragment.

### Implementing getResolvers()

Add `getResolvers()` to your module class. It receives a `ModuleResolverContext` at startup and returns a `ResolverMap`:

```typescript
import {
  DtNeo4jOpaModule,
  ModuleResolverContext,
  ResolverMap,
} from '@dethernety/dt-module';
import { Logger } from '@nestjs/common';

class MyModule extends DtNeo4jOpaModule {
  constructor(driver: any, logger: Logger) {
    super('my-module', driver, logger);
  }

  async getResolvers(context: ModuleResolverContext): Promise<ResolverMap> {
    const { driver, logger, databaseName } = context;

    return {
      Query: {
        myCustomQuery: async (_parent, args, gqlContext, _info) => {
          // Call an external API, run procedural logic, etc.
          const response = await fetch('https://api.example.com/data');
          return response.json();
        },
      },
      Mutation: {
        myCustomMutation: async (_parent, args, gqlContext, _info) => {
          // Use the driver for database operations
          const session = driver.session({ database: databaseName });
          try {
            const result = await session.executeWrite(async (tx) => {
              return tx.run('CREATE (n:MyNode {name: $name}) RETURN n', {
                name: args.name,
              });
            });
            return true;
          } finally {
            await session.close();
          }
        },
      },
    };
  }
}

export default MyModule;
```

### Matching schema.graphql

The resolver map must match the fields declared in your `schema.graphql`. Resolvers for undeclared fields are rejected at startup.

**schema.graphql:**

```graphql
type MyQueryResult {
  data: JSON
}

extend type Query {
  myCustomQuery: MyQueryResult @authentication
}

extend type Mutation {
  myCustomMutation(name: String!): Boolean @authentication
}
```

### SDL Rules

Your `schema.graphql` must follow these rules when providing custom resolvers:

| Rule | Correct | Incorrect |
|------|---------|-----------|
| Use `extend type` for root types | `extend type Query { ... }` | `type Query { ... }` |
| Add `@authentication` to fields | `myField: String @authentication` | `myField: String` |
| Do not redefine platform directives | _(don't include directive definitions)_ | `directive @authentication on FIELD_DEFINITION` |
| Do not define `schema` blocks | _(omit entirely)_ | `schema { query: MyQuery }` |
| No Subscription resolvers | _(Query and Mutation only)_ | `extend type Subscription { ... }` |

**Why `@authentication`?** The platform enforces auth on module resolvers as defense-in-depth (even without the directive), but adding `@authentication` is the correct practice. It ensures the field is protected at the Neo4j GraphQL schema level, not just by the resolver wrapper.

### How the Platform Processes Resolvers

1. `ModuleRegistryService` calls `getSchemaExtension()` → stores SDL fragment
2. `ModuleRegistryService` calls `getResolvers(context)` → validates and stores resolver map
3. **SDL safety validation**: rejects directive redefinitions, bare root types, schema definitions
4. **Schema coverage check**: each resolver must map to a field declared in the SDL
5. **Wrapping**: each resolver is wrapped with auth enforcement, 30s timeout, logging, error sanitization
6. **Merging**: module resolvers are merged after hardcoded platform resolvers (platform wins on conflict)
7. **Ordering**: if two modules resolve the same field, the alphabetically-first module wins

### Resolver Function Signature

```typescript
async (parent: any, args: any, context: GraphQLContext, info: any) => any
```

- `parent` — the parent object (for nested resolvers)
- `args` — the GraphQL arguments passed by the client
- `context` — the per-request GraphQL context containing `token`, `jwt`, `driver`, `sessionConfig`
- `info` — the GraphQL resolve info (field name, return type, etc.)

The `context` here is the per-request context, not the `ModuleResolverContext` from `getResolvers()`. Use `ModuleResolverContext` to capture shared resources at startup; use the per-request `context` for auth-scoped operations.

### Verifying Custom Resolvers

After starting the backend, check the logs for resolver registration:

```
[Module:my-module] Module provided custom resolvers { types: ['Query', 'Mutation'], fieldCount: 2 }
```

Then query the field via GraphQL (with a valid JWT):

```graphql
query {
  myCustomQuery {
    data
  }
}
```

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Resolver not registered | Field not declared in `schema.graphql` | Ensure resolver keys match SDL field names exactly |
| `UNAUTHENTICATED` error | Missing JWT in request | Add Authorization header with valid Bearer token |
| `MODULE_RESOLVER_TIMEOUT` | Resolver takes > 30 seconds | Optimize the operation or return partial results |
| Resolver silently skipped | SDL has bare `type Query` instead of `extend type Query` | Change to `extend type Query { ... }` |
| All resolvers rejected | SDL redefines a protected directive | Remove directive definitions from `schema.graphql` |

For the full architecture and security model, see [MODULE_CUSTOM_RESOLVERS.md](../backend/LLD/MODULE_CUSTOM_RESOLVERS.md).

---

## Testing and Debugging

### Local Development

1. Build your module: `pnpm build`
2. Copy to `custom_modules/`: `cp -r dist/my-module/ apps/dt-ws/custom_modules/my-module/`
3. Start the backend: `cd apps/dt-ws && pnpm dev`
4. Check the backend logs for module loading messages

### Verifying Module Registration

After the backend starts, check that your module was loaded:

```graphql
query {
  modules {
    name
    description
    version
  }
}
```

### Verifying Class Registration

Check that your classes appear in the class listings:

```graphql
query {
  componentClasses {
    id
    name
    type
    category
  }
}
```

### Debugging OPA Policies

- Check that the OPA server is running and accessible
- Verify policies are installed: `GET http://localhost:8181/v1/policies`
- Test policy evaluation directly: `POST http://localhost:8181/v1/data/{package_path}`
- Check backend logs for OPA-related errors during `getExposures()` / `getCountermeasures()`

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Module not loaded | Missing or incorrect default export | Ensure the main file has `export default MyModule` |
| Module not loaded | File doesn't end with `Module.js` | Rename your compiled output file |
| Classes not appearing | Missing `MODULE_PROVIDES_CLASS` relationships | Check Cypher ingestion scripts |
| Empty exposures | Rego policy package name mismatch | Verify the package name in your policy matches the expected path |
| Template not rendering | Invalid JSON Schema | Validate your template JSON against the JSON Schema spec |
| Analysis not running (DtLgModule) | LangGraph server unreachable | Check `LANGGRAPH_API_URL` environment variable |

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [README.md](./README.md) | Module system architecture overview |
| [DT_MODULE_INTERFACE.md](./DT_MODULE_INTERFACE.md) | Core DTModule contract and all metadata interfaces |
| [BASE_CLASSES.md](./BASE_CLASSES.md) | Base class implementations (OPA, JSON Logic, LangGraph) |
| [UTILITY_CLASSES.md](./UTILITY_CLASSES.md) | Helper classes (DbOps, OpaOps, LangGraph ops) |
| [MODULE_PACKAGE_DESIGN.md](./MODULE_PACKAGE_DESIGN.md) | Module packaging and deployment system |
| [MODULE_CUSTOM_RESOLVERS.md](../backend/LLD/MODULE_CUSTOM_RESOLVERS.md) | Custom resolver architecture (LLD) |
