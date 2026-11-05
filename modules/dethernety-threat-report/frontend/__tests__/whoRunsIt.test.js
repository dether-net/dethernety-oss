import { describe, it, expect } from 'vitest'
import { computeComponentProfile } from '../lib/componentProfile.js'
import { buildExposureDetail } from '../lib/exposureDetail.js'
import { buildHtmlExport, buildJsonExport } from '../lib/exportReport.js'
import { entryTexts, hasOperationToShow, WHO_RUNS_COPY as COPY, whoRunsItLine, whoRunsItView } from '../lib/whoRunsIt.js'

const resolved = (elements) => ({ state: 'resolved', elements })
const vendor = { operator: { party: 'VENDOR', source: 'declared' } }
const mg = {
  boundaries: [{ id: 'b', name: 'Cloud', parentBoundaryId: null }],
  components: [{ id: 'c', name: 'Mail', boundaryId: 'b' }],
  flows: [{ id: 'f', name: 'Flow', sourceId: 'c', targetId: 'c' }],
  dataNodes: [{ id: 'd', name: 'Data' }],
}

describe('entryTexts', () => {
  it('says how the operator was decided, for each source', () => {
    expect(entryTexts(vendor)).toEqual([COPY.vendorDeclared])
    expect(entryTexts({ operator: { party: 'CUSTOMER', source: 'declared' } })).toEqual([COPY.youDeclared])
    expect(entryTexts({ operator: { party: 'VENDOR', source: 'zone' } })).toEqual([COPY.vendorFromZone])
    expect(entryTexts({ operator: { party: 'CUSTOMER', source: 'default' } })).toEqual([COPY.notDeclared])
    expect(entryTexts({ operator: { party: 'CUSTOMER', source: 'invalid' } })).toEqual([COPY.invalid])
  })

  it('names the product, the hosting boundary and what a boundary hosts', () => {
    const hosting = { boundaryId: 'b', name: 'Cloud', party: 'VENDOR', source: 'declared' }
    expect(entryTexts({ ...vendor, product: 'Mail', hosting })).toEqual([COPY.vendorDeclared, COPY.product('Mail'), COPY.environmentVendor('Cloud')])
    expect(entryTexts({ ...vendor, hosting: { ...hosting, party: 'CUSTOMER' } })[1]).toBe(COPY.environmentYou('Cloud'))
    expect(entryTexts({ ...vendor, hosting: { ...hosting, source: 'invalid', party: 'CUSTOMER' } })[1]).toBe(COPY.environmentInvalid('Cloud'))
    expect(entryTexts({ ...vendor, drawnComponents: 3 })[1]).toBe(COPY.runsEnvironment(3))
    expect(COPY.runsEnvironment(1)).toContain('1 component drawn')
    expect(entryTexts({ ...vendor, drawnComponents: 0 })).toEqual([COPY.vendorDeclared])
  })

  it('the words state a declaration, never a judgement', () => {
    const words = Object.values(COPY).map((w) => (typeof w === 'function' ? w(2) : w)).join(' ').toLowerCase()
    for (const banned of ['handled', 'safe', 'mitigated', 'secure', 'protected', 'covered', 'compliant']) {
      expect(words).not.toContain(banned)
    }
  })
})

describe('whoRunsItView', () => {
  it('a report from before this was gathered asks to be recreated, and guesses nothing', () => {
    expect(whoRunsItView(undefined, 'c')).toEqual({ state: 'recreate', texts: [COPY.recreate] })
    expect(whoRunsItView(null, 'c').state).toBe('recreate')
  })

  it('says when it could not be worked out', () => {
    expect(whoRunsItView({ state: 'unavailable', elements: {} }, 'c')).toEqual({ state: 'unavailable', texts: [COPY.unavailable] })
    expect(whoRunsItView(resolved({}), 'c').state).toBe('unavailable')
  })

  it('reads own keys only: an element id cannot reach the prototype', () => {
    expect(whoRunsItView(resolved({}), 'constructor').state).toBe('unavailable')
    expect(whoRunsItLine(resolved({}), '__proto__')).toBeNull()
  })
})

