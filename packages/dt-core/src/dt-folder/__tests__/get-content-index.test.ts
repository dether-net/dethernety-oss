/**
 * getContentIndex: every model and control with its id, name and folder id, the folder relation (a list, empty at the
 * root) flattened to the id of its one folder.
 */

import { describe, it, expect, vi } from 'vitest'
import { DtFolder } from '../dt-folder.js'

const withResponse = (data: unknown) => {
  const dtFolder = new DtFolder({} as any) as any
  dtFolder.dtUtils.performQuery = vi.fn().mockResolvedValue(data)
  return dtFolder as DtFolder
}

describe('DtFolder.getContentIndex', () => {
  it('flattens the folder to its id, and leaves it undefined at the root', async () => {
    const dtFolder = withResponse({
      models: [
        { id: 'm1', name: 'Shop', folder: [{ id: 'f1' }] },
        { id: 'm2', name: 'Root model', folder: [] },
        { id: 'm3', name: null, folder: null },
      ],
      controls: [{ id: 'c1', name: 'WAF', folder: [{ id: 'f1' }] }],
    })

    expect(await dtFolder.getContentIndex()).toEqual({
      models: [
        { id: 'm1', name: 'Shop', folderId: 'f1' },
        { id: 'm2', name: 'Root model', folderId: undefined },
        { id: 'm3', name: '', folderId: undefined },
      ],
      controls: [{ id: 'c1', name: 'WAF', folderId: 'f1' }],
    })
  })

  it('returns empty lists when the response has none', async () => {
    expect(await withResponse({}).getContentIndex()).toEqual({ models: [], controls: [] })
  })

  it('lets a failed query reject', async () => {
    const dtFolder = new DtFolder({} as any) as any
    dtFolder.dtUtils.performQuery = vi.fn().mockRejectedValue(new Error('network down'))
    await expect(dtFolder.getContentIndex()).rejects.toThrow('network down')
  })
})
