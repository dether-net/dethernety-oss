import { describe, it, expect } from 'vitest'
import { aggregateLedger, scoreBand, provenanceOf, isLive } from '../lib/aggregateLedger.js'
import { buildJsonExport, buildHtmlExport } from '../lib/exportReport.js'

// --- fixtures -------------------------------------------------------------
const finding = (over = {}) => ({
  id: 'f' + Math.random().toString(36).slice(2),
  name: 'A finding',
  score: 5,
  attackVector: 'NETWORK',
  createdBy: 'SYSTEM',
  authoredBy: null,
  dispositionKind: null,
  dispositionReason: null,
  dispositionedBy: null,
  dispositionedAt: null,
  dispositionStale: null,
  ...over,
})

const LEDGER = [
  {
    id: 'comp1', name: 'API Gateway', type: 'Component',
    findings: [
      finding({ name: 'crit live', score: 9.5 }),
      finding({ name: 'med live', score: 5 }),
      finding({ name: 'accepted', score: 8, dispositionKind: 'RISK_ACCEPTED', dispositionReason: 'mitigated elsewhere', createdBy: 'USER' }),
      finding({ name: 'stale accepted', score: 7, dispositionKind: 'COMPENSATING_CONTROL', dispositionStale: true }),
    ],
    supportingControls: [{ id: 'c1', name: 'WAF', type: null, category: null }],
  },
  {
    id: 'bnd1', name: 'DMZ', type: 'SecurityBoundary',
    findings: [finding({ name: 'boundary finding', score: null })],
    supportingControls: [],
  },
  {
    id: 'data1', name: 'PII store', type: 'Data',
    findings: [finding({ name: 'data finding', score: 4 })],
    supportingControls: [],
  },
  // element with no findings — excluded from the ledger groups
  { id: 'comp2', name: 'No findings', type: 'Component', findings: [], supportingControls: [{ id: 'c2', name: 'logging', type: null, category: null }] },
]

// --- scoreBand ------------------------------------------------------------
describe('scoreBand', () => {
  it('maps the 0–10 scale and treats null as unknown (never low)', () => {
    expect(scoreBand(9)).toBe('critical')
    expect(scoreBand(8.9)).toBe('high')
    expect(scoreBand(7)).toBe('high')
    expect(scoreBand(4)).toBe('medium')
    expect(scoreBand(3.9)).toBe('low')
    expect(scoreBand(null)).toBe('unknown')
    expect(scoreBand(undefined)).toBe('unknown')
  })
})

describe('provenance + live', () => {
  it('treats null/empty createdBy as SYSTEM, USER as USER', () => {
    expect(provenanceOf({ createdBy: 'USER' })).toBe('USER')
    expect(provenanceOf({ createdBy: null })).toBe('SYSTEM')
    expect(provenanceOf({})).toBe('SYSTEM')
  })
  it('live = dispositionKind == null', () => {
    expect(isLive({ dispositionKind: null })).toBe(true)
    expect(isLive({ dispositionKind: 'WAIVED' })).toBe(false)
  })
})

// --- aggregateLedger ------------------------------------------------------
describe('aggregateLedger', () => {
  it('handles an empty/undefined ledger honestly', () => {
    for (const empty of [[], undefined, null]) {
      const { totals, groups } = aggregateLedger(empty)
      expect(groups).toEqual([])
      expect(totals.findings).toBe(0)
      expect(totals.live).toBe(0)
      expect(totals.dispositioned).toBe(0)
    }
  })

  it('partitions live vs dispositioned and never drops dispositioned', () => {
    const { totals, groups } = aggregateLedger(LEDGER)
    expect(totals.findings).toBe(6) // 4 + 1 + 1
    expect(totals.live).toBe(4) // comp1: 2 live, bnd1: 1, data1: 1
    expect(totals.dispositioned).toBe(2) // comp1: accepted + stale-accepted
    const comp1 = groups.find((g) => g.id === 'comp1')
    expect(comp1.live.length).toBe(2)
    expect(comp1.dispositioned.length).toBe(2) // kept, not dropped
    expect(totals.byKind.RISK_ACCEPTED).toBe(1)
    expect(totals.byKind.COMPENSATING_CONTROL).toBe(1)
  })

  it('makes Data and SecurityBoundary findings first-class groups', () => {
    const { groups } = aggregateLedger(LEDGER)
    expect(groups.find((g) => g.type === 'SecurityBoundary')).toBeTruthy()
    expect(groups.find((g) => g.type === 'Data')).toBeTruthy()
  })

  it('excludes finding-free elements from the ledger', () => {
    const { groups } = aggregateLedger(LEDGER)
    expect(groups.find((g) => g.id === 'comp2')).toBeUndefined()
  })

  it('counts stale dispositions and surfaces provenance counts', () => {
    const { totals } = aggregateLedger(LEDGER)
    expect(totals.stale).toBe(1)
    expect(totals.byProvenance.USER).toBe(1) // the accepted one
    expect(totals.byProvenance.SYSTEM).toBe(5)
  })

  it('sorts live findings by severity and elements with live findings first', () => {
    const { groups } = aggregateLedger(LEDGER)
    expect(groups[0].liveCount).toBeGreaterThan(0)
    const comp1 = groups.find((g) => g.id === 'comp1')
    expect(comp1.live[0].band).toBe('critical') // 9.5 sorts above 5
  })

  it('preserves supporting controls as context', () => {
    const { groups } = aggregateLedger(LEDGER)
    const comp1 = groups.find((g) => g.id === 'comp1')
    expect(comp1.supportingControls.map((c) => c.name)).toContain('WAF')
  })

  it('flags a compensating-control claim with no control present (and not when a control exists)', () => {
    // comp1 has a COMPENSATING_CONTROL disposition AND a WAF control → not flagged.
    const base = aggregateLedger(LEDGER).groups.find((g) => g.id === 'comp1')
    expect(base.compensatingClaimNoControl).toBe(false)
    // same disposition but zero supporting controls → flagged.
    const flagged = aggregateLedger([
      {
        id: 'x', name: 'Naked claim', type: 'Component',
        findings: [finding({ dispositionKind: 'COMPENSATING_CONTROL', dispositionReason: 'covered by X' })],
        supportingControls: [],
      },
    ]).groups[0]
    expect(flagged.compensatingClaimNoControl).toBe(true)
  })

  it('carries forensic attribution (dispositionedBy/At) into dispositioned findings', () => {
    const agg = aggregateLedger([
      {
        id: 'y', name: 'el', type: 'Component',
        findings: [finding({ dispositionKind: 'RISK_ACCEPTED', dispositionedBy: 'alice@x', dispositionedAt: '2026-06-04T09:00:00Z' })],
        supportingControls: [],
      },
    ])
    const f = agg.groups[0].dispositioned[0]
    expect(f.dispositionedBy).toBe('alice@x')
    expect(f.dispositionedAt).toBe('2026-06-04T09:00:00Z')
  })
})

