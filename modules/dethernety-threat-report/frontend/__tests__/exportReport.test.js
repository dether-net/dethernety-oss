// exportReport.test.js — the JSON + self-contained printable HTML export lib.
// Focus: HTML-escaping (the security-relevant esc() sink), the no-percentage /
// honesty contract in JSON, the coverage-absent (coverage-tools not deployed)
// path, and minimal-doc robustness. The pure builders are (string in, string
// out); exportHtml runs against a stubbed document and a stand-in report kit.
import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildJsonExport,
  buildHtmlExport,
  buildKitReport,
  coverageBody,
  crossingHtml,
  exportHtml,
  formatUtc,
  kitCss,
} from '../lib/exportReport.js'
import { MODULE_NAME, MODULE_VERSION } from '../lib/moduleInfo.js'

// --- fixtures ---------------------------------------------------------------
// Ledger / doc shapes mirror ledger.test.js; coverage shape mirrors
// coverageMatrix.test.js so the fixtures are realistic against the real joins.
const finding = (over = {}) => ({
  id: 'e1',
  name: 'A finding',
  score: 5,
  attackVector: 'NETWORK',
  createdBy: 'SYSTEM',
  dispositionKind: null,
  dispositionReason: null,
  dispositionStale: null,
  ...over,
})
const ledgerEl = (over = {}) => ({
  id: 'c1',
  name: 'C1',
  type: 'Component',
  findings: [],
  supportingControls: [],
  ...over,
})
const doc = (over = {}) => ({
  generated: true,
  modelId: 'model-xyz',
  generatedAt: '2026-06-04T00:00:00.000Z',
  fingerprint: 'abc123def456',
  ledger: [ledgerEl({ findings: [finding()] })],
  ...over,
})
// Two elements with findings: a ledger with more than one group.
const TWO_ELEMENTS = doc({
  ledger: [
    ledgerEl({ findings: [finding()] }),
    ledgerEl({ id: 'c2', name: 'C2', findings: [finding({ id: 'e2', name: 'Another finding', score: 9 })] }),
  ],
})

// coverage-tools graded-coverage facts (parsed) — same shape coverageMatrix.test.js uses.
const tier = (t, fn, cms = ['cm1'], controls = ['k1']) => ({
  tier: t, function: fn, countermeasureIds: cms, controlIds: controls,
})
// ATT&CK tactics as gradedCoverage emits them: { id, name, order } (v19 matrix positions).
const TACTIC = {
  'Initial Access': { id: 'TA0001', name: 'Initial Access', order: 2 },
  'Execution': { id: 'TA0002', name: 'Execution', order: 3 },
  'Persistence': { id: 'TA0003', name: 'Persistence', order: 4 },
  'Stealth': { id: 'TA0005', name: 'Stealth', order: 6 },
  'Defense Impairment': { id: 'TA0112', name: 'Defense Impairment', order: 7 },
  'Command and Control': { id: 'TA0011', name: 'Command and Control', order: 12 },
  'Impact': { id: 'TA0040', name: 'Impact', order: 14 },
  'Collection': { id: 'TA0009', name: 'Collection', order: 11 },
  'Exfiltration': { id: 'TA0010', name: 'Exfiltration', order: 13 },
  'Credential Access': { id: 'TA0006', name: 'Credential Access', order: 8 },
  'Discovery': { id: 'TA0007', name: 'Discovery', order: 9 },
  'Privilege Escalation': { id: 'TA0004', name: 'Privilege Escalation', order: 5 },
  'Lateral Movement': { id: 'TA0008', name: 'Lateral Movement', order: 10 },
}
const technique = (id, tactics = [TACTIC['Initial Access']], tiers = []) => ({
  techniqueId: id, tactics, covered: tiers.length > 0, tiers,
})
const exposure = (over = {}) => ({
  exposureId: 'e1', elementId: 'c1', elementKind: 'Component', soft: false, techniques: [], ...over,
})
const coverage = (exposures, over = {}) => ({
  modelId: 'model-xyz', generatedAt: '2026-06-04T00:00:00Z', exposures, meta: {}, ...over,
})

