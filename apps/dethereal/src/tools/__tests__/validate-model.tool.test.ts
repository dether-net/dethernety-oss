import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { validateModelTool } from '../validate-model.tool.js'
import type { ToolContext } from '../base-tool.js'

const context: ToolContext = { debug: false }

describe('ValidateModelTool', () => {
  describe('metadata', () => {
    it('should have the correct tool name', () => {
      expect(validateModelTool.name).toBe('validate_model_json')
    })

    it('should not require a client', () => {
      expect(validateModelTool.requiresClient).toBe(false)
    })
  })

  describe('inline validation', () => {
    it('should validate a valid manifest', async () => {
      const result = await validateModelTool.run(
        {
          data: {
            schemaVersion: '2.0.0',
            format: 'split',
            model: {
              id: null,
              name: 'Test Model',
              defaultBoundaryId: 'boundary-1',
            },
            modules: [],
          },
          file_type: 'manifest',
        },
        context,
      )

      expect(result.success).toBe(true)
      expect((result.data as any)?.valid).toBe(true)
      expect((result.data as any)?.errors).toHaveLength(0)
    })

    it('should reject invalid manifest (missing name)', async () => {
      const result = await validateModelTool.run(
        {
          data: {
            schemaVersion: '2.0.0',
            format: 'split',
            model: {
              id: null,
              defaultBoundaryId: 'b-1',
            },
          },
          file_type: 'manifest',
        },
        context,
      )

      expect(result.success).toBe(true)
      expect((result.data as any)?.valid).toBe(false)
      expect((result.data as any)!.errors.length).toBeGreaterThan(0)
    })

    it('should validate a valid structure', async () => {
      const result = await validateModelTool.run(
        {
          data: {
            defaultBoundary: {
              id: 'b-1',
              name: 'System',
            },
          },
          file_type: 'structure',
        },
        context,
      )

      expect(result.success).toBe(true)
      expect((result.data as any)?.valid).toBe(true)
    })

    it('should accept an explicit-null classData on a data item (unassign sentinel)', async () => {
      // The `data` input accepts string | object — arrays ride in as JSON strings.
      const result = await validateModelTool.run(
        {
          data: JSON.stringify([
            { id: 'di-1', name: 'PII', classData: null },
            { id: 'di-2', name: 'Logs', classData: { id: 'k1', name: 'Log Data' } },
            { id: 'di-3', name: 'Cache' },
          ]),
          file_type: 'data-items',
        },
        context,
      )

      expect(result.success).toBe(true)
      expect((result.data as any)?.valid).toBe(true)
      expect((result.data as any)?.errors).toHaveLength(0)
    })

    it('should validate zoning on the default and a nested boundary', async () => {
      const result = await validateModelTool.run(
        {
          data: {
            defaultBoundary: {
              id: 'b-0',
              name: 'Root',
              zone: 'INTERNAL',
              domains: ['core'],
              planes: ['WORKLOAD', 'MANAGEMENT'],
              boundaries: [
                { id: 'b-1', name: 'DMZ', zone: 'EXPOSED', domains: ['edge'], planes: ['WORKLOAD'] },
              ],
            },
          },
          file_type: 'structure',
        },
        context,
      )

      expect(result.success).toBe(true)
      expect((result.data as any)?.valid).toBe(true)
    })

    it('should reject an invalid zone enum on a nested boundary (recursion)', async () => {
      const result = await validateModelTool.run(
        {
          data: {
            defaultBoundary: {
              id: 'b-0',
              name: 'Root',
              boundaries: [{ id: 'b-1', name: 'Bad', zone: 'BANANA' }],
            },
          },
          file_type: 'structure',
        },
        context,
      )

      expect(result.success).toBe(true)
      expect((result.data as any)?.valid).toBe(false)
      expect((result.data as any)!.errors.length).toBeGreaterThan(0)
    })

    it('should reject an invalid plane enum', async () => {
      const result = await validateModelTool.run(
        {
          data: {
            defaultBoundary: { id: 'b-0', name: 'Root', planes: ['BOGUS'] },
          },
          file_type: 'structure',
        },
        context,
      )

      expect(result.success).toBe(true)
      expect((result.data as any)?.valid).toBe(false)
    })

    it('accepts a well-formed conduit on a boundary (shape validation)', async () => {
      const result = await validateModelTool.run(
        {
          data: {
            defaultBoundary: {
              id: 'b-0',
              name: 'Root',
              boundaries: [{ id: 'b-1', name: 'Seg', conduits: [{ peerId: 'b-0', direction: 'OUTBOUND', justification: 'admin path' }] }],
            },
          },
          file_type: 'structure',
        },
        context,
      )

      expect(result.success).toBe(true)
      expect((result.data as any)?.valid).toBe(true)
    })

    it('should reject a conduit with an invalid direction enum', async () => {
      const result = await validateModelTool.run(
        {
          data: {
            defaultBoundary: { id: 'b-0', name: 'Root', conduits: [{ peerId: 'b-1', direction: 'SIDEWAYS' }] },
          },
          file_type: 'structure',
        },
        context,
      )

      expect(result.success).toBe(true)
      expect((result.data as any)?.valid).toBe(false)
    })

    it('should handle JSON string input', async () => {
      const jsonStr = JSON.stringify({
        defaultBoundary: {
          id: 'b-1',
          name: 'System',
        },
      })

      const result = await validateModelTool.run(
        {
          data: jsonStr,
          file_type: 'structure',
        },
        context,
      )

      expect(result.success).toBe(true)
      expect((result.data as any)?.valid).toBe(true)
    })

    it('should reject invalid JSON string', async () => {
      const result = await validateModelTool.run(
        {
          data: '{ invalid json }',
          file_type: 'structure',
        },
        context,
      )

      expect(result.success).toBe(true)
      expect((result.data as any)?.valid).toBe(false)
      expect((result.data as any)?.errors[0]?.message).toContain('Invalid JSON')
    })

    it('should return error when neither directory_path nor data provided', async () => {
      const result = await validateModelTool.run({}, context)
      expect(result.success).toBe(false)
      expect(result.error).toContain('must be provided')
    })
  })

  // Coverage action
  describe('coverage action', () => {
    it('should accept coverage action with model_id', () => {
      const result = validateModelTool.inputSchema.safeParse({
        action: 'coverage',
        model_id: 'model-123',
      })
      expect(result.success).toBe(true)
    })

    it('should accept coverage action with directory_path', () => {
      const result = validateModelTool.inputSchema.safeParse({
        action: 'coverage',
        directory_path: '/tmp/model',
      })
      expect(result.success).toBe(true)
    })

    it('should return error when coverage has neither model_id nor directory_path', async () => {
      const result = await validateModelTool.run({ action: 'coverage' }, context)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Coverage requires')
    })
  })
})

