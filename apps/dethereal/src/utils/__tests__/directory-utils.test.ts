import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// F-07 — `loadAllowedModelPaths` reads `~/.dethernety/models.json` via
// `os.homedir()`. On macOS, `homedir()` ignores `process.env.HOME` and
// reads from `getpwuid_r`, so a HOME override at the env level doesn't
// redirect the read. Mock the os module to point homedir at our temp dir
// so the F-07 test runs hermetically.
let mockedHome = ''
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: () => mockedHome || actual.homedir(),
  }
})

import { validatePathConfinement, isFlatFormat, normalizeFlatAttribute } from '../directory-utils.js'
import type { ModelStructure, ClassReference } from '@dethernety/dt-core'
import { flattenStructure } from '@dethernety/dt-core'

describe('validatePathConfinement', () => {
  const baseDir = '/home/user/models'

  it('should accept paths within the base directory', async () => {
    const result = await validatePathConfinement('/home/user/models/my-model', baseDir)
    expect(result).toBe('/home/user/models/my-model')
  })

  it('should accept the base directory itself', async () => {
    const result = await validatePathConfinement('/home/user/models', baseDir)
    expect(result).toBe('/home/user/models')
  })

  it('should reject paths outside the base directory', async () => {
    await expect(validatePathConfinement('/home/user/other', baseDir)).rejects.toThrow(
      'outside the allowed directory',
    )
  })

  it('should reject path traversal attempts', async () => {
    await expect(validatePathConfinement('/home/user/models/../secrets', baseDir)).rejects.toThrow(
      'outside the allowed directory',
    )
  })

  it('should reject paths that are prefixes but not subdirectories', async () => {
    // "/home/user/models-extra" starts with "/home/user/models" but is not a subdirectory
    await expect(validatePathConfinement('/home/user/models-extra', baseDir)).rejects.toThrow(
      'outside the allowed directory',
    )
  })

  it('should resolve relative paths against cwd when no base dir provided', async () => {
    const cwd = process.cwd()
    const result = await validatePathConfinement(`${cwd}/subdir`)
    expect(result).toBe(`${cwd}/subdir`)
  })

  it('should accept nested subdirectories', async () => {
    const result = await validatePathConfinement('/home/user/models/a/b/c', baseDir)
    expect(result).toBe('/home/user/models/a/b/c')
  })
})

describe('Sprint 4 F-07 — allowlist poisoning resistance', () => {
  // The bug: prior to F-07, anything in ~/.dethernety/models.json was trusted
  // unconditionally. A process running as the user could rewrite models.json
  // (it's a plain world-readable file) to point at /tmp or any other directory,
  // and every subsequent MCP-invoked control-library action would honour it.
  // Fix: each allowlist entry must itself be a legitimate model directory
  // (manifest.json present + parsable) before we honour it.

  let tempHome: string
  let poisonedTarget: string

  beforeEach(async () => {
    const fs = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')

    tempHome = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dtcl-home-')))
    mockedHome = tempHome // see vi.mock at top of file

    // Poisoned target — a real directory but NOT a model directory
    // (no manifest.json). Mirrors what an attacker would create. Use
    // realpath so symlinked tmpdirs (macOS /var → /private/var) match the
    // realpath-canonicalised value validatePathConfinement compares against.
    poisonedTarget = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'poisoned-')))

    // Write a models.json under the temp HOME pointing at the poisoned target.
    const dethernetyDir = path.join(tempHome, '.dethernety')
    await fs.mkdir(dethernetyDir, { recursive: true })
    await fs.writeFile(
      path.join(dethernetyDir, 'models.json'),
      JSON.stringify({ paths: [poisonedTarget] }),
    )
  })

  afterEach(async () => {
    const fs = await import('node:fs/promises')
    mockedHome = ''
    await fs.rm(tempHome, { recursive: true, force: true })
    await fs.rm(poisonedTarget, { recursive: true, force: true })
  })

  it('refuses an allowlisted path that lacks manifest.json (poisoned models.json)', async () => {
    // Without F-07, the substring match alone would honour poisonedTarget.
    // With F-07, isModelDirectory(poisonedTarget) returns false → no honour.
    await expect(validatePathConfinement(poisonedTarget, '/nonexistent/cwd')).rejects.toThrow(
      'outside the allowed directory',
    )
  })

  it('honours an allowlisted path that has manifest.json', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    // Promote the poisoned target to a legitimate model directory by
    // writing a manifest.json. The same path now passes confinement.
    await fs.writeFile(
      path.join(poisonedTarget, 'manifest.json'),
      JSON.stringify({ id: 'legitimate', name: 'legitimate' }),
    )
    const result = await validatePathConfinement(poisonedTarget, '/nonexistent/cwd')
    expect(result).toBe(poisonedTarget)
  })
})

