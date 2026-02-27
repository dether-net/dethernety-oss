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

Before configuring components, it's important to understand how Dethernety's [module system](understanding-modules.md) works:

### Modules and Model Assignment

**Modules** provide the component classes, data flow classes, and security analysis capabilities available in your model:
- **Module Assignment**: During model creation, you assign modules to make their classes available
- **Class Availability**: Only classes from assigned modules can be used in that model
- **Security Logic**: Each module contains the logic for calculating exposures based on component configurations

**Common Module Types:**
- **Dethernety Module**: Default module that provides basic classes and allows AI assiseted Class generation
- **Web Application Modules**: Provide web server, API, and frontend component classes
- **Database Modules**: Provide various database and storage component classes
- **Network Modules**: Provide networking, firewall, and infrastructure classes
- **Security Modules**: Provide security control and monitoring classes

### Class Inheritance

**Component Classes** define:
- **Available Attributes**: What configuration options are available
- **Default Values**: Sensible defaults for common configurations  
- **Security Rules**: How the module calculates exposures
- **Validation Logic**: What combinations of settings are valid

## AI-Powered Class Generation for All Elements

**Universal Class Creation Capability**

Dethernety's Dethermine AI framework can generate custom classes for any element type in your model:

- **Component Classes**: For processes, data stores, and external entities
- **Data Flow Classes**: For connections between components
- **Security Boundary Classes**: For trust zones and network segments
- **Data Classes**: For data elements and information types
- **Issue Classes**: For security issues, vulnerabilities, and external ticketing integration

### Universal AI Class Generation Process

**Available for All Element Types:**

1. **Access Element Settings**: Open any element's settings dialog (component, data flow, boundary, or data item)
2. **Navigate to General Tab**: Go to the "General" tab in the settings dialog
3. **Ensure Detailed Description**: Provide a comprehensive description of the element's purpose, technology, and security requirements
4. **Click AI Generation**: Click the **creation icon with stars** (✨) in the General tab
5. **AI Analysis**: Dethermine analyzes the description and creates a tailored class with OPA/Rego policies

**Element-Specific Examples:**

**Data Flow Class Generation:**
```
Data Flow Description:
"HTTPS API calls carrying customer payment information between web frontend
and payment processing service. Includes credit card tokens, transaction amounts,
and customer identification data. Must comply with PCI DSS Level 1 requirements
and support OAuth 2.0 authentication with rate limiting."

Generated Data Flow Class:
- Payment data transmission policies
- PCI DSS compliance validation
- OAuth 2.0 token verification
- Rate limiting and throttling checks
- Encryption in transit validation
```

**Security Boundary Class Generation:**
```
Boundary Description:
"DMZ network segment hosting public-facing web services with strict ingress/egress
controls. Includes web servers, load balancers, and CDN endpoints. Requires
WAF protection, DDoS mitigation, and network segmentation from internal systems."

Generated Security Boundary Class:
- Network segmentation policies
- WAF configuration validation
- Ingress/egress traffic rules
- DDoS protection verification
- Internal network isolation checks
```

**Data Class Generation:**
```
Data Description:
"Customer personal identification information including names, addresses,
phone numbers, and encrypted payment tokens. Subject to GDPR Article 9
processing requirements with data retention limits and anonymization procedures."

Generated Data Class:
- PII identification and classification
- GDPR compliance validation
- Data retention policy checks
- Encryption at rest requirements
- Access control and audit logging
```

**Issue Class Generation:**
```
Issue Description:
"Security vulnerability tracking for web applications with CVE integration,
CVSS scoring, and automatic sync with Jira. Issues should include affected
components, remediation timelines, and patch management workflow integration."

Generated Issue Class:
- CVE reference and tracking fields
- CVSS score calculation and display
- Affected component linkage
- Remediation timeline attributes
- Jira bi-directional sync configuration
- Patch management workflow integration
```

### Benefits of AI-Generated Classes

