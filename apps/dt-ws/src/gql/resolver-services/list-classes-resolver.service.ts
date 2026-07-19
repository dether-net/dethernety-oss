import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j from 'neo4j-driver';
import { AuthorizationService } from '../services/authorization.service';
import { MonitoringService } from '../services/monitoring.service';
import { classLabelToNodeLabel } from './shared/class-label-map';
import { safeErrorMessage } from '../../common/utils/safe-error-message';

// --- Constants ---

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
// Cap pagination depth — guards against deep-pagination DoS, where a large
// SKIP forces the engine to evaluate the full filtered set on every call.
const MAX_OFFSET = MAX_LIMIT * 1000;

// Cap free-text search length — guards against arbitrarily long substring
// scans (CONTAINS is O(n*m) on the catalogue). The 1MB body cap already
// bounds the request; this bounds the per-query worst case.
const MAX_SEARCH_LENGTH = 200;

// Cap array-input length — categories/moduleIds. Mirrors the
// MAX_ELEMENTS = 100 pattern in match-classes-resolver.service.ts.
const MAX_FILTER_ENTRIES = 100;

// --- Internal types ---

interface ListClassesInput {
  classLabel: string;
  componentType?: string | null;
  search?: string | null;
  categories?: string[] | null;
  moduleIds?: string[] | null;
  offset?: number | null;
  limit?: number | null;
}

interface ClassItem {
  classId: string;
  className: string;
  classDescription: string | null;
  classCategory: string | null;
  classType: string | null;
  moduleId: string;
  moduleName: string;
  // Static for catalogue listings — ClassCandidate-compatible shape.
  matchType: 'type_match';
  confidence: 'low';
  similarityScore: null;
}

interface FacetEntry {
  value: string;
  count: number;
}

interface ModuleFacetEntry {
  moduleId: string;
  moduleName: string;
  count: number;
}

interface FacetCounts {
  categories: FacetEntry[];
  modules: ModuleFacetEntry[];
  types: FacetEntry[];
}

interface ListClassesResult {
  items: ClassItem[];
  totalCount: number;
  facetCounts: FacetCounts;
}

// --- Service ---

