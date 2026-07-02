# ADR-011: Post-commit module install hook (`afterInstall`)

**Status:** Accepted
**Date:** 2026-07-01

## Context

Module install writes every loaded module's `:Module` node and its element classes inside **one write transaction** (`updateAllModules`). Some modules need to do graph work that references their **own** `:Module` node — for example, linking a bespoke node the module seeds to its `(:Module {name})`.

There was no lifecycle point where a module could do this safely:

1. **No hook sees the module's own committed node.** Every existing module hook (`getMetadata`, the class-upsert path, `onModelDeleted`, `onOrphanSweep`) runs either *before* the `:Module` node is written or inside the same uncommitted write transaction. A `MATCH (:Module {name})` from a fresh session finds nothing until that transaction commits.
2. **The in-transaction hooks are the wrong shape.** `onModelDeleted` and `onOrphanSweep` are handed a live `tx` and forbidden from opening their own session, because their writes must commit or roll back with the platform's. That discipline is exactly wrong for install-time work that needs the *already-committed* node to be visible.

Modules could not, therefore, reliably attach their own reference data to their `:Module` node as part of install — the one write that most obviously belongs to install-time setup was the one no hook could express.

## Decision

**Add a post-commit `afterInstall(ctx)` hook to the module interface.** After the module-upsert write transaction commits, the platform iterates the installed set and invokes each module's optional `afterInstall`, handing it a `ModuleInstallContext` of `{ driver, moduleName, databaseName }`.

The design turns on four properties:

**Post-commit, own session.** Unlike the in-transaction hooks, `afterInstall` receives the raw `driver` — not a `tx`. It runs strictly after the upsert commits, so the module's own `:Module` node is committed and visible. The hook opens (and closes) its own session from `ctx.driver`; the platform does not manage or roll back its writes.

**Idempotent (MERGE, not CREATE).** The hook is invoked on both freshly-installed modules and content-hash-skipped (unchanged) modules, so an unchanged module re-runs its hook on every boot. It may also run again after a self-heal reinstall. Implementations must therefore be idempotent.

**Isolated, self-healing failure.** A throw — or exceeding the module-load timeout (`MODULE_LOAD_TIMEOUT`, default 30 000 ms) — is caught and logged, and downgrades **only this module** (`SET m.lastInstallStatus = 'partial'`). The content-hash skip gate reinstalls a `partial` module on the next boot and re-invokes its hook, so a transient failure self-heals. Sibling modules in the same batch are unaffected, and the hook never fails the install.

**Also fired on operator reset.** The single-module reset path (`resetSingleModule`) re-runs the hook post-commit for the reset module, so an operator fixing a broken module re-triggers its install-time graph work.

## Consequences

**Positive:**
- **A lifecycle point that sees the committed node.** Modules can finally do graph work referencing their own `:Module` node — the guarantee no earlier hook offers.
- **No new failure mode for install.** Because failure is caught and isolated to a `partial` downgrade, a broken hook can never fail the install or take down sibling modules. The skip gate already reinstalls `partial` modules, so the self-heal reuses an existing mechanism rather than adding one.
- **Clean separation from the in-transaction hooks.** The raw-`driver`/own-session shape makes the post-commit timing explicit at the type level (`ModuleInstallContext` carries a `driver`, not a `tx`), so the contract is hard to misread.

**Negative:**
- **The idempotency burden shifts to the module.** The hook re-runs on every boot for unchanged modules and again after self-heal, so a `CREATE`-based implementation would duplicate data. Implementations must MERGE.
- **Writes are not rolled back.** Since the hook runs post-commit on its own session, a partial write survives a later throw. The self-heal reinstall re-runs the hook, but only idempotent (MERGE-based) writes make that safe — a non-idempotent hook leaves drift the platform will not clean up.
- **Not transactional with the install.** The `:Module` node commits whether or not the hook succeeds; the hook's effect is eventually-consistent (via self-heal), not atomic with install. Modules that need atomicity with the structural install cannot use this hook.

## References

- [ADR-004: Executable module system](004-executable-module-system.md)
- [ADR-009: Model-delete semantics and module lifecycle hooks](009-model-delete-lifecycle-hooks.md) — the in-transaction lifecycle hooks this one is a sibling to
- [DTModule interface → Lifecycle Hooks (Optional)](../modules/DT_MODULE_INTERFACE.md#lifecycle-hooks-optional) — the `afterInstall` authoring contract
- [ModuleManagementService → afterInstall invocation](../backend/LLD/MODULE_MANAGEMENT_SERVICE.md#afterinstall-post-commit-hook-invocation) — the invocation mechanism
