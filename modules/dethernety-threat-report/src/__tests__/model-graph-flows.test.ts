// The flows of the snapshot's model graph, through the real `computeModelGraph` with its queries answered by a fake
// session: a flow whose class is in the hidden-edge category carries `hiddenEdge`, told by the category alone.
import { describe, expect, it } from 'vitest';

import DethernetyThreatReportModule from '../DethernetyThreatReportModule';

const HIDDEN_EDGE_CATEGORY = 'Hidden Edge';

const logger = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
const record = (row: Record<string, unknown>) => ({ get: (key: string) => row[key] });

const FLOWS = [
  { id: 'f1', name: 'Orders', sourceId: 'c1', targetId: 'c2', sensitivities: [], dataItemCount: 0, className: 'HTTPS', classCategory: 'Data Flow' },
  {
    id: 'h1', name: 'Reused credential', sourceId: 'c2', targetId: 'c3', sensitivities: [], dataItemCount: 0,
    className: 'Hidden Edge: Credential Reuse', classCategory: HIDDEN_EDGE_CATEGORY,
    hiddenEdgeKind: 'credential-reuse', hiddenEdgeTier: 'medium', grantedPrivilege: 'admin',
  },
  // A hidden edge that records nothing about itself is still one.
  { id: 'h2', name: 'Bare edge', sourceId: 'c3', targetId: 'c2', sensitivities: [], dataItemCount: 0, classCategory: HIDDEN_EDGE_CATEGORY, hiddenEdgeTier: '  ' },
  // The class name or the relation facts alone never mark a flow.
  { id: 'f2', name: 'Lookalike', sourceId: 'c1', targetId: 'c3', sensitivities: [], dataItemCount: 0, className: 'Hidden Edge: Remote Service', classCategory: null, hiddenEdgeKind: 'remote-service' },
  { id: 'f3', name: 'Unclassified', sourceId: 'c3', targetId: 'c1', sensitivities: [], dataItemCount: 0 },
];

function moduleWithFlows(flows: unknown[]) {
  let written: string | undefined;
  const session = {
    run: async (query: string, params: { doc?: string }) => {
      if (params?.doc !== undefined) {
        written = params.doc;
        return { records: [record({ id: 'a' })] };
      }
      if (query.includes('AS flows')) return { records: [record({ flows })] };
      return { records: [] };
    },
    executeWrite: async (work: (tx: unknown) => unknown) => work(session),
    close: async () => undefined,
  };
  const module = new DethernetyThreatReportModule({ session: () => session } as never, logger as never) as any;
  return { module, doc: () => JSON.parse(written ?? '{}') };
}

describe('the model graph flows', () => {
  it('asks for the flow class category beside its name, and the facts on the class relation', async () => {
    const queries: string[] = [];
    const session = {
      run: async (query: string) => {
        queries.push(query);
        return { records: [] };
      },
      close: async () => undefined,
    };
    const module = new DethernetyThreatReportModule({ session: () => session } as never, logger as never) as any;
    await module.computeModelGraph('m');
    const flowsQuery = queries.find((q) => q.includes('AS flows'));
    expect(flowsQuery).toContain('classCategory: cls[2]');
    expect(flowsQuery).toContain('fi.hidden_edge_kind, fi.tier, fi.granted_privilege');
  });

  it('marks a flow whose class is in the hidden-edge category with its facts, and no other', async () => {
    const { module } = moduleWithFlows(FLOWS);
    const graph = await module.computeModelGraph('m');
    expect(graph.flows.map((f: { id: string; hiddenEdge: unknown }) => [f.id, f.hiddenEdge])).toEqual([
      ['f1', null],
      ['h1', { kind: 'credential-reuse', tier: 'medium', grantedPrivilege: 'admin' }],
      ['h2', { kind: null, tier: null, grantedPrivilege: null }],
      ['f2', null],
      ['f3', null],
    ]);
  });

  it('carries the flag into the written snapshot, and the zoning block counts what it set apart', async () => {
    const { module, doc } = moduleWithFlows(FLOWS);
    Object.assign(module, {
      computeStructure: async () => ({ fingerprint: 'f', componentCount: 0, boundaryCount: 0 }),
      computeLedger: async () => [],
      loadZoningEngine: () => import('@dethernety/dt-core/zone-determination'),
      loadOperationRules: async () => ({ operatorOf: () => null, hostingOf: () => null }),
    });
    await module.runAnalysis('a', 'x', 'm', {});
    const flows = doc().modelGraph.flows as Array<{ id: string; hiddenEdge: unknown }>;
    expect(flows.filter((f) => f.hiddenEdge).map((f) => f.id)).toEqual(['h1', 'h2']);
    expect(doc().zoning.hiddenEdgeFlowsSetApart).toBe(2);
  });
});
