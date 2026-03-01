---
title: 'MCP Server Guide (Dethereal)'
description: 'Complete guide to using the Dethernety MCP Server for AI-assisted threat modeling'
category: 'documentation'
position: 15
navigation: true
tags: ['mcp', 'ai', 'automation', 'integration', 'claude', 'agent']
---

# MCP Server Guide (Dethereal)

*AI-assisted threat modeling through the Model Context Protocol*

---

## Overview

**Dethereal** is Dethernety's Model Context Protocol (MCP) server. It allows AI assistants like Claude to interact with the Dethernety platform directly -- creating, validating, importing, exporting, and managing threat models through natural language conversations.

### What is MCP?

The [Model Context Protocol](https://modelcontextprotocol.io/) is an open standard that allows AI assistants to interact with external tools and services. Dethereal implements MCP to expose Dethernety's threat modeling capabilities as tools that AI can use. See [Available Tools](#available-tools) for the full reference.

---

## Quick Start

### 1. Configure Your AI Assistant

Add the Dethereal MCP server to your AI assistant's configuration. For Claude Desktop, add to your MCP settings:

```json
{
  "mcpServers": {
    "dethereal": {
      "command": "npx",
      "args": ["@dethernety/dethereal"],
      "env": {
        "DETHERNETY_URL": "https://your-instance.dethernety.io"
      }
    }
  }
}
```

Or if installed locally:

```json
{
  "mcpServers": {
    "dethereal": {
      "command": "node",
      "args": ["/path/to/dethereal/dist/index.js"],
      "env": {
        "DETHERNETY_URL": "https://your-instance.dethernety.io"
      }
    }
  }
}
```

### 2. Authenticate

When you first use a tool that requires authentication, you'll need to log in:

```
Please log in to Dethernety
```

The AI will use the `login` tool, which opens your browser to the login page. After authentication, tokens are cached locally at `~/.dethernety/tokens.json`.

### 3. Create Your First Model

Simply describe what you want to model:

```
Create a threat model for a web application with:
- A React frontend served by nginx
- A Node.js API backend
- A PostgreSQL database
- User authentication via OAuth
```

The AI will use the schema and example templates to compose a properly structured model and import it to your platform.

---

## Available Tools

### Authentication Tools

These tools manage your connection to the Dethernety platform.

#### `login`

Authenticates via browser-based OAuth. Opens your default browser to the login page.

| Parameter | Type | Description |
|-----------|------|-------------|
| `timeout` | number | Timeout in ms (default: 120000) |
| `force_new` | boolean | Force new login even if cached tokens exist |

**Behavior:**
- If valid cached tokens exist, returns immediately (no browser)
- If tokens expired but refresh token valid, refreshes automatically
- Otherwise, opens browser for OAuth login

#### `refresh_token`

Refreshes expired access tokens using a refresh token.

| Parameter | Type | Description |
|-----------|------|-------------|
| `refresh_token` | string | The refresh token from a previous login |

#### `logout`

Clears cached authentication tokens.

| Parameter | Type | Description |
|-----------|------|-------------|
| `clear_all` | boolean | Clear tokens for all platforms |

---

### Schema & Reference Tools

These tools help understand the Dethernety schema and available classes.

#### `get_model_schema`

Returns the complete JSON schema for threat models, including guidelines for proper model composition.

**Returns:**
- Complete schema definitions for all file types
- Coordinate system guidelines
- Component type reference
- Data flow handle selection guide
- Boundary hierarchy best practices
- Directory structure documentation

#### `get_example_models`

Provides example threat model templates for different architectures.

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | enum | Example type: `simple`, `web_app`, `api_service`, `database`, `microservices` |
| `file_type` | enum | Specific file to return: `manifest`, `structure`, `dataflows`, `data-items`, `attributes`, `all` |

#### `get_classes`

Discovers available classes (component types, boundary types, data types, etc.) from installed modules.

| Parameter | Type | Description |
|-----------|------|-------------|
| `class_id` | string | Find a specific class by ID |
| `name` | string | Search by name (partial match) |
| `class_type` | enum | Filter by type: `PROCESS`, `EXTERNAL_ENTITY`, `STORE`, `BOUNDARY`, `SECURITY_BOUNDARY`, `DATA_FLOW`, `DATA`, `CONTROL` |
| `category` | string | Filter by category |
| `module_id` | string | Search within a specific module |
| `module_name` | string | Search by module name |
| `fields` | array | Fields to return: `id`, `name`, `description`, `type`, `category`, `attributes`, `guide`, `module` |

---

### Model Management Tools

These tools create, import, export, and update threat models.

#### `create_threat_model`

Creates and imports a new threat model from a SplitModel JSON structure.

| Parameter | Type | Description |
|-----------|------|-------------|
| `model` | object/string | Complete threat model in SplitModel format |
| `folder_id` | string | Optional folder ID for organization |
| `directory_path` | string | Optional path to write model with server IDs |
| `include_schema` | boolean | Include schema in response (default: true) |
| `include_example` | boolean | Include example model (default: true) |
| `example_type` | enum | Type of example to include |

#### `import_model`

Imports a threat model from a split-file directory.

| Parameter | Type | Description |
|-----------|------|-------------|
| `directory_path` | string | Path to the model directory |
| `folder_id` | string | Optional folder ID for organization |
| `create_backup` | boolean | Create backup before import (default: true) |
| `disable_source_file_update` | boolean | Don't write server IDs back to files |

**After import:**
- Server-generated IDs are written back to source files
- A timestamped backup is created (unless disabled)
- ID mappings are tracked for reference

#### `export_model`

Exports a model from the platform to a split-file directory.

| Parameter | Type | Description |
|-----------|------|-------------|
| `model_id` | string | ID of the model to export |
| `directory_path` | string | Export location (default: `./{model_id}/`) |
| `if_exists` | enum | Action if exists: `backup`, `update`, `error` |

#### `update_model`

Updates an existing model from a split-file directory.

| Parameter | Type | Description |
|-----------|------|-------------|
| `model_id` | string | ID of the model to update |
| `directory_path` | string | Path to the model directory |
| `delete_orphaned` | boolean | Delete elements not in update data (default: true) |
| `create_backup` | boolean | Create backup before update (default: true) |
| `disable_source_file_update` | boolean | Don't export back to source directory |

#### `update_attributes`

Updates only the attributes for elements in a model, without modifying structure.

| Parameter | Type | Description |
|-----------|------|-------------|
| `model_id` | string | ID of the model |
| `directory_path` | string | Path to model directory with `attributes/` subdirectory |

#### `validate_model_json`

Validates model structure without importing.

| Parameter | Type | Description |
|-----------|------|-------------|
| `directory_path` | string | Path to model directory to validate |
| `data` | object/string | Inline JSON data to validate |
| `file_type` | enum | Type when validating inline: `manifest`, `structure`, `dataflows`, `data-items`, `attributes` |

**Validates:**
- Schema compliance for each file
- Cross-reference integrity (dataflow sources/targets exist)
- Attribute file references match elements

---

## Directory Structure

Dethereal uses a **split-file directory format** for threat models:

```
model-directory/
├── manifest.json           # Model metadata, modules, file references
├── structure.json          # Boundary and component hierarchy
├── dataflows.json          # Data flow connections
├── data-items.json         # Data classification items
└── attributes/             # Per-element attribute files
    ├── boundaries/
    │   └── {boundary-id}.json
    ├── components/
    │   └── {component-id}.json
    ├── dataFlows/
    │   └── {dataflow-id}.json
    └── dataItems/
        └── {dataitem-id}.json
```

### File Purposes

| File | Required | Purpose |
|------|----------|---------|
| `manifest.json` | Yes | Model metadata, schema version, module references |
| `structure.json` | Yes | Hierarchical boundary and component layout |
| `dataflows.json` | Yes | Array of data flow connections |
| `data-items.json` | No | Array of data classification items |
| `attributes/` | No | Per-element configuration in individual files |

### ID Handling

When creating models:
1. Use **temporary reference IDs** (any unique string, UUIDs recommended)
2. These IDs link elements (e.g., dataflow source/target references)
3. After import, **server-generated IDs** replace your reference IDs
4. IDs are written back to your source files automatically

---

## Version Control and File-Based Persistence

The split-file directory format is designed to work with version control. Since models are plain JSON files, you can:

- **Store models alongside your code** -- keep threat models in your repository, next to the source code they describe
- **Track changes over time** -- git diff shows exactly what changed in your model between commits
- **Review model changes in PRs** -- model updates go through the same review process as code
- **Branch and merge** -- work on model changes in feature branches, merge when ready
- **Back up models** -- any file backup strategy works (git, cloud sync, snapshots)

This means your threat models follow the same lifecycle as your code. When a service changes, the model update can land in the same commit or pull request.

The export/import tools support this workflow directly: `export_model` writes files to disk, you edit or enrich them, and `import_model` or `update_model` pushes changes back to the platform. The `create_backup` parameter (enabled by default) creates timestamped copies before any destructive operation.

For workflow examples using these tools, see [AI-Powered Workflows](AI_POWERED_WORKFLOWS.md).

---

## Best Practices

### Model Design

1. **Create proper hierarchy** - Don't flatten everything under the default boundary
2. **Use trust zones** - Separate Internet, DMZ, and Internal networks
3. **External entities outside** - Users and external systems should be in separate boundaries
4. **Meaningful names** - Use descriptive names for components and data flows
5. **Assign classes** - Apply appropriate classes to enable security analysis

### File Management

1. **Use version control** - Keep your model directories in git
2. **Enable backups** - Let the tools create timestamped backups
3. **Review ID mappings** - After import, check that IDs were written back correctly
4. **Validate first** - Always validate before importing to catch errors early

### Security

1. **Don't commit tokens** - The `~/.dethernety/` directory should not be in version control
2. **Use refresh tokens** - They're valid for 30 days vs hours for access tokens
3. **Logout when done** - Clear tokens on shared machines

---

## Troubleshooting

### Authentication Issues

**"Authentication required" error:**
- Run the `login` tool to authenticate
- Check that `DETHERNETY_URL` is set correctly
- Verify network connectivity to the platform

**Token expired:**
- Tokens refresh automatically when possible
- If refresh fails, run `login` with `force_new: true`

### Import Failures

**"Invalid source reference" error:**
- A dataflow references a component that doesn't exist
- Check that all source/target IDs in `dataflows.json` match IDs in `structure.json`

**"Not a valid model directory" error:**
- Ensure `manifest.json` exists in the directory
- Check file permissions

### Validation Errors

**Schema validation failures:**
- Use `get_model_schema` to review the expected structure
- Compare your files against the example models

**Cross-reference warnings:**
- Attribute files reference elements that don't exist
- Usually safe to ignore if elements were intentionally removed

---

## Related Documentation

- [AI-Powered Workflows](AI_POWERED_WORKFLOWS.md) - Use cases, natural language examples, and discovery workflows
- [Building Your First Model](BUILDING_YOUR_FIRST_MODEL.md) - Manual model creation
- [Understanding Modules](UNDERSTANDING_MODULES.md) - Module system concepts

---

**Need Help?** Contact your system administrator or check the [architecture documentation](../architecture/dethereal/ARCHITECTURE.md) for technical details.
