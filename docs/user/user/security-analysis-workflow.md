---
title: 'Security Analysis Workflow'
description: 'How to run security analysis and interpret results to improve your threat models.'
category: 'analysis'
position: 6
navigation: true
tags: ['intermediate', 'guide', 'analysis', 'ai-analysis', 'findings', 'practical', 'workflow']
---

# Security Analysis Workflow

*How to run security analysis and interpret results to improve your threat models.*

## Analysis Overview

Security analysis in Dethernety helps you identify vulnerabilities and get actionable recommendations for your threat models. Analysis capabilities are provided by loaded modules, so available options depend on your system configuration.

**Key Benefits:**
- **Automated Discovery**: Find security issues you might miss in manual review
- **Industry Standards**: Analysis based on MITRE ATT&CK, D3FEND, and other frameworks
- **Actionable Results**: Get specific recommendations for addressing findings
- **Progress Tracking**: Convert findings into trackable issues

## Running Analysis

### **Starting Analysis from Model Dialog**

**Access Analysis:**
1. **Right-click your model** in Browser (or click model name in editor)
2. **Navigate to "Analysis" tab** in the model dialog
3. **Select analysis type** from available options (depends on loaded modules)

**Create Analysis Instance:**
1. **Click analysis type dropdown** and select appropriate analysis
2. **Click "New Analysis"** to create analysis instance
3. **Configure analysis**:
   - **Name**: "Security Assessment - [Date]"
   - **Description**: Brief description of analysis purpose
4. **Click creation icon** (✨) to start analysis

### **Analysis Execution**

**Monitoring Progress:**
- **Analysis Flow Dialog**: Shows real-time progress and AI reasoning steps
- **Interactive Questions**: Analysis may ask clarifying questions about your model
- **Completion Status**: Analysis shows "completed" when finished

**Analysis Types** (examples - varies by modules):
- **Basic Security Assessment**: Quick vulnerability scan
- **Advanced Threat Analysis**: Comprehensive security evaluation with AI assistance
- **Compliance Review**: Assessment against specific regulatory requirements

## Understanding Results

### **Result Structure**

Analysis results typically include:

**System Overview:**
- **Architecture Summary**: Analysis understanding of your system
- **Key Components**: Important elements identified for security assessment
- **Data Classification**: Sensitive information and critical assets

**Security Findings:**
- **Risk Level**: Critical, High, Medium, Low (terminology varies by module)
- **Description**: Clear explanation of the security issue
- **Impact**: Business and technical consequences
- **Recommendations**: Specific steps to address the finding

**Framework Integration:**
- **MITRE ATT&CK**: Attack techniques that could exploit identified issues
- **D3FEND**: Defensive measures that can protect against threats
- **Compliance**: Regulatory requirements related to findings

### **Working with Results**

**Review Process:**
1. **Open Results**: Click right arrow in analysis instance row
2. **Priority Review**: Start with highest severity findings
3. **Understand Context**: Review which components and data flows are affected
4. **Plan Response**: Decide on accept, mitigate, transfer, or avoid strategies

**Key Questions to Ask:**
- Which findings require immediate action?
- What findings can be addressed with security controls?
- Are there patterns across multiple findings?
- Which findings align with our compliance requirements?

## Converting Findings to Issues

### **Create Issues from Analysis Results**

**Direct Issue Creation:**
1. **Select specific finding** in analysis results
2. **Click "Create Issue"**
3. **Choose issue type**:
   - **Security Incident**: Immediate attention required
   - **Remediation Task**: Planned improvement
   - **Compliance Issue**: Regulatory requirement gap
4. **System automatically associates** analysis, model, and affected components

**Issue Benefits:**
- **Traceability**: Direct link back to analysis and affected elements
- **Team Coordination**: Assign to responsible team members
- **Progress Tracking**: Monitor remediation from discovery to completion
- **External Integration**: Sync with Jira, ServiceNow, or other tools

### **Building Comprehensive Issues**

**Using Clipboard Workflow:**
1. **Add multiple findings** to same issue using "Add to Issue"
2. **System redirects** to Issues page automatically
3. **Find target issue** and click "Add from Clipboard"
4. **Build comprehensive issues** that address related security concerns

## Best Practices

### **Analysis Strategy**

**Regular Analysis:**
- Run analysis after significant model changes
- Periodic reviews for ongoing projects
- Before major deployments or releases

**Analysis Selection:**
- **Quick assessments**: Use basic analysis for routine checks
- **Comprehensive reviews**: Use advanced analysis for complex systems or high-risk scenarios
- **Compliance checks**: Use specific compliance analysis when required

### **Result Management**

**Prioritization:**
- **Critical/High**: Address immediately, may require stopping deployment
- **Medium**: Include in current development cycle
- **Low**: Plan for future improvement cycles

**Documentation:**
- **Accept decisions**: Document business justification for accepted risks
- **Mitigation plans**: Track implementation of security controls
- **Progress updates**: Regular status updates in issue comments

### **Team Collaboration**

**Analysis Reviews:**
- Include security team in analysis result reviews
- Involve development teams in remediation planning
- Engage compliance teams for regulatory findings

**Communication:**
- Use analysis results to communicate risks to stakeholders
- Convert technical findings into business impact language
- Share analysis reports with relevant teams and management

## Common Analysis Patterns

### **New System Analysis**
```
1. Complete initial model → Run comprehensive analysis
2. Review all findings → Create issues for critical/high items
3. Implement controls → Re-run analysis to verify improvements
4. Track remaining issues → Plan ongoing security improvements
```

### **Ongoing System Analysis**
```
1. Model updates → Quick analysis to check new issues
2. Periodic reviews → Comprehensive analysis for full assessment
3. Change impact → Analysis after significant architecture changes
4. Compliance cycles → Specific compliance analysis as required
```

### **Pre-Deployment Analysis**
```
1. Final model review → Ensure model reflects current architecture
2. Comprehensive analysis → Full security assessment
3. Critical issue resolution → Must fix before deployment
4. Risk acceptance → Document any accepted risks with justification
```

---

**Next Steps:**
- **[Working with Security Controls](working-with-security-controls.md)**: Implement recommended countermeasures
- **[Issue Management Guide](issue-management-guide.md)**: Track and manage analysis findings
- **[Dethernety Interface Overview](dethernety-interface-overview.md)**: Navigate efficiently between analysis and other tasks