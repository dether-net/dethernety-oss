import { DTMetadata } from './module-metadata-interface';
import { Exposure } from './exposure-interface';
import { Countermeasure } from './countermeasure-interface';
import { ModuleResolverContext, ResolverMap } from './module-resolver-interface';
import { AnalysisSession, AnalysisStatus } from '@dethernety/dt-core';
import { PubSubEngine } from 'graphql-subscriptions';

export interface ExtendedPubSubEngine extends PubSubEngine {
  asyncIterator<T>(triggers: string | string[]): AsyncIterator<T>;
}

/**
 * Context handed to {@link DTModule.afterInstall}. Unlike the in-transaction
 * hooks ({@link DTModule.onModelDeleted} / {@link DTModule.onOrphanSweep}),
 * which receive a live `tx`, this carries the raw `driver` — the hook runs
 * POST-COMMIT and manages its own session/transaction.
 */
export interface ModuleInstallContext {
  /**
   * Raw neo4j-driver `Driver`. Typed `any` to match this package's
   * transaction-callback convention and avoid pulling a neo4j-driver
   * dependency into the module base library. Not sandboxed — modules are
   * fully trusted (same posture as the raw `tx` the in-tx hooks receive).
   */
  driver: any;
  /** This module's name — equals its `:Module {name}` in the graph. */
  moduleName: string;
  /** The database the platform installed into (for `driver.session({ database })`). */
  databaseName: string;
}

export interface DTModule {
  getMetadata(): DTMetadata | Promise<DTMetadata>;

  /**
   * Release resources this instance owns, immediately before the platform
   * discards it (module hot-reload, admin reset, or a failed load).
   *
   * Optional, synchronous, and best-effort: the platform calls it inside a
   * try/catch, so a throwing implementation never fails the reload. It must be
   * idempotent — a second call is a no-op.
   *
   * Required whenever a module holds memory the JS garbage collector cannot
   * reach. The in-process Rego evaluator is the motivating case: its policies
   * live on a WebAssembly heap that `FinalizationRegistry` does not observe, so
   * a discarded instance would strand its entire parsed policy set.
   *
   * A call already in flight on the discarded instance may fail after disposal.
   * That is intended — an evaluator must report that it is gone rather than
   * read freed memory.
   */
  dispose?(): void;

  getModuleTemplate?(): Promise<string>;
  getClassTemplate?(id: string): Promise<string>;
  getClassGuide?(id: string): Promise<string>;
  getExposures?(id: string, classId: string): Promise<Exposure[]>;
  getCountermeasures?(id: string, classId: string): Promise<Countermeasure[]>;

  runAnalysis?(id: string, analysisClassId: string, scope: string, pubSub: ExtendedPubSubEngine, additionalParams?: object): Promise<AnalysisSession>;
  startChat?(id: string, analysisClassId: string, scope: string, userQuestion: string, pubSub: ExtendedPubSubEngine, additionalParams?: object): Promise<AnalysisSession>;
  resumeAnalysis?(id: string, analysisClassId: string, input: any, pubSub: ExtendedPubSubEngine): Promise<AnalysisSession>;
  getAnalysisStatus?(id: string): Promise<AnalysisStatus>;
  getAnalysisValueKeys?(id: string): Promise<string[]>;
  getAnalysisValues?(id: string, valueKey: string): Promise<object>;
  getDocument?(id: string, analysisClassId: string, scope: string, filter: object): Promise<object>;
  deleteAnalysis?(id: string): Promise<boolean>;
  stopAnalysis?(id: string): Promise<boolean>;

  /**
   * Lifecycle event — the platform deleted a model. Modules that own
   * model-scoped nodes implement this to remove them in the SAME write
   * transaction as the structural delete, so everything commits or rolls
   * back together. Invocation order across modules is unspecified; each
   * implementation must be self-contained from { modelId, analysisIds }
   * (no module may depend on another's nodes being deleted first).
   *
   * Contract — the implementation MUST:
   *   - perform ONLY graph operations on the passed `tx` (no own session/tx,
   *     so a rollback reverts the hook's writes too); and
   *   - be idempotent and free of non-transactional side effects (no event
   *     emit, external call, counter, or off-`tx` write): the platform runs
   *     the delete inside a managed transaction that may RE-RUN the whole
   *     callback — and thus this hook — on a retriable error. Re-running
   *     `DETACH DELETE`-style graph ops is safe; a non-`tx` side effect would
   *     be doubled and never rolled back.
   *
   * @param tx          The active write transaction (driver `Transaction`).
   *                    Typed `any` to match this package's transaction-
   *                    callback convention and avoid pulling a neo4j-driver
   *                    dependency into the module base library.
   * @param modelId     The deleted model.
   * @param analysisIds The model's owned analyses, pre-collected by the
   *                    platform so the hook needn't re-enumerate them.
   * @returns Deleted node/relationship counts to fold into the platform's
   *          deletion stats, or void.
   *
   * This is the first push-style lifecycle hook on the interface — the
   * platform calls the module on a model-delete event, rather than the
   * module pulling state.
   */
  onModelDeleted?(
    tx: any,
    modelId: string,
    analysisIds: string[],
  ): Promise<{ nodesDeleted: number; relationshipsDeleted: number } | void>;

