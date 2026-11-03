/**
 * Operation determination: reading a value, an element's operator, its hosting boundary, a flow's
 * operator, and who holds each side.
 */
import { describe, it, expect } from 'vitest'
import {
  OPERATION_OPERATOR_KEY,
  readOperator,
  operatorOf,
  hostingOf,
  resolveFlowOperator,
  sideHolder,
  type HostingParent,
  type OperatorResolution,
} from '../operation-determination.js'
import { resolveEffectiveZone } from '../../dt-boundary/zone-determination.js'
import type { StructureBoundary } from '../../schemas/structure.schema.js'

const bag = (value: unknown) => ({ [OPERATION_OPERATOR_KEY]: value })
const boundary = (id: string, value?: unknown, opts: Partial<HostingParent> = {}): HostingParent => ({
  id,
  classed: true,
  isDefaultBoundary: false,
  bags: value === undefined ? [{}] : [bag(value)],
  ...opts,
})

describe('readOperator', () => {
  it('reads nothing when no edge answers', () => {
    expect(readOperator([])).toBeNull()
    expect(readOperator([{}, null, undefined])).toBeNull()
    expect(readOperator([{ other: 'VENDOR' }])).toBeNull()
  })

  it('treats null and an empty string as unanswered, as stubs seed them', () => {
    expect(readOperator([bag(null)])).toBeNull()
    expect(readOperator([bag('')])).toBeNull()
    expect(readOperator([{ [`${OPERATION_OPERATOR_KEY}[0]`]: null }])).toBeNull()
  })

  it('reads a listed value as declared', () => {
    expect(readOperator([bag('VENDOR')])).toEqual({ party: 'VENDOR', source: 'declared' })
    expect(readOperator([bag('CUSTOMER')])).toEqual({ party: 'CUSTOMER', source: 'declared' })
  })

  it('reads a value outside the list as invalid customer', () => {
    for (const value of ['vendor', 'Vendor ', 'PLATFORM', 42, true, { party: 'VENDOR' }]) {
      expect(readOperator([bag(value)])).toEqual({ party: 'CUSTOMER', source: 'invalid' })
    }
  })

  it('reads a list or an object, flattened or not, as invalid', () => {
    const invalid = { party: 'CUSTOMER', source: 'invalid' }
    expect(readOperator([{ [`${OPERATION_OPERATOR_KEY}[0]`]: 'VENDOR' }])).toEqual(invalid)
    expect(readOperator([{ [`${OPERATION_OPERATOR_KEY}.party`]: 'VENDOR' }])).toEqual(invalid)
    expect(readOperator([bag(['VENDOR'])])).toEqual(invalid)
    expect(readOperator([bag([])])).toEqual(invalid)
  })

  it('reads edges that agree as declared, and edges that disagree as invalid', () => {
    expect(readOperator([bag('VENDOR'), {}, bag('VENDOR')])).toEqual({ party: 'VENDOR', source: 'declared' })
    expect(readOperator([bag('VENDOR'), bag('CUSTOMER')])).toEqual({ party: 'CUSTOMER', source: 'invalid' })
  })
})

describe('operatorOf', () => {
  it('takes the element’s own value first', () => {
    expect(operatorOf({ bags: [bag('CUSTOMER')], effectiveZone: 'VENDOR' })).toEqual({ party: 'CUSTOMER', source: 'declared' })
    expect(operatorOf({ bags: [bag('VENDOR')], effectiveZone: 'INTERNAL' })).toEqual({ party: 'VENDOR', source: 'declared' })
  })

  it('keeps an invalid value invalid, whatever the zone', () => {
    expect(operatorOf({ bags: [bag('PLATFORM')], effectiveZone: 'VENDOR' })).toEqual({ party: 'CUSTOMER', source: 'invalid' })
  })

  it('falls back to the zone, then to customer', () => {
    expect(operatorOf({ bags: [], effectiveZone: 'VENDOR' })).toEqual({ party: 'VENDOR', source: 'zone' })
    expect(operatorOf({ bags: [], effectiveZone: 'INTERNAL' })).toEqual({ party: 'CUSTOMER', source: 'default' })
  })

  it('uses the nearest declared zone, as the zone resolver gives it', () => {
    // An INTERNAL boundary inside a VENDOR one: the nearer declaration wins, so the element is not
    // vendor-operated by zone.
    const root: StructureBoundary = { id: 'root', name: 'root', zone: 'VENDOR' } as StructureBoundary
    const inner: StructureBoundary = {
      id: 'inner',
      name: 'inner',
      zone: 'INTERNAL',
      parentBoundary: { id: 'root' },
    } as StructureBoundary
    const byId = new Map([
      ['root', root],
      ['inner', inner],
    ])
    const zone = resolveEffectiveZone('inner', byId, 'default').zone
    expect(operatorOf({ bags: [], effectiveZone: zone })).toEqual({ party: 'CUSTOMER', source: 'default' })
  })
})

