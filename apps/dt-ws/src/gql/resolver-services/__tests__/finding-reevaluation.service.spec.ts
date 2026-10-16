import {
  BINDING_STATE_CYPHER,
  FindingReevaluationService,
  REEVALUATED_CLASS_LABELS,
  REEVALUATION_PAGE_SIZE,
  STALE_BINDINGS_CYPHER,
  UNHASHED_BINDINGS_CYPHER,
} from '../finding-reevaluation.service';
import { POLICY_STAMP_SEPARATOR, policyStamp } from '../shared/policy-stamp';

// A small in-memory graph of bindings behind the three statements the service runs. The Cypher's own semantics are
// pinned below and proven by the e2e suite; this spec proves the service's loop around them.

interface Binding {
  elementId: string;
  classId: string;
  policyHash: string | null;
  stamps: string[];
  bound: boolean;
}

const binding = (elementId: string, over: Partial<Binding> = {}): Binding => ({
  elementId,
  classId: 'cls',
  policyHash: 'h2',
  stamps: [policyStamp('cls', 'h1')],
  bound: true,
  ...over,
});

const record = (row: Record<string, unknown>) => ({ get: (k: string) => row[k] });

function makeHarness(bindings: Binding[]) {
  const stale = (b: Binding) => b.bound && b.policyHash !== null && !b.stamps.includes(policyStamp(b.classId, b.policyHash));
  const run = jest.fn(async (cypher: string, params: any) => {
    if (cypher === UNHASHED_BINDINGS_CYPHER) {
      const unhashed = bindings.filter(b => b.bound && b.policyHash === null);
      return { records: [record({ bindings: unhashed.length, sample: unhashed.slice(0, 3).map(b => b.elementId) })] };
    }
    if (cypher === STALE_BINDINGS_CYPHER) {
      const after = (b: Binding) =>
        b.elementId > params.afterElementId || (b.elementId === params.afterElementId && b.classId > params.afterClassId);
      const page = bindings
        .filter(b => stale(b) && after(b))
        .sort((a, b) => (a.elementId + a.classId < b.elementId + b.classId ? -1 : 1))
        .slice(0, REEVALUATION_PAGE_SIZE);
      return { records: page.map(b => record({ elementId: b.elementId, classId: b.classId })) };
    }
    if (cypher === BINDING_STATE_CYPHER) {
      const b = bindings.find(x => x.elementId === params.elementId && x.classId === params.classId && x.bound);
      return { records: b ? [record({ policyHash: b.policyHash, stamps: b.stamps })] : [] };
    }
    throw new Error(`unexpected statement: ${cypher}`);
  });
  const driver = {
    session: () => ({
      executeRead: async (cb: any) => cb({ run }),
      close: async () => {},
    }),
  };

  // A save that succeeds stamps the binding with its class's current hash, as setAttributes does.
  const saved: string[] = [];
  const setAttributes = jest.fn(async (request: any, _context?: any, _options?: any) => {
    saved.push(request.componentId);
    const b = bindings.find(x => x.elementId === request.componentId && x.classId === request.classId)!;
    if (b.policyHash) b.stamps = [policyStamp(b.classId, b.policyHash)];
    return { success: true } as any;
  });
  const locked: string[] = [];
  const runExclusive = jest.fn(async (elementId: string, _type: string, op: () => Promise<any>) => {
    locked.push(elementId);
    return op();
  });
  const listeners: Array<(names: string[]) => void> = [];
  const moduleManagement = { onModulesInstalled: jest.fn((l: (names: string[]) => void) => listeners.push(l)) };
  const service = new FindingReevaluationService(
    driver,
    { get: () => undefined } as any,
    moduleManagement as any,
    { setAttributes, runExclusive } as any,
  );
  const logger = (service as any).logger;
  const log = jest.spyOn(logger, 'log').mockImplementation(() => {});
  const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  const error = jest.spyOn(logger, 'error').mockImplementation(() => {});
  jest.spyOn(logger, 'debug').mockImplementation(() => {});
  return { service, run, setAttributes, runExclusive, saved, locked, listeners, moduleManagement, log, warn, error };
}

