---
title: 'Building Your First Model'
description: 'Step-by-step tutorial for creating a complete threat model of a web application.'
category: 'modeling'
position: 5
navigation: true
tags: ['intermediate', 'tutorial', 'detailed', 'modeling', 'components', 'data-flows', 'boundaries', 'web-app', 'practical']
---

# Building Your First Model

*Step-by-step tutorial for creating a complete threat model of a web application.*

## Planning Your Model

### Define Your Scope

Before building your model, clearly define what you're analyzing:

**Example: E-commerce Web Application**
- **Purpose**: Online store for selling products
- **Users**: Customers, administrators, support staff
- **Data**: Product catalog, customer information, payment data, orders
- **Infrastructure**: Web servers, databases, payment gateway integration

### Gather Information

Collect these details about your system:
- **Architecture diagrams**: High-level system overview
- **Data flow documentation**: How information moves through the system
- **Technology stack**: Programming languages, frameworks, databases
- **Deployment environment**: Cloud, on-premises, hybrid
- **Security controls**: Existing authentication, encryption, monitoring

### Set Objectives

Define what you want to achieve:
- **Compliance**: Meet PCI DSS requirements for payment processing
- **Risk assessment**: Identify critical vulnerabilities before go-live
- **Security roadmap**: Prioritize security improvements
- **Team education**: Help developers understand security implications

## Setting Up the Model Structure

### Create Your Model

1. **Open the Browser** and select the folder you want the model to live in. New models are created in the folder you have selected.
2. **Create the model.** Click the **+** button at the top right of the content area and choose the diagram icon from the speed dial — or click the **New model** card in the **Models** row. A model named *New Model* is created immediately and its settings dialog opens on the **General** tab.
3. **Name and describe it.** Replace the placeholder name and description:
   ```
   Name: "E-commerce Platform Security Model"
   Description: "Comprehensive threat model covering web application, admin panel, and payment processing with PCI DSS compliance"
   ```
4. **Record your compliance drivers** (optional). In the **Compliance drivers** field, pick a recommended framework such as `PCI-DSS` or type your own and press Enter. Each one is added as a chip.
5. **Open the data flow editor.** Click the diagram button at the bottom right of the dialog. It saves your changes first, then takes you to the canvas. To save without leaving the dialog, use the green save button in the row of buttons on the left.

