import { DTMetadata } from './module-metadata-interface';
import { Exposure } from './exposure-interface';
import { Countermeasure } from './countermeasure-interface';
import { ModuleResolverContext, ResolverMap } from './module-resolver-interface';
import { AnalysisSession, AnalysisStatus } from '@dethernety/dt-core';
import { PubSubEngine } from 'graphql-subscriptions';

export interface ExtendedPubSubEngine extends PubSubEngine {
  asyncIterator<T>(triggers: string | string[]): AsyncIterator<T>;
}

export interface DTModule {
  getMetadata(): DTMetadata | Promise<DTMetadata>;
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