# Dethereal (MCP Server) Architecture

This directory contains technical architecture documentation for **Dethereal**, the Dethernety MCP (Model Context Protocol) server.

## Overview

Dethereal enables AI assistants to interact with the Dethernety threat modeling platform through the standardized Model Context Protocol. It provides tools for:

- Authentication via OIDC OAuth
- Threat model creation, import, export, and updates
- Schema and class discovery
- Model validation

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Complete technical architecture overview |

## Quick Reference

### Server Details

- **Name**: `dethereal`
- **Version**: 2.0.0
- **Protocol**: MCP 1.0 (stdio transport)
- **Package**: `@dethernety/dethereal`

### Key Dependencies

| Dependency | Purpose |
|------------|---------|
| `@modelcontextprotocol/sdk` | MCP protocol implementation |
| `@dethernety/dt-core` | Platform data access layer |
| `@apollo/client` | GraphQL client |
| `zod` | Schema validation |

### Tools Summary

| Tool | Auth Required | Description |
|------|---------------|-------------|
| `login` | No | Browser-based OAuth authentication |
| `logout` | No | Clear cached tokens |
| `refresh_token` | No | Refresh expired tokens |
| `get_model_schema` | No | Get schema and guidelines |
| `get_example_models` | No | Get example templates |
| `validate_model_json` | No | Validate model structure |
| `get_classes` | Yes | Query available classes |
| `create_threat_model` | Yes | Create new model |
| `import_model` | Yes | Import from directory |
| `export_model` | Yes | Export to directory |
| `update_model` | Yes | Update existing model |
| `update_attributes` | Yes | Update element attributes |

### Configuration

```bash
# Required
export DETHERNETY_URL="https://your-instance.dethernety.io"

# Optional
export DEBUG="true"
```

## Related Documentation

- [User Guide](../../user/MCP_SERVER_GUIDE.md) - End-user documentation
- [dt-core](../dt-core/) - Data access layer architecture
- [Backend](../backend/) - GraphQL API architecture
