/**
 * Configuration for a single LangGraph analysis graph.
 * Defines metadata, input building, and processing hooks for each graph type.
 */
export interface LgGraphConfig {
  /** Human-readable description of the analysis graph */
  description?: string;

  /** Type classification for the analysis (e.g., 'model_analysis', 'component_class_graph') */
  type?: string;

  /** Category for grouping analyses (e.g., 'attack_scenario', 'threat', 'component') */
  category?: string;

  /**
   * Function to determine the document storage location for index documents.
   * @param scope - The scope identifier (usually model ID)
   * @param analysisId - Optional analysis session ID
   * @returns Promise resolving to namespace array and key for document storage
   */
  index_document?: (
    scope: string,
    analysisId?: string
  ) => Promise<{ namespace: string[]; key: string }>;

  /**
   * Function to build the input payload for the LangGraph run.
   * @param scope - The scope identifier (usually model ID)
   * @param analysisId - Optional analysis session ID
   * @param driver - Optional Neo4j driver for database queries
   * @param additionalParams - Optional additional parameters to merge into input
   * @returns Promise resolving to the input payload object
   */
  input: (
    scope: string,
    analysisId?: string,
    driver?: any,
    additionalParams?: any
  ) => Promise<any>;

  /**
   * Optional post-processing function for analysis results.
   * @param result - Raw result from LangGraph execution
   * @returns Promise resolving to processed result
   */
  post_process?: (result: any) => Promise<any>;
}

/**
 * Configuration for LangGraph-based analysis modules.
 * Maps graph names to their respective configurations.
 */
export interface LgAnalysisConfig {
  /** Map of graph name to graph configuration */
  graphs: {
    [graphName: string]: LgGraphConfig;
  };
}

/**
 * Static metadata for a LangGraph module.
 * These fields are used to identify and describe the module.
 */
export interface LgModuleMetadata {
  /** Human-readable description of the module */
  description: string;

  /** Module version (semver format recommended) */
  version: string;

  /** Module author or team name */
  author: string;

  /** Optional icon identifier for UI display */
  icon?: string;
}

/**
 * Options for initializing a LangGraph module.
 */
export interface LgModuleOptions {
  /** LangGraph API URL - defaults to process.env.LANGGRAPH_API_URL or 'http://localhost:8123' */
  langgraphApiUrl?: string;

  /** Analysis configuration defining available graphs and their behavior */
  analysisConfig: LgAnalysisConfig;

  /** Module metadata (description, version, author, icon) */
  metadata: LgModuleMetadata;

  /** Optional custom template JSON string */
  moduleTemplate?: string;
}
