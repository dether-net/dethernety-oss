import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { safeErrorMessage } from '../../common/utils/safe-error-message';
import { ModuleManagementService } from '../module-management-services/module-management.service';
import { DatabaseSession, DatabaseTransaction } from '../interfaces/set-instantiation-attributes.interface';
import { SetInstantiationAttributesService } from './set-instantiation-attributes.service';
import { POLICY_STAMPS_PROPERTY, POLICY_STAMP_SEPARATOR, policyStamp } from './shared/policy-stamp';

/** The class kinds whose instances carry findings derived from a policy. Issue and analysis classes have none. */
export const REEVALUATED_CLASS_LABELS: readonly string[] = [
  'ComponentClass',
  'DataFlowClass',
  'SecurityBoundaryClass',
  'ControlClass',
  'DataClass',
];

/** Bindings read per page of a sweep. */
export const REEVALUATION_PAGE_SIZE = 200;

/** How many ids a sweep's summary names for each count. */
const SAMPLE_SIZE = 3;

/**
 * The next page of bindings evaluated under an older policy than their class's current one, or never stamped, in a
 * fixed order after the cursor. A class with no `policyHash` has nothing to compare against and is left out: a remote
 * module's (its metadata carries none, and it evaluates only with a caller's token), or one whose policy failed to
 * register.
 */
export const STALE_BINDINGS_CYPHER = `
  MATCH (m:Module)-[:HAS_CLASS]->(t)
  WHERE t.policyHash IS NOT NULL AND any(l IN labels(t) WHERE l IN $classLabels)
  MATCH (e)-[:IS_INSTANCE_OF]->(t)
  WITH e, t
  WHERE NOT (t.id + $separator + t.policyHash) IN coalesce(e.${POLICY_STAMPS_PROPERTY}, [])
    AND (e.id > $afterElementId OR (e.id = $afterElementId AND t.id > $afterClassId))
  RETURN e.id AS elementId, t.id AS classId
  ORDER BY elementId, classId
  LIMIT ${REEVALUATION_PAGE_SIZE}
`;

/** The bindings a sweep cannot evaluate, because their class has no `policyHash`. */
export const UNHASHED_BINDINGS_CYPHER = `
  MATCH (m:Module)-[:HAS_CLASS]->(t)
  WHERE t.policyHash IS NULL AND any(l IN labels(t) WHERE l IN $classLabels)
  MATCH (e)-[:IS_INSTANCE_OF]->(t)
  RETURN count(e) AS bindings, collect(e.id)[0..${SAMPLE_SIZE}] AS sample
`;

/** One binding, re-read under the element's lock: still bound to an active class, and its stamp against that class. */
export const BINDING_STATE_CYPHER = `
  MATCH (e {id: $elementId})
  WITH e
  MATCH (e)-[:IS_INSTANCE_OF]->(t)
  WHERE t.id = $classId
  MATCH (t)<-[:HAS_CLASS]-(:Module)
  RETURN t.policyHash AS policyHash, coalesce(e.${POLICY_STAMPS_PROPERTY}, []) AS stamps
`;

type Outcome = 'reevaluated' | 'current' | 'unbound' | 'failed';

/** What one sweep did. */
export interface ReevaluationSummary {
  reevaluated: number;
  current: number;
  unbound: number;
  failed: number;
  failedSample: string[];
  /** Bindings to a class with no policy hash: a remote module's, or one whose policy failed to register. */
  skipped: number;
  skippedSample: string[];
}

const toNumber = (raw: any): number =>
  typeof raw === 'number' ? raw : typeof raw?.toNumber === 'function' ? raw.toNumber() : Number(raw ?? 0);

/**
 * Re-evaluates the elements whose class policy changed since their findings were derived.
 *
 * Every save stamps the binding it evaluated with the class's `policyHash` (see `policy-stamp.ts`). After a module
 * install that wrote at least one module, and once at start, a sweep finds the bindings whose stamp differs from their
 * class's hash, or that have none, and re-saves each with no attribute changes: the save's own path, under the
 * element's lock, with its own findings write, link reconcile and stale flags. A binding saved meanwhile is current
 * and skipped.
 *
 * One sweep runs at a time. A request while one runs is coalesced into a single further sweep after it, which picks up
 * whatever the newer install changed. An element that fails is retried once at the end of the sweep, then left with
 * its previous findings and stamp, so the next sweep tries it again; it never fails the install.
 */
