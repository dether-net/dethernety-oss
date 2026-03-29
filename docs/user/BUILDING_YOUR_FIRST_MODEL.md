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

**Quick Setup:**

1. **Browser** → **Menu** → **"Create Model"**
2. **Configure Model**:
   ```
   Name: "E-commerce Platform Security Model"
   Description: "Comprehensive threat model covering web application, admin panel, and payment processing with PCI DSS compliance"
   ```
3. **Assign modules** if available (web application, database, payment processing)
4. **Click "Open Data Flow Editor"** to start building immediately

### Set Up Security Boundaries

Security boundaries help organize your model and define trust zones:

1. **Internet Boundary** (Default boundary - already created)
   - Contains all internet-facing components
   - Highest risk zone

2. **Create DMZ Boundary**:
   - **Drag boundary**: From the component palette on the right, drag a "Security Boundary" onto the canvas
   - **Configure**: Double-click to open settings dialog
   - **Basic properties**: Name "DMZ Zone" and add description "Demilitarized zone containing public-facing services"
   - **Class assignment**: Select an appropriate boundary class from loaded modules
   - **Configure attributes** (after class assignment): Set security zone properties

3. **Create Internal Network Boundary**:
   - **Drag boundary**: Add another Security Boundary from the palette
   - **Configure**: Name "Internal Network", description "Private network containing application servers and databases"
   - **Class assignment**: Select internal network boundary class
   - **Position**: Below the DMZ boundary

4. **Create Database Boundary (Nested)**:
   - **Drag boundary**: Add another Security Boundary from the palette
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

Analyses provide AI-powered security assessment of your threat models. Analysis capabilities are provided by modules and only available if analysis modules are loaded to the system.

### Starting an Analysis

1. **Access Analysis Tab**:
   - Right-click your model in Browser to open model dialog, OR
   - Click model name (top left) in data flow editor to open model dialog
   - Click **"Analysis"** tab in the model dialog

2. **Create Analysis Instance**:
   - **Select analysis type**: Choose from dropdown button (different types provided by loaded modules)
   - **Add instance**: New analysis instance (run) appears in analyses table
   - **Configure parameters**: Edit analysis details in the table:
     - **Name**: "Initial Security Assessment"
     - **Description**: "Comprehensive threat analysis of e-commerce platform"

3. **Start Analysis**:
   - Click the **creation icon** (star icon) in the analysis instance row
   - Analysis begins processing your threat model

### Monitoring Analysis Progress

**Analysis Flow Dialog**:
- **Real-time updates**: Shows analysis engine progress and steps
- **Reopen dialog**: Click **"eye" button** to reopen the flow dialog while analysis is running
- **Track execution**: See AI reasoning process as it analyzes your model

**Interactive Analysis**:
- **User questions**: Analysis may require your input during execution
- **Automatic prompts** (flow dialog open): Question dialogs open automatically
- **Manual access** (flow dialog closed): Click **"chat" icon** to open question dialogs
- **Example interactions**:
  - "What is the primary authentication method for admin users?"
  - "Are payment transactions encrypted at rest?"
  - "Select applicable compliance requirements: PCI DSS, GDPR, HIPAA"

### Viewing Results

1. **Wait for completion**: Analysis returns to "idle" status in the analyses table when finished
2. **Open results**: Click **right arrow** in the analysis instance row
3. **Review findings**: Examine security assessment results

**Typical Results Summary**:
   - **Critical Issues**: 3 found
   - **High Issues**: 7 found
   - **Medium Issues**: 12 found
   - **Low Issues**: 8 found

**Multiple Analysis Types**:
- Run different analysis types simultaneously
- Compare results from various analytical approaches
- Keep historical record of all analysis runs

### Example Analysis Results

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

Once you have analysis results, you can create issues to track findings and coordinate remediation efforts.

### Creating Issues from Findings

**From Analysis Results:**
1. **Review findings**: Open analysis results by clicking the right arrow in the analyses table
2. **Select finding**: Choose a specific security finding to track
3. **Create issue**: Click "Create Issue" or similar option
4. **Select issue type**: Choose from dropdown (provided by loaded modules):
   - **Security Incident**: For immediate security concerns
   - **Remediation Task**: For planned security improvements
   - **Compliance Issue**: For regulatory requirement violations
   - **Bug Report**: For technical defects requiring fixes

### Issue Configuration

**Automatic Association:**
When creating issues from analysis results, relevant elements are automatically associated:
- **Analysis instance**: The specific analysis run that identified the finding
- **Affected model**: The threat model being analyzed
- **Related components**: Components involved in the finding
- **Associated exposures**: Specific vulnerabilities identified

**Issue Dialog Configuration:**
1. **Basic Properties**:
   - **Name**: "Priority: Unencrypted Payment Data"
   - **Description**: "Credit card data transmitted without end-to-end encryption between Payment Service and Payment Gateway"

2. **Attributes Tab** (varies by issue type):
   - **Priority**: Module-dependent priority levels
   - **Severity**: Based on impact assessment and module configuration
   - **Due Date**: Target resolution date
   - **Assignee**: Person responsible for resolution
   - **Tags**: PCI DSS, encryption, payment processing

3. **Associated Elements Tab**:
   - View automatically linked components and models
   - Add additional related elements if needed

4. **Comments Tab**:
   - Add initial analysis details
   - Document investigation findings
   - Track resolution progress

### Remote System Integration

**External Tracking Systems:**
If configured with modules for external integration:
- **Jira**: Issues sync with Jira tickets
- **ServiceNow**: Integration with ServiceNow incidents
- **GitHub**: Links to GitHub issues for technical fixes

**Automatic Sync:**
- **Creation**: Issue created in both Dethernety and external system
- **Updates**: Changes sync bidirectionally
- **Status**: Resolution status reflects across systems
- **Comments**: Discussion threads maintained in sync

### Adding Elements to Existing Issues

**Using the Clipboard Workflow:**
Sometimes you want to add findings or components to existing issues rather than creating new ones:

1. **From Any Context** (analysis results, component settings, model dialog):
   - Select element or finding to add
   - Choose **"Add to Issue"** from issue menu
   - System copies element to clipboard and **redirects to Issues page**

2. **Find Target Issue**:
   - Use filtering to locate the existing issue
   - Apply filters like `name:payment` or `severity:critical`
   - Open the target issue dialog

3. **Complete Association**:
   - Click **"Add from Clipboard"** button
   - System automatically associates the element
   - Automatic comment documents the addition

4. **Navigation**:
   - Use **Associated Elements tab** to view all linked elements
   - Click element buttons to navigate back to source locations
   - **Return functionality** takes you back to original context

This workflow lets you build issues from multiple sources while maintaining traceability.

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

1. **Open the model dialog**: Right-click your model in Browser, or click the model name in the data flow editor
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
- **[Security Analysis Workflow](SECURITY_ANALYSIS_WORKFLOW.md)**: Advanced analysis techniques
- **[Working with Security Controls](WORKING_WITH_SECURITY_CONTROLS.md)**: Implementing countermeasures
- **[Issue Management Guide](ISSUE_MANAGEMENT_GUIDE.md)**: Track and manage findings with your team
- **[Dethereal Plugin](dethereal/README.md)**: AI-assisted threat modeling with the Claude Code plugin