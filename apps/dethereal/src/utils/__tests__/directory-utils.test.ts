import { describe, it, expect } from 'vitest'
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
