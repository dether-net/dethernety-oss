import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthorizationService } from '../services/authorization.service';
import { MonitoringService } from '../services/monitoring.service';
import { EmbeddingService } from '../services/embedding.service';
import { classLabelToNodeLabel } from './shared/class-label-map';
import { safeErrorMessage } from '../../common/utils/safe-error-message';
import { VectorSearchService } from '../services/vector-search.service';
import { CLASS_LABELS, vectorDefect, type ClassLabel } from '@dethernety/dt-module/embedding';
import { embedderFingerprint } from '../module-management-services/module-content-hash';

// --- Constants ---

const MAX_ELEMENTS = 100;
const DEFAULT_TOP_N = 3;
const MIN_SUBSTRING_LENGTH = 3;
// How long a "does any class in scope have a vector of the active profile" answer is reused.
const VECTOR_CHECK_TTL_MS = 10 * 60 * 1000;

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
  // Class-vector presence per (label, module scope, profile): the answer and when it was read, or the read in flight.
  private readonly vectorPresence = new Map<string, { present: boolean; checkedAt: number } | Promise<boolean>>();
  // Keys whose "no vector" or "check failed" warning has been logged.
  private readonly vectorPresenceWarned = new Set<string>();

  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
    private readonly configService: ConfigService,
    private readonly authorizationService: AuthorizationService,
    private readonly monitoringService: MonitoringService,
    private readonly embeddingService: EmbeddingService,
    private readonly vectorSearch: VectorSearchService,
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
   * Exact name match (case-insensitive). Its hits are merged ahead of the vector hits.
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
   * Fallback: name containment by whole words (case-insensitive), used when neither the exact
   * name nor the vector tier answers.
   * A hit is the class name as a contiguous word sequence inside the element
   * name, or the element name inside the class name; words split on anything
   * that is not a letter or digit. A word inside a longer word is not a hit:
   * "Go microservice" does not contain the class name "Service".
   * Skips very short element names (< 3 chars) to avoid false positives.
   * Filtered by componentType when classLabel = COMPONENT, like the other
   * tiers. This tier used to widen the net deliberately, on the reasoning that a
   * broader candidate set helps when the type is uncertain — but a
   * ComponentClass carries exactly one ComponentType, and changeElementBinding
   * now refuses a cross-type bind outright. Offering a candidate the user cannot
   * accept is a dead end, not a wider net; a hit here also ends the cascade, so an
   * unfiltered substring hit would SUPPRESS the type-filtered fallback that would
   * have answered correctly.
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
   * Last fallback: the type-filtered heuristic.
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

  // --- Vector search ---

  /**
   * Whether the vector tier can serve this request: the embedder is ready, exact search works on
   * this engine, and at least one active class in scope has a vector of the active embedding
   * profile. Without the last check a corpus embedded by another model would answer nothing while
   * reporting the tier as available.
   *
   * The last check is a database read, so its answer is kept per (label, module scope, profile) for
   * VECTOR_CHECK_TTL_MS, concurrent requests share one read, and its warning is logged once per key.
   * A fresh install can therefore read as "no vectors" for up to the TTL. A failed read is not kept.
   */
  private async vectorTierAvailable(nodeLabel: string, moduleIds?: string[]): Promise<boolean> {
    if (!this.embeddingService.isEnabled()) return false;
    if (!(await this.vectorSearch.healthy())) return false;
    const profileId = this.embeddingService.getModel();
    const scope = moduleIds && moduleIds.length > 0 ? [...moduleIds].sort() : [];
    const key = `${nodeLabel}|${scope.join(',')}|${profileId}`;
    const cached = this.vectorPresence.get(key);
    if (cached instanceof Promise) return cached;
    if (cached && Date.now() - cached.checkedAt < VECTOR_CHECK_TTL_MS) return cached.present;

    const read = this.readVectorPresence(nodeLabel, scope, profileId, key);
    this.vectorPresence.set(key, read);
    return read;
  }

  /** The presence read behind vectorTierAvailable; it settles the cache entry for `key`. */
  private async readVectorPresence(nodeLabel: string, scope: string[], profileId: string, key: string): Promise<boolean> {
    try {
      const records = await this.vectorSearch.read(
        `MATCH (m:Module)-[:HAS_CLASS]->(c:${nodeLabel})
         WHERE c.embeddingModel = $profileId AND c.embedding IS NOT NULL
           ${scope.length ? 'AND m.id IN $moduleIds' : ''}
         RETURN count(c) > 0 AS present`,
        { profileId, ...(scope.length ? { moduleIds: scope } : {}) },
      );
      const present = records[0]?.get('present') === true;
      this.vectorPresence.set(key, { present, checkedAt: Date.now() });
      if (!present) this.warnOnce(key, 'No class in scope has a vector of the active embedding profile; the vector tier is off', { nodeLabel, profile: profileId });
      return present;
    } catch (error) {
      this.vectorPresence.delete(key);
      this.warnOnce(key, 'Class vector availability check failed', { error: safeErrorMessage(error) });
      return false;
    }
  }

  private warnOnce(key: string, message: string, detail: Record<string, unknown>): void {
    if (this.vectorPresenceWarned.has(key)) return;
    this.vectorPresenceWarned.add(key);
    this.logger.warn(message, detail);
  }

  /**
   * The query vectors of a request's elements, in one embed call: one per element with a description, null for the
   * others and for an element whose text could not be embedded (logged; that element keeps the name tiers).
   */
  private async elementVectors(elements: MatchElementInput[], nodeLabel: string): Promise<Array<number[] | null>> {
    const out: Array<number[] | null> = elements.map(() => null);
    if (!(CLASS_LABELS as readonly string[]).includes(nodeLabel)) return out;
    const wanted = elements.flatMap((e, i) => (e.description ? [i] : []));
    const { vectors, failures } = await this.embeddingService.embedEach(
      wanted.map((i) => this.embeddingService.composeElementText(elements[i])),
      'query',
    );
    wanted.forEach((i, k) => (out[i] = vectors[k] ?? null));
    for (const f of failures) {
      this.logger.warn('Embedding failed for vector search, skipping the vector tier', {
        elementName: elements[wanted[f.index]].name,
        error: f.error instanceof Error ? f.error.message : 'unknown',
      });
    }
    return out;
  }

  /**
   * Exact vector similarity in the database: ranks the active classes of the label that carry a
   * vector of the active profile against the element's query vector.
   */
  private async vectorSimilarityMatch(
    vector: number[],
    nodeLabel: string,
    topN: number,
    componentType?: string,
    moduleIds?: string[],
  ): Promise<{ record: ClassRecord; similarity: number }[]> {
    const rows = await this.vectorSearch.rank({
      corpus: 'classes',
      label: nodeLabel as ClassLabel,
      vector,
      profileId: this.embeddingService.getModel(),
      k: topN,
      threshold: this.embeddingService.getThreshold('classes'),
      componentType: componentType || null,
      moduleIds: moduleIds ?? null,
    });
    return rows.map((row) => ({
      record: {
        classId: row.id,
        className: row.name as string,
        description: (row.description as string | null) ?? null,
        category: (row.category as string | null) ?? null,
        type: (row.type as string | null) ?? null,
        moduleId: row.moduleId as string,
        moduleName: row.moduleName as string,
      },
      similarity: row.score,
    }));
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

    // Resolved once per request, so callers (UI, MCP tool) see the signal even when an element has
    // no description and only the name tiers answer.
    const vectorAvailable = await this.vectorTierAvailable(nodeLabel, input.moduleIds);

    // Single DB fetch — all classes of this label, optionally scoped to modules
    const allClasses = await this.fetchClasses(nodeLabel, input.moduleIds);

    // Every element's query vector in one embed call, before the per-element tiers.
    const vectors = vectorAvailable ? await this.elementVectors(input.elements, nodeLabel) : input.elements.map(() => null);

    const matches: ElementMatch[] = [];
    const unmatched: string[] = [];

    for (const [index, element] of input.elements.entries()) {
      const candidates: ClassCandidate[] = [];

      // Exact name and vector similarity run together. Exact-name hits come first, so a class whose
      // name the element carries never disappears behind classes that clear the threshold; the
      // vector hits follow. Containment no longer short-circuits the vector tier.
      const exactHits = this.exactNameMatch(
        element.name,
        allClasses,
        input.componentType,
      );
      let vectorHits: { record: ClassRecord; similarity: number }[] = [];
      const vector = vectors[index];
      if (vector) {
        try {
          vectorHits = await this.vectorSimilarityMatch(
            vector,
            nodeLabel,
            topN,
            input.componentType,
            input.moduleIds,
          );
        } catch (error) {
          this.logger.warn('Vector search failed, falling back to the name tiers', {
            elementName: element.name,
            error: error instanceof Error ? error.message : 'unknown',
          });
        }
      }
      if (exactHits.length > 0 || vectorHits.length > 0) {
        const seen = new Set<string>();
        for (const hit of exactHits) {
          seen.add(hit.classId);
          candidates.push(this.toCandidate(hit, 'exact_name', 'high', 1.0, fields));
        }
        for (const { record, similarity } of vectorHits) {
          if (seen.has(record.classId)) continue;
          seen.add(record.classId);
          candidates.push(this.toCandidate(record, 'vector_similarity', 'medium', similarity, fields));
        }
        matches.push({ elementName: element.name, candidates: candidates.slice(0, topN) });
        continue;
      }

      // Fallback when neither answers: name containment, then the type-filtered heuristic.
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
      // Modules with a class left without a new vector: their Module node keeps its embedding profile.
      const incomplete = new Set<string>();

      for (const nodeLabel of CLASS_LABELS) {
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
        const vectors = await this.embeddingService.embedBatch(
          texts,
          'document',
          classes.map((cls: any) => cls.name),
        );

        if (!vectors) {
          for (const cls of classes) incomplete.add(cls.moduleName);
          continue;
        }

        // Write vectors back
        const embeddingModel = this.embeddingService.getModel();
        const dimensions = this.embeddingService.getDimensions();
        let written = 0;
        await session.executeWrite(async (tx: any) => {
          written = 0;
          for (let i = 0; i < classes.length; i++) {
            const defect = vectorDefect(vectors[i], dimensions);
            if (defect) {
              this.logger.warn('Skipping a class vector that cannot be stored', { classId: classes[i].classId, defect });
              incomplete.add(classes[i].moduleName);
              continue;
            }
            await tx.run(
              `MATCH (c:${nodeLabel} {id: $classId})
               SET c.embedding = $embedding, c.embeddingModel = $embeddingModel`,
              {
                classId: classes[i].classId,
                embedding: vectors[i],
                embeddingModel,
              },
            );
            written++;
          }
        });

        reindexedCount += written;
        for (const cls of classes) {
          moduleNameSet.add(cls.moduleName);
        }
      }

      // Every class of these modules that the vector search reads (CLASS_LABELS) now has a vector from the active
      // embedder: record it on the Module node, as an install does, so the next start's skip gate does not reinstall
      // them only to embed them again. Analysis and issue classes, which no search reads, keep their vectors.
      const stamped = Array.from(moduleNameSet).filter((name) => !incomplete.has(name));
      if (stamped.length > 0) {
        await session.executeWrite(async (tx: any) =>
          tx.run(`MATCH (m:Module) WHERE m.name IN $names SET m.embeddingProfile = $profile`, {
            names: stamped,
            profile: embedderFingerprint(this.embeddingService),
          }),
        );
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
          args: { moduleIds?: string[] },
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