// --- export ---------------------------------------------------------------
const DOC = {
  generated: true,
  modelId: 'model-xyz',
  generatedAt: '2026-06-04T00:00:00.000Z',
  fingerprint: 'abc123def456',
  componentCount: 1,
  boundaryCount: 1,
  ledger: LEDGER,
}

describe('buildJsonExport', () => {
  it('round-trips: parses back to the snapshot + a provenance footer', () => {
    const out = JSON.parse(buildJsonExport(DOC))
    expect(out.snapshot.fingerprint).toBe('abc123def456')
    expect(out.provenance.modelId).toBe('model-xyz')
    expect(out.provenance.counts.findings).toBe(6)
    expect(out.provenance.counts.dispositioned).toBe(2)
  })
})

describe('buildHtmlExport', () => {
  const html = buildHtmlExport(DOC)
  it('is a self-contained HTML document (doctype + inline style, no theme vars)', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<style>')
    expect(html).not.toContain('var(--v-theme') // must resolve standalone
  })
  it('renders findings + the provenance footer', () => {
    expect(html).toContain('crit live')
    expect(html).toContain('Risk Accepted') // dispositioned, not dropped
    expect(html).toContain('model-xyz')
    expect(html).toContain('abc123def456')
  })
  it('shows no risk-score aggregate / no coverage %', () => {
    expect(html).not.toMatch(/Covered:\s*\d/i)
    expect(html).not.toMatch(/\b\d+%\s*cover/i)
  })
})

// --- ② reachability in export ---------------------------------------------
const REACH_DOC = {
  generated: true,
  modelId: 'm',
  generatedAt: '2026-06-05T00:00:00Z',
  fingerprint: 'fp',
  ledger: [],
  modelGraph: {
    boundaries: [],
    components: [
      { id: 'ext', name: 'Ext', type: 'external_entity', boundaryId: null, crownJewel: false },
      { id: 'db', name: 'DB', type: 'store', boundaryId: null, crownJewel: true },
      { id: 'vault', name: 'Vault', type: 'store', boundaryId: null, crownJewel: true },
    ],
    flows: [{ id: 'f1', name: 'e', sourceId: 'ext', targetId: 'db', sensitivities: [], dataItemCount: 0 }],
    dataNodes: [],
  },
}

describe('reachability export', () => {
  it('JSON carries flowRoutes (never attackPaths); unreachable = "no modeled flow route"', () => {
    const out = JSON.parse(buildJsonExport(REACH_DOC))
    expect(out.reachability.hasCrownJewels).toBe(true)
    expect(out.reachability.reachableCount).toBe(1)
    expect(out.reachability.flowRoutes).toHaveLength(2)
    expect(JSON.stringify(out.reachability)).not.toMatch(/attackPath/i)
    const vault = out.reachability.flowRoutes.find((r) => r.jewel === 'Vault')
    expect(vault.route).toBe('no modeled flow route')
    const db = out.reachability.flowRoutes.find((r) => r.jewel === 'DB')
    expect(db.route.minHops).toBe(1)
  })

  it('HTML renders the section honestly and stays theme-var-free', () => {
    const html = buildHtmlExport(REACH_DOC)
    expect(html).toContain('Crown-Jewel Reachability')
    expect(html).toContain('no modeled flow route')
    // The honesty caveat explicitly frames these as flow routes, NOT attack paths.
    expect(html).toMatch(/flow routes/i)
    expect(html).toMatch(/not attack paths/i)
    expect(html).not.toContain('var(--v-theme')
  })

  it('omits the reachability section when there is no modelGraph', () => {
    const out = JSON.parse(buildJsonExport(DOC))
    expect(out.reachability).toBeNull()
    expect(buildHtmlExport(DOC)).not.toContain('Crown-Jewel Reachability')
  })
})
