/**
 * DtDataflow.updateDataFlow — controls / dataItems REPLACE guards (P0 bug class).
 * The `performMutation` seam is replaced with a spy; we assert the captured
 * `variables.input`. Absent controls/dataItems must OMIT the key (preserve);
 * present `[]` clears via a bare disconnect-all; a populated list REPLACEs.
 */
import { describe, it, expect, vi } from 'vitest'
import { DtDataflow } from '../dt-dataflow.js'

const make = () => {
  const dtDataflow = new DtDataflow({} as any)
  const performMutation = vi.fn().mockResolvedValue({ id: 'f1', source: [], target: [], dataItems: [] })
  ;(dtDataflow as any).dtUtils.performMutation = performMutation
  return { dtDataflow, performMutation }
}

const edge = (data: Record<string, any>) => ({
  id: 'f1',
  source: 's',
  target: 't',
  sourceHandle: null,
  targetHandle: null,
  label: 'F',
  data: { description: '', ...data },
}) as any

const inputOf = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls[0][0].variables.input

describe('DtDataflow.updateDataFlow — controls / dataItems REPLACE guards (P0)', () => {
  it('omits controls and dataItems entirely when absent (preserve)', async () => {
    const { dtDataflow, performMutation } = make()
    await dtDataflow.updateDataFlow({ edge: edge({}), updates: {} })
    const input = inputOf(performMutation)
    expect(input).not.toHaveProperty('controls')
    expect(input).not.toHaveProperty('dataItems')
  })

  it('clears via a bare disconnect-all when present-but-empty ([] = explicit clear)', async () => {
    const { dtDataflow, performMutation } = make()
    await dtDataflow.updateDataFlow({ edge: edge({ controls: [], dataItems: [] }), updates: {} })
    const input = inputOf(performMutation)
    expect(input.controls).toEqual({ disconnect: {}, connect: [] })
    expect(input.dataItems).toEqual({ disconnect: {}, connect: [] })
  })

  it('REPLACEs to the listed set when populated — via an unconditional disconnect-all', async () => {
    const { dtDataflow, performMutation } = make()
    await dtDataflow.updateDataFlow({ edge: edge({ controls: ['c1'], dataItems: ['d1'] }), updates: {} })
    const input = inputOf(performMutation)
    expect(input.controls.disconnect).toEqual({})
    expect(input.controls.connect).toEqual([{ where: { node: { id: { eq: 'c1' } } } }])
    expect(input.dataItems.disconnect).toEqual({})
    expect(input.dataItems.connect).toEqual([{ where: { node: { id: { eq: 'd1' } } } }])
  })

})
