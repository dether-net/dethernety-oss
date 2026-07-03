# Threat Report

The **Dethernety Threat Report** is a pure, read-only reporting module layered over an existing threat model. It mounts through the platform's native analysis lifecycle — no `dt-ui`, `dt-ws`, or `dt-core` changes — and computes a point-in-time **snapshot** of the model when an analyst runs it, persisting that snapshot on the standing `Analysis` node. Opening the results renders a single Vue application over that snapshot, presenting six analyst-facing surfaces: a posture roll-up, a MITRE ATT&CK coverage matrix, flow-route reachability, boundary crossings layered with a declared-zone data-flow policy, the residual-risk findings ledger, and a per-element drill-down. The report is engineered to under-claim: at every step it prefers an honest gap to a flattering aggregate.

Start with [`architecture.md`](./architecture.md) for the system overview and the snapshot lifecycle, then descend into the deeper documents below.

## Documentation map

| Document | What it covers |
|---|---|
| [`architecture.md`](./architecture.md) | System overview — what the module is, the snapshot lifecycle end to end, the backend/frontend split, and the pure-compute pattern. The orientation layer. |
| [`backend.md`](./backend.md) | The server-side module: how it mounts, the three gather passes, the atomic snapshot write, the live fingerprint query, and database portability. |
| [`frontend.md`](./frontend.md) | The Vue application: host integration, the pure-library / thin-component layering, each surface, the in-component navigation model, and export. |
| [`data-model.md`](./data-model.md) | The field-level data contracts — the `SnapshotDoc`, the ledger, the model graph, the graded coverage payload, and the join keys that tie them together. |
| [`design-principles.md`](./design-principles.md) | Why the report is built to under-claim — the honesty and accuracy contracts each surface enforces, mapped to the code. |

## Module at a glance

**What it is**

- A pure `DTModule` implementing the analysis interface directly — one backend TypeScript class plus one Vite-bundled Vue application.
- A point-in-time snapshot generator and a thin viewer over that snapshot.
- Self-contained: it appears in a model's **Analysis** tab with no platform code edits.

**What it is not**

- Not a modeling module — it contributes no component, control, exposure, or policy classes, and runs no AI or policy evaluation.
- Not a live dashboard — it never live-queries the model graph to draw its surfaces; everything renders from the persisted snapshot.
- Not a writer — it owns no disposition or mutation path; triage is routed back to the host's own dialog.

**Key dependency**

The **Coverage & Gaps** surface is enriched by graded MITRE coverage facts from the sibling [`dethernety-coverage-tools`](../dethernety-coverage-tools/README.md) module, fetched live and joined to the snapshot ledger by exposure id. That module is a manifest dependency, so installing the threat report installs it too. When it is absent, the coverage surface degrades gracefully — the report renders without it and never fabricates a coverage grid.

## Module source

The implementation lives at [`oss/modules/dethernety-threat-report/`](../../../modules/dethernety-threat-report/) — the backend class under `src/`, the Vue application and its pure compute libraries under `frontend/`.

## Related documentation

| Document | Description |
|---|---|
| [`../dethernety-coverage-tools/README.md`](../dethernety-coverage-tools/README.md) | The sibling module that produces the graded MITRE coverage facts |
| [Module System Overview](../modules/README.md) | How modules load, register, and route through the platform |
| [Platform Architecture](../README.md) | The graph-native platform overview |
| [Glossary](../../GLOSSARY.md) | Platform-wide terminology |
