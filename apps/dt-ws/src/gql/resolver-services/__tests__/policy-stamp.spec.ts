import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { SetInstantiationAttributesService } from '../set-instantiation-attributes.service';
import { ModuleRegistryService } from '../../module-management-services/module-registry.service';
import { AuthorizationService } from '../../services/authorization.service';
import { MonitoringService } from '../../services/monitoring.service';
import { NO_POLICY_HASH } from '@dethernety/dt-module';
import {
  POLICY_STAMPS_PROPERTY,
  POLICY_STAMP_SEPARATOR,
  STAMP_POLICY_CYPHER,
  UNSTAMP_POLICY_CYPHER,
  policyStamp,
  stampPolicyParams,
  unstampPolicyParams,
} from '../shared/policy-stamp';

// Every save records the class policy its findings were evaluated under, so a later policy change can find the
// elements evaluated under an older one.

const toRecord = (row: Record<string, unknown>) => ({ get: (key: string) => row[key] });

/**
 * The element the save writes to, kept in memory: the stamp statements are applied to it as their Cypher does (the
 * Cypher itself is pinned under "the stamp statement" below), and `writes` counts the statements that changed it.
 */
interface ElementState {
  properties: Record<string, unknown>;
  writes: number;
}

function makeService(firstStatement: Record<string, unknown>, element: ElementState = { properties: {}, writes: 0 }) {
  const service = new SetInstantiationAttributesService(
    { session: jest.fn() } as any,
    { get: jest.fn().mockReturnValue({}) } as unknown as ConfigService,
    { getModuleByName: jest.fn(() => ({})) } as unknown as ModuleRegistryService,
    { extractAuthContext: jest.fn() } as unknown as AuthorizationService,
    { recordOperation: jest.fn() } as unknown as MonitoringService,
  ) as any;
  const logger = service.logger;
  const logs = Object.fromEntries(
    (['log', 'debug', 'warn', 'error'] as const).map(level => [level, jest.spyOn(logger, level).mockImplementation(() => {})]),
  ) as Record<'log' | 'debug' | 'warn' | 'error', jest.SpyInstance>;

  const statements: Array<{ query: string; params: any }> = [];
  const held = () => (element.properties[POLICY_STAMPS_PROPERTY] as string[] | undefined) ?? [];
  const run = jest.fn(async (query: string, params: any) => {
    statements.push({ query, params });
    if (query === STAMP_POLICY_CYPHER) {
      element.properties[POLICY_STAMPS_PROPERTY] = [...held().filter(s => !s.startsWith(params.classPrefix)), params.stamp];
      element.writes++;
      return { records: [toRecord({ stamped: 1 })] };
    }
    if (query === UNSTAMP_POLICY_CYPHER) {
      if (!held().some(s => s.startsWith(params.classPrefix))) return { records: [toRecord({ unstamped: 0 })] };
      element.properties[POLICY_STAMPS_PROPERTY] = held().filter(s => !s.startsWith(params.classPrefix));
      element.writes++;
      return { records: [toRecord({ unstamped: 1 })] };
    }
    return { records: [toRecord({ valueChanged: false, changedKeys: [], ...firstStatement })] };
  });
  service.neo4jDriver.session = jest.fn(() => ({
    executeWrite: jest.fn(async (work: (t: unknown) => Promise<unknown>) => work({ run })),
    close: jest.fn(async () => {}),
  }));
  const evaluate = jest.spyOn(service, 'processControlCountermeasures').mockResolvedValue({ unresolved: [], staleFlipped: 0 });
  jest.spyOn(service, 'processComponentExposures').mockResolvedValue({ unresolved: [], staleFlipped: 0 });
  return { service, run, statements, evaluate, logs };
}

const CONTROL = { moduleName: 'mod-1', type: 'Control', policyHash: 'h1' };
const request = { componentId: 'ctl-1', classId: 'cc-1', attributes: {} };
const stamps = (statements: Array<{ query: string; params: any }>) => statements.filter(s => s.query === STAMP_POLICY_CYPHER);
const unstamps = (statements: Array<{ query: string; params: any }>) => statements.filter(s => s.query === UNSTAMP_POLICY_CYPHER);
/** An element holding `held` stamps, plus properties a stamp must never touch. */
const elementWith = (...held: string[]): ElementState => ({
  properties: {
    [POLICY_STAMPS_PROPERTY]: held,
    name: 'el',
    dispositionStale: true,
    dispositionKind: 'ACCEPTED',
    dispositionReason: 'Reviewed',
    dispositionedBy: 'auth0|prior',
    dispositionedAt: '2026-01-01T00:00:00.000Z',
  },
  writes: 0,
});

