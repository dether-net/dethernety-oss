import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthorizationService } from '../services/authorization.service';
import { MonitoringService } from '../services/monitoring.service';
import { EmbeddingService } from '../services/embedding.service';
import { classLabelToNodeLabel } from './shared/class-label-map';
import { safeErrorMessage } from '../../common/utils/safe-error-message';

// --- Constants ---

const MAX_ELEMENTS = 100;
const DEFAULT_TOP_N = 3;
const MIN_SUBSTRING_LENGTH = 3;

/**
 * Maps graph node labels to Memgraph HNSW vector index names.
 * Used for Priority 3 (vector similarity) search.
 */
const CLASS_LABEL_TO_INDEX_NAME: Record<string, string> = {
  ComponentClass: 'component_class_embeddings',
  ControlClass: 'control_class_embeddings',
  DataFlowClass: 'dataflow_class_embeddings',
  SecurityBoundaryClass: 'boundary_class_embeddings',
  DataClass: 'data_class_embeddings',
};

// --- Internal types ---

interface MatchElementInput {
  name: string;
  type?: string;
  description?: string;
}

interface MatchClassesInput {
  elements: MatchElementInput[];
  classLabel: string;
  componentType?: string;
  moduleIds?: string[];
  topN?: number;
  fields?: string[];
}

interface ClassRecord {
  classId: string;
  className: string;
  description: string | null;
  category: string | null;
  type: string | null;
  moduleId: string;
  moduleName: string;
}

interface ClassCandidate {
  classId: string;
  className: string;
  classDescription: string | null;
  classCategory: string | null;
  classType: string | null;
  moduleId: string;
  moduleName: string;
  matchType: string;
  confidence: string;
  similarityScore: number | null;
}

interface ElementMatch {
  elementName: string;
  candidates: ClassCandidate[];
}

interface MatchClassesResult {
  matches: ElementMatch[];
  unmatched: string[];
  vectorAvailable: boolean;
}

// --- Service ---

@Injectable()
export class MatchClassesResolverService {
  private readonly logger = new Logger(MatchClassesResolverService.name);