describe('FindingReevaluationService — a sweep', () => {
  it('re-saves each stale binding with no attribute changes, quietly, under its element lock', async () => {
    const h = makeHarness([binding('e1'), binding('e2')]);

    await h.service.request();

    expect(h.saved).toEqual(['e1', 'e2']);
    expect(h.setAttributes).toHaveBeenCalledWith({ componentId: 'e1', classId: 'cls', attributes: {} }, undefined, { quiet: true });
    expect(h.locked).toEqual(['e1', 'e2']);
    expect(h.runExclusive.mock.calls[0][1]).toBe('setAttributes');
    expect(h.log).toHaveBeenCalledTimes(1);
    expect(h.log.mock.calls[0][1]).toMatchObject({ reevaluated: 2, failed: 0 });
  });

  it('re-saves a binding never stamped', async () => {
    const h = makeHarness([binding('e1', { stamps: [] })]);

    await h.service.request();

    expect(h.saved).toEqual(['e1']);
  });

  it('leaves a binding whose stamp is current', async () => {
    const h = makeHarness([binding('e1', { stamps: [policyStamp('cls', 'h2')] })]);

    await h.service.request();

    expect(h.setAttributes).not.toHaveBeenCalled();
    expect(h.log).not.toHaveBeenCalled();
  });

  it('skips a binding saved between the page read and its lock', async () => {
    const h = makeHarness([binding('e1')]);
    const b = (h as any).service;
    h.runExclusive.mockImplementationOnce(async (_id: string, _t: string, op: () => Promise<any>) => {
      // A user save lands first and stamps the binding.
      h.run.mockImplementationOnce(async () => ({ records: [record({ policyHash: 'h2', stamps: [policyStamp('cls', 'h2')] })] }));
      return op();
    });

    await b.request();

    expect(h.setAttributes).not.toHaveBeenCalled();
    expect(h.log.mock.calls[0][1]).toMatchObject({ current: 1, reevaluated: 0 });
  });

  it('skips a binding removed between the page read and its lock', async () => {
    const h = makeHarness([binding('e1')]);
    h.runExclusive.mockImplementationOnce(async (_id: string, _t: string, op: () => Promise<any>) => {
      h.run.mockImplementationOnce(async () => ({ records: [] }));
      return op();
    });

    await h.service.request();

    expect(h.setAttributes).not.toHaveBeenCalled();
    expect(h.log.mock.calls[0][1]).toMatchObject({ unbound: 1 });
  });

  it('pages past the first page, and ends even when a save leaves its binding stale', async () => {
    const many = Array.from({ length: REEVALUATION_PAGE_SIZE * 2 + 50 }, (_, i) => binding(`e${String(i).padStart(4, '0')}`));
    const h = makeHarness(many);
    // The saves succeed but their stamps fail, so every binding stays stale: only the cursor ends the sweep.
    h.setAttributes.mockImplementation(async (request: any) => {
      h.saved.push(request.componentId);
      return { success: true } as any;
    });

    await h.service.request();

    expect(h.saved).toHaveLength(many.length);
    expect(new Set(h.saved).size).toBe(many.length);
  });

  it('carries on past a failing element, retries it once, and reports it in one line', async () => {
    const h = makeHarness([binding('e1'), binding('e2'), binding('e3')]);
    h.setAttributes.mockImplementation(async (request: any) => {
      h.saved.push(request.componentId);
      return { success: request.componentId !== 'e2' } as any;
    });

    await h.service.request();

    expect(h.saved).toEqual(['e1', 'e2', 'e3', 'e2']);
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn.mock.calls[0][1]).toMatchObject({ reevaluated: 2, failed: 1, failedSample: ['e2'] });
    expect(h.log).not.toHaveBeenCalled();
  });

  it('counts an element that succeeds on its retry as re-evaluated', async () => {
    const h = makeHarness([binding('e1')]);
    h.setAttributes.mockResolvedValueOnce({ success: false } as any);

    await h.service.request();

    expect(h.setAttributes).toHaveBeenCalledTimes(2);
    expect(h.warn).not.toHaveBeenCalled();
    expect(h.log.mock.calls[0][1]).toMatchObject({ reevaluated: 1, failed: 0 });
  });

  it('names at most three failing elements', async () => {
    const h = makeHarness(['a', 'b', 'c', 'd', 'e'].map(id => binding(id)));
    h.setAttributes.mockResolvedValue({ success: false } as any);

    await h.service.request();

    expect(h.warn.mock.calls[0][1]).toMatchObject({ failed: 5, failedSample: ['a', 'b', 'c'] });
  });

  it('counts the bindings of a class with no policy hash as skipped', async () => {
    const h = makeHarness([binding('e1', { policyHash: null })]);

    await h.service.request();

    expect(h.setAttributes).not.toHaveBeenCalled();
    expect(h.log.mock.calls[0][1]).toMatchObject({ skipped: 1, skippedSample: ['e1'] });
  });

  it('logs a failed read and resolves, so the next install or start tries again', async () => {
    const h = makeHarness([binding('e1')]);
    h.run.mockRejectedValueOnce(new Error('db down'));

    await expect(h.service.request()).resolves.toBeUndefined();

    expect(h.error).toHaveBeenCalledWith(expect.stringContaining('sweep failed'), { error: 'db down' });
    expect(h.setAttributes).not.toHaveBeenCalled();
  });
});