describe('hostingOf', () => {
  it('has no hosting boundary without a parent, for the default boundary, or for an unclassed parent', () => {
    expect(hostingOf(undefined)).toEqual({ party: 'CUSTOMER', source: 'undeclared' })
    expect(hostingOf(boundary('root', 'VENDOR', { isDefaultBoundary: true }))).toEqual({ party: 'CUSTOMER', source: 'undeclared' })
    expect(hostingOf(boundary('b', 'VENDOR', { classed: false }))).toEqual({ party: 'CUSTOMER', source: 'undeclared' })
  })

  it('has no hosting boundary when the parent carries no value', () => {
    expect(hostingOf(boundary('b'))).toEqual({ party: 'CUSTOMER', source: 'undeclared' })
    expect(hostingOf(boundary('b', null))).toEqual({ party: 'CUSTOMER', source: 'undeclared' })
  })

  it('reads a declared parent, and an invalid one', () => {
    expect(hostingOf(boundary('acct', 'VENDOR'))).toEqual({ party: 'VENDOR', source: 'declared', boundaryId: 'acct' })
    expect(hostingOf(boundary('dc', 'CUSTOMER'))).toEqual({ party: 'CUSTOMER', source: 'declared', boundaryId: 'dc' })
    expect(hostingOf(boundary('x', 'PLATFORM'))).toEqual({ party: 'CUSTOMER', source: 'invalid', boundaryId: 'x' })
  })

  describe('nested hosting: an app on a self-managed cluster inside a cloud account', () => {
    const account = boundary('account', 'VENDOR')
    const cluster = boundary('cluster', 'CUSTOMER')

    it('the app, drawn in the cluster, is hosted by the cluster; the account above has no say', () => {
      expect(hostingOf(cluster)).not.toEqual(hostingOf(account))
      expect(hostingOf(cluster)).toEqual({ party: 'CUSTOMER', source: 'declared', boundaryId: 'cluster' })
    })

    it('what is drawn directly in the account is hosted by the account', () => {
      expect(hostingOf(account)).toEqual({ party: 'VENDOR', source: 'declared', boundaryId: 'account' })
    })

    it('an undeclared cluster hosts nothing; the account above does not take over', () => {
      expect(hostingOf(boundary('cluster'))).toEqual({ party: 'CUSTOMER', source: 'undeclared' })
    })
  })

})

describe('resolveFlowOperator', () => {
  const v = (source: OperatorResolution['source']): OperatorResolution => ({ party: 'VENDOR', source })
  const c = (source: OperatorResolution['source']): OperatorResolution => ({ party: 'CUSTOMER', source })

  it('is VENDOR only when every end is', () => {
    expect(resolveFlowOperator([v('declared'), v('declared')])).toEqual({ party: 'VENDOR', source: 'declared' })
    expect(resolveFlowOperator([v('declared'), c('declared')]).party).toBe('CUSTOMER')
  })

  it('takes the weakest source of its ends', () => {
    expect(resolveFlowOperator([v('declared'), v('zone')])).toEqual({ party: 'VENDOR', source: 'zone' })
    expect(resolveFlowOperator([v('declared'), c('default')])).toEqual({ party: 'CUSTOMER', source: 'default' })
    expect(resolveFlowOperator([c('default'), c('invalid')]).source).toBe('invalid')
  })

  it('is customer by default without ends', () => {
    expect(resolveFlowOperator([])).toEqual({ party: 'CUSTOMER', source: 'default' })
  })
})

