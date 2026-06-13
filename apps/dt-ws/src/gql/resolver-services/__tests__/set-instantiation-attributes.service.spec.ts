import { SetInstantiationAttributesService } from '../set-instantiation-attributes.service';
import { ConfigService } from '@nestjs/config';
import { ModuleRegistryService } from '../../module-management-services/module-registry.service';
import { AuthorizationService } from '../../services/authorization.service';
import { MonitoringService } from '../../services/monitoring.service';

/**
 * Unit pins for SetInstantiationAttributesService failure transparency.
 * Covers:
 *   - diagnoseSetAttributesFailure branches: element missing, class missing,
 *     wrong-kind class (the dogfood G1 case: a ComponentClass bound to a
 *     Control), orphaned class, no IS_INSTANCE_OF edge, and the generic
 *     fallback — each producing an actionable message naming the offending id.
 *   - the diagnostic issues exactly one tx.run (one round trip on the error
 *     path).
 *   - the GraphQL resolver maps a thrown SetInstantiationError into the
 *     envelope's errorCode/errorMessage, and returns nulls on success.
 *
 * Live-DB integration coverage is out of scope for this unit pin.
 */

type RecordMap = Record<string, any>;

const toRecord = (row: RecordMap) => ({ get: (key: string) => row[key] });

function makeTx(row: RecordMap | null) {
  const runMock = jest
    .fn()
    .mockResolvedValue({ records: row ? [toRecord(row)] : [] });
  return { tx: { run: runMock }, runMock };
}

function makeService() {
  const configService: any = {
    get: jest.fn().mockReturnValue({}), // GqlConfig — only needs to be truthy
  };
  const moduleRegistry: any = { getModuleByName: jest.fn() };
  const authorizationService: any = {
    extractAuthContext: jest.fn().mockReturnValue({ userId: 'u-1' }),
  };
  const monitoringService: any = { recordOperation: jest.fn() };
  const driver: any = { session: jest.fn() };

  const service = new SetInstantiationAttributesService(
    driver,
    configService as ConfigService,
    moduleRegistry as ModuleRegistryService,
    authorizationService as AuthorizationService,
    monitoringService as MonitoringService,
  );
  return { service, authorizationService };
}

// Default "all present and consistent" diagnostic row, overridden per case.
const baseRow = (over: RecordMap): RecordMap => ({
  elementFound: true,
  elementLabels: ['Control'],
  classFound: true,
  classLabels: ['ControlClass'],
  className: 'Network Access Control',
  moduleName: 'dethernety-general',
  edgeExists: true,
  ...over,
});

describe('SetInstantiationAttributesService — diagnoseSetAttributesFailure', () => {
  const COMP = 'ctrl-1';
  const CLASS = 'class-1';

  const diagnose = (service: any, row: RecordMap | null) => {
    const { tx, runMock } = makeTx(row);
    return { result: service.diagnoseSetAttributesFailure(tx, COMP, CLASS), runMock };
  };

  it('reports the element id when the element is missing', async () => {
    const { service } = makeService();
    const { result } = diagnose(
      service,
      baseRow({ elementFound: false, elementLabels: null, classFound: true }),
    );
    await expect(result).resolves.toContain(`element "${COMP}" not found`);
  });

  it('reports the class id when the class is missing', async () => {
    const { service } = makeService();
    const { result } = diagnose(
      service,
      baseRow({ classFound: false, classLabels: null, className: null, moduleName: null }),
    );
    await expect(result).resolves.toContain(`class "${CLASS}" not found`);
  });

  it('names the actual class kind when a ComponentClass is bound to a Control (G1)', async () => {
    const { service } = makeService();
    const { result } = diagnose(
      service,
      baseRow({
        elementLabels: ['Control'],
        classLabels: ['ComponentClass'],
        className: 'NetworkPolicy',
        moduleName: 'kubernetes-core',
        edgeExists: false,
      }),
    );
    const msg = await result;
    expect(msg).toContain('NetworkPolicy');
    expect(msg).toContain('is a ComponentClass');
    expect(msg).toContain('a Control can only bind ControlClass');
  });

  it('flags an orphaned class (no active module)', async () => {
    const { service } = makeService();
    const { result } = diagnose(
      service,
      baseRow({ moduleName: null, edgeExists: false }),
    );
    await expect(result).resolves.toContain('no active module');
  });

  it('reports a missing IS_INSTANCE_OF edge when kind and module are fine', async () => {
    const { service } = makeService();
    const { result } = diagnose(service, baseRow({ edgeExists: false }));
    await expect(result).resolves.toContain('no IS_INSTANCE_OF relationship');
  });

  it('falls back to the generic message when everything looks consistent', async () => {
    const { service } = makeService();
    const { result } = diagnose(service, baseRow({}));
    await expect(result).resolves.toContain('failed to set attributes');
  });

  it('runs exactly one diagnostic query', async () => {
    const { service } = makeService();
    const { result, runMock } = diagnose(service, baseRow({ edgeExists: false }));
    await result;
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it('degrades to the generic message if the diagnostic query throws', async () => {
    const { service } = makeService();
    const tx = { run: jest.fn().mockRejectedValue(new Error('boom')) };
    await expect(
      (service as any).diagnoseSetAttributesFailure(tx, COMP, CLASS),
    ).resolves.toContain('failed to set attributes');
  });
});

describe('SetInstantiationAttributesService — resolver envelope', () => {
  const callResolver = async (service: any, authorizationService: any) => {
    const resolvers = service.getResolvers();
    return resolvers.Mutation.setInstantiationAttributes(
      null,
      { componentId: 'ctrl-1', classId: 'class-1', attributes: {} },
      {},
    );
  };

  it('surfaces errorCode/errorMessage when the write throws a SetInstantiationError', async () => {
    const { service, authorizationService } = makeService();
    (service as any).config.batchEnabled = false;
    jest.spyOn(service as any, 'setAttributes').mockRejectedValue({
      type: 'DATABASE_ERROR',
      message: 'class "class-1" ("NetworkPolicy") is a ComponentClass — a Control can only bind ControlClass',
    });

    const out = await callResolver(service, authorizationService);
    expect(out.success).toBe(false);
    expect(out.staleFlippedCount).toBeNull();
    expect(out.errorCode).toBe('DATABASE_ERROR');
    expect(out.errorMessage).toContain('is a ComponentClass');
  });

  it('returns null error fields on success', async () => {
    const { service, authorizationService } = makeService();
    (service as any).config.batchEnabled = false;
    jest
      .spyOn(service as any, 'setAttributes')
      .mockResolvedValue({ success: true, staleFlippedCount: 2 });

    const out = await callResolver(service, authorizationService);
    expect(out.success).toBe(true);
    expect(out.staleFlippedCount).toBe(2);
    expect(out.errorCode).toBeNull();
    expect(out.errorMessage).toBeNull();
  });
});
