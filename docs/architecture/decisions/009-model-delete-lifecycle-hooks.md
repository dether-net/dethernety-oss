# ADR-009: Model-delete semantics and module lifecycle hooks

**Status:** Accepted
**Date:** 2026-05-23

## Context

`deleteModel` was a single `@cypher` directive on the GraphQL schema. A directive is one fixed Cypher statement: it can only delete what the platform itself names. That created two problems.

1. **Structural-completeness gaps.** The directive's traversal did not reach every node owned by the model — some structural elements and their model-level data and exposures were left behind, so a delete could complete while leaving orphans whose owner no longer existed.
2. **No module cleanup.** Modules own node types the platform cannot name — a directive on the platform surface cannot delete labels defined by a module. Deleting a model therefore left the module's own model-scoped nodes orphaned in the graph, with no mechanism to clean them up as part of the same operation.

A directive also cannot run procedural logic between steps (enumerate, dispatch, delete) or call into loaded modules. To make a model delete remove *everything* the model owns — core and module-defined — and to do it atomically, the delete had to move off the directive.

A second, related concern is the **pre-existing orphans** already in deployed graphs: nodes the old incomplete delete left behind before the fix landed. Those need a one-time, operator-driven cleanup that, like the delete, must reach both core and module-defined labels without the platform surface naming a module's labels.

## Decision

**Replace the `@cypher` directive with a resolver service.** `deleteModel` is backed by a resolver service that, in **one write transaction**, (a) enumerates the model's owned analyses, (b) dispatches a push-style `onModelDeleted` lifecycle hook to every loaded module, then (c) runs the structural delete over the core/structural subgraph. All participants commit or roll back together — there is no half-deleted model.

**Introduce push-style lifecycle hooks on the module interface.** `onModelDeleted(tx, modelId, analysisIds)` is the first push-style hook: the platform calls the module on a model-delete event (rather than the module pulling state) and hands it the active transaction plus the pre-enumerated analysis ids. The module removes its own model-scoped nodes on that `tx`.

**Add a second hook for the one-time orphan cleanup.** `onOrphanSweep(tx, { apply })` backs an admin-gated `sweepOrphans` mutation. The platform dispatches it to every loaded module on a single transaction — a read transaction when `apply` is `false` (count-only dry-run) and a write transaction when `apply` is `true` (delete) — then aggregates each module's per-label counts together with the core counts into one operator-facing report.

**Ownership is by label, and the hook is the seam.** The platform owns the core/structural labels (`Model`, `SecurityBoundary`, `Component`, `DataFlow`, `Data`, `Exposure`) and removes them itself. Each module owns — and is the only participant that removes — the labels it defines. The hooks let the platform say "a model was deleted" or "remove your orphans" without the platform surface ever naming a module's labels.

**Authz.** The destructive sweep is admin-gated at resolver entry. The admin check accepts the `admin` role from either the JWT `roles` claim or the `cognito:groups` claim, so the `apply` path is never reachable without it; the operation is audit-logged before any work runs.

## Consequences

**Positive:**
- **Atomicity.** The structural delete and every module's cleanup share one transaction. A throw from any hook rolls the whole operation back, so a delete (or sweep) can never partially apply and leave the graph half-cleaned.
- **Completeness across labels.** A model delete now removes both the core subgraph and the module-defined nodes the model owned. The orphan sweep gives operators a one-time, previewable way to clean up orphans the old delete left behind.
- **Clean platform/module boundary.** The platform surface names no module-specific labels. New modules participate in delete and sweep by implementing the hooks; the platform needs no change to clean up labels it does not know about.
- **Operator visibility.** The sweep's dry-run reports the would-delete node counts per label before anything is deleted, so an operator can preview the blast radius.

**Negative:**
- **Modules carry contract obligations.** Hook implementations must be transaction-bound (graph operations only on the passed `tx`), idempotent (the managed transaction may re-run the callback on a retriable error), and free of non-transactional side effects. A hook that opens its own transaction or emits an event off-`tx` breaks the all-or-nothing guarantee.
- **Order independence is required.** Invocation order across modules is unspecified, so each hook must be self-contained from its arguments and must not depend on another module's hook running first. This holds only while modules' label sets are disjoint from each other and from the core.
- **More moving parts than a directive.** The delete path is now procedural (enumerate, dispatch, delete) rather than one declarative statement, and the sweep adds an admin mutation with two modes. The transaction-bound, throw-to-abort contract keeps the behaviour observable, but it is more surface than the directive it replaced.

## References

- [ADR-001: Graph-native data model (Bolt/Cypher)](001-graph-native-data-model.md)
- [ADR-004: Executable module system](004-executable-module-system.md)
- [DTModule interface → Lifecycle Hooks (Optional)](../modules/DT_MODULE_INTERFACE.md#lifecycle-hooks-optional) — the `onModelDeleted` and `onOrphanSweep` hook contracts
- [Backend GraphQL API reference](../backend/GRAPHQL_API_REFERENCE.md#sweeporphans) — the `sweepOrphans` mutation
