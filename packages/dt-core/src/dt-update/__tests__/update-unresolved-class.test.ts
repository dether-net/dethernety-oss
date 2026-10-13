/**
 * An update resolves each element's class as import does (by id, then module and class name). A class this
 * platform does not have leaves the element's binding and answers as they are, with a warning that names it,
 * rather than failing an update whose other writes have already landed. Every refusal that remains names the
 * element and carries the platform's reason.
 */
import { describe, it, expect, vi } from 'vitest';
import { DtUpdate } from '../dt-update.js';

const catalog = [
  {
    id: 'mod-general',
    name: 'dethernety-general',
    componentClasses: [{ id: 'cls-web', name: 'Web Server' }],
    securityBoundaryClasses: [{ id: 'cls-zone', name: 'Zone' }],
    dataFlowClasses: [{ id: 'cls-https', name: 'HTTPS' }],
    dataClasses: [{ id: 'cls-secret', name: 'Secret' }],
  },
];

const model = () => ({
  name: 'M',
  defaultBoundary: {
    name: 'Root',
    classData: { id: 'cls-zone' },
    boundaries: [
      {
        name: 'DMZ',
        classData: { id: 'cls-zone' },
        components: [
          // An id from another platform, found by module and class name.
          { id: 'c1', name: 'Front', classData: { id: 'cls-web-elsewhere', name: 'Web Server', module: { name: 'dethernety-general' } } },
          // A module this platform does not have.
          { id: 'c2', name: 'Orders DB', classData: { id: 'cls-pg', name: 'PostgreSQL', module: { name: 'example-datastores' } } },
        ],
      },
    ],
    components: [{ id: 'c3', name: 'Unclassed' }, { id: 'c4', name: 'Unassigned', classData: null }],
  },
  dataFlows: [{ id: 'f1', name: 'Front to DB', classData: { id: 'cls-https' } }],
  dataItems: [{ id: 'd1', name: 'Password', classData: { id: 'cls-vault', name: 'Vault Secret', module: { name: 'example-identity' } } }],
});

const setup = (getModules: () => Promise<unknown>) => {
  const dtUpdate = new DtUpdate({} as any) as any;
  dtUpdate.errors = [];
  dtUpdate.warnings = [];
  dtUpdate.dtModule.getModules = vi.fn(getModules);
  return dtUpdate;
};

describe('DtUpdate.resolveClasses — classes resolved as import resolves them', () => {
  it('keeps a class found by id, maps one found by module and name, and drops one this platform does not have', async () => {
    const dtUpdate = setup(async () => catalog);
    dtUpdate.existingComponentIds = new Set(['c1', 'c2']);
    const input = model();

    const out = await dtUpdate.resolveClasses(input);

    expect(out.defaultBoundary.classData).toEqual({ id: 'cls-zone' });
    const [front, db] = out.defaultBoundary.boundaries[0].components;
    expect(front.classData.id).toBe('cls-web');
    expect(db).not.toHaveProperty('classData');
    expect(out.dataFlows[0].classData).toEqual({ id: 'cls-https' });
    expect(out.dataItems[0]).not.toHaveProperty('classData');
    // Absent stays absent; an explicit null (unassign) is kept.
    expect(out.defaultBoundary.components[0]).not.toHaveProperty('classData');
    expect(out.defaultBoundary.components[1].classData).toBeNull();

    // An existing element keeps what it has; a new one is created without a class.
    expect(dtUpdate.warnings).toEqual([
      'Component "Orders DB": Could not resolve component class (id=cls-pg, name=PostgreSQL, module=example-datastores); it keeps its current class binding and answers.',
      'Data item "Password": Could not resolve data class (id=cls-vault, name=Vault Secret, module=example-identity); it is created without a class, and its answers are not written.',
    ]);
    expect(dtUpdate.errors).toEqual([]);
    // The result names each element left as it was, with the class reference the data gave, for the caller's files.
    expect(dtUpdate.unresolvedClasses).toEqual([
      { elementId: 'c2', elementName: 'Orders DB', kind: 'COMPONENT', classData: { id: 'cls-pg', name: 'PostgreSQL', module: { name: 'example-datastores' } } },
      { elementId: 'd1', elementName: 'Password', kind: 'DATA', classData: { id: 'cls-vault', name: 'Vault Secret', module: { name: 'example-identity' } } },
    ]);
    // The caller's data is not changed.
    expect(input.defaultBoundary.boundaries[0].components[1].classData.id).toBe('cls-pg');
    expect(dtUpdate.dtModule.getModules).toHaveBeenCalledTimes(1);
  });

  it('a refused binding of an element with neither name nor id names it plainly, and leaves elementName empty', async () => {
    const dtUpdate = new DtUpdate({} as any) as any;
    dtUpdate.errors = [];
    dtUpdate.dtClass.changeElementBinding = vi.fn().mockResolvedValue({ success: false, errorCode: 'CLASS_NOT_FOUND', errorMessage: null });
    await dtUpdate.changeBinding(undefined, { elementId: '', target: { kind: 'CLASS', classIds: ['cls-x'] } });
    expect(dtUpdate.errors).toEqual([
      expect.objectContaining({ elementName: undefined, error: 'Could not bind an unnamed element to class cls-x (CLASS_NOT_FOUND)' }),
    ]);
  });

  it('names an element with neither name nor id plainly, not as a quoted name', async () => {
    const dtUpdate = setup(async () => catalog);
    await dtUpdate.resolveClasses({ dataFlows: [{ classData: { id: 'cls-x', name: 'X', module: { name: 'nowhere' } } }] });
    expect(dtUpdate.warnings).toEqual([
      'Data flow an unnamed element: Could not resolve data_flow class (id=cls-x, name=X, module=nowhere); it is created without a class, and its answers are not written.',
    ]);
  });

  it('uses the ids as given when the module catalogue cannot be fetched', async () => {
    const dtUpdate = setup(async () => {
      throw new Error('network down');
    });
    const input = model();

    expect(await dtUpdate.resolveClasses(input)).toBe(input);
    expect(dtUpdate.warnings).toEqual([]);
  });
});