describe('setAttributes stamps the policy it evaluated', () => {
  it('reads the class hash in its first statement, before the module evaluates', async () => {
    const { service, statements } = makeService(CONTROL);
    await service.setAttributes(request);
    expect(statements[0].query).toContain('t.policyHash AS policyHash');
  });

  it('stamps the binding with that hash once the findings are written', async () => {
    const { service, statements, run, evaluate } = makeService(CONTROL);

    const result = await service.setAttributes(request);

    expect(result.success).toBe(true);
    expect(stamps(statements).map(s => s.params)).toEqual([stampPolicyParams('ctl-1', 'cc-1', 'h1')]);
    const stampCall = run.mock.calls.findIndex(([query]) => query === STAMP_POLICY_CYPHER);
    expect(run.mock.invocationCallOrder[stampCall]).toBeGreaterThan(evaluate.mock.invocationCallOrder[0]);
  });

  it('stamps a component the same way', async () => {
    const { service, statements } = makeService({ moduleName: 'mod-1', type: 'Component', policyHash: 'h9' });
    await service.setAttributes({ ...request, componentId: 'comp-1' });
    expect(stamps(statements).map(s => s.params)).toEqual([stampPolicyParams('comp-1', 'cc-1', 'h9')]);
  });

  it('neither stamps nor unstamps an issue, which derives nothing', async () => {
    const element = elementWith(policyStamp('cc-1', 'h0'));
    const before = structuredClone(element.properties);
    const { service, statements } = makeService({ moduleName: 'mod-1', type: 'Issue', policyHash: 'h1' }, element);
    await service.setAttributes(request);
    expect(stamps(statements)).toHaveLength(0);
    expect(unstamps(statements)).toHaveLength(0);
    expect(element.properties).toEqual(before);
  });

  it('does not stamp when the class has no policy hash, and removes the older stamp instead', async () => {
    const element = elementWith(policyStamp('cc-1', 'h0'), policyStamp('cc-2', 'h7'));
    const { service, statements } = makeService({ ...CONTROL, policyHash: null }, element);
    await service.setAttributes(request);
    expect(stamps(statements)).toHaveLength(0);
    expect(unstamps(statements).map(s => s.params)).toEqual([unstampPolicyParams('ctl-1', 'cc-1')]);
    expect(element.properties[POLICY_STAMPS_PROPERTY]).toEqual([policyStamp('cc-2', 'h7')]);
  });

  it('replaces an older stamp when there is a hash to stamp', async () => {
    const element = elementWith(policyStamp('cc-1', 'h0'));
    const { service, statements } = makeService(CONTROL, element);
    await service.setAttributes(request);
    expect(unstamps(statements)).toHaveLength(0);
    expect(element.properties[POLICY_STAMPS_PROPERTY]).toEqual([policyStamp('cc-1', 'h1')]);
  });

  it('neither stamps nor unstamps when the findings write fails', async () => {
    const element = elementWith(policyStamp('cc-1', 'h0'));
    const { service, statements, evaluate } = makeService(CONTROL, element);
    evaluate.mockRejectedValue(new Error('policy halted'));

    const result = await service.setAttributes(request);

    expect(result.success).toBe(false);
    expect(stamps(statements)).toHaveLength(0);
    expect(unstamps(statements)).toHaveLength(0);
    expect(element.properties[POLICY_STAMPS_PROPERTY]).toEqual([policyStamp('cc-1', 'h0')]);
  });

  it('an unstamp that fails leaves the save successful, and says so at warn', async () => {
    const { service, run, logs } = makeService({ ...CONTROL, policyHash: null }, elementWith(policyStamp('cc-1', 'h0')));
    const answer = run.getMockImplementation()!;
    run.mockImplementation(async (query: string, params: any) => {
      if (query === UNSTAMP_POLICY_CYPHER) throw new Error('conflict');
      return answer(query, params);
    });

    const result = await service.setAttributes(request);

    expect(result.success).toBe(true);
    expect(logs.warn).toHaveBeenCalledWith(
      'Could not record the policy the findings were evaluated under',
      expect.objectContaining({ componentId: 'ctl-1', classId: 'cc-1' }),
    );
  });

  it('a stamp that fails leaves the save successful, and says so at warn', async () => {
    const { service, run, logs } = makeService(CONTROL);
    const answer = run.getMockImplementation()!;
    run.mockImplementation(async (query: string, params: any) => {
      if (query === STAMP_POLICY_CYPHER) throw new Error('conflict');
      return answer(query, params);
    });

    const result = await service.setAttributes(request);

    expect(result.success).toBe(true);
    expect(logs.warn).toHaveBeenCalledWith(
      'Could not record the policy the findings were evaluated under',
      expect.objectContaining({ componentId: 'ctl-1', classId: 'cc-1' }),
    );
  });
});