- **Technology Intelligence**: AI recognizes specific technologies, frameworks, and platforms from descriptions
- **Compliance Integration**: Automatically incorporates relevant regulatory requirements
- **Security Best Practices**: Includes industry-standard security controls and validations
- **MITRE Integration**: Maps exposures to appropriate ATT&CK techniques and D3FEND countermeasures
- **Reusability**: Generated classes can be used across multiple similar elements in your models

## Issue Class Integration Features

**Bi-Directional Synchronization**:
- **Status Updates**: Changes in external systems automatically reflect in Dethernety
- **Assignment Tracking**: Responsibility assignments maintained across platforms
- **Resolution Verification**: Closure verification and validation workflows

**Supported External Systems**:
- **Jira**: Integration with Atlassian workflow management
- **ServiceNow**: Enterprise service management integration
- **Azure DevOps**: Development workflow and backlog integration
- **GitHub Issues**: Code repository issue tracking
- **Custom Systems**: API-based integration with organizational tools

**Issue Template Features**:
- **Auto-Population**: Technical details, affected components, and exposure information
- **Consistent Formatting**: Standardized issue descriptions and categorization
- **Context Preservation**: Links back to threat model components and analysis results
- **Escalation Rules**: Automatic escalation based on severity and timeframes

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
1. In the component settings dialog, ensure the toggle is set to **"Uses Class"**
2. Choose from available component classes provided by **modules assigned to the model**
3. Select the most appropriate class for your component (e.g., "Web Application Server", "Apache HTTP Server")

**Note**: The available classes depend on which modules were assigned to the model during creation. If you don't see expected classes, check the model's module assignments.

**Option 1a: AI-Generated Class Creation**
If no existing class fits your specific requirements, you can create a custom class using Dethernety's AI capabilities:

1. In the component settings dialog, navigate to the **"General"** tab
2. Ensure your component has a **detailed description** that explains its purpose, technology, and security requirements
3. Click the **creation icon with stars** (✨) in the General tab
4. This launches the **AI-powered class generation** process using your component's description as input

**AI Class Generation Process:**

```
Example Component Description:
"High-performance Redis cache cluster running in AWS ElastiCache with encryption
in transit and at rest, used for session storage and application caching.
Requires VPC endpoint access, supports cluster mode, and needs compliance
with SOC 2 Type II requirements."
```

**AI Analysis and Generation:**
- **Dethermine AI Agent** analyzes the component description
- **Technology Detection**: Identifies Redis, AWS ElastiCache, encryption requirements
- **Security Context**: Recognizes VPC, encryption, compliance needs
- **Policy Generation**: Creates OPA/Rego policies for exposure detection
- **Documentation Creation**: Generates implementation guides and best practices

**Generated Component Class Structure:**

```rego
package _dt_custom.components.redis_elasticache_cluster

_redis_unencrypted_transit_def := {
    "name": "redis_unencrypted_transit",
    "description": "Redis cluster communication without TLS encryption allows data interception",
    "criticality": "high",
    "type": "Exposure",
    "category": "Auto generated",
    "exploited_by": [
        {"label": "MitreAttackTechnique", "property": "attack_id", "value": "T1040"},
        {"label": "MitreAttackTechnique", "property": "attack_id", "value": "T1557"}
    ]
}

redis_unencrypted_transit[_redis_unencrypted_transit_def] if {
    input.encryption_in_transit == false
}

redis_unencrypted_transit[_redis_unencrypted_transit_def] if {
    input.tls_enabled == false
    input.auth_token_enabled == true
}

_redis_weak_authentication_def := {
    "name": "redis_weak_authentication",
    "description": "Redis authentication relying solely on password without additional security measures",
    "criticality": "medium",
    "type": "Exposure",
    "category": "Auto generated",
    "exploited_by": [
        {"label": "MitreAttackTechnique", "property": "attack_id", "value": "T1110"},
        {"label": "MitreAttackTechnique", "property": "attack_id", "value": "T1078"}
    ]
}

redis_weak_authentication[_redis_weak_authentication_def] if {
    input.auth_token_enabled == true
    input.iam_authentication == false
    input.vpc_security_groups == false
}

exposures contains _redis_unencrypted_transit_def if {
    count(redis_unencrypted_transit) > 0
}

exposures contains _redis_weak_authentication_def if {
    count(redis_weak_authentication) > 0
}
```

