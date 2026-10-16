import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { SetInstantiationAttributesService } from '../set-instantiation-attributes.service';
import { ModuleRegistryService } from '../../module-management-services/module-registry.service';
import { AuthorizationService } from '../../services/authorization.service';
import { MonitoringService } from '../../services/monitoring.service';
import {
  POLICY_STAMPS_PROPERTY,
  POLICY_STAMP_SEPARATOR,
  STAMP_POLICY_CYPHER,
  policyStamp,
  stampPolicyParams,
} from '../shared/policy-stamp';

// Every save records the class policy its findings were evaluated under, so a later policy change can find the
// elements evaluated under an older one.

const toRecord = (row: Record<string, unknown>) => ({ get: (key: string) => row[key] });

function makeService(firstStatement: Record<string, unknown>) {
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
  const run = jest.fn(async (query: string, params: any) => {
    statements.push({ query, params });
    if (query === STAMP_POLICY_CYPHER) return { records: [toRecord({ stamped: 1 })] };
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

  it('does not stamp an issue, which derives nothing', async () => {
    const { service, statements } = makeService({ moduleName: 'mod-1', type: 'Issue', policyHash: 'h1' });
    await service.setAttributes(request);
    expect(stamps(statements)).toHaveLength(0);
  });

  it('does not stamp when the class has no policy hash', async () => {
    const { service, statements } = makeService({ ...CONTROL, policyHash: null });
    await service.setAttributes(request);
    expect(stamps(statements)).toHaveLength(0);
  });

  it('does not stamp when the findings write fails', async () => {
    const { service, statements, evaluate } = makeService(CONTROL);
    evaluate.mockRejectedValue(new Error('policy halted'));

    const result = await service.setAttributes(request);

    expect(result.success).toBe(false);
    expect(stamps(statements)).toHaveLength(0);
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
