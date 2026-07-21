import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

import { ModuleRegistryService } from '../module-management-services/module-registry.service';
import { AuthorizationService } from '../services/authorization.service';
import { safeErrorMessage } from '../../common/utils/safe-error-message';
import {
  DatabaseSession,
  DatabaseTransaction,
  UpsertCountermeasuresRequest,
  UpsertExposuresRequest,
} from '../interfaces/set-instantiation-attributes.interface';
import { SetInstantiationAttributesService } from './set-instantiation-attributes.service';

/**
 * Atomic class-change resolver.
 *
 * Owns the `changeElementBinding` mutation end-to-end: validation, preflight
 * reads, module SDK calls, the single `executeWrite` transaction (current-
 * binding read inside tx → identity check → destructive sweep → rewire →
 * constructive upsert via SetInstantiationAttributesService's tx-bound
 * helpers), error mapping, and structured observability.
 *
 * Authorization is enforced exclusively by the `@authentication` directive
 * on the mutation in `schema.graphql`; this service does no in-resolver
 * authz checks (per project convention: module/resolver code never owns
 * authz — the JWT guard does).
 */

// ---------------------------------------------------------------------------
// Local types (mirrored from schema.graphql).
// ---------------------------------------------------------------------------

export type ElementBindingKind = 'CLASS' | 'REPRESENTED_MODEL' | 'NONE';

export interface ElementBindingInput {
  kind: ElementBindingKind;
  classIds?: string[] | null;
  modelId?: string | null;
}

export type ElementBindingErrorCode =
  | 'VALIDATION_ERROR'
  | 'ELEMENT_NOT_FOUND'
  | 'CLASS_NOT_FOUND'
  | 'MODEL_NOT_FOUND'
  | 'ORPHAN_CLASS_REFUSED'
  | 'REPRESENTED_MODEL_NOT_ALLOWED'
  | 'MODULE_ERROR'
  | 'DATABASE_ERROR';

export interface ElementBindingDeltas {
  deletedDerivedExposures: number;
  instantiatedDerivedExposures: number;
  preservedCustomExposures: number;
  deletedDerivedCountermeasures: number;
  instantiatedDerivedCountermeasures: number;
  preservedCustomCountermeasures: number;
}

