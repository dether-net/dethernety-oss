import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { writeSyncJson, readSyncJson, computeContentHash, collectBaselineElementIds } from '../sync-utils.js'

describe('sync-utils', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(process.cwd(), '.test-sync-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function writeModel() {
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify({
      schemaVersion: '2.0.0', format: 'split',
      model: { id: 'model-1', name: 'Test', defaultBoundaryId: 'b-1' }
    }))
    await fs.writeFile(path.join(tmpDir, 'structure.json'), JSON.stringify({
      defaultBoundary: {
        id: 'b-1', name: 'System',
        components: [{ id: 'c-1', name: 'Server' }, { id: 'c-2', name: 'DB' }],
        boundaries: [{ id: 'b-2', name: 'DMZ', components: [{ id: 'c-3', name: 'LB' }] }]
      }
    }))
    await fs.writeFile(path.join(tmpDir, 'dataflows.json'), JSON.stringify({
      dataFlows: [
        { id: 'f-1', name: 'HTTP', source: { id: 'c-1' }, target: { id: 'c-2' } }
      ]
    }))
    await fs.writeFile(path.join(tmpDir, 'data-items.json'), JSON.stringify({
      dataItems: [{ id: 'd-1', name: 'User Data' }]
    }))
  }

  describe('writeSyncJson / readSyncJson', () => {
    it('should write and read sync.json roundtrip', async () => {
      const syncData = {
        platform_model_id: 'abc-123',
        platform_url: 'https://demo.dethernety.io',
        last_pull_at: '2026-03-26T10:00:00Z',
        baseline_element_ids: {
          boundaries: ['b-1', 'b-2'],
          components: ['c-1', 'c-2'],
          flows: ['f-1'],
          dataItems: ['d-1']
        },
        referenced_models: [] as string[]
      }

      await writeSyncJson(tmpDir, syncData)
      const result = await readSyncJson(tmpDir)

      expect(result).not.toBeNull()
      expect(result!.platform_model_id).toBe('abc-123')
      expect(result!.platform_url).toBe('https://demo.dethernety.io')
      expect(result!.last_pull_at).toBe('2026-03-26T10:00:00Z')
      expect(result!.baseline_element_ids.boundaries).toEqual(['b-1', 'b-2'])
    })

    it('should return null for nonexistent sync.json', async () => {
      const result = await readSyncJson(tmpDir)
      expect(result).toBeNull()
    })

    it('should merge with existing data on write', async () => {
      await writeSyncJson(tmpDir, {
        platform_model_id: 'abc-123',
        platform_url: 'https://demo.dethernety.io',
        last_pull_at: '2026-03-26T10:00:00Z'
      })

      await writeSyncJson(tmpDir, {
        last_push_at: '2026-03-26T12:00:00Z'
      })

      const result = await readSyncJson(tmpDir)
      expect(result!.platform_model_id).toBe('abc-123')
      expect(result!.last_pull_at).toBe('2026-03-26T10:00:00Z')
      expect(result!.last_push_at).toBe('2026-03-26T12:00:00Z')
    })
  })

  describe('computeContentHash', () => {
    it('should return consistent hash for same content', async () => {
      await writeModel()

      const hash1 = await computeContentHash(tmpDir)
      const hash2 = await computeContentHash(tmpDir)

      expect(hash1).toBe(hash2)
      expect(hash1).toMatch(/^sha256:[0-9a-f]{64}$/)
    })

    it('should exclude layout properties', async () => {
      await writeModel()
      const hash1 = await computeContentHash(tmpDir)

      // Add layout properties to structure
      const structurePath = path.join(tmpDir, 'structure.json')
      const structure = JSON.parse(await fs.readFile(structurePath, 'utf-8'))
      structure.defaultBoundary.positionX = 100
      structure.defaultBoundary.positionY = 200
      structure.defaultBoundary.dimensionsWidth = 500
      structure.defaultBoundary.dimensionsHeight = 300
      await fs.writeFile(structurePath, JSON.stringify(structure))

      const hash2 = await computeContentHash(tmpDir)
      expect(hash1).toBe(hash2)
    })
  })

  describe('collectBaselineElementIds', () => {
    it('should collect all element IDs', async () => {
      await writeModel()
      const ids = await collectBaselineElementIds(tmpDir)

      expect(ids.boundaries).toContain('b-1')
      expect(ids.boundaries).toContain('b-2')
      expect(ids.components).toContain('c-1')
      expect(ids.components).toContain('c-2')
      expect(ids.components).toContain('c-3')
      expect(ids.flows).toContain('f-1')
      expect(ids.dataItems).toContain('d-1')
    })

    it('should return empty arrays for empty model', async () => {
      const ids = await collectBaselineElementIds(tmpDir)
      expect(ids.boundaries).toEqual([])
      expect(ids.components).toEqual([])
      expect(ids.flows).toEqual([])
      expect(ids.dataItems).toEqual([])
    })
  })
})
