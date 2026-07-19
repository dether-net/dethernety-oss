import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * Class-identity cleanup migration — invoked by the
 * `runIdentityMigration` admin GraphQL mutation and by the
 * `migrate:class-identity` CLI script (which is a thin wrapper around
 * this service).
 *
 * Heals accumulated drift in deployments where class identity has
 * fragmented (multiple class nodes sharing the same name with
 * different ids):
 *   1. Per platform `*Class` label, dedupes nodes that share a `name`
 *      WITHIN one identity bucket. Buckets are keyed per
 *      (owning module, name) — plus a separate bucket for nodes with no
 *      `HAS_CLASS`/`HAS_ORPHANED_CLASS` owner — because install keys
 *      classes on (module, label, name): two modules may legitimately own
 *      same-named classes, and those are NEVER merged. A node bound to
 *      more than one module is pathological and is excluded + reported,
 *      never touched. Canonical = the `HAS_CLASS`-bound node (lowest
 *      internal id among the actively bound), falling back to lowest
 *      internal id — so the survivor of a bound bucket keeps the module
 *      binding by construction. Every inbound data edge (`IS_INSTANCE_OF`,
 *      `IS_EXPOSURE_OF`, `IS_COUNTERMEASURE_OF`) is redirected to the
 *      canonical preserving edge properties, then the non-canonical is
 *      `DETACH DELETE`d — the whole group in ONE managed transaction, so
 *      a crash can never leave a half-redirected edge. If a non-canonical
 *      still carries an edge type outside the known set (module-binding
 *      edges excepted — the canonical has its own), its deletion is
 *      SKIPPED and reported rather than destroying data this tool does
 *      not understand.
 *   2. Dedupes duplicate `IS_INSTANCE_OF` edges per `(Analysis, AnalysisClass)`
 *      pair — keeps one, deletes the rest.
 *
 * Default mode is **dry-run**. Pass `apply: true` to mutate.
 * Idempotent: running twice produces identical end state.
 *
 * Memgraph operational note: avoid `WITH ... FOREACH (rel IN ... | DELETE
 * rel)` patterns — they silently fail across aggregation boundaries.
 * Use single-statement `MATCH ... DELETE` shapes instead. Every mutation
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

/**
 * Inbound data-edge types redirected onto the canonical during a merge.
 * Cypher cannot CREATE a relationship with a dynamic type, so the redirect
 * enumerates the known types (one statement each). Anything outside this
 * set trips the leftover-edge guard and blocks the delete instead.
 */
const REDIRECT_EDGE_TYPES = [
  'IS_INSTANCE_OF',
  'IS_EXPOSURE_OF',
  'IS_COUNTERMEASURE_OF',
] as const;

/**
 * Module-binding edge types. Never redirected: buckets are per-module, so
 * the canonical of a bound bucket already carries its own binding to the
 * same module and the non-canonical's copy legitimately dies with it.
 */
const MODULE_EDGE_TYPES = ['HAS_CLASS', 'HAS_ORPHANED_CLASS'] as const;

const UNBOUND_BUCKET = '<unbound>';

interface ClassNodeRow {
  name: string;
  internalId: number; // Memgraph/Neo4j internal id (id(c))
  owners: string[]; // distinct owning module names (via HAS_CLASS|HAS_ORPHANED_CLASS)
  activelyBound: boolean; // carries at least one HAS_CLASS edge
}

interface DuplicateGroup {
  name: string;
  /** Owning module name, or null for the unbound bucket. */
  owner: string | null;
  canonicalInternalId: number;
  nonCanonicalInternalIds: number[];
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
    const { groups, warnings } = await this.findDuplicateGroups(label);
    for (const w of warnings) {
      this.logger.warn(w);
      details.push(w);
    }
    if (groups.length === 0) return 0;

