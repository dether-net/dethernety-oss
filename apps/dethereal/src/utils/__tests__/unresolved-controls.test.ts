import { describe, it, expect } from 'vitest'
import { keepUnresolvedControls } from '../unresolved-controls.js'

// The model the push sent: its ids are the ones the unresolved references name.
const local = () => ({
  manifest: { model: { id: 'm-1', name: 'M', controls: [{ id: null, name: 'Board Oversight', source: 'declared' }] } } as any,
  structure: {
    defaultBoundary: {
      id: 'b-local-root', name: 'Root', controls: [{ id: null, name: 'Segmentation', source: 'declared' }],
      boundaries: [{ id: 'b-dmz', name: 'DMZ', components: [{ id: 'local-web', name: 'Web', controls: [{ id: 'x', name: 'Audit Logging' }] }], boundaries: [] }],
      components: [],
    },
  } as any,
  dataFlows: [{ id: 'f-1', name: 'Sync', controls: [{ id: 'ctl-gone' }] }] as any[],
  dataItems: [] as any[],
  attributes: { boundaries: {}, components: {}, dataFlows: {}, dataItems: {} } as any,
})

// The model re-exported from the platform after the push.
const exported = () => ({
  manifest: { model: { id: 'm-1', name: 'M' } } as any,
  structure: {
    defaultBoundary: {
      id: 'b-root', name: 'Root',
      boundaries: [{ id: 'b-dmz', name: 'DMZ', components: [{ id: 'c-web', name: 'Web', controls: [{ id: 'ctl-waf', name: 'WAF' }] }], boundaries: [] }],
      components: [],
    },
  } as any,
  dataFlows: [{ id: 'f-1', name: 'Sync' }] as any[],
  dataItems: [] as any[],
  attributes: { boundaries: {}, components: {}, dataFlows: {}, dataItems: {} } as any,
})

describe('keepUnresolvedControls', () => {
  it('writes each unattached reference back to its model, boundary, component or flow, as the local file has it', () => {
    const model = exported()
    const lost = keepUnresolvedControls(model as any, local() as any, [
      { name: 'Board Oversight', reason: 'not_found', owner: { kind: 'MODEL' } },
      // The default boundary, under the id the local file gives it.
      { name: 'Segmentation', reason: 'not_found', owner: { kind: 'BOUNDARY', id: 'b-local-root' } },
      { id: 'x', name: 'Audit Logging', reason: 'ambiguous', candidates: [], owner: { kind: 'COMPONENT', id: 'local-web' } },
      { id: 'ctl-gone', reason: 'not_found', owner: { kind: 'DATA_FLOW', id: 'f-1' } },
      // Nothing to write.
      { reason: 'not_found', owner: { kind: 'DATA_FLOW', id: 'f-1' } },
    ] as any, new Map([['local-web', 'c-web']]))

    expect(lost).toEqual([])
    expect(model.manifest.model.controls).toEqual([{ id: null, name: 'Board Oversight', source: 'declared' }])
    expect(model.structure.defaultBoundary.controls).toEqual([{ id: null, name: 'Segmentation', source: 'declared' }])
    expect(model.structure.defaultBoundary.boundaries[0].components[0].controls).toEqual([
      { id: 'ctl-waf', name: 'WAF' },
      { id: 'x', name: 'Audit Logging' },
    ])
    expect(model.dataFlows[0].controls).toEqual([{ id: 'ctl-gone' }])
  })

  it('returns the references whose element is gone, and writes one from the report when the local file lacks it', () => {
    const model = exported()
    const orphan = { name: 'Orphan', reason: 'not_found', owner: { kind: 'COMPONENT', id: 'gone' } }
    const ownerless = { name: 'No owner', reason: 'not_found' }
    const lost = keepUnresolvedControls(model as any, local() as any, [
      orphan,
      ownerless,
      { name: 'Not in the file', reason: 'not_found', owner: { kind: 'BOUNDARY', id: 'b-dmz' } },
    ] as any, new Map())

    expect(lost).toEqual([orphan, ownerless])
    expect(model.structure.defaultBoundary.boundaries[0].controls).toEqual([{ name: 'Not in the file' }])
  })

  it('writes a reference once, and does nothing without unresolved controls', () => {
    const model = exported()
    const u = { name: 'Segmentation', reason: 'not_found', owner: { kind: 'BOUNDARY', id: 'b-local-root' } } as any
    expect(keepUnresolvedControls(model as any, local() as any, [u, u], new Map())).toEqual([])
    expect(model.structure.defaultBoundary.controls).toHaveLength(1)
    const untouched = exported()
    expect(keepUnresolvedControls(untouched as any, local() as any, undefined, new Map())).toEqual([])
    expect(untouched).toEqual(exported())
  })
})
