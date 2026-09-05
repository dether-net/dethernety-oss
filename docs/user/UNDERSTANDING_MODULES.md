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

Modules are packages that provide the classes and analysis logic used in your threat models. They are **installed on your Dethernety deployment**, not picked per model — every class from every installed module is offered in every model on that deployment. What is installed determines:

- **What classes** you can classify your components, data flows, boundaries, and data items with
- **What security analysis** is performed on your configurations
- **What types of controls** are available for protection
- **What types of issues** can be created
- **How exposures are detected** and calculated

Installing a module is a deployment action, not something you do from inside a model — see [Where the classes you can pick come from](#where-the-classes-you-can-pick-come-from).

## What Modules Provide

### Component Classes

Component classes are what you classify a component with once it is on the canvas. The canvas palette itself is fixed — **Process**, **Store**, **External Entity**, and **Boundary** — so modules do not change what you can draw; they change what each drawn element can *be*. Each class specifies:

- Which component type it is written for — a class written for a **Store** is never offered to a **Process**
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
- **External system integration**: a module may implement a hook that pulls an issue's attributes from an external tracker. No integration module ships with the platform — see [Issue Class Integration](COMPONENT_CONFIGURATION_GUIDE.md#issue-class-integration)

### Analysis Classes

Modules can provide analysis types that appear in a model's **Analyses** dialog, opened from the canvas toolbar in the data flow editor. These define the analysis workflow, including what questions to ask, what data to evaluate, and how to structure results.

Analysis is entirely module-supplied — a deployment with no analysis-providing module installed has an empty **New Analysis** menu. The OSS distribution ships exactly one: the [Dethernety Threat Report](#dethernety-threat-report).

## Where the Classes You Can Pick Come From

### One catalogue for the whole deployment

Modules are installed on your Dethernety deployment, not attached to individual models. Every class from every installed module forms a **single catalogue**, and that one catalogue is offered to every model on the deployment.

There is no per-model module selection. Nothing you do in a model's settings widens or narrows the catalogue, and two models on the same deployment always see exactly the same classes.

### What narrows what you are offered

The picker never shows you the whole catalogue at once. It narrows by:

- **The element you are classifying**: a component picker offers component classes, a boundary picker offers boundary classes, a data flow picker offers data flow classes, and the Data dialog offers data classes
- **The component's type**: every component class is written for exactly one of **Process**, **Store**, or **External Entity**, and is never offered to a component of another type
- **What you type**: the picker searches the catalogue by name, and on a deployment with an embedding backend also matches semantically against the element's name and description
- **The facets you choose**: the **Browse classes** drawer has **Category** and **Module** chips you can use to narrow the catalogue yourself

The dropdown also offers **Recently used in this model**. That list is a convenience kept in your own browser — it is not a property of the model and it does not restrict what else you can pick.

The full picker workflow is in [How an Element Gets Its Class](COMPONENT_CONFIGURATION_GUIDE.md#how-an-element-gets-its-class).

### Getting more classes

If nothing in the catalogue describes what you are modeling, the class you need has to come from a module — and installing a module is a **deployment action**, not a modeling one. There is no in-model UI for it. How it is done depends on how your deployment is run:

- **A curated content package**: an operator mounts it from the deployment's operator console, then recreates the platform. See [Mounting content packages](byodt/CLOUD.md#mounting-content-packages).
- **A module you or your team wrote**: an operator places its build output in the deployment's modules directory, which is read when the platform starts. See the [Module Development Guide](../architecture/modules/DEVELOPMENT_GUIDE.md) for writing one, and the [Configuration Guide](../CONFIGURATION_GUIDE.md) for where that directory lives.

Either way, the new classes appear in **every** model on the deployment from the next platform start — there is nothing to enable per model afterwards.

So if a class you expect is missing, check the element's type first, and then ask whoever operates the deployment whether the module that provides it is installed.

Installing a module aimed at your technology does more than add rows to the picker — it also changes how specific the analysis can be. See [Module Impact on Analysis](#module-impact-on-analysis).

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

The OSS distribution ships with four modules. Only the first contributes classes to the pickers; the other three supply framework data, a report, and the coverage facts that report reads.

| Module | Identifier | Contributes |
|--------|-----------|-------------|
| **Dethernety General** | `dethernety-general` | Component, boundary, data flow, control, data, and issue classes, plus the Rego policies that turn their attributes into exposures and countermeasures |
| **MITRE Frameworks** | `mitre-frameworks` | Pre-loaded ATT&CK and D3FEND data |
| **Dethernety Threat Report** | `dethernety-threat-report` | The **Threat Report** analysis type and the report it renders |
| **Dethernety Coverage Tools** | `dethernety-coverage-tools` | The graded MITRE coverage facts the Threat Report's **Coverage & Gaps** matrix reads |

The **identifier** is the name the platform uses, and the name to quote when asking an operator whether something is installed. A module that provides classes also appears under it on the **Module** facet chips in the **Browse classes** drawer.

MITRE Frameworks is the odd one out: it is a **data pack** rather than a running module. It loads the ATT&CK and D3FEND content into the graph, provides no classes and no logic of its own, and so never appears as a facet chip — but everything that maps a finding or a countermeasure to a framework depends on it having been loaded.

### Dethernety General
The default class-providing module:
- General-purpose component classes for all three component types — processes (web server, API gateway, application service, firewall), data stores (relational database, object storage, cache, message queue), and external entities (end user, administrator, third-party service)
- Boundary classes (network perimeter, network segment, application layer, data layer, container, host, and more) and data flow classes (HTTP/S request, API call, database query, authentication exchange, and more)
- Control classes (encryption at rest and in transit, multi-factor authentication, role-based access control, web application firewall rules, and more), data classes, and issue classes
- Core security analysis policies — every class carries the Rego rules that turn its configured attributes into exposures and countermeasures

### MITRE Frameworks
Provides pre-loaded MITRE ATT&CK and D3FEND data:
- Attack technique definitions
- Defensive technique mappings
- Framework relationship data used by analysis and countermeasure generation

### Dethernety Threat Report
Contributes **one analysis type — "Threat Report"** — and the report it renders. It is the only analysis type the OSS distribution ships, and therefore the only entry in a stock deployment's **New Analysis** menu.

- It provides **no classes and no policies**. Nothing it does changes what you can classify an element with.
- It runs **no AI**: running it computes a point-in-time **snapshot** of the model with graph queries, asks no questions, and streams no reasoning.
- Opening the results renders the report's own interface over that snapshot — a Posture Summary, a **Coverage & Gaps** matrix, Reachability, Boundary Crossings, a Residual Risk ledger, and a per-element Component Profile.
- Because the report reads a snapshot rather than the live model, it also detects when the model has changed underneath a snapshot and offers to re-run.

See [Threat Report](threat-report/README.md) for how to read and export one.

### Dethernety Coverage Tools
A backend-only module with **no user interface of its own**. It computes the graded, element-scoped MITRE coverage facts that the Threat Report's **Coverage & Gaps** matrix is built from — for each exposure, which attack techniques it exposes and how strongly each is countered by the controls covering that element.

It is a **dependency of the Threat Report**, not an alternative to it. If it is not deployed, the **Coverage & Gaps** tab still appears, but instead of a matrix it says the coverage facts are unavailable and names the missing module. The rest of the report is unaffected, and no empty or all-green grid is ever shown in place of the missing data.

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

### Choosing What to Install
1. **Start with the included modules** for basic threat modeling
2. **Add specialized modules** as they become available for your technology stack
3. **Include compliance modules** if you have regulatory requirements

These are decisions about the deployment rather than about one model, so they are taken with whoever operates it — see [Getting more classes](#getting-more-classes).

### Working with a Large Catalogue
- **Install only what is needed**: every installed module adds to the one catalogue every model searches, so unused modules make the picker noisier for everyone on the deployment
- **Focus on your technology stack**: prefer modules that match your actual systems
- **Filter rather than scroll**: use the **Category** and **Module** facets in the **Browse classes** drawer to cut a large catalogue down to what you are looking for
- **Review what is installed periodically**: as your architecture evolves, ask for modules that cover it — and for ones you no longer model against to be removed

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
- **[Component Configuration Guide](COMPONENT_CONFIGURATION_GUIDE.md)**: Learn how to configure components against the classes your installed modules provide
- **[Security Analysis Workflow](SECURITY_ANALYSIS_WORKFLOW.md)**: Understand how modules affect your analysis results
- **[Working with Security Controls](WORKING_WITH_SECURITY_CONTROLS.md)**: See how modules provide countermeasures
