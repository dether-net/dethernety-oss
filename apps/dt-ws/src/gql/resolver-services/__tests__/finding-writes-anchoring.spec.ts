import { Neo4jError } from 'neo4j-driver';
import { ConfigService } from '@nestjs/config';
import { SetInstantiationAttributesService } from '../set-instantiation-attributes.service';
import { ElementBindingService } from '../element-binding.service';
import { ModuleRegistryService } from '../../module-management-services/module-registry.service';
import { AuthorizationService } from '../../services/authorization.service';
import { MonitoringService } from '../../services/monitoring.service';

/**
 * Elements of one class are written concurrently (imports write attributes several at a time), and every one of
 * them hangs its findings off the same class node. On Memgraph, a statement that expands from that class node walks
 * its incoming edges, reaches findings other transactions are creating, and fails reading a vertex its snapshot does
 * not hold ("Trying to get a property from an object that doesn't exist"). So every statement that writes or sweeps
 * an element's findings starts from the element and expands outward, and checks the class by property on the far
 * side. These pins hold the statements to that shape; the behaviour under real concurrency is the
 * evaluate-unanswered e2e spec.
 *
 * A transient conflict raised inside those writes must reach the managed transaction, which retries it; a
 * non-transient error is handled as before.
 */

const toRecord = (row: Record<string, unknown>) => ({ get: (key: string) => row[key] });

function makeService(session: unknown = {}) {
  const service = new SetInstantiationAttributesService(
    { session: jest.fn(() => session) } as any,
    { get: jest.fn().mockReturnValue({}) } as unknown as ConfigService,
    { getModuleByName: jest.fn() } as unknown as ModuleRegistryService,
    { extractAuthContext: jest.fn() } as unknown as AuthorizationService,
    { recordOperation: jest.fn() } as unknown as MonitoringService,
  );
  for (const level of ['log', 'debug', 'warn', 'error'] as const) jest.spyOn((service as any).logger, level).mockImplementation(() => {});
  return service as any;
}

/** A transaction that answers the reference pre-pass (every reference found) and records every statement. */
function recordingTx() {
  const statements: string[] = [];
  const tx = {
    run: jest.fn(async (query: string) => {
      statements.push(query);
      if (query.includes('pairIndex')) return { records: [0, 1, 2, 3].map((i) => toRecord({ pairIndex: i, value: 'T1078', found: true })) };
      if (query.includes('instantiatedName')) return { records: [toRecord({ instantiatedName: 'X' })] };
      if (query.includes('relationshipsCreated')) return { records: [toRecord({ relationshipsCreated: { toNumber: () => 1 } })] };
      if (query.includes('deletedCount')) return { records: [toRecord({ deletedCount: { toNumber: () => 0 } })] };
      if (query.includes('deletedNames')) return { records: [toRecord({ deletedNames: [] })] };
      if (query.includes('valueChanged')) return { records: [toRecord({ moduleName: 'mod-1', type: 'Component', valueChanged: true, changedKeys: ['k'] })] };
      if (query.includes('staleFlippedCount')) return { records: [toRecord({ staleFlippedCount: 0 })] };
      if (query.includes('edgeExists')) return { records: [toRecord({ elementFound: true, classFound: true, elementLabels: ['Component'], classLabels: ['ComponentClass'], moduleName: 'mod-1', edgeExists: true })] };
      return { records: [] };
    }),
  };
  return { tx, statements };
}

/** Every statement the attribute write and the finding write paths run, in order. */
async function findingStatements(): Promise<string[]> {
  const { tx, statements } = recordingTx();
  const service = makeService({ executeWrite: async (work: (t: unknown) => Promise<unknown>) => work(tx), close: async () => {} });
  // The attribute write (its first statement, the stale flips), up to where it would call the module.
  await service.setAttributes({ componentId: 'el-1', classId: 'cls-1', attributes: { k: 'v' } }).catch(() => undefined);
  await service.diagnoseSetAttributesFailure(tx, 'el-1', 'cls-1');
  await service.upsertExposuresInTx(tx, { componentId: 'el-1', classId: 'cls-1', exposures: [{ name: 'X', exploitedBy: ['T1078'] }] });
  await service.upsertCountermeasuresInTx(tx, { componentId: 'el-1', classId: 'cls-1', countermeasures: [{ name: 'Y', respondsWith: ['M1026'] }] });
  await service.deleteObsoleteExternalObjects(tx, { elementId: 'el-1', relation: 'HAS_EXPOSURE', validNames: ['X'], classId: 'cls-1' });
  await service.deleteObsoleteExternalObjects(tx, { elementId: 'el-1', relation: 'HAS_COUNTERMEASURE', validNames: ['Y'], classId: 'cls-1' });
  const binding = ElementBindingService.prototype as any;
  await binding.deleteDerivedExposuresSingleClass.call({}, tx, 'el-1', 'cls-1');
  await binding.deleteDerivedCountermeasuresControls.call({}, tx, 'el-1', ['cls-1']);
  return statements;
}

