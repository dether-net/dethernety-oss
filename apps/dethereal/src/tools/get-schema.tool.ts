/**
 * Get Schema Tool
 *
 * Returns JSON schema for Dethernety threat model files along with
 * comprehensive guidelines for creating well-formed threat models.
 */

import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { ClientFreeTool, ToolContext, ToolResult } from './base-tool.js'

// Define Zod schemas matching dt-core types
// dt-core exports types, so we define validation schemas here

// Common schemas
const ClassReferenceSchema = z.object({
  id: z.string(),
  name: z.string().optional()
}).describe('Reference to a class definition from a module')

const ModuleReferenceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional()
}).describe('Reference to a module')

const ElementReferenceSchema = z.object({
  id: z.string()
}).describe('Reference to another element by ID')

const ControlReferenceSchema = z.object({
  id: z.string(),
  name: z.string().optional()
}).describe('Reference to a security control')

const ModelReferenceSchema = z.object({
  id: z.string(),
  name: z.string().optional()
}).describe('Reference to another model (for composite elements)')

const AttributesSchema = z.record(z.any()).describe('Arbitrary key-value attributes defined by the element class')

// Manifest schema (manifest.json)
const ManifestSchema = z.object({
  schemaVersion: z.literal('2.0.0').describe('Schema version'),
  format: z.literal('split').describe('File format (always "split" for directory structure)'),
  model: z.object({
    id: z.string().nullable().describe('Model ID (null for new imports, assigned by server)'),
    name: z.string().describe('Model name'),
    description: z.string().optional().describe('Model description'),
    defaultBoundaryId: z.string().describe('ID of the root boundary')
  }).describe('Model metadata'),
  files: z.object({
    structure: z.literal('structure.json'),
    dataFlows: z.literal('dataflows.json'),
    dataItems: z.literal('data-items.json'),
    attributes: z.literal('attributes')
  }).optional().describe('File references'),
  modules: z.array(ModuleReferenceSchema).describe('Modules used by this model'),
  exportedAt: z.string().optional().describe('ISO timestamp of export')
}).describe('Model manifest - the entry point for a split-file model')

// Structure schemas (structure.json)
const StructureComponentSchema: z.ZodType<any> = z.object({
  id: z.string().describe('Component ID (reference ID for new models)'),
  name: z.string().describe('Component name'),
  description: z.string().optional(),
  type: z.enum(['PROCESS', 'EXTERNAL_ENTITY', 'STORE']).describe('Component type'),
  positionX: z.number().describe('X position relative to parent boundary'),
  positionY: z.number().describe('Y position relative to parent boundary'),
  parentBoundary: ElementReferenceSchema.optional().describe('Reference to parent boundary'),
  classData: ClassReferenceSchema.optional().describe('Reference to component class'),
  controls: z.array(ControlReferenceSchema).optional().describe('Security controls applied'),
  dataItemIds: z.array(z.string()).optional().describe('IDs of data items stored/processed'),
  representedModel: ModelReferenceSchema.optional().describe('For composite components')
}).describe('Component within a boundary')

const StructureBoundarySchema: z.ZodType<any> = z.lazy(() => z.object({
  id: z.string().describe('Boundary ID (reference ID for new models)'),
  name: z.string().describe('Boundary name'),
  description: z.string().optional(),
  positionX: z.number().optional().describe('X position relative to parent'),
  positionY: z.number().optional().describe('Y position relative to parent'),
  dimensionsWidth: z.number().optional().describe('Boundary width in pixels'),
  dimensionsHeight: z.number().optional().describe('Boundary height in pixels'),
  dimensionsMinWidth: z.number().optional().describe('Minimum width constraint'),
  dimensionsMinHeight: z.number().optional().describe('Minimum height constraint'),
  parentBoundary: ElementReferenceSchema.optional().describe('Reference to parent boundary'),
  classData: ClassReferenceSchema.optional().describe('Reference to boundary class'),
  controls: z.array(ControlReferenceSchema).optional().describe('Security controls applied'),
  dataItemIds: z.array(z.string()).optional().describe('IDs of data items in scope'),
  representedModel: ModelReferenceSchema.optional().describe('For composite boundaries'),
  boundaries: z.array(z.lazy(() => StructureBoundarySchema)).optional().describe('Nested boundaries'),
  components: z.array(StructureComponentSchema).optional().describe('Components within this boundary')
})).describe('Trust boundary containing components and nested boundaries')

const StructureFileSchema = z.object({
  defaultBoundary: StructureBoundarySchema.describe('The root boundary containing all model elements')
}).describe('Model structure file - hierarchy without inline attributes')

