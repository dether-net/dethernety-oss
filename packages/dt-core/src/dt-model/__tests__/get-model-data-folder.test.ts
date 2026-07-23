/**
 * Folder-unlink: DUMP_MODEL_DATA must select `folder`, and getModelData must
 * flatten the array-shaped relationship to a single object — so the update orchestrator
 * can re-pass existingModel.folder?.id and preserve the model's folder instead of
 * unlinking it (`disconnect: {}`) on every push.
 */

import { describe, it, expect, vi } from 'vitest';
import { DtModel } from '../dt-model.js';
import { DUMP_MODEL_DATA } from '../dt-model-gql.js';

describe('DtModel — folder is selected and flattened for the update path', () => {
  it('DUMP_MODEL_DATA selects a folder id', () => {
    // graphql-tag keeps the original source on the document's loc.
    const query = DUMP_MODEL_DATA.loc?.source.body ?? '';
    expect(query).toMatch(/folder\s*{\s*id/);
  });

  it('getModelData flattens the array-shaped folder to a single object', async () => {
    const dtModel = new DtModel({} as any) as any;
    dtModel.dtUtils.performQuery = vi.fn().mockResolvedValue({
      models: [{
        id: 'm1',
        name: 'M',
        folder: [{ id: 'f1' }], // GraphQL returns the relationship as an array
        defaultBoundary: undefined,
        dataItems: [],
      }],
    });

    const result = await dtModel.getModelData({ modelId: 'm1' });

    expect(result.folder).toEqual({ id: 'f1' });
    expect(result.folder?.id).toBe('f1');
  });

  it('getModelData leaves folder untouched when the model has none', async () => {
    const dtModel = new DtModel({} as any) as any;
    dtModel.dtUtils.performQuery = vi.fn().mockResolvedValue({
      models: [{ id: 'm1', name: 'M', folder: [], defaultBoundary: undefined, dataItems: [] }],
    });

    const result = await dtModel.getModelData({ modelId: 'm1' });

    expect(result.folder?.id).toBeUndefined();
  });
});
