---
title: 'Component Configuration Guide'
description: 'Detailed guide on configuring different types of components and their security implications.'
category: 'advanced'
position: 13
navigation: true
tags: ['advanced', 'reference', 'detailed', 'components', 'configuration', 'technical', 'modules']
---

# Component Configuration Guide

*Detailed guide on configuring different types of components and their security implications.*

## Understanding Modules and Classes

Before configuring components, it's important to understand how Dethernety's [module system](UNDERSTANDING_MODULES.md) works:

### Where classes come from

**Modules** provide the component classes, data flow classes, boundary classes, data classes, and security analysis logic you configure against:
- **Installed, not assigned**: the class catalogue is deployment-wide — every class from every module installed on your Dethernety instance is offered to every model
- **Scoped by the element**: what you are actually offered is narrowed by the element you are classifying — a component class written for a **Store** is never offered to a **Process**
- **Security logic travels with the class**: each module carries the policies that turn a class's configured attributes into exposures

The OSS distribution ships four modules, but only one of them — `dethernety-general` — contributes classes to the picker; the other three supply framework data, reporting, and coverage facts. Specialized modules add technology-, compliance-, or industry-specific classes. See [Understanding Modules](UNDERSTANDING_MODULES.md) for what each shipped module contributes and how one is built.

### Class Inheritance

**Component Classes** define:
- **Available Attributes**: What configuration options are available
- **Default Values**: Sensible defaults for common configurations  
- **Security Rules**: How the module calculates exposures
- **Validation Logic**: What combinations of settings are valid

## Marking Crown Jewels

A **crown jewel** is a high-value asset — a component holding the data or capability an attacker would most want to reach. Marking a component as a crown jewel tells the analysis to prioritize it: a crown jewel without adequate security controls is surfaced as a highest-priority gap.

### Where to find the crown button

The crown toggle lives on the **General** tab of a component's settings dialog. It is the **crown icon button** at the left of the row that holds the **"Inherited from a Class" / "Represents a Model"** switch.

The button appears **only for components** — Process, Data Store, and External Entity. It does not appear for security boundaries, data flows, or data items, which have no crown-jewel field.

### Marking and unmarking a component

1. Open the component's settings dialog and stay on the **General** tab
2. Locate the **crown button** to the left of the inheritance switch
3. Click it to toggle the crown-jewel state:
   - **Off**: an outlined crown
   - **On**: a filled gold crown
4. The change **persists immediately** — there is no separate Save step

Clicking the crown again clears the flag and removes the visual treatment.

### What the gold treatment means

When a component is marked as a crown jewel, its node on the canvas receives a **discrete gold treatment** — a soft gold cast and a thin gold edge — so crown jewels stand out at a glance among ordinary components. Toggling the flag off restores the node's normal appearance.

**Note**: The crown toggle and the AI/classify workflow set the **same** underlying field on a component. Whether a crown jewel is declared during AI scope definition or toggled here by hand, it is the one crown-jewel mark on that component.

## Classifying Data Items

