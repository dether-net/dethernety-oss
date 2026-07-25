/**
 * DtLgModule — client construction + lifecycle surface.
 *
 * Mocks the LangGraph SDK `Client` so we can assert the constructor arguments (the control-plane
 * timeout that keeps a wedged LangGraph server from hanging boot) and that the new lifecycle
 * methods (stopAnalysis / dispose) delegate to the analysis-ops registry. The real
 * DtLgAnalysisOps is used — only the network `Client` is faked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture every Client({...}) config. `vi.hoisted` so the mock factory can see it despite hoisting.
const hoisted = vi.hoisted(() => ({ configs: [] as any[] }));

vi.mock('@langchain/langgraph-sdk', () => ({
  // A regular function (not an arrow) so `new Client(...)` can construct it.
  Client: vi.fn(function (config: any) {
    hoisted.configs.push(config);
    return { threads: {}, runs: {}, assistants: {} };
  }),
}));

import { DtLgModule } from '../dt-lg-module';
import { LgModuleOptions } from '../interfaces/lg-analysis-config-interface';

const logger: any = { log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

function makeOptions(overrides: Partial<LgModuleOptions> = {}): LgModuleOptions {
  return {
    analysisConfig: { graphs: {} } as any,
    metadata: { description: 'test', version: '1.0.0', author: 'test', icon: 'x' } as any,
    ...overrides,
  };
}

function makeModule(overrides: Partial<LgModuleOptions> = {}): DtLgModule {
  return new DtLgModule('test-module', {}, logger, makeOptions(overrides));
}

// Save/restore the env var so tests that set it can't leak into other files in the worker
// (or clobber an operator's shell value).
const savedTimeoutEnv = process.env.LANGGRAPH_TIMEOUT_MS;

beforeEach(() => {
  hoisted.configs.length = 0;
  delete process.env.LANGGRAPH_TIMEOUT_MS;
});

afterEach(() => {
  if (savedTimeoutEnv === undefined) delete process.env.LANGGRAPH_TIMEOUT_MS;
  else process.env.LANGGRAPH_TIMEOUT_MS = savedTimeoutEnv;
});

describe('DtLgModule client construction', () => {
  it('constructs the Client with a default control-plane timeout of 30000ms', () => {
    makeModule();
    expect(hoisted.configs).toHaveLength(1);
    expect(hoisted.configs[0].timeoutMs).toBe(30_000);
  });

  it('lets the langgraphTimeoutMs option override the default', () => {
    makeModule({ langgraphTimeoutMs: 7000 });
    expect(hoisted.configs[0].timeoutMs).toBe(7000);
  });

  it('falls back to LANGGRAPH_TIMEOUT_MS when no option is given', () => {
    process.env.LANGGRAPH_TIMEOUT_MS = '5000';
    makeModule();
    expect(hoisted.configs[0].timeoutMs).toBe(5000);
  });

  it('never lets a 0/NaN disable the timeout', () => {
    process.env.LANGGRAPH_TIMEOUT_MS = 'not-a-number';
    makeModule({ langgraphTimeoutMs: 0 });
    expect(hoisted.configs[0].timeoutMs).toBe(30_000);
  });
});

describe('DtLgModule lifecycle delegation', () => {
  let mod: DtLgModule;
  beforeEach(() => {
    mod = makeModule();
  });

  it('stopAnalysis delegates to the analysis-ops registry', async () => {
    const spy = vi.spyOn((mod as any).analysisOps, 'stopRun').mockReturnValue(true);
    const result = await mod.stopAnalysis('s1');
    expect(spy).toHaveBeenCalledWith('s1');
    expect(result).toBe(true);
  });

  it('dispose aborts every in-flight run via the registry', () => {
    const spy = vi.spyOn((mod as any).analysisOps, 'abortAll');
    mod.dispose();
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe('DtLgModule module template', () => {
  it('no longer exposes getModuleTemplate (falls back to the platform default)', () => {
    const mod = makeModule();
    expect((mod as any).getModuleTemplate).toBeUndefined();
  });
});