// =============================================================================
// Flat-Format Detection and Normalization
// =============================================================================

describe('isFlatFormat', () => {
  it('should detect structured format (elementId + attributes object)', () => {
    expect(isFlatFormat({
      elementId: 'uuid-123',
      elementType: 'component',
      classData: { id: 'class-1', name: 'Web Server' },
      attributes: { authentication: 'OAuth2' }
    })).toBe(false)
  })

  it('should detect flat component format', () => {
    expect(isFlatFormat({
      componentId: 'c-postgres',
      name: 'PostgreSQL',
      type: 'STORE',
      authentication: 'password'
    })).toBe(true)
  })

  it('should detect flat boundary format', () => {
    expect(isFlatFormat({
      boundaryId: 'b-dmz',
      name: 'DMZ',
      implicit_deny_enabled: true
    })).toBe(true)
  })

  it('should detect flat dataFlow format', () => {
    expect(isFlatFormat({
      flowId: 'f-api-db',
      name: 'API to DB',
      required_credentials: ['db-cred']
    })).toBe(true)
  })

  it('should detect flat dataItem format', () => {
    expect(isFlatFormat({
      dataItemId: 'di-user-pii',
      name: 'User PII'
    })).toBe(true)
  })

  it('should treat ambiguous object without elementId or type-specific ID as not flat', () => {
    expect(isFlatFormat({ name: 'something', value: 42 })).toBe(false)
  })
})

