// exportReport.test.js — the JSON + self-contained printable HTML export lib.
// Focus: HTML-escaping (the security-relevant esc() sink), the no-percentage /
// honesty contract in JSON, the coverage-absent (coverage-tools not deployed)
// path, and minimal-doc robustness. downloadBlob (the only DOM touch) is NOT
// tested here. The pure builders are (string in, string out).
import { describe, it, expect } from 'vitest'
import { buildJsonExport, buildHtmlExport } from '../lib/exportReport.js'

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

// coverage-tools graded-coverage facts (parsed) — same shape coverageMatrix.test.js uses.
const tier = (t, fn, cms = ['cm1'], controls = ['k1']) => ({
  tier: t, function: fn, countermeasureIds: cms, controlIds: controls,
})
const technique = (id, tactics = ['Initial Access'], tiers = []) => ({
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
  exposure({ exposureId: 'e1', elementId: 'c1', techniques: [technique('T1190', ['Initial Access'], [tier('DIRECT', 'PREVENT')])] }),
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
    expect(Object.keys(out).sort()).toEqual(['coverage', 'provenance', 'reachability', 'snapshot'])
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
