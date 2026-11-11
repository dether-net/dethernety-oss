// The staleness fingerprint, pinned through the real `computeStructure` with its queries answered by a fake session.
// The golden was generated from the code before a new key could enter the hashed object: a stored report stays fresh
// across a change to this module only if an unchanged model hashes byte-identically.
import { describe, expect, it, vi } from 'vitest';

import DethernetyThreatReportModule from '../DethernetyThreatReportModule';

const STRUCTURE = {
  boundaryIds: ['b2', 'b1'],
  componentIds: ['c2', 'c1'],
  dataIds: ['d1'],
  dataSigs: ['d1|RESTRICTED'],
  dataFlowIds: ['f1'],
  exposureSigs: ['e1|||c1'],
  handlesSigs: ['c1|d1'],
};
const ZONING = {
  bZoning: [
    { id: 'b1', zone: 'INTERNAL', planes: ['DATA'], domains: [], parent: '' },
    { id: 'b2', zone: '', planes: [], domains: ['x'], parent: 'b1' },
  ],
  cjSigs: ['c1|true<b1', 'c2|<b2'],
  dRegs: [{ id: 'd1', flags: ['GDPR'] }],
  conduitSigs: ['b1>b2|why'],
  flowSigs: ['f1|c1>c2'],
};

/** One row of a query's answer. */
const record = (row: Record<string, unknown>) => ({ get: (key: string) => row[key] });

function moduleAnswering(answer: (query: string) => Array<Record<string, unknown>>) {
  const session = {
    run: async (query: string) => ({ records: answer(query).map(record) }),
    close: async () => undefined,
  };
  const driver = { session: () => session };
  const logger = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
  return new DethernetyThreatReportModule(driver as never, logger as never) as unknown as {
    computeStructure(modelId: string): Promise<{ fingerprint: string; componentCount: number; boundaryCount: number }>;
  };
}

const answers = (query: string): Array<Record<string, unknown>> => {
  if (query.includes('exposureSigs')) return [STRUCTURE];
  if (query.includes('bZoning')) return [ZONING];
  return [];
};

describe('the structure fingerprint', () => {
  it('hashes the same signatures byte-identically to before the op key when nothing declares', async () => {
    const out = await moduleAnswering(answers).computeStructure('m');
    expect(out).toEqual({ fingerprint: '4cbf6b1a3db28bb0', componentCount: 2, boundaryCount: 2 });
  });

  const withOperation = (rows: Array<Record<string, unknown>>) =>
    moduleAnswering((query) => (query.includes('dethernety_operated_by') ? rows : answers(query)));

  it('moves when an element declares, and not for what it already reads the same', async () => {
    const base = (await moduleAnswering(answers).computeStructure('m')).fingerprint;
    const declared = (await withOperation([{ id: 'c1', pairs: [['dethernety_operated_by', 'VENDOR']] }]).computeStructure('m')).fingerprint;
    expect(declared).not.toBe(base);
    const same = (await withOperation([{ id: 'c1', pairs: [['dethernety_operated_by', 'VENDOR'], ['dethernety_product', '   ']] }]).computeStructure('m')).fingerprint;
    expect(same).toBe(declared);
    const other = (await withOperation([{ id: 'c1', pairs: [['dethernety_operated_by', 'CUSTOMER']] }]).computeStructure('m')).fingerprint;
    expect(other).not.toBe(declared);
  });

  it('a cleared value hashes as if never declared', async () => {
    const base = (await moduleAnswering(answers).computeStructure('m')).fingerprint;
    const cleared = (await withOperation([{ id: 'c1', pairs: [['dethernety_operated_by', ''], ['dethernety_product', '  ']] }]).computeStructure('m')).fingerprint;
    expect(cleared).toBe(base);
  });
});

describe('who runs each element, when a report is generated', () => {
  const logger = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
  const GRAPH = {
    boundaries: [{ id: 'b', name: 'B', parentBoundaryId: null, zone: null, planes: [], domains: [], conduits: [] }],
    components: [{ id: 'c', name: 'C', type: 'process', boundaryId: 'b', crownJewel: false }],
    flows: [],
    dataNodes: [],
  };
  const RULES = {
    operatorOf: () => ({ party: 'VENDOR', source: 'declared' }),
    hostingOf: () => ({ party: 'CUSTOMER', source: 'undeclared' }),
  };

  /** A module with everything but the operation block stubbed, recording the document it writes. */
  function generating(over: Record<string, unknown> = {}) {
    let written: string | undefined;
    const run = vi.fn(async (_query: string, params: { doc?: string }) => {
      if (params.doc !== undefined) written = params.doc;
      return { records: params.doc !== undefined ? [record({ id: 'a' })] : [] };
    });
    const session = { run, executeWrite: async (work: (tx: { run: typeof run }) => unknown) => work({ run }), close: async () => undefined };
    const module = new DethernetyThreatReportModule({ session: () => session } as never, logger as never) as any;
    Object.assign(module, {
      computeStructure: async () => ({ fingerprint: 'f', componentCount: 1, boundaryCount: 1 }),
      computeLedger: async () => [],
      computeModelGraph: async () => GRAPH,
      loadZoningEngine: async () => { throw new Error('no zoning'); },
      loadOperationRules: async () => RULES,
      ...over,
    });
    return { module, run, doc: () => JSON.parse(written ?? '{}') };
  }

  const zoningWorks = { loadZoningEngine: () => import('@dethernety/dt-core/zone-determination') };

  it('freezes what was resolved into the report', async () => {
    const { module, doc } = generating(zoningWorks);
    await module.runAnalysis('a', 'x', 'm', {});
    expect(doc().operation.state).toBe('resolved');
    expect(doc().operation.elements.c.operator).toEqual({ party: 'VENDOR', source: 'declared' });
  });

  it('says unavailable when zoning failed, since the zones are an input, and still writes the report', async () => {
    const { module, doc } = generating();
    await module.runAnalysis('a', 'x', 'm', {});
    expect(doc().generated).toBe(true);
    expect(doc().operation).toEqual({ state: 'unavailable', elements: {} });
  });

  it('says unavailable when the rules cannot load, and still writes the report', async () => {
    const { module, doc } = generating({ ...zoningWorks, loadOperationRules: async () => { throw new Error('no rules'); } });
    await module.runAnalysis('a', 'x', 'm', {});
    expect(doc().generated).toBe(true);
    expect(doc().operation).toEqual({ state: 'unavailable', elements: {} });
  });

  it('says unavailable when the rows cannot be read', async () => {
    const run = vi.fn(async () => { throw new Error('boom'); });
    const module = new DethernetyThreatReportModule({ session: () => ({ run, close: async () => undefined }) } as never, logger as never) as any;
    module.loadOperationRules = async () => RULES;
    expect(await module.computeOperation('m', GRAPH, {})).toEqual({ state: 'unavailable', elements: {} });
    expect(run).toHaveBeenCalledOnce();
  });
});
