---
title: 'Issue Management Guide'
description: 'Comprehensive issue tracking, filtering, and management capabilities in Dethernety.'
category: 'issues'
position: 8
navigation: true
tags: ['intermediate', 'guide', 'detailed', 'issues', 'filtering', 'clipboard-workflow', 'bulk-operations', 'integration', 'jira', 'servicenow', 'github']
---

# Issue Management Guide

This guide covers comprehensive issue tracking, filtering, and management capabilities in Dethernety.

## Table of Contents

1. [Issues Overview](#issues-overview)
2. [Creating Issues](#creating-issues)
3. [Advanced Filtering](#advanced-filtering)
4. [Issue Management Operations](#issue-management-operations)
5. [Remote System Integration](#remote-system-integration)
6. [Best Practices](#best-practices)

---

## Issues Overview

Issues provide a comprehensive tracking system for security findings, tasks, and incidents related to your threat models. Issues integrate with external systems and support both manual and automated workflows.

**Key Features:**
- Module-based issue types with customizable attributes
- Automatic element association from context
- Bidirectional sync with external systems (Jira, ServiceNow, GitHub)
- Advanced filtering with remote and local capabilities
- Bulk management operations
- Comment and collaboration features


---

## Creating Issues

### From Issues Page

**Basic Creation:**
1. **Navigate** to Issues page in main navigation
2. **Click "Create Issue"** button
3. **Select issue type** from dropdown (provided by loaded modules):
   - **Security Incident**: Immediate security concerns requiring rapid response
   - **Remediation Task**: Planned security improvements and fixes
   - **Compliance Issue**: Regulatory requirement violations
   - **Bug Report**: Technical defects requiring development fixes
   - **Risk Assessment**: Issues requiring further risk evaluation
4. **Configure** in issue dialog

### From Context (Automatic Association)

**From Analysis Results:**
- **Select finding** in analysis results
- **Click "Create Issue"**
- **System automatically associates**:
  - Analysis instance that identified the finding
  - Analyzed threat model
  - Involved components and data flows
  - Related exposures and vulnerabilities

**From Component Settings:**
- **Open component settings dialog**
- **Select "Create Issue"** from issue menu
- **System automatically associates**:
  - The specific component
  - Parent model containing the component
  - Related data flows and boundaries

**From Model Dialog:**
- **Right-click model** in Browser or **click model name** in editor
- **Select "Create Issue"** from issue menu
- **System automatically associates**:
  - The specific model
  - All components within the model
  - Associated controls and analyses

### Adding Elements to Existing Issues

The clipboard-based workflow allows you to add findings and elements to existing issues:

**The "Add to Issue" Workflow**:

1. **From Any Context** (analysis results, component settings, model dialog):
   - Select a finding or element you want to add to an existing issue
   - Choose **"Add to Issue"** from the issue menu
   - System copies the element to internal clipboard
   - **Automatic redirect** to Issues page

2. **Find Your Target Issue**:
   - Use filtering to locate the existing issue you want to enhance
   - Apply relevant filters to narrow results
   - Open the target issue dialog

3. **Complete the Association**:
   - Click **"Add from Clipboard"** button in the issue dialog
   - System automatically associates the clipboard element
   - **Automatic comment** documents what was added and when

4. **Navigation and Management**:
   - **Associated Elements tab**: View all elements linked to the issue
   - **Navigation buttons**: Click elements to return to their source location
   - **Unassociate capability**: Remove elements from issues if needed
   - **Return functionality**: Navigate back to original context

This workflow enables building comprehensive issues from multiple sources while maintaining full traceability.

---

## Advanced Filtering

The Issues page provides sophisticated filtering capabilities combining server-side and client-side processing for optimal performance.

### Filter Syntax

**Remote Filtering (Server-side):**

```
key:value
```
- Processed on server before data retrieval
- No logical operators supported
- Efficient for large datasets
- Immediate results without loading full dataset

**Local Filtering (Client-side):**

```
(key:value AND/OR key:value)
```
- Processed on already-loaded data in browser
- Supports complex boolean logic
- Enables nested object searching
- Combined with AND logic when using multiple conditions

### Available Filter Keys

**Remote Filter Keys:**
- `name` - Issue name/title
- `issueId` - Specific issue identifier
- `classId` - Issue class identifier
- `elementIds` - IDs of associated elements
- `classType` - Type of issue class (incident, task, bug, etc.)
- `moduleId` - Identifier of module providing issue type
- `moduleName` - Name of module providing issue type
- `issueStatus` - Current status (open, closed, in-progress, resolved)

**Local Filter Keys:**
- `id`, `name`, `description` - Basic issue properties
- `type`, `category` - Issue classification and categorization
- `open` - Boolean status (true/false)
- `class.name`, `class.type` - Issue class properties
- `attributes.*` - Any custom attribute from syncedAttributes
- **Nested searching**: Automatically searches deeply in nested objects

### Filter Menu Buttons

**Remote Filter Buttons:**
- **Class**: Filter by issue class types (dropdown selection)
- **Issue Status**: Filter by status (open/closed/in-progress/resolved)

**Local Filter Buttons:**
- **Status**: Local status filtering with boolean logic
- **Severity**: Filter by severity levels (critical/high/medium/low)
- **Likelihood**: Filter by likelihood assessment

**Default Behavior:**
- Issues page shows **open issues by default**
- Filter buttons combine with AND logic when multiple are selected
- Remote and local filters can be used simultaneously

### Practical Filtering Examples

**Basic Filtering:**

```
name:'Payment Security'
issueStatus:open
classType:vulnerability
```

**Complex Local Filtering:**

```
(type:threat AND category:high)
(severity:critical OR severity:high)
(attributes.assignee:'John Doe' AND open:true)
```

**Nested Attribute Searching:**

```
(severity:high)                    # Deep search in attributes
(attributes.severity:high)         # Direct nested path
(attributes.customField.priority:urgent)  # Multi-level nesting
```

**Combined Remote and Local:**

```
issueStatus:open (severity:high AND type:security)
```

**Advanced Examples:**

```
classType:vulnerability (name:SQL OR description:injection)
moduleName:WebSecurity (severity:critical AND assignee:'Security Team')
elementIds:comp123 (status:new OR status:assigned)
```

---

## Issue Management Operations

### Bulk Operations

**Selection:**
- **Individual**: Click checkbox on each issue
- **Page**: Select all issues on current page
- **Filtered**: Select all issues matching current filter

**Available Bulk Actions:**
- **Status Updates**: Change status across multiple issues
- **Assignment**: Assign multiple issues to team members
- **Priority Changes**: Update priority levels in bulk
- **Tag Management**: Add or remove tags from multiple issues
- **Issue Merging**: Consolidate multiple related issues into a single issue
- **Export**: Export selected issues to various formats
- **Delete**: Remove multiple issues (with confirmation)

### Individual Issue Management

**Quick Actions (from issue list):**
- **Status Toggle**: Click status indicator to cycle through states
- **Priority Update**: Click priority to change level
- **Assignment**: Click assignee field for quick reassignment
- **Comments**: View comment count and add quick comments

**Detailed Management (from issue dialog):**
- **Full Editing**: Complete access to all attributes and settings
- **Element Management**: Add/remove associated elements
- **Comment Threading**: Full conversation threads with history
- **Status Control**: Close or reopen issues directly from the dialog
- **Audit Trail**: View complete change history

### Status Management

**Common Status Transitions:**
- **Open → In Progress**: When work begins
- **In Progress → Resolved**: When solution implemented
- **Resolved → Closed**: When resolution verified
- **Any → Open**: When issue needs reopening

### Issue Merging

**When to Merge Issues:**
- **Duplicate issues**: Multiple reports of the same problem
- **Related issues**: Issues that share common root causes
- **Fragmented tracking**: Issues that should be handled as single unit
- **Consolidated reporting**: Combining similar findings for unified response

**Merge Process:**
1. **Select Issues**: Choose multiple issues to merge on the Issues page
   - Use checkboxes to select target issues
   - Ensure issues are logically related or duplicates

2. **Initiate Merge**: Click the **merge button** (link symbol) on the top right corner
   - Button becomes active when multiple issues are selected
   - Opens merge configuration menu

3. **Configure Merge**: Select issue type for the new consolidated issue
   - **Dropdown menu**: Shows available issue types from loaded modules
   - **Type selection**: Choose most appropriate type for merged issue
   - **Consider scope**: Select type that encompasses all merged issues

4. **Automatic Consolidation**: System creates new issue with combined data:
   - **Descriptions**: All descriptions from merged issues combined
   - **Comments**: Complete comment history from all issues preserved
   - **Associated Elements**: All associated models, components, analyses, etc. combined
   - **Attributes**: Relevant attributes consolidated based on issue type
   - **Created By**: Shows merge operation and original issue references

5. **Original Issue Closure**: Merged issues are automatically closed:
   - **Status**: Changed to "Closed"
   - **Closure Comment**: Automatic comment indicating merge operation
   - **Reference**: Link to new consolidated issue included
   - **Audit Trail**: Complete history of merge operation preserved

**Post-Merge Actions:**
- **Review consolidated issue**: Verify all relevant information was preserved
- **Update attributes**: Adjust consolidated issue attributes as needed
- **Notify stakeholders**: Inform relevant parties of consolidation
- **Update external systems**: Remote integrations reflect merge operation

---

## Remote System Integration

### Supported Systems

**Jira Integration:**
- **Issue Creation**: Automatic Jira ticket creation
- **Status Sync**: Bidirectional status synchronization
- **Comment Sync**: Comments reflected in both systems
- **Attachment Support**: File attachments synchronized
- **Custom Field Mapping**: Module-defined field mappings

**ServiceNow Integration:**
- **Incident Management**: Create ServiceNow incidents
- **Change Requests**: Link to change management process
- **Knowledge Base**: Integration with ServiceNow KB
- **SLA Tracking**: Service level agreement monitoring

**GitHub Integration:**
- **Issue Tracking**: Create GitHub issues for technical fixes
- **Pull Request Linking**: Associate code changes with security issues
- **Milestone Tracking**: Link issues to development milestones
- **Label Management**: Sync tags with GitHub labels

### Configuration and Setup

**Module Configuration:**
- Issue integration configured through module settings
- Each issue type can specify different integration targets
- Authentication credentials stored securely
- Field mapping configured per issue class

**Sync Behavior:**
- **Creation**: Issue created in both systems immediately
- **Updates**: Changes sync within configurable intervals
- **Conflict Resolution**: Last-write-wins with audit trail
- **Error Handling**: Failed syncs queued for retry with notification


---

## Best Practices

### Filtering Strategies

**Performance Optimization:**
- **Use remote filters first** for large datasets
- **Combine with local filters** for complex criteria
- **Save frequent filters** as bookmarks or shortcuts
- **Use specific keys** rather than broad searches

**Filter Organization:**
- **Team Views**: Create filters for team-specific issues
- **Priority Views**: Separate high-priority from routine issues
- **Timeline Views**: Filter by due dates and age
- **Component Views**: Focus on specific system components

### Issue Management Workflow

**Issue Creation Best Practices:**
- **Use descriptive names** that clearly identify the problem
- **Create from context** when possible (analysis results, component settings, model dialogs) for automatic element association
- **Use clipboard workflow** to build comprehensive issues from multiple sources
- **Set appropriate priority** based on business impact and urgency

**Navigation Best Practices:**
- **Use "Add to Issue" workflow** to build issues incrementally from different contexts
- **Leverage automatic redirection** to Issues page when using clipboard functionality
- **Use Associated Elements tab** to navigate back to source locations
- **Take advantage of bidirectional navigation** between issues and models/analyses

**Issue Tracking:**
- **Clear ownership**: Every issue should have a clear assignee
- **Status updates**: Keep status current and accurate
- **Documentation**: Use comments to track investigation and resolution
- **Element associations**: Use "Add to Issue" to build comprehensive issues from multiple sources

---

**Next Steps:**
- **[Security Analysis Workflow](security-analysis-workflow.md)**: Learn how to create issues from analysis results
- **[Working with Security Controls](working-with-security-controls.md)**: Understand how controls relate to issue resolution
- **[Complete Examples](complete-examples.md)**: See issue management in real-world scenarios