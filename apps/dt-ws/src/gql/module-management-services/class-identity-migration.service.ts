import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * Class-identity cleanup migration — invoked by the
 * `runIdentityMigration` admin GraphQL mutation and by the
 * `migrate:class-identity` CLI script (which is a thin wrapper around
 * this service).
 *
 * Heals accumulated drift in deployments where class identity has
 * fragmented (e.g. multiple class nodes sharing the same name with
 * different ids):
 *   1. Per platform `*Class` label, dedupes nodes that share a `name` —
 *      picks a canonical (lowest internal id), redirects every incoming
 *      `IS_INSTANCE_OF` edge to it preserving edge properties, then
 *      `DETACH DELETE`s the non-canonical duplicates.
 *   2. Dedupes duplicate `IS_INSTANCE_OF` edges per `(Analysis, AnalysisClass)`
 *      pair — keeps one, deletes the rest.
 *
 * Default mode is **dry-run**. Pass `apply: true` to mutate.
 * Idempotent: running twice produces identical end state.
 *
 * Memgraph operational note: avoid `WITH ... FOREACH (rel IN ... | DELETE
 * rel)` patterns — they silently fail across aggregation boundaries.
 * Use `MATCH ... WHERE id(r) IN [...] DELETE r` instead. Every mutation
 * in this service follows that shape.
 */

const PLATFORM_CLASS_LABELS = [
  'AnalysisClass',
  'ComponentClass',
  'ControlClass',
  'DataFlowClass',
  'DataClass',
  'SecurityBoundaryClass',
  'IssueClass',
] as const;

interface DuplicateGroup {
  name: string;
  internalIds: number[]; // Memgraph internal ids (id(c)), low → high
}

interface DuplicateInstanceEdge {
  analysisInternalId: number;
  classInternalId: number;
  edgeInternalIds: number[]; // edges between the same (a, c), low → high
}

export interface IdentityMigrationReport {
  /** True if this was a dry-run (no writes performed). */
  dryRun: boolean;
  /** Sum of mutating actions performed (or planned, in dry-run). */
  totalActions: number;
  /** Per-source breakdown — log-line strings, one per action group. */
  details: string[];
}

