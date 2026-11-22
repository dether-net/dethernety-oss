import { describe, expect, it } from 'vitest';
import { ancestorsOf, foldModel } from '../src/fold';
import { smallModelRows } from './fixtures';

describe('foldModel', () => {
  it('folds a small model', () => {
    const m = foldModel(smallModelRows());
    expect([...m.boundaries.keys()].sort()).toEqual(['host', 'seg']);
    expect(m.roots).toEqual(['seg']);
    expect(m.components.get('db')).toMatchObject({ type: 'STORE', crownJewel: true, parents: ['host'] });
    expect(m.flows.get('f1')).toMatchObject({ source: 'web', target: 'db', dataItems: ['cred'] });
    expect(m.dataItems.get('cred')?.isCredential).toBe(true);
    expect(m.controls.get('k1')).toEqual({ id: 'k1', classNames: ['encryption-at-rest'], attributesByClass: { 'encryption-at-rest': {} }, supports: ['db'] });
    expect(m.counts).toMatchObject({ elementsWithoutClass: 0, danglingReferences: 0, boundariesWithSeveralParents: 0 });
  });

  it('keeps an explicit false apart from an absent attribute', () => {
    const m = foldModel(smallModelRows());
    expect(m.boundaries.get('seg')?.attributes).toEqual({ east_west_within_segment_restricted: false });
    expect('east_west_within_segment_restricted' in (m.boundaries.get('host')?.attributes ?? {})).toBe(false);
  });

  it('rebuilds flat attribute keys', () => {
    expect(foldModel(smallModelRows()).components.get('web')?.attributes).toEqual({ tls: { enabled: true } });
  });

  it('reads the exposure lifecycle and techniques', () => {
    const m = foldModel(smallModelRows());
    expect(m.exposures.get('x1')).toMatchObject({ elementKind: 'securityBoundary', lifecycle: 'pending', techniques: ['T1021'] });
    expect(m.exposures.get('x2')).toMatchObject({ elementKind: 'component', lifecycle: 'confirmed', techniques: ['T1078', 'T1210'] });
    expect(m.exposures.get('x3')?.lifecycle).toBe('disposed');
  });

  it('leaves out and counts an element with no class or several, but keeps such a boundary in the forest', () => {
    const rows = smallModelRows();
    rows.instances = rows.instances.filter((r) => r.elementId !== 'web' && r.elementId !== 'host');
    rows.instances.push({ elementId: 'db', kind: 'component', classId: 'c-other', className: 'Other', classCategory: 'Data', attributes: {} });
    const m = foldModel(rows);
    expect(m.components.has('web')).toBe(false);
    expect(m.components.has('db')).toBe(false);
    expect(m.boundaries.get('host')?.cls).toBeNull();
    expect(m.counts.elementsWithoutClass).toBe(2);
    expect(m.counts.elementsWithSeveralClasses).toBe(1);
    // the flow lost both ends
    expect(m.flows.size).toBe(0);
    expect(m.counts.danglingReferences).toBeGreaterThan(0);
  });

  it('drops and counts references it cannot resolve', () => {
    const rows = smallModelRows({
      componentEdges: [...smallModelRows().componentEdges, { id: 'ghost', parentId: 'nowhere', type: 'PROCESS' }],
      flowData: [{ flowId: 'f1', dataId: 'cred' }, { flowId: 'f1', dataId: 'missing' }],
      exposures: [...smallModelRows().exposures, { elementId: 'gone', id: 'x9', category: null }],
    });
    const m = foldModel(rows);
    expect(m.components.has('ghost')).toBe(false);
    expect(m.flows.get('f1')?.dataItems).toEqual(['cred']);
    expect(m.exposures.has('x9')).toBe(false);
    expect(m.counts.danglingReferences).toBe(3);
  });

  it('reads two relations to one class as one only when their attributes agree, whatever their order', () => {
    const rows = smallModelRows();
    const web = rows.instances.find((r) => r.elementId === 'web')!;
    rows.instances.push({ ...web, attributes: { 'tls.enabled': true } });
    expect(foldModel(rows).components.has('web')).toBe(true);
    rows.instances.push({ ...web, attributes: { 'tls.enabled': false } });
    const m = foldModel(rows);
    expect(m.components.has('web')).toBe(false);
    expect(m.counts.elementsWithSeveralClasses).toBe(1);
  });

  it('reads any disposition kind present, even malformed, as disposed', () => {
    const rows = smallModelRows();
    rows.exposures[0] = { ...rows.exposures[0], dispositionKind: '' };
    rows.exposures[1] = { ...rows.exposures[1], dispositionKind: 42, dispositionedBy: null };
    const m = foldModel(rows);
    expect(m.exposures.get('x1')?.lifecycle).toBe('disposed');
    expect(m.exposures.get('x2')?.lifecycle).toBe('disposed');
  });

  it('reads a risk acceptance as confirmed and a compensating control as pending: the weakness is still there', () => {
    const rows = smallModelRows();
    rows.exposures[0] = { ...rows.exposures[0], dispositionKind: 'RISK_ACCEPTED', dispositionedBy: 'someone' };
    rows.exposures[1] = { ...rows.exposures[1], dispositionKind: 'COMPENSATING_CONTROL', dispositionedBy: 'someone' };
    const m = foldModel(rows);
    expect(m.exposures.get('x1')?.lifecycle).toBe('confirmed');
    expect(m.exposures.get('x2')?.lifecycle).toBe('pending');
  });

  it('treats wrong-typed values as absent', () => {
    const rows = smallModelRows({ dataItems: [{ id: 'cred', isCredential: 'yes' }] });
    rows.componentEdges = [{ id: 'web', parentId: 'host', type: 'SERVER' }, ...rows.componentEdges.filter((r) => r.id !== 'web')];
    const m = foldModel(rows);
    expect(m.dataItems.get('cred')?.isCredential).toBeNull();
    expect(m.components.has('web')).toBe(false);
  });

  it('counts a flow with several ends and an exposure on several elements', () => {
    const rows = smallModelRows({
      flows: [{ id: 'f1', sourceId: 'web', targetId: 'db' }, { id: 'f1', sourceId: 'db', targetId: 'web' }],
      exposures: [{ elementId: 'web', id: 'x2' }, { elementId: 'db', id: 'x2' }],
    });
    const m = foldModel(rows);
    expect(m.counts.flowsWithSeveralEnds).toBe(1);
    expect(m.counts.exposuresOnSeveralElements).toBe(1);
  });
});