describe('whoRunsItLine', () => {
  it('is one line when resolved, and nothing otherwise', () => {
    expect(whoRunsItLine(resolved({ c: { ...vendor, product: 'Mail' } }), 'c')).toBe(`${COPY.title}: ${COPY.vendorDeclared}. ${COPY.product('Mail')}.`)
    expect(whoRunsItLine(undefined, 'c')).toBeNull()
    expect(whoRunsItLine({ state: 'unavailable', elements: {} }, 'c')).toBeNull()
    expect(whoRunsItLine(resolved({}), 'f')).toBeNull()
  })
})

describe('the component profile', () => {
  it('carries the block for a component and a boundary', () => {
    const operation = resolved({ c: vendor, b: vendor })
    expect(computeComponentProfile('c', { ledger: [], modelGraph: mg, operation }).whoRuns.texts).toEqual([COPY.vendorDeclared])
    expect(computeComponentProfile('b', { ledger: [], modelGraph: mg, operation }).whoRuns.texts).toEqual([COPY.vendorDeclared])
  })

  it('says nothing on a flow or a data item, on any report', () => {
    for (const operation of [undefined, resolved({})]) {
      expect(computeComponentProfile('f', { ledger: [], modelGraph: mg, operation }).whoRuns).toBeNull()
      expect(computeComponentProfile('d', { ledger: [], modelGraph: mg, operation }).whoRuns).toBeNull()
    }
  })

  it('asks an older report to be recreated', () => {
    expect(computeComponentProfile('c', { ledger: [], modelGraph: mg }).whoRuns.state).toBe('recreate')
  })
})

describe('the exposure detail', () => {
  it('carries the line it is given, and nothing without one', () => {
    expect(buildExposureDetail({ id: 'e', name: 'x' }, { whoRuns: 'A line.' }).whoRuns).toBe('A line.')
    expect(buildExposureDetail({ id: 'e', name: 'x' }, {}).whoRuns).toBeNull()
  })
})

describe('the exports', () => {
  const doc = (operation) => ({ ledger: [], modelGraph: mg, generatedAt: '2026-11-04T00:00:00Z', modelId: 'm', ...(operation ? { operation } : {}) })

  it('the HTML lists what declares, escaped', () => {
    const html = buildHtmlExport(doc(resolved({ c: { ...vendor, product: '<script>alert(1)</script>' }, b: { operator: { party: 'CUSTOMER', source: 'default' } } })))
    expect(html).toContain('<h2>Who runs it</h2>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>alert(1)')
    expect(html).toContain('<td>Mail</td>')
    expect(html).not.toContain('<td>Cloud</td>')
  })

  it('the HTML escapes an element and a boundary name', () => {
    const hosting = { boundaryId: 'b', name: '<b>x</b>', party: 'VENDOR', source: 'declared' }
    const html = buildHtmlExport({ ...doc(resolved({ c: { ...vendor, hosting } })), modelGraph: { ...mg, components: [{ id: 'c', name: '<i>n</i>', boundaryId: 'b' }] } })
    expect(html).toContain('&lt;i&gt;n&lt;/i&gt;')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
  })

  it('the HTML says when nothing declares, an older report and a failed resolution', () => {
    expect(buildHtmlExport(doc(resolved({ c: { operator: { party: 'CUSTOMER', source: 'default' } } })))).toContain(COPY.noneDeclared)
    expect(buildHtmlExport(doc())).toContain(COPY.recreate)
    expect(buildHtmlExport(doc({ state: 'unavailable', elements: {} }))).toContain(COPY.unavailable)
  })

  it('the JSON carries what was resolved', () => {
    const json = buildJsonExport(doc(resolved({ c: { ...vendor, product: 'Mail' } })))
    expect(JSON.parse(json).snapshot.operation.elements.c.product).toBe('Mail')
  })
})

describe('hasOperationToShow', () => {
  it('is false only for what is purely a default', () => {
    expect(hasOperationToShow({ operator: { party: 'CUSTOMER', source: 'default' } })).toBe(false)
    expect(hasOperationToShow(vendor)).toBe(true)
    expect(hasOperationToShow({ operator: { party: 'VENDOR', source: 'zone' } })).toBe(true)
    expect(hasOperationToShow({ operator: { party: 'CUSTOMER', source: 'default' }, product: 'x' })).toBe(true)
    expect(hasOperationToShow(null)).toBe(false)
  })
})
