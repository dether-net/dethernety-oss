import { ElementBindingService } from '../element-binding.service';
import { SetInstantiationAttributesService } from '../set-instantiation-attributes.service';

/**
 * Mutual exclusion on one element.
 *
 * The property under test is that a record in the concurrency map is removed by the operation that
 * created it and by nothing else. The map is plain JavaScript, so this is decidable here — no database,
 * and no fake timers either: the waiting caller polls on a real 100 ms interval, which fake timers fight
 * rather than help. `config.operationTimeout` is a plain mutable field, so the budget is made small
 * instead.
 *
 * Every exclusion case carries its opposite on a different element id. Without that control, a lock that
 * serialised *everything* would pass the exclusion assertions and be wrong.
 */

const deferred = () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
};

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeService() {
  const service = new SetInstantiationAttributesService(
    { session: jest.fn() } as any,
    { get: jest.fn().mockReturnValue({}) } as any,
    { getModuleByName: jest.fn() } as any,
    { extractAuthContext: jest.fn().mockReturnValue({ userId: 'u-1' }) } as any,
    { recordOperation: jest.fn() } as any,
  );
  // The lock is reached directly: its two callers are a GraphQL resolver and (from the next commit) a
  // second service, and neither is the subject here.
  const run = <T>(elementId: string, operation: () => Promise<T>): Promise<T> =>
    (service as any).runExclusive(elementId, 'setAttributes', operation);
  return { service, run };
}

describe('element lock — mutual exclusion', () => {
  it('holds the element against a second operation until the first ends', async () => {
    const { service, run } = makeService();
    const events: string[] = [];
    const gate = deferred();

    const first = run('el-1', async () => {
      events.push('a:start');
      await gate.held;
      events.push('a:end');
      return 'a';
    });
    const second = run('el-1', async () => {
      events.push('b:start');
      return 'b';
    });

    // Two poll intervals: long enough that a broken lock would have let the second through.
    await tick(250);
    expect(events).toEqual(['a:start']);

    gate.release();
    await expect(first).resolves.toBe('a');
    await expect(second).resolves.toBe('b');
    expect(events).toEqual(['a:start', 'a:end', 'b:start']);

    await service.onModuleDestroy();
  });

  it('does not hold a different element — the control', async () => {
    const { service, run } = makeService();
    const events: string[] = [];
    const gate = deferred();

    const first = run('el-1', async () => {
      events.push('a:start');
      await gate.held;
      events.push('a:end');
      return 'a';
    });
    const second = run('el-2', async () => {
      events.push('b:start');
      events.push('b:end');
      return 'b';
    });

    // Asserted on elapsed time rather than by awaiting the second, so that a lock which wrongly held
    // every element reports a failed expectation here instead of deadlocking the run.
    await tick(250);
    expect(events).toEqual(['a:start', 'b:start', 'b:end']);

    gate.release();
    await expect(first).resolves.toBe('a');
    await expect(second).resolves.toBe('b');
    await service.onModuleDestroy();
  });

  it('does not admit a second operation when the first outlives its timeout budget', async () => {
    const { service, run } = makeService();
    (service as any).config.operationTimeout = 20;
    const warn = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
    const events: string[] = [];

    const first = run('el-1', async () => {
      events.push('a:start');
      await tick(200);
      events.push('a:end');
      return 'a';
    });
    const second = run('el-1', async () => {
      events.push('b:start');
      return 'b';
    });

    await Promise.all([first, second]);

    // The budget must be PROVEN to have elapsed. Without this the assertion below would also pass on a
    // run where the timer never fired, which is the case it exists to cover.
    expect(warn).toHaveBeenCalledWith(
      'Operation still running past its timeout budget',
      expect.objectContaining({ componentId: 'el-1', type: 'setAttributes' }),
    );
    expect(events).toEqual(['a:start', 'a:end', 'b:start']);

    warn.mockRestore();
    await service.onModuleDestroy();
  });

  it('a finishing operation does not release a record it does not own', async () => {
    const { service, run } = makeService();
    const events: string[] = [];
    const gateA = deferred();
    const gateB = deferred();

    const first = run('el-1', async () => {
      events.push('a:start');
      await gateA.held;
      events.push('a:end');
      return 'a';
    });

    // Shutdown clears the map out from under a running operation. It is the one path that leaves the key
    // free while an earlier operation is still in flight, so it is how a release can find a record that
    // is not its own.
    await service.onModuleDestroy();

    const second = run('el-1', async () => {
      events.push('b:start');
      await gateB.held;
      events.push('b:end');
      return 'b';
    });
    expect(events).toEqual(['a:start', 'b:start']);

    gateA.release();
    await expect(first).resolves.toBe('a');

    // The second still holds the element: a third caller waits for it rather than being admitted by the
    // first's release.
    const third = run('el-1', async () => {
      events.push('c:start');
      return 'c';
    });
    await tick(250);
    expect(events).not.toContain('c:start');

    gateB.release();
    await expect(second).resolves.toBe('b');
    await expect(third).resolves.toBe('c');
    expect(events).toEqual(['a:start', 'b:start', 'a:end', 'b:end', 'c:start']);

    await service.onModuleDestroy();
  });
});

