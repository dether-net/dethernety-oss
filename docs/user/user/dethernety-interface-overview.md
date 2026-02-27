---
title: 'Dethernety Interface Overview'
description: 'Understanding the main sections and navigation patterns in Dethernety to work efficiently with threat models.'
category: 'getting-started'
position: 4
navigation: true
tags: ['beginner', 'guide', 'interface', 'navigation', 'browser', 'data-flow', 'practical']
---

# Dethernety Interface Overview

*Understanding the main sections and navigation patterns in Dethernety to work efficiently with threat models.*

## Main Interface Sections

Dethernety has three primary interface areas that work together to provide a complete threat modeling workflow:

### **Browser** - Your Starting Point
*The central hub for managing models, controls, and project organization*

**What it does:**
- **Model Management**: Create, organize, and access all your threat models
- **Control Library**: Build and manage reusable security control packages
- **Project Organization**: Use folders to organize work by team, project, or system type

**Layout:**
- **Top Section**: Folder navigation with breadcrumbs and folder management
- **Bottom Section**: Models and controls display with action menu

**Key Actions:**
- **Single-click models**: Opens data flow editor for modeling
- **Right-click models**: Opens model dialog for configuration and management
- **Menu button**: Create new models and controls

### **Data Flow Editor** - Where You Build
*Visual modeling canvas for creating threat model architectures*

**What it does:**
- **Component Placement**: Drag and drop system components onto the canvas
- **Data Flow Mapping**: Connect components to show information flow
- **Security Boundaries**: Define trust zones and security perimeters
- **Real-time Configuration**: Configure components and flows as you build

**Key Features:**
- **Component Palette** (right): Available components from loaded modules
- **Model Name** (top left): Click to access model dialog
- **Canvas**: Main modeling area with drag-and-drop functionality

### **Issues** - Where You Track Actions
*Issue management system for tracking security findings and remediation*

**What it does:**
- **Finding Management**: Track security issues discovered through analysis
- **Team Coordination**: Assign and manage remediation tasks
- **External Integration**: Sync with Jira, ServiceNow, GitHub, and other tools
- **Progress Tracking**: Monitor resolution progress and completion

## Navigation Patterns

### **Standard Workflow Navigation**

**Starting Your Work:**
```
Browser → Create Model → Data Flow Editor → Analysis → Issues
```

**Continuing Existing Work:**
```
Browser → Click Model → Data Flow Editor (resume modeling)
Browser → Right-click Model → Model Dialog (configuration/analysis)
```

### **Cross-Section Navigation**

**From Data Flow Editor:**
- **To Model Dialog**: Click model name (top left)
- **To Browser**: Close editor or use browser navigation
- **To Issues**: Use issue menus from component/model dialogs

**From Model Dialog:**
- **To Data Flow Editor**: Click "Open Data Flow Editor"
- **To Issues**: Create issues from analysis results
- **To Browser**: Close dialog returns to browser

### **The Clipboard Workflow**

A unique navigation pattern for building comprehensive issues:

**How it Works:**
1. **Any Context** → Select element → "Add to Issue"
2. **Automatic Redirect** → Issues page
3. **Find Target Issue** → Use filtering
4. **Complete Association** → "Add from Clipboard"
5. **Navigate Back** → Use associated elements or return buttons

## Interface Integration Points

### **Model Dialog - The Configuration Hub**

Access from:
- **Browser**: Right-click any model
- **Data Flow Editor**: Click model name (top left)

**Primary Functions:**
- **Basic Configuration**: Name, description, modules, properties
- **Control Management**: Assign security controls to entire model
- **Analysis Management**: Configure and run security analyses
- **Issue Integration**: Create issues from analysis findings

### **Component Settings - Element Configuration**

Access from:
- **Data Flow Editor**: Double-click any component

**Key Tabs:**
- **Basic**: Component properties and class assignment
- **Controls**: Security controls for this component
- **Exposures**: Identified security risks
- **Countermeasures**: Active protection measures

### **Issue Integration Points**

Create issues from:
- **Analysis Results**: Findings become trackable issues
- **Component Settings**: Component-specific security concerns
- **Model Dialog**: Model-wide security improvements

## Efficient Work Patterns

### **New Model Creation**
```
1. Browser → Menu → "Create Model"
2. Configure basic properties and modules
3. "Open Data Flow Editor" → Start building
4. Model Dialog (click name) → Run analysis when ready
5. Analysis Results → Create issues for tracking
```

### **Continuing Existing Models**
```
1. Browser → Click model (direct to editor)
2. Continue modeling as needed
3. Model Dialog → Re-run analysis for updates
4. Issues → Track new findings
```

### **Control Development**
```
1. Browser → Menu → "Create Control"
2. Configure control classes and requirements
3. Test by assigning to model elements
4. Refine based on generated countermeasures
5. Save to control library for reuse
```

### **Issue Management**
```
1. Issues → Filter for relevant issues
2. Use "Add to Issue" from various contexts
3. Build comprehensive issues from multiple sources
4. Track progress through to resolution
```





---

**Next Steps:**
- **[Quick Start Guide](quick-start-guide.md)**: Create your first model using this interface
- **[Building Your First Model](building-your-first-model.md)**: Detailed modeling tutorial
- **[Working with Security Controls](working-with-security-controls.md)**: Control creation and management