  /**
   * Lifecycle/maintenance event — the platform is running a one-time, graph-wide
   * sweep of pre-existing orphans (nodes whose owner was deleted before the
   * delete path cascaded fully). Modules that own node types implement this to
   * remove their own orphaned nodes on the passed `tx`. The platform aggregates
   * each module's per-label counts into one operator-facing report; it never
   * names a module's labels itself.
   *
   * Two modes, selected by `opts.apply`:
   *   - `apply: false` (dry-run) — COUNT only. MUST NOT mutate the graph; the
   *     platform runs this on a READ transaction. Returns the would-delete
   *     counts so an operator can preview the blast radius.
   *   - `apply: true` — DELETE the orphans and return actual counts. The
   *     platform runs this on a WRITE transaction.
   * The dry-run count and the apply count for the same graph state must agree
   * per label (the sweep's self-consistency contract).
   *
   * Contract — same discipline as {@link onModelDeleted}: graph operations ONLY
   * on the passed `tx` (a rollback reverts the hook), idempotent (a second sweep
   * is a no-op `{}`), and free of non-transactional side effects (the managed
   * transaction may re-run the callback on a retriable error). An implementation
   * MAY throw to abort the whole sweep — e.g. a data-integrity precondition that,
   * if violated, means deleting would risk live data; the throw rolls back the
   * transaction and surfaces as an error.
   *
   * @param tx        The active transaction (read on dry-run, write on apply).
   *                  Typed `any` per this package's transaction-callback
   *                  convention.
   * @param opts.apply Whether to delete (`true`) or only count (`false`).
   * @returns Per-label deleted/would-delete counts plus the node/relationship
   *          totals to fold into the platform's report, or void.
   *
   * This is the second push-style lifecycle hook on the interface (sibling to
   * {@link onModelDeleted}).
   */
  onOrphanSweep?(
    tx: any,
    opts: { apply: boolean },
  ): Promise<{
    byLabel: Record<string, number>;
    nodesDeleted: number;
    relationshipsDeleted: number;
  } | void>;

  /**
   * Lifecycle event — the platform has finished installing this module's
   * `:Module` node (and its element classes). Runs ONCE per install/reinstall,
   * AFTER the multi-module write transaction commits, so the module's own
   * `:Module` node is guaranteed to exist and be visible to a fresh session.
   * Modules that must do graph work referencing their own node — e.g. linking
   * a bespoke node to `(:Module {name})` — implement this. There is no earlier
   * hook that can see the node: every other module hook fires *before* the node
   * is written.
   *
   * Contrast with {@link onModelDeleted} / {@link onOrphanSweep}: those run
   * INSIDE a platform-managed transaction on a passed `tx`. This one runs
   * POST-COMMIT on the module's OWN session, opened from `ctx.driver` — the
   * platform does not manage or roll back its writes.
   *
   * Contract — the implementation MUST:
   *   - open its own session/transaction on `ctx.driver` (do NOT hold it open
   *     beyond the call); and
   *   - be idempotent (MERGE, not CREATE): on any failure OR timeout the
   *     platform downgrades this module's install status so the next boot
   *     reinstalls it and re-invokes this hook — the hook may therefore run
   *     more than once across boots for the same logical state.
   *
   * Failure isolation: a throw (or exceeding the platform's module-load
   * timeout) is caught, logged, and downgrades ONLY this module — sibling
   * modules in the same batch are unaffected. It never fails the install.
   *
   * @param ctx { driver, moduleName, databaseName } — see {@link ModuleInstallContext}.
   */
  afterInstall?(ctx: ModuleInstallContext): Promise<void>;

  getSyncedIssueAttributes?(issueId: string, attributes: string, lastSyncAt: string): Promise<string>;

  /**
   * Return a pre-computed embedding vector for a class by name.
   *
   * Modules that ship pre-computed vectors implement this to avoid blocking
   * module install on an external embedding API call. If the module has no
   * pre-computed vector for this class+model combination, return null and the
   * platform falls back to on-the-fly embedding.
   *
   * Contract:
   *   - Must be synchronous — implementations load from files or in-memory
   *     caches, not over the network.
   *   - Must return null (not throw) when the class or model is unknown.
   *   - `className` is matched against `getMetadata()` output. Case-sensitive,
   *     exact match.
   *   - The returned array length is NOT validated by the method — the
   *     platform validates against the configured embedding dimension.
   *
   * @param className      Exact class name as returned by getMetadata().
   * @param embeddingModel The slugified embedding-model identifier. The
   *                       platform passes the slug (produced by
   *                       slugifyModelName from @dethernety/dt-module/embedding)
   *                       — never the raw EMBEDDING_MODEL value, which may
   *                       contain '/'.
   * @returns The vector if pre-computed for this model, null otherwise.
   */
  getEmbedding?(className: string, embeddingModel: string): number[] | null;

  /** Return a GraphQL SDL fragment to extend the platform schema. Optional. */
  getSchemaExtension?(): string | Promise<string | undefined> | undefined;

  /**
   * Return custom GraphQL resolvers for fields declared in this module's
   * schema extension. The returned map must only contain fields that appear
   * in the SDL returned by getSchemaExtension().
   *
   * Called once at startup. Resolver functions are closures that capture
   * shared resources from the context. Per-request data (auth, token)
   * arrives via the standard resolver function signature.
   */
  getResolvers?(context: ModuleResolverContext): ResolverMap | Promise<ResolverMap>;
}