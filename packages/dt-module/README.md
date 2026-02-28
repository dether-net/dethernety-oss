# dt-module: Core Module API for Dethernety

This package provides the core API and interfaces for creating modules for the Dethernety threat modeling framework. It serves as the foundation for developing custom modules that extend the framework's capabilities.

## Features

- **Module Definition API**: Interfaces for defining modules and component classes
- **Component Class Registry**: System for registering custom component types
- **Configuration Schema**: Tools for defining component configuration schemas
- **Exposure Detection**: Framework for implementing exposure detection rules
- **Control Definition**: Utilities for defining security controls
- **MITRE Framework Integration**: APIs for connecting to ATT&CK and D3FEND data

## Core Concepts

### Modules

A module in Dethernety is a package that provides specialized component classes, data flows, and security boundaries for specific domains or technologies. The dt-module package defines the module interface and lifecycle.

### Component Classes

Component classes define the types of components that can be created in the Dethernety system. The dt-module package provides interfaces for defining:

- Component properties
- Configuration schema
- Visualization templates
- Exposure detection logic
- Control recommendations

### Configuration Schema

The dt-module package uses JSONSchema to define the configuration options for components. This includes:

- Data types and validation rules
- UI hints for form generation
- Dependencies between configuration options
- Default values and constraints

### Exposure Detection

The package provides a framework for defining rules to detect security exposures based on:

- Component configuration
- System context
- Connected components
- Data flow patterns

### Control Integration

The package enables modules to define security controls that:

- Address specific exposures
- Link to MITRE D3FEND techniques
- Provide implementation guidance
- Support verification methods

## Usage

### File-Based Module

```typescript
import { DtFileModule } from '@dethernety/dt-module';

// Initialize with file system paths
const module = new DtFileModule('/path/to/module/data', 'module-name', neo4jDriver);

// Get module metadata
const metadata = module.getMetadata();

// Get class template
const template = await module.getClassTemplate('class-id');

// Get exposures and countermeasures
const exposures = await module.getExposures('instance-id');
const countermeasures = await module.getCountermeasures('instance-id');
```

### Neo4J-Based Module

```typescript
import { DtNeo4jModule } from '@dethernety/dt-module';

// Initialize with Neo4J driver
const module = new DtNeo4jModule('module-name', neo4jDriver);

// Get module metadata from database
const metadata = await module.getMetadata();

// Get class template from database
const template = await module.getClassTemplate('class-id');

// Get exposures and countermeasures from database
const exposures = await module.getExposures('instance-id');
const countermeasures = await module.getCountermeasures('instance-id');
```

### Neo4J Database Schema

The Neo4J-based module expects the following node structure in the database:

#### Node Types:
- `DTModule`: Represents a module
- `DTComponentClass`: Component class definitions
- `DTDataFlowClass`: Data flow class definitions
- `DTSecurityBoundaryClass`: Security boundary class definitions
- `DTControlClass`: Control class definitions
- `DTDataClass`: Data class definitions

#### Relationships:
- `(:DTModule)-[:MODULE_PROVIDES_CLASS]->(:DTComponentClass)`
- `(:DTModule)-[:MODULE_PROVIDES_CLASS]->(:DTDataFlowClass)`
- `(:DTModule)-[:MODULE_PROVIDES_CLASS]->(:DTSecurityBoundaryClass)`
- `(:DTModule)-[:MODULE_PROVIDES_CLASS]->(:DTControlClass)`
- `(:DTModule)-[:MODULE_PROVIDES_CLASS]->(:DTDataClass)`

#### Node Properties:

**DTModule:**
- `name`: Module name (used for identification)
- `description`: Module description
- `icon`: Module icon
- `version`: Module version
- `author`: Module author

**Class Nodes (all types):**
- `id`: Unique identifier for the class
- `name`: Class name
- `description`: Class description
- `type`: Class type
- `category`: Class category
- `icon`: Class icon
- `properties`: Class properties object
- `template`: JSON template for the class
- `exposureRules`: Array of exposure rules
- `countermeasureRules`: Array of countermeasure rules

## Integration with Dethernety

The dt-module package is used by both the Dethernety framework itself and by custom modules:

1. The framework uses it to load and manage modules
2. Modules use it to define their capabilities
3. The dt-ui frontend uses it to render component configurations
4. The dt-ws backend uses it to process exposure rules

## Development

To extend the dt-module package:

1. Add new interfaces for module capabilities
2. Enhance the exposure detection framework
3. Improve integration with MITRE frameworks
4. Add utilities for common module development tasks 