# dethernety-threat-report

Query-based threat reporting over an existing threat model. A **pure `DTModule`** —
no threat-modelling classes, no policies, no AI/LangGraph analysis. It mounts
entirely through the platform's native analysis lifecycle, with **no changes to
`dt-ui` / `dt-ws` / `dt-core`**.

Running the report computes a **point-in-time snapshot** of the model and persists
it on the standing `Analysis` node; opening the results renders a single Vue
application over that snapshot. The application presents six analyst-facing
surfaces — a **Posture Summary** roll-up, a **Coverage & Gaps** MITRE ATT&CK
matrix, **Reachability** flow-route analysis, structural **Boundary Crossings**, the
**Residual Risk** findings ledger, and a per-element **Component Profile**
drill-down. The report is engineered to under-claim: at every step it prefers an
honest gap to a flattering aggregate (no single risk score, no coverage
percentage, dispositioned findings never silently dropped).

For the full architecture, see
[`oss/docs/architecture/dethernety-threat-report/`](../../docs/architecture/dethernety-threat-report/README.md).

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

## Snapshot model

The report renders over a persisted snapshot, not a live query of the model, so
its surfaces are internally consistent (every view reflects the same
as-of-generation state). A cheap structural `threatReportFingerprint` query lets
the frontend detect when the underlying model has changed since a snapshot was
generated and surface a staleness banner — re-running the report refreshes it.

The richer **Coverage & Gaps** facts come from the sibling
[`dethernety-coverage-tools`](../dethernety-coverage-tools/) module (a manifest
dependency), fetched live and joined to the snapshot ledger by exposure id. When
that module is not deployed, the coverage surface degrades gracefully — the rest of
the report is unaffected and no coverage grid is fabricated.

## Documentation

| Area | Document |
|------|----------|
| Overview + doc index | [`docs/architecture/dethernety-threat-report/README.md`](../../docs/architecture/dethernety-threat-report/README.md) |
| System overview & snapshot lifecycle | [`architecture.md`](../../docs/architecture/dethernety-threat-report/architecture.md) |
| Backend module | [`backend.md`](../../docs/architecture/dethernety-threat-report/backend.md) |
| Frontend application | [`frontend.md`](../../docs/architecture/dethernety-threat-report/frontend.md) |
| Data contracts | [`data-model.md`](../../docs/architecture/dethernety-threat-report/data-model.md) |
| Design & honesty principles | [`design-principles.md`](../../docs/architecture/dethernety-threat-report/design-principles.md) |

## Build

```bash
pnpm --filter dethernety-threat-report build
```

Runs `build:ts` → `build:frontend` (vite + copy `dist/bundle.js` → `bundle.js`) →
`build:package` (the shared `oss/scripts/package-module.js`, which co-locates
`frontend/` with the compiled backend under `dist/dethernety/dethernety-threat-report/`).