describe('DtUpdate — an element whose class is not resolved', () => {
  it('keeps its binding and answers: no binding change, no answer write', async () => {
    const dtUpdate = setup(async () => catalog);
    dtUpdate.currentModelId = 'm1';
    dtUpdate.idMapping = new Map();
    dtUpdate.stats = { created: 0, updated: 0, deleted: 0 };
    dtUpdate.dtComponent.updateComponent = vi.fn().mockResolvedValue({ id: 'c2' });
    dtUpdate.dtClass.changeElementBinding = vi.fn();
    dtUpdate.dtClass.setInstantiationAttributesWithStaleCount = vi.fn();
    const [, db] = (await dtUpdate.resolveClasses(model())).defaultBoundary.boundaries[0].components;

    await dtUpdate.updateComponent({ ...db, type: 'STORE', attributes: { encrypted: true } }, 'b1');
    await Promise.all(dtUpdate.attributeWrites.map((w: () => Promise<void>) => w()));

    expect(dtUpdate.dtClass.changeElementBinding).not.toHaveBeenCalled();
    expect(dtUpdate.dtClass.setInstantiationAttributesWithStaleCount).not.toHaveBeenCalled();
    expect(dtUpdate.errors).toEqual([]);
  });
});

describe('DtUpdate — refusals name the element and the reason', () => {
  const setupBind = (bindResult: object) => {
    const dtUpdate = new DtUpdate({} as any) as any;
    dtUpdate.currentModelId = 'm1';
    dtUpdate.idMapping = new Map();
    dtUpdate.errors = [];
    dtUpdate.warnings = [];
    dtUpdate.stats = { created: 0, updated: 0, deleted: 0 };
    dtUpdate.dtComponent.updateComponent = vi.fn().mockResolvedValue({ id: 'c1' });
    dtUpdate.dtClass.changeElementBinding = vi.fn().mockResolvedValue(bindResult);
    dtUpdate.dtClass.setInstantiationAttributesWithStaleCount = vi.fn().mockResolvedValue({ success: true });
    return dtUpdate;
  };

  it('a refused class binding is an error naming the element, and no answers are written against it', async () => {
    const dtUpdate = setupBind({ success: false, errorCode: 'CLASS_NOT_FOUND', errorMessage: 'Class cls-x not found' });

    await dtUpdate.updateComponent({ id: 'c1', name: 'API', type: 'PROCESS', classData: { id: 'cls-x' } }, 'b1');
    await Promise.all(dtUpdate.attributeWrites.map((w: () => Promise<void>) => w()));

    expect(dtUpdate.errors).toEqual([
      expect.objectContaining({
        step: 'change_element_binding',
        elementName: 'API',
        elementId: 'c1',
        error: 'Could not bind "API" to class cls-x (CLASS_NOT_FOUND): Class cls-x not found',
      }),
    ]);
    expect(dtUpdate.dtClass.setInstantiationAttributesWithStaleCount).not.toHaveBeenCalled();
  });

  it('a bound class still gets its answers written', async () => {
    const dtUpdate = setupBind({ success: true });

    await dtUpdate.updateComponent({ id: 'c1', name: 'API', type: 'PROCESS', classData: { id: 'cls-web' } }, 'b1');
    await Promise.all(dtUpdate.attributeWrites.map((w: () => Promise<void>) => w()));

    expect(dtUpdate.errors).toEqual([]);
    expect(dtUpdate.dtClass.setInstantiationAttributesWithStaleCount).toHaveBeenCalledWith({ componentId: 'c1', classId: 'cls-web', attributes: {} });
  });

  it('names an element without a name by its id, once', async () => {
    const dtUpdate = setupBind({ success: false, errorCode: 'CLASS_NOT_FOUND', errorMessage: 'Class cls-x not found' });

    await dtUpdate.updateComponent({ id: 'c1', type: 'PROCESS', classData: { id: 'cls-x' } }, 'b1');

    expect(dtUpdate.errors).toEqual([
      expect.objectContaining({ elementName: 'c1', error: 'Could not bind "c1" to class cls-x (CLASS_NOT_FOUND): Class cls-x not found' }),
    ]);
  });

  it('a data item whose binding is refused gets no answers written', async () => {
    const dtUpdate = setupBind({});
    dtUpdate.existingDataitemIds = new Set(['d1']);
    dtUpdate.processedDataitemIds = new Set();
    dtUpdate.defaultBoundaryId = 'b0';
    dtUpdate.dtDataitem.updateDataItem = vi.fn().mockResolvedValue({
      residualOk: false,
      bindingResult: { success: false, errorCode: 'CLASS_NOT_FOUND', errorMessage: 'Class cls-gone not found' },
    });

    await dtUpdate.updateDataItems([{ id: 'd1', name: 'Password', classData: { id: 'cls-gone' }, attributes: { rotated: true } }]);
    await Promise.all(dtUpdate.attributeWrites.map((w: () => Promise<void>) => w()));

    expect(dtUpdate.attributeWrites).toEqual([]);
    expect(dtUpdate.dtClass.setInstantiationAttributesWithStaleCount).not.toHaveBeenCalled();
  });

  it('a data item whose binding is refused is named with the reason', async () => {
    const dtUpdate = setupBind({});
    dtUpdate.existingDataitemIds = new Set(['d1']);
    dtUpdate.processedDataitemIds = new Set();
    dtUpdate.defaultBoundaryId = 'b0';
    dtUpdate.dtDataitem.updateDataItem = vi.fn().mockResolvedValue({
      residualOk: false,
      bindingResult: { success: false, errorCode: 'CLASS_NOT_FOUND', errorMessage: 'Class cls-gone not found' },
    });

    await dtUpdate.updateDataItems([{ id: 'd1', name: 'Password', classData: { id: 'cls-gone' } }]);

    expect(dtUpdate.errors).toContainEqual(
      expect.objectContaining({ error: 'Data item "Password" update failed (binding: CLASS_NOT_FOUND: Class cls-gone not found)' }),
    );
  });
});

describe('DtUpdate.updateModel', () => {
  it('resolves the classes after reading the existing model and before it writes anything', async () => {
    const dtUpdate = setup(async () => catalog);
    const order: string[] = [];
    const resolved = vi.spyOn(dtUpdate, 'resolveClasses').mockImplementation(async () => {
      order.push('resolve');
      throw new Error('stop here');
    });
    dtUpdate.fetchExistingModelStructure = vi.fn(async () => {
      order.push('fetch');
      return { name: 'M', modules: [], controls: [] };
    });
    const write = vi.spyOn(dtUpdate, 'updateModelProperties');

    await dtUpdate.updateModel('m1', model());

    expect(resolved).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['fetch', 'resolve']);
    expect(write).not.toHaveBeenCalled();
  });
});
