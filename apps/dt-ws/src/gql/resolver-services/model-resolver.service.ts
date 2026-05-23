import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRegistryService } from '../module-management-services/module-registry.service';
import { AuthorizationService } from '../services/authorization.service';
import { AuthorizationContext } from '../interfaces/authorization.interface';
import { ResolverMap, ResolverService } from '../interfaces/resolver.interface';
import { safeErrorMessage } from '../../common/utils/safe-error-message';

/** Node + relationship counts removed by a delete, matching `DeletionStats`. */
interface DeletionStats {
  nodesDeleted: number;
  relationshipsDeleted: number;
}

/**
 * Enumerate the ids of every `Analysis` owned by the model — from the model
 * node and from each owned structural element (via `ANALYZED_BY`). Collected
 * first (bounded) so module hooks receive the full set without re-enumerating.
 */
const ENUMERATE_MODEL_ANALYSES = `
MATCH (m:Model {id: $modelId})
OPTIONAL MATCH (m)-[:CONTAINS]->(db:SecurityBoundary)
OPTIONAL MATCH (db)<-[:BELONGS_TO*0..]-(sb:SecurityBoundary)
OPTIONAL MATCH (sb)<-[:BELONGS_TO]-(c:Component)
OPTIONAL MATCH (c)-[:FLOWS]-(df:DataFlow)
OPTIONAL MATCH (m)-[:CONTAINS]->(md:Data)
OPTIONAL MATCH (sb)-[:HANDLES]->(bd:Data)
OPTIONAL MATCH (c)-[:HANDLES]->(cd:Data)
OPTIONAL MATCH (df)-[:HANDLES]->(fd:Data)
WITH [m] + collect(DISTINCT sb) + collect(DISTINCT c) + collect(DISTINCT df)
   + collect(DISTINCT md) + collect(DISTINCT bd) + collect(DISTINCT cd)
   + collect(DISTINCT fd) AS owned
UNWIND owned AS el
OPTIONAL MATCH (el)-[:ANALYZED_BY]->(a:Analysis)
RETURN collect(DISTINCT a.id) AS analysisIds
`;

/**
 * Delete a model and its complete structural subgraph in one statement,
 * returning accurate counts. Anchored on `Model` (so a boundary-less model still
 * deletes); collects model-level `Data` and every element's exposures incl.
 * boundary-data exposures; counts relationships once via `count(DISTINCT r)`.
 * Names only core structural labels.
 *
 * Runs AFTER the module hooks in the shared transaction, so any owned
 * analysis subtree is already gone; this query never touches it regardless,
 * and `DETACH DELETE` leaves shared neighbours (classes, MITRE, folders)
 * intact — only their edges to the deleted elements die.
 *
 * Assumes a DataFlow's two endpoints (source + target Component) belong to the
 * same model — the invariant the editor produces. The `(c)-[:FLOWS]-(df)` hop
 * is intentionally undirected (a flow is owned if either endpoint is owned),
 * preserving the prior directive's semantics.
 */
const DELETE_MODEL_STRUCTURAL = `
MATCH (m:Model {id: $modelId})
OPTIONAL MATCH (m)-[:CONTAINS]->(db:SecurityBoundary)
OPTIONAL MATCH (db)<-[:BELONGS_TO*0..]-(sb:SecurityBoundary)
OPTIONAL MATCH (sb)<-[:BELONGS_TO]-(c:Component)
OPTIONAL MATCH (c)-[:FLOWS]-(df:DataFlow)
OPTIONAL MATCH (m)-[:CONTAINS]->(md:Data)
OPTIONAL MATCH (sb)-[:HANDLES]->(bd:Data)
OPTIONAL MATCH (c)-[:HANDLES]->(cd:Data)
OPTIONAL MATCH (df)-[:HANDLES]->(fd:Data)
WITH m,
  collect(DISTINCT sb) + collect(DISTINCT c) + collect(DISTINCT df)
  + collect(DISTINCT md) + collect(DISTINCT bd) + collect(DISTINCT cd)
  + collect(DISTINCT fd) AS elems
UNWIND ([m] + elems) AS el
OPTIONAL MATCH (el)-[:HAS_EXPOSURE]->(exp:Exposure)
WITH m, elems, collect(DISTINCT exp) AS exps
WITH [m] + elems + exps AS owned
UNWIND owned AS n
WITH collect(DISTINCT n) AS nodes
CALL {
  WITH nodes UNWIND nodes AS x
  OPTIONAL MATCH (x)-[r]-()
  RETURN count(DISTINCT r) AS rels
}
WITH nodes, rels
UNWIND nodes AS d
DETACH DELETE d
RETURN size(nodes) AS nodesDeleted, rels AS relationshipsDeleted
`;

