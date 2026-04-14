import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MatchClassesResolverService } from '../match-classes-resolver.service';
import { EmbeddingService } from '../../services/embedding.service';
import { AuthorizationService } from '../../services/authorization.service';
import { MonitoringService } from '../../services/monitoring.service';

// A minimal fake neo4j driver that can replay scripted query results.
// Each script entry is matched by a substring of the Cypher text.
interface ScriptEntry {
  match: string;
  // Either records to return, or an error to throw
  records?: Record<string, any>[];
  throws?: Error;
}

function makeDriver(script: ScriptEntry[], writeLog: string[] = []) {
  function runTx(cypher: string) {
    const entry = script.find((s) => cypher.includes(s.match));
    if (!entry) {
      throw new Error(`No scripted response for query: ${cypher}`);
    }
    if (entry.throws) throw entry.throws;
    return {
      records: (entry.records ?? []).map((r) => ({
        get: (key: string) => r[key],
      })),
    };
  }

  const session = {
    executeRead: async (fn: any) =>
      fn({ run: async (cypher: string) => runTx(cypher) }),
    run: async (cypher: string) => {
      writeLog.push(cypher);
      return { records: [] };
    },
    close: async () => {},
  };

  return {
    session: () => session,
  };
}

async function buildService(
  driver: any,
  embeddingOverrides: Partial<EmbeddingService> = {},
) {
  const embeddingStub: Partial<EmbeddingService> = {
    isEnabled: () => true,
    getDimensions: () => 768,
    getModel: () => 'nomic-embed-text',
    getThreshold: () => 0.75,
    disableForSession: jest.fn(),
    ...embeddingOverrides,
  };

  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      MatchClassesResolverService,
      { provide: ConfigService, useValue: { get: () => undefined } },
      { provide: EmbeddingService, useValue: embeddingStub },
      { provide: AuthorizationService, useValue: {} },
      { provide: MonitoringService, useValue: { recordQuery: () => {} } },
      { provide: 'NEO4J_DRIVER', useValue: driver },
    ],
  }).compile();

  const svc = moduleRef.get(MatchClassesResolverService);
  return { svc, embeddingStub };
}

describe('ensureVectorIndexes', () => {
  it('creates missing indexes; marks flag ensured on success', async () => {
    const writeLog: string[] = [];
    const driver = makeDriver(
      [{ match: 'YIELD index_name, dimension', records: [] }],
      writeLog,
    );
    const { svc } = await buildService(driver);

    await (svc as any).ensureVectorIndexes();

    expect(writeLog.length).toBe(5); // 5 class-label indexes
    expect(writeLog[0]).toContain('CREATE VECTOR INDEX');
    expect(writeLog[0]).toContain('dimension');
    expect((svc as any).vectorIndexesEnsured).toBe(true);

    writeLog.length = 0;
    await (svc as any).ensureVectorIndexes();
    expect(writeLog.length).toBe(0); // second call is a no-op
  });

  it('calls disableForSession when an existing index dimension mismatches', async () => {
    const writeLog: string[] = [];
    const driver = makeDriver(
      [
        {
          match: 'YIELD index_name, dimension',
          records: [{ index_name: 'component_class_embeddings', dimension: 1536 }],
        },
      ],
      writeLog,
    );
    const disableForSession = jest.fn();
    const { svc } = await buildService(driver, { disableForSession } as any);

    await (svc as any).ensureVectorIndexes();

    expect(disableForSession).toHaveBeenCalledTimes(1);
    expect(disableForSession.mock.calls[0][0]).toMatch(
      /component_class_embeddings.*dimension 1536.*EMBEDDING_DIMENSIONS=768/,
    );
    // Flag NOT set — retry will find the same condition and short-circuit upstream.
    expect((svc as any).vectorIndexesEnsured).toBe(false);
  });

  it('falls back to name-only read when dimension is not projected, logs warn, still marks ensured', async () => {
    const writeLog: string[] = [];
    const driver = makeDriver(
      [
        {
          match: 'YIELD index_name, dimension',
          throws: new Error('Unknown yield field: dimension'),
        },
        {
          match: 'YIELD index_name RETURN',
          records: [
            { index_name: 'component_class_embeddings' },
            { index_name: 'control_class_embeddings' },
            { index_name: 'dataflow_class_embeddings' },
            { index_name: 'boundary_class_embeddings' },
            { index_name: 'data_class_embeddings' },
          ],
        },
      ],
      writeLog,
    );
    const disableForSession = jest.fn();
    const { svc } = await buildService(driver, { disableForSession } as any);

    await (svc as any).ensureVectorIndexes();

    expect(disableForSession).not.toHaveBeenCalled(); // no cross-check performed
    expect(writeLog.length).toBe(0); // all indexes already existed
    expect((svc as any).vectorIndexesEnsured).toBe(true);
  });

  it('leaves flag false on transient error so the next call retries', async () => {
    const driver = makeDriver([
      {
        match: 'YIELD index_name, dimension',
        throws: new Error('connection refused'),
      },
      {
        match: 'YIELD index_name RETURN',
        throws: new Error('connection refused'),
      },
    ]);
    const { svc } = await buildService(driver);

    await expect((svc as any).ensureVectorIndexes()).rejects.toThrow(
      'connection refused',
    );
    expect((svc as any).vectorIndexesEnsured).toBe(false);
  });
});