// A coverage fixture that joins to the default doc's single live exposure (e1 on c1)
// and yields one grid row (so the matrix actually renders).
const COVERAGE = coverage([
  exposure({ exposureId: 'e1', elementId: 'c1', techniques: [technique('T1190', [TACTIC['Initial Access']], [tier('DIRECT', 'PREVENT')])] }),
])

// --- 1. HTML escaping (the security-relevant sink) --------------------------
describe('buildHtmlExport — esc() escapes model/finding text (XSS sink)', () => {
  const XSS_DOC = doc({
    ledger: [
      ledgerEl({
        id: 'c1',
        name: '<script>alert(1)</script>', // dangerous element name
        type: 'Component',
        supportingControls: [{ id: 'k1', name: 'A & B' }],
        findings: [
          finding({
            id: 'e1',
            name: 'q"uote</style>', // dangerous finding name (quote + close-tag)
            attackVector: '<img src=x onerror=alert(1)>',
            dispositionKind: 'RISK_ACCEPTED',
            dispositionReason: 'a & b "c"',
          }),
        ],
      }),
    ],
    modelId: '</code><script>alert(2)</script>',
    fingerprint: '"><script>alert(3)</script>',
  })

  const html = buildHtmlExport(XSS_DOC)

  it('never emits a raw <script>...alert payload from untrusted text', () => {
    // The literal injection substring must be absent — proves the sink holds.
    // esc() neutralises tags by escaping the angle brackets (& < > "), so no
    // attacker-supplied text can open a live element. (It deliberately does NOT
    // escape `=`/`(`; those are inert once the enclosing `<` is `&lt;`.)
    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('<img src=x') // the onerror payload's opening tag, raw
    // (The finding name's `</style>` close-tag is escaped to `&lt;/style&gt;` —
    // asserted in the escaped-forms test below. The document's own `</style>`
    // closing the inline stylesheet is legitimate structure, not the injection.)
  })

  it('emits the escaped forms instead (&lt; &gt; &amp; &quot;)', () => {
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;') // element name
    expect(html).toContain('A &amp; B') // control name with ampersand
    expect(html).toContain('q&quot;uote&lt;/style&gt;') // finding name quote + tag
    expect(html).toContain('a &amp; b &quot;c&quot;') // disposition reason
  })

  it('escapes the provenance footer fields too (modelId / fingerprint)', () => {
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;')
    expect(html).toContain('&quot;&gt;&lt;script&gt;alert(3)&lt;/script&gt;')
  })
})

// --- 1b. Live-confirmed (AFFIRMED) inline render ----------------------------
describe('buildHtmlExport — a live AFFIRMED finding surfaces its reason + stale flag inline', () => {
  const AFF_DOC = doc({
    ledger: [
      ledgerEl({
        findings: [
          finding({
            id: 'e1',
            name: 'confirmed live risk',
            dispositionKind: 'AFFIRMED',
            dispositionedBy: 'alice@x',
            dispositionReason: 'Confirmed as a live risk.',
            dispositionStale: true,
          }),
        ],
      }),
    ],
  })
  const html = buildHtmlExport(AFF_DOC, null)

  it('renders the affirmed finding in the live table (no Dispositioned section)', () => {
    expect(html).toContain('confirmed live risk')
    expect(html).not.toContain('Dispositioned (') // it is live, not muted
  })
  it('carries the affirmation reason and the ⚠ stale badge inline (not silently dropped)', () => {
    expect(html).toContain('Confirmed as a live risk.')
    expect(html).toContain('⚠ stale')
  })
})

