# Frontend Architecture Documentation

> Comprehensive technical documentation for the Dethernety frontend platform

## Documentation Overview

This documentation provides a complete picture of the Dethernety frontend architecture, from executive summaries suitable for due diligence to detailed implementation specifications.

---

## Quick Navigation

### Executive & Summary Documents

| Document | Audience | Description |
|----------|----------|-------------|
| [Technical Overview](./TECHNICAL_OVERVIEW.md) | Executives, Investors | High-level technical summary for due diligence |
| [Frontend Architecture](./FRONTEND_ARCHITECTURE.md) | Technical Leaders, Architects | Comprehensive architecture overview |

### Detailed Technical Documentation

| Document | Description |
|----------|-------------|
| [Data Architecture](./Data%20architectire/) | Data models and state management patterns |

---

## Document Hierarchy

```
docs/architecture/frontend/
│
├── README.md                    ← You are here (Navigation Guide)
├── TECHNICAL_OVERVIEW.md        ← Executive summary for due diligence
├── FRONTEND_ARCHITECTURE.md     ← Comprehensive architecture overview
│
└── Data architectire/           ← Data architecture documentation
```

---

## Reading Guide

### For Investment Due Diligence

1. Start with [Technical Overview](./TECHNICAL_OVERVIEW.md) - Executive-level summary
2. Review [Frontend Architecture](./FRONTEND_ARCHITECTURE.md) - Complete technical picture
3. Reference [Backend Architecture](../backend/TECHNICAL_OVERVIEW.md) - Backend integration

### For Technical Evaluation

1. [Frontend Architecture](./FRONTEND_ARCHITECTURE.md) - Architecture patterns and design
2. [Backend Architecture](../backend/BACKEND_ARCHITECTURE.md) - API layer details
3. [Data Architecture](./Data%20architectire/) - Data flow and state management

### For Development Teams

1. [Frontend Architecture](./FRONTEND_ARCHITECTURE.md) - Implementation patterns
2. Code structure in `apps/dt-ui/src/`
3. Store implementations in `apps/dt-ui/src/stores/`

---

## Key Architecture Highlights

### Technology Stack

- **Framework**: Vue 3.5+ with Composition API
- **Language**: TypeScript 5.9+
- **UI**: Vuetify 3.9+ (Material Design)
- **State**: Pinia 3.0+ with persistence
- **Data**: Apollo Client 3.14+ (GraphQL)
- **Diagrams**: Vue Flow 1.47+
- **Forms**: JSONForms 3.7+
- **Build**: Vite 7.2+

### Key Features

- Interactive data flow diagram editor (Vue Flow)
- Real-time AI analysis results (GraphQL subscriptions)
- Dynamic form generation (JSONForms)
- Runtime module loading system
- Multi-provider OIDC authentication

### Architecture Patterns

- Composition API-based state management
- File-based routing with auto-generation
- Optimistic updates for responsive UI
- Dual subscription transport (SSE/WebSocket)
- Dynamic component registration

---

## Related Documentation

- [System Architecture](../architecture.md) - Full system overview (frontend, backend, AI)
- [Backend Architecture](../backend/) - Backend technical documentation
- [Infrastructure Architecture](../infrastructure/) - Deployment and infrastructure
- [Configuration Guide](../../CONFIGURATION_GUIDE.md) - Configuration reference
