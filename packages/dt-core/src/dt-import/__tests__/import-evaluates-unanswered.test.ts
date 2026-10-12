/**
 * An imported element bound to a class gets one attribute write even when the file carries no answers for it:
 * the write is what evaluates the class, so skipping it left the element with no exposures. An element without a
 * class gets no write. The writes are queued while elements are created and run together afterwards.
 * Sub-clients are spied; private methods reached via `(instance as any)`.
 */

import { describe, it, expect, vi } from 'vitest';
import { DtImport } from '../dt-import.js';

const setup = () => {
  const dtImport = new DtImport({} as any) as any;
  const write = vi.fn().mockResolvedValue(true);
  dtImport.dtClass.setInstantiationAttributes = write;
  dtImport.setElementControlsDirect = vi.fn().mockResolvedValue(undefined);
  dtImport.resolveClass = vi.fn(async (classData: any) => classData?.id ?? null);
  const flush = () => Promise.all(dtImport.attributeWrites.map((w: () => Promise<void>) => w()));
  return { dtImport, write, flush };
};

describe('DtImport — an element bound to a class is evaluated even with no answers', () => {
  it('component: writes {} for a classed component without attributes', async () => {
    const { dtImport, write, flush } = setup();
    dtImport.dtComponent.createComponentNode = vi.fn().mockResolvedValue({ id: 'c-new' });

    await dtImport.createComponent({ id: 'c1', type: 'PROCESS', name: 'C', classData: { id: 'cls-c' } }, 'b0');
    await flush();

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({ componentId: 'c-new', classId: 'cls-c', attributes: {} });
  });

  it('component: answers present are written as before', async () => {
    const { dtImport, write, flush } = setup();
    dtImport.dtComponent.createComponentNode = vi.fn().mockResolvedValue({ id: 'c-new' });

    await dtImport.createComponent({ id: 'c1', type: 'PROCESS', name: 'C', classData: { id: 'cls-c' }, attributes: { k: true } }, 'b0');
    await flush();

    expect(write).toHaveBeenCalledWith({ componentId: 'c-new', classId: 'cls-c', attributes: { k: true } });
  });

  it('the write is queued at creation and runs only when the queue is flushed', async () => {
    const { dtImport, write, flush } = setup();
    dtImport.dtComponent.createComponentNode = vi.fn().mockResolvedValue({ id: 'c-new' });

    await dtImport.createComponent({ id: 'c1', type: 'PROCESS', name: 'C', classData: { id: 'cls-c' } }, 'b0');
    expect(write).not.toHaveBeenCalled();
    expect(dtImport.attributeWrites).toHaveLength(1);

    await flush();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('component: no class, no write', async () => {
    const { dtImport, write, flush } = setup();
    dtImport.dtComponent.createComponentNode = vi.fn().mockResolvedValue({ id: 'c-new' });

    await dtImport.createComponent({ id: 'c1', type: 'PROCESS', name: 'C' }, 'b0');
    await flush();

    expect(write).not.toHaveBeenCalled();
  });

  it('boundary: writes {} for a classed boundary without attributes', async () => {
    const { dtImport, write, flush } = setup();
    dtImport.dtBoundary.createBoundaryNode = vi.fn().mockResolvedValue({ id: 'b-new' });

    await dtImport.createBoundary({ id: 'b1', name: 'B', classData: { id: 'cls-b' } }, 'b0');
    await flush();

    expect(write).toHaveBeenCalledWith({ componentId: 'b-new', classId: 'cls-b', attributes: {} });
  });

  it('data flow: writes {} for a classed flow without attributes', async () => {
    const { dtImport, write, flush } = setup();
    dtImport.idMapping.set('s', 'S').set('t', 'T');
    dtImport.dtDataflow.createDataFlow = vi.fn().mockResolvedValue({ id: 'f-new' });

    await dtImport.createDataFlows([{ id: 'f1', name: 'F', source: { id: 's' }, target: { id: 't' }, classData: { id: 'cls-f' } }]);
    await flush();

    expect(write).toHaveBeenCalledWith({ componentId: 'f-new', classId: 'cls-f', attributes: {} });
  });

  it('data item: writes {} for a classed item without attributes', async () => {
    const { dtImport, write, flush } = setup();
    dtImport.dtDataitem.createDataItem = vi.fn().mockResolvedValue({ id: 'd-new' });

    await dtImport.createDataItems([{ id: 'd1', name: 'D', classData: { id: 'cls-d' } }], 'm1', {});
    await flush();

    expect(write).toHaveBeenCalledWith({ componentId: 'd-new', classId: 'cls-d', attributes: {} });
  });
});

describe('DtImport — importModel runs the queued attribute writes, four at a time, once every element exists', () => {
  it('runs them all after the data flows and before data items are associated, never more than four in flight', async () => {
    const dtImport = new DtImport({} as any) as any;
    const order: string[] = [];
    let inFlight = 0;
    let peak = 0;
    const queueWrites = async () => {
      for (let i = 0; i < 10; i++) {
        dtImport.attributeWrites.push(async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight--;
          order.push(`write ${i}`);
        });
      }
    };
    dtImport.createModel = vi.fn().mockResolvedValue({ id: 'M1' });
    for (const m of ['setupDefaultBoundary', 'createDataItems', 'processHierarchy', 'processControlAssociations', 'associateConduitsWithBoundaries']) {
      dtImport[m] = vi.fn().mockResolvedValue(undefined);
    }
    dtImport.createDataFlows = vi.fn(queueWrites);
    dtImport.associateDataItemsWithElements = vi.fn(async () => { order.push('associate data items'); });

    const result = await dtImport.importModel({
      name: 'M',
      defaultBoundary: { id: 'b0' },
      dataFlows: [],
      dataItems: [],
    });

    expect(result.success).toBe(true);
    expect(order.filter((o) => o.startsWith('write'))).toHaveLength(10);
    expect(order[order.length - 1]).toBe('associate data items');
    expect(peak).toBe(4);
    expect(dtImport.attributeWrites).toEqual([]);
  });
});
