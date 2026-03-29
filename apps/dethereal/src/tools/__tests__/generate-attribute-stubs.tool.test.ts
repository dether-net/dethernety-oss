import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { generateAttributeStubsTool } from '../generate-attribute-stubs.tool.js'
import type { ToolContext } from '../base-tool.js'

// =============================================================================
// Mock DtClass — intercept the import so getClassById is testable
// =============================================================================

// Must use vi.hoisted() to define the mock fn before vi.mock hoists
const { mockGetClassById } = vi.hoisted(() => {
  return { mockGetClassById: vi.fn() }
})

vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    DtClass: class MockDtClass {
      constructor(_apolloClient: any) {}
      getClassById = mockGetClassById
    },
  }
})

// =============================================================================
// Test Helpers
// =============================================================================

const contextWithClient: ToolContext = {
  debug: false,
  apolloClient: {} as any, // Truthy — passes requiresClient check
}

const contextWithoutClient: ToolContext = { debug: false }

/** Minimal structure with classified components */
function makeStructure(components: Array<{ id: string; name: string; type?: string; classData?: any }>) {
  return {
    defaultBoundary: {
      id: 'b-root',
      name: 'System',
      components,
    },
  }
}

/** A class template with schema properties */
function makeClassTemplate(properties: Record<string, any>) {
  return {
    schema: { properties },
  }
}

/** Write a model directory with structure, dataflows, data-items */
async function writeModel(
  tmpDir: string,
  structure: any,
  dataFlows: any[] = [],
  dataItems: any[] = [],
) {
  await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify({
    schemaVersion: '2.0.0', format: 'split', model: { id: null, name: 'Test', defaultBoundaryId: 'b-root' },
  }, null, 2))
  await fs.writeFile(path.join(tmpDir, 'structure.json'), JSON.stringify(structure, null, 2))
  await fs.writeFile(path.join(tmpDir, 'dataflows.json'), JSON.stringify({ dataFlows }, null, 2))
  await fs.writeFile(path.join(tmpDir, 'data-items.json'), JSON.stringify({ dataItems }, null, 2))
  await fs.mkdir(path.join(tmpDir, 'attributes', 'boundaries'), { recursive: true })
  await fs.mkdir(path.join(tmpDir, 'attributes', 'components'), { recursive: true })
  await fs.mkdir(path.join(tmpDir, 'attributes', 'dataFlows'), { recursive: true })
  await fs.mkdir(path.join(tmpDir, 'attributes', 'dataItems'), { recursive: true })
}

// =============================================================================
// Tests
// =============================================================================