  private vectorSearchAvailable: boolean | null = null;
  private vectorSearchAvailableCheckedAt = 0;
  // 10-minute TTL — the vector module's availability rarely toggles, but
  // dt-ws restarts shouldn't be required to pick up a Memgraph upgrade
  // (or rollback) that flips the answer. Process-lifetime caching is too
  // sticky; per-request probing wastes a round-trip.
  private static readonly VECTOR_CHECK_TTL_MS = 10 * 60 * 1000;
  private vectorIndexesEnsured = false;

  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
    private readonly configService: ConfigService,
    private readonly authorizationService: AuthorizationService,
    private readonly monitoringService: MonitoringService,
    private readonly embeddingService: EmbeddingService,
  ) {
    this.logger.log('MatchClassesResolverService initialized');
  }

  // --- Input validation ---

  private validateInput(input: MatchClassesInput): void {
    if (!input.elements || input.elements.length === 0) {
      throw new Error('At least one element is required');
    }
    if (input.elements.length > MAX_ELEMENTS) {
      throw new Error(
        `Maximum ${MAX_ELEMENTS} elements allowed, received ${input.elements.length}`,
      );
    }
    // Validate classLabel maps to a known node label (also catches injection)
    classLabelToNodeLabel(input.classLabel);

    // componentType only valid for COMPONENT
    if (input.componentType && input.classLabel !== 'COMPONENT') {
      throw new Error(
        'componentType is only applicable when classLabel is COMPONENT',
      );
    }
    if (input.topN !== undefined && (input.topN < 1 || input.topN > 50)) {
      throw new Error('topN must be between 1 and 50');
    }
  }

  // --- Database ---

  /**
   * Fetch all classes of a given node label, optionally filtered by moduleIds.
   * Returns a flat array — the class count is bounded by module scope (typically 30–300).
   */
  private async fetchClasses(
    nodeLabel: string,
    moduleIds?: string[],
  ): Promise<ClassRecord[]> {
    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name'),
    });
    try {
      const hasModuleFilter = moduleIds && moduleIds.length > 0;
      // Orphan-aware: both branches use :HAS_CLASS — fetchClasses is
      // the public class-listing surface; orphans (HAS_ORPHANED_CLASS)
      // are intentionally hidden.
      const query = hasModuleFilter
        ? `MATCH (m:Module)-[:HAS_CLASS]->(c:${nodeLabel})
           WHERE m.id IN $moduleIds
           RETURN c.id AS classId, c.name AS className,
                  c.description AS description, c.category AS category,
                  c.type AS type, m.id AS moduleId, m.name AS moduleName`
        : `MATCH (c:${nodeLabel})<-[:HAS_CLASS]-(m:Module)
           RETURN c.id AS classId, c.name AS className,
                  c.description AS description, c.category AS category,
                  c.type AS type, m.id AS moduleId, m.name AS moduleName`;

      const result = await session.executeRead(async (tx: any) => {
        return await tx.run(query, hasModuleFilter ? { moduleIds } : {});
      });

      return result.records.map((record: any) => ({
        classId: record.get('classId'),
        className: record.get('className'),
        description: record.get('description') ?? null,
        category: record.get('category') ?? null,
        type: record.get('type') ?? null,
        moduleId: record.get('moduleId'),
        moduleName: record.get('moduleName'),
      }));
    } finally {
      await session.close();
    }
  }

  // --- Matching pipeline ---

  /**
   * Priority 1: Exact name match (case-insensitive).
   * Optionally filtered by componentType when classLabel = COMPONENT.
   */
  private exactNameMatch(
    elementName: string,
    classes: ClassRecord[],
    componentType?: string,
  ): ClassRecord[] {
    const nameLower = elementName.toLowerCase();
    return classes.filter((c) => {
      if (c.className.toLowerCase() !== nameLower) return false;
      if (componentType && c.type !== componentType) return false;
      return true;
    });
  }

  /**
   * Priority 2: Substring containment (case-insensitive).
   * Skips very short element names (< 3 chars) to avoid false positives.
   * No componentType filter — the broader candidate set is intentional.
   * Returns matches sorted by overlap ratio descending.
   */
  private substringMatch(
    elementName: string,
    classes: ClassRecord[],
  ): { record: ClassRecord; score: number }[] {
    if (elementName.length < MIN_SUBSTRING_LENGTH) return [];

    const elLower = elementName.toLowerCase();
    const matches: { record: ClassRecord; score: number }[] = [];

    for (const cls of classes) {
      const clsLower = cls.className.toLowerCase();
      if (clsLower.includes(elLower) || elLower.includes(clsLower)) {
        const overlapLen = Math.min(elLower.length, clsLower.length);
        const maxLen = Math.max(elLower.length, clsLower.length);
        matches.push({ record: cls, score: overlapLen / maxLen });
      }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches;
  }

  /**
   * Priority 4: Type-filtered heuristic (fallback).
   * When classLabel = COMPONENT and componentType is provided, returns only that type.
   * For other class labels, returns all classes.
   */
  private typeFilteredMatch(
    classes: ClassRecord[],
    componentType?: string,
  ): ClassRecord[] {
    if (componentType) {
      return classes.filter((c) => c.type === componentType);
    }
    return classes;
  }

  // --- Vector search infrastructure ---

  /**
   * Detect whether the database supports vector search (Memgraph 3.0+).
   * Caches the result — probes at most once per service lifetime.
   */
  private async checkVectorSearchAvailability(): Promise<boolean> {
    const now = Date.now();
    if (
      this.vectorSearchAvailable !== null &&
      now - this.vectorSearchAvailableCheckedAt < MatchClassesResolverService.VECTOR_CHECK_TTL_MS
    ) {
      return this.vectorSearchAvailable;
    }

    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name'),
    });
    try {
      await session.executeRead(async (tx: any) => {
        return await tx.run('CALL vector_search.show_index_info() YIELD *');
      });
      this.vectorSearchAvailable = true;
      this.logger.log('Vector search is available (Memgraph detected)');
    } catch {
      this.vectorSearchAvailable = false;
      this.logger.log('Vector search not available (Neo4j or older Memgraph)');
    } finally {
      await session.close();
    }
    this.vectorSearchAvailableCheckedAt = now;
    return this.vectorSearchAvailable;
  }

  /**
   * Ensure HNSW vector indexes exist for all 5 class labels and verify that
   * their dimension matches EMBEDDING_DIMENSIONS.
   *
   * Public so ModuleManagementService can await this from resolveVectors()
   * before the first module install — on a fresh DB no matchClasses query
   * has fired yet, so the bootstrap wouldn't otherwise run in time.
   *
   * Idempotency: vectorIndexesEnsured is set only after a full successful
   * pass (index existence + dimension cross-check). If this method throws
   * (DB unreachable, etc.) the flag stays false and the next call retries.
   *
   * Dimension mismatch handling: rather than fail-open into writing vectors
   * against a wrong-dim index, we call embeddingService.disableForSession().
   * Older Memgraph versions that do not project `dimension` fall through
   * with a single warn — the check was attempted but not authoritative.
   */
  async ensureVectorIndexes(): Promise<void> {
    if (this.vectorIndexesEnsured) return;

    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name'),
    });
    try {
      // Read existing index names + dimensions in a single pass. On older
      // Memgraph that does not project `dimension`, the query throws and we
      // fall back to a name-only read plus a non-authoritative warn.
      let existingIndexes: Set<string>;
      let existingDimensions: Map<string, number> | null;
      try {
        const result = await session.executeRead(async (tx: any) => {
          return await tx.run(
            'CALL vector_search.show_index_info() YIELD index_name, dimension RETURN index_name, dimension',
          );
        });
        existingIndexes = new Set<string>();
        existingDimensions = new Map<string, number>();
        for (const rec of result.records as any[]) {
          const name = rec.get('index_name');
          existingIndexes.add(name);
          const dimRaw = rec.get('dimension');
          // Memgraph returns integer types; neo4j-driver wraps them. Coerce to number.
          const dim = typeof dimRaw === 'number' ? dimRaw : Number(dimRaw?.toNumber?.() ?? dimRaw);
          if (Number.isFinite(dim)) existingDimensions.set(name, dim);
        }
      } catch (err) {
        this.logger.warn(
          'Memgraph vector index dimension projection not available — skipping cross-check',
          { error: safeErrorMessage(err) },
        );
        const result = await session.executeRead(async (tx: any) => {
          return await tx.run(
            'CALL vector_search.show_index_info() YIELD index_name RETURN index_name',
          );
        });
        existingIndexes = new Set<string>(
          result.records.map((r: any) => r.get('index_name')),
        );
        existingDimensions = null;
      }

      const dimensions = this.embeddingService.getDimensions();

      for (const [nodeLabel, indexName] of Object.entries(
        CLASS_LABEL_TO_INDEX_NAME,
      )) {
        if (!existingIndexes.has(indexName)) {
          this.logger.log(
            `Creating vector index: ${indexName} on :${nodeLabel}(embedding)`,
          );
          // DDL must run as auto-committing (implicit) transaction — Memgraph
          // rejects CREATE VECTOR INDEX inside explicit/multi-command transactions
          await session.run(
            `CREATE VECTOR INDEX ${indexName} ON :${nodeLabel}(embedding) ` +
              `WITH CONFIG {"dimension": ${dimensions}, "capacity": 500, "metric": "cos"}`,
          );
        } else if (existingDimensions) {
          const existing = existingDimensions.get(indexName);
          if (existing !== undefined && existing !== dimensions) {
            this.embeddingService.disableForSession(
              `Vector index ${indexName} has dimension ${existing} but EMBEDDING_DIMENSIONS=${dimensions}. ` +
                `Pre-existing vectors would be scored against mismatched new vectors. ` +
                `Recommended: drop the index and restart, or set EMBEDDING_DIMENSIONS to ${existing}.`,
            );
            return; // Do NOT set vectorIndexesEnsured — retry will no-op via isEnabled() upstream.
          }
        }
      }

      this.vectorIndexesEnsured = true;
    } finally {
      await session.close();
    }
  }

  /**
   * Priority 3: Vector similarity search via Memgraph HNSW index.
   * Embeds the element on the fly, queries the appropriate index, post-filters.
   * Returns empty array on any failure (graceful degradation).
   */
  private async vectorSimilarityMatch(
    element: MatchElementInput,
    nodeLabel: string,
    topN: number,
    componentType?: string,
    moduleIds?: string[],
  ): Promise<{ record: ClassRecord; similarity: number }[]> {
    if (!element.description) return [];

    const indexName = CLASS_LABEL_TO_INDEX_NAME[nodeLabel];
    if (!indexName) return [];

    // Compose and embed the element text
    const text = this.embeddingService.composeElementText(element);
    let vectors: number[][] | null;
    try {
      vectors = await this.embeddingService.embedBatch([text]);
    } catch (error) {
      this.logger.warn('Embedding failed for vector search, skipping Priority 3', {
        elementName: element.name,
        error: error instanceof Error ? error.message : 'unknown',
      });
      return [];
    }

    if (!vectors || vectors.length === 0) return [];
    const queryVector = vectors[0];

    // Request 3x topN to allow for post-filtering.
    // Ensure integer type — Neo4j driver may wrap numbers as Integer objects
    // which Memgraph's vector_search.search rejects.
    const searchLimit = Math.floor(Number(topN) * 3);
    const threshold = this.embeddingService.getThreshold();

    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name'),
    });
    try {
      // indexName and searchLimit are from hardcoded constants, safe to interpolate.
      // Use WITH after YIELD — Memgraph does not allow WHERE directly after YIELD.
      const query = `
        CALL vector_search.search('${indexName}', ${searchLimit}, $query_vector)
        YIELD node, similarity
        WITH node, similarity
        WHERE similarity >= $threshold
          AND ($component_type IS NULL OR node.type = $component_type)
        // Orphan-aware: :HAS_CLASS implicitly excludes orphans —
        // vector search results should be active classes only; operators
        // don't want retired classes surfacing in user-facing semantic
        // search.
        MATCH (node)<-[:HAS_CLASS]-(m:Module)
        WHERE $module_ids IS NULL OR m.id IN $module_ids
        RETURN node.id AS classId, node.name AS className,
               node.description AS description, node.category AS category,
               node.type AS type, m.id AS moduleId, m.name AS moduleName,
               node.embeddingModel AS embeddingModel, similarity
        ORDER BY similarity DESC
        LIMIT ${Math.floor(Number(topN))}
      `;

      const result = await session.executeRead(async (tx: any) => {
        return await tx.run(query, {
          query_vector: queryVector,
          threshold,
          component_type: componentType || null,
          module_ids: moduleIds && moduleIds.length > 0 ? moduleIds : null,
        });
      });

      // Check for embedding model version mismatch
      if (result.records.length > 0) {
        const storedModel = result.records[0].get('embeddingModel');
        if (storedModel && storedModel !== this.embeddingService.getModel()) {
          this.logger.warn(
            `Embedding model mismatch: configured="${this.embeddingService.getModel()}" ` +
              `vs stored="${storedModel}". Run reindexClassEmbeddings to re-embed.`,
          );
        }
      }

      return result.records.map((record: any) => ({
        record: {
          classId: record.get('classId'),
          className: record.get('className'),
          description: record.get('description') ?? null,
          category: record.get('category') ?? null,
          type: record.get('type') ?? null,
          moduleId: record.get('moduleId'),
          moduleName: record.get('moduleName'),
        },
        similarity: record.get('similarity'),
      }));
    } finally {
      await session.close();
    }
  }

  // --- Candidate builder ---

  private toCandidate(
    record: ClassRecord,
    matchType: string,
    confidence: string,
    similarityScore: number | null,
    fields: Set<string>,
  ): ClassCandidate {
    return {
      classId: record.classId,
      className: record.className,
      classDescription: fields.has('description') ? record.description : null,
      classCategory: fields.has('category') ? record.category : null,
      classType: fields.has('type') ? record.type : null,
      moduleId: record.moduleId,
      moduleName: record.moduleName,
      matchType,
      confidence,
      similarityScore,
    };
  }

  // --- Core execution ---

  private async executeMatchClasses(
    input: MatchClassesInput,
  ): Promise<MatchClassesResult> {
    this.validateInput(input);

    const nodeLabel = classLabelToNodeLabel(input.classLabel);
    const topN = input.topN ?? DEFAULT_TOP_N;
    const fields = new Set(input.fields ?? []);

    // Eagerly resolve vector availability for the response field. The Priority-3
    // branch below evaluates the same flags lazily, but we always populate
    // vectorAvailable so callers (UI, MCP tool) can surface the signal even
    // when the cascade short-circuits at Priority 1 or 2. The DB probe is
    // memoised on this.vectorSearchAvailable after the first call.
    const vectorAvailable =
      this.embeddingService.isEnabled() &&
      (await this.checkVectorSearchAvailability());

    // Single DB fetch — all classes of this label, optionally scoped to modules
    const allClasses = await this.fetchClasses(nodeLabel, input.moduleIds);

    const matches: ElementMatch[] = [];
    const unmatched: string[] = [];

    for (const element of input.elements) {
      const candidates: ClassCandidate[] = [];

      // Priority 1: Exact name match
      const exactHits = this.exactNameMatch(
        element.name,
        allClasses,
        input.componentType,
      );
      if (exactHits.length > 0) {
        for (const hit of exactHits.slice(0, topN)) {
          candidates.push(
            this.toCandidate(hit, 'exact_name', 'high', 1.0, fields),
          );
        }
        matches.push({ elementName: element.name, candidates });
        continue;
      }

      // Priority 2: Substring match
      const substringHits = this.substringMatch(element.name, allClasses);
      if (substringHits.length > 0) {
        for (const { record, score } of substringHits.slice(0, topN)) {
          candidates.push(
            this.toCandidate(record, 'fuzzy_name', 'high', score, fields),
          );
        }
        matches.push({ elementName: element.name, candidates });
        continue;
      }

      // Priority 3: Vector similarity (if enabled and available)
      if (
        this.embeddingService.isEnabled() &&
        (await this.checkVectorSearchAvailability()) &&
        element.description
      ) {
        try {
          await this.ensureVectorIndexes();
          const vectorHits = await this.vectorSimilarityMatch(
            element,
            nodeLabel,
            topN,
            input.componentType,
            input.moduleIds,
          );
          if (vectorHits.length > 0) {
            for (const { record, similarity } of vectorHits) {
              candidates.push(
                this.toCandidate(
                  record,
                  'vector_similarity',
                  'medium',
                  similarity,
                  fields,
                ),
              );
            }
            matches.push({ elementName: element.name, candidates });
            continue;
          }
        } catch (error) {
          this.logger.warn('Vector search failed, falling through to Priority 4', {
            elementName: element.name,
            error: error instanceof Error ? error.message : 'unknown',
          });
        }
      }

      // Priority 4: Type-filtered heuristic (fallback)
      const heuristicHits = this.typeFilteredMatch(
        allClasses,
        input.componentType,
      );
      if (heuristicHits.length > 0) {
        for (const hit of heuristicHits.slice(0, topN)) {
          candidates.push(
            this.toCandidate(hit, 'type_match', 'low', null, fields),
          );
        }
        matches.push({ elementName: element.name, candidates });
      } else {
        unmatched.push(element.name);
      }
    }

    return { matches, unmatched, vectorAvailable };
  }

  // --- Reindex ---

  /**
   * Re-embed all class nodes (optionally filtered by moduleIds).
   * Blocking operation — does not return until all vectors are updated.
   */
  private async executeReindexClassEmbeddings(
    moduleIds?: string[],
  ): Promise<{ reindexedCount: number; moduleNames: string[] }> {
    if (!this.embeddingService.isEnabled()) {
      throw new Error(
        'Embedding is not enabled. Set EMBEDDING_ENABLED=true to use this mutation.',
      );
    }

    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name'),
    });

    try {
      let reindexedCount = 0;
      const moduleNameSet = new Set<string>();

      for (const [nodeLabel, indexName] of Object.entries(
        CLASS_LABEL_TO_INDEX_NAME,
      )) {
        // Fetch all classes of this label (optionally filtered by moduleIds).
        // Orphan-aware: both branches use :HAS_CLASS — embedding reindex
        // only touches active classes; orphaned classes keep their last
        // embedding from before they were retired.
        const hasModuleFilter = moduleIds && moduleIds.length > 0;
        const fetchQuery = hasModuleFilter
          ? `MATCH (m:Module)-[:HAS_CLASS]->(c:${nodeLabel})
             WHERE m.id IN $moduleIds
             RETURN c.id AS classId, c.name AS name, c.description AS description,
                    c.category AS category, c.type AS type, m.name AS moduleName`
          : `MATCH (c:${nodeLabel})<-[:HAS_CLASS]-(m:Module)
             RETURN c.id AS classId, c.name AS name, c.description AS description,
                    c.category AS category, c.type AS type, m.name AS moduleName`;

        const fetchResult = await session.executeRead(async (tx: any) => {
          return await tx.run(
            fetchQuery,
            hasModuleFilter ? { moduleIds } : {},
          );
        });

        if (fetchResult.records.length === 0) continue;

        // Compose texts and batch-embed
        const classes = fetchResult.records.map((r: any) => ({
          classId: r.get('classId'),
          name: r.get('name'),
          description: r.get('description'),
          category: r.get('category'),
          type: r.get('type'),
          moduleName: r.get('moduleName'),
        }));

        const texts = classes.map((cls: any) =>
          this.embeddingService.composeClassText(cls),
        );
        const vectors = await this.embeddingService.embedBatch(texts);

        if (!vectors) continue;

        // Write vectors back
        const embeddingModel = this.embeddingService.getModel();
        await session.executeWrite(async (tx: any) => {
          for (let i = 0; i < classes.length; i++) {
            await tx.run(
              `MATCH (c:${nodeLabel} {id: $classId})
               SET c.embedding = $embedding, c.embeddingModel = $embeddingModel`,
              {
                classId: classes[i].classId,
                embedding: vectors[i],
                embeddingModel,
              },
            );
          }
        });

        reindexedCount += classes.length;
        for (const cls of classes) {
          moduleNameSet.add(cls.moduleName);
        }
      }

      return {
        reindexedCount,
        moduleNames: Array.from(moduleNameSet),
      };
    } finally {
      await session.close();
    }
  }

  // --- Resolver registration ---

  getResolvers() {
    return {
      Query: {
        matchClasses: async (
          _parent: any,
          args: { input: MatchClassesInput },
          context: any,
        ) => {
          const startTime = Date.now();
          const authContext =
            this.authorizationService.extractAuthContext(context);

          const authResult =
            await this.authorizationService.checkAuthorization(authContext, {
              operationType: 'query',
              operationName: 'matchClasses',
              resourceType: 'Class',
            });

          if (!authResult.allowed) {
            throw new Error(
              `Authorization denied: ${authResult.reason || 'insufficient permissions'}`,
            );
          }

          try {
            const result = await this.executeMatchClasses(args.input);
            const duration = Date.now() - startTime;

            this.monitoringService.recordOperation({
              operationName: 'matchClasses',
              duration,
              success: true,
              timestamp: new Date(),
              metadata: {
                elementCount: args.input.elements.length,
                matchCount: result.matches.length,
                unmatchedCount: result.unmatched.length,
                classLabel: args.input.classLabel,
              },
            });

            this.logger.debug('matchClasses completed', {
              elementCount: args.input.elements.length,
              matchCount: result.matches.length,
              unmatchedCount: result.unmatched.length,
              duration,
            });

            return result;
          } catch (error) {
            const duration = Date.now() - startTime;

            this.monitoringService.recordOperation({
              operationName: 'matchClasses',
              duration,
              success: false,
              timestamp: new Date(),
              metadata: {
                error: safeErrorMessage(error),
                classLabel: args.input.classLabel,
              },
            });

            this.logger.error('matchClasses failed', {
              error: safeErrorMessage(error),
              classLabel: args.input.classLabel,
              elementCount: args.input.elements?.length,
              duration,
            });

            throw new Error(safeErrorMessage(error, 'matchClasses failed'), {
              cause: error,
            });
          }
        },
      },
      Mutation: {
        reindexClassEmbeddings: async (
          _parent: any,
          args: { moduleIds?: string[]; capacity?: number },
          context: any,
        ) => {
          const startTime = Date.now();
          const authContext =
            this.authorizationService.extractAuthContext(context);

          const authResult =
            await this.authorizationService.checkAuthorization(authContext, {
              operationType: 'mutation',
              operationName: 'reindexClassEmbeddings',
              resourceType: 'Class',
            });

          if (!authResult.allowed) {
            throw new Error(
              `Authorization denied: ${authResult.reason || 'insufficient permissions'}`,
            );
          }

          try {
            const result = await this.executeReindexClassEmbeddings(
              args.moduleIds,
            );
            const duration = Date.now() - startTime;

            this.monitoringService.recordOperation({
              operationName: 'reindexClassEmbeddings',
              duration,
              success: true,
              timestamp: new Date(),
              metadata: {
                reindexedCount: result.reindexedCount,
                moduleNames: result.moduleNames,
              },
            });

            this.logger.log('reindexClassEmbeddings completed', {
              reindexedCount: result.reindexedCount,
              moduleNames: result.moduleNames,
              duration,
            });

            return result;
          } catch (error) {
            const duration = Date.now() - startTime;

            this.monitoringService.recordOperation({
              operationName: 'reindexClassEmbeddings',
              duration,
              success: false,
              timestamp: new Date(),
              metadata: { error: safeErrorMessage(error) },
            });

            this.logger.error('reindexClassEmbeddings failed', {
              error: safeErrorMessage(error),
              duration,
            });

            throw new Error(safeErrorMessage(error, 'reindexClassEmbeddings failed'), {
              cause: error,
            });
          }
        },
      },
    };
  }
}
