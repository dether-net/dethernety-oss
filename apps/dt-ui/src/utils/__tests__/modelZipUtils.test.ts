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

  describe('decompression limits (zip-bomb defence)', () => {
    // Generous base so a single overridden field is what trips each cap.
    const BIG = {
      maxCompressedBytes: 1_000_000_000,
      maxEntries: 1_000_000,
      maxEntryBytes: 1_000_000_000,
      maxTotalBytes: 1_000_000_000,
    }

    it('rejects an archive with too many entries before inflating', () => {
      const manyEntries = zipSync({
        'a.json': strToU8('{}'),
        'b.json': strToU8('{}'),
        'c.json': strToU8('{}'),
      })
      expect(() => zipToSplitModel(manyEntries, { ...BIG, maxEntries: 2 })).toThrow(/too many files/)
    })

    it('rejects when total uncompressed size exceeds the budget', () => {
      const zip = splitModelToZip(minimalModel)
      expect(() => zipToSplitModel(zip, { ...BIG, maxTotalBytes: 1 })).toThrow(/total uncompressed size/)
    })

    it('rejects an entry larger than the per-file budget', () => {
      const zip = splitModelToZip(minimalModel)
      expect(() => zipToSplitModel(zip, { ...BIG, maxEntryBytes: 1 })).toThrow(/is too large/)
    })

    it('rejects a raw archive larger than the compressed budget', () => {
      const zip = splitModelToZip(minimalModel)
      expect(() => zipToSplitModel(zip, { ...BIG, maxCompressedBytes: 1 })).toThrow(/too large to import/)
    })

    it('still imports a legitimate archive under the limits', () => {
      const zip = splitModelToZip(minimalModel)
      const restored = zipToSplitModel(zip, BIG)
      expect(restored.attributes.components?.['c-1']).toEqual(minimalModel.attributes.components['c-1'])
    })
  })

  describe('prototype-pollution guard', () => {
    it('does not pollute Object.prototype via a __proto__ attribute entry', () => {
      const malicious = zipSync({
        'manifest.json': strToU8(JSON.stringify(minimalModel.manifest)),
        'structure.json': strToU8(JSON.stringify(minimalModel.structure)),
        'dataflows.json': strToU8(JSON.stringify(minimalModel.dataFlows)),
        'data-items.json': strToU8(JSON.stringify(minimalModel.dataItems)),
        'attributes/components/__proto__.json': strToU8('{"polluted":true}'),
      })

      const restored = zipToSplitModel(malicious)

      // The dangerous element key is skipped, and nothing leaks onto the prototype chain.
      expect(restored.attributes.components).toEqual({})
      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
      expect('polluted' in {}).toBe(false)
    })
  })
})