// --- 2. No coverage percentage / honesty contract in JSON -------------------
describe('buildJsonExport — honesty contract (no percentage, no rolled-up "covered")', () => {
  it('the JSON string leaks no coverage percentage / single "covered" total', () => {
    const json = buildJsonExport(doc(), COVERAGE)
    // Mirror the spirit of the honesty lint from coverageMatrix.test.js: no
    // percentage VALUE and no rolled-up numeric "covered" total. (The provenance
    // note + coverage caveat legitimately use the WORD "percentage" as a
    // disclaimer — "no coverage percentage is implied" — so the lint targets a
    // leaked number, e.g. `"coveragePct": 73` or `42%`, not the prose. A boolean
    // `"covered": true/false` per-technique fact is allowed; `"covered": N` is not.)
    expect(json).not.toMatch(/coveragePct/i)
    expect(json).not.toMatch(/\d+\s*%/) // no "73%" style figure
    expect(json).not.toMatch(/"covered"\s*:\s*\d/i) // no numeric covered rollup
  })

  it('produces the documented top-level structure', () => {
    const out = JSON.parse(buildJsonExport(doc(), COVERAGE))
    expect(Object.keys(out).sort()).toEqual([
      'boundaryCrossings',
      'coverage',
      'provenance',
      'reachability',
      'snapshot',
    ])
    // snapshot is the raw doc echoed back
    expect(out.snapshot.fingerprint).toBe('abc123def456')
    // provenance footer carries the honest note + counts, not a score
    expect(out.provenance.modelId).toBe('model-xyz')
    expect(out.provenance.note).toMatch(/no coverage percentage is implied/i)
    expect(out.provenance.counts.findings).toBe(1)
  })

  it('the coverage block is tier-segregated facts, never a percentage', () => {
    const out = JSON.parse(buildJsonExport(doc(), COVERAGE))
    expect(out.coverage).not.toBeNull()
    // tier-segregated buckets + per-technique tier/function, plus the honesty caveat
    expect(out.coverage.bucketsByTier).toBeTruthy()
    expect(out.coverage.caveat).toMatch(/no coverage percentage/i)
    const t = out.coverage.techniques.find((x) => x.techniqueId === 'T1190')
    expect(t.bestTier).toBe('DIRECT')
    expect(t.function).toBe('PREVENT')
  })
})

// --- 3. Coverage-absent path (coverage-tools not deployed) ------------------
describe('coverage-absent path — coverage=null omits the matrix, rest renders', () => {
  it('buildJsonExport(doc, null) succeeds with coverage:null', () => {
    let out
    expect(() => { out = JSON.parse(buildJsonExport(doc(), null)) }).not.toThrow()
    expect(out.coverage).toBeNull()
    // the rest of the report is intact
    expect(out.snapshot.modelId).toBe('model-xyz')
    expect(out.provenance.counts.findings).toBe(1)
  })

  it('buildHtmlExport(doc, null) succeeds and omits the coverage section', () => {
    let html
    expect(() => { html = buildHtmlExport(doc(), null) }).not.toThrow()
    expect(html).not.toContain('MITRE Coverage') // the coverage <h2> heading
    // but the ledger section still renders
    expect(html).toContain('Residual-Risk Ledger')
    expect(html).toContain('A finding')
  })

  it('coverage that resolves unavailable is treated like null (no matrix)', () => {
    // buildCoverageView returns available:false for an empty/no-op coverage object;
    // coverageForExport then yields null → no coverage section.
    const html = buildHtmlExport(doc(), {})
    expect(html).not.toContain('MITRE Coverage')
    expect(JSON.parse(buildJsonExport(doc(), {})).coverage).toBeNull()
  })
})

// --- 4. Empty / minimal doc robustness --------------------------------------
describe('minimal / empty docs do not throw', () => {
  it('a not-generated minimal doc builds both formats', () => {
    const minimal = { generated: false }
    expect(() => buildJsonExport(minimal)).not.toThrow()
    expect(() => buildHtmlExport(minimal)).not.toThrow()
    const out = JSON.parse(buildJsonExport(minimal))
    expect(out.provenance.counts.findings).toBe(0)
    expect(out.coverage).toBeNull()
    expect(out.reachability).toBeNull()
    expect(buildHtmlExport(minimal).startsWith('<!doctype html>')).toBe(true)
  })

  it('an entirely empty doc ({}) and undefined-ledger doc do not throw', () => {
    expect(() => buildJsonExport({})).not.toThrow()
    expect(() => buildHtmlExport({})).not.toThrow()
    expect(() => buildJsonExport({ ledger: undefined })).not.toThrow()
    expect(() => buildHtmlExport({ ledger: undefined })).not.toThrow()
  })
})

