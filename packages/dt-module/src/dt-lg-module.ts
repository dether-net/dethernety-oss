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

/**
 * Default template for LangGraph modules.
 * Provides configuration schema for the LangGraph API URL.
 */
const DEFAULT_LG_TEMPLATE = `{
  "schema": {
    "type": "object",
    "properties": {
      "langgraph_api_url": {
        "type": "string",
        "format": "uri"
      }
    }
  },
  "uischema": {
    "type": "VerticalLayout",
    "elements": [
      {
        "type": "Control",
        "scope": "#/properties/langgraph_api_url"
      }
    ]
  }
}`;

/**
 * Base class for LangGraph-based Dethernety modules.
 *
 * Provides common functionality for modules that integrate with LangGraph
 * for AI-powered analysis capabilities. This class uses composition with
 * DtLgAnalysisOps and DtLgDocumentOps helper classes, following the pattern
 * established by DtNeo4jOpaModule with DbOps and OpaOps.
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

  /** Custom module template, if provided */
  protected readonly customTemplate?: string;

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
    this.customTemplate = options.moduleTemplate;
    this.metadata = options.metadata;

    const apiUrl = options.langgraphApiUrl
      || process.env.LANGGRAPH_API_URL
      || 'http://localhost:8123';

    this.client = new Client({ apiUrl });

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

    try {
      const lgAssistants = await this.getAnalysisAssistants();

      // Clear existing assistants and rebuild
      this.assistants.length = 0;

      for (const assistant of lgAssistants as any[]) {
        const graphConfig = this.analysisConfig.graphs[assistant.name];
        this.assistants.push({
          id: assistant.assistant_id,
          name: assistant.name,
          description: graphConfig?.description || 'No description',
          type: graphConfig?.type || 'general',
          category: graphConfig?.category || 'general',
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
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Failed to get analysis classes', {
        moduleName: this.moduleName,
        operation: 'getAnalysisClasses',
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Queries the LangGraph API for available assistants.
   *
   * @returns Promise resolving to array of assistant objects from LangGraph
   */
  protected async getAnalysisAssistants(): Promise<object[]> {
    try {
      const result = await this.client.assistants.search({
        metadata: null,
        offset: 0,
        limit: 100,
      });
      return result;
    } catch (error) {
      this.logger.error('Failed to get analysis assistants from LangGraph', {
        moduleName: this.moduleName,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  // ==========================================================================
  // DTModule Interface - Public methods
  // ==========================================================================

  /**
   * Returns the module configuration template.
   *
   * Override this method to provide a custom template.
   * Default template includes LangGraph API URL configuration.
   *
   * @returns Promise resolving to JSON template string
   */
  async getModuleTemplate(): Promise<string> {
    return this.customTemplate || DEFAULT_LG_TEMPLATE;
  }

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
   * Gets the current status of an analysis session.
   *
   * Delegates to DtLgAnalysisOps for the actual implementation.
   */
  async getAnalysisStatus(id: string): Promise<AnalysisStatus> {
    return this.analysisOps.getStatus(id);
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