@Injectable()
export class ListClassesResolverService {
  private readonly logger = new Logger(ListClassesResolverService.name);

  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
    private readonly configService: ConfigService,
    private readonly authorizationService: AuthorizationService,
    private readonly monitoringService: MonitoringService,
  ) {
    this.logger.log('ListClassesResolverService initialized');
  }

  // --- Input validation ---

  private validateInput(input: ListClassesInput): {
    nodeLabel: string;
    offset: number;
    limit: number;
  } {
    // Validate classLabel maps to a known node label (also catches injection)
    const nodeLabel = classLabelToNodeLabel(input.classLabel);

    if (input.componentType && input.classLabel !== 'COMPONENT') {
      throw new Error(
        'componentType is only applicable when classLabel is COMPONENT',
      );
    }

    if (input.search && input.search.length > MAX_SEARCH_LENGTH) {
      throw new Error(
        `search exceeds maximum length of ${MAX_SEARCH_LENGTH} characters`,
      );
    }
    if (input.categories && input.categories.length > MAX_FILTER_ENTRIES) {
      throw new Error(
        `categories exceeds maximum entries of ${MAX_FILTER_ENTRIES}`,
      );
    }
    if (input.moduleIds && input.moduleIds.length > MAX_FILTER_ENTRIES) {
      throw new Error(
        `moduleIds exceeds maximum entries of ${MAX_FILTER_ENTRIES}`,
      );
    }

    const offset = input.offset ?? 0;
    if (offset < 0) {
      throw new Error('offset must be >= 0');
    }
    if (offset > MAX_OFFSET) {
      throw new Error(`offset must be <= ${MAX_OFFSET}`);
    }

    const requestedLimit = input.limit ?? DEFAULT_LIMIT;
    if (requestedLimit < 1) {
      throw new Error('limit must be >= 1');
    }
    const limit = Math.min(requestedLimit, MAX_LIMIT);

    return { nodeLabel, offset, limit };
  }

  // --- Core execution ---

  private async executeListClasses(
    input: ListClassesInput,
  ): Promise<ListClassesResult> {
    const { nodeLabel, offset, limit } = this.validateInput(input);

    // Normalise nullable filter params to null so the Cypher predicate
    // `($foo IS NULL OR ...)` evaluates correctly on both Neo4j and Memgraph.
    //
    // SKIP / LIMIT must be transmitted as graph Integers — Memgraph rejects
    // plain JS numbers ("Limit on number of returned elements must be an
    // integer.") because the Bolt protocol encodes them as FloatValue. The
    // driver's `neo4j.int()` helper coerces to an Integer wrapper. Neo4j
    // accepts both shapes, so this is the portable form.
    const params = {
      componentType: input.componentType ?? null,
      // Treat empty array same as null (no filter) — simpler client API.
      categories:
        input.categories && input.categories.length > 0
          ? input.categories
          : null,
      moduleIds:
        input.moduleIds && input.moduleIds.length > 0 ? input.moduleIds : null,
      search:
        input.search && input.search.trim().length > 0
          ? input.search.trim()
          : null,
      offset: neo4j.int(offset),
      limit: neo4j.int(limit),
    };

    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name'),
    });

    try {
      // Query A: page of items. Orphan-aware via :HAS_CLASS (orphans live
      // under :HAS_ORPHANED_CLASS and are intentionally excluded).
      // nodeLabel is the only interpolated value and is validated by
      // classLabelToNodeLabel above (rejects anything outside the allow-set).
      const itemsQuery = `
        MATCH (c:${nodeLabel})<-[:HAS_CLASS]-(m:Module)
        WHERE ($componentType IS NULL OR c.type = $componentType)
          AND ($categories IS NULL OR c.category IN $categories)
          AND ($moduleIds IS NULL OR m.id IN $moduleIds)
          AND ($search IS NULL OR toLower(c.name) CONTAINS toLower($search))
        RETURN c.id AS classId, c.name AS className,
               c.description AS description, c.category AS category,
               c.type AS type, m.name AS moduleName, m.id AS moduleId
        ORDER BY c.name ASC, c.id ASC
        SKIP $offset
        LIMIT $limit
      `;

      // Query B: aggregation over the same filtered set. Returns one
      // tuple per matching class; facet counts are computed in TS to keep
      // the Cypher portable between Neo4j and Memgraph (CALL subqueries
      // and certain `count(DISTINCT ...)` shapes diverge between them).
      // At realistic scale (a few thousand candidates max), the network
      // cost of one small struct per row is negligible.
      const aggregationQuery = `
        MATCH (c:${nodeLabel})<-[:HAS_CLASS]-(m:Module)
        WHERE ($componentType IS NULL OR c.type = $componentType)
          AND ($categories IS NULL OR c.category IN $categories)
          AND ($moduleIds IS NULL OR m.id IN $moduleIds)
          AND ($search IS NULL OR toLower(c.name) CONTAINS toLower($search))
        RETURN c.category AS category, c.type AS type,
               m.id AS moduleId, m.name AS moduleName
      `;

      // Both queries run inside one read tx — items and facets are guaranteed
      // to be computed against the same DB snapshot. Splitting them apart
      // would let concurrent writes drift the counts between the two reads.
      const [itemsResult, aggregationResult] = await session.executeRead(
        async (tx: any) => {
          const items = await tx.run(itemsQuery, params);
          const aggregation = await tx.run(aggregationQuery, params);
          return [items, aggregation];
        },
      );

      const items: ClassItem[] = itemsResult.records.map((record: any) => ({
        classId: record.get('classId'),
        className: record.get('className'),
        classDescription: record.get('description') ?? null,
        classCategory: record.get('category') ?? null,
        classType: record.get('type') ?? null,
        moduleId: record.get('moduleId'),
        moduleName: record.get('moduleName'),
        matchType: 'type_match' as const,
        confidence: 'low' as const,
        similarityScore: null,
      }));

      const facetCounts = this.aggregateFacets(aggregationResult.records);
      const totalCount = aggregationResult.records.length;

      return { items, totalCount, facetCounts };
    } finally {
      await session.close();
    }
  }

  // --- Facet aggregation ---

  /**
   * Build server-aggregated facet counts from the full filtered tuple set.
   * Counts are derived from the same filtered set as items, so chips reflect
   * AND-across-OR-within semantics (picker filter contract).
   */
  private aggregateFacets(records: any[]): FacetCounts {
    const categoryCounts = new Map<string, number>();
    const typeCounts = new Map<string, number>();
    // Module facet carries id+name; key by id to allow multiple modules
    // with the same name (defensive — module names should be unique in
    // practice, but ids are the authoritative key).
    const moduleCounts = new Map<
      string,
      { moduleId: string; moduleName: string; count: number }
    >();

    for (const record of records) {
      const category = record.get('category');
      const type = record.get('type');
      const moduleId = record.get('moduleId');
      const moduleName = record.get('moduleName');

      if (category) {
        categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
      }
      if (type) {
        typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
      }
      if (moduleId) {
        const existing = moduleCounts.get(moduleId);
        if (existing) {
          existing.count += 1;
        } else {
          moduleCounts.set(moduleId, {
            moduleId,
            moduleName: moduleName ?? '',
            count: 1,
          });
        }
      }
    }

    const toSortedEntries = (m: Map<string, number>): FacetEntry[] =>
      Array.from(m.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

    const sortedModules: ModuleFacetEntry[] = Array.from(
      moduleCounts.values(),
    ).sort(
      (a, b) =>
        b.count - a.count || a.moduleName.localeCompare(b.moduleName),
    );

    return {
      categories: toSortedEntries(categoryCounts),
      modules: sortedModules,
      types: toSortedEntries(typeCounts),
    };
  }

  // --- Resolver registration ---

  getResolvers() {
    return {
      Query: {
        listClasses: async (
          _parent: any,
          args: { input: ListClassesInput },
          context: any,
        ) => {
          const startTime = Date.now();
          const authContext =
            this.authorizationService.extractAuthContext(context);

          const authResult =
            await this.authorizationService.checkAuthorization(authContext, {
              operationType: 'query',
              operationName: 'listClasses',
              resourceType: 'Class',
            });

          if (!authResult.allowed) {
            throw new Error(
              `Authorization denied: ${authResult.reason || 'insufficient permissions'}`,
            );
          }

          try {
            const result = await this.executeListClasses(args.input);
            const duration = Date.now() - startTime;

            this.monitoringService.recordOperation({
              operationName: 'listClasses',
              duration,
              success: true,
              timestamp: new Date(),
              metadata: {
                classLabel: args.input.classLabel,
                totalCount: result.totalCount,
                itemsReturned: result.items.length,
                hasSearch: Boolean(
                  args.input.search && args.input.search.length > 0,
                ),
                hasFacets: Boolean(
                  (args.input.categories && args.input.categories.length > 0) ||
                    (args.input.moduleIds && args.input.moduleIds.length > 0),
                ),
              },
            });

            this.logger.debug('listClasses completed', {
              classLabel: args.input.classLabel,
              totalCount: result.totalCount,
              itemsReturned: result.items.length,
              duration,
            });

            return result;
          } catch (error) {
            const duration = Date.now() - startTime;

            this.monitoringService.recordOperation({
              operationName: 'listClasses',
              duration,
              success: false,
              timestamp: new Date(),
              metadata: {
                error: safeErrorMessage(error),
                classLabel: args.input.classLabel,
              },
            });

            this.logger.error('listClasses failed', {
              error: safeErrorMessage(error),
              classLabel: args.input.classLabel,
              duration,
            });

            throw new Error(safeErrorMessage(error, 'listClasses failed'), {
              cause: error,
            });
          }
        },
      },
    };
  }
}
