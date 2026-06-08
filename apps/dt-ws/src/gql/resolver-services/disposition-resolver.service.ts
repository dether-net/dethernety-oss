import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { AuthorizationService } from '../services/authorization.service';
import { MonitoringService } from '../services/monitoring.service';
import { safeErrorMessage } from '../../common/utils/safe-error-message';

// ---------------------------------------------------------------------------
// Type contracts.
// Mirrors the GraphQL DispositionMutationResult / DispositionErrorCode /
// DispositionKind surface from schema.graphql.
// ---------------------------------------------------------------------------

type DispositionKind =
  | 'NOT_APPLICABLE'
  | 'FALSE_POSITIVE'
  | 'COMPENSATING_CONTROL'
  | 'RISK_ACCEPTED'
  | 'WAIVED'
  | 'SUPERSEDED'
  | 'AFFIRMED';

type DispositionErrorCode =
  | 'VALIDATION_ERROR'
  | 'EXPOSURE_NOT_FOUND'
  | 'DATABASE_ERROR';

interface DispositionMutationResult {
  success: boolean;
  exposureId: string;
  dispositionKind: DispositionKind | null;
  dispositionReason: string | null;
  dispositionedBy: string | null;
  dispositionedAt: string | null;
  dispositionStale: boolean | null;
  errorCode: DispositionErrorCode | null;
  errorMessage: string | null;
}

// Per-finding pickable kinds. The dispose helper validates against the set
// passed by its caller — the server-side mirror of the dialog's UI filter.
// SUPERSEDED is accepted on both (the Supersede orchestrator submits it);
// the dialog hides it.
const EXPOSURE_PICKABLE: ReadonlySet<DispositionKind> = new Set([
  'NOT_APPLICABLE',
  'FALSE_POSITIVE',
  'COMPENSATING_CONTROL',
  'RISK_ACCEPTED',
  'SUPERSEDED',
  'AFFIRMED',
]);

const COUNTERMEASURE_PICKABLE: ReadonlySet<DispositionKind> = new Set([
  'NOT_APPLICABLE',
  'FALSE_POSITIVE',
  'WAIVED',
  'SUPERSEDED',
  'AFFIRMED',
]);

const REASON_MAX_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Envelope builders.
// ---------------------------------------------------------------------------

function failureEnvelope(
  findingId: string,
  errorCode: DispositionErrorCode,
  errorMessage: string,
): DispositionMutationResult {
  return {
    success: false,
    exposureId: findingId,
    dispositionKind: null,
    dispositionReason: null,
    dispositionedBy: null,
    dispositionedAt: null,
    dispositionStale: null,
    errorCode,
    errorMessage,
  };
}

// ---------------------------------------------------------------------------
// Service.
// Implements disposeExposure + clearDisposition: validation, identity
// short-circuits, actor derivation, structured errors, observability.
// ---------------------------------------------------------------------------