**AI-Generated Class Features:**
- **Technology-Specific Policies**: Tailored to Redis/ElastiCache security patterns
- **AWS Integration**: Recognizes AWS-specific security features (VPC, IAM)
- **Compliance Mapping**: Incorporates SOC 2 Type II requirements
- **Best Practice Validation**: Includes industry-standard security checks
- **Comprehensive Coverage**: Multiple exposure scenarios and attack vectors

**Interactive Refinement:**
If the AI needs clarification, it will prompt with specific questions:

```
AI Agent: "I need to clarify a few details for your Redis ElastiCache cluster:

1. What Redis version are you using (6.x, 7.x)?
2. Are you using Redis Cluster mode or single-node?
3. Should the class validate specific AWS security groups?
4. What data sensitivity levels will be cached (PII, financial, etc.)?
5. Are there specific compliance frameworks beyond SOC 2?"

User Response: [Provide clarifications in the dialog]
```

**Automatic Class Assignment:**
Once generation completes:
1. **Custom class is created** and automatically assigned to your component
2. **Configuration template appears** with AI-generated attributes
3. **Exposure policies activate** and begin evaluating your component
4. **Documentation becomes available** for implementation guidance
5. **Class can be reused** for other similar components in the model

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

After configuring component attributes, Dethernety's default module uses sophisticated OPA/Rego policies to automatically analyze your configuration and identify potential security exposures.

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
        {"label": "MitreAttackTechnique", "property": "attack_id", "value": "T1557"}   # Man-in-the-Middle
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
  name: "Man-in-the-Middle"
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

## Data Item Management

**Understanding Data Items**

Data items (or entities) represent the types of data that components process, store, or transfer. They are essential for comprehensive threat modeling as they help identify data-specific security exposures and compliance requirements.

**Where Data Items Apply**:
- **Process Components**: Data types processed or transformed
- **External Entities**: Data exchanged with external systems
- **Data Stores**: Data types stored or managed
- **Security Boundaries**: Data types crossing boundary lines
- **Data Flows**: Data types transmitted between components

### Adding Data Items to Elements

**Step-by-Step Process**:

1. **Access Element Settings**: Open the settings dialog for any component, boundary, or data flow
2. **Navigate to Data Tab**: Click on the **"Data"** tab in the settings panel
3. **Create New Data Item**: Click the **+ button** in the top right corner
4. **Data Item Dialog Opens**: Configure the new data item

### Configuring Data Items

**General Tab Configuration**:

**Basic Properties**:
- **Name**: Descriptive name (e.g., "Customer Payment Data", "User Authentication Tokens")
- **Description**: Detailed explanation of the data type and its purpose

**Class Assignment**:
Similar to other elements, data items can be configured in two ways:

**Option 1: Data Class Assignment**
1. Select **"Uses Class"** option
2. Choose from available data classes provided by assigned modules
3. Select appropriate class (e.g., "Personal Identifiable Information", "Financial Data", "Authentication Credentials")

**Option 2: AI-Generated Data Class Creation**
1. Ensure detailed description of the data type, sensitivity, and regulatory requirements
2. Click the **creation icon with stars** (✨) in the General tab
3. Dethermine AI analyzes the description and creates a custom data class
4. Generated class is automatically assigned to the data item

