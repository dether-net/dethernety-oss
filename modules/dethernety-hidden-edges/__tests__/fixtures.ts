import { readFileSync } from 'node:fs';
import path from 'node:path';
import { READS, type ModelRows, type Row } from '../src/reads';
import { EDGE_KINDS } from '../src/table';

/** A small model's read rows: a segment with a host inside, three components on the host, one flow carrying a credential. */
export function smallModelRows(over: Partial<ModelRows> = {}): ModelRows {
  const inst = (kind: string, elementId: string, classId: string, className: string, classCategory: string, attributes: Row = {}): Row => ({
    elementId, kind, classId, className, classCategory, attributes,
  });
  return {
    rootBoundaries: [{ id: 'seg' }],
    boundaryEdges: [{ id: 'host', parentId: 'seg' }],
    boundaryDepthCut: false,
    componentEdges: [
      { id: 'web', parentId: 'host', type: 'PROCESS', crownJewel: null },
      { id: 'db', parentId: 'host', type: 'STORE', crownJewel: true },
      // a second process, so the flat segment has a starting point besides the web server
      { id: 'app', parentId: 'host', type: 'PROCESS', crownJewel: null },
    ],
    flows: [{ id: 'f1', sourceId: 'web', targetId: 'db' }],
    flowData: [{ flowId: 'f1', dataId: 'cred' }],
    dataItems: [{ id: 'cred', isCredential: true }],
    instances: [
      inst('securityBoundary', 'seg', 'c-seg', 'Network Segment', 'Network', { east_west_within_segment_restricted: false }),
      inst('securityBoundary', 'host', 'c-host', 'Operating System Host', 'Compute', {}),
      inst('component', 'web', 'c-web', 'Web Server', 'Application', { 'tls.enabled': true }),
      inst('component', 'db', 'c-db', 'Relational Database', 'Data'),
      inst('component', 'app', 'c-app', 'Application Service', 'Application'),
      inst('dataFlow', 'f1', 'c-q', 'Database Query', 'Data'),
      inst('data', 'cred', 'c-cred', 'User Credentials', 'Identity'),
    ],
    exposures: [
      { elementId: 'seg', id: 'x1', category: '', dispositionKind: null, dispositionedBy: null, createdBy: 'SYSTEM' },
      { elementId: 'web', id: 'x2', category: '', dispositionKind: 'AFFIRMED', dispositionedBy: 'someone', createdBy: 'SYSTEM' },
      { elementId: 'db', id: 'x3', category: '', dispositionKind: 'FALSE_POSITIVE', dispositionedBy: 'someone', createdBy: 'SYSTEM' },
    ],
    exposureTechniques: [
      { exposureId: 'x1', techniqueId: 'T1021' },
      { exposureId: 'x2', techniqueId: 'T1210' },
      { exposureId: 'x2', techniqueId: 'T1078' },
    ],
    supports: [{ controlId: 'k1', elementId: 'db' }],
    controlClasses: [{ controlId: 'k1', className: 'encryption-at-rest', attributes: {} }],
    ...over,
  };
}

export const SECRET = 'SECRET-CANARY-7f3a';
type ReadName = keyof typeof READS;

interface FakeOptions {
  throwOn?: ReadName;
  throwError?: unknown;
  missing?: boolean;
  rows?: Partial<Record<ReadName, Row[]>>;
  /** A read that waits until the returned `release` is called. */
  hangOn?: ReadName;
  closeThrows?: boolean;
}

/** Answers each declared read from a small model's rows; anything else is a fault. */
export function fakeDriver(over: FakeOptions = {}) {
  const m = smallModelRows();
  const of = (kind: string, rows: Row[]) => rows.filter((r) => r.kind === kind);
  const elementsIn = (rows: Row[], ids: string[]) => rows.filter((r) => ids.includes(r.elementId as string));
  const base: Record<ReadName, Row[]> = {
    modelExists: over.missing ? [] : [{ id: 'm' }],
    rootBoundaries: m.rootBoundaries,
    childBoundaries: m.boundaryEdges,
    componentEdges: m.componentEdges,
    flows: m.flows,
    flowData: m.flowData,
    dataItems: m.dataItems,
    instancesBoundaries: of('securityBoundary', m.instances),
    instancesComponents: of('component', m.instances),
    instancesFlows: of('dataFlow', m.instances),
    instancesData: of('data', m.instances),
    exposuresBoundaries: elementsIn(m.exposures, ['seg', 'host']),
    exposuresComponents: elementsIn(m.exposures, ['web', 'db']),
    exposuresFlows: [],
    exposuresData: [],
    exposureTechniques: m.exposureTechniques,
    supportsBoundaries: [],
    supportsComponents: m.supports,
    supportsFlows: [],
    supportsData: [],
    controlClasses: m.controlClasses,
    ...over.rows,
  };
  const byText = new Map(Object.entries(READS).map(([k, v]) => [v, k as ReadName]));
  const sessions: Array<{ config: any; closed: boolean; txConfig?: any }> = [];
  let releaseHang: () => void = () => undefined;
  const hang = new Promise<void>((resolve) => (releaseHang = resolve));
  const driver = {
    session(config: any) {
      const s = { config, closed: false, txConfig: undefined as any };
      sessions.push(s);
      return {
        executeRead: async (work: (tx: any) => Promise<unknown>, txConfig: any) => {
          s.txConfig = txConfig;
          return work({
            run: async (cypher: string) => {
              const name = byText.get(cypher);
              if (!name) throw new Error(`unexpected Cypher with ${SECRET}`);
              if (name === over.hangOn) await hang;
              if (name === over.throwOn) throw over.throwError ?? new Error(`driver failure for ${SECRET}`);
              return { records: base[name].map((r) => ({ toObject: () => r })) };
            },
          });
        },
        close: async () => {
          s.closed = true;
          if (over.closeThrows) throw new Error(`close failed for ${SECRET}`);
        },
      };
    },
  };
  return { driver, sessions, release: () => releaseHang() };
}

/** Each kind's class as its class file holds it. */
export function classFiles(): Record<string, { id: string; name: string }> {
  const dir = path.resolve(__dirname, '..', 'data', 'dethernety-hidden-edges', 'dataFlow');
  return Object.fromEntries(
    EDGE_KINDS.map((kind) => {
      const { id, name } = JSON.parse(readFileSync(path.join(dir, kind, 'class.json'), 'utf8'));
      return [kind, { id, name }];
    }),
  );
}
