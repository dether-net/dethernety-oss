# dt-ui: Dethernety Frontend Application

This is the frontend component of the Dethernety cybersecurity threat modeling framework. Built with Vue 3 and Vuetify, it provides an interactive graphical interface for designing and analyzing system data flows, threat models, and security controls.

## Features

- **Interactive Data Flow Designer**: Visual editor to create and connect system components, data flows, and security boundaries
- **Module Integration**: Support for component classes provided by loaded modules
- **Threat Visualization**: View and analyze security exposures and countermeasures
- **AI Analysis Integration**: Interface with the LangGraph analysis server
- **MITRE Framework Mapping**: Visualize connections between components, ATT&CK techniques, and D3FEND mitigations

## Architecture

The application is built with:
- **Vue 3**: Core framework
- **Vuetify**: UI component library
- **Vue Flow**: Graph visualization for data flow diagrams
- **Pinia**: State management
- **GraphQL/Apollo**: Communication with backend services
- **JSONForms**: Dynamic form generation for component configuration

## Development

### Setup

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev
```

### Project Structure

- `/src/components`: Vue components
- `/src/stores`: Pinia stores for state management
- `/src/graphql`: GraphQL queries and mutations
- `/src/views`: Application views/pages
- `/src/plugins`: Plugin configuration

### Key Components

- **Model Editor**: Main interface for creating and editing system models
- **Component Configuration**: Forms for configuring components based on their class definitions
- **Analysis View**: Interface for running and viewing AI-powered analyses
- **MITRE Integration**: Visualization of ATT&CK and D3FEND mappings

## Building for Production

```bash
pnpm build
```

## Integration with Backend

The frontend communicates with the dt-ws backend service via GraphQL APIs to:
- Persist models to the Neo4j database
- Load module definitions
- Retrieve component classes and templates
- Run AI-powered analyses
- Query MITRE ATT&CK and D3FEND data