export interface ChangeElementBindingResult {
  success: boolean;
  elementId: string;
  targetBinding: {
    __typename: 'ClassBinding' | 'RepresentedModelBinding' | 'NoBinding';
    classIds?: string[];
    modelId?: string;
    _empty?: boolean | null;
  };
  deltas: ElementBindingDeltas;
  errorCode: ElementBindingErrorCode | null;
  errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// Element-type → class-label map. The class label is interpolated into
// Cypher at query-build time (labels cannot be parameterised in Cypher).
// The substitution is hardcoded from a closed set keyed on the element type
// read from `labels(element)[0]`; no user input flows into the label slot.
// ---------------------------------------------------------------------------

const ELEMENT_TYPE_TO_CLASS_LABEL: Record<string, string> = {
  Component: 'ComponentClass',
  SecurityBoundary: 'SecurityBoundaryClass',
  DataFlow: 'DataFlowClass',
  Data: 'DataClass',
  Control: 'ControlClass',
};
// Set form used for `labels.find(...)` — avoids the `in` operator's
// prototype-chain match (e.g. `'toString' in obj` is true).
const ELEMENT_TYPE_KEYS = new Set(Object.keys(ELEMENT_TYPE_TO_CLASS_LABEL));

const REPRESENTED_MODEL_ELIGIBLE = new Set(['Component', 'SecurityBoundary']);
const CONTROL_TYPES = new Set(['Control']);

function classLabelForElementType(elementType: string): string | null {
  return ELEMENT_TYPE_TO_CLASS_LABEL[elementType] ?? null;
}

// ---------------------------------------------------------------------------
// Result helpers.
// ---------------------------------------------------------------------------

function zeroDeltas(): ElementBindingDeltas {
  return {
    deletedDerivedExposures: 0,
    instantiatedDerivedExposures: 0,
    preservedCustomExposures: 0,
    deletedDerivedCountermeasures: 0,
    instantiatedDerivedCountermeasures: 0,
    preservedCustomCountermeasures: 0,
  };
}

function bindingFromInput(
  input: ElementBindingInput,
): ChangeElementBindingResult['targetBinding'] {
  if (input.kind === 'CLASS') {
    return { __typename: 'ClassBinding', classIds: input.classIds ?? [] };
  }
  if (input.kind === 'REPRESENTED_MODEL') {
    return { __typename: 'RepresentedModelBinding', modelId: input.modelId! };
  }
  return { __typename: 'NoBinding', _empty: null };
}

function failure(
  elementId: string,
  input: ElementBindingInput,
  errorCode: ElementBindingErrorCode,
  errorMessage: string,
): ChangeElementBindingResult {
  return {
    success: false,
    elementId,
    targetBinding: bindingFromInput(input),
    deltas: zeroDeltas(),
    errorCode,
    errorMessage,
  };
}

// ---------------------------------------------------------------------------
// Service.
// ---------------------------------------------------------------------------

@Injectable()
export class ElementBindingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ElementBindingService.name);

  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
    private readonly configService: ConfigService,
    private readonly moduleRegistry: ModuleRegistryService,
    private readonly authService: AuthorizationService,
    private readonly setInstantiation: SetInstantiationAttributesService,
  ) {}

  onModuleInit(): void {
    this.logger.log('ElementBindingService initialised');
  }

  onModuleDestroy(): void {
    this.logger.log('ElementBindingService destroyed');
  }

  // -------------------------------------------------------------------------
  // Public entry — invoked by the resolver factory.
  // -------------------------------------------------------------------------

  async changeElementBinding(
    args: { elementId: string; target: ElementBindingInput },
    graphqlContext: any,
  ): Promise<ChangeElementBindingResult> {
    const operationId = randomUUID();
    const startedAt = Date.now();
    const { elementId, target } = args;

    // Actor derivation: `context.user.sub` is the JWT subject claim per
    // RFC 7519. The `@authentication` directive on the mutation
    // populates this; if absent in production it indicates a
    // misconfigured auth chain.
    // Throwing here is the preferred response — a structured log
    // attributed to no one is worse than no entry — but we round-trip
    // it through the resolver envelope as VALIDATION_ERROR so callers
    // see a consistent failure shape rather than an opaque server
    // error. Either way the graph stays unchanged.
    const actor: string | null = graphqlContext?.user?.sub ?? null;
    if (!actor) {
      const msg = 'Missing actor (context.user.sub absent)';
      this.logFailure(
        operationId,
        null,
        elementId,
        target,
        msg,
        'VALIDATION_ERROR',
        startedAt,
      );
      return failure(elementId, target, 'VALIDATION_ERROR', msg);
    }

    // Step 0 — input shape validation (no DB touch).
    const inputErr = this.validateInputShape(target);
    if (inputErr) {
      this.logFailure(
        operationId,
        actor,
        elementId,
        target,
        inputErr,
        'VALIDATION_ERROR',
        startedAt,
      );
      return failure(elementId, target, 'VALIDATION_ERROR', inputErr);
    }

    const session: DatabaseSession = this.neo4jDriver.session({
      database: this.configService.get('database.name'),
    });

    try {
      // Step 1 — preflight: element labels + current binding + type-level
      // validation. Uses executeRead; not the authoritative read for the
      // identity check (that happens inside the write tx to close TOCTOU).
      const preflight = await this.readCurrentBindingPreflight(session, elementId);
      if (!preflight) {
        const msg = 'Element not found';
        this.logFailure(
          operationId,
          actor,
          elementId,
          target,
          msg,
          'ELEMENT_NOT_FOUND',
          startedAt,
        );
        return failure(elementId, target, 'ELEMENT_NOT_FOUND', msg);
      }

      const elementType = preflight.elementType;
      const classLabel = classLabelForElementType(elementType);
      if (!classLabel) {
        const msg = `Element type ${elementType} does not support class binding`;
        this.logFailure(
          operationId,
          actor,
          elementId,
          target,
          msg,
          'VALIDATION_ERROR',
          startedAt,
        );
        return failure(elementId, target, 'VALIDATION_ERROR', msg);
      }

      // Step 2 — type-level validation against target.kind.
      const typeErr = this.validateTargetForElementType(elementType, target);
      if (typeErr) {
        this.logFailure(
          operationId,
          actor,
          elementId,
          target,
          typeErr.message,
          typeErr.code,
          startedAt,
        );
        return failure(elementId, target, typeErr.code, typeErr.message);
      }

      const isControl = CONTROL_TYPES.has(elementType);
      const targetClassIds = target.kind === 'CLASS' ? target.classIds! : [];

      // Step 2.5 — preflight identity short-circuit (I8). The in-tx
      // identity check below is the TOCTOU-safe authoritative gate; this
      // preflight short-circuit honours I8's "does not invoke the module"
      // requirement by exiting BEFORE the module calls at step 3.
      const preflightCurrent = {
        currentClassIds: preflight.currentClassIds,
        currentModelId: preflight.currentModelId,
      };
      if (this.isIdentityTransition(preflightCurrent, target, isControl)) {
        const durationMs = Date.now() - startedAt;
        const oldBinding = this.describeBindingForLog(preflightCurrent);
        this.logger.log('Element binding unchanged (identity short-circuit)', {
          operationId,
          actor,
          elementId,
          elementType,
          oldBinding,
          newBinding: oldBinding,
          deltas: zeroDeltas(),
          identityShortCircuit: true,
          durationMs,
        });
        return {
          success: true,
          elementId,
          targetBinding: bindingFromInput(target),
          deltas: zeroDeltas(),
          errorCode: null,
          errorMessage: null,
        };
      }

      // Step 3 — for CLASS targets, look up each class's module name and
      // refuse orphans. Module SDK calls happen here, BEFORE executeWrite,
      // so a module failure leaves the graph untouched (invariant I7).
      const moduleDataByClass = new Map<
        string,
        { moduleName: string; findings: any[] }
      >();

      for (const classId of targetClassIds) {
        // Single round-trip: class existence + module name. Distinguishes
        // CLASS_NOT_FOUND (klass absent) from ORPHAN_CLASS_REFUSED (klass
        // present but reached only via HAS_ORPHANED_CLASS).
        const status = await this.lookupClassStatus(session, classId);
        if (!status.exists) {
          const msg = `Class ${classId} not found`;
          this.logFailure(
            operationId,
            actor,
            elementId,
            target,
            msg,
            'CLASS_NOT_FOUND',
            startedAt,
          );
          return failure(elementId, target, 'CLASS_NOT_FOUND', msg);
        }
        // Wrong-kind refusal — must precede the module calls and the write
        // tx. Without it, the rewire's final MATCH on the expected label
        // yields zero rows AFTER the destructive sweep and DELETE oldRel
        // have already run: element left unbound, derived findings
        // destroyed, mutation reporting success.
        if (!status.labels.includes(classLabel)) {
          const msg = `Class ${classId} is not a ${classLabel} — element type ${elementType} cannot bind to it`;
          this.logFailure(
            operationId,
            actor,
            elementId,
            target,
            msg,
            'VALIDATION_ERROR',
            startedAt,
          );
          return failure(elementId, target, 'VALIDATION_ERROR', msg);
        }
        if (!status.moduleName) {
          const msg = `Class ${classId} is orphaned (HAS_ORPHANED_CLASS)`;
          this.logFailure(
            operationId,
            actor,
            elementId,
            target,
            msg,
            'ORPHAN_CLASS_REFUSED',
            startedAt,
          );
          return failure(elementId, target, 'ORPHAN_CLASS_REFUSED', msg);
        }
        const moduleName = status.moduleName;

        const moduleInstance = this.moduleRegistry.getModuleByName(moduleName);
        if (!moduleInstance) {
          const msg = `Module ${moduleName} not registered`;
          this.logFailure(
            operationId,
            actor,
            elementId,
            target,
            msg,
            'MODULE_ERROR',
            startedAt,
          );
          return failure(elementId, target, 'MODULE_ERROR', msg);
        }

        try {
          const findings = isControl
            ? await moduleInstance.getCountermeasures(elementId, classId, graphqlContext?.token)
            : await moduleInstance.getExposures(elementId, classId, graphqlContext?.token);
          if (findings === undefined || findings === null) {
            const msg = `Module ${moduleName} returned no findings for class ${classId}`;
            this.logFailure(
              operationId,
              actor,
              elementId,
              target,
              msg,
              'MODULE_ERROR',
              startedAt,
            );
            return failure(elementId, target, 'MODULE_ERROR', msg);
          }
          moduleDataByClass.set(classId, { moduleName, findings });
        } catch (err) {
          const msg = `Module ${moduleName} threw: ${safeErrorMessage(err)}`;
          this.logFailure(
            operationId,
            actor,
            elementId,
            target,
            msg,
            'MODULE_ERROR',
            startedAt,
          );
          return failure(elementId, target, 'MODULE_ERROR', msg);
        }
      }

      // Step 4 — for REPRESENTED_MODEL, verify the model exists. Cheaper to
      // do here than to find out post-rewire that the MATCH found zero rows.
      if (target.kind === 'REPRESENTED_MODEL') {
        const modelExists = await this.modelExists(session, target.modelId!);
        if (!modelExists) {
          const msg = `Model ${target.modelId} not found`;
          this.logFailure(
            operationId,
            actor,
            elementId,
            target,
            msg,
            'MODEL_NOT_FOUND',
            startedAt,
          );
          return failure(elementId, target, 'MODEL_NOT_FOUND', msg);
        }
      }

      // Step 5 — single executeWrite. Read inside tx is authoritative; if
      // anything throws, the transaction rolls back and the graph is
      // unchanged.
      const deltas = zeroDeltas();
      let oldBinding:
        | { kind: ElementBindingKind; classIds?: string[]; modelId?: string }
        | null = null;
      let identityShortCircuit = false;

      try {
        await session.executeWrite(async (tx: DatabaseTransaction) => {
          // 5a — authoritative current-binding read.
          const current = await this.readCurrentBindingInTx(tx, elementId);
          oldBinding = this.describeBindingForLog(current);

          // 5b — identity-transition check.
          if (this.isIdentityTransition(current, target, isControl)) {
            identityShortCircuit = true;
            return;
          }

          // 5c — destructive sweep. For Controls, diff-based on the
          // removed classes; for single-class types, scoped on the
          // pre-existing class id (or null if none).
          if (isControl) {
            const removedClassIds = current.currentClassIds.filter(
              (id) => !targetClassIds.includes(id),
            );
            const deletedNames = await this.deleteDerivedCountermeasuresControls(
              tx,
              elementId,
              removedClassIds,
            );
            deltas.deletedDerivedCountermeasures = deletedNames.length;
          } else {
            const targetClassId =
              target.kind === 'CLASS' ? targetClassIds[0] ?? null : null;
            const deletedNames = await this.deleteDerivedExposuresSingleClass(
              tx,
              elementId,
              targetClassId,
            );
            deltas.deletedDerivedExposures = deletedNames.length;
          }

          // 5d — rewire edges.
          if (isControl) {
            const removedClassIds = current.currentClassIds.filter(
              (id) => !targetClassIds.includes(id),
            );
            const addedClassIds = targetClassIds.filter(
              (id) => !current.currentClassIds.includes(id),
            );
            await this.rewireControlClasses(
              tx,
              elementId,
              removedClassIds,
              addedClassIds,
            );
          } else {
            if (target.kind === 'CLASS') {
              await this.rewireToClassSingle(
                tx,
                elementId,
                classLabel,
                targetClassIds[0],
              );
            } else if (target.kind === 'REPRESENTED_MODEL') {
              await this.rewireToRepresentedModel(
                tx,
                elementId,
                classLabel,
                target.modelId!,
              );
            } else {
              await this.rewireToNone(tx, elementId, classLabel);
            }
          }

          // 5e — constructive upsert via SetInstantiationAttributesService's
          // tx-bound helpers, one class at a time, with per-class module
          // findings pre-fetched at step 3.
          for (const [classId, { findings }] of moduleDataByClass) {
            if (isControl) {
              const upsertReq: UpsertCountermeasuresRequest = {
                componentId: elementId,
                countermeasures: findings,
                classId,
              };
              const names = await this.setInstantiation.upsertCountermeasuresInTx(
                tx,
                upsertReq,
              );
              deltas.instantiatedDerivedCountermeasures += names.length;
            } else {
              const upsertReq: UpsertExposuresRequest = {
                componentId: elementId,
                exposures: findings,
                classId,
              };
              const names = await this.setInstantiation.upsertExposuresInTx(
                tx,
                upsertReq,
              );
              deltas.instantiatedDerivedExposures += names.length;
            }
          }

          // 5f — preserved-custom counts. USER-authored findings linked to
          // this element via HAS_EXPOSURE / HAS_COUNTERMEASURE but NOT to
          // any *Class via IS_EXPOSURE_OF / IS_COUNTERMEASURE_OF. These
          // survive every transition (I2).
          const preserved = await this.countPreservedCustomFindings(tx, elementId);
          deltas.preservedCustomExposures = preserved.exposures;
          deltas.preservedCustomCountermeasures = preserved.countermeasures;
        });
      } catch (err) {
        const msg = `Database error: ${safeErrorMessage(err)}`;
        this.logFailure(
          operationId,
          actor,
          elementId,
          target,
          msg,
          'DATABASE_ERROR',
          startedAt,
        );
        return failure(elementId, target, 'DATABASE_ERROR', msg);
      }

      // Step 6 — success log + envelope.
      const durationMs = Date.now() - startedAt;
      const newBinding = this.describeBindingForLogFromInput(target);
      this.logger.log('Element binding changed', {
        operationId,
        actor,
        elementId,
        elementType,
        oldBinding,
        newBinding,
        deltas,
        identityShortCircuit,
        durationMs,
      });

      return {
        success: true,
        elementId,
        targetBinding: bindingFromInput(target),
        deltas: identityShortCircuit ? zeroDeltas() : deltas,
        errorCode: null,
        errorMessage: null,
      };
    } finally {
      await session.close();
    }
  }

  // -------------------------------------------------------------------------
  // Validation helpers.
  // -------------------------------------------------------------------------

  private validateInputShape(input: ElementBindingInput): string | null {
    if (!input || typeof input.kind !== 'string') {
      return 'target.kind is required';
    }
    if (input.kind === 'CLASS') {
      if (!Array.isArray(input.classIds) || input.classIds.length === 0) {
        return 'target.classIds must be a non-empty array when kind = CLASS';
      }
      // Tighten: reject null/non-string/empty elements upfront rather than
      // letting them surface as downstream CLASS_NOT_FOUND.
      const bad = input.classIds.findIndex(
        (id) => typeof id !== 'string' || id.length === 0,
      );
      if (bad !== -1) {
        return `target.classIds[${bad}] must be a non-empty string`;
      }
      if (input.modelId) {
        return 'target.modelId must be null when kind = CLASS';
      }
    } else if (input.kind === 'REPRESENTED_MODEL') {
      if (!input.modelId || typeof input.modelId !== 'string') {
        return 'target.modelId is required when kind = REPRESENTED_MODEL';
      }
      if (input.classIds && input.classIds.length > 0) {
        return 'target.classIds must be null/empty when kind = REPRESENTED_MODEL';
      }
    } else if (input.kind === 'NONE') {
      if (
        (input.classIds && input.classIds.length > 0) ||
        input.modelId
      ) {
        return 'target.classIds and target.modelId must both be null when kind = NONE';
      }
    } else {
      return `unknown kind: ${input.kind}`;
    }
    return null;
  }

  private validateTargetForElementType(
    elementType: string,
    input: ElementBindingInput,
  ): { code: ElementBindingErrorCode; message: string } | null {
    if (
      input.kind === 'REPRESENTED_MODEL' &&
      !REPRESENTED_MODEL_ELIGIBLE.has(elementType)
    ) {
      return {
        code: 'REPRESENTED_MODEL_NOT_ALLOWED',
        message: `Element type ${elementType} does not support representedModel binding`,
      };
    }
    if (
      input.kind === 'CLASS' &&
      !CONTROL_TYPES.has(elementType) &&
      (input.classIds?.length ?? 0) !== 1
    ) {
      return {
        code: 'VALIDATION_ERROR',
        message: `Element type ${elementType} requires exactly one classId`,
      };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Identity-transition check.
  // -------------------------------------------------------------------------

  private isIdentityTransition(
    current: { currentClassIds: string[]; currentModelId: string | null },
    target: ElementBindingInput,
    isControl: boolean,
  ): boolean {
    if (target.kind === 'NONE') {
      return current.currentClassIds.length === 0 && current.currentModelId === null;
    }
    if (target.kind === 'REPRESENTED_MODEL') {
      return (
        current.currentClassIds.length === 0 &&
        current.currentModelId === target.modelId
      );
    }
    // target.kind === 'CLASS'
    const targetIds = [...(target.classIds ?? [])].sort();
    const currentIds = [...current.currentClassIds].sort();
    if (current.currentModelId !== null) return false;
    if (targetIds.length !== currentIds.length) return false;
    if (isControl) {
      for (let i = 0; i < targetIds.length; i++) {
        if (targetIds[i] !== currentIds[i]) return false;
      }
      return true;
    }
    // Single-class types: targetIds.length === currentIds.length === 1.
    return targetIds[0] === currentIds[0];
  }

  // -------------------------------------------------------------------------
  // Current-binding reads (preflight + in-tx).
  // -------------------------------------------------------------------------

  private async readCurrentBindingPreflight(
    session: DatabaseSession,
    elementId: string,
  ): Promise<{
    elementType: string;
    currentClassIds: string[];
    currentModelId: string | null;
  } | null> {
    return session.executeRead(async (tx) => {
      const result = await tx.run(
        `
        MATCH (c {id: $elementId})
        OPTIONAL MATCH (c)-[:IS_INSTANCE_OF]->(klass)
          WHERE any(l IN labels(klass) WHERE l ENDS WITH 'Class')
        OPTIONAL MATCH (c)-[:REPRESENTS_MODEL]->(m:Model)
        RETURN
          labels(c) AS labels,
          collect(DISTINCT klass.id) AS currentClassIds,
          m.id AS currentModelId
        `,
        { elementId },
      );
      if (result.records.length === 0) return null;
      const rec = result.records[0];
      const labels = (rec.get('labels') as string[]) ?? [];
      const elementType = labels.find((l) => ELEMENT_TYPE_KEYS.has(l));
      if (!elementType) return null;
      const currentClassIds = (rec.get('currentClassIds') as string[]) ?? [];
      const currentModelId = (rec.get('currentModelId') as string | null) ?? null;
      return { elementType, currentClassIds, currentModelId };
    });
  }

  private async readCurrentBindingInTx(
    tx: DatabaseTransaction,
    elementId: string,
  ): Promise<{ currentClassIds: string[]; currentModelId: string | null }> {
    const result = await tx.run(
      `
      MATCH (c {id: $elementId})
      OPTIONAL MATCH (c)-[:IS_INSTANCE_OF]->(klass)
        WHERE any(l IN labels(klass) WHERE l ENDS WITH 'Class')
      OPTIONAL MATCH (c)-[:REPRESENTS_MODEL]->(m:Model)
      RETURN
        collect(DISTINCT klass.id) AS currentClassIds,
        m.id AS currentModelId
      `,
      { elementId },
    );
    const rec = result.records[0];
    return {
      currentClassIds: (rec?.get('currentClassIds') as string[]) ?? [],
      currentModelId: (rec?.get('currentModelId') as string | null) ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // Single-roundtrip class-status lookup. Returns `exists`, the target's
  // labels (for the wrong-kind refusal), and the module name (or null when
  // reached only via HAS_ORPHANED_CLASS).
  //
  // Distinguishes:
  //   - { exists: false, moduleName: null }  → CLASS_NOT_FOUND
  //   - { exists: true,  labels w/o kind }   → VALIDATION_ERROR (wrong kind)
  //   - { exists: true,  moduleName: null }  → ORPHAN_CLASS_REFUSED
  //   - { exists: true,  moduleName: 'X' }   → OK
  //
  // Replaces the original two-query pattern (lookupModuleNameForClass +
  // classExists) — halves the DB roundtrips for multi-class Control
  // transitions.
  // -------------------------------------------------------------------------

  private async lookupClassStatus(
    session: DatabaseSession,
    classId: string,
  ): Promise<{ exists: boolean; moduleName: string | null; labels: string[] }> {
    return session.executeRead(async (tx) => {
      const result = await tx.run(
        `
        OPTIONAL MATCH (klass {id: $classId})
          WHERE any(l IN labels(klass) WHERE l ENDS WITH 'Class')
        OPTIONAL MATCH (klass)<-[:HAS_CLASS]-(m:Module)
        RETURN klass IS NOT NULL AS exists, m.name AS moduleName,
               CASE WHEN klass IS NULL THEN [] ELSE labels(klass) END AS klassLabels
        `,
        { classId },
      );
      const rec = result.records[0];
      const exists = (rec?.get('exists') as boolean) ?? false;
      const moduleName = (rec?.get('moduleName') as string | null) ?? null;
      const labels = (rec?.get('klassLabels') as string[]) ?? [];
      return { exists, moduleName, labels };
    });
  }

  private async modelExists(
    session: DatabaseSession,
    modelId: string,
  ): Promise<boolean> {
    return session.executeRead(async (tx) => {
      const result = await tx.run(
        `MATCH (m:Model {id: $modelId}) RETURN COUNT(m) AS cnt`,
        { modelId },
      );
      const cnt = result.records[0]?.get('cnt');
      const n = typeof cnt?.toNumber === 'function' ? cnt.toNumber() : Number(cnt);
      return n > 0;
    });
  }

  // -------------------------------------------------------------------------
  // Destructive sweep for single-class types (exposures).
  // -------------------------------------------------------------------------

  private async deleteDerivedExposuresSingleClass(
    tx: DatabaseTransaction,
    elementId: string,
    targetClassId: string | null,
  ): Promise<string[]> {
    const result = await tx.run(
      `
      MATCH (c {id: $elementId})-[:HAS_EXPOSURE]->(e:Exposure)-[:IS_EXPOSURE_OF]->(klass)
      WHERE any(l IN labels(klass) WHERE l ENDS WITH 'Class')
        AND (
          $targetClassId IS NULL
          OR klass.id <> $targetClassId
          OR NOT (c)-[:IS_INSTANCE_OF]->(klass)
        )
        AND (e.createdBy = 'SYSTEM' OR e.createdBy IS NULL)
      WITH DISTINCT e
      WITH collect(e.name) AS deletedNames, collect(e) AS toDelete
      FOREACH (n IN toDelete | DETACH DELETE n)
      RETURN deletedNames
      `,
      { elementId, targetClassId },
    );
    const names = (result.records[0]?.get('deletedNames') as string[]) ?? [];
    return names.filter((n) => n != null);
  }

  // -------------------------------------------------------------------------
  // Destructive sweep for Controls (N-N countermeasures, diff-based).
  // -------------------------------------------------------------------------

  private async deleteDerivedCountermeasuresControls(
    tx: DatabaseTransaction,
    elementId: string,
    removedClassIds: string[],
  ): Promise<string[]> {
    const result = await tx.run(
      `
      MATCH (c {id: $elementId})-[:HAS_COUNTERMEASURE]->(cm:Countermeasure)-[:IS_COUNTERMEASURE_OF]->(klass:ControlClass)
      WHERE (
          klass.id IN $removedClassIds
          OR NOT (c)-[:IS_INSTANCE_OF]->(klass)
        )
        AND (cm.createdBy = 'SYSTEM' OR cm.createdBy IS NULL)
      WITH DISTINCT cm
      WITH collect(cm.name) AS deletedNames, collect(cm) AS toDelete
      FOREACH (n IN toDelete | DETACH DELETE n)
      RETURN deletedNames
      `,
      { elementId, removedClassIds },
    );
    const names = (result.records[0]?.get('deletedNames') as string[]) ?? [];
    return names.filter((n) => n != null);
  }

  // -------------------------------------------------------------------------
  // Single-class rewire (branches A/B/C). Class label is interpolated
  // from a closed allowlist at query-build time (no user input).
  // -------------------------------------------------------------------------

  private assertClassLabel(classLabel: string): void {
    // Defence-in-depth: this should never fire because callers source the
    // label from ELEMENT_TYPE_TO_CLASS_LABEL via classLabelForElementType.
    const allowed = new Set(Object.values(ELEMENT_TYPE_TO_CLASS_LABEL));
    if (!allowed.has(classLabel)) {
      throw new Error(`Disallowed class label: ${classLabel}`);
    }
  }

  // Converts a driver count value (neo4j Integer or plain number) to a JS
  // number for the rewire row-count guards.
  private static toCount(val: any): number {
    return typeof val?.toNumber === 'function' ? val.toNumber() : Number(val ?? 0);
  }

  // Branch A — target.kind = CLASS (single-class types).
  private async rewireToClassSingle(
    tx: DatabaseTransaction,
    elementId: string,
    classLabel: string,
    targetClassId: string,
  ): Promise<void> {
    this.assertClassLabel(classLabel);
    // The deletes above the final MATCH persist even when that MATCH binds
    // zero rows (wrong-kind or vanished target), so the RETURN count proves
    // the MERGE actually ran; 0 throws → the enclosing executeWrite rolls
    // the whole transaction (sweep + deletes included) back.
    const result = await tx.run(
      `
      MATCH (c {id: $elementId})
      OPTIONAL MATCH (c)-[oldRel:IS_INSTANCE_OF]->(:${classLabel})
      DELETE oldRel
      WITH c
      OPTIONAL MATCH (c)-[oldModelRel:REPRESENTS_MODEL]->()
      DELETE oldModelRel
      WITH c
      MATCH (newKlass:${classLabel} {id: $targetClassId})
      MERGE (c)-[:IS_INSTANCE_OF]->(newKlass)
      RETURN count(newKlass) AS bound
      `,
      { elementId, targetClassId },
    );
    const bound = ElementBindingService.toCount(
      result.records[0]?.get('bound'),
    );
    if (bound === 0) {
      throw new Error(
        `Rebind matched 0 target rows for ${classLabel} ${targetClassId} — rolling back`,
      );
    }
  }

  // Branch B — target.kind = REPRESENTED_MODEL.
  private async rewireToRepresentedModel(
    tx: DatabaseTransaction,
    elementId: string,
    classLabel: string,
    targetModelId: string,
  ): Promise<void> {
    this.assertClassLabel(classLabel);
    // Same zero-row guard as rewireToClassSingle: the model was verified in
    // preflight, so 0 here means it vanished mid-flight (TOCTOU) — roll back
    // rather than leave the element unbound with its findings swept.
    const result = await tx.run(
      `
      MATCH (c {id: $elementId})
      OPTIONAL MATCH (c)-[oldRel:IS_INSTANCE_OF]->(:${classLabel})
      DELETE oldRel
      WITH c
      OPTIONAL MATCH (c)-[oldModelRel:REPRESENTS_MODEL]->()
      DELETE oldModelRel
      WITH c
      MATCH (m:Model {id: $targetModelId})
      MERGE (c)-[:REPRESENTS_MODEL]->(m)
      RETURN count(m) AS bound
      `,
      { elementId, targetModelId },
    );
    const bound = ElementBindingService.toCount(
      result.records[0]?.get('bound'),
    );
    if (bound === 0) {
      throw new Error(
        `Rebind matched 0 target rows for Model ${targetModelId} — rolling back`,
      );
    }
  }

  // Branch C — target.kind = NONE.
  private async rewireToNone(
    tx: DatabaseTransaction,
    elementId: string,
    classLabel: string,
  ): Promise<void> {
    this.assertClassLabel(classLabel);
    await tx.run(
      `
      MATCH (c {id: $elementId})
      OPTIONAL MATCH (c)-[oldRel:IS_INSTANCE_OF]->(:${classLabel})
      DELETE oldRel
      WITH c
      OPTIONAL MATCH (c)-[oldModelRel:REPRESENTS_MODEL]->()
      DELETE oldModelRel
      `,
      { elementId },
    );
  }

  // -------------------------------------------------------------------------
  // Controls rewire (two-statement form).
  // -------------------------------------------------------------------------

  private async rewireControlClasses(
    tx: DatabaseTransaction,
    elementId: string,
    removedClassIds: string[],
    addedClassIds: string[],
  ): Promise<void> {
    // Statement 1 — delete removed edges. Empty array yields no matches.
    await tx.run(
      `
      MATCH (c:Control {id: $elementId})-[r:IS_INSTANCE_OF]->(klass:ControlClass)
      WHERE klass.id IN $removedClassIds
      DELETE r
      `,
      { elementId, removedClassIds },
    );
    // Statement 2 — add new edges. UNWIND-empty cleanly skips the MATCH.
    // The count guard proves every added id matched a real ControlClass:
    // a wrong-kind or vanished id makes its MATCH bind nothing, silently
    // skipping the MERGE — count(DISTINCT klass) vs the deduplicated input
    // size catches that (and tolerates duplicate ids in the input).
    const result = await tx.run(
      `
      MATCH (c:Control {id: $elementId})
      UNWIND $addedClassIds AS aid
      MATCH (klass:ControlClass {id: aid})
      MERGE (c)-[:IS_INSTANCE_OF]->(klass)
      RETURN count(DISTINCT klass) AS bound
      `,
      { elementId, addedClassIds },
    );
    const expected = new Set(addedClassIds).size;
    const bound = ElementBindingService.toCount(
      result.records[0]?.get('bound'),
    );
    if (bound !== expected) {
      throw new Error(
        `Control rebind matched ${bound} of ${expected} added ControlClass ids — rolling back`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Preserved-custom counts for the deltas payload.
  // -------------------------------------------------------------------------

  private async countPreservedCustomFindings(
    tx: DatabaseTransaction,
    elementId: string,
  ): Promise<{ exposures: number; countermeasures: number }> {
    // Single-roundtrip count of both USER-authored exposures and
    // countermeasures. Replaces two sequential tx.run calls (one per
    // finding kind); same in-tx semantics, one fewer roundtrip on every
    // non-identity transition. The anchoring MATCH is load-bearing — by
    // the time this runs, the in-tx authoritative-read step has already
    // proven the element exists, so MATCH (not OPTIONAL MATCH) is
    // correct and keeps the result row count at exactly one. Both
    // OPTIONAL MATCHes return 0 from COUNT when no USER findings exist,
    // which is the same observable behaviour as the original pair.
    const result = await tx.run(
      `
      MATCH (c {id: $elementId})
      OPTIONAL MATCH (c)-[:HAS_EXPOSURE]->(e:Exposure)
        WHERE e.createdBy = 'USER'
      WITH c, COUNT(DISTINCT e) AS exposures
      OPTIONAL MATCH (c)-[:HAS_COUNTERMEASURE]->(cm:Countermeasure)
        WHERE cm.createdBy = 'USER'
      RETURN exposures, COUNT(DISTINCT cm) AS countermeasures
      `,
      { elementId },
    );
    const toInt = (val: any): number =>
      typeof val?.toNumber === 'function' ? val.toNumber() : Number(val ?? 0);
    const row = result.records[0];
    return {
      exposures: toInt(row?.get('exposures')),
      countermeasures: toInt(row?.get('countermeasures')),
    };
  }

  // -------------------------------------------------------------------------
  // Logging helpers.
  // -------------------------------------------------------------------------

  private describeBindingForLog(current: {
    currentClassIds: string[];
    currentModelId: string | null;
  }): { kind: ElementBindingKind; classIds?: string[]; modelId?: string } {
    if (current.currentClassIds.length > 0) {
      return { kind: 'CLASS', classIds: current.currentClassIds };
    }
    if (current.currentModelId) {
      return { kind: 'REPRESENTED_MODEL', modelId: current.currentModelId };
    }
    return { kind: 'NONE' };
  }

  private describeBindingForLogFromInput(input: ElementBindingInput): {
    kind: ElementBindingKind;
    classIds?: string[];
    modelId?: string;
  } {
    if (input.kind === 'CLASS') return { kind: 'CLASS', classIds: input.classIds! };
    if (input.kind === 'REPRESENTED_MODEL')
      return { kind: 'REPRESENTED_MODEL', modelId: input.modelId! };
    return { kind: 'NONE' };
  }

  private logFailure(
    operationId: string,
    actor: string | null,
    elementId: string,
    target: ElementBindingInput,
    errorMessage: string,
    errorCode: ElementBindingErrorCode,
    startedAt: number,
  ): void {
    this.logger.error('Element binding change failed', {
      operationId,
      actor,
      elementId,
      target,
      errorCode,
      errorMessage,
      durationMs: Date.now() - startedAt,
    });
  }

  // -------------------------------------------------------------------------
  // Resolver registration (consumed by the RESOLVER_SERVICES factory).
  // -------------------------------------------------------------------------

  getResolvers() {
    return {
      ElementBinding: {
        __resolveType(obj: any) {
          return obj?.__typename ?? null;
        },
      },
      Mutation: {
        changeElementBinding: async (_parent: any, args: any, context: any) => {
          return this.changeElementBinding(args, context);
        },
      },
    };
  }
}