describe('ancestorsOf', () => {
  it('walks up nearest first', () => {
    const m = foldModel(smallModelRows());
    expect(ancestorsOf(m, 'web')).toEqual(['host', 'seg']);
    expect(ancestorsOf(m, 'host')).toEqual(['seg']);
    expect(ancestorsOf(m, 'seg')).toEqual([]);
  });

  it('ends on a DAG and on a cycle, and counts boundaries with several parents', () => {
    const rows = smallModelRows({
      rootBoundaries: [{ id: 'seg' }, { id: 'seg2' }],
      boundaryEdges: [
        { id: 'host', parentId: 'seg' },
        { id: 'host', parentId: 'seg2' },
        { id: 'seg', parentId: 'host' },
      ],
    });
    rows.instances.push({ elementId: 'seg2', kind: 'securityBoundary', classId: 'c-seg', className: 'Network Segment', classCategory: 'Network', attributes: {} });
    const m = foldModel(rows);
    expect(m.counts.boundariesWithSeveralParents).toBe(1);
    expect(ancestorsOf(m, 'web').sort()).toEqual(['host', 'seg', 'seg2']);
    expect(ancestorsOf(m, 'seg')).toEqual(['host', 'seg2']);
  });

  it('answers nothing for an unknown id', () => {
    expect(ancestorsOf(foldModel(smallModelRows()), 'nope')).toEqual([]);
  });
});
