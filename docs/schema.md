# Neo4j Schema Documentation

This document describes the Neo4j graph database schema used by the Dethernety framework. The schema is designed to represent system models, components, data flows, security boundaries, exposures, and controls, as well as their relationships to MITRE ATT&CK and D3FEND frameworks.

## Core Schema Design

The Dethernety database schema is organized around these core concepts:

1. **Models** - System representations containing components and boundaries
2. **Components** - Key entities in the system (processes, stores, etc.)
3. **Data Flows** - Information flows between components
4. **Security Boundaries** - Trust boundaries containing components
5. **Exposures** - Potential security vulnerabilities
6. **Controls** - Security countermeasures
7. **MITRE Framework Integration** - Links to ATT&CK and D3FEND

## Node Types

### Core Modeling Elements

#### Model
Represents a system model containing components, boundaries, and data flows.

**Properties:**
- `id` (ID!, unique) - Unique identifier
- `name` (String!) - Model name
- `description` (String) - Model description

**Relationships:**
- `(Model)-[:CONTAINS]->(SecurityBoundary)` - Default boundary for the model
- `(Model)-[:HAS_MODULE]->(Module)` - Modules associated with the model
- `(Model)<-[:SUPPORTS]-(Control)` - Controls supported by the model
- `(Model)-[:CONTAINS]->(Data)` - Data elements within the model
- `(Model)<-[:REPRESENTS_MODEL]-(Element)` - Elements representing the model
- `(Model)-[:HAS_ANALYSIS]->(Analysis)` - Analyses associated with the model

#### Component
Represents a key entity in the system (e.g., process, database).

**Properties:**
- `id` (ID!, unique) - Unique identifier
- `name` (String!) - Component name
- `description` (String) - Component description
- `type` (ComponentType!) - Type of component (PROCESS, EXTERNAL_ENTITY, STORE, etc.)
- `positionX` (Float) - X coordinate on canvas
- `positionY` (Float) - Y coordinate on canvas
- `dimensionsWidth` (Float) - Width on canvas
- `dimensionsHeight` (Float) - Height on canvas

**Relationships:**
- `(Component)-[:BELONGS_TO]->(SecurityBoundary)` - Security boundary containing this component
- `(Component)-[:FLOWS]->(DataFlow)` - Data flows originating from this component
- `(Component)<-[:FLOWS]-(DataFlow)` - Data flows targeting this component
- `(Component)-[:HAS_EXPOSURE]->(Exposure)` - Exposures associated with this component
- `(Component)<-[:SUPPORTS]-(Control)` - Controls supported by this component
- `(Component)-[:HANDLES]->(Data)` - Data elements handled by this component
- `(Component)-[:IS_INSTANCE_OF]->(ComponentClass)` - Component class for this component
- `(Component)-[:REPRESENTS_MODEL]->(Model)` - Model represented by this component

#### DataFlow
Represents the flow of data between two components.

**Properties:**
- `id` (ID!, unique) - Unique identifier
- `name` (String!) - Data flow name
- `description` (String) - Data flow description
- `sourceHandle` (String) - Handle for the source component
- `targetHandle` (String) - Handle for the target component
- `dataFlowTypes` ([String!]) - Types of data flow

**Relationships:**
- `(DataFlow)<-[:FLOWS]-(Component)` - Source component of the data flow
- `(DataFlow)-[:FLOWS]->(Component)` - Target component of the data flow
- `(DataFlow)-[:HAS_EXPOSURE]->(Exposure)` - Exposures associated with this data flow
- `(DataFlow)<-[:SUPPORTS]-(Control)` - Controls supported by this data flow
- `(DataFlow)-[:HANDLES]->(Data)` - Data elements handled by this data flow
- `(DataFlow)-[:IS_INSTANCE_OF]->(DataFlowClass)` - Data flow class for this data flow

#### SecurityBoundary
Represents a trust boundary within the system.

**Properties:**
- `id` (ID!, unique) - Unique identifier
- `name` (String!) - Boundary name
- `description` (String) - Boundary description
- `trustLevel` (TrustLevel!) - Trust level (UNTRUSTED, SEMI_TRUSTED, TRUSTED)
- `positionX` (Float) - X coordinate on canvas
- `positionY` (Float) - Y coordinate on canvas
- `dimensionsWidth` (Float) - Width on canvas
- `dimensionsHeight` (Float) - Height on canvas
- `dimensionsMinWidth` (Float) - Minimum width on canvas
- `dimensionsMinHeight` (Float) - Minimum height on canvas