const touchesClassEdge = (q: string) => /IS_EXPOSURE_OF|IS_COUNTERMEASURE_OF|IS_INSTANCE_OF/.test(q) || /\$classId/.test(q);
const ELEMENT_ANCHOR = /^\s*(OPTIONAL )?MATCH \(c \{id: \$\w+\}\)\s*WITH c\b/;

describe('finding writes start from the element', () => {
  it('anchors every statement that reaches a finding\'s class at the element, before any expansion', async () => {
    const statements = (await findingStatements()).filter(touchesClassEdge).filter((q) => !q.includes('pairIndex'));
    expect(statements.length).toBeGreaterThanOrEqual(9);
    for (const q of statements) expect([q.trim().split('\n')[0], ELEMENT_ANCHOR.test(q)]).toEqual([q.trim().split('\n')[0], true]);
  });

  it('reads a class\'s edges backwards only over HAS_CLASS, which only module installs write', async () => {
    for (const q of await findingStatements()) {
      const matches = q.split('\n').filter((l) => /^\s*(OPTIONAL )?MATCH\b/.test(l));
      for (const l of matches.filter((x) => /\)<-\[/.test(x))) expect(l).toMatch(/\)<-\[:HAS_CLASS\]-\(m:Module\)/);
    }
  });

  it('sweeps a finding only over its typed edge to the class, not every edge it has', async () => {
    const sweeps = (await findingStatements()).filter((q) => q.includes('deletedCount'));
    expect(sweeps).toHaveLength(2);
    for (const q of sweeps) expect(q).toContain('->(e)-[:IS_EXPOSURE_OF|IS_COUNTERMEASURE_OF]->(class)');
  });

  it('reads and prunes a finding\'s links only over the writer\'s own typed link edges', async () => {
    const statements = (await findingStatements()).filter((q) => q.includes('findingName') || q.includes('prunedCount'));
    expect(statements).toHaveLength(4);
    for (const q of statements) {
      expect(q).not.toMatch(/\(e\)-\[r\]->/);
      expect(q).toMatch(/\(e\)-\[r:(EXPLOITED_BY|RESPONDS_WITH\|COUNTERMEASURE_[A-Z_|]+)\]->\(t\)/);
    }
  });

  it('never expands into a class node bound by id, nor binds one inside a pattern with an edge', async () => {
    for (const q of await findingStatements()) {
      // Only what a MATCH walks matters; a CREATE writes an edge to the class without reading its edge list.
      const matches = q.split('\n').filter((l) => /^\s*(OPTIONAL )?MATCH\b/.test(l)).join('\n');
      expect(matches).not.toMatch(/-\[[^\]]*\]->\(\w+\s*\{id: \$classId\}\)/);
      expect(matches).not.toMatch(/MATCH \(c \{id: \$\w+\}\),\s*\(\w+ \{id: \$classId\}\)/);
      const boundById = [...matches.matchAll(/MATCH \((\w+) \{id: \$classId\}\)/g)].map((m) => m[1]);
      for (const v of boundById) expect(matches).not.toMatch(new RegExp(`\\]->\\(${v}\\)`));
    }
  });
});

