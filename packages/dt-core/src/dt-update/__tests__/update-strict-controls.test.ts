/**
 * Strict control resolution on update: a reference that does not resolve refuses the update before
 * the first write (model properties, modules, elements and deletions alike); a resolved one links
 * exactly the control named, and the lists actually written come back by ref.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DtUpdate } from '../dt-update.js'
import { DtUpdateSplit } from '../dt-update-split.js'
import { GET_CONTROLS } from '../../dt-control/dt-control-gql.js'

const CATALOG = [
  { id: 'w1', name: 'WAF' },
  { id: 'm1', name: 'MFA' },
  { id: 'm2', name: 'MFA' },
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

/** The platform model: root SB0 holding c1, nested boundary b1 holding c2, flow f1. */
const existing = () => ({
  id: 'M1', name: 'M', modules: [], controls: [{ id: 'l1' }],
  defaultBoundary: {
    id: 'SB0',
    allDescendantComponents: [{ id: 'c1' }, { id: 'c2' }],
    allDescendantBoundaries: [{ id: 'b1' }],
    allDescendantDataFlows: [{ id: 'f1' }],
  },
  dataItems: [],
})

const update = (over: any = {}) => ({
  name: 'M',
  defaultBoundary: {
    id: 'SB0', name: 'root',
    components: [{ id: 'c1', name: 'API', type: 'PROCESS', controls: [{ name: 'WAF' }] }],
    boundaries: [{ id: 'b1', name: 'DMZ', components: [{ id: 'c2', name: 'DB', type: 'STORE', controls: [{ id: 'm2', name: 'MFA' }] }] }],
  },
  dataFlows: [{ id: 'f1', name: 'q', source: { id: 'c1' }, target: { id: 'c2' }, controls: [] }],
  ...over,
})

