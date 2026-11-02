/**
 * Import applies a data item's controls when it creates the item, resolved against the catalogue by id or by an
 * unambiguous name like every other control reference, and reports one it cannot attach with the item it came from.
 */
import { describe, it, expect, vi } from 'vitest'
import { DtImport } from '../dt-import.js'

const catalog = [
  { id: 'c-enc', name: 'Field encryption' },
  { id: 'c-tok', name: 'Tokenisation' },
]

const setup = () => {
  const dtImport = new DtImport({} as any) as any
  dtImport.dtControl.getControls = vi.fn(async () => catalog)
  dtImport.dtDataitem.createDataItem = vi.fn(async (args: { name: string }) => ({ id: `new-${args.name}` }))
  return dtImport
}

describe('DtImport — data item controls', () => {
  it('creates each item with its resolved controls, and none for an item that lists none', async () => {
    const dtImport = setup()

    await dtImport.createDataItems(
      [
        { id: 'd1', name: 'Cards', controls: [{ id: 'c-tok' }, { name: 'field encryption' }] },
        { id: 'd2', name: 'Logs' },
      ],
      'M1',
      {},
    )

    const calls = dtImport.dtDataitem.createDataItem.mock.calls.map((c: any[]) => c[0])
    expect(calls[0].controls).toEqual(['c-tok', 'c-enc'])
    expect(calls[1].controls).toEqual([])
    expect(dtImport.dtControl.getControls).toHaveBeenCalled()
  })

  it('reports a control it cannot find, on the data item, and still creates the item', async () => {
    const dtImport = setup()

    await dtImport.createDataItems([{ id: 'd1', name: 'Cards', controls: [{ name: 'Masking' }] }], 'M1', {})

    expect(dtImport.dtDataitem.createDataItem.mock.calls[0][0].controls).toEqual([])
    expect(dtImport.unresolvedControls).toEqual([
      { name: 'Masking', reason: 'not_found', owner: { kind: 'DATA', id: 'd1', name: 'Cards' } },
    ])
    expect(dtImport.warnings).toContain('Could not find control: Masking, on data item "Cards"')
  })
})
