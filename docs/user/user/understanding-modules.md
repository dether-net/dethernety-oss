---
title: 'Understanding Modules'
description: "How Dethernety's module system extends your threat modeling capabilities and what it means for your security analysis."
category: 'reference'
position: 10
navigation: true
tags: ['intermediate', 'reference', 'conceptual', 'modules', 'extensions', 'system-architecture']
---

# Understanding Modules

*How Dethernety's module system extends your threat modeling capabilities and what it means for your security analysis.*

## What Are Modules?

Modules are the building blocks that give Dethernety its flexibility and power. Think of them as specialized security expertise packages that extend what you can model and analyze in your threat models.

When you create a model, you **assign modules** to make their capabilities available. The modules you choose determine:
- **What types of components** you can add to your model
- **What security analysis** is performed on your configurations
- **What types of controls** are available for protection
- **What types of issues** can be created and how they integrate with external systems
- **How exposures are detected** and calculated

## What Modules Provide

### Component Classes
**What you see**: Different types of components available in the component palette

**What modules provide**: Specialized component types like:
- **Web Application Modules**: Web servers, APIs, microservices, frontend applications
- **Database Modules**: SQL databases, NoSQL stores, caches, data warehouses
- **Cloud Modules**: AWS EC2 instances, S3 buckets, Azure services, GCP resources
- **Network Modules**: Firewalls, load balancers, routers, switches
- **Container Modules**: Docker containers, Kubernetes pods, orchestration platforms

**Why it matters**: More relevant component types mean more accurate threat modeling for your specific technology stack.

### Security Analysis Logic
**What you see**: Automatic exposure detection when you configure components

**What modules provide**: Intelligent security analysis using OPA/Rego policies that:
- **Evaluate your configurations** against security best practices
- **Identify vulnerabilities** based on component attributes
- **Calculate risk levels** using industry knowledge
- **Map exposures to attack techniques** from MITRE ATT&CK

**Example**: A web application module detects that setting `protocol: "HTTP"` creates an "Unencrypted Web Traffic" exposure with links to network sniffing attacks.

### Control Classes and Countermeasures
**What you see**: Recommended security controls and mitigation strategies

**What modules provide**: Intelligent countermeasure recommendations that:
- **Match controls to exposures** based on security expertise
- **Prioritize mitigations** by effectiveness and criticality
- **Provide implementation guidance** for specific technologies
- **Connect to security frameworks** like D3FEND defensive techniques

### Issue Classes and External Integration
**What you see**: Different types of security issues and ticketing integration options

**What modules provide**: Specialized issue management capabilities that:
- **Define issue types** specific to different security domains (vulnerabilities, compliance violations, configuration errors)
- **Configure issue attributes** that match your organization's workflow (priority levels, assignment categories, SLA requirements)
- **Provide issue templates** with pre-filled information for consistent reporting
- **Enable bi-directional sync** with external ticketing systems (Jira, ServiceNow, Azure DevOps, GitHub Issues)

**Example**: A vulnerability management module provides "Security Vulnerability" issue types with CVE tracking, CVSS scoring, and automatic sync with your vulnerability management system.

### Analysis Capabilities
**What you see**: Different types of security analysis you can run

**What modules provide**: Specialized analysis engines like:
- **AI-powered threat analysis** using language models
- **Attack path discovery** through system models
- **Compliance assessments** for specific regulations
- **Vulnerability correlation** across multiple systems
- **Real-time threat intelligence** integration

## How Module Assignment Works

### During Model Creation
When you create a new model, you **select which modules to assign**:

1. **Browse Available Modules**: See all modules installed in your Dethernety system
2. **Select Relevant Modules**: Choose modules that match your technology stack
3. **Module Assignment**: Selected modules become available for that specific model

**Important**: Only classes from assigned modules are available in your model. If you need additional component types later, you may need to assign more modules.

### What Module Assignment Affects

**Component Classes Available**:
```
Without AWS Module → Generic "Database" components
With AWS Module → "RDS Database", "DynamoDB Table", "Aurora Cluster"
```

**Analysis Depth**:
```
Basic Module → Generic security checks
Specialized Module → Technology-specific vulnerability detection
```

**Control Recommendations**:
```
Generic Module → "Enable encryption"
AWS Module → "Enable RDS encryption with KMS key rotation"
```

## How Modules Work Behind the Scenes

### Intelligent Policy Evaluation
Modules use sophisticated policy systems to analyze your configurations:

```rego
# Example: Web application security policy
unencrypted_web_traffic_exposure {
    input.protocol == "http"        # Your configuration
    input.environment == "production"   # Context matters
    # Result: Exposure detected with specific attack technique mapping
}
```