function stubWriters(dt: any) {
  let n = 0
  const calls = {
    updateModel: vi.fn(async (_args: any) => ({ id: 'M1' })),
    updateComponent: vi.fn(async ({ updatedNode }: any) => ({ id: updatedNode.id })),
    updateBoundaryNode: vi.fn(async ({ updatedNode }: any) => ({ id: updatedNode.id })),
    updateDataFlow: vi.fn(async ({ edge }: any) => ({ id: edge.id })),
  }
  dt.dtModel.getModelData = vi.fn(async () => existing())
  dt.dtModel.getModel = vi.fn(async () => ({ id: 'M1' }))
  dt.dtModel.updateModel = calls.updateModel
  dt.dtComponent.createComponentNode = vi.fn(async () => ({ id: `SC${++n}` }))
  dt.dtBoundary.createBoundaryNode = vi.fn(async () => ({ id: `SB${++n}` }))
  dt.dtDataflow.createDataFlow = vi.fn(async () => ({ id: `SF${++n}` }))
  dt.dtComponent.updateComponent = calls.updateComponent
  dt.dtBoundary.updateBoundaryNode = calls.updateBoundaryNode
  dt.dtDataflow.updateDataFlow = calls.updateDataFlow
  for (const [o, m] of [['dtComponent', 'deleteComponent'], ['dtBoundary', 'deleteBoundary'], ['dtDataflow', 'deleteDataFlow'], ['dtDataitem', 'deleteDataItem']]) {
    dt[o][m] = vi.fn(async () => true)
  }
  return calls
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('DtUpdate strict — refusals write nothing', () => {
  const refused = async (data: any, sets?: Parameters<typeof recordingApollo>[0]) => {
    const { client, mutations } = recordingApollo(sets)
    const dt = new DtUpdate(client as any) as any
    dt.dtModel.getModelData = vi.fn(async () => existing())
    const result = await dt.updateModel('M1', data, { controlResolution: 'strict' })
    expect(mutations).toEqual([])
    expect(result.success).toBe(false)
    expect(result).not.toHaveProperty('resolvedControls')
    return result
  }

  it.each([
    ['control_id_not_found', { id: 'gone' }],
    ['control_name_not_found', { name: 'mfa' }],
    ['control_name_ambiguous', { name: 'MFA' }],
    ['control_entry_invalid', { id: 7 }],
  ])('%s, in a component of a nested boundary', async (code, entry) => {
    const data = update()
    data.defaultBoundary.boundaries[0].components[0].controls = [entry] as any
    const result = await refused(data)
    expect(result.errors).toEqual([expect.objectContaining({ step: 'resolve_controls', code, ref: 'c2', index: 0 })])
  })

  it('a data item\'s control, which data items now carry', async () => {
    const data = update({ dataItems: [{ id: 'd1', name: 'Cards', controls: [{ name: 'Nope' }] }] })
    const result = await refused(data)
    expect(result.errors).toEqual([expect.objectContaining({ code: 'control_name_not_found', ref: 'd1', index: 0 })])
  })

  it('an incomplete catalog', async () => {
    const result = await refused(update(), { all: new Error('catalog refused') })
    expect(result.errors).toEqual([expect.objectContaining({ code: 'control_catalog_unavailable' })])
  })

  it('a new element without an id is reported by its place in the group', async () => {
    const data = update()
    data.defaultBoundary.components.push({ name: 'New', type: 'PROCESS', controls: [{ name: 'Nope' }] } as any)
    const result = await refused(data)
    expect(result.errors).toEqual([expect.objectContaining({ code: 'control_name_not_found', ref: 'components[1]' })])
  })

  it('duplicate element ids', async () => {
    const data = update()
    data.dataFlows[0].id = 'c2'
    const result = await refused(data)
    expect(result.errors).toEqual([expect.objectContaining({ step: 'validate', code: 'duplicate_element_id', ref: 'c2' })])
  })

  it('model-level controls only', async () => {
    const data = update({ controls: [{ name: 'Nope' }] })
    const result = await refused(data)
    expect(result.errors).toEqual([expect.objectContaining({ ref: '@model', code: 'control_name_not_found' })])
  })

  it('through DtUpdateSplit, which passes the option on', async () => {
    const { client, mutations } = recordingApollo()
    const dt = new DtUpdateSplit(client as any) as any
    dt.dtUpdate.dtModel.getModelData = vi.fn(async () => existing())
    const split = {
      manifest: { schemaVersion: '2.0.0', format: 'split', model: { id: 'M1', name: 'M' }, modules: [], exportedAt: 'x' },
      structure: { defaultBoundary: { id: 'SB0', name: 'root', components: [{ id: 'c1', name: 'API', type: 'PROCESS', controls: [{ name: 'MFA' }] }], boundaries: [] } },
      dataFlows: [], dataItems: [], attributes: {},
    }
    const result = await dt.updateFromSplitModel('M1', split, { controlResolution: 'strict' })
    expect(result.success).toBe(false)
    expect(result.errors).toEqual([expect.objectContaining({ code: 'control_name_ambiguous', ref: 'c1' })])
    expect(result).not.toHaveProperty('resolvedControls')
    expect(mutations).toEqual([])
  })
})

describe('DtUpdate strict — what is linked', () => {
  it('writes the resolved ids and reports the lists written, including new elements', async () => {
    const { client } = recordingApollo()
    const dt = new DtUpdate(client as any) as any
    const calls = stubWriters(dt)
    const data = update({ controls: [{ name: 'Logging' }] })
    data.defaultBoundary.components.push({ name: 'New', type: 'PROCESS', controls: [{ id: 'm1', name: 'MFA' }] } as any)
    data.defaultBoundary.components.push({ id: 'c-empty', name: 'Empty', type: 'PROCESS', controls: [] } as any)
    data.dataFlows.push({ id: 'f-new', name: 'r', source: { id: 'c1' }, target: { id: 'c2' }, controls: [{ name: 'WAF' }] } as any)
    const result = await dt.updateModel('M1', data, { controlResolution: 'strict' })

    expect(result.errors).toEqual([])
    expect(calls.updateModel.mock.calls[0][0].controls).toEqual(['l1'])
    expect(result.resolvedControls).toEqual({
      '@model': [{ id: 'l1', name: 'Logging' }],
      c1: [{ id: 'w1', name: 'WAF' }],
      'components[1]': [{ id: 'm1', name: 'MFA' }],
      'c-empty': [],
      c2: [{ id: 'm2', name: 'MFA' }],
      f1: [],
      'f-new': [{ id: 'w1', name: 'WAF' }],
    })
    // The created flow's controls rode the follow-up write.
    expect(calls.updateDataFlow.mock.calls.some((c: any) => String(c[0].edge.id).startsWith('SF') && c[0].edge.data.controls?.[0] === 'w1')).toBe(true)
    // Absent keys (the root, b1) have no entry.
    expect(result.resolvedControls).not.toHaveProperty('SB0')
    expect(result.resolvedControls).not.toHaveProperty('b1')
  })

  it('links a data item\'s controls, an existing item\'s and a new one\'s, and reports them by ref', async () => {
    const { client } = recordingApollo()
    const dt = new DtUpdate(client as any) as any
    stubWriters(dt)
    dt.dtModel.getModelData = vi.fn(async () => ({ ...existing(), dataItems: [{ id: 'd1', name: 'Cards' }] }))
    const updateDataItem = vi.fn(async (_args: any) => ({ residualOk: true }))
    const createDataItem = vi.fn(async (_args: any) => ({ id: 'SD1', name: 'New item' }))
    dt.dtDataitem.updateDataItem = updateDataItem
    dt.dtDataitem.createDataItem = createDataItem
    const data = update({ dataItems: [
      { id: 'd1', name: 'Cards', controls: [{ name: 'Logging' }] },
      { name: 'New item', controls: [{ id: 'w1', name: 'WAF' }] },
      { id: 'd-absent', name: 'No key' },
    ] })
    const result = await dt.updateModel('M1', data, { controlResolution: 'strict' })

    expect(result.errors).toEqual([])
    expect(updateDataItem.mock.calls[0][0].controls).toEqual(['l1'])
    expect(createDataItem.mock.calls.find((c: any) => c[0].name === 'New item')?.[0].controls).toEqual(['w1'])
    expect(result.resolvedControls).toMatchObject({ d1: [{ id: 'l1', name: 'Logging' }], 'dataItems[1]': [{ id: 'w1', name: 'WAF' }] })
    // An item without the key keeps its platform controls: nothing is resolved or reported for it.
    expect(result.resolvedControls).not.toHaveProperty('d-absent')
  })

  it('model-level controls only: the model write carries them, absent element keys stay absent', async () => {
    const { client } = recordingApollo()
    const dt = new DtUpdate(client as any) as any
    const calls = stubWriters(dt)
    const data = update({ controls: [{ id: 'w1', name: 'WAF' }] })
    delete (data.defaultBoundary.components[0] as any).controls
    delete (data.defaultBoundary.boundaries[0].components[0] as any).controls
    delete (data.dataFlows[0] as any).controls
    const result = await dt.updateModel('M1', data, { controlResolution: 'strict' })
    expect(calls.updateModel.mock.calls[0][0].controls).toEqual(['w1'])
    expect(result.resolvedControls).toEqual({ '@model': [{ id: 'w1', name: 'WAF' }] })
  })

  it('a failed element write leaves success false and no resolved map', async () => {
    const { client } = recordingApollo()
    const dt = new DtUpdate(client as any) as any
    const calls = stubWriters(dt)
    calls.updateComponent.mockImplementation((async ({ updatedNode }: any) => (updatedNode.id === 'c1' ? null : { id: updatedNode.id })) as any)
    const result = await dt.updateModel('M1', update(), { controlResolution: 'strict' })
    expect(result.success).toBe(false)
    expect(result.errors).toEqual([expect.objectContaining({ step: 'associate_controls', ref: 'c1' })])
    expect(result).not.toHaveProperty('resolvedControls')
  })
})

describe('DtUpdate strict — greenfield Controls', () => {
  it('defers a temporary greenfield id: not refused, not linked, left out of the lists written', async () => {
    const { client } = recordingApollo()
    const dt = new DtUpdate(client as any) as any
    const calls = stubWriters(dt)
    const data = update()
    data.defaultBoundary.components[0].controls = [{ id: 'greenfield-a1b2', name: 'Customer WAF policy' }, { name: 'WAF' }] as any
    data.dataFlows[0].controls = [{ id: 'greenfield-c3d4', name: 'Not yet created' }] as any
    const result = await dt.updateModel('M1', data, { controlResolution: 'strict' })
    expect(result.errors).toEqual([])
    expect(calls.updateComponent.mock.calls.find((c: any) => c[0].updatedNode.id === 'c1')![0].updatedNode.data.controls).toEqual(['w1'])
    expect(result.resolvedControls).toMatchObject({ c1: [{ id: 'w1', name: 'WAF' }], f1: [] })
  })
})

describe('DtUpdate lenient — through the control resolver', () => {
  it('attaches no control by part of its name: the reference is reported, not linked', async () => {
    const { client } = recordingApollo()
    const dt = new DtUpdate(client as any) as any
    const calls = stubWriters(dt)
    const data = update()
    data.defaultBoundary.components[0].controls = [{ name: 'waf rules' }]
    const result = await dt.updateModel('M1', data)
    expect(calls.updateComponent.mock.calls.find((c: any) => c[0].updatedNode.id === 'c1')![0].updatedNode.data.controls).toEqual([])
    expect(result.unresolvedControls).toEqual([{ name: 'waf rules', reason: 'not_found', owner: { kind: 'COMPONENT', id: 'c1', name: 'API' } }])
    expect(result.warnings).toContain('Could not resolve control: waf rules, on component "API"')
    expect(result).not.toHaveProperty('resolvedControls')
  })

  it('attaches the one control a name matches ignoring case and surrounding spaces', async () => {
    const { client } = recordingApollo()
    const dt = new DtUpdate(client as any) as any
    const calls = stubWriters(dt)
    const data = update()
    data.defaultBoundary.components[0].controls = [{ name: ' waf ' }]
    const result = await dt.updateModel('M1', data)
    expect(calls.updateComponent.mock.calls.find((c: any) => c[0].updatedNode.id === 'c1')![0].updatedNode.data.controls).toEqual(['w1'])
    expect(result.unresolvedControls).toEqual([])
  })

  it('names the model or element each unresolved reference came from, on every write path', async () => {
    const { client } = recordingApollo()
    const dt = new DtUpdate(client as any) as any
    stubWriters(dt)
    const data = update({ controls: [{ name: 'Nope model' }] })
    data.defaultBoundary.controls = [{ name: 'Nope root' }]
    data.defaultBoundary.components[0].controls = [{ name: 'Nope c1' }]
    data.defaultBoundary.boundaries[0].controls = [{ name: 'Nope b1' }]
    data.defaultBoundary.components.push({ id: 'c-new', name: 'New', type: 'PROCESS', controls: [{ name: 'Nope c-new' }] } as any)
    data.defaultBoundary.boundaries.push({ id: 'b-new', name: 'Zone', components: [], controls: [{ name: 'Nope b-new' }] } as any)
    data.dataFlows[0].controls = [{ name: 'Nope f1' }]
    data.dataFlows.push({ id: 'f-new', name: 'r', source: { id: 'c1' }, target: { id: 'c2' }, controls: [{ name: 'Nope f-new' }] } as any)
    const result = await dt.updateModel('M1', data)
    const owners = Object.fromEntries(result.unresolvedControls.map((u: any) => [u.name, u.owner]))
    expect(owners).toEqual({
      'Nope model': { kind: 'MODEL', name: 'M' },
      'Nope root': { kind: 'BOUNDARY', id: 'SB0', name: 'root' },
      'Nope c1': { kind: 'COMPONENT', id: 'c1', name: 'API' },
      'Nope b1': { kind: 'BOUNDARY', id: 'b1', name: 'DMZ' },
      'Nope c-new': { kind: 'COMPONENT', id: 'c-new', name: 'New' },
      'Nope b-new': { kind: 'BOUNDARY', id: 'b-new', name: 'Zone' },
      'Nope f1': { kind: 'DATA_FLOW', id: 'f1', name: 'q' },
      'Nope f-new': { kind: 'DATA_FLOW', id: 'f-new', name: 'r' },
    })
    expect(result.warnings).toContain('Could not resolve control: Nope f-new, on data flow "r"')
  })
})

describe('DtUpdate beforeFirstWrite — after every check, before the first write', () => {
  it('is not called when the strict resolver refuses', async () => {
    const { client, mutations } = recordingApollo()
    const dt = new DtUpdate(client as any) as any
    dt.dtModel.getModelData = vi.fn(async () => existing())
    const hook = vi.fn(async () => undefined)
    const data = update()
    data.defaultBoundary.components[0].controls = [{ name: 'MFA' }] as any
    const result = await dt.updateModel('M1', data, { controlResolution: 'strict', beforeFirstWrite: hook })
    expect(result.errors).toEqual([expect.objectContaining({ code: 'control_name_ambiguous' })])
    expect(hook).not.toHaveBeenCalled()
    expect(mutations).toEqual([])
  })

  it('runs once every check has passed and before the first write', async () => {
    const { client } = recordingApollo()
    const dt = new DtUpdate(client as any) as any
    const calls = stubWriters(dt)
    const order: string[] = []
    calls.updateModel.mockImplementation(async () => { order.push('updateModel'); return { id: 'M1' } })
    const result = await dt.updateModel('M1', update(), { controlResolution: 'strict', beforeFirstWrite: async () => { order.push('hook'); return undefined } })
    expect(result.errors).toEqual([])
    expect(order[0]).toBe('hook')
    expect(order).toContain('updateModel')
    expect(order.filter((o) => o === 'hook')).toHaveLength(1)
  })

  it('is not called when a validation check refuses', async () => {
    const { client, mutations } = recordingApollo()
    const dt = new DtUpdate(client as any) as any
    dt.dtModel.getModelData = vi.fn(async () => existing())
    const hook = vi.fn(async () => undefined)
    const data = update()
    data.defaultBoundary.boundaries[0].components[0].id = 'c1'
    const result = await dt.updateModel('M1', data, { controlResolution: 'strict', beforeFirstWrite: hook })
    expect(result.success).toBe(false)
    expect(hook).not.toHaveBeenCalled()
    expect(mutations).toEqual([])
  })

  it('a message from it refuses the update with nothing written', async () => {
    const { client, mutations } = recordingApollo()
    const dt = new DtUpdate(client as any) as any
    const calls = stubWriters(dt)
    const result = await dt.updateModel('M1', update(), { controlResolution: 'strict', beforeFirstWrite: async () => 'manifest.json changed' })
    expect(result.success).toBe(false)
    expect(result.errors).toEqual([{ step: 'before_first_write', error: 'manifest.json changed' }])
    for (const c of Object.values(calls)) expect(c).not.toHaveBeenCalled()
    expect(mutations).toEqual([])
  })

  it('through DtUpdateSplit, which passes it on', async () => {
    const { client, mutations } = recordingApollo()
    const dt = new DtUpdateSplit(client as any) as any
    dt.dtUpdate.dtModel.getModelData = vi.fn(async () => existing())
    const split = {
      manifest: { schemaVersion: '2.0.0', format: 'split', model: { id: 'M1', name: 'M' }, modules: [], exportedAt: 'x' },
      structure: { defaultBoundary: { id: 'SB0', name: 'root', components: [], boundaries: [] } },
      dataFlows: [], dataItems: [], attributes: {},
    }
    const result = await dt.updateFromSplitModel('M1', split, { controlResolution: 'strict', beforeFirstWrite: async () => 'held' })
    expect(result.errors).toEqual([{ step: 'before_first_write', error: 'held' }])
    expect(mutations).toEqual([])
  })
})