describe('FindingReevaluationService — one sweep at a time', () => {
  it('coalesces requests made during a sweep into one more sweep, never two at once', async () => {
    const h = makeHarness([binding('e1')]);
    let active = 0;
    let maxActive = 0;
    const sweep = jest.spyOn(h.service as any, 'sweep').mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setImmediate(resolve));
      active--;
    });

    const first = h.service.request();
    const second = h.service.request();
    const third = h.service.request();
    await Promise.all([first, second, third]);

    expect(sweep).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
    expect(second).toBe(first);
  });

  it('starts a new sweep for a request after the last one ended', async () => {
    const h = makeHarness([]);
    const sweep = jest.spyOn(h.service as any, 'sweep').mockResolvedValue(undefined);

    await h.service.request();
    await h.service.request();

    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it('a second install during a sweep re-evaluates what that install changed', async () => {
    const bindings = [binding('e1')];
    const h = makeHarness(bindings);
    h.setAttributes.mockImplementationOnce(async (request: any) => {
      h.saved.push(request.componentId);
      bindings[0].stamps = [policyStamp('cls', 'h2')];
      // The policy changes again while the sweep runs, and its install asks for another sweep.
      bindings[0].policyHash = 'h3';
      void h.service.request();
      return { success: true } as any;
    });

    await h.service.request();
    await h.service.request();

    expect(h.saved).toEqual(['e1', 'e1']);
    expect(bindings[0].stamps).toEqual([policyStamp('cls', 'h3')]);
  });
});

describe('FindingReevaluationService — lifecycle', () => {
  it('at bootstrap, listens for installs and sweeps once', async () => {
    const h = makeHarness([binding('e1')]);

    h.service.onApplicationBootstrap();
    await (h.service as any).running;

    expect(h.moduleManagement.onModulesInstalled).toHaveBeenCalledTimes(1);
    expect(h.saved).toEqual(['e1']);
  });

  it('sweeps when an install is reported', async () => {
    const bindings: Binding[] = [];
    const h = makeHarness(bindings);
    h.service.onApplicationBootstrap();
    await (h.service as any).running;

    bindings.push(binding('e1'));
    h.listeners[0](['m1']);
    await (h.service as any).running;

    expect(h.saved).toEqual(['e1']);
  });

  it('starts no sweep once shutting down', async () => {
    const h = makeHarness([binding('e1')]);
    await h.service.onModuleDestroy();

    await h.service.request();

    expect(h.run).not.toHaveBeenCalled();
  });

  it('stops between elements on shutdown, and waits for the element in hand', async () => {
    const h = makeHarness([binding('e1'), binding('e2'), binding('e3')]);
    h.setAttributes.mockImplementationOnce(async (request: any) => {
      h.saved.push(request.componentId);
      void h.service.onModuleDestroy();
      return { success: true } as any;
    });

    await h.service.request();

    expect(h.saved).toEqual(['e1']);
  });
});

describe('FindingReevaluationService — the statements', () => {
  it('re-evaluates the classes that derive findings, never issue or analysis classes', () => {
    expect([...REEVALUATED_CLASS_LABELS].sort()).toEqual(
      ['ComponentClass', 'ControlClass', 'DataClass', 'DataFlowClass', 'SecurityBoundaryClass'].sort(),
    );
  });

  it('selects only active classes with a hash, stale or unstamped bindings, after the cursor, in a fixed order', () => {
    const cypher = STALE_BINDINGS_CYPHER.replace(/\s+/g, ' ');
    expect(cypher).toContain('MATCH (m:Module)-[:HAS_CLASS]->(t)');
    expect(cypher).toContain('t.policyHash IS NOT NULL');
    expect(cypher).toContain('any(l IN labels(t) WHERE l IN $classLabels)');
    expect(cypher).toContain('MATCH (e)-[:IS_INSTANCE_OF]->(t)');
    expect(cypher).toContain('NOT (t.id + $separator + t.policyHash) IN coalesce(e.classPolicyStamps, [])');
    expect(cypher).toContain('(e.id > $afterElementId OR (e.id = $afterElementId AND t.id > $afterClassId))');
    expect(cypher).toContain('ORDER BY elementId, classId');
    expect(cypher).toContain(`LIMIT ${REEVALUATION_PAGE_SIZE}`);
  });

  it('re-reads a binding anchored at its element, over its own binding to an active class', () => {
    const cypher = BINDING_STATE_CYPHER.replace(/\s+/g, ' ');
    expect(cypher).toMatch(/^ MATCH \(e \{id: \$elementId\}\) WITH e MATCH \(e\)-\[:IS_INSTANCE_OF\]->\(t\) WHERE t\.id = \$classId MATCH \(t\)<-\[:HAS_CLASS\]-\(:Module\)/);
  });

  it('compares stamps with the separator the stamps are written with', async () => {
    const h = makeHarness([binding('e1')]);
    await h.service.request();
    const pageCall = h.run.mock.calls.find(([cypher]) => cypher === STALE_BINDINGS_CYPHER)!;
    expect(pageCall[1].separator).toBe(POLICY_STAMP_SEPARATOR);
    expect(policyStamp('c', 'h')).toBe(`c${POLICY_STAMP_SEPARATOR}h`);
  });
});
