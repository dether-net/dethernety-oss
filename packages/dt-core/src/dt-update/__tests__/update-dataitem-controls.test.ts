/**
 * A push writes a data item's controls when the file lists them, and leaves them alone when it does not.
 *
 * An element's absent `controls` key is a clear. A data item's is not: files written before data items carried
 * controls have no key, and pushing one of them must not strip the controls set on the platform since. A present list,
 * including `[]`, replaces the item's controls, so removing a control means writing the list without it.
 */
import { describe, it, expect, vi } from 'vitest'
import { DtUpdate } from '../dt-update.js'

const catalog = [
  { id: 'c-enc', name: 'Field encryption' },
  { id: 'c-tok', name: 'Tokenisation' },
  { id: 'c-log-a', name: 'Audit Logging' },
  { id: 'c-log-b', name: 'Audit Logging' },
]

/** An update run whose model already holds data item d1 with the given controls. */
const withExistingItem = async (attached: { id: string; name: string }[] = []) => {
  const dtUpdate = new DtUpdate({} as any) as any
  dtUpdate.dtControl.getControls = vi.fn(async () => catalog)
  dtUpdate.currentModelId = 'm1'
  dtUpdate.dtModel.getModelData = vi.fn(async () => ({
    id: 'm1',
    defaultBoundary: { id: 'b0', controls: [], allDescendantComponents: [], allDescendantBoundaries: [], allDescendantDataFlows: [] },
    dataItems: [{ id: 'd1', name: 'Cards', controls: attached }],
  }))
  dtUpdate.dtDataitem.updateDataItem = vi.fn(async () => ({ dataItem: { id: 'd1' }, bindingResult: null, residualOk: true }))
  dtUpdate.dtDataitem.createDataItem = vi.fn(async () => ({ id: 'd-new' }))
  await dtUpdate.fetchExistingModelStructure()
  dtUpdate.errors = []
  dtUpdate.warnings = []
  return dtUpdate
}

const sentControls = (dtUpdate: any) => dtUpdate.dtDataitem.updateDataItem.mock.calls[0][0].controls

describe('DtUpdate — data item controls', () => {
  it('leaves the controls alone when the file has no controls key', async () => {
    const dtUpdate = await withExistingItem([{ id: 'c-enc', name: 'Field encryption' }])

    await dtUpdate.updateDataItems([{ id: 'd1', name: 'Cards' }])

    expect(sentControls(dtUpdate)).toBeUndefined()
    expect(dtUpdate.dtControl.getControls).not.toHaveBeenCalled()
  })

  it('replaces them with the resolved list when the file lists them', async () => {
    const dtUpdate = await withExistingItem([{ id: 'c-enc', name: 'Field encryption' }])

    await dtUpdate.updateDataItems([{ id: 'd1', name: 'Cards', controls: [{ id: 'c-tok' }, { name: 'field encryption' }] }])

    expect(sentControls(dtUpdate)).toEqual(['c-tok', 'c-enc'])
  })

  it('clears them on an explicit empty list', async () => {
    const dtUpdate = await withExistingItem([{ id: 'c-enc', name: 'Field encryption' }])

    await dtUpdate.updateDataItems([{ id: 'd1', name: 'Cards', controls: [] }])

    expect(sentControls(dtUpdate)).toEqual([])
  })

  it('keeps the candidate of an ambiguous name the item already has, and reports it with a data item owner', async () => {
    const dtUpdate = await withExistingItem([{ id: 'c-log-b', name: 'Audit Logging' }])

    await dtUpdate.updateDataItems([{ id: 'd1', name: 'Cards', controls: [{ name: 'Audit Logging' }] }])

    expect(sentControls(dtUpdate)).toEqual(['c-log-b'])
    expect(dtUpdate.warnings).toEqual([
      'Control Audit Logging (2 controls match that name: c-log-a, c-log-b), on data item "Cards": kept c-log-b, which it already had',
    ])
  })

  it('reports a control it cannot find, with the data item it came from', async () => {
    const dtUpdate = await withExistingItem()

    await dtUpdate.updateDataItems([{ id: 'd1', name: 'Cards', controls: [{ name: 'Masking' }] }])

    expect(sentControls(dtUpdate)).toEqual([])
    expect(dtUpdate.unresolvedControls).toEqual([
      { name: 'Masking', reason: 'not_found', owner: { kind: 'DATA', id: 'd1', name: 'Cards' } },
    ])
  })

  it('leaves the controls alone when the catalogue cannot be fetched, and says so once', async () => {
    const dtUpdate = await withExistingItem([{ id: 'c-enc', name: 'Field encryption' }])
    dtUpdate.dtControl.getControls = vi.fn(async () => { throw new Error('unreachable') })

    await dtUpdate.updateDataItems([{ id: 'd1', name: 'Cards', controls: [{ id: 'c-tok' }] }])

    expect(sentControls(dtUpdate)).toBeUndefined()
    expect(dtUpdate.errors.map((e: any) => e.step)).toEqual(['resolve_controls'])
  })

  it('applies the listed controls to a data item the push creates', async () => {
    const dtUpdate = await withExistingItem()

    await dtUpdate.updateDataItems([{ id: 'd-local', name: 'Tokens', controls: [{ id: 'c-tok' }] }])

    expect(dtUpdate.dtDataitem.createDataItem.mock.calls[0][0].controls).toEqual(['c-tok'])
  })
})