describe('a transient conflict inside a finding write reaches the transaction retry', () => {
  const driverError = (message: string, code: string) => new Neo4jError(message, code, '50N42', 'error: general processing exception');
  const transient = () => driverError('Cannot resolve conflicting transactions.', 'Memgraph.TransientError.MemgraphError.MemgraphError');
  const nonTransient = () => driverError("Trying to get a property from an object that doesn't exist.", 'Memgraph.ClientError.MemgraphError.MemgraphError');

  /** A session whose executeWrite retries the work like the driver's managed transaction: retriable errors only, at most `attempts` times. */
  function retryingSession(attempts: number) {
    let calls = 0;
    const session = {
      executeWrite: async (work: (tx: unknown) => Promise<unknown>) => {
        let last: unknown;
        for (let i = 0; i < attempts; i++) {
          calls += 1;
          try {
            return await work(currentTx());
          } catch (e) {
            last = e;
            if (!(e as { retriable?: boolean }).retriable && !/TransientError/.test((e as { code?: string }).code ?? '')) throw e;
          }
        }
        throw last;
      },
    };
    let currentTx: () => unknown = () => ({});
    return { session, calls: () => calls, setTx: (f: () => unknown) => (currentTx = f) };
  }

  /** A transaction whose obsolete-findings sweep fails with `fail()` for the first `failures` attempts. */
  function sweepFailing(fail: () => Error, failures: number) {
    let attempt = 0;
    return () => {
      attempt += 1;
      const failing = attempt <= failures;
      return {
        run: jest.fn(async (query: string) => {
          if (query.includes('instantiatedName')) return { records: [toRecord({ instantiatedName: 'X' })] };
          if (query.includes('deletedCount')) {
            if (failing) throw fail();
            return { records: [toRecord({ deletedCount: { toNumber: () => 0 } })] };
          }
          return { records: [] };
        }),
      };
    };
  }

  const request = { componentId: 'el-1', classId: 'cls-1', exposures: [{ name: 'X' }] };

  it('the sweep rethrows a transient conflict instead of reporting it as a failed delete', async () => {
    const service = makeService();
    const tx = { run: jest.fn().mockRejectedValue(transient()) };
    await expect(service.deleteObsoleteExternalObjects(tx, { elementId: 'el-1', relation: 'HAS_EXPOSURE', validNames: [], classId: 'cls-1' })).rejects.toMatchObject({
      code: 'Memgraph.TransientError.MemgraphError.MemgraphError',
    });
  });

  it('the external link rethrows a transient conflict, and skips the link on any other error as before', async () => {
    const service = makeService();
    const link = (err: Error) =>
      service.linkToExternalObject(
        { run: jest.fn().mockRejectedValue(err) },
        { elementId: 'el-1', elementToOriginRelation: 'HAS_EXPOSURE', originName: 'X', relationName: 'EXPLOITED_BY', classId: 'cls-1', target: { label: 'MitreAttackTechnique', property: 'attack_id', value: 'T1078' } },
      );
    await expect(link(transient())).rejects.toMatchObject({ code: 'Memgraph.TransientError.MemgraphError.MemgraphError' });
    await expect(link(nonTransient())).resolves.toMatchObject({ success: false, recordsAffected: 0 });
  });

  it('a conflict that clears on retry leaves the write successful', async () => {
    const service = makeService();
    const s = retryingSession(3);
    s.setTx(sweepFailing(transient, 1));
    const result = await service.upsertExposures(s.session, request);
    expect(result).toMatchObject({ success: true, recordsAffected: 1 });
    expect(s.calls()).toBe(2);
  });

  it('when the retries run out the write fails as DATABASE_ERROR "Failed to upsert exposures: …", as before', async () => {
    const service = makeService();
    const s = retryingSession(3);
    s.setTx(sweepFailing(transient, 99));
    const module = { getExposures: async () => [{ name: 'X' }] };
    await expect(service.processComponentExposures(s.session, 'el-1', 'cls-1', module, 'op-1')).rejects.toMatchObject({
      type: 'DATABASE_ERROR',
      message: expect.stringMatching(/^Failed to upsert exposures: /),
      componentId: 'el-1',
      classId: 'cls-1',
    });
    expect(s.calls()).toBe(3);
  });

  it('logs each conflict at warn with its operation and code, and counts it', async () => {
    const service = makeService();
    const warn = (service as any).logger.warn as jest.Mock;
    const tx = { run: jest.fn().mockRejectedValue(transient()) };
    await expect(service.deleteObsoleteExternalObjects(tx, { elementId: 'el-1', relation: 'HAS_EXPOSURE', validNames: [], classId: 'cls-1' })).rejects.toBeDefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/transient conflict/i), expect.objectContaining({
      operation: 'deleteObsolete',
      operationId: expect.stringMatching(/^deleteObsolete-/),
      code: 'Memgraph.TransientError.MemgraphError.MemgraphError',
    }));
    expect(service.getStatistics().retriableConflicts).toBe(1);
    expect((service as any).monitoringService.recordOperation).toHaveBeenCalledWith(expect.objectContaining({ operationName: 'setInstantiation.retriableConflict' }));
  });

  it('a non-transient error is not retried and surfaces as before', async () => {
    const service = makeService();
    const s = retryingSession(3);
    s.setTx(sweepFailing(nonTransient, 99));
    const result = await service.upsertExposures(s.session, request);
    expect(s.calls()).toBe(1);
    expect(result).toMatchObject({ success: false, recordsAffected: 0 });
    // What the caller got for a failed sweep before: the write fails, with the service's generic message.
    expect(result.error).toBe('Operation failed');
  });
});
