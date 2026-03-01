---
title: 'AI-Powered Workflows with MCP Integration'
description: 'Automate threat modeling with AI agents via the Dethereal MCP server'
category: 'workflows'
position: 15
navigation: true
tags: ['ai', 'automation', 'mcp', 'integration', 'workflows', 'claude']
---

# AI-Powered Workflows with MCP Integration

*Automate threat modeling and infrastructure discovery with AI assistance*

---

## Overview

The **Dethereal MCP Server** integrates Dethernety with any MCP-compatible AI agent. Through this integration, AI agents can create, analyze, and enrich threat models using natural language, discover infrastructure configurations, and keep your security documentation synchronized with your systems.

### MCP Compatibility

This integration uses the **Model Context Protocol (MCP)**, an open standard that allows any MCP-compatible AI agent to interact with Dethernety. Supported agents include:

- **Claude Code** (Anthropic) - Featured in examples below
- **Claude Desktop** (Anthropic)
- **Cline** (VS Code extension)
- **Continue** (IDE extension)
- Any other MCP-compatible AI agent or tool

Throughout this guide, we use "Claude" in examples for clarity, but these workflows apply to any MCP-compatible agent.

### What You Can Do

**Natural Language Threat Modeling**
- Describe your architecture in plain English; the AI agent creates the threat model
- AI composes proper JSON structures and imports them automatically

**Infrastructure Discovery and Enrichment**
- AI agents can enrich models with real configuration data
- Discovers ports, protocols, security settings from live infrastructure
- Works with Kubernetes, AWS, Azure, Docker, and other platforms

**Automated Analysis**
- Export models, enrich with real configs, then run security analysis
- Exposure detection based on actual configurations
- Context-aware security recommendations

---

## Quick Start

### 1. Natural Language Model Creation

Simply describe what you need in natural language:

```
You: "Create a threat model for a web application with:
     - React frontend
     - Node.js API server
     - PostgreSQL database
     - Stripe payment integration"

Claude: I'll create a threat model for your e-commerce stack.
        [Analyzes request, composes JSON, imports to Dethernety]

Created "E-Commerce Application" with:
   - React Frontend (Public boundary)
   - Node.js API (DMZ boundary)
   - PostgreSQL (Internal boundary)
   - Stripe Integration (External entity)
   - Complete data flow mapping
```

### 2. Infrastructure Discovery Workflow

Claude can automatically enrich models with real configuration data:

```
You: "Export my web application model and enrich it with actual Kubernetes configs"

Claude: [Step 1: Exports model from Dethernety]
        [Step 2: Discovers required attributes for components]
        [Step 3: Executes kubectl commands to gather real configs]
        [Step 4: Updates model with discovered data]

Model enriched with:
   - Actual port configurations (8080, 443)
   - TLS settings (TLS 1.2)
   - Authentication method (OAuth2)
   - Network exposure (LoadBalancer)
   - Security policies
```

---

## Key Capabilities

### Model Creation and Management

**Create Models from Descriptions**
- Describe architecture in natural language
- AI agent composes proper Dethernety JSON structure
- Automatic validation and import

**Update Existing Models**
- Export, modify, re-import seamlessly
- Add components or flows with natural language
- Synchronize with infrastructure changes

**Template-Based Creation**
- Start from example models (web app, microservices, API, database)
- Customize to your specific needs
- Maintain consistency across models

### Infrastructure Discovery

**Supported Platforms**
- **Kubernetes**: Deployments, services, network policies, ingress
- **AWS**: EC2, RDS, security groups, load balancers
- **Azure**: VMs, NSGs, web apps
- **Docker**: Containers, networks, configurations
- **Google Cloud**: Compute instances, clusters, databases

**Discovery Workflow**
1. AI agent identifies components in your model
2. Determines required security attributes
3. Executes infrastructure commands (kubectl, aws cli, etc.)
4. Parses configuration data
5. Updates model with real attributes