    let actions = 0;
    for (const group of groups) {
      const copies = 1 + group.nonCanonicalInternalIds.length;
      const line =
        `:${label} "${group.name}" [module: ${group.owner ?? UNBOUND_BUCKET}] — ${copies} copies; ` +
        `canonical=internalId(${group.canonicalInternalId}), to_delete=[${group.nonCanonicalInternalIds.join(',')}]`;
      this.logger.log(line);
      details.push(line);

      // Per-group failure isolation: each group runs in its own transaction,
      // so one poisoned group must not abort the run and discard the report
      // the operator needs to see which groups DID converge. The failed
      // group's tx rolled back; record it and continue.
      try {
        actions += await this.mergeGroup(label, group, apply, details);
      } catch (error) {
        const failLine =
          `  FAILED merge of :${label} "${group.name}" ` +
          `[module: ${group.owner ?? UNBOUND_BUCKET}]: ${error.message} — group rolled back; continuing`;
        this.logger.error(failLine);
        details.push(failLine);
      }
    }
    return actions;
  }

  /**
   * Find merge candidates for one label, bucketed per (owning module, name).
   * Same-name nodes owned by DIFFERENT modules land in different buckets and
   * are never merged — install keys classes on (module, label, name), so those
   * are legitimately-distinct classes. Nodes with no module binding form their
   * own `<unbound>` bucket (the genuine identity-drift population); a bound and
   * an unbound node sharing a name are NOT merged. A node bound to more than
   * one module is pathological: excluded from every bucket, surfaced as a
   * warning, and left untouched.
   */
  private async findDuplicateGroups(
    label: string,
  ): Promise<{ groups: DuplicateGroup[]; warnings: string[] }> {
    const result = await this.db.executeRead(
      `MATCH (c:${label})
       OPTIONAL MATCH (m:Module)-[b:HAS_CLASS|HAS_ORPHANED_CLASS]->(c)
       RETURN c.name AS name, id(c) AS internalId,
              collect(m.name) AS owners,
              collect(CASE WHEN b IS NULL THEN NULL ELSE type(b) END) AS bindingTypes`,
    );

    const warnings: string[] = [];
    const buckets = new Map<string, ClassNodeRow[]>();

    for (const r of result.records) {
      const owners = Array.from(
        new Set(
          (r.get('owners') as Array<string | null>).filter((o): o is string => o != null),
        ),
      );
      const bindingTypes = (r.get('bindingTypes') as Array<string | null>).filter(
        (t): t is string => t != null,
      );
      const row: ClassNodeRow = {
        name: r.get('name') as string,
        internalId: this.toNumber(r.get('internalId')),
        owners,
        activelyBound: bindingTypes.includes('HAS_CLASS'),
      };

      if (owners.length > 1) {
        warnings.push(
          `:${label} "${row.name}" internalId(${row.internalId}) is bound to ` +
            `${owners.length} modules [${owners.join(', ')}] — pathological; excluded from dedup`,
        );
        continue;
      }

      // NUL separator (as an escape sequence, never a raw byte): module and
      // class names are free text — a printable separator could collide two
      // distinct (module, name) pairs into one bucket, the exact wrong-merge
      // this grouping exists to prevent.
      const key = `${owners[0] ?? UNBOUND_BUCKET}\u0000${row.name}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(row);
      else buckets.set(key, [row]);
    }

    const groups: DuplicateGroup[] = [];
    for (const rows of buckets.values()) {
      if (rows.length < 2) continue;
      rows.sort((a, b) => a.internalId - b.internalId);
      // Canonical preference: the HAS_CLASS-bound node survives (lowest
      // internal id among the actively bound), so a merge can never leave the
      // survivor module-unbound — the wedge that broke future installs when
      // the deleted duplicate happened to hold the binding. Fallback (none
      // actively bound, e.g. the unbound bucket): lowest internal id.
      const canonical = rows.find((r) => r.activelyBound) ?? rows[0];
      groups.push({
        name: canonical.name,
        owner: canonical.owners[0] ?? null,
        canonicalInternalId: canonical.internalId,
        nonCanonicalInternalIds: rows
          .filter((r) => r !== canonical)
          .map((r) => r.internalId),
      });
    }

    return { groups, warnings };
  }

  /**
   * Merge one duplicate group into its canonical.
   *
   * Dry-run: pure reads — count the data edges a real run would redirect,
   * and run the same leftover predicate the apply-mode guard uses so the
   * preview honestly says `would SKIP` where apply would refuse the delete.
   *
   * Apply: the WHOLE group (every redirect + every delete) runs in ONE
   * managed write transaction, so a crash mid-merge rolls back cleanly and
   * can never leave a duplicated or half-redirected edge (the old shape ran
   * CREATE and DELETE in two separate auto-committed transactions). Redirects
   * MERGE onto the canonical (collapsing the case where a source was linked
   * to both duplicates into one edge) and copy edge properties server-side —
   * instantiation attributes carry data (see
   * `set-instantiation-attributes.service.ts`). Before each delete, a
   * leftover-edge guard refuses to `DETACH DELETE` a node that still carries
   * any edge type outside REDIRECT_EDGE_TYPES ∪ MODULE_EDGE_TYPES — unknown
   * data is reported, never destroyed; a SKIPPED node needs the operator to
   * resolve the unknown edge manually before the bucket can converge.
   *
   * Returns actions (1 per non-canonical actually deleted / planned for
   * deletion). Guarded skips are NOT counted, so a converged-but-guarded
   * graph reports totalActions 0 instead of claiming phantom work forever.
   */
  private async mergeGroup(
    label: string,
    group: DuplicateGroup,
    apply: boolean,
    details: string[],
  ): Promise<number> {
    if (!apply) {
      let planned = 0;
      for (const ncId of group.nonCanonicalInternalIds) {
        const res = await this.db.executeRead(
          `MATCH (a)-[r:IS_INSTANCE_OF|IS_EXPOSURE_OF|IS_COUNTERMEASURE_OF]->(t:${label})
           WHERE id(t) = $ncId
           RETURN count(r) AS n`,
          { ncId },
        );
        const n = this.toNumber(res.records[0]?.get('n') ?? 0);
        if (n > 0) {
          const line =
            `  would redirect ${n} edge(s) from ` +
            `internalId(${ncId}) → internalId(${group.canonicalInternalId})`;
          this.logger.log(line);
          details.push(line);
        }
        // Predict the apply-mode leftover guard: a real run redirects every
        // REDIRECT_EDGE_TYPES edge and excepts module edges, so anything
        // OUTSIDE both sets will still be there and block the delete.
        const blocked = await this.db.executeRead(
          `MATCH (c:${label})-[r]-() WHERE id(c) = $ncId AND NOT type(r) IN $knownEdges
           RETURN count(r) AS n, collect(DISTINCT type(r)) AS types`,
          { ncId, knownEdges: [...MODULE_EDGE_TYPES, ...REDIRECT_EDGE_TYPES] },
        );
        const blockedN = this.toNumber(blocked.records[0]?.get('n') ?? 0);
        if (blockedN > 0) {
          const types = (blocked.records[0]?.get('types') as string[]) ?? [];
          const line =
            `  would SKIP delete of internalId(${ncId}) — ${blockedN} unexpected ` +
            `edge(s) of type(s) [${types.join(', ')}]; resolve manually before this bucket can converge`;
          this.logger.log(line);
          details.push(line);
        } else {
          planned += 1;
        }
      }
      return planned;
    }

    const session = this.db.getSession();
    let lines: string[] = [];
    let actions = 0;
    try {
      await session.executeWrite(async (tx) => {
        // Managed transactions may retry the whole callback on transient
        // errors — reset the per-attempt accumulators so a retry can't
        // double-report.
        lines = [];
        actions = 0;
        for (const ncId of group.nonCanonicalInternalIds) {
          let moved = 0;
          for (const relType of REDIRECT_EDGE_TYPES) {
            // MERGE (not CREATE): a source already linked to BOTH duplicates
            // collapses onto its existing canonical edge instead of gaining a
            // permanent parallel duplicate (the post-pass dedup only heals
            // Analysis→AnalysisClass). count(*) not count(r): counting rows
            // never references the deleted binding, removing any engine doubt.
            const res = await tx.run(
              `MATCH (a)-[r:${relType}]->(t:${label}) WHERE id(t) = $ncId
               MATCH (canon:${label}) WHERE id(canon) = $canonicalId
               MERGE (a)-[r2:${relType}]->(canon)
               SET r2 += properties(r)
               DELETE r
               RETURN count(*) AS moved`,
              { ncId, canonicalId: group.canonicalInternalId },
            );
            moved += this.toNumber(res.records[0]?.get('moved') ?? 0);
          }
          if (moved > 0) {
            lines.push(
              `  redirected ${moved} edge(s) from ` +
                `internalId(${ncId}) → internalId(${group.canonicalInternalId})`,
            );
          }

          // Leftover-edge guard: after redirecting every known data-edge
          // type, only the node's own module-binding edges should remain.
          // Anything else is an edge type this tool does not know about —
          // refuse to delete rather than silently destroy it.
          const leftover = await tx.run(
            `MATCH (c:${label})-[r]-() WHERE id(c) = $ncId AND NOT type(r) IN $moduleEdges
             RETURN count(r) AS n, collect(DISTINCT type(r)) AS types`,
            { ncId, moduleEdges: [...MODULE_EDGE_TYPES] },
          );
          const remaining = this.toNumber(leftover.records[0]?.get('n') ?? 0);
          if (remaining > 0) {
            const types = (leftover.records[0]?.get('types') as string[]) ?? [];
            // NOT counted as an action: nothing was deleted, and counting it
            // would make totalActions non-zero forever on a graph that has
            // converged as far as this tool is allowed to take it.
            lines.push(
              `  SKIPPED delete of internalId(${ncId}) — ${remaining} unexpected ` +
                `edge(s) of type(s) [${types.join(', ')}] remain; refusing to destroy ` +
                `unknown data (resolve manually before this bucket can converge)`,
            );
          } else {
            await tx.run(`MATCH (c:${label}) WHERE id(c) = $ncId DETACH DELETE c`, {
              ncId,
            });
            actions += 1;
          }
        }
      });
    } finally {
      await session.close();
    }

    for (const line of lines) {
      this.logger.log(line);
      details.push(line);
    }
    return actions;
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
