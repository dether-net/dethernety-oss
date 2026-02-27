# Analysis Framework Documentation

This document provides a comprehensive guide to the AI-powered analysis framework in the Dethernety system. The analysis framework leverages LangGraph and large language models (LLMs) to provide intelligent, context-aware security analysis of threat models.

## Overview

The Dethernety analysis framework enables AI-powered analysis of threat models through a modular architecture where AnalysisClasses provided by modules define specific analysis capabilities:

1. **Modular Analysis System**: AnalysisClasses from modules define available analysis types
2. **LangGraph Integration**: Structured analysis workflows using directed graphs
3. **Multi-Agent Collaboration**: Specialized AI agents working together
4. **Neo4j Knowledge Integration**: Incorporating graph database knowledge
5. **Human-in-the-Loop Interaction**: Interactive analysis with user input
6. **MITRE Framework Alignment**: Mapping to ATT&CK and D3FEND frameworks

## Architecture

The analysis framework consists of:

```
┌───────────────────┐      ┌───────────────────┐      ┌───────────────────┐
│                   │      │                   │      │     Modules       │
│  Frontend (dt-ui) │◄────►│  Backend (dt-ws)  │◄────►│  ┌─────────────┐  │
│                   │      │                   │      │  │ dethermine  │  │
└───────────────────┘      └─────────┬─────────┘      │  │ dt-built-in │  │
                                     │                │  │ custom-mods │  │
                                     ▼                │  └─────────────┘  │
                           ┌───────────────────┐      └─────────┬─────────┘
                           │    Neo4j DB       │                │
                           │  ┌─────────────┐  │                ▼
                           │  │ Analysis    │  │      ┌───────────────────┐
                           │  │ AnalysisClass│  │◄────►│ AnalysisClasses   │
                           │  │ Module      │  │      │  - Basic Threat   │
                           │  └─────────────┘  │      │  - MITRE Analysis │
                           └───────────────────┘      │  - RAG Analysis   │
                                                      │  - Custom Types   │
                                                      └───────────────────┘
```

### Key Components

1. **Modules**: Packages that provide AnalysisClasses and implement analysis logic
2. **AnalysisClasses**: Define the types of analyses available in the system
3. **Analysis Objects**: Instances of AnalysisClasses scoped to specific elements
4. **Module Registry**: Service that manages and routes analysis requests to appropriate modules
5. **Integration Layer**: Communication between components via GraphQL subscriptions
6. **UI Components**: Interactive analysis visualization and management

## Modular Analysis Architecture

### Analysis Flow

The analysis system follows this flow:

1. **AnalysisClass Definition**: Modules provide AnalysisClasses that define analysis capabilities
2. **Analysis Creation**: Users create Analysis objects based on AnalysisClasses, scoped to specific elements
3. **Analysis Execution**: The system routes analysis requests to the appropriate module
4. **Module Processing**: The module implements the analysis logic (often using LangGraph)
5. **Result Delivery**: Results are streamed back via GraphQL subscriptions

### Data Model Relationships

```
Module ──(HAS_CLASS)──► AnalysisClass ──(IS_INSTANCE_OF)──► Analysis ──(ANALYZED_BY)──► Element
                                                               │
                                                               ▼
                                                           Analysis Data
                                                           (Status, Values, etc.)
```

## Analysis Types

The system includes several types of analyses provided by modules:

### Basic Threat Analysis (dethermine module)

A simple analysis type for general security assessment:

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│          │     │          │     │          │
│  Assess  │────►│ Identify │────►│ Mitigate │
│          │     │  Threats │     │          │
└──────────┘     └──────────┘     └──────────┘
      │                                │
      └────────────────────────────────┘
                  feedback
```

- **Assess**: Evaluate the system model and components
- **Identify Threats**: Detect potential security issues
- **Mitigate**: Recommend security controls

### MITRE Analysis (dethermine module)

A specialized analysis type for mapping to MITRE ATT&CK techniques:

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│          │     │          │     │          │     │          │
│  Model   │────►│  Attack  │────►│ Technique│────►│  Defense │
│ Analysis │     │ Mapping  │     │ Analysis │     │ Mapping  │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
```

- **Model Analysis**: Analyze the system model
- **Attack Mapping**: Map components to potential attack vectors
- **Technique Analysis**: Identify applicable ATT&CK techniques
- **Defense Mapping**: Recommend D3FEND countermeasures

### Hierarchical RAG Analysis (dethermine module)

A context-aware analysis type using hierarchical retrieval-augmented generation:

```
┌──────────┐     ┌──────────┐     ┌───────────┐
│          │     │          │     │           │
│ Document │────►│ Chunking │────►│ Indexing  │
│ Ingestion│     │          │     │           │
└──────────┘     └──────────┘     └───────────┘
                                       │
                                       ▼
┌──────────┐     ┌──────────┐     ┌───────────┐
│          │     │          │     │           │
│ Response │◄────│ Analysis │◄────│ Retrieval │
│Generation│     │          │     │           │
└──────────┘     └──────────┘     └───────────┘
```

- **Document Ingestion**: Load relevant security documentation
- **Chunking**: Break documents into manageable pieces
- **Indexing**: Create a searchable index of chunks
- **Retrieval**: Retrieve relevant information for analysis
- **Analysis**: Process retrieved information
- **Response Generation**: Generate analysis results

## Creating and Running Analyses

The modular analysis system allows users to create and run analyses based on AnalysisClasses provided by modules:

### Analysis Lifecycle

1. **Discover AnalysisClasses**: System loads AnalysisClasses from registered modules
2. **Create Analysis**: Users create Analysis objects from AnalysisClasses, scoped to specific elements
3. **Run Analysis**: System routes requests to appropriate modules for execution
4. **Stream Results**: Analysis results are streamed back via GraphQL subscriptions
5. **Interact**: Users can interact with ongoing analyses through chat interfaces

### Frontend Interface

The dt-ui application provides a user interface for managing analyses:

1. Navigate to a model, component, or other element
2. Select "Analyses" tab to view available AnalysisClasses
3. Create an Analysis object from an AnalysisClass
4. Run the analysis
5. View results and interact with the analysis as needed

### GraphQL API

Analyses can be managed programmatically via the GraphQL API:

**Create an Analysis**:
```graphql
mutation CreateAnalysis($input: AnalysisCreateInput!) {
  createAnalysis(input: $input) {
    id
    name
    analysisClass {
      id
      name
      module {
        name
      }
    }
    element {
      id
      name
    }
  }
}
```

**Run an Analysis**:
```graphql
mutation RunAnalysis($analysisId: String!) {
  runAnalysis(analysisId: $analysisId) {
    sessionId
  }
}
```

**Start Chat with Analysis**:
```graphql
mutation StartChat($analysisId: String!, $userQuestion: String!) {
  startChat(analysisId: $analysisId, userQuestion: $userQuestion) {
    sessionId
  }
}
```

Parameters:
- `analysisId`: ID of the Analysis object to run
- `userQuestion`: Initial question to start a chat-based analysis

### WebSocket Subscriptions

Analysis results are streamed via WebSocket subscriptions:

```graphql
subscription StreamResponse($sessionId: String!) {
  streamResponse(sessionId: $sessionId) {
    content
    response_metadata {
      finish_reason
      model_name
    }
    tool_calls
    type
    name
    id
  }
}
```

## Human-in-the-Loop Interaction

The analysis framework supports interactive analysis through:

### User Interrupts

Users can interrupt an analysis to provide additional information or guidance:

```graphql
mutation ResumeAnalysis($analysisId: String!, $userInput: String!) {
  resumeAnalysis(analysisId: $analysisId, userInput: $userInput) {
    sessionId
  }
}
```

### Chat Interface

Users can chat with an analysis agent to ask questions or request clarification:

```graphql
mutation StartChat($input: ChatInput!) {
  startChat(input: $input) {
    sessionId
  }
}
```

```graphql
subscription ChatResponse($sessionId: String!) {
  chatResponse(sessionId: $sessionId) {
    content
    response_metadata {
      finish_reason
      model_name
    }
  }
}
```

## Module Integration

The analysis system integrates with the module system to provide flexible, extensible analysis capabilities:

### Module Registration

1. **Module Discovery**: The ModuleRegistryService discovers modules at startup
2. **AnalysisClass Registration**: Each module's AnalysisClasses are registered in Neo4j
3. **Runtime Resolution**: Analysis requests are routed to the appropriate module based on the AnalysisClass

### Module Interface

Modules implement the DTModule interface to provide analysis capabilities:

```typescript
interface DTModule {
  // Analysis methods
  runAnalysis?(
    id: string, 
    analysisClassId: string, 
    scope: string, 
    pubSub: ExtendedPubSubEngine
  ): Promise<AnalysisSession>;
  
  startChat?(
    id: string, 
    analysisClassId: string, 
    userQuestion: string, 
    pubSub: ExtendedPubSubEngine
  ): Promise<AnalysisSession>;
  
  resumeAnalysis?(
    id: string, 
    analysisClassId: string, 
    input: any, 
    pubSub: ExtendedPubSubEngine
  ): Promise<AnalysisSession>;
  
  getAnalysisStatus?(id: string): Promise<AnalysisStatus>;
  getAnalysisValues?(id: string, valueKey: string): Promise<object>;
  deleteAnalysis?(id: string): Promise<boolean>;
}
```

### Analysis Routing

The backend routes analysis requests through this flow:

1. **Request Reception**: GraphQL resolver receives analysis request
2. **Module Resolution**: AnalysisResolverService identifies the target module
3. **Module Invocation**: Request is forwarded to the appropriate module
4. **Result Streaming**: Module streams results via the provided PubSub interface
5. **Client Delivery**: Results are delivered to clients via GraphQL subscriptions

### Data Model Integration

Analysis data is stored alongside other model data in Neo4j:

```cypher
// Create Analysis from AnalysisClass
MATCH (ac:AnalysisClass {id: $analysisClassId})
MATCH (e:Element {id: $elementId})
CREATE (a:Analysis {
  id: randomUUID(),
  name: $name,
  description: $description
})
CREATE (a)-[:IS_INSTANCE_OF]->(ac)
CREATE (e)-[:ANALYZED_BY]->(a)
```

## Analysis Tools

The analysis framework provides specialized tools for agents to use during analysis:

### Neo4j Query Tool

Allows agents to query the Neo4j database for information:

```python
@tool
def query_neo4j(query: str, params: Dict = None) -> List[Dict]:
    """Execute a Cypher query against the Neo4j database."""
    result = graph.run(query, params)
    return [dict(record) for record in result]
```

Example usage:
```python
# Find all components in a model
query = """
MATCH (m:Model {id: $modelId})-[:CONTAINS]->(sb:SecurityBoundary)
MATCH (sb)<-[:BELONGS_TO*]-(c:Component)
RETURN c.id, c.name, c.type
"""
components = query_neo4j(query, {"modelId": model_id})
```

### MITRE Framework Tool

Provides access to MITRE ATT&CK and D3FEND data:

```python
@tool
def get_mitre_technique(technique_id: str) -> Dict:
    """Get information about a MITRE ATT&CK technique."""
    query = """
    MATCH (t:MitreAttackTechnique {attack_id: $techniqueId})
    RETURN t
    """
    result = query_neo4j(query, {"techniqueId": technique_id})
    return result[0] if result else None
```

### Exposure Analysis Tool

Analyzes components for potential security exposures:

```python
@tool
def analyze_exposures(component_id: str) -> List[Dict]:
    """Identify potential security exposures in a component."""
    query = """
    MATCH (c:Component {id: $componentId})-[:HAS_EXPOSURE]->(e:Exposure)
    RETURN e
    """
    return query_neo4j(query, {"componentId": component_id})
```

## Analysis Classes

The system defines several analysis classes:

### ThreatAnalysis

Basic threat analysis for identifying security issues:

```typescript
export class ThreatAnalysis implements AnalysisClass {
  id = 'threat-analysis';
  name = 'Threat Analysis';
  description = 'Basic threat analysis for identifying security issues';
  type = 'security';
  category = 'threat';
  
  // Analysis parameters
  parameters = {
    analysisDepth: {
      type: 'string',
      enum: ['basic', 'detailed', 'comprehensive'],
      default: 'detailed'
    }
  };
}
```

### MitreAttackAnalysis

MITRE ATT&CK-focused analysis:

```typescript
export class MitreAttackAnalysis implements AnalysisClass {
  id = 'mitre-attack-analysis';
  name = 'MITRE ATT&CK Analysis';
  description = 'Maps system components to MITRE ATT&CK techniques';
  type = 'security';
  category = 'mitre';
  
  // Analysis parameters
  parameters = {
    includeTactics: {
      type: 'array',
      items: {
        type: 'string'
      },
      default: []
    }
  };
}
```

### RagSecurityAnalysis

Retrieval-augmented generation analysis:

```typescript
export class RagSecurityAnalysis implements AnalysisClass {
  id = 'rag-security-analysis';
  name = 'RAG Security Analysis';
  description = 'Context-aware security analysis using RAG';
  type = 'security';
  category = 'advanced';
  
  // Analysis parameters
  parameters = {
    documentSources: {
      type: 'array',
      items: {
        type: 'string'
      },
      default: ['security-best-practices', 'owasp-top-10']
    }
  };
}
```