There is no module step here. The classes you will pick for boundaries, components, and data flows come from the modules installed on the deployment, and are the same in every model — see [Where the classes you can pick come from](UNDERSTANDING_MODULES.md#where-the-classes-you-can-pick-come-from).

### Set Up Security Boundaries

Security boundaries help organize your model and define trust zones:

1. **Internet Boundary** (Default boundary - already created)
   - Contains all internet-facing components
   - Highest risk zone

2. **Create DMZ Boundary**:
   - **Drag boundary**: From the component palette on the right, drag **Boundary** onto the canvas
   - **Configure**: Double-click to open settings dialog
   - **Basic properties**: Name "DMZ Zone" and add description "Demilitarized zone containing public-facing services"
   - **Class assignment**: Select an appropriate boundary class from loaded modules
   - **Configure attributes** (after class assignment): Set security zone properties

3. **Create Internal Network Boundary**:
   - **Drag boundary**: Add another **Boundary** from the palette
   - **Configure**: Name "Internal Network", description "Private network containing application servers and databases"
   - **Class assignment**: Select internal network boundary class
   - **Position**: Below the DMZ boundary

4. **Create Database Boundary (Nested)**:
   - **Drag boundary**: Add another **Boundary** from the palette
   - **Drop into parent**: Drag and drop this boundary **inside** the Internal Network boundary to create nesting
   - **Configure**: Name "Database Zone", description "Secure zone for database servers"
   - **Class assignment**: Select database zone boundary class

**Your boundary structure should look like:**

```
Internet Boundary (Default)
├── DMZ Zone
│   └── [Public-facing services]
└── Internal Network
    ├── [Application servers]
    └── Database Zone
        └── [Database servers]
```

> **Next: classify these boundaries.** Once your boundaries exist, place each one on a trust gradient and declare which boundaries are meant to communicate. See [Boundary Trust Zones](BOUNDARY_TRUST_ZONES.md) for setting a boundary's trust zone, business domains, role, and approved channels.

## Adding System Components

**Component Placement Options:**
- **Direct placement**: Drag components from the palette and drop into the desired boundary
- **Move existing components**: Drag existing components on the canvas and drop into a different boundary to reassign them
- **Remove from boundary**: Drag components or child boundaries **outside** their current boundary to remove them from that boundary
- **Reassign between boundaries**: Drag components from one boundary and drop into another boundary to move them

**Component Configuration Types:**
- **Class Assignment**: Components inherit behavior from module-provided classes
- **Model Reference**: Components represent and reference other existing models in the system
- **Switching Types**: Changing from class to model reference (or vice versa) will clear all settings, attributes, and exposures

**Model Reference Workflow:**
1. **Toggle to model mode**: In component settings, toggle "Represents a Model" 
2. **Select model**: Click the magnifier button next to "Represented Model" field
3. **Browse models**: Use the dialog with folders (left) and models (right) to select
4. **Reference established**: Component now represents the selected model instead of a class

### Web Servers

**1. Public Web Server (in DMZ Zone)**:
- **Add to boundary**: Drag "Process" component from the right palette and **drop it directly into the DMZ boundary** (the component will automatically belong to that boundary)
- **Name**: "Public Web Server"
- **Description**: "Frontend web server handling customer requests"
- **Configuration Type**: Choose between:
  - **Class Assignment**: Select a web server class from loaded modules (e.g., "nginx Web Server")
  - **Model Reference**: Toggle to "Represents a Model", click magnifier button, select existing web server model from dialog
- **Configuration** (after class assignment or model selection):
  - **Technology**: nginx + Node.js
  - **Ports**: 80 (HTTP), 443 (HTTPS)
  - **Authentication**: Session-based
  - **Input Sources**: Internet users
  - **Functions**: Serve web pages, handle user requests
- **Exposures**: View automatically calculated exposures in the settings panel

**2. Admin Web Server (in DMZ Zone)**:
- Add another Process component
- **Name**: "Admin Panel Server"
- **Description**: "Administrative interface for managing the system"
- **Class Assignment**: Select an admin web server class from the modules
- **Configuration** (after class assignment):
  - **Technology**: React + Express.js
  - **Ports**: 443 (HTTPS only)
  - **Authentication**: Multi-factor authentication
  - **Functions**: Admin interface, content management
- **Exposures**: Review calculated exposures specific to admin interfaces

### Application Services

**3. API Server (in Internal Network)**:
- **Add to boundary**: Drag "Process" component from the palette and **drop into the Internal Network boundary**
- **Name**: "API Server"
- **Description**: "Backend API handling business logic"
- **Class Assignment**: Select an API server class from the modules
- **Configuration** (after class assignment):
  - **Technology**: Node.js with Express
  - **Ports**: 3000 (internal)
  - **Authentication**: JWT tokens
  - **Functions**: Business logic, API endpoints

**4. Payment Service (in Internal Network)**:
- Add another Process component
- **Name**: "Payment Processing Service"
- **Description**: "Service handling payment transactions"
- **Class Assignment**: Select a payment service class from the modules
- **Configuration** (after class assignment):
  - **Technology**: Microservice (Docker)
  - **Ports**: 8080 (internal)
  - **Functions**: Process payments, manage transactions
  - **Compliance**: PCI DSS Level 1

### Data Stores

**5. User Database (in Database Zone)**:
- Drag "Data Store" component into Database Zone
- **Name**: "User Database"
- **Description**: "Primary database storing user information"
- **Class Assignment**: Select a PostgreSQL database class from the modules
- **Configuration** (after class assignment):
  - **Technology**: PostgreSQL
  - **Ports**: 5432 (internal only)
  - **Encryption**: TLS in transit, AES-256 at rest
  - **Data**: User accounts, profiles, preferences

**6. Product Catalog Database (in Database Zone)**:
- Add another Data Store component
- **Name**: "Product Catalog DB"
- **Description**: "Database containing product information"
- **Class Assignment**: Select a PostgreSQL database class
- **Configuration** (after class assignment):
  - **Technology**: PostgreSQL (read replica)
  - **Data**: Product information, inventory, pricing

**7. Session Store (in Internal Network)**:
- Add "Data Store" component
- **Name**: "Redis Session Store"
- **Description**: "Cache for session management"
- **Class Assignment**: Select a Redis cache class from the modules
- **Configuration** (after class assignment):
  - **Technology**: Redis
  - **Purpose**: Session management, caching
  - **Retention**: 24 hours

### External Entities

**8. Customer (External)**:
- Drag "External Entity" outside all boundaries
- **Name**: "Customer"
- **Type**: External Entity
- **Description**: "End users shopping on the website"
- **Trust Level**: Untrusted

**9. Administrator (External)**:
- Add another External Entity
- **Name**: "Administrator"
- **Type**: External Entity
- **Description**: "Internal staff managing the system"
- **Trust Level**: Trusted (authenticated)

**10. Payment Gateway (External)**:
- Add External Entity
- **Name**: "Payment Gateway (Stripe)"
- **Type**: External Entity
- **Description**: "Third-party payment processor"
- **Trust Level**: Trusted partner

## Defining Data Flows

Now connect your components with data flows to show how information moves through the system:

### Customer Interactions

**1. Customer → Public Web Server**:
- **Create connection**: Drag from a connection point on the Customer entity to a connection point on the Public Web Server
- **Configure data flow**: Double-click the created arrow to open settings
- **Basic properties**: Name "Web Requests", describe customer interactions
- **Class assignment**: Select a web request data flow class from modules
- **Configure attributes** (after class assignment):
  - **Protocol**: HTTPS
  - **Data Types**: HTTP requests, form data
  - **Authentication**: Optional (login)
  - **Direction**: Bi-directional
- **View exposures**: Check automatically calculated security exposures

**2. Customer → Admin Panel Server**:
- **Create connection**: Drag from Customer to Admin Panel Server connection points
- **Configure data flow**: Double-click arrow and set basic properties
- **Class assignment**: Select admin access data flow class
- **Configure attributes**:
  - **Protocol**: HTTPS
  - **Data Types**: Admin commands, configuration
  - **Authentication**: Required (MFA)
- **Note**: Only for administrators

### Internal Service Communication

**3. Public Web Server → API Server**:
- **Create connection**: Drag between connection points on Web Server and API Server
- **Configure**: Double-click arrow, set name "API Calls" and description  
- **Class assignment**: Select API communication data flow class
- **Configure attributes**:
  - **Protocol**: HTTP (internal network)
  - **Data Types**: JSON API requests/responses
  - **Authentication**: JWT tokens

**4. Admin Panel Server → API Server**:
- **Create connection**: Drag between Admin Panel and API Server connection points
- **Configure**: Name "Admin API Calls" with appropriate description
- **Class assignment**: Select admin API data flow class  
- **Configure attributes**:
  - **Protocol**: HTTP (internal)
  - **Data Types**: Admin operations, bulk updates
  - **Authentication**: Admin JWT tokens

### Database Access

**5. API Server → User Database**:
- **Create connection**: Drag between API Server and User Database connection points
- **Configure**: Name "User Data Queries" with detailed description
- **Class assignment**: Select database query data flow class
- **Configure attributes**:
  - **Protocol**: PostgreSQL (TLS)
  - **Data Types**: User accounts, profiles, authentication
  - **Authentication**: Database credentials (connection pooling)

**6. API Server → Product Catalog DB**:
- **Create connection**: Drag between API Server and Product Catalog connection points
- **Configure**: Name "Product Queries"
- **Class assignment**: Select product data query class
- **Configure attributes**:
  - **Protocol**: PostgreSQL (TLS)
  - **Data Types**: Product information, inventory
  - **Access**: Read-heavy operations

**7. API Server → Redis Session Store**:
- **Create connection**: Drag between API Server and Redis connection points
- **Configure**: Name "Session Management"
- **Class assignment**: Select cache communication class
- **Configure attributes**:
  - **Protocol**: Redis protocol (TLS)
  - **Data Types**: Session tokens, cache data
  - **TTL**: 24 hours

### Payment Processing

**8. API Server → Payment Service**:
- **Create connection**: Drag between API Server and Payment Service connection points
- **Configure**: Name "Payment Requests"
- **Class assignment**: Select internal service communication class
- **Configure attributes**:
  - **Protocol**: Internal HTTP (TLS)
  - **Data Types**: Payment details, transaction data
  - **Security**: Sensitive financial data

**9. Payment Service → Payment Gateway**:
- **Create connection**: Drag between Payment Service and Payment Gateway connection points
- **Configure**: Name "Payment Gateway API"
- **Class assignment**: Select external API communication class
- **Configure attributes**:
  - **Protocol**: HTTPS
- **Data Types**: Credit card data, transaction results
- **Authentication**: API keys
- **Compliance**: PCI DSS

## Running Security Analysis

Analysis is provided entirely by **modules** — the core platform runs none of its own. What you can run depends on which modules your deployment has installed.

**On a stock OSS install there is exactly one analysis type: Threat Report.** It is a read-only posture snapshot over your existing model — a set of graph queries, not an AI run. It asks no questions, streams no reasoning, and adds nothing to your model. The `dethernety-general` module contributes no analysis type at all; its policies derive exposures continuously on each element's **Exposures** tab, which is a different mechanism. Additional modules add specialized types — compliance checks, framework-specific assessments, AI-assisted evaluation — and anything below describing AI behavior applies only when such a module is installed.

This section gets you through a first run. [Security Analysis Workflow](SECURITY_ANALYSIS_WORKFLOW.md) is the full treatment.

### Starting an Analysis

1. **Open the Analyses dialog.** Open your model in the data flow editor (click its tile in the Browser), then click the **sparkle** button on the canvas toolbar — its tooltip reads **Analyses**.
2. **Click "New Analysis".** This button *is* the type menu: it opens a list with **one entry per analysis type** your installed modules provide. On a stock OSS install that is a single entry, *Threat Report*.
3. **Click the type you want.** The analysis is created immediately and appears as a new row.
4. **Click "Run"** in that row to start it.

**You are never asked for a name or a description.** The new analysis takes the analysis type's own name for both — a Threat Report analysis is called *Threat Report*. Renaming is a separate, later step: click the **Name** cell and type over it (Enter or click away to save), or use the row's **⋮** menu and choose **Rename** or **Edit description**.

Do it early. Give the run a name that says what it was for — *Pre-release review, March* — before you accumulate five rows all called *Threat Report*.

### Monitoring Analysis Progress

Each row shows a **phase**, and the row's single primary button follows it: **Run** when it is ready, **View progress** while it is working, **Answer** when it is paused on a question, **View results** when it is done, **Retry** when it has failed. The full table is in [Watching a run](SECURITY_ANALYSIS_WORKFLOW.md#watching-a-run).

**Progress and questions are module capabilities, not platform ones.** **View progress** opens the **Analysis Flow** dialog, which lists the messages the running module streams back — for an AI module that is its reasoning trail; for a module that streams nothing, it reads *Waiting for analysis responses...*. If a module pauses a run to ask you something, the row goes to **Paused** and answering the question resumes it.

Neither surface does anything for the OSS **Threat Report** analysis, which runs to completion without streaming messages or asking questions.

### Viewing Results

1. **Wait for completion**: the row's phase reads **Done** when the run has finished and produced a result
2. **Open results**: Click **View results** — the row's primary button on a **Done** analysis. The results open on their own page, rendered by the module that produced them
3. **Review findings**: Examine security assessment results

Result format and content depend on the module that ran the analysis. Each row holds its own result, so several analyses on one model can be compared side by side — but **Re-run** re-runs *that* analysis and replaces its result. To keep a result for comparison, create a new analysis instead of re-running the old one.

### Example Analysis Results

The findings below illustrate what an analysis module *can* surface, on the example model built earlier in this guide. They are not the output of any particular module — a module that ships severity-ranked findings with MITRE references would report something in this shape.

**Critical: Unencrypted Payment Data**
- **Component**: Payment Service → Payment Gateway
- **Issue**: Credit card data transmitted without end-to-end encryption
- **Impact**: PCI DSS violation, potential data breach
- **Recommendation**: Implement field-level encryption for sensitive payment data
- **MITRE**: T1040 (Network Sniffing)

**High: Missing Input Validation**
- **Component**: Public Web Server
- **Issue**: User inputs not properly sanitized
- **Impact**: SQL injection, XSS attacks possible
- **Recommendation**: Implement input validation and sanitization across all user-facing endpoints
- **MITRE**: T1190 (Exploit Public-Facing Application)

**High: Database Direct Access**
- **Component**: API Server → User Database
- **Issue**: API server has direct database access without connection limits
- **Impact**: Database overload, potential data exposure
- **Recommendation**: Implement database connection pooling and access controls
- **MITRE**: T1005 (Data from Local System)

## Managing Issues from Analysis Results

An **issue** is a unit of tracked work in Dethernety. Turning a finding into one gives it an owner, a severity, and a place on a board that survives the next analysis run.

This section covers just enough to raise your first issue. [Issue Management Guide](ISSUE_MANAGEMENT_GUIDE.md) is the full treatment — filtering and query syntax, merging, the issue card's tabs, and what each creation path links.

### Raising an issue from a finding

1. **Open the results.** Click **View results** in the analysis row.
2. **Trigger the issue action** on the finding you want to track.
3. A dialog opens, titled **Raise an issue from this finding**, naming the finding underneath. Under *Or create an issue:*, **click an issue class**.
4. The issue is created immediately and its card opens. It is pre-named *`<Finding> Issue on <element>`* and pre-described from the finding's own description.

**You pick a class, not a type from a dropdown.** The dialog shows one button per issue class your installed modules provide. The OSS `dethernety-general` module ships six — Architecture anti-pattern, Configuration Error, Missing Security Control, Threat Vector, Vulnerability, and Other — and a deployment with more modules installed will offer more. See [Where issue classes come from](ISSUE_MANAGEMENT_GUIDE.md#where-issue-classes-come-from).

**What gets linked:** the finding, the element it was raised on, and the model. **Not the analysis run** — nothing records which analysis produced the finding. If you need that traceability, add the analysis by hand from the issue's **Associated Elements** tab. The full table is in [What actually gets associated](ISSUE_MANAGEMENT_GUIDE.md#what-actually-gets-associated).

### Filling in the issue

The issue card has four tabs. For a first issue, two of them matter:

- **General** — rename it to something you'll recognize later, and expand the description.
- **Attributes** — fill in the fields **the issue's class defines**. There is no fixed set: a Vulnerability carries severity, status, CVE id, CVSS score, affected component, and remediation steps; a Threat Vector carries a different set. Every shipped class defines a **severity** and a **status**.

> **Two things are called "status."** The **Close Issue** / **Open Issue** button controls the platform's own open/closed flag. The `status` attribute on the **Attributes** tab is module-defined and moves through the class's own values (`confirmed`, `mitigating`, `verified`, …). Setting one does not change the other — see [Status: two different things](ISSUE_MANAGEMENT_GUIDE.md#status-two-different-things).

### Adding a second finding to the same issue

Related findings usually belong on one issue. The same dialog's **Add to Issue board** button copies the finding to Dethernety's clipboard and sends you to the Issues page:

1. Click **Add to Issue board**. You land on the Issues page.
2. Find the target issue and click its row to expand the card.
3. Click **Add from clipboard**. The elements are linked and a timestamped comment records what was added.
4. Click **Return to `<page>`** to go back where you started.

**The clipboard holds one item.** Copying a second finding overwrites the first, so build a multi-finding issue by repeating the loop — copy, paste, return, copy the next — rather than copying several and pasting once. It also expires after 30 minutes. See [Adding elements to an existing issue](ISSUE_MANAGEMENT_GUIDE.md#adding-elements-to-an-existing-issue).

### Issues stay in Dethernety

Issues are created, tracked, and closed entirely on the platform. **No integration module ships with Dethernety**, so nothing you do here reaches Jira, ServiceNow, GitHub, or any other tracker. The platform provides one seam a module could implement — an inbound-only, pull-on-read hook that reads an issue's attributes from an external system — and no shipped module implements it. See [External system integration](ISSUE_MANAGEMENT_GUIDE.md#external-system-integration).

## Reviewing and Acting on Results

### Prioritize Issues

**Immediate Action Required (Critical)**:
1. Fix payment data encryption
2. Implement PCI DSS compliance measures

**Short-term (High Priority)**:
1. Add input validation framework
2. Configure database security
3. Implement rate limiting
4. Add security headers

**Medium-term (Medium Priority)**:
1. Enhance logging and monitoring
2. Implement security scanning
3. Add backup and recovery procedures

### Document Decisions

For each finding, document your decision:
- **Accept**: Risk is acceptable, document reasoning
- **Mitigate**: Implement recommended controls
- **Transfer**: Use insurance or third-party solutions
- **Avoid**: Change architecture to eliminate risk

### Create Action Items

Convert findings into actionable tasks:

**Example Action Items**:
1. **Implement Field-Level Encryption**
   - **Owner**: Backend team
   - **Timeline**: 2 weeks
   - **Acceptance Criteria**: All payment data encrypted before transmission

2. **Add Input Validation Middleware**
   - **Owner**: Full-stack team
   - **Timeline**: 1 week
   - **Acceptance Criteria**: All user inputs validated and sanitized

3. **Configure Database Connection Pooling**
   - **Owner**: DevOps team
   - **Timeline**: 3 days
   - **Acceptance Criteria**: Maximum 20 concurrent connections, timeout handling

## Exporting and Importing Models

Once your model is built, you can export it as a portable ZIP archive for backup, sharing, or version control. You can also import models that were previously exported.

### Exporting a Model

1. **Open the model dialog**: Right-click your model in Browser, or click the **"Model settings"** button on the data flow editor's canvas toolbar
2. **Click "Export"**: The export button downloads a ZIP archive containing your complete model
3. **File is saved**: The browser downloads `{model-name}-export.zip` automatically

The ZIP archive contains individual JSON files using a split-file format:

```
model-name-export.zip
├── manifest.json        # Model metadata and module references
├── structure.json       # Boundary and component hierarchy
├── dataflows.json       # Data flow connections
├── data-items.json      # Data classification items
└── attributes/          # Per-element configuration files
    ├── boundaries/
    │   └── {id}.json
    ├── components/
    │   └── {id}.json
    ├── dataFlows/
    │   └── {id}.json
    └── dataItems/
        └── {id}.json
```

This format is the same split-file structure used by the [Dethereal Claude Code plugin](dethereal/README.md), so exported models can also be used with AI-assisted workflows.

### Importing a Model

1. **Open the import dialog**: From Browser, use the import option in the menu
2. **Select a ZIP file**: Click "Select File" and choose a `.zip` archive
3. **Click "Import"**: The import process runs through 8 steps with a progress bar showing each step
4. **Review results**: A success message confirms the import; the model appears in your folder immediately

If the import encounters non-critical issues, warnings are displayed alongside the success message. Critical errors are shown in red and the import is aborted.

### Use Cases

- **Backup**: Export before making major changes to your model
- **Sharing**: Send a ZIP to colleagues who can import it into their own instance
- **Version control**: Store exported ZIPs alongside your source code
- **AI enrichment**: Export, enrich with the [Dethereal plugin](dethereal/DISCOVERY_AND_ENRICHMENT.md), then re-import

---

You now have a working threat model with components, data flows, boundaries, analysis results, and tracked issues.

**Next Steps**:
- **[Boundary Trust Zones](BOUNDARY_TRUST_ZONES.md)**: Place each boundary on a trust gradient and declare approved channels
- **[Security Analysis Workflow](SECURITY_ANALYSIS_WORKFLOW.md)**: Advanced analysis techniques
- **[Working with Security Controls](WORKING_WITH_SECURITY_CONTROLS.md)**: Implementing countermeasures
- **[Issue Management Guide](ISSUE_MANAGEMENT_GUIDE.md)**: Track and manage findings with your team
- **[Dethereal Plugin](dethereal/README.md)**: AI-assisted threat modeling with the Claude Code plugin