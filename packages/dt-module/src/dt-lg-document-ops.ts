import { Client } from '@langchain/langgraph-sdk';
import { Logger } from '@nestjs/common';
import { LgAnalysisConfig } from './interfaces/lg-analysis-config-interface';

/**
 * Helper class for LangGraph document operations.
 *
 * Provides methods for retrieving documents from the LangGraph store.
 * This class follows the pattern of DbOps and OpaOps - it can be used
 * independently or as part of a DtLgModule.
 *
 * @example
 * ```typescript
 * const client = new Client({ apiUrl: 'http://localhost:8123' });
 * const documentOps = new DtLgDocumentOps(client, analysisConfig, logger);
 *
 * // Get a document directly from store
 * const doc = await documentOps.getFromStore(['namespace', 'parts'], 'doc-key');
 *
 * // Get a document using filter
 * const indexDoc = await documentOps.getDocument('model-123', 'analysis-1', 'Graph Name', { document: 'index' });
 * ```
 */
export class DtLgDocumentOps {
  constructor(
    private readonly client: Client,
    private readonly config: LgAnalysisConfig,
    private readonly logger: Logger
  ) {
    this.logger.log('DtLgDocumentOps initialized');
  }

  /**
   * Retrieves a document from the LangGraph store using filter criteria.
   *
   * Supports two filter modes:
   * - Single key with `{ document: 'index' }`: Uses the graph config's index_document function
   * - Multi-key with `{ namespace: [...], key: string, attribute?: string }`: Direct store lookup
   *
   * @param scope - Scope identifier (typically model ID)
   * @param analysisId - Analysis session identifier
   * @param graphName - Name of the graph (key in config.graphs)
   * @param filter - Filter criteria for document retrieval
   * @returns Promise resolving to the document object
   */
  async getDocument(
    scope: string,
    analysisId: string,
    graphName: string,
    filter: object
  ): Promise<object> {
    const graphConfig = this.config.graphs[graphName];

    const filterKeys = Object.keys(filter);
    if (filterKeys.length === 0) {
      return { error: 'No filter provided' };
    }

    // Single key filter - use index_document from config
    if (filterKeys.length === 1) {
      const filterKey = filterKeys[0];
      const filterValue = (filter as any)[filterKey];

      if (filterKey === 'document' && filterValue === 'index' && graphConfig?.index_document) {
        const indexDoc = await graphConfig.index_document(scope, analysisId);
        return await this.getFromStore(indexDoc.namespace, indexDoc.key);
      }
    }

    // Multi-key filter - direct store lookup
    let namespace: string[] = [];
    let key = '';
    let attribute = '';

    for (const filterKey of filterKeys) {
      const filterValue = (filter as any)[filterKey];
      if (filterKey === 'namespace') {
        namespace = filterValue;
      } else if (filterKey === 'key') {
        key = filterValue;
      } else if (filterKey === 'attribute') {
        attribute = filterValue;
      }
    }

    if (namespace.length === 0 || key.length === 0) {
      return { error: 'No namespace or key provided' };
    }

    const document = await this.getFromStore(namespace, key);

    // If attribute specified, extract and return it
    if (attribute.length > 0) {
      const attributeValue = (document as any)[attribute];
      if (attributeValue === undefined) {
        return { error: 'Attribute not found' };
      }
      // Normalize return type to array
      if (Array.isArray(attributeValue)) {
        return attributeValue;
      } else if (typeof attributeValue === 'object' && attributeValue !== null) {
        return [JSON.stringify(attributeValue)];
      } else {
        return [String(attributeValue)];
      }
    }

    return document;
  }

  /**
   * Retrieves a document directly from the LangGraph store.
   *
   * @param namespace - Namespace array for the document
   * @param key - Document key
   * @returns Promise resolving to the document value or error object
   */
  async getFromStore(namespace: string[], key: string): Promise<Record<string, any>> {
    try {
      const documentItems = await this.client.store.getItem(namespace, key);
      return (documentItems as any).value;
    } catch (error) {
      this.logger.error('Failed to get document from store', {
        namespace,
        key,
        error: error instanceof Error ? error.message : String(error)
      });
      return { error: 'Failed to get document' };
    }
  }
}