**AI Data Class Generation Example**:
```
Data Description:
"Customer credit card information including PAN, expiry dates, and CVV codes.
Subject to PCI DSS Level 1 compliance requirements with tokenization for storage
and end-to-end encryption for transmission. Includes cardholder name and
billing address information."

Generated Data Class:
- PCI DSS compliance validation policies
- Tokenization requirement checks
- Encryption in transit/at rest validation
- Cardholder data handling rules
- Data retention and purging policies
```

### Data Item Attributes and Exposure Analysis

**Attributes Tab Configuration**:

After class assignment, configure data-specific attributes:

**Common Data Attributes**:
- **Sensitivity Level**: Public, Internal, Confidential, Restricted
- **Data Classification**: PII, PHI, Financial, Intellectual Property
- **Regulatory Requirements**: GDPR, HIPAA, PCI DSS, SOX compliance
- **Encryption Requirements**: At rest, in transit, in processing
- **Access Controls**: Who can access, modify, or delete the data
- **Retention Policies**: Storage duration, archival requirements

**Automatic Exposure Detection**:

Similar to components, data items undergo automatic exposure analysis:

1. **Policy Evaluation**: Module evaluates data attributes against security policies
2. **Data-Specific Exposures**: Identifies risks like data exposure, unauthorized access, compliance violations
3. **MITRE Mapping**: Links to relevant ATT&CK techniques for data-focused attacks
4. **Real-Time Updates**: Exposures recalculate when data attributes change

**Example Data Exposures**:
```rego
# Example: PII data without encryption
unencrypted_pii_exposure {
    input.data_classification == "PII"
    input.encryption_at_rest == false

    exposure := {
        "name": "Unencrypted Personal Data",
        "description": "PII stored without encryption violates privacy regulations",
        "criticality": "high",
        "exploited_by": ["T1005", "T1530"]  # Data from Local System, Data from Cloud Storage
    }
}

# GDPR compliance check
gdpr_retention_violation {
    input.subject_to_gdpr == true
    input.retention_period_days > 2555  # 7 years maximum

    exposure := {
        "name": "GDPR Data Retention Violation",
        "description": "Data retention exceeds GDPR maximum retention periods",
        "criticality": "medium",
        "compliance_framework": "GDPR Article 5(1)(e)"
    }
}
```

### Managing Existing Data Items

**Data Tab Interface**:

The Data tab provides comprehensive data item management:

**Data Items Table**:
- **Selection Column**: Checkboxes to assign/unassign data items to/from the current element
- **Name/Description**: Data item identification and details
- **Class**: Assigned data class type
- **Status**: Assignment status to current element
- **Actions**: Edit, delete, and other management operations

**Assigning Existing Data Items**:
1. **Browse Available Data**: View all data items in the model
2. **Select Data Items**: Click checkboxes to assign data to the current element
3. **Unassign Data**: Clear checkboxes to remove data from the current element
4. **Automatic Updates**: Exposure analysis updates based on data assignments

### Data Item Filtering and Search

**Filter Options**:

**Name/Description Filter**:
- **Search Bar**: Enter keywords to filter data items by name or description
- **Real-Time Filtering**: Results update as you type
- **Case-Insensitive**: Matches partial words and phrases

**Flow Direction Filter**:
- **In-Out Button**: Toggle button next to search filter
- **Connected Data Only**: Shows only data items flowing in/out to connected elements
- **Context-Aware**: Helps identify relevant data for the current component's connections

**Filter Examples**:
```
Search: "payment" → Shows: Credit Card Data, Payment Tokens, Transaction Records
Search: "PII" → Shows: Customer Data, User Profiles, Personal Information

Flow Filter ON → Shows only data from connected components
Flow Filter OFF → Shows all available data items in the model
```

### Data Item Management Operations

**Editing Data Items**:
1. **Click Edit Button**: In the data item's row
2. **Modify Properties**: Update name, description, class, or attributes
3. **Save Changes**: Updates apply to all elements using this data item

