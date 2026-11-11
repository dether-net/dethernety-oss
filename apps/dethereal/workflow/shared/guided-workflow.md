## Guided Workflow Orchestration

Each step and the state it ends in; its phase file names its agent:

| Step | Name | State After |
|------|------|-------------|
| 1 | Scope Definition | SCOPE_DEFINED |
| 2 | Discovery | DISCOVERED |
| 3 | Model Review | DISCOVERED (no transition) |
| 4 | Boundary Refinement | STRUCTURE_COMPLETE |
| 5 | Data Flow Mapping | ENRICHING |
| 6 | Classification | ENRICHING (no transition) |
| 7 | Data Item Classification | ENRICHING (no state change) |
| 8 | Enrichment | ENRICHING (no state change) |
| 9 | Validation | REVIEWED, when the server grants it |
| 10 | Sync | unchanged |
| 11 | Post-Sync Linking | unchanged |

Every state change goes through {{tool:model_state}} `action: 'transition'`, one step forward at a time. The server grants REVIEWED only when Gate 2 and Gate 3 pass and no stale element is left; a refusal names the failing criteria.
