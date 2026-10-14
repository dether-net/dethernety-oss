/**
 * An update attaches controls the way import does: by id or by an unambiguous name, never by a partial name. Each
 * reference it could not attach is reported in the result, with the model or element it came from, as well as in a
 * warning, and the update carries on. A name several controls share never removes a control the element already has.
 */
import { describe, it, expect, vi } from 'vitest'
import { DtUpdate } from '../dt-update.js'

const catalog = [
  { id: 'c-enc', name: 'Encryption' },
  { id: 'c-pfw', name: 'Perimeter Firewall' },
  { id: 'c-waf', name: 'Web Application Firewall' },
  { id: 'c-log-a', name: 'Audit Logging' },
  { id: 'c-log-b', name: 'Audit Logging' },
]

const setup = () => {
  const dtUpdate = new DtUpdate({} as any) as any
  dtUpdate.dtControl.getControls = vi.fn(async () => catalog)
  dtUpdate.dtModel.updateModel = vi.fn(async () => ({ id: 'm1' }))
  dtUpdate.dtModel.getModel = vi.fn(async () => ({ id: 'm1', name: 'M' }))
  dtUpdate.fetchExistingModelStructure = vi.fn(async () => ({ name: 'M', modules: [], controls: [] }))
  dtUpdate.resolveClasses = vi.fn(async (data: unknown) => data)
  for (const m of ['updateDataItems', 'updateDefaultBoundary', 'updateBoundariesRecursive', 'updateComponents',
    'associateConduitsWithBoundaries', 'updateDataFlows', 'deleteOrphanedElements']) {
    dtUpdate[m] = vi.fn().mockResolvedValue(undefined)
  }
  return dtUpdate
}

describe('DtUpdate — model controls', () => {
  it('attaches exact names only, and reports partial and ambiguous names in the result', async () => {
    const dtUpdate = setup()

    const result = await dtUpdate.updateModel('m1', {
      name: 'M',
      defaultBoundary: { id: 'b0' },
      controls: [
        { name: 'ENCRYPTION' },
        { name: 'Encryption at rest for S3 buckets' },
        { name: 'Firewall' },
        { name: 'Audit Logging' },
      ],
    })

    expect(dtUpdate.dtModel.updateModel).toHaveBeenCalledTimes(1)
    expect(dtUpdate.dtModel.updateModel.mock.calls[0][0].controls).toEqual(['c-enc'])
    const owner = { kind: 'MODEL', name: 'M' }
    expect(result.unresolvedControls).toEqual([
      { name: 'Encryption at rest for S3 buckets', reason: 'not_found', owner },
      { name: 'Firewall', reason: 'not_found', owner },
      {
        name: 'Audit Logging',
        reason: 'ambiguous',
        candidates: [{ id: 'c-log-a', name: 'Audit Logging' }, { id: 'c-log-b', name: 'Audit Logging' }],
        owner,
      },
    ])
    expect(result.warnings).toEqual([
      'Could not resolve control: Encryption at rest for S3 buckets, on model "M"',
      'Could not resolve control: Firewall, on model "M"',
      'Could not resolve control: Audit Logging (2 controls match that name: c-log-a, c-log-b), on model "M"',
    ])
    expect(result.errors).toEqual([])
    expect(result.success).toBe(true)
  })

  it('resolves later control lists in the same run (as the boundary paths do) on the same catalogue fetch', async () => {
    const dtUpdate = setup()
    dtUpdate.errors = []
    dtUpdate.warnings = []

    const owner = { kind: 'BOUNDARY', id: 'b1', name: 'B' }
    expect(await dtUpdate.resolveControls([{ name: 'perimeter firewall' }, { name: 'Firewall' }], owner)).toEqual(['c-pfw'])
    expect(await dtUpdate.resolveControls([{ id: 'c-waf' }], owner)).toEqual(['c-waf'])
    expect(dtUpdate.unresolvedControls).toEqual([{ name: 'Firewall', reason: 'not_found', owner }])
    expect(dtUpdate.dtControl.getControls).toHaveBeenCalledTimes(2)
  })
})