**Deleting Data Items**:
1. **Click Delete Button**: In the data item's row
2. **Confirmation Dialog**: Confirms deletion and shows impact
3. **Permanent Removal**: Data item removed from all elements and the model

**Important**: Deleting a data item affects all elements that use it and may change exposure calculations.

### Data Flow Integration

**Data in Transit**:

When data items are assigned to data flows:
- **Transmission Security**: Exposure analysis includes data-in-transit risks
- **Protocol Matching**: Data sensitivity matched against transmission protocols
- **Encryption Requirements**: TLS/encryption requirements based on data classification
- **Compliance Validation**: Regulatory requirements for data transmission

**Example Data Flow Analysis**:
```
Data Flow: Web App → Database
Data Items: [Credit Card Numbers, Customer PII]
Protocol: HTTP (unencrypted)

Generated Exposures:
- "PCI Data Over Unencrypted Channel"
- "PII Transmission Privacy Violation"
- "Regulatory Compliance Failure"

Recommended Controls:
- Enable TLS 1.3 encryption
- Implement data tokenization
- Add network segmentation
```

### Best Practices for Data Item Management

**Data Classification**:
1. **Consistent Taxonomy**: Use standardized data classification schemes
2. **Regular Review**: Periodically review and update data classifications
3. **Granular Classification**: Be specific about data types and sensitivity
4. **Compliance Alignment**: Ensure classifications match regulatory requirements

**Data Item Assignment**:
1. **Comprehensive Coverage**: Assign all relevant data types to components
2. **Accurate Mapping**: Ensure data assignments reflect actual data handling
3. **Flow Consistency**: Data in components should match data in connecting flows
4. **Regular Validation**: Verify data assignments remain accurate over time

**Security Configuration**:
1. **Attribute Completeness**: Fill in all relevant data attributes for accurate analysis
2. **Encryption Settings**: Properly configure encryption requirements
3. **Access Controls**: Define appropriate access control requirements
4. **Retention Policies**: Set proper data retention and disposal requirements

### Databases

Database components store and process sensitive information, making them critical security targets.

#### Basic Configuration

**Component Properties (before class assignment):**
- **Name**: Descriptive database name (e.g., "User Database")
- **Description**: Purpose and data types stored

**Class Assignment:**
1. Select a database class from loaded modules (e.g., "PostgreSQL Database", "MongoDB Collection")
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
2. **Implement comprehensive input validation** for all user inputs
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

Data items represent the specific types of data that flow through, are processed by, or stored within your system components. Unlike components that represent system elements, data items represent the actual information assets that need protection.

**Data items can be associated with any element:**
- **Processes**: Data processed, transformed, or validated
- **External Entities**: Data sent to or received from external sources
- **Data Stores**: Data persisted, cached, or archived
- **Boundaries**: Data crossing trust boundaries
- **Data Flows**: Data transmitted between components

### Creating Data Items

#### Accessing the Data Tab

To add data items to any element:

1. **Open Element Settings**: Click on any component, boundary, or data flow
2. **Navigate to Data Tab**: Click the "Data" tab in the settings panel
3. **Add New Data Item**: Click the **+** button in the top-right corner

#### Data Item Creation Dialog

The data creation dialog provides two tabs for configuration:

**General Tab:**
- **Name**: Descriptive name for the data type (e.g., "Customer Payment Information", "User Authentication Tokens")
- **Description**: Detailed description of the data structure and purpose
- **Class Assignment**: Choose from existing Data Classes or create new ones

**Class Assignment Options:**

1. **Select Existing Class**: Choose from data classes provided by your assigned modules:
   ```
   Available Classes:
   ├── Personal Identifiable Information (PII)
   ├── Payment Card Data (PCI DSS)
   ├── Healthcare Information (PHI)
   ├── Financial Records
   ├── Authentication Credentials
   └── System Logs
   ```

