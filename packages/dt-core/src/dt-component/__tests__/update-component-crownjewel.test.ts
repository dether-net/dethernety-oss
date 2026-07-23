/**
 * Component crown-jewel push input-builder shapes (spy on `performMutation`).
 *
 * The load-bearing case is the NO-CLOBBER guard: dt-import/dt-update issue extra
 * `updateComponent` calls (controls, data-item association) with nodes that do
 * NOT carry crownJewel — those must not reset a flag set at create time. So
 * `updateComponent` sends `crownJewel` only when the node explicitly defines it.
 */

import { describe, it, expect, vi } from 'vitest';
import { DtComponent } from '../dt-component.js';

const makeComponent = () => {
  const dtComponent = new DtComponent({} as any);
  const performMutation = vi.fn().mockResolvedValue({ id: 'c1' });
  (dtComponent as any).dtUtils.performMutation = performMutation;
  return { dtComponent, performMutation };
};

const node = (data: Record<string, unknown>) => ({
  id: 'c1', type: 'STORE', position: { x: 0, y: 0 }, parentNode: '',
  data: { label: 'C', description: '', ...data },
});

describe('DtComponent.updateComponent — crownJewel REPLACE + no-clobber', () => {
  it('sends { set: true } when the node marks it', async () => {
    const { dtComponent, performMutation } = makeComponent();
    await dtComponent.updateComponent({ updatedNode: node({ crownJewel: true }) as any, defaultBoundaryId: 'b0' });
    expect(performMutation.mock.calls[0][0].variables.input.crownJewel).toEqual({ set: true });
  });

  it('sends { set: false } when the node un-marks it (two-way replace)', async () => {
    const { dtComponent, performMutation } = makeComponent();
    await dtComponent.updateComponent({ updatedNode: node({ crownJewel: false }) as any, defaultBoundaryId: 'b0' });
    expect(performMutation.mock.calls[0][0].variables.input.crownJewel).toEqual({ set: false });
  });

  it('omits crownJewel entirely when the node does not define it (NO-CLOBBER)', async () => {
    const { dtComponent, performMutation } = makeComponent();
    await dtComponent.updateComponent({ updatedNode: node({}) as any, defaultBoundaryId: 'b0' });
    expect(performMutation.mock.calls[0][0].variables.input).not.toHaveProperty('crownJewel');
  });
});

describe('DtComponent.createComponentNode — crownJewel on create', () => {
  it('passes crownJewel: true to ADD_COMPONENT when marked', async () => {
    const { dtComponent, performMutation } = makeComponent();
    await dtComponent.createComponentNode({ newNode: node({ crownJewel: true }) as any, classId: 'cc1', defaultBoundaryId: 'b0' });
    expect(performMutation.mock.calls[0][0].variables.crownJewel).toBe(true);
  });

  it('passes crownJewel: undefined when not marked (platform default null)', async () => {
    const { dtComponent, performMutation } = makeComponent();
    await dtComponent.createComponentNode({ newNode: node({}) as any, classId: 'cc1', defaultBoundaryId: 'b0' });
    expect(performMutation.mock.calls[0][0].variables.crownJewel).toBeUndefined();
  });
});

describe('DtComponent.updateComponent — controls / dataItems REPLACE guards (P0)', () => {
  const inputOf = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls[0][0].variables.input;

  it('omits controls and dataItems entirely when absent (preserve — the association passes rely on this)', async () => {
    const { dtComponent, performMutation } = makeComponent();
    await dtComponent.updateComponent({ updatedNode: node({}) as any, defaultBoundaryId: 'b0' });
    const input = inputOf(performMutation);
    expect(input).not.toHaveProperty('controls');
    expect(input).not.toHaveProperty('dataItems');
  });

  it('clears via a bare disconnect-all when present-but-empty ([] = explicit clear)', async () => {
    const { dtComponent, performMutation } = makeComponent();
    await dtComponent.updateComponent({ updatedNode: node({ controls: [], dataItems: [] }) as any, defaultBoundaryId: 'b0' });
    const input = inputOf(performMutation);
    expect(input.controls).toEqual({ disconnect: {}, connect: [] });
    expect(input.dataItems).toEqual({ disconnect: {}, connect: [] });
  });

  it('REPLACEs to the listed set when populated', async () => {
    const { dtComponent, performMutation } = makeComponent();
    await dtComponent.updateComponent({ updatedNode: node({ controls: ['c1'], dataItems: ['d1', 'd2'] }) as any, defaultBoundaryId: 'b0' });
    const input = inputOf(performMutation);
    expect(input.controls.disconnect).toEqual({ where: { NOT: { OR: [{ node: { id: { eq: 'c1' } } }] } } });
    expect(input.controls.connect).toEqual([{ where: { node: { id: { eq: 'c1' } } } }]);
    expect(input.dataItems.disconnect).toEqual({ where: { NOT: { OR: [{ node: { id: { eq: 'd1' } } }, { node: { id: { eq: 'd2' } } }] } } });
  });
});
