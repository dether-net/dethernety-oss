/**
 * Model-scope push input-builder shapes (no live Apollo — the `performMutation`
 * seam is replaced with a spy and we assert the captured `variables`).
 *
 * Update path = REPLACE (local authoritative): a supplied scope sets all five
 * flat platform fields, clearing the ones absent within the scope; an omitted
 * scope emits no scope keys (platform untouched). Create path = present-only.
 */

import { describe, it, expect, vi } from 'vitest';
import { DtModel } from '../dt-model.js';

const makeModel = () => {
  const dtModel = new DtModel({} as any);
  const performMutation = vi.fn().mockResolvedValue({
    updateModels: { models: [{ id: 'm1' }] },
    createModels: { models: [{ id: 'm1' }] },
  });
  (dtModel as any).dtUtils.performMutation = performMutation;
  return { dtModel, performMutation };
};

const inputOf = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls[0][0].variables.input;

describe('DtModel.updateModel — scope REPLACE', () => {
  it('sets present fields and clears absent-within-scope (null / [])', async () => {
    const { dtModel, performMutation } = makeModel();
    await dtModel.updateModel({
      id: 'm1', name: 'M', description: '', modules: [], controls: [], folderId: undefined,
      scope: { depth: 'design', compliance_drivers: ['PCI cardholder'] },
    });
    expect(inputOf(performMutation)).toMatchObject({
      depth: { set: 'DESIGN' },
      modelingIntent: { set: null },
      complianceDrivers: { set: ['PCI cardholder'] },
      exclusions: { set: [] },
      trustAssumptions: { set: [] },
    });
  });

  it('emits NO scope keys when scope is omitted (platform untouched)', async () => {
    const { dtModel, performMutation } = makeModel();
    await dtModel.updateModel({
      id: 'm1', name: 'M', description: '', modules: [], controls: [], folderId: undefined,
    });
    const input = inputOf(performMutation);
    expect(input).not.toHaveProperty('depth');
    expect(input).not.toHaveProperty('complianceDrivers');
    expect(input).not.toHaveProperty('trustAssumptions');
  });

  it('emits NO scope keys when scope has only unknown values (no blanket wipe)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { dtModel, performMutation } = makeModel();
    await dtModel.updateModel({
      id: 'm1', name: 'M', description: '', modules: [], controls: [], folderId: undefined,
      scope: { depth: 'bogus' },
    });
    expect(inputOf(performMutation)).not.toHaveProperty('depth');
    warn.mockRestore();
  });
});

describe('DtModel.createModel — scope present-only', () => {
  it('sets present flat fields, no { set }, omits absent', async () => {
    const { dtModel, performMutation } = makeModel();
    await dtModel.createModel({
      name: 'M', description: '', modules: [], folderId: undefined,
      scope: { depth: 'architecture', modeling_intent: 'security_review' },
    });
    // createModel sends variables.input as an array of ModelCreateInput.
    const input = performMutation.mock.calls[0][0].variables.input[0];
    expect(input).toMatchObject({ depth: 'ARCHITECTURE', modelingIntent: 'SECURITY_REVIEW' });
    expect(input).not.toHaveProperty('complianceDrivers');
  });
});
