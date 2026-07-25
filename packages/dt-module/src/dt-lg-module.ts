import { Client } from '@langchain/langgraph-sdk';
import { Logger } from '@nestjs/common';
import { AnalysisSession, AnalysisStatus } from '@dethernety/dt-core';
import { DTModule, ExtendedPubSubEngine } from './interfaces/module-interface';
import { DTMetadata } from './interfaces/module-metadata-interface';
import { AnalysisClassMetadata } from './interfaces/analysis-class-metadata-interface';
import { LgAnalysisConfig, LgModuleMetadata, LgModuleOptions } from './interfaces/lg-analysis-config-interface';
import { DtLgAnalysisOps } from './dt-lg-analysis-ops';
import { DtLgDocumentOps } from './dt-lg-document-ops';
import { readSchemaExtension } from './schema-utils';
import { deriveAnalysisClassId } from './identity';

/** Default timeout (ms) for LangGraph control-plane requests (see LgModuleOptions.langgraphTimeoutMs). */
const DEFAULT_LG_TIMEOUT_MS = 30_000;

/**
 * Base class for LangGraph-based Dethernety modules.
 *
 * Provides common functionality for modules that integrate with LangGraph
 * for AI-powered analysis capabilities. This class uses composition with
 * DtLgAnalysisOps and DtLgDocumentOps helper classes, following the pattern
 * established by DtFileOpaModule with DbOps.
 *
 * This class handles:
 * - LangGraph client initialization and management
 * - Analysis session lifecycle (create, run, resume, delete)
 * - Streaming of analysis results via PubSub
 * - Document retrieval from LangGraph store
 * - Module metadata (provided via constructor options)
 *
 * @example
 * ```typescript
 * class MyLgModule extends DtLgModule {
 *   constructor(driver: any, logger: Logger) {
 *     super('my-module', driver, logger, {
 *       analysisConfig: myAnalysisConfig,
 *       metadata: {
 *         description: 'My custom LangGraph module',
 *         version: '1.0.0',
 *         author: 'My Team',
 *         icon: 'custom'
 *       }
 *     });
 *   }
 * }
 * ```
 */
export class DtLgModule implements DTModule {
  /** Module name identifier */
  protected readonly moduleName: string;

  /** Neo4j driver for database operations */
  protected readonly driver: any;

  /** NestJS logger instance */
  protected readonly logger: Logger;

  /** LangGraph SDK client */
  protected readonly client: Client;

  /** Configuration for analysis graphs */
  protected readonly analysisConfig: LgAnalysisConfig;

  /** Cached analysis class metadata from LangGraph assistants */
  protected readonly assistants: AnalysisClassMetadata[] = [];

  /** Module metadata (description, version, author, icon) */
  protected readonly metadata: LgModuleMetadata;

  /** Helper for analysis operations */
  protected readonly analysisOps: DtLgAnalysisOps;

  /** Helper for document operations */
  protected readonly documentOps: DtLgDocumentOps;

  /**
   * Creates a new LangGraph module instance.
   *
   * @param moduleName - Unique identifier for this module
   * @param driver - Neo4j driver instance for database operations
   * @param logger - NestJS Logger instance for structured logging
   * @param options - Module configuration options including analysis config
   */
  constructor(
    moduleName: string,
    driver: any,
    logger: Logger,
    options: LgModuleOptions
  ) {
    this.moduleName = moduleName;
    this.driver = driver;
    this.logger = logger;
    this.analysisConfig = options.analysisConfig;
    this.metadata = options.metadata;

    const apiUrl = options.langgraphApiUrl
      || process.env.LANGGRAPH_API_URL
      || 'http://localhost:8123';

    // Bound control-plane requests (assistant/thread/run metadata at install, boot and
    // status polls) so a reachable-but-wedged LangGraph server fails fast instead of hanging boot.
    // `||` (not `??`) so a 0/NaN can never disable the timeout. The result stream is exempt
    // — the SDK's streamWithRetry passes timeoutMs:null for runs.stream — so long analyses
    // are unaffected.
    const timeoutMs = options.langgraphTimeoutMs
      || Number(process.env.LANGGRAPH_TIMEOUT_MS)
      || DEFAULT_LG_TIMEOUT_MS;

    this.client = new Client({ apiUrl, timeoutMs });

    // Initialize helper classes
    this.analysisOps = new DtLgAnalysisOps(this.client, this.analysisConfig, logger);
    this.documentOps = new DtLgDocumentOps(this.client, this.analysisConfig, logger);

    this.logger.log('DtLgModule initialized', {
      moduleName: this.moduleName,
      langgraphApiUrl: apiUrl,
      configuredGraphs: Object.keys(this.analysisConfig.graphs)
    });
  }