// --- 5. Flow-route labelling (verified present in source) --------------------
describe('reachability serialises as flowRoutes, never attackPaths', () => {
  const REACH_DOC = doc({
    ledger: [],
    modelGraph: {
      boundaries: [],
      components: [
        { id: 'ext', name: 'Ext', type: 'external_entity', boundaryId: null, crownJewel: false },
        { id: 'db', name: 'DB', type: 'store', boundaryId: null, crownJewel: true },
      ],
      flows: [{ id: 'f1', name: 'e', sourceId: 'ext', targetId: 'db', sensitivities: [], dataItemCount: 0 }],
      dataNodes: [],
    },
  })

  it('the JSON labels routes flowRoutes and contains no "attackPath" string', () => {
    const out = JSON.parse(buildJsonExport(REACH_DOC))
    expect(out.reachability.flowRoutes).toBeTruthy()
    expect(out.reachability.attackPaths).toBeUndefined()
    expect(JSON.stringify(out.reachability)).not.toMatch(/attackPath/i)
  })
})

// --- 6. Boundary Crossings / declared-zone data-flow policy in the export ----
// The regression this fixes: the zoning data-flow policy reached the interactive
// view but never the shareable export. Both formats must now carry the per-flow
// verdicts, the conduit-error / dead-conduit surfaces, and the honesty caveat.
describe('boundary crossings / data-flow policy export', () => {
  // ext (UNTRUSTED) → vault (RESTRICTED): external ingress straight to the
  // crown-jewel tier = VIOLATION. A declared ext→vault conduit is itself illegal
  // (a conduit never legalizes a violation) → a conduit error + `conduit: error`
  // token on the flow. A legal-but-dead a→b conduit (no modeled flow) is dead intent.
  const ZONING_DOC = doc({
    ledger: [],
    modelGraph: {
      boundaries: [
        { id: 'ext', name: 'Edge', parentBoundaryId: null, planes: [], domains: [], conduits: [{ peerId: 'vault', direction: 'OUTBOUND', justification: 'legacy' }] },
        { id: 'vault', name: 'Vault', parentBoundaryId: null, planes: [], domains: [], conduits: [] },
        { id: 'a', name: 'AppZone', parentBoundaryId: null, planes: [], domains: [], conduits: [{ peerId: 'b', direction: 'OUTBOUND', justification: 'ratified peering' }] },
        { id: 'b', name: 'SvcZone', parentBoundaryId: null, planes: [], domains: [], conduits: [] },
      ],
      components: [
        { id: 'extC', name: 'Gateway', type: 'process', boundaryId: 'ext', crownJewel: false },
        { id: 'vaultC', name: 'Secrets DB', type: 'store', boundaryId: 'vault', crownJewel: true },
      ],
      flows: [{ id: 'f1', name: 'reach-secrets', sourceId: 'extC', targetId: 'vaultC', sensitivities: ['CONFIDENTIAL'], dataItemCount: 1 }],
      dataNodes: [],
    },
    zoning: {
      findings: [],
      effectiveZones: {
        ext: { zone: 'UNTRUSTED', source: 'declared' },
        vault: { zone: 'RESTRICTED', source: 'declared' },
        a: { zone: 'INTERNAL', source: 'default' },
        b: { zone: 'INTERNAL', source: 'default' },
      },
    },
  })

  it('JSON carries the per-flow verdict, conduit error, and dead conduit', () => {
    const out = JSON.parse(buildJsonExport(ZONING_DOC))
    const bc = out.boundaryCrossings
    expect(bc).toBeTruthy()
    expect(bc.policy.violations).toBe(1)
    expect(bc.policy.fails).toBe(true)

    const wl = bc.worklist.find((x) => x.flow === 'reach-secrets')
    expect(wl).toBeTruthy()
    expect(wl.source).toBe('Gateway')
    expect(wl.target).toBe('Secrets DB')
    expect(wl.verdict.verdict).toBe('violation')
    expect(wl.verdict.declaredZonePair).toBe('UNTRUSTED ↦ RESTRICTED')
    expect(wl.verdict.conduitClause).toBe('error')
    expect(wl.verdict.detail).toMatch(/crown-jewel|RESTRICTED/i)
    // structural membranes are EXIT/ENTER containment, not trust
    expect(wl.membranes.map((m) => `${m.direction} ${m.boundary}`)).toEqual(['EXIT Edge', 'ENTER Vault'])

    // the illegal declared conduit surfaces (live, not dead)
    expect(bc.conduitErrors).toHaveLength(1)
    expect(bc.conduitErrors[0].declaredZonePair).toBe('UNTRUSTED ↦ RESTRICTED')
    expect(bc.conduitErrors[0].dead).toBe(false)
    // the legal-but-unused a→b conduit is dead intent
    expect(bc.deadConduits).toHaveLength(1)
    expect(bc.deadConduits[0].source).toBe('AppZone')
    expect(bc.deadConduits[0].justification).toBe('ratified peering')

    // honesty contract in the export payload
    expect(bc.caveat).toMatch(/declared intent, not verified enforcement/i)
    expect(bc.caveat).toMatch(/no single risk score/i)
  })

  it('HTML renders the Boundary Crossings section with verdict + conduit surfaces', () => {
    const html = buildHtmlExport(ZONING_DOC)
    expect(html).toContain('<h2>Boundary Crossings</h2>')
    expect(html).toContain('VIOLATION')
    expect(html).toContain('UNTRUSTED')
    expect(html).toContain('RESTRICTED')
    expect(html).toContain('CONDUIT ERROR')
    expect(html).toContain('conduit: error')
    expect(html).toContain('dead intent')
    expect(html).toContain('EXIT')
    expect(html).toContain('ENTER')
  })

  it('escapes model-controlled names in the boundary section (XSS sink)', () => {
    const evil = doc({
      ledger: [],
      modelGraph: {
        boundaries: [
          { id: 'x', name: '<script>x</script>', parentBoundaryId: null, planes: [], domains: [], conduits: [] },
          { id: 'y', name: 'Y', parentBoundaryId: null, planes: [], domains: [], conduits: [] },
        ],
        components: [
          { id: 'xc', name: 'XC', type: 'process', boundaryId: 'x', crownJewel: false },
          { id: 'yc', name: 'YC', type: 'store', boundaryId: 'y', crownJewel: false },
        ],
        flows: [{ id: 'f', name: '<img src=x onerror=alert(1)>', sourceId: 'xc', targetId: 'yc', sensitivities: [], dataItemCount: 1 }],
        dataNodes: [],
      },
      zoning: { findings: [], effectiveZones: { x: { zone: 'INTERNAL', source: 'default' }, y: { zone: 'INTERNAL', source: 'default' } } },
    })
    const html = buildHtmlExport(evil)
    expect(html).not.toContain('<script>x</script>')
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('omits the section when there are no boundaries/flows, and notes an all-quiet topology honestly', () => {
    // no modelGraph → section absent (null in JSON, no <h2> in HTML)
    const bare = JSON.parse(buildJsonExport(doc()))
    expect(bare.boundaryCrossings).toBeNull()
    expect(buildHtmlExport(doc())).not.toContain('<h2>Boundary Crossings</h2>')

    // boundaries + a flow that crosses NOTHING → an honest topology note, never "segmented/safe"
    const quiet = doc({
      ledger: [],
      modelGraph: {
        boundaries: [{ id: 'b1', name: 'B1', parentBoundaryId: null, planes: [], domains: [], conduits: [] }],
        components: [
          { id: 'c1', name: 'C1', type: 'process', boundaryId: 'b1', crownJewel: false },
          { id: 'c2', name: 'C2', type: 'store', boundaryId: 'b1', crownJewel: false },
        ],
        flows: [{ id: 'f', name: 'intra', sourceId: 'c1', targetId: 'c2', sensitivities: [], dataItemCount: 0 }],
        dataNodes: [],
      },
      zoning: { findings: [], effectiveZones: { b1: { zone: 'INTERNAL', source: 'default' } } },
    })
    const qout = JSON.parse(buildJsonExport(quiet)).boundaryCrossings
    expect(qout.crossingFlows).toBe(0)
    expect(qout.note).toMatch(/topology, not a segmentation assessment/i)
    const qhtml = buildHtmlExport(quiet)
    expect(qhtml).toContain('<h2>Boundary Crossings</h2>')
    expect(qhtml).not.toMatch(/segmented|safe/i)
  })
})

// --- the report kit's form ----------------------------------------------------
// A stand-in kit that records what the report asks of it: the platform's own kit is tested in the platform.
function fakeKit({ version = 1, figure = '<figure class="rk-figure">diagram</figure>' } = {}) {
  const calls = { diagram: [], build: [], download: [] }
  const kit = {
    version,
    currentUser: () => ({ displayName: 'Jane Doe' }),
    brand: vi.fn(async () => ({ name: 'Example' })),
    reportDetails: { get: vi.fn(async () => ({ client: 'Example Client' })) },
    renderModelDiagram: (graph, opts) => {
      calls.diagram.push({ graph, opts })
      return figure ? { svg: '<svg/>', figure, width: 1, height: 1 } : null
    },
    buildReport: (input) => {
      calls.build.push(input)
      return '<!DOCTYPE html>report'
    },
    download: (report, name) => calls.download.push({ report, name }),
  }
  return { kit, calls }
}

const GRAPH = {
  boundaries: [{ id: 'b1', name: 'B1', parentBoundaryId: null }],
  components: [
    { id: 'c1', name: 'C1', type: 'process', boundaryId: 'b1', crownJewel: false },
    { id: 'c2', name: 'C2', type: 'store', boundaryId: 'b1', crownJewel: true },
  ],
  flows: [],
}

describe('buildKitReport', () => {
  it('hands the kit the report: sections in order, the diagram after the summary, the ledger on its own page', () => {
    const { kit, calls } = fakeKit()
    buildKitReport(kit, doc({ modelName: 'Shop', modelGraph: GRAPH }), null, {
      brand: { name: 'Example' },
      clientName: 'Example Client',
      exportedAt: '2026-11-21T09:00:00.000Z',
      exportedBy: 'Jane Doe',
      stale: true,
    })
    const input = calls.build[0]
    expect(input.kind).toBe('threat-report')
    expect(input.title).toBe('Threat Report — Residual-Risk Ledger')
    expect(input.brand).toEqual({ name: 'Example' })
    // Coverage needs live coverage facts and Boundary Crossings needs flows; this graph has a crown jewel, no flows.
    expect(input.sections.map((s) => s.id)).toEqual(['summary', 'model', 'reachability', 'who-runs', 'ledger'])
    expect(input.sections[1]).toEqual({ id: 'model', title: 'Model', html: '<figure class="rk-figure">diagram</figure>' })
    expect(input.sections.at(-1)).toMatchObject({ id: 'ledger', pageBreakBefore: true })
    expect(input.meta).toEqual({
      modelName: 'Shop',
      modelId: 'model-xyz',
      clientName: 'Example Client',
      module: { name: MODULE_NAME, version: MODULE_VERSION },
      generatedAt: '2026-06-04T00:00:00.000Z',
      fingerprint: 'abc123def456',
      stale: true,
      exportedAt: '2026-11-21T09:00:00.000Z',
      exportedBy: 'Jane Doe',
    })
    expect(input.cover.notes[0]).toMatch(/Point-in-time snapshot/)
  })

  it('draws the stored graph with its crown jewels and a layout caption, never the live model', () => {
    const { kit, calls } = fakeKit()
    buildKitReport(kit, doc({ modelGraph: GRAPH }), null, { exportedAt: 'x' })
    expect(calls.diagram).toHaveLength(1)
    expect(calls.diagram[0].graph).toBe(GRAPH)
    expect(calls.diagram[0].opts).toEqual({ caption: 'Layout as of 4 Jun 2026, 00:00 UTC', crownJewelIds: ['c2'] })
  })

  it('says to recreate the report when the snapshot has no graph, and leaves the section out when nothing can be drawn', () => {
    const { kit, calls } = fakeKit()
    buildKitReport(kit, doc(), null, { exportedAt: 'x' })
    expect(calls.build[0].sections.find((s) => s.id === 'model').html).toContain('Recreate the report to include the model diagram.')
    const empty = fakeKit({ figure: null })
    buildKitReport(empty.kit, doc({ modelGraph: GRAPH }), null, { exportedAt: 'x' })
    expect(empty.calls.build[0].sections.some((s) => s.id === 'model')).toBe(false)
  })

  it('prints no client, model name or exporter it was not given, and falls back to the model id', () => {
    const { kit, calls } = fakeKit()
    buildKitReport(kit, doc(), null, { exportedAt: 'x' })
    const { meta } = calls.build[0]
    expect(meta.modelName).toBeUndefined()
    expect(meta.clientName).toBeUndefined()
    expect(meta.exportedBy).toBeUndefined()
    expect(meta.modelId).toBe('model-xyz')
  })

  it('outlines the band chips, so they still read printed without background graphics', () => {
    const { kit, calls } = fakeKit()
    buildKitReport(kit, doc(), null, { exportedAt: 'x' })
    const html = calls.build[0].sections.map((s) => s.html).join('')
    expect(html).toContain('class="band band-o"')
    expect(html).not.toMatch(/class="band" style="background:/)
    // The standalone export keeps its filled chips, on every element's rows.
    const standalone = buildHtmlExport(TWO_ELEMENTS)
    expect(standalone).not.toContain('band-o')
  })

  it('prints its tables with separate borders inside their own box, and keeps a summary box whole', () => {
    const css = kitCss()
    expect(css).toContain('.threat-report-report table { border-collapse: separate; border-spacing: 0;')
    expect(css).toMatch(/\.threat-report-report th, \.threat-report-report td \{ border: 0; border-right: 1px solid #ddd; border-bottom: 1px solid #ddd; \}/)
    expect(css).toContain('.threat-report-report .summary { break-inside: avoid;')
    // The top line belongs to the header cells, so a header repeated on the next page has it.
    expect(css).toContain('.threat-report-report thead th, .threat-report-report table > tbody:first-child > tr:first-child > * { border-top: 1px solid #ddd; }')
    expect(css).not.toMatch(/\.threat-report-report table \{[^}]*border-top/)
    // The separate-border rule comes after the shared one it overrides.
    expect(css.indexOf('border-collapse: separate')).toBeGreaterThan(css.indexOf('border-collapse: collapse'))
  })

  it('scopes every CSS rule under the report wrapper: no bare body, h1, table or footer rule', () => {
    const css = kitCss()
    for (const rule of css.split('\n').filter(Boolean)) {
      for (const selector of rule.slice(0, rule.indexOf('{')).split(',')) {
        expect(selector.trim()).toMatch(/^\.threat-report-report /)
      }
    }
    expect(css).not.toMatch(/(^|\n)\s*(body|h1|table|footer)\b/)
    expect(css).toContain('.threat-report-report .band-o')
  })

  it('carries the same section content as the standalone export', () => {
    const { kit, calls } = fakeKit()
    const d = { ...TWO_ELEMENTS, modelGraph: GRAPH }
    buildKitReport(kit, d, null, { exportedAt: 'x' })
    const ledger = calls.build[0].sections.find((s) => s.id === 'ledger').html
    expect(ledger).toContain('C2')
    expect(buildHtmlExport(d)).toContain(ledger.replace(/class="band band-o" style="color:([^;]+);border-color:[^"]+"/g, 'class="band" style="background:$1"'))
  })
})

describe('exportHtml', () => {
  const downloads = []
  beforeEach(() => {
    downloads.length = 0
    vi.stubGlobal('document', {
      createElement: () => ({ click() {} }),
      body: { appendChild: (a) => downloads.push(a.download), removeChild() {} },
    })
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL() {} })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('goes through the report kit when the platform has one, with the brand and the analysis\'s client', async () => {
    const { kit, calls } = fakeKit()
    vi.stubGlobal('window', { __HOST_DEPENDENCIES__: { reporting: kit } })
    await exportHtml(doc({ modelName: 'Shop' }), null, { analysisId: 'an-1' })
    expect(kit.reportDetails.get).toHaveBeenCalledWith('an-1')
    expect(calls.build[0].meta.clientName).toBe('Example Client')
    expect(calls.build[0].meta.exportedBy).toBe('Jane Doe')
    expect(calls.build[0].meta.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(calls.download[0].name).toEqual({ kind: 'threat-report', stamp: '2026-06-04T00-00-00-000Z' })
    expect(downloads).toEqual([])
  })

  it('exports without a brand or a client when reading them fails', async () => {
    const { kit, calls } = fakeKit()
    kit.brand.mockRejectedValue(new Error('offline'))
    kit.reportDetails.get.mockRejectedValue(new Error('offline'))
    vi.stubGlobal('window', { __HOST_DEPENDENCIES__: { reporting: kit } })
    await exportHtml(doc(), null, { analysisId: 'an-1' })
    expect(calls.build[0].brand).toBeNull()
    expect(calls.build[0].meta.clientName).toBeUndefined()
    expect(calls.download).toHaveLength(1)
  })

  it('keeps its own export, unchanged, without the kit or with an older one', async () => {
    for (const host of [{}, { __HOST_DEPENDENCIES__: { reporting: fakeKit({ version: 0 }).kit } }]) {
      vi.stubGlobal('window', host)
      await exportHtml(doc(), null, { analysisId: 'an-1' })
    }
    expect(downloads).toEqual(['threat-report-2026-06-04T00-00-00-000Z.html', 'threat-report-2026-06-04T00-00-00-000Z.html'])
  })
})

describe('the JSON export', () => {
  it('carries the model name the snapshot stored', () => {
    const out = JSON.parse(buildJsonExport(doc({ modelName: 'Shop' })))
    expect(out.snapshot.modelName).toBe('Shop')
  })
})

describe('MODULE_VERSION', () => {
  it('is the version in package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(MODULE_VERSION).toBe(pkg.version)
  })
})

// The joined lists escape each entry once, at the join: an entry built with esc() was escaped twice and printed
// "&amp;". The two builders are called directly, since the entries come from fixed vocabularies today.
describe('lists escaped once, at the join', () => {
  it('prints a structural-gap class as written', () => {
    const html = coverageBody({
      summary: { directPrevent: 0, directDetect: 0, mitigation: 0, d3fend: 0, detectOnly: 0, uncovered: 0, soft: 1 },
      rows: [],
      offGrid: { softCount: 1 },
      structuralGaps: ['A & <B>'],
    })
    expect(html).toContain('no control supports any A &amp; &lt;B&gt;')
    expect(html).toContain('soft/unmapped (no ATT&amp;CK mapping)')
    expect(html).not.toContain('&amp;amp;')
  })

  it('prints a flow\'s worst band as written', () => {
    const html = crossingHtml({
      flow: 'F',
      source: 'S',
      target: 'T',
      sensitivity: '',
      verdict: null,
      membranes: [],
      hiddenMembranes: 0,
      onFlowLive: 1,
      onFlowWorstBand: 'a & <b>',
      onFlowControl: false,
    })
    expect(html).toContain('flow: 1 live (a &amp; &lt;b&gt;)')
    expect(html).not.toContain('&amp;amp;')
  })
})

describe('formatUtc', () => {
  it('reads an ISO timestamp as the report kit does, and passes anything else through', () => {
    expect(formatUtc('2026-11-15T10:00:00.000Z')).toBe('15 Nov 2026, 10:00 UTC')
    expect(formatUtc('2026-11-15T23:30:00+02:00')).toBe('15 Nov 2026, 21:30 UTC')
    expect(formatUtc('not a date')).toBe('not a date')
    expect(formatUtc('2026-11-15T10:00:00')).toBe('2026-11-15T10:00:00')
    expect(formatUtc('2026-02-30T10:00:00Z')).toBe('2026-02-30T10:00:00Z')
    expect(formatUtc(undefined)).toBe('')
  })
})
