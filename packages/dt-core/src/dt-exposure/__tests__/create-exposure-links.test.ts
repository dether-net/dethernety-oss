/**
 * createExposure connects its ATT&CK techniques from attackTechniqueLinks when given (with each
 * edge's justification), and from attackTechniqueIds otherwise; neither is required.
 */
import { describe, it, expect, vi } from 'vitest'
import { DtExposure } from '../dt-exposure.js'

const EXPOSURE = { name: 'X', description: '', category: 'C', score: 1 }

function build() {
  const dt = new DtExposure({} as any) as any
  const performMutation = vi.fn().mockResolvedValue({ id: 'exp-1' })
  dt.dtUtils.performMutation = performMutation
  return { dt, input: () => performMutation.mock.calls[0][0].variables.input }
}

describe('DtExposure.createExposure — technique links', () => {
  it('connects the links with their justification when no id list is given', async () => {
    const { dt, input } = build()

    await dt.createExposure({
      exposure: EXPOSURE,
      elementId: 'el-1',
      attackTechniqueLinks: [{ id: 'tech-1', justification: 'why' }, { id: 'tech-2' }],
    })

    expect(input().exploitedBy.connect).toEqual([
      { where: { node: { id: { eq: 'tech-1' } } }, edge: { justification: 'why' } },
      { where: { node: { id: { eq: 'tech-2' } } } },
    ])
  })

  it('connects the id list when no links are given', async () => {
    const { dt, input } = build()

    await dt.createExposure({ exposure: EXPOSURE, elementId: 'el-1', attackTechniqueIds: ['tech-1'] })

    expect(input().exploitedBy.connect).toEqual([{ where: { node: { id: { eq: 'tech-1' } } } }])
  })

  it('connects nothing when neither is given', async () => {
    const { dt, input } = build()

    await dt.createExposure({ exposure: EXPOSURE, elementId: 'el-1' })

    expect(input().exploitedBy.connect).toEqual([])
  })
})
