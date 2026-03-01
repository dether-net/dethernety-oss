# Glossary

Domain terminology used throughout the Dethernety platform and documentation.

---

## Core modeling

**Component** -- A system element in a threat model: server, service, database, user, external system, etc. Components are nodes in the graph. Each component has a class that determines its attributes and behavior.

**Data Flow** -- A directed connection between two components representing data movement. Data flows are edges in the graph. They carry data items and can have security attributes (encryption, authentication).

**Data Item** -- A piece of data carried by a data flow. Used to classify what information moves between components (e.g., credentials, PII, session tokens).

**Folder** -- An organizational container for models. Folders can be nested.

**Model** -- A threat model containing components, data flows, security boundaries, and controls. The top-level unit of work.

**Security Boundary** -- A trust zone grouping components that share a trust level (e.g., "internal network", "DMZ", "public internet"). Boundaries can be nested. Also called "trust boundary" in some threat modeling methodologies.

**Trust Level** -- A numeric value on a security boundary indicating how much the zone is trusted. Lower values mean less trust.

---

## Security elements

**Control** -- A security measure applied to one or more model elements. Controls have a class (from a module) and instantiation attributes. Configuring a control generates countermeasures.

**Countermeasure** -- A defensive action generated from a control configuration, mapped to MITRE D3FEND techniques. Countermeasures are computed, not manually created.

**Exposure** -- A security weakness detected on a component or data flow based on its configuration and class. Exposures are computed by module rules (OPA/Rego policies or custom logic) and map to MITRE ATT&CK techniques.

**Issue** -- A tracked finding from analysis or manual review. Issues reference specific model elements (components, data flows, boundaries) and have a lifecycle (open, in progress, resolved).

---

## Classification system

**Class** -- A type definition provided by a module. Classes exist for components (`ComponentClass`), data flows (`DataFlowClass`), security boundaries (`SecurityBoundaryClass`), controls (`ControlClass`), data items (`DataClass`), analyses (`AnalysisClass`), and issues (`IssueClass`). A class defines available attributes, validation rules, and behavior.

**Instantiation** -- The act of assigning a class to a model element. When you set a component's class to "Web Server", you're instantiating that class.

**Instantiation Attributes** -- Configuration values set on a model element after class assignment. These are defined by the class schema (e.g., a "Web Server" class might define attributes for TLS version, authentication method, and exposed ports).

**Template** -- A pre-filled configuration for a class, provided by the module. Templates give users a starting point rather than requiring them to fill in every attribute from scratch.

**Guide** -- Documentation attached to a class by the module, displayed in the UI when a user selects that class. Guides explain what the class represents and how to configure it.

---

## Analysis and frameworks

**Analysis** -- A security assessment run against a model. Analyses are instances of an `AnalysisClass` provided by a module. The analysis engine can be query-based, rule-based (OPA/Rego), or AI-powered.

**Analysis Class** -- A type of analysis provided by a module. Each analysis class defines what kind of assessment it performs (e.g., attack scenario generation, compliance gap analysis).

**MITRE ATT&CK** -- A knowledge base of adversary tactics and techniques. Dethernety maps exposures to ATT&CK techniques so users can see which real-world attack methods apply to their model.

**MITRE D3FEND** -- A knowledge base of defensive techniques. Dethernety maps countermeasures to D3FEND techniques so users can see which defensive measures address identified threats.

**Tactic** -- A high-level adversary goal in ATT&CK (e.g., Initial Access, Lateral Movement, Exfiltration). Tactics group related techniques.

**Technique** -- A specific method an adversary uses to achieve a tactic. Techniques can have sub-techniques. Exposures map to techniques.

**Sub-technique** -- A more specific variant of a technique (e.g., "Phishing: Spearphishing Attachment" is a sub-technique of "Phishing").

**Mitigation** -- An ATT&CK mitigation describing a category of defensive action. Controls and countermeasures map to mitigations.

---

## Infrastructure

**Module** -- An executable JavaScript/TypeScript package that extends the platform. Modules provide classes, exposure rules, analysis logic, templates, and countermeasure generation. See [Module system overview](architecture/modules/README.md).

**Module Registry** -- The backend service (`ModuleRegistryService`) that discovers, loads, validates, and routes requests to modules at startup.

**dt-core** -- The shared TypeScript data access layer (`packages/dt-core`). Provides typed GraphQL operations used by the frontend, backend, and MCP server. See [dt-core overview](architecture/dt-core/README.md).

**Graph Database** -- The Bolt/Cypher-compatible database (Neo4j or Memgraph) storing all platform data as nodes and edges.

**Cypher** -- The graph query language used to read and write data. Shared by Neo4j and Memgraph.

**Bolt Protocol** -- The binary protocol used for client-database communication. Using Bolt (rather than a vendor API) allows switching between Neo4j and Memgraph.

**OPA (Open Policy Agent)** -- An external policy engine that evaluates Rego policies. Used by modules for exposure detection and countermeasure computation.

**Rego** -- The policy language used by OPA. Modules define security rules as Rego policies.
