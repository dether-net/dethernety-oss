# Frontend Architecture Documentation

> Frontend architecture for the Dethernety platform

## Documentation Overview

This documentation provides a complete picture of the Dethernety frontend architecture, from high-level overviews to detailed implementation specifications.

---

## Quick Navigation

### Summary Documents

| Document | Audience | Description |
|----------|----------|-------------|
| [Technical Overview](./TECHNICAL_OVERVIEW.md) | Developers, Contributors | Technical overview |
| [Frontend Architecture](./FRONTEND_ARCHITECTURE.md) | Technical Leaders, Architects | Full architecture reference |

### Detailed Technical Documentation

| Document | Description |
|----------|-------------|
| [Data Architecture](./LLD/Data%20architecture/) | Data models and state management patterns |

---

## Document Hierarchy

```
docs/architecture/frontend/
│
├── README.md                    ← You are here (Navigation Guide)
├── TECHNICAL_OVERVIEW.md        ← Technical overview
├── FRONTEND_ARCHITECTURE.md     ← Full architecture reference
│
└── LLD/Data architecture/       ← Data architecture documentation
```

---

## Reading Guide

1. [Technical Overview](./TECHNICAL_OVERVIEW.md) - Architecture overview and key concepts
2. [Frontend Architecture](./FRONTEND_ARCHITECTURE.md) - Detailed architecture reference
3. [Data Architecture](./LLD/Data%20architecture/) - Data flow and state management

---

## Technology Stack

- **Framework**: Vue 3 with Composition API and TypeScript
- **UI**: Vuetify (Material Design)
- **State**: Pinia with persistence
- **Data**: Apollo Client (GraphQL)
- **Diagrams**: Vue Flow
- **Forms**: JSONForms
- **Build**: Vite

---

## Related Documentation

- [System Architecture](../README.md) - Full system overview (frontend, backend, AI)
- [Backend Architecture](../backend/) - Backend technical documentation