describe('normalizeFlatAttribute', () => {
  const classData: ClassReference = { id: 'class-uuid-1', name: 'Database Server' }

  // Build a simple element lookup for testing
  function buildTestLookup() {
    const lookup = new Map<string, { id: string; name: string; elementType: 'boundary' | 'component' | 'dataFlow' | 'dataItem'; classData?: ClassReference }>()
    lookup.set('component:PostgreSQL', {
      id: 'uuid-postgres',
      name: 'PostgreSQL',
      elementType: 'component',
      classData,
    })
    lookup.set('boundary:DMZ', {
      id: 'uuid-dmz',
      name: 'DMZ',
      elementType: 'boundary',
      classData: { id: 'class-uuid-2', name: 'Network Zone' },
    })
    lookup.set('dataFlow:API to DB', {
      id: 'uuid-flow-1',
      name: 'API to DB',
      elementType: 'dataFlow',
    })
    return lookup
  }

  it('should normalize a flat component file', () => {
    const lookup = buildTestLookup()
    const result = normalizeFlatAttribute({
      componentId: 'c-postgres',
      name: 'PostgreSQL',
      type: 'STORE',
      authentication: 'password',
      authentication_notes: 'Password-based auth',
      encryption_in_transit: 'none',
      crown_jewel: true,
      tier: 1,
    }, 'components', lookup, 'c-postgres.json')

    expect(result).not.toBeNull()
    expect(result!.resolvedId).toBe('uuid-postgres')
    expect(result!.attrs.elementId).toBe('uuid-postgres')
    expect(result!.attrs.elementType).toBe('component')
    expect(result!.attrs.elementName).toBe('PostgreSQL')
    expect(result!.attrs.classData).toEqual(classData)

    // Metadata fields should NOT be in attributes
    expect(result!.attrs.attributes).not.toHaveProperty('componentId')
    expect(result!.attrs.attributes).not.toHaveProperty('name')
    expect(result!.attrs.attributes).not.toHaveProperty('type')

    // Attribute fields should be in attributes
    expect(result!.attrs.attributes).toHaveProperty('authentication', 'password')
    expect(result!.attrs.attributes).toHaveProperty('authentication_notes', 'Password-based auth')
    expect(result!.attrs.attributes).toHaveProperty('encryption_in_transit', 'none')
    expect(result!.attrs.attributes).toHaveProperty('crown_jewel', true)
    expect(result!.attrs.attributes).toHaveProperty('tier', 1)
  })

  it('should normalize a flat boundary file', () => {
    const lookup = buildTestLookup()
    const result = normalizeFlatAttribute({
      boundaryId: 'b-dmz',
      name: 'DMZ',
      type: 'NETWORK',
      implicit_deny_enabled: true,
      egress_filtering: 'deny_all',
    }, 'boundaries', lookup, 'b-dmz.json')

    expect(result).not.toBeNull()
    expect(result!.resolvedId).toBe('uuid-dmz')
    expect(result!.attrs.elementType).toBe('boundary')
    expect(result!.attrs.attributes).toHaveProperty('implicit_deny_enabled', true)
    expect(result!.attrs.attributes).toHaveProperty('egress_filtering', 'deny_all')
    // Metadata excluded
    expect(result!.attrs.attributes).not.toHaveProperty('boundaryId')
    expect(result!.attrs.attributes).not.toHaveProperty('name')
    expect(result!.attrs.attributes).not.toHaveProperty('type')
  })

  it('should normalize a flat dataFlow file', () => {
    const lookup = buildTestLookup()
    const result = normalizeFlatAttribute({
      flowId: 'f-api-db',
      name: 'API to DB',
      sourceId: 'c-api',
      targetId: 'c-postgres',
      crosses_boundary: true,
      required_credentials: ['db-cred'],
      auth_failure_mode: 'deny',
    }, 'dataFlows', lookup, 'f-api-db.json')

    expect(result).not.toBeNull()
    expect(result!.resolvedId).toBe('uuid-flow-1')
    expect(result!.attrs.elementType).toBe('dataFlow')
    // All flow metadata excluded
    expect(result!.attrs.attributes).not.toHaveProperty('flowId')
    expect(result!.attrs.attributes).not.toHaveProperty('sourceId')
    expect(result!.attrs.attributes).not.toHaveProperty('targetId')
    expect(result!.attrs.attributes).not.toHaveProperty('crosses_boundary')
    // Attribute fields included
    expect(result!.attrs.attributes).toHaveProperty('required_credentials')
    expect(result!.attrs.attributes).toHaveProperty('auth_failure_mode', 'deny')
  })

  it('should fall back to work-name ID when element not found in structure', () => {
    const lookup = buildTestLookup()
    const result = normalizeFlatAttribute({
      componentId: 'c-unknown',
      name: 'Unknown Service',
      authentication: 'none',
    }, 'components', lookup, 'c-unknown.json')

    expect(result).not.toBeNull()
    // Falls back to work-name since 'Unknown Service' is not in structure
    expect(result!.resolvedId).toBe('c-unknown')
    expect(result!.attrs.elementId).toBe('c-unknown')
    // classData should be empty placeholder
    expect(result!.attrs.classData).toBeUndefined()
  })

  it('should return null for unknown subdirectory', () => {
    const lookup = buildTestLookup()
    const result = normalizeFlatAttribute(
      { componentId: 'x', name: 'X' },
      'unknownSubdir',
      lookup,
      'x.json'
    )
    expect(result).toBeNull()
  })
})