describe('DtUpdate — an ambiguous control name never removes a control', () => {
  it('keeps the model control the name matches, and reports nothing unresolved', async () => {
    const dtUpdate = setup()
    dtUpdate.fetchExistingModelStructure = vi.fn(async () => ({ name: 'M', modules: [], controls: [{ id: 'c-log-b', name: 'Audit Logging' }] }))

    const result = await dtUpdate.updateModel('m1', {
      name: 'M',
      defaultBoundary: { id: 'b0' },
      controls: [{ name: 'Audit Logging' }, { name: 'Encryption' }],
    })

    expect(dtUpdate.dtModel.updateModel.mock.calls[0][0].controls).toEqual(['c-enc', 'c-log-b'])
    expect(result.unresolvedControls).toEqual([])
    expect(result.warnings).toEqual([
      'Control Audit Logging (2 controls match that name: c-log-a, c-log-b), on model "M": kept c-log-b, which it already had',
    ])
    expect(result.success).toBe(true)
  })

  // Each existing element holds one candidate of the shared name; the fetched model data says which.
  const withExistingModel = async () => {
    const dtUpdate = new DtUpdate({} as any) as any
    dtUpdate.dtControl.getControls = vi.fn(async () => catalog)
    dtUpdate.currentModelId = 'm1'
    const attached = [{ id: 'c-log-a', name: 'Audit Logging' }]
    dtUpdate.dtModel.getModelData = vi.fn(async () => ({
      id: 'm1',
      defaultBoundary: {
        id: 'b-server',
        controls: [{ id: 'c-log-b', name: 'Audit Logging' }],
        allDescendantComponents: [{ id: 'comp1', controls: attached }],
        allDescendantBoundaries: [{ id: 'b1', controls: attached }],
        allDescendantDataFlows: [{ id: 'f1', controls: attached }],
      },
    }))
    dtUpdate.dtComponent.updateComponent = vi.fn().mockResolvedValue(undefined)
    dtUpdate.dtBoundary.updateBoundaryNode = vi.fn().mockResolvedValue(undefined)
    dtUpdate.dtDataflow.updateDataFlow = vi.fn().mockResolvedValue(undefined)
    await dtUpdate.fetchExistingModelStructure()
    return dtUpdate
  }
  const shared = [{ name: 'Audit Logging' }]

  it('keeps an attached control on an existing component through the REPLACE write', async () => {
    const dtUpdate = await withExistingModel()
    await dtUpdate.updateComponent({ id: 'comp1', name: 'API', type: 'PROCESS', controls: shared }, 'b0')
    expect(dtUpdate.dtComponent.updateComponent.mock.calls[0][0].updatedNode.data.controls).toEqual(['c-log-a'])
    expect(dtUpdate.unresolvedControls).toEqual([])
  })

  it('keeps it on the default boundary, whose id in the file may differ from the platform one', async () => {
    const dtUpdate = await withExistingModel()
    await dtUpdate.updateDefaultBoundary({ id: 'b-local', name: 'System', controls: shared })
    expect(dtUpdate.dtBoundary.updateBoundaryNode.mock.calls[0][0].updatedNode.data.controls).toEqual(['c-log-b'])
    expect(dtUpdate.unresolvedControls).toEqual([])
  })

  it('keeps it on an existing nested boundary and an existing data flow', async () => {
    const dtUpdate = await withExistingModel()
    await dtUpdate.updateBoundary({ id: 'b1', name: 'DMZ', controls: shared }, 'b-server')
    await dtUpdate.updateDataFlow({ id: 'f1', name: 'Sync', controls: shared }, 'comp1', 'comp1')
    expect(dtUpdate.dtBoundary.updateBoundaryNode.mock.calls[0][0].updatedNode.data.controls).toEqual(['c-log-a'])
    expect(dtUpdate.dtDataflow.updateDataFlow.mock.calls[0][0].edge.data.controls).toEqual(['c-log-a'])
    expect(dtUpdate.unresolvedControls).toEqual([])
  })

  it('still reports an ambiguous name when the element has none of its candidates, and says which element', async () => {
    const dtUpdate = new DtUpdate({} as any) as any
    dtUpdate.dtControl.getControls = vi.fn(async () => catalog)
    dtUpdate.dtComponent.updateComponent = vi.fn().mockResolvedValue(undefined)
    dtUpdate.attachedControlIds = new Map([['comp1', ['c-enc']]])

    await dtUpdate.updateComponent({ id: 'comp1', name: 'API', type: 'PROCESS', controls: [{ name: 'Audit Logging' }] }, 'b0')

    expect(dtUpdate.dtComponent.updateComponent.mock.calls[0][0].updatedNode.data.controls).toEqual([])
    expect(dtUpdate.unresolvedControls).toEqual([
      {
        name: 'Audit Logging',
        reason: 'ambiguous',
        candidates: [{ id: 'c-log-a', name: 'Audit Logging' }, { id: 'c-log-b', name: 'Audit Logging' }],
        owner: { kind: 'COMPONENT', id: 'comp1', name: 'API' },
      },
    ])
  })
})