// Dataflows schema (dataflows.json)
const DataFlowSchema = z.object({
  id: z.string().describe('Data flow ID'),
  name: z.string().describe('Data flow name/label'),
  description: z.string().optional(),
  source: ElementReferenceSchema.describe('Source component/boundary ID'),
  target: ElementReferenceSchema.describe('Target component/boundary ID'),
  sourceHandle: z.enum(['top', 'right', 'bottom', 'left']).optional().describe('Connection point on source'),
  targetHandle: z.enum(['top', 'right', 'bottom', 'left']).optional().describe('Connection point on target'),
  classData: ClassReferenceSchema.optional().describe('Reference to data flow class'),
  controls: z.array(ControlReferenceSchema).optional().describe('Security controls on this flow'),
  dataItemIds: z.array(z.string()).optional().describe('IDs of data items carried by this flow')
}).describe('Data flow connection between components')

const DataFlowsFileSchema = z.array(DataFlowSchema).describe('Array of all data flows in the model')

// Data items schema (data-items.json)
const DataItemSchema = z.object({
  id: z.string().describe('Data item ID'),
  name: z.string().describe('Data item name'),
  description: z.string().optional(),
  classData: ClassReferenceSchema.optional().describe('Reference to data classification class')
}).describe('Data item representing a type of data in the system')

const DataItemsFileSchema = z.array(DataItemSchema).describe('Array of all data items in the model')

// Per-element attributes schema (attributes/{type}/{id}.json)
const ElementAttributesSchema = z.object({
  elementId: z.string().describe('ID of the element'),
  elementType: z.enum(['boundary', 'component', 'dataFlow', 'dataItem']).describe('Type of element'),
  elementName: z.string().optional().describe('Element name for reference'),
  classData: ClassReferenceSchema.describe('Class that defines these attributes'),
  attributes: AttributesSchema.describe('Attribute values as key-value pairs')
}).describe('Attributes for a single element')

// Consolidated attributes schema (for reference)
const ConsolidatedAttributesFileSchema = z.object({
  boundaries: z.record(ElementAttributesSchema).optional(),
  components: z.record(ElementAttributesSchema).optional(),
  dataFlows: z.record(ElementAttributesSchema).optional(),
  dataItems: z.record(ElementAttributesSchema).optional()
}).describe('Consolidated attributes organized by element type')

// Schema registry
const schemaRegistry = {
  manifest: ManifestSchema,
  structure: StructureFileSchema,
  dataflows: DataFlowsFileSchema,
  'data-items': DataItemsFileSchema,
  'element-attributes': ElementAttributesSchema,
  'consolidated-attributes': ConsolidatedAttributesFileSchema
}

const InputSchema = z.object({
  include_examples: z.boolean().optional().describe('Include example values in the schema (default: true)')
})

type GetSchemaInput = z.infer<typeof InputSchema>

interface SchemaOutput {
  guidelines: string
  directory_structure: string
  schemas: Record<string, any>
}

export class GetSchemaTool extends ClientFreeTool<GetSchemaInput, SchemaOutput> {
  readonly name = 'get_model_schema'
  readonly description = 'Get the JSON schema for Dethernety threat models. Dethernety is an AI-integrated cybersecurity threat modeling framework that uses graph-based representations with MITRE ATT&CK integration.'
  readonly inputSchema = InputSchema

