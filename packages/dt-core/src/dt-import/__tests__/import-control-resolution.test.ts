/**
 * Import attaches the model's controls by id or by an unambiguous name, never by a partial name, and reports each
 * reference it could not attach in the result as well as in a warning.
 */
import { describe, it, expect, vi } from 'vitest'
import { DtImport } from '../dt-import.js'

const catalog = [
  { id: 'c-enc', name: 'Encryption' },
  { id: 'c-mfa', name: 'Multi-Factor Authentication' },
  { id: 'c-log-a', name: 'Audit Logging' },
  { id: 'c-log-b', name: 'Audit Logging' },
]

const setup = () => {
  const dtImport = new DtImport({} as any) as any
  dtImport.dtControl.getControls = vi.fn(async () => catalog)
  dtImport.dtModule.getModules = vi.fn(async () => [])
  dtImport.dtModel.createModel = vi.fn(async () => ({ id: 'M1' }))
  for (const m of ['setupDefaultBoundary', 'createDataItems', 'processHierarchy', 'createDataFlows',
    'associateDataItemsWithElements', 'processControlAssociations', 'associateConduitsWithBoundaries']) {
    dtImport[m] = vi.fn().mockResolvedValue(undefined)
  }
  return dtImport
}

describe('DtImport — model controls', () => {
  it('attaches exact and case-variant names, and reports partial and ambiguous names without attaching them', async () => {
    const dtImport = setup()

    const result = await dtImport.importModel({
      name: 'M',
      defaultBoundary: { id: 'b0' },
      controls: [
        { name: 'Encryption' },
        { name: 'multi-factor authentication' },
        { name: 'Encryption at rest for S3 buckets' },
        { name: 'Audit Logging' },
      ],
    })

    expect(dtImport.dtModel.createModel).toHaveBeenCalledTimes(1)
    expect(dtImport.dtModel.createModel.mock.calls[0][0].controls).toEqual(['c-enc', 'c-mfa'])
    const owner = { kind: 'MODEL', name: 'M' }
    expect(result.unresolvedControls).toEqual([
      { name: 'Encryption at rest for S3 buckets', reason: 'not_found', owner },
      {
        name: 'Audit Logging',
        reason: 'ambiguous',
        candidates: [{ id: 'c-log-a', name: 'Audit Logging' }, { id: 'c-log-b', name: 'Audit Logging' }],
        owner,
      },
    ])
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'Could not find control: Encryption at rest for S3 buckets, on model "M"',
        'Could not find control: Audit Logging (2 controls match that name: c-log-a, c-log-b), on model "M"',
      ]),
    )
    // An unattached control is reported, not an import failure.
    expect(result.errors).toEqual([])
  })

  it('reports each reference as catalog_unavailable when the control catalog cannot be fetched', async () => {
    const dtImport = setup()
    dtImport.dtControl.getControls = vi.fn(async () => {
      throw new Error('catalog down')
    })
    const result = await dtImport.importModel({ name: 'M', defaultBoundary: { id: 'b0' }, controls: [{ name: 'Encryption' }] })
    expect(dtImport.dtModel.createModel.mock.calls[0][0].controls).toEqual([])
    expect(result.unresolvedControls).toEqual([{ name: 'Encryption', reason: 'catalog_unavailable', owner: { kind: 'MODEL', name: 'M' } }])
    expect(result.warnings).toContain('Could not find control: Encryption (the control catalog could not be fetched in full), on model "M"')
  })

  it('attaches only by id when the catalog of controls in folders could not be fetched', async () => {
    const dtImport = setup()
    dtImport.dtControl.getControls = vi.fn(async (args: { folderId?: string }) => {
      if (args.folderId === 'all') throw new Error('folders down')
      return catalog
    })
    const result = await dtImport.importModel({
      name: 'M',
      defaultBoundary: { id: 'b0' },
      controls: [{ name: 'Encryption' }, { id: 'c-mfa' }],
    })
    expect(dtImport.dtModel.createModel.mock.calls[0][0].controls).toEqual(['c-mfa'])
    expect(result.unresolvedControls).toEqual([{ name: 'Encryption', reason: 'catalog_unavailable', owner: { kind: 'MODEL', name: 'M' } }])
    expect(result.warnings).toContain('Could not find control: Encryption (the control catalog could not be fetched in full), on model "M"')
  })

  it('starts each import with a fresh catalog and a fresh report', async () => {
    const dtImport = setup()
    await dtImport.importModel({ name: 'M', defaultBoundary: { id: 'b0' }, controls: [{ name: 'Firewall' }] })
    const second = await dtImport.importModel({ name: 'M', defaultBoundary: { id: 'b0' }, controls: [{ name: 'Encryption' }] })
    expect(second.unresolvedControls).toEqual([])
    expect(dtImport.dtControl.getControls).toHaveBeenCalledTimes(4)
  })

  it('reports nothing when every control resolves', async () => {
    const dtImport = setup()
    const result = await dtImport.importModel({ name: 'M', defaultBoundary: { id: 'b0' }, controls: [{ id: 'c-enc' }] })
    expect(dtImport.dtModel.createModel.mock.calls[0][0].controls).toEqual(['c-enc'])
    expect(result.unresolvedControls).toEqual([])
  })
})
