# ADR-004: Executable module system

**Status:** Accepted
**Date:** 2025-01-15

## Context

Threat modeling spans many domains -- web applications, cloud infrastructure, OT/ICS, IoT, mobile. Each domain has its own component types, security controls, exposure rules, and analysis patterns. Building all of this into the core platform would make it monolithic and force every user to carry the weight of domains they don't use.

We considered three approaches:
1. **Configuration files** (YAML/JSON) -- Simple but limited. Can define component types and attributes, but cannot implement custom analysis logic, call external APIs, or react to events.
2. **Plugin system with IPC** -- Modules run in separate processes, communicating via message passing. Isolation is good, but the overhead of serialization and IPC makes tight integration with the GraphQL resolver chain impractical.
3. **Runtime-loaded JavaScript classes** -- Modules are loaded into the same process and implement a defined interface. Full platform API access, direct resolver integration, no serialization overhead.

## Decision

Modules are JavaScript/TypeScript classes that implement the `DTModule` interface and are loaded at runtime by the Module Registry Service. A module can define component classes, implement exposure detection rules, provide analysis workflows, generate templates, and compute countermeasures.

The `packages/dt-module` library provides abstract base classes (`DtNeo4jOpaModule`, `DtFileOpaModule`, `DtFileJsonModule`) that handle common patterns -- database operations, OPA policy evaluation, GraphQL integration -- so module authors focus on domain logic.

Module loading is constrained by an allowlist (`ALLOWED_MODULES` environment variable), file permission checks, size limits (10MB), and a configurable load timeout.

## Consequences

**Positive:**
- New security domains (cloud, OT, compliance) can be added as modules without platform changes.
- Modules can use any analysis approach: OPA/Rego policies, JSON logic rules, AI workflows via LangGraph, or custom code.
- The base class library reduces boilerplate. A basic module with component classes and Rego-based exposure detection can be built in a few hundred lines.
- GraphQL resolver integration is direct -- module methods are called by the resolver chain, so there's no translation layer.

**Negative:**
- Modules run in the same process. A misbehaving module can crash the server or consume excessive resources. The allowlist and load timeout mitigate this but don't fully sandbox execution.
- Module authors need to understand the DTModule interface, the base class hierarchy, and how GraphQL resolvers route requests. The learning curve is steeper than writing a config file.
- Two database-backed module types (Neo4j-OPA, File-OPA) plus JSON-logic and LangGraph variants create choice paralysis for new module authors.

## References

- [Module system overview](../modules/README.md)
- [DTModule interface](../modules/DT_MODULE_INTERFACE.md)
- [Base classes](../modules/BASE_CLASSES.md)
- [Module development guide](../modules/DEVELOPMENT_GUIDE.md)
