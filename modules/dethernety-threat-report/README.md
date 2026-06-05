# dethernety-threat-report

Query-based threat reporting over an existing threat model. A **pure `DTModule`** —
no threat-modelling classes, no policies, no AI/LangGraph analysis. It mounts
entirely through the platform's native analysis lifecycle, with **no changes to
`dt-ui` / `dt-ws` / `dt-core`**.

## How it mounts

The report is modelled as a **non-AI analysis class** (`type: 'model_analysis'`,
so it appears in a model's **Analysis** tab → **New Analysis** menu). The user
creates an instance and runs it; "run" computes a snapshot and persists it on the
standing `Analysis` node, and opening the results renders this module's Vue
component.

- **Backend** (`src/DethernetyThreatReportModule.ts`):
  - `getMetadata().analysisClasses` — declares the "Threat Report" analysis class.
  - `runAnalysis(...)` — computes the report over the model and atomically `SET`s
    the snapshot (`+ generatedAt + fingerprint`) on the `Analysis` node.
  - `getAnalysisStatus(...)` — returns a static `idle` (the report is not a
    long-running run; this keeps the "Results" action enabled).
  - `getDocument(...)` — reads the snapshot back, keyed under the frontend
    component key so the analysis-results page resolves and renders it.
  - `getSchemaExtension()` / `getResolvers()` — a cheap `threatReportFingerprint`
    query (a live structural digest) for snapshot-staleness detection. Resolvers do
    **not** implement their own authz — the JWT guard + session scoping own that.
- **Frontend** (`frontend/`): Vite-bundled Vue; `frontend/index.js` registers the
  report component into the host `componentRegistry`. The compiled bundle must land
  at `frontend/bundle.js` (the path the platform serves it from) — the build copies
  it there in `build:frontend`.

## Status

Initial walking skeleton: the mount + snapshot round-trip are wired end-to-end and
the report renders a trivial posture snapshot (component count + a structural
fingerprint). The real report surfaces (coverage, boundary-crossing, residual-risk,
posture summary) build on this.

## Build

```bash
pnpm --filter dethernety-threat-report build
```

Runs `build:ts` → `build:frontend` (vite + copy `dist/bundle.js` → `bundle.js`) →
`build:package` (the shared `oss/scripts/package-module.js`, which co-locates
`frontend/` with the compiled backend under `dist/dethernety/dethernety-threat-report/`).