  // ==========================================================================
  // DTModule Interface - Metadata
  // ==========================================================================

  /**
   * Returns the metadata for this module.
   *
   * Combines static metadata from constructor options with dynamically
   * fetched analysis classes from LangGraph.
   *
   * @returns Promise resolving to module metadata
   */
  async getMetadata(): Promise<DTMetadata> {
    return {
      name: this.moduleName,
      description: this.metadata.description,
      version: this.metadata.version,
      author: this.metadata.author,
      icon: this.metadata.icon,
      // Default to 'audit' — pre-existing class nodes assigned ids by
      // `randomUUID()` would otherwise produce strict-mode rejections
      // on every install. Audit-mode rebinds the id and emits a
      // structured event the operator can review.
      idRebindPolicy: 'audit',
      analysisClasses: await this.getAnalysisClasses(),
    };
  }

  // ==========================================================================
  // Protected Methods - Can be overridden by subclasses
  // ==========================================================================

  /**
   * Retrieves analysis class metadata from LangGraph assistants.
   *
   * Queries the LangGraph API for available assistants and maps them
   * to AnalysisClassMetadata using the analysisConfig for descriptions,
   * types, and categories.
   *
   * This method caches results in the `assistants` array for reuse.
   *
   * @returns Promise resolving to array of analysis class metadata
   */
  protected async getAnalysisClasses(): Promise<AnalysisClassMetadata[]> {
    const startTime = Date.now();
    this.logger.log('Fetching analysis classes from LangGraph', {
      moduleName: this.moduleName,
      operation: 'getAnalysisClasses'
    });

    // Infrastructure failure (LangGraph server unreachable) MUST propagate so
    // getMetadata() can signal "source unavailable" upstream — the
    // platform then skips the install rather than reconciling against
    // an empty list (which would orphan every AnalysisClass node). DO
    // NOT catch-and-return-[]; that turns a transient outage into a
    // silent data wipe.
    let lgAssistants: object[];
    try {
      lgAssistants = await this.getAnalysisAssistants();
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Failed to get analysis classes (LangGraph server unavailable)', {
        moduleName: this.moduleName,
        operation: 'getAnalysisClasses',
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }

    // Clear existing assistants and rebuild
    this.assistants.length = 0;

    for (const assistant of lgAssistants as any[]) {
      const graphConfig = this.analysisConfig.graphs[assistant.name];
      // Skip LangGraph-server assistants this module did not declare — without this
      // guard, a single deployment running multiple DtLgModule instances
      // would have each module claim every assistant.
      if (!graphConfig) continue;
      this.assistants.push({
        // Derive id locally from the graph name; matches the server's own
        // `assistant_id = uuid5(ASSISTANT_NAMESPACE_UUID, name)` so the
        // platform-side and server-side ids align without round-tripping.
        id: deriveAnalysisClassId(assistant.name),
        name: assistant.name,
        description: graphConfig.description || 'No description',
        type: graphConfig.type || 'general',
        category: graphConfig.category || 'general',
      });
    }

    const duration = Date.now() - startTime;
    this.logger.log('Analysis classes retrieved successfully', {
      moduleName: this.moduleName,
      operation: 'getAnalysisClasses',
      duration: `${duration}ms`,
      assistantCount: this.assistants.length
    });

    return this.assistants;
  }

  /**
   * Queries the LangGraph API for available assistants.
   *
   * @returns Promise resolving to array of assistant objects from LangGraph
   */
  protected async getAnalysisAssistants(): Promise<object[]> {
    // Infrastructure failure (LangGraph server unreachable / 5xx) MUST throw so
    // getMetadata() upstream can signal "source unavailable" → install
    // skipped, state preserved. Swallowing here would turn a transient
    // outage into a silent class-wipe.
    return this.client.assistants.search({
      metadata: null,
      offset: 0,
      limit: 100,
    });
  }

  // ==========================================================================
  // DTModule Interface - Public methods
  // ==========================================================================

  // No getModuleTemplate: the only module-wide setting ever offered was the LangGraph API
  // URL, which the constructor resolves from options/env — the template field was never
  // wired to it. The platform's template resolver answers its documented fallback for
  // modules without one (same pattern as DtFileOpaModule).

