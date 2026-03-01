---
title: 'Working with Security Controls'
description: 'Learn how to create, manage, and assign reusable security controls in Dethernety to protect your threat models.'
category: 'controls'
position: 7
navigation: true
tags: ['intermediate', 'guide', 'controls', 'browser', 'ai-generation', 'universal-assignment', 'practical']
---

# Working with Security Controls

*Learn how to create, manage, and assign reusable security controls in Dethernety to protect your threat models.*

## Overview: Controls in Dethernety

Dethernety's security controls are reusable protective measures that can be applied to any element in your threat models:

- **Create once, use everywhere**: Controls work with components, data flows, boundaries, and entire models
- **Contextual countermeasures**: Controls generate appropriate countermeasures based on where they are applied
- **Universal application**: The same control adapts to different element types
- **Mixed control types**: Combine technical, administrative, and process controls in single packages

## Creating Security Controls

### Using the Browser Interface

The Browser is your primary interface for creating and managing reusable security controls:

**1. Navigate to Browser**:
- Open the **Browser** section in Dethernety
- Use folder navigation (breadcrumbs at top) to organize controls by project or domain
- Create folders using management buttons (top right of folder area)

**2. Create New Control**:
- Click the **menu button** (top right of the models/controls area)
- Select **"Create Control"**
- Control dialog opens for configuration

**3. Configure Basic Control Properties**:
```
Name: "Web Server Security Package"
Description: "Comprehensive security controls for web servers including encryption, authentication, and monitoring"
```

**4. Assign Control Classes** (Control Classes Tab):
- Click **"Control Classes"** tab in the control dialog
- Assign multiple control class types for layered protection:
  - **Technical Controls**: TLS encryption, firewall configuration, input validation
  - **Administrative Controls**: Security training, change management procedures
  - **Process Controls**: Compliance monitoring, audit requirements
- Each control class must be configured to generate effective countermeasures

**5. Configure Each Control Class**:
- Click the **settings button** on each assigned control class row
- Configure specific requirements for each class type
- **Only properly configured control classes generate countermeasures**
- Mix different control types for broader protection

## Assigning Controls to Elements

### Universal Control Assignment

Dethernety controls can be assigned to any element type. The same control applied to different elements automatically provides appropriate protection:

**From Component Settings**:
- Open any component settings dialog
- Navigate to **Controls** tab
- Assign controls to provide component-specific protection

**From Data Flow Configuration**:
- Double-click any data flow arrow
- Navigate to **Controls** tab
- Assign controls to protect data in transit

**From Security Boundary Settings**:
- Double-click any security boundary
- Navigate to **Controls** tab
- Assign controls for zone-wide protection

**From Model Dialog**:
- Right-click model in Browser OR click model name in editor
- Navigate to **Controls** tab in model dialog
- Assign controls for model-wide protection

### How the Same Control Adapts

When you assign the same control to different elements, it automatically provides contextual protection:

**Example: "Encryption Control" assigned to different elements:**

- **Component (Database)**: Generates database encryption countermeasures
- **Data Flow (API calls)**: Generates TLS/transport encryption countermeasures
- **Boundary (Network zone)**: Generates network-level encryption countermeasures
- **Model (Entire system)**: Generates system-wide encryption policy countermeasures

Because the same control adapts to its context, you can define security standards once and apply them consistently across different element types.

## AI-Powered Control Class Creation

For specialized security requirements that don't match existing control classes, Dethernety can generate custom control classes using AI.

### Creating AI-Generated Control Classes

**1. Access AI Creation**:
- In any control dialog, navigate to **"Control Classes"** tab
- Click the **creation icon** (star icon) in the top-right corner
- This opens the AI-powered control class creation interface

**2. Describe Your Requirements**:
Provide a detailed description of your security needs:

```
Example Input:
"Create a control class for database encryption at rest that ensures all sensitive
data is encrypted using AES-256 encryption, with proper key management through
AWS KMS or Azure Key Vault, and includes compliance checks for PCI DSS and GDPR
requirements. The control should validate encryption status and key rotation policies."
```

