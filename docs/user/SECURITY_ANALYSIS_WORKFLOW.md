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

Security analysis in Dethernety is provided entirely by modules. The core platform does not ship with built-in analysis logic — instead, modules define what analysis types are available, how they evaluate your model, and what kind of results they produce. This means:

- The analysis types you see depend on which modules are loaded for your model
- Different modules may use different approaches: rule-based (OPA/Rego policies), AI-assisted, or a combination
- Results, severity scales, and recommendation formats vary by module
- You can have multiple analysis types available at once if several modules are loaded

The included Dethernety Module provides basic analysis capabilities. Additional modules can add specialized analysis (compliance checks, framework-specific assessments, AI-powered evaluation, etc.).

**What analysis gives you:**
- Find security issues you might miss in manual review
- Get findings mapped to industry frameworks (MITRE ATT&CK, D3FEND) when the module supports it
- Specific recommendations for addressing findings
- Findings that can be converted into trackable issues

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
4. **Click creation icon** (star icon) to start analysis

### **Analysis Execution**

**Monitoring Progress:**
- **Analysis Flow Dialog**: Shows real-time progress and AI reasoning steps
- **Interactive Questions**: Analysis may ask clarifying questions about your model
- **Completion Status**: Analysis returns to "idle" status when finished

**Analysis Types:**

What you see here depends on your loaded modules. A module might provide one analysis type or several. Examples of what modules can offer:
- Quick vulnerability scans based on component configuration
- AI-assisted threat evaluation with interactive Q&A
- Compliance checks against specific regulatory frameworks
- MITRE ATT&CK mapping and countermeasure recommendations

## Understanding Results

### **Result Structure**

Result format and content depend on the module that runs the analysis. Common elements include:

**Findings:**
- **Severity** -- how the module classifies risk (the scale and labels vary by module)
- **Description** -- what the issue is
- **Impact** -- business and technical consequences
- **Recommendations** -- steps to address the finding

**Framework mappings** (when the module supports it):
- **MITRE ATT&CK** -- attack techniques that could exploit identified issues
- **D3FEND** -- defensive measures that can protect against threats
- **Compliance** -- regulatory requirements related to findings

Some modules also produce a system overview with architecture summaries and data classification before listing findings.

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
- **External Integration**: Module-based sync with external tools if integration modules are installed

### **Building Issues from Multiple Sources**

**Using Clipboard Workflow:**
1. **Add multiple findings** to same issue using "Add to Issue"
2. **System redirects** to Issues page automatically
3. **Find target issue** and click "Add from Clipboard"
4. **Build issues** that address related security concerns

## Best Practices

### **Analysis Strategy**

**Regular Analysis:**
- Run analysis after significant model changes
- Periodic reviews for ongoing projects
- Before major deployments or releases

**Analysis Selection:**
- If a module offers multiple analysis types, start with lighter assessments for routine checks and use deeper analysis for complex systems or high-risk scenarios
- For compliance requirements, look for modules that provide framework-specific analysis

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
1. Complete initial model → Run full analysis
2. Review all findings → Create issues for critical/high items
3. Implement controls → Re-run analysis to verify improvements
4. Track remaining issues → Plan ongoing security improvements
```

### **Ongoing System Analysis**
```
1. Model updates → Quick analysis to check new issues
2. Periodic reviews → Full analysis for complete assessment
3. Change impact → Analysis after significant architecture changes
4. Compliance cycles → Specific compliance analysis as required
```

### **Pre-Deployment Analysis**
```
1. Final model review → Ensure model reflects current architecture
2. Full analysis → Complete security assessment
3. Critical issue resolution → Must fix before deployment
4. Risk acceptance → Document any accepted risks with justification
```

---

**Next Steps:**
- **[Working with Security Controls](WORKING_WITH_SECURITY_CONTROLS.md)**: Implement recommended countermeasures
- **[Issue Management Guide](ISSUE_MANAGEMENT_GUIDE.md)**: Track and manage analysis findings