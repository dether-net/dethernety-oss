import { describe, it, expect } from 'vitest'
import { isUnavailableNotice, productOf, whoRunsItTexts, WHO_RUNS_COPY as COPY } from '../whoRunsIt'
import type { WhoRunsItInput } from '../whoRunsIt'

const OP = 'dethernety_operated_by'
const PRODUCT = 'dethernety_product'
const VERSION = 'dethernety_product_version'

const input = (over: Partial<WhoRunsItInput> = {}): WhoRunsItInput => ({
  kind: 'component',
  ownState: 'read',
  ownBag: {},
  effectiveZone: 'INTERNAL',
  ...over,
})

describe('whoRunsItTexts: the element itself', () => {
  it('says how the operator was decided, for each source', () => {
    expect(whoRunsItTexts(input({ ownBag: { [OP]: 'VENDOR' } }))).toEqual([COPY.vendorDeclared])
    expect(whoRunsItTexts(input({ ownBag: { [OP]: 'CUSTOMER' } }))).toEqual([COPY.youDeclared])
    expect(whoRunsItTexts(input({ effectiveZone: 'VENDOR' }))).toEqual([COPY.vendorFromZone])
    expect(whoRunsItTexts(input())).toEqual([COPY.notDeclared])
    expect(whoRunsItTexts(input({ ownBag: { [OP]: 'SOMEONE' } }))).toEqual([COPY.invalid])
  })

  it('reads a list stored flattened as invalid: the flat keys are what is stored', () => {
    expect(whoRunsItTexts(input({ ownBag: { [`${OP}[0]`]: 'VENDOR' } }))).toEqual([COPY.invalid])
  })

  it('a declaration beats a VENDOR zone', () => {
    expect(whoRunsItTexts(input({ ownBag: { [OP]: 'CUSTOMER' }, effectiveZone: 'VENDOR' }))).toEqual([COPY.youDeclared])
  })

  it('never reads an unread declaration as undeclared', () => {
    for (const ownState of ['failed', 'not-read'] as const) {
      expect(whoRunsItTexts(input({ ownState, effectiveZone: 'VENDOR' }))).toEqual([COPY.notRead])
    }
    expect(whoRunsItTexts(input({ ownState: 'loading', effectiveZone: 'VENDOR' }))).toEqual([COPY.reading])
  })

  it('an element with no class has nothing declared', () => {
    expect(whoRunsItTexts(input({ ownState: 'no-class' }))).toEqual([COPY.notDeclared])
    expect(whoRunsItTexts(input({ ownState: 'no-class', effectiveZone: 'VENDOR' }))).toEqual([COPY.vendorFromZone])
  })

  it('names the product, and never the version', () => {
    const texts = whoRunsItTexts(input({ ownBag: { [OP]: 'VENDOR', [PRODUCT]: 'Mail', [VERSION]: '9.9.9' } }))
    expect(texts).toEqual([COPY.vendorDeclared, COPY.product('Mail')])
    expect(texts.join(' ')).not.toContain('9.9.9')
  })
})

describe('productOf', () => {
  it('trims, composes and cuts', () => {
    expect(productOf({ [PRODUCT]: '  Mail  ' })).toBe('Mail')
    expect(productOf({ [PRODUCT]: 'Café' })).toBe('Café')
    expect(productOf({ [PRODUCT]: 'x'.repeat(300) })).toHaveLength(200)
  })

  it('names none for anything but a non-empty string', () => {
    for (const value of [undefined, null, '', '   ', 7, ['Mail'], { name: 'Mail' }]) {
      expect(productOf({ [PRODUCT]: value })).toBeUndefined()
    }
    expect(productOf(null)).toBeUndefined()
  })
})

