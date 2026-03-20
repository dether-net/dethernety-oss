# CLAUDE.md — dt-ui (Frontend)

Vue 3 + Vuetify + Vite interactive threat modeling UI. Architecture docs: `docs/architecture/frontend/`.

## Development

```bash
pnpm dev          # Dev server on http://localhost:3005 (HMR)
pnpm build        # Development build
pnpm build --mode production  # Production build (minified, no sourcemaps)
pnpm test         # Vitest (tests in src/utils/__tests__/*.test.ts)
pnpm lint         # ESLint
```

The Vite dev server proxies `/graphql` and `/modules` to the backend at `localhost:3003`.

## Key Directories

- `src/stores/` — 8 Pinia stores: analysisStore, authStore, controlsStore, flowStore, folderStore, issueStore, modelsStore, modulesStore
- `src/components/DataFlow/` — Vue Flow diagram editor (drag-and-drop threat modeling)
- `src/composables/` — useHostContext, useModuleManager (module system integration)
- `src/services/` — ModuleLoader (runtime module loading with host deps), ComponentRegistry
- `src/plugins/apolloClient.ts` — Apollo Client setup with auth headers
- `src/config/environment.ts` — Runtime configuration (not build-time env vars)

## Configuration

- `vite.config.mts` — Plugins: AutoImport, Components, Fonts, Vuetify. Manual chunk splitting for vendor libs (Vue, Apollo, Vuetify, Vue Flow, JSONForms).
- `vitest.config.mts` — Node environment, src root
- Path alias: `@/` maps to `src/`