**Relationships:**
- `(SecurityBoundary)<-[:CONTAINS]-(Model)` - Model containing this boundary
- `(SecurityBoundary)<-[:BELONGS_TO]-(Component)` - Components within this boundary
- `(SecurityBoundary)<-[:BELONGS_TO]-(SecurityBoundary)` - Child boundaries within this boundary
- `(SecurityBoundary)-[:BELONGS_TO]->(SecurityBoundary)` - Parent boundary containing this boundary
- `(SecurityBoundary)-[:HAS_EXPOSURE]->(Exposure)` - Exposures associated with this boundary
- `(SecurityBoundary)<-[:SUPPORTS]-(Control)` - Controls supporting this boundary
- `(SecurityBoundary)-[:HANDLES]->(Data)` - Data elements handled by this boundary
- `(SecurityBoundary)-[:IS_INSTANCE_OF]->(SecurityBoundaryClass)` - Security boundary class
- `(SecurityBoundary)-[:REPRESENTS_MODEL]->(Model)` - Model represented by this boundary

### Data and Classification

#### Data
Represents data elements within the system.

**Properties:**
- `id` (ID!, unique) - Unique identifier
- `name` (String!) - Data name
- `description` (String) - Data description

**Relationships:**
- `(Data)<-[:CONTAINS]-(Model)` - Model containing this data
- `(Data)-[:IS_INSTANCE_OF]->(DataClass)` - Data class for this data
- `(Data)<-[:HANDLES]-(Element)` - Elements handling this data
- `(Data)-[:HAS_EXPOSURE]->(Exposure)` - Exposures associated with this data

### Security Elements

#### Exposure
Represents a potential security vulnerability.

**Properties:**
- `id` (ID!, unique) - Unique identifier
- `name` (String!) - Exposure name
- `description` (String) - Exposure description
- `type` (String) - Exposure type
- `category` (String) - Exposure category
- `score` (Int) - Risk score
- `references` (String) - References
- `mitigationSuggestions` ([String]) - Suggested mitigations
- `detectionMethods` ([String]) - Detection methods
- `tags` ([String]) - Tags
- `techniques` ([String]) - Related techniques

**Relationships:**
- `(Exposure)<-[:HAS_EXPOSURE]-(Element)` - Element with this exposure
- `(Exposure)-[:EXPLOITED_BY]->(MitreAttackTechnique)` - MITRE ATT&CK techniques that can exploit this exposure

#### Control
Represents a security control to mitigate exposures.

**Properties:**
- `id` (ID!, unique) - Unique identifier
- `name` (String!) - Control name
- `description` (String) - Control description
- `type` (String) - Control type
- `category` (String) - Control category

**Relationships:**
- `(Control)-[:IS_INSTANCE_OF]->(ControlClass)` - Control classes for this control
- `(Control)-[:SUPPORTS]->(Element)` - Elements supported by this control
- `(Control)-[:HAS_COUNTERMEASURE]->(Countermeasure)` - Countermeasures associated with this control

#### Countermeasure
Represents a specific countermeasure implementation.

**Properties:**
- `id` (ID!, unique) - Unique identifier
- `name` (String!) - Countermeasure name
- `description` (String) - Countermeasure description
- `type` (String) - Countermeasure type
- `category` (String) - Countermeasure category
- `score` (Int) - Effectiveness score
- `references` (String) - References
- `addressedExposures` ([String]) - Addressed exposures
- `tags` ([String]) - Tags

**Relationships:**
- `(Countermeasure)-[:RESPONDS_WITH]->(MitreAttackMitigation)` - MITRE ATT&CK mitigations
- `(Countermeasure)-[:RESPONDS_WITH]->(MitreDefendTechnique)` - MITRE D3FEND techniques
- `(Countermeasure)<-[:HAS_COUNTERMEASURE]-(Control)` - Control associated with this countermeasure

### Module System

#### Module
Represents a module providing component classes.

**Properties:**
- `id` (ID!, unique) - Unique identifier
- `name` (String!) - Module name
- `version` (String!) - Module version
- `description` (String) - Module description
- `path` (String) - Module path