describe('whoRunsItTexts: the environment', () => {
  const parent = (state: 'loading' | 'read' | 'failed', bag?: Record<string, unknown>) => ({ id: 'p', name: 'Cloud', state, bag })

  it('names the hosting boundary with its own declaration', () => {
    expect(whoRunsItTexts(input({ parent: parent('read', { [OP]: 'VENDOR' }) }))[1]).toBe(COPY.environmentVendor('Cloud'))
    expect(whoRunsItTexts(input({ parent: parent('read', { [OP]: 'CUSTOMER' }) }))[1]).toBe(COPY.environmentYou('Cloud'))
    expect(whoRunsItTexts(input({ parent: parent('read', { [OP]: 'x' }) }))[1]).toBe(COPY.environmentInvalid('Cloud'))
  })

  it('says nothing of a parent with no value, or one still loading', () => {
    expect(whoRunsItTexts(input({ parent: parent('read', {}) }))).toEqual([COPY.notDeclared])
    expect(whoRunsItTexts(input({ parent: parent('loading') }))).toEqual([COPY.notDeclared])
  })

  it('says a failed read failed, and keeps the element\'s own line', () => {
    expect(whoRunsItTexts(input({ ownBag: { [OP]: 'VENDOR' }, parent: parent('failed') }))).toEqual([
      COPY.vendorDeclared,
      COPY.environmentNotRead('Cloud'),
    ])
  })

  it('a boundary shows no hosting of its own', () => {
    expect(whoRunsItTexts(input({ kind: 'boundary', parent: parent('read', { [OP]: 'VENDOR' }) }))).toEqual([COPY.notDeclared])
  })
})

describe('whoRunsItTexts: a boundary', () => {
  it('counts what it hosts only when it declares a vendor', () => {
    const boundary = (over: Partial<WhoRunsItInput>) => input({ kind: 'boundary', drawnComponents: 2, ...over })
    expect(whoRunsItTexts(boundary({ ownBag: { [OP]: 'VENDOR' } }))).toEqual([COPY.vendorDeclared, COPY.runsEnvironment(2)])
    expect(whoRunsItTexts(boundary({ ownBag: { [OP]: 'VENDOR' }, drawnComponents: 1 }))[1]).toBe(COPY.runsEnvironment(1))
    expect(COPY.runsEnvironment(1)).toContain('1 component drawn')
    expect(whoRunsItTexts(boundary({ ownBag: { [OP]: 'CUSTOMER' } }))).toEqual([COPY.youDeclared])
    expect(whoRunsItTexts(boundary({ effectiveZone: 'VENDOR' }))).toEqual([COPY.vendorFromZone])
    expect(whoRunsItTexts(boundary({ ownBag: { [OP]: 'VENDOR' }, drawnComponents: 0 }))).toEqual([COPY.vendorDeclared])
  })
})

describe('isUnavailableNotice', () => {
  const notice = { schema: { type: 'object', properties: {} }, uischema: { type: 'VerticalLayout', elements: [{ type: 'Label', text: 'x' }] } }

  it('recognises the notice served when a class is not available, and the line says so', () => {
    expect(isUnavailableNotice(notice)).toBe(true)
    expect(whoRunsItTexts(input({ ownBag: { [OP]: 'VENDOR' }, unavailable: true }))).toEqual([COPY.vendorDeclared, COPY.unavailable])
  })

  it('does not mistake other templates for it', () => {
    expect(isUnavailableNotice(undefined)).toBe(false)
    expect(isUnavailableNotice({})).toBe(false)
    expect(isUnavailableNotice({ schema: { properties: { a: {} } }, uischema: notice.uischema })).toBe(false)
    expect(isUnavailableNotice({ schema: { properties: {} }, uischema: { type: 'VerticalLayout', elements: [] } })).toBe(false)
    expect(isUnavailableNotice({
      schema: { properties: {} },
      uischema: { type: 'VerticalLayout', elements: [{ type: 'Label' }, { type: 'Group', elements: [{ type: 'Control' }] }] },
    })).toBe(false)
  })
})

describe('the words', () => {
  it('state a declaration, never a judgement', () => {
    const words = Object.values(COPY).map((w) => (typeof w === 'function' ? (w as (x: never) => string)(2 as never) : w))
    for (const banned of ['handled', 'safe', 'mitigated', 'secure', 'protected', 'covered', 'compliant']) {
      expect(words.join(' ').toLowerCase()).not.toContain(banned)
    }
  })
})