  /**
   * Runs an analysis using the specified analysis class.
   *
   * Delegates to DtLgAnalysisOps for the actual implementation.
   */
  async runAnalysis(
    id: string,
    analysisClassId: string,
    scope: string,
    pubSub: ExtendedPubSubEngine,
    additionalParams?: object
  ): Promise<AnalysisSession> {
    // Delete existing session first
    await this.analysisOps.deleteSession(id);

    // Create new session
    await this.analysisOps.createSession(id, scope);

    // Find assistant
    const assistant = this.assistants.find(a => a.id === analysisClassId);
    if (!assistant) {
      this.logger.error('Analysis class not found', {
        moduleName: this.moduleName,
        analysisClassId
      });
      return { sessionId: '' };
    }

    return this.analysisOps.runAnalysis(
      id,
      assistant.id!,
      assistant.name,
      scope,
      pubSub,
      this.driver,
      additionalParams
    );
  }

  /**
   * Starts a chat session with the specified analysis class.
   *
   * Delegates to DtLgAnalysisOps for the actual implementation.
   */
  async startChat(
    id: string,
    analysisClassId: string,
    scope: string,
    userQuestion: string,
    pubSub: ExtendedPubSubEngine,
    additionalParams?: object
  ): Promise<AnalysisSession> {
    // Create session if needed
    await this.analysisOps.createSession(id, scope);

    // Find assistant
    const assistant = this.assistants.find(a => a.id === analysisClassId);
    if (!assistant) {
      this.logger.error('Analysis class not found', {
        moduleName: this.moduleName,
        analysisClassId
      });
      return { sessionId: '' };
    }

    return this.analysisOps.startChat(
      id,
      assistant.id!,
      userQuestion,
      scope,
      pubSub
    );
  }

  /**
   * Resumes a paused/interrupted analysis session.
   *
   * Delegates to DtLgAnalysisOps for the actual implementation.
   */
  async resumeAnalysis(
    id: string,
    analysisClassId: string,
    input: any,
    pubSub: ExtendedPubSubEngine
  ): Promise<AnalysisSession> {
    const assistant = this.assistants.find(a => a.id === analysisClassId);
    if (!assistant) {
      this.logger.error('Analysis class not found', {
        moduleName: this.moduleName,
        analysisClassId
      });
      return { sessionId: '' };
    }

    return this.analysisOps.resumeAnalysis(id, assistant.id!, input, pubSub);
  }

  /**
   * Deletes an analysis session.
   *
   * Delegates to DtLgAnalysisOps for the actual implementation.
   */
  async deleteAnalysis(id: string): Promise<boolean> {
    return this.analysisOps.deleteSession(id);
  }

  /**
   * Explicitly stops an in-flight analysis run, cancelling its result stream.
   *
   * The run's server-side lifecycle is decoupled (`onDisconnect: 'continue'`), so this
   * cancels the observation stream and stops publishing for the session; it does not by
   * itself delete the thread. Returns true if a live run was found and aborted.
   */
  async stopAnalysis(id: string): Promise<boolean> {
    return this.analysisOps.stopRun(id);
  }

  /**
   * Gets the current status of an analysis session.
   *
   * Delegates to DtLgAnalysisOps for the actual implementation.
   */
  async getAnalysisStatus(id: string): Promise<AnalysisStatus> {
    return this.analysisOps.getStatus(id);
  }

  /**
   * Best-effort teardown when the platform discards this module instance (reload/replace).
   * Aborts every in-flight run so a superseded instance's streams stop publishing.
   */
  dispose(): void {
    this.analysisOps.abortAll();
  }

  /**
   * Gets the available value keys from an analysis session state.
   *
   * Delegates to DtLgAnalysisOps for the actual implementation.
   */
  async getAnalysisValueKeys(id: string): Promise<string[]> {
    return this.analysisOps.getValueKeys(id);
  }

  /**
   * Gets a specific value from an analysis session state.
   *
   * Delegates to DtLgAnalysisOps for the actual implementation.
   */
  async getAnalysisValues(id: string, valueKey: string): Promise<object> {
    return this.analysisOps.getValue(id, valueKey);
  }

  /**
   * Retrieves a document from the LangGraph store.
   *
   * Delegates to DtLgDocumentOps for the actual implementation.
   */
  async getDocument(
    scope: string,
    analysisId: string,
    analysisClassId: string,
    filter: object
  ): Promise<object> {
    const assistant = this.assistants.find(a => a.id === analysisClassId);
    if (!assistant) {
      return { error: 'Analysis class not found' };
    }

    return this.documentOps.getDocument(scope, analysisId, assistant.name, filter);
  }

  /**
   * Returns a GraphQL SDL fragment to extend the platform schema.
   *
   * Default implementation reads `schema.graphql` from the compiled module's
   * directory (__dirname). Modules that ship a schema.graphql alongside their
   * compiled .Module.js file get schema extension automatically.
   *
   * Override this method to provide SDL from a different source.
   */
  async getSchemaExtension(): Promise<string | undefined> {
    return readSchemaExtension(__dirname);
  }
}
