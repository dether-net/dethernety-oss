import { Inject, Injectable, Logger } from '@nestjs/common';
import { DatabaseTransaction } from '../interfaces/module-management.interface';
import { ClassIdentityEventLog } from './class-identity-event-log.service';

// Edge-rename mechanics for the HAS_CLASS ↔ HAS_ORPHANED_CLASS transition.
// MAGE's `refactor.rename_type` is the preferred path; the explicit
// DELETE+CREATE+SET-properties fallback exists for non-MAGE Memgraph
// deployments. The demo image bundles MAGE so the happy path is the hot
// one. MAGE availability is probed once per process and cached.

@Injectable()
export class ClassReconciler {
  private readonly logger = new Logger(ClassReconciler.name);
  private mageAvailable: boolean | null = null;

  // Driver injected so the MAGE probe can run in its OWN session — running
  // `CALL mg.procedures()` inside a caller-supplied write tx aborts the tx
  // on Memgraph (verified empirically; the introspection call is rejected
  // mid-write and the entire transaction rolls back).
  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
    public readonly events: ClassIdentityEventLog,
  ) {}

  /**
   * Probe Memgraph for MAGE's `refactor.rename_type` procedure. Cached
   * for the process lifetime — the procedure set doesn't change at runtime.
   * Runs in its own session to keep clear of caller transactions.
   */
  private async probeMage(): Promise<boolean> {
    if (this.mageAvailable !== null) return this.mageAvailable;
    const session = this.neo4jDriver.session();
    try {
      // Use `WITH` to interpose between YIELD and WHERE — Memgraph's
      // auto-commit parser rejects `CALL ... YIELD x WHERE ...` directly
      // (the implicit-tx parser inside a Bolt write tx is more lenient,
      // but this code intentionally runs in its own session).
      const result = await session.run(
        `CALL mg.procedures() YIELD name
         WITH name WHERE name = 'refactor.rename_type'
         RETURN count(name) AS n`,
      );
      const n = result.records[0]?.get('n');
      const count =
        typeof n === 'object' && n !== null && 'toNumber' in n
          ? (n as { toNumber(): number }).toNumber()
          : Number(n ?? 0);
      this.mageAvailable = count > 0;
      this.logger.log(
        this.mageAvailable
          ? 'MAGE refactor.rename_type available — happy-path orphan rename'
          : 'MAGE refactor.rename_type NOT available — using DELETE+CREATE fallback',
      );
    } catch (e) {
      // Don't poison-cache transient probe errors as `false` — that
      // would lock the process into the fallback path forever. Leave
      // mageAvailable at `null` so the next call re-probes; only the
      // confirmed-absent answer (count === 0) is cached. The single
      // call's caller falls back this round.
      this.logger.warn(
        'MAGE probe transient failure — using fallback this call, will re-probe next time',
        { error: (e as Error).message },
      );
    } finally {
      await session.close();
    }
    return this.mageAvailable ?? false;
  }

  /** Test-only override of the cached probe result. */
  setMageAvailableForTesting(available: boolean | null): void {
    this.mageAvailable = available;
  }

  /**
   * Rename HAS_CLASS → HAS_ORPHANED_CLASS for the (module, classLabel, classId).
   * Properties on the edge survive both transitions.
   */
  async orphanClass(
    tx: DatabaseTransaction,
    moduleName: string,
    classLabel: string,
    classId: string,
  ): Promise<void> {
    await this.renameEdge(tx, moduleName, classLabel, classId, 'HAS_CLASS', 'HAS_ORPHANED_CLASS');
  }

  /**
   * Reverse: HAS_ORPHANED_CLASS → HAS_CLASS. Symmetric with orphanClass.
   */
  async reviveClass(
    tx: DatabaseTransaction,
    moduleName: string,
    classLabel: string,
    classId: string,
  ): Promise<void> {
    await this.renameEdge(tx, moduleName, classLabel, classId, 'HAS_ORPHANED_CLASS', 'HAS_CLASS');
  }

  private async renameEdge(
    tx: DatabaseTransaction,
    moduleName: string,
    classLabel: string,
    classId: string,
    fromType: string,
    toType: string,
  ): Promise<void> {
    const useMage = await this.probeMage();
    if (useMage) {
      // MAGE happy path. Argument order: (oldType, newType, rels). `rels`
      // must be a LIST OF RELATIONSHIP — collect after MATCH. The
      // `WHERE size(rels) > 0` guard makes the call a no-op when the edge
      // is already at the target type (idempotent re-run safety; some
      // MAGE versions raise on empty rels lists).
      await tx.run(
        `MATCH (m:Module {name: $moduleName})-[r:${fromType}]->(c:${classLabel} {id: $classId})
         WITH collect(r) AS rels
         WHERE size(rels) > 0
         CALL refactor.rename_type($from, $to, rels) YIELD relationships_changed
         RETURN relationships_changed`,
        { moduleName, classId, from: fromType, to: toType },
      );
    } else {
      // Fallback: explicit DELETE + CREATE + property copy. Less atomic than
      // MAGE but functionally equivalent end state.
      await tx.run(
        `MATCH (m:Module {name: $moduleName})-[r:${fromType}]->(c:${classLabel} {id: $classId})
         WITH m, c, r, properties(r) AS oldProps
         DELETE r
         CREATE (m)-[newR:${toType}]->(c)
         SET newR = oldProps`,
        { moduleName, classId },
      );
    }
    // Stamp `orphanedAt` on transition into HAS_ORPHANED_CLASS so the
    // admin surface can show "when did this class last fall out of metadata".
    // Lives inside the same write tx as the rename — partial-failure
    // invariant holds. Re-orphan after revive overwrites; the operator
    // cares about the most-recent fall-out, not the first-ever.
    if (toType === 'HAS_ORPHANED_CLASS') {
      // Pin the timezone so the value round-trips cleanly through the
      // @neo4j/graphql DateTime scalar — bare `datetime()` returns a
      // local-flavored temporal on some Memgraph configurations, which
      // serializes as ISO without the trailing `Z` and confuses operators
      // who assume UTC.
      await tx.run(
        `MATCH (c:${classLabel} {id: $classId}) SET c.orphanedAt = datetime({timezone: 'UTC'})`,
        { classId },
      );
    }
  }

  /**
   * True if any incoming IS_INSTANCE_OF edges exist for the class.
   * Used to decide orphan-vs-DETACH-DELETE on reconciliation.
   */
  async hasIncidentInstances(
    tx: DatabaseTransaction,
    classLabel: string,
    classId: string,
  ): Promise<boolean> {
    const result = await tx.run(
      `MATCH (c:${classLabel} {id: $classId})<-[r:IS_INSTANCE_OF]-()
       RETURN count(r) AS n LIMIT 1`,
      { classId },
    );
    const n = result.records[0]?.get('n');
    const count =
      typeof n === 'object' && n !== null && 'toNumber' in n
        ? (n as { toNumber(): number }).toNumber()
        : Number(n ?? 0);
    return count > 0;
  }
}