@Injectable()
export class ClassIdentityMigrationService {
  private readonly logger = new Logger(ClassIdentityMigrationService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Single public entry point. `apply: true` mutates; `apply: false` (default
   * for the GraphQL mutation) reports planned actions without writing.
   */
  async run({ apply }: { apply: boolean }): Promise<IdentityMigrationReport> {
    const mode = apply ? 'APPLY' : 'DRY-RUN';
    const details: string[] = [];
    this.logger.log(`Starting class-identity cleanup (mode: ${mode})`);
    details.push(`mode: ${mode}`);

    let totalActions = 0;

    for (const label of PLATFORM_CLASS_LABELS) {
      const actions = await this.dedupLabel(label, apply, details);
      if (actions > 0) details.push(`:${label} — ${actions} actions`);
      totalActions += actions;
    }

    const dupEdgeActions = await this.dedupAnalysisInstanceEdges(apply, details);
    if (dupEdgeActions > 0) {
      details.push(`IS_INSTANCE_OF (duplicate edges) — ${dupEdgeActions} actions`);
    }
    totalActions += dupEdgeActions;

    if (totalActions === 0) {
      details.push('No drift detected — database is clean.');
    }

    this.logger.log(`Cleanup complete (mode: ${mode}) — total mutating actions: ${totalActions}`);

    return { dryRun: !apply, totalActions, details };
  }

  private async dedupLabel(label: string, apply: boolean, details: string[]): Promise<number> {
    const duplicates = await this.findDuplicateGroups(label);
    if (duplicates.length === 0) return 0;

    let actions = 0;
    for (const group of duplicates) {
      const [canonical, ...nonCanonicals] = group.internalIds;
      const line =
        `:${label} "${group.name}" — ${group.internalIds.length} copies; ` +
        `canonical=internalId(${canonical}), to_delete=[${nonCanonicals.join(',')}]`;
      this.logger.log(line);
      details.push(line);

      for (const nonCanonical of nonCanonicals) {
        const edgesRedirected = await this.redirectInstanceEdges(label, nonCanonical, canonical, apply);
        if (edgesRedirected > 0) {
          const redirLine =
            `  redirected ${edgesRedirected} IS_INSTANCE_OF edge(s) from ` +
            `internalId(${nonCanonical}) → internalId(${canonical})`;
          this.logger.log(redirLine);
          details.push(redirLine);
        }
        await this.detachDeleteNode(label, nonCanonical, apply);
        actions += 1;
      }
    }
    return actions;
  }

  private async findDuplicateGroups(label: string): Promise<DuplicateGroup[]> {
    const result = await this.db.executeRead(
      `MATCH (c:${label})
       WITH c.name AS name, collect(id(c)) AS ids
       WHERE size(ids) > 1
       RETURN name, ids`,
    );
    return result.records.map((r) => {
      const rawIds = r.get('ids') as Array<number | { toNumber: () => number }>;
      const internalIds = rawIds
        .map((v) => this.toNumber(v))
        .sort((a, b) => a - b);
      return { name: r.get('name') as string, internalIds };
    });
  }

  /**
   * Redirect every `IS_INSTANCE_OF` edge from non-canonical to canonical.
   * Preserves edge properties (instantiation attributes carry data — see
   * `set-instantiation-attributes.service.ts`). Per the design's operational
   * note, uses `MATCH ... WHERE id(r) IN [...] DELETE r` rather than
   * `FOREACH ... DELETE` (which silently fails across aggregation boundaries
   * on Memgraph).
   *
   * Returns the count of edges redirected.
   */
  private async redirectInstanceEdges(
    label: string,
    nonCanonicalInternalId: number,
    canonicalInternalId: number,
    apply: boolean,
  ): Promise<number> {
    const edgeResult = await this.db.executeRead(
      `MATCH (a)-[r:IS_INSTANCE_OF]->(t:${label})
       WHERE id(t) = $nonCanonicalId
       RETURN id(r) AS edgeId, id(a) AS sourceId, properties(r) AS props`,
      { nonCanonicalId: nonCanonicalInternalId },
    );

    const edges = edgeResult.records.map((r) => ({
      edgeInternalId: this.toNumber(r.get('edgeId')),
      sourceInternalId: this.toNumber(r.get('sourceId')),
      props: r.get('props') as Record<string, unknown>,
    }));

    if (edges.length === 0) return 0;
    if (!apply) return edges.length;

    for (const e of edges) {
      await this.db.executeWrite(
        `MATCH (a) WHERE id(a) = $sourceId
         MATCH (t:${label}) WHERE id(t) = $canonicalId
         CREATE (a)-[r2:IS_INSTANCE_OF]->(t)
         SET r2 = $props`,
        { sourceId: e.sourceInternalId, canonicalId: canonicalInternalId, props: e.props },
      );
      await this.db.executeWrite(
        `MATCH ()-[r:IS_INSTANCE_OF]->()
         WHERE id(r) = $edgeId
         DELETE r`,
        { edgeId: e.edgeInternalId },
      );
    }

    return edges.length;
  }

  private async detachDeleteNode(label: string, internalId: number, apply: boolean): Promise<void> {
    if (!apply) return;
    await this.db.executeWrite(
      `MATCH (c:${label}) WHERE id(c) = $internalId DETACH DELETE c`,
      { internalId },
    );
  }

  /**
   * Find duplicate `IS_INSTANCE_OF` edges between the same (Analysis,
   * AnalysisClass) pair. Keep the lowest-internal-id edge, delete the rest.
   * This is the Layer 3 cleanup from the design — `connect`-not-MERGE produced
   * stacking duplicates per `runAnalysis` invocation.
   */
  private async dedupAnalysisInstanceEdges(apply: boolean, details: string[]): Promise<number> {
    const result = await this.db.executeRead(
      `MATCH (a:Analysis)-[r:IS_INSTANCE_OF]->(c:AnalysisClass)
       WITH a, c, collect(id(r)) AS edgeIds
       WHERE size(edgeIds) > 1
       RETURN id(a) AS analysisId, id(c) AS classId, edgeIds`,
    );

    const dups: DuplicateInstanceEdge[] = result.records.map((r) => {
      const rawIds = r.get('edgeIds') as Array<number | { toNumber: () => number }>;
      const edgeInternalIds = rawIds.map((v) => this.toNumber(v)).sort((a, b) => a - b);
      return {
        analysisInternalId: this.toNumber(r.get('analysisId')),
        classInternalId: this.toNumber(r.get('classId')),
        edgeInternalIds,
      };
    });

    if (dups.length === 0) return 0;

    let actions = 0;
    for (const dup of dups) {
      const [keep, ...remove] = dup.edgeInternalIds;
      const line =
        `IS_INSTANCE_OF dup: Analysis(${dup.analysisInternalId}) → AnalysisClass(${dup.classInternalId}) — ` +
        `${dup.edgeInternalIds.length} edges; keep=${keep}, delete=[${remove.join(',')}]`;
      this.logger.log(line);
      details.push(line);
      if (apply) {
        await this.db.executeWrite(
          `MATCH ()-[r:IS_INSTANCE_OF]->()
           WHERE id(r) IN $edgeIds
           DELETE r`,
          { edgeIds: remove },
        );
      }
      actions += remove.length;
    }
    return actions;
  }

  private toNumber(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'object' && value !== null && 'toNumber' in value) {
      return (value as { toNumber: () => number }).toNumber();
    }
    return Number(value);
  }
}