**Enriched Attributes Include**
- Open ports and protocols
- TLS/encryption settings
- Authentication mechanisms
- Network exposure levels
- Security group rules
- Resource configurations

### Advanced Analysis Workflows

**Configuration-Based Analysis**
- Real configuration data enables precise exposure detection
- Context-aware vulnerability assessment
- Accurate MITRE ATT&CK technique mapping

**Continuous Synchronization**
- Re-run discovery to keep models current
- Track infrastructure changes over time
- Maintain living security documentation

---

## Common Use Cases

### Use Case 1: New Application Threat Model

**Scenario**: Starting a new project, need threat model quickly

```
You: "I'm building a REST API with JWT auth, Redis cache, and MongoDB.
     Create a threat model."

Claude: [Creates complete model with proper boundaries and flows]

Result: Complete threat model in minutes
```

### Use Case 2: Cloud Infrastructure Assessment

**Scenario**: Need to analyze AWS infrastructure security

```
You: "Map my AWS production infrastructure to a threat model and
     enrich it with security group configurations"

Claude: [Discovers EC2, RDS, ELB from AWS]
        [Maps to components and boundaries]
        [Enriches with security group rules]

Result: Complete cloud security model with real configurations
```

### Use Case 3: Kubernetes Security Analysis

**Scenario**: Analyze microservices security in Kubernetes

```
You: "Create threat model from my production namespace and
     include network policies and ingress configs"

Claude: [Discovers deployments and services]
        [Maps network policies to boundaries]
        [Includes ingress exposure details]

Result: K8s security model ready for analysis
```

### Use Case 4: Documentation from Diagrams

**Scenario**: Convert architecture diagram to threat model

```
You: "I have a draw.io diagram of my architecture.
     Convert it to a Dethernety threat model."

Claude: [Parses diagram XML]
        [Maps shapes to components]
        [Creates boundaries from containers]

Result: Visual architecture → Analysis-ready model
```

### Use Case 5: Continuous Threat Modeling

**Scenario**: Keep threat model synchronized with infrastructure

```
You: "Create a script that keeps my threat model updated
     with infrastructure changes"

Claude: [Generates discovery script]
        [Includes comparison logic]
        [Sets up update automation]

Result: Automated threat model synchronization
```

---

## Example Workflows

### Workflow 1: Simple Model Creation

**Time**: 2 minutes

```
1. You: "Create a model with Nginx web server connecting to MySQL"
2. Claude: [Composes and imports model]
3. Result: Ready for analysis in Dethernety
```

### Workflow 2: Infrastructure Discovery

**Time**: 5-10 minutes

```
1. You: "Export my application model"
2. You: "What security attributes do web servers need?"
3. You: "Check my Kubernetes cluster for actual configs"
4. You: "Update the model with real configuration values"
5. Result: Enriched model with complete security context
```

### Workflow 3: Multi-Source Integration

**Time**: 10-15 minutes

```
1. You: "Import my Terraform files as a threat model"
2. Claude: [Parses IaC, creates base model]
3. You: "Now enrich with live AWS configurations"
4. Claude: [Queries AWS, updates model]
5. Result: IaC + Live Config = Complete model
```

---

## Natural Language Examples

**Simple Architectures**
- "Model a web server with database backend"
- "Create a model for a mobile app API with Redis cache"
- "I need a threat model for a payment processing service"

**Complex Systems**
- "Model a microservices architecture with service mesh and multiple databases"
- "Create a model for an event-driven system with Kafka and multiple consumers"
- "I need a threat model for a multi-tier application with DMZ and internal zones"

**Infrastructure Discovery**
- "Discover my Kubernetes production namespace and create a threat model"
- "Map my AWS infrastructure to Dethernety"
- "Find all my Docker containers and their network configurations"

**Enrichment & Updates**
- "Enrich this model with actual firewall rules"
- "Update the model with real TLS configurations from the cluster"
- "Add the actual port configurations from my services"

---

## Benefits

