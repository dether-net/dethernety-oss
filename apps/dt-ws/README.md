# dt-ws: Dethernety Backend Service

This is the backend service component of the Dethernety cybersecurity threat modeling framework. Built with NestJS and GraphQL, it provides the API layer between the frontend application and the Neo4j graph database, as well as integration with the LangGraph AI analysis service.

## Features

- **GraphQL API**: Comprehensive API for managing threat models, components, and analyses
- **Neo4j Integration**: Persistence of graph data representing systems, threats, and mitigations
- **Module Loading**: Dynamic loading of Dethernety modules
- **AI Analysis Bridge**: Communication with LangGraph server for AI-powered analyses
- **MITRE Framework Support**: APIs for querying and linking to ATT&CK and D3FEND frameworks

## Architecture

The application is built with:
- **NestJS**: Core framework
- **GraphQL**: API query language
- **Neo4j/GraphQL**: Database integration
- **WebSockets**: Real-time communication for analysis results

## Development

### Prerequisites

- Node.js 18+
- Neo4j Database
- LangGraph server (for AI analysis features)

### Setup

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev
```

### Project Structure

- `/src/modules`: NestJS modules
- `/src/resolvers`: GraphQL resolvers
- `/src/services`: Service layer
- `/schema`: GraphQL schema definitions
- `/src/db`: Database connection and utilities

### Key Components

- **ModelService**: Manages system models and components
- **ModuleService**: Handles loading and management of modules
- **AnalysisService**: Coordinates with LangGraph for AI analysis
- **MitreService**: Provides access to MITRE ATT&CK and D3FEND data

## GraphQL Schema

The GraphQL schema defines the core data models for the application:

- **Model**: Represents a system model containing components and boundaries
- **Component**: Represents a key entity in the system (process, database, etc.)
- **DataFlow**: Represents the flow of data between components
- **SecurityBoundary**: Represents trust boundaries within the system
- **Exposure**: Represents potential security vulnerabilities
- **Control**: Represents security controls to mitigate exposures
- **Module**: Represents a loaded module providing component classes

## Building for Production

```bash
pnpm build
```

## Integration with Other Components

The backend service integrates with:
- **dt-ui**: Provides API for the frontend application
- **Neo4j**: Persists all graph data
- **dethermine**: Communicates with the LangGraph AI analysis server
- **Modules**: Loads and provides component classes from modules