describe('the stamp names only a policy the module evaluated', () => {
  const withModule = (module: Record<string, unknown>) => {
    const h = makeService(CONTROL);
    h.service.moduleRegistry.getModuleByName = jest.fn(() => module);
    return h;
  };

  it('stamps when the module evaluates with the stored hash', async () => {
    const getPolicyHash = jest.fn(async () => 'h1');
    const { service, statements } = withModule({ getPolicyHash });
    await service.setAttributes(request);
    expect(getPolicyHash).toHaveBeenCalledWith('cc-1');
    expect(stamps(statements)).toHaveLength(1);
  });

  it('leaves the binding unstamped when the module holds another policy (an instance not yet updated)', async () => {
    const { service, statements } = withModule({ getPolicyHash: async () => 'h0' });
    const result = await service.setAttributes(request);
    expect(result.success).toBe(true);
    expect(stamps(statements)).toHaveLength(0);
  });

  it('leaves it unstamped when the module cannot say, or fails to', async () => {
    for (const getPolicyHash of [async () => undefined, async () => { throw new Error('gone'); }]) {
      const { service, statements } = withModule({ getPolicyHash });
      await service.setAttributes(request);
      expect(stamps(statements)).toHaveLength(0);
    }
  });

  it('removes the older stamp in the window where a remote module serves another pin\'s entry', async () => {
    // The class node still holds the hash its earlier install wrote, and the element is stamped with it; the module
    // now evaluates at a pin whose hashes it cannot report yet. The save's findings follow that pin, so the older
    // stamp must go: left, it would vouch for findings evaluated under another policy.
    const element = elementWith(policyStamp('cc-1', 'h-old'));
    const h = makeService({ ...CONTROL, policyHash: 'h-old' }, element);
    const getPolicyHash = jest.fn(async () => undefined);
    h.service.moduleRegistry.getModuleByName = jest.fn(() => ({ getPolicyHash, evaluatesWithCallerTokenOnly: () => true }));

    const result = await h.service.setAttributes(request);

    expect(result.success).toBe(true);
    expect(getPolicyHash).toHaveBeenCalledWith('cc-1');
    expect(stamps(h.statements)).toHaveLength(0);
    expect(element.properties[POLICY_STAMPS_PROPERTY]).toEqual([]);
  });

  it('keeps stamping a class with no policy at the empty-source hash, and never removes that stamp', async () => {
    const element = elementWith(policyStamp('cc-1', NO_POLICY_HASH));
    const h = makeService({ ...CONTROL, policyHash: NO_POLICY_HASH }, element);
    const module = { getPolicyHash: jest.fn(async () => NO_POLICY_HASH) };
    h.service.moduleRegistry.getModuleByName = jest.fn(() => module);

    expect(await h.service.policyHashToStamp(module, 'cc-1', NO_POLICY_HASH)).toBe(NO_POLICY_HASH);
    await h.service.setAttributes(request);

    expect(unstamps(h.statements)).toHaveLength(0);
    expect(stamps(h.statements).map(s => s.params.stamp)).toEqual([policyStamp('cc-1', NO_POLICY_HASH)]);
    expect(element.properties[POLICY_STAMPS_PROPERTY]).toEqual([policyStamp('cc-1', NO_POLICY_HASH)]);
  });

  it('changes nothing else on the element when it removes a stamp', async () => {
    const element = elementWith(policyStamp('cc-1', 'h0'));
    const { [POLICY_STAMPS_PROPERTY]: _stamps, ...others } = structuredClone(element.properties);
    const { service } = makeService({ ...CONTROL, policyHash: null }, element);

    await service.setAttributes(request);

    const { [POLICY_STAMPS_PROPERTY]: after, ...othersAfter } = element.properties;
    expect(after).toEqual([]);
    expect(othersAfter).toEqual(others);
  });

  it('writes nothing to an element that holds no stamp for the class, as remote-module elements do today', async () => {
    for (const element of [elementWith(), elementWith(policyStamp('cc-2', 'h7')), { properties: { name: 'el' }, writes: 0 }]) {
      const before = structuredClone(element.properties);
      const h = makeService({ ...CONTROL, policyHash: null }, element);

      await h.service.setAttributes(request);

      expect(unstamps(h.statements)).toHaveLength(1);
      expect(element.writes).toBe(0);
      expect(element.properties).toEqual(before);
    }
  });

  it('takes a module with no hash of its own at the stored hash', async () => {
    const { service, statements } = withModule({});
    await service.setAttributes(request);
    expect(stamps(statements).map(s => s.params.stamp)).toEqual([policyStamp('cc-1', 'h1')]);
  });
});