### Speed
- **Faster model creation** -- natural language descriptions instead of manual JSON composition
- **Automated discovery** -- minutes instead of hours for infrastructure mapping
- **Quick updates** -- re-run discovery to sync with infrastructure changes

### Accuracy
- **Real configurations** -- actual settings rather than assumptions
- **Context-aware analysis** -- recommendations based on real data
- **Current documentation** -- models stay synchronized with infrastructure

### Security
- **Exposure detection** -- find open ports and weak protocols automatically
- **Configuration assessment** -- identify security misconfigurations
- **Attack surface mapping** -- complete view based on actual setup

### Version control
- **Models as files** -- exported models are plain JSON files that live alongside your source code
- **Git-friendly** -- track model changes in the same repository and review them in pull requests
- **Portable backups** -- any file backup strategy works; the tools also create timestamped backups before destructive operations

See [MCP Server Guide -- Version Control and File-Based Persistence](MCP_SERVER_GUIDE.md#version-control-and-file-based-persistence) for details on the directory format.

### Accessibility
- **Lower barrier to entry** -- natural language, no JSON expertise needed
- **Consistent models** -- AI ensures proper structure
- **Shareable** -- models can be exported, reviewed, and updated

---

## Integration with Dethernety Workflows

### Creating Models
1. Describe architecture to your AI agent
2. AI agent creates and imports model
3. Open in Dethernety for visual editing
4. Run AI analysis for security insights

### Enriching Models
1. Build basic model in Dethernety UI
2. Export via your AI agent
3. Discover infrastructure configs
4. Import enriched model back
5. Run deep security analysis

### Continuous Modeling
1. Set up initial model and commit the exported files to your repository
2. Re-run discovery when infrastructure changes
3. Commit model updates in the same branch or PR as the code change
4. Track security posture over time through git history

---

## Best Practices

### Model Creation
- **Start with clear descriptions** -- be specific about components and relationships
- **Use proper terminology** -- "API Gateway", "Database", "External Service"
- **Specify security boundaries** -- DMZ, Internal, Private zones
- **Include data flows** -- describe how components communicate

### Infrastructure Discovery
- **Run discovery after deployment** -- capture actual configurations
- **Re-run when infrastructure changes** -- keep models current
- **Validate discovered data** -- review AI agent's mappings
- **Document exceptions** -- note manual configurations

### Analysis Workflows
- **Enrich before analysis** -- real configs produce better results
- **Use specific queries** -- ask your AI agent about specific security concerns
- **Track findings** -- create issues from analysis results
- **Iterate** -- update models based on findings

---

## Getting Started

### Prerequisites
- Access to Dethernety platform
- MCP-compatible AI agent with Dethereal MCP server configured
- (Optional) CLI access to infrastructure (kubectl, aws, etc.)

### First Steps
1. **Ask your AI agent for help**: "Show me how to create a threat model"
2. **Start simple**: Create a basic web app model
3. **Try discovery**: Export and enrich with real configs
4. **Explore examples**: Ask for templates and patterns

### Learning Path
1. **Create simple models** with natural language (10 min)
2. **Try infrastructure discovery** workflow (20 min)
3. **Practice enrichment** with your systems (30 min)
4. **Automate updates** for continuous modeling (advanced)

---

## Next Steps

**Related Documentation**
- [Building Your First Model](BUILDING_YOUR_FIRST_MODEL.md) -- Manual modeling techniques
- [Security Analysis Workflow](SECURITY_ANALYSIS_WORKFLOW.md) -- Running analysis
- [Component Configuration Guide](COMPONENT_CONFIGURATION_GUIDE.md) -- Detailed attributes
- [Issue Management Guide](ISSUE_MANAGEMENT_GUIDE.md) -- Tracking findings

**Technical Reference**
- [MCP Server Guide (Dethereal)](MCP_SERVER_GUIDE.md) -- Tool reference, configuration, directory structure, and troubleshooting

**Tips**
- Experiment with natural language -- AI agents understand context
- Combine manual and AI workflows as needed
- Start automated discovery early to keep models current
- Iterate based on analysis results