**3. AI Clarification Process**:
The AI may ask follow-up questions to ensure accuracy:
- Database types to support
- Key rotation intervals
- Backup encryption requirements
- Additional compliance frameworks

**4. Automatic Generation**:
The AI creates a complete control class with:
- Configured security policies
- MITRE framework mappings
- Implementation guidance
- Compliance requirements

**5. Immediate Use**:
- Generated control class appears in your control classes list
- Can be immediately assigned and configured
- Full integration with existing security framework

## Understanding Control Effectiveness

### Automatic Security Framework Integration

Dethernety automatically connects your security controls to industry-standard frameworks:

**From Problem to Solution**:
- **Exposures** are identified in your components (missing input validation, unencrypted connections)
- **Attack Techniques** are mapped from MITRE ATT&CK (T1190 Exploit Public-Facing Application, T1040 Network Sniffing)
- **Defensive Measures** are selected from MITRE D3FEND (Input Validation, Transport Encryption)
- **Controls** generate appropriate countermeasures to address these specific threats

**What this means in practice**:
- Controls map to real-world attack techniques from MITRE ATT&CK
- Framework integration helps identify gaps in coverage
- You can trace exactly how a control protects against a specific threat
- The platform uses established security frameworks (ATT&CK, D3FEND) without manual mapping

## Viewing Control Protection

### Protection Status in Components

When you assign controls to elements, you can view their protection status:

**In Component Settings**:
- **Exposures Tab**: Shows identified security risks
- **Controls Tab**: Lists assigned controls
- **Countermeasures Tab**: Displays active protection measures generated by configured controls

**Protection Indicators**:
- **Unprotected exposures**: Security risks not addressed by current controls
- **Protected exposures**: Security risks covered by appropriate countermeasures
- **Partial protection**: Some aspects protected, others requiring additional controls

## Control Management Best Practices

### Organizing Controls

**Folder Structure in Browser**:
- Create folders by security domain (Network Security, Data Protection, Identity Management)
- Organize by compliance requirements (PCI DSS Controls, GDPR Controls)
- Group by system type (Web Application Controls, Database Controls, Cloud Controls)

**Naming Conventions**:
- Use descriptive names that indicate purpose ("Web Server Hardening Package")
- Include scope indicators ("Enterprise Network Controls", "Development Environment Controls")
- Version control complex controls ("Payment Processing Controls v2.1")

### Reusing Controls Across Projects

**Control Libraries**:
- Create master control collections for your organization
- Share controls between teams using folder organization
- Maintain enterprise-standard controls for consistent security
- Update controls centrally to propagate improvements across all usage

**Best Practices**:
- Test controls in development models before production use
- Document control requirements and implementation notes
- Regular review and update of control effectiveness
- Track which models use specific controls for impact assessment

## Common Control Scenarios

### Web Application Security

**Essential Web App Control Package**:
- **TLS Encryption Control**: Secure communications
- **Input Validation Control**: Prevent injection attacks
- **Authentication Control**: User identity verification
- **Session Management Control**: Secure session handling
- **Security Headers Control**: Browser security policies

### Database Protection

**Database Security Control Package**:
- **Database Encryption Control**: Data at rest and in transit
- **Access Control**: Role-based database permissions
- **Audit Logging Control**: Database activity monitoring
- **Backup Security Control**: Secure backup procedures
- **Connection Security Control**: Secure database connections

### Network Security

**Network Protection Control Package**:
- **Firewall Control**: Network traffic filtering
- **Network Segmentation Control**: Zone-based security
- **Intrusion Detection Control**: Threat monitoring
- **VPN Control**: Secure remote access
- **DDoS Protection Control**: Attack mitigation

---

**Next Steps:**
- **[Security Analysis Workflow](SECURITY_ANALYSIS_WORKFLOW.md)**: Run analysis to identify where controls are needed
- **[Issue Management Guide](ISSUE_MANAGEMENT_GUIDE.md)**: Track control implementation as security improvements
- **[Building Your First Model](BUILDING_YOUR_FIRST_MODEL.md)**: Practical model creation with control assignment