A data item can carry four pieces of classification context — **sensitivity**, **regulatory flags**, **origin**, and the **credential** flag — set on the **General** tab of the Data dialog (open a data item's settings and stay on the **General** tab). Sensitivity and regulatory flags feed security and compliance analysis; origin and the credential flag record who can write the content and whether it is a credential.

### Sensitivity

**Sensitivity** is your own assertion of how confidential the data is, on a four-level scale from lowest to highest:

- **Public**
- **Internal**
- **Confidential**
- **Restricted**

Pick a level from the **Sensitivity** dropdown. Leaving it blank marks the data item **Unclassified** — which is not the same as Public.

### Regulatory flags

**Regulatory flags** record which compliance regimes the data falls under — for example, cardholder data under PCI-DSS or health records under HIPAA. They are kept separate from sensitivity, and a data item can carry several at once.

The **Regulatory flags** field is a free-text tag input: type any label and press Enter to add it, and click a chip's close icon to remove it. The field also **suggests** a recommended set of flags, each shown with the framework it maps to:

| Flag | Framework |
|------|-----------|
| `PCI cardholder` | PCI-DSS |
| `PHI` | HIPAA |
| `GDPR personal` | GDPR |
| `PII` | general |
| `SOX financial` | SOX |
| `CCPA personal` | CCPA |

These are **suggestions, not a closed list** — you can type your own labels for any regime the suggestions don't cover. When you do match a recommended regime, prefer the suggested label exactly as written: flags are matched case-sensitively, so a custom variant like `pci cardholder` will not be picked up by compliance queries that look for `PCI cardholder`.

**Note**: Sensitivity and regulatory flags are the same fields the AI enrichment path populates. Whether you set them here by hand or let the AI workflow classify the data item, they read from one shared list of recommended flags, so the GUI suggestions and the AI output stay aligned.

### Origin

**Origin** is your own assertion of who can write the data item's content. Pick it from the **Origin** dropdown, which lists the levels from most to least trusted, each with a one-line meaning:

| Origin | Meaning |
|--------|---------|
| **Authenticated first party** | Written only by the operator's own authenticated users or systems |
| **Curated internal** | Internal content that passed a review or curation step |
| **Agent relayed** | Produced or forwarded by another agent; at most this trusted |
| **Model generated** | Written by a model and later read as input; at most this trusted |
| **Third party** | Written by a known external party under an agreement |
| **Arbitrary public** | Anyone can write it |
| **Not assessed** | Answered as not established; treated as untrusted |

The last three carry an **untrusted** chip in the list. Choose the **least-trusted** source of what the item holds: if any part of it comes from somewhere anyone can write, the item is **Arbitrary public**. Leaving the field blank shows **Unclassified** — nobody has answered yet, which is not the same as **Not assessed**. To clear a value, use the field's clear icon. For the full vocabulary, see the [canonical data-origin and credential vocabulary](../architecture/dethereal/THREAT_MODELING_WORKFLOW.md#canonical-data-origin-and-credential-vocabulary).

### Credential

The **Credential** dropdown records whether the data item is a credential — a password, token, key, secret, or certificate. Pick **Yes — a credential** or **No**; leaving it blank shows **Unknown**. **No** is a real answer and is kept as such.

**Note**: Origin and the credential flag are the same fields the AI enrichment path asks about. The AI workflow proposes them for you to confirm and never sets either on its own.

## How an Element Gets Its Class

Every element in a model — component, data flow, security boundary, and data item — is classified the same way: you **pick a class** from the catalogue your installed modules provide. You do not author classes in the model editor. If nothing in the catalogue fits, the answer is a module that supplies a class that does — see [Understanding Modules](UNDERSTANDING_MODULES.md).

### Where the class picker lives

| Element | Where the picker appears |
|---------|--------------------------|
| Component (Process, Store, External Entity) | **General** tab of the settings panel, right-hand column |
| Security boundary | **General** tab of the settings panel, right-hand column |
| Data flow | **General** tab of the settings panel, right-hand column |
| Data item | **General** tab of the **Data** dialog, right-hand column |

Open a component, boundary, or data flow's settings panel by double-clicking the node or the flow arrow on the canvas. For components and boundaries the picker is shown only while the inheritance switch reads **"Inherited from a Class"**; flipping it to **"Represents a Model"** replaces the picker with the **Represented Model** field.

A node with no class carries a warning marker on the canvas — hover it for *No class assigned. Open Settings to assign one.*

### Picking a class

1. **Click the class field.** It is labelled **Component Class**, **Boundary Class**, or **Data Flow Class** on the settings panel, and **Class** on the Data dialog. A dropdown opens.
2. **Take a suggestion, or search.** With the field empty the dropdown offers **Recently used in this model** and **Suggested for this element**. Type into the field to search the catalogue by name — results update as you type.
3. **Or browse the whole catalogue.** Click **Browse all classes →** at the foot of the dropdown to open the **Browse classes** drawer. Narrow the list with the **Category** and **Module** facet chips, click a row to read its full description in the preview pane, then click **Select** — or double-click the row.
4. **Confirm the change.** If the element already has a class (or represents a model), a confirmation appears first: *Changing the class will clear this element's attributes. Threats and exposures will be recomputed on the next analysis run.* When you also have unsaved name or description edits, it offers **Commit & change** and **Discard & change** alongside **Cancel**. An element with no class yet is bound immediately, with no confirmation.
5. **Check the result.** The bound class appears in a preview card below the field, showing its **Category**, source **Module**, and description. The **Attributes** tab now loads that class's configuration form, and the class's policies start evaluating what you enter there.

### What the picker offers you

- **Component classes are type-scoped.** Every component class is written for exactly one type, so a class written for a **Store** is never offered to a **Process** — not in the suggestions, not in the search results, not in the browse drawer. If a class you expect is missing, check the component's type first.
- **Suggestions read the element's name and description.** Write a real description before opening the picker. With the description empty the dropdown says *Add a description above to get semantic suggestions* and matches on the name alone.
- **Semantic matching needs an embedding backend.** On a deployment without one the picker says *Semantic search is unavailable on this deployment — showing name-based matches* and keeps working on names and descriptions.
- **Every row names its source.** Results and browse rows are subtitled with the class's category and the module that provides it, so you can always tell where a class came from.

### Replacing and removing a class

Pick a different class at any time — the new pick replaces the old one, through the same confirmation as above.

To leave a component, boundary, or data flow unclassified, click the **Remove class** button — the broken-link icon at the right of the inheritance-switch row. It confirms first: *Removing the class will delete its auto-generated exposures and clear this element's attributes. Exposures you created yourself are kept.*

If a module upgrade withdraws a class that is still in use, the element keeps pointing at it and the picker flags the break: the field shows **Unknown class** with a **retired** chip and the prompt *Pick a replacement.* Choose a live class to repair the binding.

### One class per element, several per control

An element carries **one** class at a time, which is why a pick is always a replacement and the browse drawer closes as soon as you select. Controls work differently: a control binds **several** control classes at once, so the same drawer stays open for repeat picks and marks classes already bound with an **Added** chip. See [Working with Security Controls](WORKING_WITH_SECURITY_CONTROLS.md).

## Answering Yes-or-No Attributes

On an **Attributes** form — of a component, boundary, data flow, data item, control class, or issue — a yes/no attribute is a three-way choice: **Yes**, **No**, or **Not answered**.

- Click **Yes** or **No** to answer.
- To take an answer back, click **Not answered**. Saving then removes the stored answer; it is not kept as **No**.
- The same goes for other attributes: emptying a text field, clearing a choice, or removing an item from a list removes it when you save.

**Not answered is not the same as No.** Some policies treat a missing answer as a reason to raise a finding, so setting an attribute back to **Not answered** can change the analysis — just as an attribute you never answered always could.

## Issue Class Integration

> **No integration module ships with Dethernety.** The platform provides the *seam* described below; a module has to implement it before an issue in Dethernety is connected to anything outside it. Out of the box, issues are created and tracked entirely within the platform — see the [Issue Management Guide](ISSUE_MANAGEMENT_GUIDE.md).

The module that provides an issue class may also implement a **synchronization hook**. Where it does:

- The module reads the issue's attributes from the external system and returns them to the platform.
- Those values surface as the issue's **synced attributes** — searchable alongside the issue's own fields, and the source of the severity shown on issue rows.
- The platform records the time of the last successful sync on the issue, and enforces a timeout so a slow or unreachable external system cannot stall the request.

The hook is a pull: the external system remains the source of truth for the attributes it owns, and the platform does not write back to it. Anything richer — pushing new issues outward, mirroring status changes both ways, escalation on a timer — is up to the module and is not something the platform provides.

Writing such a module is covered in the [Module Development Guide](../architecture/modules/DEVELOPMENT_GUIDE.md).

## Component Types Overview

Dethernety supports several component types, each with specific configuration options and security considerations:

### Process Components
- **Web Applications**: Frontend interfaces, APIs, microservices
- **Application Servers**: Business logic, middleware, backend services
- **System Services**: Operating system services, background processes

### Data Store Components
- **Databases**: SQL, NoSQL, graph databases
- **File Systems**: Local storage, network shares, cloud storage
- **Caches**: In-memory stores, distributed caches

### External Entities
- **Users**: End users, administrators, service accounts
- **Third-party Services**: APIs, SaaS platforms, partners
- **Systems**: External applications, legacy systems

## Process Components

### Web Applications

Web applications are the most common entry points into systems and require careful configuration.

#### Basic Configuration

**Component Properties (before class assignment):**
- **Name**: Descriptive name (e.g., "Customer Portal Web App")
- **Description**: Brief explanation of component purpose

**Configuration Type Selection:**
Components can be configured in two ways:

**Option 1: Class Assignment**
1. In the component's settings panel, leave the switch on **"Inherited from a Class"**
2. Pick a component class from the catalogue your installed modules provide (e.g., "Web Server", "Relational Database") — the full workflow is in [How an Element Gets Its Class](#how-an-element-gets-its-class)

**Note**: The classes offered for a component are narrowed by the component's own type. Every component class is written for exactly one type, so a class written for a **Store** is never offered to a **Process** component: not in the suggestions, not in the search results, not in the browse drawer, and not in the recently used list. If you don't see a class you expect, check whether it was written for this component's type (**Process**, **Store**, or **External Entity**), then whether the module that provides it is installed on your instance. A class written for a different type cannot be used on this component — choose one that matches its type instead.

**Option 2: Model Reference**
1. In the component settings dialog, toggle to **"Represents a Model"**
2. Click the **magnifier button** next to the "Represented Model" field
3. Browse the model selection dialog:
   - **Left panel**: Folder structure for organizing models
   - **Right panel**: Available models in the selected folder
4. Select the model you want this component to represent
5. Click **"Select"** to establish the reference

**Important**: Switching between class assignment and model reference will **clear all existing settings, attributes, and exposures**.


#### Security Configuration (after class assignment or model reference)

**Class Assignment**: The component inherits the class's configuration template and available attributes
**Model Reference**: The component inherits properties and security characteristics from the referenced model

**Authentication Settings:**

```
Authentication Type: [Session-based | JWT | OAuth 2.0 | SAML]
Multi-Factor Authentication: [Enabled | Disabled]
Password Policy: [Strong | Medium | Weak | Custom]
Session Management: [Secure | Standard | Custom]
```

**Example - E-commerce Web App:**
- **Authentication**: Session-based with MFA for admin accounts
- **Password Policy**: Minimum 12 characters, complexity requirements
- **Session Timeout**: 30 minutes for regular users, 15 minutes for admins
- **Cookie Settings**: Secure, HttpOnly, SameSite=Strict

**Network Security:**

```
Protocol: [HTTP | HTTPS | Both]
TLS Version: [1.2 | 1.3 | Both]
CORS Policy: [Restrictive | Permissive | Custom]
Rate Limiting: [Enabled | Disabled]
```

**Input Handling:**

```
Input Validation: [Enabled | Partial | Disabled]
Sanitization: [Automatic | Manual | None]
File Upload Security: [Restricted | Standard | Permissive]
Content Security Policy: [Strict | Moderate | Disabled]
```

#### Advanced Configuration

**Security Headers:**
Enable these security headers for web applications:
- **HSTS**: Force HTTPS connections
- **X-Frame-Options**: Prevent clickjacking
- **X-Content-Type-Options**: Prevent MIME sniffing
- **Referrer-Policy**: Control referrer information
- **Permissions-Policy**: Restrict browser features

**Error Handling:**
- **Error Messages**: Generic (recommended) vs. Detailed
- **Stack Traces**: Hidden in production
- **Logging Level**: ERROR and above in production

#### Understanding Security Exposures

**How Dethernety Determines Security Exposures**

After configuring component attributes, the **Dethernety General** module (`dethernety-general`) uses OPA/Rego policies to analyze your configuration and identify potential security exposures.

**Exposure Calculation Process:**

1. **Policy Evaluation**: The module evaluates component attributes against OPA/Rego policies
2. **Exposure Generation**: Applicable exposures are identified based on configuration weaknesses
3. **MITRE ATT&CK Mapping**: Each exposure includes direct links to attack techniques
4. **Real-Time Updates**: Exposures recalculate immediately when attributes change
5. **Display in UI**: Results appear in the "Exposures" section of the settings dialog

**Example: Web Application Exposure Analysis**

Consider a web application with these attributes:
```
Protocol: HTTP
Authentication: Basic
Input_Validation: Disabled
Session_Timeout: 3600 (1 hour)
TLS_Version: None
```

**Generated Exposures:**

```rego
# Module policy evaluates attributes and generates exposures
unencrypted_web_traffic_def := {
    "name": "unencrypted_web_traffic",
    "description": "HTTP traffic allows attackers to intercept sensitive data including credentials and session tokens",
    "criticality": "high",
    "exploited_by": [
        {"label": "MitreAttackTechnique", "property": "attack_id", "value": "T1040"},  # Network Sniffing
        {"label": "MitreAttackTechnique", "property": "attack_id", "value": "T1557"}   # Adversary-in-the-Middle
    ]
}

weak_authentication_def := {
    "name": "weak_authentication",
    "description": "Basic authentication without MFA allows credential-based attacks",
    "criticality": "medium",
    "exploited_by": [
        {"label": "MitreAttackTechnique", "property": "attack_id", "value": "T1110"},  # Brute Force
        {"label": "MitreAttackTechnique", "property": "attack_id", "value": "T1078"}   # Valid Accounts
    ]
}
```

**Multi-Condition Exposure Logic:**

The same exposure can be triggered by different attribute combinations:

```rego
# Missing input validation exposure can be triggered multiple ways
missing_input_validation[_missing_input_validation_def] if {
    input.input_validation == "disabled"
}

missing_input_validation[_missing_input_validation_def] if {
    input.input_validation == "partial"
    count(input.validated_inputs) == 0
}

missing_input_validation[_missing_input_validation_def] if {
    input.file_upload_validation == false
    input.allow_file_uploads == true
}
```

**Viewing and Understanding Exposures:**

**In the Component Settings Dialog:**
1. Configure your component attributes
2. Navigate to the **"Exposures"** tab
3. Review automatically calculated exposures
4. Each exposure shows:
   - **Name and Description**: What the security issue is
   - **Criticality Level**: Risk assessment (high, medium, low)
   - **Attack Techniques**: MITRE ATT&CK techniques that can exploit this exposure
   - **Recommendations**: Suggested configuration changes

**Dynamic Exposure Updates:**

Exposures update in real-time as you modify attributes:

```
Example Improvement Sequence:
1. Change Protocol: HTTP → HTTPS
   └── Removes "unencrypted_web_traffic" exposure

2. Enable MFA: Basic Auth → Basic Auth + MFA
   └── Reduces "weak_authentication" criticality

3. Enable Input Validation: Disabled → Enabled
   └── Removes "missing_input_validation" exposure
```

**Exposure-to-Graph Integration:**

Each calculated exposure is stored in the graph database with complete MITRE ATT&CK relationships:

```cypher
// Component exposures in the graph
(WebApp:Component {
  protocol: "HTTP",
  authentication: "basic"
})-[:HAS_EXPOSURE]->(UnencryptedTraffic:Exposure {
  name: "unencrypted_web_traffic",
  criticality: "high"
})

// Direct links to attack techniques
(UnencryptedTraffic)-[:EXPLOITED_BY]->(T1040:MitreAttackTechnique {
  attack_id: "T1040",
  name: "Network Sniffing"
})

(UnencryptedTraffic)-[:EXPLOITED_BY]->(T1557:MitreAttackTechnique {
  attack_id: "T1557",
  name: "Adversary-in-the-Middle"
})
```

**Module-Specific Exposure Types:**

Different modules generate different types of exposures:

- **Web Application Modules**: Focus on web-specific vulnerabilities (XSS, CSRF, injection)
- **Database Modules**: Emphasize data protection and access control exposures
- **Network Modules**: Highlight network security and segmentation issues
- **Cloud Modules**: Address cloud-specific misconfigurations and service exposures

**Best Practices for Configuration:**

1. **Start with Secure Defaults**: Choose secure configuration options initially
2. **Monitor Exposure Changes**: Watch how different settings affect exposures
3. **Address High-Criticality First**: Focus on high and critical exposures immediately
4. **Understand MITRE Mappings**: Learn what attack techniques your exposures enable
5. **Iterative Improvement**: Make incremental configuration improvements and observe exposure changes

### APIs and Services

API components handle business logic and data processing between different system layers.

#### Basic Configuration

**API Properties:**
- **API Type**: REST, GraphQL, gRPC, SOAP
- **Protocol**: HTTP, HTTPS, TCP
- **Documentation**: OpenAPI, schema definitions
- **Versioning Strategy**: URL path, header, query parameter

#### Security Configuration

**Authentication and Authorization:**

```
Authentication Method: [API Keys | JWT | OAuth 2.0 | mTLS]
Authorization Model: [RBAC | ABAC | Custom]
Token Validation: [Local | Remote | Cached]
Scope Management: [Granular | Coarse | None]
```

**Example - Payment API:**
- **Authentication**: OAuth 2.0 with client credentials
- **Authorization**: Role-based access control (RBAC)
- **Scopes**: `payment:read`, `payment:write`, `payment:refund`
- **Token Lifetime**: 1 hour with refresh capability

**API Security:**

```
Rate Limiting: [Per IP | Per User | Per API Key]
Request Size Limits: [MB]
Response Filtering: [Enabled | Disabled]
CORS Configuration: [Specific origins | Wildcard | Disabled]
```

**Data Validation:**

```
Input Schema Validation: [Strict | Permissive | Disabled]
Output Schema Validation: [Enabled | Disabled]
Parameter Sanitization: [Automatic | Manual]
SQL Injection Protection: [Enabled | Disabled]
```

## Data Store Components

### Databases

Database components store and process sensitive information, making them critical security targets.

#### Basic Configuration

**Component Properties (before class assignment):**
- **Name**: Descriptive database name (e.g., "User Database")
- **Description**: Purpose and data types stored

**Class Assignment:**
1. Pick a store class from the catalogue your installed modules provide (e.g., "Relational Database", "Object Storage") — the full workflow is in [How an Element Gets Its Class](#how-an-element-gets-its-class)
2. The class determines available configuration attributes

**Database Properties (after class assignment):**
- **Database Type**: Inherited from class (PostgreSQL, MySQL, MongoDB, etc.)
- **Version**: Specific version number
- **Deployment Mode**: Standalone, cluster, managed service
- **Data Classification**: Public, Internal, Confidential, Restricted

#### Security Configuration

**Access Control:**

```
Authentication Method: [Username/Password | Certificate | IAM | LDAP]
Connection Encryption: [TLS 1.2+ | Native | None]
Network Access: [Local only | Private network | Public with restrictions]
Connection Pooling: [Enabled | Disabled]
Maximum Connections: [Number]
```

**Example - User Database:**
- **Authentication**: Username/password with rotation policy
- **Encryption**: TLS 1.3 for connections, AES-256 for data at rest
- **Network**: Private network only, no public access
- **Connection Pool**: Maximum 20 connections, 5-minute timeout

**Data Protection:**

```
Encryption at Rest: [Enabled | Disabled]
Encryption Algorithm: [AES-256 | AES-128 | Custom]
Key Management: [Cloud KMS | HSM | File-based | Application-managed]
Backup Encryption: [Enabled | Disabled]
```

**Audit and Monitoring:**

```
Query Logging: [All | DDL only | Failed attempts | Disabled]
Access Logging: [Enabled | Disabled]
Performance Monitoring: [Enabled | Disabled]
Alert Thresholds: [Custom settings]
```

#### Database-Specific Configurations

**PostgreSQL Security:**
- **SSL Mode**: `require` or `verify-full`
- **Row Level Security**: Enable for multi-tenant applications
- **Connection Limits**: Set `max_connections` appropriately
- **Logging**: Enable `log_statement = 'all'` for audit requirements

**MongoDB Security:**
- **Authentication**: Enable `--auth` flag
- **Authorization**: Use role-based access control
- **Network Binding**: Bind to specific interfaces, not `0.0.0.0`
- **Journaling**: Enable for data durability

### File Systems

File system components handle document storage, uploads, and file processing.

#### Basic Configuration

**Storage Properties:**
- **Storage Type**: Local file system, NFS, cloud storage
- **Access Method**: Direct access, API-based, mounted
- **Capacity**: Storage limits and quotas
- **Retention Policy**: Data lifecycle management

#### Security Configuration

**Access Control:**

```
File Permissions: [Restrictive (644/755) | Standard (664/775) | Permissive]
Directory Structure: [Controlled | Open]
User Access: [Service account only | Multiple users | Public]
Encryption: [File-level | Directory-level | Volume-level | None]
```

**File Upload Security:**

```
File Type Restrictions: [Whitelist | Blacklist | None]
File Size Limits: [MB per file]
Virus Scanning: [Enabled | Disabled]
Content Inspection: [Deep scan | Basic | None]
Upload Quarantine: [Enabled | Disabled]
```

### Caches and Session Stores

Cache components improve performance but can expose sensitive data if misconfigured.

#### Basic Configuration

**Cache Properties:**
- **Cache Type**: Redis, Memcached, in-memory, distributed
- **Cache Size**: Memory allocation limits
- **Eviction Policy**: LRU, LFU, TTL-based
- **Persistence**: Disk backup, cluster replication

#### Security Configuration

**Data Protection:**

```
Encryption in Transit: [TLS | None]
Encryption at Rest: [Enabled | Disabled]
Authentication: [Password | Certificate | None]
Network Binding: [Localhost | Private network | Public]
```

**Cache Security:**

```
Data Classification: [Sensitive | Non-sensitive | Mixed]
TTL Settings: [Short-lived | Standard | Long-lived]
Key Naming Strategy: [Predictable | Random | Hashed]
Access Patterns: [Read-heavy | Write-heavy | Balanced]
```

## External Entity Configuration

### User Entities

User entities represent different types of users accessing your system.

#### User Types

**End Users (Customers):**
- **Trust Level**: Untrusted
- **Access Method**: Web interface, mobile app
- **Authentication**: Standard login, social login, guest access
- **Data Access**: Personal data only

**Internal Users (Employees):**
- **Trust Level**: Trusted (with verification)
- **Access Method**: Internal systems, VPN
- **Authentication**: Corporate SSO, multi-factor authentication
- **Data Access**: Role-based access to business data

**Administrators:**
- **Trust Level**: Highly trusted
- **Access Method**: Secure administrative interfaces
- **Authentication**: Strong MFA, privileged access management
- **Data Access**: System-wide access with audit logging

**Service Accounts:**
- **Trust Level**: System-level trust
- **Access Method**: API keys, certificates
- **Authentication**: Non-interactive authentication
- **Data Access**: Specific service permissions

### Third-Party Services

External service entities represent integrations with external systems.

#### Service Configuration

**Service Properties:**
- **Provider**: Company/organization name
- **Service Type**: SaaS, API, data feed, infrastructure
- **Contract Type**: Paid subscription, free tier, partnership
- **Data Sharing Agreement**: Specific terms and conditions

**Security Assessment:**

```
Security Certification: [SOC 2 | ISO 27001 | PCI DSS | Custom]
Data Location: [US | EU | Global | Unknown]
Encryption Standards: [Industry standard | Basic | Unknown]
Incident Response: [24/7 | Business hours | Limited]
```

**Example - Payment Gateway:**
- **Provider**: Stripe, PayPal, Square
- **Certification**: PCI DSS Level 1
- **Data Location**: US and EU (data residency compliance)
- **SLA**: 99.9% uptime, 24/7 support

## Best Practices by Component Type

### Web Applications
1. **Always use HTTPS** in production environments
2. **Implement input validation** for all user inputs
3. **Use security headers** to prevent common web attacks
4. **Enable proper session management** with secure cookies
5. **Implement rate limiting** to prevent abuse

### Databases
1. **Use encrypted connections** (TLS 1.2+) for all database communications
2. **Enable encryption at rest** for sensitive data
3. **Implement proper backup encryption** and secure storage
4. **Use connection pooling** to manage database resources
5. **Enable audit logging** for compliance requirements

### APIs
1. **Implement proper authentication and authorization** for all endpoints
2. **Use API gateways** for centralized security controls
3. **Validate all input data** against defined schemas
4. **Implement rate limiting** per client/user
5. **Log all API access** for monitoring and auditing

### File Storage
1. **Restrict file types** to only necessary formats
2. **Implement virus scanning** for all uploads
3. **Use appropriate file permissions** (principle of least privilege)
4. **Enable file integrity monitoring** for critical files
5. **Implement secure deletion** for sensitive files

### Caches
1. **Encrypt sensitive cached data** in transit and at rest
2. **Use appropriate TTL values** to minimize data exposure
3. **Implement cache invalidation** strategies
4. **Monitor cache hit rates** and performance
5. **Secure cache network access** (private networks only)

## Data Item Management

### Understanding Data Items

Data items represent the specific types of data that flow through, are processed by, or are stored within your system. Unlike components, which represent system elements, data items represent the information assets that need protection.

A data item belongs to the model, and you attach it to any element that handles it:
- **Processes**: Data processed, transformed, or validated
- **External Entities**: Data sent to or received from external parties
- **Data Stores**: Data persisted, cached, or archived
- **Security Boundaries**: Data associated with the boundary as a whole
- **Data Flows**: Data transmitted between components

Because a data item is one object in the model, the same item can be attached to many elements, and an edit to it shows everywhere it is attached.

### Creating a Data Item

1. **Open the element's settings**: Double-click a component, boundary, or data flow on the canvas
2. **Open the Data tab**: Click the **Data** tab in the settings panel
3. **Add a data item**: Click the **+** button to the right of the search bar
4. **Fill in the Data dialog**: It opens with three tabs — **General**, **Attributes**, and **Exposures**

**General tab:**
- **Name**: Descriptive name for the data type (e.g., "Customer Payment Information", "User Authentication Tokens")
- **Description**: What the data is and what it is used for
- **Sensitivity, Regulatory flags, Origin, Credential**: Classification context — see [Classifying Data Items](#classifying-data-items)
- **Class**: The data class this item is an instance of, picked with the class picker in the right-hand column

**Choosing the class:**

A data item takes a single **data class**, picked from the catalogue your installed modules provide. The shipped **Dethernety General** module provides these:

```
Available Classes:
├── Authentication Tokens
├── Customer & Personal Data
├── Security Logs
├── System Configuration
├── User Credentials
└── User Input
```

Search, browse, and confirmation work the same as for every other element — see [How an Element Gets Its Class](#how-an-element-gets-its-class). If none of the available classes describes your data, the class you need has to come from a module: see [Understanding Modules](UNDERSTANDING_MODULES.md).

### Configuring Data Attributes and Exposures

Once the data item has a class, the **Attributes** tab shows that class's configuration form. The attributes come from the class, so they differ from class to class. For example, the **Customer & Personal Data** class asks, among others:

```
Encrypted At Rest: [Yes | No | Not answered]
At-Rest Encryption Strength: [none | weak | strong]
Backups Encrypted: [Yes | No | Not answered]
Field-Level Protection Method: [none | truncation | one_way_hash | tokenization | field_level_encryption | pseudonymization]
Retention Schedule Enforced: [Yes | No | Not answered]
Secure Deletion Or Crypto-Shred: [Yes | No | Not answered]
```

When you save the attributes, the class's OPA/Rego policies evaluate them, and the resulting exposures appear on the dialog's **Exposures** tab — the same mechanism as for components (see [Understanding Security Exposures](#understanding-security-exposures)). Two policies from the **Customer & Personal Data** class, shortened:

```rego
# Unencrypted PII at rest
_unencrypted_pii_at_rest_def := {
    "name": "Unencrypted PII at rest",
    "criticality": "high",
    "exploited_by": [
        {"label": "MitreAttackTechnique", "property": "attack_id", "value": "T1005"}  # Data from Local System
    ]
}

unencrypted_pii_at_rest[_unencrypted_pii_at_rest_def] if {
    not input.encrypted_at_rest
}

unencrypted_pii_at_rest[_unencrypted_pii_at_rest_def] if {
    input.at_rest_encryption_strength in ["none", "weak"]
}

exposures contains _unencrypted_pii_at_rest_def if {
    count(unencrypted_pii_at_rest) > 0
}

# Indefinite retention and unsafe deletion
_indefinite_retention_and_unsafe_deletion_def := {
    "name": "Indefinite retention and unsafe deletion",
    "criticality": "medium",
    "exploited_by": []
}

indefinite_retention_and_unsafe_deletion[_indefinite_retention_and_unsafe_deletion_def] if {
    not input.retention_schedule_enforced
}

indefinite_retention_and_unsafe_deletion[_indefinite_retention_and_unsafe_deletion_def] if {
    input.soft_delete_leaves_recoverable_pii == true
}

exposures contains _indefinite_retention_and_unsafe_deletion_def if {
    count(indefinite_retention_and_unsafe_deletion) > 0
}
```

A policy reads only the attributes of the data item it belongs to. Attaching the item to an element does not change that element's exposures, and the element's policies do not read the data item's attributes.

### The Data Tab

The **Data** tab lists the model's data items in a table:

| Column | What it shows |
|--------|---------------|
| **Checkbox** | Whether the data item is attached to the current element |
| **Name** | The data item's name |
| **Description** | The data item's description |
| **Class** | The assigned data class, as a chip |
| *(actions)* | An issue button, **Edit** (pencil), and **Delete** (trash can) |

**Searching:** Type in the **Search** field to filter the table. It matches the data item's name, description, and class name, ignoring case, and updates as you type.

**Choosing which data items to list:** The toggle next to the search field switches between three views:

| View | Shows |
|------|-------|
| **All** | Every data item in the model |
| **Related** (default) | Data items attached to this element, plus those on the elements directly connected to it — for a component, the data flows that arrive at or leave it; for a data flow, its source and target |
| **Own** | Only the data items attached to this element |

### Attaching and Detaching Data Items

- **Attach**: Check a data item's box. The attachment is saved immediately.
- **Detach**: Clear the box. A confirmation asks *Remove data item '…' from this element?* — confirm, and the data item stays in the model but is no longer attached to this element.

Switch the view to **All** to attach a data item that is not yet on this element or its neighbours.

### Editing and Deleting Data Items

- **Edit**: Click the pencil icon in the data item's row to reopen the Data dialog. Changes to name, description, class, or attributes apply everywhere the data item is attached.
- **Delete**: Click the trash-can icon. A confirmation asks *Are you sure you want to delete this Data Item: …?* — confirm, and the data item is removed from the model and from every element it was attached to.

**Important**: Deleting a data item affects every element that uses it. If you only want it off the current element, detach it instead.

### Where Data Items Show Up in Analysis

Attaching data items records which elements handle which data. The [Threat Report](threat-report/README.md) reads this: an element's profile lists the **data handled** by that element, with each item's sensitivity and its own exposure counts — see [Working with Findings](threat-report/WORKING_WITH_FINDINGS.md). Keep attachments accurate so that view reflects how your system actually handles its data.

### Best Practices for Data Item Management

**Classification:**
1. **Set sensitivity and regulatory flags** on every data item — see [Classifying Data Items](#classifying-data-items)
2. **Use consistent terminology**: Keep one classification scheme across your models, and prefer the suggested regulatory flag labels
3. **Review periodically**: Reassess classifications as the system changes

**Attachment:**
1. **Full coverage**: Attach every relevant data item to the elements that handle it
2. **Accuracy**: Attachments should reflect how data is actually handled
3. **Flow consistency**: Data on a component should match the data on the flows that reach it — the **Related** view helps you check

**Attributes:**
1. **Answer the class's attributes**: Unanswered attributes can raise exposures, so fill in what you know — see [Answering Yes-or-No Attributes](#answering-yes-or-no-attributes)
2. **Least privilege and defence in depth**: Record the access restrictions and layered protections that actually apply to sensitive data

---

**Next Steps:**
- **[Security Analysis Workflow](SECURITY_ANALYSIS_WORKFLOW.md)**: Analyze your configured components
- **[Working with Security Controls](WORKING_WITH_SECURITY_CONTROLS.md)**: Implement protective measures
- **[Understanding Modules](UNDERSTANDING_MODULES.md)**: Learn about Data Classes and policy evaluation