**Relationships:**
- `(Module)<-[:HAS_MODULE]-(Model)` - Models using this module
- `(Module)-[:HAS_CLASS]->(ComponentClass)` - Component classes provided by this module
- `(Module)-[:HAS_CLASS]->(DataFlowClass)` - Data flow classes provided by this module
- `(Module)-[:HAS_CLASS]->(SecurityBoundaryClass)` - Security boundary classes provided by this module
- `(Module)-[:HAS_CLASS]->(ControlClass)` - Control classes provided by this module
- `(Module)-[:HAS_CLASS]->(DataClass)` - Data classes provided by this module
- `(Module)-[:HAS_CLASS]->(AnalysisClass)` - Analysis classes provided by this module

#### ComponentClass
Represents a class of components.

**Properties:**
- `id` (ID!, unique) - Unique identifier
- `name` (String!) - Class name
- `description` (String) - Class description
- `type` (ComponentType!) - Component type
- `category` (String) - Component category
- `path` (String) - Class path
- `template` (String) - Template for rendering

**Relationships:**
- `(ComponentClass)<-[:HAS_CLASS]-(Module)` - Module providing this class
- `(ComponentClass)<-[:IS_INSTANCE_OF]-(Component)` - Components of this class

Similar class nodes exist for `DataFlowClass`, `SecurityBoundaryClass`, `ControlClass`, `DataClass`, and `AnalysisClass`.

### Analysis System

#### Analysis
Represents an analysis of a model.

**Properties:**
- `id` (ID!, unique) - Unique identifier
- `name` (String!) - Analysis name
- `description` (String) - Analysis description
- `type` (String) - Analysis type
- `category` (String) - Analysis category

**Relationships:**
- `(Analysis)<-[:ANALYZED_BY]-(Element)` - Element being analyzed (can be Model, Component, DataFlow, etc.)
- `(Analysis)-[:IS_INSTANCE_OF]->(AnalysisClass)` - Analysis class defining the analysis type

#### AnalysisClass
Represents a class of analyses.

**Properties:**
- `id` (ID!, unique) - Unique identifier
- `name` (String!) - Class name
- `description` (String) - Class description
- `type` (String) - Analysis type
- `category` (String) - Analysis category

**Relationships:**
- `(AnalysisClass)<-[:HAS_CLASS]-(Module)` - Module providing this analysis class
- `(AnalysisClass)<-[:IS_INSTANCE_OF]-(Analysis)` - Analyses of this class

### MITRE Framework Integration

#### MitreAttackTactic
Represents a MITRE ATT&CK tactic.

**Properties:**
- `id` (ID!, unique) - Unique identifier
- `name` (String!) - Tactic name
- `description` (String) - Tactic description
- `attack_id` (String) - ATT&CK ID
- `attack_version` (String) - ATT&CK version
- `stix_id` (String) - STIX ID
- `stix_spec_version` (String) - STIX spec version
- `stix_type` (String) - STIX type

**Relationships:**
- `(MitreAttackTactic)-[:TACTIC_INCLUDES_TECHNIQUE]->(MitreAttackTechnique)` - Techniques in this tactic

#### MitreAttackTechnique
Represents a MITRE ATT&CK technique.

**Properties:**
- `id` (ID!, unique) - Unique identifier
- `name` (String!) - Technique name
- `description` (String) - Technique description
- `attack_id` (String) - ATT&CK ID
- `attack_spec_version` (String) - ATT&CK spec version
- `attack_decreased` (Boolean) - Whether decreased in importance
- `attack_subtechnique` (Boolean) - Whether it's a subtechnique
- `attack_version` (String) - ATT&CK version
- `ref_url` (String) - Reference URL
- `stix_id` (String) - STIX ID
- `stix_spec_version` (String) - STIX spec version
- `stix_type` (String) - STIX type

**Relationships:**
- `(MitreAttackTechnique)<-[:TACTIC_INCLUDES_TECHNIQUE]-(MitreAttackTactic)` - Tactics including this technique
- `(MitreAttackTechnique)<-[:SUBTECHNIQUE_OF]-(MitreAttackTechnique)` - Subtechniques of this technique
- `(MitreAttackTechnique)-[:SUBTECHNIQUE_OF]->(MitreAttackTechnique)` - Parent technique of this subtechnique
- `(MitreAttackTechnique)<-[:EXPLOITED_BY]-(Exposure)` - Exposures that can be exploited by this technique
- `(MitreAttackTechnique)<-[:MITIGATION_DEFENDS_AGAINST_TECHNIQUE]-(MitreAttackMitigation)` - Mitigations for this technique

