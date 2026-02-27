---
title: 'Quick Start Guide'
description: 'Create your first threat model in 10 minutes and get immediate security insights.'
category: 'getting-started'
position: 3
navigation: true
tags: ['beginner', 'tutorial', 'quick', 'modeling', 'analysis', 'practical']
---

# Quick Start Guide

*Create your first threat model in 10 minutes and get immediate security insights.*

## Before You Start

**You'll Need:**
- Access to a Dethernety instance
- Basic understanding of your system architecture (web app, database, APIs)
- 10 minutes to complete the tutorial

## Step 1: Create Your Model (2 minutes)

**Navigate to Browser:**
1. Open Dethernety and go to **"Browser"** section
2. Click **menu button** (top right) → **"Create Model"**

**Configure Model:**
```
Name: "My Web Application"
Description: "Online application with user authentication and data storage"
```
3. **Assign Modules**: Select available modules (web, database, etc.)
4. Click **"Open Data Flow Editor"**

## Step 2: Add Core Components (3 minutes)

**Add Web Server:**
1. **Drag "Process"** from right palette onto canvas
2. **Double-click** → Configure:
   - Name: "Web Server"
   - Select web server class from modules
   - Basic settings: HTTPS, Port 443, Authentication required
3. **Save** - notice security exposures appear automatically

**Add Database:**
1. **Drag "Data Store"** from palette
2. **Double-click** → Configure:
   - Name: "User Database"
   - Select database class (PostgreSQL, MySQL, etc.)
   - Enable encryption options
3. **Save**

**Add User Entity:**
1. **Drag "External Entity"** outside components
2. **Configure**: Name "Users", Type: External Entity
3. **Save**

## Step 3: Connect with Data Flows (2 minutes)

**Connect User to Web Server:**
1. **Hover over User entity** → see connection points appear
2. **Click and drag** from User to Web Server
3. **Double-click arrow** → Configure:
   - Name: "User Requests"
   - Protocol: HTTPS
   - Data: Login credentials, user data
4. **Save**

**Connect Web Server to Database:**
1. **Drag** from Web Server to Database
2. **Configure flow**:
   - Name: "Data Queries"
   - Protocol: Database connection (TLS)
   - Data: User records, application data
3. **Save**

## Step 4: Run Security Analysis (3 minutes)

**Start Analysis:**
1. **Click model name** (top left) → Opens model dialog
2. **Go to "Analysis" tab**
3. **Select analysis type** from dropdown (varies by modules)
4. **Click "New Analysis"** → Name it "Initial Security Review"
5. **Click creation icon** (✨) to start

**Monitor Progress:**
- **Analysis flow dialog** shows real-time progress
- **Answer any questions** the AI asks about your system
- **Wait for completion** (usually 1-2 minutes)

**Review Results:**
1. **Click right arrow** in analysis row when complete
2. **Review findings** organized by severity
3. **Note recommendations** for each finding

## Step 5: Take Action on Results (< 1 minute)

**Create Issues for Key Findings:**
1. **Select important finding** from results
2. **Click "Create Issue"**
3. **Choose issue type**: Security Incident, Remediation Task, etc.
4. **System automatically links** analysis, model, and components
5. **Repeat** for other critical findings

## What You've Accomplished

- **✅ Created a working threat model** with components and data flows
- **✅ Discovered security exposures** automatically as you configured components
- **✅ Ran AI-powered security analysis** and received specific findings
- **✅ Created trackable issues** for remediation and team coordination

## Understanding Your Results

**Security Exposures** (appear in component settings):
- Specific vulnerabilities based on your configuration
- Automatically calculated as you build your model
- Link to MITRE ATT&CK techniques that could exploit them

**Analysis Findings** (from security analysis):
- Comprehensive assessment of your entire model
- Risk prioritization and impact analysis
- Specific recommendations for improvements
- Framework mappings (MITRE ATT&CK, D3FEND)

**Issues** (for tracking and remediation):
- Convert findings into actionable work items
- Assign to team members for resolution
- Track progress from discovery to completion
- Integrate with external tools (Jira, ServiceNow, GitHub)

## Next Steps

**Immediate Actions:**
1. **Add Security Controls**: Go to component → Controls tab → Assign relevant controls
2. **Expand Your Model**: Add more components (APIs, services, external systems)
3. **Re-run Analysis**: See how controls and changes affect your security posture

**Learn More:**
- **[Dethernety Interface Overview](dethernety-interface-overview.md)**: Master the interface for efficient work
- **[Building Your First Model](building-your-first-model.md)**: Detailed tutorial for complex systems
- **[Working with Security Controls](working-with-security-controls.md)**: Implement countermeasures
- **[Security Analysis Workflow](security-analysis-workflow.md)**: Advanced analysis techniques

## Pro Tips for Success

**Modeling Tips:**
- **Start simple**: Model core components first, add detail later
- **Focus on data flows**: Security issues often occur where data moves
- **Use realistic configurations**: Accurate settings give better analysis results

**Analysis Tips:**
- **Run analysis frequently**: After major model changes
- **Answer AI questions thoroughly**: Better context = better results
- **Review all severity levels**: Not just critical findings

**Issue Management Tips:**
- **Create issues from analysis**: Automatic context and traceability
- **Use descriptive names**: Make issues easy to understand for your team
- **Assign ownership**: Every issue should have a clear owner

---

*Need help with navigation? Check the [Dethernety Interface Overview](dethernety-interface-overview.md) or contact your administrator.*