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
