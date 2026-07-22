import { Logger } from '@nestjs/common';
import {
  DtLgModule,
  LgAnalysisConfig,
  deriveAnalysisClassId,
} from '@dethernety/dt-module';

// Replace the SDK so `new Client(...)` returns a mock with assistants.search.
const mockSearch = jest.fn();
jest.mock('@langchain/langgraph-sdk', () => ({
  Client: jest.fn().mockImplementation(() => ({
    assistants: { search: (...args: any[]) => mockSearch(...args) },
    runs: {},
    threads: {},
    store: {},
  })),
}));

const buildConfig = (graphNames: string[]): LgAnalysisConfig => ({
  graphs: Object.fromEntries(
    graphNames.map((name) => [
      name,
      {
        description: `${name} desc`,
        type: 't',
        category: 'c',
        input: async () => ({}),
      },
    ]),
  ),
});

class TestModule extends DtLgModule {
  constructor(graphNames: string[]) {
    super(
      'test-module',
      {} as any,
      new Logger('test'),
      {
        analysisConfig: buildConfig(graphNames),
        metadata: { description: 'd', version: '1', author: 'a' },
      },
    );
  }

  // Promote the protected method to public for direct testing.
  public async getClasses() {
    return this.getAnalysisClasses();
  }
}

beforeEach(() => {
  mockSearch.mockReset();
});

describe('DtLgModule.getAnalysisClasses', () => {
  it('filters the LangGraph server response to declared graphs and derives ids locally', async () => {
    mockSearch.mockResolvedValue([
      { assistant_id: 'lg-1', name: 'Studio: Generate Class' },
      { assistant_id: 'lg-2', name: 'Studio: Edit Class' },
      { assistant_id: 'lg-3', name: 'Hidden Edges Discovery' }, // not declared
      { assistant_id: 'lg-4', name: 'Analysis Copilot' },        // not declared
    ]);

    const mod = new TestModule(['Studio: Generate Class', 'Studio: Edit Class']);
    const classes = await mod.getClasses();

    expect(classes).toHaveLength(2);
    expect(classes.map((c) => c.name).sort()).toEqual([
      'Studio: Edit Class',
      'Studio: Generate Class',
    ]);

    // Each derived id matches the deterministic helper, NOT the raw server value.
    for (const c of classes) {
      expect(c.id).toBe(deriveAnalysisClassId(c.name));
    }

    // Pin the derived id against a known fixture — guards against
    // accidental drift in `deriveAnalysisClassId` or the namespace UUID.
    const generate = classes.find((c) => c.name === 'Studio: Generate Class');
    expect(generate?.id).toBe('e5b244aa-8721-5ffa-a29d-d07ff5f2af9d');
  });

  it('throws when the server search throws (no silent class wipe)', async () => {
    mockSearch.mockRejectedValue(new Error('LangGraph server unreachable'));
    const mod = new TestModule(['Analysis Copilot']);
    await expect(mod.getClasses()).rejects.toThrow('LangGraph server unreachable');
  });

  it('returns empty array when the server responds but no declared graph matches', async () => {
    mockSearch.mockResolvedValue([
      { assistant_id: 'lg-x', name: 'Some Other Graph' },
    ]);
    const mod = new TestModule(['Analysis Copilot']);
    const classes = await mod.getClasses();
    expect(classes).toEqual([]);
  });
});

describe('DtLgModule.getMetadata', () => {
  it('returns idRebindPolicy: "audit" by default', async () => {
    mockSearch.mockResolvedValue([]);
    const mod = new TestModule([]);
    const meta = await mod.getMetadata();
    expect(meta.idRebindPolicy).toBe('audit');
  });

  it('propagates a LangGraph server failure (does not swallow)', async () => {
    mockSearch.mockRejectedValue(new Error('LangGraph server down'));
    const mod = new TestModule(['Analysis Copilot']);
    await expect(mod.getMetadata()).rejects.toThrow('LangGraph server down');
  });
});
