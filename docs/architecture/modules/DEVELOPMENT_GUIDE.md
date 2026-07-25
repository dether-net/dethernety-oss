# Module Development Guide

## Table of Contents
- [Overview](#overview)
- [Project Setup](#project-setup)
- [Implementation Patterns](#implementation-patterns)
- [Module Registration](#module-registration)
- [Writing Rego Policies](#writing-rego-policies)
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

### Pattern 1: File-Based Module (Recommended)

Extend `DtFileOpaModule` for modules that load class definitions from the file system and use Rego for policy evaluation. Policies evaluate in-process via the vendored Regorus WASM engine — there is no policy server to run. This is the default policy-evaluating base class and the pattern used by the built-in `dethernety-general`.

```typescript
import { DtFileOpaModule } from '@dethernety/dt-module';

class MyModule extends DtFileOpaModule {
  constructor(driver: any) {
    super('./custom_modules', 'my-module', driver);
  }
}

export default MyModule;
```

With this pattern, `getMetadata()`, `getClassTemplate()`, `getExposures()`, and `getCountermeasures()` are all implemented by the base class. You only need to provide the class definitions on disk.

File-based modules read class metadata from a directory structure:

```
custom_modules/my-module/data/my-module/
├── module.json
├── component/
│   └── web-server/
│       ├── class.json
│       ├── schema.json
│       └── policies.rego        # Rego policies
└── dataFlow/
    └── http-flow/
        ├── class.json
        └── schema.json
```

### Pattern 2: Direct Implementation

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
    cc.template = $template;
```

Rego policies are never stored on graph nodes: they ship as `policies.rego` files in
the module's class directories and are evaluated in-process from disk.


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

Rego policies evaluate element attributes to determine exposures and countermeasures. They are evaluated in-process by the vendored Regorus WASM engine.

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
    "attack_vector": "NETWORK",
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
    "attack_vector": "NETWORK",
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
2. The class's Rego policy (registered at module load into its own in-process Regorus engine) is looked up
3. The `exposures` (or `countermeasures`) rule is evaluated with the attributes as `input`
4. Matching rules produce `Exposure[]` or `Countermeasure[]` results. Evaluation is fail-loud — an engine error throws rather than yielding an empty result

### MITRE Framework Mapping

Exposures can reference MITRE ATT&CK techniques via `exploited_by`, and countermeasures can reference MITRE D3FEND techniques via `responds_with`. These are rendered in the UI when the MITRE frameworks module is installed.

Exposures can also include an `attack_vector` field (CVSS v3.1-aligned: `"NETWORK"`, `"ADJACENT"`, `"LOCAL"`, `"PHYSICAL"`). When omitted, the platform defaults to `"UNSPECIFIED"`. This field enables boundary-aware analysis and attack path constraints.

---

## Configuration Templates

Modules provide JSON Schema templates that the frontend renders as configuration forms using JSONForms.

### Module Template

Optionally returned by `getModuleTemplate()` to define module-wide settings. `DtFileOpaModule` does **not** implement it — in-process Rego evaluation needs no configuration, so the platform's template resolver returns its documented fallback for these modules. Implement it only if your module has genuine module-wide settings to expose:

```json
{
  "schema": {
    "type": "object",
    "properties": {
      "report_verbosity": {
        "type": "string",
        "title": "Report Verbosity",
        "enum": ["summary", "detailed"]
      }
    }
  },
  "uischema": {
    "type": "VerticalLayout",
    "elements": [
      {
        "type": "Control",
        "scope": "#/properties/report_verbosity"
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

When users configure component instances in the UI, attribute values are stored on the `IS_INSTANCE_OF` relationship between the element and its class. These attributes are what Rego policies evaluate.

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
  DtFileOpaModule,
  ModuleResolverContext,
  ResolverMap,
} from '@dethernety/dt-module';

class MyModule extends DtFileOpaModule {
  constructor(driver: any) {
    super('./custom_modules', 'my-module', driver);
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

## Pre-computed Embeddings (Optional)

Modules can ship pre-computed embedding vectors alongside their class
definitions. At install time, the platform prefers a shipped vector over
calling the embedding endpoint — allowing offline install and eliminating a
network dependency for the vast majority of classes.

**Authoritative spec:** [PRE_COMPUTED_EMBEDDINGS_SPEC.md](./PRE_COMPUTED_EMBEDDINGS_SPEC.md).

### When to use

- The deployment target has no reachable embedding endpoint (air-gapped,
  enterprise network without egress).
- The module is large (hundreds of classes) and you want install to be
  fast and deterministic.
- You want to pin the exact text-and-model used for vector generation,
  so similarity scores remain reproducible across installs.

### End-to-end author workflow

Modules can wire the CLI into their `package.json` so authors get a short
command (`pnpm embed`) that reads `EMBEDDING_MODEL` and `EMBEDDING_URL`
from the environment with sensible defaults. `modules/dethernety-general`
does this; mirror it in your own module:

```json
{
  "scripts": {
    "embed": "../../scripts/module-manager.sh embed . --model ${EMBEDDING_MODEL:-nomic-embed-text} --url ${EMBEDDING_URL:-http://localhost:11434/api/embed}"
  }
}
```

Full round-trip:

```bash
# 1. Build the module
cd modules/my-module && pnpm build

# 2. Generate vectors (writes embeddings/<slug>.json under each class dir)
pnpm embed
# or with overrides:
EMBEDDING_MODEL=text-embedding-3-small \
EMBEDDING_URL=https://api.openai.com/v1/embeddings \
EMBEDDING_API_KEY=... pnpm embed

# 3. Repackage so the embeddings/ directories end up in the tarball
pnpm build

# 4. Install (offline-capable now)
./scripts/module-manager.sh install dist/my-module-1.0.0.tar.gz
```

Calling the shell wrapper directly works too when you need ad-hoc flags:

```bash
./scripts/module-manager.sh embed modules/my-module \
  --model nomic-embed-text \
  --url http://localhost:11434/api/embed \
  --batch-size 64
```

### What `module-manager embed` does

1. Reads `manifest.json` for the module name, then walks
   `<module-path>/data/<name>/`.
2. Auto-detects the layout — V2 OPA (`component/`, `dataFlow/`,
   `securityBoundary/`, `control/`, `data/` with `class.json`) or JSON
   (`ComponentClasses/` etc. with `metadata.json`).
3. For each class, composes embedding text using the **same** shared helper
   (`classEmbeddingText`, wrapping `composeClassText` + `normalizeClassType`)
   the runtime cache uses — same formula, same type-normalization — so
   pre-computed vectors score identically to on-the-fly vectors *and* the
   content hash the writer stamps matches the one the cache recomputes.
4. POSTs chunked batches (`--batch-size`, default 128) to the configured
   endpoint. Supports OpenAI, Ollama `/api/embed`, and Ollama legacy
   `/api/embeddings` response formats; the response is validated (each entry
   a non-empty numeric array, count matches the request) and, for OpenAI,
   ordered by each item's `index` before being paired to its class.
5. Writes each vector to `{classDir}/embeddings/{modelSlug}.json` as a
   `{ "vector": [...], "contentHash": "<sha256>" }` object. The hash binds the
   vector to the class text it was computed from, so the runtime cache can
   detect (and recompute) a vector left stale by an un-regenerated text edit.
   Older bare-array files remain readable (served unverified).

### CLI flags

| Flag | Required | Description |
|------|----------|-------------|
| `--model` | yes | Embedding model name (sent in the request body). |
| `--url` | yes | Embedding endpoint URL. |
| `--api-key` | no | Bearer token for the endpoint. |
| `--batch-size` | no (default 128) | Classes per POST. Endpoints cap input list size — 128 works for Ollama and stays well under OpenAI's 2048 limit. |

The CLI deliberately does not retry on API failure and does not validate
vector dimensions against the model (the platform does that at install
time). It does validate response shape and count, and it does not delete
stale vectors — but a stale vector no longer poisons search: the content
hash lets the runtime cache detect the mismatch and recompute on the fly.
Rerun after fixing the endpoint; `rm -rf data/<name>/*/*/embeddings/` to
start clean.

### Model switching

The filename slug is derived from the model name, so
`embeddings/nomic-embed-text.json` and
`embeddings/text-embedding-3-small.json` can coexist for different model
targets. The platform loads only the file matching `EMBEDDING_MODEL` at
install time; classes without a matching file fall back to on-the-fly.

### Packager support

`oss/scripts/package-module.js` copies the entire `data/` tree
recursively, so `embeddings/` directories are included automatically in
the resulting tarball. Legacy cypher/csv modules are **not** supported
(see [Packaging](./PRE_COMPUTED_EMBEDDINGS_SPEC.md#packaging)).

### Offline install

With every class embedded, installation issues zero HTTP calls to the
embedding endpoint. Partial coverage is fully supported: classes without
a pre-computed vector are embedded on the fly during install.

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

### Debugging Rego Policies

- Policies are evaluated in-process — there is no policy server to reach or inspect.
- A malformed or non-self-contained policy fails **at module load**: check the backend logs from `getMetadata()` for `Rego policies failed to register`. Such a class then throws on every evaluation rather than answering from a stale engine.
- Check backend logs for Rego evaluation errors during `getExposures()` / `getCountermeasures()`. Evaluation is fail-loud — an engine error surfaces as a thrown error, never as silent empty findings.
- To validate a policy against the reference Rego dialect outside the platform, run it through the `opa` CLI (the same binary the package-time lint and CI parity gate use).

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
| [BASE_CLASSES.md](./BASE_CLASSES.md) | Base class implementations (Rego, LangGraph) |
| [UTILITY_CLASSES.md](./UTILITY_CLASSES.md) | Helper classes (DbOps, LangGraph ops) |
| [MODULE_PACKAGE_DESIGN.md](./MODULE_PACKAGE_DESIGN.md) | Module packaging and deployment system |
| [MODULE_CUSTOM_RESOLVERS.md](../backend/LLD/MODULE_CUSTOM_RESOLVERS.md) | Custom resolver architecture (LLD) |