describe('sideHolder', () => {
  const declared = (party: 'CUSTOMER' | 'VENDOR') => ({ party, source: 'declared' as const, boundaryId: 'h' })
  const none = { party: 'CUSTOMER' as const, source: 'undeclared' as const }
  const invalid = { party: 'CUSTOMER' as const, source: 'invalid' as const, boundaryId: 'h' }

  it('gives configuration to the customer, always', () => {
    for (const operator of ['CUSTOMER', 'VENDOR'] as const) {
      for (const hosting of [none, declared('VENDOR'), declared('CUSTOMER')]) {
        expect(sideHolder({ kind: 'component', operator, hosting, side: 'configuration' })).toBe('customer')
      }
    }
  })

  it('a vendor element with no or a vendor hosting boundary: build and runtime are the vendor’s', () => {
    for (const hosting of [none, declared('VENDOR'), undefined]) {
      expect(sideHolder({ kind: 'component', operator: 'VENDOR', hosting, side: 'build' })).toBe('vendor')
      expect(sideHolder({ kind: 'component', operator: 'VENDOR', hosting, side: 'runtime' })).toBe('vendor')
    }
  })

  it('a vendor element on a customer-run environment: runtime is the customer’s', () => {
    expect(sideHolder({ kind: 'component', operator: 'VENDOR', hosting: declared('CUSTOMER'), side: 'build' })).toBe('vendor')
    expect(sideHolder({ kind: 'component', operator: 'VENDOR', hosting: declared('CUSTOMER'), side: 'runtime' })).toBe('customer')
  })

  it('a customer element on a vendor-run environment: only runtime is the vendor’s', () => {
    expect(sideHolder({ kind: 'component', operator: 'CUSTOMER', hosting: declared('VENDOR'), side: 'build' })).toBe('customer')
    expect(sideHolder({ kind: 'component', operator: 'CUSTOMER', hosting: declared('VENDOR'), side: 'runtime' })).toBe('vendor')
  })

  it('a customer element with no or a customer hosting boundary: everything is the customer’s', () => {
    for (const hosting of [none, declared('CUSTOMER')]) {
      for (const side of ['build', 'runtime'] as const) {
        expect(sideHolder({ kind: 'component', operator: 'CUSTOMER', hosting, side })).toBe('customer')
      }
    }
  })

  it('an invalid hosting boundary leaves runtime with the element’s operator', () => {
    expect(sideHolder({ kind: 'component', operator: 'VENDOR', hosting: invalid, side: 'runtime' })).toBe('vendor')
    expect(sideHolder({ kind: 'component', operator: 'CUSTOMER', hosting: invalid, side: 'runtime' })).toBe('customer')
  })

  it('treats a boundary like a component', () => {
    expect(sideHolder({ kind: 'boundary', operator: 'CUSTOMER', hosting: declared('VENDOR'), side: 'runtime' })).toBe('vendor')
  })

  it('gives a flow’s build and runtime to the flow’s operator, never to a hosting boundary', () => {
    expect(sideHolder({ kind: 'dataFlow', operator: 'VENDOR', hosting: declared('CUSTOMER'), side: 'runtime' })).toBe('vendor')
    expect(sideHolder({ kind: 'dataFlow', operator: 'CUSTOMER', hosting: declared('VENDOR'), side: 'runtime' })).toBe('customer')
    expect(sideHolder({ kind: 'dataFlow', operator: 'VENDOR', side: 'build' })).toBe('vendor')
  })

  it('gives every side of a data item to the customer', () => {
    for (const side of ['configuration', 'build', 'runtime'] as const) {
      expect(sideHolder({ kind: 'dataItem', operator: 'VENDOR', hosting: declared('VENDOR'), side })).toBe('customer')
    }
  })
})