describe('ValidateModelTool — monitoring_tools "None" sentinel', () => {
  const tool = validateModelTool as any

  it('does not count ["None"] as monitoring', () => {
    expect(tool.hasRealMonitoring(['None'])).toBe(false)
    expect(tool.hasRealMonitoring(['none'])).toBe(false)
    expect(tool.hasRealMonitoring(['N/A'])).toBe(false)
    expect(tool.hasRealMonitoring([])).toBe(false)
    expect(tool.hasRealMonitoring(null)).toBe(false)
    expect(tool.hasRealMonitoring('SIEM')).toBe(false) // not an array
  })

  it('counts a real tool, even alongside a sentinel', () => {
    expect(tool.hasRealMonitoring(['SIEM'])).toBe(true)
    expect(tool.hasRealMonitoring(['none', 'EDR'])).toBe(true)
  })

  it('getAttributeCategories reports monitoring=false for the ["None"] sentinel', () => {
    expect(tool.getAttributeCategories({ monitoring_tools: ['None'] }).monitoring).toBe(false)
    expect(tool.getAttributeCategories({ monitoring_tools: ['SIEM'] }).monitoring).toBe(true)
  })

  it('hasPositiveSecurityAttribute ignores a ["None"] monitoring sentinel', () => {
    // monitoring is the only attribute present — the sentinel must not flip it positive
    expect(tool.hasPositiveSecurityAttribute({ monitoring_tools: ['None'] })).toBe(false)
    expect(tool.hasPositiveSecurityAttribute({ monitoring_tools: ['SIEM'] })).toBe(true)
  })
})

describe('ValidateModelTool — offline coverage is assignment, not mitigation', () => {
  const dir = path.resolve('./__g10_cov_model__')

  beforeAll(async () => {
    await fs.mkdir(dir, { recursive: true })
    // isModelDirectory() only checks for a manifest.json file.
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: '2.0.0',
        format: 'split',
        model: { id: null, name: 'cov', defaultBoundaryId: 'b1' },
        modules: [],
      }),
    )
  })

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('tags offline coverage assignment-heuristic and warns it is not mitigation', async () => {
    const spy = vi
      .spyOn(validateModelTool as any, 'computeLocalCoverageBreakdown')
      .mockResolvedValue({
        classified_count: 11,
        covered_count: 11,
        inferred_coverage: {},
        formal_coverage: {},
        attribute_issues: [],
      })

    const result = await validateModelTool.run(
      { action: 'coverage', directory_path: dir },
      context,
    )
    spy.mockRestore()

    expect(result.success).toBe(true)
    const data = result.data as any
    expect(data.mode).toBe('offline')
    expect(data.coverage_kind).toBe('assignment-heuristic')
    expect(data.coverage_summary.coverage_pct).toBe(100)
    const warning = (result.warnings ?? []).join(' ')
    expect(warning).toContain('ASSIGNMENT')
    expect(warning).toMatch(/not.*mitigation/i)
  })
})