@Injectable()
export class FindingReevaluationService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FindingReevaluationService.name);
  private running: Promise<void> | null = null;
  private again = false;
  private stopping = false;

  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
    private readonly configService: ConfigService,
    private readonly moduleManagement: ModuleManagementService,
    private readonly setInstantiation: SetInstantiationAttributesService,
  ) {}

  /**
   * After the start-up install (which runs in module init): listen for later installs, and sweep once in the
   * background for what the start-up install changed or an earlier run left behind.
   */
  onApplicationBootstrap(): void {
    this.moduleManagement.onModulesInstalled(() => {
      void this.request();
    });
    void this.request();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await this.running;
  }

  /**
   * Sweep now, or once more after the sweep that is running. Resolves when no sweep is left to run. Never rejects:
   * a sweep that fails is logged, and the next request tries again.
   */
  request(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.sweep();
        } while (this.again && !this.stopping);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async sweep(): Promise<void> {
    const startedAt = Date.now();
    const summary: ReevaluationSummary = {
      reevaluated: 0,
      current: 0,
      unbound: 0,
      failed: 0,
      failedSample: [],
      skipped: 0,
      skippedSample: [],
    };
    const session = this.neo4jDriver.session({ database: this.configService.get('database.name') }) as DatabaseSession;
    try {
      const unhashed = await session.executeRead((tx: DatabaseTransaction) =>
        tx.run(UNHASHED_BINDINGS_CYPHER, { classLabels: REEVALUATED_CLASS_LABELS }),
      );
      summary.skipped += toNumber(unhashed.records[0]?.get('bindings'));
      summary.skippedSample.push(...((unhashed.records[0]?.get('sample') as string[] | undefined) ?? []));

      const retry: Array<{ elementId: string; classId: string }> = [];
      let afterElementId = '';
      let afterClassId = '';
      while (!this.stopping) {
        const page = await session.executeRead((tx: DatabaseTransaction) =>
          tx.run(STALE_BINDINGS_CYPHER, {
            classLabels: REEVALUATED_CLASS_LABELS,
            separator: POLICY_STAMP_SEPARATOR,
            afterElementId,
            afterClassId,
          }),
        );
        if (page.records.length === 0) break;
        for (const record of page.records) {
          if (this.stopping) break;
          const elementId = record.get('elementId') as string;
          const classId = record.get('classId') as string;
          afterElementId = elementId;
          afterClassId = classId;
          const outcome = await this.reevaluate(elementId, classId);
          if (outcome === 'failed') retry.push({ elementId, classId });
          else summary[outcome]++;
          await yieldToEventLoop();
        }
      }

      for (const { elementId, classId } of retry) {
        if (this.stopping) break;
        const outcome = await this.reevaluate(elementId, classId);
        summary[outcome]++;
        if (outcome === 'failed' && summary.failedSample.length < SAMPLE_SIZE) summary.failedSample.push(elementId);
        await yieldToEventLoop();
      }
    } catch (error) {
      this.logger.error('Re-evaluation sweep failed; the next install or start tries again', {
        error: safeErrorMessage(error),
      });
    } finally {
      await session.close();
    }
    this.report(summary, Date.now() - startedAt);
  }

  /** One binding, under the element's lock, through the save's own path. */
  private reevaluate(elementId: string, classId: string): Promise<Outcome> {
    return this.setInstantiation.runExclusive(elementId, 'setAttributes', async (): Promise<Outcome> => {
      const session = this.neo4jDriver.session({ database: this.configService.get('database.name') }) as DatabaseSession;
      try {
        const state = await session.executeRead((tx: DatabaseTransaction) =>
          tx.run(BINDING_STATE_CYPHER, { elementId, classId }),
        );
        const record = state.records[0];
        if (!record) return 'unbound';
        const policyHash = record.get('policyHash');
        if (typeof policyHash !== 'string') return 'unbound';
        if ((record.get('stamps') as string[]).includes(policyStamp(classId, policyHash))) return 'current';
      } catch (error) {
        this.logger.debug('Could not read a binding to re-evaluate', { elementId, classId, error: safeErrorMessage(error) });
        return 'failed';
      } finally {
        await session.close();
      }
      // No attribute changes: the save evaluates the answers already on the binding.
      const result = await this.setInstantiation.setAttributes(
        { componentId: elementId, classId, attributes: {} },
        undefined,
        { quiet: true },
      );
      return result.success ? 'reevaluated' : 'failed';
    });
  }

  /** One line per sweep, and none when it found nothing to do. */
  private report(summary: ReevaluationSummary, durationMs: number): void {
    const { reevaluated, current, unbound, failed, skipped } = summary;
    if (reevaluated + current + unbound + failed + skipped === 0) return;
    const fields = { ...summary, durationMs };
    if (failed > 0) {
      this.logger.warn('Re-evaluated findings after a class policy change; some elements failed and keep their findings', fields);
    } else {
      this.logger.log('Re-evaluated findings after a class policy change', fields);
    }
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}
