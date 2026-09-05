# Glossary

Domain terminology used throughout the Dethernety platform and documentation.

---

## Core modeling

**Compliance Driver** -- A regulatory or standards framework that scopes a model (e.g., `PCI-DSS`, `SOC2`, `ISO 27001`, `HIPAA`, `GDPR`). A model-level, free-text list set via the combobox on the General tab of the Model dialog, or during the AI scope-definition workflow. Distinct from a data item's [Regulatory Flag](#): compliance drivers declare the obligations the whole model is built against and steer the depth of AI enrichment prompts (D52 tiers); regulatory flags label individual data items. The set is extensible — any value is allowed — but a recommended set is suggested.

**Component** -- A system element in a threat model: server, service, database, user, external system, etc. Components are nodes in the graph. Each component has a class that determines its attributes and behavior.

**Crown Jewel** -- A component flagged as a high-value asset — the data or capability an attacker would most want to reach. Set via the crown toggle on the General tab of a component's settings dialog, or during the AI classify workflow; both write the same per-component flag. Analysis prioritizes crown jewels (e.g., a crown jewel without controls is a highest-priority gap).

**Data Flow** -- A directed connection between two components representing data movement. Data flows are edges in the graph. They carry data items and can have security attributes (encryption, authentication).

**Data Item** -- A piece of data carried by a data flow. Used to classify what information moves between components (e.g., credentials, PII, session tokens).

**Folder** -- An organizational container for models. Folders can be nested.

**Model** -- A threat model containing components, data flows, security boundaries, and controls. The top-level unit of work.

**Regulatory Flag** -- A free-text compliance label on a data item recording which regime the data falls under (e.g., `PCI cardholder`, `PHI`, `GDPR personal`), kept separate from sensitivity. A data item can carry several. The set is extensible — any label is allowed — but the General tab of the Data dialog suggests a recommended set, and the AI enrichment path emits the same labels. Matched exactly and case-sensitively by compliance queries, so producers should use the recommended casing.

**Security Boundary** -- A trust zone grouping components that share a trust level (e.g., "internal network", "DMZ", "public internet"). Boundaries can be nested. Also called "trust boundary" in some threat modeling methodologies.

**Sensitivity** -- A data item's author-asserted confidentiality classification on a four-level scale, lowest to highest: Public, Internal, Confidential, Restricted. Set on the General tab of the Data dialog or by the AI enrichment path. Left unset, the data item is unclassified, which is not the same as Public.

**Trust Level** -- A numeric value on a security boundary indicating how much the zone is trusted. Lower values mean less trust.

---

## Security elements

**Control** -- A reusable security measure, held in the Browser and assigned to any number of model elements (components, data flows, boundaries) or to a whole model. A control binds one or more control classes from modules and carries instantiation attributes for each; only a configured class generates countermeasures. See [Working with Security Controls](user/WORKING_WITH_SECURITY_CONTROLS.md).

**Countermeasure** -- A defensive action belonging to a control. Most are computed from the control's configured classes; users can also author their own on the Countermeasures tab of the control dialog. Every countermeasure carries identity relations — the ATT&CK [mitigations](#) and D3FEND techniques it implements — and module-generated ones may additionally state what they do to specific ATT&CK techniques: *mitigates*, *protects against*, *detects*, or *isolates*. See [Working with Security Controls](user/WORKING_WITH_SECURITY_CONTROLS.md).

**Exposure** -- A security weakness on a component, data flow, security boundary, or data item, based on its configuration and class. Most are computed by module rules (OPA/Rego policies or custom logic); users can also author their own. Exposures map to the MITRE ATT&CK techniques that exploit them.

**Issue** -- A unit of tracked remediation work, raised from an exposure, a countermeasure, or an analysis finding, or created by hand. Its status is strictly **open** or **closed**; richer lifecycle states (`in-progress`, `verified`, `accepted`) are attributes defined by the issue's class, a separate field that the open/closed flag does not track. An issue links whichever elements it was raised from — which varies by origin, and a model-raised issue links only the model, not its contents. See [Issue Management Guide](user/ISSUE_MANAGEMENT_GUIDE.md).

---

## Finding disposition

**Disposition** -- A recorded decision about a system-generated finding (an Exposure or a Countermeasure), with a kind and a written reason, instead of deleting it. A disposition persists across re-derivation and captures who set it and when. Dispositions apply only to system-generated findings; user-authored findings are edited or deleted directly.

**Disposition Kind** -- The structured argument for a disposition. Shared kinds: **Not Applicable** (the finding cannot or does not apply to this instantiation) and **False Positive** (the template fired this finding incorrectly for this kind of element). Exposure-only: **Compensating Control** (a control not formally linked already mitigates this) and **Risk Accepted** (the threat is real and unmitigated, and the residual risk is accepted). Countermeasure-only: **Waived** (a decision not to implement this control — a GRC control waiver). System-set: **Superseded** (the finding was replaced by a user-authored copy via the Supersede flow).

**Stale Disposition** -- A disposition flagged for review because an instantiation attribute of the finding's element changed after the disposition was set. The decision is not dropped; the user re-affirms it (which clears the flag) or clears it.

**Re-affirm** -- Confirming a stale disposition still applies. Re-affirming re-stamps the author and timestamp and clears the stale flag. Surfaced in the UI as a "Review" action.

**Supersede (Fork)** -- Replacing a system-generated finding with an editable user-authored copy. The copy keeps its link to the same element (so it stays visible) but drops the class link (so re-derivation preserves it as a user finding); the original is dispositioned as Superseded. Deleting the user copy later flags the superseded original as stale.

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

**Policy engine** -- The evaluator that runs a module's Rego policies for exposure detection and countermeasure computation. It runs **in process** (Regorus, compiled to WebAssembly, in `packages/regorus-wasm`) — a deployment does not run a separate policy service.

**Rego** -- The policy language the engine evaluates. Modules define security rules as Rego policies.

## Deployment

**BYODt deployment** -- A self-hosted Dethernety deployment: the graph database, embedding server, platform, operator console, and front-door proxy, run from published images on your own machine or server. Delivered as a versioned bundle. See the [deployment guide](user/byodt/README.md) and its [architecture](architecture/byodt/README.md).

**Front door** -- The proxy that fronts a deployment on a single published port, serving the platform UI and API, and the operator console under `/console/`. It terminates TLS when a certificate is installed.

**Operator console** -- The deployment's management surface (`byodt-console`). Runs once before the platform starts to place the schema, install verified modules, and ingest reference data; then serves a web console reporting deployment state and applying configuration changes.

**Mode layer** -- The configuration file the console owns and rewrites: the small, fixed set of variables that switch a deployment between its standalone and cloud-connected postures. The platform reads it at startup, so a change takes effect when the stack is recreated.

**Deployment recipe** -- The block of configuration an operator pastes into the console to connect a deployment to cloud sign-in. Only a fixed, known set of variable names is accepted; anything else is refused.

**Content mount** -- A content package made available to a deployment through the console. The console writes a marker and stub into the modules directory; the platform loads it on the next start.

**Pin** -- The recorded version of a mounted content package, so the console can report when a newer version is available.
