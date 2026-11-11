/**
 * Strict control resolution on import: a reference that does not resolve refuses the import before
 * any write; a resolved one links exactly the control named; a failed control write is an error.
 * Lenient imports keep the loose matching.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DtImport } from '../dt-import.js'
import { DtImportSplit } from '../dt-import-split.js'
import { GET_CONTROLS } from '../../dt-control/dt-control-gql.js'

const CATALOG = [
  { id: 'w1', name: 'WAF' },
  { id: 'm1', name: 'MFA' },
  { id: 'm2', name: 'MFA' },
  { id: 'm3', name: 'MFA' },
  { id: 'l1', name: 'Logging' },
]

/** An Apollo client that serves the control catalog and records every mutation. */
function recordingApollo(sets: { none?: any[] | Error; all?: any[] | Error } = {}) {
  const mutations: unknown[] = []
  const client = {
    query: vi.fn(async ({ query, variables }: any) => {
      if (query !== GET_CONTROLS) throw new Error('unexpected query')
      const set = variables?.query === null ? (sets.all ?? CATALOG) : (sets.none ?? [])
      if (set instanceof Error) throw set
      return { data: { controls: set } }
    }),
    mutate: vi.fn(async (args: unknown) => {
      mutations.push(args)
      throw new Error('mutation refused by the test double')
    }),
  }
  return { client, mutations }
}

const baseModel = (over: any = {}) => ({
  name: 'M',
  defaultBoundary: {
    id: 'b0', name: 'root',
    components: [{ id: 'c1', name: 'API', type: 'PROCESS', positionX: 0, positionY: 0, controls: [{ name: 'WAF' }] }],
    boundaries: [{ id: 'b1', name: 'DMZ', components: [{ id: 'c2', name: 'DB', type: 'STORE', positionX: 0, positionY: 0 }] }],
  },
  dataFlows: [{ id: 'f1', name: 'q', source: { id: 'c1' }, target: { id: 'c2' }, controls: [] }],
  dataItems: [],
  ...over,
})