describe("ValidateModelTool — action 'zoning' (offline determination)", () => {
  // Scenario covering every payload path (exposure outranks asset pull, so the under-segmented asset must sit
  // one hop BEHIND the exposed tier): ext(UNTRUSTED) → web(PUBLIC) → mid(EXPOSED) → underseg(asset ⇒ INTERNAL,
  // blocked by exposure); web → mgmt(EXPOSED, MGMT plane); app(internal) → paydb(asset ⇒ RESTRICTED).
  const C = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: id,
    type: 'PROCESS',
    positionX: 0,
    positionY: 0,
    ...extra,
  })
  const scenarioStructure = {
    defaultBoundary: {
      id: 'root',
      name: 'root',
      components: [],
      boundaries: [
        { id: 'ext', name: 'ext', zone: 'UNTRUSTED', components: [C('ext-c', { type: 'EXTERNAL_ENTITY' })] },
        { id: 'web', name: 'web', components: [C('web-c')] },
        { id: 'mid', name: 'mid', components: [C('mid-c')] },
        { id: 'mgmt', name: 'mgmt', planes: ['MANAGEMENT'], components: [C('mgmt-c')] },
        { id: 'underseg', name: 'underseg', components: [C('undseg-c', { type: 'STORE', crownJewel: true })] },
        { id: 'app', name: 'app', components: [C('app-c')] },
        { id: 'paydb', name: 'paydb', components: [C('paydb-c', { type: 'STORE', dataItemIds: ['card'] })] },
      ],
    },
  }
  const scenarioFlows = [
    { id: 'f1', name: 'ext->web', source: { id: 'ext-c' }, target: { id: 'web-c' } },
    { id: 'f2', name: 'web->mid', source: { id: 'web-c' }, target: { id: 'mid-c' } },
    { id: 'f3', name: 'web->mgmt', source: { id: 'web-c' }, target: { id: 'mgmt-c' } },
    { id: 'f4', name: 'mid->underseg', source: { id: 'mid-c' }, target: { id: 'undseg-c' } },
    { id: 'f5', name: 'app->paydb', source: { id: 'app-c' }, target: { id: 'paydb-c' } },
  ]
  const scenarioDataItems = [{ id: 'card', name: 'Card', regulatory_flags: ['PCI cardholder'] }]

  const writeModel = async (
    dir: string,
    opts: { structure?: unknown; flows?: unknown; flowsAsObject?: boolean; items?: unknown } = {},
  ) => {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ schemaVersion: '2.0.0', format: 'split', model: { id: null, name: 'z', defaultBoundaryId: 'root' }, modules: [] }),
    )
    await fs.writeFile(path.join(dir, 'structure.json'), JSON.stringify(opts.structure ?? scenarioStructure))
    const flows = opts.flows ?? scenarioFlows
    await fs.writeFile(path.join(dir, 'dataflows.json'), JSON.stringify(opts.flowsAsObject ? { dataFlows: flows } : flows))
    await fs.writeFile(path.join(dir, 'data-items.json'), JSON.stringify({ dataItems: opts.items ?? scenarioDataItems }))
  }

  const dir = path.resolve('./__s7_zoning_model__')
  beforeAll(async () => { await writeModel(dir) })
  afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }) })

  const byId = (data: any) => Object.fromEntries(data.boundaries.map((b: any) => [b.id, b]))

  it('returns the correct per-boundary tier, confidence, and resolution for every row', async () => {
    const result = await validateModelTool.run({ action: 'zoning', directory_path: dir }, context)
    expect(result.success).toBe(true)
    const b = byId(result.data)

    // tiers
    expect(b.ext.proposedTier).toBe('UNTRUSTED')
    expect(b.web.proposedTier).toBe('PUBLIC')
    expect(b.mid.proposedTier).toBe('EXPOSED')
    expect(b.mgmt.proposedTier).toBe('EXPOSED')
    expect(b.underseg.proposedTier).toBe('INTERNAL') // exposure outranks asset pull, but one hop behind → blocked
    expect(b.underseg.blockedBy).toBe('exposure')
    expect(b.app.proposedTier).toBe('INTERNAL')
    expect(b.app.blockedBy).toBe('no-asset')
    expect(b.paydb.proposedTier).toBe('RESTRICTED')

    // confidence (cascade certainty): firm tier → high, exposure-blocked → medium, no-asset → low
    expect(b.ext.confidence).toBe('high')
    expect(b.web.confidence).toBe('high')
    expect(b.mid.confidence).toBe('high')
    expect(b.mgmt.confidence).toBe('high')
    expect(b.paydb.confidence).toBe('high')
    expect(b.underseg.confidence).toBe('medium')
    expect(b.app.confidence).toBe('low')

    // declaration + resolution columns
    expect(b.ext.declaredZone).toBe('UNTRUSTED')
    expect(b.ext.resolvedSource).toBe('declared')
    expect(b.ext.provenance).toBe('operator-declared UNTRUSTED')
    expect(b.web.declaredZone).toBeNull()
    expect(b.web.resolvedSource).toBe('default')

    // the root container is not a classified segment
    expect(b.root).toBeUndefined()
  })

  it('emits all five finding kinds through the payload, on the right boundaries', async () => {
    const result = await validateModelTool.run({ action: 'zoning', directory_path: dir }, context)
    const findings = (result.data as any).findings
    const kinds = new Set(findings.map((f: any) => f.kind))
    expect(kinds.has('unclassified')).toBe(true)
    expect(kinds.has('under-protected')).toBe(true)
    expect(kinds.has('mgmt-plane')).toBe(true)

    expect(findings.find((f: any) => f.kind === 'under-protected').boundaryId).toBe('underseg')
    expect(findings.find((f: any) => f.kind === 'mgmt-plane').boundaryId).toBe('mgmt')
    // ext is declared → not unclassified
    expect(findings.some((f: any) => f.kind === 'unclassified' && f.boundaryId === 'ext')).toBe(false)

    // conduit-dependent findings now fire (S13a): ext (UNTRUSTED) → web (INTERNAL) with no approved
    // channel is external-ingress; mid (EXPOSED) → underseg (crownJewel asset) is a flow-channel undeclared path.
    expect(findings.some((f: any) => f.kind === 'external-ingress' && f.boundaryId === 'ext')).toBe(true)
    expect(findings.some((f: any) => f.kind === 'flow-channel' && f.boundaryId === 'mid')).toBe(true)
    // the conduit-dependent findings carry the target boundary as peerId (S13b — the Step-5 gate authors
    // a conduit {peerId, OUTBOUND} straight from the finding, no flow-graph re-walk).
    expect(findings.find((f: any) => f.kind === 'external-ingress' && f.boundaryId === 'ext').peerId).toBe('web')
    expect(findings.find((f: any) => f.kind === 'flow-channel' && f.boundaryId === 'mid').peerId).toBe('underseg')
  })

  it('a ratified OUTBOUND conduit on the source suppresses its external-ingress (S13b, through the tool)', async () => {
    const withConduit = {
      defaultBoundary: {
        ...scenarioStructure.defaultBoundary,
        boundaries: scenarioStructure.defaultBoundary.boundaries.map((b: any) =>
          b.id === 'ext'
            ? { ...b, conduits: [{ peerId: 'web', direction: 'OUTBOUND', justification: 'vetted edge ingress' }] }
            : b,
        ),
      },
    }
    const cdir = path.resolve('./__s13b_conduit_suppress__')
    try {
      await writeModel(cdir, { structure: withConduit })
      const result = await validateModelTool.run({ action: 'zoning', directory_path: cdir }, context)
      const findings = (result.data as any).findings
      // ext→web is now a declared approved channel → the external-ingress on ext clears.
      expect(findings.some((f: any) => f.kind === 'external-ingress' && f.boundaryId === 'ext')).toBe(false)
    } finally {
      await fs.rm(cdir, { recursive: true, force: true })
    }
  })

  it("assets:'skeleton' (Step-4 gate) never proposes RESTRICTED and defers asset-dependent findings", async () => {
    const skeleton = await validateModelTool.run({ action: 'zoning', directory_path: dir, assets: 'skeleton' }, context)
    expect(skeleton.success).toBe(true)
    const s = byId(skeleton.data)

    // external + exposure tiers are unchanged — they don't depend on the asset join
    expect(s.ext.proposedTier).toBe('UNTRUSTED')
    expect(s.web.proposedTier).toBe('PUBLIC')
    expect(s.mid.proposedTier).toBe('EXPOSED')
    expect(s.mgmt.proposedTier).toBe('EXPOSED')
    // the asset-bearing internal boundary that promotes at full now stays INTERNAL (RESTRICTED deferred to Step 7)
    expect(s.paydb.proposedTier).toBe('INTERNAL')
    expect(s.underseg.proposedTier).toBe('INTERNAL')
    // RESTRICTED is structurally unreachable with an empty asset set
    expect((skeleton.data as any).boundaries.some((b: any) => b.proposedTier === 'RESTRICTED')).toBe(false)

    // asset-dependent findings defer too (proves computeZoningFindings got the blanked ctx); the
    // non-asset kinds still surface
    const kinds = new Set(((skeleton.data as any).findings).map((f: any) => f.kind))
    expect(kinds.has('under-protected')).toBe(false)
    expect(kinds.has('mgmt-plane')).toBe(true)

    // contrast: the default 'full' phase still promotes paydb to RESTRICTED (unchanged S7 behaviour)
    const full = await validateModelTool.run({ action: 'zoning', directory_path: dir }, context)
    expect(byId(full.data).paydb.proposedTier).toBe('RESTRICTED')
  })

  it('normalizes both dataflow on-disk shapes (bare [] and { dataFlows: [] }) identically', async () => {
    const dirA = path.resolve('./__s7_flows_bare__')
    const dirB = path.resolve('./__s7_flows_obj__')
    try {
      await writeModel(dirA, { flowsAsObject: false })
      await writeModel(dirB, { flowsAsObject: true })
      const a = await validateModelTool.run({ action: 'zoning', directory_path: dirA }, context)
      const bb = await validateModelTool.run({ action: 'zoning', directory_path: dirB }, context)
      expect(a.data).toEqual(bb.data)
      expect(byId(a.data).web.proposedTier).toBe('PUBLIC') // proves the flows were actually read
    } finally {
      await fs.rm(dirA, { recursive: true, force: true })
      await fs.rm(dirB, { recursive: true, force: true })
    }
  })

  it('resolves inheritance on a nested structure with NO parentBoundary back-refs', async () => {
    const nestedDir = path.resolve('./__s7_nested__')
    const nested = {
      defaultBoundary: {
        id: 'root',
        name: 'root',
        components: [],
        boundaries: [
          { id: 'outer', name: 'outer', zone: 'PUBLIC', components: [], boundaries: [{ id: 'inner', name: 'inner', components: [C('inner-c')] }] },
        ],
      },
    }
    try {
      await writeModel(nestedDir, { structure: nested, flows: [], items: [] })
      const result = await validateModelTool.run({ action: 'zoning', directory_path: nestedDir }, context)
      const b = byId(result.data)
      expect(b.outer.resolvedSource).toBe('declared')
      expect(b.inner.resolvedSource).toBe('inherited')
      expect(b.inner.resolvedFrom).toBe('outer')
      expect(b.inner.resolvedZone).toBe('PUBLIC')
      expect(b.inner.provenance).toBe('inherited from outer')
      // S15a: the container carrying a child boundary is structural; the leaf is not.
      expect(b.outer.structural).toBe(true)
      expect(b.inner.structural).toBe(false)
    } finally {
      await fs.rm(nestedDir, { recursive: true, force: true })
    }
  })

  it('k8s in a subnet: exposure sinks to the ingress leaf; subnet/cluster/ns abstain as structural', async () => {
    const k8sDir = path.resolve('./__s15a_k8s_subnet__')
    // ext(UNTRUSTED) → gateway-c (in ns-ingress). subnet-public-a ⊃ cluster ⊃ {ns-ingress, ns-workload}.
    const nested = {
      defaultBoundary: {
        id: 'root',
        name: 'root',
        components: [],
        boundaries: [
          { id: 'ext', name: 'ext', zone: 'UNTRUSTED', components: [C('ext-c', { type: 'EXTERNAL_ENTITY' })] },
          {
            id: 'subnet-public-a',
            name: 'subnet-public-a',
            components: [],
            boundaries: [
              {
                id: 'cluster',
                name: 'cluster',
                components: [],
                boundaries: [
                  { id: 'ns-ingress', name: 'ns-ingress', components: [C('gateway-c')] },
                  { id: 'ns-workload', name: 'ns-workload', components: [C('workload-c')] },
                ],
              },
            ],
          },
        ],
      },
    }
    const flows = [{ id: 'f1', name: 'ext->gw', source: { id: 'ext-c' }, target: { id: 'gateway-c' } }]
    try {
      await writeModel(k8sDir, { structure: nested, flows, items: [] })
      const result = await validateModelTool.run({ action: 'zoning', directory_path: k8sDir }, context)
      const b = byId(result.data)
      // Exposure sinks to the deepest modelled boundary — the ingress leaf, not the enclosing subnet/cluster.
      expect(b['ns-ingress'].proposedTier).toBe('PUBLIC')
      expect(b['ns-ingress'].structural).toBe(false)
      expect(b['subnet-public-a'].proposedTier).toBe('INTERNAL') // does NOT inherit the leaf's exposure
      // The nesting levels are structural containers (they abstain).
      expect(b['subnet-public-a'].structural).toBe(true)
      expect(b.cluster.structural).toBe(true)
      expect(b['ns-workload'].structural).toBe(false)
      // No false unclassified on the structural levels (they abstain; only the leaves are forced to classify).
      const findings = (result.data as any).findings
      const unclassifiedOn = (id: string) => findings.some((f: any) => f.kind === 'unclassified' && f.boundaryId === id)
      expect(unclassifiedOn('subnet-public-a')).toBe(false)
      expect(unclassifiedOn('cluster')).toBe(false)

      // S15b display roll-up: structural containers carry a summary (range spans the exposed ingress
      // leaf down to the internal workload); leaves carry none.
      expect(b['subnet-public-a'].summary).toBeDefined()
      expect(b['subnet-public-a'].summary.range).toEqual({ min: 'PUBLIC', max: 'INTERNAL' })
      expect(b['subnet-public-a'].summary.maxExposure).toBe('PUBLIC')
      expect(b['subnet-public-a'].summary.reachesExternal).toBe(true)
      expect(b['subnet-public-a'].summary.containsVendor).toBe(false)
      expect(b['subnet-public-a'].summary.unclassifiedDescendants).toBe(2)
      expect(b.cluster.summary).toBeDefined()
      expect(b['ns-ingress'].summary).toBeUndefined()
      expect(b['ns-workload'].summary).toBeUndefined()

      // …and it is omitted entirely in the skeleton phase (assets unknown at Step 4).
      const skeleton = await validateModelTool.run(
        { action: 'zoning', directory_path: k8sDir, assets: 'skeleton' },
        context,
      )
      const sb = byId(skeleton.data)
      expect(sb['subnet-public-a'].structural).toBe(true)
      expect(sb['subnet-public-a'].summary).toBeUndefined()
      expect(sb.cluster.summary).toBeUndefined()
    } finally {
      await fs.rm(k8sDir, { recursive: true, force: true })
    }
  })

  it('surfaces a cross-tier-domain finding through the payload (S16) when a shared domain tag couples exposed↔protected', async () => {
    const dir = path.resolve('./__s16_cross_tier_domain__')
    // ext(UNTRUSTED) → web(PUBLIC); peer → vault(crownJewel, clean ingress → RESTRICTED). web + vault share `principal-x`.
    const structure = {
      defaultBoundary: {
        id: 'root',
        name: 'root',
        components: [],
        boundaries: [
          { id: 'ext', name: 'ext', zone: 'UNTRUSTED', components: [C('ext-c', { type: 'EXTERNAL_ENTITY' })] },
          { id: 'web', name: 'web', domains: ['principal-x'], components: [C('web-c')] },
          { id: 'peer', name: 'peer', components: [C('peer-c')] },
          { id: 'vault', name: 'vault', domains: ['principal-x'], components: [C('vault-c', { crownJewel: true })] },
        ],
      },
    }
    const flows = [
      { id: 'f1', name: 'ext->web', source: { id: 'ext-c' }, target: { id: 'web-c' } },
      { id: 'f2', name: 'peer->vault', source: { id: 'peer-c' }, target: { id: 'vault-c' } },
    ]
    try {
      await writeModel(dir, { structure, flows, items: [] })
      const result = await validateModelTool.run({ action: 'zoning', directory_path: dir }, context)
      const findings = (result.data as any).findings
      const ctd = findings.filter((f: any) => f.kind === 'cross-tier-domain')
      expect(ctd).toHaveLength(1)
      expect(ctd[0].boundaryId).toBe('vault') // protected (at-risk) anchor
      expect(ctd[0].peerId).toBe('web') // externally-reachable coupling source
      expect(ctd[0].severity).toBe('info')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('requires directory_path', async () => {
    const result = await validateModelTool.run({ action: 'zoning' }, context)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/directory_path is required/)
  })

  it('buildComponentBoundaryMap maps components to their immediate containing boundary (nesting-authoritative)', () => {
    const tool = validateModelTool as any
    const flat = tool.buildComponentBoundaryMap(scenarioStructure.defaultBoundary)
    expect(flat.get('ext-c')).toBe('ext')
    expect(flat.get('web-c')).toBe('web')
    expect(flat.get('undseg-c')).toBe('underseg')
    expect(flat.get('paydb-c')).toBe('paydb')
    // nested: the innermost boundary wins
    const nestedRoot = {
      id: 'root',
      name: 'root',
      components: [],
      boundaries: [{ id: 'outer', name: 'outer', components: [], boundaries: [{ id: 'inner', name: 'inner', components: [C('inner-c')] }] }],
    }
    expect(tool.buildComponentBoundaryMap(nestedRoot).get('inner-c')).toBe('inner')
  })
})