@Injectable()
export class DispositionResolverService {
  private readonly logger = new Logger(DispositionResolverService.name);

  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
    private readonly configService: ConfigService,
    private readonly authorizationService: AuthorizationService,
    private readonly monitoringService: MonitoringService,
  ) {
    this.logger.log('DispositionResolverService initialized');
  }

  async disposeExposure(
    args: { exposureId: string; kind: DispositionKind; reason: string },
    graphqlContext: any,
  ): Promise<DispositionMutationResult> {
    return this._applyDisposition(
      'Exposure',
      'disposeExposure',
      EXPOSURE_PICKABLE,
      { findingId: args.exposureId, kind: args.kind, reason: args.reason },
      graphqlContext,
    );
  }

  async clearDisposition(
    args: { exposureId: string },
    graphqlContext: any,
  ): Promise<DispositionMutationResult> {
    return this._clearDisposition(
      'Exposure',
      'clearDisposition',
      { findingId: args.exposureId },
      graphqlContext,
    );
  }

  // ===========================================================================
  // Shared write logic. `label` is a hard-coded literal per public method
  // (never user input), so the single-label interpolation is injection-safe
  // and matches the shipped single-label idiom. `pickable` is the per-finding
  // kind allowlist (the server-side mirror of the dialog's UI filter);
  // `opName` drives observability so each finding type logs under its own
  // mutation name.
  // ===========================================================================
  private async _applyDisposition(
    label: 'Exposure' | 'Countermeasure',
    opName: string,
    pickable: ReadonlySet<DispositionKind>,
    args: { findingId: string; kind: DispositionKind; reason: string },
    graphqlContext: any,
  ): Promise<DispositionMutationResult> {
    const operationId = randomUUID();
    const startedAt = Date.now();
    const { findingId, kind, reason } = args;

    // ===== Actor derivation =====
    // `graphqlContext.user.sub` is the JWT subject claim per RFC 7519.
    // Absent should be impossible under @authentication; treat as
    // VALIDATION_ERROR defence-in-depth.
    const actor: string | null = graphqlContext?.user?.sub ?? null;
    if (!actor) {
      const msg = 'Missing actor (context.user.sub absent)';
      this.logFailure('dispose', opName, operationId, null, findingId, kind, msg, 'VALIDATION_ERROR', startedAt);
      return failureEnvelope(findingId, 'VALIDATION_ERROR', msg);
    }

    // ===== Input validation =====
    if (typeof findingId !== 'string' || findingId.length === 0) {
      const msg = `${label.toLowerCase()}Id is required`;
      this.logFailure('dispose', opName, operationId, actor, findingId, kind, msg, 'VALIDATION_ERROR', startedAt);
      return failureEnvelope(findingId, 'VALIDATION_ERROR', msg);
    }
    if (!pickable.has(kind)) {
      const msg = `Invalid kind for ${label}: ${kind}`;
      this.logFailure('dispose', opName, operationId, actor, findingId, kind, msg, 'VALIDATION_ERROR', startedAt);
      return failureEnvelope(findingId, 'VALIDATION_ERROR', msg);
    }
    if (typeof reason !== 'string') {
      const msg = 'reason must be a string';
      this.logFailure('dispose', opName, operationId, actor, findingId, kind, msg, 'VALIDATION_ERROR', startedAt);
      return failureEnvelope(findingId, 'VALIDATION_ERROR', msg);
    }
    const reasonTrimmed = reason.trim();
    if (reasonTrimmed.length === 0) {
      const msg = 'reason cannot be empty';
      this.logFailure('dispose', opName, operationId, actor, findingId, kind, msg, 'VALIDATION_ERROR', startedAt);
      return failureEnvelope(findingId, 'VALIDATION_ERROR', msg);
    }
    if (reason.length > REASON_MAX_LENGTH) {
      const msg = `reason exceeds ${REASON_MAX_LENGTH} chars`;
      this.logFailure('dispose', opName, operationId, actor, findingId, kind, msg, 'VALIDATION_ERROR', startedAt);
      return failureEnvelope(findingId, 'VALIDATION_ERROR', msg);
    }

    // ===== SUPERSEDED -> AFFIRMED guard =====
    // Affirming a superseded finding would resurrect a retired row into a second
    // live (confirmed) finding for one risk, double-counting it. The UI never
    // offers affirm on a disposed row; this rejects the direct-GraphQL /
    // programmatic path. AFFIRMED-only pre-read keeps the common dispose path
    // unchanged. Plain MATCH/RETURN (Memgraph-safe); a missing node returns null
    // here and falls through to the not-found path in the write block below.
    if (kind === 'AFFIRMED') {
      const guardSession = this.neo4jDriver.session({
        database: this.configService.get('database.name') || 'neo4j',
      });
      try {
        const current = await guardSession.executeRead(async (tx: any) => {
          const r = await tx.run(
            `MATCH (n:${label} {id: $id}) RETURN n.dispositionKind AS k`,
            { id: findingId },
          );
          return r.records.length === 0 ? null : (r.records[0].get('k') ?? null);
        });
        if (current === 'SUPERSEDED') {
          const msg = `Cannot affirm a superseded ${label.toLowerCase()}`;
          this.logFailure('dispose', opName, operationId, actor, findingId, kind, msg, 'VALIDATION_ERROR', startedAt);
          return failureEnvelope(findingId, 'VALIDATION_ERROR', msg);
        }
      } finally {
        await guardSession.close();
      }
    }

    // ===== Cypher =====
    // Single SET writes all five disposition fields atomically. The
    // `coalesce(n.dispositionStale, false) AS wasStale` snapshot pre-SET is the
    // observability signal for "was this a re-affirm of a stale row".
    const now = new Date().toISOString();
    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name') || 'neo4j',
    });

    try {
      const record = await session.executeWrite(async (tx: any) => {
        const result = await tx.run(
          `
          MATCH (n:${label} {id: $id})
          WITH n, coalesce(n.dispositionStale, false) AS wasStale,
               n.dispositionKind AS oldKind
          SET n.dispositionKind   = $kind,
              n.dispositionReason = $reason,
              n.dispositionedBy   = $actor,
              n.dispositionedAt   = $now,
              n.dispositionStale  = false
          RETURN n.id                AS findingId,
                 n.dispositionKind   AS dispositionKind,
                 n.dispositionReason AS dispositionReason,
                 n.dispositionedBy   AS dispositionedBy,
                 n.dispositionedAt   AS dispositionedAt,
                 n.dispositionStale  AS dispositionStale,
                 wasStale            AS wasStale,
                 oldKind             AS oldKind
          `,
          { id: findingId, kind, reason: reasonTrimmed, actor, now },
        );
        return result.records.length === 0 ? null : result.records[0];
      });

      if (!record) {
        const msg = `${label} ${findingId} not found`;
        this.logFailure('dispose', opName, operationId, actor, findingId, kind, msg, 'EXPOSURE_NOT_FOUND', startedAt);
        return failureEnvelope(findingId, 'EXPOSURE_NOT_FOUND', msg);
      }

      const wasStale = Boolean(record.get('wasStale'));
      const oldKind = (record.get('oldKind') ?? null) as DispositionKind | null;
      const dispositionedAtRaw = record.get('dispositionedAt');
      const dispositionedAt =
        dispositionedAtRaw && typeof dispositionedAtRaw.toString === 'function'
          ? dispositionedAtRaw.toString()
          : dispositionedAtRaw;

      const durationMs = Date.now() - startedAt;
      this.logger.log('Disposition action', {
        action: 'dispose',
        label,
        actor,
        findingId,
        oldKind,
        newKind: kind,
        wasStale,
        reasonLength: reasonTrimmed.length,
        operationId,
        durationMs,
      });
      this.monitoringService.recordOperation({
        operationName: opName,
        duration: durationMs,
        success: true,
        timestamp: new Date(),
        metadata: { action: 'dispose', label, kind, wasStale, oldKind },
      });

      return {
        success: true,
        exposureId: record.get('findingId') as string,
        dispositionKind: record.get('dispositionKind') as DispositionKind | null,
        dispositionReason: record.get('dispositionReason') as string | null,
        dispositionedBy: record.get('dispositionedBy') as string | null,
        dispositionedAt: dispositionedAt as string | null,
        dispositionStale: Boolean(record.get('dispositionStale')),
        errorCode: null,
        errorMessage: null,
      };
    } catch (error: any) {
      const msg = safeErrorMessage(error);
      this.logFailure('dispose', opName, operationId, actor, findingId, kind, msg, 'DATABASE_ERROR', startedAt);
      return failureEnvelope(findingId, 'DATABASE_ERROR', msg);
    } finally {
      await session.close();
    }
  }

  private async _clearDisposition(
    label: 'Exposure' | 'Countermeasure',
    opName: string,
    args: { findingId: string },
    graphqlContext: any,
  ): Promise<DispositionMutationResult> {
    const operationId = randomUUID();
    const startedAt = Date.now();
    const { findingId } = args;

    const actor: string | null = graphqlContext?.user?.sub ?? null;
    if (!actor) {
      const msg = 'Missing actor (context.user.sub absent)';
      this.logFailure('clear', opName, operationId, null, findingId, null, msg, 'VALIDATION_ERROR', startedAt);
      return failureEnvelope(findingId, 'VALIDATION_ERROR', msg);
    }

    if (typeof findingId !== 'string' || findingId.length === 0) {
      const msg = `${label.toLowerCase()}Id is required`;
      this.logFailure('clear', opName, operationId, actor, findingId, null, msg, 'VALIDATION_ERROR', startedAt);
      return failureEnvelope(findingId, 'VALIDATION_ERROR', msg);
    }

    // SET-to-null on all five disposition fields. Clear-on-already-cleared
    // is a successful no-op (DB-side idempotency; the SET on null-already-null
    // writes the same value).
    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name') || 'neo4j',
    });
    try {
      const record = await session.executeWrite(async (tx: any) => {
        const result = await tx.run(
          `
          MATCH (n:${label} {id: $id})
          WITH n, coalesce(n.dispositionStale, false) AS wasStale,
               n.dispositionKind AS oldKind
          SET n.dispositionKind   = null,
              n.dispositionReason = null,
              n.dispositionedBy   = null,
              n.dispositionedAt   = null,
              n.dispositionStale  = null
          RETURN n.id AS findingId, wasStale AS wasStale, oldKind AS oldKind
          `,
          { id: findingId },
        );
        return result.records.length === 0 ? null : result.records[0];
      });

      if (!record) {
        const msg = `${label} ${findingId} not found`;
        this.logFailure('clear', opName, operationId, actor, findingId, null, msg, 'EXPOSURE_NOT_FOUND', startedAt);
        return failureEnvelope(findingId, 'EXPOSURE_NOT_FOUND', msg);
      }

      const wasStale = Boolean(record.get('wasStale'));
      const oldKind = (record.get('oldKind') ?? null) as DispositionKind | null;
      const durationMs = Date.now() - startedAt;
      this.logger.log('Disposition action', {
        action: 'clear',
        label,
        actor,
        findingId,
        oldKind,
        newKind: null,
        wasStale,
        reasonLength: 0,
        operationId,
        durationMs,
      });
      this.monitoringService.recordOperation({
        operationName: opName,
        duration: durationMs,
        success: true,
        timestamp: new Date(),
        metadata: { action: 'clear', label, wasStale, oldKind },
      });

      return {
        success: true,
        exposureId: record.get('findingId') as string,
        dispositionKind: null,
        dispositionReason: null,
        dispositionedBy: null,
        dispositionedAt: null,
        dispositionStale: null,
        errorCode: null,
        errorMessage: null,
      };
    } catch (error: any) {
      const msg = safeErrorMessage(error);
      this.logFailure('clear', opName, operationId, actor, findingId, null, msg, 'DATABASE_ERROR', startedAt);
      return failureEnvelope(findingId, 'DATABASE_ERROR', msg);
    } finally {
      await session.close();
    }
  }

  private logFailure(
    action: 'dispose' | 'clear',
    opName: string,
    operationId: string,
    actor: string | null,
    findingId: string,
    kind: DispositionKind | null,
    errorMessage: string,
    errorCode: DispositionErrorCode,
    startedAt: number,
  ): void {
    const durationMs = Date.now() - startedAt;
    this.logger.error('Disposition action failed', {
      action,
      actor,
      findingId,
      newKind: kind,
      errorCode,
      errorMessage,
      operationId,
      durationMs,
    });
    this.monitoringService.recordOperation({
      operationName: opName,
      duration: durationMs,
      success: false,
      timestamp: new Date(),
      metadata: { action, errorCode, kind },
    });
  }

  async disposeCountermeasure(
    args: { countermeasureId: string; kind: DispositionKind; reason: string },
    graphqlContext: any,
  ): Promise<DispositionMutationResult> {
    return this._applyDisposition(
      'Countermeasure',
      'disposeCountermeasure',
      COUNTERMEASURE_PICKABLE,
      { findingId: args.countermeasureId, kind: args.kind, reason: args.reason },
      graphqlContext,
    );
  }

  async clearCountermeasureDisposition(
    args: { countermeasureId: string },
    graphqlContext: any,
  ): Promise<DispositionMutationResult> {
    return this._clearDisposition(
      'Countermeasure',
      'clearCountermeasureDisposition',
      { findingId: args.countermeasureId },
      graphqlContext,
    );
  }

  getResolvers() {
    return {
      Mutation: {
        disposeExposure: (_parent: any, args: any, ctx: any) =>
          this.disposeExposure(args, ctx),
        clearDisposition: (_parent: any, args: any, ctx: any) =>
          this.clearDisposition(args, ctx),
        disposeCountermeasure: (_parent: any, args: any, ctx: any) =>
          this.disposeCountermeasure(args, ctx),
        clearCountermeasureDisposition: (_parent: any, args: any, ctx: any) =>
          this.clearCountermeasureDisposition(args, ctx),
      },
    };
  }
}