/** Stubs every platform writer and returns the calls, so a full import runs against the real catalog. */
function stubWriters(dt: any) {
  let n = 0
  const calls = {
    createModel: vi.fn(async (_args: any) => ({ id: 'SM' })),
    updateComponent: vi.fn(async ({ updatedNode }: any) => ({ id: updatedNode.id })),
    updateBoundaryNode: vi.fn(async ({ updatedNode }: any) => ({ id: updatedNode.id })),
    updateDataFlow: vi.fn(async ({ edge }: any) => ({ id: edge.id })),
  }
  dt.dtModule.getModules = vi.fn(async () => [])
  dt.dtModel.createModel = calls.createModel
  dt.dtModel.dumpModelData = vi.fn(async () => ({
    defaultBoundary: { id: 'SB0', data: { label: 'root' }, position: { x: 0, y: 0 } },
    components: [], boundaries: [], dataFlows: [],
  }))
  dt.dtComponent.createComponentNode = vi.fn(async () => ({ id: `SC${++n}` }))
  dt.dtBoundary.createBoundaryNode = vi.fn(async () => ({ id: `SB${++n}` }))
  dt.dtDataflow.createDataFlow = vi.fn(async () => ({ id: `SF${++n}` }))
  dt.dtComponent.updateComponent = calls.updateComponent
  dt.dtBoundary.updateBoundaryNode = calls.updateBoundaryNode
  dt.dtDataflow.updateDataFlow = calls.updateDataFlow
  return calls
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('DtImport strict — refusals write nothing', () => {
  const refused = async (data: any, sets?: Parameters<typeof recordingApollo>[0]) => {
    const { client, mutations } = recordingApollo(sets)
    const result = await new DtImport(client as any).importModel(data, { controlResolution: 'strict' })
    expect(mutations).toEqual([])
    expect(result.success).toBe(false)
    expect(result).not.toHaveProperty('resolvedControls')
    expect(result).not.toHaveProperty('model')
    return result
  }

  it.each([
    ['control_id_not_found', [{ id: 'gone', name: 'WAF' }]],
    ['control_name_not_found', [{ name: 'Web firewall' }]],
    ['control_name_ambiguous', [{ name: 'MFA' }]],
    ['control_entry_invalid', [{ name: '   ' }]],
  ])('%s', async (code, controls) => {
    const data = baseModel()
    data.defaultBoundary.components[0].controls = controls as any
    const result = await refused(data)
    expect(result.errors).toEqual([expect.objectContaining({ step: 'resolve_controls', code, ref: 'c1', index: 0 })])
  })

  it('a catalog that cannot be read, even in part', async () => {
    for (const sets of [{ all: new Error('catalog refused') }, { none: new Error('catalog refused') }]) {
      const result = await refused(baseModel(), sets)
      expect(result.errors).toEqual([expect.objectContaining({ code: 'control_catalog_unavailable' })])
    }
  })

  it('never links a case-insensitive or partial name', async () => {
    for (const name of ['waf', 'WAF rules', 'Log']) {
      const data = baseModel()
      data.defaultBoundary.components[0].controls = [{ name }] as any
      const result = await refused(data)
      expect(result.errors[0].code, name).toBe('control_name_not_found')
    }
  })

  it('the model-level list is checked too', async () => {
    const result = await refused(baseModel({ controls: [{ name: 'Nope' }] }))
    expect(result.errors).toEqual([expect.objectContaining({ code: 'control_name_not_found', ref: '@model', index: 0 })])
  })

  it('a data item\'s list is checked too, as data items carry controls', async () => {
    const result = await refused(baseModel({ dataItems: [{ id: 'd1', name: 'Cards', controls: [{ name: 'mfa' }] }] }))
    expect(result.errors).toEqual([expect.objectContaining({ code: 'control_name_not_found', ref: 'd1', index: 0 })])
  })

  it('a controls value that is not a list', async () => {
    const data = baseModel()
    data.dataFlows[0].controls = { name: 'WAF' } as any
    const result = await refused(data)
    expect(result.errors).toEqual([expect.objectContaining({ code: 'control_entry_invalid', ref: 'f1' })])
  })

  it('duplicate element ids, before any catalog read', async () => {
    const data = baseModel()
    data.defaultBoundary.boundaries[0].components[0].id = 'c1'
    const { client, mutations } = recordingApollo()
    const result = await new DtImport(client as any).importModel(data, { controlResolution: 'strict' })
    expect(result.errors).toEqual([expect.objectContaining({ step: 'validate', code: 'duplicate_element_id', ref: 'c1' })])
    expect(client.query).not.toHaveBeenCalled()
    expect(mutations).toEqual([])
  })

  it('through DtImportSplit, which passes the option on', async () => {
    const { client, mutations } = recordingApollo()
    const split = {
      manifest: { schemaVersion: '2.0.0', format: 'split', model: { id: 'M1', name: 'M', controls: [{ name: 'MFA' }] }, modules: [], exportedAt: 'x' },
      structure: { defaultBoundary: { id: 'b0', name: 'root', components: [], boundaries: [] } },
      dataFlows: [], dataItems: [], attributes: {},
    }
    const result = await new DtImportSplit(client as any).importSplitModel(split as any, { controlResolution: 'strict' })
    expect(result.success).toBe(false)
    expect(result.errors).toEqual([expect.objectContaining({ code: 'control_name_ambiguous', ref: '@model', candidates_total: 3 })])
    expect(result).not.toHaveProperty('resolvedControls')
    expect(mutations).toEqual([])
  })
})

describe('DtImport strict — what is linked', () => {
  it('links pinned ids of same-named controls, reports the lists written with the catalog name', async () => {
    const { client } = recordingApollo()
    const dt = new DtImport(client as any) as any
    const calls = stubWriters(dt)
    const data = baseModel({ controls: [{ id: 'l1', name: 'Logging' }] })
    data.defaultBoundary.components[0].controls = [{ id: 'm2', name: 'MFA' }, { name: 'WAF' }]
    data.defaultBoundary.boundaries[0].components[0].controls = [{ id: 'm3', name: 'Old MFA' }] as any
    const result = await dt.importModel(data, { controlResolution: 'strict' })

    expect(result.errors).toEqual([])
    expect(result.success).toBe(true)
    expect(calls.createModel.mock.calls[0][0].controls).toEqual(['l1'])
    const componentControls = calls.updateComponent.mock.calls.map((c: any) => c[0].updatedNode.data.controls)
    expect(componentControls).toEqual([['m2', 'w1'], ['m3']])
    expect(result.resolvedControls).toEqual({
      '@model': [{ id: 'l1', name: 'Logging' }],
      c1: [{ id: 'm2', name: 'MFA' }, { id: 'w1', name: 'WAF' }],
      c2: [{ id: 'm3', name: 'MFA' }],
      f1: [],
    })
    // An absent controls key has no entry; the catalog name differing from the entry's is a warning.
    expect(result.resolvedControls).not.toHaveProperty('b0')
    expect(result.resolvedControls).not.toHaveProperty('b1')
    expect(result.warnings.some((w: string) => /controls\[0\] of c2: the id "m3" links the catalog control named "MFA", not "Old MFA"/.test(w))).toBe(true)
  })

  it('links a data item\'s controls from the snapshot, never by a loose name, and reports them', async () => {
    const { client } = recordingApollo()
    const dt = new DtImport(client as any) as any
    stubWriters(dt)
    const createDataItem = vi.fn(async (args: any) => ({ id: `SD-${args.name}`, name: args.name }))
    dt.dtDataitem.createDataItem = createDataItem
    const data = baseModel({ dataItems: [
      { id: 'd1', name: 'Cards', controls: [{ name: 'Logging' }, { id: 'm2', name: 'MFA' }] },
      { id: 'd2', name: 'Plain' },
    ] })
    const result = await dt.importModel(data, { controlResolution: 'strict' })

    expect(result.errors).toEqual([])
    expect(createDataItem.mock.calls.find((c: any) => c[0].name === 'Cards')?.[0].controls).toEqual(['l1', 'm2'])
    expect(result.resolvedControls).toMatchObject({ d1: [{ id: 'l1', name: 'Logging' }, { id: 'm2', name: 'MFA' }] })
    expect(result.resolvedControls).not.toHaveProperty('d2')
  })

  it('a failed control write is an error with the ref, and no resolved map', async () => {
    const { client } = recordingApollo()
    const dt = new DtImport(client as any) as any
    const calls = stubWriters(dt)
    calls.updateComponent.mockRejectedValueOnce(new Error('write refused'))
    const result = await dt.importModel(baseModel(), { controlResolution: 'strict' })
    expect(result.success).toBe(false)
    expect(result.model).toEqual({ id: 'SM' })
    expect(result.errors).toEqual([expect.objectContaining({ step: 'associate_controls', ref: 'c1', error: expect.stringMatching(/write refused/) })])
    expect(result).not.toHaveProperty('resolvedControls')
  })

  it('a write that returns no element is an error too', async () => {
    const { client } = recordingApollo()
    const dt = new DtImport(client as any) as any
    const calls = stubWriters(dt)
    calls.updateComponent.mockResolvedValueOnce(null as any)
    const result = await dt.importModel(baseModel(), { controlResolution: 'strict' })
    expect(result.errors).toEqual([expect.objectContaining({ step: 'associate_controls', ref: 'c1' })])
  })
})

describe('DtImport strict — greenfield Controls', () => {
  it('defers a temporary greenfield id; the model is created without it', async () => {
    const { client } = recordingApollo()
    const dt = new DtImport(client as any) as any
    const calls = stubWriters(dt)
    const data = baseModel({ controls: [{ id: 'greenfield-m0', name: 'Model policy' }] })
    data.defaultBoundary.components[0].controls = [{ id: 'greenfield-a1b2', name: 'Customer WAF policy' }]
    const result = await dt.importModel(data, { controlResolution: 'strict' })
    expect(result.errors).toEqual([])
    expect(calls.createModel.mock.calls[0][0].controls).toEqual([])
    expect(calls.updateComponent).not.toHaveBeenCalled()
    expect(result.resolvedControls).toEqual({ '@model': [], c1: [], f1: [] })
  })
})

describe('DtImportSplit strict — the model passed in is not changed', () => {
  it('leaves the split model exactly as given (the caller pins its controls from it afterwards)', async () => {
    const { client } = recordingApollo()
    const importer = new DtImportSplit(client as any) as any
    stubWriters(importer.dtImport)
    const split = {
      manifest: { schemaVersion: '2.0.0', format: 'split', model: { id: 'M1', name: 'M', controls: [{ id: null, name: 'Logging' }] }, modules: [], exportedAt: 'x' },
      structure: { defaultBoundary: { id: 'b0', name: 'root', components: [{ id: 'c1', name: 'API', type: 'PROCESS', positionX: 0, positionY: 0, controls: [{ id: null, name: 'WAF' }, { id: 'm2', name: 'MFA' }] }], boundaries: [] } },
      dataFlows: [], dataItems: [], attributes: {},
    }
    const before = structuredClone(split)
    const result = await importer.importSplitModel(split, { controlResolution: 'strict' })
    expect(result.success).toBe(true)
    expect(result.resolvedControls).toMatchObject({ c1: [{ id: 'w1' }, { id: 'm2' }] })
    expect(split).toEqual(before)
  })
})

describe('DtImport lenient — through the control resolver', () => {
  it('still links a case-insensitive name and only warns about a failed control write', async () => {
    const { client } = recordingApollo()
    const dt = new DtImport(client as any) as any
    const calls = stubWriters(dt)
    const data = baseModel()
    data.defaultBoundary.components[0].controls = [{ name: 'waf' }]
    const linked = await dt.importModel(data)
    expect(linked.success).toBe(true)
    expect(calls.updateComponent.mock.calls[0][0].updatedNode.data.controls).toEqual(['w1'])
    expect(linked).not.toHaveProperty('resolvedControls')

    calls.updateComponent.mockRejectedValueOnce(new Error('write refused'))
    const warned = await dt.importModel(baseModel())
    expect(warned.success).toBe(true)
    expect(warned.warnings.some((w: string) => /Could not set controls/.test(w))).toBe(true)
  })

  it('attaches no control by part of its name, as an import without strict resolution runs', async () => {
    const { client } = recordingApollo()
    const dt = new DtImport(client as any) as any
    const calls = stubWriters(dt)
    const data = baseModel()
    data.defaultBoundary.components[0].controls = [{ name: 'WAF rules' }, { name: 'Log' }]
    const result = await dt.importModel(data)
    expect(result.success).toBe(true)
    expect(calls.updateComponent).not.toHaveBeenCalled()
    expect(result.unresolvedControls).toEqual([
      { name: 'WAF rules', reason: 'not_found', owner: { kind: 'COMPONENT', id: 'c1', name: 'API' } },
      { name: 'Log', reason: 'not_found', owner: { kind: 'COMPONENT', id: 'c1', name: 'API' } },
    ])
    expect(result.warnings).toContain('Could not find control: WAF rules, on component "API"')
  })

  it('names the model or element each unresolved reference came from, on every write path', async () => {
    const { client } = recordingApollo()
    const dt = new DtImport(client as any) as any
    stubWriters(dt)
    const data = baseModel({ controls: [{ name: 'Nope model' }] })
    data.defaultBoundary.controls = [{ name: 'Nope root' }]
    data.defaultBoundary.components[0].controls = [{ name: 'Nope c1' }]
    data.defaultBoundary.boundaries[0].controls = [{ name: 'Nope b1' }]
    data.dataFlows[0].controls = [{ name: 'Nope f1' }]
    const result = await dt.importModel(data)
    const owners = Object.fromEntries(result.unresolvedControls.map((u: any) => [u.name, u.owner]))
    expect(owners).toEqual({
      'Nope model': { kind: 'MODEL', name: 'M' },
      'Nope root': { kind: 'BOUNDARY', id: 'b0', name: 'root' },
      'Nope c1': { kind: 'COMPONENT', id: 'c1', name: 'API' },
      'Nope b1': { kind: 'BOUNDARY', id: 'b1', name: 'DMZ' },
      'Nope f1': { kind: 'DATA_FLOW', id: 'f1', name: 'q' },
    })
  })
})

describe('DtImport beforeFirstWrite — after every check, before the first write', () => {
  it('is not called when the strict resolver refuses', async () => {
    const { client, mutations } = recordingApollo()
    const hook = vi.fn(async () => undefined)
    const data = baseModel()
    data.defaultBoundary.components[0].controls = [{ name: 'MFA' }] as any
    const result = await new DtImport(client as any).importModel(data, { controlResolution: 'strict', beforeFirstWrite: hook })
    expect(result.errors).toEqual([expect.objectContaining({ code: 'control_name_ambiguous' })])
    expect(hook).not.toHaveBeenCalled()
    expect(mutations).toEqual([])
  })

  it('runs once every check has passed and before the model is created', async () => {
    const { client } = recordingApollo()
    const dt = new DtImport(client as any) as any
    const calls = stubWriters(dt)
    const order: string[] = []
    calls.createModel.mockImplementation(async () => { order.push('createModel'); return { id: 'SM' } })
    const result = await dt.importModel(baseModel(), { controlResolution: 'strict', beforeFirstWrite: async () => { order.push('hook'); return undefined } })
    expect(result.success).toBe(true)
    expect(order).toEqual(['hook', 'createModel'])
  })

  it('is not called when a validation check refuses, and is called once otherwise', async () => {
    const { client } = recordingApollo()
    const hook = vi.fn(async () => undefined)
    const dup = baseModel()
    dup.defaultBoundary.boundaries[0].components[0].id = 'c1'
    const refused = await new DtImport(client as any).importModel(dup, { controlResolution: 'strict', beforeFirstWrite: hook })
    expect(refused.success).toBe(false)
    expect(hook).not.toHaveBeenCalled()

    const dt = new DtImport(client as any) as any
    stubWriters(dt)
    await dt.importModel(baseModel(), { controlResolution: 'strict', beforeFirstWrite: hook })
    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('a message from it refuses the import with nothing written', async () => {
    const { client, mutations } = recordingApollo()
    const dt = new DtImport(client as any) as any
    const calls = stubWriters(dt)
    const result = await dt.importModel(baseModel(), { controlResolution: 'strict', beforeFirstWrite: async () => 'manifest.json changed' })
    expect(result.success).toBe(false)
    expect(result.errors).toEqual([{ step: 'before_first_write', error: 'manifest.json changed' }])
    expect(result).not.toHaveProperty('model')
    expect(calls.createModel).not.toHaveBeenCalled()
    expect(mutations).toEqual([])
  })

  it('through DtImportSplit, which passes it on', async () => {
    const { client, mutations } = recordingApollo()
    const split = {
      manifest: { schemaVersion: '2.0.0', format: 'split', model: { id: 'M1', name: 'M' }, modules: [], exportedAt: 'x' },
      structure: { defaultBoundary: { id: 'b0', name: 'root', components: [], boundaries: [] } },
      dataFlows: [], dataItems: [], attributes: {},
    }
    const result = await new DtImportSplit(client as any).importSplitModel(split as any, { controlResolution: 'strict', beforeFirstWrite: async () => 'held' })
    expect(result.errors).toEqual([{ step: 'before_first_write', error: 'held' }])
    expect(mutations).toEqual([])
  })
})