## Analysis Results

Analysis results are structured as:

```typescript
interface AnalysisResult {
  id: string;
  analysisId: string;
  modelId: string;
  timestamp: string;
  summary: string;
  findings: Finding[];
  recommendations: Recommendation[];
  mitreMappings: MitreMapping[];
}

interface Finding {
  id: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  affectedComponents: string[]; // Component IDs
}

interface Recommendation {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  relatedFindings: string[]; // Finding IDs
  implementation: string;
}

interface MitreMapping {
  findingId: string;
  techniqueId: string; // MITRE ATT&CK technique ID
  defenseTechniqueId: string; // MITRE D3FEND technique ID
}
```

## Visualization

Analysis results are visualized through various UI components:

### Findings Panel

Displays a list of findings with severity indicators.

### Component Overlay

Highlights affected components on the model diagram.

### Recommendation Explorer

Allows browsing and applying recommended controls.

### MITRE Matrix

Shows ATT&CK techniques mapped to findings.

## Creating Custom Analyses

Custom analyses can be created by:

1. **Creating an Analysis Graph**: Define a new LangGraph in the dethermine component
2. **Registering the Analysis**: Add the graph to langgraph.json
3. **Creating an Analysis Class**: Define a new AnalysisClass
4. **Adding UI Components**: Create visualization components

### Example: Creating a Custom Analysis Graph

```python
# Define a custom analysis graph
from langgraph.graph import Graph, StateGraph
from langgraph.prebuilt import ToolNode, LLMNode
from typing import Dict, Any

# Define graph state
class State(TypedDict):
    model: Dict
    findings: List[Dict]
    recommendations: List[Dict]
    messages: List[Dict]

# Create nodes
model_analyzer = LLMNode("model_analyzer")
threat_identifier = ToolNode("threat_identifier")
recommendation_generator = LLMNode("recommendation_generator")

# Create graph
graph = StateGraph(State)
graph.add_node("model_analyzer", model_analyzer)
graph.add_node("threat_identifier", threat_identifier)
graph.add_node("recommendation_generator", recommendation_generator)

# Define edges
graph.add_edge("model_analyzer", "threat_identifier")
graph.add_edge("threat_identifier", "recommendation_generator")

# Compile graph
custom_analysis_graph = graph.compile()
```

### Registering the Analysis in langgraph.json

```json
{
  "graphs": [
    {
      "name": "custom-analysis",
      "path": "custom_analysis_graph/graph.py",
      "entrypoint": "custom_analysis_graph",
      "description": "Custom security analysis"
    }
  ]
}
```

## Best Practices

### Optimizing Analysis Performance

1. **Focused Queries**: Write efficient Neo4j queries to retrieve only necessary data
2. **Caching**: Cache frequently used data to reduce database queries
3. **Batched Processing**: Process components in batches for large models

### Enhancing Analysis Quality

1. **Context Enrichment**: Provide comprehensive context to the LLM
2. **Iterative Refinement**: Use multiple passes to refine analysis results
3. **Cross-Validation**: Validate findings across different analysis techniques

### Human-in-the-Loop Considerations

1. **Clear Explanations**: Provide clear explanations for findings and recommendations
2. **Actionable Feedback**: Make it easy for users to provide feedback
3. **Contextual Help**: Offer contextual help during the analysis process

## Troubleshooting

### Common Issues

1. **Analysis Timeout**: Analysis takes too long to complete
   - Solution: Optimize Neo4j queries and reduce model complexity

2. **Inconsistent Results**: Analysis produces inconsistent results
   - Solution: Improve prompting and add more context to the LLM

3. **Error During Analysis**: Analysis fails with an error
   - Solution: Check error logs and ensure Neo4j is accessible

### Logging and Debugging

The system provides several logs for troubleshooting:

1. **langgraph_error.log**: LangGraph-specific errors
2. **dt-ws.log**: Backend service logs
3. **dethermine.log**: Analysis server logs

## Reference

### API Reference

1. **GraphQL API**:
   - Mutations: `runAnalysis`, `resumeAnalysis`, `startChat`
   - Subscriptions: `analysisResponse`, `chatResponse`

2. **LangGraph API**:
   - Graph definition: `StateGraph`, `Graph`
   - Node types: `LLMNode`, `ToolNode`, `CustomNode`

### Configuration Reference

1. **langgraph.json**:
   - `graphs`: List of available analysis graphs
   - `settings`: Global settings for the LangGraph server

2. **Analysis Parameters**:
   - Analysis-specific parameters for customizing behavior 