/**
 * The two mutations that write an element's derived findings, driven through their own entry points
 * against one real lock. `setAttributes` is stubbed and the binding call is left to fall out at
 * ELEMENT_NOT_FOUND: what is under test is not what either does, but when each was allowed to begin.
 */
function makeBoundPair() {
  const events: string[] = [];
  const gate = deferred();

  const attributes = new SetInstantiationAttributesService(
    { session: jest.fn() } as any,
    { get: jest.fn().mockReturnValue({}) } as any,
    { getModuleByName: jest.fn() } as any,
    { extractAuthContext: jest.fn().mockReturnValue({ userId: 'u-1' }) } as any,
    { recordOperation: jest.fn() } as any,
  );
  (attributes as any).config.batchEnabled = false;
  (attributes as any).setAttributes = async () => {
    events.push('attributes:start');
    await gate.held;
    events.push('attributes:end');
    return { success: true };
  };

  const bindingSession = {
    executeRead: jest.fn(async (work: any) => work({ run: async () => ({ records: [] }) })),
    close: jest.fn(async () => undefined),
  };
  const binding = new ElementBindingService(
    {
      session: jest.fn(() => {
        // The binding call's first act: opening its session. If the lock holds, this has not happened.
        events.push('binding:start');
        return bindingSession;
      }),
    } as any,
    { get: jest.fn(() => 'neo4j') } as any,
    { getModuleByName: jest.fn() } as any,
    {} as any,
    attributes,
  );

  const writeAttributes = (elementId: string) =>
    attributes.getResolvers().Mutation.setInstantiationAttributes(
      null,
      { componentId: elementId, classId: 'cls-1', attributes: {} },
      {},
    );
  const rebind = (elementId: string) =>
    binding.changeElementBinding(
      { elementId, target: { kind: 'NONE' } },
      { user: { sub: 'tester' } },
    );

  return { attributes, events, gate, writeAttributes, rebind };
}

describe('element lock — the two writers of an element share it', () => {
  it('excludes a class rebind from an attribute write on one element', async () => {
    const { attributes, events, gate, writeAttributes, rebind } = makeBoundPair();

    const write = writeAttributes('el-1');
    const bind = rebind('el-1');

    await tick(250);
    expect(events).toEqual(['attributes:start']);

    gate.release();
    const [written, bound] = await Promise.all([write, bind]);
    expect(written.success).toBe(true);
    expect(bound.errorCode).toBe('ELEMENT_NOT_FOUND');
    expect(events).toEqual(['attributes:start', 'attributes:end', 'binding:start']);

    await attributes.onModuleDestroy();
  });

  it('lets them run on different elements — the control', async () => {
    const { attributes, events, gate, writeAttributes, rebind } = makeBoundPair();

    const write = writeAttributes('el-1');
    const bind = rebind('el-2');

    await tick(250);
    expect(events).toEqual(['attributes:start', 'binding:start']);

    gate.release();
    await Promise.all([write, bind]);

    await attributes.onModuleDestroy();
  });
});