**What this means for you**:
- **Real-time feedback**: Exposures appear as you configure components
- **Context-aware analysis**: Same setting may have different risk levels in different contexts
- **Comprehensive coverage**: Policies check hundreds of security considerations automatically

### Dynamic Security Mapping
Modules automatically connect your configurations to security frameworks:

```
Your Configuration → Module Analysis → Security Framework Integration
├── Component: Web Server
├── Protocol: HTTP
├── Authentication: Basic
└── Module evaluates...
    ├── Detects: Unencrypted traffic exposure
    ├── Maps to: MITRE ATT&CK T1040 (Network Sniffing)
    ├── Links to: D3FEND D3-TTE (Transport Encryption)
    └── Recommends: TLS encryption control
```

### Custom Interface Generation
Modules provide the configuration forms you see:

**JSON Schema → Dynamic Forms**:
- Modules define what configuration options are available
- Forms automatically adapt to different component types
- Validation rules ensure proper configurations
- Help text provides context-specific guidance

## Module Types You'll Encounter

### Technology-Specific Modules
**Purpose**: Deep expertise for specific platforms or technologies
**Examples**:
- **AWS Security Module**: EC2, S3, Lambda, VPC security analysis
- **Kubernetes Module**: Pod security, network policies, RBAC analysis
- **Database Security Module**: Encryption, access controls, backup security
- **Web Application Module**: OWASP Top 10, input validation, session management

### Framework and Compliance Modules
**Purpose**: Align analysis with specific security frameworks or regulations
**Examples**:
- **NIST Cybersecurity Framework Module**: Maps findings to CSF categories
- **PCI DSS Module**: Payment card industry compliance analysis
- **GDPR Module**: Privacy impact assessment and data protection
- **SOC 2 Module**: Security controls for service organizations

### Analysis and Intelligence Modules
**Purpose**: Provide specialized analysis capabilities
**Examples**:
- **AI Threat Analysis Module**: LLM-powered security assessment
- **Vulnerability Scanner Integration**: Real-time vulnerability data
- **Threat Intelligence Module**: External threat feed integration
- **Attack Simulation Module**: Automated attack path discovery

### Industry-Specific Modules
**Purpose**: Address unique security requirements for specific industries
**Examples**:
- **Healthcare Module**: HIPAA compliance, medical device security
- **Financial Services Module**: Banking regulations, payment security
- **Manufacturing Module**: OT/IT convergence, industrial control systems
- **Government Module**: FedRAMP, security clearance requirements

### Issue Management and Integration Modules
**Purpose**: Provide specialized issue types and external system integration
**Examples**:
- **Vulnerability Management Module**: CVE tracking, CVSS scoring, patch management workflows
- **Compliance Tracking Module**: Audit findings, remediation tracking, regulatory reporting
- **Incident Response Module**: Security incident types, response workflows, escalation procedures
- **Development Integration Module**: Bug tracking, code security issues, DevSecOps workflows

**Issue Class Features**:
- **Custom Issue Types**: Security vulnerabilities, compliance violations, configuration errors, policy exceptions
- **Tailored Attributes**: Priority systems, assignment categories, SLA tracking, approval workflows
- **Pre-filled Templates**: Consistent issue creation with relevant technical details and context
- **Bi-directional Sync**: Automatic synchronization with Jira, ServiceNow, Azure DevOps, GitHub Issues
- **Workflow Integration**: Status updates, comments, and resolution tracking across systems

## Working with Module Capabilities

### Understanding Available Classes
**In Component Palette**: Different modules provide different component types
- **Generic modules**: Basic component types (Process, Data Store, External Entity)
- **Specialized modules**: Technology-specific types (Redis Cache, API Gateway, Load Balancer)

**Best Practice**: Assign modules that match your actual technology stack for most accurate analysis.

### Configuration Options
**Dynamic Forms**: Configuration options change based on assigned modules
- **Basic modules**: Simple configuration (Name, Description, Type)
- **Advanced modules**: Detailed security settings (Encryption, Authentication, Network policies)

**Help and Guidance**: Modules provide contextual help
- **Configuration tips**: Best practices for secure configuration
- **Security implications**: How settings affect exposure calculation
- **Implementation guidance**: Specific steps for security improvements

### Analysis Results
**Module-Dependent Analysis**: Results vary based on assigned modules
- **Generic analysis**: Basic security checks and common vulnerabilities
- **Specialized analysis**: Technology-specific threats and mitigations
- **Comprehensive coverage**: Multiple modules provide broader security perspective

## Unlimited Extensibility Through JavaScript Modules

### Real JavaScript Modules with Custom Logic
Dethernety modules are actual JavaScript/TypeScript modules that can include any custom logic, enabling unlimited integration possibilities:

**External System Integration**:
- **SIEM Systems**: Real-time threat detection data from Splunk, QRadar, ArcSight
- **Vulnerability Management**: Live vulnerability data from Nessus, Qualys, Rapid7, OpenVAS
- **Threat Intelligence**: Feeds from AlienVault OTX, VirusTotal, MISP, commercial providers
- **Cloud Platforms**: Direct API integration with AWS, Azure, GCP for resource discovery and assessment
- **Container Security**: Integration with Docker Security Scanning, Twistlock, Aqua Security
- **Code Security**: Integration with Veracode, Checkmarx, SonarQube for application security

**Custom Business Logic**:
- **Proprietary Risk Models**: Implement your organization's specific risk calculation algorithms
- **Industry-Specific Logic**: Custom security requirements for healthcare, finance, government
- **Regulatory Compliance**: Automated compliance checking for organization-specific requirements
- **Legacy System Integration**: Bridge existing security tools and databases

**Real-Time Data Processing**:
- **Live Security Events**: Stream and analyze security events as they occur
- **Dynamic Risk Assessment**: Continuously update threat models based on current conditions
- **Automated Response**: Trigger automated actions based on analysis results
- **Performance Monitoring**: Integrate with APM tools for security-performance correlation

### Enterprise Integration Examples

**SIEM Integration Module**:
```
Real-Time Threat Detection:
- Query SIEM for active alerts affecting modeled components
- Correlate security events with threat model elements
- Automatically update exposure severity based on current threats
- Generate dynamic risk scores incorporating live threat data
```

**Vulnerability Scanner Integration**:
```
Live Vulnerability Assessment:
- Scan actual infrastructure matching threat model components
- Import real CVE data and CVSS scores
- Map vulnerabilities to specific model components
- Provide patch management recommendations with implementation timelines
```

**Cloud Discovery Module**:
```
Automated Resource Discovery:
- Connect to AWS/Azure/GCP APIs to discover actual infrastructure
- Automatically create threat model components for discovered resources
- Assess actual cloud configurations against security best practices
- Monitor for configuration drift and security policy violations
```

**Threat Intelligence Integration**:
```
Dynamic Threat Landscape Analysis:
- Query threat intelligence feeds for indicators related to your architecture
- Correlate threat actor TTPs with your system components
- Update threat model risk assessments based on current threat landscape
- Provide contextual threat briefings for your specific technology stack
```

## AI-Powered Module Extension

### Dethermine Integration
Dethernety's AI framework (Dethermine) can work with modules to:
- **Generate custom classes** based on your descriptions
- **Create specialized policies** for unique technologies
- **Provide intelligent analysis** using module knowledge
- **Enhance existing modules** with AI capabilities

### Custom Class Creation
When no existing class fits your needs:
1. **Describe your component** in detail
2. **AI analyzes requirements** and technology context
3. **Custom class is generated** with appropriate security policies
4. **Class becomes available** for immediate use in your model

## Best Practices for Module Usage

### Module Selection
1. **Start with core modules** that match your primary technology stack
2. **Add specialized modules** for specific platforms or frameworks
3. **Include compliance modules** if you have regulatory requirements
4. **Consider analysis modules** for advanced security assessment

### Managing Module Complexity
- **Don't over-assign**: Too many modules can create analysis complexity
- **Focus on relevance**: Choose modules that match your actual systems
- **Understand dependencies**: Some modules work better together
- **Regular review**: Reassess module assignments as your architecture evolves

### Staying Current
- **Module updates**: New versions may include updated security knowledge
- **New modules**: Additional modules may become available for your technology stack
- **Organizational modules**: Your organization may develop custom modules

## Module Impact on Your Analysis

### Exposure Detection Quality
**More specific modules** → **More accurate exposure detection**
- Generic module might detect "Database security issue"
- PostgreSQL module detects "Unencrypted PostgreSQL connections with weak authentication on port 5432"

### Countermeasure Relevance
**Technology-aware modules** → **Actionable recommendations**
- Generic: "Enable encryption"
- AWS RDS module: "Enable encryption at rest using AWS KMS with automatic key rotation"

### Analysis Depth
**Specialized modules** → **Comprehensive security coverage**
- Basic analysis: Standard security checks
- Multi-module analysis: Technology-specific, compliance, and threat intelligence insights

---

Understanding modules helps you make informed decisions about which capabilities to include in your threat models and how to interpret the security analysis results. The module system is what makes Dethernety adaptable to your specific technology stack and security requirements.

**Next Steps**:
- **[Component Configuration Guide](component-configuration-guide.md)**: Learn how to configure components from your assigned modules
- **[Security Analysis Workflow](security-analysis-workflow.md)**: Understand how modules affect your analysis results
- **[Working with Security Controls](working-with-security-controls.md)**: See how modules provide intelligent countermeasures