/**
 * createControl sends `controlClasses` only when there are class ids to connect, and `folder` only
 * when there is a folder id: the API rejects a relationship input with no operation in it.
 */
import { describe, it, expect, vi } from 'vitest'
import { DtControl } from '../dt-control.js'

function build() {
  const dt = new DtControl({} as any) as any
  const performMutation = vi.fn().mockResolvedValue({ id: 'ctl-1', controlClasses: [] })
  dt.dtUtils.performMutation = performMutation
  return { dt, input: () => performMutation.mock.calls[0][0].variables.input[0] }
}

describe('DtControl.createControl — controlClasses input', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', []],
  ])('omits controlClasses when the class ids are %s', async (_label, classIds) => {
    const { dt, input } = build()

    await dt.createControl({ newControl: { name: 'ctrl', description: '' }, classIds, folderId: undefined })

    expect(input()).not.toHaveProperty('controlClasses')
  })

  it('omits folder when there is no folder id, and connects it when there is one', async () => {
    const without = build()
    await without.dt.createControl({ newControl: { name: 'ctrl', description: '' }, classIds: null, folderId: undefined })
    expect(without.input()).not.toHaveProperty('folder')

    const withFolder = build()
    await withFolder.dt.createControl({ newControl: { name: 'ctrl', description: '' }, classIds: null, folderId: 'f1' })
    expect(withFolder.input().folder).toEqual({ connect: { where: { node: { id: { eq: 'f1' } } } } })
  })

  it('connects each class id when there are some', async () => {
    const { dt, input } = build()

    await dt.createControl({ newControl: { name: 'ctrl', description: '' }, classIds: ['cc1', 'cc2'], folderId: undefined })

    expect(input().controlClasses).toEqual({
      connect: [
        { where: { node: { id: { eq: 'cc1' } } } },
        { where: { node: { id: { eq: 'cc2' } } } },
      ],
    })
  })
})
