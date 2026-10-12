/**
 * Data-item asset-context input-builder shapes (spy on `performMutation`).
 *
 * Update path = REPLACE when the field is supplied: `{ set: ... }`, never `{ push }`. The CLEAR is a
 * supplied `null` or a supplied empty list — it used to be an absence, which made it impossible for a
 * caller to leave the field alone. The full-sync push still clears, by saying so. Sensitivity is
 * validated/uppercased; an unknown value drops to null with a warning. Create path = present-only.
 * Calls omit `classId` so the class-binding branch (DtClass) is skipped and only the residual fires.
 */

import { describe, it, expect, vi } from 'vitest';
import { DtDataItem } from '../dt-dataitem.js';

const makeDataItem = () => {
  const dtDataitem = new DtDataItem({} as any);
  const performMutation = vi.fn().mockResolvedValue({ id: 'd1' });
  (dtDataitem as any).dtUtils.performMutation = performMutation;
  return { dtDataitem, performMutation };
};

describe('DtDataItem.updateDataItem — sensitivity / regulatoryFlags REPLACE', () => {
  it('sets { set: ... } for present values (replace, not append)', async () => {
    const { dtDataitem, performMutation } = makeDataItem();
    await dtDataitem.updateDataItem({
      dataItemId: 'd1', name: 'Cardholder', description: '',
      sensitivity: 'restricted', regulatoryFlags: ['PCI cardholder'],
    });
    expect(performMutation.mock.calls[0][0].variables.input).toMatchObject({
      sensitivity: { set: 'RESTRICTED' },
      regulatoryFlags: { set: ['PCI cardholder'] },
    });
  });

  it('clears to { set: null } / { set: [] } on an EXPLICIT clear, which is what the push sends', async () => {
    const { dtDataitem, performMutation } = makeDataItem();
    await dtDataitem.updateDataItem({
      dataItemId: 'd1', name: 'D', description: '', sensitivity: null, regulatoryFlags: [],
    });
    expect(performMutation.mock.calls[0][0].variables.input).toMatchObject({
      sensitivity: { set: null },
      regulatoryFlags: { set: [] },
    });
  });

  // The half this used to have backwards. An absence is not a clear: it is a caller that is not writing
  // the field, and reading it as a clear is what let an interactive save wipe a classification it had
  // never been asked to touch.
  it('leaves both alone when neither is supplied', async () => {
    const { dtDataitem, performMutation } = makeDataItem();
    await dtDataitem.updateDataItem({ dataItemId: 'd1', name: 'D', description: '' });
    const input = performMutation.mock.calls[0][0].variables.input;
    expect(input).not.toHaveProperty('sensitivity');
    expect(input).not.toHaveProperty('regulatoryFlags');
  });

  it('drops an unknown sensitivity to null with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { dtDataitem, performMutation } = makeDataItem();
    await dtDataitem.updateDataItem({ dataItemId: 'd1', name: 'D', description: '', sensitivity: 'bogus' });
    expect(performMutation.mock.calls[0][0].variables.input.sensitivity).toEqual({ set: null });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('DtDataItem.createDataItem — present-only', () => {
  it('sets sensitivity + regulatoryFlags on the create input when present', async () => {
    const { dtDataitem, performMutation } = makeDataItem();
    await dtDataitem.createDataItem({
      name: 'Cardholder', description: '', elementId: 'b0', classId: null, modelId: 'm1',
      sensitivity: 'restricted', regulatoryFlags: ['PCI cardholder'],
    });
    expect(performMutation.mock.calls[0][0].variables.input[0]).toMatchObject({
      sensitivity: 'RESTRICTED',
      regulatoryFlags: ['PCI cardholder'],
    });
  });

  it('omits both when absent', async () => {
    const { dtDataitem, performMutation } = makeDataItem();
    await dtDataitem.createDataItem({
      name: 'D', description: '', elementId: 'b0', classId: null, modelId: 'm1',
    });
    const input = performMutation.mock.calls[0][0].variables.input[0];
    expect(input).not.toHaveProperty('sensitivity');
    expect(input).not.toHaveProperty('regulatoryFlags');
  });
});

describe('DtDataItem — origin / isCredential', () => {
  it('sets both on update: origin validated and uppercased, isCredential as given', async () => {
    const { dtDataitem, performMutation } = makeDataItem();
    await dtDataitem.updateDataItem({
      dataItemId: 'd1', name: 'Ticket', description: '', origin: 'arbitrary_public', isCredential: false,
    });
    expect(performMutation.mock.calls[0][0].variables.input).toMatchObject({
      origin: { set: 'ARBITRARY_PUBLIC' },
      isCredential: { set: false },
    });
  });

  it('accepts every member of ORIGIN_LEVELS, including not_assessed', async () => {
    const { dtDataitem, performMutation } = makeDataItem();
    await dtDataitem.updateDataItem({ dataItemId: 'd1', origin: 'not_assessed' });
    expect(performMutation.mock.calls[0][0].variables.input.origin).toEqual({ set: 'NOT_ASSESSED' });
  });

  it('clears both on an explicit null, and leaves both alone when neither is supplied', async () => {
    const { dtDataitem, performMutation } = makeDataItem();
    await dtDataitem.updateDataItem({ dataItemId: 'd1', origin: null, isCredential: null });
    expect(performMutation.mock.calls[0][0].variables.input).toMatchObject({
      origin: { set: null },
      isCredential: { set: null },
    });
    await dtDataitem.updateDataItem({ dataItemId: 'd1', name: 'D' });
    const input = performMutation.mock.calls[1][0].variables.input;
    expect(input).not.toHaveProperty('origin');
    expect(input).not.toHaveProperty('isCredential');
  });

  it('drops an unknown origin to null with a warning (the seed spelling is not a local token)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { dtDataitem, performMutation } = makeDataItem();
    await dtDataitem.updateDataItem({ dataItemId: 'd1', origin: 'arbitrary-public' });
    expect(performMutation.mock.calls[0][0].variables.input.origin).toEqual({ set: null });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('sets both on create when present, and omits them when absent', async () => {
    const { dtDataitem, performMutation } = makeDataItem();
    await dtDataitem.createDataItem({
      name: 'Token file', description: '', elementId: 'b0', classId: null, modelId: 'm1',
      origin: 'authenticated_first_party', isCredential: true,
    });
    expect(performMutation.mock.calls[0][0].variables.input[0]).toMatchObject({
      origin: 'AUTHENTICATED_FIRST_PARTY',
      isCredential: true,
    });
    await dtDataitem.createDataItem({ name: 'D', description: '', elementId: 'b0', classId: null, modelId: 'm1' });
    const input = performMutation.mock.calls[1][0].variables.input[0];
    expect(input).not.toHaveProperty('origin');
    expect(input).not.toHaveProperty('isCredential');
  });

  it('keeps an explicit false on create: false is an answer, unlike an absent value', async () => {
    const { dtDataitem, performMutation } = makeDataItem();
    await dtDataitem.createDataItem({
      name: 'D', description: '', elementId: 'b0', classId: null, modelId: 'm1', isCredential: false,
    });
    expect(performMutation.mock.calls[0][0].variables.input[0].isCredential).toBe(false);
  });
});
