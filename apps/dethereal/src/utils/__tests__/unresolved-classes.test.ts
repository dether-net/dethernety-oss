import { describe, it, expect } from 'vitest'
import { keepUnresolvedClasses } from '../unresolved-classes.js'

const exported = () => ({
  manifest: {} as any,
  structure: {
    defaultBoundary: {
      id: 'b-root', name: 'Root', classData: { id: 'zone' },
      boundaries: [{ id: 'b-dmz', name: 'DMZ', classData: { id: 'zone' }, components: [], boundaries: [] }],
      components: [],
    },
  } as any,
  dataFlows: [{ id: 'f-1', name: 'Sync', classData: { id: 'https' } }] as any[],
  dataItems: [{ id: 'd-1', name: 'Key', classData: { id: 'secret' } }] as any[],
  attributes: {
    boundaries: { 'b-dmz': { elementId: 'b-dmz', elementType: 'boundary', attributes: { platform: true } } },
    components: {},
    dataFlows: { 'f-1': { elementId: 'f-1', elementType: 'dataFlow', attributes: { platform: true } } },
    dataItems: {},
  } as any,
})

describe('keepUnresolvedClasses', () => {
  it('keeps the local class of a nested boundary, a flow and a data item, with their local answers or none', () => {
    const model = exported()
    const local = {
      boundaries: { 'b-dmz': { elementId: 'b-dmz', elementType: 'boundary', attributes: { local: true } } },
      dataItems: { 'd-1': { elementId: 'd-1', elementType: 'dataItem', attributes: { local: true } } },
    } as any
    const kept = keepUnresolvedClasses(model as any, local, [
      { elementId: 'b-dmz', kind: 'BOUNDARY', classData: { id: 'vpc', name: 'VPC' } },
      { elementId: 'f-1', kind: 'DATA_FLOW', classData: { id: 'grpc', name: 'gRPC' } },
      { elementId: 'd-1', kind: 'DATA', classData: { id: 'kms', name: 'KMS Key' } },
      { elementId: 'gone', kind: 'COMPONENT', classData: { id: 'x' } },
      { elementId: undefined, kind: 'COMPONENT', classData: { id: 'y' } },
    ], new Map())

    expect(kept).toBe(3)
    expect(model.structure.defaultBoundary.boundaries[0].classData).toEqual({ id: 'vpc', name: 'VPC' })
    expect(model.structure.defaultBoundary.classData).toEqual({ id: 'zone' })
    expect(model.dataFlows[0].classData).toEqual({ id: 'grpc', name: 'gRPC' })
    expect(model.dataItems[0].classData).toEqual({ id: 'kms', name: 'KMS Key' })
    expect(model.attributes.boundaries['b-dmz'].attributes).toEqual({ local: true })
    expect(model.attributes.dataFlows['f-1']).toBeUndefined()
    expect(model.attributes.dataItems['d-1'].attributes).toEqual({ local: true })
  })

  it('does nothing without unresolved classes', () => {
    const model = exported()
    expect(keepUnresolvedClasses(model as any, {} as any, undefined, new Map())).toBe(0)
    expect(model).toEqual(exported())
  })
})
