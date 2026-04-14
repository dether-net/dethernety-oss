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