/** Coerce a neo4j Integer (or plain number / null) to a JS number. */
function toNumber(value: any): number {
  if (value == null) return 0;
  return typeof value?.toNumber === 'function' ? value.toNumber() : Number(value);
}

/**
 * Custom resolver for `Mutation.deleteModel`. Replaces the former `@cypher`
 * directive so model deletion can (a) collect the full structural subgraph,
 * (b) dispatch the `onModelDeleted` lifecycle hook to every loaded module, and
 * (c) do all of it in ONE write transaction — every participant commits or
 * rolls back together (no half-deleted model).
 */
@Injectable()
export class ModelResolverService implements ResolverService {
  private readonly logger = new Logger(ModelResolverService.name);

  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
    private readonly configService: ConfigService,
    private readonly moduleRegistry: ModuleRegistryService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  getResolvers(): ResolverMap {
    return {
      Mutation: {
        deleteModel: async (_parent, args, context) => {
          const authContext = this.authorizationService.extractAuthContext(context);
          return this.deleteModel(args.modelId, authContext);
        },
      },
    };
  }

  /**
   * Delete a model, its structural subgraph, and (via module hooks) its
   * model-scoped module nodes — atomically. Returns the summed
   * `DeletionStats`. A non-existent model is a no-op `{0, 0}` (idempotent on
   * retry). Any failure — in a hook or the structural delete — rolls the whole
   * transaction back and propagates as a GraphQL error.
   */
  async deleteModel(modelId: string, authContext: AuthorizationContext): Promise<DeletionStats> {
    const authResult = await this.authorizationService.checkAuthorization(authContext, {
      operationType: 'mutation',
      operationName: 'deleteModel',
      resourceType: 'Model',
      resourceId: modelId,
    });
    if (!authResult.allowed) {
      throw new ForbiddenException(authResult.reason || 'Not authorized to delete model');
    }

    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name') || 'neo4j',
    });

    try {
      const stats = await session.executeWrite(async (tx: any) => {
        // 1. Enumerate the model's owned analyses (passed to every hook).
        const enumRes = await tx.run(ENUMERATE_MODEL_ANALYSES, { modelId });
        const analysisIds: string[] = enumRes.records[0]?.get('analysisIds') ?? [];

        // 2. Dispatch the model-delete lifecycle hook to every loaded module
        //    that implements it, on this same tx. Order is unspecified; each
        //    module must be self-contained from { modelId, analysisIds }. A
        //    throw aborts the whole transaction.
        let hookNodes = 0;
        let hookRels = 0;
        for (const moduleInstance of this.moduleRegistry.getAllModules().values()) {
          if (typeof moduleInstance.onModelDeleted === 'function') {
            const counts = await moduleInstance.onModelDeleted(tx, modelId, analysisIds);
            if (counts) {
              hookNodes += toNumber(counts.nodesDeleted);
              hookRels += toNumber(counts.relationshipsDeleted);
            }
          }
        }

        // 3. Structural delete — runs after the hooks, so any analysis subtree
        //    is already gone (and this query never names it anyway).
        const delRes = await tx.run(DELETE_MODEL_STRUCTURAL, { modelId });
        const structRow = delRes.records[0];
        const structNodes = toNumber(structRow?.get('nodesDeleted'));
        const structRels = toNumber(structRow?.get('relationshipsDeleted'));

        return {
          nodesDeleted: structNodes + hookNodes,
          relationshipsDeleted: structRels + hookRels,
        };
      });

      this.logger.log('Model deleted', {
        modelId,
        nodesDeleted: stats.nodesDeleted,
        relationshipsDeleted: stats.relationshipsDeleted,
      });
      return stats;
    } catch (error) {
      this.logger.error('Failed to delete model', {
        modelId,
        error: safeErrorMessage(error),
      });
      throw error;
    } finally {
      await session.close();
    }
  }
}
