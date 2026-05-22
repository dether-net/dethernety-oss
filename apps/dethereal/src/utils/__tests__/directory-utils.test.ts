import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// `loadAllowedModelPaths` reads `~/.dethernety/models.json` via
// `os.homedir()`. On macOS, `homedir()` ignores `process.env.HOME` and
// reads from `getpwuid_r`, so a HOME override at the env level doesn't
// redirect the read. Mock the os module to point homedir at our temp dir
// so the allowlist-poisoning test runs hermetically.
let mockedHome = ''
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: () => mockedHome || actual.homedir(),
  }
})

import { promises as fs } from 'fs'
import path from 'path'
import {
  validatePathConfinement,
  isFlatFormat,
  normalizeFlatAttribute,
  readScope,
  writeScope,
  localOnlyCrownJewelNotice,
  writeModelDirectory,
  readModelDirectory,
} from '../directory-utils.js'
import type { ModelStructure, ClassReference, SplitModel } from '@dethernety/dt-core'
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

describe('allowlist poisoning resistance', () => {
  // The bug: previously, anything in ~/.dethernety/models.json was trusted
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
    // Without the manifest check, the substring match alone would honour
    // poisonedTarget. With it, isModelDirectory(poisonedTarget) returns
    // false → no honour.
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
      monitoring_enabled: true,
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
    expect(result!.attrs.attributes).toHaveProperty('monitoring_enabled', true)
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

// =============================================================================
// Asset-context scope I/O — .dethereal/scope.json
// =============================================================================

describe('readScope / writeScope', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(process.cwd(), '.test-scope-'))
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function writeRawScope(obj: Record<string, unknown>) {
    const d = path.join(tmpDir, '.dethereal')
    await fs.mkdir(d, { recursive: true })
    await fs.writeFile(path.join(d, 'scope.json'), JSON.stringify(obj, null, 2), 'utf-8')
  }
  async function readRawScope(): Promise<Record<string, unknown>> {
    return JSON.parse(await fs.readFile(path.join(tmpDir, '.dethereal', 'scope.json'), 'utf-8'))
  }

  it('readScope projects to the five synced keys, dropping local-only keys', async () => {
    await writeRawScope({
      depth: 'design',
      modeling_intent: 'security_review',
      compliance_drivers: ['PCI cardholder'],
      exclusions: [],
      trust_assumptions: ['cloud control plane'],
      // local-only — must NOT appear in the projection
      crown_jewels: ['Cardholder DB'],
      adversary_classes: ['nation-state'],
      activeModules: ['dethernety-module'],
      system_name: 'Shop',
    })
    const scope = await readScope(tmpDir)
    expect(scope).toEqual({
      depth: 'design',
      modeling_intent: 'security_review',
      compliance_drivers: ['PCI cardholder'],
      exclusions: [],
      trust_assumptions: ['cloud control plane'],
    })
    expect(scope).not.toHaveProperty('crown_jewels')
  })

  it('readScope returns null when scope.json is absent', async () => {
    expect(await readScope(tmpDir)).toBeNull()
  })

  it('readScope returns null when no synced keys are present', async () => {
    await writeRawScope({ crown_jewels: ['Cardholder DB'], system_name: 'Shop' })
    expect(await readScope(tmpDir)).toBeNull()
  })

  it('writeScope preserves local-only keys while overwriting the synced keys', async () => {
    await writeRawScope({
      depth: 'architecture',
      compliance_drivers: ['stale'],
      crown_jewels: ['Cardholder DB'],
      adversary_classes: ['nation-state'],
      activeModules: ['dethernety-module'],
      declared_governance_controls: ['SOC2'],
    })
    await writeScope(tmpDir, {
      depth: 'design',
      modeling_intent: 'compliance',
      compliance_drivers: ['PCI cardholder'],
    })
    const raw = await readRawScope()
    // synced keys set/replaced
    expect(raw.depth).toBe('design')
    expect(raw.modeling_intent).toBe('compliance')
    expect(raw.compliance_drivers).toEqual(['PCI cardholder'])
    // local-only keys preserved
    expect(raw.crown_jewels).toEqual(['Cardholder DB'])
    expect(raw.adversary_classes).toEqual(['nation-state'])
    expect(raw.activeModules).toEqual(['dethernety-module'])
    expect(raw.declared_governance_controls).toEqual(['SOC2'])
  })

  it('writeScope deletes a synced key absent from the new scope (REPLACE mirror), keeping local-only', async () => {
    await writeRawScope({ depth: 'design', exclusions: ['legacy'], crown_jewels: ['Cardholder DB'] })
    await writeScope(tmpDir, { depth: 'design' }) // exclusions absent → cleared
    const raw = await readRawScope()
    expect(raw).not.toHaveProperty('exclusions')
    expect(raw.depth).toBe('design')
    expect(raw.crown_jewels).toEqual(['Cardholder DB'])
  })

  it('writeScope creates scope.json when absent', async () => {
    await writeScope(tmpDir, { depth: 'implementation', trust_assumptions: ['vendor'] })
    expect(await readRawScope()).toEqual({ depth: 'implementation', trust_assumptions: ['vendor'] })
  })

  it('writeScope({}) clears stale synced keys but preserves local-only keys (empty platform scope)', async () => {
    // The platform has no scope; the pull/push tools call writeScope(dir, scope ?? {}).
    await writeRawScope({ depth: 'design', compliance_drivers: ['stale'], crown_jewels: ['Cardholder DB'] })
    await writeScope(tmpDir, {})
    const raw = await readRawScope()
    expect(raw).not.toHaveProperty('depth')
    expect(raw).not.toHaveProperty('compliance_drivers')
    expect(raw.crown_jewels).toEqual(['Cardholder DB'])
  })

  it('writeScope({}) does not materialise a scope.json when none exists', async () => {
    await writeScope(tmpDir, {})
    await expect(readRawScope()).rejects.toThrow() // file was never created
  })

  it('writeScope fails loud on a malformed existing scope.json (does not destroy local-only keys)', async () => {
    const d = path.join(tmpDir, '.dethereal')
    await fs.mkdir(d, { recursive: true })
    const malformed = '{ "crown_jewels": ["Cardholder DB"], '  // truncated JSON
    await fs.writeFile(path.join(d, 'scope.json'), malformed, 'utf-8')
    await expect(writeScope(tmpDir, { depth: 'design' })).rejects.toThrow(/malformed/i)
    // the corrupt file is left intact for the user to fix, not clobbered
    expect(await fs.readFile(path.join(d, 'scope.json'), 'utf-8')).toBe(malformed)
  })

  it('readScope(writeScope(x)) round-trips the synced view', async () => {
    const scope = {
      depth: 'design',
      modeling_intent: 'initial',
      compliance_drivers: ['PCI cardholder', 'PHI'],
      exclusions: ['legacy'],
      trust_assumptions: ['cloud control plane'],
    }
    await writeScope(tmpDir, scope)
    expect(await readScope(tmpDir)).toEqual(scope)
  })
})