describe('setAttributes quiet', () => {
  it('logs each save at the usual levels by default', async () => {
    const { service, logs, evaluate } = makeService(CONTROL);
    await service.setAttributes(request);
    expect(logs.log).toHaveBeenCalledWith('Instantiation attributes set successfully', expect.anything());
    expect(logs.log).toHaveBeenCalledWith('setInstantiationAttributes no-op (no value change)', expect.anything());

    evaluate.mockRejectedValue(new Error('policy halted'));
    await service.setAttributes(request);
    expect(logs.error).toHaveBeenCalledWith('Failed to set instantiation attributes', expect.anything());
  });

  it('moves those lines to debug', async () => {
    const { service, logs, evaluate } = makeService(CONTROL);
    await service.setAttributes(request, undefined, { quiet: true });
    evaluate.mockRejectedValue(new Error('policy halted'));
    await service.setAttributes(request, undefined, { quiet: true });

    expect(logs.log).not.toHaveBeenCalled();
    expect(logs.error).not.toHaveBeenCalled();
    expect(logs.debug).toHaveBeenCalledWith('Instantiation attributes set successfully', expect.anything());
    expect(logs.debug).toHaveBeenCalledWith('Failed to set instantiation attributes', expect.anything());
  });
});

describe('the stamp statement', () => {
  const cypher = STAMP_POLICY_CYPHER.replace(/\s+/g, ' ');

  it('is anchored at the element and gated on its binding to the class', () => {
    expect(cypher).toMatch(/^ MATCH \(c \{id: \$elementId\}\) WITH c MATCH \(c\)-\[:IS_INSTANCE_OF\]->\(t\) WHERE t\.id = \$classId SET /);
  });

  it("replaces only that class's stamp", () => {
    expect(cypher).toContain(
      `SET c.${POLICY_STAMPS_PROPERTY} = [s IN coalesce(c.${POLICY_STAMPS_PROPERTY}, []) WHERE NOT s STARTS WITH $classPrefix] + [$stamp]`,
    );
    expect(stampPolicyParams('e', 'cls', 'h')).toEqual({
      elementId: 'e',
      classId: 'cls',
      classPrefix: `cls${POLICY_STAMP_SEPARATOR}`,
      stamp: policyStamp('cls', 'h'),
    });
  });

  it("removes only that class's stamp, anchored at the element alone, and appends nothing", () => {
    const unstamp = UNSTAMP_POLICY_CYPHER.replace(/\s+/g, ' ');
    expect(unstamp).toMatch(/^ MATCH \(c \{id: \$elementId\}\) WHERE /);
    expect(unstamp).not.toContain('IS_INSTANCE_OF');
    expect(unstamp).toContain(
      `SET c.${POLICY_STAMPS_PROPERTY} = [s IN c.${POLICY_STAMPS_PROPERTY} WHERE NOT s STARTS WITH $classPrefix]`,
    );
    expect(unstamp).not.toContain('$stamp');
    expect(unstampPolicyParams('e', 'cls')).toEqual({ elementId: 'e', classPrefix: `cls${POLICY_STAMP_SEPARATOR}` });
  });

  it('writes only when the element holds a stamp for the class, and writes nothing but the stamps', () => {
    const unstamp = UNSTAMP_POLICY_CYPHER.replace(/\s+/g, ' ');
    expect(unstamp).toContain(`WHERE any(s IN coalesce(c.${POLICY_STAMPS_PROPERTY}, []) WHERE s STARTS WITH $classPrefix) SET`);
    expect(unstamp.match(/\bSET\b/g)).toHaveLength(1);
    expect(unstamp).not.toMatch(/\b(REMOVE|DELETE|MERGE|CREATE)\b/);
    expect(unstamp).not.toMatch(/disposition/i);
  });

  it('separates the class from the hash with a character no class id holds', () => {
    expect(POLICY_STAMP_SEPARATOR).toBe(String.fromCharCode(31));
    expect(policyStamp('cls', 'h')).toBe(`cls${String.fromCharCode(31)}h`);
  });
});

describe('the stamp stays internal', () => {
  it('is not in the GraphQL schema, so no query, selection or export can read it', () => {
    const schema = fs.readFileSync(path.join(__dirname, '../../../../schema/schema.graphql'), 'utf8');
    expect(schema).not.toContain(POLICY_STAMPS_PROPERTY);
    expect(schema).not.toContain('policyHash');
  });
});