2. **Create New Class with AI**: If no existing class fits your needs:
   - Leave class selection empty
   - Provide detailed description of your data type
   - **Dethermine AI Integration** will analyze your description and generate:
     - Custom Data Class with appropriate attributes
     - Security policies based on data sensitivity
     - Compliance mappings (GDPR, HIPAA, PCI DSS)
     - Encryption and access control recommendations

#### AI Data Class Generation

When creating custom Data Classes, Dethermine analyzes your data description to generate:

**Security Classification:**
```
Data Sensitivity: [Public | Internal | Confidential | Restricted]
Regulatory Scope: [GDPR | CCPA | HIPAA | PCI DSS | SOX | Custom]
Encryption Requirements: [At Rest | In Transit | End-to-End]
Access Controls: [Public | Authenticated | Authorized | Privileged]
```

**Retention and Lifecycle:**
```
Data Retention Period: [Days | Months | Years | Indefinite]
Deletion Requirements: [Secure Wipe | Standard Delete | Archive]
Backup Policies: [Include | Exclude | Separate Handling]
Geographic Restrictions: [None | Regional | Country-specific]
```

### Configuring Data Attributes

After saving a data item with an assigned class:

1. **Switch to Attributes Tab**: Configure class-specific properties
2. **Set Security Attributes**: Based on the assigned Data Class
3. **Review Exposure Analysis**: Module policies automatically evaluate data security

#### Example Attributes by Data Type

**Personal Information Data Class:**
```
Contains PII: [Yes | No]
PII Categories: [Name | Email | Phone | Address | SSN]
Data Subject Rights: [Access | Rectification | Erasure | Portability]
Consent Basis: [Explicit | Legitimate Interest | Contract | Legal]
Cross-border Transfers: [None | EU | US | Global]
```

**Payment Data Class:**
```
Card Data Elements: [PAN | CVV | Expiry | Cardholder Name]
PCI DSS Scope: [CDE | Non-CDE | Out of Scope]
Tokenization: [Required | Optional | Not Applicable]
Encryption Method: [AES-256 | TDE | Application-level]
Key Management: [HSM | Cloud KMS | Software]
```

### Managing Existing Data Items

#### Data Items Table

The Data tab displays all data items in a comprehensive table:

**Table Columns:**
- **Select Checkbox**: Assign/unassign data items to current element
- **Name**: Data item identifier with quick edit option
- **Class**: Assigned Data Class with policy status
- **Description**: Data item description
- **Exposures**: Count of active security exposures
- **Actions**: Edit attributes, view details, delete

#### Data Assignment Operations

**Assigning Existing Data:**
1. **Browse Available Data**: View all data items in your model
2. **Select Data Items**: Check boxes for relevant data types
3. **Confirm Assignment**: Data items become associated with current element

**Unassigning Data:**
1. **Clear Selection**: Uncheck boxes for data items
2. **Confirm Changes**: Data items remain in model but lose association

#### Filtering and Search

**Search Functionality:**
- **Name/Description Filter**: Type in search bar to filter by text
- **Advanced Filtering**: Filter by class type, exposure count, assignment status

**Flow-Based Filtering:**
- **In-Out Toggle Button**: Click the flow button next to search
- **Connected Data Only**: Shows only data items associated with connected elements
- **Data Flow Analysis**: Understand data movement patterns

**Example Flow Filter Results:**
```
Showing data items flowing through connected elements:
├── Customer Data (from User Registration Form)
├── Payment Information (to Payment Gateway)
├── Order Details (to Fulfillment System)
└── Receipt Data (to Email Service)
```

### Data Item Operations

#### Editing Data Items

**Quick Edit Options:**
- **In-line Name Edit**: Double-click name field in table
- **Attribute Modification**: Click edit icon to open attributes dialog
- **Class Reassignment**: Change Data Class and recalculate exposures

**Bulk Operations:**
- **Multi-select**: Use checkboxes to select multiple data items
- **Bulk Class Assignment**: Apply same class to multiple data items
- **Bulk Attribute Updates**: Set common attributes across data items