describe('localOnlyCrownJewelNotice', () => {
  it('counts data-item bags with crown_jewel (top-level and nested) and returns a notice', () => {
    const notice = localOnlyCrownJewelNotice({
      dataItems: {
        d1: { elementId: 'd1', elementType: 'dataItem', crown_jewel: true } as any,
        d2: { elementId: 'd2', elementType: 'dataItem', attributes: { crown_jewel: true } },
        d3: { elementId: 'd3', elementType: 'dataItem', attributes: { sensitivity: 'restricted' } },
      },
    })
    expect(notice).toContain('2')
    expect(notice).toMatch(/local-only/i)
  })

  it('counts boundary and flow bags too', () => {
    const notice = localOnlyCrownJewelNotice({
      boundaries: { b1: { elementId: 'b1', elementType: 'boundary', crown_jewel: true } as any },
      dataFlows: { f1: { elementId: 'f1', elementType: 'dataFlow', attributes: { crown_jewel: true } } },
    })
    expect(notice).toContain('2')
  })

  it('does NOT count component bags (they sync via the dt-core lift)', () => {
    const notice = localOnlyCrownJewelNotice({
      components: {
        c1: { elementId: 'c1', elementType: 'component', crown_jewel: true } as any,
        c2: { elementId: 'c2', elementType: 'component', attributes: { crown_jewel: true } },
      },
    })
    expect(notice).toBeNull()
  })

  it('returns null when there are no crown-jewel marks', () => {
    expect(
      localOnlyCrownJewelNotice({
        dataItems: { d1: { elementId: 'd1', elementType: 'dataItem', attributes: { sensitivity: 'public' } } },
      }),
    ).toBeNull()
    expect(localOnlyCrownJewelNotice({})).toBeNull()
  })
})

describe('asset-context round-trip + scope strip', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(process.cwd(), '.test-ac-'))
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  function buildModel(scope?: Record<string, unknown>): SplitModel {
    return {
      manifest: {
        schemaVersion: '2.0.0',
        format: 'split',
        model: { id: 'm1', name: 'Shop', defaultBoundaryId: 'b1', ...(scope ? { scope } : {}) },
        modules: [],
        files: {
          structure: 'structure.json',
          dataFlows: 'dataflows.json',
          dataItems: 'data-items.json',
          attributes: 'attributes',
        },
      },
      structure: {
        defaultBoundary: { id: 'b1', name: 'System', boundaries: [], components: [{ id: 'c1', name: 'API', crownJewel: true }] },
      },
      dataFlows: [],
      dataItems: [{ id: 'd1', name: 'Cardholder', sensitivity: 'restricted', regulatory_flags: ['PCI cardholder'] }],
      attributes: {
        components: {
          c1: { elementId: 'c1', elementType: 'component', elementName: 'API', attributes: { monitoring_enabled: true } },
        },
      },
    } as unknown as SplitModel
  }

  it('writeModelDirectory→readModelDirectory preserves data-item sensitivity/regulatory_flags, component crownJewel (structure.json), and the attribute bag', async () => {
    await writeModelDirectory(tmpDir, buildModel())
    const read = await readModelDirectory(tmpDir)
    const di = read.dataItems.find((d) => d.id === 'd1')
    expect(di?.sensitivity).toBe('restricted')
    expect(di?.regulatory_flags).toEqual(['PCI cardholder'])
    // crownJewel is a first-class structure.json field and round-trips there
    const c1 = read.structure.defaultBoundary.components?.find((c: any) => c.id === 'c1')
    expect(c1?.crownJewel).toBe(true)
    // arbitrary bag attributes are preserved
    expect(read.attributes.components?.['c1']?.attributes?.monitoring_enabled).toBe(true)
  })

  it('pull strip sequence: scope.json holds the synced keys, manifest.json carries none', async () => {
    const model = buildModel({ depth: 'design', compliance_drivers: ['PCI cardholder'] })
    // Mirror export-model.tool.ts: capture → strip → write → materialise.
    const scope = model.manifest.model.scope
    if (scope) delete model.manifest.model.scope
    await writeModelDirectory(tmpDir, model)
    if (scope) await writeScope(tmpDir, scope)

    const manifestRaw = JSON.parse(await fs.readFile(path.join(tmpDir, 'manifest.json'), 'utf-8'))
    expect(manifestRaw.model).not.toHaveProperty('scope')
    expect(await readScope(tmpDir)).toEqual({ depth: 'design', compliance_drivers: ['PCI cardholder'] })
  })
})
