# CLAUDE.md — Module Development

Guide for developing Dethernety modules. For full documentation see `docs/architecture/modules/`.

## Module Package Structure

A module is a deployment unit containing any combination of optional components:

```
{module-name}/
├── manifest.json              # Required: name, version, displayName, dependencies, restarts
├── src/                       # Backend module (TypeScript) — optional
│   └── {ModuleName}Module.ts  # Must export default, must end with Module.ts
├── langgraph/                 # Analysis graphs (Python) — optional
│   ├── graphs.json            # Graph registration fragment
│   └── {graph_name}/          # One directory per graph
├── data/                      # Database ingestion (Cypher/CSV) — optional
│   ├── *.cypher               # Executed alphabetically during installation
│   └── *.csv                  # Referenced via LOAD CSV in Cypher scripts
├── frontend/                  # Vue UI components — optional
│   └── components/
├── scripts/
│   └── package.js             # Packaging script (creates tar.gz)
├── package.json
└── tsconfig.json              # Only if backend module exists
```

## Base Classes

All base classes are in `@dethernety/dt-module` (`packages/dt-module/`). Constructor signature: `(driver: any, logger: Logger)`.

| Base Class | Storage | Policy Engine | Use Case |
|-----------|---------|---------------|----------|
| `DtNeo4jOpaModule` | Graph DB | OPA/Rego | Production modules with DB-stored classes (recommended) |
| `DtLgModule` | Graph DB | — | AI analysis via LangGraph server |
| `DtFileOpaModule` | File system | OPA/Rego | Standalone/development modules |
| `DtFileJsonModule` | File system | JSON Logic | Simple rules, no OPA dependency |
| `DtNeo4jJsonModule` | Graph DB | JSON Logic | DB-stored classes with JSON Logic |

## Development Workflow

```bash
# 1. Build the module
cd modules/{module-name}
pnpm build

# 2. Copy to custom_modules for local testing
cp -r dist/{module-name}/ ../apps/dt-ws/custom_modules/{module-name}/

# 3. Start the backend (loads modules from custom_modules/ at startup)
cd ../apps/dt-ws && pnpm dev

# 4. Verify module loaded via GraphQL (http://localhost:3003/graphql)
#    query { modules { name version } }
#    query { componentClasses { id name type category } }
```

## Packaging for Distribution

```bash
# Build and create tar.gz package
pnpm build          # Compiles TS + runs scripts/package.js
                    # Output: dist/{name}-{version}.tar.gz
```

The `scripts/package.js` packaging script auto-detects and includes all components (dethernety/, langgraph/, data/, frontend/).

## Key Patterns

- **Entry point**: main file must end with `Module.js` and have a default export
- **Module node**: database-backed modules need a `DTModule` node in the graph (created via `data/01-module.cypher`)
- **Class definitions**: stored as graph nodes linked via `MODULE_PROVIDES_CLASS` relationships
- **Rego policies**: stored on class nodes, evaluated via OPA server at `OPA_COMPILE_SERVER_URL`
- **JSON Logic rules**: stored in `exposure-rules.json` / `countermeasure-rules.json` per class
- **Analysis config**: `DtLgModule` uses `LgAnalysisConfig` to define graph names, types, and input builders
- **Frontend bundles**: Vite-compiled single `bundle.js` with Vue runtime shimmed to avoid host conflicts

## Testing

- Verify module registration: `query { modules { name version } }`
- Verify class registration: `query { componentClasses { id name type } }`
- Test exposure evaluation: create a component instance, set attributes, check exposures
- Test analysis (DtLgModule): requires `LANGGRAPH_API_URL` pointing to a running graph server

## Reference Documentation

| Document | Path |
|----------|------|
| Module system overview | `docs/architecture/modules/README.md` |
| DTModule interface | `docs/architecture/modules/DT_MODULE_INTERFACE.md` |
| Base classes | `docs/architecture/modules/BASE_CLASSES.md` |
| Utility classes | `docs/architecture/modules/UTILITY_CLASSES.md` |
| Development guide | `docs/architecture/modules/DEVELOPMENT_GUIDE.md` |
| Package design | `docs/architecture/modules/MODULE_PACKAGE_DESIGN.md` |
