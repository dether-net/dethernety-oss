# DTModule Interface

## Table of Contents
- [Overview](#overview)
- [DTModule Interface](#dtmodule-interface-1)
- [DTMetadata Interface](#dtmetadata-interface)
- [Class Metadata Interfaces](#class-metadata-interfaces)
- [Exposure and Countermeasure Interfaces](#exposure-and-countermeasure-interfaces)
- [Analysis Interfaces](#analysis-interfaces)
- [Method Details](#method-details)

## Overview

The `DTModule` interface is the core contract that all Dethernety modules must implement. It defines the methods for retrieving module metadata, class templates, and security evaluation (exposures/countermeasures).

**Source File:** `packages/dt-module/src/interfaces/module-interface.ts`

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          DTModule Interface                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    Required Methods                             │    │
│  │  • getMetadata(): DTMetadata                                    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    Template Methods (Optional)                  │    │
│  │  • getModuleTemplate(): string                                  │    │
│  │  • getClassTemplate(id): string                                 │    │
│  │  • getClassGuide(id): string                                    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                  Security Evaluation (Optional)                 │    │
│  │  • getExposures(id, classId): Exposure[]                        │    │
│  │  • getCountermeasures(id, classId): Countermeasure[]            │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                   Analysis Methods (Optional)                   │    │
│  │  • runAnalysis(id, classId, scope, pubSub, params)              │    │
│  │  • startChat(id, classId, scope, question, pubSub, params)      │    │
│  │  • resumeAnalysis(id, classId, input, pubSub)                   │    │
│  │  • getAnalysisStatus(id): AnalysisStatus                        │    │
│  │  • getAnalysisValueKeys(id): string[]                           │    │
│  │  • getAnalysisValues(id, valueKey): object                      │    │
│  │  • getDocument(id, classId, scope, filter): object              │    │
│  │  • deleteAnalysis(id): boolean                                  │    │
│  │  • stopAnalysis(id): boolean                                    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                   Issue Sync Methods (Optional)                 │    │
│  │  • getSyncedIssueAttributes(issueId, attributes, lastSyncAt)    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                 Schema Extension (Optional)                     │    │
│  │  • getSchemaExtension(): string                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## DTModule Interface

```typescript
// packages/dt-module/src/interfaces/module-interface.ts

export interface ExtendedPubSubEngine extends PubSubEngine {
  asyncIterator<T>(triggers: string | string[]): AsyncIterator<T>;
}

export interface DTModule {
  // Required - Module metadata
  getMetadata(): DTMetadata | Promise<DTMetadata>;

  // Optional - Configuration templates
  getModuleTemplate?(): Promise<string>;
  getClassTemplate?(id: string): Promise<string>;
  getClassGuide?(id: string): Promise<string>;

  // Optional - Security evaluation
  getExposures?(id: string, classId: string): Promise<Exposure[]>;
  getCountermeasures?(id: string, classId: string): Promise<Countermeasure[]>;

  // Optional - Analysis methods (for modules providing analysis capabilities)
  runAnalysis?(
    id: string,
    analysisClassId: string,
    scope: string,
    pubSub: ExtendedPubSubEngine,
    additionalParams?: object
  ): Promise<AnalysisSession>;

  startChat?(
    id: string,
    analysisClassId: string,
    scope: string,
    userQuestion: string,
    pubSub: ExtendedPubSubEngine,
    additionalParams?: object
  ): Promise<AnalysisSession>;

  resumeAnalysis?(
    id: string,
    analysisClassId: string,
    input: any,
    pubSub: ExtendedPubSubEngine
  ): Promise<AnalysisSession>;

  getAnalysisStatus?(id: string): Promise<AnalysisStatus>;
  getAnalysisValueKeys?(id: string): Promise<string[]>;
  getAnalysisValues?(id: string, valueKey: string): Promise<object>;
  getDocument?(
    id: string,
    analysisClassId: string,
    scope: string,
    filter: object
  ): Promise<object>;
  deleteAnalysis?(id: string): Promise<boolean>;
  stopAnalysis?(id: string): Promise<boolean>;

  // Optional - Issue synchronization
  getSyncedIssueAttributes?(
    issueId: string,
    attributes: string,
    lastSyncAt: string
  ): Promise<string>;

  // Optional - GraphQL schema extension
  getSchemaExtension?(): string | Promise<string | undefined> | undefined;
}
```

---

## DTMetadata Interface

The `DTMetadata` interface defines the structure returned by `getMetadata()`. It contains the module identity and all class definitions.

**Source File:** `packages/dt-module/src/interfaces/module-metadata-interface.ts`

```typescript
export interface DTMetadata {
  name: string;                                    // Module identifier
  description?: string;                            // Human-readable description
  icon?: string;                                   // Icon identifier for UI
  version?: string;                                // Semantic version
  author?: string;                                 // Module author

  // Class definitions
  componentClasses?: ComponentClassMetadata[];     // System components
  dataFlowClasses?: DataFlowClassMetadata[];       // Data flow types
  securityBoundaryClasses?: SecurityBoundaryClassMetadata[];  // Trust zones
  dataClasses?: DataClassMetadata[];               // Data classifications
  controlClasses?: ControlClassMetadata[];         // Security controls
  analysisClasses?: AnalysisClassMetadata[];       // AI analysis types
  issueClasses?: IssueClassMetadata[];             // Issue tracking types
}
```

### Metadata Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Metadata Registration Flow                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Module Registry Service                                                │
│       │                                                                 │
│       │  1. Loads module                                                │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────┐                                                    │
│  │ module.getMetadata()                                                 │
│  └────────┬────────┘                                                    │
│           │                                                             │
│           │  2. Returns DTMetadata                                      │
│           ▼                                                             │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  DTMetadata                                                     │    │
│  │  {                                                              │    │
│  │    name: "dethernety-module",                                   │    │
│  │    version: "1.0.0",                                            │    │
│  │    componentClasses: [...],                                     │    │
│  │    dataFlowClasses: [...],                                      │    │
│  │    securityBoundaryClasses: [...],                              │    │
│  │    ...                                                          │    │
│  │  }                                                              │    │
│  └────────┬────────────────────────────────────────────────────────┘    │
│           │                                                             │
│           │  3. Store in graph database                                 │
│           ▼                                                             │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Graph Database                                                 │    │
│  │                                                                 │    │
│  │  (DTModule {name: "dethernety-module"})                         │    │
│  │       │                                                         │    │
│  │       ├──[:MODULE_PROVIDES_CLASS]──>(DTComponentClass)          │    │
│  │       ├──[:MODULE_PROVIDES_CLASS]──>(DTDataFlowClass)           │    │
│  │       ├──[:MODULE_PROVIDES_CLASS]──>(DTSecurityBoundaryClass)   │    │
│  │       └──[:MODULE_PROVIDES_CLASS]──>(DTControlClass)            │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Class Metadata Interfaces

All class metadata interfaces share a common structure with slight variations for specific class types.

### ComponentClassMetadata

**Source File:** `packages/dt-module/src/interfaces/component-class-metadata-interface.ts`

```typescript
export interface ComponentClassMetadata {
  id?: string;              // Unique identifier (auto-generated if not provided)
  name: string;             // Display name
  description?: string;     // Description for tooltips/documentation
  type: string;             // Component type: PROCESS, EXTERNAL_ENTITY, STORE
  category: string;         // Grouping category (e.g., "Web", "Database", "API")
  icon?: string;            // Icon identifier
  properties?: object;      // Additional metadata
}
```

**Component Types:**
- `PROCESS` - Internal system processes
- `EXTERNAL_ENTITY` - External actors or systems
- `STORE` - Data stores (databases, file systems)

### DataFlowClassMetadata

**Source File:** `packages/dt-module/src/interfaces/dataflow-class-metadata-interface.ts`

```typescript
export interface DataFlowClassMetadata {
  id?: string;
  name: string;
  description?: string;
  type: string;                    // Flow type (e.g., "HTTP", "gRPC", "TCP")
  category: string;                // Grouping category
  compatibleTypes?: string[];      // Component types this can connect
  compatibleCategories?: string[]; // Component categories this can connect
  icon?: string;
  properties?: object;
}
```

### SecurityBoundaryClassMetadata

**Source File:** `packages/dt-module/src/interfaces/securityboundary-class-metadata-interface.ts`

```typescript
export interface SecurityBoundaryClassMetadata {
  id?: string;
  name: string;
  description?: string;
  type: string;             // Boundary type: BOUNDARY, SECURITY_BOUNDARY
  category: string;         // Trust level (e.g., "Internal", "DMZ", "External")
  icon?: string;
  properties?: object;
}
```

### DataClassMetadata

**Source File:** `packages/dt-module/src/interfaces/data-class-metadata-interface.ts`

```typescript
export interface DataClassMetadata {
  id?: string;
  name: string;
  description?: string;
  type: string;             // Data type classification
  category: string;         // Sensitivity category (e.g., "PII", "Credentials")
  icon?: string;
  properties?: object;
}
```

### ControlClassMetadata

**Source File:** `packages/dt-module/src/interfaces/control-class-metadata-interface.ts`

```typescript
export interface ControlClassMetadata {
  id?: string;
  name: string;
  description?: string;
  type: string;                    // Control type (e.g., "Authentication", "Encryption")
  category: string;                // Control framework category
  compatibleTypes?: string[];      // Element types this control applies to
  compatibleCategories?: string[]; // Element categories this control applies to
  icon?: string;
  properties?: object;
}
```

### AnalysisClassMetadata

**Source File:** `packages/dt-module/src/interfaces/analysis-class-metadata-interface.ts`

```typescript
export interface AnalysisClassMetadata {
  id?: string;              // Identifies the analysis workflow (e.g., LangGraph assistant_id when using DtLgModule)
  name: string;             // Analysis name
  description?: string;     // Analysis description
  type: string;             // Analysis type (e.g., "model_analysis")
  category: string;         // Category (e.g., "attack_scenario", "threat")
  icon?: string;
  properties?: object;
}
```

### IssueClassMetadata

**Source File:** `packages/dt-module/src/interfaces/issue-class-metadata-interface.ts`

```typescript
export interface IssueClassMetadata {
  id?: string;
  name: string;
  description?: string;
  type: string;             // Issue type (e.g., "vulnerability", "finding")
  category: string;         // Issue category
  icon?: string;
  properties?: object;
}
```

---

## Exposure and Countermeasure Interfaces

### Exposure

Represents a security vulnerability or weakness detected for a model element.

**Source File:** `packages/dt-module/src/interfaces/exposure-interface.ts`

```typescript
export interface Exposure {
  id?: string;
  name: string;                  // Exposure name
  description?: string;          // Detailed description
  type: string;                  // Exposure type
  category: string;              // Exposure category
  score?: number;                // Severity score (0-10)
  reference?: string;            // External reference (e.g., CVE, CWE)
  mitigationTechniques?: string[]; // Recommended mitigations
  detectionTechniques?: string[];  // Detection methods
  tags?: string[];               // Classification tags

  // MITRE ATT&CK mapping
  exploitedBy?: {
    label: string;
    property: string;
    value: string;
  }[] | string[];
}
```

### Countermeasure

Represents a security control that addresses exposures.

**Source File:** `packages/dt-module/src/interfaces/countermeasure-interface.ts`

```typescript
export interface Countermeasure {
  id?: string;
  name: string;                   // Countermeasure name
  description?: string;           // Detailed description
  type: string;                   // Countermeasure type
  category: string;               // Countermeasure category
  score?: number;                 // Effectiveness score (0-10)
  reference?: string;             // External reference
  addressedExposures?: string[];  // Exposures this countermeasure addresses
  tags?: string[];                // Classification tags

  // MITRE D3FEND mapping
  respondsWith?: {
    label: string;
    property: string;
    value: string;
  }[] | string[];
}
```

### Exposure/Countermeasure Evaluation Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Exposure Evaluation Flow                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  User configures component attributes in UI                             │
│       │                                                                 │
│       │  1. Attributes saved to graph database                          │
│       ▼                                                                 │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │  Component Instance                                       │          │
│  │  {                                                        │          │
│  │    id: "comp-123",                                        │          │
│  │    classId: "class-456",                                  │          │
│  │    attributes: {                                          │          │
│  │      "authentication_enabled": false,                     │          │
│  │      "encryption_at_rest": false                          │          │
│  │    }                                                      │          │
│  │  }                                                        │          │
│  └─────────────────────────┬─────────────────────────────────┘          │
│                            │                                            │
│                            │  2. module.getExposures(id, classId)       │
│                            ▼                                            │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │  OPA/Rego Policy Evaluation                               │          │
│  │                                                           │          │
│  │  package dethernety.webserver                             │          │
│  │                                                           │          │
│  │  exposures[exp] {                                         │          │
│  │    not input.authentication_enabled                       │          │
│  │    exp := {                                               │          │
│  │      "name": "Missing Authentication",                    │          │
│  │      "type": "vulnerability",                             │          │
│  │      "score": 8                                           │          │
│  │    }                                                      │          │
│  │  }                                                        │          │
│  └─────────────────────────┬─────────────────────────────────┘          │
│                            │                                            │
│                            │  3. Return exposures                       │
│                            ▼                                            │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │  Exposure[]                                               │          │
│  │  [                                                        │          │
│  │    {                                                      │          │
│  │      name: "Missing Authentication",                      │          │
│  │      type: "vulnerability",                               │          │
│  │      category: "access_control",                          │          │
│  │      score: 8,                                            │          │
│  │      exploitedBy: ["T1078"]                               │          │
│  │    }                                                      │          │
│  │  ]                                                        │          │
│  └───────────────────────────────────────────────────────────┘          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Analysis Interfaces

### LgGraphConfig

Configuration for a single LangGraph analysis graph.

**Source File:** `packages/dt-module/src/interfaces/lg-analysis-config-interface.ts`

```typescript
export interface LgGraphConfig {
  description?: string;        // Human-readable description
  type?: string;               // Analysis type classification
  category?: string;           // Category for grouping

  // Document storage location
  index_document?: (
    scope: string,
    analysisId?: string
  ) => Promise<{ namespace: string[]; key: string }>;

  // Input payload builder (required)
  input: (
    scope: string,
    analysisId?: string,
    driver?: any,
    additionalParams?: any
  ) => Promise<any>;

  // Optional post-processing
  post_process?: (result: any) => Promise<any>;
}
```

### LgAnalysisConfig

Maps graph names to their configurations.

```typescript
export interface LgAnalysisConfig {
  graphs: {
    [graphName: string]: LgGraphConfig;
  };
}
```

### LgModuleMetadata

Static metadata for LangGraph modules.

```typescript
export interface LgModuleMetadata {
  description: string;
  version: string;
  author: string;
  icon?: string;
}
```

### LgModuleOptions

Constructor options for `DtLgModule`.

```typescript
export interface LgModuleOptions {
  langgraphApiUrl?: string;         // LangGraph API URL
  analysisConfig: LgAnalysisConfig; // Graph configurations
  metadata: LgModuleMetadata;       // Module metadata
  moduleTemplate?: string;          // Custom template JSON
}
```

---

## Method Details

### getMetadata()

**Required.** Returns the module's metadata including all class definitions.

```typescript
async getMetadata(): Promise<DTMetadata>
```

**Called by:** Module Registry Service at startup

**Returns:** `DTMetadata` containing module identity and all class arrays

---

### getModuleTemplate()

Returns a JSON string containing the JSON Schema and UI Schema for module configuration.

```typescript
async getModuleTemplate(): Promise<string>
```

**Returns:** JSON string with `schema` and `uischema` properties

**Example Response:**
```json
{
  "schema": {
    "type": "object",
    "properties": {
      "opa_compile_server_url": {
        "type": "string",
        "format": "uri"
      }
    }
  },
  "uischema": {
    "type": "VerticalLayout",
    "elements": [
      { "type": "Control", "scope": "#/properties/opa_compile_server_url" }
    ]
  }
}
```

---

### getClassTemplate(id)

Returns the JSON Schema template for a specific class's attributes.

```typescript
async getClassTemplate(id: string): Promise<string>
```

**Parameters:**
- `id` - The class instance ID (component, dataflow, boundary, etc.)

**Returns:** JSON string with `schema` and `uischema` for class configuration

---

### getClassGuide(id)

Returns usage guidance for configuring a specific class.

```typescript
async getClassGuide(id: string): Promise<string>
```

**Parameters:**
- `id` - The class instance ID

**Returns:** YAML or JSON string with configuration guidance

---

### getExposures(id, classId)

Evaluates and returns exposures for a model element based on its attributes.

```typescript
async getExposures(id: string, classId: string): Promise<Exposure[]>
```

**Parameters:**
- `id` - The element instance ID
- `classId` - The class ID assigned to the element

**Returns:** Array of `Exposure` objects

---

### getCountermeasures(id, classId)

Evaluates and returns countermeasures for a model element.

```typescript
async getCountermeasures(id: string, classId: string): Promise<Countermeasure[]>
```

**Parameters:**
- `id` - The element instance ID
- `classId` - The class ID assigned to the element

**Returns:** Array of `Countermeasure` objects

---

### runAnalysis(...)

Starts an analysis workflow. `DtLgModule` delegates this to a LangGraph server; direct implementations handle execution themselves.

```typescript
async runAnalysis(
  id: string,
  analysisClassId: string,
  scope: string,
  pubSub: ExtendedPubSubEngine,
  additionalParams?: object
): Promise<AnalysisSession>
```

**Parameters:**
- `id` - Analysis session ID
- `analysisClassId` - The analysis class ID
- `scope` - Analysis scope (usually model ID)
- `pubSub` - GraphQL subscription engine for streaming results
- `additionalParams` - Optional parameters to pass to the graph

**Returns:** `AnalysisSession` with `sessionId`

---

### startChat(...)

Starts an interactive chat session with an analysis module.

```typescript
async startChat(
  id: string,
  analysisClassId: string,
  scope: string,
  userQuestion: string,
  pubSub: ExtendedPubSubEngine,
  additionalParams?: object
): Promise<AnalysisSession>
```

**Parameters:**
- `id` - Chat session ID
- `analysisClassId` - The analysis class ID
- `scope` - Analysis scope
- `userQuestion` - User's question
- `pubSub` - Subscription engine
- `additionalParams` - Optional parameters

**Returns:** `AnalysisSession` with `sessionId`

---

### resumeAnalysis(...)

Resumes a paused or interrupted analysis.

```typescript
async resumeAnalysis(
  id: string,
  analysisClassId: string,
  input: any,
  pubSub: ExtendedPubSubEngine
): Promise<AnalysisSession>
```

**Parameters:**
- `id` - Analysis session ID
- `analysisClassId` - The analysis class ID
- `input` - Input to provide for resumption (e.g., human feedback)
- `pubSub` - Subscription engine

**Returns:** `AnalysisSession`

---

### getAnalysisStatus(id)

Gets the current status of an analysis session.

```typescript
async getAnalysisStatus(id: string): Promise<AnalysisStatus>
```

**Returns:** `AnalysisStatus` with `status`, `messages`, `interrupts`, `metadata`

---

### deleteAnalysis(id) / stopAnalysis(id)

Deletes or stops an analysis session.

```typescript
async deleteAnalysis(id: string): Promise<boolean>
async stopAnalysis(id: string): Promise<boolean>
```

**Returns:** `true` if successful

---

### getSchemaExtension()

Returns a GraphQL SDL string that extends the platform's base schema. The `ModuleRegistryService` calls this on each loaded module at startup and stores the result in `ModuleEntry.schemaFragment`. The `SchemaService` merges all valid fragments into the base schema before constructing the `Neo4jGraphQL` instance.

```typescript
getSchemaExtension?(): string | Promise<string | undefined> | undefined
```

**Called by:** Module Registry Service at startup

**Returns:** GraphQL SDL string, or `undefined` if the module does not extend the schema

**Rules:**
- Define new types only. Do not redefine existing platform types.
- Invalid fragments (those that fail `graphql.parse()`) are skipped at startup with a warning.

**Example Return Value:**
```graphql
type ThreatIntel {
  id: ID!
  name: String!
  severity: String
  source: String
}
```

`DtLgModule` provides a default implementation that reads `schema.graphql` from the compiled module directory using the `readSchemaExtension()` utility. See [BASE_CLASSES.md](./BASE_CLASSES.md) for details.

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [BASE_CLASSES.md](./BASE_CLASSES.md) | Implementation patterns for DTModule |
| [UTILITY_CLASSES.md](./UTILITY_CLASSES.md) | Helper classes (DbOps, OpaOps) |
| [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md) | Step-by-step development guide |
