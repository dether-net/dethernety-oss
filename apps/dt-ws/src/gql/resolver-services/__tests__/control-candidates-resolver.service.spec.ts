import { ControlCandidatesResolverService } from '../control-candidates-resolver.service';
import { AuthorizationService } from '../../services/authorization.service';
import { MonitoringService } from '../../services/monitoring.service';
import { ConfigService } from '@nestjs/config';

/**
 * Unit pins for ControlCandidatesResolverService. Asserts:
 *   - the Cypher uses the two-pass shape: an eligibility prune
 *     (WITH DISTINCT ctrl) followed by a class-collection MATCH that carries
 *     NO supportedTypes filter, so the per-class `compatible` flag is computed
 *     in the collect map rather than guaranteed true by a pre-filter. The
 *     CI §6.3 incompatible-configured penalty depends on this shape.
 *   - row mapping preserves mixed compatible flags and converts driver
 *     Integer-like countermeasure counts
 *   - input validation rejects empty / oversized elementTypes before any
 *     DB call
 *   - authorization denial short-circuits before any DB call
 *
 * Integration coverage against a live DB is out of scope for this unit pin.
 */

type RecordMap = Record<string, any>;

const toRecord = (row: RecordMap) => ({
  get: (key: string) => row[key],
});

function makeDriver(rows: RecordMap[]) {
  const runMock = jest.fn().mockResolvedValue({ records: rows.map(toRecord) });
  const session = {
    executeRead: jest
      .fn()
      .mockImplementation(async (work: (tx: any) => Promise<any>) => {
        const tx = { run: runMock };
        return work(tx);
      }),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const driver = { session: jest.fn().mockReturnValue(session) };
  return { driver, session, runMock };
}

function makeServices(allowed = true) {
  const auth: any = {
    extractAuthContext: jest.fn().mockReturnValue({ userId: 'u-1' }),
    checkAuthorization: jest.fn().mockResolvedValue({ allowed, reason: 'nope' }),
  };
  const monitoring: any = { recordOperation: jest.fn() };
  const config: any = { get: jest.fn().mockReturnValue('neo4j') };
  return { auth, monitoring, config };
}

const adminCtx = { user: { sub: 'op-1' } };

function makeService(driver: any) {
  const { auth, monitoring, config } = makeServices();
  return new ControlCandidatesResolverService(
    driver as any,
    config as ConfigService,
    auth as AuthorizationService,
    monitoring as MonitoringService,
  );
}

describe('ControlCandidatesResolverService — Cypher shape', () => {
  it('prunes eligibility first, then collects ALL classes without a supportedTypes pre-filter', async () => {
    const { driver, runMock } = makeDriver([]);
    const svc = makeService(driver);

    await svc
      .getResolvers()
      .Query.controlCandidatesForType({}, { elementTypes: ['PROCESS'] }, adminCtx as any);

    expect(runMock).toHaveBeenCalledTimes(1);
    const query: string = runMock.mock.calls[0][0];

    // Eligibility pre-pass exists and dedupes controls.
    expect(query).toMatch(/WITH DISTINCT ctrl/);

    // Between the prune and the classes-collect map there is no
    // supportedTypes filter — compatibility is computed inside the map,
    // never by a pre-filter (which would make it tautologically true).
    const afterPrune = query.split(/WITH DISTINCT ctrl/)[1];
    const beforeClassMap = afterPrune.split(/classId:/)[0];
    expect(beforeClassMap).not.toMatch(/supportedTypes/);

    // The collect map computes the per-class compatible flag, null-guarded
    // (Memgraph raises on membership against a null list).
    expect(afterPrune).toMatch(
      /compatible:\s*ANY\(et IN \$elementTypes WHERE et IN coalesce\(cc\.supportedTypes, \[\]\)\)/,
    );

    // Both supportedTypes reads are null-guarded.
    expect(query).not.toMatch(/IN cc0?\.supportedTypes\)/);
  });
});

describe('ControlCandidatesResolverService — row mapping', () => {
  it('preserves mixed compatible flags and converts Integer-like counts', async () => {
    const rows = [
      {
        controlId: 'ctrl-1',
        controlName: 'DB Encryption',
        classes: [
          {
            classId: 'cls-a',
            className: 'Encryption at Rest',
            moduleId: 'mod-1',
            moduleName: 'general',
            compatible: true,
            countermeasureCount: { toNumber: () => 3 },
          },
          {
            classId: 'cls-b',
            className: 'WAF',
            moduleId: 'mod-2',
            moduleName: 'edge',
            compatible: false,
            countermeasureCount: 2,
          },
        ],
        totalCountermeasures: { toNumber: () => 5 },
        assignedElementIds: ['e-1', null],
      },
    ];
    const { driver } = makeDriver(rows);
    const svc = makeService(driver);

    const result = await svc
      .getResolvers()
      .Query.controlCandidatesForType({}, { elementTypes: ['STORE'] }, adminCtx as any);

    expect(result).toHaveLength(1);
    expect(result[0].classes.map((c: any) => c.compatible)).toEqual([true, false]);
    expect(result[0].classes.map((c: any) => c.countermeasureCount)).toEqual([3, 2]);
    expect(result[0].totalCountermeasures).toBe(5);
    expect(result[0].assignedElementIds).toEqual(['e-1']);
  });
});

describe('ControlCandidatesResolverService — input validation & auth', () => {
  it('rejects empty elementTypes before touching the DB', async () => {
    const { driver } = makeDriver([]);
    const svc = makeService(driver);

    await expect(
      svc
        .getResolvers()
        .Query.controlCandidatesForType({}, { elementTypes: [] }, adminCtx as any),
    ).rejects.toThrow(/At least one elementType/);
    expect(driver.session).not.toHaveBeenCalled();
  });

  it('rejects more than 20 elementTypes before touching the DB', async () => {
    const { driver } = makeDriver([]);
    const svc = makeService(driver);

    await expect(
      svc.getResolvers().Query.controlCandidatesForType(
        {},
        { elementTypes: Array.from({ length: 21 }, (_, i) => `T${i}`) },
        adminCtx as any,
      ),
    ).rejects.toThrow(/Maximum 20 elementTypes/);
    expect(driver.session).not.toHaveBeenCalled();
  });

  it('authorization denial short-circuits before any DB call', async () => {
    const { driver } = makeDriver([]);
    const { auth, monitoring, config } = makeServices(false);
    const svc = new ControlCandidatesResolverService(
      driver as any,
      config as ConfigService,
      auth as AuthorizationService,
      monitoring as MonitoringService,
    );

    await expect(
      svc
        .getResolvers()
        .Query.controlCandidatesForType({}, { elementTypes: ['PROCESS'] }, adminCtx as any),
    ).rejects.toThrow(/Authorization denied/);
    expect(driver.session).not.toHaveBeenCalled();
  });
});