#### Deleting Data Items

**Safe Deletion Process:**
1. **Dependency Check**: System verifies data item usage across model
2. **Impact Warning**: Shows all elements that will be affected
3. **Confirmation Required**: Prevent accidental deletion of critical data
4. **Clean Removal**: Updates all references and exposure calculations

**Data Item Dependencies:**
```
Dependency Analysis for "Customer Payment Data":
├── Used by: Payment Processing Service
├── Stored in: Payment Database
├── Flows through: 3 data connections
└── Referenced in: 2 security policies
```

### Data Flow Integration

#### Data Movement Tracking

When data items are assigned to elements connected by data flows:

**Automatic Flow Analysis:**
- **Data Path Mapping**: Track data movement through system architecture
- **Transformation Points**: Identify where data format or content changes
- **Security Boundary Crossings**: Highlight when data crosses trust zones
- **Compliance Checkpoints**: Verify regulatory requirements at each step

**Flow Security Assessment:**
```
Data Flow Security Analysis:
├── Source Security: Encryption at rest verified
├── Transport Security: TLS 1.3 encryption in transit
├── Transformation Security: Data masking applied
└── Destination Security: Access controls validated
```

#### Cross-Element Data Management

**Consistent Data Handling:**
- **Shared Data Items**: Same data item can be assigned to multiple elements
- **Policy Inheritance**: Security policies apply consistently across assignments
- **Global Updates**: Changes to data item class affect all assignments
- **Compliance Tracking**: Monitor regulatory requirements across data usage

### Data Security Analysis

#### Real-Time Exposure Detection

As you configure data item attributes, the assigned module's OPA/Rego policies continuously evaluate security:

**Exposure Categories:**
```
Data Protection Exposures:
├── Unencrypted Sensitive Data
├── Inadequate Access Controls
├── Missing Data Classification
├── Regulatory Non-compliance
├── Insecure Data Retention
└── Cross-border Transfer Violations
```

**MITRE ATT&CK Integration:**
Data-related exposures automatically map to relevant attack techniques:
- **T1005**: Data from Local System
- **T1039**: Data from Network Shared Drive
- **T1041**: Exfiltration Over C2 Channel
- **T1052**: Exfiltration Over Physical Medium
- **T1213**: Data from Information Repositories

#### Compliance Monitoring

**Regulatory Framework Integration:**
```
GDPR Compliance Status:
├── Data Subject Rights: ✓ Implemented
├── Consent Management: ⚠ Needs Review
├── Data Retention: ✓ Compliant
├── Cross-border Transfers: ❌ Non-compliant
└── Breach Notification: ✓ Implemented
```

### Best Practices for Data Item Management

#### Data Classification Strategy

1. **Start with Sensitivity Levels**: Classify data by business impact if compromised
2. **Apply Regulatory Frameworks**: Map to applicable compliance requirements
3. **Use Consistent Terminology**: Maintain standard data classification across organization
4. **Regular Review Process**: Periodically reassess data classifications

#### Data Flow Documentation

1. **Document Data Transformations**: Record how data changes as it flows
2. **Identify Decision Points**: Mark where data routing decisions occur
3. **Track Data Lineage**: Maintain visibility into data origins and destinations
4. **Monitor Data Quality**: Ensure data integrity throughout the flow

#### Security Configuration

1. **Principle of Least Privilege**: Restrict data access to minimum required
2. **Defense in Depth**: Apply multiple security controls to sensitive data
3. **Regular Access Review**: Periodically validate data access permissions
4. **Incident Response Planning**: Prepare for data breach scenarios

---

**Next Steps:**
- **[Security Analysis Workflow](security-analysis-workflow.md)**: Analyze your configured components
- **[Working with Security Controls](working-with-security-controls.md)**: Implement protective measures
- **[Understanding Modules](understanding-modules.md)**: Learn about Data Classes and policy evaluation