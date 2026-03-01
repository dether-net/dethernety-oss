---
title: 'Understanding Modules'
description: "How Dethernety's module system extends your threat modeling capabilities."
category: 'reference'
position: 10
navigation: true
tags: ['intermediate', 'reference', 'conceptual', 'modules', 'extensions', 'system-architecture']
---

# Understanding Modules

*How Dethernety's module system extends your threat modeling capabilities.*

## What Are Modules?

Modules are packages that provide the classes and analysis logic used in your threat models. When you create a model, you **assign modules** to make their capabilities available. The modules you choose determine:

- **What types of components** you can add to your model
- **What security analysis** is performed on your configurations
- **What types of controls** are available for protection
- **What types of issues** can be created
- **How exposures are detected** and calculated

## What Modules Provide

### Component Classes

Component classes define the types of elements available in your model's component palette. Each class specifies:

- Available configuration attributes (ports, protocols, encryption settings, etc.)
- Default values for common configurations
- Validation rules for attribute combinations

**Example**: A web server class might provide attributes for protocol, port, TLS version, and authentication method, while a database class provides attributes for encryption at rest, connection pooling, and access control.

### Security Analysis Logic

Modules contain OPA/Rego policies that evaluate component configurations:

- **Evaluate configurations** against security policies
- **Identify exposures** based on component attributes
- **Calculate risk levels** using defined rules
- **Map exposures to attack techniques** from MITRE ATT&CK

**Example**: A web application module detects that setting `protocol: "HTTP"` on a production component creates an "Unencrypted Web Traffic" exposure linked to network sniffing attacks.

### Control Classes and Countermeasures

Modules provide control class definitions that generate countermeasures when applied:

- **Match controls to exposures** based on security rules
- **Provide implementation guidance** for specific technologies
- **Connect to D3FEND** defensive techniques

### Issue Classes

Modules define issue types with customizable attributes:

- **Custom issue types** (security vulnerabilities, compliance violations, configuration errors)
- **Tailored attributes** (priority levels, assignment categories, SLA tracking)
- **Issue templates** with pre-filled information
- **External system integration** for bidirectional sync with tools like Jira, ServiceNow, or GitHub Issues

### Analysis Classes

Modules can provide analysis types that appear in the model dialog's analysis tab. These define the analysis workflow, including what questions to ask, what data to evaluate, and how to structure results.

## How Module Assignment Works

### During Model Creation

When you create a new model, you **select which modules to assign**:

1. **Browse available modules**: See all modules installed in your Dethernety system
2. **Select relevant modules**: Choose modules that match your technology stack
3. **Module assignment**: Selected modules become available for that specific model

Only classes from assigned modules are available in your model. If you need additional component types later, you can assign more modules to the model.

### What Module Assignment Affects

**Component Classes Available**:
```
Without specific module  ->  Generic component types
With specialized module  ->  Technology-specific types (e.g., specific database, web server classes)
```

**Analysis Depth**:
```
Basic module  ->  General security checks
Specialized module  ->  Technology-specific vulnerability detection
```

**Control Recommendations**:
```
Generic module  ->  "Enable encryption"
Specialized module  ->  "Enable encryption at rest with key rotation policy"
```

## How Modules Work

### Policy Evaluation

Modules use OPA/Rego policies to analyze your configurations:

```rego
# Example: Web application security policy
unencrypted_web_traffic_exposure {
    input.protocol == "http"           # Your configuration
    input.environment == "production"  # Context matters
    # Result: Exposure detected with specific attack technique mapping
}
```

What this means in practice:
- **Real-time feedback**: Exposures appear as you configure components
- **Context-aware analysis**: The same setting may have different risk levels in different contexts
- **Automated coverage**: Policies check many security considerations automatically

### Security Framework Mapping

Modules connect your configurations to security frameworks:

```
Your Configuration  ->  Module Analysis  ->  Framework Integration
|-- Component: Web Server
|-- Protocol: HTTP
|-- Authentication: Basic
`-- Module evaluates...
    |-- Detects: Unencrypted traffic exposure
    |-- Maps to: MITRE ATT&CK T1040 (Network Sniffing)
    |-- Links to: D3FEND D3-TTE (Transport Encryption)
    `-- Recommends: TLS encryption control
```

### Dynamic Form Generation

Modules define the configuration forms you see in the UI:

- **JSON Schema definitions** control what attributes are available
- **Forms adapt** to different component types and classes
- **Validation rules** enforce proper configurations
- **Help text** provides context-specific guidance

## Included Modules

The OSS distribution ships with two modules:

### Dethernety Module
The default module providing:
- Base component classes (processes, data stores, external entities)
- Base boundary and data flow classes
- AI-assisted class generation for creating custom classes on the fly
- Core security analysis policies

### MITRE Frameworks
Provides pre-loaded MITRE ATT&CK and D3FEND data:
- Attack technique definitions
- Defensive technique mappings
- Framework relationship data used by analysis and countermeasure generation

## Building Custom Modules

Modules are JavaScript/TypeScript packages that extend the platform. A module can include:

- **Component, data flow, boundary, and data classes** with JSON Schema attribute definitions
- **OPA/Rego policies** for exposure detection and countermeasure generation
- **Analysis class definitions** for custom analysis workflows
- **Issue class definitions** with external system integration logic
- **Custom business logic** using full JavaScript capabilities

**Possible module types include**:
- Technology-specific modules (AWS, Kubernetes, container security, database security)
- Compliance modules (NIST, PCI DSS, GDPR, SOC 2)
- Industry-specific modules (healthcare, financial services, manufacturing)
- Integration modules (connecting to external vulnerability scanners, SIEMs, or ticketing systems)

For module development details, see the [Module Development Guide](../architecture/modules/DEVELOPMENT_GUIDE.md).

## Best Practices

### Module Selection
1. **Start with the included modules** for basic threat modeling
2. **Add specialized modules** as they become available for your technology stack
3. **Include compliance modules** if you have regulatory requirements

### Managing Module Complexity
- **Assign only relevant modules**: Too many modules can create unnecessary complexity in the component palette
- **Focus on your technology stack**: Choose modules that match your actual systems
- **Review assignments periodically**: Reassess module assignments as your architecture evolves

## Module Impact on Analysis

### Exposure Detection Quality
More specific modules produce more specific exposure detection:
- Generic module: "Database security issue"
- Technology-specific module: "Unencrypted PostgreSQL connections with weak authentication on port 5432"

### Countermeasure Relevance
Technology-aware modules produce actionable recommendations:
- Generic: "Enable encryption"
- Technology-specific: "Enable encryption at rest using KMS with automatic key rotation"

### Analysis Depth
Multiple modules provide broader coverage:
- Single module: Standard security checks
- Multiple complementary modules: Technology-specific, compliance, and framework-based analysis

---

**Next Steps**:
- **[Component Configuration Guide](COMPONENT_CONFIGURATION_GUIDE.md)**: Learn how to configure components from your assigned modules
- **[Security Analysis Workflow](SECURITY_ANALYSIS_WORKFLOW.md)**: Understand how modules affect your analysis results
- **[Working with Security Controls](WORKING_WITH_SECURITY_CONTROLS.md)**: See how modules provide countermeasures