#### MitreAttackMitigation
Represents a MITRE ATT&CK mitigation.

**Properties:**
- `id` (ID!, unique) - Unique identifier
- `name` (String!) - Mitigation name
- `description` (String) - Mitigation description
- `attack_id` (String) - ATT&CK ID
- `attack_deprecated` (Boolean) - Whether deprecated
- `ref_url` (String) - Reference URL
- `attack_spec_version` (String) - ATT&CK spec version
- `stix_spec_version` (String) - STIX spec version
- `stix_modified` (String) - STIX modification date
- `stix_id` (String) - STIX ID
- `attack_version` (String) - ATT&CK version
- `stix_created` (String) - STIX creation date
- `stix_revoked` (Boolean) - Whether revoked
- `stix_type` (String) - STIX type

**Relationships:**
- `(MitreAttackMitigation)-[:MITIGATION_DEFENDS_AGAINST_TECHNIQUE]->(MitreAttackTechnique)` - Techniques mitigated
- `(MitreAttackMitigation)<-[:RESPONDS_WITH]-(Countermeasure)` - Countermeasures using this mitigation

#### MitreDefendTactic
Represents a MITRE D3FEND tactic.

**Properties:**
- `id` (ID!, unique) - Unique identifier
- `name` (String!) - Tactic name
- `description` (String) - Tactic description
- `attack_id` (String) - ATT&CK ID
- `uri` (String) - URI

**Relationships:**
- `(MitreDefendTactic)<-[:ENABLES]-(MitreDefendTechnique)` - Techniques enabling this tactic

#### MitreDefendTechnique
Represents a MITRE D3FEND technique.

**Properties:**
- `id` (ID!, unique) - Unique identifier
- `name` (String!) - Technique name
- `d3fendId` (String) - D3FEND ID
- `description` (String) - Technique description
- `uri` (String) - URI

**Relationships:**
- `(MitreDefendTechnique)-[:ENABLES]->(MitreDefendTactic)` - Tactics enabled by this technique
- `(MitreDefendTechnique)<-[:SUB_TECHNIQUE_OF]-(MitreDefendTechnique)` - Subtechniques of this technique
- `(MitreDefendTechnique)-[:SUB_TECHNIQUE_OF]->(MitreDefendTechnique)` - Parent technique of this subtechnique
- `(MitreDefendTechnique)<-[:RESPONDS_WITH]-(Countermeasure)` - Countermeasures using this technique

## GraphQL Queries and Mutations

The schema supports several key GraphQL operations:

### Queries

- `getExposuresForElement` - Retrieve exposures for a specific element
- `getAttributesFromClassRel` - Retrieve attributes from a class relationship
- `getNotRepreseningModels` - Retrieve models not represented by a component
- `getAnalysisRuns` - Retrieve analysis runs for an analysis
- `getAnalysisThreads` - Retrieve analysis threads for a model
- `getDocument` - Retrieve a document by namespace and key
- `getDocumentByAttribute` - Retrieve documents by namespace, key, and attribute

### Mutations

- `setInstantiationAttributes` - Set attributes for a component instantiation
- `deleteModel` - Delete a model and all associated elements
- `runAnalysis` - Run an analysis on a model
- `resumeAnalysis` - Resume a previously started analysis
- `deleteAnalysisThread` - Delete an analysis thread
- `startChat` - Start a chat session with an analysis

### Subscriptions

- `chatResponse` - Subscribe to chat responses
- `analysisResponse` - Subscribe to analysis responses

## Schema Evolution

The schema can evolve over time through:

1. **New Node Types** - Adding new node types for new concepts
2. **New Relationships** - Adding new relationships between existing nodes
3. **Property Extensions** - Adding new properties to existing node types
4. **Cypher Extensions** - Adding new Cypher queries for complex graph traversals

## Best Practices

When working with the Dethernety Neo4j schema:

1. **Use GraphQL API** - Don't interact directly with Neo4j unless necessary
2. **Preserve Relationships** - Always maintain the integrity of relationships
3. **Use Transactions** - Ensure data consistency with transactions
4. **Follow Naming Conventions** - Use consistent naming for properties and relationships
5. **Document Extensions** - Document any schema extensions or modifications 