describe('ValidateModelTool — conduit peerId integrity (S11)', () => {
  const writeModel = async (dir: string, boundaries: unknown[]) => {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ schemaVersion: '2.0.0', format: 'split', model: { id: null, name: 'c', defaultBoundaryId: 'root' }, modules: [] }),
    )
    await fs.writeFile(
      path.join(dir, 'structure.json'),
      JSON.stringify({ defaultBoundary: { id: 'root', name: 'root', components: [], boundaries } }),
    )
    await fs.writeFile(path.join(dir, 'dataflows.json'), JSON.stringify([]))
    await fs.writeFile(path.join(dir, 'data-items.json'), JSON.stringify({ dataItems: [] }))
  }
  const conduitErrors = (data: any) =>
    (data.errors as any[]).filter(e => /conduit/i.test(e.message))

  it('accepts a conduit whose peerId is a known in-model boundary', async () => {
    const dir = path.resolve('./__s11_conduit_ok__')
    try {
      await writeModel(dir, [
        { id: 'a', name: 'A', conduits: [{ peerId: 'b', direction: 'OUTBOUND' }] },
        { id: 'b', name: 'B' },
      ])
      const result = await validateModelTool.run({ action: 'validate', directory_path: dir }, context)
      expect(result.success).toBe(true)
      expect(conduitErrors(result.data)).toEqual([])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a conduit whose peerId is not a known boundary', async () => {
    const dir = path.resolve('./__s11_conduit_unknown__')
    try {
      await writeModel(dir, [{ id: 'a', name: 'A', conduits: [{ peerId: 'ghost', direction: 'OUTBOUND' }] }])
      const result = await validateModelTool.run({ action: 'validate', directory_path: dir }, context)
      expect((result.data as any).valid).toBe(false)
      expect(conduitErrors(result.data).some((e: any) => /Invalid conduit peerId: ghost/.test(e.message))).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a self-conduit (peerId === own id) — validate/write must agree (dedupeByPeer drops it)', async () => {
    const dir = path.resolve('./__s11_conduit_self__')
    try {
      await writeModel(dir, [{ id: 'a', name: 'A', conduits: [{ peerId: 'a', direction: 'INBOUND' }] }])
      const result = await validateModelTool.run({ action: 'validate', directory_path: dir }, context)
      expect((result.data as any).valid).toBe(false)
      expect(conduitErrors(result.data).some((e: any) => /Self-conduit/.test(e.message))).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  // S12: the write path is OUTBOUND-canonical, so a lone-INBOUND conduit (no mirror OUTBOUND on the
  // peer) would be silently dropped on write — validate must reject it to stay in sync. Lone-OUTBOUND
  // is fine (the S11 "known peerId" test above is exactly a lone-outbound and is accepted).
  it('rejects a lone-inbound conduit whose peer declares no matching outbound (S12)', async () => {
    const dir = path.resolve('./__s12_conduit_lone_inbound__')
    try {
      await writeModel(dir, [
        { id: 'a', name: 'A', conduits: [{ peerId: 'b', direction: 'INBOUND' }] },
        { id: 'b', name: 'B' }, // no outbound back to 'a'
      ])
      const result = await validateModelTool.run({ action: 'validate', directory_path: dir }, context)
      expect((result.data as any).valid).toBe(false)
      expect(conduitErrors(result.data).some((e: any) => /Lone inbound conduit/.test(e.message))).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('accepts a symmetric conduit pair (outbound on source + inbound mirror on peer) (S12)', async () => {
    const dir = path.resolve('./__s12_conduit_symmetric__')
    try {
      await writeModel(dir, [
        { id: 'a', name: 'A', conduits: [{ peerId: 'b', direction: 'OUTBOUND' }] },
        { id: 'b', name: 'B', conduits: [{ peerId: 'a', direction: 'INBOUND' }] },
      ])
      const result = await validateModelTool.run({ action: 'validate', directory_path: dir }, context)
      expect(conduitErrors(result.data)).toEqual([])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('validate — component type vs assigned class type', () => {
  const writeBase = async (dir: string, componentType: string, classComponentType: string) => {
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
      schemaVersion: '2.0.0', format: 'split',
      model: { id: null, name: 'T', defaultBoundaryId: 'b-1' }, modules: [],
    }))
    await fs.writeFile(path.join(dir, 'structure.json'), JSON.stringify({
      defaultBoundary: {
        id: 'b-1', name: 'System', boundaries: [],
        components: [{
          id: 'c-1', name: 'Orders DB', type: componentType,
          classData: { id: 'cls-1', name: 'Web Server' },
        }],
      },
    }))
    await fs.writeFile(path.join(dir, 'dataflows.json'), JSON.stringify({ dataFlows: [] }))
    await fs.writeFile(path.join(dir, 'data-items.json'), JSON.stringify({ dataItems: [] }))
    await fs.mkdir(path.join(dir, '.dethereal', 'class-cache'), { recursive: true })
    await fs.writeFile(path.join(dir, '.dethereal', 'class-cache', 'cls-1.json'), JSON.stringify({
      classId: 'cls-1', className: 'Web Server', classType: 'component',
      componentType: classComponentType,
      template: { schema: { properties: { tls_enabled: {} } } },
    }))
  }

  it('warns when a STORE is bound to a class that describes a PROCESS', async () => {
    const dir = await fs.mkdtemp(path.join(process.cwd(), '.test-typemix-'))
    try {
      await writeBase(dir, 'STORE', 'PROCESS')
      const data = (await validateModelTool.run({ action: 'validate', directory_path: dir }, context)).data as any
      const w = data.warnings.find((x: any) => x.message?.includes('Orders DB'))
      expect(w).toBeDefined()
      expect(w.message).toContain('STORE')
      expect(w.message).toContain('PROCESS')
      // Advisory, not fatal — the cache may be stale and only the platform binds.
      expect(data.valid).toBe(true)
    } finally { await fs.rm(dir, { recursive: true, force: true }) }
  })

  it('stays silent when the types agree', async () => {
    const dir = await fs.mkdtemp(path.join(process.cwd(), '.test-typeok-'))
    try {
      await writeBase(dir, 'PROCESS', 'PROCESS')
      const data = (await validateModelTool.run({ action: 'validate', directory_path: dir }, context)).data as any
      expect(data.warnings.some((x: any) => x.message?.includes('Orders DB'))).toBe(false)
    } finally { await fs.rm(dir, { recursive: true, force: true }) }
  })

  it('stays silent when the cache predates componentType', async () => {
    // Old caches carry no componentType; absence must not be read as a mismatch.
    const dir = await fs.mkdtemp(path.join(process.cwd(), '.test-typeold-'))
    try {
      await writeBase(dir, 'STORE', 'PROCESS')
      const cachePath = path.join(dir, '.dethereal', 'class-cache', 'cls-1.json')
      const c = JSON.parse(await fs.readFile(cachePath, 'utf-8'))
      delete c.componentType
      await fs.writeFile(cachePath, JSON.stringify(c))
      const data = (await validateModelTool.run({ action: 'validate', directory_path: dir }, context)).data as any
      expect(data.warnings.some((x: any) => x.message?.includes('Orders DB'))).toBe(false)
    } finally { await fs.rm(dir, { recursive: true, force: true }) }
  })
})

describe('validate — unparseable attribute files', () => {
  it('fails validation instead of returning valid:true for a truncated attribute file', async () => {
    const tmpDir = await fs.mkdtemp(path.join(process.cwd(), '.test-badattr-'))
    try {
    // The regression: readAttributes never throws on a per-file parse error, so
    // validate's try/catch could not fire and it returned a byte-identical
    // {valid:true, errors:[], warnings:[]} before and after a file was corrupted.
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify({
      schemaVersion: '2.0.0', format: 'split',
      model: { id: null, name: 'T', defaultBoundaryId: 'b-1' }, modules: [],
    }))
    await fs.writeFile(path.join(tmpDir, 'structure.json'), JSON.stringify({
      defaultBoundary: { id: 'b-1', name: 'System', boundaries: [], components: [{ id: 'c-1', name: 'DB' }] },
    }))
    await fs.writeFile(path.join(tmpDir, 'dataflows.json'), JSON.stringify({ dataFlows: [] }))
    await fs.writeFile(path.join(tmpDir, 'data-items.json'), JSON.stringify({ dataItems: [] }))
    await fs.mkdir(path.join(tmpDir, 'attributes', 'components'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'attributes', 'components', 'c-1.json'),
      '{"elementId":"c-1","elementType":"component","attributes":{"ssl_enabled":tr')

      const res = await validateModelTool.run({ action: 'validate', directory_path: tmpDir }, context)
      const data = res.data as any
      expect(data.valid).toBe(false)
      expect(data.errors.some((e: any) => e.file?.includes('c-1.json'))).toBe(true)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})

