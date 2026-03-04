import { describe, it, expect } from 'vitest'
import { splitModelToZip, zipToSplitModel } from '../modelZipUtils'
import { zipSync, strToU8 } from 'fflate'

// Minimal valid SplitModel for testing
const minimalModel = {
  manifest: {
    schemaVersion: '2.0.0',
    format: 'split',
    model: { id: 'model-1', name: 'Test', defaultBoundaryId: 'b-1' },
  },
  structure: {
    defaultBoundary: {
      id: 'b-1',
      name: 'Root',
      components: [{ id: 'c-1', name: 'App', type: 'PROCESS', positionX: 0, positionY: 0 }],
      boundaries: [],
    },
  },
  dataFlows: [{ id: 'df-1', name: 'Flow 1', source: { id: 'c-1' }, target: { id: 'c-1' } }],
  dataItems: [{ id: 'di-1', name: 'User Data' }],
  attributes: {
    boundaries: {},
    components: {
      'c-1': {
        elementId: 'c-1',
        elementType: 'component',
        classData: { id: 'cls-1', name: 'Process' },
        attributes: { description: 'Main app' },
      },
    },
    dataFlows: {},
    dataItems: {},
  },
} as any

describe('modelZipUtils', () => {
  describe('round-trip', () => {
    it('should serialize and deserialize a model without data loss', () => {
      const zip = splitModelToZip(minimalModel)
      expect(zip).toBeInstanceOf(Uint8Array)
      expect(zip.length).toBeGreaterThan(0)

      const restored = zipToSplitModel(zip)
      expect(restored.manifest).toEqual(minimalModel.manifest)
      expect(restored.structure).toEqual(minimalModel.structure)
      expect(restored.dataFlows).toEqual(minimalModel.dataFlows)
      expect(restored.dataItems).toEqual(minimalModel.dataItems)
      expect(restored.attributes.components?.['c-1']).toEqual(
        minimalModel.attributes.components?.['c-1'],
      )
    })
  })

  describe('splitModelToZip', () => {
    it('should produce valid ZIP data (magic bytes PK)', () => {
      const zip = splitModelToZip(minimalModel)
      expect(zip[0]).toBe(0x50) // P
      expect(zip[1]).toBe(0x4b) // K
    })
  })

  describe('zipToSplitModel', () => {
    it('should throw for missing required files', () => {
      const incompleteZip = zipSync({
        'manifest.json': strToU8('{}'),
        // missing structure.json, dataflows.json, data-items.json
      })

      expect(() => zipToSplitModel(incompleteZip)).toThrow('Missing required file')
    })
  })

  describe('empty attributes', () => {
    it('should handle model with no attributes', () => {
      const emptyAttrsModel = {
        ...minimalModel,
        attributes: {
          boundaries: {},
          components: {},
          dataFlows: {},
          dataItems: {},
        },
      }

      const zip = splitModelToZip(emptyAttrsModel)
      const restored = zipToSplitModel(zip)
      expect(restored.attributes).toEqual({
        boundaries: {},
        components: {},
        dataFlows: {},
        dataItems: {},
      })
    })
  })
})