  async execute(_input: GetSchemaInput, _context: ToolContext): Promise<ToolResult<SchemaOutput>> {
    try {
      return {
        success: true,
        data: {
          guidelines: this.getGuidelines(),
          directory_structure: this.getDirectoryStructure(),
          schemas: {
            manifest: this.convertToJsonSchema(schemaRegistry.manifest),
            structure: this.convertToJsonSchema(schemaRegistry.structure),
            dataflows: this.convertToJsonSchema(schemaRegistry.dataflows),
            'data-items': this.convertToJsonSchema(schemaRegistry['data-items']),
            'element-attributes': this.convertToJsonSchema(schemaRegistry['element-attributes']),
            'consolidated-attributes': this.convertToJsonSchema(schemaRegistry['consolidated-attributes'])
          }
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get schema'
      }
    }
  }

  private convertToJsonSchema(zodSchema: z.ZodType): any {
    return zodToJsonSchema(zodSchema, {
      $refStrategy: 'none',
      target: 'jsonSchema7'
    })
  }

  private getGuidelines(): string {
    return `
## Dethernety Threat Model Guidelines

### Coordinate System

- All position coordinates (positionX, positionY) are **relative to the parent boundary**
- Origin (0,0) is at the **top-left** of the parent boundary
- Components have a fixed visual size of **150×150 pixels**
- Position boundaries to avoid overlapping child elements
- Leave padding around boundaries for visual clarity

### Component Types

| Type | Description | Handles |
|------|-------------|---------|
| PROCESS | Internal system processes | top, right, bottom, left |
| EXTERNAL_ENTITY | External actors or systems | top, right, bottom, left |
| STORE | Data storage (databases, files) | **left, right only** |

### Data Flow Handle Selection

Choose sourceHandle and targetHandle based on the **relative positions** of components:

| Target Position | Source Handle | Target Handle |
|-----------------|---------------|---------------|
| To the right | right | left |
| Below | bottom | top |
| To the left | left | right |
| Above | top | bottom |

**Important for STORE components:** They only have left/right handles. Use horizontal connections only.

### Avoiding Handle Conflicts

- Do NOT create flows between the same two components using the same handle pair
- When bidirectional communication exists, use **different handle pairs** for each direction

❌ **BAD** (overlapping lines):
- Flow 1: A[right] → B[left]
- Flow 2: B[left] → A[right]

✅ **GOOD** (clear separation):
- Flow 1: A[right] → B[left]
- Flow 2: B[bottom] → A[top]

### ID Handling

- When creating new models, use **temporary reference IDs** (e.g., UUIDs you generate)
- These IDs are used to link elements together (e.g., dataflow source/target)
- After import, the server assigns **permanent IDs** which are written back to your files
- The original IDs become obsolete after import

### Best Practices

1. **Group related components** within the same boundary
2. **Size boundaries** to contain all child elements with padding (min 50px)
3. **Flow direction** typically left-to-right or top-to-bottom for readability
4. **Name data flows** descriptively (e.g., "User credentials", "API response")
5. **Assign classes** to elements to enable security analysis
6. **Use data items** to classify sensitive data types

### Boundary Hierarchy (IMPORTANT)

**DO NOT flatten the model** by placing all components directly under the default boundary.
Boundaries represent **trust zones** and should reflect the actual architecture:

❌ **BAD** (flat structure - loses security context):
\`\`\`
defaultBoundary/
├── User (EXTERNAL_ENTITY)
├── Web Server (PROCESS)
├── API Server (PROCESS)
├── Database (STORE)
└── Cache (STORE)
\`\`\`

✅ **GOOD** (hierarchical - represents trust boundaries):
\`\`\`
defaultBoundary/
├── Internet Zone/
│   └── User (EXTERNAL_ENTITY)
├── DMZ/
│   └── Web Server (PROCESS)
└── Internal Network/
    ├── Application Tier/
    │   └── API Server (PROCESS)
    └── Data Tier/
        ├── Database (STORE)
        └── Cache (STORE)
\`\`\`

**Why hierarchy matters:**
- Security analysis uses boundary crossings to identify threats
- Flat models cannot detect trust boundary violations
- Network zones, cloud VPCs, containers should be separate boundaries
- External entities should ALWAYS be in a separate boundary from internal systems

### Modules and Classes

- Models reference **modules** that provide class definitions
- Classes define:
  - Component types (e.g., "Web Server", "Database", "User")
  - Boundary types (e.g., "Trust Boundary", "Network Zone")
  - Data flow types (e.g., "HTTPS", "SQL Query")
  - Data types (e.g., "PII", "Credentials", "API Key")
- Classes have **attribute schemas** that define configurable properties
- Use \`get_classes\` tool to discover available classes
`.trim()
  }

  private getDirectoryStructure(): string {
    return `
## Directory Structure

model-directory/
├── manifest.json           # Model metadata, modules, file references
├── structure.json          # Boundary and component hierarchy (no attributes)
├── dataflows.json          # Array of data flow connections
├── data-items.json         # Array of data classification items
└── attributes/             # Per-element attribute files
    ├── boundaries/
    │   └── {boundary-id}.json
    ├── components/
    │   └── {component-id}.json
    ├── dataFlows/
    │   └── {dataflow-id}.json
    └── dataItems/
        └── {dataitem-id}.json

### File Purposes

| File | Required | Purpose |
|------|----------|---------|
| manifest.json | Yes | Entry point with model metadata and module references |
| structure.json | Yes | Visual hierarchy of boundaries and components |
| dataflows.json | No | Connections between elements (can be empty array) |
| data-items.json | No | Data classifications (can be empty array) |
| attributes/ | No | Class-specific attributes for elements |

### Attribute Files

Each attribute file contains:
- elementId: The element this file belongs to
- elementType: boundary, component, dataFlow, or dataItem
- classData: Reference to the class defining these attributes
- attributes: Key-value pairs matching the class schema
`.trim()
  }
}

// Export singleton instance
export const getSchemaTool = new GetSchemaTool()
