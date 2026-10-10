import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthorizationService } from '../services/authorization.service';
import { MonitoringService } from '../services/monitoring.service';
import { EmbeddingService } from '../services/embedding.service';
import { classLabelToNodeLabel } from './shared/class-label-map';
import { safeErrorMessage } from '../../common/utils/safe-error-message';
import { isMiskeyed, readVectorIndexKeys, rebuildVectorIndex } from '../services/vector-index-keys';

// --- Constants ---

const MAX_ELEMENTS = 100;
const DEFAULT_TOP_N = 3;
const MIN_SUBSTRING_LENGTH = 3;

/** A name's words: lower-cased, split on anything that is not a letter or digit. */
function nameWords(name: string): string[] {
  return name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** True when `needle` occurs in `hay` as a contiguous word sequence. */
function containsWords(hay: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((w, k) => hay[i + k] === w)) return true;
  }
  return false;
}

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

/** Pre-allocation hint for a class vector index; Memgraph resizes past it. */
const CLASS_INDEX_CAPACITY = 500;

/** How many nearest neighbours a class's own-vector search inspects when the self-heal checks an index. */
const HEAL_SELF_SEARCH_LIMIT = 3;

/** One class vector index after the self-heal looked at it. */
export interface ClassVectorIndexHealth {
  indexName: string;
  /** Embedded active classes of the index's label. */
  embedded: number;
  /** How many of them the index holds. */
  held: number;
  /** Held before a rebuild; present only when the index was rebuilt. */
  heldBefore?: number;
  /** Why it was rebuilt: it was keyed on another label or property, or it lacked embedded classes. */
  reason?: 'miskeyed' | 'missing classes';
  rebuilt: boolean;
}

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
  private classIndexCheck: Promise<void> | null = null;

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
   * Priority 2: Name containment by whole words (case-insensitive).
   * A hit is the class name as a contiguous word sequence inside the element
   * name, or the element name inside the class name; words split on anything
   * that is not a letter or digit. A word inside a longer word is not a hit:
   * "Go microservice" does not contain the class name "Service".
   * Skips very short element names (< 3 chars) to avoid false positives.
   * Filtered by componentType when classLabel = COMPONENT, like the other three
   * tiers. This tier used to widen the net deliberately, on the reasoning that a
   * broader candidate set helps when the type is uncertain — but a
   * ComponentClass carries exactly one ComponentType, and changeElementBinding
   * now refuses a cross-type bind outright. Offering a candidate the user cannot
   * accept is a dead end, not a wider net; the tier's `continue` in the pipeline
   * also means an unfiltered substring hit SUPPRESSES the type-filtered Priority
   * 4 fallback that would have answered correctly.
   * Returns matches sorted by overlap ratio descending.
   */
  private substringMatch(
    elementName: string,
    classes: ClassRecord[],
    componentType?: string,
  ): { record: ClassRecord; score: number }[] {
    if (elementName.length < MIN_SUBSTRING_LENGTH) return [];

    const elLower = elementName.toLowerCase();
    const elWords = nameWords(elementName);
    const matches: { record: ClassRecord; score: number }[] = [];

    for (const cls of classes) {
      if (componentType && cls.type !== componentType) continue;
      const clsLower = cls.className.toLowerCase();
      const clsWords = nameWords(cls.className);
      if (containsWords(elWords, clsWords) || containsWords(clsWords, elWords)) {
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
   * Caches the result for VECTOR_CHECK_TTL_MS. Each probe also checks the class vector index keys, so
   * an index that a database-only restart re-keyed is rebuilt within one TTL while the platform keeps
   * running.
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
    if (this.vectorSearchAvailable && this.vectorIndexesEnsured && this.embeddingService.isEnabled()) {
      await this.checkClassVectorIndexKeys();
    }
    return this.vectorSearchAvailable;
  }

  /**
   * The cheap check behind each availability probe: an index keyed on another label or property, or
   * holding fewer entries than its label has embedded active classes, triggers the full self-heal.
   * Concurrent probes share one check; a failure is logged and leaves search as it was.
   */
  private async checkClassVectorIndexKeys(): Promise<void> {
    if (this.classIndexCheck) return this.classIndexCheck;
    this.classIndexCheck = (async () => {
      const session = this.neo4jDriver.session({
        database: this.configService.get('database.name'),
      });
      let needsHeal = false;
      try {
        const keys = await readVectorIndexKeys(session);
        for (const [nodeLabel, indexName] of Object.entries(CLASS_LABEL_TO_INDEX_NAME)) {
          const key = keys?.get(indexName);
          if (key === undefined) continue;
          if (isMiskeyed(key, { label: nodeLabel, property: 'embedding' })) {
            needsHeal = true;
            break;
          }
          if (key.size < (await this.countEmbeddedClasses(session, nodeLabel))) {
            needsHeal = true;
            break;
          }
        }
      } catch (error) {
        this.logger.warn('Class vector index key check failed', { error: safeErrorMessage(error) });
      } finally {
        await session.close();
      }
      if (needsHeal) await this.healClassVectorIndexes();
    })().finally(() => {
      this.classIndexCheck = null;
    });
    return this.classIndexCheck;
  }

  /**
   * Create one class vector index. DDL must run as an auto-committing (implicit) transaction —
   * Memgraph rejects CREATE VECTOR INDEX inside explicit/multi-command transactions.
   */
  private async createClassVectorIndex(
    session: any,
    nodeLabel: string,
    indexName: string,
    dimensions: number,
  ): Promise<void> {
    await session.run(
      `CREATE VECTOR INDEX ${indexName} ON :${nodeLabel}(embedding) ` +
        `WITH CONFIG {"dimension": ${dimensions}, "capacity": ${CLASS_INDEX_CAPACITY}, "metric": "cos"}`,
    );
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
          await this.createClassVectorIndex(session, nodeLabel, indexName, dimensions);
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
   * Verify each class vector index and rebuild one that is keyed on another label or property, or that
   * does not hold every embedded active class of its label.
   *
   * The key comes from the index metadata (see vector-index-keys.ts for the Memgraph recovery defect
   * that re-keys an index). A class is held when a search with its own vector returns it among the
   * nearest few (classes with identical text share a vector, so its own entry can tie with another).
   * Creating an index indexes the nodes that already carry the property, so a rebuild restores it.
   * Runs after module installs; a failure is logged and leaves vector search as it was.
   */
  async healClassVectorIndexes(): Promise<ClassVectorIndexHealth[]> {
    if (!this.embeddingService.isEnabled()) return [];
    if (!(await this.checkVectorSearchAvailability())) return [];
    await this.ensureVectorIndexes();
    // The dimension cross-check may have disabled embedding for the session.
    if (!this.embeddingService.isEnabled()) return [];

    const report: ClassVectorIndexHealth[] = [];
    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name'),
    });
    try {
      const keys = await readVectorIndexKeys(session);
      for (const [nodeLabel, indexName] of Object.entries(CLASS_LABEL_TO_INDEX_NAME)) {
        try {
          const spec = {
            indexName,
            label: nodeLabel,
            property: 'embedding',
            dimensions: this.embeddingService.getDimensions(),
            capacity: CLASS_INDEX_CAPACITY,
          };
          const key = keys?.get(indexName);
          const before = await this.countHeldClasses(session, nodeLabel, indexName);
          const reason = isMiskeyed(key, spec)
            ? ('miskeyed' as const)
            : before.held < before.embedded
              ? ('missing classes' as const)
              : null;
          if (!reason) {
            report.push({ indexName, embedded: before.embedded, held: before.held, rebuilt: false });
            continue;
          }
          this.logger.warn(
            reason === 'miskeyed'
              ? `Vector index ${indexName} is keyed on :${key!.label}(${key!.property}) instead of :${nodeLabel}(embedding) — rebuilding it`
              : `Vector index ${indexName} holds ${before.held} of ${before.embedded} embedded ${nodeLabel} classes — rebuilding it`,
          );
          await rebuildVectorIndex(session, spec);
          const after = await this.countHeldClasses(session, nodeLabel, indexName);
          const log = after.held === after.embedded ? 'log' : 'warn';
          this.logger[log](
            `Vector index ${indexName} rebuilt: holds ${after.held} of ${after.embedded} embedded ${nodeLabel} classes`,
          );
          report.push({ indexName, embedded: after.embedded, held: after.held, heldBefore: before.held, reason, rebuilt: true });
        } catch (error) {
          this.logger.warn(`Vector index ${indexName} could not be verified or rebuilt`, {
            error: safeErrorMessage(error),
          });
        }
      }
    } finally {
      await session.close();
    }
    return report;
  }

  /** How many embedded active classes of a label there are, and how many of them its vector index holds. */
  private async countHeldClasses(
    session: any,
    nodeLabel: string,
    indexName: string,
  ): Promise<{ embedded: number; held: number }> {
    const toNumber = (v: any) => Math.floor(typeof v === 'number' ? v : Number(v?.toNumber?.() ?? 0));
    const embedded = toNumber(
      (
        await session.executeRead((tx: any) =>
          tx.run(
            `MATCH (c:${nodeLabel})<-[:HAS_CLASS]-(:Module)
             WHERE c.embedding IS NOT NULL
             RETURN count(DISTINCT c) AS n`,
          ),
        )
      ).records[0]?.get('n'),
    );
    if (embedded === 0) return { embedded, held: 0 };
    // A class whose search returns no rows drops out of this count, so it is counted as not held.
    const held = toNumber(
      (
        await session.executeRead((tx: any) =>
          tx.run(
            `MATCH (c:${nodeLabel})<-[:HAS_CLASS]-(:Module)
             WHERE c.embedding IS NOT NULL
             WITH DISTINCT c
             CALL vector_search.search('${indexName}', ${HEAL_SELF_SEARCH_LIMIT}, c.embedding) YIELD node
             WITH c, collect(id(node)) AS nearest
             RETURN count(CASE WHEN id(c) IN nearest THEN 1 END) AS n`,
          ),
        )
      ).records[0]?.get('n'),
    );
    return { embedded, held };
  }

  /** Active classes of a label that carry an embedding: the upper bound of a module-scoped vector search. */
  private async countEmbeddedClasses(session: any, nodeLabel: string): Promise<number> {
    const result = await session.executeRead(async (tx: any) =>
      tx.run(
        `MATCH (c:${nodeLabel})<-[:HAS_CLASS]-(:Module)
         WHERE c.embedding IS NOT NULL
         RETURN count(c) AS c`,
      ),
    );
    const value = result.records[0]?.get('c');
    return Math.floor(typeof value === 'number' ? value : Number(value?.toNumber?.() ?? 0));
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

    const threshold = this.embeddingService.getThreshold();

    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name'),
    });
    try {
      // Unscoped: request 3x topN to allow for the threshold and type post-filters.
      // Scoped to modules: the module filter runs after the nearest-neighbour search, so a fixed
      // multiple of topN returns nothing once other modules' classes fill it. Search every
      // embedded class of the label instead, then filter.
      // Ensure integer type — Neo4j driver may wrap numbers as Integer objects
      // which Memgraph's vector_search.search rejects.
      const searchLimit =
        moduleIds && moduleIds.length > 0
          ? Math.max(
              Math.floor(Number(topN) * 3),
              await this.countEmbeddedClasses(session, nodeLabel),
            )
          : Math.floor(Number(topN) * 3);
      // indexName and searchLimit are from hardcoded constants, safe to interpolate.
      // Use WITH after YIELD — Memgraph does not allow WHERE directly after YIELD.
      const query = `
        CALL vector_search.search('${indexName}', ${searchLimit}, $query_vector)
        YIELD node, similarity
        WITH id(node) AS hit, similarity
        WHERE similarity >= $threshold
        // A node deleted since it was indexed can stay in the index until the database's garbage
        // collection runs, and reading it fails; matching each hit by its internal id skips it.
        MATCH (node) WHERE id(node) = hit
        WITH node, similarity
        WHERE $component_type IS NULL OR node.type = $component_type
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
      const substringHits = this.substringMatch(
        element.name,
        allClasses,
        input.componentType,
      );
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