describe('GenerateAttributeStubsTool', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(process.cwd(), '.test-stubs-'))
    mockGetClassById.mockReset()
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  it('should have correct tool metadata', () => {
    expect(generateAttributeStubsTool.name).toBe('generate_attribute_stubs')
    expect(generateAttributeStubsTool.requiresClient).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Auth check
  // -------------------------------------------------------------------------

  it('should return error when no Apollo client', async () => {
    await writeModel(tmpDir, makeStructure([]))
    const result = await generateAttributeStubsTool.run(
      { directory_path: tmpDir },
      contextWithoutClient,
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('authentication')
  })

  // -------------------------------------------------------------------------
  // No classified elements
  // -------------------------------------------------------------------------

  it('should return zero counts when no elements are classified', async () => {
    await writeModel(tmpDir, makeStructure([
      { id: 'c-1', name: 'Unclassified' },
    ]))

    const result = await generateAttributeStubsTool.run(
      { directory_path: tmpDir },
      contextWithClient,
    )

    expect(result.success).toBe(true)
    expect(result.data!.generated).toBe(0)
    expect(result.data!.skipped).toBe(0)
    expect(result.data!.warnings).toContain('No classified elements found.')
    expect(mockGetClassById).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Basic stub generation — no existing file
  // -------------------------------------------------------------------------

  it('should create new attribute file from template when none exists', async () => {
    const classId = 'class-redis'
    await writeModel(tmpDir, makeStructure([
      { id: 'c-redis', name: 'Redis', type: 'STORE', classData: { id: classId, name: 'Redis' } },
    ]))

    mockGetClassById.mockResolvedValue({
      id: classId,
      name: 'Redis',
      template: makeClassTemplate({
        requirepass_present: { type: 'boolean', default: false },
        tls_enabled: { type: 'boolean' },
        bind_addresses: { type: 'string', default: '127.0.0.1' },
      }),
      guide: [{ option_name: 'requirepass_present' }],
    })

    const result = await generateAttributeStubsTool.run(
      { directory_path: tmpDir },
      contextWithClient,
    )

    expect(result.success).toBe(true)
    expect(result.data!.generated).toBe(1)
    expect(result.data!.cached_classes).toBe(1)
    expect(result.data!.failed).toHaveLength(0)

    // Verify attribute file
    const attrPath = path.join(tmpDir, 'attributes', 'components', 'c-redis.json')
    const attrs = JSON.parse(await fs.readFile(attrPath, 'utf-8'))
    expect(attrs.elementId).toBe('c-redis')
    expect(attrs.elementType).toBe('component')
    expect(attrs.elementName).toBe('Redis')
    expect(attrs.classData.id).toBe(classId)
    expect(attrs.attributes.requirepass_present).toBe(false) // default from schema
    expect(attrs.attributes.tls_enabled).toBeNull() // no default → null
    expect(attrs.attributes.bind_addresses).toBe('127.0.0.1') // default from schema

    // Verify class cache
    const cachePath = path.join(tmpDir, '.dethereal', 'class-cache', `${classId}.json`)
    const cache = JSON.parse(await fs.readFile(cachePath, 'utf-8'))
    expect(cache.classId).toBe(classId)
    expect(cache.className).toBe('Redis')
    expect(cache.classType).toBe('component')
    expect(cache.template).toBeDefined()

    // Verify template field manifest
    const manifestPath = path.join(tmpDir, '.dethereal', 'template-fields', 'c-redis.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'))
    expect(manifest.classId).toBe(classId)
    expect(manifest.templateFields).toContain('requirepass_present')
    expect(manifest.templateFields).toContain('tls_enabled')
    expect(manifest.templateFields).toContain('bind_addresses')
  })

  // -------------------------------------------------------------------------
  // Merge — existing values preserved
  // -------------------------------------------------------------------------

  it('should preserve existing attribute values during merge', async () => {
    const classId = 'class-pg'
    await writeModel(tmpDir, makeStructure([
      { id: 'c-pg', name: 'PostgreSQL', type: 'STORE', classData: { id: classId, name: 'PostgreSQL' } },
    ]))

    // Write existing attribute file with enriched values and plugin fields
    const existingAttrs = {
      elementId: 'c-pg',
      elementType: 'component',
      elementName: 'PostgreSQL',
      classData: { id: classId, name: 'PostgreSQL' },
      attributes: {
        ssl_enabled: true,             // enriched value — must NOT be overwritten
        crown_jewel: true,             // plugin field — must be preserved
        mitre_attack_techniques: ['T1078'],
      },
    }
    await fs.writeFile(
      path.join(tmpDir, 'attributes', 'components', 'c-pg.json'),
      JSON.stringify(existingAttrs, null, 2),
    )

    mockGetClassById.mockResolvedValue({
      id: classId,
      name: 'PostgreSQL',
      template: makeClassTemplate({
        ssl_enabled: { type: 'boolean', default: false }, // template default — existing TRUE wins
        log_connections: { type: 'boolean' },              // new field — added with null
        password_encryption: { type: 'string', default: 'scram-sha-256' },
      }),
      guide: [],
    })

    const result = await generateAttributeStubsTool.run(
      { directory_path: tmpDir },
      contextWithClient,
    )

    expect(result.success).toBe(true)
    expect(result.data!.generated).toBe(1)

    const attrs = JSON.parse(await fs.readFile(
      path.join(tmpDir, 'attributes', 'components', 'c-pg.json'), 'utf-8',
    ))

    // Existing enriched value preserved (not overwritten by template default)
    expect(attrs.attributes.ssl_enabled).toBe(true)

    // Plugin fields preserved
    expect(attrs.attributes.crown_jewel).toBe(true)
    expect(attrs.attributes.mitre_attack_techniques).toEqual(['T1078'])

    // New template fields added
    expect(attrs.attributes.log_connections).toBeNull()
    expect(attrs.attributes.password_encryption).toBe('scram-sha-256')
  })

  // -------------------------------------------------------------------------
  // Flat format normalization
  // -------------------------------------------------------------------------

  it('should normalize flat-format attribute files and merge template', async () => {
    const classId = 'class-nginx'
    await writeModel(tmpDir, makeStructure([
      { id: 'c-nginx', name: 'Nginx', type: 'PROCESS', classData: { id: classId, name: 'Nginx' } },
    ]))

    // Write flat-format file (agent-written)
    const flatAttrs = {
      componentId: 'c-nginx',
      name: 'Nginx',
      type: 'PROCESS',
      authentication: 'none',
      encryption_in_transit: 'TLS 1.3',
    }
    await fs.writeFile(
      path.join(tmpDir, 'attributes', 'components', 'c-nginx.json'),
      JSON.stringify(flatAttrs, null, 2),
    )

    mockGetClassById.mockResolvedValue({
      id: classId,
      name: 'Nginx',
      template: makeClassTemplate({
        allowed_tls_protocols: { type: 'string' },
        enable_hsts: { type: 'boolean', default: false },
      }),
      guide: [],
    })

    const result = await generateAttributeStubsTool.run(
      { directory_path: tmpDir },
      contextWithClient,
    )

    expect(result.success).toBe(true)

    const attrs = JSON.parse(await fs.readFile(
      path.join(tmpDir, 'attributes', 'components', 'c-nginx.json'), 'utf-8',
    ))

    // Should be in structured format now
    expect(attrs.elementId).toBe('c-nginx')
    expect(attrs.elementType).toBe('component')
    expect(attrs.attributes).toBeDefined()

    // Flat-format attributes preserved (metadata stripped)
    expect(attrs.attributes.authentication).toBe('none')
    expect(attrs.attributes.encryption_in_transit).toBe('TLS 1.3')
    // Metadata fields NOT in attributes
    expect(attrs.attributes.componentId).toBeUndefined()
    expect(attrs.attributes.name).toBeUndefined()
    expect(attrs.attributes.type).toBeUndefined()

    // Template fields added
    expect(attrs.attributes.allowed_tls_protocols).toBeNull()
    expect(attrs.attributes.enable_hsts).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Idempotency
  // -------------------------------------------------------------------------

  it('should be idempotent — second run skips already-stubbed elements', async () => {
    const classId = 'class-redis'
    await writeModel(tmpDir, makeStructure([
      { id: 'c-redis', name: 'Redis', type: 'STORE', classData: { id: classId, name: 'Redis' } },
    ]))

    const classResult = {
      id: classId,
      name: 'Redis',
      template: makeClassTemplate({
        requirepass_present: { type: 'boolean' },
        tls_enabled: { type: 'boolean' },
      }),
      guide: [],
    }
    mockGetClassById.mockResolvedValue(classResult)

    // First run
    const result1 = await generateAttributeStubsTool.run(
      { directory_path: tmpDir },
      contextWithClient,
    )
    expect(result1.success).toBe(true)
    expect(result1.data!.generated).toBe(1)
    expect(result1.data!.skipped).toBe(0)

    const attrs1 = await fs.readFile(
      path.join(tmpDir, 'attributes', 'components', 'c-redis.json'), 'utf-8',
    )

    // Second run — should skip
    const result2 = await generateAttributeStubsTool.run(
      { directory_path: tmpDir },
      contextWithClient,
    )
    expect(result2.success).toBe(true)
    expect(result2.data!.generated).toBe(0)
    expect(result2.data!.skipped).toBe(1)

    // File content unchanged (except modifiedAt timestamp)
    const attrs2 = JSON.parse(await fs.readFile(
      path.join(tmpDir, 'attributes', 'components', 'c-redis.json'), 'utf-8',
    ))
    expect(attrs2.attributes.requirepass_present).toBeNull()
    expect(attrs2.attributes.tls_enabled).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Class deduplication
  // -------------------------------------------------------------------------

  it('should deduplicate classes — 3 elements with 1 class = 1 fetch', async () => {
    const classId = 'class-svc'
    await writeModel(tmpDir, makeStructure([
      { id: 'c-1', name: 'Svc A', type: 'PROCESS', classData: { id: classId, name: 'Microservice' } },
      { id: 'c-2', name: 'Svc B', type: 'PROCESS', classData: { id: classId, name: 'Microservice' } },
      { id: 'c-3', name: 'Svc C', type: 'PROCESS', classData: { id: classId, name: 'Microservice' } },
    ]))

    mockGetClassById.mockResolvedValue({
      id: classId,
      name: 'Microservice',
      template: makeClassTemplate({
        health_check_enabled: { type: 'boolean', default: true },
      }),
      guide: [],
    })

    const result = await generateAttributeStubsTool.run(
      { directory_path: tmpDir },
      contextWithClient,
    )

    expect(result.success).toBe(true)
    expect(result.data!.generated).toBe(3)
    expect(result.data!.cached_classes).toBe(1)

    // DtClass.getClassById called exactly once despite 3 elements
    expect(mockGetClassById).toHaveBeenCalledTimes(1)
    expect(mockGetClassById).toHaveBeenCalledWith({ classId, classType: 'component' })
  })

  // -------------------------------------------------------------------------
  // Empty template — skip with warning
  // -------------------------------------------------------------------------

  it('should skip elements whose class has no template properties', async () => {
    const classId = 'class-empty'
    await writeModel(tmpDir, makeStructure([
      { id: 'c-1', name: 'Mystery', type: 'PROCESS', classData: { id: classId, name: 'Empty Class' } },
    ]))

    mockGetClassById.mockResolvedValue({
      id: classId,
      name: 'Empty Class',
      template: {}, // No schema
      guide: [],
    })

    const result = await generateAttributeStubsTool.run(
      { directory_path: tmpDir },
      contextWithClient,
    )

    expect(result.success).toBe(true)
    expect(result.data!.generated).toBe(0)
    expect(result.data!.skipped).toBe(1)
    expect(result.data!.warnings.length).toBeGreaterThan(0)
    expect(result.data!.warnings[0]).toContain('Empty Class')
  })

  // -------------------------------------------------------------------------
  // Filtered mode — element_ids
  // -------------------------------------------------------------------------

  it('should only generate stubs for specified element_ids', async () => {
    const classId = 'class-svc'
    await writeModel(tmpDir, makeStructure([
      { id: 'c-1', name: 'Svc A', type: 'PROCESS', classData: { id: classId, name: 'Microservice' } },
      { id: 'c-2', name: 'Svc B', type: 'PROCESS', classData: { id: classId, name: 'Microservice' } },
    ]))

    mockGetClassById.mockResolvedValue({
      id: classId,
      name: 'Microservice',
      template: makeClassTemplate({
        health_check_enabled: { type: 'boolean', default: true },
      }),
      guide: [],
    })

    const result = await generateAttributeStubsTool.run(
      { directory_path: tmpDir, element_ids: ['c-1'] },
      contextWithClient,
    )

    expect(result.success).toBe(true)
    expect(result.data!.generated).toBe(1)

    // Only c-1 should have an attribute file
    const c1Exists = await fs.stat(path.join(tmpDir, 'attributes', 'components', 'c-1.json')).then(() => true).catch(() => false)
    const c2Exists = await fs.stat(path.join(tmpDir, 'attributes', 'components', 'c-2.json')).then(() => true).catch(() => false)
    expect(c1Exists).toBe(true)
    expect(c2Exists).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Failed class fetch — element added to failed[]
  // -------------------------------------------------------------------------

  it('should add elements to failed when class fetch fails', async () => {
    await writeModel(tmpDir, makeStructure([
      { id: 'c-1', name: 'Broken', type: 'STORE', classData: { id: 'class-missing', name: 'Missing' } },
    ]))

    mockGetClassById.mockResolvedValue(undefined) // class not found

    const result = await generateAttributeStubsTool.run(
      { directory_path: tmpDir },
      contextWithClient,
    )

    expect(result.success).toBe(true)
    expect(result.data!.generated).toBe(0)
    expect(result.data!.failed).toHaveLength(1)
    expect(result.data!.failed[0].element_id).toBe('c-1')
  })

  // -------------------------------------------------------------------------
  // Default extraction
  // -------------------------------------------------------------------------

  it('should use schema defaults and null for properties without defaults', async () => {
    const classId = 'class-db'
    await writeModel(tmpDir, makeStructure([
      { id: 'c-db', name: 'DB', type: 'STORE', classData: { id: classId, name: 'Database' } },
    ]))

    mockGetClassById.mockResolvedValue({
      id: classId,
      name: 'Database',
      template: makeClassTemplate({
        ssl_enabled: { type: 'boolean', default: true },
        max_connections: { type: 'number', default: 100 },
        log_format: { type: 'string' }, // no default
        backup_enabled: { type: 'boolean', default: false },
      }),
      guide: [],
    })

    const result = await generateAttributeStubsTool.run(
      { directory_path: tmpDir },
      contextWithClient,
    )

    expect(result.success).toBe(true)
    const attrs = JSON.parse(await fs.readFile(
      path.join(tmpDir, 'attributes', 'components', 'c-db.json'), 'utf-8',
    ))

    expect(attrs.attributes.ssl_enabled).toBe(true)
    expect(attrs.attributes.max_connections).toBe(100)
    expect(attrs.attributes.log_format).toBeNull()
    expect(attrs.attributes.backup_enabled).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Cache fallback (S8.4)
  // -------------------------------------------------------------------------

  describe('Cache fallback (S8.4)', () => {
    it('should use class cache as fallback when platform fetch throws', async () => {
      const classId = 'class-redis'
      await writeModel(tmpDir, makeStructure([
        { id: 'c-redis', name: 'Redis', type: 'STORE', classData: { id: classId, name: 'Redis' } },
      ]))

      // Pre-populate cache (simulating a previous successful run)
      const classCacheDir = path.join(tmpDir, '.dethereal', 'class-cache')
      await fs.mkdir(classCacheDir, { recursive: true })
      await fs.writeFile(path.join(classCacheDir, `${classId}.json`), JSON.stringify({
        classId,
        className: 'Redis',
        classType: 'component',
        cachedAt: new Date().toISOString(),
        template: makeClassTemplate({
          requirepass_present: { type: 'boolean', default: false },
          tls_enabled: { type: 'boolean' },
        }),
        guide: [{ option_name: 'requirepass_present' }],
      }, null, 2))

      // Platform fails
      mockGetClassById.mockRejectedValue(new Error('Network error'))

      const result = await generateAttributeStubsTool.run(
        { directory_path: tmpDir },
        contextWithClient,
      )

      expect(result.success).toBe(true)
      expect(result.data!.generated).toBe(1)
      expect(result.data!.failed).toHaveLength(0)
      expect(result.data!.warnings.some(w => w.includes('loaded from cache'))).toBe(true)

      // Verify attribute file was created from cached template
      const attrs = JSON.parse(await fs.readFile(
        path.join(tmpDir, 'attributes', 'components', 'c-redis.json'), 'utf-8',
      ))
      expect(attrs.attributes.requirepass_present).toBe(false)
      expect(attrs.attributes.tls_enabled).toBeNull()
    })

    it('should fail elements when platform fetch fails and no cache exists', async () => {
      await writeModel(tmpDir, makeStructure([
        { id: 'c-1', name: 'Mystery', type: 'STORE', classData: { id: 'class-missing', name: 'Missing' } },
      ]))

      mockGetClassById.mockRejectedValue(new Error('Network error'))

      const result = await generateAttributeStubsTool.run(
        { directory_path: tmpDir },
        contextWithClient,
      )

      expect(result.success).toBe(true)
      expect(result.data!.generated).toBe(0)
      expect(result.data!.failed).toHaveLength(1)
      expect(result.data!.failed[0].reason).toContain('no cache available')
    })

    it('should produce staleness warning when cache is older than 7 days', async () => {
      const classId = 'class-old'
      await writeModel(tmpDir, makeStructure([
        { id: 'c-old', name: 'OldService', type: 'PROCESS', classData: { id: classId, name: 'OldService' } },
      ]))

      // Write cache with date > 7 days ago
      const classCacheDir = path.join(tmpDir, '.dethereal', 'class-cache')
      await fs.mkdir(classCacheDir, { recursive: true })
      const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
      await fs.writeFile(path.join(classCacheDir, `${classId}.json`), JSON.stringify({
        classId,
        className: 'OldService',
        classType: 'component',
        cachedAt: staleDate,
        template: makeClassTemplate({
          health_check: { type: 'boolean', default: true },
        }),
        guide: [],
      }, null, 2))

      mockGetClassById.mockResolvedValue(undefined) // null return

      const result = await generateAttributeStubsTool.run(
        { directory_path: tmpDir },
        contextWithClient,
      )

      expect(result.success).toBe(true)
      expect(result.data!.generated).toBe(1)
      expect(result.data!.failed).toHaveLength(0)
      expect(result.data!.warnings.some(w => w.includes('older than 7 days'))).toBe(true)

      // Stubs still generated despite staleness
      const attrs = JSON.parse(await fs.readFile(
        path.join(tmpDir, 'attributes', 'components', 'c-old.json'), 'utf-8',
      ))
      expect(attrs.attributes.health_check).toBe(true)
    })

    it('should use cache fallback when getClassById returns null', async () => {
      const classId = 'class-null'
      await writeModel(tmpDir, makeStructure([
        { id: 'c-null', name: 'NullClass', type: 'PROCESS', classData: { id: classId, name: 'NullClass' } },
      ]))

      const classCacheDir = path.join(tmpDir, '.dethereal', 'class-cache')
      await fs.mkdir(classCacheDir, { recursive: true })
      await fs.writeFile(path.join(classCacheDir, `${classId}.json`), JSON.stringify({
        classId,
        className: 'NullClass',
        classType: 'component',
        cachedAt: new Date().toISOString(),
        template: makeClassTemplate({ port: { type: 'number', default: 8080 } }),
        guide: [],
      }, null, 2))

      mockGetClassById.mockResolvedValue(undefined) // returns null/undefined

      const result = await generateAttributeStubsTool.run(
        { directory_path: tmpDir },
        contextWithClient,
      )

      expect(result.success).toBe(true)
      expect(result.data!.generated).toBe(1)
      expect(result.data!.failed).toHaveLength(0)
      expect(result.data!.warnings.some(w => w.includes('loaded from cache'))).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Reclassification (S8.6)
  // -------------------------------------------------------------------------

  describe('Reclassification (S8.6)', () => {
    it('should remove unenriched old template fields and add new ones on reclassification', async () => {
      const oldClassId = 'class-mysql'
      const newClassId = 'class-postgres'
      await writeModel(tmpDir, makeStructure([
        { id: 'c-db', name: 'Database', type: 'STORE',
          classData: { id: newClassId, name: 'PostgreSQL' } },
      ]))

      // Write existing attribute file (was MySQL)
      await fs.writeFile(
        path.join(tmpDir, 'attributes', 'components', 'c-db.json'),
        JSON.stringify({
          elementId: 'c-db', elementType: 'component', elementName: 'Database',
          classData: { id: oldClassId, name: 'MySQL' },
          attributes: {
            innodb_buffer_pool_size: null,  // MySQL-specific, unenriched → REMOVED
            ssl_enabled: true,              // enriched → KEPT
            crown_jewel: true,              // plugin field → KEPT
          },
        }, null, 2),
      )

      // Write old manifest (MySQL)
      const templateFieldsDir = path.join(tmpDir, '.dethereal', 'template-fields')
      await fs.mkdir(templateFieldsDir, { recursive: true })
      await fs.writeFile(path.join(templateFieldsDir, 'c-db.json'), JSON.stringify({
        classId: oldClassId,
        className: 'MySQL',
        templateFields: ['innodb_buffer_pool_size', 'ssl_enabled'],
        generatedAt: new Date().toISOString(),
      }, null, 2))

      // New class (PostgreSQL) template
      mockGetClassById.mockResolvedValue({
        id: newClassId, name: 'PostgreSQL',
        template: makeClassTemplate({
          ssl_enabled: { type: 'boolean', default: false },  // shared field
          log_connections: { type: 'boolean' },               // new field
          password_encryption: { type: 'string', default: 'scram-sha-256' },
        }),
        guide: [],
      })

      const result = await generateAttributeStubsTool.run(
        { directory_path: tmpDir }, contextWithClient,
      )

      expect(result.success).toBe(true)
      expect(result.data!.reclassified).toBe(1)

      const attrs = JSON.parse(await fs.readFile(
        path.join(tmpDir, 'attributes', 'components', 'c-db.json'), 'utf-8',
      ))

      // Old unenriched field removed
      expect(attrs.attributes.innodb_buffer_pool_size).toBeUndefined()
      // Enriched shared field preserved (not overwritten by default false)
      expect(attrs.attributes.ssl_enabled).toBe(true)
      // New fields added
      expect(attrs.attributes.log_connections).toBeNull()
      expect(attrs.attributes.password_encryption).toBe('scram-sha-256')
      // Plugin field untouched
      expect(attrs.attributes.crown_jewel).toBe(true)

      // Manifest updated to new class
      const manifest = JSON.parse(await fs.readFile(
        path.join(templateFieldsDir, 'c-db.json'), 'utf-8',
      ))
      expect(manifest.classId).toBe(newClassId)
      expect(manifest.templateFields).toContain('log_connections')
      expect(manifest.templateFields).not.toContain('innodb_buffer_pool_size')
    })

    it('should preserve enriched (non-null) old template fields during reclassification', async () => {
      const oldClassId = 'class-a'
      const newClassId = 'class-b'
      await writeModel(tmpDir, makeStructure([
        { id: 'c-1', name: 'Svc', type: 'PROCESS',
          classData: { id: newClassId, name: 'ClassB' } },
      ]))

      await fs.writeFile(
        path.join(tmpDir, 'attributes', 'components', 'c-1.json'),
        JSON.stringify({
          elementId: 'c-1', elementType: 'component', elementName: 'Svc',
          classData: { id: oldClassId, name: 'ClassA' },
          attributes: {
            old_field_enriched: 'important-value',  // enriched → keep
            old_field_null: null,                    // unenriched → remove
          },
        }, null, 2),
      )

      const templateFieldsDir = path.join(tmpDir, '.dethereal', 'template-fields')
      await fs.mkdir(templateFieldsDir, { recursive: true })
      await fs.writeFile(path.join(templateFieldsDir, 'c-1.json'), JSON.stringify({
        classId: oldClassId, className: 'ClassA',
        templateFields: ['old_field_enriched', 'old_field_null'],
        generatedAt: new Date().toISOString(),
      }, null, 2))

      mockGetClassById.mockResolvedValue({
        id: newClassId, name: 'ClassB',
        template: makeClassTemplate({ new_field: { type: 'string' } }),
        guide: [],
      })

      const result = await generateAttributeStubsTool.run(
        { directory_path: tmpDir }, contextWithClient,
      )

      expect(result.success).toBe(true)
      expect(result.data!.reclassified).toBe(1)

      const attrs = JSON.parse(await fs.readFile(
        path.join(tmpDir, 'attributes', 'components', 'c-1.json'), 'utf-8',
      ))

      expect(attrs.attributes.old_field_enriched).toBe('important-value')
      expect(attrs.attributes.old_field_null).toBeUndefined()
      expect(attrs.attributes.new_field).toBeNull()
    })

    it('should never touch plugin fields during reclassification', async () => {
      const oldClassId = 'class-old'
      const newClassId = 'class-new'
      await writeModel(tmpDir, makeStructure([
        { id: 'c-1', name: 'Store', type: 'STORE',
          classData: { id: newClassId, name: 'NewStore' } },
      ]))

      await fs.writeFile(
        path.join(tmpDir, 'attributes', 'components', 'c-1.json'),
        JSON.stringify({
          elementId: 'c-1', elementType: 'component', elementName: 'Store',
          classData: { id: oldClassId, name: 'OldStore' },
          attributes: {
            crown_jewel: true,
            credential_scope: ['db-creds'],
            mitre_attack_techniques: ['T1078'],
            monitoring_tools: ['SIEM'],
            old_template_field: null,
          },
        }, null, 2),
      )

      const templateFieldsDir = path.join(tmpDir, '.dethereal', 'template-fields')
      await fs.mkdir(templateFieldsDir, { recursive: true })
      await fs.writeFile(path.join(templateFieldsDir, 'c-1.json'), JSON.stringify({
        classId: oldClassId, className: 'OldStore',
        templateFields: ['old_template_field'],
        generatedAt: new Date().toISOString(),
      }, null, 2))

      mockGetClassById.mockResolvedValue({
        id: newClassId, name: 'NewStore',
        template: makeClassTemplate({ new_field: { type: 'boolean', default: false } }),
        guide: [],
      })

      const result = await generateAttributeStubsTool.run(
        { directory_path: tmpDir }, contextWithClient,
      )

      expect(result.success).toBe(true)
      const attrs = JSON.parse(await fs.readFile(
        path.join(tmpDir, 'attributes', 'components', 'c-1.json'), 'utf-8',
      ))

      // All plugin fields preserved
      expect(attrs.attributes.crown_jewel).toBe(true)
      expect(attrs.attributes.credential_scope).toEqual(['db-creds'])
      expect(attrs.attributes.mitre_attack_techniques).toEqual(['T1078'])
      expect(attrs.attributes.monitoring_tools).toEqual(['SIEM'])
      // Old template field removed, new added
      expect(attrs.attributes.old_template_field).toBeUndefined()
      expect(attrs.attributes.new_field).toBe(false)
    })

    it('should not count as reclassification when class has not changed', async () => {
      const classId = 'class-redis'
      await writeModel(tmpDir, makeStructure([
        { id: 'c-redis', name: 'Redis', type: 'STORE',
          classData: { id: classId, name: 'Redis' } },
      ]))

      await fs.writeFile(
        path.join(tmpDir, 'attributes', 'components', 'c-redis.json'),
        JSON.stringify({
          elementId: 'c-redis', elementType: 'component', elementName: 'Redis',
          classData: { id: classId, name: 'Redis' },
          attributes: { requirepass_present: true },
        }, null, 2),
      )

      const templateFieldsDir = path.join(tmpDir, '.dethereal', 'template-fields')
      await fs.mkdir(templateFieldsDir, { recursive: true })
      await fs.writeFile(path.join(templateFieldsDir, 'c-redis.json'), JSON.stringify({
        classId, className: 'Redis',
        templateFields: ['requirepass_present', 'tls_enabled'],
        generatedAt: new Date().toISOString(),
      }, null, 2))

      mockGetClassById.mockResolvedValue({
        id: classId, name: 'Redis',
        template: makeClassTemplate({
          requirepass_present: { type: 'boolean', default: false },
          tls_enabled: { type: 'boolean' },
        }),
        guide: [],
      })

      const result = await generateAttributeStubsTool.run(
        { directory_path: tmpDir }, contextWithClient,
      )

      expect(result.success).toBe(true)
      expect(result.data!.reclassified).toBe(0)
    })

    it('should treat missing manifest as first-time generation, not reclassification', async () => {
      const classId = 'class-new'
      await writeModel(tmpDir, makeStructure([
        { id: 'c-1', name: 'New', type: 'PROCESS',
          classData: { id: classId, name: 'NewClass' } },
      ]))

      mockGetClassById.mockResolvedValue({
        id: classId, name: 'NewClass',
        template: makeClassTemplate({ field1: { type: 'string' } }),
        guide: [],
      })

      const result = await generateAttributeStubsTool.run(
        { directory_path: tmpDir }, contextWithClient,
      )

      expect(result.success).toBe(true)
      expect(result.data!.reclassified).toBe(0)
      expect(result.data!.generated).toBe(1)
    })

    it('should preserve enriched value for a field in both old and new template', async () => {
      const oldClassId = 'class-mysql'
      const newClassId = 'class-postgres'
      await writeModel(tmpDir, makeStructure([
        { id: 'c-db', name: 'DB', type: 'STORE',
          classData: { id: newClassId, name: 'PostgreSQL' } },
      ]))

      await fs.writeFile(
        path.join(tmpDir, 'attributes', 'components', 'c-db.json'),
        JSON.stringify({
          elementId: 'c-db', elementType: 'component', elementName: 'DB',
          classData: { id: oldClassId, name: 'MySQL' },
          attributes: {
            max_connections: 200,    // enriched, shared between MySQL and PostgreSQL
            innodb_setting: null,    // MySQL-only, unenriched
          },
        }, null, 2),
      )

      const templateFieldsDir = path.join(tmpDir, '.dethereal', 'template-fields')
      await fs.mkdir(templateFieldsDir, { recursive: true })
      await fs.writeFile(path.join(templateFieldsDir, 'c-db.json'), JSON.stringify({
        classId: oldClassId, className: 'MySQL',
        templateFields: ['max_connections', 'innodb_setting'],
        generatedAt: new Date().toISOString(),
      }, null, 2))

      mockGetClassById.mockResolvedValue({
        id: newClassId, name: 'PostgreSQL',
        template: makeClassTemplate({
          max_connections: { type: 'number', default: 100 }, // same name, different default
          wal_level: { type: 'string', default: 'replica' },  // PostgreSQL-only
        }),
        guide: [],
      })

      const result = await generateAttributeStubsTool.run(
        { directory_path: tmpDir }, contextWithClient,
      )

      expect(result.success).toBe(true)
      expect(result.data!.reclassified).toBe(1)

      const attrs = JSON.parse(await fs.readFile(
        path.join(tmpDir, 'attributes', 'components', 'c-db.json'), 'utf-8',
      ))

      // Enriched shared field: user's value (200) preserved, NOT overwritten by new default (100)
      expect(attrs.attributes.max_connections).toBe(200)
      // MySQL-only unenriched field removed
      expect(attrs.attributes.innodb_setting).toBeUndefined()
      // PostgreSQL-only new field added
      expect(attrs.attributes.wal_level).toBe('replica')
    })
  })
})
