import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_BYTES_MAX, CAPS, Deadline, DeadlineExceeded, ReadOverCap } from '../src/bounds';
import { MAX_BOUNDARY_DEPTH, READS, readModel, Row, Run } from '../src/reads';

type Answer = (params: Record<string, unknown>) => Row[];

/** A fake read runner: answers each read by its text, and records the calls. */
function fakeRun(answers: Partial<Record<keyof typeof READS, Answer>>): { run: Run; calls: Array<keyof typeof READS> } {
  const calls: Array<keyof typeof READS> = [];
  const byText = new Map(Object.entries(READS).map(([name, text]) => [text, name as keyof typeof READS]));
  const run: Run = async (cypher, params) => {
    const name = byText.get(cypher);
    if (!name) throw new Error('a read the module does not declare');
    calls.push(name);
    return (answers[name] ?? (() => []))(params);
  };
  return { run, calls };
}

const exists: Answer = () => [{ id: 'm' }];
const forest = (edges: Array<[string, string]>, roots: string[]) => ({
  modelExists: exists,
  rootBoundaries: () => roots.map((id) => ({ id })),
  childBoundaries: (p: Record<string, unknown>) => edges.filter(([, parent]) => (p.parentIds as string[]).includes(parent)).map(([id, parentId]) => ({ id, parentId })),
});

describe('readModel', () => {
  it('answers null for a model that does not exist, reading nothing else', async () => {
    const { run, calls } = fakeRun({});
    expect(await readModel(run, 'm', new Deadline())).toBeNull();
    expect(calls).toEqual(['modelExists']);
  });

  it('reads every fact type once after the forest, in a fixed order', async () => {
    const { run, calls } = fakeRun(forest([['b', 'a']], ['a']));
    const rows = await readModel(run, 'm', new Deadline());
    expect(rows?.boundaryEdges).toEqual([{ id: 'b', parentId: 'a' }]);
    expect(calls).toEqual([
      'modelExists', 'rootBoundaries', 'childBoundaries', 'childBoundaries',
      'componentEdges', 'flows', 'flowData', 'dataItems',
      'instancesBoundaries', 'instancesComponents', 'instancesFlows', 'instancesData',
      'exposuresBoundaries', 'exposuresComponents', 'exposuresFlows', 'exposuresData', 'exposureTechniques',
      'supportsBoundaries', 'supportsComponents', 'supportsFlows', 'supportsData', 'controlClasses',
    ]);
  });

  it('visits each boundary once on a DAG and on a cycle', async () => {
    const asked: string[][] = [];
    const base = forest([['b', 'a'], ['c', 'a'], ['d', 'b'], ['d', 'c'], ['a', 'd']], ['a']);
    const { run } = fakeRun({ ...base, childBoundaries: (p) => (asked.push([...(p.parentIds as string[])].sort()), base.childBoundaries(p)) });
    const rows = await readModel(run, 'm', new Deadline());
    expect(asked).toEqual([['a'], ['b', 'c'], ['d']]);
    expect(rows?.boundaryDepthCut).toBe(false);
  });

  it(`stops the walk at ${MAX_BOUNDARY_DEPTH} levels and says so only when boundaries are left below`, async () => {
    const deeper: Array<[string, string]> = Array.from({ length: MAX_BOUNDARY_DEPTH + 5 }, (_, i) => [`b${i + 1}`, `b${i}`]);
    expect((await readModel(fakeRun(forest(deeper, ['b0'])).run, 'm', new Deadline()))?.boundaryDepthCut).toBe(true);
    const exact: Array<[string, string]> = Array.from({ length: MAX_BOUNDARY_DEPTH }, (_, i) => [`b${i + 1}`, `b${i}`]);
    expect((await readModel(fakeRun(forest(exact, ['b0'])).run, 'm', new Deadline()))?.boundaryDepthCut).toBe(false);
  });

  it('keeps a running total across the four per-kind reads of one fact type', async () => {
    const half = (k: string) => () => Array.from({ length: Math.floor(CAPS.supports / 2) + 1 }, (_, i) => ({ controlId: `${k}${i}`, elementId: 'x' }));
    const { run } = fakeRun({ ...forest([], ['a']), supportsBoundaries: half('a'), supportsComponents: half('b') });
    await expect(readModel(run, 'm', new Deadline())).rejects.toEqual(new ReadOverCap('supports'));
  });

  it('reads the controls of data items too', async () => {
    const { run } = fakeRun({ ...forest([], ['a']), supportsData: () => [{ controlId: 'k', elementId: 'd' }] });
    expect((await readModel(run, 'm', new Deadline()))?.supports).toEqual([{ controlId: 'k', elementId: 'd' }]);
  });

  it('refuses attribute maps larger than the byte budget', async () => {
    const big = 'x'.repeat(1024 * 1024);
    const rows = () => Array.from({ length: Math.ceil(ATTRIBUTE_BYTES_MAX / big.length) + 1 }, (_, i) => ({ elementId: `c${i}`, kind: 'component', classId: 'k', attributes: { note: big } }));
    const { run } = fakeRun({ ...forest([], ['a']), instancesComponents: rows });
    await expect(readModel(run, 'm', new Deadline())).rejects.toEqual(new ReadOverCap('attributeBytes'));
  });

  it('refuses a read one row over its cap', async () => {
    const many = (n: number) => () => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, sourceId: 'c', targetId: 'd' }));
    const at = fakeRun({ ...forest([], ['a']), flows: many(CAPS.flows) });
    await expect(readModel(at.run, 'm', new Deadline())).resolves.not.toBeNull();
    const over = fakeRun({ ...forest([], ['a']), flows: many(CAPS.flows + 1) });
    await expect(readModel(over.run, 'm', new Deadline())).rejects.toEqual(new ReadOverCap('flows'));
  });

  it('refuses more distinct components than their cap, though the edge read is within its own', async () => {
    const rows = () => Array.from({ length: CAPS.components + 1 }, (_, i) => ({ id: `c${i}`, parentId: 'a', type: 'PROCESS' }));
    const { run } = fakeRun({ ...forest([], ['a']), componentEdges: rows });
    await expect(readModel(run, 'm', new Deadline())).rejects.toEqual(new ReadOverCap('components'));
  });

  it('refuses a forest with more boundaries than its cap, across levels', async () => {
    const half = Math.ceil(CAPS.boundaries / 2) + 1;
    const level1: Array<[string, string]> = Array.from({ length: half }, (_, i) => [`x${i}`, 'a']);
    const level2: Array<[string, string]> = Array.from({ length: half }, (_, i) => [`y${i}`, `x${i}`]);
    const { run } = fakeRun(forest([...level1, ...level2], ['a']));
    await expect(readModel(run, 'm', new Deadline())).rejects.toBeInstanceOf(ReadOverCap);
  });

  it('stops between reads once the deadline has passed', async () => {
    let now = 0;
    const deadline = new Deadline(100, () => now);
    const { run, calls } = fakeRun({ ...forest([], ['a']), componentEdges: () => ((now = 100), []) });
    await expect(readModel(run, 'm', deadline)).rejects.toBeInstanceOf(DeadlineExceeded);
    expect(calls.at(-1)).toBe('componentEdges');
  });
});
