# AI-Assisted Module Creation

## Table of Contents
- [Overview](#overview)
- [Dethernety Studio Module](#dethernety-studio-module)
- [Component Class Graph](#component-class-graph)
- [Control Class Graph](#control-class-graph)
- [Generated Artifacts](#generated-artifacts)
- [Human-in-the-Loop](#human-in-the-loop)

---

## Overview

The Dethernety platform includes AI-powered workflows that dramatically lower the barrier to module development. Instead of manually writing class definitions, OPA/Rego policies, and JSONForms schemas, users can leverage LangGraph workflows that generate production-ready artifacts from natural language descriptions or existing components.

**Key Benefits:**
- Reduce module development time from hours to minutes
- Generate consistent, well-structured artifacts
- Automatic MITRE ATT&CK and D3FEND mappings
- Human-in-the-loop approval before persistence

**Implementation:** `modules/dethermine-dethernety-studio`

---

## Dethernety Studio Module

The `dethermine-dethernety-studio` module provides two main LangGraph workflows for AI-assisted class generation:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      DETHERNETY STUDIO WORKFLOWS                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────┐    ┌─────────────────────────────┐         │
│  │   Component Class Graph     │    │    Control Class Graph      │         │
│  │                             │    │                             │         │
│  │  INPUT:                     │    │  INPUT:                     │         │
│  │  • Existing component       │    │  • Natural language         │         │
│  │    instance from model      │    │    description              │         │
│  │                             │    │                             │         │
│  │  OUTPUT:                    │    │  OUTPUT:                    │         │
│  │  • Exposure vectors         │    │  • Control class definition │         │
│  │  • OPA/Rego policies        │    │  • Countermeasures          │         │
│  │  • JSONForms schema         │    │  • MITRE D3FEND mappings    │         │
│  │  • Configuration guide      │    │  • MITRE ATT&CK mappings    │         │
│  │                             │    │  • OPA/Rego policies        │         │
│  │                             │    │  • JSONForms schema         │         │
│  └─────────────────────────────┘    └─────────────────────────────┘         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Module Structure

```
modules/dethermine-dethernety-studio/
├── manifest.json                    # Module metadata
├── package.json                     # Node.js package configuration
├── src/                             # TypeScript module entry
└── langgraph/                       # LangGraph workflows
    ├── component_class_graph/       # Component class generation
    │   ├── component_class_graph.py # Main workflow
    │   ├── exposure_vector_subgraph.py
    │   ├── configuration_options_guide_subgraph.py
    │   ├── prompts/                 # AI prompts
    │   └── queries/                 # Cypher queries
    └── control_class_graph/         # Control class generation
        ├── control_class_graph.py   # Main workflow
        ├── countermeasure_subgraph.py
        ├── configuration_options_guide_subgraph.py
        ├── prompts/                 # AI prompts
        └── queries/                 # Cypher queries
```

---

## Component Class Graph

The Component Class Graph workflow analyzes an existing component instance and generates a complete class definition with exposure detection capabilities.

### Workflow Steps

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    COMPONENT CLASS GRAPH WORKFLOW                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐                                                        │
│  │ Get Component   │  Query graph database for component details            │
│  │ Details         │  including type, attributes, and relationships         │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │ Initial         │  AI analyzes component and identifies potential        │
│  │ Exposure        │  security exposure vectors                             │
│  │ Analysis        │                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │ Exposure Vector │  Parallel processing of each exposure vector:          │
│  │ Enrichment      │  • Generate configuration conditions                   │
│  │ (parallel)      │  • Map to MITRE ATT&CK techniques                      │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │ Generate        │  Create OPA/Rego policy templates for                  │
│  │ Exposure        │  exposure detection rules                              │
│  │ Templates       │                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │ Configuration   │  Normalize configuration options and                   │
│  │ Normalization   │  update OPA policy with correct references             │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │ Generate        │  Create JSONForms schema and UI schema                 │
│  │ Configuration   │  for component configuration                           │
│  │ Template        │                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │ Configuration   │  Generate usage guides for each                        │
│  │ Guide           │  configuration option (parallel)                       │
│  │ Generation      │                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │ Human           │  User reviews and approves generated                   │
│  │ Approval        │  artifacts before persistence                          │
│  │ (interrupt)     │                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │ Save to         │  Persist class definition to graph                     │
│  │ Database        │  database                                              │
│  └─────────────────┘                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Supported Component Types

The workflow supports generating classes for:

| Component Type | Graph Label | Description |
|----------------|-------------|-------------|
| Process | `DTComponentClass` | Applications, services, APIs |
| External Entity | `DTComponentClass` | Users, external systems |
| Store | `DTComponentClass` | Databases, file systems |
| Security Boundary | `DTSecurityBoundaryClass` | Trust zones |
| Data Flow | `DTDataFlowClass` | Data connections |
| Data | `DTDataClass` | Data classifications |

### Example Output

For a "PostgreSQL Database" component, the workflow generates:

**Exposure Vectors:**
- Unencrypted connections
- Weak authentication
- SQL injection vulnerability
- Insufficient access controls
- Missing audit logging

**OPA/Rego Policy:**
```rego
package _dt_built_in.exposures.postgresql_database

_unencrypted_connections_def := {
    "name": "Unencrypted Connections",
    "description": "Database accepts unencrypted connections",
    "criticality": "high",
    "type": "Exposure",
    "exploited_by": [
        {"label": "MitreAttackTechnique", "property": "attack_id", "value": "T1040"}
    ]
}

unencrypted_connections[_unencrypted_connections_def] if {
    input.attributes.ssl_enabled == false
}
```

---

## Control Class Graph

The Control Class Graph workflow creates security control classes from natural language descriptions, complete with countermeasures and MITRE framework mappings.

### Workflow Steps

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     CONTROL CLASS GRAPH WORKFLOW                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐                                                        │
│  │ User Input      │  User describes the control in natural                 │
│  │ Description     │  language (interrupt)                                  │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │ Generate        │  AI generates control class definition                 │
│  │ Control Class   │  with countermeasures; may ask clarifying              │
│  │ Description     │  questions via tool calls                              │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │ Countermeasure  │  Parallel enrichment of each countermeasure:           │
│  │ Enrichment      │  • Map to MITRE D3FEND techniques                      │
│  │ (parallel)      │  • Map to MITRE ATT&CK mitigations                     │
│  │                 │  • Generate detection conditions                       │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │ Create          │  Generate OPA/Rego rules for                           │
│  │ Countermeasure  │  countermeasure detection                              │
│  │ Rules Template  │                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │ Normalize       │  Consolidate configuration options                     │
│  │ Configuration   │  and update OPA policy references                      │
│  │ Options         │                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │ Create          │  Generate JSONForms schema for                         │
│  │ Configuration   │  control configuration                                 │
│  │ Template        │                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │ Configuration   │  Generate usage guides for each                        │
│  │ Guide           │  configuration option (parallel)                       │
│  │ Generation      │                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │ Human           │  User reviews and approves generated                   │
│  │ Approval        │  artifacts before persistence                          │
│  │ (interrupt)     │                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐                                                        │
│  │ Save to         │  Persist control class to graph                        │
│  │ Database        │  database                                              │
│  └─────────────────┘                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Interactive Clarification

The Control Class Graph can ask clarifying questions during generation:

```python
@tool
def additional_information(question: str) -> str:
    """Retrieve user input information based on the question..."""
    user_input_question = f'''{{
    "question": "{question}",
    "answer_type": "text"
    }}'''
    user_input_information = interrupt(user_input_question)
    return user_input_information
```

**Example Interaction:**
```
User: "Create a control for API rate limiting"

AI: "What is the default rate limit threshold you want to enforce?"
User: "100 requests per minute"

AI: "Should the rate limit be applied per-user or globally?"
User: "Per-user based on API key"

[AI generates control class with these specifications]
```

### Example Output

For an "API Rate Limiting" control, the workflow generates:

**Countermeasures:**
- Request throttling
- Quota enforcement
- Burst protection
- Rate limit headers

**MITRE Mappings:**
- D3FEND: D3-RT (Rate Limiting)
- ATT&CK Mitigation: M1035 (Limit Access to Resource Over Network)

**OPA/Rego Policy:**
```rego
package _dt_built_in.countermeasures.api_rate_limiting

_request_throttling_def := {
    "name": "Request Throttling",
    "description": "Limits request rate per user",
    "type": "preventive",
    "category": "API Security",
    "respondsWith": [
        {"label": "MitreDefendTechnique", "property": "d3fendId", "value": "D3-RT"},
        {"label": "MitreAttackMitigation", "property": "attack_id", "value": "M1035"}
    ]
}

request_throttling[_request_throttling_def] if {
    input.attributes.rate_limit_enabled == true
    input.attributes.requests_per_minute > 0
}
```

---

## Generated Artifacts

Both workflows generate the following artifacts:

### 1. OPA/Rego Policy

Declarative policy rules for exposure/countermeasure detection:

```rego
package _dt_built_in.exposures.my_component

# Exposure definition with MITRE mapping
_exposure_name_def := {
    "name": "Exposure Name",
    "description": "Description of the exposure",
    "criticality": "high",
    "type": "Exposure",
    "exploited_by": [
        {"label": "MitreAttackTechnique", "property": "attack_id", "value": "T1234"}
    ]
}

# Detection rule based on configuration
exposure_name[_exposure_name_def] if {
    input.attributes.vulnerable_setting == true
}

# Aggregation rule
exposures contains _exposure_name_def if {
    count(exposure_name) > 0
}
```

### 2. JSONForms Schema

Configuration schema for the UI:

```json
{
  "schema": {
    "type": "object",
    "properties": {
      "ssl_enabled": {
        "type": "boolean",
        "title": "SSL/TLS Enabled",
        "default": true
      },
      "auth_method": {
        "type": "string",
        "title": "Authentication Method",
        "enum": ["password", "certificate", "kerberos"]
      }
    }
  },
  "uischema": {
    "type": "VerticalLayout",
    "elements": [
      {"type": "Control", "scope": "#/properties/ssl_enabled"},
      {"type": "Control", "scope": "#/properties/auth_method"}
    ]
  }
}
```

### 3. Configuration Options Guide

Usage guidance for each configuration option:

```yaml
- property: ssl_enabled
  title: SSL/TLS Enabled
  description: Enables encrypted connections to the database
  security_impact: Prevents eavesdropping and man-in-the-middle attacks
  recommendation: Always enable in production environments
  related_exposures:
    - Unencrypted Connections
```

### 4. MITRE Framework Mappings

Automatic linking to MITRE frameworks:

| Framework | Usage |
|-----------|-------|
| **ATT&CK Techniques** | Linked to exposures via `exploited_by` |
| **ATT&CK Mitigations** | Linked to countermeasures via `respondsWith` |
| **D3FEND Techniques** | Linked to countermeasures via `respondsWith` |

---

## Human-in-the-Loop

Both workflows use LangGraph's `interrupt` mechanism for human approval:

```python
def save_templates_question(state: GraphState):
    save_templates_question_prompt = """
    {
        "question": "Do you want to save the templates to the database?",
        "options": ["yes", "no"],
        "answer_type": "single"
    }
    """
    save_templates_question_answer = interrupt(save_templates_question_prompt)
    if save_templates_question_answer.lower() == "yes":
        return {"save_templates": True}
    else:
        return {"save_templates": False}
```

**Approval Points:**
1. After generating all artifacts, before persistence
2. After clarifying questions in Control Class Graph
3. Optional intermediate checkpoints for complex generations

**Benefits:**
- Review generated policies before they affect detection
- Validate MITRE mappings
- Adjust configuration options
- Reject and regenerate if needed

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [OVERVIEW.md](./OVERVIEW.md) | Module system introduction |
| [DT_MODULE_INTERFACE.md](./DT_MODULE_INTERFACE.md) | Core DTModule contract |
| [BASE_CLASSES.md](./BASE_CLASSES.md) | Module implementation patterns |
| [module-development.md](./module-development.md) | Manual module development guide |
| [../ARCHITECTURE.md](../ARCHITECTURE.md) | Platform architecture overview |
